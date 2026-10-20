import {
  BADGE_FAMILY_IDS,
  isBadgePresetId,
  isBadgePresetRev,
  type BadgeFamilyBindings,
  type BadgeFamilyId,
} from "./badge-preset"
import type { FamilyStagedBindings } from "./badge-preset-binding"
import { isFamilyFollowDrop, sanitizeFamilyDraft, type FamilyStagedDraft } from "./family-preset-follow"

// ---------------------------------------------------------------------------
// Per-family Badge Lab save helpers (pure, client/server-safe, zero I/O).
//
// The editor stages a sparse map (absent = follow saved, present null =
// explicit Standard clear, present binding = preset). A full-replace save
// merges staged over the stored side for the edited shape; the landscape
// profile additionally freezes the OLD effective look for families the
// edited flat moved, so a portrait edit can never move the landscape look
// through inheritance (and vice versa for stash-carried edits). Owned
// landscape keys are never rebased; explicit clears never resurrect the
// legacy singleton (a staged/saved null shadows it at every boundary, see
// resolveFamilyPresetBindings).
// ---------------------------------------------------------------------------

export interface FamilyBindingValue {
  id: string
  rev?: string | null
}

function isValidStagedValue(value: unknown): value is FamilyBindingValue | null {
  if (value === null) return true
  if (typeof value !== "object" || Array.isArray(value)) return false
  // Strict sub-keys (same fail-closed contract as badgeFamilyBindingsSchema):
  // unknown keys reject the whole entry, never strip silently.
  for (const sk of Object.keys(value)) {
    if (sk !== "id" && sk !== "rev") return false
  }
  const rec = value as { id?: unknown; rev?: unknown }
  if (!isBadgePresetId(rec.id)) return false
  if (rec.rev !== undefined && rec.rev !== null && !isBadgePresetRev(rec.rev)) return false
  return true
}

function cloneBinding(value: { id: string; rev?: string | null } | null): { id: string; rev: string | null } | null {
  if (value === null) return null
  return { id: value.id, rev: value.rev ?? null }
}

function sameBinding(
  a: { id: string; rev?: string | null } | null | undefined,
  b: { id: string; rev?: string | null } | null | undefined,
): boolean {
  const an = a === undefined ? undefined : (a === null ? null : { id: a.id, rev: a.rev ?? null })
  const bn = b === undefined ? undefined : (b === null ? null : { id: b.id, rev: b.rev ?? null })
  if (an === undefined || bn === undefined) return an === bn
  if (an === null || bn === null) return an === bn
  return an.id === bn.id && an.rev === bn.rev
}

/**
 * Sanitize a staged/saved-side map: own-property entries only, valid id/rev
 * preserved (rev normalized to null when absent), null preserved (explicit
 * clear), everything malformed dropped (fail-closed, never written, never
 * resurrects siblings). Never throws.
 */
export function sanitizeFamilyMap(
  raw: unknown,
): Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> {
  const out: Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, family)) continue
    const v = (raw as Record<string, unknown>)[family]
    if (!isValidStagedValue(v)) continue
    out[family] = cloneBinding(v as { id: string; rev?: string | null } | null)
  }
  return out
}

/**
 * Merge staged overrides over a stored side (flat or landscape profile):
 * staged keys win (null = explicit clear preserved, follow-drop = stored key
 * deleted so the family follows the space settings), stored keys otherwise
 * preserved verbatim. Staged garbage is dropped (never written). Returns the
 * merged sparse map (may be empty = omit the key, legacy byte-identical).
 */
export function mergeFamilyMapForSave(
  stored: BadgeFamilyBindings | null | undefined,
  staged: FamilyStagedBindings | FamilyStagedDraft | null | undefined,
): Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> {
  const out = sanitizeFamilyMap(stored)
  const clean = sanitizeFamilyDraft(staged)
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(clean, family)) continue
    const v = clean[family] as unknown
    // Follow-drop (client-only marker): delete the stored key instead of
    // writing a value — the family falls through to config > defaults.
    if (isFamilyFollowDrop(v)) {
      delete out[family]
      continue
    }
    out[family] = cloneBinding(v as { id: string; rev?: string | null } | null) as { id: string; rev: string | null } | null
  }
  return out
}

/**
 * Landscape inheritance guard for a full-replace save that moves the flat:
 * for every family where the new flat differs from the previous flat and the
 * landscape side does not own the key, freeze the OLD effective landscape
 * look (profile own value, else previous flat value) into the merged profile.
 * A previously-absent effective look freezes as an explicit null (native
 * Standard) so the landscape shape does not inherit a newly edited portrait
 * binding accidentally — unless an effective legacy singleton covered that
 * family (see `prevLegacy`), which is frozen instead so the opposite shape
 * keeps its old look. Families the save did not move are untouched (other
 * shape VERBATIM); owned landscape keys are never rebased; explicit clears
 * stay clears (never resurrect the legacy singleton or the flat).
 *
 * @param prevFlat    stored flat before this save (null/undefined = new map).
 * @param newFlat     flat produced by this save (merged staged over stored).
 * @param mergedProfile landscape profile after merging staged/saved (ownership
 *                    source of truth: present key = owned, never rebased).
 * @param prevLegacy  effective legacy singleton covering the landscape shape
 *                    BEFORE this save (profile-owned pair when the profile
 *                    owns it, else the flat pair). Invalid/absent = no legacy
 *                    look (absent flats freeze as native null, as before).
 * @param prevLegacyFamilies families the legacy singleton effectively covers
 *                    (resolved target fan-out). Null/omitted = target unknown:
 *                    preserve the singleton conservatively (mismatches render
 *                    native standard via the compatibility filter).
 * @returns additions to apply onto the merged profile (empty = nothing moved).
 */
export function backfillLandscapeFamilyGuard(args: {
  prevFlat: BadgeFamilyBindings | null | undefined
  newFlat: Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> | null | undefined
  mergedProfile: Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> | null | undefined
  prevLegacy?: { id: string; rev: string | null } | null
  prevLegacyFamilies?: readonly BadgeFamilyId[] | null
}): Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> {
  const { prevFlat, newFlat, mergedProfile, prevLegacy, prevLegacyFamilies } = args
  const adds: Partial<Record<BadgeFamilyId, { id: string; rev: string | null } | null>> = {}
  const prev = sanitizeFamilyMap(prevFlat)
  const next = sanitizeFamilyMap(newFlat)
  const owned = sanitizeFamilyMap(mergedProfile)
  // Fail-closed legacy: only a valid preset id can freeze a look; an invalid
  // rev normalizes to unpinned (null), never throws, never writes garbage.
  const legacy: { id: string; rev: string | null } | null =
    prevLegacy && isBadgePresetId(prevLegacy.id)
      ? { id: prevLegacy.id, rev: isBadgePresetRev(prevLegacy.rev) ? prevLegacy.rev : null }
      : null
  const families = new Set<BadgeFamilyId>([
    ...(Object.keys(prev) as BadgeFamilyId[]),
    ...(Object.keys(next) as BadgeFamilyId[]),
  ])
  for (const family of families) {
    if (Object.prototype.hasOwnProperty.call(owned, family)) continue
    const before = (Object.prototype.hasOwnProperty.call(prev, family) ? prev[family] : undefined) as
      | { id: string; rev: string | null }
      | null
      | undefined
    const after = (Object.prototype.hasOwnProperty.call(next, family) ? next[family] : undefined) as
      | { id: string; rev: string | null }
      | null
      | undefined
    if (sameBinding(before, after)) continue
    if (before !== undefined) {
      // The save moved this family and the landscape side does not own it:
      // freeze the old effective look.
      adds[family] = cloneBinding(before) as { id: string; rev: string | null } | null
      continue
    }
    // Previously absent: the old effective landscape look was the legacy
    // singleton when it covers this family (known target), else native null.
    // With an unknown target the singleton is preserved conservatively (the
    // render-time compatibility filter degrades mismatches to native standard,
    // so no family can render a mismatched design).
    const covers = legacy !== null && (prevLegacyFamilies == null || prevLegacyFamilies.includes(family))
    adds[family] = covers && legacy !== null ? { id: legacy.id, rev: legacy.rev } : null
  }
  return adds
}

/** True when a sparse family map carries no own entries (omit the key). */
export function isEmptyFamilyMap(
  map: Partial<Record<BadgeFamilyId, unknown>> | null | undefined,
): boolean {
  if (!map || typeof map !== "object") return true;
  for (const family of BADGE_FAMILY_IDS) {
    if (Object.prototype.hasOwnProperty.call(map, family)) return false;
  }
  return true;
}

/**
 * Sanitize a persisted follow-flags side: own-property entries only, literal
 * `true` preserved, everything else dropped (fail-closed, never written).
 * Never throws. Old mappings without the field sanitize to empty.
 */
export function sanitizeFamilyFollows(
  raw: unknown,
): Partial<Record<BadgeFamilyId, true>> {
  const out: Partial<Record<BadgeFamilyId, true>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, family)) continue;
    if ((raw as Record<string, unknown>)[family] === true) out[family] = true;
  }
  return out;
}

/**
 * Merge follow flags over a stored side: `true` sets persist (explicit
 * follow), `false`/null-clear removes the flag (explicit pin shadows
 * follow). Stored flags otherwise preserved verbatim. Staged garbage
 * dropped (never written). Returns the merged sparse map (empty = omit).
 */
export function mergeFamilyFollowsForSave(
  stored: Partial<Record<BadgeFamilyId, true>> | null | undefined,
  staged: Partial<Record<BadgeFamilyId, boolean | null>> | null | undefined,
): Partial<Record<BadgeFamilyId, true>> {
  const out = sanitizeFamilyFollows(stored);
  if (!staged || typeof staged !== "object" || Array.isArray(staged)) return out;
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(staged, family)) continue;
    const v = (staged as Record<string, unknown>)[family];
    if (v === true) out[family] = true;
    else if (v === false || v === null) delete out[family];
  }
  return out;
}
