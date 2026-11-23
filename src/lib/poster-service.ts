import { renderWatchProviderRow } from "@/lib/watch-providers-render"
import { renderTypeIcon } from "@/lib/type-icon-render"
import type { WatchProvider } from "@/lib/watch-providers"
import sharp from "sharp"
import type { RatingItem } from "./custom-rating/types"
import { renderMultiRatings, MAX_CUSTOM_RATINGS } from "./multi-rating-renderer"
import { resolveSeparateDisplayState } from "./poster-config"
import type { SeparateRating } from "./ratings"
import { MAX_SEPARATE_RATINGS } from "./ratings"
import { renderSeparateRatingStack, renderSeparateRatingsBottom, renderSeparateRatingsNotch, renderSeparateRatingsSideNotch, notchSeparateStepBodyHeight, notchSeparateStepText, type SeparateRatingStack } from "./separate-rating-renderer"
import { cacheGet, cacheSet } from "./cache"
import { GENRE_FALLBACK } from "./badges"
import { applyBlur } from "./blur"
import { STD_W, STD_H, extractSceneTint, fitBadgeToCanvas, fitCompositeToCanvas, isValidHex, BadgeRender, PosterComposite, badgeBody, badgeCanvasForBody, type BadgeBleed, scaleBadgeBleed, topBandMeanRGB, bottomBandMeanRGB, effectiveTopBackgroundLuminance, effectiveBottomBackgroundLuminance, adaptiveAccentHexForBand, insertFrostedGlassUnderlays, opaqueComponents, tightenBoxesToInk } from "./poster-render-helpers"
import { LAND_W, LAND_H } from "./image-utils"
import { normalizeAutomaticAccentHex } from "./accent-color"
import type { EffectiveAccentMeta } from "./effective-accent"
import { renderAwardLogoBadge } from "./award-logos"
import { awardShortName, type AwardBadgeKey } from "./badge-labels"
import { renderGenreBadge, renderRankingBadge, renderExtraBadge, renderComingSoonRibbon, comingSoonRibbonLayout } from "./svg-badge"
import { buildLogoScrim, logoContrast, logoInkLuminance, logoScrimStrength, posterLogoZoneLuminance } from "./logo-contrast"
import { renderFirstMatchingNetworkLogoBadge, renderFirstMatchingNetworkRawBadge, renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid, type NetworkCandidate } from "./network-svgs"
import { isNetworkFixedPosition } from "./network-follow"
import { isActiveQualityAnchor, isLogoRelativePosition, type LogoRelativePosition, type QualityAnchor, isActiveTopBadgeAnchor, type TopBadgeAnchor, type ExtraBadgeAnchor, isActiveBottomAnchor, bottomAnchoredLeft, bottomAnchoredBodyLeft, type BodyInkRatios, type BottomAnchor, anchorRect, anchorCol, anchorRow, isAnchorPosition, type AnchorChoice, type AnchorPosition } from "./badge-anchor"
import { computeLogoLayout, logoAlignPadX, isActiveLogoAnchor, isTopLogoAnchor, type LogoAnchor,PORTRAIT_LOGO_MAX_HEIGHT_PCT, PORTRAIT_LOGO_TOP_OFFSET, LANDSCAPE_LOGO_MAX_WIDTH_PCT, LANDSCAPE_LOGO_MAX_HEIGHT_PCT, LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT, LANDSCAPE_LOGO_TOP_OFFSET, LANDSCAPE_LOGO_SHIFT_X, LANDSCAPE_LOGO_SHIFT_Y } from "./logo-layout"
import { logoDefaultScaleFromAspect, FRESH_TITLE_LOGO_DEFAULT_SCALE } from "./logo-selection"
import { TOP_SHADOW_PAD } from "./badge-svg-shared"
import { computeTopBadge, getNextEpisodeLabel, isNetworkStudio, shouldSuppressExtraTopBadgeForNetwork, type BadgeInput } from "./poster-badge"
import type { MdbListWhatsonFeatures } from "./content-tags"
import { isNextEpisodeBadgeKey, DEFAULT_SASH_ORDER } from "./badge-priority"
import { DEMO_SAMPLE_NETWORK } from "./demo-samples"
import type { DateFormat } from "./release-badge"
import type { SashBucket } from "./badge-priority"
import { PRE_RELEASE_BLUR_SIGMA } from "./pre-release"
import type { Mapping, NetworkLogoPosition, PosterLayout, PosterFreshScope } from "./types"
import { type SeasonalTheme } from "./seasonal-theme"
import { isPosterFreshScope, DEFAULT_POSTER_FRESH_SCOPE } from "./types"
import type { ServerDefaults } from "./server-defaults"
import type { WikidataResult } from "./awards"
import { directorBadgeLabel } from "./awards"
import type { BadgeT } from "./poster-badge"
import type { BadgeFont } from "./badge-styles"
import { isRibbonRankingStyle, notchMaterialOf, qualityGroupNotchMaterial, isBottomSeparateRatingsStyle, columnNotchMaterialOf, isNotchSeparateRatingsStyle, isAgeBadgeStyle, isAwardBadgeMode, getSeparateRatingsStyleForShape, resolveNumberBadgeBaseOffsetX, normalizeExtraBadgeStyleForRender, resolveQualityGroupLayout, isMergedQualityStrip, DEFAULT_AGE_BADGE_STYLE, DEFAULT_AWARD_BADGE_MODE, type BadgeStyle, type RankingBadgeStyle, type ExtraBadgeStyle, type ExtraBadgeFollowRank, type SeparateRatingsStyle, type SeparateBottomVariant, type AgeBadgeStyle, type AwardBadgeMode, type QualityGroupLayout } from "./badge-styles"
import { normalizeBadgeFont } from "./badge-svg-shared"
import type { PosterImageFormat } from "@/lib/poster-runtime-cache"
import { DEFAULT_IMAGE_QUALITY, POSTER_ENCODE_QUALITY, type ImageQuality } from "@/lib/image-quality"
import { qualityBadgeIconPath } from "./quality-badge-styles"
import type { QualityBadgeStyle } from "./badge-styles"
import { isRankKey } from "./i18n"
import { composeFreshOverlay, composeFreshOverlaySplit, freshMetaRows, isEffectiveFreshLayout, isFreshRank, prepareFreshReconstructedBackground, type ComposeFreshInput, type FreshOverlayGeometry } from "./fresh-layout"
import { renderCardPoster, aggregateCardRating, cardMetadataBand, type CardOverlayGeometry } from "./card-layout"
import { cardLayoutGeometry, isCardRankDisplayable } from "./card-layout-geometry"
import { isEffectiveCardLayout, type CardSkin } from "./card-layout-skins"
import { resolveProviderGlassAccent } from "./provider-brand-palette"
import { applyBadgeItemTransform, badgeItemTransform, effectiveBadgeItemTransforms, homeIdForPainted, isNeutralBadgeItemTransform, isQualityItemId, isRatingItemId, ratingSlotItemId, serializeBadgeItemTransforms, type BadgeItemTransformMap } from "./badge-item-transforms"
import { type CornerRankRect, isCornerAnchoredStyle, resolveTopBadgeStyle, genreBadgeConsumesAccent, topBadgeConsumesAccent, cornerRankTop, cornerAnchoredLeft, isTopBadgeNumberRightCorner, numberSharesComingSoonCorner, type NetworkGeometry, type BadgeGeometryFamily, type BadgeGeometryLayout, type BadgeGeometryBox, type BadgeGeometryReport, type BadgeGeometryItem, NETWORK_LOGO_SHIFT_Y, NETWORK_ABOVE_LOGO_LIFT, cornerNetworkAboveTitle, stackNetworkBelowCornerRank, landscapeRightAnchorLeft } from "./badge-layout"
import { type QualityBadgeGroupResult, renderQualityBadgeGroup } from "./quality-badges"
export { type CornerRankRect, isCornerAnchoredStyle, resolveTopBadgeStyle, genreBadgeConsumesAccent, topBadgeConsumesAccent, cornerRankTop, cornerAnchoredLeft, isNumberRightCorner, isTopBadgeNumberRightCorner, numberSharesComingSoonCorner, type NetworkGeometry, type BadgeGeometryFamily, type BadgeGeometryLayout, type BadgeGeometryBox, type BadgeGeometryReport, type BadgeGeometryItem, NETWORK_LOGO_SHIFT_Y, NETWORK_ABOVE_LOGO_LIFT, type CornerNetworkAboveTitleInput, cornerNetworkAboveTitle, stackNetworkBelowCornerRank } from "./badge-layout"
export { __resetQualityIconCacheForTests, renderQualityIconBadge, renderColorIconBadge, renderPremiumIconBadge, renderAvKnockoutBadge, type QualityBadgeItem, type QualityBadgeGroupResult, type QualityHomeGhost, renderQualityBadgeGroup } from "./quality-badges"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const BADGE_CACHE_TTL = 24 * 60 * 60 * 1000

// B2: scala % di un bitmap già renderizzato (un solo resize sharp).
// Condiviso dai 4 badge scalabili (rank/genere/qualità/network): stessa
// matematica dei blocchi inline sostituiti (round + max 1px, no-op se le
// dimensioni non cambiano). Lo spread preserva i campi extra (isRank, …);
// il bleed viaggia con la bitmap (stesso rapporto effettivo, come nel fit).
async function scaleBitmapForLayout<T extends BadgeRender>(r: T, pct: number): Promise<T> {
  const w = Math.max(1, Math.round(r.w * pct / 100))
  const h = Math.max(1, Math.round(r.h * pct / 100))
  if (w === r.w && h === r.h) return r
  const png = await sharp(r.png).resize(w, h).toBuffer()
  const bleed = r.bleed ? scaleBadgeBleed(r.bleed, w / r.w, h / r.h) : undefined
  return { ...r, png, w, h, ...(bleed ? { bleed } : {}) }
}


/** Bounding box dell'inchiostro (alpha > 40) di un bitmap badge, in px del bitmap. */
async function inkBounds(png: Buffer): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 40) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * Rapporti (offset, larghezza) dell'inchiostro visibile rispetto al CORPO del
 * badge: input di `bottomAnchoredBodyLeft`. Costo (un decode sharp) solo con
 * ancora inferiore attiva. Null = bitmap senza inchiostro.
 */
async function inkRatios(badge: { png: Buffer; w: number; h: number; bleed?: BadgeBleed }): Promise<BodyInkRatios | null> {
  const body = badgeBody(badge)
  const ink = await inkBounds(badge.png)
  if (!ink || body.w <= 0) return null
  return { offset: (ink.x - body.x) / body.w, width: ink.w / body.w }
}

/** Scala minima di genere + riga rating per farli entrare "sotto il logo". */
const BELOW_LOGO_MIN_SCALE = 0.4
/** Il logo (ancora Auto) sale per tenere i badge "sotto il logo" almeno a questa scala. */
const LOGO_LIFT_TARGET_SCALE = 0.8
/** Salita massima del logo, in frazione dell'altezza canvas. */
const LOGO_LIFT_MAX_FRAC = 0.15

/** Respiro minimo tra inchiostro del badge genere e logo titolo. */
const LOGO_BADGE_GAP = 6

/**
 * Anti-collisione badge/logo: shrink (floor 0.75, passo 0.05) finché
 * l'inchiostro del badge, piazzato da `placeBody` (ancora del CORPO, come il
 * layout), resta a più di `LOGO_BADGE_GAP` px da `rect`. Se nemmeno a 0.75
 * basta (logo molto largo sulla stessa linea), il badge resta a grandezza
 * piena e sale sopra il logo (`dy` negativo sul top). Nessuna collisione →
 * stesso oggetto e `dy` 0 (byte-identico allo storico).
 */
/** Sovrapposizione di due box `{left,top,w,h}` con margine di respiro `m` (px). */
function rectsOverlap(
  a: { left: number; top: number; w: number; h: number },
  b: { left: number; top: number; w: number; h: number },
  m = 0,
): boolean {
  return a.left < b.left + b.w + m && a.left + a.w > b.left - m && a.top < b.top + b.h + m && a.top + a.h > b.top - m
}

async function shrinkAwayFromRect<T extends BadgeRender>(
  badge: T,
  rect: { top: number; left: number; w: number; h: number },
  placeBody: (body: { w: number; h: number }) => { top: number; left: number },
): Promise<{ badge: T; dy: number }> {
  const ink = await inkBounds(badge.png)
  if (!ink) return { badge, dy: 0 }
  const inkAt = (scale: number) => {
    const w = Math.max(1, Math.round(badge.w * scale))
    const h = Math.max(1, Math.round(badge.h * scale))
    const bleed = badge.bleed ? scaleBadgeBleed(badge.bleed, w / badge.w, h / badge.h) : undefined
    const at = placeBody(badgeBody({ w, h, bleed }))
    const canvas = badgeCanvasForBody(at.left, at.top, { bleed })
    const kx = w / badge.w
    const ky = h / badge.h
    return { x: canvas.left + ink.x * kx, y: canvas.top + ink.y * ky, w: ink.w * kx, h: ink.h * ky }
  }
  const hits = (scale: number): boolean => {
    const k = inkAt(scale)
    return k.x < rect.left + rect.w + LOGO_BADGE_GAP && k.x + k.w > rect.left - LOGO_BADGE_GAP
      && k.y < rect.top + rect.h + LOGO_BADGE_GAP && k.y + k.h > rect.top - LOGO_BADGE_GAP
  }
  if (!hits(1)) return { badge, dy: 0 }
  let scale = 1
  while (scale > 0.75 && hits(scale)) scale = Math.max(0.75, Math.round((scale - 0.05) * 100) / 100)
  if (!hits(scale)) return { badge: await scaleBitmapForLayout(badge, scale * 100), dy: 0 }
  const full = inkAt(1)
  return { badge, dy: Math.min(0, Math.round(rect.top - LOGO_BADGE_GAP - (full.y + full.h))) }
}

// Base geometrica pills landscape: -20px X / -10px Y rispetto all'ancoraggio
// neutro (margine pieno 18*CW/380 + margine basso 20*CH/570). Solo default di
// geometria: gli slider sepox/sepoy restano neutri a 0 e si sommano sopra;
// default globali separateBadgeOffset invariati (la colonna non si sposta).
export const LANDSCAPE_BOTTOM_PILLS_SHIFT_X = -20
export const LANDSCAPE_BOTTOM_PILLS_SHIFT_Y = -10

// Base geometrica separati portrait: +5px Y (verso il basso) rispetto
// all'ancoraggio storico, SOLO formato poster/verticale, stili colonna e
// bottom-pills. Solo default di geometria PRIMA degli offset utente
// (sepox/sepoy neutri a 0 e additivi dopo, con clamp dentro il canvas);
// default globali separateBadgeOffset invariati (0 resta 0, nessun fallback
// landscape toccato). Eccezione: bottom-bar portrait full-width a filo
// (top = CH - h): il +5 sarebbe annullato dal clamp, resta a filo.
export const PORTRAIT_SEPARATE_SHIFT_Y = 5

// Fattore del sigma di sfocatura del vetro sul gradino dei rating separati
// (`notch-vetro`): il gradino copre due livelli, quindi la sfocatura reale è
// più forte del vetro standard (σ base = max(4, CW/40)) per restare leggibile.
export const NOTCH_STEP_GLASS_SIGMA_BOOST = 1.6


export interface GenerationInput {
  ratings?: RatingItem[]
  /** Colonna rating separati a destra (sostituisce la media ★), max 5. */
  separateRatings?: readonly SeparateRating[]
  // Images (already fetched)
  posterBuf: Buffer
  logoFetch: Buffer | null
  backdropFetch: Buffer | null

  // Layout
  backdropScale: number
  backdropOffsetX: number
  backdropOffsetY: number

  // Blur
  blurEnabled: boolean
  blurHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  /** Intensità tinta di scena 0-100 (default 20, convertita in frazione per applyBlur). */
  tintStrength?: number
  /**
   * Ombra lineare superiore 0-100 (default 50, come la catena di default).
   * Solo flat (vale per entrambi i canvas): incornicia il poster e
   * fa risaltare badge/testi superiori. Sotto logo e badge.
   */
  topShade?: number
  /**
   * Altezza dell'ombra superiore in % del canvas 0-100 (default 25 = look
   * storico). Solo flat (vale per entrambi i canvas). 0 = ombra disattivata
   * qualunque sia `topShade`.
   */
  topShadeHeight?: number

  // Badge flags
  badgesEnabled: boolean
  rankingEnabled: boolean
  genreName: string | null
  voteAverage: number | null
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /** Standalone extra-badge style: null/sentinel = legacy `rankingBadgeStyle` fallback. */
  extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | string | null
  /** Quali componenti del badge genere/rating mostrare (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality?: boolean
  quality?: string | null
  /** Etichetta di classificazione per età già risolta e sanificata dalla
   *  route (null = badge nascosto: disabilitato o dati assenti). Il gruppo
   *  qualità la compone in stile `ageBadgeStyle` tra tier 4K e formati A/V
   *  top-right (ordine: qualità, età, formati), con gli stessi offset/scale/cap
   *  della qualità. */
  ageLabel?: string | null
  /** Stile della pill di classificazione per età ("standard" = resa storica;
   *  "knockout" = white tag with mask-cut glyphs (transparent cut-out,
   *  dedicated age-only builder — never the shared quality-knockout
   *  builder, which stays byte-identical).
   *  Absent/invalid = "standard". */
  ageBadgeStyle?: AgeBadgeStyle | null
  /** Modalità del top-badge premi (`badge` = resa testuale storica,
   *  `logo` = icona del premio canonico su pill antracite). Assente/invalido
   *  = `badge` (nessun pixel cambia). */
  awardBadgeStyle?: AwardBadgeMode | null
  /** Font dei testi badge ("inter" = resa storica; i loghi restano invariati). */
  badgeFont?: BadgeFont | null
  /** Stile icone del badge qualità (standard = pill testuale). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /**
   * Layout del gruppo qualità: `stacked` (default, colonna storica) o `row`
   * (orizzontale, max 2 per riga). Assente/invalido = `stacked` (nessun pixel
   * cambia rispetto allo storico).
   */
  qualityGroupLayout?: QualityGroupLayout | null
  /** Marchi qualità da affiancare al tier (formati A/V built-in + marchi del pack). */
  videoFormats?: readonly string[] | null
  /** Ordine/priorità sash (sottoinsieme = resto spento). Default = ordine standard. */
  sashOrder?: readonly SashBucket[] | null
  /**
   * Tag badge automatici disabilitati space-wide (ID canonici). Filtra PRIMA
   * della selezione priorità (il candidato disabilitato cede al successivo).
   * Assente/vuoto = storico. Override manuali mai filtrati.
   */
  disabledContentTags?: readonly string[] | null
  /**
   * Mark network disabilitati space-wide (ID canonici). Skippati prima dei
   * path locale e fallback TMDB, su tutti i layout (Standard/Fresh/Card).
   * Assente/vuoto = storico.
   */
  disabledNetworks?: readonly string[] | null
  topLight: boolean
  /** Polarità del badge genere in basso (fondo chiaro → pill scura). Default = topLight (comportamento storico). */
  bottomLight?: boolean
  /** Polarità del badge in alto (rank/extra) misurata sulla finestra del badge. Default = topLight. */
  topBadgeLight?: boolean
  /** Polarità del badge genere misurata sulla finestra del badge. Default = bottomLight ?? topLight. */
  genreBadgeLight?: boolean
  /**
   * Visibilità badge di riferimento per la reservation logo (solo geometria):
   * in bottom la route passa l'equivalente colonna così il logo titolo resta
   * alla stessa altezza. Assente → si usano i flag effettivi del render.
   */
  logoBadgeVisibility?: { genre: boolean; year: boolean; rating: boolean }
  targetCenter: number
  /** Modalità layout nastro Netflix + logo network: "left" (Nuvio, default) o "right" (Stremio). */
  ribbonSide: "left" | "right"
  /**
   * Tinta accent sul badge classifica centrato: true quando il nastro è OFF
   * e lo stile pre-degrado era "colored" (senza nastro deve colorare il
   * badge default come riempimento piatto).
   */
  rankingBadgeAccent?: boolean
  /**
   * Nastro stile Netflix all'angolo (default true = comportamento storico).
   * Su false il Coming Soon pre-digitale viene reso come pill centrale e gli
   * stili classifica nastro sono già degradati a monte (poster-config).
   */
  ribbonEnabled?: boolean

  // Logo
  logoScale: number | null
  logoOffsetX: number | null
  logoOffsetY: number | null
  /** Disattiva la velatura di sicurezza sotto al logo (default: attiva). */
  logoScrimDisabled?: boolean

  // Badge superiore (rank/extra in alto): scala % su tutti gli stili
  // (la barra scala nativa via font per restare full-width),
  // offset px solo sugli stili centrati (nastro/barra restano ancorati).
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  /**
   * Tuning EXTRA superiore risolto (null = assente ovunque: il render
   * applica il fallback legacy sul tuning classifica). Opzionale: i consumer
   * esistenti restano invariati e il percorso legacy è byte-identico.
   */
  extraBadgeScale?: number | null
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  /** Scala % del badge genere/rating in basso, su tutti gli stili (barra nativa via font). */
  genreBadgeScale: number
  /** Offset px del badge genere/rating, solo stili non-bar. */
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  /** Scala % del badge qualità streaming. */
  qualityBadgeScale: number
  /** Scala % della colonna rating separati (default 100 = resa storica). */
  separateBadgeScale: number
  /**
   * Offset px del gruppo rating separati (colonna/pills interi, mai singoli
   * provider; bar portrait: solo Y, X ignorata). Opzionali con default 0:
   * i consumer esistenti (test diretti, vecchi adapter) restano invariati e
   * a 0 il percorso è byte-identico allo storico.
   */
  separateBadgeOffsetX?: number
  separateBadgeOffsetY?: number
  /**
   * Layout dei rating separati ("column" = colonna destra storica;
   * "bottom-bar"/"bottom-pills"/"bottom-mono"/"bottom-color" = riga in basso
   * con genere+anno+voto soppressi a monte via flag effettivi). Opzionale con
   * default "column": i consumer esistenti (test diretti, vecchi adapter)
   * restano invariati.
   */
  separateRatingsStyle?: SeparateRatingsStyle
  /** Offset px del badge qualità. */
  qualityBadgeOffsetX: number
  qualityBadgeOffsetY: number
  /** Scala % del logo network. */
  networkLogoScale: number
  /** Offset px del logo network. */
  networkLogoOffsetX: number
  networkLogoOffsetY: number

  // Badge data sources
  mediaType: "movie" | "tv"
  /** TMDB ID per il lookup premi certi (liste ID in award-ids.ts). */
  tmdbId?: number | null
  /** Data uscita digitale già calcolata dal pre-release: Just Added. */
  digitalReleaseDate?: string | null
  finalRank: number | null
  animeRankResult: number | null
  rankingResult: number | null
  mapping: Mapping | null
  tmdbNetworks: readonly string[]
  productionCompanies: readonly string[]
  tmdbStudios: readonly string[]
  /** Mappa name -> logo_path TMDB per fallback (SVG first -> TMDB). */
  tmdbNetworksDetailed?: readonly NetworkCandidate[]
  /** "Dove guardare": provider flatrate già risolti dalla route; se presenti sostituiscono il logo network. */
  watchProviders?: readonly WatchProvider[]
  /** Icona tipo film/serie in basso a sinistra (`ti`), default OFF. */
  typeIcon?: boolean
  productionCompaniesDetailed?: readonly NetworkCandidate[]
  tvType: string | null
  tvStatus: string | null
  releaseDate: string | null
  firstAirDate: string | null
  /** Ultima messa in onda + n. stagioni + origin country (badge Nuova stagione / K-Drama). */
  lastAirDate: string | null
  seasonCount: number | null
  /** `next_episode_to_air.air_date` + `number_of_episodes` TMDB (badge Nuovo episodio / Solo N episodi). */
  nextEpisodeAirDate?: string | null
  numberOfEpisodes?: number | null
  originCountries: readonly string[]
  /** ID generi TMDB canonici (16 = Animation) — escludono l'animazione dal K-Drama automatico. */
  genreIds?: readonly number[] | null
  wikidataResult: WikidataResult
  tmdbKeywords: readonly string[]
  locale: string
  /** Formato data badge "in uscita" (query `df` > default utente; default `locale`). */
  dateFormat?: DateFormat | null
  /**
   * Portrait Standard only: with no top badge painted (no rank/extra, no
   * Coming Soon) the genre/rating badge takes the free top slot instead of
   * the bottom (query `gtop` > default utente; default false).
   */
  genreTopWhenFree?: boolean
  /** Overflow dei badge in Auto (`bov`): "hide" = le famiglie che il layout sposterebbe o
   *  ridimensionerebbe per una collisione non si disegnano (manuali/rank/extra mai). */
  badgeOverflow?: "move" | "hide"
  t: BadgeT
  qLabel: string | null
  queryExtra: string | null
  qNetLogo: string | null
  networkLogo?: boolean
  /**
   * Demo samples (Settings defaults preview only, route-gated with preview=1
   * plus the explicit flag): when the ordered network candidates resolve
   * nothing, retry once with the bundled brand. Real brands keep absolute
   * priority (order untouched); toggle-off never reaches the lookup.
   */
  demoSamples?: boolean
  /**
   * Posizione del logo network ("top" = sempre all'angolo superiore, lato
   * del nastro effettivo; "auto" = specchio dinamico odierno). Default "auto"
   * (byte-identico al passato).
   */
  networkLogoPosition?: NetworkLogoPosition
  /**
   * Ancora d'angolo del logo titolo (solo Standard; Fresh/Card la ignorano).
   * "auto" (default) = posizione storica, byte-identica. Vedi `LogoAnchor`.
   */
  logoAnchor?: LogoAnchor
  /**
   * Ancora d'angolo del badge qualità (solo Standard; Fresh/Card la ignorano).
   * "auto" (default) = lato storico, byte-identico. Vedi `QualityAnchor`.
   */
  qualityAnchor?: QualityAnchor
  /**
   * Ancora d'angolo del badge superiore centrato (rank/extra; solo Standard,
   * Fresh/Card la ignorano; corner/numerale e nastro Netflix non la usano).
   * "auto" (default) = posizione centrata storica, byte-identica. Vedi `TopBadgeAnchor`.
   */
  topBadgeAnchor?: TopBadgeAnchor
  /**
   * Ancora d'angolo del badge EXTRA (`xanc`): stesse regole di `topBadgeAnchor`,
   * ma indipendente. Si applica solo se il badge superiore è di tipo extra.
   */
  extraBadgeAnchor?: ExtraBadgeAnchor
  /**
   * Ancora della fascia inferiore: genere, riga rating personalizzata e riga
   * rating separati bottom (solo Standard; Fresh/Card ignorano). Cambia solo
   * l'asse X. "auto" (default) = storico, byte-identico. Vedi `BottomAnchor`.
   */
  bottomAnchor?: BottomAnchor
  /**
   * Il network segue il layout storico ancorato al titolo (default true =
   * comportamento attuale). false + coordinate fisse valorizzate = posizione
   * assoluta top-left in px nel canvas del formato: salta TUTTI i
   * reposition/shrink da titolo/badge/mirror; la scala resta ancorata
   * top-left. Opzionale: i consumer esistenti restano invariati.
   */
  networkLogoFollowTitle?: boolean
  /**
   * Coordinate assolute del box network (angolo top-left) in px nel canvas
   * del formato, solo quando `networkLogoFollowTitle === false`. Null/assenti
   * = layout storico anche con follow spento (mai (0,0) implicito).
   * Per-shape (mai fallback cross-shape): risolte in poster-config.
   */
  networkFixedX?: number | null
  networkFixedY?: number | null
  /**
   * Collettore una-tantum della geometria network effettivamente composta
   * (o null se non resa): unica fonte per il freeze senza salto (debug).
   * Solo numeri, nessun dato sensibile. Assente = nessun overhead.
   */
  onNetworkGeometry?: ((geo: NetworkGeometry | null) => void) | null
  /**
   * Collettore una-tantum della geometria FINALE dei badge (box effettivamente
   * composti, in px del canvas reso): unica fonte per le maniglie di drag
   * della preview. Solo numeri, nessun dato sensibile. Assente = nessun
   * overhead.
   */
  onBadgeGeometry?: ((report: BadgeGeometryReport) => void) | null
  /**
   * Per-ITEM corrections of the badge groups (single rating pill / single
   * quality or A/V mark), by stable identity. Empty/absent = automatic
   * layout, byte-identical to the historic render. Applied by the shared
   * renderer only; the client never guesses item geometry.
   */
  badgeItemTransforms?: BadgeItemTransformMap | null
  /**
   * Publish the badge GHOSTS in the badge geometry report (box only): the
   * empty quality HOMES and the empty separate-rating SLOTS. Preview
   * diagnostic only (`debug=1&netgeo=1&ghosts=1`): the Stremio render path
   * never sets it, so no ghost is ever reported there.
   */
  badgeHomeGhosts?: boolean
  /**
   * Collettore una-tantum dei fill accent EFFETTIVAMENTE dipinti sui badge
   * (display sync del picker, ramo `?accentmeta=1`): invocato una sola volta
   * per render riuscito, con gli stessi fill già passati ai builder (Std per
   * gli slot standard, null per gli slot che non dipingono alcun accent
   * automatico). Puro osservatore:
   * non altera pixel, chiavi o cache. Assente = nessun overhead.
   */
  onAccentMeta?: ((meta: EffectiveAccentMeta) => void) | null
  sd: ServerDefaults
  accentOverride: { genreColor: string; rankColor: string } | null
  /** Pre-resolved IMDb Top 250 membership. Falls back gracefully when falsy. */
  imdbTop250?: boolean
  /**
   * MDBList/WhatsOn feature flags from the SAME ratings response (zero extra
   * fetch, resolved by the route). Absent/null = no automatic feature badge;
   * each badge still respects `disabledContentTags` (dct) via the canonical
   * tag ids inside `computeTopBadge`.
   */
  whatsonFeatures?: MdbListWhatsonFeatures | null
  /** Path sorgente del poster (cache image-level). Assente → niente cache. */
  posterSrc?: string | null
  /**
   * Chiave analisi pixel (luminance/tinta) costruita dalla route: identifica i
   * byte effettivi della base (`portrait:poster:…`, `landscape:backdrop:…`,
   * `landscape:pillarbox:…`), non il path nominale — pillarbox e backdrop
   * derivano da sorgenti diverse a parità di path. Assente → ricalcolo diretto.
   */
  analysisKey?: string | null
  /** Formato di output negoziazione Accept (jpeg | webp | avif). Default: jpeg. */
  format?: PosterImageFormat
  /** Qualità di codifica (Preferenze, istanze private). Default: medium = storico. */
  imageQuality?: ImageQuality
  /** Path sorgente del logo (cache image-level). Assente → niente cache. */
  logoSrc?: string | null
  /** Path sorgente del backdrop (cache image-level). Assente → niente cache. */
  backdropSrc?: string | null
  /**
   * Allineamento orizzontale del blocco logo/metadati ("center" = classico,
   * "left" = Cinematic). Default center (byte-identico al passato).
   */
  logoAlign?: "left" | "center"
  /**
   * Graphical poster layout risolto dalla route (query `layout` > mapping
   * effettivo per formato > config token > defaults effettivi > "standard").
   * "fresh" compone il layout grafico alternativo nel blocco 6b (shade
   * dedicata + numerale vetro + colonna meta + provider + logo ancorato),
   * riusando base/blur/qualita/ribbon/extra standard. Opzionale: i consumer
   * esistenti restano invariati.
   */
  posterLayout?: PosterLayout | null
  /**
   * Fresh apply scope risolto dalla route (query `freshScope` > mapping
   * effettivo per formato > config token > defaults effettivi > "ranked").
   * Con "ranked" il renderer decide il layout EFFETTIVO dal rank mostrato
   * (vedi isEffectiveFreshLayout): senza rank valido rende Standard
   * byte-identico. Opzionale: assente = "ranked" (default condiviso).
   */
  posterFreshScope?: PosterFreshScope | null
  /**
   * Raw (pre-suppression) rating-component toggle for the fresh meta column.
   * The route resolves `badgeRating` raw from query/mapping/config/defaults
   * and passes the EFFECTIVE (suppressed) value in `badgeRating`; fresh needs
   * the raw toggle to apply the shared gates itself
   * (resolveSeparateDisplayState). Absent = backward compat for direct
   * service callers (raw toggle = effective `badgeRating`). Never inferred
   * from array existence: an explicit `badgeRating: false` with populated
   * arrays still renders no separate rows.
   */
  freshRawBadgeRating?: boolean
  /**
   * Raw separate-ratings toggle (`sep` chain) for the fresh meta column.
   * Same contract as `freshRawBadgeRating`: route passes the raw config,
   * absent = array-defined (direct callers declaring arrays keep them
   * active, still gated by the raw rating toggle).
   */
  freshRawSeparateRatings?: boolean
  /**
   * Raw (pre-suppression) genre/year toggles for the Card main badge. The
   * route passes the EFFECTIVE (bottom-suppressed) values in `badgeGenre` /
   * `badgeYear`; the user-explicit combined badge + separates needs the raw
   * values (same pattern as `freshRawBadgeRating`). Absent = backward compat
   * for direct service callers (the passed `badgeGenre` / `badgeYear` as-is).
   */
  freshRawBadgeGenre?: boolean
  freshRawBadgeYear?: boolean
  /**
   * Effetto pre-digitale già risolto dalla route (flag `pre` ON + film
   * rilevato senza disponibilità digitale/streaming): velo scuro + badge
   * "Coming Soon". Solo film, indipendente dai toggle badges/ranking.
   */
  preRelease?: boolean
  /**
   * Fase teatrale del rilevamento pre-digitale (solo film): true = già uscito
   * in sala (data teatrale passata), false = non ancora uscito. Cambia
   * l'etichetta del badge ("Al cinema" vs "Prossimamente") e, per la fase in
   * sala, spegne velo scuro e sfocatura: resta il solo badge. Il nastro
   * angolare resta legato al solo "Prossimamente". Ignorato con `preRelease`
   * false.
   */
  preInTheaters?: boolean
  /**
   * Formato canvas (prova orizzontale): "poster" (500×750, default) o
   * "landscape" (768×432, base = backdrop TMDB). La route costruisce già
   * `posterBuf` alle dimensioni giuste; qui CW/CH guidano solo overlay,
   * badge e posizioni.
   */
  shape?: "poster" | "landscape"
  /**
   * Nasconde il logo film dal composite (il fetch resta per i colori accent).
   * Solo query esplicita `hideLogo=1` (banner Nuvio pulito): il landscape
   * cuoce il logo come il portrait, coi vincoli del canvas 16:9.
   */
  hideLogo?: boolean
  /**
   * Seasonal frame theme (ephemeral originating-catalog context, already
   * resolved query-only by the route via `resolveSeasonalTheme`). Any
   * canonical theme (`halloween`, `christmas`) renders on BOTH canvases —
   * each with its OWN user-supplied asset (portrait `500×750`, landscape
   * `768×432` via `seasonalFrameAssetPath`, never a stretch) — in every
   * layout (standard, Fresh and Card: the frame sits ABOVE the background /
   * picture treatment but BELOW ALL chrome — logo, badges and the composed
   * Fresh/Card overlays — by explicit user request).
   * Null/absent = unframed.
   */
  seasonalTheme?: SeasonalTheme | null
}

// ---------------------------------------------------------------------------
// Badge cache helpers (coalescing) — implementazione in poster-cache-infra.ts.
// `badgeCacheKey` è ri-esportata per compatibilità (test + consumer storici).
// ---------------------------------------------------------------------------
import { badgeCacheKey, coalesceBadgeRender } from "./poster-cache-infra"
export { badgeCacheKey } from "./poster-cache-infra"

// Overlay full-canvas e cache image-level estratti in moduli dedicati;
// le API storiche restano ri-esportate da qui.
import { getVignette, getLandscapeScrim, getPreReleaseDim, loadSeasonalFrame, getTopShade } from "./poster-overlay-cache"
export { __resetSeasonalFrameCacheForTests } from "./poster-overlay-cache"
import { resizeLogoCached, backdropMetaCached, resizeBackdropCached } from "./poster-image-cache"
export { resolveBadgeColors, resizeLogoCached, backdropMetaCached, resizeBackdropCached, type BadgeColorsResult, type ResizedImage } from "./poster-image-cache"



/**
 * Card NON-provider-glass brand accent (P5 correction): an explicit manual
 * accent (`ac=` query or saved per-title mapping, via `accentOverride`)
 * wins when present — that is the existing control semantics (the user's
 * explicit color choice), so it tints the glass. Otherwise the tint derives
 * from the ALREADY-RESOLVED original brand bitmap (`networkLogoForLayout`,
 * raw provider colors passed to the Card below — no new fetch, no copied
 * per-provider catalog matcher): bounded sampling of opaque pixels only
 * (alpha >= 200, so the raw badge's soft drop-shadow halo never votes).
 * NOTE: `provider-glass` no longer uses this sampler — it resolves from
 * the fixed brand palette by identity (`resolveProviderGlassAccent` in
 * `provider-brand-palette.ts`, brand key from the original match record).
 * (alpha >= 200, so the raw badge's soft drop-shadow halo never votes).
 * A white / achromatic brand (all-white wordmarks, monochrome marks, TMDB
 * logo fallbacks which render white) carries no brand hue and falls back to
 * the documented neutral (the compositor's `#555555` gray glass) — never the
 * scene tint, which describes the artwork atmosphere, not the provider brand.
 * Returns null when no brand color applies (missing provider, white brand,
 * unreadable bitmap): the caller passes null and the compositor renders the
 * documented neutral glass. Never throws, never invents a brand color.
 */
export async function resolveCardBrandAccent(
  providerLogo: { png: Buffer } | null | undefined,
  accentOverride: { genreColor: string; rankColor: string } | null | undefined,
): Promise<string | null> {
  if (accentOverride && isValidHex(accentOverride.genreColor)) return accentOverride.genreColor
  if (!providerLogo || !Buffer.isBuffer(providerLogo.png) || providerLogo.png.length === 0) return null
  try {
    const { data, info } = await sharp(providerLogo.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const channels = info.channels ?? 4
    const total = info.width * info.height
    if (!Number.isFinite(total) || total <= 0) return null
    // Bounded: at most ~8k samples, evenly spaced (brand bitmaps are small;
    // the stride keeps large TMDB fallbacks cheap without a PNG roundtrip).
    // ceil, not floor: floor(total/8192) still samples up to 16383 pixels on
    // large bitmaps, breaking the advertised bound. No pre-resize: brand
    // bitmaps are small and this single raw decode is already stride-bounded.
    const step = Math.max(1, Math.ceil(total / 8192))
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < total; i += step) {
      const o = i * channels
      const a = channels >= 4 ? (data[o + 3] ?? 0) : 255
      if (a < 200) continue
      r += data[o] ?? 0
      g += data[o + 1] ?? 0
      b += data[o + 2] ?? 0
      n++
    }
    if (n === 0) return null
    const ar = Math.round(r / n)
    const ag = Math.round(g / n)
    const ab = Math.round(b / n)
    // No usable hue (white / gray / black marks): documented neutral.
    if (Math.max(ar, ag, ab) - Math.min(ar, ag, ab) < 30) return null
    const to2 = (v: number): string => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")
    return `#${to2(ar)}${to2(ag)}${to2(ab)}`
  } catch {
    return null
  }
}

/**
 * Card main badge (P15): the EXISTING standard genre/rating renderer fed with
 * the ONE aggregate score (`aggregateCardRating` of the selected stack, P8)
 * instead of the ordinary single vote — never a second Card genre SVG/text
 * flow/star/year renderer. Parts follow the raw (pre-suppression) toggles so
 * the main badge stays combined with the optional separate individuals
 * (user-explicit); style/font/accent/polarity/scale match the standard badge
 * exactly. `aggregate: null` renders no rating segment (vote 0 = empty
 * `voteStr`, same as the standard builder). Bar styles scale natively via
 * font (full-width); other styles scale via bitmap at the call site, exactly
 * like the standard path. Exported for the pixel-equality tests (single call
 * site below, no duplication).
 */
export async function renderCardMainBadge(args: {
  readonly genreName: string | null
  readonly year: string | undefined
  readonly aggregate: number | null
  readonly showGenre: boolean
  readonly showYear: boolean
  readonly showRating: boolean
  /** Icona tipo film/serie inline (stessa riga del genere). */
  readonly typeIcon?: "movie" | "tv" | null
  readonly badgePw: number
  readonly CW: number
  readonly badgeStyle: BadgeStyle
  readonly accentColor: string
  readonly bottomLight: boolean
  readonly badgeFont: BadgeFont
  readonly nativeScale: number
}): Promise<{ png: Buffer; w: number; h: number } | null> {
  const vote = args.aggregate ?? 0
  const key = badgeCacheKey("card-genre", args.genreName, vote, args.CW, args.year, args.badgeStyle, args.badgeFont, args.accentColor, args.bottomLight, args.showGenre, args.showYear, args.showRating, args.nativeScale, args.typeIcon ?? null)
  const cached = cacheGet<{ png: Buffer; w: number; h: number }>(key)
  if (cached) return cached
  return coalesceBadgeRender(key, () =>
    renderGenreBadge(args.genreName ?? "", vote, args.badgePw, args.year, args.badgeStyle, args.accentColor, args.bottomLight, { showGenre: args.showGenre, showYear: args.showYear, showRating: args.showRating, typeIcon: args.typeIcon ?? null }, args.nativeScale, args.badgeFont)
      .then((r) => { if (r) cacheSet(key, r, ["badge"], BADGE_CACHE_TTL); return r }),
  )
}

/**
 * Vertical stack of two already-rendered Card overlay bitmaps (custom row
 * above the main badge, main badge above the bottom row), each centered on
 * the max width. Sharp-only composition of existing bitmaps, no renderer.
 */
async function stackCardOverlayParts(
  top: { png: Buffer; w: number; h: number },
  bottom: { png: Buffer; w: number; h: number },
  gap: number,
): Promise<{ png: Buffer; w: number; h: number }> {
  const w = Math.max(top.w, bottom.w)
  const h = top.h + gap + bottom.h
  const png = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: top.png, left: Math.round((w - top.w) / 2), top: 0 },
      { input: bottom.png, left: Math.round((w - bottom.w) / 2), top: top.h + gap },
    ])
    .png()
    .toBuffer()
  return { png, w, h }
}


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
  type RelEntry = { key: "band" | "quality" | "network" | "top"; side: LogoRelativePosition; h: number; bm: number }
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
  type InkSource = { png: Buffer; left: number; top: number; body?: { left: number; top: number; w: number; h: number } }
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
  if (isFresh) {
    // Stessa priorità dello standard: il rank arriva dal topBadge già
    // risolto (queryExtra > computato > Coming Soon). Mai inventato: solo un
    // rank reale disegna il numerale.
    const freshRank = topBadge?.type === "rank" ? topBadge.rank : null
    // La route pre-filtra già gli input rating per lo standard (flag
    // effettivi, custom soppresso in bottom, separate definiti solo quando
    // attivi) e passa i toggle raw equivalenti nei campi freshRaw* —
    // così freshMetaRows applica gli stessi gate condivisi
    // (resolveSeparateDisplayState) sui valori RAW, non su quelli effettivi
    // (già soppressi: con la colonna attiva l'effettivo sarebbe sempre OFF
    // e fresh non mostrerebbe mai i separati). I chiamanti diretti del
    // service senza campi freshRaw* usano `badgeRating` così com'è (mai
    // riacceso dall'esistenza degli array) e l'array definito come toggle
    // separato — `badgeRating: false` + array popolati = nessuna riga
    // separata, come nello standard.
    const freshRawBadgeRating = input.freshRawBadgeRating ?? input.badgeRating
    const freshRawSeparateEnabled = input.freshRawSeparateRatings ?? (input.separateRatings !== undefined)
    const freshOverlayInput: ComposeFreshInput = {
      posterBuf: freshBaseBuf,
      CW,
      CH,
      rank: freshRank,
      meta: {
        badgesEnabled,
        badgeGenre: input.freshRawBadgeGenre ?? badgeGenre,
        badgeYear: input.freshRawBadgeYear ?? badgeYear,
        badgeRating: freshRawBadgeRating,
        separateRatingsEnabled: freshRawSeparateEnabled,
        separateRatingsStyle: isBottomStyle && bottomVariant ? bottomVariant : "column",
        customRatingsEnabled: input.ratings !== undefined,
        genreName,
        year,
        voteAverage,
        separateRatings: input.separateRatings,
        customRatings: input.ratings,
        typeIcon: typeIcon ? mediaType : null,
      },
      logo: logoResult ? { png: logoResult.input, w: logoResult.w, h: logoResult.h } : null,
      provider: networkLogoForLayout ? { png: networkLogoForLayout.png, w: networkLogoForLayout.w, h: networkLogoForLayout.h } : null,
      badgeFont,
      // Existing per-shape Transform controls, no new params: the rank
      // numeral follows the classifica tuning, the meta column the genre
      // tuning, the provider its offsets (+ the follow/fixed contract), the
      // title logo its offsets once. Provider/logo SCALES ride the bitmaps
      // above (`netscale` in networkLogoForLayout, `logoScale` in
      // logoResult) and are never re-applied as a second resize inside
      // fresh-layout: the same % only enlarges the slot caps there, so one
      // fit grows the mark linearly until the canvas edge (neutral 100 =
      // historic caps, byte-identical; null logoScale counts as 100).
      onGeometry: (geo) => { freshOverlayGeo = geo },
      transforms: {
        numeralScale: topBadgeScale,
        numeralOffsetX: topBadgeOffsetX,
        numeralOffsetY: topBadgeOffsetY,
        metaScale: genreBadgeScale,
        metaOffsetX: genreBadgeOffsetX,
        metaOffsetY: genreBadgeOffsetY,
        providerScale: networkLogoScale,
        providerOffsetX: networkLogoOffsetX,
        providerOffsetY: networkLogoOffsetY,
        providerFollowTitle: networkLogoFollowTitle ?? true,
        providerFixedX: networkFixedX ?? null,
        providerFixedY: networkFixedY ?? null,
        logoScale: logoScale ?? null,
        logoOffsetX: logoOffsetX ?? null,
        logoOffsetY: logoOffsetY ?? null,
      },
    }
    // Split-shade interleaving (Fresh + active bottom blur only): the raw
    // bottom blur/tint overlay paints ABOVE the lateral shade and BELOW the
    // bottom legibility shade + content, so the accent tint stays visible
    // bottom-left instead of being blacked out by the side shade. Without an
    // active bottom blur the legacy combined-shade path runs byte-identically.
    if (blurOverlay) {
      const split = await composeFreshOverlaySplit(freshOverlayInput)
      freshBottomShadeLayer = split.aboveBottom[0] ?? null
      composites.splice(freshInsertAt ?? composites.length, 0, ...split.belowBottom, ...split.aboveBottom)
    } else {
      const freshLayers = await composeFreshOverlay(freshOverlayInput)
      composites.splice(freshInsertAt ?? composites.length, 0, ...freshLayers)
    }
    if (freshOverlayInput.meta.typeIcon && freshMetaRows(freshOverlayInput.meta).length > 0) typeIconInlineAux = true
    // Badge extra non-rank: bitmap standard riusato al top (stesso anchor).
    if (isExtraTopBadge && finalRankBadge && finalRankLeft !== null) {
      const extraCanvas = badgeCanvasForBody(finalRankLeft, finalRankTop, finalRankBadge)
      composites.push({ input: finalRankBadge.png, top: extraCanvas.top, left: extraCanvas.left })
    }
  }

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
  if (isCard) {
    // Stessa priorità dello standard: il rank arriva dal topBadge già
    // risolto (queryExtra > computato > Coming Soon). Mai inventato: solo un
    // rank reale 1..20 disegna il numerale (il compositor ri-applica
    // `isCardRankDisplayable`: 21+ e assenti rendono la stessa composizione
    // senza numerale). Nessun parsing del testo badge, nessun fetch.
    const cardRank = topBadge?.type === "rank" ? topBadge.rank : null
    // Metadata source selection mirrors Fresh (`freshMetaRows` gates via the
    // shared `resolveSeparateDisplayState`) on the SAME resolved values the
    // route selected — no new sources, no invented values, order preserved:
    // a rendered custom provider row keeps its historic priority over the
    // separate column (never both), bottom styles suppress the custom row
    // (values still render once via the separate rows), and with neither
    // active the ordinary TMDB average (`voteAverage`, the existing standard
    // pattern) still renders when its toggle is on. The compositor collapses
    // the selected stack to ONE aggregate score (`aggregateCardRating`:
    // equal mean normalized to /10, custom `format` carried for the
    // percent-scale evidence — never dropped, public contracts unchanged).
    // Direct service callers
    // without `freshRaw*` behave like Fresh's backward-compat (`badgeRating`
    // as-is, a defined array counts as enabled — an explicit
    // `badgeRating: false` with populated arrays still renders nothing).
    const cardRawBadgeRating = input.freshRawBadgeRating ?? input.badgeRating
    const cardRawSeparateEnabled = input.freshRawSeparateRatings ?? (input.separateRatings !== undefined)
    const cardDisplay = resolveSeparateDisplayState({
      badgesEnabled,
      badgeGenre,
      badgeYear,
      badgeRating: cardRawBadgeRating,
      separateRatings: cardRawSeparateEnabled,
      separateRatingsStyle: isBottomStyle && bottomVariant ? bottomVariant : "column",
      sepItemCount: (input.separateRatings ?? []).length,
    })
    const cardCustomItems = (input.ratings ?? [])
      .filter((c) => !!c && typeof c.id === "string" && Number.isFinite(c.value))
      .slice(0, MAX_CUSTOM_RATINGS)
    const cardShowCustom = input.ratings !== undefined && !cardDisplay.suppressCustomRow && cardCustomItems.length > 0
    const cardSeparates = (input.separateRatings ?? []).slice(0, MAX_SEPARATE_RATINGS)
    const cardShowSeparate = !cardShowCustom && cardSeparates.length > 0 && (cardDisplay.useSeparate || cardDisplay.bottomActive)
    const cardRatings = !badgesEnabled
      ? null
      : cardShowCustom
        ? cardCustomItems.map((c) => ({ id: c.id, value: c.value, format: c.format }))
        : cardShowSeparate
          ? cardSeparates.map((s) => ({ id: s.id, value: s.value }))
          : cardDisplay.effectiveBadgeRating && voteAverage !== null && voteAverage > 0
            ? [{ id: "tmdb", value: voteAverage }]
            : null
    // P15 raw (pre-suppression) genre/year toggles for the combined main
    // badge. The route passes EFFECTIVE (bottom-suppressed) badgeGenre/
    // badgeYear; the user-explicit combined badge + separates needs the raw
    // values (same pattern as cardRawBadgeRating above). Evidence for the
    // deviation from the standard bottom suppression (route.ts
    // resolveSeparateDisplayState: bottomActive hides genre/year/rating):
    // the Card main badge lives in the below-card band while the bottom row
    // sits at the canvas edge — they never collide like the standard bottom
    // strip — and Card already rendered its metadata band in bottom mode, so
    // the combined badge loses nothing. Absent fields = direct-caller
    // backward compat (the passed values as-is).
    const cardRawGenre = input.freshRawBadgeGenre ?? badgeGenre
    const cardRawYear = input.freshRawBadgeYear ?? badgeYear
    // P15 main standard badge: the ONE aggregate score (P8, computed once
    // above from the selected stack) through the EXISTING standard renderer —
    // never the ordinary vote when a custom/selected source feeds the
    // aggregate, no extra fetch, all source gates preserved above. No genre
    // preset branch: Card never consumed presets (the standard genre slot is
    // gated `!isCard`), so the standard style applies (no regression, never
    // a 500 on preset state).
    const cardAggregate = aggregateCardRating(cardRatings)
    const cardMainAvailable = badgesEnabled && (
      (cardRawGenre && !!genreName) ||
      (cardRawYear && !!year) ||
      (cardRawBadgeRating && cardAggregate !== null)
    )
    let cardMainBadge: { png: Buffer; w: number; h: number } | null = null
    if (cardMainAvailable) {
      const rendered = await renderCardMainBadge({
        genreName,
        year,
        aggregate: cardAggregate,
        showGenre: cardRawGenre,
        showYear: cardRawYear,
        showRating: cardRawBadgeRating,
        typeIcon: typeIcon ? mediaType : null,
        badgePw,
        CW,
        // Card: la banda non è un bordo poster, la pillola a notch resterebbe
        // sospesa a metà → si rende come pill classica.
        badgeStyle: notchMaterialOf(badgeStyle) ? "pill" : badgeStyle,
        accentColor: accentColorGenre,
        bottomLight,
        badgeFont,
        nativeScale: badgeStyle === "bar" ? genreBadgeScale : 100,
      })
      // Non-bar styles scale via bitmap like the standard path (bar scales
      // natively via font above to stay full-width).
      cardMainBadge = rendered && genreBadgeScale !== 100 && badgeStyle !== "bar"
        ? await scaleBitmapForLayout(rendered, genreBadgeScale)
        : rendered
      cardMainBadgeRendered = cardMainBadge !== null
      if (cardMainBadge) typeIconInlineAux = true
    }
    // P15 individuals via the EXISTING renderers only (never Card text rows,
    // never silently dropped while the toggle is on):
    // - custom stack in column mode: the existing custom row, stacked above
    //   the main badge (same 10px gap as the standard row-over-genre); it
    //   keeps historic priority over the separate column (never both), and
    //   bottom styles suppress it via suppressCustomRow like Standard.
    let cardCustomRow: { png: Buffer; w: number; h: number } | null = null
    if (cardShowCustom && input.ratings && !isBottomStyle) {
      cardCustomRow = await renderMultiRatings(input.ratings, CW - 40, genreBadgeLight, badgeFont).catch(() => null)
    }
    // - bottom styles: the existing bottom row, stacked below the main badge
    //   (same builder args/geometry inputs as Standard, so the cache entries
    //   are shared — no second render of the same bitmap).
    let cardBottomRow: { png: Buffer; w: number; h: number } | null = null
    if (cardShowSeparate && cardDisplay.bottomActive && bottomVariant) {
      const bottomItems = cardSeparates
      // Il gradino (`notch-*`) degrada a `bottom-pills` sul Card: la banda card
      // non è il bordo del poster, la sagoma a filo resterebbe sospesa al centro.
      const cardBottomVariant: SeparateBottomVariant = notchMaterialOf(bottomVariant) ? "bottom-pills" : bottomVariant
      const isBar = cardBottomVariant === "bottom-bar"
      const availW = isBar && !isLandscape ? CW : (isLandscape ? CW - 80 : CW - 36)
      const cardBottomKey = badgeCacheKey("separate-bottom", cardBottomVariant, bottomItems.map((i) => `${i.id}${i.value}`).join(","), CW, badgeFont, separateBadgeScaleEff, availW, effSepBottomLight ? "bl1" : "bl0")
      const cachedBottom = cacheGet<{ png: Buffer; w: number; h: number }>(cardBottomKey)
      cardBottomRow = cachedBottom ?? await coalesceBadgeRender(cardBottomKey, () =>
        renderSeparateRatingsBottom(bottomItems, badgePw, cardBottomVariant, badgeFont, separateBadgeScaleEff, availW, effSepBottomLight)
          .then((r) => { if (r) cacheSet(cardBottomKey, r, ["badge"], BADGE_CACHE_TTL); return r }),
      )
    }
    // Single overlay bitmap for the below-card band (main first, then the
    // one active row): the compositor contain-fits it centered in the band,
    // so the main badge can never be overwritten or clipped. Custom and
    // bottom rows are mutually exclusive by the gates above (never two
    // rating stacks).
    let cardMetadataOverlay: { png: Buffer; w: number; h: number } | null = null
    if (cardCustomRow && cardMainBadge) {
      cardMetadataOverlay = await stackCardOverlayParts(cardCustomRow, cardMainBadge, 10)
    } else {
      cardMetadataOverlay = cardCustomRow ?? cardMainBadge
    }
    if (cardBottomRow) {
      cardMetadataOverlay = cardMetadataOverlay
        ? await stackCardOverlayParts(cardMetadataOverlay, cardBottomRow, 8)
        : cardBottomRow
    }
    // P15 column individuals as side chrome under the quality anchor (same
    // geometry inputs as Standard: same builder args, so the cache entries
    // are shared). Shrink-only caps keep every kept layer intact: above the
    // below-card metadata band (never over the main badge) and clear of the
    // fixed title slot (never over the title); quality/provider/rank never
    // move. Toggle off (or custom priority) = no individuals.
    if (cardShowSeparate && cardDisplay.useSeparate && !cardDisplay.bottomActive) {
      const columnItems = cardSeparates
      const netPadX = Math.round(18 * CW / 380)
      const netBaseTop = Math.round(18 * CH / 570)
      const rightCorner = qualityStackAnchor
        ? qualityStackAnchor.leftCorner
        : ((isRibbonRankingStyle(rankingBadgeStyle) && ribbonSide === "right" && topBadge?.type === "rank" && !!finalRankBadge)
          || (showComingSoon && effComingSoonSide === "right" && !!ribbonLayout)
          || (topRightAnchored && !!finalRankBadge)
          || isTopBadgeNumberRightCorner({ topBadgeType: topBadge?.type, rankingBadgeStyle, extraBadgeStyle, ribbonSide, hasTopBadge: !!finalRankBadge }))
      const stackTop = (qualityStackAnchor ? qualityStackAnchor.top + 6 : netBaseTop - 10)
        + (isLandscape ? 0 : PORTRAIT_SEPARATE_SHIFT_Y)
      const stackKey = badgeCacheKey("separate", columnItems.map((i) => `${i.id}${i.value}`).join(","), CW, badgeFont, effSepTopLight, separateBadgeScaleEff, sepColumnVariant === "rings" ? "rings" : undefined)
      const cachedStack = cacheGet<{ png: Buffer; w: number; h: number }>(stackKey)
      const stack = cachedStack ?? await coalesceBadgeRender(stackKey, () =>
        renderSeparateRatingStack(columnItems, badgePw, effSepTopLight, badgeFont, separateBadgeScaleEff, undefined, sepColumnVariant)
          .then((r) => { if (r) cacheSet(stackKey, r, ["badge"], BADGE_CACHE_TTL); return r })
      )
      let stackFitted = stack ? await fitBadgeToCanvas(stack, CW, CH) : null
      // Cap above the below-card metadata band (the Standard cap uses the
      // genre rect; Card has no genre rect — the band top is the equivalent
      // edge): shrink-only on real overflow, never enlarge.
      const cardGeo = cardLayoutGeometry(isLandscape ? "landscape" : "poster", CW, CH, cardRank)
      const cardBand = cardGeo ? cardMetadataBand(CW, CH, cardGeo) : null
      const bandTop = cardBand ? cardBand.y0 : CH - Math.round(20 * CH / 570)
      if (stackFitted) {
        const intendedTop = Math.max(0, Math.min(Math.max(0, CH - 1), stackTop + sepOY))
        const maxStackH = bandTop - intendedTop - 6
        if (stackFitted.h > maxStackH && maxStackH > 0) {
          stackFitted = await scaleBitmapForLayout(stackFitted, (maxStackH / stackFitted.h) * 100)
        }
      }
      // Clear of the fixed title slot (conservative slot box, same
      // shrink-only idiom as the Standard logo-overlap loops, floor 0.7):
      // the column shares the card's right side with the bottom-centered
      // title mark. No title (hideLogo/absent) = no guard.
      if (stackFitted && cardGeo && logoFetch && !hideLogo) {
        const slot = cardGeo.titleLogo
        const leftFor = (w: number) => qualityStackAnchor
          ? Math.round(qualityStackAnchor.centerX - w / 2)
          : (rightCorner ? netPadX : Math.round(CW - netPadX + 10 - w))
        const topFor = (h: number) => Math.max(0, Math.min(CH - h, stackTop + sepOY))
        const overlapsTitle = (w: number, h: number) => {
          const l = Math.max(0, Math.min(CW - w, leftFor(w) + sepOX))
          const t = topFor(h)
          return l < slot.x + slot.maxWidth && l + w > slot.x && t < slot.y + slot.maxHeight && t + h > slot.y
        }
        if (overlapsTitle(stackFitted.w, stackFitted.h)) {
          let scale = 1
          const minScale = 0.7
          let curW = stackFitted.w
          let curH = stackFitted.h
          while (scale > minScale && overlapsTitle(curW, curH)) {
            scale -= 0.1
            if (scale < minScale) scale = minScale
            const newW = Math.max(1, Math.round(stackFitted.w * scale))
            const newH = Math.max(1, Math.round(stackFitted.h * scale))
            if (newW === curW && newH === curH) break
            curW = newW
            curH = newH
            if (scale <= minScale) break
          }
          if (curW !== stackFitted.w || curH !== stackFitted.h) {
            displaced.add("separate")
            const png = await sharp(stackFitted.png).resize(curW, curH).toBuffer()
            stackFitted = { ...stackFitted, png, w: curW, h: curH }
          }
        }
      }
      if (stackFitted) {
        const leftPos = qualityStackAnchor
          ? Math.round(qualityStackAnchor.centerX - stackFitted.w / 2)
          : (rightCorner ? netPadX : Math.round(CW - netPadX + 10 - stackFitted.w))
        const sepLeft = Math.max(0, Math.min(CW - stackFitted.w, leftPos + sepOX))
        const sepTop = Math.max(0, Math.min(CH - stackFitted.h, stackTop + sepOY))
        composites.push({ input: stackFitted.png, top: sepTop, left: sepLeft })
        badgeGeo.separate = { top: sepTop, left: sepLeft, w: stackFitted.w, h: stackFitted.h }
      }
    }
    // Automatic provider-glass brand tint from the already-resolved brand
    // IDENTITY (`networkLogoResult`/`rawLogoResult` canonical `networkKey`,
    // same priority as the drawn logo — no new matcher, no pixel sampling,
    // no extra fetch): a valid manual `ac=`/mapping accent wins (existing
    // public contract); otherwise the fixed 8-provider palette applies
    // (`provider-brand-palette.ts`); unlisted/missing providers render the
    // documented neutral — never the scene tint, which describes the
    // artwork atmosphere, not the provider brand. The key is read from the
    // ORIGINAL match records (not the geometry-fitted bitmap, which only
    // carries pixels). Other Card skins keep the existing pixel-sampling
    // resolver below (`resolveCardBrandAccent`) untouched.
    const cardSkin = input.posterLayout as CardSkin
    const cardBrandAccent =
      cardSkin === "provider-glass"
        ? resolveProviderGlassAccent(
            networkLogoResult?.networkKey ?? rawLogoResult?.networkKey ?? null,
            accentOverride,
          )
        : await resolveCardBrandAccent(networkLogoForLayout, accentOverride)
    // Bottom-blur exception (Card only): the user-controlled bottom blur is
    // an artwork treatment, not chrome. The SAME already-computed raw RGBA
    // overlay (same algorithm/tint/controls, single computation, no extra
    // blur pass — it composites straight onto the artwork bytes) is baked
    // into the full-canvas artwork BEFORE the shared single compositor, so
    // the finished Card (skin, numeral, title logo, provider mark, metadata
    // band, rounded edges) is never covered by it. The intermediate is PNG
    // (lossless): unblurred artwork pixels stay bit-identical instead of
    // collecting a JPEG re-encode generation. Standard and Fresh keep the
    // overlay in the final layers below, pixel-identical.
    // The explicit pre-release full blur in section 7 still applies over the
    // whole Card by contract (Coming Soon state, not a user blur control).
    let cardArtwork = posterBuf
    if (blurOverlay) {
      cardArtwork = await sharp(posterBuf)
        .composite([
          {
            input: blurOverlay.overlay,
            raw: { width: CW, height: blurOverlay.height, channels: 4 },
            top: blurOverlay.top,
            left: 0,
          },
        ])
        .png({ compressionLevel: 1 })
        .toBuffer()
    }
    cardPng = await renderCardPoster({
      // `isCard` implica un cover layout valido (stesso gate): il cast è
      // stretto, il compositor rivalida comunque e rifiuta gli altri.
      skin: input.posterLayout as CardSkin,
      shape: isLandscape ? "landscape" : "poster",
      width: CW,
      height: CH,
      // Base pipeline pre-chrome (già a CW×CH) con la fascia blur già cotta
      // dentro (eccezione Card, vedi sopra): mai il poster finale standard
      // — i badge standard sono overlay e non vi sono cotti dentro.
      artwork: cardArtwork,
      displayedRank: cardRank,
      // P14: il titolo riusa il buffer ORIGINALE già risolto (hideLogo lo
      // azzera a monte, la selezione manuale resta a monte invariata) — MAI
      // il bitmap `logoResult` già ridimensionato per lo Standard (con lo
      // shrink-only erediterebbe la misura piccola e ignorerebbe la scala).
      // La scala utente esistente (`logoScale`, null = 100 neutro come Fresh)
      // viaggia come scalare: il compositor ridimensiona lo slot e fitta UNA
      // sola volta (nessun secondo resize, nessun nuovo parametro/fetch).
      titleLogo: logoFetch && !hideLogo ? logoFetch : null,
      logoScale: logoScale ?? null,
      // P14: il mark riusa il bitmap raw originale (colori originali, PRIMA
      // del `netscale` Standard) + lo slider esistente (`networkLogoScale`,
      // valori salvati preservati): il compositor ingrandisce lo slot della
      // stessa % e fitta UNA sola volta con upscale limitato allo slot.
      // Assente = omesso senza errore (stesso input del provider Fresh).
      providerLogo: rawLogoResult ? rawLogoResult.png : null,
      providerScale: networkLogoScale,
      // Brand tint: manuale esplicito (`ac=`/mapping) quando presente,
      // altrimenti tinta fissa dalla palette 8 provider per identità brand
      // già risolta (`provider-glass`), neutro documentato per provider
      // assenti e non listati (mai cataloghi di match copiati, mai testo
      // raw nel SVG, mai tinta di scena come brand, mai campionamento
      // pixel per `provider-glass`).
      // Existing per-shape Transform offsets: Card slots stay the same, the
      // composed layer moves (neutral 0 = historic fixed geometry).
      numeralScale: topBadgeScale,
      numeralOffsetX: topBadgeOffsetX,
      numeralOffsetY: topBadgeOffsetY,
      titleOffsetX: logoOffsetX,
      titleOffsetY: logoOffsetY,
      providerOffsetX: networkLogoOffsetX,
      providerOffsetY: networkLogoOffsetY,
      metadataOffsetX: genreBadgeOffsetX,
      metadataOffsetY: genreBadgeOffsetY,
      onGeometry: (geo) => { cardOverlayGeo = geo },
      brandAccent: cardBrandAccent,
      // Metadati già risolti con le scelte di resa effettive condivise con
      // Fresh (vedi sopra: custom > separati > media ★, mai valori inventati).
      // P15: il percorso valori testuali custom della card NON è alimentato
      // dal service (mai un secondo renderer genere/stelle/anno); il badge
      // standard già reso (aggregato P15 sopra) + le eventuali righe
      // esistenti viaggiano nel singolo slot overlay condiviso. Gli helper
      // custom restano come fallback del compositore + superficie unit.
      genreName: null,
      year: null,
      ratings: null,
      metadataOverlay: cardMetadataOverlay,
    })
    // Badge extra non-rank: bitmap standard riusato al top (stesso anchor di Fresh).
    if (isExtraTopBadge && finalRankBadge && finalRankLeft !== null) {
      const extraCanvas = badgeCanvasForBody(finalRankLeft, finalRankTop, finalRankBadge)
      composites.push({ input: finalRankBadge.png, top: extraCanvas.top, left: extraCanvas.left })
    }
  }


  // -----------------------------------------------------------------------
  // 6c-bis. Geometria badge per il drag della preview (debug `netgeo=1`).
  // Un solo punto di verità: ogni box è quello DAVVERO composto dal layout
  // attivo (Standard, Fresh o Card), raccolto nel punto di composite o dal
  // collector del compositor. La famiglia top segue il badge dipinto
  // (`extra` = layout fallback senza classifica); `rank` è il badge/il
  // numerale di classifica. `layout` descrive il poster INTERO (con o senza
  // classifica) ed è la chiave del reset per profilo.
  // -----------------------------------------------------------------------
  const topRankDisplayed =
    isExtraTopBadge
      ? false
      : isCard
        ? (topBadge?.type === "rank" && isCardRankDisplayable(topBadge.rank))
        : isFresh
          ? (topBadge?.type === "rank" && isFreshRank(topBadge.rank))
          : !!(finalRankBadge && !isExtraTopBadge)
  const reportLayout: BadgeGeometryLayout = topRankDisplayed ? "ranked" : "fallback"
  if (finalRankBadge && finalRankLeft !== null) {
    const topBody = badgeBody(finalRankBadge)
    if (isExtraTopBadge) {
      // Extra: stesso anchor in Standard, Fresh e Card (push sopra in ogni ramo).
      badgeGeo.extra = { top: finalRankTop, left: finalRankLeft, w: topBody.w, h: topBody.h }
    } else if (!isFresh && !isCard && !isRankNetflixRibbonStyle) {
      // Rank Standard centrato/angolo: gli offset sono applicati qui. Il
      // nastro Netflix ignora X e Y per contratto: nessuna maniglia.
      badgeGeo.rank = { top: finalRankTop, left: finalRankLeft, w: topBody.w, h: topBody.h }
    }
  }
  // Logo titolo (Standard): il bitmap composto com'e', offset applicati una
  // sola volta a monte. Fresh/Card riportano il proprio layer composto sotto.
  if (logoResult && !isFresh && !isCard) {
    badgeGeo.logo = { top: logoResult.top, left: logoResult.left, w: logoResult.w, h: logoResult.h }
  }
  // Fresh: il compositor riporta numerale (famiglia rank), blocco meta
  // (genere), provider (network) e titolo (logo) realmente dipinti. I
  // composite standard genere/logo sono gia' spenti sopra: nessun duplicato.
  // Le righe separate vivono dentro il blocco meta (contratto Fresh), quindi
  // si muovono con esso: nessuna maniglia fantasma.
  if (isFresh && freshOverlayGeo) {
    const geo = freshOverlayGeo as FreshOverlayGeometry
    if (geo.numeral) badgeGeo.rank = geo.numeral
    if (geo.meta) badgeGeo.genre = geo.meta
    if (geo.provider) badgeGeo.network = geo.provider
    if (geo.logo) badgeGeo.logo = geo.logo
  }
  // Card: stesse famiglie dal compositor condiviso; la banda metadata (badge
  // principale + eventuali righe unite) è la famiglia genere, la colonna
  // separati laterale è già riportata dal chrome condiviso sopra.
  if (isCard && cardOverlayGeo) {
    const geo = cardOverlayGeo as CardOverlayGeometry
    if (geo.numeral) badgeGeo.rank = geo.numeral
    if (geo.metadata) badgeGeo.genre = geo.metadata
    if (geo.provider) badgeGeo.network = geo.provider
    if (geo.title) badgeGeo.logo = geo.title
  }
  // Frozen network (follow OFF + complete absolute coords): in Standard and
  // Fresh the renderer uses the absolute box verbatim and never applies the
  // relative offset axes on top of it. Report the family as locked so the drag
  // overlay offers no offset handle at all (a Y handle would otherwise write a
  // `noy` that is reinterpreted as a relative offset later). Card keeps its
  // provider offsets applied, so it is deliberately excluded.
  if (isFixedNetwork && !isCard) badgeGeoFixedX.network = true
  // Cornici dell'editor sull'inchiostro reale: la bitmap del gruppo qualità
  // porta pad d'ombra, tela della colonna comune e (notch) i raccordi vuoti,
  // quindi i box grezzi erano molto più grandi del dipinto. Calcolato solo
  // quando l'editor chiede la geometria; il render non cambia.
  let reportedItems: BadgeGeometryItem[] = badgeGeoItems
  // ---- Blocco "sopra/sotto il logo" (prima del pass). Per lato, i family si
  // impilano dal logo verso l'esterno nell'ordine fisso: fascia (genere, riga
  // rating, pillole bottom), qualita (+ colonna separati), network, rank/extra.
  // Centro orizzontale = centro del logo (clamp nei margini), gap =
  // round(8*CH/570); poi offset X/Y del badge; clamp verticale nel canvas. Le
  // posizioni sono manuali: il pass sotto le registra come ostacoli fissi.
  if (logoResult && (netRel || qualityRel || bottomRel || topRel)) {
    type RelFam = "genre" | "rating" | "separate" | "quality" | "network" | "top"
    type RelBox = { left: number; top: number; w: number; h: number }
    const relGap = relGapPx
    const relMarginX = Math.round(18 * CW / 380)
    const relMarginY = relMarginPx
    // Margine inferiore per famiglia: la fascia genere/rating/pillole usa quello dell'Auto.
    const relBottomMargin = (fam: RelFam): number => (fam === "genre" || fam === "rating" || fam === "separate" ? relBandBottomMargin : relMarginY)
    const relSepLinked = !isBottomStyle && qualityStackAnchor !== null
    // Box VISIBILE, come il report finale: qualità e colonna separati sono
    // ristretti all'inchiostro (stessa formula del report geometria, più sotto).
    const relInkBox = async (src: InkSource, box: RelBox): Promise<RelBox> => {
      const comps = (await opaqueComponents(src.png)).map((c) => ({ ...c, left: c.left + src.left, top: c.top + src.top }))
      return bodyFrame(src) ?? tightenBoxesToInk([box], comps)[0]
    }
    const relBoxOf = async (fam: RelFam): Promise<RelBox | null> => {
      if (fam === "genre") return genreBadgeRect
      if (fam === "rating") return ratingBox
      if (fam === "separate") {
        if (badgeGeo.separate) return separateInkSource ? relInkBox(separateInkSource, badgeGeo.separate) : badgeGeo.separate
        const items = badgeGeoItems.filter((it) => it.family === "separate")
        if (items.length === 0) return null
        const l = Math.min(...items.map((it) => it.left)), t = Math.min(...items.map((it) => it.top))
        const r = Math.max(...items.map((it) => it.left + it.w)), b = Math.max(...items.map((it) => it.top + it.h))
        return { left: l, top: t, w: r - l, h: b - t }
      }
      if (fam === "quality") {
        const q0 = badgeGeo.quality
        if (!q0) return null
        const q = qualityInkSource ? await relInkBox(qualityInkSource, q0) : q0
        const sp0 = relSepLinked ? badgeGeo.separate : undefined
        if (!sp0) return q
        const sp = separateInkSource ? await relInkBox(separateInkSource, sp0) : sp0
        const l = Math.min(q.left, sp.left), t = Math.min(q.top, sp.top)
        const r = Math.max(q.left + q.w, sp.left + sp.w), b = Math.max(q.top + q.h, sp.top + sp.h)
        return { left: l, top: t, w: r - l, h: b - t }
      }
      if (fam === "network") return badgeGeo.network ?? null
      if (!finalRankBadge || finalRankLeft === null || isFresh || isCard) return null
      const body = badgeBody(finalRankBadge)
      return { left: finalRankLeft, top: finalRankTop, w: body.w, h: body.h }
    }
    const relOffsetOf = (fam: RelFam): { x: number; y: number } => {
      if (fam === "genre") return { x: combinedGenreOX ?? 0, y: combinedGenreOY ?? 0 }
      if (fam === "quality") return { x: qualityBadgeOffsetX ?? 0, y: qualityBadgeOffsetY ?? 0 }
      if (fam === "network") return { x: networkLogoOffsetX ?? 0, y: networkLogoOffsetY ?? 0 }
      if (fam === "top") return { x: combinedTopOX ?? 0, y: combinedTopOY ?? 0 }
      return { x: 0, y: 0 }
    }
    // Sposta un family di (dx, dy): composite, box report, item, ink, geometria
    // network e rank. Ogni oggetto è spostato una sola volta per chiamata.
    const relMove = (fam: RelFam, dx: number, dy: number): void => {
      const seen = new Set<object>()
      const mv = (o: object | null | undefined): void => {
        if (!o || seen.has(o)) return
        seen.add(o)
        const m = o as { top: number; left?: number }
        m.top += dy
        if (typeof m.left === "number") m.left += dx
      }
      const inkOf = (ink: InkSource | null): void => { if (ink) { mv(ink); mv(ink.body) } }
      const itemsOf = (f: string): void => { for (const it of badgeGeoItems) if (it.family === f) mv(it) }
      if (fam === "top") {
        mv(topRankLayer)
        if (finalRankLeft !== null) finalRankLeft += dx
        finalRankTop += dy
        mv(badgeGeo[isExtraTopBadge ? "extra" : "rank"])
        return
      }
      for (const l of famLayers[fam]) mv(l)
      if (fam === "genre") { mv(genreBadgeRect); mv(badgeGeo.genre); itemsOf("genre") }
      else if (fam === "rating") { mv(ratingBox); itemsOf("rating") }
      else if (fam === "separate") { mv(badgeGeo.separate); inkOf(separateInkSource); itemsOf("separate") }
      else if (fam === "quality") {
        mv(badgeGeo.quality); inkOf(qualityInkSource)
        for (const v of qualityDetachedInk.values()) mv(v)
        itemsOf("quality")
        if (relSepLinked) relMove("separate", dx, dy)
      } else {
        mv(netGeo); mv(badgeGeo.network); itemsOf("network")
      }
    }
    const relFamSide: Array<{ fam: RelFam; side: LogoRelativePosition }> = []
    if (bottomRel) {
      relFamSide.push({ fam: "genre", side: bottomRel }, { fam: "rating", side: bottomRel })
      if (isBottomStyle) relFamSide.push({ fam: "separate", side: bottomRel })
    }
    if (qualityRel) relFamSide.push({ fam: "quality", side: qualityRel })
    if (netRel) relFamSide.push({ fam: "network", side: netRel })
    if (topRel) relFamSide.push({ fam: "top", side: topRel })
    const relOrder: RelFam[] = ["genre", "rating", "separate", "quality", "network", "top"]
    const relCx = logoResult.left + logoResult.w / 2
    let relNetMoved = false
    // Un cursore per lato: si impila dal logo verso l'esterno. Se il badge non
    // sta dal lato chiesto (finirebbe sopra il logo per il clamp) passa
    // all'altro lato; se non sta in nessuno dei due resta sul lato chiesto.
    const relCursor = { above: relLogoTop - relGap, below: relLogoBottom + relGap }
    const relFits = (s: LogoRelativePosition, h: number, fam: RelFam) =>
      s === "above" ? relCursor.above - h >= relMarginY : relCursor.below + h <= CH - relBottomMargin(fam)
    for (const entry of relOrder.flatMap((fam) => relFamSide.filter((x) => x.fam === fam))) {
      const fam = entry.fam
      const box = await relBoxOf(fam)
      if (!box) continue
      const other: LogoRelativePosition = entry.side === "above" ? "below" : "above"
      const side = !relFits(entry.side, box.h, fam) && relFits(other, box.h, fam) ? other : entry.side
      // Stacking con dimensioni NON offsettate; clamp verticale nel canvas.
      let tTop = side === "above" ? relCursor.above - box.h : relCursor.below
      if (tTop < relMarginY) tTop = relMarginY
      if (tTop + box.h > CH - relBottomMargin(fam)) tTop = Math.max(0, CH - relBottomMargin(fam) - box.h)
      if (side === "above") relCursor.above = tTop - relGap
      else relCursor.below = tTop + box.h + relGap
      const tLeft = Math.max(relMarginX, Math.min(CW - box.w - relMarginX, Math.round(relCx - box.w / 2)))
      const off = relOffsetOf(fam)
      const fTop = Math.max(0, Math.min(CH - box.h, tTop + off.y))
      const fLeft = tLeft + off.x
      const dx = fLeft - box.left
      const dy = fTop - box.top
      if (dx === 0 && dy === 0) continue
      relMove(fam, dx, dy)
      if (fam === "network") relNetMoved = true
    }
    if (relNetMoved && netGeo) onNetworkGeometry?.(netGeo)
  }

  // ---- Pass "auto evita manuali" (prima del report geometria: report e pixel
  // restano allineati). Ostacoli MANUALI sono fissi (rank/extra, logo, network,
  // qualità, genere/rating/pills in fascia manuale). Un badge AUTO che tocca un
  // ostacolo (rectsOverlap, margine 6) scende sotto di lui se sta nella metà alta
  // del canvas, sale sopra se nella metà bassa. Max 2 passate. La colonna
  // rating separati sotto una qualità AUTO è un'unica entry con la qualità: si
  // sposta con lei (stesso dy). Nessun ostacolo manuale = nessuna azione.
  {
    type AvoidFam = "network" | "quality" | "genre" | "separate" | "rating"
    type Rect = { left: number; top: number; w: number; h: number }
    const manualObs: Rect[] = []
    if ((topFixedActive || topAnchorActive || topRel !== null) && finalRankBadge && finalRankLeft !== null) {
      manualObs.push({ left: finalRankLeft, top: finalRankTop, w: badgeBody(finalRankBadge).w, h: badgeBody(finalRankBadge).h })
    }
    if (isActiveLogoAnchor(logoAnchorEff) && logoResult) {
      manualObs.push({ left: logoResult.left, top: logoResult.top, w: logoResult.w, h: logoResult.h })
    }
    // Box di una famiglia: report (badgeGeo) o, per le pills bottom senza report
    // dedicato, unione degli item della famiglia "separate".
    const famBox = (fam: AvoidFam): Rect | null => {
      if (fam === "rating") return ratingBox
      if (fam === "separate" && !badgeGeo.separate) {
        const items = badgeGeoItems.filter((it) => it.family === "separate")
        if (items.length === 0) return null
        const l = Math.min(...items.map((it) => it.left)), t = Math.min(...items.map((it) => it.top))
        const r = Math.max(...items.map((it) => it.left + it.w)), b = Math.max(...items.map((it) => it.top + it.h))
        return { left: l, top: t, w: r - l, h: b - t }
      }
      return badgeGeo[fam] ?? null
    }
    if (networkManual && badgeGeo.network) manualObs.push(badgeGeo.network)
    if (qualityManual && badgeGeo.quality) manualObs.push(badgeGeo.quality)
    if (bottomManual && badgeGeo.genre) manualObs.push(badgeGeo.genre)
    if (bottomManual && ratingBox) manualObs.push(ratingBox)
    if (bottomManual && isBottomStyle && famBox("separate")) manualObs.push(famBox("separate")!)
    if (manualObs.length > 0) {
      // Colonna separati collegata alla qualità AUTO (sotto di lei): una sola entry.
      // La colonna separati è sempre agganciata alla qualità (stessa stack): mai spostata da sola.
      const sepLinked = !isBottomStyle && qualityStackAnchor !== null
      const autoFams: AvoidFam[] = (["network", "quality", "genre", "rating", "separate"] as AvoidFam[]).filter((fam) => {
        if (!famBox(fam) && famLayers[fam].length === 0) return false
        if (fam === "network") return !networkManual
        if (fam === "quality") return !qualityManual
        if (fam === "separate") return !sepLinked && !(isBottomStyle && bottomManual)
        return !bottomManual
      })
      // Sposta una famiglia: layer composti, box report, item, ink e geometria network.
      // La colonna separati collegata segue la qualità (stesso dy).
      const shiftFam = (fam: AvoidFam, dy: number) => {
        // Le strutture di geometria sono readonly per tipo: il solo spostamento verticale le muta qui.
        displaced.add(fam)
        const nudge = (o: { top: number }) => { (o as { top: number }).top += dy }
        for (const l of famLayers[fam]) nudge(l)
        const g = fam === "rating" ? ratingBox : badgeGeo[fam]
        if (g) nudge(g)
        if (fam === "genre" && genreBadgeRect) nudge(genreBadgeRect)
        if (fam === "network" && netGeo) nudge(netGeo)
        for (const it of badgeGeoItems) if (it.family === fam) nudge(it)
        const ink = fam === "quality" ? qualityInkSource : fam === "separate" ? separateInkSource : null
        if (ink) {
          nudge(ink)
          if (ink.body) nudge(ink.body)
        }
        if (fam === "quality") for (const v of qualityDetachedInk.values()) nudge(v)
        if (fam === "quality" && sepLinked) shiftFam("separate", dy)
      }
      const avoidGap = 6
      let networkMoved = false
      for (let iter = 0; iter < 2; iter++) {
        let moved = false
        for (const fam of autoFams) {
          const members: Array<{ box: Rect | null }> = [{ box: famBox(fam) }]
          if (fam === "quality" && sepLinked) members.push({ box: famBox("separate") })
          let dy = 0
          for (const { box } of members) {
            if (!box) continue
            const hit = manualObs.find((o) => rectsOverlap(box, o, 6))
            if (!hit) continue
            dy = box.top + box.h / 2 < CH / 2
              ? hit.top + hit.h + avoidGap - box.top
              : hit.top - avoidGap - (box.top + box.h)
            break
          }
          if (dy === 0) continue
          shiftFam(fam, dy)
          if (fam === "network") networkMoved = true
          moved = true
        }
        if (!moved) break
      }
      if (networkMoved && netGeo) onNetworkGeometry?.(netGeo)
    }
  }
  // Overflow "hide": le famiglie AUTO in collisione non si disegnano. Layer tolti
  // dai composite e dal report (badge, item, network) prima del report geometria,
  // così drag e pixel restano coerenti. Manuali, rank ed extra non entrano mai qui.
  if (input.badgeOverflow === "hide" && displaced.size > 0) {
    const gone = new Set<object>()
    for (const fam of displaced) for (const l of famLayers[fam]) gone.add(l)
    for (let i = composites.length - 1; i >= 0; i--) if (gone.has(composites[i])) composites.splice(i, 1)
    if (displaced.has("network")) { delete badgeGeo.network; netGeo = null; onNetworkGeometry?.(null) }
    if (displaced.has("quality")) { delete badgeGeo.quality; qualityInkSource = null; qualityDetachedInk.clear() }
    if (displaced.has("separate")) { delete badgeGeo.separate; separateInkSource = null }
    if (displaced.has("genre")) { delete badgeGeo.genre; genreBadgeRect = null }
    if (displaced.has("rating")) ratingBox = null
    for (let i = badgeGeoItems.length - 1; i >= 0; i--) {
      if ((displaced as Set<string>).has(badgeGeoItems[i].family)) badgeGeoItems.splice(i, 1)
    }
  }
  if (onBadgeGeometry && qualityInkSource && badgeGeo.quality) {
    const src = qualityInkSource
    const comps = (await opaqueComponents(src.png)).map((c) => ({ ...c, left: c.left + src.left, top: c.top + src.top }))
    badgeGeo.quality = bodyFrame(src) ?? tightenBoxesToInk([badgeGeo.quality], comps)[0]
    const painted = badgeGeoItems.filter((it) => it.family === "quality" && !it.ghost && !qualityDetachedInk.has(it.id))
    const tight = tightenBoxesToInk(painted, comps)
    const detachedTight = new Map<string, BadgeGeometryItem>()
    for (const it of badgeGeoItems) {
      const own = it.family === "quality" ? qualityDetachedInk.get(it.id) : undefined
      if (!own) continue
      const ownComps = (await opaqueComponents(own.png)).map((c) => ({ ...c, left: c.left + own.left, top: c.top + own.top }))
      detachedTight.set(it.id, tightenBoxesToInk([it], ownComps)[0])
    }
    // Il box resta lo slot (contratto delle correzioni per-item e delle home);
    // l'area dipinta viaggia a parte in `ink`, solo per la cornice dell'editor.
    reportedItems = badgeGeoItems.map((it) => {
      const t = tight[painted.indexOf(it)] ?? detachedTight.get(it.id)
      return t && (t.w !== it.w || t.h !== it.h || t.left !== it.left || t.top !== it.top)
        ? { ...it, ink: { top: t.top, left: t.left, w: t.w, h: t.h } }
        : it
    })
  }
  if (onBadgeGeometry && separateInkSource && badgeGeo.separate) {
    const src = separateInkSource
    const comps = (await opaqueComponents(src.png)).map((c) => ({ ...c, left: c.left + src.left, top: c.top + src.top }))
    badgeGeo.separate = bodyFrame(src) ?? tightenBoxesToInk([badgeGeo.separate], comps)[0]
  }
  onBadgeGeometry?.({
    canvasW: CW,
    canvasH: CH,
    layout: reportLayout,
    kind: isExtraTopBadge
      ? (finalRankBadge ? "extra" : null)
      : topRankDisplayed
        ? "rank"
        : null,
    families: badgeGeo,
    fixedX: badgeGeoFixedX,
    items: reportedItems,
  })

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
  if (onAccentMeta) {
    try {
      const topComposited =
        !!finalRankBadge &&
        finalRankLeft !== null &&
        (!!topBadge && !showComingSoon && topPaintsAccent) &&
        ((!isFresh && !isCard) || isExtraTopBadge)
      const genreStdPaints =
        genrePaintsAccent && !!safeGenreBadgeResult
      const genrePaintsEff =
        genreStdPaints || (cardGenrePaints && cardMainBadgeRendered)
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
        band: { r: number; g: number; b: number } | null,
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
      const gradientPaintsEff =
        !!blurOverlay && tintStrength > 0 && isValidHex(blurTintHex)
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

  // -----------------------------------------------------------------------
  // 7. Final composite
  // -----------------------------------------------------------------------
  // Icona tipo film/serie, fallback senza badge genere standard: solo glifo in
  // basso a sinistra, sopra il resto del chrome (fail-open: poster storico).
  if (typeIcon && !typeIconInlineAux && !(genreTypeIcon && safeGenreBadgeResult)) {
    const icon = await renderTypeIcon(mediaType, Math.round(badgePw * 0.04))
    if (icon) {
      const margin = Math.round(badgePw * (isLandscape ? 0.03 : 0.015))
      composites.push({ input: icon.png, top: CH - icon.h - margin, left: margin })
    }
  }

  const safeComposites = (await Promise.all(composites.map((layer) => fitCompositeToCanvas(layer, CW, CH))))
    .filter((layer): layer is PosterComposite => layer !== null)

  // Cornice stagionale (qualunque tema canonico valido, su ENTRAMBI i canvas
  // col proprio asset 500×750 / 768×432 — mai stirata — in TUTTI i layout:
  // standard, Fresh e Card, senza esclusioni): la cornice sta SOPRA lo
  // sfondo/il trattamento immagine (backdrop, vignetta, velo
  // pre-release, ombra superiore, blur) ma SOTTO TUTTO il chrome — logo,
  // rank/extra, Coming Soon, network, qualità, genere, separati, età e gli
  // overlay composti Fresh/Card (richiesta utente esplicita aggiornata: la
  // cornice va al di sotto di tutti i badge e loghi). L'ancora
  // `seasonalFrameAfter` (ultimo trattamento pre-chrome) fissa la posizione:
  // gli splice Fresh e il chrome conservato Card atterrano dopo di essa,
  // quindi la cornice resta sotto di loro in ogni layout. Fail-open: asset
  // illeggibile = poster storico, mai 500.
  let seasonalFrameLayer: PosterComposite | null = null
  if (seasonalTheme !== null) {
    try {
      const frame = await loadSeasonalFrame(CW, CH, seasonalTheme, isLandscape ? "landscape" : "poster")
      const fitted = await fitCompositeToCanvas({ input: frame, top: 0, left: 0 }, CW, CH)
      if (fitted) {
        const anchorIdx = seasonalFrameAfter ? safeComposites.indexOf(seasonalFrameAfter) : -1
        // Ancora trovata: subito dopo il trattamento. Ancora assente o
        // scartata (mai attesa: i trattamenti sono full-canvas validi): in
        // testa, comunque sotto tutto il chrome.
        if (anchorIdx >= 0) safeComposites.splice(anchorIdx + 1, 0, fitted)
        else safeComposites.splice(0, 0, fitted)
        seasonalFrameLayer = fitted
      }
    } catch {
      // asset mancante/illeggibile — il poster resta quello storico
    }
  }

  // Il blur è un overlay RGBA grezzo (nessun PNG intermedio): entra come primo
  // layer, sotto backdrop/vignetta/badge — stesso ordine del vecchio blur "cotto"
  // nella base. La base non subisce ritocchi colore: niente modulate,
  // l'artwork TMDB passa invariato nel composite finale (task16: la base è il
  // background ricostruito solo in Fresh-ranked, originale altrove; P5: con
  // Card effettiva la base è il poster completo della card e il chrome
  // conservato vi si compone sopra come per Fresh). ECCEZIONE Card: la fascia
  // blur è già cotta nell'artwork a monte (blocco 6c) e qui resta FUORI dai
  // layer — coprirebbe la card finita (metadata, titolo, provider, bordi).
  // Il blur esplicito pre-release sotto resta invece full-canvas per contratto.
  const cardBlurBaked = isCard && cardPng !== null && blurOverlay !== null
  // Root cause of the Fresh bottom-left blackout: the raw bottom blur/tint
  // overlay used to composite FIRST (below everything), so the Fresh lateral
  // black shade painted OVER the accent tint wherever they overlap
  // (bottom-left), hiding it. The tinted bottom band now interleaves between
  // the lateral shade (below) and the bottom legibility shade + content
  // (above): accent visible bottom-left AND bottom-right, upper-left lateral
  // shade untouched (the bottom overlay has no coverage there), and no color
  // intensities changed anywhere. Standard/Card never take this branch
  // (freshBottomShadeLayer stays null there).
  const blurRawLayer = blurOverlay && !cardBlurBaked
    ? { input: blurOverlay.overlay, raw: { width: CW, height: blurOverlay.height, channels: 4 }, top: blurOverlay.top, left: 0 }
    : null
  const freshBlurAt = blurRawLayer && freshBottomShadeLayer ? safeComposites.indexOf(freshBottomShadeLayer) : -1
  const layers: Array<PosterComposite | { input: Buffer; raw: { width: number; height: number; channels: 4 }; top: number; left: number }> = !blurRawLayer
    ? safeComposites
    : freshBlurAt >= 0
      ? [...safeComposites.slice(0, freshBlurAt), blurRawLayer, ...safeComposites.slice(freshBlurAt)]
      : [blurRawLayer, ...safeComposites]

  // La cornice resta sopra il trattamento immagine ritardato: con Fresh +
  // blur attivo il blur grezzo si intercala prima della shade di leggibilità
  // (dopo l'ancora), quindi finirebbe sopra la cornice — la si risolleva
  // subito sopra il blur, restando sotto shade/contenuti Fresh e sotto tutto
  // il chrome. Con blur in testa (standard) o senza blur è già sopra: nessun
  // movimento, zero pixel cambiati.
  if (seasonalFrameLayer && blurRawLayer) {
    const frameIdx = layers.indexOf(seasonalFrameLayer)
    const blurIdx = layers.indexOf(blurRawLayer)
    if (frameIdx >= 0 && blurIdx >= 0 && frameIdx < blurIdx) {
      layers.splice(frameIdx, 1)
      layers.splice(layers.indexOf(blurRawLayer) + 1, 0, seasonalFrameLayer)
    }
  }

  let pipeline = sharp(isCard && cardPng ? cardPng : freshBaseBuf)

  if (showComingSoon) {
    pipeline = pipeline.blur(PRE_RELEASE_BLUR_SIGMA)
  }

  if (glassLayers.size > 0) await insertFrostedGlassUnderlays(pipeline, layers, glassLayers, CW, CH, glassBlurOverrides)

  pipeline = pipeline.composite(layers)

  const q = POSTER_ENCODE_QUALITY[input.imageQuality ?? DEFAULT_IMAGE_QUALITY]
  if (input.format === "avif") {
    return await pipeline.avif({ quality: q.avif, effort: 2 }).toBuffer()
  }
  if (input.format === "webp") {
    return await pipeline.webp({ quality: q.webp, effort: 2 }).toBuffer()
  }
  return await pipeline.jpeg({ quality: q.jpeg, mozjpeg: true }).toBuffer()
}
