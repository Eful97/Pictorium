// H1 fault-injection: non-cooperative (native-style) renderer vs render watchdog.
// A renderer that IGNORES AbortSignal and never settles on its own models the
// stuck-native behavior WITHOUT claiming an actual Sharp bug reproduction: the
// mock below is pure JS, aborts are simply not observed, and no real OOM/hang
// is produced. The hang is released via an explicit deferred in-test (and
// always in teardown), so this file can never leak pending work into others.
//
// What is REAL here: the full route GET lifecycle (deadline race, watchdog
// timer, completePosterRender keepEntry, slot release, zombie accounting,
// inflight coalescing, single 503 accounting). What is FAULT-INJECTED: only
// `@/lib/poster-service` generatePosterBuffer (source:
// src/lib/poster-service.ts — takes NO signal, cannot be aborted) plus fast
// upstream mocks in the style of poster-render-deadline.test.ts.
//
// H2 fix: the ORIGINAL caller now wins a bounded 503 from the deadline race
// even though the injected renderer never settles. A late-completing job must
// NOT cache poster bytes, must NOT report success metrics, and must NOT touch
// accounting owned by newer renders.
//
// Env at module level BEFORE the dynamic import (same values as the sibling
// tests so the shared process.env stays consistent): RENDER_TIMEOUT 2s, one
// slot, slot-wait 500ms, zombie grace 1s (clamp floor), negative-cache TTL 1s
// (clamp floor, so the not-cached proof below runs fast).
process.env.PICTORIUM_RENDER_TIMEOUT_MS = "2000"
process.env.PICTORIUM_MAX_CONCURRENT_RENDERS = "1"
process.env.PICTORIUM_RENDER_SLOT_WAIT_MS = "500"
process.env.PICTORIUM_ZOMBIE_GRACE_MS = "1000"
process.env.PICTORIUM_NEGATIVE_CACHE_TTL_MS = "1000"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

// Deferred fault control: created with vi.hoisted so the vi.mock factory below
// can reference it. The injected renderer ignores abort entirely and pends on
// this deferred until the test (or teardown) settles it explicitly.
const hangCtl = vi.hoisted(() => ({
  promise: null as Promise<Buffer> | null,
  release: null as ((buf: Buffer) => void) | null,
  reject: null as ((err: unknown) => void) | null,
}))

// 1x1 transparent PNG: real bytes through the REAL fetchImg + sharp resize path
// (no huge images, no OOM risk), so only the compositing stage hangs.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
const TINY_IMG = Buffer.from(TINY_PNG_B64, "base64")

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
  return { ...mod, getServerDefaults: vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" })) }
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
  // Task D freshness readers: fail-closed null in route tests (legacy TTL path).
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
  // Task D freshness reader: fail-closed null in route tests (legacy TTL path).
  mdblistRemainingMs: vi.fn(() => null),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(async () => ({ id: 42, title: "Test", genres: [], vote_average: 0, vote_count: 0 })),
  getDetailsWithExternalIds: vi.fn(async () => ({ id: 42, title: "Test", genres: [], vote_average: 0, vote_count: 0, external_ids: { imdb_id: null, tvdb_id: null } })),
  getImages: vi.fn(async () => ({ id: 42, backdrops: [], posters: [], logos: [] })),
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

vi.mock("@/lib/imdb-top250", () => ({
  isImdbTop250: vi.fn(async () => false),
  isImdbTop100: vi.fn(async () => false),
}))

// FAULT INJECTION POINT (only injected seam): the renderer ignores abort and
// pends on the deferred. This mirrors a stuck native worker that never
// observes renderAbort — generatePosterBuffer takes no signal by contract
// (src/lib/poster-service.ts), so there is nothing to "forget" here.
vi.mock("@/lib/poster-service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-service")>()
  return {
    ...mod,
    generatePosterBuffer: vi.fn((): Promise<Buffer> => {
      if (!hangCtl.promise) {
        hangCtl.promise = new Promise<Buffer>((resolve, reject) => {
          hangCtl.release = resolve
          hangCtl.reject = reject
        })
      }
      return hangCtl.promise
    }),
  }
})

// NB: dynamic imports AFTER the module-level env setup.
const { GET } = await import("@/app/api/poster/[type]/[id]/route")
const { acquirePosterRenderSlot, getPosterStats, posterErrorStats, __resetPosterRenderLimiter } = await import("@/lib/poster-runtime-cache")
const { getById } = await import("@/lib/store")
const { generatePosterBuffer } = await import("@/lib/poster-service")
const mockedGetById = vi.mocked(getById)
const mockedGenerate = vi.mocked(generatePosterBuffer)

const MAPPED = {
  tmdbId: 42,
  mediaType: "movie",
  title: "Hung",
  posterPath: "/poster.jpg",
  logoPath: null,
  originalPosterPath: null,
  language: "it",
  updatedAt: "2026-07-16T10:15:30.000Z",
}

// Fast, cooperative upstream: only the compositing stage hangs, so the
// deadline fires on the non-cooperative renderer rather than on a slow fetch.
function fastImageFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(new Uint8Array(TINY_IMG), { status: 200, headers: { "content-type": "image/png" } }),
  )
}

function req(id: number): NextRequest {
  return new NextRequest(`http://localhost:3000/api/poster/movie/${id}`)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// GET promises are tracked for teardown, but since H2 the GET promise no
// longer tracks the ACTUAL render job: after a deadline-early 503 the job
// still runs in the background, so teardown must also drain that.
let pendingGets: Array<Promise<Response>> = []

describe("non-cooperative renderer vs render watchdog (H1 fault injection + H2 fix)", () => {
  beforeEach(() => {
    hangCtl.promise = null
    hangCtl.release = null
    hangCtl.reject = null
    mockedGenerate.mockClear()
    pendingGets = []
  })

  afterEach(async () => {
    try {
      // Always settle the injected hang, then drain every in-flight GET, then
      // allow the detached actual job a beat to run through its post-abort
      // guard and finally — otherwise late work leaks into the next test.
      hangCtl.release?.(TINY_IMG)
      if (pendingGets.length) await Promise.allSettled(pendingGets)
      await sleep(300)
    } finally {
      pendingGets = []
      hangCtl.promise = null
      hangCtl.release = null
      hangCtl.reject = null
      vi.restoreAllMocks()
      __resetPosterRenderLimiter()
      __resetTMDBSessionCache()
      cacheClear()
    }
  })

  it("answers the ORIGINAL caller with a bounded 503 while the non-cooperative work stays pending", { timeout: 30000 }, async () => {
    mockedGetById.mockResolvedValue(MAPPED as never)
    fastImageFetch()
    const errBefore = posterErrorStats()

    const t0 = Date.now()
    const p1 = GET(req(42), { params: Promise.resolve({ type: "movie", id: "42" }) })
    pendingGets.push(p1)
    // H2: the original caller is bounded by the deadline race — this await
    // itself proves the caller no longer hangs on the zombie.
    const res1 = await p1
    expect(Date.now() - t0).toBeLessThan(4500)
    expect(res1.status).toBe(503)
    expect(res1.headers.get("Retry-After")).toBeTruthy()

    // The injected native-style work is STILL unsettled: the abort was never
    // observed, only the caller was released.
    expect(hangCtl.promise).not.toBeNull()
    let nativeSettled = false
    void hangCtl.promise!.then(
      () => { nativeSettled = true },
      () => { nativeSettled = true },
    )
    await sleep(50)
    expect(nativeSettled).toBe(false)

    // Observable accounting: slot released (active=0) but budget still held
    // by the zombie (zombie=1) — the documented tradeoff, not a slot leak.
    expect(getPosterStats().activeRenders).toBe(0)
    expect(getPosterStats().zombieRenders).toBe(1)

    // Single 503 accounting applied once by the watchdog (negative cache +
    // error count), even though a newcomer below also answers 503.
    expect(posterErrorStats().writes).toBe(errBefore.writes + 1)

    // Overlap with hanging work: a newcomer on the same key gets a bounded
    // 503 (inflight entry kept by the watchdog) instead of duplicating the
    // render — no second generatePosterBuffer call.
    const t1 = Date.now()
    const res2 = await GET(req(42), { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(res2.status).toBe(503)
    expect(Date.now() - t1).toBeLessThan(1000)
    expect(mockedGenerate.mock.calls.length).toBe(1)

    // Grace expiry works while the original work is still pending.
    await sleep(1300)
    expect(getPosterStats().zombieRenders).toBe(0)
    expect(nativeSettled).toBe(false)

    // Late success must NOT become a 200 and must NOT cache poster bytes:
    // release the deferred, let the job run through its post-abort guard.
    hangCtl.release!(TINY_IMG)
    await sleep(300)
    expect(getPosterStats().activeRenders).toBe(0)
    expect(getPosterStats().zombieRenders).toBe(0)

    // Late cleanup did not touch accounting: a fresh slot is acquirable.
    const slot = await acquirePosterRenderSlot()
    expect(slot).toBeTruthy()
    slot!()

    // Aborted poster NOT cached: past the (1s) negative-cache TTL the same
    // key re-renders (second generate call) and answers 200. A late-cached
    // poster would have served a HIT with no new generate call.
    await sleep(1200)
    const res3 = await GET(req(42), { params: Promise.resolve({ type: "movie", id: "42" }) })
    expect(res3.status).toBe(200)
    expect(mockedGenerate.mock.calls.length).toBe(2)
  })

  it("absorbs a late rejection after the deadline with no unhandled rejection and balanced accounting", { timeout: 30000 }, async () => {
    mockedGetById.mockResolvedValue(MAPPED as never)
    fastImageFetch()
    const errBefore = posterErrorStats()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      // Isolated key (44): no cache/inflight shared with other tests.
      const p = GET(req(44), { params: Promise.resolve({ type: "movie", id: "44" }) })
      pendingGets.push(p)
      const res = await p
      expect(res.status).toBe(503)

      // Reject the still-pending native work AFTER the caller was answered.
      expect(hangCtl.promise).not.toBeNull()
      hangCtl.reject!(new Error("late native failure"))
      await sleep(400)

      // Late failure is contained: no unhandled rejection, slot/inflight
      // balanced, and the error counted exactly once (watchdog only — the
      // late catch must not double-count).
      expect(unhandled).toEqual([])
      expect(getPosterStats().activeRenders).toBe(0)
      expect(getPosterStats().zombieRenders).toBe(0)
      expect(posterErrorStats().writes).toBe(errBefore.writes + 1)

      const slot = await acquirePosterRenderSlot()
      expect(slot).toBeTruthy()
      slot!()
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  // H2 correction cycle1: a cooperative pre-composite image fetch that aborts
  // AFTER the deadline must not write a second 503. The watchdog already
  // applied the single 503 accounting (negative cache + error count) when the
  // deadline fired; the late job settling through the !baseBuf guard must
  // reuse it (completePosterRender + 503 answer) without rewriting. This pins
  // the early-path single-503 rule on the REAL route with the H2 file mocks:
  // baseline writes -> watchdog (+1) -> late abort settles, expected TOTAL +1.
  // Normal pre-deadline busy/no-image errors still write (existing negative
  // cache) — the guard below only skips the duplicate when deadlineFired.
  it("writes a single 503 when a cooperative pre-composite image fetch aborts AFTER the deadline", { timeout: 30000 }, async () => {
    mockedGetById.mockResolvedValue({ ...MAPPED, posterPath: "/late-503-h2.jpg" } as never)
    // Cooperative upstream: pends until the watchdog aborts renderAbort, then
    // rejects — so Block A settles with originalBase null AFTER the deadline
    // and the job runs through the late !baseBuf guard.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: unknown, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          const sig = init?.signal as AbortSignal | undefined
          if (sig?.aborted) {
            reject(new DOMException("Aborted", "AbortError"))
            return
          }
          sig?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
        }),
    )
    const errBefore = posterErrorStats().writes
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on("unhandledRejection", onUnhandled)
    try {
      // Isolated key (46) with a distinct poster URL (no image-bytes hit).
      const p = GET(req(46), { params: Promise.resolve({ type: "movie", id: "46" }) })
      pendingGets.push(p)
      const res = await p
      expect(res.status).toBe(503)
      expect(res.headers.get("Retry-After")).toBeTruthy()

      // Watchdog applied the single 503 accounting at the deadline.
      expect(posterErrorStats().writes).toBe(errBefore + 1)

      // Let the late job run through the post-abort !baseBuf guard: the
      // aborted image fetch settles Block A with null, after the deadline.
      await sleep(600)

      // Late pre-composite failure must NOT write a second 503.
      expect(posterErrorStats().writes).toBe(errBefore + 1)
      expect(unhandled).toEqual([])
      expect(getPosterStats().activeRenders).toBe(0)
      expect(getPosterStats().zombieRenders).toBe(0)

      const slot = await acquirePosterRenderSlot()
      expect(slot).toBeTruthy()
      slot!()
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("still returns 200 when the render finishes before the deadline", { timeout: 30000 }, async () => {
    mockedGetById.mockResolvedValue(MAPPED as never)
    fastImageFetch()

    // Isolated key (45): no cache/inflight shared with other tests.
    const p = GET(req(45), { params: Promise.resolve({ type: "movie", id: "45" }) })
    pendingGets.push(p)
    // Settle the deferred quickly, well before the 2s deadline. The mock
    // creates the deferred on first call, so poll for it instead of assuming.
    for (let i = 0; i < 100 && !hangCtl.release; i++) await sleep(20)
    expect(hangCtl.release).not.toBeNull()
    hangCtl.release!(TINY_IMG)
    const res = await p
    expect(res.status).toBe(200)
    expect(mockedGenerate.mock.calls.length).toBe(1)
  })
})
