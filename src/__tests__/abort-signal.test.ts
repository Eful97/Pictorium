import { describe, expect, it } from "vitest"
import { combineAbortSignals } from "@/lib/abort-signal"

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe("combineAbortSignals", () => {
  it("behaves like a plain timeout when no external signal is given", async () => {
    const combined = combineAbortSignals(undefined, 15)
    expect(combined.aborted).toBe(false)
    await sleep(80)
    expect(combined.aborted).toBe(true)
  })

  it("aborts early when the external signal fires (R3)", async () => {
    const ctrl = new AbortController()
    const combined = combineAbortSignals(ctrl.signal, 10_000)
    expect(combined.aborted).toBe(false)
    ctrl.abort()
    await sleep(10)
    expect(combined.aborted).toBe(true)
  })

  it("fires on timeout even if the external signal never aborts", async () => {
    const ctrl = new AbortController()
    const combined = combineAbortSignals(ctrl.signal, 15)
    await sleep(80)
    expect(combined.aborted).toBe(true)
  })

  it("is already aborted when the external signal is already aborted", () => {
    const ctrl = new AbortController()
    ctrl.abort()
    expect(combineAbortSignals(ctrl.signal, 10_000).aborted).toBe(true)
  })
})
