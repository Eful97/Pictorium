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
// Also serves as the aggregate gallery budget (see the tvdb artworks route).
export const TVDB_TIMEOUT_MS = (() => {
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

// Artworks cache: (movie|tv:tvdbId -> artworks), 6h hits like episodes.
// Confirmed-empty responses use a short 10min TTL (Fanart negative-cache
// pattern) so titles without artworks revalidate quickly; failures are
// never cached. Both getTvdbArtworks (rescue, fail-open) and the strict
// gallery fetch share this map and these TTLs. `validated` marks a proven
// strict envelope (top-level array or `{ artworks: [] }`, or a 404): the
// strict reader trusts only validated entries, so an unvalidated legacy
// fail-open empty (malformed JSON / wrong shape) can never poison the
// gallery. Legacy rescue reads any entry (fail-open); strict writes are
// always validated.
const artworksCache = new Map<string, { arts: TvdbArtwork[]; expiry: number; validated: boolean }>()
const CACHE_TTL_ARTWORKS = 6 * 60 * 60 * 1000 // 6 ore
const CACHE_TTL_ARTWORKS_EMPTY = 10 * 60 * 1000 // 10 minuti (assenza confermata)
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
 * Strict TVDB id lookup for the gallery: same shared login/token layer and
 * the same `/search/remoteid` endpoint as the legacy matcher, but lookup
 * failures propagate as typed errors instead of collapsing to null.
 *
 * - Missing key throws `not_configured`; a null token throws `auth`, except
 *   with an open breaker (sustained upstream outage), which throws
 *   `upstream` — checked BEFORE the id cache so a cached mapping can never
 *   mask a bad key. Aborted callers throw `timeout`.
 * - 401/403 throw `auth`; network/429/5xx throw `upstream`; invalid JSON
 *   throws `upstream`; any other 4xx throws `upstream`.
 * - Genuine absence returns null (cacheable-empty at the route level):
 *   404, an empty result list, or results without a usable numeric id.
 *   Positive hits reuse the same id caches as the legacy matcher.
 * The legacy nullable matcher below is unchanged for the render pipeline.
 */
export async function getTvdbSeriesIdStrict(remoteId: string, apiKey: string, signal?: AbortSignal): Promise<number | null> {
  return getTvdbIdByRemoteIdStrict("series", remoteId, apiKey, remoteIdCache, signal)
}

export async function getTvdbMovieIdStrict(remoteId: string, apiKey: string, signal?: AbortSignal): Promise<number | null> {
  return getTvdbIdByRemoteIdStrict("movie", remoteId, apiKey, movieIdCache, signal)
}

async function getTvdbIdByRemoteIdStrict(
  kind: "series" | "movie",
  remoteId: string,
  apiKey: string,
  cache: Map<string, { tvdbId: number; expiry: number }>,
  signal?: AbortSignal,
): Promise<number | null> {
  const cleanRemoteId = remoteId.trim()
  if (!cleanRemoteId) return null
  const cleanKey = (apiKey || "").trim()
  if (!cleanKey) throw new TvdbArtworksError("not_configured", "TVDB API key is not configured")
  if (signal?.aborted) throw new TvdbArtworksError("timeout", "TVDB request aborted")

  // Auth-before-cache, mirroring getTvdbArtworksStrict. A null token with an
  // open breaker is a sustained upstream outage (401s never trip it).
  const token = await getTvdbToken(cleanKey, signal)
  if (signal?.aborted) throw new TvdbArtworksError("timeout", "TVDB request aborted")
  if (!token) {
    if (isTvdbBreakerOpen()) throw new TvdbArtworksError("upstream", "TVDB login unavailable")
    throw new TvdbArtworksError("auth", "TVDB login failed (invalid key or login unavailable)")
  }

  const cached = cache.get(cleanRemoteId)
  if (cached && Date.now() < cached.expiry) {
    return cached.tvdbId
  }

  let res: Response
  try {
    res = await timedFetch(
      `${TVDB_API}/search/remoteid/${encodeURIComponent(cleanRemoteId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: combineAbortSignals(signal, TVDB_TIMEOUT_MS),
      },
    )
  } catch (e) {
    if (isTvdbTimeoutError(e) || signal?.aborted) throw new TvdbArtworksError("timeout", "TVDB id lookup timed out")
    log.warn("TVDB strict remoteid network failure", { remoteId: cleanRemoteId })
    throw new TvdbArtworksError("upstream", "TVDB id lookup unavailable")
  }
  if (res.status === 401 || res.status === 403) throw new TvdbArtworksError("auth", "TVDB rejected the API key")
  if (res.status === 404) return null
  if (res.status === 429 || res.status >= 500) throw new TvdbArtworksError("upstream", `TVDB id lookup responded with status ${res.status}`)
  if (!res.ok) throw new TvdbArtworksError("upstream", `TVDB id lookup responded with status ${res.status}`)
  let json: TvdbSearchResponse
  try {
    json = (await res.json()) as TvdbSearchResponse
  } catch {
    throw new TvdbArtworksError("upstream", "TVDB id lookup returned invalid JSON")
  }
  const results = json?.data
  if (!Array.isArray(results) || results.length === 0) return null

  // First usable numeric id wins (same defensive decoding as the legacy
  // matcher: `{ series: { id } }` / `{ movie: { id } }`, flat-id fallback).
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
  /**
   * Numeric TVDB artwork `type` id (`ArtworkBaseRecord.type`), preserved
   * additively so per-kind grouping is possible. `null`/missing = legacy
   * payload without a type (never guessed into a group by callers that
   * group; the rescue picker treats it as a legacy candidate).
   */
  type?: number | null
}

/**
 * Authoritative TVDB artwork `type`-id whitelist (verified against current
 * official TVDB v4 docs at build time via Context7 + official repos).
 *
 * Provenance:
 * - Official swagger `GET /artwork/types` is the authoritative id table
 *   (https://github.com/thetvdb/v4-api/blob/main/docs/swagger.yml):
 *   `ArtworkBaseRecord.type` is numeric.
 * - Official TVDB-owned movie SDK (current):
 *   https://raw.githubusercontent.com/thetvdb/metadata.movies.thetvdb.com.v4.python/main/metadata.movies.thetvdb.com.v4.python/resources/lib/movies.py
 *   declares movie POSTER = 14, BACKGROUND = 15, CLEARLOGO = 25.
 * - Official API repo issue #106 (`/artwork/types` response): series
 *   Poster = 2, Background = 3, ClearLogo = 23 (seasonPoster = 7 is
 *   deliberately NOT a series poster).
 * - Official API repo issue #194 (maintainer): 2 = poster, 3 = background.
 * - ClearArt 22/24 are NOT logos and are never classified as such.
 *
 * Only these six ids are whitelisted. Every other kind (season 7, ClearArt
 * 22/24, banner, icon, artifact, MP4, unknown numerics) is skipped honestly —
 * never inferred from URL substrings (`/poster/`, `/fanart/`) or geometry.
 */
export const TVDB_MOVIE_POSTER_TYPE_ID = 14
export const TVDB_MOVIE_BACKDROP_TYPE_ID = 15
export const TVDB_MOVIE_LOGO_TYPE_ID = 25
export const TVDB_SERIES_POSTER_TYPE_ID = 2
export const TVDB_SERIES_BACKDROP_TYPE_ID = 3
export const TVDB_SERIES_LOGO_TYPE_ID = 23

/** Poster type ids across both media (used when the media is untyped/legacy). */
const TVDB_POSTER_TYPE_IDS: ReadonlySet<number> = new Set([
  TVDB_MOVIE_POSTER_TYPE_ID,
  TVDB_SERIES_POSTER_TYPE_ID,
])

const TVDB_BACKDROP_TYPE_IDS: ReadonlySet<number> = new Set([
  TVDB_MOVIE_BACKDROP_TYPE_ID,
  TVDB_SERIES_BACKDROP_TYPE_ID,
])

const TVDB_LOGO_TYPE_IDS: ReadonlySet<number> = new Set([
  TVDB_MOVIE_LOGO_TYPE_ID,
  TVDB_SERIES_LOGO_TYPE_ID,
])

/** Server gallery caps (deduped safe URLs per group). */
export const TVDB_GALLERY_POSTERS_CAP = 30
export const TVDB_GALLERY_BACKDROPS_CAP = 20
export const TVDB_GALLERY_LOGOS_CAP = 20

/**
 * Gallery leaf for the editor (client-future): TMDB-compatible shape with an
 * explicit TVDB source + preserved type id. The existing rescue response is
 * unchanged — this is a new additive leaf only.
 */
export interface TvdbGalleryImage {
  url: string
  thumbnail: string | null
  language: string | null
  width?: number
  height?: number
  includesText?: boolean
  score?: number
  source: "tvdb"
  type: number | null
}

export interface TvdbGallery {
  posters: TvdbGalleryImage[]
  backdrops: TvdbGalleryImage[]
  logos: TvdbGalleryImage[]
}

/** Typed errors: only these distinguish absence from failure (Fanart pattern). */
export class TvdbArtworksError extends Error {
  readonly code: "not_configured" | "auth" | "upstream" | "timeout"
  constructor(code: TvdbArtworksError["code"], message: string) {
    super(message)
    this.code = code
  }
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
    // Provenance for the shared cache: only a top-level array or
    // `{ artworks: [] }` proves the envelope. Anything else (invalid JSON,
    // missing `data`, wrong shape) stays fail-open [] for rendering but is
    // marked unvalidated so the strict gallery never trusts it as absence.
    const envelopeValid =
      Array.isArray(data) ||
      (data !== null && typeof data === "object" && Array.isArray((data as { artworks?: unknown })?.artworks))
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
        // Additive: preserve the numeric ArtworkBaseRecord.type when present
        // (number or numeric string); missing/unparseable stays null so legacy
        // typeless payloads keep flowing through the rescue picker unchanged.
        type: parseTvdbArtworkType(r.type),
      })
    }
    setBounded(
      artworksCache,
      cacheKey,
      { arts, expiry: Date.now() + (arts.length > 0 ? CACHE_TTL_ARTWORKS : CACHE_TTL_ARTWORKS_EMPTY), validated: envelopeValid },
      MAX_ARTWORK_ENTRIES,
    )
    return arts
  } catch (e) {
    log.error("TVDB artworks exception", { error: e instanceof Error ? e.message : String(e) })
    return []
  }
}

/**
 * Parse the TVDB `ArtworkBaseRecord.type` defensively: finite numbers pass
 * through, numeric strings are coerced, everything else (missing, null,
 * non-numeric strings, NaN, non-positive) becomes null (legacy/unknown —
 * never guessed). Per-kind grouping skips null; the rescue picker treats
 * null as a legacy candidate to avoid regressing typeless fixtures.
 */
function parseTvdbArtworkType(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw)
  if (typeof raw === "string") {
    const t = raw.trim()
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

/**
 * Sceglie il miglior poster 2:3 dagli artwork TVDB (funzione pura, testabile).
 * Solo portrait (o dimensioni ignote); textless (`includesText === false`)
 * batte sempre il testo; a parità vince la lingua (null > preferita > eng >
 * altre) e poi lo score TVDB.
 *
 * Type-guard (additive, no regression): artwork CON type noto devono essere
 * veri poster (2 serie / 14 film); i non-poster noti (backdrop 3/15, logo
 * 23/25, season 7, clearart 22/24, altri) sono esclusi. Artwork SENZA type
 * (null/missing, legacy + vecchi fixture) restano candidati come prima.
 */
export function pickTvdbPoster(
  artworks: readonly TvdbArtwork[],
  preferredLanguage?: string | null,
): TvdbArtwork | null {
  const pref = (preferredLanguage || "").toLowerCase()
  const scored: { art: TvdbArtwork; rank: number; score: number }[] = []
  for (const art of artworks) {
    if (!art.image) continue
    const knownType = parseTvdbArtworkType(art.type)
    if (knownType !== null && !TVDB_POSTER_TYPE_IDS.has(knownType)) continue
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

/**
 * Sceglie il miglior backdrop 16:9 (funzione pura, testabile). Mirror del
 * ranking poster: solo landscape (o dimensioni ignote), textless prima, poi
 * lingua (null > preferita > eng > altre), poi score. Type-guard analogo:
 * con type noto serve un vero backdrop (3 serie / 15 film); senza type
 * (legacy) resta candidato.
 */
export function pickTvdbBackdrop(
  artworks: readonly TvdbArtwork[],
  preferredLanguage?: string | null,
): TvdbArtwork | null {
  const pref = (preferredLanguage || "").toLowerCase()
  const scored: { art: TvdbArtwork; rank: number; score: number }[] = []
  for (const art of artworks) {
    if (!art.image) continue
    const knownType = parseTvdbArtworkType(art.type)
    if (knownType !== null && !TVDB_BACKDROP_TYPE_IDS.has(knownType)) continue
    const w = art.width ?? 0
    const h = art.height ?? 0
    if (w > 0 && h > 0 && h >= w) continue
    const lang = (art.language || "").toLowerCase()
    const langRank = !lang ? 0 : lang === pref ? 1 : lang === "eng" || lang === "en" ? 2 : 3
    scored.push({ art, rank: (art.includesText === false ? 0 : 10) + langRank, score: art.score ?? 0 })
  }
  scored.sort((a, b) => a.rank - b.rank || b.score - a.score)
  return scored[0]?.art ?? null
}

/**
 * Sceglie il miglior logo/clearlogo (funzione pura, testabile). SOLO su type
 * id documentati (25 film / 23 serie); nessuna euristica geometrica o da
 * URL. Senza type noto (legacy) nessun logo viene inventato: ritorna null
 * (honest empty) — i loghi non si indovinano.
 */
export function pickTvdbLogo(artworks: readonly TvdbArtwork[]): TvdbArtwork | null {
  const scored: { art: TvdbArtwork; score: number }[] = []
  for (const art of artworks) {
    if (!art.image) continue
    const knownType = parseTvdbArtworkType(art.type)
    if (knownType === null || !TVDB_LOGO_TYPE_IDS.has(knownType)) continue
    scored.push({ art, score: art.score ?? 0 })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.art ?? null
}

/**
 * Normalizza la lingua TVDB onestamente: i codici sono ISO 639-2 a 3
 * lettere (`eng/ita/spa`), null = neutrale alla lingua. Ritorna il codice
 * in minuscolo così com'è o null per assente/vuoto; MAI "textless" e MAI
 * mapping inventati 2↔3 lettere. La distinzione `includesText === false`
 * (textless) resta sul suo campo, separata dalla lingua.
 */
export function normalizeTvdbLanguage(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const t = raw.trim().toLowerCase()
  if (!t) return null
  if (!/^[a-z]{2,3}$/.test(t)) return t
  return t
}

/**
 * Locale contenuto TMDB (`it`, `it-IT`, `en-GB`, `es-MX`, …) → codice lingua
 * TVDB (ISO 639-2/T: `ita`, `eng`, …). L'endpoint episodi vuole il codice a 3
 * lettere nel path (`/episodes/{seasonType}/{lang}`): senza mapping i titoli
 * TVDB resterebbero sempre in italiano qualunque lingua scelga l'utente.
 * Lingua sconosciuta → `ita` (comportamento storico dei chiamanti).
 */
const TVDB_LANGUAGE_BY_BASE: Record<string, string> = {
  ar: "ara",
  cs: "ces",
  de: "deu",
  en: "eng",
  es: "spa",
  fr: "fra",
  he: "heb",
  it: "ita",
  ja: "jpn",
  ko: "kor",
  nl: "nld",
  pl: "pol",
  pt: "por",
  ro: "ron",
  sv: "swe",
  tr: "tur",
  vi: "vie",
}

export function tvdbLanguageForContentLanguage(lang: string | null | undefined): string {
  const base = typeof lang === "string" ? lang.trim().toLowerCase().split(/[-_]/)[0] : ""
  return TVDB_LANGUAGE_BY_BASE[base] || "ita"
}

const TVDB_SAFE_IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i
const TVDB_KEY_QUERY_RE = /api[_-]?key|apikey|[^a-z]key$|^key[^a-z]|token|auth|secret|password|signature/i

/**
 * Normalizza un URL immagine TVDB a un `https://artworks.thetvdb.com/...`
 * sicuro, oppure null (skip onesto, mai inventato).
 *
 * Accetta: assoluti https con host ESATTO `artworks.thetvdb.com` (niente
 * sottodomini generici, niente lookalike `*.evil.com`), relativi `/...`
 * (prefisso con ARTWORKS_BASE). Rifiuta: userinfo (`@`), porte esplicite,
 * protocolli non-https, query con materiale chiave (`api_key/token/...`),
 * estensioni non-raster (SVG/MP4/GIF/AVIF inclusi: il pipeline raster
 * `validateImageBytes` li rifiuterebbe comunque al fetch), redirect
 * off-host (non seguibili qui: l'URL emesso resta sempre sullo stesso
 * host). Il controllo SSRF pieno (DNS/IP privati) resta al fetch
 * (`safeFetchRemote`/`resolveAndCheckBlocked`), non a questa normalizzazione.
 */
export function normalizeTvdbImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const clean = raw.trim()
  if (!clean || /\s|[<>"\\]/.test(clean)) return null
  // Explicit port on the artworks host (even the https default :443, which
  // URL parsing normalizes away): rejected before parsing so `host:port`
  // never slips through as the bare host.
  if (/artworks\.thetvdb\.com\s*:/i.test(clean)) return null
  try {
    let u: URL
    if (clean.startsWith("/") && !clean.startsWith("//")) {
      u = new URL(`${ARTWORKS_BASE}${clean}`)
    } else {
      u = new URL(clean)
    }
    if (u.protocol !== "https:") return null
    if (u.hostname.toLowerCase() !== "artworks.thetvdb.com") return null
    if (u.username || u.password) return null
    if (u.port) return null
    if (u.search && TVDB_KEY_QUERY_RE.test(u.search)) return null
    // Decoded param-name guard: URLSearchParams decodes % encoding, so bare
    // `?key=`, case variants (`?KEY=`), and encoded forms (`?%6Bey=`) are
    // all caught even though the raw-search regex above misses a bare
    // `?key=` (its `[^a-z]key$` / `^key[^a-z]` anchors are defeated by the
    // leading `?` / trailing `=`). Only names are tested here, so benign
    // values stay accepted unless the pre-existing raw check already
    // rejects them; the raw check above is preserved unchanged (strict).
    for (const name of u.searchParams.keys()) {
      if (name.toLowerCase() === "key" || TVDB_KEY_QUERY_RE.test(name)) return null
    }
    if (!TVDB_SAFE_IMAGE_EXT_RE.test(u.pathname)) return null
    return `https://artworks.thetvdb.com${u.pathname}${u.search}`
  } catch {
    return null
  }
}

function posterTypeFor(mediaType: "movie" | "tv"): number {
  return mediaType === "movie" ? TVDB_MOVIE_POSTER_TYPE_ID : TVDB_SERIES_POSTER_TYPE_ID
}

function backdropTypeFor(mediaType: "movie" | "tv"): number {
  return mediaType === "movie" ? TVDB_MOVIE_BACKDROP_TYPE_ID : TVDB_SERIES_BACKDROP_TYPE_ID
}

function logoTypeFor(mediaType: "movie" | "tv"): number {
  return mediaType === "movie" ? TVDB_MOVIE_LOGO_TYPE_ID : TVDB_SERIES_LOGO_TYPE_ID
}

/**
 * Raggruppa artwork TVDB per kind sul SOLO type id documentato per quel
 * media (film 14/15/25, serie 2/3/23). Item con type ignoto/mancante o kind
 * non supportato (season 7, clearart 22/24, banner, icon, artifact, MP4)
 * sono omessi (mai indovinati in un gruppo). URL normalizzati
 * (`normalizeTvdbImageUrl`), thumbnail non valida → null (l'item resta),
 * lingua normalizzata onesta, metadati preservati (width/height/score/
 * includesText + distinzione textless). Dedup per URL (tiene lo score
 * massimo), ordinati per score desc, cappati (30/20/20). Pura e testabile.
 */
export function classifyTvdbArtworks(
  artworks: readonly TvdbArtwork[],
  mediaType: "movie" | "tv",
): TvdbGallery {
  const wantPoster = posterTypeFor(mediaType)
  const wantBackdrop = backdropTypeFor(mediaType)
  const wantLogo = logoTypeFor(mediaType)
  const posters = new Map<string, TvdbGalleryImage>()
  const backdrops = new Map<string, TvdbGalleryImage>()
  const logos = new Map<string, TvdbGalleryImage>()
  for (const art of artworks) {
    const t = parseTvdbArtworkType(art.type)
    if (t === null) continue
    let bucket: Map<string, TvdbGalleryImage> | null = null
    if (t === wantPoster) bucket = posters
    else if (t === wantBackdrop) bucket = backdrops
    else if (t === wantLogo) bucket = logos
    else continue
    const url = normalizeTvdbImageUrl(art.image)
    if (!url) continue
    const thumbRaw = typeof art.thumbnail === "string" && art.thumbnail ? normalizeTvdbImageUrl(art.thumbnail) : null
    const entry: TvdbGalleryImage = {
      url,
      thumbnail: thumbRaw,
      language: normalizeTvdbLanguage(art.language),
      width: typeof art.width === "number" ? art.width : undefined,
      height: typeof art.height === "number" ? art.height : undefined,
      includesText: typeof art.includesText === "boolean" ? art.includesText : undefined,
      score: typeof art.score === "number" ? art.score : undefined,
      source: "tvdb",
      type: t,
    }
    const prev = bucket.get(url)
    if (!prev || (entry.score ?? 0) > (prev.score ?? 0)) bucket.set(url, entry)
  }
  const byScore = (a: TvdbGalleryImage, b: TvdbGalleryImage) => (b.score ?? 0) - (a.score ?? 0)
  return {
    posters: [...posters.values()].sort(byScore).slice(0, TVDB_GALLERY_POSTERS_CAP),
    backdrops: [...backdrops.values()].sort(byScore).slice(0, TVDB_GALLERY_BACKDROPS_CAP),
    logos: [...logos.values()].sort(byScore).slice(0, TVDB_GALLERY_LOGOS_CAP),
  }
}

function isTvdbTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")
}

/**
 * Strict TVDB artworks fetch for the editor gallery (thin shared fetch, no
 * duplicated client): same host / 5s per-call cap (`TVDB_TIMEOUT_MS`), same
 * `timedFetch` + `combineAbortSignals(signal, budget)` as the rescue path —
 * the caller signal carries the aggregate budget (no stacked timeouts, no
 * unbounded retries: one attempt per artworks fetch). Intentionally outside
 * the shared fail-open breaker: gallery failures must surface as typed
 * errors, never as silent empty lists.
 *
 * - Missing key throws `not_configured` (the route maps it to 503).
 * - Auth is validated BEFORE serving the cache: a gallery cached under one
 *   key must never mask a rejected key on the next request. A null token
 *   throws `auth`, except with an open breaker (sustained upstream outage —
 *   401s never trip it), which throws `upstream` instead.
 * - Artworks 401/403 throw `auth`; 429/5xx/network throw `upstream`;
 *   abort/timeout throw `timeout`; any other 4xx throws `upstream`
 *   (never cached as empty).
 * - Only 404 and a well-formed 200 with no artworks return `[]`
 *   (confirmed absence, 10min cache). A 200 with malformed JSON, a missing
 *   `data` envelope, or a non-array `data`/`data.artworks` is an UPSTREAM
 *   failure and throws `upstream` without any cache write. Well-formed
 *   arrays whose individual items are all malformed/unsupported legitimately
 *   filter down to `[]` (the envelope itself was fine).
 * - Successes (including confirmed-empty ones) land in `artworksCache`
 *   (6h hits / 10min empty, neutral `media:tvdbId` key without secrets,
 *   `validated: true`); failures are NEVER cached. Unvalidated legacy
 *   rescue empties sharing the map are skipped, never trusted as absence.
 *   The fail-open rescue (`getTvdbArtworks`) is unchanged for rendering.
 */
export async function getTvdbArtworksStrict(
  mediaType: "movie" | "tv",
  tvdbId: number,
  apiKey: string,
  signal?: AbortSignal,
): Promise<TvdbArtwork[]> {
  const cleanKey = (apiKey || "").trim()
  if (!cleanKey) throw new TvdbArtworksError("not_configured", "TVDB API key is not configured")
  if (!Number.isInteger(tvdbId) || tvdbId <= 0) return []
  if (signal?.aborted) throw new TvdbArtworksError("timeout", "TVDB request aborted")

  // Auth-before-cache: a neutral cache hit must never mask a bad key, so the
  // token (key-hashed, 25d cache: cheap on hits) is resolved first. A null
  // token with an open breaker means a sustained upstream outage (401s never
  // trip the breaker), so it surfaces as `upstream`, not `auth`.
  const token = await getTvdbToken(cleanKey, signal)
  if (signal?.aborted) throw new TvdbArtworksError("timeout", "TVDB request aborted")
  if (!token) {
    if (isTvdbBreakerOpen()) throw new TvdbArtworksError("upstream", "TVDB login unavailable")
    throw new TvdbArtworksError("auth", "TVDB login failed (invalid key or login unavailable)")
  }

  const cacheKey = `${mediaType}:${tvdbId}`
  // Provenance guard: an unvalidated legacy fail-open empty (malformed JSON
  // / wrong shape cached by the rescue path) is NOT confirmed absence, so it
  // is skipped and refetched below. Only `validated` entries (proven
  // envelope or 404) are trusted here.
  const cached = artworksCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry && cached.validated) return cached.arts

  const url = mediaType === "tv"
    ? `${TVDB_API}/series/${tvdbId}/artworks`
    : `${TVDB_API}/movies/${tvdbId}/extended`
  let res: Response
  try {
    res = await timedFetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: combineAbortSignals(signal, TVDB_TIMEOUT_MS),
    })
  } catch (e) {
    if (isTvdbTimeoutError(e) || signal?.aborted) throw new TvdbArtworksError("timeout", "TVDB artworks request timed out")
    log.warn("TVDB strict artworks network failure", { mediaType, tvdbId })
    throw new TvdbArtworksError("upstream", "TVDB artworks unavailable")
  }
  if (res.status === 401 || res.status === 403) throw new TvdbArtworksError("auth", "TVDB rejected the API key")
  if (res.status === 404) {
    setBounded(artworksCache, cacheKey, { arts: [], expiry: Date.now() + CACHE_TTL_ARTWORKS_EMPTY, validated: true }, MAX_ARTWORK_ENTRIES)
    return []
  }
  if (res.status === 429 || res.status >= 500) throw new TvdbArtworksError("upstream", `TVDB artworks responded with status ${res.status}`)
  if (!res.ok) throw new TvdbArtworksError("upstream", `TVDB artworks responded with status ${res.status}`)
  // Envelope validation: only a top-level array or `{ artworks: [] }` is a
  // readable payload. Anything else (invalid JSON, null, missing `data`,
  // non-array `data.artworks`) is an upstream failure, NOT confirmed-empty.
  let raw: unknown[]
  try {
    const json = (await res.json()) as { data?: unknown } | null
    const data = (json as { data?: unknown } | null)?.data
    if (Array.isArray(data)) {
      raw = data
    } else if (data !== null && typeof data === "object" && Array.isArray((data as { artworks?: unknown }).artworks)) {
      raw = (data as { artworks: unknown[] }).artworks
    } else {
      throw new TvdbArtworksError("upstream", "TVDB artworks returned an unrecognized payload")
    }
  } catch (e) {
    if (e instanceof TvdbArtworksError) throw e
    throw new TvdbArtworksError("upstream", "TVDB artworks returned invalid JSON")
  }
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
      type: parseTvdbArtworkType(r.type),
    })
  }
  setBounded(
    artworksCache,
    cacheKey,
    { arts, expiry: Date.now() + (arts.length > 0 ? CACHE_TTL_ARTWORKS : CACHE_TTL_ARTWORKS_EMPTY), validated: true },
    MAX_ARTWORK_ENTRIES,
  )
  return arts
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
