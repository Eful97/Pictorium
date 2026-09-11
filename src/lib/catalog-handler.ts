import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheGetShared, cacheSet } from "@/lib/cache"
import { getTop10 } from "@/lib/flixpatrol"
import { getServerDefaults } from "@/lib/server-defaults"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getById } from "@/lib/store"
import { decodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { getDetails, getDetailsWithExternalIds, getGenreList, getImages, personMovieCredits, personTvCredits, posterUrlOriginal, resolveRequestApiKey, searchMovies, searchPerson, searchTV, tmdbFindByImdb, type TMDBDetails } from "@/lib/tmdb"
import { resolveImdbId } from "@/lib/imdb-cache"
import { fetchMDBList } from "@/lib/mdblist"
import { fetchUnifiedCatalogItems } from "@/lib/custom-catalog-providers"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { getJWRankings, getJWTitles, resolveJWGenreCode, type JWRankEntry } from "@/lib/justwatch"
import { getRegionDef, normalizeRegion, parseRegion, type RegionDef } from "@/lib/regions"
import { getCatalogEpoch } from "@/lib/catalog-epoch"
import { createLogger } from "@/lib/logger"
import { concurrentMap } from "@/lib/episode-ordering"
import { isPersonQuery, pickTopPerson } from "@/lib/person-search"
import { normalizeCatalogId, normalizeCatalogIdKeys, normalizeCatalogIdList } from "@/lib/catalog-definitions"
import { envWithFallback } from "@/lib/env-compat"

const log = createLogger("catalog")

interface StremioMeta {
  id: string
  type: string
  name: string
  poster: string | null
  background?: string
  banner?: string
  logo?: string
  releaseInfo?: string
  imdbRating?: string
  genres?: string[]
  description?: string
  posterShape?: string
}

export interface CatalogExtraParams {
  search?: string
  skip?: number
  genre?: string
}

/**
 * Estrae parametri extra da Stremio (sia da segmenti di path es. `search=Avatar&skip=0.json`
 * sia da query string `?search=Avatar`).
 *
 * Bound anti cache-flood (C4): skip entra in chiaro nel cache key
 * (`:s${skip}` — ogni valore distinto = entry), search/genre viaggiano verso
 * gli upstream. Cap generosi, nessun client legittimo li supera (liste max
 * 500 item, query di ricerca e label genere corte).
 */
export const MAX_CATALOG_SKIP = 1000
export const MAX_CATALOG_SEARCH_LENGTH = 100
export const MAX_CATALOG_GENRE_LENGTH = 40

function clampCatalogSkip(parsed: number): number | undefined {
  if (Number.isNaN(parsed) || parsed < 0) return undefined
  return Math.min(Math.floor(parsed), MAX_CATALOG_SKIP)
}

export function parseCatalogExtra(
  extraSegments?: string[] | string | null,
  searchParams?: URLSearchParams | null,
): CatalogExtraParams {
  const result: CatalogExtraParams = {}

  if (searchParams) {
    const s = searchParams.get("search")
    if (s && s.trim()) result.search = s.trim().slice(0, MAX_CATALOG_SEARCH_LENGTH)
    const sk = searchParams.get("skip")
    if (sk) {
      const clamped = clampCatalogSkip(parseInt(sk, 10))
      if (clamped !== undefined) result.skip = clamped
    }
    const g = searchParams.get("genre")
    if (g && g.trim()) result.genre = g.trim().slice(0, MAX_CATALOG_GENRE_LENGTH)
  }

  if (extraSegments) {
    const rawList = Array.isArray(extraSegments) ? extraSegments : [extraSegments]
    for (const seg of rawList) {
      if (!seg) continue
      const cleaned = seg.replace(/\.json$/, "")
      const pairs = cleaned.split("&")
      for (const pair of pairs) {
        const eqIdx = pair.indexOf("=")
        if (eqIdx !== -1) {
          try {
            const key = decodeURIComponent(pair.slice(0, eqIdx))
            const val = decodeURIComponent(pair.slice(eqIdx + 1))
            if (key === "search" && val.trim()) {
              result.search = val.trim().slice(0, MAX_CATALOG_SEARCH_LENGTH)
            } else if (key === "skip") {
              const clamped = clampCatalogSkip(parseInt(val, 10))
              if (clamped !== undefined) result.skip = clamped
            } else if (key === "genre" && val.trim()) {
              result.genre = val.trim().slice(0, MAX_CATALOG_GENRE_LENGTH)
            }
          } catch {
            // Ignora frammenti non decodificabili
          }
        }
      }
    }
  }

  return result
}

/** Riutilizza getJWRankings (cache condivisa 30 min + mock server nei test).
 *  Ritorna le righe complete: JustWatch fornisce già l'imdbId, così il
 *  catalogo non deve rifare una chiamata extra a TMDB per ogni titolo. */
async function getJustWatchRankings(
  type: "MOVIE" | "SHOW",
  country = "IT",
  first = 20,
  packages?: readonly string[] | string[],
  language = "it-IT",
): Promise<JWRankEntry[]> {
  try {
    return await getJWRankings(type, country, first, packages, language)
  } catch {
    return []
  }
}

/** Hash breve e stabile di una chiave per i cache key — mai il frammento grezzo. */
function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8)
}

const PLATFORM_JW_PACKAGES: Record<string, string[]> = {
  netflix: ["nfx"],
  prime: ["prv"],
  disney: ["dnp"],
  now: ["ntv", "skg"],
  apple: ["atp"],
  hbo: ["mxx"],
  paramount: ["pmp"],
  crunchyroll: ["cru"],
}

const PLATFORM_SLUGS: Record<string, string> = {
  netflix: "netflix", prime: "amazon-prime", disney: "disney",
  now: "now",
  apple: "apple-tv", hbo: "hbo-max", paramount: "paramount-plus",
  crunchyroll: "crunchyroll",
}

type StremioCatalogType = "movie" | "series"

function catalogResponse(body: { metas: StremioMeta[] }, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-cache, max-age=0, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

/**
 * Tipi catalogo riconosciuti (C4): movie + famiglia tv/series + varianti anime
 * di Stremio. Qualsiasi altro (es. `/catalog/garbage/...`) prima veniva
 * servito silenziosamente come series — ora null e la route risponde 400.
 */
const KNOWN_CATALOG_TYPES = new Set([
  "movie", "series", "tv", "show", "tvshow", "anime.movie", "anime.series", "anime",
])

function normalizeCatalogType(type: string): StremioCatalogType | null {
  const t = type.toLowerCase()
  if (!KNOWN_CATALOG_TYPES.has(t)) return null
  return (t === "movie" || t === "anime.movie") ? "movie" : "series"
}

/**
 * ID catalogo riconosciuti (C4): built-in + custom dinamici (`pictorium-custom-`,
 * risolti contro userConfig) + ricerca. Gli ID ignoti prima producevano
 * `metas:[]` cachato 60s (riempimento cache su enumerazione) — ora 404 senza
 * scrittura in cache. Il confronto usa l'ID già normalizzato (alias legacy).
 */
function isKnownCatalogId(catalogId: string): boolean {
  if (
    catalogId.startsWith("pictorium-search-") ||
    catalogId.startsWith("pictorium-custom-") ||
    catalogId.startsWith("pictorium-jw") ||
    catalogId.startsWith("pictorium-anime")
  ) return true
  for (const k of Object.keys(PLATFORM_SLUGS)) {
    if (catalogId === `pictorium-${k}-movies` || catalogId === `pictorium-${k}-series`) return true
  }
  return false
}

/**
 * Regione del catalogo: `?region=` (alias `?country=`) > config-token `region` >
 * default server (`PICTORIUM_REGION` o salvato) > IT. Accetta sia codici JW
 * ("US") che slug FlixPatrol ("united-states"), fail-closed su IT.
 */
export function resolveCatalogRegion(req: NextRequest, userConfig: Partial<PictoriumUserConfig> | null): RegionDef {
  const fromQuery = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  if (fromQuery) return getRegionDef(fromQuery)
  const fromConfig = parseRegion((userConfig as { region?: string } | null)?.region)
  if (fromConfig) return getRegionDef(fromConfig)
  return getRegionDef(normalizeRegion(getServerDefaults().region))
}

// La chiave MDBList della richiesta resta SOLO server-side (fetch rank/voti
// al momento del catalogo): non entra mai nel poster URL (M2 — finirebbe nel
// DB Stremio/log/proxy). Il poster risolve il rank via `animerank` incorporato
// o fallback d'istanza/mapping.
async function pictoriumPosterUrl(req: NextRequest, type: "movie" | "series", id: number, configParam?: string | null, userParam?: string | null, animeRankParam?: number | null, posterLang = "it", posterRegion?: string | null): Promise<string> {
  const serverDefaults = getServerDefaults()
  const userConfig = configParam ? decodeConfig(configParam) : null
  const defaults = userConfig ? { ...serverDefaults, ...userConfig } : serverDefaults
  const mapping = await getById(type === "series" ? "tv" : "movie", id)
  return buildStremioPosterUrl({
    origin: getOriginFromRequest(req),
    type,
    id,
    defaults,
    mapping,
    lang: posterLang,
    region: posterRegion || undefined,
    config: configParam || undefined,
    user: userParam || undefined,
    animerank: animeRankParam ?? undefined,
  }).toString()
}

function catalogBackground(backdropPath: string | null | undefined): string | undefined {
  return backdropPath ? posterUrlOriginal(backdropPath) : undefined
}

/**
 * Mappa genre_ids → nomi localizzati per le righe di ricerca (TMDB `/genre/list`).
 * La risposta è cachata da tmdbFetch (LRU 5 min) ed è condivisa tra richieste;
 * in caso di errore degrada a mappa vuota (righe senza generi).
 */
async function tmdbGenreNames(stType: "movie" | "series", apiKey?: string, lang = "it-IT"): Promise<Map<number, string>> {
  try {
    const list = await getGenreList(stType === "movie" ? "movie" : "tv", lang, apiKey)
    return new Map((list.genres || []).map((g) => [g.id, g.name]))
  } catch {
    return new Map()
  }
}

/**
 * Le opzioni `genre` del manifest sono etichette fisse italiane/inglesi
 * (build-manifest: MOVIE_GENRES / SERIES_GENRES / ANIME_GENRES), identiche per
 * ogni regione. I `genres` dei meta arrivano invece da TMDB nella lingua della
 * regione: con IT combaciavano per costruzione, ma con he-IL (o ja-JP, ko-KR,
 * de-DE...) il confronto per sottostringa non trova nulla e il catalogo
 * filtrato per genere torna VUOTO. Questa tabella riporta l'etichetta del
 * manifest all'id TMDB, così il nome localizzato si ricava dalla /genre/list
 * già in cache e il confronto avviene nella lingua giusta.
 */
const MANIFEST_GENRE_TMDB_IDS: Record<string, number> = {
  azione: 28, avventura: 12, animazione: 16, commedia: 35, crime: 80,
  documentario: 99, dramma: 18, famiglia: 10751, fantascienza: 878,
  fantasy: 14, guerra: 10752, horror: 27, mistero: 9648, musica: 10402,
  romance: 10749, storia: 36, thriller: 53, western: 37,
  "action & adventure": 10759, family: 10751, kids: 10762, news: 10763,
  reality: 10764, "sci-fi & fantasy": 10765, soap: 10766, talk: 10767,
  "war & politics": 10768,
}

function genreNamesFromIds(genreIds: number[] | undefined, genreNames: Map<number, string>): string[] | undefined {
  if (!genreIds || genreIds.length === 0) return undefined
  const names = genreIds.map((gid) => genreNames.get(gid)).filter((g): g is string => !!g)
  return names.length > 0 ? names : undefined
}

async function catalogLogo(mediaType: "movie" | "tv", tmdbId: number, apiKey?: string, tmdbLang = "it-IT"): Promise<string | undefined> {
  // A5: memo 24h (hit) / 1h (miss). Il logo in catalogo è richiesto per ogni
  // item a ogni catalogo freddo (fino a 3N upstream con details+externalIds):
  // i path TMDB sono immutabili, quindi l'hit vale 24h; il miss solo 1h così
  // un logo aggiunto su TMDB viene scoperto entro l'ora. Wrapper oggetto
  // perché cacheGet segnala il miss con null (un null cachato sarebbe
  // indistinguibile). La chiave esclude l'api_key (non influisce sul payload).
  // Solo gli esiti certi vanno in memo: su eccezione (timeout/rate-limit) non
  // si cacha, così un errore transient non oscura il logo per un'ora.
  const primary = tmdbLang.slice(0, 2).toLowerCase()
  const memoKey = `catalog:logo:${mediaType}:${tmdbId}:${primary}`
  const memo = cacheGet<{ logo: string | null }>(memoKey)
  if (memo) return memo.logo ?? undefined
  try {
    // D4: tetto 1500ms (prima 2500). Il logo in catalogo è guarnizione: su
    // cold catalog 20 loghi × coda/concorrenza 5 valgono secondi di route
    // (maxDuration 60). Oltre il tetto → undefined, il poster resta completo.
    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(1500) : undefined
    const images = await getImages(mediaType, tmdbId, `${primary},en,null`, apiKey, signal)
    if (images?.logos && images.logos.length > 0) {
      const itLogo = images.logos.find((l) => l.iso_639_1 === primary) || images.logos[0]
      if (itLogo?.file_path) {
        const logoUrl = posterUrlOriginal(itLogo.file_path)
        cacheSet(memoKey, { logo: logoUrl }, ["catalog", "tmdb"], 24 * 60 * 60 * 1000)
        return logoUrl
      }
    }
    cacheSet(memoKey, { logo: null }, ["catalog", "tmdb"], 60 * 60 * 1000)
  } catch {
    // logo opzionale — ignora errori (rate limit, 404, timeout)
  }
  return undefined
}



/**
 * ID del catalogo Stremio: esponendo l'id provider (`tmdb:<id>`), Stremio
 * interroga direttamente Pictorium per la risorsa `meta` invece di delegare a Cinemeta,
 * permettendo la gestione autonoma di loghi, trame e ordinamento parti/stagioni.
 */
function catalogMetaId(_imdbId: string | null | undefined, tmdbId: number): string {
  return `tmdb:${tmdbId}`
}

/**
 * Risposta catalogo Stremio. Il profilo arriva da query (`?u=`) o dal path
 * (`/u/<uuid>/catalog/...`): il parametro è esplicito così entrambi i route
 * condividono la stessa logica.
 */
export async function pictoriumCatalog(
  req: NextRequest,
  mediaType: string,
  rawId: string,
  userParam: string | null,
  configParam: string | null,
  extraSegments?: string[] | string | null,
): Promise<Response> {
  const rl = await rateLimit(rateLimitKey(req), "catalog")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  // Alias legacy: gli addon Stremio installati prima del rename usano ID
  // `posterium-*` — vengono normalizzati al canonico `pictorium-*`.
  const catalogId = normalizeCatalogId(rawId.replace(/\.json$/, ""))
  if (catalogId.length > 80) return catalogResponse({ metas: [] })
  // C4: tipo ignoto → 400 invece di servire silenziosamente dati series.
  const stType = normalizeCatalogType(mediaType)
  if (!stType) return catalogResponse({ metas: [] }, 400)
  const extra = parseCatalogExtra(extraSegments, req.nextUrl.searchParams)
  const mdblistKeyParam = req.nextUrl.searchParams.get("mdblist_key") || undefined
  // Chiave TMDB della richiesta: parte del cache key così un catalogo vuoto
  // servito a una richiesta senza chiave non avvelena quelle keyed (D3).
  const apiKey = resolveRequestApiKey(req)
  // Chiave MDBList della richiesta (anime/custom): parametro esplicito o, come
  // fallback per istanze personali, env PICTORIUM_MDBLIST_KEY. Il param `?u=`
  // NON fornisce chiavi (solo identità/tracking).
  const mdblistKey = mdblistKeyParam || envWithFallback("MDBLIST_KEY")
  let userConfig: Partial<PictoriumUserConfig> | null = null
  if (configParam) {
    userConfig = decodeConfig(configParam)
  }
  if (!userConfig) {
    const serverDefaults = getServerDefaults()
    userConfig = {
      disabledCatalogIds: serverDefaults.disabledCatalogIds,
      customCatalogs: serverDefaults.customCatalogs,
      catalogRenames: serverDefaults.catalogRenames,
      catalogOrder: serverDefaults.catalogOrder,
    } as PictoriumUserConfig
  }
  // Config salvate prima del rename possono contenere ID `pictorium-*`:
  // normalizza al canonico `pictorium-*` così filtri/ordini/rinomine restano validi.
  userConfig.disabledCatalogIds = normalizeCatalogIdList(userConfig.disabledCatalogIds)
  userConfig.catalogOrder = normalizeCatalogIdList(userConfig.catalogOrder)
  userConfig.catalogRenames = normalizeCatalogIdKeys(userConfig.catalogRenames)
  // Epoch globale + hash dei server defaults: frammenti di freschezza per TUTTI
  // i cache key di questo handler (ricerche + catalogo). Su deploy
  // multi-istanza la `cacheInvalidate("stremio")` del save non raggiunge le
  // altre istanze — senza questi frammenti un body cachato (con vecchi poster
  // URL) resterebbe servito fino al refresh schedulato (~24h). Ogni save
  // (mapping/defaults) fa bump dell'epoch.
  const epoch = await getCatalogEpoch()
  const sdHash = hashFragment(JSON.stringify(getServerDefaults()))
  const freshness = `:e${epoch}:sd${sdHash}`
  // Regione classifiche (JustWatch + FlixPatrol) e lingua titoli: entra in ogni
  // cache key così cataloghi di paesi diversi non si avvelenano a vicenda.
  const region = resolveCatalogRegion(req, userConfig)
  const tmdbLang = region.lang
  const posterLang = tmdbLang.slice(0, 2).toLowerCase()
  const regionFragment = `:r${region.code}`

  // --- Gestione Ricerca Stremio (sia via barra di ricerca che catalogo dedicato) ---
  if (extra.search) {
    const isPeopleCatalog = catalogId.startsWith("pictorium-search-people-")
    if (isPeopleCatalog) {
      if (!apiKey) return catalogResponse({ metas: [] })
      const page = Math.floor((extra.skip || 0) / 20) + 1
      const searchCacheKey = `stremio:search:people:${stType}:${hashFragment(extra.search)}:p${page}:pv${POSTER_URL_VERSION}${userParam ? `:u${hashFragment(userParam)}` : ""}:ak${hashFragment(apiKey)}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${regionFragment}${freshness}`
      const cachedSearch = cacheGet<{ metas: StremioMeta[] }>(searchCacheKey)
      if (cachedSearch) return catalogResponse(cachedSearch)

      if (!isPersonQuery(extra.search)) {
        const body = { metas: [] as StremioMeta[] }
        cacheSet(searchCacheKey, body, ["stremio", "search"], 60_000)
        return catalogResponse(body)
      }

      try {
        const personRes = await searchPerson(extra.search, tmdbLang, apiKey, page)
        const candidates = personRes?.results || []
        const topPerson = pickTopPerson(candidates, extra.search)
        if (!topPerson) {
          const body = { metas: [] as StremioMeta[] }
          cacheSet(searchCacheKey, body, ["stremio", "search"], 60_000)
          return catalogResponse(body)
        }

        const credits = stType === "movie"
          ? await personMovieCredits(topPerson.id, tmdbLang, apiKey)
          : await personTvCredits(topPerson.id, tmdbLang, apiKey)

        const allCredits = [...(credits.cast || []), ...(credits.crew || [])]
        const seen = new Map<number, typeof allCredits[number]>()
        for (const item of allCredits) {
          if (!item || !item.id || seen.has(item.id)) continue
          // credits for movie endpoint are movies, tv endpoint are shows — but filter by media_type if present
          const mt = (item.media_type as string | undefined) || (stType === "movie" ? "movie" : "tv")
          if (stType === "movie" && mt !== "movie") continue
          if (stType === "series" && mt !== "tv" && mt !== "series") continue
          seen.set(item.id, item)
        }

        // Ordina per popolarità decrescente se disponibile, altrimenti mantieni ordine crediti
        const deduped = Array.from(seen.values()).sort((a, b) => {
          const pa = (a as unknown as { popularity?: number }).popularity || 0
          const pb = (b as unknown as { popularity?: number }).popularity || 0
          return pb - pa
        })

        const skip = extra.skip || 0
        const paged = deduped.slice(skip, skip + 20)
        const genreNames = await tmdbGenreNames(stType, apiKey, tmdbLang)

        const results: (StremioMeta | null)[] = await concurrentMap(paged, async (item) => {
          if (!item.id) return null
          const imdbId = await resolveImdbId(stType === "movie" ? "movie" : "tv", item.id, apiKey)
          const poster = await pictoriumPosterUrl(req, stType, item.id, configParam, userParam, undefined, posterLang, region.code)
          const releaseInfo = (item.release_date || item.first_air_date || "").slice(0, 4) || undefined
          return {
            id: catalogMetaId(imdbId, item.id),
            type: stType,
            name: item.title || item.name || "",
            poster,
            background: catalogBackground(item.backdrop_path),
            releaseInfo,
            imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
            genres: genreNamesFromIds(item.genre_ids, genreNames),
            description: item.overview ?? undefined,
          }
        }, 5)
        const metas = results.filter((m): m is StremioMeta => m !== null)
        const body = { metas }
        cacheSet(searchCacheKey, body, ["stremio", "search"], 10 * 60 * 1000)
        return catalogResponse(body)
      } catch (e) {
        log.error("People search failed", { error: e instanceof Error ? e.message : String(e) })
        return catalogResponse({ metas: [] })
      }
    }

    if (!apiKey) return catalogResponse({ metas: [] })
    const page = Math.floor((extra.skip || 0) / 20) + 1
    const searchCacheKey = `stremio:search:${stType}:${hashFragment(extra.search)}:p${page}:pv${POSTER_URL_VERSION}${userParam ? `:u${hashFragment(userParam)}` : ""}:ak${hashFragment(apiKey)}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${regionFragment}${freshness}`
    const cachedSearch = cacheGet<{ metas: StremioMeta[] }>(searchCacheKey)
    if (cachedSearch) return catalogResponse(cachedSearch)

    try {
      const searchRes = stType === "movie"
        ? await searchMovies(extra.search, tmdbLang, apiKey, page)
        : await searchTV(extra.search, tmdbLang, apiKey, page)

      const items = (searchRes?.results || []).slice(0, 20)

      const genreNames = await tmdbGenreNames(stType, apiKey, tmdbLang)
      const results: (StremioMeta | null)[] = await concurrentMap(items, async (item) => {
        if (!item.id) return null
        const imdbId = await resolveImdbId(stType === "movie" ? "movie" : "tv", item.id, apiKey)
        const poster = await pictoriumPosterUrl(req, stType, item.id, configParam, userParam, undefined, posterLang, region.code)
        const releaseInfo = (item.release_date || item.first_air_date || "").slice(0, 4) || undefined
        return {
          id: catalogMetaId(imdbId, item.id),
          type: stType,
          name: item.title || item.name || "",
          poster,
          background: catalogBackground(item.backdrop_path),
          releaseInfo,
          imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined,
          genres: genreNamesFromIds(item.genre_ids, genreNames),
          description: item.overview ?? undefined,
        }
      }, 5)
      const metas = results.filter((m): m is StremioMeta => m !== null)
      const body = { metas }
      cacheSet(searchCacheKey, body, ["stremio", "search"], 10 * 60 * 1000)
      return catalogResponse(body)
    } catch (e) {
      log.error("Search failed", { error: e instanceof Error ? e.message : String(e) })
      return catalogResponse({ metas: [] })
    }
  }

  // Se è un catalogo di ricerca dedicato ma non è stata passata alcuna query
  if (catalogId.startsWith("pictorium-search-")) {
    return catalogResponse({ metas: [] })
  }

  // C4: ID non riconosciuto → 404 SENZA scrittura in cache. Prima produceva
  // `metas:[]` cachato 60s: enumerazione di skip/search/genre riempiva la
  // cache (MAX_ENTRIES) di spazzatura.
  if (!isKnownCatalogId(catalogId)) {
    return catalogResponse({ metas: [] }, 404)
  }

  const skipFragment = typeof extra.skip === "number" && extra.skip > 0 ? `:s${extra.skip}` : ""
  const genreFragment = extra.genre && extra.genre !== "Tutti" ? `:g${hashFragment(extra.genre)}` : ""
  const cacheKey = `stremio:catalog:v2:${stType}:${catalogId}:pv${POSTER_URL_VERSION}${userParam ? `:u${hashFragment(userParam)}` : ""}:ak${apiKey ? hashFragment(apiKey) : "none"}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${genreFragment}${skipFragment}${regionFragment}${freshness}`
  // C1: L1 + L2 condivisa (KV su multi-istanza, no-op locale/VPS).
  const cached = await cacheGetShared<{ metas: StremioMeta[] }>(cacheKey, ["stremio", "catalog"])
  if (cached) return catalogResponse(cached)

  let isCustomGenreFiltered = false

  try {
    let metas: StremioMeta[] = []

    if (catalogId.startsWith("pictorium-custom-")) {
      let customId = catalogId.replace(/^pictorium-custom-/, "")
      if (customId.startsWith("movie-")) customId = customId.slice(6)
      else if (customId.startsWith("series-")) customId = customId.slice(7)

      const customCat = userConfig?.customCatalogs?.find((c: { id: string }) => c.id === customId)
      if (customCat && customCat.enabled !== false) {
        let items = await fetchUnifiedCatalogItems(customCat.url, { apiKey, mdblistKey, limit: 500 })
        // Se la lista è mista o contiene mediatype, filtra in base al tipo di catalogo richiesto
        if (customCat.type === "mixed") {
          if (stType === "movie") {
            items = items.filter((it) => it.mediatype !== "show" && it.mediatype !== "tv" && it.mediatype !== "anime")
          } else {
            items = items.filter((it) => it.mediatype !== "movie")
          }
        }

        const seenTmdb = new Set<number>()
        const validItems: typeof items = []
        for (const item of items) {
          let tmdbId = Number(item.tmdb)
          if (!tmdbId && item.imdb && apiKey) {
            tmdbId = await tmdbFindByImdb(item.imdb, stType === "movie" ? "movie" : "tv", apiKey) || 0
            item.tmdb = tmdbId
          }
          if (tmdbId && !seenTmdb.has(tmdbId)) {
            seenTmdb.add(tmdbId)
            validItems.push(item)
          }
        }

        const skip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
        isCustomGenreFiltered = !!(extra.genre && extra.genre !== "Tutti")
        // Ottimizzazione I/O: se non c'è filtro genere, arricchisce solo la finestra richiesta (20 item)
        const pagedItems = isCustomGenreFiltered ? validItems.slice(0, 100) : validItems.slice(skip, skip + 20)
        const rankOffset = isCustomGenreFiltered ? 0 : skip

        const results = await concurrentMap(pagedItems, async (item, idx) => {
          const tmdbId = Number(item.tmdb)
          if (!tmdbId) return null
          let details: TMDBDetails | null = null
          if (apiKey) {
            try {
              details = await getDetails(stType === "movie" ? "movie" : "tv", tmdbId, tmdbLang, apiKey)
            } catch {
              details = null
            }
          }
          const title = details?.title || details?.name || item.title || "Titolo"
          const releaseInfo = (details?.release_date || details?.first_air_date || (item.year ? String(item.year) : "")).slice(0, 4) || undefined
          return {
            tmdbId,
            imdb: item.imdb,
            title,
            releaseInfo,
            rank: rankOffset + idx + 1,
            genres: (details?.genres || []).map((g) => g.name).filter(Boolean),
            backdropPath: details?.backdrop_path ?? null,
            description: details?.overview ?? undefined,
            voteAverage: details?.vote_average ?? undefined,
          }
        }, 5)
        const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null)
        metas = await concurrentMap(validResults, async (r) => {
          const [imdbId, poster, logo] = await Promise.all([
            r.imdb ? Promise.resolve(r.imdb) : resolveImdbId(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey),
            pictoriumPosterUrl(req, stType, r.tmdbId, configParam, userParam, r.rank, posterLang, region.code),
            apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
          ])
          const background = catalogBackground(r.backdropPath)
          return {
            id: catalogMetaId(imdbId, r.tmdbId),
            type: stType,
            name: r.title,
            poster,
            background,
            banner: background,
            logo,
            releaseInfo: r.releaseInfo,
            imdbRating: r.voteAverage ? r.voteAverage.toFixed(1) : undefined,
            genres: r.genres,
            description: r.description,
          }
        }, 5)
      }
    } else if (catalogId.startsWith("pictorium-jw")) {
      // Fix L12: la chiave si controlla PRIMA del fetch JustWatch
      if (!apiKey) return catalogResponse({ metas: [] })
      // streamingCharts non supporta `offset`: l'overfetch da zero + slice è
      // l'unico modo per paginare (l'arricchimento TMDB resta comunque sui 20
      // della finestra). popularTitles invece pagina nativo: first = finestra.
      const jwSkip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
      const jwGenre = resolveJWGenreCode(extra.genre)
      const jwFirst = jwGenre ? 20 : Math.min(60, 20 + jwSkip)
      const rows = jwGenre
        ? await getJWTitles({
            objectType: stType === "movie" ? "MOVIE" : "SHOW",
            country: region.code,
            first: jwFirst,
            offset: jwSkip,
            genres: [jwGenre],
            sortBy: "POPULAR",
            language: tmdbLang,
          })
        : await getJustWatchRankings(stType === "movie" ? "MOVIE" : "SHOW", region.code, jwFirst, undefined, tmdbLang)

      const seenTmdb = new Set<number>()
      const uniqueRows = rows.filter((r) => {
        if (!r.tmdbId || seenTmdb.has(r.tmdbId)) return false
        seenTmdb.add(r.tmdbId)
        return true
      }).slice(jwGenre ? 0 : jwSkip, (jwGenre ? 0 : jwSkip) + 20)

      const results = await concurrentMap(uniqueRows, async (row) => {
        try {
          // D4: external_ids in append — niente secondo fetch per-titolo.
          const d = await getDetailsWithExternalIds(stType === "movie" ? "movie" : "tv", row.tmdbId, tmdbLang, apiKey)
          if (!d?.id) return null
          return { d, tmdbId: row.tmdbId, imdbId: row.imdbId }
        } catch {
          return null
        }
      }, 5)
      const validResults = results.filter((r): r is { d: TMDBDetails; tmdbId: number; imdbId: string | null } => r !== null)
      metas = await concurrentMap(validResults, async (r) => {
        const [imdbId, poster, logo] = await Promise.all([
          r.imdbId || r.d.external_ids?.imdb_id || null,
          pictoriumPosterUrl(req, stType, r.tmdbId, configParam, userParam, undefined, posterLang, region.code),
          apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
        ])
        const background = catalogBackground(r.d.backdrop_path)
        return {
          id: catalogMetaId(imdbId, r.tmdbId),
          type: stType,
          name: r.d.title || r.d.name || "",
          poster,
          background,
          banner: background,
          logo,
          releaseInfo: (r.d.release_date || r.d.first_air_date || "").slice(0, 4) || undefined,
          imdbRating: r.d.vote_average ? r.d.vote_average.toFixed(1) : undefined,
          genres: (r.d.genres || []).map((g) => g.name).filter(Boolean),
          description: r.d.overview ?? undefined,
        }
      }, 5)
    } else if (catalogId.startsWith("pictorium-anime")) {
      const isMovie = catalogId === "pictorium-anime-movies" || stType === "movie"
      const listKey = isMovie ? "mdblistAnimeMovie" : "mdblistAnime"
      const mediaType = isMovie ? "movie" : "tv"
      const items = await fetchMDBList(listKey, mdblistKey)

      const seenTmdb = new Set<number>()
      const results = await concurrentMap(items, async (item, idx) => {
        let tmdbId = Number(item.tmdb)
        if (!tmdbId && item.imdb && apiKey) {
          tmdbId = await tmdbFindByImdb(item.imdb, mediaType, apiKey) || 0
        }
        if (!tmdbId || seenTmdb.has(tmdbId)) return null
        seenTmdb.add(tmdbId)

        let d: TMDBDetails | null = null
        if (apiKey) {
          try {
            d = await getDetails(mediaType, tmdbId, tmdbLang, apiKey)
          } catch {
            d = null
          }
        }
        const name = d?.title || d?.name || item.title || "Anime"
        const releaseInfo = (d?.release_date || d?.first_air_date || (item.year ? String(item.year) : "")).slice(0, 4) || undefined
        return {
          tmdbId,
          imdb: item.imdb,
          name,
          releaseInfo,
          rank: idx + 1,
          genres: (d?.genres || []).map((g) => g.name).filter(Boolean),
          backdropPath: d?.backdrop_path ?? null,
          description: d?.overview ?? undefined,
          voteAverage: d?.vote_average ?? undefined,
        }
      }, 5)
      const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null).slice(0, 20)
      metas = await concurrentMap(validResults, async (r) => {
        const [imdbId, poster, logo] = await Promise.all([
          r.imdb ? Promise.resolve(r.imdb) : resolveImdbId(mediaType, r.tmdbId, apiKey),
          pictoriumPosterUrl(req, stType, r.tmdbId, configParam, userParam, r.rank, posterLang, region.code),
          apiKey ? catalogLogo(mediaType, r.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
        ])
        const background = catalogBackground(r.backdropPath)
        return {
          id: catalogMetaId(imdbId, r.tmdbId),
          type: stType,
          name: r.name,
          poster,
          background,
          banner: background,
          logo,
          releaseInfo: r.releaseInfo,
          imdbRating: r.voteAverage ? r.voteAverage.toFixed(1) : undefined,
          genres: r.genres,
          description: r.description,
        }
      }, 5)
    } else {
      let platformKey = ""
      let slug = ""
      for (const [k, v] of Object.entries(PLATFORM_SLUGS)) {
        // Fix M4: match ancorato invece di includes(k) — "now" dentro "unknown"
        // o "snow-white" dava falso positivo su customCatalog id arbitrari
        if (catalogId === `pictorium-${k}-movies` || catalogId === `pictorium-${k}-series`) {
          platformKey = k
          slug = v
          break
        }
      }
      if (platformKey) {
        // Fonte primaria: JustWatch streaming charts con filtro package (es. Netflix nfx, Prime prv, ecc.)
        // Come sopra: streamingCharts non pagina nativo (overfetch + slice),
        // popularTitles sì (first = finestra da 10).
        const pkgs = PLATFORM_JW_PACKAGES[platformKey]
        const skipForPlatform = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
        const jwGenre = resolveJWGenreCode(extra.genre)
        const jwFirst = jwGenre ? 10 : Math.min(50, 10 + skipForPlatform)
        let jwRows: JWRankEntry[] = []
        if (pkgs) {
          if (jwGenre) {
            jwRows = await getJWTitles({
              objectType: stType === "movie" ? "MOVIE" : "SHOW",
              country: region.code,
              first: jwFirst,
              offset: skipForPlatform,
              packages: pkgs,
              genres: [jwGenre],
              sortBy: "POPULAR",
              language: tmdbLang,
            })
          } else {
            jwRows = await getJustWatchRankings(stType === "movie" ? "MOVIE" : "SHOW", region.code, jwFirst, pkgs, tmdbLang)
          }
        }

        if (jwRows.length > 0) {
          const seenTmdb = new Set<number>()
          const sliceOffset = jwGenre ? 0 : skipForPlatform
          const uniqueJwRows = jwRows.filter((r) => {
            if (!r.tmdbId || seenTmdb.has(r.tmdbId)) return false
            seenTmdb.add(r.tmdbId)
            return true
          }).slice(sliceOffset, sliceOffset + 10)

          const results = await concurrentMap(uniqueJwRows, async (row) => {
            let details: TMDBDetails | null = null
            if (apiKey) {
              try {
                // D4: external_ids in append — niente secondo fetch per-titolo.
                details = await getDetailsWithExternalIds(stType === "movie" ? "movie" : "tv", row.tmdbId, tmdbLang, apiKey)
              } catch {
                details = null
              }
            }
            const title = details?.title || details?.name || row.title || ""
            return {
              tmdbId: row.tmdbId,
              imdbId: row.imdbId,
              externalImdbId: details?.external_ids?.imdb_id ?? null,
              title,
              releaseInfo: (details?.release_date || details?.first_air_date || "").slice(0, 4) || undefined,
              genres: (details?.genres || []).map((g) => g.name).filter(Boolean),
              backdropPath: details?.backdrop_path ?? null,
              description: details?.overview ?? undefined,
              voteAverage: details?.vote_average ?? undefined,
            }
          }, 5)
          const validResults = results.filter((r) => r.title.length > 0)
          metas = await concurrentMap(validResults, async (r) => {
            const [imdbId, poster, logo] = await Promise.all([
              r.imdbId || r.externalImdbId || null,
              pictoriumPosterUrl(req, stType, r.tmdbId, configParam, userParam, undefined, posterLang, region.code),
              apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
            ])
            const background = catalogBackground(r.backdropPath)
            return {
              id: catalogMetaId(imdbId, r.tmdbId),
              type: stType,
              name: r.title,
              poster,
              background,
              banner: background,
              logo,
              releaseInfo: r.releaseInfo,
              imdbRating: r.voteAverage ? r.voteAverage.toFixed(1) : undefined,
              genres: r.genres,
              description: r.description,
            }
          }, 5)
        } else if (slug && apiKey) {
          // Fallback secondario: FlixPatrol Top 10
          const data = await getTop10(slug, region.flixSlug, apiKey, { enrich: false }).catch(() => null)
          if (data) {
            const items = stType === "movie" ? data.movies : data.tv
            const seenTmdb = new Set<number>()
            const allWithTmdb: Array<(typeof items)[number] & { tmdbId: number }> = []
            for (const item of items) {
              if (item.tmdbId && !seenTmdb.has(item.tmdbId)) {
                seenTmdb.add(item.tmdbId)
                allWithTmdb.push({ ...item, tmdbId: item.tmdbId })
              }
            }
            const itemsWithTmdb = allWithTmdb.slice(skipForPlatform, skipForPlatform + 10)

            metas = await concurrentMap(itemsWithTmdb, async (item) => {
              const [imdbId, details, poster, logo] = await Promise.all([
                resolveImdbId(stType === "movie" ? "movie" : "tv", item.tmdbId, apiKey),
                getDetails(stType === "movie" ? "movie" : "tv", item.tmdbId, tmdbLang, apiKey).catch(() => null),
                pictoriumPosterUrl(req, stType, item.tmdbId, configParam, userParam, undefined, posterLang, region.code),
                catalogLogo(stType === "movie" ? "movie" : "tv", item.tmdbId, apiKey, tmdbLang),
              ])
              const italianTitle = details?.title || details?.name || item.title
              const background = catalogBackground(details?.backdrop_path ?? null)
              return {
                id: catalogMetaId(imdbId, item.tmdbId),
                type: stType,
                name: italianTitle,
                poster,
                background,
                banner: background,
                logo,
                releaseInfo: (details?.release_date || details?.first_air_date || item.releaseDate)?.slice(0, 4) || undefined,
                imdbRating: details?.vote_average ? details.vote_average.toFixed(1) : undefined,
                genres: (details?.genres || []).map((g) => g.name).filter(Boolean),
                description: details?.overview ?? undefined,
              }
            }, 5)
          }
        }
      }
    }

    if (extra.genre && extra.genre !== "Tutti" && metas.length > 0) {
      const gLower = extra.genre.toLowerCase()
      const isFamily = gLower === "famiglia" || gLower === "family"
      const isSciFi = gLower === "fantascienza" || gLower.includes("sci-fi")
      const isAction = gLower === "azione" || gLower.includes("action")
      // Nome del genere nella lingua della regione (vedi MANIFEST_GENRE_TMDB_IDS).
      // Resta undefined per le etichette fuori tabella o quando /genre/list
      // fallisce: in quel caso il filtro degrada al confronto di prima.
      const tmdbGenreId = MANIFEST_GENRE_TMDB_IDS[gLower]
      const localizedGenre = tmdbGenreId !== undefined
        ? (await tmdbGenreNames(stType, apiKey, tmdbLang)).get(tmdbGenreId)?.toLowerCase()
        : undefined
      metas = metas.filter((m) => {
        if (!m.genres || m.genres.length === 0) return true
        return m.genres.some((g) => {
          const gn = g.toLowerCase()
          if (gn.includes(gLower) || gLower.includes(gn)) return true
          if (localizedGenre && (gn.includes(localizedGenre) || localizedGenre.includes(gn))) return true
          if (isFamily && (gn.includes("famiglia") || gn.includes("family"))) return true
          if (isSciFi && (gn.includes("fantascienza") || gn.includes("sci-fi"))) return true
          if (isAction && (gn.includes("azione") || gn.includes("action"))) return true
          return false
        })
      })
    }

    const isPlatformOrJw = catalogId.startsWith("pictorium-jw") || catalogId.includes("netflix") || catalogId.includes("prime") || catalogId.includes("disney") || catalogId.includes("-now-") || catalogId.includes("apple") || catalogId.includes("hbo") || catalogId.includes("paramount")
    if (typeof extra.skip === "number" && extra.skip > 0 && (!catalogId.startsWith("pictorium-custom-") || isCustomGenreFiltered) && !isPlatformOrJw) {
      metas = metas.slice(extra.skip)
    }

    const body = { metas }
    cacheSet(cacheKey, body, ["stremio", "catalog"], metas.length > 0 ? undefined : 60_000)
    return catalogResponse(body)
  } catch (e) {
    log.error("Catalog error", { error: e instanceof Error ? e.message : String(e) })
    return catalogResponse({ metas: [] })
  }
}
