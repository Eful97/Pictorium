import { getDomain } from "./utils"
import {
  resolveEffectiveNetworkFollow,
  resolveLandscapeNetworkOffsets,
  resolveNetworkFixedCoords,
  resolveNetworkFollowTitle,
} from "./network-follow"
import { resolveLabel, isRankKey, t as tFn } from "./i18n"
import { getPosterPublicBaseUrl } from "./poster-public-url"
import { buildStremioPosterSearchParams } from "./stremio-poster-params"
import { normalizeSeasonalTheme, resolveEffectiveSeasonalTheme } from "./seasonal-theme"
import { isManualAccent } from "./accent-color"
import { RENDER_VERSION } from "./render-version"
import { isValidWikidataQid } from "./badge-labels"
import { TOP_LIGHT_LUMINANCE } from "./constants"
import { hexLuminance, computeBottomLight } from "./accent-color"
import { normalizeGenreName } from "./genre-normalize"
import type { SearchResult, TMDBImage } from "./types"
import type { EnrichedAnimeItem } from "./validation"
import type { BadgeStyle, RankingBadgeStyle, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle, ExtraBadgeStyle, ExtraBadgeFollowRank } from "./badge-styles"
import type { AgeBadgeStyle } from "./badge-styles"
import { isAgeBadgeStyle } from "./badge-styles"
import { isExtraBadgeStyle, isExtraFollowRank } from "./badge-styles"
import { getSeparateBadgeDefaultScale, getSeparateRatingsStyleForShape, getQualityBadgeOffsetDefault, normalizeQualityBadgeStyleForTransport } from "./badge-styles"
import { canonicalizeBadgeItemTransforms } from "./badge-item-transforms"
import type { LandscapeServerDefaults } from "./server-defaults"
import { DEFAULT_SASH_ORDER, NEXT_EPISODE_BADGE_KEY, type SashBucket } from "./badge-priority"
import { sanitizeDisabledContentTags } from "./content-tags"
import { sanitizeDisabledNetworks } from "./network-keys"
import { normalizeLogoFont, sanitizeLogoText } from "./text-logo"
import type { VideoFormat } from "./av-specs"
import type { PosterShape, NetworkLogoPosition, PosterLayout, PosterFreshScope } from "./types"
import { isPosterLayout } from "./types"
import type { DateFormat } from "./release-badge"

interface BadgeParams {
  globalBadges: boolean
  rankingBadges: boolean
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /** Standalone extra-badge style: emitted as `xbs` only when defined (incl. "follow-rank" sentinel). */
  extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | null
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
  /** Badge età testuale: `false` emette `age=0` (default OFF). */
  ageBadge?: boolean
  /** Paese classificazione età: emesso come `agecountry=XX` (default "IT"). */
  ageCountry?: string | null
  /** Stile pill età: sempre esplicito in preview (`agebs=…`, default "standard"). */
  ageBadgeStyle?: AgeBadgeStyle | null
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
  /** Formato data badge "in uscita" (default `locale` = segue la lingua). */
  dateFormat?: DateFormat | null
  gradientHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  blurEnabled: boolean
  /** Intensità tinta di scena 0-100 (default 20 quando omesso). */
  tintStrength?: number
  /** Ombra lineare superiore 0-100 (default 50 = look corrente). */
  topShade?: number
  /**
   * Altezza dell'ombra superiore in % del canvas 0-100 (default 25 = look
   * storico). 0 = ombra disattivata qualunque sia `topShade`.
   */
  topShadeHeight?: number
  /** Scala % + offset px del badge superiore (solo stili centrati per gli offset). */
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  /**
   * Tuning EXTRA superiore (opt-in: assente = fallback legacy classifica,
   * URL invariati). B2 lo materializza all'edit classifica.
   */
  extraBadgeScale?: number | null
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  /** Scala % del badge genere/rating in basso. */
  genreBadgeScale: number
  /** Offset px del badge genere/rating, solo stili non-bar. */
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  /** Scala % del badge qualità streaming. */
  qualityBadgeScale: number
  /** Scala % dei rating separati (default unico 130 per tutti gli stili). */
  separateBadgeScale?: number | null
  /** Offset px del gruppo rating separati, colonna/pills (bar portrait: solo Y). Default 0. */
  separateBadgeOffsetX?: number | null
  /** Offset px del gruppo rating separati (negativo = su, positivo = giù). Default 0. */
  separateBadgeOffsetY?: number | null
  /**
   * Per-ITEM corrections of the badge groups (single rating pill / single
   * quality-AV mark) in canonical wire form. `undefined` (unspecified) leaves
   * the query absent for legacy callers; `null`/empty emits an EXPLICIT empty
   * `bit=`, which overrides the saved corrections with the automatic layout.
   */
  badgeItemTransforms?: string | null
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
  /**
   * Il network segue il titolo (preview WYSIWYG, esplicito quando definito:
   * assente = legacy invariato).
   */
  networkLogoFollowTitle?: boolean
  /** Effetto pre-digitale (darken + Coming Soon, solo film). Default OFF. */
  preRelease?: boolean
  ribbonSide?: "left" | "right"
  /** Nastro stile Netflix all'angolo (false = badge classifica centrato). */
  ribbonEnabled?: boolean
  /** Formato canvas del poster in editing (preview WYSIWYG). */
  posterShape?: PosterShape
  /**
   * Graphical poster layout in editing. Sempre esplicito in preview
   * (`layout=standard|fresh|provider-glass|nuvio|stremio`, default "standard"): senza, un mapping o un
   * default salvato fresh scavalcerebbe la scelta editor (desync WYSIWYG) —
   * e uno standard esplicito non prevarrebbe su un fresh ereditato.
   */
  posterLayout?: PosterLayout | null
  /**
   * Fresh apply scope in editing. Sempre esplicito in preview
   * (`freshScope=all|ranked`, default "ranked"): senza, un mapping o un
   * default salvato all scavalcerebbe la scelta editor (desync WYSIWYG) —
   * e un ranked esplicito non prevarrebbe su un all ereditato.
   */
  posterFreshScope?: PosterFreshScope | null
  /** Allineamento blocco logo/metadati in editing (preview WYSIWYG). */
  logoAlign?: "left" | "center"
  /**
   * Esclusioni automatiche space-wide (ID canonici, TMDB-fallback sentinel
   * incluso): SEMPRE esplicite in preview (`dct=`/`dnet=` vuoti quando lo
   * staged è vuoto), così lo staged vince sui default salvati; assenti
   * (null/undefined) = legacy senza parametro.
   */
  disabledContentTags?: readonly string[] | null
  /** Mark network disabilitati space-wide (stesso contratto di cui sopra). */
  disabledNetworks?: readonly string[] | null
}

interface PosterState {
  selected: SearchResult | null
  previewPoster: TMDBImage | null
  selectedLogo: TMDBImage | null
  /**
   * Logo testuale digitato (titoli senza logo TMDB): reso dal server con un
   * font del bundle. `ltext` vince sul logo immagine scelto (una sola
   * sorgente logo): svuotare il campo riporta il logo selezionato. Testo
   * vuoto/assente = nessun parametro (URL storici invariati).
   */
  logoText?: string | null
  /** Font del logo testuale: enum dei badge (allowlist server). */
  logoFont?: BadgeFont | null
  /**
   * Wordmark AUTOMATICO (titolo senza logo TMDB, base senza titolo cotto):
   * la preview viaggia con `lauto=1` e NON manda il testo — il server lo
   * deriva dal `title` con la stessa funzione del render Stremio, così il save
   * non eredita mai un wordmark automatico. Il testo digitato (`logoText`) e
   * il logo immagine hanno precedenza e spengono il flag.
   */
  autoWordmark?: boolean
  selectedBackdrop: TMDBImage | null
  logoScale: number
  /**
   * Provenance scala titolo (correzione c1): true = auto (la preview emette
   * il sentinel `scale=0` e il server risolve Fresh-100 vs aspect Standard in
   * base al rank mostrato; lo slider mostra comunque il valore auto risolto
   * col rank noto). False/assente = esplicito (preview emette il valore).
   * Contratto intenzionale: con Fresh selezionato ma fallback Standard il
   * controllo può offrire fino a 200 come preferenza, ma finché resta auto lo
   * Standard effettivo non cambia (solo un adjust esplicito lo muove).
   */
  logoScaleIsAuto?: boolean
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
  /**
   * Contesto effimero della lista di origine (nome lista/catalogo da cui il
   * titolo è stato aperto): emesso come `theme=<canonico>` solo quando il
   * nome contiene il match intero (vedi seasonal-theme.ts), su entrambi i
   * canvas (ognuno rende il proprio asset). Mai persistito: all'uscita o da
   * un'altra lista non-matching si azzera. La scelta per-titolo
   * (`seasonalThemeChoice`) vince sul contesto lista (vedi
   * resolveEffectiveSeasonalTheme).
   */
  seasonalTheme?: string | null
  /**
   * Scelta per-titolo della cornice in editing (flat unico, entrambe le
   * forme): `halloween`/`christmas` = esplicita (segue il titolo),
   * `none` = sopprime il contesto lista, null/assente = Automatico (segue
   * la lista). Solo la scelta esplicita viaggia in preview (come `theme=`);
   * `none`/Automatico senza contesto = nessun parametro (URL invariati).
   */
  seasonalThemeChoice?: unknown
  /**
   * Contesto effimero rank/region di lista (decisione A): `listRank` 0..100
   * viaggia come `rk=` (0 = unranked esplicito, invalido = assente legacy),
   * `listRegion` come override `region=` di selezione (paese chart). Mai
   * persistiti: all'uscita o da un'altra lista si azzerano (useNavigation).
   */
  listRank?: number | null
  listRegion?: string | null
  /**
   * Base del poster scelta dal SERVER (solo portrait, titolo senza poster
   * clean): senza `poster=` la preview lascia decidere al renderer unico,
   * che compone la base dal primo backdrop (crop 2:3) — gli stessi byte che
   * riceve Stremio. Gli hint derivati (`genreName`/`voteAverage`/`year`/…)
   * sono omessi con la base: senza override immagine li ricava il server.
   */
  previewBaseAuto?: boolean
  /**
   * Backdrop scelto live dall'editor per la base portrait 2:3 (`pbase`):
   * path TMDB clean. Il renderer unico croppa QUEL backdrop, come farà il
   * mapping salvato (`portraitBackdropPath`) dopo il save. Assente = base
   * automatica del server (primo clean) o base salvata.
   */
  portraitBasePath?: string | null
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
    ageBadge: bp.ageBadge ?? undefined,
    ageCountry: bp.ageCountry ?? undefined,
    // Stile pill età effettivo per-titolo (il chiamante passa il live del
    // titolo in editing o il default di forma senza titolo; il server
    // risolverebbe comunque lo stesso valore).
    ageBadgeStyle: bp.ageBadgeStyle ?? undefined,
    customRatings: bp.customRatings,
    ratingSources: bp.ratingSources,
    separateRatings: bp.separateRatings,
    separateRatingsStyle: bp.separateRatingsStyle ?? undefined,
    // Template Nuvio a formato dinamico: lo stile resta raw, normalizza il
    // server per formato effettivo (il portrait resta barra).
    shapeUnknown: bp.shapePlaceholder === "{shape}",
    badgeStyle: bp.badgeStyle,
    rankingBadgeStyle: bp.rankingBadgeStyle,
    extraBadgeStyle: bp.extraBadgeStyle ?? undefined,
    badgeFont: bp.badgeFont ?? undefined,
    qualityBadgeStyle: bp.qualityBadgeStyle,
    gradientHeight: bp.gradientHeight,
    blurIntensity: bp.blurIntensity,
    blurFade: bp.blurFade,
    blurDarkness: bp.blurDarkness,
    blurEnabled: bp.blurEnabled,
    tintStrength: bp.tintStrength,
    topShade: bp.topShade,
    topShadeHeight: bp.topShadeHeight,
    networkLogo: bp.networkLogo,
    networkLogoPosition: bp.networkLogoPosition,
    networkLogoFollowTitle: bp.networkLogoFollowTitle,
    preRelease: bp.preRelease,
    ribbonSide: bp.ribbonSide,
    ribbonEnabled: bp.ribbonEnabled,
    posterShape: bp.posterShape,
    logoAlign: bp.logoAlign,
    posterLayout: bp.posterLayout ?? undefined,
    posterFreshScope: bp.posterFreshScope ?? undefined,
    topBadgeScale: bp.topBadgeScale,
    topBadgeOffsetX: bp.topBadgeOffsetX,
    topBadgeOffsetY: bp.topBadgeOffsetY,
    extraBadgeScale: bp.extraBadgeScale ?? undefined,
    extraBadgeOffsetX: bp.extraBadgeOffsetX ?? undefined,
    extraBadgeOffsetY: bp.extraBadgeOffsetY ?? undefined,
    genreBadgeScale: bp.genreBadgeScale,
    qualityBadgeScale: bp.qualityBadgeScale,
    separateBadgeScale: bp.separateBadgeScale ?? undefined,
    separateBadgeOffsetX: bp.separateBadgeOffsetX ?? undefined,
    separateBadgeOffsetY: bp.separateBadgeOffsetY ?? undefined,
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
  // Badge età sempre esplicito in preview (ON e OFF): senza, un default
  // salvato ON scavalcerebbe il toggle editor (desync WYSIWYG, come `bq`).
  params.push(`age=${bp.ageBadge ? "1" : "0"}`)
  const ageCountry = (bp.ageCountry || "").trim().toUpperCase()
  params.push(`agecountry=${/^[A-Z]{2}$/.test(ageCountry) && ageCountry !== "GLOBAL" ? ageCountry : "IT"}`)
  // Stile pill età SEMPRE esplicito in preview (come bq/qbs): senza, un
  // default salvato knockout scavalcerebbe la scelta editor (desync WYSIWYG) —
  // e uno standard esplicito non prevarrebbe su un knockout ereditato.
  params.push(`agebs=${isAgeBadgeStyle(bp.ageBadgeStyle) ? bp.ageBadgeStyle : "standard"}`)
  // cr SEMPRE esplicito in preview (ON e OFF): senza, un mapping salvato con
  // customRatings=false scavalcerebbe il toggle editor (desync WYSIWYG).
  params.push(`cr=${bp.customRatings === false ? "0" : "1"}`)
  params.push(`sep=${bp.separateRatings ? "1" : "0"}`)
  // Preview WYSIWYG: stile normalizzato per formato (bar landscape → pills,
  // come il server — raw salvati intatti, mai mutati qui).
  params.push(`sepstyle=${getSeparateRatingsStyleForShape(bp.separateRatingsStyle ?? "column", bp.posterShape === "landscape" ? "landscape" : "poster")}`)
  if (bp.ratingSources && bp.ratingSources.length > 0) params.push(`rsrc=${encodeURIComponent(bp.ratingSources.join(","))}`)
  if (ps.previewPoster && !ps.previewBaseAuto) {
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
  // Logo manuale anche su portrait non-clean: se selezionato si emette
  // sempre (default nessun auto resta a monte). In landscape la base è il
  // backdrop (senza testo), quindi il logo resta anche senza poster clean.
  // Logo testuale (titoli senza logo TMDB): `ltext` vince sul logo immagine —
  // una sola sorgente logo, la stessa che il server usa per comporla. Testo
  // vuoto/blank = nessun parametro (URL storici invariati).
  const logoText = sanitizeLogoText(ps.logoText)
  if (logoText) {
    params.push(`ltext=${encodeURIComponent(logoText)}`)
    params.push(`lfont=${normalizeLogoFont(ps.logoFont)}`)
    params.push(`scale=${ps.logoScaleIsAuto ? 0 : ps.logoScale}`)
    params.push(`ox=${ps.logoOffsetX}`)
    params.push(`oy=${ps.logoOffsetY}`)
  } else if (ps.selectedLogo) {
    params.push(`logo=${encodeURIComponent(ps.selectedLogo.file_path)}`)
    // Auto (correzione c1): sentinel `scale=0` = auto-fit server-side (Fresh
    // effettivo = 100, fallback Standard = curva aspect). Mai un 100 baked:
    // i titoli Standard con Fresh selezionato senza rank restano aspect.
    // Espliciti (anche 75/100/150/200) viaggiano invariati.
    params.push(`scale=${ps.logoScaleIsAuto ? 0 : ps.logoScale}`)
    params.push(`ox=${ps.logoOffsetX}`)
    params.push(`oy=${ps.logoOffsetY}`)
  }
  // Wordmark automatico: flag unico, nessun testo. In base auto (`previewBaseAuto`)
  // la decisione è già del server (stesso ramo Stremio) e il flag sarebbe
  // inerte; con un logo immagine o un testo digitato non viaggia mai (stessa
  // precedenza del render: una sola sorgente logo).
  if (ps.autoWordmark && !ps.previewBaseAuto && !logoText && !ps.selectedLogo) params.push("lauto=1")
  if (ps.selectedBackdrop) {
    params.push(`backdrop=${encodeURIComponent(ps.selectedBackdrop.file_path)}`)
    params.push(`bscale=${ps.backdropScale}`)
    params.push(`box=${ps.backdropOffsetX}`)
    params.push(`boy=${ps.backdropOffsetY}`)
  }
  // Base portrait scelta live (picker backdrop): il server croppa QUEL
  // backdrop con lo stesso helper del ramo automatico, quindi la preview
  // mostra gli stessi byte che il mapping salvato renderà su Stremio.
  // Assente = base automatica/salvata (URL storici invariati).
  if (ps.portraitBasePath) params.push(`pbase=${encodeURIComponent(ps.portraitBasePath)}`)
  if (ps.lang) params.push(`lang=${ps.lang}`)
  // Region di selezione (paese chart della lista di origine) vince sul
  // default globale editor: la preview risolve lo stesso snapshot Stremio.
  // Rank di lista effimero (decisione A): 0..100 int come `rk=` solo a badge
  // di classifica abilitati (mai con ranking OFF: niente numero automatico
  // forzato); invalido = assente (legacy, nessun fetch skip).
  const previewRegion = (typeof ps.listRegion === "string" && ps.listRegion.trim().length > 0 ? ps.listRegion.trim() : null) ?? ps.region
  if (previewRegion) params.push(`region=${encodeURIComponent(previewRegion)}`)
  if (bp.rankingBadges && typeof ps.listRank === "number" && Number.isInteger(ps.listRank) && ps.listRank >= 0 && ps.listRank <= 100) {
    params.push(`rk=${ps.listRank}`)
  }
  // SEMPRE esplicito in preview (come badges/ranking/cr): senza, un default
  // salvato diverso scavalcerebbe la scelta editor (desync WYSIWYG).
  params.push(`df=${ps.dateFormat ?? "locale"}`)
  params.push(`gradHeight=${bp.gradientHeight}`)
  params.push(`blur=${bp.blurIntensity}`)
  params.push(`bf=${bp.blurFade}`)
  params.push(`bd=${bp.blurDarkness}`)
  params.push(`tint=${bp.tintStrength ?? 20}`)
  params.push(`ts=${bp.topShade ?? 50}`)
  params.push(`tsh=${bp.topShadeHeight ?? 25}`)
  params.push(`bs=${bp.badgeStyle}`)
  params.push(`rs=${bp.rankingBadgeStyle}`)
  // Standalone extra style: opt-in only (absent = legacy `rs` fallback,
  // existing preview URLs stay byte-identical). The explicit follow-rank
  // transport sentinel travels on ANY selected shape (legacy null/absent
  // stays omitted on both shapes); the renderer boundary normalizes it to
  // own-rank (`rs` fallback) — never baked here.
  if (isExtraFollowRank(bp.extraBadgeStyle)) params.push(`xbs=follow-rank`)
  else if (bp.extraBadgeStyle) params.push(`xbs=${bp.extraBadgeStyle}`)
  // Font badge SEMPRE esplicito in preview (come bs/rs): senza, un mapping
  // salvato con font diverso scavalcerebbe la scelta editor (desync WYSIWYG).
  params.push(`bfont=${bp.badgeFont ?? "inter"}`)
  // Quality style ALWAYS explicit in preview (like bs/rs): without it, a
  // saved mapping with a different style would override the editor choice (desync).
  params.push(`qbs=${normalizeQualityBadgeStyleForTransport(bp.qualityBadgeStyle)}`)
  if (bp.videoFormats !== undefined && bp.videoFormats !== null) {
    params.push(`formats=${bp.videoFormats.length === 0 ? "none" : bp.videoFormats.join(",")}`)
  }
  params.push(`tscale=${bp.topBadgeScale}`)
  params.push(`tox=${bp.topBadgeOffsetX}`)
  params.push(`toy=${bp.topBadgeOffsetY}`)
  // Extra tuning: opt-in only (absent = legacy classifica fallback,
  // existing preview URLs stay byte-identical).
  if (bp.extraBadgeScale != null) params.push(`exscale=${bp.extraBadgeScale}`)
  if (bp.extraBadgeOffsetX != null) params.push(`exox=${bp.extraBadgeOffsetX}`)
  if (bp.extraBadgeOffsetY != null) params.push(`exoy=${bp.extraBadgeOffsetY}`)
  params.push(`gscale=${bp.genreBadgeScale}`)
  params.push(`gox=${bp.genreBadgeOffsetX}`)
  params.push(`goy=${bp.genreBadgeOffsetY}`)
  params.push(`qscale=${bp.qualityBadgeScale}`)
  params.push(`sepscale=${bp.separateBadgeScale ?? getSeparateBadgeDefaultScale(bp.separateRatingsStyle)}`)
  params.push(`sepox=${bp.separateBadgeOffsetX ?? 0}`)
  params.push(`sepoy=${bp.separateBadgeOffsetY ?? 0}`)
  // Explicit empty = automatic layout, not inheritance from saved corrections.
  // Legacy callers without this field still leave the query absent.
  const bit = canonicalizeBadgeItemTransforms(bp.badgeItemTransforms)
  if (bp.badgeItemTransforms !== undefined) params.push(`bit=${encodeURIComponent(bit ?? "")}`)
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
  // Esplicito quando definito (come netPos): senza, un mapping salvato con
  // follow spento scavalcerebbe lo stato editor e viceversa (desync
  // WYSIWYG). Assente = URL legacy invariati.
  if (bp.networkLogoFollowTitle !== undefined) {
    params.push(`netFollow=${bp.networkLogoFollowTitle ? "1" : "0"}`)
  }

  // SEMPRE esplicito in preview (come ribbon/cr/sep): senza, un default
  // salvato ON scavalcerebbe il toggle editor (desync WYSIWYG) — la preview
  // mostrerebbe il nastro Coming Soon anche a effetto spento.
  params.push(`pre=${bp.preRelease ? "1" : "0"}`)
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
  // Esclusioni automatiche space-wide: SEMPRE esplicite in preview
  // (`dct=`/`dnet=` vuoti quando lo staged è vuoto, come `sash=` sopra):
  // senza, un default salvato non-vuoto scavalcerebbe lo staged editor e la
  // preview mostrerebbe esclusioni già cancellate (stale desync). La query
  // presente-ma-vuota risolve [] e vince su mapping/config/defaults.
  if (bp.disabledContentTags != null) {
    const ids = [...new Set(sanitizeDisabledContentTags(bp.disabledContentTags))].sort()
    params.push(`dct=${encodeURIComponent(ids.join(","))}`)
  }
  if (bp.disabledNetworks != null) {
    const ids = [...new Set(sanitizeDisabledNetworks(bp.disabledNetworks))].sort()
    params.push(`dnet=${encodeURIComponent(ids.join(","))}`)
  }
  // Cornice stagionale (scelta per-titolo sopra il contesto lista di
  // origine, su entrambi i canvas col proprio asset — portrait 500×750,
  // landscape 768×432; senza contesto né scelta nessun parametro (URL
  // legacy invariati, niente leakage tra liste). Solo il banner pulito
  // (landscape + hideLogo) resta senza tema.
  const previewTheme = resolveEffectiveSeasonalTheme(
    ps.seasonalThemeChoice ?? null,
    normalizeSeasonalTheme(ps.seasonalTheme),
  )
  if (previewTheme) params.push(`theme=${previewTheme}`)
  // Layout SEMPRE esplicito in preview (come shape): senza, un mapping o un
  // default salvato fresh scavalcerebbe la scelta editor — e tornando a
  // standard senza parametro il server erediterebbe fresh (desync WYSIWYG).
  // Cover layouts (provider-glass/nuvio/stremio) viaggiano intatti; garbage
  // cade su standard (stessa fail-closed del resolver).
  params.push(`layout=${isPosterLayout(bp.posterLayout) ? bp.posterLayout : "standard"}`)
  // Scope SEMPRE esplicito in preview (come layout): senza, un mapping o un
  // default salvato ranked scavalcerebbe la scelta editor — e tornando ad
  // all senza parametro il server erediterebbe ranked (desync WYSIWYG).
  params.push(`freshScope=${bp.posterFreshScope === "all" ? "all" : "ranked"}`)
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
    // List-rank context (decisione A): un `rk=` valido vince sui rank live.
    // Le emissioni automatiche `rank=`/`animerank=` da customBadge rank-key o
    // mdblistAnimeList sono rank AUTO-derivati (non override manuali digitati):
    // con contesto lista valido si omettono così la preview risolve lo stesso
    // `rk=` di Stremio. `extra=` esplicito non-rank viaggia invariato.
    const hasListRank = typeof ps.listRank === "number" && Number.isInteger(ps.listRank) && ps.listRank >= 0 && ps.listRank <= 100
    const badgeParams = computeBadgeParams(ps, bp, hasListRank)
    params.push(...badgeParams)
    // WYSIWYG: il client conosce già il rank anime dal suo mdblistAnimeList;
    // senza questo parametro la preview non può calcolarlo (la URL non porta
    // chiavi/profilo) e il badge Anime non comparirebbe nella preview.
    // Con contesto lista valido si omette (vince `rk=`, come Stremio che non
    // emette mai `animerank=` per queste liste).
    const selected = ps.selected
    const animeRank = selected
      ? (ps.mdblistAnimeList.find((a) => a.id === selected.id)?.rank ?? null)
      : null
    if (animeRank && !hasListRank) params.push(`animerank=${animeRank}`)
  } else if (bp.customBadge) {
    const badgeParams = computeBadgeParams(ps, bp)
    params.push(...badgeParams)
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

function computeBadgeParams(ps: PosterState, bp: BadgeParams, omitAutoRank = false): string[] {
  const params: string[] = []
  if (bp.customBadge) {
    const selected = ps.selected
    const animeRank = selected && ps.mdblistAnimeList.length > 0
      ? (ps.mdblistAnimeList.find((a) => a.id === selected.id)?.rank ?? null) : null
    // Canonical next-episode identity travels verbatim: the server resolves
    // the current dated label (or nothing when elapsed) in both preview and
    // Stremio, so the two never diverge.
    if (bp.customBadge === NEXT_EPISODE_BADGE_KEY) params.push(`extra=${encodeURIComponent(bp.customBadge)}`)
    else {
    const rankKey = isRankKey(bp.customBadge)
    // Con contesto lista valido le rank-key AUTO-derivate si omettono (vince
    // `rk=`); `extra=` esplicito resta invariato. Un `rank=` manuale genuino
    // resta al server (precedenza invariata).
    if (omitAutoRank && rankKey) {
      // Niente: il badge rank arriva da `rk=` come Stremio (nessun duplicato).
    }
    else if ((rankKey === "badge.today" || rankKey === "badge.movie" || rankKey === "badge.series") && ps.trendRank) params.push(`rank=${ps.trendRank}&label=${encodeURIComponent(tFn("badge.today"))}`)
    else if (rankKey === "badge.anime" && animeRank) params.push(`rank=${animeRank}&label=${encodeURIComponent(tFn("badge.anime"))}`)
    else params.push(`extra=${encodeURIComponent(resolveLabel(bp.customBadge))}`)
    }
  }
  // For auto badges, let the server compute from its own TMDB data
  return params
}

export interface DefaultsPreviewDemoMedia {
  mediaType: "movie" | "tv"
  id: number
  /** Titolo demo solo per alt/caption client, mai in query. */
  title?: string | null
}

export interface DefaultsPreviewParams {
  /** Titolo demo preview-only (default Avatar movie/19995): cambia solo il
   *  path `{type}/{id}`, maiMapping/mapping/default/shape. Id non valido =
   *  fallback al demo di default. Nessun nuovo nome in query. */
  demoMedia?: DefaultsPreviewDemoMedia | null
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
  /** Badge età testuale di default portrait (default OFF): sempre esplicito in preview. In preview landscape vince il profilo `landscape` (`land ?? flat`). */
  defaultAgeBadge?: boolean
  /** Paese classificazione età di default portrait (default "IT"): sempre esplicito. In preview landscape vince il profilo. */
  defaultAgeCountry?: string | null
  /** Stile pill età di default portrait (default "standard"): sempre esplicito. In preview landscape vince il profilo. */
  defaultAgeBadgeStyle?: AgeBadgeStyle | null
  defaultCustomRatings?: boolean
  defaultSeparateRatings?: boolean
  defaultSeparateRatingsStyle?: SeparateRatingsStyle | null
  defaultRatingSources?: string[]
  defaultBadgeStyle?: BadgeStyle
  defaultRankingBadgeStyle?: RankingBadgeStyle
  /** Standalone extra-badge style default: emitted as `xbs` only when defined (incl. "follow-rank" sentinel). */
  defaultExtraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | null
  defaultBadgeFont?: BadgeFont | null
  defaultQualityBadgeStyle?: QualityBadgeStyle | null
  defaultVideoFormats?: readonly VideoFormat[] | null
  defaultBlurEnabled?: boolean
  defaultBlurIntensity?: number
  defaultBlurFade?: number
  defaultBlurDarkness?: number
  defaultTintStrength?: number
  defaultTopShade?: number
  defaultTopShadeHeight?: number
  defaultGradientHeight?: number
  defaultTopBadgeScale?: number
  defaultTopBadgeOffsetX?: number
  defaultTopBadgeOffsetY?: number
  /** Tuning EXTRA superiore (opt-in: assente = fallback legacy classifica). */
  defaultExtraBadgeScale?: number | null
  defaultExtraBadgeOffsetX?: number | null
  defaultExtraBadgeOffsetY?: number | null
  defaultGenreBadgeScale?: number
  defaultGenreBadgeOffsetX?: number
  defaultGenreBadgeOffsetY?: number
  defaultQualityBadgeScale?: number
  defaultSeparateBadgeScale?: number | null
  /** Offset px del gruppo rating separati (default 0). */
  defaultSeparateBadgeOffsetX?: number | null
  /** Offset px del gruppo rating separati (default 0). */
  defaultSeparateBadgeOffsetY?: number | null
  /** Per-item corrections (canonical wire form; null/absent = automatic). */
  defaultBadgeItemTransforms?: string | null
  defaultQualityBadgeOffsetX?: number
  defaultQualityBadgeOffsetY?: number
  defaultNetworkLogoScale?: number
  defaultNetworkLogoOffsetX?: number
  defaultNetworkLogoOffsetY?: number
  defaultNetworkLogo?: boolean
  defaultNetworkLogoPosition?: NetworkLogoPosition
  /** Il network segue il titolo (default globale, per-shape via `landscape`).
   *  Emesso solo quando definito: default legacy = URL invariati. */
  defaultNetworkLogoFollowTitle?: boolean | null
  defaultRibbonEnabled?: boolean
  /** Effetto pre-digitale di default portrait (default OFF): sempre esplicito
   *  in preview. In preview landscape vince il profilo `landscape`
   *  (`land ?? flat`, stessa regola della UI e del server). */
  defaultPreRelease?: boolean
  defaultRibbonSide?: "left" | "right"
  defaultPosterShape?: PosterShape
  defaultLogoAlign?: "left" | "center" | null
  /**
   * Graphical poster layout di default (flat). In preview landscape vince il
   * profilo Orizzontale (`land.posterLayout ?? flat`, stessa regola
   * `land ?? flat` della UI e del server) — sempre esplicito in preview
   * (`layout=standard|fresh|provider-glass|nuvio|stremio`), mai persistito da qui.
   */
  defaultPosterLayout?: PosterLayout | null
  /**
   * Fresh apply scope di default (flat). In preview landscape vince il
   * profilo Orizzontale (`land.posterFreshScope ?? flat`, stessa regola
   * `land ?? flat` della UI e del server) — sempre esplicito in preview
   * (`freshScope=all|ranked`), mai persistito da qui.
   */
  defaultPosterFreshScope?: PosterFreshScope | null
  /** Profilo Orizzontale dei default (stessi slider del Verticale): chiavi
   *  definite vincono sui flat SOLO in preview landscape — stessa regola
   *  `land ?? flat` della UI (`LandscapeDefaultsSection`) e del server
   *  (`effectiveDefaultsForShape`). Mai persistito da qui. */
  landscape?: LandscapeServerDefaults | null
  /** Shape preview-only (tab Trasforma): vince sul `defaultPosterShape`
   *  persistito senza modificarlo. Assente/null = segui il default. */
  previewShape?: "portrait" | "landscape" | null
  defaultDateFormat?: DateFormat | null
  defaultRegion?: string
  /** Effective top-badge priority for the previewed shape (portrait flat or
   *  landscape profile override): always emitted explicitly as `sash=` so
   *  category switches and priority edits are WYSIWYG in preview. Absent =
   *  the canonical default order. */
  defaultSashOrder?: readonly SashBucket[] | null
  /**
   * Tag badge automatici disabilitati space-wide di default (ID canonici):
   * SEMPRE espliciti in preview (`dct=` vuoto quando lo staged è vuoto),
   * mai assenti quando definiti; null/undefined = legacy senza parametro.
   */
  defaultDisabledContentTags?: readonly string[] | null
  /** Mark network disabilitati space-wide di default (stesso contratto). */
  defaultDisabledNetworks?: readonly string[] | null
  /** Preview-only editing family: `rank` targets the rank bucket (`sash=rank`
   *  when the configured preview can paint a rank; otherwise the actual
   *  without-ranking composition, never an empty third state); `info`/`extra`
   *  are the without-ranking states and drop `rank` from the effective sash;
   *  every other family keeps the effective saved priority untouched. Never
   *  persisted. */
  previewFamily?: DefaultsPreviewFamily | null
  /** Preview-only info sample label (e.g. a `__badge.*` key resolved
   *  server-side in the request language): emitted as `extra=` so the
   *  Informazioni family shows a pertinent sample even when the demo title has
   *  no real informational badge. Absent = genuine data path. */
  previewExtra?: string | null
}

export const DEFAULTS_PREVIEW_DEMO_MEDIA = {
  mediaType: "movie",
  id: 19995,
} as const

/**
 * Preview-only editing family (Settings defaults screen): narrows the preview
 * sample to what the user is editing. `auto` (default) keeps the effective
 * saved priority untouched; `genre` (aggregate genre/year/rating style) also
 * keeps it (full actual preview, no forced sample) but forces a
 * preview-only `layout=standard` sample so `bs`/`bfont` edits stay visible
 * even with a fixed-appearance Fresh/Card layout configured (Fresh/Card
 * hide the genre badge by renderer contract and must never be restyled —
 * the staged/saved layout is untouched, only the preview query differs).
 * `rank` targets the ranking bucket: when the CONFIGURED preview can paint a
 * rank it narrows to `sash=rank` (configured layout — Fresh/Card included —
 * untouched); when it cannot (master OFF or rank bucket removed) it falls back
 * to the actual without-ranking composition, so the Settings with/without
 * preview switch always shows exactly two real states. `info` and `extra` are
 * the without-ranking states: both drop `rank` from the effective sash, so a
 * rank sample can never paint there (whatever the source data availability).
 * `extra` behaves like `info` but originates from the standalone extra-badge
 * style control: the preview builder prioritizes the existing `extra`-bucket
 * sample when that bucket is allowed, so an `xbs` change is visible even when
 * `upcoming` would otherwise win. Never persisted, never sent to
 * Stremio/editor — the same render endpoint, only different query values.
 */
export type DefaultsPreviewFamily =
  | "auto"
  | "rank"
  | "info"
  | "extra"
  | "genre"
  | "ratings"
  | "quality"
  | "logo"
  | "gradient"

/**
 * CONFIGURED eligibility, not live data: can the DEFAULTS PREVIEW of the
 * previewed shape paint a ranking badge at all? True only with the ranking
 * master ON and `rank` in the effective sash for that shape (`land ?? flat`,
 * same rule as the builder). Pure config read — it says nothing about whether
 * the previewed title actually has a rank: that is decided server-side (real
 * chart rank, or the existing Settings-only demo sample filling a missing
 * one). The `rank` family fallback and the two-state preview switch read this
 * helper so they never offer a ranking state the configured preview cannot
 * produce; the switch pressed state additionally requires the request itself
 * to narrow to `sash=rank` (see `DefaultsPosterPreview`).
 */
export function isDefaultsPreviewRankConfigured(bp: {
  defaultRankingBadges?: boolean | null
  defaultSashOrder?: readonly SashBucket[] | null
  landscape?: LandscapeServerDefaults | null
  previewShape?: "portrait" | "landscape" | null
  defaultPosterShape?: PosterShape | null
}): boolean {
  const previewLandscape =
    bp.previewShape === "landscape" || (bp.previewShape == null && bp.defaultPosterShape === "landscape")
  const land = previewLandscape ? (bp.landscape ?? {}) : {}
  const rankingEnabled = (land.rankingBadges ?? bp.defaultRankingBadges) !== false
  const sash: readonly SashBucket[] = land.sashOrder ?? bp.defaultSashOrder ?? [...DEFAULT_SASH_ORDER]
  return rankingEnabled && sash.includes("rank")
}

export function buildDefaultsPreviewUrl(bp: DefaultsPreviewParams): string {
  // Demo samples (Settings preview only): la route applica campioni dimostrativi
  // ai soli dati assenti, mai a Stremio/editor (builder dedicati intatti).
  const params: string[] = [`rv=${RENDER_VERSION}`, "preview=1", "demosamples=1"]
  if (bp.tmdbKey) params.push(`api_key=${encodeURIComponent(bp.tmdbKey)}`)
  if (bp.userId) params.push(`u=${encodeURIComponent(bp.userId)}`)
  // Shape preview-only (tab Trasforma Orizzontale): vince sul default
  // persistito senza modificarlo; assente = segui `defaultPosterShape`.
  const previewLandscape =
    bp.previewShape === "landscape" || (bp.previewShape == null && bp.defaultPosterShape === "landscape")
  // Profilo Orizzontale effettivo: `land ?? flat` (come UI e server).
  // `undefined` = segui il flat (mai clobberare); `0` vince sempre; logo
  // `null` = auto-fit. In portrait il profilo è vuoto → URL byte-identici.
  const land: LandscapeServerDefaults = previewLandscape ? (bp.landscape ?? {}) : {}
  const pick = <T>(v: T | undefined, fb: T | null | undefined): T | null | undefined =>
    (v !== undefined ? v : fb)
  const effSepStyle = land.separateRatingsStyle ?? bp.defaultSeparateRatingsStyle ?? "column"
  // Explicit zero restores automatic sizing/no offset instead of inheriting a saved override.
  params.push(`scale=${pick(land.logoScale, bp.defaultLogoScale) ?? 0}`)
  params.push(`ox=${pick(land.logoOffsetX, bp.defaultLogoOffsetX) ?? 0}`)
  params.push(`oy=${pick(land.logoOffsetY, bp.defaultLogoOffsetY) ?? 0}`)
  params.push(`badges=${pick(land.globalBadges, bp.defaultGlobalBadges) !== false ? "1" : "0"}`)
  const effPreviewRanking = pick(land.rankingBadges, bp.defaultRankingBadges) !== false
  params.push(`ranking=${effPreviewRanking ? "1" : "0"}`)
  // Effective top-badge priority for the previewed shape, ALWAYS explicit
  // (even when it matches the default): without it a saved non-default order
  // or an emptied sash (master OFF) would render the server fallback instead
  // of the edited categories (desync WYSIWYG). `rank` family targets the rank
  // bucket: when the CONFIGURED preview can paint a rank it narrows to
  // `sash=rank` (the badge value itself comes from the real source rank or,
  // when the previewed title has none, from the existing disclosed Settings
  // demo sample); when it cannot (master OFF or rank bucket removed) it
  // renders the ACTUAL without-ranking composition. `info`/`extra` are the
  // without-ranking states and always drop `rank` from the effective sash —
  // regardless of whether a sample exists — so no rank numeral can leak into
  // them. Other enabled buckets are kept, nothing is invented; `auto` and the
  // remaining families restore the effective saved priority untouched.
  const effPreviewSash: readonly SashBucket[] = land.sashOrder ?? bp.defaultSashOrder ?? [...DEFAULT_SASH_ORDER]
  const withoutRankSash = effPreviewSash.filter((bucket) => bucket !== "rank")
  const previewSash: readonly SashBucket[] =
    bp.previewFamily === "rank"
      ? (isDefaultsPreviewRankConfigured(bp) ? ["rank"] : withoutRankSash)
      : bp.previewFamily === "info" || bp.previewFamily === "extra"
        ? withoutRankSash
        : effPreviewSash
  params.push(`sash=${previewSash.join(",")}`)
  // Esclusioni automatiche space-wide (flat condivisi, nessun profilo
  // landscape): SEMPRE esplicite in preview (`dct=`/`dnet=` vuoti quando lo
  // staged è vuoto, come `sash=` sopra) — senza, un default salvato
  // non-vuoto scavalcerebbe lo staged. La query presente-ma-vuota risolve
  // [] e vince su mapping/config/defaults.
  if (bp.defaultDisabledContentTags != null) {
    const ids = [...new Set(sanitizeDisabledContentTags(bp.defaultDisabledContentTags))].sort()
    params.push(`dct=${encodeURIComponent(ids.join(","))}`)
  }
  if (bp.defaultDisabledNetworks != null) {
    const ids = [...new Set(sanitizeDisabledNetworks(bp.defaultDisabledNetworks))].sort()
    params.push(`dnet=${encodeURIComponent(ids.join(","))}`)
  }
  // Preview-only info sample (Informazioni family): explicit `extra=` wins
  // over the computed badge exactly like an editor custom badge; ignored when
  // ranking is off, so a disabled master never shows a phantom sample.
  if (bp.previewExtra) params.push(`extra=${encodeURIComponent(bp.previewExtra)}`)
  params.push(`bg=${pick(land.badgeGenre, bp.defaultBadgeGenre) !== false ? "1" : "0"}`)
  params.push(`by=${pick(land.badgeYear, bp.defaultBadgeYear) !== false ? "1" : "0"}`)
  params.push(`br=${pick(land.badgeRating, bp.defaultBadgeRating) !== false ? "1" : "0"}`)
  params.push(`bq=${pick(land.badgeQuality, bp.defaultBadgeQuality) !== false ? "1" : "0"}`)
  // Badge età sempre esplicito in preview (toggle + paese non salvati devono
  // mostrarsi subito, come `bq` sopra). Per-shape (task3A): in landscape
  // vince il profilo Orizzontale (`land ?? flat`, stessa regola della UI e
  // del server) così portrait ON non accende mai il landscape.
  const effAgeBadge = previewLandscape ? (land.ageBadge ?? bp.defaultAgeBadge) : bp.defaultAgeBadge
  const effAgeCountry = previewLandscape ? (land.ageCountry ?? bp.defaultAgeCountry) : bp.defaultAgeCountry
  const effAgeStyle = previewLandscape ? (land.ageBadgeStyle ?? bp.defaultAgeBadgeStyle) : bp.defaultAgeBadgeStyle
  params.push(`age=${effAgeBadge ? "1" : "0"}`)
  const previewAgeCountry = (effAgeCountry || "").trim().toUpperCase()
  params.push(`agecountry=${/^[A-Z]{2}$/.test(previewAgeCountry) && previewAgeCountry !== "GLOBAL" ? previewAgeCountry : "IT"}`)
  // Stile pill età sempre esplicito in preview (come sopra): il default
  // salvato deve mostrarsi subito senza ereditare token o default altrui.
  params.push(`agebs=${isAgeBadgeStyle(effAgeStyle) ? effAgeStyle : "standard"}`)
  params.push(`cr=${pick(land.customRatings, bp.defaultCustomRatings) === false ? "0" : "1"}`)
  params.push(`sep=${pick(land.separateRatings, bp.defaultSeparateRatings) ? "1" : "0"}`)
  // Stile normalizzato per formato effettivo (bar Orizzontale → pills).
  params.push(`sepstyle=${getSeparateRatingsStyleForShape(effSepStyle, previewLandscape ? "landscape" : "poster")}`)
  if (bp.defaultRatingSources && bp.defaultRatingSources.length > 0) {
    params.push(`rsrc=${encodeURIComponent(bp.defaultRatingSources.join(","))}`)
  }
  params.push(`bs=${pick(land.badgeStyle, bp.defaultBadgeStyle) ?? "shadow"}`)
  params.push(`rs=${pick(land.rankingBadgeStyle, bp.defaultRankingBadgeStyle) ?? "default"}`)
  // Standalone extra style: a landscape profile that OWNS "follow-rank"
  // shadows the portrait flat (the preview URL carries xbs=follow-rank and
  // the server ownership guard resolves the own-rank fallback instead).
  // Legacy landscape null/absent/invalid INHERITS the flat (byte-identical:
  // flat pill travels as xbs=pill, flat legacy omits xbs). The other nullable
  // inherit-null fields (font, quality style, formats) keep following the
  // flat (unlike logo scale/offset, where null means auto/zero).
  // NOTE: no `??` fallback here — an owned sentinel must survive, not
  // collapse back onto the portrait flat.
  let effPreviewXbs: ExtraBadgeStyle | ExtraBadgeFollowRank | null | undefined
  if ("extraBadgeStyle" in land) {
    const v = (land as { extraBadgeStyle?: unknown }).extraBadgeStyle
    if (isExtraFollowRank(v) || isExtraBadgeStyle(typeof v === "string" ? v : null)) {
      effPreviewXbs = v as ExtraBadgeStyle | ExtraBadgeFollowRank
    } else {
      effPreviewXbs = bp.defaultExtraBadgeStyle
    }
  } else {
    effPreviewXbs = bp.defaultExtraBadgeStyle
  }
  if (effPreviewXbs) params.push(`xbs=${effPreviewXbs}`)
  params.push(`bfont=${pick(land.badgeFont ?? undefined, bp.defaultBadgeFont) ?? "inter"}`)
  const effPreviewQbs = pick(land.qualityBadgeStyle ?? undefined, bp.defaultQualityBadgeStyle)
  params.push(`qbs=${normalizeQualityBadgeStyleForTransport(effPreviewQbs)}`)
  const effPreviewFormats = pick(land.videoFormats ?? undefined, bp.defaultVideoFormats)
  if (effPreviewFormats !== undefined && effPreviewFormats !== null) {
    params.push(`formats=${effPreviewFormats.length === 0 ? "none" : effPreviewFormats.join(",")}`)
  }
  params.push(`gradHeight=${pick(land.gradientHeight, bp.defaultGradientHeight) ?? 30}`)
  params.push(`blur=${pick(land.blurIntensity, bp.defaultBlurIntensity) ?? 20}`)
  params.push(`bf=${pick(land.blurFade, bp.defaultBlurFade) ?? 50}`)
  params.push(`bd=${pick(land.blurDarkness, bp.defaultBlurDarkness) ?? 30}`)
  params.push(`be=${pick(land.blurEnabled, bp.defaultBlurEnabled) !== false ? "1" : "0"}`)
  params.push(`tint=${pick(land.tintStrength, bp.defaultTintStrength) ?? 20}`)
  params.push(`ts=${pick(land.topShade, bp.defaultTopShade) ?? 50}`)
  params.push(`tsh=${pick(land.topShadeHeight, bp.defaultTopShadeHeight) ?? 25}`)
  params.push(`tscale=${pick(land.topBadgeScale, bp.defaultTopBadgeScale) ?? 100}`)
  params.push(`tox=${pick(land.topBadgeOffsetX, bp.defaultTopBadgeOffsetX) ?? 0}`)
  params.push(`toy=${pick(land.topBadgeOffsetY, bp.defaultTopBadgeOffsetY) ?? 0}`)
  // Extra tuning: opt-in only (absent = legacy classifica fallback,
  // existing preview URLs stay byte-identical). Profilo landscape incluso.
  const effExScale = pick(land.extraBadgeScale, bp.defaultExtraBadgeScale)
  const effExOX = pick(land.extraBadgeOffsetX, bp.defaultExtraBadgeOffsetX)
  const effExOY = pick(land.extraBadgeOffsetY, bp.defaultExtraBadgeOffsetY)
  if (effExScale != null) params.push(`exscale=${effExScale}`)
  if (effExOX != null) params.push(`exox=${effExOX}`)
  if (effExOY != null) params.push(`exoy=${effExOY}`)
  params.push(`gscale=${pick(land.genreBadgeScale, bp.defaultGenreBadgeScale) ?? 100}`)
  params.push(`gox=${pick(land.genreBadgeOffsetX, bp.defaultGenreBadgeOffsetX) ?? 0}`)
  params.push(`goy=${pick(land.genreBadgeOffsetY, bp.defaultGenreBadgeOffsetY) ?? 0}`)
  params.push(`qscale=${pick(land.qualityBadgeScale, bp.defaultQualityBadgeScale) ?? 100}`)
  params.push(`sepscale=${pick(land.separateBadgeScale, bp.defaultSeparateBadgeScale) ?? getSeparateBadgeDefaultScale(effSepStyle)}`)
  params.push(`sepox=${pick(land.separateBadgeOffsetX, bp.defaultSeparateBadgeOffsetX) ?? 0}`)
  params.push(`sepoy=${pick(land.separateBadgeOffsetY, bp.defaultSeparateBadgeOffsetY) ?? 0}`)
  // Always explicit: clearing the last draft correction must not fall back
  // to saved defaults. An owned landscape null also means automatic layout.
  const previewBit = canonicalizeBadgeItemTransforms(pick(land.badgeItemTransforms, bp.defaultBadgeItemTransforms) ?? null)
  params.push(`bit=${encodeURIComponent(previewBit ?? "")}`)
  params.push(`qox=${pick(land.qualityBadgeOffsetX, bp.defaultQualityBadgeOffsetX) ?? getQualityBadgeOffsetDefault(previewLandscape ? "landscape" : "poster", "x")}`)
  params.push(`qoy=${pick(land.qualityBadgeOffsetY, bp.defaultQualityBadgeOffsetY) ?? getQualityBadgeOffsetDefault(previewLandscape ? "landscape" : "poster", "y")}`)
  params.push(`netscale=${pick(land.networkLogoScale, bp.defaultNetworkLogoScale) ?? 100}`)
  // Follow network per-shape con unità di layer (stesso resolver del
  // server, sui default in anteprima: niente mapping/config/query qui).
  // Portrait: fixed solo dal flat; landscape: fixed solo dal profilo (mai
  // leak cross-shape: un flat portrait non diventa assoluto su LAND).
  const netSdLike = {
    networkLogoFollowTitle: bp.defaultNetworkLogoFollowTitle ?? undefined,
    networkLogoOffsetX: bp.defaultNetworkLogoOffsetX ?? undefined,
    networkLogoOffsetY: bp.defaultNetworkLogoOffsetY ?? undefined,
    landscape: bp.landscape ?? undefined,
  }
  const netShape = previewLandscape ? "landscape" as const : "poster" as const
  const netFollowRaw = resolveNetworkFollowTitle(new URLSearchParams(), null, null, netSdLike, netShape)
  const netFixed = resolveNetworkFixedCoords(new URLSearchParams(), null, null, netSdLike, netShape)
  const netFollowEff = resolveEffectiveNetworkFollow(netFollowRaw, netFixed)
  if (!netFollowEff) {
    params.push("netFollow=0")
    params.push(`nox=${netFixed.x as number}`)
    params.push(`noy=${netFixed.y as number}`)
  } else {
    // ON: netFollow=1 solo se un follow non-nullo è definito da qualche
    // parte (override esplicito di un fixed server); nox/noy restano offset
    // legacy con fallback flat (byte-identici quando tutto è assente/null).
    const followDefined = (previewLandscape
      ? (land.networkLogoFollowTitle ?? bp.defaultNetworkLogoFollowTitle)
      : bp.defaultNetworkLogoFollowTitle) != null
    if (followDefined) params.push("netFollow=1")
    // ON: stessi offset del resolver (profilo, poi flat salvo fixed-layer,
    // poi 0) — mai assoluti di altra shape come relativi.
    const netOn = resolveLandscapeNetworkOffsets(new URLSearchParams(), null, null, netSdLike)
    params.push(`nox=${previewLandscape ? netOn.x : (pick(land.networkLogoOffsetX, bp.defaultNetworkLogoOffsetX) ?? 0)}`)
    params.push(`noy=${previewLandscape ? netOn.y : (pick(land.networkLogoOffsetY, bp.defaultNetworkLogoOffsetY) ?? 0)}`)
  }
  params.push(`netLogo=${pick(land.networkLogo, bp.defaultNetworkLogo) !== false ? "1" : "0"}`)
  params.push(`netPos=${pick(land.networkLogoPosition ?? undefined, bp.defaultNetworkLogoPosition) === "top" ? "top" : "auto"}`)
  params.push(`ribbon=${pick(land.ribbonEnabled, bp.defaultRibbonEnabled) === false ? "0" : "1"}`)
  // Effetto pre-digitale SEMPRE esplicito in preview (come ribbon/sep/cr):
  // senza, un default salvato ON scavalcerebbe il toggle staged (desync
  // WYSIWYG) — la preview mostrerebbe il nastro Coming Soon anche a effetto
  // spento. Per-shape (`land ?? flat`, come UI e server): in landscape vince
  // il profilo Orizzontale.
  params.push(`pre=${pick(land.preRelease, bp.defaultPreRelease) ? "1" : "0"}`)
  const effPreviewSide = pick(land.ribbonSide, bp.defaultRibbonSide)
  if (effPreviewSide) params.push(`side=${effPreviewSide}`)
  params.push(`shape=${previewLandscape ? "landscape" : "poster"}`)
  // Layout effettivo del formato in anteprima (`land ?? flat`, come UI e
  // server): SEMPRE esplicito in preview (come sash), così la preview dei
  // default mostra davvero il layout selezionato per quel formato.
  // Preview-only: la family `genre` forza un campione `standard` (Fresh/Card
  // hanno aspetto fisso e nascondono il badge genere per contratto renderer —
  // mai restyle) così `bs`/`bfont` restano visibili; staged/salvato intatti.
  const effPreviewLayoutRaw = (previewLandscape ? land.posterLayout : undefined) ?? bp.defaultPosterLayout
  const effPreviewLayout = bp.previewFamily === "genre" ? "standard" : effPreviewLayoutRaw
  params.push(`layout=${isPosterLayout(effPreviewLayout) ? effPreviewLayout : "standard"}`)
  // Scope effettivo del formato in anteprima (`land ?? flat`, come UI e
  // server): SEMPRE esplicito in preview (come layout), così la preview dei
  // default mostra davvero lo scope selezionato per quel formato.
  const effPreviewScope = (previewLandscape ? land.posterFreshScope : undefined) ?? bp.defaultPosterFreshScope
  params.push(`freshScope=${effPreviewScope === "all" ? "all" : "ranked"}`)
  // Alignment preview (landscape only — portraits stay centered by
  // contract): the profile override wins, null/absent follows the flat, flat
  // null (auto) stays omitted (the server resolves the landscape "left"
  // itself, so legacy preview URLs stay byte-identical).
  if (previewLandscape) {
    const effPreviewAlign = ("logoAlign" in land ? land.logoAlign : undefined) ?? bp.defaultLogoAlign
    if (effPreviewAlign) params.push(`align=${effPreviewAlign === "left" ? "left" : "center"}`)
  }
  if (bp.lang) params.push(`lang=${encodeURIComponent(bp.lang)}`)
  if (bp.defaultRegion) params.push(`region=${encodeURIComponent(bp.defaultRegion)}`)
  if (bp.defaultDateFormat) params.push(`df=${bp.defaultDateFormat}`)

  const qs = "?" + params.join("&")
  const demo = resolveDemoMedia(bp.demoMedia)
  return `${getDomain()}/api/poster/${demo.mediaType}/${demo.id}${qs}`
}

function resolveDemoMedia(
  dm: DefaultsPreviewDemoMedia | null | undefined,
): { mediaType: "movie" | "tv"; id: number } {
  if (
    dm &&
    (dm.mediaType === "movie" || dm.mediaType === "tv") &&
    Number.isSafeInteger(dm.id) &&
    dm.id > 0
  ) {
    return { mediaType: dm.mediaType, id: dm.id }
  }
  return { mediaType: DEFAULTS_PREVIEW_DEMO_MEDIA.mediaType, id: DEFAULTS_PREVIEW_DEMO_MEDIA.id }
}
