"use client"

import { useCallback, useEffect, useRef } from "react"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type {
  BadgeDragGeometryAdapter,
  BadgeFamilyMove,
  BadgeGeometryFamily,
  BadgeItemMove,
} from "@/lib/badge-drag-adapter"
import {
  parseBadgeItemTransforms,
  rejoinBadgeItems,
  serializeBadgeItemTransforms,
  withBadgeItemTransform,
  withoutBadgeItemFamily,
  withoutBadgeItemTransform,
} from "@/lib/badge-item-transforms"
import { resolveSeparateBadgeScaleFallback } from "@/lib/badge-styles"
import { resolveNetworkShapeView } from "@/lib/network-follow"

/**
 * Direct badge manipulation over the OPEN title's preview.
 *
 * Same interaction contract as the global settings editor, different OWNER:
 * every read comes from the per-title live state (the values the preview URL,
 * the numeric Transform controls and the Save payload already share) and every
 * write goes through the per-title setters of the editor context. Therefore:
 *
 * - a drag/resize/reset here is a DRAFT of THIS title and THIS shape; nothing
 *   reaches a global default, a preset baseline or a mapping — persistence
 *   stays the explicit existing Save button (and its existing guards);
 * - the numeric Transform controls cannot desynchronize: they read exactly the
 *   state these writes update (same setters the sliders call);
 * - the RESET reference is the same one the per-title Reset buttons of
 *   `TransformControls` use (the effective global default of the CURRENT
 *   shape, `land[key] ?? flat`), never an applied-preset baseline — a
 *   settings-only concept this surface neither reads nor writes;
 * - item reset/rejoin never invent geometry: they delete the stored
 *   correction, so the badge returns to the automatic layout.
 *
 * Identity safety: `identity` is the title key the surface was opened on. A
 * write is refused after unmount and whenever the identity captured by the
 * callback no longer matches the live one, so a gesture (or a queued
 * continuation) can never land on the next title even if Save was never
 * pressed.
 */
export function usePerTitleBadgeGeometry(identity: string): BadgeDragGeometryAdapter {
  const ed = usePosterEditor()
  const isLandscape = ed.posterShape === "landscape"

  // Mount + identity guard (see the doc above). The setup MUST (re)open the
  // guard: React's dev StrictMode replays every effect as setup→cleanup→setup,
  // so a cleanup-only mount effect would leave the flag false forever and drop
  // every direct write (a real unmount still closes it: no setup follows).
  const mountedRef = useRef(true)
  const identityRef = useRef(identity)
  useEffect(() => {
    identityRef.current = identity
  }, [identity])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const owner = identity
  const canWrite = useCallback(
    () => mountedRef.current && identityRef.current === owner,
    [owner],
  )

  // ---- Reads: the CURRENT shape's live values (never the other shape) ----
  const itemTransforms = parseBadgeItemTransforms(ed.badgeItemTransforms)
  const extraBadgeScale = ed.extraBadgeScale
  const extraBadgeOffsetX = ed.extraBadgeOffsetX
  const extraBadgeOffsetY = ed.extraBadgeOffsetY

  // ---- Writes: per-title live state only ----
  /**
   * Item write of this surface. Each gesture performs AT MOST ONE item write,
   * so `setBadgeItemTransforms` is never called twice in the same tick from
   * here: the overlay keeps a single hit-testable target LEVEL (family handles
   * OR item handles — `targetLevel` in `PosterBadgeDragLayer`), a level switch
   * clears the selection and marquee selection only collects the active level,
   * so a family reset and an item reset can never share one double-click. That
   * invariant is what keeps this correct: the setter resolves its updater
   * against the value captured on the last render, so two item writes in the
   * same tick would clobber each other.
   */
  const writeItems = (mutate: (prev: ReturnType<typeof parseBadgeItemTransforms>) => ReturnType<typeof parseBadgeItemTransforms>) => {
    if (!canWrite()) return
    ed.setBadgeItemTransforms((prev) => serializeBadgeItemTransforms(mutate(parseBadgeItemTransforms(prev))))
  }

  const applyItemMoves = (moves: readonly BadgeItemMove[]) => {
    if (moves.length === 0 || !canWrite()) return
    // Same updater shape as the settings adapter, and (see `writeItems`) the
    // whole selection lands in ONE state update, so React batching cannot keep
    // only the last member of a multi-selection.
    ed.setBadgeItemTransforms((prev) => {
      const applied = moves.reduce(
        (acc, move) => withBadgeItemTransform(acc, move.id, move.transform),
        parseBadgeItemTransforms(prev),
      )
      return serializeBadgeItemTransforms(applied)
    })
  }

  const applyFamilyMoves = (moves: readonly BadgeFamilyMove[]) => {
    if (moves.length === 0 || !canWrite()) return
    for (const move of moves) {
      switch (move.family) {
        case "rank":
          ed.setTopBadgeOffsetX(move.offsetX)
          ed.setTopBadgeOffsetY(move.offsetY)
          break
        case "extra":
          if (move.scale != null) ed.setExtraBadgeScale(move.scale)
          ed.setExtraBadgeOffsetX(move.offsetX)
          ed.setExtraBadgeOffsetY(move.offsetY)
          break
        case "genre":
          ed.setGenreBadgeOffsetX(move.offsetX)
          ed.setGenreBadgeOffsetY(move.offsetY)
          break
        case "quality":
          ed.setQualityBadgeOffsetX(move.offsetX)
          ed.setQualityBadgeOffsetY(move.offsetY)
          break
        case "separate":
          ed.setSeparateBadgeOffsetX(move.offsetX)
          ed.setSeparateBadgeOffsetY(move.offsetY)
          break
        case "network":
          ed.setNetworkLogoOffsetX(move.offsetX)
          ed.setNetworkLogoOffsetY(move.offsetY)
          break
        case "logo":
          ed.setLogoOffsetX(move.offsetX)
          ed.setLogoOffsetY(move.offsetY)
          break
      }
    }
  }

  const setFamilyScale = (family: BadgeGeometryFamily, scale: number) => {
    const v = Math.round(scale)
    if (!Number.isFinite(v) || !canWrite()) return
    switch (family) {
      case "rank":
        ed.setTopBadgeScale(v)
        return
      case "extra":
        ed.setExtraBadgeScale(v)
        return
      case "genre":
        ed.setGenreBadgeScale(v)
        return
      case "quality":
        ed.setQualityBadgeScale(v)
        return
      case "separate":
        ed.setSeparateBadgeScale(v)
        return
      case "network":
        ed.setNetworkLogoScale(v)
        return
      case "logo":
        ed.setLogoScale(v)
        return
    }
  }

  /**
   * Canonical reset of the SELECTED families: the exact reference of the
   * per-title Reset buttons in `TransformControls` (effective global default of
   * the current shape; the separate-ratings style fallback and the network
   * follow projection use the same helpers), plus the item corrections those
   * families own (they are deltas on top of the family layout). Only the live
   * per-title state is written.
   */
  const resetFamilies = (families: readonly BadgeGeometryFamily[]) => {
    if (families.length === 0 || !canWrite()) return
    const land = ed.landscape
    const shape = isLandscape ? "landscape" : "poster"
    for (const family of families) {
      switch (family) {
        case "logo":
          // Auto again (the context rank/layout effect realigns the number) and
          // position back to the canonical offset.
          ed.setLogoScale(ed.logoScale, { auto: true })
          ed.setLogoOffsetX(0)
          ed.setLogoOffsetY(0)
          break
        case "rank":
          ed.setTopBadgeScale(isLandscape ? (land.topBadgeScale ?? ed.defaultTopBadgeScale) : ed.defaultTopBadgeScale)
          ed.setTopBadgeOffsetX(isLandscape ? (land.topBadgeOffsetX ?? ed.defaultTopBadgeOffsetX) : ed.defaultTopBadgeOffsetX)
          ed.setTopBadgeOffsetY(isLandscape ? (land.topBadgeOffsetY ?? ed.defaultTopBadgeOffsetY) : ed.defaultTopBadgeOffsetY)
          break
        case "extra":
          // Legacy follow contract: null = inherit the rank slot again.
          ed.setExtraBadgeScale(null)
          ed.setExtraBadgeOffsetX(null)
          ed.setExtraBadgeOffsetY(null)
          break
        case "genre":
          ed.setGenreBadgeScale(isLandscape ? (land.genreBadgeScale ?? ed.defaultGenreBadgeScale) : ed.defaultGenreBadgeScale)
          ed.setGenreBadgeOffsetX(isLandscape ? (land.genreBadgeOffsetX ?? ed.defaultGenreBadgeOffsetX) : ed.defaultGenreBadgeOffsetX)
          ed.setGenreBadgeOffsetY(isLandscape ? (land.genreBadgeOffsetY ?? ed.defaultGenreBadgeOffsetY) : ed.defaultGenreBadgeOffsetY)
          break
        case "quality":
          ed.setQualityBadgeScale(isLandscape ? (land.qualityBadgeScale ?? ed.defaultQualityBadgeScale) : ed.defaultQualityBadgeScale)
          ed.setQualityBadgeOffsetX(isLandscape ? (land.qualityBadgeOffsetX ?? ed.defaultQualityBadgeOffsetX) : ed.defaultQualityBadgeOffsetX)
          ed.setQualityBadgeOffsetY(isLandscape ? (land.qualityBadgeOffsetY ?? ed.defaultQualityBadgeOffsetY) : ed.defaultQualityBadgeOffsetY)
          break
        case "separate":
          ed.setSeparateBadgeScale(resolveSeparateBadgeScaleFallback({
            explicit: isLandscape ? land.separateBadgeScale : undefined,
            defaultScale: ed.defaultSeparateBadgeScale,
            defaultStyle: ed.defaultSeparateRatingsStyle,
            style: ed.separateRatingsStyle,
          }))
          ed.setSeparateBadgeOffsetX(isLandscape ? (land.separateBadgeOffsetX ?? ed.defaultSeparateBadgeOffsetX) : ed.defaultSeparateBadgeOffsetX)
          ed.setSeparateBadgeOffsetY(isLandscape ? (land.separateBadgeOffsetY ?? ed.defaultSeparateBadgeOffsetY) : ed.defaultSeparateBadgeOffsetY)
          break
        case "network": {
          // Same projection as the Transform group reset: follow mirrors the
          // shape's effective default instead of baking absolutes.
          const view = resolveNetworkShapeView(
            {
              networkLogoFollowTitle: ed.defaultNetworkLogoFollowTitle,
              networkLogoOffsetX: ed.defaultNetworkLogoOffsetX,
              networkLogoOffsetY: ed.defaultNetworkLogoOffsetY,
            },
            land,
            shape,
          )
          ed.setNetworkLogoScale(isLandscape ? (land.networkLogoScale ?? ed.defaultNetworkLogoScale) : ed.defaultNetworkLogoScale)
          ed.setNetworkLogoOffsetX(view.follow ? view.relativeX : (view.fixedX ?? 0))
          ed.setNetworkLogoOffsetY(view.follow ? view.relativeY : (view.fixedY ?? 0))
          break
        }
      }
    }
    // Item corrections owned by a reset family are part of that family's
    // layout: drop them (automatic layout), keep every other family's items.
    const itemFamilies = families.filter((family) => family === "quality" || family === "separate")
    if (itemFamilies.length === 0) return
    writeItems((prev) =>
      itemFamilies.reduce((acc, family) => withoutBadgeItemFamily(acc, family), prev),
    )
  }

  const resetItems = (ids: readonly string[]) => {
    if (ids.length === 0 || !canWrite()) return
    writeItems((prev) => ids.reduce((acc, id) => withoutBadgeItemTransform(acc, id), prev))
  }

  const rejoin = (patch: {
    readonly families?: readonly ("quality" | "separate")[]
    readonly items?: readonly string[]
  }) => {
    const families = patch.families ?? []
    const items = patch.items ?? []
    if (families.length === 0 && items.length === 0) return
    if (!canWrite()) return
    // No-op detection on the live map: a rejoin of an already-clean selection
    // must not write (no false dirty state, no needless preview refetch).
    let expected = itemTransforms
    for (const family of families) expected = withoutBadgeItemFamily(expected, family)
    if (items.length > 0) expected = rejoinBadgeItems(expected, items)
    if (serializeBadgeItemTransforms(expected) === serializeBadgeItemTransforms(itemTransforms)) return
    writeItems((prev) => {
      let next = prev
      for (const family of families) next = withoutBadgeItemFamily(next, family)
      return items.length > 0 ? rejoinBadgeItems(next, items) : next
    })
  }

  return {
    isLandscape,
    itemTransforms,
    topBadgeScale: ed.topBadgeScale,
    topBadgeOffsetX: ed.topBadgeOffsetX,
    topBadgeOffsetY: ed.topBadgeOffsetY,
    extraBadgeScale: extraBadgeScale ?? ed.topBadgeScale,
    extraBadgeOffsetX: extraBadgeOffsetX ?? ed.topBadgeOffsetX,
    extraBadgeOffsetY: extraBadgeOffsetY ?? ed.topBadgeOffsetY,
    extraBadgeScaleExplicit: extraBadgeScale,
    extraBadgeOffsetXExplicit: extraBadgeOffsetX,
    extraBadgeOffsetYExplicit: extraBadgeOffsetY,
    genreBadgeScale: ed.genreBadgeScale,
    genreBadgeOffsetX: ed.genreBadgeOffsetX,
    genreBadgeOffsetY: ed.genreBadgeOffsetY,
    qualityBadgeScale: ed.qualityBadgeScale,
    qualityBadgeOffsetX: ed.qualityBadgeOffsetX,
    qualityBadgeOffsetY: ed.qualityBadgeOffsetY,
    separateBadgeScale: ed.separateBadgeScale,
    separateBadgeOffsetX: ed.separateBadgeOffsetX,
    separateBadgeOffsetY: ed.separateBadgeOffsetY,
    networkLogoScale: ed.networkLogoScale,
    networkLogoOffsetX: ed.networkLogoOffsetX,
    networkLogoOffsetY: ed.networkLogoOffsetY,
    logoScale: ed.logoScaleExplicit ? ed.logoScale : null,
    logoOffsetX: ed.logoOffsetX,
    logoOffsetY: ed.logoOffsetY,
    posterLayout: ed.posterLayout,
    applyFamilyMoves,
    applyItemMoves,
    setFamilyScale,
    resetFamilies,
    resetItems,
    rejoin,
  }
}
