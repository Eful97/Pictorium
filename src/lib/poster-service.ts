import { renderWatchProviderRow } from "@/lib/watch-providers-render"
import sharp from "sharp"
import { renderMultiRatings } from "./multi-rating-renderer"
import { MAX_SEPARATE_RATINGS } from "./ratings"
import { renderSeparateRatingStack,renderSeparateRatingsBottom,renderSeparateRatingsNotch,renderSeparateRatingsSideNotch,notchSeparateStepBodyHeight,notchSeparateStepText,type SeparateRatingStack } from "./separate-rating-renderer"
import { cacheGet,cacheSet } from "./cache"
import { GENRE_FALLBACK } from "./badges"
import { applyBlur } from "./blur"
import { STD_W,STD_H,extractSceneTint,fitBadgeToCanvas,BadgeRender,PosterComposite,badgeBody,badgeCanvasForBody,scaleBadgeBleed,topBandMeanRGB,bottomBandMeanRGB,effectiveTopBackgroundLuminance,effectiveBottomBackgroundLuminance,adaptiveAccentHexForBand } from "./poster-render-helpers"
import { LAND_W,LAND_H } from "./image-utils"
import { normalizeAutomaticAccentHex } from "./accent-color"
import { renderAwardLogoBadge } from "./award-logos"
import { awardShortName,type AwardBadgeKey } from "./badge-labels"
import { renderGenreBadge,renderRankingBadge,renderExtraBadge,renderComingSoonRibbon,comingSoonRibbonLayout } from "./svg-badge"
import { buildLogoScrim,logoContrast,logoInkLuminance,logoScrimStrength,posterLogoZoneLuminance } from "./logo-contrast"
import { renderFirstMatchingNetworkLogoBadge,renderFirstMatchingNetworkRawBadge,renderFirstMatchingNetworkLogoBadgeHybrid,renderFirstMatchingNetworkRawBadgeHybrid,type NetworkCandidate } from "./network-svgs"
import { isNetworkFixedPosition } from "./network-follow"
import { isActiveQualityAnchor,isLogoRelativePosition,type LogoRelativePosition,isActiveTopBadgeAnchor,isActiveBottomAnchor,bottomAnchoredLeft,bottomAnchoredBodyLeft,anchorRect,anchorCol,anchorRow,isAnchorPosition,type AnchorChoice,type AnchorPosition } from "./badge-anchor"
import { computeLogoLayout,logoAlignPadX,isActiveLogoAnchor,isTopLogoAnchor,type LogoAnchor,PORTRAIT_LOGO_MAX_HEIGHT_PCT,PORTRAIT_LOGO_TOP_OFFSET,LANDSCAPE_LOGO_MAX_WIDTH_PCT,LANDSCAPE_LOGO_MAX_HEIGHT_PCT,LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT,LANDSCAPE_LOGO_TOP_OFFSET,LANDSCAPE_LOGO_SHIFT_X,LANDSCAPE_LOGO_SHIFT_Y } from "./logo-layout"
import { logoDefaultScaleFromAspect,FRESH_TITLE_LOGO_DEFAULT_SCALE } from "./logo-selection"
import { TOP_SHADOW_PAD } from "./badge-svg-shared"
import { computeTopBadge,getNextEpisodeLabel,isNetworkStudio,shouldSuppressExtraTopBadgeForNetwork,type BadgeInput } from "./poster-badge"
import { isNextEpisodeBadgeKey,DEFAULT_SASH_ORDER } from "./badge-priority"
import { DEMO_SAMPLE_NETWORK } from "./demo-samples"
import { isPosterFreshScope,DEFAULT_POSTER_FRESH_SCOPE } from "./types"
import { directorBadgeLabel } from "./awards"
import { isRibbonRankingStyle,notchMaterialOf,qualityGroupNotchMaterial,isBottomSeparateRatingsStyle,columnNotchMaterialOf,isNotchSeparateRatingsStyle,isAgeBadgeStyle,isAwardBadgeMode,getSeparateRatingsStyleForShape,resolveNumberBadgeBaseOffsetX,normalizeExtraBadgeStyleForRender,resolveQualityGroupLayout,isMergedQualityStrip,DEFAULT_AGE_BADGE_STYLE,DEFAULT_AWARD_BADGE_MODE,type SeparateBottomVariant,type AgeBadgeStyle,type AwardBadgeMode } from "./badge-styles"
import { normalizeBadgeFont } from "./badge-svg-shared"
import { qualityBadgeIconPath } from "./quality-badge-styles"
import { isRankKey } from "./i18n"
import { isEffectiveFreshLayout,isFreshRank,prepareFreshReconstructedBackground,type FreshOverlayGeometry } from "./fresh-layout"
import { type CardOverlayGeometry } from "./card-layout"
import { isEffectiveCardLayout } from "./card-layout-skins"
import { applyBadgeItemTransform,badgeItemTransform,effectiveBadgeItemTransforms,homeIdForPainted,isNeutralBadgeItemTransform,isQualityItemId,isRatingItemId,ratingSlotItemId,serializeBadgeItemTransforms } from "./badge-item-transforms"
import { type CornerRankRect,isCornerAnchoredStyle,resolveTopBadgeStyle,genreBadgeConsumesAccent,topBadgeConsumesAccent,cornerRankTop,cornerAnchoredLeft,isTopBadgeNumberRightCorner,numberSharesComingSoonCorner,type NetworkGeometry,type BadgeGeometryFamily,type BadgeGeometryBox,type BadgeGeometryItem,NETWORK_LOGO_SHIFT_Y,NETWORK_ABOVE_LOGO_LIFT,cornerNetworkAboveTitle,stackNetworkBelowCornerRank,landscapeRightAnchorLeft } from "./badge-layout"
import { type QualityBadgeGroupResult,renderQualityBadgeGroup } from "./quality-badges"
export { type CornerRankRect, isCornerAnchoredStyle, resolveTopBadgeStyle, genreBadgeConsumesAccent, topBadgeConsumesAccent, cornerRankTop, cornerAnchoredLeft, isNumberRightCorner, isTopBadgeNumberRightCorner, numberSharesComingSoonCorner, type NetworkGeometry, type BadgeGeometryFamily, type BadgeGeometryLayout, type BadgeGeometryBox, type BadgeGeometryReport, type BadgeGeometryItem, NETWORK_LOGO_SHIFT_Y, NETWORK_ABOVE_LOGO_LIFT, type CornerNetworkAboveTitleInput, cornerNetworkAboveTitle, stackNetworkBelowCornerRank } from "./badge-layout"
export { __resetQualityIconCacheForTests, renderQualityIconBadge, renderColorIconBadge, renderPremiumIconBadge, renderAvKnockoutBadge, type QualityBadgeItem, type QualityBadgeGroupResult, type QualityHomeGhost, renderQualityBadgeGroup } from "./quality-badges"

// Helper di layout, tipi di input e helper Card estratti in moduli dedicati;
// le API storiche restano ri-esportate da qui.
import { BADGE_CACHE_TTL,scaleBitmapForLayout,inkBounds,inkRatios,BELOW_LOGO_MIN_SCALE,LOGO_LIFT_TARGET_SCALE,LOGO_LIFT_MAX_FRAC,rectsOverlap,shrinkAwayFromRect } from "./poster-layout-helpers"
import { PORTRAIT_SEPARATE_SHIFT_Y,LANDSCAPE_BOTTOM_PILLS_SHIFT_X,LANDSCAPE_BOTTOM_PILLS_SHIFT_Y,NOTCH_STEP_GLASS_SIGMA_BOOST } from "./poster-layout-helpers"
import type { GenerationInput } from "./poster-generation-input"
import type { RelEntry,InkSource } from "./poster-layout-helpers"
export { LANDSCAPE_BOTTOM_PILLS_SHIFT_X, LANDSCAPE_BOTTOM_PILLS_SHIFT_Y, PORTRAIT_SEPARATE_SHIFT_Y, NOTCH_STEP_GLASS_SIGMA_BOOST } from "./poster-layout-helpers"
export type { GenerationInput } from "./poster-generation-input"
export { resolveCardBrandAccent, renderCardMainBadge } from "./poster-card-helpers"

// ---------------------------------------------------------------------------
// Badge cache helpers (coalescing) — implementazione in poster-cache-infra.ts.
// `badgeCacheKey` è ri-esportata per compatibilità (test + consumer storici).
// ---------------------------------------------------------------------------
import { badgeCacheKey,coalesceBadgeRender } from "./poster-cache-infra"
export { badgeCacheKey } from "./poster-cache-infra"

// Overlay full-canvas e cache image-level estratti in moduli dedicati;
// le API storiche restano ri-esportate da qui.
import { reportEffectiveAccentMeta } from "./poster-accent-meta"
import { composeFreshLayer } from "./poster-fresh-compose"
import { reportBadgeGeometry } from "./poster-badge-geometry"
import { composeCardLayer } from "./poster-card-compose"
import { composeFinalPoster } from "./poster-final-composite"
import { getVignette,getLandscapeScrim,getPreReleaseDim,getTopShade } from "./poster-overlay-cache"
import { resizeLogoCached,backdropMetaCached,resizeBackdropCached } from "./poster-image-cache"
export { __resetSeasonalFrameCacheForTests } from "./poster-overlay-cache"
export { resolveBadgeColors, resizeLogoCached, backdropMetaCached, resizeBackdropCached, type BadgeColorsResult, type ResizedImage } from "./poster-image-cache"




// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function generatePosterBuffer(input: GenerationInput): Promise<Buffer> {
  const {
    posterBuf, logoFetch, backdropFetch,
    backdropScale, backdropOffsetX, backdropOffsetY,
    blurEnabled, blurHeight, blurIntensity, blurFade, blurDarkness,
    // Default 20 quando il chiamante non lo passa (test diretti, vecchi adapter).
    tintStrength = 20,
    // Ombra superiore: default 50 = catena di default (test diretti inclusi).
    topShade = 50,
    // Altezza ombra superiore (% canvas): default 25 = look storico.
    topShadeHeight = 25,
    badgesEnabled, rankingEnabled, genreName, voteAverage, badgeStyle,
    rankingBadgeStyle, extraBadgeStyle, badgeGenre, badgeYear, badgeRating, badgeQuality, quality,
    qualityBadgeStyle, videoFormats,
    // Layout del gruppo qualità (assente = "stacked" = colonna storica).
    qualityGroupLayout: rawQualityGroupLayout = null,
    // Etichetta età (null = badge nascosto: default nei test diretti).
    ageLabel = null,
    // Stile pill età (assente = "standard" = resa storica).
    ageBadgeStyle: rawAgeBadgeStyle = null,
    awardBadgeStyle: rawAwardBadgeStyle = null,
    sashOrder,
    disabledContentTags = null,
    disabledNetworks = null,
    topLight, targetCenter, ribbonSide,
    // Nastro stile Netflix all'angolo: default true (comportamento storico per
    // i chiamanti diretti/test che non passano il campo).
    ribbonEnabled = true,
    // Tinta accent sul default centrato (degrado "colored" senza nastro).
    rankingBadgeAccent = false,
    bottomLight: bottomLightOpt,
    topBadgeLight: topBadgeLightOpt,
    genreBadgeLight: genreBadgeLightOpt,
    logoScale, logoOffsetX, logoOffsetY,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
    extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
    genreBadgeScale, qualityBadgeScale, networkLogoScale,
    separateBadgeScale,
    separateBadgeOffsetX, separateBadgeOffsetY,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    mediaType, finalRank, animeRankResult,
    mapping, tmdbNetworks, productionCompanies, tmdbStudios,
    tmdbNetworksDetailed, productionCompaniesDetailed, watchProviders, typeIcon,
    tvType, tvStatus, releaseDate, firstAirDate,
    lastAirDate, seasonCount, nextEpisodeAirDate, numberOfEpisodes, originCountries, genreIds,
    wikidataResult, tmdbKeywords, locale, t,
    qLabel, queryExtra, qNetLogo, networkLogo, networkLogoPosition = "auto", logoAnchor = "auto", qualityAnchor = "auto", topBadgeAnchor = "auto", extraBadgeAnchor = "auto", bottomAnchor = "auto", networkLogoFollowTitle, networkFixedX, networkFixedY, onNetworkGeometry, onBadgeGeometry, badgeItemTransforms, badgeHomeGhosts, onAccentMeta, sd, accentOverride, imdbTop250, whatsonFeatures,
    logoSrc, backdropSrc, analysisKey,
    preRelease = false,
    preInTheaters = false,
    hideLogo = false,
    seasonalTheme = null,
    logoScrimDisabled,
    logoAlign,
    shape,
  } = input

  // Il badge genere in basso segue la luce del fondo, non del top (su poster
  // con alto chiaro e fondo scuro la pill restava grafite su nero). Chiamanti
  // vecchi/test diretti che non passano bottomLight ricadono sul top.
  const bottomLight = bottomLightOpt ?? topLight
  const topBadgeLight = topBadgeLightOpt ?? topLight
  const genreBadgeLight = genreBadgeLightOpt ?? bottomLight
  // Font badge normalizzato (assente/invalido → "inter" = resa storica).
  const badgeFont = normalizeBadgeFont(input.badgeFont)
  // Stile pill età normalizzato (assente/invalido → "standard" = resa
  // storica; entra nella chiave solo con l'età presente).
  const ageBadgeStyle: AgeBadgeStyle = isAgeBadgeStyle(rawAgeBadgeStyle) ? rawAgeBadgeStyle : DEFAULT_AGE_BADGE_STYLE
  // Modalità premi normalizzata (assente/invalido → "badge" = resa storica).
  const awardBadgeStyle: AwardBadgeMode = isAwardBadgeMode(rawAwardBadgeStyle) ? rawAwardBadgeStyle : DEFAULT_AWARD_BADGE_MODE
  // Fresh apply scope (assente/invalido → default condiviso "ranked",
  // fail-closed: senza rank valido rende Standard). Il layout
  // EFFETTIVO si decide sotto, DOPO la selezione del topBadge (il rank
  // mostrato determina l'eleggibilità, non l'appartenenza al catalogo).
  const rawFreshScope = isPosterFreshScope(input.posterFreshScope) ? input.posterFreshScope : DEFAULT_POSTER_FRESH_SCOPE

  // Dimensioni canvas: portrait (default, byte-identico al passato) o
  // landscape 16:9 (prova ?shape=landscape, base = backdrop TMDB).
  const CW = shape === "landscape" ? LAND_W : STD_W
  const CH = shape === "landscape" ? LAND_H : STD_H
  // Layout logo per formato: in portrait è SEMPRE "center" per contratto.
  // In landscape può essere "left" (Cinematic) o "center", col logo
  // contenuto nei vincoli del canvas 16:9 (come i bound slider client).
  const align = shape === "landscape" && logoAlign === "left" ? "left" : "center"
  const isLandscape = shape === "landscape"
  const isLandscapeLeft = shape === "landscape" && align === "left"
  // I badge si rendono alla larghezza portrait (stessi pixel assoluti del
  // verticale): sul canvas 16:9 non devono dominare la scena. Posizioni,
  // overflow-protection e chiavi cache restano sul canvas vero (CW/CH):
  // le chiavi in particolare NON usano badgePw, altrimenti i bitmap
  // portrait (stesso pw=500) colliderebbero — fatale per gli stili `bar`
  // full-width.
  const badgePw = shape === "landscape" ? STD_W : CW
  // Il badge superiore centrale (rank/extra) in landscape è reso al 120%:
  // sul canvas 16:9 deve restare il protagonista in alto.
  const topBadgePw = shape === "landscape" ? Math.round(badgePw * 1.2) : badgePw

  // -----------------------------------------------------------------------
  // 0. Badge computation (prima dei layer: il topBadge mostrato decide il
  // layout Fresh/Card EFFETTIVO sotto scope "ranked"). Blocco puro spostato qui
  // dal passo 4: stessi input, stesso ordine, nessun cambio di output — solo
  // la posizione, così ogni gate `!isFresh && !isCard` sotto (backdrop, vignetta, logo,
  // badge) usa già l'effettivo.
  // -----------------------------------------------------------------------

  const badgeInput: BadgeInput = {
    mediaType,
    tmdbId: input.tmdbId ?? null,
    digitalReleaseDate: input.digitalReleaseDate ?? null,
    releaseDate: releaseDate ?? null,
    firstAirDate: firstAirDate ?? null,
    lastAirDate: lastAirDate ?? null,
    seasonCount: seasonCount ?? null,
    nextEpisodeAirDate: nextEpisodeAirDate ?? null,
    numberOfEpisodes: numberOfEpisodes ?? null,
    originCountries: [...originCountries],
    genreIds: genreIds ? [...genreIds] : null,
    voteAverage: voteAverage ?? 0,
    trendRank: finalRank,
    animeRank: animeRankResult,
    awards: wikidataResult.awards,
    nominations: wikidataResult.nominations,
    studios: wikidataResult.studios,
    director: directorBadgeLabel(wikidataResult.director, t),
    tvType: tvType ?? null,
    tvStatus,
    keywords: [...tmdbKeywords],
    imdbTop250: !!imdbTop250,
    whatsonFeatures: whatsonFeatures ?? null,
    disabledContentTags: disabledContentTags ?? null,
  }
  const computed = computeTopBadge(badgeInput, t, locale, sashOrder ?? null, input.dateFormat ?? "locale")
  const studioBadge = computed.studioBadge
  const isNetStudio = isNetworkStudio(studioBadge)

  let topBadge: { type: "extra"; label: string } | { type: "rank"; rank: number; label: string; ribbonLabel?: string } | null = null
  // Canonical manual next-episode identity resolves to the CURRENT dated
  // label (or nothing when elapsed). Any other manual text wins verbatim;
  // an elapsed identity falls through to the computed badge (no stale date).
  const isManualNextToken = isNextEpisodeBadgeKey(queryExtra ?? null)
  const manualNextLabel = isManualNextToken
    ? getNextEpisodeLabel({
      mediaType,
      airDate: nextEpisodeAirDate ?? null,
      locale,
      dateFormat: input.dateFormat ?? "locale",
      t,
    })
    : null
  const effectiveQueryExtra = isManualNextToken ? manualNextLabel : queryExtra
  // "Badge extra" master (Informazioni): every NON-rank top badge is off when
  // the caller cleared all non-rank sash buckets, while the rank bucket stays
  // (classification follows its own switch). A manual custom extra (`extra=`)
  // must follow the same gate so it cannot resurrect a hidden extra; Coming
  // Soon/preRelease is NOT gated here — it has its own dedicated selector.
  const extrasEnabled = (sashOrder ?? DEFAULT_SASH_ORDER).some((b) => b !== "rank")
  const gatedQueryExtra = extrasEnabled ? effectiveQueryExtra : null
  // The top slot (rank AND explicit extra) is governed ONLY by the TOP
  // toggles (rankingEnabled/sash/queryExtra): disabling the lower
  // genre/rating group (badgesEnabled = false) hides just that row and
  // must NOT suppress rank/extra here. Genuine ranking OFF still hides the
  // slot via the rankingEnabled gate below — never force-enabled.
  if (rankingEnabled) {
    if (gatedQueryExtra) {
      topBadge = { type: "extra" as const, label: gatedQueryExtra }
    } else if (computed.badge) {
      const b = computed.badge
      if (b.type === "extra") {
        topBadge = { type: "extra" as const, label: b.label }
      } else {
        // Sottotitolo nastro: override custom esplicito (non rank-key) vince,
        // altrimenti il periodo computato ("Oggi", anche per gli anime).
        const customRibbon = qLabel && !isRankKey(qLabel) ? qLabel : undefined
        topBadge = { type: "rank" as const, rank: b.rank!, label: qLabel || b.rankLabel || b.label, ribbonLabel: customRibbon ?? b.ribbonLabel ?? b.label }
      }
    }
  }
  // Badge Coming Soon: vince sul badge calcolato ma non sul custom esplicito
  // (`queryExtra`) né sull'upcomingRelease teatrale (che ha già la data).
  // Indipendente da rankingEnabled e dal master "Badge extra": è stato del
  // contenuto con il proprio selettore (`preRelease`), quindi resta visibile
  // anche con le classifiche o gli extra spenti. Il custom (`extra=`) è invece
  // soggetto al master: quando gli extra sono spenti non può risuscitarlo.
  // Fase teatrale: un film già uscito in sala usa l'etichetta "Al cinema"
  // (badge extra normale, nessun nastro); solo il non-ancora-uscito resta
  // "Prossimamente" col nastro angolare rosso.
  const comingSoonLabel = t("badge.comingSoon")
  const inTheatersLabel = t("badge.inTheaters")
  const preReleaseLabel = preInTheaters ? inTheatersLabel : comingSoonLabel
  if (preRelease && !gatedQueryExtra) {
    const isUpcoming = computed.upcomingRelease
      && topBadge?.type === "extra"
      && topBadge.label === computed.upcomingRelease
    if (!isUpcoming) {
      topBadge = { type: "extra" as const, label: preReleaseLabel }
    }
  }
  const showComingSoon = !!preRelease && !gatedQueryExtra
    && topBadge?.type === "extra" && topBadge.label === comingSoonLabel
    // Nastro disattivato: il Coming Soon resta come badge extra centrale
    // (ramo rank standard) invece del nastro angolare rosso.
    && ribbonEnabled
  const ribbonLayout = showComingSoon ? comingSoonRibbonLayout(badgePw) : null

  // Fresh opt-in layout EFFETTIVO: stessa risoluzione input, composizione
  // separata. Ogni gate sotto è `&& !isFresh` (Card aggiunge `&& !isCard` agli
  // stessi push) attorno a un push/ramo: a false
  // (default, assente, "standard", o "ranked" senza rank valido mostrato) il
  // percorso standard esegue le stesse operazioni byte-identiche. Deciso QUI
  // — prima dei rami layout-specific soppressi e con lo stesso helper del
  // numerale (isFreshRank via isEffectiveFreshLayout, nessuna seconda
  // derivazione del rank): il rank è quello mostrato (topBadge numerale, già
  // rankingEnabled-gated sopra), mai l'appartenenza al catalogo.
  let freshOverlayGeo: FreshOverlayGeometry | null = null
  let cardOverlayGeo: CardOverlayGeometry | null = null
  const isFresh = isEffectiveFreshLayout(
    input.posterLayout,
    rawFreshScope,
    topBadge?.type === "rank" ? topBadge.rank : null,
  )

  // Card cover layouts ("provider-glass"/"nuvio"/"stremio", P5): same
  // decision point and same inputs as Fresh above — the shared
  // `posterFreshScope` chain applies (default "ranked": Card only with a
  // valid DISPLAYED Card rank 1..20; explicit "all": Card always, numeral
  // omitted without a rank). Mutually exclusive with Fresh (different layout
  // values); every `!isFresh` gate below also carries `!isCard` so the
  // standard chrome suppressed for Fresh stays suppressed for Card, while
  // the kept chrome (Coming Soon, quality, extra, dim, shade, blur) is
  // reused verbatim over the Card base. Decided HERE — before any
  // layout-specific branch — with the rankingEnabled-gated displayed rank
  // (no second rank derivation, no text-badge parsing, no extra fetch). The
  // Fresh 1..100 gate above is untouched.
  const isCard = isEffectiveCardLayout(
    input.posterLayout,
    rawFreshScope,
    topBadge?.type === "rank" ? topBadge.rank : null,
  )

  // Task16 experiment (ONE reversible candidate, Fresh WITH valid numeral
  // ONLY): the full-bleed base shifts right ~6% CW with the vacated left gap
  // filled by a blurred mirrored edge extension (prepare helper in
  // fresh-layout). `freshBaseBuf` is the pipeline base + the buffer forwarded
  // to composeFreshOverlay (glass + left-blur sample the NEW view); color
  // analysis above/below stays on the ORIGINAL `posterBuf`. Standard,
  // Fresh-unranked and invalid-rank paths keep the original buffer
  // byte-identically (no extra ops, no re-encode).
  const freshBgRank = topBadge?.type === "rank" ? topBadge.rank : null
  const useFreshReconstructedBg = isFresh && isFreshRank(freshBgRank)
  const freshBaseBuf = useFreshReconstructedBg
    ? (await prepareFreshReconstructedBackground(posterBuf, CW, CH)).png
    : posterBuf

  // -----------------------------------------------------------------------
  // 1. Backdrop composite layer
  // -----------------------------------------------------------------------
  const composites: PosterComposite[] = []
  // Famiglie registrate per il pass "auto evita manuali" (prima del report
  // geometria): ogni layer pushato da una famiglia viene spostato insieme al suo box.
  const famLayers: Record<"network" | "quality" | "genre" | "separate" | "rating", PosterComposite[]> = { network: [], quality: [], genre: [], separate: [], rating: [] }
  // Famiglie AUTO spostate o ridimensionate da una collisione (solo `badgeOverflow=hide`
  // le nasconde). Il pass sotto e i collettori di shrink/drop le registrano.
  const displaced = new Set<"network" | "quality" | "genre" | "separate" | "rating">()
  // Riga rating personalizzata (fascia bottom): box visibile per il pass.
  let ratingBox: { left: number; top: number; w: number; h: number } | null = null
  const pushFam = (fam: keyof typeof famLayers, layer: PosterComposite) => { composites.push(layer); famLayers[fam].push(layer) }
  // Placche `vetro` che ricevono lo sfondo sfocato reale (sezione 7).
  const glassLayers = new Set<PosterComposite>()
  // Sigma extra per-layer della sfocatura vetro (solo il gradino: superficie a
  // due livelli, più larga della pillola → blur più forte).
  const glassBlurOverrides = new Map<PosterComposite, number>()

  // SOLO landscape: il backdrop storico è la base 16:9 ed è già full-bleed in
  // `posterBuf` per la route; in portrait non esiste un layer backdrop (la base
  // è il poster). Il gate qui rende impossibile una banda centrata anche se un
  // chiamante passasse un buffer stantio (difesa oltre al fix della route).
  if (backdropFetch && isLandscape) {
    const bMeta = await backdropMetaCached(backdropFetch, backdropSrc)
    const bw = bMeta.width
    const bh = bMeta.height
    const bScale = backdropScale / 100
    let bResizedW = Math.round(CW * bScale)
    let bResizedH = Math.round(bh * (bResizedW / bw))
    if (bResizedW > CW) { bResizedH = Math.round(bResizedH * (CW / bResizedW)); bResizedW = CW }
    if (bResizedH > CH) { bResizedW = Math.round(bResizedW * (CH / bResizedH)); bResizedH = CH }
    const bX = Math.round((CW - bResizedW) / 2 + backdropOffsetX)
    const bY = Math.round((CH - bResizedH) / 2 + backdropOffsetY)
    const backdropResized = await resizeBackdropCached(backdropFetch, bResizedW, bResizedH, backdropSrc)
    // Fresh/Card: base full-bleed già in posterBuf (Card: artwork card), nessun layer backdrop storico.
    if (!isFresh && !isCard) composites.push({ input: backdropResized.input, top: bY, left: bX })
  }

  // -----------------------------------------------------------------------
  // 2. Blur + badge colors + logo resize (parallel)
  // -----------------------------------------------------------------------
  const year = releaseDate?.slice(0, 4) || firstAirDate?.slice(0, 4) || undefined
  const genreAvailable = !!genreName
  const ratingAvailable = !!(voteAverage && voteAverage > 0)
  const yearAvailable = !!year
  // Il badge è visibile se almeno uno dei 3 componenti è abilitato E disponibile.
  const hasGenreBadge = badgesEnabled
    && ((genreAvailable && badgeGenre) || (ratingAvailable && badgeRating) || (yearAvailable && badgeYear))
  // Reservation logo: in bottom i flag effettivi sono soppressi ma il titolo
  // resta alla stessa altezza della colonna equivalente (stesse preferenze e
  // metadati, anche a 0 provider). La route passa `logoBadgeVisibility` con i
  // flag colonna; assente → flag effettivi (comportamento storico).
  const refVis = input.logoBadgeVisibility
  const logoHasBadges = badgesEnabled
    && ((genreAvailable && (refVis?.genre ?? badgeGenre)) || (ratingAvailable && (refVis?.rating ?? badgeRating)) || (yearAvailable && (refVis?.year ?? badgeYear)))

  // Riga bottom (bottom-bar/bottom-pills): stile già risolto a monte, max 5
  // provider. Vince difensivamente sul custom provider anche se l'input
  // portasse entrambi (la route già esclude il custom in bottom).
  // Difesa: bottom-bar mai in landscape (normalizzazione DOPO cascata, come
  // in poster-config — copre URL vecchi/mapping/default/token e chiamanti
  // diretti del service; i raw salvati restano intatti).
  const nativeBottomInput = input.separateRatingsStyle ?? "column"
  const effBottomStyle = getSeparateRatingsStyleForShape(nativeBottomInput, isLandscape ? "landscape" : "poster")
  const separateBadgeScaleEff = separateBadgeScale
  const effSepTopLight = topLight
  const effSepBottomLight = bottomLight
  const isBottomStyle = isBottomSeparateRatingsStyle(effBottomStyle)
  const sepColumnVariant = effBottomStyle === "rings" ? "rings" as const : "pill" as const
  // Linguetta laterale (`column-notch-*`): la colonna diventa UNA linguetta.
  const sepSideNotch = columnNotchMaterialOf(effBottomStyle)
  const bottomVariant: SeparateBottomVariant | null = isBottomStyle ? effBottomStyle : null
  const bottomItemCount = bottomVariant ? (input.separateRatings?.length ?? 0) : 0
  // Offset gruppo rating separati (default 0 = percorso storico byte-identico):
  // l'intero gruppo si sposta di (ox, oy); positivo Y = giù come gli altri badge.
  const sepOX = (separateBadgeOffsetX ?? 0)
  const sepOY = (separateBadgeOffsetY ?? 0)

  // Single same-hue scene tint for badges + blur (consistent from the same
  // root). No per-zone crop: the bottom-40% voted skin/suit #86642d on
  // portraits with faces at the bottom (e.g. Silo) instead of the scene
  // emerald. An explicit `ac=` override always wins; safety net: genre/gray
  // fallback. resolveBadgeColors stays exported and tested but is no longer
  // on the render path.
  // Style-gated extraction: the tint decodes only when a consumer needs it —
  // the bottom blur overlay, a standard genre badge with the `colored` style,
  // a top badge whose effective style paints the accent (colored/corner/
  // extra-number/accent-filled default, via topBadgeConsumesAccent — the same
  // resolution as the renderer, follow-rank included), the Card main badge
  // with the `colored` style.
  // Styles that ignore the accent (default/minimal/vetro/bar/pill/shadow/
  // bordo, plain ribbons/numerals) and manual `ac=` bands never trigger a
  // decode here. The gate also covers the extra top badge with ranking off
  // (via preRelease, the only branch turning it on without rankingEnabled):
  // the corner tint stays automatic there too.
  const genrePaintsAccent = hasGenreBadge && !isFresh && !isCard && genreBadgeConsumesAccent(badgeStyle)
  const cardGenrePaints = isCard && badgesEnabled !== false && genreBadgeConsumesAccent(badgeStyle)
  // Gradino dei rating separati: crema/inchiostro/sfumato si tingono con la
  // scena come la notch genere (vetro no) — stessa banda bassa adattiva.
  const stepPaintsAccent = !!bottomVariant && !isFresh && !isCard && isNotchSeparateRatingsStyle(bottomVariant) && genreBadgeConsumesAccent(bottomVariant)
  const topPaintsAccent = topBadgeConsumesAccent({
    topBadgeType: topBadge?.type ?? null,
    rankingBadgeStyle,
    extraBadgeStyle,
    rankingBadgeAccent,
  })
  const needsSceneTint =
    (blurEnabled && !accentOverride?.genreColor) ||
    (genrePaintsAccent && !accentOverride?.genreColor) ||
    (stepPaintsAccent && !accentOverride?.genreColor) ||
    (cardGenrePaints && !accentOverride?.genreColor) ||
    (!!topBadge && !showComingSoon && topPaintsAccent && !accentOverride?.rankColor)
  const sceneTintHex = needsSceneTint
    ? await extractSceneTint(posterBuf, genreName, analysisKey ? `${analysisKey}:${genreName ?? "x"}` : null)
    : null

  // Automatic badge accent: per-band adaptive on the extracted scene tint
  // (same hue/saturation, L in [0.24, 0.60], renderer text 4.5:1 first, 3:1
  // background separation second, deterministic best-effort when infeasible).
  // Each band samples the EFFECTIVE canvas the route already fitted
  // (portrait STD_W × STD_H, landscape LAND_W × LAND_H — near-identity
  // resize, no new fetch, at most one small cached crop decode per band per
  // title): top 8% strip veiled by the black top-shade edge alpha
  // (0.75·topShade/100; topShade = 0 or topShadeHeight = 0 = no veil) for rank/extra, bottom 8%
  // strip veiled by blurDarkness ONLY when the bottom blur is actually
  // enabled for genre. Two-band approximation, NOT per-badge pixel-exact:
  // explicit offsets can move a badge outside its band (anchor-nearest still
  // applies); vignette/pre-release/side scrims are not modeled
  // (conservative). Manual `ac=` overrides bypass adaptation byte-identically;
  // without extraction the genre/gray fallbacks keep the legacy fixed 5/12
  // normalization byte-identically (every GENRE_FALLBACK entry, Comedy
  // included); without a band sample the extracted tint does too. Blur keeps
  // the natural tint (never the adapted badge). Fresh/Card chrome is
  // suppressed below (`!isFresh && !isCard` gates) so their fixed looks are
  // untouched — only a standard automatic colored extra reused inside
  // Fresh/Card adapts through this shared path. Provider-glass/neutral fixed
  // palettes never pass through here.
  const needsTopAdaptive = !!topBadge && !showComingSoon && topPaintsAccent && !accentOverride?.rankColor && !!sceneTintHex
  const needsBottomAdaptive = (genrePaintsAccent || stepPaintsAccent) && !accentOverride?.genreColor && !!sceneTintHex
  const [topBand, bottomBand] = await Promise.all([
    needsTopAdaptive
      ? topBandMeanRGB(posterBuf, {
          cacheKey: analysisKey ? `accent:${analysisKey}` : null,
          canvasW: CW,
          canvasH: CH,
        }).catch(() => null)
      : Promise.resolve(null),
    needsBottomAdaptive
      ? bottomBandMeanRGB(posterBuf, {
          cacheKey: analysisKey ? `accent:${analysisKey}` : null,
          canvasW: CW,
          canvasH: CH,
        }).catch(() => null)
      : Promise.resolve(null),
  ])
  const topBgLum = topBand ? effectiveTopBackgroundLuminance(topBand, topShade, topShadeHeight) : null
  const bottomBgLum = bottomBand ? effectiveBottomBackgroundLuminance(bottomBand, blurDarkness, blurEnabled) : null
  const accentColorGenre = accentOverride?.genreColor ?? adaptiveAccentHexForBand(sceneTintHex, GENRE_FALLBACK[genreName || ""] || "#555555", bottomBgLum)
  const accentColorRank = accentOverride?.rankColor ?? adaptiveAccentHexForBand(sceneTintHex, "#555555", topBgLum)
  // Styles that ignore the accent keep the legacy stable value in the
  // STANDARD badge cache keys/renders below: no per-title tint means no new
  // cache color and no key churn when an extraction ran for another consumer
  // (e.g. the blur overlay). The rendered bitmaps are identical either way
  // (the builders ignore the accent for these styles). Presets, the Card
  // main badge and consuming styles keep the adaptive values above.
  const genreStdAccent = genrePaintsAccent
    ? accentColorGenre
    : (accentOverride?.genreColor ?? normalizeAutomaticAccentHex(GENRE_FALLBACK[genreName || ""] || "#555555"))
  const rankStdAccent = (!!topBadge && !showComingSoon && topPaintsAccent)
    ? accentColorRank
    : (accentOverride?.rankColor ?? normalizeAutomaticAccentHex("#555555"))

  // Override esplicito `ac=` vince sempre; poi tinta di scena; rete di sicurezza: fallback genere
  const blurTintHex = accentOverride?.genreColor ?? sceneTintHex ?? (GENRE_FALLBACK[genreName || ""] || "#555555")

  // Gradino dei rating separati (`notch-*`): genere/anno del gradino alto con i
  // flag RAW dell'utente (la soppressione bottom vale solo per il badge genere
  // standard), e riserva del logo titolo con l'altezza VERA dei due livelli —
  // non quella della colonna equivalente: un gradino a filo del bordo coprirebbe
  // un titolo basso (portrait). In landscape il gradino è ancorato a destra e il
  // contenimento resta orizzontale (shrink della riga sul logo).
  const notchStepRawGenre = input.freshRawBadgeGenre ?? badgeGenre
  const notchStepRawYear = input.freshRawBadgeYear ?? badgeYear
  const notchStepLabel = isNotchSeparateRatingsStyle(effBottomStyle)
    ? notchSeparateStepText({
        genre: notchStepRawGenre && genreName ? genreName : null,
        year: notchStepRawYear && year ? year : null,
      })
    : ""
  const notchStepReservePx = notchStepLabel.length > 0 || isNotchSeparateRatingsStyle(effBottomStyle)
    ? notchSeparateStepBodyHeight(badgePw, separateBadgeScale, {
        bottom: (input.separateRatings?.length ?? 0) > 0,
        top: notchStepLabel.length > 0,
      })
    : 0
  // `bottomMarginPct` = margine del fondo logo dal bordo canvas (il `topOffset`
  // portrait abbassa il logo di altri 10px, quindi entra nella riserva).
  const notchStepLogoMarginPct = notchStepReservePx > 0 && !isLandscape && !isFresh && !isCard
    ? Math.max(12, Math.ceil(((notchStepReservePx + 6 + PORTRAIT_LOGO_TOP_OFFSET) * 100) / CH))
    : null

  // Logo baked-in in entrambi i formati (hideLogo esplicito lo salta:
  // veicolo del banner Nuvio pulito). In landscape valgono i vincoli del
  // canvas 16:9 — stessi di context.tsx e poster-fit-score.ts (Golden Rule).
  // Ancora d'angolo del logo: SOLO Standard (Fresh/Card hanno il proprio motore
  // di layout e la ignorano). "auto" = percorso storico byte-identico.
  const logoAnchorEff: LogoAnchor = !isFresh && !isCard && isActiveLogoAnchor(logoAnchor) ? logoAnchor : "auto"
  // Logo ancorato sul bordo alto: network/qualità cedono il passo (sotto il logo).
  const logoTopAnchored = isTopLogoAnchor(logoAnchorEff)
  // Riga centrale (ml/mc/mr): corpo centrato, niente calibrazione Y landscape
  // della fascia bassa (`LANDSCAPE_LOGO_SHIFT_Y` resta solo auto e riga b).
  const logoMidAnchored = isActiveLogoAnchor(logoAnchorEff) && anchorRow(logoAnchorEff) === "m"
  const [blurOverlay, logoResult] = await Promise.all([
    applyBlur({
      posterBuf: freshBaseBuf,
      blurEnabled,
      blurHeight,
      blurIntensity,
      blurFade,
      blurDarkness,
      tintStrength: tintStrength / 100,
      canvasW: CW,
      canvasH: CH,
      accentColor: blurTintHex,
    }),
    logoFetch && !hideLogo
      ? (async () => {
          const lMeta = await sharp(logoFetch).metadata()
          const lw = lMeta.width || 200
          const lh = lMeta.height || 100
          // Single source: logoDefaultScaleFromAspect (logo-selection.ts).
          // (lw/lh hanno sempre fallback > 0, niente guardia null.)
          // Fresh EFFETTIVO + scala auto (null) = 100 (task8a: il default
          // Fresh non segue la curva aspect da 75 — impostazione 100, non
          // canvas 100%: il bound resta il title cap fresh + canvas).
          // Espliciti (anche 75) invariati; fallback Standard effettivo
          // (fresh+ranked senza rank valido) resta sulla curva aspect.
          const defScale = isFresh && logoScale == null
            ? FRESH_TITLE_LOGO_DEFAULT_SCALE
            : (logoDefaultScaleFromAspect(lw, lh) ?? 75)
          const uScale = logoScale ?? defScale
          const uOx = logoOffsetX ?? 0
          const uOy = logoOffsetY ?? 0
          const layout = computeLogoLayout({
            posterW: CW, posterH: CH, logoW: lw, logoH: lh,
            logoScale: uScale,
            // Calibrazione geometrica landscape invisibile agli slider (+10 X /
            // -10 Y): si somma agli offset utente espliciti (anche 0), come
            // PORTRAIT_LOGO_TOP_OFFSET in portrait. Gli slider mostrano 0.
            // Con ancora attiva niente calibrazione X (gli offset sono relativi
            // all'angolo); la Y resta solo per le ancore basse (stessa quota
            // storica sopra la zona genere), non per quelle alte.
            logoOffsetX: uOx + (isLandscape && logoAnchorEff === "auto" ? LANDSCAPE_LOGO_SHIFT_X : 0),
            logoOffsetY: uOy + (isLandscape && !logoTopAnchored && !logoMidAnchored ? LANDSCAPE_LOGO_SHIFT_Y : 0),
            anchor: logoAnchorEff,
            hasBadges: logoHasBadges,
            // Fondo logo in linea col badge genere (~10px dal bordo, vedi
            // costanti landscape in logo-layout.ts). In portrait margine
            // maggiorato solo col badge genere (12% vs 10% storico).
            bottomMarginPct: isLandscape ? LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT : (notchStepLogoMarginPct ?? (logoHasBadges ? 12 : undefined)),
            // Vincoli logo per formato (stessi di context.tsx e
            // poster-fit-score.ts): portrait cap solo altezza + calibrazione
            // +10px; landscape contenuto 40% larghezza / 24% altezza.
            // Fresh EFFETTIVO: l'utente comanda fino al canvas — i cap di
            // formato standard cadono SEMPRE (auto e esplicito condividono lo
            // stesso percorso: auto fresh vale 100 come esplicito 100, quindi
            // auto==esplicito100 byte-identici; l'unico bound resta il title
            // cap fresh, ingrandito della stessa % nel blocco 6b, più il
            // canvas). Standard e fallback Standard (ranked senza rank)
            // restano storici, quindi i render neutrali non-fresh sono
            // byte-identici.
            ...(isFresh
              ? {}
              : (isLandscape
                ? { maxWidthPct: LANDSCAPE_LOGO_MAX_WIDTH_PCT, maxHeightPct: LANDSCAPE_LOGO_MAX_HEIGHT_PCT, topOffset: LANDSCAPE_LOGO_TOP_OFFSET }
                : {
                    maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT,
                    topOffset: PORTRAIT_LOGO_TOP_OFFSET,
                  })),
            align,
          })
          const resized = await resizeLogoCached(logoFetch, layout.width, layout.height, logoSrc)
          const aW = resized.w
          const aH = resized.h
          return { input: resized.input, top: Math.max(0, Math.round(layout.top + (layout.height - aH))), left: Math.round(layout.left + ((layout.width - aW) / 2)), w: aW, h: aH } as const
        })()
      : Promise.resolve(null),
  ])

  // -----------------------------------------------------------------------
  // 3. Vignette + logo (il blur resta un overlay grezzo, composto nel passo 7)
  // -----------------------------------------------------------------------
  const vigBuf = await getVignette(CW, CH)
  // Fresh/Card: leggibilità via shade dedicata (composeFreshOverlay) / skin vetro, non vignetta.
  if (!isFresh && !isCard) composites.push({ input: vigBuf, top: 0, left: 0 })
  // Cinematic Left: scrim d'angolo per la leggibilità del blocco a sinistra
  // (si somma alla fascia blur bassa, che resta controllata dall'utente).
  if (isLandscapeLeft && !isFresh && !isCard) {
    composites.push({ input: await getLandscapeScrim(), top: 0, left: 0 })
  }
  // Velo pre-digitale: sopra poster/vignetta ma sotto logo e badge (restano
  // luminosi e leggibili). Stato del contenuto con il proprio selettore
  // (`preRelease`), indipendente dal master "Badge extra" e dalle classifiche.
  // Solo fase "non ancora uscito": un film già in sala mostra il solo badge
  // "Al cinema", con artwork nitido e non scurito (la sfocatura finale è
  // legata a `showComingSoon`, quindi già assente in questa fase).
  // Costante cachata, nessun cambio di output a flag spento.
  if (preRelease && !preInTheaters) {
    composites.push({ input: await getPreReleaseDim(CW, CH), top: 0, left: 0 })
  }
  // Ombra lineare superiore (default 50 × 25% canvas): sopra vignetta/velo
  // ma sotto logo e badge (restano luminosi). A forza 0 o altezza 0 nessun
  // composite (zero pixel cambiati).
  if (topShade > 0 && topShadeHeight > 0) {
    composites.push({ input: await getTopShade(CW, CH, topShade, topShadeHeight), top: 0, left: 0 })
  }
  // Ancora d'ordine della cornice stagionale (contratto sotto-chrome): a
  // questo punto `composites` contiene SOLO sfondo/trattamento immagine
  // (backdrop, vignetta, scrim landscape, velo pre-release, ombra superiore)
  // — l'ultimo elemento è l'ultimo trattamento prima di QUALSIASI chrome
  // (logo, badge, overlay Fresh/Card, in entrambi i formati). La sezione 7
  // inserisce la cornice subito dopo di esso: sopra il trattamento, sotto
  // tutto il chrome, in ogni layout senza esclusioni. Senza trattamento
  // l'ancora resta null e la cornice va in testa (comunque sotto il chrome).
  let seasonalFrameAfter: PosterComposite | null = null
  if (composites.length > 0) seasonalFrameAfter = composites[composites.length - 1]
  // Fresh: il logo titolo riusa il bitmap già ridimensionato ma ancorato in
  // basso a destra (composeFreshOverlay) — qui nessun composite storico.
  // Card: il bitmap riusato alimenta lo slot titolo dentro la card (blocco
  // 6c) — qui nessun composite storico.
  let logoScrimLayer: { top: number } | null = null
  if (logoResult && !isFresh && !isCard) {
    // Rete di sicurezza per la leggibilità: quando il logo e la fascia di poster
    // sotto hanno quasi la stessa luminosità, il logo sparisce. La selezione a
    // monte prova già a evitarlo, ma su un titolo con un solo logo e un solo
    // poster non c'è niente da scegliere. La velatura è proporzionale a quanto
    // manca alla soglia: sopra 3:1 non dipinge nemmeno un pixel.
    const scrim = await (async () => {
      if (logoScrimDisabled) return null
      const [inkLum, zoneLum] = await Promise.all([
        logoInkLuminance(logoFetch!),
        posterLogoZoneLuminance(posterBuf, { left: logoResult.left, top: logoResult.top, width: logoResult.w, height: logoResult.h }),
      ])
      const strength = logoScrimStrength(logoContrast(inkLum, zoneLum))
      if (strength <= 0) return null
      const png = await buildLogoScrim(logoResult.w, logoResult.h, strength, (inkLum ?? 0) > 0.5, CW, CH)
      if (!png) return null
      const meta = await sharp(png).metadata()
      const sw = meta.width ?? 0
      const sh = meta.height ?? 0
      // Anche centrata, la velatura può sporgere: sharp rifiuta un composite che
      // esce dalla tela, quindi la posizione si blocca dentro i bordi.
      return {
        input: png,
        top: Math.min(Math.max(0, Math.round(logoResult.top + logoResult.h / 2 - sh / 2)), Math.max(0, CH - sh)),
        left: Math.min(Math.max(0, Math.round(logoResult.left + logoResult.w / 2 - sw / 2)), Math.max(0, CW - sw)),
      }
    })().catch(() => null)
    if (scrim) { composites.push(scrim); logoScrimLayer = scrim }
    composites.push(logoResult)
  }

  // -----------------------------------------------------------------------
  // 4. Badge computation — vedi passo 0 sopra: badgeInput/computed/topBadge/
  // Coming Soon sono già risolti prima dei layer (decidono `isFresh` via
  // `isEffectiveFreshLayout`).
  // -----------------------------------------------------------------------

  // Network logo (parallel with badge render) — SVG first, TMDB fallback
  const netLogoEnabled = networkLogo ?? (qNetLogo !== null ? qNetLogo !== "0" : (sd.networkLogo !== false && (mapping?.networkLogo ?? true) !== false))
  // Se i candidati dettagliati sono disponibili, usali (con logo_path); altrimenti fallback a soli nomi per retrocompat.
  const hasDetailed = !!(tmdbNetworksDetailed?.length || productionCompaniesDetailed?.length)
  const detailedCandidates: NetworkCandidate[] = hasDetailed
    ? [
        ...(tmdbNetworksDetailed ?? []),
        ...(productionCompaniesDetailed ?? []),
        // Wikidata studios non hanno logo_path TMDB -> solo name
        ...wikidataResult.studios.map((s) => ({ name: s, logoPath: null as string | null })),
        ...tmdbStudios.map((s) => ({ name: s, logoPath: null })),
        ...(isNetStudio ? [] : studioBadge ? [{ name: studioBadge, logoPath: null as string | null }] : []),
        // Mapping salvato come fallback extra (se presente)
        ...(mapping?.networkLogoName ? [{ name: mapping.networkLogoName!, logoPath: mapping.networkLogoPath ?? null }] : []),
      ]
    : []
  const stringCandidates = [
    ...tmdbNetworks,
    ...productionCompanies,
    ...wikidataResult.studios,
    ...tmdbStudios,
    isNetStudio ? null : studioBadge,
  ].filter(Boolean) as string[]
  // Unifica: se abbiamo detailed, usiamo hybrid; altrimenti legacy string path
  const networkCandidatesHybrid: (NetworkCandidate | string)[] = hasDetailed ? detailedCandidates : stringCandidates

  // NOTE: no polarity override here by design — the composited mark is the
  // raw brand artwork and `topLight` does not repaint it (it only tints the
  // positioning pill and the Marvel wordmark). A per-brand inconsistent
  // override is worse than a uniform inert one: house polarity validates but
  // stays reserved for this family (see the support matrix).

  // B1: pass pill + raw in parallelo (prima sequenziali). Semantica
  // preservata: il raw resta usato solo se la pill matcha (stesso match,
  // resa diversa: pill stilizzata vs colori originali). Il doppio
  // download/scan TMDB è eliminato dalla memo in network-svgs.
  // Download dei loghi provider in parallelo al ramo network (mai throw → null).
  const watchRowPromise = watchProviders && watchProviders.length > 0
    ? renderWatchProviderRow(watchProviders, Math.round(badgePw * 0.09))
    : Promise.resolve(null)
  let [pillLogoResult, rawLogoResult] = netLogoEnabled
    ? await Promise.all([
        hasDetailed
          ? renderFirstMatchingNetworkLogoBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], badgePw, topLight, undefined, disabledNetworks)
          : renderFirstMatchingNetworkLogoBadge(stringCandidates, badgePw, topLight, disabledNetworks),
        hasDetailed
          ? renderFirstMatchingNetworkRawBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], badgePw, topLight, undefined, disabledNetworks)
          : renderFirstMatchingNetworkRawBadge(stringCandidates, badgePw, topLight, disabledNetworks),
      ])
    : [null, null]
  // Demo samples network fallback: the ordered candidates above keep full
  // priority (real brands, wikidata studios, saved mapping); the bundled
  // brand renders solely when nothing matched. Same renderer, zero network.
  if (netLogoEnabled && !pillLogoResult && input.demoSamples) {
    const demoCandidates = [{ name: DEMO_SAMPLE_NETWORK.name, logoPath: DEMO_SAMPLE_NETWORK.logoPath }]
    pillLogoResult = await renderFirstMatchingNetworkLogoBadgeHybrid(demoCandidates, badgePw, topLight, undefined, disabledNetworks)
    rawLogoResult = pillLogoResult
      ? await renderFirstMatchingNetworkRawBadgeHybrid(demoCandidates, badgePw, topLight, undefined, disabledNetworks)
      : null
  }
  // "Dove guardare": con provider disponibili la fila sostituisce il logo
  // network (stesso slot/bitmap, quindi stesso layout). Vuota o con download
  // falliti → null e il ramo network sopra resta com'è oggi.
  const watchRow = await watchRowPromise
  if (watchRow) {
    pillLogoResult = { ...watchRow, networkKey: "__watch_providers", matchedName: "watch-providers" }
    rawLogoResult = pillLogoResult
  }
  const networkLogoResult = pillLogoResult
  // Network: sempre visibile quando abilitato, subito sopra il logo film, quasi attaccato — SVG resta raw, TMDB fallback è A (ricolor + ombra) per non risultare scuro.
  const networkRawResult = networkLogoResult ? rawLogoResult : null

  // An auto extra badge repeating the visibly drawn provider is redundant
  // (M: "Sky" pill + NOW mark = same Sky information twice). The legacy
  // branch below is HEAD behavior, kept byte-for-byte (manual custom text
  // matching a legacy provider is still suppressed, as before). Only the
  // Sky-family predicate guards on manual text (`manualOverride` inside
  // `shouldSuppressExtraTopBadgeForNetwork`): manual Sky/NOW text keeps
  // rendering next to the logo. A disabled/missing logo keeps the badge
  // (useful, not redundant); rank/award/other families fall through
  // untouched (Sky-family equivalence only, no substring heuristics).
  if (networkLogoResult && topBadge && topBadge.type === "extra") {
    const lbl = topBadge.label.toLowerCase().trim()
    const netName = networkLogoResult.matchedName.toLowerCase().trim()
    if (lbl === netName || lbl.includes(netName) || isNetworkStudio(topBadge.label)) {
      topBadge = null
    } else if (
      shouldSuppressExtraTopBadgeForNetwork({
        label: topBadge.label,
        type: topBadge.type,
        manualOverride: !!gatedQueryExtra,
        networkLogo: {
          networkKey: networkLogoResult.networkKey,
          matchedName: networkLogoResult.matchedName,
        },
      })
    ) {
      topBadge = null
    }
  }

  // Award logo mode: the top badge is an award/nomination ONLY when the
  // displayed extra badge is exactly the one produced by the canonical award
  // lookup (no manual `extra`, no Coming Soon override, no network
  // suppression). The key comes from `computeTopBadge` (canonical award
  // identity), never from the localized label; non-award extras stay textual.
  const awardLogoTopKey: AwardBadgeKey | null =
    awardBadgeStyle === "logo"
    && !gatedQueryExtra
    && topBadge?.type === "extra"
    && computed.badge?.type === "extra"
    && topBadge.label === computed.badge.label
      ? computed.awardBadgeKey
      : null
  // Caption of the award logo pill: the SAME short localized name the textual
  // badge uses (never an English literal in the renderer). It is a render
  // input of the bitmap, so it enters the cache key below.
  const awardLogoTopCaption: string | null = awardLogoTopKey
    ? awardShortName(awardLogoTopKey, t)
    : null

  // -----------------------------------------------------------------------
  // 5. Render genre + ranking badges (parallel with coalescing)
  // -----------------------------------------------------------------------
  // Anime ranking: il badge anime mostra il numero grande con "anime" sotto.
  // Rilevato quando il topBadge è un rank derivato da animeRankResult.
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
  const effComingSoonSide = ribbonSide === "right" ? "right" : "left"
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
  // Fresh/Card disegnano il glifo nella propria riga genere: se l'overlay lo
  // ha posato il fallback standalone non serve.
  let typeIconInlineAux = false
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
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isQualityItemId(id))),
  ) ?? "items0"
  const separateItemKey = serializeBadgeItemTransforms(
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isRatingItemId(id))),
  ) ?? "items0"
  // Only the corrections of a family are handed to its renderer: an A/V mark
  // correction can never detach a rating pill and vice versa.
  const itemTransformsForQuality = Object.freeze(
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isQualityItemId(id))),
  )
  const itemTransformsForSeparate = Object.freeze(
    Object.fromEntries(Object.entries(effectiveItemTransforms).filter(([id]) => isRatingItemId(id))),
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

  // Render standard dei due slot superiori (genere + classifica).
  const renderStandardGenre = async (): Promise<BadgeRender | null> =>
    genreBadgeKey
      ? (cacheGet<BadgeRender>(genreBadgeKey)
          || coalesceBadgeRender(genreBadgeKey, () =>
                renderGenreBadge(genreName ?? "", voteAverage ?? 0, badgePw, year, badgeStyle, genreStdAccent, genreLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: badgeRating, typeIcon: genreTypeIcon }, badgeStyle === "bar" ? genreBadgeScale : 100, badgeFont)
                .then((r) => { if (r) cacheSet(genreBadgeKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null)
  const renderStandardRank = async (): Promise<BadgeRender | null> =>
    rankBadgeKey
      ? (cacheGet<BadgeRender>(rankBadgeKey)
          || coalesceBadgeRender(rankBadgeKey, () => {
              if (topBadge!.type === "extra") {
                // Extra badges render with the standalone style when set, else
                // the legacy `rs` fallback (plus the no-ribbon accent rule).
                // The follow-rank sentinel normalizes to null (own-rank).
                const renderText = () => renderExtraBadge(topBadge!.label, topBadgePw, topBadgeLight, normalizeExtraBadgeStyleForRender(extraBadgeStyle) ?? (rankingBadgeAccent ? "colored" : rankingBadgeStyle), rankStdAccent, isRankDetached, badgeFont)
                // Award logo mode: canonical award icon on the shared
                // anthracite pill. A missing/unreadable asset falls back to
                // the historic textual badge (never a failed render).
                const rendered = awardLogoTopKey
                  ? renderAwardLogoBadge(awardLogoTopKey, topBadgePw, { caption: awardLogoTopCaption ?? undefined, font: badgeFont }).then((r) => r ?? renderText())
                  : renderText()
                return rendered
                  .then((r) => { const v = { ...r, isRank: false }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
              }
              return renderRankingBadge((topBadge as { rank: number }).rank, isRibbonRankingStyle(rankingBadgeStyle) ? badgePw : topBadgePw, topBadge!.label, topBadgeLight, rankingBadgeStyle, rankStdAccent, ribbonSide, isAnimeRank, isRankDetached, rankingBadgeAccent, (topBadge as { ribbonLabel?: string }).ribbonLabel, badgeFont)
                .then((r) => { const v = { ...r, isRank: true }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
            }))
      : Promise.resolve(null)
  const [genreBadgeResult, rankBadgeResult, qualityBadgeResult, comingSoonResult] = await Promise.all([
    renderStandardGenre(),
    renderStandardRank(),
    qualityBadgeKey
      ? (cacheGet<QualityBadgeGroupResult>(qualityBadgeKey)
          || coalesceBadgeRender(qualityBadgeKey, async () => {
              // Gruppo con qualità/formati/stile-età EFFETTIVI (legacy-gated):
              // con bq=0 l'age-only non resuscita il tech stack disabilitato.
              const res = await renderQualityBadgeGroup(effectiveQuality ?? null, effQualityBadgeStyle, effectiveFormats, badgePw, effQualityTopLight, badgeFont, hasAgeBadge ? ageText : null, effAgeBadgeStyle, itemTransformsForQuality, effQualityGroupLayout, notchEdge)
              if (res) cacheSet(qualityBadgeKey, res, ["badge"], BADGE_CACHE_TTL)
              return res
            }))
      : Promise.resolve(null),
    comingSoonKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(comingSoonKey)
          || coalesceBadgeRender(comingSoonKey, () =>
              renderComingSoonRibbon(effComingSoonLabel, badgePw, effComingSoonSide, badgeFont)
                .then((r) => { if (r) cacheSet(comingSoonKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null),
  ])

  // -----------------------------------------------------------------------
  // 6. Position badges + network logo
  // -----------------------------------------------------------------------
  // Scale %: resize dei bitmap dopo il render (tutti gli stili; la barra
  // genere scala nativa via font nel builder per restare full-width), prima
  // del fit — così fitBadgeToCanvas garantisce comunque il contenimento nel
  // canvas. B2: 4 await sequenziali → un Promise.all.
  // La cache resta valida (chiave senza scala): la scala si applica a valle.
  // Tutta la matematica di posizione/overlap sotto usa già le dimensioni
  // scalate. La posizione del badge genere usa safeGenreBadgeResult.h.
  let [rankBadgeForLayout, genreBadgeForLayout, qualityBadgeForLayout, networkLogoForLayout] = await Promise.all([
    rankBadgeResult
      ? (async () => {
          // Landscape: scala % + riduzione -20px in UN solo resize (prima due
          // resize sharp in serie sullo stesso bitmap). Stesse dimensioni
          // finali del vecchio codice, un solo passaggio di ricampionamento.
          if (shape === "landscape") {
            const scaledH = Math.max(1, Math.round(rankBadgeResult.h * effTopBadgeScale / 100))
            const scaledW = Math.max(1, Math.round(rankBadgeResult.w * effTopBadgeScale / 100))
            const targetH = Math.max(1, scaledH - 20)
            const targetW = Math.max(1, Math.round(scaledW * (targetH / scaledH)))
            if (targetH !== rankBadgeResult.h || targetW !== rankBadgeResult.w) {
              const png = await sharp(rankBadgeResult.png).resize(targetW, targetH).toBuffer()
              const bleed = rankBadgeResult.bleed
                ? scaleBadgeBleed(rankBadgeResult.bleed, targetW / rankBadgeResult.w, targetH / rankBadgeResult.h)
                : undefined
              return { ...rankBadgeResult, png, w: targetW, h: targetH, ...(bleed ? { bleed } : {}) }
            }
            return rankBadgeResult
          }
          return effTopBadgeScale !== 100
            ? await scaleBitmapForLayout(rankBadgeResult, effTopBadgeScale)
            : rankBadgeResult
        })()
      : Promise.resolve(null),
    genreBadgeResult && genreBadgeScale !== 100 && badgeStyle !== "bar"
      ? scaleBitmapForLayout(genreBadgeResult, genreBadgeScale)
      : Promise.resolve(genreBadgeResult),
    qualityBadgeResult && effQualityGroupScale !== 100
      ? scaleBitmapForLayout(qualityBadgeResult, effQualityGroupScale)
      : Promise.resolve(qualityBadgeResult),
    networkRawResult
      ? (async () => {
          return networkLogoScale !== 100
            ? await scaleBitmapForLayout(networkRawResult, networkLogoScale)
            : networkRawResult
        })()
      : Promise.resolve(null),
  ])
  // Riga rating custom: resa qui (non più nel blocco sotto) perché "sotto il
  // logo" ne misura l'altezza per ridurre genere + riga finché stanno sotto.
  let customRowBitmap: Awaited<ReturnType<typeof renderMultiRatings>> | null = null
  if (badgesEnabled !== false && input.ratings?.length && !isBottomStyle && !isFresh && !isCard) {
    // Optional enrichment must never prevent the original poster from rendering.
    customRowBitmap = await renderMultiRatings(input.ratings, CW - 40, genreBadgeLight, badgeFont).catch(() => null)
  }
  // Box visibile del logo (inchiostro, non la tela con padding trasparente) e
  // margine inferiore della fascia genere/rating per le posizioni relative:
  // stesse quote dell'Auto (centro badge a `targetCenter` dal fondo), così
  // "sotto il logo" non perde spazio rispetto al "bottom center".
  const relGapPx = Math.round(8 * CH / 570)
  const relMarginPx = Math.round(18 * CH / 570)
  const relAny = !!logoResult && (netRel !== null || qualityRel !== null || bottomRel !== null || topRel !== null)
  const relLogoInk = relAny && logoResult ? await inkBounds(logoResult.input) : null
  const relBandBottomMargin = genreBadgeForLayout
    ? Math.max(0, Math.round(targetCenter - badgeBody(genreBadgeForLayout).h / 2))
    : relMarginPx
  // Badge che chiedono un lato del logo, in ordine d'impilamento (fascia,
  // qualità, network, rank/extra); misura sui bitmap pre-fit (la colonna
  // separati collegata alla qualità non è inclusa).
  const relEntries: RelEntry[] = []
  if (relAny) {
    const gH = genreBadgeForLayout ? badgeBody(genreBadgeForLayout).h : 0
    const rH = customRowBitmap?.h ?? 0
    if (bottomRel) relEntries.push({ key: "band", side: bottomRel, h: gH + rH + (gH > 0 && rH > 0 ? relGapPx : 0), bm: relBandBottomMargin })
    if (qualityRel && qualityBadgeForLayout) relEntries.push({ key: "quality", side: qualityRel, h: badgeBody(qualityBadgeForLayout).h, bm: relMarginPx })
    if (netRel && networkLogoForLayout) relEntries.push({ key: "network", side: netRel, h: badgeBody(networkLogoForLayout).h, bm: relMarginPx })
    if (topRel && rankBadgeForLayout) relEntries.push({ key: "top", side: topRel, h: badgeBody(rankBadgeForLayout).h, bm: relMarginPx })
  }
  // Logo in Auto: se i badge "sotto il logo" scalerebbero sotto LOGO_LIFT_TARGET_SCALE,
  // il logo sale quanto serve (max LOGO_LIFT_MAX_FRAC del canvas) per tenerli più
  // grandi e omogenei. Solo ancora logo Auto e nessun badge richiesto sopra (non
  // gli si toglie spazio); ancora manuale = il logo non si muove mai.
  if (relAny && logoResult && logoAnchorEff === "auto" && !relEntries.some((e) => e.side === "above" && e.h > 0)) {
    const es = relEntries.filter((e) => e.side === "below" && e.h > 0)
    if (es.length > 0) {
      const total = es.reduce((n, e) => n + e.h, 0)
      const gaps = (es.length - 1) * relGapPx
      const inkTop0 = logoResult.top + (relLogoInk?.y ?? 0)
      const inkBottom0 = inkTop0 + (relLogoInk?.h ?? logoResult.h)
      const room = CH - es[es.length - 1].bm - (inkBottom0 + relGapPx)
      const need = Math.ceil(total * LOGO_LIFT_TARGET_SCALE) + gaps
      const lift = Math.min(Math.max(0, need - room), Math.round(CH * LOGO_LIFT_MAX_FRAC), Math.max(0, inkTop0 - 2 * relMarginPx))
      if (lift > 0) {
        (logoResult as { top: number }).top -= lift
        if (logoScrimLayer) logoScrimLayer.top = Math.max(0, logoScrimLayer.top - lift)
      }
    }
  }
  const relLogoTop = logoResult ? logoResult.top + (relLogoInk?.y ?? 0) : 0
  const relLogoBottom = logoResult ? relLogoTop + (relLogoInk?.h ?? logoResult.h) : 0
  // Posizioni "sopra/sotto il logo": se un badge non entra dal lato chiesto (tra
  // il logo e il margine, dopo i badge già impilati su quel lato) si riduce
  // (shrink-only, floor BELOW_LOGO_MIN_SCALE) invece di ribaltarsi sull'altro
  // lato. Sotto il floor resta il ribaltamento.
  if (relAny && logoResult) {
    // Scala comune per lato: tutti i badge che chiedono lo stesso lato si
    // riducono insieme (altrimenti i primi impilati consumano lo spazio e
    // l'ultimo finisce a scala minima e ribaltato).
    const entries = relEntries
    const sideScale = (side: LogoRelativePosition): number => {
      const es = entries.filter((e) => e.side === side && e.h > 0)
      if (es.length === 0) return 1
      const total = es.reduce((n, e) => n + e.h, 0)
      const gaps = (es.length - 1) * relGapPx
      const room = side === "above"
        ? relLogoTop - relGapPx - relMarginPx
        : CH - es[es.length - 1].bm - (relLogoBottom + relGapPx)
      if (room <= 0 || total + gaps <= room) return 1
      return Math.max(BELOW_LOGO_MIN_SCALE, Math.floor(((room - gaps) / total) * 100) / 100)
    }
    const sideK = { above: sideScale("above"), below: sideScale("below") }
    const kOf = (key: RelEntry["key"]): number => {
      const e = entries.find((x) => x.key === key)
      return e ? sideK[e.side] : 1
    }
    const kBand = kOf("band"), kQuality = kOf("quality"), kNetwork = kOf("network"), kTop = kOf("top")
    if (kBand < 1) {
      if (genreBadgeForLayout) genreBadgeForLayout = await scaleBitmapForLayout(genreBadgeForLayout, kBand * 100)
      if (customRowBitmap) customRowBitmap = await scaleBitmapForLayout(customRowBitmap, kBand * 100)
    }
    if (kQuality < 1 && qualityBadgeForLayout) qualityBadgeForLayout = await scaleBitmapForLayout(qualityBadgeForLayout, kQuality * 100)
    if (kNetwork < 1 && networkLogoForLayout) networkLogoForLayout = await scaleBitmapForLayout(networkLogoForLayout, kNetwork * 100)
    if (kTop < 1 && rankBadgeForLayout) rankBadgeForLayout = await scaleBitmapForLayout(rankBadgeForLayout, kTop * 100)
  }
  const [safeGenreBadgeResult, safeRankBadgeResult, safeQualityBadgeResult, safeComingSoonResult] = await Promise.all([
    genreBadgeForLayout ? fitBadgeToCanvas(genreBadgeForLayout, CW, CH) : Promise.resolve(null),
    rankBadgeForLayout ? fitBadgeToCanvas(rankBadgeForLayout, CW, CH) : Promise.resolve(null),
    qualityBadgeForLayout ? fitBadgeToCanvas(qualityBadgeForLayout, CW, CH) : Promise.resolve(null),
    comingSoonResult ? fitBadgeToCanvas(comingSoonResult, CW, CH) : Promise.resolve(null),
  ])

  // Geometria badge per il drag della preview (debug `netgeo=1`): box FINALI
  // effettivamente composti, raccolti agli stessi punti di composite. Puro
  // osservatore: nessun pixel, chiave o cache cambia. Vuoto = nessun overhead.
  const badgeGeo: Partial<Record<BadgeGeometryFamily, BadgeGeometryBox>> = {}
  const badgeGeoFixedX: Partial<Record<BadgeGeometryFamily, boolean>> = {}
  // Per-item boxes (see `BadgeGeometryReport.items`).
  const badgeGeoItems: BadgeGeometryItem[] = []
  // Bitmap del gruppo qualità come composto: il report stringe la sua cornice
  // e quelle dei marchi sull'inchiostro reale (ombre e tela comune escluse).
  // `body` (linguette notch): la lastra nello spazio della bitmap piazzata —
  // la cornice è la lastra, non i raccordi che sporgono lungo il bordo.
  let qualityInkSource: InkSource | null = null
  let separateInkSource: InkSource | null = null
  // Marchi qualità staccati (correzione per-item): composti fuori dal gruppo,
  // la loro cornice si stringe sulla PROPRIA bitmap.
  const qualityDetachedInk = new Map<string, InkSource>()
  const bodyFrame = (src: InkSource) => src.body
    ? { left: src.left + src.body.left, top: src.top + src.body.top, w: src.body.w, h: src.body.h }
    : null
  const scaledBody = (body: { left: number; top: number; w: number; h: number } | undefined, k: number) => body
    ? { left: Math.round(body.left * k), top: Math.round(body.top * k), w: Math.round(body.w * k), h: Math.round(body.h * k) }
    : undefined

  // Rettangolo finale del badge genere (per il contenimento colonna separati
  // sotto: solo shrink quando lo stack sfora, mai enlarge — a scala 100 lo
  // spazio basta sempre e il percorso resta byte-identico).
  let genreBadgeRect: { top: number; left: number; w: number; h: number } | null = null
  // Fresh/Card: la colonna meta sostituisce il badge genere (nessun duplicato).
  if (safeGenreBadgeResult && !isFresh && !isCard) {
    const landscapeShiftX = shape === "landscape" ? -55 : 0
    // Landscape: badge in basso a DESTRA invece che centrato (vale per
    // preview, poster e banner — unica verità visiva). Il portrait resta storico.
    // Micro-calibrazione ottica dell'ancoraggio destro: +40px verso il bordo
    // (clamp anti-overflow: mai fuori canvas).
    const anchorRight = shape === "landscape"
    const anchorShiftX = anchorRight ? 40 : 0
    const rightPadX = Math.round(18 * CW / 380)
    const notchMaterial = notchMaterialOf(badgeStyle)
    if (notchMaterial) {
      // Notch: pillola a filo del bordo basso (come `bar`, Y tuning e shrink
      // anti-logo non si applicano). Portrait centrata, landscape a destra.
      const notchBody = badgeBody(safeGenreBadgeResult)
      const notchLeft = bottomAnchorEff !== "auto"
        ? bottomAnchoredBodyLeft(bottomAnchorEff, notchBody.w, await inkRatios(safeGenreBadgeResult), CW) + combinedGenreOX
        : anchorRight
        ? landscapeRightAnchorLeft(notchBody.w, CW, combinedGenreOX)
        : Math.round((CW - notchBody.w) / 2) + combinedGenreOX
      const notchTop = CH - notchBody.h
      genreBadgeRect = { top: notchTop, left: notchLeft, w: notchBody.w, h: notchBody.h }
      const notchCanvas = badgeCanvasForBody(notchLeft, notchTop, safeGenreBadgeResult)
      const notchLayer = { input: safeGenreBadgeResult.png, top: notchCanvas.top, left: notchCanvas.left }
      if (notchMaterial === "vetro") glassLayers.add(notchLayer)
      pushFam("genre", notchLayer)
    } else if (badgeStyle === "bar") {
      // In landscape la barra è resa a badgePw (non full-width): col banner
      // va a destra come gli altri stili; altrimenti (portrait) resta
      // full-width ancorata a sinistra. (Nel ramo false shape è di certo
      // portrait per costruzione di anchorRight: niente ternario shape.)
      // L'ancora posiziona il corpo visibile; la tela (con eventuale bleed)
      // segue per differenza — senza bleed è l'identico percorso storico.
      const genreBody = badgeBody(safeGenreBadgeResult)
      const barBodyLeft = anchorRight && bottomAnchorEff !== "auto"
        ? bottomAnchoredBodyLeft(bottomAnchorEff, genreBody.w, await inkRatios(safeGenreBadgeResult), CW)
        : anchorRight
        ? Math.min(CW - genreBody.w, Math.max(0, CW - genreBody.w - rightPadX + anchorShiftX))
        : (isLandscapeLeft
          ? logoAlignPadX(CW) + combinedGenreOX
          : 0) + landscapeShiftX
      const barBodyTop = CH - genreBody.h
      genreBadgeRect = { top: barBodyTop, left: barBodyLeft, w: genreBody.w, h: genreBody.h }
      const barCanvas = badgeCanvasForBody(barBodyLeft, barBodyTop, safeGenreBadgeResult)
      pushFam("genre", { input: safeGenreBadgeResult.png, top: barCanvas.top, left: barCanvas.left })
    } else {
      // Offset solo stili centrati: la barra resta ancorata full-width.
      // In Cinematic Left la riga metadati sta sotto il logo a sinistra.
      // Posizione unificata: altezza standardizzata per tutti gli stili, la baseline del testo non salta.
      // Bordo/vetro in landscape: troppo incollati all'angolo → -30px X,
      // -15px Y (con e senza separati: si somma allo shift sep).
      const styleCornerShiftX = anchorRight && (badgeStyle === "bordo" || badgeStyle === "vetro" || badgeStyle === "tinta" || badgeStyle === "sfumato" || badgeStyle === "split") ? 30 : 0
      const styleCornerShiftY = anchorRight && (badgeStyle === "bordo" || badgeStyle === "vetro" || badgeStyle === "tinta" || badgeStyle === "sfumato" || badgeStyle === "split") ? 15 : 0
      // Ombra/minimale in landscape: testo nudo, +10px verso l'alto per
      // staccarlo dal bordo (con e senza separati).
      const styleLiftY = anchorRight && (badgeStyle === "shadow" || badgeStyle === "minimal") ? 10 : 0
      // In alto (slot libero): corpo sulla griglia superiore di network/qualità
      // (netBaseTop), offset utente applicati come in basso.
      // Fascia inferiore in riga t/m (`banc` tl/tc/tr/ml/mc/mr): il corpo va
      // alla posizione `anchorRect` (t = griglia superiore netBaseTop, m = centrato)
      // + offset Y utente. La riga b resta la quota storica.
      const genreRowTopMargin = Math.round(18 * CH / 570)
      const genreBandRowPos: AnchorPosition | null = isActiveBottomAnchor(bottomAnchorEff) && anchorRow(bottomAnchorEff) !== "b" ? bottomAnchorEff : null
      const genreTopFor = genreAtTop
        ? (h: number) => Math.round(Math.max(0, Math.min(CH - h, Math.round(18 * CH / 570) + combinedGenreOY)))
        : genreBandRowPos
          ? (h: number) => anchorRect(genreBandRowPos, { canvasW: CW, canvasH: CH, w: 0, h, marginX: 0, marginTop: genreRowTopMargin, marginBottom: genreRowTopMargin }).top + combinedGenreOY
          : (h: number) => Math.round(Math.min(CH - h, CH - h - Math.max(0, Math.round(targetCenter - h / 2)) + combinedGenreOY - styleCornerShiftY - styleLiftY))
      // Separati attivi: il segmento ★ sparisce e la pill si restringe —
      // ancorata a destra, la massa visiva andrebbe a destra. Si compensa di
      // metà larghezza rimossa così il centro resta dov'era con ★ (solo
      // landscape: in portrait è già centrato). Misura dal render reale con
      // ★ (stesso builder, chiave cache dedicata: niente stime che
      // divergono con shrink overflow e metriche dei font).
      let sepCenterShift = 0
      if (anchorRight && genreBadgeResult && (input.separateRatings?.length ?? 0) > 0) {
        const fullKey = badgeCacheKey("genre", genreName, voteAverage, CW, year, badgeStyle, badgeFont, genreStdAccent, genreBadgeLight, badgeGenre, badgeYear, true, genreBadgeScale, genreTypeIcon)
        const fullHit = cacheGet<{ png: Buffer; w: number; h: number }>(fullKey)
        const fullW = fullHit
          ? fullHit.w
          : await coalesceBadgeRender(fullKey, () =>
              renderGenreBadge(genreName ?? "", voteAverage ?? 0, badgePw, year, badgeStyle, genreStdAccent, genreBadgeLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: true, typeIcon: genreTypeIcon }, 100, badgeFont)
                .then((r) => { if (r) cacheSet(fullKey, r, ["badge"], BADGE_CACHE_TTL); return r }),
            ).then((r) => (r ? r.w : null), () => null)
        if (fullW != null && fullW > genreBadgeResult.w) {
          sepCenterShift = Math.round(((fullW - genreBadgeResult.w) / 2) * (genreBadgeScale / 100))
        }
      }
      const genreInkRatios = bottomAnchorEff !== "auto" && !genreAtTop ? await inkRatios(safeGenreBadgeResult) : null
      const genreLeftFor = (w: number) => bottomAnchorEff !== "auto" && !genreAtTop
        ? bottomAnchoredBodyLeft(bottomAnchorEff, w, genreInkRatios, CW) + combinedGenreOX
        : anchorRight
        ? landscapeRightAnchorLeft(w, CW, combinedGenreOX - sepCenterShift - styleCornerShiftX)
        : (isLandscapeLeft
          ? logoAlignPadX(CW) + combinedGenreOX
          : Math.round((CW - w) / 2) + combinedGenreOX) + landscapeShiftX
      // L'ancora posiziona il corpo visibile (senza bleed è il percorso
      // storico byte-identico); la tela segue per differenza.
      // Anti-collisione col logo titolo (richiesta utente, sostituisce il
      // vecchio "il logo non rimpicciolisce mai il genere"): se l'INCHIOSTRO
      // del badge (alpha reale, non la riserva d'ombra trasparente) arriva a
      // meno di 6px dal logo, il badge si riduce (shrink-only, floor 0.7, come
      // le righe separate). Il logo non si muove mai.
      // Ancora manuale in basso: nessun riduzione/abbassamento vs logo (il genere
      // resta dov'è; le sovrapposizioni con il logo sono accettate).
      const logoInk = logoResult && !bottomManual ? await inkBounds(logoResult.input) : null
      const logoInkRect = logoResult && logoInk
        ? { left: logoResult.left + logoInk.x, top: logoResult.top + logoInk.y, w: logoInk.w, h: logoInk.h }
        : null
      const logoFit = logoInkRect
        ? await shrinkAwayFromRect(safeGenreBadgeResult, logoInkRect, (body) => ({ top: genreTopFor(body.h), left: genreLeftFor(body.w) }))
        : { badge: safeGenreBadgeResult, dy: 0 }
      if (logoFit.dy !== 0 || logoFit.badge !== safeGenreBadgeResult) displaced.add("genre")
      const genreBox = logoFit.badge
      const genreBody = badgeBody(genreBox)
      const genreTop = Math.max(0, genreTopFor(genreBody.h) + logoFit.dy)
      const genreLeft = genreLeftFor(genreBody.w)
      genreBadgeRect = { top: genreTop, left: genreLeft, w: genreBody.w, h: genreBody.h }
      const genreCanvas = badgeCanvasForBody(genreLeft, genreTop, genreBox)
      const genreLayer = { input: genreBox.png, top: genreCanvas.top, left: genreCanvas.left }
      if (badgeStyle === "vetro") glassLayers.add(genreLayer)
      pushFam("genre", genreLayer)
    }
  }
  if (genreBadgeRect) {
    badgeGeo.genre = { ...genreBadgeRect }
    // Full-width bar (portrait and landscape right-anchored): the X tuning is
    // never applied by the renderer, so a handle on X would be a lie.
    if (badgeStyle === "bar") badgeGeoFixedX.genre = true
  }
  // Riga custom provider: se renderizzata, la colonna separati si nasconde
  // (mai due stack di rating impilati — il provider vince). In modalità
  // bottom la riga non si rende mai (vince il bottom, mai duplicati — anche
  // senza dati: non inventa/fallback provider mentre la route sopprime
  // genere/anno/voto).
  let customRowRendered = false
  // Y di una riga della fascia bottom in posizione t*/m* (banc): stessa ancora
  // del genere. Con genere: t sotto il genere, m sopra (come oggi la riga sta
  // sopra il genere). Senza genere: anchorRect sulla griglia superiore.
  const bandRowTop = (pos: AnchorPosition, h: number): number => {
    const g = genreBadgeRect
    if (g) return Math.max(0, Math.min(CH - h, anchorRow(pos) === "t" ? g.top + g.h + 10 : g.top - h - 10))
    return anchorRect(pos, { canvasW: CW, canvasH: CH, w: 0, h, marginX: 0, marginTop: Math.round(18 * CH / 570), marginBottom: Math.round(18 * CH / 570) }).top
  }
  const ratingBandPos: AnchorPosition | null = isActiveBottomAnchor(bottomAnchorEff) && anchorRow(bottomAnchorEff) !== "b" ? bottomAnchorEff : null
  // Fresh/Card: i valori vivono come righe testo nella colonna meta / banda card (sotto).
  // Custom row belongs to the lower genre/rating group (same `!== false`
  // master as the genre row and the separate-ratings row below): it hides
  // with badges OFF, independently of the top slot, which answers only to
  // `rankingEnabled`.
  if (badgesEnabled !== false && input.ratings?.length && !isBottomStyle && !isFresh && !isCard) {
    // La riga sta sopra il badge genere, in basso: stessa polarità del fondo.
    const row = customRowBitmap
    if (row) {
      const legacyTop = safeGenreBadgeResult && !genreAtTop
        ? (badgeStyle === "bar" || notchMaterialOf(badgeStyle) ? CH - safeGenreBadgeResult.h
          : CH - safeGenreBadgeResult.h - Math.max(0, Math.round(targetCenter - safeGenreBadgeResult.h / 2)) + combinedGenreOY)
        : CH - 20
      const ratingLeft = Math.max(0, Math.min(CW - row.w, bottomAnchorEff !== "auto" ? bottomAnchoredBodyLeft(bottomAnchorEff, row.w, await inkRatios(row), CW) : Math.round((CW - row.w) / 2)))
      const ratingTop = ratingBandPos ? bandRowTop(ratingBandPos, row.h) : Math.max(0, Math.min(CH - row.h, legacyTop - row.h - 10))
      pushFam("rating", { input: row.png, left: ratingLeft, top: ratingTop })
      ratingBox = { left: ratingLeft, top: ratingTop, w: row.w, h: row.h }
      customRowRendered = true
    }
  }
  const isRightRibbon = ribbonSide === "right"
  let finalRankBadge = safeRankBadgeResult as BadgeRender | null
  // finalRankLeft/Top = ancora del CORPO visibile (senza bleed è il percorso
  // storico byte-identico); la tela segue per differenza nel composite.
  let finalRankLeft: number | null = null
  let finalRankTop = 0
  // Composite del corpo rank/extra Standard (per il blocco "sopra/sotto il logo").
  let topRankLayer: PosterComposite | null = null
  if (safeRankBadgeResult) {
    // Il nastro Netflix è ancorato a sinistra SOLO quando il badge è davvero un
    // ranking "netflix" (type rank). Un badge extra va SEMPRE
    // centrato, anche se lo stile selezionato è "netflix": altrimenti esce
    // decentrato a sinistra.
    const isNetflixRibbon =
      isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank"
    // Offset X/Y solo sui centrati: il nastro resta ancorato (per scelta
    // utente esplicita gli offset non lo toccano).
    const isCentered = !isNetflixRibbon
    // The pill (centered or corner) sits 10px below the top edge (fixed
    // editorial measure). Default is flush with the top. Pill/corner only,
    // independent of the quality badge.
    const pillTopGap = topBadgeStyle === "pill" || topBadgeStyle === "tinta" || topBadgeStyle === "sfumato" || isCornerAnchoredStyle(topBadgeStyle) ? 10 : 0
    const rankBody = badgeBody(safeRankBadgeResult)
    let left: number
    if (isNetflixRibbon && isRightRibbon) {
      left = Math.round(CW - rankBody.w) // nastro a destra (Stremio)
    } else if (isNetflixRibbon) {
      left = 0 // nastro Netflix a sinistra (Nuvio, default)
    } else if (isCornerAnchoredStyle(topBadgeStyle) && topBadge) {
      // Corner style: flat pill anchored to the top-left corner
      // (same box margin as the network logo: netPadX) for every top
      // badge, rank or extra. A colliding network logo stacks below the
      // pill via stackNetworkBelowCornerRank; quality avoids it via
      // shrinkToAvoidRank (generic over the top rect).
      // Number style: same anchor, mirrored to the top-right corner with
      // side="right" (the existing ribbon side switch). Corner keeps its
      // historic left anchor (mirrorRight=false).
      const mirrorRight = topBadgeStyle === "number" && ribbonSide === "right"
      // Rank numerals sit on the style baseline (NUMBER_BADGE_BASE_OFFSET_X):
      // the effective offset stays the user adjustment relative to it
      // (stored values untouched, no new params). Extra badges on the legacy
      // `rs=number` fallback keep the historic anchor (no -20 for extra).
      // The final left below feeds the collision rects (quality/network
      // stacking, Coming Soon), so they follow the shifted numeral with no
      // extra change.
      left = cornerAnchoredLeft({
        canvasW: CW,
        badgeW: rankBody.w,
        mirrorRight,
        offsetX: combinedTopOX + resolveNumberBadgeBaseOffsetX(topBadge?.type, topBadgeStyle),
      })
    } else if (topAnchorActive) {
      // Ancora attiva (tl/tr): il corpo centrato va all'angolo scelto, con lo
      // stesso margine netPadX dei corner; offset X relativi all'angolo.
      left = cornerAnchoredLeft({
        canvasW: CW,
        badgeW: rankBody.w,
        mirrorRight: topBadgeAnchorEff === "tr",
        offsetX: combinedTopOX,
      })
    } else {
      // Badge grande al centro, dimensione invariata: in caso di sovrapposizione
      // si rimpiccioliscono i badge laterali (network e qualità agli angoli opposti).
      left = Math.round((CW - rankBody.w) / 2) + combinedTopOX
    }
    finalRankBadge = safeRankBadgeResult
    finalRankLeft = left
    // Corner top badge stacked below a left Coming Soon ribbon sharing its
    // corner (the ribbon itself is untouched); otherwise the fixed top gap.
    // Historic corner keeps its left-only rule. Number mirrors with
    // side="right", so the shared corner is whichever side the numeral sits
    // on: overlap is tested against the real boxes (Coming Soon composite
    // rect + numeral rect at its unstacked candidate top), so explicit
    // tox/toy that move the numeral away don't force a useless stack.
    const isCornerTop = isCornerAnchoredStyle(topBadgeStyle) && !!topBadge
    const comingSoonSharesCorner = topBadgeStyle === "number"
      ? numberSharesComingSoonCorner({
          canvasW: CW,
          hasTopBadge: !!topBadge,
          showComingSoon,
          ribbonSide,
          ribbonW: safeComingSoonResult?.w ?? null,
          ribbonOffset: ribbonLayout?.offset ?? null,
          ribbonExtent: ribbonLayout?.extent ?? null,
          numLeft: left,
          numTop: combinedTopOY + pillTopGap,
          numW: rankBody.w,
          numH: rankBody.h,
        })
      : showComingSoon && !!ribbonLayout && !!safeComingSoonResult && effComingSoonSide !== "right"
    const cornerTop = isCornerTop
      ? cornerRankTop({
          comingSoonLeft: comingSoonSharesCorner,
          ribbonExtent: ribbonLayout?.extent ?? 0,
          gap: Math.round(6 * CH / 570),
          pillTopGap,
        })
      : pillTopGap
    finalRankTop = isCentered ? combinedTopOY + cornerTop : 0
    // Ancora fissa (`tanc`/`xanc` manuale, vedi `topFixedActive`): il corpo va
    // alla posizione `anchorRect` (margini: netPadX laterale, pillTopGap in
    // alto e in basso, specchio del margine superiore) + offset relativi alla
    // posizione. Il nastro Netflix non entra qui (`topFixedActive` lo esclude).
    if (topFixedActive && isActiveTopBadgeAnchor(topBadgeAnchorEff) && isCentered) {
      const fixed = anchorRect(topBadgeAnchorEff, {
        canvasW: CW, canvasH: CH, w: rankBody.w, h: rankBody.h,
        marginX: Math.round(18 * CW / 380), marginTop: pillTopGap, marginBottom: pillTopGap,
      })
      finalRankLeft = fixed.left + combinedTopOX
      finalRankTop = fixed.top + combinedTopOY
    }

    // Il badge centrale resta invariato — la gestione overlap vive nei blocchi
    // network/qualità qui sotto (shrink dei laterali).
  }
  // Occupante centrale dello slot alto per lo shrink dei laterali
  // (network/qualità): il badge rank/extra, o il genere spostato in alto.
  const genreOnTop = genreAtTop && !!genreBadgeRect
  const topCenterRect: { left: number; top: number; w: number; h: number } | null =
    finalRankBadge && finalRankLeft !== null && !topAnchorActive
      ? { left: finalRankLeft, top: finalRankTop, w: badgeBody(finalRankBadge).w, h: badgeBody(finalRankBadge).h }
      : (genreOnTop ? genreBadgeRect : null)
  // Ancora attiva: il corpo nell'angolo non fa shrink dei laterali; i laterali
  // che lo toccano scendono sotto di lui (drop-below, sotto network/qualità).
  const topAnchorRankRect: { left: number; top: number; w: number; h: number } | null =
    topAnchorActive && finalRankBadge && finalRankLeft !== null
      ? { left: finalRankLeft, top: finalRankTop, w: badgeBody(finalRankBadge).w, h: badgeBody(finalRankBadge).h }
      : null
  // Fresh: il rank vive nel numerale vetro (sotto); qui solo gli extra.
  // Card: il rank vive nel numerale della card (blocco 6c); qui solo gli extra.
  if (finalRankBadge && finalRankLeft !== null && !isFresh && !isCard) {
    // La tela segue l'ancora del corpo: il bleed resta complanare, mai un salto.
    const rankCanvas = badgeCanvasForBody(finalRankLeft, finalRankTop, finalRankBadge)
    const rankLayer = { input: finalRankBadge.png, top: rankCanvas.top, left: rankCanvas.left }
    if (topBadgeStyle === "vetro" || topBadgeStyle === "notch-vetro") glassLayers.add(rankLayer)
    composites.push(rankLayer)
    topRankLayer = rankLayer
  }
  // Nastro Coming Soon: angolo in alto (a sinistra; a destra con side="right"), sopra il badge centrale
  // (quando coesistono per custom esplicito) e sopra il velo pre-digitale.
  // Fresh: l'insertion point dei layer fresh è qui — shade/numerale/meta
  // stanno SOPRA velo/ombra (come i badge standard, restano luminosi) ma
  // SOTTO il chrome conservato (Coming Soon, qualità, extra), così la shade
  // non scurisce mai il chrome e il ribbon resta visibile.
  // (Dichiarata qui, usata nel blocco 6b: splice prima del chrome.)
  let freshInsertAt: number | null = null
  if (isFresh) freshInsertAt = composites.length
  // Split-shade anchor (Fresh + active bottom blur only): reference to the
  // bottom legibility shade layer, before which the raw bottom blur/tint
  // overlay interleaves in the final composite (section 7). Identity survives
  // fitCompositeToCanvas (valid layers return unchanged); a miss falls back
  // to the legacy prepend order.
  let freshBottomShadeLayer: PosterComposite | null = null
  if (safeComingSoonResult && ribbonLayout) {
    // Native corner anchor (byte-identical): the ribbon layer carries
    // transparent padding and the negative `-offset` clips it into the
    // corner — clamping the anchor to 0 would shift the ribbon by +offset
    // (GroupC regression). Sharp clips out-of-bounds composites natively,
    // so the negative anchor and extreme ±2000 offsets stay throw-free
    // (rounded like fitCompositeToCanvas). Gated by the native gate above.
    const comingSoonBaseTop = -ribbonLayout.offset
    const comingSoonBaseLeft =
      effComingSoonSide === "right"
        ? Math.round(CW - safeComingSoonResult.w + ribbonLayout.offset)
        : -ribbonLayout.offset
    composites.push({
      input: safeComingSoonResult.png,
      top: Math.round(comingSoonBaseTop),
      left: Math.round(comingSoonBaseLeft),
    })
  }
  // Network: centrato sopra il logo film quando c'è un badge alto
  // (nastro Netflix, badge centrale rank/extra, o angolo Coming Soon);
  // angolo in alto negli altri casi (a destra in vista Stremio con nastro,
  // altrimenti a sinistra). Senza logo film resta
  // il layout storico (top-left, o a fianco del nastro).
  // netTopLeftBottom traccia il fondo del logo network quando occupa il top-left (per qualità Stremio sotto).
  // Tuning editoriale globale (default per tutti i poster): pill network
  // +10px Y (module-scope NETWORK_LOGO_SHIFT_Y, shared with the anchor).
  let netTopLeftBottom: number | null = null
  // Modalità "in alto" (query `netPos=top` > mapping > config > defaults):
  // sempre all'angolo superiore. "auto" = specchio dinamico odierno.
  // Relativa senza logo reso = auto (nessun effetto); relativa con logo = angolo
  // forzato come le manuali (il ramo `networkManual` la posiziona, poi il blocco
  // relativo la sposta sopra/sotto il logo).
  const netForceTop = netRel !== null || (networkLogoPosition !== "auto" && !isLogoRelativePosition(networkLogoPosition))
  // La qualità legge da qui se il network è finito a destra in modo "top"
  // (trasloca a sinistra come col nastro a destra).
  let netAnchoredRight = false
  // Posizione assoluta congelata (checkbox OFF): salta TUTTI i rami di
  // reposition/shrink da titolo/badge/mirror sotto. Le coordinate sono gli
  // actual finali (shift editoriale e offset già inclusi al freeze): nessun
  // clamp dimensionale, nessun ricalcolo. Null/assenti = layout storico.
  const isFixedNetwork = isNetworkFixedPosition(
    networkLogoFollowTitle !== false,
    { x: networkFixedX ?? null, y: networkFixedY ?? null },
  )
  // Ancora manuale tl/tr (netPos): posizione fissa, nessun adattamento; la
  // fissa (follow OFF) resta prioritaria. "top" è legacy: non manuale.
  // Manuale = tl/tr storici + le 7 posizioni estese (`anchorRect`, vedi sotto).
  // `top` (legacy) e `auto` non sono manuali.
  const networkManual = !isFresh && !isCard && !isFixedNetwork
    && (isAnchorPosition(networkLogoPosition) || netRel !== null)
  // Actual finale per il freeze senza salto (solo numeri): valorizzato al
  // composite, null se il network non viene reso.
  let netGeo: NetworkGeometry | null = null
  // A2 top-line unica (landscape): il bitmap network porta un padding ombra
  // trasparente (shadowBlur+1) SOPRA l'inchiostro. Quando in landscape sono
  // disegnati ENTRAMBI (network + qualità) l'anchor network scende di quel
  // pad, così il suo inchiostro arriva sulla linea `netPadY +
  // NETWORK_LOGO_SHIFT_Y` (24px @768×432) e la qualità (sotto) mette il box
  // visibile sulla stessa linea. Con un solo elemento, nessuno spostamento:
  // solo-landscape-entrambi. Il network con posizione congelata (checkbox
  // OFF) resta assoluto per contratto: mai spostato.
  const netShadowPad = Math.max(2, Math.round(3 * badgePw / 380)) + 1
  const landscapeSharedTopLine =
    isLandscape && !!networkLogoForLayout && !isFixedNetwork && !!safeQualityBadgeResult && !isFresh && !isCard
  // Fresh/Card: il mark provider riusa il bitmap raw nella colonna meta / sotto il rank (sotto).
  if (networkLogoForLayout && !isFresh && !isCard) {
    const gap = Math.round(6 * CH / 570)
    let fittedRaw = await fitBadgeToCanvas(networkLogoForLayout, CW, CH)
    if (fittedRaw) {
      let top: number
      let left: number
      const isNetflixRibbon = isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank"
      const hasComingSoonCorner = showComingSoon && !!ribbonLayout && !!safeComingSoonResult
      const netPadX = Math.round(18 * CW / 380)
      // A2: in landscape con entrambi disegnati l'anchor scende del pad ombra
      // network (vedi `landscapeSharedTopLine`): l'inchiostro finisce sulla
      // linea condivisa, allineato al box visibile della qualità.
      const netPadY = Math.round(18 * CH / 570) - (landscapeSharedTopLine ? netShadowPad : 0)
      // Corner rank rect for the below-pill network stacking (null unless a
      // corner rank badge was rendered). Corner-style only. Visible body:
      // the bleed never participates in collisions.
      const finalRankBody = finalRankBadge ? badgeBody(finalRankBadge) : null
      const cornerRankRect: CornerRankRect | null =
        finalRankBadge && finalRankLeft !== null && finalRankBody
          ? { left: finalRankLeft, top: finalRankTop, w: finalRankBody.w, h: finalRankBody.h }
          : null
      // Anchored network size for the collision check (insertions run before
      // any shrink, so this is the full-size box).
      const netRawW = fittedRaw.w
      const netRawH = fittedRaw.h
      const stackBelowCornerRank = (top: number, left: number): { top: number; left: number } => {
        const stacked = stackNetworkBelowCornerRank({
          rankingBadgeStyle: topBadgeStyle,
          hasTopBadge: !!topBadge,
          rank: cornerRankRect,
          netLeft: left,
          netTop: top,
          netW: netRawW,
          netH: netRawH,
          gap,
        })
        if (stacked !== null) displaced.add("network")
        return stacked !== null ? { top: stacked, left: netPadX } : { top, left }
      }

      // Vista Stremio: il logo network specchia a destra quando l'angolo
      // destro è occupato — di fianco al nastro rank (come a sinistra in
      // vista Nuvio), sotto il Coming Soon (come a sinistra). La qualità va
      // già a sinistra in quei casi. Senza occupante destro resta a sinistra
      // (coesistenza pacifica con la qualità top-right).
      const rightRankRibbonOccupied =
        (isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank" &&
          ribbonSide === "right" &&
          !!finalRankBadge)
      const comingSoonRightOccupied = showComingSoon && !!ribbonLayout && !!safeComingSoonResult && effComingSoonSide === "right"
      const rightRankRibbonLeft = rightRankRibbonOccupied && finalRankBadge && finalRankLeft !== null ? finalRankLeft : null
      const mirrorNetworkBeside = rightRankRibbonLeft !== null
      const mirrorNetworkBelow = !mirrorNetworkBeside && comingSoonRightOccupied
      const comingSoonRightBottom = (comingSoonRightOccupied && ribbonLayout) ? ribbonLayout.extent : 0
      const rightAnchoredLeft = Math.max(0, CW - fittedRaw.w - netPadX)

      // Il badge centrale resta invariato: se si sovrappone al network,
      // rimpicciolisce il network (fino a 0.55x). B2: la scala finale è
      // calcolata aritmeticamente (l'overlap dipende solo da w/h, funzioni
      // deterministiche della scala) + UN solo resize — prima ogni step
      // intermedio faceva un resize sharp poi scartato (fino a ~7).
      const shrinkToAvoidRank = async <T extends BadgeRender>(box: T, top: number, left: number): Promise<T> => {
        if (topCenterRect) {
          const rankL = topCenterRect.left
          const rankR = topCenterRect.left + topCenterRect.w
          const rankB = topCenterRect.top + topCenterRect.h
          const overlapsAt = (w: number, h: number) =>
            left < rankR + 6 && left + w > rankL - 6 && top < rankB + 4 && top + h > netPadY - 4
          let scale = 1
          const minScale = 0.55
          let curW = box.w
          let curH = box.h
          while (scale > minScale && overlapsAt(curW, curH)) {
            scale -= 0.07
            if (scale < minScale) scale = minScale
            const newW = Math.max(1, Math.round(box.w * scale))
            const newH = Math.max(1, Math.round(box.h * scale))
            if (newW === curW && newH === curH) break
            curW = newW
            curH = newH
            if (scale <= minScale) break
          }
          if (curW !== box.w || curH !== box.h) {
            displaced.add("network")
            const png = await sharp(box.png).resize(curW, curH).toBuffer()
            const bleed = box.bleed ? scaleBadgeBleed(box.bleed, curW / box.w, curH / box.h) : undefined
            return { ...box, png, w: curW, h: curH, ...(bleed ? { bleed } : {}) }
          }
        }
        return box
      }

      if (isFixedNetwork) {
        // OFF: coordinate assolute, nessun reposition/shrink. La scala resta
        // ancorata top-left (fittedRaw invariato qui).
        top = networkFixedY as number
        left = networkFixedX as number
      } else if (netForceTop) {
        // Angolo superiore, lato del nastro EFFETTIVO (reso, non impostato):
        // solo con nastro rank/preset o Coming Soon a destra va a destra,
        // con tutti gli altri badge (o senza) resta a sinistra — anche in
        // vista Stremio. Restano: stacking sotto il Coming Soon del lato,
        // shift a fianco del nastro sullo stesso lato (stessa matematica dei
        // rami storici) e shrink vs badge centrale. Il ramo "sopra il logo
        // film" non vale in "top": l'angolo è l'angolo.
        // tl/tr forzano il lato (sinistro/destro) a prescindere dal nastro;
        // "top" lo deriva dall'occupante effettivo dell'angolo (storico).
        const sideRight = networkLogoPosition === "tl" ? false : networkLogoPosition === "tr" ? true : (rightRankRibbonOccupied || comingSoonRightOccupied)
        const csExtent = ribbonLayout ? ribbonLayout.extent : 0
        const csOnSide = showComingSoon && !!ribbonLayout && !!safeComingSoonResult &&
          (sideRight ? effComingSoonSide === "right" : effComingSoonSide !== "right")
        if (networkManual) {
          // Ancora manuale: angolo + offset, nessuno scalino/shrink/cambio lato
          // (ribbon, Coming Soon, rank e logo non lo spostano). Il fondo finale
          // alimenta la qualità auto più sotto.
          top = netPadY
          left = sideRight ? rightAnchoredLeft : netPadX
        } else if (sideRight && rightRankRibbonLeft !== null) {
          // Stessa riga a fianco del nastro destro (specchio Nuvio).
          top = netPadY
          left = Math.max(0, rightRankRibbonLeft - 10 - fittedRaw.w)
        } else if (csOnSide) {
          top = csExtent + gap
          left = sideRight ? rightAnchoredLeft : netPadX
        } else {
          top = netPadY
          left = sideRight ? rightAnchoredLeft : netPadX
          if (!sideRight) {
            const leftRibbon =
              isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank" &&
              ribbonSide !== "right"
            if (leftRibbon && finalRankBadge && finalRankLeft !== null && finalRankBody) {
              const ribbonRight = finalRankLeft + finalRankBody.w
              const netRight = left + fittedRaw.w
              const netBottom = top + fittedRaw.h
              const overlapX = left < ribbonRight + 6 && netRight > finalRankLeft - 6
              const overlapY = top < finalRankTop + finalRankBody.h + 4 && netBottom > finalRankTop - 4
              if (overlapX && overlapY) {
                displaced.add("network")
                left = Math.round(ribbonRight + 10)
                const maxLeft = CW - fittedRaw.w - netPadX
                if (left > maxLeft) left = maxLeft
              }
            }
          }
        }
        if (!networkManual) {
          // Corner rank at the same corner: stack below the pill instead of
          // shrinking in place (corner-style only, no-op otherwise).
          const cornerStackedTop = stackBelowCornerRank(top, left)
          top = cornerStackedTop.top
          left = cornerStackedTop.left
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
          // Solo a sinistra alimenta lo stacking qualità (a destra la qualità
          // ha già traslocato a sinistra, niente da impilare).
          if (!sideRight) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
          else netAnchoredRight = true
        } else if (sideRight) netAnchoredRight = true
      } else if (isLandscape && logoResult) {
        // Landscape with a title logo: never above the logo (bottom zone) —
        // always on top: beside the ribbon when it takes the left corner
        // (Netflix style), below Coming Soon when it takes that corner,
        // otherwise top-left (with shrink vs the centered badge), EXCEPT the
        // `corner` style (rank or extra): by default the network pill sits
        // above the title logo as in portrait (same formula, centered on the
        // title box). Portrait keeps the historic branch below.
        // Explicit netPos=top lives in the branch above and is unchanged.
        let cornerAboveTitlePlaced = false
        const leftRibbon =
          isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank" &&
          ribbonSide !== "right"
        if (leftRibbon && finalRankBadge && finalRankLeft !== null && finalRankBody) {
          top = netPadY
          left = netPadX
          const ribbonRight = finalRankLeft + finalRankBody.w
          const netRight = left + fittedRaw.w
          const netBottom = top + fittedRaw.h
          const overlapX = left < ribbonRight + 6 && netRight > finalRankLeft - 6
          const overlapY = top < finalRankTop + finalRankBody.h + 4 && netBottom > finalRankTop - 4
          if (overlapX && overlapY) {
            left = Math.round(ribbonRight + 10)
            const maxLeft = CW - fittedRaw.w - netPadX
            if (left > maxLeft) left = maxLeft
          }
        } else if (rightRankRibbonLeft !== null) {
          // Di fianco al nastro a destra, stessa riga (specchio Nuvio).
          top = netPadY
          left = Math.max(0, rightRankRibbonLeft - 10 - fittedRaw.w)
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        } else if (mirrorNetworkBelow) {
          // Sotto il Coming Soon a destra, ancorato a destra.
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        } else if (showComingSoon && ribbonLayout && effComingSoonSide !== "right") {
          top = ribbonLayout.extent + gap
          left = netPadX
        } else {
          // Corner style with a title logo: try above the title first (same
          // anchor as portrait, shift-corrected and centered on the title
          // box). The corner pill itself never moves: on collision the
          // network only shrinks in place, and when it still collides (or
          // there is no room above the title) the historic top-left anchor
          // below applies.
          let aboveTitle: { top: number; left: number } | null = null
          if (isCornerAnchoredStyle(topBadgeStyle) && topBadge && cornerRankRect && !logoTopAnchored) {
            const anchor = cornerNetworkAboveTitle({
              logoTop: logoResult.top,
              logoLeft: logoResult.left,
              logoW: logoResult.w,
              netW: netRawW,
              netH: netRawH,
              gap,
            })
            if (anchor) {
              const shrunk = await shrinkToAvoidRank(fittedRaw, anchor.top, anchor.left)
              // Recompute the anchor on the final (possibly shrunk) size so
              // the title centering and the visible gap hold exactly; a
              // smaller box can only move down, never above y=0.
              const finalAnchor = cornerNetworkAboveTitle({
                logoTop: logoResult.top,
                logoLeft: logoResult.left,
                logoW: logoResult.w,
                netW: shrunk.w,
                netH: shrunk.h,
                gap,
              }) ?? anchor
              const clash = stackNetworkBelowCornerRank({
                rankingBadgeStyle: topBadgeStyle,
                hasTopBadge: !!topBadge,
                rank: cornerRankRect,
                netLeft: finalAnchor.left,
                netTop: finalAnchor.top,
                netW: shrunk.w,
                netH: shrunk.h,
                gap,
              })
              // Keep the above-title placement only once the collision is
              // resolved: never moved back over the corner pill.
              if (clash === null) {
                aboveTitle = finalAnchor
                fittedRaw = shrunk
              }
            }
          }
          if (aboveTitle) {
            top = aboveTitle.top
            left = aboveTitle.left
            cornerAboveTitlePlaced = true
          } else {
            top = netPadY
            left = netPadX
            const cornerStackedLandscape = stackBelowCornerRank(top, left)
            top = cornerStackedLandscape.top
            left = cornerStackedLandscape.left
            fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
          }
        }
        // Above the title the network does not take the top-left corner:
        // quality keeps its corner anchor (netTopLeftBottom stays null).
        if (rightRankRibbonLeft === null && !mirrorNetworkBelow && !cornerAboveTitlePlaced) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else if (logoResult && !logoTopAnchored && (finalRankBadge || hasComingSoonCorner || genreOnTop)) {
        // Con logo film + badge alto (nastro Netflix, badge centrale
        // rank/extra, o Coming Soon): subito sopra il logo film
        // (in Cinematic Left allineato a sinistra come sopratitolo, non centrato).
        top = Math.max(0, logoResult.top - fittedRaw.h - gap - NETWORK_ABOVE_LOGO_LIFT)
        left = isLandscapeLeft ? logoResult.left : Math.round((CW - fittedRaw.w) / 2)
        const cornerStackedLogoTop = stackBelowCornerRank(top, left)
        top = cornerStackedLogoTop.top
        left = cornerStackedLogoTop.left
      } else if (!isNetflixRibbon && !logoResult) {
        // Senza logo film e senza nastro Netflix: in alto a sinistra;
        // con il nastro Coming Soon impilato sotto di esso (stesso angolo).
        // Specchio Stremio: sotto il Coming Soon destro, ancorato a destra.
        if (mirrorNetworkBelow) {
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
        } else {
          top = (showComingSoon && ribbonLayout && ribbonSide !== "right") ? ribbonLayout.extent + gap : netPadY
          left = netPadX
        }
        const cornerStackedPlain = stackBelowCornerRank(top, left)
        top = cornerStackedPlain.top
        left = cornerStackedPlain.left
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        if (!mirrorNetworkBelow) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else if (logoResult) {
        // Con logo film ma SENZA alcun badge alto (né nastro Netflix, né
        // Coming Soon, né badge centrale): angolo in alto (sotto il Coming
        // Soon destro in vista Stremio, altrimenti a sinistra).
        if (mirrorNetworkBelow) {
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
        } else {
          top = netPadY
          left = netPadX
        }
        const cornerStackedLogo = stackBelowCornerRank(top, left)
        top = cornerStackedLogo.top
        left = cornerStackedLogo.left
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        if (!mirrorNetworkBelow) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else {
        // Con nastro Netflix senza logo film: top-left o a fianco del nastro;
        // specchio Stremio: sotto l'occupante destro, ancorato a destra.
        top = netPadY
        left = netPadX
        const isNetflixLeftRibbon = ribbonSide !== "right" && finalRankBadge && finalRankLeft !== null
        if (isNetflixLeftRibbon) {
          const leftBody = badgeBody(finalRankBadge!)
          const ribbonRight = finalRankLeft! + leftBody.w
          const netRight = left + fittedRaw.w
          const netBottom = top + fittedRaw.h
          const overlapX = left < ribbonRight + 6 && netRight > finalRankLeft! - 6
          const overlapY = top < finalRankTop + leftBody.h + 4 && netBottom > finalRankTop - 4
          if (overlapX && overlapY) {
            left = Math.round(ribbonRight + 10)
            const maxLeft = CW - fittedRaw.w - netPadX
            if (left > maxLeft) left = maxLeft
          }
        } else if (rightRankRibbonLeft !== null) {
          // Di fianco al nastro a destra, stessa riga (specchio Nuvio).
          top = netPadY
          left = Math.max(0, rightRankRibbonLeft - 10 - fittedRaw.w)
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        } else if (mirrorNetworkBelow) {
          // Sotto il Coming Soon a destra, ancorato a destra.
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        }
        if (rightRankRibbonLeft === null && !mirrorNetworkBelow) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      }
      // Logo ancorato sul bordo alto: se la pill network (nella sua posizione
      // finale) lo copre, scende SOTTO il logo — il logo non si muove mai.
      // Mai in modalità fissa (coordinate assolute volute dall'utente) e mai
      // senza ancora (percorso storico invariato).
      if (logoTopAnchored && logoResult && !isFixedNetwork && !networkManual) {
        const netL = left + networkLogoOffsetX
        const netT = top + networkLogoOffsetY + NETWORK_LOGO_SHIFT_Y
        if (rectsOverlap({ left: netL, top: netT, w: fittedRaw.w, h: fittedRaw.h }, logoResult, 6)) {
          displaced.add("network")
          top = logoResult.top + logoResult.h + gap - NETWORK_LOGO_SHIFT_Y - networkLogoOffsetY
          // Alimenta lo stacking qualità solo quando il network occupava il
          // top-left (stessa formula dei rami storici).
          if (netTopLeftBottom !== null) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
        }
      }
      // Ancora attiva (tl/tr): il network che copre il corpo rank scende sotto
      // di lui; il rank non si muove mai, mai in modalità fissa. Se copre anche
      // il logo titolo, scende sotto il logo (due passate: le discese sono solo
      // verso il basso). Il fondo alimenta lo stacking qualità come gli altri rami.
      if (topAnchorRankRect && !isFixedNetwork && !networkManual) {
        const dropBlockers = [topAnchorRankRect, ...(logoResult ? [logoResult] : [])]
        let droppedBelowRank = false
        for (let pass = 0; pass < 2; pass++) {
          let moved = false
          for (const b of dropBlockers) {
            const netBox = { left: left + networkLogoOffsetX, top: top + networkLogoOffsetY + NETWORK_LOGO_SHIFT_Y, w: fittedRaw.w, h: fittedRaw.h }
            if (rectsOverlap(netBox, b, 6)) {
              top = b.top + b.h + gap - NETWORK_LOGO_SHIFT_Y - networkLogoOffsetY
              moved = true
            }
          }
          if (!moved) break
          droppedBelowRank = true
          displaced.add("network")
        }
        if (droppedBelowRank && netTopLeftBottom !== null) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      }
      // In fissa le coordinate sono già gli actual finali (shift e offset
      // inclusi al freeze): composite esatto. In storica restano gli offset
      // post-ancoraggio + shift editoriale.
      // Posizione fissa estesa (7 nuove; tl/tr restano sul ramo storico): il
      // bitmap network È il box visibile, quindi `anchorRect` lo posiziona
      // direttamente (margine laterale netPadX, margine alto/basso = quota
      // storica del network `netBaseTop + NETWORK_LOGO_SHIFT_Y`).
      if (networkManual && isAnchorPosition(networkLogoPosition) && networkLogoPosition !== "tl" && networkLogoPosition !== "tr") {
        const netY = Math.round(18 * CH / 570) + NETWORK_LOGO_SHIFT_Y
        const fixedNet = anchorRect(networkLogoPosition, {
          canvasW: CW, canvasH: CH, w: fittedRaw.w, h: fittedRaw.h,
          marginX: Math.round(18 * CW / 380), marginTop: netY, marginBottom: netY,
        })
        top = fixedNet.top - networkLogoOffsetY - NETWORK_LOGO_SHIFT_Y
        left = fixedNet.left - networkLogoOffsetX
      }
      const finalNetTop = isFixedNetwork ? top : top + networkLogoOffsetY + NETWORK_LOGO_SHIFT_Y
      const finalNetLeft = isFixedNetwork ? left : left + networkLogoOffsetX
      if (isFixedNetwork) {
        // Il fondo effettivo alimenta lo stacking qualità (che resta); la
        // qualità non sposta mai il network.
        netTopLeftBottom = finalNetTop + fittedRaw.h
      }
      if (networkManual) {
        // Ancora manuale: il fondo FINALE (offset inclusi) alimenta lo stacking
        // della qualità auto a sinistra; a destra non c'è nulla da impilare.
        netTopLeftBottom = networkLogoPosition === "tl" ? finalNetTop + fittedRaw.h : null
      }
      netGeo = { top: finalNetTop, left: finalNetLeft, w: fittedRaw.w, h: fittedRaw.h, nominalW: netRawW, nominalH: netRawH, followTitle: !isFixedNetwork }
      pushFam("network", {
        input: fittedRaw.png,
        // Offset applicati DOPO il posizionamento automatico (come il badge
        // qualità): la logica overlap/shrink ragiona sulla posizione ancorata.
        // NETWORK_LOGO_SHIFT_Y è default globale (tuning editoriale), non
        // offset utente: sposta anche l'ancora netTopLeftBottom sotto.
        top: finalNetTop,
        left: finalNetLeft,
      })
    }
  }
  onNetworkGeometry?.(netGeo)
  if (netGeo) {
    badgeGeo.network = { top: netGeo.top, left: netGeo.left, w: netGeo.w, h: netGeo.h }
  }

  // Qualità: in alto a destra di default; con nastro Netflix o Coming Soon a destra (Stremio)
  // va a sinistra per non restargli accanto — sopra il logo network se libero,
  // altrimenti impilata sotto di esso. Top allineato al logo network.
  // Il badge centrale resta invariato: se si sovrappone alla qualità,
  // rimpicciolisce la qualità (fino a 0.55x).
  let qualityStackAnchor: { top: number; centerX: number; leftCorner: boolean; boxTop: number; bottomRow: boolean } | null = null
  if (safeQualityBadgeResult) {
    const netBaseTop = Math.round(18 * CH / 570)
    const netPadX = Math.round(18 * CW / 380)
    const isNetflixRight = isRibbonRankingStyle(rankingBadgeStyle) && ribbonSide === "right" && topBadge?.type === "rank"
    const isComingSoonRight = showComingSoon && effComingSoonSide === "right" && !!ribbonLayout
    // Number mirrored right occupies the top-right corner exactly like a
    // right ribbon: the quality pill moves left instead of overlapping the
    // bare digits (shrink-in-place bottoms out at 0.55x and still collides).
    // Follows the effective top-badge style (same source as the separate
    // stack below): an explicit extra style never mirrors, so quality and
    // stack stay on the same corner.
    const isNumberRight = (topRightAnchored && !!finalRankBadge) || isTopBadgeNumberRightCorner({
      topBadgeType: topBadge?.type,
      rankingBadgeStyle,
      extraBadgeStyle,
      ribbonSide,
      hasTopBadge: !!finalRankBadge,
    })
    // Network "in alto" finito a destra: la qualità trasloca a sinistra
    // come col nastro a destra (stesso branch, niente overlap sull'angolo).
    // Ancora attiva: "tl" = angolo sinistro (ramo storico "nastro a destra":
    // sotto il network se a sinistra), "tr" = angolo destro. Auto = storico.
    // Colonna dell'ancora: `l` = lato sinistro (ramo "nastro a destra"), `r` = destro,
    // `c` = centrale (fisso, nessun lato). Auto = storico.
    const qualityCol = isActiveQualityAnchor(qualityAnchorEff) ? anchorCol(qualityAnchorEff) : null
    const isRightRibbonCorner = qualityCol === "l" ? true : qualityCol === "r" || qualityCol === "c" ? false : ((isNetflixRight && !!finalRankBadge) || isComingSoonRight || (!!networkLogoForLayout && netAnchoredRight) || isNumberRight)

    // Ancoraggio base portrait: top = netBaseTop - 10 + 5 (storia editoriale:
    // era -20); con i default di fabbrica (qoy +6) il box visibile cade a 39px
    // = inchiostro network (griglia superiore unica).
    // A2 landscape (network + qualità entrambi disegnati): il box visibile va
    // SULLA linea condivisa `netBaseTop + NETWORK_LOGO_SHIFT_Y` (24px @768×432)
    // — il network sottrae il proprio pad ombra dall'anchor, la qualità assorbe
    // qui il proprio TOP_SHADOW_PAD. Stessa riga del network, mai più invertita.
    // Griglia laterale a box: il respiro del box qualità è uguale a quello del
    // network (netPadX) su entrambi i lati. Il bitmap include il padding ombra
    // simmetrico: il pad scala col rapporto w finale/w render.
    // Lo stacking sotto il logo network resta invariato (lì conta non
    // sovrapporsi, non la misura).
    const qPad = qualityBadgeResult?.w
      ? Math.round(TOP_SHADOW_PAD * safeQualityBadgeResult.w / qualityBadgeResult.w)
      : TOP_SHADOW_PAD
    const sharedTopLineTop = netBaseTop + NETWORK_LOGO_SHIFT_Y - TOP_SHADOW_PAD
    let top = landscapeSharedTopLine ? sharedTopLineTop : netBaseTop - 10 + 5
    // Linguette: il lato dritto coincide con l'ultima colonna (right) o con
    // la prima (left) del bitmap di gruppo — niente margine netPadX e niente
    // pad ombra sull'asse di aggancio.
    let left = groupNotch
      ? (notchEdge === "right" ? CW - safeQualityBadgeResult.w : 0)
      : isRightRibbonCorner
        ? netPadX - qPad
        : CW - netPadX - (safeQualityBadgeResult.w - qPad)
    let finalQualityBadge = safeQualityBadgeResult

    // Ancora manuale: nessuno stacking sotto il network (la qualità resta
    // nell'angolo scelto + offset; il network può coprirla).
    if (isRightRibbonCorner && !qualityManual) {
      // Nastro a destra (Netflix o Coming Soon): qualità a sinistra, speculare
      // all'angolo destro standard — impilata sotto il logo network se presente.
      if (netTopLeftBottom !== null) {
        top = netTopLeftBottom + Math.round(6 * CH / 570)
      }
    }

    // Logo ancorato sul bordo alto: se il box visibile della qualità (bitmap
    // senza il padding ombra) lo copre, scende SOTTO il logo — il logo non si
    // muove mai. Senza ancora attiva il ramo non esiste (percorso storico).
    // Ancora manuale della qualità: nessuno scalino, sovrapposizione accettata.
    if (logoTopAnchored && logoResult && !qualityManual) {
      const qVisible = {
        left: left + qualityBadgeOffsetX + qPad,
        top: top + qualityBadgeOffsetY + qPad,
        w: finalQualityBadge.w - 2 * qPad,
        h: finalQualityBadge.h - 2 * qPad,
      }
      if (rectsOverlap(qVisible, logoResult, 6)) {
        displaced.add("quality")
        top = logoResult.top + logoResult.h + Math.round(6 * CH / 570) - qPad - qualityBadgeOffsetY
      }
    }
    // Ancora attiva: la qualità che copre il corpo rank scende sotto di lui
    // (stessa asse del logo ancorato; il rank non si muove mai).
    if (topAnchorRankRect && !qualityManual) {
      const dropBlockers = [topAnchorRankRect, ...(logoResult ? [logoResult] : [])]
      for (let pass = 0; pass < 2; pass++) {
        let moved = false
        for (const b of dropBlockers) {
          const qBox = {
            left: left + qualityBadgeOffsetX + qPad,
            top: top + qualityBadgeOffsetY + qPad,
            w: finalQualityBadge.w - 2 * qPad,
            h: finalQualityBadge.h - 2 * qPad,
          }
          if (rectsOverlap(qBox, b, 6)) {
            displaced.add("quality")
            top = b.top + b.h + Math.round(6 * CH / 570) - qPad - qualityBadgeOffsetY
            moved = true
          }
        }
        if (!moved) break
      }
    }

    // Ancora manuale: la qualità non si rimpicciolisce per il badge centrale.
    if (topCenterRect && !qualityManual) {
      const rankL = topCenterRect.left
      const rankR = topCenterRect.left + topCenterRect.w
      const rankB = topCenterRect.top + topCenterRect.h
      let curW = finalQualityBadge.w
      let curH = finalQualityBadge.h
      let curPng = finalQualityBadge.png
      let curLeft = left
      const overlapsRank = () =>
        curLeft < rankR + 6 && curLeft + curW > rankL - 6 && top < rankB + 4 && top + curH > netBaseTop - 4
      if (overlapsRank()) {
        displaced.add("quality")
        let scale = 1
        const minScale = 0.55
        while (scale > minScale && overlapsRank()) {
          scale -= 0.07
          if (scale < minScale) scale = minScale
          const newW = Math.max(1, Math.round(safeQualityBadgeResult.w * scale))
          const newH = Math.max(1, Math.round(safeQualityBadgeResult.h * scale))
          if (newW === curW && newH === curH) break
          curW = newW
          curH = newH
          curPng = await sharp(safeQualityBadgeResult.png).resize(newW, newH).toBuffer()
          // Lo shrink scala anche il pad: l'ancora resta a box.
          const curPad = Math.round(qPad * scale)
          curLeft = groupNotch
            ? (notchEdge === "right" ? CW - curW : 0)
            : isRightRibbonCorner ? netPadX - curPad : CW - netPadX - (curW - curPad)
          if (scale <= minScale) break
        }
        finalQualityBadge = { ...finalQualityBadge, png: curPng, w: curW, h: curH }
        left = curLeft
      }
    }

    // Ancora qualità a posizione fissa esteso (tc/ml/mc/mr/bl/bc/br): il box
    // VISIBILE (bitmap meno pad ombra) va a `anchorRect` con margine laterale
    // netPadX e margine alto/basso = quota storica del box qualità (top line).
    // tl/tr restano sul percorso storico sopra (byte-identico).
    if (isActiveQualityAnchor(qualityAnchorEff) && qualityAnchorEff !== "tl" && qualityAnchorEff !== "tr") {
      const qTopMargin = (landscapeSharedTopLine ? netBaseTop + NETWORK_LOGO_SHIFT_Y : netBaseTop - 10 + 5) + qPad
      const visW = finalQualityBadge.w - 2 * qPad
      const visH = finalQualityBadge.h - 2 * qPad
      const fixed = anchorRect(qualityAnchorEff, {
        canvasW: CW, canvasH: CH, w: visW, h: visH,
        marginX: netPadX, marginTop: qTopMargin, marginBottom: qTopMargin,
      })
      left = fixed.left - qPad
      top = fixed.top - qPad
    }

    // Offset applicato DOPO lo shrink anti-overlap (che ragiona sulla
    // posizione ancorata). Sulle linguette l'offset X è ignorato: il raccordo
    // resta agganciato al bordo, come il genere notch ignora l'offset Y.
    const qualityLeftFinal = left + (groupNotch ? 0 : qualityBadgeOffsetX)
    const qualityLayer: PosterComposite = {
      input: finalQualityBadge.png,
      top: top + qualityBadgeOffsetY,
      left: qualityLeftFinal,
    }
    pushFam("quality", qualityLayer)
    // Vetro reale sotto la linguetta: il solo velo SVG non sfoca l'artwork.
    if (groupNotch === "vetro") glassLayers.add(qualityLayer)
    const qualityGroupTop = top + qualityBadgeOffsetY
    const qualityGroupLeft = qualityLeftFinal
    // Per-item corrections: the group keeps its automatic anchor/offset/scale
    // (nothing else ever moves); a corrected element is composited on its own
    // at the transformed box. The ratio maps the group bitmap's own space
    // (where the item boxes live) onto the placed bitmap.
    const qualityItemScale = qualityBadgeResult && qualityBadgeResult.w > 0 ? finalQualityBadge.w / qualityBadgeResult.w : 1
    // `strip` + `row` is ONE merged plate: a single slice can never detach, so
    // this report publishes only the GROUP box — no `quality:*` per-item handle
    // and no home ghost (a merged plate has no empty homes). Every other
    // combination (any style stacked, strip stacked included) is a per-mark
    // stack: items and empty-home ghosts are published normally.
    const qualityGroupIsStrip = isMergedQualityStrip(effQualityBadgeStyle, effQualityGroupLayout)
    const qualityReportedItems = qualityGroupIsStrip ? [] : safeQualityBadgeResult.items
    for (const item of qualityReportedItems) {
      const reported = {
        top: qualityGroupTop + item.top * qualityItemScale,
        left: qualityGroupLeft + item.left * qualityItemScale,
        w: item.w * qualityItemScale,
        h: item.h * qualityItemScale,
      }
      const itemTransform = badgeItemTransform(effectiveItemTransforms, item.id)
      const placed = applyBadgeItemTransform(reported, itemTransform)
      if (item.png) {
        const png =
          placed.w === item.w && placed.h === item.h
            ? item.png
            : await sharp(item.png).resize(placed.w, placed.h).toBuffer()
        pushFam("quality", { input: png, top: placed.top, left: placed.left })
        qualityDetachedInk.set(item.id, { png, left: placed.left, top: placed.top })
      }
      badgeGeoItems.push({
        id: item.id,
        family: "quality",
        top: placed.top,
        left: placed.left,
        w: placed.w,
        h: placed.h,
        // A home correction moves the badge on BOTH surfaces, so a tuned home
        // must read as tuned here too (the editor marks custom handles).
        custom:
          !isNeutralBadgeItemTransform(itemTransform) ||
          !isNeutralBadgeItemTransform(badgeItemTransform(effectiveItemTransforms, homeIdForPainted(item.id) ?? "")),
      })
    }
    // Empty HOMES (preview geometry only): box-only handles for the content
    // groups this render does not paint. Same mapping as a painted element
    // (group space → placed bitmap), no png, never a pixel change. The Stremio
    // render path never asks for them (`?ghosts=1` is a preview diagnostic).
    if (badgeHomeGhosts) {
      for (const ghost of safeQualityBadgeResult.homeGhosts ?? []) {
        const homeTransform = badgeItemTransform(effectiveItemTransforms, ghost.id)
        const box = {
          top: qualityGroupTop + ghost.top * qualityItemScale,
          left: qualityGroupLeft + ghost.left * qualityItemScale,
          w: ghost.w * qualityItemScale,
          h: ghost.h * qualityItemScale,
        }
        const placed = applyBadgeItemTransform(box, homeTransform)
        badgeGeoItems.push({
          id: ghost.id,
          family: "quality",
          top: placed.top,
          left: placed.left,
          w: placed.w,
          h: placed.h,
          custom: !isNeutralBadgeItemTransform(homeTransform),
          ghost: true,
        })
      }
    }
    badgeGeo.quality = {
      top: top + qualityBadgeOffsetY,
      left: qualityLeftFinal,
      w: finalQualityBadge.w,
      h: finalQualityBadge.h,
    }
    qualityInkSource = {
      png: finalQualityBadge.png,
      left: qualityLeftFinal,
      top: top + qualityBadgeOffsetY,
      body: groupNotch && qualityBadgeResult ? scaledBody(qualityBadgeResult.body, finalQualityBadge.h / qualityBadgeResult.h) : undefined,
    }
    // Ancoraggio della colonna separati: sotto il box visibile del badge
    // qualita (asse centrale allineato) con gap ottico 6px. L'ancora sottrae
    // il padding ombra inferiore (in scala): prima lo stack partiva dal fondo
    // bitmap + 5, cioe ~19px di vuoto sotto la capsula.
    // Senza qualita lo stack sale al top (vedi sotto).
    const qBottomPad = qualityBadgeResult?.h
      ? Math.round(TOP_SHADOW_PAD * finalQualityBadge.h / qualityBadgeResult.h)
      : TOP_SHADOW_PAD
    // Gruppo notch: l'ancora è il fondo della LASTRA (sotto ci sono raccordo
    // e pad ombra), scalato con la bitmap finale.
    const qNotchBody = groupNotch && qualityBadgeResult?.body ? qualityBadgeResult.body : null
    qualityStackAnchor = {
      top: qNotchBody && qualityBadgeResult
        ? top + qualityBadgeOffsetY + Math.round((qNotchBody.top + qNotchBody.h) * finalQualityBadge.h / qualityBadgeResult.h)
        : top + qualityBadgeOffsetY + finalQualityBadge.h - qBottomPad,
      centerX: qualityLeftFinal + finalQualityBadge.w / 2,
      leftCorner: isRightRibbonCorner,
      boxTop: top + qualityBadgeOffsetY + qPad,
      bottomRow: isActiveQualityAnchor(qualityAnchorEff) && anchorRow(qualityAnchorEff) === "b",
    }
  }

  // Colonna rating separati: UN solo bitmap con
  // pill verticali logo-sopra/punteggio-sotto a larghezza uniforme,
  // centrato sull'asse verticale del badge qualità (o all'angolo quando la
  // qualità manca). Vale per entrambi i canvas. Mai col custom provider.
  // Solo stile colonna: in modalità bottom gli items vanno alla riga sotto.
  // Fresh/Card: i valori vivono come righe testo nella colonna meta / banda card (sotto).
  // Master OFF silences the band (same gate as the custom row above).
  if (badgesEnabled !== false && !customRowRendered && !isBottomStyle && input.separateRatings?.length && !isFresh && !isCard) {
    const items = input.separateRatings.slice(0, MAX_SEPARATE_RATINGS)
    const netPadX = Math.round(18 * CW / 380)
    const netBaseTop = Math.round(18 * CH / 570)
    // Senza qualità ma con nastro a destra, lo stack segue a sinistra come
    // farebbe la qualità (stessa condizione del blocco sopra). Vale anche
    // per il numerale specchiato a destra (stesso angolo occupato).
    const rightCorner = qualityStackAnchor
      ? qualityStackAnchor.leftCorner
      : ((isRibbonRankingStyle(rankingBadgeStyle) && ribbonSide === "right" && topBadge?.type === "rank" && !!finalRankBadge)
        || (showComingSoon && effComingSoonSide === "right" && !!ribbonLayout)
        || (topRightAnchored && !!finalRankBadge)
        || isTopBadgeNumberRightCorner({ topBadgeType: topBadge?.type, rankingBadgeStyle, extraBadgeStyle, ribbonSide, hasTopBadge: !!finalRankBadge }))
    // `column-notch-*`: UNA linguetta agganciata allo stesso bordo del gruppo
    // qualità, sotto la sua lastra.
    const sideNotch = sepSideNotch
    const stackKey = badgeCacheKey("separate", items.map((i) => `${i.id}${i.value}`).join(","), CW, badgeFont, effSepTopLight, separateBadgeScaleEff, separateItemKey, sepColumnVariant === "rings" ? "rings" : undefined, sideNotch ? `notch-${sideNotch}-${notchEdge}` : undefined)
    const cached = cacheGet<SeparateRatingStack>(stackKey)
    const stack = cached ?? await coalesceBadgeRender(stackKey, () =>
      (sideNotch
        ? renderSeparateRatingsSideNotch(items, badgePw, effSepTopLight, sideNotch, notchEdge, badgeFont, separateBadgeScaleEff)
        : renderSeparateRatingStack(items, badgePw, effSepTopLight, badgeFont, separateBadgeScaleEff, itemTransformsForSeparate, sepColumnVariant))
        .then((r) => { if (r) cacheSet(stackKey, r, ["badge"], BADGE_CACHE_TTL); return r })
    )
    // Linguetta: la LASTRA parte a un gap ottico sotto quella della qualità;
    // raccordo e pad ombra sopra la lastra salgono oltre l'ancora.
    const sideNotchGap = Math.round(8 * CW / 500)
    const sepBodyBottom = stack?.body ? stack.body.top + stack.body.h : (stack?.h ?? 0)
    const stackTop = sideNotch
      ? (qualityStackAnchor ? qualityStackAnchor.top + sideNotchGap : netBaseTop) - (stack?.body?.top ?? 0)
      : (qualityStackAnchor?.bottomRow ? qualityStackAnchor.boxTop - 6 - sepBodyBottom
        : (qualityStackAnchor ? qualityStackAnchor.top + 6 : netBaseTop - 10))
        + (isLandscape ? 0 : PORTRAIT_SEPARATE_SHIFT_Y)
    const fitted = stack ? await fitBadgeToCanvas(stack, CW, CH) : null
    // Contenimento colonna sopra il badge genere (o dentro il canvas senza
    // genere): SOLO shrink sull'overflow reale, mai per conteggio. La misura
    // riusa il placement finale voluto (stackTop + sepOY, clamp dentro il
    // canvas) e il bordo genere effettivo con gap 6px; senza genere il bordo
    // è il fondo canvas col margine genere (20*CH/570). Gruppi 1-5 che
    // entrano restano byte-identici a qualsiasi scala (nessun enlarge mai);
    // solo lo sforamento scala il bitmap in proporzione. Spazio nullo o
    // negativo (offset patologici) resta fuori scope: nessuna promessa di
    // zero overlap universale, si conserva la colonna leggibile.
    let stackFitted = fitted
    if (stackFitted) {
      const intendedTop = Math.max(0, Math.min(Math.max(0, CH - 1), stackTop + sepOY))
      const bottomEdge = genreBadgeRect && !genreAtTop
        ? genreBadgeRect.top
        : CH - Math.round(20 * CH / 570)
      const maxStackH = bottomEdge - intendedTop - 6
      if (stackFitted.h > maxStackH && maxStackH > 0) {
        stackFitted = await scaleBitmapForLayout(stackFitted, (maxStackH / stackFitted.h) * 100)
      }
    }
    if (stackFitted) {
      const leftPos = sideNotch
        ? (notchEdge === "right" ? CW - stackFitted.w : 0)
        : qualityStackAnchor
          ? Math.round(qualityStackAnchor.centerX - stackFitted.w / 2)
          : (rightCorner ? netPadX : Math.round(CW - netPadX + 10 - stackFitted.w))
      // Clamp dentro il canvas come gli altri badge (a offset 0 identico allo storico).
      // La linguetta resta agganciata al bordo (offset X ignorato, come la
      // qualità notch) e il raccordo superiore può salire oltre il bordo alto.
      const sepLeft = sideNotch ? leftPos : Math.max(0, Math.min(CW - stackFitted.w, leftPos + sepOX))
      const sepTop = sideNotch
        ? Math.min(CH - stackFitted.h, stackTop + sepOY)
        : Math.max(0, Math.min(CH - stackFitted.h, stackTop + sepOY))
      const sepLayer = { input: stackFitted.png, top: sepTop, left: sepLeft }
      pushFam("separate", sepLayer)
      if (sideNotch === "vetro") glassLayers.add(sepLayer)
      separateInkSource = {
        png: stackFitted.png,
        left: sepLeft,
        top: sepTop,
        body: sideNotch && stack ? scaledBody(stack.body, stackFitted.h / stack.h) : undefined,
      }
      badgeGeo.separate = { top: sepTop, left: sepLeft, w: stackFitted.w, h: stackFitted.h }
      // Per-item corrections of the single pills: the column keeps its
      // automatic anchor/offset/fit (nothing else moves); a corrected pill is
      // composited on its own at the transformed slot, mapped through the
      // final placement + shrink ratio of the stack bitmap.
      const stackItemScale = stack && stack.w > 0 ? stackFitted.w / stack.w : 1
      for (const item of stack?.items ?? []) {
        const slot = {
          top: sepTop + item.top * stackItemScale,
          left: sepLeft + item.left * stackItemScale,
          w: item.w * stackItemScale,
          h: item.h * stackItemScale,
        }
        const itemTransform = badgeItemTransform(effectiveItemTransforms, item.id)
        // A pill also carries the correction of its PAINTED POSITION (the SLOT
        // this renderer already applied), so a slot-tuned pill reads as tuned
        // and an untouched one reads as automatic.
        const slotTransform = badgeItemTransform(effectiveItemTransforms, ratingSlotItemId(item.slot ?? 0) ?? "")
        const placed = applyBadgeItemTransform(slot, itemTransform)
        if (item.png) {
          const png =
            placed.w === item.w && placed.h === item.h
              ? item.png
              : await sharp(item.png).resize(placed.w, placed.h).toBuffer()
          pushFam("separate", { input: png, top: placed.top, left: placed.left })
        }
        badgeGeoItems.push({
          id: item.id,
          family: "separate",
          top: placed.top,
          left: placed.left,
          w: placed.w,
          h: placed.h,
          custom:
            !isNeutralBadgeItemTransform(itemTransform) || !isNeutralBadgeItemTransform(slotTransform),
        })
      }
      // Empty SLOT positions (preview geometry only): box-only handles for the
      // painted-position slots this column does not fill. Same mapping as a
      // painted pill (group space → placed bitmap), no png, never a pixel
      // change; the Stremio render path never asks for them (`?ghosts=1` is a
      // preview diagnostic). The ghost's own stored slot correction is applied
      // here exactly once (the renderer reports the automatic box).
      if (badgeHomeGhosts) {
        for (const ghost of stack?.slotGhosts ?? []) {
          const slotTransform = badgeItemTransform(effectiveItemTransforms, ghost.id)
          const placed = applyBadgeItemTransform(
            {
              top: sepTop + ghost.top * stackItemScale,
              left: sepLeft + ghost.left * stackItemScale,
              w: ghost.w * stackItemScale,
              h: ghost.h * stackItemScale,
            },
            slotTransform,
          )
          badgeGeoItems.push({
            id: ghost.id,
            family: "separate",
            top: placed.top,
            left: placed.left,
            w: placed.w,
            h: placed.h,
            custom: !isNeutralBadgeItemTransform(slotTransform),
            ghost: true,
          })
        }
      }
    }
  }
  // rimpiazza colonna e badge genere
  // (già soppresso a monte via flag effettivi) sul bordo inferiore. La barra
  // in portrait è full-width a filo; in landscape la barra non esiste più
  // (normalizzata a pills a monte): le righe non-bar in landscape sono
  // ancorate a DESTRA
  // con la stessa geometria base del badge genere (landscapeRightAnchorLeft,
  // extra = 0, opticalShift = 0: margine interno pieno 18*CW/380, senza il
  // +40 ottico del genere), non centrate sul canvas, con base geometrica
  // landscape -20 X / -10 Y (LANDSCAPE_BOTTOM_PILLS_SHIFT_*). Forma canvas invariata.
  // Gradino (`notch-*`): stesso ramo bottom ma bitmap a due livelli, a filo del
  // bordo inferiore (top = CH - h), portrait centrato / landscape ancorato a
  // destra come la notch genere, `sepox` attivo e `sepoy` ignorato (la sagoma è
  // incollata al bordo). Con 0 rating resta il solo gradino alto (genere/anno).
  const notchStepMaterial = bottomVariant ? notchMaterialOf(bottomVariant) : null
  const bottomPaints = bottomItemCount > 0 || (!!notchStepMaterial && notchStepLabel.length > 0)
  if (bottomPaints && badgesEnabled && bottomVariant && !isFresh && !isCard) {
    const items = (input.separateRatings ?? []).slice(0, MAX_SEPARATE_RATINGS)
    const isBar = bottomVariant === "bottom-bar"
    const isNotchStep = !!notchStepMaterial
    const availW = isBar && !isLandscape ? CW : (isLandscape ? CW - 80 : CW - 36)
    const notchStepAccent = isNotchStep && stepPaintsAccent ? accentColorGenre : null
    const bottomKey = badgeCacheKey("separate-bottom", bottomVariant, items.map((i) => `${i.id}${i.value}`).join(","), isNotchStep ? notchStepLabel : undefined, isNotchStep ? (notchStepAccent ?? "na") : undefined, CW, badgeFont, separateBadgeScaleEff, availW, effSepBottomLight ? "bl1" : "bl0", separateItemKey)
    const cached = cacheGet<SeparateRatingStack>(bottomKey)
    const bottom = cached ?? await coalesceBadgeRender(bottomKey, () =>
      (isNotchStep
        ? renderSeparateRatingsNotch(items, badgePw, bottomVariant, badgeFont, separateBadgeScaleEff, availW, effSepBottomLight, {
            genre: notchStepRawGenre && genreName ? genreName : null,
            year: notchStepRawYear && year ? year : null,
          }, notchStepAccent)
        : renderSeparateRatingsBottom(items, badgePw, bottomVariant, badgeFont, separateBadgeScaleEff, availW, effSepBottomLight, itemTransformsForSeparate))
        .then((r) => { if (r) cacheSet(bottomKey, r, ["badge"], BADGE_CACHE_TTL); return r })
    )
    const fitted = bottom ? await fitBadgeToCanvas(bottom, CW, CH) : null
    if (fitted) {
      const margin = Math.round(20 * CH / 570)
      const barFlush = (isBar && !isLandscape) || isNotchStep
      // Base righe non-bar in landscape: shift geometrico -20/-10 PRIMA di
      // offset utente (sepox/sepoy additivi dopo) e collision handling logo.
      // Portrait non-bar +5 Y (PORTRAIT_SEPARATE_SHIFT_Y) prima degli offset;
      // colonna portrait coperta dal ramo colonna; bottom-bar portrait a filo
      // invariata (il +5 sarebbe annullato dal clamp); bottom-bar
      // normalizzata a pills coperta dallo stesso ramo (in landscape i bare
      // restano invariati, solo la barra normalizza).
      const isLandscapePills = isLandscape && !isBar && !isNotchStep
      const isPortraitPills = !isLandscape && !isBar && !isNotchStep
      // Gradino: l'ancoraggio segue il CORPO visibile (come la notch genere),
      // non la bitmap con i pad trasparenti dei raccordi — così i raccordi
      // possono sbordare dal canvas e la placca resta a filo del bordo.
      const notchBody = (w: number) => {
        const bodyW = bottom?.body?.w ?? 0
        const inset = bottom?.body?.left ?? 0
        if (!bottom || bottom.w <= 0 || bodyW <= 0) return null
        const k = w / bottom.w
        return { left: inset * k, w: bodyW * k }
      }
      const bottomInk = bottomAnchorEff !== "auto" && !barFlush ? await inkRatios({ png: fitted.png, w: fitted.w, h: fitted.h }) : null
      const pillsBandPos: AnchorPosition | null = isActiveBottomAnchor(bottomAnchorEff) && anchorRow(bottomAnchorEff) !== "b" ? bottomAnchorEff : null
      const topFor = (h: number) => barFlush ? CH - h : pillsBandPos ? bandRowTop(pillsBandPos, h) : CH - h - margin + (isLandscapePills ? LANDSCAPE_BOTTOM_PILLS_SHIFT_Y : 0) + (isPortraitPills ? PORTRAIT_SEPARATE_SHIFT_Y : 0)
      const leftFor = (w: number) => {
        if (barFlush && !isNotchStep) return 0
        if (isNotchStep) {
          const body = notchBody(w)
          if (!body) return bottomAnchorEff !== "auto" ? bottomAnchoredLeft(bottomAnchorEff, w, CW) : isLandscape ? landscapeRightAnchorLeft(w, CW, 0) : Math.round((CW - w) / 2)
          const bodyLeft = bottomAnchorEff !== "auto" ? bottomAnchoredLeft(bottomAnchorEff, body.w, CW) : isLandscape ? landscapeRightAnchorLeft(body.w, CW, 0) : Math.round((CW - body.w) / 2)
          return bodyLeft - body.left
        }
        if (bottomAnchorEff !== "auto") return bottomAnchoredBodyLeft(bottomAnchorEff, w, bottomInk, CW)
        return isLandscape
          ? landscapeRightAnchorLeft(w, CW, 0, 0) + (isLandscapePills ? LANDSCAPE_BOTTOM_PILLS_SHIFT_X : 0)
          : Math.round((CW - w) / 2)
      }
      // Offset sul gruppo intero con clamp dentro il canvas; la barra
      // portrait è full-width a filo: la X è ignorata esplicitamente (la UI
      // disabilita lo slider), la Y resta attiva. A offset 0 identico allo storico.
      // Gradino: `sepox` attivo su entrambi i canvas, `sepoy` ignorato (sagoma
      // incollata al bordo inferiore); il clamp tiene il CORPO dentro il canvas
      // (i pad trasparenti possono sbordare, come i raccordi della notch genere).
      const topForOff = (h: number) => Math.max(0, Math.min(CH - h, topFor(h) + (isNotchStep ? 0 : sepOY)))
      const leftForOff = (w: number) => {
        if (barFlush && !isNotchStep) return 0
        if (isNotchStep) {
          const body = notchBody(w)
          if (body) return Math.max(-body.left, Math.min(CW - body.left - body.w, leftFor(w) + sepOX))
        }
        return Math.max(0, Math.min(CW - w, leftFor(w) + sepOX))
      }
      // Righe non-bar in landscape + logo titolo a sinistra: se la riga copre
      // il logo si rimpicciolisce la riga (stessa regola del badge genere,
      // min 0.7 — mai il logo, scala utente esplicita). Solo non-bar in
      // landscape: portrait byte-identico al passato.
      let rowBox = fitted
      // Ancora manuale in basso: la riga non si riduce per il logo (come il genere).
      if (logoResult && isLandscape && !isBar && !bottomManual) {
        const overlapsLogo = (w: number, h: number, l: number, t: number) =>
          l < logoResult.left + logoResult.w && l + w > logoResult.left &&
          t < logoResult.top + logoResult.h && t + h > logoResult.top
        if (overlapsLogo(rowBox.w, rowBox.h, leftForOff(rowBox.w), topForOff(rowBox.h))) {
          let scale = 1
          const minScale = 0.7
          let curW = rowBox.w
          let curH = rowBox.h
          while (scale > minScale && overlapsLogo(curW, curH, leftForOff(curW), topForOff(curH))) {
            scale -= 0.1
            if (scale < minScale) scale = minScale
            const newW = Math.max(1, Math.round(rowBox.w * scale))
            const newH = Math.max(1, Math.round(rowBox.h * scale))
            if (newW === curW && newH === curH) break
            curW = newW
            curH = newH
            if (scale <= minScale) break
          }
          if (curW !== rowBox.w || curH !== rowBox.h) {
            displaced.add("separate")
            const png = await sharp(rowBox.png).resize(curW, curH).toBuffer()
            rowBox = { ...rowBox, png, w: curW, h: curH }
          }
        }
      }
      const top = topForOff(rowBox.h)
      const left = leftForOff(rowBox.w)
      const bottomLayer = { input: rowBox.png, top, left }
      // Vetro reale anche sul gradino (la sagoma alfa è quella della notch):
      // sfocatura più forte del vetro standard (gradino a due livelli, più
      // superficie da leggere).
      if (isNotchStep && notchStepMaterial === "vetro") {
        glassLayers.add(bottomLayer)
        glassBlurOverrides.set(bottomLayer, NOTCH_STEP_GLASS_SIGMA_BOOST)
      }
      pushFam("separate", bottomLayer)
      // Per-item corrections of the single cells: the row keeps its automatic
      // anchor/offset/fit; a corrected cell is composited on its own.
      const rowItemScale = bottom && bottom.w > 0 ? rowBox.w / bottom.w : 1
      for (const item of bottom?.items ?? []) {
        const slot = {
          top: top + item.top * rowItemScale,
          left: left + item.left * rowItemScale,
          w: item.w * rowItemScale,
          h: item.h * rowItemScale,
        }
        const itemTransform = badgeItemTransform(effectiveItemTransforms, item.id)
        // A pill also carries the correction of its PAINTED POSITION (the SLOT
        // this renderer already applied), so a slot-tuned pill reads as tuned
        // and an untouched one reads as automatic.
        const slotTransform = badgeItemTransform(effectiveItemTransforms, ratingSlotItemId(item.slot ?? 0) ?? "")
        const placed = applyBadgeItemTransform(slot, itemTransform)
        if (item.png) {
          const png =
            placed.w === item.w && placed.h === item.h
              ? item.png
              : await sharp(item.png).resize(placed.w, placed.h).toBuffer()
          pushFam("separate", { input: png, top: placed.top, left: placed.left })
        }
        badgeGeoItems.push({
          id: item.id,
          family: "separate",
          top: placed.top,
          left: placed.left,
          w: placed.w,
          h: placed.h,
          custom:
            !isNeutralBadgeItemTransform(itemTransform) || !isNeutralBadgeItemTransform(slotTransform),
        })
      }
      // Empty SLOT positions of the bottom row (same contract as the column:
      // preview-only, box only, never a pixel change).
      if (badgeHomeGhosts) {
        for (const ghost of bottom?.slotGhosts ?? []) {
          const slotTransform = badgeItemTransform(effectiveItemTransforms, ghost.id)
          const placed = applyBadgeItemTransform(
            {
              top: top + ghost.top * rowItemScale,
              left: left + ghost.left * rowItemScale,
              w: ghost.w * rowItemScale,
              h: ghost.h * rowItemScale,
            },
            slotTransform,
          )
          badgeGeoItems.push({
            id: ghost.id,
            family: "separate",
            top: placed.top,
            left: placed.left,
            w: placed.w,
            h: placed.h,
            custom: !isNeutralBadgeItemTransform(slotTransform),
            ghost: true,
          })
        }
      }
    }
  }


  // -----------------------------------------------------------------------
  // 6b. Fresh composition (solo layout=fresh): shade dedicata + numerale
  // vetro + colonna meta + provider + logo titolo. I layer entrano
  // all'insertion point registrato prima del chrome conservato (Coming Soon
  // e qualità già in `composites`, extra subito dopo): la shade resta sotto
  // il chrome e non lo scurisce mai. Velo pre-digitale e ombra superiore
  // restano sotto come nello standard (i badge fresh restano luminosi come
  // quelli standard); blur pipeline e ribbon invariati.
  // -----------------------------------------------------------------------
  ;({ freshOverlayGeo, freshBottomShadeLayer, typeIconInlineAux } = await composeFreshLayer({
    isFresh, topBadge, input, freshBaseBuf, CW, CH,
    badgesEnabled, badgeGenre, badgeYear, isBottomStyle, bottomVariant, genreName,
    year, voteAverage, typeIcon, mediaType, logoResult, networkLogoForLayout,
    badgeFont, freshOverlayGeo, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale,
    genreBadgeOffsetX, genreBadgeOffsetY, networkLogoScale, networkLogoOffsetX, networkLogoOffsetY, networkLogoFollowTitle,
    networkFixedX, networkFixedY, logoScale, logoOffsetX, logoOffsetY, blurOverlay,
    freshBottomShadeLayer, composites, freshInsertAt, typeIconInlineAux, isExtraTopBadge, finalRankBadge,
    finalRankLeft, finalRankTop,
  }))

  // -----------------------------------------------------------------------
  // 6c. Card composition (solo layout=provider-glass|nuvio|stremio): il
  // compositor condiviso (card-layout.ts) rende il poster completo da input
  // già risolti — nessun fetch, nessun renderer duplicato. `composites`
  // contiene a questo punto solo il chrome conservato (velo pre-digitale,
  // ombra superiore, Coming Soon, qualità: gli stessi tenuti per Fresh) più
  // l'extra qui sotto; la base finale diventa la card invece di freshBaseBuf
  // (vedi sezione 7).
  // -----------------------------------------------------------------------
  let cardPng: Buffer | null = null
  // Tracking per i metadata accent: il main badge Card è stato composto
  // (fill accentColorGenre effettivamente dipinto) oppure no.
  let cardMainBadgeRendered = false
  ;({ cardMainBadgeRendered, typeIconInlineAux, cardPng, cardOverlayGeo } = await composeCardLayer({
    isCard, topBadge, input, badgesEnabled, badgeGenre, badgeYear,
    isBottomStyle, bottomVariant, voteAverage, genreName, year, typeIcon,
    mediaType, badgePw, CW, badgeStyle, accentColorGenre, bottomLight,
    badgeFont, genreBadgeScale, cardMainBadgeRendered, typeIconInlineAux, genreBadgeLight, isLandscape,
    separateBadgeScaleEff, effSepBottomLight, CH, qualityStackAnchor, rankingBadgeStyle, ribbonSide,
    finalRankBadge, showComingSoon, effComingSoonSide, ribbonLayout, topRightAnchored, extraBadgeStyle,
    effSepTopLight, sepColumnVariant, sepOY, logoFetch, hideLogo, sepOX,
    displaced, composites, badgeGeo, networkLogoResult, rawLogoResult, accentOverride,
    networkLogoForLayout, posterBuf, blurOverlay, cardPng, logoScale, networkLogoScale,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, logoOffsetX, logoOffsetY, networkLogoOffsetX,
    networkLogoOffsetY, genreBadgeOffsetX, genreBadgeOffsetY, cardOverlayGeo, isExtraTopBadge, finalRankLeft,
    finalRankTop,
  }))


  // -----------------------------------------------------------------------
  // 6c-bis. Geometria badge per il drag della preview (debug `netgeo=1`).
  // Un solo punto di verità: ogni box è quello DAVVERO composto dal layout
  // attivo (Standard, Fresh o Card), raccolto nel punto di composite o dal
  // collector del compositor. La famiglia top segue il badge dipinto
  // (`extra` = layout fallback senza classifica); `rank` è il badge/il
  // numerale di classifica. `layout` descrive il poster INTERO (con o senza
  // classifica) ed è la chiave del reset per profilo.
  // -----------------------------------------------------------------------
  ;({ finalRankLeft, finalRankTop, genreBadgeRect, ratingBox, separateInkSource, qualityInkSource, netGeo } = await reportBadgeGeometry({
    isExtraTopBadge, isCard, topBadge, isFresh, finalRankBadge, finalRankLeft,
    badgeGeo, finalRankTop, isRankNetflixRibbonStyle, logoResult, freshOverlayGeo, cardOverlayGeo,
    isFixedNetwork, badgeGeoFixedX, badgeGeoItems, netRel, qualityRel, bottomRel,
    topRel, relGapPx, CW, relMarginPx, relBandBottomMargin, isBottomStyle,
    qualityStackAnchor, bodyFrame, genreBadgeRect, ratingBox, separateInkSource, qualityInkSource,
    combinedGenreOX, combinedGenreOY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY,
    combinedTopOX, combinedTopOY, topRankLayer, famLayers, qualityDetachedInk, netGeo,
    relLogoTop, relLogoBottom, CH, onNetworkGeometry, topFixedActive, topAnchorActive,
    logoAnchorEff, networkManual, qualityManual, bottomManual, displaced, input,
    composites, onBadgeGeometry,
  }))

  // -----------------------------------------------------------------------
  // 6d. Effective-accent metadata (display sync, `?accentmeta=1`).
  // -----------------------------------------------------------------------
  // Pure observer: reports the fills ACTUALLY passed to the builders above
  // (same variables, no second derivation, no extra decode, no pixel/key
  // changes). Std for the standard slots, the SAME `blurTintHex` already
  // mixed into the bottom gradient overlay for the gradient entry, null for
  // anything painting no automatic accent (non-consuming styles, suppressed
  // Fresh/Card chrome, fixed provider-glass/neutral glass, disabled or
  // zero-strength gradients).
  reportEffectiveAccentMeta({
    onAccentMeta, finalRankBadge, finalRankLeft, topBadge, showComingSoon, topPaintsAccent,
    isFresh, isCard, isExtraTopBadge, genrePaintsAccent, safeGenreBadgeResult, cardGenrePaints,
    cardMainBadgeRendered, accentColorGenre, genreStdAccent, rankStdAccent, accentOverride, blurOverlay,
    tintStrength, blurTintHex, sceneTintHex, bottomBand, topBand,
  })

  // -----------------------------------------------------------------------
  // 7. Final composite
  // -----------------------------------------------------------------------
  return composeFinalPoster({
    composites, CW, CH, isLandscape, isCard, cardPng, freshBaseBuf, freshBottomShadeLayer,
    seasonalTheme, seasonalFrameAfter, blurOverlay, showComingSoon, glassLayers, glassBlurOverrides,
    typeIcon, typeIconInlineAux, genreTypeIconInline: !!(genreTypeIcon && safeGenreBadgeResult),
    mediaType, badgePw, format: input.format, imageQuality: input.imageQuality,
  })
}




