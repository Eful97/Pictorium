/**
 * Per-ITEM transforms of the badge groups (individual rating pills and
 * individual quality/AV marks), in addition to the existing per-GROUP
 * transforms.
 *
 * Why it exists: the group transforms (`qualityBadgeOffsetX/Y`,
 * `separateBadgeOffsetX/Y`, their scales) move/resize a whole composed group.
 * A user may want to nudge ONLY the IMDb pill, or move ONLY the Dolby Vision
 * mark. This module is the single, shared schema for those corrections.
 *
 * Identity, never position. Every correction is stored under a STABLE
 * identity string taken from the data that produced the badge:
 *   - `rating:<source>`         one separate-rating provider (the same source
 *                               id used to resolve the value/logo, e.g.
 *                               `rating:imdb`, `rating:tomatoes`)
 *   - `quality:tier`            the quality tier badge slot (4K/FHD/HD/SD)
 *   - `quality:age`             the age/certification pill
 *   - `quality:format:<fmt>`    one A/V mark (`dv`, `hdr`, `hdr10plus`,
 *                               `atmos`, `imax`)
 *   - `quality:combo:dv-atmos`  the merged Dolby Vision + Atmos mark
 * An array index is NEVER part of an identity: a rating that disappears (no
 * data) or a reordered list can never inherit another provider's tuning. The
 * same holds for quality marks: `hdr` suppressed by `hdr10plus` (or `dv`/
 * `atmos` merged into the combo) simply stops being painted, so a stored
 * correction for it is inert — never transferred to the mark that replaced it.
 *
 * Composition order (single renderer, documented for client and server):
 *   1. the automatic layout places the item inside its group (unchanged
 *      default: the whole group keeps its automatic anchor, its group offset
 *      and its group scale);
 *   2. the item's own `scale` is applied about the item's own centre;
 *   3. the item's `offsetX/offsetY` are added on top (canvas px).
 * So a group move still moves every item, while an item correction is a
 * relative delta on top of it. A neutral entry (100/0/0) is never stored and
 * is indistinguishable from "no entry": unconfigured output stays identical.
 *
 * Reset semantics: removing the entry restores the automatic layout of that
 * single item (double-click on the item, or the per-item reset control). It
 * never touches the group transforms nor any other item.
 *
 * Browser-safe: pure functions, no imports from Node/browser APIs.
 */

import { BADGE_OFFSET_NUMERIC_LIMIT } from "./badge-offset-ranges"

/** One item correction: percentage scale + canvas px offsets. */
export interface BadgeItemTransform {
  /** Percentage of the item's automatic size (10..200, 100 = untouched). */
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

/** Stored corrections by stable identity. */
export type BadgeItemTransformMap = Readonly<Record<string, BadgeItemTransform>>

/** The automatic layout: no correction. */
export const BADGE_ITEM_NEUTRAL: BadgeItemTransform = { scale: 100, offsetX: 0, offsetY: 0 }

/** Same bounds as the group scales (`badge-styles` / server clamp). */
export const BADGE_ITEM_SCALE_MIN = 10
export const BADGE_ITEM_SCALE_MAX = 200

/** Stable identity builders (the ONLY way an id is created). */
export const BADGE_ITEM_QUALITY_TIER = "quality:tier"
export const BADGE_ITEM_QUALITY_AGE = "quality:age"
export const BADGE_ITEM_QUALITY_COMBO = "quality:combo:dv-atmos"

export function ratingItemId(source: string | null | undefined): string | null {
  const id = normalizeIdentityPart(source)
  return id ? `rating:${id}` : null
}

export function qualityFormatItemId(format: string | null | undefined): string | null {
  const id = normalizeIdentityPart(format)
  return id ? `quality:format:${id}` : null
}

function normalizeIdentityPart(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const id = raw.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_.-]{0,31}$/.test(id)) return null
  return id
}

/**
 * Lenient identity validator used by the parser: only the two known
 * namespaces are accepted (bounded length, bounded charset). Anything else is
 * dropped instead of reaching a cache key or a render.
 */
const ITEM_ID_RE = /^(rating|quality):[a-z0-9][a-z0-9:_.-]{0,47}$/

export function isBadgeItemId(raw: unknown): raw is string {
  return typeof raw === "string" && ITEM_ID_RE.test(raw)
}

/** True when the item kind is a separate-rating provider. */
export function isRatingItemId(id: string): boolean {
  return id.startsWith("rating:")
}

/** True when the item kind is a quality/AV mark. */
export function isQualityItemId(id: string): boolean {
  return id.startsWith("quality:")
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

export function clampBadgeItemScale(value: unknown): number {
  if (!finite(value)) return BADGE_ITEM_NEUTRAL.scale
  return Math.min(Math.max(Math.round(value), BADGE_ITEM_SCALE_MIN), BADGE_ITEM_SCALE_MAX)
}

export function clampBadgeItemOffset(value: unknown): number {
  if (!finite(value)) return 0
  return Math.min(Math.max(Math.round(value), -BADGE_OFFSET_NUMERIC_LIMIT), BADGE_OFFSET_NUMERIC_LIMIT)
}

/** A stored correction for `id` (null = automatic layout). */
export function badgeItemTransform(map: BadgeItemTransformMap | null | undefined, id: string): BadgeItemTransform | null {
  if (!map) return null
  const found = map[id]
  return found && isBadgeItemId(id) ? found : null
}

/** True when the correction is byte-identical to the automatic layout. */
export function isNeutralBadgeItemTransform(t: BadgeItemTransform | null | undefined): boolean {
  if (!t) return true
  return t.scale === 100 && t.offsetX === 0 && t.offsetY === 0
}

/** The corrections that actually change the render (neutral entries dropped). */
export function effectiveBadgeItemTransforms(
  map: BadgeItemTransformMap | null | undefined,
): BadgeItemTransformMap {
  if (!map) return {}
  const out: Record<string, BadgeItemTransform> = {}
  for (const [id, t] of Object.entries(map)) {
    if (!isBadgeItemId(id)) continue
    if (isNeutralBadgeItemTransform(t)) continue
    out[id] = t
  }
  return out
}

export function hasBadgeItemTransforms(map: BadgeItemTransformMap | null | undefined): boolean {
  return Object.keys(effectiveBadgeItemTransforms(map)).length > 0
}

/** Immutable write. A neutral correction removes the entry (automatic again). */
export function withBadgeItemTransform(
  map: BadgeItemTransformMap | null | undefined,
  id: string,
  transform: BadgeItemTransform,
): BadgeItemTransformMap {
  if (!isBadgeItemId(id)) return map ?? {}
  const next: Record<string, BadgeItemTransform> = { ...(map ?? {}) }
  const normalized: BadgeItemTransform = {
    scale: clampBadgeItemScale(transform.scale),
    offsetX: clampBadgeItemOffset(transform.offsetX),
    offsetY: clampBadgeItemOffset(transform.offsetY),
  }
  if (isNeutralBadgeItemTransform(normalized)) delete next[id]
  else next[id] = normalized
  return next
}

/** Immutable reset of a single item (group transforms untouched). */
export function withoutBadgeItemTransform(
  map: BadgeItemTransformMap | null | undefined,
  id: string,
): BadgeItemTransformMap {
  const next: Record<string, BadgeItemTransform> = { ...(map ?? {}) }
  delete next[id]
  return next
}

/**
 * Explicit REJOIN of several items in ONE write: removes exactly those
 * identities, unconditionally.
 *
 * This is the recovery primitive, deliberately different from the reset
 * controls: a reset restores the APPLIED PRESET snapshot (which may legitimately
 * contain an old nudge captured at apply time), a rejoin only ever DELETES the
 * draft's own corrections for the given identities. It never consults a
 * snapshot, so a stale correction cannot come back through it.
 */
export function rejoinBadgeItems(
  map: BadgeItemTransformMap | null | undefined,
  ids: readonly string[],
): BadgeItemTransformMap {
  const next: Record<string, BadgeItemTransform> = { ...(map ?? {}) }
  for (const id of ids) delete next[id]
  return next
}

/**
 * Drop every correction owned by one badge FAMILY.
 *
 * Natural hierarchy: an item correction is a delta on top of its family's
 * layout, so a family reset that kept them would leave the items outside the
 * restored layout. A group reset therefore clears the items it owns
 * (`quality:*` for the quality stack, `rating:*` for the separate-rating
 * column) and never touches another family's corrections.
 */
export function withoutBadgeItemFamily(
  map: BadgeItemTransformMap | null | undefined,
  family: "quality" | "separate" | null | undefined,
): BadgeItemTransformMap {
  const next: Record<string, BadgeItemTransform> = { ...(map ?? {}) }
  if (family !== "quality" && family !== "separate") return next
  for (const id of Object.keys(next)) {
    if (family === "quality" ? isQualityItemId(id) : isRatingItemId(id)) delete next[id]
  }
  return next
}

/**
 * Canonical wire form: `id=scale,offsetX,offsetY` joined by `;`, keys sorted.
 * Deterministic (one key per configuration, no cache fragmentation), bounded
 * and reversible. `null` when nothing is configured, so existing URLs and
 * payloads stay byte-identical.
 */
export function serializeBadgeItemTransforms(map: BadgeItemTransformMap | null | undefined): string | null {
  const effective = effectiveBadgeItemTransforms(map)
  const ids = Object.keys(effective).sort()
  if (ids.length === 0) return null
  return ids
    .map((id) => {
      const t = effective[id]
      return `${id}=${t.scale},${t.offsetX},${t.offsetY}`
    })
    .join(";")
}

/**
 * Lenient parser: unknown namespaces, malformed triples and out-of-range
 * numbers are dropped (fail-closed, never invented geometry). A later entry for
 * the same identity wins (last write), and neutral entries are removed, so
 * parsing is idempotent and the cache canonicalization can rely on it.
 */
export function parseBadgeItemTransforms(raw: string | null | undefined): BadgeItemTransformMap {
  if (typeof raw !== "string" || raw.trim() === "") return {}
  const out: Record<string, BadgeItemTransform> = {}
  for (const chunk of raw.split(";")) {
    const part = chunk.trim()
    if (!part) continue
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    const id = part.slice(0, eq).trim()
    if (!isBadgeItemId(id)) continue
    const triple = part.slice(eq + 1).split(",")
    if (triple.length !== 3) continue
    const nums = triple.map((v) => (v.trim() === "" ? Number.NaN : Number(v)))
    if (!nums.every((v) => Number.isFinite(v))) continue
    const transform: BadgeItemTransform = {
      scale: clampBadgeItemScale(nums[0]),
      offsetX: clampBadgeItemOffset(nums[1]),
      offsetY: clampBadgeItemOffset(nums[2]),
    }
    if (isNeutralBadgeItemTransform(transform)) delete out[id]
    else out[id] = transform
  }
  return out
}

/**
 * Canonical string of a possibly dirty payload (cache key + transport): parse
 * then serialize. `null` = nothing configured (indistinguishable from absent).
 */
export function canonicalizeBadgeItemTransforms(raw: string | null | undefined): string | null {
  return serializeBadgeItemTransforms(parseBadgeItemTransforms(raw))
}

/** Canvas box of one composed element (px). */
export interface BadgeItemBox {
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
}

/**
 * Apply one item correction to the box the renderer already reported for it.
 *
 * Scale is applied about the box centre (the element grows/shrinks in place),
 * then the offsets are added. Integers only: the same numbers are drawn by the
 * editor overlay and stored by the render call. No containment: like the group
 * offsets, an extreme value is the user's explicit WYSIWYG choice; the final
 * canvas fit still applies.
 */
export function applyBadgeItemTransform(
  box: BadgeItemBox,
  transform: BadgeItemTransform | null | undefined,
): BadgeItemBox {
  const t = transform ?? BADGE_ITEM_NEUTRAL
  const scale = clampBadgeItemScale(t.scale)
  const w = Math.max(1, Math.round((box.w * scale) / 100))
  const h = Math.max(1, Math.round((box.h * scale) / 100))
  const left = Math.round(box.left + (box.w - w) / 2) + clampBadgeItemOffset(t.offsetX)
  const top = Math.round(box.top + (box.h - h) / 2) + clampBadgeItemOffset(t.offsetY)
  return { top, left, w, h }
}

/**
 * The stored correction after a drag of `delta` canvas px: the reported box
 * already contains the current correction, so a canvas delta IS the delta of
 * the stored offset (same rule as the group drag, see `badge-drag-geometry`).
 */
export function moveBadgeItemTransform(
  current: BadgeItemTransform | null | undefined,
  delta: { readonly x: number; readonly y: number },
): BadgeItemTransform {
  const base = current ?? BADGE_ITEM_NEUTRAL
  return {
    scale: base.scale,
    offsetX: clampBadgeItemOffset(base.offsetX + delta.x),
    offsetY: clampBadgeItemOffset(base.offsetY + delta.y),
  }
}

/** The stored correction after a resize from `startScale` to `scale`. */
export function resizeBadgeItemTransform(
  current: BadgeItemTransform | null | undefined,
  scale: number,
): BadgeItemTransform {
  const base = current ?? BADGE_ITEM_NEUTRAL
  return { scale: clampBadgeItemScale(scale), offsetX: base.offsetX, offsetY: base.offsetY }
}

/** Human label key for an item identity (translation keys in the component). */
export function badgeItemLabelKind(id: string): { kind: "rating"; id: string } | { kind: "tier" | "age" | "combo" | "format"; format?: string } | null {
  if (isRatingItemId(id)) return { kind: "rating", id: id.slice("rating:".length) }
  if (id === BADGE_ITEM_QUALITY_TIER) return { kind: "tier" }
  if (id === BADGE_ITEM_QUALITY_AGE) return { kind: "age" }
  if (id === BADGE_ITEM_QUALITY_COMBO) return { kind: "combo" }
  if (id.startsWith("quality:format:")) return { kind: "format", format: id.slice("quality:format:".length) }
  return null
}
