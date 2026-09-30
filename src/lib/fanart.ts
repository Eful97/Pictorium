/**
 * Client Fanart.tv (poster verticali v1).
 *
 * Solo poster: film via ID TMDB (`/movies/{tmdbId}`), serie via ID TVDB
 * (`/tv/{tvdbId}`, risolto dagli external_ids TMDB — mai il TMDB-id della
 * serie passato diretto a Fanart). Niente SDK: fetch + `timedFetch`.
 *
 * Chiave progetto server-only (`PICTORIUM_FANART_KEY`, fallback
 * `POSTERIUM_FANART_KEY`): non entra mai in cache-key, mapping o URL.
 * La `client_key` personale è rinviata (richiederebbe cache per-contesto).
 */

import { z } from "zod"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { combineAbortSignals } from "./abort-signal"
import { timedFetch } from "./outbound-stats"

const log = createLogger("fanart")

const FANART_BASE = process.env.FANART_API_URL || "https://webservice.fanart.tv/v3"

/** Deadline complessiva Fanart (rete upstream lenta = 502, mai hang). */
export const FANART_TIMEOUT_MS = 5000
/** Hit con poster: 24h. Assenza confermata (404/vuoto): 10 minuti. */
export const FANART_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const FANART_EMPTY_TTL_MS = 10 * 60 * 1000
const FANART_CACHE_MAX = 500

export interface FanartPoster {
  readonly url: string
  /** Codice lingua Fanart così com'è ("en", "it", "00", ...). "00"/assente
   *  = lingua ignota, MAI "senza scritte": la UI conserva la distinzione. */
  readonly lang: string | null
  readonly likes: number
  readonly width?: number
  readonly height?: number
}

export type FanartMediaType = "movie" | "tv"

/** Errori tipizzati: solo questi distinguono "assenza" da "guasto". */
export class FanartError extends Error {
  readonly code: "not_configured" | "auth" | "upstream" | "timeout"
  constructor(code: FanartError["code"], message: string) {
    super(message)
    this.code = code
  }
}

const fanartItemSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  url: z.string(),
  lang: z.string().nullable().optional(),
  likes: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough()

const fanartMovieSchema = z.object({
  movieposter: z.array(fanartItemSchema).optional(),
}).passthrough()

const fanartTvSchema = z.object({
  tvposter: z.array(fanartItemSchema).optional(),
}).passthrough()

function toLikes(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  if (typeof raw === "string") {
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return 0
}

/**
 * Normalizza+ordina una lista poster Fanart: scarta URL non-http(s),
 * deduplica per URL (tiene i likes massimi), ordina per likes desc.
 * Pura e testabile.
 */
export function normalizeFanartPosters(items: readonly unknown[]): FanartPoster[] {
  const byUrl = new Map<string, FanartPoster>()
  for (const raw of items) {
    const parsed = fanartItemSchema.safeParse(raw)
    if (!parsed.success) continue
    const url = parsed.data.url.trim()
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue
    const entry: FanartPoster = {
      url,
      lang: typeof parsed.data.lang === "string" && parsed.data.lang.length > 0 ? parsed.data.lang : null,
      likes: toLikes(parsed.data.likes),
    }
    const prev = byUrl.get(url)
    if (!prev || entry.likes > prev.likes) byUrl.set(url, entry)
  }
  return [...byUrl.values()].sort((a, b) => b.likes - a.likes)
}

/** Chiave progetto Fanart d'istanza (server-only, fallback quando lo spazio non ne ha una). */
export function fanartProjectKey(): string | undefined {
  const key = envWithFallback("FANART_KEY")
  return key && key.trim().length > 0 ? key.trim() : undefined
}

export interface FanartFetchOpts {
  /** Chiave TMDB per risolvere il tvdb_id delle serie (external_ids). */
  tmdbApiKey?: string
  /** Chiave progetto Fanart dello spazio utente: vince sull'env d'istanza. */
  fanartKey?: string
}

interface FanartCacheEntry {
  posters: FanartPoster[]
  expiry: number
}

const fanartCache = new Map<string, FanartCacheEntry>()

function cacheKeyFor(type: FanartMediaType, id: number): string {
  // Solo tipo+id: la chiave progetto è globale d'istanza, mai per-utente.
  return `${type}:${id}`
}

function cacheGetValid(key: string): FanartPoster[] | null {
  const entry = fanartCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiry) {
    fanartCache.delete(key)
    return null
  }
  return entry.posters
}

function cacheSetBounded(key: string, posters: FanartPoster[], ttlMs: number): void {
  if (fanartCache.size >= FANART_CACHE_MAX) fanartCache.delete(fanartCache.keys().next().value!)
  fanartCache.set(key, { posters, expiry: Date.now() + ttlMs })
}

/** Solo per i test. */
export function __resetFanartCache(): void {
  fanartCache.clear()
}

function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError")
}

async function fetchFanartJson(path: string, apiKey: string, signal: AbortSignal): Promise<Response> {
  const url = new URL(`${FANART_BASE}${path}`)
  // Chiave solo nella URL outbound (contratto Fanart v3 `?api_key=`), mai
  // in cache-key, log o risposta.
  url.searchParams.set("api_key", apiKey)
  return timedFetch(url.toString(), {
    signal: combineAbortSignals(signal, FANART_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  })
}

/**
 * Poster verticali Fanart per un titolo TMDB.
 * - movie: `/movies/{tmdbId}` diretto.
 * - tv: risolve `tvdb_id` via TMDB external_ids (serve `opts.tmdbApiKey`), poi
 *   `/tv/{tvdbId}`. Senza tvdb_id → [] (titolo non interrogabile, non un
 *   guasto). Il TMDB-id della serie non viene MAI passato a Fanart.
 *
 * Chiave effettiva: `opts.fanartKey` (spazio utente) > env d'istanza. La cache
 * resta globale per titolo (come il neutral-cache TMDB): i risultati non
 * contengono segreti, solo URL CDN — nessuno spazio vede la chiave altrui.
 *
 * Lancia FanartError su: chiave mancante, auth (401/403), timeout, guasti
 * (429/5xx/rete). Solo 404 e 200-senza-poster ritornano [] (e solo quelli
 * finiscono nella negative cache da 10 minuti).
 */
export async function getFanartPosters(
  type: FanartMediaType,
  tmdbId: number,
  opts?: FanartFetchOpts,
  signal?: AbortSignal,
): Promise<FanartPoster[]> {
  const apiKey = opts?.fanartKey?.trim() || fanartProjectKey()
  if (!apiKey) throw new FanartError("not_configured", "Fanart.tv project key is not configured")
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return []

  const key = cacheKeyFor(type, tmdbId)
  const hit = cacheGetValid(key)
  if (hit) return hit

  const work = async (): Promise<FanartPoster[]> => {
    if (type === "movie") {
      const res = await fetchFanartJson(`/movies/${tmdbId}`, apiKey, signal ?? AbortSignal.timeout(FANART_TIMEOUT_MS))
      return await readPosterList(res, fanartMovieSchema, "movieposter")
    }
    // Serie: serve il TVDB id.
    let tvdbId: number | null = null
    try {
      const { getExternalIds } = await import("@/lib/tmdb")
      const ext = await getExternalIds("tv", tmdbId, opts?.tmdbApiKey, signal)
      tvdbId = ext?.tvdb_id && ext.tvdb_id > 0 ? ext.tvdb_id : null
    } catch {
      // external_ids fallito = guasto upstream, non "nessun artwork".
      throw new FanartError("upstream", "TMDB external_ids unavailable")
    }
    if (!tvdbId) return []
    const res = await fetchFanartJson(`/tv/${tvdbId}`, apiKey, signal ?? AbortSignal.timeout(FANART_TIMEOUT_MS))
    return await readPosterList(res, fanartTvSchema, "tvposter")
  }

  let posters: FanartPoster[]
  try {
    posters = await work()
  } catch (e) {
    if (e instanceof FanartError) throw e
    if (isTimeoutError(e) || signal?.aborted) throw new FanartError("timeout", "Fanart.tv request timed out")
    log.warn("Fanart fetch failed", { type, tmdbId })
    throw new FanartError("upstream", "Fanart.tv unavailable")
  }
  // Cache: hit 24h, assenza confermata 10min. Guasti non arrivano qui.
  cacheSetBounded(key, posters, posters.length > 0 ? FANART_CACHE_TTL_MS : FANART_EMPTY_TTL_MS)
  return posters
}

async function readPosterList(
  res: Response,
  schema: typeof fanartMovieSchema | typeof fanartTvSchema,
  field: "movieposter" | "tvposter",
): Promise<FanartPoster[]> {
  // 404 Fanart = voce assente: assenza confermata, non guasto.
  if (res.status === 404) return []
  if (res.status === 401 || res.status === 403) throw new FanartError("auth", "Fanart.tv rejected the project key")
  if (res.status === 429 || res.status >= 500) throw new FanartError("upstream", `Fanart.tv responded with status ${res.status}`)
  if (!res.ok) throw new FanartError("upstream", `Fanart.tv responded with status ${res.status}`)
  const json = (await res.json().catch(() => null)) as unknown
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    log.warn("Fanart response shape changed", { field })
    throw new FanartError("upstream", "Fanart.tv returned an unexpected response")
  }
  const raw = (parsed.data as Record<string, unknown[]>)[field]
  return normalizeFanartPosters(Array.isArray(raw) ? raw : [])
}
