import type { VisualPresetShape, VisualPresetValues } from "./visual-presets"

/**
 * Community "Apply" bridge (module micro-state, like `settings-tab.ts`): the
 * community page records the preset, sets the edit target shape and opens
 * settings on the Preset tab; the Preset panel consumes it exactly once, only
 * for its own shape, applying through the staged session (a reviewable draft,
 * saved with "Save changes").
 */
export interface PendingPresetApply {
  id: string
  name: string
  shape: VisualPresetShape
  values: VisualPresetValues
  /** Built-in ready look: applied through the ready path (Fresh owns its layout). */
  ready?: { fresh: boolean }
}

let pending: PendingPresetApply | null = null

export function requestPresetApply(preset: PendingPresetApply): void {
  pending = preset
}

/** Returns and clears the request when it targets `shape`; otherwise leaves it. */
export function consumePresetApply(shape: VisualPresetShape): PendingPresetApply | null {
  if (!pending || pending.shape !== shape) return null
  const out = pending
  pending = null
  return out
}
