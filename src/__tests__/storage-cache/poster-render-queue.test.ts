// Test della coda bounded del limiter render (F5, opzionale): con
// POSTERIUM_RENDER_QUEUE=N, i waiter oltre N ricevono 503 immediato.
// Env impostata PRIMA del dynamic import (letture a module level).
process.env.POSTERIUM_RENDER_QUEUE = "1"
process.env.POSTERIUM_RENDER_SLOT_WAIT_MS = "500"
// Deterministic slot count on any host CPU (H1 default is
// availableParallelism()-derived, 2..8): pin to the historical 4, same
// file-top pattern as the knobs above.
process.env.PICTORIUM_MAX_CONCURRENT_RENDERS = "4"

import { afterEach, describe, expect, it } from "vitest"

const { acquirePosterRenderSlot, __resetPosterRenderLimiter } = await import("@/lib/poster-runtime-cache")

describe("bounded render queue", () => {
  afterEach(() => {
    __resetPosterRenderLimiter()
  })

  it("rejects waiters beyond the queue limit immediately", async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < 4; i++) {
      const release = await acquirePosterRenderSlot()
      expect(release).toBeTruthy()
      releases.push(release!)
    }

    // 5° acquire: si accoda (coda limite 1).
    let fifthResolved = false
    const fifth = acquirePosterRenderSlot().then((r) => { fifthResolved = true; return r })
    await new Promise((r) => setTimeout(r, 50))
    expect(fifthResolved).toBe(false)

    // 6° acquire: coda piena → 503 immediato (null), senza attendere.
    const started = Date.now()
    const sixth = await acquirePosterRenderSlot()
    expect(sixth).toBeNull()
    expect(Date.now() - started).toBeLessThan(200)

    // Rilasciando un posto, il 5° waiter entra.
    releases[0]()
    const fifthRelease = await fifth
    expect(fifthRelease).toBeTruthy()
    fifthRelease!()
    releases.slice(1).forEach((r) => r())
  })
})
