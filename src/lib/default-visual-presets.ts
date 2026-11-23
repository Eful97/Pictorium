import { captureVisualPreset, type VisualPresetValues } from "./visual-presets"

/**
 * Built-in 1-click completi (snapshot fedeli dei backup utente BetterPoster,
 * solo sottoinsieme visuale; Apple dal preset-export condiviso
 * `pictorium-visual-preset-apple.json`). Single source: BadgeDefaultsSection li
 * applica via `ed.applyVisualPreset` senza duplicare i parametri.
 *
 * Provenienza: `defaults` dei due JSON (coincidenti con `local.badgeDefaults`
 * interni) e `values` del preset Apple. Ignorato tutto il resto del backup:
 * mappings per-titolo, alias,
 * preset utente, cataloghi, endpoint/chiavi custom rating, region, lingue,
 * gradienti custom locali. `ratingSources` preserva la lista esatta a 16
 * (preferenze/priorità): il renderer mostra al max MAX_SEPARATE_RATINGS=5.
 */

export const BETTER_POSTER_PRESET_LABEL = "BetterPoster"
export const NOTCH_PRESET_LABEL = "Notch"
export const EDITORIAL_PRESET_LABEL = "Editorial"
export const GLASS_PRESET_LABEL = "Glass"
export const CINEMA_PRESET_LABEL = "Cinema"
export const MONO_PRESET_LABEL = "Mono"
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
  defaultLogoAnchor: "auto",
  defaultQualityAnchor: "auto",
  defaultTopBadgeAnchor: "auto",
  defaultExtraBadgeAnchor: "auto",
  defaultBottomAnchor: "auto",
  // Follow storico esplicito (i preset precedono il campo: assente = ON,
  // ma l'highlight confronta patch complete e il capture lo include sempre).
  defaultNetworkLogoFollowTitle: true,
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
    defaultBlurDarkness: 30,
    defaultTintStrength: 100,
    defaultGradientHeight: 35,
    defaultPreRelease: true,
  } as VisualPresetValues)

/** Pictorium-native looks: same shared base, own style family + gradient. */
function pictoriumLook(over: Record<string, unknown>, landscape: Record<string, unknown> = SHARED_LANDSCAPE): VisualPresetValues {
  return captureVisualPreset({
    ...SHARED_VISUAL_BASE,
    defaultRankingBadges: false,
    defaultSeparateRatings: false,
    defaultSeparateRatingsStyle: "column",
    defaultSashOrder: [],
    defaultBlurEnabled: true,
    defaultPreRelease: false,
    ...over,
    landscape,
  } as unknown as VisualPresetValues)
}

/** Notch: cream notch pills on every family, separate column, ranked. */
export const NOTCH_VISUAL_DEFAULTS: VisualPresetValues = pictoriumLook({
  defaultBadgeStyle: "notch-crema",
  defaultRankingBadges: true,
  defaultRankingBadgeStyle: "notch-crema",
  defaultQualityBadgeStyle: "notch-crema",
  defaultBadgeQuality: true,
  defaultSeparateRatings: true,
  defaultSeparateRatingsStyle: "column-notch-crema",
  defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
  defaultBlurIntensity: 20,
  defaultBlurFade: 50,
  defaultBlurDarkness: 30,
  defaultTintStrength: 20,
  defaultGradientHeight: 35,
})

/** Editorial: magazine style, condensed font, light gradient. */
export const EDITORIAL_VISUAL_DEFAULTS: VisualPresetValues = pictoriumLook({
  defaultBadgeStyle: "editoriale",
  defaultRankingBadges: true,
  defaultRankingBadgeStyle: "editoriale",
  defaultQualityBadgeStyle: "editoriale",
  defaultBadgeQuality: true,
  defaultBadgeFont: "barlow-condensed",
  defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
  defaultBlurIntensity: 10,
  defaultBlurFade: 50,
  defaultBlurDarkness: 20,
  defaultTintStrength: 0,
  defaultGradientHeight: 30,
})

/** Glass: translucent badges, strong blur, separate pills at the bottom. */
export const GLASS_VISUAL_DEFAULTS: VisualPresetValues = pictoriumLook({
  defaultBadgeStyle: "vetro",
  defaultRankingBadges: true,
  defaultRankingBadgeStyle: "vetro",
  defaultQualityBadgeStyle: "outline",
  defaultSeparateRatings: true,
  defaultSeparateRatingsStyle: "bottom-pills",
  defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
  defaultBlurIntensity: 40,
  defaultBlurFade: 60,
  defaultBlurDarkness: 40,
  defaultTintStrength: 30,
  defaultGradientHeight: 35,
})

/** Cinema: dark ink badges, oswald, premium quality, Nero gradient, ribbon. */
export const CINEMA_VISUAL_DEFAULTS: VisualPresetValues = pictoriumLook({
  defaultBadgeStyle: "ink",
  defaultRankingBadges: true,
  defaultRankingBadgeStyle: "netflix-color",
  defaultQualityBadgeStyle: "premium",
  defaultBadgeQuality: true,
  defaultBadgeFont: "oswald",
  defaultRibbonEnabled: true,
  defaultNetworkLogo: true,
  defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
  defaultBlurIntensity: 1,
  defaultBlurFade: 100,
  defaultBlurDarkness: 100,
  defaultTintStrength: 0,
  defaultGradientHeight: 50,
})

/** Mono: quiet look, monochrome quality, round mono ratings, no blur. */
export const MONO_VISUAL_DEFAULTS: VisualPresetValues = pictoriumLook({
  defaultBadgeStyle: "minimal",
  defaultQualityBadgeStyle: "mono",
  defaultBadgeQuality: true,
  defaultSeparateRatings: true,
  defaultSeparateRatingsStyle: "bottom-mono",
  defaultBlurEnabled: false,
  defaultBlurIntensity: 20,
  defaultBlurFade: 50,
  defaultBlurDarkness: 30,
  defaultTintStrength: 0,
  defaultGradientHeight: 30,
})

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
  defaultLogoAnchor: "auto",
  defaultQualityAnchor: "auto",
  defaultTopBadgeAnchor: "auto",
  defaultExtraBadgeAnchor: "auto",
  defaultBottomAnchor: "auto",
  // Come sopra: follow storico esplicito per l'highlight patch-complete.
  defaultNetworkLogoFollowTitle: true,
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
    logoAnchor: "auto",
    qualityAnchor: "auto",
    topBadgeAnchor: "auto",
    extraBadgeAnchor: "auto",
    bottomAnchor: "auto",
    preRelease: true,
    ribbonEnabled: true,
    ribbonSide: "left",
  },
} as VisualPresetValues)

export const FRESH_PRESET_LABEL = "Fresh"

/**
 * Snapshot Fresh (faithful to the user-supplied readonly export
 * `C:\Users\lucaf\Desktop\fresh.json`, entry `Fresh`, portrait shape):
 * flat global/rank on, genre on, year off, rating on, quality off,
 * custom/separate off; minimal badges, `netflix` rank + left ribbon,
 * Inter font, knockout quality icons; file transforms verbatim
 * (logo null/null/null, grade 35, network on/auto/follow, preRelease on,
 * ribbon left). Intentional universal-default alignment: the canonical
 * top-shade default is 50 (matching the export), so this snapshot carries
 * `topShade` 50 on both shapes; the readonly desktop JSON
 * `C:\Users\lucaf\Desktop\fresh.json` is never edited). The export predates
 * layout/scope/age keys, so they are injected explicitly here (never at
 * runtime from the desktop file):
 * portrait AND landscape own `fresh` + `ranked` (ranked-only contract),
 * age fills the canonical OFF/IT/standard, extra stays legacy null
 * (follow own rank). Landscape keeps the file's own profile numbers
 * (grade 50, blur 1/100/100, tint 0, rank `number`, quality `color`,
 * extra `follow-rank`) — never a copy of the portrait flats.
 * `captureVisualPreset` validates at import: drift from the export fails
 * fast, never a silent apply. Single canonical source for the Fresh
 * thumbnail/apply/highlight (no second renderer, no RENDER_VERSION bump).
 */
export const FRESH_VISUAL_DEFAULTS: VisualPresetValues =
  captureVisualPreset({
    defaultGlobalBadges: true,
    defaultRankingBadges: true,
    defaultBadgeGenre: true,
    defaultBadgeYear: false,
    defaultBadgeRating: true,
    defaultBadgeQuality: false,
    defaultCustomRatings: false,
    defaultSeparateRatings: false,
    defaultAgeBadge: false,
    defaultAgeCountry: "IT",
    defaultAgeBadgeStyle: "standard",
    defaultRatingSources: [
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
    ],
    defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
    defaultBadgeStyle: "minimal",
    defaultRankingBadgeStyle: "netflix",
    defaultBadgeFont: "inter",
    defaultQualityBadgeStyle: "knockout",
    defaultVideoFormats: ["dv", "atmos", "imax", "hdr", "hdr10plus"],
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    defaultBlurEnabled: true,
    defaultBlurIntensity: 20,
    defaultBlurFade: 50,
    defaultBlurDarkness: 30,
    defaultTintStrength: 20,
    defaultTopShade: 50,
    defaultGradientHeight: 35,
    defaultTopBadgeScale: 100,
    defaultTopBadgeOffsetX: 0,
    defaultTopBadgeOffsetY: 0,
    defaultExtraBadgeScale: null,
    defaultExtraBadgeOffsetX: null,
    defaultExtraBadgeOffsetY: null,
    defaultExtraBadgeStyle: null,
    defaultGenreBadgeScale: 100,
    defaultGenreBadgeOffsetX: 0,
    defaultGenreBadgeOffsetY: 0,
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
    defaultLogoAnchor: "auto",
    defaultQualityAnchor: "auto",
    defaultTopBadgeAnchor: "auto",
    defaultExtraBadgeAnchor: "auto",
    defaultBottomAnchor: "auto",
    defaultNetworkLogoFollowTitle: true,
    defaultPreRelease: true,
    defaultRibbonEnabled: true,
    defaultRibbonSide: "left",
    defaultPosterLayout: "fresh",
    defaultPosterFreshScope: "ranked",
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
      extraBadgeScale: null,
      extraBadgeOffsetX: null,
      extraBadgeOffsetY: null,
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
      networkLogoFollowTitle: true,
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
      extraBadgeStyle: "follow-rank",
      badgeFont: "inter",
      qualityBadgeStyle: "color",
      videoFormats: ["dv", "atmos", "imax", "hdr", "hdr10plus"],
      sashOrder: ["upcoming", "rank", "new", "award", "extra"],
      networkLogo: true,
      networkLogoPosition: "auto",
      logoAnchor: "auto",
      qualityAnchor: "auto",
      topBadgeAnchor: "auto",
      extraBadgeAnchor: "auto",
      bottomAnchor: "auto",
      preRelease: true,
      ribbonEnabled: true,
      ribbonSide: "left",
      posterLayout: "fresh",
      posterFreshScope: "ranked",
    },
  } as VisualPresetValues)
