import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cacheClear } from "@/lib/cache"
import * as cacheModule from "@/lib/cache"
import {
  fetchAggregatedRating,
  __resetMdblistBreaker,
  __resetMdbRawForTest,
  __resetRatingsNullForTest,
} from "@/lib/ratings"

// Hydration-inside-inflight (task 2 correction): the L2 KV lookup belongs to
// the shared owned operation, registered BEFORE any KV await. Concurrent
// callers — even staggered while the KV read is pending — share one KV lookup
// and at most one upstream; a caller that leaves on its own budget never
// aborts another subscriber's work, and zero subscribers means no MDB
// request after KV.
//
// Deterministic lib-level mock: spying cacheGetShared (static import, same
// interception pattern as the cacheSet spy in ratings-mdblist-raw-ttl) avoids
// the racy dynamic `@/lib/upstash-kv-client` SDK mock entirely — every KV-op here is
// synchronous mock code, so concurrency is fully deterministic.

const RICH = {
  ratings: [
    { source: "metacritic", value: 85, score: 85 },
    { source: "trakt", value: 83, score: 83 },
  ],
}

function okRatings(body: unknown) {
  return { ok: true, json: async () => body }
}

function mdblistCalls(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter(([input]) => String(input).includes("mdblist.com")).length
}

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, 5))
  }
}

function stubKvGate() {
  let release!: (value: null) => void
  const gate = new Promise<null>((resolve) => {
    release = resolve
  })
  const spy = vi
    .spyOn(cacheModule, "cacheGetShared")
    .mockImplementation(
      (async () => gate) as unknown as typeof cacheModule.cacheGetShared,
    )
  return { spy, release }
}

beforeEach(() => {
  cacheClear()
  __resetMdblistBreaker()
  __resetRatingsNullForTest()
  __resetMdbRawForTest()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  cacheClear()
  __resetMdbRawForTest()
  __resetRatingsNullForTest()
})

describe("MDBList raw hydration inside shared operation (task 2 correction)", () => {
  it("stalled KV lookup respects caller budget and never starts MDB after cancellation", async () => {
    const fetchMock = vi.fn(async () => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)
    const { spy, release } = stubKvGate()
    try {
      const start = Date.now()
      const res = await fetchAggregatedRating("tt_hyd_stall", "keyA", undefined, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 300,
      })
      const elapsed = Date.now() - start
      expect(res).toBeNull()
      // Caller budget wins over the stalled KV (which never resolves before
      // this point): no hang on the hydration wait.
      expect(elapsed).toBeLessThan(1500)
      // KV still stalled: no MDB upstream may have started.
      expect(mdblistCalls(fetchMock)).toBe(0)
      // Release the orphaned KV lookup as a miss AFTER every subscriber left:
      // no MDB request may start on behalf of cancelled callers.
      release(null)
      await new Promise((r) => setTimeout(r, 150))
      expect(mdblistCalls(fetchMock)).toBe(0)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      release(null)
    }
  })

  it("staggered hydration callers share one KV lookup and one upstream", async () => {
    const fetchMock = vi.fn(async () => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)
    const { spy, release } = stubKvGate()
    try {
      const p1 = fetchAggregatedRating("tt_hyd_share", "keyA", undefined, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 2000,
      })
      // Stagger: p2 arrives while p1's owned KV hydration is still pending.
      await waitFor(() => spy.mock.calls.length === 1)
      const p2 = fetchAggregatedRating("tt_hyd_share", "keyA", undefined, {
        requestedSources: ["trakt"],
        ratingWaitMs: 2000,
      })
      await new Promise((r) => setTimeout(r, 50))
      // p2 joined the shared operation: no second KV lookup, no upstream yet.
      expect(spy).toHaveBeenCalledTimes(1)
      expect(mdblistCalls(fetchMock)).toBe(0)
      release(null)
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1?.sources.metacritic).toBe(8.5)
      expect(r2?.sources.trakt).toBe(8.3)
      expect(mdblistCalls(fetchMock)).toBe(1)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      release(null)
    }
  })

  it("late KV miss does not duplicate a successful fetch", async () => {
    let releaseUpstream!: () => void
    const upstreamGate = new Promise<void>((resolve) => {
      releaseUpstream = resolve
    })
    let releaseSlow!: (value: null) => void
    const slowGate = new Promise<null>((resolve) => {
      releaseSlow = resolve
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!String(input).includes("mdblist.com")) throw new Error(`unexpected upstream ${String(input)}`)
      await upstreamGate
      return okRatings(RICH)
    })
    vi.stubGlobal("fetch", fetchMock)
    // First KV lookup is a fast miss (owner proceeds to upstream); any second
    // lookup would be a slow miss completing only after the fetch succeeded.
    let kvCalls = 0
    const spy = vi.spyOn(cacheModule, "cacheGetShared").mockImplementation(
      (async () => {
        kvCalls += 1
        if (kvCalls === 1) return null
        return slowGate
      }) as unknown as typeof cacheModule.cacheGetShared,
    )
    try {
      const p1 = fetchAggregatedRating("tt_hyd_late", "keyA", undefined, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 3000,
      })
      await waitFor(() => mdblistCalls(fetchMock) === 1)
      // Late joiner while the single upstream is in flight: shares it, never
      // starts its own KV lookup.
      const p2 = fetchAggregatedRating("tt_hyd_late", "keyA", undefined, {
        requestedSources: ["trakt"],
        ratingWaitMs: 3000,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(kvCalls).toBe(1)
      expect(spy).toHaveBeenCalledTimes(1)
      releaseUpstream()
      releaseSlow(null)
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1?.sources.metacritic).toBe(8.5)
      expect(r2?.sources.trakt).toBe(8.3)
      // The late KV miss (had it existed) must not duplicate the fetch that
      // already succeeded and cached the raw entry.
      expect(mdblistCalls(fetchMock)).toBe(1)
      expect(kvCalls).toBe(1)
    } finally {
      releaseUpstream()
      releaseSlow(null)
    }
  })

  it("one subscriber abort does not affect the other: single upstream", async () => {
    const fetchMock = vi.fn(async () => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)
    const { spy, release } = stubKvGate()
    try {
      const ctrl = new AbortController()
      const p1 = fetchAggregatedRating("tt_hyd_abort", "keyA", ctrl.signal, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 2000,
      })
      await waitFor(() => spy.mock.calls.length === 1)
      const p2 = fetchAggregatedRating("tt_hyd_abort", "keyA", undefined, {
        requestedSources: ["trakt"],
        ratingWaitMs: 2000,
      })
      // Abort one subscriber while hydration is pending: the shared operation
      // survives for the other subscriber.
      ctrl.abort()
      await new Promise((r) => setTimeout(r, 20))
      release(null)
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toBeNull()
      expect(r2?.sources.trakt).toBe(8.3)
      expect(mdblistCalls(fetchMock)).toBe(1)
    } finally {
      release(null)
    }
  })
})
