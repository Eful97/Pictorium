import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheGetShared, cacheSet, hashUserFragment } from "@/lib/cache"
import { getTop10 } from "@/lib/flixpatrol"
import { getServerDefaults, getServerDefaultsChecked, getServerDefaultsForUser, type ServerDefaults } from "@/lib/server-defaults"
import { getScopedUserId, userExists, userRateLimitKey } from "@/lib/user-auth"
import { touchUserActivity } from "@/lib/user-activity"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getById } from "@/lib/store"
import { decodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { getDetails, getDetailsWithExternalIds, getGenreList, getImages, personMovieCredits, personTvCredits, posterUrlOriginal, resolveUserApiKeys, searchMovies, searchPerson, searchTV, tmdbFindByImdb, tmdbFindByTvdb, type TMDBDetails } from "@/lib/tmdb"
import { resolveImdbId } from "@/lib/imdb-cache"
import { fetchMDBList } from "@/lib/mdblist"
import { resolveRankingSource } from "@/lib/ranking-source"
import { fetchCustomRankingTop20, findRankingCustomCatalog } from "@/lib/custom-ranking"
import { buildNoticeMeta, noticeCatalogId, NOTICE_CUSTOM_RANKING_UNAVAILABLE, NOTICE_CUSTOM_RANKING_UNAVAILABLE_DESCRIPTION, NOTICE_CUSTOM_RANKING_UNAVAILABLE_TITLE, NOTICE_MISSING_TVDB_KEY, NOTICE_MISSING_TVDB_KEY_TITLE, NOTICE_MISSING_TVDB_KEY_DESCRIPTION } from "@/lib/notice-meta"
import { fetchUnifiedCatalogResult } from "@/lib/custom-catalog-providers"
import { detectCatalogProvider } from "@/lib/catalog-provider-detect"
import { fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import { parseSupportedTmdbRef } from "@/lib/stremio-addon"
import { buildStremioPosterUrl, stremioPosterShape } from "@/lib/stremio-poster-url"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { getJWRankings, getJWTitles, resolveJWGenreCode, type JWRankEntry } from "@/lib/justwatch"
import { getRegionDef, normalizeRegion, parseRegion, GLOBAL_REGION_CODE, type RegionDef } from "@/lib/regions"
import { getCatalogEpoch } from "@/lib/catalog-epoch"
import { createLogger } from "@/lib/logger"
import { concurrentMap } from "@/lib/episode-ordering"
import { envWithFallback } from "@/lib/env-compat"
import { combineAbortSignals } from "@/lib/abort-signal"
import { isPersonQuery, pickTopPerson } from "@/lib/person-search"
import { normalizeCatalogId, normalizeCatalogIdKeys, normalizeCatalogIdList } from "@/lib/catalog-definitions"
import type { PosterShape } from "@/lib/types"

const log = createLogger("catalog")

// Tetto per-titolo TMDB nei cataloghi Stremio (fail-open): oltre il tetto il
// titolo esce con i dati della classifica (nome/anno) invece di appendere
// l'intera risposta oltre la deadline client (~10s). I dettagli poster usano
// 8s (POSTER_TMDB_TIMEOUT_MS): qui meno, perché 10-20 titoli viaggiano in
// parallelo e uno straggler non deve mai costare la risposta.
const CATALOG_TMDB_TIMEOUT_MS = (() => {
  const raw = envWithFallback("CATALOG_TMDB_TIMEOUT_MS")
  const n = raw ? parseInt(raw, 10) : 2500
  return Number.isFinite(n) && n >= 500 && n <= 15000 ? n : 2500
})()

/** Budget massimo complessivo per la risoluzione/arricchimento di liste custom non indicizzate */
const CATALOG_CUSTOM_BUDGET_MS = 10000

/** TTL cache risposte catalogo non vuote: 1h dalla generazione (esplicito,
 *  vince sul refresh schedulato del tag `catalog`, che resta per poster/logo). */
export const CATALOG_TTL_MS = 60 * 60 * 1000
/** TTL catalogo vuoto: resta 60s (errori transient non congelati). */
export const CATALOG_EMPTY_TTL_MS = 60_000

/** Signal per-titolo nei cataloghi (stesso pattern del tetto loghi a riga ~350). */
function catalogTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(CATALOG_TMDB_TIMEOUT_MS)
    : undefined
}

// Contatori key-missing per /api/status (solo memoria, mai segreti): quante
// risposte catalogo JW sono uscite vuote per mancanza chiave vs totale JW.
let jwCatalogRequests = 0
let jwKeyMissing = 0

export function getKeyMissingStats(): { catalogs: number; keyMissing: number } {
  return { catalogs: jwCatalogRequests, keyMissing: jwKeyMissing }
}

interface StremioMeta {
  id: string
  type: string
  name: string
  poster: string | null
  background?: string
  banner?: string
  /** Render landscape con logo baked-in (solo titoli landscape): NuvioTV lo
   *  legge, il `banner` (pulito) resta per gli altri client. Assente = portrait. */
  landscapePoster?: string
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
  // Prime: shortName regionale — `prv` (IT/FR/ES/...) vs `amp` (US/GB/DE/JP).
  // JW ignora i codici inesistenti per regione: l'unione è sicura ovunque.
  prime: ["prv", "amp"],
  disney: ["dnp"],
  // NOW/Sky esiste solo in alcuni paesi; negli USA il catalogo mappa Peacock
  // (stesso gruppo NBCUniversal/Comcast): `pct`+`pcp`, ignorati dove assenti.
  now: ["ntv", "skg", "pct", "pcp"],
  apple: ["atp"],
  hbo: ["mxx"],
  // Paramount+ in ES è SkyShowtime (`sst`): unione sicura come sopra.
  paramount: ["pmp", "sst"],
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
  return resolveCatalogRegionWithDefaults(req, userConfig, getServerDefaults())
}

/**
 * Variante con defaults già risolti (multi-user: i defaults del namespace).
 * `resolveCatalogRegion` sopra resta il wrapper globale invariato.
 */
export function resolveCatalogRegionWithDefaults(
  req: NextRequest,
  userConfig: Partial<PictoriumUserConfig> | null,
  defaults: ServerDefaults,
): RegionDef {
  const fromQuery = parseRegion(req.nextUrl.searchParams.get("region") ?? req.nextUrl.searchParams.get("country"))
  if (fromQuery) return getRegionDef(fromQuery)
  const fromConfig = parseRegion((userConfig as { region?: string } | null)?.region)
  if (fromConfig) return getRegionDef(fromConfig)
  return getRegionDef(normalizeRegion(defaults.region))
}

// La chiave MDBList della richiesta resta SOLO server-side (fetch rank/voti
// al momento del catalogo): non entra mai nel poster URL (M2 — finirebbe nel
// DB Stremio/log/proxy). Il poster risolve il rank via `animerank` incorporato
// o fallback d'istanza/mapping.
/**
 * Poster URL + banner landscape + landscapePoster NuvioTV + formato canvas di
 * un item in un'unica risoluzione mapping: UN solo getById per item (il
 * lookup è cachato, ma la doppia chiamata raddoppiava comunque il lavoro per
 * ogni riga del catalogo).
 *
 * Il `banner` è lo stesso rendering Pictorium in canvas landscape 16:9 SENZA
 * logo baked-in (profilo landscape del mapping): resta per i client che lo
 * leggono. NuvioTV invece ignora `banner` e legge `landscapePoster`: per i
 * titoli landscape (anche forzati dal default globale) è lo stesso canvas
 * con logo baked-in (immagine
 * intoccabile, Nuvio non deve sovrapporre nulla) — emesso solo in quel caso.
 * `background` resta il backdrop grezzo per l'hero della pagina dettaglio.
 */
async function pictoriumPosterAndShape(
  req: NextRequest,
  type: "movie" | "series",
  id: number,
  configParam?: string | null,
  userParam?: string | null,
  animeRankParam?: number | null,
  posterLang = "it",
  posterRegion?: string | null,
): Promise<{ poster: string; banner: string; landscapePoster?: string; posterShape: PosterShape }> {
  const scopedUser = getScopedUserId(userParam)
  const serverDefaults = scopedUser ? await getServerDefaultsForUser(scopedUser) : await getServerDefaultsChecked()
  const userConfig = configParam ? decodeConfig(configParam) : null
  const defaults = userConfig ? { ...serverDefaults, ...userConfig } : serverDefaults
  const mapping = await getById(type === "series" ? "tv" : "movie", id, scopedUser)
  const base = {
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
  } as const
  const posterShape = stremioPosterShape(mapping, defaults)
  const poster = buildStremioPosterUrl({ ...base, forceShape: posterShape }).toString()
  // Banner pulito: canvas landscape senza logo baked-in (per i client che
  // sovrappongono già il logo da catalogo) + badge genere in basso a destra.
  const banner = buildStremioPosterUrl({ ...base, forceShape: "landscape", hideLogo: true }).toString()
  // NuvioTV: immagine esattamente come Pictorium (logo baked-in, vedi
  // poster-service). I titoli forzati dal default sono inclusi.
  const landscapePoster = posterShape === "landscape" ? poster : undefined
  return { poster, banner, landscapePoster, posterShape }
}

function catalogBackground(backdropPath: string | null | undefined): string | undefined {
  return backdropPath ? posterUrlOriginal(backdropPath) : undefined
}

/**
 * Logo separato per NuvioTV: i titoli landscape hanno già il logo baked-in
 * nel `landscapePoster` — inviare anche `logo` farebbe sovrapporre a Nuvio
 * un secondo logo sopra l'immagine Pictorium. Ometterlo spegne l'overlay
 * (il /meta fa lo stesso, così l'arricchimento non lo reintroduce).
 */
function catalogLogoForShape(posterShape: PosterShape, logo: string | undefined): string | undefined {
  return posterShape === "landscape" ? undefined : logo
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

async function catalogLogo(mediaType: "movie" | "tv", tmdbId: number, apiKey?: string, tmdbLang = "it-IT", signal?: AbortSignal): Promise<string | undefined> {
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
    const logoSignal = combineAbortSignals(signal, 1500)
    const images = await getImages(mediaType, tmdbId, `${primary},en,null`, apiKey, logoSignal)
    if (images?.logos && images.logos.length > 0) {
      const itLogo = images.logos.find((l) => l.iso_639_1 === primary) || images.logos[0]
      if (itLogo?.file_path) {
        const logoUrl = posterUrlOriginal(itLogo.file_path)
        cacheSet(memoKey, { logo: logoUrl }, ["catalog", "tmdb"], 24 * 60 * 60 * 1000)
        return logoUrl
      }
    }
    // A miss memo is only valid when the lookup actually ran: on
    // cancellation (request budget abort or the 1500ms logo cap firing) the
    // outcome is "unknown", and freezing a null for an hour would hide a
    // logo that resolves fine on retry.
    if (signal?.aborted || logoSignal.aborted) return undefined
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
  // Namespace per il rate-limit (multi-user): risolto PRIMA del bucket così
  // il flood su `?u=vittima` non brucia la quota del proprietario.
  // NB: userParam qui è già canonico (path vince, vedi route /u/): nessuna
  // doppia identità a questo livello.
  const preScopedUser = getScopedUserId(userParam)
  const rl = await rateLimit(preScopedUser ? userRateLimitKey(req, preScopedUser) : rateLimitKey(req), "catalog")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  // Alias legacy: gli addon Stremio installati prima del rename usano ID
  // `posterium-*` — vengono normalizzati al canonico `pictorium-*`.
  const catalogId = normalizeCatalogId(rawId.replace(/\.json$/, ""))
  if (catalogId.length > 80) return catalogResponse({ metas: [] })
  // C4: tipo ignoto → 400 invece di servire silenziosamente dati series.
  const stType = normalizeCatalogType(mediaType)
  if (!stType) return catalogResponse({ metas: [] }, 400)
  const extra = parseCatalogExtra(extraSegments, req.nextUrl.searchParams)
  // Namespace utente (multi-user): null con flag OFF o senza `?u=` → path
  // globale byte-identico a oggi. Con `u` → SOLO namespace, mai fallback.
  // Spazi inventati → anonimo (v1.23.0): niente cache key separate.
  let scopedUser = getScopedUserId(userParam)
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  // Attività di lettura per il cleanup inattivi (throttled, fire-and-forget).
  if (scopedUser) touchUserActivity(scopedUser)
  // Chiavi effettive (slice 2): esplicite della richiesta > namespace utente
  // (solo con `?u=`) > env d'istanza. La chiave effettiva entra nel cache key
  // (hash) così un catalogo vuoto servito senza chiave non avvelena quelli
  // keyed (D3) e due namespace non collidono.
  const resolvedKeys = await resolveUserApiKeys(req, scopedUser)
  const apiKey = resolvedKeys.tmdb.key
  // Chiave MDBList (anime/custom): senza chiave né fallback la lista usa il
  // fallback pubblico (vedi ramo anime sotto).
  const mdblistKey = resolvedKeys.mdblist.key
  // Chiave TVDB (liste custom TVDB, BYOK): richiesta esplicita > namespace
  // utente > env d'istanza. Senza, i cataloghi TVDB escono con notice.
  const tvdbKey = resolvedKeys.tvdb.key
  const effectiveDefaults = scopedUser ? await getServerDefaultsForUser(scopedUser) : await getServerDefaultsChecked()
  let userConfig: Partial<PictoriumUserConfig> | null = null
  if (configParam) {
    userConfig = decodeConfig(configParam)
  }
  if (!userConfig) {
    userConfig = {
      disabledCatalogIds: effectiveDefaults.disabledCatalogIds,
      customCatalogs: effectiveDefaults.customCatalogs,
      rankingSourceMovie: effectiveDefaults.rankingSourceMovie,
      rankingSourceSeries: effectiveDefaults.rankingSourceSeries,
      catalogRenames: effectiveDefaults.catalogRenames,
      catalogOrder: effectiveDefaults.catalogOrder,
    } as PictoriumUserConfig
  }
  // Config salvate prima del rename possono contenere ID `pictorium-*`:
  // normalizza al canonico `pictorium-*` così filtri/ordini/rinomine restano validi.
  userConfig.disabledCatalogIds = normalizeCatalogIdList(userConfig.disabledCatalogIds)
  userConfig.catalogOrder = normalizeCatalogIdList(userConfig.catalogOrder)
  userConfig.catalogRenames = normalizeCatalogIdKeys(userConfig.catalogRenames)
  // Partial token merge: a token carrying only the ranking selection must not
  // lose the custom catalogs stored in the namespace defaults (the selection
  // references them by id). Same rule as the manifest composition.
  if (userConfig.customCatalogs === undefined) userConfig.customCatalogs = effectiveDefaults.customCatalogs
  if (userConfig.rankingSourceMovie === undefined) userConfig.rankingSourceMovie = effectiveDefaults.rankingSourceMovie
  if (userConfig.rankingSourceSeries === undefined) userConfig.rankingSourceSeries = effectiveDefaults.rankingSourceSeries
  // Epoch globale + hash dei server defaults: frammenti di freschezza per TUTTI
  // i cache key di questo handler (ricerche + catalogo). Su deploy
  // multi-istanza la `cacheInvalidate("stremio")` del save non raggiunge le
  // altre istanze — senza questi frammenti un body cachato (con vecchi poster
  // URL) resterebbe servito fino alla scadenza (1h). Ogni save
  // (mapping/defaults) fa bump dell'epoch.
  const epoch = await getCatalogEpoch(scopedUser)
  const sdHash = hashFragment(JSON.stringify(effectiveDefaults))
  const freshness = `:e${epoch}:sd${sdHash}`
  // Regione classifiche (JustWatch + FlixPatrol) e lingua titoli: entra in ogni
  // cache key così cataloghi di paesi diversi non si avvelenano a vicenda.
  const region = resolveCatalogRegionWithDefaults(req, userConfig, effectiveDefaults)
  const tmdbLang = region.lang
  const posterLang = tmdbLang.slice(0, 2).toLowerCase()
  const regionFragment = `:r${region.code}`

  // Global Top 20 ranking source for this slot (movie/series). Platform and
  // anime catalogs never read it, and the cache fragment below applies to
  // global JustWatch catalogs only, so switching the selection never
  // invalidates platform/anime entries. Credential/namespace isolation rides
  // on the existing ak/mk/tv/u/cfg/sd hashes plus the unified fetch key.
  const rankingSource = resolveRankingSource(
    {
      customCatalogs: userConfig?.customCatalogs,
      rankingSourceMovie: userConfig?.rankingSourceMovie,
      rankingSourceSeries: userConfig?.rankingSourceSeries,
    },
    stType,
  )
  const rankingCustom = rankingSource.kind === "custom"
    ? findRankingCustomCatalog(userConfig?.customCatalogs, rankingSource.customId)
    : undefined
  const rankingFragment = !catalogId.startsWith("pictorium-jw")
    ? ""
    : rankingSource.kind === "custom" && rankingCustom
      ? `:rs${hashFragment(`${rankingSource.customId}:${rankingCustom.url}:${rankingCustom.datasetId ?? ""}`)}`
      : ":rsjw"

  // --- Gestione Ricerca Stremio (sia via barra di ricerca che catalogo dedicato) ---
  // Eccezione addon: se il catalogo importato dichiara `search`, la query va
  // inoltrata alla fonte (ramo addon sotto), non alla ricerca TMDB globale.
  const addonSearchPassthrough = (() => {
    if (!extra.search) return false
    if (!catalogId.startsWith("pictorium-custom-")) return false
    let cid = catalogId.replace(/^pictorium-custom-/, "")
    if (cid.startsWith("movie-")) cid = cid.slice(6)
    else if (cid.startsWith("series-")) cid = cid.slice(7)
    const customs = userConfig?.customCatalogs as Array<{ id: string; addon?: { extra?: Array<{ name: string }> } }> | undefined
    const found = customs?.find((c) => c.id === cid)
    const extras = found?.addon?.extra
    const ok = !!extras && extras.some((e) => e.name === "search")
    return ok
  })()
  if (extra.search && !addonSearchPassthrough) {
    const isPeopleCatalog = catalogId.startsWith("pictorium-search-people-")
    if (isPeopleCatalog) {
      // Senza chiave (né richiesta, né namespace, né env): notice card
      // esplicativa invece di `metas: []` silenzioso. Mai cachata (return
      // prima di ogni cacheSet; la chiave è frammento del cache key).
      if (!apiKey) {
        log.debug("Catalog key-missing: no TMDB key", { catalogId })
        return catalogResponse({
          metas: [buildNoticeMeta({ type: stType, poster: `${getOriginFromRequest(req)}/pictorium.png` })],
        })
      }
      const page = Math.floor((extra.skip || 0) / 20) + 1
      const searchCacheKey = `stremio:search:people:${stType}:${hashFragment(extra.search)}:p${page}:pv${POSTER_URL_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${hashFragment(apiKey)}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${regionFragment}${freshness}`
      const cachedSearch = cacheGet<{ metas: StremioMeta[] }>(searchCacheKey)
      if (cachedSearch) return catalogResponse(cachedSearch)

      // Un id IMDb non è una persona: il ramo people torna sempre vuoto.
      if (/^tt\d{7,10}$/i.test(extra.search.trim())) {
        const body = { metas: [] as StremioMeta[] }
        cacheSet(searchCacheKey, body, ["stremio", "search"], 10 * 60 * 1000)
        return catalogResponse(body)
      }

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
          const { poster, banner, landscapePoster, posterShape } = await pictoriumPosterAndShape(req, stType, item.id, configParam, userParam, undefined, posterLang, region.code)
          const releaseInfo = (item.release_date || item.first_air_date || "").slice(0, 4) || undefined
          return {
            id: catalogMetaId(null, item.id),
            type: stType,
            name: item.title || item.name || "",
            poster,
            posterShape,
            banner,
            landscapePoster,
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

    if (!apiKey) {
      log.debug("Catalog key-missing: no TMDB key", { catalogId })
      return catalogResponse({
        metas: [buildNoticeMeta({ type: stType, poster: `${getOriginFromRequest(req)}/pictorium.png` })],
      })
    }
    const page = Math.floor((extra.skip || 0) / 20) + 1
    const searchCacheKey = `stremio:search:${stType}:${hashFragment(extra.search)}:p${page}:pv${POSTER_URL_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${hashFragment(apiKey)}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${regionFragment}${freshness}`
    const cachedSearch = cacheGet<{ metas: StremioMeta[] }>(searchCacheKey)
    if (cachedSearch) return catalogResponse(cachedSearch)

    // Id IMDb esatto: risoluzione diretta via /find, senza full-text search.
    // Un solo risultato → le pagine oltre la prima sono vuote.
    const imdbQuery = extra.search.trim()
    if (/^tt\d{7,10}$/i.test(imdbQuery)) {
      if ((extra.skip || 0) > 0) {
        const emptyBody = { metas: [] as StremioMeta[] }
        cacheSet(searchCacheKey, emptyBody, ["stremio", "search"], 10 * 60 * 1000)
        return catalogResponse(emptyBody)
      }
      try {
        const foundId = await tmdbFindByImdb(imdbQuery, stType === "movie" ? "movie" : "tv", apiKey)
        if (!foundId) {
          const emptyBody = { metas: [] as StremioMeta[] }
          cacheSet(searchCacheKey, emptyBody, ["stremio", "search"], 10 * 60 * 1000)
          return catalogResponse(emptyBody)
        }
        const d = await getDetails(stType === "movie" ? "movie" : "tv", foundId, tmdbLang, apiKey)
        const genreNames = await tmdbGenreNames(stType, apiKey, tmdbLang)
        const { poster, banner, landscapePoster, posterShape } = await pictoriumPosterAndShape(req, stType, foundId, configParam, userParam, undefined, posterLang, region.code)
        const body = {
          metas: [
            {
              id: catalogMetaId(null, foundId),
              type: stType,
              name: d?.title || d?.name || imdbQuery,
              poster,
              posterShape,
              banner,
              landscapePoster,
              background: catalogBackground(d?.backdrop_path ?? null),
              releaseInfo: (d?.release_date || d?.first_air_date || "").slice(0, 4) || undefined,
              imdbRating: d?.vote_average ? d.vote_average.toFixed(1) : undefined,
              genres: genreNamesFromIds(d?.genres?.map((g) => g.id), genreNames),
              description: d?.overview ?? undefined,
            },
          ] as StremioMeta[],
        }
        cacheSet(searchCacheKey, body, ["stremio", "search"], 10 * 60 * 1000)
        return catalogResponse(body)
      } catch (e) {
        log.error("IMDb id search failed", { error: e instanceof Error ? e.message : String(e) })
        return catalogResponse({ metas: [] })
      }
    }

    try {
      const searchRes = stType === "movie"
        ? await searchMovies(extra.search, tmdbLang, apiKey, page)
        : await searchTV(extra.search, tmdbLang, apiKey, page)

      const items = (searchRes?.results || []).slice(0, 20)

      const genreNames = await tmdbGenreNames(stType, apiKey, tmdbLang)
      const results: (StremioMeta | null)[] = await concurrentMap(items, async (item) => {
        if (!item.id) return null
        const { poster, banner, landscapePoster, posterShape } = await pictoriumPosterAndShape(req, stType, item.id, configParam, userParam, undefined, posterLang, region.code)
        const releaseInfo = (item.release_date || item.first_air_date || "").slice(0, 4) || undefined
        return {
          id: catalogMetaId(null, item.id),
          type: stType,
          name: item.title || item.name || "",
          poster,
          posterShape,
          banner,
          landscapePoster,
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
  // Frammento search: i cataloghi non-addon non arrivano mai qui con search
  // (intercettata dal ramo TMDB globale), ma gli addon con `search` dichiarato
  // la inoltrano alla fonte — senza, due ricerche diverse colliderebbero.
  const searchFragment = extra.search ? `:q${hashFragment(extra.search)}` : ""
  const cacheKey = `stremio:catalog:v2:${stType}:${catalogId}:pv${POSTER_URL_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${apiKey ? hashFragment(apiKey) : "none"}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${tvdbKey ? `:tv${hashFragment(tvdbKey)}` : ""}${genreFragment}${skipFragment}${searchFragment}${regionFragment}${rankingFragment}${freshness}`
  // C1: L1 + L2 condivisa (KV su multi-istanza, no-op locale/VPS).
  // Il selettore conserva il TTL originale anche dopo il ripopolamento L1
  // da KV (il payload KV non trasporta la scadenza): pieno → 1h, vuoto → 60s.
  const cached = await cacheGetShared<{ metas: StremioMeta[] }>(cacheKey, ["stremio", "catalog"], (body) =>
    body?.metas?.length ? CATALOG_TTL_MS : CATALOG_EMPTY_TTL_MS,
  )
  if (cached) return catalogResponse(cached)

  let isCustomGenreFiltered = false
  // Budget-incomplete flag (task B): when the shared 10s deadline fires
  // before the scan/details/enrichment prove the window, the body stays
  // servable but caches short (60s, like empties) so a retry refetches
  // instead of freezing a shifted/partial window for an hour.
  let customBudgetIncomplete = false
  // Ramo addon: la fonte ha già filtrato (genre/search inoltrati) — il filtro
  // locale per nome genere non deve girare (es. Cinemeta year con genre=2024
  // contro genres=['Drama'] eliminerebbe risultati validi).
  let isAddonCatalog = false

  try {
    let metas: StremioMeta[] = []

    if (catalogId.startsWith("pictorium-custom-")) {
      let customId = catalogId.replace(/^pictorium-custom-/, "")
      if (customId.startsWith("movie-")) customId = customId.slice(6)
      else if (customId.startsWith("series-")) customId = customId.slice(7)

      const customCat = userConfig?.customCatalogs?.find((c: { id: string }) => c.id === customId) as
        | { id: string; url: string; type?: string; enabled?: boolean; datasetId?: string; addon?: import("./stremio-addon").StremioAddonSource }
        | undefined
      // Ramo dedicato addon Stremio: preserva ordine, duplicati, ID e metadati
      // originali; arricchisce best-effort col poster Pictorium esistente.
      if (customCat?.addon && customCat.enabled !== false) {
        isAddonCatalog = true
        const addon = customCat.addon
        const remoteType = addon.catalogType === "series" ? "series" : "movie"
        // Tipo richiesto deve corrispondere a quello importato (manifest a
        // singolo tipo; niente split mixed per gli addon).
        if ((stType === "series" ? "series" : "movie") !== remoteType) {
          return catalogResponse({ metas: [] })
        }
        const addonQuery = {
          ...(extra.search ? { search: extra.search } : {}),
          ...(typeof extra.skip === "number" ? { skip: extra.skip } : {}),
          ...(extra.genre ? { genre: extra.genre } : {}),
        }
        const nsKey = `${scopedUser ?? "global"}:${configParam ?? "nocfg"}:${apiKey ? hashFragment(apiKey) : "nokey"}`
        const page = await fetchAddonCatalogPage(
          addon.manifestUrl,
          remoteType,
          addon.catalogId,
          addonQuery,
          getOriginFromRequest(req),
          `${nsKey}:${catalogId}`,
        ).catch(() => ({ items: [] as Array<Record<string, unknown>>, error: "unavailable" as const }))
        const remoteItems = ("items" in page && Array.isArray(page.items) ? page.items : []) as Array<Record<string, unknown>>
        // Conserva ordine/duplicati/ID: nessuna dedup, nessun ordinamento,
        // nessuna ricerca per titolo. Un errore di arricchimento non elimina il titolo.
        const enriched = await concurrentMap(remoteItems, async (raw) => {
          const rawId = typeof raw.id === "string" ? raw.id : ""
          if (!rawId) return null
          const name = typeof raw.name === "string" && raw.name
            ? raw.name
            : typeof raw.title === "string" && raw.title ? raw.title : rawId
          const base: StremioMeta = {
            id: rawId,
            type: stType,
            name,
            poster: typeof raw.poster === "string" ? raw.poster : null,
            background: typeof raw.background === "string" ? raw.background : undefined,
            banner: typeof raw.banner === "string" ? raw.banner : undefined,
            logo: typeof raw.logo === "string" ? raw.logo : undefined,
            releaseInfo: typeof raw.releaseInfo === "string" ? raw.releaseInfo
              : typeof raw.year === "string" || typeof raw.year === "number" ? String(raw.year).slice(0, 4) || undefined : undefined,
            imdbRating: typeof raw.imdbRating === "string" && raw.imdbRating ? raw.imdbRating : undefined,
            genres: Array.isArray(raw.genres)
              ? (raw.genres as unknown[]).filter((g): g is string => typeof g === "string").slice(0, 10)
              : Array.isArray(raw.genre)
                ? (raw.genre as unknown[]).filter((g): g is string => typeof g === "string").slice(0, 10)
                : undefined,
            description: typeof raw.description === "string" ? raw.description : undefined,
          }
          try {
            const ref = parseSupportedTmdbRef(rawId)
            if (!ref) return base
            let tmdbId: number | null = null
            if (ref.kind === "tmdb") tmdbId = ref.tmdbId
            else if (ref.kind === "imdb" && apiKey) {
              tmdbId = await tmdbFindByImdb(ref.imdb, stType === "movie" ? "movie" : "tv", apiKey).catch(() => null)
            } else if (ref.kind === "tvdb" && apiKey) {
              tmdbId = await tmdbFindByTvdb(ref.tvdb, stType === "movie" ? "movie" : "tv", apiKey).catch(() => null)
            }
            if (!tmdbId) return base
            const posterAndShape = await pictoriumPosterAndShape(req, stType, tmdbId, configParam, userParam, undefined, posterLang, region.code)
            const logo = apiKey
              ? await catalogLogo(stType === "movie" ? "movie" : "tv", tmdbId, apiKey, tmdbLang).catch(() => undefined)
              : undefined
            return {
              ...base,
              poster: posterAndShape.poster,
              posterShape: posterAndShape.posterShape,
              banner: posterAndShape.banner,
              landscapePoster: posterAndShape.landscapePoster,
              logo: catalogLogoForShape(posterAndShape.posterShape, logo ?? base.logo),
            }
          } catch {
            return base
          }
        }, 5)
        metas = (enriched.filter((m): m is StremioMeta => m !== null) as StremioMeta[])
      } else {
      // Come il ramo JW: senza chiave TMDB niente getDetails e i poster
      // Pictorium risponderebbero 404 → notice esplicita invece di item rotti.
      if (!apiKey) {
        log.debug("Catalog key-missing: no TMDB key", { catalogId })
        return catalogResponse({
          metas: [buildNoticeMeta({ type: stType, poster: `${getOriginFromRequest(req)}/pictorium.png` })],
        })
      }
      const customCat2 = customCat as
        | { id: string; url: string; type?: string; enabled?: boolean; datasetId?: string }
        | undefined
      if (customCat2 && customCat2.enabled !== false) {
        // TVDB senza chiave: notice esplicita invece di item rotti o vuoto
        // generico (stesso pattern del ramo apiKey sopra, mai cachata).
        if (!tvdbKey && detectCatalogProvider(customCat2.url)?.provider === "tvdb") {
          log.debug("Catalog key-missing: no TVDB key", { catalogId })
          return catalogResponse({
            metas: [buildNoticeMeta({
              type: stType,
              poster: `${getOriginFromRequest(req)}/pictorium.png`,
              id: noticeCatalogId(NOTICE_MISSING_TVDB_KEY),
              name: NOTICE_MISSING_TVDB_KEY_TITLE,
              description: NOTICE_MISSING_TVDB_KEY_DESCRIPTION,
            })],
          })
        }
        // Shared whole-upstream budget (10s): starts BEFORE the provider
        // fetch and covers list fetch, id resolution, details and final
        // IMDb/logo enrichment. Combined with the incoming request signal
        // (client disconnect) — first abort wins, no Promise.race leaks.
        // Per-step caps stay via combineAbortSignals(budget, STEP_MS).
        const incomingSignal = (req as unknown as { signal?: AbortSignal }).signal ?? undefined
        const customBudgetSignal = combineAbortSignals(incomingSignal, CATALOG_CUSTOM_BUDGET_MS)

        const providerResult = await fetchUnifiedCatalogResult(customCat2.url, { apiKey, mdblistKey, tvdbKey, limit: 500, datasetId: customCat2.datasetId, userId: scopedUser, signal: customBudgetSignal })
        // Interrupted provider pagination (abort/page error) is servable
        // but partial: flag it so the body caches short (60s) and the retry
        // refetches instead of freezing a shifted window for an hour.
        if (providerResult.incomplete) customBudgetIncomplete = true
        let items = providerResult.items
        // Se la lista è mista o contiene mediatype, filtra in base al tipo di catalogo richiesto
        if (customCat2.type === "mixed") {
          if (stType === "movie") {
            items = items.filter((it) => it.mediatype !== "show" && it.mediatype !== "tv" && it.mediatype !== "anime")
          } else {
            items = items.filter((it) => it.mediatype !== "movie")
          }
        }

        const skip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
        isCustomGenreFiltered = !!(extra.genre && extra.genre !== "Tutti")

        // Stable pagination in source order: dedupe on globally-unique
        // resolved TMDB ids BEFORE applying skip/page-20 — never slice raw
        // candidates first (raw duplicates/unresolvable rows before the
        // window would otherwise short-change the page and shift later
        // pages). The scan resolves bounded 20-row strides in order and
        // stops once the window proves full (skip+20 unique, or the first
        // 100 unique when a genre filter applies at the tail), so the first
        // page of an indexed list costs zero /find calls and a late-tail
        // page never resolves all 500 rows. Direct tmdb ids dedupe with no
        // I/O but keep source order and page-relative ranks.
        const uniqueTarget = isCustomGenreFiltered ? 100 : skip + 20
        const rankOffset = isCustomGenreFiltered ? 0 : skip
        const seenTmdb = new Set<number>()
        const uniqueResolved: typeof items = []
        const RESOLVE_STRIDE = 20
        // A /find that THROWS (timeout/outage/abort) is transient: the row
        // drops but later rows shift into its rank, so the window is only a
        // prefix guess — flag incomplete (short TTL, retry recovers). A
        // confirmed miss (resolves null, no throw) is NOT transient: the row
        // genuinely has no TMDB id and later rows legitimately take its place.
        let scanTransientFailure = false
        let scanned = 0
        for (; scanned < items.length && uniqueResolved.length < uniqueTarget; scanned += RESOLVE_STRIDE) {
          if (customBudgetSignal.aborted) break
          const stride = items.slice(scanned, scanned + RESOLVE_STRIDE)
          const resolvedStride = await concurrentMap(stride, async (item) => {
            if (customBudgetSignal.aborted) return null
            const direct = Number(item.tmdb)
            if (direct > 0) return item
            const itemSignal = combineAbortSignals(customBudgetSignal, CATALOG_TMDB_TIMEOUT_MS)
            if (item.imdb && apiKey) {
              try {
                const found = (await tmdbFindByImdb(item.imdb, stType === "movie" ? "movie" : "tv", apiKey, itemSignal)) || 0
                if (found) {
                  item.tmdb = found
                  return item
                }
              } catch {
                // transient /find failure (not a confirmed miss) → the
                // window may have shifted: drop the row but flag it.
                scanTransientFailure = true
              }
            }
            if (item.tvdb && apiKey) {
              try {
                const found = (await tmdbFindByTvdb(item.tvdb, stType === "movie" ? "movie" : "tv", apiKey, itemSignal)) || 0
                if (found) {
                  item.tmdb = found
                  return item
                }
              } catch {
                scanTransientFailure = true
              }
            }
            return null
          }, 5)
          for (const entry of resolvedStride) {
            if (!entry) continue
            const entryId = Number(entry.tmdb)
            if (entryId > 0 && !seenTmdb.has(entryId)) {
              seenTmdb.add(entryId)
              uniqueResolved.push(entry)
              if (uniqueResolved.length >= uniqueTarget) break
            }
          }
        }
        // Honesty about stable skip: when the budget dies (or the scan stops
        // early) before proving skip+20 unique, earlier unresolved rows may
        // shift the window — serve what resolved but flag partial so the
        // body caches short and the retry recovers instead of freezing.
        if (customBudgetSignal.aborted) customBudgetIncomplete = true
        if (uniqueResolved.length < uniqueTarget && scanned < items.length) customBudgetIncomplete = true
        // A transient /find failure (throw, not confirmed miss) may have
        // shifted the window: serve what resolved but short-TTL the body.
        if (scanTransientFailure) customBudgetIncomplete = true

        const pagedItems = isCustomGenreFiltered ? uniqueResolved.slice(0, 100) : uniqueResolved.slice(skip, skip + 20)

        // A details fetch that throws (timeout/outage) loses genre data but
        // the row stays servable from list data — still flag incomplete so a
        // genre-less partial never freezes for an hour.
        let detailsTransientFailure = false
        const results = await concurrentMap(pagedItems, async (item, idx) => {
          const tmdbId = Number(item.tmdb)
          if (!tmdbId) return null
          let details: TMDBDetails | null = null
          if (apiKey) {
            try {
              const detailsSignal = combineAbortSignals(customBudgetSignal, CATALOG_TMDB_TIMEOUT_MS)
              details = await getDetails(stType === "movie" ? "movie" : "tv", tmdbId, tmdbLang, apiKey, detailsSignal, CATALOG_TMDB_TIMEOUT_MS)
            } catch {
              details = null
              detailsTransientFailure = true
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
        if (customBudgetSignal.aborted) customBudgetIncomplete = true
        if (detailsTransientFailure) customBudgetIncomplete = true
        const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null)
        metas = await concurrentMap(validResults, async (r) => {
          // Final enrichment rides the same shared deadline: per-step caps
          // via combined signals, cancellation at the 10s bound, no extra
          // background work past it.
          const enrichSignal = combineAbortSignals(customBudgetSignal, CATALOG_TMDB_TIMEOUT_MS)
          const [imdbId, posterAndShape, logo] = await Promise.all([
            r.imdb ? Promise.resolve(r.imdb) : resolveImdbId(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, CATALOG_TMDB_TIMEOUT_MS, enrichSignal),
            pictoriumPosterAndShape(req, stType, r.tmdbId, configParam, userParam, r.rank, posterLang, region.code),
            apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, tmdbLang, customBudgetSignal) : Promise.resolve(undefined),
          ])
          const { poster, banner, landscapePoster, posterShape } = posterAndShape
          const background = catalogBackground(r.backdropPath)
          return {
            id: catalogMetaId(imdbId, r.tmdbId),
            type: stType,
            name: r.title,
            poster,
            posterShape,
            background,
            banner,
            landscapePoster,
            logo: catalogLogoForShape(posterShape, logo),
            releaseInfo: r.releaseInfo,
            imdbRating: r.voteAverage ? r.voteAverage.toFixed(1) : undefined,
            genres: r.genres,
            description: r.description,
          }
        }, 5)
        if (customBudgetSignal.aborted) customBudgetIncomplete = true
      }
      }
    } else if (catalogId.startsWith("pictorium-jw")) {
      // Fix L12: la chiave si controlla PRIMA del fetch JustWatch
      jwCatalogRequests++
      if (!apiKey) {
        jwKeyMissing++
        log.debug("Catalog key-missing: no TMDB key", { catalogId })
        return catalogResponse({
          metas: [buildNoticeMeta({ type: stType, poster: `${getOriginFromRequest(req)}/pictorium.png` })],
        })
      }
      // Custom-driven Top 20: the shared ranking service owns fetching,
      // slot filtering, id resolution and ordering. Provider errors surface
      // as an explicit (uncached) notice — never a silent JustWatch fallback.
      // The JW genre drill-down stays JustWatch-only; the tail post-filter
      // still applies to custom rows.
      let uniqueRows: Array<{ tmdbId: number; imdbId: string | null; title?: string | null | undefined }>
      if (rankingSource.kind === "custom" && rankingCustom) {
        const ranking = await fetchCustomRankingTop20({
          custom: rankingCustom,
          slot: stType,
          apiKey,
          mdblistKey,
          tvdbKey,
          userId: scopedUser,
        })
        if (ranking.items.length === 0) {
          if (ranking.status !== "empty") {
            log.debug("Custom ranking unavailable", { catalogId, status: ranking.status })
            return catalogResponse({
              metas: [buildNoticeMeta({
                type: stType,
                poster: `${getOriginFromRequest(req)}/pictorium.png`,
                id: noticeCatalogId(NOTICE_CUSTOM_RANKING_UNAVAILABLE),
                name: NOTICE_CUSTOM_RANKING_UNAVAILABLE_TITLE,
                description: `${NOTICE_CUSTOM_RANKING_UNAVAILABLE_DESCRIPTION} (lista: ${rankingCustom.name}, stato: ${ranking.status})`,
              })],
            })
          }
          uniqueRows = []
        } else {
          // Windowed Top-N: pages past the Top 20 are empty, short lists are
          // never backfilled with JustWatch rows.
          const customSkip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
          uniqueRows = ranking.items
            .slice(customSkip, customSkip + 20)
            .map((item) => ({ tmdbId: item.tmdbId, imdbId: item.imdb || null, title: item.title || null }))
        }
      } else {
        // streamingCharts non supporta `offset`: l'overfetch da zero + slice è
        // l'unico modo per paginare (l'arricchimento TMDB resta comunque sui 20
        // della finestra). popularTitles invece pagina nativo: first = finestra.
        const jwSkip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
        const jwGenre = region.code === GLOBAL_REGION_CODE ? null : resolveJWGenreCode(extra.genre)
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
        uniqueRows = rows.filter((r) => {
          if (!r.tmdbId || seenTmdb.has(r.tmdbId)) return false
          seenTmdb.add(r.tmdbId)
          return true
        }).slice(jwGenre ? 0 : jwSkip, (jwGenre ? 0 : jwSkip) + 20)
      }

      const results = await concurrentMap(uniqueRows, async (row) => {
        try {
          // D4: external_ids in append — niente secondo fetch per-titolo.
          // Tetto fail-open: uno straggler non appende tutto il catalogo.
          const d = await getDetailsWithExternalIds(stType === "movie" ? "movie" : "tv", row.tmdbId, tmdbLang, apiKey, catalogTimeoutSignal(), CATALOG_TMDB_TIMEOUT_MS)
          if (!d?.id) return { d: null, tmdbId: row.tmdbId, imdbId: row.imdbId, title: row.title }
          return { d, tmdbId: row.tmdbId, imdbId: row.imdbId, title: row.title }
        } catch {
          // Fail-open come il ramo piattaforme: il titolo JustWatch resta
          // anche senza dettagli (prima la riga veniva scartata del tutto).
          return { d: null, tmdbId: row.tmdbId, imdbId: row.imdbId, title: row.title }
        }
      }, 5)
      const validResults = results.filter((r): r is { d: TMDBDetails | null; tmdbId: number; imdbId: string | null; title: string | null | undefined } => r !== null && (!!r.d || !!(r.title && r.title.length > 0)))
      metas = await concurrentMap(validResults, async (r) => {
        const [imdbId, posterAndShape, logo] = await Promise.all([
          r.imdbId || r.d?.external_ids?.imdb_id || null,
          pictoriumPosterAndShape(req, stType, r.tmdbId, configParam, userParam, undefined, posterLang, region.code),
          apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
        ])
        const { poster, banner, landscapePoster, posterShape } = posterAndShape
        const background = catalogBackground(r.d?.backdrop_path ?? null)
        return {
          id: catalogMetaId(imdbId, r.tmdbId),
          type: stType,
          name: r.d?.title || r.d?.name || r.title || "",
          poster,
          posterShape,
          background,
          banner,
          landscapePoster,
          logo: catalogLogoForShape(posterShape, logo),
          releaseInfo: (r.d?.release_date || r.d?.first_air_date || "").slice(0, 4) || undefined,
          imdbRating: r.d?.vote_average ? r.d.vote_average.toFixed(1) : undefined,
          genres: (r.d?.genres || []).map((g) => g.name).filter(Boolean),
          description: r.d?.overview ?? undefined,
        }
      }, 5)
    } else if (catalogId.startsWith("pictorium-anime")) {
      const isMovie = catalogId === "pictorium-anime-movies" || stType === "movie"
      const listKey = isMovie ? "mdblistAnimeMovie" : "mdblistAnime"
      const mediaType = isMovie ? "movie" : "tv"
      const items = await fetchMDBList(listKey, mdblistKey)

      // Block-paging: la lista intera resta in cache MDBList 30min, Stremio
      // pagina con skip sulla finestra da 20. Lo slice va PRIMA
      // dell'arricchimento TMDB così le pagine oltre la prima non rifanno
      // getDetails sui titoli già serviti.
      const animeSkip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
      const pagedItems = items.slice(animeSkip, animeSkip + 20)
      const seenTmdb = new Set<number>()
      const results = await concurrentMap(pagedItems, async (item, idx) => {
        let tmdbId = Number(item.tmdb)
        if (!tmdbId && item.imdb && apiKey) {
          tmdbId = await tmdbFindByImdb(item.imdb, mediaType, apiKey, catalogTimeoutSignal()).catch(() => 0) || 0
        }
        if (!tmdbId || seenTmdb.has(tmdbId)) return null
        seenTmdb.add(tmdbId)

        let d: TMDBDetails | null = null
        if (apiKey) {
          try {
            // Tetto fail-open: il nome dalla lista MDBList resta comunque.
            d = await getDetails(mediaType, tmdbId, tmdbLang, apiKey, catalogTimeoutSignal(), CATALOG_TMDB_TIMEOUT_MS)
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
          rank: animeSkip + idx + 1,
          genres: (d?.genres || []).map((g) => g.name).filter(Boolean),
          backdropPath: d?.backdrop_path ?? null,
          description: d?.overview ?? undefined,
          voteAverage: d?.vote_average ?? undefined,
        }
      }, 5)
      const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null)
      metas = await concurrentMap(validResults, async (r) => {
        const [imdbId, posterAndShape, logo] = await Promise.all([
          r.imdb ? Promise.resolve(r.imdb) : resolveImdbId(mediaType, r.tmdbId, apiKey, CATALOG_TMDB_TIMEOUT_MS),
          pictoriumPosterAndShape(req, stType, r.tmdbId, configParam, userParam, r.rank, posterLang, region.code),
          apiKey ? catalogLogo(mediaType, r.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
        ])
        const { poster, banner, landscapePoster, posterShape } = posterAndShape
        const background = catalogBackground(r.backdropPath)
        return {
          id: catalogMetaId(imdbId, r.tmdbId),
          type: stType,
          name: r.name,
          poster,
          posterShape,
          background,
          banner,
          landscapePoster,
          logo: catalogLogoForShape(posterShape, logo),
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
        const jwGenre = region.code === GLOBAL_REGION_CODE ? null : resolveJWGenreCode(extra.genre)
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
                // Tetto fail-open: il titolo JustWatch resta anche senza dettagli.
                details = await getDetailsWithExternalIds(stType === "movie" ? "movie" : "tv", row.tmdbId, tmdbLang, apiKey, catalogTimeoutSignal(), CATALOG_TMDB_TIMEOUT_MS)
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
            const [imdbId, posterAndShape, logo] = await Promise.all([
              r.imdbId || r.externalImdbId || null,
              pictoriumPosterAndShape(req, stType, r.tmdbId, configParam, userParam, undefined, posterLang, region.code),
              apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
            ])
            const { poster, banner, landscapePoster, posterShape } = posterAndShape
            const background = catalogBackground(r.backdropPath)
            return {
              id: catalogMetaId(imdbId, r.tmdbId),
              type: stType,
              name: r.title,
              poster,
              posterShape,
              background,
              banner,
              landscapePoster,
              logo: catalogLogoForShape(posterShape, logo),
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
              const [imdbId, details, posterAndShape, logo] = await Promise.all([
                resolveImdbId(stType === "movie" ? "movie" : "tv", item.tmdbId, apiKey, CATALOG_TMDB_TIMEOUT_MS),
                getDetails(stType === "movie" ? "movie" : "tv", item.tmdbId, tmdbLang, apiKey, catalogTimeoutSignal(), CATALOG_TMDB_TIMEOUT_MS).catch(() => null),
                pictoriumPosterAndShape(req, stType, item.tmdbId, configParam, userParam, undefined, posterLang, region.code),
                catalogLogo(stType === "movie" ? "movie" : "tv", item.tmdbId, apiKey, tmdbLang),
              ])
              const { poster, banner, landscapePoster, posterShape } = posterAndShape
              const italianTitle = details?.title || details?.name || item.title
              const background = catalogBackground(details?.backdrop_path ?? null)
              return {
                id: catalogMetaId(imdbId, item.tmdbId),
                type: stType,
                name: italianTitle,
                poster,
                posterShape,
                background,
                banner,
                landscapePoster,
                logo: catalogLogoForShape(posterShape, logo),
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

    // Filtro locale per nome genere (built-in/custom liste): gli addon sono
    // esclusi, la fonte ha già filtrato e qui `genre` può essere un anno
    // (Cinemeta year) o un'etichetta non genere.
    if (extra.genre && extra.genre !== "Tutti" && metas.length > 0 && !isAddonCatalog) {
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

    // Match ancorato come nel ramo platform sopra (riga ~785): un includes()
    // generico su "now" darebbe falsi positivi su id custom ("unknown",
    // "snow-white"). PLATFORM_JW_PACKAGES ha le stesse chiavi di PLATFORM_SLUGS.
    const isPlatformOrJw = catalogId.startsWith("pictorium-jw") || Object.keys(PLATFORM_JW_PACKAGES).some((k) => catalogId === `pictorium-${k}-movies` || catalogId === `pictorium-${k}-series`)
    if (typeof extra.skip === "number" && extra.skip > 0 && (!catalogId.startsWith("pictorium-custom-") || isCustomGenreFiltered) && !isPlatformOrJw) {
      metas = metas.slice(extra.skip)
    }

    const body = { metas }
    // Budget-incomplete custom pages (deadline hit mid-scan/details, lost
    // genre data, unproven stable skip) must not poison the long cache:
    // short TTL like empties so the retry refetches. Healthy 1h/60s and all
    // source TTLs (FlixPatrol/MDBList 12h, JW 6h) are untouched.
    const responseTtl = metas.length > 0
      ? (customBudgetIncomplete ? CATALOG_EMPTY_TTL_MS : CATALOG_TTL_MS)
      : CATALOG_EMPTY_TTL_MS
    cacheSet(cacheKey, body, ["stremio", "catalog"], responseTtl)
    return catalogResponse(body)
  } catch (e) {
    log.error("Catalog error", { error: e instanceof Error ? e.message : String(e) })
    return catalogResponse({ metas: [] })
  }
}
