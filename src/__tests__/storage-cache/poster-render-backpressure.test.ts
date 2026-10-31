import { afterEach, describe, expect, it, vi } from "vitest"

// Backpressure 503 del render limiter: path mai esercitato prima (i test
// esistenti coprono acquire/coda/FIFO, mai il timeout del waiter né il
// queue-limit). I knob sono module-level → stubEnv + reimport dinamico
// (nessun import statico di poster-runtime-cache in questo file).

async function importCache() {
  vi.resetModules()
  return import("@/lib/poster-runtime-cache")
}

describe("render slot backpressure (503 path)", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("waiter resolves null after RENDER_SLOT_WAIT_MS when slots stay full", async () => {
    vi.stubEnv("PICTORIUM_RENDER_SLOT_WAIT_MS", "500")
    vi.stubEnv("PICTORIUM_MAX_CONCURRENT_RENDERS", "4")
    const m = await importCache()
    expect(m.RENDER_SLOT_WAIT_MS).toBe(500)

    const releases: Array<() => void> = []
    for (let i = 0; i < 4; i++) releases.push((await m.acquirePosterRenderSlot())!)

    const t0 = Date.now()
    const fifth = await m.acquirePosterRenderSlot()
    const waited = Date.now() - t0
    expect(fifth).toBeNull()
    expect(waited).toBeGreaterThanOrEqual(450) // ha atteso, non fail-fast
    expect(waited).toBeLessThan(5000)

    releases.forEach((r) => r())
    // Slot liberati → si acquisisce di nuovo.
    const again = await m.acquirePosterRenderSlot()
    expect(again).toBeTruthy()
    again!()
  })

  it("queue limit rejects waiters beyond N immediately (no 15s wait)", async () => {
    vi.stubEnv("PICTORIUM_RENDER_SLOT_WAIT_MS", "5000")
    vi.stubEnv("PICTORIUM_RENDER_QUEUE", "1")
    vi.stubEnv("PICTORIUM_MAX_CONCURRENT_RENDERS", "4")
    const m = await importCache()

    const releases: Array<() => void> = []
    for (let i = 0; i < 4; i++) releases.push((await m.acquirePosterRenderSlot())!)

    const w1 = m.acquirePosterRenderSlot() // in coda
    const t0 = Date.now()
    const w2 = await m.acquirePosterRenderSlot() // oltre il limite: subito null
    expect(w2).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1000)

    releases[0]()
    const r1 = await w1
    expect(r1).toBeTruthy()
    r1!()
    releases.slice(1).forEach((r) => r())
  })
})
