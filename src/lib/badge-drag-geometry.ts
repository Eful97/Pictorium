/**
 * Direct badge dragging on the global defaults preview.
 *
 * Same single renderer, no second layout: the draggable boxes are the ones the
 * server ACTUALLY composed, read from the existing `debug=1&netgeo=1`
 * diagnostic render on the exact preview URL (`badges` block). The client only
 * maps screen px -> canvas px and writes the existing Transform X/Y values; it
 * never recomputes anchors, sizes or collision rules.
 *
 * The top slot reports which WHOLE-POSTER layout the render is using:
 * `layout === "ranked"` = a ranking badge/numeral is actually displayed
 * (classifica tuning), `layout === "fallback"` = the without-ranking layout
 * (extra tuning for the top slot; every other family keeps its own profile and
 * receives a different renderer baseline). The choice comes from the rendered
 * badge kind, never from the mere availability of ranking data.
 *
 * Every family is written independently (scale + X + Y) and a double-click
 * reset restores the canonical defaults of the ACTIVE profile only.
 *
 * Position while dragging plus an aspect-preserving corner RESIZE on the
 * selected element: both write the same stored values the Transform sliders
 * write (X/Y and the family scale), so the two stay synchronized. Scale
 * proposals are clamped to the server scale contract and -- only when the
 * element already fits -- to the frame the reported box shows around it. The
 * reset writes position AND scale.

 * While dragging, the box snaps to the poster centre and to the other
 * rendered badges' edges/centres; the returned guides are EDITOR-ONLY overlay
 * lines derived from the reported boxes, never part of the render. A drag can
 * never push the reported box (badge or title logo) outside the poster frame:
 * the proposed delta is contained against the reported box and the canvas
 * AFTER snapping (`resolveBadgeDragDelta`), on every axis the renderer really
 * applies, in every layout and at any zoom. Offsets are
 * written with the legacy `offset += delta` rule (the
 * renderer adds the offset to an already-unknown anchor, so a canvas-pixel
 * delta IS the offset delta — in fixed network coordinates too, where the
 * stored offset is the absolute top-left). Clamp mirrors the server contract
 * (+-2000, see `badge-offset-ranges.ts`).
 *
 * The Transform SLIDERS keep their existing contract (full canvas crossing per
 * axis, no containment promised, see `badge-offset-ranges.ts`): they are shared
 * with the per-title editor and the numeric edits, so this drag-only bound is
 * deliberately not applied to them.
 *
 * Browser-safe: pure functions, no runtime imports.
 */

import { BADGE_OFFSET_NUMERIC_LIMIT } from "./badge-offset-ranges"

/** Badge families the renderer can report a final box for. */
export type BadgeDragFamily = "rank" | "extra" | "genre" | "quality" | "separate" | "network" | "logo"

/** Top slot actually painted: the two complete geometry layouts. */
export type BadgeDragKind = "rank" | "extra"

/** Whole-poster geometry layout actually displayed. */
export type BadgeDragLayout = "ranked" | "fallback"

/** Visible body box (canvas px) of the composed badge. */
export interface BadgeDragBox {
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
}

export interface BadgeDragGeometry {
  readonly canvasW: number
  readonly canvasH: number
  readonly kind: BadgeDragKind | null
  /** Whole-poster layout actually displayed (null = legacy payload). */
  readonly layout: BadgeDragLayout | null
  readonly boxes: Partial<Record<BadgeDragFamily, BadgeDragBox>>
  /** Families whose X offset the renderer ignores (anchored/full-width). */
  readonly fixedX: Partial<Record<BadgeDragFamily, boolean>>
  /**
   * Separately composited badge ITEMS (one rating pill, one quality/AV mark),
   * by stable identity — the boxes the server really composed for them.
   * Empty when the active layout bakes them into a single block.
   */
  readonly items: readonly BadgeDragItem[]
}

/** One separately composited badge item reported by the renderer. */
export interface BadgeDragItem {
  /** Stable identity (`badge-item-transforms`), never an array index. */
  readonly id: string
  readonly family: "quality" | "separate"
  readonly box: BadgeDragBox
  /** True when a per-item correction is currently applied. */
  readonly custom: boolean
}

export type BadgeDragAxis = "x" | "y"

/** Editor-only snap radius (screen px): never a render value. */
export const BADGE_DRAG_SNAP_SCREEN_PX = 6

/** One editor-only alignment line (canvas px). */
export interface BadgeSnapGuide {
  readonly axis: BadgeDragAxis
  readonly pos: number
  /** True when the line is the poster centre axis. */
  readonly center: boolean
}

export interface BadgeSnapResult {
  readonly delta: { readonly x: number; readonly y: number }
  readonly guides: readonly BadgeSnapGuide[]
}

const FAMILIES: readonly BadgeDragFamily[] = ["rank", "extra", "genre", "quality", "separate", "network", "logo"]

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

function box(v: unknown): BadgeDragBox | null {
  if (!v || typeof v !== "object") return null
  const rec = v as Record<string, unknown>
  const top = rec.top
  const left = rec.left
  const w = rec.w
  const h = rec.h
  if (!finite(top) || !finite(left) || !finite(w) || !finite(h)) return null
  if (w <= 0 || h <= 0) return null
  return { top, left, w, h }
}

/**
 * Lenient parser for the `badges` block of the netgeo response. `null` when
 * the payload is not usable (old server, aborted render, network-only
 * payload): the UI then shows no handle instead of guessing a box.
 */
export function parseBadgeDragGeometry(json: unknown): BadgeDragGeometry | null {
  if (!json || typeof json !== "object") return null
  const raw = (json as Record<string, unknown>).badges
  if (!raw || typeof raw !== "object") return null
  const rec = raw as Record<string, unknown>
  const canvasW = rec.canvasW
  const canvasH = rec.canvasH
  if (!finite(canvasW) || !finite(canvasH) || canvasW <= 0 || canvasH <= 0) return null
  const familiesRaw = rec.families
  if (!familiesRaw || typeof familiesRaw !== "object") return null
  const famRec = familiesRaw as Record<string, unknown>
  const boxes: Partial<Record<BadgeDragFamily, BadgeDragBox>> = {}
  for (const family of FAMILIES) {
    const parsed = box(famRec[family])
    if (parsed) boxes[family] = parsed
  }
  const fixedRaw = rec.fixedX
  const fixedRec = fixedRaw && typeof fixedRaw === "object" ? (fixedRaw as Record<string, unknown>) : {}
  const fixedX: Partial<Record<BadgeDragFamily, boolean>> = {}
  for (const family of FAMILIES) {
    if (fixedRec[family] === true) fixedX[family] = true
  }
  const kind: BadgeDragKind | null = rec.kind === "rank" || rec.kind === "extra" ? rec.kind : null
  // Explicit whole-poster layout wins; legacy payloads derive it from the
  // painted top badge (rank = ranked, extra = fallback). No rank/extra box =
  // unknown, never a guessed layout.
  const layout: BadgeDragLayout | null =
    rec.layout === "ranked" || rec.layout === "fallback"
      ? rec.layout
      : kind === "rank"
        ? "ranked"
        : kind === "extra"
          ? "fallback"
          : null
  const items: BadgeDragItem[] = []
  const itemsRaw = rec.items
  if (Array.isArray(itemsRaw)) {
    for (const entry of itemsRaw) {
      if (!entry || typeof entry !== "object") continue
      const itemRec = entry as Record<string, unknown>
      const id = itemRec.id
      const family = itemRec.family
      if (typeof id !== "string") continue
      if (family !== "quality" && family !== "separate") continue
      const parsed = box(itemRec)
      if (!parsed) continue
      items.push({ id, family, box: parsed, custom: itemRec.custom === true })
    }
  }
  return { canvasW, canvasH, kind, layout, boxes, fixedX, items }
}

/** Canvas pixel delta of a pointer movement over the displayed poster. */
export function screenToCanvasDelta(input: {
  readonly dx: number
  readonly dy: number
  readonly displayWidth: number
  readonly canvasW: number
}): { x: number; y: number } {
  const { dx, dy, displayWidth, canvasW } = input
  if (!finite(dx) || !finite(dy) || !finite(displayWidth) || !finite(canvasW)) return { x: 0, y: 0 }
  if (displayWidth <= 0 || canvasW <= 0) return { x: 0, y: 0 }
  const ratio = canvasW / displayWidth
  return { x: dx * ratio, y: dy * ratio }
}

/** Inverse of `screenToCanvasDelta`: canvas offset -> on-screen px offset. */
export function canvasToScreenDelta(input: {
  readonly dx: number
  readonly dy: number
  readonly displayWidth: number
  readonly canvasW: number
}): { x: number; y: number } {
  const { dx, dy, displayWidth, canvasW } = input
  if (!finite(dx) || !finite(dy) || !finite(displayWidth) || !finite(canvasW)) return { x: 0, y: 0 }
  if (displayWidth <= 0 || canvasW <= 0) return { x: 0, y: 0 }
  const ratio = displayWidth / canvasW
  return { x: dx * ratio, y: dy * ratio }
}

/**
 * Snap radius in SCREEN px (constant feel at any preview size), converted to
 * canvas px for the reported boxes.
 */
export function snapThresholdCanvas(displayWidth: number, canvasW: number): number {
  if (!finite(displayWidth) || !finite(canvasW) || displayWidth <= 0 || canvasW <= 0) return 0
  return (BADGE_DRAG_SNAP_SCREEN_PX * canvasW) / displayWidth
}

/** Server clamp (px) for every badge offset axis. */
export function clampBadgeOffset(value: number): number {
  if (!finite(value)) return 0
  return Math.min(Math.max(Math.round(value), -BADGE_OFFSET_NUMERIC_LIMIT), BADGE_OFFSET_NUMERIC_LIMIT)
}

/* ------------------------------------------------------------------ */
/* Scale resize (aspect-preserving, derived from the reported box)    */
/* ------------------------------------------------------------------ */

/** Server scale contract: `clamp(..., 10, 200)` in `poster-config.ts`. */
export const BADGE_SCALE_MIN = 10
export const BADGE_SCALE_MAX = 200

/** Below this pointer radius (canvas px) a ratio is too noisy to read. */
const RESIZE_MIN_RADIUS = 4

export interface BadgeScaleLimits {
  readonly min: number
  readonly max: number
}

/**
 * UI scale limits of one family, mirroring the existing Transform controls:
 * every badge family shares the server range (10..200); the title logo keeps
 * its per-layout UI cap (Standard 100, Fresh 200, passed by the caller from
 * `logo-selection`). No new constant, no new contract.
 */
export function badgeScaleLimits(
  family: BadgeDragFamily,
  input?: { readonly titleMax?: number | null },
): BadgeScaleLimits {
  if (family !== "logo") return { min: BADGE_SCALE_MIN, max: BADGE_SCALE_MAX }
  const raw = input?.titleMax
  const max = finite(raw)
    ? Math.min(Math.max(Math.round(raw), BADGE_SCALE_MIN), BADGE_SCALE_MAX)
    : BADGE_SCALE_MAX
  return { min: BADGE_SCALE_MIN, max }
}

/** Result of one clamped scale proposal (family range + frame). */
export interface BadgeResizeResult {
  /** Scale to store (integer, same value drawn and written). */
  readonly scale: number
  /** True when the family range shortened the proposal. */
  readonly clamped: boolean
  /** True when the frame bound refused further growth. */
  readonly frameClamped: boolean
}

export interface BadgeResizeInput {
  readonly family: BadgeDragFamily
  /** Scale the renderer is using for the box that was reported. */
  readonly startScale: number
  /** Box the renderer reported for the exact preview URL (canvas px). */
  readonly box: BadgeDragBox
  readonly canvasW: number
  readonly canvasH: number
  /** Title-logo UI cap of the ACTIVE layout (ignored by badge families). */
  readonly titleMax?: number | null
}

/**
 * Clamp a proposed scale to the family limits and to the frame.
 *
 * The frame bound is derived from the AUTHORITATIVE box the renderer already
 * reported for this exact URL: growing the element by `scale / startScale`
 * predicts its new size, so growth stops where its predicted box would touch
 * the canvas edge. An element that already overflows the frame cannot be fully
 * contained by scaling (the renderer's anchors are margins, not absolute
 * geometry): it may shrink but never grow. Shrinking is always allowed inside
 * the family range. Both are honest: a full-width element (box as wide as the
 * canvas) reports no growth room, because growing it would leave the frame.
 *
 * Position containment is deliberately NOT promised here: scale is applied by
 * the renderer around its own anchor, so a bigger element may still cross an
 * edge set by a stored margin. Dimensions are what this clamp guarantees.
 */
export function clampBadgeResizeScale(
  input: BadgeResizeInput & { readonly scale: number },
): BadgeResizeResult {
  const { family, box, canvasW, canvasH, startScale } = input
  const limits = badgeScaleLimits(family, { titleMax: input.titleMax })
  const start = finite(startScale) && startScale > 0 ? startScale : limits.min
  if (!finite(input.scale)) return { scale: Math.round(start), clamped: true, frameClamped: false }
  let next = Math.round(input.scale)
  let clamped = false
  if (next < limits.min) {
    next = limits.min
    clamped = true
  }
  if (next > limits.max) {
    next = limits.max
    clamped = true
  }
  let frameClamped = false
  if (
    next > start &&
    finite(box.w) &&
    finite(box.h) &&
    box.w > 0 &&
    box.h > 0 &&
    finite(canvasW) &&
    finite(canvasH) &&
    canvasW > 0 &&
    canvasH > 0
  ) {
    // Room the reported box still has, as a growth factor (>= 1 = fits).
    const fit = Math.min(canvasW / box.w, canvasH / box.h)
    const maxScale = Math.max(limits.min, Math.floor(start * Math.max(fit, 1)))
    if (next > maxScale) {
      next = maxScale
      frameClamped = true
    }
  }
  return { scale: next, clamped, frameClamped }
}

export interface BadgeResizeVector {
  readonly x: number
  readonly y: number
}

/**
 * Aspect-preserving resize from one corner handle. Both vectors are the
 * pointer position relative to the box CENTRE in canvas px (the caller
 * projects screen px through the displayed width/height, so the same gesture
 * asks for the same scale at any preview zoom). The uniform distance ratio is
 * the scale ratio: crossing the centre shrinks, moving outward grows.
 */
export function resolveBadgeResizeScale(
  input: BadgeResizeInput & {
    readonly start: BadgeResizeVector
    readonly current: BadgeResizeVector
  },
): BadgeResizeResult {
  const { start, current, startScale } = input
  const startLen = Math.hypot(start.x, start.y)
  const currentLen = Math.hypot(current.x, current.y)
  if (
    !finite(startLen) ||
    !finite(currentLen) ||
    startLen < RESIZE_MIN_RADIUS ||
    !finite(startScale) ||
    startScale <= 0
  ) {
    return clampBadgeResizeScale({ ...input, scale: input.startScale })
  }
  return clampBadgeResizeScale({ ...input, scale: (startScale * currentLen) / startLen })
}

/** Keyboard resize: one step of the same clamp (Shift = 10). */
export function stepBadgeResizeScale(input: BadgeResizeInput & { readonly step: number }): BadgeResizeResult {
  const scale = (finite(input.startScale) ? input.startScale : BADGE_SCALE_MIN) + (finite(input.step) ? input.step : 0)
  return clampBadgeResizeScale({ ...input, scale })
}

/**
 * Effective numeric scale of the title logo when its stored value is `null`
 * (auto-fit): the renderer's own box says how wide the logo currently is, so
 * the first resize starts from the scale that box represents instead of a
 * guessed 100. The renderer's own caps still apply afterwards, and the
 * derived value is only a BASELINE for the ratio (never written on its own).
 */
export function deriveEffectiveLogoScale(input: {
  readonly box: BadgeDragBox
  readonly canvasW: number
  readonly titleMax?: number | null
}): number {
  const limits = badgeScaleLimits("logo", { titleMax: input.titleMax })
  if (!finite(input.canvasW) || input.canvasW <= 0 || !finite(input.box.w) || input.box.w <= 0) return limits.min
  const derived = Math.round((input.box.w * 100) / input.canvasW)
  return Math.min(Math.max(derived, limits.min), limits.max)
}

/**
 * A family is draggable on an axis only when the renderer reported a box for
 * it AND the offset is actually applied on that axis. `fixedX` covers the
 * anchored styles (full-width genre bar) where X is ignored.
 */
export function isBadgeDraggable(
  geometry: BadgeDragGeometry | null,
  family: BadgeDragFamily,
  axis: BadgeDragAxis = "x",
): boolean {
  if (!geometry) return false
  if (!geometry.boxes[family]) return false
  if (axis === "x" && geometry.fixedX[family] === true) return false
  return true
}

/** Disabled reason keys for the UI (translation keys live in the component). */
export type BadgeDragLock = "missing" | "fixedX" | null

export function badgeDragLock(
  geometry: BadgeDragGeometry | null,
  family: BadgeDragFamily,
  axis: BadgeDragAxis = "x",
): BadgeDragLock {
  if (!geometry || !geometry.boxes[family]) return "missing"
  if (axis === "x" && geometry.fixedX[family] === true) return "fixedX"
  return null
}

/** Which complete whole-poster layout the sampled render is using. */
export function topBadgeLayout(
  layout: BadgeDragLayout | null,
  kind?: BadgeDragKind | null,
): "ranked" | "fallback" | null {
  if (layout === "ranked") return "ranked"
  if (layout === "fallback") return "fallback"
  if (kind === "rank") return "ranked"
  if (kind === "extra") return "fallback"
  return null
}

/** Resolved stored (explicit) values of one geometry profile. */
export interface BadgeProfileExplicit {
  readonly scale: number | null
  readonly offsetX: number | null
  readonly offsetY: number | null
}

/** Values the renderer is effectively using (legacy fallback applied). */
export interface BadgeProfileEffective {
  readonly scale: number | null
  readonly offsetX: number
  readonly offsetY: number
}

/** Triple to persist for the dragged profile. */
export interface BadgeProfileWrite {
  /** Non-null only when the write must MATERIALIZE the profile (complete layout). */
  readonly scale: number | null
  readonly offsetX: number
  readonly offsetY: number
}

/** Full transform profile of one family (position + scale). */
export interface BadgeTransformProfile {
  readonly scale: number | null
  readonly offsetX: number | null
  readonly offsetY: number | null
}

/** Canonical reset targets per family for the ACTIVE shape/profile. */
export type BadgeResetDefaults = Record<BadgeDragFamily, BadgeTransformProfile>

/**
 * Write for a drag on one family.
 *
 * - `fallback` (extra top badge) writes the COMPLETE fallback layout: the
 *   effective scale is frozen alongside the new offsets, so the layout stops
 *   following the classifica profile axis-by-axis and becomes an independent,
 *   complete geometry profile. Same pixels at drag time, no jump.
 * - every other family writes only the offsets (the existing materialization
 *   in the context freezes the fallback for a classifica edit, and the scale
 *   stays where the user put it).
 */
export function resolveBadgeDragWrite(input: {
  readonly family: BadgeDragFamily
  readonly kind: BadgeDragKind | null
  readonly explicit: BadgeProfileExplicit
  readonly effective: BadgeProfileEffective
  readonly delta: { readonly x: number; readonly y: number }
}): BadgeProfileWrite {
  const { family, kind, explicit, effective, delta } = input
  const offsetX = clampBadgeOffset(effective.offsetX + delta.x)
  const offsetY = clampBadgeOffset(effective.offsetY + delta.y)
  const isFallbackProfile = family === "extra" && kind !== "rank"
  if (!isFallbackProfile) {
    return { scale: null, offsetX, offsetY }
  }
  // Complete fallback layout: keep the scale the renderer used (explicit value
  // wins, else the inherited effective one) so the triple is self-contained.
  const scale = explicit.scale ?? effective.scale
  return { scale: finite(scale) ? Math.round(scale) : null, offsetX, offsetY }
}

/**
 * True when the family belongs to the ACTIVE whole-poster layout. A ranked
 * reset never touches the fallback top slot and vice versa; every other
 * family is present in both layouts.
 */
export function badgeResetApplies(
  family: BadgeDragFamily,
  layout: BadgeDragLayout | null,
): boolean {
  if (family === "rank") return layout !== "fallback"
  if (family === "extra") return layout !== "ranked"
  return true
}

/**
 * Family transform reset for the ACTIVE whole-poster layout.
 *
 * Canonical targets come from the caller (the existing Reset controls of the
 * shape/profile, never guessed): rank 100/0/0, extra null/null/null (follow),
 * genre 100/0/0, quality 100 + shape default offsets, separate style default
 * + 0/0, network 100/0/0 (the follow toggle is not a transform), logo
 * auto + 0/0.
 *
 * Only the family of the active profile is reset: a ranked reset never writes
 * the fallback top slot and vice versa; every other family keeps its values.
 * Returns null when the family is not part of the active layout.
 */
export function resolveBadgeReset(input: {
  readonly family: BadgeDragFamily
  readonly layout: BadgeDragLayout | null
  readonly defaults: BadgeResetDefaults
}): BadgeTransformProfile | null {
  const { family, layout, defaults } = input
  if (family === "rank" && layout === "fallback") return null
  if (family === "extra" && layout === "ranked") return null
  const canonical = defaults[family]
  if (!canonical) return null
  return {
    scale: canonical.scale,
    offsetX: canonical.offsetX,
    offsetY: canonical.offsetY,
  }
}

/* ------------------------------------------------------------------ */
/* Alignment guides + snapping (editor-only)                          */
/* ------------------------------------------------------------------ */

interface SnapTarget {
  readonly pos: number
  readonly center: boolean
}

/**
 * Snap targets on one axis: the poster centre plus every OTHER reported
 * badge's leading edge, centre and trailing edge. Boxes the server did not
 * report never become targets (no guessed regions).
 */
function snapTargets(
  geometry: BadgeDragGeometry,
  family: BadgeDragFamily,
  axis: BadgeDragAxis,
  excludeItemId?: string,
): SnapTarget[] {
  return snapTargetsFor(geometry, [family], axis, excludeItemId === undefined ? [] : [excludeItemId])
}

/**
 * Snap targets on one axis for a whole SELECTION: the poster centre plus every
 * reported box that is not part of the dragged set. Excluding the members
 * themselves is what makes a group drag snap to its neighbours instead of to
 * its own edges.
 */
function snapTargetsFor(
  geometry: BadgeDragGeometry,
  excludeFamilies: readonly BadgeDragFamily[],
  axis: BadgeDragAxis,
  excludeItemIds: readonly string[],
): SnapTarget[] {
  const center = axis === "x" ? geometry.canvasW / 2 : geometry.canvasH / 2
  const targets: SnapTarget[] = [{ pos: center, center: true }]
  for (const other of FAMILIES) {
    if (excludeFamilies.includes(other)) continue
    const box = geometry.boxes[other]
    if (!box) continue
    if (axis === "x") {
      targets.push({ pos: box.left, center: false })
      targets.push({ pos: box.left + box.w / 2, center: false })
      targets.push({ pos: box.left + box.w, center: false })
    } else {
      targets.push({ pos: box.top, center: false })
      targets.push({ pos: box.top + box.h / 2, center: false })
      targets.push({ pos: box.top + box.h, center: false })
    }
  }
  // Other badge ITEMS are alignment targets too (align IMDb with the Dolby
  // mark, etc.). The dragged items themselves are excluded: a box can never
  // snap to its own edges.
  for (const item of geometry.items) {
    if (excludeItemIds.includes(item.id)) continue
    const box = item.box
    if (axis === "x") {
      targets.push({ pos: box.left, center: false })
      targets.push({ pos: box.left + box.w / 2, center: false })
      targets.push({ pos: box.left + box.w, center: false })
    } else {
      targets.push({ pos: box.top, center: false })
      targets.push({ pos: box.top + box.h / 2, center: false })
      targets.push({ pos: box.top + box.h, center: false })
    }
  }
  return targets
}

interface AxisSnap {
  readonly delta: number
  readonly guide: BadgeSnapGuide | null
}

function snapAxis(
  input: {
    readonly start: number
    readonly size: number
    readonly delta: number
    readonly threshold: number
    readonly axis: BadgeDragAxis
  },
  targets: readonly SnapTarget[],
): AxisSnap {
  const { start, size, delta, threshold, axis } = input
  const fallback: AxisSnap = { delta, guide: null }
  if (!finite(threshold) || threshold <= 0) return fallback
  // The three anchors of the dragged box: leading edge, centre, trailing edge.
  const anchors = [0, size / 2, size]
  let best: AxisSnap = fallback
  let bestDistance = Number.POSITIVE_INFINITY
  for (const target of targets) {
    for (const anchor of anchors) {
      const snappedDelta = target.pos - start - anchor
      const distance = Math.abs(snappedDelta - delta)
      if (distance > threshold || distance >= bestDistance) continue
      bestDistance = distance
      best = {
        delta: snappedDelta,
        guide: { axis, pos: target.pos, center: target.center },
      }
    }
  }
  return best
}

/**
 * Photoshop-like snapping of the dragged box to the poster centre or to the
 * other rendered badges, with the alignment lines to draw while the pointer is
 * down. Pure: the caller supplies the raw pointer delta in canvas px and the
 * snap threshold in canvas px (a constant screen-px radius converted at the
 * displayed size). Editor-only: nothing here reaches the renderer.
 *
 * `allowX` is false for anchored/full-width families whose X offset the
 * renderer ignores: no X snap, so no guide promises a movement that cannot
 * happen.
 */
export function computeBadgeDragSnap(input: {
  readonly geometry: BadgeDragGeometry | null
  readonly family: BadgeDragFamily
  readonly box: BadgeDragBox
  readonly delta: { readonly x: number; readonly y: number }
  /** Snap radius in canvas px (<= 0 disables snapping). */
  readonly threshold: number
  readonly allowX?: boolean
  /** Dragged badge ITEM (excluded from its own snap targets). */
  readonly excludeItemId?: string
}): BadgeSnapResult {
  const { geometry, family, box, delta, threshold, allowX = true, excludeItemId } = input
  if (!geometry) return { delta: { x: delta.x, y: delta.y }, guides: [] }
  const x = allowX
    ? snapAxis(
        { start: box.left, size: box.w, delta: delta.x, threshold, axis: "x" },
        snapTargets(geometry, family, "x", excludeItemId),
      )
    : { delta: delta.x, guide: null }
  const y = snapAxis(
    { start: box.top, size: box.h, delta: delta.y, threshold, axis: "y" },
    snapTargets(geometry, family, "y", excludeItemId),
  )
  const guides: BadgeSnapGuide[] = []
  if (x.guide) guides.push(x.guide)
  if (y.guide) guides.push(y.guide)
  return { delta: { x: x.delta, y: y.delta }, guides }
}

/* ------------------------------------------------------------------ */
/* Containment inside the poster frame (drag only)                    */
/* ------------------------------------------------------------------ */

/** Result of the containment pass over one proposed drag delta (canvas px). */
export interface BadgeDragContainResult {
  /** Delta actually applied: integer canvas px, same value shown and stored. */
  readonly delta: { readonly x: number; readonly y: number }
  /** True when an axis had to be shortened to keep the box inside the frame. */
  readonly clampedX: boolean
  readonly clampedY: boolean
}

interface AxisContain {
  readonly delta: number
  readonly clamped: boolean
}

/**
 * Containment of ONE axis.
 *
 * The box (`start`, `size`) may travel inside the canvas, so its position is
 * bounded by [lo, hi]: `[0, canvas - size]` for a box that fits, and
 * `[canvas - size, 0]` (negative) for a box wider/taller than the poster, where
 * that range is exactly the travel that keeps it covering the frame.
 *
 * - Start inside: the moved position is clamped into [lo, hi].
 * - Start ALREADY outside (a stored offset pushed it out, or the box grew over
 *   the frame): moving FURTHER out is refused and moving back in is accepted
 *   verbatim — never a jump onto the frame, which would move the element
 *   without the pointer. The guarantee then is "the drag never makes it
 *   worse"; full containment of such a box is not reachable in one drag step.
 * - Oversized box: it cannot be fully contained by construction; the clamp
 *   keeps it COVERING the canvas (no gap on the axis) instead of promising an
 *   impossible containment.
 *
 * The returned delta is an integer: the renderer stores integer offsets, so the
 * rounded write can never round a pixel back outside the frame.
 */
function containAxis(input: {
  readonly start: number
  readonly size: number
  readonly delta: number
  readonly canvas: number
}): AxisContain {
  const { start, size, delta, canvas } = input
  if (!finite(start) || !finite(size) || !finite(canvas) || !finite(delta)) return { delta: 0, clamped: true }
  if (size <= 0 || canvas <= 0) return { delta, clamped: false }
  const maxPos = canvas - size
  // Fits: [0, maxPos]. Oversized: [maxPos, 0] (still covering the canvas).
  const lo = Math.min(0, maxPos)
  const hi = Math.max(0, maxPos)
  const target = start + delta
  let next: number
  if (start < lo) {
    next = Math.min(start + Math.max(0, delta), hi)
  } else if (start > hi) {
    next = Math.max(start + Math.min(0, delta), lo)
  } else {
    next = Math.min(Math.max(target, lo), hi)
  }
  const raw = next - start
  const clamped = next !== target
  // Integers only (the stored offsets are integers). A shortened axis is
  // rounded INWARD so the rounded write cannot land half a pixel outside.
  const rounded = clamped ? (raw > 0 ? Math.floor(raw) : Math.ceil(raw)) : Math.round(raw)
  return { delta: rounded, clamped }
}

/**
 * Keep a proposed drag delta from moving the reported box (or title logo)
 * outside the poster.
 *
 * Bounds are the AUTHORITATIVE ones: the box the renderer reported for the
 * exact preview URL — the same box the handle is drawn on, so the guarantee is
 * "the outlined element stays fully inside the frame", both in the live
 * overlay and in the committed Transform values (same delta). The renderer
 * reports the visible body for the badge families it anchors by body
 * (`genre`, `rank`, `extra`) and the whole composed bitmap box for the layers
 * composed as bitmaps (`quality`, `separate`, `network`) and the title logo; a
 * body-reported badge can therefore still have its transparent drop-shadow
 * bleed clipped by the frame edge — the visible body is what is guaranteed.
 *
 * Locked axes (`fixedX`, where the renderer ignores X) are left untouched: no
 * clamp, no movement, no promise.
 */
export function containBadgeDragDelta(input: {
  readonly box: BadgeDragBox
  readonly canvasW: number
  readonly canvasH: number
  readonly delta: { readonly x: number; readonly y: number }
  readonly allowX?: boolean
}): BadgeDragContainResult {
  const { box, canvasW, canvasH, delta, allowX = true } = input
  const x = allowX
    ? containAxis({ start: box.left, size: box.w, delta: delta.x, canvas: canvasW })
    : { delta: finite(delta.x) ? delta.x : 0, clamped: false }
  const y = containAxis({ start: box.top, size: box.h, delta: delta.y, canvas: canvasH })
  return { delta: { x: x.delta, y: y.delta }, clampedX: x.clamped, clampedY: y.clamped }
}

/** Final delta of one drag gesture: snap first, then containment. */
export interface BadgeDragMove extends BadgeSnapResult {
  /** True when containment shortened an axis (a guide that no longer lands is dropped). */
  readonly clamped: boolean
}

/**
 * The single delta a drag applies: Photoshop-style snapping, then containment
 * inside the frame. Both the live overlay and the committed write call this, so
 * the drawn box and the stored Transform values are the same movement.
 *
 * A snap that would push the box past an edge is not honoured: containment runs
 * after it and the guide of a shortened axis is removed (never a line promising
 * an alignment that the clamp refused). `threshold <= 0` disables snapping and
 * leaves only containment (keyboard nudge).
 *
 * A LOCKED axis (`allowX: false`, the renderer ignores that offset) returns a
 * zero delta: the element cannot move there, so the drag never writes an
 * offset that changes nothing now but would silently re-apply if the style
 * later stopped being anchored (e.g. the full-width genre bar).
 */
export function resolveBadgeDragDelta(
  input: {
    readonly geometry: BadgeDragGeometry | null
    readonly family: BadgeDragFamily
    readonly box: BadgeDragBox
    /** Raw pointer delta in canvas px (already projected through the zoom). */
    readonly delta: { readonly x: number; readonly y: number }
    /** Snap radius in canvas px (<= 0 disables snapping). */
    readonly threshold: number
    readonly allowX?: boolean
    /** Dragged badge ITEM (excluded from its own snap targets). */
    readonly excludeItemId?: string
  },
): BadgeDragMove {
  const { geometry, box, allowX = true } = input
  const snapped = computeBadgeDragSnap(input)
  const allowed = (delta: { readonly x: number; readonly y: number }) =>
    allowX ? delta : { x: 0, y: delta.y }
  if (!geometry) return { ...snapped, delta: allowed(snapped.delta), clamped: false }
  const contained = containBadgeDragDelta({
    box,
    canvasW: geometry.canvasW,
    canvasH: geometry.canvasH,
    delta: snapped.delta,
    allowX,
  })
  const guides = snapped.guides.filter((guide) =>
    guide.axis === "x" ? !contained.clampedX : !contained.clampedY,
  )
  return {
    delta: allowed(contained.delta),
    guides,
    clamped: contained.clampedX || contained.clampedY,
  }
}

/**
 * Hold a just-committed drag visible while the server render for the new URL is
 * still in flight: the delta applies only to the family that was dragged and
 * only while the geometry still belongs to the pre-drag URL. Pure: the caller
 * expires the pending state (timer effect), so no clock is read while
 * rendering.
 */
export function pendingDragDelta(input: {
  readonly pending: {
    readonly family: BadgeDragFamily
    readonly dx: number
    readonly dy: number
    /** URL the geometry was fetched for when the drag started. */
    readonly baseUrl: string
  } | null
  readonly family: BadgeDragFamily
  readonly geometryUrl: string
}): { x: number; y: number } {
  const { pending, family, geometryUrl } = input
  if (!pending) return { x: 0, y: 0 }
  if (pending.family !== family) return { x: 0, y: 0 }
  if (geometryUrl !== pending.baseUrl) return { x: 0, y: 0 }
  return { x: pending.dx, y: pending.dy }
}

/**
 * Same hold for a just-committed RESIZE: the drawn box is scaled by the ratio
 * that was written until the render for that scale reports the new box. `1` =
 * nothing pending (or another family / another URL).
 */
export function pendingResizeRatio(input: {
  readonly pending: {
    readonly family: BadgeDragFamily
    readonly ratio: number
    readonly baseUrl: string
  } | null
  readonly family: BadgeDragFamily
  readonly geometryUrl: string
}): number {
  const { pending, family, geometryUrl } = input
  if (!pending) return 1
  if (pending.family !== family) return 1
  if (geometryUrl !== pending.baseUrl) return 1
  if (!finite(pending.ratio) || pending.ratio <= 0) return 1
  return pending.ratio
}

/* ------------------------------------------------------------------ */
/* Multi-selection drag (Windows-like set move)                       */
/* ------------------------------------------------------------------ */

/** One member of a dragged SELECTION: its reported box and owning family. */
export interface BadgeDragSelectionMember {
  readonly box: BadgeDragBox
  readonly family: BadgeDragFamily
  /** True when the renderer ignores this member's X offset (anchored style). */
  readonly fixedX?: boolean
}

/** Union box of the members that actually move on the axis (`null` = none). */
function unionBox(boxes: readonly BadgeDragBox[]): BadgeDragBox | null {
  if (boxes.length === 0) return null
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const box of boxes) {
    if (!finite(box.left) || !finite(box.top) || !finite(box.w) || !finite(box.h)) continue
    left = Math.min(left, box.left)
    top = Math.min(top, box.top)
    right = Math.max(right, box.left + box.w)
    bottom = Math.max(bottom, box.top + box.h)
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  return { left, top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }
}

/** Travel of ONE box on one axis, with the single-box containment contract. */
function axisTravel(input: {
  readonly start: number
  readonly size: number
  readonly canvas: number
}): { readonly min: number; readonly max: number } {
  const { start, size, canvas } = input
  const maxPos = canvas - size
  const lo = Math.min(0, maxPos)
  const hi = Math.max(0, maxPos)
  // Already outside: moving further out is refused, moving back in is free.
  if (start < lo) return { min: 0, max: hi - start }
  if (start > hi) return { min: lo - start, max: 0 }
  return { min: lo - start, max: hi - start }
}

/**
 * One shared delta for a whole SELECTION.
 *
 * - Snapping uses the UNION box of the moved members (the set behaves like one
 *   rectangle) and targets every reported box OUTSIDE the set, so a set drag
 *   aligns to its neighbours and to the poster centre like a single element.
 * - Containment is the INTERSECTION of every member's own travel: no member
 *   may leave the poster frame, so the shared delta is clamped to the strictest
 *   bound. `fixedX` members are excluded from the X bounds exactly like a
 *   single locked drag (the renderer ignores their X offset, so it can neither
 *   limit nor be promised movement).
 * - The returned delta is an integer (rounded inward when clamped), the same
 *   value drawn by the overlay and stored by every member.
 */
export function resolveBadgeSelectionDragDelta(input: {
  readonly geometry: BadgeDragGeometry | null
  readonly members: readonly BadgeDragSelectionMember[]
  /** Raw pointer delta in canvas px (already projected through the zoom). */
  readonly delta: { readonly x: number; readonly y: number }
  /** Snap radius in canvas px (<= 0 disables snapping). */
  readonly threshold: number
  /** Selected ITEM identities, excluded from their own snap targets. */
  readonly excludeItemIds?: readonly string[]
}): BadgeDragMove {
  const { geometry, members, delta, threshold } = input
  const excludeItemIds = input.excludeItemIds ?? []
  const xMembers = members.filter((m) => m.fixedX !== true)
  const xUnion = unionBox(xMembers.map((m) => m.box))
  const yUnion = unionBox(members.map((m) => m.box))
  if (!geometry || !xUnion || !yUnion) {
    return {
      delta: { x: Math.round(delta.x) || 0, y: Math.round(delta.y) || 0 },
      guides: [],
      clamped: false,
    }
  }
  const excludeFamilies = [...new Set(members.map((m) => m.family))]
  const xSnap =
    xMembers.length > 0
      ? snapAxis(
          { start: xUnion.left, size: xUnion.w, delta: delta.x, threshold, axis: "x" },
          snapTargetsFor(geometry, excludeFamilies, "x", excludeItemIds),
        )
      : { delta: 0, guide: null }
  const ySnap = snapAxis(
    { start: yUnion.top, size: yUnion.h, delta: delta.y, threshold, axis: "y" },
    snapTargetsFor(geometry, excludeFamilies, "y", excludeItemIds),
  )

  // Shared travel: the intersection over every member (strictest bound wins).
  let xMin = Number.NEGATIVE_INFINITY
  let xMax = Number.POSITIVE_INFINITY
  for (const member of xMembers) {
    const travel = axisTravel({ start: member.box.left, size: member.box.w, canvas: geometry.canvasW })
    xMin = Math.max(xMin, travel.min)
    xMax = Math.min(xMax, travel.max)
  }
  let yMin = Number.NEGATIVE_INFINITY
  let yMax = Number.POSITIVE_INFINITY
  for (const member of members) {
    const travel = axisTravel({ start: member.box.top, size: member.box.h, canvas: geometry.canvasH })
    yMin = Math.max(yMin, travel.min)
    yMax = Math.min(yMax, travel.max)
  }
  const x = clampSharedAxis({ delta: xSnap.delta, min: xMin, max: xMax })
  const y = clampSharedAxis({ delta: ySnap.delta, min: yMin, max: yMax })
  const clamped = x.clamped || y.clamped
  const guides: BadgeSnapGuide[] = []
  if (xSnap.guide && !x.clamped) guides.push(xSnap.guide)
  if (ySnap.guide && !y.clamped) guides.push(ySnap.guide)
  return { delta: { x: x.delta, y: y.delta }, guides, clamped }
}

function clampSharedAxis(input: {
  readonly delta: number
  readonly min: number
  readonly max: number
}): { readonly delta: number; readonly clamped: boolean } {
  const { delta, min, max } = input
  if (!finite(delta)) return { delta: 0, clamped: true }
  const bounded = Math.min(Math.max(delta, min), max)
  if (!finite(bounded)) return { delta: Math.round(delta), clamped: false }
  const clamped = bounded !== delta
  // Integers, rounded INWARD when clamped so the rounded write cannot land
  // half a pixel outside the strictest member bound.
  const rounded = clamped ? (bounded > delta ? Math.ceil(bounded) : Math.floor(bounded)) : Math.round(bounded)
  return { delta: rounded, clamped }
}
