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
  hasJWOffers: vi.fn(async () => false),
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

const TEST_ADMIN_TOKEN = "route-tests-admin-token"
process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
const adminReq = (url: string) =>
  new NextRequest(url, { headers: { "x-admin-token": TEST_ADMIN_TOKEN } })

function futureDigitalDates() {
  const entry = (iso: string) => ({
    iso_3166_1: iso,
    release_dates: [{ release_date: "2099-01-01T00:00:00.000Z", type: 4 }],
  })
  return { id: 44, results: [entry("IT"), entry("US"), entry("GB")] }
}

describe("GET /api/poster pre-release detection (mocked production route)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    armEmptyUpstream()
    mockedGetReleaseDates.mockResolvedValue(futureDigitalDates() as never)
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
    `http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=1&preview=1${extra}&debug=1&api_key=test`

  async function debugOf(extra: string) {
    const res = await GET(adminReq(movieUrl(extra)), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    return (await res.json()).preRelease as { enabled: boolean; detected: boolean; applied: boolean }
  }

  it("pre ON: detected film is applied (ribbon + veil)", async () => {
    expect(await debugOf("&pre=1")).toMatchObject({ enabled: true, detected: true, applied: true })
  })

  it("pre OFF: detection still runs, but nothing is applied (beige path)", async () => {
    const pre = await debugOf("&pre=0")
    expect(pre).toMatchObject({ enabled: false, detected: true, applied: false })
    expect(mockedGetReleaseDates).toHaveBeenCalled()
  })

  it("old film (theatrical date > 1y): no upstream detection at all", async () => {
    const pre = await debugOf("&pre=0&rd=2001-05-01")
    expect(pre.detected).toBe(false)
    expect(mockedGetReleaseDates).not.toHaveBeenCalled()
  })
})
