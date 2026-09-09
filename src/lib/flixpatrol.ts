import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { getJWRankings, getJWTitles, PLATFORM_JW_PACKAGES, type JWRankEntry } from "@/lib/justwatch"
import { flixSlugToRegionCode, getRegionDef } from "@/lib/regions"

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

interface CatalogEntry {
  rank: number
  title: string
  tmdb: { id: number; media_type: string; release_date: string } | null
}

interface CatalogChart {
  catalog_id: string
  platform: string
  category: string
  entries: CatalogEntry[]
}

interface CatalogData {
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
  const res = await fetch(catalogUrl(country), { signal: AbortSignal.timeout(15000) })
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
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
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

export async function getTop10(platformSlug: string, country = "italy", apiKey?: string, options?: { enrich?: boolean }): Promise<FlixPatrolTop10> {
  const platformName = SLUG_TO_PLATFORM[platformSlug]
  if (!platformName) throw new Error(`Unknown platform: ${platformSlug}`)
  // Fail-closed: un paese fuori dalla lista non viene mai cercato su disco,
  // in cache o su rete — evitiamo sia URL arbitrari (path traversal) sia il
  // vecchio comportamento che restituiva sempre dati italiani.
  if (!SUPPORTED_COUNTRIES.has(country)) {
    throw new Error(`Unsupported country: ${country}`)
  }
  // C6: enrich:false → nessuna chiamata TMDB per titolo (il catalogo Stremio
  // costruisce il poster via pictoriumPosterUrl e non usa né posterPath né il
  // titolo italiano: restituire la voce grezza taglia ~2 fetch TMDB × titolo).
  const enrich = options?.enrich ?? true

  const pkgs = PLATFORM_JW_PACKAGES[platformSlug]
  // Fast-path JustWatch nella stessa regione del paese richiesto (prima solo
  // Italia): la classifica JW è live, il catalogo disco è il fallback.
  const jwCode = flixSlugToRegionCode(country)
  const tmdbLang = tmdbLangForCountry(country)
  if (jwCode && pkgs) {
    try {
      let [jwMovies, jwShows] = await Promise.all([
        getJWRankings("MOVIE", jwCode, 10, pkgs, tmdbLang),
        getJWRankings("SHOW", jwCode, 10, pkgs, tmdbLang),
      ])
      // Se la classifica giornaliera JustWatch è scarsa (<5 titoli, es. RaiPlay),
      // arricchisce/ripiega sui titoli più popolari della piattaforma per garantire 10 voci.
      if (jwMovies.length < 5) {
        try {
          const popMovies = await getJWTitles({
            objectType: "MOVIE",
            country: jwCode,
            first: 10,
            packages: pkgs,
            sortBy: "POPULAR",
            language: tmdbLang,
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
      if (jwShows.length < 5) {
        try {
          const popShows = await getJWTitles({
            objectType: "SHOW",
            country: jwCode,
            first: 10,
            packages: pkgs,
            sortBy: "POPULAR",
            language: tmdbLang,
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
      if (jwMovies.length > 0 || jwShows.length > 0) {
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

        const [movies, tv] = await Promise.all([
          mapLimit<JWRankEntry, FlixPatrolEnrichedItem>(jwMovies.slice(0, 10), ENRICH_CONCURRENCY, (e, idx) => toJwItem(e, "movie", idx)),
          mapLimit<JWRankEntry, FlixPatrolEnrichedItem>(jwShows.slice(0, 10), ENRICH_CONCURRENCY, (e, idx) => toJwItem(e, "tv", idx)),
        ])

        return { platform: platformSlug, platformName, country, movies, tv }
      }
    } catch (e) {
      log.error("JustWatch platform fetch failed, falling back to disk catalog", { error: e instanceof Error ? e.message : String(e), platform: platformSlug })
    }
  }

  const now = Date.now()
  const FOUR_HOURS = 4 * 60 * 60 * 1000
  let cached = memCache.get(country)
  // Memoria stantia → prova il file su disco (fallback persistente) prima di rifare fetch.
  if (!cached?.catalog || (cached && now - cached.timestamp > FOUR_HOURS)) {
    const disk = loadCache(country)
    if (disk.catalog && now - disk.timestamp <= FOUR_HOURS) {
      cached = disk
      memCache.set(country, cached)
    }
  }
  let catalog = cached?.catalog

  if (!catalog || (cached && now - cached.timestamp > FOUR_HOURS)) {
    try {
      catalog = await fetchCatalog(country)
      cached = { catalog, timestamp: now }
      memCache.set(country, cached)
      saveCache(country, cached)
    } catch (e) {
      log.error("Failed to fetch fresh catalog", { error: e instanceof Error ? e.message : String(e), country })
      if (!catalog) throw e
    }
  }

  // Fix L20: guardia sul catalogo corrotto/parziale — un JSON senza "charts"
  // (o con la piattaforma/categoria mancante) prima faceva lanciare
  // TypeError fuori dal try → 500 per l'intera route.
  const charts = Array.isArray(catalog?.charts) ? catalog.charts : []
  const movieChart = charts.find((c) => c.platform === platformName && c.category === "movies")
  const tvChart = charts.find((c) => c.platform === platformName && c.category === "tv shows")

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

  const [movies, tv] = await Promise.all([
    mapLimit(dedupeEntries(movieChart?.entries ?? []).slice(0, 10), ENRICH_CONCURRENCY, (e) => toItem(e, "movie")),
    mapLimit(dedupeEntries(tvChart?.entries ?? []).slice(0, 10), ENRICH_CONCURRENCY, (e) => toItem(e, "tv")),
  ])

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
}
