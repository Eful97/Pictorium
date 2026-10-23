import crypto from "node:crypto"
import { cacheGet, cacheGetShared, cacheSet } from "./cache"
import { timedFetch } from "./outbound-stats"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { createCircuitBreaker, parseRetryAfterMs, type CircuitBreaker } from "@/lib/circuit-breaker"
import { hashMdbKeyForQuota, isMdbKeyParked, noteMdbQuotaExhausted429, noteMdbQuotaSuccess } from "@/lib/mdblist-quota"
import { combineAbortSignals, raceWithAbort } from "@/lib/abort-signal"
import { fetchSimklRating } from "./simkl"
import { getPersistedMdbRaw, setPersistedMdbRaw } from "./mdblist-raw-cache"
import { TWO_WEEKS_MS } from "./constants"
import { fetchAnimeRatings, normalizeAnimeSide } from "./anime-ratings"
import { fetchCinemetaRating } from "./cinemeta"

const log = createLogger("ratings")

// New MDBList media API base (task B): typed IMDb endpoints
// (`/imdb/{movie|show|any}/{imdbId}/?apikey=`, single point, no legacy
// fallback). The MDBLIST_API_URL override (mock/E2E) keeps working with the
// same deterministic NEW paths (mock base + suffix). Read lazily per call so
// tests can stub the env without module reloads.
function mdbApiBase(): string {
  return (process.env.MDBLIST_API_URL || "https://api.mdblist.com").replace(/\/+$/, "")
}

// Phase 2 (Provider Resilience): deadline interna 8000 → 1500ms. I caller
// fanno già race con RATING_WAIT_MS, ma il fetch restava zombie fino a 8s;
// la route tmdb-details non passa alcun signal, quindi questo è la sua unica
// guardia anti-starvation.
const MDBLIST_TIMEOUT_MS = (() => {
  const raw = envWithFallback("MDBLIST_TIMEOUT_MS")
  const n = raw ? parseInt(raw, 10) : 1500
  return Number.isFinite(n) && n >= 300 && n <= 10000 ? n : 1500
})()

// Fail-open breaker PER CREDENTIAL (not module-global): 3 consecutive
// failures → 30s cooldown for that key. A throttled or failing key
// (burst 429s, 5xx, timeouts) must not suppress the healthy keys of other
// namespaces on public/multi-user instances: each credential has its own
// counter and window. Outage safety stays per credential (same thresholds
// as before): a genuine outage still opens EVERY key's breaker after 3
// failures, so no credential hammers upstream. Absent/mock keys share the
// "none" bucket (no collision: ids are sha256 hex). Bounded map with
// oldest-first eviction: evicting a breaker is fail-open (restarts closed).
// Only sha256 digests in map/logs, never the plaintext key (same digest
// as quota parking in mdblist-quota.ts).
const mdblistBreakers = new Map<string, CircuitBreaker>()
const MDB_BREAKER_MAX_KEYS = 500
const MDB_BREAKER_KEYLESS_ID = "none"

function mdbBreakerId(key: string | undefined | null): string {
  return key ? hashMdbKeyForQuota(key) : MDB_BREAKER_KEYLESS_ID
}

function mdbBreakerFor(key: string | undefined | null): CircuitBreaker {
  const id = mdbBreakerId(key)
  let b = mdblistBreakers.get(id)
  if (!b) {
    b = createCircuitBreaker({ name: "mdblist", failureThreshold: 3, backoffMs: 30_000 })
    mdblistBreakers.set(id, b)
    while (mdblistBreakers.size > MDB_BREAKER_MAX_KEYS) {
      const oldest = mdblistBreakers.keys().next().value
      if (oldest === undefined) break
      mdblistBreakers.delete(oldest)
    }
  }
  return b
}

/** Test-only: reset MDBList breaker state (all credentials). */
export function __resetMdblistBreaker(): void {
  mdblistBreakers.clear()
}

const RATINGS_NULL_TTL_MS = 60_000
/** Explicit TTL for valid aggregated results: 6h (success only, never null/fail). */
export const RATINGS_SUCCESS_TTL_MS = 6 * 60 * 60 * 1000
const RATINGS_NULL_MAX = 500
const ratingsNullAt = new Map<string, number>()

function ratingsNullSet(cacheKey: string): void {
  if (ratingsNullAt.size >= RATINGS_NULL_MAX) ratingsNullAt.delete(ratingsNullAt.keys().next().value!)
  ratingsNullAt.set(cacheKey, Date.now())
}

/** Solo per i test: svuota la negative cache dei null. */
export function __resetRatingsNullForTest(): void {
  ratingsNullAt.clear()
}

/**
 * Read-only telemetry for the operator status surface (never admits a
 * trial): uses peekOpen, never isOpen — isOpen would admit the single
 * half-open trial to a monitoring poll that never runs it, wedging the
 * breaker (orphaned trial: every real request would then be rejected
 * forever). Without a key it reports any-open (same semantics as before);
 * with a key, that single credential's state (lookup only, never create).
 */
export function isMdblistBreakerOpen(key?: string | null): boolean {
  if (key !== undefined && key !== null) {
    return mdblistBreakers.get(mdbBreakerId(key))?.peekOpen() ?? false
  }
  for (const b of mdblistBreakers.values()) {
    if (b.peekOpen()) return true
  }
  return false
}

// SUPPORTED_RATING_SOURCES + parseRatingSources/resolveRatingSources vivono
// in rating-weights.ts (foglia client-safe senza import runtime): ratings.ts
// importa cache/KV e non può stare nel bundle browser. Ri-esportati qui per
// compatibilità (route, hardening, test esistenti importano da questo modulo).
import { DEFAULT_RATING_SOURCES, UI_RATING_SOURCES, SUPPORTED_RATING_SOURCES, parseRatingSources, resolveRatingSources } from "./rating-weights"
export { DEFAULT_RATING_SOURCES, UI_RATING_SOURCES, SUPPORTED_RATING_SOURCES, parseRatingSources, resolveRatingSources }
export type { RatingSource } from "./rating-weights"

export interface AggregatedRatings {
  sources: Record<string, number>
  average: number
  count: number
}

/**
 * Strict parse of a new-API normalized score (contract: numeric 0-100).
 * Accepts finite numbers and strictly-numeric strings (full match, no
 * parseFloat-style partials like "9abc"); rejects NaN/Infinity, out-of-range
 * (>100, negative), empties and non-numeric junk. Returns null when missing
 * or malformed (caller treats it as unavailable, never as zero).
 */
function parseStrictScore(raw: unknown): number | null {
  let n: number
  if (typeof raw === "number") {
    n = raw
  } else if (typeof raw === "string") {
    const s = raw.trim()
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null
    n = Number(s)
  } else {
    return null
  }
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return n
}

/**
 * Strict parse of a native (non-normalized) rating value: finite number or
 * strictly-numeric string, range checked by the caller (only the
 * documented/observed RogerEbert 0-4 scale uses this fallback).
 */
function parseStrictNative(raw: unknown): number | null {
  let n: number
  if (typeof raw === "number") {
    n = raw
  } else if (typeof raw === "string") {
    const s = raw.trim()
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null
    n = Number(s)
  } else {
    return null
  }
  if (!Number.isFinite(n)) return null
  return n
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

// parseRatingSources/resolveRatingSources: definiti in rating-weights.ts
// (foglia client-safe), ri-esportati sopra per compatibilità.

export function calculateAverageRating(
  ratings: AggregatedRatings | null,
  requestedSources?: string[]
): number | null {
  if (!ratings || !ratings.sources) return null
  const targetSources = requestedSources && requestedSources.length > 0
    ? requestedSources.map((s) => {
        const lower = s.toLowerCase()
        if (lower === "tomatoesaudience" || lower === "popcorn") return "popcorntime"
        if (lower === "myanimelist") return "mal"
        return lower
      })
    : DEFAULT_RATING_SOURCES

  const values: number[] = []
  for (const src of targetSources) {
    const val = ratings.sources[src]
    if (typeof val === "number" && !isNaN(val) && val > 0) {
      values.push(val)
    }
  }

  if (values.length === 0) return null
  return avg(values)
}

/** Cap display colonna rating separati: oltre, la colonna destra mangia il poster. */
export const MAX_SEPARATE_RATINGS = 5

/** Fonti mostrate in percentuale invece che in decimi (valore /10 → `88%`). */
const PERCENT_SOURCES: ReadonlySet<string> = new Set(["tomatoes", "popcorntime"])

export interface SeparateRating {
  readonly id: string
  readonly value: number
}

/**
 * Sottoinsieme ordinato delle fonti aggregate per la colonna separata:
 * ordine di selezione `requestedSources`, skip valori mancanti/0, cap
 * MAX_SEPARATE_RATINGS (=5). Ritorna [] quando niente è mostrabile (il chiamante
 * ripiega sulla media ★).
 */
export function pickSeparateRatings(
  ratings: AggregatedRatings | null,
  requestedSources?: string[],
  max: number = MAX_SEPARATE_RATINGS,
): SeparateRating[] {
  if (!ratings || !ratings.sources) return []
  const wanted = requestedSources && requestedSources.length > 0
    ? requestedSources.map((s) => s.trim().toLowerCase())
    : [...DEFAULT_RATING_SOURCES]
  const out: SeparateRating[] = []
  for (const src of wanted) {
    if (out.length >= max) break
    const v = ratings.sources[src]
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out.push({ id: src, value: v })
  }
  return out
}

/** Formato display di una fonte separata: `7.3` decimale, `88%` per la famiglia percent. */
export function formatSeparateValue(source: string, value: number): string {
  if (PERCENT_SOURCES.has(source.toLowerCase())) return `${Math.round(value * 10)}%`
  return (Math.round(value * 10) / 10).toFixed(1)
}

export interface FetchAggregatedOptions {
  simklKey?: string | null
  tmdbId?: number | string | null
  mediaType?: "movie" | "tv" | "series" | "anime" | null
  wantSimkl?: boolean
  wantAnilist?: boolean
  wantKitsu?: boolean
  /** Voto IMDb via Cinemeta quando MDBList non lo fornisce (fallback sequenziale). */
  wantImdb?: boolean
  /**
   * Selezione esplicita delle fonti richieste (rsrc risolta dai caller).
   * Guida il routing dei provider: con selezione la selezione vince sui
   * flag want* (difesa in profondità: niente upstream per fonti non
   * richieste). Assente = legacy all-source (tutti i provider condizionali
   * attivi secondo i flag). Normalizzata (sort/dedupe) per la cache key,
   * mai per l'ordine di display (quello resta al computeVote dei caller).
   */
  requestedSources?: readonly string[] | null
  /**
   * Budget complessivo (ms) per primario + fallback + side provider
   * (clamp 300–10000). Il primario ne riceve una share limitata (60%) così
   * il fallback resta genuinamente utilizzabile; il totale non supera mai
   * la deadline del chiamante. Assente = legacy (solo timeout interni).
   */
  ratingWaitMs?: number | null
  /**
   * Voto TMDB diretto genuino (details.vote_average) applicato come overlay
   * request-specific su `sources.tmdb`: prevale sempre sul TMDB di MDBList
   * sia sui risultati freschi sia sulle cache hit, e colma il valore quando
   * MDBList non lo fornisce (quota/outage). La base cachata resta sempre
   * senza diretto, l'overlay si applica su copia alla restituzione e il voto
   * diretto non entra mai nel cache key né nella cache success (congelarlo
   * maschererebbe il recovery del provider). Vale solo dove tmdb è
   * richiesto (legacy) o esplicito in selezione. Solo voto TMDB genuino —
   * mai medie congelate da mapping/query.
   */
  tmdbFallbackVote?: number | null
}

interface MdbListFetchResult {
  sources: Record<string, number> | null
  isGenuineMiss: boolean
  /**
   * TTL scelto per la cache grezza da questa risposta (24h default, 7d solo
   * per film vecchi con data+tipo affidabili). Usato solo sulle scritture
   * success: miss/errori/abort non scrivono mai.
   */
  rawTtlMs: number
  /**
   * Task C — controparti osservate nel corpo risposta (solo evidenza per
   * l'alias-dedup, MAI routing): scritte solo sui 200 con JSON parsato,
   * altrimenti undefined. Mai usate per mutare l'identità in-flight.
   */
  observedImdb?: string | null
  observedTmdb?: number | null
  /**
   * Task C correction-2 — true when this result was hydrated from a cache
   * (L1 hit, KV L2, local disk) rather than a fresh upstream fetch. A
   * hydrated `rawTtlMs` is only the policy default (24h), never the
   * remaining lifetime of the absolute expiry, so joiner alias publishes
   * must be skipped for hydrated results (serve without new writes).
   */
  hydrated?: boolean
}

// Fonti servite SOLO dai direct provider condizionali (Simkl diretto,
// AniList/Kitsu diretti): da sole non sono mai un motivo per chiamare
// MDBList. MAL resta coperta dall'aggregatore MDBList (vedi sotto).
const DIRECT_ONLY_SOURCES: ReadonlySet<string> = new Set(["simkl", "anilist", "kitsu"])

// Fonti che MDBList può fornire (imdb anche via Cinemeta, tmdb anche diretto).
// Partizionano la whitelist con DIRECT_ONLY_SOURCES: tutto ciò che non è
// direct-only (inclusa MAL) può richiedere l'aggregatore MDBList.

// Versione del namespace cache rating: v3 = nuova media API tipizzata
// (api.mdblist.com) + segmentazione per tipo media e policy min-votes. Le
// entry pre-migrazione (v2, legacy `mdblist.com/api`) non devono mai
// influenzare la nuova normalizzazione né la nuova precedenza.
const RATINGS_CACHE_VERSION = "v3"

export type MdbMediaSegment = "movie" | "show" | "any"

/**
 * Caller media type → segmento path della nuova API: tv/series/show
 * collassano su `show`, solo un movie esplicito resta `movie`; tutto il
 * resto (anime, assente, sconosciuto) usa `any` documentato — mai retry
 * automatico su tipo sbagliato (il 404 resta un miss genuino).
 */
export function mdbMediaSegment(mediaType: unknown): MdbMediaSegment {
  const t = String(mediaType ?? "").trim().toLowerCase()
  if (t === "movie") return "movie"
  if (t === "tv" || t === "series" || t === "show") return "show"
  return "any"
}

/**
 * Task C — copertura voti via identificativo TMDB quando l'IMDb manca.
 *
 * Precedenza invariata: l'IMDb resta l'unica identità MDBList quando presente
 * (nessun cambio d'ordine, nessuna seconda chiamata sul 404). Solo senza un
 * IMDb utilizzabile — e solo con TMDB id numerico affidabile + tipo
 * esplicitamente normalizzabile (movie → movie, tv/series/show → show) — si
 * tenta UNA chiamata all'endpoint tipizzato TMDB. Tutto il resto (tipo
 * mancante/ambiguo come anime/any/assente, id non intero-positivo, IMDb
 * bare-numeric) salta MDBList del tutto: fallback diretti disponibili o null,
 * mai una chiamata. Mai bare-numeric come IMDb, mai tt fabbricati, mai tmdb
 * passato come IMDb ai direct provider/Cinemeta.
 *
 * Verificato live 2026-10-15 (sei campioni autorizzati, valori anonimi, no
 * chiavi): /imdb/movie/tt0111161 ≡ /tmdb/movie/278 e /imdb/show/tt0944947 ≡
 * /tmdb/show/1399 (stessi corpi); tipo-sbagliato 404 ≡ ignoto (no retry).
 */

/** IMDb utilizzabile: stringa `tt…` non vuota, senza spazi né query/fragment junk. I bare-numeric ("278") sono id TMDB, mai IMDb. */
export function isValidImdbId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 2 &&
    value.toLowerCase().startsWith("tt") &&
    !/^\d+$/.test(value) &&
    !/[\s?#\/\\&]/.test(value)
  )
}

/** TMDB id rigoroso: intero positivo safe (numero o stringa tutta-cifre); altrimenti null. */
export function parseTmdbId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value === "string") {
    const s = value.trim()
    if (!/^\d+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }
  return null
}

/**
 * Tipo caller esplicito → segmento path TMDB; anime/assente/sconosciuto →
 * null (ambiguo: nessuna chiamata MDBList via TMDB, solo fallback diretti).
 */
export function mdbTmdbSegment(mediaType: unknown): "movie" | "show" | null {
  const t = String(mediaType ?? "").trim().toLowerCase()
  if (t === "movie") return "movie"
  if (t === "tv" || t === "series" || t === "show") return "show"
  return null
}

/**
 * Single-point URL della nuova API TMDB: `/tmdb/{movie|show}/{id}/?apikey=`
 * (query key solo quando esiste una chiave; keyless solo su override mock).
 * Nessun fallback legacy, nessun retry sull'altro tipo.
 */
export function buildMdbTmdbRatingsUrl(tmdbId: number, key: string | undefined, seg: "movie" | "show"): string {
  const path = `/tmdb/${seg}/${encodeURIComponent(String(tmdbId))}/`
  return key ? `${mdbApiBase()}${path}?apikey=${encodeURIComponent(key)}` : `${mdbApiBase()}${path}`
}

/** Gate caller-side: TMDB id affidabile + tipo esplicitamente normalizzabile (guard dei caller route/poster). */
export function isMdbTmdbIdentityUsable(tmdbId: unknown, mediaType: unknown): boolean {
  return parseTmdbId(tmdbId) !== null && mdbTmdbSegment(mediaType) !== null
}

/**
 * Single-point URL della nuova API: `/imdb/{seg}/{imdbId}/?apikey=` (query
 * key solo quando esiste una chiave; keyless solo su override mock). Nessun
 * fallback legacy, nessun append, nessun poll.
 */
export function buildMdbRatingsUrl(imdbId: string, key: string | undefined, seg: MdbMediaSegment): string {
  const path = `/imdb/${seg}/${encodeURIComponent(imdbId)}/`
  return key ? `${mdbApiBase()}${path}?apikey=${encodeURIComponent(key)}` : `${mdbApiBase()}${path}`
}

/**
 * Policy per-source minimum-votes: `PICTORIUM_RATING_MIN_VOTES` (fallback
 * legacy `POSTERIUM_*` via envWithFallback), default 10, 0 = disabilitato.
 * Tutto ciò che non è un intero non-negativo sano torna al default. Lettura
 * lazy per chiamata (test stubbano la env senza reload del modulo).
 */
export const RATING_MIN_VOTES_DEFAULT = 10
export function resolveRatingMinVotes(rawEnv?: string): number {
  const raw = rawEnv ?? envWithFallback("RATING_MIN_VOTES")
  if (raw === undefined) return RATING_MIN_VOTES_DEFAULT
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return RATING_MIN_VOTES_DEFAULT
  const n = Number(s)
  if (!Number.isSafeInteger(n) || n < 0) return RATING_MIN_VOTES_DEFAULT
  return n
}

// Share del budget complessivo riservata al primario: il fallback riceve il
// resto e resta genuinamente utilizzabile.
const PRIMARY_BUDGET_SHARE = 0.6

function normalizeRequestedSources(raw: readonly string[] | null | undefined): string[] | null {
  if (!raw) return null
  const seen = new Set<string>()
  for (const s of raw) {
    const t = String(s ?? "").trim().toLowerCase()
    if (t) seen.add(t)
  }
  return seen.size > 0 ? [...seen] : null
}

function clampOverallBudget(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null
  return Math.min(Math.max(Math.floor(raw), 300), 10000)
}

function isGenuineDirectVote(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

function roundVote(v: number): number {
  return Math.round(Math.min(v, 10) * 10) / 10
}

// Media aritmetica storica: imdb+tmdb quando presenti, altrimenti tutte le
// fonti disponibili. Unico comportamento (vedi rating-weights.ts).
function averageFor(sources: Record<string, number>): number {
  const defaults: number[] = []
  if (typeof sources.imdb === "number") defaults.push(sources.imdb)
  if (typeof sources.tmdb === "number") defaults.push(sources.tmdb)
  return avg(defaults.length > 0 ? defaults : Object.values(sources))
}

/**
 * Overlay del voto TMDB diretto genuino (mai aggregate salvate/query):
 * vince su MDBList ANCHE sulle cache hit. Non muta mai l'oggetto cachato
 * condiviso: ritorna la base invariata quando non c'è niente da applicare,
 * una copia altrimenti.
 */
function withDirectTmdbOverlay(base: AggregatedRatings, vote: number | null): AggregatedRatings {
  if (vote === null || base.sources.tmdb === roundVote(vote)) return base
  const sources = { ...base.sources, tmdb: roundVote(vote) }
  return { sources, average: averageFor(sources), count: Object.keys(sources).length }
}

/**
 * Signal di fase: scatta al primo tra abort del chiamante e budget di fase.
 * Timer e listener sempre puliti all'uscita (niente leak, niente zombie).
 */
function phaseSignal(
  parent: AbortSignal | undefined | null,
  ms: number | undefined,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (ms === undefined) return { signal: parent ?? undefined, cleanup: () => undefined }
  const ctrl = new AbortController()
  const timer = setTimeout(() => {
    try {
      ctrl.abort(new DOMException("Aborted", "AbortError"))
    } catch { /* noop */ }
  }, Math.max(1, Math.floor(ms)))
  let onAbort: (() => void) | undefined
  if (parent) {
    if (parent.aborted) {
      clearTimeout(timer)
      try {
        ctrl.abort((parent as unknown as { reason?: unknown }).reason)
      } catch { /* noop */ }
    } else {
      onAbort = () => {
        clearTimeout(timer)
        try {
          ctrl.abort((parent as unknown as { reason?: unknown }).reason)
        } catch { /* noop */ }
      }
      parent.addEventListener("abort", onAbort, { once: true })
    }
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer)
      if (onAbort && parent) parent.removeEventListener("abort", onAbort)
    },
  }
}

// Join di un side provider col residuo di budget: oltre il budget vale come
// transient (null), mai oltre la deadline del chiamante. Timer sempre pulito;
// il fetch orfano viene abortito dal signal upstream (finally del chiamante).
async function joinSide<T>(promise: Promise<T> | null, ms: number | undefined, fallback: T): Promise<T> {
  if (!promise) return fallback
  if (ms === undefined) {
    try {
      return await promise
    } catch {
      return fallback
    }
  }
  if (ms <= 0) return fallback
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new DOMException("Aborted", "AbortError")), Math.max(1, Math.floor(ms)))
      }),
    ])
  } catch {
    return fallback
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Task C — controparti osservate nel corpo risposta MDBList (solo campi id
 * espliciti `*_id`, mai bare `imdb`/`tmdb` che possono essere altro): evidenza
 * per l'alias-dedup della cache grezza, mai per il routing né per mutare
 * l'identità in-flight.
 */
function observeMdbCounterparts(data: unknown): { imdb: string | null; tmdb: number | null } {
  if (typeof data !== "object" || data === null) return { imdb: null, tmdb: null }
  const rec = data as Record<string, unknown>
  const imdbRaw = rec.imdb_id ?? rec.imdbid ?? rec.imdbId
  const tmdbRaw = rec.tmdb_id ?? rec.tmdbid ?? rec.tmdbId
  return {
    imdb: isValidImdbId(imdbRaw) ? (imdbRaw as string) : null,
    tmdb: parseTmdbId(tmdbRaw),
  }
}

async function fetchMdbListSourcesUpstream(
  url: string,
  key?: string,
  signal?: AbortSignal,
): Promise<MdbListFetchResult> {
  if (mdbBreakerFor(key).isOpen()) return { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }

  try {
    const timeoutSignal = AbortSignal.timeout(MDBLIST_TIMEOUT_MS)
    let combined: AbortSignal = timeoutSignal
    if (signal) {
      if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
        combined = (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
      } else {
        const ctrl = new AbortController()
        const onAbort = () => ctrl.abort((signal as unknown as { reason?: unknown })?.reason ?? timeoutSignal.reason)
        if (signal.aborted || timeoutSignal.aborted) ctrl.abort()
        else {
          signal.addEventListener("abort", onAbort, { once: true })
          timeoutSignal.addEventListener("abort", onAbort, { once: true })
        }
        combined = ctrl.signal
      }
    }
    const res = await timedFetch(
      url,
      { signal: combined }
    )
    // Mock-server runs (MDBLIST_API_URL set) stay isolated from quota state:
    // no parking is read or recorded there, keeping E2E deterministic.
    const quotaIsolated = !!process.env.MDBLIST_API_URL
    const quotaHeaders = { get: (n: string) => res.headers.get(n) }
    if (res.status === 429) {
      // Daily quota exhaustion (remaining 0 + trustworthy future reset) parks
      // ONLY this key until reset: no global breaker trip (healthy other-key
      // traffic must keep flowing) and no genuine-miss flag (the title exists,
      // the key is just spent). Any other 429 is burst throttling → existing
      // transient handling with Retry-After backoff.
      if (!quotaIsolated && key && noteMdbQuotaExhausted429(quotaHeaders, key)) {
        return { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }
      }
      mdbBreakerFor(key).recordFailure(parseRetryAfterMs((n) => res.headers.get(n)))
      return { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }
    }
    if (res.status >= 500) {
      mdbBreakerFor(key).recordFailure(parseRetryAfterMs((n) => res.headers.get(n)))
      return { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }
    }
    if (res.status === 401 || res.status === 403) {
      // Auth failure (bad/revoked key): transient, never a title miss and
      // never a breaker trip — the title may exist, the credential does not.
      return { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }
    }
    if (!res.ok) {
      return { sources: null, isGenuineMiss: true, rawTtlMs: MDB_RAW_TTL_MS }
    }
    // Last-token success (remaining 0) still returns its data: parking only
    // affects FUTURE keyed calls, decided after the cache layers below.
    if (!quotaIsolated && key) noteMdbQuotaSuccess(quotaHeaders, key)
    mdbBreakerFor(key).recordSuccess()
    const raw = await res.json()
    const data = raw?.data ?? raw

    const ratings = data?.ratings
    const sources: Record<string, number> = {}
    const minVotes = resolveRatingMinVotes()

    // Root mdblist score: 0-100 on the new API, always /10. Strict:
    // only finite numbers (or strictly-numeric strings) in 0-100 count;
    // Infinity/>100/junk partials are unavailable, never normalized.
    const rootScore = parseStrictScore(data?.score)
    if (rootScore !== null && rootScore > 0) {
      sources.mdblist = Math.round((rootScore / 10) * 10) / 10
    }

    if (Array.isArray(ratings) && ratings.length > 0) {
      const ALL_SOURCES = new Set<string>(SUPPORTED_RATING_SOURCES)

      for (const item of ratings) {
        let src = (item?.source || item?.name || item?.provider || "").toLowerCase().replace(/[-_]/g, "")
        if (src === "myanimelist") src = "mal"
        if (src === "popcorn" || src === "rtaudience" || src === "audience" || src === "tomatoesaudience") src = "popcorntime"
        if (!ALL_SOURCES.has(src)) continue

        // Per-source minimum votes (field `votes` only, no aliases): ONLY a
        // known finite NON-NEGATIVE INTEGER count below the threshold filters
        // the source out. Negative/fractional/NaN/Infinity/non-numeric counts
        // are malformed → kept as unknown (never invent a count); null/missing
        // likewise kept. RogerEbert is exempt (votes structurally null there).
        if (src !== "rogerebert" && minVotes > 0) {
          const vt: unknown = (item as { votes?: unknown })?.votes
          if (typeof vt === "number" && Number.isInteger(vt) && vt >= 0 && vt < minVotes) continue
        }

        // New-API contract: `score` is the numeric 0-100 normalized value for
        // EVERY source — always /10, never the legacy >10 heuristic. Only a
        // strict finite 0-100 score normalizes (Infinity/>100/junk partial
        // strings are unavailable, never rendered). When score is null/missing
        // the source is unavailable — EXCEPT the documented/observed
        // RogerEbert native 0-4 scale (verified live sample value 3.5 with
        // null score): native*2.5 there only. No generic toTen/value heuristic
        // for other sources (a missing-score trakt value in 100-scale must
        // never be reinterpreted as x/10).
        let normalized: number | null = null
        const scoreNum = parseStrictScore(item?.score)
        if (scoreNum !== null && scoreNum > 0) {
          // New-API score is ALWAYS 0-100 (even below 10): unconditional /10,
          // never the legacy >10 heuristic.
          normalized = scoreNum / 10
        } else if (src === "rogerebert") {
          const native = parseStrictNative(item?.value ?? item?.rating)
          if (native !== null && native > 0 && native <= 4) {
            normalized = native * 2.5
          }
        }

        if (normalized !== null && !isNaN(normalized) && normalized > 0 && !sources[src]) {
          sources[src] = Math.round(normalized * 10) / 10
        }
      }
    }

    const hasSources = Object.keys(sources).length > 0
    const observed = observeMdbCounterparts(data)
    return { sources: hasSources ? sources : null, isGenuineMiss: !hasSources, rawTtlMs: mdbRawTtlForData(data), observedImdb: observed.imdb, observedTmdb: observed.tmdb }
  } catch (e) {
    if (!signal?.aborted) mdbBreakerFor(key).recordFailure()
    log.error("MDBList fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }
  }
}

// ---------------------------------------------------------------------------
// MDBList request reduction: raw provider cache + inflight dedup.
//
// La risposta grezza MDBList dipende SOLO da (identità, chiave API): la
// selezione badge (rsrc) filtra a valle, mai sull'upstream. L'identità è la
// stringa IMDb (`tt…`) oppure `tmdb{numerico}` per il path TMDB (task C): i
// due namespace non collidono mai (`tt…` vs `tmdb…`) e il segmento tipo
// (movie/show/any) resta parte della chiave (film278 ≠ show278). La cache
// grezza riusa quindi una sola risposta di successo tra selezioni diverse
// dello stesso imdb/key; la cache aggregata per-selezione resta invariata
// sopra (6h). La grezza vive più a lungo: 24h di default, 7d solo per film
// vecchi con data di uscita + tipo affidabili dalla stessa risposta (mai
// richieste extra, mai TMDB solo per il TTL). Solo successi (sources
// non-vuoto); errori/abort/miss genuini non entrano mai qui (i miss genuini
// restano nella negative cache per-selezione) e quindi non raggiungono mai
// la KV.
// Alias-dedup (task C): quando il caller conosce GIÀ una coppia IMDb+TMDB
// (stessa chiamata: imdbId + tmdbId con tipo esplicito) oppure il corpo
// risposta osserva la controparte, il successo scrive ANCHE la entry grezza
// della controparte (stesse sources, stesso TTL, nessuna fetch extra).
// Coppia nota SIMULTANEA: la entry owned è pre-registrata sotto entrambe le
// chiavi (primaria + controparte caller-known, ≤2 chiavi bounded, rimosse al
// settle) e il join vale in entrambi gli ordini di arrivo — una sola fetch,
// trasporto del primo arrivato (IMDb-first quando il primo ha l'IMDb, TMDB
// quando solo il primo ha TMDB), stessa identità owned immutabile, abort di
// un subscriber non interrompe l'altro. Il joiner via controparte pubblica
// la propria chiave dopo il successo condiviso solo a evidenza unanime E solo
// su successo upstream fresco (correction-2: un risultato idratato dalla
// cache — KV/disco/L1 vicino alla scadenza — serve il joiner senza nuove
// scritture alias, mai con un TTL fresco che rinnovrebbe la scadenza
// assoluta originale); se
// la risposta condivisa smentisce la sua pretesa non consuma né pubblica
// nulla e rifetcha sotto la propria identità (coppie in conflitto: due fetch,
// nessun alias maligno in nessuna cache).
// Evidenza unanime o niente: se caller e risposta osservata si contraddicono,
// le entry restano intenzionalmente separate (mai coalescing maligno, mai
// mutazione dell'identità in-flight sulla base della risposta, mai mappa
// alias illimitata, mai richieste di risoluzione id). Coppie ignote restano
// entry separate documentate. Riuso sequenziale (correction-2): una entry
// TMDB-only cachata in precedenza (senza IMDb osservato, quindi senza alias)
// serve poi una coppia caller-known IMDb+TMDB senza nuova fetch e SENZA
// copia sulla chiave primaria (nessun rinnovo della scadenza assoluta).
// Persistenza al restart: la cacheSet grezza scrive già in KV L2 con
// envelope timestamp+TTL assoluti (stessa integrazione esistente degli altri
// namespace); la lettura idrata da KV su miss L1 conservando la scadenza
// originale (mai sliding). In file-mode (VPS senza KV) la stessa semantica
// vive su disco via lib/mdblist-raw-cache.ts (un JSON per identità sotto
// DATA_DIR/mdblist-raw, TTL assoluto conservato, solo successi, fail-open):
// idratazione posseduta dentro l'operazione condivisa, write fire-and-forget.
// Isolamento identità+hash-chiave (`tt…` o `tmdb…`), mai plaintext.
// ---------------------------------------------------------------------------

/** Freschezza di default della cache grezza MDBList: 24h. */
export const MDB_RAW_TTL_MS = 24 * 60 * 60 * 1000
/** Film vecchi (data+tipo affidabili, uscita oltre la finestra recente): 7d. */
export const MDB_RAW_OLD_MOVIE_TTL_MS = 7 * 24 * 60 * 60 * 1000

function mdbResponseYear(rec: Record<string, unknown>): number | null {
  // Conservative explicit field: only `year` (number or "YYYY"). Aliases such
  // as release_year/releaseYear are not documented for the detail endpoint.
  const v = rec.year
  const n = typeof v === "number"
    ? v
    : typeof v === "string" && /^\d{4}$/.test(v.trim()) ? parseInt(v.trim(), 10) : NaN
  if (Number.isFinite(n) && n >= 1800 && n <= 2100) return n
  return null
}

/**
 * Strict parse of a `released` value: Date.parse normalizes impossible ISO
 * calendar dates (e.g. 2020-02-30 becomes Mar 1) instead of returning NaN,
 * which would wrongly grant the 7d TTL. When an ISO date prefix is present
 * its components must form a real calendar date, otherwise NaN (→ 24h).
 * Non-ISO strings fall back to Date.parse as-is.
 */
function parseMdbReleasedMs(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN
    const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate()
    if (d > dim) return NaN
  }
  return Date.parse(value)
}

/**
 * Anno che dimostra da solo un'età oltre la finestra recente: l'uscita può
 * essere tarda fino al 31 dicembre dell'anno, quindi l'anno prova >14 giorni
 * solo dall'anno successivo in poi con margine (15 gennaio in UTC, stessa
 * convenzione pass-only dei badge novità ma dal lato prudente).
 */
function isReliablyOldYear(year: number, nowMs: number): boolean {
  const nowYear = new Date(nowMs).getUTCFullYear()
  if (nowYear > year + 1) return true
  // A year-only value may mean as late as Dec 31 23:59 of that year, so the
  // previous year proves >14 full days only strictly AFTER Jan 15 00:00 UTC
  // (Jan 15 midnight exactly is not enough).
  if (nowYear === year + 1) return nowMs > Date.UTC(nowYear, 0, 15)
  return false
}

/**
 * TTL grezzo per una risposta MDBList già scaricata (shape `data`, dopo
 * l'unwrap `raw?.data ?? raw` dell'upstream): 7d SOLO per film con tipo
 * affidabile "movie" e uscita affidabile oltre la finestra recente
 * (TWO_WEEKS_MS, stessa dei badge novità); 24h in ogni altro caso — serie
 * (anche concluse), tipo mancante/sconosciuto, data mancante/futura/non
 * parsabile. Pura e senza rete: i metadati temporali vengono dalla risposta
 * esistente, mai da fetch extra. Le serie restano sempre a 24h (niente 7d).
 */
export function mdbRawTtlForData(data: unknown, nowMs: number = Date.now()): number {
  if (typeof data !== "object" || data === null) return MDB_RAW_TTL_MS
  const rec = data as Record<string, unknown>
  // Flag show esplicito contraddetto dal tipo: prudente, mai vecchio.
  if (rec.show === true) return MDB_RAW_TTL_MS
  // Conservative explicit fields only: no checked-in fixture documents
  // aliases for the detail endpoint, so only `type` (exactly "movie",
  // case-insensitive — never film/films/movies/...) counts. Unknown type
  // keys (mediatype/media_type/kind) never grant the old-movie TTL.
  const rawType = rec.type
  if (typeof rawType !== "string" || rawType.trim().toLowerCase() !== "movie") return MDB_RAW_TTL_MS
  const releasedRaw = rec.released
  const released = typeof releasedRaw === "string" && releasedRaw.trim() ? releasedRaw.trim() : null
  if (released !== null) {
    // Data anno-solo ("1994"): tratta come anno, non come 1° gennaio.
    const yearOnly = /^\d{4}$/.test(released) ? parseInt(released, 10) : NaN
    if (Number.isFinite(yearOnly)) {
      return isReliablyOldYear(yearOnly, nowMs) ? MDB_RAW_OLD_MOVIE_TTL_MS : MDB_RAW_TTL_MS
    }
    const ms = parseMdbReleasedMs(released)
    if (!Number.isFinite(ms)) return MDB_RAW_TTL_MS
    return ms <= nowMs - TWO_WEEKS_MS ? MDB_RAW_OLD_MOVIE_TTL_MS : MDB_RAW_TTL_MS
  }
  const y = mdbResponseYear(rec)
  if (y === null) return MDB_RAW_TTL_MS
  return isReliablyOldYear(y, nowMs) ? MDB_RAW_OLD_MOVIE_TTL_MS : MDB_RAW_TTL_MS
}

/**
 * Chiave grezza per identità MDBList: `identity` è la stringa IMDb (`tt…`)
 * oppure `tmdb{numerico}` per il path TMDB (mai bare-numeric: `tt…` vs
 * `tmdb…` non collidono mai; il segmento tipo isola film278 da show278).
 */
function mdbRawCacheKey(identity: string, key: string | undefined, seg: MdbMediaSegment, minVotes: number): string {
  const keyHash = key ? crypto.createHash("sha1").update(key).digest("hex").slice(0, 8) : "nomk"
  return `mdb:raw:${RATINGS_CACHE_VERSION}:${seg}:${identity}:${keyHash}:mv${minVotes}`
}

interface MdbRawInflight {
  promise: Promise<MdbListFetchResult>
  controller: AbortController
  subscribers: number
  settled: boolean
  /** Chiavi che puntano a questa entry: primaria + eventuale controparte
   * caller-known (coppia IMDb+TMDB già nota). Sempre bounded (≤2). */
  keys: string[]
}

const mdbRawInflight = new Map<string, MdbRawInflight>()

/** Rimuove una entry da TUTTE le sue chiavi (solo dove punta ancora lei). */
function unregisterMdbRawInflight(entry: MdbRawInflight): void {
  for (const k of entry.keys) {
    if (mdbRawInflight.get(k) === entry) mdbRawInflight.delete(k)
  }
}

/** Solo per i test: abortisce e svuota le inflight grezze MDBList. */
export function __resetMdbRawForTest(): void {
  for (const entry of mdbRawInflight.values()) {
    try {
      entry.controller.abort(new DOMException("Aborted", "AbortError"))
    } catch { /* noop */ }
  }
  mdbRawInflight.clear()
}

function transientMdbResult(): MdbListFetchResult {
  return { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }
}

/**
 * Task C — chiavi grezze alias per una coppia IMDb+TMDB affidabile. Ritorna al
 * massimo la chiave della controparte (mai la primaria stessa). Regole:
 * - primaria IMDb: alias `tmdb{n}` sotto tmdbSeg (richiede tipo esplicito);
 *   candidati il tmdb del caller e/o quello osservato nella risposta; se
 *   entrambi presenti ma diversi → conflitto → nessun alias;
 * - primaria TMDB (gira solo senza IMDb): alias IMDb sotto mdbSeg dal solo id
 *   osservato nella risposta.
 * Entrambi i lati sono già validati (mai bare-numeric, mai tt fabbricati).
 */
function mdbAliasRawKeys(
  primary: "imdb" | "tmdb",
  lookup: { imdbId: string | null; tmdbId: number | null },
  mdbSeg: MdbMediaSegment,
  tmdbSeg: "movie" | "show" | null,
  minVotes: number,
  key: string | undefined,
  result: MdbListFetchResult,
  rawKey: string,
): string[] {
  if (primary === "imdb") {
    if (tmdbSeg === null) return []
    const callerTmdb = lookup.tmdbId
    const observedTmdb = result.observedTmdb ?? null
    if (callerTmdb !== null && observedTmdb !== null && callerTmdb !== observedTmdb) return []
    const aliasTmdb = callerTmdb ?? observedTmdb
    if (aliasTmdb === null) return []
    const aliasKey = mdbRawCacheKey(`tmdb${aliasTmdb}`, key, tmdbSeg, minVotes)
    return aliasKey === rawKey ? [] : [aliasKey]
  }
  const observedImdb = result.observedImdb ?? null
  if (observedImdb === null) return []
  const aliasKey = mdbRawCacheKey(observedImdb, key, mdbSeg, minVotes)
  return aliasKey === rawKey ? [] : [aliasKey]
}

/**
 * Ingresso unico all'upstream MDBList: cache grezza per identità
 * (imdbId o `tmdb{id}`+key hash, vedi mdbRawCacheKey) + coalescing delle fetch
 * concorrenti sulla stessa identità. Task C: l'IMDb vince quando presente
 * (stesso path/chiavi/ordine di prima); senza IMDb ma con TMDB id + tipo
 * esplicito si usa il path tipizzato TMDB; senza nessuna identità utilizzabile
 * si ritorna transient senza toccare la rete. L'upstream gira sul signal
 * POSSEDUTO dall'inflight (mai sul signal del chiamante): l'abort/timeout di
 * un subscriber interrompe solo la sua attesa (raceWithAbort), mai il lavoro
 * altrui. L'owned controller è abortito solo quando resta senza subscriber
 * oppure alla scadenza del timeout interno (fetchMdbListSourcesUpstream ha già
 * MDBLIST_TIMEOUT_MS), quindi niente leak oltre il timeout. Errori/abort non
 * sono mai cachati.
 */
async function fetchMdbListSources(
  lookup: { imdbId: string | null; tmdbId: number | null },
  key: string | undefined,
  signal?: AbortSignal,
  mediaType?: string | null,
): Promise<MdbListFetchResult> {
  const mdbSeg = mdbMediaSegment(mediaType)
  const tmdbSeg = mdbTmdbSegment(mediaType)
  const minVotes = resolveRatingMinVotes()
  // Primaria: IMDb quando presente (nessun cambio d'ordine, nessun secondo
  // tentativo sul 404); altrimenti il path TMDB solo con tipo esplicito.
  const useImdb = lookup.imdbId !== null
  const useTmdb = !useImdb && lookup.tmdbId !== null && tmdbSeg !== null
  if (!useImdb && !useTmdb) return transientMdbResult()
  const seg: MdbMediaSegment = useImdb ? mdbSeg : (tmdbSeg as MdbMediaSegment)
  const identity = useImdb ? (lookup.imdbId as string) : `tmdb${lookup.tmdbId as number}`
  const upstreamUrl = useImdb
    ? buildMdbRatingsUrl(lookup.imdbId as string, key, mdbSeg)
    : buildMdbTmdbRatingsUrl(lookup.tmdbId as number, key, tmdbSeg as "movie" | "show")
  const rawKey = mdbRawCacheKey(identity, key, seg, minVotes)
  // Keyless against the real base is futile (the new API requires
  // authentication): skip upstream, keep Cinemeta/native fallbacks. Mock
  // runs (MDBLIST_API_URL set) stay deterministic and are still served.
  if (!key && !process.env.MDBLIST_API_URL) return transientMdbResult()
  const hit = cacheGet<Record<string, number>>(rawKey)
  if (hit) return { sources: { ...hit }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true }
  if (signal?.aborted) return transientMdbResult()

  // Controparte caller-known (coppia IMDb+TMDB GIÀ nota al caller, nessuna
  // risoluzione/alias verificato, nessuna rete): stessa key/policy/seg-tipo
  // tipizzato della controparte TMDB-only. Solo primaria IMDb con tmdb
  // affidabile + tipo esplicito; mai per lookup TMDB-only (nessuna pretesa
  // sulla controparte IMDb da verificare). Coppie ignote: nessuna chiave.
  const callerCounterpartKey =
    useImdb && lookup.tmdbId !== null && tmdbSeg !== null
      ? mdbRawCacheKey(`tmdb${lookup.tmdbId}`, key, tmdbSeg, minVotes)
      : null
  const counterpartKey =
    callerCounterpartKey !== null && callerCounterpartKey !== rawKey ? callerCounterpartKey : null

  // Task C correction-2 — sequential counterpart reuse without renewal: a
  // TMDB-only entry cached earlier (no observed IMDb, hence no alias) still
  // serves a later caller-known IMDb+TMDB pair with zero fresh network.
  // Served WITHOUT copying: no cacheSet on the primary key and no disk
  // write, so the original absolute expiry is never renewed (no sliding).
  // Bounded to the caller-known typed counterpart (same key/policy/type
  // isolation as the simultaneous pre-registration below).
  if (counterpartKey !== null) {
    const counterpartHit = cacheGet<Record<string, number>>(counterpartKey)
    if (counterpartHit) {
      return { sources: { ...counterpartHit }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true }
    }
  }

  const releaseSubscriber = (entry: MdbRawInflight, owned: AbortController): void => {
    entry.subscribers -= 1
    if (entry.subscribers <= 0 && !entry.settled) {
      try {
        owned.abort(new DOMException("Aborted", "AbortError"))
      } catch { /* noop */ }
      // Rimuove subito la entry abbandonata da TUTTE le sue chiavi
      // (identity-safe): un retry che arriva prima che l'upstream abortito
      // si sistemi deve creare una fetch fresca, mai accodarsi a una entry
      // condannata.
      unregisterMdbRawInflight(entry)
    }
  }

  // Join coalescente: stessa chiave primaria oppure controparte caller-known
  // (coppia nota simultanea, in entrambi gli ordini di arrivo). Il trasporto
  // resta quello del PRIMO arrivato (IMDb-first quando il primo ha l'IMDb,
  // TMDB quando solo il primo ha TMDB): nessuna seconda fetch, nessuna
  // mutazione dell'identità owned.
  const direct = mdbRawInflight.get(rawKey)
  const existing = direct ?? (counterpartKey !== null ? mdbRawInflight.get(counterpartKey) : undefined)
  if (existing) {
    // Mai accodarsi a una entry il cui owned è già abortito: l'upstream
    // orfano può restare pendente (es. parsing body dopo l'abort) finché non
    // si sistema, ma il retry deve partire fresco.
    if (existing.controller.signal.aborted) {
      unregisterMdbRawInflight(existing)
    } else {
      // Join via controparte (entry owned altrui, la cui chiave primaria è
      // diversa dalla mia: pre-registrazione alias o controparte caller-known).
      // A evidenza unanime il joiner con coppia nota pubblica la propria
      // chiave dopo il successo condiviso (vedi sotto); se la risposta
      // condivisa SMENTISCE la pretesa del joiner (osservato vs caller in
      // conflitto) il joiner non consuma né pubblica nulla e rifetcha sotto
      // la propria identità (mai alias maligno, mai avvelenamento
      // dell'aggregata altrui).
      const joinedViaCounterpart = existing.keys[0] !== rawKey
      existing.subscribers += 1
      let shared: MdbListFetchResult | null = null
      try {
        shared = await raceWithAbort(existing.promise, signal)
      } catch {
        shared = null
      }
      // Release prima di ogni eventuale create proprio (la entry condivisa è
      // settled a questo punto: nessun abort/unregister collaterale).
      releaseSubscriber(existing, existing.controller)
      if (shared !== null) {
        let conflicts = false
        if (joinedViaCounterpart) {
          const obsTmdb = shared.observedTmdb ?? null
          const obsImdb = shared.observedImdb ?? null
          conflicts =
            (obsTmdb !== null && lookup.tmdbId !== null && obsTmdb !== lookup.tmdbId) ||
            (obsImdb !== null && lookup.imdbId !== null && obsImdb !== lookup.imdbId)
          if (!conflicts && shared.sources && lookup.imdbId !== null && !shared.hydrated) {
            cacheSet(rawKey, { ...shared.sources }, ["mdb"], shared.rawTtlMs)
            void setPersistedMdbRaw(rawKey, shared.sources, shared.rawTtlMs).catch(() => {})
          }
        }
        if (!conflicts) return shared
        // Conflitto: cade sotto alla creazione di una entry propria (stesso
        // flusso del retry post-abort: nessuna attesa sulla entry smentita,
        // la cui unregister è già avvenuta al settle).
      } else {
        return transientMdbResult()
      }
    }
  }

  const controller = new AbortController()
  let resolveShared!: (value: MdbListFetchResult) => void
  const shared = new Promise<MdbListFetchResult>((resolve) => {
    resolveShared = resolve
  })
  const entryKeys = counterpartKey !== null ? [rawKey, counterpartKey] : [rawKey]
  const entry: MdbRawInflight = { promise: shared, controller, subscribers: 1, settled: false, keys: entryKeys }
  // Pre-registrazione della controparte caller-known sotto la STESSA entry
  // owned (nessuna mappa alias illimitata: ≤2 chiavi, rimosse al settle):
  // il TMDB-only simultaneo trova la fetch IMDb-first e la condivide.
  for (const k of entryKeys) mdbRawInflight.set(k, entry)

  void (async () => {
    try {
      // Recheck L1 dentro l'operazione posseduta: la lookup veloce
      // pre-inflight resta, ma un'altra path può aver popolato la L1 nel
      // frattempo — mai rifetchare ciò che è già cachato.
      const innerHit = cacheGet<Record<string, number>>(rawKey)
      if (innerHit) {
        entry.settled = true
        resolveShared({ sources: { ...innerHit }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true })
        return
      }
      // Idratazione L2 POSSEDUTA dall'operazione condivisa (mai prima della
      // registrazione inflight): i caller concorrenti — anche sfalsati mentre
      // la KV è pendente — condividono UNA sola lookup KV e al massimo UN solo
      // upstream. La wait KV è limitata dal timeout interno KV; ogni
      // subscriber lascia comunque sul proprio budget via raceWithAbort senza
      // mai abortire il lavoro altrui (l'owned cade solo a zero subscriber).
      if (controller.signal.aborted || entry.subscribers <= 0) {
        entry.settled = true
        resolveShared(transientMdbResult())
        return
      }
      const l2 = await cacheGetShared<Record<string, number>>(rawKey, ["mdb"])
      // Dopo la KV: niente richiesta MDB senza subscriber attivi. Una hit L2
      // ha già ripopolato la L1 per i caller futuri; una miss si risolve
      // transient senza toccare l'upstream.
      if (controller.signal.aborted || entry.subscribers <= 0) {
        entry.settled = true
        if (l2) resolveShared({ sources: { ...l2 }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true })
        else resolveShared(transientMdbResult())
        return
      }
      if (l2) {
        entry.settled = true
        resolveShared({ sources: { ...l2 }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true })
        return
      }
      // Recheck L1 post-idratazione: la read KV ripopola la L1 su hit (caso
      // già ritornato sopra); su miss un'altra operazione settled nel
      // frattempo può aver cachato — mai duplicare una fetch riuscita.
      const afterHydration = cacheGet<Record<string, number>>(rawKey)
      if (afterHydration) {
        entry.settled = true
        resolveShared({ sources: { ...afterHydration }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true })
        return
      }
      // Persistenza locale L2 (solo file-mode: in KV è un no-op immediato,
      // senza I/O né latenza): idratazione posseduta dentro l'operazione
      // condivisa, come la KV sopra — un solo read disco per identità
      // concorrente, scadenza assoluta conservata (la L1 si ripopola col
      // residuo, mai sliding). Probe ASINCRONA di un singolo piccolo file
      // (≤64KiB): dopo l'await vale la stessa guardia subscriber — senza
      // subscriber attivi (o con owned abortito, es. lettura lenta e caller
      // cancellati) niente upstream MDB. Una hit legittima evita
      // correttamente l'upstream (cache hit, non fetch sprecato).
      const persisted = await getPersistedMdbRaw(rawKey, { signal: controller.signal })
      if (controller.signal.aborted || entry.subscribers <= 0) {
        entry.settled = true
        // Hit tardiva dopo la cancellazione: dato genuino della stessa
        // identità (qualunque retry lo rileggerebbe dal disco), quindi
        // convergenza — non poison. Il poison (risultati upstream orfani) non
        // scrive mai: vedi guardia sotto.
        if (persisted) {
          cacheSet(rawKey, { ...persisted.sources }, ["mdb"], persisted.remainingTtlMs)
          resolveShared({ sources: { ...persisted.sources }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true })
        } else {
          resolveShared(transientMdbResult())
        }
        return
      }
      if (persisted) {
        cacheSet(rawKey, { ...persisted.sources }, ["mdb"], persisted.remainingTtlMs)
        entry.settled = true
        resolveShared({ sources: { ...persisted.sources }, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS, hydrated: true })
        return
      }
      // Daily-quota parking sits BEHIND every cache layer above (L1, KV L2,
      // local disk): cache hits are still served for a parked key, only fresh
      // keyed upstream is skipped (zero quota spend until reset). Mock-server
      // runs (MDBLIST_API_URL set) stay isolated: parking never gates them.
      if (key && !process.env.MDBLIST_API_URL && isMdbKeyParked(key)) {
        entry.settled = true
        resolveShared(transientMdbResult())
        return
      }
      const result = await fetchMdbListSourcesUpstream(upstreamUrl, key, controller.signal)
      // Mai avvelenare la cache grezza con un completamento tardivo dopo la
      // cancellazione: se l'owned è abortito o non resta alcun subscriber, il
      // risultato orfano si risolve solo sulla vecchia promise (nessun nuovo
      // waiter lo riceve: il retry usa già una entry fresca) senza scrivere.
      if (result.sources && !controller.signal.aborted && entry.subscribers > 0) {
        cacheSet(rawKey, { ...result.sources }, ["mdb"], result.rawTtlMs)
        // L2 locale fire-and-forget (solo file-mode, no-op in KV): mai attesa
        // sul path caldo; i risultati abbandonati non arrivano mai qui (zero
        // subscriber = niente scrittura), solo successi con TTL assoluto.
        void setPersistedMdbRaw(rawKey, result.sources, result.rawTtlMs).catch(() => {})
        // Alias-dedup (task C): solo successi, stessa key/policy/TTL, nessuna
        // fetch extra. Evidenza unanime: il caller conosceva già la coppia
        // (imdbId + tmdbId con tipo esplicito) e/o il corpo risposta osserva la
        // controparte; in caso di conflitto le entry restano separate.
        for (const aliasKey of mdbAliasRawKeys(useImdb ? "imdb" : "tmdb", lookup, mdbSeg, tmdbSeg, minVotes, key, result, rawKey)) {
          cacheSet(aliasKey, { ...result.sources }, ["mdb"], result.rawTtlMs)
          void setPersistedMdbRaw(aliasKey, result.sources, result.rawTtlMs).catch(() => {})
        }
      }
      entry.settled = true
      resolveShared(result)
    } catch {
      entry.settled = true
      resolveShared(transientMdbResult())
    } finally {
      unregisterMdbRawInflight(entry)
    }
  })()

  try {
    return await raceWithAbort(shared, signal)
  } catch {
    return transientMdbResult()
  } finally {
    releaseSubscriber(entry, controller)
  }
}

export async function fetchAggregatedRating(
  imdbId: string | null | undefined,
  apiKey?: string,
  signal?: AbortSignal,
  opts?: FetchAggregatedOptions
): Promise<AggregatedRatings | null> {
  // Task C — identità: l'IMDb valido (`tt…`) resta l'unica via MDBList quando
  // presente; senza, TMDB id numerico + tipo esplicito abilita il path TMDB.
  // I bare-numeric non sono mai IMDb (niente tt fabbricati) e non vengono mai
  // passati come IMDb ai direct provider/Cinemeta (solo tmdbId normalizzato).
  const cleanImdb = isValidImdbId(imdbId) ? imdbId : null
  const tmdbNum = parseTmdbId(opts?.tmdbId)
  const tmdbMdbUsable = tmdbNum !== null && mdbTmdbSegment(opts?.mediaType ?? null) !== null
  const hasMdbIdentity = cleanImdb !== null || tmdbMdbUsable
  // Identità cache aggregata: byte-identica a prima con IMDb (`tt…`), `tmdb{n}`
  // senza (mai bare-numeric: impossibile collidere con un IMDb).
  const mdbIdentity = cleanImdb ?? (tmdbNum !== null ? `tmdb${tmdbNum}` : "noid")

  // Selezione esplicita (rsrc risolta dai caller): guida il routing. Assente
  // = legacy all-source (i flag want* decidono, come prima).
  const selection = normalizeRequestedSources(opts?.requestedSources ?? null)
  const selSet = selection ? new Set(selection) : null

  // Con selezione esplicita la selezione vince sui flag: niente upstream per
  // fonti non richieste (difesa in profondità se un caller passa flag stantii).
  const effWantSimkl = selSet ? selSet.has("simkl") && !!opts?.simklKey?.trim() : !!(opts?.wantSimkl && opts?.simklKey?.trim())
  const effWantAnilist = selSet ? selSet.has("anilist") : !!opts?.wantAnilist
  const effWantKitsu = selSet ? selSet.has("kitsu") : !!opts?.wantKitsu
  const effWantAnime = effWantAnilist || effWantKitsu
  const effWantImdb = selSet ? selSet.has("imdb") : !!opts?.wantImdb

  // Routing: simkl/anilist/kitsu da soli non chiamano mai MDBList (direct
  // provider condizionali); MAL resta MDBList-exclusive. Selezioni senza
  // fonti MDBList-exclusive (solo imdb/tmdb + direct-only) usano Cinemeta
  // primario + join diretto, MDBList solo per gli irrisolti; il resto resta
  // MDBList primario + fallback IMDb sequenziale.
  const needsMdblist = !selSet || selection!.some((s) => !DIRECT_ONLY_SOURCES.has(s))
  const hasMdblistExclusive = !!selSet && needsMdblist && selection!.some((s) => !DIRECT_ONLY_SOURCES.has(s) && s !== "imdb" && s !== "tmdb")
  // Famiglia imdb/tmdb (+ eventuali direct-only): Cinemeta primario + join
  // diretto quando nessuna fonte richiede MDBList in esclusiva.
  const familyDirectOnly = !!selSet && needsMdblist && !hasMdblistExclusive

  // Solo voto TMDB genuino diretto (details.vote_average): mai medie
  // congelate da mapping/query come "nativo". Vale solo dove tmdb è
  // richiesto (legacy) o esplicito in selezione.
  const directVote = isGenuineDirectVote(opts?.tmdbFallbackVote) ? (opts?.tmdbFallbackVote as number) : null
  const allowDirectOverlay = !selSet || selSet.has("tmdb")
  const effectiveDirectVote = allowDirectOverlay ? directVote : null

  // Senza identità MDBList, senza tmdbId e senza voto diretto: null senza
  // alcun upstream. Con tmdbId ma tipo ambiguo per MDBList (o senza voto
  // diretto) si prosegue: niente MDBList, ma i direct provider capaci
  // (Simkl/Anime via tmdbId) restano disponibili più sotto.
  if (!hasMdbIdentity && tmdbNum === null && effectiveDirectVote === null) return null

  const overallMs = clampOverallBudget(opts?.ratingWaitMs)
  const startedAt = Date.now()
  const remainingMs = (): number | undefined =>
    overallMs === null ? undefined : Math.max(0, overallMs - (Date.now() - startedAt))
  // Il primario riceve una share limitata del budget complessivo (60%): il
  // fallback riceve il resto (40%) e resta genuinamente utilizzabile anche
  // a budget minimo (300ms → 180 primario + 120 fallback, nessun floor).
  const primaryShareMs = (): number | undefined => {
    if (overallMs === null) return undefined
    const rem = Math.max(0, overallMs - (Date.now() - startedAt))
    if (rem <= 0) return 0
    return Math.min(rem, Math.floor(overallMs * PRIMARY_BUDGET_SHARE))
  }

  // Solo la chiave esplicita della richiesta: non esiste più chiave d'istanza per MDBList.
  const key = apiKey
  // Segmento tipo-media + policy min-votes isolano la cache per endpoint e
  // per policy (mai riuso legacy Altro-tipo/altra-policy: v3 + movie/show/any
  // + mvN su entrambe le cache, grezza e aggregata).
  const mdbSeg = mdbMediaSegment(opts?.mediaType ?? null)
  const minVotesPolicy = resolveRatingMinVotes()
  const keyHash = key ? crypto.createHash("sha1").update(key).digest("hex").slice(0, 8) : "nomk"
  const simklHash = effWantSimkl && opts?.simklKey ? crypto.createHash("sha1").update(opts.simklKey.trim()).digest("hex").slice(0, 8) : "nosk"
  // Le fonti anime cambiano i sources → parte del cache key (flag, mai ID).
  // Stesso per wantImdb (Cinemeta): senza, togglare rsrc in editor servirebbe
  // entry con/senza imdb a caso dentro le 6h di TTL.
  // Il lato TMDB entra nella chiave quando le fonti anime sono attive: gli id
  // numerici sono condivisi tra movie e tv e lo stesso imdb non deve servire
  // entry con l'anime dell'altro lato (P1: tv/128 vs movie/128).
  // La selezione (sort/dedupe, mai ordine display) isola la cache per policy;
  // la versione invalida le entry pre-routing (mai vecchia precedenza).
  const animeSide = effWantAnime ? normalizeAnimeSide(opts?.mediaType ?? null) : null
  const animeFlag = `${effWantAnilist ? "al" : "x"}${effWantKitsu ? "ki" : "x"}`
  const selKey = selSet ? [...selSet].sort().join(",") : "all"
  const cacheKey = `mdb:ratings:${RATINGS_CACHE_VERSION}:${mdbIdentity}:${keyHash}${effWantSimkl ? `:${simklHash}` : ""}${effWantAnime ? `:${animeFlag}:${animeSide ?? "x"}` : ""}${effWantImdb ? ":ci" : ""}:sel:${selKey}:mdb:${mdbSeg}:mv${minVotesPolicy}`

  // Cache hit: overlay diretto su COPIA (mai mutare l'oggetto condiviso).
  const cached = cacheGet<AggregatedRatings>(cacheKey)
  if (cached) return effectiveDirectVote !== null ? withDirectTmdbOverlay(cached, effectiveDirectVote) : cached

  const nulledAt = ratingsNullAt.get(cacheKey)
  if (nulledAt !== undefined) {
    if (Date.now() - nulledAt < RATINGS_NULL_TTL_MS) {
      // Negativa sul provider base: il voto nativo valido resta un risultato
      // da solo, senza refetch provider e senza avvelenare la cache.
      if (effectiveDirectVote !== null) {
        const rounded = roundVote(effectiveDirectVote)
        return { sources: { tmdb: rounded }, average: rounded, count: 1 }
      }
      return null
    }
    ratingsNullAt.delete(cacheKey)
  }

  // TMDB-only con voto diretto genuino: zero upstream di rating (né MDBList
  // né Cinemeta né TMDB: il voto è già in mano al caller). Mai in cache
  // success: congelarlo maschererebbe il recovery del provider.
  if (selSet && selection!.length === 1 && selection![0] === "tmdb" && effectiveDirectVote !== null) {
    const rounded = roundVote(effectiveDirectVote)
    return { sources: { tmdb: rounded }, average: rounded, count: 1 }
  }

  // Budget complessivo: abortisce l'upstream residuo alla scadenza; timer e
  // listener sempre puliti in finally (niente zombie oltre la race caller).
  let budgetTimer: ReturnType<typeof setTimeout> | undefined
  let onCallerAbort: (() => void) | undefined
  const budgetCtrl = overallMs !== null ? new AbortController() : null
  if (budgetCtrl && overallMs !== null) {
    budgetTimer = setTimeout(() => {
      try {
        budgetCtrl.abort(new DOMException("Aborted", "AbortError"))
      } catch { /* noop */ }
    }, Math.max(1, overallMs))
    if (signal) {
      if (signal.aborted) budgetCtrl.abort((signal as unknown as { reason?: unknown }).reason)
      else {
        onCallerAbort = () => budgetCtrl.abort((signal as unknown as { reason?: unknown }).reason)
        signal.addEventListener("abort", onCallerAbort, { once: true })
      }
    }
  }
  const upstream = budgetCtrl ? combineAbortSignals(signal, budgetCtrl.signal) : signal
  const cleanupBudget = () => {
    // Abortisce prima l'owned controller: i join laterali scaduti devono
    // terminare l'upstream anche senza signal esterno (niente side zombie).
    if (budgetCtrl && !budgetCtrl.signal.aborted) {
      try {
        budgetCtrl.abort(new DOMException("Aborted", "AbortError"))
      } catch { /* noop */ }
    }
    if (budgetTimer !== undefined) {
      clearTimeout(budgetTimer)
      budgetTimer = undefined
    }
    if (onCallerAbort && signal) {
      signal.removeEventListener("abort", onCallerAbort)
      onCallerAbort = undefined
    }
  }

  try {
    // Ramo famiglia+diretti (solo imdb/tmdb + simkl/anilist/kitsu, nessuna
    // fonte MDBList-exclusive): Cinemeta primario con share limitata per
    // imdb, join dei direct provider sul residuo, MDBList solo per gli
    // irrisolti imdb/tmdb. Mai chiamate TMDB extra: il tmdb o è diretto
    // (overlay non cachato) o arriva dal fallback MDBList. La cache tiene
    // SOLO la base provider (mai il voto diretto request-specific).
    if (familyDirectOnly) {
      const base: Record<string, number> = {}
      const simklP = effWantSimkl
        ? fetchSimklRating(cleanImdb, opts!.simklKey!, { tmdbId: tmdbNum, mediaType: opts?.mediaType, signal: upstream }).catch(() => null)
        : null
      const animeP = effWantAnime
        ? fetchAnimeRatings(cleanImdb, { tmdbId: tmdbNum, mediaType: opts?.mediaType ?? null, wantAnilist: effWantAnilist, wantKitsu: effWantKitsu, signal: upstream }).catch(() => null)
        : null
      if (selSet!.has("imdb") && effWantImdb) {
        const ph = phaseSignal(upstream, primaryShareMs())
        try {
          const cinemetaRating = await fetchCinemetaRating(cleanImdb, opts?.mediaType, ph.signal).catch(() => null)
          if (typeof cinemetaRating === "number") base.imdb = cinemetaRating
        } finally {
          ph.cleanup()
        }
      }
      let mdbGenuineMiss = false
      // tmdb diretto già risolto via overlay: non richiede fallback MDBList.
      const needFallback =
        (selSet!.has("imdb") && base.imdb === undefined) ||
        (selSet!.has("tmdb") && base.tmdb === undefined && effectiveDirectVote === null)
      if (needFallback) {
        const rem = remainingMs()
        if (rem === undefined || rem > 0) {
          const ph = phaseSignal(upstream, rem)
          try {
            const mdbResult = await fetchMdbListSources({ imdbId: cleanImdb, tmdbId: tmdbNum }, key, ph.signal, opts?.mediaType ?? null)
            if (mdbResult.sources) {
              for (const s of selection!) {
                if (DIRECT_ONLY_SOURCES.has(s)) continue
                if (base[s] === undefined && typeof mdbResult.sources[s] === "number") {
                  base[s] = mdbResult.sources[s]
                }
              }
            } else {
              mdbGenuineMiss = mdbResult.isGenuineMiss
            }
          } finally {
            ph.cleanup()
          }
        }
      }
      {
        const rem = remainingMs()
        const [simklRating, animeRatings] = await Promise.all([
          joinSide(simklP, rem, null),
          joinSide(animeP, rem, null),
        ])
        if (typeof simklRating === "number" && Number.isFinite(simklRating) && simklRating > 0) {
          base.simkl = simklRating
        }
        if (typeof animeRatings?.anilist === "number") base.anilist = animeRatings.anilist
        if (typeof animeRatings?.kitsu === "number") base.kitsu = animeRatings.kitsu
      }
      if (Object.keys(base).length > 0) {
        // Con voto diretto il fallback MDBList per tmdb è saltato: la base
        // è parziale (manca il tmdb provider). Non cacharla: congelarla
        // servirebbe la parziale anche alle chiamate senza nativo.
        if (effectiveDirectVote !== null && selSet!.has("tmdb")) {
          const uncached: AggregatedRatings = { sources: { ...base }, average: averageFor(base), count: Object.keys(base).length }
          return withDirectTmdbOverlay(uncached, effectiveDirectVote)
        }
        const cachedBase: AggregatedRatings = { sources: { ...base }, average: averageFor(base), count: Object.keys(base).length }
        cacheSet(cacheKey, cachedBase, ["mdb", "simkl", "anime"], RATINGS_SUCCESS_TTL_MS)
        return effectiveDirectVote !== null ? withDirectTmdbOverlay(cachedBase, effectiveDirectVote) : cachedBase
      }
      // Solo voto diretto, nessuna base provider: risultato nativo senza
      // cache success (non deve mascherare il recovery del provider).
      if (effectiveDirectVote !== null && (selSet!.has("tmdb"))) {
        const rounded = roundVote(effectiveDirectVote)
        return { sources: { tmdb: rounded }, average: rounded, count: 1 }
      }
      if (mdbGenuineMiss) ratingsNullSet(cacheKey)
      return null
    }

    // Ramo direct-only (solo simkl/anilist/kitsu): zero MDBList, zero
    // Cinemeta. MAL resta MDBList e non entra mai qui (è covered).
    if (!needsMdblist) {
      const simklP = effWantSimkl
        ? fetchSimklRating(cleanImdb, opts!.simklKey!, { tmdbId: tmdbNum, mediaType: opts?.mediaType, signal: upstream }).catch(() => null)
        : null
      const animeP = effWantAnime
        ? fetchAnimeRatings(cleanImdb, { tmdbId: tmdbNum, mediaType: opts?.mediaType ?? null, wantAnilist: effWantAnilist, wantKitsu: effWantKitsu, signal: upstream }).catch(() => null)
        : null
      const rem = remainingMs()
      const [simklRating, animeRatings] = await Promise.all([
        joinSide(simklP, rem, null),
        joinSide(animeP, rem, null),
      ])
      const sources: Record<string, number> = {}
      if (typeof simklRating === "number" && Number.isFinite(simklRating) && simklRating > 0) {
        sources.simkl = simklRating
      }
      if (typeof animeRatings?.anilist === "number") sources.anilist = animeRatings.anilist
      if (typeof animeRatings?.kitsu === "number") sources.kitsu = animeRatings.kitsu
      if (Object.keys(sources).length === 0) return null
      const result: AggregatedRatings = { sources, average: averageFor(sources), count: Object.keys(sources).length }
      cacheSet(cacheKey, result, ["mdb", "simkl", "anime"], RATINGS_SUCCESS_TTL_MS)
      return result
    }

    // Ramo primario MDBList (legacy all-source + selezioni con fonti
    // MDBList-exclusive): side diretti lanciati subito ma joinati DOPO il
    // fallback IMDb — il fallback sequenziale non resta mai dietro la
    // Promise.all dei side provider.
    const simklP = effWantSimkl
      ? fetchSimklRating(cleanImdb, opts!.simklKey!, { tmdbId: tmdbNum, mediaType: opts?.mediaType, signal: upstream }).catch(() => null)
      : null
    const animeP = effWantAnime
      ? fetchAnimeRatings(cleanImdb, { tmdbId: tmdbNum, mediaType: opts?.mediaType ?? null, wantAnilist: effWantAnilist, wantKitsu: effWantKitsu, signal: upstream }).catch(() => null)
      : null

    let mdbResult: MdbListFetchResult
    {
      const ph = phaseSignal(upstream, primaryShareMs())
      try {
        mdbResult = await fetchMdbListSources({ imdbId: cleanImdb, tmdbId: tmdbNum }, key, ph.signal, opts?.mediaType ?? null)
      } catch {
        mdbResult = { sources: null, isGenuineMiss: false, rawTtlMs: MDB_RAW_TTL_MS }
      } finally {
        ph.cleanup()
      }
    }

    const sources: Record<string, number> = mdbResult.sources ? { ...mdbResult.sources } : {}
    // Fallback IMDb via Cinemeta (gratis, senza chiave): SOLO se MDBList non
    // lo fornisce e solo se richiesto. Sequenziale apposta: a chiave MDBList
    // funzionante zero chiamate extra; sul miss path costa dentro il residuo
    // di budget (fail-open oltre). MDBList vince sempre.
    if (sources.imdb === undefined && effWantImdb) {
      const rem = remainingMs()
      if (rem === undefined || rem > 0) {
        const ph = phaseSignal(upstream, rem)
        try {
          const cinemetaRating = await fetchCinemetaRating(cleanImdb, opts?.mediaType, ph.signal).catch(() => null)
          if (typeof cinemetaRating === "number") {
            sources.imdb = cinemetaRating
          }
        } finally {
          ph.cleanup()
        }
      }
    }
    {
      const rem = remainingMs()
      const [simklRating, animeRatings] = await Promise.all([
        joinSide(simklP, rem, null),
        joinSide(animeP, rem, null),
      ])
      if (typeof simklRating === "number" && Number.isFinite(simklRating) && simklRating > 0) {
        sources.simkl = simklRating
      }
      if (typeof animeRatings?.anilist === "number") {
        sources.anilist = animeRatings.anilist
      }
      if (typeof animeRatings?.kitsu === "number") {
        sources.kitsu = animeRatings.kitsu
      }
    }

    if (Object.keys(sources).length > 0) {
      // Base cachata SENZA voto diretto (request-specific): l'overlay diretto
      // si applica sulla copia restituita, mai sull'oggetto condiviso.
      const result: AggregatedRatings = {
        sources,
        average: averageFor(sources),
        count: Object.keys(sources).length,
      }
      cacheSet(cacheKey, result, effWantAnime ? ["mdb", "simkl", "anime"] : ["mdb", "simkl"], RATINGS_SUCCESS_TTL_MS)
      return effectiveDirectVote !== null ? withDirectTmdbOverlay(result, effectiveDirectVote) : result
    }
    // Outage totale ma voto diretto genuino: il tmdb diretto resta un
    // risultato valido da solo (legacy gap-fill, mai null che nasconde il
    // voto). Mai in cache success: congelarlo maschererebbe il recovery.
    if (effectiveDirectVote !== null) {
      const rounded = roundVote(effectiveDirectVote)
      return { sources: { tmdb: rounded }, average: rounded, count: 1 }
    }

    if (mdbResult.isGenuineMiss) {
      ratingsNullSet(cacheKey)
    }
    return null
  } catch (e) {
    log.error("Aggregated ratings fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  } finally {
    cleanupBudget()
  }
}
