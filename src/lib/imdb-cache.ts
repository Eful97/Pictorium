import { getExternalIds } from "@/lib/tmdb"
import { isValidWikidataQid } from "@/lib/awards"

interface ImdbCacheEntry {
  value: string | null
  expiry: number
}

const IMDB_ID_CACHE_MAX = 2000
const imdbIdCache = new Map<string, ImdbCacheEntry>()

function imdbIdCacheSet(key: string, value: string | null, ttlMs: number): void {
  if (imdbIdCache.size >= IMDB_ID_CACHE_MAX) {
    const oldest = imdbIdCache.keys().next().value
    if (oldest !== undefined) imdbIdCache.delete(oldest)
  }
  imdbIdCache.set(key, { value, expiry: Date.now() + ttlMs })
}

export async function resolveImdbId(mediaType: "movie" | "tv", tmdbId: number, apiKey?: string, timeoutMs = 30000): Promise<string | null> {
  const cacheKey = `${mediaType}:${tmdbId}`
  const cached = imdbIdCache.get(cacheKey)
  if (cached && Date.now() < cached.expiry) return cached.value
  try {
    const result = await getExternalIds(mediaType, tmdbId, apiKey, undefined, timeoutMs).then((r) => r.imdb_id ?? null)
    const ttl = result !== null ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
    imdbIdCacheSet(cacheKey, result, ttl)
    return result
  } catch {
    imdbIdCacheSet(cacheKey, null, 60_000)
    return null
  }
}

export function __clearImdbCache(): void {
  imdbIdCache.clear()
  wikidataIdCache.clear()
}

interface WikidataCacheEntry {
  value: string | null
  expiry: number
}

const WIKIDATA_ID_CACHE_MAX = 2000
const wikidataIdCache = new Map<string, WikidataCacheEntry>()

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
    if (wikidataIdCache.size >= WIKIDATA_ID_CACHE_MAX) wikidataIdCache.delete(wikidataIdCache.keys().next().value!)
    wikidataIdCache.set(cacheKey, { value: result, expiry: Date.now() + (result !== null ? WIKIDATA_ID_HIT_TTL_MS : WIKIDATA_ID_MISS_TTL_MS) })
    return result
  } catch {
    if (wikidataIdCache.size >= WIKIDATA_ID_CACHE_MAX) wikidataIdCache.delete(wikidataIdCache.keys().next().value!)
    wikidataIdCache.set(cacheKey, { value: null, expiry: Date.now() + 60_000 })
    return null
  }
}
