import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES, QUALITY_BADGE_STYLES, BADGE_FONTS, SEPARATE_RATINGS_STYLES } from "./badge-styles"
import { SASH_BUCKETS } from "./badge-priority"

const percent = z.number().finite().min(0).max(100)
const scale = z.number().finite().min(10).max(200)
const offset = z.number().finite().min(-2000).max(2000)
const logoScale = scale.nullable()
const landscapeSchema = z.object({
  logoScale: logoScale.optional(), logoOffsetX: offset.nullable().optional(), logoOffsetY: offset.nullable().optional(),
  gradientHeight: percent.optional(), blurEnabled: z.boolean().optional(), blurIntensity: percent.optional(),
  blurFade: percent.optional(), blurDarkness: percent.optional(), tintStrength: percent.optional(), topShade: percent.optional(),
  topBadgeScale: scale.optional(), topBadgeOffsetX: offset.optional(), topBadgeOffsetY: offset.optional(),
  genreBadgeScale: scale.optional(), genreBadgeOffsetX: offset.optional(), genreBadgeOffsetY: offset.optional(),
  qualityBadgeScale: scale.optional(), qualityBadgeOffsetX: offset.optional(), qualityBadgeOffsetY: offset.optional(),
  separateBadgeScale: scale.optional(),
  separateBadgeOffsetX: offset.optional(),
  separateBadgeOffsetY: offset.optional(),
  // Stile separati per formato: opzionale (assente = segui il flat condiviso).
  separateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).optional(),
  networkLogoScale: scale.optional(), networkLogoOffsetX: offset.optional(), networkLogoOffsetY: offset.optional(),
}).strict()

/** Only visual defaults: credentials, providers, catalogs and region never enter a preset. */
export const visualPresetValuesSchema = z.object({
  defaultGlobalBadges: z.boolean(), defaultRankingBadges: z.boolean(),
  defaultBadgeGenre: z.boolean(), defaultBadgeYear: z.boolean(), defaultBadgeRating: z.boolean(), defaultBadgeQuality: z.boolean(),
  defaultCustomRatings: z.boolean(), defaultSeparateRatings: z.boolean(),
  defaultRatingSources: z.array(z.string().max(20)).max(20),
  defaultSashOrder: z.array(z.enum(SASH_BUCKETS)).max(SASH_BUCKETS.length),
  defaultBadgeStyle: z.enum(BADGE_STYLES), defaultRankingBadgeStyle: z.enum(RANKING_BADGE_STYLES),
  // Preset salvati prima del selettore font: assente = "inter" (resa storica).
  defaultBadgeFont: z.enum(BADGE_FONTS).default("inter"),
  defaultQualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES),
  defaultVideoFormats: z.array(z.enum(["dv", "hdr", "hdr10plus", "atmos", "imax"])).max(5),
  defaultLogoScale: logoScale, defaultLogoOffsetX: offset.nullable(), defaultLogoOffsetY: offset.nullable(),
  defaultBlurEnabled: z.boolean(), defaultBlurIntensity: percent, defaultBlurFade: percent, defaultBlurDarkness: percent,
  defaultTintStrength: percent, defaultTopShade: percent, defaultGradientHeight: percent,
  defaultTopBadgeScale: scale, defaultTopBadgeOffsetX: offset, defaultTopBadgeOffsetY: offset,
  defaultGenreBadgeScale: scale, defaultGenreBadgeOffsetX: offset, defaultGenreBadgeOffsetY: offset,
  defaultQualityBadgeScale: scale, defaultQualityBadgeOffsetX: offset, defaultQualityBadgeOffsetY: offset,
  // Scala separati aggiunta dopo: default(130) per i preset salvati senza campo
  // (legacy); un 100 salvato esplicito si preserva (niente migrazione).
  defaultSeparateBadgeScale: scale.default(130),
  // Offset separati: default 0 per i preset salvati senza campo
  // (byte-identici ai legacy).
  defaultSeparateBadgeOffsetX: offset.default(0),
  defaultSeparateBadgeOffsetY: offset.default(0),
  // Stile separati aggiunto dopo: default("column") per non invalidare i preset salvati.
  defaultSeparateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).default("column"),
  defaultNetworkLogoScale: scale, defaultNetworkLogoOffsetX: offset, defaultNetworkLogoOffsetY: offset,
  defaultNetworkLogo: z.boolean(), defaultNetworkLogoPosition: z.enum(["auto", "top"]), defaultPreRelease: z.boolean(),
  defaultRibbonEnabled: z.boolean(), defaultRibbonSide: z.enum(["left", "right"]),
  defaultPosterShape: z.enum(["poster", "landscape"]), defaultLogoAlign: z.enum(["left", "center"]).nullable(),
  defaultPortraitFitEnabled: z.boolean(), defaultLandscapeFitEnabled: z.boolean(),
  landscape: landscapeSchema,
}).strict()

export type VisualPresetValues = z.infer<typeof visualPresetValuesSchema>
export const visualPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  values: visualPresetValuesSchema,
}).strict()
export const visualPresetSchema = visualPresetInputSchema.extend({ id: z.string().uuid() })
export type VisualPreset = z.infer<typeof visualPresetSchema>
export const MAX_VISUAL_PRESETS = 20

export function captureVisualPreset(source: VisualPresetValues): VisualPresetValues {
  return visualPresetValuesSchema.parse(Object.fromEntries(
    Object.keys(visualPresetValuesSchema.shape).map((key) => [key, source[key as keyof VisualPresetValues]]),
  ))
}
