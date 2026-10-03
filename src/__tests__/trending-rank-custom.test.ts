import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/trending/rank/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __resetJWRankingsCache } from "@/lib/justwatch"
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
  })

  it("keeps the JustWatch contract without any selection", async () => {
    let jwCalls = 0
    installFetch({ jwIds: [101, 102], onJw: () => { jwCalls++ } })

    const hit = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=101&first=20&region=IT"))
    expect(hit.status).toBe(200)
    expect(await hit.json()).toMatchObject({ rank: 1, period: "day", top: 20 })

    const miss = await GET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=999&first=20&region=IT"))
    expect(await miss.json()).toMatchObject({ rank: null, top: 20 })
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

  it("keeps custom responses out of browser caches without touching JW caching", async () => {
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
    expect(jw.headers.get("Cache-Control")).toContain("public")
    expect(await jw.json()).toMatchObject({ rank: 1 })
  })
})
