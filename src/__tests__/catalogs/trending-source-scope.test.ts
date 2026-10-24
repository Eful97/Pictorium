import { afterEach, describe, expect, it, vi } from "vitest"
import { gunzipSync } from "node:zlib"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/tmdb/trending/route"
import { fetchTop20Ranking } from "@/lib/top20-ranking"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache, __resetKey401Cache } from "@/lib/tmdb"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"

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

// Disjoint fixtures per source: a Charts row must never equal a Popular /
// Trending / custom row, so a stale-source response is observable by id.
const CHART_MOVIES = [101, 102]
const CHART_SHOWS = [201, 202]
const POPULAR_MOVIES = [111, 112]
const TRENDING_SHOWS = [211, 212]
const CUSTOM_MOVIES = [301, 302]

function chartsBody(ids: number[]) {
  return {
    data: {
      streamingCharts: {
        edges: ids.map((tmdbId, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: { content: { title: `Chart ${tmdbId}`, externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
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
            objectType: "MOVIE",
            content: { title: `Title ${tmdbId}`, originalReleaseDate: "2024-01-01", externalIds: { tmdbId, imdbId: `tt${tmdbId}` } },
          },
        })),
      },
    },
  }
}

function detailsBody(media: "movie" | "tv", id: number) {
  return media === "movie"
    ? { id, title: `Movie ${id}`, poster_path: "/p.jpg", release_date: "2024-01-01", genres: [], vote_average: 7, vote_count: 10 }
    : { id, name: `Show ${id}`, poster_path: "/p.jpg", first_air_date: "2024-01-01", genres: [], vote_average: 7, vote_count: 10 }
}

interface JwCall {
  kind: "charts" | "titles"
  objectType: string
  sortBy: string | null
  country: string | null
}

function installFetch(opts: { mdblist?: unknown[] }) {
  const jwCalls: JwCall[] = []
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: unknown }).url ?? input)
    if (url.includes("mdblist.com")) return Promise.resolve(Response.json(opts.mdblist ?? []))
    if (url.includes("apis.justwatch.com")) {
      const parsed = JSON.parse(String((init as { body?: unknown })?.body ?? "{}"))
      const variables = parsed?.variables ?? {}
      const filter = variables.filter ?? {}
      const types: string[] = filter.objectTypes ?? [filter.objectType]
      const objectType = types.includes("SHOW") ? "SHOW" : "MOVIE"
      if (parsed?.operationName === "GetPopularTitles") {
        const ids = objectType === "SHOW" ? TRENDING_SHOWS : POPULAR_MOVIES
        jwCalls.push({ kind: "titles", objectType, sortBy: variables.sortBy ?? null, country: variables.country ?? null })
        return Promise.resolve(Response.json(titlesBody(ids)))
      }
      const ids = objectType === "SHOW" ? CHART_SHOWS : CHART_MOVIES
      jwCalls.push({ kind: "charts", objectType, sortBy: null, country: variables.country ?? null })
      return Promise.resolve(Response.json(chartsBody(ids)))
    }
    if (url.includes("api.themoviedb.org")) {
      const m = /\/3\/(movie|tv)\/(\d+)(\/images)?/.exec(url)
      if (!m) throw new Error(`unexpected tmdb url ${url}`)
      const media = m[1] as "movie" | "tv"
      const id = Number(m[2])
      if (m[3]) return Promise.resolve(Response.json({ id, backdrops: [], posters: [], logos: [] }))
      return Promise.resolve(Response.json(detailsBody(media, id)))
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch)
  return { spy, jwCalls }
}

interface PayloadItem {
  id: number
  rank: number
  title?: string
  name?: string
}

interface Payload {
  movies: PayloadItem[]
  tv: PayloadItem[]
  degraded?: boolean
}

async function readJson(res: Response): Promise<Payload> {
  const buf = Buffer.from(await res.arrayBuffer())
  const enc = res.headers.get("content-encoding") || ""
  const text = enc.includes("gzip") ? gunzipSync(buf).toString("utf-8") : buf.toString("utf-8")
  return JSON.parse(text)
}

function req(path: string, ua: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { "user-agent": ua },
  })
}

const MOVIE_CUSTOM = {
  id: "trakt-movies",
  name: "Trakt Top 20",
  type: "movie" as const,
  url: "https://mdblist.com/lists/u/trakt-movies",
}

function customRows() {
  return CUSTOM_MOVIES.map((tmdbId, i) => ({
    tmdb_id: tmdbId,
    title: `Custom ${tmdbId}`,
    year: 2024,
    imdb_id: `tt0000${i}`,
  }))
}

describe("GET /api/tmdb/trending — scoped Top 20 sources", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockedUserDefaults.mockReset()
    __resetJWRankingsCache()
    __clearTMDBCache()
    __resetKey401Cache()
    __resetChartGenerationForTest()
    cacheClear()
  })

  it("serves JustWatch charts by default (contract preserved)", async () => {
    installFetch({})
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", "scope-charts"))
    expect(res.status).toBe(200)
    const json = await readJson(res)
    expect(json.degraded).toBe(false)
    expect(json.movies.map((m) => m.id)).toEqual(CHART_MOVIES)
    expect(json.tv.map((m) => m.id)).toEqual(CHART_SHOWS)
    expect(json.movies.map((m) => m.rank)).toEqual([1, 2])
    expect(json.movies[0].title).toBe("Movie 101")
  })

  it("movie popular selection replaces movie rows, series stay charts", async () => {
    mockedUserDefaults.mockResolvedValue({ rankingSourceMovie: "jw:popular" })
    const { jwCalls } = installFetch({})
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey&u=user-1", "scope-popular-movie"))
    const json = await readJson(res)
    expect(json.degraded).toBe(false)
    expect(json.movies.map((m) => m.id)).toEqual(POPULAR_MOVIES)
    expect(json.tv.map((m) => m.id)).toEqual(CHART_SHOWS)
    expect(json.movies.map((m) => m.rank)).toEqual([1, 2])
    // Digital-monetization titles for movies, charts untouched for series.
    expect(jwCalls.some((c) => c.kind === "titles" && c.objectType === "MOVIE" && c.sortBy === "POPULAR")).toBe(true)
    expect(jwCalls.some((c) => c.kind === "titles" && c.objectType === "SHOW")).toBe(false)
    expect(jwCalls.some((c) => c.kind === "charts" && c.objectType === "SHOW")).toBe(true)
  })

  it("series trending selection replaces series rows, movies stay charts", async () => {
    mockedUserDefaults.mockResolvedValue({ rankingSourceSeries: "jw:trending" })
    const { jwCalls } = installFetch({})
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey&u=user-1", "scope-trending-series"))
    const json = await readJson(res)
    expect(json.degraded).toBe(false)
    expect(json.movies.map((m) => m.id)).toEqual(CHART_MOVIES)
    expect(json.tv.map((m) => m.id)).toEqual(TRENDING_SHOWS)
    expect(jwCalls.some((c) => c.kind === "titles" && c.objectType === "SHOW" && c.sortBy === "TRENDING")).toBe(true)
    expect(jwCalls.some((c) => c.kind === "titles" && c.objectType === "MOVIE")).toBe(false)
  })

  it("custom selection replaces rows in list order without JW substitution", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    const { jwCalls } = installFetch({ mdblist: customRows() })
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey&u=user-1", "scope-custom"))
    const json = await readJson(res)
    expect(json.degraded).toBe(false)
    expect(json.movies.map((m) => m.id)).toEqual(CUSTOM_MOVIES)
    expect(json.movies.map((m) => m.rank)).toEqual([1, 2])
    expect(json.tv.map((m) => m.id)).toEqual(CHART_SHOWS)
    expect(jwCalls.some((c) => c.objectType === "MOVIE")).toBe(false)
  })

  it("GLOBAL popular is an approved empty without national substitute", async () => {
    mockedUserDefaults.mockResolvedValue({ rankingSourceMovie: "jw:popular" })
    const { jwCalls } = installFetch({})
    const res = await GET(req("/api/tmdb/trending?country=GLOBAL&api_key=testkey&u=user-1", "scope-global"))
    const json = await readJson(res)
    // No titles fetch at all (fail-closed); the only JW traffic is the
    // approved charts global mechanism (US query inside getJWRankings for
    // charts mode — unchanged), never a popular/trending national substitute.
    expect(jwCalls.some((c) => c.kind === "titles")).toBe(false)
    expect(jwCalls.every((c) => c.kind === "charts")).toBe(true)
    expect(json.movies).toEqual([])
    expect(json.tv.map((m) => m.id)).toEqual(CHART_SHOWS)
  })

  it("custom provider error is degraded without JW fallback", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [{ id: "broken", name: "Broken", type: "movie" as const, url: "https://www.imdb.com/list/ls1234567/" }],
      rankingSourceMovie: "broken",
    })
    const { jwCalls } = installFetch({ mdblist: [] })
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey&u=user-1", "scope-custom-error"))
    const json = await readJson(res)
    // IMDb lists are unsupported as ranking sources: explicit degraded
    // empty, never a silent charts substitution, never cached as healthy.
    expect(json.movies).toEqual([])
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(jwCalls.some((c) => c.objectType === "MOVIE")).toBe(false)
  })

  it("cache isolates sources: popular never serves charts bodies and vice versa", async () => {
    mockedUserDefaults.mockResolvedValue({ rankingSourceMovie: "jw:popular" })
    const { jwCalls } = installFetch({})
    const popularUrl = "/api/tmdb/trending?country=IT&api_key=testkey&u=user-1"
    const first = await readJson(await GET(req(popularUrl, "scope-cache")))
    expect(first.movies.map((m) => m.id)).toEqual(POPULAR_MOVIES)
    const titlesAfterFirst = jwCalls.filter((c) => c.kind === "titles").length
    expect(titlesAfterFirst).toBeGreaterThan(0)
    // Same scope again: route cache hit, no new upstream titles fetch.
    const second = await readJson(await GET(req(popularUrl, "scope-cache")))
    expect(second.movies.map((m) => m.id)).toEqual(POPULAR_MOVIES)
    expect(jwCalls.filter((c) => c.kind === "titles").length).toBe(titlesAfterFirst)
    // Charts scope (no selection) is a separate entry, not the popular body.
    mockedUserDefaults.mockResolvedValue({})
    const chartsKindBefore = jwCalls.filter((c) => c.kind === "charts").length
    const charts = await readJson(await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", "scope-cache")))
    expect(charts.movies.map((m) => m.id)).toEqual(CHART_MOVIES)
    expect(jwCalls.filter((c) => c.kind === "charts").length).toBeGreaterThan(chartsKindBefore)
  })

  it("preserves the shared ranking order/ids (Stremio catalog parity)", async () => {
    mockedUserDefaults.mockResolvedValue({ rankingSourceMovie: "jw:popular" })
    installFetch({})
    const [shared, res] = await Promise.all([
      fetchTop20Ranking({
        slot: "movie",
        source: { kind: "justwatch", mode: "popular" },
        regionCode: "IT",
        regionLang: "it-IT",
      }),
      GET(req("/api/tmdb/trending?country=IT&api_key=testkey&u=user-1", "scope-parity")),
    ])
    const json = await readJson(res)
    expect(shared.status).toBe("ok")
    expect(json.movies.map((m) => m.id)).toEqual(shared.items.map((r) => r.tmdbId))
    expect(json.movies.map((m) => m.rank)).toEqual(shared.items.map((r) => r.rank))
  })
})
