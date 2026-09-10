import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { GET as GET_EXTRA } from "@/app/catalog/[type]/[id]/[...extra]/route"
import { cacheClear } from "@/lib/cache"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getTop10 } from "@/lib/flixpatrol"
import { getById } from "@/lib/store"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { encodeConfig } from "@/lib/config-token"
import { parseCatalogExtra } from "@/lib/catalog-handler"
vi.mock("@/lib/flixpatrol", () => ({
  getTop10: vi.fn(),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", () => ({
  getServerDefaults: vi.fn(() => ({})),
}))

const mockedGetTop10 = vi.mocked(getTop10)
const mockedGetById = vi.mocked(getById)

function justWatchResponse(tmdbId: number, imdbId?: string): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          {
            streamingChartInfo: { rank: 1 },
            node: {
              content: {
                externalIds: { tmdbId, imdbId: imdbId ?? null },
              },
            },
          },
        ],
      },
    },
  })
}

function tmdbShowResponse(tmdbId: number): Response {
  return Response.json({
    id: tmdbId,
    name: "House of the Dragon",
    poster_path: "/house-of-the-dragon.jpg",
    first_air_date: "2022-08-21",
  })
}

describe("GET /catalog/[type]/[id]", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetTop10.mockReset()
    mockedGetById.mockReset()
    __resetJWRankingsCache()
    cacheClear()
  })

  it("builds Pictorium series poster URLs for JustWatch series catalogs", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:94997",
      type: "series",
      name: "House of the Dragon",
      poster: expect.stringContaining("/api/poster/series/94997"),
    })
    expect(body.metas[0].poster).toContain(`rv=${POSTER_URL_VERSION}`)
  })

  it("serves legacy posterium-* catalog IDs as aliases of pictorium-*", async () => {
    // Addon Stremio installati prima del rename chiedono ancora gli ID legacy:
    // devono rispondere come i canonici, senza duplicare la logica.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))

    const req = new NextRequest("http://localhost:3000/catalog/series/posterium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "posterium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:94997",
      type: "series",
      name: "House of the Dragon",
      poster: expect.stringContaining("/api/poster/series/94997"),
    })
  })

  it("never leaks mdblist_key into served poster URLs (M2)", async () => {
    // La chiave resta server-side (rank/voti calcolati al momento del
    // catalogo): nel poster URL finirebbe nel DB Stremio, log CDN/proxy e
    // link condivisi. Il poster risolve il rank via `animerank` incorporato
    // (cataloghi anime) o fallback d'istanza/mapping.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key&mdblist_key=mdblist-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0].poster).toContain("/api/poster/series/94997")
    expect(body.metas[0].poster).not.toContain("mdblist_key")
    expect(body.metas[0].poster).not.toContain("mdblist-key")
  })

  it("adds mapping version to catalog poster URLs for saved titles", async () => {
    mockedGetById.mockResolvedValueOnce({
      tmdbId: 94997,
      mediaType: "tv",
      title: "House of the Dragon",
      posterPath: "/saved.jpg",
      logoPath: "/logo.png",
      originalPosterPath: null,
      language: null,
      updatedAt: "2026-07-16T10:15:30.000Z",
    })
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()
    const posterUrl = new URL(body.metas[0].poster)

    expect(res.status).toBe(200)
    expect(posterUrl.searchParams.get("mv")).toBe(String(Date.parse("2026-07-16T10:15:30.000Z")))
  })

  it("applies custom styles from config token to catalog poster URLs", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))

    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "pill",
      rankingBadgeStyle: "bar",
      blurEnabled: true,
      blurIntensity: 12,
      blurFade: 45,
      blurDarkness: 55,
      gradientHeight: 50,
      networkLogo: true,
      autoRotateClean: false,
      ribbonSide: "right",
    })

    const req = new NextRequest(`http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key&config=${token}`)
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()
    const posterUrl = new URL(body.metas[0].poster)

    expect(res.status).toBe(200)
    expect(posterUrl.searchParams.get("bs")).toBe("pill")
    expect(posterUrl.searchParams.get("rs")).toBe("bar")
    expect(posterUrl.searchParams.get("blur")).toBe("12")
    expect(posterUrl.searchParams.get("bf")).toBe("45")
    expect(posterUrl.searchParams.get("bd")).toBe("55")
    expect(posterUrl.searchParams.get("gradHeight")).toBe("50")
    expect(posterUrl.searchParams.get("side")).toBe("right")
    expect(posterUrl.searchParams.get("config")).toBe(token)
  })

  it("returns 400 for unknown catalog types instead of silently serving series (C4)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const req = new NextRequest("http://localhost:3000/catalog/garbage/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "garbage", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({ metas: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("resolves missing JW imdbId from fused details without an extra external_ids fetch (D4)", async () => {
    // Riga JW senza imdbId + details con external_ids in append: prima un
    // secondo fetch /external_ids per titolo, ora zero.
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(123456))
      .mockResolvedValueOnce(Response.json({
        id: 123456,
        name: "Fusion Test",
        poster_path: "/fusion.jpg",
        first_air_date: "2022-08-21",
        vote_average: 7.0,
        genres: [],
        external_ids: { imdb_id: "tt9999999" },
      }))
      .mockResolvedValue(Response.json({ id: 123456, logos: [] }))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0]).toMatchObject({ id: "tmdb:123456", type: "series" })
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes("append_to_response=external_ids"))).toBe(true)
    expect(urls.some((u) => u.includes("/external_ids"))).toBe(false)
  })

  it("returns 404 without caching for unknown catalog IDs (C4)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-nope-xyz.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-nope-xyz.json" }) })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toEqual({ metas: [] })
    expect(fetchSpy).not.toHaveBeenCalled()

    // Seconda richiesta identica: ancora 404 senza rete (niente entry cache).
    const res2 = await GET(
      new NextRequest("http://localhost:3000/catalog/series/pictorium-nope-xyz.json?api_key=settings-key"),
      { params: Promise.resolve({ type: "series", id: "pictorium-nope-xyz.json" }) },
    )
    expect(res2.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("still serves tv/anime type aliases as series (C4)", async () => {
    // Upstream finto down: il ramo anime degrada a metas:[] ma resta 200
    // (l'alias di tipo è riconosciuto, non 400).
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }))

    const req = new NextRequest("http://localhost:3000/catalog/anime/pictorium-anime.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "anime", id: "pictorium-anime.json" }) })
    expect(res.status).toBe(200)
  })

  it("caps skip/search/genre extras against cache-flooding (C4)", () => {
    expect(parseCatalogExtra(null, new URLSearchParams({ skip: "999999" })).skip).toBe(1000)
    expect(parseCatalogExtra(null, new URLSearchParams({ skip: "-5" })).skip).toBeUndefined()
    expect(parseCatalogExtra(null, new URLSearchParams({ search: "x".repeat(500) })).search).toHaveLength(100)
    expect(parseCatalogExtra(null, new URLSearchParams({ genre: "x".repeat(500) })).genre).toHaveLength(40)
    expect(parseCatalogExtra(["skip=999999"], null).skip).toBe(1000)
    // Valori legittimi invariati.
    expect(parseCatalogExtra(null, new URLSearchParams({ skip: "40", search: "dune", genre: "Fantascienza" }))).toEqual({
      skip: 40,
      search: "dune",
      genre: "Fantascienza",
    })
  })

  it("normalizes tv catalog routes to Pictorium series poster URLs", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))

    const req = new NextRequest("http://localhost:3000/catalog/tv/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0]).toMatchObject({
      type: "series",
      name: "House of the Dragon",
      poster: expect.stringContaining("/api/poster/series/94997"),
    })
    expect(body.metas[0].poster).toContain(`rv=${POSTER_URL_VERSION}`)
  })

  it("builds Pictorium poster URLs for platform catalogs even when source posterPath is missing", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: 1715492, imdb_id: "tt1715492" }))
      .mockResolvedValueOnce(Response.json({ id: 1715492, title: "Costa Concordia: incubo in mare", release_date: "2026-01-01" }))
    mockedGetTop10.mockResolvedValueOnce({
      platform: "netflix",
      platformName: "Netflix",
      country: "italy",
      movies: [
        {
          rank: 1,
          title: "Costa Concordia: incubo in mare",
          tmdbId: 1715492,
          mediaType: "movie",
          posterPath: null,
          releaseDate: "2026-01-01",
        },
      ],
      tv: [],
    })

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-netflix-movies.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-netflix-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockedGetTop10).toHaveBeenCalledWith("netflix", "italy", "settings-key", { enrich: false })
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:1715492",
      type: "movie",
      name: "Costa Concordia: incubo in mare",
      poster: expect.stringContaining("/api/poster/movie/1715492"),
    })
    expect(body.metas[0].poster).toContain(`rv=${POSTER_URL_VERSION}`)
  })

  it("falls back to TMDB external_ids when JustWatch lacks an IMDb id", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(687163))
      .mockResolvedValueOnce(tmdbShowResponse(687163))
      .mockResolvedValueOnce(Response.json({ id: 687163, imdb_id: "tt12042730" }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:687163",
      type: "movie",
      name: "House of the Dragon",
      poster: expect.stringContaining("/api/poster/movie/687163"),
    })
  })

  it("uses the IMDb id already returned by JustWatch (no extra TMDB call)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(8282, "tt0848228"))
      .mockResolvedValueOnce(tmdbShowResponse(8282))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:8282",
      type: "movie",
      name: "House of the Dragon",
      poster: expect.stringContaining("/api/poster/movie/8282"),
    })
  })

  it("exposes a tmdb:<id> provider id when no IMDb id is resolvable (AIOMetadata compat)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(67890))
      .mockResolvedValueOnce(tmdbShowResponse(67890))
      .mockResolvedValueOnce(Response.json({ id: 67890, imdb_id: null }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:67890",
      type: "movie",
      name: "House of the Dragon",
      poster: expect.stringContaining("/api/poster/movie/67890"),
    })
  })

  it("handles Stremio search query in movie search catalog", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 550, title: "Fight Club", release_date: "1999-10-15" },
        ],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({ id: 550, imdb_id: "tt0137523" }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=fight%20club.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies",
        extra: ["search=fight%20club.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:550",
      type: "movie",
      name: "Fight Club",
      releaseInfo: "1999",
      poster: expect.stringContaining("/api/poster/movie/550"),
    })
  })

  it("returns empty metas when dedicated search catalog is called without a search query", async () => {
    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies.json",
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
  })

  it("handles pictorium-anime-movies and builds movie poster URLs even without an explicit MDBList key", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        items: [
          { imdb: "tt32820897", title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle", year: 2025, tmdb: 1311031 },
        ],
      }))
      .mockResolvedValueOnce(Response.json({
        id: 1311031,
        title: "Demon Slayer: Il castello dell'Infinito",
        release_date: "2025-07-01",
      }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-anime-movies.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-anime-movies.json",
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:1311031",
      type: "movie",
      name: "Demon Slayer: Il castello dell'Infinito",
      releaseInfo: "2025",
      poster: expect.stringContaining("/api/poster/movie/1311031"),
    })
  })

  it("uses JustWatch with platform packages for Netflix movie catalog and deduplicates items", async () => {
    // JustWatch edge con duplicate tmdbId (simula risposte grezze con stagioni o duplicati)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        data: {
          streamingCharts: {
            edges: [
              {
                streamingChartInfo: { rank: 1 },
                node: { content: { externalIds: { tmdbId: 866398, imdbId: "tt15314262" } } },
              },
              {
                streamingChartInfo: { rank: 2 },
                node: { content: { externalIds: { tmdbId: 866398, imdbId: "tt15314262" } } },
              },
              {
                streamingChartInfo: { rank: 3 },
                node: { content: { externalIds: { tmdbId: 1588838, imdbId: "tt31234567" } } },
              },
            ],
          },
        },
      }))
      .mockResolvedValueOnce(Response.json({ id: 866398, title: "The Beekeeper", release_date: "2024-01-08" }))
      .mockResolvedValueOnce(Response.json({ id: 1588838, title: "To the Max", release_date: "2026-02-06" }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-netflix-movies.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-netflix-movies.json",
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    // Solo i 2 unici devono essere presenti, il duplicato 866398 al rank 2 è scartato
    expect(body.metas).toHaveLength(2)
    expect(body.metas[0].id).toBe("tmdb:866398")
    expect(body.metas[1].id).toBe("tmdb:1588838")
  })

  it("serves catalog from /c/[config]/catalog/[type]/[id] route", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(999, "tt0999999"))
      .mockResolvedValueOnce(tmdbShowResponse(999))

    const { GET: cGET } = await import("@/app/c/[config]/catalog/[type]/[id]/route")
    const req = new NextRequest("http://localhost:3000/c/testcfg/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await cGET(req, {
      params: Promise.resolve({
        config: "testcfg",
        type: "movie",
        id: "pictorium-jw-movies.json",
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
  })
})
