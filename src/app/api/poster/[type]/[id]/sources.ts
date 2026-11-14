import type { TextLogo } from "@/lib/text-logo"

/**
 * Sorgenti immagine del render (base poster/backdrop, logo, wordmark) risolte
 * dai tre rami di risoluzione (query / mapping salvato / automatico TMDB) e
 * lette dalle fasi di fetch, preparazione e debug. Un solo oggetto mutabile
 * per render: i rami lo popolano, le fasi successive lo leggono.
 */
export interface PosterArtwork {
  posterPath: string | null
  posterPathBuffer: Buffer | null
  /**
   * Ramo portrait senza clean: path del backdrop da cui è stato ricavato il
   * cover-crop 2:3 della base. Serve solo alla chiave di analisi pixel
   * (`analysisKey`): i byte sono un crop, non il poster nominale.
   */
  portraitBackdropCropPath: string | null
  /**
   * Ramo mapping: backdrop congelato al save (`portraitBackdropPath`, solo
   * portrait) da cui ricavare la base come cover-crop 2:3. Null = base
   * storica (`mapping.posterPath`), landscape e basi custom invariati.
   */
  mappingPortraitBackdropPath: string | null
  /**
   * Buffer del logo già scaricato dal best-fit (w500): riusato nel Block A per
   * evitare il re-fetch. Assente su cache hit del best-fit o timeout del logo →
   * Block A fa il fetch normale.
   */
  logoPathBuffer: Buffer | null
  logoPath: string | null
  /**
   * Il poster finale del ramo automatico è clean (senza testo incorporato)?
   * Solo TMDB iso_639_1===null. Serve a: (1) non sovrapporre mai il logo a un
   * poster con testo, (2) forzare il profilo blur non-clean sui default
   * iniettati da Stremio (Golden Rule col client).
   */
  autoPosterClean: boolean
  /**
   * Lingua richiesta per artwork/logo (ramo non-mappato; default da posterRegion):
   * serve al blocco debug=1 fuori dallo scope del ramo.
   */
  posterRequestedLang: string
  /**
   * Selezione logo per debug=1: iso scelto + motivo del fallback (null = logo
   * esplicito da query/mapping, nessun fallback applicato).
   */
  logoChosenIso: string | null
  logoFallbackReason: string | null
  backdropPath: string | null
  /**
   * Sfondi TMDB del ramo automatico (details.backdrop_path o primo backdrops
   * di getImages): fallback per la base landscape quando query/mapping non
   * ne forniscono uno.
   */
  autoBackdropPath: string | null
  backdropScale: number
  backdropOffsetX: number
  backdropOffsetY: number
  /**
   * Il ramo non-mappato ha fallito il fetch automatico dei dati TMDB
   * (errore/outage upstream, non titolo inesistente): le risposte da
   * !posterPath devono essere 503, non 404.
   */
  autoFetchFailed: boolean
  /**
   * Text-as-logo (titoli senza logo TMDB): il testo digitato (+ font del
   * bundle, enum badge) è una SORGENTE LOGO alternativa e vince su quella
   * immagine (query > mapping, stessa catena del resto). Testo vuoto = nessun
   * logo (comportamento storico invariato): `resolveTextLogo` ritorna null e
   * tutto il ramo logo resta identico a prima.
   */
  textLogo: TextLogo | null
  /**
   * Provenienza del wordmark: manuale (query/mapping) o automatico (derivato
   * dal titolo). Cambia solo la resa (tracking) e la firma della cache
   * image-level: il testo automatico NON viene mai persistito come logoText.
   */
  textLogoAuto: boolean
}

/**
 * Metadati del titolo (TMDB details, date, studi/network, id esterni) usati
 * dai badge, dal debug e dal recupero dettagli. Popolati dai rami di
 * risoluzione, eventualmente completati dal recupero dettagli in parallelo.
 */
export interface PosterTitleMeta {
  genreName: string | null
  voteAverage: number | null
  releaseDate: string | null
  firstAirDate: string | null
  lastAirDate: string | null
  seasonCount: number | null
  /** TMDB `next_episode_to_air.air_date` + `number_of_episodes` (TV series: New Episode / Only N Episodes inputs). */
  nextEpisodeAirDate: string | null
  numberOfEpisodes: number | null
  originCountries: string[]
  /** ID generi TMDB canonici (16 = Animation) — escludono l'animazione dal K-Drama automatico. */
  genreIds: number[] | null
  tvType: string | null
  tvStatus: string | null
  tmdbStudios: string[]
  tmdbNetworks: string[]
  productionCompanies: string[]
  tmdbNetworksDetailed: { name: string; logoPath: string | null }[]
  productionCompaniesDetailed: { name: string; logoPath: string | null }[]
  imdbId: string | null
  /**
   * TMDB title from the auto branch, kept in scope for the JustWatch match:
   * the session cache is a small LRU and can be evicted mid-render.
   */
  autoTitle: string | null
  /**
   * QID Wikidata per il fast-path REST awards (wbgetentities, ~150ms) invece
   * della lotteria SPARQL (4-13s contro race da 2.5s). Catena: query
   * `wikidata_id` (la preview lo ha già dai details, zero RTT) > mapping
   * salvato > session cache TMDB del processo > resolve server-side con memo
   * 7gg (quarto anello, prima della race) > ramo else (details +
   * external_ids in append). Senza QID ovunque: fallback SPARQL invariato.
   * F2: the session cache is language-isolated — reads use the same
   * query > mapping > region chain as the branches that populate it (it
   * matches preferredLanguage when mapping is null, and fbLang of the
   * landscape fallback).
   */
  wikidataId: string | null
}
