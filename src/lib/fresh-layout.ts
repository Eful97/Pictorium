import sharp from "sharp"
import type { RatingItem } from "./custom-rating/types"
import { formatRating } from "./custom-rating/formatter"
import type { SeparateRating } from "./ratings"
import { formatSeparateValue, MAX_SEPARATE_RATINGS } from "./ratings"
import type { PosterComposite } from "./poster-render-helpers"
import { renderSVG } from "./svg-badge"
import { escSvg, estimateTextWidth, fontFamilyFor, normalizeBadgeFont, textFitAttrs } from "./badge-svg-shared"
import type { BadgeFont, SeparateRatingsStyle } from "./badge-styles"
import { MAX_CUSTOM_RATINGS } from "./multi-rating-renderer"
import { resolveSeparateDisplayState } from "./poster-config"

// ---------------------------------------------------------------------------
// Fresh layout (opt-in `layout=fresh`): full-bleed artwork, large glass
// numeral left, genre/rating/year/provider column, title logo bottom-right.
//
// RANKED composition (valid numeral 1..FRESH_RANK_MAX): the numeral sits
// top-left and the meta column is pinned below it in the left zone; the
// provider mark follows the column. The title logo anchors bottom-CENTERED
// on portrait (task8a2: full usable width minus ~5.5%/side margins,
// bottom-band height cap for tall marks, same bottom margin; user X/Y apply
// once) and keeps the historic bottom-right anchor on landscape (task9:
// landscape base slot restored to the historic 40% CW / 24% CH logo bounds,
// scaled by the same % — 100 is right-sized again, 150/200 still grow).
// The meta block follows the (possibly transformed) numeral by default:
// `metaTop` derives from the transformed numeral box, then the meta offsets
// apply on top. This path is byte-frozen at neutral transforms: unranked
// work must never touch it.
//
// UNRANKED composition (absent, disabled or invalid rank — never a valid
// numeral): there is no left column. The meta block moves to the bottom
// content area BESIDE the title logo (right-aligned to the logo's left edge
// minus a side gap, bottom-anchored to the same baseline; right-aligned to
// the canvas margin when the logo is hidden or missing), and the network
// mark sits ABOVE THE META BLOCK (centered on it with the column gap).
// Without meta rows the network falls back above the title logo
// (standard-like gap, centered on the title visible box); with neither logo
// nor meta rows it is bottom-anchored to the same block edge on its own.
// The title logo keeps its historic bottom-right anchor and size. No rank
// is ever invented: the numeral draws only for a valid rank, the meta rows
// only for real values.
//
// TRANSFORM CONTROLS (no new params — every field maps 1:1 to an existing
// per-shape control, resolved upstream by poster-config.ts):
// - rank numeral: `topBadgeScale/OffsetX/Y` (`tscale`/`tox`/`toy`). The scale
//   and offsets shape the NUMERAL GEOMETRY (freshGeometry) BEFORE the glass
//   fill samples the artwork ROI — the layer is rendered at the transformed
//   size/anchor, never post-resized (a post-resize would sample the wrong
//   location). The standard `NUMBER_BADGE_BASE_OFFSET_X` baseline does NOT
//   apply here: the fresh numeral keeps its own padX/numeralTop anchor.
// - genre/rating column: `genreBadgeScale/OffsetX/Y` (`gscale`/`gox`/`goy`).
//   The scale sizes the column fonts; the offsets move the placed block.
//   Positioning is independent of the numeral, but the default chain follows
//   it: ranked `metaTop` derives from the transformed numeral box.
// - provider/network: `networkLogoScale` rides the caller bitmap (already
//   scaled by the single renderer — never re-applied here, no double
//   scaling) AND enlarges the column slot cap by the same % (`providerScale`
//   below, single fit into the scaled cap — the fitted mark grows linearly
//   with the scale until the canvas edge); `networkLogoOffsetX/Y`
//   (`nox`/`noy`) move the placed mark relative to its above/below-meta
//   baseline. `networkLogoFollowTitle =
//   false` + fixed coords use the absolute position verbatim (same contract
//   as the standard layout: no auto anchor, no offsets, no shift).
// - title logo: `logoScale` rides the caller bitmap (already sized by the
//   single renderer — never re-applied) AND enlarges the title width cap by
//   the same % (`logoScale` below, single fit into the scaled cap —
//   null/auto counts as 100 so the historic neutral is byte-identical);
//   `logoOffsetX/Y` (`ox`/`oy`) apply
//   ONCE relative to the fresh anchor (bottom-centered on ranked portrait,
//   bottom-right elsewhere; the standard anchor is
//   discarded with its baked offsets, so there is no double offset).
// Neutral transforms (scale 100, offsets 0, follow on) reproduce the
// historic baseline byte-identically — except the intentional task8a2
// ranked-portrait title (centered, full-width cap); every layer is clamped
// inside the canvas even at scale/offset extremes.
//
// COMPATIBILITY CONTRACT (explicit decisions where fresh collides with the
// standard chrome):
// - Ranking priority is NOT reimplemented here: the single renderer
//   (poster-service.ts) resolves `topBadge` once and passes the final rank
//   number down. No rank is ever invented: numeral renders only when
//   `topBadge.type === "rank"` (rankingEnabled-gated upstream).
// - Extra top badges (custom `extra`, Coming Soon label) keep their standard
//   bitmap, composited top-center by the caller — the glass numeral never
//   replaces a non-rank badge.
// - Coming Soon ribbon + pre-release dim/blur, the quality pill (top-right)
//   and topShade/blur overlays are the STANDARD bitmaps, reused verbatim —
//   only old top-center rank pills, genre pills, network pills, separate
//   columns and bottom rows are suppressed in fresh (they would duplicate the
//   left column).
// - Separate/custom ratings have no column bitmap in fresh: values render as
//   text lines inside the left meta column (same data, no invented values).
//   Gates, priority and caps are the existing shared ones
//   (resolveSeparateDisplayState + MAX_CUSTOM_RATINGS, same as the standard
//   renderer): the custom provider row keeps its historic priority over the
//   separate column (never two rating stacks), the separate column needs the
//   rating toggle, bottom styles suppress the custom row.
// - The title logo reuses the already-resized standard bitmap, re-anchored
//   bottom-right (shrunk only when it would invade the left column).
// - The provider mark reuses the already-resolved raw network bitmap (brand
//   colors untouched), scaled down to the column width, never enlarged.
// - No new downloads, no global sharp settings, no new caches: every buffer
//   is derived from the fetched `posterBuf`/bitmaps via bounded native sharp
//   ops at the existing canvas resolution. Legibility comes from a native
//   gradient shade, never from shifting the full-bleed source.
// ---------------------------------------------------------------------------

/**
 * Highest rank the glass numeral accepts. Mirrors the existing accepted
 * contract: the query hardening keeps canonical integer ranks in [0, 100]
 * (`RANK_MAX = 100` in poster-params-hardening.ts); badge builders drop
 * non-positive ranks (`rank <= 0 → null`) and the priority chain only badges
 * truthy ranks (`if (params.trendRank)`). No new Top-20 cap: the numeral
 * keeps ONE cap height for every 1..2-digit rank (task11 — the size never
 * follows the digit count); the 3-digit rank shrinks only against the canvas
 * edge in freshGeometry (never against the meta column).
 */
export const FRESH_RANK_MAX = 100

/**
 * Whether a rank may draw the glass numeral. Anything else (zero,
 * negatives, non-integers, non-finite, above the accepted max, null) draws
 * nothing — an invalid rank is never rounded or clamped into an invented
 * numeral.
 */
export function isFreshRank(rank: number | null | undefined): rank is number {
  return typeof rank === "number" && Number.isInteger(rank) && rank >= 1 && rank <= FRESH_RANK_MAX
}

/**
 * Effective Fresh eligibility: the selected layout renders Fresh only when
 * the layout is fresh AND (the scope is explicitly "all" OR a valid rank is
 * actually displayed). The rank here is the DISPLAYED rank (the resolved
 * topBadge numeral, already rankingEnabled-gated upstream) — never catalog
 * membership, custom badge text or catalog flags. Ranking data availability
 * alone never overrides rankingEnabled: without a displayed rank numeral
 * there is no Fresh. Absent/invalid scope fails closed to "ranked" (the
 * shared default): absent/disabled/invalid/null rank under it falls back to
 * Standard (byte-identical to selecting Standard with the same settings); a
 * valid rank renders Fresh identical to "all" mode. Only an explicit "all"
 * renders Fresh without a rank.
 */
export function isEffectiveFreshLayout(
  posterLayout: string | null | undefined,
  posterFreshScope: string | null | undefined,
  displayedRank: number | null | undefined,
): boolean {
  if (posterLayout !== "fresh") return false
  if (posterFreshScope === "all") return true
  return isFreshRank(displayedRank)
}

/** Left-column width share per shape (independent design, donor-inspired). */
const FRESH_ZONE_SHARE_PORTRAIT = 0.34
const FRESH_ZONE_SHARE_LANDSCAPE = 0.3

/**
 * Ranked-portrait title side-margin share per side (~5.5% ≈ 28px @500w,
 * matching the ~30px reference margins). The ranked portrait title spans the
 * usable canvas width (CW minus both margins) instead of the historic
 * right-of-column slot (~0.44 CW) — user-approved task8a2 composition.
 */
const FRESH_RANKED_PORTRAIT_TITLE_MARGIN_SHARE = 0.055

/**
 * Ranked-portrait title height cap share of the canvas height. A wide
 * wordmark binds on width first (full usable width); a tall/square mark
 * binds here so it stays in the bottom band instead of swallowing the left
 * meta column. Mirrors the standard portrait logo height cap (25%).
 */
const FRESH_RANKED_PORTRAIT_TITLE_MAX_H_SHARE = 0.25

/**
 * Landscape title slot shares (task9, user-reported "loghi landscape fresh
 * enormi" regression). Task8a dropped the standard landscape logo caps for
 * effective Fresh, so auto/explicit 100 sized into the full right-of-column
 * slot (~0.63 CW, uncapped height — a 400x400 mark shipped 400px tall on the
 * 432px canvas). The landscape Fresh base slot restores the historic
 * landscape logo bounds (mirrors LANDSCAPE_LOGO_MAX_WIDTH_PCT/_HEIGHT_PCT in
 * logo-layout.ts): 100 renders right-sized again, 150/200 still grow
 * linearly from this base until the genuine canvas limit (caps scale by the
 * same % — never a static cap cancelling the user scale). Ranked and
 * unranked landscape share the slot (common title fix, composition
 * untouched); portrait (ranked centered + unranked) and Standard keep their
 * slots byte-identically.
 */
const FRESH_LANDSCAPE_TITLE_MAX_W_SHARE = 0.4
const FRESH_LANDSCAPE_TITLE_MAX_H_SHARE = 0.24

/**
 * Ranked-portrait numeral height share of the canvas height (task12,
 * user-approved "originale, numerise brano allungati vero?": the reference
 * rank-10 reads ~490px tall on a 1500px canvas ≈ 0.33 CH). Raised from the
 * task11 0.30 so the portrait cap height lands on ~0.33 CH
 * (glyphH = round(750 × 0.33) = 248, capH = 248). Landscape keeps its
 * existing 0.50 share (in-canvas safe, asserted) — only the width condenses
 * there, so both shapes share one slender style at their own heights.
 */
const FRESH_NUMERAL_SHARE_PORTRAIT = 0.33
const FRESH_NUMERAL_SHARE_LANDSCAPE = 0.5

/**
 * Horizontal glyph condensation factor for the Fresh rank numeral (task12,
 * correction c2 rank-aware per the latest user constraint "si schiacciano
 * tutti. io voglio che si schiaccino solo dal 10 in poi": ONLY portrait
 * ranks >= 10 condense a further 70% of CURRENT width — 0.6 × 0.7 = 0.42 of
 * natural — while portrait singles (1..9) stay at the task12 baseline 0.6
 * and landscape stays at the approved 0.6 byte-unchanged for every rank).
 * Rather than a new font/download/dependency, the shared SVG glyph source is
 * condensed anisotropically per shape+rank: 0.42 portrait 10..100 sits
 * mid-band of the visually supported range for the taller portrait column,
 * 0.6 covers portrait singles and every landscape rank (the task12 baseline
 * pinned). Applied ONCE to the shared `<text>` source
 * (`freshNumeralSvg`) via `transform="scale(<cx> 1)"` with the x origin
 * pre-compensated (`x = rim / <cx>`), where `<cx>` is the box factor
 * (`FreshNumeralBox.condenseX`, set by `freshGeometry` per shape+rank after
 * the rank is validated — never for an absent/invalid rank, which draws no
 * numeral at all) — so the fill mask, the rim ring source and any derived
 * reference render the IDENTICAL condensed glyphs and layers cannot
 * misalign. The geometry estimate (`estW`) is the same factor times the raw
 * estimate, so the measurement contract stays exact: actual ink scales with
 * the estimate and the real/est ceiling is unchanged. Y geometry (cap
 * height, baseline, meta chain) is untouched by this factor.
 * `FRESH_NUMERAL_CONDENSE_X` stays as the landscape/global default
 * (backwards-compatible fallback for boxes built without a shape factor,
 * e.g. legacy test fixtures).
 */
export const FRESH_NUMERAL_CONDENSE_X = 0.6
/** Portrait glyph width factor for ranks >= 10: 0.6 × 0.7 = 0.42 of natural (task12 c2). */
export const FRESH_NUMERAL_CONDENSE_X_PORTRAIT = 0.42
/** Portrait singles (1..9) keep the task12 baseline 0.6 (task12 c2: no extra squeeze). */
export const FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE = 0.6
/** Landscape glyph width factor: task12 baseline 0.6, pinned (task12 c1, kept c2). */
export const FRESH_NUMERAL_CONDENSE_X_LANDSCAPE = 0.6

/**
 * Condensation factor for a canvas shape AND rank (task12 c2, rank-aware).
 * Portrait ranks >= 10 condense to 0.42 (70% of current); portrait singles
 * (1..9) and every landscape rank stay at the 0.6 baseline. The rank is
 * optional for backwards compatibility: absent/null/invalid/NaN (or any
 * rank below 10) falls back to the single-digit default (0.6 on portrait,
 * 0.6 landscape) — hand-built boxes without a rank keep rendering exactly
 * like a portrait single, and no invalid rank ever draws (the numeral box
 * exists only for a validated rank, decided by `isFreshRank` in
 * `freshGeometry` before this helper is consulted).
 */
export function freshNumeralCondenseX(isPortrait: boolean, rank?: number | null): number {
  if (!isPortrait) return FRESH_NUMERAL_CONDENSE_X_LANDSCAPE
  if (typeof rank === "number" && Number.isFinite(rank) && rank >= 10)
    return FRESH_NUMERAL_CONDENSE_X_PORTRAIT
  return FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE
}

/** Effective condensation factor carried by a numeral box (fallback 0.6). */
export function freshBoxCondenseX(box: FreshNumeralBox): number {
  return typeof box.condenseX === "number" && Number.isFinite(box.condenseX) && box.condenseX > 0
    ? box.condenseX
    : FRESH_NUMERAL_CONDENSE_X
}

/**
 * Ranked-portrait numeral default calibration (task10, user-approved "-90px
 * lato Y precisamente"): the portrait numeral anchor sits 90 logical canvas
 * px above the historic `numeralTop` (120 → 30 @500x750) BEFORE the user
 * `toy` offset. Landscape is untouched (0). Unranked geometry is untouched:
 * the shift applies only to the numeral box (which exists solely for a valid
 * rank); the null-rank `metaTop` fallback keeps the historic `numeralTop`.
 * Stored user `toy` is never reset — the calibration is a separate baseline
 * term, so neutral `toy=0` renders the new default and existing user offsets
 * keep their exact relative effect. Same single renderer (no second client
 * renderer); font/scale pipeline unchanged.
 */
export const FRESH_PORTRAIT_RANK_Y_SHIFT = -90

/** Inter digit cap-height ≈ 0.73em (maps glyph height to font-size). */
const FRESH_DIGIT_CAP = 0.73

/** Floor for transformed glyph sizes: user scales (10..200%) must never
 *  produce a degenerate zero/negative font or ROI. The neutral path always
 *  stays ≥24, so this floor only binds at extreme shrink. */
const FRESH_MIN_GLYPH = 8

/** Bounds shared with the existing transform controls (same as the standard
 *  badge/logo chain in poster-config.ts): scales clamp to 10..200%,
 *  offsets to ±2000px. */
const FRESH_TRANSFORM_SCALE_MIN = 10
const FRESH_TRANSFORM_SCALE_MAX = 200
const FRESH_TRANSFORM_OFFSET_BOUND = 2000

/**
 * Effective per-shape transform controls consumed by the fresh layout.
 * No new params/fields: every entry maps 1:1 to an existing control
 * (resolved upstream per shape by poster-config.ts, same chain as the
 * standard layout). Provider/logo SCALES ride the caller bitmaps
 * (networkLogoForLayout scaled by `netscale`, logoResult sized by
 * `logoScale`) and are never re-applied as a second resize here: they only
 * enlarge the slot caps below by the same %, so one fit produces a mark
 * that grows linearly with the scale (neutral 100 = historic caps
 * byte-identical).
 */
export interface FreshLayoutTransforms {
  /** Rank numeral size (`topBadgeScale`, %). */
  readonly numeralScale?: number | null
  /** Rank numeral position (`topBadgeOffsetX/Y`, px). */
  readonly numeralOffsetX?: number | null
  readonly numeralOffsetY?: number | null
  /** Genre/rating column size (`genreBadgeScale`, %). */
  readonly metaScale?: number | null
  /** Genre/rating column position (`genreBadgeOffsetX/Y`, px). */
  readonly metaOffsetX?: number | null
  readonly metaOffsetY?: number | null
  /**
   * Provider mark effective size (`networkLogoScale`, %): enlarges the
   * column slot cap by this % before the single fit (never a second
   * resize of the already-scaled caller bitmap). Absent = 100 = historic.
   */
  readonly providerScale?: number | null
  /** Provider mark position (`networkLogoOffsetX/Y`, px). */
  readonly providerOffsetX?: number | null
  readonly providerOffsetY?: number | null
  /** Absolute-positioning contract (`networkLogoFollowTitle`). */
  readonly providerFollowTitle?: boolean
  /** Absolute coords (`networkFixedX/Y`, px) — only with follow off. */
  readonly providerFixedX?: number | null
  readonly providerFixedY?: number | null
  /**
   * Title logo effective size (`logoScale`, %): enlarges the title width
   * cap by this % before the single fit (never a second resize of the
   * already-sized caller bitmap; null/auto counts as 100 so neutral stays
   * byte-identical).
   */
  readonly logoScale?: number | null
  /** Title logo nudge (`logoOffsetX/Y`, px) — applied ONCE. */
  readonly logoOffsetX?: number | null
  readonly logoOffsetY?: number | null
}

/** Normalize a scale control: non-finite/zero → neutral 100, else 10..200. */
function normFreshScale(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return 100
  return Math.min(FRESH_TRANSFORM_SCALE_MAX, Math.max(FRESH_TRANSFORM_SCALE_MIN, Math.round(v)))
}

/** Normalize an offset control: non-finite → 0, else ±2000px. */
function normFreshOffset(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0
  return Math.min(FRESH_TRANSFORM_OFFSET_BOUND, Math.max(-FRESH_TRANSFORM_OFFSET_BOUND, Math.round(v)))
}

/** Whether the provider uses the absolute-positioning contract. */
function isFreshFixedProvider(t: FreshLayoutTransforms | null | undefined): boolean {
  return !!t && t.providerFollowTitle === false && t.providerFixedX != null && t.providerFixedY != null
}

/** Bleed pad around the numeral layer (rim stroke + drop shadow). */
const FRESH_NUMERAL_BLEED = 12

/**
 * Display-numeral tracking (tight, like other large rank numerals):
 * proportional `-0.03em` (same convention as `buildRankingNumberSvg`), so
 * multi-digit ranks keep their spacing at every size. A fixed pixel tracking
 * would over-tighten small (shrunk 2-3 digit) sizes and could push real ink
 * past the estimated advance.
 */
export function freshNumeralTrack(fontSize: number): number {
  return -Math.round(fontSize * 0.03)
}

/**
 * Width bound for the numeral scratch canvas. The estimator
 * (`estimateTextWidth`, calibrated for badge text) undershoots real
 * Inter-Black digit ink: worst measured real/est over EVERY accepted rank
 * 1..100 on both canvas shapes is 1.141 (leading-"4" two-digit ranks — a wide
 * first digit shifts the second digit right past the estimate). 1.25 keeps
 * ~9% headroom above that measured worst case. Scratch-only: it is never
 * shipped — the shipped layer is cropped to the measured ink plus the rim
 * pad (see renderFreshGlassNumeral), so this bound only has to never clip,
 * never to be tight. The bounds test re-measures all 1..100 every run and
 * fails if any real ink ever approaches the scratch edge.
 */
const FRESH_NUMERAL_SCRATCH_W = 1.25

/**
 * Worst-case real-ink/estimate width ratio used ONLY by the 3-digit canvas
 * guard in freshGeometry (task11 exception for rank 100). The scratch bound
 * above (1.25) keeps ~9% headroom over the worst measured real/est across
 * every accepted rank 1..100 on both shapes (1.141, leading-"4" two-digit
 * ranks); 1.2 sits between the measurement and the scratch bound, and the
 * bounds test re-measures all 1..100 every run and fails if any real ink
 * ever approaches it. 1..2-digit ranks never reach this guard (their bound
 * stays far inside the canvas — asserted in poster-fresh-numeral-height).
 */
export const FRESH_NUMERAL_CANVAS_WORST = 1.2

/** ROI blur radius for the artwork-derived glass fill (ROI-local only). */
const FRESH_GLASS_BLUR = 9

export interface FreshNumeralBox {
  readonly text: string
  readonly fontSize: number
  /** Text origin (left of the first glyph advance). */
  readonly left: number
  /** Top of the digit cap-height box. */
  readonly top: number
  readonly estW: number
  readonly capH: number
  /**
   * Shape+rank condensation factor applied to the shared SVG source
   * (`freshNumeralSvg`): portrait 10..100 → 0.42, portrait 1..9 → 0.6,
   * landscape every rank → 0.6 (task12 c2). Optional
   * for backwards compatibility — absent boxes render with the global
   * default `FRESH_NUMERAL_CONDENSE_X` (0.6, landscape). `freshGeometry`
   * always sets it; hand-built fixtures may omit it.
   */
  readonly condenseX?: number
}

export interface FreshLayoutGeometry {
  readonly CW: number
  readonly CH: number
  readonly isPortrait: boolean
  readonly zoneW: number
  readonly padX: number
  readonly numeral: FreshNumeralBox | null
  /** Top of the meta text column (below the numeral, or upper-left w/o rank). */
  readonly metaTop: number
  readonly metaGap: number
  readonly genreSize: number
  readonly ratingSize: number
  readonly smallSize: number
  readonly providerMaxW: number
  readonly providerMaxH: number
  /** Text width available to a meta row (block is zoneW wide, centered). */
  readonly metaAvailW: number
  readonly titleRight: number
  readonly titleBottom: number
  readonly titleMaxW: number
  /**
   * Ranked-portrait-only title cap (usable canvas width minus the
   * ~5.5%/side margins). Separate from the common `titleMaxW` so the
   * unranked portrait composition stays byte-identical.
   */
  readonly rankedTitleMaxW: number
  /**
   * Ranked-portrait-only title height cap (bottom-band bound for tall
   * marks). Landscape keeps the historic landscape bounds below
   * (`landscapeTitleMaxW/H`), never the uncapped canvas height.
   */
  readonly rankedTitleMaxH: number
  /**
   * Landscape-only title base slot (task9): historic landscape logo bounds
   * (40% CW / 24% CH). Ranked AND unranked landscape size from here (scaled
   * by the effective logo scale); portrait never reads these fields, so its
   * bytes cannot move.
   */
  readonly landscapeTitleMaxW: number
  readonly landscapeTitleMaxH: number
}

/**
 * Pure geometry for the fresh left column. No I/O: safe to unit-test and to
 * reuse in tests for pixel assertions. The numeral keeps ONE cap height for
 * every 1..2-digit rank (task11): the column fit applies once to a fixed
 * single-digit reference, so two-digit ranks extend right over the artwork
 * instead of minifying (the meta column width/centering is untouched — only
 * the numeral width allowance is decoupled from it). Task12 condenses the
 * glyphs horizontally per shape+rank (`freshNumeralCondenseX(isPortrait,
 * rank)`: portrait 10..100 → 0.42, portrait 1..9 → 0.6, landscape every
 * rank → 0.6 on the shared SVG source, `estW` = raw estimate × that
 * factor): the condensed single-digit reference
 * now fits the meta column width WITHOUT binding, so the reference size IS
 * the full share height — the old column restriction is effectively gone
 * (the fit stays only as a never-enlarging guard) and the portrait cap
 * height lands on ~0.33 CH. The 3-digit rank keeps the same reference size
 * unless its worst-case ink bound would leave the canvas, in which case it
 * alone shrinks against the canvas edge (with condensation, rank 100 fits —
 * so 1..100 share one height; the exception stays as canvas safety only).
 *
 * Transforms (optional, neutral when absent): `numeralScale` resizes the
 * fitted numeral AFTER the column fit and `numeralOffsetX/Y` shift its
 * anchor — both BEFORE any artwork sampling, so the glass fill ROI follows
 * the transformed box. `metaScale` sizes the column fonts. Ranked `metaTop`
 * derives from the transformed numeral, so the column follows numeral
 * changes by default (plus its own offsets at placement). Task10: the
 * portrait numeral carries the `FRESH_PORTRAIT_RANK_Y_SHIFT` (-90) baseline
 * calibration before the user Y offset (landscape 0, unranked untouched).
 * Neutral transforms reproduce the calibrated default exactly (ranked
 * portrait anchors 90px above the pre-task10 historic top).
 */
export function freshGeometry(
  CW: number,
  CH: number,
  rank: number | null,
  transforms?: FreshLayoutTransforms | null,
): FreshLayoutGeometry {
  const isPortrait = CH > CW
  const zoneW = Math.round(CW * (isPortrait ? FRESH_ZONE_SHARE_PORTRAIT : FRESH_ZONE_SHARE_LANDSCAPE))
  const padX = isPortrait ? 12 : 18
  const numeralTop = isPortrait ? 120 : 40
  const numeralScale = normFreshScale(transforms?.numeralScale)
  const metaScale = normFreshScale(transforms?.metaScale)
  let numeral: FreshNumeralBox | null = null
  if (isFreshRank(rank)) {
    const text = String(rank)
    // Rank-aware condensation (task12 c2, latest user constraint "solo dal
    // 10 in poi"): ONLY portrait ranks >= 10 condense to 0.42 (= 0.6 × 0.7
    // of CURRENT width); portrait singles (1..9) and every landscape rank
    // stay at the task12 baseline 0.6. Font/capH stay on the task12 baseline
    // (portrait 340/248, landscape 296/216): the factor only shrinks width,
    // never Y/metadata placement. The rank here is already validated by
    // `isFreshRank` above — no invalid rank ever reaches this helper.
    const condenseX = freshNumeralCondenseX(isPortrait, rank)
    const glyphH = Math.round(CH * (isPortrait ? FRESH_NUMERAL_SHARE_PORTRAIT : FRESH_NUMERAL_SHARE_LANDSCAPE))
    const fs0 = Math.max(24, Math.round(glyphH / FRESH_DIGIT_CAP))
    // Condensed estimates (task12): the shipped glyphs render through
    // `scale(<cx> 1)` in the shared SVG source, so every width the
    // geometry reasons about is the raw estimate × <cx> — the
    // measurement contract stays normalized to what resvg actually inks.
    const estCondensed = (raw: number): number => Math.max(1, Math.round(raw * condenseX))
    const est0 = estCondensed(estimateTextWidth(text, fs0, "inter"))
    const avail = Math.max(24, zoneW - padX - 6)
    // Task11 (user-reported "10+ numerals shrink"): the numeral width
    // allowance is decoupled from the meta column. The column fit applies
    // ONCE to a fixed single-digit reference — every digit shares the same
    // 0.58em estimate factor, so this reference reproduces the historic
    // 1..9 size exactly (byte-identical path for singles) while every
    // 1..2-digit rank inherits the same cap height and extends right over
    // the artwork instead of minifying. A per-rank fit would halve the
    // two-digit cap height (portrait 191 → 96, landscape 216 → 129) and make
    // the metaTop rank-dependent; a single reference keeps 1..20 coherent
    // with no estimate wiggle between ranks.
    // Task12: the reference is measured CONDENSED, so it no longer binds
    // against the meta column (condensed "8" ≈ 118px vs 152px avail on
    // portrait) — the fitted size IS the full share height (~0.33 CH
    // portrait). The min() stays as a never-enlarging guard only.
    const refEst = estCondensed(estimateTextWidth("8", fs0, "inter"))
    const refFitted = Math.max(24, Math.min(fs0, Math.floor((avail * fs0) / refEst)))
    let fitted = refFitted
    if (text.length > 2) {
      // 3-digit exception (rank 100 only): keep the reference size unless
      // the worst-case ink bound (estW × FRESH_NUMERAL_CANVAS_WORST, the
      // re-measured real/est ceiling asserted in poster-fresh-numerals —
      // size-invariant, so it holds at the reference size too) plus the rim
      // pad and the ROI bleed would leave the canvas. Canvas bound, never
      // the meta column; single computation, no per-rank wiggle.
      const refEstW = (est0 * refFitted) / fs0
      const refStrokeW = Math.max(2, Math.round(refFitted * 0.03))
      const refRim = refStrokeW + 8
      const budget = Math.max(24, CW - padX - refRim * 2 - FRESH_NUMERAL_BLEED)
      const needW = refEstW * FRESH_NUMERAL_CANVAS_WORST
      if (needW > budget) fitted = Math.max(24, Math.floor((refFitted * budget) / needW))
    }
    const fontSize = Math.max(FRESH_MIN_GLYPH, Math.round((fitted * numeralScale) / 100))
    const estW = (est0 * fontSize) / fs0
    const capH = Math.round(fontSize * FRESH_DIGIT_CAP)
    numeral = {
      text,
      fontSize,
      left: padX + normFreshOffset(transforms?.numeralOffsetX),
      top: numeralTop + (isPortrait ? FRESH_PORTRAIT_RANK_Y_SHIFT : 0) + normFreshOffset(transforms?.numeralOffsetY),
      estW,
      capH,
      condenseX,
    }
  }
  const metaGap = isPortrait ? 22 : 14
  const metaTop = numeral ? numeral.top + numeral.capH + metaGap : numeralTop
  const scaleFont = (base: number): number =>
    Math.max(FRESH_MIN_GLYPH, Math.round((base * metaScale) / 100))
  const titleRight = Math.round(CW * 0.045)
  const titleBottom = Math.round(CH * 0.04)
  const rankedSide = Math.round(CW * FRESH_RANKED_PORTRAIT_TITLE_MARGIN_SHARE)
  return {
    CW,
    CH,
    isPortrait,
    zoneW,
    padX,
    numeral,
    metaTop,
    metaGap,
    genreSize: scaleFont(isPortrait ? 20 : 16),
    ratingSize: scaleFont(isPortrait ? 30 : 24),
    smallSize: scaleFont(isPortrait ? 18 : 14),
    providerMaxW: Math.max(24, zoneW - padX),
    providerMaxH: isPortrait ? 64 : 48,
    metaAvailW: Math.max(24, zoneW - padX),
    titleRight,
    titleBottom,
    titleMaxW: Math.max(40, CW - zoneW - titleRight - 16),
    rankedTitleMaxW: Math.max(40, CW - rankedSide * 2),
    rankedTitleMaxH: Math.max(24, Math.round(CH * FRESH_RANKED_PORTRAIT_TITLE_MAX_H_SHARE)),
    landscapeTitleMaxW: Math.max(40, Math.round(CW * FRESH_LANDSCAPE_TITLE_MAX_W_SHARE)),
    landscapeTitleMaxH: Math.max(24, Math.round(CH * FRESH_LANDSCAPE_TITLE_MAX_H_SHARE)),
  }
}

export interface FreshMetaInput {
  readonly badgesEnabled: boolean
  readonly badgeGenre: boolean
  readonly badgeYear: boolean
  /**
   * Raw rating-component toggle (pre-suppression). The route passes its
   * resolved raw toggle via `freshRawBadgeRating` (the effective
   * `badgeRating` is already suppressed when the separate column is
   * active); direct service callers pass the raw toggle in `badgeRating`
   * itself (or via `freshRawBadgeRating`). An explicit false with populated
   * arrays renders no separate rows — array existence never re-enables it.
   */
  readonly badgeRating: boolean
  /** Separate-ratings toggle (`separateRatings` render config). */
  readonly separateRatingsEnabled: boolean
  /** Separate-ratings layout (default "column"). */
  readonly separateRatingsStyle?: SeparateRatingsStyle
  /** Custom provider display toggle (`customRatings` render config). */
  readonly customRatingsEnabled: boolean
  readonly genreName: string | null
  readonly year: string | undefined
  readonly voteAverage: number | null
  readonly separateRatings: readonly SeparateRating[] | undefined
  readonly customRatings: readonly RatingItem[] | undefined
}

export interface FreshMetaRow {
  readonly kind: "genre" | "rating" | "separate" | "year" | "custom"
  readonly text: string
  readonly star: boolean
}

/**
 * Text rows for the fresh left column. Applies the existing shared display
 * state (resolveSeparateDisplayState — same gates the standard renderer gets
 * from the route) instead of new semantics:
 * - the separate column needs the rating toggle (badgeRating off + populated
 *   arrays renders no separate rows);
 * - a rendered custom provider row keeps its historic priority over the
 *   separate column (never two rating stacks) but does not suppress the ★
 *   average when no separate values are active (same as the standard custom
 *   row above the genre badge);
 * - bottom styles suppress the custom row (values still render once via the
 *   separate rows, never duplicated);
 * - custom rows keep the existing MAX_CUSTOM_RATINGS cap with the existing
 *   finite-only filter (same as renderMultiRatings); separate rows keep the
 *   existing MAX_SEPARATE_RATINGS (=5) cap. No row without a real value.
 */
export function freshMetaRows(input: FreshMetaInput): FreshMetaRow[] {
  if (!input.badgesEnabled) return []
  const display = resolveSeparateDisplayState({
    badgesEnabled: input.badgesEnabled,
    badgeGenre: input.badgeGenre,
    badgeYear: input.badgeYear,
    badgeRating: input.badgeRating,
    separateRatings: input.separateRatingsEnabled,
    separateRatingsStyle: input.separateRatingsStyle ?? "column",
    sepItemCount: (input.separateRatings ?? []).length,
  })
  const rows: FreshMetaRow[] = []
  if (display.effectiveBadgeGenre && input.genreName) {
    rows.push({ kind: "genre", text: input.genreName.toUpperCase(), star: false })
  }
  const customItems = (input.customRatings ?? [])
    .filter((c) => Number.isFinite(c.value))
    .slice(0, MAX_CUSTOM_RATINGS)
  const showCustom = input.customRatingsEnabled && !display.suppressCustomRow && customItems.length > 0
  const separates = (input.separateRatings ?? []).slice(0, MAX_SEPARATE_RATINGS)
  const showSeparate = !showCustom && separates.length > 0 && (display.useSeparate || display.bottomActive)
  if (showCustom) {
    for (const c of customItems) {
      rows.push({ kind: "custom", text: `${formatRating(c.value, c.format)} ${String(c.name ?? c.id).toUpperCase()}`, star: false })
    }
  }
  if (showSeparate) {
    for (const s of separates) {
      rows.push({ kind: "separate", text: `${formatSeparateValue(s.id, s.value)} ${s.id.toUpperCase()}`, star: false })
    }
  } else if (display.effectiveBadgeRating && input.voteAverage !== null && input.voteAverage > 0) {
    rows.push({ kind: "rating", text: input.voteAverage.toFixed(1), star: true })
  }
  if (display.effectiveBadgeYear && input.year) {
    rows.push({ kind: "year", text: input.year, star: false })
  }
  return rows
}

/** Full-canvas legibility shade: left gradient + bottom gradient (native SVG). */
export async function renderFreshShade(CW: number, CH: number, zoneW: number): Promise<Buffer> {
  const fadeX = Math.round(zoneW * 1.5)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">` +
    `<defs>` +
    `<linearGradient id="freshSide" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${fadeX}" y2="0">` +
    `<stop offset="0" stop-color="#000000" stop-opacity="0.42"/>` +
    `<stop offset="0.55" stop-color="#000000" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<linearGradient id="freshBottom" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0.5"/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect width="${CW}" height="${CH}" fill="url(#freshSide)"/>` +
    `<rect width="${CW}" height="${CH}" fill="url(#freshBottom)"/>` +
    `</svg>`
  return renderSVG(svg, CW)
}

interface NumeralSvgBox {
  readonly svgW: number
  readonly svgH: number
  readonly textX: number
  readonly baselineY: number
  readonly rim: number
  readonly strokeW: number
  readonly track: number
  /** feMorphology dilate radius for the silhouette ring (outer rim extent). */
  readonly ringR: number
}

/** Rim stroke width for a numeral box (outer glass edge weight). */
export function freshNumeralStrokeWidth(box: FreshNumeralBox): number {
  return Math.max(2, Math.round(box.fontSize * 0.03))
}

function numeralSvgBox(box: FreshNumeralBox): NumeralSvgBox {
  const strokeW = freshNumeralStrokeWidth(box)
  const rim = strokeW + 8
  const track = freshNumeralTrack(box.fontSize)
  // Scratch canvas from the CONDENSED estimate widened by
  // FRESH_NUMERAL_SCRATCH_W (never a per-digit tune, never shipped): the
  // real Black-digit ink always fits with wide margin on every rank
  // 1..FRESH_RANK_MAX (condensation scales ink and estimate together, so the
  // real/est ceiling is unchanged), then the shipped layer is cropped to the
  // MEASURED ink plus the uniform rim pad — measured fitting, not buffer
  // expansion, decides the output geometry.
  const svgW = Math.max(1, Math.ceil(box.estW * FRESH_NUMERAL_SCRATCH_W) + rim * 2)
  const svgH = Math.max(1, box.capH + Math.round(box.fontSize * 0.1) + rim * 2)
  return { svgW, svgH, textX: rim, baselineY: rim + box.capH, rim, strokeW, track, ringR: Math.max(1, Math.ceil(strokeW / 2)) }
}

const FRESH_NUMERAL_FONT = "Inter, Arial, Helvetica, sans-serif"

export interface FreshNumeralSvg {
  readonly svgW: number
  readonly svgH: number
  readonly rim: number
  readonly ringR: number
  /** The shared `<text>` element (white fill): mask, rim ring source and any
   *  derived reference render the identical glyphs, so layers cannot misalign. */
  readonly textEl: string
}

/**
 * Shared SVG text element + canvas dims for a numeral box. Single source for
 * the fill mask, the rim ring source and test reference renders.
 *
 * Task12 slender style (c2 rank-aware): the glyphs render condensed through
 * `transform="scale(<cx> 1)"` (anisotropic geometry on the shared
 * source — never a post-scale of the frosted bitmap, so the artwork ROI
 * still samples the final transformed ink), where `<cx>` is the box factor
 * (`box.condenseX`: portrait 10..100 → 0.42, portrait 1..9 → 0.6,
 * landscape every rank → 0.6, fallback 0.6). The x
 * origin is pre-compensated (`rim / <cx>`) so the rendered left edge lands
 * exactly on the rim pad; the effective tracking is the attribute tracking
 * × <cx> (tighter with the narrower glyphs, still proportional — no seam
 * risk). Y is untouched by the transform (cap height, baseline, meta chain).
 */
export function freshNumeralSvg(box: FreshNumeralBox): FreshNumeralSvg {
  const svg = numeralSvgBox(box)
  const cx = freshBoxCondenseX(box)
  const condensedX = Math.round((svg.textX / cx) * 100) / 100
  const textEl =
    `<text x="${condensedX}" y="${svg.baselineY}" font-family="${FRESH_NUMERAL_FONT}" ` +
    `font-size="${box.fontSize}" font-weight="800" letter-spacing="${svg.track}" ` +
    `transform="scale(${cx} 1)" ` +
    `fill="#ffffff">${escSvg(box.text)}</text>`
  return { svgW: svg.svgW, svgH: svg.svgH, rim: svg.rim, ringR: svg.ringR, textEl }
}

/**
 * Rasterized glyph mask for a numeral box (white glyphs on transparent).
 * Single source for the glass fill/model clipping AND the rim ring source,
 * so fill, light modeling and rim can never misalign. Rendered with the
 * deterministic resvg font database at canvas resolution.
 */
export async function renderFreshNumeralMask(
  box: FreshNumeralBox,
): Promise<{ png: Buffer; w: number; h: number }> {
  const svg = freshNumeralSvg(box)
  const maskSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svg.svgW}" height="${svg.svgH}" viewBox="0 0 ${svg.svgW} ${svg.svgH}">` +
    svg.textEl +
    `</svg>`
  return { png: await renderSVG(maskSvg, svg.svgW), w: svg.svgW, h: svg.svgH }
}

/**
 * Shared defs for the numeral rim: the bright vertical-gradient stops, the
 * silhouette-ring filter (dilated rasterized alpha minus the alpha itself)
 * and the mask applying that ring. Single source for the production rim
 * (plus drop shadow) and the shadowless test reference, so the seam geometry
 * under test is exactly the shipped geometry.
 */
export function freshNumeralRimDefs(box: FreshNumeralBox): { svgW: number; svgH: number; defs: string } {
  const svg = freshNumeralSvg(box)
  const { svgW, svgH, ringR } = svg
  const defs =
    `<linearGradient id="freshRim" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/>` +
    `<stop offset="0.35" stop-color="#ffffff" stop-opacity="0.55"/>` +
    `<stop offset="0.7" stop-color="#e2e8f0" stop-opacity="0.35"/>` +
    `<stop offset="1" stop-color="#ffffff" stop-opacity="0.68"/>` +
    `</linearGradient>` +
    `<filter id="freshNumRing" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    `<feMorphology in="SourceAlpha" operator="dilate" radius="${ringR}" result="sil"/>` +
    `<feComposite in="sil" in2="SourceAlpha" operator="out" result="ring"/>` +
    `<feFlood flood-color="#ffffff" result="ringFill"/>` +
    `<feComposite in="ringFill" in2="ring" operator="in"/>` +
    `</filter>` +
    `<mask id="freshNumRingM" maskUnits="userSpaceOnUse" x="0" y="0" width="${svgW}" height="${svgH}">` +
    `<g filter="url(#freshNumRing)">${svg.textEl}</g>` +
    `</mask>`
  return { svgW, svgH, defs }
}

/**
 * Seamless beveled rim for a numeral box: bright vertical-gradient ring
 * derived from the unioned glyph silhouette (dilated rasterized alpha minus
 * the alpha itself) + the shared soft drop shadow. A stroked
 * `<text fill="none">` would draw every font subpath contour — including the
 * overlapping inner contours of glyphs like "4" — as visible seam lines deep
 * inside the fill (measured 17.9% of deep-interior pixels carrying rim
 * alpha); the morphology ring lives only outside the silhouette edge
 * (measured 0.00% interior), so overlapping subpaths can never show, while
 * the frosted rim aesthetic (same gradient stops, same shadow) is preserved.
 */
export async function renderFreshNumeralRim(
  box: FreshNumeralBox,
): Promise<{ png: Buffer; w: number; h: number }> {
  const { svgW, svgH, defs } = freshNumeralRimDefs(box)
  const rimSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">` +
    `<defs>${defs}` +
    `<filter id="freshNumShadow" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.6"/>` +
    `</filter>` +
    `</defs>` +
    `<g filter="url(#freshNumShadow)">` +
    `<rect width="${svgW}" height="${svgH}" fill="url(#freshRim)" mask="url(#freshNumRingM)"/>` +
    `</g></svg>`
  return { png: await renderSVG(rimSvg, svgW), w: svgW, h: svgH }
}

/**
 * Place a layer-sized overlay onto the ROI canvas at (dx, dy), cropping the
 * overlay to the visible intersection first. A transformed numeral layer can
 * exceed the ROI on any side (user scale up, offsets toward an edge):
 * without the crop, sharp rejects the oversized overlay ("must have same
 * dimensions or smaller"). Returns null when nothing is visible.
 */
async function placeOverlayInRoi(
  png: Buffer,
  w: number,
  h: number,
  dx: number,
  dy: number,
  roiW: number,
  roiH: number,
): Promise<{ png: Buffer; left: number; top: number } | null> {
  const x0 = Math.max(0, -dx)
  const y0 = Math.max(0, -dy)
  const x1 = Math.min(w, roiW - dx)
  const y1 = Math.min(h, roiH - dy)
  if (x1 <= x0 || y1 <= y0) return null
  const cropped =
    x1 - x0 === w && y1 - y0 === h
      ? png
      : await sharp(png)
          .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
          .toBuffer()
  return { png: cropped, left: dx + x0, top: dy + y0 }
}

/**
 * Tight real glyph ink bounds of a rasterized numeral mask (alpha channel
 * scan at canvas resolution — the authoritative ink reality, not the width
 * estimate). Returns null when the mask carries no ink.
 */
export async function measureNumeralInk(
  maskPng: Buffer,
  threshold = 10,
): Promise<{ minX: number; maxX: number; minY: number; maxY: number; w: number; h: number } | null> {
  const { data, info } = await sharp(maskPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let maxX = -1
  let minY = info.height
  let maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX) return null
  return { minX, maxX, minY, maxY, w: info.width, h: info.height }
}

/**
 * Glass rank numeral: artwork-derived translucent fill (ROI-local blur of the
 * actual base, masked by the glyphs) + vertical light modeling (sheen top,
 * shade bottom, clipped to the glyphs) + beveled gradient rim derived from
 * the unioned glyph silhouette (seamless — no raw outline strokes) with drop
 * shadow. This is a simplified frosted-glass approximation, not true
 * refraction: there is no refractive displacement of the artwork (sharp
 * offers no bounded displacement primitive) — the fill is the blurred,
 * lifted artwork itself, so the glyphs always carry the local artwork hues.
 * All processing is bounded to the numeral ROI at canvas resolution —
 * no full-frame loops, no upscaling.
 */
export async function renderFreshGlassNumeral(
  base: Buffer,
  CW: number,
  CH: number,
  box: FreshNumeralBox,
): Promise<{ png: Buffer; w: number; h: number; left: number; top: number }> {
  const svg = numeralSvgBox(box)
  const { svgW, svgH, rim } = svg
  const maskFull = (await renderFreshNumeralMask(box)).png
  // Measured fitting (not buffer expansion): every shipped numeral layer is
  // cropped to the REAL rasterized ink plus the uniform rim pad (the pad
  // covers the morphology ring; the ROI bleed below covers the shadow
  // fringe). One bounded alpha scan plus native extracts — no cache, no
  // per-digit tuning. Cropping only trims transparent margin: the glyph
  // pixels keep their scratch coordinates, so the default anchor lands
  // exactly where the geometry box puts it.
  const ink = await measureNumeralInk(maskFull)
  const cropLeft = ink ? Math.max(0, ink.minX - rim) : 0
  const cropTop = ink ? Math.max(0, ink.minY - rim) : 0
  const cropRight = ink ? Math.min(svgW, ink.maxX + rim + 1) : svgW
  const cropBottom = ink ? Math.min(svgH, ink.maxY + rim + 1) : svgH
  const crop = {
    left: cropLeft,
    top: cropTop,
    width: Math.max(1, cropRight - cropLeft),
    height: Math.max(1, cropBottom - cropTop),
  }
  const maskPng = await sharp(maskFull).extract(crop).png().toBuffer()
  const layerW = crop.width
  const layerH = crop.height

  // ROI of the base under the numeral (+ bleed for the blur), clamped inside
  // the canvas so sharp.extract never rejects.
  const layerLeft = box.left - rim + cropLeft
  const layerTop = box.top - rim + cropTop
  const rx0 = Math.max(0, layerLeft - FRESH_NUMERAL_BLEED)
  const ry0 = Math.max(0, layerTop - FRESH_NUMERAL_BLEED)
  const rx1 = Math.min(CW, layerLeft + layerW + FRESH_NUMERAL_BLEED)
  const ry1 = Math.min(CH, layerTop + layerH + FRESH_NUMERAL_BLEED)
  // Extreme user offsets can push the transformed box fully outside the
  // canvas: there is no artwork to sample, so the fill/modeling drop out
  // and only the rim survives (the downstream composite clips off-canvas
  // layers natively — never a throw, never an invalid extract).
  if (rx1 <= rx0 || ry1 <= ry0) {
    const rimFull = (await renderFreshNumeralRim(box)).png
    const rimPng = await sharp(rimFull).extract(crop).png().toBuffer()
    return { png: rimPng, w: layerW, h: layerH, left: layerLeft, top: layerTop }
  }
  const roiW = Math.max(1, rx1 - rx0)
  const roiH = Math.max(1, ry1 - ry0)
  const dx = layerLeft - rx0
  const dy = layerTop - ry0

  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
  const maskPlaced = await placeOverlayInRoi(maskPng, layerW, layerH, Math.round(dx), Math.round(dy), roiW, roiH)
  const maskCanvas = await sharp({ create: { width: roiW, height: roiH, channels: 4, background: transparent } })
    .composite(maskPlaced ? [{ input: maskPlaced.png, left: maskPlaced.left, top: maskPlaced.top }] : [])
    .png()
    .toBuffer()

  // Artwork-derived frost fill (simplified frosted-glass approximation — no
  // refractive displacement): ROI blur + lift, clipped by the glyphs.
  const roiBlur = await sharp(base)
    .extract({ left: rx0, top: ry0, width: roiW, height: roiH })
    .blur(FRESH_GLASS_BLUR)
    .modulate({ brightness: 1.12, saturation: 1.15 })
    .png()
    .toBuffer()
  const fillPng = await sharp(roiBlur)
    .composite([{ input: maskCanvas, blend: "dest-in" }])
    .png()
    .toBuffer()

  // Light modeling clipped to the glyphs: sheen top, shade bottom.
  const modelSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">` +
    `<defs><linearGradient id="freshModel" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/>` +
    `<stop offset="0.42" stop-color="#ffffff" stop-opacity="0.06"/>` +
    `<stop offset="0.62" stop-color="#000000" stop-opacity="0.10"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0.52"/>` +
    `</linearGradient></defs>` +
    `<rect width="${svgW}" height="${svgH}" fill="url(#freshModel)"/>` +
    `</svg>`
  const modelFull = await renderSVG(modelSvg, svgW)
  // Same measured crop as the mask: the vertical light gradient keeps its
  // glyph alignment because every layer is cut from identical scratch
  // coordinates.
  const modelPng = await sharp(modelFull).extract(crop).png().toBuffer()
  const modelPlaced = await placeOverlayInRoi(modelPng, layerW, layerH, Math.round(dx), Math.round(dy), roiW, roiH)
  const modelCanvas = await sharp({ create: { width: roiW, height: roiH, channels: 4, background: transparent } })
    .composite(modelPlaced ? [{ input: modelPlaced.png, left: modelPlaced.left, top: modelPlaced.top }] : [])
    .png()
    .toBuffer()
  const modelMasked = await sharp(modelCanvas)
    .composite([{ input: maskCanvas, blend: "dest-in" }])
    .png()
    .toBuffer()

  // Beveled rim (renderFreshNumeralRim): bright gradient ring derived from
  // the unioned silhouette + the shared drop shadow — seamless by
  // construction, same frosted aesthetic as the fill/model above. Same
  // measured crop: ring and shadow keep their glyph alignment.
  const rimFull = (await renderFreshNumeralRim(box)).png
  const rimPng = await sharp(rimFull).extract(crop).png().toBuffer()

  const rimPlaced = await placeOverlayInRoi(rimPng, layerW, layerH, Math.round(dx), Math.round(dy), roiW, roiH)
  const png = await sharp({ create: { width: roiW, height: roiH, channels: 4, background: transparent } })
    .composite([
      { input: fillPng, left: 0, top: 0 },
      { input: modelMasked, left: 0, top: 0 },
      ...(rimPlaced ? [{ input: rimPlaced.png, left: rimPlaced.left, top: rimPlaced.top }] : []),
    ])
    .png()
    .toBuffer()
  return { png, w: roiW, h: roiH, left: rx0, top: ry0 }
}

/**
 * Left artwork-softening band (task8b, user-approved "parte dalla parte
 * sinistra e termina quando finisce il numero"): ONLY effective Fresh WITH a
 * valid displayed rank numeral. A full-height vertical strip of the artwork,
 * blurred once, composited UNDER the fresh shade with a smooth horizontal
 * alpha gradient — strong (opaque) at the canvas left edge, fading gradually
 * to fully sharp (alpha 0) exactly at the RIGHT VISIBLE INK BOUND of the
 * transformed numeral plus a tiny feather. No hard vertical seam, no
 * full-image softening.
 *
 * GEOMETRY (explicit decision — the user reference shows a left band ending
 * where the number ends, with no vertical constraint stated): the band is a
 * FULL-HEIGHT strip (`top = 0`, `height = CH` — Y is independent of the
 * numeral by design, minimal cost: one bounded ROI, no per-row logic). The
 * HORIZONTAL extent follows the numeral X/scale: `left = 0` always (strong at
 * the canvas edge even when the user nudges the numeral right with `tox`),
 * `right = clamp(round(canvasInkRight + FRESH_LEFT_BLUR_FEATHER), 1, CW)`
 * where `canvasInkRight` is the TIGHT REAL INK bound (task5
 * `measureNumeralInk` alpha scan at canvas resolution, mapped through the
 * same `box.left - rim` scratch origin the glass fill uses — never the
 * `estW` estimate, never the `zoneW` column width). A numeral fully outside
 * the canvas (no ink/canvas intersection) renders NO band (skip, never an
 * invalid ROI, never a sharp throw, never a whole-canvas blur by surprise);
 * a partially visible numeral clamps the width inside the canvas like every
 * other layer.
 *
 * BASE CHOICE (consistent, no extra cost): the glass fill keeps sampling the
 * ORIGINAL `posterBuf` (unchanged — no re-sampling, no second composite
 * pass). The band shares the glass sigma (`FRESH_LEFT_BLUR_SIGMA ==
 * FRESH_GLASS_BLUR`), so the overlap region under the numeral stays
 * hue-coherent; the fresh shade composites OVER the band exactly as it did
 * over the sharp artwork, so background luminance/legibility is preserved
 * and only detail softens. The rim shape/clipping fix (task5 morphology ring
 * + measured-ink crop) is untouched — the band sits strictly below the
 * numeral layer.
 *
 * PERF: one bounded ROI extract (stripW × CH ≤ canvas), ONE blur pass with a
 * bounded constant sigma, one raw RGBA alpha-gradient loop (deterministic
 * Bayer dither, same convention as blur.ts — never Math.random, ETag stable),
 * ONE PNG encode (no PNG decode roundtrip: the blurred pixels never leave
 * the raw pipeline before the single encode). No new timeouts, no new
 * concurrency, no sharp globals. Never on Standard, never on Fresh without a
 * numeral (unranked `all` or ranked-fallback-Standard are byte-identical).
 */
export const FRESH_LEFT_BLUR_SIGMA = 9
/** Pixels past the numeral ink right edge where the band alpha lands on 0. */
export const FRESH_LEFT_BLUR_FEATHER = 32

export interface FreshLeftBlurRegion {
  readonly left: 0
  readonly top: 0
  readonly width: number
  readonly height: number
  /** Canvas x of the numeral ink right edge the width was derived from. */
  readonly inkRight: number
}

/**
 * Pure horizontal geometry for the left blur band. Returns null when there
 * is no usable ink bound (non-finite) or nothing would be visible.
 */
export function freshLeftBlurRegion(
  CW: number,
  CH: number,
  inkRightCanvas: number,
): FreshLeftBlurRegion | null {
  if (!Number.isFinite(CW) || !Number.isFinite(CH) || CW < 1 || CH < 1) return null
  if (typeof inkRightCanvas !== "number" || !Number.isFinite(inkRightCanvas)) return null
  const width = Math.min(Math.round(CW), Math.max(1, Math.round(inkRightCanvas + FRESH_LEFT_BLUR_FEATHER)))
  if (width < 1) return null
  return { left: 0, top: 0, width, height: Math.round(CH), inkRight: inkRightCanvas }
}

/**
 * Band alpha at canvas column x (0..255): opaque at the canvas left,
 * eased smoothstep fade to exactly 0 at the last band column (no seam —
 * the derivative lands at zero, same landing convention as the bottom-blur
 * ease-out). The single gamma (s^1.3) holds the band slightly more uniform
 * behind the numeral ink before grading off — no opaque plateau, still 255
 * at x=0 and 0 at the band end. Monotonic non-increasing; deterministic
 * (no random).
 */
export function freshLeftBlurAlpha(x: number, width: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 1) return x <= 0 ? 255 : 0
  const t = Math.min(1, Math.max(0, x / (width - 1)))
  const s = t * t * (3 - 2 * t)
  const e = Math.pow(s, 1.3)
  return Math.round(255 * (1 - e))
}

/**
 * Render the left blur band for a transformed numeral box. Measures the real
 * ink (same mask + threshold convention as the glass fill) so the band ends
 * at the VISIBLE numeral, tracking user X/scale automatically through the
 * box. Returns null for absent/invalid/offscreen numerals (no effect).
 */
export async function renderFreshLeftBlurStrip(
  base: Buffer,
  CW: number,
  CH: number,
  box: FreshNumeralBox,
): Promise<{ png: Buffer; w: number; h: number; left: 0; top: 0 } | null> {
  const mask = await renderFreshNumeralMask(box)
  const ink = await measureNumeralInk(mask.png)
  if (!ink) return null
  // Same scratch→canvas origin as the glass fill (`box.left - rim`): the
  // shipped numeral pixels keep their scratch coordinates, so the band bound
  // below matches the composited numeral exactly.
  const rim = freshNumeralSvg(box).rim
  const inkLeft = box.left - rim + ink.minX
  const inkRight = box.left - rim + ink.maxX
  const inkTop = box.top - rim + ink.minY
  const inkBottom = box.top - rim + ink.maxY
  // Fully offscreen (any side): skip — never blur the whole canvas because
  // the number is not visible.
  if (inkRight < 0 || inkLeft >= CW || inkBottom < 0 || inkTop >= CH) return null
  const region = freshLeftBlurRegion(CW, CH, inkRight)
  if (!region) return null
  // Clamp the ROI inside the actual base dims (extreme scales/paths must
  // never throw an invalid extract; same canvas-resolution assumption as the
  // glass fill, defensively clamped).
  const meta = await sharp(base).metadata()
  const baseW = meta.width ?? CW
  const baseH = meta.height ?? CH
  const stripW = Math.max(1, Math.min(region.width, baseW, Math.round(CW)))
  const stripH = Math.max(1, Math.min(region.height, baseH, Math.round(CH)))
  const { data, info } = await sharp(base)
    .extract({ left: 0, top: 0, width: stripW, height: stripH })
    .blur(FRESH_LEFT_BLUR_SIGMA)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const overlay = Buffer.alloc(stripW * stripH * 4)
  for (let y = 0; y < stripH; y++) {
    const bayerRow = (y & 3) << 2
    const rowBase = y * stripW
    for (let x = 0; x < stripW; x++) {
      const si = (rowBase + x) * info.channels
      const di = (rowBase + x) * 4
      // Deterministic ordered Bayer dither (±1 LSB, same amplitude
      // convention as blur.ts): decorrelates the alpha-gradient quantization
      // without shifting the local mean — ETag/snapshot stable.
      const dither = (FRESH_LEFT_BLUR_BAYER[bayerRow | (x & 3)]! - 7.5) / 8
      const alphaBase = freshLeftBlurAlpha(x, stripW)
      overlay[di] = Math.min(255, Math.max(0, Math.round((data[si] ?? 0) + dither)))
      overlay[di + 1] = Math.min(255, Math.max(0, Math.round((data[si + 1] ?? 0) + dither)))
      overlay[di + 2] = Math.min(255, Math.max(0, Math.round((data[si + 2] ?? 0) + dither)))
      // Dither alpha only inside the gradient: exact 0/255 carry no
      // quantization error to decorrelate (same rule as blur.ts).
      const alphaDither = alphaBase > 0 && alphaBase < 255 ? dither : 0
      overlay[di + 3] = Math.min(255, Math.max(0, Math.round(alphaBase + alphaDither)))
    }
  }
  const png = await sharp(overlay, { raw: { width: stripW, height: stripH, channels: 4 } })
    .png()
    .toBuffer()
  return { png, w: stripW, h: stripH, left: 0, top: 0 }
}

/** Ordered 4x4 Bayer matrix (0..15, row-major) — deterministic band dither. */
const FRESH_LEFT_BLUR_BAYER = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]

/**
 * Task16 reversible experiment (ONE candidate, user-authorized "fascia
 * laterale ricostruita dall'artwork sfocata e raccordata al poster
 * leggermente spostato a destra, non soltanto sfocatura sovrapposta" —
 * SOLO effective Fresh WITH a valid rank numeral, everything else intact).
 *
 * The full-bleed artwork shifts RIGHT by ~6% CW (30px @500 portrait,
 * 46px @768 landscape — `freshReconstructShiftX`), keeping canvas dims and
 * no art scale change; the rightmost `shiftX` strip is necessarily cropped
 * (documented — do NOT claim art pixels unchanged). The vacated LEFT gap
 * (width `shiftX`, full height, root at canvas left 0) is filled with an
 * artwork-derived horizontal extension: the leftmost `shiftX` columns of the
 * ORIGINAL base, mirrored (`flop`, typical edge extension, bounded small
 * ROI), stretched to exactly the gap width when needed, BLURRED once at the
 * current sigma 9 (`FRESH_LEFT_BLUR_SIGMA`), then composited at left 0 under
 * the shifted original (root position of the shifted art: left = `shiftX`,
 * top = 0). No generative AI, no art downloads, no donor copy-pasta, no new
 * colors: every reconstructed pixel derives ONLY from the artwork.
 *
 * Seam: the extension is blurred (high frequencies removed) and the existing
 * left-blur band (`renderFreshLeftBlurStrip`, same sigma, ink-bound +
 * feather gradient) is sourced from the PREPARED background, so it blurs
 * ACROSS the seam at x = `shiftX` — no blank/gap, no hard vertical seam, no
 * duplicated faces/tiles (the source is a bounded edge strip, not a content
 * region). The band keeps its full-height/feather concept and only covers
 * the numeral region moderately, never the whole poster; no task14-style
 * full-width opaque plateau.
 *
 * Single conceptual render path: `prepareFreshReconstructedBackground` runs
 * ONCE in poster-service for Fresh-ranked only and the returned buffer is
 * used consistently as the pipeline base AND the `posterBuf` forwarded to
 * `composeFreshOverlay` (glass fill ROI + left-blur strip sample the NEW
 * shifted view BEFORE the font mask — rank Y/X untouched). Standard,
 * Fresh-unranked and invalid-rank paths never call it (byte-identical).
 * Color analysis (`extractSceneTint`/accent/bottom-blur tint) stays on the
 * ORIGINAL base. Native sharp ops only, bounded to ONE decoded base plus
 * the small edge ROI; no PNG roundtrip for the blur overlay path (kept raw
 * there); this helper performs ONE LOSSLESS PNG encode of the raw-assembled
 * canvas (no JPEG/PNG intermediate roundtrips: the shifted region stays
 * pixel-identical to the original decode) — one bounded full-canvas raw
 * assembly under the Fresh shade / numeral / meta / title and retained
 * chrome (never above shading).
 */
export const FRESH_RECONSTRUCT_SHIFT_SHARE = 0.06

/** Right-shift for the reconstructed band: round(CW * 0.06) (30 @500, 46 @768). */
export function freshReconstructShiftX(CW: number): number {
  if (!Number.isFinite(CW) || CW < 1) return 0
  return Math.max(1, Math.round(CW * FRESH_RECONSTRUCT_SHIFT_SHARE))
}

export interface FreshReconstructedBackground {
  readonly png: Buffer
  /** Explicit root position of the shifted original (left offset, top always 0). */
  readonly shiftX: number
  readonly CW: number
  readonly CH: number
}

/**
 * Build the prepared Fresh-ranked background (see block doc above). Returns
 * the ORIGINAL buffer untouched when the shift cannot apply (degenerate
 * canvas, base dims mismatch, shift covering the canvas).
 *
 * Task16 c1 LOSSLESS correction: the previous candidate inherited the input
 * JPEG family through the intermediate `.toBuffer()` calls (main + mirrored
 * edge) and re-encoded the final composite as JPEG q90 — multiple lossy
 * roundtrips over the whole poster, violating "il resto intatto". This
 * version decodes the input ONCE to a raw RGBA view at canvas native size,
 * derives the mirrored edge through a SINGLE raw sharp pipeline
 * (flop → optional fill-resize → sigma-9 blur, no JPEG/PNG encode in the
 * middle), assembles the final canvas by bounded raw row copies (gap =
 * blurred extension, rest = exact shifted original), and performs ONE
 * LOSSLESS PNG encode (the interface field is named `png` and the returned
 * buffer is now actually PNG). No hand-rolled resize of the artwork, no
 * renderer recreation, no duplicate full-frame allocs beyond the two bounded
 * canvas buffers (≤768×432 / 500×750 ×4 ≈ 1.5MB each) plus the tiny edge ROI.
 */
export async function prepareFreshReconstructedBackground(
  base: Buffer,
  CW: number,
  CH: number,
): Promise<FreshReconstructedBackground> {
  const shiftX = freshReconstructShiftX(CW)
  const fallback = { png: base, shiftX: 0, CW, CH }
  if (!Number.isFinite(CW) || !Number.isFinite(CH) || CW < 2 || CH < 1) return fallback
  if (shiftX < 1 || CW - shiftX < 1) return fallback
  const W = Math.round(CW)
  const H = Math.round(CH)
  // Single decode of the input at canvas native size (header + pixels once —
  // no separate metadata() decode; the dims gate reads the decoded info).
  const { data: baseRaw, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== W || info.height !== H || info.channels !== 4) return fallback
  const mainW = W - shiftX
  // Edge-derived extension: leftmost bounded ROI (shiftX columns, capped for
  // safety), mirrored horizontally (flop = typical edge extension), resized
  // to exactly the gap width only when the ROI is narrower, blurred sigma 9.
  // Raw-only derivation: the edge ROI is sliced from the single decoded view
  // (no second base decode), then ONE raw pipeline (flop → optional resize →
  // blur → raw) with zero intermediate encodes.
  const edgeW = Math.max(1, Math.min(shiftX, mainW, 64))
  const edgeRaw = Buffer.alloc(edgeW * H * 4)
  for (let y = 0; y < H; y++) {
    baseRaw.copy(edgeRaw, y * edgeW * 4, y * W * 4, y * W * 4 + edgeW * 4)
  }
  let extPipeline = sharp(edgeRaw, { raw: { width: edgeW, height: H, channels: 4 } }).flop()
  if (edgeW !== shiftX) {
    extPipeline = extPipeline.resize(shiftX, H, { fit: "fill" })
  }
  const { data: extRaw } = await extPipeline
    .blur(FRESH_LEFT_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true })
  // Final canvas: every pixel is art-derived (no black/uninitialised holes).
  // Gap [0, shiftX) = blurred mirrored edge; [shiftX, W) = exact shifted
  // original (raw row copy — lossless pixel identity, alpha preserved).
  const out = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) {
    extRaw.copy(out, y * W * 4, y * shiftX * 4, (y + 1) * shiftX * 4)
    baseRaw.copy(out, y * W * 4 + shiftX * 4, y * W * 4, y * W * 4 + mainW * 4)
  }
  // Single lossless encode (PNG, as the interface field promises). The final
  // pipeline re-decodes this buffer; PNG roundtrips bit-exactly so the
  // shifted region stays pixel-identical to the original decode.
  const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer()
  return { png, shiftX, CW: W, CH: H }
}

/** Meta text column (genre / rating / year / separate / custom lines).
 *
 * Rows fit the column in two layers: each row measures its text with the
 * existing estimateTextWidth (per-row font via fontFamilyFor, so
 * Hebrew/Arabic falls back to Rubik like every other badge) and shrinks
 * its font to the available width — letter-spacing scales proportionally
 * with the size and is additionally capped at half the ink width per row
 * (this resvg advances tracking on top of the textLength box: uncapped
 * tracking alone would span past the column no matter how small the font),
 * so arbitrarily long labels (>200 chars) still converge instead of
 * overflowing on spacing alone; then every glyph row carries a
 * shared textLength lock (`textFitAttrs`, same `spacingAndGlyphs` primitive
 * as every standard badge) clamping the rendered advance to the ink region,
 * so estimator error can never clip glyphs outside the column. A shadow
 * pad is reserved on both sides (the drop shadow may bleed past the ink).
 * The whole block then shrinks to maxH when present (caller reserves the
 * provider slot + bottom margin). Star rows scale as one unit. Nothing is
 * truncated and nothing leaves the block.
 */
export async function renderFreshMetaColumn(
  rows: readonly FreshMetaRow[],
  geo: FreshLayoutGeometry,
  font: BadgeFont = "inter",
  maxH?: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (rows.length === 0) return null
  const f = normalizeBadgeFont(font)
  const w = Math.max(24, geo.zoneW)
  const availW = Math.max(24, geo.metaAvailW)
  // Ink region available to glyphs: the shadow (feDropShadow stdDeviation 3,
  // dy 2) bleeds ~a few px past the glyph advance on each side.
  const FRESH_META_SHADOW_PAD = 8
  const fitW = Math.max(8, availW - FRESH_META_SHADOW_PAD * 2)
  const FRESH_META_MIN_SIZE = 8
  // Proportional width fit: tracking follows the size (spacingBase is the
  // tracking-per-char at the base size), so the loop always converges —
  // even a >200-char label reaches min size with a bounded total.
  const fitRowSize = (text: string, base: number, spacingBase: number, extraFixed: number): number => {
    // Same tracking cap as the renderer below (resvg advances
    // letter-spacing on top of the textLength box): fit against the true
    // total so the loop converges instead of shrinking on phantom width.
    const trackCap = fitW / Math.max(1, 2 * text.length)
    let size = base
    for (let guard = 0; guard < 32; guard++) {
      const k = size / base
      const spacing = Math.min(spacingBase * k, trackCap)
      const total = estimateTextWidth(text, size, f) + spacing * text.length + extraFixed
      if (total <= fitW || size <= FRESH_META_MIN_SIZE) break
      size = Math.max(FRESH_META_MIN_SIZE, Math.floor((size * fitW) / Math.max(1, total)))
    }
    return size
  };
  // Shared-bounds lock: rendered advance never exceeds the ink region, even
  // when the estimator undershoots the real glyphs. Short rows keep their
  // measured width (no stretching); long rows compress to fitW.
  const lockW = (text: string, size: number, tracking: number, cap: number): number =>
    Math.min(cap, estimateTextWidth(text, size, f) + tracking)
  const baseGap = Math.round(geo.ratingSize * 0.35)
  type Spec = { text: string; base: number; spacingBase: number; weight: number; fill: string; opacity: number; star: boolean; size: number }
  const specs: Spec[] = rows.map((row) => {
    if (row.kind === "genre") {
      const spacingBase = geo.genreSize * 0.12
      return { text: row.text, base: geo.genreSize, spacingBase, weight: 800, fill: "#ffffff", opacity: 0.92, star: false, size: fitRowSize(row.text, geo.genreSize, spacingBase, 0) }
    }
    if (row.kind === "rating") {
      // Star + gap occupy horizontal space with the digits: fit as one unit.
      const extraFor = (size: number): number => Math.round(size * 0.42) * 2 + Math.round(size * 0.25)
      let size = geo.ratingSize
      for (let guard = 0; guard < 32; guard++) {
        const total = estimateTextWidth(row.text, size, f) + size * 0.04 * row.text.length + extraFor(size)
        if (total <= fitW || size <= FRESH_META_MIN_SIZE) break
        size = Math.max(FRESH_META_MIN_SIZE, Math.floor((size * fitW) / Math.max(1, total)))
      }
      return { text: row.text, base: geo.ratingSize, spacingBase: 0, weight: 800, fill: "#ffffff", opacity: 0.92, star: true, size }
    }
    return { text: row.text, base: geo.smallSize, spacingBase: 1, weight: 700, fill: "#ffffff", opacity: 0.78, star: false, size: fitRowSize(row.text, geo.smallSize, 1, 0) }
  })
  // Block height fit: shrink every row proportionally (gap follows the rating
  // row) so meta + reserved provider slot + bottom margin stay on canvas.
  const blockH = (gap: number): number => {
    let t = 0
    for (const s of specs) t += Math.round(s.size * 0.73) + gap
    return specs.length > 0 ? t - gap + 8 : 1
  }
  let lineGap = baseGap
  if (typeof maxH === "number" && Number.isFinite(maxH) && maxH > 0) {
    for (let guard = 0; guard < 16 && blockH(lineGap) > maxH; guard++) {
      const ratio = maxH / Math.max(1, blockH(lineGap))
      let shrunk = false
      for (const s of specs) {
        const next = Math.max(FRESH_META_MIN_SIZE, Math.floor(s.size * ratio))
        if (next < s.size) { s.size = next; shrunk = true }
      }
      const nextGap = Math.max(2, Math.floor(lineGap * ratio))
      if (nextGap < lineGap) { lineGap = nextGap; shrunk = true }
      if (!shrunk) break
    }
  }
  type Placed = { y: number; size: number; base: number; spacingBase: number; weight: number; fill: string; opacity: number; star: boolean; text: string }
  const placed: Placed[] = []
  let y = 0
  const push = (spec: Spec) => {
    const capH = Math.round(spec.size * 0.73)
    y += capH
    placed.push({ y, size: spec.size, base: spec.base, spacingBase: spec.spacingBase, weight: spec.weight, fill: spec.fill, opacity: spec.opacity, star: spec.star, text: spec.text })
    y += lineGap
  }
  for (const spec of specs) push(spec)
  const h = Math.max(1, y - lineGap + 8)
  const starUnit = (size: number): number => Math.round(size * 0.42)
  const body = placed
    .map((p) => {
      const family = fontFamilyFor(p.text, f)
      if (p.star) {
        const starR = starUnit(p.size)
        const gap = Math.round(p.size * 0.25)
        const digitsW = lockW(p.text, p.size, 0, Math.max(8, fitW - (starR * 2 + gap)))
        const total = starR * 2 + gap + digitsW
        const x0 = w / 2 - total / 2
        const cy = p.y - (p.size * 0.73) / 2
        const outer = starR
        const inner = starR * 0.46
        let d = ""
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? outer : inner
          const a = -Math.PI / 2 + (i * Math.PI) / 5
          d += `${i === 0 ? "M" : "L"}${(x0 + starR + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
        }
        return `<path d="${d}Z" fill="#f5b800"/>` +
          `<text x="${(x0 + starR * 2 + gap).toFixed(1)}" y="${p.y}" font-family="${family}" font-size="${p.size}" font-weight="${p.weight}" fill="#ffffff"${textFitAttrs(digitsW)}>${escSvg(p.text)}</text>`
      }
      const spacing = p.spacingBase * (p.size / p.base)
      // resvg advances letter-spacing on top of the textLength box (glyphs
      // crush toward zero but the tracking span remains), so tracking alone
      // must never exceed the ink region: cap it at half the fit width and
      // let the textLength lock compress the glyphs into the remainder.
      const capped = Math.min(spacing, fitW / Math.max(1, 2 * p.text.length))
      const rowW = lockW(p.text, p.size, capped * p.text.length, fitW)
      return `<text x="${(w / 2).toFixed(1)}" y="${p.y}" text-anchor="middle" font-family="${family}" font-size="${p.size}" font-weight="${p.weight}" letter-spacing="${capped.toFixed(2)}" fill="${p.fill}" fill-opacity="${p.opacity}"${textFitAttrs(rowW)}>${escSvg(p.text)}</text>`
    })
    .join("")
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><filter id="freshMetaShadow" x="-20%" y="-40%" width="140%" height="180%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.8"/>` +
    `</filter></defs><g filter="url(#freshMetaShadow)">${body}</g></svg>`
  const png = await renderSVG(svg, w)
  return { png, w, h }
}

/** Scale a bitmap down to fit the provider slot (never enlarges).
 *
 * The caller enlarges `maxW`/`maxH` by the effective provider scale before
 * calling (neutral 100 = historic slot, byte-identical): one fit here then
 * grows the mark linearly with the scale until the canvas edge — never a
 * second resize of the already-scaled caller bitmap.
 */
export async function fitFreshProviderLogo(
  raw: { png: Buffer; w: number; h: number },
  maxW: number,
  maxH: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  const scale = Math.min(1, maxW / Math.max(1, raw.w), maxH / Math.max(1, raw.h))
  if (scale >= 1) return raw
  const w = Math.max(1, Math.round(raw.w * scale))
  const h = Math.max(1, Math.round(raw.h * scale))
  const png = await sharp(raw.png).resize(w, h).toBuffer()
  return { png, w, h }
}

/**
 * Shrink the reused title-logo bitmap only when it would invade the column
 * (never enlarges) and never beyond the canvas height. The caller enlarges
 * `maxW` by the effective logo scale before calling (neutral 100 =
 * historic cap, byte-identical): one fit here then grows the mark linearly
 * with the scale until the canvas edge — never a second resize of the
 * already-sized caller bitmap. `maxH` defaults to no height bound so the
 * historic 2-arg call path is unchanged.
 */
export async function fitFreshTitleLogo(
  raw: { png: Buffer; w: number; h: number },
  maxW: number,
  maxH?: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  const capH = typeof maxH === "number" && Number.isFinite(maxH) && maxH > 0 ? Math.max(1, Math.round(maxH)) : null
  if (raw.w <= maxW && (capH === null || raw.h <= capH)) return raw
  const scale = Math.min(maxW / Math.max(1, raw.w), capH === null ? Infinity : capH / Math.max(1, raw.h))
  const w = Math.max(1, Math.round(raw.w * Math.min(1, scale)))
  const h = Math.max(1, Math.round(raw.h * Math.min(1, scale)))
  if (w === raw.w && h === raw.h) return raw
  const png = await sharp(raw.png).resize(w, h).toBuffer()
  return { png, w, h }
}

export interface ComposeFreshInput {
  readonly posterBuf: Buffer
  readonly CW: number
  readonly CH: number
  readonly rank: number | null
  readonly meta: FreshMetaInput
  readonly logo: { png: Buffer; w: number; h: number } | null
  readonly provider: { png: Buffer; w: number; h: number } | null
  /** Badge font for the meta column (default "inter" = historic render). */
  readonly badgeFont?: BadgeFont | null
  /**
   * Effective per-shape transform controls (no new params — existing
   * `tscale`/`tox`/`toy`, `gscale`/`gox`/`goy`, `nox`/`noy` + follow/fixed,
   * logo `ox`/`oy`; provider/logo scales ride the bitmaps above). Absent =
   * neutral = historic baseline. Never mutated.
   */
  readonly transforms?: FreshLayoutTransforms | null
}

/** Side gap between the bottom meta block and the title logo beside it. */
const FRESH_BOTTOM_SIDE_GAP = 16

/** Top safety margin for the bottom-anchored unranked block. */
const FRESH_BOTTOM_TOP_SAFE = 8

export interface FreshUnrankedSizes {
  readonly logoW: number
  readonly logoH: number
  readonly metaW: number
  readonly metaH: number
  readonly providerW: number
  readonly providerH: number
}

export interface FreshUnrankedFlags {
  readonly hasLogo: boolean
  readonly hasMeta: boolean
  readonly hasProvider: boolean
}

/** Standard-like gap between the unranked network mark and the title logo
 * (same formula as the standard network gap: `round(6 * CH / 570)`). */
export function freshUnrankedTitleGap(CH: number): number {
  return Math.round((6 * CH) / 570)
}

export interface FreshUnrankedPlacement {
  /** Shared bottom-right anchor, identical to the ranked logo anchor. */
  readonly logoLeft: number
  readonly logoTop: number
  /** Bottom-anchored meta block beside the logo (or canvas margin). */
  readonly metaLeft: number
  readonly metaTop: number
  /** Network mark above the meta block (fallback: above the title logo). */
  readonly providerLeft: number
  readonly providerTop: number
  /** Right edge the meta block aligns to. */
  readonly blockRight: number
}

/**
 * Pure placement for the unranked fresh bottom block. No I/O: safe to
 * unit-test and to reuse in tests for pixel assertions.
 *
 * Anchor contract (both shapes):
 * - the title logo keeps its historic bottom-right anchor
 *   (`CW - w - titleRight`, `CH - h - titleBottom`), same size cap, plus its
 *   own offsets (logo scale already in the bitmap, applied once here);
 * - the meta block is bottom-anchored to the same baseline and
 *   right-aligned to the (possibly nudged) logo's left edge minus
 *   FRESH_BOTTOM_SIDE_GAP (canvas right margin when the logo is
 *   hidden/missing), so meta and logo never overlap horizontally regardless
 *   of block height; then its own offsets;
 * - the provider mark sits ABOVE THE META BLOCK whenever meta rows exist
 *   (centered on the meta block with the column gap) — never above the
 *   title logo in that case; without meta rows it falls back above the
 *   title logo (standard-like gap, centered on the title visible box), and
 *   with neither logo nor meta rows it is bottom-anchored to the same block
 *   edge on its own; then its own offsets. Missing meta rows never move the
 *   title logo (only the provider fallback changes anchor);
 * - the absolute-positioning contract (`providerFollowTitle === false` +
 *   fixed coords) wins over every auto anchor verbatim (no offsets, no gap,
 *   same as the standard layout).
 * Every layer is clamped inside the canvas. Neutral transforms reproduce
 * the historic logo/meta anchors exactly.
 */
export function freshUnrankedPlacement(
  geo: FreshLayoutGeometry,
  sizes: FreshUnrankedSizes,
  flags: FreshUnrankedFlags,
  transforms?: FreshLayoutTransforms | null,
): FreshUnrankedPlacement {
  const CW = geo.CW
  const CH = geo.CH
  const bottom = CH - geo.titleBottom
  const clampX = (w: number, x: number): number =>
    Math.max(0, Math.min(Math.round(x), Math.max(0, CW - w)))
  const clampY = (h: number, y: number): number =>
    Math.max(0, Math.min(Math.round(y), Math.max(0, CH - h)))
  const logoLeft = flags.hasLogo
    ? clampX(sizes.logoW, CW - sizes.logoW - geo.titleRight + normFreshOffset(transforms?.logoOffsetX))
    : 0
  const logoTop = flags.hasLogo
    ? clampY(sizes.logoH, CH - sizes.logoH - geo.titleBottom + normFreshOffset(transforms?.logoOffsetY))
    : 0
  const blockRight = flags.hasLogo ? logoLeft - FRESH_BOTTOM_SIDE_GAP : CW - geo.titleRight
  const metaLeft = flags.hasMeta
    ? clampX(
        sizes.metaW,
        Math.min(blockRight - sizes.metaW, Math.max(0, CW - sizes.metaW)) +
          normFreshOffset(transforms?.metaOffsetX),
      )
    : 0
  const metaTop = flags.hasMeta
    ? clampY(sizes.metaH, bottom - sizes.metaH + normFreshOffset(transforms?.metaOffsetY))
    : 0
  const providerGap = Math.round(geo.metaGap * 0.8)
  const titleGap = freshUnrankedTitleGap(CH)
  let providerLeft: number
  let providerTop: number
  if (!flags.hasProvider) {
    providerLeft = 0
    providerTop = 0
  } else if (isFreshFixedProvider(transforms)) {
    providerLeft = clampX(sizes.providerW, transforms?.providerFixedX as number)
    providerTop = clampY(sizes.providerH, transforms?.providerFixedY as number)
  } else {
    const pox = normFreshOffset(transforms?.providerOffsetX)
    const poy = normFreshOffset(transforms?.providerOffsetY)
    if (flags.hasMeta) {
      // Above the meta block (user reversal): centered on the meta block,
      // following its (possibly nudged) position, plus its own offsets.
      const metaCX = metaLeft + sizes.metaW / 2
      providerLeft = clampX(sizes.providerW, Math.round(metaCX - sizes.providerW / 2) + pox)
      providerTop = clampY(sizes.providerH, metaTop - providerGap - sizes.providerH + poy)
    } else if (flags.hasLogo) {
      // No meta rows: fallback above the title logo (standard-like gap,
      // centered on the title visible box). The title never moves for
      // missing meta.
      const titleCX = logoLeft + sizes.logoW / 2
      providerLeft = clampX(sizes.providerW, Math.round(titleCX - sizes.providerW / 2) + pox)
      providerTop = clampY(sizes.providerH, logoTop - titleGap - sizes.providerH + poy)
    } else {
      providerLeft = clampX(sizes.providerW, blockRight - sizes.providerW + pox)
      providerTop = clampY(sizes.providerH, bottom - sizes.providerH + poy)
    }
  }
  return { logoLeft, logoTop, metaLeft, metaTop, providerLeft, providerTop, blockRight }
}

/**
 * Fresh overlay layers. The caller splices them BEFORE the retained standard
 * chrome (quality pill, Coming Soon ribbon, extra top badge) so the fresh
 * shade never darkens that chrome; base + blur + encoding stay with the
 * single renderer (canonical pipeline, abort/slot protections unchanged).
 * Meta, provider and logo are clamped inside the canvas even with the
 * maximum row count (custom MAX_CUSTOM_RATINGS + MAX_SEPARATE_RATINGS separate).
 */
export async function composeFreshOverlay(input: ComposeFreshInput): Promise<PosterComposite[]> {
  const layers: PosterComposite[] = []
  const t = input.transforms ?? null
  const geo = freshGeometry(input.CW, input.CH, input.rank, t)
  if (geo.numeral) {
    // Task8b left artwork-softening band (ranked ONLY — unranked/Standard
    // never reach this branch): UNDER the shade so the shade darkens the
    // blurred band exactly as it darkened the sharp artwork (luminance
    // preserved, only detail softens), and strictly below the numeral/meta/
    // title layers and the retained caller chrome (quality/ribbon/extra).
    const strip = await renderFreshLeftBlurStrip(input.posterBuf, input.CW, input.CH, geo.numeral)
    if (strip) layers.push({ input: strip.png, top: strip.top, left: strip.left })
  }
  layers.push({ input: await renderFreshShade(input.CW, input.CH, geo.zoneW), top: 0, left: 0 })
  if (geo.numeral) {
    // The numeral geometry above already carries the user scale/offsets, so
    // the glass fill ROI below samples the transformed location — never a
    // post-resize of a neutrally sampled fill.
    const num = await renderFreshGlassNumeral(input.posterBuf, input.CW, input.CH, geo.numeral)
    layers.push({ input: num.png, top: num.top, left: num.left })
  }
  // Ranked composition keeps the historic left column at neutral transforms;
  // anything without a valid numeral moves the meta block to the bottom
  // content area beside the title logo, network above the meta block
  // (freshUnrankedPlacement anchor contract).
  const ranked = geo.numeral !== null
  const bottomMargin = Math.round(input.CH * 0.04)
  const providerGap = Math.round(geo.metaGap * 0.8)
  const rows = freshMetaRows(input.meta)
  // Per-family user offsets (neutral 0 = historic placement byte-identical).
  const mox = normFreshOffset(t?.metaOffsetX)
  const moy = normFreshOffset(t?.metaOffsetY)
  const pox = normFreshOffset(t?.providerOffsetX)
  const poy = normFreshOffset(t?.providerOffsetY)
  const lox = normFreshOffset(t?.logoOffsetX)
  const loy = normFreshOffset(t?.logoOffsetY)
  // Effective size caps: the caller bitmaps already carry the user scales
  // (single renderer), so the slots grow by the same % and ONE fit below
  // produces the larger mark — never a second resize (no double scaling).
  // Neutral 100 reproduces the historic caps exactly (slots are always
  // smaller than the canvas, so the canvas clamp is a no-op there).
  const provScaleEff = normFreshScale(t?.providerScale)
  const logoScaleEff = normFreshScale(t?.logoScale)
  const effProvMaxW = Math.max(1, Math.min(input.CW, Math.round((geo.providerMaxW * provScaleEff) / 100)))
  const effProvMaxH = Math.max(1, Math.min(input.CH, Math.round((geo.providerMaxH * provScaleEff) / 100)))
  const effTitleMaxW = Math.max(1, Math.min(input.CW, Math.round((geo.titleMaxW * logoScaleEff) / 100)))
  // Landscape title base (task9): the historic landscape logo bounds, scaled
  // by the same % — never a static cap (150/200 still grow to the canvas
  // limit). Portrait paths below never read these, so portrait bytes cannot
  // move. Both ranked-landscape and unranked-landscape size from here.
  const effLandscapeTitleMaxW = Math.max(
    1,
    Math.min(input.CW, Math.round((geo.landscapeTitleMaxW * logoScaleEff) / 100)),
  )
  const effLandscapeTitleMaxH = Math.max(
    1,
    Math.min(input.CH, Math.round((geo.landscapeTitleMaxH * logoScaleEff) / 100)),
  )
  const clampLayerX = (w: number, x: number): number =>
    Math.max(0, Math.min(Math.round(x), Math.max(0, input.CW - w)))
  const clampLayerY = (h: number, y: number): number =>
    Math.max(0, Math.min(Math.round(y), Math.max(0, input.CH - h)))
  if (!ranked) {
    // Unranked bottom composition: same meta rows and fit safeguards, new
    // anchor. The meta block grows upward from the shared bottom baseline;
    // the maxH shrink keeps the historic provider-slot reservation so the
    // meta bytes stay identical to task4 (the network now anchors above the
    // meta block in its own column, clamped inside the canvas). The
    // reservation follows the effective provider scale (neutral 100 =
    // historic value, byte-identical).
    const reservedBelow = (input.provider ? effProvMaxH + providerGap : 0) + bottomMargin
    const metaMaxH = Math.max(24, input.CH - reservedBelow - FRESH_BOTTOM_TOP_SAFE)
    const meta = await renderFreshMetaColumn(rows, geo, input.badgeFont ?? "inter", metaMaxH)
    // Landscape unranked shares the task9 landscape base slot (historic
    // bounds, composition otherwise untouched); portrait keeps `effTitleMaxW`
    // byte-identically.
    const unrankedTitleMaxW = geo.isPortrait ? effTitleMaxW : effLandscapeTitleMaxW
    const unrankedTitleMaxH = geo.isPortrait ? input.CH : effLandscapeTitleMaxH
    const logoBox = input.logo ? await fitFreshTitleLogo(input.logo, unrankedTitleMaxW, unrankedTitleMaxH) : null
    const providerBox = input.provider
      ? await fitFreshProviderLogo(input.provider, effProvMaxW, effProvMaxH)
      : null
    const place = freshUnrankedPlacement(
      geo,
      {
        logoW: logoBox?.w ?? 0,
        logoH: logoBox?.h ?? 0,
        metaW: meta?.w ?? 0,
        metaH: meta?.h ?? 0,
        providerW: providerBox?.w ?? 0,
        providerH: providerBox?.h ?? 0,
      },
      { hasLogo: logoBox !== null, hasMeta: meta !== null, hasProvider: providerBox !== null },
      t,
    )
    if (meta) layers.push({ input: meta.png, top: place.metaTop, left: place.metaLeft })
    if (providerBox) layers.push({ input: providerBox.png, top: place.providerTop, left: place.providerLeft })
    if (logoBox) layers.push({ input: logoBox.png, top: place.logoTop, left: place.logoLeft })
    return layers
  }
  // Reserved height below the meta block: provider slot (when a provider
  // mark is composed, following the effective provider scale — neutral 100
  // = historic value) + bottom margin. The column shrinks into the rest.
  const reservedBelow = (input.provider ? effProvMaxH + providerGap : 0) + bottomMargin
  const metaMaxH = Math.max(24, input.CH - Math.round(geo.metaTop) - reservedBelow)
  const meta = await renderFreshMetaColumn(rows, geo, input.badgeFont ?? "inter", metaMaxH)
  let columnBottom = Math.round(geo.metaTop)
  if (meta) {
    // Center the text block on the column (zone center, like the numeral).
    const centerX = Math.round(geo.zoneW / 2)
    const left = clampLayerX(meta.w, Math.round(centerX - meta.w / 2) + mox)
    // Clamped fully inside the canvas: when the block fits, even a +2000
    // offset lands at CH - h (fully visible), never hanging off the bottom
    // edge by 1px. Only a block taller than the whole canvas still crops
    // (clamped to 0 — intentional oversize, same as every other layer).
    // The maxH shrink above already sizes the block into metaMaxH, so the
    // default anchor below the numeral is unchanged.
    const top = clampLayerY(meta.h, Math.round(geo.metaTop) + moy)
    layers.push({ input: meta.png, top, left })
    columnBottom = top + meta.h
  }
  if (input.provider) {
    const fitted = await fitFreshProviderLogo(input.provider, effProvMaxW, effProvMaxH)
    if (isFreshFixedProvider(t)) {
      // Absolute-positioning contract: verbatim coords, clamped in canvas —
      // no auto anchor, no offsets, no gap (same as the standard layout).
      layers.push({
        input: fitted.png,
        top: clampLayerY(fitted.h, t?.providerFixedY as number),
        left: clampLayerX(fitted.w, t?.providerFixedX as number),
      })
    } else {
      const centerX = Math.round(geo.zoneW / 2)
      const left = clampLayerX(fitted.w, Math.round(centerX - fitted.w / 2) + pox)
      const top = clampLayerY(
        fitted.h,
        Math.min(columnBottom + providerGap, Math.max(0, input.CH - fitted.h - bottomMargin)) + poy,
      )
      layers.push({ input: fitted.png, top, left })
    }
  }
  if (input.logo) {
    // Ranked portrait (task8a2, user-approved): the title logo is centered
    // (`(CW - w) / 2`, plus the single user X offset) on the bottom anchor
    // with its own full-width cap (~5.5% side margins) and a bottom-band
    // height cap for tall marks. 100 is the scale-control base (percent of
    // the cap chain, never 100% of the canvas); 150/200 enlarge the caps by
    // the same % until the genuine canvas limit. Ranked LANDSCAPE keeps the
    // historic bottom-right anchor (same anchor/offsets, applied once) with
    // the task9 landscape base slot (historic 40% CW / 24% CH bounds, scaled
    // by the same %); every unranked shape and Standard are untouched above.
    if (geo.isPortrait) {
      const effRankedMaxW = Math.max(1, Math.min(input.CW, Math.round((geo.rankedTitleMaxW * logoScaleEff) / 100)))
      const effRankedMaxH = Math.max(1, Math.min(input.CH, Math.round((geo.rankedTitleMaxH * logoScaleEff) / 100)))
      const fitted = await fitFreshTitleLogo(input.logo, effRankedMaxW, effRankedMaxH)
      // The bitmap already carries the user scale (logoResult, sized by the
      // single renderer) and the caps above already carry it too: this fit
      // is the single sizing step (no double scaling, no double offset).
      // Only the offsets apply here, once.
      layers.push({
        input: fitted.png,
        top: clampLayerY(fitted.h, input.CH - fitted.h - geo.titleBottom + loy),
        left: clampLayerX(fitted.w, Math.round((input.CW - fitted.w) / 2) + lox),
      })
      return layers
    }
    const fitted = await fitFreshTitleLogo(input.logo, effLandscapeTitleMaxW, effLandscapeTitleMaxH)
    // The bitmap already carries the user scale (logoResult, sized by the
    // single renderer) and the cap above already carries it too: this fit
    // is the single sizing step (no double scaling, no double offset).
    // Only the offsets apply here, once, relative to the
    // fresh bottom-right anchor (the standard anchor is discarded with its
    // baked offsets — no double offset).
    layers.push({
      input: fitted.png,
      top: clampLayerY(fitted.h, input.CH - fitted.h - geo.titleBottom + loy),
      left: clampLayerX(fitted.w, input.CW - fitted.w - geo.titleRight + lox),
    })
  }
  return layers
}
