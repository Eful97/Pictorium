import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { fetchAggregatedRating } from "@/lib/ratings"
import { __resetChartGenerationForTest, pinChartFamily } from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { getServerDefaultsChecked } from "@/lib/server-defaults"

// ---------------------------------------------------------------------------
// Poster chart-I/O gating: pinChartFamily revalidates durable storage, so the
// route must pin ONLY the families the request actually needs.
// - ranking=0 (or an explicit rank override) skips the JW pin;
// - custom ranking sources skip JW chart I/O entirely (anime stays);
// - a disabled ranking performs zero chart I/O.
// ---------------------------------------------------------------------------

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
  const mocked = vi.fn(async () => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return { ...mod, getServerDefaults: vi.fn(() => ({})), getServerDefaultsChecked: mocked }
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
vi.mock("@/lib/custom-ranking", () => ({
  fetchCustomRankingTop20: vi.fn(async () => ({ status: "empty", items: [] })),
  findRankingCustomCatalog: vi.fn((catalogs: Array<{ id: string }> | undefined, id: string) =>
    catalogs?.find((c) => c.id === id),
  ),
}))
vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})
vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(async () => ({})),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn(() => undefined),
  resolveUserApiKeys: vi.fn(async () => ({
    tmdb: { key: undefined, source: "none" },
    mdblist: { key: undefined, source: "none" },
    tvdb: { key: undefined, source: "none" },
    simkl: { key: undefined, source: "none" },
    fanart: { key: undefined, source: "none" },
  })),
}))
vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))
vi.mock("@/lib/chart-generation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-generation")>()
  return { ...mod, pinChartFamily: vi.fn(async () => ({ id: "live", snapshot: null })) }
})
vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn(async () => ({ id: "live", snapshot: null })) }
})

const mockedGetById = vi.mocked(getById)
const mockedPinChartFamily = vi.mocked(pinChartFamily)
const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

function savedTvMapping() {
  return {
    tmdbId: 42,
    mediaType: "tv",
    title: "Saved",
    posterPath: "/saved.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    showBadges: true,
    rankingBadges: true,
    badgeRank: 3,
    badgeLabel: "Serie",
    updatedAt: "2026-07-16T10:15:30.000Z",
  } as never
}

describe("GET /api/poster chart-I/O gating", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __resetImageBytesForTest()
    mockedPinChartFamily.mockResolvedValue({ id: "live", snapshot: null })
    mockedEnsureFresh.mockResolvedValue({ id: "live", snapshot: null } as never)
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
  })

  it("performs zero chart I/O when ranking is disabled", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue(savedTvMapping())
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )
    const req = new NextRequest("http://localhost:3000/api/poster/tv/42?debug=1&ranking=0")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "42" }) })
    expect(res.status).toBe(200)
    expect(mockedPinChartFamily).not.toHaveBeenCalled()
    expect(mockedEnsureFresh).not.toHaveBeenCalled()
  })

  it("skips the JW pin on an explicit rank override but keeps the anime pin", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue(savedTvMapping())
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )
    const req = new NextRequest("http://localhost:3000/api/poster/tv/42?debug=1&rank=5")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "42" }) })
    expect(res.status).toBe(200)
    const families = mockedPinChartFamily.mock.calls.map((c) => (c[0] as { family: string }).family)
    expect(families).not.toContain("jw:series:charts")
    expect(families).toContain("anime:series")
    for (const call of mockedEnsureFresh.mock.calls) {
      expect((call[0] as { family: string }).family).not.toMatch(/^jw:/)
    }
  })

  it("performs no JW chart I/O for a custom ranking source (anime behavior preserved)", async () => {
    const posterBuf = await imageBuffer("#101010", 500, 750)
    mockedGetById.mockResolvedValue(savedTvMapping())
    vi.mocked(getServerDefaultsChecked).mockResolvedValueOnce({
      defaultLogoFitEnabled: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      customCatalogs: [{ id: "my-list", name: "My List", type: "series", url: "https://mdblist.com/lists/u/my-list", enabled: true }],
      rankingSourceSeries: "my-list",
    } as never)
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(posterBuf), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
      }),
    )
    const req = new NextRequest("http://localhost:3000/api/poster/tv/42?debug=1")
    const res = await GET(req, { params: Promise.resolve({ type: "tv", id: "42" }) })
    expect(res.status).toBe(200)
    const pinned = mockedPinChartFamily.mock.calls.map((c) => (c[0] as { family: string }).family)
    expect(pinned).not.toContain("jw:series:charts")
    expect(pinned).toContain("anime:series")
    for (const call of mockedEnsureFresh.mock.calls) {
      expect((call[0] as { family: string }).family).not.toMatch(/^jw:/)
    }
  })
})
