import type { WatchProvider } from "@/lib/watch-providers"
import type { RatingItem } from "./custom-rating/types"
import type { SeparateRating } from "./ratings"
import type { EffectiveAccentMeta } from "./effective-accent"
import { type NetworkCandidate } from "./network-svgs"
import { type QualityAnchor,type TopBadgeAnchor,type ExtraBadgeAnchor,type BottomAnchor } from "./badge-anchor"
import { type LogoAnchor } from "./logo-layout"
import type { MdbListWhatsonFeatures } from "./content-tags"
import type { DateFormat } from "./release-badge"
import type { SashBucket } from "./badge-priority"
import type { Mapping,NetworkLogoPosition,PosterLayout,PosterFreshScope } from "./types"
import { type SeasonalTheme } from "./seasonal-theme"
import type { ServerDefaults } from "./server-defaults"
import type { WikidataResult } from "./awards"
import type { BadgeT } from "./poster-badge"
import type { BadgeFont } from "./badge-styles"
import { type BadgeStyle,type RankingBadgeStyle,type ExtraBadgeStyle,type ExtraBadgeFollowRank,type SeparateRatingsStyle,type AgeBadgeStyle,type AwardBadgeMode,type QualityGroupLayout } from "./badge-styles"
import type { PosterImageFormat } from "@/lib/poster-runtime-cache"
import { type ImageQuality } from "@/lib/image-quality"
import type { QualityBadgeStyle } from "./badge-styles"
import { type BadgeItemTransformMap } from "./badge-item-transforms"
import { type NetworkGeometry,type BadgeGeometryReport } from "./badge-layout"

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
  /** Genere abbreviato nel badge (solo testo; assente = nome intero). */
  genreShort?: boolean
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
  /** Opt-in (`rt=1`) JW chart movement of the automatic rank (arrow beside the badge), else null. */
  rankTrend?: "up" | "down" | null
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
   * Film rilevato pre-digitale con `pre` SPENTO: le stesse etichette
   * ("Prossimamente" / "Al cinema") come badge extra beige normale, senza
   * nastro rosso né velo. Mutuamente esclusivo con `preRelease`.
   */
  preBeige?: boolean
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
