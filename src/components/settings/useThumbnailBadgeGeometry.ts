"use client"

import { useMemo } from "react"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { BadgeDragGeometryAdapter } from "@/lib/badge-drag-adapter"
import { clampThumbnailBadgeOffset, clampThumbnailBadgeScale } from "@/components/settings/thumbnail-preview"

/**
 * Drag adapter for the Miniature preview.
 *
 * The overlay (`PosterBadgeDragLayer`) is the SAME implementation used by the
 * poster/landscape editors; only the WRITER differs. This adapter maps the
 * single reported family ("genre" = the thumbnail badge stack) onto the
 * thumbnail offsets and scale, so a drag/resize writes the same state the
 * settings controls and the preview/`/meta` URLs use. No item/ghost surface
 * exists for thumbnails.
 */
export function useThumbnailBadgeGeometry(): BadgeDragGeometryAdapter {
  const ed = usePosterEditor()
  const {
    thumbnailBadgeOffsetX,
    thumbnailBadgeOffsetY,
    thumbnailBadgeScale,
    setThumbnailBadgeOffsetX,
    setThumbnailBadgeOffsetY,
    setThumbnailBadgeScale,
  } = ed

  return useMemo<BadgeDragGeometryAdapter>(() => ({
    isLandscape: true,
    itemTransforms: {},
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    extraBadgeScale: 100,
    extraBadgeOffsetX: 0,
    extraBadgeOffsetY: 0,
    extraBadgeScaleExplicit: null,
    extraBadgeOffsetXExplicit: null,
    extraBadgeOffsetYExplicit: null,
    genreBadgeScale: thumbnailBadgeScale,
    genreBadgeOffsetX: thumbnailBadgeOffsetX,
    genreBadgeOffsetY: thumbnailBadgeOffsetY,
    qualityBadgeScale: 100,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    separateBadgeScale: 100,
    separateBadgeOffsetX: 0,
    separateBadgeOffsetY: 0,
    networkLogoScale: 100,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    logoScale: null,
    logoOffsetX: 0,
    logoOffsetY: 0,
    posterLayout: "standard",
    applyFamilyMoves: (moves) => {
      for (const move of moves) {
        if (move.family !== "genre") continue
        setThumbnailBadgeOffsetX(clampThumbnailBadgeOffset(move.offsetX))
        setThumbnailBadgeOffsetY(clampThumbnailBadgeOffset(move.offsetY))
      }
    },
    applyItemMoves: () => {},
    setFamilyScale: (family, scale) => {
      if (family !== "genre") return
      setThumbnailBadgeScale(clampThumbnailBadgeScale(scale))
    },
    resetFamilies: (families) => {
      if (!families.includes("genre")) return
      setThumbnailBadgeOffsetX(0)
      setThumbnailBadgeOffsetY(0)
      setThumbnailBadgeScale(100)
    },
    resetItems: () => {},
    rejoin: () => {},
  }), [
    thumbnailBadgeOffsetX,
    thumbnailBadgeOffsetY,
    thumbnailBadgeScale,
    setThumbnailBadgeOffsetX,
    setThumbnailBadgeOffsetY,
    setThumbnailBadgeScale,
  ])
}
