import { normalizeExtraBadgeStyleForRender, type BadgeStyle, type RankingBadgeStyle, type ExtraBadgeStyle, type ExtraBadgeFollowRank } from "./badge-styles"

// Ancoraggio destro landscape (rightPadX in scala + shift ottico verso il
// bordo, clamp anti-overflow). UNICA definizione: il ramo genere la riusa con
// extra = gox − sepCenterShift − styleCornerShiftX e shift default 40 (resa
// byte-identica al legacy); le pills landscape passano opticalShift = 0
// (margine interno pieno 18*CW/380, niente gox/goy né compensazioni
// ★/stile-specifiche — solo geometria base).
export function landscapeRightAnchorLeft(contentW: number, CW: number, extra = 0, opticalShift = 40): number {
  const rightPadX = Math.round(18 * CW / 380)
  return Math.min(CW - contentW, Math.max(0, CW - contentW - rightPadX + opticalShift + extra))
}

// ---------------------------------------------------------------------------
// Corner rank layout helpers (pure, unit-tested). Corner-style only.
// ---------------------------------------------------------------------------

export interface CornerRankRect {
  readonly left: number
  readonly top: number
  readonly w: number
  readonly h: number
}

/**
 * Styles anchored to the top corner like `corner` (flat pill): `number`
 * shares the same anchor, gap, Coming Soon stacking and network/quality
 * collision handling — only the bitmap differs (bare numeral, no plate).
 */
export function isCornerAnchoredStyle(v: string | null | undefined): boolean {
  return v === "corner" || v === "number"
}

/**
 * Effective top-badge style for builders, placement, collisions and cache:
 * rank badges always use `rankingBadgeStyle`; extra badges use the standalone
 * `extraBadgeStyle` when set, else the legacy `rankingBadgeStyle` fallback
 * (absent everywhere = byte-identical legacy render).
 */
export function resolveTopBadgeStyle(params: {
  readonly topBadgeType: "rank" | "extra" | null | undefined
  readonly rankingBadgeStyle: RankingBadgeStyle
  readonly extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | string | null
}): RankingBadgeStyle {
  if (params.topBadgeType === "extra") return normalizeExtraBadgeStyleForRender(params.extraBadgeStyle) ?? params.rankingBadgeStyle
  return params.rankingBadgeStyle
}

/**
 * Whether a genre badge style actually paints the accent color. `colored`
 * fills with the accent and `ink` paints its glyphs with the accent gradient
 * (`buildHouseGenreSvg` / `buildGenreInkSvg`); every other style
 * (shadow/pill/bar/minimal/vetro/bordo) ignores it, so those styles must
 * neither trigger scene-tint extraction / band sampling nor carry the
 * adaptive tint in their badge cache key.
 */
export function genreBadgeConsumesAccent(style: BadgeStyle | string | null | undefined): boolean {
  return style === "colored" || style === "ink"
}

/**
 * Whether the effective top badge actually paints the accent. Mirrors the
 * render call sites below (`renderExtraBadge` / `renderRankingBadge`):
 * - `colored` always paints (ribbon, or the degraded default via accentFill);
 * - `corner` always paints the flat accent pill (rank and extra);
 * - `split` paints only for rank badges (accent numeral cell); extras never
 *   reach it (ranking-only: the legacy `rs` fallback degrades to the default
 *   plate), so they never sample the tint for nothing;
 * - `number` paints only for extra badges (degraded to the corner pill);
 *   rank numerals are bare digits and ignore the accent;
 * - `default` paints only with `accentFill` (colored degraded by ribbon off);
 * - every other style (pill/bordo/vetro/netflix/netflix-color) ignores it.
 * The extra `follow-rank`/absent sentinel resolves through the same legacy
 * `rs` fallback as the renderer, so the gate never invents a new path.
 */
export function topBadgeConsumesAccent(params: {
  readonly topBadgeType: "rank" | "extra" | null | undefined
  readonly rankingBadgeStyle: RankingBadgeStyle
  readonly extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | string | null
  readonly rankingBadgeAccent?: boolean
}): boolean {
  const { topBadgeType, rankingBadgeStyle, rankingBadgeAccent } = params
  const eff: string = topBadgeType === "extra"
    ? (normalizeExtraBadgeStyleForRender(params.extraBadgeStyle) ?? (rankingBadgeAccent ? "colored" : rankingBadgeStyle))
    : rankingBadgeStyle
  if (eff === "colored" || eff === "corner") return true
  if (eff === "split") return topBadgeType === "rank"
  if (eff === "number") return topBadgeType === "extra"
  if (eff === "default") return topBadgeType === "rank" && rankingBadgeAccent === true
  return false
}

/**
 * Top offset for a `corner` rank pill: stacked below a left Coming Soon
 * ribbon sharing its corner, else the fixed top gap. The ribbon itself
 * is never moved.
 */
export function cornerRankTop(params: {
  comingSoonLeft: boolean
  ribbonExtent: number
  gap: number
  pillTopGap: number
}): number {
  if (params.comingSoonLeft) return params.ribbonExtent + params.gap
  return params.pillTopGap
}

/**
 * Left anchor for a corner-anchored top badge (`corner` or `number`): the
 * historic top-left box margin (`netPadX`), mirrored to the top-right
 * corner when `mirrorRight` (only `number` with `side="right"` mirrors;
 * `corner` always passes false). Exact historic margins — no drift.
 */
export function cornerAnchoredLeft(params: {
  readonly canvasW: number
  readonly badgeW: number
  readonly mirrorRight: boolean
  readonly offsetX: number
}): number {
  if (params.mirrorRight) return Math.round(params.canvasW - params.badgeW - 18 * params.canvasW / 380) + params.offsetX
  return Math.round(18 * params.canvasW / 380) + params.offsetX
}

/**
 * Whether a `number`-style numeral occupies the top-right corner (mirrored
 * with `side="right"`): trailing badges (quality pill, separate stack) move
 * to the left corner like with a right ribbon instead of shrinking in place
 * against the bare digits. Left-anchored numerals need nothing (quality sits
 * in the opposite corner). Other styles never match.
 */
export function isNumberRightCorner(params: {
  readonly rankingBadgeStyle: string | null | undefined
  readonly ribbonSide: string | null | undefined
  readonly hasTopBadge: boolean
}): boolean {
  return params.rankingBadgeStyle === "number" && params.ribbonSide === "right" && params.hasTopBadge
}

/**
 * Single composition behind both right-corner checks (quality pill at 2253
 * and separate stack at 2357): the `number` test runs on the effective
 * top-badge style, so an explicit extra style can never split quality left
 * and stack right. Rank numerals keep the legacy behavior.
 */
export function isTopBadgeNumberRightCorner(params: {
  readonly topBadgeType: "rank" | "extra" | null | undefined
  readonly rankingBadgeStyle: RankingBadgeStyle
  readonly extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | string | null
  readonly ribbonSide: string | null | undefined
  readonly hasTopBadge: boolean
}): boolean {
  return isNumberRightCorner({
    rankingBadgeStyle: resolveTopBadgeStyle({
      topBadgeType: params.topBadgeType,
      rankingBadgeStyle: params.rankingBadgeStyle,
      extraBadgeStyle: params.extraBadgeStyle,
    }),
    ribbonSide: params.ribbonSide,
    hasTopBadge: params.hasTopBadge,
  })
}

/**
 * Whether a `number`-style numeral shares its corner with the Coming Soon
 * ribbon and must stack below it. The numeral mirrors with `side="right"`,
 * so unlike the historic left-only corner rule the shared corner is
 * whichever side the numeral sits on: overlap is tested against the real
 * boxes (Coming Soon composite rect + numeral rect at its unstacked
 * candidate top), so explicit tox/toy that move the numeral away don't
 * force a useless stack. Corner keeps its historic rule (never calls this).
 */
export function numberSharesComingSoonCorner(params: {
  readonly canvasW: number
  readonly hasTopBadge: boolean
  readonly showComingSoon: boolean
  readonly ribbonSide: string | null | undefined
  /** Fitted Coming Soon bitmap width; null when no ribbon is rendered. */
  readonly ribbonW: number | null
  /** Negative composite offset of the Coming Soon layer (`ribbonLayout.offset`). */
  readonly ribbonOffset: number | null
  /** Visible extent of the ribbon from the corner (`ribbonLayout.extent`). */
  readonly ribbonExtent: number | null
  /** Numeral rect at its unstacked candidate top (final left incl. tox). */
  readonly numLeft: number
  readonly numTop: number
  readonly numW: number
  readonly numH: number
}): boolean {
  if (!params.hasTopBadge || !params.showComingSoon) return false
  if (params.ribbonW == null || params.ribbonOffset == null || params.ribbonExtent == null) return false
  const csLeft = params.ribbonSide === "right"
    ? Math.round(params.canvasW - params.ribbonW + params.ribbonOffset)
    : -params.ribbonOffset
  const overlapX = params.numLeft < csLeft + params.ribbonW && params.numLeft + params.numW > csLeft
  const overlapY = params.numTop < params.ribbonExtent && params.numTop + params.numH > 0
  return overlapX && overlapY
}

/**
 * Geometria network effettivamente composta (final composite, shift e offset
 * inclusi) oppure assenza. Unica fonte per il freeze senza salto: il client
 * non duplica mai il layout network.
 */
export interface NetworkGeometry {
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
  /**
   * Dimensioni nominali pre-shrink (stessa scala, prima dell'anti-overlap):
   * uguali a w/h senza shrink. Servono al freeze dopo shrink — la UI
   * ricalibra la scala effettiva come actual/nominal (ancora top-left).
   */
  readonly nominalW: number
  readonly nominalH: number
  /** false = posizione assoluta congelata; true = layout storico che segue il titolo. */
  readonly followTitle: boolean
}

/**
 * Badge families whose FINAL composed box this renderer can report.
 *
 * `rank`/`extra` are the two independent top-slot profiles (with ranking vs
 * fallback): the report names the one actually painted (`kind`), never the
 * mere availability of ranking data. Every other family is reported from the
 * box the ACTIVE whole-poster layout actually composed (Standard, Fresh and
 * Card), so the editor never guesses an anchor. `genre` is the combined
 * genre/rating/year family in Standard and the equivalent meta block or Card
 * band; `logo` is the title logo in every layout.
 */
export type BadgeGeometryFamily = "rank" | "extra" | "genre" | "quality" | "separate" | "network" | "logo"

/** Whole-poster geometry layout actually displayed. */
export type BadgeGeometryLayout = "ranked" | "fallback"

/** Visible body box (px) in the canvas actually rendered. */
export interface BadgeGeometryBox {
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
}

export interface BadgeGeometryReport {
  readonly canvasW: number
  readonly canvasH: number
  /**
   * Whole-poster layout actually displayed: `ranked` when a ranking
   * badge/numeral is painted, `fallback` for the without-ranking composition.
   * Drives profile-aware reset (never inferred from ranking data).
   */
  readonly layout: BadgeGeometryLayout
  /** Top slot actually painted (null = no top badge / Coming Soon ribbon). */
  readonly kind: "rank" | "extra" | null
  readonly families: Partial<Record<BadgeGeometryFamily, BadgeGeometryBox>>
  /**
   * Families whose X offset is IGNORED by this render (anchored/full-width
   * styles, e.g. the full-width genre bar): a drag handle on X would move
   * nothing, so the UI must lock it instead of promising movement.
   */
  readonly fixedX: Partial<Record<BadgeGeometryFamily, boolean>>
  /**
   * Authoritative box of every SEPARATELY composited badge item (one rating
   * pill, one quality/AV mark), by stable identity. Empty when the active
   * layout bakes them into a single ositive block (Fresh/Card meta rows).
   */
  readonly items: readonly BadgeGeometryItem[]
}

/** One independently movable badge item with its final composed box. */
export interface BadgeGeometryItem {
  /** Stable identity (`badge-item-transforms`), never an array index. */
  readonly id: string
  /** Family that owns the item (see the module contract). */
  readonly family: "quality" | "separate"
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
  /** True when a per-item correction is applied (detached layer). */
  readonly custom: boolean
  /**
   * True for an EMPTY target: box only, nothing is painted there. It is an
   * empty quality HOME (`quality:home:<kind>`) or an empty separate-rating
   * SLOT (`rating:slot:<n>`). The settings preview draws it as a draggable
   * dashed ghost; it is reported only when the diagnostic preview asks for it
   * (`?ghosts=1`), never on the Stremio render path.
   */
  readonly ghost?: boolean
}

/**
 * Editorial nudge applied to every network pill at composite time
 * (`top + NETWORK_LOGO_SHIFT_Y`): global tuning, not a user offset.
 * Anchor math must subtract it so the on-poster gap stays exact.
 */
export const NETWORK_LOGO_SHIFT_Y = 10

export interface CornerNetworkAboveTitleInput {
  readonly logoTop: number
  readonly logoLeft: number
  readonly logoW: number
  readonly netW: number
  readonly netH: number
  readonly gap: number
  /**
   * Visible Y shift applied at composite time (defaults to
   * NETWORK_LOGO_SHIFT_Y): subtracted here so the on-poster gap stays `gap`.
   */
  readonly visibleShiftY?: number
}

/**
 * Anchor for a `corner`-style network pill above the title logo (landscape
 * default): same formula as the portrait branch (`logoTop - netH - gap`),
 * corrected for the visible shift and centered on the title bounding box in
 * every layout — centered, Cinematic Left or explicitly shifted titles all
 * share the title center (`logoLeft + (logoW - netW) / 2`). Null when there
 * is no room above the title — callers fall back to the historic top-left
 * anchor. Never moves the title. Rank and extra alike: only the corner
 * anchor matters, never the badge kind.
 */
export function cornerNetworkAboveTitle(
  input: CornerNetworkAboveTitleInput,
): { top: number; left: number } | null {
  const shift = input.visibleShiftY ?? NETWORK_LOGO_SHIFT_Y
  const top = input.logoTop - input.netH - input.gap - shift
  if (top < 0) return null
  const left = Math.round(input.logoLeft + (input.logoW - input.netW) / 2)
  return { top, left }
}

/**
 * Top coordinate stacking the network logo below a `corner` top pill when
 * its anchored box overlaps the pill; null when there is no collision (or
 * when there is no corner top badge). Corner-style only — every other
 * style keeps its own placement, and shrinking alone is not enough once
 * the logo dwarfs to its floor while staying in place.
 */
export function stackNetworkBelowCornerRank(params: {
  rankingBadgeStyle: string | null | undefined
  hasTopBadge: boolean
  rank: CornerRankRect | null
  netLeft: number
  netTop: number
  netW: number
  netH: number
  gap: number
}): number | null {
  if (!isCornerAnchoredStyle(params.rankingBadgeStyle) || !params.hasTopBadge || !params.rank) return null
  const rankR = params.rank.left + params.rank.w
  const rankB = params.rank.top + params.rank.h
  const netR = params.netLeft + params.netW
  const netB = params.netTop + params.netH
  const overlapX = params.netLeft < rankR + 6 && netR > params.rank.left - 6
  const overlapY = params.netTop < rankB + 4 && netB > params.rank.top - 4
  if (overlapX && overlapY) return rankB + params.gap
  return null
}
