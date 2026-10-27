"use client"

import type { PosterLayout } from "./types"
import type { BadgeItemTransformMap } from "./badge-item-transforms"

/**
 * Adapter contract of the direct badge manipulation overlay
 * (`PosterBadgeDragLayer`).
 *
 * The overlay owns the INTERACTION (hit-testing the boxes the renderer
 * reported, selection, marquee, snapping, containment, resize, keyboard
 * nudges, reset/rejoin gestures). It owns no state: every number it draws and
 * every write it performs goes through this adapter, so the SAME gesture code
 * drives the two existing editors without a second drag implementation:
 *
 * - `useShapeBadgeGeometryDefaults(shape)` — the global settings editor
 *   (portrait flats / landscape profile, applied-preset baseline resets);
 * - `usePerTitleBadgeGeometry(identity)` — the per-title editor (the OPEN
 *   poster's live values, per-title reset reference, draft-only writes).
 *
 * The adapter exposes exactly the values the overlay reads and the writes it
 * performs, so a caller can never be handed a "defaults" writer it did not
 * choose: the per-title adapter writes only the current poster's state and
 * never touches a global default, a preset or a mapping.
 */

/** One geometry family of the badge editor (same set as the renderer report). */
export type BadgeGeometryFamily = "rank" | "extra" | "genre" | "quality" | "separate" | "network" | "logo"

/**
 * One pending geometry write of a family: the offsets (and, only for the
 * complete fallback top slot, the scale). A batch of these is applied with a
 * SINGLE state write, so moving several selected groups together cannot lose
 * all but the last one to React batching.
 */
export interface BadgeFamilyMove {
  readonly family: BadgeGeometryFamily
  readonly offsetX: number
  readonly offsetY: number
  /** Non-null only when the write must materialize the family scale. */
  readonly scale?: number | null
}

/** One pending per-ITEM correction of a batch (neutral = removed). */
export interface BadgeItemMove {
  readonly id: string
  readonly transform: import("./badge-item-transforms").BadgeItemTransform
}

export interface BadgeDragGeometryAdapter {
  /** Shape the adapter writes (informational: the overlay is shape-agnostic). */
  readonly isLandscape: boolean
  /** Per-ITEM corrections of the edited target (`bit=` wire form, parsed). */
  readonly itemTransforms: BadgeItemTransformMap

  readonly topBadgeScale: number
  readonly topBadgeOffsetX: number
  readonly topBadgeOffsetY: number
  readonly extraBadgeScale: number
  readonly extraBadgeOffsetX: number
  readonly extraBadgeOffsetY: number
  /** Explicit (independent) fallback-slot values; null = follow the rank slot. */
  readonly extraBadgeScaleExplicit: number | null
  readonly extraBadgeOffsetXExplicit: number | null
  readonly extraBadgeOffsetYExplicit: number | null
  readonly genreBadgeScale: number
  readonly genreBadgeOffsetX: number
  readonly genreBadgeOffsetY: number
  readonly qualityBadgeScale: number
  readonly qualityBadgeOffsetX: number
  readonly qualityBadgeOffsetY: number
  readonly separateBadgeScale: number
  readonly separateBadgeOffsetX: number
  readonly separateBadgeOffsetY: number
  readonly networkLogoScale: number
  readonly networkLogoOffsetX: number
  readonly networkLogoOffsetY: number
  /** Explicit title scale; null = auto-fit (the renderer box is the authority). */
  readonly logoScale: number | null
  readonly logoOffsetX: number
  readonly logoOffsetY: number
  /** Effective whole-poster layout of the edited target (title scale cap). */
  readonly posterLayout: PosterLayout | null

  /** One state write per gesture (a whole multi-selection). */
  applyFamilyMoves: (moves: readonly BadgeFamilyMove[]) => void
  applyItemMoves: (moves: readonly BadgeItemMove[]) => void
  /** Scale write of the direct resize (same value the numeric slider writes). */
  setFamilyScale: (family: BadgeGeometryFamily, scale: number) => void
  /** Canonical reset of the listed families (position + scale + owned items). */
  resetFamilies: (families: readonly BadgeGeometryFamily[]) => void
  /** Reset of single item identities (automatic layout again). */
  resetItems: (ids: readonly string[]) => void
  /** Recovery: drop the stored corrections, never restore a reference. */
  rejoin: (patch: {
    readonly families?: readonly ("quality" | "separate")[]
    readonly items?: readonly string[]
  }) => void
}
