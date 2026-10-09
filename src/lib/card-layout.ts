/**
 * Isolated shared Card compositor for the cover layouts ("provider-glass",
 * "nuvio", "stremio"), portrait + landscape.
 *
 * Serial-builder stage only: no endpoint, no network, no base-art fetch, no
 * provider lookup, no new data sources. The caller (later: the existing
 * single poster-service renderer) resolves every bitmap upstream and passes
 * already-resolved buffers in:
 * - `artwork`: base artwork bytes (any Sharp-readable format);
 * - `titleLogo` / `providerLogo`: optional ORIGINAL already-resolved logo
 *   bitmaps (missing/null = omitted, never an error) plus the existing
 *   user scales (`logoScale` title %, `providerScale` network % — no new
 *   params): the compositor fits each ONCE into its enlarged slot
 *   (title shrink-only from the original, provider bounded upscale), so the
 *   scales resize the slots and every level renders a different size;
 * - `displayedRank`: already rankingEnabled-gated upstream (null/absent =
 *   unranked, never an invented numeral; 21+ draws no numeral);
 * - metadata as resolved values (`genreName`/`year`/`ratings`) or as a
 *   pre-rendered `metadataOverlay` bitmap (buffer wins when both given).
 *
 * Composition (single, shared by all three skins; no new layout params):
 * skin background (P3) -> rank numeral left (behind the card, faithful to
 * the classic cover.js reference where the rank sits behind the artwork
 * card) -> rounded artwork card right (cover-fit + mask, P2 geometry) with
 * drop shadow -> title logo (P14: large, bottom-CENTERED on its real ink,
 * user scale via the slot caps) inside the card ->
 * provider mark below the rank -> metadata block below the card.
 *
 * Ratings: the SELECTED available providers collapse to ONE aggregate score
 * (P8 user requirement): the equal arithmetic mean of the valid selected
 * values normalized to /10, rounded ONLY at display to one decimal
 * (`GENRE • ★ 8.3`, reference cover-generator.js + provider-poster.png).
 * Up to the existing shared cap (`MAX_SEPARATE_RATINGS` = 5, same as the
 * separate column). There is deliberately NO cap-3 assumption here (the
 * product cap is being expanded 3 -> 5 elsewhere); values are never silently
 * truncated below the shared cap.
 *
 * Metadata band (P4 fix, P8 aggregate): the single inline line
 * (`GENRE • ★ 8.3`, plus the optional separate year line) at the base font
 * always fits the strip below the card, so the old 7-row worst case (genre +
 * 5 ratings + year) is gone by construction. The block is still laid out
 * inside the bounded below-card band (top = card bottom + pad, bottom =
 * canvas - margin, left = provider footprint right + gap, right = canvas -
 * margin) as a compact multi-column grid (fewest columns that fits, largest
 * legible font, floor 11px — never a microscopic shrink, never a silent
 * clip). The pre-rendered overlay uses the SAME band with contain scaling on
 * BOTH axes. Missing/invalid metadata (null, empty, garbage bytes, unreadable
 * bitmap) is omitted without error, per the declared degrade contract.
 *
 * Numeral fitting is MEASURED, not estimated: the numeral SVG is rasterized
 * with the deterministic local resvg font database (`renderSVG` +
 * `FONT_FILES`, Inter Black — no new font downloads) and its real alpha ink
 * bounds decide the fit. Singles AND doubles share ONE union-contour
 * outline pipeline (P18): an exact Euclidean ring (signed distance
 * transform of the rasterized filled-glyph union, band `±strokeWidth/2`
 * around the union edge with a 1px antialiased ramp) filled with the
 * per-skin reference gradient and hollow by construction. The old
 * singles path stroked the `<text>` directly, but resvg strokes every font
 * subpath separately and the Inter "4" contours overlap inside the glyph —
 * the separate subpath strokes painted spurious inner segments (measured,
 * see the P16 numeral tests); the union ring cannot, while counters stay
 * hollow. The P16 ring derived the contour with an SVG `feMorphology`
 * dilation (square kernel, outer half only): measured HALF the reference
 * stroke weight (outer band only, ~3px at sw=6 vs ~7px stroked), and the
 * symmetric dilate/erode variant tried in P17 inflated diagonals
 * (square-kernel Chebyshev inflation ~sqrt2: 113 rogue px inside the 4).
 * The P18 ring is computed from the rasterized union alpha with an exact
 * Euclidean distance transform instead (isotropic by construction — no SVG
 * square kernel anywhere): the full centered `strokeWidth` band is
 * restored at the reference weight while the 4 stays clean. Singles render at their geometry size (rank 1 verbatim reference,
 * 2..9 enlarged `CARD_NUMERAL_ENLARGE`) from the historical gutter anchor
 * (natural overlap behind the card happens only when the real ink reaches
 * the card edge — the classic cover.js design; never a forced shift). Doubles (P9) keep the enlarged reference double
 * size/anchor/baseline and condense ONLY horizontally
 * (`CARD_NUMERAL_CONDENSE_X` via `transform="scale(<cx> 1)"` on the shared
 * text source, x origin pre-compensated — the same condensation pattern as
 * the Fresh numeral, reimplemented here without touching Fresh): the height
 * stays dominant while both digits remain recognizable. The condensed
 * outline is an exact Euclidean ring (signed distance band around the
 * post-transform union silhouette, computed from the rasterized glyph
 * mask) rather than a stroked `<text>`: resvg ignores
 * `vector-effect="non-scaling-stroke"` (measured byte-identical with/without
 * it), so a transformed text stroke would thin anisotropically, while the
 * post-transform distance band is uniform by construction at the full
 * reference stroke weight. The fit decides on the STRONG ink mask
 * (alpha threshold 24, which covers the outline ring plus the bright
 * neon/rim glow fringe: any final-poster strong pixel necessarily carries
 * layer alpha > 24) so no shipped strong ink clips or touches a boundary;
 * the core mask (threshold 80) additionally proves two ordered digit masses
 * with the first digit fully before the card edge and the second digit
 * majoritarily visible — a measured shift (never a shrink) lands the fit in
 * at most 2 rasterizations. An un-fittable size at the floor is omitted,
 * never drawn clipped and never auto-accepted (`fs <= 8` accept removed).
 *
 * Image validation is by DECODING, not by byte length: a 1x1 valid PNG is
 * 91 bytes and must render (old `< 100` length gate wrongly rejected it).
 * Artwork must decode with positive dimensions (else throw); logos and the
 * overlay must decode (else omitted, never a 500).
 *
 * Reference note: the classic `numberSvg` source lives OUTSIDE this repo
 * (absolute `cover.js`, `numberSvg` lines ~611..779, read directly during
 * this fix). The rank there is a HOLLOW outlined glass numeral: `fill="none"`,
 * `font-weight="800"`, `letter-spacing="-16"`, stroked with a vertical glass
 * gradient (`crystalGlassStroke` on provider/brand canvas, `strokeGrad`
 * otherwise), `stroke-width` 10 (poster) / 11 (landscape),
 * `stroke-linejoin="round"`, `paint-order="stroke"`, under `numFilter`.
 * The shipped numeral below is that hollow outline (transparent digit
 * centers, outline only) using the verbatim reference gradient stops and
 * letter-spacing semantics with the P16-enlarged size and proportional
 * stroke. Deliberate bounded adaptation (NOT
 * verbatim): the reference `numFilter` uses heavyweight unbounded blurs
 * (`feGaussianBlur` stdDeviation 30/11 over a 340% region) which this offline
 * stage must not copy (perf discipline, and the stage's offline contract
 * forbids `feGaussianBlur`); the glow/rim is approximated with bounded
 * `feDropShadow` primitives at the reference opacities, with radii/offsets
 * scaled to the numeral size (the reference only renders these filters at
 * 335..450px fonts, where sigma 12 is a thin rim). A prior
 * header revision wrongly claimed no external reference existed and shipped a
 * filled metallic numeral as "matching" — that claim was incorrect and the
 * fill has been removed.
 *
 * Cost discipline (perf skill): no `.blur()` of artwork bitmaps, no
 * full-frame loops, no upscaling. The only filter is a bounded SVG
 * `feDropShadow` on the small numeral/card layers (resvg-side, no PNG
 * roundtrip of artwork). The numeral ring mask is a glyph-size-only raw
 * PNG (white + ring alpha, embedded as a data URL inside the small
 * numeral SVG — never a whole-artwork roundtrip, never a bitmap blur);
 * the contour itself is pure arithmetic (exact Euclidean distance
 * transform, two linear passes over glyph pixels — never O(n*r^2),
 * never full-frame loops). No new dependencies: sharp + the existing
 * shared SVG/text utilities only.
 */

import sharp from "sharp"
import type { PosterShape } from "./types"
import {
  cardLayoutGeometry,
  isCardRankDisplayable,
} from "./card-layout-geometry"
import {
  cardSkinBackgroundSvg,
  isCardSkin,
  resolveCardSkinAccent,
  STREMIO_CARD_SKIN_PALETTE,
  type CardSkin,
} from "./card-layout-skins"
import { renderSVG } from "./svg-badge"
import {
  escSvg,
  estimateTextWidth,
  fontFamilyFor,
} from "./badge-svg-shared"
import {
  MAX_SEPARATE_RATINGS,
} from "./ratings"

/** One resolved rating value (already validated upstream, no fetching here). */
export interface CardRatingValue {
  readonly id: string
  readonly value: number
  /**
   * Scale hint from the provider contract (`RatingItem.format`):
   * `"percent"` = 0-100 scale (normalized to /10 here);
   * `"decimal"` (or absent = MDBList separate values and the ordinary
   * average, already normalized to /10 at fetch) = used as-is.
   * Any other value fails closed (excluded, never guessed).
   */
  readonly format?: string | null
}

/**
 * Compositor input. Every buffer is already resolved by the caller; this
 * module performs no I/O besides rasterizing its own small SVG layers.
 */
export interface CardLayoutInput {
  readonly skin: CardSkin
  readonly shape: PosterShape
  readonly width: number
  readonly height: number
  /** Base artwork bytes (any Sharp-readable format). */
  readonly artwork: Buffer
  /** Already rankingEnabled-gated upstream; null/absent = unranked. */
  readonly displayedRank?: number | null
  /**
   * Optional already-resolved title-logo bitmap (null/absent = omitted).
   *
   * P14: this is the ORIGINAL resolved buffer (never a pre-downscaled
   * Standard-layout bitmap): the compositor fits it into the enlarged
   * bottom-center slot below with the single sizing step, so the mark renders
   * large instead of inheriting the small Standard size.
   */
  readonly titleLogo?: Buffer | null
  /** Optional already-resolved provider/network bitmap (null = omitted). */
  readonly providerLogo?: Buffer | null
  /**
   * Existing title scale control (`scale`, %; the same value the Standard
   * path sizes the base bitmap with). Null/absent = neutral 100 = base slot
   * (same convention as Fresh: auto renders like explicit 100,
   * byte-identical — the aspect auto curve would shrink the enlarged slot
   * back below the baseline). The % enlarges/shrinks the title slot caps;
   * one fit below then sizes the mark linearly, so every scale level renders
   * a different size instead of collapsing onto one permanent cap. No new
   * query param.
   */
  readonly logoScale?: number | null
  /**
   * Existing network scale control (`netscale`, %; stored values preserved,
   * neutral 100 = base slot). Enlarges the provider slot caps; one fit below
   * then sizes the mark linearly. No new query param.
   */
  readonly providerScale?: number | null
  /** Already-resolved brand accent (P3 sanitizes; invalid -> neutral). */
  readonly brandAccent?: unknown
  readonly genreName?: string | null
  readonly year?: string | null
  /**
   * Resolved rating values. All valid entries are preserved up to the
   * shared `MAX_SEPARATE_RATINGS` cap — never truncated at 3.
   */
  readonly ratings?: readonly CardRatingValue[] | null
  /**
   * Pre-rendered metadata bitmap alternative. When present it is composited
   * into the meta slot (shrink-to-fit, centered); otherwise the metadata is
   * rendered from the resolved values above.
   */
  readonly metadataOverlay?: { png: Buffer; w: number; h: number } | null
}

/** Display line for the metadata block (plain text, escaped at render). */
export interface CardMetadataLine {
  readonly kind: "genre" | "rating" | "year"
  readonly text: string
}

/** Gold star fill for the Card aggregate (verbatim reference cover-generator.js). */
export const CARD_META_STAR_FILL = "#FFB800"

/**
 * Normalize ONE selected Card rating to the /10 display scale, or null when
 * the input must not contribute to the aggregate (fail-closed, never guessed).
 *
 * Evidence (no assumptions about "all /10"):
 * - MDBList separate values arrive ALREADY normalized to /10 at fetch
 *   (`ratings.ts` fetchMdbListSources: `> 10 → /10`, letterboxd ≤ 5 `* 2`,
 *   rogerebert ≤ 4 `* 2.5`) and the ordinary average (`computeVote`) means
 *   those same /10 values — so absent/`decimal` format is used as-is.
 * - Custom provider percent values are 0-100 (`custom-rating.test.ts`: 87 +
 *   "percent" → `"87%"`, "formats without changing the scale"; docs example)
 *   — so `"percent"` format is `/ 10`.
 * - Any other format string is an unknown scale: excluded (fail-closed),
 *   never blindly treated as /10.
 * - Zero/negative/non-finite never contribute, per the existing averaging
 *   contracts (`calculateAverageRating`/`equalAverage` require finite `> 0`;
 *   `pickSeparateRatings` requires finite `> 0`).
 * - Known scales are BOUNDED (helper input contract, excluded never clamped):
 *   decimal/absent must satisfy `0 < value <= 10`, percent `0 < value <= 100`
 *   (so a stray `99`, `10.5` or `120%` never becomes a `9.9`/`12.0` display).
 */
export function normalizeCardRatingToTen(input: {
  readonly value: unknown
  readonly format?: string | null
}): number | null {
  const { value, format } = input
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  if (format === undefined || format === null || format === "decimal") {
    return value > 0 && value <= 10 ? value : null
  }
  if (format === "percent") {
    if (!(value > 0 && value <= 100)) return null
    const ten = value / 10
    return ten > 0 && ten <= 10 && Number.isFinite(ten) ? ten : null
  }
  return null
}

/**
 * ONE aggregate Card score: the EQUAL arithmetic mean of the selected
 * available providers, each normalized to /10 (see
 * `normalizeCardRatingToTen`). No extra fetch, no new sources.
 *
 * - Selected available only: the caller passes the already-selected stack
 *   (custom XOR separate XOR the ordinary-average fallback — the service
 *   Card branch); unselected providers are never averaged in, votes are
 *   never counted twice here.
 * - Duplicate provider ids (same source via several paths) count ONCE
 *   (case-insensitive id, first VALID occurrence wins — invalid entries
 *   never claim the slot) — the mean is order independent for distinct
 *   sources.
 * - Shared `MAX_SEPARATE_RATINGS` (= 5) cap preserved: at most 5 valid
 *   values contribute.
 * - Missing/invalid (null, NaN, Infinity, ≤ 0, unknown scale) excluded.
 * - NO rounding here: rounding happens ONLY at display (one decimal);
 *   null when no valid input (no score, never an invented 0).
 */
export function aggregateCardRating(
  ratings: readonly CardRatingValue[] | null | undefined,
): number | null {
  if (!ratings || ratings.length === 0) return null
  const seen = new Set<string>()
  const values: number[] = []
  for (const r of ratings) {
    if (values.length >= MAX_SEPARATE_RATINGS) break
    if (!r || typeof r.id !== "string" || r.id.trim() === "") continue
    const key = r.id.trim().toLowerCase()
    if (seen.has(key)) continue
    const ten = normalizeCardRatingToTen({ value: r.value, format: r.format })
    if (ten === null) continue
    seen.add(key)
    values.push(ten)
  }
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Pure metadata lines from resolved values: ONE inline line
 * (`GENRE • ★ 8.3`) plus the optional separate year line — never source
 * names, never multiple rating rows (P8 user requirement, reference
 * provider-poster.png / classic-poster.png).
 *
 * - The rating segment is the `aggregateCardRating` mean rounded ONLY at
 *   display to one decimal; absent when no valid input (no invented score).
 * - Genre/rating toggles are respected upstream (the service passes null for
 *   a hidden component); here a present genre and/or a valid aggregate each
 *   render, with the `•` separator only between two visible segments (never
 *   a dangling separator, same conditional-dx contract as the genre badge).
 * - Year keeps its existing separate compact line and never interferes with
 *   the main rating. Hostile text is kept verbatim here (escaped at SVG
 *   render).
 */
export function cardMetadataLines(input: {
  readonly genreName?: string | null
  readonly year?: string | null
  readonly ratings?: readonly CardRatingValue[] | null
}): CardMetadataLine[] {
  const lines: CardMetadataLine[] = []
  const genre =
    typeof input.genreName === "string" && input.genreName.trim() !== ""
      ? input.genreName.trim().toUpperCase()
      : null
  const aggregate = aggregateCardRating(input.ratings)
  const score = aggregate === null ? null : (Math.round(aggregate * 10) / 10).toFixed(1)
  if (genre !== null && score !== null) {
    lines.push({ kind: "rating", text: `${genre} \u2022 \u2605 ${score}` })
  } else if (genre !== null) {
    lines.push({ kind: "genre", text: genre })
  } else if (score !== null) {
    lines.push({ kind: "rating", text: `\u2605 ${score}` })
  }
  if (typeof input.year === "string" && input.year.trim() !== "") {
    lines.push({ kind: "year", text: input.year.trim() })
  }
  return lines
}

/** Base metadata font size from the canvas width (deterministic). */
export function cardMetadataFontSize(canvasWidth: number): number {
  return Math.max(11, Math.min(28, Math.round(canvasWidth / 24)))
}

/** Bounded below-card band available to the metadata block. */
export interface CardMetadataBand {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
  readonly w: number
  readonly h: number
}

const META_MARGIN = 8
const META_TOP_PAD = 6
const META_PROVIDER_GAP = 8
/** Floor for the metadata grid: legible, never microscopic. */
export const CARD_META_MIN_FONT = 11

/**
 * Below-card band for the metadata block, derived from the P2 geometry:
 * vertically card bottom + pad .. canvas - margin (never onto the card),
 * horizontally provider max-footprint right + gap .. canvas - margin (never
 * under the provider slot). Null when the band collapses (caller omits the
 * block without error).
 */
export function cardMetadataBand(
  CW: number,
  CH: number,
  geo: {
    readonly card: { x: number; y: number; width: number; height: number }
    readonly provider: { centerX: number; maxWidth: number }
  },
): CardMetadataBand | null {
  if (!Number.isFinite(CW) || !Number.isFinite(CH) || CW < 1 || CH < 1) {
    return null
  }
  const cardBottom = geo.card.y + geo.card.height
  const providerRight = geo.provider.centerX + geo.provider.maxWidth / 2
  const x0 = Math.max(
    META_MARGIN,
    Math.ceil(providerRight + META_PROVIDER_GAP),
  )
  const x1 = CW - META_MARGIN
  const y0 = cardBottom + META_TOP_PAD
  const y1 = CH - META_MARGIN
  const w = x1 - x0
  const h = y1 - y0
  if (w < 24 || h < 12) return null
  return { x0, x1, y0, y1, w, h }
}

/**
 * Inline flow for ONE metadata line. The aggregate `★` is a VECTOR star
 * (solid `CARD_META_STAR_FILL`, the verbatim reference gold from
 * cover-generator.js) centered between two explicitly positioned Inter text
 * runs — never a mixed-font Noto `<tspan>` inside a `textLength`-pinned
 * `<text>`. Measured (P8 correction): the Noto-glyph branch underestimated
 * the real advance and `lengthAdjust="spacingAndGlyphs"` then squeezed the
 * whole line onto the estimate, so the star overlapped the genre (`DRAM★`)
 * and the last score digit clipped at the SVG edge (`8.`). Positions below
 * are computed from the same proven segment geometry the genre badge uses
 * (`genreBadgeSvgDims`: `gap = fs/3`, `gapStar = fs/6`, `bulletW = 0.35fs`,
 * `starW = 0.92fs`), each run starts only after the previous run ends plus
 * its gap, and NO `textLength` pinning is emitted — natural advances can no
 * longer be squeezed into overlaps or off the edge. A small `buf` pad on the
 * block keeps real ink (which may exceed the estimate by a few px) off the
 * SVG bounds.
 */
function cardStarPath(R: number): string {
  const inner = R * 0.382
  const pts: string[] = []
  for (let k = 0; k < 10; k++) {
    const ang = ((-90 + k * 36) * Math.PI) / 180
    const r = k % 2 === 0 ? R : inner
    pts.push(`${cardRound2(r * Math.cos(ang))},${cardRound2(r * Math.sin(ang))}`)
  }
  return `M${pts[0]}L${pts.slice(1).join("L")}Z`
}

function cardRound2(n: number): number {
  return Math.round(n * 100) / 100
}

/** One metadata line split into measured segments (genre • ★ score). */
interface CardMetaSegments {
  /** Uppercase genre run ("" when the line carries no genre). */
  readonly genre: string
  /** One-decimal score run ("" for plain genre/year lines). */
  readonly score: string
  /** Verbatim plain text for genre-only/year lines (null for star lines). */
  readonly plain: string | null
}

function cardMetaSegments(line: CardMetadataLine): CardMetaSegments {
  const star = "\u2605"
  const at = line.text.indexOf(star)
  if (at < 0) return { genre: "", score: "", plain: line.text }
  const genre = line.text
    .slice(0, at)
    .replace(/\u2022/g, "")
    .trim()
  const score = line.text
    .slice(at + star.length)
    .trim()
  if (score === "") return { genre: "", score: "", plain: line.text }
  return { genre, score, plain: null }
}

/** Measured content width of one parsed line at `fs` (no pinning). */
function cardMetaContentWidth(seg: CardMetaSegments, fs: number): number {
  if (seg.plain !== null) return Math.max(estimateTextWidth(seg.plain, fs), 1)
  const gap = Math.round(fs / 3)
  const gapStar = Math.round(fs / 6)
  const bulletW = Math.round(fs * 0.35)
  const starW = Math.round(fs * 0.92)
  const genreW = seg.genre !== "" ? estimateTextWidth(seg.genre, fs) : 0
  const scoreW = seg.score !== "" ? estimateTextWidth(seg.score, fs) : 0
  if (seg.genre !== "" && seg.score !== "") {
    return genreW + gap + bulletW + gap + starW + gapStar + scoreW
  }
  if (seg.score !== "") return starW + gapStar + scoreW
  return Math.max(genreW, 1)
}

/**
 * One centered row: explicitly positioned runs (genre text, `•` bullet, vector
 * gold star path, score text) or a single centered plain run. Every caller
 * string passes through `escSvg`, so hostile input cannot inject markup.
 */
function cardMetaRow(
  seg: CardMetaSegments,
  fs: number,
  blockW: number,
  centerY: number,
): string {
  const fill = "#F3F4F6"
  const fam = (s: string): string => fontFamilyFor(s)
  if (seg.plain !== null) {
    return (
      `<text x="${cardRound2(blockW / 2)}" y="${centerY}" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="${fam(seg.plain)}" font-weight="600" font-size="${fs}" fill="${fill}">${escSvg(seg.plain)}</text>`
    )
  }
  const starW = Math.round(fs * 0.92)
  const starDy = Math.max(2, Math.round(fs * 0.14))
  const contentW = cardMetaContentWidth(seg, fs)
  const rowLeft = (blockW - contentW) / 2
  if (seg.genre !== "" && seg.score !== "") {
    const gap = Math.round(fs / 3)
    const gapStar = Math.round(fs / 6)
    const bulletW = Math.round(fs * 0.35)
    const genreW = estimateTextWidth(seg.genre, fs)
    const bulletCx = rowLeft + genreW + gap + bulletW / 2
    const starCx = rowLeft + genreW + gap + bulletW + gap + starW / 2
    const scoreX = rowLeft + genreW + gap + bulletW + gap + starW + gapStar
    return (
      `<text x="${cardRound2(rowLeft)}" y="${centerY}" text-anchor="start" dominant-baseline="central" ` +
      `font-family="${fam(seg.genre)}" font-weight="600" font-size="${fs}" fill="${fill}">${escSvg(seg.genre)}</text>` +
      `<text x="${cardRound2(bulletCx)}" y="${centerY}" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="${fam("\u2022")}" font-weight="600" font-size="${fs}" fill="${fill}" fill-opacity="0.55">\u2022</text>` +
      `<g transform="translate(${cardRound2(starCx)},${cardRound2(centerY + starDy)})" fill="${CARD_META_STAR_FILL}">` +
      `<path d="${cardStarPath(starW / 2)}"/></g>` +
      `<text x="${cardRound2(scoreX)}" y="${centerY}" text-anchor="start" dominant-baseline="central" ` +
      `font-family="${fam(seg.score)}" font-weight="600" font-size="${fs}" fill="${fill}">${escSvg(seg.score)}</text>`
    )
  }
  const starCx = rowLeft + starW / 2
  const scoreX = rowLeft + starW + Math.round(fs / 6)
  return (
    `<g transform="translate(${cardRound2(starCx)},${cardRound2(centerY + starDy)})" fill="${CARD_META_STAR_FILL}">` +
    `<path d="${cardStarPath(starW / 2)}"/></g>` +
    `<text x="${cardRound2(scoreX)}" y="${centerY}" text-anchor="start" dominant-baseline="central" ` +
    `font-family="${fam(seg.score)}" font-weight="600" font-size="${fs}" fill="${fill}">${escSvg(seg.score)}</text>`
  )
}

export interface CardMetadataSvg {
  readonly svg: string
  readonly w: number
  readonly h: number
  readonly fontSize: number
  readonly cols: number
  readonly rows: number
}

/**
 * Pure metadata block SVG (transparent): ONE centered column, one row per
 * line — the inline aggregate line (`GENRE • ★ 8.3`, vector star) plus the
 * optional year on its OWN next line, never crammed beside the score (P8
 * correction: the old fewest-columns grid put `2024` next to `8.3` with no
 * separator on short landscape bands). Largest legible font that fits
 * (base down to 11px, never microscopic, never a silent clip): a long genre
 * shrinks the font, the full one-decimal score always renders complete.
 * Every caller string passes through `escSvg`, so hostile input cannot
 * inject markup. No `textLength` pinning anywhere (see `cardMetaRow`).
 * Returns null when there are no lines or nothing fits the band.
 */
export function cardMetadataSvg(
  lines: readonly CardMetadataLine[],
  bandW: number,
  bandH: number,
  baseFontSize: number,
): CardMetadataSvg | null {
  if (lines.length === 0) return null
  if (!Number.isFinite(bandW) || !Number.isFinite(bandH)) return null
  if (bandW < 24 || bandH < 12) return null
  let base = Math.round(baseFontSize)
  if (!Number.isFinite(base) || base < CARD_META_MIN_FONT) {
    base = CARD_META_MIN_FONT
  }
  const n = lines.length
  const segs = lines.map(cardMetaSegments)
  for (let fs = base; fs >= CARD_META_MIN_FONT; fs--) {
    const lineH = Math.max(1, Math.round(fs * 1.35))
    const buf = Math.round(fs * 0.3)
    const blockH = n * lineH
    if (blockH > Math.floor(bandH)) continue
    const widths = segs.map((s) => cardMetaContentWidth(s, fs))
    const blockW = Math.max(...widths) + buf
    if (blockW > Math.floor(bandW)) continue
    const rows = segs.map((s, i) =>
      cardMetaRow(s, fs, blockW, Math.round(i * lineH + lineH / 2)),
    )
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${blockW}" height="${blockH}" viewBox="0 0 ${blockW} ${blockH}">` +
      `<g filter="url(#cardMetaSh)">${rows.join("")}</g>` +
      `<defs><filter id="cardMetaSh" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.8"/>` +
      `</filter></defs></svg>`
    return { svg, w: blockW, h: blockH, fontSize: fs, cols: 1, rows: n }
  }
  return null
}

interface CardNumeralMaterial {
  /** Gradient id used by the outline fill. */
  readonly gradientId: string
  /** Verbatim reference stroke-gradient stops. */
  readonly gradientStops: string
  /** Bounded filter def (feDropShadow only, no feGaussianBlur). */
  readonly filterDef: string
}

/**
 * Hollow-outline numeral material, faithful to the classic `numberSvg`
 * reference: `provider-glass` strokes with the verbatim `crystalGlassStroke`
 * stops under a black drop shadow + white glass rim (reference opacities 0.95
 * / 0.40); `stremio` and `nuvio` stroke with the verbatim `strokeGrad` stops
 * under an accent neon glow (reference mid-glow 0.52) plus a soft black drop.
 * Accent semantics follow the existing skins: provider ignores any accent
 * (pure crystal), stremio uses its fixed violet skin accent, nuvio uses the
 * caller-resolved brand accent through the strict `#rrggbb` gate (invalid ->
 * neutral fallback, never raw caller text).
 *
 * Two deliberate bounded adaptations (NOT verbatim, documented): the filter
 * uses `feDropShadow` primitives only (no `feGaussianBlur`, per this stage's
 * offline contract) at the reference opacities, and every blur radius /
 * offset SCALES with the numeral size (`fontSize / 405`, the reference
 * poster single size). The reference only ever renders these filters at
 * 335..450px fonts, where sigma 12 is a thin rim; pasting absolute sigma 12
 * onto a gutter-fitted ~90px numeral would flood the small glyph counters
 * with haze and shrink the fit. Proportional scaling preserves the reference
 * look at any size while keeping counters hollow.
 */
export function cardNumeralMaterial(skin: CardSkin, accent: unknown, fontSize: number): CardNumeralMaterial {
  const k = Math.max(0.2, fontSize / 405)
  const f1 = (v: number): string => (Math.round(v * 10) / 10).toString()
  if (skin === "provider-glass") {
    return {
      gradientId: "cardNumCrystalStroke",
      gradientStops:
        `<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.95"/>` +
        `<stop offset="30%" stop-color="#FFFFFF" stop-opacity="0.80"/>` +
        `<stop offset="65%" stop-color="#E2E8F0" stop-opacity="0.45"/>` +
        `<stop offset="100%" stop-color="#CBD5E1" stop-opacity="0.85"/>`,
      filterDef:
        `<filter id="cardNumFilter" x="-60%" y="-60%" width="220%" height="220%">` +
        `<feDropShadow dx="0" dy="${f1(6 * k)}" stdDeviation="${f1(12 * k)}" flood-color="#000000" flood-opacity="0.95"/>` +
        `<feDropShadow dx="0" dy="0" stdDeviation="${f1(4 * k)}" flood-color="#FFFFFF" flood-opacity="0.40"/>` +
        `</filter>`,
    }
  }
  const glow =
    skin === "stremio"
      ? STREMIO_CARD_SKIN_PALETTE.stroke.s4
      : resolveCardSkinAccent(accent)
  return {
    gradientId: "cardNumStrokeGrad",
    gradientStops:
      `<stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.98"/>` +
      `<stop offset="48%" stop-color="#F1F2F4" stop-opacity="0.94"/>` +
      `<stop offset="100%" stop-color="#C9CDD3" stop-opacity="0.86"/>`,
    filterDef:
      `<filter id="cardNumFilter" x="-60%" y="-60%" width="220%" height="220%">` +
      `<feDropShadow dx="0" dy="0" stdDeviation="${f1(11 * k)}" flood-color="${glow}" flood-opacity="0.52"/>` +
      `<feDropShadow dx="0" dy="${f1(3 * k)}" stdDeviation="${f1(4 * k)}" flood-color="#000000" flood-opacity="0.6"/>` +
      `</filter>`,
  }
}

export interface CardNumeralLayer {
  /** Shipped numeral PNG (gradient ring + per-skin glow, transparent). */
  readonly png: Buffer
  /**
   * Shadowless glyph mask PNG (plain white text on transparent, IDENTICAL
   * grid to the shipped layer — the EDT input itself, reused by the
   * double-digit valley proof so mask and layer can never disagree).
   */
  readonly maskPng: Buffer
  /**
   * Unfiltered contour PNG (white + ring alpha, same grid — the ring
   * before the glow/drop filter). Exposed so tests measure the STROKE
   * weight itself (contour vs the pre-P16 stroked reference) without the
   * per-skin glow fringe inflating the bands; never shipped alone.
   */
  readonly ringPng: Buffer
  readonly svgW: number
  readonly svgH: number
  /** Padding around the glyphs (stroke + shadow fringe). */
  readonly pad: number
  /** Baseline Y inside the layer. */
  readonly baselineY: number
}

/**
 * 1D exact squared Euclidean distance transform (Felzenszwalb &
 * Huttenlocher, two linear passes): `f[i]` is 0 at seed pixels and INF
 * elsewhere, `d` receives the squared distance to the nearest seed.
 * O(n) time, O(n) extra for the parabola envelope.
 */
function edt1d(f: Float64Array, n: number, d: Float64Array): void {
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = Number.NEGATIVE_INFINITY
  z[1] = Number.POSITIVE_INFINITY
  for (let q = 1; q < n; q++) {
    const vk = v[k] ?? 0
    let s = (f[q]! + q * q - (f[vk]! + vk * vk)) / (2 * q - 2 * vk)
    while (s <= (z[k] ?? Number.POSITIVE_INFINITY)) {
      k--
      const vkk = v[k] ?? 0
      s = (f[q]! + q * q - (f[vkk]! + vkk * vkk)) / (2 * q - 2 * vkk)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Number.POSITIVE_INFINITY
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? Number.POSITIVE_INFINITY) < q) k++
    const dx = q - (v[k] ?? 0)
    d[q] = dx * dx + (f[v[k] ?? 0] ?? 0)
  }
}

/**
 * 2D exact squared Euclidean distance transform of a binary grid:
 * squared distance from every pixel to the nearest seed pixel, where the
 * seed set is the foreground (`foreground = true`: distance to the
 * nearest ink) or the background (`false`: distance to the nearest void).
 * Column pass then row pass (one 1D transform per line): O(w*h) time,
 * never O(n*r^2), never full-frame artwork loops — the grid here is
 * always the glyph-size mask.
 */
function edtSquared(fg: Uint8Array, w: number, h: number, foreground: boolean): Float64Array {
  const INF = 1e20
  const f = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    f[i] = ((fg[i] ?? 0) > 0) === foreground ? 0 : INF
  }
  const tmp = new Float64Array(w * h)
  const out = new Float64Array(w * h)
  const colF = new Float64Array(h)
  const colD = new Float64Array(h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colF[y] = f[y * w + x] ?? INF
    edt1d(colF, h, colD)
    for (let y = 0; y < h; y++) tmp[y * w + x] = colD[y] ?? INF
  }
  const rowF = new Float64Array(w)
  const rowD = new Float64Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) rowF[x] = tmp[y * w + x] ?? INF
    edt1d(rowF, w, rowD)
    for (let x = 0; x < w; x++) out[y * w + x] = rowD[x] ?? INF
  }
  return out
}

/**
 * Exact Euclidean contour ring of a glyph alpha grid (P18).
 *
 * The binary silhouette (alpha > 128, i.e. the true contour — resvg
 * antialiases glyph edges over ~1px, so the midpoint is the edge) feeds
 * two exact signed distance fields: inside distance (ink to nearest
 * void) and outside distance (void to nearest ink). The ring is the
 * centered band `distance <= halfWidth` on BOTH sides of the union edge
 * with a 1px linear antialiased ramp (`alpha = half + 1.0 - d`, so the
 * ramp centers the rendered core on the reference stroke's own
 * antialiased footprint: measured band core matches the pre-P16 stroked
 * `<text>` within 1px for even and odd widths alike), so the total band
 * restores the full reference `strokeWidth` (inner half + outer half)
 * instead of the P16 outer-only half band — while staying isotropic by
 * construction (no square morphology kernel, hence no P17 diagonal
 * inflation: a diagonal edge dilates exactly as far perpendicular as an
 * orthogonal one). The extra ramp half-pixel can only ever paint within
 * `half + 0.7` of an edge — far inside the rogue boundary budget
 * (`ceil(sw/2) + 3`), so the clean-4 proof is unaffected.
 *
 * Hollow by construction: counter/hole interiors farther than
 * `halfWidth` from any edge stay 0 (the 4 triangle, 6/8/9/0 bowls), and
 * interior font-subpath overlaps can never paint (the input is the
 * unioned silhouette, not separate subpath strokes). Pure arithmetic
 * over the passed grid: no I/O, no imports, no font access.
 *
 * Returns per-pixel ring alpha 0..255 (`w*h`, row-major). Empty grid or
 * non-positive half -> all zeros (no edge, no contour).
 */
export function cardNumeralContourRing(
  alpha: Uint8Array,
  w: number,
  h: number,
  halfWidth: number,
): Uint8Array {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    return new Uint8Array(0)
  }
  if (alpha.length < w * h) return new Uint8Array(0)
  const half = Number.isFinite(halfWidth) && halfWidth > 0 ? halfWidth : 0
  const out = new Uint8Array(w * h)
  if (half <= 0) return out
  const fg = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) fg[i] = (alpha[i] ?? 0) > 128 ? 1 : 0
  const distToInk = edtSquared(fg, w, h, true)
  const distToVoid = edtSquared(fg, w, h, false)
  for (let i = 0; i < w * h; i++) {
    const d = Math.sqrt((fg[i] ?? 0) > 0 ? (distToVoid[i] ?? 0) : (distToInk[i] ?? 0))
    const a = half + 1.0 - d
    out[i] = a <= 0 ? 0 : a >= 1 ? 255 : Math.round(a * 255)
  }
  return out
}

/**
 * Shipped numeral layer for a validated rank (transparent PNG).
 *
 * P18: the contour is the exact Euclidean ring
 * (`cardNumeralContourRing`) of the rasterized filled-glyph union — the
 * same grid the shadowless glyph mask uses, so layer and mask agree by
 * construction for singles AND doubles (doubles keep their
 * `transform="scale(<cx> 1)"` condensation: the distance band is computed
 * post-transform, hence uniform at the full reference weight — resvg
 * ignores `vector-effect="non-scaling-stroke"`, probed byte-identical, so
 * a transformed text stroke would thin anisotropically). The ring (white
 * + ring alpha, glyph-size only) fills the per-skin reference gradient
 * rect directly (unfiltered, so the contour weight is exact); the
 * per-skin bounded glow/drop filter applies to a SECOND rect masked by
 * the OUTER ring half only. Same visual materials as the reference
 * (verbatim gradient stops, reference opacities, size-scaled radii),
 * only the contour source changed — and the blurred glow never bleeds
 * into small counters past the rogue budget (measured: the full-ring
 * glow spilled 92 core px 7..10px deep into the 4 triangle; the crisp
 * contour alone scans zero). The outer glow fringe — the visible
 * reference halo — is byte-for-byte the same construction as a full-ring
 * glow outside the silhouette. No
 * extra tracking on top of the reference letter-spacing (measured, extra
 * `-0.03em` closes the "17"/"20" junction to a zero-column gap at 0.6
 * condensation).
 *
 * Costs 2 small rasterizations (glyph mask + final layer) plus
 * glyph-size raw scans and the linear distance transform — never
 * artwork-size work, never a bitmap blur, never a full-frame loop.
 */
export async function renderCardNumeralLayer(
  rank: number,
  fontSize: number,
  letterSpacing: number,
  strokeWidth: number,
  skin: CardSkin,
  accent?: unknown,
  condenseX = 1,
): Promise<CardNumeralLayer> {
  const text = String(rank)
  const material = cardNumeralMaterial(skin, accent, fontSize)
  const cx = Number.isFinite(condenseX) && condenseX > 0 && condenseX <= 1 ? condenseX : 1
  // Shared union-contour outline for singles AND doubles.
  const parts = cardNumeralParts(text, fontSize, letterSpacing, strokeWidth, cx)
  const maskSpec = cardNumeralMaskSvg(rank, fontSize, letterSpacing, strokeWidth, cx)
  const maskPng = await renderSVG(maskSpec.svg, maskSpec.svgW)
  const { data, info } = await sharp(maskPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const mw = info.width
  const mh = info.height
  const alpha = new Uint8Array(mw * mh)
  for (let i = 0; i < mw * mh; i++) alpha[i] = data[i * 4 + 3] ?? 0
  const ring = cardNumeralContourRing(alpha, mw, mh, strokeWidth / 2)
  const rgba = Buffer.alloc(mw * mh * 4)
  const glowRgba = Buffer.alloc(mw * mh * 4)
  for (let i = 0; i < mw * mh; i++) {
    const a = ring[i] ?? 0
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = a
    // Outer half only (void side of the union edge): the blurred glow
    // source. The crisp contour above already carries the full weight;
    // sourcing the blur from the outer half keeps the reference outer
    // halo intact while no blurred light reaches counter interiors.
    const outside = (alpha[i] ?? 0) <= 128 ? a : 0
    glowRgba[i * 4] = 255
    glowRgba[i * 4 + 1] = 255
    glowRgba[i * 4 + 2] = 255
    glowRgba[i * 4 + 3] = outside
  }
  const ringPng = await sharp(rgba, { raw: { width: mw, height: mh, channels: 4 } })
    .png()
    .toBuffer()
  const glowPng = await sharp(glowRgba, { raw: { width: mw, height: mh, channels: 4 } })
    .png()
    .toBuffer()
  const ringB64 = ringPng.toString("base64")
  const glowB64 = glowPng.toString("base64")
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${parts.svgW}" height="${parts.svgH}" viewBox="0 0 ${parts.svgW} ${parts.svgH}">` +
    `<defs><linearGradient id="${material.gradientId}" x1="0" y1="0" x2="0" y2="1">${material.gradientStops}</linearGradient>` +
    `<mask id="cardNumRingM" maskUnits="userSpaceOnUse" x="0" y="0" width="${parts.svgW}" height="${parts.svgH}">` +
    `<image href="data:image/png;base64,${ringB64}" x="0" y="0" width="${mw}" height="${mh}"/>` +
    `</mask>` +
    `<mask id="cardNumGlowM" maskUnits="userSpaceOnUse" x="0" y="0" width="${parts.svgW}" height="${parts.svgH}">` +
    `<image href="data:image/png;base64,${glowB64}" x="0" y="0" width="${mw}" height="${mh}"/>` +
    `</mask>` +
    material.filterDef +
    `</defs>` +
    `<rect width="${parts.svgW}" height="${parts.svgH}" fill="url(#${material.gradientId})" mask="url(#cardNumRingM)"/>` +
    `<g filter="url(#cardNumFilter)"><rect width="${parts.svgW}" height="${parts.svgH}" fill="url(#${material.gradientId})" mask="url(#cardNumGlowM)"/></g>` +
    `</svg>`
  const png = await renderSVG(svg, parts.svgW)
  return { png, maskPng, ringPng, svgW: parts.svgW, svgH: parts.svgH, pad: parts.pad, baselineY: parts.baselineY }
}

/**
 * Shared glyph source: dims + the `<text>` element (transformed only when
 * condensing). Single source for the shipped ring layer and the shadowless
 * glyph mask, so both grids are identical by construction (same
 * svgW/svgH/pad/coords) for singles AND doubles.
 */
function cardNumeralParts(
  text: string,
  fontSize: number,
  letterSpacing: number,
  strokeWidth: number,
  cx: number,
): { svgW: number; svgH: number; pad: number; baselineY: number; textEl: string } {
  const rawEst = Math.max(
    1,
    Math.round(
      estimateTextWidth(text, fontSize) + letterSpacing * Math.max(0, text.length - 1),
    ),
  )
  // Scratch-only headroom (never shipped: the placed layer is positioned by
  // measured ink): the badge-text estimator undershoots real condensed
  // Inter-800 digit ink (measured real/est up to ~1.26 on wide ranks like
  // "20" — the scratch check below would otherwise mistake the estimate for
  // a clipped raster). Same discipline as the Fresh numeral scratch bound.
  const estW = Math.max(1, Math.ceil(rawEst * cx * 1.35))
  const pad = Math.max(8, strokeWidth + 8)
  const svgW = estW + pad * 2 + 4
  const svgH = Math.round(fontSize * 1.0) + pad * 2
  const baselineY = pad + Math.round(fontSize * 0.75)
  const condensed = cx < 1
  const textX = condensed ? Math.round((pad / cx) * 100) / 100 : pad
  const transform = condensed ? `transform="scale(${cx} 1)" ` : ""
  const textEl =
    `<text x="${textX}" y="${baselineY}" font-family="Inter, Arial, Helvetica, sans-serif" ` +
    `font-size="${fontSize}" font-weight="800" letter-spacing="${letterSpacing}" ` +
    `${transform}fill="#ffffff">${escSvg(text)}</text>`
  return { svgW, svgH, pad, baselineY, textEl }
}

export interface CardNumeralMask {
  readonly svg: string
  readonly svgW: number
  readonly svgH: number
  readonly pad: number
  readonly baselineY: number
}

/**
 * Shadowless glyph mask for a Card numeral (plain white text on
 * transparent, IDENTICAL grid to the shipped ring layer via the shared
 * `cardNumeralParts` source). The digit structure (inter-digit valley, two
 * ordered masses) is measured on this mask: the shipped layer's white
 * rim-glow fringe bridges narrow condensed junctions at ink thresholds
 * (measured: "11"/"12"/"13"/"16"/"17"/"19" lose their zero-column gap under
 * glow), while the crisp mask keeps the true glyph separation (measured
 * valley depth >= 0.90 on every rank 10..20, both shapes). Same mask/source
 * discipline as the Fresh numeral.
 */
export function cardNumeralMaskSvg(
  rank: number,
  fontSize: number,
  letterSpacing: number,
  strokeWidth: number,
  condenseX = 1,
): CardNumeralMask {
  const text = String(rank)
  const cx = Number.isFinite(condenseX) && condenseX > 0 && condenseX <= 1 ? condenseX : 1
  const parts = cardNumeralParts(text, fontSize, letterSpacing, strokeWidth, cx)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${parts.svgW}" height="${parts.svgH}" viewBox="0 0 ${parts.svgW} ${parts.svgH}">` +
    parts.textEl +
    `</svg>`
  return { svg, svgW: parts.svgW, svgH: parts.svgH, pad: parts.pad, baselineY: parts.baselineY }
}

export interface AlphaInkBounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly w: number
  readonly h: number
}

/**
 * Tight real ink bounds of a rasterized transparent layer (alpha scan at
 * canvas resolution). Null when the layer carries no ink. Shared with tests
 * for the shipped-geometry assertions; the acceptance tests additionally
 * re-scan the FINAL poster independently (no helper tautology).
 *
 * Threshold selects the mask: 10 catches the faint shadow fringe, 80 keeps
 * the core digit mask (outline stroke) while excluding the soft fringe. The
 * numeral fit decides on the CORE mask; the fringe may bleed and be cropped
 * by `placeInCanvas` without losing digit ink.
 */
export async function measureAlphaInk(
  png: Buffer,
  threshold = 10,
): Promise<AlphaInkBounds | null> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
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

/** Alpha threshold for the core digit mask (excludes shadow fringe). */
export const CARD_NUMERAL_CORE_THRESHOLD = 80
/**
 * Alpha threshold for the FIT mask. The final-poster acceptance scans a
 * STRONG mask (per-channel delta > 24 vs the unranked poster): any such
 * pixel necessarily carries layer alpha > 24 (delta ~= alpha/255 * color
 * distance, distance <= 255), so the alpha-24 layer mask always covers the
 * acceptance mask. Fitting THIS mask inside the margin box therefore proves
 * the shipped strong ink (outline stroke plus the bright neon/rim glow
 * fringe, which spreads well beyond the core stroke) contained with
 * background margins on every side. Kept distinct from the core threshold
 * above, which still describes the digit body itself.
 */
const NUMERAL_FIT_INK_THRESHOLD = 24
/** Floor for a double-digit numeral: smaller is omitted, never clipped. */
export const CARD_NUMERAL_MIN_FONT = 12

/**
 * Split of a double-digit core-ink column profile into two ordered digit
 * masses. Shared by the production placement and the acceptance tests, so
 * both prove the same two-digit structure from independently measured data.
 *
 * Looks for the deepest valley inside the middle 30%..70% of the core bbox:
 * condensed doubles always show one (measured depth >= 0.90 on every rank
 * 10..20, both shapes — even the kissing "17"/"20" junctions). Returns null
 * when there is no valley worth splitting on (a single mass, never two
 * ordered digits).
 */
export interface CardNumeralSplit {
  /** Placed X of the valley column (separator between the digits). */
  readonly valleyX: number
  /** Valley depth share: 1 - valleyCount / maxCount (>= 0.6 required). */
  readonly depth: number
  /** Core pixels left of the valley (first digit). */
  readonly leftMass: number
  /** Core pixels right of the valley (second digit). */
  readonly rightMass: number
  /** Placed X of the core bbox left edge. */
  readonly minX: number
  /** Placed X of the core bbox right edge. */
  readonly maxX: number
}

export function splitCardNumeralColumns(
  counts: readonly number[],
  minX: number,
  maxX: number,
): CardNumeralSplit | null {
  if (maxX <= minX) return null
  const w = maxX - minX + 1
  const lo = Math.ceil(minX + w * 0.3)
  const hi = Math.floor(minX + w * 0.7)
  if (hi <= lo) return null
  let colMax = 0
  for (let x = minX; x <= maxX; x++) colMax = Math.max(colMax, counts[x] ?? 0)
  if (colMax <= 0) return null
  let valleyX = -1
  let valleyCount = Number.POSITIVE_INFINITY
  for (let x = lo; x <= hi; x++) {
    const c = counts[x] ?? 0
    if (c < valleyCount) {
      valleyCount = c
      valleyX = x
    }
  }
  if (valleyX < 0) return null
  const depth = 1 - valleyCount / colMax
  if (!(depth >= 0.6)) return null
  let leftMass = 0
  let rightMass = 0
  for (let x = minX; x <= maxX; x++) {
    if (x < valleyX) leftMass += counts[x] ?? 0
    else if (x > valleyX) rightMass += counts[x] ?? 0
  }
  if (leftMass <= 0 || rightMass <= 0) return null
  // Both digits carry substantial ink: neither mass may be a sliver (measured
  // balances are >= 0.83 on every rank/shape; 0.5 keeps wide margin while a
  // clipped-away digit could never pass).
  if (Math.min(leftMass, rightMass) / Math.max(leftMass, rightMass) < 0.5) return null
  return { valleyX, depth, leftMass, rightMass, minX, maxX }
}

/** Per-column core-ink counts of a rasterized transparent layer. */
export async function cardNumeralColumns(
  png: Buffer,
  width: number,
  threshold: number,
): Promise<{ counts: number[]; minX: number; maxX: number; minY: number; maxY: number } | null> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.width !== width) return null
  const counts = new Array<number>(info.width).fill(0)
  let minX = info.width
  let maxX = -1
  let minY = info.height
  let maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) > threshold) {
        counts[x]!++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX) return null
  return { counts, minX, maxX, minY, maxY }
}

/**
 * Clip a layer to the visible canvas intersection (rounded ints). Sharp's
 * `.composite()` rejects overlays that overflow the base on some versions,
 * so transformed layers (negative anchors, e.g. the double-digit gutter
 * anchor) are pre-cropped here. Null when nothing is visible.
 */
async function placeInCanvas(
  png: Buffer,
  w: number,
  h: number,
  left: number,
  top: number,
  CW: number,
  CH: number,
): Promise<{ png: Buffer; left: number; top: number } | null> {
  const l = Math.round(left)
  const t = Math.round(top)
  const x0 = Math.max(0, -l)
  const y0 = Math.max(0, -t)
  const x1 = Math.min(w, CW - l)
  const y1 = Math.min(h, CH - t)
  if (x1 <= x0 || y1 <= y0) return null
  const cropped =
    x1 - x0 === w && y1 - y0 === h
      ? png
      : await sharp(png)
          .extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
          .toBuffer()
  return { png: cropped, left: l + x0, top: t + y0 }
}

async function roundedArtworkCard(
  artwork: Buffer,
  cardW: number,
  cardH: number,
  radius: number,
): Promise<Buffer> {
  const cover = await sharp(artwork)
    .resize(cardW, cardH, { fit: "cover", position: "centre" })
    .ensureAlpha()
    .toBuffer()
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(cardW, cardH) / 2)))
  const maskSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}" viewBox="0 0 ${cardW} ${cardH}">` +
    `<rect width="${cardW}" height="${cardH}" rx="${r}" ry="${r}" fill="#ffffff"/></svg>`
  const mask = await renderSVG(maskSvg, cardW)
  return sharp(cover).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer()
}

async function cardShadowLayer(cardW: number, cardH: number, radius: number): Promise<{ png: Buffer; w: number; h: number; pad: number }> {
  const pad = 16
  const w = cardW + pad * 2
  const h = cardH + pad * 2
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(cardW, cardH) / 2)))
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><filter id="cardSh" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.55"/>` +
    `</filter></defs>` +
    `<rect x="${pad}" y="${pad}" width="${cardW}" height="${cardH}" rx="${r}" ry="${r}" fill="#000000" filter="url(#cardSh)"/></svg>`
  return { png: await renderSVG(svg, w), w, h, pad }
}

/**
 * Inner ink rim of the glass decorative frame at a real canvas size (P17).
 * Replicates the `cardSkinBackgroundSvg` frame math (same `pad` shrink rule,
 * same `w > 1100` stroke switch, same quarter-rect cap): the rect sits at
 * `pad` with a centered stroke, so its innermost ink reaches
 * `pad + strokeW / 2`. `nuvio` paints no frame (solid black), so its rim is
 * the canvas edge (0) — the margin below still keeps the mark off the edge.
 */
export function cardGlassInnerRim(CW: number, CH: number, skin: CardSkin): number {
  if (skin === "nuvio") return 0
  if (!Number.isFinite(CW) || !Number.isFinite(CH) || CW < 1 || CH < 1) return 0
  const w = Math.round(CW)
  const h = Math.round(CH)
  const pad = Math.max(1, Math.min(12, Math.floor(Math.min(w, h) / 8)))
  const rw = w - pad * 2
  const rh = h - pad * 2
  if (rw < 1 || rh < 1) return 0
  const refStroke = w > 1100 ? 4 : 3.5
  const strokeW = Math.max(1, Math.min(refStroke, Math.max(1, Math.floor(Math.min(rw, rh) / 4))))
  return pad + strokeW / 2
}

/**
 * Minimum clear space (real canvas px) between the provider mark ink and
 * the frame inner rim (P17 user requirement "slightly toward center", ~6-8px
 * at poster size). Proportional to the canvas width (`CW / 125`: 500 -> 4,
 * floored to 6; 768 -> 6; 1000 -> 8; 1280 -> 10) so the gap reads the same
 * at any size, with a 6px floor so small canvases keep a visible gap.
 */
export function cardProviderFrameMargin(CW: number): number {
  if (!Number.isFinite(CW) || CW < 1) return 6
  return Math.max(6, Math.round(CW / 125))
}

/**
 * Minimum allowed left edge for the fitted provider mark (real canvas px):
 * frame inner rim + proportional margin (P17).
 */
export function cardProviderMinLeft(CW: number, CH: number, skin: CardSkin): number {
  return Math.ceil(cardGlassInnerRim(CW, CH, skin) + cardProviderFrameMargin(CW))
}

/**
 * Horizontal origin for the fitted provider mark (P17): the historical
 * gutter center is preserved, but the mark is shifted slightly inward so its
 * real ink clears the decorative frame (`cardProviderMinLeft`). The fitted
 * size NEVER changes here (P14 enlargement intact, `netscale` respected);
 * only the origin moves.
 *
 * Art protection: when the mark vertically shares the card's span (tall
 * marks beside the card's lower zone, e.g. landscape at high `netscale`),
 * the origin is additionally capped so the mark never crosses the card's
 * left edge — it may extend past `cardX` ONLY in the strictly below-card
 * zone (pure background, never through art). When frame clearance and the
 * card edge are jointly infeasible at full size (landscape slot-filling
 * marks at 150%+), the art cap wins and the size is still preserved (never
 * shrunk back): that corner keeps the historical origin, documented and
 * pinned by test.
 *
 * Depends only on geometry + fitted size: never on metadata/badge state, so
 * toggling the badge cannot move the mark (no jump).
 */
export function placeCardProviderMark(
  centerX: number,
  fittedW: number,
  CW: number,
  CH: number,
  skin: CardSkin,
  cardX: number,
  markTop: number,
  cardBottom: number,
): number {
  const need = cardProviderMinLeft(CW, CH, skin)
  const overlapsCardVertically = markTop < cardBottom
  const rightLimit = overlapsCardVertically ? cardX : CW
  const artMax = rightLimit - fittedW
  let px = Math.round(centerX - fittedW / 2)
  if (px < need) px = need
  if (px > artMax) px = artMax
  const hi = Math.max(0, CW - fittedW)
  return clampInt(px, 0, hi)
}

/** True when the buffer decodes to an image with positive dimensions. */
async function isDecodableImage(buf: Buffer | null | undefined): Promise<boolean> {
  if (!buf || buf.length === 0) return false
  try {
    const meta = await sharp(buf).metadata()
    return (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0
  } catch {
    return false
  }
}

/**
 * Contain-fit of an already-resolved provider/network bitmap into a max box
 * (aspect preserved, never cropped). Unlike `fitLogoContain` this MAY
 * enlarge: the resolved brand mark (area-normalized ~3600px² raster or a
 * downscaled TMDB fallback) is otherwise smaller than the enlarged Card left-
 * column slot, so shrink-only would pin it at the small baseline size (P14).
 * The upscale is bounded by the slot itself (which already carries the user
 * `netscale`), so the mark can never overflow the rank column, the card, or
 * the canvas. Null for missing/invalid buffers — omitted without error.
 */
async function fitCardProviderContain(
  buf: Buffer | null | undefined,
  maxW: number,
  maxH: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (!buf || buf.length === 0) return null
  if (!Number.isFinite(maxW) || !Number.isFinite(maxH) || maxW < 1 || maxH < 1) return null
  try {
    const meta = await sharp(buf).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    if (w <= 0 || h <= 0) return null
    const scale = Math.min(maxW / w, maxH / h)
    const outW = Math.max(1, Math.round(w * scale))
    const outH = Math.max(1, Math.round(h * scale))
    if (outW === w && outH === h) {
      // No-op path: return the resolved bytes untouched (no re-encode).
      const png = await sharp(buf).png().toBuffer()
      return { png, w: outW, h: outH }
    }
    const png = await sharp(buf)
      .resize(outW, outH)
      .png()
      .toBuffer()
    return { png, w: outW, h: outH }
  } catch {
    return null
  }
}
/**
 * Shrink-only fit of an already-resolved logo bitmap into a max box
 * (contain, aspect preserved, never enlarged, never cropped). Null for
 * missing/invalid buffers — the caller omits the layer without error.
 * Validation is by decoding (metadata), never by an arbitrary byte-length
 * gate, so a tiny but valid PNG (e.g. 1x1, 91 bytes) is accepted.
 */
async function fitLogoContain(
  buf: Buffer | null | undefined,
  maxW: number,
  maxH: number,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  if (!buf || buf.length === 0) return null
  if (!Number.isFinite(maxW) || !Number.isFinite(maxH) || maxW < 1 || maxH < 1) return null
  try {
    const meta = await sharp(buf).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    if (w <= 0 || h <= 0) return null
    if (w <= maxW && h <= maxH) return { png: buf, w, h }
    const scale = Math.min(maxW / w, maxH / h)
    const outW = Math.max(1, Math.floor(w * scale))
    const outH = Math.max(1, Math.floor(h * scale))
    const png = await sharp(buf)
      .resize(outW, outH, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer()
    return { png, w: outW, h: outH }
  } catch {
    return null
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)))
}

/** Scale-control bounds shared with Fresh (`normFreshScale`): 10..200%. */
const CARD_SCALE_MIN = 10
const CARD_SCALE_MAX = 200

/**
 * Effective title scale % (P14): an explicit finite value wins (clamped
 * 10..200, the existing server bound); null/absent/non-positive/non-finite
 * is the neutral 100 = base slot (same convention as Fresh, where auto
 * renders like explicit 100 — byte-identical). Card deliberately does NOT
 * use the Standard aspect auto curve here: at 69% it would shrink the
 * enlarged slot back below the small baseline (measured landscape
 * 164px -> 149px), defeating the user "LARGER" requirement.
 */
function resolveCardTitleScale(scale: number | null | undefined): number {
  if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) {
    return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, Math.round(scale)))
  }
  return 100
}

/**
 * Effective provider scale % (P14): the existing `netscale` control,
 * neutral 100 when absent (same convention as Fresh `normFreshScale`).
 */
function resolveCardProviderScale(scale: number | null | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale === 0) return 100
  return Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, Math.round(scale)))
}

/**
 * Measured single-digit numeral placement (P16 correction cycle 1): the ring
 * glyph lands with a measured translation only — canvas containment, never
 * a shift to induce an overlap. The historical gutter anchor is preserved;
 * when the natural ink reaches the card edge the card (composited AFTER the
 * numeral) hides it there by layer order — otherwise the digit stands
 * clear, by design (user "behind the poster NOT mandatory").
 *
 * - The CORE ink mask (threshold 80) must sit fully inside the canvas
 *   horizontally and vertically (never a clipped digit); the STRONG mask
 *   (threshold 24, ring + bright glow) gets the same left containment shift
 *   as doubles while its fringe may bleed right under the card (hidden by
 *   layer order, never overpainted).
 * - No tuck: clear-standing ranks (e.g. the verbatim rank 1) keep their
 *   natural placement even when fully clear of the card.
 *
 * Returns null when any proof fails — the caller draws no numeral rather
 * than a clipped one. The shipped layer arrives rasterized (mask + final
 * renders inside `renderCardNumeralLayer`) plus bounded alpha scans (the
 * same `measureAlphaInk` caps as the doubles path, no full-frame loops
 * beyond it, no blur roundtrip).
 */
export async function placeSingleNumeral(
  rank: number,
  anchorX: number,
  baselineY: number,
  baseFs: number,
  baseTrack: number,
  baseStroke: number,
  skin: CardSkin,
  accent: unknown,
  cardX: number,
  CW: number,
  CH: number,
): Promise<{ png: Buffer; left: number; top: number } | null> {
  const fs = Math.round(baseFs)
  if (fs < CARD_NUMERAL_MIN_FONT) return null
  const spec = await renderCardNumeralLayer(rank, fs, baseTrack, baseStroke, skin, accent, 1)
  const png = spec.png
  const core = await measureAlphaInk(png, CARD_NUMERAL_CORE_THRESHOLD)
  if (!core) return null
  const strong = await measureAlphaInk(png, NUMERAL_FIT_INK_THRESHOLD)
  if (!strong) return null
  // Never ship a clipped raster: both masks stay strictly inside the scratch
  // viewport (the estimator must have reserved real margin).
  if (
    core.minX < 2 ||
    core.maxX > spec.svgW - 3 ||
    strong.minX < 1 ||
    strong.maxX > spec.svgW - 2
  ) {
    return null
  }
  let left = anchorX - spec.pad
  const top = baselineY - spec.baselineY
  // Measured translation only: land the full STRONG ink inside the canvas on
  // the left. No shrink; the fringe is never cropped at the edge. No tuck:
  // the anchor is never shifted right to force an overlap.
  left += Math.max(0, 1 - (left + strong.minX))
  if (left + core.minX < 0 || top + core.minY < 0 || top + core.maxY >= CH) return null
  if (top + strong.minY < 0 || top + strong.maxY >= CH) return null
  const clipped = await placeInCanvas(png, spec.svgW, spec.svgH, left, top, CW, CH)
  if (!clipped) return null
  return { png: clipped.png, left: clipped.left, top: clipped.top }
}

/**
 * Fallback condensation ladder for wide doubles (P16 "condensation when
 * needed"): when the base `CARD_NUMERAL_CONDENSE_X` leaves the second digit
 * less than half visible behind the card (portrait "20" at the enlarged
 * size — the P9 size was already marginal there), the placement retries
 * with a tighter HORIZONTAL factor at the SAME height until both digits
 * prove recognizable again. Never a uniform shrink (fontSize never changes
 * across steps), never below 0.45 (tighter would merge the digits into one
 * mass and the valley proof fails closed). The first passing step wins; all
 * steps fail -> no numeral, never a half-hidden one. Extra rasterizations
 * happen only for ranks that need them (bounded: <= 4 steps x 2 small
 * layers); every other rank keeps the single base step.
 */
const DOUBLE_CONDENSE_FALLBACKS = [0.55, 0.5, 0.45]

export interface PlacedDoubleNumeral {
  readonly png: Buffer
  readonly left: number
  readonly top: number
  /** Condensation factor of the winning step (base or fallback). */
  readonly condenseX: number
}

/**
 * Measured double-digit numeral placement (P9, P16 correction cycle 1:
 * fallback condensation only, no tuck): the numeral rasterizes at the
 * reference double size (enlarged for 10..20) with horizontal condensation
 * — never a uniform shrink — and lands with a measured translation only.
 * The historical anchor is preserved; overlap behind the card happens only
 * when the natural ink reaches the card edge (layer order hides it there).
 *
 * - The STRONG ink mask (threshold 24, ring + bright glow) must sit fully
 *   inside the canvas on the left (a pure right shift lands it when the
 *   verbatim anchor starts marginally off-canvas) and vertically inside the
 *   canvas; it must also stay strictly inside the scratch viewport (never a
 *   clipped raster: ink touching the scratch edge means the size estimate
 *   lied, so the numeral is omitted rather than shipped clipped).
 * - The digit STRUCTURE is measured on the shadowless glyph mask
 *   (`cardNumeralMaskSvg`, identical grid): two ordered digit masses
 *   (`splitCardNumeralColumns`), the first digit ending fully before the
 *   card edge (never occluded — the card is composited AFTER the numeral)
 *   and the second digit keeping a visible majority before the card edge
 *   (never a lost first digit, never an entirely hidden second digit).
 *
 * Returns null when any proof fails — the caller draws no numeral rather
 * than a clipped, shrunk or half-hidden one. Base step costs 2 small
 * rasterizations (shipped layer plus glyph mask); each fallback step adds
 * at most 2 more, only for ranks that need them.
 */
export async function placeDoubleNumeral(
  rank: number,
  anchorX: number,
  baselineY: number,
  baseFs: number,
  baseTrack: number,
  baseStroke: number,
  condenseX: number,
  skin: CardSkin,
  accent: unknown,
  cardX: number,
  CW: number,
  CH: number,
): Promise<PlacedDoubleNumeral | null> {
  const fs = Math.round(baseFs)
  if (fs < CARD_NUMERAL_MIN_FONT) return null
  const baseCx = Number.isFinite(condenseX) && condenseX > 0 && condenseX <= 1 ? condenseX : 1
  const steps = [baseCx, ...DOUBLE_CONDENSE_FALLBACKS.filter((c) => c < baseCx)]
  for (const cx of steps) {
    const placed = await placeDoubleNumeralStep(
      rank, anchorX, baselineY, fs, baseTrack, baseStroke, cx, skin, accent, cardX, CW, CH,
    )
    if (placed) return placed
  }
  return null
}

/**
 * One measured placement attempt at a fixed condensation factor (see
 * `placeDoubleNumeral` for the proof contract). Null when any proof fails
 * at this width — the caller retries tighter, never smaller.
 */
async function placeDoubleNumeralStep(
  rank: number,
  anchorX: number,
  baselineY: number,
  fs: number,
  baseTrack: number,
  baseStroke: number,
  cx: number,
  skin: CardSkin,
  accent: unknown,
  cardX: number,
  CW: number,
  CH: number,
): Promise<PlacedDoubleNumeral | null> {
  const spec = await renderCardNumeralLayer(rank, fs, baseTrack, baseStroke, skin, accent, cx)
  const png = spec.png
  const maskSpec = cardNumeralMaskSvg(rank, fs, baseTrack, baseStroke, cx)
  if (maskSpec.svgW !== spec.svgW || maskSpec.svgH !== spec.svgH || maskSpec.pad !== spec.pad) {
    return null
  }
  // The valley proof reuses the layer's own EDT input (same buffer the
  // ring was derived from — mask and layer can never disagree).
  const maskPng = spec.maskPng
  const core = await measureAlphaInk(png, CARD_NUMERAL_CORE_THRESHOLD)
  if (!core) return null
  const strong = await measureAlphaInk(png, NUMERAL_FIT_INK_THRESHOLD)
  if (!strong) return null
  // Never ship a clipped raster: both masks stay strictly inside the scratch
  // viewport (the estimator must have reserved real margin).
  if (
    core.minX < 2 ||
    core.maxX > spec.svgW - 3 ||
    strong.minX < 1 ||
    strong.maxX > spec.svgW - 2
  ) {
    return null
  }
  let left = anchorX - spec.pad
  const top = baselineY - spec.baselineY
  // Measured translation only: land the full STRONG ink (ring + glow
  // fringe, not just the core) inside the canvas on the left. No shrink,
  // no re-raster; the fringe is never cropped at the edge.
  left += Math.max(0, 1 - (left + strong.minX))
  if (left + core.minX < 0 || top + core.minY < 0 || top + core.maxY >= CH) return null
  if (top + strong.minY < 0 || top + strong.maxY >= CH) return null
  // Two ordered digits from the shadowless mask (identical grid): the
  // shipped glow would bridge narrow condensed junctions at ink thresholds.
  const maskCols = await cardNumeralColumns(maskPng, maskSpec.svgW, 10)
  if (!maskCols) return null
  const split = splitCardNumeralColumns(maskCols.counts, maskCols.minX, maskCols.maxX)
  if (!split) return null
  // No tuck (correction cycle 1): the natural origin stands. The guards
  // below prove readability at the natural placement — the first digit
  // fully before the card edge, the second majoritarily visible.
  const originLeft = left
  const valleyPlacedX = originLeft + split.valleyX
  const digit1Right = valleyPlacedX - 1
  // First digit fully before the card edge (never occluded)…
  if (digit1Right >= cardX - 1) return null
  // …second digit majoritarily visible (never entirely behind the card).
  const placedMaxX = originLeft + maskCols.maxX
  const digit2Width = placedMaxX - valleyPlacedX
  const digit2Visible = Math.min(placedMaxX, cardX - 1) - valleyPlacedX + 1
  if (digit2Width <= 0 || digit2Visible < digit2Width * 0.5) return null
  const clipped = await placeInCanvas(png, spec.svgW, spec.svgH, originLeft, top, CW, CH)
  if (!clipped) return null
  return { png: clipped.png, left: clipped.left, top: clipped.top, condenseX: cx }
}

/**
 * Shared Card compositor. Returns the complete poster PNG at
 * `width` x `height` (exact dimensions). Pure offline composition from
 * already-resolved inputs — no fetch, no provider lookup, no new sources.
 *
 * Throws for unknown skins/shapes, non-finite/non-positive dimensions, or
 * missing/invalid artwork. Absent/invalid rank (incl. 21+) renders the
 * identical composition with no numeral. Missing logos/metadata render the
 * identical composition minus that layer (never an error).
 */
export async function renderCardPoster(input: CardLayoutInput): Promise<Buffer> {
  const { skin, shape, width, height } = input
  if (!isCardSkin(skin)) throw new Error(`Unknown Card skin: ${String(skin)}`)
  if (shape !== "poster" && shape !== "landscape") {
    throw new Error(`Unknown Card shape: ${String(shape)}`)
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid Card canvas: ${String(width)}x${String(height)}`)
  }
  if (!(await isDecodableImage(input.artwork))) {
    throw new Error("Card compositor needs resolved artwork bytes")
  }
  const artwork = input.artwork
  const CW = Math.round(width)
  const CH = Math.round(height)
  if (CW < 1 || CH < 1) throw new Error(`Invalid Card canvas: ${CW}x${CH}`)

  const rank =
    isCardRankDisplayable(input.displayedRank) ? input.displayedRank : null
  const geo = cardLayoutGeometry(shape, CW, CH, rank)
  if (!geo) throw new Error(`Card geometry collapsed for ${CW}x${CH}`)

  // 1. Skin background (fully opaque, exact canvas dims).
  const bgSvg = cardSkinBackgroundSvg(skin, CW, CH, input.brandAccent)
  if (!bgSvg) throw new Error(`Card skin failed for ${skin} ${CW}x${CH}`)
  const composites: { input: Buffer; left: number; top: number }[] = []
  const basePng = await renderSVG(bgSvg, CW)

  // 2. Rank numeral (BEHIND the card, per the classic reference). Rank 1
  // keeps the verbatim reference size/anchor (historical gutter anchor; any
  // natural overlap behind the card is the classic cover.js design,
  // reported). Singles 2..9 use the enlarged size at the same anchor.
  // Doubles keep the enlarged reference double size/anchor/
  // baseline and condense horizontally at full height (P9); the measured
  // core-shift placement proves two ordered digits with the first fully
  // before the card edge. Never shrunk, never clipped.
  if (rank !== null && geo.numeral) {
    if (geo.numeral.digitCount === 1) {
      // Ring glyph (P16 shared contour pipeline) at the reference gutter
      // anchor: measured placement proves the core inside the canvas; the
      // anchor is never shifted to force an overlap. The card is
      // composited AFTER the numeral, so crossed ink hides behind the
      // artwork (layer order, never a cropped viewport).
      const placed = await placeSingleNumeral(
        rank,
        geo.numeral.anchorX,
        geo.numeral.baselineY,
        geo.numeral.fontSize,
        geo.numeral.letterSpacing,
        geo.numeral.strokeWidth,
        skin,
        input.brandAccent,
        geo.card.x,
        CW,
        CH,
      )
      if (placed) composites.push({ input: placed.png, left: placed.left, top: placed.top })
    } else {
      const placed = await placeDoubleNumeral(
        rank,
        geo.numeral.anchorX,
        geo.numeral.baselineY,
        geo.numeral.fontSize,
        geo.numeral.letterSpacing,
        geo.numeral.strokeWidth,
        geo.numeral.condenseX,
        skin,
        input.brandAccent,
        geo.card.x,
        CW,
        CH,
      )
      if (placed) composites.push({ input: placed.png, left: placed.left, top: placed.top })
    }
  }

  // 3. Card shadow + rounded artwork card (cover-fit + mask).
  const shadow = await cardShadowLayer(geo.card.width, geo.card.height, geo.card.radius)
  const shadowPlaced = await placeInCanvas(
    shadow.png, shadow.w, shadow.h,
    geo.card.x - shadow.pad, geo.card.y - shadow.pad, CW, CH,
  )
  if (shadowPlaced) composites.push({ input: shadowPlaced.png, left: shadowPlaced.left, top: shadowPlaced.top })
  const cardPng = await roundedArtworkCard(artwork, geo.card.width, geo.card.height, geo.card.radius)
  const cardPlaced = await placeInCanvas(
    cardPng, geo.card.width, geo.card.height, geo.card.x, geo.card.y, CW, CH,
  )
  if (cardPlaced) composites.push({ input: cardPlaced.png, left: cardPlaced.left, top: cardPlaced.top })

  // 4. Title logo (P14): the ORIGINAL resolved buffer fits ONCE
  // (shrink-only contain, aspect preserved, never cropped, never enlarged)
  // into the enlarged bottom-center slot. The user scale resizes the SLOT
  // caps (same Fresh single-fit pattern: neutral 100 = base slot), so every
  // scale level renders a different size instead of inheriting one
  // pre-downscaled Standard bitmap. Placement centers the ACTUAL visible ink
  // (measured alpha bounds, not the transparent bitmap padding) on the card
  // center, with the bottom visual padding applied to the ink bottom — never
  // whitespace-as-logo: a fully transparent bitmap is omitted. The fitted
  // layer always stays fully inside the card (never over the rank gutter,
  // which is left of the card by construction).
  const titleFit = await (async () => {
    const src = input.titleLogo
    if (!src || src.length === 0) return null
    let sw = 0
    let sh = 0
    try {
      const meta = await sharp(src).metadata()
      sw = meta.width ?? 0
      sh = meta.height ?? 0
    } catch {
      return null
    }
    if (sw <= 0 || sh <= 0) return null
    const scaleEff = resolveCardTitleScale(input.logoScale)
    const effMaxW = Math.max(1, Math.min(geo.card.width, Math.round((geo.titleLogo.maxWidth * scaleEff) / 100)))
    const effMaxH = Math.max(1, Math.min(geo.card.height, Math.round((geo.titleLogo.maxHeight * scaleEff) / 100)))
    const fitted = await fitLogoContain(src, effMaxW, effMaxH)
    if (!fitted) return null
    const ink = await measureAlphaInk(fitted.png, 10)
    if (!ink) return null
    // Trim the transparent padding to the measured ink (never
    // whitespace-as-logo): the bitmap bottom IS the ink bottom, so the
    // bottom visual padding below lands exactly and the inside-card clamp
    // below never fights the padding (which would push the mark up).
    const trimW = ink.maxX - ink.minX + 1
    const trimH = ink.maxY - ink.minY + 1
    let trimmed: Buffer
    try {
      trimmed = await sharp(fitted.png)
        .extract({ left: ink.minX, top: ink.minY, width: trimW, height: trimH })
        .png()
        .toBuffer()
    } catch {
      return null
    }
    const cardCx = geo.card.x + geo.card.width / 2
    const cardBottom = geo.card.y + geo.card.height
    const lx = clampInt(Math.round(cardCx - trimW / 2), geo.card.x, geo.card.x + geo.card.width - trimW)
    const ly = clampInt(cardBottom - geo.titleLogo.insetBottom - trimH, geo.card.y, geo.card.y + geo.card.height - trimH)
    return { fitted: { png: trimmed, w: trimW, h: trimH }, lx, ly }
  })()
  if (titleFit) {
    const logoPlaced = await placeInCanvas(titleFit.fitted.png, titleFit.fitted.w, titleFit.fitted.h, titleFit.lx, titleFit.ly, CW, CH)
    if (logoPlaced) composites.push({ input: logoPlaced.png, left: logoPlaced.left, top: logoPlaced.top })
  }

  // 5. Provider mark (P14): the already-resolved brand bitmap fits ONCE
  // (contain, aspect preserved, never cropped) into the enlarged left-column
  // slot. The user `netscale` resizes the SLOT caps (neutral 100 = base
  // slot); the fit MAY upscale up to the slot (bounded, never past it) so
  // the mark renders visibly larger than the small baseline instead of being
  // pinned at its area-normalized raster size. P17: the mark sits slightly
  // inward (`placeCardProviderMark`) so its real ink clears the decorative
  // frame, still below the rank, at the full P14 size; it may cross the
  // card's left edge only in the strictly below-card zone (never through
  // art). Position never depends on badge state (no jump).
  const providerFit = await (async () => {
    const src = input.providerLogo
    if (!src || src.length === 0) return null
    const scaleEff = resolveCardProviderScale(input.providerScale)
    const effMaxW = Math.max(
      1,
      Math.min(geo.rankSlotWidth, Math.round((geo.provider.maxWidth * scaleEff) / 100)),
    )
    const effMaxH = Math.max(1, Math.round((geo.provider.maxHeight * scaleEff) / 100))
    const fitted = await fitCardProviderContain(src, effMaxW, effMaxH)
    if (!fitted) return null
    const py = clampInt(geo.provider.centerY - fitted.h / 2, 0, Math.max(0, CH - fitted.h))
    const cardBottom = geo.card.y + geo.card.height
    const px = placeCardProviderMark(geo.provider.centerX, fitted.w, CW, CH, skin, geo.card.x, py, cardBottom)
    return { fitted, px, py }
  })()
  if (providerFit) {
    const provPlaced = await placeInCanvas(providerFit.fitted.png, providerFit.fitted.w, providerFit.fitted.h, providerFit.px, providerFit.py, CW, CH)
    if (provPlaced) composites.push({ input: provPlaced.png, left: provPlaced.left, top: provPlaced.top })
  }

  // 6. Metadata below the card inside the bounded band (never onto the
  // card, never under the provider): pre-rendered overlay wins (contain on
  // BOTH axes, centered), else the resolved-values grid. Invalid overlays
  // are omitted without error, per the missing-metadata degrade contract.
  // P14: the band starts right of the ACTUAL fitted provider mark (not just
  // the base footprint), so an enlarged `netscale` mark never overlaps the
  // text. A collapsed remainder omits the block without error.
  let band = cardMetadataBand(CW, CH, geo)
  if (band && providerFit) {
    const needX0 = providerFit.px + providerFit.fitted.w + META_PROVIDER_GAP
    if (needX0 > band.x0) {
      const w = band.x1 - needX0
      band = w >= 24 && band.h >= 12 ? { ...band, x0: needX0, w } : null
    }
  }
  if (band) {
    const ov = input.metadataOverlay
    let overlayDone = false
    if (ov && Buffer.isBuffer(ov.png) && ov.png.length > 0) {
      let ow = Math.round(ov.w)
      let oh = Math.round(ov.h)
      let decodable = ow > 0 && oh > 0
      try {
        const meta = await sharp(ov.png).metadata()
        const mw = meta.width ?? 0
        const mh = meta.height ?? 0
        if (mw <= 0 || mh <= 0) {
          decodable = false
        } else {
          if (!(ow > 0 && oh > 0)) {
            ow = mw
            oh = mh
          }
        }
      } catch {
        decodable = false
      }
      if (decodable && ow > 0 && oh > 0) {
        const scale = Math.min(1, band.w / ow, band.h / oh)
        const dw = Math.max(1, Math.floor(ow * scale))
        const dh = Math.max(1, Math.floor((oh * dw) / Math.max(1, ow)))
        if (dw <= band.w && dh <= band.h) {
          try {
            const png =
              dw === ow && dh === oh
                ? ov.png
                : await sharp(ov.png).resize(dw, dh, { fit: "inside" }).png().toBuffer()
            const ox = band.x0 + Math.floor((band.w - dw) / 2)
            const oy = band.y0 + Math.floor((band.h - dh) / 2)
            const metaPlaced = await placeInCanvas(png, dw, dh, ox, oy, CW, CH)
            if (metaPlaced) {
              composites.push({ input: metaPlaced.png, left: metaPlaced.left, top: metaPlaced.top })
              overlayDone = true
            }
          } catch {
            // Unreadable overlay raster: fall through to values below.
          }
        } else {
          // Overlay cannot fit the band even contained: omit it, but still
          // degrade to the resolved values below (never a silent total loss
          // when values exist).
          overlayDone = false
        }
      }
      // A present-but-undecodable overlay buffer is treated as absent and
      // falls through to the resolved-values grid (missing-metadata
      // degrade), never a throw. overlayDone stays false on that path.
    }
    if (!overlayDone) {
      const lines = cardMetadataLines(input)
      if (lines.length > 0) {
        const meta = cardMetadataSvg(lines, band.w, band.h, cardMetadataFontSize(CW))
        if (meta) {
          const metaPng = await renderSVG(meta.svg, meta.w)
          const ox = band.x0 + Math.floor((band.w - meta.w) / 2)
          const oy = band.y0 + Math.floor((band.h - meta.h) / 2)
          const metaPlaced = await placeInCanvas(metaPng, meta.w, meta.h, ox, oy, CW, CH)
          if (metaPlaced) composites.push({ input: metaPlaced.png, left: metaPlaced.left, top: metaPlaced.top })
        }
      }
    }
  }

  return sharp(basePng)
    .resize(CW, CH, { fit: "fill" })
    .ensureAlpha()
    .composite(composites)
    .png()
    .toBuffer()
}
