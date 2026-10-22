/**
 * Route plumbing for space-wide exclusions (correction1).
 *
 * RED-before/GREEN-after for OUR tag/network feature: the route must forward
 * `disabledContentTags`/`disabledNetworks` from `resolvePosterConfig` into
 * EVERY badge input it builds (preflight `isNextEpisodeDisplayed` + debug
 * `computeTopBadge`) and into the service `GenerationInput`. Existing
 * library-level exclusion tests do not catch a missing forward here, so this
 * captures the actual route/config -> renderer inputs (not text search, not
 * optional-field typechecks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getImages, getExternalIds } from "@/lib/tmdb"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import * as posterBadge from "@/lib/poster-badge"
import * as posterService from "@/lib/poster-service"

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
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: true }))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

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
  hasJWOffers: vi.fn(async () => null),
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
  mdblistRemainingMs: vi.fn(() => null),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(async () => ({ id: 0, title: "T", genres: [] })),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  getReleaseDates: vi.fn(async () => null),
  getContentRatings: vi.fn(async () => null),
  resolveRequestApiKey: vi.fn(() => undefined),
  resolveUserApiKeys: vi.fn(async () => ({
    tmdb: { key: undefined, source: "none" },
    mdblist: { key: undefined, source: "none" },
    tvdb: { key: undefined, source: "none" },
  })),
}))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

const mockedGetById = vi.mocked(getById)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)

describe("route forwards disabledContentTags/disabledNetworks (correction1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    cacheClear()
    __resetTMDBSessionCache()
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("passes query dct/dnet into preflight badgeInput, debug badgeInput and GenerationInput", async () => {
    const seenBadgeInputs: Array<Record<string, unknown>> = []
    const seenGenInputs: Array<Record<string, unknown>> = []
    const origCompute = posterBadge.computeTopBadge
    const origIsNext = posterBadge.isNextEpisodeDisplayed
    vi.spyOn(posterBadge, "computeTopBadge").mockImplementation(((...args: Parameters<typeof origCompute>) => {
      seenBadgeInputs.push(args[0] as unknown as Record<string, unknown>)
      return origCompute(...args)
    }) as typeof origCompute)
    vi.spyOn(posterBadge, "isNextEpisodeDisplayed").mockImplementation(((arg: Parameters<typeof origIsNext>[0]) => {
      seenBadgeInputs.push(arg.badgeInput as unknown as Record<string, unknown>)
      return origIsNext(arg)
    }) as typeof origIsNext)
    vi.spyOn(posterService, "generatePosterBuffer").mockImplementation(async (genInput: unknown) => {
      seenGenInputs.push(genInput as Record<string, unknown>)
      const sharp = (await import("sharp")).default
      return sharp({ create: { width: 10, height: 10, channels: 4, background: "#000" } }).png().toBuffer()
    })

    const posterBytes = await (await import("sharp")).default({ create: { width: 500, height: 750, channels: 4, background: "#101010" } }).png().toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBytes), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))

    mockedGetDetails.mockResolvedValue({ id: 99001, title: "Plumb", genres: [], vote_average: 0, vote_count: 0 } as never)
    mockedGetImages.mockResolvedValue({ id: 99001, posters: [], logos: [], backdrops: [] } as never)
    mockedGetExternalIds.mockResolvedValue({ imdb_id: null } as never)

    // Debug request exercises BOTH route badgeInput sites (preflight via
    // isNextEpisodeDisplayed + debug computeTopBadge). rank=5 skips chart I/O.
    mockedGetById.mockResolvedValue({
      tmdbId: 99001,
      mediaType: "movie",
      title: "Plumb Debug",
      posterPath: "/plumb.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      updatedAt: "2026-10-22T00:00:00.000Z",
    } as never)
    const debugRes = await GET(
      new NextRequest("http://localhost:3000/api/poster/movie/99001?dct=trueStory&dnet=netflix&rank=5&debug=1"),
      { params: Promise.resolve({ type: "movie", id: "99001" }) },
    )
    expect(debugRes.status).toBe(200)

    // Normal render exercises the service GenerationInput path.
    mockedGetById.mockResolvedValue({
      tmdbId: 99002,
      mediaType: "movie",
      title: "Plumb Render",
      posterPath: "/plumb.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      updatedAt: "2026-10-22T00:00:01.000Z",
    } as never)
    mockedGetDetails.mockResolvedValue({ id: 99002, title: "Plumb Render", genres: [], vote_average: 0, vote_count: 0 } as never)
    const res = await GET(
      new NextRequest("http://localhost:3000/api/poster/movie/99002?dct=trueStory&dnet=netflix&rank=5"),
      { params: Promise.resolve({ type: "movie", id: "99002" }) },
    )
    expect(res.status).toBe(200)

    // Every captured route badgeInput must carry the effective disabled list.
    expect(seenBadgeInputs.length).toBeGreaterThan(0)
    for (const b of seenBadgeInputs) {
      expect(b["disabledContentTags"]).toEqual(["trueStory"])
    }
    // The renderer input must carry BOTH lists (tags + networks).
    expect(seenGenInputs.length).toBeGreaterThan(0)
    for (const g of seenGenInputs) {
      expect(g["disabledContentTags"]).toEqual(["trueStory"])
      expect(g["disabledNetworks"]).toEqual(["netflix"])
    }
  })
})
