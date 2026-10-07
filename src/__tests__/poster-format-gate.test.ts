import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FORMAT_QUEUE_LIMIT,
  FORMAT_SLOT_WAIT_MS,
  FormatOverloadError,
  MAX_FORMAT_CONVERSIONS,
  __resetFormatGateForTests,
  runFormatConversion,
} from "@/lib/poster-format-gate"

const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms) })

afterEach(() => {
  __resetFormatGateForTests()
  vi.useRealTimers()
})

describe("poster format gate (mocked conversions, no sharp/network)", () => {
  it("uses a dedicated budget of 2 native conversions (not the render semaphore)", () => {
    // Guard against silent budget drift: the render limiter defaults to 4,
    // the format gate must stay on its own smaller budget (deadlock safety).
    expect(MAX_FORMAT_CONVERSIONS).toBe(2)
  })

  it("coalesces concurrent conversions of the same key/ETag into one native run", async () => {
    let runs = 0
    const run = async () => {
      runs++
      await sleep(20)
      return Buffer.from("variant-bytes")
    }
    // Same key = same variantKey + same canonical ETag + same format.
    const key = "poster:v1:movie:1:fmtjpeg:\"canon-etag\":jpeg"
    const results = await Promise.all(Array.from({ length: 8 }, () => runFormatConversion(key, run)))
    for (const buf of results) expect(buf.toString()).toBe("variant-bytes")
    expect(runs).toBe(1)
  })

  it("never mixes canonical revisions: distinct ETags convert independently", async () => {
    let runs = 0
    const runFor = (tag: string) => async () => {
      runs++
      await sleep(10)
      return Buffer.from(tag)
    }
    const [a, b] = await Promise.all([
      runFormatConversion("vk:\"etag-A\":jpeg", runFor("bytes-A")),
      runFormatConversion("vk:\"etag-B\":jpeg", runFor("bytes-B")),
    ])
    expect(runs).toBe(2)
    expect(a.toString()).toBe("bytes-A")
    expect(b.toString()).toBe("bytes-B")
  })

  it("bounds distinct conversions to 2 natives (peak active never exceeded)", async () => {
    let active = 0
    let peak = 0
    const run = async () => {
      active++
      peak = Math.max(peak, active)
      await sleep(30)
      active--
      return Buffer.from("x")
    }
    await Promise.all(Array.from({ length: 6 }, (_, i) => runFormatConversion(`vk:\"e${i}\":jpeg`, run)))
    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBe(2)
  })

  it("releases the slot on failure and retries fresh (no poison, no unhandled)", async () => {
    let runs = 0
    const failing = async (): Promise<Buffer> => {
      runs++
      await sleep(5)
      throw new Error("native boom")
    }
    const key = "vk:\"etag-fail\":jpeg"
    // Two coalesced waiters share the single failing leader.
    const settled = await Promise.allSettled([
      runFormatConversion(key, failing),
      runFormatConversion(key, failing),
    ])
    expect(settled.filter((s) => s.status === "rejected")).toHaveLength(2)
    expect(runs).toBe(1)
    // Inflight entry dropped: the retry runs again and succeeds.
    const ok = await runFormatConversion(key, async () => Buffer.from("recovered"))
    expect(ok.toString()).toBe("recovered")
    expect(runs).toBe(1)
    // Slots freed: a fresh burst still converts.
    const again = await runFormatConversion("vk:\"etag-fail2\":jpeg", async () => Buffer.from("ok2"))
    expect(again.toString()).toBe("ok2")
  })

  it("holds no persistent cache: sequential same-key calls re-run (route owns TTL + preview no-store)", async () => {
    let runs = 0
    const key = "vk:\"etag-seq\":jpeg"
    await runFormatConversion(key, async () => { runs++; return Buffer.from("a") })
    await runFormatConversion(key, async () => { runs++; return Buffer.from("a") })
    // Inflight-only coalescing: after settle nothing is retained. The
    // persistent variant entry (with TTL) and the `preview=1` no-store skip
    // stay in the route (`if (!isPreview) writeCachedPoster`), unchanged.
    expect(runs).toBe(2)
  })

  it("answers 503 on queue-full overload without caching the failure", async () => {
    // Occupy both natives with deferred leaders.
    let releaseLeader!: () => void
    const leaderGate = new Promise<void>((r) => { releaseLeader = r })
    const leader = () => leaderGate.then(() => Buffer.from("leader"))
    const pending = [
      runFormatConversion("vk:\"q0\":jpeg", leader),
      runFormatConversion("vk:\"q1\":jpeg", leader),
    ]
    // Saturate the bounded queue with distinct waiters.
    const queued: Array<Promise<Buffer>> = []
    for (let i = 0; i < FORMAT_QUEUE_LIMIT; i++) {
      queued.push(runFormatConversion(`vk:\"qw${i}\":jpeg`, async () => Buffer.from("w")))
    }
    // One more distinct key: queue full → immediate 503 signal, no waiting.
    await expect(runFormatConversion("vk:\"over\":jpeg", async () => Buffer.from("never")))
      .rejects.toBeInstanceOf(FormatOverloadError)
    try {
      await runFormatConversion("vk:\"over\":jpeg", async () => Buffer.from("never"))
      expect.unreachable("must throw on overload")
    } catch (e) {
      expect(e).toBeInstanceOf(FormatOverloadError)
      expect((e as FormatOverloadError).status).toBe(503)
    }
    // No failure cached in the gate: after draining, the same key converts.
    releaseLeader()
    await Promise.all([...pending, ...queued])
    const retry = await runFormatConversion("vk:\"over\":jpeg", async () => Buffer.from("served"))
    expect(retry.toString()).toBe("served")
  })

  it("wait deadline dequeues only the waiter — active work is never released early", async () => {
    vi.useFakeTimers()
    try {
      // Two natives held until we say so.
      let releaseLeader!: () => void
      const leaderGate = new Promise<void>((r) => { releaseLeader = r })
      const p1 = runFormatConversion("vk:\"w0\":jpeg", () => leaderGate.then(() => Buffer.from("one")))
      const p2 = runFormatConversion("vk:\"w1\":jpeg", () => leaderGate.then(() => Buffer.from("two")))
      await vi.advanceTimersByTimeAsync(0)
      // A third waiter queues, then hits its wait deadline → 503.
      const waiter = runFormatConversion("vk:\"waiter\":jpeg", async () => Buffer.from("late"))
      const assertion = expect(waiter).rejects.toBeInstanceOf(FormatOverloadError)
      await vi.advanceTimersByTimeAsync(FORMAT_SLOT_WAIT_MS + 100)
      await assertion
      // The leaders are untouched by the waiter timeout: they still settle
      // normally (slot released only after native settle, per finally).
      releaseLeader()
      await expect(p1).resolves.toEqual(Buffer.from("one"))
      await expect(p2).resolves.toEqual(Buffer.from("two"))
      // And the timed-out waiter key was never poisoned: it converts now.
      vi.useRealTimers()
      const retry = await runFormatConversion("vk:\"waiter\":jpeg", async () => Buffer.from("served"))
      expect(retry.toString()).toBe("served")
    } finally {
      vi.useRealTimers()
    }
  })
})
