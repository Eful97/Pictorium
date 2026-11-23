import type { RankingBadgeStyle, QualityBadgeStyle, AgeBadgeStyle, BadgeStyle, BadgeFont } from "./badge-styles"
import type { BadgeItemTransform } from "./badge-item-transforms"
import type { GenerationInput } from "./poster-generation-input"
import { isActiveQualityAnchor, isLogoRelativePosition, type LogoRelativePosition, isActiveTopBadgeAnchor, isActiveBottomAnchor, anchorCol, type AnchorChoice } from "./badge-anchor"
import { isRibbonRankingStyle, notchMaterialOf, qualityGroupNotchMaterial, resolveQualityGroupLayout } from "./badge-styles"
import { qualityBadgeIconPath } from "./quality-badge-styles"
import { effectiveBadgeItemTransforms, isQualityItemId, isRatingItemId, serializeBadgeItemTransforms } from "./badge-item-transforms"
import { isCornerAnchoredStyle, resolveTopBadgeStyle, isTopBadgeNumberRightCorner } from "./badge-layout"
import { badgeCacheKey } from "./poster-cache-infra"

export interface BadgePlacementArgs {
  readonly topBadge: { type: "extra"; label: string } | { type: "rank"; rank: number; label: string; ribbonLabel?: string } | null
  readonly animeRankResult: number | null
  readonly rankingBadgeStyle: RankingBadgeStyle
  readonly extraBadgeStyle: GenerationInput["extraBadgeStyle"]
  readonly extraBadgeScale: number | null | undefined
  readonly topBadgeScale: number
  readonly extraBadgeOffsetX: number | null | undefined
  readonly topBadgeOffsetX: number
  readonly extraBadgeOffsetY: number | null | undefined
  readonly topBadgeOffsetY: number
  readonly badgeQuality: boolean | undefined
  readonly quality: string | null | undefined
  readonly videoFormats: readonly string[] | null | undefined
  readonly ageLabel: string | null
  readonly badgesEnabled: boolean
  readonly qualityBadgeStyle: QualityBadgeStyle | null | undefined
  readonly ageBadgeStyle: AgeBadgeStyle
  readonly rawQualityGroupLayout: string | null
  readonly topLight: boolean
  readonly qualityBadgeScale: number
  readonly ribbonSide: "left" | "right"
  readonly comingSoonLabel: string
  readonly isFresh: boolean
  readonly isCard: boolean
  readonly bottomAnchor: string
  readonly qualityAnchor: string
  readonly logoResult: { readonly input: Buffer<ArrayBufferLike>; readonly top: number; readonly left: number; readonly w: number; readonly h: number } | null
  readonly networkLogoPosition: string
  readonly extraBadgeAnchor: string
  readonly topBadgeAnchor: string
  readonly showComingSoon: boolean
  readonly networkLogo: boolean | undefined
  readonly input: GenerationInput
  readonly shape: string | undefined
  readonly badgeStyle: BadgeStyle
  readonly topBadgeLight: boolean
  readonly genreBadgeLight: boolean
  readonly typeIcon: boolean | undefined
  readonly mediaType: "movie" | "tv"
  readonly hasGenreBadge: boolean
  readonly genreName: string | null
  readonly voteAverage: number | null
  readonly CW: number
  readonly year: string | undefined
  readonly badgeFont: BadgeFont
  readonly genreStdAccent: string
  readonly badgeGenre: boolean
  readonly badgeYear: boolean
  readonly badgeRating: boolean
  readonly genreBadgeScale: number
  readonly rankStdAccent: string
  readonly rankingBadgeAccent: boolean
  readonly awardLogoTopKey: string | null
  readonly awardLogoTopCaption: string | null
  readonly badgeItemTransforms: Readonly<Record<string, BadgeItemTransform>> | null | undefined
  readonly genreBadgeOffsetX: number
  readonly genreBadgeOffsetY: number
}

export function resolveBadgePlacement({
  topBadge, animeRankResult, rankingBadgeStyle, extraBadgeStyle, extraBadgeScale, topBadgeScale, extraBadgeOffsetX, topBadgeOffsetX, extraBadgeOffsetY, topBadgeOffsetY, badgeQuality, quality, videoFormats, ageLabel, badgesEnabled, qualityBadgeStyle, ageBadgeStyle, rawQualityGroupLayout, topLight, qualityBadgeScale, ribbonSide, comingSoonLabel, isFresh, isCard, bottomAnchor, qualityAnchor, logoResult, networkLogoPosition, extraBadgeAnchor, topBadgeAnchor, showComingSoon, networkLogo, input, shape, badgeStyle, topBadgeLight, genreBadgeLight, typeIcon, mediaType, hasGenreBadge, genreName, voteAverage, CW, year, badgeFont, genreStdAccent, badgeGenre, badgeYear, badgeRating, genreBadgeScale, rankStdAccent, rankingBadgeAccent, awardLogoTopKey, awardLogoTopCaption, badgeItemTransforms, genreBadgeOffsetX, genreBadgeOffsetY,
}: BadgePlacementArgs) {
  const isAnimeRank = topBadge?.type === "rank" && animeRankResult !== null && topBadge.rank === animeRankResult
  // Effective top-badge style (rank = `rs`, extra = `xbs ?? rs` legacy).
  // Number mirroring and corner anchoring follow this, never `rs` alone: an
  // explicit extra style detaches the extra badge from the ranking style.
  const topBadgeStyle = resolveTopBadgeStyle({ topBadgeType: topBadge?.type, rankingBadgeStyle, extraBadgeStyle })

  // Independent CLASSIFICA vs EXTRA tuning: the effective top-badge tuning
  // follows the KIND of the final topBadge (selected above, after network
  // suppression), never the other group's values. Rank (ribbon included)
  // always uses the legacy classifica tuning; extra uses its own once
  // migrated, else the legacy fallback — editing one never moves or resizes
  // the other.
  const isExtraTopBadge = topBadge?.type === "extra"
  const effTopBadgeScale = isExtraTopBadge ? (extraBadgeScale ?? topBadgeScale) : topBadgeScale
  const effTopBadgeOffsetX = isExtraTopBadge ? (extraBadgeOffsetX ?? topBadgeOffsetX) : topBadgeOffsetX
  const effTopBadgeOffsetY = isExtraTopBadge ? (extraBadgeOffsetY ?? topBadgeOffsetY) : topBadgeOffsetY

  const hasQualityBadge = badgeQuality !== false && !!quality
  // Badge età: master badge globale ON + etichetta risolta presente. NON
  // richiede il badge qualità né il tier 4K (contratto esplicito: l'età
  // rende anche senza qualità; solo il master globale spegne tutto).
  // Il legacy toggle `bq` (badgeQuality=false) spegne TUTTO il tech stack:
  // qualità E formati A/V. Senza gating, il gruppo sotto riaccenderebbe la
  // qualità nascosta (quality ?? null passato raw) solo perché l'età apre il
  // gruppo — l'age-only non deve mai resuscitare 4K/DV/Atmos disabilitati.
  const effectiveQuality = badgeQuality === false ? null : quality
  const effectiveFormats = badgeQuality === false ? null : videoFormats
  const ageText = typeof ageLabel === "string" ? ageLabel.trim() : ""
  const hasAgeBadge = badgesEnabled !== false && ageText !== ""
  const hasQualityGroup = hasQualityBadge || hasAgeBadge
  // Built-in icon per style+tier (null = standard pill / mono frame / knockout
  // tag). The style enters the cache key in any case: style change = new
  // bitmaps, never a collision (knockout, standard and mono share "std").
  // `quality` può essere null quando il gruppo rende la sola età: l'icona
  // resta null e la pill standard età compone il gruppo da sola. Quando il
  // legacy toggle è OFF (badgeQuality=false) l'effettiva è null: niente
  // icona, niente chiave che includa il tier nascosto.
  const effQualityBadgeStyle = qualityBadgeStyle
  const effAgeBadgeStyle: AgeBadgeStyle = ageBadgeStyle
  // Gruppo notch: UNA linguetta; `qgl` ne sceglie la composizione
  // (`stacked` = due piani, `row` = cella tier).
  const groupNotch = qualityGroupNotchMaterial(effQualityBadgeStyle, effAgeBadgeStyle)
  // Layout del gruppo qualità, risolto dalla route (query `qgl` > mapping >
  // config token > defaults > `stacked`). Fail-closed: assente/invalido =
  // colonna storica. Entra nella chiave solo quando è `row`, così le chiavi
  // storiche (stacked) restano byte-identiche.
  const effQualityGroupLayout = resolveQualityGroupLayout(rawQualityGroupLayout)
  const effQualityTopLight = topLight
  const effQualityGroupScale = qualityBadgeScale
  // `mono` renders the shared dynamic frame (same as the age mono): no asset
  // path, so the cache key must not claim one.
  const qualityIconPath = effQualityBadgeStyle === "knockout" || effQualityBadgeStyle === "mono" || !effectiveQuality ? null : qualityBadgeIconPath(effQualityBadgeStyle, effectiveQuality)
  const effComingSoonSide: "left" | "right" = ribbonSide === "right" ? "right" : "left"
  const effComingSoonLabel = comingSoonLabel
  // Il notch laterale segue il lato del nastro/angolo occupato: quando il
  // gruppo qualità si specchia a sinistra, la linguetta aggancia il bordo
  // sinistro. Regola pura (tutte le dipendenze sono risolte prima della cache
  // key), così il bitmap e la sua chiave restano coerenti.
  // Ancora qualità: SOLO Standard (Fresh/Card ignorano il parametro, byte-identici).
  // Con ancora attiva il lato è quello scelto e non dipende più dagli occupanti
  // dell'angolo destro; il bordo della linguetta lo segue (stessa chiave cache).
  // Ancora fascia inferiore: stessa regola (solo Standard).
  const bottomAnchorEff: AnchorChoice = !isFresh && !isCard && isActiveBottomAnchor(bottomAnchor) ? bottomAnchor : "auto"
  const qualityAnchorEff: AnchorChoice = !isFresh && !isCard && isActiveQualityAnchor(qualityAnchor) ? qualityAnchor : "auto"
  // Ancora MANUALE = posizione fissa (angolo + offset X/Y): nessuno scalino,
  // shrink o cambio lato per evitare altri elementi. I badge in auto continuano
  // a evitarla; le sovrapposizioni tra manuali sono accettate. netPos "top" è
  // legacy e NON manuale (vedi networkManual, nel blocco network).
  // Posizioni relative al logo (above/below; netPos/qanc/banc/tanc/xanc): sono
  // MANUALI (fisse, mai spostate per collisioni) ma senza anchorRect. La base e
  // il percorso auto del family; il blocco "sopra/sotto il logo" (prima del
  // pass) le porta rispetto al logo finale. Senza logo reso, o in Fresh/Card,
  // valgono come auto (nessun effetto, byte-identico).
  const logoRelOk = !isFresh && !isCard && !!logoResult
  const netRel: LogoRelativePosition | null = logoRelOk && isLogoRelativePosition(networkLogoPosition) ? networkLogoPosition : null
  const qualityRel: LogoRelativePosition | null = logoRelOk && isLogoRelativePosition(qualityAnchor) ? qualityAnchor : null
  const bottomRel: LogoRelativePosition | null = logoRelOk && isLogoRelativePosition(bottomAnchor) ? bottomAnchor : null
  const bottomManual = bottomAnchorEff !== "auto" || bottomRel !== null
  const qualityManual = qualityAnchorEff !== "auto" || qualityRel !== null
  // Ancora del badge superiore centrato (rank/extra). Attiva solo se il corpo
  // è davvero centrato: niente nastro Netflix (rank), niente corner/numerale
  // (già nell'angolo). Fresh/Card: mai attiva. Auto = nessun effetto.
  // Lo slot dipende dal tipo del badge superiore: extra → xanc, rank → tanc.
  const slotAnchor = topBadge?.type === "extra" ? extraBadgeAnchor : topBadgeAnchor
  const topBadgeAnchorEff: AnchorChoice = !isFresh && !isCard && isActiveTopBadgeAnchor(slotAnchor) ? slotAnchor : "auto"
  // Coming Soon occupa lo slot alto e il corpo rank non viene disegnato
  // (`rankBadgeKey` nullo): con il nastro attivo l'ancora non ha nulla da
  // spostare e non deve trasferire quality/network sull'angolo destro.
  // `topAnchorActive` = percorso storico tl/tr (corpo centrato spostato
  // all'angolo, niente corner). `topFixedActive` = posizione fissa estesa
  // (7 nuove + tl/tr su stili corner): corpo via `anchorRect` nel blocco rank.
  const topAnchorActive = (topBadgeAnchorEff === "tl" || topBadgeAnchorEff === "tr") && !!topBadge && !showComingSoon
    && !(isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank")
    && !isCornerAnchoredStyle(topBadgeStyle)
  const topFixedActive = isActiveTopBadgeAnchor(topBadgeAnchorEff) && !!topBadge && !showComingSoon
    && !(isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank")
    && !topAnchorActive
  const topRel: LogoRelativePosition | null = logoRelOk && !!topBadge && !showComingSoon
    && !(isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank")
    && isLogoRelativePosition(slotAnchor) ? slotAnchor : null
  const topRightAnchored = topAnchorActive && topBadgeAnchorEff === "tr"
  const notchEdge: "right" | "left" = isActiveQualityAnchor(qualityAnchorEff) ? (anchorCol(qualityAnchorEff) === "l" ? "left" : "right") : (
    (isRibbonRankingStyle(rankingBadgeStyle) && ribbonSide === "right" && topBadge?.type === "rank")
    || (showComingSoon && effComingSoonSide === "right")
    || isTopBadgeNumberRightCorner({ topBadgeType: topBadge?.type, rankingBadgeStyle, extraBadgeStyle, ribbonSide, hasTopBadge: !!topBadge })
    || topRightAnchored
    || (!!networkLogo && networkLogoPosition === "top")
  ) ? "left" : "right"

  // Placca staccata: solo gli stili centrati (il nastro resta ancorato)
  // con offset Y esplicito arrotondano tutti e 4 gli angoli. Calcolato qui
  // (non nel layout sotto) perché entra nella chiave cache: il bitmap cambia.
  // Task P: la Y combinata (tuning + preset position) decide il detached del
  // preset; il nativo resta sulla sola tuning (preset assente = 0, identico).
  const isRankNetflixRibbonStyle = isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank"
  const isRankDetached = !!topBadge && !isRankNetflixRibbonStyle && topBadgeStyle !== "number" && effTopBadgeOffsetY !== 0

  // Genere in alto quando lo slot superiore è libero (opt-in, solo portrait
  // Standard, mai la barra full-width): stessa decisione del ramo rank
  // (`rankBadgeKey` nullo) + nessun nastro Coming Soon. Sopra il badge legge
  // la polarità della banda alta (`topLight`), come i badge superiori.
  // Ancora manuale in fascia bassa: il genere resta nella fascia nell'angolo
  // scelto, mai spostato in alto (genreTopWhenFree ignorato).
  const genreAtTop = input.genreTopWhenFree === true && shape !== "landscape" && !isFresh && !isCard
    && badgeStyle !== "bar" && !notchMaterialOf(badgeStyle) && !topBadge && !showComingSoon && !bottomManual
  const genreLight = genreAtTop ? topBadgeLight : genreBadgeLight
  // Icona tipo: glifo inline nella riga del badge genere standard (Fresh/Card
  // non usano questo percorso: lì resta il fallback standalone).
  const genreTypeIcon: "movie" | "tv" | null = typeIcon && !isFresh && !isCard ? mediaType : null
  const genreBadgeKey = hasGenreBadge
    ? badgeCacheKey("genre", genreName, voteAverage, CW, year, badgeStyle, badgeFont, genreStdAccent, genreLight, badgeGenre, badgeYear, badgeRating, genreBadgeScale, genreTypeIcon)
    : null
  // The award logo mode is part of the cache identity: the logo bitmap can
  // never be served for a textual request (or vice versa). Non-award extras
  // keep the historic key (identical text render in both modes).
  const rankBadgeKey = !showComingSoon && topBadge
    ? badgeCacheKey("rank", topBadge.type === "extra" ? topBadge.label : `${(topBadge as { rank: number }).rank}:${topBadge!.label}:${(topBadge as { ribbonLabel?: string }).ribbonLabel ?? ""}`, CW, topBadgeLight, topBadgeStyle, badgeFont, rankStdAccent, ribbonSide, isAnimeRank, effTopBadgeScale, isRankDetached ? "detached" : undefined, rankingBadgeAccent ? "accent" : undefined, awardLogoTopKey ? `awardlogo:${awardLogoTopKey}:${awardLogoTopCaption ?? ""}` : undefined)
    : null
  const formatsKey = (effectiveFormats && effectiveFormats.length > 0) ? effectiveFormats.join(",") : "none"
  // Per-item corrections, split by family so each group's cache key carries
  // only the corrections that can change its own bitmap. Empty = automatic
  // layout (the key segment stays the historic sentinel).
  const effectiveItemTransforms = effectiveBadgeItemTransforms(badgeItemTransforms)
  const qualityItemKey = serializeBadgeItemTransforms(
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isQualityItemId(id)))
  ) ?? "items0"
  const separateItemKey = serializeBadgeItemTransforms(
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isRatingItemId(id)))
  ) ?? "items0"
  // Only the corrections of a family are handed to its renderer: an A/V mark
  // correction can never detach a rating pill and vice versa.
  const itemTransformsForQuality = Object.freeze(
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isQualityItemId(id)))
  )
  const itemTransformsForSeparate = Object.freeze(
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isRatingItemId(id)))
  )
  // L'età entra nella chiave (etichetta distinta = bitmap distinto) insieme
  // allo stile (stessa etichetta in standard/knockout = bitmap diversi);
  // assente = sentinel stabile così le chiavi senza età restano byte-identiche
  // allo storico (lo stile da solo non invalida la cache: senza età non rende
  // niente). La chiave usa l'EFFETTIVA (gated dal legacy toggle): con bq=0 il
  // tier nascosto non entra nella chiave (stesso bitmap dell'age-only senza tier).
  const qualityBadgeKey = hasQualityGroup
    ? badgeCacheKey("quality", effectiveQuality ?? "noquality", CW, effQualityTopLight, badgeFont, qualityBadgeScale, effQualityBadgeStyle ?? "standard", qualityIconPath ?? "std", formatsKey, ageText !== "" ? `${ageText}:${effAgeBadgeStyle}` : "noage", qualityItemKey, effQualityGroupLayout === "row" ? "row" : undefined, groupNotch ? notchEdge : undefined)
    : null
  const comingSoonKey = showComingSoon
    ? badgeCacheKey("comingsoon", effComingSoonLabel, CW, badgeFont, topLight, effComingSoonSide)
    : null

  const combinedTopOX = effTopBadgeOffsetX
  const combinedTopOY = effTopBadgeOffsetY
  const combinedGenreOX = genreBadgeOffsetX
  const combinedGenreOY = genreBadgeOffsetY
  return { genreBadgeKey, genreLight, genreTypeIcon, rankBadgeKey, isRankDetached, isAnimeRank, qualityBadgeKey, effectiveQuality, effQualityBadgeStyle, effectiveFormats, effQualityTopLight, hasAgeBadge, ageText, effAgeBadgeStyle, itemTransformsForQuality, effQualityGroupLayout, notchEdge, comingSoonKey, effComingSoonLabel, effComingSoonSide, effTopBadgeScale, effQualityGroupScale, netRel, qualityRel, bottomRel, topRel, bottomAnchorEff, combinedGenreOX, genreAtTop, combinedGenreOY, bottomManual, topBadgeStyle, combinedTopOX, topAnchorActive, topBadgeAnchorEff, combinedTopOY, topFixedActive, topRightAnchored, qualityAnchorEff, groupNotch, qualityManual, effectiveItemTransforms, separateItemKey, itemTransformsForSeparate, isExtraTopBadge, isRankNetflixRibbonStyle }
}
