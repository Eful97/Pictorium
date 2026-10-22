import crypto from "node:crypto"
import { cacheFetchedAt, cacheGet, cacheRemainingMs, cacheSet } from "./cache"
import { envWithFallback } from "./env-compat"
import { combineAbortSignals } from "./abort-signal"
import { timedFetch } from "./outbound-stats"
import { isMdbKeyParked, noteMdbQuotaExhausted429, noteMdbQuotaSuccess } from "./mdblist-quota"

export interface MDBListEntry {
  imdb: string
  title: string
  year: number
  tmdb?: number
  /** Id TVDB (liste TVDB: gli entity espongono solo questo + tipo). La
   *  pipeline lo risolve in TMDB via tmdbFindByTvdb, come per gli imdb-only. */
  tvdb?: number
  mediatype?: "movie" | "show" | "anime" | "tv"
  poster_path?: string | null
}

export const MDBLISTS = [
  { key: 'mdblistMovie', label: 'Di tendenza', url: 'https://mdblist.com/lists/snoak/trending-movies' },
  { key: 'mdblistShow', label: 'Serie di tendenza', url: 'https://mdblist.com/lists/snoak/trakt-s-trending-shows' },
  { key: 'mdblistAnime', label: 'Anime di tendenza', url: 'https://mdblist.com/lists/snoak/trending-anime-shows' },
  { key: 'mdblistAnimeMovie', label: 'Film anime di tendenza', url: 'https://mdblist.com/lists/snoak/trending-anime-movies' },
] as const

// A2: 12h list cache TTL. Only NON-empty results are cached long-term:
// a network error (catch → []) must not freeze the list, it retries on
// the next access (empties at 60s, unchanged).
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

// Single cached block per list: Stremio paginates with skip=0,20,40...
// over 20-item windows, but upstream is called only once every 12h.
// Aligned with fetchCustomMDBList (default limit 500).
export const MDBLIST_BLOCK_SIZE = 500

/**
 * Remaining lifetime (ms) of an MDBList source list from its ABSOLUTE
 * provenance (generation timestamp + 12h TTL, 60s on empties), or null when
 * absent/expired. Read-only: never fetches, never renews (Task D poster
 * freshness cap for the anime-rank path). The key scheme mirrors
 * fetchMDBList exactly — a mismatch safely yields null (no cap).
 */
export function mdblistRemainingMs(
  listKey: string,
  apiKey?: string,
  nowMs: number = Date.now(),
): number | null {
  const keyHash = apiKey ? crypto.createHash("sha1").update(apiKey).digest("hex").slice(0, 8) : "none"
  return cacheRemainingMs(`mdblist:list:${listKey}:${keyHash}`, nowMs)
}

export async function fetchMDBList(
  listKey: string,
  apiKey?: string,
  // R3: signal esterno (es. deadline render) combinato col timeout interno.
  signal?: AbortSignal,
  /**
   * Cycle-aware freshness floor (fixed chart cycles): a cached entry fetched
   * BEFORE this instant is treated as stale and refreshed, so pre-boundary
   * payloads never masquerade as freshly retrieved in-slot data. Unset =
   * today's TTL-only behavior (all non-chart consumers unchanged).
   */
  minFetchedAtMs?: number,
  /**
   * Strict chart-cycle mode: transport failure (HTTP !ok, invalid payload,
   * network error, abort) THROWS instead of resolving [], and a cached []
   * is never trusted (legacy failure paths cache [] as a 60s negative, so a
   * cached empty cannot prove a genuine success). Genuine successful empties
   * still resolve [] with the same legacy cache side effects. Legacy callers
   * keep the fail-open [] (unchanged default).
   */
  strict?: boolean,
): Promise<MDBListEntry[]> {
  const list = MDBLISTS.find(l => l.key === listKey)
  if (!list) {
    if (strict) throw new Error(`fetchMDBList strict: unknown list ${listKey}`)
    return []
  }
  // Solo la chiave esplicita della richiesta: non esiste più chiave d'istanza.
  const key = apiKey
  // La key cambia il payload → parte del cache key (hash, mai plaintext),
  // come in ratings.ts: due contesti con key diverse non collidono.
  const keyHash = key ? crypto.createHash("sha1").update(key).digest("hex").slice(0, 8) : "none"
  const cacheKey = `mdblist:list:${listKey}:${keyHash}`
  const cached = cacheGet<MDBListEntry[]>(cacheKey)
  if (cached) {
    // Strict never trusts a cached empty: it may be a legacy error-negative
    // (failures cache [] for 60s), which must not masquerade as a successful
    // empty. Non-empty cached rows are provably genuine (failures never
    // produce rows) and honor the same floor check as legacy.
    if (cached.length > 0 || !strict) {
      if (minFetchedAtMs === undefined) return cached
      // Cycle-aware: only reuse entries actually fetched in-slot; otherwise
      // fall through to a real refresh below (both strict and legacy).
      const fetchedAt = cacheFetchedAt(cacheKey)
      if (fetchedAt !== null && fetchedAt >= minFetchedAtMs) return cached
    }
  }
  const fail = (marker: string): [] => {
    if (strict) throw new Error(`fetchMDBList strict: ${marker} (${listKey})`)
    return []
  }
  /**
   * Narrow strict-only shape guard (cycle 3): the supported shapes are an
   * array payload or an object carrying at least one collection array
   * (`items`/`movies`/`shows`, empty allowed as genuine empty). Anything
   * else on HTTP 200 (null body, wrong-typed field, explicit error object)
   * is a provider failure, never a genuine empty. Legacy keeps the old
   * fall-through to [] untouched.
   */
  const assertStrictMDBShape = (data: unknown, payload: unknown): void => {
    if (!strict) return
    const hasCollectionArray =
      Array.isArray(payload) ||
      (!!payload && typeof payload === "object" && (
        Array.isArray((payload as { items?: unknown }).items) ||
        Array.isArray((payload as { movies?: unknown }).movies) ||
        Array.isArray((payload as { shows?: unknown }).shows)
      ))
    if (!hasCollectionArray) {
      cacheSet(cacheKey, [], ["mdblist"], 60_000)
      throw new Error(`fetchMDBList strict: malformed-payload (${listKey})`)
    }
  }
  const assertStrictMDBRows = (rawItems: Array<unknown>): void => {
    if (!strict || rawItems.length === 0) return
    const hasId = rawItems.some((it) => {
      const r = it as { imdb_id?: unknown; imdb?: unknown; tmdb_id?: unknown; tmdb?: unknown; ids?: { tmdb?: unknown }; id?: unknown } | null
      if (!r || typeof r !== "object") return false
      const rawTmdb = r.tmdb_id ?? r.tmdb ?? r.ids?.tmdb ?? r.id
      const n = Number(rawTmdb)
      if (Number.isFinite(n) && n > 0) return true
      const imdb = r.imdb_id ?? r.imdb
      return typeof imdb === "string" && imdb.trim().length > 0
    })
    if (!hasId) {
      cacheSet(cacheKey, [], ["mdblist"], 60_000)
      throw new Error(`fetchMDBList strict: malformed-rows (${listKey})`)
    }
  }
  try {
    const slug = list.url.split('/').pop()
    // MDBLIST_API_URL esplicito (test E2E: punta al mock server locale) vince
    // sempre sulla key, così i test restano deterministici senza chiamate reali.
    // In produzione MDBLIST_API_URL è assente e si usa l'endpoint reale
    // (con key se disponibile).
    const explicitUrl = process.env.MDBLIST_API_URL
    let res: Response | null = null

    if (explicitUrl) {
      res = await timedFetch(`${explicitUrl}/lists/snoak/${slug}`, { signal: combineAbortSignals(signal, 8000) }).catch(() => null)
    } else if (key) {
      // Daily-quota parking sits BEHIND the list cache above: cache hits are
      // still served, only the fresh keyed fetch is skipped in favor of the
      // same existing public fallback below (zero quota spend until reset).
      // Mock-server runs (MDBLIST_API_URL set) stay isolated: no quota state
      // is read or recorded there.
      if (!isMdbKeyParked(key)) {
        res = await timedFetch(`https://api.mdblist.com/lists/snoak/${slug}/items?apikey=${encodeURIComponent(key)}&limit=${MDBLIST_BLOCK_SIZE}`, {
          headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
          signal: combineAbortSignals(signal, 8000),
        }).catch(() => null)
        if (res) {
          const headers = { get: (n: string) => { try { return res!.headers.get(n) } catch { return null } } }
          if (!res.ok && res.status === 429 && noteMdbQuotaExhausted429(headers, key)) {
            // Exhausted key: drop the keyed response so the public fallback
            // below runs; the key stays parked until its reset.
            res = null
          } else if (res.ok) {
            // Last-token success still returns its data; future keyed calls
            // park until reset.
            noteMdbQuotaSuccess(headers, key)
          }
        }
      }
    }

    if (!res || !res.ok) {
      // Fallback endpoint pubblico JSON diretto
      res = await timedFetch(`https://mdblist.com/lists/snoak/${slug}/json`, {
        headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
        signal: combineAbortSignals(signal, 8000),
      }).catch(() => null)
    }

    if (!res || !res.ok) {
      // Legacy non-strict fail-open: HTTP failure returns [] WITHOUT caching,
      // so the next access retries immediately. Strict mode still throws via
      // fail() and lands in the outer catch, which records the 60s strict
      // negative (coordinator failure gate unchanged).
      return fail(`http-${res?.status ?? "noresponse"}`)
    }
    let data: unknown
    try {
      data = await res.json()
    } catch {
      cacheSet(cacheKey, [], ["mdblist"], 60_000)
      return fail("invalid-json")
    }
    const payload = (
      Array.isArray(data) ? data : ((data as { data?: unknown } | null)?.data || data)
    ) as {
      items?: unknown
      movies?: unknown
      shows?: unknown
    } | unknown[]
    const isMovie = listKey === "mdblistMovie" || listKey === "mdblistAnimeMovie"
    type RawItem = { imdb_id?: string; imdb?: string; title?: string; year?: number | string; release_year?: number | string; tmdb_id?: number | string; tmdb?: number | string; ids?: { tmdb?: number | string }; id?: number | string }
    let rawItems: Array<RawItem> = []
    if (Array.isArray(payload)) {
      rawItems = payload as Array<RawItem>
    } else if (Array.isArray(payload?.items) && payload.items.length > 0) {
      rawItems = payload.items as Array<RawItem>
    } else if (isMovie && Array.isArray(payload?.movies) && payload.movies.length > 0) {
      rawItems = payload.movies as Array<RawItem>
    } else if (!isMovie && Array.isArray(payload?.shows) && payload.shows.length > 0) {
      rawItems = payload.shows as Array<RawItem>
    } else if (Array.isArray(payload?.movies) && payload.movies.length > 0) {
      rawItems = payload.movies as Array<RawItem>
    } else if (Array.isArray(payload?.shows) && payload.shows.length > 0) {
      rawItems = payload.shows as Array<RawItem>
    } else if (Array.isArray(payload?.items)) {
      rawItems = payload.items as Array<RawItem>
    }
    assertStrictMDBShape(data, payload)
    assertStrictMDBRows(rawItems)

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
      if (items.length >= MDBLIST_BLOCK_SIZE) break
    }
    if (items.length > 0) {
      cacheSet(cacheKey, items, ["mdblist"], CACHE_TTL_MS)
    } else {
      cacheSet(cacheKey, [], ["mdblist"], 60_000)
    }
    return items
  } catch {
    cacheSet(cacheKey, [], ["mdblist"], 60_000)
    return fail("transport")
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

export async function fetchCustomMDBList(urlOrSlug: string, apiKey?: string, limit: number = 500, signal?: AbortSignal): Promise<MDBListEntry[]> {
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
      res = await timedFetch(`${explicitUrl}/lists/custom/${slug}`, { signal: combineAbortSignals(signal, 10000) }).catch(() => null)
    } else if (key) {
      // Same daily-quota parking as fetchMDBList above: a parked key skips
      // the keyed fetch and uses the public fallback below (zero quota
      // spend). Mock-server runs (MDBLIST_API_URL set) stay isolated.
      let keyUrl = ""
      if (!isMdbKeyParked(key)) {
        if (target.id) {
          keyUrl = `https://api.mdblist.com/lists/${target.id}/items?apikey=${encodeURIComponent(key)}&limit=${limit}`
        } else if (target.user && target.slug) {
          keyUrl = `https://api.mdblist.com/lists/${encodeURIComponent(target.user)}/${encodeURIComponent(target.slug)}/items?apikey=${encodeURIComponent(key)}&limit=${limit}`
        } else if (target.slug) {
          keyUrl = `https://api.mdblist.com/lists/${encodeURIComponent(target.slug)}/items?apikey=${encodeURIComponent(key)}&limit=${limit}`
        }
      }
      if (keyUrl) {
        res = await timedFetch(keyUrl, {
          headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
          signal: combineAbortSignals(signal, 10000),
        }).catch(() => null)
        if (res) {
          const headers = { get: (n: string) => { try { return res!.headers.get(n) } catch { return null } } }
          if (!res.ok && res.status === 429 && noteMdbQuotaExhausted429(headers, key)) {
            res = null
          } else if (res.ok) {
            noteMdbQuotaSuccess(headers, key)
          }
        }
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
        res = await timedFetch(publicUrl, {
          headers: { "User-Agent": "Mozilla/5.0 Pictorium" },
          signal: combineAbortSignals(signal, 10000),
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
      // Le sezioni movies/shows portano il tipo: lo si annota come default
      // (il campo proprio dell'item vince se presente) così i cataloghi
      // "mixed" non sdoppiano gli item senza tipo in film+serie.
      const movies = (payload.movies || []).map((m: { mediatype?: string }) => ({ mediatype: "movie" as const, ...m }))
      const shows = (payload.shows || []).map((s: { mediatype?: string }) => ({ mediatype: "show" as const, ...s }))
      rawItems = [...movies, ...shows]
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
