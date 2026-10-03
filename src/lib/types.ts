import type { BadgeStyle, RankingBadgeStyle, QualityBadgeStyle } from "./badge-styles"
import type { VideoFormat } from "./av-specs"
/** Formato canvas del poster: verticale standard o orizzontale 16:9 (Nuvio). */
export type PosterShape = "poster" | "landscape"

export function isPosterShape(value: unknown): value is PosterShape {
  return value === "poster" || value === "landscape"
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
}

export function toSearchResult(partial: { id?: number | null; media_type?: string; title?: string | null; name?: string | null; poster_path?: string | null; release_date?: string; first_air_date?: string; vote_average?: number; imdb_id?: string | null }): SearchResult {
  return {
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
  logoPath: string | null
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
  /** Scala % del logo network. Default 100. */
  networkLogoScale?: number | null
  /** Offset px del logo network. */
  networkLogoOffsetX?: number | null
  networkLogoOffsetY?: number | null
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
  releaseDate?: string | null
  firstAirDate?: string | null
  rankingBadges?: boolean | null
  badgeGenre?: boolean | null
  badgeYear?: boolean | null
  badgeRating?: boolean | null
  badgeQuality?: boolean | null
  /** Riga rating custom provider (display). Default ON quando il provider è configurato. */
  customRatings?: boolean | null
  /** Fonti del voto medio ★ per-titolo (catena: query `rsrc` > mapping >
   * config token > server defaults > imdb+tmdb). Assente nei mapping vecchi
   * (seguono i default finché non risalvati). */
  ratingSources?: string[] | null
  /** Colonna rating separati a destra (sostituisce la media ★). Default OFF. */
  separateRatings?: boolean | null
  /** IMDb ID salvato al save: evita getExternalIds per i poster mappati. */
  imdbId?: string | null
  /** QID Wikidata salvato al save: fast-path REST awards senza SPARQL né
   * fetch TMDB. Assente nei mapping vecchi (restano SPARQL-fallback). */
  wikidataId?: string | null
  badgeStyle?: BadgeStyle | null
  rankingBadgeStyle?: RankingBadgeStyle | null
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
  /** Ombra lineare superiore 0-100 (default 0 = spenta). Solo flat: vale per entrambi i canvas. */
  topShade?: number | null
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
 * campi di Mapping: solo quelli di tuning visivo (logo, badge, gradienti,
 * blur). Stili, toggle, metadati condivisi (titolo, rating, generi, date) e
 * base (posterPath/backdropPath) restano unici per titolo.
 */
export interface LandscapeSettings {
  logoScale?: number | null
  logoOffsetX?: number | null
  logoOffsetY?: number | null
  topBadgeScale?: number | null
  topBadgeOffsetX?: number | null
  topBadgeOffsetY?: number | null
  genreBadgeScale?: number | null
  genreBadgeOffsetX?: number | null
  genreBadgeOffsetY?: number | null
  qualityBadgeScale?: number | null
  qualityBadgeOffsetX?: number | null
  qualityBadgeOffsetY?: number | null
  networkLogoScale?: number | null
  networkLogoOffsetX?: number | null
  networkLogoOffsetY?: number | null
  gradientHeight?: number | null
  blurEnabled?: boolean | null
  blurIntensity?: number | null
  blurFade?: number | null
  blurDarkness?: number | null
  tintStrength?: number | null
  topShade?: number | null
}

/**
 * Mapping effettivo per il formato richiesto: in landscape i valori non-null
 * di `mapping.landscape` vincono sui campi flat, che restano il fallback
 * chiave-per-chiave. Ritorna lo stesso oggetto quando non c'è overlay da
 * applicare (shape portrait o nessun profilo landscape salvato).
 */
export function effectiveMappingForShape(mapping: Mapping | null, shape: PosterShape): Mapping | null {
  if (!mapping || shape !== "landscape" || !mapping.landscape) return mapping
  const l = mapping.landscape
  return {
    ...mapping,
    logoScale: l.logoScale ?? mapping.logoScale,
    logoOffsetX: l.logoOffsetX ?? mapping.logoOffsetX,
    logoOffsetY: l.logoOffsetY ?? mapping.logoOffsetY,
    topBadgeScale: l.topBadgeScale ?? mapping.topBadgeScale,
    topBadgeOffsetX: l.topBadgeOffsetX ?? mapping.topBadgeOffsetX,
    topBadgeOffsetY: l.topBadgeOffsetY ?? mapping.topBadgeOffsetY,
    genreBadgeScale: l.genreBadgeScale ?? mapping.genreBadgeScale,
    genreBadgeOffsetX: l.genreBadgeOffsetX ?? mapping.genreBadgeOffsetX,
    genreBadgeOffsetY: l.genreBadgeOffsetY ?? mapping.genreBadgeOffsetY,
    qualityBadgeScale: l.qualityBadgeScale ?? mapping.qualityBadgeScale,
    qualityBadgeOffsetX: l.qualityBadgeOffsetX ?? mapping.qualityBadgeOffsetX,
    qualityBadgeOffsetY: l.qualityBadgeOffsetY ?? mapping.qualityBadgeOffsetY,
    networkLogoScale: l.networkLogoScale ?? mapping.networkLogoScale,
    networkLogoOffsetX: l.networkLogoOffsetX ?? mapping.networkLogoOffsetX,
    networkLogoOffsetY: l.networkLogoOffsetY ?? mapping.networkLogoOffsetY,
    gradientHeight: l.gradientHeight ?? mapping.gradientHeight,
    blurEnabled: l.blurEnabled ?? mapping.blurEnabled,
    blurIntensity: l.blurIntensity ?? mapping.blurIntensity,
    blurFade: l.blurFade ?? mapping.blurFade,
    blurDarkness: l.blurDarkness ?? mapping.blurDarkness,
    tintStrength: l.tintStrength ?? mapping.tintStrength,
    topShade: l.topShade ?? mapping.topShade,
  }
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
