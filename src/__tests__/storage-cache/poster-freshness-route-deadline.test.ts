// Task D correction — route-level fake-clock regression (not a pure helper test).
// Aged source + render delay + cached 200/304 + non-canonical variant +
// waiter/hit: no full TTL / sliding / stale after the fact deadline.
// Policy-shorter/jitter unaffected; image bytes TTL independent.
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds } from "@/lib/tmdb"
import { getJWRankings, jwRankingsRemainingMs } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { cachedImageBytes, peekImageBytes, __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { renderRankingBadge } from "@/lib/svg-badge"
import * as runtimeCache from "@/lib/poster-runtime-cache"
import * as posterService from "@/lib/poster-service"
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
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: false, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
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
  getReleaseDates: vi.fn(async () => []),
  getContentRatings: vi.fn(async () => []),
  resolveUserApiKeys: vi.fn(async () => ({
    tmdb: { key: undefined, source: "none" },
    mdblist: { key: undefined, source: "none" },
    tvdb: { key: undefined, source: "none" },
  })),
}))

const mockedGetById = vi.mocked(getById)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedJwRemaining = vi.mocked(jwRankingsRemainingMs)
const mockedFetchMDBList = vi.mocked(fetchMDBList)
const mockedRenderRankingBadge = vi.mocked(renderRankingBadge)

const T0 = Date.UTC(2026, 9, 15, 21, 59, 0)
// T0 is 60s before the Rome midnight slot boundary (23:59 Rome = 21:59 UTC,
// slot 20261015-12 ends at 22:00 UTC): the published snapshot expires at the
// boundary, so the original 60/5/0 assertions stay meaningful and strict.
// Same-slot snapshots are served even after the underlying rolling source
// caches expire — the cap follows the snapshot, not the mocked rolling
// remaining below (kept only as the boundary fallback).
const FACT_TTL_MS = 60_000
const FACT_EXPIRES_AT = T0 + FACT_TTL_MS
let fakeNow = T0

function maxAgeOf(res: Response): number | null {
  const cc = res.headers.get("Cache-Control") ?? ""
  const m = /max-age=(\d+)/.exec(cc)
  return m ? Number(m[1]) : null
}

/** All three CDN-visible headers for a poster response. */
function cdnHeaders(res: Response): { cc: string; cdn: string; sur: string } {
  return {
    cc: res.headers.get("Cache-Control") ?? "",
    cdn: res.headers.get("CDN-Cache-Control") ?? "",
    sur: res.headers.get("Surrogate-Control") ?? "",
  }
}

/** Fact-capped responses must never allow CDN stale serving past the deadline. */
function expectNoSwrCapped(res: Response): void {
  const { cc, cdn, sur } = cdnHeaders(res)
  for (const h of [cc, cdn, sur]) {
    expect(h).not.toContain("stale-while-revalidate")
    expect(h).not.toContain("stale-if-error")
    expect(h).not.toContain("immutable")
    expect(h).not.toContain("31536000")
  }
  expect(cc).toContain("must-revalidate")
}

async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 500, height: 750, channels: 4, background: color } }).png().toBuffer()
}

describe("route-level fact deadline (fake clock, no sliding, no variant extension)", () => {
  beforeEach(async () => {
    fakeNow = T0
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
    cacheClear()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    vi.restoreAllMocks()
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    vi.spyOn(runtimeCache, "schedulePosterRefresh").mockImplementation(() => {})
    // Dynamic (unmapped) title with a live rank 3 baked in.
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({ id: 424242, title: "Deadline", genres: [], vote_average: 5, vote_count: 10 } as never)
    mockedGetDetailsWithExternalIds.mockResolvedValue({ id: 424242, title: "Deadline", genres: [], vote_average: 5, vote_count: 10, external_ids: { imdb_id: "tt424242" } } as never)
    mockedGetImages.mockResolvedValue({ posters: [{ file_path: "/dl.jpg", iso_639_1: null }], backdrops: [], logos: [] } as never)
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt424242" } as never)
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: 424242, rank: 3 }] as never)
    mockedFetchMDBList.mockResolvedValue([])
    // Rank-dependent badge (real PNG bytes): rank 3 bakes red, any other
    // rank bakes blue — a rank change provably changes the pixels/ETag.
    const badgeRed = await sharp({ create: { width: 100, height: 30, channels: 4, background: "#ff0000" } }).png().toBuffer()
    const badgeBlue = await sharp({ create: { width: 100, height: 30, channels: 4, background: "#0000ff" } }).png().toBuffer()
    mockedRenderRankingBadge.mockReset().mockImplementation(async (rank: unknown) => (
      rank === 3 ? { png: badgeRed, w: 100, h: 30 } : { png: badgeBlue, w: 100, h: 30 }
    ) as never)
    // Absolute provenance: remaining = FACT_EXPIRES_AT - now (never now+TTL).
    mockedJwRemaining.mockImplementation((_a?: unknown, _b?: unknown, _c?: unknown, _d?: unknown, _e?: unknown, nowMs?: number) => {
      const now = nowMs ?? Date.now()
      const rem = FACT_EXPIRES_AT - now
      return rem > 0 ? rem : null
    })
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

  it("fresh render advertises the capped remaining (floor), never the full 6h policy nor immutable", async () => {
    const req = new NextRequest("http://localhost:3000/api/poster/movie/424242")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "424242" }) })
    expect(res.status).toBe(200)
    const maxAge = maxAgeOf(res)
    expect(maxAge).not.toBeNull()
    // ~60s cap, floored; a full policy TTL would be ~6h (21600s).
    expect(maxAge as number).toBeLessThanOrEqual(60)
    expect(maxAge as number).toBeGreaterThanOrEqual(59)
    expectNoSwrCapped(res)
    expect(res.headers.get("Cache-Control")).not.toContain("max-age=86400")
  })

  it("near-deadline HIT/304 advertise ~5s remaining (floor, no round-up) and the variant cannot extend", async () => {
    const first = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
    expect(first.status).toBe(200)
    expectNoSwrCapped(first)
    const etag = first.headers.get("etag")!
    // 55s later: 5s left. Stored ttlSec is still 60 — HTTP must say ~5.
    fakeNow = T0 + 55_000
    const hit = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
    expect(hit.status).toBe(200)
    expectNoSwrCapped(hit)
    expect(maxAgeOf(hit)).toBeLessThanOrEqual(5)
    expect(maxAgeOf(hit)).toBeGreaterThanOrEqual(4)
    // 304 on the same aged entry advertises the same remaining, not a fresh TTL.
    const notMod = await GET(
      new NextRequest("http://localhost:3000/api/poster/movie/424242", { headers: { "If-None-Match": etag } }),
      { params: Promise.resolve({ type: "movie", id: "424242" }) },
    )
    expect(notMod.status).toBe(304)
    expectNoSwrCapped(notMod)
    expect(maxAgeOf(notMod)).toBeLessThanOrEqual(5)
    // Non-canonical variant (?fmt=jpeg) from the canonical HIT inherits the
    // ~5s deadline instead of minting a full variant TTL.
    const variant = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242?fmt=jpeg"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
    expect(variant.status).toBe(200)
    expectNoSwrCapped(variant)
    expect(maxAgeOf(variant)).toBeLessThanOrEqual(5)
    expect(maxAgeOf(variant)).toBeGreaterThanOrEqual(0)
    // Variant 304 carries the same capped no-SWR policy.
    const variantEtag = variant.headers.get("etag")!
    const variantNotMod = await GET(
      new NextRequest("http://localhost:3000/api/poster/movie/424242?fmt=jpeg", { headers: { "If-None-Match": variantEtag } }),
      { params: Promise.resolve({ type: "movie", id: "424242" }) },
    )
    expect(variantNotMod.status).toBe(304)
    expectNoSwrCapped(variantNotMod)
    expect(maxAgeOf(variantNotMod)).toBeLessThanOrEqual(5)
  })

  it("past the fact deadline the entry re-renders (new ETag) instead of stale-serving", async () => {
    const writeSpy = vi.spyOn(runtimeCache, "writeCachedPoster")
    const first = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
    expect(first.status).toBe(200)
    const etag1 = first.headers.get("etag")!
    const writesBefore = writeSpy.mock.calls.length
    expect(writesBefore).toBeGreaterThan(0)
    // Expire the fact AND change the live rank: rank 3 bakes a badge, rank 7
    // bakes none — a genuine re-render must produce a different ETag. (The
    // rank preflight runs before cache on every request, so preflight call
    // counts prove nothing; pixels + cache writes do.)
    fakeNow = T0 + 61_000
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: 424242, rank: 7 }] as never)
    const after = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
    expect(after.status).toBe(200)
    expect(writeSpy.mock.calls.length).toBeGreaterThan(writesBefore)
    expect(after.headers.get("etag")).not.toBe(etag1)
    // A conditional with the OLD etag after expiry revalidates to 200 with the
    // new bytes — never a 304 on the stale copy.
    const reval = await GET(
      new NextRequest("http://localhost:3000/api/poster/movie/424242", { headers: { "If-None-Match": etag1 } }),
      { params: Promise.resolve({ type: "movie", id: "424242" }) },
    )
    expect(reval.status).toBe(200)
    expect(reval.headers.get("etag")).not.toBe(etag1)
    writeSpy.mockRestore()
  })

  it("render delay past the deadline stores nothing and serves max-age=0 without SWR", async () => {
    const writeSpy = vi.spyOn(runtimeCache, "writeCachedPoster")
    const writesBefore = writeSpy.mock.calls.length
    // Deterministic render delay THROUGH the real composite: advancing the
    // fake clock inside generatePosterBuffer lands writeNowMs past the
    // absolute fact expiry. The write must observe the expiry at write time:
    // deadline already passed → no cache write with a fresh TTL, response is
    // max-age=0 must-revalidate, never SWR/immutable.
    const origGenerate = posterService.generatePosterBuffer
    const genSpy = vi.spyOn(posterService, "generatePosterBuffer").mockImplementation(async (input) => {
      fakeNow += 65_000
      return origGenerate(input)
    })
    try {
      const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
      expect(res.status).toBe(200)
      expect(maxAgeOf(res)).toBe(0)
      expectNoSwrCapped(res)
      expect(res.headers.get("Cache-Control")).toContain("max-age=0")
      expect(writeSpy.mock.calls.length).toBe(writesBefore)
    } finally {
      genSpy.mockRestore()
      writeSpy.mockRestore()
    }
  })

  it("retained previous-slot pin on outage serves the pinned rank with a zero deadline (no rolling-TTL fallthrough)", async () => {
    const writeSpy = vi.spyOn(runtimeCache, "writeCachedPoster")
    try {
      const first = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
      expect(first.status).toBe(200)
      const etag1 = first.headers.get("etag")!
      const writesBefore = writeSpy.mock.calls.length
      expect(writesBefore).toBeGreaterThan(0)
      // Cross the Rome slot boundary with the upstream down: the refresh
      // fails and the previous-slot pin is retained (no saved-rank fallback —
      // the mapping is null — and no rolling-TTL extension past the list).
      fakeNow = T0 + 61_000
      mockedGetJWRankings.mockRejectedValueOnce(new Error("Ranking source unavailable"))
      const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
      expect(res.status).toBe(200)
      // Retained rank 3: the same red-badge bytes as before the boundary.
      expect(res.headers.get("etag")).toBe(etag1)
      // The pinned snapshot expired at the boundary: zero deadline,
      // must-revalidate, no SWR anywhere, and no fresh poster write carrying
      // a future TTL.
      expect(maxAgeOf(res)).toBe(0)
      expectNoSwrCapped(res)
      expect(res.headers.get("Cache-Control")).toContain("max-age=0")
      expect(writeSpy.mock.calls.length).toBe(writesBefore)
    } finally {
      writeSpy.mockRestore()
    }
  })

  it("render starting on a retained previous-slot pin stores nothing and serves max-age=0", async () => {
    const writeSpy = vi.spyOn(runtimeCache, "writeCachedPoster")
    try {
      const first = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
      expect(first.status).toBe(200)
      const etag1 = first.headers.get("etag")!
      const writesBefore = writeSpy.mock.calls.length
      expect(writesBefore).toBeGreaterThan(0)
      // Boundary already crossed with the upstream down: the render starts on
      // an expired (retained) pin and the delay pushes the write further past
      // the pinned slot end. The write-time recompute must observe the pinned
      // expiry — not the future next-slot deadline — and store nothing.
      // (The delay spy installs only now so the setup render above is instant.)
      const origGenerate = posterService.generatePosterBuffer
      const genSpy = vi.spyOn(posterService, "generatePosterBuffer").mockImplementation(async (input) => {
        fakeNow += 65_000
        return origGenerate(input)
      })
      try {
        fakeNow = T0 + 61_000
        mockedGetJWRankings.mockRejectedValueOnce(new Error("Ranking source unavailable"))
        const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
        expect(res.status).toBe(200)
        // Retained rank 3: the same red-badge bytes (no saved-rank fallback —
        // the mapping is null — and no rolling-TTL extension past the list).
        expect(res.headers.get("etag")).toBe(etag1)
        expect(maxAgeOf(res)).toBe(0)
        expectNoSwrCapped(res)
        expect(res.headers.get("Cache-Control")).toContain("max-age=0")
        expect(writeSpy.mock.calls.length).toBe(writesBefore)
      } finally {
        genSpy.mockRestore()
      }
    } finally {
      writeSpy.mockRestore()
    }
  })

  it("coalesced waiter inherits the capped no-SWR headers (single render)", async () => {
    const writeSpy = vi.spyOn(runtimeCache, "writeCachedPoster")
    // Slow the image fetch so both requests attach to the same inflight render.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 120))
      const poster = await png("#101010")
      return new Response(new Uint8Array(poster), {
        status: 200, headers: { "content-type": "image/png", "content-length": String(poster.length) },
      })
    })
    const writesBefore = writeSpy.mock.calls.length
    const [a, b] = await Promise.all([
      GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) }),
      GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) }),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(a.headers.get("etag")).toBe(b.headers.get("etag"))
    expectNoSwrCapped(a)
    expectNoSwrCapped(b)
    expect(maxAgeOf(a)).toBeLessThanOrEqual(60)
    // One render served both readers — no duplicated full-TTL render.
    expect(writeSpy.mock.calls.length - writesBefore).toBeLessThanOrEqual(1)
    writeSpy.mockRestore()
  })

  it("uncapped policy path is preserved (no fact → full dynamic TTL, jitter intact)", async () => {
    mockedJwRemaining.mockReturnValue(null)
    mockedGetJWRankings.mockResolvedValue([] as never)
    const res = await GET(new NextRequest("http://localhost:3000/api/poster/movie/424242"), { params: Promise.resolve({ type: "movie", id: "424242" }) })
    expect(res.status).toBe(200)
    const ma = maxAgeOf(res)
    // Dynamic policy ~6h ±10% jitter: far above any 60s fact cap.
    expect(ma).not.toBeNull()
    expect(ma as number).toBeGreaterThan(60)
  })

  it("image bytes stay servable on their own TTL while the poster still revalidates", async () => {
    const buf = Buffer.from([1, 2, 3, 4])
    await cachedImageBytes("https://img.test/dl.jpg", async () => buf)
    expect(peekImageBytes("https://img.test/dl.jpg")).not.toBeNull()
    fakeNow = T0 + 61_000
    // Image bytes TTL is 24h — still a hit well past the 60s poster fact.
    expect(peekImageBytes("https://img.test/dl.jpg")?.equals(buf)).toBe(true)
  })
})
