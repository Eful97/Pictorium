import crypto from "node:crypto"
import { cacheGet, cacheSet } from "@/lib/cache"
import { combineAbortSignals } from "@/lib/abort-signal"
import { fetchCustomMDBList, type MDBListEntry } from "@/lib/mdblist"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { isPrivateHost } from "@/lib/safe-remote-fetch"
import { detectCatalogProvider, isTraktUserContentUrl } from "./catalog-provider-detect"
import { sanitizeCustomCatalogSort, type CustomCatalogSortOrder } from "./types"

// Re-export per compatibilità: il riconoscimento URL vive in
// catalog-provider-detect.ts (foglia client-safe); route e test continuano
// a importarlo da qui senza modifiche.
export { detectCatalogProvider } from "./catalog-provider-detect"
export { isTraktWatchlistUrl } from "./catalog-provider-detect";


const log = createLogger("custom-catalogs")

function isHostInFamily(hostname: string, pinnedHost: string): boolean {
  const h = hostname.toLowerCase()
  const p = pinnedHost.toLowerCase()
  return h === p || h.endsWith(`.${p}`)
}

/**
 * Fetch verso un endpoint provider con host ESATTO e redirect manuali.
 *
 * Gli host dei provider sono fissi (o override d'istanza dell'operatore), mai
 * scelti dall'utente; l'unico salto controllabile da un upstream compromesso
 * sono i redirect. Il `fetch` nativo li segue in automatico, quindi un 302
 * verso `http://127.0.0.1/` o `http://169.254.169.254/` diventerebbe una SSRF.
 * Qui ogni hop (0 incluso) deve restare nella famiglia dell'host provider e
 * non essere un letterale privato; i body 3xx vengono cancellati invece di
 * restare appesi. Nessuna risoluzione DNS: gli host sono fissi e il trasporto
 * resta quello del provider (i test sostituiscono `global.fetch`).
 */
export async function fetchPinnedProviderUrl(
  url: string,
  init: RequestInit,
  pinnedHost: string,
): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= 3; hop++) {
    let target: URL
    try {
      target = new URL(current)
    } catch {
      throw new Error("Invalid provider URL")
    }
    const host = target.hostname.toLowerCase()
    if (!isHostInFamily(host, pinnedHost)) {
      throw new Error("Blocked provider host")
    }
    // Hop 0 is the provider BASE, built from operator configuration (fixed
    // host or instance override, never user input): a private/loopback base is
    // the operator's own choice, so it stays allowed (self-hosted mirror, the
    // E2E mock). Redirect hops never get that trust: a provider-issued 302
    // toward 127.0.0.1/link-local is the actual SSRF vector and stays blocked.
    if (hop > 0 && isPrivateHost(host)) {
      throw new Error("Blocked provider host")
    }
    const res = await fetch(current, { ...init, redirect: "manual" })
    // I mock dei test possono omettere `status`: un payload senza status è
    // trattato come 200 (comportamento storico di `res.ok`).
    const status = typeof res.status === "number" ? res.status : 200
    if (status < 300 || status >= 400) return res
    const location = res.headers?.get?.("location") ?? null
    if (!location) return res
    await res.body?.cancel().catch(() => {})
    current = new URL(location, current).href
  }
  throw new Error("Too many provider redirects")
}
// Successful normalized custom lists share one 12h source cache (user:
// "le liste personalizzate fai sempre 12 ore"). Errors, empties,
// incomplete/aborted prefixes and time-budget partials never land here.
const CUSTOM_LIST_SOURCE_TTL_MS = 12 * 60 * 60 * 1000

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
  | "connection_required"
  | "temporary"

export interface UnifiedCatalogResult {
  items: MDBListEntry[]
  status: CatalogFetchStatus
  /**
   * Internal completeness flag (correction1): true when pagination was
   * interrupted (abort mid-pages, page fetch error) and `items` is only a
   * partial prefix. The outer dispatcher must NEVER long-cache partials;
   * the catalog handler serves them short-TTL so the retry recovers.
   * Absent/false = complete (healthy results cache normally).
   */
  incomplete?: boolean
  /**
   * Owner-private provenance (task 4 correction cycle 1): true when the
   * items were fetched with the owner's verified Bearer under a fenced
   * lease. The Stremio catalog handler uses it to skip outer-cache writes
   * (and suppress the body) whenever the fence cannot be revalidated —
   * private items are never persisted under an unverifiable identity.
   * Absent/false = public or unfenced fetch (existing cache semantics).
   */
  traktPrivate?: boolean
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

/** Media record di discovery Trakt (film o serie, solo i campi che leggiamo). */
interface TraktDiscoveryMedia {
  ids?: TraktApiIds & { tvdb?: number | null }
  title?: string
  year?: number
}

/**
 * Item di discovery Trakt "wrapped" (docs ufficiali: trending
 * `GET /movies/trending` e `/shows/trending` → `{ watchers, movie|show }`;
 * anticipated `GET /movies/anticipated` e `/shows/anticipated` →
 * `{ list_count, movie|show }`; media miste `GET /media/trending` e
 * `/media/anticipated` → stessa forma wrapped con `movie` OPPURE `show`
 * (required solo `watchers`/`list_count`, niente `type` — vedi
 * developer.trakt.tv/openapi.json). Niente `type`, l'ordine API è il ranking
 * (più visti/listati prima). Popular (`GET /movies/popular`,
 * `/shows/popular`) restituisce invece record bare (il media stesso); la
 * media mista `GET /media/popular` restituisce record bare interleaved
 * (oneOf movie|show, required `[title, ids]`, niente wrapper né `type`).
 */
interface TraktWrappedDiscoveryItem {
  watchers?: number
  list_count?: number
  movie?: TraktDiscoveryMedia
  show?: TraktDiscoveryMedia
}

type TraktDiscoveryKind = "anticipated" | "trending" | "popular"
type TraktDiscoveryScope = "movies" | "shows" | "media"

/**
 * Chiave top-level presente solo nella variante movie dello schema ufficiale
 * `GET /media/popular` (la variante show non la definisce): chiavi Optional
 * in openapi.json — `?extended=full` richiesto ne migliora la presenza ma non
 * la garantisce. Vedi developer.trakt.tv/openapi.json, oneOf movie|show di
 * `getMediaPopular` (movie: `released`; show: `first_aired`, `aired_episodes`,
 * `airs`, `network`, ...). Presenza, non valore: quando presente,
 * `released: null` resta un marcatore movie esplicito; record senza alcun
 * marcatore esclusivo restano ambigui e vengono scartati.
 */
const TRAKT_MEDIA_MOVIE_KEYS = ["released"] as const

/**
 * Chiavi top-level presenti solo nella variante show dello schema ufficiale
 * `GET /media/popular` (la variante movie non le definisce): chiavi Optional
 * in openapi.json — `?extended=full` richiesto ne migliora la presenza ma non
 * la garantisce. Insieme alla presenza della chiave `tvdb` negli ids (la
 * variante show la definisce nullable, quella movie non la definisce
 * proprio), sono il marcatore show esplicito per i record bare misti — che
 * non hanno wrapper né `type`. Presenza, non valore: quando presenti,
 * `first_aired: null` o `tvdb: null` restano marcatori show espliciti;
 * record senza alcun marcatore esclusivo restano ambigui e vengono scartati.
 */
const TRAKT_MEDIA_SHOW_KEYS = ["aired_episodes", "first_aired", "last_aired", "airs", "network"] as const

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * Classifica un record di discovery mista (`GET /media/<kind>`) nella forma
 * ufficiale verificata, senza default impliciti:
 * - trending/anticipated: solo wrapped `{ watchers|list_count, movie|show }`
 *   con ESATTAMENTE una delle due chiavi (entrambe → ambiguo, nessuna →
 *   mancante: scartato);
 * - popular (richiesto con `?extended=full`, vedi fetchTraktDiscovery): solo
 *   record bare `{ title, year, ids }` (un record con chiavi oggetto
 *   `movie`/`show` non è bare → scartato, mai reinterpretato); movie se e
 *   solo se compare la chiave solo-movie `released` (presenza, anche null)
 *   SENZA alcun marcatore show; show se e solo se gli ids portano la chiave
 *   `tvdb` (presenza, anche null) oppure compaiono chiavi top-level
 *   solo-show, SENZA `released`. ENTRAMBE (movie+show) o NESSUNA → ambiguo,
 *   scartato: un record minimale valido per schema (`{ title, ids }` senza
 *   marcatori — la variante show richiede solo `[trakt, slug]`, `tvdb`
 *   opzionale) non è mai classificato movie in silenzio.
 * Ritorna null per ogni forma non ufficiale o ambigua: il caller scarta la
 * voce invece di emettere mediatype inventati o id Trakt nudi.
 */
function classifyTraktMediaRecord(
  kind: TraktDiscoveryKind,
  record: Record<string, unknown>,
): { media: TraktDiscoveryMedia; mediatype: "movie" | "tv" } | null {
  const wrapped = record as unknown as TraktWrappedDiscoveryItem
  const hasMovie = isRecordObject(wrapped.movie)
  const hasShow = isRecordObject(wrapped.show)
  if (kind === "popular") {
    if (hasMovie || hasShow) return null
    const ids = (record as unknown as TraktDiscoveryMedia).ids
    if (!isRecordObject(ids)) return null
    const movieMarked = TRAKT_MEDIA_MOVIE_KEYS.some((key) => key in record)
    const showMarked =
      "tvdb" in ids || TRAKT_MEDIA_SHOW_KEYS.some((key) => key in record)
    if (movieMarked === showMarked) return null
    const media = record as unknown as TraktDiscoveryMedia
    return { media, mediatype: showMarked ? "tv" : "movie" }
  }
  if (hasMovie === hasShow) return null
  if (hasMovie) return { media: wrapped.movie as TraktDiscoveryMedia, mediatype: "movie" }
  return { media: wrapped.show as TraktDiscoveryMedia, mediatype: "tv" }
}

const TRAKT_TIMEOUT_MS = 8000
const TRAKT_PAGE_LIMIT = 100
const TMDB_API_HOST = "api.themoviedb.org"

function getTraktClientId(): string | undefined {
  return envWithFallback("TRAKT_CLIENT_ID") || process.env.TRAKT_CLIENT_ID
}

/**
 * Header ufficiali Trakt v2 (stessi della path pubblica). Con `accessToken`
 * la chiamata è autenticata come proprietario (liste private + watchlist);
 * senza resta la Client ID d'istanza (liste pubbliche). Il token vive solo in
 * memoria server, mai nei log/URL/cache key (solo il suo hash di fences, vedi
 * dispatcher).
 */
function traktHeaders(clientId: string, accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    "User-Agent": "Mozilla/5.0 Pictorium",
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

// ── Authenticated Trakt (task 4) ──────────────────────────────────────
// Il contesto nasce SOLO da un UUID proprietario già autorizzato dal caller
// (preview browser: checkUserAuth sugli header; catalogo Stremio: namespace
// UUID dalla manifest URL). Mai token forniti dall'utente in query/body/
// config: il Bearer arriva server-side da getValidTraktAccessToken (con
// refresh coordinato) e la generation di fencing isola la cache.

type TraktAuthContext =
  | { kind: "token"; accessToken: string; generation: string | null; noCache: boolean }
  | { kind: "connection_required" }
  | { kind: "temporary" }
  | { kind: "key_missing" }

async function resolveTraktAuthContext(userId: string): Promise<TraktAuthContext> {
  // Coherent lease (task 4 correction cycle 1): generation-before, token,
  // generation-after with one refresh-tolerant retry live in
  // `getTraktCatalogLease` — this resolver never couples an old token to a
  // new fence. A generation outage with a verified token stays servable but
  // fenced out of every cache layer (`noCache`); without a verified token
  // every outage maps to its typed reason (fail-closed, never served).
  const { getTraktCatalogLease } = await import("@/lib/trakt-auth")
  const lease = await getTraktCatalogLease(userId)
  if (!lease.ok) {
    if (lease.reason === "connection_required") return { kind: "connection_required" }
    if (lease.reason === "key_missing") return { kind: "key_missing" }
    return { kind: "temporary" }
  }
  return { kind: "token", accessToken: lease.accessToken, generation: lease.generation, noCache: lease.noCache }
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
async function fetchLetterboxdList(url: string, limit: number = 500, signal?: AbortSignal): Promise<UnifiedCatalogResult> {
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
    const headRes = await fetchPinnedProviderUrl(requestUrl, {
      method: "HEAD",
      headers: {
        "User-Agent": "Mozilla/5.0 Pictorium",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: combineAbortSignals(signal, 8000),
    }, "letterboxd.com").catch(() => null)

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

    const res = await fetchPinnedProviderUrl(stremThruUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 Pictorium",
      },
      signal: combineAbortSignals(signal, 12000),
    }, "stremthru.13377001.xyz").catch(() => null)

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
 * Scarica una lista Trakt tramite API ufficiale Trakt v2 (router: discovery
 * pubblica invariata; contenuto utente con/senza Bearer del proprietario —
 * vedi fetchTraktWatchlist/fetchTraktStandardList).
 * Richiede la Client ID d'istanza (PICTORIUM_TRAKT_CLIENT_ID); le liste
 * pubbliche non richiedono OAuth.
 */
async function fetchTraktList(
  url: string,
  limit: number = 500,
  signal?: AbortSignal,
  traktAuth?: TraktAuthContext | null,
  sort?: { sortBy: string; sortHow: CustomCatalogSortOrder } | null,
): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  try {
    const trimmed = url.trim()
    // Discovery trending/anticipated/popular (film, serie o misti):
    // https://app.trakt.tv/discover/<kind>?mode=movie|show|media
    // (speculare al detect: solo i mode canonici del sito — `movie`, `show`
    // e `media` singolari; mode mancante/altro → unsupported esplicito, mai
    // default implicito né fetch incrociato). I misti usano gli endpoint
    // ufficiali `GET /media/<kind>` (singolo ranking upstream, mai
    // concatenazione di movie+show).
    const discoveryMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.|app\.)?trakt\.tv\/discover\/(anticipated|trending|popular)\/?(?:[?#].*)?$/i)
    if (discoveryMatch) {
      const kind = discoveryMatch[1].toLowerCase() as TraktDiscoveryKind
      let mode: string | null = null
      try {
        const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`)
        mode = urlObj.searchParams.get("mode")
      } catch {
        return empty("unsupported")
      }
      const normalized = mode?.toLowerCase()
      if (normalized === "movie") return fetchTraktDiscovery(kind, "movies", limit, signal)
      if (normalized === "show") return fetchTraktDiscovery(kind, "shows", limit, signal)
      if (normalized === "media") return fetchTraktDiscovery(kind, "media", limit, signal)
      log.warn(`Trakt ${kind} mode not supported as custom catalog`)
      return empty("unsupported")
    }
    // Smart-list web view (es. .../lists/smart/view/films-...): l'ID web è
    // opaco — le docs ufficiali richiedono un integer id per GET /lists/{id}
    // e non documentano alcun endpoint smart-list con sola Client ID.
    // Rifiuto esplicito senza rete: mai inviare films-... a /lists/{id},
    // mai scraping, mai sostituzioni. Se in futuro Trakt documenterà un
    // accesso con Client ID (o sarà autorizzato OAuth), implementarlo qui.
    const smartMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.|app\.)?trakt\.tv\/lists\/smart\/view\/([a-zA-Z0-9_.-]+)\/?(?:[?#].*)?$/i)
    if (smartMatch) {
      log.warn("Trakt smart list web IDs are opaque: no official client-ID endpoint")
      return empty("unsupported")
    }

    const traktMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.|app\.)?trakt\.tv\/(?:users\/([a-zA-Z0-9_.-]+)\/(?:lists\/([a-zA-Z0-9_.-]+)|watchlist)|lists\/([a-zA-Z0-9_.-]+))\/?(?:[?#].*)?$/i)
    if (!traktMatch) return empty("unsupported")

    const user = traktMatch[1]
    const slug = traktMatch[2] || traktMatch[3]
    const isWatchlist = trimmed.toLowerCase().includes("/watchlist")

    // Watchlist: solo il proprietario connesso (task 4). Senza contesto resta
    // `unsupported` (nessuna regressione pubblica); con contesto decide la
    // fetch autenticata sullo username incollato (mai /me in silenzio).
    if (isWatchlist) {
      if (!user) {
        log.warn("Trakt watchlist or slug-less list not supported as custom catalog")
        return empty("unsupported")
      }
      return fetchTraktWatchlist(user, limit, signal, traktAuth, sort)
    }
    if (!slug) {
      log.warn("Trakt watchlist or slug-less list not supported as custom catalog")
      return empty("unsupported")
    }

    return fetchTraktStandardList(user || null, slug, limit, signal, traktAuth, sort)
  } catch (err) {
    log.error("Error fetching Trakt list", { error: (err as Error).message })
    return empty("unavailable")
  }
}

/**
 * Loop paginato condiviso per gli endpoint Trakt lista/watchlist (docs
 * ufficiali: `page`/`limit` in query, ordine API preservato come ranking,
 * header di paginazione onorati, voci senza imdb/tmdb scartate — mai id Trakt
 * nudi). `transient` distingue il fallimento di trasporto della path pubblica
 * (`unavailable`, invariato) da quello autenticato (`temporary`: mai cache
 * lungo, mai downgrade silenzioso). Sulla path autenticata il 401 è
 * `connection_required` (grant morto dopo la validazione — riconnettiti),
 * il 403 resta `private` genuino; sulla pubblica 401/403 restano `private`.
 * Stesse scadenze/garanzie delle liste pubbliche.
 */
async function fetchTraktPaged(
  path: string,
  headers: Record<string, string>,
  limit: number,
  signal: AbortSignal | undefined,
  transient: "unavailable" | "temporary",
  authenticated = false,
  sort?: { sortBy: string; sortHow: CustomCatalogSortOrder } | null,
): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  // Partial prefix: pagination was interrupted (abort/page error) — the
  // caller may serve it but must never long-cache it (`incomplete`).
  const done = (items: MDBListEntry[], incomplete = false): UnifiedCatalogResult => ({
    items: items.slice(0, limit),
    status: items.length > 0 ? "ok" : "empty",
    ...(incomplete ? { incomplete: true as const } : {}),
  })
  try {
    const base = traktApiBase()
    const baseHost = new URL(base).hostname
    // Curated list order: Trakt's default item order is not guaranteed to be
    // the owner's rank, so public lists explicitly ask for `rank`/`asc`
    // (validated allowlist upstream) unless the space configured a sort.
    const sortBy = sort?.sortBy ?? "rank"
    const sortHow = sort?.sortHow ?? "asc"
    const maxPages = Math.max(1, Math.min(25, Math.ceil(limit / TRAKT_PAGE_LIMIT)))
    const items: MDBListEntry[] = []
    for (let page = 1; page <= maxPages; page++) {
      if (signal?.aborted) return items.length ? done(items, true) : empty(transient)
      const pageUrl = `${base}${path}?page=${page}&limit=${TRAKT_PAGE_LIMIT}&sort_by=${encodeURIComponent(sortBy)}&sort_how=${sortHow}`
      const res = await fetchPinnedProviderUrl(pageUrl, {
        headers,
        signal: combineAbortSignals(signal, TRAKT_TIMEOUT_MS),
      }, baseHost).catch(() => null)

      if (!res) return items.length ? done(items, true) : empty(transient)
      // Authenticated 401 (correction cycle 1): the Bearer was just
      // validated, so upstream rejecting it means the grant died (revoked /
      // expired past refresh) — explicit `connection_required`, never a
      // silent `private` that hides the reconnect path. Authenticated 403
      // stays `private` (valid token, genuinely forbidden — e.g. someone
      // else's list). The public path is untouched (401/403 → `private`,
      // remapped by the caller when the owner is disconnected).
      if (res.status === 401 && authenticated) {
        log.warn("Trakt access rejected for a validated Bearer — reconnect required")
        return empty("connection_required")
      }
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
        return items.length ? done(items, true) : empty(transient)
      }

      const json = await res.json().catch(() => null)
      // Explicit shape validation (correction2): malformed JSON (parse threw
      // => null) or a 200 without the expected page array is a failed page,
      // not a healthy empty tail. With a landed prefix the result is partial
      // (incomplete, never long-cached); with no rows yet it is transient.
      // A present (even empty) array stays healthy so legitimate last pages
      // never flag incomplete.
      let rawItems: TraktApiItem[] | null = null
      if (Array.isArray(json)) {
        rawItems = json
      } else if (json && typeof json === "object") {
        const dataItems = (json as { data?: { items?: unknown }; items?: unknown }).data?.items
        const flatItems = (json as { items?: unknown }).items
        if (Array.isArray(dataItems)) rawItems = dataItems as TraktApiItem[]
        else if (Array.isArray(flatItems)) rawItems = flatItems as TraktApiItem[]
      }
      if (rawItems === null) {
        log.warn("Trakt page malformed", { page })
        return items.length ? done(items, true) : empty(transient)
      }
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
    return empty(transient)
  }
}

/**
 * Watchlist del proprietario via endpoint ufficiale user-specific (docs
 * ufficiali `GET /users/{id}/watchlist/movie,show/{sort}`, sort `rank`):
 * lo username incollato viaggia a upstream così com'è — MAI sostituito con
 * `/me` o `/sync` in silenzio. Upstream autentica le restrizioni: la
 * watchlist privata di un altro utente torna 401/403 → `private` esplicito,
 * mai item altrui serviti. Zero fetch privata senza token valido: non
 * connesso → `connection_required` (riconnettiti, nessun item, nessuna rete
 * verso l'endpoint privato), transient → `temporary`, OAuth non configurato
 * → `key_missing`. Mai scraping, mai SSRF (base hardcoded, segmenti validati
 * dalla regex del router).
 */
async function fetchTraktWatchlist(
  user: string,
  limit: number,
  signal: AbortSignal | undefined,
  traktAuth: TraktAuthContext | null | undefined,
  sort?: { sortBy: string; sortHow: CustomCatalogSortOrder } | null,
): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  if (!traktAuth) {
    log.warn("Trakt watchlist or slug-less list not supported as custom catalog")
    return empty("unsupported")
  }
  if (traktAuth.kind !== "token") return empty(traktAuth.kind)
  const clientId = getTraktClientId()
  if (!clientId) {
    log.warn("Trakt client ID missing: set PICTORIUM_TRAKT_CLIENT_ID")
    return empty("key_missing")
  }
  return fetchTraktPaged(
    `/users/${encodeURIComponent(user)}/watchlist/movie,show/rank`,
    traktHeaders(clientId, traktAuth.accessToken),
    limit,
    signal,
    "temporary",
    true,
    sort,
  )
}

/**
 * Lista standard `users/<name>/lists/<slug>` o `/lists/<id>`: con Bearer del
 * proprietario connesso sblocca le liste private del proprietario; altrimenti
 * path pubblica invariata (le `/lists/<id>` numeriche restano sempre
 * pubbliche, Bearer inutile). La connessione assente/transient non toglie
 * l'accesso pubblico indipendente, ma un 401/403 pubblico su path utente con
 * proprietario disconnesso non diventa mai un `private` definitivo in
 * silenzio: è `connection_required` (la riconnessione può sbloccare) o
 * `temporary` (riprova). A token valido il 401/403 è `private` genuino.
 */
async function fetchTraktStandardList(
  user: string | null,
  slug: string,
  limit: number,
  signal: AbortSignal | undefined,
  traktAuth: TraktAuthContext | null | undefined,
  sort?: { sortBy: string; sortHow: CustomCatalogSortOrder } | null,
): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  const clientId = getTraktClientId()
  if (!clientId) {
    log.warn("Trakt client ID missing: set PICTORIUM_TRAKT_CLIENT_ID")
    return empty("key_missing")
  }
  const path = user
    ? `/users/${encodeURIComponent(user)}/lists/${encodeURIComponent(slug)}/items/movie,show`
    : `/lists/${encodeURIComponent(slug)}/items/movie,show`
  if (traktAuth?.kind === "token" && user) {
    return fetchTraktPaged(path, traktHeaders(clientId, traktAuth.accessToken), limit, signal, "temporary", true, sort)
  }
  const pub = await fetchTraktPaged(path, traktHeaders(clientId), limit, signal, "unavailable", false, sort)
  // 401/403 pubblico su path utente con proprietario non autenticabile qui:
  // disconnesso → reconnect esplicito; transient → riprova più tardi. Mai un
  // `private` definitivo che nasconde la via di riconnessione. (Token + path
  // nuda, o OAuth non configurabile: esito pubblico così com'è.)
  if (
    pub.status !== "private" ||
    !user ||
    !traktAuth ||
    traktAuth.kind === "key_missing" ||
    traktAuth.kind === "token"
  ) {
    return pub
  }
  return empty(traktAuth.kind)
}

/**
 * Scarica una discovery Trakt (trending/anticipated/popular; film, serie o
 * misti) tramite API ufficiale Trakt v2 (`GET /movies|shows|media/<kind>`,
 * docs ufficiali + developer.trakt.tv/openapi.json): richiede la stessa
 * Client ID d'istanza delle liste (PICTORIUM_TRAKT_CLIENT_ID), niente OAuth
 * (security: traktAPI da sola basta, OAuth opzionale). Forme ufficiali:
 * trending e anticipated sono wrapped (`{ watchers|list_count, movie|show }`,
 * niente `type` — anche gli endpoint misti `/media/...`, con una sola delle
 * due chiavi); popular è bare (il record film/serie stesso) e la media mista
 * `/media/popular` è bare interleaved (oneOf movie|show, niente wrapper né
 * `type`, richiesta con `?extended=full` — SOLO lì, mai su movie/show né su
 * trending/anticipated: il minimale `{ title, ids }` è ambiguo per schema,
 * con full movie porta `released` e show porta `tvdb`/`first_aired`/...;
 * entrambe o nessuna → ambiguo, scartato, mai default movie). L'ordine API è il ranking — preservato, mai concatenazioni.
 * Voci senza imdb/tmdb (serie: anche tvdb) non sono risolvibili dalla
 * pipeline (mai id Trakt nudi) e vengono scartate; voci ambigue o fuori forma
 * ufficiale (entrambe/nessuna chiave wrapped, wrapper dentro popular,
 * popular misto senza marcatore esclusivo o con entrambi) pure.
 * Stesse garanzie delle liste: paginazione limitata, abort → prefisso
 * parziale `incomplete` (mai long-cache), stessi status (key_missing,
 * private, not_found, rate_limited, unavailable).
 */
async function fetchTraktDiscovery(
  kind: TraktDiscoveryKind,
  scope: TraktDiscoveryScope,
  limit: number = 500,
  signal?: AbortSignal,
): Promise<UnifiedCatalogResult> {
  const empty = (status: CatalogFetchStatus): UnifiedCatalogResult => ({ items: [], status })
  const done = (items: MDBListEntry[], incomplete = false): UnifiedCatalogResult => ({
    items: items.slice(0, limit),
    status: items.length > 0 ? "ok" : "empty",
    ...(incomplete ? { incomplete: true as const } : {}),
  })
  try {
    const clientId = getTraktClientId()
    if (!clientId) {
      log.warn("Trakt client ID missing: set PICTORIUM_TRAKT_CLIENT_ID")
      return empty("key_missing")
    }

    const base = traktApiBase()
    const baseHost = new URL(base).hostname
    const headers = traktHeaders(clientId)
    const isMedia = scope === "media"
    const mediatype = scope === "movies" ? "movie" : "tv"
    const mediaKey = scope === "movies" ? "movie" : "show"
    const endpointScope = isMedia ? "media" : scope

    const maxPages = Math.max(1, Math.min(25, Math.ceil(limit / TRAKT_PAGE_LIMIT)))
    const items: MDBListEntry[] = []
    // La popular mista minimale è ambigua per schema (show senza `tvdb`
    // ≡ movie): SOLO lì si chiede `extended=full` così i record portano i
    // marcatori esclusivi (`released` vs `tvdb`/`first_aired`/...) e la
    // classifica non inventa mai il tipo. Movie/show e trending/anticipated
    // restano minimali (ordine e richieste invariati).
    const extendedSuffix = isMedia && kind === "popular" ? "&extended=full" : ""
    for (let page = 1; page <= maxPages; page++) {
      if (signal?.aborted) return items.length ? done(items, true) : empty("unavailable")
      const pageUrl = `${base}/${endpointScope}/${kind}?page=${page}&limit=${TRAKT_PAGE_LIMIT}${extendedSuffix}`
      const res = await fetchPinnedProviderUrl(pageUrl, {
        headers,
        signal: combineAbortSignals(signal, TRAKT_TIMEOUT_MS),
      }, baseHost).catch(() => null)

      if (!res) return items.length ? done(items, true) : empty("unavailable")
      if (res.status === 401 || res.status === 403) {
        log.warn(`Trakt ${kind} is private or forbidden`, { status: res.status })
        return empty("private")
      }
      if (res.status === 404) {
        log.warn(`Trakt ${kind} not found`)
        return empty("not_found")
      }
      if (res.status === 429) {
        const retryAfter = res.headers?.get?.("Retry-After") ?? null
        log.warn("Trakt rate limited", retryAfter ? { retryAfter } : {})
        return empty("rate_limited")
      }
      if (!res.ok) {
        log.warn(`Trakt ${kind} fetch failed`, { status: res.status })
        return items.length ? done(items, true) : empty("unavailable")
      }

      const json = await res.json().catch(() => null)
      // Stessa validazione esplicita delle liste: un 200 senza array top-level
      // (es. error body) è una pagina fallita, non una coda vuota sana. Con
      // prefisso atterrato → partial incomplete (mai long-cache); senza righe
      // → transient.
      const rawItems: unknown[] | null = Array.isArray(json) ? (json as unknown[]) : null
      if (rawItems === null) {
        log.warn(`Trakt ${kind} page malformed`, { page })
        return items.length ? done(items, true) : empty("unavailable")
      }
      if (rawItems.length === 0) break

      for (const raw of rawItems) {
        const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
        if (!record) continue
        // Scope misto: il record si classifica da solo nella forma ufficiale
        // (wrapped con una sola chiave per trending/anticipated, bare con
        // marcatore esclusivo per popular con extended=full) — mai default
        // a film, mai entrambe-le-chiavi/nessuna, mai wrapper dentro popular.
        let media: TraktDiscoveryMedia | undefined
        let entryType: "movie" | "tv" = mediatype
        if (isMedia) {
          const classified = classifyTraktMediaRecord(kind, record)
          if (!classified) continue
          media = classified.media
          entryType = classified.mediatype
        } else if (kind === "popular") {
          // Popular film/serie: record bare (il media stesso); trending/
          // anticipated: il media vive sotto la chiave movie|show.
          media = record as unknown as TraktDiscoveryMedia
        } else {
          const wrapped = record as unknown as TraktWrappedDiscoveryItem
          media = wrapped[mediaKey] ?? undefined
        }
        const ids = media?.ids || {}
        const title = media?.title || ""
        const year = Number(media?.year) || 0
        const imdb = typeof ids.imdb === "string" ? ids.imdb : ""
        const tmdb = typeof ids.tmdb === "number" && Number.isFinite(ids.tmdb) ? ids.tmdb : undefined
        const tvdb = typeof ids.tvdb === "number" && Number.isFinite(ids.tvdb) ? ids.tvdb : undefined
        if (imdb || tmdb || tvdb) {
          items.push({ imdb, tmdb, tvdb, title, year, mediatype: entryType })
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
    log.error(`Error fetching Trakt ${kind}`, { error: (err as Error).message })
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

async function tvdbLogin(tvdbKey: string, signal?: AbortSignal): Promise<{ token: string | null; status: CatalogFetchStatus }> {
  const h = crypto.createHash("sha1").update(tvdbKey).digest("hex").slice(0, 8)
  const cached = tvdbTokenCache.get(h)
  if (cached && cached.exp > Date.now()) return { token: cached.token, status: "ok" }
  tvdbTokenCache.delete(h)
  const tvdbHost = new URL(tvdbApiBase()).hostname
  const res = await fetchPinnedProviderUrl(`${tvdbApiBase()}/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 Pictorium" },
    body: JSON.stringify({ apikey: tvdbKey }),
    signal: combineAbortSignals(signal, TVDB_TIMEOUT_MS),
  }, tvdbHost).catch(() => null)
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

async function fetchTvdbList(url: string, tvdbKey: string | undefined, limit: number = 500, signal?: AbortSignal): Promise<UnifiedCatalogResult> {
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

    const login = await tvdbLogin(tvdbKey, signal)
    if (!login.token) return empty(login.status)
    let token = login.token
    let authFailure: CatalogFetchStatus | null = null

    const tvdbHost = new URL(tvdbApiBase()).hostname
    const get = async (apiPath: string): Promise<Response | null> =>
      fetchPinnedProviderUrl(`${tvdbApiBase()}${apiPath}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": "Mozilla/5.0 Pictorium" },
        signal: combineAbortSignals(signal, TVDB_TIMEOUT_MS),
      }, tvdbHost).catch(() => null)

    // GET con un solo retry su 401 (token scaduto → re-login). Se anche il
    // retry è 401 con token fresco, è la risorsa a essere privata.
    const getWithAuth = async (apiPath: string): Promise<Response | null> => {
      let res = await get(apiPath)
      if (res && res.status === 401) {
        tvdbTokenCache.delete(crypto.createHash("sha1").update(tvdbKey).digest("hex").slice(0, 8))
        const refreshed = await tvdbLogin(tvdbKey, signal)
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
 * Ritorna anche `incomplete` (correction1): true quando la paginazione è
 * stata interrotta (abort) o una pagina è fallita (catch) e `items` è solo
 * un prefisso parziale — il dispatcher non deve mai cacharlo a lungo.
 */
async function fetchTmdbCollectionOrList(
  provider: "tmdb_collection" | "tmdb_list",
  identifier: string,
  apiKey?: string,
  limit: number = 500,
  signal?: AbortSignal,
): Promise<{ items: MDBListEntry[]; incomplete: boolean }> {
  const key = apiKey || envWithFallback("TMDB_KEY") || process.env.TMDB_KEY || process.env.TMDB_API_KEY
  if (!key || !identifier) return { items: [], incomplete: false }

  try {
    if (provider === "tmdb_collection") {
      const endpoint = `https://api.themoviedb.org/3/collection/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT`
      const res = await fetchPinnedProviderUrl(endpoint, { signal: combineAbortSignals(signal, 8000) }, TMDB_API_HOST).catch(() => null)
      if (!res || !res.ok) return { items: [], incomplete: false }

      const data = await res.json()
      const rawParts: TmdbListPart[] = data?.parts || []

      return {
        items: rawParts.slice(0, limit).map((p) => ({
          imdb: "",
          tmdb: Number(p.id) || undefined,
          title: p.title || p.name || "",
          year: Number((p.release_date || p.first_air_date || "").slice(0, 4)) || 0,
          mediatype: "movie",
          poster_path: p.poster_path ?? null,
        })),
        incomplete: false,
      }
    }

    // provider === "tmdb_list"
    // 1. Prova prima endpoint v3: /3/list/{list_id}
    const v3Endpoint = `https://api.themoviedb.org/3/list/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT`
    const res = await fetchPinnedProviderUrl(v3Endpoint, { signal: combineAbortSignals(signal, 8000) }, TMDB_API_HOST).catch(() => null)
    const data = res && res.ok ? await res.json() : null
    let rawParts: TmdbListPart[] = data?.items || data?.parts || []
    let incomplete = false
    // A page that fails (non-ok, bad JSON, throw/abort) leaves a partial
    // prefix: mark it so the dispatcher never long-caches the window.
    const fetchPage = async (
      pageUrl: string,
      pick: (d: { items?: TmdbListPart[]; parts?: TmdbListPart[]; results?: TmdbListPart[] } | null) => TmdbListPart[],
      expectedKeys: string[],
    ): Promise<TmdbListPart[]> => {
      try {
        const r = await fetchPinnedProviderUrl(pageUrl, { signal: combineAbortSignals(signal, 8000) }, TMDB_API_HOST)
        if (!r.ok) {
          incomplete = true
          return []
        }
        const d = await r.json().catch(() => null)
        // Explicit shape validation (correction2): malformed JSON (null) or
        // a 200 without the expected page array is a failed page, not a
        // healthy empty tail. A present (even empty) array stays healthy so
        // legitimate last pages never flag incomplete.
        if (
          !d ||
          typeof d !== "object" ||
          !expectedKeys.some((k) => Array.isArray((d as unknown as Record<string, unknown>)[k]))
        ) {
          incomplete = true
          return []
        }
        return pick(d)
      } catch {
        incomplete = true
        return []
      }
    }

    if (data?.total_pages && data.total_pages > 1 && rawParts.length < limit) {
      const maxPages = Math.min(data.total_pages, Math.ceil(limit / 20))
      const CHUNK_SIZE = 5
      for (let i = 2; i <= maxPages; i += CHUNK_SIZE) {
        if (signal?.aborted) {
          incomplete = true
          break
        }
        const chunkPromises: Promise<TmdbListPart[]>[] = []
        for (let p = i; p < Math.min(i + CHUNK_SIZE, maxPages + 1); p++) {
          const pageUrl = `https://api.themoviedb.org/3/list/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT&page=${p}`
          chunkPromises.push(fetchPage(pageUrl, (d) => (d?.items || d?.parts || []) as TmdbListPart[], ["items", "parts"]))
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
      const resV4 = await fetchPinnedProviderUrl(v4Endpoint, { signal: combineAbortSignals(signal, 8000) }, TMDB_API_HOST).catch(() => null)
      if (resV4 && resV4.ok) {
        const dataV4 = await resV4.json()
        rawParts = dataV4?.results || []
        if (dataV4?.total_pages && dataV4.total_pages > 1 && rawParts.length < limit) {
          const maxPages = Math.min(dataV4.total_pages, Math.ceil(limit / 20))
          const CHUNK_SIZE = 5
          for (let i = 2; i <= maxPages; i += CHUNK_SIZE) {
            if (signal?.aborted) {
              incomplete = true
              break
            }
            const chunkPromises: Promise<TmdbListPart[]>[] = []
            for (let p = i; p < Math.min(i + CHUNK_SIZE, maxPages + 1); p++) {
              const pageUrl = `https://api.themoviedb.org/4/list/${encodeURIComponent(identifier)}?api_key=${encodeURIComponent(key)}&language=it-IT&page=${p}`
              chunkPromises.push(fetchPage(pageUrl, (d) => (d?.results || []) as TmdbListPart[], ["results"]))
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

    return {
      items: rawParts.slice(0, limit).map((p) => ({
        imdb: "",
        tmdb: Number(p.id) || undefined,
        title: p.title || p.name || "",
        year: Number((p.release_date || p.first_air_date || "").slice(0, 4)) || 0,
        mediatype: p.media_type === "tv" ? "tv" : "movie",
        poster_path: p.poster_path ?? null,
      })),
      incomplete,
    }
  } catch (err) {
    log.error("Error fetching TMDb collection or list", { provider, identifier, error: (err as Error).message })
    return { items: [], incomplete: false }
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
  signal?: AbortSignal
  /**
   * Optional explicit item sort for provider lists that support it. Values are
   * validated against the provider allowlist (`sanitizeCustomCatalogSort`):
   * unknown provider/field/order is ignored, never forwarded upstream. Absent
   * keeps the provider default (Trakt public lists still explicitly request
   * the curated `rank`/`asc` order).
   */
  sortBy?: string
  sortHow?: CustomCatalogSortOrder
  /**
   * UUID proprietario fidato (task 4, vedi sopra): abilita watchlist/liste
   * private Trakt dopo il controllo auth/capability del caller. Mai un token
   * fornito dall'utente. Ignorato fuori dai path contenuto-utente Trakt.
   */
  traktUserId?: string | null
}

/**
 * Universal dispatcher for fetching items from any catalog or
 * external list, with a typed outcome (Phase 5). Only successful "ok"
 * results with items go into cache (12h for every supported custom-list
 * source); transient errors never poison the cache.
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
  // Explicit per-list sort (validated allowlist): unknown provider/key is
  // ignored at the boundary. Only an accepted explicit sort enters the 12h
  // source cache key (legacy keys stay byte-identical without one).
  const sort = sanitizeCustomCatalogSort(provider, options?.sortBy, options?.sortHow)
  const sortCacheFragment = sort ? `:so${sort.sortBy}:${sort.sortHow}` : ""

  // Contesto Trakt autenticato (task 4): risolto una sola volta PRIMA della
  // cache così la generation di fencing entra nel key — isolamento per UUID +
  // connessione: reconnect/disconnect/wipe cambiano chiave e gli item privati
  // pre-disconnect diventano irraggiungibili in L1 e L2 (scadono per TTL).
  // Solo path contenuto-utente (`users/<name>/lists|watchlist`); bare
  // `/lists/<id>`, discovery, smart e altri provider: contesto null e key
  // byte-identiche a prima.
  const traktOwner = options?.traktUserId ?? null
  const traktAuth: TraktAuthContext | null =
    provider === "trakt" && traktOwner && isTraktUserContentUrl(trimmed)
      ? await resolveTraktAuthContext(traktOwner)
      : null
  // Generation illeggibile (outage): si serve senza toccare la cache (né
  // lettura né scrittura) invece di chiaveare item privati su un frammento
  // condiviso.
  const traktNoCache = traktAuth?.kind === "token" && traktAuth.noCache

  // Le chiavi cambiano il payload (liste private/quote diverse) → parte del
  // cache key come hash, mai plaintext (stesso pattern di mdblist.ts). Senza,
  // il fallback pubblico senza chiave avvelenava la vista keyed e viceversa.
  // La Client ID Trakt d'istanza entra come hash: a rotazione chiave la cache
  // vecchia non viene servita per 12h. Stesso per dataset e chiave TVDB:
  // due utenti non collidono mai. Il contesto Trakt aggiunge UUID proprietario
  // + generation di fencing (solo path contenuto-utente autenticate): due
  // utenti con lo stesso URL incollato non condividono mai nulla, e dopo
  // disconnect/reconnect la chiave vecchia non viene più letta.
  const hashFragment = (value: string | undefined): string =>
    value ? crypto.createHash("sha1").update(value).digest("hex").slice(0, 8) : "none"
  const traktCacheFragment =
    !traktAuth || !traktOwner
      ? ""
      : traktAuth.kind === "token"
        ? `:tu${hashFragment(traktOwner)}:tg${hashFragment(traktAuth.generation ?? "none")}`
        : `:tu${hashFragment(traktOwner)}:tg${traktAuth.kind}`
  const cacheKey = `custom_cat:${provider}:${crypto.createHash("sha1").update(trimmed).digest("hex").slice(0, 10)}:${limit}:ak${hashFragment(options?.apiKey)}:mk${hashFragment(options?.mdblistKey)}:tk${hashFragment(getTraktClientId())}:ds${hashFragment(options?.datasetId)}:vk${hashFragment(options?.tvdbKey)}:u${hashFragment(options?.userId ?? undefined)}${traktCacheFragment}${sortCacheFragment}`
  const cached = traktNoCache ? null : cacheGet<MDBListEntry[]>(cacheKey)
  if (cached) return { items: cached, status: "ok" }

  let result: UnifiedCatalogResult = { items: [], status: "empty" }

  switch (provider) {
    case "letterboxd":
      result = await fetchLetterboxdList(trimmed, limit, options?.signal)
      break
    case "trakt":
      result = await fetchTraktList(trimmed, limit, options?.signal, traktAuth, sort)
      break
    case "tmdb_collection":
    case "tmdb_list": {
      const fetched = detection?.identifier
        ? await fetchTmdbCollectionOrList(provider, detection.identifier, options?.apiKey, limit, options?.signal)
        : { items: [] as MDBListEntry[], incomplete: false }
      result = {
        items: fetched.items,
        status: fetched.items.length > 0 ? "ok" : "empty",
        ...(fetched.incomplete ? { incomplete: true as const } : {}),
      }
      break
    }
    case "tvdb":
      result = await fetchTvdbList(trimmed, options?.tvdbKey, limit, options?.signal)
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
      const entries = await fetchCustomMDBList(trimmed, options?.mdblistKey, limit, options?.signal, sort)
      result = { items: entries, status: entries.length > 0 ? "ok" : "empty" }
      break
    }
  }

  // Post-fetch fence revalidation (task 4 correction cycle 1): a
  // disconnect/wipe/reconnect that landed DURING the paged upstream fetch
  // must never bind old-token items to any fence — no stale write, no stale
  // return. Fully verified stable fence → `traktPrivateVerified` (normal
  // caching + provenance below). Verified token with an unreadable fence at
  // either end → serve fresh to the owner, never persist. Moved fence or a
  // lost connection → fail closed with the fresh typed status.
  let traktPrivateVerified = false
  if (
    provider === "trakt" &&
    traktAuth?.kind === "token" &&
    traktOwner &&
    result.status === "ok" &&
    result.items.length > 0
  ) {
    const { getTraktCatalogLease: getFreshLease } = await import("@/lib/trakt-auth")
    const fresh = await getFreshLease(traktOwner).catch(() => null)
    if (!fresh || !fresh.ok) {
      return { items: [], status: !fresh ? "temporary" : fresh.reason }
    }
    if (!traktAuth.noCache && !fresh.noCache && fresh.generation === traktAuth.generation) {
      traktPrivateVerified = true
    } else if (!traktAuth.noCache && !fresh.noCache) {
      return { items: [], status: "temporary" }
    }
  }

  let items = result.items
  if (items.length > 0) {
    items = normalizeCatalogEntries(items, limit)
  }
  // Bearer provenance for the outer handler (correction cycle 1): set only
  // when this response actually serves owner-fetched items — suppressed
  // responses returned above carry none, public fallbacks never qualify.
  const traktPrivateServed =
    provider === "trakt" && traktAuth?.kind === "token" && items.length > 0 && result.status === "ok"
  // Interrupted provider pagination must NEVER long-cache: a partial prefix
  // stays servable this request but is not written to the 12h source
  // cache (healthy TTLs untouched). The flag propagates so the catalog
  // handler serves the body short-TTL and the retry refetches.
  if (result.incomplete) {
    return {
      items,
      status: items.length > 0 ? "ok" : result.status,
      incomplete: true as const,
      ...(traktPrivateServed ? { traktPrivate: true as const } : {}),
    }
  }
  if (items.length > 0 && !traktNoCache && (provider !== "trakt" || traktAuth?.kind !== "token" || traktPrivateVerified)) {
    cacheSet(cacheKey, items, ["custom_catalogs"], CUSTOM_LIST_SOURCE_TTL_MS)
    return { items, status: "ok", ...(traktPrivateServed ? { traktPrivate: true as const } : {}) }
  }
  if (items.length > 0) return { items, status: "ok", ...(traktPrivateServed ? { traktPrivate: true as const } : {}) }
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
