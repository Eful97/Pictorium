/**
 * Notice cards Stremio: un singolo meta informativo quando un catalogo
 * richiede la chiave TMDB ma la richiesta non ne ha una.
 *
 * Sostituisce il vecchio `metas: []` silenzioso. Solo key-missing: gli
 * errori transienti upstream (401/429) restano vuoti con retry.
 *
 * Nessuna chiamata upstream, nessun rendering poster (asset statico
 * `/pictorium.png`), nessuna scrittura in cache: i rami key-missing
 * ritornano prima di ogni `cacheSet`, e la chiave effettiva è già
 * frammento del cache key — configurata la chiave, la notice sparisce.
 */

export const NOTICE_ID_PREFIX = "pictorium:notice:"

export const NOTICE_MISSING_TMDB_KEY = "missing-tmdb-key"
export const NOTICE_MISSING_TVDB_KEY = "missing-tvdb-key"
/** The custom list driving a Top 20 catalog answered with an error status. */
export const NOTICE_CUSTOM_RANKING_UNAVAILABLE = "custom-ranking-unavailable"

export function noticeCatalogId(slug: string = NOTICE_MISSING_TMDB_KEY): string {
  return `${NOTICE_ID_PREFIX}${slug}`
}

export function isNoticeId(id: string): boolean {
  return id.startsWith(NOTICE_ID_PREFIX)
}

export const NOTICE_MISSING_KEY_TITLE = "Chiave TMDB richiesta"

export const NOTICE_MISSING_KEY_DESCRIPTION =
  "Questo catalogo richiede una chiave API TMDB gratuita. " +
  "Configurala nella pagina impostazioni di Pictorium e ricarica."

export const NOTICE_MISSING_TVDB_KEY_TITLE = "Chiave TVDB necessaria"

export const NOTICE_MISSING_TVDB_KEY_DESCRIPTION =
  "Questo catalogo legge una lista TheTVDB e richiede la tua chiave API TVDB. " +
  "Aggiungila nelle impostazioni di Pictorium e ricarica."

export const NOTICE_CUSTOM_RANKING_UNAVAILABLE_TITLE = "Classifica non disponibile"

export const NOTICE_CUSTOM_RANKING_UNAVAILABLE_DESCRIPTION =
  "La lista personalizzata di questa classifica ha risposto con un errore. " +
  "Riprova più tardi o seleziona di nuovo JustWatch nelle impostazioni."

export interface NoticeCatalogMeta {
  id: string
  type: string
  name: string
  poster: string | null
  posterShape?: string
  description?: string
}

export function buildNoticeMeta(options: {
  type: "movie" | "series"
  poster: string
  id?: string
  name?: string
  description?: string
}): NoticeCatalogMeta {
  return {
    id: options.id ?? noticeCatalogId(),
    type: options.type,
    name: options.name ?? NOTICE_MISSING_KEY_TITLE,
    poster: options.poster,
    posterShape: "poster",
    description: options.description ?? NOTICE_MISSING_KEY_DESCRIPTION,
  }
}

export interface NoticeDetailMeta {
  id: string
  type: "movie" | "series"
  name: string
  genres: string[]
  poster: string | null
  description?: string
}

export function buildNoticeDetail(options: {
  id: string
  type: "movie" | "series"
  poster: string
  name?: string
  description?: string
}): NoticeDetailMeta {
  const isTvdb = options.id === noticeCatalogId(NOTICE_MISSING_TVDB_KEY)
  const isCustomRanking = options.id === noticeCatalogId(NOTICE_CUSTOM_RANKING_UNAVAILABLE)
  const fallbackName = isTvdb
    ? NOTICE_MISSING_TVDB_KEY_TITLE
    : isCustomRanking
      ? NOTICE_CUSTOM_RANKING_UNAVAILABLE_TITLE
      : NOTICE_MISSING_KEY_TITLE
  const fallbackDescription = isTvdb
    ? NOTICE_MISSING_TVDB_KEY_DESCRIPTION
    : isCustomRanking
      ? NOTICE_CUSTOM_RANKING_UNAVAILABLE_DESCRIPTION
      : NOTICE_MISSING_KEY_DESCRIPTION
  return {
    id: options.id,
    type: options.type,
    name: options.name ?? fallbackName,
    genres: [],
    poster: options.poster,
    description: options.description ?? fallbackDescription,
  }
}
