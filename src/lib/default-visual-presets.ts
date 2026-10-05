import { captureVisualPreset, type VisualPresetValues } from "./visual-presets"

/**
 * Built-in 1-click completi (snapshot fedeli dei backup utente BetterPoster e
 * RPDB, solo sottoinsieme visuale). Single source: BadgeDefaultsSection li
 * applica via `ed.applyVisualPreset` senza duplicare i parametri.
 *
 * Provenienza: `defaults` dei due JSON (coincidenti con `local.badgeDefaults`
 * interni). Ignorato tutto il resto del backup: mappings per-titolo, alias,
 * preset utente, cataloghi, endpoint/chiavi custom rating, region, lingue,
 * gradienti custom locali. `ratingSources` preserva la lista esatta a 16
 * (preferenze/priorità): il renderer mostra al max MAX_SEPARATE_RATINGS=3.
 */

export const BETTER_POSTER_PRESET_LABEL = "BetterPoster"
export const RPDB_PRESET_LABEL = "RPDB"

const SHARED_RATING_SOURCES_16: VisualPresetValues["defaultRatingSources"] = [
  "imdb",
  "tmdb",
  "mdblist",
  "tomatoes",
  "popcorntime",
  "letterboxd",
  "metacritic",
  "metacriticuser",
  "trakt",
  "simkl",
  "filmweb",
  "filmwebcritics",
  "rogerebert",
  "mal",
  "anilist",
  "kitsu",
]

const SHARED_VIDEO_FORMATS_5: VisualPresetValues["defaultVideoFormats"] = [
  "dv",
  "atmos",
  "imax",
  "hdr",
  "hdr10plus",
]

const SHARED_LANDSCAPE: VisualPresetValues["landscape"] = {
  gradientHeight: 50,
  blurIntensity: 1,
  blurFade: 100,
  blurDarkness: 100,
  tintStrength: 0,
}

/** Chiavi visuali identiche nei due snapshot (logo null = auto-fit). */
const SHARED_VISUAL_BASE = {
  defaultGlobalBadges: true,
  defaultBadgeGenre: true,
  defaultBadgeYear: false,
  defaultBadgeRating: true,
  defaultBadgeQuality: false,
  defaultCustomRatings: false,
  defaultRatingSources: SHARED_RATING_SOURCES_16,
  defaultBadgeStyle: "minimal",
  defaultRankingBadgeStyle: "default",
  defaultBadgeFont: "inter",
  defaultQualityBadgeStyle: "color",
  defaultVideoFormats: SHARED_VIDEO_FORMATS_5,
  defaultLogoScale: null,
  defaultLogoOffsetX: null,
  defaultLogoOffsetY: null,
  defaultBlurIntensity: 20,
  defaultTopShade: 50,
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
  defaultGenreBadgeScale: 100,
  defaultGenreBadgeOffsetX: 0,
  defaultGenreBadgeOffsetY: 0,
  defaultQualityBadgeScale: 100,
  defaultQualityBadgeOffsetX: 0,
  defaultQualityBadgeOffsetY: 0,
  defaultSeparateBadgeScale: 130,
  defaultSeparateBadgeOffsetX: 0,
  defaultSeparateBadgeOffsetY: 0,
  defaultNetworkLogoScale: 100,
  defaultNetworkLogoOffsetX: 0,
  defaultNetworkLogoOffsetY: 0,
  defaultNetworkLogo: false,
  defaultNetworkLogoPosition: "auto",
  defaultRibbonEnabled: false,
  defaultRibbonSide: "left",
  defaultPosterShape: "poster",
  defaultLogoAlign: null,
  defaultPortraitFitEnabled: false,
  defaultLandscapeFitEnabled: false,
  landscape: SHARED_LANDSCAPE,
}

/** Snapshot BetterPoster: blur on, ranking/sash on, separati off, tinta piena. */
export const BETTER_POSTER_VISUAL_DEFAULTS: VisualPresetValues =
  captureVisualPreset({
    ...SHARED_VISUAL_BASE,
    defaultRankingBadges: true,
    defaultSeparateRatings: false,
    defaultSeparateRatingsStyle: "column",
    defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
    defaultBlurEnabled: true,
    defaultBlurFade: 10,
    defaultBlurDarkness: 0,
    defaultTintStrength: 100,
    defaultGradientHeight: 35,
    defaultPreRelease: true,
  } as VisualPresetValues)

/** Snapshot RPDB: blur off, separati bottom-bar on, ranking/sash off. */
export const RPDB_VISUAL_DEFAULTS: VisualPresetValues = captureVisualPreset({
  ...SHARED_VISUAL_BASE,
  defaultRankingBadges: false,
  defaultSeparateRatings: true,
  defaultSeparateRatingsStyle: "bottom-bar",
  defaultSashOrder: [],
  defaultBlurEnabled: false,
  defaultBlurFade: 50,
  defaultBlurDarkness: 30,
  defaultTintStrength: 20,
  defaultGradientHeight: 30,
  defaultPreRelease: false,
} as VisualPresetValues)
