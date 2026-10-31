import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Deterministic slot count on any host CPU: the H1 default is
// availableParallelism()-derived (2..8), so pin the knob to the historical 4
// before the module-level read and reimport per test (same
// stubEnv+resetModules+dynamic-import pattern as the backpressure suite).
// All assertions below are unchanged.
let acquirePosterRenderSlot: typeof import("@/lib/poster-runtime-cache").acquirePosterRenderSlot
let __resetPosterRenderLimiter: typeof import("@/lib/poster-runtime-cache").__resetPosterRenderLimiter

beforeEach(async () => {
  vi.stubEnv("PICTORIUM_MAX_CONCURRENT_RENDERS", "4")
  vi.resetModules()
  const m = await import("@/lib/poster-runtime-cache")
  acquirePosterRenderSlot = m.acquirePosterRenderSlot
  __resetPosterRenderLimiter = m.__resetPosterRenderLimiter
})

describe("poster render concurrency limiter", () => {
  afterEach(() => {
    __resetPosterRenderLimiter()
    vi.unstubAllEnvs()
  })

  it("acquires up to the max concurrent slots immediately", async () => {
    const releases: Array<() => void> = []
    // Il default è 4 (POSTERIUM_MAX_CONCURRENT_RENDERS); il test non lo cambia.
    for (let i = 0; i < 4; i++) {
      const release = await acquirePosterRenderSlot()
      expect(release).toBeTruthy()
      releases.push(release!)
    }
    releases.forEach((r) => r())
  })

  it("queues requests beyond the limit and resolves them when a slot frees", async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < 4; i++) {
      releases.push((await acquirePosterRenderSlot())!)
    }
    let fifthResolved = false
    const fifthPromise = acquirePosterRenderSlot().then((r) => { fifthResolved = true; return r })
    await new Promise((r) => setTimeout(r, 50))
    expect(fifthResolved).toBe(false)

    releases[0]()
    const fifthRelease = await fifthPromise
    expect(fifthResolved).toBe(true)
    expect(fifthRelease).toBeTruthy()
    fifthRelease!()

    releases.slice(1).forEach((r) => r())
  })

  it("handles multiple queued waiters in FIFO order", async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < 4; i++) releases.push((await acquirePosterRenderSlot())!)
    const order: number[] = []
    const waiters = [1, 2, 3].map((n) => acquirePosterRenderSlot().then((r) => { order.push(n); return r }))
    releases[0]()
    releases[1]()
    releases[2]()
    const resolved = await Promise.all(waiters)
    expect(order).toEqual([1, 2, 3])
    resolved.forEach((r) => r?.())
    releases[3]()
  })
})
