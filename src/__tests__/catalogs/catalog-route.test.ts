import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { GET as GET_EXTRA } from "@/app/catalog/[type]/[id]/[...extra]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getTop10 } from "@/lib/flixpatrol"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"
import { encodeConfig } from "@/lib/config-token"
import { parseCatalogExtra } from "@/lib/catalog-handler"
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
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetTop10.mockReset()
    mockedGetById.mockReset()
    __resetJWRankingsCache()
    cacheClear()
    // Isolamento tra test: tmdbFetch ha una LRU in-memory che sopravvive ai
    // mock di fetch — senza clear, i details restano cachati e i mock in
    // coda (es. /images per il logo) slittano sul fetch sbagliato.
    __clearTMDBCache()
    // Fixed chart cycles: snapshot/lease in-memory sopravvivono tra test
    // come le altre cache — senza reset, una publish precedente servirebbe
    // snapshot invece delle righe mockate live.
    __resetChartGenerationForTest()
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
      id: "tt11198330",
      type: "series",
      name: "House of the Dragon",
      poster: expect.stringContaining("/api/poster/series/94997"),
    })
    expect(body.metas[0].poster).toContain(`rv=${POSTER_URL_VERSION}`)
  })

  it("serves a rendered landscape banner for Nuvio horizontal mode", async () => {
    // Il banner è il rendering Pictorium in canvas landscape SENZA logo
    // baked-in (hideLogo): resta per i client che leggono `banner`.
    // NuvioTV legge invece `landscapePoster` (con logo): i titoli portrait
    // non lo emettono e mantengono il `logo` separato.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        logos: [{ file_path: "/hotd-logo.png", iso_639_1: "it" }],
      }))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0].banner).toContain("/api/poster/series/94997")
    expect(body.metas[0].banner).toContain("shape=landscape")
    expect(body.metas[0].banner).toContain("hideLogo=1")
    expect(body.metas[0].banner).toContain(`rv=${POSTER_URL_VERSION}`)
    // Il poster resta portrait per i client verticali (nessun mapping salvato).
    expect(body.metas[0].poster).not.toContain("shape=landscape")
    expect(body.metas[0].poster).not.toContain("hideLogo")
    expect(body.metas[0].posterShape).toBe("poster")
    // Titolo portrait: niente landscapePoster, logo separato presente.
    expect(body.metas[0].landscapePoster).toBeUndefined()
    expect(body.metas[0].logo).toContain("/hotd-logo.png")
  })

  it("serves landscapePoster with baked-in logo and no separate logo for landscape titles", async () => {
    // NuvioTV sovrappone il `logo` del catalogo alle card landscape: per i
    // titoli landscape l'immagine deve arrivare intoccabile (logo già
    // baked-in nel landscapePoster) e il `logo` va omesso — altrimenti il
    // secondo logo finisce sopra il nostro.
    mockedGetById.mockResolvedValue({
      tmdbId: 94997,
      mediaType: "tv",
      title: "House of the Dragon",
      posterPath: "/house-of-the-dragon.jpg",
      logoPath: "/hotd-logo.png",
      originalPosterPath: null,
      language: null,
      posterShape: "landscape",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        logos: [{ file_path: "/hotd-logo.png", iso_639_1: "it" }],
      }))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas[0].posterShape).toBe("landscape")
    const posterUrl = new URL(body.metas[0].poster)
    expect(posterUrl.searchParams.get("shape")).toBe("landscape")
    expect(posterUrl.searchParams.has("hideLogo")).toBe(false)
    // landscapePoster = stesso canvas con logo (niente hideLogo).
    expect(body.metas[0].landscapePoster).toContain("/api/poster/series/94997")
    const landscapeUrl = new URL(body.metas[0].landscapePoster)
    expect(landscapeUrl.searchParams.get("shape")).toBe("landscape")
    expect(landscapeUrl.searchParams.has("hideLogo")).toBe(false)
    // Niente logo separato: Nuvio non ha nulla da sovrapporre.
    expect(body.metas[0].logo).toBeUndefined()
    // Il banner pulito resta per gli altri client.
    expect(body.metas[0].banner).toContain("hideLogo=1")
  })

  it("forces saved portrait catalog cards to landscape when the global format is landscape", async () => {
    vi.mocked(getServerDefaults).mockReturnValue({ posterShape: "landscape" })
    mockedGetById.mockResolvedValue({
      tmdbId: 94997, mediaType: "tv", title: "House of the Dragon",
      posterPath: "/house-of-the-dragon.jpg", logoPath: null,
      originalPosterPath: null, language: null, posterShape: "poster",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(tmdbShowResponse(94997))
    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const item = (await res.json()).metas[0]
    expect(item.posterShape).toBe("landscape")
    expect(new URL(item.poster).searchParams.get("shape")).toBe("landscape")
    expect(item.landscapePoster).toBe(item.poster)
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
      id: "tt11198330",
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

  it("returns a notice card for custom catalogs without any TMDB key", async () => {
    // Senza chiave niente getDetails e i poster Pictorium risponderebbero 404:
    // notice esplicita come il ramo JW, mai item rotti o metas:[] silenzioso.
    const savedEnv = {
      PICTORIUM_TMDB_KEY: process.env.PICTORIUM_TMDB_KEY,
      TMDB_KEY: process.env.TMDB_KEY,
      TMDB_API_KEY: process.env.TMDB_API_KEY,
    }
    delete process.env.PICTORIUM_TMDB_KEY
    delete process.env.TMDB_KEY
    delete process.env.TMDB_API_KEY
    try {
      const token = encodeConfig({
        globalBadges: true,
        rankingBadges: true,
        badgeStyle: "pill",
        rankingBadgeStyle: "pill",
        blurEnabled: true,
        blurIntensity: 12,
        blurFade: 45,
        blurDarkness: 55,
        gradientHeight: 50,
        networkLogo: true,
        autoRotateClean: false,
        customCatalogs: [
          {
            id: "notice-test",
            name: "Notice Test",
            type: "movie",
            url: "https://mdblist.com/lists/snoak/notice-test",
            enabled: true,
          },
        ],
      })

      const req = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-custom-movie-notice-test.json?config=${token}`)
      const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-notice-test.json" }) })
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.metas).toHaveLength(1)
      expect(body.metas[0].id.startsWith("pictorium:notice:")).toBe(true)
      expect(body.metas[0].poster).toContain("/pictorium.png")
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
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
      rankingBadgeStyle: "pill",
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
    expect(posterUrl.searchParams.get("rs")).toBe("pill")
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
    expect(body.metas[0]).toMatchObject({ id: "tt9999999", type: "series" })
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
    // Cycle-aware source refresh (fixed chart cycles): the in-slot freshness
    // floor travels with the canonical fallback fetch. The renewal caller
    // forbids laundering a stale fp-crawler body as a fresh fetch
    // (freshOrThrow: failure retention, no new generation on outage) while
    // the serving path keeps the fail-open stale fallback.
    expect(mockedGetTop10).toHaveBeenCalledWith("netflix", "italy", "settings-key", { enrich: false, minFetchedAtMs: expect.any(Number), freshOrThrow: true })
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
      id: "tt0848228",
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
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 550, title: "Fight Club", release_date: "1999-10-15" },
        ],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))
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
      id: "tt0137523",
      type: "movie",
      name: "Fight Club",
      releaseInfo: "1999",
      poster: expect.stringContaining("/api/poster/movie/550"),
    })
    // IMDb-first via external_ids with the request credentials, numeric poster identity kept.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/movie/550/external_ids") && String(url).includes("api_key=settings-key"))).toBe(true)
  })

  it("emits tmdb: fallback for full-text search rows without a resolvable IMDb id", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 771, title: "Titolo Senza IMDb", release_date: "2021-05-01" },
        ],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))
      .mockResolvedValueOnce(Response.json({ id: 771, imdb_id: null }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=sconosciuto.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies",
        extra: ["search=sconosciuto.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:771",
      type: "movie",
      name: "Titolo Senza IMDb",
      poster: expect.stringContaining("/api/poster/movie/771"),
    })
  })

  it("fails closed to tmdb: for invalid IMDb ids from search external_ids", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 772, title: "Titolo Spurio", release_date: "2020-01-01" },
        ],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))
      .mockResolvedValueOnce(Response.json({ id: 772, imdb_id: "tt123" }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=spurio.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies",
        extra: ["search=spurio.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    // Never the garbage string, never a bare number — typed TMDB fallback.
    expect(body.metas[0].id).toBe("tmdb:772")
  })

  it("keeps serving full-text search rows when IMDb resolution fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 773, title: "Titolo Resiliente", release_date: "2019-03-03" },
        ],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))
      .mockRejectedValueOnce(new Error("external_ids boom"))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=resiliente.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies",
        extra: ["search=resiliente.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:773",
      type: "movie",
      name: "Titolo Resiliente",
      poster: expect.stringContaining("/api/poster/movie/773"),
    })
  })

  it("resolves IMDb-first ids for series full-text search with order and numeric posters preserved", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20" },
          { id: 1399, name: "Senza IMDb Serie", first_air_date: "2011-04-17" },
          { id: 1402, name: "The Walking Dead", first_air_date: "2010-10-31" },
        ],
        total_pages: 1,
        total_results: 3,
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 18, name: "Dramma" }] }))
      .mockResolvedValueOnce(Response.json({ id: 1396, imdb_id: "tt0903747" }))
      .mockResolvedValueOnce(Response.json({ id: 1399, imdb_id: null }))
      .mockResolvedValueOnce(Response.json({ id: 1402, imdb_id: "tt1520211" }))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-search-series/search=dramma.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "series",
        id: "pictorium-search-series",
        extra: ["search=dramma.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(3)
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt0903747", "tmdb:1399", "tt1520211"])
    expect(body.metas[0].poster).toContain("/api/poster/series/1396")
    expect(body.metas[1].poster).toContain("/api/poster/series/1399")
    expect(body.metas[2].poster).toContain("/api/poster/series/1402")
    const urls = fetchSpy.mock.calls.map(([url]) => String(url))
    // One bounded external_ids lookup per row, no full details fetch per row.
    expect(urls.filter((u) => u.includes("/external_ids"))).toHaveLength(3)
    expect(urls.filter((u) => /\/tv\/\d+\?/.test(u))).toHaveLength(0)
  })

  it("resolves IMDb-first ids for person-search credit rows", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 287, name: "Brad Pitt", popularity: 35, known_for: [{ id: 603, vote_count: 9000 }] },
        ],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({
        id: 287,
        cast: [
          { id: 27205, title: "Inception", release_date: "2010-07-15", media_type: "movie", popularity: 10 },
          { id: 603, title: "Fight Club", release_date: "1999-10-15", media_type: "movie", popularity: 90 },
        ],
        crew: [],
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))
      .mockResolvedValueOnce(Response.json({ id: 603, imdb_id: "tt0137523" }))
      .mockResolvedValueOnce(Response.json({ id: 27205, imdb_id: "tt1375666" }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-people-movies/search=brad%20pitt.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-people-movies",
        extra: ["search=brad%20pitt.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(2)
    // Popularity-desc order kept, IMDb-first ids, numeric poster identity.
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt0137523", "tt1375666"])
    expect(body.metas.map((m: { name: string }) => m.name)).toEqual(["Fight Club", "Inception"])
    expect(body.metas[0].poster).toContain("/api/poster/movie/603")
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/movie/603/external_ids") && String(url).includes("api_key=settings-key"))).toBe(true)
  })

  it("falls back to tmdb: for person-search rows without a resolvable IMDb id", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [
          { id: 287, name: "Brad Pitt", popularity: 35, known_for: [{ id: 680, vote_count: 9000 }] },
        ],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({
        id: 287,
        cast: [
          { id: 680, title: "Pulp Fiction", release_date: "1994-10-14", media_type: "movie", popularity: 80 },
        ],
        crew: [],
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))
      .mockResolvedValueOnce(Response.json({ id: 680, imdb_id: null }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-people-movies/search=brad%20pitt.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-people-movies",
        extra: ["search=brad%20pitt.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tmdb:680",
      type: "movie",
      name: "Pulp Fiction",
      poster: expect.stringContaining("/api/poster/movie/680"),
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

  it("resolves an exact IMDb id via /find instead of full-text search", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        movie_results: [{ id: 550 }],
        tv_results: [],
      }))
      .mockResolvedValueOnce(Response.json({
        id: 550,
        title: "Fight Club",
        release_date: "1999-10-15",
        genres: [{ id: 28, name: "Azione" }],
        vote_average: 8.4,
        backdrop_path: "/fight-club-bg.jpg",
        overview: "Trama",
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=tt0137523.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies",
        extra: ["search=tt0137523.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tt0137523",
      type: "movie",
      name: "Fight Club",
      releaseInfo: "1999",
    })
    // Nessuna full-text search: solo /find + dettagli (+ genre-list cachata)
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/search/movie"))).toBe(false)
  })

  it("returns empty metas for an unresolvable IMDb id without falling back to full-text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ movie_results: [], tv_results: [] }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=tt0000000.json?api_key=settings-key")
    const res = await GET_EXTRA(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies",
        extra: ["search=tt0000000.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/search/movie"))).toBe(false)
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
      id: "tt32820897",
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
    expect(body.metas[0].id).toBe("tt15314262")
    expect(body.metas[1].id).toBe("tt31234567")
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

  it("fail-open: un titolo TMDB appeso non appende il catalogo oltre il cap", async () => {
    // Il details di TMDB resta appeso fino all'abort (upstream stalled):
    // il cap per-titolo (CATALOG_TMDB_TIMEOUT_MS) deve abortirlo e il titolo
    // esce comunque col nome JustWatch, entro la deadline client.
    // Reset cache JW: la key è per paese/lingua, non per contenuto — senza,
    // si riuserebbero le righe (senza titolo) dei test precedenti.
    __resetJWRankingsCache()
    cacheClear()
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input)
      if (url.includes("justwatch")) {
        return Promise.resolve(Response.json({
          data: {
            streamingCharts: {
              edges: [
                {
                  streamingChartInfo: { rank: 1 },
                  node: { content: { title: "Slow Title", externalIds: { tmdbId: 424242, imdbId: "tt4242420" } } },
                },
              ],
            },
          },
        }))
      }
      if (url.includes("/images")) {
        return Promise.resolve(Response.json({ id: 424242, posters: [], logos: [], backdrops: [] }))
      }
      // TMDB details: pende finché il signal non abortisce (come un upstream lento).
      return new Promise((_, reject) => {
        const signal = (init as RequestInit | undefined)?.signal
        if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"))
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
      })
    })

    const start = Date.now()
    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].name).toBe("Slow Title")
    // Senza cap, il details appeso avrebbe tenuto la risposta per sempre;
    // col cap 2.5s (+ overhead) deve chiudere ben prima della deadline Stremio.
    expect(Date.now() - start).toBeLessThan(9000)
  }, 15000)
})
