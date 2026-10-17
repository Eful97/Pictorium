import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getImages } from "@/lib/tmdb"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAggregatedRating } from "@/lib/ratings"
import { renderMultiRatings } from "@/lib/multi-rating-renderer"
import { __resetCustomImageStateForTests } from "@/lib/custom-poster-base"
import { resetSafeFetchForTests } from "@/lib/safe-remote-fetch"
import { fetch as undiciFetch } from "undici"

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

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(async () => ({ id: 42, title: "Test", genres: [], vote_average: 0, vote_count: 0 })),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
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

vi.mock("undici", () => ({
  Agent: class MockUndiciAgent {
    constructor(_opts?: unknown) {}
  },
  fetch: vi.fn(),
}))

vi.mock("node:dns", () => ({
  default: { promises: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] } },
  promises: { lookup: async () => [{ address: "93.184.216.34", family: 4 }] },
}))

const mockUndiciFetch = vi.mocked(undiciFetch as unknown as typeof fetch)

const mockedGetById = vi.mocked(getById)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetImages = vi.mocked(getImages)

function imageResponse(body: Buffer | string, contentType: string, status = 200): Response {
  return new Response(body as unknown as BodyInit, { status, headers: { "content-type": contentType } })
}

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()
}

const CUSTOM_LOGO = "https://i.imgur.com/logo123.png"
const CUSTOM_MAPPED_LOGO = "https://i.imgur.com/logo-mapped.png"

async function renderPosterBytes(url: string): Promise<Buffer> {
  const res = await GET(new NextRequest(url), {
    params: Promise.resolve({ type: "movie", id: "42" }),
  })
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Decoded pixel diff between two renders. A silently dropped custom logo
 * still answers 200, so request invocation alone proves nothing — the logo
 * must reach the actual composition and change the decoded pixels.
 */
async function countChangedPixels(a: Buffer, b: Buffer): Promise<{ changed: number; total: number }> {
  const ra = await sharp(a).raw().toBuffer({ resolveWithObject: true })
  const rb = await sharp(b).raw().toBuffer({ resolveWithObject: true })
  expect(ra.info.width).toBe(rb.info.width)
  expect(ra.info.height).toBe(rb.info.height)
  expect(ra.info.channels).toBe(rb.info.channels)
  const px = ra.info.width * ra.info.height
  const ch = ra.info.channels
  let changed = 0
  for (let i = 0; i < px; i++) {
    let d = 0
    for (let c = 0; c < ch; c++) d = Math.max(d, Math.abs(ra.data[i * ch + c] - rb.data[i * ch + c]))
    if (d > 12) changed++
  }
  return { changed, total: px }
}

describe("GET /api/poster custom logo path", () => {
  beforeEach(() => {
    __resetImageBytesForTest()
    __resetCustomImageStateForTests()
    resetSafeFetchForTests()
    mockUndiciFetch.mockReset()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.mocked(renderMultiRatings).mockClear()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    mockedGetDetails.mockResolvedValue({
      id: 42,
      title: "Test Movie",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2024-01-15",
      production_companies: [],
    } as never)
    mockedGetImages.mockResolvedValue({
      id: 42,
      posters: [
        { file_path: "/poster.jpg", iso_639_1: null, vote_average: 8, vote_count: 10, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [{ file_path: "/logo.png", iso_639_1: "en", vote_average: 0, vote_count: 0, width: 220, height: 80, aspect_ratio: 2.75 }],
      backdrops: [],
    } as never)
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetCustomImageStateForTests()
  })

  it("rejects an off-allowlist logo query with 400", async () => {
    mockedGetById.mockResolvedValue(null)
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/42?logo=https://evil.com/logo.png"), {
      params: Promise.resolve({ type: "movie", id: "42" }),
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("logo")
  })

  it("backdrop custom allowlisted passes the gate (same bar as poster/logo, landscape bases)", async () => {
    mockedGetById.mockResolvedValue(null)
    const res = await GET(new NextRequest(`http://localhost:3000/api/poster/movie/42?backdrop=${encodeURIComponent(CUSTOM_LOGO)}`), {
      params: Promise.resolve({ type: "movie", id: "42" }),
    })
    // Gate: allowlisted custom backdrops are accepted like custom poster/logo
    // (server consumption via the shared validated fetch — see
    // custom-backdrop-route.test.ts). Off-allowlist hosts stay 400.
    expect(res.status).not.toBe(400)
    const evil = await GET(new NextRequest("http://localhost:3000/api/poster/movie/42?backdrop=https://evil.com/x.png"), {
      params: Promise.resolve({ type: "movie", id: "42" }),
    })
    expect(evil.status).toBe(400)
    expect(await evil.text()).toContain("backdrop")
  })

  it("query custom logo succeeds through the shared validated fetch", async () => {
    mockedGetById.mockResolvedValue(null)
    // Real shared boundary: the custom logo travels via safeFetchRemote
    // (undici), the TMDB poster via global fetch. Preview is exempt from the
    // public-anonymous image-override strip, like the live editor preview.
    // Opaque red logo on a near-black base: dropping it would leave the
    // control render byte-near-identical, so the decoded diff proves the
    // validated bytes reached the actual composition (not just the fetch).
    const logoPng = await imageBuffer("#ff0000", 400, 200)
    mockUndiciFetch.mockResolvedValueOnce(imageResponse(logoPng, "image/png"))
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const withLogo = await renderPosterBytes(
      `http://localhost:3000/api/poster/movie/42?preview=1&logo=${encodeURIComponent(CUSTOM_LOGO)}`,
    )
    expect(mockUndiciFetch.mock.calls.map((c) => String(c[0]))).toContain(CUSTOM_LOGO)
    const control = await renderPosterBytes("http://localhost:3000/api/poster/movie/42?preview=1")
    const { changed, total } = await countChangedPixels(withLogo, control)
    expect(changed).toBeGreaterThan(1000)
    expect(changed).toBeLessThan(total)
  })

  it("saved mapped custom logo succeeds through the shared validated fetch", async () => {
    const logoPng = await imageBuffer("#ff0000", 400, 200)
    mockUndiciFetch.mockResolvedValueOnce(imageResponse(logoPng, "image/png"))
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "movie",
      title: "Saved",
      posterPath: "/poster.jpg",
      logoPath: CUSTOM_MAPPED_LOGO,
      originalPosterPath: null,
      language: "it",
      showBadges: false,
      rankingBadges: false,
      updatedAt: "2026-07-16T10:15:30.000Z",
    } as never)
    const withLogo = await renderPosterBytes("http://localhost:3000/api/poster/movie/42")
    expect(mockUndiciFetch.mock.calls.map((c) => String(c[0]))).toContain(CUSTOM_MAPPED_LOGO)
    // Same mapping without the saved logo (bumped updatedAt so the control
    // cannot serve the logo render from the poster cache key).
    mockedGetById.mockResolvedValue({
      tmdbId: 42,
      mediaType: "movie",
      title: "Saved",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: false,
      rankingBadges: false,
      updatedAt: "2026-07-16T10:15:31.000Z",
    } as never)
    const control = await renderPosterBytes("http://localhost:3000/api/poster/movie/42")
    const { changed, total } = await countChangedPixels(withLogo, control)
    expect(changed).toBeGreaterThan(1000)
    expect(changed).toBeLessThan(total)
  })
})
