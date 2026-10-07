import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES, EXTRA_BADGE_STYLES, QUALITY_BADGE_STYLES, BADGE_FONTS, SEPARATE_RATINGS_STYLES } from "./badge-styles"
import { SASH_BUCKETS } from "./badge-priority"
import type { LandscapeServerDefaults } from "./server-defaults"

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
  // Profilo visuale completo per formato (stesse semantiche di
  // `LandscapeServerDefaults`, mai nuove): assente = eredita i flat.
  // Solo chiavi con corrispondenza flat<->profilo, piu le landscape-only
  // gia supportate dal renderer (extraBadgeStyle/badgeFont/wide).
  globalBadges: z.boolean().optional(), rankingBadges: z.boolean().optional(),
  badgeGenre: z.boolean().optional(), badgeYear: z.boolean().optional(),
  badgeRating: z.boolean().optional(), badgeQuality: z.boolean().optional(),
  customRatings: z.boolean().optional(), separateRatings: z.boolean().optional(),
  badgeStyle: z.enum(BADGE_STYLES).optional(),
  rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).optional(),
  extraBadgeStyle: z.enum(EXTRA_BADGE_STYLES).nullable().optional(),
  badgeFont: z.enum(BADGE_FONTS).nullable().optional(),
  qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
  videoFormats: z.array(z.enum(["dv", "hdr", "hdr10plus", "atmos", "imax"])).max(5).nullable().optional(),
  sashOrder: z.array(z.enum(SASH_BUCKETS)).max(SASH_BUCKETS.length).optional(),
  networkLogo: z.boolean().optional(), networkLogoPosition: z.enum(["auto", "top"]).optional(),
  preRelease: z.boolean().optional(),
  ribbonEnabled: z.boolean().optional(), ribbonSide: z.enum(["left", "right"]).optional(),
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
/** Orientation list an entry belongs to. Legacy entries without shape read as portrait. */
export const visualPresetShapeSchema = z.enum(["portrait", "landscape"])
export type VisualPresetShape = z.infer<typeof visualPresetShapeSchema>
export const visualPresetInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  shape: visualPresetShapeSchema.default("portrait"),
  values: visualPresetValuesSchema,
}).strict()
export const visualPresetSchema = visualPresetInputSchema.extend({ id: z.string().uuid() })
export const visualPresetDeleteSchema = z.object({
  id: z.string().uuid(),
  shape: visualPresetShapeSchema.default("portrait"),
}).strict()
export type VisualPreset = z.infer<typeof visualPresetSchema>
/** Quota applies PER shape: 20 portrait + 20 landscape, same name allowed across shapes. */
export const MAX_VISUAL_PRESETS = 20

export function captureVisualPreset(source: VisualPresetValues): VisualPresetValues {
  return visualPresetValuesSchema.parse(Object.fromEntries(
    Object.keys(visualPresetValuesSchema.shape).map((key) => [
      key,
      // Nested landscape passes through raw: pick only schema-known keys so
      // profile overrides outside the preset contract never crash capture.
      // Drop explicit `undefined` too: fromEntries would otherwise mint own
      // undefined keys that zod preserves through parse (invisible to JSON
      // but fatal to Object.assign/spread overlays, which copy undefined over
      // real values). Absent always means "inherit".
      key === "landscape" && source.landscape && typeof source.landscape === "object"
        ? Object.fromEntries(
            Object.entries(source.landscape as Record<string, unknown>).filter(
              ([k, v]) => v !== undefined && k in landscapeSchema.shape,
            ),
          )
        : source[key as keyof VisualPresetValues],
    ]),
  ))
}

/**
 * Canonical flat `defaultX` -> landscape profile `x` key map (same content as
 * the Badge tab `PRESET_TO_LAND`: rating sources, logo align, fit flags and
 * delivery shape stay global and are intentionally absent).
 */
export const PRESET_FLAT_TO_LANDSCAPE: Record<string, keyof LandscapeServerDefaults> = {
  defaultGlobalBadges: "globalBadges",
  defaultRankingBadges: "rankingBadges",
  defaultBadgeGenre: "badgeGenre",
  defaultBadgeYear: "badgeYear",
  defaultBadgeRating: "badgeRating",
  defaultBadgeQuality: "badgeQuality",
  defaultCustomRatings: "customRatings",
  defaultSeparateRatings: "separateRatings",
  defaultSeparateRatingsStyle: "separateRatingsStyle",
  defaultBadgeStyle: "badgeStyle",
  defaultRankingBadgeStyle: "rankingBadgeStyle",
  defaultBadgeFont: "badgeFont",
  defaultQualityBadgeStyle: "qualityBadgeStyle",
  defaultVideoFormats: "videoFormats",
  defaultSashOrder: "sashOrder",
  defaultNetworkLogo: "networkLogo",
  defaultNetworkLogoPosition: "networkLogoPosition",
  defaultPreRelease: "preRelease",
  defaultRibbonEnabled: "ribbonEnabled",
  defaultRibbonSide: "ribbonSide",
  defaultLogoScale: "logoScale",
  defaultLogoOffsetX: "logoOffsetX",
  defaultLogoOffsetY: "logoOffsetY",
  defaultBlurEnabled: "blurEnabled",
  defaultBlurIntensity: "blurIntensity",
  defaultBlurFade: "blurFade",
  defaultBlurDarkness: "blurDarkness",
  defaultTintStrength: "tintStrength",
  defaultTopShade: "topShade",
  defaultGradientHeight: "gradientHeight",
  defaultTopBadgeScale: "topBadgeScale",
  defaultTopBadgeOffsetX: "topBadgeOffsetX",
  defaultTopBadgeOffsetY: "topBadgeOffsetY",
  defaultGenreBadgeScale: "genreBadgeScale",
  defaultGenreBadgeOffsetX: "genreBadgeOffsetX",
  defaultGenreBadgeOffsetY: "genreBadgeOffsetY",
  defaultQualityBadgeScale: "qualityBadgeScale",
  defaultQualityBadgeOffsetX: "qualityBadgeOffsetX",
  defaultQualityBadgeOffsetY: "qualityBadgeOffsetY",
  defaultSeparateBadgeScale: "separateBadgeScale",
  defaultSeparateBadgeOffsetX: "separateBadgeOffsetX",
  defaultSeparateBadgeOffsetY: "separateBadgeOffsetY",
  defaultNetworkLogoScale: "networkLogoScale",
  defaultNetworkLogoOffsetX: "networkLogoOffsetX",
  defaultNetworkLogoOffsetY: "networkLogoOffsetY",
}

/**
 * Portrait projection: mapped flat keys ONLY (allowlist, not all flats).
 * Excluded and why:
 * - `landscape`: the other orientation profile — portrait never writes it
 *   (frozen separately by `applyPortraitIsolated`).
 * - `defaultPosterShape`: delivery format, never follows a preset (Badge tab precedent).
 * - `defaultRatingSources`: vote sources shared by server design, no profile key.
 * - `defaultLogoAlign`, `defaultPortraitFitEnabled`, `defaultLandscapeFitEnabled`:
 *   global toggles affecting both formats, no per-shape counterpart.
 * (Credentials/providers/catalogs/region/date-format were never in presets.)
 */
export function portraitPresetPatch(values: VisualPresetValues): Partial<VisualPresetValues> {
  const source = values as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const flatKey of Object.keys(PRESET_FLAT_TO_LANDSCAPE)) {
    const v = source[flatKey]
    if (v !== undefined) out[flatKey] = v
  }
  return out as Partial<VisualPresetValues>
}

/**
 * Landscape apply patch: profile ONLY, zero flat/global side effects.
 * Flat-derived keys resolve first, the snapshot's own nested landscape wins
 * (same precedence as the Badge tab snapshot apply). Absent keys stay absent
 * (inherit flats at render via `effectiveDefaultsForShape`).
 */
export function landscapeProfilePatch(values: VisualPresetValues): Partial<LandscapeServerDefaults> {
  const patch: Record<string, unknown> = {}
  for (const [flatKey, landKey] of Object.entries(PRESET_FLAT_TO_LANDSCAPE)) {
    const v = (values as Record<string, unknown>)[flatKey]
    if (v !== undefined) patch[landKey] = v
  }
  if (values.landscape) {
    for (const [k, v] of Object.entries(values.landscape)) {
      if (v !== undefined) patch[k] = v
    }
  }
  return patch as Partial<LandscapeServerDefaults>
}

/** Reverse lookup for effective resolution (profile key -> flat key). */
const LANDSCAPE_TO_FLAT: Record<string, string> = Object.fromEntries(
  Object.entries(PRESET_FLAT_TO_LANDSCAPE).map(([flatKey, landKey]) => [landKey, flatKey]),
)

/**
 * Profile keys where explicit `null` means "inherit the flat" on BOTH sides
 * (server spread keeps null, every consumer normalizes: `pick(land.x ??
 * undefined, flat)` in poster-url.ts, `??` chains in poster-config.ts and
 * client `land ?? flat`). Logo scale/offsets are NOT in here: their null is
 * an explicit auto/zero contract that wins `pick`. Keep in sync with the
 * poster-url normalization list.
 */
const NULL_INHERIT_LANDSCAPE_KEYS = new Set(["extraBadgeStyle", "badgeFont", "qualityBadgeStyle", "videoFormats"])

function presetValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/**
 * Effective landscape profile: every supported key resolved as
 * profile-override ?? flat (same precedence as `useShapeBadgeDefaults` and
 * server `effectiveDefaultsForShape`, plus the established null-inheritance:
 * explicit `null` on NULL_INHERIT_LANDSCAPE_KEYS falls through to the flat,
 * logo nulls stay explicit per the auto/zero contract). Landscape-only keys
 * pass through raw. Absent stays absent (still inherits at render). Used for
 * landscape saves and highlight. Never emits `null` for inherit-null keys,
 * so save bodies stay strict-clean.
 */
export function resolveEffectiveLandscape(values: VisualPresetValues): VisualPresetValues["landscape"] {
  const land = ((values.landscape ?? {}) as Record<string, unknown>)
  const source = values as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const landKey of Object.keys(landscapeSchema.shape)) {
    const raw = land[landKey]
    if (raw !== undefined && !(raw === null && NULL_INHERIT_LANDSCAPE_KEYS.has(landKey))) {
      out[landKey] = raw
      continue
    }
    const flatKey = LANDSCAPE_TO_FLAT[landKey]
    if (flatKey !== undefined) {
      const v = source[flatKey]
      if (v !== undefined && !(v === null && NULL_INHERIT_LANDSCAPE_KEYS.has(landKey))) out[landKey] = v
    }
  }
  return out as VisualPresetValues["landscape"]
}

/**
 * Portrait apply with effective-landscape preservation (single atomic patch
 * for a merge-`update`): FIRST freeze the current effective landscape into
 * the profile for keys the preset will change while the profile inherits
 * them — absent keys AND explicit `null` on null-inheriting keys (both mean
 * "follow the flat" on both sides); existing concrete overrides (including
 * explicit logo `null`, which is an auto/zero choice, not inheritance) are
 * untouched. THEN write the mapped portrait flats. Globals and delivery stay
 * byte-identical, so the other format's effective output cannot move.
 * Surgical: keys the preset leaves equal keep inheriting (sparsity).
 * NOTE: `current.landscape` may carry raw extras outside the preset contract
 * (e.g. server-supported `minQuality`); they pass through opaquely — callers
 * must merge the raw profile in (UI does), never a schema-stripped copy.
 */
export function applyPortraitIsolated(current: VisualPresetValues, preset: VisualPresetValues): VisualPresetValues {
  const cur = current as unknown as Record<string, unknown>
  const pre = preset as unknown as Record<string, unknown>
  const landscape = { ...((cur.landscape as Record<string, unknown> | undefined) ?? {}) }
  for (const [flatKey, landKey] of Object.entries(PRESET_FLAT_TO_LANDSCAPE)) {
    const inherited = landscape[landKey] === undefined ||
      (landscape[landKey] === null && NULL_INHERIT_LANDSCAPE_KEYS.has(landKey))
    if (inherited && pre[flatKey] !== undefined && cur[flatKey] !== undefined && !presetValuesEqual(pre[flatKey], cur[flatKey])) {
      landscape[landKey] = cur[flatKey]
    }
  }
  return { ...current, ...portraitPresetPatch(preset), landscape } as unknown as VisualPresetValues
}

/**
 * Landscape apply, symmetric counterpart: profile ONLY (current profile
 * extras — including raw keys outside the preset contract — preserved
 * underneath, snapshot wins on top), flats/globals/delivery byte-identical —
 * portrait effective output cannot move. Single atomic patch for a
 * merge-`update`. Callers must pass the raw profile in `current.landscape`
 * (see applyPortraitIsolated NOTE).
 */
export function applyLandscapeIsolated(current: VisualPresetValues, preset: VisualPresetValues): VisualPresetValues {
  const currentLand = { ...(((current.landscape ?? {}) as unknown) as Record<string, unknown>) }
  const patch = landscapeProfilePatch(preset) as unknown as Record<string, unknown>
  return { ...current, landscape: { ...currentLand, ...patch } } as unknown as VisualPresetValues
}
