import crypto from "node:crypto"
import { cacheGet, cacheSet } from "./cache"
import { envWithFallback } from "./env-compat"
import { combineAbortSignals } from "./abort-signal"

export interface MDBListEntry {
  imdb: string
  title: string
  year: number
  tmdb?: number
  mediatype?: "movie" | "show" | "anime" | "tv"
  poster_path?: string | null
}

export const MDBLISTS = [
  { key: 'mdblistMovie', label: 'Di tendenza', url: 'https://mdblist.com/lists/snoak/trending-movies' },
  { key: 'mdblistShow', label: 'Serie di tendenza', url: 'https://mdblist.com/lists/snoak/trakt-s-trending-shows' },
  { key: 'mdblistAnime', label: 'Anime di tendenza', url: 'https://mdblist.com/lists/snoak/trending-anime-shows' },
  { key: 'mdblistAnimeMovie', label: 'Film anime di tendenza', url: 'https://mdblist.com/lists/snoak/trending-anime-movies' },
] as const

// A2: TTL cache liste. Solo risultati NON vuoti vengono cachati: un errore di
// rete (catch → []) non deve congelare la lista per 30min, si ritenta al
// prossimo accesso.
const CACHE_TTL_MS = 30 * 60 * 1000

export async function fetchMDBList(
  listKey: string,
  apiKey?: string,
  // R3: signal esterno (es. deadline render) combinato col timeout interno.
  signal?: AbortSignal,
): Promise<MDBListEntry[]> {
  const list = MDBLISTS.find(l => l.key === listKey)
  if (!list) return []
  // Solo la chiave esplicita della richiesta: non esiste più chiave d'istanza.
  const key = apiKey
  // La key cambia il payload → parte del cache key (hash, mai plaintext),
  // come in ratings.ts: due contesti con key diverse non collidono.
  const keyHash = key ? crypto.createHash("sha1").update(key).digest("hex").slice(0, 8) : "none"
  const cacheKey = `mdblist:list:${listKey}:${keyHash}`
  const cached = cacheGet<MDBListEntry[]>(cacheKey)
  if (cached) return cached
  try {
    const slug = list.url.split('/').pop()
    // MDBLIST_API_URL esplicito (test E2E: punta al mock server locale) vince
    // sempre sulla key, così i test restano deterministici senza chiamate reali.
    // In produzione MDBLIST_API_URL è assente e si usa l'endpoint reale
    // (con key se disponibile).
    const explicitUrl = process.env.MDBLIST_API_URL
    let res: Response | null = null

    if (explicitUrl) {
      res = await fetch(`${explicitUrl}/lists/snoak/${slug}`, { signal: combineAbortSignals(signal, 8000) }).catch(() => null)
    } else if (key) {
      res = await fetch(`https://api.mdblist.com/lists/snoak/${slug}/items?apikey=${encodeURIComponent(key)}&limit=20`, {
        headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
        signal: combineAbortSignals(signal, 8000),
      }).catch(() => null)
    }

    if (!res || !res.ok) {
      // Fallback endpoint pubblico JSON diretto
      res = await fetch(`https://mdblist.com/lists/snoak/${slug}/json`, {
        headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
        signal: combineAbortSignals(signal, 8000),
      }).catch(() => null)
    }

    if (!res || !res.ok) return []
    const data = await res.json()
    const payload = Array.isArray(data) ? data : (data?.data || data)
    const isMovie = listKey === "mdblistMovie" || listKey === "mdblistAnimeMovie"
    let rawItems: Array<{ imdb_id?: string; imdb?: string; title?: string; year?: number | string; release_year?: number | string; tmdb_id?: number | string; tmdb?: number | string; ids?: { tmdb?: number | string }; id?: number | string }> = []
    if (Array.isArray(payload)) {
      rawItems = payload
    } else if (Array.isArray(payload?.items) && payload.items.length > 0) {
      rawItems = payload.items
    } else if (isMovie && Array.isArray(payload?.movies) && payload.movies.length > 0) {
      rawItems = payload.movies
    } else if (!isMovie && Array.isArray(payload?.shows) && payload.shows.length > 0) {
      rawItems = payload.shows
    } else if (Array.isArray(payload?.movies) && payload.movies.length > 0) {
      rawItems = payload.movies
    } else if (Array.isArray(payload?.shows) && payload.shows.length > 0) {
      rawItems = payload.shows
    } else if (Array.isArray(payload?.items)) {
      rawItems = payload.items
    }

    const seenIds = new Set<string>()
    const items: MDBListEntry[] = []
    for (const item of rawItems) {
      const imdb = item.imdb_id || item.imdb || ""
      const title = item.title || ""
      const year = Number(item.year || item.release_year) || 0
      const rawTmdb = item.tmdb_id || item.tmdb || item.ids?.tmdb || item.id || undefined
      const tmdb = rawTmdb !== undefined && Number.isFinite(Number(rawTmdb)) ? Number(rawTmdb) : undefined
      const dedupeKey = tmdb ? `tmdb:${tmdb}` : (imdb ? `imdb:${imdb}` : `title:${title}:${year}`)
      if (seenIds.has(dedupeKey)) continue
      seenIds.add(dedupeKey)
      items.push({ imdb, title, year, tmdb })
      if (items.length >= 20) break
    }
    if (items.length > 0) {
      cacheSet(cacheKey, items, ["mdblist"], CACHE_TTL_MS)
    } else {
      cacheSet(cacheKey, [], ["mdblist"], 60_000)
    }
    return items
  } catch {
    cacheSet(cacheKey, [], ["mdblist"], 60_000)
    return []
  }
}

export function parseMDBListTarget(input: string): { user?: string; slug?: string; id?: string } | null {
  let trimmed = input.trim()
  if (!trimmed) return null
  // Rimuove eventuali /json, /items, query params e trailing slash
  trimmed = trimmed.replace(/\/json\/?$/i, "").replace(/\/items\/?$/i, "").replace(/\?.*$/, "").replace(/\/+$/, "")

  // https://mdblist.com/lists/user/slug
  const urlMatch = trimmed.match(/(?:https?:\/\/)?(?:api\.)?mdblist\.com\/lists\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i)
  if (urlMatch) {
    return { user: urlMatch[1], slug: urlMatch[2] }
  }

  // https://mdblist.com/lists/12345
  const idUrlMatch = trimmed.match(/(?:https?:\/\/)?(?:api\.)?mdblist\.com\/lists\/([0-9]+)/i)
  if (idUrlMatch) {
    return { id: idUrlMatch[1] }
  }

  // https://mdblist.com/lists/some-slug
  const singleSlugUrlMatch = trimmed.match(/(?:https?:\/\/)?(?:api\.)?mdblist\.com\/lists\/([a-zA-Z0-9_.-]+)/i)
  if (singleSlugUrlMatch) {
    return { slug: singleSlugUrlMatch[1] }
  }

  const slashParts = trimmed.split("/")
  if (slashParts.length === 2 && slashParts[0] && slashParts[1]) {
    return { user: slashParts[0], slug: slashParts[1] }
  }
  if (/^[0-9]+$/.test(trimmed)) {
    return { id: trimmed }
  }
  if (/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return { slug: trimmed }
  }
  return null
}

export async function fetchCustomMDBList(urlOrSlug: string, apiKey?: string, limit: number = 500): Promise<MDBListEntry[]> {
  const target = parseMDBListTarget(urlOrSlug)
  if (!target) return []

  const key = apiKey || envWithFallback("MDBLIST_KEY") || process.env.MDBLIST_KEY || process.env.MDBLIST_API_KEY
  const keyHash = key ? crypto.createHash("sha1").update(key).digest("hex").slice(0, 8) : "none"
  const targetHash = crypto.createHash("sha1").update(urlOrSlug.trim()).digest("hex").slice(0, 8)
  const cacheKey = `mdblist:custom:${targetHash}:${keyHash}`
  const cached = cacheGet<MDBListEntry[]>(cacheKey)
  if (cached) return cached

  try {
    const explicitUrl = process.env.MDBLIST_API_URL
    let res: Response | null = null

    if (explicitUrl) {
      const slug = target.slug || target.id || "custom"
      res = await fetch(`${explicitUrl}/lists/custom/${slug}`, { signal: AbortSignal.timeout(10000) }).catch(() => null)
    } else if (key) {
      let keyUrl = ""
      if (target.id) {
        keyUrl = `https://api.mdblist.com/lists/${target.id}/items?apikey=${encodeURIComponent(key)}&limit=${limit}`
      } else if (target.user && target.slug) {
        keyUrl = `https://api.mdblist.com/lists/${encodeURIComponent(target.user)}/${encodeURIComponent(target.slug)}/items?apikey=${encodeURIComponent(key)}&limit=${limit}`
      } else if (target.slug) {
        keyUrl = `https://api.mdblist.com/lists/${encodeURIComponent(target.slug)}/items?apikey=${encodeURIComponent(key)}&limit=${limit}`
      }
      if (keyUrl) {
        res = await fetch(keyUrl, {
          headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
          signal: AbortSignal.timeout(10000),
        }).catch(() => null)
      }
    }

    // Se la chiamata con chiave è fallita o non c'è chiave, usa l'endpoint pubblico JSON
    if (!res || !res.ok) {
      let publicUrl = ""
      if (target.user && target.slug) {
        publicUrl = `https://mdblist.com/lists/${encodeURIComponent(target.user)}/${encodeURIComponent(target.slug)}/json`
      } else if (target.id) {
        publicUrl = `https://mdblist.com/lists/${encodeURIComponent(target.id)}/json`
      } else if (target.slug) {
        publicUrl = `https://mdblist.com/lists/${encodeURIComponent(target.slug)}/json`
      }
      if (publicUrl) {
        res = await fetch(publicUrl, {
          headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
          signal: AbortSignal.timeout(10000),
        }).catch(() => null)
      }
    }

    if (!res || !res.ok) return []
    const data = await res.json()
    const payload = Array.isArray(data) ? data : (data?.data || data)
    let rawItems: Array<{
      imdb_id?: string
      imdb?: string
      title?: string
      name?: string
      year?: number | string
      release_year?: number | string
      tmdb_id?: number | string
      tmdb?: number | string
      ids?: { tmdb?: number | string; imdb?: string }
      id?: number | string
      mediatype?: "movie" | "show" | "anime" | "tv"
      media_type?: "movie" | "show" | "anime" | "tv"
      type?: "movie" | "show" | "anime" | "tv"
      show?: boolean
    }> = []

    if (Array.isArray(payload)) {
      rawItems = payload
    } else if (Array.isArray(payload?.items)) {
      rawItems = payload.items
    } else if (Array.isArray(payload?.movies) || Array.isArray(payload?.shows)) {
      rawItems = [...(payload.movies || []), ...(payload.shows || [])]
    }

    const seenCustom = new Set<string>()
    const items: MDBListEntry[] = []
    for (const item of rawItems) {
      const imdb = item.imdb_id || item.imdb || item.ids?.imdb || ""
      const title = item.title || item.name || ""
      const year = Number(item.year || item.release_year) || 0
      const tmdb = item.tmdb_id ? Number(item.tmdb_id) : item.tmdb ? Number(item.tmdb) : item.ids?.tmdb ? Number(item.ids.tmdb) : (item.id && Number.isFinite(Number(item.id)) ? Number(item.id) : undefined)
      const mediatype = item.mediatype || item.media_type || item.type || (item.show ? "show" : undefined)
      const dedupeKey = tmdb ? `tmdb:${tmdb}` : (imdb ? `imdb:${imdb}` : `title:${title}:${year}`)
      if (seenCustom.has(dedupeKey)) continue
      seenCustom.add(dedupeKey)
      items.push({ imdb, title, year, tmdb, mediatype })
      if (items.length >= limit) break
    }
    if (items.length > 0) {
      cacheSet(cacheKey, items, ["mdblist"], CACHE_TTL_MS)
    } else {
      cacheSet(cacheKey, [], ["mdblist"], 60_000)
    }
    return items
  } catch {
    cacheSet(cacheKey, [], ["mdblist"], 60_000)
    return []
  }
}

export async function checkMDBLists(imdbId: string): Promise<{ key: string; rank: number } | null> {
  for (const list of MDBLISTS) {
    const entries = await fetchMDBList(list.key)
    const idx = entries.findIndex(e => e.imdb === imdbId)
    if (idx >= 0) return { key: list.key, rank: idx + 1 }
  }
  return null
}
