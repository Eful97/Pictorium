// Test della grazia zombie (R5). Env a module level PRIMA del dynamic import:
// un solo slot e grazia minima (1000ms, floor del clamp) — test deterministici.
process.env.PICTORIUM_MAX_CONCURRENT_RENDERS = "1"
process.env.PICTORIUM_ZOMBIE_GRACE_MS = "1000"

import { afterEach, describe, expect, it } from "vitest"

const m = await import("@/lib/poster-runtime-cache")

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe("zombie render grace (R5)", () => {
  afterEach(() => {
    m.__resetPosterRenderLimiter()
  })

  it("force-releases the slot budget after the grace period", async () => {
    const before = m.getPosterStats().zombieGraceExpired
    const endZombie = m.recordZombieRenderStart()
    expect(m.getPosterStats().zombieRenders).toBe(1)

    // Lo zombie non termina mai: dopo la grazia il budget si libera da solo.
    await sleep(1500)
    expect(m.getPosterStats().zombieRenders).toBe(0)
    expect(m.getPosterStats().zombieGraceExpired).toBe(before + 1)

    // E lo slot è di nuovo acquisibile nonostante lo zombie appeso.
    const release = await m.acquirePosterRenderSlot()
    expect(release).toBeTruthy()
    release!()

    // Cleanup tardiva dello zombie: nessun doppio decremento.
    endZombie()
    expect(m.getPosterStats().zombieRenders).toBe(0)
  })

  it("wakes a queued waiter when the grace expires", async () => {
    m.recordZombieRenderStart() // zombie=1 su MAX=1 → slot apparentemente pieno
    let resolved = false
    const pending = m.acquirePosterRenderSlot().then((r) => {
      resolved = true
      return r
    })
    await sleep(20)
    expect(resolved).toBe(false)
    const release = await pending
    expect(resolved).toBe(true)
    expect(release).toBeTruthy()
    release!()
  })

  it("normal zombie cleanup does not consume the grace budget", async () => {
    const before = m.getPosterStats().zombieGraceExpired
    const endZombie = m.recordZombieRenderStart()
    expect(m.getPosterStats().zombieRenders).toBe(1)
    endZombie()
    expect(m.getPosterStats().zombieRenders).toBe(0)
    await sleep(1500)
    expect(m.getPosterStats().zombieGraceExpired).toBe(before)
  })

  it("force-releases accounting after grace while original zombie work is still pending, late cleanup keeps the new slot", async () => {
    const beforeExpired = m.getPosterStats().zombieGraceExpired
    const endOriginal = m.recordZombieRenderStart("risk-probe")
    // True controllable deferred: the original work stays in flight until we
    // resolve it. Cleanup is hooked to its finally so endOriginal is never
    // called directly — only via the deferred lifecycle. Logical simulated
    // pending work overlaps after grace (no heap/CPU/OOM measured here).
    let originalWorkPending = true
    let resolveOriginalWork!: () => void
    const originalWork = new Promise<void>((resolve) => {
      resolveOriginalWork = resolve
    })
    const cleanupDone = originalWork.finally(() => {
      originalWorkPending = false
      endOriginal()
    })
    expect(m.getPosterStats().zombieRenders).toBe(1)
    expect(m.getPosterStats().activeRenders).toBe(0)

    // During grace the accounting cap holds: a newcomer queues, it is not admitted.
    let admitted = false
    const pending = m.acquirePosterRenderSlot().then((r) => {
      admitted = true
      return r
    })
    let releaseNew: (() => void) | null = null
    try {
      await sleep(50)
      expect(admitted).toBe(false)
      expect(m.getPosterStats().zombieRenders).toBe(1)
      expect(m.getPosterStats().activeRenders).toBe(0)
      expect(m.getPosterStats().queuedRenders).toBe(1)
      expect(originalWorkPending).toBe(true)

      // After grace the waiter is re-admitted while the deferred original
      // work is still pending: accounting reads free (zombie=0, active=1)
      // but the logical overlap (new slot + unsettled original) exceeds MAX=1.
      releaseNew = await pending
      expect(admitted).toBe(true)
      expect(releaseNew).toBeTruthy()
      expect(m.getPosterStats().zombieGraceExpired).toBe(beforeExpired + 1)
      expect(m.getPosterStats().zombieRenders).toBe(0)
      expect(m.getPosterStats().activeRenders).toBe(1)
      expect(originalWorkPending).toBe(true)

      // Resolve the deferred original and await its hooked cleanup: the late
      // cleanup must not touch the newly admitted slot.
      resolveOriginalWork()
      await cleanupDone
      expect(originalWorkPending).toBe(false)
      expect(m.getPosterStats().zombieRenders).toBe(0)
      expect(m.getPosterStats().activeRenders).toBe(1)
    } finally {
      // Drain on failure too: settle the deferred and the waiter so no
      // task/timer leaks into the next test.
      if (originalWorkPending) {
        resolveOriginalWork()
        await cleanupDone
      }
      const settled = releaseNew ?? (await pending)
      settled?.()
      expect(m.getPosterStats().activeRenders).toBe(0)
    }
  })
})
