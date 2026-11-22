/**
 * Editor-only alignment grid for dragging badges (pure, browser-safe).
 *
 * Never a render value: the snapped delta goes through the normal drag path
 * (containment, write). Units are whatever the caller passes (canvas px or
 * percent); this module does not know the poster size.
 */

/** Grid spacing, percent of the poster size on each axis. */
export const DRAG_GRID_STEP_PCT = 5

/** Snap radius for grid lines, percent of the poster size on that axis. */
export const DRAG_GRID_SNAP_PCT = 1.5

/** Grid line positions in percent: every 5%, plus the rule-of-thirds lines. */
export function dragGridLinePcts(): readonly number[] {
  const lines: number[] = []
  for (let p = 0; p <= 100; p += DRAG_GRID_STEP_PCT) lines.push(p)
  lines.push(100 / 3, 200 / 3)
  return lines.sort((a, b) => a - b)
}

/** Snap radius actually used for a move: Alt held disables snapping (0). */
export function effectiveSnapThreshold(threshold: number, altHeld: boolean): number {
  return altHeld ? 0 : threshold
}
