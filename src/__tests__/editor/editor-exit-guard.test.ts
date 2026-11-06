/**
 * Exit-guard decision (pure leaf): leaving the per-title editor must never
 * discard a dirty draft silently, and a clean draft must exit with no extra
 * prompt (no false positives). Save-in-flight wins over everything, exactly
 * like the settings exit guard.
 */
import { describe, expect, it, vi } from "vitest"
import { resolveEditorExit } from "@/lib/editor-exit-guard"

describe("resolveEditorExit", () => {
  it("runs a clean exit immediately (no dialog)", () => {
    const run = vi.fn()
    const onGuard = vi.fn()

    expect(resolveEditorExit({ dirty: false, saving: false, run, onGuard })).toBe("ran")
    expect(run).toHaveBeenCalledTimes(1)
    expect(onGuard).not.toHaveBeenCalled()
  })

  it("guards a dirty exit without running the action", () => {
    const run = vi.fn()
    const onGuard = vi.fn()

    expect(resolveEditorExit({ dirty: true, saving: false, run, onGuard })).toBe("guarded")
    expect(onGuard).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it("ignores exit attempts while a save is in flight", () => {
    const run = vi.fn()
    const onGuard = vi.fn()

    expect(resolveEditorExit({ dirty: true, saving: true, run, onGuard })).toBe("ignored")
    expect(run).not.toHaveBeenCalled()
    expect(onGuard).not.toHaveBeenCalled()
  })
})
