"use client"

import { useT } from "@/lib/contexts/TranslationContext"
import type { ExtraBadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"

export type RankingAppearance = "nastro" | "numero" | "badge"

/** Badge variants for the Badge appearance (`standard` = centered default plate). */
export const RANK_BADGE_VARIANTS = ["pill", "colored", "bordo", "vetro", "corner", "standard"] as const
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
  if (rs === "pill" || rs === "colored" || rs === "bordo" || rs === "vetro" || rs === "corner") return rs
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
}

/**
 * Single rank-appearance control (Nastro/Numero/Badge + variants + side).
 * `side`/`onSide` are optional: omit them where the side is not persistable
 * (per-title editing — side stays global) and the side row stays hidden.
 * Defaults panels keep passing both.
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
}: {
  appearance: RankingAppearance
  variant: RankBadgeVariant
  ribbonVariant: RankRibbonVariant
  side?: "left" | "right"
  onAppearance: (a: RankingAppearance) => void
  onVariant: (v: RankBadgeVariant) => void
  onRibbonVariant: (v: RankRibbonVariant) => void
  onSide?: (s: "left" | "right") => void
}) {
  const { t } = useT()
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" role="radiogroup" aria-label={t("ui.rankFamily")}>
        {(Object.keys(APPEARANCE_LABELS) as RankingAppearance[]).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={appearance === a}
            onClick={() => onAppearance(a)}
            className={`flex-1 py-1 px-1 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer ${
              appearance === a
                ? "bg-white/20 text-white shadow-sm"
                : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
            }`}
          >
            {t(APPEARANCE_LABELS[a])}
          </button>
        ))}
      </div>
      {appearance === "nastro" && (
        <div className="flex gap-1" role="radiogroup" aria-label={t("ui.ribbon")}>
          {RANK_RIBBON_VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={ribbonVariant === v}
              onClick={() => onRibbonVariant(v)}
              className={`flex-1 py-1 px-1 rounded-lg text-[10px] font-semibold transition-all duration-150 cursor-pointer ${
                ribbonVariant === v
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              {t(RIBBON_VARIANT_LABELS[v])}
            </button>
          ))}
        </div>
      )}
      {appearance === "badge" && (
        <div className="flex gap-1" role="radiogroup" aria-label={t("ui.styleRankingDefault")}>
          {RANK_BADGE_VARIANTS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={variant === v}
              onClick={() => onVariant(v)}
              className={`flex-1 py-1 px-1 rounded-lg text-[10px] font-semibold transition-all duration-150 cursor-pointer ${
                variant === v
                  ? "bg-white/20 text-white shadow-sm"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
              }`}
            >
              {t(VARIANT_LABELS[v])}
            </button>
          ))}
        </div>
      )}
      {appearance !== "badge" && onSide && (
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
