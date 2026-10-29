/**
 * Text-as-logo route contract (mocked production GET, no live credentials).
 *
 * A title without a TMDB logo can carry a typed wordmark: the server rasterizes
 * it with the BUNDLED badge fonts and feeds it into the EXISTING logo composite
 * path (no second renderer, same layout/scrim/scale), so preview and Stremio
 * stay identical. Empty text keeps the historic no-logo render.
 */
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds, getReleaseDates, getContentRatings } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAllWikidata } from "@/lib/awards"
import { fetchAggregatedRating } from "@/lib/ratings"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { resolveStreamQuality } from "@/lib/stream-quality"

// Only the compositor is stubbed (it needs no TMDB bytes here): the route is
// the real one, so the assertion is about what the ROUTE hands to the renderer.
vi.mock("@/lib/poster-service", async () => {
  const png = await sharp({ create: { width: 12, height: 12, channels: 4, background: "#000000" } }).png().toBuffer()
  return { generatePosterBuffer: vi.fn(async () => png) }
})

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  fetchCustomRatings: vi.fn(async () => []),
}))
vi.mock("@/lib/multi-rating-renderer", () => ({ renderMultiRatings: vi.fn(async () => null) }))
vi.mock("@/lib/svg-badge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/svg-badge")>()
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#ffffff" } }).png().toBuffer()
  const png = () => ({ png: tiny, w: 8, h: 8 })
  return {
    ...actual,
    renderGenreBadge: vi.fn(async () => png()),
    renderRankingBadge: vi.fn(async () => png()),
    renderExtraBadge: vi.fn(async () => png()),
    renderQualityBadge: vi.fn(async () => png()),
    renderQualityKnockoutBadge: vi.fn(async () => png()),
  }
})
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
vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: false, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})
vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))
vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  jwRankingsRemainingMs: vi.fn(() => null),
  jwTitlesRemainingMs: vi.fn(() => null),
  jwAvailabilityRemainingMs: vi.fn(() => null),
  JW_DIGITAL_MONETIZATION_TYPES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
}))
vi.mock("@/lib/stream-quality", () => ({ resolveStreamQuality: vi.fn(async () => null) }))
vi.mock("@/lib/awards", () => ({
  fetchAllWikidata: vi.fn(async () => ({ awards: [], nominations: [], studios: [], director: null })),
  getAwardBadgeLabel: vi.fn(),
  getNominationBadgeLabel: vi.fn(),
  matchTMDBStudios: vi.fn(() => []),
  matchDirectorName: vi.fn((name: string | null) => name),
  directorBadgeLabel: vi.fn((name: string | null) => name),
  isValidWikidataQid: (v: unknown): v is string => typeof v === "string" && /^Q\d+$/.test(v),
}))
vi.mock("@/lib/mdblist", () => ({
  fetchMDBList: vi.fn(async () => []),
  mdblistRemainingMs: vi.fn(() => null),
}))
vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})
vi.mock("@/lib/imdb-resolver", () => ({ resolveImdbToTmdb: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-cache", () => ({ resolveWikidataId: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-top250", () => ({ isImdbTop250: vi.fn(async () => false), isImdbTop100: vi.fn(async () => false) }))
vi.mock("@/lib/network-svgs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network-svgs")>()
  return {
    ...actual,
    renderFirstMatchingNetworkLogoBadgeHybrid: vi.fn(async () => null),
    renderFirstMatchingNetworkRawBadgeHybrid: vi.fn(async () => null),
  }
})
vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  getReleaseDates: vi.fn(),
  getContentRatings: vi.fn(),
  resolveRequestApiKey: vi.fn((req: { nextUrl?: { searchParams: URLSearchParams } }) => req.nextUrl?.searchParams.get("api_key") || undefined),
  resolveUserApiKeys: vi.fn(async (req: { nextUrl?: { searchParams: URLSearchParams } }) => {
    const q = req.nextUrl?.searchParams.get("api_key") || undefined
    const none = { key: undefined, source: "none" } as const
    return { tmdb: q ? { key: q, source: "query" } : none, mdblist: none, tvdb: none }
  }),
}))

const mockedGetById = vi.mocked(getById)
const mockedGenerate = vi.mocked(generatePosterBuffer)

const EMPTY_DETAILS = {
  id: 44,
  title: "No Data Title",
  name: undefined,
  genres: [],
  vote_average: 0,
  vote_count: 0,
  original_language: "en",
  release_date: null,
  first_air_date: null,
  last_air_date: null,
  number_of_seasons: null,
  number_of_episodes: null,
  type: undefined,
  status: undefined,
  networks: [],
  production_companies: [],
}

function armEmptyUpstream() {
  mockedGetById.mockResolvedValue(null)
  vi.mocked(getDetails).mockResolvedValue({ ...EMPTY_DETAILS } as never)
  vi.mocked(getDetailsWithExternalIds).mockResolvedValue({ ...EMPTY_DETAILS, external_ids: { imdb_id: null } } as never)
  vi.mocked(getImages).mockResolvedValue({ id: 44, posters: [], logos: [], backdrops: [] })
  vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null })
  vi.mocked(getJWRankings).mockResolvedValue([])
  vi.mocked(getReleaseDates).mockReset().mockResolvedValue({ id: 44, results: [] } as never)
  vi.mocked(getContentRatings).mockReset().mockResolvedValue({ id: 44, results: [] } as never)
  vi.mocked(fetchMDBList).mockResolvedValue([])
  vi.mocked(fetchAggregatedRating).mockResolvedValue(null)
  vi.mocked(resolveStreamQuality).mockResolvedValue(null as never)
  vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null })
}

/** Last GenerationInput the route handed to the compositor. */
function lastInput(): GenerationInput {
  const calls = mockedGenerate.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

async function inkStats(buf: Buffer): Promise<{ opaque: number; transparent: number; hasAlpha: boolean }> {
  const meta = await sharp(buf).metadata()
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = 0
  let transparent = 0
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] > 200) opaque++
    else if (data[i] === 0) transparent++
  }
  return { opaque, transparent, hasAlpha: meta.hasAlpha === true }
}

describe("GET /api/poster text logo (mocked production route)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    mockedGenerate.mockClear()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    armEmptyUpstream()
    const posterBuf = await sharp({ create: { width: 500, height: 750, channels: 4, background: "#101010" } }).png().toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBuf), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
    }))
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  const previewUrl = (extra: string, poster = "%2Fq.jpg&title=Dune") =>
    `http://localhost:3000/api/poster/movie/44?poster=${poster}&badges=0&ranking=0&preview=1${extra}&api_key=test`

  it("renders the typed wordmark into the logo composite input", async () => {
    const res = await GET(new NextRequest(previewUrl("&ltext=Dune&lfont=oswald")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const input = lastInput()
    expect(input.logoFetch).toBeInstanceOf(Buffer)
    const stats = await inkStats(input.logoFetch!)
    // Transparent canvas + real ink: it composites like a TMDB logo.
    expect(stats.hasAlpha).toBe(true)
    expect(stats.opaque).toBeGreaterThan(200)
    expect(stats.transparent).toBeGreaterThan(stats.opaque)
    // Resize cache key: the wordmark has no path, so text+font identify it.
    expect(input.logoSrc).toBe("text-logo:oswald:Dune")
  })

  it("empty text keeps the historic no-logo render", async () => {
    const res = await GET(new NextRequest(previewUrl("&ltext=%20%20")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const input = lastInput()
    expect(input.logoFetch).toBeNull()
    expect(input.logoSrc).toBeNull()
  })

  it("unknown font falls back to the badge-font allowlist (inter)", async () => {
    const res = await GET(new NextRequest(previewUrl("&ltext=Alien&lfont=bebas")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    expect(lastInput().logoSrc).toBe("text-logo:inter:Alien")
  })

  it("saved mapping wordmark renders on the Stremio path (no query params)", async () => {
    mockedGetById.mockResolvedValue({
      tmdbId: 44,
      mediaType: "movie",
      title: "Mapped",
      posterPath: "/mapped.jpg",
      logoPath: null,
      logoText: "Nightmare Alley",
      logoFont: "barlow-condensed",
      originalPosterPath: null,
      language: "it",
      showBadges: false,
      rankingBadges: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never)
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?badges=0&ranking=0&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    const input = lastInput()
    expect(input.logoFetch).toBeInstanceOf(Buffer)
    expect(input.logoSrc).toBe("text-logo:barlow-condensed:Nightmare Alley")
  })

  it("logoDisabled on the mapping suppresses the saved wordmark", async () => {
    mockedGetById.mockResolvedValue({
      tmdbId: 44,
      mediaType: "movie",
      title: "Mapped",
      posterPath: "/mapped-disabled.jpg",
      logoPath: null,
      logoText: "Nightmare Alley",
      logoFont: "oswald",
      logoDisabled: true,
      originalPosterPath: null,
      language: "it",
      showBadges: false,
      rankingBadges: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never)
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?badges=0&ranking=0&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)

    expect(lastInput().logoFetch).toBeNull()
  })
})
