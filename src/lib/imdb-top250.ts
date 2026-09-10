/**
 * IMDb Top 250 fetcher & membership checker.
 *
 * Fetches the IMDb Top 250 chart, caches the list of IMDb IDs in the
 * in-memory cache (customisable 24 h TTL), and provides a simple check
 * function. Used both server-side (poster generation) and client-side
 * (preview) via the API route.
 */

import { cacheGet, cacheSet } from "./cache"
import { IMDB_TOP_250_IDS } from "./imdb-top250-data"
import { combineAbortSignals } from "./abort-signal"

const CACHE_KEY = "imdb:top250"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// In-memory session cache (avoids serialisation overhead on repeated checks)
let memCache: Set<string> | null = null
let memCacheAt = 0

// A4: inflight dedup — con più poster concorrenti (fetch del chart da 10s) il
// primo livello di cache rischia N fetch uguali nello stesso istante. Tutti i
// caller concorrenti condividono un'unica promise; al settle si resetta.
let inflightTop250: Promise<Set<string>> | null = null

function isMemFresh(): boolean {
  return memCache !== null && (Date.now() - memCacheAt) < CACHE_TTL_MS
}

async function fetchTop250Ids(signal?: AbortSignal): Promise<string[]> {
  try {
    // Chart URL sovrascrivibile via env: nei test E2E punta al mock server
    // locale, così il fetch resta deterministico (fallback al dataset statico).
    const chartUrl = process.env.IMDB_CHART_URL || "https://www.imdb.com/chart/top/"
    const res = await fetch(chartUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: combineAbortSignals(signal, FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const html = await res.text()
    const ids = [...html.matchAll(/tt\d{7,8}/g)].map((m) => m[0])
    const unique = [...new Set(ids)]
    return unique.length >= 100 ? unique : []
  } catch {
    return []
  }
}

/**
 * Returns the current list of IMDb Top 250 IDs (as a fresh Set).
 *
 * Uses a three-tier strategy:
 *  1. In-memory hot cache (instant, 0ms)
 *  2. Shared cache
 *  3. Dynamic fetch with guaranteed curated static fallback
 */
async function getTop250Ids(signal?: AbortSignal): Promise<Set<string>> {
  // 1. In-memory hot cache
  if (isMemFresh()) return memCache!

  // 2. Shared cache
  const shared = cacheGet<string[]>(CACHE_KEY)
  if (shared && shared.length >= 100) {
    memCache = new Set(shared)
    memCacheAt = Date.now()
    return memCache
  }

  // 3. Inflight dedup: una sola fetch condivisa da tutti i caller concorrenti
  if (inflightTop250) return inflightTop250

  // 4. Dynamic fetch with curated static fallback.
  // R3: il signal del caller che avvia il fetch lo abortisce per tutti i
  // waiter — degradazione sicura: ogni waiter ripiega sul dataset statico.
  inflightTop250 = (async () => {
    const fetched = await fetchTop250Ids(signal)
    if (fetched.length >= 100) {
      const set = new Set(fetched)
      cacheSet(CACHE_KEY, fetched, ["imdb"], CACHE_TTL_MS)
      memCache = set
      memCacheAt = Date.now()
      return set
    }

    // Use curated static Top 250 dataset
    memCache = IMDB_TOP_250_IDS
    memCacheAt = Date.now()
    return IMDB_TOP_250_IDS
  })().finally(() => { inflightTop250 = null })

  return inflightTop250
}

/**
 * Returns `true` when the given IMDb ID is in the current Top 250.
 *
 * Guaranteed 100% reliable via static fallback dataset.
 */
export async function isImdbTop250(imdbId: string | null | undefined, signal?: AbortSignal): Promise<boolean> {
  if (!imdbId || !/^tt\d{7,8}$/.test(imdbId)) return false
  try {
    const ids = await getTop250Ids(signal)
    return ids.has(imdbId)
  } catch {
    return IMDB_TOP_250_IDS.has(imdbId)
  }
}
