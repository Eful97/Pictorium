import type { DefaultsState } from "./useDefaults"
import type { PosterEditorCtx } from "./contexts/PosterEditorContext"
import type { LandscapeServerDefaults } from "./server-defaults"
import { SHAPE_FLAT_TO_LANDSCAPE, snapshotMissingLandscape } from "./visual-presets"
import { isLandscapeResetKey, sanitizeLandscapeReset, type LandscapeResetKey } from "./landscape-reset"

/**
 * Settings draft foundation (Phase 1, no UI): the session value is every
 * default-backed editable field — all `default*` state plus the raw
 * landscape profile — deliberately NOT just VisualPresetValues (which omits
 * the age trio, region, date format, provider endpoint, fit flags and friends).
 * Shape/tab selection is never a session key: bare per-title state
 * (`posterShape`, live editing values) stays outside the session.
 */
export type SettingsSessionValue = {
  landscape: LandscapeServerDefaults
  /** Transport-only clear list for the profile keys reset in this draft. */
  landscapeReset?: LandscapeResetKey[]
} & {
  [K in keyof DefaultsState as K extends `default${string}` ? K : never]: DefaultsState[K]
}

/** True for session-owned context values (excludes setters, sync status, actions). */
export function isSessionKey(key: string, value: unknown): boolean {
  if (typeof value === "function") return false
  if (key === "defaultSyncStatus") return false
  return key === "landscape" || key.startsWith("default")
}

/** Capture the full default-backed session value from the live outer context. */
export function extractSettingsSessionValue(outer: PosterEditorCtx): SettingsSessionValue {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(outer as unknown as Record<string, unknown>)) {
    if (isSessionKey(key, value)) out[key] = value
  }
  return out as unknown as SettingsSessionValue
}

/** Canonical session serialization (dirty/conflict identity). Arrays by value. */
export function serializeSession(value: SettingsSessionValue): string {
  return JSON.stringify(value)
}

/**
 * Logo-alignment Auto normalization (staged session only): the settings UI no
 * longer exposes Position > Logo alignment — Auto always (portrait center,
 * landscape left by server contract). A stored explicit `"center"` (flat or
 * landscape profile override) must not leak into the new settings preview,
 * so the STAGED session normalizes it to `null` (flat auto + profile
 * follow-the-flat, which renders the same Auto pixels).
 *
 * Only `"center"` is rewritten: an explicit `"left"` already renders Auto on
 * both shapes (portraits stay centered by contract regardless, landscapes
 * resolve `"left"` as their auto), so preserving it keeps Auto-equivalent
 * sessions clean instead of flagging a phantom migration. Absent/`null`
 * stay as-is.
 *
 * Explicit `null` (never `undefined`): JSON keeps `null`, so the single Save
 * PUT carries the clear and the server merge stores it — an omitted key
 * would let the stored explicit value survive the merge. The authoritative
 * outer baseline is NEVER normalized here (callers normalize the session
 * copy only), so the migration shows as dirty until the global Save.
 * Server/query/env/schema/renderer contracts are untouched: explicit
 * `?align=center` keeps rendering explicitly.
 * Pure; never touches localStorage, network, or live outer state.
 */
export function normalizeSessionAlignment(value: SettingsSessionValue): SettingsSessionValue {
  const rec = value as unknown as Record<string, unknown>
  const landRaw = rec.landscape
  const land: Record<string, unknown> =
    landRaw !== null && typeof landRaw === "object" && !Array.isArray(landRaw)
      ? (landRaw as Record<string, unknown>)
      : {}
  if (rec.defaultLogoAlign !== "center" && land.logoAlign !== "center") return value
  return {
    ...(value as unknown as Record<string, unknown>),
    ...(rec.defaultLogoAlign === "center" ? { defaultLogoAlign: null } : null),
    ...(land.logoAlign === "center" ? { landscape: { ...land, logoAlign: null } } : null),
  } as unknown as SettingsSessionValue
}

export function settingsSessionEquals(
  a: SettingsSessionValue,
  b: SettingsSessionValue,
): boolean {
  return serializeSession(a) === serializeSession(b)
}

/**
 * Ranked-only scope normalization (staged session only): the settings UI no
 * longer offers the Fresh/Card "all titles" apply scope — Fresh and the Card
 * skins render only for titles with a valid displayed rank (anything else
 * falls back to a byte-identical Standard render by renderer contract). A
 * stored explicit `"all"` (flat or landscape profile override) must not leak
 * into the new settings preview, so the STAGED session normalizes it to
 * `"ranked"` (flat ranked + profile ranked, which renders the same
 * ranked-only pixels).
 *
 * Only `"all"` is rewritten: absent/invalid stays as-is (the render chains
 * already fail closed to "ranked"), and an explicit `"ranked"` is already
 * the target state. Explicit `"ranked"` (never `undefined` removal): the
 * single Save PUT carries the clear and the server merge stores it — an
 * omitted key would let the stored explicit value survive the merge. The
 * authoritative outer baseline is NEVER normalized here (callers normalize
 * the session copy only), so the migration shows as dirty until the global
 * Save. Server/query/env/schema/renderer contracts are untouched: explicit
 * `?freshScope=all` (per-title mapping, config token, old callers) keeps
 * rendering explicitly.
 * Pure; never touches localStorage, network, or live outer state.
 */
export function normalizeSessionFreshScope(value: SettingsSessionValue): SettingsSessionValue {
  const rec = value as unknown as Record<string, unknown>
  const landRaw = rec.landscape
  const land: Record<string, unknown> =
    landRaw !== null && typeof landRaw === "object" && !Array.isArray(landRaw)
      ? (landRaw as Record<string, unknown>)
      : {}
  if (rec.defaultPosterFreshScope !== "all" && land.posterFreshScope !== "all") return value
  return {
    ...(value as unknown as Record<string, unknown>),
    ...(rec.defaultPosterFreshScope === "all" ? { defaultPosterFreshScope: "ranked" } : null),
    ...(land.posterFreshScope === "all" ? { landscape: { ...land, posterFreshScope: "ranked" } } : null),
  } as unknown as SettingsSessionValue
}

/**
 * Composed staged-session normalization: Auto alignment
 * (`normalizeSessionAlignment`) + ranked-only Fresh/Card scope
 * (`normalizeSessionFreshScope`). Every staged entry point (open, patch,
 * preset apply, rebase, discard, save pre-flight) funnels through here, so
 * no staged path can reintroduce an explicit alignment or an "all" scope —
 * the single Save always persists the normalized pair. Pure.
 */
export function normalizeSettingsSession(value: SettingsSessionValue): SettingsSessionValue {
  return normalizeSessionFreshScope(normalizeSessionAlignment(value))
}

/**
 * Migration-only check (Auto alignment + ranked-only scope): true when the
 * staged session is exactly the staged normalization of the raw outer
 * baseline — i.e. no user edit exists yet, only the `"center"` → `null`
 * alignment migration and/or the `"all"` → `"ranked"` scope migration. Lets
 * hydration rebase and the save pre-flight adopt fresh outer truth instead
 * of flagging a phantom conflict that would block the single global Save
 * (and risk persisting stale values over hydrated ones). Real edits
 * normalize to a different value, so conflict protection for them is
 * untouched. Pure.
 */
export function isMigrationOnlySession(session: SettingsSessionValue, baselineRaw: string): boolean {
  let base: SettingsSessionValue
  try {
    base = JSON.parse(baselineRaw) as SettingsSessionValue
  } catch {
    return false
  }
  if (base === null || typeof base !== "object" || Array.isArray(base)) return false
  return serializeSession(normalizeSettingsSession(base)) === serializeSession(session)
}

/** Structural equality for flat-edit change detection (arrays by value). */
function sessionValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * Functional LOCAL session update: merges the resolved patch and freezes the
 * PRE-EDIT effective flat values into the landscape profile for inherited
 * keys (same shape-isolation rule as useDefaults.update, via the shared
 * snapshotMissingLandscape — no formula copied). Pure; never touches
 * localStorage, network, or live outer state.
 */
export function applySessionPatch(
  prev: SettingsSessionValue,
  patch: Partial<SettingsSessionValue>,
): SettingsSessionValue {
  const prevRec = prev as unknown as Record<string, unknown>
  let patchRec = patch as unknown as Record<string, unknown>
  const patchLandRaw = patchRec.landscape
  const patchLandIsObject =
    patchLandRaw !== null && typeof patchLandRaw === "object" && !Array.isArray(patchLandRaw)
  // A profile clear is expressed by an own `undefined` in the landscape patch
  // (the existing reset controls). JSON cannot carry it as a deletion, so it
  // becomes an explicit allowlisted `landscapeReset` entry while the key is
  // removed from the merged draft. Writing a key again removes it from the
  // pending clear list. Never overloads `null` (a real value on nullable
  // keys).
  let patchLand: Record<string, unknown> | null = null
  let clearedLandKeys: LandscapeResetKey[] = []
  if (patchLandIsObject) {
    const cleanLand: Record<string, unknown> = { ...(patchLandRaw as Record<string, unknown>) }
    const cleared: LandscapeResetKey[] = []
    for (const key of Object.keys(cleanLand)) {
      if (cleanLand[key] === undefined) {
        delete cleanLand[key]
        if (isLandscapeResetKey(key)) cleared.push(key)
      }
    }
    clearedLandKeys = cleared
    const reset = new Set<string>(sanitizeLandscapeReset(prevRec.landscapeReset as unknown[] | undefined))
    for (const key of cleared) reset.add(key)
    for (const key of Object.keys(cleanLand)) reset.delete(key)
    const landscapeReset = sanitizeLandscapeReset([...reset])
    patchLand = cleanLand
    patchRec = {
      ...patchRec,
      landscape: cleanLand,
      ...(landscapeReset.length > 0 ? { landscapeReset } : null),
    }
  }
  const keys = Object.keys(patchRec)
  if (keys.length === 0) return prev
  const changedFlatKeys = Object.keys(SHAPE_FLAT_TO_LANDSCAPE).filter(
    (flatKey) => flatKey in patchRec && !sessionValuesEqual(patchRec[flatKey], prevRec[flatKey]),
  )
  if (changedFlatKeys.length === 0) return { ...prev, ...patchRec }
  const prevLand = (
    prevRec.landscape !== null && typeof prevRec.landscape === "object" && !Array.isArray(prevRec.landscape)
      ? (prevRec.landscape as Record<string, unknown>)
      : {}
  )
  const adds = snapshotMissingLandscape(
    prevRec,
    patchLand ? { ...prevLand, ...patchLand } : prevLand,
    changedFlatKeys,
  )
  if (Object.keys(adds).length === 0 && !patchLand) return { ...prev, ...patchRec }
  const nextLand = { ...prevLand, ...adds, ...(patchLand ?? {}) }
  for (const key of clearedLandKeys) delete nextLand[key]
  return {
    ...prev,
    ...patchRec,
    landscape: nextLand,
  }
}

/**
 * Build the staged full state for the authoritative save: the session
 * carries every default-backed field the serializer/installer reads, so no
 * bare live value is ever staged over. The installer preserves open
 * per-title bare state by construction.
 */
export function buildStagedState(session: SettingsSessionValue): DefaultsState {
  return { ...(session as unknown as DefaultsState) }
}
