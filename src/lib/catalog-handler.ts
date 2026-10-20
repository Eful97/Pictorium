import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheGetShared, cacheSet, hashUserFragment } from "@/lib/cache"
import { getTop10 } from "@/lib/flixpatrol"
import { effectiveDefaultsForShape, getServerDefaults, getServerDefaultsChecked, getServerDefaultsForUser, type ServerDefaults } from "@/lib/server-defaults"
import { getScopedUserId, userExists, userRateLimitKey } from "@/lib/user-auth"
import { touchUserActivity } from "@/lib/user-activity"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getById } from "@/lib/store"
import { decodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { getDetails, getDetailsWithExternalIds, getGenreList, getImages, personMovieCredits, personTvCredits, posterUrlOriginal, resolveUserApiKeys, searchMovies, searchPerson, searchTV, tmdbFindByImdb, tmdbFindByTvdb, type TMDBDetails } from "@/lib/tmdb"
import { resolveImdbId } from "@/lib/imdb-cache"
import { fetchMDBList } from "@/lib/mdblist"
import { resolveRankingSource, rankingSourceCatalogName } from "@/lib/ranking-source"
import { findRankingCustomCatalog } from "@/lib/custom-ranking"
import { fetchTop20Ranking } from "@/lib/top20-ranking"
import { buildNoticeMeta, noticeCatalogId, NOTICE_CUSTOM_RANKING_UNAVAILABLE, NOTICE_CUSTOM_RANKING_UNAVAILABLE_DESCRIPTION, NOTICE_CUSTOM_RANKING_UNAVAILABLE_TITLE, NOTICE_MISSING_TVDB_KEY, NOTICE_MISSING_TVDB_KEY_TITLE, NOTICE_MISSING_TVDB_KEY_DESCRIPTION } from "@/lib/notice-meta"
import { fetchUnifiedCatalogResult } from "@/lib/custom-catalog-providers"
import { detectCatalogProvider, isTraktUserContentUrl } from "@/lib/catalog-provider-detect"
import { fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import { parseSupportedTmdbRef } from "@/lib/stremio-addon"
import { buildStremioPosterUrl, stremioPosterShape } from "@/lib/stremio-poster-url"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { getJWRankings, getJWTitles, resolveJWGenreCode, JW_DIGITAL_MONETIZATION_TYPES, type JWRankEntry } from "@/lib/justwatch"
import { getRegionDef, normalizeRegion, parseRegion, GLOBAL_REGION_CODE, type RegionDef } from "@/lib/regions"
import { getCatalogEpoch } from "@/lib/catalog-epoch"
import { createLogger } from "@/lib/logger"
import { concurrentMap } from "@/lib/episode-ordering"
import { envWithFallback } from "@/lib/env-compat"
import { combineAbortSignals } from "@/lib/abort-signal"
import { isPersonQuery, pickTopPerson } from "@/lib/person-search"
import { normalizeCatalogId, normalizeCatalogIdKeys, normalizeCatalogIdList, PICTORIUM_CATALOGS, regionJwName } from "@/lib/catalog-definitions"
import { detectSeasonalThemeFromCatalogName, resolveEffectiveCatalogDisplayName, resolveEffectiveSeasonalTheme, sanitizeSeasonalCustomKeywords, type SeasonalCustomKeywordsInput, type SeasonalTheme } from "@/lib/seasonal-theme"
import { getExplicitCatalogShape, normalizeCatalogShapeKeys } from "@/lib/catalog-shape"
import type { PosterShape, CustomCatalogConfig } from "@/lib/types"

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

/** Versione identità per le chiavi search dedicate: v2 = id IMDb-first via
 *  external_ids + hints video film (`behaviorHints`/`videos:[]`, parità Easy).
 *  Ruota le entry search cachate pre-hints (10 min di TTL breve, scadono
 *  naturalmente) senza toccare le chiavi catalogo. */
const SEARCH_IDENTITY_VERSION = "idv2"

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
  /** Navigazione video solo film (parità Easy): `behaviorHints` con
   *  `defaultVideoId` = id emesso + `hasScheduledVideos:false`, `videos:[]`.
   *  Assente sulle serie (byte-identiche). */
  behaviorHints?: {
    defaultVideoId?: string
    hasScheduledVideos?: boolean
  }
  videos?: Array<{ id: string }>
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

/**
 * "All" / "Tutti" (any case) and missing genre all mean unfiltered: no
 * server-side JW genre code, no tail post-filter, no custom-genre scan, and
 * no genre cache-key fragment. Editorial labels that map to no JW code stay
 * fail-closed (empty) at the call site — this helper only detects the
 * unfiltered set.
 */
function isUnfilteredCatalogGenre(genre?: string | null): boolean {
  if (!genre) return true
  const g = genre.trim().toLowerCase()
  return g === "tutti" || g === "all"
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
  catalogId?: string | null,
  rankBusterParam?: number | string | null,
  seasonalTheme?: SeasonalTheme | null,
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
    rankBuster: rankBusterParam ?? undefined,
    seasonalTheme: seasonalTheme ?? undefined,
  } as const
  // Per-catalog format (TaskB): an explicit poster|landscape override for THIS
  // catalog id always wins (either direction, mapping ignored); absent keys
  // keep the legacy stremioPosterShape behavior byte-identically. The stored
  // mapping is never rewritten and other catalogs are unaffected. Keys are
  // normalized here (legacy posterium-* accepted) so every branch inherits it.
  const explicitShape = catalogId
    ? getExplicitCatalogShape(catalogId, normalizeCatalogShapeKeys(defaults.catalogShapes))
    : undefined
  const posterShape = explicitShape ?? stremioPosterShape(mapping, defaults)
  // Cornice stagionale (contesto effimero del catalogo di origine): viaggia
  // nel `poster` su entrambi i canvas (ognuno rende il proprio asset
  // 500×750 / 768×432, mai stirato) — il banner pulito resta byte-identico
  // (canvas landscape SENZA tema: il builder lo esclude via hideLogo).
  // La scelta per-titolo salvata vince sul contesto lista (esplicita a tema
  // segue il titolo ovunque, `none` lo sopprime, assente = Automatico segue
  // la lista) — vedi resolveEffectiveSeasonalTheme.
  const effectiveTheme = resolveEffectiveSeasonalTheme(mapping?.seasonalTheme ?? null, seasonalTheme ?? null)
  // Global family default map: pure shape-effective SERVER defaults (the
  // `defaults` above may be merged with a config token, which is a config
  // level, not a global default). Cache-only dependency — never a `bp`
  // override, so mapping/config precedence stays intact.
  const poster = buildStremioPosterUrl({
    ...base,
    forceShape: posterShape,
    seasonalTheme: effectiveTheme ?? undefined,
    defaultsBadgePresets: effectiveDefaultsForShape(serverDefaults, posterShape).badgePresets ?? null,
  }).toString()
  // Banner pulito: canvas landscape senza logo baked-in (per i client che
  // sovrappongono già il logo da catalogo) + badge genere in basso a destra.
  const banner = buildStremioPosterUrl({
    ...base,
    forceShape: "landscape",
    hideLogo: true,
    defaultsBadgePresets: effectiveDefaultsForShape(serverDefaults, "landscape").badgePresets ?? null,
  }).toString()
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
 * ID del catalogo Stremio: l'imdbId valido della fonte vince (così Stremio
 * interroga direttamente Pictorium per la risorsa `meta` con l'id portabile
 * `tt...`); senza imdbId valido si ricade sul provider id `tmdb:<id>`.
 * Validazione fail-closed (`tt` + 7-10 cifre, come `isValidImdbId` in
 * `imdb-csv.ts`): stringhe vuote/spurie e numeri nudi non escono mai come
 * id del meta. Normalizzazione in minuscolo: il resolver `/meta` matcha il
 * prefisso `tt` minuscolo.
 */
const CATALOG_IMDB_ID_RE = /^tt\d{7,10}$/i

function catalogMetaId(imdbId: string | null | undefined, tmdbId: number): string {
  const clean = typeof imdbId === "string" ? imdbId.trim() : ""
  if (CATALOG_IMDB_ID_RE.test(clean)) return clean.toLowerCase()
  return `tmdb:${tmdbId}`
}

/**
 * Navigazione video solo film (parità Easy Catalogs): le preview movie
 * espongono `behaviorHints.defaultVideoId` = id emesso giocabile (id IMDb
 * valido nel caso normale, fallback tipato `tmdb:<id>`) con
 * `hasScheduledVideos:false` e `videos:[]` (shape Easy). Unico punto di
 * costruzione: i rami serie restano byte-identici (nessun hint applicato).
 */
function movieCatalogVideoHints(metaId: string): Pick<StremioMeta, "behaviorHints" | "videos"> {
  return { behaviorHints: { defaultVideoId: metaId, hasScheduledVideos: false }, videos: [] }
}

function withMovieCatalogHints(metas: StremioMeta[], stType: StremioCatalogType): StremioMeta[] {
  if (stType !== "movie") return metas
  return metas.map((m) => ({ ...m, ...movieCatalogVideoHints(m.id) }))
}

/**
 * Seasonal frame theme for a Stremio catalog response: detected from the
 * EFFECTIVE visible catalog name (same precedence as the manifest in
 * `build-manifest.ts`: rename > ranking-source override > regional
 * JustWatch name > base name — see `resolveEffectiveCatalogDisplayName`).
 * Custom user keywords (`opts.seasonalKeywords`, same whole-word/phrase
 * rules as the built-ins, Halloween precedence kept) extend the match;
 * built-ins are always retained. Custom lists mirror the manifest split
 * names (`<name> — Film/Serie TV` for `mixed`). Unknown/search ids
 * contribute no base name (ids NEVER match — only display names do). Same
 * title in another list stays unframed; no per-title state is read here
 * (the per-title override is applied per item in
 * `pictoriumPosterAndShape`).
 */
export function resolveCatalogSeasonalTheme(
  catalogId: string,
  stType: "movie" | "series",
  opts: {
    customCatalogs?: readonly CustomCatalogConfig[] | null
    catalogRenames?: Record<string, string> | null | undefined
    rankingSourceMovie?: string | null
    rankingSourceSeries?: string | null
    region: RegionDef
    seasonalKeywords?: SeasonalCustomKeywordsInput | null
  },
): SeasonalTheme | null {
  const rankingName = rankingSourceCatalogName(
    catalogId,
    stType,
    {
      customCatalogs: opts.customCatalogs,
      rankingSourceMovie: opts.rankingSourceMovie,
      rankingSourceSeries: opts.rankingSourceSeries,
    },
  )
  const jwName = regionJwName(catalogId, stType, opts.region)
  let baseName = PICTORIUM_CATALOGS.find((c) => c.id === catalogId)?.name ?? ""
  if (!baseName && catalogId.startsWith("pictorium-custom-")) {
    let customId = catalogId.replace(/^pictorium-custom-/, "")
    if (customId.startsWith("movie-")) customId = customId.slice(6)
    else if (customId.startsWith("series-")) customId = customId.slice(7)
    const found = opts.customCatalogs?.find((c) => c.id === customId)
    if (found && found.enabled !== false && typeof found.name === "string") {
      // Only slots the manifest actually declares (see build-manifest.ts):
      // `mixed` splits into both, single-type (incl. addon) only into its own.
      if (found.type === "mixed") {
        baseName = `${found.name} — ${stType === "movie" ? "Film" : "Serie TV"}`
      } else if (found.type === stType) {
        baseName = found.name
      }
    }
  }
  const effective = resolveEffectiveCatalogDisplayName({
    baseName,
    customName: opts.catalogRenames?.[catalogId],
    rankingName,
    jwName,
  })
  return detectSeasonalThemeFromCatalogName(effective, opts.seasonalKeywords ?? null)
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
      catalogShapes: effectiveDefaults.catalogShapes,
    } as PictoriumUserConfig
  }
  // Config salvate prima del rename possono contenere ID `pictorium-*`:
  // normalizza al canonico `pictorium-*` così filtri/ordini/rinomine restano validi.
  userConfig.disabledCatalogIds = normalizeCatalogIdList(userConfig.disabledCatalogIds)
  userConfig.catalogOrder = normalizeCatalogIdList(userConfig.catalogOrder)
  userConfig.catalogRenames = normalizeCatalogIdKeys(userConfig.catalogRenames)
  userConfig.catalogShapes = normalizeCatalogShapeKeys(userConfig.catalogShapes as Record<string, string> | undefined)
  // Partial token merge: a token carrying only the ranking selection must not
  // lose the custom catalogs stored in the namespace defaults (the selection
  // references them by id). Same rule as the manifest composition.
  if (userConfig.customCatalogs === undefined) userConfig.customCatalogs = effectiveDefaults.customCatalogs
  if (userConfig.rankingSourceMovie === undefined) userConfig.rankingSourceMovie = effectiveDefaults.rankingSourceMovie
  if (userConfig.rankingSourceSeries === undefined) userConfig.rankingSourceSeries = effectiveDefaults.rankingSourceSeries
  // Per-catalog shapes follow the same partial-token rule: a token carrying
  // only the ranking selection must not lose the namespace shape map.
  if (userConfig.catalogShapes === undefined) userConfig.catalogShapes = normalizeCatalogShapeKeys(effectiveDefaults.catalogShapes)
  // Epoch globale + hash dei server defaults: frammenti di freschezza per TUTTI
  // i cache key di questo handler (ricerche + catalogo). Su deploy
  // multi-istanza la `cacheInvalidate("stremio")` del save non raggiunge le
  // altre istanze — senza questi frammenti un body cachato (con vecchi poster
  // URL) resterebbe servito fino alla scadenza (1h). Ogni save
  // (mapping/defaults) fa bump dell'epoch.
  const epoch = await getCatalogEpoch(scopedUser)
  // Freshness covers the whole defaults blob (catalogShapes included) plus the
  // config-token hash below: a per-catalog format change rotates the key via
  // sdHash (namespace save) or cfg (token override) with no extra fragment.
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
      : rankingSource.kind === "justwatch" && rankingSource.mode !== "charts"
        ? `:rsjw_${rankingSource.mode}`
        : ":rsjw"

  // Seasonal frame (ephemeral originating-list context): detected from the
  // effective visible catalog name (rename > ranking override > regional JW
  // > base — same precedence as the manifest). The fragment isolates themed
  // bodies even where the other fragments already differ; the poster URLs
  // below carry `theme=` so the poster cache splits per title too. Custom
  // user keywords (namespace defaults, token override wins) extend the same
  // list-name match; the per-title mapping override is applied per item in
  // `pictoriumPosterAndShape` (mapping version already in the poster key, so
  // no extra fragment is needed here).
  const seasonalKeywords = {
    halloween: sanitizeSeasonalCustomKeywords(
      userConfig?.seasonalHalloweenKeywords ?? effectiveDefaults.seasonalHalloweenKeywords,
    ),
    christmas: sanitizeSeasonalCustomKeywords(
      userConfig?.seasonalChristmasKeywords ?? effectiveDefaults.seasonalChristmasKeywords,
    ),
  }
  const catalogTheme = resolveCatalogSeasonalTheme(catalogId, stType, {
    customCatalogs: userConfig?.customCatalogs,
    catalogRenames: userConfig?.catalogRenames,
    rankingSourceMovie: userConfig?.rankingSourceMovie,
    rankingSourceSeries: userConfig?.rankingSourceSeries,
    region,
    seasonalKeywords,
  })
  const themeFragment = catalogTheme ? `:th${catalogTheme}` : ""

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
      const searchCacheKey = `stremio:search:people:${stType}:${hashFragment(extra.search)}:p${page}:pv${POSTER_URL_VERSION}:${SEARCH_IDENTITY_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${hashFragment(apiKey)}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${regionFragment}${themeFragment}${freshness}`
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
          // IMDb-first come gli altri cataloghi: external_ids leggero e
          // cachato (imdb-cache) con la chiave della richiesta e tetto
          // fail-open — assente/invalido/errore ricade su `tmdb:`, la riga
          // resta servita. Mai un secondo details fetch (i crediti bastano).
          const [imdbId, { poster, banner, landscapePoster, posterShape }] = await Promise.all([
            resolveImdbId(stType === "movie" ? "movie" : "tv", item.id, apiKey, CATALOG_TMDB_TIMEOUT_MS, catalogTimeoutSignal()),
            pictoriumPosterAndShape(req, stType, item.id, configParam, userParam, undefined, posterLang, region.code, catalogId, undefined, catalogTheme),
          ])
          const releaseInfo = (item.release_date || item.first_air_date || "").slice(0, 4) || undefined
          return {
            id: catalogMetaId(imdbId, item.id),
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
        const body = { metas: withMovieCatalogHints(metas, stType) }
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
    const searchCacheKey = `stremio:search:${stType}:${hashFragment(extra.search)}:p${page}:pv${POSTER_URL_VERSION}:${SEARCH_IDENTITY_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${hashFragment(apiKey)}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${regionFragment}${themeFragment}${freshness}`
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
        const { poster, banner, landscapePoster, posterShape } = await pictoriumPosterAndShape(req, stType, foundId, configParam, userParam, undefined, posterLang, region.code, catalogId, undefined, catalogTheme)
        const body = {
          metas: withMovieCatalogHints([
            {
              id: catalogMetaId(imdbQuery, foundId),
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
          ] as StremioMeta[], stType),
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
        // IMDb-first come gli altri cataloghi: external_ids leggero e
        // cachato (imdb-cache) con la chiave della richiesta e tetto
        // fail-open — assente/invalido/errore ricade su `tmdb:`, la riga
        // resta servita. Mai un secondo details fetch (il full-text basta).
        const [imdbId, { poster, banner, landscapePoster, posterShape }] = await Promise.all([
          resolveImdbId(stType === "movie" ? "movie" : "tv", item.id, apiKey, CATALOG_TMDB_TIMEOUT_MS, catalogTimeoutSignal()),
          pictoriumPosterAndShape(req, stType, item.id, configParam, userParam, undefined, posterLang, region.code, catalogId, undefined, catalogTheme),
        ])
        const releaseInfo = (item.release_date || item.first_air_date || "").slice(0, 4) || undefined
        return {
          id: catalogMetaId(imdbId, item.id),
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
      const body = { metas: withMovieCatalogHints(metas, stType) }
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
  const genreFragment = !isUnfilteredCatalogGenre(extra.genre) ? `:g${hashFragment(extra.genre!)}` : ""
  // Frammento search: i cataloghi non-addon non arrivano mai qui con search
  // (intercettata dal ramo TMDB globale), ma gli addon con `search` dichiarato
  // la inoltrano alla fonte — senza, due ricerche diverse colliderebbero.
  const searchFragment = extra.search ? `:q${hashFragment(extra.search)}` : ""
  // Isolamento Trakt autenticato (task 4, correction cycle 1): per i custom
  // catalog Trakt di contenuto-utente (`users/<name>/lists|watchlist`) nel
  // namespace del proprietario, una identità verificata token+generation
  // (snapshot coerente via `getTraktCatalogLease` — mai un token vecchio
  // legato a un fence nuovo) entra nel key come hash (mai plaintext né
  // token). L'identità è stabilita PRIMA di qualsiasi lookup L1/L2: senza
  // identità verificata (fencing illeggibile, connessione persa/transient,
  // OAuth non configurato) la cache esterna è interamente bypassata — né
  // lettura né scrittura di item privati sotto chiavi indovinate (mai più
  // `:tgunknown`). I fallback pubblici indipendenti restano cachabili con
  // le semantiche invariate. Dopo disconnect/wipe/reconnect la chiave
  // cambia: un body con item privati cachato prima del disconnect (L1 o KV
  // L2 condivisa) non viene più servito. Path non-Trakt, globali e
  // `/lists/<id>` numeriche: frammento vuoto, key byte-identiche a prima.
  // (`traktFencedGen` porta il fence verificato per la rivalidazione
  // post-fetch; l'access token dello snapshot non viene mai letto qui.)
  let traktGenFragment = ""
  let traktPrivatePath = false
  let traktFencedGen: string | null | undefined
  let traktUnfencedPrivate = false
  if (scopedUser && catalogId.startsWith("pictorium-custom-")) {
    let customIdForGen = catalogId.replace(/^pictorium-custom-/, "")
    if (customIdForGen.startsWith("movie-")) customIdForGen = customIdForGen.slice(6)
    else if (customIdForGen.startsWith("series-")) customIdForGen = customIdForGen.slice(7)
    const genCat = (userConfig?.customCatalogs as Array<{ id: string; url?: string; enabled?: boolean; addon?: unknown }> | undefined)
      ?.find((c) => c.id === customIdForGen)
    if (genCat && genCat.enabled !== false && !genCat.addon && typeof genCat.url === "string" && isTraktUserContentUrl(genCat.url)) {
      traktPrivatePath = true
      try {
        const { getTraktCatalogLease } = await import("@/lib/trakt-auth")
        const lease = await getTraktCatalogLease(scopedUser)
        if (lease.ok && !lease.noCache) {
          traktFencedGen = lease.generation ?? null
          traktGenFragment = `:tg${hashFragment(lease.generation ?? "none")}`
        } else {
          traktUnfencedPrivate = true
        }
      } catch {
        traktUnfencedPrivate = true
      }
    }
  }
  const cacheKey = `stremio:catalog:v4:${stType}:${catalogId}:pv${POSTER_URL_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${apiKey ? hashFragment(apiKey) : "none"}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${tvdbKey ? `:tv${hashFragment(tvdbKey)}` : ""}${genreFragment}${skipFragment}${searchFragment}${regionFragment}${rankingFragment}${traktGenFragment}${themeFragment}${freshness}`
  // C1: L1 + L2 condivisa (KV su multi-istanza, no-op locale/VPS).
  // Il selettore conserva il TTL originale anche dopo il ripopolamento L1
  // da KV (il payload KV non trasporta la scadenza): pieno → 1h, vuoto → 60s.
  // Su identità Trakt non verificata il lookup è interamente saltato
  // (fail-closed): un body privato cachato prima del disconnect non deve mai
  // essere servito quando la connessione non è più dimostrabile.
  let cached: { metas: StremioMeta[] } | null = null
  if (!traktUnfencedPrivate) {
    cached = await cacheGetShared<{ metas: StremioMeta[] }>(cacheKey, ["stremio", "catalog"], (body) =>
      body?.metas?.length ? CATALOG_TTL_MS : CATALOG_EMPTY_TTL_MS,
    )
    // Rivalidazione dell'hit (correction cycle 1): la sola generation non è
    // identità — a parità di fence ma connessione persa/transient (store
    // token illeggibile, encryption rimossa) l'hit va ignorato e la
    // richiesta prosegue come miss verso il provider (che risponderà con lo
    // stato tipizzato, senza mai servire titoli privati cached).
    if (cached && traktPrivatePath && scopedUser) {
      try {
        const { getTraktCatalogLease: getHitLease } = await import("@/lib/trakt-auth")
        const hitLease = await getHitLease(scopedUser)
        if (!hitLease.ok || hitLease.noCache || (hitLease.generation ?? null) !== traktFencedGen) {
          cached = null
        }
      } catch {
        cached = null
      }
    }
  }
  if (cached) return catalogResponse(cached)

  let isCustomGenreFiltered = false
  let isJwGenrePreFiltered = false
  // Provenienza privata del provider per la coerenza outer-cache (correction
  // cycle 1): true quando il body in costruzione contiene item fetchati con
  // il Bearer del proprietario. Vedi coda della funzione prima del cacheSet.
  let traktPrivateServed = false
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
            const posterAndShape = await pictoriumPosterAndShape(req, stType, tmdbId, configParam, userParam, undefined, posterLang, region.code, catalogId, undefined, catalogTheme)
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

        const providerResult = await fetchUnifiedCatalogResult(customCat2.url, { apiKey, mdblistKey, tvdbKey, limit: 500, datasetId: customCat2.datasetId, userId: scopedUser, traktUserId: scopedUser, signal: customBudgetSignal })
        // Interrupted provider pagination (abort/page error) is servable
        // but partial: flag it so the body caches short (60s) and the retry
        // refetches instead of freezing a shifted window for an hour.
        if (providerResult.incomplete) customBudgetIncomplete = true
        // Auth Trakt non risolta (disconnesso/transient/fencing illeggibile):
        // il body (vuoto o pubblico) non deve mai congelare a lungo — stati
        // espliciti, mai downgrade silenziosi, retry alla riconnessione.
        // Su identità non verificata la cache esterna è comunque bypassata
        // (vedi lookup sopra e coda prima del cacheSet).
        if (
          providerResult.status === "connection_required" ||
          providerResult.status === "temporary" ||
          traktUnfencedPrivate
        ) {
          customBudgetIncomplete = true
        }
        traktPrivateServed = providerResult.traktPrivate === true
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
        isCustomGenreFiltered = !isUnfilteredCatalogGenre(extra.genre)

        // Stable pagination in source order: dedupe on globally-unique
        // resolved TMDB ids BEFORE applying skip/page-20 — never slice raw
        // candidates first (raw duplicates/unresolvable rows before the
        // window would otherwise short-change the page and shift later
        // pages). The scan resolves bounded 20-row strides in order and
        // stops once the window proves full (skip+20 unique, or the first
        // 100 unique when a genre filter applies at the tail), so the first
        // page of an indexed list costs zero /find calls and a late-tail
        // page never resolves all 500 rows. Direct tmdb ids dedupe with no
        // I/O but keep source order.
        const uniqueTarget = isCustomGenreFiltered ? 100 : skip + 20
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

        // Pipelined per-item (no whole-batch barrier): details then
        // imdb/poster/logo sequentially within each item task, concurrency 5
        // across titles. A fast item's enrichment no longer waits for a slow
        // item's details; order preserved by concurrentMap index slots.
        let detailsTransientFailure = false
        metas = (await concurrentMap(pagedItems, async (item): Promise<StremioMeta | null> => {
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
          const r = {
            tmdbId,
            imdb: item.imdb,
            title,
            releaseInfo,
            genres: (details?.genres || []).map((g) => g.name).filter(Boolean),
            backdropPath: details?.backdrop_path ?? null,
            description: details?.overview ?? undefined,
            voteAverage: details?.vote_average ?? undefined,
          }
          // Final enrichment rides the same shared deadline: per-step caps
          // via combined signals, cancellation at the 10s bound, no extra
          // background work past it.
          const enrichSignal = combineAbortSignals(customBudgetSignal, CATALOG_TMDB_TIMEOUT_MS)
          const [imdbId, posterAndShape, logo] = await Promise.all([
            r.imdb ? Promise.resolve(r.imdb) : resolveImdbId(stType === "movie" ? "movie" : "tv", r.tmdbId, apiKey, CATALOG_TMDB_TIMEOUT_MS, enrichSignal),
            // No list-positional rank is injected here: the badge rank resolves
            // live at render from the explicitly selected ranking source
            // (JustWatch default, or a deliberately chosen custom list via the
            // trendRank channel). Passing the list position as `animerank`
            // made every imported list behave as its own ranking source and
            // let it override the selected source (animeRank wins over
            // trendRank in badge precedence). The anime catalog branch below
            // keeps its genuine MDBList-chart `animerank`.
            pictoriumPosterAndShape(req, stType, r.tmdbId, configParam, userParam, undefined, posterLang, region.code, catalogId, undefined, catalogTheme),
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
        }, 5)).filter((m): m is StremioMeta => m !== null)
        if (customBudgetSignal.aborted) customBudgetIncomplete = true
        if (detailsTransientFailure) customBudgetIncomplete = true
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
      let uniqueRows: Array<{ tmdbId: number; imdbId: string | null; title?: string | null | undefined; rank?: number | string | null }>
      const isJwPopularOrTrending =
        rankingSource.kind === "justwatch" &&
        (rankingSource.mode === "popular" || rankingSource.mode === "trending")

      if (isJwPopularOrTrending) {
        // Paginazione Stremio per Popolarità / Tendenze:
        // - Regione Mondiale (GL): popular/trending non supportati (fail-closed, nessun fallback nazionale).
        // - Genere: applicato server-side nella query JustWatch prima di offset; categorie non mappabili → vuoto.
        // - Pagine richieste via skip (offset=skip, first=20), overfetch disattivato per finestre disgiunte.
        if (region.code === GLOBAL_REGION_CODE) {
          return catalogResponse({ metas: [] })
        }
        const hasGenre = !isUnfilteredCatalogGenre(extra.genre)
        const jwGenreCode = hasGenre ? resolveJWGenreCode(extra.genre) : null
        if (hasGenre && !jwGenreCode) {
          // Categorie editoriali fuori scope (Supereroi, Vacanze, Commedie horror) → vuoto fail-closed
          return catalogResponse({ metas: [] })
        }
        if (hasGenre) {
          isJwGenrePreFiltered = true
        }
        const jwSortBy = rankingSource.mode === "popular" ? "POPULAR" : "TRENDING"
        const jwSkip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
        const rows = await getJWTitles({
          objectType: stType === "movie" ? "MOVIE" : "SHOW",
          country: region.code,
          first: 20,
          offset: jwSkip,
          sortBy: jwSortBy,
          language: tmdbLang,
          monetizationTypes: JW_DIGITAL_MONETIZATION_TYPES,
          genres: jwGenreCode ? [jwGenreCode] : undefined,
          overfetch: false,
        })
        // Canonical Top-20 snapshot (ONE per request, shared 6h JW cache with
        // the renderer — never per-title): maps page rows at arbitrary skip
        // to their exact global rank. Genre-local or platform-local positions
        // are never used as global rank — lookup is by tmdbId against the
        // unfiltered snapshot, unranked titles get explicit rk=0.
        let canonicalRank: Map<number, number> | null = null
        if (rows.length > 0) {
          try {
            const snapshot = await fetchTop20Ranking({
              slot: stType,
              source: rankingSource,
              regionCode: region.code,
              regionLang: tmdbLang,
              customCatalogs: userConfig?.customCatalogs,
              apiKey,
              mdblistKey,
              tvdbKey,
              userId: scopedUser,
            })
            if (snapshot.items.length > 0) {
              canonicalRank = new Map(snapshot.items.map((it) => [it.tmdbId, it.rank]))
            }
          } catch {
            canonicalRank = null
          }
        }
        uniqueRows = rows.map((r, idx) => {
          if (canonicalRank) {
            // Same title → same URL on every page (skip 0/5/19/20) and in
            // genre drill-downs: exact global rank, or explicit unranked.
            return { tmdbId: r.tmdbId, imdbId: r.imdbId || null, title: r.title || null, rank: canonicalRank.get(r.tmdbId) ?? 0 }
          }
          // Snapshot unavailable (fail-closed legacy): only window-proven claims.
          const isTop20Window = !hasGenre && jwSkip === 0 && idx < 20
          const rank = isTop20Window ? (idx + 1) : (jwSkip >= 20 ? 0 : undefined)
          return { tmdbId: r.tmdbId, imdbId: r.imdbId || null, title: r.title || null, rank }
        })
      } else {
        // Custom e Classifiche storiche: mantengono il comportamento Top 20 (skip >= 20 vuoto)
        const top20Skip = typeof extra.skip === "number" && extra.skip > 0 ? extra.skip : 0
        if (top20Skip >= 20) {
          // Windowed Top-N: pages past the Top 20 are strictly empty.
          uniqueRows = []
        } else {
          const ranking = await fetchTop20Ranking({
            slot: stType,
            source: rankingSource,
            regionCode: region.code,
            regionLang: tmdbLang,
            customCatalogs: userConfig?.customCatalogs,
            apiKey,
            mdblistKey,
            tvdbKey,
            userId: scopedUser,
          })
          if (ranking.status === "error") {
            log.debug("Top 20 ranking unavailable", { catalogId, status: ranking.errorStatus })
            return catalogResponse({
              metas: [buildNoticeMeta({
                type: stType,
                poster: `${getOriginFromRequest(req)}/pictorium.png`,
                id: noticeCatalogId(NOTICE_CUSTOM_RANKING_UNAVAILABLE),
                name: NOTICE_CUSTOM_RANKING_UNAVAILABLE_TITLE,
                description: `${NOTICE_CUSTOM_RANKING_UNAVAILABLE_DESCRIPTION} (lista: ${rankingCustom?.name ?? "custom"}, stato: ${ranking.errorStatus})`,
              })],
            })
          }
          uniqueRows = ranking.items
            .slice(top20Skip, top20Skip + 20)
            .map((item) => ({ tmdbId: item.tmdbId, imdbId: item.imdbId, title: item.title, rank: item.rank }))
        }
      }

      // Pipelined per-item (no whole-batch barrier): details then
      // imdb/poster/logo sequentially within each item task, concurrency 5
      // across titles. A fast item's enrichment no longer waits for a slow
      // item's details; order preserved by concurrentMap index slots.
      metas = (await concurrentMap(uniqueRows, async (row): Promise<StremioMeta | null> => {
        // D4: external_ids in append — niente secondo fetch per-titolo.
        // Tetto fail-open: uno straggler non appende tutto il catalogo.
        let d: Awaited<ReturnType<typeof getDetailsWithExternalIds>> | null = null
        try {
          const fetched = await getDetailsWithExternalIds(stType === "movie" ? "movie" : "tv", row.tmdbId, tmdbLang, apiKey, catalogTimeoutSignal(), CATALOG_TMDB_TIMEOUT_MS)
          if (fetched?.id) d = fetched
        } catch {
          // Fail-open come il ramo piattaforme: il titolo JustWatch resta
          // anche senza dettagli (prima la riga veniva scartata del tutto).
          d = null
        }
        if (!d && !(row.title && row.title.length > 0)) return null
        const [imdbId, posterAndShape, logo] = await Promise.all([
          row.imdbId || d?.external_ids?.imdb_id || null,
          pictoriumPosterAndShape(req, stType, row.tmdbId, configParam, userParam, undefined, posterLang, region.code, catalogId, row.rank, catalogTheme),
          apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", row.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
        ])
        const { poster, banner, landscapePoster, posterShape } = posterAndShape
        const background = catalogBackground(d?.backdrop_path ?? null)
        return {
          id: catalogMetaId(imdbId, row.tmdbId),
          type: stType,
          name: d?.title || d?.name || row.title || "",
          poster,
          posterShape,
          background,
          banner,
          landscapePoster,
          logo: catalogLogoForShape(posterShape, logo),
          releaseInfo: (d?.release_date || d?.first_air_date || "").slice(0, 4) || undefined,
          imdbRating: d?.vote_average ? d.vote_average.toFixed(1) : undefined,
          genres: (d?.genres || []).map((g) => g.name).filter(Boolean),
          description: d?.overview ?? undefined,
        }
      }, 5)).filter((m): m is StremioMeta => m !== null)
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
      // Pipelined per-item (no whole-batch barrier): resolve/details then
      // imdb/poster/logo sequentially within each item task, concurrency 5
      // across titles. Order preserved by concurrentMap index slots.
      metas = (await concurrentMap(pagedItems, async (item, idx): Promise<StremioMeta | null> => {
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
        const rank = animeSkip + idx + 1
        const [imdbId, posterAndShape, logo] = await Promise.all([
          item.imdb ? Promise.resolve(item.imdb) : resolveImdbId(mediaType, tmdbId, apiKey, CATALOG_TMDB_TIMEOUT_MS),
          pictoriumPosterAndShape(req, stType, tmdbId, configParam, userParam, rank, posterLang, region.code, catalogId, undefined, catalogTheme),
          apiKey ? catalogLogo(mediaType, tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
        ])
        const { poster, banner, landscapePoster, posterShape } = posterAndShape
        const background = catalogBackground(d?.backdrop_path ?? null)
        const name = d?.title || d?.name || item.title || "Anime"
        const releaseInfo = (d?.release_date || d?.first_air_date || (item.year ? String(item.year) : "")).slice(0, 4) || undefined
        return {
          id: catalogMetaId(imdbId, tmdbId),
          type: stType,
          name,
          poster,
          posterShape,
          background,
          banner,
          landscapePoster,
          logo: catalogLogoForShape(posterShape, logo),
          releaseInfo,
          imdbRating: d?.vote_average ? d.vote_average.toFixed(1) : undefined,
          genres: (d?.genres || []).map((g) => g.name).filter(Boolean),
          description: d?.overview ?? undefined,
        }
      }, 5)).filter((m): m is StremioMeta => m !== null)
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

          // Pipelined per-item (no whole-batch barrier): details then
          // imdb/poster/logo sequentially within each item task, concurrency
          // 5 across titles. Order preserved by concurrentMap index slots.
          metas = (await concurrentMap(uniqueJwRows, async (row): Promise<StremioMeta | null> => {
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
            if (title.length === 0) return null
            const [imdbId, posterAndShape, logo] = await Promise.all([
              row.imdbId || details?.external_ids?.imdb_id || null,
              pictoriumPosterAndShape(req, stType, row.tmdbId, configParam, userParam, undefined, posterLang, region.code, catalogId, undefined, catalogTheme),
              apiKey ? catalogLogo(stType === "movie" ? "movie" : "tv", row.tmdbId, apiKey, tmdbLang) : Promise.resolve(undefined),
            ])
            const { poster, banner, landscapePoster, posterShape } = posterAndShape
            const background = catalogBackground(details?.backdrop_path ?? null)
            return {
              id: catalogMetaId(imdbId, row.tmdbId),
              type: stType,
              name: title,
              poster,
              posterShape,
              background,
              banner,
              landscapePoster,
              logo: catalogLogoForShape(posterShape, logo),
              releaseInfo: (details?.release_date || details?.first_air_date || "").slice(0, 4) || undefined,
              imdbRating: details?.vote_average ? details.vote_average.toFixed(1) : undefined,
              genres: (details?.genres || []).map((g) => g.name).filter(Boolean),
              description: details?.overview ?? undefined,
            }
          }, 5)).filter((m): m is StremioMeta => m !== null)
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
                pictoriumPosterAndShape(req, stType, item.tmdbId, configParam, userParam, undefined, posterLang, region.code, catalogId, undefined, catalogTheme),
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

    // Filtro locale per nome genere (built-in/custom liste): gli addon e
    // le query JustWatch già pre-filtrate server-side sono escluse.
    if (!isUnfilteredCatalogGenre(extra.genre) && metas.length > 0 && !isAddonCatalog && !isJwGenrePreFiltered) {
      const gLower = (extra.genre as string).toLowerCase()
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

    // Navigazione video solo film (parità Easy Catalogs): il ramo addon
  // preserva il passthrough remoto (nessun hint sintetico Pictorium).
  const body = { metas: !isAddonCatalog ? withMovieCatalogHints(metas, stType) : metas }
    // Coerenza outer-cache ↔ provider fetch (correction cycle 1, solo path
    // Trakt privati con item owner-fetchati): un fence mai verificato per
    // questa richiesta serve fresco senza mai persistere; un fence
    // verificato pre-fetch è ricontrollato dopo il fetch e, se mosso
    // (disconnect/wipe/reconnect durante la fetch), il body è soppresso
    // invece di essere servito o cachato sotto il vecchio fence.
    if (traktPrivatePath && traktPrivateServed && metas.length > 0) {
      if (traktUnfencedPrivate) {
        return catalogResponse(body)
      }
      if (scopedUser) {
        try {
          const { getTraktCatalogLease: getPostLease } = await import("@/lib/trakt-auth")
          const postLease = await getPostLease(scopedUser)
          if (!postLease.ok || postLease.noCache || (postLease.generation ?? null) !== traktFencedGen) {
            return catalogResponse({ metas: [] })
          }
        } catch {
          return catalogResponse({ metas: [] })
        }
      }
    }
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
