import { afterEach, describe, expect, it, vi } from "vitest"
import {
  __resetImageBytesForTest,
  cachedImageBytes,
  imageBytesStats,
  peekImageBytes,
} from "@/lib/image-bytes-cache"
import { fetchImg } from "@/lib/poster-render-helpers"

// Third (signal) parameter: the waiter-cancellation fix threads the caller's
// own abort through the coalesced wait instead of holding past it.
const cachedWithSignal = (
  url: string,
  doFetch: () => Promise<Buffer>,
  signal?: AbortSignal,
): Promise<Buffer> => cachedImageBytes(url, doFetch, signal)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function abortError(): Error {
  return new DOMException("Aborted", "AbortError")
}

function timeoutError(): Error {
  return new DOMException("The operation timed out", "TimeoutError")
}

// Joining the inflight entry is synchronous (the entry is registered before
// the first await), so aborting on the next line still hits a joined waiter:
// no sleep is needed before aborting. The 250ms bound below is only an
// anti-hang detector so a regression fails fast instead of stranding the
// gated leader until the suite timeout; the gate is always released in
// `finally` and every owned promise is joined with `allSettled`.
async function settleKind(promise: Promise<unknown>): Promise<string> {
  return (await Promise.race([
    promise.then(
      () => "resolved" as const,
      (e: unknown) =>
        e instanceof DOMException
          ? (`rejected:${e.name}` as const)
          : (`rejected:${String(e)}` as const),
    ),
    new Promise((r) => setTimeout(() => r("still-pending" as const), 250)),
  ])) as string
}

afterEach(() => {
  __resetImageBytesForTest()
  vi.restoreAllMocks()
})

describe("cachedImageBytes waiter cancellation", () => {
  it("aborted joined waiter detaches before a gated leader; healthy sibling + leader still succeed and populate cache", async () => {
    const url = "https://image.tmdb.org/t/p/w500/cancel-gated.jpg"
    const gate = deferred<Buffer>()
    let gateSettled = false
    const waiterFetch = vi.fn(async () => Buffer.from([9, 9]))
    const siblingFetch = vi.fn(async () => Buffer.from([7, 7]))

    const leader = cachedWithSignal(url, () => gate.promise)
    const waiterCtrl = new AbortController()
    const waiter = cachedWithSignal(url, waiterFetch, waiterCtrl.signal)
    const sibling = cachedWithSignal(url, siblingFetch)
    waiterCtrl.abort(abortError())
    try {
      // The waiter rejects while the gate is still closed: proof it detached
      // promptly instead of waiting out the leader (or the 15s image cap).
      expect(await settleKind(waiter)).toBe("rejected:AbortError")
      expect(waiterFetch).not.toHaveBeenCalled()
    } finally {
      // Always release the owned gate, even on assertion failure, and join
      // every owned promise so nothing is left pending.
      if (!gateSettled) {
        gateSettled = true
        gate.resolve(Buffer.from([1, 2, 3]))
      }
      await Promise.allSettled([leader, waiter, sibling])
    }

    await expect(leader).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(sibling).resolves.toEqual(Buffer.from([1, 2, 3]))
    // Leader success populates the cache; a later fetch is a hit (no fetch).
    const afterFetch = vi.fn(async () => Buffer.from([5]))
    await expect(cachedWithSignal(url, afterFetch)).resolves.toEqual(Buffer.from([1, 2, 3]))
    expect(afterFetch).not.toHaveBeenCalled()
    expect(peekImageBytes(url)?.equals(Buffer.from([1, 2, 3]))).toBe(true)
    expect(imageBytesStats()).toMatchObject({ entries: 1, bytes: 3 })
  })

  it("pre-aborted waiter neither joins nor starts nor retries; a cached hit is still served", async () => {
    const url = "https://image.tmdb.org/t/p/w500/cancel-preaborted.jpg"
    const gate = deferred<Buffer>()
    let gateSettled = false
    const leader = cachedWithSignal(url, () => gate.promise)
    const waiterFetch = vi.fn(async () => Buffer.from([8]))
    const preAborted = new AbortController()
    preAborted.abort(abortError())
    try {
      await expect(cachedWithSignal(url, waiterFetch, preAborted.signal)).rejects.toMatchObject({
        name: "AbortError",
      })
      expect(waiterFetch).not.toHaveBeenCalled()
    } finally {
      if (!gateSettled) {
        gateSettled = true
        gate.resolve(Buffer.from([4, 5]))
      }
      await Promise.allSettled([leader])
    }
    await expect(leader).resolves.toEqual(Buffer.from([4, 5]))

    // Cache-hit semantics are explicit: a pre-aborted signal with a fresh
    // entry is served the cached bytes (the cache never aborts), still with
    // no fetch.
    const hitFetch = vi.fn(async () => Buffer.from([0]))
    await expect(cachedWithSignal(url, hitFetch, preAborted.signal)).resolves.toEqual(
      Buffer.from([4, 5]),
    )
    expect(hitFetch).not.toHaveBeenCalled()

    // Miss with no inflight and a pre-aborted signal: no fetch is started.
    const freshFetch = vi.fn(async () => Buffer.from([6]))
    await expect(
      cachedWithSignal("https://image.tmdb.org/t/p/w500/cancel-preaborted-fresh.jpg", freshFetch, preAborted.signal),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(freshFetch).not.toHaveBeenCalled()
  })

  it("healthy waiter still retries exactly once after leader failure while an aborted waiter does not retry", async () => {
    const url = "https://image.tmdb.org/t/p/w500/cancel-retry-once.jpg"
    const gate = deferred<Buffer>()
    let gateSettled = false
    const leader = cachedWithSignal(url, () => gate.promise)
    const healthyFetch = vi.fn(async () => Buffer.from([3, 3]))
    const abortedFetch = vi.fn(async () => Buffer.from([4, 4]))
    const healthy = cachedWithSignal(url, healthyFetch)
    const abortedCtrl = new AbortController()
    const aborted = cachedWithSignal(url, abortedFetch, abortedCtrl.signal)
    abortedCtrl.abort(abortError())
    try {
      // Every assertion that can fail lives inside `try`: the gate is always
      // released in `finally`, so a failed assertion can never strand the
      // gated leader (or the healthy waiter hanging on it).
      expect(await settleKind(aborted)).toBe("rejected:AbortError")
      gateSettled = true
      gate.reject(new Error("fetch failed: 500"))
      await expect(leader).rejects.toThrow("fetch failed: 500")
      await expect(healthy).resolves.toEqual(Buffer.from([3, 3]))
      expect(healthyFetch).toHaveBeenCalledTimes(1)
      expect(abortedFetch).not.toHaveBeenCalled()
      expect(peekImageBytes(url)?.equals(Buffer.from([3, 3]))).toBe(true)
    } finally {
      if (!gateSettled) {
        gateSettled = true
        gate.resolve(Buffer.from([0]))
      }
      await Promise.allSettled([leader, healthy, aborted])
    }
  })

  it("leader failure poisons nothing: nothing cached, next healthy fetch repopulates", async () => {
    const url = "https://image.tmdb.org/t/p/w500/cancel-no-poison.jpg"
    const failing = vi.fn(async () => {
      throw new Error("fetch failed: 404")
    })
    await expect(cachedWithSignal(url, failing)).rejects.toThrow("fetch failed: 404")
    expect(peekImageBytes(url)).toBeNull()
    expect(imageBytesStats().entries).toBe(0)
    const good = Buffer.from([1, 1])
    await expect(cachedWithSignal(url, async () => good)).resolves.toEqual(good)
    expect(peekImageBytes(url)?.equals(good)).toBe(true)
  })
})

// Replaces ONLY the timeout scheduler (`AbortSignal.timeout`) with manually
// fired controllers that record the requested ms; `AbortSignal.any` and the
// owned controllers stay real production code. Same pattern as the cinemeta
// provider tests. Restored per test in `finally` (see below), never left
// stubbed on assertion failure.
function stubTimeoutScheduler() {
  const timeouts: Array<{ ms: number; controller: AbortController }> = []
  const real = AbortSignal.timeout
  AbortSignal.timeout = ((ms: number) => {
    const controller = new AbortController()
    timeouts.push({ ms, controller })
    return controller.signal
  }) as typeof AbortSignal.timeout
  return {
    timeouts,
    restore: () => {
      AbortSignal.timeout = real
    },
  }
}

const IMG = "https://image.tmdb.org/t/p"

// Faithful gated network: one shared download for the single URL under test,
// pending until the test releases the gate. Rejects like a real fetch when
// handed an already-aborted signal; records whether the live download ever
// saw an abort (it must not: detaching a waiter aborts only its own wait).
function gatedNetwork() {
  const gate = deferred<Response>()
  let gateSettled = false
  let fetchCalls = 0
  let fetchSawAbort = false
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    fetchCalls++
    const sig = init?.signal as AbortSignal | undefined
    if (sig?.aborted) {
      fetchSawAbort = true
      return Promise.reject(new DOMException("Aborted", "AbortError"))
    }
    sig?.addEventListener(
      "abort",
      () => {
        fetchSawAbort = true
      },
      { once: true },
    )
    return gate.promise
  }) as typeof fetch)
  return {
    gate,
    spy,
    fetchCalls: () => fetchCalls,
    fetchSawAbort: () => fetchSawAbort,
    release: (bytes: Uint8Array) => {
      if (!gateSettled) {
        gateSettled = true
        gate.resolve(new Response(Buffer.from(bytes), { status: 200 }))
      }
    },
  }
}

describe("fetchImg waiter cancellation (integration through the real path)", () => {
  it("aborting waiter detaches through fetchImg: leader + sibling complete, one network fetch", async () => {
    const sched = stubTimeoutScheduler()
    const net = gatedNetwork()
    const bytes = new Uint8Array([1, 2, 3, 4])
    const url = `${IMG}/w500/cancel-fetchimg.jpg`

    // The leader starts the single shared download; waiter and sibling join
    // it through the real fetchImg -> cachedImageBytes path, each with its
    // own combined (external + internal 15s) signal.
    const leader = fetchImg(url)
    const waiterCtrl = new AbortController()
    const waiter = fetchImg(url, waiterCtrl.signal)
    const sibling = fetchImg(url)
    waiterCtrl.abort(abortError())
    try {
      // The waiter exits alone while the shared download is still gated:
      // proof its own external abort is threaded through the joined wait.
      expect(await settleKind(waiter)).toBe("rejected:AbortError")
      expect(net.fetchCalls()).toBe(1)
      // Every fetchImg arm requested the unchanged 15s internal cap.
      expect(sched.timeouts.map((t) => t.ms)).toEqual([15000, 15000, 15000])
    } finally {
      net.release(bytes)
      await Promise.allSettled([leader, waiter, sibling])
      sched.restore()
    }

    await expect(leader).resolves.toEqual(Buffer.from(bytes))
    await expect(sibling).resolves.toEqual(Buffer.from(bytes))
    expect(net.spy).toHaveBeenCalledTimes(1)
    // Detaching the waiter never aborted the shared network download.
    expect(net.fetchSawAbort()).toBe(false)

    // Cache-hit semantics through the real path: even a pre-aborted caller
    // is served the completed entry with no extra network fetch.
    const preAborted = new AbortController()
    preAborted.abort(abortError())
    const callsBefore = net.spy.mock.calls.length
    await expect(fetchImg(url, preAborted.signal)).resolves.toEqual(Buffer.from(bytes))
    expect(net.spy.mock.calls.length).toBe(callsBefore)
  })

  it("internal 15s timeout detaches only the waiter with TimeoutError (distinct from AbortError); leader + sibling complete, one fetch", async () => {
    const sched = stubTimeoutScheduler()
    const net = gatedNetwork()
    const bytes = new Uint8Array([5, 6, 7])
    const url = `${IMG}/w500/cancel-fetchimg-timeout.jpg`

    // No external signals anywhere: each fetchImg arm carries only its own
    // internal 15s cap, so firing one arm's timeout expiry proves the
    // internal timeout alone threads through the joined wait. (The waiter
    // takes no external signal on purpose: reason propagation through a
    // composed AbortSignal.any is runtime-defined, while the bare internal
    // signal carries its TimeoutError reason verbatim in every runtime.)
    const leader = fetchImg(url)
    const waiter = fetchImg(url)
    const sibling = fetchImg(url)
    expect(sched.timeouts.map((t) => t.ms)).toEqual([15000, 15000, 15000])
    // Fire ONLY the waiter's internal timeout with a TimeoutError reason —
    // no real 15s delay, no fake timers (native timeout signals are not
    // timer-driven).
    sched.timeouts[1].controller.abort(timeoutError())
    try {
      expect(await settleKind(waiter)).toBe("rejected:TimeoutError")
      // The detach carries the TimeoutError reason, not AbortError: the
      // internal cap is distinguishable from an external abort (covered
      // with AbortError in the test above). Nothing else aborted anywhere.
      expect(net.fetchCalls()).toBe(1)
    } finally {
      net.release(bytes)
      await Promise.allSettled([leader, waiter, sibling])
      sched.restore()
    }

    await expect(leader).resolves.toEqual(Buffer.from(bytes))
    await expect(sibling).resolves.toEqual(Buffer.from(bytes))
    expect(net.spy).toHaveBeenCalledTimes(1)
    // The waiter's internal expiry never aborted the shared download.
    expect(net.fetchSawAbort()).toBe(false)
  })
})
