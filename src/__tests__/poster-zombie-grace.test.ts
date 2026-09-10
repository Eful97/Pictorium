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
})
