// ---------------------------------------------------------------------------
// Badge Lab starter templates: the REAL house styles as editable starting
// points (same builders as the poster — pixel-identical, not approximations).
// Custom free-form designs remain available via "New" (blank custom preset).
// ---------------------------------------------------------------------------

import type { BadgeDesign, BadgeTarget, HouseBadge, PresetLike } from "./badge-preset"
import { isTechnicalFamilyId } from "./badge-preset-technical"
import { isRibbonRankingStyle } from "./badge-styles"
import type { ExtraBadgeStyle } from "./badge-styles"
import { GENRE_FALLBACK } from "./badges"

/** Poster-mock zone, mirroring poster-service slot layout (portrait). */
export type PresetPreviewZone = "top-ribbon" | "top-center" | "genre-bar" | "genre"

export function presetPreviewZone(target: BadgeTarget, shape: BadgeDesign["shape"]): PresetPreviewZone {
  if (target === "top" || target === "rank" || target === "extra") return shape === "ribbon" ? "top-ribbon" : "top-center"
  return shape === "bar" ? "genre-bar" : "genre"
}

/** Zone for either variant: ribbon styles → corner, house bar → full-width. */
export function zoneForPreset(p: PresetLike): PresetPreviewZone {
  if (p.target === "top" || p.target === "rank" || p.target === "extra") {
    if (p.variant === "house") return isRibbonRankingStyle(p.house?.style) ? "top-ribbon" : "top-center"
    return presetPreviewZone(p.target, p.design?.shape ?? "pill")
  }
  // Technical families (future Lab wiring): the corner ribbon keeps its
  // corner; bottom rows sit on the bottom edge (bar full-width, the rest
  // content-width); the retained top-right overlays (quality, age, network)
  // preview centered on top like the other centered badges.
  if (p.variant === "house" && isTechnicalFamilyId(p.target)) {
    if (p.target === "comingSoon") return "top-ribbon"
    if (p.target === "separateRatings" || p.target === "customRatings") {
      return p.house?.style === "bottom-bar" ? "genre-bar" : "genre"
    }
    return "top-center"
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

/**
 * Extra-badge starter payload: style + scale + polarity only. NO label — an
 * extra badge renders the LIVE label (award/custom text); baking the rank
 * period label ("Oggi") into the saved default would stamp every extra badge
 * with the wrong text. An explicit `house.label` stays a user opt-in.
 */
function extra(style: ExtraBadgeStyle): HouseBadge {
  return { style, scale: 100, polarity: "auto" }
}

function genre(style: HouseBadge["style"]): HouseBadge {
  return { style, showGenre: true, showYear: true, showRating: true, scale: 100, polarity: "auto" }
}

/** Palette accent per gli stili colored: stessi 18 colori dei fallback di genere. */
export const HOUSE_ACCENT_PALETTE: readonly string[] = [
  ...new Set(Object.values(GENRE_FALLBACK).map((c) => c.toLowerCase())),
]

export const BADGE_PRESET_TEMPLATES: readonly BadgePresetTemplate[] = [  { key: "top-netflix", target: "top", labelKey: "ui.labTplTopNetflix", house: top("netflix") },
  { key: "top-default", target: "top", labelKey: "ui.labTplTopPlacard", house: top("default") },
  { key: "top-pill", target: "top", labelKey: "ui.labTplTopPill", house: top("pill") },
  { key: "top-vetro", target: "top", labelKey: "ui.labTplTopVetro", house: top("vetro") },
  { key: "top-bordo", target: "top", labelKey: "ui.labTplTopBordo", house: top("bordo") },
  { key: "top-colored", target: "top", labelKey: "ui.labTplTopColored", house: top("colored") },
  // Task P native variant: colored PLATE (ribbon OFF, same shared recipe, no
  // SVG copy). The default `top-colored` above stays the ribbon (legacy).
  { key: "top-colored-plate", target: "top", labelKey: "ui.labTplTopColoredPlate", house: { ...top("colored"), ribbon: false } },
  { key: "top-corner", target: "top", labelKey: "ui.labTplTopCorner", house: top("corner") },
  { key: "top-number", target: "top", labelKey: "ui.labTplTopNumber", house: top("number") },
  { key: "extra-default", target: "extra", labelKey: "ui.labTplTopPlacard", house: extra("default") },
  { key: "extra-pill", target: "extra", labelKey: "ui.labTplTopPill", house: extra("pill") },
  { key: "extra-colored", target: "extra", labelKey: "ui.labTplTopColored", house: extra("colored") },
  { key: "extra-bordo", target: "extra", labelKey: "ui.labTplTopBordo", house: extra("bordo") },
  { key: "extra-vetro", target: "extra", labelKey: "ui.labTplTopVetro", house: extra("vetro") },
  { key: "extra-corner", target: "extra", labelKey: "ui.labTplTopCorner", house: extra("corner") },
  { key: "genre-shadow", target: "genre", labelKey: "ui.labTplGenreShadow", house: genre("shadow") },
  { key: "genre-minimal", target: "genre", labelKey: "ui.labTplGenreMinimal", house: genre("minimal") },
  { key: "genre-pill", target: "genre", labelKey: "ui.labTplGenrePill", house: genre("pill") },
  { key: "genre-bar", target: "genre", labelKey: "ui.labTplGenreBar", house: genre("bar") },
  { key: "genre-colored", target: "genre", labelKey: "ui.labTplGenreColored", house: genre("colored") },
  { key: "genre-bordo", target: "genre", labelKey: "ui.labTplGenreBordo", house: genre("bordo") },
  { key: "genre-vetro", target: "genre", labelKey: "ui.labTplGenreVetro", house: genre("vetro") },
]
