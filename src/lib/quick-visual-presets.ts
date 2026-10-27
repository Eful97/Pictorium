import {
  DEFAULT_BADGE_FONT,
  DEFAULT_QUALITY_BADGE_OFFSET_X,
  DEFAULT_QUALITY_BADGE_OFFSET_Y,
  DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE,
  DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE,
  DEFAULT_QUALITY_BADGE_STYLE,
  DEFAULT_SEPARATE_RATINGS_STYLE,
  EXTRA_BADGE_FOLLOW_RANK,
  getSeparateBadgeDefaultScale,
  isExtraBadgeStyle,
  isExtraFollowRank,
} from "./badge-styles"
import { DEFAULT_SASH_ORDER } from "./badge-priority"
import { KNOWN_VIDEO_FORMATS } from "./av-specs"
import { NATURAL_GRADIENT_DEFAULTS } from "./gradient-presets"
import { canonicalInheritFreeze } from "./visual-presets"
import type { VisualPresetValues } from "./visual-presets"

/**
 * Shared quick-look patch utility (single source for the canonical
 * quick-transform reset + the three quick badge patches). Extracted from
 * BadgeDefaultsSection so the guided draft page and the live callers share
 * the exact same constants/formulas — never duplicated.
 *
 * Canonical transform reset: absolute Natural gradient both shapes +
 * topShade 50 × topShadeHeight 25 + logo null/null/null (auto) + scale 100 (separate via
 * getSeparateBadgeDefaultScale) + offset 0 except quality portrait -10/+15
 * and landscape 0/0. Reuses canonical constants, never UI 75 / relative
 * 100 / render-only rank -20 baseline.
 *
 * The PER-ITEM corrections (`badgeItemTransforms`) are part of the same
 * geometry reset: the ready looks are immutable snapshots of the whole look,
 * so they own the AUTOMATIC item layout (`null`). Without this the field —
 * added after the recipes — was simply absent from every quick look, and the
 * apply consumers (which copy only defined keys) silently kept the live
 * nudges: the emitted preview URL still carried `bit=…` and the poster kept
 * the marks the user had moved before applying the preset.
 */
export function quickTransformPatch(portrait: boolean): Partial<VisualPresetValues> {
  return {
    defaultBlurEnabled: NATURAL_GRADIENT_DEFAULTS.blurEnabled,
    defaultGradientHeight: NATURAL_GRADIENT_DEFAULTS.gradientHeight,
    defaultBlurIntensity: NATURAL_GRADIENT_DEFAULTS.blurIntensity,
    defaultBlurFade: NATURAL_GRADIENT_DEFAULTS.blurFade,
    defaultBlurDarkness: NATURAL_GRADIENT_DEFAULTS.blurDarkness,
    defaultTintStrength: NATURAL_GRADIENT_DEFAULTS.tintStrength,
    defaultTopShade: 50,
    defaultTopShadeHeight: 25,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    defaultTopBadgeScale: 100,
    defaultTopBadgeOffsetX: 0,
    defaultTopBadgeOffsetY: 0,
    defaultGenreBadgeScale: 100,
    defaultGenreBadgeOffsetX: 0,
    defaultGenreBadgeOffsetY: 0,
    defaultQualityBadgeScale: 100,
    defaultQualityBadgeOffsetX: portrait
      ? DEFAULT_QUALITY_BADGE_OFFSET_X
      : DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE,
    defaultQualityBadgeOffsetY: portrait
      ? DEFAULT_QUALITY_BADGE_OFFSET_Y
      : DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE,
    defaultSeparateBadgeScale: getSeparateBadgeDefaultScale(undefined),
    defaultSeparateBadgeOffsetX: 0,
    defaultSeparateBadgeOffsetY: 0,
    // Per-item corrections: automatic layout (the preset's own look, never the
    // previous look's nudges). Same single value both shapes: the landscape
    // apply derives the profile key through `PRESET_FLAT_TO_LANDSCAPE`.
    defaultBadgeItemTransforms: null,
    defaultNetworkLogoScale: 100,
    defaultNetworkLogoOffsetX: 0,
    defaultNetworkLogoOffsetY: 0,
  }
}

/** Badge-only patches for the three quick looks (no transform included). */
export const QUICK_BADGE_PATCHES: Record<
  "essential" | "ratings" | "full",
  Partial<VisualPresetValues>
> = {
  // Every quick look owns its complete visible recipe (never inherits the
  // previous look): each patch pins every appearance key that changes its
  // pixels to the canonical factory value (same source as useDefaults
  // DEFAULT_FLAT_DEFAULTS, via the shared constants — never invented
  // numbers), differing only in the documented look choices below.
  essential: {
    // "Genre and year only, clean look": rating/quality/ranking/network and
    // the custom provider row stay off; separate column off with the canonical
    // column layout; no rank ribbon with the canonical full sash order;
    // minimal genre style in the canonical Inter font; Coming Soon neutral
    // off; network/quality/format pins are inert while off but deterministic.
    defaultGlobalBadges: true,
    defaultBadgeGenre: true,
    defaultBadgeYear: true,
    defaultBadgeRating: false,
    defaultBadgeQuality: false,
    defaultCustomRatings: false,
    defaultSeparateRatings: false,
    defaultSeparateRatingsStyle: DEFAULT_SEPARATE_RATINGS_STYLE,
    defaultRankingBadges: false,
    defaultRankingBadgeStyle: "default",
    defaultRibbonEnabled: false,
    defaultRibbonSide: "left",
    defaultSashOrder: [...DEFAULT_SASH_ORDER],
    defaultBadgeStyle: "minimal",
    defaultBadgeFont: DEFAULT_BADGE_FONT,
    defaultQualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
    defaultVideoFormats: [...KNOWN_VIDEO_FORMATS],
    defaultNetworkLogo: false,
    defaultNetworkLogoPosition: "auto",
    defaultNetworkLogoFollowTitle: true,
    defaultPreRelease: false,
  },
  ratings: {
    // "IMDb/TMDB scores and quality": genre off, year/rating/quality on with
    // the custom provider row on (scores!) and the separate column off;
    // ranking/network off with the same canonical neutral pins as Essential;
    // pill genre style in the canonical Inter font with standard quality.
    defaultGlobalBadges: true,
    defaultBadgeGenre: false,
    defaultBadgeYear: true,
    defaultBadgeRating: true,
    defaultBadgeQuality: true,
    defaultCustomRatings: true,
    defaultSeparateRatings: false,
    defaultSeparateRatingsStyle: DEFAULT_SEPARATE_RATINGS_STYLE,
    defaultQualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
    defaultRankingBadges: false,
    defaultRankingBadgeStyle: "default",
    defaultRibbonEnabled: false,
    defaultRibbonSide: "left",
    defaultSashOrder: [...DEFAULT_SASH_ORDER],
    defaultBadgeStyle: "pill",
    defaultBadgeFont: DEFAULT_BADGE_FONT,
    defaultVideoFormats: [...KNOWN_VIDEO_FORMATS],
    defaultNetworkLogo: false,
    defaultNetworkLogoPosition: "auto",
    defaultNetworkLogoFollowTitle: true,
    defaultPreRelease: false,
  },
  full: {
    // User recipe: Completo shows the Nastro rank and the minimal
    // genre/rating badge. Translated via the existing selector contract
    // exactly (`rankingAppearanceValue("nastro")` + minimal `bs`): Standard
    // layout (ready overlay) + `netflix` + ribbon ON + `minimal`. This
    // supersedes the earlier pill/plate draft — do not revert without a new
    // user recipe. All other pins are the canonical factory values (same
    // source as useDefaults DEFAULT_FLAT_DEFAULTS, via the shared constants
    // below — never invented numbers).
    // - custom provider row ON (visible when a provider is configured; the
    //   endpoint/key credentials are never touched here);
    // - separate column OFF with the canonical column layout;
    // - canonical full sash order, ribbon side left;
    // - canonical Inter font, standard quality icons, full A/V format set,
    //   network on/auto/follow, Coming Soon neutral OFF.
    defaultGlobalBadges: true,
    defaultBadgeGenre: true,
    defaultBadgeYear: true,
    defaultBadgeRating: true,
    defaultBadgeQuality: true,
    defaultCustomRatings: true,
    defaultSeparateRatings: false,
    defaultSeparateRatingsStyle: DEFAULT_SEPARATE_RATINGS_STYLE,
    defaultRankingBadges: true,
    defaultRankingBadgeStyle: "netflix",
    defaultRibbonEnabled: true,
    defaultRibbonSide: "left",
    defaultSashOrder: [...DEFAULT_SASH_ORDER],
    defaultBadgeStyle: "minimal",
    defaultBadgeFont: DEFAULT_BADGE_FONT,
    defaultQualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
    defaultVideoFormats: [...KNOWN_VIDEO_FORMATS],
    defaultNetworkLogo: true,
    defaultNetworkLogoPosition: "auto",
    defaultNetworkLogoFollowTitle: true,
    defaultPreRelease: false,
  },
}

/**
 * Quick-look recipe keys deliberately NOT pinned (intentional user prefs,
 * preserved like Apple/personal presets):
 * - `defaultRatingSources`: global vote-source selection shared by server
 *   design (no profile key) — preserved by every ready look;
 * - provider credentials/preferences (`defaultCustomRatingEndpoint`,
 *   `defaultCustomRatingApiKeyHeader`), fit flags, region, date format:
 *   never visual-preset content;
 * - `defaultPosterShape`: delivery format, never follows a preset;
 * - `defaultLogoAlign`: Auto-only, normalized to null by the staged session;
 * - `defaultExtraBadgeStyle`: outside the preset contract (no schema key) —
 *   see `withReadyPresetExtraStyleReset` below, applied by every ready entry
 *   point alongside this patch.
 */

export type QuickLookId = keyof typeof QUICK_BADGE_PATCHES

/** Full quick-look desired values (badge patch + canonical transform reset). */
export function quickLookDesired(
  id: QuickLookId,
  portrait: boolean,
): VisualPresetValues {
  return {
    ...QUICK_BADGE_PATCHES[id],
    ...quickTransformPatch(portrait),
  } as unknown as VisualPresetValues
}

/** True only for the Full quick look (the sole owner of the complete recipe). */
export function isFullQuickLook(id: QuickLookId): boolean {
  return id === "full"
}

/**
 * Ready-only standalone-extra reset (the style key lives outside the preset
 * contract — `visualPresetValuesSchema` has no `defaultExtraBadgeStyle` — so
 * the isolated helpers cannot carry it; every ready entry point (all six
 * built-in/quick looks, both gallery and legacy paths) applies this
 * alongside its patch, Essential/Ratings included; personal presets never do,
 * their stored content applies verbatim):
 * - portrait target: the flat returns to the legacy `null` (follow the
 *   target's own rank); an inheriting landscape profile (absent, legacy
 *   `null` or invalid — every case the preview builder resolves via the
 *   flat) freezes the pre-edit effective flat first via the canonical
 *   `canonicalInheritFreeze` (concrete style verbatim, legacy → explicit
 *   follow-rank marker — pixel-identical, leak-proof); an explicit profile
 *   value (concrete style or the follow-rank sentinel) stays frozen as the
 *   untouched other shape;
 * - landscape target: flats stay byte-identical (portrait frozen), so the
 *   profile takes the explicit shape-local follow-own-rank marker
 *   (`EXTRA_BADGE_FOLLOW_RANK`, the same canonical freeze
 *   `canonicalInheritFreeze` produces) instead of inheriting a tuned flat.
 * `live` is the pre-edit editor state (flat + raw landscape) the freeze
 * reads; when omitted the snapshot's own values are used (backward
 * compatible, same result when the snapshot still carries the pre-edit
 * flat). Pure; snapshots are editor-shaped records, never persisted here.
 */
export function withReadyPresetExtraStyleReset(
  snapshot: Record<string, unknown>,
  shape: "portrait" | "landscape",
  live?: { defaultExtraBadgeStyle?: unknown; landscape?: unknown },
): Record<string, unknown> {
  if (shape === "landscape") {
    const land = { ...((snapshot.landscape ?? {}) as Record<string, unknown>) }
    land.extraBadgeStyle = EXTRA_BADGE_FOLLOW_RANK
    return { ...snapshot, landscape: land }
  }
  const land = { ...((snapshot.landscape ?? {}) as Record<string, unknown>) }
  const cur = land.extraBadgeStyle
  const explicit =
    isExtraFollowRank(cur) || isExtraBadgeStyle(typeof cur === "string" ? cur : null)
  if (!explicit) {
    const liveFlat = (live as Record<string, unknown> | undefined)?.defaultExtraBadgeStyle ??
      (snapshot as Record<string, unknown>).defaultExtraBadgeStyle
    const frozen = canonicalInheritFreeze("extraBadgeStyle", liveFlat)
    if (frozen.freeze) land.extraBadgeStyle = frozen.value
  }
  return { ...snapshot, defaultExtraBadgeStyle: null, landscape: land }
}
