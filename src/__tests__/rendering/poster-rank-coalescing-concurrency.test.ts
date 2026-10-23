import sharp from "sharp"
import { performance } from "node:perf_hooks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import {
  chartSlotEndMs,
  pinChartFamily,
  romeSlotKey,
  type ChartFamilyPin,
} from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { fetchCustomRankingTop20 } from "@/lib/custom-ranking"
import { getServerDefaultsChecked } from "@/lib/server-defaults"
import { renderRankingBadge } from "@/lib/svg-badge"

// ---------------------------------------------------------------------------
// Regression: concurrent poster preflights sharing ONE chart source fetch
// (Italy Top20 series screenshot showed ranks 1,5,5,5,5,6,8,9 across
// DIFFERENT titles — every waiter rendered the first caller's rank).
//
// The shared coalesced fetch must return the RAW pin/list; each request
// resolves its own rank lookup AND its own pin/provenance/fallback OUTSIDE
// the coalesced callback. The per-source key intentionally excludes tmdbId
// (one fetch per source, not per title); per-caller budgets/aborts are
// unchanged. Cold failure falls back to EACH caller's saved mapping; a
// genuine snapshot miss stays null.
// ---------------------------------------------------------------------------

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
  const mocked = vi.fn(async () => ({ defaultLogoFitEnabled: false, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({})),
    getServerDefaultsForUser: vi.fn(async () => ({})),
    getServerDefaultsChecked: mocked,
  }
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
vi.mock("@/lib/custom-ranking", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/custom-ranking")>()
  return {
    ...mod,
    fetchCustomRankingTop20: vi.fn(),
    findRankingCustomCatalog: vi.fn((catalogs: Array<{ id: string }> | undefined, id: string) =>
      catalogs?.find((c) => c.id === id),
    ),
    customRankingRemainingMs: vi.fn(() => null),
  }
})
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
    simkl: { key: undefined, source: "none" },
    fanart: { key: undefined, source: "none" },
  })),
}))
vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))
vi.mock("@/lib/chart-generation", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-generation")>()
  return { ...mod, pinChartFamily: vi.fn() }
})
vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn() }
})

const mockedGetById = vi.mocked(getById)
const mockedPinChartFamily = vi.mocked(pinChartFamily)
const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)
const mockedFetchCustom = vi.mocked(fetchCustomRankingTop20)
const mockedDefaultsChecked = vi.mocked(getServerDefaultsChecked)
const mockedRenderRankingBadge = vi.mocked(renderRankingBadge)

function tmdbDetails(id: number) {
  return {
    id,
    title: `Title ${id}`,
    original_language: "en",
    genres: [{ id: 18, name: "Drama" }],
    vote_average: 7.5,
    vote_count: 100,
    status: "Returning Series",
    first_air_date: "2024-01-01",
    poster_path: `/p${id}.jpg`,
    backdrop_path: null,
    networks: [],
    production_companies: [],
  }
}

async function png(color = "#101010"): Promise<Buffer> {
  return sharp({ create: { width: 500, height: 750, channels: 4, background: color } }).png().toBuffer()
}

function jwPin(rows: Array<{ tmdbId: number; rank: number }>, generation: string): ChartFamilyPin {
  return {
    id: generation,
    snapshot: {
      generation,
      group: "test",
      family: "jw:series:charts",
      status: "ok",
      rows: rows.map((r) => ({ tmdbId: r.tmdbId, imdbId: null, rank: r.rank })),
      fetchedAt: Date.now(),
      publishedAt: Date.now(),
    },
  }
}

function animePin(order: number[], generation: string): ChartFamilyPin {
  return {
    id: generation,
    snapshot: {
      generation,
      group: "test",
      family: "anime:series",
      status: "ok",
      rows: order.map((tmdbId) => ({ tmdbId, imdbId: null, rank: 0 })),
      fetchedAt: Date.now(),
      publishedAt: Date.now(),
    },
  }
}

/** Count per-request pinChartFamily arrivals for one chart family. */
function pinCalls(prefix: string): number {
  return mockedPinChartFamily.mock.calls.filter(
    (c) => (c[0] as { family: string }).family.startsWith(prefix),
  ).length
}

function animeFactoryCalls(): number {
  return mockedEnsureFresh.mock.calls.filter(
    (c) => (c[0] as { family: string }).family.startsWith("anime:"),
  ).length
}

function jwFactoryCalls(): number {
  return jwCalls().filter((c) => c.family.startsWith("jw:")).length
}

/**
 * Deterministic rendezvous: waits until EVERY concurrent request has attached
 * to the single pending shared preflight before releasing it.
 *
 * Each request awaits the mocked pinChartFamily exactly once per needed family
 * (route pre-preflight pins); everything between that await's resolution and
 * the sharedSourceFetch call is microtask-only — sync key building
 * (chartListGroupKey/chartPinCacheFragment/hashKey/JSON.stringify) plus a
 * synchronous factory start on cache miss. This poll observes from a macrotask,
 * so when the counted arrivals reach N, every counted request's microtask chain
 * has fully drained: all N have synchronously invoked sharedSourceFetch while
 * the single shared fetch is still parked on the unreleased gate, i.e. all
 * attached to the same in-flight fetch. No fixed-delay sleep: success requires
 * the ex-ante condition, and a timeout fails loudly instead of releasing early
 * (which could let a straggler attach only after release).
 */
async function awaitAttachedRequests(opts: {
  pinPrefix: string
  expectedPins: number
  factoryCalls: () => number
}): Promise<void> {
  // NOTE: monotonic clock (performance.now) is intentionally unmocked by the
  // suite's Date.now spy, so the loud 10s rendezvous timeout still expires
  // when Date.now is frozen (provenance test pins Date.now to T0).
  const deadline = performance.now() + 10000
  for (;;) {
    if (pinCalls(opts.pinPrefix) >= opts.expectedPins && opts.factoryCalls() >= 1) {
      // Exactly one shared fetch exists: no straggler created a second fetch.
      expect(opts.factoryCalls()).toBe(1)
      return
    }
    if (performance.now() > deadline) {
      throw new Error(
        `preflight rendezvous timeout: pins=${pinCalls(opts.pinPrefix)}/${opts.expectedPins} factory=${opts.factoryCalls()}`,
      )
    }
    await new Promise((r) => setTimeout(r, 0))
  }
}

function jwCalls(): Array<{ family: string }> {
  return mockedEnsureFresh.mock.calls.map((c) => c[0] as { family: string })
}

async function debugGet(type: string, id: number): Promise<Response> {
  return GET(new NextRequest(`http://localhost:3000/api/poster/${type}/${id}?debug=1`), {
    params: Promise.resolve({ type, id: String(id) }),
  })
}

interface DebugRankings {
  rankings: { finalRank: number | null; anime: number | null }
}

describe("poster rank coalescing concurrency (per-caller resolution)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
    __resetImageBytesForTest()
    // restoreAllMocks does not reliably drop call history for these module
    // mocks: clear explicitly so per-test coalescing counts are exact.
    mockedEnsureFresh.mockClear()
    mockedFetchCustom.mockClear()
    mockedPinChartFamily.mockClear()
    mockedGetById.mockClear()
    mockedDefaultsChecked.mockClear()
    mockedRenderRankingBadge.mockClear()
    // A consumed rank renders a badge: the mock must return real PNG bytes
    // (null + live rank crashes the sharp composite with "Invalid input").
    // Rank-dependent pixels: the ETag is content-derived, so per-title bytes
    // prove per-title ranks (shared wrong rank = identical ETags).
    const badgeRed = await sharp({ create: { width: 100, height: 30, channels: 4, background: "#ff0000" } }).png().toBuffer()
    const badgeBlue = await sharp({ create: { width: 100, height: 30, channels: 4, background: "#0000ff" } }).png().toBuffer()
    mockedRenderRankingBadge.mockImplementation(async (rank: unknown) =>
      ({ png: rank === 1 ? badgeRed : badgeBlue, w: 100, h: 30 }) as never)
    const { getDetails, getDetailsWithExternalIds, getImages } = await import("@/lib/tmdb")
    vi.mocked(getDetails).mockImplementation(async (_t: unknown, id: unknown) => tmdbDetails(id as number) as never)
    vi.mocked(getDetailsWithExternalIds).mockImplementation(async (_t: unknown, id: unknown) =>
      ({ ...tmdbDetails(id as number), external_ids: { imdb_id: null } }) as never)
    vi.mocked(getImages).mockImplementation(async () =>
      ({ posters: [{ file_path: "/p.jpg", iso_639_1: null }], backdrops: [], logos: [] }) as never)
    mockedGetById.mockResolvedValue(null)
    mockedDefaultsChecked.mockResolvedValue({
      defaultLogoFitEnabled: false,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
    } as never)
    mockedFetchCustom.mockResolvedValue({ status: "empty", items: [] } as never)
    const poster = await png()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(poster.length) },
    }))
  })

  afterEach(() => {
    cacheClear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("JW: concurrent different titles sharing one source fetch resolve their own published ranks (miss stays null)", async () => {
    const generation = romeSlotKey()
    const pin = jwPin(
      [
        { tmdbId: 111, rank: 1 },
        { tmdbId: 222, rank: 2 },
        { tmdbId: 333, rank: 5 },
        { tmdbId: 444, rank: 6 },
        { tmdbId: 555, rank: 8 },
        { tmdbId: 666, rank: 9 },
      ],
      generation,
    )
    mockedPinChartFamily.mockImplementation(async (input) => {
      const family = (input as { family: string }).family
      return family.startsWith("anime:") ? { id: "live", snapshot: null } : { id: generation, snapshot: null }
    })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockedEnsureFresh.mockImplementation(async (input) => {
      const family = (input as { family: string }).family
      if (!family.startsWith("jw:")) return { id: "live", snapshot: null } as ChartFamilyPin
      await gate
      return pin
    })
    const ids = [111, 222, 333, 444, 555, 666, 999]
    const pending = ids.map((id) => debugGet("tv", id))
    try {
      // Deterministic overlap: all seven readers attached to ONE pending fetch.
      await awaitAttachedRequests({ pinPrefix: "jw:", expectedPins: ids.length, factoryCalls: jwFactoryCalls })
      // All seven readers coalesced on ONE source fetch (per-source single fetch preserved).
      expect(jwCalls().filter((c) => c.family.startsWith("jw:")).length).toBe(1)
      release()
      const bodies = await Promise.all(pending)
      for (const res of bodies) expect(res.status).toBe(200)
      const ranks = await Promise.all(bodies.map(async (res) => ((await res.json()) as DebugRankings).rankings.finalRank))
      // Exact per-title published ranks; 999 is a genuine miss (never first rank, never stale).
      expect(ranks).toEqual([1, 2, 5, 6, 8, 9, null])
    } finally {
      // Release is idempotent (resolving twice is a noop); draining here keeps a
      // failed assertion from leaking parked inflight state into later tests.
      release()
      await Promise.allSettled(pending)
    }
  }, 30000)

  it("anime: concurrent different titles sharing one source fetch resolve their own positions (miss stays null)", async () => {
    const generation = romeSlotKey()
    const pin = animePin([111, 222, 333, 444, 555, 666], generation)
    mockedPinChartFamily.mockImplementation(async (input) => {
      const family = (input as { family: string }).family
      return family.startsWith("jw:") ? { id: "live", snapshot: null } : { id: generation, snapshot: null }
    })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockedEnsureFresh.mockImplementation(async (input) => {
      const family = (input as { family: string }).family
      if (!family.startsWith("anime:")) return { id: "live", snapshot: null } as ChartFamilyPin
      await gate
      return pin
    })
    const ids = [111, 222, 333, 444, 555, 666, 999]
    const pending = ids.map((id) => debugGet("tv", id))
    try {
      // Deterministic overlap: all seven readers attached to ONE pending fetch.
      await awaitAttachedRequests({ pinPrefix: "anime:", expectedPins: ids.length, factoryCalls: animeFactoryCalls })
      expect(jwCalls().filter((c) => c.family.startsWith("anime:")).length).toBe(1)
      release()
      const bodies = await Promise.all(pending)
      for (const res of bodies) expect(res.status).toBe(200)
      const ranks = await Promise.all(bodies.map(async (res) => ((await res.json()) as DebugRankings).rankings.anime))
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, null])
    } finally {
      release()
      await Promise.allSettled(pending)
    }
  }, 30000)

  it("cold shared failure: each caller falls back to its own saved mapping rank (miss stays null)", async () => {
    const generation = romeSlotKey()
    mockedPinChartFamily.mockResolvedValue({ id: generation, snapshot: null })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockedEnsureFresh.mockImplementation(async (input) => {
      const family = (input as { family: string }).family
      if (!family.startsWith("jw:")) return { id: "live", snapshot: null } as ChartFamilyPin
      await gate
      return { id: "live", snapshot: null } as ChartFamilyPin
    })
    mockedGetById.mockImplementation(async (type: unknown, id: unknown) => {
      if (id === 111) {
        return {
          tmdbId: 111, mediaType: "tv", title: "One", posterPath: "/p111.jpg", logoPath: null,
          originalPosterPath: null, language: "it", showBadges: true, rankingBadges: true,
          badgeRank: 4, badgeLabel: "Serie", updatedAt: "2026-07-16T10:15:30.000Z",
        } as never
      }
      if (id === 222) {
        return {
          tmdbId: 222, mediaType: "tv", title: "Two", posterPath: "/p222.jpg", logoPath: null,
          originalPosterPath: null, language: "it", showBadges: true, rankingBadges: true,
          badgeRank: 9, badgeLabel: "Serie", updatedAt: "2026-07-16T10:15:30.000Z",
        } as never
      }
      return null
    })
    const pending = [111, 222, 333].map((id) => debugGet("tv", id))
    try {
      // Deterministic overlap: all three readers attached to ONE pending fetch.
      await awaitAttachedRequests({ pinPrefix: "jw:", expectedPins: pending.length, factoryCalls: jwFactoryCalls })
      expect(jwCalls().filter((c) => c.family.startsWith("jw:")).length).toBe(1)
      release()
      const bodies = await Promise.all(pending)
      for (const res of bodies) expect(res.status).toBe(200)
      const ranks = await Promise.all(bodies.map(async (res) => ((await res.json()) as DebugRankings).rankings.finalRank))
      expect(ranks).toEqual([4, 9, null])
    } finally {
      release()
      await Promise.allSettled(pending)
    }
  }, 30000)

  it("custom: concurrent different titles sharing one list fetch resolve their own positions", async () => {
    mockedDefaultsChecked.mockResolvedValue({
      defaultLogoFitEnabled: false,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      customCatalogs: [{ id: "top20", name: "Top 20", type: "movie", url: "https://mdblist.com/lists/u/top20", enabled: true }],
      rankingSourceMovie: "top20",
    } as never)
    mockedPinChartFamily.mockImplementation(async (input) => {
      const family = (input as { family: string }).family
      return family.startsWith("anime:") ? { id: "live", snapshot: null } : { id: "live", snapshot: null }
    })
    // Custom never touches JW chart I/O even under concurrency.
    mockedEnsureFresh.mockImplementation(async () => ({ id: "live", snapshot: null }) as ChartFamilyPin)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    mockedFetchCustom.mockImplementation(async () => {
      await gate
      return { status: "ok", items: [{ tmdbId: 111 }, { tmdbId: 222 }, { tmdbId: 333 }] } as never
    })
    const ids = [111, 222, 333, 999]
    const pending = ids.map((id) => debugGet("movie", id))
    try {
      // Deterministic overlap: all four readers attached to ONE pending fetch.
      // Custom requests skip JW pins, so the anime pin (the last per-request
      // await before the custom shared fetch) is the arrival seam.
      await awaitAttachedRequests({ pinPrefix: "anime:", expectedPins: ids.length, factoryCalls: () => mockedFetchCustom.mock.calls.length })
      expect(mockedFetchCustom).toHaveBeenCalledTimes(1)
      expect(jwCalls().filter((c) => c.family.startsWith("jw:")).length).toBe(0)
      release()
      const bodies = await Promise.all(pending)
      for (const res of bodies) expect(res.status).toBe(200)
      const ranks = await Promise.all(bodies.map(async (res) => ((await res.json()) as DebugRankings).rankings.finalRank))
      expect(ranks).toEqual([1, 2, 3, null])
    } finally {
      release()
      await Promise.allSettled(pending)
    }
  }, 30000)

  it("provenance + cache isolation: concurrent renders carry per-caller capped TTLs and distinct per-title ETags", async () => {
    // Fake clock 60s before the Rome slot boundary: the pinned snapshot
    // expires in ~60s, so a consumed rank fact caps max-age at ~60 while an
    // unconsumed (waiter with lost provenance) would serve the ~24h mapped
    // policy. Mapped titles (proven full-render path) with per-title ranks.
    const T0 = Date.UTC(2026, 9, 15, 21, 59, 0)
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => T0)
    const savedMapping = (id: number) => ({
      tmdbId: id,
      mediaType: "tv",
      title: `Saved ${id}`,
      posterPath: `/saved-${id}.jpg`,
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      updatedAt: "2026-07-16T10:15:30.000Z",
    }) as never
    mockedGetById.mockImplementation(async (_t: unknown, id: unknown) => savedMapping(id as number))
    try {
      const generation = romeSlotKey(T0)
      const slotEnd = chartSlotEndMs(generation)
      expect(slotEnd).toBeGreaterThan(T0)
      const pin = jwPin(
        [
          { tmdbId: 111, rank: 1 },
          { tmdbId: 222, rank: 2 },
        ],
        generation,
      )
      mockedPinChartFamily.mockImplementation(async (input) => {
        const family = (input as { family: string }).family
        return family.startsWith("anime:") ? { id: "live", snapshot: null } : { id: generation, snapshot: null }
      })
      let release!: () => void
      const gate = new Promise<void>((r) => { release = r })
      mockedEnsureFresh.mockImplementation(async (input) => {
        const family = (input as { family: string }).family
        if (!family.startsWith("jw:")) return { id: "live", snapshot: null } as ChartFamilyPin
        await gate
        return pin
      })
      const maxAgeOf = (res: Response): number | null => {
        const m = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") ?? "")
        return m ? Number(m[1]) : null
      }
      const pending = [111, 222].map(
        (id) => GET(new NextRequest(`http://localhost:3000/api/poster/tv/${id}`), {
          params: Promise.resolve({ type: "tv", id: String(id) }),
        }),
      )
      try {
        // Deterministic overlap: both renders attached to ONE pending fetch.
        await awaitAttachedRequests({ pinPrefix: "jw:", expectedPins: pending.length, factoryCalls: jwFactoryCalls })
        expect(jwCalls().filter((c) => c.family.startsWith("jw:")).length).toBe(1)
        release()
        const [a, b] = await Promise.all(pending)
        expect(a.status).toBe(200)
        expect(b.status).toBe(200)
        // Distinct titles, distinct published ranks: no cross-title ETag contamination.
        const etagA = a.headers.get("etag")!
        const etagB = b.headers.get("etag")!
        expect(etagA).not.toBe(etagB)
        // Per-caller provenance: BOTH carry the pinned-generation fact cap
        // (~60s), never the multi-hour dynamic policy of a lost provenance.
        for (const res of [a, b]) {
          const maxAge = maxAgeOf(res)
          expect(maxAge).not.toBeNull()
          expect(maxAge as number).toBeLessThanOrEqual(60)
          expect(maxAge as number).toBeGreaterThanOrEqual(59)
          expect(res.headers.get("Cache-Control")).not.toContain("immutable")
        }
        // Sequential solo re-renders hit their own per-title entries (isolation, no cross-talk).
        const soloA = await GET(new NextRequest("http://localhost:3000/api/poster/tv/111"), {
          params: Promise.resolve({ type: "tv", id: "111" }),
        })
        const soloB = await GET(new NextRequest("http://localhost:3000/api/poster/tv/222"), {
          params: Promise.resolve({ type: "tv", id: "222" }),
        })
        expect(soloA.headers.get("etag")).toBe(etagA)
        expect(soloB.headers.get("etag")).toBe(etagB)
      } finally {
        release()
        await Promise.allSettled(pending)
      }
    } finally {
      dateSpy.mockRestore()
    }
  }, 30000)
})
