import { currentPathUuid } from "./user-token"
import { READY_PRESET_ENTRIES, type ReadyPresetEntry } from "./ready-visual-presets"
import { landscapeProfilePatch } from "./visual-presets"

/**
 * Persisted reset reference for the preset that was applied in the settings
 * session (one per shape).
 *
 * Why a full snapshot, not just an id: the reset controls must return to the
 * look that was applied at that moment. A global Save (tuned defaults), a
 * template update, or a later edit of the personal preset must not silently
 * redefine that reference. The snapshot is immutable until the user explicitly
 * updates the preset (or applies another one).
 *
 * The reference is device-local (same namespace scheme as the defaults
 * localStorage) and per shape: applying a portrait preset never changes the
 * landscape reset reference. It is never a preset/defaults write by itself.
 */
export type ActivePresetShape = "portrait" | "landscape"
export type ActivePresetKind = "ready" | "personal"

export interface ActivePresetMeta {
  id: string
  name: string
  kind: ActivePresetKind
}

export interface ActivePresetBaseline extends ActivePresetMeta {
  shape: ActivePresetShape
  /** Settings session value (default* flats + raw landscape profile). */
  snapshot: Record<string, unknown>
  /** Provenance of `snapshot` (see `ACTIVE_PRESET_BASELINE_REV`). */
  rev?: number
}

/**
 * Snapshot provenance revision.
 *
 * - absent (legacy): written by a ready apply that did not own the per-item
 *   corrections (`defaultBadgeItemTransforms` / profile `badgeItemTransforms`
 *   were added after the recipes), so the reference may contain the user's
 *   live nudges as if they belonged to the built-in look.
 * - `2`: every apply field the recipe owns is written by the apply itself, so
 *   a ready reference is trustworthy verbatim.
 *
 * Only used to recover the OWNED value of BUILT-IN references from their
 * trusted recipe (see `recoverReadyBaseline`); a stamped reference is never
 * rewritten again (the snapshot is immutable by contract).
 */
export const ACTIVE_PRESET_BASELINE_REV = 2

const KEY_PREFIX = "activePresetBaseline"

function storageKey(shape: ActivePresetShape): string {
  const uuid = currentPathUuid()
  return `${KEY_PREFIX}:${uuid ?? "global"}:${shape}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseBaseline(raw: unknown, shape: ActivePresetShape): ActivePresetBaseline | null {
  if (!isRecord(raw)) return null
  const { id, name, kind, snapshot, rev } = raw
  if (typeof id !== "string" || !id.trim()) return null
  if (typeof name !== "string" || !name.trim()) return null
  if (kind !== "ready" && kind !== "personal") return null
  if (!isRecord(snapshot)) return null
  return {
    id,
    name,
    kind,
    shape,
    snapshot,
    ...(typeof rev === "number" && Number.isFinite(rev) ? { rev } : null),
  }
}

/**
 * The per-item corrections the TRUSTED RECIPE of a built-in look owns for the
 * edited shape (`null` = automatic layout), or `undefined` when the recipe
 * does not own the field (nothing to recover from). Same resolution the apply
 * path writes: portrait reads the mapped flat, landscape the profile patch.
 */
function readyOwnedItemTransforms(
  entry: ReadyPresetEntry,
  shape: ActivePresetShape,
): string | null | undefined {
  const desired = entry.desired(shape === "portrait")
  return shape === "portrait"
    ? desired.defaultBadgeItemTransforms
    : landscapeProfilePatch(desired).badgeItemTransforms
}

/**
 * Recover a BUILT-IN reset reference written before the apply owned the
 * per-item corrections (see `ACTIVE_PRESET_BASELINE_REV`).
 *
 * Scope is deliberately tiny and provable:
 * - only `kind === "ready"` refs whose `id` is one of the stable built-in ids
 *   (the recipe IS the trusted source of the look that was applied);
 * - only the OWNED item-transform key of the edited shape is rewritten — every
 *   other snapshot key stays byte-identical (group geometry was already owned
 *   by the recipes before the field existed; the other orientation's frozen
 *   profile is intentionally not ours to touch);
 * - a stamped (`rev >= ACTIVE_PRESET_BASELINE_REV`) reference is returned
 *   verbatim, so a later recipe change never silently redefines an existing
 *   reference (immutability contract).
 *
 * PERSONAL refs are never touched: their snapshot has no external trusted
 * source, so reconstructing it would be manufactured data.
 */
function recoverReadyBaseline(baseline: ActivePresetBaseline): ActivePresetBaseline {
  if (baseline.kind !== "ready") return baseline
  if (typeof baseline.rev === "number" && baseline.rev >= ACTIVE_PRESET_BASELINE_REV) return baseline
  const entry = READY_PRESET_ENTRIES.find((candidate) => candidate.id === baseline.id)
  if (!entry) return baseline
  const owned = readyOwnedItemTransforms(entry, baseline.shape)
  if (owned === undefined) return baseline
  const snapshot = clonePresetSnapshot(baseline.snapshot)
  if (baseline.shape === "portrait") {
    snapshot.defaultBadgeItemTransforms = owned
  } else {
    const land = isRecord(snapshot.landscape) ? { ...snapshot.landscape } : {}
    land.badgeItemTransforms = owned
    snapshot.landscape = land
  }
  const recovered: ActivePresetBaseline = {
    id: baseline.id,
    name: baseline.name,
    kind: baseline.kind,
    shape: baseline.shape,
    snapshot,
    rev: ACTIVE_PRESET_BASELINE_REV,
  }
  // One-time migration: persisted best-effort (same contract as every other
  // reference write), so the recovery is not repeated on every load.
  writeActivePresetBaseline(recovered)
  return recovered
}

export function readActivePresetBaseline(shape: ActivePresetShape): ActivePresetBaseline | null {
  if (typeof window === "undefined" || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(storageKey(shape))
    const parsed = raw ? parseBaseline(JSON.parse(raw), shape) : null
    return parsed ? recoverReadyBaseline(parsed) : null
  } catch {
    return null
  }
}

export function readActivePresetBaselines(): Partial<Record<ActivePresetShape, ActivePresetBaseline>> {
  const portrait = readActivePresetBaseline("portrait")
  const landscape = readActivePresetBaseline("landscape")
  return {
    ...(portrait ? { portrait } : null),
    ...(landscape ? { landscape } : null),
  }
}

/** Deep plain copy so the in-memory reference can never alias live state. */
export function clonePresetSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>
  } catch {
    return { ...snapshot }
  }
}

export function writeActivePresetBaseline(baseline: ActivePresetBaseline): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    const value: ActivePresetBaseline = {
      id: baseline.id,
      name: baseline.name,
      kind: baseline.kind,
      shape: baseline.shape,
      snapshot: clonePresetSnapshot(baseline.snapshot),
      rev: ACTIVE_PRESET_BASELINE_REV,
    }
    window.localStorage.setItem(storageKey(baseline.shape), JSON.stringify(value))
  } catch {
    // Local reference is best-effort: a full/private localStorage must not
    // break the settings draft (the in-memory baseline still works).
  }
}

export function clearActivePresetBaseline(shape: ActivePresetShape): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    window.localStorage.removeItem(storageKey(shape))
  } catch {
    // Ignore unavailable storage.
  }
}

/** Own-property read of a flat `default*` key from the applied snapshot. */
export function baselineFlat(
  baseline: ActivePresetBaseline | null | undefined,
  key: string,
): { present: boolean; value?: unknown } {
  if (!baseline) return { present: false }
  if (!Object.prototype.hasOwnProperty.call(baseline.snapshot, key)) return { present: false }
  return { present: true, value: baseline.snapshot[key] }
}

/** Own-property read of a landscape profile key from the applied snapshot. */
export function baselineLandscape(
  baseline: ActivePresetBaseline | null | undefined,
  key: string,
): { present: boolean; value?: unknown } {
  if (!baseline) return { present: false }
  const land = baseline.snapshot.landscape
  if (!isRecord(land)) return { present: false }
  if (!Object.prototype.hasOwnProperty.call(land, key)) return { present: false }
  return { present: true, value: land[key] }
}
