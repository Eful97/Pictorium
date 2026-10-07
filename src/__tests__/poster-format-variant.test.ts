import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds } from "@/lib/tmdb"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import * as runtimeCache from "@/lib/poster-runtime-cache"
import {
  FORMAT_QUEUE_LIMIT,
  __resetFormatGateForTests,
  runFormatConversion,
} from "@/lib/poster-format-gate"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAggregatedRating } from "@/lib/ratings"
import { renderMultiRatings } from "@/lib/multi-rating-renderer"

// Same fixture pattern as poster-route-mapping.test.ts: upstream mocked,
// image bytes real (local sharp, no network), full GET through the route.
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
  getDetailsWithExternalIds: vi.fn(async () => null),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn(() => undefined),
  resolveUserApiKeys: vi.fn(async () => {
    const none = { key: undefined, source: "none" } as const
    return { tmdb: none, mdblist: none, tvdb: none }
  }),
}))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

const mockedGetById = vi.mocked(getById)
void vi.mocked(getDetails)
void vi.mocked(getDetailsWithExternalIds)
void vi.mocked(getImages)
void vi.mocked(getExternalIds)

const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms) })

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

function savedMapping(tmdbId: number) {
  return {
    tmdbId,
    mediaType: "movie" as const,
    title: "Variant Gate",
    posterPath: "/variant.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    showBadges: false,
    rankingBadges: false,
    updatedAt: "2026-07-16T10:15:30.000Z",
  }
}

// ?fmt=jpeg against the default webp canonical: every miss converts.
const urlFor = (id: number) => `http://localhost:3000/api/poster/movie/${id}?fmt=jpeg`
const get = (id: number) =>
  GET(new NextRequest(urlFor(id)), { params: Promise.resolve({ type: "movie", id: String(id) }) })

describe("GET poster variant through the format gate (mocked encoder)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    cacheClear()
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    __resetFormatGateForTests()
    runtimeCache.__resetPosterRenderLimiter()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.mocked(renderMultiRatings).mockClear()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetFormatGateForTests()
    runtimeCache.__resetPosterRenderLimiter()
  })

  it("coalesces concurrent misses of the same variant into one encode; hits encode zero times", async () => {
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(poster), { status: 200, headers: { "content-type": "image/png" } }),
    )
    mockedGetById.mockResolvedValue(savedMapping(42))
    // Slow the encoder so all five concurrent misses overlap on one key.
    const realConvertToJpeg = runtimeCache.convertToJpeg
    let encodes = 0
    vi.spyOn(runtimeCache, "convertToJpeg").mockImplementation(async (buf) => {
      encodes++
      await sleep(150)
      return realConvertToJpeg(buf)
    })

    const resps = await Promise.all(Array.from({ length: 5 }, () => get(42)))
    for (const r of resps) expect(r.status).toBe(200)
    expect(resps[0].headers.get("Content-Type")).toBe("image/jpeg")
    const bodies = await Promise.all(resps.map((r) => r.arrayBuffer()))
    for (const b of bodies) expect(Buffer.from(b).equals(Buffer.from(bodies[0]))).toBe(true)
    expect(encodes).toBe(1)

    // Variant cache hit: served without any further encode.
    const hit = await get(42)
    expect(hit.status).toBe(200)
    expect(Buffer.from(await hit.arrayBuffer()).equals(Buffer.from(bodies[0]))).toBe(true)
    expect(encodes).toBe(1)
  })

  it("answers 503 on gate overload without writing the error cache", async () => {
    const poster = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array(poster), { status: 200, headers: { "content-type": "image/png" } }),
    )
    mockedGetById.mockResolvedValue(savedMapping(43))
    const errSpy = vi.spyOn(runtimeCache, "writePosterError")
    // Saturate the dedicated gate (2 natives held, bounded queue full) with
    // deferred leaders; queued sleepers drain on their own at cleanup.
    let releaseLeaders!: () => void
    const leaderGate = new Promise<void>((r) => { releaseLeaders = r })
    const held = [
      runFormatConversion("t:over:0", () => leaderGate.then(() => Buffer.from("l0"))),
      runFormatConversion("t:over:1", () => leaderGate.then(() => Buffer.from("l1"))),
    ]
    const queued: Array<Promise<Buffer>> = []
    for (let i = 0; i < FORMAT_QUEUE_LIMIT; i++) {
      queued.push(runFormatConversion(`t:over:q${i}`, async () => {
        await sleep(30)
        return Buffer.from("q")
      }))
    }

    const res = await get(43)
    expect(res.status).toBe(503)
    expect(res.headers.get("Retry-After")).not.toBeNull()
    expect(errSpy).not.toHaveBeenCalled()

    // Drain with no leaks, then retry: 200 proves no poison (a cached 5s
    // negative entry would still answer 503 here).
    releaseLeaders()
    await Promise.all([...held, ...queued])
    __resetFormatGateForTests()
    const retry = await get(43)
    expect(retry.status).toBe(200)
    expect(retry.headers.get("Content-Type")).toBe("image/jpeg")
  })
})
