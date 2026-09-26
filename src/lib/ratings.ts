import crypto from "node:crypto"
import { cacheGet, cacheSet } from "./cache"
import { timedFetch } from "./outbound-stats"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { createCircuitBreaker, parseRetryAfterMs } from "@/lib/circuit-breaker"
import { fetchSimklRating } from "./simkl"
import { fetchAnimeRatings } from "./anime-ratings"
import { fetchCinemetaRating } from "./cinemeta"

const log = createLogger("ratings")

// Override E2E/mock deterministico (stesso pattern di mdblist.ts): in
// produzione la env è assente e si usa l'endpoint reale.
const MDBLIST = process.env.MDBLIST_API_URL || "https://mdblist.com/api"

// Phase 2 (Provider Resilience): deadline interna 8000 → 1500ms. I caller
// fanno già race con RATING_WAIT_MS, ma il fetch restava zombie fino a 8s;
// la route tmdb-details non passa alcun signal, quindi questo è la sua unica
// guardia anti-starvation.
const MDBLIST_TIMEOUT_MS = (() => {
  const raw = envWithFallback("MDBLIST_TIMEOUT_MS")
  const n = raw ? parseInt(raw, 10) : 1500
  return Number.isFinite(n) && n >= 300 && n <= 10000 ? n : 1500
})()

// Fail-open breaker dedicato: 3 fallimenti consecutivi → 30s di cooldown.
// Mentre è aperto le chiamate ritornano subito null (fallback al voto TMDB
// nativo nei caller) senza toccare la rete.
const mdblistBreaker = createCircuitBreaker({ name: "mdblist", failureThreshold: 3, backoffMs: 30_000 })

/** Solo per i test: azzera lo stato del breaker MDBList. */
export function __resetMdblistBreaker(): void {
  mdblistBreaker.reset()
}

const RATINGS_NULL_TTL_MS = 60_000
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

export function isMdblistBreakerOpen(): boolean {
  return mdblistBreaker.isOpen()
}

export const SUPPORTED_RATING_SOURCES = [
  "imdb",
  "tmdb",
  "mdblist",
  "tomatoes",
  "popcorntime",
  "letterboxd",
  "metacritic",
  "metacriticuser",
  "trakt",
  "simkl",
  "filmweb",
  "filmwebcritics",
  "rogerebert",
  "mal",
  "anilist",
  "kitsu",
] as const

export type RatingSource = (typeof SUPPORTED_RATING_SOURCES)[number]

// Definita in rating-weights.ts (foglia client-safe senza import runtime):
// ratings.ts importa cache/KV e non può stare nel bundle browser.
import { DEFAULT_RATING_SOURCES, UI_RATING_SOURCES } from "./rating-weights"
export { DEFAULT_RATING_SOURCES, UI_RATING_SOURCES }

export interface AggregatedRatings {
  sources: Record<string, number>
  average: number
  count: number
}

function toTen(v: number): number {
  return v > 10 ? v / 10 : v
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Parsing unico del parametro `rsrc` (Fix D): split "," → trim → lowercase →
 * whitelist SUPPORTED_RATING_SOURCES. Ritorna null se il parametro è assente
 * (il chiamante applica la catena dei fallback), [] se presente ma senza
 * fonti valide. Unica implementazione usata da poster route, poster-config e
 * tmdb details route (stesso numero ovunque = Golden Rule).
 */
export function parseRatingSources(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) return null
  const valid = SUPPORTED_RATING_SOURCES as readonly string[]
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => valid.includes(s))
}

/**
 * Catena canonica delle fonti voto: query `rsrc` > fallbacks (mapping >
 * config token > server defaults) > DEFAULT_RATING_SOURCES. Un array vuoto
 * (nessuna fonte / solo garbage) vale come unset e fa cadere al fallback
 * successivo — mai media su zero fonti.
 */
export function resolveRatingSources(
  query: string | null | undefined,
  ...fallbacks: (readonly string[] | null | undefined)[]
): string[] {
  const parsed = parseRatingSources(query)
  if (parsed && parsed.length > 0) return parsed
  for (const fb of fallbacks) {
    if (fb && fb.length > 0) return fb.map((s) => s.toLowerCase())
  }
  return [...DEFAULT_RATING_SOURCES]
}

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
export const MAX_SEPARATE_RATINGS = 3

/** Fonti mostrate in percentuale invece che in decimi (valore /10 → `88%`). */
const PERCENT_SOURCES: ReadonlySet<string> = new Set(["tomatoes", "popcorntime"])

export interface SeparateRating {
  readonly id: string
  readonly value: number
}

/**
 * Sottoinsieme ordinato delle fonti aggregate per la colonna separata:
 * ordine di selezione `requestedSources`, skip valori mancanti/0, cap
 * MAX_SEPARATE_RATINGS. Ritorna [] quando niente è mostrabile (il chiamante
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
   * Voto TMDB diretto (details.vote_average) come backfill di `sources.tmdb`
   * quando MDBList manca (quota/outage): senza, a MDBList down spariscono
   * imdb E tmdb insieme pur avendo la chiave TMDB funzionante. Vale solo in
   * assenza del tmdb da MDBList (mai sovrascrittura) e non entra nel cache
   * key (staleness 30min come tutte le fonti). Solo voto TMDB genuino —
   * mai medie congelate da mapping/query.
   */
  tmdbFallbackVote?: number | null
}

interface MdbListFetchResult {
  sources: Record<string, number> | null
  isGenuineMiss: boolean
}

async function fetchMdbListSources(
  imdbId: string,
  key?: string,
  signal?: AbortSignal
): Promise<MdbListFetchResult> {
  if (mdblistBreaker.isOpen()) return { sources: null, isGenuineMiss: false }

  const qs = key ? `?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}` : `?i=${encodeURIComponent(imdbId)}`

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
      `${MDBLIST}/${qs}`,
      { signal: combined }
    )
    if (res.status === 429 || res.status >= 500) {
      mdblistBreaker.recordFailure(parseRetryAfterMs((n) => res.headers.get(n)))
      return { sources: null, isGenuineMiss: false }
    }
    if (!res.ok) {
      return { sources: null, isGenuineMiss: true }
    }
    mdblistBreaker.recordSuccess()
    const raw = await res.json()
    const data = raw?.data ?? raw

    const ratings = data?.ratings
    const sources: Record<string, number> = {}

    // If root data has mdblist score/rating
    const rootScore = typeof data?.score === "number" ? data.score : parseFloat(data?.score)
    if (!isNaN(rootScore) && rootScore > 0) {
      sources.mdblist = Math.round((rootScore > 10 ? rootScore / 10 : rootScore) * 10) / 10
    }

    if (Array.isArray(ratings) && ratings.length > 0) {
      const ALL_SOURCES = new Set<string>(SUPPORTED_RATING_SOURCES)

      for (const item of ratings) {
        let src = (item?.source || item?.name || item?.provider || "").toLowerCase().replace(/[-_]/g, "")
        if (src === "myanimelist") src = "mal"
        if (src === "popcorn" || src === "rtaudience" || src === "audience" || src === "tomatoesaudience") src = "popcorntime"
        if (!ALL_SOURCES.has(src)) continue

        let normalized: number | null = null
        const rawScore = item?.score
        const scoreNum = typeof rawScore === "number" ? rawScore : parseFloat(rawScore)
        if (!isNaN(scoreNum) && scoreNum > 0) {
          normalized = scoreNum > 10 ? scoreNum / 10 : scoreNum
        } else {
          const rawV = item?.value ?? item?.rating
          const v = typeof rawV === "number" ? rawV : parseFloat(rawV)
          if (!isNaN(v) && v > 0) {
            if (src === "letterboxd" && v <= 5) {
              normalized = v * 2
            } else if (src === "rogerebert" && v <= 4) {
              normalized = v * 2.5
            } else {
              normalized = toTen(v)
            }
          }
        }

        if (normalized !== null && !isNaN(normalized) && normalized > 0 && !sources[src]) {
          sources[src] = Math.round(normalized * 10) / 10
        }
      }
    }

    const hasSources = Object.keys(sources).length > 0
    return { sources: hasSources ? sources : null, isGenuineMiss: !hasSources }
  } catch (e) {
    if (!signal?.aborted) mdblistBreaker.recordFailure()
    log.error("MDBList fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return { sources: null, isGenuineMiss: false }
  }
}

export async function fetchAggregatedRating(
  imdbId: string,
  apiKey?: string,
  signal?: AbortSignal,
  opts?: FetchAggregatedOptions
): Promise<AggregatedRatings | null> {
  if (!imdbId) return null

  const wantSimkl = !!(opts?.wantSimkl && opts?.simklKey?.trim())
  const wantAnilist = !!opts?.wantAnilist
  const wantKitsu = !!opts?.wantKitsu
  const wantAnime = wantAnilist || wantKitsu

  // Solo la chiave esplicita della richiesta: non esiste più chiave d'istanza per MDBList.
  const key = apiKey
  const keyHash = key ? crypto.createHash("sha1").update(key).digest("hex").slice(0, 8) : "nomk"
  const simklHash = wantSimkl && opts?.simklKey ? crypto.createHash("sha1").update(opts.simklKey.trim()).digest("hex").slice(0, 8) : "nosk"
  // Le fonti anime cambiano i sources → parte del cache key (flag, mai ID).
  // Stesso per wantImdb (Cinemeta): senza, togglare rsrc in editor servirebbe
  // entry con/senza imdb a caso dentro i 30min di TTL.
  const animeFlag = `${wantAnilist ? "al" : "x"}${wantKitsu ? "ki" : "x"}`
  const cacheKey = `mdb:ratings:${imdbId}:${keyHash}${wantSimkl ? `:${simklHash}` : ""}${wantAnime ? `:${animeFlag}` : ""}${opts?.wantImdb ? ":ci" : ""}`

  const cached = cacheGet<AggregatedRatings>(cacheKey)
  if (cached) return cached

  const nulledAt = ratingsNullAt.get(cacheKey)
  if (nulledAt !== undefined) {
    if (Date.now() - nulledAt < RATINGS_NULL_TTL_MS) return null
    ratingsNullAt.delete(cacheKey)
  }

  try {
    const [mdbResult, simklRating, animeRatings] = await Promise.all([
      fetchMdbListSources(imdbId, key, signal),
      wantSimkl
        ? fetchSimklRating(imdbId, opts!.simklKey!, { tmdbId: opts?.tmdbId, mediaType: opts?.mediaType, signal }).catch(() => null)
        : Promise.resolve(null),
      wantAnime
        ? fetchAnimeRatings(imdbId, { tmdbId: opts?.tmdbId, wantAnilist, wantKitsu, signal }).catch(() => null)
        : Promise.resolve(null),
    ])

    const sources: Record<string, number> = mdbResult.sources ? { ...mdbResult.sources } : {}
    if (typeof simklRating === "number" && Number.isFinite(simklRating) && simklRating > 0) {
      sources.simkl = simklRating
    }
    if (typeof animeRatings?.anilist === "number") {
      sources.anilist = animeRatings.anilist
    }
    if (typeof animeRatings?.kitsu === "number") {
      sources.kitsu = animeRatings.kitsu
    }
    // Fallback IMDb via Cinemeta (gratis, senza chiave): SOLO se MDBList non
    // lo fornisce e solo se richiesto. Sequenziale apposta: a chiave MDBList
    // funzionante zero chiamate extra; sul miss path costa ~300ms dentro la
    // race RATING_WAIT dei caller (fail-open oltre). MDBList vince sempre.
    if (sources.imdb === undefined && opts?.wantImdb) {
      const cinemetaRating = await fetchCinemetaRating(imdbId, opts?.mediaType, signal).catch(() => null)
      if (typeof cinemetaRating === "number") {
        sources.imdb = cinemetaRating
      }
    }
    const fbVote = opts?.tmdbFallbackVote
    if (sources.tmdb === undefined && typeof fbVote === "number" && Number.isFinite(fbVote) && fbVote > 0) {
      sources.tmdb = Math.round(Math.min(fbVote, 10) * 10) / 10
    }

    if (Object.keys(sources).length > 0) {
      const defaultValues: number[] = []
      if (typeof sources.imdb === "number") defaultValues.push(sources.imdb)
      if (typeof sources.tmdb === "number") defaultValues.push(sources.tmdb)

      const fallbackValues = Object.values(sources)
      const valuesToAvg = defaultValues.length > 0 ? defaultValues : fallbackValues
      const result: AggregatedRatings = {
        sources,
        average: avg(valuesToAvg),
        count: Object.keys(sources).length,
      }
      cacheSet(cacheKey, result, wantAnime ? ["mdb", "simkl", "anime"] : ["mdb", "simkl"])
      return result
    }

    if (mdbResult.isGenuineMiss) {
      ratingsNullSet(cacheKey)
    }
    return null
  } catch (e) {
    log.error("Aggregated ratings fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}
