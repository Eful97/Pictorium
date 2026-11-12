import { getExternalIds } from "@/lib/tmdb"
import { isValidWikidataQid } from "@/lib/awards"

interface ImdbCacheEntry {
  value: string | null
  expiry: number
}

const IMDB_ID_CACHE_MAX = 2000
const imdbIdCache = new Map<string, ImdbCacheEntry>()

// Map bounded FIFO con TTL, condivisa dalle due memo id qui sotto.
function boundedSet(cache: Map<string, ImdbCacheEntry>, max: number, key: string, value: string | null, ttlMs: number): void {
  if (cache.size >= max) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { value, expiry: Date.now() + ttlMs })
}

export async function resolveImdbId(mediaType: "movie" | "tv", tmdbId: number, apiKey?: string, timeoutMs = 30000, signal?: AbortSignal): Promise<string | null> {
  const cacheKey = `${mediaType}:${tmdbId}`
  const cached = imdbIdCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.value
  try {
    const result = await getExternalIds(mediaType, tmdbId, apiKey, signal, timeoutMs).then((r) => r.imdb_id ?? null)
    const ttl = result !== null ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
    boundedSet(imdbIdCache, IMDB_ID_CACHE_MAX, cacheKey, result, ttl)
    return result
  } catch {
    // Cancellation (budget abort) means "unknown", not "no IMDb id": never
    // freeze a null on an aborted signal, the retry must refetch upstream.
    if (signal?.aborted) return null
    boundedSet(imdbIdCache, IMDB_ID_CACHE_MAX, cacheKey, null, 60_000)
    return null
  }
}

export function __clearImdbCache(): void {
  imdbIdCache.clear()
  wikidataIdCache.clear()
}

const WIKIDATA_ID_CACHE_MAX = 2000
const wikidataIdCache = new Map<string, ImdbCacheEntry>()

// QID Wikidata (es. Q23577 per Dexter): immutabile per titolo, quindi memo
// lunga come l'imdbId (7gg hit / 24h miss). Chiave solo memoria locale: i dati
// sono pubblici e identici per ogni utente/namespace.
const WIKIDATA_ID_HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const WIKIDATA_ID_MISS_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Risolve il QID Wikidata via TMDB external_ids con memo locale.
 * Quarto anello della catena QID della route poster (query > mapping >
 * session > qui): i mapping legacy senza wikidataId salvato usano il
 * fast-path REST invece della lotteria SPARQL. Mai throw (null = SPARQL).
 */
export async function resolveWikidataId(mediaType: "movie" | "tv", tmdbId: number, apiKey?: string, timeoutMs = 30000): Promise<string | null> {
  const cacheKey = `${mediaType}:${tmdbId}`
  const cached = wikidataIdCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.value
  try {
    const raw = await getExternalIds(mediaType, tmdbId, apiKey, undefined, timeoutMs).then((r) => r.wikidata_id ?? null)
    const result = isValidWikidataQid(raw) ? raw : null
    boundedSet(wikidataIdCache, WIKIDATA_ID_CACHE_MAX, cacheKey, result, result !== null ? WIKIDATA_ID_HIT_TTL_MS : WIKIDATA_ID_MISS_TTL_MS)
    return result
  } catch {
    boundedSet(wikidataIdCache, WIKIDATA_ID_CACHE_MAX, cacheKey, null, 60_000)
    return null
  }
}
