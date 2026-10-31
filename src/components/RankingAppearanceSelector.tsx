"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import type { ExtraBadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"
import { buildHouseRankingSvg } from "@/lib/badge-svg-shared"
import { LayoutThumb } from "@/components/PosterLayoutSelector"
import { isCardSkin, type CardSkin } from "@/lib/card-layout-skins"

export type RankingAppearance = "nastro" | "numero" | "badge"

/** Settings-only unified choice (Classifiche): classic looks + Fresh/Card over existing fields. */
export type RankingPresentation = RankingAppearance | "fresh" | "card"

/** Badge variants for the Badge appearance (`standard` = centered default plate). */
export const RANK_BADGE_VARIANTS = ["pill", "colored", "bordo", "vetro", "corner", "standard", "split"] as const
export type RankBadgeVariant = (typeof RANK_BADGE_VARIANTS)[number]

/**
 * Read mapping (effective rendering, mirrors `isRibbonRankingStyle` +
 * the `default` auto-detect in poster-config): ribbon styles
 * (`netflix`/`netflix-color`/`colored`) render NASTRO with the ribbon on
 * and collapse centered with it off; legacy `default` + ribbon reads Nastro
 * (auto-detect when ranked), without ribbon it reads Badge. Pure read —
 * never writes.
 */
export function resolveRankingAppearance(args: {
  rankingBadgeStyle: RankingBadgeStyle | string | null | undefined
  ribbonEnabled: boolean | null | undefined
}): RankingAppearance {
  const rs = args.rankingBadgeStyle
  if (rs === "number") return "numero"
  if (rs === "netflix" || rs === "netflix-color" || rs === "colored") return args.ribbonEnabled ? "nastro" : "badge"
  if (rs === "default" || rs == null) return args.ribbonEnabled ? "nastro" : "badge"
  return "badge"
}

/**
 * Read mapping for the Badge variant row: explicit centered styles read
 * themselves; anything ribbon-shaped or legacy `default` reads `standard`
 * (the centered default plate) so a legacy default never shows a false
 * selected pill. Pure read — never writes.
 */
export function resolveRankVariant(rs: string | null | undefined): RankBadgeVariant {
  if (rs === "pill" || rs === "colored" || rs === "bordo" || rs === "vetro" || rs === "corner" || rs === "split") return rs
  return "standard"
}

export interface RankingAppearanceValue {
  rankingBadgeStyle: RankingBadgeStyle
  ribbonEnabled: boolean
}

/** Nastro sub-variants (`standard` = satin ribbon, `colored` = accent ribbon). */
export const RANK_RIBBON_VARIANTS = ["standard", "colored"] as const
export type RankRibbonVariant = (typeof RANK_RIBBON_VARIANTS)[number]

/**
 * Read mapping for the Nastro sub-row: explicit `colored` reads Colorato,
 * everything else ribbon-shaped or legacy (`netflix`, legacy `netflix-color`,
 * legacy `default`, null) reads Standard. Evidence: the builder renders
 * `colored` as the accent NASTRO and `netflix` as the satin Nastro, while
 * legacy `netflix-color` has no ribbon branch in the builder (it falls
 * through to the centered default plate) — so it is kept without migration:
 * Standard checked, stored value untouched. Pure read — never writes.
 */
export function resolveRibbonVariant(rs: string | null | undefined): RankRibbonVariant {
  if (rs === "colored") return "colored"
  return "standard"
}

export interface RibbonVariantValue {
  rankingBadgeStyle: RankingBadgeStyle
  ribbonEnabled: boolean
}

/** Canonical Nastro writes: Standard rs=netflix, Colorato rs=colored, always ribbon on. */
export function ribbonVariantValue(variant: RankRibbonVariant): RibbonVariantValue {
  if (variant === "colored") return { rankingBadgeStyle: "colored", ribbonEnabled: true }
  return { rankingBadgeStyle: "netflix", ribbonEnabled: true }
}

/** Canonical writes: Nastro rs=netflix, Numero rs=number, Badge rs=pill, always ribbon on. */
export function rankingAppearanceValue(appearance: RankingAppearance): RankingAppearanceValue {
  if (appearance === "nastro") return { rankingBadgeStyle: "netflix", ribbonEnabled: true }
  if (appearance === "numero") return { rankingBadgeStyle: "number", ribbonEnabled: true }
  return { rankingBadgeStyle: "pill", ribbonEnabled: true }
}

export interface RankVariantValue {
  rankingBadgeStyle: RankingBadgeStyle
  ribbonEnabled: boolean
}

/**
 * Canonical variant writes (renderer truth): `colored` as a Badge must
 * switch the ribbon off (colored + ribbon on renders NASTRO, not a badge);
 * `standard` is the centered default plate (default + ribbon off, otherwise
 * the auto-detect would raise the Nastro when ranked). Centered opaque
 * variants keep the ribbon on — it never alters their pixels.
 */
export function rankVariantValue(variant: RankBadgeVariant): RankVariantValue {
  if (variant === "colored") return { rankingBadgeStyle: "colored", ribbonEnabled: false }
  if (variant === "standard") return { rankingBadgeStyle: "default", ribbonEnabled: false }
  return { rankingBadgeStyle: variant, ribbonEnabled: true }
}

/**
 * Legacy effective extra look mapped to an explicit `xbs` (bitmap-equivalent):
 * standalone numerals degrade to the corner pill, ribbon styles to the
 * default plate — same pixels the extra badge already renders today.
 */
export function legacyExtraStyleForRank(rs: string | null | undefined): ExtraBadgeStyle {
  if (rs === "corner" || rs === "number") return "corner"
  if (rs === "pill" || rs === "colored" || rs === "bordo" || rs === "vetro") return rs
  return "default"
}

const APPEARANCE_LABELS = { nastro: "ui.ribbon", numero: "ui.number", badge: "ui.badgeSection" } as const
/** Settings-only unified primary choices: classic looks + Fresh/Card (existing brief labels). */
const PRESENTATION_LABELS: Record<RankingPresentation, string> = {
  nastro: "ui.ribbon",
  numero: "ui.number",
  badge: "ui.badgeSection",
  fresh: "ui.posterLayoutGroupedFresh",
  card: "ui.posterLayoutGroupedCard",
}
/** Card skin subgroup (settings-only, shown only when Card is selected). */
const CARD_SKIN_LABELS: Record<CardSkin, string> = {
  "provider-glass": "ui.posterLayoutSkinProvider",
  nuvio: "ui.posterLayoutSkinBlack",
  stremio: "ui.posterLayoutSkinViolet",
}
const CARD_SKINS: readonly CardSkin[] = ["provider-glass", "nuvio", "stremio"]
const RIBBON_VARIANT_LABELS: Record<RankRibbonVariant, string> = {
  standard: "ui.qbsStandard",
  colored: "ui.colored",
}
const VARIANT_LABELS: Record<RankBadgeVariant, string> = {
  pill: "ui.pill",
  colored: "ui.colored",
  bordo: "ui.bordo",
  vetro: "ui.vetro",
  corner: "ui.corner",
  standard: "ui.qbsStandard",
  split: "ui.split",
}

/** Demo accent for the mini previews (same fallback as the badge style selector). */
const RANK_SWATCH_ACCENT = "#fb923c"
/** Poster reference grid the ranking recipes are authored on (380 portrait). */
const RANK_SWATCH_PW = 380

/** Variant rows → the exact renderer input pair (`style` + ribbon flag). */
const BADGE_VARIANT_SWATCH: Record<RankBadgeVariant, { style: RankingBadgeStyle; ribbon: boolean }> = {
  // `colored` as a Badge turns the ribbon OFF (with it on the renderer paints
  // the NASTRO) — same canonical pair `rankVariantValue` writes.
  colored: { style: "colored", ribbon: false },
  pill: { style: "pill", ribbon: true },
  bordo: { style: "bordo", ribbon: true },
  vetro: { style: "vetro", ribbon: true },
  corner: { style: "corner", ribbon: true },
  standard: { style: "default", ribbon: false },
  split: { style: "split", ribbon: true },
}
/** Ribbon rows → the same canonical pairs `ribbonVariantValue` writes. */
const RIBBON_VARIANT_SWATCH: Record<RankRibbonVariant, { style: RankingBadgeStyle; ribbon: boolean }> = {
  standard: { style: "netflix", ribbon: true },
  colored: { style: "colored", ribbon: true },
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Mini preview of one rank look. Uses the SAME shared builder the poster
 * renderer dispatches through (`buildHouseRankingSvg`, called by
 * `buildRankingBadgeSVG` in svg-badge.ts): identical recipes (default plate,
 * pill, colored, bordo, vetro, corner, split, ribbon), never a second
 * renderer. Rendered at the 380 poster-reference width with the base rank
 * font, so the thumbnail is the real geometry scaled down.
 */
function RankSwatch({
  style,
  ribbon,
  label,
}: {
  style: RankingBadgeStyle
  ribbon: boolean
  label: string
}) {
  const { svg } = buildHouseRankingSvg({
    rank: 1,
    label,
    pw: RANK_SWATCH_PW,
    style,
    ribbon,
    accentColor: RANK_SWATCH_ACCENT,
  })
  return (
    <span className="badge-style-preview inline-flex items-center justify-center rounded-md bg-transparent">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG del builder condiviso (singola fonte col renderer) */}
      <img src={svgDataUri(svg)} alt="" className="w-8 h-4 object-contain" />
    </span>
  )
}

/**
 * Single rank-appearance control (Nastro/Numero/Badge + variants + side).
 * `side`/`onSide` are optional: omit them where the side is not persistable
 * (per-title editing — side stays global) and the side row stays hidden.
 * Defaults panels keep passing both.
 *
 * Optional unified presentation: `presentation` + `onPresentation` render one
 * exclusive 5-choice group; absent = legacy 3-choice behavior.
 */
export function RankingAppearanceSelector({
  appearance,
  variant,
  ribbonVariant,
  side,
  onAppearance,
  onVariant,
  onRibbonVariant,
  onSide,
  presentation,
  onPresentation,
  cardSkin,
  onCardSkin,
}: {
  appearance: RankingAppearance
  variant: RankBadgeVariant
  ribbonVariant: RankRibbonVariant
  side?: "left" | "right"
  onAppearance: (a: RankingAppearance) => void
  onVariant: (v: RankBadgeVariant) => void
  onRibbonVariant: (v: RankRibbonVariant) => void
  onSide?: (s: "left" | "right") => void
  presentation?: RankingPresentation
  onPresentation?: (p: RankingPresentation) => void
  cardSkin?: CardSkin | string | null | undefined
  onCardSkin?: (s: CardSkin) => void
}) {
  const { t } = useT()
  const unified = onPresentation !== undefined && presentation !== undefined
  // Variant/side rows follow the effective look (presentation when unified).
  const look: RankingAppearance | "fresh" | "card" = unified ? presentation : appearance
  const primary = (unified ? PRESENTATION_LABELS : APPEARANCE_LABELS) as Record<string, string>
  const onPrimary = (a: string) => {
    if (unified) onPresentation(a as RankingPresentation)
    else onAppearance(a as RankingAppearance)
  }
  // Card primary thumbnail mirrors the remembered/effective skin (transient
  // UI cue only, never a write): same `LayoutThumb` the skin row uses.
  const cardThumbSkin: CardSkin = isCardSkin(cardSkin) ? cardSkin : "provider-glass"
  return (
    <div className="space-y-1.5" {...(unified ? { "data-testid": "ranking-presentation" } : {})}>
      <div className="flex gap-1" role="radiogroup" aria-label={t("ui.rankFamily")}>
        {(Object.keys(primary) as (keyof typeof primary)[]).map((a) => {
          const checked = unified ? presentation === a : appearance === a
          // Classic families preview the canonical look the click stages
          // (`rankingAppearanceValue`), Fresh/Card reuse the shared layout
          // miniature. Decorative only: the accessible name stays the label.
          const canonical = a === "fresh" || a === "card" ? null : rankingAppearanceValue(a as RankingAppearance)
          return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onPrimary(a)}
            className={`flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
              checked
                ? "bg-white/20 text-white shadow-sm"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
            }`}
          >
            <span className="flex h-9 w-full items-center justify-center">
              {canonical ? (
                <RankSwatch
                  style={canonical.rankingBadgeStyle}
                  ribbon={canonical.ribbonEnabled}
                  label={t("badge.today")}
                />
              ) : (
                <LayoutThumb layout={a === "card" ? cardThumbSkin : "fresh"} />
              )}
            </span>
            <span className="leading-tight truncate max-w-full">{t(primary[a])}</span>
          </button>
          )
        })}
      </div>
      {look === "card" && onCardSkin && (
        <div
          className="grid grid-cols-3 gap-1"
          role="radiogroup"
          aria-label={t("ui.posterLayoutGroupedCard")}
          data-testid="poster-layout-skins"
        >
          {CARD_SKINS.map((skin) => (
            <button
              key={skin}
              type="button"
              role="radio"
              aria-checked={cardSkin === skin}
              onClick={() => onCardSkin(skin)}
              className={`flex flex-col gap-1 p-1.5 rounded-lg transition-all duration-150 cursor-pointer min-w-0 ${
                cardSkin === skin
                  ? "bg-white/20 text-white shadow-sm ring-1 ring-white/30"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              <LayoutThumb layout={skin} />
              <span className="text-[10px] font-semibold leading-tight text-center truncate">
                {t(CARD_SKIN_LABELS[skin])}
              </span>
            </button>
          ))}
        </div>
      )}
      {look === "nastro" && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("ui.ribbon")}>
          {RANK_RIBBON_VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={ribbonVariant === v}
              onClick={() => onRibbonVariant(v)}
              className={`flex flex-1 min-w-[56px] flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-lg text-[10px] font-semibold transition-all duration-150 cursor-pointer ${
                ribbonVariant === v
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              <RankSwatch {...RIBBON_VARIANT_SWATCH[v]} label={t("badge.today")} />
              <span className="leading-tight truncate max-w-full">{t(RIBBON_VARIANT_LABELS[v])}</span>
            </button>
          ))}
        </div>
      )}
      {look === "badge" && (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("ui.styleRankingDefault")}>
          {RANK_BADGE_VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={variant === v}
              onClick={() => onVariant(v)}
              className={`flex flex-1 min-w-[56px] flex-col items-center justify-center gap-0.5 py-1 px-1 rounded-lg text-[10px] font-semibold transition-all duration-150 cursor-pointer ${
                variant === v
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              <RankSwatch {...BADGE_VARIANT_SWATCH[v]} label={t("badge.today")} />
              <span className="leading-tight truncate max-w-full">{t(VARIANT_LABELS[v])}</span>
            </button>
          ))}
        </div>
      )}
      {(unified ? (look === "nastro" || look === "numero") : appearance !== "badge") && onSide && (
        <div className="flex items-center justify-between gap-3 pt-1 pl-5 animate-fade-in">
          <span className="text-zinc-400 font-medium text-[11px]">
            {t("ui.position")}
          </span>
          <div className="flex gap-1 flex-1 max-w-[160px]" role="radiogroup" aria-label={t("ui.position")}>
            {(["left", "right"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                onClick={() => onSide(s)}
                className={`flex-1 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
                  side === s
                    ? "bg-white/20 text-foreground shadow-sm"
                    : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                }`}
              >
                {s === "left" ? t("ui.sideLeft") : t("ui.sideRight")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
