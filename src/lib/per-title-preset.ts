import type { DefaultsState } from "./useDefaults"
import { clearedExtraForPresetApply } from "./extra-materialize"
import {
  PRESET_FLAT_TO_LANDSCAPE,
  resolveEffectiveLandscape,
  type VisualPresetValues,
} from "./visual-presets"

/**
 * Per-title visual preset projection (EditView quick chooser, task 1).
 *
 * A built-in/saved visual snapshot (`VisualPresetValues`, defaults-space)
 * projected onto the CURRENT title's live editor state ONLY: no global
 * defaults change, no autosave, artwork/current orientation/opposite
 * gradient preserved. The legacy `applyVisualPreset` in
 * PosterEditorContext writes `default*` keys and MUST NOT be reused here.
 *
 * Shape rule: `poster` projects the mapped portrait flats; `landscape`
 * projects `resolveEffectiveLandscape` (profile override ?? flat, same
 * precedence as `useShapeBadgeDefaults` and the server
 * `effectiveDefaultsForShape`).
 *
 * Excluded and why (mirrors the isolated defaults-space semantics):
 * - `sashOrder`: global-only, no per-title field (save resolves the badge
 *   from `defaultSashOrder` at save time).
 * - `ratingSources`: vote data sources, not visuals (isolated helpers omit
 *   `defaultRatingSources` too).
 * - `logoAlign`: orientation-driven (`center` in portrait, global default or
 *   `left` in landscape), never follows a preset per-title.
 * - fit flags / `posterShape`: delivery, never follow a preset (the current
 *   orientation is preserved).
 * - `ribbonSide`: no per-title persistence (save drops it, load forces the
 *   global default, per-title UI omits it) — writing it would create
 *   preview-only state no other per-title path can produce.
 * - everything else global (credentials, providers, catalogs, region,
 *   date-format, episode source), artwork (posters/backdrops/logos,
 *   scales, rotation, exclusions, `logoDisabled`) and Badge Lab binding
 *   (`customBadge`, `badgePresetId/Rev`): never in the patch.
 * - `preRelease` IS included: preview-consumed per-title live flag with an
 *   existing per-title projection precedent (`applyFreshLandscapeDefaults`).
 *
 * Extra axes: legacy presets (missing/null extra) clear the TARGET shape's
 * axes to null via `clearedExtraForPresetApply` (follow the layer's own
 * rank, keeps legacy URLs) — never materialized into explicit coordinates.
 * Explicit preset values always win.
 *
 * `extraBadgeStyle` audit: full presets carry no flat extra style (the key
 * predates the preset schema), so portrait NEVER writes it — a landscape-only
 * style from the preset's nested profile must not leak into the portrait
 * title. Landscape writes it only when the effective profile defines it
 * (absent = preserve the title's style, like the built-in applies).
 *
 * Network follow: `null`/absent follow = inherit the title's current layer
 * (untouched). In landscape with a non-boolean follow, offsets are omitted
 * too (full inheritance). Fixed layers never copy portrait absolutes into
 * landscape: `resolveEffectiveLandscape` already skips the flat derivation
 * (`NO_FLAT_DERIVED_LANDSCAPE_KEYS`), so absent effective coords stay absent.
 *
 * Logo/gradient split: `logoScale`/offsets and the landscape gradient live
 * in separate local state (`useState`, not `DefaultsState`), so they are
 * returned separately for the context action to apply via the correct local
 * setters. Logo contract: scale `null` (documented auto-fit) is emitted as
 * an explicit auto-fit request (`logo.scale = null`, resolved by the caller
 * via `logoDefaultScale(logo) ?? 75`); `undefined` (absent) = inherit the
 * title's live value (skipped). Offsets `null` = 0. Pure.
 */

/** Bare per-title keys this projection may write (typed allowlist). */
export type PerTitleVisualBareKey =
  | "globalBadges"
  | "rankingBadges"
  | "badgeGenre"
  | "badgeYear"
  | "badgeRating"
  | "badgeQuality"
  | "customRatings"
  | "separateRatings"
  | "separateRatingsStyle"
  | "badgeStyle"
  | "rankingBadgeStyle"
  | "extraBadgeStyle"
  | "badgeFont"
  | "qualityBadgeStyle"
  | "videoFormats"
  | "networkLogo"
  | "networkLogoPosition"
  | "networkLogoFollowTitle"
  | "preRelease"
  | "ribbonEnabled"
  | "gradientHeight"
  | "blurEnabled"
  | "blurIntensity"
  | "blurFade"
  | "blurDarkness"
  | "tintStrength"
  | "topShade"
  | "topBadgeScale"
  | "topBadgeOffsetX"
  | "topBadgeOffsetY"
  | "extraBadgeScale"
  | "extraBadgeOffsetX"
  | "extraBadgeOffsetY"
  | "genreBadgeScale"
  | "genreBadgeOffsetX"
  | "genreBadgeOffsetY"
  | "qualityBadgeScale"
  | "qualityBadgeOffsetX"
  | "qualityBadgeOffsetY"
  | "separateBadgeScale"
  | "separateBadgeOffsetX"
  | "separateBadgeOffsetY"
  | "networkLogoScale"
  | "networkLogoOffsetX"
  | "networkLogoOffsetY"

export type PerTitleVisualBarePatch = Partial<Pick<DefaultsState, PerTitleVisualBareKey>>

/** Logo transform patch (local state): null scale = auto-fit request, undefined = skip; offsets null resolved to 0. */
export interface PerTitleLogoPatch {
  scale?: number | null
  offsetX?: number
  offsetY?: number
}

/** Landscape gradient patch (local `landscapeBlur` state, active shape only). */
export interface PerTitleLandscapeBlurPatch {
  gradientHeight?: number
  blurEnabled?: boolean
  blurIntensity?: number
  blurFade?: number
  blurDarkness?: number
  tintStrength?: number
  topShade?: number
}

export interface PerTitleVisualProjection {
  /** Atomic bare-key update for `update()` (single merge, no default*). */
  bare: PerTitleVisualBarePatch
  /** Applied via the local logo setters (never `update()`). */
  logo: PerTitleLogoPatch
  /** Landscape only: applied via `setLandscapeBlur` (marks dirty, like edits). */
  landscapeBlur: PerTitleLandscapeBlurPatch
}

/** Gradient keys: portrait = bare flats, landscape = local profile state. */
const GRADIENT_BARE_KEYS = [
  "gradientHeight",
  "blurEnabled",
  "blurIntensity",
  "blurFade",
  "blurDarkness",
  "tintStrength",
  "topShade",
] as const

/** Mapped flat keys with NO per-title target (global-only/delivery/data). */
const EXCLUDED_FLAT_KEYS: ReadonlySet<string> = new Set([
  "defaultSashOrder",
  "defaultRatingSources",
  "defaultLogoAlign",
  "defaultPortraitFitEnabled",
  "defaultLandscapeFitEnabled",
  "defaultPosterShape",
])

/**
 * Mapped flat keys with their own projection rule below (never in the
 * generic map loop): logo (local state), gradient (active-shape target),
 * follow (boolean-only) and extra tuning (legacy clear rule).
 */
const PORTRAIT_SPLIT_FLAT_KEYS: ReadonlySet<string> = new Set([
  "defaultLogoScale",
  "defaultLogoOffsetX",
  "defaultLogoOffsetY",
  "defaultGradientHeight",
  "defaultBlurEnabled",
  "defaultBlurIntensity",
  "defaultBlurFade",
  "defaultBlurDarkness",
  "defaultTintStrength",
  "defaultTopShade",
  "defaultNetworkLogoFollowTitle",
  "defaultExtraBadgeScale",
  "defaultExtraBadgeOffsetX",
  "defaultExtraBadgeOffsetY",
])

function resolveLogoPatch(
  scale: number | null | undefined,
  offsetX: number | null | undefined,
  offsetY: number | null | undefined,
): PerTitleLogoPatch {
  const logo: PerTitleLogoPatch = {}
  // Scale null = documented auto-fit: emit an explicit auto-fit request
  // (caller resolves via logoDefaultScale ?? 75), never preserve the live
  // value. Undefined (absent) = inherit (skip).
  if (scale === null) logo.scale = null
  else if (typeof scale === "number") logo.scale = scale
  // Offset null = 0 by contract; undefined = inherit (skip).
  if (offsetX !== undefined) logo.offsetX = offsetX ?? 0
  if (offsetY !== undefined) logo.offsetY = offsetY ?? 0
  return logo
}

/**
 * Project a full visual snapshot onto the per-title editor state for the
 * shape in editing. See the module docblock for inclusion/exclusion rules.
 */
export function projectPerTitleVisualPreset(
  values: VisualPresetValues,
  shape: "poster" | "landscape",
): PerTitleVisualProjection {
  const bare: PerTitleVisualBarePatch = {}
  const setBare = (key: PerTitleVisualBareKey, value: unknown): void => {
    if (value !== undefined) {
      ;(bare as Record<string, unknown>)[key] = value
    }
  }

  if (shape === "poster") {
    const flat = values as unknown as Record<string, unknown>
    // Mapped portrait flats via PRESET_FLAT_TO_LANDSCAPE (the map's
    // landscape names double as bare per-title keys): exclusions and
    // split-rule keys never enter the generic loop.
    for (const [flatKey, landKey] of Object.entries(PRESET_FLAT_TO_LANDSCAPE)) {
      if (EXCLUDED_FLAT_KEYS.has(flatKey)) continue
      if (PORTRAIT_SPLIT_FLAT_KEYS.has(flatKey)) continue
      // ribbonSide: a bare target exists but has no per-title persistence
      // (save drops it, load forces the global default) — never written.
      if (flatKey === "defaultRibbonSide") continue
      setBare(landKey as PerTitleVisualBareKey, flat[flatKey])
    }
    // Portrait gradient = bare flats (active shape; landscapeBlur untouched).
    for (const key of GRADIENT_BARE_KEYS) {
      setBare(key, flat[`default${key[0].toUpperCase()}${key.slice(1)}`])
    }
    // Network layer: boolean follow only (null/absent = inherit current);
    // portrait offsets are the portrait layer, always from the flat.
    const follow = flat.defaultNetworkLogoFollowTitle
    if (typeof follow === "boolean") setBare("networkLogoFollowTitle", follow)
    setBare("networkLogoOffsetX", flat.defaultNetworkLogoOffsetX)
    setBare("networkLogoOffsetY", flat.defaultNetworkLogoOffsetY)
    // Legacy extra axes: missing/null clears to null (follow own rank);
    // fully explicit extra wins verbatim. Never materialized to numbers.
    const cleared = clearedExtraForPresetApply(
      {
        scale: flat.defaultTopBadgeScale as number | null | undefined,
        offsetX: flat.defaultTopBadgeOffsetX as number | null | undefined,
        offsetY: flat.defaultTopBadgeOffsetY as number | null | undefined,
      },
      {
        scale: flat.defaultExtraBadgeScale as number | null | undefined,
        offsetX: flat.defaultExtraBadgeOffsetX as number | null | undefined,
        offsetY: flat.defaultExtraBadgeOffsetY as number | null | undefined,
      },
    )
    if (cleared) {
      setBare("extraBadgeScale", cleared.scale)
      setBare("extraBadgeOffsetX", cleared.offsetX)
      setBare("extraBadgeOffsetY", cleared.offsetY)
    } else {
      setBare("extraBadgeScale", flat.defaultExtraBadgeScale)
      setBare("extraBadgeOffsetX", flat.defaultExtraBadgeOffsetX)
      setBare("extraBadgeOffsetY", flat.defaultExtraBadgeOffsetY)
    }
    // NOTE: no `extraBadgeStyle` here by design (audit): presets carry no
    // flat extra style, and the nested landscape profile's style is
    // landscape-only — it must not leak into the portrait title.
    const logo = resolveLogoPatch(
      flat.defaultLogoScale as number | null | undefined,
      flat.defaultLogoOffsetX as number | null | undefined,
      flat.defaultLogoOffsetY as number | null | undefined,
    )
    return { bare, logo, landscapeBlur: {} }
  }
  // Landscape: effective profile (explicit ?? flat), bare targets only.
  // `sashOrder` has no per-title target and is absent from the allowlist
  // below by design (global-only). `extraBadgeStyle`/`network`/`extra`
  // tuning/gradient/logo follow in their own rules underneath.
  const eff = resolveEffectiveLandscape(values) as unknown as Record<string, unknown>
  const effBare: PerTitleVisualBareKey[] = [
    "globalBadges", "rankingBadges",
    "badgeGenre", "badgeYear", "badgeRating", "badgeQuality",
    "customRatings", "separateRatings", "separateRatingsStyle",
    "badgeStyle", "rankingBadgeStyle",
    "badgeFont", "qualityBadgeStyle", "videoFormats",
    "networkLogo", "networkLogoPosition",
    "preRelease", "ribbonEnabled",
    "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY",
    "genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY",
    "qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY",
    "separateBadgeScale", "separateBadgeOffsetX", "separateBadgeOffsetY",
    "networkLogoScale",
  ]
  for (const key of effBare) {
    setBare(key, eff[key])
  }
  // Effective extra style only when the profile defines it (absent =
  // preserve the title's style; the resolver never emits inherit-nulls).
  if (eff.extraBadgeStyle !== undefined) setBare("extraBadgeStyle", eff.extraBadgeStyle)
  // Network layer: boolean follow only; without it the whole layer is
  // inherited (offsets omitted too). Absent effective coords (flat fixed
  // without profile coords) stay absent — never portrait absolutes.
  if (typeof eff.networkLogoFollowTitle === "boolean") {
    setBare("networkLogoFollowTitle", eff.networkLogoFollowTitle)
    if (eff.networkLogoOffsetX !== undefined) setBare("networkLogoOffsetX", eff.networkLogoOffsetX)
    if (eff.networkLogoOffsetY !== undefined) setBare("networkLogoOffsetY", eff.networkLogoOffsetY)
  }
  // Legacy extra axes on the effective layer: missing/null clears to
  // null (follow own rank); fully explicit extra wins verbatim.
  const clearedLand = clearedExtraForPresetApply(
    {
      scale: eff.topBadgeScale as number | null | undefined,
      offsetX: eff.topBadgeOffsetX as number | null | undefined,
      offsetY: eff.topBadgeOffsetY as number | null | undefined,
    },
    {
      scale: eff.extraBadgeScale as number | null | undefined,
      offsetX: eff.extraBadgeOffsetX as number | null | undefined,
      offsetY: eff.extraBadgeOffsetY as number | null | undefined,
    },
  )
  if (clearedLand) {
    setBare("extraBadgeScale", clearedLand.scale)
    setBare("extraBadgeOffsetX", clearedLand.offsetX)
    setBare("extraBadgeOffsetY", clearedLand.offsetY)
  } else {
    setBare("extraBadgeScale", eff.extraBadgeScale)
    setBare("extraBadgeOffsetX", eff.extraBadgeOffsetX)
    setBare("extraBadgeOffsetY", eff.extraBadgeOffsetY)
  }
  // Active-shape gradient goes to the local landscape profile state
  // (portrait flats untouched = opposite gradient preserved).
  const landscapeBlur: PerTitleLandscapeBlurPatch = {}
  for (const key of GRADIENT_BARE_KEYS) {
    const v = eff[key]
    if (v !== undefined) {
      ;(landscapeBlur as Record<string, unknown>)[key] = v
    }
  }
  const logo = resolveLogoPatch(
    eff.logoScale as number | null | undefined,
    eff.logoOffsetX as number | null | undefined,
    eff.logoOffsetY as number | null | undefined,
  )
  return { bare, logo, landscapeBlur }
}
