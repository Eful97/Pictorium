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
  extraBadgeScale: scale.nullable().optional(),
  extraBadgeOffsetX: offset.nullable().optional(),
  extraBadgeOffsetY: offset.nullable().optional(),
  genreBadgeScale: scale.optional(), genreBadgeOffsetX: offset.optional(), genreBadgeOffsetY: offset.optional(),
  qualityBadgeScale: scale.optional(), qualityBadgeOffsetX: offset.optional(), qualityBadgeOffsetY: offset.optional(),
  separateBadgeScale: scale.optional(),
  separateBadgeOffsetX: offset.optional(),
  separateBadgeOffsetY: offset.optional(),
  // Stile separati per formato: opzionale (assente = segui il flat condiviso).
  separateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).optional(),
  networkLogoScale: scale.optional(), networkLogoOffsetX: offset.optional(), networkLogoOffsetY: offset.optional(),
  networkLogoFollowTitle: z.boolean().nullable().optional(),
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
  // Tuning EXTRA superiore: opzionale+nullable (preset legacy senza campo
  // restano validi; null/assente = fallback legacy classifica).
  defaultExtraBadgeScale: scale.nullable().optional(),
  defaultExtraBadgeOffsetX: offset.nullable().optional(),
  defaultExtraBadgeOffsetY: offset.nullable().optional(),
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
  // Follow aggiunto dopo: opzionale per non invalidare preset salvati
  // (legacy senza campo) né forzare lo stato editor; null/assente = eredita.
  defaultNetworkLogoFollowTitle: z.boolean().nullable().optional(),
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

/**
 * Normalize a preset snapshot's extra tuning to its own classifica values
 * (per axis, flat + nested landscape profile with flat fallback): a legacy
 * preset without explicit extra renders with its own rank tuning, so the
 * normalized form is what apply writes and what highlight compares. Modern
 * explicit extra always wins (never overwritten). Key order follows the
 * schema sequences, so normalized snapshots stringify identically on both
 * sides of a highlight compare. Pure.
 */
/**
 * Snapshot shape accepted by normalizePresetExtraTuning (full preset values,
 * portrait projections and bare landscape profiles all satisfy it).
 */
export interface ExtraNormalizableSnapshot {
  defaultTopBadgeScale?: number | null
  defaultTopBadgeOffsetX?: number | null
  defaultTopBadgeOffsetY?: number | null
  defaultExtraBadgeScale?: number | null
  defaultExtraBadgeOffsetX?: number | null
  defaultExtraBadgeOffsetY?: number | null
  topBadgeScale?: number | null
  topBadgeOffsetX?: number | null
  topBadgeOffsetY?: number | null
  extraBadgeScale?: number | null
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  landscape?: {
    topBadgeScale?: number | null
    topBadgeOffsetX?: number | null
    topBadgeOffsetY?: number | null
    extraBadgeScale?: number | null
    extraBadgeOffsetX?: number | null
    extraBadgeOffsetY?: number | null
  } | null
  [k: string]: unknown
}

export function normalizePresetExtraTuning<T extends ExtraNormalizableSnapshot>(snapshot: T): T {
  const flat = { ...(snapshot as Record<string, unknown>) }
  // Original flat extra (pre-fill): the landscape fallback must see the
  // snapshot's own values, not the filled ones below.
  const origFlatExS = flat.defaultExtraBadgeScale
  const origFlatExX = flat.defaultExtraBadgeOffsetX
  const origFlatExY = flat.defaultExtraBadgeOffsetY
  // Flat defaults level.
  if (flat.defaultExtraBadgeScale == null && flat.defaultTopBadgeScale != null)
    flat.defaultExtraBadgeScale = flat.defaultTopBadgeScale
  if (flat.defaultExtraBadgeOffsetX == null && flat.defaultTopBadgeOffsetX != null)
    flat.defaultExtraBadgeOffsetX = flat.defaultTopBadgeOffsetX
  if (flat.defaultExtraBadgeOffsetY == null && flat.defaultTopBadgeOffsetY != null)
    flat.defaultExtraBadgeOffsetY = flat.defaultTopBadgeOffsetY
  // Bare profile level (resolveEffectiveLandscape outputs the profile
  // itself, not wrapped): same fill from its own rank tuning.
  if (flat.extraBadgeScale == null && flat.topBadgeScale != null)
    flat.extraBadgeScale = flat.topBadgeScale
  if (flat.extraBadgeOffsetX == null && flat.topBadgeOffsetX != null)
    flat.extraBadgeOffsetX = flat.topBadgeOffsetX
  if (flat.extraBadgeOffsetY == null && flat.topBadgeOffsetY != null)
    flat.extraBadgeOffsetY = flat.topBadgeOffsetY
  // Nested landscape profile, only when it carries its own rank look
  // (otherwise it keeps inheriting and stays sparse): missing axes resolve
  // exactly like the server (profile extra > flat extra > profile rank >
  // flat rank), so filling is pixel-identical either way.
  const land = flat.landscape
  if (land != null && typeof land === "object") {
    const l = { ...(land as Record<string, unknown>) }
    const landHasRank = l.topBadgeScale !== undefined || l.topBadgeOffsetX !== undefined || l.topBadgeOffsetY !== undefined
    if (landHasRank) {
      if (l.extraBadgeScale == null)
        l.extraBadgeScale = origFlatExS ?? l.topBadgeScale ?? flat.defaultTopBadgeScale
      if (l.extraBadgeOffsetX == null)
        l.extraBadgeOffsetX = origFlatExX ?? l.topBadgeOffsetX ?? flat.defaultTopBadgeOffsetX
      if (l.extraBadgeOffsetY == null)
        l.extraBadgeOffsetY = origFlatExY ?? l.topBadgeOffsetY ?? flat.defaultTopBadgeOffsetY
    }
    flat.landscape = l
  }
  // Canonical key order (schema sequences): filled keys must not trail after
  // raw literals, or identical looks stringify differently. Bare profiles
  // follow the landscape sequence instead.
  const bareProfile = !("defaultTopBadgeScale" in flat) && !("defaultExtraBadgeScale" in flat)
    && ("topBadgeScale" in flat || "extraBadgeScale" in flat)
  const topOrder = bareProfile
    ? Object.keys(landscapeSchema.shape)
    : Object.keys(visualPresetValuesSchema.shape)
  const ordered: Record<string, unknown> = {}
  for (const k of topOrder) {
    if (k in flat) ordered[k] = flat[k]
  }
  for (const k of Object.keys(flat)) {
    if (!(k in ordered)) ordered[k] = flat[k]
  }
  const orderedLand = ordered.landscape
  if (orderedLand != null && typeof orderedLand === "object") {
    const l = orderedLand as Record<string, unknown>
    const landOrdered: Record<string, unknown> = {}
    for (const k of Object.keys(landscapeSchema.shape)) {
      if (k in l) landOrdered[k] = l[k]
    }
    for (const k of Object.keys(l)) {
      if (!(k in landOrdered)) landOrdered[k] = l[k]
    }
    ordered.landscape = landOrdered
  }
  return ordered as T
}

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
  defaultNetworkLogoFollowTitle: "networkLogoFollowTitle",
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
  defaultExtraBadgeScale: "extraBadgeScale",
  defaultExtraBadgeOffsetX: "extraBadgeOffsetX",
  defaultExtraBadgeOffsetY: "extraBadgeOffsetY",
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
  const flatFixed = isFlatFixedLayer(values as unknown as Record<string, unknown>)
  for (const [flatKey, landKey] of Object.entries(PRESET_FLAT_TO_LANDSCAPE)) {
    if (flatFixed && NO_FLAT_DERIVED_LANDSCAPE_KEYS.has(landKey)) continue
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

/**
 * Network fixed coords never derive from the flat into the landscape
 * profile WHEN the flat layer is fixed (follow===false): absolute coords are
 * per-shape, and a flat copy would later read as an explicit fixed landscape
 * layer (portrait values rendered on LAND). In ON mode the legacy
 * derive/freeze is preserved byte-identically (relative offsets keep
 * inheriting at render via `??` chains). The toggle keeps its flat
 * derivation (harmless: coords gate the fixed layer). Explicit profile
 * values always pass through untouched.
 */
const NO_FLAT_DERIVED_LANDSCAPE_KEYS = new Set(["networkLogoOffsetX", "networkLogoOffsetY"])

/** True when the flat network layer is fixed (absolute portrait coords). */
function isFlatFixedLayer(values: Record<string, unknown>): boolean {
  return values["defaultNetworkLogoFollowTitle"] === false
}

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
  const flatFixed = isFlatFixedLayer(source)
  const out: Record<string, unknown> = {}
  for (const landKey of Object.keys(landscapeSchema.shape)) {
    const raw = land[landKey]
    if (raw !== undefined && !(raw === null && NULL_INHERIT_LANDSCAPE_KEYS.has(landKey))) {
      out[landKey] = raw
      continue
    }
    if (flatFixed && NO_FLAT_DERIVED_LANDSCAPE_KEYS.has(landKey)) continue
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
  // Mai congelare coordinate assolute da un flat fixed (né verso un preset
  // fixed): creerebbero un fixed landscape finto con valori portrait.
  const skipCoords = isFlatFixedLayer(cur) || isFlatFixedLayer(pre)
  for (const [flatKey, landKey] of Object.entries(PRESET_FLAT_TO_LANDSCAPE)) {
    if (skipCoords && NO_FLAT_DERIVED_LANDSCAPE_KEYS.has(landKey)) continue
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
