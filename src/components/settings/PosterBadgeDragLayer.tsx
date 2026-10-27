"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import type { BadgeFamilyMove, BadgeGeometryFamily, BadgeItemMove } from "@/components/settings/useShapeDefaults"
import { useBadgeDragGeometry } from "@/lib/useBadgeDragGeometry"
import { FRESH_TITLE_LOGO_MAX_SCALE, STANDARD_TITLE_LOGO_MAX_SCALE } from "@/lib/logo-selection"
import { VIDEO_FORMAT_OPTIONS } from "@/lib/av-specs"
import {
  badgeResetApplies,
  badgeScaleLimits,
  canvasToScreenDelta,
  deriveEffectiveLogoScale,
  resolveBadgeDragDelta,
  resolveBadgeSelectionDragDelta,
  resolveBadgeDragWrite,
  resolveBadgeResizeScale,
  screenToCanvasDelta,
  snapThresholdCanvas,
  stepBadgeResizeScale,
  topBadgeLayout,
  type BadgeDragFamily,
  type BadgeDragGeometry,
  type BadgeDragItem,
  type BadgeDragBox,
  type BadgeDragSelectionMember,
  type BadgeSnapGuide,
  type BadgeProfileEffective,
  type BadgeProfileExplicit,
} from "@/lib/badge-drag-geometry"
import {
  BADGE_ITEM_QUALITY_COMBO,
  badgeItemLabelKind,
  badgeItemTransform,
  moveBadgeItemTransform,
  resizeBadgeItemTransform,
  type BadgeItemTransformMap,
} from "@/lib/badge-item-transforms"

/**
 * Direct element editing over the server-rendered defaults preview.
 *
 * Mounted ONLY in the enlarged editor (never in the small preview). The
 * handles are the boxes the renderer reported for the exact preview URL
 * (`debug=1&netgeo=1`): no client layout, no guessed anchors.
 *
 * Two levels of control, sharing the same reported geometry, and only ONE of
 * them is hit-testable at a time (the editor toolbar picks the level):
 *  - GROUP (family) handles: the existing per-family transforms (move the whole
 *    quality stack, the whole separate-rating column, the logo, …);
 *  - ITEM handles: one handle per separately composited badge (a single rating
 *    pill, a single quality/AV mark), keyed by STABLE identity
 *    (`badge-item-transforms`), never by array index. Moving/resizing an item
 *    writes ONLY that item's correction: the group transforms and the automatic
 *    layout stay untouched, and an item that disappears (no data, merged
 *    Dolby combo, suppressed HDR) simply loses its correction instead of
 *    handing it to its neighbour.
 *
 * Because the two levels never paint their hitboxes together, a family handle
 * is always reachable even when its items cover most of the reported box — the
 * overlap that made the group impossible to grab is a mode problem, not a
 * z-order problem.
 *
 * SELECTION (Windows-like):
 *  - plain click selects one target (and starts a move);
 *  - Ctrl/Cmd-click adds or removes a target from the selection;
 *  - dragging on the empty poster background (the backdrop) draws a marquee and
 *    selects every target of the ACTIVE level it touches (Ctrl/Cmd adds the
 *    hits to the current selection);
 *  - a drag of any selected target moves the WHOLE selection by one shared
 *    delta, clamped to every selected box (no member leaves the frame) and
 *    snapped from the union box; the group tree is not mixed into itself:
 *    normalisation drops an item whose own family is also selected, so a
 *    parent and its children can never translate twice.
 *
 * Multi writes are ATOMIC: one state write per gesture (`applyFamilyMoves` /
 * `applyItemMoves`), so React batching cannot keep only the last member.
 *
 * Moving writes the same Transform X/Y values the sliders write (group) or the
 * item correction (item) and resizing writes the same scale, so the preview and
 * the numeric controls stay in sync in both directions.
 *
 * Drag mode is a pointer-only switch that lives in the enlarged editor toolbar
 * and is ON unless the user turned it off (an inert first-run pointer is
 * indistinguishable from a broken feature). OFF still allows selecting an
 * element and resizing it from its corners (explicit affordances); keyboard
 * nudging stays available in both modes.
 *
 * While dragging, the box snaps to the poster centre and to the other rendered
 * badges/items (edge/centre alignment, Photoshop-like); a multi-selection snaps
 * from its union box. The guides are drawn in this overlay only: they never
 * enter the poster render. A drag can never move the reported box outside the
 * poster frame: the delta is contained against the reported box and the canvas
 * (after snapping) before it is drawn AND before it is written, so the overlay
 * and the stored values are the same movement at any zoom
 * (`resolveBadgeDragDelta`, `resolveBadgeSelectionDragDelta`).
 *
 * Double-click resets the SELECTED targets only: a group handle restores that
 * family's canonical position+scale (active ranked/fallback layout) AND drops
 * that family's per-item corrections (they are deltas on top of the family
 * layout, so they would otherwise stay off-layout), an item handle removes that
 * item's correction. No other family, item or layout is touched.
 *
 * REJOIN is the recovery control of the same selection, deliberately separate
 * from any reset: it deletes the selected badges' own corrections and NOTHING
 * else (never restores the applied-preset snapshot, never touches the group's
 * position/scale or another family), so a stale nudge captured in a preset
 * reference can never come back through it.
 *
 * KNOWN LIMIT (disclosed, not claimed working): in the Fresh and Card layouts
 * the separate-ratings values are BAKED as text rows inside a single composed
 * block (meta block / metadata band), so the renderer reports no individual
 * rating items there and this overlay paints no per-rating handle. On those
 * layouts the rating family can only be moved/resized/reset as a GROUP; the
 * quality/age/A/V stack is composited separately everywhere, so its item
 * handles work in Standard, Fresh and Card.
 */

const FAMILY_LABEL_KEY: Record<BadgeDragFamily, string> = {
  rank: "ui.rankFamily",
  extra: "ui.sash_extra",
  genre: "ui.genreRatingBadge",
  quality: "ui.badgeQuality",
  separate: "ui.separateRatings",
  network: "ui.networkLogo",
  logo: "ui.logoSection",
}

/** Paint order: wide families first, the top slot last. */
const FAMILY_ORDER: readonly BadgeDragFamily[] = ["logo", "separate", "genre", "quality", "network", "rank", "extra"]

const PENDING_TTL_MS = 4000

/** Corner resize handles, in the order they are painted. */
type ResizeCorner = "nw" | "ne" | "sw" | "se"
const RESIZE_CORNERS: readonly ResizeCorner[] = ["nw", "ne", "sw", "se"]
const RESIZE_HANDLE_PX = 18

/**
 * One editable target: a whole GROUP (family) or a single ITEM (stable id).
 * Both expose their owning family so snapping/limits reuse the group contract.
 */
type DragTarget =
  | { readonly kind: "family"; readonly family: BadgeDragFamily }
  | { readonly kind: "item"; readonly id: string; readonly family: "quality" | "separate" }

/** Which kind of target the overlay hit-tests (toolbar switch). */
export type BadgeDragTargetLevel = "group" | "item"

function targetKey(target: DragTarget): string {
  return target.kind === "family" ? `f:${target.family}` : `i:${target.id}`
}

function sameTarget(a: DragTarget | null | undefined, b: DragTarget): boolean {
  if (!a) return false
  return targetKey(a) === targetKey(b)
}

/**
 * Normalise a selection: no duplicates, and never a family together with one of
 * its own items (the item is already covered by the family delta, so keeping
 * both would translate that badge twice).
 */
function normalizeTargets(targets: readonly DragTarget[]): readonly DragTarget[] {
  const seen = new Set<string>()
  const families = new Set<BadgeDragFamily>()
  for (const target of targets) {
    if (target.kind === "family") families.add(target.family)
  }
  const out: DragTarget[] = []
  for (const target of targets) {
    const key = targetKey(target)
    if (seen.has(key)) continue
    if (target.kind === "item" && families.has(target.family)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

interface DragState {
  /** Handle that received the press (double-click identity). */
  readonly target: DragTarget
  /** Normalised selection that this gesture moves (may be several targets). */
  readonly targets: readonly DragTarget[]
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  /** Displayed poster width at gesture start (screen px), for the snap radius. */
  readonly displayWidth: number
  /** Second press of a double-click: never commit the competing drag. */
  readonly maybeDouble: boolean
  /** Ctrl/Cmd was held: this press only toggles the selection. */
  readonly additive: boolean
  dx: number
  dy: number
}

/** Marquee (rubber band) over the empty poster background, screen px. */
interface MarqueeState {
  readonly pointerId: number
  readonly additive: boolean
  /** Selection before the marquee started (additive marquee extends it). */
  readonly base: readonly DragTarget[]
  readonly x0: number
  readonly y0: number
  x1: number
  y1: number
}

interface ResizeState {
  readonly target: DragTarget
  readonly pointerId: number
  /** Pointer start vector from the box centre (canvas px): the ratio baseline. */
  readonly start: { readonly x: number; readonly y: number }
  /** Box centre at gesture start (screen px): the overlay scales about it. */
  readonly center: { readonly x: number; readonly y: number }
  /** Displayed box size at gesture start, to project screen px -> canvas px. */
  readonly screenW: number
  readonly screenH: number
  readonly canvasW: number
  readonly canvasH: number
  /** Box the renderer reported for the displayed poster (canvas px). */
  readonly box: BadgeDragBox
  /** Scale the renderer is using for that box (effective value / derived). */
  readonly startScale: number
  /** Title-logo UI cap of the active layout (badge families ignore it). */
  readonly titleMax: number | null
  /** Clamped proposal, drawn live and written on release. */
  scale: number
}

interface PendingState {
  /** `targetKey` of every target the committed gesture moved. */
  readonly keys: readonly string[]
  /** Committed delta in CANVAS px. */
  readonly dx: number
  readonly dy: number
  /** Committed resize ratio (1 for a pure move). */
  readonly ratio: number
  /** Displayed poster width when committed, to re-project into screen px. */
  readonly displayWidth: number
  readonly baseUrl: string
  readonly expiresAt: number
}

const NEUTRAL_EXPLICIT: BadgeProfileExplicit = { scale: null, offsetX: null, offsetY: null }

export function PosterBadgeDragLayer({
  previewUrl,
  shape,
  enabled,
  dragMode = true,
  targetLevel = "group",
  "data-testid": testId,
}: {
  /** Exact URL of the poster currently displayed (already debounced). */
  previewUrl: string
  /** Effective shape of the displayed poster. */
  shape: "poster" | "landscape"
  /** Editor mounted (enlarged editor): handles, selection and resize. */
  enabled: boolean
  /** Pointer move enabled (the editor's drag-mode toggle). Resize ignores it. */
  dragMode?: boolean
  /**
   * Which target kind the overlay paints/hit-tests: whole groups (families) or
   * single badges (items). Only ONE is hit-testable at a time, so overlapping
   * boxes can never make a family unreachable.
   */
  targetLevel?: BadgeDragTargetLevel
  "data-testid"?: string
}) {
  const { t } = useT()
  const ed = usePosterEditor()
  const defaults = useShapeBadgeGeometryDefaults(shape)
  const { geometry, geometryUrl } = useBadgeDragGeometry(previewUrl, enabled)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lastGeometryRef = useRef<BadgeDragGeometry | null>(null)
  // Last completed gesture: a second press inside the double-click window
  // starts a reset gesture, never a competing commit.
  const lastGestureRef = useRef<{ key: string; at: number } | null>(null)
  // True while a pointer press owns the gesture: focus events fired by that
  // press must not replace a multi-selection being built with Ctrl/Cmd.
  const pressRef = useRef(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [resize, setResize] = useState<ResizeState | null>(null)
  const [selected, setSelected] = useState<readonly DragTarget[]>([])
  const [marquee, setMarquee] = useState<MarqueeState | null>(null)
  const [pending, setPending] = useState<PendingState | null>(null)

  if (geometry) lastGeometryRef.current = geometry
  // While the next render lands, the previous boxes are still the last
  // authority we have: they only draw handles, they never drive values.
  const shown = geometry ?? lastGeometryRef.current
  const isLandscape = shape === "landscape"

  // Title-logo UI cap of the ACTIVE layout: Standard keeps the historic 100,
  // Fresh opens 200 (same constants as the Transform slider).
  const titleMax =
    ((isLandscape ? ed.landscape.posterLayout : undefined) ?? ed.defaultPosterLayout) === "fresh"
      ? FRESH_TITLE_LOGO_MAX_SCALE
      : STANDARD_TITLE_LOGO_MAX_SCALE

  // Per-item corrections of the ACTIVE shape (same value the preview URL and
  // the mapping carry). Empty = every item on its automatic slot.
  const itemTransforms: BadgeItemTransformMap = defaults.itemTransforms

  const itemOf = useCallback(
    (target: DragTarget): BadgeDragItem | null =>
      target.kind === "item" ? (shown?.items.find((i) => i.id === target.id) ?? null) : null,
    [shown],
  )

  /** Reported box of a target (null = not composed in this render). */
  const boxOf = useCallback(
    (target: DragTarget): BadgeDragBox | null =>
      target.kind === "family" ? (shown?.boxes[target.family] ?? null) : (itemOf(target)?.box ?? null),
    [itemOf, shown],
  )

  /** Scale the renderer is effectively using for the reported box. */
  const effectiveScale = useCallback(
    (target: DragTarget, geometryForScale: BadgeDragGeometry | null): number => {
      if (target.kind === "item") {
        const stored = badgeItemTransform(itemTransforms, target.id)
        return stored ? stored.scale : 100
      }
      const family = target.family
      switch (family) {
        case "rank":
          return defaults.topBadgeScale
        case "extra":
          return defaults.extraBadgeScale
        case "genre":
          return defaults.genreBadgeScale
        case "quality":
          return defaults.qualityBadgeScale
        case "separate":
          return defaults.separateBadgeScale
        case "network":
          return defaults.networkLogoScale
        case "logo": {
          // Explicit value first (exactly the slider). Auto-fit has no numeric
          // slider value: the renderer's reported box is the only authority, so
          // the first ratio starts from the scale that box represents.
          if (defaults.logoScale != null) return defaults.logoScale
          const box = geometryForScale?.boxes.logo
          if (!box || !geometryForScale) return badgeScaleLimits("logo", { titleMax }).max
          return deriveEffectiveLogoScale({ box, canvasW: geometryForScale.canvasW, titleMax })
        }
      }
    },
    [defaults, itemTransforms, titleMax],
  )

  /**
   * The family profile the renderer is using for `family` (effective values) and
   * the explicit stored values that a write must materialize. Shared by the
   * single and multi moves: a selection move is N of these written at once.
   */
  const familyProfiles = useCallback(
    (family: BadgeDragFamily): { effective: BadgeProfileEffective; explicit: BadgeProfileExplicit } => {
      const effective: BadgeProfileEffective =
        family === "rank"
          ? {
              scale: defaults.topBadgeScale,
              offsetX: defaults.topBadgeOffsetX,
              offsetY: defaults.topBadgeOffsetY,
            }
          : family === "extra"
            ? {
                scale: defaults.extraBadgeScale,
                offsetX: defaults.extraBadgeOffsetX,
                offsetY: defaults.extraBadgeOffsetY,
              }
            : family === "genre"
              ? {
                  scale: defaults.genreBadgeScale,
                  offsetX: defaults.genreBadgeOffsetX,
                  offsetY: defaults.genreBadgeOffsetY,
                }
              : family === "quality"
                ? {
                    scale: defaults.qualityBadgeScale,
                    offsetX: defaults.qualityBadgeOffsetX,
                    offsetY: defaults.qualityBadgeOffsetY,
                  }
                : family === "separate"
                  ? {
                      scale: defaults.separateBadgeScale,
                      offsetX: defaults.separateBadgeOffsetX,
                      offsetY: defaults.separateBadgeOffsetY,
                    }
                  : family === "logo"
                    ? {
                        // Position only: the title-logo scale stays on its own
                        // control (null = auto-fit), never written by a drag.
                        scale: ed.defaultLogoScale,
                        offsetX: defaults.logoOffsetX,
                        offsetY: defaults.logoOffsetY,
                      }
                    : {
                        scale: defaults.networkLogoScale,
                        offsetX: defaults.networkLogoOffsetX,
                        offsetY: defaults.networkLogoOffsetY,
                      }
      const explicit: BadgeProfileExplicit =
        family === "extra"
          ? {
              scale: defaults.extraBadgeScaleExplicit,
              offsetX: defaults.extraBadgeOffsetXExplicit,
              offsetY: defaults.extraBadgeOffsetYExplicit,
            }
          : NEUTRAL_EXPLICIT
      return { effective, explicit }
    },
    [defaults, ed.defaultLogoScale],
  )

  /**
   * ONE writer for a whole gesture: every moved target is applied in a single
   * state update (one landscape patch / one item map). Writing them one by one
   * would let React batching keep only the last member of the selection.
   */
  const write = useCallback(
    (targets: readonly DragTarget[], delta: { x: number; y: number }) => {
      const kind = shown?.kind ?? null
      const familyMoves: BadgeFamilyMove[] = []
      const itemMoves: BadgeItemMove[] = []
      for (const target of targets) {
        if (target.kind === "item") {
          const current = badgeItemTransform(itemTransforms, target.id)
          // A move back onto the automatic slot REMOVES the correction (the
          // stored map is the single source: no stale offset survives).
          itemMoves.push({ id: target.id, transform: moveBadgeItemTransform(current, delta) })
          continue
        }
        const { effective, explicit } = familyProfiles(target.family)
        const next = resolveBadgeDragWrite({ family: target.family, kind, explicit, effective, delta })
        familyMoves.push({
          family: target.family as BadgeGeometryFamily,
          offsetX: next.offsetX,
          offsetY: next.offsetY,
          scale: next.scale,
        })
      }
      if (familyMoves.length > 0) defaults.applyFamilyMoves(familyMoves)
      if (itemMoves.length > 0) defaults.applyItemMoves(itemMoves)
    },
    [defaults, familyProfiles, itemTransforms, shown],
  )

  /** Resize write: the same scale the target's own control writes. */
  const writeScale = useCallback(
    (target: DragTarget, scale: number) => {
      if (target.kind === "item") {
        const current = badgeItemTransform(itemTransforms, target.id)
        // Neutral = removed, so shrinking a corrected item back to its
        // automatic size restores the automatic layout.
        defaults.applyItemMoves([{ id: target.id, transform: resizeBadgeItemTransform(current, scale) }])
        return
      }
      defaults.setFamilyScale(target.family, scale)
    },
    [defaults, itemTransforms],
  )

  /**
   * Single shared delta of a gesture over a target LIST: one target keeps the
   * historic family contract, several are clamped and snapped as a set.
   */
  const resolveMove = useCallback(
    (input: {
      targets: readonly DragTarget[]
      box: BadgeDragBox | null
      rawDelta: { x: number; y: number }
      displayWidth: number
    }): { delta: { x: number; y: number }; guides: readonly BadgeSnapGuide[] } | null => {
      const { targets, box, rawDelta, displayWidth } = input
      if (!shown || targets.length === 0) return null
      // A press without a movement is a CLICK: it selects (and may collapse a
      // multi-selection) but never snaps the element onto a neighbour. Magnet
      // snapping applies only once the pointer really moved, otherwise a click
      // would silently nudge the stored offset by up to the snap radius.
      if (Math.round(rawDelta.x) === 0 && Math.round(rawDelta.y) === 0) {
        return { delta: { x: 0, y: 0 }, guides: [] }
      }
      const threshold = snapThresholdCanvas(displayWidth, shown.canvasW)
      if (targets.length === 1) {
        const only = targets[0]
        if (!box) return null
        const move = resolveBadgeDragDelta({
          geometry: shown,
          family: only.family,
          box,
          delta: rawDelta,
          threshold,
          allowX: shown.fixedX[only.family] !== true,
          excludeItemId: only.kind === "item" ? only.id : undefined,
        })
        return { delta: move.delta, guides: move.guides }
      }
      const members: BadgeDragSelectionMember[] = []
      for (const target of targets) {
        const memberBox = boxOf(target)
        if (!memberBox) continue
        members.push({ box: memberBox, family: target.family, fixedX: shown.fixedX[target.family] === true })
      }
      if (members.length === 0) return null
      const move = resolveBadgeSelectionDragDelta({
        geometry: shown,
        members,
        delta: rawDelta,
        threshold,
        excludeItemIds: targets.flatMap((target) => (target.kind === "item" ? [target.id] : [])),
      })
      return { delta: move.delta, guides: move.guides }
    },
    [boxOf, shown],
  )

  const commit = useCallback(
    (state: DragState) => {
      const box = rootRef.current?.getBoundingClientRect()
      if (!box || !shown) return
      const raw = screenToCanvasDelta({
        dx: state.dx,
        dy: state.dy,
        displayWidth: box.width,
        canvasW: shown.canvasW,
      })
      const targets = state.targets
      const move = resolveMove({
        targets,
        box: boxOf(state.target),
        rawDelta: raw,
        displayWidth: box.width,
      })
      if (!move) return
      const delta = move.delta
      if (Math.round(delta.x) === 0 && Math.round(delta.y) === 0) return
      write(targets, delta)
      setPending({
        keys: targets.map(targetKey),
        dx: delta.x,
        dy: delta.y,
        ratio: 1,
        displayWidth: box.width,
        baseUrl: geometryUrl,
        expiresAt: Date.now() + PENDING_TTL_MS,
      })
    },
    [boxOf, geometryUrl, resolveMove, shown, write],
  )

  useEffect(() => {
    if (!pending) return
    if (geometryUrl !== pending.baseUrl) {
      setPending(null)
      return
    }
    if (Date.now() >= pending.expiresAt) {
      setPending(null)
      return
    }
    const timer = setTimeout(() => setPending(null), pending.expiresAt - Date.now())
    return () => clearTimeout(timer)
  }, [pending, geometryUrl])

  const handles = useMemo(() => {
    if (!shown) return []
    const out: { family: BadgeDragFamily; box: BadgeDragBox; xLocked: boolean }[] = []
    for (const family of FAMILY_ORDER) {
      const box = shown.boxes[family]
      if (!box) continue
      out.push({ family, box, xLocked: shown.fixedX[family] === true })
    }
    return out
  }, [shown])

  // Selection sanitising: a target that disappears from the render
  // (layout/style switch, missing data, merged Dolby combo) cannot stay
  // selected, and switching the target LEVEL drops a selection the new level
  // does not hit-test. Both keep the array identity when nothing changed (no
  // render loop).
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((target) => !!boxOf(target)).slice(0, 64)
      return next.length === prev.length ? prev : next
    })
  }, [shown, boxOf])

  useEffect(() => {
    setSelected((prev) => (prev.length === 0 ? prev : []))
  }, [targetLevel])

  /**
   * Double-click reset: canonical position AND scale for the SELECTED groups in
   * the active whole-poster layout (plus the per-item corrections those
   * families own), or removal of the selected items' corrections. Everything is
   * written in one update per kind; nothing else is touched.
   */
  const resetTargets = useCallback(
    (targets: readonly DragTarget[]) => {
      if (!shown) return
      const list = normalizeTargets(targets)
      const families = [...new Set(
        list.flatMap((target) =>
          target.kind === "family" && badgeResetApplies(target.family, shown.layout)
            ? [target.family as BadgeGeometryFamily]
            : [],
        ),
      )]
      const items = list.flatMap((target) => (target.kind === "item" ? [target.id] : []))
      if (families.length > 0) defaults.resetFamilies(families)
      if (items.length > 0) defaults.resetItems(items)
      if (families.length > 0 || items.length > 0) setPending(null)
    },
    [defaults, shown],
  )

  const isSelectedTarget = useCallback(
    (target: DragTarget) => selected.some((entry) => sameTarget(entry, target)),
    [selected],
  )

  /**
   * Explicit REJOIN of the SELECTED targets (recovery, never the preset-aware
   * reset): the whole quality group drops every stored quality correction
   * (hidden marks included, no dependency on the reported boxes) and a selected
   * single badge drops its own correction only. Group position/scale, the other
   * family and the applied-preset reference are untouched; the pending
   * optimistic overlay is dropped so it can never draw the removed delta on top
   * of the recomposed boxes.
   */
  const rejoinTargets = useCallback(
    (targets: readonly DragTarget[]) => {
      if (!shown) return
      const list = normalizeTargets(targets)
      const families = list.flatMap((target) =>
        target.kind === "family" && target.family === "quality" ? [target.family] : [],
      )
      const items = list.flatMap((target) => (target.kind === "item" ? [target.id] : []))
      if (families.length === 0 && items.length === 0) return
      defaults.rejoin({ families, items })
      setPending(null)
    },
    [defaults, shown],
  )

  /** Targets of the current selection this recovery control can act on. */
  const rejoinable = normalizeTargets(selected).filter((target) =>
    target.kind === "family" ? target.family === "quality" : true,
  )

  const onPointerDown = (target: DragTarget) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || !shown) return
    // Keep the gesture off the zoom target and the surrounding card.
    e.preventDefault()
    e.stopPropagation()
    pressRef.current = true
    const additive = e.metaKey || e.ctrlKey
    // Windows-like selection: Ctrl/Cmd toggles, a plain press on a member of a
    // multi-selection keeps the whole set (so it can be dragged together), a
    // plain press elsewhere selects only that target.
    let nextSelection: readonly DragTarget[]
    if (additive) {
      nextSelection = isSelectedTarget(target)
        ? selected.filter((entry) => !sameTarget(entry, target))
        : [...selected, target]
    } else if (isSelectedTarget(target)) {
      nextSelection = selected
    } else {
      nextSelection = [target]
    }
    nextSelection = normalizeTargets(nextSelection)
    setSelected(nextSelection)
    // Drag mode OFF: click still selects (so the corner handles are reachable)
    // but the body never moves with the pointer.
    if (!dragMode) return
    // Ctrl/Cmd toggling a target OFF never starts a move.
    if (!nextSelection.some((entry) => sameTarget(entry, target))) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const displayWidth = rootRef.current?.getBoundingClientRect().width ?? 0
    const key = targetKey(target)
    const last = lastGestureRef.current
    const maybeDouble = !!last && last.key === key && Date.now() - last.at < 350
    setDrag({
      target,
      targets: nextSelection,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      displayWidth,
      maybeDouble,
      additive,
      dx: 0,
      dy: 0,
    })
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    e.stopPropagation()
    setDrag({ ...drag, dx: e.clientX - drag.startX, dy: e.clientY - drag.startY })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pressRef.current = false
    if (!drag || e.pointerId !== drag.pointerId) return
    e.stopPropagation()
    const done = drag
    setDrag(null)
    lastGestureRef.current = { key: targetKey(done.target), at: Date.now() }
    // A double-click must not commit its own pointer drag: the second press
    // and release of the pair is a reset gesture, not a movement.
    const moved = Math.hypot(done.dx, done.dy)
    if (done.maybeDouble && moved < 4) return
    // Click without a move on a member of a multi-selection collapses the
    // selection onto that member (never on Ctrl/Cmd, which is a toggle). A
    // single-target press keeps the historic behaviour: the commit itself drops
    // a rounded zero delta, so a tiny nudge still writes what it asks for.
    if (moved < 3 && !done.additive && done.targets.length > 1) {
      setSelected([done.target])
      return
    }
    commit(done)
  }

  const onDoubleClick = (target: DragTarget) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    lastGestureRef.current = null
    // The gesture resets what is selected; a double-click outside the current
    // selection resets only that target.
    resetTargets(isSelectedTarget(target) ? selected : [target])
  }

  const onKeyDown = (target: DragTarget, xLocked: boolean) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!shown) return
    const step = e.shiftKey ? 10 : 1
    const delta = { x: 0, y: 0 }
    if (e.key === "ArrowLeft" && !xLocked) delta.x = -step
    else if (e.key === "ArrowRight" && !xLocked) delta.x = step
    else if (e.key === "ArrowUp") delta.y = -step
    else if (e.key === "ArrowDown") delta.y = step
    else return
    e.preventDefault()
    e.stopPropagation()
    // A selected target nudges the WHOLE selection (same shared, contained
    // delta as the pointer gesture); an unselected one nudges only itself.
    const targets = isSelectedTarget(target) ? selected : [target]
    // Same containment as a pointer drag (snapping off): one step can never
    // push a box past an edge either.
    const move = resolveMove({
      targets,
      box: boxOf(target),
      rawDelta: delta,
      displayWidth: 0,
    })
    if (!move || (move.delta.x === 0 && move.delta.y === 0)) return
    write(targets, move.delta)
  }

  /* ------------------------------------------------------------------ */
  /* Corner resize (aspect-preserving, ignores the drag-mode toggle)     */
  /* ------------------------------------------------------------------ */

  const onResizeDown = (target: DragTarget) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || !shown) return
    // Never a move gesture and never a dialog close: this press is a resize.
    e.preventDefault()
    e.stopPropagation()
    pressRef.current = false
    // Resize is a single-target gesture: a multi-selection collapses onto the
    // resized element.
    if (!(selected.length === 1 && isSelectedTarget(target))) setSelected([target])
    const box = boxOf(target)
    // Centre of the DRAWN element (the overlay box), not of the root: corner
    // handles are siblings of the element handle, so the parent rect is wrong.
    const drawnEl = rootRef.current?.querySelector<HTMLElement>(
      `[data-testid="${handleTestId(target)}"]`,
    )
    const rect = drawnEl?.getBoundingClientRect()
    const plot = rootRef.current?.getBoundingClientRect()
    if (!box || !rect || rect.width <= 0 || rect.height <= 0) return
    if (!plot || plot.width <= 0 || plot.height <= 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    const startScale = effectiveScale(target, shown)
    setResize({
      target,
      pointerId: e.pointerId,
      start: {
        // Poster scale (not the element size): screen px -> canvas px.
        x: (e.clientX - center.x) * (shown.canvasW / plot.width),
        y: (e.clientY - center.y) * (shown.canvasH / plot.height),
      },
      center,
      screenW: plot.width,
      screenH: plot.height,
      canvasW: shown.canvasW,
      canvasH: shown.canvasH,
      box,
      startScale,
      titleMax,
      scale: startScale,
    })
  }

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resize || e.pointerId !== resize.pointerId) return
    e.stopPropagation()
    const current = {
      x: (e.clientX - resize.center.x) * (resize.canvasW / resize.screenW),
      y: (e.clientY - resize.center.y) * (resize.canvasH / resize.screenH),
    }
    const next = resolveBadgeResizeScale({
      family: resize.target.family,
      startScale: resize.startScale,
      box: resize.box,
      start: resize.start,
      current,
      canvasW: resize.canvasW,
      canvasH: resize.canvasH,
      titleMax: resize.titleMax,
    })
    if (next.scale !== resize.scale) setResize({ ...resize, scale: next.scale })
  }

  const onResizeUp = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!resize || e.pointerId !== resize.pointerId) return
    e.stopPropagation()
    const done = resize
    setResize(null)
    // Cancel (or a no-op) never writes: the stored scale is what the pointer
    // actually asked for, never a half gesture.
    if (cancelled) return
    if (done.scale === done.startScale || done.startScale <= 0) return
    writeScale(done.target, done.scale)
    setPending({
      keys: [targetKey(done.target)],
      dx: 0,
      dy: 0,
      ratio: done.scale / done.startScale,
      displayWidth: 0,
      baseUrl: geometryUrl,
      expiresAt: Date.now() + PENDING_TTL_MS,
    })
  }

  const onResizeKeyDown = (target: DragTarget) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!shown) return
    const step = e.shiftKey ? 10 : 1
    let delta = 0
    if (e.key === "ArrowUp" || e.key === "ArrowRight") delta = step
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") delta = -step
    else return
    e.preventDefault()
    e.stopPropagation()
    const box = boxOf(target)
    if (!box) return
    const startScale = effectiveScale(target, shown)
    const next = stepBadgeResizeScale({
      family: target.family,
      startScale,
      step: delta,
      box,
      canvasW: shown.canvasW,
      canvasH: shown.canvasH,
      titleMax,
    })
    if (next.scale === startScale) return
    writeScale(target, next.scale)
  }

  /** Translation label of one target (group family or single item identity). */
  const labelOf = useCallback(
    (target: DragTarget): string => {
      if (target.kind === "family") return t(FAMILY_LABEL_KEY[target.family])
      const kind = badgeItemLabelKind(target.id)
      if (!kind) return target.id
      if (kind.kind === "rating") {
        const key = `ui.source_${kind.id}`
        const translated = t(key)
        return translated && translated !== key ? translated : kind.id.toUpperCase()
      }
      if (kind.kind === "tier") return t("ui.badgeQuality")
      if (kind.kind === "age") return t("ui.ageBadge")
      if (kind.kind === "combo") {
        return target.id === BADGE_ITEM_QUALITY_COMBO ? "Dolby Vision + Atmos" : t("ui.badgeQuality")
      }
      const format = kind.kind === "format" ? kind.format : undefined
      const option = format ? VIDEO_FORMAT_OPTIONS.find((o) => o.id === format) : undefined
      return option?.fullName ?? (format ? format.toUpperCase() : t("ui.badgeQuality"))
    },
    [t],
  )

  /** Every target of the ACTIVE level that the overlay can hit-test. */
  const targetsOfLevel = (): DragTarget[] => {
    if (!shown) return []
    if (targetLevel === "group") {
      return FAMILY_ORDER.flatMap((family) =>
        shown.boxes[family] ? [{ kind: "family", family } as DragTarget] : [],
      )
    }
    return shown.items.map((item) => ({ kind: "item", id: item.id, family: item.family }) as DragTarget)
  }

  /**
   * Focus must not replace a selection that a pointer press is building
   * (browsers focus the handle on mousedown, right before the Ctrl/Cmd toggle).
   * Keyboard focus still selects, so Tab + arrows + corners stay available.
   */
  const focusTarget = (target: DragTarget) => {
    if (pressRef.current) return
    setSelected((prev) => (prev.some((entry) => sameTarget(entry, target)) ? prev : [target]))
  }

  /* ------------------------------------------------------------------ */
  /* Marquee selection on the empty poster background                    */
  /* ------------------------------------------------------------------ */

  const onBackdropPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || !shown) return
    e.preventDefault()
    e.stopPropagation()
    pressRef.current = true
    const plot = rootRef.current?.getBoundingClientRect()
    if (!plot || plot.width <= 0 || plot.height <= 0) return
    const x = e.clientX - plot.left
    const y = e.clientY - plot.top
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setMarquee({
      pointerId: e.pointerId,
      additive: e.metaKey || e.ctrlKey,
      base: selected,
      x0: x,
      y0: y,
      x1: x,
      y1: y,
    })
  }

  const onBackdropPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!marquee || e.pointerId !== marquee.pointerId) return
    e.stopPropagation()
    const plot = rootRef.current?.getBoundingClientRect()
    if (!plot) return
    setMarquee({ ...marquee, x1: e.clientX - plot.left, y1: e.clientY - plot.top })
  }

  const onBackdropPointerUp = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    pressRef.current = false
    if (!marquee || e.pointerId !== marquee.pointerId) return
    e.stopPropagation()
    const done = marquee
    setMarquee(null)
    if (cancelled || !shown) return
    const plot = rootRef.current?.getBoundingClientRect()
    if (!plot || plot.width <= 0 || plot.height <= 0) return
    // A click on the empty poster clears the selection (a drag selects).
    if (Math.abs(done.x1 - done.x0) < 3 && Math.abs(done.y1 - done.y0) < 3) {
      if (!done.additive) setSelected((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const ratioX = shown.canvasW / plot.width
    const ratioY = shown.canvasH / plot.height
    const rect = {
      left: Math.min(done.x0, done.x1) * ratioX,
      right: Math.max(done.x0, done.x1) * ratioX,
      top: Math.min(done.y0, done.y1) * ratioY,
      bottom: Math.max(done.y0, done.y1) * ratioY,
    }
    const hits = targetsOfLevel().filter((target) => {
      const box = boxOf(target)
      if (!box) return false
      return box.left < rect.right && box.left + box.w > rect.left && box.top < rect.bottom && box.top + box.h > rect.top
    })
    setSelected(normalizeTargets(done.additive ? [...done.base, ...hits] : hits))
  }

  if (!enabled || !shown) return null

  const layout = topBadgeLayout(shown.layout, shown.kind)
  const marqueeRect = marquee
    ? {
        left: Math.min(marquee.x0, marquee.x1),
        top: Math.min(marquee.y0, marquee.y1),
        width: Math.abs(marquee.x1 - marquee.x0),
        height: Math.abs(marquee.y1 - marquee.y0),
      }
    : null
  const pendingFor = (target: DragTarget): PendingState | null => {
    if (!pending) return null
    if (!pending.keys.includes(targetKey(target))) return null
    if (geometryUrl !== pending.baseUrl) return null
    return pending
  }

  // Live snapping + containment for the dragged SET: the delta drawn, the
  // delta written on release. Guides come from the same computation, so what
  // you see aligned is what gets stored (a guide the clamp refused is dropped).
  const dragMove =
    drag && drag.displayWidth > 0
      ? resolveMove({
          targets: drag.targets,
          box: boxOf(drag.target),
          rawDelta: screenToCanvasDelta({
            dx: drag.dx,
            dy: drag.dy,
            displayWidth: drag.displayWidth,
            canvasW: shown.canvasW,
          }),
          displayWidth: drag.displayWidth,
        })
      : null
  const dragScreenDelta =
    drag && dragMove && drag.displayWidth > 0
      ? canvasToScreenDelta({
          dx: dragMove.delta.x,
          dy: dragMove.delta.y,
          displayWidth: drag.displayWidth,
          canvasW: shown.canvasW,
        })
      : null
  const guides: readonly BadgeSnapGuide[] = dragMove?.guides ?? []
  const dragCenterGuides = !!drag && dragMode
  /** A target currently moved by the live gesture (whole selection). */
  const isDragMember = (target: DragTarget): boolean =>
    !!drag && drag.targets.some((entry) => sameTarget(entry, target))

  /**
   * Drawn geometry of one target box: the reported box, moved by the live or
   * pending drag delta and scaled by the live/pending resize ratio about its
   * own centre. Editor-only projection of the SAME numbers that are written,
   * never a second layout.
   */
  const drawnBoxFor = (box: BadgeDragBox, target: DragTarget, dragging: boolean, resizing: boolean) => {
    const isDragging = dragging
    const optimistic = pendingFor(target)
    const pendingScreen =
      optimistic && optimistic.displayWidth > 0
        ? canvasToScreenDelta({
            dx: optimistic.dx,
            dy: optimistic.dy,
            displayWidth: optimistic.displayWidth,
            canvasW: shown.canvasW,
          })
        : { x: optimistic?.dx ?? 0, y: optimistic?.dy ?? 0 }
    const dx = isDragging && dragScreenDelta ? dragScreenDelta.x : pendingScreen.x
    const dy = isDragging && dragScreenDelta ? dragScreenDelta.y : pendingScreen.y
    const ratio =
      resizing && resize && resize.startScale > 0
        ? resize.scale / resize.startScale
        : optimistic && optimistic.ratio > 0
          ? optimistic.ratio
          : 1
    const w = box.w * ratio
    const h = box.h * ratio
    const left = box.left - (w - box.w) / 2
    const top = box.top - (h - box.h) / 2
    return {
      left: `calc(${(left / shown.canvasW) * 100}% + ${dx}px)`,
      top: `calc(${(top / shown.canvasH) * 100}% + ${dy}px)`,
      width: `${(w / shown.canvasW) * 100}%`,
      height: `${(h / shown.canvasH) * 100}%`,
      leftPct: (left / shown.canvasW) * 100,
      topPct: (top / shown.canvasH) * 100,
      wPct: (w / shown.canvasW) * 100,
      hPct: (h / shown.canvasH) * 100,
      dx,
      dy,
      ratio,
    }
  }

  const drawnBox = (target: DragTarget) => {
    const box = boxOf(target)
    if (!box) return null
    return drawnBoxFor(box, target, isDragMember(target), sameTarget(resize?.target, target))
  }

  const resizeCorners = (target: DragTarget) => {
    const draw = drawnBox(target)
    if (!draw) return null
    const label = labelOf(target)
    return RESIZE_CORNERS.map((corner) => {
      const xPct = corner === "nw" || corner === "sw" ? draw.leftPct : draw.leftPct + draw.wPct
      const yPct = corner === "nw" || corner === "ne" ? draw.topPct : draw.topPct + draw.hPct
      return (
        <div
          key={`${targetKey(target)}-${corner}`}
          role="button"
          tabIndex={0}
          aria-label={t("ui.badgeResizeCorner", { family: label })}
          title={t("ui.badgeResizeCorner", { family: label })}
          data-testid={`badge-resize-handle-${targetKey(target).slice(2)}-${corner}`}
          data-corner={corner}
          onPointerDown={onResizeDown(target)}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={(e) => onResizeUp(e, true)}
          onKeyDown={onResizeKeyDown(target)}
          className={`absolute pointer-events-auto touch-none select-none rounded-sm border border-white bg-accent-orange shadow-md ${
            corner === "nw" || corner === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize"
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
          style={{
            left: `calc(${xPct}% + ${draw.dx}px)`,
            top: `calc(${yPct}% + ${draw.dy}px)`,
            width: RESIZE_HANDLE_PX,
            height: RESIZE_HANDLE_PX,
            transform: "translate(-50%, -50%)",
          }}
        />
      )
    })
  }

  return (
    <div
      ref={rootRef}
      data-testid={testId ?? "badge-drag-layer"}
      data-badge-drag="on"
      data-drag-mode={dragMode ? "on" : "off"}
      data-kind={shown.kind ?? "none"}
      data-layout={shown.layout ?? "unknown"}
      data-item-count={shown.items.length}
      className="absolute inset-0 z-10 pointer-events-none"
    >
      {/* Empty poster areas clear the selection (never closes the dialog). */}
      <div
        data-testid="badge-drag-backdrop"
        aria-hidden="true"
        className="absolute inset-0 pointer-events-auto"
        onPointerDown={onBackdropPointerDown}
        onPointerMove={onBackdropPointerMove}
        onPointerUp={onBackdropPointerUp}
        onPointerCancel={(e) => onBackdropPointerUp(e, true)}
      />
      {/* Editor-only recovery toolbar of the current selection: a real button
          (keyboard reachable, labelled) because the transform panel is not
          available here. It only DELETES the selected badges' own corrections. */}
      {rejoinable.length > 0 && (
        <div
          data-testid="badge-drag-rejoin-bar"
          className="absolute left-2 top-2 z-20 flex items-center gap-1 pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label={rejoinable.some((target) => target.kind === "family") ? t("ui.badgeGroupRejoin") : t("ui.badgeItemRejoin")}
            title={t("ui.badgeRejoinHint")}
            data-testid="badge-drag-rejoin"
            onClick={() => rejoinTargets(rejoinable)}
            className="min-h-[28px] rounded-md border border-sky-300/60 bg-black/70 px-2 text-[11px] font-semibold text-sky-100 backdrop-blur-sm transition-colors hover:border-sky-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 cursor-pointer"
          >
            {rejoinable.some((target) => target.kind === "family") ? t("ui.badgeGroupRejoin") : t("ui.badgeItemRejoin")}
          </button>
        </div>
      )}
      {/* Marquee (rubber band) of the current selection gesture: editor-only,
          drawn in screen px over the empty poster background. */}
      {marqueeRect && (
        <div
          data-testid="badge-drag-marquee"
          aria-hidden="true"
          className="absolute border border-sky-300/80 bg-sky-300/10 pointer-events-none"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}
      {/* Editor-only alignment guides: the poster centre while dragging, plus a
          solid line on every axis the box snapped to. Never rendered into the
          poster itself. */}
      {dragCenterGuides && (
        <>
          <div
            data-testid="badge-drag-center-guide-x"
            aria-hidden="true"
            className="absolute top-0 bottom-0 w-px bg-white/25"
            style={{ left: "50%" }}
          />
          <div
            data-testid="badge-drag-center-guide-y"
            aria-hidden="true"
            className="absolute left-0 right-0 h-px bg-white/25"
            style={{ top: "50%" }}
          />
        </>
      )}
      {guides.map((guide) =>
        guide.axis === "x" ? (
          <div
            key="guide-x"
            data-testid="badge-drag-guide-x"
            data-center={guide.center ? "true" : undefined}
            aria-hidden="true"
            className={`absolute top-0 bottom-0 w-px ${guide.center ? "bg-accent-orange/90" : "bg-white/80"}`}
            style={{ left: `${(guide.pos / shown.canvasW) * 100}%` }}
          />
        ) : (
          <div
            key="guide-y"
            data-testid="badge-drag-guide-y"
            data-center={guide.center ? "true" : undefined}
            aria-hidden="true"
            className={`absolute left-0 right-0 h-px ${guide.center ? "bg-accent-orange/90" : "bg-white/80"}`}
            style={{ top: `${(guide.pos / shown.canvasH) * 100}%` }}
          />
        ),
      )}
      {targetLevel === "group" && handles.map(({ family, xLocked }) => {
        const target: DragTarget = { kind: "family", family }
        const dragging = isDragMember(target)
        const resizing = sameTarget(resize?.target ?? null, target)
        const draw = drawnBox(target)
        if (!draw) return null
        const isSelected = isSelectedTarget(target)
        const isTopSlot = family === "rank" || family === "extra"
        const label =
          isTopSlot && layout
            ? `${t(FAMILY_LABEL_KEY[family])} · ${t(layout === "ranked" ? "ui.badgeDragRanked" : "ui.badgeDragFallback")}`
            : t(FAMILY_LABEL_KEY[family])
        return (
          <div
            key={`family-${family}`}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={isSelected}
            title={`${label} — ${t("ui.badgeDragHint")} — ${t("ui.badgeResizeHint")}`}
            data-testid={`badge-drag-handle-${family}`}
            data-kind={isTopSlot ? (layout ?? "") : ""}
            data-x-locked={xLocked ? "true" : undefined}
            data-selected={isSelected ? "true" : undefined}
            onPointerDown={onPointerDown(target)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick(target)}
            onKeyDown={onKeyDown(target, xLocked)}
            onFocus={() => focusTarget(target)}
            className={`absolute pointer-events-auto touch-none select-none rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange/80 ${
              dragging || resizing
                ? "border-accent-orange bg-accent-orange/20 cursor-grabbing"
                : isSelected
                  ? "border-accent-orange bg-accent-orange/10"
                  : `border-dashed border-white/35 bg-white/5 hover:border-accent-orange/70 hover:bg-accent-orange/10 ${dragMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`
            }`}
            style={{
              left: draw.left,
              top: draw.top,
              width: draw.width,
              height: draw.height,
              // Keep a usable hit target while staying anchored to the box.
              minWidth: 14,
              minHeight: 14,
            }}
          />
        )
      })}
      {/* ITEM handles: one per separately composited badge, on the box the
          renderer reported for it. An item with a stored correction is marked
          (accent border) so tuned items are visible at a glance. */}
      {targetLevel === "item" && shown.items.map((item) => {
        const target: DragTarget = { kind: "item", id: item.id, family: item.family }
        const dragging = isDragMember(target)
        const resizing = sameTarget(resize?.target ?? null, target)
        const draw = drawnBoxFor(item.box, target, dragging, resizing)
        const isSelected = isSelectedTarget(target)
        const label = labelOf(target)
        return (
          <div
            key={`item-${item.id}`}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={isSelected}
            title={`${label} — ${t("ui.badgeItemHint")}`}
            data-testid={`badge-item-handle-${item.id}`}
            data-item-family={item.family}
            data-custom={item.custom ? "true" : undefined}
            data-selected={isSelected ? "true" : undefined}
            onPointerDown={onPointerDown(target)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick(target)}
            onKeyDown={onKeyDown(target, false)}
            onFocus={() => focusTarget(target)}
            className={`absolute pointer-events-auto touch-none select-none rounded-[4px] border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 ${
              dragging || resizing
                ? "border-sky-300 bg-sky-300/25 cursor-grabbing"
                : isSelected
                  ? "border-sky-300 bg-sky-300/15"
                  : `border-dotted ${item.custom ? "border-sky-300/90" : "border-white/30"} bg-transparent hover:border-sky-300/80 hover:bg-sky-300/10 ${dragMode ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`
            }`}
            style={{
              left: draw.left,
              top: draw.top,
              width: draw.width,
              height: draw.height,
              minWidth: 10,
              minHeight: 10,
            }}
          />
        )
      })}
      {/* Corner resize handles of the SINGLE selected target only (a
          multi-selection is a move gesture): explicit affordances (they work
          with drag mode off too), aspect-preserving and clamped to the family
          limits + the frame. */}
      {selected.length === 1 && resizeCorners(selected[0])}
    </div>
  )
}

/** testid of the element handle of a target (used to find its drawn box). */
function handleTestId(target: DragTarget): string {
  return target.kind === "family" ? `badge-drag-handle-${target.family}` : `badge-item-handle-${target.id}`
}
