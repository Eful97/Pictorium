/**
 * Shared Card-composition geometry for the cover layouts
 * ("provider-glass", "nuvio", "stremio"), portrait + landscape.
 *
 * Pure shape-specific helpers with no Sharp/network/service integration and
 * no skin rendering yet: scales the classic Card reference composition (rank
 * left, rounded artwork card right) to a passed canvas. One composition for
 * all three skins, so no skin parameter and no new layout query param.
 *
 * Reference: classic cover.js LAYOUTS + numberSvg (rank behind the card by
 * design). Title-logo box (P14: bottom-CENTERED, ~75% of the card width so a
 * user-sized wordmark reads large, height bounded to the lower zone) and the
 * provider slot below mirror the reference's reserved slots.
 *
 * Rank contract: Card accepts integer ranks 1..20 ONLY (user requirement).
 * This intentionally diverges from Fresh (`FRESH_RANK_MAX = 100`): Fresh
 * keeps 100, Card stops at 20. No rank is ever invented: absent/invalid
 * yields `numeral: null` with card/meta/provider/titleLogo unchanged.
 *
 * Visibility (P9 user requirement, reference cover.js `numberSvg`, P16
 * correction cycle 1 enlarged `CARD_NUMERAL_ENLARGE` for every rank EXCEPT
 * 1): rank 1 keeps the verbatim reference single size/anchor/baseline
 * (historical geometry — the natural overlap behind the card, if the real
 * ink reaches the card edge, is the classic design, see `classic-poster.png`
 * rank 2 / `provider-poster.png` rank 4) at the UN-enlarged size. Singles
 * 2..9 AND doubles keep the reference anchor/baseline at the enlarged size.
 * Doubles (10..20) additionally condense HORIZONTALLY
 * (`CARD_NUMERAL_CONDENSE_X`): the reference renders doubles uncondensed at
 * the full double size, which would hide most of the second digit behind
 * the card (measured: uncondensed "10" ink is 388px wide from x=-10 vs
 * card.x=210 — 168px occluded). The condensation keeps the reference HEIGHT
 * (no uniform shrink) while both digits stay recognizable. The final
 * renderer re-fits from real font metrics; these flags are pre-layout
 * guards. No forced tuck: the numeral is NEVER shifted right to induce an
 * overlap (user correction "numbers behind the poster NOT mandatory, only
 * if they exceed certain proportions — 1 was fine as before").
 */

import type { PosterShape } from "./types"
import { CHAR_WIDTH_FACTOR } from "./constants"

/** Cover layouts sharing this single Card composition (no new query params). */
export const CARD_COVER_LAYOUTS = ["provider-glass", "nuvio", "stremio"] as const
export type CardCoverLayout = (typeof CARD_COVER_LAYOUTS)[number]

/** Card rank bounds: integers 1..20 only (user requirement, not Fresh's 100). */
export const CARD_RANK_MIN = 1
export const CARD_RANK_MAX = 20

/**
 * Horizontal glyph condensation for double-digit Card numerals (P9).
 * Doubles keep the verbatim reference double size/anchor/baseline; only the
 * width condenses (same `transform="scale(<cx> 1)"` pattern as the Fresh
 * numeral, which this module does NOT import — Card stays self-contained).
 * 0.6 keeps every rank 10..20 recognizable at every tested canvas: the first
 * digit's condensed advance stays fully before the card edge while the
 * second digit keeps a visible majority (measured real ink, see
 * `card-layout.ts`). Never a uniform font shrink (the old gutter-fit shrank
 * portrait doubles 168px -> ~91px, the reported "tiny 11").
 */
export const CARD_NUMERAL_CONDENSE_X = 0.6

/**
 * Enlargement factor for the Card rank numeral (P16 user requirement
 * "numbers bigger": LARGE height, both formats; correction cycle 1: every
 * rank EXCEPT 1 — rank 1 keeps the exact pre-P16 reference size per the
 * user "1 was fine as before").
 *
 * The verbatim reference sizes (`sizeSingle` for 2..9, `sizeDouble` for
 * 10..20) grow by 18% — the midpoint of the requested 15-20% band
 * (measured: shipped core-ink height ratio vs the P9 baseline lands at
 * ~1.18 on every enlarged rank/shape). Anchors, letter-spacing, baseline
 * formula and horizontal condensation stay verbatim: only the size (and its
 * proportional stroke, below) scales, so the classic behind-the-card
 * composition is preserved, just larger. Doubles keep
 * `CARD_NUMERAL_CONDENSE_X` on top of the enlarged size. Rank 1 uses factor
 * 1 (verbatim reference size AND stroke, original anchor and baseline
 * formula with its own size).
 */
export const CARD_NUMERAL_ENLARGE = 1.18

/** Whether a rank may draw the Card numeral: integer 1..20, never invented. */
export function isCardRankDisplayable(rank: unknown): rank is number {
  return (
    typeof rank === "number" &&
    Number.isInteger(rank) &&
    rank >= CARD_RANK_MIN &&
    rank <= CARD_RANK_MAX
  )
}

export interface CardCanvas {
  width: number
  height: number
}

export interface CardRect {
  x: number
  y: number
  width: number
  height: number
  radius: number
}

export interface CardRankNumeral {
  /** Reference text anchor X scaled (digits run right from here). */
  anchorX: number
  /** Reference baseline Y scaled (card center + size * 0.34 + drop). */
  baselineY: number
  /**
   * Reference size for rank 1 (verbatim reference, NEVER enlarged) and for
   * every other rank the reference size times the P16 user enlargement
   * (2..9: sizeSingle, 10..20: sizeDouble — never a gutter-fit shrink).
   */
  fontSize: number
  /** Scaled reference letter-spacing (negative: condensed). */
  letterSpacing: number
  /** Scaled reference stroke width (doubles: uniform ring radius source). */
  strokeWidth: number
  /**
   * Horizontal condensation applied by the renderer (`1` singles verbatim,
   * `CARD_NUMERAL_CONDENSE_X` doubles). Height is never condensed.
   */
  condenseX: number
  /** Digit count of the displayed rank. */
  digitCount: 1 | 2
  /** Estimated advance width (CHAR_WIDTH_FACTOR heuristic, not ink proof). */
  estimatedWidth: number
  /** Estimated ink box inside the canvas (heuristic, not measured ink). */
  fitsWithinCanvas: boolean
  /** Visible gutter from the anchor to the card's left edge. */
  visibleAvailableWidth: number
  /** Estimated px of ink crossing the card edge (0 when fully before it). */
  estimatedOverflowIntoCard: number
  /**
   * Estimate-level only: true when no ink crosses the card edge. Singles
   * keep the historical overlap (false by design, like the reference);
   * wide doubles condense but may still cross it slightly (also by design:
   * the card is composited AFTER the numeral, so crossed ink hides behind
   * the artwork instead of spilling over it).
   */
  fullyVisibleBeforeCard: boolean
  /** True for ranks 1..9 (verbatim reference anchor, no condensation; rank 1
   * additionally keeps the verbatim reference SIZE — the only un-enlarged rank). */
  referenceFaithful: boolean
}

export interface CardMetaSlot {
  /** Card horizontal center (metadata is centered under the card). */
  centerX: number
  /** Baseline below the card bottom. */
  baselineY: number
  /** Scaled gap between card bottom and baseline. */
  gapBelowCard: number
}

export interface CardProviderSlot {
  /** Left-gutter center (card.x / 2). */
  centerX: number
  /** Scaled provider center Y (bottom band, under the rank). */
  centerY: number
  /** Scaled max logo box. */
  maxWidth: number
  maxHeight: number
}

export interface CardTitleLogoSlot {
  /** Top-left X of the reserved max box (P14: horizontally centered in the card). */
  x: number
  /** Top-left Y (bottom-anchored inside the card). */
  y: number
  /** Scaled max title-logo box. */
  maxWidth: number
  maxHeight: number
  /** Scaled side pad from centering / bottom pad from the card's bottom edge. */
  insetLeft: number
  insetBottom: number
}

export interface CardCompositionGeometry {
  shape: PosterShape
  canvas: CardCanvas
  /** Scaled rounded-artwork card (right). */
  card: CardRect
  /** Gutter width left of the card (the rank column). */
  rankSlotWidth: number
  /** Null when the rank is absent/invalid — never a phantom numeral. */
  numeral: CardRankNumeral | null
  /** Metadata slot below the card. */
  meta: CardMetaSlot
  /** Provider slot under the rank (left gutter, bottom band). */
  provider: CardProviderSlot
  /** Reserved title-logo max box inside the card bottom-left. */
  titleLogo: CardTitleLogoSlot
}

interface CardReference {
  canvas: { width: number; height: number }
  card: { x: number; y: number; width: number; height: number; radius: number }
  number: {
    xSingle: number
    xDouble: number
    sizeSingle: number
    sizeDouble: number
    opticalDrop: number
    letterSpacing: number
    strokeWidth: number
  }
  logo: { maxWidth: number; maxHeight: number; left: number; bottom: number }
  metaBaselineY: number
  provider: { centerX: number; centerY: number; maxWidth: number; maxHeight: number }
}

/** Verbatim reference values from cover.js LAYOUTS + numberSvg.
 *
 * P14 title/provider enlargement (user requirement "LARGER"): the title max
 * box grows from ~48% to 75% of the card width (midpoint of the requested
 * 70-80% band, aspect preserved) with the height bounded to the lower zone
 * (portrait 20% of the card height, landscape 40% — the 16:9 card is shallow
 * so the same absolute feel needs a larger share; both keep the mark in the
 * bottom band, never invading the upper two thirds). The horizontal inset is
 * the centering side pad (`(cardW - maxW) / 2`); the bottom inset keeps the
 * reference visual padding (42/40). The provider slot grows to the usable
 * gutter (portrait 196 = gutter 210 minus 7px/side, height 120 staying clear
 * of the numeral ink above and inside the canvas below; landscape 260/100
 * with the same margins/meaning) so the mark renders visibly larger while
 * `pRight <= card.x` still holds.
 */
export const CARD_REFERENCE: Record<PosterShape, CardReference> = {
  poster: {
    canvas: { width: 1000, height: 1500 },
    card: { x: 210, y: 165, width: 730, height: 1095, radius: 38 },
    number: {
      xSingle: 14,
      xDouble: -10,
      sizeSingle: 405,
      sizeDouble: 335,
      opticalDrop: 22,
      letterSpacing: -16,
      strokeWidth: 10,
    },
    logo: { maxWidth: 548, maxHeight: 219, left: 91, bottom: 42 },
    metaBaselineY: 1385,
    provider: { centerX: 105, centerY: 1380, maxWidth: 196, maxHeight: 120 },
  },
  landscape: {
    canvas: { width: 1280, height: 720 },
    card: { x: 300, y: 107, width: 900, height: 506, radius: 30 },
    number: {
      xSingle: 62,
      xDouble: 24,
      sizeSingle: 450,
      sizeDouble: 370,
      opticalDrop: 8,
      letterSpacing: -16,
      strokeWidth: 11,
    },
    logo: { maxWidth: 675, maxHeight: 202, left: 113, bottom: 40 },
    metaBaselineY: 672,
    provider: { centerX: 150, centerY: 620, maxWidth: 260, maxHeight: 100 },
  },
}

/** Typical digit left-side-bearing share (ink inset for the canvas check). */
const DIGIT_SIDE_BEARING_SHARE = 0.08
/** Ink ascent / descent shares around the baseline (canvas check). */
const INK_ASCENT_SHARE = 0.75
const INK_DESCENT_SHARE = 0.25
/** Reference baseline factor from numberSvg (`fontSize * 0.34`). */
const NUMERAL_BASELINE_FACTOR = 0.34
/** Highest rank keeping the verbatim reference rendering (single digits). */
const REFERENCE_SINGLE_MAX = 9
/** Minimum usable px for any rect/slot dimension; below → null. */
const MIN_GEOMETRY_PX = 1

function isFinitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
}

/**
 * Scale the reference Card composition to an actual canvas. Per-axis
 * proportional scaling (uniform glyph/radius scale via min(sx, sy)). Returns
 * null for non-finite/non-positive canvases and for subpixel canvases whose
 * rounding collapses any card/slot/numeral dimension — never invented or
 * zero-size geometry. The rank only decides the numeral.
 */
export function cardLayoutGeometry(
  shape: PosterShape,
  canvasWidth: number,
  canvasHeight: number,
  rank?: number | null,
): CardCompositionGeometry | null {
  if (!isFinitePositive(canvasWidth) || !isFinitePositive(canvasHeight)) return null
  if (shape !== "poster" && shape !== "landscape") return null
  const ref = CARD_REFERENCE[shape]

  const sx = canvasWidth / ref.canvas.width
  const sy = canvasHeight / ref.canvas.height
  const s = Math.min(sx, sy)

  const card: CardRect = {
    x: Math.round(ref.card.x * sx),
    y: Math.round(ref.card.y * sy),
    width: Math.round(ref.card.width * sx),
    height: Math.round(ref.card.height * sy),
    radius: Math.round(ref.card.radius * s),
  }
  if (card.width < MIN_GEOMETRY_PX || card.height < MIN_GEOMETRY_PX || card.radius < MIN_GEOMETRY_PX) {
    return null
  }

  const cardCenterX = card.x + card.width / 2
  const cardCenterY = card.y + card.height / 2
  const cardBottom = card.y + card.height

  let numeral: CardRankNumeral | null = null
  if (isCardRankDisplayable(rank)) {
    const single = rank <= REFERENCE_SINGLE_MAX
    const digitCount: 1 | 2 = single ? 1 : 2
    const anchorX = Math.round((single ? ref.number.xSingle : ref.number.xDouble) * sx)
    const letterSpacing = Math.round(ref.number.letterSpacing * s)
    const visibleAvailableWidth = card.x - anchorX

    // P16 correction cycle 1: rank 1 keeps the EXACT pre-P16 reference
    // geometry (verbatim size AND stroke, original anchor, baseline formula
    // with its own size — user "1 was fine as before"). Every other rank
    // renders the reference size TIMES the user enlargement (singles 2..9
    // sizeSingle, doubles sizeDouble — never a gutter-fit shrink).
    // Doubles condense horizontally (condenseX) at the full enlarged height.
    // No forced tuck anywhere: overlap behind the card happens ONLY when
    // the natural ink reaches the card edge (layer order hides it there).
    const enlarge = rank === 1 ? 1 : CARD_NUMERAL_ENLARGE
    // P16: the stroke scales with the glyph (same visual weight at the
    // larger size; doubles derive their uniform ring radius from it).
    // Rank 1 keeps the verbatim reference stroke.
    const strokeWidth = Math.max(1, Math.round(ref.number.strokeWidth * s * enlarge))
    const fontSize = Math.round((single ? ref.number.sizeSingle : ref.number.sizeDouble) * s * enlarge)
    if (fontSize < MIN_GEOMETRY_PX) return null
    const condenseX = single ? 1 : CARD_NUMERAL_CONDENSE_X

    const baselineY = Math.round(cardCenterY + fontSize * NUMERAL_BASELINE_FACTOR + ref.number.opticalDrop * sy)
    const rawAdvance = digitCount * CHAR_WIDTH_FACTOR * fontSize + (digitCount - 1) * letterSpacing
    const estimatedWidth = condenseX * rawAdvance
    const inkLeft = anchorX + DIGIT_SIDE_BEARING_SHARE * fontSize * condenseX
    const inkRight = anchorX + estimatedWidth + strokeWidth
    const inkTop = baselineY - INK_ASCENT_SHARE * fontSize
    const inkBottom = baselineY + INK_DESCENT_SHARE * fontSize
    const estimatedOverflowIntoCard = Math.max(0, inkRight - card.x)
    numeral = {
      anchorX,
      baselineY,
      fontSize,
      letterSpacing,
      strokeWidth,
      condenseX,
      digitCount,
      estimatedWidth,
      fitsWithinCanvas: inkLeft >= 0 && inkRight <= canvasWidth && inkTop >= 0 && inkBottom <= canvasHeight,
      visibleAvailableWidth,
      estimatedOverflowIntoCard,
      fullyVisibleBeforeCard: estimatedOverflowIntoCard <= 0,
      referenceFaithful: single,
    }
  }

  const gapBelowCard = Math.round((ref.metaBaselineY - (ref.card.y + ref.card.height)) * sy)
  const meta: CardMetaSlot = {
    centerX: Math.round(cardCenterX),
    baselineY: cardBottom + gapBelowCard,
    gapBelowCard,
  }

  const provider: CardProviderSlot = {
    centerX: Math.round(card.x / 2),
    centerY: Math.round(ref.provider.centerY * sy),
    maxWidth: Math.round(ref.provider.maxWidth * sx),
    maxHeight: Math.round(ref.provider.maxHeight * sy),
  }
  if (provider.maxWidth < MIN_GEOMETRY_PX || provider.maxHeight < MIN_GEOMETRY_PX) return null

  // P14: the title slot is horizontally CENTERED in the card (the side pad
  // derives from the centering, never from a stale left anchor), still
  // bottom-anchored with the reference visual bottom padding.
  const titleMaxWidth = Math.round(ref.logo.maxWidth * sx)
  const titleMaxHeight = Math.round(ref.logo.maxHeight * sy)
  if (titleMaxWidth < MIN_GEOMETRY_PX || titleMaxHeight < MIN_GEOMETRY_PX) return null
  const insetLeft = Math.round((card.width - titleMaxWidth) / 2)
  const insetBottom = Math.round(ref.logo.bottom * sy)
  const titleLogo: CardTitleLogoSlot = {
    x: card.x + insetLeft,
    y: cardBottom - insetBottom - titleMaxHeight,
    maxWidth: titleMaxWidth,
    maxHeight: titleMaxHeight,
    insetLeft,
    insetBottom,
  }

  return {
    shape,
    canvas: { width: canvasWidth, height: canvasHeight },
    card,
    rankSlotWidth: card.x,
    numeral,
    meta,
    provider,
    titleLogo,
  }
}
