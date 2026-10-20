import {
  BADGE_FAMILY_IDS,
  BADGE_PRESET_ID_RE,
  BADGE_PRESET_REV_RE,
  BADGE_TARGETS,
  isBadgeFamilyId,
  type BadgeFamilyId,
  type BadgePreset,
  type BadgeTarget,
} from "./badge-preset"
import type { FamilyStagedBindings } from "./badge-preset-binding"

// ---------------------------------------------------------------------------
// Per-family Badge Lab transport (isomorphic, zero I/O, client-safe).
//
// Single canonical `bp` query encoding for the sparse per-title/per-shape
// family map + server-written `bpt` target fragment for the cache key. No
// arbitrary JSON/free text: only known family ids, deterministic preset ids
// and 8-hex revisions travel; everything else is dropped. Bounded: at most
// one entry per family (9 max), total query length capped by the schema
// (`posterQuerySchema`: bp <= 512, bpt <= 384).
//
// Wire format (both params comma-separated, canonical family order):
//   bp  = fam:id[.rev] | fam:-            (client staged + server canonical)
//   bpt = fam:target                       (server-written ONLY, never client)
// Clear token `-` is exactly one dash: no valid preset id is that short, so
// it can never collide with a real binding. A known family with a malformed
// id shadows as an explicit clear (fail-closed, never resurrects the saved
// map or the legacy singleton); unknown families are dropped silently.
// ---------------------------------------------------------------------------

/** Client/staged `bp` query key. */
export const FAMILY_BP_PARAM = "bp"
/** Server-written authorized-target `bpt` cache fragment (never client). */
export const FAMILY_BP_TARGETS_PARAM = "bpt"
/** Explicit follow-intent `bpf` query key (client staged + persisted reopen). */
export const FAMILY_BP_FOLLOW_PARAM = "bpf"

/** Query bound for `bp` (9 entries x (15 fam + 1 + 24 id + 1 + 8 rev) + commas). */
export const MAX_FAMILY_BP_LENGTH = 512
/** Query bound for `bpt` (9 entries x (15 fam + 1 + 15 target) + commas). */
export const MAX_FAMILY_BPT_LENGTH = 384
/** Query bound for `bpf` (9 known families comma-separated, canonical order). */
export const MAX_FAMILY_BPF_LENGTH = 256

const CLEAR_TOKEN = "-"

/**
 * A family binding target is render-compatible when it addresses the family
 * directly, plus the historic `top` alias which fans out to the two badges
 * sharing the top slot (`rank` + `extra`). Every other combination (e.g. a
 * `quality` preset on `genre`, a `rank` preset on `extra`) is rejected: the
 * slot renders native standard instead of a mismatched design.
 */
export function isPresetTargetCompatibleWithFamily(
  target: BadgeTarget | string | null | undefined,
  family: BadgeFamilyId | string | null | undefined,
): boolean {
  if (!isBadgeFamilyId(family)) return false
  if (target === family) return true
  if (target === "top" && (family === "rank" || family === "extra")) return true
  return false
}

/** Fail-closed compatibility filter: incompatible presets become null (standard). */
export function filterCompatibleFamilyPreset(
  preset: BadgePreset | null | undefined,
  family: BadgeFamilyId,
): BadgePreset | null {
  if (!preset) return null
  return isPresetTargetCompatibleWithFamily(preset.target, family) ? preset : null
}

function isValidFamilyId(id: unknown): id is string {
  return typeof id === "string" && BADGE_PRESET_ID_RE.test(id)
}

function isValidFamilyRev(rev: unknown): rev is string {
  return typeof rev === "string" && BADGE_PRESET_REV_RE.test(rev)
}

/**
 * Canonical `bp` encoder for a sparse staged/saved family map. Deterministic
 * family order (BADGE_FAMILY_IDS), one entry per family, unknown families
 * and malformed ids skipped (never emitted as junk). Null = explicit clear
 * (`fam:-`); `{id}` without rev = unpinned (`fam:id`); `{id,rev}` =
 * `fam:id.rev`. Follow-drop markers (client-only `__follow__`) are omitted:
 * the family falls through to config > defaults server-side. Returns null
 * when the map carries no own entries (caller omits the param: legacy URLs
 * stay byte-identical).
 */
export function encodeFamilyBpParam(
  bindings: Partial<Record<BadgeFamilyId, { id: string; rev?: string | null } | null | string>> | null | undefined,
): string | null {
  if (!bindings || typeof bindings !== "object") return null
  const parts: string[] = []
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(bindings, family)) continue
    const v = (bindings as Record<string, unknown>)[family]
    if (v === null) {
      parts.push(`${family}:${CLEAR_TOKEN}`)
      continue
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue
    const rec = v as { id?: unknown; rev?: unknown }
    if (!isValidFamilyId(rec.id)) continue
    parts.push(
      isValidFamilyRev(rec.rev) ? `${family}:${rec.id}.${rec.rev}` : `${family}:${rec.id}`,
    )
  }
  return parts.length > 0 ? parts.join(",") : null
}

/**
 * `bp` parser (query staged presence). Returns undefined when the param is
 * absent (no override); otherwise a sparse own-property map where a present
 * null shadows the saved map/legacy singleton for that family. Known family
 * + malformed id = explicit null (fail-closed, never resurrects). Unknown
 * families, entries without `:`, and extras past the 9-family cap are
 * dropped. Never throws.
 */
export function parseFamilyBpParam(raw: string | null | undefined): FamilyStagedBindings | undefined {
  if (raw === null || raw === undefined) return undefined
  const out: FamilyStagedBindings = {}
  const text = raw.trim()
  if (text === "") return out
  const tokens = text.split(",")
  let kept = 0
  for (const token of tokens) {
    if (kept >= BADGE_FAMILY_IDS.length) break
    const colon = token.indexOf(":")
    if (colon <= 0) continue
    const family = token.slice(0, colon)
    if (!isBadgeFamilyId(family)) continue
    if (Object.prototype.hasOwnProperty.call(out, family)) continue
    const rest = token.slice(colon + 1)
    if (rest === CLEAR_TOKEN) {
      out[family] = null
      kept++
      continue
    }
    const dot = rest.indexOf(".")
    if (dot < 0) {
      // No rev segment: valid id pins rev null, malformed id shadows null.
      out[family] = isValidFamilyId(rest) ? { id: rest } : null
      kept++
      continue
    }
    const id = rest.slice(0, dot)
    const rev = rest.slice(dot + 1)
    if (rev.includes(".")) {
      out[family] = null
      kept++
      continue
    }
    if (!isValidFamilyId(id)) {
      out[family] = null
      kept++
      continue
    }
    out[family] = isValidFamilyRev(rev) ? { id, rev } : { id }
    kept++
  }
  return out
}

/**
 * Canonical `bpt` encoder for the AUTHORIZED current targets (server-written
 * cache fragment). Only compatible family->target pairs travel; unknown
 * families and targets outside BADGE_TARGETS are skipped. Returns null when
 * empty (caller deletes the fragment).
 */
export function encodeFamilyTargetsParam(
  targets: Partial<Record<BadgeFamilyId, BadgeTarget | string | null>> | null | undefined,
): string | null {
  if (!targets || typeof targets !== "object") return null
  const allowed = new Set<string>(BADGE_TARGETS as readonly string[])
  const parts: string[] = []
  for (const family of BADGE_FAMILY_IDS) {
    if (!Object.prototype.hasOwnProperty.call(targets, family)) continue
    const t = (targets as Record<string, unknown>)[family]
    if (typeof t !== "string" || !allowed.has(t)) continue
    parts.push(`${family}:${t}`)
  }
  return parts.length > 0 ? parts.join(",") : null
}

/**
 * `bpt` parser (server fragment validation). Returns undefined when absent;
 * otherwise the sparse validated map (unknown families/targets dropped).
 * Never throws.
 */
export function parseFamilyTargetsParam(
  raw: string | null | undefined,
): Partial<Record<BadgeFamilyId, BadgeTarget>> | undefined {
  if (raw === null || raw === undefined) return undefined
  const out: Partial<Record<BadgeFamilyId, BadgeTarget>> = {}
  const text = raw.trim()
  if (text === "") return out
  const allowed = new Set<string>(BADGE_TARGETS as readonly string[])
  let kept = 0
  for (const token of text.split(",")) {
    if (kept >= BADGE_FAMILY_IDS.length) break
    const colon = token.indexOf(":")
    if (colon <= 0) continue
    const family = token.slice(0, colon)
    const target = token.slice(colon + 1)
    if (!isBadgeFamilyId(family)) continue
    if (!allowed.has(target)) continue
    if (Object.prototype.hasOwnProperty.call(out, family)) continue
    out[family] = target as BadgeTarget
    kept++
  }
  return out
}

/**
 * Canonical `bpf` encoder for explicit follow intent (query priority).
 * Input: sparse follow set (own `true` = follow the space settings for this
 * shape). Deterministic family order, unknown families dropped, empty = null
 * (caller omits the param: legacy URLs stay byte-identical). Never throws.
 */
export function encodeFamilyFollowParam(
  follows: Partial<Record<BadgeFamilyId, true | boolean>> | ReadonlySet<string> | readonly string[] | null | undefined,
): string | null {
  if (!follows) return null
  const parts: string[] = []
  if (follows instanceof Set || Array.isArray(follows)) {
    for (const family of BADGE_FAMILY_IDS) {
      if ((follows as Set<string>).has?.(family) || (follows as readonly string[]).includes?.(family)) {
        parts.push(family)
      }
    }
  } else if (typeof follows === "object") {
    for (const family of BADGE_FAMILY_IDS) {
      if (!Object.prototype.hasOwnProperty.call(follows, family)) continue
      if ((follows as Record<string, unknown>)[family] === true) parts.push(family)
    }
  }
  return parts.length > 0 ? parts.join(",") : null
}

/**
 * `bpf` parser (explicit follow-intent presence). Returns undefined when the
 * param is absent (no query override); otherwise the sparse validated set
 * (own `true` per known family). Unknown families, empties and extras past
 * the 9-family cap are dropped. Never throws. No secrets, no JSON.
 */
export function parseFamilyFollowParam(
  raw: string | null | undefined,
): Partial<Record<BadgeFamilyId, true>> | undefined {
  if (raw === null || raw === undefined) return undefined
  const out: Partial<Record<BadgeFamilyId, true>> = {}
  const text = raw.trim()
  if (text === "") return out
  let kept = 0
  for (const token of text.split(",")) {
    if (kept >= BADGE_FAMILY_IDS.length) break
    const family = token.trim()
    if (!family) continue
    if (!isBadgeFamilyId(family)) continue
    if (Object.prototype.hasOwnProperty.call(out, family)) continue
    ;(out as Record<string, true>)[family] = true
    kept++
  }
  return out
}
