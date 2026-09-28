// ---------------------------------------------------------------------------
// Badge Lab starter templates: the REAL house styles as editable starting
// points (same builders as the poster — pixel-identical, not approximations).
// Custom free-form designs remain available via "New" (blank custom preset).
// ---------------------------------------------------------------------------

import type { BadgeDesign, BadgeTarget, HouseBadge, PresetLike } from "./badge-preset"
import { isRibbonRankingStyle } from "./badge-styles"
import { GENRE_FALLBACK } from "./badges"

/** Poster-mock zone, mirroring poster-service slot layout (portrait). */
export type PresetPreviewZone = "top-ribbon" | "top-center" | "genre-bar" | "genre"

export function presetPreviewZone(target: BadgeTarget, shape: BadgeDesign["shape"]): PresetPreviewZone {
  if (target === "top") return shape === "ribbon" ? "top-ribbon" : "top-center"
  return shape === "bar" ? "genre-bar" : "genre"
}

/** Zone for either variant: ribbon styles → corner, house bar → full-width. */
export function zoneForPreset(p: PresetLike): PresetPreviewZone {
  if (p.target === "top") {
    if (p.variant === "house") return isRibbonRankingStyle(p.house?.style) ? "top-ribbon" : "top-center"
    return presetPreviewZone(p.target, p.design?.shape ?? "pill")
  }
  if (p.variant === "house") return p.house?.style === "bar" ? "genre-bar" : "genre"
  return presetPreviewZone(p.target, p.design?.shape ?? "pill")
}

export interface BadgePresetTemplate {
  readonly key: string
  readonly target: BadgeTarget
  /** i18n label key (ui.labTplXxx). */
  readonly labelKey: string
  readonly house: HouseBadge
}

function top(style: HouseBadge["style"]): HouseBadge {
  return { style, label: "Oggi", scale: 100, polarity: "auto" }
}

function genre(style: HouseBadge["style"]): HouseBadge {
  return { style, showGenre: true, showYear: true, showRating: true, scale: 100, polarity: "auto" }
}

/** Palette accent per gli stili colored: stessi 18 colori dei fallback di genere. */
export const HOUSE_ACCENT_PALETTE: readonly string[] = [
  ...new Set(Object.values(GENRE_FALLBACK).map((c) => c.toLowerCase())),
]

export const BADGE_PRESET_TEMPLATES: readonly BadgePresetTemplate[] = [  { key: "top-netflix", target: "top", labelKey: "ui.labTplTopNetflix", house: top("netflix") },
  { key: "top-netflix-color", target: "top", labelKey: "ui.labTplTopNetflixColor", house: top("netflix-color") },
  { key: "top-default", target: "top", labelKey: "ui.labTplTopPlacard", house: top("default") },
  { key: "top-pill", target: "top", labelKey: "ui.labTplTopPill", house: top("pill") },
  { key: "top-vetro", target: "top", labelKey: "ui.labTplTopVetro", house: top("vetro") },
  { key: "top-bordo", target: "top", labelKey: "ui.labTplTopBordo", house: top("bordo") },
  { key: "top-colored", target: "top", labelKey: "ui.labTplTopColored", house: top("colored") },
  { key: "genre-shadow", target: "genre", labelKey: "ui.labTplGenreShadow", house: genre("shadow") },
  { key: "genre-minimal", target: "genre", labelKey: "ui.labTplGenreMinimal", house: genre("minimal") },
  { key: "genre-pill", target: "genre", labelKey: "ui.labTplGenrePill", house: genre("pill") },
  { key: "genre-bar", target: "genre", labelKey: "ui.labTplGenreBar", house: genre("bar") },
  { key: "genre-colored", target: "genre", labelKey: "ui.labTplGenreColored", house: genre("colored") },
  { key: "genre-bordo", target: "genre", labelKey: "ui.labTplGenreBordo", house: genre("bordo") },
  { key: "genre-vetro", target: "genre", labelKey: "ui.labTplGenreVetro", house: genre("vetro") },
]
