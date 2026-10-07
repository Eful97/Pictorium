// Badge offset slider ranges (shared by the per-title editor and the
// Vertical/Horizontal defaults panels: badge families plus the default
// logo offsets). The per-title film logo keeps its dynamic logoBounds
// (`logo-layout.ts`) and never uses this helper.
//
// Browser-safe: pure constants + pure function, no sharp/Node imports.
// `LAND_W`/`LAND_H` come from `./constants` (browser-safe); the portrait
// canvas (500x750) mirrors `STD_W`/`STD_H` in `image-utils.ts`, which cannot
// be imported here (it pulls `sharp` into the client bundle). If the canonical
// canvas ever changes, update the two portrait constants below alongside it.
//
// Contract: slider travel covers a full canvas crossing per axis
// (min = -dim, max = +dim); the numeric edit covers the server contract
// (`BADGE_OFFSET_NUMERIC_LIMIT` = ±2000 — same clamp as `poster-config.ts`).
// No containment is promised: the renderer clips/clamps per badge as today.

import { LAND_H, LAND_W } from "./constants"

/** Portrait canvas width mirrored from `STD_W` (`image-utils.ts`). */
export const PORTRAIT_OFFSET_CANVAS_W = 500
/** Portrait canvas height mirrored from `STD_H` (`image-utils.ts`). */
export const PORTRAIT_OFFSET_CANVAS_H = 750

/**
 * Server-side offset clamp (px). Mirrors the `clamp(..., -2000, 2000)` chain
 * in `poster-config.ts` / `config-token.ts` and the zod `offset` schema in
 * `visual-presets.ts`. Values beyond it never reach the renderer.
 */
export const BADGE_OFFSET_NUMERIC_LIMIT = 2000

export type BadgeOffsetShape = "poster" | "landscape"
export type BadgeOffsetAxis = "x" | "y"

export interface BadgeOffsetRange {
  readonly min: number
  readonly max: number
  readonly boundsMin: number
  readonly boundsMax: number
}

/**
 * Slider + numeric-edit range for a badge offset on one axis of one shape.
 * Landscape uses the 16:9 canvas, anything else (portrait default,
 * garbage, null) falls back to the portrait canvas — same fail-closed
 * default as the server (`poster` unless `landscape`).
 */
export function getBadgeOffsetRange(
  shape: BadgeOffsetShape | string | null | undefined,
  axis: BadgeOffsetAxis,
): BadgeOffsetRange {
  const isLandscape = shape === "landscape"
  const dim = isLandscape
    ? axis === "x"
      ? LAND_W
      : LAND_H
    : axis === "x"
      ? PORTRAIT_OFFSET_CANVAS_W
      : PORTRAIT_OFFSET_CANVAS_H
  return {
    min: -dim,
    max: dim,
    boundsMin: -BADGE_OFFSET_NUMERIC_LIMIT,
    boundsMax: BADGE_OFFSET_NUMERIC_LIMIT,
  }
}
