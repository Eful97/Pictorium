import { cacheGet, cacheSet } from "./cache"
import { timedFetch } from "./outbound-stats"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { createCircuitBreaker, parseRetryAfterMs } from "@/lib/circuit-breaker"
import { combineAbortSignals } from "@/lib/abort-signal"
import { isValidImdbId } from "./imdb-csv"
import { APP_VERSION } from "@/generated/app-version"

/**
 * TVmaze: fonte voto OPZIONALE (solo serie/anime), attivabile con
 * `rsrc=tvmaze`. Endpoint pubblico, nessuna chiave API.
 *
 * - `GET /lookup/shows?imdb=<tt...>` → `rating.average` (scala 0-10, 1
 *   decimale, nullable). Nessun campo `votes` nell'API: il valore resta
 *   l'average dichiarato dall'upstream, mai un conteggio inventato e mai una
 *   conversione di scala (movies like).
 * - I film non hanno lookup IMDb su TVmaze (404): miss, mai un voto finto.
 * - Fallback `?thetvdb=<id>` disponibile quando il chiamante ha un ID TVDB;
 *   oggi `ratings.ts` non lo passa (nessun ID TVDB nel contratto aggregato),
 *   quindi il percorso effettivo è IMDb-only (gap documentato, fail-open).
 * - Rate limit pubblico ~20 richieste/10s senza chiave: un solo fetch per
 *   titolo, breaker dedicato e cache positiva 6h (voto giornaliero).
 * - Dati TVmaze distribuiti con licenza CC BY-SA 4.0 (attribuzione dovuta
 *   all'upstream): qui nessun testo legale in UI, il provider è opt-in.
 */

const log = createLogger("tvmaze")

const TVMAZE_BASE = process.env.TVMAZE_API_URL || "https://api.tvmaze.com"
const USER_AGENT = `Pictorium/${APP_VERSION}`

const TVMAZE_TIMEOUT_MS = (() => {
  const raw = envWithFallback("TVMAZE_TIMEOUT_MS")
  const n = raw ? parseInt(raw, 10) : 1500
  return Number.isFinite(n) && n >= 300 && n <= 10000 ? n : 1500
})()

// Fail-open circuit breaker dedicato: 3 fallimenti consecutivi → 30s di cooldown.
const tvmazeBreaker = createCircuitBreaker({ name: "tvmaze", failureThreshold: 3, backoffMs: 30_000 })

/** Solo per i test: azzera lo stato del breaker TVmaze. */
export function __resetTvmazeBreaker(): void {
  tvmazeBreaker.reset()
}

export function isTvmazeBreakerOpen(): boolean {
  return tvmazeBreaker.peekOpen()
}

const TVMAZE_NULL_TTL_MS = 60_000
const TVMAZE_NULL_MAX = 500
const tvmazeNullAt = new Map<string, number>()

function tvmazeNullSet(cacheKey: string): void {
  if (tvmazeNullAt.size >= TVMAZE_NULL_MAX) {
    const firstKey = tvmazeNullAt.keys().next().value
    if (firstKey) tvmazeNullAt.delete(firstKey)
  }
  tvmazeNullAt.set(cacheKey, Date.now())
}

function tvmazeNullFresh(cacheKey: string): boolean {
  const nulledAt = tvmazeNullAt.get(cacheKey)
  if (nulledAt === undefined) return false
  if (Date.now() - nulledAt < TVMAZE_NULL_TTL_MS) return true
  tvmazeNullAt.delete(cacheKey)
  return false
}

/** Solo per i test: svuota la negative cache TVmaze. */
export function __resetTvmazeNullForTest(): void {
  tvmazeNullAt.clear()
}

/** Voto TVmaze accettato solo se numero finito in (0, 10]; altro = miss. */
function toTvmazeScore(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return n
}

export interface TvmazeLookupOptions {
  /** Tipo media del chiamante: i film sono fuori scope (nessun lookup IMDb). */
  mediaType?: "movie" | "tv" | "series" | "anime" | null
  /** ID TVDB opzionale: fallback `?thetvdb=` quando l'IMDb manca. */
  tvdbId?: number | string | null
  signal?: AbortSignal
}

/**
 * Voto medio TVmaze (0-10) per una serie, o null su miss/errore.
 * Rigorosamente fail-open: non lancia mai e non fa rete per i film.
 */
export async function fetchTvmazeRating(
  imdbId: string | null | undefined,
  options?: TvmazeLookupOptions,
): Promise<number | null> {
  const t = String(options?.mediaType ?? "").trim().toLowerCase()
  if (t === "movie") return null

  const cleanImdb = isValidImdbId(imdbId) ? imdbId.trim().toLowerCase() : null
  const tvdbRaw = options?.tvdbId === null || options?.tvdbId === undefined ? "" : String(options.tvdbId).trim()
  const cleanTvdb = /^\d{1,9}$/.test(tvdbRaw) ? tvdbRaw : null
  if (!cleanImdb && !cleanTvdb) return null

  const lookupKey = cleanImdb ? `imdb:${cleanImdb}` : `thetvdb:${cleanTvdb}`
  const cacheKey = `tvmaze:rating:${lookupKey}`
  const cached = cacheGet<number>(cacheKey)
  if (typeof cached === "number") return cached
  if (tvmazeNullFresh(cacheKey)) return null
  if (tvmazeBreaker.isOpen()) return null

  const fetchUrl = cleanImdb
    ? `${TVMAZE_BASE}/lookup/shows?imdb=${encodeURIComponent(cleanImdb)}`
    : `${TVMAZE_BASE}/lookup/shows?thetvdb=${encodeURIComponent(cleanTvdb!)}`

  try {
    const combinedSignal = combineAbortSignals(options?.signal, TVMAZE_TIMEOUT_MS)
    const res = await timedFetch(fetchUrl, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: combinedSignal,
    })

    if (res.status === 429 || res.status >= 500) {
      tvmazeBreaker.recordFailure(parseRetryAfterMs((n) => res.headers.get(n)))
      return null
    }

    // 404 = film/ID sconosciuto: miss genuino, mai un voto inventato.
    if (!res.ok) {
      tvmazeBreaker.recordSuccess()
      tvmazeNullSet(cacheKey)
      return null
    }

    tvmazeBreaker.recordSuccess()

    const data = (await res.json().catch(() => null)) as { rating?: { average?: unknown } } | null
    const score = toTvmazeScore(data?.rating?.average)
    if (score === null) {
      tvmazeNullSet(cacheKey)
      return null
    }

    // Voto giornaliero sull'upstream: 6h di cache positiva.
    cacheSet(cacheKey, score, ["ratings"], 6 * 60 * 60 * 1000)
    return score
  } catch (e) {
    if (!options?.signal?.aborted) tvmazeBreaker.recordFailure()
    log.error("TVmaze rating fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}
