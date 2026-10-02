import type { TMDBDetails, TMDBExternalIds, TMDBImagesResponse } from "@/lib/tmdb"

// Editor session cache (F6): preview ticks on an unmapped title replay
// the TMDB pipeline on every render. This in-memory cache (10 min TTL,
// max 50 entries) holds details/images/externalIds per type:id:lang for
// the editor session lifetime, so ticks skip the network. Language is part
// of the key: details are localized and images language-filtered, so reusing
// type:id across languages would serve the wrong poster. It is separate from
// the tmdb.ts fetchCache (which catalog traffic can evict), and the
// type:id:lang key implicitly invalidates it on client selection change.

export interface TMDBSessionEntry {
  details?: TMDBDetails
  images?: TMDBImagesResponse
  externalIds?: TMDBExternalIds
}

const SESSION_TTL_MS = 10 * 60 * 1000
const SESSION_MAX_ENTRIES = 50

const store = new Map<string, { data: TMDBSessionEntry; lastAccess: number }>()

function sessionKey(type: string, id: number, lang: string): string {
  return `${type}:${id}:${lang}`
}

function evictOldest(): void {
  let oldestKey: string | null = null
  let oldestTime = Infinity
  for (const [key, v] of store) {
    if (v.lastAccess < oldestTime) {
      oldestTime = v.lastAccess
      oldestKey = key
    }
  }
  if (oldestKey !== null) store.delete(oldestKey)
}

export function getTMDBSessionCache(type: string, id: number, lang: string): TMDBSessionEntry | null {
  const key = sessionKey(type, id, lang)
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.lastAccess > SESSION_TTL_MS) {
    store.delete(key)
    return null
  }
  // Promote a MRU (Map preserves insertion order)
  entry.lastAccess = Date.now()
  store.delete(key)
  store.set(key, entry)
  return entry.data
}

export function setTMDBSessionCache(type: string, id: number, lang: string, data: TMDBSessionEntry): void {
  const key = sessionKey(type, id, lang)
  if (!store.has(key) && store.size >= SESSION_MAX_ENTRIES) evictOldest()
  store.set(key, { data, lastAccess: Date.now() })
}

export function invalidateTMDBSessionCache(type: string, id: number): void {
  // Per-title invalidation: removes ALL language variants, so no stale
  // entries stay hidden in other languages after the invalidate.
  const prefix = `${type}:${id}:`
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

/** Solo per i test: svuota la session cache. */
export function __resetTMDBSessionCache(): void {
  store.clear()
}
