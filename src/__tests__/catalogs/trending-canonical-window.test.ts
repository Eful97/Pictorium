// Canonical-window coherence: Cataloghi UI (/api/tmdb/trending) vs Stremio
// catalogs (pictorium-jw-*) for the GENERAL JustWatch series chart.
//
// USER REPRO (Lupin FIRST client vs 12th Stremio, Italy fixture): the UI read
// a rolling live ranking while Stremio served the published chart-generation
// pin/canonical window, so order + membership + badge rank diverged across
// generation boundaries/JW updates. Fix: the trending route pins the SAME
// families (jw:movie|series:{charts,popular,trending}) BEFORE the route-cache
// lookup and keys payloads on the actual pinned generation (gen fence); a
// genuine published EMPTY serves [] with NO live fallback (no resurrection);
// only a cold miss (no snapshot) falls back to live per historic contract.
//
// These tests use the ACTUAL route + the ACTUAL shared ranking service with
// fetch-level JW/TMDB mocks (Italy fixture, country=IT) — never a mocked
// shared function returning the same fixture twice.
import { afterEach, describe, expect, it, vi } from "vitest"
import { gunzipSync } from "node:zlib"
import { NextRequest } from "next/server"
import { GET as trendingGET } from "@/app/api/tmdb/trending/route"
import { GET as catalogGET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
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

const LUPIN = 9001
// Lupin 12th (published) vs Lupin 1st (live drift).
const OTHERS = Array.from({ length: 19 }, (_, i) => 9002 + i)
const PHASE_A = [...OTHERS.slice(0, 11), LUPIN, ...OTHERS.slice(11)]
const PHASE_B = [LUPIN, ...OTHERS]
// Popular-titles mode fixtures (series slot) + custom list fixtures.
const POPULAR_SHOWS = [9101, 9102, 9103]
const CUSTOM_MOVIES = [9201, 9202]

function customRows() {
  return CUSTOM_MOVIES.map((tmdbId, i) => ({
    tmdb_id: tmdbId,
    title: `Custom ${tmdbId}`,
    year: 2024,
    imdb_id: `tt1000${i}`,
  }))
}

let liveOrder: number[] = PHASE_A
let chartsCalls = 0

function chartsBody(ids: number[]) {
  return {
    data: {
      streamingCharts: {
        edges: ids.map((tmdbId, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: { content: { title: tmdbId === LUPIN ? "Lupin" : `Show ${tmdbId}`, externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
        })),
      },
    },
  }
}

function titlesBody(ids: number[]) {
  return {
    data: {
      popularTitles: {
        edges: ids.map((tmdbId) => ({
          node: {
            objectType: "SHOW",
            content: { title: `Popular ${tmdbId}`, originalReleaseDate: "2024-01-01", externalIds: { tmdbId, imdbId: `tt${tmdbId}` } },
          },
        })),
      },
    },
  }
}

function installFetch() {
  chartsCalls = 0
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: unknown }).url ?? input)
    if (url.includes("mdblist.com")) return Promise.resolve(Response.json(customRows()))
    if (url.includes("apis.justwatch.com")) {
      const parsed = JSON.parse(String((init as { body?: unknown })?.body ?? "{}"))
      if (parsed?.operationName === "GetPopularTitles") {
        chartsCalls += 1
        return Promise.resolve(Response.json(titlesBody(POPULAR_SHOWS)))
      }
      chartsCalls += 1
      return Promise.resolve(Response.json(chartsBody(liveOrder)))
    }
    if (url.includes("api.themoviedb.org")) {
      const m = /\/3\/(movie|tv)\/(\d+)/.exec(url)
      if (!m) throw new Error(`unexpected tmdb url ${url}`)
      const id = Number(m[2])
      if (url.includes("/images")) return Promise.resolve(Response.json({ posters: [], backdrops: [], logos: [] }))
      return Promise.resolve(Response.json({
        id,
        title: `Movie ${id}`,
        name: id === LUPIN ? "Lupin" : `Show ${id}`,
        poster_path: "/p.jpg",
        release_date: "2024-01-01",
        first_air_date: "2024-01-01",
        genres: [],
        vote_average: 7.5,
      }))
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch)
}

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`)
}

function catalogParams(id: string) {
  return { params: Promise.resolve({ type: "series", id }) }
}

async function readJson(res: Response): Promise<{ movies: Array<{ id: number; rank: number }>; tv: Array<{ id: number; rank: number }>; metas?: Array<{ poster: string }> }> {
  const buf = Buffer.from(await res.arrayBuffer())
  const enc = res.headers.get("content-encoding") || ""
  const text = enc.includes("gzip") ? gunzipSync(buf).toString("utf-8") : buf.toString("utf-8")
  return JSON.parse(text)
}

interface CatalogMeta {
  poster: string
}

function posterRank(posterUrl: string): number | null {
  const rk = new URL(posterUrl).searchParams.get("rk")
  return rk === null ? null : Number(rk)
}

function posterTmdbId(posterUrl: string): number {
  const m = /\/api\/poster\/(?:movie|series)\/(\d+)/.exec(posterUrl)
  if (!m) throw new Error(`unparseable poster url ${posterUrl}`)
  return Number(m[1])
}

function resetRankState() {
  __resetJWRankingsCache()
  __clearTMDBCache()
  __resetChartGenerationForTest()
  cacheClear()
}

describe("trending canonical window (Lupin series, IT fixture)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    mockedUserDefaults.mockReset()
    mockedUserDefaults.mockResolvedValue({})
    resetRankState()
    liveOrder = PHASE_A
  })

  it("UI and Stremio serve the SAME pinned order+rank (live drift does not leak into the UI)", async () => {
    installFetch()
    liveOrder = PHASE_A

    // Stremio catalog publishes the canonical window (Lupin 12th).
    const cat = await catalogGET(req("/catalog/series/pictorium-jw-series.json?api_key=testkey"), catalogParams("pictorium-jw-series.json"))
    expect(cat.status).toBe(200)
    const catBody = await readJson(cat)
    expect(catBody.metas).toHaveLength(20)
    const catIds = (catBody.metas as CatalogMeta[]).map((m) => posterTmdbId(m.poster))
    expect(catIds).toEqual(PHASE_A)
    const catLupin = (catBody.metas as CatalogMeta[]).find((m) => posterTmdbId(m.poster) === LUPIN)
    expect(posterRank((catLupin as CatalogMeta).poster)).toBe(12)

    // Live JW drifts (Lupin jumps 1st) AFTER the publish. Drop the rolling
    // JW cache so the drift is observable (in production it arrives via
    // TTL/slot expiry): the UI must STILL serve the pinned generation.
    liveOrder = PHASE_B
    __resetJWRankingsCache()

    // The UI must still serve the pinned generation — identical to Stremio.
    const ui = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    expect(ui.status).toBe(200)
    const uiBody = await readJson(ui)
    expect(uiBody.tv.map((t) => t.id)).toEqual(PHASE_A)
    expect(uiBody.tv.find((t) => t.id === LUPIN)?.rank).toBe(12)
    // Order AND membership identity: same first-20 ids, same Lupin rank.
    expect(uiBody.tv.map((t) => t.id)).toEqual(catIds)
  })

  it("a new generation replaces the old cached UI body (fence, no stale serve)", async () => {
    installFetch()
    liveOrder = PHASE_A
    const first = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    expect((await readJson(first)).tv.map((t) => t.id)).toEqual(PHASE_A)

    // Cross the slot boundary (Europe/Rome 00/12): the old cached body must
    // not serve past the publish. Fake timers control the explicit endpoint
    // budgets by design; mocked transports resolve via microtasks.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + 13 * 3600 * 1000)
      liveOrder = PHASE_B
      __resetJWRankingsCache()

      const second = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
      const secondBody = await readJson(second)
      expect(secondBody.tv.map((t) => t.id)).toEqual(PHASE_B)
      expect(secondBody.tv[0].id).toBe(LUPIN)
      expect(secondBody.tv[0].rank).toBe(1)

      // Stremio converges on the same new rows (no stale JW rank).
      const cat = await catalogGET(req("/catalog/series/pictorium-jw-series.json?api_key=testkey"), catalogParams("pictorium-jw-series.json"))
      const catBody = await readJson(cat)
      expect((catBody.metas as CatalogMeta[]).map((m) => posterTmdbId(m.poster))).toEqual(PHASE_B)
      const catLupin = (catBody.metas as CatalogMeta[]).find((m) => posterTmdbId(m.poster) === LUPIN)
      expect(posterRank((catLupin as CatalogMeta).poster)).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("published empty serves [] on both sides with no live resurrection", async () => {
    installFetch()
    liveOrder = []
    const callsBefore = chartsCalls
    const ui = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    expect(ui.status).toBe(200)
    expect((await readJson(ui)).tv).toEqual([])
    const publishedCalls = chartsCalls - callsBefore
    expect(publishedCalls).toBeGreaterThan(0)

    // Live data arrives AFTER the empty publish: both sides stay empty.
    liveOrder = PHASE_B
    const ui2 = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    expect((await readJson(ui2)).tv).toEqual([])
    const cat = await catalogGET(req("/catalog/series/pictorium-jw-series.json?api_key=testkey"), catalogParams("pictorium-jw-series.json"))
    expect((await readJson(cat)).metas).toEqual([])
    // No live refetch loop: pinned empty is served, not refetched.
    expect(chartsCalls - callsBefore).toBe(publishedCalls)
  })

  it("mode charts<->popular and custom<->JW roundtrip identically on both sides", async () => {
    installFetch()

    // Popular series: both sides serve the popular window (Lupin-free).
    // NOTE: catalog user ids must be UUIDs (catalog-epoch guard); the
    // trending route accepts the same `u=` for selection parity.
    const UID = "11111111-1111-4111-8111-111111111111"
    mockedUserDefaults.mockResolvedValue({ rankingSourceSeries: "jw:popular" })
    const uiPop = await trendingGET(req(`/api/tmdb/trending?country=IT&api_key=testkey&u=${UID}`))
    const uiPopBody = await readJson(uiPop)
    expect(uiPopBody.tv.map((t) => t.id)).toEqual(POPULAR_SHOWS)
    expect(uiPopBody.tv.map((t) => t.rank)).toEqual([1, 2, 3])
    const catPop = await catalogGET(req(`/catalog/series/pictorium-jw-series.json?api_key=testkey&u=${UID}`), catalogParams("pictorium-jw-series.json"))
    const catPopBody = await readJson(catPop)
    expect((catPopBody.metas as CatalogMeta[]).map((m) => posterTmdbId(m.poster))).toEqual(POPULAR_SHOWS)

    // Back to charts: both sides converge on the pinned charts window.
    mockedUserDefaults.mockResolvedValue({})
    resetRankState()
    liveOrder = PHASE_B
    const uiCharts = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    expect((await readJson(uiCharts)).tv.map((t) => t.id)).toEqual(PHASE_B)
    const catCharts = await catalogGET(req("/catalog/series/pictorium-jw-series.json?api_key=testkey"), catalogParams("pictorium-jw-series.json"))
    expect(((await readJson(catCharts)).metas as CatalogMeta[]).map((m) => posterTmdbId(m.poster))).toEqual(PHASE_B)

    // Custom movie list replaces JW; back to "" restores JW identically.
    const MOVIE_CUSTOM = { id: "lupin-custom", name: "Lupin Custom", type: "movie" as const, url: "https://mdblist.com/lists/u/lupin-custom" }
    mockedUserDefaults.mockResolvedValue({ customCatalogs: [MOVIE_CUSTOM], rankingSourceMovie: "lupin-custom" })
    const uiCustom = await trendingGET(req(`/api/tmdb/trending?country=IT&api_key=testkey&u=${UID}`))
    expect((await readJson(uiCustom)).movies.map((t) => t.id)).toEqual(CUSTOM_MOVIES)
    const catCustom = await catalogGET(req(`/catalog/movie/pictorium-jw-movies.json?api_key=testkey&u=${UID}`), {
      params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }),
    })
    expect(((await readJson(catCustom)).metas as CatalogMeta[]).map((m) => posterTmdbId(m.poster))).toEqual(CUSTOM_MOVIES)

    mockedUserDefaults.mockResolvedValue({})
    resetRankState()
    liveOrder = PHASE_A
    const uiBack = await trendingGET(req("/api/tmdb/trending?country=IT&api_key=testkey"))
    expect((await readJson(uiBack)).tv.map((t) => t.id)).toEqual(PHASE_A)
  })
})
