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
import type { Mapping } from "@/lib/types"

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
  JW_DIGITAL_MONETIZATION_MODES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
}))

vi.mock("@/lib/stream-quality", () => ({
  resolveStreamQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/awards", () => ({
  fetchAllWikidata: vi.fn(async () => ({ awards: [], nominations: [], studios: [], director: null })),
  getAwardBadgeLabel: vi.fn(),
  getNominationBadgeLabel: vi.fn(),
  matchTMDBStudios: vi.fn(() => []),
  matchDirector: vi.fn((name: string | null) => name),
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
  default: { promises: { lookup: async () => [{ address: "93.84.216.34", family: 4 }] } },
  promises: { lookup: async () => [{ address: "93.84.216.34", family: 4 }] },
}))

const mockUndiciFetch = vi.mocked(undiciFetch as unknown as typeof fetch)

const mockedGetById = vi.mocked(getById)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetImages = vi.mocked(getImages)

function imageResponse(body: Buffer | string, contentType: string, status = 200): Response {
  return new Response(body as unknown as BodyInit, {
    status,
    headers: { "content-type": contentType },
  })
}

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()
}

const CUSTOM_BACKDROP = "https://i.imgur.com/backdrop123.png"

function baseMapping(overrides?: Partial<Mapping>): Mapping {
  return {
    tmdbId: 42,
    mediaType: "movie",
    title: "Test Movie",
    posterPath: "/poster.jpg",
    logoPath: null,
    originalPosterPath: "/poster.jpg",
    language: null,
    updatedAt: "2024-01-01T00:00:00.000Z",
    backdropPath: "/backdrop.jpg",
    customPosterUrl: null,
    ...overrides,
  }
}

async function renderPosterBytes(url: string): Promise<Buffer> {
  const res = await GET(new NextRequest(url), {
    params: Promise.resolve({ type: "movie", id: "42" }),
  })
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer())
}

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

describe("GET /api/poster custom landscape base", () => {
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
      backdrops: [
        { file_path: "/backdrop.jpg", iso_639_1: null, vote_average: 8, vote_count: 10, width: 1280, height: 720, aspect_ratio: 1.78 },
      ],
    } as never)
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetCustomImageStateForTests()
  })

  it("rejects an off-allowlist backdrop query with 400 (SSRF gate untouched)", async () => {
    mockedGetById.mockResolvedValue(null)
    const res = await GET(new NextRequest(`http://localhost:3000/api/poster/movie/42?backdrop=${encodeURIComponent("https://evil.com/x.png")}`), {
      params: Promise.resolve({ type: "movie", id: "42" }),
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain("backdrop")
  })

  it("query custom backdrop renders the landscape base through the shared validated fetch", async () => {
    mockedGetById.mockResolvedValue(null)
    // Real shared boundary: the custom backdrop travels via safeFetchRemote
    // (undici), the TMDB poster via global fetch. Preview exempt like the
    // live editor preview. Opaque red backdrop on a near-black poster: the
    // decoded diff proves the validated bytes reached the actual composition.
    const customPng = await imageBuffer("#ff0000", 1280, 720)
    mockUndiciFetch.mockResolvedValueOnce(imageResponse(customPng, "image/png"))
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const withCustom = await renderPosterBytes(
      `http://localhost:3000/api/poster/movie/42?shape=landscape&preview=1&backdrop=${encodeURIComponent(CUSTOM_BACKDROP)}`,
    )
    expect(mockUndiciFetch.mock.calls.map((c) => String(c[0]))).toContain(CUSTOM_BACKDROP)
    const control = await renderPosterBytes("http://localhost:3000/api/poster/movie/42?shape=landscape&preview=1")
    const { changed, total } = await countChangedPixels(withCustom, control)
    expect(changed).toBeGreaterThan(1000)
    expect(changed).toBeLessThan(total)
  })

  it("saved customBackdropUrl renders the landscape base with no query (Stremio path)", async () => {
    mockedGetById.mockResolvedValue(baseMapping({ posterShape: "landscape", customBackdropUrl: CUSTOM_BACKDROP }))
    const customPng = await imageBuffer("#ff0000", 1280, 720)
    mockUndiciFetch.mockResolvedValueOnce(imageResponse(customPng, "image/png"))
    const tmdb = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(tmdb), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const withCustom = await renderPosterBytes("http://localhost:3000/api/poster/movie/42?shape=landscape")
    expect(mockUndiciFetch.mock.calls.map((c) => String(c[0]))).toContain(CUSTOM_BACKDROP)
    // Distinct updatedAt: the saved custom travels server-side (mapping), so
    // the cache key only differs by `:mu` — same updatedAt would serve the
    // cached sibling (production bumps updatedAt on every save).
    mockedGetById.mockResolvedValue(baseMapping({ posterShape: "landscape", updatedAt: "2024-01-02T00:00:00.000Z" }))
    const control = await renderPosterBytes("http://localhost:3000/api/poster/movie/42?shape=landscape")
    const { changed, total } = await countChangedPixels(withCustom, control)
    // Full-base swap: nearly every pixel changes (red custom vs grey TMDB).
    expect(changed).toBeGreaterThan(total * 0.9)
  })

  it("portrait custom base unchanged: poster= custom still renders the portrait base", async () => {
    mockedGetById.mockResolvedValue(null)
    const customPng = await imageBuffer("#0000ff", 500, 750)
    mockUndiciFetch.mockResolvedValueOnce(imageResponse(customPng, "image/png"))
    const tmdb = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(tmdb), {
      status: 200,
      headers: { "content-type": "image/png" },
    }))
    const withCustom = await renderPosterBytes(
      `http://localhost:3000/api/poster/movie/42?preview=1&poster=${encodeURIComponent("https://i.imgur.com/portrait123.png")}`,
    )
    expect(mockUndiciFetch.mock.calls.map((c) => String(c[0]))).toContain("https://i.imgur.com/portrait123.png")
    const control = await renderPosterBytes("http://localhost:3000/api/poster/movie/42?preview=1")
    const { changed, total } = await countChangedPixels(withCustom, control)
    // Full-base swap: nearly every pixel changes (blue custom vs grey TMDB).
    expect(changed).toBeGreaterThan(total * 0.9)
  })
})
