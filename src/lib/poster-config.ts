// ---------------------------------------------------------------------------
// Parsing della configurazione di resa (badge/blur/gradiente/logo) della route
// poster da query string + mapping + config token + server defaults.
// Estratto dalla route `/api/poster/[type]/[id]` per renderlo testabile in
// isolamento. Semantica identica all'originale — nessuna logica di rendering.
// ---------------------------------------------------------------------------

import type { PictoriumUserConfig } from "./config-token"
import { effectiveMappingForShape, isPosterLayout, isPosterFreshScope, DEFAULT_POSTER_LAYOUT, DEFAULT_POSTER_FRESH_SCOPE, type Mapping, type NetworkLogoPosition, type PosterLayout, type PosterFreshScope, type PosterShape } from "./types"
import { effectiveDefaultsForShape } from "./server-defaults"
import type { ServerDefaults } from "./server-defaults"
import { resolveLabelFor } from "./i18n"
import { resolveRatingSources } from "./ratings"
import { parseMinQuality, type StreamQuality } from "./quality-tiers"
import { parseSashOrder, normalizeSashOrder, DEFAULT_SASH_ORDER, type SashBucket } from "./badge-priority"
import {
  isBadgeStyle,
  isRankingBadgeStyle,
  isExtraBadgeStyle,
  isQualityBadgeStyle,
  isBadgeFont,
  isSeparateRatingsStyle,
  isBottomSeparateRatingsStyle,
  getSeparateBadgeDefaultScale,
  getSeparateRatingsStyleForShape,
  nonRibbonRankingStyle,
  getQualityBadgeOffsetDefault,
  DEFAULT_BADGE_STYLE,
  DEFAULT_RANKING_BADGE_STYLE,
  DEFAULT_QUALITY_BADGE_STYLE,
  DEFAULT_BADGE_FONT,
  DEFAULT_SEPARATE_RATINGS_STYLE,
  type BadgeStyle,
  type RankingBadgeStyle,
  type ExtraBadgeStyle,
  type QualityBadgeStyle,
  type BadgeFont,
  type SeparateRatingsStyle,
} from "./badge-styles"
import { NON_CLEAN_BLUR_FADE, NON_CLEAN_GRADIENT_HEIGHT } from "./gradient-defaults"
import {
  resolveEffectiveNetworkFollow,
  resolveLandscapeNetworkOffsets,
  resolveNetworkFixedCoords,
  resolveNetworkFollowTitle,
} from "./network-follow"

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Formato canvas — precedenza: query `shape` > mapping salvato >
 * config token > server defaults > "poster". Solo "landscape" attiva il
 * ramo 16:9 (base = backdrop TMDB); "poster" e "square" (fallback esplicito
 * Nuvio: Pictorium non ha un canvas quadrato) selezionano il verticale.
 * Usato dalla route PRIMA del fetch (serve a scegliere la base) e dentro
 * resolvePosterRenderConfig per coerenza.
 */
export function resolvePosterShape(
  searchParams: URLSearchParams,
  mapping: Mapping | null,
  configOverride: PictoriumUserConfig | null,
  sd: ServerDefaults,
): PosterShape {
  const q = (searchParams.get("shape") || "").toLowerCase()
  if (q === "landscape") return "landscape"
  if (q === "poster" || q === "square") return "poster"
  // Placeholder Nuvio `{shape}` ricevuto senza sostituzione (o qualsiasi
  // valore non riconosciuto): nessun errore, vale il fallback sotto.
  if (mapping?.posterShape === "landscape" || mapping?.posterShape === "poster") return mapping.posterShape
  if (configOverride?.posterShape === "landscape" || configOverride?.posterShape === "poster") return configOverride.posterShape
  if (sd.posterShape === "landscape" || sd.posterShape === "poster") return sd.posterShape
  return "poster"
}

// ---------------------------------------------------------------------------
// Rating separati: definizione centralizzata (unico punto di verità per route
// e resolvePosterRenderConfig — mai catene `sep` duplicate che divergono).
// ---------------------------------------------------------------------------

/**
 * Separate ratings display flag — chain: query `sep` > mapping > config
 * token > effective per-shape defaults > flat > false (same as `cr`).
 * The 5th arg carries flats when `sd` is already shape-effective
 * (shape-aware callers always pass it).
 */
export function resolveSeparateRatingsEnabled(
  searchParams: URLSearchParams,
  mapping: Mapping | null,
  configOverride: PictoriumUserConfig | null,
  sd: ServerDefaults,
  flatSd?: ServerDefaults | null,
): boolean {
  const qSep = searchParams.get("sep")
  return qSep !== null
    ? qSep !== "0"
    : (mapping?.separateRatings ?? configOverride?.separateRatings ?? sd.separateRatings ?? flatSd?.separateRatings ?? false)
}

/**
 * Layout dei rating separati — catena: query `sepstyle` > mapping effettivo
 * per formato (profilo landscape vince sul flat) > config token > defaults
 * effettivi per formato > "column".
 *
 * Fail-closed con distinzione dall'assenza (stesso pattern `bfont` in
 * normalizePosterCacheParams): un valore PRESENTE ma non valido (garbage o
 * stringa vuota) rende `column` esplicito e NON eredita mapping/default —
 * altrimenti collasserebbe con la chiave dell'assenza (che può ereditare
 * bottom) avvelenando la cache. La query è case-insensitive (canonical
 * lowercase, come `netPos`); mapping/config/defaults sono già tipizzati.
 */
export function resolveSeparateRatingsStyle(
  searchParams: URLSearchParams,
  mapping: Mapping | null,
  configOverride: PictoriumUserConfig | null,
  sd: ServerDefaults,
  shape: PosterShape,
): SeparateRatingsStyle {
  if (searchParams.has("sepstyle")) {
    const v = (searchParams.get("sepstyle") || "").toLowerCase()
    // Barra disattivata in landscape DOPO la risoluzione (raw salvati intatti).
    return getSeparateRatingsStyleForShape(
      isSeparateRatingsStyle(v) ? v : DEFAULT_SEPARATE_RATINGS_STYLE,
      shape,
    )
  }
  const m = effectiveMappingForShape(mapping, shape)
  const esd = effectiveDefaultsForShape(sd, shape)
  const raw = m?.separateRatingsStyle
    || configOverride?.separateRatingsStyle
    || esd.separateRatingsStyle
  return getSeparateRatingsStyleForShape(
    isSeparateRatingsStyle(raw) ? raw : DEFAULT_SEPARATE_RATINGS_STYLE,
    shape,
  )
}

/**
 * Graphical poster layout — catena: query `layout` > mapping effettivo per
 * formato (profilo landscape vince sul flat) > config token > defaults
 * effettivi per formato > "standard".
 *
 * Fail-closed con distinzione dall'assenza (stesso pattern `sepstyle`/`bfont`
 * in normalizePosterCacheParams): un valore PRESENTE ma non valido (garbage
 * o stringa vuota) rende `standard` esplicito e NON eredita mapping/default —
 * altrimenti collasserebbe con la chiave dell'assenza (che può ereditare
 * fresh) avvelenando la cache. La query è case-insensitive (canonical
 * lowercase); mapping/config/defaults sono già tipizzati. Un `standard`
 * esplicito valido prevale sempre su un fresh ereditato.
 */
export function resolvePosterLayout(
  searchParams: URLSearchParams,
  mapping: Mapping | null,
  configOverride: PictoriumUserConfig | null,
  sd: ServerDefaults,
  shape: PosterShape,
): PosterLayout {
  if (searchParams.has("layout")) {
    const v = (searchParams.get("layout") || "").toLowerCase()
    return isPosterLayout(v) ? v : DEFAULT_POSTER_LAYOUT
  }
  const m = effectiveMappingForShape(mapping, shape)
  const esd = effectiveDefaultsForShape(sd, shape)
  const raw = m?.posterLayout
    || configOverride?.posterLayout
    || esd.posterLayout
  return isPosterLayout(raw) ? raw : DEFAULT_POSTER_LAYOUT
}

/**
 * Fresh apply scope — catena: query `freshScope` > mapping effettivo per
 * formato (profilo landscape vince sul flat) > config token > defaults
 * effettivi per formato > "ranked" (default condiviso).
 *
 * Fail-closed con distinzione dall'assenza (stesso pattern `layout` sopra):
 * un valore PRESENTE ma non valido (garbage o stringa vuota) rende `ranked`
 * esplicito e NON eredita mapping/default — altrimenti collasserebbe con la
 * chiave dell'assenza (che può ereditare all) avvelenando la cache. La
 * query è case-insensitive (canonical lowercase); mapping/config/defaults
 * sono già tipizzati. Un `all` esplicito valido prevale sempre su un ranked
 * ereditato.
 */
export function resolvePosterFreshScope(
  searchParams: URLSearchParams,
  mapping: Mapping | null,
  configOverride: PictoriumUserConfig | null,
  sd: ServerDefaults,
  shape: PosterShape,
): PosterFreshScope {
  if (searchParams.has("freshScope")) {
    const v = (searchParams.get("freshScope") || "").toLowerCase()
    return isPosterFreshScope(v) ? v : DEFAULT_POSTER_FRESH_SCOPE
  }
  const m = effectiveMappingForShape(mapping, shape)
  const esd = effectiveDefaultsForShape(sd, shape)
  const raw = m?.posterFreshScope
    || configOverride?.posterFreshScope
    || esd.posterFreshScope
  return isPosterFreshScope(raw) ? raw : DEFAULT_POSTER_FRESH_SCOPE
}

export interface BottomSeparateActiveInput {
  badgesEnabled: boolean
  badgeRating: boolean
  separateRatings: boolean
  separateRatingsStyle: SeparateRatingsStyle | string | null | undefined
}

/**
 * Bottom attivo = badgesEnabled && badgeRating && sep && stile bottom —
 * INDIPENDENTE da sepItems.length: con voti temporaneamente assenti nasconde
 * comunque genere+anno+voto medio (mai valori inventati).
 */
export function isBottomSeparateActive(input: BottomSeparateActiveInput): boolean {
  return !!input.badgesEnabled
    && !!input.badgeRating
    && !!input.separateRatings
    && isBottomSeparateRatingsStyle(input.separateRatingsStyle)
}

export interface SeparateDisplayState {
  /** Colonna storica: sostituisce la media ★ (priorità invariata). */
  useSeparate: boolean
  /** Modalità bottom scelta dall'utente (soppressione effettiva, vedi sotto). */
  bottomActive: boolean
  effectiveBadgeGenre: boolean
  effectiveBadgeYear: boolean
  effectiveBadgeRating: boolean
  /** In bottom la riga custom provider non si rende (mai duplicata). */
  suppressCustomRow: boolean
}

/**
 * Stato display dei separati da flag già risolti + n. provider disponibili.
 * La soppressione genere/anno/voto è EFFETTIVA (solo render): i flag salvati
 * (mapping/defaults) non vengono mutati — tornando a column si ripristinano.
 * Il custom provider conserva la priorità storica sulla colonna (invariata:
 * con riga custom renderizzata lo stack si nasconde); in bottom è invece la
 * riga custom a essere esclusa (mai duplicata).
 */
export function resolveSeparateDisplayState(input: {
  badgesEnabled: boolean
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  separateRatings: boolean
  separateRatingsStyle: SeparateRatingsStyle
  sepItemCount: number
}): SeparateDisplayState {
  const bottomActive = isBottomSeparateActive({
    badgesEnabled: input.badgesEnabled,
    badgeRating: input.badgeRating,
    separateRatings: input.separateRatings,
    separateRatingsStyle: input.separateRatingsStyle,
  })
  const useSeparate = !!input.badgesEnabled
    && !!input.badgeRating
    && !!input.separateRatings
    && input.separateRatingsStyle === "column"
    && input.sepItemCount > 0
  return {
    useSeparate,
    bottomActive,
    effectiveBadgeGenre: input.badgeGenre && !bottomActive,
    effectiveBadgeYear: input.badgeYear && !bottomActive,
    effectiveBadgeRating: input.badgeRating && !useSeparate && !bottomActive,
    suppressCustomRow: bottomActive,
  }
}

/**
 * Risoluzione follow/coords network: definizioni in `network-follow.ts`
 * (modulo browser-safe, importato anche dai builder URL). Qui ri-esportate
 * per i consumer server/test esistenti.
 */
export {
  resolveNetworkFollowTitle,
  resolveEffectiveNetworkFollow,
  resolveNetworkFixedCoords,
  resolveLandscapeNetworkOffsets,
} from "./network-follow"

export interface PosterRenderConfigInput {
  searchParams: URLSearchParams
  mapping: Mapping | null
  configOverride: PictoriumUserConfig | null
  sd: ServerDefaults
  /** true se la richiesta fornisce poster/mapping espliciti (query o mapping salvato) */
  hasQuery: boolean
  showBadges: boolean
  rankingBadges: boolean
  /** segnali di classifica per l'auto-detect default→netflix */
  animeRank: number | null
  rankingResult: number | null
  finalRank: number | null
  /** lingua per la risoluzione delle label prefissate (__badge.*) — fix L32 */
  lang?: string
}

export interface PosterRenderConfig {
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /**
   * Standalone extra-badge style (`xbs` query > mapping > config token >
   * server defaults). Null = absent everywhere = legacy: the extra badge
   * keeps rendering with `rankingBadgeStyle`. Flat-only (both canvases).
   */
  extraBadgeStyle: ExtraBadgeStyle | null
  /** Font dei testi badge ("inter" = resa storica). */
  badgeFont: BadgeFont
  /** Stile icone del badge qualità (standard = pill testuale). */
  qualityBadgeStyle: QualityBadgeStyle
  blurEnabled: boolean
  blurHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  /** Intensità tinta di scena 0-100 (default 20). */
  tintStrength: number
  /**
   * Ombra lineare superiore 0-100 (default 50). Catena completa come la tinta:
   * query `ts` > mapping per-titolo > config token > server defaults
   * (`PICTORIUM_TOP_SHADE`) > 50. Solo flat (vale per entrambi i canvas).
   */
  topShade: number
  badgesEnabled: boolean
  rankingEnabled: boolean
  /** Quali componenti del badge genere/rating mostrare (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality: boolean
  /** Soglia minima tier qualità streaming — catena: query `qmin` > server defaults > "SD". Globale (nessun per-titolo). */
  minQuality: StreamQuality
  /** Ordine/priorità sash — catena: query `sash` > server defaults > default. Globale (nessun per-titolo). */
  sashOrder: SashBucket[]
  /** Riga rating custom provider (display). Default ON quando il provider è configurato. */
  customRatings: boolean
  ratingSources: string[]
  /** Colonna rating separati a destra (sostituisce la media ★). Default OFF. Solo portrait (il gate è al sito d'uso). */
  separateRatings: boolean
  /** Layout dei rating separati (default "column" = colonna destra storica). */
  separateRatingsStyle: SeparateRatingsStyle
  /** Scala % della colonna rating separati (default 100 = resa storica). */
  separateBadgeScale: number
  /** Offset px del gruppo rating separati, colonna/pills (bar portrait: solo Y). Default 0. */
  separateBadgeOffsetX: number
  /** Offset px del gruppo rating separati (negativo = su, positivo = giù). Default 0. */
  separateBadgeOffsetY: number
  logoScale: number | null
  logoOffsetX: number | null
  logoOffsetY: number | null
  /** Scala % del badge superiore (default 100). Offset solo stili centrati. */
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  /**
   * Tuning EXTRA superiore risolto (null = assente ovunque: il render applica
   * il fallback legacy sul tuning classifica). Catena: query `exscale`/`exox`/
   * `exoy` > mapping per-shape > config token > defaults per-shape > null.
   */
  extraBadgeScale: number | null
  extraBadgeOffsetX: number | null
  extraBadgeOffsetY: number | null
  /** Scala % del badge genere/rating in basso (default 100). */
  genreBadgeScale: number
  /** Offset px del badge genere/rating, solo stili non-bar. */
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  /** Scala % del badge qualità streaming (default 100). */
  qualityBadgeScale: number
  /** Offset px del badge qualità. */
  qualityBadgeOffsetX: number
  qualityBadgeOffsetY: number
  /** Scala % del logo network (default 100). */
  networkLogoScale: number
  /** Offset px del logo network. */
  networkLogoOffsetX: number
  networkLogoOffsetY: number
  /**
   * Il network segue il layout storico ancorato al titolo (default true).
   * Catena: query `netFollow` ("0" = false, presente-altro = true) > mapping
   * per-titolo > config token > server defaults effettivi > true.
   * False esplicito prevale sempre (anche su default ereditati true).
   */
  networkLogoFollowTitle: boolean
  /**
   * Coordinate assolute del box network (top-left) in px nel canvas del
   * formato, solo con follow spento. Null = layout storico. Per-shape, mai
   * fallback cross-shape (il portrait non eredita dal landscape e viceversa).
   */
  networkFixedX: number | null
  networkFixedY: number | null
  queryExtra: string | null
  qNetLogo: string | null
  networkLogo: boolean
  /**
   * Posizione del logo network — catena: query `netPos` ("top", garbage =
   * auto) > mapping per-titolo > config token > server defaults > "auto"
   * (specchio dinamico odierno, byte-identico).
   */
  networkLogoPosition: NetworkLogoPosition
  ribbonSide: "left" | "right"
  /**
   * Nastro stile Netflix all'angolo — catena: query `ribbon` > mapping
   * per-titolo > config token > server defaults > true. Su false gli stili
   * nastro degradano all'equivalente centrato (mai nascosti).
   */
  ribbonEnabled: boolean
  /**
   * Tinta accent sul badge classifica centrato: true quando il nastro è OFF
   * e lo stile pre-degrado era "colored" (senza nastro deve colorare il
   * badge default come riempimento piatto). Col nastro ON è ininfluente
   * (lo stile "colored" colora già da sé).
   */
  rankingBadgeAccent: boolean
  /** Stato pre-digitale (darken + badge Coming Soon, solo film). Default OFF. */
  preRelease: boolean
  /** Formato canvas (query `shape` > mapping > config > defaults > "poster"). */
  posterShape: PosterShape
  /**
   * Graphical poster layout (query `layout` > mapping effettivo per formato
   * > config token > defaults effettivi per formato > "standard").
   * "fresh" compone il layout alternativo nel renderer unico (fresh-layout).
   */
  posterLayout: PosterLayout
  /**
   * Fresh apply scope (query `freshScope` > mapping effettivo per formato
   * > config token > defaults effettivi per formato > "ranked"). Il renderer
   * decide il layout EFFETTIVO: con "ranked" e senza rank valido mostrato
   * rende Standard byte-identico.
   */
  posterFreshScope: PosterFreshScope
  /**
   * Nasconde il logo film dal composite (solo query `hideLogo`, default false).
   * Veicolo del banner pulito (i client che lo leggono sovrappongono già il
   * logo da catalogo: il baked-in creerebbe un doppione). Il fetch resta per
   * i colori accent.
   */
  hideLogo: boolean
  /**
   * Allineamento blocco logo/metadati — precedenza: query `align` > server
   * defaults > default di formato (landscape "left", poster "center").
   * Globale: nessun override per-titolo (il mapping non ha il campo).
   */
  logoAlign: "left" | "center"
}

export function resolvePosterRenderConfig(input: PosterRenderConfigInput): PosterRenderConfig {
  const { searchParams: q, mapping, configOverride, sd, hasQuery, showBadges, rankingBadges } = input

  // Canvas shape first: feeds the per-shape defaults below (20% gradient in
  // landscape, landscape profiles). Same chain as the other params — see
  // resolvePosterShape.
  const posterShape = resolvePosterShape(q, mapping, configOverride, sd)
  // Per-shape profiles (dual format My Posters): in landscape the saved
  // `mapping.landscape` wins per key over flats. The query > mapping >
  // config > defaults chain below is unchanged.
  const m = effectiveMappingForShape(mapping, posterShape)
  // Effective per-shape defaults (Settings · Landscape): in landscape the
  // server profile wins per key over flats (gradient/blur, scales/offsets
  // AND shared visuals with overrides); absent keys follow flats,
  // explicit `false`/`[]`/`0` win.
  const esd = effectiveDefaultsForShape(sd, posterShape)

  // Ranking style — precedenza: query `rs` > mapping salvato > config token > server defaults > default.
  // (Coerente con `badgeStyle` sotto: la query vince sul mapping — M6 WYSIWYG.
  // Il sentinel "default" del mapping è trattato come "nessun override", identico
  // a come "shadow" lo è per badgeStyle.)
  const rawRs =
    q.get("rs") ||
    (mapping?.rankingBadgeStyle && mapping.rankingBadgeStyle !== "default" ? mapping.rankingBadgeStyle : undefined) ||
    configOverride?.rankingBadgeStyle ||
    esd.rankingBadgeStyle ||
    sd.rankingBadgeStyle
  let rankingBadgeStyle: RankingBadgeStyle = isRankingBadgeStyle(rawRs) ? rawRs : DEFAULT_RANKING_BADGE_STYLE

  const qRankParam = q.get("rank")
  const hasRank = !!(input.animeRank || input.rankingResult || mapping?.badgeRank || mapping?.trendRank || qRankParam || input.finalRank)
  // Nastro stile Netflix — catena: query `ribbon=0/1` > mapping per-titolo >
  // config token > server defaults > true (ON storico). Su false gli stili
  // nastro degradano all'equivalente centrato (mai nascosti, WYSIWYG).
  const qRibbon = q.get("ribbon")
  const ribbonEnabled = qRibbon !== null
    ? qRibbon !== "0"
    : (mapping?.ribbonEnabled ?? configOverride?.ribbonEnabled ?? esd.ribbonEnabled ?? sd.ribbonEnabled ?? true)
  // "default" = auto-detect: mostra il badge stile Netflix se c'è un rank,
  // altrimenti badge standard. Se il sorgente (mapping/query/config) specifica
  // un valore esplicito (pill/colored/bordo/vetro/netflix), viene rispettato
  // senza override ("bar" rimosso: degrada a "default" via isRankingBadgeStyle).
  if (hasRank && rankingBadgeStyle === "default" && ribbonEnabled) {
    rankingBadgeStyle = "netflix"
  } else if (!hasRank && rankingBadgeStyle === "netflix") {
    rankingBadgeStyle = "default"
  }
  // Senza nastro il "colored" deve colorare il badge default (tinta accent
  // come riempimento piatto): il flag viaggia fino al builder, che colora
  // solo questo caso (i default scelti dall'utente restano satinati).
  let rankingBadgeAccent = false
  if (!ribbonEnabled) {
    rankingBadgeAccent = rankingBadgeStyle === "colored"
    rankingBadgeStyle = nonRibbonRankingStyle(rankingBadgeStyle)
  }

  // Extra style — precedence: query `xbs` > saved mapping > config token >
  // server defaults > absent (null = legacy `rs` fallback, byte-identical).
  // A present-but-invalid query value behaves as absent (falls through the
  // chain) so it stays consistent with the cache normalization, which drops
  // it from the key. Stored values are re-validated (legacy garbage passes
  // through to the `rs` fallback instead of breaking the render).
  const qXbsRaw = q.get("xbs")
  const qXbs = qXbsRaw !== null && isExtraBadgeStyle(qXbsRaw) ? qXbsRaw : undefined
  const mXbsRaw = mapping?.extraBadgeStyle
  const mXbs = isExtraBadgeStyle(mXbsRaw) ? mXbsRaw : undefined
  const cXbsRaw = configOverride?.extraBadgeStyle
  const cXbs = isExtraBadgeStyle(cXbsRaw) ? cXbsRaw : undefined
  const sXbsRaw = esd.extraBadgeStyle ?? sd.extraBadgeStyle
  const sXbs = isExtraBadgeStyle(sXbsRaw) ? sXbsRaw : undefined
  const extraBadgeStyle: ExtraBadgeStyle | null = qXbs ?? mXbs ?? cXbs ?? sXbs ?? null

  // Allineamento Cinematic: vale SOLO in landscape (i portrait restano
  // rigorosamente centrati per contratto — nessun parametro query o default
  // globale deve mai spostarli a sinistra).
  // In landscape: query `align=left|center` > server defaults > default "left".
  const qAlign = (q.get("align") || "").toLowerCase()
  const logoAlign: "left" | "center" = posterShape === "landscape"
    ? (qAlign === "left" || qAlign === "center"
        ? qAlign
        : (sd.logoAlign === "left" || sd.logoAlign === "center" ? sd.logoAlign : "left"))
    : "center"

  // Fix M3: includere i campi blur salvati nel mapping nella catena di fallback
  // (query > mapping > configOverride > default), come già fatto per badgeGenre/badgeStyle.
  // Prima il mapping salvato con blur custom non veniva mai applicato.
  // Percorso live (`live=1`, Segui-spazio): i parametri assenti seguono lo
  // spazio salvato (vedi badges/blur sotto). Dichiarata qui perché il primo
  // uso (blurEnabled) precede il blocco badges.
  const isLiveFollow = q.get("live") === "1"
  const blurEnabled = q.get("be") !== null
    ? q.get("be") !== "0"
    : (m?.blurEnabled != null ? m.blurEnabled : (configOverride !== null ? configOverride.blurEnabled : (isLiveFollow ? (esd.blurEnabled ?? true) : true)))
  // Clamp espliciti: impediscono a valori estremi (query o config) di arrivare a
  // sharp.blur con sigma enormi o gradienti fuori scala (potenziale DoS CPU).
  // Mapping non-clean senza valori congelati: default per tipo poster (come
  // l'editor all'apertura e gli URL Stremio), non i default globali. Vale solo
  // a language esplicita: i mapping storici senza campo restano sul globale.
  const mappingNonClean = m?.language != null
  const rawGradHeight = q.get("gradHeight") ? Number(q.get("gradHeight")) : NaN
  const blurHeight = Number.isFinite(rawGradHeight)
    ? clamp(rawGradHeight, 5, 100)
    : (m?.gradientHeight != null && Number.isFinite(m.gradientHeight)
        ? clamp(m.gradientHeight, 5, 100)
        : (configOverride !== null ? clamp(configOverride.gradientHeight, 5, 100) : (esd.gradientHeight != null && Number.isFinite(esd.gradientHeight) ? clamp(esd.gradientHeight, 5, 100) : (posterShape === "landscape" ? 20 : (mappingNonClean ? NON_CLEAN_GRADIENT_HEIGHT : 30)))))
  const rawBlur = q.get("blur") ? Number(q.get("blur")) : NaN
  const blurIntensity = Number.isFinite(rawBlur)
    ? clamp(rawBlur, 1, 100)
    : (m?.blurIntensity != null && Number.isFinite(m.blurIntensity)
        ? clamp(m.blurIntensity, 1, 100)
        : (configOverride !== null ? clamp(configOverride.blurIntensity, 1, 100) : (esd.blurIntensity != null && Number.isFinite(esd.blurIntensity) ? clamp(esd.blurIntensity, 1, 100) : 20)))
  // Fade di default: 70 in landscape, 50 nel portrait (look Naturale), 80
  // per i mapping non-clean senza valori congelati (profilo per tipo, come
  // l'altezza 20 — sync con stremio-poster-url e ramo Stremio unmapped).
  const rawBf = q.get("bf") ? Number(q.get("bf")) : NaN
  const blurFade = Number.isFinite(rawBf)
    ? clamp(rawBf, 0, 100)
    : (m?.blurFade != null && Number.isFinite(m.blurFade)
        ? clamp(m.blurFade, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurFade, 0, 100) : (esd.blurFade != null && Number.isFinite(esd.blurFade) ? clamp(esd.blurFade, 0, 100) : (posterShape === "landscape" ? 70 : (mappingNonClean ? NON_CLEAN_BLUR_FADE : 50)))))
  const rawBd = q.get("bd") ? Number(q.get("bd")) : NaN
  const blurDarkness = Number.isFinite(rawBd)
    ? clamp(rawBd, 0, 100)
    : (m?.blurDarkness != null && Number.isFinite(m.blurDarkness)
        ? clamp(m.blurDarkness, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurDarkness, 0, 100) : (esd.blurDarkness != null && Number.isFinite(esd.blurDarkness) ? clamp(esd.blurDarkness, 0, 100) : 30)))

  // Intensità tinta 0-100 — stessa catena (query > mapping.landscape >
  // mapping flat > config > defaults(.landscape) > 20). Vale per formato.
  const rawTint = q.get("tint") ? Number(q.get("tint")) : NaN
  const tintStrength = q.get("tint") !== null
    ? (Number.isFinite(rawTint) ? clamp(Math.round(rawTint), 0, 100) : 20)
    : (m?.tintStrength != null && Number.isFinite(m.tintStrength)
        ? clamp(Math.round(m.tintStrength), 0, 100)
        : (configOverride?.tintStrength != null && Number.isFinite(configOverride.tintStrength)
            ? clamp(Math.round(configOverride.tintStrength), 0, 100)
            : (esd.tintStrength != null && Number.isFinite(esd.tintStrength)
                ? clamp(Math.round(esd.tintStrength), 0, 100)
                : 20)))

  // Ombra superiore 0-100 — catena completa (query > mapping.landscape >
  // mapping flat > config > defaults(.landscape) > 50). Stessi clamp anti-DoS.
  const rawTs = q.get("ts") ? Number(q.get("ts")) : NaN
  const topShade = q.get("ts") !== null
    ? (Number.isFinite(rawTs) ? clamp(Math.round(rawTs), 0, 100) : 50)
    : (m?.topShade != null && Number.isFinite(m.topShade)
        ? clamp(Math.round(m.topShade), 0, 100)
        : (configOverride?.topShade != null && Number.isFinite(configOverride.topShade)
            ? clamp(Math.round(configOverride.topShade), 0, 100)
            : (esd.topShade != null && Number.isFinite(esd.topShade)
                ? clamp(Math.round(esd.topShade), 0, 100)
                : 50)))

  const qBadges = q.get("badges")
  const qRanking = q.get("ranking")
  // OFF/ON espliciti in query vincono sempre (anche su titolo non salvato
  // senza token): senza, badges=0/ranking=0 venivano ignorati (hasQuery false).
  // Percorso live (`live=1`, Segui-spazio): il parametro assente segue lo
  // spazio (mapping > config > sd), non il default ON — altrimenti un `false`
  // salvato diventerebbe `true`. Fuori dal live, comportamento invariato.
  const badgesEnabled = qBadges !== null
    ? qBadges !== "0"
    : (isLiveFollow
      ? (mapping?.showBadges ?? configOverride?.globalBadges ?? esd.globalBadges ?? sd.globalBadges ?? showBadges)
      : (hasQuery
      ? (configOverride !== null
        ? configOverride.globalBadges
        : showBadges)
      : true))
  const rankingEnabled = qRanking !== null
    ? qRanking !== "0"
    : (isLiveFollow
      ? (mapping?.rankingBadges ?? configOverride?.rankingBadges ?? esd.rankingBadges ?? sd.rankingBadges ?? rankingBadges)
      : (hasQuery
      ? (configOverride !== null
        ? configOverride.rankingBadges
        : rankingBadges)
      : true))

  // Componenti badge genere/rating — precedenza: query `bg/by/br` > mapping salvato
  // > config token/profilo > server defaults > true (tutti ON di default).
  const qBg = q.get("bg")
  const qBy = q.get("by")
  const qBr = q.get("br")
  const qBq = q.get("bq")
  const badgeGenre = qBg !== null ? qBg !== "0" : (mapping?.badgeGenre ?? configOverride?.badgeGenre ?? esd.badgeGenre ?? sd.badgeGenre ?? true)
  const badgeYear = qBy !== null ? qBy !== "0" : (mapping?.badgeYear ?? configOverride?.badgeYear ?? esd.badgeYear ?? sd.badgeYear ?? true)
  const badgeRating = qBr !== null ? qBr !== "0" : (mapping?.badgeRating ?? configOverride?.badgeRating ?? esd.badgeRating ?? sd.badgeRating ?? true)
  const badgeQuality = qBq !== null ? qBq !== "0" : (mapping?.badgeQuality ?? configOverride?.badgeQuality ?? esd.badgeQuality ?? sd.badgeQuality ?? true)

  // Minimum streaming quality tier — chain: query `qmin` > effective
  // per-shape defaults > "SD" (show all). Invalid values → default. No
  // per-title/config override (mappings lack the field).
  const minQuality: StreamQuality = parseMinQuality(q.get("qmin")) ?? parseMinQuality(esd.minQuality ?? sd.minQuality ?? null) ?? "SD"

  // Sash order — chain: query `sash` (ordered subset, unlisted = off) >
  // effective per-shape defaults > default. Invalid tokens ignored, never
  // garbage. Explicit `[]` = all off (valid state).
  const sashOrder: SashBucket[] = parseSashOrder(q.get("sash"))
    ?? normalizeSashOrder(esd.sashOrder ?? sd.sashOrder) ?? [...DEFAULT_SASH_ORDER]

  // Custom rating provider row (display) — precedence: query `cr` > saved
  // mapping > config token/profile > effective per-shape defaults > true
  // (ON by default). Rendering still requires a configured provider (env).
  const qCr = q.get("cr")
  const customRatings = qCr !== null ? qCr !== "0" : (mapping?.customRatings ?? configOverride?.customRatings ?? esd.customRatings ?? sd.customRatings ?? true)

  // Fonti voto medio ★ — catena canonica: query `rsrc` > mapping per-titolo >
  // config token > server defaults > imdb+tmdb. Stessa dell'URL Stremio.
  const ratingSources: string[] = resolveRatingSources(
    q.get("rsrc"),
    mapping?.ratingSources,
    configOverride?.ratingSources,
    sd.ratingSources,
  )

  // Separate ratings column — same chain (query `sep` > mapping > config >
  // effective per-shape defaults > false, see resolveSeparateRatingsEnabled).
  // Both canvases: the column follows the quality badge in landscape too.
  const separateRatings = resolveSeparateRatingsEnabled(q, mapping, configOverride, esd, sd)

  // Layout dei rating separati — catena query > mapping effettivo per formato
  // > config > defaults effettivi > "column" (vedi resolveSeparateRatingsStyle).
  const separateRatingsStyle = resolveSeparateRatingsStyle(q, mapping, configOverride, sd, posterShape)

  // Graphical poster layout — catena query > mapping effettivo per formato
  // > config > defaults effettivi > "standard" (vedi resolvePosterLayout).
  const posterLayout = resolvePosterLayout(q, mapping, configOverride, sd, posterShape)

  // Fresh apply scope — stessa catena (vedi resolvePosterFreshScope).
  const posterFreshScope = resolvePosterFreshScope(q, mapping, configOverride, sd, posterShape)

  // Badge style — confinamento della query string al union type: valori non validi
  // cadono sul default (il renderer in passato li trattava come "shadow" nel ramo else).
  // Vale per entrambi i formati (i default per-formato scelgono lo stile landscape).
  const rawBs = q.get("bs")
    || (mapping?.badgeStyle && mapping.badgeStyle !== "shadow" ? mapping.badgeStyle : undefined)
    || configOverride?.badgeStyle
    || esd.badgeStyle
    || sd.badgeStyle
  let badgeStyle: BadgeStyle = isBadgeStyle(rawBs) ? rawBs : DEFAULT_BADGE_STYLE
  // Stile "bar" non disponibile in landscape (full-width incoerente con
  // l'ancoraggio basso-destra 16:9): degrada a shadow come il ranking bar
  // degrada a default. Vale per preview e Stremio (stesso endpoint).
  if (posterShape === "landscape" && badgeStyle === "bar") badgeStyle = DEFAULT_BADGE_STYLE

  // Stile icone qualità — catena: query `qbs` > mapping salvato >
  // config token > server defaults > "standard". Valori non validi → standard.
  const rawQbs = q.get("qbs")
    || mapping?.qualityBadgeStyle
    || configOverride?.qualityBadgeStyle
    || esd.qualityBadgeStyle
    || sd.qualityBadgeStyle
  const qualityBadgeStyle: QualityBadgeStyle = isQualityBadgeStyle(rawQbs) ? rawQbs : DEFAULT_QUALITY_BADGE_STYLE

  // Font dei testi badge — stessa catena degli stili: query `bfont` >
  // mapping salvato (non-"inter" = override, come "shadow" per badgeStyle) >
  // config token > server defaults > "inter". Valori non validi → inter
  // (resa storica, URL esistenti invariati). La query usa `??` e non `||`:
  // `?bfont=` (stringa vuota) è un valore presente ma invalido → inter, come
  // lo normalizza la chiave cache; con `||` cadrebbe sui default (es. Oswald)
  // con la stessa chiave di `bfont=inter` ma byte diversi.
  const rawBfont =
    q.get("bfont") ??
    (mapping?.badgeFont && mapping.badgeFont !== "inter" ? mapping.badgeFont : undefined) ??
    configOverride?.badgeFont ??
    esd.badgeFont ??
    sd.badgeFont
  const badgeFont: BadgeFont = isBadgeFont(rawBfont) ? rawBfont : DEFAULT_BADGE_FONT

  const qScale = q.get("scale")
  const qOx = q.get("ox")
  const qOy = q.get("oy")
  // Bound anti-DoS (R1): scale fuori 10..200 arrivava a resizeLogoCached con
  // dimensioni assurde (sharp OOM); scale negativa addirittura crashava il
  // resize → 500 permanente. `scale=0`/non-numerico resta null come prima.
  const qScaleNum = qScale ? Number(qScale) : NaN
  // Catena: query esplicita > mapping salvato > default globali (Orizzontale
  // in landscape) > auto-fit per aspect (null). I default globali null
  // equivalgono ad assenti (auto-fit preserved).
  const logoScale = qScale
    ? (Number.isFinite(qScaleNum) && qScaleNum !== 0 ? clamp(Math.round(qScaleNum), 10, 200) : null)
    : (m?.logoScale ?? esd.logoScale ?? null)
  // Offset: clamp ±2000px (oltre è comunque fuori canvas). A differenza di
  // prima, `ox=0` esplicito vince sul mapping (0 reale invece di null).
  // Offset logo: query esplicita > mapping salvato > default globali
  // (Orizzontale nel formato). Null = nessun nudge utente: la calibrazione
  // geometrica (+10/-10 in landscape) vive nel renderer, invisibile ai param.
  const qOxNum = qOx ? Number(qOx) : NaN
  const logoOffsetX = qOx
    ? (Number.isFinite(qOxNum) ? clamp(Math.round(qOxNum), -2000, 2000) : null)
    : (m?.logoOffsetX ?? esd.logoOffsetX ?? null)
  const qOyNum = qOy ? Number(qOy) : NaN
  const logoOffsetY = qOy
    ? (Number.isFinite(qOyNum) ? clamp(Math.round(qOyNum), -2000, 2000) : null)
    : (m?.logoOffsetY ?? esd.logoOffsetY ?? null)

  // Badge superiore — stessa catena di blur/gradient (query > mapping > config
  // > server defaults > default), stessi bound del logo (scala %, offset px).
  const qTScaleNum = q.get("tscale") ? Number(q.get("tscale")) : NaN
  const topBadgeScale = q.get("tscale") !== null
    ? (Number.isFinite(qTScaleNum) && qTScaleNum !== 0 ? clamp(Math.round(qTScaleNum), 10, 200) : 100)
    : (m?.topBadgeScale != null && Number.isFinite(m.topBadgeScale)
        ? clamp(Math.round(m.topBadgeScale), 10, 200)
        : (configOverride?.topBadgeScale != null && Number.isFinite(configOverride.topBadgeScale)
            ? clamp(Math.round(configOverride.topBadgeScale), 10, 200)
            : (esd.topBadgeScale != null && Number.isFinite(esd.topBadgeScale)
                ? clamp(Math.round(esd.topBadgeScale), 10, 200)
                : 100)))
  const qToxNum = q.get("tox") ? Number(q.get("tox")) : NaN
  const topBadgeOffsetX = q.get("tox") !== null
    ? (Number.isFinite(qToxNum) ? clamp(Math.round(qToxNum), -2000, 2000) : 0)
    : (m?.topBadgeOffsetX ?? configOverride?.topBadgeOffsetX ?? esd.topBadgeOffsetX ?? 0)
  const qToyNum = q.get("toy") ? Number(q.get("toy")) : NaN
  const topBadgeOffsetY = q.get("toy") !== null
    ? (Number.isFinite(qToyNum) ? clamp(Math.round(qToyNum), -2000, 2000) : 0)
    : (m?.topBadgeOffsetY ?? configOverride?.topBadgeOffsetY ?? esd.topBadgeOffsetY ?? 0)

  // Badge extra superiore — stessa catena (query > mapping per-shape > config
  // token > defaults per-shape), ma NULLABLE con fallback legacy: assente
  // ovunque (o query invalida) = null e il render usa il tuning classifica.
  // Mai default 100/0 baked qui: il fallback vive al sito d'uso per kind.
  const qExScaleNum = q.get("exscale") ? Number(q.get("exscale")) : NaN
  const extraBadgeScale = q.get("exscale") !== null
    ? (Number.isFinite(qExScaleNum) && qExScaleNum !== 0 ? clamp(Math.round(qExScaleNum), 10, 200) : null)
    : (m?.extraBadgeScale != null && Number.isFinite(m.extraBadgeScale)
        ? clamp(Math.round(m.extraBadgeScale), 10, 200)
        : (configOverride?.extraBadgeScale != null && Number.isFinite(configOverride.extraBadgeScale)
            ? clamp(Math.round(configOverride.extraBadgeScale), 10, 200)
            : (esd.extraBadgeScale != null && Number.isFinite(esd.extraBadgeScale)
                ? clamp(Math.round(esd.extraBadgeScale), 10, 200)
                : null)))
  const qExoxNum = q.get("exox") ? Number(q.get("exox")) : NaN
  const extraBadgeOffsetX = q.get("exox") !== null
    ? (Number.isFinite(qExoxNum) ? clamp(Math.round(qExoxNum), -2000, 2000) : null)
    : (m?.extraBadgeOffsetX ?? configOverride?.extraBadgeOffsetX ?? esd.extraBadgeOffsetX ?? null)
  const qExoyNum = q.get("exoy") ? Number(q.get("exoy")) : NaN
  const extraBadgeOffsetY = q.get("exoy") !== null
    ? (Number.isFinite(qExoyNum) ? clamp(Math.round(qExoyNum), -2000, 2000) : null)
    : (m?.extraBadgeOffsetY ?? configOverride?.extraBadgeOffsetY ?? esd.extraBadgeOffsetY ?? null)

  // Badge genere/rating in basso — stessa catena (query > mapping > config >
  // server defaults > default), stessi bound della scala (%, 10..200).
  const qGScaleNum = q.get("gscale") ? Number(q.get("gscale")) : NaN
  const genreBadgeScale = q.get("gscale") !== null
    ? (Number.isFinite(qGScaleNum) && qGScaleNum !== 0 ? clamp(Math.round(qGScaleNum), 10, 200) : 100)
    : (m?.genreBadgeScale != null && Number.isFinite(m.genreBadgeScale)
        ? clamp(Math.round(m.genreBadgeScale), 10, 200)
        : (configOverride?.genreBadgeScale != null && Number.isFinite(configOverride.genreBadgeScale)
            ? clamp(Math.round(configOverride.genreBadgeScale), 10, 200)
            : (esd.genreBadgeScale != null && Number.isFinite(esd.genreBadgeScale)
                ? clamp(Math.round(esd.genreBadgeScale), 10, 200)
                : 100)))

  // Offset badge genere — stessa catena, clamp px come il logo.
  const qGoxNum = q.get("gox") ? Number(q.get("gox")) : NaN
  const genreBadgeOffsetX = q.get("gox") !== null
    ? (Number.isFinite(qGoxNum) ? clamp(Math.round(qGoxNum), -2000, 2000) : 0)
    : (m?.genreBadgeOffsetX ?? configOverride?.genreBadgeOffsetX ?? esd.genreBadgeOffsetX ?? 0)
  const qGoyNum = q.get("goy") ? Number(q.get("goy")) : NaN
  const genreBadgeOffsetY = q.get("goy") !== null
    ? (Number.isFinite(qGoyNum) ? clamp(Math.round(qGoyNum), -2000, 2000) : 0)
    : (m?.genreBadgeOffsetY ?? configOverride?.genreBadgeOffsetY ?? esd.genreBadgeOffsetY ?? 0)

  // Badge qualità streaming — stessa catena, stessi bound (%, 10..200).
  const qQScaleNum = q.get("qscale") ? Number(q.get("qscale")) : NaN
  const qualityBadgeScale = q.get("qscale") !== null
    ? (Number.isFinite(qQScaleNum) && qQScaleNum !== 0 ? clamp(Math.round(qQScaleNum), 10, 200) : 100)
    : (m?.qualityBadgeScale != null && Number.isFinite(m.qualityBadgeScale)
        ? clamp(Math.round(m.qualityBadgeScale), 10, 200)
        : (configOverride?.qualityBadgeScale != null && Number.isFinite(configOverride.qualityBadgeScale)
            ? clamp(Math.round(configOverride.qualityBadgeScale), 10, 200)
            : (esd.qualityBadgeScale != null && Number.isFinite(esd.qualityBadgeScale)
                ? clamp(Math.round(esd.qualityBadgeScale), 10, 200)
                : 100)))

  // Offset badge qualità — stessa catena, clamp px come il logo. Fallback di
  // formato: portrait (Verticale) -10/+10, landscape (Orizzontale) 0/0 — gli
  // espliciti (query/mapping/config/defaults, incluso 0) vincono sempre.
  const qQoxNum = q.get("qox") ? Number(q.get("qox")) : NaN
  const qualityBadgeOffsetX = q.get("qox") !== null
    ? (Number.isFinite(qQoxNum) ? clamp(Math.round(qQoxNum), -2000, 2000) : 0)
    : (m?.qualityBadgeOffsetX ?? configOverride?.qualityBadgeOffsetX ?? esd.qualityBadgeOffsetX ?? getQualityBadgeOffsetDefault(posterShape, "x"))
  const qQoyNum = q.get("qoy") ? Number(q.get("qoy")) : NaN
  const qualityBadgeOffsetY = q.get("qoy") !== null
    ? (Number.isFinite(qQoyNum) ? clamp(Math.round(qQoyNum), -2000, 2000) : 0)
    : (m?.qualityBadgeOffsetY ?? configOverride?.qualityBadgeOffsetY ?? esd.qualityBadgeOffsetY ?? getQualityBadgeOffsetDefault(posterShape, "y"))

  // Colonna rating separati — stessa catena, stessi bound (%, 10..200).
  // Default unico 130 per tutti gli stili (solo fallthrough "tutto assente").
  // Query presente ma invalida → 130 (coerente col nuovo default; range/clamp
  // invariati). Esplicito (incluso 100) da query/mapping/token/defaults vince.
  const qSepScaleNum = q.get("sepscale") ? Number(q.get("sepscale")) : NaN
  const separateBadgeScale = q.get("sepscale") !== null
    ? (Number.isFinite(qSepScaleNum) && qSepScaleNum !== 0 ? clamp(Math.round(qSepScaleNum), 10, 200) : getSeparateBadgeDefaultScale(separateRatingsStyle))
    : (m?.separateBadgeScale != null && Number.isFinite(m.separateBadgeScale)
        ? clamp(Math.round(m.separateBadgeScale), 10, 200)
        : (configOverride?.separateBadgeScale != null && Number.isFinite(configOverride.separateBadgeScale)
            ? clamp(Math.round(configOverride.separateBadgeScale), 10, 200)
            : (esd.separateBadgeScale != null && Number.isFinite(esd.separateBadgeScale)
                ? clamp(Math.round(esd.separateBadgeScale), 10, 200)
                : getSeparateBadgeDefaultScale(separateRatingsStyle))))

  // Offset gruppo rating separati — stessa catena (query > mapping effettivo
  // per formato > config token > defaults effettivi > 0), clamp px come gli
  // altri offset. Muovono l'intero gruppo (mai i singoli provider).
  const qSepoxNum = q.get("sepox") ? Number(q.get("sepox")) : NaN
  const separateBadgeOffsetX = q.get("sepox") !== null
    ? (Number.isFinite(qSepoxNum) ? clamp(Math.round(qSepoxNum), -2000, 2000) : 0)
    : (m?.separateBadgeOffsetX ?? configOverride?.separateBadgeOffsetX ?? esd.separateBadgeOffsetX ?? 0)
  const qSepoyNum = q.get("sepoy") ? Number(q.get("sepoy")) : NaN
  const separateBadgeOffsetY = q.get("sepoy") !== null
    ? (Number.isFinite(qSepoyNum) ? clamp(Math.round(qSepoyNum), -2000, 2000) : 0)
    : (m?.separateBadgeOffsetY ?? configOverride?.separateBadgeOffsetY ?? esd.separateBadgeOffsetY ?? 0)

  // Logo network — stessa catena, stessi bound (%, 10..200).
  const qNScaleNum = q.get("netscale") ? Number(q.get("netscale")) : NaN
  const networkLogoScale = q.get("netscale") !== null
    ? (Number.isFinite(qNScaleNum) && qNScaleNum !== 0 ? clamp(Math.round(qNScaleNum), 10, 200) : 100)
    : (m?.networkLogoScale != null && Number.isFinite(m.networkLogoScale)
        ? clamp(Math.round(m.networkLogoScale), 10, 200)
        : (configOverride?.networkLogoScale != null && Number.isFinite(configOverride.networkLogoScale)
            ? clamp(Math.round(configOverride.networkLogoScale), 10, 200)
            : (esd.networkLogoScale != null && Number.isFinite(esd.networkLogoScale)
                ? clamp(Math.round(esd.networkLogoScale), 10, 200)
                : 100)))

  // Offset logo network — stessa catena, clamp px come il logo. In landscape
  // la risoluzione esclude i flat di un layer fixed (follow===false): sono
  // assoluti di un'altra shape e non devono rientrare come relativi
  // (vedi network-follow.ts); il portrait resta sul ramo storico byte-identico.
  const landNetOffsets = posterShape === "landscape"
    ? resolveLandscapeNetworkOffsets(q, mapping, configOverride, sd)
    : null
  const qNoxNum = q.get("nox") ? Number(q.get("nox")) : NaN
  // Flat di un layer fixed (follow===false) esclusi anche qui: sono assoluti
  // della loro shape, mai offset relativi (mode switch/reset a 0,0).
  const mNoxOff = mapping?.networkLogoFollowTitle === false ? undefined : m?.networkLogoOffsetX
  const cNoxOff = configOverride?.networkLogoFollowTitle === false
    ? undefined
    : configOverride?.networkLogoOffsetX
  const sNoxOff = sd.networkLogoFollowTitle === false ? undefined : esd.networkLogoOffsetX
  const networkLogoOffsetX = landNetOffsets
    ? landNetOffsets.x
    : (q.get("nox") !== null
      ? (Number.isFinite(qNoxNum) ? clamp(Math.round(qNoxNum), -2000, 2000) : 0)
      : (mNoxOff ?? cNoxOff ?? sNoxOff ?? 0))
  const qNoyNum = q.get("noy") ? Number(q.get("noy")) : NaN
  const mNoyOff = mapping?.networkLogoFollowTitle === false ? undefined : m?.networkLogoOffsetY
  const cNoyOff = configOverride?.networkLogoFollowTitle === false
    ? undefined
    : configOverride?.networkLogoOffsetY
  const sNoyOff = sd.networkLogoFollowTitle === false ? undefined : esd.networkLogoOffsetY
  const networkLogoOffsetY = landNetOffsets
    ? landNetOffsets.y
    : (q.get("noy") !== null
      ? (Number.isFinite(qNoyNum) ? clamp(Math.round(qNoyNum), -2000, 2000) : 0)
      : (mNoyOff ?? cNoyOff ?? sNoyOff ?? 0))

  // Fix L32: le label prefissate (__badge.*) vengono risolte con la lingua
  // della richiesta — prima un customBadge "__badge.anime" dal config token
  // arrivava letterale al renderer (la preview invece la risolveva → desync).
  const rawExtra = q.get("extra") || configOverride?.customBadge || null
  const queryExtra = rawExtra ? resolveLabelFor(rawExtra, input.lang || "it") : null
  const rawNetLogo = q.get("netLogo")
  const networkLogo: boolean = rawNetLogo !== null
    ? rawNetLogo !== "0"
    : (mapping?.networkLogo ?? (configOverride !== null ? configOverride.networkLogo : undefined) ?? esd.networkLogo ?? sd.networkLogo ?? true)
  const qNetLogo = networkLogo ? (rawNetLogo ?? (configOverride !== null ? (configOverride.networkLogo ? "1" : null) : null)) : "0"
  // Posizione logo network: query esplicita (`top` o `auto`) vince sempre;
  // poi il valore salvato per-titolo (anche `auto`), poi config token, poi
  // server defaults. Assente o garbage cade al livello successivo della catena.
  const qNetPosRaw = q.get("netPos")
  const qNetPosNorm = (qNetPosRaw || "").toLowerCase()
  const savedNetPos = mapping?.networkLogoPosition === "top" || mapping?.networkLogoPosition === "auto"
    ? mapping.networkLogoPosition
    : null
  const configNetPos = configOverride?.networkLogoPosition === "top" || configOverride?.networkLogoPosition === "auto"
    ? configOverride.networkLogoPosition
    : null
  const networkLogoPosition: NetworkLogoPosition = qNetPosNorm === "top"
    ? "top"
    : qNetPosNorm === "auto"
      ? "auto"
      : (savedNetPos ?? configNetPos ?? ((esd.networkLogoPosition ?? sd.networkLogoPosition) === "top" ? "top" : "auto"))
  // Ribbon side: explicit query wins, then config token, then live spaces
  // follow effective defaults. Otherwise portrait keeps the legacy behavior
  // (saved flat side ignored); landscape applies an explicit landscape
  // override only — no landscape override = legacy left.
  const qSide = q.get("side")
  const ribbonSide: "left" | "right" = qSide === "right"
    ? "right"
    : qSide === "left"
      ? "left"
      : ((configOverride?.ribbonSide ?? (isLiveFollow ? (esd.ribbonSide ?? sd.ribbonSide) : (posterShape === "landscape" ? sd.landscape?.ribbonSide : undefined))) === "right" ? "right" : "left")

  // Pre-release pre-digital (movies only): query `pre` > config token >
  // effective per-shape defaults > false. No per-title override.
  const qPre = q.get("pre")
  const preRelease = qPre !== null ? qPre !== "0" : (configOverride?.preRelease ?? esd.preRelease ?? sd.preRelease ?? false)

  // Nascondi logo film: solo query `hideLogo=1` (banner Nuvio), default false.
  // Nessuna catena mapping/config: non esiste il concetto per-titolo/globale.
  const qHideLogo = q.get("hideLogo")
  const hideLogo = qHideLogo !== null ? qHideLogo !== "0" : false

  // Follow network: toggle semplice + coordinate assolute riusate da
  // nox/noy (interpretazione condizionata al follow, vedi sopra). Il follow
  // è effettivo solo con coordinate fisse configurate per la shape:
  // spento-senza-coords rende follow, mai una modalità falsa incoerente.
  const networkFollowRaw = resolveNetworkFollowTitle(q, mapping, configOverride, sd, posterShape)
  const networkFixed = resolveNetworkFixedCoords(q, mapping, configOverride, sd, posterShape)
  const networkLogoFollowTitle = resolveEffectiveNetworkFollow(networkFollowRaw, networkFixed)

  return {
    badgeStyle,
    rankingBadgeStyle,
    extraBadgeStyle,
    badgeFont,
    qualityBadgeStyle,
    blurEnabled,
    blurHeight,
    blurIntensity,
    blurFade,
    blurDarkness,
    tintStrength,
    topShade,
    badgesEnabled,
    rankingEnabled,
    badgeGenre,
    badgeYear,
    badgeRating,
    badgeQuality,
    minQuality,
    sashOrder,
    customRatings,
    ratingSources,
    separateRatings,
    separateRatingsStyle,
    separateBadgeScale,
    separateBadgeOffsetX,
    separateBadgeOffsetY,
    logoScale,
    logoOffsetX,
    logoOffsetY,
    topBadgeScale,
    topBadgeOffsetX,
    topBadgeOffsetY,
    extraBadgeScale,
    extraBadgeOffsetX,
    extraBadgeOffsetY,
    genreBadgeScale,
    qualityBadgeScale,
    genreBadgeOffsetX,
    genreBadgeOffsetY,
    qualityBadgeOffsetX,
    qualityBadgeOffsetY,
    networkLogoScale,
    networkLogoOffsetX,
    networkLogoOffsetY,
    networkLogoFollowTitle,
    networkFixedX: networkFixed.x,
    networkFixedY: networkFixed.y,
    queryExtra,
    qNetLogo,
    networkLogo,
    networkLogoPosition,
    ribbonSide,
    ribbonEnabled,
    rankingBadgeAccent,
    preRelease,
    posterShape,
    posterLayout,
    posterFreshScope,
    logoAlign,
    hideLogo,
  }
}
