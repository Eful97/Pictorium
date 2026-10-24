// Preview-route HTTP caching for the mutable Top 20 selection.
//
// USER LIVE BUG (correction cycle 2): switching popular/trending/Top 20
// sources refreshed the rows but always showed the same titles; only a manual
// refresh showed the new ones. Root cause (transport, not data): the preview
// route answered healthy bodies with `public, max-age=300, s-maxage=1800`
// while the route cache-hit answered with NO Cache-Control at all, and the
// hook's automatic GET carried no `cache: "no-store"` and no `&_t`
// cache-buster (only the manual refresh appends `&_t`). The server-side app
// cache key was already source-aware (prior cycle), so a direct second GET in
// a test harness returned fresh rows — but any shared (CDN/proxy) cache, and
// the browser HTTP cache at the same namespace URL, kept serving the previous
// source's body to the automatic fetch. The manual refresh bypassed it only
// because its URL differs (`&_t=`), hence the asymmetry in the symptom.
//
// Fix (same precedent as /api/trending/rank): every healthy preview branch
// (cache-hit, default charts miss, popular/trending miss, custom miss — token
// branch included for consistency even though `?config=` versions the URL)
// answers `private, no-cache, must-revalidate`; explicit failures stay
// `no-store`. The server-side app cache still absorbs upstream cost
// (headers-only change). The hook's automatic AND manual Top 20 fetches send
// `cache: "no-store"` (transport only; no app-cache killing, no broad http
// changes, no per-render timestamp needed).
//
// These tests use the ACTUAL route + the REAL shared ranking service
// (fetchTop20Ranking) with fetch-level JW/TMDB mocks at the correct seams —
// never arbitrary hook status. The shared-cache harness below models header
// obedience; it is NOT a real browser E2E (no browser run here).
import { afterEach, describe, expect, it, vi } from "vitest"
import { gunzipSync } from "node:zlib"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/tmdb/trending/route"
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

import { getServerDefaults, getServerDefaultsForUser } from "@/lib/server-defaults"

const mockedDefaults = vi.mocked(getServerDefaults)
const mockedUserDefaults = vi.mocked(getServerDefaultsForUser)

// Disjoint fixtures per source: stale-source bodies are observable by id.
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
        jwCalls.push({ kind: "titles", objectType })
        return Promise.resolve(Response.json(titlesBody(ids)))
      }
      const ids = objectType === "SHOW" ? CHART_SHOWS : CHART_MOVIES
      jwCalls.push({ kind: "charts", objectType })
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

describe("GET /api/tmdb/trending — mutable-selection HTTP caching", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockedDefaults.mockReset()
    mockedDefaults.mockReturnValue({})
    mockedUserDefaults.mockReset()
    mockedUserDefaults.mockResolvedValue({})
    __resetJWRankingsCache()
    __clearTMDBCache()
    __resetKey401Cache()
    // Chart-generation snapshots persist in memory across tests: without a
    // reset, an earlier test's published family would serve later tests with
    // zero upstream (the canonical-window pin, now also used by this route).
    __resetChartGenerationForTest()
    cacheClear()
  })

  it("same namespace URL with a changed persisted source returns disjoint titles (server key correct)", async () => {
    installFetch({})
    const url = "/api/tmdb/trending?country=IT&api_key=testkey&u=user-1"

    const charts = await GET(req(url, "preview-cache-switch-1"))
    expect(charts.status).toBe(200)
    const chartsJson = await readJson(charts)
    expect(chartsJson.movies.map((m) => m.id)).toEqual(CHART_MOVIES)
    expect(chartsJson.tv.map((m) => m.id)).toEqual(CHART_SHOWS)

    // Operator persists popular for movies: same URL, disjoint movie rows,
    // series untouched (actual route + real ranking service, no hook status).
    mockedUserDefaults.mockResolvedValue({ rankingSourceMovie: "jw:popular" })
    const popular = await GET(req(url, "preview-cache-switch-2"))
    expect(popular.status).toBe(200)
    const popularJson = await readJson(popular)
    expect(popularJson.movies.map((m) => m.id)).toEqual(POPULAR_MOVIES)
    expect(popularJson.tv.map((m) => m.id)).toEqual(CHART_SHOWS)
    expect(popularJson.movies.map((m) => m.id)).not.toEqual(chartsJson.movies.map((m) => m.id))
  })

  it("healthy miss and route cache-hit both stay out of shared caches while the server data cache absorbs upstream", async () => {
    mockedUserDefaults.mockResolvedValue({ rankingSourceMovie: "jw:popular" })
    const { jwCalls } = installFetch({})
    const url = "/api/tmdb/trending?country=IT&api_key=testkey&u=user-1"

    const miss = await GET(req(url, "preview-cache-hit-1"))
    expect(miss.status).toBe(200)
    expect((await readJson(miss)).movies.map((m) => m.id)).toEqual(POPULAR_MOVIES)
    // Healthy miss: private no-cache, never public.
    expect(miss.headers.get("Cache-Control")).toContain("private")
    expect(miss.headers.get("Cache-Control")).toContain("no-cache")
    expect(miss.headers.get("Cache-Control")).not.toContain("public")
    const titlesAfterMiss = jwCalls.filter((c) => c.kind === "titles").length
    expect(titlesAfterMiss).toBeGreaterThan(0)

    // Route cache-hit at the same URL: same private headers (previously NO
    // Cache-Control at all), same body, zero new upstream traffic —
    // headers-only change, the server-side data cache still does its job.
    const hit = await GET(req(url, "preview-cache-hit-2"))
    expect(hit.status).toBe(200)
    expect((await readJson(hit)).movies.map((m) => m.id)).toEqual(POPULAR_MOVIES)
    expect(hit.headers.get("Cache-Control")).toContain("private")
    expect(hit.headers.get("Cache-Control")).toContain("no-cache")
    expect(hit.headers.get("Cache-Control")).not.toContain("public")
    expect(jwCalls.filter((c) => c.kind === "titles").length).toBe(titlesAfterMiss)
  })

  it("default-charts and custom healthy branches stay out of shared caches too", async () => {
    installFetch({ mdblist: customRows() })
    const chartsUrl = "/api/tmdb/trending?country=IT&api_key=testkey"

    const charts = await GET(req(chartsUrl, "preview-cache-charts"))
    expect(charts.status).toBe(200)
    expect((await readJson(charts)).movies.map((m) => m.id)).toEqual(CHART_MOVIES)
    expect(charts.headers.get("Cache-Control")).toContain("private")
    expect(charts.headers.get("Cache-Control")).not.toContain("public")

    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    const custom = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey&u=user-1", "preview-cache-custom"))
    expect(custom.status).toBe(200)
    const customJson = await readJson(custom)
    expect(customJson.movies.map((m) => m.id)).toEqual(CUSTOM_MOVIES)
    expect(custom.headers.get("Cache-Control")).toContain("private")
    expect(custom.headers.get("Cache-Control")).not.toContain("public")
  })

  it("explicit failures stay no-store (never cached anywhere)", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [{ id: "broken", name: "Broken", type: "movie" as const, url: "https://www.imdb.com/list/ls1234567/" }],
      rankingSourceMovie: "broken",
    })
    installFetch({ mdblist: [] })
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey&u=user-1", "preview-cache-error"))
    expect(res.status).toBe(200)
    expect((await readJson(res)).degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("HTTP-cache-aware harness: fixed headers revalidate at the same URL where the old public metadata served stale", async () => {
    installFetch({})
    const url = "/api/tmdb/trending?country=IT&api_key=testkey&u=user-1"

    // Minimal shared-cache model obeying Cache-Control: only `public`
    // responses are stored and re-served at the same URL. This is a header-
    // obedience model, NOT a real browser E2E (no browser run here).
    const shared = new Map<string, { body: Payload; cc: string }>()
    const sharedFetch = async (path: string, ua: string): Promise<Payload> => {
      const hit = shared.get(path)
      if (hit && hit.cc.includes("public")) return hit.body
      const res = await GET(req(path, ua))
      const body = await readJson(res)
      const cc = res.headers.get("Cache-Control") ?? ""
      if (cc.includes("public")) shared.set(path, { body, cc })
      return body
    }

    // The OLD metadata (`public, max-age=300, s-maxage=1800` on the healthy
    // miss, nothing on the hit) WOULD have frozen this entry: demonstrate the
    // stale-serve with a seeded old-style entry so the `_t` asymmetry is
    // explicit — the manual refresh URL (`&_t=<now>`) differs and bypasses
    // the entry, while the automatic fetch reuses this exact URL and stays old.
    const chartsFirst = await sharedFetch(url, "preview-cache-harness-1")
    expect(chartsFirst.movies.map((m) => m.id)).toEqual(CHART_MOVIES)
    shared.set(url, {
      body: chartsFirst,
      cc: "public, max-age=300, s-maxage=1800",
    })
    mockedUserDefaults.mockResolvedValue({ rankingSourceMovie: "jw:popular" })
    const staleAuto = await sharedFetch(url, "preview-cache-harness-2")
    expect(staleAuto.movies.map((m) => m.id)).toEqual(CHART_MOVIES)
    const manualBusted = `${url}&_t=${Date.now()}`
    expect(manualBusted).not.toBe(url)
    expect(shared.get(manualBusted)).toBeUndefined()

    // With the FIXED headers the route never stores into the shared model, so
    // the same automatic URL revalidates and returns the disjoint popular rows.
    shared.clear()
    cacheClear()
    const freshMiss = await GET(req(url, "preview-cache-harness-3"))
    expect(freshMiss.headers.get("Cache-Control")).not.toContain("public")
    const freshAuto = await sharedFetch(url, "preview-cache-harness-4")
    expect(freshAuto.movies.map((m) => m.id)).toEqual(POPULAR_MOVIES)
    expect(shared.get(url)).toBeUndefined()
  })
})
