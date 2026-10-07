import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Durable-storage timing contract for fetchAllWikidata (review cycle 1):
//  - a shared-cache hit must NOT wait for slower durable storage;
//  - a stalled durable read must NOT stall the request (bounded budget);
//  - with a stale snapshot available, a slow upstream must be aborted and
//    the stale served BEFORE the route's 2500ms race (not after SPARQL
//    5s+retry), with no retry after abort.
const persistCtl = vi.hoisted(() => ({
  getImpl: null as null | (() => Promise<unknown>),
  setCalls: [] as Array<{ tmdbId: number; mediaType: string; input: unknown }>,
  lastSignal: null as AbortSignal | null | undefined,
}))

vi.mock("@/lib/wikidata-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wikidata-cache")>()
  return {
    ...actual,
    getPersistedWikidata: (...args: [number, string, AbortSignal?]) => {
      // Capture only: the mock never listens to the signal.
      persistCtl.lastSignal = args[2]
      return persistCtl.getImpl ? persistCtl.getImpl() : Promise.resolve(null)
    },
    setPersistedWikidata: (tmdbId: number, mediaType: string, input: unknown) => {
      persistCtl.setCalls.push({ tmdbId, mediaType, input })
      return Promise.resolve(true)
    },
  }
})

// Fake ioredis (in-memory strings, no network) — only the shared-hit and
// delayed-shared tests enable KV mode; every other test runs file-mode
// (immediate shared miss).
const fakeKv = vi.hoisted(() => ({
  strings: new Map<string, string>(),
  getDelayMs: 0,
}))

vi.mock("ioredis", () => {
  class FakeRedis {
    constructor(_url: string, _opts: unknown) {}
    async get(key: string): Promise<string | null> {
      if (fakeKv.getDelayMs > 0) {
        await new Promise((r) => setTimeout(r, fakeKv.getDelayMs))
      }
      return fakeKv.strings.get(key) ?? null
    }
    async set(key: string, value: string, ..._args: Array<string | number>): Promise<string> {
      fakeKv.strings.set(key, value)
      return "OK"
    }
    async quit(): Promise<string> {
      return "OK"
    }
  }
  return { default: FakeRedis }
})

import { closeKvClient } from "@/lib/kv"
import {
  __resetCircuitBreaker,
  __resetWikidataNegativeForTest,
  __resetWikidataRestBreakerForTest,
  fetchAllWikidata,
  isBreakerOpen,
} from "@/lib/awards"
import { cacheClear, cacheSet } from "@/lib/cache"

const DAY_MS = 24 * 60 * 60 * 1000

const GOOD = { awards: ["Oscar"], nominations: [], studios: [], director: null }
const STALE_PAYLOAD = { awards: ["Cannes"], nominations: [], studios: [], director: null }

function sparqlOk(bindings: unknown[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).includes("sparql")) {
      return new Response(JSON.stringify({ results: { bindings } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    throw new Error(`unexpected fetch: ${String(input)}`)
  })
}

beforeEach(() => {
  cacheClear()
  __resetCircuitBreaker()
  __resetWikidataRestBreakerForTest()
  __resetWikidataNegativeForTest()
  persistCtl.getImpl = null
  persistCtl.setCalls = []
  persistCtl.lastSignal = null
  fakeKv.strings.clear()
  fakeKv.getDelayMs = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

afterAll(async () => {
  await closeKvClient()
})

describe("fetchAllWikidata durable timing contract", () => {
  it("shared L2 hit returns without waiting for a stalled durable read", async () => {
    vi.stubEnv("PICTORIUM_REDIS_URL", "redis://localhost:6379")
    vi.stubEnv("KV_REST_API_URL", "")
    vi.stubEnv("KV_REST_API_TOKEN", "")
    cacheSet(
      "wikidata:v2:movie:7201",
      { ...GOOD, degraded: false },
      ["wikidata"],
      7 * DAY_MS,
    )
    // Let the fire-and-forget KV write land before dropping L1.
    await new Promise((r) => setTimeout(r, 50))
    cacheClear()
    // Durable read stalls forever: a shared hit must not wait for it, and
    // the prefetch is aborted on the hit (no unbounded detached read).
    persistCtl.getImpl = () => new Promise(() => {})
    const t0 = Date.now()
    const res = await fetchAllWikidata(7201, "movie")
    expect(Date.now() - t0).toBeLessThan(250)
    expect(res).toEqual({ ...GOOD, degraded: false })
    expect(persistCtl.setCalls.length).toBe(0)
    // The detached prefetch is aborted on the hit (no unbounded read).
    expect(persistCtl.lastSignal?.aborted).toBe(true)
  })

  it("shared miss + stalled durable read proceeds within the 250ms budget", async () => {
    persistCtl.getImpl = () => new Promise(() => {})
    sparqlOk([{ awardLabel: { value: "Academy Award", type: "literal" } }])
    const t0 = Date.now()
    const res = await fetchAllWikidata(7202, "movie")
    const dt = Date.now() - t0
    // The stalled store costs (about) the declared budget, never more.
    expect(dt).toBeGreaterThanOrEqual(200)
    expect(dt).toBeLessThan(1000)
    expect(res.awards).toEqual(["Oscar"])
    expect(res.degraded).toBe(false)
    expect(
      persistCtl.setCalls.some(
        (c) => (c.input as { degraded?: boolean }).degraded === false,
      ),
    ).toBe(true)
  })

  it("stale + stalled upstream serves stale at the budget, aborts, no retry", async () => {
    const fetchedAt = Date.now() - 10 * DAY_MS
    persistCtl.getImpl = () =>
      Promise.resolve({ payload: { ...STALE_PAYLOAD }, fetchedAt, status: "stale" })
    let fetchCalls = 0
    let abortSeen = false
    vi.spyOn(globalThis, "fetch").mockImplementation((_input: unknown, init?: unknown) => {
      fetchCalls++
      const sig = (init as RequestInit | undefined)?.signal
      return new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          abortSeen = true
          reject(new DOMException("Aborted", "AbortError"))
        }
        if (sig?.aborted) {
          onAbort()
          return
        }
        sig?.addEventListener("abort", onAbort, { once: true })
      })
    })
    vi.useFakeTimers()
    const pending = fetchAllWikidata(7203, "movie")
    await vi.advanceTimersByTimeAsync(1600)
    const res = await pending
    expect(res).toEqual({ ...STALE_PAYLOAD, degraded: true })
    expect(abortSeen).toBe(true)
    // Retries after abort are forbidden: no second upstream call ever.
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchCalls).toBe(1)
  })

  it("stale + quick upstream success refreshes to fresh and persists it", async () => {
    persistCtl.getImpl = () =>
      Promise.resolve({
        payload: { ...STALE_PAYLOAD },
        fetchedAt: Date.now() - 10 * DAY_MS,
        status: "stale",
      })
    sparqlOk([{ awardLabel: { value: "Academy Award", type: "literal" } }])
    const res = await fetchAllWikidata(7204, "movie")
    expect(res.awards).toEqual(["Oscar"])
    expect(res.degraded).toBe(false)
    expect(
      persistCtl.setCalls.some(
        (c) =>
          (c.input as { degraded?: boolean }).degraded === false &&
          ((c.input as { awards?: string[] }).awards ?? []).includes("Oscar"),
      ),
    ).toBe(true)
  })

  it("no stale + upstream failure stays empty degraded (unchanged)", async () => {
    persistCtl.getImpl = () => Promise.resolve(null)
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("sparql down"))
    const res = await fetchAllWikidata(7205, "movie")
    expect(res).toEqual({ awards: [], nominations: [], studios: [], director: null, degraded: true })
  })

  it("caller aborts during stale refresh count nothing (vs local deadline counting once)", async () => {
    const fetchedAt = Date.now() - 10 * DAY_MS
    persistCtl.getImpl = () =>
      Promise.resolve({ payload: { ...STALE_PAYLOAD }, fetchedAt, status: "stale" })
    let fetchCalls = 0
    vi.spyOn(globalThis, "fetch").mockImplementation((_input: unknown, init?: unknown) => {
      fetchCalls++
      const sig = (init as RequestInit | undefined)?.signal
      return new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
        if (sig?.aborted) {
          onAbort()
          return
        }
        sig?.addEventListener("abort", onAbort, { once: true })
      })
    })
    vi.useFakeTimers()
    // 5 caller-aborted stale trials: every one serves stale, none counts —
    // the breaker stays closed (a local-deadline timeout counts exactly
    // once each instead, see the next test).
    for (let i = 0; i < 5; i++) {
      __resetWikidataNegativeForTest()
      const ctrl = new AbortController()
      const pending = fetchAllWikidata(7220, "movie", ctrl.signal)
      await vi.advanceTimersByTimeAsync(500)
      ctrl.abort()
      await vi.advanceTimersByTimeAsync(2000)
      const res = await pending
      expect(res).toEqual({ ...STALE_PAYLOAD, degraded: true })
    }
    expect(fetchCalls).toBe(5)
    expect(isBreakerOpen()).toBe(false)
  })

  it("delayed shared miss + stale + slow upstream falls back within the 2250ms total", async () => {
    vi.stubEnv("PICTORIUM_REDIS_URL", "redis://localhost:6379")
    vi.stubEnv("KV_REST_API_URL", "")
    vi.stubEnv("KV_REST_API_TOKEN", "")
    // Shared L2 miss after a 1400ms stall (inside the 1500ms KV cap).
    fakeKv.getDelayMs = 1400
    const fetchedAt = Date.now() - 10 * DAY_MS
    persistCtl.getImpl = () =>
      Promise.resolve({ payload: { ...STALE_PAYLOAD }, fetchedAt, status: "stale" })
    let fetchCalls = 0
    let abortSeen = false
    vi.spyOn(globalThis, "fetch").mockImplementation((_input: unknown, init?: unknown) => {
      fetchCalls++
      const sig = (init as RequestInit | undefined)?.signal
      return new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          abortSeen = true
          reject(new DOMException("Aborted", "AbortError"))
        }
        if (sig?.aborted) {
          onAbort()
          return
        }
        sig?.addEventListener("abort", onAbort, { once: true })
      })
    })
    vi.useFakeTimers()
    // Elapsed at upstream start ≈1400 → refresh budget min(1500, 850) = 850:
    // the stale lands at ≈2250ms from start, inside the route's 2500 race.
    const pending = fetchAllWikidata(7206, "movie")
    await vi.advanceTimersByTimeAsync(2250)
    const res = await pending
    expect(res).toEqual({ ...STALE_PAYLOAD, degraded: true })
    expect(abortSeen).toBe(true)
    // No retry after the budget abort: a single upstream attempt, ever.
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchCalls).toBe(1)
  })

  it("stale-timeout hangs count the breaker exactly once each; 6th short-circuits", async () => {
    const fetchedAt = Date.now() - 10 * DAY_MS
    persistCtl.getImpl = () =>
      Promise.resolve({ payload: { ...STALE_PAYLOAD }, fetchedAt, status: "stale" })
    let fetchCalls = 0
    vi.spyOn(globalThis, "fetch").mockImplementation((_input: unknown, init?: unknown) => {
      fetchCalls++
      const sig = (init as RequestInit | undefined)?.signal
      return new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
        if (sig?.aborted) {
          onAbort()
          return
        }
        sig?.addEventListener("abort", onAbort, { once: true })
      })
    })
    vi.useFakeTimers()
    try {
      // 5 consecutive budget-timeouts (negative reset each round so every
      // hang reaches upstream and counts exactly one failure).
      for (let i = 0; i < 5; i++) {
        __resetWikidataNegativeForTest()
        const pending = fetchAllWikidata(7210, "movie")
        await vi.advanceTimersByTimeAsync(1600)
        const res = await pending
        expect(res).toEqual({ ...STALE_PAYLOAD, degraded: true })
      }
      expect(fetchCalls).toBe(5)
      expect(isBreakerOpen()).toBe(true)
      // 6th: the open breaker short-circuits — zero new upstream calls.
      __resetWikidataNegativeForTest()
      const last = fetchAllWikidata(7210, "movie")
      await vi.advanceTimersByTimeAsync(1600)
      expect(await last).toEqual({ ...STALE_PAYLOAD, degraded: true })
      expect(fetchCalls).toBe(5)
    } finally {
      vi.useRealTimers()
    }
  })
})
