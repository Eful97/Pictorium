import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getAll, getById, getImdbAlias } from "@/lib/store"
import { resolveImdbToTmdb } from "@/lib/imdb-resolver"
import { selectBestLogoFitPosterPath } from "@/lib/poster-auto-fit"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear } from "@/lib/cache"
import { resolveStreamQuality } from "@/lib/stream-quality"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import type { Mapping } from "@/lib/types"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAllWikidata } from "@/lib/awards"
import { renderMultiRatings } from "@/lib/multi-rating-renderer"
import { fetchAggregatedRating } from "@/lib/ratings"
import { RENDER_VERSION } from "@/lib/render-version"
import { posterHeaders } from "@/lib/poster-runtime-cache"
import * as hardening from "@/lib/poster-params-hardening"
import * as sessionCache from "@/lib/tmdb-session-cache"

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  fetchCustomRatings: vi.fn(async () => []),
}))
vi.mock("@/lib/multi-rating-renderer", () => ({ renderMultiRatings: vi.fn(async () => null) }))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", () => ({
  getServerDefaults: vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" })),
}))

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))

vi.mock("@/lib/svg-badge", () => ({
  renderGenreBadge: vi.fn(async () => null),
  renderRankingBadge: vi.fn(async () => null),
  renderExtraBadge: vi.fn(async () => null),
  renderQualityBadge: vi.fn(async () => null),
}))

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/stream-quality", () => ({
  resolveStreamQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/awards", () => ({
  fetchAllWikidata: vi.fn(async () => ({ awards: [], nominations: [], studios: [], director: null })),
  getAwardBadgeLabel: vi.fn(),
  getNominationBadgeLabel: vi.fn(),
  matchTMDBStudios: vi.fn(() => []),
  matchDirectorName: vi.fn((name: string | null) => name),
  directorBadgeLabel: vi.fn((name: string | null) => name),
  // La route lo importa davvero: senza, la chain wikidataId lancia TypeError.
  isValidWikidataQid: (v: unknown): v is string => typeof v === "string" && /^Q\d+$/.test(v),
}))

vi.mock("@/lib/mdblist", () => ({
  fetchMDBList: vi.fn(async () => []),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  // F5a: il path non-mappato chiama SOLO la combined. Di default delega ai
  // due mock storici così i test esistenti (che armano getDetails/getExternalIds)
  // restano verdi senza rewrite; il wiring è pinnato dal test F6/F5a sotto.
  getDetailsWithExternalIds: vi.fn(
    async (
      mediaType: "movie" | "tv",
      tmdbId: number,
      language?: string,
      apiKey?: string,
      signal?: AbortSignal,
      timeoutMs?: number,
    ) => {
      const det = await mockedGetDetails(mediaType, tmdbId, language, apiKey, signal, timeoutMs)
      const ext = await mockedGetExternalIds(mediaType, tmdbId, apiKey, signal, timeoutMs)
      return { ...det, external_ids: ext }
    },
  ),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn((req: { nextUrl?: { searchParams: URLSearchParams } }) => req.nextUrl?.searchParams.get("api_key") || undefined),
  // La route risolve le chiavi via resolveUserApiKeys: mock fedele alla
  // semantica (query api_key), così i test che armano ?api_key= restano validi.
  resolveUserApiKeys: vi.fn(async (req: { headers: { get: (n: string) => string | null }; nextUrl?: { searchParams: URLSearchParams } }) => {
    const q = req.nextUrl?.searchParams.get("api_key") || undefined
    const none = { key: undefined, source: "none" } as const
    return {
      tmdb: q ? { key: q, source: "query" } : none,
      mdblist: none,
      tvdb: none,
    }
  }),
}))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

const mockedGetById = vi.mocked(getById)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedSelectBestLogoFitPosterPath = vi.mocked(selectBestLogoFitPosterPath)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedFetchMDBList = vi.mocked(fetchMDBList)

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

describe("GET /api/poster/[type]/[id] with saved mappings", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.mocked(renderMultiRatings).mockClear()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("uses the saved poster path instead of overriding it with automatic best fit", async () => {
    const savedPoster = await imageBuffer("#101010", 500, 750)
    const logo = await imageBuffer("#ffffff", 220, 80)
    const requestedUrls: string[] = []

    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "movie",
      title: "Saved Poster",
      posterPath: "/saved-choice.jpg",
      logoPath: "/logo.png",
      originalPosterPath: null,
      language: "it",
      cleanPosters: ["/saved-choice.jpg", "/best-fit.jpg"],
      showBadges: false,
      rankingBadges: false,
      updatedAt: "2026-07-16T10:15:30.000Z",
    })

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      const body = url.includes("/logo.png") ? logo : savedPoster
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(body.length) },
      })
    })

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42?rv=81&mv=1784218530000")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    expect(mockedSelectBestLogoFitPosterPath).not.toHaveBeenCalled()
    expect(requestedUrls.some((url) => url.includes("/saved-choice.jpg"))).toBe(true)
    expect(requestedUrls.some((url) => url.includes("/best-fit.jpg"))).toBe(false)
    expect(renderMultiRatings).not.toHaveBeenCalled()
  })

  it("passes custom ratings to the renderer on a miss and skips the provider on a cache hit", async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "true")
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENDPOINT", "https://example.com/{imdbId}")
    const rating = { id: "custom", name: "Example", value: 87, format: "percent" as const }
    vi.mocked(fetchCustomRatings).mockResolvedValue([rating])
    mockedGetExternalIds.mockResolvedValueOnce({ imdb_id: "tt1375666" })
    mockedGetDetails.mockResolvedValueOnce({ id: 98765, title: "Custom test", genres: [], vote_average: 0, vote_count: 0 })
    mockedGetById.mockResolvedValue({
      tmdbId: 98765, mediaType: "movie", title: "Custom test", posterPath: "/custom-test.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, updatedAt: "2026-09-12T00:00:00.000Z",
    })
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    const requestPoster = () => GET(new NextRequest("http://localhost:3000/api/poster/movie/98765?imdbId=tt1375666"), {
      params: Promise.resolve({ type: "movie", id: "98765" }),
    })
    const first = await requestPoster()
    expect(first.status).toBe(200)
    expect(fetchCustomRatings).toHaveBeenCalledWith("tt1375666", expect.objectContaining({ enabled: true }), expect.any(AbortSignal))
    expect(renderMultiRatings).toHaveBeenCalledWith([rating], expect.any(Number), expect.any(Boolean))
    const calls = vi.mocked(fetchCustomRatings).mock.calls.length
    const hit = await requestPoster()
    expect(hit.status).toBe(200)
    expect(fetchCustomRatings).toHaveBeenCalledTimes(calls)
    expect(hit.headers.get("etag")).toBe(first.headers.get("etag"))
  })

  it("skips the custom provider when display is off via query cr=0 or mapping", async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "true")
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENDPOINT", "https://example.com/{imdbId}")
    const rating = { id: "custom", name: "Example", value: 87, format: "percent" as const }
    vi.mocked(fetchCustomRatings).mockResolvedValue([rating])
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt1375666" })
    mockedGetDetails.mockResolvedValue({ id: 98766, title: "Custom off", genres: [], vote_average: 0, vote_count: 0 })
    const poster = await imageBuffer("#101010", 500, 750)
    // mockImplementation (non mockResolvedValue): ogni fetch vuole un Response
    // fresco, il body si consuma una sola volta e qui ci sono due render.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    // Query cr=0 vince sull'env abilitato.
    mockedGetById.mockResolvedValue({
      tmdbId: 98766, mediaType: "movie", title: "Custom off", posterPath: "/custom-off.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, updatedAt: "2026-09-12T00:00:00.000Z",
    })
    const off = await GET(new NextRequest("http://localhost:3000/api/poster/movie/98766?imdbId=tt1375666&cr=0"), {
      params: Promise.resolve({ type: "movie", id: "98766" }),
    })
    expect(off.status).toBe(200)
    expect(fetchCustomRatings).not.toHaveBeenCalled()
    expect(renderMultiRatings).not.toHaveBeenCalled()
    // Mapping customRatings=false, senza query: stesso risultato.
    mockedGetById.mockResolvedValue({
      tmdbId: 98767, mediaType: "movie", title: "Custom off mapping", posterPath: "/custom-off.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, customRatings: false, updatedAt: "2026-09-12T00:00:00.000Z",
    })
    mockedGetDetails.mockResolvedValue({ id: 98767, title: "Custom off mapping", genres: [], vote_average: 0, vote_count: 0 })
    const mapped = await GET(new NextRequest("http://localhost:3000/api/poster/movie/98767?imdbId=tt1375666"), {
      params: Promise.resolve({ type: "movie", id: "98767" }),
    })
    expect(mapped.status).toBe(200)
    expect(fetchCustomRatings).not.toHaveBeenCalled()
    expect(renderMultiRatings).not.toHaveBeenCalled()
  })

  it("retries Block B getDetails once on transient failure", async () => {
    const savedPoster = await imageBuffer("#101010", 500, 750)

    // ID e mapping version unici: la poster cache runtime non viene resettata
    // tra i test e la chiave include id + mv — riusare il 42 contaminerebbe.
    mockedGetById.mockResolvedValue({
      tmdbId: 43,
      mediaType: "movie",
      title: "Saved Poster",
      posterPath: "/saved-choice.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      showBadges: false,
      rankingBadges: false,
      updatedAt: "2026-07-17T10:15:30.000Z",
    })

    let thrown = false
    mockedGetDetails.mockImplementation(async (_mediaType: unknown, tmdbId: unknown) => {
      // Solo la prima chiamata per QUESTO titolo fallisce (cold-start); il
      // retry deve riuscire. Le chiamate per altri id (leakage async di altri
      // test) riescono subito e non entrano nel conteggio.
      if (tmdbId === 43 && !thrown) {
        thrown = true
        throw new Error("cold-start blip")
      }
      return {
        id: 42,
        title: "Saved Poster",
        genres: [{ id: 18, name: "Drama" }],
        vote_average: 7.5,
        vote_count: 100,
        original_language: "en",
        release_date: "2024-01-15",
        networks: [],
        production_companies: [],
      }
    })

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(savedPoster), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(savedPoster.length) },
      })
    )

    // Isola il conteggio da eventuali task async di altri test: conta solo
    // le chiamate avvenute durante QUESTA richiesta e per QUESTO titolo.
    mockedGetDetails.mockClear()
    const req = new NextRequest("http://localhost:3000/api/poster/movie/43?rv=81&mv=1784304930000")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "43" }) })

    expect(res.status).toBe(200)
    const callsFor43 = mockedGetDetails.mock.calls.filter((c) => c[1] === 43)
    expect(callsFor43).toHaveLength(2)
  })

  it("calls selectBestLogoFitPosterPath when no mapping exists and a logo is available", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    const logo = await imageBuffer("#ffffff", 220, 80)
    const requestedUrls: string[] = []

    mockedGetById.mockResolvedValue(null)

    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Test Movie",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    })

    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/first-clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
        { file_path: "/second-clean.jpg", iso_639_1: null, vote_average: 7.0, vote_count: 50, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [
        { file_path: "/logo.png", iso_639_1: "en", vote_average: 0, vote_count: 0, width: 220, height: 80, aspect_ratio: 2.75 },
      ],
      backdrops: [],
    })

    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt1234567" })

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      const body = url.includes("/logo.png") ? logo : posterBuf
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(body.length) },
      })
    })

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    expect(mockedSelectBestLogoFitPosterPath).toHaveBeenCalledTimes(1)
    expect(mockedSelectBestLogoFitPosterPath).toHaveBeenCalledWith(
      expect.objectContaining({
        logoPath: "/logo.png",
        hasBadges: true,
      }),
    )
    expect(requestedUrls.some((url) => url.includes("/logo.png"))).toBe(true)
  })

  it("falls back to the language poster when no logo is available (clean without logo is useless)", async () => {
    const langPosterBuf = await imageBuffer("#204080", 500, 750)
    const cleanBuf = await imageBuffer("#101010", 500, 750)
    const requestedUrls: string[] = []

    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Gli occhi degli altri",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.0,
      vote_count: 100,
      original_language: "it",
      release_date: "2025-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
        { file_path: "/it-poster.jpg", iso_639_1: "it", vote_average: 7.0, vote_count: 50, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      // Nessun logo disponibile (caso reale: TMDB 1341422 “Gli occhi degli altri”)
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt34625288" })

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      const body = url.includes("/it-poster.jpg") ? langPosterBuf : cleanBuf
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(body.length) },
      })
    })

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    // Deve usare il poster in lingua, NON il clean senza logo
    expect(requestedUrls.some((url) => url.includes("/it-poster.jpg"))).toBe(true)
    expect(requestedUrls.some((url) => url.includes("/clean.jpg"))).toBe(false)
  })

  it.each([
    { label: "disabled", enabled: false, imdb: true, custom: true, id: 98769 },
    { label: "IMDb + Custom", enabled: true, imdb: true, custom: true, id: 98770 },
    { label: "IMDb only", enabled: true, imdb: true, custom: false, id: 98771 },
    { label: "Custom only", enabled: true, imdb: false, custom: true, id: 98772 },
    { label: "no ratings", enabled: true, imdb: false, custom: false, id: 98773 },
    { label: "provider overrides internal ID with multiple items", enabled: true, imdb: true, custom: true, id: 98774 },
  ].flatMap(test => ["non-mapped", "saved", "query"].map((kind, index) => ({ ...test, kind, id: test.id + index * 100 }))))("renders independent rating items: $kind / $label", async ({ imdb, custom, id, enabled, kind, label }) => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", String(enabled))
    const { fetchAggregatedRating } = await import("@/lib/ratings")
    vi.mocked(fetchAggregatedRating).mockResolvedValue({
      sources: imdb ? { imdb: 8.8, tmdb: 6 } : { tmdb: 6 },
      average: imdb ? 7.4 : 6, count: imdb ? 2 : 1,
    })
    const customItem = { id: "custom", name: "Custom", value: 87, format: "percent" as const }
    const overridesInternal = label.startsWith("provider overrides")
    const providerItems = overridesInternal ? [
      { id: "source1", name: "Source 1", value: 8, format: "decimal" as const },
      { id: "imdb", name: "Provider value", value: 9.2, format: "decimal" as const },
      { id: "source2", name: "Source 2", value: 87, format: "percent" as const },
    ] : custom ? [customItem] : []
    vi.mocked(fetchCustomRatings).mockResolvedValueOnce(providerItems)
    mockedGetById.mockResolvedValue(kind === "saved" ? {
      tmdbId: id, mediaType: "movie", title: "Independent ratings", posterPath: `/ratings-${id}.jpg`,
      logoPath: null, originalPosterPath: null, language: "it", voteAverage: 5,
      showBadges: false, rankingBadges: false, updatedAt: "2026-09-12T00:00:00.000Z",
    } : null)
    mockedGetDetails.mockResolvedValue({ id, title: "Independent ratings", genres: [], vote_average: 6, vote_count: 100 })
    mockedGetImages.mockResolvedValue({ id, posters: [
      { file_path: `/ratings-${id}.jpg`, iso_639_1: null, vote_average: 8, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
    ], logos: [], backdrops: [] })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: `tt${id}` })
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    const url = `http://localhost:3000/api/poster/movie/${id}${kind === "query" ? `?poster=/ratings-${id}.jpg&imdbId=tt${id}&voteAverage=5&preview=1` : ""}`
    const res = await GET(new NextRequest(url), {
      params: Promise.resolve({ type: "movie", id: String(id) }),
    })
    expect(res.status).toBe(200)
    const expected = overridesInternal ? [providerItems[1], providerItems[0], providerItems[2]] : [
      ...(imdb ? [{ id: "imdb", name: "IMDb", value: 8.8, format: "decimal" }] : []),
      ...(custom ? [customItem] : []),
    ]
    if (enabled && expected.length) expect(renderMultiRatings).toHaveBeenCalledWith(expected, expect.any(Number), expect.any(Boolean))
    else expect(renderMultiRatings).not.toHaveBeenCalled()
    if (!enabled) expect(fetchCustomRatings).not.toHaveBeenCalled()
    const imdbCalls = vi.mocked(fetchAggregatedRating).mock.calls.length
    const customCalls = vi.mocked(fetchCustomRatings).mock.calls.length
    if (enabled || kind === "non-mapped") expect(imdbCalls).toBe(1)
    else expect(imdbCalls).toBe(0)
    const hit = await GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: String(id) }) })
    expect(hit.status).toBe(200)
    // Le preview (`preview=1`, ramo query) sono no-store: la route non le
    // scrive in cache, quindi la seconda GET ri-renderizza e rifà i fetch.
    // Tutti gli altri rami devono servire la seconda GET da cache (zero fetch).
    const previewRefetch = kind === "query" ? 1 : 0
    expect(fetchAggregatedRating).toHaveBeenCalledTimes(imdbCalls + (imdbCalls > 0 ? previewRefetch : 0))
    expect(fetchCustomRatings).toHaveBeenCalledTimes(customCalls + (customCalls > 0 ? previewRefetch : 0))
    const debug = await GET(new NextRequest(`${url}${url.includes("?") ? "&" : "?"}debug=1`), {
      params: Promise.resolve({ type: "movie", id: String(id) }),
    })
    expect(debug.status).toBe(200)
    expect((await debug.json()).vote.average).toBeCloseTo(kind === "non-mapped" ? (imdb ? 7.4 : 6) : 5)
  })

  it("applies the TMDB+IMDb average rating when the aggregated rating resolves", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    const { fetchAggregatedRating } = await import("@/lib/ratings")
    const mockedAggregatedRating = vi.mocked(fetchAggregatedRating)
    mockedAggregatedRating.mockResolvedValue({
      sources: { imdb: 8.0, tmdb: 7.5 },
      average: 7.75,
      count: 2,
    })

    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Average Rating",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/first-clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt1234567" })

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      const body = url.includes("/first-clean.jpg") ? posterBuf : posterBuf
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(body.length) },
      })
    })

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    expect(mockedAggregatedRating).toHaveBeenCalledWith("tt1234567", undefined, expect.any(AbortSignal), expect.anything())
  })

  it("honors single-source rsrc and falls back to default average on garbage rsrc (Fix A/D)", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    const { fetchAggregatedRating } = await import("@/lib/ratings")
    vi.mocked(fetchAggregatedRating).mockResolvedValue({
      sources: { imdb: 8.0, tmdb: 6.0, metacritic: 9.0 },
      average: 7.67,
      count: 3,
    })

    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 43,
      title: "Rsrc Sources",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 6.0,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 43,
      posters: [
        { file_path: "/rsrc-clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt7654321" })

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBuf), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
    }))

    const single = await GET(new NextRequest("http://localhost:3000/api/poster/movie/43?rsrc=metacritic&debug=1"), {
      params: Promise.resolve({ type: "movie", id: "43" }),
    })
    expect(single.status).toBe(200)
    expect((await single.json()).vote.average).toBeCloseTo(9.0)

    const garbage = await GET(new NextRequest("http://localhost:3000/api/poster/movie/43?rsrc=xyz&debug=1"), {
      params: Promise.resolve({ type: "movie", id: "43" }),
    })
    expect(garbage.status).toBe(200)
    // Garbage rsrc → default imdb+tmdb (8+6)/2, come la details route — mai fallback TMDB.
    expect((await garbage.json()).vote.average).toBeCloseTo(7.0)
  })

  it("falls back to TMDB vote when the aggregated rating is not resolved in time", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    const { fetchAggregatedRating } = await import("@/lib/ratings")
    const mockedAggregatedRating = vi.mocked(fetchAggregatedRating)
    // Promise che non risolve mai: la race con RATING_WAIT_MS (2s) scade.
    mockedAggregatedRating.mockReturnValue(new Promise(() => {}))

    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Slow Rating",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/first-clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt1234567" })

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      const body = url.includes("/first-clean.jpg") ? posterBuf : posterBuf
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(body.length) },
      })
    })

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
  })

  it("memoizes TMDB fetches for the same unmapped title across preview ticks (F6)", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Session Cache",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.0,
      vote_count: 100,
      original_language: "it",
      release_date: "2025-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/it-poster.jpg", iso_639_1: "it", vote_average: 7.0, vote_count: 50, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: null })

    // NB: mockImplementation e non mockResolvedValue — la Response va creata
    // fresca a ogni chiamata, altrimenti il body one-shot viene consumato dal
    // primo fetchImg e il secondo tick va in "Poster image not available".
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    // Azzera la history dei mock: gli altri test del describe la inquinano.
    mockedGetDetails.mockClear()
    mockedGetDetailsWithExternalIds.mockClear()
    mockedGetImages.mockClear()
    mockedGetExternalIds.mockClear()

    const req1 = new NextRequest("http://localhost:3000/api/poster/movie/42?preview=1")
    const res1 = await GET(req1, { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(res1.status).toBe(200)
    // F5a: il ramo non-mappato chiama la combined UNA volta sola e MAI
    // getDetails/getExternalIds diretti per il fetch iniziale (entrambi i
    // conteggi sotto passano solo via delega del mock combined; il Block B
    // riusa la session cache e non rifà rete).
    expect(mockedGetDetailsWithExternalIds.mock.calls.length).toBe(1)
    expect(mockedGetDetails.mock.calls.length).toBe(1) // solo via delega combined
    const imagesAfterFirst = mockedGetImages.mock.calls.length
    const extAfterFirst = mockedGetExternalIds.mock.calls.length
    expect(imagesAfterFirst).toBeGreaterThan(0)
    expect(extAfterFirst).toBe(1) // solo via delega combined

    // Secondo tick di preview con parametri diversi → cache key diversa, ma la
    // session cache per type:id evita di rifare i fetch TMDB.
    const req2 = new NextRequest("http://localhost:3000/api/poster/movie/42?preview=1&blur=0")
    const res2 = await GET(req2, { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(res2.status).toBe(200)
    expect(mockedGetDetailsWithExternalIds.mock.calls.length).toBe(1)
    expect(mockedGetDetails.mock.calls.length).toBe(1)
    expect(mockedGetImages.mock.calls.length).toBe(imagesAfterFirst)
    expect(mockedGetExternalIds.mock.calls.length).toBe(extAfterFirst)
  })

  // Catena wikidataId (fast-path REST awards): query > mapping > session >
  // ramo else. Senza, preview e mapping cadono nella lotteria SPARQL
  // (Dexter: Emmy a intermittenza). ID unici: la poster cache runtime non
  // viene resettata tra i test e la chiave include l'id.
  async function qidPoster() {
    return imageBuffer("#101010", 500, 750)
  }

  it("passes query wikidata_id to fetchAllWikidata in the preview branch", async () => {
    const poster = await qidPoster()
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({ id: 61001, title: "Qid Preview", genres: [], vote_average: 0, vote_count: 0 })
    mockedGetImages.mockResolvedValue({
      id: 61001,
      posters: [{ file_path: "/qid.jpg", iso_639_1: null, vote_average: 8, vote_count: 10, width: 500, height: 750, aspect_ratio: 0.667 }],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: null })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(fetchAllWikidata).mockClear()
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/61001?poster=/qid.jpg&ranking=1&wikidata_id=Q23577&preview=1"), {
      params: Promise.resolve({ type: "movie", id: "61001" }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(fetchAllWikidata)).toHaveBeenCalledWith(61001, "movie", expect.anything(), { wikidataId: "Q23577" })
  })

  it("uses the saved mapping wikidataId without a query param", async () => {
    const poster = await qidPoster()
    mockedGetById.mockResolvedValue({
      tmdbId: 61002, mediaType: "movie", title: "Qid Saved", posterPath: "/qid-saved.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      rankingBadges: true, wikidataId: "Q23577", updatedAt: "2026-09-20T00:00:00.000Z",
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(fetchAllWikidata).mockClear()
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/61002"), {
      params: Promise.resolve({ type: "movie", id: "61002" }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(fetchAllWikidata)).toHaveBeenCalledWith(61002, "movie", expect.anything(), { wikidataId: "Q23577" })
  })

  it("falls back to null wikidataId for legacy mappings without a key (SPARQL preserved)", async () => {
    const poster = await qidPoster()
    mockedGetById.mockResolvedValue({
      tmdbId: 61003, mediaType: "movie", title: "Qid Legacy", posterPath: "/qid-legacy.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      rankingBadges: true, updatedAt: "2026-09-20T00:00:00.000Z",
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(fetchAllWikidata).mockClear()
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/61003"), {
      params: Promise.resolve({ type: "movie", id: "61003" }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(fetchAllWikidata)).toHaveBeenCalledWith(61003, "movie", expect.anything(), { wikidataId: null })
  })

  it("resolves the QID server-side for legacy mappings when api_key is present", async () => {
    const poster = await qidPoster()
    mockedGetById.mockResolvedValue({
      tmdbId: 61004, mediaType: "movie", title: "Qid Legacy Resolved", posterPath: "/qid-legacy2.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      rankingBadges: true, updatedAt: "2026-09-20T00:00:00.000Z",
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: null, wikidata_id: "Q23577" })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(fetchAllWikidata).mockClear()
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/61004?api_key=testkey"), {
      params: Promise.resolve({ type: "movie", id: "61004" }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(fetchAllWikidata)).toHaveBeenCalledWith(61004, "movie", expect.anything(), { wikidataId: "Q23577" })
  })

  it("discards a garbage TMDB wikidata_id (SPARQL preserved)", async () => {
    const poster = await qidPoster()
    mockedGetById.mockResolvedValue({
      tmdbId: 61005, mediaType: "movie", title: "Qid Garbage", posterPath: "/qid-garbage.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      rankingBadges: true, updatedAt: "2026-09-20T00:00:00.000Z",
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: null, wikidata_id: "nope" })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(fetchAllWikidata).mockClear()
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/61005?api_key=testkey"), {
      params: Promise.resolve({ type: "movie", id: "61005" }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(fetchAllWikidata)).toHaveBeenCalledWith(61005, "movie", expect.anything(), { wikidataId: null })
  })
})

describe("GET /api/poster/[type]/[id] in presets mode (public instance)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    vi.spyOn(hardening, "isPresetsPosterMode").mockReturnValue(true)
    vi.spyOn(hardening, "isPublicPosterInstance").mockReturnValue(true)
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("matches JustWatch on the TMDB title, not a query title, even if the session cache was evicted", async () => {
    const poster = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 62001, title: "Real Title", genres: [{ id: 18, name: "Drama" }],
      vote_average: 7, vote_count: 10, original_language: "en", production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 62001,
      posters: [{ file_path: "/p62001.jpg", iso_639_1: "en", vote_average: 8, vote_count: 10, width: 500, height: 750, aspect_ratio: 0.667 }],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt62001" })
    // Simulate LRU eviction between the auto-branch write and the quality read.
    vi.spyOn(sessionCache, "getTMDBSessionCache").mockReturnValue(null)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(resolveStreamQuality).mockClear()
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/62001?api_key=k&title=Bogus"), {
      params: Promise.resolve({ type: "movie", id: "62001" }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(resolveStreamQuality)).toHaveBeenCalled()
    expect(vi.mocked(resolveStreamQuality).mock.calls[0][3]).toBe("Real Title")
  })

  it("does not forward a query wikidata_id without an image override", async () => {
    const poster = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue({
      tmdbId: 62002, mediaType: "movie", title: "Presets Qid", posterPath: "/p62002.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      rankingBadges: true, updatedAt: "2026-09-20T00:00:00.000Z",
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(fetchAllWikidata).mockClear()
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/62002?wikidata_id=Q999"), {
      params: Promise.resolve({ type: "movie", id: "62002" }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(fetchAllWikidata)).toHaveBeenCalledWith(62002, "movie", expect.anything(), { wikidataId: null })
  })
})

describe("GET /api/poster/[type]/[id] error and edge cases", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("returns 400 for invalid numeric ID", async () => {
    const req = new NextRequest("http://localhost:3000/api/poster/movie/0")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "0" }) })
    expect(res.status).toBe(400)
  })

  it("returns 400 for non-IMDB, non-numeric ID", async () => {
    const req = new NextRequest("http://localhost:3000/api/poster/movie/invalid-id")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "invalid-id" }) })
    expect(res.status).toBe(400)
  })

  it("returns 400 (not 500) for external image URLs blocked by the allowlist (R2)", async () => {
    // Prima l'URL esterno falliva dentro il try del render → 500 +
    // negative-cache per un errore del client. Ora 400 prima di slot/cache.
    for (const key of ["poster", "logo", "backdrop"]) {
      const req = new NextRequest(`http://localhost:3000/api/poster/movie/42?${key}=http://evil.example/x.jpg`)
      const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })
      expect(res.status).toBe(400)
    }
  })

  it("returns 400 for oversized text params (R1)", async () => {
    const req = new NextRequest(`http://localhost:3000/api/poster/movie/42?extra=${"x".repeat(5000)}`)
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(res.status).toBe(400)
  })

  it("returns 404 when posterPath is null after resolution", async () => {
    mockedGetById.mockResolvedValue({
      tmdbId: 99,
      mediaType: "movie",
      title: "No Poster",
      posterPath: "",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    } as Mapping)

    const req = new NextRequest("http://localhost:3000/api/poster/movie/99")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "99" }) })
    expect(res.status).toBe(404)
  })

  it("returns 404 when poster image fetch fails", async () => {
    mockedGetById.mockResolvedValue({
      tmdbId: 77,
      mediaType: "movie",
      title: "No Image",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }))

    const req = new NextRequest("http://localhost:3000/api/poster/movie/77")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "77" }) })
    expect(res.status).toBe(404)
  })

  it("includes CORS headers in success response", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "movie",
      title: "Test CORS",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42?rv=81")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  it("includes CORS headers in 404 error response", async () => {
    const req = new NextRequest("http://localhost:3000/api/poster/movie/0")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "0" }) })
    expect(res.status).toBe(400)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  it.each([true, false])("uses the correct mapped HTTP cache policy with custom provider enabled=%s", async enabled => {
    vi.mocked(fetchCustomRatings).mockClear()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", String(enabled))
    const id = 99001
    const updatedAt = "2026-09-12T00:00:00.000Z"
    mockedGetById.mockResolvedValue({
      tmdbId: id, mediaType: "movie", title: "Cache policy", posterPath: "/cache-policy.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, updatedAt,
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt99001" })
    mockedGetDetails.mockResolvedValue({ id, genres: [], vote_average: 5, vote_count: 10 })
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    const request = (etag?: string) => GET(new NextRequest(
      `http://localhost:3000/api/poster/movie/${id}?rv=${RENDER_VERSION}&mv=${Date.parse(updatedAt)}`,
      { headers: etag ? { "If-None-Match": etag } : {} },
    ), { params: Promise.resolve({ type: "movie", id: String(id) }) })
    const first = await request()
    expect(first.status).toBe(200)
    const calls = vi.mocked(fetchCustomRatings).mock.calls.length
    const hit = await request()
    const conditionalHit = await request(first.headers.get("etag")!)
    expect(hit.status).toBe(200)
    expect(conditionalHit.status).toBe(304)
    expect(fetchCustomRatings).toHaveBeenCalledTimes(calls)
    for (const response of [first, hit, conditionalHit]) {
      const policy = response.headers.get("cache-control")!
      expect(policy).toBe(posterHeaders("test", !enabled)["Cache-Control"])
      if (enabled) {
        expect(policy).not.toContain("immutable")
        expect(policy).not.toContain("max-age=31536000")
      } else {
        expect(policy).toContain("immutable")
        expect(policy).toContain("max-age=31536000")
      }
    }
    vi.mocked(fetchCustomRatings).mockClear()
  })

  it("revalidates saved custom ratings after cache eviction, including the empty state", async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "true")
    const id = 98999
    mockedGetById.mockResolvedValue({
      tmdbId: id, mediaType: "movie", title: "Revalidation", posterPath: "/revalidate.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, updatedAt: "2026-09-12T00:00:00.000Z",
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt98999" })
    mockedGetDetails.mockResolvedValue({ id, genres: [], vote_average: 5, vote_count: 10 })
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    const request = (etag?: string) => GET(new NextRequest(`http://localhost:3000/api/poster/movie/${id}`, {
      headers: etag ? { "If-None-Match": etag } : {},
    }), { params: Promise.resolve({ type: "movie", id: String(id) }) })
    const first = await request()
    expect(first.status).toBe(200)
    const emptyEtag = first.headers.get("etag")!
    expect(emptyEtag).toMatch(/:cr[^\"]+"$/)
    expect(fetchCustomRatings).toHaveBeenCalledTimes(1)
    expect((await request(emptyEtag)).status).toBe(304)
    expect(fetchCustomRatings).toHaveBeenCalledTimes(1) // Cache HIT stays a fast path.
    cacheClear()
    expect((await request(emptyEtag)).status).toBe(304)
    expect(fetchCustomRatings).toHaveBeenCalledTimes(2) // Empty state revalidated.

    const item = { id: "source1", name: "Source 1", value: 87, format: "percent" as const }
    vi.mocked(fetchCustomRatings).mockResolvedValue([item])
    let populatedEtag = ""
    // Also cover clients holding a pre-fix ETag without the empty-state suffix.
    for (const previousEtag of [emptyEtag, emptyEtag.replace(/:cr[^\"]+"$/, '"')]) {
      cacheClear()
      const calls = vi.mocked(fetchCustomRatings).mock.calls.length
      const next = await request(previousEtag)
      expect(next.status).toBe(200)
      expect(fetchCustomRatings).toHaveBeenCalledTimes(calls + 1)
      expect(renderMultiRatings).toHaveBeenLastCalledWith([item], expect.any(Number), expect.any(Boolean))
      populatedEtag = next.headers.get("etag")!
      expect(populatedEtag).not.toBe(emptyEtag)
    }
    cacheClear()
    const calls = vi.mocked(fetchCustomRatings).mock.calls.length
    expect((await request(populatedEtag)).status).toBe(304)
    expect(fetchCustomRatings).toHaveBeenCalledTimes(calls + 1)
  })

  it("returns 304 Not Modified when etag matches", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "movie",
      title: "Test 304",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    // First request — cache the etag
    const req1 = new NextRequest("http://localhost:3000/api/poster/movie/42")
    const res1 = await GET(req1, { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(res1.status).toBe(200)
    const etag = res1.headers.get("ETag")
    expect(etag).toBeTruthy()

    cacheClear() // Disabled provider preserves mapped early 304 even on a cache miss.
    // Second request with If-None-Match
    const req2 = new NextRequest("http://localhost:3000/api/poster/movie/42", {
      headers: { "If-None-Match": etag! },
    })
    const res2 = await GET(req2, { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(res2.status).toBe(304)
  })

  it("emits Server-Timing with render phases on the render path", async () => {
    const posterBuf = await imageBuffer("#202020", 500, 750)
    mockedGetById.mockResolvedValue({
      tmdbId: 43,
      mediaType: "movie",
      title: "Test Timing",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/43"), {
      params: Promise.resolve({ type: "movie", id: "43" }),
    })
    expect(res.status).toBe(200)
    const timing = res.headers.get("Server-Timing") ?? ""
    expect(timing).toMatch(/fetch;dur=\d+/)
    expect(timing).toMatch(/prep;dur=\d+/)
    expect(timing).toMatch(/composite;dur=\d+/)
    expect(timing).toMatch(/total;dur=\d+/)
  })

  it("handles IMDB ID (tt...) resolution to TMDB ID", async () => {
    const { resolveImdbToTmdb } = await import("@/lib/imdb-resolver")
    const mockedResolve = vi.mocked(resolveImdbToTmdb)
    mockedResolve.mockResolvedValue(42)

    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "movie",
      title: "From IMDB",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    const req = new NextRequest("http://localhost:3000/api/poster/movie/tt1234567")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tt1234567" }) })
    expect(res.status).toBe(200)
  })

  it("preserves the path IMDb ID for the custom provider without externalIds", async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "true")
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENDPOINT", "https://example.com/{imdbId}")
    mockedGetExternalIds.mockClear()
    const { resolveImdbToTmdb } = await import("@/lib/imdb-resolver")
    vi.mocked(resolveImdbToTmdb).mockResolvedValue(98770)
    mockedGetById.mockResolvedValue({
      tmdbId: 98770, mediaType: "movie", title: "TT path", posterPath: "/tt-path.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, updatedAt: "2026-09-12T00:00:00.000Z",
    })
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/tt1375666"), {
      params: Promise.resolve({ type: "movie", id: "tt1375666" }),
    })
    expect(res.status).toBe(200)
    expect(fetchCustomRatings).toHaveBeenCalledWith("tt1375666", expect.objectContaining({ enabled: true }), expect.any(AbortSignal))
    expect(mockedGetExternalIds).not.toHaveBeenCalled()
  })

  it("uses the saved mapping imdbId without externalIds fallback", async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "true")
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENDPOINT", "https://example.com/{imdbId}")
    mockedGetExternalIds.mockClear()
    mockedGetById.mockResolvedValue({
      tmdbId: 98771, mediaType: "movie", title: "Mapped imdb", posterPath: "/mapped-imdb.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, imdbId: "tt1375666", updatedAt: "2026-09-12T00:00:00.000Z",
    })
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/98771"), {
      params: Promise.resolve({ type: "movie", id: "98771" }),
    })
    expect(res.status).toBe(200)
    expect(fetchCustomRatings).toHaveBeenCalledWith("tt1375666", expect.objectContaining({ enabled: true }), expect.any(AbortSignal))
    expect(mockedGetExternalIds).not.toHaveBeenCalled()
  })

  it("normalizes series/tv media type", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 10,
      mediaType: "tv",
      title: "Series Test",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    const req = new NextRequest("http://localhost:3000/api/poster/series/10")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "10" }) })
    expect(res.status).toBe(200)
  })

  it("includes version param in preview response", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 10,
      mediaType: "movie",
      title: "Preview",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
    })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    const req = new NextRequest(`http://localhost:3000/api/poster/movie/10?preview=1`)
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "10" }) })
    expect(res.status).toBe(200)
    // Preview should have no-cache
    expect(res.headers.get("Cache-Control")).toContain("no-cache")
  })

  it("handles auto-rotate when mapping has rotation state", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 10,
      mediaType: "movie",
      title: "Rotating",
      posterPath: "/current.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-16T10:15:30.000Z",
      cleanPosters: ["/current.jpg", "/next.jpg"],
      cleanPosterIndex: 0,
    })

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      const body = url.includes("/next.jpg") ? await imageBuffer("#202020", 500, 750) : posterBuf
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(body.length) },
      })
    })

    const req = new NextRequest("http://localhost:3000/api/poster/movie/10")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "10" }) })
    expect(res.status).toBe(200)
  })

  it("uses the animerank query param as anime rank override (preview WYSIWYG)", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Test Anime",
      genres: [{ id: 16, name: "Animation" }],
      vote_average: 8.0,
      vote_count: 100,
      original_language: "ja",
      first_air_date: "2020-01-01",
      type: "scripted",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/anime-clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt0000042" })

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    mockedFetchMDBList.mockClear()
    const req = new NextRequest("http://localhost:3000/api/poster/tv/42?animerank=5&debug=1")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "42" }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.anime).toBe(5)
    // L'override evita il fetch MDBList (la preview non porta chiavi)
    expect(mockedFetchMDBList).not.toHaveBeenCalled()
  })

  it("falls back to the saved mapping animeRank when no key/animerank is available", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "tv",
      title: "Saved Anime",
      posterPath: "/saved-anime.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      badgeRank: 3,
      badgeLabel: "Anime",
      animeRank: 3,
      updatedAt: "2026-07-16T10:15:30.000Z",
    } as never)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    // Senza profilo né animerank (poster salvato su Stremio): il fetch MDBList
    // keyless fallisce (503 in produzione) e si usa il rank salvato nel mapping.
    // Il mock qui RIFIUTA per simulare il failure (una resolve [] sarebbe una
    // miss genuina → niente fallback, vedi test sotto).
    mockedFetchMDBList.mockRejectedValueOnce(new Error("MDBList 503"))
    const req = new NextRequest("http://localhost:3000/api/poster/tv/42?debug=1")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "42" }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.anime).toBe(3)
    expect(body.badge.computed.badge).toMatchObject({ type: "rank", label: "Anime", rank: 3 })
  })

  it("does NOT resurrect a stale mapping animeRank on genuine chart miss", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "tv",
      title: "Saved Anime",
      posterPath: "/saved-anime.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      badgeRank: 3,
      badgeLabel: "Anime",
      animeRank: 3,
      updatedAt: "2026-07-16T10:15:30.000Z",
    } as never)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    // fetchMDBList riuscito ma titolo fuori chart ([]) → miss genuina: niente
    // fallback al rank salvato.
    mockedFetchMDBList.mockResolvedValueOnce([])
    const req = new NextRequest("http://localhost:3000/api/poster/tv/42?debug=1")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "42" }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.anime).toBeNull()
    expect(body.badge.computed.badge?.rank).not.toBe(3)
  })

  it("does NOT resurrect a stale mapping trend rank on genuine JustWatch miss (The Boys case)", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    // The Boys salvata quando era top 15, oggi fuori dalla chart JW.
    mockedGetById.mockResolvedValue({
      tmdbId: 76479,
      mediaType: "tv",
      title: "The Boys",
      posterPath: "/the-boys.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      badgeRank: 15,
      badgeLabel: "Serie",
      trendRank: 15,
      updatedAt: "2026-07-16T10:15:30.000Z",
    } as never)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    // getJWRankings riuscito ma senza il titolo → miss genuina.
    mockedGetJWRankings.mockResolvedValueOnce([])
    const req = new NextRequest("http://localhost:3000/api/poster/tv/76479?debug=1")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "76479" }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.justwatch).toBeNull()
    expect(body.rankings.finalRank).toBeNull()
    expect(body.badge.computed.badge?.rank).not.toBe(15)
  })

  it("falls back to the saved mapping trend rank when the JustWatch fetch fails", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 76479,
      mediaType: "tv",
      title: "The Boys",
      posterPath: "/the-boys.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      badgeRank: 15,
      badgeLabel: "Serie",
      trendRank: 15,
      updatedAt: "2026-07-16T10:15:30.000Z",
    } as never)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    // Fetch fallito (outage) → degraded esplicito col rank salvato.
    mockedGetJWRankings.mockRejectedValueOnce(new Error("JW down"))
    const req = new NextRequest("http://localhost:3000/api/poster/tv/76479?debug=1")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "76479" }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.finalRank).toBe(15)
    expect(body.badge.computed.badge).toMatchObject({ type: "rank", rank: 15 })
  })

  it("respects netLogo query param over mapping for networkLogo", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue({
      tmdbId: 76479,
      mediaType: "tv",
      title: "The Boys",
      posterPath: "/the-boys.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      networkLogo: false,
      updatedAt: "2026-07-16T10:15:30.000Z",
    } as never)

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    // With netLogo=1, it should override mapping's networkLogo: false
    const reqOn = new NextRequest("http://localhost:3000/api/poster/tv/76479?debug=1&netLogo=1")
    const resOn = await GET(reqOn, { params: Promise.resolve({ type: "tv", id: "76479" }) })
    expect(resOn.status).toBe(200)
    const bodyOn = await resOn.json()
    expect(bodyOn.logos.networkLogo).toBe(true)

    // Without netLogo query param, it respects mapping's networkLogo: false
    const reqDefault = new NextRequest("http://localhost:3000/api/poster/tv/76479?debug=1")
    const resDefault = await GET(reqDefault, { params: Promise.resolve({ type: "tv", id: "76479" }) })
    expect(resDefault.status).toBe(200)
    const bodyDefault = await resDefault.json()
    expect(bodyDefault.logos.networkLogo).toBe(false)
  })

  it("queries JustWatch rankings with the requested region and localized language", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)

    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 76479,
      title: "The Boys",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 8.5,
      original_language: "en",
    } as never)
    mockedGetImages.mockResolvedValue({
      posters: [{ file_path: "/the-boys.jpg", vote_average: 9, width: 500, height: 750, iso_639_1: "fr" }],
      logos: [],
      backdrops: [],
    } as never)

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    mockedGetJWRankings.mockResolvedValue([])

    // Explicit region=FR
    const reqFr = new NextRequest("http://localhost:3000/api/poster/tv/76479?debug=1&region=FR")
    await GET(reqFr, { params: Promise.resolve({ type: "tv", id: "76479" }) })

    // R3: la route passa anche il signal del watchdog (6° arg) — allo scatto
    // della deadline il fetch JW abortisce invece di restare zombie.
    expect(mockedGetJWRankings).toHaveBeenCalledWith("SHOW", "FR", 20, undefined, "fr-FR", expect.any(AbortSignal))

    mockedGetJWRankings.mockClear()
    cacheClear()
    __resetTMDBSessionCache()

    // Lang fallback: lang=de -> region DE, de-DE
    const reqDe = new NextRequest("http://localhost:3000/api/poster/tv/76479?debug=1&lang=de")
    await GET(reqDe, { params: Promise.resolve({ type: "tv", id: "76479" }) })

    expect(mockedGetJWRankings).toHaveBeenCalledWith("SHOW", "DE", 20, undefined, "de-DE", expect.any(AbortSignal))
  })

  it("serves ephemeral Cache-Control (120s, no immutable) when quality times out", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Test Movie",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt1234567" })
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: null, status: "timeout", source: "torrentio" })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    const cc = res.headers.get("Cache-Control") ?? ""
    expect(cc).toContain("max-age=120")
    expect(cc).not.toContain("immutable")
    expect(cc).not.toContain("max-age=31536000")
  })

  it("serves ephemeral Cache-Control (120s, no immutable) when wikidata is degraded", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    cacheClear()
    __resetTMDBSessionCache()
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Test Movie",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt1234567" })
    // Qualità resolved: isola l'effimero al solo Wikidata degradato.
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: "HD", status: "resolved", source: "torrentio", rawTokens: [] })
    vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null, degraded: true })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    const cc = res.headers.get("Cache-Control") ?? ""
    expect(cc).toContain("max-age=120")
    expect(cc).not.toContain("immutable")
    expect(cc).not.toContain("max-age=31536000")

    // debug=1 espone lo stato Wikidata (degraded/timedOut).
    cacheClear()
    __resetTMDBSessionCache()
    const reqDbg = new NextRequest("http://localhost:3000/api/poster/movie/42?debug=1")
    const resDbg = await GET(reqDbg, { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(resDbg.status).toBe(200)
    const body = await resDbg.json()
    expect(body.wikidata.degraded).toBe(true)
    expect(body.wikidata.timedOut).toBe(false)

    vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null })
  })

  it("exposes quality status/source, logo selection and cache state in debug=1", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Test Movie",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    })
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/clean.jpg", iso_639_1: null, vote_average: 8.0, vote_count: 100, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [
        { file_path: "/logo.png", iso_639_1: "en", vote_average: 0, vote_count: 0, width: 220, height: 80, aspect_ratio: 2.75 },
      ],
      backdrops: [],
    })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt1234567" })
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: "4K", status: "resolved", source: "torrentio", rawTokens: ["4k"] })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )

    const req = new NextRequest("http://localhost:3000/api/poster/movie/42?debug=1")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "42" }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quality).toMatchObject({ value: "4K", source: "torrentio", status: "resolved", rawTokens: ["4k"] })
    expect(body.logoSelection.requestedLang).toBe("it")
    expect(body.logoSelection.usedLang).toBe("en")
    expect(body.cache.hit).toBe(false)
    expect(body.meta.mappingId).toBeNull()
  })
})

describe("GET /api/poster/[type]/[id] con alias IMDb manuale", () => {
  const mockedGetImdbAlias = vi.mocked(getImdbAlias)
  const mockedGetAll = vi.mocked(getAll)
  const mockedResolveImdbToTmdb = vi.mocked(resolveImdbToTmdb)

  beforeEach(() => {
    vi.restoreAllMocks()
    mockedGetImdbAlias.mockReset().mockResolvedValue(null)
    mockedGetAll.mockReset().mockResolvedValue([])
    mockedGetById.mockReset().mockResolvedValue(null)
    mockedResolveImdbToTmdb.mockReset().mockResolvedValue(null)
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("l'alias vince sul /find e aggancia il mapping salvato", async () => {
    mockedGetImdbAlias.mockResolvedValue({ imdbId: "tt13207736", mediaType: "tv", tmdbId: 299939 })
    // Il /find direbbe un altro id: non deve essere consultato proprio.
    mockedResolveImdbToTmdb.mockResolvedValue(111111)
    mockedGetById.mockImplementation(async (type, id) =>
      type === "tv" && id === 299939
        ? {
            tmdbId: 299939, mediaType: "tv", title: "Monster: Lizzie Borden",
            posterPath: "/lizzie.jpg", logoPath: null, originalPosterPath: null,
            language: "it", showBadges: false, rankingBadges: false,
            updatedAt: "2026-09-20T00:00:00.000Z",
          }
        : null,
    )
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toContain("/lizzie.jpg")
      return new Response(new Uint8Array(poster), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    })
    const res = await GET(
      new NextRequest("http://localhost:3000/api/poster/series/tt13207736"),
      { params: Promise.resolve({ type: "series", id: "tt13207736" }) },
    )
    expect(res.status).toBe(200)
    expect(mockedGetImdbAlias).toHaveBeenCalledWith("tt13207736", null)
    expect(mockedResolveImdbToTmdb).not.toHaveBeenCalled()
    expect(mockedGetById).toHaveBeenCalledWith("tv", 299939, null)
  })

  it("senza alias, fallback al /find invariato (tt ignoto → 400)", async () => {
    mockedGetImdbAlias.mockResolvedValue(null)
    mockedGetAll.mockResolvedValue([])
    mockedResolveImdbToTmdb.mockResolvedValue(null)
    const res = await GET(
      new NextRequest("http://localhost:3000/api/poster/series/tt0000000"),
      { params: Promise.resolve({ type: "series", id: "tt0000000" }) },
    )
    expect(res.status).toBe(400)
    expect(mockedResolveImdbToTmdb).toHaveBeenCalled()
  })

  it("reverse lookup: imdbId del mapping salvato vince sul /find", async () => {
    mockedGetImdbAlias.mockResolvedValue(null)
    mockedGetAll.mockResolvedValue([
      {
        tmdbId: 299939, mediaType: "tv", title: "Monster: Lizzie Borden",
        posterPath: "/lizzie.jpg", logoPath: null, originalPosterPath: null,
        language: "it", showBadges: false, rankingBadges: false,
        imdbId: "tt13207736", updatedAt: "2026-09-20T00:00:00.000Z",
      },
    ])
    // Il /find punterebbe allo stub franchise: non deve essere consultato.
    mockedResolveImdbToTmdb.mockResolvedValue(111111)
    mockedGetById.mockImplementation(async (type, id) =>
      type === "tv" && id === 299939
        ? {
            tmdbId: 299939, mediaType: "tv", title: "Monster: Lizzie Borden",
            posterPath: "/lizzie.jpg", logoPath: null, originalPosterPath: null,
            language: "it", showBadges: false, rankingBadges: false,
            imdbId: "tt13207736", updatedAt: "2026-09-20T00:00:00.000Z",
          }
        : null,
    )
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toContain("/lizzie.jpg")
      return new Response(new Uint8Array(poster), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    })
    const res = await GET(
      new NextRequest("http://localhost:3000/api/poster/series/tt13207736"),
      { params: Promise.resolve({ type: "series", id: "tt13207736" }) },
    )
    expect(res.status).toBe(200)
    expect(mockedResolveImdbToTmdb).not.toHaveBeenCalled()
    expect(mockedGetById).toHaveBeenCalledWith("tv", 299939, null)
  })

  it("precedenza completa: alias > mapping.imdbId > /find", async () => {
    mockedGetImdbAlias.mockResolvedValue({ imdbId: "tt13207736", mediaType: "tv", tmdbId: 100 })
    mockedGetAll.mockResolvedValue([
      {
        tmdbId: 299939, mediaType: "tv", title: "Monster: Lizzie Borden",
        posterPath: "/lizzie.jpg", logoPath: null, originalPosterPath: null,
        language: "it", showBadges: false, rankingBadges: false,
        imdbId: "tt13207736", updatedAt: "2026-09-20T00:00:00.000Z",
      },
    ])
    mockedResolveImdbToTmdb.mockResolvedValue(111111)
    mockedGetById.mockImplementation(async (type, id) => ({
      tmdbId: id, mediaType: type, title: `T${id}`, posterPath: "/x.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      showBadges: false, rankingBadges: false,
      updatedAt: "2026-09-20T00:00:00.000Z",
    }))
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(poster), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const res = await GET(
      new NextRequest("http://localhost:3000/api/poster/series/tt13207736"),
      { params: Promise.resolve({ type: "series", id: "tt13207736" }) },
    )
    expect(res.status).toBe(200)
    expect(mockedGetById).toHaveBeenCalledWith("tv", 100, null)
    expect(mockedResolveImdbToTmdb).not.toHaveBeenCalled()
  })
})

describe("invented user namespaces (v1.23.0)", () => {
  it("treats ?u= with no stored user as anonymous (global mapping, no separate key space)", async () => {
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    vi.stubEnv("POSTERIUM_MULTI_USER", "1")
    const poster = await imageBuffer("#101010", 500, 750)
    const globalMapping = {
      tmdbId: 61091, mediaType: "movie" as const, title: "Global", posterPath: "/global.jpg",
      logoPath: null, originalPosterPath: null, language: "it", showBadges: false,
      rankingBadges: false, updatedAt: "2026-09-12T00:00:00.000Z",
    }
    // Globale sì, namespace no: senza downgrade la route leggerebbe il
    // namespace inventato (vuoto) invece del mapping globale.
    mockedGetById.mockImplementation(async (_t, _id, userId) => (userId ? null : globalMapping))
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    const invented = "00000000-0000-4000-8000-000000000000"
    const res = await GET(new NextRequest(`http://localhost:3000/api/poster/movie/61091?u=${invented}`), {
      params: Promise.resolve({ type: "movie", id: "61091" }),
    })
    expect(res.status).toBe(200)
    expect(mockedGetById).toHaveBeenCalledWith("movie", 61091, null)
  })
})

