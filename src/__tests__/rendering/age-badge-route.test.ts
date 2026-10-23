/**
 * Age-badge route contract (mocked production GET, no live credentials):
 * optional text age badge resolved per same-country TMDB lookup, independent
 * of the quality toggle, default OFF with zero extra network, and master
 * badges=0 hiding age with zero extra age network. Network failures degrade
 * to the ephemeral 120s TTL (fail-open, retried soon); genuine misses
 * (country absent) stay on the stable TTL.
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
import { resolveStreamQuality } from "@/lib/stream-quality"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAllWikidata } from "@/lib/awards"
import { fetchAggregatedRating } from "@/lib/ratings"
import * as posterService from "@/lib/poster-service"

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

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))

vi.mock("@/lib/svg-badge", async () => {
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#ffffff" } }).png().toBuffer()
  const png = () => ({ png: tiny, w: 8, h: 8 })
  return {
    renderGenreBadge: vi.fn(async () => png()),
    renderRankingBadge: vi.fn(async () => png()),
    renderExtraBadge: vi.fn(async () => png()),
    renderQualityBadge: vi.fn(async () => png()),
    renderQualityKnockoutBadge: vi.fn(async () => png()),
  }
})

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  // Task D freshness readers: fail-closed null in route tests (legacy TTL path).
  jwRankingsRemainingMs: vi.fn(() => null),
  jwTitlesRemainingMs: vi.fn(() => null),
  jwAvailabilityRemainingMs: vi.fn(() => null),
  JW_DIGITAL_MONETIZATION_TYPES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
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
  isValidWikidataQid: (v: unknown): v is string => typeof v === "string" && /^Q\d+$/.test(v),
}))

vi.mock("@/lib/mdblist", () => ({
  fetchMDBList: vi.fn(async () => []),
  // Task D freshness reader: fail-closed null in route tests (legacy TTL path).
  mdblistRemainingMs: vi.fn(() => null),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

vi.mock("@/lib/imdb-cache", () => ({
  resolveWikidataId: vi.fn(async () => null),
}))

vi.mock("@/lib/imdb-top250", () => ({
  isImdbTop250: vi.fn(async () => false),
  isImdbTop100: vi.fn(async () => false),
}))

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

const mockedGetById = vi.mocked(getById)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedGetReleaseDates = vi.mocked(getReleaseDates)
const mockedGetContentRatings = vi.mocked(getContentRatings)

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

function movieReleaseDatesIT() {
  return {
    id: 44,
    results: [
      {
        iso_3166_1: "IT",
        release_dates: [
          { certification: "VM14", release_date: "2024-01-10T00:00:00.000Z", type: 3 },
        ],
      },
      {
        iso_3166_1: "US",
        release_dates: [
          { certification: "PG-13", release_date: "2024-01-10T00:00:00.000Z", type: 3 },
        ],
      },
    ],
  }
}

function tvContentRatingsUS() {
  return {
    id: 1399,
    results: [
      { iso_3166_1: "US", rating: "TV-MA", descriptors: [] },
      { iso_3166_1: "IT", rating: "VM14", descriptors: [] },
    ],
  }
}

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

function armEmptyUpstream() {
  mockedGetById.mockResolvedValue(null)
  mockedGetDetails.mockResolvedValue({ ...EMPTY_DETAILS } as never)
  mockedGetDetailsWithExternalIds.mockResolvedValue({ ...EMPTY_DETAILS, external_ids: { imdb_id: null } } as never)
  mockedGetImages.mockResolvedValue({ id: 44, posters: [], logos: [], backdrops: [] })
  mockedGetExternalIds.mockResolvedValue({ imdb_id: null })
  mockedGetJWRankings.mockResolvedValue([])
  mockedGetReleaseDates.mockReset().mockResolvedValue({ id: 44, results: [] } as never)
  mockedGetContentRatings.mockReset().mockResolvedValue({ id: 1399, results: [] } as never)
  vi.mocked(fetchMDBList).mockResolvedValue([])
  vi.mocked(fetchAggregatedRating).mockResolvedValue(null)
  vi.mocked(resolveStreamQuality).mockResolvedValue(null as never)
  vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null })
}

describe("GET /api/poster age badge (mocked production route)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    vi.spyOn(posterService, "generatePosterBuffer")
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    armEmptyUpstream()
    const posterBuf = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBuf), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
    }))
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  const movieUrl = (extra: string) =>
    `http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=0&preview=1${extra}&api_key=test`
  const tvUrl = (extra: string) =>
    `http://localhost:3000/api/poster/tv/1399?poster=%2Fq.jpg&imdbId=tt0001399&badges=1&ranking=0&preview=1${extra}&api_key=test`

  // Saved-mapping branch (non-preview canonical render: exercises the real
  // Cache-Control TTL contract — keyless query overrides are stripped on
  // public instances, mappings are the Stremio path).
  function armMapping(mediaType: "movie" | "tv", tmdbId: number, extra: Record<string, unknown> = {}) {
    mockedGetById.mockResolvedValue({
      tmdbId,
      mediaType,
      title: "Mapped",
      posterPath: "/mapped.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      imdbId: tmdbId === 44 ? "tt0000044" : "tt0001399",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    })
  }
  const mappedUrl = (mediaType: "movie" | "tv", id: number, extra: string) =>
    `http://localhost:3000/api/poster/${mediaType}/${id}?rsrc=imdb,tmdb&badges=1&ranking=0${extra}&api_key=test`

  it("movie enabled IT resolves the same-country label with bounded signal fetch", async () => {
    mockedGetReleaseDates.mockResolvedValue(movieReleaseDatesIT() as never)
    const res = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.age.enabled).toBe(true)
    expect(body.age.country).toBe("IT")
    expect(body.age.label).toBe("VM14")
    expect(body.age.degraded).toBe(false)
    // Production bounds: same-country lookup only (one call), render signal,
    // 8s TMDB cap — never an unbounded or signal-less fetch.
    expect(mockedGetReleaseDates).toHaveBeenCalledTimes(1)
    const args = mockedGetReleaseDates.mock.calls[0]
    expect(args[0]).toBe("movie")
    expect(args[1]).toBe(44)
    expect(args[2]).toBe("test")
    expect(args[3]).toBeInstanceOf(AbortSignal)
    expect(args[4]).toBe(8000)
    // TV endpoint untouched for a movie lookup.
    expect(mockedGetContentRatings).not.toHaveBeenCalled()
  })

  it("tv enabled US resolves content_ratings without touching release_dates", async () => {
    mockedGetContentRatings.mockResolvedValue(tvContentRatingsUS() as never)
    const res = await GET(new NextRequest(tvUrl("&age=1&agecountry=US&debug=1")), {
      params: Promise.resolve({ type: "tv", id: "1399" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.age.enabled).toBe(true)
    expect(body.age.country).toBe("US")
    expect(body.age.label).toBe("TV-MA")
    expect(body.age.degraded).toBe(false)
    expect(mockedGetContentRatings).toHaveBeenCalledTimes(1)
    const args = mockedGetContentRatings.mock.calls[0]
    expect(args[0]).toBe(1399)
    expect(args[1]).toBe("test")
    expect(args[2]).toBeInstanceOf(AbortSignal)
    expect(args[3]).toBe(8000)
    expect(mockedGetReleaseDates).not.toHaveBeenCalled()
  })

  it("missing country hides the badge on a stable TTL (genuine miss, no fallback)", async () => {
    // Only US data: IT must hide (no US fallback), with ok=true (stable).
    mockedGetReleaseDates.mockResolvedValue({
      id: 44,
      results: [
        { iso_3166_1: "US", release_dates: [{ certification: "PG-13", release_date: "2024-01-10T00:00:00.000Z", type: 3 }] },
      ],
    } as never)
    const debug = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(debug.status).toBe(200)
    const body = await debug.json()
    expect(body.age.label).toBeNull()
    expect(body.age.degraded).toBe(false)
    // Stable canonical render: full cache policy, never the ephemeral 120s retry TTL.
    armMapping("movie", 44)
    const render = await GET(new NextRequest(mappedUrl("movie", 44, "&age=1&agecountry=IT")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(render.status).toBe(200)
    expect(render.headers.get("cache-control")).not.toContain("max-age=120")
  })

  it("default OFF performs zero extra age network (historical output unchanged)", async () => {
    const res = await GET(new NextRequest(movieUrl("&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.age.enabled).toBe(false)
    expect(body.age.label).toBeNull()
    expect(mockedGetReleaseDates).not.toHaveBeenCalled()
    expect(mockedGetContentRatings).not.toHaveBeenCalled()
  })

  it("master badges=0 hides age with zero extra age network", async () => {
    mockedGetReleaseDates.mockResolvedValue(movieReleaseDatesIT() as never)
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=0&ranking=0&preview=1&age=1&agecountry=IT&api_key=test",
    ), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    // No optional fetch purely for a hidden badge.
    expect(mockedGetReleaseDates).not.toHaveBeenCalled()
    expect(mockedGetContentRatings).not.toHaveBeenCalled()
    // Production renderer input carries no age label under master OFF.
    const spy = vi.mocked(posterService.generatePosterBuffer)
    expect(spy).toHaveBeenCalled()
    const genInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { ageLabel: string | null; badgesEnabled: boolean }
    expect(genInput.badgesEnabled).toBe(false)
    expect(genInput.ageLabel).toBeNull()
  })

  it("age enabled passes the label to the production renderer (master ON)", async () => {
    mockedGetReleaseDates.mockResolvedValue(movieReleaseDatesIT() as never)
    const res = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const spy = vi.mocked(posterService.generatePosterBuffer)
    expect(spy).toHaveBeenCalled()
    const genInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { ageLabel: string | null; badgesEnabled: boolean }
    expect(genInput.badgesEnabled).toBe(true)
    expect(genInput.ageLabel).toBe("VM14")
  })

  it("agebs=knockout resolves the knockout style end-to-end (debug + renderer input)", async () => {
    mockedGetReleaseDates.mockResolvedValue(movieReleaseDatesIT() as never)
    const debug = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&agebs=knockout&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(debug.status).toBe(200)
    const body = await debug.json()
    expect(body.age.style).toBe("knockout")
    expect(body.age.label).toBe("VM14")
    // The debug branch returns before compositing: a real render request
    // carries the resolved style into the production renderer input.
    const render = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&agebs=knockout")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(render.status).toBe(200)
    const spy = vi.mocked(posterService.generatePosterBuffer)
    expect(spy).toHaveBeenCalled()
    const genInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { ageBadgeStyle: string | null }
    expect(genInput.ageBadgeStyle).toBe("knockout")
  })

  it("default age style is standard and invalid agebs collapses to it", async () => {
    mockedGetReleaseDates.mockResolvedValue(movieReleaseDatesIT() as never)
    const plain = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(plain.status).toBe(200)
    expect((await plain.json()).age.style).toBe("standard")
    const garbage = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&agebs=mono&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(garbage.status).toBe(200)
    expect((await garbage.json()).age.style).toBe("standard")
    const render = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&agebs=mono")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(render.status).toBe(200)
    const spy = vi.mocked(posterService.generatePosterBuffer)
    const last = spy.mock.calls[spy.mock.calls.length - 1][0] as { ageBadgeStyle: string | null }
    expect(last.ageBadgeStyle).toBe("standard")
  })

  it("network failure degrades to the ephemeral 120s TTL (fail-open, retried soon)", async () => {
    mockedGetReleaseDates.mockRejectedValue(new Error("upstream boom"))
    const debug = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(debug.status).toBe(200)
    const body = await debug.json()
    // Fail-open: badge hidden, degraded flagged for retry.
    expect(body.age.label).toBeNull()
    expect(body.age.degraded).toBe(true)
    // Canonical render carries the ephemeral retry TTL, never the full one.
    armMapping("movie", 44)
    const render = await GET(new NextRequest(mappedUrl("movie", 44, "&age=1&agecountry=IT")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(render.status).toBe(200)
    expect(render.headers.get("cache-control")).toContain("max-age=120")
  })

  it("movie pre-release and age share the release_dates lookup without interference", async () => {
    // Theatrical certification for age + digital date for pre detection on
    // the same same-country entry (single shared tmdbFetch URL upstream).
    mockedGetReleaseDates.mockResolvedValue({
      id: 44,
      results: [
        {
          iso_3166_1: "IT",
          release_dates: [
            { certification: "VM14", release_date: "2024-01-10T00:00:00.000Z", type: 3 },
            { certification: "", release_date: "2024-06-01T00:00:00.000Z", type: 4 },
          ],
        },
      ],
    } as never)
    const res = await GET(new NextRequest(movieUrl("&age=1&agecountry=IT&pre=1&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.age.label).toBe("VM14")
    // Pre-release path still resolves through the shared lookup (no crash,
    // no missing contract after the age gating change).
    expect(body.preRelease).toBeDefined()
    expect(mockedGetReleaseDates).toHaveBeenCalled()
  })
})
