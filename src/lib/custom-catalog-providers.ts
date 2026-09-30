import crypto from "node:crypto"
import { cacheGet, cacheSet } from "@/lib/cache"
import { fetchCustomMDBList, type MDBListEntry } from "@/lib/mdblist"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { detectCatalogProvider } from "./catalog-provider-detect"

// Re-export per compatibilità: il riconoscimento URL vive in
// catalog-provider-detect.ts (foglia client-safe); route e test continuano
// a importarlo da qui senza modifiche.
export { detectCatalogProvider } from "./catalog-provider-detect"
export type { CatalogProviderType, ProviderDetectionResult } from "./catalog-provider-detect"

const log = createLogger("custom-catalogs")
const CACHE_TTL_MS = 30 * 60 * 1000

/**
 * Esito tipizzato del fetch catalogo (Fase 5): la pipeline Stremio tratta
 * tutto ciò che non è ok come vuoto, mentre preview/modal mostrano il
 * messaggio specifico invece del generico "nessun titolo".
 */
export type CatalogFetchStatus =
  | "ok"
  | "empty"
  | "private"
  | "not_found"
  | "rate_limited"
  | "key_missing"
  | "unavailable"
  | "unsupported"

export interface UnifiedCatalogResult {
  items: MDBListEntry[]
  status: CatalogFetchStatus
}

/** Item di lista Letterboxd via StremThru (solo i campi che leggiamo). */
interface StremThruListItem {
  title?: string
  name?: string
  year?: string | number
  type?: string
  id_map?: { imdb?: string; tmdb?: string | number }
  imdb_id?: string
  tmdb_id?: string | number
}

/** Item di lista Trakt via API ufficiale (solo i campi che leggiamo). */
interface TraktApiIds {
  imdb?: string | null
  tmdb?: number | null
}

interface TraktApiItem {
  type?: string
  movie?: { ids?: TraktApiIds; title?: string; year?: number }
  show?: { ids?: TraktApiIds & { tvdb?: number | null }; title?: string; year?: number }
  season?: { ids?: TraktApiIds }
  episode?: { ids?: TraktApiIds }
}

const TRAKT_TIMEOUT_MS = 8000
const TRAKT_PAGE_LIMIT = 100

function getTraktClientId(): string | undefined {
  return envWithFallback("TRAKT_CLIENT_ID") || process.env.TRAKT_CLIENT_ID
}

function traktApiBase(): string {
  const override = process.env.TRAKT_API_URL?.replace(/\/+$/, "")
  if (override) return override
  return "https://api.trakt.tv"
}

/**
 * Normalizza voci di catalogo al contratto comune (Fase 0):
 * almeno imdb, tmdb oppure tvdb; dedup per tmdb, poi imdb, poi tvdb;
 * tetto limit. Le voci solo-titolo non sono risolvibili dalla pipeline
 * (catalog-handler scarta comunque ciò che non risolve in tmdbId).
 */
export function normalizeCatalogEntries(items: MDBListEntry[], limit: number = 500): MDBListEntry[] {
  const seen = new Set<string>()
  const out: MDBListEntry[] = []
  for (const it of items) {
    const tmdb = typeof it.tmdb === "number" && Number.isFinite(it.tmdb) && it.tmdb > 0 ? it.tmdb : undefined
    const tvdb = typeof it.tvdb === "number" && Number.isFinite(it.tvdb) && it.tvdb > 0 ? it.tvdb : undefined
    const rawImdb = typeof it.imdb === "string" ? it.imdb.trim() : ""
    const imdb = /^tt\d{7,10}$/i.test(rawImdb) ? rawImdb : tmdb || tvdb ? "" : rawImdb || ""
    if (!tmdb && !imdb && !tvdb) continue
    const mediaType = it.mediatype === "tv" || it.mediatype === "show" || it.mediatype === "anime" ? "tv" : it.mediatype === "movie" ? "movie" : "unknown"
    const key = tmdb ? `${mediaType}:tmdb:${tmdb}` : imdb ? `imdb:${imdb.toLowerCase()}` : `${mediaType}:tvdb:${tvdb}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ imdb, tmdb, tvdb, title: it.title || "", year: Number(it.year) || 0, mediatype: it.mediatype, poster_path: it.poster_path ?? undefined })
    if (out.length >= limit) break
  }
  return out
}

/** Film della TMDb Collection / List (solo i campi che leggiamo). */
interface TmdbListPart {
  id?: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  media_type?: string
  poster_path?: string | null
}

/**
 * Scarica una lista Letterboxd tramite header HEAD x-letterboxd-identifier + StremThru API.
 * Fase 4: errori distinti (privata/non trovata/rate-limit/down/vuota).
 */
async function fetchLetterboxdList(url: string, limit: number = 500): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  try {
    const trimmed = url.trim()
    const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`)
    if (urlObj.hostname !== "letterboxd.com" && urlObj.hostname !== "www.letterboxd.com") {
      log.warn("Invalid Letterboxd hostname", { hostname: urlObj.hostname })
      return empty("not_found")
    }
    const isWatchlist = urlObj.pathname.includes("/watchlist")
    let requestUrl: string
    if (isWatchlist) {
      const pathParts = urlObj.pathname.split("/").filter(Boolean)
      if (pathParts.length >= 1) {
        requestUrl = `https://letterboxd.com/${pathParts[0]}/`
      } else {
        requestUrl = `https://letterboxd.com${urlObj.pathname}`
      }
    } else {
      requestUrl = `https://letterboxd.com${urlObj.pathname}`
    }
    if (!requestUrl.endsWith("/")) requestUrl += "/"

    // 1. Richiesta HEAD per estrarre l'identificativo Letterboxd univoco
    const headRes = await fetch(requestUrl, {
      method: "HEAD",
      headers: {
        "User-Agent": "Mozilla/5.0 Pictorium",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    }).catch(() => null)

    const identifier = headRes?.headers?.get("x-letterboxd-identifier")
    if (!identifier) {
      if (!headRes) return empty("unavailable")
      if (headRes.status === 404) {
        log.warn("Letterboxd list not found", { url: requestUrl })
        return empty("not_found")
      }
      if (headRes.status === 401 || headRes.status === 403) {
        log.warn("Letterboxd list is private", { status: headRes.status })
        return empty("private")
      }
      log.warn("Letterboxd identifier not found via HEAD request", { url: requestUrl })
      return empty("not_found")
    }

    // 2. Chiamata a StremThru per recuperare gli elementi della lista con mapping ID
    const stremThruUrl = isWatchlist
      ? `https://stremthru.13377001.xyz/v0/meta/letterboxd/users/${identifier}/lists/watchlist`
      : `https://stremthru.13377001.xyz/v0/meta/letterboxd/lists/${identifier}`

    const res = await fetch(stremThruUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 Pictorium",
      },
      signal: AbortSignal.timeout(12000),
    }).catch(() => null)

    if (!res) {
      log.warn("StremThru Letterboxd fetch failed", { identifier })
      return empty("unavailable")
    }
    if (res.status === 404) {
      log.warn("StremThru Letterboxd list not found", { identifier })
      return empty("not_found")
    }
    if (res.status === 429) {
      log.warn("StremThru Letterboxd rate limited", { identifier })
      return empty("rate_limited")
    }
    if (!res.ok) {
      log.warn("StremThru Letterboxd fetch failed", { identifier })
      return empty("unavailable")
    }

    const json = await res.json()
    const rawItems: StremThruListItem[] = json?.data?.items || json?.items || []
    const items: MDBListEntry[] = []

    for (const item of rawItems) {
      const idMap = item.id_map || {}
      const imdb = idMap.imdb || (item.imdb_id ? String(item.imdb_id) : "")
      const tmdb = idMap.tmdb ? Number(idMap.tmdb) : (item.tmdb_id ? Number(item.tmdb_id) : undefined)
      const title = item.title || item.name || ""
      const year = Number(item.year) || 0
      const mediatype = item.type === "show" ? "tv" : "movie"

      if (imdb || tmdb || title) {
        items.push({ imdb, tmdb, title, year, mediatype })
      }
      if (items.length >= limit) break
    }

    return { items, status: items.length > 0 ? "ok" : "empty" }
  } catch (err) {
    log.error("Error fetching Letterboxd list", { error: (err as Error).message })
    return empty("unavailable")
  }
}

/**
 * Scarica una lista Trakt pubblica tramite API ufficiale Trakt v2.
 * Richiede una sola Client ID d'istanza (PICTORIUM_TRAKT_CLIENT_ID):
 * le liste pubbliche non richiedono OAuth. Watchlist e liste private
 * restano non supportate (niente account linking in questo rilascio).
 */
async function fetchTraktList(url: string, limit: number = 500): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  const done = (items: MDBListEntry[]): UnifiedCatalogResult => ({
    items: items.slice(0, limit),
    status: items.length > 0 ? "ok" : "empty",
  })
  try {
    const trimmed = url.trim()
    const traktMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?trakt\.tv\/(?:users\/([a-zA-Z0-9_.-]+)\/(?:lists\/([a-zA-Z0-9_.-]+)|watchlist)|lists\/([a-zA-Z0-9_.-]+))\/?(?:[?#].*)?$/i)
    if (!traktMatch) return empty("unsupported")

    const user = traktMatch[1]
    const slug = traktMatch[2] || traktMatch[3]
    const isWatchlist = trimmed.toLowerCase().includes("/watchlist")

    // Le watchlist richiedono OAuth (account linking): fuori scopo.
    if (isWatchlist || !slug || (!user && !traktMatch[3])) {
      log.warn("Trakt watchlist or slug-less list not supported as custom catalog")
      return empty("unsupported")
    }

    const clientId = getTraktClientId()
    if (!clientId) {
      log.warn("Trakt client ID missing: set PICTORIUM_TRAKT_CLIENT_ID")
      return empty("key_missing")
    }

    const base = traktApiBase()
    const path = user
      ? `/users/${encodeURIComponent(user)}/lists/${encodeURIComponent(slug)}/items/movie,show`
      : `/lists/${encodeURIComponent(slug)}/items/movie,show`
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      "User-Agent": "Mozilla/5.0 Pictorium",
    }

    const maxPages = Math.max(1, Math.min(25, Math.ceil(limit / TRAKT_PAGE_LIMIT)))
    const items: MDBListEntry[] = []
    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = `${base}${path}?page=${page}&limit=${TRAKT_PAGE_LIMIT}`
      const res = await fetch(pageUrl, {
        headers,
        signal: AbortSignal.timeout(TRAKT_TIMEOUT_MS),
      }).catch(() => null)

      if (!res) return items.length ? done(items) : empty("unavailable")
      if (res.status === 401 || res.status === 403) {
        log.warn("Trakt list is private or forbidden", { status: res.status })
        return empty("private")
      }
      if (res.status === 404) {
        log.warn("Trakt list not found")
        return empty("not_found")
      }
      if (res.status === 429) {
        const retryAfter = res.headers?.get?.("Retry-After") ?? null
        log.warn("Trakt rate limited", retryAfter ? { retryAfter } : {})
        return empty("rate_limited")
      }
      if (!res.ok) {
        log.warn("Trakt fetch failed", { status: res.status })
        return items.length ? done(items) : empty("unavailable")
      }

      const json = await res.json().catch(() => null)
      const rawItems: TraktApiItem[] = Array.isArray(json) ? json : (json?.data?.items || json?.items || [])
      if (rawItems.length === 0) break

      for (const it of rawItems) {
        const kind = it.type === "show" || it.type === "season" || it.type === "episode" ? "tv" : "movie"
        // season/episode portano la serie madre in `show`, non in ids propri.
        const media = kind === "tv" ? (it.show || it.season || it.episode) : (it.movie || it.show)
        const ids = (media as { ids?: TraktApiIds } | undefined)?.ids || {}
        const title = (media as { title?: string } | undefined)?.title || ""
        const year = Number((media as { year?: number } | undefined)?.year) || 0
        const imdb = typeof ids.imdb === "string" ? ids.imdb : ""
        const tmdb = typeof ids.tmdb === "number" && Number.isFinite(ids.tmdb) ? ids.tmdb : undefined
        if (imdb || tmdb) {
          items.push({ imdb, tmdb, title, year, mediatype: kind === "tv" ? "tv" : "movie" })
        }
        if (items.length >= limit) break
      }
      if (items.length >= limit) break
      if (rawItems.length < TRAKT_PAGE_LIMIT) break
      const pageCount = Number(res.headers?.get?.("X-Pagination-Page-Count"))
      if (Number.isFinite(pageCount) && pageCount > 0 && page >= pageCount) break
    }

    return done(items)
  } catch (err) {
    log.error("Error fetching Trakt list", { error: (err as Error).message })
    return empty("unavailable")
  }
}

/**
 * Scarica una lista TheTVDB pubblica tramite API ufficiale v4 (BYOK).
 * Spike: `thetvdb.com/lists/{slug}` → `GET /lists/slug/{slug}` → id →
 * `GET /lists/{id}/extended` (entities: solo tvdb movieId/seriesId + tipo).
 * Niente scraping HTML: slug non risolvibili ufficialmente → not_found.
 * Gli item escono con solo tvdb+tipo: la pipeline li risolve in TMDB via
 * tmdbFindByTvdb, come per gli imdb-only.
 */
interface TvdbListEntity {
  movieId?: number | null
  seriesId?: number | null
}

const TVDB_TIMEOUT_MS = 8000
const TVDB_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

function tvdbApiBase(): string {
  const override = process.env.TVDB_API_URL?.replace(/\/+$/, "")
  if (override) return override
  return "https://api4.thetvdb.com/v4"
}

// Token JWT v4 (validi 1 mese) cachati 24h per hash chiave, mai plaintext.
// Su 401 il token si butta e si rifà login una volta (token scaduto).
const tvdbTokenCache = new Map<string, { token: string; exp: number }>()

async function tvdbLogin(tvdbKey: string): Promise<{ token: string | null; status: CatalogFetchStatus }> {
  const h = crypto.createHash("sha1").update(tvdbKey).digest("hex").slice(0, 8)
  const cached = tvdbTokenCache.get(h)
  if (cached && cached.exp > Date.now()) return { token: cached.token, status: "ok" }
  tvdbTokenCache.delete(h)
  const res = await fetch(`${tvdbApiBase()}/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 Pictorium" },
    body: JSON.stringify({ apikey: tvdbKey }),
    signal: AbortSignal.timeout(TVDB_TIMEOUT_MS),
  }).catch(() => null)
  if (!res || !res.ok) {
    log.warn("TVDB login failed", res ? { status: res.status } : {})
    const status = res?.status === 401 || res?.status === 403 ? "key_missing" : res?.status === 429 ? "rate_limited" : "unavailable"
    return { token: null, status }
  }
  const json = await res.json().catch(() => null)
  const token = typeof json?.data?.token === "string" ? json.data.token : null
  if (!token) return { token: null, status: "unavailable" }
  tvdbTokenCache.set(h, { token, exp: Date.now() + TVDB_TOKEN_TTL_MS })
  return { token, status: "ok" }
}

/** Reset del token cache (solo test). */
export function __resetTvdbTokenCache(): void {
  tvdbTokenCache.clear()
}

async function fetchTvdbList(url: string, tvdbKey: string | undefined, limit: number = 500): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  try {
    const trimmed = url.trim()
    const slugMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?thetvdb\.com\/lists\/([a-zA-Z0-9_.-]+)\/?(?:[?#].*)?$/i)
    const slug = slugMatch?.[1]
    if (!slug) {
      log.warn("TVDB list slug not supported as custom catalog")
      return empty("unsupported")
    }
    if (!tvdbKey) {
      log.warn("TVDB key missing: set it in Settings")
      return empty("key_missing")
    }

    const login = await tvdbLogin(tvdbKey)
    if (!login.token) return empty(login.status)
    let token = login.token
    let authFailure: CatalogFetchStatus | null = null

    const get = async (apiPath: string): Promise<Response | null> =>
      fetch(`${tvdbApiBase()}${apiPath}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": "Mozilla/5.0 Pictorium" },
        signal: AbortSignal.timeout(TVDB_TIMEOUT_MS),
      }).catch(() => null)

    // GET con un solo retry su 401 (token scaduto → re-login). Se anche il
    // retry è 401 con token fresco, è la risorsa a essere privata.
    const getWithAuth = async (apiPath: string): Promise<Response | null> => {
      let res = await get(apiPath)
      if (res && res.status === 401) {
        tvdbTokenCache.delete(crypto.createHash("sha1").update(tvdbKey).digest("hex").slice(0, 8))
        const refreshed = await tvdbLogin(tvdbKey)
        if (!refreshed.token) {
          authFailure = refreshed.status
          return null
        }
        token = refreshed.token
        res = await get(apiPath)
      }
      return res
    }

    const failStatus = (res: Response | null): CatalogFetchStatus | null => {
      if (!res) return authFailure ?? "unavailable"
      if (res.status === 401 || res.status === 403) return "private"
      if (res.status === 404) return "not_found"
      if (res.status === 429) return "rate_limited"
      if (!res.ok) return "unavailable"
      return null
    }

    const slugRes = await getWithAuth(`/lists/slug/${encodeURIComponent(slug)}`)
    const slugFail = failStatus(slugRes)
    if (slugFail) {
      if (slugFail !== "unavailable") log.warn("TVDB list slug fetch failed")
      return empty(slugFail)
    }
    const slugJson = await slugRes!.json().catch(() => null)
    const listId = Number(slugJson?.data?.id)
    if (!Number.isFinite(listId) || listId <= 0) {
      log.warn("TVDB list slug not resolved")
      return empty("not_found")
    }

    const extRes = await getWithAuth(`/lists/${listId}/extended`)
    const extFail = failStatus(extRes)
    if (extFail) {
      if (extFail !== "unavailable") log.warn("TVDB list fetch failed")
      return empty(extFail)
    }
    const extJson = await extRes!.json().catch(() => null)
    const entities: TvdbListEntity[] = extJson?.data?.entities || []
    const items: MDBListEntry[] = []
    for (const e of entities) {
      const movieId = typeof e.movieId === "number" ? e.movieId : null
      const seriesId = typeof e.seriesId === "number" ? e.seriesId : null
      if (movieId && movieId > 0) {
        items.push({ imdb: "", tvdb: movieId, title: "", year: 0, mediatype: "movie" })
      } else if (seriesId && seriesId > 0) {
        items.push({ imdb: "", tvdb: seriesId, title: "", year: 0, mediatype: "tv" })
      }
      if (items.length >= limit) break
    }
    return { items: items.slice(0, limit), status: items.length > 0 ? "ok" : "empty" }
  } catch (err) {
    log.error("Error fetching TVDB list", { error: (err as Error).message })
    return empty("unavailable")
  }
}

/**
 * Scarica i film di una TMDb Collection (saga) o TMDb List.
 */
async function fetchTmdbCollectionOrList(
  provider: "tmdb_collection" | "tmdb_list",
  identifier: string,
  apiKey?: string,
  limit: number = 500,
): Promise<MDBListEntry[]> {
  const key = apiKey || envWithFallback("TMDB_KEY") || process.env.TMDB_KEY || process.env.TMDB_API_KEY
  if (!key || !identifier) return []

  try {
    if (provider === "tmdb_collection") {
      const endpoint = `https://api.themoviedb.org/3/collection/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT`
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(8000) }).catch(() => null)
      if (!res || !res.ok) return []

      const data = await res.json()
      const rawParts: TmdbListPart[] = data?.parts || []

      return rawParts.slice(0, limit).map((p) => ({
        imdb: "",
        tmdb: Number(p.id) || undefined,
        title: p.title || p.name || "",
        year: Number((p.release_date || p.first_air_date || "").slice(0, 4)) || 0,
        mediatype: "movie",
        poster_path: p.poster_path ?? null,
      }))
    }

    // provider === "tmdb_list"
    // 1. Prova prima endpoint v3: /3/list/{list_id}
    const v3Endpoint = `https://api.themoviedb.org/3/list/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT`
    const res = await fetch(v3Endpoint, { signal: AbortSignal.timeout(8000) }).catch(() => null)
    const data = res && res.ok ? await res.json() : null
    let rawParts: TmdbListPart[] = data?.items || data?.parts || []

    if (data?.total_pages && data.total_pages > 1 && rawParts.length < limit) {
      const maxPages = Math.min(data.total_pages, Math.ceil(limit / 20))
      const CHUNK_SIZE = 5
      for (let i = 2; i <= maxPages; i += CHUNK_SIZE) {
        const chunkPromises: Promise<TmdbListPart[]>[] = []
        for (let p = i; p < Math.min(i + CHUNK_SIZE, maxPages + 1); p++) {
          const pageUrl = `https://api.themoviedb.org/3/list/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT&page=${p}`
          chunkPromises.push(
            fetch(pageUrl, { signal: AbortSignal.timeout(8000) })
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => (d?.items || d?.parts || []) as TmdbListPart[])
              .catch(() => [] as TmdbListPart[])
          )
        }
        const pageResults = await Promise.all(chunkPromises)
        for (const items of pageResults) {
          rawParts.push(...items)
        }
        if (rawParts.length >= limit) break
      }
    }

    // 2. Se v3 non trova la lista (es. 404 per liste create su TMDB v4) o non ha elementi, tenta endpoint v4: /4/list/{list_id}
    if (rawParts.length === 0) {
      const v4Endpoint = `https://api.themoviedb.org/4/list/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT`
      const resV4 = await fetch(v4Endpoint, { signal: AbortSignal.timeout(8000) }).catch(() => null)
      if (resV4 && resV4.ok) {
        const dataV4 = await resV4.json()
        rawParts = dataV4?.results || []
        if (dataV4?.total_pages && dataV4.total_pages > 1 && rawParts.length < limit) {
          const maxPages = Math.min(dataV4.total_pages, Math.ceil(limit / 20))
          const CHUNK_SIZE = 5
          for (let i = 2; i <= maxPages; i += CHUNK_SIZE) {
            const chunkPromises: Promise<TmdbListPart[]>[] = []
            for (let p = i; p < Math.min(i + CHUNK_SIZE, maxPages + 1); p++) {
              const pageUrl = `https://api.themoviedb.org/4/list/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT&page=${p}`
              chunkPromises.push(
                fetch(pageUrl, { signal: AbortSignal.timeout(8000) })
                  .then((r) => (r.ok ? r.json() : null))
                  .then((d) => (d?.results || []) as TmdbListPart[])
                  .catch(() => [] as TmdbListPart[])
              )
            }
            const pageResults = await Promise.all(chunkPromises)
            for (const items of pageResults) {
              rawParts.push(...items)
            }
            if (rawParts.length >= limit) break
          }
        }
      }
    }

    return rawParts.slice(0, limit).map((p) => ({
      imdb: "",
      tmdb: Number(p.id) || undefined,
      title: p.title || p.name || "",
      year: Number((p.release_date || p.first_air_date || "").slice(0, 4)) || 0,
      mediatype: p.media_type === "tv" ? "tv" : "movie",
      poster_path: p.poster_path ?? null,
    }))
  } catch (err) {
    log.error("Error fetching TMDb collection or list", { provider, identifier, error: (err as Error).message })
    return []
  }
}


import { getImdbDataset } from "@/lib/imdb-datasets"

/**
 * Item di uno snapshot CSV IMDb salvato nel namespace utente (o globale).
 * Ritorna al massimo `limit` voci già normalizzate all'import.
 */
async function fetchImdbDatasetItems(
  datasetId: string,
  userId: string | null,
  limit: number = 500,
): Promise<UnifiedCatalogResult> {
  try {
    const dataset = await getImdbDataset(datasetId, userId)
    if (!dataset) {
      log.warn("IMDb dataset not found")
      return { items: [], status: "not_found" }
    }
    const items = dataset.items.slice(0, limit)
    return { items, status: items.length > 0 ? "ok" : "empty" }
  } catch (err) {
    log.error("Error loading IMDb dataset", { error: (err as Error).message })
    return { items: [], status: "unavailable" }
  }
}

export interface UnifiedCatalogOptions {
  apiKey?: string
  mdblistKey?: string
  tvdbKey?: string
  limit?: number
  datasetId?: string
  userId?: string | null
}

/**
 * Dispatcher universale per recuperare gli elementi di qualsiasi catalogo o
 * lista esterna, con esito tipizzato (Fase 5). Solo gli "ok" con item vanno
 * in cache 30 min; gli errori transienti non avvelenano la cache.
 */
export async function fetchUnifiedCatalogResult(
  urlOrSlug: string,
  options?: UnifiedCatalogOptions,
): Promise<UnifiedCatalogResult> {
  const trimmed = urlOrSlug.trim()
  if (!trimmed) return { items: [], status: "empty" }

  const limit = options?.limit ?? 500
  const detection = detectCatalogProvider(trimmed)
  const provider = detection?.provider ?? "mdblist"

  // Le chiavi cambiano il payload (liste private/quote diverse) → parte del
  // cache key come hash, mai plaintext (stesso pattern di mdblist.ts). Senza,
  // il fallback pubblico senza chiave avvelenava la vista keyed e viceversa.
  // La Client ID Trakt d'istanza entra come hash: a rotazione chiave la cache
  // vecchia non viene servita per 30 min. Stesso per dataset e chiave TVDB:
  // due utenti non collidono mai.
  const hashFragment = (value: string | undefined): string =>
    value ? crypto.createHash("sha1").update(value).digest("hex").slice(0, 8) : "none"
  const cacheKey = `custom_cat:${provider}:${crypto.createHash("sha1").update(trimmed).digest("hex").slice(0, 10)}:${limit}:ak${hashFragment(options?.apiKey)}:mk${hashFragment(options?.mdblistKey)}:tk${hashFragment(getTraktClientId())}:ds${hashFragment(options?.datasetId)}:vk${hashFragment(options?.tvdbKey)}:u${hashFragment(options?.userId ?? undefined)}`
  const cached = cacheGet<MDBListEntry[]>(cacheKey)
  if (cached) return { items: cached, status: "ok" }

  let result: UnifiedCatalogResult = { items: [], status: "empty" }

  switch (provider) {
    case "letterboxd":
      result = await fetchLetterboxdList(trimmed, limit)
      break
    case "trakt":
      result = await fetchTraktList(trimmed, limit)
      break
    case "tmdb_collection":
    case "tmdb_list": {
      const parts = detection?.identifier
        ? await fetchTmdbCollectionOrList(provider, detection.identifier, options?.apiKey, limit)
        : []
      result = { items: parts, status: parts.length > 0 ? "ok" : "empty" }
      break
    }
    case "tvdb":
      result = await fetchTvdbList(trimmed, options?.tvdbKey, limit)
      break
    case "imdb": {
      // Solo snapshot CSV importati: niente scraping delle pagine IMDb.
      // Il dataset vive nel namespace utente (o globale); l'URL da solo
      // non basta e torna unsupported con warn invece di un catalogo morto.
      const csvRef = /^imdb-csv:/i.test(trimmed) ? detection?.identifier : undefined
      const dsId = options?.datasetId || csvRef
      if (dsId) {
        result = await fetchImdbDatasetItems(dsId, options?.userId ?? null, limit)
      } else {
        log.warn("IMDb URL lists require a CSV import (no scraping)")
        result = { items: [], status: "unsupported" }
      }
      break
    }
    case "mdblist":
    default: {
      const entries = await fetchCustomMDBList(trimmed, options?.mdblistKey, limit)
      result = { items: entries, status: entries.length > 0 ? "ok" : "empty" }
      break
    }
  }

  let items = result.items
  if (items.length > 0) {
    items = normalizeCatalogEntries(items, limit)
  }
  if (items.length > 0) {
    cacheSet(cacheKey, items, ["custom_catalogs"], CACHE_TTL_MS)
    return { items, status: "ok" }
  }
  // Normalizzazione che svuota tutto (solo-titoli) = catalogo inutilizzabile.
  if (result.items.length > 0) return { items: [], status: "empty" }
  return { items: [], status: result.status }
}

/**
 * Wrapper pipeline: la griglia Stremio tratta ogni non-ok come vuoto.
 */
export async function fetchUnifiedCatalogItems(
  urlOrSlug: string,
  options?: UnifiedCatalogOptions,
): Promise<MDBListEntry[]> {
  return (await fetchUnifiedCatalogResult(urlOrSlug, options)).items
}
