/**
 * T1 shared backend contract — last successful PUBLICATION timestamps.
 *
 * Contract (documented in .agents/catalog.md, T2 formats it in the UI):
 * - `updatedAt` (ms epoch) = snapshot.publishedAt of the SAME snapshot the
 *   rows come from — Pictorium's publication, NOT the source's update time
 *   (e.g. NOT the fp-crawler chart-date), NOT the request/page time.
 * - `/api/tmdb/trending`: per-slot `{ movie, series }` (null with no genuine
 *   pin: custom/unsupported/cold); `/api/streaming-catalog`: single
 *   `updatedAt` (null with no genuine pin); `/api/mdblist/anime`: per-slot
 *   `X-Pictorium-Updated-At-Movie|-Series` headers plus the combined
 *   `X-Pictorium-Updated-At` (body stays array-shaped; each absent with no
 *   genuine pin for that slot).
 * - Cache hits do NOT retimestamp; outage retention keeps the OLD stamp; an
 *   actual empty publish carries its NEW stamp; unknown legacy/custom never
 *   mint a fake timestamp; no extra TMDB/JW fetch exists for metadata (it
 *   rides the already-pinned snapshot).
 *
 * These tests use the ACTUAL routes with fetch-level mocks — never a mocked
 * shared function.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { gunzipSync } from "node:zlib"
import { NextRequest } from "next/server"
import { GET as trendingGET } from "@/app/api/tmdb/trending/route"
import { GET as browseGET } from "@/app/api/streaming-catalog/route"
import { GET as animeGET } from "@/app/api/mdblist/anime/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache, __resetKey401Cache } from "@/lib/tmdb"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"

vi.mock("@/lib/store", () => ({
  getById: vi.fn().mockResolvedValue(null),
  getAll: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({})),
    getServerDefaultsChecked: vi.fn(async () => ({})),
    getServerDefaultsForUser: vi.fn(async () => ({})),
  }
})

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-auth")>()
  return {
    ...mod,
    getScopedUserId: vi.fn((raw: string | null | undefined) => raw ?? null),
    userExists: vi.fn(async () => true),
  }
})

import { getServerDefaultsForUser } from "@/lib/server-defaults"

const mockedUserDefaults = vi.mocked(getServerDefaultsForUser)

const SHOWS_A = [9001, 9002, 9003]

function chartsBody(ids: number[]) {
  return {
    data: {
      streamingCharts: {
        edges: ids.map((tmdbId, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: { content: { title: `Show ${tmdbId}`, externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
        })),
      },
    },
  }
}

let liveIds = SHOWS_A
let jwCalls = 0
let tmdbCalls = 0
let mdblistCalls = 0
let jwFail = false
let mdblistFail = false

function animeRows() {
  return [
    { imdb: "tt8000001", title: "Anime One", year: 2024, tmdb: 7001 },
    { imdb: "tt8000002", title: "Anime Two", year: 2024, tmdb: 7002 },
  ]
}

function customRows() {
  return [
    { tmdb_id: 9101, title: "Custom One", year: 2024, imdb_id: "tt0000101" },
    { tmdb_id: 9102, title: "Custom Two", year: 2024, imdb_id: "tt0000102" },
  ]
}

function installFetch() {
  jwCalls = 0
  tmdbCalls = 0
  mdblistCalls = 0
  jwFail = false
  mdblistFail = false
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: unknown }).url ?? input)
    if (url.includes("mdblist.com")) {
      mdblistCalls += 1
      if (mdblistFail) return Promise.reject(new Error("mdblist down"))
      if (url.includes("lupin-custom")) return Promise.resolve(Response.json(customRows()))
      return Promise.resolve(Response.json(animeRows()))
    }
    if (url.includes("apis.justwatch.com")) {
      jwCalls += 1
      if (jwFail) return Promise.resolve(new Response("boom", { status: 500 }))
      // Popular-titles window (popular/trending modes + top20 adapter).
      const parsed = JSON.parse(String((init as { body?: unknown })?.body ?? "{}"))
      if (parsed?.operationName === "GetPopularTitles") {
        return Promise.resolve(Response.json({
          data: {
            popularTitles: {
              edges: liveIds.map((tmdbId) => ({
                node: {
                  objectType: "SHOW",
                  content: { title: `Show ${tmdbId}`, originalReleaseDate: "2024-01-01", externalIds: { tmdbId, imdbId: `tt${tmdbId}` } },
                },
              })),
            },
          },
        }))
      }
      return Promise.resolve(Response.json(chartsBody(liveIds)))
    }
    if (url.includes("api.themoviedb.org")) {
      tmdbCalls += 1
      const m = /\/3\/(movie|tv)\/(\d+)/.exec(url)
      if (!m) throw new Error(`unexpected tmdb url ${url}`)
      const id = Number(m[2])
      if (url.includes("/images")) return Promise.resolve(Response.json({ posters: [], backdrops: [], logos: [] }))
      if (url.includes("/external_ids")) return Promise.resolve(Response.json({ imdb_id: `tt${id}` }))
      const isMovie = m[1] === "movie"
      return Promise.resolve(Response.json({
        id,
        title: isMovie ? `Movie ${id}` : undefined,
        name: isMovie ? undefined : `Show ${id}`,
        poster_path: "/p.jpg",
        release_date: "2024-01-01",
        first_air_date: "2024-01-01",
        genres: [],
        vote_average: 7.5,
      }))
    }
    // fp-crawler + anything else: transport failure (forces JW fallback paths).
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch)
}

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`)
}

async function readJson(res: Response): Promise<TrendingBody & BrowseBody & { metas?: CatalogMeta[] }> {
  const buf = Buffer.from(await res.arrayBuffer())
  const enc = res.headers.get("content-encoding") || ""
  const text = enc.includes("gzip") ? gunzipSync(buf).toString("utf-8") : buf.toString("utf-8")
  return JSON.parse(text)
}

interface TrendingItem {
  id: number
  rank: number
}

interface TrendingBody {
  movies: TrendingItem[]
  tv: TrendingItem[]
  degraded?: boolean
  updatedAt?: { movie: number | null; series: number | null } | null
}

interface BrowseItem {
  tmdbId: number
}

interface BrowseBody {
  items: BrowseItem[]
  updatedAt?: number | null
}

interface CatalogMeta {
  poster: string
}

function resetAll() {
  __resetJWRankingsCache()
  __clearTMDBCache()
  __resetKey401Cache()
  __resetChartGenerationForTest()
  cacheClear()
  liveIds = SHOWS_A
}

describe("publication metadata (updatedAt)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockedUserDefaults.mockReset()
    mockedUserDefaults.mockResolvedValue({})
    resetAll()
  })

  it("trending exposes per-slot updatedAt from the pinned snapshot, stable on cache hits", async () => {
    installFetch()
    const first = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    expect(first.status).toBe(200)
    const b1 = await readJson(first)
    expect(typeof b1.updatedAt?.movie).toBe("number")
    expect(typeof b1.updatedAt?.series).toBe("number")
    expect((b1.updatedAt?.movie ?? 0)).toBeGreaterThan(0)
    expect((b1.updatedAt?.series ?? 0)).toBeGreaterThan(0)
    const jwAfterMiss = jwCalls
    const tmdbAfterMiss = tmdbCalls
    expect(jwAfterMiss).toBeGreaterThan(0)

    // Cache hit: identical rows AND identical stamps, zero new upstream.
    const second = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    const b2 = await readJson(second)
    expect(b2.updatedAt).toEqual(b1.updatedAt)
    expect(b2.tv.map((t) => t.id)).toEqual(b1.tv.map((t) => t.id))
    expect(jwCalls).toBe(jwAfterMiss)
    expect(tmdbCalls).toBe(tmdbAfterMiss)
  })

  it("trending outage retention keeps the old stamp (no retimestamp, no fake fresh)", async () => {
    installFetch()
    const first = await readJson(await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey")))
    const stamp = first.updatedAt?.series
    expect(typeof stamp).toBe("number")

    // Cross into the NEXT JW slot, then fail upstream: the refresh is really
    // attempted (fetch count grows) and fails, so the last good snapshot keeps
    // serving with its ORIGINAL publication stamp — never Date.now().
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 13 * 3600 * 1000)
      jwFail = true
      const callsBefore = jwCalls
      const degraded = await readJson(await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey")))
      expect(jwCalls).toBeGreaterThan(callsBefore)
      expect(degraded.tv.map((t) => t.id)).toEqual(first.tv.map((t) => t.id))
      expect(degraded.updatedAt?.series).toBe(stamp)
    } finally {
      vi.useRealTimers()
    }
  })

  it("trending genuine empty publish carries a new stamp (never a resurrected old one)", async () => {
    installFetch()
    const first = await readJson(await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey")))
    const oldStamp = first.updatedAt?.series
    expect(typeof oldStamp).toBe("number")

    // Next slot with genuinely empty upstream: a NEW empty snapshot publishes
    // (new stamp, strictly newer), served on both sides with no resurrection
    // of the old rows on any later read.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 13 * 3600 * 1000)
      liveIds = []
      const empty = await readJson(await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey")))
      expect(empty.tv).toEqual([])
      expect(typeof empty.updatedAt?.series).toBe("number")
      expect((empty.updatedAt?.series ?? 0)).toBeGreaterThan(oldStamp ?? 0)
      const ui2 = await readJson(await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey")))
      expect(ui2.tv).toEqual([])
      expect(ui2.updatedAt?.series).toBe(empty.updatedAt?.series)
    } finally {
      vi.useRealTimers()
    }
  })

  it("trending custom slots report null (unknown legacy/custom never minted)", async () => {
    installFetch()
    const UID = "11111111-1111-4111-8111-111111111111"
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [{ id: "lupin-custom", name: "Lupin Custom", type: "movie" as const, url: "https://mdblist.com/lists/u/lupin-custom" }],
      rankingSourceMovie: "lupin-custom",
    })
    const res = await trendingGET(req(`/api/tmdb/trending?country=IT&api_key=testkey&u=${UID}`))
    const body = await readJson(res)
    expect(body.movies.map((t) => t.id)).toEqual([9101, 9102])
    expect(body.updatedAt?.movie).toBeNull()
    // The JW series slot keeps its genuine stamp in the same response.
    expect(typeof body.updatedAt?.series).toBe("number")
  })

  it("browse exposes the pinned snapshot stamp; hits do not retimestamp", async () => {
    installFetch()
    const url = "/api/streaming-catalog?catalog=pictorium-stream-netflix-it-movies&api_key=testkey"
    const first = await browseGET(req(url))
    expect(first.status).toBe(200)
    const b1 = await readJson(first)
    expect(b1.items.length).toBeGreaterThan(0)
    expect(typeof b1.updatedAt).toBe("number")
    expect(b1.updatedAt).toBeGreaterThan(0)
    const tmdbAfterMiss = tmdbCalls

    const second = await browseGET(req(url))
    const b2 = await readJson(second)
    expect(b2.updatedAt).toBe(b1.updatedAt)
    expect(b2.items.map((t) => t.tmdbId)).toEqual(b1.items.map((t) => t.tmdbId))
    // No extra TMDB/JW fetch exists for metadata: same transport, zero refetch.
    expect(tmdbCalls).toBe(tmdbAfterMiss)
  })

  it("anime exposes per-slot stamps as headers (body stays array-shaped); cold failure sends none", async () => {
    installFetch()
    // Publish the two anime slots at DIFFERENT instants so per-slot headers
    // must differ (a single combined min would hide a stale half).
    vi.useFakeTimers()
    try {
      const T1 = Date.parse("2026-10-22T08:00:00Z")
      vi.setSystemTime(T1)
      const resMovie = await animeGET(req("/api/mdblist/anime?mdblist_key=k&api_key=testkey&type=movie"))
      expect(resMovie.status).toBe(200)
      const stampMovie = resMovie.headers.get("X-Pictorium-Updated-At-Movie")
      expect(stampMovie).not.toBeNull()
      expect(Number(stampMovie)).toBeGreaterThan(0)
      // Single-slot request: no series header, combined == movie stamp.
      expect(resMovie.headers.get("X-Pictorium-Updated-At-Series")).toBeNull()
      expect(resMovie.headers.get("X-Pictorium-Updated-At")).toBe(stampMovie)
      const bodyMovie = await resMovie.json()
      expect(Array.isArray(bodyMovie)).toBe(true)
      expect(bodyMovie).toHaveLength(2)

      vi.setSystemTime(T1 + 60_000)
      const resSeries = await animeGET(req("/api/mdblist/anime?mdblist_key=k&api_key=testkey&type=tv"))
      const stampSeries = resSeries.headers.get("X-Pictorium-Updated-At-Series")
      expect(stampSeries).not.toBeNull()
      expect(Number(stampSeries)).toBeGreaterThan(Number(stampMovie))
      expect(resSeries.headers.get("X-Pictorium-Updated-At-Movie")).toBeNull()
      expect(resSeries.headers.get("X-Pictorium-Updated-At")).toBe(stampSeries)

      // Both slots: each header matches its OWN slot, combined is the min.
      const resAll = await animeGET(req("/api/mdblist/anime?mdblist_key=k&api_key=testkey"))
      expect(resAll.headers.get("X-Pictorium-Updated-At-Movie")).toBe(stampMovie)
      expect(resAll.headers.get("X-Pictorium-Updated-At-Series")).toBe(stampSeries)
      expect(resAll.headers.get("X-Pictorium-Updated-At")).toBe(stampMovie)
      const bodyAll = await resAll.json()
      expect(Array.isArray(bodyAll)).toBe(true)

      // Outage retention keeps serving rows; failure path sends no stamps.
      mdblistFail = true
      __resetChartGenerationForTest()
      cacheClear()
      const resFail = await animeGET(req("/api/mdblist/anime?mdblist_key=k&api_key=testkey&type=movie"))
      const failBody = await resFail.json()
      expect(failBody).toEqual([])
      expect(resFail.headers.get("X-Pictorium-Updated-At-Movie")).toBeNull()
      expect(resFail.headers.get("X-Pictorium-Updated-At")).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("anime cache hits repeat the SAME publication headers (never drop, never retimestamp)", async () => {
    installFetch()
    const movieUrl = "/api/mdblist/anime?mdblist_key=k&api_key=testkey&type=movie"
    const firstMovie = await animeGET(req(movieUrl))
    expect(firstMovie.status).toBe(200)
    const stampMovie = firstMovie.headers.get("X-Pictorium-Updated-At-Movie")
    expect(stampMovie).not.toBeNull()
    expect(Number(stampMovie)).toBeGreaterThan(0)
    // Single-slot request: no series header, combined == movie stamp.
    expect(firstMovie.headers.get("X-Pictorium-Updated-At-Series")).toBeNull()
    expect(firstMovie.headers.get("X-Pictorium-Updated-At")).toBe(stampMovie)
    const bodyMovie1 = await firstMovie.json()
    expect(bodyMovie1).toHaveLength(2)
    const tmdbAfterMiss = tmdbCalls
    const mdblistAfterMiss = mdblistCalls

    // SAME movie request again: the enriched-body cache hit must carry the
    // identical headers (same snapshot publication, never request time) with
    // zero new upstream I/O.
    const secondMovie = await animeGET(req(movieUrl))
    expect(secondMovie.headers.get("X-Pictorium-Updated-At-Movie")).toBe(stampMovie)
    expect(secondMovie.headers.get("X-Pictorium-Updated-At-Series")).toBeNull()
    expect(secondMovie.headers.get("X-Pictorium-Updated-At")).toBe(stampMovie)
    expect(await secondMovie.json()).toEqual(bodyMovie1)
    expect(tmdbCalls).toBe(tmdbAfterMiss)
    expect(mdblistCalls).toBe(mdblistAfterMiss)

    // SAME series request twice: own slot stamp, no movie header.
    const seriesUrl = "/api/mdblist/anime?mdblist_key=k&api_key=testkey&type=tv"
    const firstSeries = await animeGET(req(seriesUrl))
    const stampSeries = firstSeries.headers.get("X-Pictorium-Updated-At-Series")
    expect(stampSeries).not.toBeNull()
    expect(Number(stampSeries)).toBeGreaterThan(0)
    expect(firstSeries.headers.get("X-Pictorium-Updated-At-Movie")).toBeNull()
    expect(firstSeries.headers.get("X-Pictorium-Updated-At")).toBe(stampSeries)
    const bodySeries1 = await firstSeries.json()
    const tmdbAfterSeries = tmdbCalls
    const mdblistAfterSeries = mdblistCalls

    const secondSeries = await animeGET(req(seriesUrl))
    expect(secondSeries.headers.get("X-Pictorium-Updated-At-Series")).toBe(stampSeries)
    expect(secondSeries.headers.get("X-Pictorium-Updated-At-Movie")).toBeNull()
    expect(secondSeries.headers.get("X-Pictorium-Updated-At")).toBe(stampSeries)
    expect(await secondSeries.json()).toEqual(bodySeries1)
    expect(tmdbCalls).toBe(tmdbAfterSeries)
    expect(mdblistCalls).toBe(mdblistAfterSeries)

    // SAME combined request twice: each header is its OWN slot publication,
    // combined is the min, body order identical, still zero new upstream.
    const allUrl = "/api/mdblist/anime?mdblist_key=k&api_key=testkey"
    const firstAll = await animeGET(req(allUrl))
    expect(firstAll.headers.get("X-Pictorium-Updated-At-Movie")).toBe(stampMovie)
    expect(firstAll.headers.get("X-Pictorium-Updated-At-Series")).toBe(stampSeries)
    expect(firstAll.headers.get("X-Pictorium-Updated-At")).toBe(
      String(Math.min(Number(stampMovie), Number(stampSeries))),
    )
    const bodyAll1 = await firstAll.json()
    expect(Array.isArray(bodyAll1)).toBe(true)
    const tmdbAfterAll = tmdbCalls
    const mdblistAfterAll = mdblistCalls

    const secondAll = await animeGET(req(allUrl))
    expect(secondAll.headers.get("X-Pictorium-Updated-At-Movie")).toBe(stampMovie)
    expect(secondAll.headers.get("X-Pictorium-Updated-At-Series")).toBe(stampSeries)
    expect(secondAll.headers.get("X-Pictorium-Updated-At")).toBe(
      String(Math.min(Number(stampMovie), Number(stampSeries))),
    )
    expect(await secondAll.json()).toEqual(bodyAll1)
    expect(tmdbCalls).toBe(tmdbAfterAll)
    expect(mdblistCalls).toBe(mdblistAfterAll)
  })
})
