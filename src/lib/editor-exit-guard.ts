/**
 * Per-title editor exit guard (client-safe leaf).
 *
 * Leaving the editor clears the open title, which rehydrates the live editor
 * from the SAVED mapping: every unstaged edit is lost. The shell/editor exit
 * affordances therefore route through this single decision so "clean exits are
 * untouched" and "a dirty draft is never discarded silently" share one rule.
 *
 * Pure functions only: the dialog/UI lives in EditView, this leaf owns the
 * decision so it can be unit-tested without the editor tree.
 */

export type EditorExitOutcome = "ran" | "guarded" | "ignored"

export interface EditorExitRequest {
  /** `isMappingDirty` (complete: artwork + gradient + badge/visual state). */
  dirty: boolean
  /** A save is in flight: the exit waits for it, exactly like the settings guard. */
  saving: boolean
  /** The exit action (clear selection / go home). */
  run: () => void
  /** Dirty draft: ask before discarding instead of running the action. */
  onGuard: () => void
}

/**
 * Resolve one exit attempt:
 * - clean draft  -> run immediately (no dialog, byte-identical UX);
 * - dirty draft  -> `onGuard` (the caller opens the confirm dialog);
 * - saving       -> nothing (the in-flight save owns the session).
 */
export function resolveEditorExit({ dirty, saving, run, onGuard }: EditorExitRequest): EditorExitOutcome {
  if (saving) return "ignored"
  if (dirty) {
    onGuard()
    return "guarded"
  }
  run()
  return "ran"
}
