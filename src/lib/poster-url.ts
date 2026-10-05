import { getDomain } from "./utils"
import { resolveLabel, isRankKey, t as tFn } from "./i18n"
import { getPosterPublicBaseUrl } from "./poster-public-url"
import { buildStremioPosterSearchParams } from "./stremio-poster-params"
import { isManualAccent } from "./accent-color"
import { RENDER_VERSION } from "./render-version"
import { isValidWikidataQid } from "./badge-labels"
import { TOP_LIGHT_LUMINANCE } from "./constants"
import { hexLuminance, computeBottomLight } from "./accent-color"
import { normalizeGenreName } from "./genre-normalize"
import type { SearchResult, TMDBImage } from "./types"
import type { EnrichedAnimeItem } from "./validation"
import type { BadgeStyle, RankingBadgeStyle, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle } from "./badge-styles"
import { getSeparateBadgeDefaultScale } from "./badge-styles"
import type { VideoFormat } from "./av-specs"
import type { PosterShape, NetworkLogoPosition } from "./types"
import { BADGE_PRESET_ID_RE, BADGE_PRESET_REV_RE } from "./badge-preset"
import type { DateFormat } from "./release-badge"

interface BadgeParams {
  globalBadges: boolean
  rankingBadges: boolean
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /** Font dei testi badge (default "inter" = resa storica). */
  badgeFont?: BadgeFont | null
  /** Stile icone del badge qualità (default "standard"). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /** Formati A/V abilitati (dv, atmos, imax, hdr, hdr10plus). */
  videoFormats?: VideoFormat[] | null
  /** Componenti del badge genere/rating: `false` emette `bg/by/br=0`. */
  badgeGenre?: boolean
  badgeYear?: boolean
  badgeRating?: boolean
  badgeQuality?: boolean
  /** Riga rating custom provider (display). `false` emette `cr=0`. */
  customRatings?: boolean
  ratingSources?: string[]
  /** Colonna rating separati. Emessa sempre esplicita in preview (`sep=0/1`, WYSIWYG). */
  separateRatings?: boolean
  /**
   * Layout dei rating separati. Sempre esplicito in preview (`sepstyle=…`,
   * default "column"): senza, un mapping salvato bottom scavalcerebbe la
   * scelta editor (desync WYSIWYG).
   */
  separateRatingsStyle?: SeparateRatingsStyle | null
  customBadge: string | null
  badgePresetId?: string | null
  badgePresetRev?: string | null
  /** Formato data badge "in uscita" (default `locale` = segue la lingua). */
  dateFormat?: DateFormat | null
  gradientHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  blurEnabled: boolean
  /** Intensità tinta di scena 0-100 (default 20 quando omesso). */
  tintStrength?: number
  /** Ombra lineare superiore 0-100 (default 0 = spenta). */
  topShade?: number
  /** Scala % + offset px del badge superiore (solo stili centrati per gli offset). */
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  /** Scala % del badge genere/rating in basso. */
  genreBadgeScale: number
  /** Offset px del badge genere/rating, solo stili non-bar. */
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  /** Scala % del badge qualità streaming. */
  qualityBadgeScale: number
  /** Scala % dei rating separati (default unico 130 per tutti gli stili). */
  separateBadgeScale?: number | null
  /** Offset px del badge qualità. */
  qualityBadgeOffsetX: number
  qualityBadgeOffsetY: number
  /** Scala % del logo network. */
  networkLogoScale: number
  /** Offset px del logo network. */
  networkLogoOffsetX: number
  networkLogoOffsetY: number
  networkLogo?: boolean
  /** Ancoraggio orizzontale del logo network (preview WYSIWYG, sempre esplicito). */
  networkLogoPosition?: NetworkLogoPosition
  /** Effetto pre-digitale (darken + Coming Soon, solo film). Default OFF. */
  preRelease?: boolean
  ribbonSide?: "left" | "right"
  /** Nastro stile Netflix all'angolo (false = badge classifica centrato). */
  ribbonEnabled?: boolean
  /** Formato canvas del poster in editing (preview WYSIWYG). */
  posterShape?: PosterShape
  /** Allineamento blocco logo/metadati in editing (preview WYSIWYG). */
  logoAlign?: "left" | "center"
}

interface PosterState {
  selected: SearchResult | null
  previewPoster: TMDBImage | null
  selectedLogo: TMDBImage | null
  selectedBackdrop: TMDBImage | null
  logoScale: number
  logoOffsetX: number
  logoOffsetY: number
  backdropScale: number
  backdropOffsetX: number
  backdropOffsetY: number
  metaInfo: {
    genres: { id: number; name: string }[]
    voteAverage: number
    release_date?: string
    first_air_date?: string
    awards?: string[]
    nominations?: string[]
    studios?: string[]
    franchise?: string | null
    director?: string | null
    keywords?: string[]
    type?: string
    status?: string
    imdb_id?: string | null
    /** QID Wikidata dai details (fast-path REST awards in preview). */
    wikidata_id?: string | null
  }
  trendRank: number | null
  mdblistAnimeList: EnrichedAnimeItem[]
  topEdgeColor: string | null
  bottomEdgeColor?: string | null
  accentColor?: string | null
  /** Colore auto-rilevato dal thumb client: se coincide con accentColor, `ac=` non si emette. */
  autoAccentColor?: string | null
  lang: string
  region?: string
  /** Formato data badge "in uscita" (preview sempre esplicita, WYSIWYG). */
  dateFormat?: DateFormat | null
  tmdbKey: string
  /** Namespace utente (multi-user): emesso come `u=` così la preview rende il mapping del namespace. */
  userId?: string | null
}

export function buildUrlPattern(bp: BadgeParams & {
  tmdbKey: string
  lang: string
  mdblistApiKey?: string
  /** Namespace utente (multi-user): emesso come `u=` nel template. */
  userId?: string | null
  /**
   * Config token firmato (solo spazi senza namespace): porta cataloghi e
   * selezione Top 20 del device dove i defaults di spazio non bastano.
   * Assente ovunque altrove (template byte-identici a prima).
   */
  configToken?: string | null
  /** Namespace con chiavi server-side: omette le chiavi dal template (il
   *  server le risolve da namespace via `u=`) invece di incollarle in chiaro. */
  omitApiKey?: boolean
  omitMdblistKey?: boolean
  /** Placeholder id nel path: `{tmdb_id}` (primario, esatto: niente /find),
   *  `{imdb_id}` (fallback universale) o `{tmdb_id|imdb_id}` (auto: il
   *  consumer — es. Nuvio — sostituisce quello disponibile per la vista,
   *  altrimenti tiene il poster originale). Default `{imdb_id}` (invariato). */
  idPlaceholder?: "{imdb_id}" | "{tmdb_id}" | "{tmdb_id|imdb_id}"
  /** Placeholder formato Nuvio in query: con `"{shape}"` il `shape` fisso
   *  viene sostituito da `shape={shape}` letterale (Nuvio lo sostituisce con
   *  `poster`/`landscape`/`square` per vista e abilita gli override
   *  landscape + backdrop in Continue Watching). Default assente (invariato:
   *  `shape` fisso o omesso come prima). */
  shapePlaceholder?: "{shape}"
  /**
   * Template "Segui il mio spazio": omette tutti i valori visuali (anche
   * lingua e shape fisso) così il server li risolve dallo spazio salvato.
   * Restano identità (`u`), placeholder id, chiavi per policy e `live=1`.
   * La variante Nuvio conserva `shape={shape}` (formato dalla vista client).
   * Default assente = template fisso attuale (invariato).
   */
  followSpace?: boolean
}): string {
  let url = `${getPosterPublicBaseUrl()}/api/poster/{type}/${bp.idPlaceholder ?? "{imdb_id}"}`
  if (bp.followSpace) {
    const params = buildStremioPosterSearchParams({
      user: bp.userId ?? undefined,
      config: bp.configToken ?? undefined,
      followSpace: true,
    })
    if (!bp.omitApiKey && bp.tmdbKey) params.set("api_key", bp.tmdbKey)
    if (!bp.omitMdblistKey && bp.mdblistApiKey) params.set("mdblist_key", bp.mdblistApiKey)
    if (bp.shapePlaceholder === "{shape}") {
      params.delete("shape")
      params.set("shape", "{shape}")
    }
    const str = params.toString().replace(/shape=%7Bshape%7D/gi, "shape={shape}")
    if (str) url += "?" + str
    return url
  }
  const params = buildStremioPosterSearchParams({
    lang: bp.lang,
    user: bp.userId ?? undefined,
    config: bp.configToken ?? undefined,
    globalBadges: bp.globalBadges,
    rankingBadges: bp.rankingBadges,
    badgeGenre: bp.badgeGenre,
    badgeYear: bp.badgeYear,
    badgeRating: bp.badgeRating,
    badgeQuality: bp.badgeQuality,
    customRatings: bp.customRatings,
    ratingSources: bp.ratingSources,
    separateRatings: bp.separateRatings,
    separateRatingsStyle: bp.separateRatingsStyle ?? undefined,
    badgeStyle: bp.badgeStyle,
    rankingBadgeStyle: bp.rankingBadgeStyle,
    badgeFont: bp.badgeFont ?? undefined,
    qualityBadgeStyle: bp.qualityBadgeStyle,
    gradientHeight: bp.gradientHeight,
    blurIntensity: bp.blurIntensity,
    blurFade: bp.blurFade,
    blurDarkness: bp.blurDarkness,
    blurEnabled: bp.blurEnabled,
    tintStrength: bp.tintStrength,
    topShade: bp.topShade,
    networkLogo: bp.networkLogo,
    networkLogoPosition: bp.networkLogoPosition,
    preRelease: bp.preRelease,
    ribbonSide: bp.ribbonSide,
    ribbonEnabled: bp.ribbonEnabled,
    posterShape: bp.posterShape,
    logoAlign: bp.logoAlign,
    topBadgeScale: bp.topBadgeScale,
    topBadgeOffsetX: bp.topBadgeOffsetX,
    topBadgeOffsetY: bp.topBadgeOffsetY,
    genreBadgeScale: bp.genreBadgeScale,
    qualityBadgeScale: bp.qualityBadgeScale,
    separateBadgeScale: bp.separateBadgeScale ?? undefined,
    genreBadgeOffsetX: bp.genreBadgeOffsetX,
    genreBadgeOffsetY: bp.genreBadgeOffsetY,
    qualityBadgeOffsetX: bp.qualityBadgeOffsetX,
    qualityBadgeOffsetY: bp.qualityBadgeOffsetY,
    networkLogoScale: bp.networkLogoScale,
    networkLogoOffsetX: bp.networkLogoOffsetX,
    networkLogoOffsetY: bp.networkLogoOffsetY,
    dateFormat: bp.dateFormat ?? undefined,
  })
  // Template che l'utente copia per sé (come la manifest URL con chiavi):
  // qui le chiavi sono volute — Stremio non invia header custom, quindi il
  // server le legge dalla query al momento del render. Mai nei poster URL
  // serviti (vedi stremio-poster-params.ts). Con namespace multi-user che ha
  // chiavi server-side, `u=` basta e le chiavi restano fuori dal DB di terzi.
  if (!bp.omitApiKey && bp.tmdbKey) params.set("api_key", bp.tmdbKey)
  if (!bp.omitMdblistKey && bp.mdblistApiKey) params.set("mdblist_key", bp.mdblistApiKey)
  if (bp.shapePlaceholder === "{shape}") {
    // Template Nuvio a formato automatico: UN SOLO `shape={shape}` letterale,
    // mai il valore fisso (né duplicati). `URLSearchParams` codificherebbe le
    // parentesi (%7B…%7D) — ripristinate sotto SOLO per questo placeholder.
    params.delete("shape")
    params.set("shape", "{shape}")
  }
  const str = params.toString().replace(/shape=%7Bshape%7D/gi, "shape={shape}")
  if (str) url += "?" + str
  return url
}

export function buildPreviewUrl(ps: PosterState, bp: BadgeParams, configToken?: string | null): string {
  if (!ps.selected) return ""
  const params: string[] = [`rv=${RENDER_VERSION}`]
  // Namespace utente: la preview WYSIWYG deve leggere il mapping del
  // namespace, altrimenti mostra il poster globale (desync).
  if (ps.userId) params.push(`u=${ps.userId}`)
  // Config token (solo spazi senza namespace, mai altrove): porta cataloghi e
  // selezione Top 20 del device dove i defaults di spazio non bastano.
  if (configToken) params.push(`config=${encodeURIComponent(configToken)}`)
  if (ps.tmdbKey) params.push(`api_key=${encodeURIComponent(ps.tmdbKey)}`)
  params.push(`badges=${bp.globalBadges ? "1" : "0"}`)
  params.push(`ranking=${bp.rankingBadges ? "1" : "0"}`)
  params.push(`bg=${bp.badgeGenre !== false ? "1" : "0"}`)
  params.push(`by=${bp.badgeYear !== false ? "1" : "0"}`)
  params.push(`br=${bp.badgeRating !== false ? "1" : "0"}`)
  params.push(`bq=${bp.badgeQuality !== false ? "1" : "0"}`)
  // cr SEMPRE esplicito in preview (ON e OFF): senza, un mapping salvato con
  // customRatings=false scavalcerebbe il toggle editor (desync WYSIWYG).
  params.push(`cr=${bp.customRatings === false ? "0" : "1"}`)
  params.push(`sep=${bp.separateRatings ? "1" : "0"}`)
  params.push(`sepstyle=${bp.separateRatingsStyle ?? "column"}`)
  if (bp.ratingSources && bp.ratingSources.length > 0) params.push(`rsrc=${encodeURIComponent(bp.ratingSources.join(","))}`)
  if (ps.previewPoster) {
    params.push(`poster=${encodeURIComponent(ps.previewPoster.file_path)}`)
    const genre = normalizeGenreName(ps.metaInfo.genres[0]?.name, ps.lang)
    if (genre) params.push(`genreName=${encodeURIComponent(genre)}`)
    // Un decimale come il badge (`toFixed(1)` nel renderer): la media grezza
    // può essere un float lungo (es. 7.080000000000001) che supera il bound
    // anti-flood della query e fa rispondere 400 al poster.
    if (ps.metaInfo.voteAverage > 0 && Number.isFinite(ps.metaInfo.voteAverage)) {
      params.push(`voteAverage=${ps.metaInfo.voteAverage.toFixed(1)}`)
    }
    // Fix M1: l'anno della preview — senza, il server non imposta
    // releaseDate/firstAirDate nel ramo query e il badge genere della preview
    // omette "• 2024" che compare invece sul poster finale.
    const year = ps.metaInfo.release_date?.slice(0, 4) || ps.metaInfo.first_air_date?.slice(0, 4) || ps.selected?.release_date?.slice(0, 4) || ps.selected?.first_air_date?.slice(0, 4)
    if (year) params.push(`year=${year}`)
    // Date complete per il rilevamento pre-digitale: l'anno da solo diventa
    // `${y}-01-01` sul server e cade fuori dalla finestra theatrical (desync
    // preview/finale). Formato TMDB YYYY-MM-DD, solo se valido.
    const fullRd = ps.metaInfo.release_date || ps.selected?.release_date
    if (/^\d{4}-\d{2}-\d{2}$/.test(fullRd || "")) params.push(`rd=${fullRd}`)
    const fullFad = ps.metaInfo.first_air_date || ps.selected?.first_air_date
    if (/^\d{4}-\d{2}-\d{2}$/.test(fullFad || "")) params.push(`fad=${fullFad}`)
    const imdbId = ps.metaInfo.imdb_id || ps.selected.imdb_id
    if (imdbId) params.push(`imdbId=${encodeURIComponent(imdbId)}`)
    // QID Wikidata per il fast-path REST awards: il client lo ha già dai
    // details (zero RTT extra). Validato qui e di nuovo sul server: senza,
    // la preview cade nella lotteria SPARQL (Dexter: Emmy a intermittenza).
    const wikidataId = ps.metaInfo.wikidata_id
    if (isValidWikidataQid(wikidataId)) params.push(`wikidata_id=${wikidataId}`)
    // Titolo per il match JustWatch (rilevamento pre-digitale + qualità):
    // senza, il server ripiega su genreName ("Avventura") e il match per
    // tmdbId fallisce sempre.
    const title = ps.selected?.title || ps.selected?.name
    if (title) params.push(`title=${encodeURIComponent(title)}`)
  }
  // Logo sopra il clean; in landscape la base è il backdrop (senza testo),
  // quindi il logo resta anche se il poster verticale non è clean. In
  // portrait invariato: mai logo sopra un poster con testo incorporato.
  if (ps.selectedLogo && (ps.previewPoster?.iso_639_1 === null || bp.posterShape === "landscape")) {
    params.push(`logo=${encodeURIComponent(ps.selectedLogo.file_path)}`)
    params.push(`scale=${ps.logoScale}`)
    params.push(`ox=${ps.logoOffsetX}`)
    params.push(`oy=${ps.logoOffsetY}`)
  }
  if (ps.selectedBackdrop) {
    params.push(`backdrop=${encodeURIComponent(ps.selectedBackdrop.file_path)}`)
    params.push(`bscale=${ps.backdropScale}`)
    params.push(`box=${ps.backdropOffsetX}`)
    params.push(`boy=${ps.backdropOffsetY}`)
  }
  if (ps.lang) params.push(`lang=${ps.lang}`)
  if (ps.region) params.push(`region=${encodeURIComponent(ps.region)}`)
  // SEMPRE esplicito in preview (come badges/ranking/cr): senza, un default
  // salvato diverso scavalcerebbe la scelta editor (desync WYSIWYG).
  params.push(`df=${ps.dateFormat ?? "locale"}`)
  params.push(`gradHeight=${bp.gradientHeight}`)
  params.push(`blur=${bp.blurIntensity}`)
  params.push(`bf=${bp.blurFade}`)
  params.push(`bd=${bp.blurDarkness}`)
  params.push(`tint=${bp.tintStrength ?? 20}`)
  params.push(`ts=${bp.topShade ?? 50}`)
  params.push(`bs=${bp.badgeStyle}`)
  params.push(`rs=${bp.rankingBadgeStyle}`)
  // Font badge SEMPRE esplicito in preview (come bs/rs): senza, un mapping
  // salvato con font diverso scavalcerebbe la scelta editor (desync WYSIWYG).
  params.push(`bfont=${bp.badgeFont ?? "inter"}`)
  // Stile icone qualità SEMPRE esplicito in preview (come bs/rs): senza, un
  // mapping salvato con stile diverso scavalcerebbe la scelta editor (desync).
  params.push(`qbs=${bp.qualityBadgeStyle === "mono" || bp.qualityBadgeStyle === "color" ? bp.qualityBadgeStyle : "standard"}`)
  if (bp.videoFormats !== undefined && bp.videoFormats !== null) {
    params.push(`formats=${bp.videoFormats.length === 0 ? "none" : bp.videoFormats.join(",")}`)
  }
  params.push(`tscale=${bp.topBadgeScale}`)
  params.push(`tox=${bp.topBadgeOffsetX}`)
  params.push(`toy=${bp.topBadgeOffsetY}`)
  params.push(`gscale=${bp.genreBadgeScale}`)
  params.push(`gox=${bp.genreBadgeOffsetX}`)
  params.push(`goy=${bp.genreBadgeOffsetY}`)
  params.push(`qscale=${bp.qualityBadgeScale}`)
  params.push(`sepscale=${bp.separateBadgeScale ?? getSeparateBadgeDefaultScale(bp.separateRatingsStyle)}`)
  params.push(`qox=${bp.qualityBadgeOffsetX}`)
  params.push(`qoy=${bp.qualityBadgeOffsetY}`)
  params.push(`netscale=${bp.networkLogoScale}`)
  params.push(`nox=${bp.networkLogoOffsetX}`)
  params.push(`noy=${bp.networkLogoOffsetY}`)
  // SEMPRE esplicito in preview (come badges/ranking/cr): senza, un mapping
  // salvato con blurEnabled=false scavalcerebbe il toggle editor (desync WYSIWYG).
  params.push(`be=${bp.blurEnabled ? "1" : "0"}`)
  params.push(`netLogo=${bp.networkLogo !== false ? "1" : "0"}`)
  // SEMPRE esplicito (come ribbon/side): senza, un mapping salvato con
  // posizione forzata scavalcerebbe lo stato editor (desync WYSIWYG).
  params.push(`netPos=${bp.networkLogoPosition === "top" ? "top" : "auto"}`)
  if (bp.preRelease) params.push("pre=1")
  // Fix M2: side viene emesso SEMPRE (left|right) — prima soltanto "right";
  // senza il parametro il server risolve dal mapping/config salvati (di
  // default right in modalità Stremio) e la preview rendeva a destra anche
  // quando l'editor mostra lo stato sinistra.
  if (bp.ribbonSide) params.push(`side=${bp.ribbonSide}`)
  // SEMPRE esplicito (come badges/ranking/cr): senza, un mapping salvato con
  // ribbonEnabled=false scavalcerebbe il toggle editor (desync WYSIWYG).
  params.push(`ribbon=${bp.ribbonEnabled === false ? "0" : "1"}`)
  // Shape SEMPRE esplicito in preview (come badges/ranking/cr): senza, un
  // mapping salvato con shape diversa scavalcerebbe il toggle editor (desync
  // WYSIWYG) — vedi catena query > mapping > config > defaults.
  params.push(`shape=${bp.posterShape === "landscape" ? "landscape" : "poster"}`)
  // Align in preview: rilevante solo per il layout landscape (i portrait
  // restano sempre centrati per contratto).
  if (bp.posterShape === "landscape") {
    params.push(`align=${bp.logoAlign === "left" ? "left" : "center"}`)
  }
  // `ac=` solo su scelta manuale: l'auto-rilevamento scrive lo stesso valore
  // in accentColor a ogni cambio poster, e un override sempre presente
  // scavalcerebbe il calcolo server (tinta di scena) nella preview.
  const manualAccent = isManualAccent(ps.accentColor, ps.autoAccentColor) ? ps.accentColor : null
  if (manualAccent) params.push(`ac=${encodeURIComponent(manualAccent)}`)
  // Fix M16: tl è inviato SOLO a calcolo completato: con topEdgeColor null
  // (colore non ancora campionato) la preview forzava tl=1 (testo chiaro)
  // anche quando il server avrebbe calcolato scuro — ora il server decide.
  const topLight = computeTopLight(ps.topEdgeColor)
  if (topLight !== null) params.push(`tl=${topLight ? "1" : "0"}`)
  // bl come tl (regola M16): solo a calcolo completato, altrimenti decide il
  // server. Senza, la preview forzava la polarità del badge genere sul top
  // anche con fondo scuro. La correzione blur viaggia nei stessi bp del render.
  const bottomLight = computeBottomLight(hexLuminance(ps.bottomEdgeColor ?? null), bp.blurDarkness, bp.blurEnabled)
  if (bottomLight !== null) params.push(`bl=${bottomLight ? "1" : "0"}`)
  if (bp.rankingBadges) {
    const badgeParams = computeBadgeParams(ps, bp)
    params.push(...badgeParams)
    // WYSIWYG: il client conosce già il rank anime dal suo mdblistAnimeList;
    // senza questo parametro la preview non può calcolarlo (la URL non porta
    // chiavi/profilo) e il badge Anime non comparirebbe nella preview.
    const selected = ps.selected
    const animeRank = selected
      ? (ps.mdblistAnimeList.find((a) => a.id === selected.id)?.rank ?? null)
      : null
    if (animeRank) params.push(`animerank=${animeRank}`)
  } else if (bp.customBadge) {
    const badgeParams = computeBadgeParams(ps, bp)
    params.push(...badgeParams)
  }
  if (bp.badgePresetId && BADGE_PRESET_ID_RE.test(bp.badgePresetId)) {
    params.push(`badgePreset=${encodeURIComponent(bp.badgePresetId)}`)
    if (bp.badgePresetRev && BADGE_PRESET_REV_RE.test(bp.badgePresetRev)) {
      params.push(`prv=${encodeURIComponent(bp.badgePresetRev)}`)
    }
  }
  params.push("preview=1")
  const qs = "?" + params.join("&")
  return `${getDomain()}/api/poster/${ps.selected.media_type}/${ps.selected.id}${qs}`
}

/**
 * Top-light della preview. Ritorna `null` quando il colore non è ancora stato
 * campionato (topEdgeColor null): in quel caso il parametro tl viene OMESSO e
 * decide il server (calcolo sull'immagine reale). Formula Rec.709 sugli stessi
 * coefficienti del server (image-utils.luma) e soglia condivisa
 * TOP_LIGHT_LUMINANCE (fix M16): prima i byte sRGB venivano confrontati con
 * una soglia hardcoded e il null diventava true (testo chiaro forzato).
 */
function computeTopLight(hexColor: string | null): boolean | null {
  if (!hexColor || hexColor.length < 7) return null
  const r = parseInt(hexColor.slice(1, 3), 16) / 255
  const g = parseInt(hexColor.slice(3, 5), 16) / 255
  const b = parseInt(hexColor.slice(5, 7), 16) / 255
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > TOP_LIGHT_LUMINANCE
}

function computeBadgeParams(ps: PosterState, bp: BadgeParams): string[] {
  const params: string[] = []
  if (bp.customBadge) {
    const selected = ps.selected
    const animeRank = selected && ps.mdblistAnimeList.length > 0
      ? (ps.mdblistAnimeList.find((a) => a.id === selected.id)?.rank ?? null) : null
    const rankKey = isRankKey(bp.customBadge)
    const rankLabelKey = ps.selected?.media_type === "tv" ? "badge.series" : "badge.movie"
    if ((rankKey === "badge.today" || rankKey === "badge.movie" || rankKey === "badge.series") && ps.trendRank) params.push(`rank=${ps.trendRank}&label=${encodeURIComponent(tFn(rankLabelKey))}`)
    else if (rankKey === "badge.anime" && animeRank) params.push(`rank=${animeRank}&label=${encodeURIComponent(tFn("badge.anime"))}`)
    else params.push(`extra=${encodeURIComponent(resolveLabel(bp.customBadge))}`)
  }
  // For auto badges, let the server compute from its own TMDB data
  return params
}

export interface DefaultsPreviewParams {
  defaultLogoScale?: number | null
  defaultLogoOffsetX?: number | null
  defaultLogoOffsetY?: number | null
  tmdbKey?: string
  userId?: string | null
  lang?: string
  defaultGlobalBadges?: boolean
  defaultRankingBadges?: boolean
  defaultBadgeGenre?: boolean
  defaultBadgeYear?: boolean
  defaultBadgeRating?: boolean
  defaultBadgeQuality?: boolean
  defaultCustomRatings?: boolean
  defaultSeparateRatings?: boolean
  defaultSeparateRatingsStyle?: SeparateRatingsStyle | null
  defaultRatingSources?: string[]
  defaultBadgeStyle?: BadgeStyle
  defaultRankingBadgeStyle?: RankingBadgeStyle
  defaultBadgeFont?: BadgeFont | null
  defaultQualityBadgeStyle?: QualityBadgeStyle | null
  defaultVideoFormats?: readonly VideoFormat[] | null
  defaultBlurEnabled?: boolean
  defaultBlurIntensity?: number
  defaultBlurFade?: number
  defaultBlurDarkness?: number
  defaultTintStrength?: number
  defaultTopShade?: number
  defaultGradientHeight?: number
  defaultTopBadgeScale?: number
  defaultTopBadgeOffsetX?: number
  defaultTopBadgeOffsetY?: number
  defaultGenreBadgeScale?: number
  defaultGenreBadgeOffsetX?: number
  defaultGenreBadgeOffsetY?: number
  defaultQualityBadgeScale?: number
  defaultSeparateBadgeScale?: number | null
  defaultQualityBadgeOffsetX?: number
  defaultQualityBadgeOffsetY?: number
  defaultNetworkLogoScale?: number
  defaultNetworkLogoOffsetX?: number
  defaultNetworkLogoOffsetY?: number
  defaultNetworkLogo?: boolean
  defaultNetworkLogoPosition?: NetworkLogoPosition
  defaultRibbonEnabled?: boolean
  defaultRibbonSide?: "left" | "right"
  defaultPosterShape?: PosterShape
  defaultLogoAlign?: "left" | "center" | null
  defaultDateFormat?: DateFormat | null
  defaultRegion?: string
}

export const DEFAULTS_PREVIEW_DEMO_MEDIA = {
  mediaType: "movie",
  id: 19995,
} as const

export function buildDefaultsPreviewUrl(bp: DefaultsPreviewParams): string {
  const params: string[] = [`rv=${RENDER_VERSION}`, "preview=1"]
  if (bp.tmdbKey) params.push(`api_key=${encodeURIComponent(bp.tmdbKey)}`)
  if (bp.userId) params.push(`u=${encodeURIComponent(bp.userId)}`)
  // Explicit zero restores automatic sizing/no offset instead of inheriting a saved override.
  params.push(`scale=${bp.defaultLogoScale ?? 0}`)
  params.push(`ox=${bp.defaultLogoOffsetX ?? 0}`)
  params.push(`oy=${bp.defaultLogoOffsetY ?? 0}`)
  params.push(`badges=${bp.defaultGlobalBadges !== false ? "1" : "0"}`)
  params.push(`ranking=${bp.defaultRankingBadges !== false ? "1" : "0"}`)
  params.push(`bg=${bp.defaultBadgeGenre !== false ? "1" : "0"}`)
  params.push(`by=${bp.defaultBadgeYear !== false ? "1" : "0"}`)
  params.push(`br=${bp.defaultBadgeRating !== false ? "1" : "0"}`)
  params.push(`bq=${bp.defaultBadgeQuality !== false ? "1" : "0"}`)
  params.push(`cr=${bp.defaultCustomRatings === false ? "0" : "1"}`)
  params.push(`sep=${bp.defaultSeparateRatings ? "1" : "0"}`)
  params.push(`sepstyle=${bp.defaultSeparateRatingsStyle ?? "column"}`)
  if (bp.defaultRatingSources && bp.defaultRatingSources.length > 0) {
    params.push(`rsrc=${encodeURIComponent(bp.defaultRatingSources.join(","))}`)
  }
  params.push(`bs=${bp.defaultBadgeStyle ?? "shadow"}`)
  params.push(`rs=${bp.defaultRankingBadgeStyle ?? "default"}`)
  params.push(`bfont=${bp.defaultBadgeFont ?? "inter"}`)
  params.push(`qbs=${bp.defaultQualityBadgeStyle === "mono" || bp.defaultQualityBadgeStyle === "color" ? bp.defaultQualityBadgeStyle : "standard"}`)
  if (bp.defaultVideoFormats !== undefined && bp.defaultVideoFormats !== null) {
    params.push(`formats=${bp.defaultVideoFormats.length === 0 ? "none" : bp.defaultVideoFormats.join(",")}`)
  }
  params.push(`gradHeight=${bp.defaultGradientHeight ?? 30}`)
  params.push(`blur=${bp.defaultBlurIntensity ?? 20}`)
  params.push(`bf=${bp.defaultBlurFade ?? 50}`)
  params.push(`bd=${bp.defaultBlurDarkness ?? 30}`)
  params.push(`be=${bp.defaultBlurEnabled !== false ? "1" : "0"}`)
  params.push(`tint=${bp.defaultTintStrength ?? 20}`)
  params.push(`ts=${bp.defaultTopShade ?? 50}`)
  params.push(`tscale=${bp.defaultTopBadgeScale ?? 100}`)
  params.push(`tox=${bp.defaultTopBadgeOffsetX ?? 0}`)
  params.push(`toy=${bp.defaultTopBadgeOffsetY ?? 0}`)
  params.push(`gscale=${bp.defaultGenreBadgeScale ?? 100}`)
  params.push(`gox=${bp.defaultGenreBadgeOffsetX ?? 0}`)
  params.push(`goy=${bp.defaultGenreBadgeOffsetY ?? 0}`)
  params.push(`qscale=${bp.defaultQualityBadgeScale ?? 100}`)
  params.push(`sepscale=${bp.defaultSeparateBadgeScale ?? getSeparateBadgeDefaultScale(bp.defaultSeparateRatingsStyle)}`)
  params.push(`qox=${bp.defaultQualityBadgeOffsetX ?? 0}`)
  params.push(`qoy=${bp.defaultQualityBadgeOffsetY ?? 0}`)
  params.push(`netscale=${bp.defaultNetworkLogoScale ?? 100}`)
  params.push(`nox=${bp.defaultNetworkLogoOffsetX ?? 0}`)
  params.push(`noy=${bp.defaultNetworkLogoOffsetY ?? 0}`)
  params.push(`netLogo=${bp.defaultNetworkLogo !== false ? "1" : "0"}`)
  params.push(`netPos=${bp.defaultNetworkLogoPosition === "top" ? "top" : "auto"}`)
  params.push(`ribbon=${bp.defaultRibbonEnabled === false ? "0" : "1"}`)
  if (bp.defaultRibbonSide) params.push(`side=${bp.defaultRibbonSide}`)
  params.push(`shape=${bp.defaultPosterShape === "landscape" ? "landscape" : "poster"}`)
  if (bp.defaultPosterShape === "landscape" && bp.defaultLogoAlign) {
    params.push(`align=${bp.defaultLogoAlign === "left" ? "left" : "center"}`)
  }
  if (bp.lang) params.push(`lang=${encodeURIComponent(bp.lang)}`)
  if (bp.defaultRegion) params.push(`region=${encodeURIComponent(bp.defaultRegion)}`)
  if (bp.defaultDateFormat) params.push(`df=${bp.defaultDateFormat}`)

  const qs = "?" + params.join("&")
  return `${getDomain()}/api/poster/${DEFAULTS_PREVIEW_DEMO_MEDIA.mediaType}/${DEFAULTS_PREVIEW_DEMO_MEDIA.id}${qs}`
}
