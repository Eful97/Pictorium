/**
 * Effective quality-mark selection for the poster route.
 *
 * Built-in A/V marks are title-derived: they appear only when the title's local
 * AV spec actually has them, then filtered by the user/space selection. Pack
 * marks have no per-title data, so they appear ONLY when the selection
 * explicitly contains them — an absent selection keeps the historic render
 * byte-identical (no invented marks).
 *
 * Order: available built-ins first, then selected pack marks in selection
 * order; deduped and capped with the same limit the renderer applies.
 */
import { MAX_QUALITY_MARKS, isPackMark, isQualityMarkId } from "./quality-badge-pack"

export interface QualityMarkSelectionInput {
  /** Marker A/V formats present in the title's local spec. */
  readonly availableFormats: readonly string[]
  /** Explicit per-title/query selection (null/undefined = not specified). */
  readonly requestedFormats: readonly string[] | null | undefined
  /** Space defaults selection (empty/null = no restriction for built-ins). */
  readonly allowedFormats: readonly string[] | null | undefined
}

export function resolveEffectiveQualityMarks(input: QualityMarkSelectionInput): string[] {
  const requested = input.requestedFormats ?? null
  const allowed = input.allowedFormats && input.allowedFormats.length > 0 ? input.allowedFormats : null
  const selected = requested ?? allowed
  const selectedSet = selected ? new Set(selected) : null

  const marks = input.availableFormats.filter((format) => selectedSet === null || selectedSet.has(format))
  if (selectedSet !== null) {
    for (const id of selected ?? []) {
      if (!isQualityMarkId(id) || !isPackMark(id) || marks.includes(id)) continue
      marks.push(id)
    }
  }
  return marks.slice(0, MAX_QUALITY_MARKS)
}
