/**
 * Client TheTVDB (API v4)
 *
 * Utilizzato per il recupero di copertine (still/screencap) e descrizioni
 * degli episodi delle serie TV con trame localizzate in italiano.
 */

import crypto from "node:crypto"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { createCircuitBreaker, parseRetryAfterMs } from "@/lib/circuit-breaker"
import { combineAbortSignals } from "./abort-signal"
import { timedFetch } from "./outbound-stats"

const log = createLogger("tvdb")

const TVDB_BASE = "https://api4.thetvdb.com/v4"
// Override per E2E/mock deterministici (stesso pattern di MDBLIST_API_URL).
const TVDB_API = process.env.TVDB_API_URL || TVDB_BASE
export const ARTWORKS_BASE = "https://artworks.thetvdb.com"

// Phase 4 (Provider Resilience): per-fetch deadline 8000/10000 → 5000ms.
const TVDB_TIMEOUT_MS = (() => {
  const raw = envWithFallback("TVDB_TIMEOUT_MS")
  const n = raw ? parseInt(raw, 10) : 5000
  return Number.isFinite(n) && n >= 1000 && n <= 15000 ? n : 5000
})()

// Tetto totale del loop di paginazione episodi (50 pagine max): senza, una
// serie long-running su upstream lento trattiene la route meta fino al
// maxDuration. Scaduto il budget il loop si interrompe e i caller usano il
// fallback (ordinamento standard).
const TVDB_EPISODES_BUDGET_MS = (() => {
  const raw = envWithFallback("TVDB_EPISODES_BUDGET_MS")
  const n = raw ? parseInt(raw, 10) : 20000
  return Number.isFinite(n) && n >= 5000 && n <= 60000 ? n : 20000
})()

// Fail-open breaker condiviso (stesso host per login/search/extended/
// episodes): 5 fallimenti → 60s cooldown. Mentre è aperto ogni funzione
// ritorna subito il suo fallback (null/[]) senza toccare la rete.
const tvdbBreaker = createCircuitBreaker({ name: "tvdb", failureThreshold: 5, backoffMs: 60_000 })

/** Solo per i test: azzera lo stato del breaker TVDB. */
export function __resetTvdbBreaker(): void {
  tvdbBreaker.reset()
}

export function isTvdbBreakerOpen(): boolean {
  return tvdbBreaker.isOpen()
}

/**
 * Singolo fetch TVDB con breaker + timeout. Ritorna null su circuito aperto,
 * throw/timeout, 429/5xx (con record) — i caller trattano null come il
 * precedente ramo !ok (fallback standard). Altri 4xx: Response intatta, fail
 * veloce senza scattare (stesso contratto dei breaker MDBList/JustWatch).
 */
async function tvdbFetch(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response | null> {
  if (signal?.aborted) return null
  if (tvdbBreaker.isOpen()) return null
  try {
    const res = await timedFetch(url, { ...init, signal: combineAbortSignals(signal, timeoutMs) })
    if (res.status === 429 || res.status >= 500) {
      tvdbBreaker.recordFailure(parseRetryAfterMs((n) => res.headers.get(n)))
      return null
    }
    if (!res.ok) return null
    tvdbBreaker.recordSuccess()
    return res
  } catch (e) {
    // Abort esterno (deadline render): niente rete sprecata e soprattutto
    // niente recordFailure — la scadenza non è un outage upstream e non deve
    // aprire il circuito a torto.
    if (signal?.aborted) return null
    tvdbBreaker.recordFailure()
    log.error("TVDB fetch failed", { url, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

// Token cache: JWT valido fino a 25 giorni (TVDB fornisce token da 30 giorni)
const tokenCache = new Map<string, { token: string; expiry: number }>()
const inflightTokens = new Map<string, Promise<string | null>>()

// Remote ID cache: (es. tt6468322 -> tvdbId)
const remoteIdCache = new Map<string, { tvdbId: number; expiry: number }>()

// Episodes cache: (tvdbId:lang:seasonType -> TvdbEpisode[])
const episodesCache = new Map<string, { episodes: TvdbEpisode[]; expiry: number }>()

// SeasonTypes cache: (tvdbId -> TvdbSeasonType[])
const seasonTypesCache = new Map<string, { types: TvdbSeasonType[]; expiry: number }>()

const CACHE_TTL_REMOTE = 24 * 60 * 60 * 1000 // 24 ore
const CACHE_TTL_EPISODES = 6 * 60 * 60 * 1000 // 6 ore
const CACHE_TTL_SEASONTYPES = 24 * 60 * 60 * 1000 // 24 ore

const MAX_TOKEN_ENTRIES = 50
const MAX_REMOTE_ENTRIES = 1000
const MAX_EPISODE_ENTRIES = 200

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (map.size >= maxEntries) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16)
}

/** Pulisce le cache in-memory TVDB (utile per test o reload manuale) */
export function clearTvdbCache(): void {
  tokenCache.clear()
  inflightTokens.clear()
  remoteIdCache.clear()
  movieIdCache.clear()
  episodesCache.clear()
  seasonTypesCache.clear()
  artworksCache.clear()
  tvdbBreaker.reset()
}

export interface TvdbSeasonType {
  id: number
  name: string
  type: string
  alternateName?: string | null
}

export interface TvdbEpisode {
  id: number
  name?: string
  overview?: string
  image?: string
  seasonNumber: number
  number: number
  aired?: string
  runtime?: number
}

interface TvdbEpisodeResponse {
  status: string
  data?: {
    series?: { id: number; name: string }
    episodes?: TvdbEpisode[]
  } | TvdbEpisode[]
  links?: {
    next?: string
    page?: number
    total_pages?: number
  }
}

interface TvdbSearchResponse {
  status: string
  data?: Array<{
    id?: number | string
    tvdb_id?: number | string
    objectID?: string
    name?: string
    type?: string
    series?: { id?: number | string }
    movie?: { id?: number | string }
  }>
}

/**
 * Autentica una chiave API su TheTVDB v4 e restituisce il Bearer token.
 */
export async function getTvdbToken(apiKey: string, signal?: AbortSignal): Promise<string | null> {
  const cleanKey = apiKey.trim()
  if (!cleanKey) return null
  const tokenKey = hashKey(cleanKey)

  const cached = tokenCache.get(tokenKey)
  if (cached && Date.now() < cached.expiry) {
    return cached.token
  }

  const existingInflight = inflightTokens.get(tokenKey)
  if (existingInflight) return existingInflight

  const fetchPromise = (async () => {
    try {
      const res = await tvdbFetch(
        `${TVDB_API}/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apikey: cleanKey }),
        },
        TVDB_TIMEOUT_MS,
        signal,
      )

      if (!res || !res.ok) {
        if (res) log.warn("TVDB login failed", { status: res.status })
        return null
      }

      const json = await res.json()
      const token = json?.data?.token
      if (typeof token === "string" && token.length > 0) {
        // Cache per 25 giorni
        setBounded(tokenCache, tokenKey, { token, expiry: Date.now() + 25 * 24 * 60 * 60 * 1000 }, MAX_TOKEN_ENTRIES)
        return token
      }
      return null
    } catch (e) {
      log.error("TVDB login exception", { error: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      inflightTokens.delete(tokenKey)
    }
  })()

  inflightTokens.set(tokenKey, fetchPromise)
  return fetchPromise
}

// Remote ID cache per i film (mappa separata: gli id serie/film vivono in
// namespace diversi su TVDB).
const movieIdCache = new Map<string, { tvdbId: number; expiry: number }>()

// Artworks cache: (movie|tv:tvdbId -> artworks), 6h come gli episodi.
const artworksCache = new Map<string, { arts: TvdbArtwork[]; expiry: number }>()
const CACHE_TTL_ARTWORKS = 6 * 60 * 60 * 1000 // 6 ore
const MAX_ARTWORK_ENTRIES = 200

/**
 * Trova l'ID numerico TheTVDB di una serie partendo da un IMDb ID (es. "tt6468322") o TMDB ID.
 */
export async function getTvdbSeriesId(remoteId: string, apiKey: string, signal?: AbortSignal): Promise<number | null> {
  return getTvdbIdByRemoteId("series", remoteId, apiKey, remoteIdCache, signal)
}

/**
 * Trova l'ID numerico TheTVDB di un film partendo da un IMDb ID o TMDB ID.
 * Spec v4: `/search/remoteid` ritorna `{ movie: { id } }` come per le serie.
 */
export async function getTvdbMovieId(remoteId: string, apiKey: string, signal?: AbortSignal): Promise<number | null> {
  return getTvdbIdByRemoteId("movie", remoteId, apiKey, movieIdCache, signal)
}

async function getTvdbIdByRemoteId(
  kind: "series" | "movie",
  remoteId: string,
  apiKey: string,
  cache: Map<string, { tvdbId: number; expiry: number }>,
  signal?: AbortSignal,
): Promise<number | null> {
  const cleanRemoteId = remoteId.trim()
  if (!cleanRemoteId) return null

  const cached = cache.get(cleanRemoteId)
  if (cached && Date.now() < cached.expiry) {
    return cached.tvdbId
  }

  const token = await getTvdbToken(apiKey, signal)
  if (!token) return null

  try {
    const res = await tvdbFetch(
      `${TVDB_API}/search/remoteid/${encodeURIComponent(cleanRemoteId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      TVDB_TIMEOUT_MS,
      signal,
    )

    if (!res || !res.ok) {
      if (res) log.warn("TVDB search by remoteid failed", { status: res.status, remoteId: cleanRemoteId })
      return null
    }

    const json = (await res.json()) as TvdbSearchResponse
    const results = json?.data
    if (!Array.isArray(results) || results.length === 0) return null

    // Estrae il primo ID valido (decodifica difensiva: la spec dichiara
    // `{ series: {...} }` / `{ movie: {...} }`, con fallback agli id piatti)
    for (const item of results) {
      const rawId = (kind === "series" ? item?.series?.id : (item as { movie?: { id?: number | string } })?.movie?.id)
        ?? item.tvdb_id ?? item.id
      if (rawId) {
        const numId = typeof rawId === "number" ? rawId : parseInt(String(rawId), 10)
        if (Number.isFinite(numId) && numId > 0) {
          setBounded(cache, cleanRemoteId, { tvdbId: numId, expiry: Date.now() + CACHE_TTL_REMOTE }, MAX_REMOTE_ENTRIES)
          return numId
        }
      }
    }
    return null
  } catch (e) {
    log.error("TVDB search remoteid exception", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Recupera i seasonTypes disponibili per una serie (es. official, dvd, absolute, alternative).
 * Usato per esporre tutti gli ordinamenti TVDB (La Casa de Papel ne ha 2).
 */
export async function getTvdbSeasonTypes(tvdbSeriesId: number, apiKey: string, signal?: AbortSignal): Promise<TvdbSeasonType[]> {
  const cacheKey = `st:${tvdbSeriesId}`
  const cached = seasonTypesCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.types

  const token = await getTvdbToken(apiKey, signal)
  if (!token) return []

  try {
    const res = await tvdbFetch(
      `${TVDB_API}/series/${tvdbSeriesId}/extended`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
      TVDB_TIMEOUT_MS,
      signal,
    )
    if (!res || !res.ok) {
      if (res) log.warn("TVDB series extended failed", { status: res.status, tvdbSeriesId })
      return []
    }
    const json = await res.json()
    const data = json?.data as Record<string, unknown> | undefined
    if (!data) return []

    const typesMap = new Map<string, TvdbSeasonType>()

    // 1. Controlla data.seasonTypes se presente direttamente
    if (Array.isArray(data.seasonTypes)) {
      for (const item of data.seasonTypes) {
        const r = item as Record<string, unknown>
        const id = Number(r.id)
        const typeStr = String(r.type || r.name || "").trim().toLowerCase()
        const name = String(r.name || r.type || "Order").trim()
        if (typeStr && Number.isFinite(id)) {
          typesMap.set(typeStr, {
            id,
            name,
            type: typeStr,
            alternateName: (r.alternateName as string | null) ?? null,
          })
        }
      }
    }

    // 2. Controlla data.seasons per estrarre tutti i tipi di stagione presenti per la serie
    if (Array.isArray(data.seasons)) {
      for (const s of data.seasons) {
        const seasonObj = s as Record<string, unknown>
        if (seasonObj?.type && typeof seasonObj.type === "object") {
          const st = seasonObj.type as Record<string, unknown>
          const id = Number(st.id)
          const typeStr = String(st.type || st.name || "").trim().toLowerCase()
          const name = String(st.name || st.type || "Order").trim()
          if (typeStr && !typesMap.has(typeStr)) {
            typesMap.set(typeStr, {
              id: Number.isFinite(id) ? id : typesMap.size + 1,
              name,
              type: typeStr,
              alternateName: (st.alternateName as string | null) ?? null,
            })
          }
        }
      }
    }

    let list = Array.from(typesMap.values())

    // Se la serie esiste ma non ha seasonTypes espliciti, fallback a Aired Order
    if (list.length === 0 && data.id) {
      list = [
        { id: 1, name: "Aired Order", type: "official", alternateName: null }
      ]
    }

    if (list.length > 0) {
      setBounded(seasonTypesCache, cacheKey, { types: list, expiry: Date.now() + CACHE_TTL_SEASONTYPES }, 100)
    }
    return list
  } catch (e) {
    log.error("TVDB seasonTypes exception", { error: e instanceof Error ? e.message : String(e) })
    return []
  }
}

export interface TvdbArtwork {
  image: string
  thumbnail?: string | null
  language?: string | null
  width?: number
  height?: number
  score?: number
  includesText?: boolean
}

/**
 * Artwork poster di una serie/film da TheTVDB (spec v4: `ArtworkBaseRecord`
 * `{ image, thumbnail, language, type, width, height, includesText, score }`).
 * Serie: `GET /series/{id}/artworks` (leggero); film: `/movies/{id}/extended`
 * di default (include `artworks`, niente endpoint dedicato). Parsing
 * difensivo: la spec dichiara per le serie un `SeriesExtendedRecord`, il
 * server risponde con array o `{ artworks: [] }` — si accettano entrambi.
 * Sotto breaker+timeout condivisi (fail-open → []).
 */
export async function getTvdbArtworks(
  mediaType: "movie" | "tv",
  tvdbId: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<TvdbArtwork[]> {
  if (!tvdbId || tvdbId <= 0 || !apiKey) return []
  const cacheKey = `${mediaType}:${tvdbId}`
  const cached = artworksCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.arts

  const token = await getTvdbToken(apiKey, signal)
  if (!token) return []

  try {
    const url = mediaType === "tv"
      ? `${TVDB_API}/series/${tvdbId}/artworks`
      : `${TVDB_API}/movies/${tvdbId}/extended`
    const res = await tvdbFetch(
      url,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
      TVDB_TIMEOUT_MS,
      signal,
    )
    if (!res || !res.ok) {
      if (res) log.warn("TVDB artworks fetch failed", { status: res.status, mediaType, tvdbId })
      return []
    }
    const json = (await res.json().catch(() => null)) as {
      data?: unknown
    } | null
    const data = json?.data
    const raw: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as { artworks?: unknown })?.artworks)
        ? (data as { artworks: unknown[] }).artworks
        : []
    const arts: TvdbArtwork[] = []
    for (const item of raw) {
      if (!item || typeof item !== "object") continue
      const r = item as Record<string, unknown>
      if (typeof r.image !== "string" || !r.image) continue
      arts.push({
        image: r.image,
        thumbnail: typeof r.thumbnail === "string" ? r.thumbnail : null,
        language: typeof r.language === "string" ? r.language : null,
        width: typeof r.width === "number" ? r.width : undefined,
        height: typeof r.height === "number" ? r.height : undefined,
        score: typeof r.score === "number" ? r.score : undefined,
        includesText: typeof r.includesText === "boolean" ? r.includesText : undefined,
      })
    }
    setBounded(artworksCache, cacheKey, { arts, expiry: Date.now() + CACHE_TTL_ARTWORKS }, MAX_ARTWORK_ENTRIES)
    return arts
  } catch (e) {
    log.error("TVDB artworks exception", { error: e instanceof Error ? e.message : String(e) })
    return []
  }
}

/**
 * Sceglie il miglior poster 2:3 dagli artwork TVDB (funzione pura, testabile).
 * Solo portrait (o dimensioni ignote); textless (`includesText === false`)
 * batte sempre il testo; a parità vince la lingua (null > preferita > eng >
 * altre) e poi lo score TVDB.
 */
export function pickTvdbPoster(
  artworks: readonly TvdbArtwork[],
  preferredLanguage?: string | null,
): TvdbArtwork | null {
  const pref = (preferredLanguage || "").toLowerCase()
  const scored: { art: TvdbArtwork; rank: number; score: number }[] = []
  for (const art of artworks) {
    if (!art.image) continue
    const w = art.width ?? 0
    const h = art.height ?? 0
    if (w > 0 && h > 0 && w >= h) continue
    const lang = (art.language || "").toLowerCase()
    const langRank = !lang ? 0 : lang === pref ? 1 : lang === "eng" || lang === "en" ? 2 : 3
    scored.push({ art, rank: (art.includesText === false ? 0 : 10) + langRank, score: art.score ?? 0 })
  }
  scored.sort((a, b) => a.rank - b.rank || b.score - a.score)
  return scored[0]?.art ?? null
}

export interface TvdbEpisodesResult {
  episodes: TvdbEpisode[];
  /**
   * False when pagination was interrupted (budget/timeout/error/page cap):
   * the list may be truncated and must never land in long-lived caches
   * (source/meta/preview). Partial data stays available to be served
   * with a short TTL + retry.
   */
  complete: boolean;
}

/**
 * Fetches the episode list with plots and still covers from TheTVDB,
 * reporting pagination completeness. Only complete results are cached
 * (6h); interrupted ones are never cached so truncated lists cannot
 * poison source, meta, and preview.
 */
export async function getTvdbEpisodesResult(tvdbSeriesId: number, language = "ita", apiKey: string, seasonType: string = "default", signal?: AbortSignal, budgetUntilParam?: number): Promise<TvdbEpisodesResult> {
  const normalizedType = seasonType?.trim() || "default"
  const cacheKey = `${tvdbSeriesId}:${language}:${normalizedType}`
  const cached = episodesCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) {
    // Only complete results reach the cache (see below): hit == complete.
    return { episodes: cached.episodes, complete: true }
  }

  const token = await getTvdbToken(apiKey, signal)
  if (!token) return { episodes: [], complete: false }

  const allEpisodes: TvdbEpisode[] = []
  try {
    let page = 0
    let hasMore = true
    let interrupted = signal?.aborted === true
    const budgetUntil = budgetUntilParam ?? (Date.now() + TVDB_EPISODES_BUDGET_MS)

    // Fix M5: cap alzato da 10 a 50 pagine (100 ep/page → 5000 ep) per serie
    // long-running (es. One Piece >1000 ep). Il loop termina comunque su
    // total_pages quando disponibile, il cap è solo safety bound.
    while (hasMore && page < 50) {
      // Budget totale: su upstream lento interrompe il loop invece di
      // trattenere la route meta fino al maxDuration (fallback standard).
      if (Date.now() >= budgetUntil) {
        interrupted = true
        break
      }
      const langSegment = language && language !== "default" ? `/${encodeURIComponent(language)}` : ""
      const url = `${TVDB_API}/series/${tvdbSeriesId}/episodes/${encodeURIComponent(normalizedType)}${langSegment}?page=${page}`
      const res = await tvdbFetch(
        url,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        },
        TVDB_TIMEOUT_MS,
        signal,
      )

      if (!res || !res.ok) {
        // If the specific language (e.g. ita) fails or has no episodes, retry with the default (honoring the remaining budget)
        if (page === 0 && language !== "default" && Date.now() < budgetUntil) {
          return getTvdbEpisodesResult(tvdbSeriesId, "default", apiKey, normalizedType, signal, budgetUntil)
        }
        interrupted = true
        break
      }

      const json = (await res.json()) as TvdbEpisodeResponse
      let epList: TvdbEpisode[] = []

      if (Array.isArray(json?.data)) {
        epList = json.data
      } else if (Array.isArray(json?.data?.episodes)) {
        epList = json.data.episodes
      }

      // Controllo paginazione
      const totalPages = json.links?.total_pages

      if (epList.length === 0) {
        // Empty page while more pages are expected = interruption, not end.
        if (typeof totalPages === "number" && page + 1 < totalPages) interrupted = true
        break
      }

      for (const ep of epList) {
        if (ep.image) {
          ep.image = formatTvdbImageUrl(ep.image)
        }
        allEpisodes.push(ep)
      }

      if (typeof totalPages === "number") {
        page++
        hasMore = page < totalPages
      } else {
        hasMore = false
      }
    }

    // Loop exit with pages left over (safety page cap) = truncated.
    if (hasMore) interrupted = true

    if (!interrupted && allEpisodes.length > 0) {
      setBounded(episodesCache, cacheKey, { episodes: allEpisodes, expiry: Date.now() + CACHE_TTL_EPISODES }, MAX_EPISODE_ENTRIES)
    }

    return { episodes: allEpisodes, complete: !interrupted }
  } catch (e) {
    log.error("TVDB getEpisodes exception", { error: e instanceof Error ? e.message : String(e) })
    // Keep the partial rows collected so far, marked as incomplete.
    return { episodes: allEpisodes, complete: false }
  }
}

/**
 * Fetches the episode list with plots and still covers from TheTVDB.
 * Thin wrapper over getTvdbEpisodesResult; pagination completeness is dropped here.
 */
export async function getTvdbEpisodes(tvdbSeriesId: number, language = "ita", apiKey: string, seasonType: string = "default", signal?: AbortSignal, budgetUntilParam?: number): Promise<TvdbEpisode[]> {
  return (await getTvdbEpisodesResult(tvdbSeriesId, language, apiKey, seasonType, signal, budgetUntilParam)).episodes
}

/** Formatta l'URL immagine TVDB aggiungendo il base URL se necessario. */
export function formatTvdbImageUrl(imagePath?: string | null): string | undefined {
  if (!imagePath || typeof imagePath !== "string") return undefined
  const clean = imagePath.trim()
  if (!clean) return undefined
  if (clean.startsWith("http://") || clean.startsWith("https://")) return clean
  return `${ARTWORKS_BASE}${clean.startsWith("/") ? "" : "/"}${clean}`
}

/**
 * Enriches Stremio videos with cover screencaps and plots from TheTVDB,
 * reporting whether enrichment is complete. Returns false when the TVDB
 * fetch was interrupted (TMDB videos stay intact, never destroyed) so
 * callers can serve with a short TTL and retry. Returns true when there
 * is nothing to do (no confirmed link: intentional no-op) or when
 * enrichment succeeded.
 *
 * Solo link confermati: IMDb id oppure tvdb_id esplicito dagli external_ids
 * TMDB (serve `tmdbApiKey`). NIENTE fallback fuzzy su `remoteid/<tmdbId>`:
 * quel lookup può agganciare un'altra serie (es. il franchise al posto di
 * uno split di stagione) e sovrascrivere nomi/trame corretti con quelli
 * sbagliati. Senza link certo: no-op, restano i dati TMDB.
 */
export async function enrichVideosWithTvdbDetailed(
  videos: Array<{
    id: string
    name?: string
    season: number
    episode: number
    overview?: string
    thumbnail?: string
    released?: string
    rating?: string
  }>,
  imdbId: string | null | undefined,
  tmdbId: number | null | undefined,
  apiKey: string,
  language = "ita",
  tmdbApiKey?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!videos || videos.length === 0 || !apiKey) return true

  // Risoluzione ID TheTVDB: prima IMDb ID, poi tvdb_id dagli external_ids
  // TMDB (con chiave: senza, la chiamata lancia e il ramo resterebbe morto
  // come prima del fix, quando getExternalIds veniva invocato senza chiave).
  let tvdbSeriesId: number | null = null
  if (imdbId) {
    tvdbSeriesId = await getTvdbSeriesId(imdbId, apiKey, signal)
  }
  if (!tvdbSeriesId && tmdbApiKey && tmdbId) {
    try {
      const { getExternalIds } = await import("@/lib/tmdb")
      const ext = await getExternalIds("tv", tmdbId, tmdbApiKey, signal, 5000)
      if (ext?.tvdb_id && ext.tvdb_id > 0) {
        tvdbSeriesId = ext.tvdb_id
      } else if (ext?.imdb_id) {
        tvdbSeriesId = await getTvdbSeriesId(ext.imdb_id, apiKey, signal)
      }
    } catch {}
  }

  if (!tvdbSeriesId) return true

  const { episodes: tvdbEps, complete } = await getTvdbEpisodesResult(tvdbSeriesId, language, apiKey, "default", signal)
  if (!tvdbEps || tvdbEps.length === 0) return complete

  // Costruisce mappa season:number -> TvdbEpisode
  const map = new Map<string, TvdbEpisode>()
  for (const ep of tvdbEps) {
    const s = ep.seasonNumber
    const e = ep.number
    if (typeof s === "number" && typeof e === "number") {
      map.set(`${s}:${e}`, ep)
    }
  }

  for (const v of videos) {
    const match = map.get(`${v.season}:${v.episode}`)
    if (match) {
      if (match.image) {
        const fullImg = formatTvdbImageUrl(match.image)
        if (fullImg) v.thumbnail = fullImg
      }
      if (match.overview && match.overview.trim().length > 0) {
        v.overview = match.overview.trim()
      }
      if (match.name && match.name.trim().length > 0) {
        v.name = match.name.trim()
      }
    }
  }
  return complete
}

/**
 * Enriches Stremio videos with covers (screencaps) and plots from TheTVDB.
 * Thin wrapper over enrichVideosWithTvdbDetailed (see it for the confirmed-link
 * policy); pagination completeness is dropped here.
 */
export async function enrichVideosWithTvdb(
  videos: Array<{
    id: string
    name?: string
    season: number
    episode: number
    overview?: string
    thumbnail?: string
    released?: string
    rating?: string
  }>,
  imdbId: string | null | undefined,
  tmdbId: number | null | undefined,
  apiKey: string,
  language = "ita",
  tmdbApiKey?: string,
  signal?: AbortSignal,
): Promise<void> {
  await enrichVideosWithTvdbDetailed(videos, imdbId, tmdbId, apiKey, language, tmdbApiKey, signal)
}
