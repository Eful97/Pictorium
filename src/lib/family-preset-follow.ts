import {
  BADGE_FAMILY_IDS,
  isBadgePresetId,
  isBadgePresetRev,
  resolveLegacyTargetFamilies,
  type BadgeFamilyBindings,
  type BadgeFamilyId,
  type BadgeTarget,
} from "./badge-preset"
import type { FamilyStagedBindings } from "./badge-preset-binding"

// ---------------------------------------------------------------------------
// Per-title "Follow settings" drop (client-only staged marker).
//
// The staged per-title map has three states per family:
// - absent key  = follow the saved mapping (existing: remove the staged key);
// - present null / binding = explicit Standard / preset (existing);
// - present DROP = delete the SAVED key at save (new: follow the space
//   settings/defaults even when the mapping pins this family).
//
// The sentinel is client-only: it is never persisted (save translates it to
// a key deletion), never emitted in `bp` (encode omits it, so the server
// falls through to config > defaults), and never validated as an id (write
// schemas reject it — see sanitizeFamilyDraft callers, which must strip it
// before any store write).
// ---------------------------------------------------------------------------

/** Client-only staged drop marker: "follow the space settings for family". */
export const FAMILY_FOLLOW_SENTINEL = "__follow__" as const

export type FamilyFollowSentinel = typeof FAMILY_FOLLOW_SENTINEL

/** One staged draft value: normalized binding, explicit Standard clear, or follow-drop. */
export type FamilyStagedDraftValue =
  | { id: string; rev: string | null }
  | null
  | FamilyFollowSentinel

/** Sparse staged draft: absent = follow saved, null = Standard, drop = follow settings. */
export type FamilyStagedDraft = Partial<Record<BadgeFamilyId, FamilyStagedDraftValue>>

export function isFamilyFollowDrop(value: unknown): value is FamilyFollowSentinel {
  return value === FAMILY_FOLLOW_SENTINEL
}

function isValidDraftBinding(value: unknown): value is { id: string; rev?: string | null } {
  if (value === null || value === FAMILY_FOLLOW_SENTINEL) return true
  if (typeof value !== "object" || Array.isArray(value)) return false
  for (const sk of Object.keys(value)) {
    if (sk !== "id" && sk !== "rev") return false
  }
  const rec = value as { id?: unknown; rev?: unknown }
  if (!isBadgePresetId(rec.id)) return false
  if (rec.rev !== undefined && rec.rev !== null && !isBadgePresetRev(rec.rev)) return false
  return true
}

function cloneDraftBinding(
  value: { id: string; rev?: string | null } | null,
): { id: string; rev: string | null } | null {
  if (value === null) return null
  return { id: value.id, rev: value.rev ?? null }
}

/**
 * Sanitize a staged-side draft: own-property entries only, valid id/rev
 * preserved (rev normalized to null), explicit null preserved, follow-drop
 * preserved, everything malformed dropped (fail-closed, never resurrects
 * siblings). Never throws.
 */
export function sanitizeFamilyDraft(raw: unknown): FamilyStagedDraft {
  const out: FamilyStagedDraft = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, family)) continue
    const v = (raw as Record<string, unknown>)[family]
    if (!isValidDraftBinding(v)) continue
    if (isFamilyFollowDrop(v)) {
      out[family] = FAMILY_FOLLOW_SENTINEL
      continue
    }
    out[family] = cloneDraftBinding(v as { id: string; rev?: string | null } | null)
  }
  return out
}

/**
 * Merge staged draft over a stored side: staged bindings win, staged null
 * clears stay, staged drops DELETE the stored key (follow settings), stored
 * keys otherwise preserved verbatim. Staged garbage is dropped (never
 * written). Returns the merged sparse map (possibly empty = omit the key).
 */
export function mergeFamilyDraftForSave(
  stored: BadgeFamilyBindings | null | undefined,
  staged: FamilyStagedDraft | FamilyStagedBindings | null | undefined,
): Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> {
  const out: Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> = {}
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const family of BADGE_FAMILY_IDS) {
      if (!Object.prototype.hasOwnProperty.call(stored, family)) continue
      const v = (stored as Record<string, unknown>)[family]
      if (v === null) {
        out[family] = null
        continue
      }
      if (typeof v !== "object" || Array.isArray(v)) continue
      const rec = v as { id?: unknown; rev?: unknown }
      if (!isBadgePresetId(rec.id)) continue
      out[family] = { id: rec.id, rev: isBadgePresetRev(rec.rev) ? rec.rev : null }
    }
  }
  const clean = sanitizeFamilyDraft(staged)
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(clean, family)) continue
    const v = clean[family]
    if (isFamilyFollowDrop(v)) {
      delete out[family]
      continue
    }
    out[family] = cloneDraftBinding(v as { id: string; rev?: string | null } | null)
  }
  return out
}

/** True when a staged draft carries no own entries (nothing to stage). */
export function isEmptyFamilyDraft(
  draft: Partial<Record<BadgeFamilyId, unknown>> | null | undefined,
): boolean {
  if (!draft || typeof draft !== "object") return true
  for (const family of BADGE_FAMILY_IDS) {
    if (Object.prototype.hasOwnProperty.call(draft, family)) return false
  }
  return true
}

/**
 * Families a follow-drop actually removes: staged drops intersecting keys the
 * saved side owns (explicit entries). Drops on absent keys are no-ops (the
 * family already follows the space) — the save stays byte-identical for them.
 */
export function droppedOwnedFamilies(
  stored: BadgeFamilyBindings | null | undefined,
  staged: FamilyStagedDraft | FamilyStagedBindings | null | undefined,
): BadgeFamilyId[] {
  const clean = sanitizeFamilyDraft(staged)
  const out: BadgeFamilyId[] = []
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(clean, family)) continue
    if (!isFamilyFollowDrop(clean[family])) continue
    if (stored && typeof stored === "object" && Object.prototype.hasOwnProperty.call(stored, family)) {
      out.push(family)
    }
  }
  return out
}

export interface FollowDropResolution {
  /**
   * Effective family map after drops: saved minus dropped keys plus
   * materialized legacy siblings (below). Staged bindings/clears already
   * merged by the caller (pass the merged map as `base`).
   */
  familyMap: Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>>
  /** True when a dropped family was covered by the legacy singleton: the
   *  owning pair must be cleared and the surviving siblings materialized. */
  clearLegacy: boolean
  /** Legacy id/rev frozen for the surviving covered siblings (null = none). */
  materialized: Partial<Record<BadgeFamilyId, { id: string; rev: string | null }>>
}

/**
 * Resolve follow-drops against the legacy singleton (pure, no I/O: the
 * caller resolves the target, e.g. via the cached owner-aware store fetch).
 *
 * Legacy `top` fans out to rank + extra; every other explicit family target
 * covers itself. A drop on a covered family clears the owning singleton pair
 * and materializes the surviving covered siblings as explicit bindings (same
 * id/rev: identical pixels, both shapes, no resurrection, no sibling wipe).
 * Drops on uncovered families (or with no/invalid singleton, unknown target)
 * only delete the map key — the singleton keeps rendering where it always
 * did (never guessed away).
 */
export function applyFollowDrops(args: {
  base: Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>>
  drops: readonly BadgeFamilyId[]
  legacyId?: string | null
  legacyRev?: string | null
  legacyTarget?: BadgeTarget | string | null | undefined
}): FollowDropResolution {
  const familyMap: FollowDropResolution["familyMap"] = { ...(args.base ?? {}) }
  for (const family of args.drops) delete familyMap[family]
  const materialized: FollowDropResolution["materialized"] = {}
  let clearLegacy = false
  const legacyId = args.legacyId && isBadgePresetId(args.legacyId) ? args.legacyId : null
  if (legacyId && args.drops.length > 0) {
    const covered = resolveLegacyTargetFamilies(args.legacyTarget)
    const hit = args.drops.filter((f) => covered.includes(f))
    if (hit.length > 0) {
      clearLegacy = true
      const legacyRev = args.legacyRev && isBadgePresetRev(args.legacyRev) ? args.legacyRev : null
      for (const sibling of covered) {
        if (hit.includes(sibling)) continue
        if (Object.prototype.hasOwnProperty.call(familyMap, sibling)) continue
        familyMap[sibling] = { id: legacyId, rev: legacyRev }
        materialized[sibling] = { id: legacyId, rev: legacyRev }
      }
    }
  }
  return { familyMap, clearLegacy, materialized }
}
