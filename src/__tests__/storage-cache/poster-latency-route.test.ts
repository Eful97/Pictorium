// Poster latency instrumentation at the route boundary: cold render →
// "render" sample, cache hit / 304 → "cached" sample, coalesced waiter →
// excluded, invalid request → excluded. HIT Server-Timing carries only the
// fresh total (never the original render's fetch/composite breakdown).
// Auth for the admin surface is unchanged (401 without token, latency
// additive with token).
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { GET as cacheStatusGET } from "@/app/api/cache/status/route"
import { getById } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear, cacheExpire } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { renderRankingBadge } from "@/lib/svg-badge"
import * as runtimeCache from "@/lib/poster-runtime-cache"
import {
  __resetPosterStatsForTest,
  getPosterStats,
} from "@/lib/poster-runtime-cache"

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
  // Automatic title wordmark (title without any TMDB logo): the route
  // rasterizes the derived title here. A valid 1x1 PNG keeps the real
  // composite path satisfied — these tests assert base/headers/TTL, never the
  // wordmark pixels (the badge renderers above are stubbed too).
  buildTextLogoBuffer: vi.fn(async () => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQI12P4TwAw0F4BAOFkf4EHRdBsAAAAAElFTkSuQmCC", "base64")),
}))
vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  jwRankingsRemainingMs: vi.fn(() => null),
  jwTitlesRemainingMs: vi.fn(() => null),
  jwAvailabilityRemainingMs: vi.fn(() => null),
  JW_DIGITAL_MONETIZATION_TYPES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
  isJustwatchBreakerOpen: vi.fn(() => false),
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
  isBreakerOpen: vi.fn(() => false),
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
  getTMDBStats: vi.fn(() => ({ totalCalls: 0, cacheHits: 0, networkCalls: 0, cacheHitRate: "0%", lastCallTime: null })),
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
const mockedFetchMDBList = vi.mocked(fetchMDBList)
const mockedRenderRankingBadge = vi.mocked(renderRankingBadge)

async function png(color: string): Promise<Buffer> {
  return sharp({ create: { width: 500, height: 750, channels: 4, background: color } }).png().toBuffer()
}

function posterReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, init)
}

const params = { params: Promise.resolve({ type: "movie", id: "424242" }) }

describe("route-level poster latency categories", () => {
  beforeEach(async () => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    __resetPosterStatsForTest()
    vi.spyOn(runtimeCache, "schedulePosterRefresh").mockImplementation(() => {})
    mockedGetById.mockResolvedValue(null)
    mockedGetDetails.mockResolvedValue({ id: 424242, title: "Latency", genres: [], vote_average: 5, vote_count: 10 } as never)
    mockedGetDetailsWithExternalIds.mockResolvedValue({ id: 424242, title: "Latency", genres: [], vote_average: 5, vote_count: 10, external_ids: { imdb_id: "tt424242" } } as never)
    mockedGetImages.mockResolvedValue({ posters: [{ file_path: "/dl.jpg", iso_639_1: null }], backdrops: [], logos: [] } as never)
    mockedGetExternalIds.mockResolvedValue({ imdb_id: "tt424242" } as never)
    mockedGetJWRankings.mockResolvedValue([])
    mockedFetchMDBList.mockResolvedValue([])
    mockedRenderRankingBadge.mockReset().mockImplementation(async () => null as never)
    const poster = await png("#101010")
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      status: 200, headers: { "content-type": "image/png", "content-length": String(poster.length) },
    }))
  })

  afterEach(() => {
    cacheClear()
    __resetPosterStatsForTest()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("cold render records one render sample; the hit records one cached sample", async () => {
    const first = await GET(posterReq("/api/poster/movie/424242"), params)
    expect(first.status).toBe(200)
    let stats = getPosterStats()
    expect(stats.renders).toBe(1)
    expect(stats.latency.render.count).toBe(1)
    expect(stats.latency.render.p50Ms).not.toBeNull()
    expect(stats.latency.cached.count).toBe(0)
    expect(stats.latency.cached.p50Ms).toBeNull()

    const hit = await GET(posterReq("/api/poster/movie/424242"), params)
    expect(hit.status).toBe(200)
    stats = getPosterStats()
    expect(stats.hits).toBe(1)
    expect(stats.latency.render.count).toBe(1)
    expect(stats.latency.cached.count).toBe(1)
    expect(stats.latency.cached.p50Ms).not.toBeNull()
    expect(stats.latency.cached.p95Ms).not.toBeNull()
  })

  it("HIT Server-Timing carries only the fresh total, never the render breakdown", async () => {
    const first = await GET(posterReq("/api/poster/movie/424242"), params)
    expect(first.status).toBe(200)
    const renderTiming = first.headers.get("Server-Timing") ?? ""
    expect(renderTiming).toContain("fetch;dur=")
    expect(renderTiming).toContain("composite;dur=")

    const hit = await GET(posterReq("/api/poster/movie/424242"), params)
    expect(hit.status).toBe(200)
    const hitTiming = hit.headers.get("Server-Timing") ?? ""
    expect(hitTiming).toContain('cache;desc="HIT"')
    expect(hitTiming).toContain("total;dur=")
    expect(hitTiming).not.toContain("fetch;dur=")
    expect(hitTiming).not.toContain("composite;dur=")
  })

  it("conditional 304 on a cached entry records a cached sample, not a render", async () => {
    const first = await GET(posterReq("/api/poster/movie/424242"), params)
    expect(first.status).toBe(200)
    const etag = first.headers.get("etag")!
    const notMod = await GET(posterReq("/api/poster/movie/424242", { headers: { "If-None-Match": etag } }), params)
    expect(notMod.status).toBe(304)
    const stats = getPosterStats()
    expect(stats.latency.render.count).toBe(1)
    expect(stats.latency.cached.count).toBe(1)
  })

  it("coalesced waiter records no latency sample (one render, zero cached)", async () => {
    let releaseFetch!: () => void
    const gate = new Promise<void>((resolve) => { releaseFetch = resolve })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await gate
      const poster = await png("#202020")
      return new Response(new Uint8Array(poster), { status: 200, headers: { "content-type": "image/png" } })
    })
    const first = GET(posterReq("/api/poster/movie/424242"), params)
    // Let the first request register its inflight render before the waiter arrives.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const waiter = GET(posterReq("/api/poster/movie/424242"), params)
    await new Promise((resolve) => setTimeout(resolve, 50))
    releaseFetch()
    const [res1, res2] = await Promise.all([first, waiter])
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    const stats = getPosterStats()
    expect(stats.coalescedHits).toBe(1)
    expect(stats.latency.render.count).toBe(1)
    expect(stats.latency.cached.count).toBe(0)
    expect(stats.latency.cached.p50Ms).toBeNull()
  })

  it("invalid request records no latency sample", async () => {
    const bad = await GET(
      posterReq("/api/poster/movie/not-an-id"),
      { params: Promise.resolve({ type: "movie", id: "not-an-id" }) },
    )
    expect(bad.status).toBe(400)
    const stats = getPosterStats()
    expect(stats.requests).toBe(0)
    expect(stats.latency.cached.count).toBe(0)
    expect(stats.latency.render.count).toBe(0)
  })

  it("cache/status keeps admin auth and exposes latency additively", async () => {
    const first = await GET(posterReq("/api/poster/movie/424242"), params)
    expect(first.status).toBe(200)
    const hit = await GET(posterReq("/api/poster/movie/424242"), params)
    expect(hit.status).toBe(200)

    const anon = await cacheStatusGET(new Request("http://localhost:3000/api/cache/status") as never)
    expect(anon.status).toBe(401)

    process.env.ADMIN_TOKEN = "latency-secret"
    try {
      const authed = await cacheStatusGET(
        new Request("http://localhost:3000/api/cache/status", { headers: { "x-admin-token": "latency-secret" } }) as never,
      )
      expect(authed.status).toBe(200)
      const body = await authed.json()
      expect(body.poster.renders).toBe(1)
      expect(body.poster.hits).toBe(1)
      expect(body.poster.latency.windowMs).toBe(15 * 60 * 1000)
      expect(body.poster.latency.capacity).toBe(1024)
      expect(body.poster.latency.render.count).toBe(1)
      expect(body.poster.latency.cached.count).toBe(1)
      expect(typeof body.poster.latency.render.p50Ms).toBe("number")
      expect(typeof body.poster.latency.cached.p95Ms).toBe("number")
    } finally {
      delete process.env.ADMIN_TOKEN
    }
  })

  it("stale canonical + needsVariant keeps the SWR refresh: one refresh, one cached sample", async () => {
    const variantParams = { params: Promise.resolve({ type: "movie", id: "424250" }) }
    // Canonical render through conversion (?fmt=jpeg caches canonical + variant).
    const first = await GET(posterReq("/api/poster/movie/424250?fmt=jpeg"), variantParams)
    expect(first.status).toBe(200)
    expect(getPosterStats().latency.render.count).toBe(1)
    // Expire everything; then stage a production-real state the cache cannot
    // express by itself: the jpeg variant entry is gone (evicted/never
    // stored) while the canonical entry remains stale-but-serveable.
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    const realRead = runtimeCache.readCachedPoster
    const readSpy = vi.spyOn(runtimeCache, "readCachedPoster").mockImplementation(((key: string, nowMs?: number) => {
      if (typeof key === "string" && key.includes(":fmtjpeg")) {
        return { payload: null, stale: false, remainingMs: null }
      }
      return realRead(key, nowMs)
    }) as typeof realRead)
    try {
      const refreshMock = vi.mocked(runtimeCache.schedulePosterRefresh)
      refreshMock.mockClear()
      const cachedBefore = getPosterStats().latency.cached.count
      // Stale canonical served through variant conversion (?fmt=jpeg).
      const stale = await GET(posterReq("/api/poster/movie/424250?fmt=jpeg"), variantParams)
      expect(stale.status).toBe(200)
      expect(stale.headers.get("content-type")).toContain("jpeg")
      // SWR preserved: exactly one background refresh scheduled, no re-render,
      // and exactly one additional cached sample (conversion included, counted once).
      expect(refreshMock).toHaveBeenCalledTimes(1)
      const stats = getPosterStats()
      expect(stats.renders).toBe(1)
      expect(stats.staleHits).toBe(1)
      expect(stats.latency.render.count).toBe(1)
      expect(stats.latency.cached.count).toBe(cachedBefore + 1)
    } finally {
      readSpy.mockRestore()
    }
  })

  it("stale canonical direct serve records one cached sample and schedules one refresh", async () => {
    const staleParams = { params: Promise.resolve({ type: "movie", id: "424251" }) }
    const first = await GET(posterReq("/api/poster/movie/424251"), staleParams)
    expect(first.status).toBe(200)
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    const refreshMock = vi.mocked(runtimeCache.schedulePosterRefresh)
    refreshMock.mockClear()
    const stale = await GET(posterReq("/api/poster/movie/424251"), staleParams)
    expect(stale.status).toBe(200)
    expect(refreshMock).toHaveBeenCalledTimes(1)
    const stats = getPosterStats()
    expect(stats.renders).toBe(1)
    expect(stats.staleHits).toBe(1)
    expect(stats.latency.render.count).toBe(1)
    expect(stats.latency.cached.count).toBe(1)
  })

  it("variant conversion, hit and 304 each record exactly one cached sample (no double)", async () => {
    const variantParams = { params: Promise.resolve({ type: "movie", id: "424252" }) }
    const first = await GET(posterReq("/api/poster/movie/424252"), variantParams)
    expect(first.status).toBe(200)
    // ?fmt=jpeg uses a distinct cache key, so this re-renders (canonical-B)
    // and records exactly one more render sample — conversion included,
    // never a render+cached double for a single response.
    const converted = await GET(posterReq("/api/poster/movie/424252?fmt=jpeg"), variantParams)
    expect(converted.status).toBe(200)
    expect(converted.headers.get("content-type")).toContain("jpeg")
    let stats = getPosterStats()
    expect(stats.latency.render.count).toBe(2)
    expect(stats.latency.cached.count).toBe(0)
    // Fresh variant hit: counted once as cached.
    const hit = await GET(posterReq("/api/poster/movie/424252?fmt=jpeg"), variantParams)
    expect(hit.status).toBe(200)
    stats = getPosterStats()
    expect(stats.latency.cached.count).toBe(1)
    expect(stats.latency.render.count).toBe(2)
    // Variant 304: counted once, never as render.
    const etag = hit.headers.get("etag")!
    const notMod = await GET(
      posterReq("/api/poster/movie/424252?fmt=jpeg", { headers: { "If-None-Match": etag } }),
      variantParams,
    )
    expect(notMod.status).toBe(304)
    stats = getPosterStats()
    expect(stats.latency.cached.count).toBe(2)
    expect(stats.latency.render.count).toBe(2)
  })

  it("revalidation render answers 304 and records a render sample", async () => {
    const revalParams = { params: Promise.resolve({ type: "movie", id: "424253" }) }
    const first = await GET(posterReq("/api/poster/movie/424253"), revalParams)
    expect(first.status).toBe(200)
    const etag = first.headers.get("etag")!
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    // Expired entry + conditional: re-renders, content unchanged → 304.
    const notMod = await GET(
      posterReq("/api/poster/movie/424253", { headers: { "If-None-Match": etag } }),
      revalParams,
    )
    expect(notMod.status).toBe(304)
    const stats = getPosterStats()
    expect(stats.renders).toBe(2)
    expect(stats.latency.render.count).toBe(2)
    expect(stats.latency.cached.count).toBe(0)
  })

  it("failed render and negative-cache hit record no latency samples", async () => {
    const errParams = { params: Promise.resolve({ type: "movie", id: "424254" }) }
    // Upstream image fetch fails: honest 404 + negative cache (both excluded
    // from latency by contract — no successful poster response exists).
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("upstream down"))
    const failed = await GET(posterReq("/api/poster/movie/424254"), errParams)
    expect(failed.status).toBe(404)
    const fetchCallsAfterFirst = fetchMock.mock.calls.length
    expect(fetchCallsAfterFirst).toBeGreaterThan(0)
    let stats = getPosterStats()
    expect(stats.latency.render.count).toBe(0)
    expect(stats.latency.cached.count).toBe(0)
    // Negative-cache hit: same 404 without touching upstream again, still no samples.
    const negative = await GET(posterReq("/api/poster/movie/424254"), errParams)
    expect(negative.status).toBe(404)
    expect(fetchMock.mock.calls.length).toBe(fetchCallsAfterFirst)
    stats = getPosterStats()
    expect(stats.latency.render.count).toBe(0)
    expect(stats.latency.cached.count).toBe(0)
  })

  it("failed variant conversion records no successful render sample", async () => {
    const convParams = { params: Promise.resolve({ type: "movie", id: "424255" }) }
    vi.spyOn(runtimeCache, "convertToJpeg").mockRejectedValueOnce(new Error("encode boom"))
    // Canonical webp renders, then the jpeg conversion throws → 500 with no
    // render sample (recording happens only at terminal success).
    const failed = await GET(posterReq("/api/poster/movie/424255?fmt=jpeg"), convParams)
    expect(failed.status).toBe(500)
    const stats = getPosterStats()
    expect(stats.errors).toBe(1)
    expect(stats.latency.render.count).toBe(0)
    expect(stats.latency.cached.count).toBe(0)
    // Retry: the canonical render was cached before conversion failed, so the
    // retry serves it through a fresh conversion — one cached sample, still
    // no render sample and no double counting.
    const retry = await GET(posterReq("/api/poster/movie/424255?fmt=jpeg"), convParams)
    expect(retry.status).toBe(200)
    expect(retry.headers.get("content-type")).toContain("jpeg")
    const after = getPosterStats()
    expect(after.renders).toBe(1)
    expect(after.latency.render.count).toBe(0)
    expect(after.latency.cached.count).toBe(1)
  })
})
