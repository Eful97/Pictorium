import { captureVisualPreset, type VisualPresetValues } from "./visual-presets"

/**
 * Built-in 1-click completi (snapshot fedeli dei backup utente BetterPoster e
 * RPDB, solo sottoinsieme visuale; Apple dal preset-export condiviso
 * `pictorium-visual-preset-apple.json`). Single source: BadgeDefaultsSection li
 * applica via `ed.applyVisualPreset` senza duplicare i parametri.
 *
 * Provenienza: `defaults` dei due JSON (coincidenti con `local.badgeDefaults`
 * interni) e `values` del preset Apple. Ignorato tutto il resto del backup:
 * mappings per-titolo, alias,
 * preset utente, cataloghi, endpoint/chiavi custom rating, region, lingue,
 * gradienti custom locali. `ratingSources` preserva la lista esatta a 16
 * (preferenze/priorità): il renderer mostra al max MAX_SEPARATE_RATINGS=3.
 */

export const BETTER_POSTER_PRESET_LABEL = "BetterPoster"
export const RPDB_PRESET_LABEL = "RPDB"
export const APPLE_PRESET_LABEL = "Apple"

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

/**
 * Snapshot Apple (fedele a `pictorium-visual-preset-apple.json`, entry
 * `Apple`): badge minimal, rank `number` + nastro, logo network on, blur
 * leggero, tinta zero. I flat servono il portrait, il `landscape` nested
 * l'orizzontale (es. `genreBadgeOffsetY` -40 vs 0, `blurFade` 50 vs 100,
 * `qualityBadgeStyle` knockout vs color). `captureVisualPreset` valida lo
 * schema all'import: una divergenza dal JSON fa fallire il modulo, mai un
 * apply silenzioso.
 */
export const APPLE_VISUAL_DEFAULTS: VisualPresetValues = captureVisualPreset({
  defaultGlobalBadges: true,
  defaultRankingBadges: true,
  defaultBadgeGenre: true,
  defaultBadgeYear: false,
  defaultBadgeRating: true,
  defaultBadgeQuality: false,
  defaultCustomRatings: false,
  defaultSeparateRatings: false,
  defaultRatingSources: ["imdb", "tmdb"],
  defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
  defaultBadgeStyle: "minimal",
  defaultRankingBadgeStyle: "number",
  defaultBadgeFont: "inter",
  defaultQualityBadgeStyle: "knockout",
  defaultVideoFormats: ["dv", "atmos", "imax", "hdr", "hdr10plus"],
  defaultLogoScale: null,
  defaultLogoOffsetX: null,
  defaultLogoOffsetY: -40,
  defaultBlurEnabled: true,
  defaultBlurIntensity: 1,
  defaultBlurFade: 50,
  defaultBlurDarkness: 100,
  defaultTintStrength: 0,
  defaultTopShade: 50,
  defaultGradientHeight: 50,
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
  defaultGenreBadgeScale: 100,
  defaultGenreBadgeOffsetX: 0,
  defaultGenreBadgeOffsetY: -40,
  defaultQualityBadgeScale: 100,
  defaultQualityBadgeOffsetX: 0,
  defaultQualityBadgeOffsetY: 0,
  defaultSeparateBadgeScale: 130,
  defaultSeparateBadgeOffsetX: 0,
  defaultSeparateBadgeOffsetY: 0,
  defaultSeparateRatingsStyle: "column",
  defaultNetworkLogoScale: 100,
  defaultNetworkLogoOffsetX: 0,
  defaultNetworkLogoOffsetY: 0,
  defaultNetworkLogo: true,
  defaultNetworkLogoPosition: "auto",
  defaultPreRelease: true,
  defaultRibbonEnabled: true,
  defaultRibbonSide: "left",
  defaultPosterShape: "poster",
  defaultLogoAlign: null,
  defaultPortraitFitEnabled: false,
  defaultLandscapeFitEnabled: false,
  landscape: {
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    gradientHeight: 50,
    blurEnabled: true,
    blurIntensity: 1,
    blurFade: 100,
    blurDarkness: 100,
    tintStrength: 0,
    topShade: 50,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeScale: 100,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    separateBadgeScale: 130,
    separateBadgeOffsetX: 0,
    separateBadgeOffsetY: 0,
    separateRatingsStyle: "column",
    networkLogoScale: 100,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    globalBadges: true,
    rankingBadges: true,
    badgeGenre: true,
    badgeYear: false,
    badgeRating: true,
    badgeQuality: false,
    customRatings: false,
    separateRatings: false,
    badgeStyle: "minimal",
    rankingBadgeStyle: "number",
    badgeFont: "inter",
    qualityBadgeStyle: "color",
    videoFormats: ["dv", "atmos", "imax", "hdr", "hdr10plus"],
    sashOrder: ["upcoming", "rank", "new", "award", "extra"],
    networkLogo: true,
    networkLogoPosition: "auto",
    preRelease: true,
    ribbonEnabled: true,
    ribbonSide: "left",
  },
} as VisualPresetValues)
