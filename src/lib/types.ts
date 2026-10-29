import type { BadgeStyle, RankingBadgeStyle, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle, ExtraBadgeStyle, ExtraBadgeFollowRank, AgeBadgeStyle } from "./badge-styles"
import type { VideoFormat } from "./av-specs"

/**
 * Retired Badge Lab persistence leftovers (custom badge library removed).
 * The nine family ids survive ONLY as inert stored keys so legacy mappings,
 * config tokens and server defaults keep validating and round-tripping
 * byte-identically (never deleted from storage). The renderer, poster URLs
 * and cache keys ignore them unconditionally: old bindings cannot change a
 * single pixel or bust a cache entry.
 */
export const RETIRED_BADGE_FAMILY_IDS = [
  "rank",
  "extra",
  "genre",
  "quality",
  "age",
  "network",
  "separateRatings",
  "customRatings",
  "comingSoon",
] as const
export type RetiredBadgeFamilyId = (typeof RETIRED_BADGE_FAMILY_IDS)[number]

export interface RetiredBadgeFamilyBinding {
  id: string
  rev?: string | null
}

export type RetiredBadgeFamilyBindings = Partial<Record<RetiredBadgeFamilyId, RetiredBadgeFamilyBinding | null>>

export type RetiredBadgeFamilyFollows = Partial<Record<RetiredBadgeFamilyId, true>>
/** Formato canvas del poster: verticale standard o orizzontale 16:9 (Nuvio). */
export type PosterShape = "poster" | "landscape"

export function isPosterShape(value: unknown): value is PosterShape {
  return value === "poster" || value === "landscape"
}

/**
 * Graphical poster layout: "standard" (historic render, default), "fresh"
 * (opt-in graphical layout), or one of the cover layouts ("provider-glass",
 * "nuvio", "stremio" — accepted and serialized intact through the whole
 * query > mapping > config token > defaults chain, rendered by a later
 * delivery). Shared by the query key (`layout`), per-title
 * mapping (flat + landscape profile), config token, server defaults (flat +
 * landscape profile) and the render config; the single renderer draws
 * "fresh" via fresh-layout.ts (shade + glass numeral + meta column),
 * reusing the standard base/blur/chrome.
 */
export const POSTER_LAYOUTS = ["standard", "fresh", "provider-glass", "nuvio", "stremio"] as const
export type PosterLayout = (typeof POSTER_LAYOUTS)[number]

export const DEFAULT_POSTER_LAYOUT: PosterLayout = "standard"

export function isPosterLayout(value: unknown): value is PosterLayout {
  return (
    value === "standard" ||
    value === "fresh" ||
    value === "provider-glass" ||
    value === "nuvio" ||
    value === "stremio"
  )
}

/**
 * Fresh layout apply scope: "ranked" (default: Fresh only for titles with a
 * valid displayed rank 1..100; anything else falls back to a byte-identical
 * Standard render) or "all" (explicit override: Fresh for every title).
 * Shared by the query key (`freshScope`), per-title mapping (flat + landscape
 * profile), config token, server defaults (flat + landscape profile) and the
 * render config; the single renderer decides the EFFECTIVE layout from scope
 * + displayed rank.
 */
export const POSTER_FRESH_SCOPES = ["all", "ranked"] as const
export type PosterFreshScope = (typeof POSTER_FRESH_SCOPES)[number]

export const DEFAULT_POSTER_FRESH_SCOPE: PosterFreshScope = "ranked"

export function isPosterFreshScope(value: unknown): value is PosterFreshScope {
  return value === "all" || value === "ranked"
}

/**
 * Posizione del logo network: "auto" = specchio dinamico odierno (destra in
 * vista Stremio con angolo destro occupato, sinistra altrove), "top" =
 * sempre all'angolo superiore, lato del nastro effettivo (destra solo con
 * nastro rank/preset o Coming Soon a destra, sinistra in tutti gli altri
 * casi — anche in vista Stremio). Catena: query > mapping > config token >
 * server defaults > "auto".
 */
export type NetworkLogoPosition = "auto" | "top"

export function isNetworkLogoPosition(value: unknown): value is NetworkLogoPosition {
  return value === "auto" || value === "top"
}

export interface SearchResult {
  id: number
  media_type: "movie" | "tv"
  title?: string
  name?: string
  poster_path: string | null
  release_date?: string
  first_air_date?: string
  vote_average?: number
  imdb_id?: string | null
  /** Local anime associations; multiple seasons may share a TMDB series. */
  anime_ids?: { kitsu: number[]; mal: number[] }
  /**
   * Ephemeral list-rank context (position in the originating selected list +
   * selection country for region-scoped resolution). Never persisted to
   * mappings/defaults/tokens: drives only the `rk=`/`region=` preview query
   * (same shared poster endpoint as Stremio). Absent/null = legacy behavior.
   */
  listRank?: number | null
  listRegion?: string | null
}

export function toSearchResult(partial: { id?: number | null; media_type?: string; title?: string | null; name?: string | null; poster_path?: string | null; release_date?: string; first_air_date?: string; vote_average?: number; imdb_id?: string | null; listRank?: number | null; listRegion?: string | null }): SearchResult {
  const out: SearchResult = {
    id: partial.id ?? 0,
    media_type: partial.media_type === "tv" ? "tv" : "movie",
    title: partial.title ?? undefined,
    name: partial.name ?? undefined,
    poster_path: partial.poster_path ?? null,
    release_date: partial.release_date,
    first_air_date: partial.first_air_date,
    vote_average: partial.vote_average,
    imdb_id: partial.imdb_id,
  }
  if (partial.listRank !== undefined) out.listRank = partial.listRank
  if (partial.listRegion !== undefined) out.listRegion = partial.listRegion
  return out
}

export interface TMDBImage {
  file_path: string
  iso_639_1: string | null
  vote_average: number
  width: number
  height: number
}

export interface FlixPatrolItem {
  rank: number
  title: string
  days: number
  tmdbId: number | null
  mediaType: "movie" | "tv"
  posterPath: string | null
}

export interface FlixPatrolChart {
  platform: string
  platformName: string
  movies: FlixPatrolItem[]
  tv: FlixPatrolItem[]
}

export interface Mapping {
  tmdbId: number
  mediaType: "movie" | "tv"
  title: string
  posterPath: string
  /** Base image esterna da custom URL import (solo portrait). Null = base TMDB. */
  customPosterUrl?: string | null
  /**
   * External landscape base from a custom URL import (landscape-only, the
   * portrait mirror of `customPosterUrl`). Null = TMDB backdrop base. The two
   * bases are independent: each shape freezes only its own.
   */
  customBackdropUrl?: string | null
  /**
   * Portrait base frozen by a save made in server-auto base mode (title
   * without a clean poster): the rendered 2:3 base is the attention cover-crop
   * of THIS TMDB backdrop (no baked-in title, logo composed on top), not the
   * language poster in `posterPath`. Portrait-only (flat): the landscape base
   * stays `backdropPath`, and a saved custom base (`customPosterUrl`) wins.
   * Null/absent = historical language-poster base (mappings saved before this
   * mode existed are untouched).
   */
  portraitBackdropPath?: string | null
  logoPath: string | null
  /**
   * Logo testuale (titoli senza logo TMDB): testo digitato + font del bundle
   * (enum `BADGE_FONTS`). Il renderer lo rasterizza e lo compone come un logo
   * normale — nessun upload, nessuna dipendenza. Vince sul logo immagine
   * (`logoPath` non viene salvato quando c'è un testo) e `logoDisabled` resta
   * sovrano. Null/assente o vuoto = nessun logo (comportamento storico).
   */
  logoText?: string | null
  /** Font del logo testuale (enum badge; null = "inter"). */
  logoFont?: BadgeFont | null
  originalPosterPath: string | null
  language: string | null
  updatedAt: string
  logoScale?: number | null
  logoOffsetX?: number | null
  logoOffsetY?: number | null
  /** Scala % del badge superiore (rank/extra). Default 100. */
  topBadgeScale?: number | null
  /** Offset px del badge superiore — applicati solo agli stili centrati. */
  topBadgeOffsetX?: number | null
  topBadgeOffsetY?: number | null
  /** Scala % del badge genere/rating in basso. Default 100. */
  genreBadgeScale?: number | null
  /** Offset px del badge genere/rating — solo stili non-bar. */
  genreBadgeOffsetX?: number | null
  genreBadgeOffsetY?: number | null
  /** Scala % del badge qualità (streaming). Default 100. */
  qualityBadgeScale?: number | null
  /** Offset px del badge qualità. */
  qualityBadgeOffsetX?: number | null
  qualityBadgeOffsetY?: number | null
  /**
   * Per-ITEM corrections (single rating pill / single quality-AV mark) by
   * stable identity, in canonical wire form (`badge-item-transforms`).
   * Absent/null = automatic layout (byte-identical historic render).
   */
  badgeItemTransforms?: string | null
  /** Scala % del logo network. Default 100. */
  networkLogoScale?: number | null
  /** Offset px del logo network. */
  networkLogoOffsetX?: number | null
  networkLogoOffsetY?: number | null
  /**
   * Scala % del badge EXTRA superiore (default 100). Offset solo stili
   * centrati. Null/assente = fallback legacy sul tuning classifica
   * (`topBadgeScale/OffsetX/Y`): i due gruppi restano indipendenti solo dopo
   * migrazione esplicita (il primo edit classifica materializza l'extra).
   */
  extraBadgeScale?: number | null
  /** Offset px del badge EXTRA superiore (vedi sopra). */
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  /**
   * Il network segue il layout storico ancorato al titolo (default true).
   * False + nox/noy valorizzati (per-shape) = posizione assoluta. Null/assente
   * = eredita (mai adattivi impliciti).
   */
  networkLogoFollowTitle?: boolean | null
  backdropPath?: string | null
  backdropScale?: number | null
  backdropOffsetX?: number | null
  backdropOffsetY?: number | null
  showBadges?: boolean | null
  genreName?: string | null
  voteAverage?: number | null
  trendRank?: number | null
  trendPeriod?: string | null
  accentColor?: string | null
  tvType?: string | null
  tvStatus?: string | null
  badgeExtra?: string | null
  badgeRank?: number | null
  badgeLabel?: string | null
  animeRank?: number | null
  customBadge?: string | null
  badgePresetId?: string | null
  badgePresetRev?: string | null
  /**
   * Retired Badge Lab bindings (custom badge library removed): inert stored
   * keys, never rendered. Sparse map family -> {id, rev} | null, kept
   * validating and round-tripping so legacy mappings survive untouched.
   * Flat = portrait fallback for the landscape profile (merged per family,
   * see effectiveMappingForShape).
   */
  badgePresets?: RetiredBadgeFamilyBindings | null
  /**
   * Retired Badge Lab follow flags (custom badge library removed): inert
   * stored keys, never rendered. Sparse opt-in `true` per family, kept
   * validating and round-tripping so legacy mappings survive untouched.
   */
  badgePresetFollows?: RetiredBadgeFamilyFollows | null
  releaseDate?: string | null
  firstAirDate?: string | null
  rankingBadges?: boolean | null
  badgeGenre?: boolean | null
  badgeYear?: boolean | null
  badgeRating?: boolean | null
  badgeQuality?: boolean | null
  /**
   * Badge età per-titolo (default OFF). Null/assente = eredita i default
   * effettivi di forma (mai migrazione in lettura dei mapping vecchi).
   * False esplicito vince su un default ON (stesso contratto degli altri
   * toggle per-titolo).
   */
  ageBadge?: boolean | null
  /**
   * Paese della classificazione età per-titolo ("IT" = resa storica).
   * Null/assente/invalido = eredita i default effettivi di forma
   * (fail-closed: mai fallback cross-country, mai GLOBAL).
   */
  ageCountry?: string | null
  /**
   * Stile della pill età per-titolo ("standard" = resa storica).
   * Null/assente/invalido = eredita i default effettivi di forma.
   */
  ageBadgeStyle?: AgeBadgeStyle | null
  /** Riga rating custom provider (display). Default ON quando il provider è configurato. */
  customRatings?: boolean | null
  /** Fonti del voto medio ★ per-titolo (catena: query `rsrc` > mapping >
   * config token > server defaults > imdb+tmdb). Assente nei mapping vecchi
   * (seguono i default finché non risalvati). */
  ratingSources?: string[] | null
  /** Colonna rating separati a destra (sostituisce la media ★). Default OFF. */
  separateRatings?: boolean | null
  /** Scala % della colonna rating separati (default 100 = resa storica). */
  separateBadgeScale?: number | null
  /** Offset px del gruppo rating separati (colonna/pills; bar portrait: solo Y). Default 0. */
  separateBadgeOffsetX?: number | null
  /** Offset px del gruppo rating separati (negativo = su, positivo = giù). Default 0. */
  separateBadgeOffsetY?: number | null
  /**
   * Layout dei rating separati ("column" = colonna destra storica;
   * "bottom-bar"/"bottom-pills" = modalità bottom con genere+anno soppressi
   * solo a render — i flag bg/by salvati restano intatti e tornando a column
   * si ripristinano). Default "column".
   */
  separateRatingsStyle?: SeparateRatingsStyle | null
  /** IMDb ID salvato al save: evita getExternalIds per i poster mappati. */
  imdbId?: string | null
  /** QID Wikidata salvato al save: fast-path REST awards senza SPARQL né
   * fetch TMDB. Assente nei mapping vecchi (restano SPARQL-fallback). */
  wikidataId?: string | null
  badgeStyle?: BadgeStyle | null
  rankingBadgeStyle?: RankingBadgeStyle | null
  /** Standalone extra-badge style (flat-only): absent = legacy `rs` fallback; "follow-rank" = explicit own-rank. */
  extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | null
  /** Font dei testi badge per-titolo ("inter" = resa storica). */
  badgeFont?: BadgeFont | null
  /** Stile icone del badge qualità per-titolo (standard = pill testuale). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /** Formati A/V abilitati per il badge qualità (dv, hdr, hdr10plus, atmos, imax). */
  videoFormats?: VideoFormat[] | null
  blurEnabled?: boolean | null
  blurIntensity?: number | null
  blurFade?: number | null
  blurDarkness?: number | null
  /** Intensità tinta di scena 0-100 (default 20). Solo flat: vale per entrambi i canvas. */
  tintStrength?: number | null
  /** Ombra lineare superiore 0-100 (default 50). Solo flat: vale per entrambi i canvas. */
  topShade?: number | null
  /**
   * Altezza dell'ombra superiore in % del canvas 0-100 (default 25 = look
   * storico). Solo flat: vale per entrambi i canvas. 0 = ombra disattivata
   * qualunque sia `topShade`.
   */
  topShadeHeight?: number | null
  gradientHeight?: number | null
  cleanPosters?: string[] | null
  cleanPosterIndex?: number | null
  cleanPosterUpdatedAt?: string | null
  autoRotateClean?: boolean | null
  /** Rotazione 24h degli sfondi landscape (mirror dei clean poster): lista
   *  candidati, indice corrente, timestamp ultima rotazione, flag auto,
   *  esclusioni permanenti. Indipendente dalla rotazione verticale. */
  cleanBackdrops?: string[] | null
  cleanBackdropIndex?: number | null
  cleanBackdropUpdatedAt?: string | null
  autoRotateBackdrop?: boolean | null
  excludedBackdrops?: string[] | null
  networkLogo?: boolean | null
  /** Posizione del logo network ("auto" = specchio dinamico, "top" = angolo alto lato nastro). */
  networkLogoPosition?: NetworkLogoPosition | null
  ribbonSide?: "left" | "right" | null
  /** Nastro stile Netflix all'angolo (false = badge classifica centrato). Default ON. */
  ribbonEnabled?: boolean | null
  /** Formato canvas per-titolo: "landscape" = 16:9 da backdrop TMDB. Default portrait. */
  posterShape?: PosterShape | null
  /**
   * Graphical poster layout per-titolo ("standard" = resa storica, "fresh" =
   * opt-in). Default standard. Il flat è il profilo verticale E il fallback
   * per il landscape assente; il profilo `landscape` sotto può divergere per
   * formato (stessa regola degli altri condivisi).
   */
  posterLayout?: PosterLayout | null
  /**
   * Fresh apply scope per-titolo ("ranked" = default: solo titoli con rank
   * valido; "all" = override esplicito per tutti i titoli). Stessa regola
   * per-formato del layout (flat + profilo `landscape`).
   */
  posterFreshScope?: PosterFreshScope | null
  /**
   * Seasonal frame choice per-titolo ("halloween"/"christmas" = cornice
   * esplicita che segue il titolo ovunque; "none" = sopprime un tema
   * ereditato dalla lista; null/assente = Automatico, segue la lista di
   * origine). Condiviso tra i formati (flat unico, nessun profilo
   * landscape indipendente): vale per entrambi i canvas, ognuno col
   * proprio asset. Mapping vecchi senza campo = Automatico (invariato).
   */
  seasonalTheme?: import("./seasonal-theme").SeasonalThemeChoice | null
  /**
   * Tuning di resa specifico per il canvas landscape 16:9 (profilo
   * orizzontale). I campi flat restano il profilo verticale E il fallback
   * per ogni chiave landscape assente/null. I mapping senza `landscape` si
   * comportano esattamente come prima (backward compatible).
   */
  landscape?: LandscapeSettings | null
  /** Logo	path TMDB del network/produttore (es. /8AcaW...png) — usato come fallback quando non c'è SVG locale. */
  networkLogoPath?: string | null
  networkLogoName?: string | null
  excludedPosters?: string[] | null
  defaultBadgeStyle?: BadgeStyle | null
  defaultRankingBadgeStyle?: RankingBadgeStyle | null
  logoDisabled?: boolean | null
  bestFitScore?: number | null
  bestFitReasons?: string[] | null
  episodeGroupId?: string | null
}

/**
 * Parametri di resa con tuning separato per formato canvas. Sottoinsieme dei
 * campi di Mapping: tuning visivo (logo, badge, gradienti, blur) PIÙ gli
 * stili/toggle visivi per-titolo (badge, ranking, qualità/formati, network)
 * PIÙ i visuali un tempo condivisi customBadge (extra testuale), accentColor
 * (override manuale) e binding Badge Lab badgePresetId/badgePresetRev
 * (coppia atomica: vedi effectiveMappingForShape). I metadati condivisi
 * (titolo, ratingSources, generi, date, language) e la consegna
 * (posterShape, basi poster/backdrop, rotazioni) restano unici per titolo; i
 * controlli global-only (sash/minQuality/ribbonSide, preRelease senza
 * campo per-titolo) seguono i default effettivi per forma. I mapping senza
 * `landscape` si comportano esattamente come prima (chiavi assenti/null =
 * fallback al flat, backward compatible).
 */
export interface LandscapeSettings {
  logoScale?: number | null
  logoOffsetX?: number | null
  logoOffsetY?: number | null
  topBadgeScale?: number | null
  topBadgeOffsetX?: number | null
  topBadgeOffsetY?: number | null
  /** Tuning EXTRA superiore (null/assente = fallback legacy classifica). */
  extraBadgeScale?: number | null
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  genreBadgeScale?: number | null
  genreBadgeOffsetX?: number | null
  genreBadgeOffsetY?: number | null
  qualityBadgeScale?: number | null
  qualityBadgeOffsetX?: number | null
  qualityBadgeOffsetY?: number | null
  /** Per-item corrections (stable identity, canonical wire form). */
  badgeItemTransforms?: string | null
  /** Scala % della colonna rating separati (default 100 = resa storica). */
  separateBadgeScale?: number | null
  /** Offset px del gruppo rating separati (colonna/pills; bar portrait: solo Y). Default 0. */
  separateBadgeOffsetX?: number | null
  /** Offset px del gruppo rating separati (negativo = su, positivo = giù). Default 0. */
  separateBadgeOffsetY?: number | null
  /** Layout dei rating separati (default "column" = colonna storica). */
  separateRatingsStyle?: SeparateRatingsStyle | null
  /** Graphical poster layout ("standard" = resa storica, "fresh" = opt-in). */
  posterLayout?: PosterLayout | null
  /** Fresh apply scope ("ranked" = default: solo con rank; "all" = override esplicito). */
  posterFreshScope?: PosterFreshScope | null
  networkLogoScale?: number | null
  networkLogoOffsetX?: number | null
  networkLogoOffsetY?: number | null
  /** Il network segue il titolo (default true). False + nox/noy = assoluta landscape. Null/assente = eredita. */
  networkLogoFollowTitle?: boolean | null
  gradientHeight?: number | null
  blurEnabled?: boolean | null
  blurIntensity?: number | null
  blurFade?: number | null
  blurDarkness?: number | null
  tintStrength?: number | null
  topShade?: number | null
  /**
   * Altezza dell'ombra superiore in % del canvas 0-100 (default 25 = look
   * storico). 0 = ombra disattivata qualunque sia `topShade`.
   */
  topShadeHeight?: number | null
  /**
   * Stili/toggle visivi per-titolo con indipendenza per formato (stessa
   * regola chiave-per-chiave del tuning sopra: il profilo landscape vince
   * sul flat, assente/null = eredita il flat). Toggle booleani, stili enum,
   * formati A/V come array (per copia, mai alias).
   */
  /** Master badge (default ON). Flat `showBadges`. */
  showBadges?: boolean | null
  /** Master classifica (default ON). */
  rankingBadges?: boolean | null
  /** Componente genere del badge basso (default ON). */
  badgeGenre?: boolean | null
  /** Componente anno del badge basso (default ON). */
  badgeYear?: boolean | null
  /** Componente voto del badge basso (default ON). */
  badgeRating?: boolean | null
  /** Componente qualità del badge basso (default ON). */
  badgeQuality?: boolean | null
  /** Badge età per-titolo (default OFF). Null/assente = eredita il flat. */
  ageBadge?: boolean | null
  /** Paese della classificazione età per-titolo (null/assente = eredita il flat). */
  ageCountry?: string | null
  /** Stile della pill età per-titolo (null/assente = eredita il flat). */
  ageBadgeStyle?: AgeBadgeStyle | null
  /** Riga rating custom provider (display, default ON quando configurato). */
  customRatings?: boolean | null
  /** Colonna rating separati (default OFF). */
  separateRatings?: boolean | null
  /** Stile badge genere/rating ("shadow" = resa storica). */
  badgeStyle?: BadgeStyle | null
  /** Stile badge classifica ("default" = auto-detect). */
  rankingBadgeStyle?: RankingBadgeStyle | null
  /**
   * Stile standalone extra-badge (assente/null = legacy `rs` fallback;
   * "follow-rank" = own-rank esplicito della forma, ombreggia il flat).
   */
  extraBadgeStyle?: ExtraBadgeStyle | ExtraBadgeFollowRank | null
  /** Font dei testi badge ("inter" = resa storica, null = eredita). */
  badgeFont?: BadgeFont | null
  /** Stile icone del badge qualità (null = eredita). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /** Formati A/V abilitati (null = eredita). */
  videoFormats?: VideoFormat[] | null
  /** Logo network (default ON). */
  networkLogo?: boolean | null
  /** Ancoraggio logo network ("auto" = specchio dinamico). */
  networkLogoPosition?: NetworkLogoPosition | null
  /** Nastro stile Netflix all'angolo (default ON). */
  ribbonEnabled?: boolean | null
  /**
   * Badge extra testuale ("Hi", "__badge.today", …; null/"" = selezione
   * automatica). Chiave PRESENTE nel profilo (inclusa null/"") = vince sul
   * flat per la forma landscape; assente = eredita il flat (legacy invariato).
   * Null e "" nel profilo rendono automatica la forma landscape (mai resurrect
   * del flat); segue la selezione automatica del server.
   */
  customBadge?: string | null
  /**
   * Override manuale del colore accent (hex #rgb/#rrggbb; null = automatico).
   * Chiave PRESENTE nel profilo (inclusa null) = vince sul flat; assente =
   * eredita il flat. Solo manuali nel mapping: gli auto effettivi non si
   * congelano mai (il save scrive manual-or-null per forma).
   */
  accentColor?: string | null
  /**
   * Retired Badge Lab binding, COPPIA atomica (vedi effectiveMappingForShape): se UNA
   * delle due chiavi è presente nel profilo (inclusa null), la coppia
   * effettiva landscape viene interamente dal profilo (lato mancante = null,
   * mai il flat); entrambe assenti = eredita la coppia flat. Null/null =
   * nessun binding per la forma (mai resurrect del flat). Inerte: mai reso.
   */
  badgePresetId?: string | null
  /** Vedi sopra (revisione FNV-1a 8 hex del preset). */
  badgePresetRev?: string | null
  /**
   * Profilo landscape della mappa per-family (stessa semantica del flat:
   * merge per family col flat, chiave presente — inclusa null — vince,
   * assente = eredita il flat; mappa null/assente = eredita il flat).
   */
  badgePresets?: RetiredBadgeFamilyBindings | null
  /**
   * Retired Badge Lab follow flags (custom badge library removed): inert
   * stored keys, never rendered. Present `true` = stored verbatim.
   * Only `true` persists; never `__follow__` markers or id values.
   */
  badgePresetFollows?: RetiredBadgeFamilyFollows | null
}

/**
 * Mapping effettivo per il formato richiesto: in landscape i valori non-null
 * di `mapping.landscape` vincono sui campi flat, che restano il fallback
 * chiave-per-chiave. Ritorna lo stesso oggetto quando non c'è overlay da
 * applicare (shape portrait o nessun profilo landscape salvato).
 *
 * Eccezioni con null-esplicito (indipendenza approvata dei visuali un tempo
 * condivisi): per `customBadge`/`accentColor` una chiave PRESENTE nel profilo
 * (inclusa null, per customBadge anche "") vince sul flat — null/"" nel
 * profilo rendono automatica la forma landscape senza resuscitare il flat;
 * assente (`undefined`) = eredita il flat (legacy invariato).
 * Per-item corrections follow the same ownership rule: an explicit profile
 * `badgeItemTransforms: null` shadows the portrait corrections; only an
 * absent key inherits them. Subsequent config/default fallbacks still apply.
 * Il binding preset è atomico a coppia: se UNA tra `badgePresetId`/
 * `badgePresetRev` è presente nel profilo, ENTRAMBE le effettive vengono dal
 * profilo (lato mancante = null, mai il flat) così id/rev non si mescolano
 * mai tra le forme; entrambe assenti = coppia flat. La mappa per-family
 * `badgePresets` fonde invece chiave-per-chiave (vedi mergeRetiredBadgePresetsField).
 */
export function effectiveMappingForShape(mapping: Mapping | null, shape: PosterShape): Mapping | null {
  if (!mapping || shape !== "landscape" || !mapping.landscape) return mapping
  const l = mapping.landscape
  // Binding preset atomico a coppia (vedi sopra): una sola chiave presente
  // nel profilo rende la coppia effettiva interamente di profilo.
  const landOwnsPresetPair = l.badgePresetId !== undefined || l.badgePresetRev !== undefined
  return {
    ...mapping,
    customBadge: l.customBadge !== undefined ? l.customBadge : mapping.customBadge,
    accentColor: l.accentColor !== undefined ? l.accentColor : mapping.accentColor,
    badgePresetId: landOwnsPresetPair ? (l.badgePresetId ?? null) : mapping.badgePresetId,
    badgePresetRev: landOwnsPresetPair ? (l.badgePresetRev ?? null) : mapping.badgePresetRev,
    badgePresets: mergeRetiredBadgePresetsField(mapping.badgePresets, l.badgePresets),
    logoScale: l.logoScale ?? mapping.logoScale,
    logoOffsetX: l.logoOffsetX ?? mapping.logoOffsetX,
    logoOffsetY: l.logoOffsetY ?? mapping.logoOffsetY,
    topBadgeScale: l.topBadgeScale ?? mapping.topBadgeScale,
    topBadgeOffsetX: l.topBadgeOffsetX ?? mapping.topBadgeOffsetX,
    topBadgeOffsetY: l.topBadgeOffsetY ?? mapping.topBadgeOffsetY,
    extraBadgeScale: l.extraBadgeScale ?? mapping.extraBadgeScale,
    extraBadgeOffsetX: l.extraBadgeOffsetX ?? mapping.extraBadgeOffsetX,
    extraBadgeOffsetY: l.extraBadgeOffsetY ?? mapping.extraBadgeOffsetY,
    genreBadgeScale: l.genreBadgeScale ?? mapping.genreBadgeScale,
    genreBadgeOffsetX: l.genreBadgeOffsetX ?? mapping.genreBadgeOffsetX,
    genreBadgeOffsetY: l.genreBadgeOffsetY ?? mapping.genreBadgeOffsetY,
    qualityBadgeScale: l.qualityBadgeScale ?? mapping.qualityBadgeScale,
    qualityBadgeOffsetX: l.qualityBadgeOffsetX ?? mapping.qualityBadgeOffsetX,
    qualityBadgeOffsetY: l.qualityBadgeOffsetY ?? mapping.qualityBadgeOffsetY,
    badgeItemTransforms: l.badgeItemTransforms !== undefined ? l.badgeItemTransforms : mapping.badgeItemTransforms,
    separateBadgeScale: l.separateBadgeScale ?? mapping.separateBadgeScale,
    separateBadgeOffsetX: l.separateBadgeOffsetX ?? mapping.separateBadgeOffsetX,
    separateBadgeOffsetY: l.separateBadgeOffsetY ?? mapping.separateBadgeOffsetY,
    separateRatingsStyle: l.separateRatingsStyle ?? mapping.separateRatingsStyle,
    posterLayout: l.posterLayout ?? mapping.posterLayout,
    posterFreshScope: l.posterFreshScope ?? mapping.posterFreshScope,
    networkLogoScale: l.networkLogoScale ?? mapping.networkLogoScale,
    networkLogoOffsetX: l.networkLogoOffsetX ?? mapping.networkLogoOffsetX,
    networkLogoOffsetY: l.networkLogoOffsetY ?? mapping.networkLogoOffsetY,
    networkLogoFollowTitle: l.networkLogoFollowTitle ?? mapping.networkLogoFollowTitle,
    gradientHeight: l.gradientHeight ?? mapping.gradientHeight,
    blurEnabled: l.blurEnabled ?? mapping.blurEnabled,
    blurIntensity: l.blurIntensity ?? mapping.blurIntensity,
    blurFade: l.blurFade ?? mapping.blurFade,
    blurDarkness: l.blurDarkness ?? mapping.blurDarkness,
    tintStrength: l.tintStrength ?? mapping.tintStrength,
    topShade: l.topShade ?? mapping.topShade,
    topShadeHeight: l.topShadeHeight ?? mapping.topShadeHeight,
    showBadges: l.showBadges ?? mapping.showBadges,
    rankingBadges: l.rankingBadges ?? mapping.rankingBadges,
    badgeGenre: l.badgeGenre ?? mapping.badgeGenre,
    badgeYear: l.badgeYear ?? mapping.badgeYear,
    badgeRating: l.badgeRating ?? mapping.badgeRating,
    badgeQuality: l.badgeQuality ?? mapping.badgeQuality,
    customRatings: l.customRatings ?? mapping.customRatings,
    separateRatings: l.separateRatings ?? mapping.separateRatings,
    // Badge età per-titolo (stessa regola `??` degli altri toggle/stili:
    // null/assente nel profilo = eredita il flat, mai shadow esplicito).
    ageBadge: l.ageBadge ?? mapping.ageBadge,
    ageCountry: l.ageCountry ?? mapping.ageCountry,
    ageBadgeStyle: l.ageBadgeStyle ?? mapping.ageBadgeStyle,
    badgeStyle: l.badgeStyle ?? mapping.badgeStyle,
    rankingBadgeStyle: l.rankingBadgeStyle ?? mapping.rankingBadgeStyle,
    extraBadgeStyle: l.extraBadgeStyle ?? mapping.extraBadgeStyle,
    badgeFont: l.badgeFont ?? mapping.badgeFont,
    qualityBadgeStyle: l.qualityBadgeStyle ?? mapping.qualityBadgeStyle,
    videoFormats: l.videoFormats ?? mapping.videoFormats,
    networkLogo: l.networkLogo ?? mapping.networkLogo,
    networkLogoPosition: l.networkLogoPosition ?? mapping.networkLogoPosition,
    ribbonEnabled: l.ribbonEnabled ?? mapping.ribbonEnabled,
  }
}

/**
 * Merge per-family del profilo landscape: ogni chiave presente nel profilo
 * (inclusa null = clear esplicito) vince sul flat, assente = eredita il
 * flat. Mappa profilo null/assente/non-oggetto = eredita il flat. Lo spread
 * definisce own-properties (mai prototype pollution); chiavi ignote al
 * runtime vengono ignorate dal resolver e rifiutate in validazione.
 */
export function mergeRetiredBadgePresetsField(
  flat: Mapping["badgePresets"],
  land: LandscapeSettings["badgePresets"],
): Mapping["badgePresets"] {
  if (!land || typeof land !== "object") return flat
  return { ...(flat ?? {}), ...land }
}

/**
 * Effective per-shape follow flags (G2 correction c1, pure, never throws).
 *
 * Portrait: the flat flag set. Landscape: profile `true` wins; a profile
 * own map entry (binding or explicit null clear) pins the shape and shadows
 * an inherited flat follow; otherwise the flat flag is inherited. Unknown
 * shapes fail closed to no follows.
 */
export function effectiveFamilyFollows(
  mapping: Mapping | null | undefined,
  shape: PosterShape,
): RetiredBadgeFamilyFollows {
  const out: RetiredBadgeFamilyFollows = {}
  if (!mapping || typeof mapping !== "object") return out
  const flat = mapping.badgePresetFollows
  const flatSet = new Set<string>()
  if (flat && typeof flat === "object" && !Array.isArray(flat)) {
    for (const k of Object.keys(flat)) {
      if ((flat as Record<string, unknown>)[k] === true) flatSet.add(k)
    }
  }
  if (shape !== "landscape") {
    for (const f of flatSet) (out as Record<string, true>)[f] = true
    return out
  }
  const land = mapping.landscape
  const landFollows: Record<string, unknown> =
    land && typeof land === "object" && !Array.isArray(land) &&
    (land as Record<string, unknown>).badgePresetFollows &&
    typeof (land as Record<string, unknown>).badgePresetFollows === "object"
      ? ((land as Record<string, unknown>).badgePresetFollows as Record<string, unknown>)
      : {}
  const landMap: Record<string, unknown> =
    land && typeof land === "object" && !Array.isArray(land) &&
    (land as Record<string, unknown>).badgePresets &&
    typeof (land as Record<string, unknown>).badgePresets === "object"
      ? ((land as Record<string, unknown>).badgePresets as Record<string, unknown>)
      : {}
  const seen = new Set<string>([...flatSet, ...Object.keys(landFollows)])
  for (const f of seen) {
    if (landFollows[f] === true) {
      (out as Record<string, true>)[f] = true
      continue
    }
    if (Object.prototype.hasOwnProperty.call(landMap, f)) continue
    if (flatSet.has(f)) (out as Record<string, true>)[f] = true
  }
  return out
}

export type CustomCatalogType = "movie" | "series" | "mixed"

export interface CustomCatalogConfig {
  id: string
  name: string
  type: CustomCatalogType
  url: string
  enabled?: boolean
  /** Riferimento allo snapshot CSV importato (namespace utente): gli item
   *  vivono server-side, mai nel config token. */
  datasetId?: string
  /** Import da addon Stremio via manifest (MVP): riferimento alla sorgente +
   *  catalogo originale + capacità dichiarate. Quando presente, il ramo
   *  addon preserva ordine/duplicati/ID originali (niente normalizzazione
   *  delle liste custom). */
  addon?: import("./stremio-addon").StremioAddonSource
}
