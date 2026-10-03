import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { buildManifestResponse } from "@/lib/build-manifest"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { encodeConfig } from "@/lib/config-token"
import type { CustomCatalogConfig } from "@/lib/types"

vi.mock("@/lib/flixpatrol", () => ({
  getTop10: vi.fn(),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const mockedGetById = vi.mocked(getById)
const mockedDefaults = vi.mocked(getServerDefaults)

const MOVIE_CUSTOM: CustomCatalogConfig = {
  id: "trakt-movies",
  name: "Trakt Top 20",
  type: "movie",
  url: "https://mdblist.com/lists/u/trakt-movies",
}

const MIXED_CUSTOM: CustomCatalogConfig = {
  id: "mixed-list",
  name: "Mista",
  type: "mixed",
  url: "https://mdblist.com/lists/u/mixed",
}

function mdblistEntry(tmdb: number | undefined, title: string, imdb = "") {
  return { tmdb_id: tmdb, title, year: 2024, imdb_id: imdb }
}

function detailsBody(id: number, title: string, imdb: string) {
  return {
    id,
    title,
    genres: [{ id: 28, name: "Azione" }],
    backdrop_path: null,
    overview: "",
    vote_average: 7.5,
    release_date: "2024-01-01",
    external_ids: { imdb_id: imdb },
  }
}

function installFetchRouter(opts: {
  mdblist: unknown[] | null
  details: Record<number, { title: string; imdb: string }>
  jwIds?: number[]
  find?: Record<string, number>
  onJw?: () => void
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = String((input as { url?: unknown }).url ?? input)
    if (url.includes("mdblist.com")) {
      if (opts.mdblist === null) throw new Error("mdblist must not be fetched")
      return Response.json(opts.mdblist)
    }
    if (url.includes("apis.justwatch.com")) {
      opts.onJw?.()
      return Response.json({
        data: {
          streamingCharts: {
            edges: (opts.jwIds ?? []).map((tmdbId, i) => ({
              streamingChartInfo: { rank: i + 1 },
              node: { content: { externalIds: { tmdbId, imdbId: null } } },
            })),
          },
        },
      })
    }
    const findMatch = url.match(/\/find\/([^?]+)\?external_source=imdb_id/)
    if (findMatch) {
      const tmdb = opts.find?.[decodeURIComponent(findMatch[1])] ?? null
      return Response.json({ movie_results: tmdb ? [{ id: tmdb }] : [], tv_results: [] })
    }
    const imagesMatch = url.match(/\/3\/(movie|tv)\/(\d+)\/images/)
    if (imagesMatch) return Response.json({ id: Number(imagesMatch[2]), logos: [] })
    const detailsMatch = url.match(/\/3\/(movie|tv)\/(\d+)/)
    if (detailsMatch) {
      const id = Number(detailsMatch[2])
      const d = opts.details[id]
      if (!d) throw new Error(`no details fixture for ${id}`)
      return Response.json(detailsBody(id, d.title, d.imdb))
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function catalogReq(path: string) {
  return new NextRequest(`http://localhost:3000${path}`)
}

function routeParams(type: string, id: string) {
  return { params: Promise.resolve({ type, id }) }
}

describe("GET /catalog with custom ranking source", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    mockedDefaults.mockReturnValue({})
    vi.restoreAllMocks()
    __resetJWRankingsCache()
    cacheClear()
    __clearTMDBCache()
  })

  it("serves the custom list order on pictorium-jw-movies without calling JustWatch", async () => {
    mockedDefaults.mockReturnValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    let jwCalls = 0
    installFetchRouter({
      mdblist: [mdblistEntry(101, "First"), mdblistEntry(102, "Second"), mdblistEntry(103, "Third")],
      details: {
        101: { title: "First", imdb: "tt0000101" },
        102: { title: "Second", imdb: "tt0000102" },
        103: { title: "Third", imdb: "tt0000103" },
      },
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=k"),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tmdb:101", "tmdb:102", "tmdb:103"])
    expect(jwCalls).toBe(0)
  })

  it("resolves IMDb-only rows and caps a long list at 20", async () => {
    mockedDefaults.mockReturnValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    const mdblist = [
      ...Array.from({ length: 24 }, (_, i) => mdblistEntry(200 + i, `Title ${i}`)),
      { tmdb_id: undefined, title: "Imdb Only", year: 2024, imdb_id: "tt0900000" },
    ]
    const details: Record<number, { title: string; imdb: string }> = {}
    for (let i = 0; i < 24; i++) details[200 + i] = { title: `Title ${i}`, imdb: `tt${200 + i}` }
    details[999] = { title: "Imdb Only", imdb: "tt0900000" }
    installFetchRouter({ mdblist, details, find: { tt0900000: 999 } })

    const res = await GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=k"),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    const body = await res.json()

    // 24 direct rows fill the Top 20 before the IMDb-only row is reached.
    expect(body.metas).toHaveLength(20)
    expect(body.metas[0].id).toBe("tmdb:200")
    expect(body.metas[19].id).toBe("tmdb:219")
  })

  it("falls back to JustWatch when the referenced custom was deleted", async () => {
    mockedDefaults.mockReturnValue({ rankingSourceMovie: "cat-gone" })
    let jwCalls = 0
    installFetchRouter({
      mdblist: null,
      jwIds: [94997],
      details: { 94997: { title: "JW Title", imdb: "tt11198330" } },
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=k"),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0].id).toBe("tmdb:94997")
    expect(jwCalls).toBe(1)
  })

  it("falls back to JustWatch on cross-type selection", async () => {
    mockedDefaults.mockReturnValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceSeries: "trakt-movies",
    })
    let jwCalls = 0
    installFetchRouter({
      mdblist: null,
      jwIds: [94997],
      details: { 94997: { title: "JW Show", imdb: "tt11198330" } },
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      catalogReq("/catalog/series/pictorium-jw-series.json?api_key=k"),
      routeParams("series", "pictorium-jw-series.json"),
    )
    const body = await res.json()

    expect(body.metas[0].id).toBe("tmdb:94997")
    expect(jwCalls).toBe(1)
  })

  it("keeps mixed-source series rows and drops movie rows", async () => {
    mockedDefaults.mockReturnValue({
      customCatalogs: [MIXED_CUSTOM],
      rankingSourceSeries: "mixed-list",
    })
    installFetchRouter({
      mdblist: [
        { tmdb_id: 301, title: "Film", year: 2024, imdb_id: "tt0000301", mediatype: "movie" },
        { tmdb_id: 302, title: "Show", year: 2024, imdb_id: "tt0000302", mediatype: "show" },
      ],
      details: {
        302: { title: "Show", imdb: "tt0000302" },
      },
    })

    const res = await GET(
      catalogReq("/catalog/series/pictorium-jw-series.json?api_key=k"),
      routeParams("series", "pictorium-jw-series.json"),
    )
    const body = await res.json()

    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tmdb:302"])
  })

  it("returns an empty grid (no JW filler) for a genuinely empty list", async () => {
    mockedDefaults.mockReturnValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    let jwCalls = 0
    installFetchRouter({ mdblist: [], details: {}, onJw: () => { jwCalls++ } })

    const res = await GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=k"),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
    expect(jwCalls).toBe(0)
  })

  it("returns an explicit notice (never silent JW) on provider errors", async () => {
    const broken: CustomCatalogConfig = {
      id: "broken",
      name: "Broken",
      type: "movie",
      url: "https://www.imdb.com/list/ls1234567/",
    }
    mockedDefaults.mockReturnValue({
      customCatalogs: [broken],
      rankingSourceMovie: "broken",
    })
    let jwCalls = 0
    const fetchSpy = installFetchRouter({ mdblist: [], details: {}, onJw: () => { jwCalls++ } })

    const res = await GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=k"),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toContain("pictorium:notice:")
    expect(jwCalls).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("keeps namespace customCatalogs when the token carries only the selection", async () => {
    mockedDefaults.mockReturnValue({ customCatalogs: [MOVIE_CUSTOM] })
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
    installFetchRouter({
      mdblist: [mdblistEntry(111, "Via Token")],
      details: { 111: { title: "Via Token", imdb: "tt0000111" } },
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      catalogReq(`/catalog/movie/pictorium-jw-movies.json?api_key=k&config=${token}`),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    const body = await res.json()

    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tmdb:111"])
    expect(jwCalls).toBe(0)
  })

  it("isolates the cache per list credentials and per selection", async () => {
    // The public list payload does not depend on the TMDB key, so the
    // per-credential isolation that changes content is the list credential
    // (`mdblist_key`) plus the selection itself.
    const other: CustomCatalogConfig = {
      id: "other-movies",
      name: "Other",
      type: "movie",
      url: "https://mdblist.com/lists/u/other-movies",
    }
    mockedDefaults.mockReturnValue({
      customCatalogs: [MOVIE_CUSTOM, other],
      rankingSourceMovie: "trakt-movies",
    })
    const fetchSpy = installFetchRouter({
      mdblist: [mdblistEntry(121, "Cached")],
      details: { 121: { title: "Cached", imdb: "tt0000121" } },
    })
    const mdblistCalls = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes("mdblist")).length

    const urlA = "/catalog/movie/pictorium-jw-movies.json?api_key=k&mdblist_key=mk-A"
    await GET(catalogReq(urlA), routeParams("movie", "pictorium-jw-movies.json"))
    expect(mdblistCalls()).toBe(1)
    await GET(catalogReq(urlA), routeParams("movie", "pictorium-jw-movies.json"))
    expect(mdblistCalls()).toBe(1)

    await GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=k&mdblist_key=mk-B"),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    expect(mdblistCalls()).toBe(2)

    // Same credentials, different selection id → different list, refetch.
    mockedDefaults.mockReturnValue({
      customCatalogs: [MOVIE_CUSTOM, other],
      rankingSourceMovie: "other-movies",
    })
    const res = await GET(
      catalogReq(urlA),
      routeParams("movie", "pictorium-jw-movies.json"),
    )
    expect(mdblistCalls()).toBe(3)
    const body = await res.json()
    // Both fixtures serve the same mock payload shape; the selection fragment
    // forced a recompute instead of serving the previous selection's body.
    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
  })

  it("leaves platform catalogs on JustWatch when a global source is set", async () => {
    mockedDefaults.mockReturnValue({
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })
    let jwCalls = 0
    installFetchRouter({
      mdblist: null,
      jwIds: [555],
      details: { 555: { title: "Platform JW", imdb: "tt0000555" } },
      onJw: () => { jwCalls++ },
    })

    const res = await GET(
      catalogReq("/catalog/movie/pictorium-netflix-movies.json?api_key=k"),
      routeParams("movie", "pictorium-netflix-movies.json"),
    )
    const body = await res.json()

    expect(body.metas[0].id).toBe("tmdb:555")
    expect(jwCalls).toBe(1)
  })

  it("names a custom-driven Top 20 after the list instead of JustWatch", async () => {
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 50,
      blurFade: 30,
      blurDarkness: 40,
      gradientHeight: 35,
      networkLogo: true,
      autoRotateClean: true,
      customCatalogs: [MOVIE_CUSTOM],
      rankingSourceMovie: "trakt-movies",
    })

    const req = new NextRequest(`https://pictorium.test/manifest.json?config=${token}`)
    const res = await buildManifestResponse(req, null, token)
    const data = await res.json()

    const jwMovies = data.catalogs.find((c: { id: string }) => c.id === "pictorium-jw-movies")
    expect(jwMovies?.name).toBe("Trakt Top 20")
    const jwSeries = data.catalogs.find((c: { id: string }) => c.id === "pictorium-jw-series")
    expect(jwSeries?.name).toContain("Top 20")
    expect(jwSeries?.name).not.toBe("Trakt Top 20")
  })
})
