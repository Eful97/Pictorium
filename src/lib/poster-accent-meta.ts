import type { BlurOverlay } from "./blur"
import type { BandMeanRGB } from "./poster-render-helpers"
import { isValidHex, BadgeRender } from "./poster-render-helpers"
import type { EffectiveAccentMeta } from "./effective-accent"

export interface AccentMetaArgs {
  readonly onAccentMeta: ((meta: EffectiveAccentMeta) => void) | null | undefined
  readonly finalRankBadge: BadgeRender | null
  readonly finalRankLeft: number | null
  readonly topBadge: { type: "extra"; label: string } | { type: "rank"; rank: number; label: string; ribbonLabel?: string } | null
  readonly showComingSoon: boolean
  readonly topPaintsAccent: boolean
  readonly isFresh: boolean
  readonly isCard: boolean
  readonly isExtraTopBadge: boolean
  readonly genrePaintsAccent: boolean
  readonly safeGenreBadgeResult: BadgeRender | null
  readonly cardGenrePaints: boolean
  readonly cardMainBadgeRendered: boolean
  readonly accentColorGenre: string
  readonly genreStdAccent: string
  readonly rankStdAccent: string
  readonly accentOverride: { genreColor: string; rankColor: string } | null
  readonly blurOverlay: BlurOverlay | null
  readonly tintStrength: number
  readonly blurTintHex: string
  readonly sceneTintHex: string | null
  readonly bottomBand: BandMeanRGB | null
  readonly topBand: BandMeanRGB | null
}

export function reportEffectiveAccentMeta({
  onAccentMeta, finalRankBadge, finalRankLeft, topBadge, showComingSoon, topPaintsAccent, isFresh, isCard, isExtraTopBadge, genrePaintsAccent, safeGenreBadgeResult, cardGenrePaints, cardMainBadgeRendered, accentColorGenre, genreStdAccent, rankStdAccent, accentOverride, blurOverlay, tintStrength, blurTintHex, sceneTintHex, bottomBand, topBand,
}: AccentMetaArgs) {
  if (onAccentMeta) {
    try {
      const topComposited = !!finalRankBadge &&
        finalRankLeft !== null &&
        (!!topBadge && !showComingSoon && topPaintsAccent) &&
        ((!isFresh && !isCard) || isExtraTopBadge)
      const genreStdPaints = genrePaintsAccent && !!safeGenreBadgeResult
      const genrePaintsEff = genreStdPaints || (cardGenrePaints && cardMainBadgeRendered)
      const genreEffHex = genreStdPaints || (cardGenrePaints && cardMainBadgeRendered)
        ? (isCard ? accentColorGenre : genreStdAccent)
        : null
      const topEffHex = topComposited
        ? rankStdAccent
        : null
      const topPaintsEff = topComposited && topEffHex !== null
      const manualGenre = accentOverride && isValidHex(accentOverride.genreColor)
        ? accentOverride.genreColor
        : null
      const manualRank = accentOverride && isValidHex(accentOverride.rankColor)
        ? accentOverride.rankColor
        : null
      const provFor = (
        paints: boolean,
        manual: string | null,
        tint: string | null,
        band: { r: number; g: number; b: number } | null
      ): EffectiveAccentMeta["provGenre"] => {
        if (!paints) return "not-painted"
        if (manual) return "manual"
        if (!tint) return "fallback-genre"
        if (!band) return "fallback-tint"
        return "extracted"
      }
      // Gradient entry: the SAME `blurTintHex` already passed to `applyBlur`
      // above (manual override, else the extracted scene tint, else the genre
      // fallback) — the actual render decision, never a remembered color. It
      // counts as painted only when the overlay really exists (blur enabled
      // in every layout: Standard layers it, Fresh interleaves it, Card bakes
      // it into the artwork) with a non-zero tint strength; a disabled or
      // transparent gradient is honestly `not-painted`, never a fake hex.
      const gradientPaintsEff = !!blurOverlay && tintStrength > 0 && isValidHex(blurTintHex)
      const manualGradient = accentOverride && isValidHex(accentOverride.genreColor)
        ? accentOverride.genreColor
        : null
      const provGradient: EffectiveAccentMeta["provGradient"] = !gradientPaintsEff
        ? "not-painted"
        : manualGradient
          ? "manual"
          : sceneTintHex
            ? "extracted"
            : "fallback-genre"
      onAccentMeta({
        genreHex: genrePaintsEff ? (manualGenre ?? genreEffHex) : null,
        rankHex: topPaintsEff ? (manualRank ?? topEffHex) : null,
        genrePaints: genrePaintsEff,
        topPaints: topPaintsEff,
        topType: topBadge?.type ?? null,
        provGenre: provFor(genrePaintsEff, manualGenre, sceneTintHex, bottomBand),
        provRank: provFor(topPaintsEff, manualRank, sceneTintHex, topBand),
        gradientHex: gradientPaintsEff ? blurTintHex : null,
        gradientPaints: gradientPaintsEff,
        provGradient,
      })
    } catch {
      // The observer must never break the render.
    }
  }
}
