/**
 * Route plumbing for "Dove guardare": `wp`/`wpr` decide whether and for which
 * country the provider list is fetched, and the list reaches the service input.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getImages, getExternalIds } from "@/lib/tmdb"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import * as posterService from "@/lib/poster-service"
import { getWatchProvidersResult } from "@/lib/watch-providers"

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

vi.mock("@/lib/watch-providers", () => ({
  getWatchProvidersResult: vi.fn(async () => ({ providers: [{ id: 8, name: "Netflix", logoPath: "/n.jpg" }], failed: false })),
}))
const mockedProviders = vi.mocked(getWatchProvidersResult)

async function renderOnce(query: string, tmdbId: number): Promise<Record<string, unknown> & { cacheControl: string }> {
  const seen: Array<Record<string, unknown>> = []
  vi.spyOn(posterService, "generatePosterBuffer").mockImplementation(async (genInput: unknown) => {
    seen.push(genInput as Record<string, unknown>)
    const sharp = (await import("sharp")).default
    return sharp({ create: { width: 10, height: 10, channels: 4, background: "#000" } }).png().toBuffer()
  })
  const posterBytes = await (await import("sharp")).default({ create: { width: 500, height: 750, channels: 4, background: "#101010" } }).png().toBuffer()
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBytes), { status: 200, headers: { "content-type": "image/png" } }))
  vi.mocked(getDetails).mockResolvedValue({ id: tmdbId, title: "WP", genres: [], vote_average: 0, vote_count: 0 } as never)
  vi.mocked(getImages).mockResolvedValue({ id: tmdbId, posters: [], logos: [], backdrops: [] } as never)
  vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null } as never)
  vi.mocked(getById).mockResolvedValue({
    tmdbId, mediaType: "movie", title: "WP", posterPath: "/wp.jpg", logoPath: null, originalPosterPath: null,
    language: "it", showBadges: true, rankingBadges: true, updatedAt: "2026-10-22T00:00:00.000Z",
  } as never)
  const res = await GET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${tmdbId}?rank=5${query}`),
    { params: Promise.resolve({ type: "movie", id: String(tmdbId) }) },
  )
  expect(res.status).toBe(200)
  expect(seen.length).toBe(1)
  return { ...seen[0], cacheControl: res.headers.get("cache-control") ?? "" }
}

describe("route forwards watch providers", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockedProviders.mockClear()
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("wp=1&wpr=US fetches for US and passes the list to the service", async () => {
    const gen = await renderOnce("&wp=1&wpr=US", 99101)
    expect(mockedProviders).toHaveBeenCalledTimes(1)
    expect(mockedProviders.mock.calls[0].slice(0, 3)).toEqual(["movie", 99101, "US"])
    expect(gen.watchProviders).toEqual([{ id: 8, name: "Netflix", logoPath: "/n.jpg" }])
  })

  it("without wpr falls back to the poster region (IT)", async () => {
    await renderOnce("&wp=1", 99102)
    expect(mockedProviders.mock.calls[0][2]).toBe("IT")
  })

  it("switch OFF: no fetch, no list", async () => {
    const gen = await renderOnce("", 99103)
    expect(mockedProviders).not.toHaveBeenCalled()
    expect(gen.watchProviders ?? []).toEqual([])
  })

  it("provider fetch failure/empty never breaks the render", async () => {
    mockedProviders.mockResolvedValueOnce({ providers: [], failed: false })
    const gen = await renderOnce("&wp=1", 99104)
    expect(gen.watchProviders ?? []).toEqual([])
  })

  it("a failed fetch gets the short degraded TTL; a genuine empty result keeps the normal one", async () => {
    mockedProviders.mockResolvedValueOnce({ providers: [], failed: false })
    const normal = await renderOnce("&wp=1", 99105)
    cacheClear()
    mockedProviders.mockResolvedValueOnce({ providers: [], failed: true })
    const degraded = await renderOnce("&wp=1", 99106)
    expect(degraded.cacheControl).not.toBe(normal.cacheControl)
    expect(degraded.cacheControl).toContain("120")
    expect(normal.cacheControl).not.toContain("max-age=120,")
  })
})
