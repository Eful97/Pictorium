import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/trending/rank/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"
import { encodeConfig } from "@/lib/config-token"
import type { CustomCatalogConfig } from "@/lib/types"

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

const MOVIE_CUSTOM: CustomCatalogConfig = {
  id: "trakt-movies",
  name: "Trakt Top 20",
  type: "movie",
  url: "https://mdblist.com/lists/u/trakt-movies",
}

function jwEdges(ids: number[]) {
  return {
    data: {
      streamingCharts: {
        edges: ids.map((tmdbId, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: { content: { title: `JW ${tmdbId}`, externalIds: { tmdbId, imdbId: null } } },
        })),
      },
    },
  }
}

function installFetch(opts: { jwIds?: number[]; mdblist?: unknown[]; onJw?: () => void }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = String((input as { url?: unknown }).url ?? input)
    if (url.includes("mdblist.com")) return Response.json(opts.mdblist ?? [])
    if (url.includes("apis.justwatch.com")) {
      opts.onJw?.()
      return Response.json(jwEdges(opts.jwIds ?? []))
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

describe("GET /api/trending/rank with custom ranking source", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockedUserDefaults.mockReset()
    __resetJWRankingsCache()
    cacheClear()
    __clearTMDBCache()
    // Fixed chart cycles: snapshot/lease state must not leak across tests.
    __resetChartGenerationForTest()
  })

  it("keeps the JustWatch contract without any selection", async () => {
    let jwCalls = 0
    installFetch({ jwIds: [101, 102], onJw: () => { jwCalls++ } })

    const hit = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=101&first=20&region=IT"))
    expect(hit.status).toBe(200)
    expect(await hit.json()).toMatchObject({ rank: 1, period: "day", top: 20 })

    const miss = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=999&first=20&region=IT"))
    expect(await miss.json()).toMatchObject({ rank: null, top: 20 })
    // Serving contract: ONE upstream fetch for the canonical window (the
    // per-family refresh); the miss rides the shared caches.
    expect(jwCalls).toBe(1)
  })

  it("gates a stale cached past-window rank instead of serving it (no global purge)", async () => {
    const { cacheSet } = await import("@/lib/cache")
    const { pinChartFamily, chartPinCacheFragment, chartListGroupKey } = await import("@/lib/chart-generation")
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const u = String((url as { url?: unknown }).url ?? url)
      if (u.includes("apis.justwatch.com")) {
        return Response.json({
          data: {
            streamingCharts: {
              edges: Array.from({ length: 19 }, (_, i) => ({
                streamingChartInfo: { rank: i + 1 },
                node: { content: { title: `JW ${i}`, externalIds: { tmdbId: 700 + i, imdbId: null } } },
              })),
            },
          },
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })

    // Publish the canonical pin, then poison its cache entry with a
    // pre-contract rank 21 under the exact live key.
    const warm = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=700&first=20&region=IT"))
    expect(await warm.json()).toMatchObject({ rank: 1 })
    const pin = await pinChartFamily({ regionCode: "IT", regionLang: "it-IT", family: "jw:movie:charts" })
    const group = chartListGroupKey({ regionCode: "IT", regionLang: "it-IT" })
    const poisonedKey = `rank:v2:movie:721:f20:rIT:g${group}${chartPinCacheFragment(pin)}`
    cacheSet(poisonedKey, { rank: 21, period: "day", top: 20 }, ["rank", "justwatch"])

    // The gate rejects the stale body and recomputes: 721 is off-window.
    const res = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=721&first=20&region=IT"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: null, top: 20 })
  })

  it("never badges an official charts rank past the Top-20 window (21 -> none, never clamped)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const u = String((url as { url?: unknown }).url ?? url)
      if (u.includes("apis.justwatch.com")) {
        return Response.json({
          data: {
            streamingCharts: {
              edges: [
                ...Array.from({ length: 19 }, (_, i) => ({
                  streamingChartInfo: { rank: i + 1 },
                  node: { content: { title: `JW ${i}`, externalIds: { tmdbId: 700 + i, imdbId: null } } },
                })),
                {
                  streamingChartInfo: { rank: 21 },
                  node: { content: { title: "Shifted", externalIds: { tmdbId: 721, imdbId: null } } },
                },
              ],
            },
          },
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })

    const shifted = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=721&first=20&region=IT"))
    expect(shifted.status).toBe(200)
    expect(await shifted.json()).toMatchObject({ rank: null, top: 20 })

    const inside = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=700&first=20&region=IT"))
    expect(await inside.json()).toMatchObject({ rank: 1, period: "day", top: 20 })
  })

  it("selected custom source wins over JW for the same title (custom precedence preserved)", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    let jwCalls = 0
    installFetch({
      mdblist: [
        { tmdb_id: 801, title: "One", year: 2024, imdb_id: "tt0000801" },
        { tmdb_id: 802, title: "Two", year: 2024, imdb_id: "tt0000802" },
        { tmdb_id: 803, title: "Three", year: 2024, imdb_id: "tt0000803" },
        { tmdb_id: 804, title: "Four", year: 2024, imdb_id: "tt0000804" },
        { tmdb_id: 805, title: "Five", year: 2024, imdb_id: "tt0000805" },
      ],
      jwIds: [805, 806, 807],
      onJw: () => { jwCalls++ },
    })

    // Title 805 is custom #5 and JW #1: the selected custom source owns the badge.
    const res = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=805&u=user-1"),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: 5, top: 20 })
    expect(jwCalls).toBe(0)
  })

  it("ordinary custom lists without selection never badge (JW miss stays null)", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
    })
    let jwCalls = 0
    const fetchSpy = installFetch({
      mdblist: [{ tmdb_id: 901, title: "OnlyCustom", year: 2024, imdb_id: "tt0000901" }],
      jwIds: [],
      onJw: () => { jwCalls++ },
    })

    // Default JW selection: the mdblist-only title is unranked, and the
    // custom list is never even fetched for the badge (JW is consulted once).
    const res = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=901&u=user-1"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: null, top: 20 })
    const fetchedUrls = fetchSpy.mock.calls.map((c) => String(c[0])).join(" ")
    expect(fetchedUrls).not.toContain("mdblist")
    expect(jwCalls).toBe(1)
  })

  it("resolves the custom position for the namespace selection without JW", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    let jwCalls = 0
    installFetch({
      mdblist: [
        { tmdb_id: 201, title: "First", year: 2024, imdb_id: "tt0000201" },
        { tmdb_id: 202, title: "Second", year: 2024, imdb_id: "tt0000202" },
      ],
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=202&u=user-1"),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: 2, top: 20 })
    expect(jwCalls).toBe(0)
  })

  it("returns null (no JW substitution) outside the custom Top 20", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    let jwCalls = 0
    installFetch({
      mdblist: [{ tmdb_id: 201, title: "First", year: 2024, imdb_id: "tt0000201" }],
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=999&u=user-1"),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: null, top: 20 })
    expect(jwCalls).toBe(0)
  })

  it("answers explicit errors without JW fallback and without caching them", async () => {
    const broken: CustomCatalogConfig = {
      id: "broken",
      name: "Broken",
      type: "movie",
      url: "https://www.imdb.com/list/ls1234567/",
    }
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [broken],
      rankingSourceMovie: "broken",
    })
    let jwCalls = 0
    const fetchSpy = installFetch({ mdblist: [], onJw: () => { jwCalls++ } })

    const first = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=201&u=user-1"),
    )
    expect(first.status).toBe(502)
    expect(await first.json()).toMatchObject({ rank: null, error: "unsupported" })
    expect(jwCalls).toBe(0)

    const second = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=201&u=user-1"),
    )
    expect(second.status).toBe(502)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("falls back to JW on cross-type selection", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceSeries: "trakt-movies",
    })
    let jwCalls = 0
    installFetch({ jwIds: [301], onJw: () => { jwCalls++ } })

    const res = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=tv&id=301&u=user-1"),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: 1, period: "day" })
    expect(jwCalls).toBe(1)
  })

  it("keeps namespace customCatalogs when the token carries only the selection", async () => {
    mockedUserDefaults.mockResolvedValue({ customCatalogs: [MOVIE_CUSTOM] })
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 5,
      blurFade: 60,
      blurDarkness: 40,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: true,
      rankingSourceMovie: "trakt-movies",
    })
    let jwCalls = 0
    installFetch({
      mdblist: [{ tmdb_id: 401, title: "Via Token", year: 2024, imdb_id: "tt0000401" }],
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      new NextRequest(`http://localhost:3000/api/trending/rank?type=movie&id=401&u=user-1&config=${token}`),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: 1, top: 20 })
    expect(jwCalls).toBe(0)
  })

  it("serves repeated custom ranks from cache", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    const fetchSpy = installFetch({
      mdblist: [{ tmdb_id: 501, title: "Cached", year: 2024, imdb_id: "tt0000501" }],
    })
    const url = "http://localhost:3000/api/trending/rank?type=movie&id=501&u=user-1"

    await GET(new NextRequest(url))
    await GET(new NextRequest(url))

    expect(fetchSpy.mock.calls.filter((c) => String(c[0]).includes("mdblist"))).toHaveLength(1)
  })

  it("keeps custom responses out of shared caches (charts branch included)", async () => {
    mockedUserDefaults.mockResolvedValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    installFetch({
      mdblist: [{ tmdb_id: 601, title: "Headers", year: 2024, imdb_id: "tt0000601" }],
      jwIds: [602],
    })

    const custom = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=601&u=user-1"),
    )
    expect(custom.headers.get("Cache-Control")).toContain("private")
    expect(custom.headers.get("Cache-Control")).toContain("no-cache")

    const customMiss = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=999&u=user-1"),
    )
    expect(customMiss.headers.get("Cache-Control")).toContain("private")

    const jw = await GET(
      new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=602&first=20&region=IT"),
    )
    // Mutable-selection contract: the charts branch resolves through the same
    // mutable defaults as every other branch, so it stays out of shared
    // caches too (private/no-cache) while the server-side app cache still
    // absorbs upstream cost.
    expect(jw.headers.get("Cache-Control")).toContain("private")
    expect(jw.headers.get("Cache-Control")).toContain("no-cache")
    expect(await jw.json()).toMatchObject({ rank: 1 })
  })
})
