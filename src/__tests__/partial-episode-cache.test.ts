import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as metaGET } from "@/app/meta/[type]/[id]/route"
import { GET as previewGET } from "@/app/api/preview/episodes/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { clearTvdbCache, enrichVideosWithTvdbDetailed, getTvdbEpisodesResult } from "@/lib/tvdb"
import { buildVideosFromTvdbDetailed, isSeasonEpisodesComplete } from "@/lib/episode-ordering"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import type { StremioVideo } from "@/lib/meta-handler"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const epochCtl = vi.hoisted(() => ({ value: "e1" }))
vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => epochCtl.value),
  bumpCatalogEpoch: vi.fn(async () => epochCtl.value),
}))

const mockedGetById = vi.mocked(getById)

const REAL_NOW = Date.now.bind(Date)
let nowOffset = 0

function tmdbDetailsResponse(tmdbId: number, imdb: string, seasons: { n: number; count: number; airDate?: string }[]) {
  return Response.json({
    id: tmdbId,
    name: "Serie Partial",
    overview: "Trama",
    first_air_date: "2020-01-01",
    vote_average: 8.0,
    genres: [],
    external_ids: { imdb_id: imdb },
    seasons: seasons.map((s) => ({
      season_number: s.n,
      episode_count: s.count,
      air_date: s.airDate ?? "2020-01-01",
    })),
  })
}

function tmdbSeasonResponse(season: number, count: number, opts?: { futureLast?: boolean; prefix?: string }) {
  return Response.json({
    id: season,
    season_number: season,
    name: `Stagione ${season}`,
    episodes: Array.from({ length: count }, (_, k) => ({
      id: season * 1000 + k,
      season_number: season,
      episode_number: k + 1,
      name: `${opts?.prefix ?? "Ep"} ${k + 1}`,
      overview: "Trama TMDB",
      still_path: "/tmdb.jpg",
      air_date: opts?.futureLast && k === count - 1 ? "2099-06-01" : "2020-01-01",
      vote_average: 8.0,
    })),
  })
}

function tvdbLoginResponse() {
  return Response.json({ status: "success", data: { token: "mock-jwt-partial" } })
}

function tvdbSearchResponse(tvdbId: number) {
  return Response.json({ status: "success", data: [{ series: { id: tvdbId } }] })
}

function tvdbPageResponse(eps: { s: number; n: number }[], totalPages?: number) {
  return Response.json({
    status: "success",
    data: {
      episodes: eps.map((e) => ({
        id: e.s * 100 + e.n,
        seasonNumber: e.s,
        number: e.n,
        name: `TVDB S${e.s}E${e.n}`,
        overview: `Trama TVDB S${e.s}E${e.n}.`,
        image: `/banners/ep/${e.s}-${e.n}.jpg`,
        aired: "2020-01-01",
      })),
    },
    links: totalPages !== undefined ? { page: 0, total_pages: totalPages } : {},
  })
}

function installRouter(handler: (url: string) => Response): string[] {
  const calls: string[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    calls.push(url)
    return handler(url)
  })
  return calls
}

const metaParams = (type: string, id: string) => ({ params: Promise.resolve({ type, id }) })
const seasonCalls = (calls: string[]) => calls.filter((u) => u.includes("/season/"))

describe("partial episode integrity and short-cache", () => {
  beforeEach(() => {
    nowOffset = 0
    vi.spyOn(Date, "now").mockImplementation(() => REAL_NOW() + nowOffset)
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    clearTvdbCache()
    nowOffset = 0
  })

  describe("isSeasonEpisodesComplete guard", () => {
    it("flags null, missing and unexpectedly empty seasons as partial", () => {
      expect(isSeasonEpisodesComplete(null, 7, "2020-01-01")).toBe(false)
      expect(isSeasonEpisodesComplete(undefined, 7, "2020-01-01")).toBe(false)
      expect(isSeasonEpisodesComplete({ episodes: null }, 7, "2020-01-01")).toBe(false)
      expect(isSeasonEpisodesComplete({ episodes: [] }, 2, "2020-01-01")).toBe(false)
    })

    it("flags missing payloads with an unknown expected count as partial", () => {
      expect(isSeasonEpisodesComplete(null, undefined, "2020-01-01")).toBe(false)
      expect(isSeasonEpisodesComplete(undefined, undefined, "2020-01-01")).toBe(false)
      expect(isSeasonEpisodesComplete({ episodes: null }, undefined, "2020-01-01")).toBe(false)
      expect(isSeasonEpisodesComplete({ episodes: [] }, undefined, "2020-01-01")).toBe(false)
      expect(isSeasonEpisodesComplete(null, null, "2020-01-01")).toBe(false)
    })

    it("flags truncated lists as partial", () => {
      const season = { episodes: [{ air_date: "2020-01-01" }, { air_date: "2020-01-08" }] }
      expect(isSeasonEpisodesComplete(season, 13, "2020-01-01")).toBe(false)
    })

    it("flags truncated lists as partial even when they already contain a future episode", () => {
      const season = { episodes: [{ air_date: "2020-01-01" }, { air_date: "2099-06-01" }] }
      expect(isSeasonEpisodesComplete(season, 13, "2020-01-01")).toBe(false)
    })

    it("allows legitimately empty zero-count and future seasons", () => {
      expect(isSeasonEpisodesComplete({ episodes: [] }, 0, "2020-01-01")).toBe(true)
      expect(isSeasonEpisodesComplete(null, 0, "2020-01-01")).toBe(true)
      expect(isSeasonEpisodesComplete({ episodes: [] }, 8, "2099-01-01")).toBe(true)
      expect(isSeasonEpisodesComplete(null, 8, "2099-01-01")).toBe(true)
    })

    it("treats full-length lists with future episodes as complete", () => {
      const full = {
        episodes: [{ air_date: "2020-01-01" }, { air_date: "2099-06-01" }],
      }
      expect(isSeasonEpisodesComplete(full, 2, "2020-01-01")).toBe(true)
      expect(isSeasonEpisodesComplete({ episodes: [{ air_date: "2020-01-01" }] }, 1, "2020-01-01")).toBe(true)
    })
  })

  describe("meta short/no long-cache on TMDB season gaps", () => {
    // NOTE: distinct tmdbIds per test — the group-list cache (6h, per tvId)
    // and the TMDB LRU survive across tests in the same file.
    function metaRouter(
      tmdbId: number,
      imdb: string,
      seasons: { n: number; count: number; airDate?: string }[],
      seasonImpl: (n: number) => Response,
    ) {
      return installRouter((url) => {
        if (url.includes(`/tv/${tmdbId}?`)) {
          return tmdbDetailsResponse(tmdbId, imdb, seasons)
        }
        if (url.includes(`/tv/${tmdbId}/images`)) return Response.json({ id: tmdbId, logos: [] })
        if (url.includes(`/tv/${tmdbId}/episode_groups`)) return Response.json({ results: [] })
        if (url.includes(`/tv/${tmdbId}/season/`)) {
          const m = url.match(/\/season\/(\d+)/)
          return seasonImpl(parseInt(m![1]!, 10))
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    }

    it("null season: partial videos, short HTTP cache, no 12h freeze, clean JSON", async () => {
      const calls = metaRouter(961001, "tt9610010", [{ n: 1, count: 1 }, { n: 2, count: 1 }], (n) =>
        n === 1 ? tmdbSeasonResponse(1, 1) : new Response("Gateway Timeout", { status: 504 }),
      )
      const url = "http://localhost:3000/meta/series/tmdb:961001.json?api_key=k-partial-null"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961001.json"))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.meta.videos).toHaveLength(1)
      expect(res.headers.get("Cache-Control")).toContain("max-age=60")
      expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate")
      expect(res.headers.get("Cache-Control")).not.toContain("max-age=300")
      expect(body).not.toHaveProperty("__partial")
      const afterMiss = calls.length
      expect(afterMiss).toBeGreaterThan(0)

      // Immediate hit: no upstream work, same short header without SWR.
      const hit = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961001.json"))
      expect(hit.headers.get("Cache-Control")).toContain("max-age=60")
      expect(hit.headers.get("Cache-Control")).not.toContain("stale-while-revalidate")
      expect(calls.length).toBe(afterMiss)

      // After the 60s short TTL the entry is really gone: refetch happens.
      // No inner-cache clear: failed (504) seasons are never cached upstream.
      nowOffset += 61 * 1000
      const res2 = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961001.json"))
      expect((await res2.json()).meta.videos).toHaveLength(1)
      expect(calls.length).toBeGreaterThan(afterMiss)
      expect(seasonCalls(calls).length).toBeGreaterThan(2)
    })

    it("unexpectedly empty season: short cache and full recovery after TTL", async () => {
      let full = false
      const calls = metaRouter(961005, "tt9610050", [{ n: 1, count: 1 }, { n: 2, count: 1 }], (n) => {
        if (n === 1) return tmdbSeasonResponse(1, 1)
        return full ? tmdbSeasonResponse(2, 1) : Response.json({ id: 2, season_number: 2, episodes: [] })
      })
      const url = "http://localhost:3000/meta/series/tmdb:961005.json?api_key=k-partial-empty"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961005.json"))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.meta.videos).toHaveLength(1)
      expect(res.headers.get("Cache-Control")).toContain("max-age=60")
      expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate")
      const afterMiss = calls.length

      // Recovery: upstream now serves the missing season; after short-TTL
      // expiry the retry returns the full episode list. Partial seasons are
      // evicted from the 5-minute TMDB LRU on flagging, so no manual cache
      // clear is needed to observe the recovery.
      full = true
      nowOffset += 61 * 1000
      const res2 = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961005.json"))
      const body2 = await res2.json()
      expect(body2.meta.videos).toHaveLength(2)
      expect(calls.length).toBeGreaterThan(afterMiss)
    })

    it("truncated season: short cache and full recovery after TTL", async () => {
      let full = false
      const calls = installRouter((url) => {
        if (url.includes("/tv/961002?")) {
          return tmdbDetailsResponse(961002, "tt9610020", [{ n: 1, count: 13 }])
        }
        if (url.includes("/tv/961002/images")) return Response.json({ id: 961002, logos: [] })
        if (url.includes("/tv/961002/episode_groups")) return Response.json({ results: [] })
        if (url.includes("/tv/961002/season/1")) {
          return full ? tmdbSeasonResponse(1, 13) : tmdbSeasonResponse(1, 7)
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      const url = "http://localhost:3000/meta/series/tmdb:961002.json?api_key=k-partial-trunc"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961002.json"))
      const body = await res.json()

      expect(body.meta.videos).toHaveLength(7)
      expect(res.headers.get("Cache-Control")).toContain("max-age=60")
      expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate")
      const afterMiss = seasonCalls(calls).length
      expect(afterMiss).toBe(1)

      // Truncated entries are never long-cached: expiry really refetches and
      // serves the now-complete upstream list without any manual inner-cache
      // clear (partial seasons are evicted from the TMDB LRU on flagging).
      full = true
      nowOffset += 61 * 1000
      const res2 = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961002.json"))
      expect((await res2.json()).meta.videos).toHaveLength(13)
      expect(seasonCalls(calls).length).toBeGreaterThan(afterMiss)
    })

    it("truncated season with a future episode stays partial with a short cache", async () => {
      const calls = installRouter((url) => {
        if (url.includes("/tv/961007?")) {
          return tmdbDetailsResponse(961007, "tt9610070", [{ n: 1, count: 13 }])
        }
        if (url.includes("/tv/961007/images")) return Response.json({ id: 961007, logos: [] })
        if (url.includes("/tv/961007/episode_groups")) return Response.json({ results: [] })
        if (url.includes("/tv/961007/season/1")) {
          return tmdbSeasonResponse(1, 2, { futureLast: true })
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      const url = "http://localhost:3000/meta/series/tmdb:961007.json?api_key=k-partial-trunc-future"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961007.json"))

      // Counterexample: 2 of 13 with one future entry is still truncated.
      expect((await res.json()).meta.videos).toHaveLength(2)
      expect(res.headers.get("Cache-Control")).toContain("max-age=60")
      expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate")
      expect(calls.length).toBeGreaterThan(0)
    })

    it("complete seasons still long-cache (no refetch after 60s)", async () => {
      const calls = metaRouter(961006, "tt9610060", [{ n: 1, count: 1 }, { n: 2, count: 1 }], (n) =>
        tmdbSeasonResponse(n, 1),
      )
      const url = "http://localhost:3000/meta/series/tmdb:961006.json?api_key=k-partial-full"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961006.json"))
      const body = await res.json()

      expect(body.meta.videos).toHaveLength(2)
      expect(res.headers.get("Cache-Control")).toContain("max-age=300")
      expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate")

      nowOffset += 61 * 1000
      __clearTMDBCache()
      const res2 = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961006.json"))
      expect((await res2.json()).meta.videos).toHaveLength(2)
      // 12h entry survived: zero upstream work despite cleared TMDB cache.
      // (details + images + episode_groups + 2 seasons on the miss.)
      expect(calls.length).toBe(5)
    })

    it("zero-count and future seasons stay complete (long cache)", async () => {
      const calls = installRouter((url) => {
        if (url.includes("/tv/961003?")) {
          return tmdbDetailsResponse(961003, "tt9610030", [
            { n: 1, count: 1 },
            { n: 2, count: 0 },
            { n: 3, count: 8, airDate: "2099-01-01" },
          ])
        }
        if (url.includes("/tv/961003/images")) return Response.json({ id: 961003, logos: [] })
        if (url.includes("/tv/961003/episode_groups")) return Response.json({ results: [] })
        if (url.includes("/tv/961003/season/1")) return tmdbSeasonResponse(1, 1)
        if (url.includes("/tv/961003/season/")) {
          return Response.json({ id: 0, season_number: 0, episodes: [] })
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      const url = "http://localhost:3000/meta/series/tmdb:961003.json?api_key=k-partial-zero"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961003.json"))

      expect((await res.json()).meta.videos).toHaveLength(1)
      expect(res.headers.get("Cache-Control")).toContain("max-age=300")
      expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate")

      nowOffset += 61 * 1000
      __clearTMDBCache()
      await metaGET(new NextRequest(url), metaParams("series", "tmdb:961003.json"))
      // details + images + episode_groups + 3 seasons on the miss, then silence.
      expect(calls.length).toBe(6)
    })

    it("future episode list is not treated as truncated (long cache)", async () => {
      const calls = installRouter((url) => {
        if (url.includes("/tv/961004?")) {
          return tmdbDetailsResponse(961004, "tt9610040", [{ n: 1, count: 6 }])
        }
        if (url.includes("/tv/961004/images")) return Response.json({ id: 961004, logos: [] })
        if (url.includes("/tv/961004/episode_groups")) return Response.json({ results: [] })
        if (url.includes("/tv/961004/season/1")) return tmdbSeasonResponse(1, 6, { futureLast: true })
        throw new Error(`unexpected fetch ${url}`)
      })
      const url = "http://localhost:3000/meta/series/tmdb:961004.json?api_key=k-partial-future"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:961004.json"))

      expect((await res.json()).meta.videos).toHaveLength(6)
      expect(res.headers.get("Cache-Control")).toContain("max-age=300")
      expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate")

      nowOffset += 61 * 1000
      __clearTMDBCache()
      await metaGET(new NextRequest(url), metaParams("series", "tmdb:961004.json"))
      expect(calls.length).toBe(4)
    })
  })

  describe("TVDB pagination never poisons long-lived caches", () => {
    function tvdbRouter(pages: ({ s: number; n: number }[] | "error" | "throw")[], totalPages: number) {
      return installRouter((url) => {
        if (url.includes("/login")) return tvdbLoginResponse()
        const m = url.match(/\/episodes\/[^?]*\?page=(\d+)/)
        if (m) {
          const page = parseInt(m[1]!, 10)
          const planned = pages[page]
          if (planned === "error" || planned === undefined) {
            return new Response("TVDB error", { status: 500 })
          }
          if (planned === "throw") throw new Error("timeout")
          return tvdbPageResponse(planned, totalPages)
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    }

    it("complete multi-page result is cached (no refetch)", async () => {
      const calls = tvdbRouter(
        [
          [{ s: 1, n: 1 }],
          [{ s: 1, n: 2 }],
        ],
        2,
      )
      const first = await getTvdbEpisodesResult(75710, "ita", "tvdb-k-complete")
      expect(first.episodes).toHaveLength(2)
      expect(first.complete).toBe(true)
      const afterMiss = calls.length
      expect(afterMiss).toBeGreaterThan(0)

      const second = await getTvdbEpisodesResult(75710, "ita", "tvdb-k-complete")
      expect(second.episodes).toHaveLength(2)
      expect(second.complete).toBe(true)
      expect(calls.length).toBe(afterMiss)
    })

    it("mid-pagination error: partial preserved, flagged, never cached", async () => {
      const calls = tvdbRouter([[{ s: 1, n: 1 }], "error"], 2)
      const first = await getTvdbEpisodesResult(75711, "ita", "tvdb-k-err")
      expect(first.episodes).toHaveLength(1)
      expect(first.complete).toBe(false)
      const episodeFetches = calls.filter((u) => u.includes("/episodes/")).length

      const second = await getTvdbEpisodesResult(75711, "ita", "tvdb-k-err")
      expect(second.episodes).toHaveLength(1)
      expect(second.complete).toBe(false)
      expect(calls.filter((u) => u.includes("/episodes/")).length).toBeGreaterThan(episodeFetches)
    })

    it("mid-pagination timeout: partial preserved, flagged, never cached", async () => {
      const calls = tvdbRouter([[{ s: 1, n: 1 }], "throw"], 2)
      const first = await getTvdbEpisodesResult(75712, "ita", "tvdb-k-timeout")
      expect(first.episodes).toHaveLength(1)
      expect(first.complete).toBe(false)
      const episodeFetches = calls.filter((u) => u.includes("/episodes/")).length

      await getTvdbEpisodesResult(75712, "ita", "tvdb-k-timeout")
      expect(calls.filter((u) => u.includes("/episodes/")).length).toBeGreaterThan(episodeFetches)
    })

    it("exhausted budget: incomplete, empty, never cached", async () => {
      const calls = installRouter((url) => {
        if (url.includes("/login")) return tvdbLoginResponse()
        throw new Error(`must not paginate on an exhausted budget: ${url}`)
      })
      const past = REAL_NOW() - 1000
      const first = await getTvdbEpisodesResult(75713, "ita", "tvdb-k-budget", "default", undefined, past)
      expect(first.episodes).toEqual([])
      expect(first.complete).toBe(false)
      expect(calls.filter((u) => u.includes("/episodes/"))).toHaveLength(0)

      await getTvdbEpisodesResult(75713, "ita", "tvdb-k-budget", "default", undefined, past)
      expect(calls.filter((u) => u.includes("/login"))).toHaveLength(1)
    })

    it("page-cap with remaining pages: truncated, flagged, never cached", async () => {
      const pages = Array.from({ length: 50 }, (_, p) => [{ s: 1, n: p + 1 }])
      const calls = tvdbRouter(pages, 60)
      const first = await getTvdbEpisodesResult(75714, "ita", "tvdb-k-cap")
      expect(first.episodes).toHaveLength(50)
      expect(first.complete).toBe(false)
      const episodeFetches = calls.filter((u) => u.includes("/episodes/")).length
      expect(episodeFetches).toBe(50)

      await getTvdbEpisodesResult(75714, "ita", "tvdb-k-cap")
      expect(calls.filter((u) => u.includes("/episodes/")).length).toBeGreaterThan(episodeFetches)
    })

    it("language fallback still resolves complete", async () => {
      const calls = installRouter((url) => {
        if (url.includes("/login")) return tvdbLoginResponse()
        // NOTE: with language "default" there is no language segment in the
        // URL (/episodes/<type>?page=), only explicit languages (e.g. /ita).
        if (url.includes("/episodes/") && !url.includes("/ita")) return tvdbPageResponse([{ s: 1, n: 1 }])
        if (url.includes("/episodes/")) return new Response("nope", { status: 404 })
        throw new Error(`unexpected fetch ${url}`)
      })
      const res = await getTvdbEpisodesResult(75715, "ita", "tvdb-k-lang")
      expect(res.episodes).toHaveLength(1)
      expect(res.complete).toBe(true)
      expect(calls.length).toBeGreaterThan(0)
    })

    it("enrichment incompleteness keeps TMDB videos and reports false", async () => {
      installRouter((url) => {
        if (url.includes("/login")) return tvdbLoginResponse()
        if (url.includes("/search/remoteid/")) return tvdbSearchResponse(75716)
        const m = url.match(/\/episodes\/[^?]*\?page=(\d+)/)
        if (m) {
          if (m[1] === "0") return tvdbPageResponse([{ s: 1, n: 1 }], 2)
          return new Response("TVDB error", { status: 500 })
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      const videos: StremioVideo[] = [
        { id: "tt9610100:1:1", name: "Pilot TMDB", season: 1, episode: 1, overview: "Trama TMDB", thumbnail: "https://image.tmdb.org/t/p/w500/x.jpg" },
        { id: "tt9610100:1:2", name: "Secondo TMDB", season: 1, episode: 2, overview: "Trama TMDB 2" },
      ]
      const complete = await enrichVideosWithTvdbDetailed(videos, "tt9610100", 961010, "tvdb-k-enrich", "ita")
      expect(complete).toBe(false)
      // Matched episode enriched, unmatched TMDB video untouched.
      expect(videos[0]!.name).toBe("TVDB S1E1")
      expect(videos[1]).toMatchObject({ name: "Secondo TMDB", overview: "Trama TMDB 2" })
      expect(videos[1]!.thumbnail).toBeUndefined()
    })

    it("buildVideosFromTvdbDetailed flags truncation; legacy wrapper keeps plain array", async () => {
      installRouter((url) => {
        if (url.includes("/login")) return tvdbLoginResponse()
        if (url.includes("/search/remoteid/")) return tvdbSearchResponse(75717)
        const m = url.match(/\/episodes\/[^?]*\?page=(\d+)/)
        if (m) {
          if (m[1] === "0") return tvdbPageResponse([{ s: 1, n: 1 }], 2)
          return new Response("TVDB error", { status: 500 })
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      const detailed = await buildVideosFromTvdbDetailed("tt9610170", 961017, "tt9610170", "tvdb-k-build", "default")
      expect(detailed.videos).toHaveLength(1)
      expect(detailed.complete).toBe(false)
      // Ordering preserved (sorted S:E, stable ids).
      expect(detailed.videos[0]).toMatchObject({ id: "tt9610170:1:1", season: 1, episode: 1 })

      clearTvdbCache()
      installRouter((url) => {
        if (url.includes("/login")) return tvdbLoginResponse()
        if (url.includes("/search/remoteid/")) return tvdbSearchResponse(75717)
        if (url.includes("/episodes/")) return tvdbPageResponse([{ s: 1, n: 1 }])
        throw new Error(`unexpected fetch ${url}`)
      })
      const { buildVideosFromTvdb } = await import("@/lib/episode-ordering")
      const legacy = await buildVideosFromTvdb("tt9610170", 961017, "tt9610170", "tvdb-k-build2", "default")
      expect(legacy).toHaveLength(1)
      expect(Array.isArray(legacy)).toBe(true)
    })
  })

  describe("meta propagates TVDB incompleteness with short cache", () => {
    function metaTvdbRouter(seasonEps: { s: number; n: number }[] | null, tvdbId: number) {
      return installRouter((url) => {
        if (url.includes("/tv/962001?")) {
          return tmdbDetailsResponse(962001, "tt9620010", [{ n: 1, count: 2 }])
        }
        if (url.includes("/tv/962001/images")) return Response.json({ id: 962001, logos: [] })
        if (url.includes("/tv/962001/episode_groups")) return Response.json({ results: [] })
        if (url.includes("/tv/962001/season/1")) return tmdbSeasonResponse(1, 2)
        if (url.includes("/login")) return tvdbLoginResponse()
        if (url.includes("/search/remoteid/")) return tvdbSearchResponse(tvdbId)
        const m = url.match(/\/episodes\/[^?]*\?page=(\d+)/)
        if (m) {
          if (m[1] === "0") {
            return tvdbPageResponse(seasonEps ?? [{ s: 1, n: 1 }], 2)
          }
          return new Response("TVDB error", { status: 500 })
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    }

    it("interrupted TVDB enrichment: TMDB videos served, short internal and HTTP cache", async () => {
      const calls = metaTvdbRouter([{ s: 1, n: 1 }], 75720)
      const url = "http://localhost:3000/meta/series/tmdb:962001.json?api_key=k-tvdb&tvdb_key=tvdb-partial"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:962001.json"))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.meta.videos).toHaveLength(2)
      // Enriched where TVDB answered, TMDB intact elsewhere.
      expect(body.meta.videos[0].name).toBe("TVDB S1E1")
      expect(body.meta.videos[1].name).toBe("Ep 2")
      expect(res.headers.get("Cache-Control")).toContain("max-age=60")
      const afterMiss = calls.length

      nowOffset += 61 * 1000
      __clearTMDBCache()
      clearTvdbCache()
      await metaGET(new NextRequest(url), metaParams("series", "tmdb:962001.json"))
      expect(calls.length).toBeGreaterThan(afterMiss)
    })

    it("interrupted explicit TVDB ordering: partial videos flagged up to meta with short cache", async () => {
      mockedGetById.mockResolvedValue({ episodeGroupId: "tvdb" } as unknown as Awaited<ReturnType<typeof getById>>)
      const calls = metaTvdbRouter([{ s: 1, n: 1 }], 75721)
      const url = "http://localhost:3000/meta/series/tmdb:962001.json?api_key=k-tvdb-ord&tvdb_key=tvdb-partial-ord"
      const res = await metaGET(new NextRequest(url), metaParams("series", "tmdb:962001.json"))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.meta.videos).toHaveLength(1)
      expect(body.meta.videos[0]).toMatchObject({ season: 1, episode: 1 })
      expect(res.headers.get("Cache-Control")).toContain("max-age=60")
      const afterMiss = calls.length

      nowOffset += 61 * 1000
      __clearTMDBCache()
      clearTvdbCache()
      await metaGET(new NextRequest(url), metaParams("series", "tmdb:962001.json"))
      expect(calls.length).toBeGreaterThan(afterMiss)
    })
  })

  describe("preview short/no long-cache on season gaps", () => {
    function previewRouter(seasonImpl: (n: number) => Response) {
      return installRouter((url) => {
        if (url.includes("/tv/963001?")) {
          return Response.json({
            id: 963001,
            name: "Preview Partial",
            external_ids: { imdb_id: "tt9630010" },
            seasons: [
              { season_number: 1, episode_count: 1, name: "Stagione 1" },
              { season_number: 2, episode_count: 1, name: "Stagione 2" },
            ],
          })
        }
        if (url.includes("/tv/963001/episode_groups")) return Response.json({ results: [] })
        if (url.includes("/tv/963001/season/")) {
          const m = url.match(/\/season\/(\d+)/)
          return seasonImpl(parseInt(m![1]!, 10))
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    }

    it("null season: short HTTP cache on miss and hit, real 30s expiry, recovery", async () => {
      let full = false
      const calls = previewRouter((n) => {
        if (n === 1) return tmdbSeasonResponse(1, 1)
        return full ? tmdbSeasonResponse(2, 1) : new Response("Gateway Timeout", { status: 504 })
      })
      const url = "http://localhost:3000/api/preview/episodes?tmdbId=963001&api_key=k-prev-null"
      const res = await previewGET(new NextRequest(url))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.videos).toHaveLength(1)
      expect(res.headers.get("Cache-Control")).toContain("max-age=30")
      expect(res.headers.get("Cache-Control")).not.toContain("stale-while-revalidate")
      const afterMiss = calls.length

      // Hit path keeps the short downstream TTL (never extended to 60s).
      const hit = await previewGET(new NextRequest(url))
      expect((await hit.json()).videos).toHaveLength(1)
      expect(hit.headers.get("Cache-Control")).toContain("max-age=30")
      expect(hit.headers.get("Cache-Control")).not.toContain("stale-while-revalidate")
      expect(calls.length).toBe(afterMiss)

      // After the 30s TTL the entry is really gone and recovery is served.
      full = true
      nowOffset += 31 * 1000
      const res2 = await previewGET(new NextRequest(url))
      expect((await res2.json()).videos).toHaveLength(2)
      expect(calls.length).toBeGreaterThan(afterMiss)
    })

    it("complete preview still long-caches with 60s HTTP cache", async () => {
      const calls = previewRouter((n) => tmdbSeasonResponse(n, 1))
      const url = "http://localhost:3000/api/preview/episodes?tmdbId=963001&api_key=k-prev-full"
      const res = await previewGET(new NextRequest(url))

      expect((await res.json()).videos).toHaveLength(2)
      expect(res.headers.get("Cache-Control")).toContain("max-age=60")
      expect(res.headers.get("Cache-Control")).not.toContain("max-age=30")
      expect(res.headers.get("Cache-Control")).toContain("stale-while-revalidate")

      nowOffset += 31 * 1000
      __clearTMDBCache()
      const res2 = await previewGET(new NextRequest(url))
      expect((await res2.json()).videos).toHaveLength(2)
      expect(res2.headers.get("Cache-Control")).toContain("max-age=60")
      expect(res2.headers.get("Cache-Control")).toContain("stale-while-revalidate")
      expect(seasonCalls(calls).length).toBe(2)
    })
  })
})
