"use client"

import type { LandscapeServerDefaults } from "@/lib/server-defaults"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"

export type BadgeShapeTarget = "portrait" | "landscape"

/**
 * Scoped badge-default bindings for the Badge tab edit target.
 * Portrait reads/writes the shared flats; landscape reads
 * `land[key] ?? flat` and writes the landscape profile. Landscape `null`
 * inherits flats, matching the server `effectiveDefaultsForShape` rule.
 * Data sources, endpoints, region, date format and API settings stay global
 * and are intentionally absent here (callers keep the root setters).
 */
export function useShapeBadgeDefaults(shape: BadgeShapeTarget | undefined) {
  const ed = usePosterEditor()
  const isLandscape = shape === "landscape"
  const land = ed.landscape
  function scoped<T>(
    landKey: keyof LandscapeServerDefaults,
    flatValue: T,
    setFlat: (v: T) => void,
  ): readonly [T, (v: T) => void] {
    if (!isLandscape) return [flatValue, setFlat] as const
    const value = (land[landKey] ?? flatValue) as T
    const set = (v: T) => {
      ed.setLandscape({ [landKey]: v } as Partial<LandscapeServerDefaults>)
    }
    return [value, set] as const
  }
  return { isLandscape, scoped }
}

/** Landscape visual keys owned by the Badge tab (reset scope, presets stay out of numerics). */
export const BADGE_VISUAL_LAND_KEYS = [
  "globalBadges",
  "rankingBadges",
  "badgeGenre",
  "badgeYear",
  "badgeRating",
  "badgeQuality",
  "customRatings",
  "separateRatings",
  "separateRatingsStyle",
  "badgeStyle",
  "rankingBadgeStyle",
  "extraBadgeStyle",
  "badgeFont",
  "qualityBadgeStyle",
  "videoFormats",
  "sashOrder",
  "networkLogo",
  "networkLogoPosition",
  "preRelease",
  "ribbonSide",
  "ribbonEnabled",
] as const satisfies readonly (keyof LandscapeServerDefaults)[]
