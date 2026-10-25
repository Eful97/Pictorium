import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { getJWRankings, getJWTitles, PLATFORM_JW_PACKAGES, type JWRankEntry } from "@/lib/justwatch"
import { flixSlugToRegionCode, getRegionDef, GLOBAL_REGION } from "@/lib/regions"
import { timedFetch } from "./outbound-stats"

const log = createLogger("flixpatrol")

const CATALOG_BASE = "https://raw.githubusercontent.com/0xConstant1/fp-crawler/main/catalogs"
const TMDB_BASE = "https://api.themoviedb.org/3"

// Slug paese supportati dal repo fp-crawler. Liste chiuse: un paese non in
// questa lista viene rifiutato (fail-closed) invece di fare fetch di un file
// arbitrario (path traversal / URL injection) o di ripiegare silenziosamente
// sull'Italia.
const SUPPORTED_COUNTRIES = new Set([
  "albania", "algeria", "antigua-and-barbuda", "argentina", "armenia", "australia", "austria",
  "azerbaijan", "bahamas", "bahrain", "bangladesh", "belarus", "belgium", "belize", "bolivia",
  "bosnia-and-herzegovina", "botswana", "brazil", "bulgaria", "cambodia", "canada", "chile",
  "colombia", "costa-rica", "croatia", "cyprus", "czech-republic", "denmark", "dominica",
  "dominican-republic", "ecuador", "egypt", "estonia", "finland", "france", "gambia", "germany",
  "ghana", "greece", "guatemala", "honduras", "hong-kong", "hungary", "iceland", "india",
  "indonesia", "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan",
  "kenya", "kuwait", "laos", "latvia", "lebanon", "libya", "lithuania", "luxembourg", "malaysia",
  "malta", "mauritania", "mauritius", "mexico", "moldova", "mongolia", "montenegro", "morocco",
  "mozambique", "namibia", "netherlands", "new-zealand", "nicaragua", "niger", "nigeria",
  "north-macedonia", "norway", "oman", "pakistan", "panama", "paraguay", "peru", "philippines",
  "poland", "portugal", "qatar", "romania", "salvador", "saudi-arabia", "serbia", "singapore",
  "slovakia", "slovenia", "south-africa", "south-korea", "spain", "sri-lanka", "sweden",
  "switzerland", "taiwan", "tajikistan", "thailand", "trinidad-and-tobago", "tunisia", "turkey",
  "uganda", "ukraine", "united-arab-emirates", "united-kingdom", "united-states", "uruguay",
  "venezuela", "vietnam", "yemen", "zimbabwe",
])

const catalogUrl = (country: string) => `${CATALOG_BASE}/${country}.json`

// Cache su filesystem: se DATA_DIR non è scrivibile (es. runtime serverless
// read-only di Vercel) usa /tmp — è solo una cache, la perdita a ogni cold
// start è accettabile. La persistenza vera (mapping/profili) resta a KV.
const cacheFile = (() => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.accessSync(DATA_DIR, fs.constants.W_OK)
    return (country: string) => path.join(DATA_DIR, `flixpatrol_cache_${country}.json`)
  } catch {
    const fallbackDir = os.tmpdir()
    log.warn(`DATA_DIR non scrivibile — cache flixpatrol su ${fallbackDir}`)
    return (country: string) => path.join(fallbackDir, `pictorium-flixpatrol_cache_${country}.json`)
  }
})()

const tmdbCache = new Map<string, { data: unknown; timestamp: number }>()
const TMDB_CACHE_TTL = 5 * 60 * 1000
const TMDB_CACHE_MAX = 500

/** Cache key neutra: l'URL senza api_key. La chiave non deve contenere il
 *  segreto (S9, stesso principio di tmdb.ts) e la cache è condivisa tra chiavi
 *  diverse: i dati TMDB sono pubblici, la chiave solo un gate di accesso. */
function tmdbCacheKey(url: string): string {
  const u = new URL(url)
  u.searchParams.delete("api_key")
  return u.toString()
}

// Cache in memoria del catalogo per paese: evita readFileSync (I/O disco) ad
// ogni richiesta. Il file su disco resta come fallback persistente tra i processi.
const memCache = new Map<string, CacheData>()

/**
 * Negative-retry bookkeeping for quarantined country-empty documents
 * (`charts: []`), reusing the established failure patterns (MDBList 60s
 * error-negatives; `CHART_FAILURE_RETRY_MS` 60s family gate):
 * - `quarantineUntilMs`: per-country cooldown. A quarantined observation is
 *   never trusted as data and never stored as a valid payload; after the
 *   cooldown a refetch is allowed so a healed feed recovers WITHOUT waiting
 *   the normal 12h success TTL. Module-memory only (no distributed
 *   guarantee): a restart drops the markers, but a poisoned disk document is
 *   still never trusted — the first read after boot refetches (coalesced)
 *   and either heals or re-arms the cooldown. Concurrent processes may each
 *   spend one fetch per cooldown window: bounded, never a storm.
 * - `fetchInflight`: single-flight coalescing for same-country fetches, so
 *   concurrent consumers (sibling families, live windows) share one
 *   upstream read (same pattern as streaming-availability).
 */
const QUARANTINE_NEGATIVE_TTL_MS = 60_000
const quarantineUntilMs = new Map<string, number>()
const fetchInflight = new Map<string, Promise<CatalogData>>()

function fetchCountryCoalesced(country: string): Promise<CatalogData> {
  const pending = fetchInflight.get(country)
  if (pending) return pending
  const run = fetchCatalog(country).finally(() => {
    if (fetchInflight.get(country) === run) fetchInflight.delete(country)
  })
  fetchInflight.set(country, run)
  return run
}

const SLUG_TO_PLATFORM: Record<string, string> = {
  netflix: "Netflix",
  disney: "Disney+",
  "amazon-prime": "Amazon Prime",
  "hbo-max": "HBO Max",
  "apple-tv": "Apple TV",
  "paramount-plus": "Paramount+",
  now: "NOW",
  "now-tv": "NOW",
  hayu: "hayu",
  crunchyroll: "Crunchyroll",
}

export interface CatalogEntry {
  rank: number
  title: string
  tmdb: { id: number; media_type: string; release_date: string } | null
}

export interface CatalogChart {
  catalog_id: string
  platform: string
  category: string
  /** Chart-level date as emitted by fp-crawler, e.g. "October 22, 2026". */
  date?: string
  entries: CatalogEntry[]
}

export interface CatalogData {
  /** Document top-level date (same format); fallback when a chart carries none. */
  date?: string
  /** Crawl instant; informational only — NEVER used for freshness decisions. */
  scraped_at_utc?: string
  charts: CatalogChart[]
}

interface CacheData {
  timestamp: number
  catalog: CatalogData | null
}

export interface FlixPatrolEnrichedItem {
  rank: number
  title: string
  tmdbId: number | null
  mediaType: "movie" | "tv"
  posterPath: string | null
  releaseDate: string | null
}

export interface FlixPatrolTop10 {
  platform: string
  platformName: string
  country: string
  movies: FlixPatrolEnrichedItem[]
  tv: FlixPatrolEnrichedItem[]
}

function loadCache(country: string): CacheData {
  try {
    const file = cacheFile(country)
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"))
      if (raw && typeof raw === "object" && "catalog" in raw) {
        return raw as CacheData
      }
    }
  } catch (e) { log.error("Failed to load cache", { error: e instanceof Error ? e.message : String(e) }) }
  return { timestamp: 0, catalog: null }
}

function saveCache(country: string, data: CacheData) {
  const file = cacheFile(country)
  void (async () => {
    try {
      const dir = path.dirname(file)
      await fsp.mkdir(dir, { recursive: true })
      const tmp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(data), "utf-8")
      try {
        await fsp.rename(tmp, file)
      } catch {
        await fsp.copyFile(tmp, file)
        await fsp.unlink(tmp).catch(() => {})
      }
    } catch (e) {
      log.error("Failed to save cache", { error: e instanceof Error ? e.message : String(e), country })
    }
  })()
}

async function fetchCatalog(country: string): Promise<CatalogData> {
  const res = await timedFetch(catalogUrl(country), { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`)
  return res.json()
}

async function tmdbCachedFetch(url: string): Promise<unknown | null> {
  const cacheKey = tmdbCacheKey(url)
  const cached = tmdbCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < TMDB_CACHE_TTL) {
    // Promote a MRU (prima chiave = least-recently-used all'eviction).
    tmdbCache.delete(cacheKey)
    tmdbCache.set(cacheKey, cached)
    return cached.data
  }
  try {
    const res = await timedFetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const data = await res.json()
    if (tmdbCache.size >= TMDB_CACHE_MAX) tmdbCache.delete(tmdbCache.keys().next().value!)
    tmdbCache.set(cacheKey, { data, timestamp: Date.now() })
    return data
  } catch {
    return null
  }
}

// C4: cap di concorrenza per l'enrichment dei cataloghi. ~40 voci × fino a 2
// fetch TMDB a voce = ~80 richieste in parallelo su cold cache → satura il
// rate limit TMDB. Con mapLimit il burst resta sotto controllo.
const ENRICH_CONCURRENCY = 6

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/** Locale TMDB per uno slug paese FlixPatrol; fuori dalle regioni supportate resta it-IT. */
function tmdbLangForCountry(country: string): string {
  const code = flixSlugToRegionCode(country)
  return code ? getRegionDef(code).lang : "it-IT"
}

/**
 * Narrow cycle-3 guard: a FlixPatrol country document is valid only when it
 * is an object carrying a `charts` array. A valid array with no platform
 * rows is a legitimate missing-platform empty; anything else (null body,
 * wrong-typed field, error object) is malformed and — on the fixed-cycle
 * path (`freshOrThrow`) — throws instead of publishing a fake empty.
 * Legacy callers without the flag keep the old fail-open [] behavior.
 */
function isValidFlixCatalogDoc(doc: unknown): doc is CatalogData {
  return !!doc && typeof doc === "object" && Array.isArray((doc as { charts?: unknown }).charts)
}

function flixEntriesHaveValidId(entries: unknown): boolean {
  if (!Array.isArray(entries) || entries.length === 0) return true // empty is genuine, not malformed
  return entries.some((e) => {
    const id = (e as { tmdb?: { id?: unknown } } | null)?.tmdb?.id
    const n = Number(id)
    return Number.isFinite(n) && n > 0
  })
}

/**
 * Country-wide empty-document guard (suspicious-empty quarantine).
 *
 * A whole country document with zero `charts` is quarantined as an
 * integrity failure, never trusted as data. Policy rationale (no claim is
 * made about what the upstream served at any given moment — only the
 * received document shape is judged): the per-chart contract already covers
 * genuine "nothing to show" cases at finer granularity (absent split, stale
 * date, malformed entries), while acting on an entirely chartless document
 * would retire every list at once; so the chartless shape is quarantined
 * regardless of cause. Quarantine semantics:
 * - strict callers (`freshOrThrow`) observe `docInvalid` (or `loadFailed`
 *   when a last-good payload exists, mirroring a transport failure) and
 *   retain the last-good snapshot behind the 60s failure gate (cold: no
 *   publish);
 * - legacy callers observe a plain miss (or the last-good payload
 *   fail-open, mirroring a transport failure) and fall back to JW per media
 *   type;
 * - a last-good country payload (memory + disk, timestamps untouched) is
 *   never overwritten by the empty one; retry after a bounded 60s negative
 *   cooldown reuses the established failure patterns (MDBList 60s
 *   error-negatives, `CHART_FAILURE_RETRY_MS`), never the normal 12h
 *   success TTL — a healed feed recovers without waiting 12h.
 *
 * A chart that is PRESENT + fresh with `entries: []` remains a genuine
 * supported empty (unchanged). Malformed documents and entry collections
 * with zero usable tmdbIds keep their existing documented rules.
 */
export function isEmptyCountryDocument(doc: unknown): doc is CatalogData {
  return isValidFlixCatalogDoc(doc) && doc.charts.length === 0
}

// ---------------------------------------------------------------------------
// Chart-date freshness (daily fp-crawler charts).
//
// A platform+country+media chart is usable only when its chart-level `date`
// (falling back to the document top-level `date` when the chart carries
// none) parses as a valid calendar day AND equals the current or previous
// Europe/Rome calendar day. Rationale: fp-crawler publishes once per day;
// just after midnight Rome the newest chart can still be yesterday's.
// Anything older than yesterday is stale; any future date is rejected
// (crawler clock error). `scraped_at_utc` and fetch/cache timestamps are
// NEVER used (no fetched-at laundering): a freshly fetched old chart — or
// a TTL-fresh cache hit of one — is still stale. Bounded: a chart is trusted
// at most ~48h past its date.
// ---------------------------------------------------------------------------

const FLIX_MONTH_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

export interface FlixChartDay {
  readonly year: number
  readonly month: number
  readonly day: number
}

/**
 * Parse an upstream fp-crawler chart date. The crawler emits English long
 * dates ("October 22, 2026", also in page_title and per-chart `date`
 * fields); ISO "YYYY-MM-DD" is accepted as a fallback. Anything else
 * (including non-strings) is invalid → null. The real calendar day is
 * validated (Feb 30 etc. rejected).
 */
export function parseFlixChartDate(raw: unknown): FlixChartDay | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  const long = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s)
  if (long) {
    const mi = FLIX_MONTH_INDEX[long[1].toLowerCase()]
    const d = Number(long[2])
    const y = Number(long[3])
    if (mi === undefined || !Number.isInteger(d) || d < 1 || d > 31) return null
    const dt = new Date(Date.UTC(y, mi, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mi || dt.getUTCDate() !== d) return null
    return { year: y, month: mi, day: d }
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (iso) {
    const y = Number(iso[1])
    const mi = Number(iso[2]) - 1
    const d = Number(iso[3])
    if (!Number.isInteger(y) || mi < 0 || mi > 11 || !Number.isInteger(d) || d < 1 || d > 31) return null
    const dt = new Date(Date.UTC(y, mi, d))
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mi || dt.getUTCDate() !== d) return null
    return { year: y, month: mi, day: d }
  }
  return null
}

/** Rome calendar day as a UTC day-number (deterministic, DST-safe). */
export function romeDayNumber(nowMs: number = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(nowMs)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ""
  return Math.floor(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))) / 86_400_000)
}

/**
 * True when a chart date is fresh per the bounded rule above: the chart-level
 * date wins; the document top-level date fills in only when the chart carries
 * none (absent/blank) — a present-but-unparseable chart date is stale, never
 * rescued by the document date. Anything unparseable (or a future day) fails.
 */
export function isFreshFlixChartDate(chartDateRaw: unknown, docDateRaw: unknown, nowMs: number = Date.now()): boolean {
  const blankChartDate = typeof chartDateRaw === "string" && chartDateRaw.trim() === ""
  const effective = blankChartDate || chartDateRaw === null || chartDateRaw === undefined ? docDateRaw : chartDateRaw
  const parsed = parseFlixChartDate(effective)
  if (!parsed) return false
  const chartDay = Math.floor(Date.UTC(parsed.year, parsed.month, parsed.day) / 86_400_000)
  const age = romeDayNumber(nowMs) - chartDay
  return age === 0 || age === 1
}

export type FlixMediaType = "movie" | "tv"

export interface FlixSideHit {
  readonly kind: "hit"
  readonly entries: CatalogEntry[]
}

export interface FlixSideMiss {
  readonly kind: "miss"
  /**
   * Why the side missed (structured outcome for fixed-cycle callers that
   * must distinguish outage/integrity failure from genuine absence):
   * - `absent`: no chart for this platform+category (e.g. overall-only
   *   platforms carry no movies/tv split) — genuine unavailable;
   * - `stale`: chart present but its date is stale/invalid — genuine
   *   unavailable for this cycle (never laundered as fresh);
   * - `invalid`: chart entries malformed (not an array, or a nonempty list
   *   with zero usable tmdbIds) — unusable source, NOT a genuine empty.
   * Legacy constructions without a reason keep the historic fail-open
   * meaning (treated as non-integrity misses by fixed-cycle callers).
   */
  readonly reason?: "absent" | "stale" | "invalid"
}

export type FlixSideResolution = FlixSideHit | FlixSideMiss

export interface FlixPlatformSidesResult {
  readonly movie: FlixSideResolution
  readonly tv: FlixSideResolution
  /**
   * Transport failure with no catalog document at all (fetch failed and no
   * cache to serve). Legacy callers surface `loadError` when no side
   * produced rows either (historical both-down throw contract).
   */
  readonly loadFailed: boolean
  readonly loadError?: unknown
  /**
   * The country document could not be used at all (malformed payload: not
   * an object with a `charts` array). Fixed-cycle callers with no JW
   * fallback must throw on this (integrity failure → retention), never
   * publish it as a genuine empty. FW/JW-fallback callers keep treating it
   * as a miss (JW owns the decision; only a JW failure on top throws).
   */
  readonly docInvalid?: boolean
}

export interface ResolveFlixSidesOptions {
  readonly minFetchedAtMs?: number
  readonly freshOrThrow?: boolean
  /** Clock override (tests); defaults to Date.now(). */
  readonly nowMs?: number
}

interface FlixDocLoad {
  readonly doc: CatalogData | null
  readonly loadFailed: boolean
  readonly loadError?: unknown
  /** The payload exists but is not a usable catalog document (integrity). */
  readonly docInvalid?: boolean
}

/**
 * Load ONE country catalog document (memory → disk → network, 12h TTL,
 * cycle-aware floor). Transport failures never throw here: with no document
 * they resolve to `loadFailed` (the caller falls back to JW and throws only
 * when JW fails too); a stale cached document is served fail-open for legacy
 * callers but reported as failed for strict ones (never laundered as fresh).
 * A malformed document is NOT an error here — it resolves to a miss (no
 * document), so the caller falls back to JW per media type; only a JW failure
 * on top of that throws downstream (both sources down).
 * A country-wide EMPTY document (`charts: []`) is quarantined (see
 * `isEmptyCountryDocument`): never trusted as data, never stored, never
 * overwriting a last-good cache — handling mirrors a transport failure with
 * the same previous state (last-good fail-open / retention when previous
 * data exists, miss + `docInvalid` for strict when cold), with retry after
 * a bounded 60s negative cooldown instead of the normal 12h success TTL.
 */
async function loadFlixCatalogDoc(country: string, minFetchedAtMs: number | undefined, freshOrThrow: boolean): Promise<FlixDocLoad> {
  const now = Date.now()
  const TWELVE_HOURS = 12 * 60 * 60 * 1000
  const freshSinceOk = (ts: number): boolean =>
    now - ts <= TWELVE_HOURS && (minFetchedAtMs === undefined || ts >= minFetchedAtMs)
  let cached = memCache.get(country)
  // Memoria stantia → prova il file su disco (fallback persistente) prima di rifare fetch.
  if (!cached?.catalog || (cached && !freshSinceOk(cached.timestamp))) {
    const disk = loadCache(country)
    if (disk.catalog && freshSinceOk(disk.timestamp)) {
      cached = disk
      memCache.set(country, cached)
    }
  }
  let catalog = cached?.catalog

  // Cycle-3: a cached malformed document must never serve as a successful
  // empty on the fixed-cycle path — treat it as a miss so the fetch below
  // runs (and throws when it cannot produce a valid document).
  const cachedValid = isValidFlixCatalogDoc(catalog)
  if (freshOrThrow && catalog && !cachedValid) {
    catalog = null
    cached = undefined
  }

  // Country-empty quarantine (memory + disk reads): a cached `charts: []`
  // document is never trusted as data. While the bounded negative cooldown
  // is active it reports unusable WITHOUT a refetch (no storm); once the
  // cooldown lapses the fetch below runs and a healthy payload heals the
  // cache — never a 12h wait for a suspicious observation. Last-good
  // timestamps are never touched here.
  if (catalog && isEmptyCountryDocument(catalog)) {
    if (now < (quarantineUntilMs.get(country) ?? 0)) {
      return { doc: null, loadFailed: false, docInvalid: true }
    }
    catalog = null
    cached = undefined
  }

  if (!catalog || (cached && !freshSinceOk(cached.timestamp))) {
    // Active-quarantine short-circuit: a refresh that the TTL/floor would
    // otherwise demand is suppressed while the negative cooldown runs, so
    // sequential same-country requests share one verdict (no storm) even
    // with a stale last-good. Strict mirrors retention (loadFailed with a
    // meaningful error); legacy mirrors fail-open (serves the retained
    // payload). Timestamps are never relabeled; TTL-fresh + floor-passing
    // good payloads serve normally below without reaching this branch.
    if (now < (quarantineUntilMs.get(country) ?? 0)) {
      const retained = cached?.catalog && !isEmptyCountryDocument(cached.catalog) ? cached : undefined
      if (retained) {
        if (freshOrThrow) {
          return {
            doc: null,
            loadFailed: true,
            loadError: new Error(`flixpatrol country document empty (quarantined): ${country}`),
          }
        }
        return { doc: retained.catalog, loadFailed: false }
      }
      return { doc: null, loadFailed: false, docInvalid: true }
    }
    try {
      const prevUsable = cached?.catalog && !isEmptyCountryDocument(cached.catalog) ? cached : undefined
      const fresh = await fetchCountryCoalesced(country)
      // Country-empty quarantine (network): a `charts: []` payload is never
      // stored and never overwrites a last-good country cache (memory + disk
      // payloads and timestamps untouched); only the bounded negative
      // cooldown is armed. Caller handling mirrors a transport failure with
      // the same previous state, reusing existing semantics instead of
      // inventing new ones: last-good fail-open / retention when previous
      // data exists, miss (+`docInvalid` for strict) when cold.
      if (isEmptyCountryDocument(fresh)) {
        quarantineUntilMs.set(country, now + QUARANTINE_NEGATIVE_TTL_MS)
        if (prevUsable) {
          if (freshOrThrow) {
            return {
              doc: null,
              loadFailed: true,
              loadError: new Error(`flixpatrol country document empty (quarantined): ${country}`),
            }
          }
          return { doc: prevUsable.catalog, loadFailed: false }
        }
        return { doc: null, loadFailed: false, docInvalid: true }
      }
      catalog = fresh
      cached = { catalog, timestamp: now }
      memCache.set(country, cached)
      saveCache(country, cached)
    } catch (e) {
      // Transport failure only (a malformed payload is handled as a miss
      // below, never thrown, so it can never be confused with this path).
      log.error("Failed to fetch fresh catalog", { error: e instanceof Error ? e.message : String(e), country })
      if (!catalog) return { doc: null, loadFailed: true, loadError: e }
      // Fixed-cycle renewal (freshOrThrow) forbids laundering a pre-floor stale catalog as a
      // fresh fetch — the caller routes to the JW fallback (failure retention: 60s gate,
      // old pin kept, no new generation) instead of publishing stale rows.
      // Legacy callers without the flag keep the stale fail-open fallback.
      if (freshOrThrow) return { doc: null, loadFailed: true, loadError: e }
      return { doc: catalog, loadFailed: false }
    }
    // Integrity boundary: a malformed payload — or a quarantined
    // country-wide empty (`charts: []`, handled above) — is a miss (no usable
    // document), not an error — the caller falls back to JW per media type
    // and only a JW failure on top throws downstream (both sources down,
    // never a fake empty). Legacy and strict share this outcome. The miss
    // carries `docInvalid` so fixed-cycle callers WITHOUT a JW fallback
    // can throw (integrity failure → retention) instead of publishing a
    // fake empty.
    if (!isValidFlixCatalogDoc(catalog)) {
      return { doc: null, loadFailed: false, docInvalid: true }
    }
  }
  return { doc: catalog ?? null, loadFailed: false }
}

function flixCategoryFor(mediaType: FlixMediaType): string {
  return mediaType === "movie" ? "movies" : "tv shows"
}

/**
 * Usability of ONE platform+country+media chart from an already-loaded
 * document (per-media independence: a fresh movies chart never suppresses
 * the series fallback or vice versa, and an opposite-side integrity failure
 * never blocks the requested side):
 * - no chart for the platform+category (including overall-only platforms
 *   such as Crunchyroll/hayu, which carry no movies/tv split) → miss
 *   (absence of a split is a fallback, never a genuine FP empty);
 * - chart present but date stale/invalid (chart-level `date`, else the
 *   document top-level `date`; cache hits gated exactly like network
 *   payloads) → miss;
 * - chart entries malformed (not an array, or a nonempty list with zero
 *   usable tmdbIds) → miss for THIS side only (the caller falls back to JW
 *   for this media; only a JW failure on top throws downstream — both
 *   sources down, never a fake empty);
 * - otherwise hit (possibly zero entries = genuine supported empty).
 *
 * Correction 1: integrity violations no longer throw per-side (strict or
 * legacy) — throwing here aborted the REQUESTED side when only the opposite
 * side was malformed, and threw before the strict JW fallback was ever
 * attempted. `freshOrThrow` is kept for signature compatibility and ignored.
 */
function resolveSideFromDoc(
  doc: CatalogData,
  platformName: string,
  mediaType: FlixMediaType,
  _freshOrThrow: boolean,
  nowMs: number,
): FlixSideResolution {
  const chart = doc.charts.find((c) => c.platform === platformName && c.category === flixCategoryFor(mediaType))
  if (!chart) return { kind: "miss", reason: "absent" }
  if (!isFreshFlixChartDate(chart.date, doc.date, nowMs)) return { kind: "miss", reason: "stale" }
  if (!Array.isArray(chart.entries)) {
    return { kind: "miss", reason: "invalid" }
  }
  // A nonempty collection with zero valid tmdb ids is unusable (provider
  // error), not an authoritative empty — fall back to JW for this side
  // instead of serving unresolvable rows (unreleased/dedup filtering happens
  // later, on real ids).
  if (chart.entries.length > 0 && !flixEntriesHaveValidId(chart.entries)) {
    return { kind: "miss", reason: "invalid" }
  }
  return { kind: "hit", entries: chart.entries }
}

/**
 * FP-first resolution of BOTH platform sides from a SINGLE catalog fetch.
 * Never touches JW: sides without a fresh usable chart resolve to miss so
 * the caller falls back to JW per media type (no blending within one chart).
 * Only programmer errors throw (unknown platform/country) — every data
 * problem (transport failure, absent split, stale/invalid date, malformed
 * document/entries, charts with zero usable tmdbIds) resolves to miss, even
 * strict; the caller throws only when the JW fallback fails too (both
 * sources down: failure retention). Each side resolves independently, so an
 * opposite-side failure never blocks a usable requested side. GLOBAL FP is
 * deliberately excluded by scope (the feed does publish a global.json, but
 * platform globals stay JW-only): both sides miss.
 */
export async function resolveFlixPlatformSides(
  platformSlug: string,
  country = "italy",
  opts?: ResolveFlixSidesOptions,
): Promise<FlixPlatformSidesResult> {
  const platformName = SLUG_TO_PLATFORM[platformSlug]
  if (!platformName) throw new Error(`Unknown platform: ${platformSlug}`)
  // Fail-closed: un paese fuori dalla lista non viene mai cercato su disco,
  // in cache o su rete.
  const globalChart = country === GLOBAL_REGION.flixSlug
  if (!globalChart && !SUPPORTED_COUNTRIES.has(country)) {
    throw new Error(`Unsupported country: ${country}`)
  }
  // GLOBAL FP is deliberately excluded by scope (the feed does publish a
  // global.json, but platform globals stay JW-only): never fill global ranks
  // here.
  if (globalChart) {
    return { movie: { kind: "miss" }, tv: { kind: "miss" }, loadFailed: false }
  }
  const freshOrThrow = opts?.freshOrThrow ?? false
  const nowMs = opts?.nowMs ?? Date.now()
  const loaded = await loadFlixCatalogDoc(country, opts?.minFetchedAtMs, freshOrThrow)
  if (!loaded.doc) {
    return { movie: { kind: "miss" }, tv: { kind: "miss" }, loadFailed: loaded.loadFailed, loadError: loaded.loadError, docInvalid: loaded.docInvalid }
  }
  // A malformed document is a miss for both sides (JW fallback owns the
  // decision; only a JW failure on top throws downstream) — never a throw
  // that would block a usable chart, and never a fake FP empty. Each side
  // below resolves independently in its own guard so an opposite-side
  // failure can never block the requested side.
  if (!isValidFlixCatalogDoc(loaded.doc)) {
    return { movie: { kind: "miss" }, tv: { kind: "miss" }, loadFailed: false, docInvalid: true }
  }
  let movie: FlixSideResolution
  let tv: FlixSideResolution
  try {
    movie = resolveSideFromDoc(loaded.doc, platformName, "movie", freshOrThrow, nowMs)
  } catch {
    movie = { kind: "miss", reason: "invalid" }
  }
  try {
    tv = resolveSideFromDoc(loaded.doc, platformName, "tv", freshOrThrow, nowMs)
  } catch {
    tv = { kind: "miss", reason: "invalid" }
  }
  return {
    movie,
    tv,
    loadFailed: false,
  }
}

// ---------------------------------------------------------------------------
// Generic opt-in charts (Task F): exact catalog_id resolution for ANY service
// id x chart-country slug x category x variant, without touching the legacy
// platform path above.
//
// Matching is strict: `catalog_id` must equal `${serviceId}.${catKey}` (base)
// or `${serviceId}.${catKey}-${variant}` (variant) case-insensitively, the
// chart `category` must equal the requested one (`movies` / `tv shows` /
// `overall`), and the normalized platform display name must equal the
// normalized service id (alnum-only compare, so "Hulu (Nippon)" matches
// "hulu-nippon" while "amazon" never collides with "amazon-prime" or
// "amazon-channels"). Freshness and integrity semantics mirror
// `resolveSideFromDoc`: absent split / stale date resolve to miss (genuine
// unavailable), malformed entries to miss+invalid (strict callers retain).
// ---------------------------------------------------------------------------

export type FlixGenericSection = "movies" | "series" | "all"

const GENERIC_FLEX_ID_TOKEN_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function normalizeFlixDisplayName(name: unknown): string {
  return typeof name === "string" ? name.toLowerCase().replace(/[^a-z0-9]/g, "") : ""
}

function flixCategoryForGenericSection(section: FlixGenericSection): { category: string; catKey: string } {
  if (section === "movies") return { category: "movies", catKey: "movies" }
  if (section === "series") return { category: "tv shows", catKey: "series" }
  return { category: "overall", catKey: "overall" }
}

export interface ResolveGenericFlixChartsOptions {
  readonly variant?: string | null
  readonly minFetchedAtMs?: number
  readonly nowMs?: number
}

/**
 * Resolve ONE generic chart from a fixed country document. Transport failures
 * resolve to `loadFailed` (never throw here — the caller owns the error
 * policy); an unsupported country slug throws (programmer error: catalog ids
 * are pre-validated against the same allowlist).
 */
export async function resolveGenericFlixCharts(
  serviceId: string,
  countrySlug: string,
  section: FlixGenericSection,
  opts?: ResolveGenericFlixChartsOptions,
): Promise<FlixSideResolution & { loadFailed: boolean; loadError?: unknown; docInvalid?: boolean }> {
  const svc = typeof serviceId === "string" ? serviceId.trim().toLowerCase() : ""
  const variantRaw = typeof opts?.variant === "string" ? opts.variant.trim().toLowerCase() : ""
  const variant = variantRaw || null
  if (!GENERIC_FLEX_ID_TOKEN_RE.test(svc) || svc.length > 64 || svc.includes("--")) {
    return { kind: "miss", reason: "absent", loadFailed: false }
  }
  if (variant && (!GENERIC_FLEX_ID_TOKEN_RE.test(variant) || variant.length > 64 || variant.includes("--"))) {
    return { kind: "miss", reason: "absent", loadFailed: false }
  }
  const globalChart = countrySlug === GLOBAL_REGION.flixSlug
  if (!globalChart && !SUPPORTED_COUNTRIES.has(countrySlug)) {
    throw new Error(`Unsupported country: ${countrySlug}`)
  }
  const loaded = await loadFlixCatalogDoc(countrySlug, opts?.minFetchedAtMs, false)
  if (!loaded.doc) {
    return { kind: "miss", loadFailed: loaded.loadFailed, loadError: loaded.loadError, docInvalid: loaded.docInvalid }
  }
  if (!isValidFlixCatalogDoc(loaded.doc)) {
    return { kind: "miss", loadFailed: false, docInvalid: true }
  }
  const nowMs = opts?.nowMs ?? Date.now()
  const { category, catKey } = flixCategoryForGenericSection(section)
  const wantCid = variant ? `${svc}.${catKey}-${variant}` : `${svc}.${catKey}`
  const normSvc = svc.replace(/[^a-z0-9]/g, "")
  const chart = loaded.doc.charts.find(
    (c) =>
      typeof c.catalog_id === "string" &&
      c.catalog_id.toLowerCase() === wantCid &&
      c.category === category &&
      normalizeFlixDisplayName(c.platform) === normSvc,
  )
  if (!chart) return { kind: "miss", reason: "absent", loadFailed: false }
  if (!isFreshFlixChartDate(chart.date, loaded.doc.date, nowMs)) return { kind: "miss", reason: "stale", loadFailed: false }
  if (!Array.isArray(chart.entries)) return { kind: "miss", reason: "invalid", loadFailed: false }
  if (chart.entries.length > 0 && !flixEntriesHaveValidId(chart.entries)) {
    return { kind: "miss", reason: "invalid", loadFailed: false }
  }
  return { kind: "hit", entries: chart.entries, loadFailed: false }
}

async function fetchPosterPath(tmdbId: number, mediaType: string, apiKey: string, tmdbLang = "it-IT"): Promise<string | null> {
  const primary = tmdbLang.slice(0, 2).toLowerCase()
  const url = `${TMDB_BASE}/${mediaType}/${tmdbId}/images?api_key=${apiKey}&include_image_language=${primary},en,null`
  try {
    const json = await tmdbCachedFetch(url) as { posters?: { iso_639_1: string | null; file_path: string }[] } | null
    if (!json) return null
    const posters = json.posters ?? []
    const langPoster = posters.find((p) => p.iso_639_1 === primary)
    const enPoster = primary === "en" ? undefined : posters.find((p) => p.iso_639_1 === "en")
    return langPoster?.file_path || enPoster?.file_path || null
  } catch {
    return null
  }
}

export async function getTop10(platformSlug: string, country = "italy", apiKey?: string, options?: { enrich?: boolean; minFetchedAtMs?: number; freshOrThrow?: boolean }): Promise<FlixPatrolTop10> {
  const platformName = SLUG_TO_PLATFORM[platformSlug]
  if (!platformName) throw new Error(`Unknown platform: ${platformSlug}`)
  // Fail-closed: un paese fuori dalla lista non viene mai cercato su disco,
  // in cache o su rete — evitiamo sia URL arbitrari (path traversal) sia il
  // vecchio comportamento che restituiva sempre dati italiani.
  const globalChart = country === GLOBAL_REGION.flixSlug
  if (!globalChart && !SUPPORTED_COUNTRIES.has(country)) {
    throw new Error(`Unsupported country: ${country}`)
  }
  // C6: enrich:false → nessuna chiamata TMDB per titolo (il catalogo Stremio
  // costruisce il poster via pictoriumPosterUrl e non usa né posterPath né il
  // titolo italiano: restituire la voce grezza taglia ~2 fetch TMDB × titolo).
  const enrich = options?.enrich ?? true

  const tmdbLang = globalChart ? GLOBAL_REGION.lang : tmdbLangForCountry(country)
  const minFetchedAtMs = options?.minFetchedAtMs
  const freshOrThrow = options?.freshOrThrow ?? false

  // FP-first (platform country charts only): both sides resolve from a SINGLE
  // catalog fetch (see resolveFlixPlatformSides). A fresh usable chart wins
  // with ZERO JW traffic; any other side (absent, stale/invalid, transport
  // failure, malformed, or zero usable tmdbIds) falls back to JW per media
  // type below (never blended within one chart). GLOBAL FP is deliberately
  // excluded by scope (the feed does publish a global.json, but platform
  // globals stay JW-only): sides stays null and the historical JW-only path
  // below applies.
  let sides: FlixPlatformSidesResult | null = null
  if (!globalChart) {
    sides = await resolveFlixPlatformSides(platformSlug, country, { minFetchedAtMs, freshOrThrow })
  }
  const fpMovieEntries = sides?.movie.kind === "hit" ? sides.movie.entries : null
  const fpTvEntries = sides?.tv.kind === "hit" ? sides.tv.entries : null

  const pkgs = PLATFORM_JW_PACKAGES[platformSlug]
  // JW fallback fetch (fail-open semantics, unchanged): the catalog fetch
  // above is live data, the shared 6h JW cache below is the fallback source.
  // Cycle-aware (fixed chart cycles): il floor forza il refresh in-slot delle
  // sorgenti JW condivise oltre il boundary. Sides with an FP hit reuse
  // their rows in the composition below, so no JW traffic is spent on them.
  const jwCode = globalChart ? GLOBAL_REGION.code : flixSlugToRegionCode(country)
  const needJwMovie = globalChart || !fpMovieEntries
  const needJwTv = globalChart || !fpTvEntries
  let jwMovies: JWRankEntry[] = []
  let jwShows: JWRankEntry[] = []
  // Strict both-fail signal: set when the JW fallback itself fails (not on a
  // successful empty) so a malformed/missing FP side plus a JW outage throws
  // instead of publishing a fake empty. Legacy stays fail-open.
  let jwFailed = false
  let jwError: unknown = null
  if (jwCode && pkgs && (needJwMovie || needJwTv)) {
    try {
      const [fetchedMovies, fetchedShows] = await Promise.all([
        needJwMovie ? getJWRankings("MOVIE", jwCode, 10, pkgs, tmdbLang, undefined, minFetchedAtMs) : [],
        needJwTv ? getJWRankings("SHOW", jwCode, 10, pkgs, tmdbLang, undefined, minFetchedAtMs) : [],
      ])
      jwMovies = fetchedMovies
      jwShows = fetchedShows
      // Se la classifica giornaliera JustWatch è scarsa (<5 titoli, es. RaiPlay),
      // arricchisce/ripiega sui titoli più popolari della piattaforma per garantire 10 voci.
      if (!globalChart && needJwMovie && jwMovies.length < 5) {
        try {
          const popMovies = await getJWTitles({
            objectType: "MOVIE",
            country: jwCode,
            first: 10,
            packages: pkgs,
            sortBy: "POPULAR",
            language: tmdbLang,
            minFetchedAtMs,
          })
          if (popMovies.length > 0) {
            jwMovies = popMovies.map((t, idx) => ({
              tmdbId: t.tmdbId,
              imdbId: t.imdbId,
              rank: idx + 1,
              title: t.title,
            }))
          }
        } catch {}
      }
      if (!globalChart && needJwTv && jwShows.length < 5) {
        try {
          const popShows = await getJWTitles({
            objectType: "SHOW",
            country: jwCode,
            first: 10,
            packages: pkgs,
            sortBy: "POPULAR",
            language: tmdbLang,
            minFetchedAtMs,
          })
          if (popShows.length > 0) {
            jwShows = popShows.map((t, idx) => ({
              tmdbId: t.tmdbId,
              imdbId: t.imdbId,
              rank: idx + 1,
              title: t.title,
            }))
          }
        } catch {}
      }
      // No early return here: FP-hit sides keep their rows in the composition
      // below even when JW has rows (the intentional priority flip); miss
      // sides reuse the JW rows fetched above.
    } catch (e) {
      jwFailed = true
      jwError = e
      log.error("JustWatch platform fetch failed, falling back to disk catalog", { error: e instanceof Error ? e.message : String(e), platform: platformSlug })
    }
  }

  const toJwItem = async (entry: JWRankEntry, type: "movie" | "tv", idx: number): Promise<FlixPatrolEnrichedItem> => {
    const tmdbId = entry.tmdbId
    let title = entry.title || ""
    let posterPath: string | null = null
    let releaseDate: string | null = null

    if (tmdbId && apiKey && enrich) {
      const detailsUrl = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${apiKey}&language=${tmdbLang}`
      const [fetchedPoster, details] = await Promise.all([
        fetchPosterPath(tmdbId, type, apiKey, tmdbLang),
        tmdbCachedFetch(detailsUrl) as Promise<{ title?: string; name?: string; release_date?: string; first_air_date?: string } | null>,
      ])
      posterPath = fetchedPoster
      if (details) {
        title = details.title || details.name || title
        releaseDate = details.release_date || details.first_air_date || releaseDate
      }
    }

    return {
      rank: idx + 1,
      title: title || (type === "movie" ? "Film" : "Serie TV"),
      tmdbId,
      mediaType: type,
      posterPath,
      releaseDate,
    }
  }

  // The fp-crawler document was already loaded once above
  // (resolveFlixPlatformSides: memory → disk → network, 12h TTL,
  // cycle-aware floor). The per-side composition below needs no second load.

  const toItem = async (entry: CatalogEntry, type: "movie" | "tv"): Promise<FlixPatrolEnrichedItem> => {
    const tmdbId = entry.tmdb?.id ?? null
    let title: string = entry.title
    let posterPath: string | null = null
    let releaseDate: string | null = entry.tmdb?.release_date ?? null

    if (tmdbId && apiKey && enrich) {
      const detailsUrl = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${apiKey}&language=${tmdbLang}`
      const [fetchedPoster, details] = await Promise.all([
        fetchPosterPath(tmdbId, type, apiKey, tmdbLang),
        tmdbCachedFetch(detailsUrl) as Promise<{ title?: string; name?: string; release_date?: string; first_air_date?: string } | null>,
      ])
      posterPath = fetchedPoster
      if (details) {
        title = details.title || details.name || title
        releaseDate = details.release_date || details.first_air_date || releaseDate
      }
    }

    return {
      rank: entry.rank,
      title,
      tmdbId,
      mediaType: type,
      posterPath,
      releaseDate,
    }
  }

  const dedupeEntries = (entries: CatalogEntry[]): CatalogEntry[] => {
    const seen = new Set<string>()
    const unique: CatalogEntry[] = []
    for (const e of entries) {
      const key = e.tmdb?.id ? `tmdb:${e.tmdb.id}` : `title:${e.title.toLowerCase().trim()}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(e)
    }
    return unique
  }

  // Per-side composition: FP-hit sides keep their rows (the intentional
  // priority flip); miss sides keep the JW fallback rows above — never
  // blended within one chart. A hit with zero entries is a genuine supported
  // empty (no JW fetch was spent on it).
  const [movies, tv] = await Promise.all([
    fpMovieEntries
      ? mapLimit(dedupeEntries(fpMovieEntries).slice(0, 10), ENRICH_CONCURRENCY, (e) => toItem(e, "movie"))
      : mapLimit<JWRankEntry, FlixPatrolEnrichedItem>(jwMovies.slice(0, 10), ENRICH_CONCURRENCY, (e, idx) => toJwItem(e, "movie", idx)),
    fpTvEntries
      ? mapLimit(dedupeEntries(fpTvEntries).slice(0, 10), ENRICH_CONCURRENCY, (e) => toItem(e, "tv"))
      : mapLimit<JWRankEntry, FlixPatrolEnrichedItem>(jwShows.slice(0, 10), ENRICH_CONCURRENCY, (e, idx) => toJwItem(e, "tv", idx)),
  ])

  // Both-down contract (non-GLOBAL): with no rows from any source AND a
  // failed source underneath, surface the error instead of an empty that
  // would read as a genuine chart. A transport failure with no catalog
  // document at all throws the load error (historical); a malformed/missing
  // FP side whose JW fallback ALSO failed throws the JW error — but only for
  // strict callers (failure retention + gate). A successful JW empty stays a
  // genuine empty, and legacy serving callers keep the fail-open path (their
  // own catch turns the throw into a short-lived empty).
  if (!globalChart && movies.length === 0 && tv.length === 0) {
    if (sides?.loadFailed) throw sides.loadError
    if (options?.freshOrThrow && jwFailed) throw jwError
  }

  return { platform: platformSlug, platformName, country, movies, tv }
}

export function getRawCatalog(country = "italy"): CatalogData | null {
  if (!SUPPORTED_COUNTRIES.has(country)) return null
  return loadCache(country).catalog
}

export function getSupportedPlatforms(): { slug: string; name: string }[] {
  return Object.entries(SLUG_TO_PLATFORM).map(([slug, name]) => ({ slug, name }))
}

export function getSupportedCountries(): string[] {
  return [...SUPPORTED_COUNTRIES].sort()
}

/** Fix L26: svuota le cache FlixPatrol (memoria + TMDB) per /api/cache/clear. */
export function __clearFlixpatrolCache(): void {
  memCache.clear()
  tmdbCache.clear()
  quarantineUntilMs.clear()
  fetchInflight.clear()
}
