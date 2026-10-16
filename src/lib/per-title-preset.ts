import type { DefaultsState } from "./useDefaults"
import { clearedExtraForPresetApply } from "./extra-materialize"
import {
  normalizePersonalPreset,
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
 * `extraBadgeStyle` audit: the portrait title owns its own extra-badge look
 * (the mapping persists a flat `extraBadgeStyle`), so portrait writes the
 * snapshot's own flat style verbatim — legacy `null`/omitted (which renders
 * follow-own-rank) stays `null`, never the live title's tuned style.
 * Landscape writes the effective profile style, canonically normalized so a
 * legacy snapshot without a profile style owns the explicit follow-own-rank
 * marker instead of inheriting the live title's look (absent = the marker,
 * never preserved live — same canonical fallback as the global personal
 * normalize, never the previous look).
 *
 * `posterLayout`/`posterFreshScope` audit: both persist per-title (flat +
 * landscape profile, like the other shared visuals), so both shapes write
 * the snapshot's own values verbatim — ready six resolve Standard, Fresh
 * resolves fresh+ranked, personal resolves its stored recipe. Legacy
 * snapshots without the keys resolve the canonical factory values
 * (standard/ranked, same source as the global defaults) — never the live
 * title's layout. `ageBadge`/`ageCountry`/`ageBadgeStyle` stay out of the
 * projection by design (the mapping carries the keys, but presets own the
 * shared visual recipe — age is edited via the dedicated per-title control,
 * never invented from a preset snapshot; the chooser says so explicitly).
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
  | "posterLayout"
  | "posterFreshScope"
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
  | "topShadeHeight"
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
  topShadeHeight?: number
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
  "topShadeHeight",
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
  "defaultTopShadeHeight",
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
    // Canonical owned fill first (shared single truth with the global
    // personal path): legacy snapshots without layout/scope/extra resolve
    // the factory values — never the live title's look. Stored data is
    // never rewritten (pure projection of a copy).
    const flat = (normalizePersonalPreset(values) as unknown as Record<string, unknown>)
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
    // NOTE: no `ribbonSide` write above by design (no per-title
    // persistence — save drops it, load forces the global default).
    // Owned appearance flats (the preset map predates them): verbatim from
    // the normalized snapshot — legacy `null`/filled-canonical (follow own
    // rank / standard / ranked) wins over the live title, never inherits it.
    // A nested landscape profile style never leaks in (portrait reads the
    // flat only). Age is excluded by design (dedicated per-title control —
    // never projected from a preset).
    setBare("extraBadgeStyle", flat.defaultExtraBadgeStyle)
    setBare("posterLayout", flat.defaultPosterLayout)
    setBare("posterFreshScope", flat.defaultPosterFreshScope)
    const logo = resolveLogoPatch(
      flat.defaultLogoScale as number | null | undefined,
      flat.defaultLogoOffsetX as number | null | undefined,
      flat.defaultLogoOffsetY as number | null | undefined,
    )
    return { bare, logo, landscapeBlur: {} }
  }
  // Landscape: effective profile (explicit ?? flat), bare targets only.
  // Normalized first (shared single truth): legacy snapshots without owned
  // keys resolve the canonical factory values — never the live title — and
  // an inheriting extra-style profile materializes the explicit
  // follow-own-rank marker, so the edited landscape owns its full recipe.
  // `sashOrder` has no per-title target and is absent from the allowlist
  // below by design (global-only). Age is excluded by design (dedicated
  // per-title control — never projected from a preset).
  const eff = resolveEffectiveLandscape(normalizePersonalPreset(values)) as unknown as Record<string, unknown>
  const effBare: PerTitleVisualBareKey[] = [
    "globalBadges", "rankingBadges",
    "badgeGenre", "badgeYear", "badgeRating", "badgeQuality",
    "customRatings", "separateRatings", "separateRatingsStyle",
    "badgeStyle", "rankingBadgeStyle",
    "posterLayout", "posterFreshScope",
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
  // Effective extra style (always defined after the canonical normalize:
  // explicit profile wins, a concrete stored flat materializes, legacy
  // owns the follow-own-rank marker) — verbatim, never the live title.
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
