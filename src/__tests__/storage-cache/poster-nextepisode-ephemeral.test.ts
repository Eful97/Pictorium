/**
 * Route-level next-episode freshness: the 120s cap applies ONLY when the
 * next-episode badge is the EFFECTIVE displayed top badge.
 *
 * - auto next displayed -> 120s
 * - competing rank / manual free text / disabled `new` sash bucket -> full TTL
 * - canonical manual token eligible -> 120s, elapsed -> full TTL (no stale)
 *
 * Deterministic fixture data, no live network (all upstream mocked).
 */
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds, getReleaseDates, getContentRatings } from "@/lib/tmdb"
import { getJWRankings, jwRankingsRemainingMs } from "@/lib/justwatch"
import { fetchMDBList, mdblistRemainingMs } from "@/lib/mdblist"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { NEXT_EPISODE_BADGE_KEY } from "@/lib/badge-priority"
import type { Mapping } from "@/lib/types"
import {
  __inMemoryChartGenerationPersist,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
} from "@/lib/chart-generation"

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/custom-rating")>()),
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
  const mocked = vi.fn(() => ({}))
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
  matchDirectorName: vi.fn((n: string | null) => n),
  directorBadgeLabel: vi.fn((n: string | null) => n),
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
vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  getReleaseDates: vi.fn(),
  getContentRatings: vi.fn(),
  resolveUserApiKeys: vi.fn(async () => ({
    tmdb: { key: undefined, source: "none" },
    mdblist: { key: undefined, source: "none" },
    tvdb: { key: undefined, source: "none" },
  })),
}))

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

const mockedGetById = vi.mocked(getById)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetReleaseDates = vi.mocked(getReleaseDates)
const mockedGetContentRatings = vi.mocked(getContentRatings)

const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

function maxAgeOf(res: Response): number | null {
  const cc = res.headers.get("Cache-Control") ?? ""
  const m = /max-age=(\d+)/.exec(cc)
  return m ? Number(m[1]) : null
}

async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 500, height: 750, channels: 4, background: color } }).png().toBuffer()
}

function mockTvDetails(airDate: string | null) {
  const details: Record<string, unknown> = {
    id: 777,
    name: "Show",
    genres: [{ id: 1, name: "Drama" }],
    vote_average: 5,
    vote_count: 10,
    type: "Series",
    status: "Returning Series",
    first_air_date: "2024-01-01",
    last_air_date: null,
    number_of_seasons: 2,
    number_of_episodes: null,
    next_episode_to_air: airDate ? { air_date: airDate } : null,
    networks: [],
    production_companies: [],
  }
  mockedGetDetails.mockResolvedValue(details as never)
  mockedGetDetailsWithExternalIds.mockResolvedValue({ ...details, external_ids: { imdb_id: null } } as never)
  mockedGetImages.mockResolvedValue({ id: 777, posters: [{ file_path: "/p.jpg", iso_639_1: null }], backdrops: [], logos: [] } as never)
  mockedGetExternalIds.mockResolvedValue({ imdb_id: null } as never)
  mockedGetReleaseDates.mockResolvedValue({ id: 777, results: [] } as never)
  mockedGetContentRatings.mockResolvedValue({ id: 777, results: [] } as never)
}

function mockMapping(customBadge: string | null) {
  if (customBadge === null) {
    mockedGetById.mockResolvedValue(null)
    return
  }
  mockedGetById.mockResolvedValue({
    tmdbId: 777,
    mediaType: "tv",
    title: "Show",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01",
    customBadge,
  } as Mapping)
}

describe("route next-episode ephemeral TTL (effective badge only)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
    // Real chart-state isolation (test hook, not a mock): a snapshot published
    // by an earlier test must not shadow the rank mocks below.
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    mockedGetById.mockReset()
    mockedGetJWRankings.mockResolvedValue([])
    mockedFetchMDBListReset()
    const poster = await png("#101010")
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      status: 200, headers: { "content-type": "image/png", "content-length": String(poster.length) },
    }))
  })

  afterEach(() => {
    cacheClear()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const tvUrl = (extra: string) => `http://localhost:3000/api/poster/tv/777?poster=%2Fq.jpg${extra}`

  it("auto next displayed gets the 120s cap", async () => {
    mockMapping(null)
    mockTvDetails(inDays(3))
    const res = await GET(new NextRequest(tvUrl("")), { params: Promise.resolve({ type: "tv", id: "777" }) })
    expect(res.status).toBe(200)
    expect(maxAgeOf(res)).toBe(120)
  })

  it("competing rank keeps the full TTL (eligible date, rank wins)", async () => {
    mockMapping(null)
    mockTvDetails(inDays(3))
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: 777, rank: 2 }] as never)
    const res = await GET(new NextRequest(tvUrl("")), { params: Promise.resolve({ type: "tv", id: "777" }) })
    expect(res.status).toBe(200)
    const maxAge = maxAgeOf(res)
    expect(maxAge).not.toBeNull()
    expect(maxAge as number).toBeGreaterThan(1000)
  })

  it("manual free text keeps the full TTL (manual wins over eligible auto)", async () => {
    mockMapping("My premiere")
    mockTvDetails(inDays(3))
    const res = await GET(new NextRequest(tvUrl("")), { params: Promise.resolve({ type: "tv", id: "777" }) })
    expect(res.status).toBe(200)
    const maxAge = maxAgeOf(res)
    expect(maxAge).not.toBeNull()
    expect(maxAge as number).toBeGreaterThan(1000)
  })

  it("disabled `new` sash bucket keeps the full TTL (auto next hidden)", async () => {
    mockMapping(null)
    mockTvDetails(inDays(3))
    const res = await GET(
      new NextRequest(tvUrl("&sash=upcoming,rank,award,extra")),
      { params: Promise.resolve({ type: "tv", id: "777" }) },
    )
    expect(res.status).toBe(200)
    const maxAge = maxAgeOf(res)
    expect(maxAge).not.toBeNull()
    expect(maxAge as number).toBeGreaterThan(1000)
  })

  it("canonical manual token gets the cap when eligible", async () => {
    mockMapping(NEXT_EPISODE_BADGE_KEY)
    mockTvDetails(inDays(3))
    const res = await GET(new NextRequest(tvUrl("")), { params: Promise.resolve({ type: "tv", id: "777" }) })
    expect(res.status).toBe(200)
    expect(maxAgeOf(res)).toBe(120)
  })

  it("elapsed manual token keeps the full TTL (no stale dated badge)", async () => {
    mockMapping(NEXT_EPISODE_BADGE_KEY)
    mockTvDetails(daysAgo(30))
    const res = await GET(new NextRequest(tvUrl("")), { params: Promise.resolve({ type: "tv", id: "777" }) })
    expect(res.status).toBe(200)
    const maxAge = maxAgeOf(res)
    expect(maxAge).not.toBeNull()
    expect(maxAge as number).toBeGreaterThan(1000)
  })
})

function mockedFetchMDBListReset() {
  vi.mocked(fetchMDBList).mockResolvedValue([])
  vi.mocked(mdblistRemainingMs).mockReturnValue(null)
  vi.mocked(jwRankingsRemainingMs).mockReturnValue(null)
}
