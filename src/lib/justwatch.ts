import { hasDigitalOffer } from "./pre-release"
import { combineAbortSignals } from "./abort-signal"

// Sovrascrivibile via env: nei test E2E punta al mock server locale.
const JW_API = process.env.JUSTWATCH_API_URL || "https://apis.justwatch.com/graphql"

const QUERY = `query GetStreamingChartInfo($country: Country!, $language: Language!, $filter: StreamingChartsFilter, $first: Int!) {
  streamingCharts(country: $country, filter: $filter, first: $first) {
    edges {
      streamingChartInfo { rank }
      node {
        ... on MovieOrShowOrSeason {
          content(country: $country, language: $language) {
            title
            originalReleaseDate
            externalIds { tmdbId imdbId }
          }
        }
      }
    }
  }
}`

export interface JWRankEntry {
  tmdbId: number
  /** IMDb id restituito da JustWatch stesso — evita la chiamata extra a TMDB. */
  imdbId: string | null
  rank: number
  title?: string | null
}

export const PLATFORM_JW_PACKAGES: Record<string, string[]> = {
  netflix: ["nfx"],
  "amazon-prime": ["prv"],
  prime: ["prv"],
  disney: ["dnp"],
  "disney-plus": ["dnp"],
  now: ["ntv", "skg"],
  "now-tv": ["ntv", "skg"],
  "apple-tv": ["atp"],
  apple: ["atp"],
  "hbo-max": ["mxx"],
  hbo: ["mxx"],
  "paramount-plus": ["pmp"],
  paramount: ["pmp"],
  crunchyroll: ["cru"],
}

export const JW_GENRE_MAP: Record<string, string> = {
  azione: "act",
  action: "act",
  "action & adventure": "act",
  "acción": "act",
  accion: "act",
  "ação": "act",
  acao: "act",
  animazione: "ani",
  animation: "ani",
  "animación": "ani",
  animacion: "ani",
  "animação": "ani",
  animacao: "ani",
  commedia: "cmy",
  comedy: "cmy",
  "comédie": "cmy",
  comedie: "cmy",
  comedia: "cmy",
  "komödie": "cmy",
  "komodie": "cmy",
  "comédia": "cmy",
  crimine: "crm",
  crime: "crm",
  crimen: "crm",
  krimi: "crm",
  documentario: "doc",
  documentary: "doc",
  documentaire: "doc",
  documental: "doc",
  dokumentarfilm: "doc",
  "documentário": "doc",
  dramma: "drm",
  drama: "drm",
  drame: "drm",
  famiglia: "fml",
  family: "fml",
  famille: "fml",
  familia: "fml",
  familie: "fml",
  "família": "fml",
  fantascienza: "scf",
  "sci-fi": "scf",
  "science fiction": "scf",
  "science-fiction": "scf",
  "sci-fi & fantasy": "scf",
  "ciencia ficción": "scf",
  "ciencia ficcion": "scf",
  "ficção científica": "scf",
  "ficcao cientifica": "scf",
  fantasy: "fnt",
  fantastique: "fnt",
  "fantasía": "fnt",
  "fantasia": "fnt",
  guerra: "war",
  war: "war",
  "war & politics": "war",
  guerre: "war",
  horror: "hrr",
  horreur: "hrr",
  terror: "hrr",
  musica: "msc",
  music: "msc",
  musique: "msc",
  "música": "msc",
  musik: "msc",
  romance: "rma",
  romantico: "rma",
  romantik: "rma",
  storia: "hst",
  history: "hst",
  histoire: "hst",
  historia: "hst",
  geschichte: "hst",
  "história": "hst",
  thriller: "trl",
  western: "wsn",
  faroeste: "wsn",
  sport: "spt",
  deporte: "spt",
  esporte: "spt",
}

export function resolveJWGenreCode(genreName?: string | null): string | null {
  if (!genreName) return null
  const direct = lookupJWGenreCode(genreName)
  if (direct) return direct
  // Stremio doppia-encoda i generi (es. "Science Fiction" → "%2520"): il parse
  // dell'extra decodifica una sola volta, quindi qui arriva ancora encodato.
  // Un secondo decode condizionale (solo se cambia la stringa) risolve il 100%
  // dei filtri rotti senza mai alterare un nome genuino.
  if (genreName.includes("%")) {
    try {
      const decoded = decodeURIComponent(genreName)
      if (decoded !== genreName) return lookupJWGenreCode(decoded)
    } catch {
      // Escape sequence malformata — resta irrisolto, il chiamante degrada al post-filtro
    }
  }
  return null
}

function stripDiacritics(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function lookupJWGenreCode(genreName: string): string | null {
  const cleaned = genreName.toLowerCase().trim()
  if (cleaned === "tutti" || cleaned === "all") return null
  const direct = JW_GENRE_MAP[cleaned]
  if (direct) return direct
  const stripped = stripDiacritics(cleaned)
  if (stripped !== cleaned) {
    return JW_GENRE_MAP[stripped] ?? null
  }
  return null
}

const rankingsCache = new Map<string, { data: JWRankEntry[]; timestamp: number }>()
const CACHE_TTL = 30 * 60 * 1000
const CACHE_MAX = 100

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

let ddCookie: string | null = null

function captureCookie(headers?: Headers): void {
  if (!headers) return
  try {
    let raw: string[] = []
    if (typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function") {
      raw = (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    } else {
      const single = headers.get("set-cookie")
      if (single) raw = [single]
    }
    for (const line of raw) {
      const m = /datadome=([^;\s]+)/.exec(line)
      if (m) {
        ddCookie = `datadome=${m[1]}`
        break
      }
    }
  } catch {
    // Ignora errori di parsing header
  }
}

function jwHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Language": "it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": UA,
    Origin: "https://www.justwatch.com",
    Referer: "https://www.justwatch.com/",
    "X-Platform": "WEB",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
  }
  if (ddCookie) {
    headers["Cookie"] = ddCookie
  }
  return headers
}

interface CircuitBreakerState {
  consecutiveFailures: number
  cooldownUntil: number
}

const circuitState: CircuitBreakerState = {
  consecutiveFailures: 0,
  cooldownUntil: 0,
}

const CIRCUIT_FAILURE_THRESHOLD = 5
const CIRCUIT_COOLDOWN_DEFAULT_MS = 60_000 // 60s per 5xx/timeout ripetuti
const CIRCUIT_COOLDOWN_BLOCK_MS = 300_000 // 5 min su 403 (DataDome block)

function isCircuitOpen(): boolean {
  if (circuitState.cooldownUntil === 0) return false
  if (Date.now() >= circuitState.cooldownUntil) {
    circuitState.cooldownUntil = 0
    circuitState.consecutiveFailures = 0
    return false
  }
  return true
}

function recordCircuitSuccess(): void {
  circuitState.consecutiveFailures = 0
  circuitState.cooldownUntil = 0
}

function recordCircuitFailure(status?: number): void {
  circuitState.consecutiveFailures++
  if (status === 403) {
    circuitState.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_BLOCK_MS
  } else if (circuitState.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuitState.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_DEFAULT_MS
  }
}

function usablePayload(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === "object" &&
    Object.values(data as Record<string, unknown>).some((v) => v !== null)
  )
}

export async function getJWRankings(
  objectType: "MOVIE" | "SHOW",
  country = "IT",
  first = 20,
  packages?: readonly string[] | string[],
  language = "it-IT",
  // R3: signal esterno (es. deadline render) combinato col timeout interno —
  // senza, il fetch sopravvive al watchdog come zombie.
  signal?: AbortSignal,
): Promise<JWRankEntry[]> {
  const pkgKey = packages && packages.length > 0 ? packages.join(",") : "all"
  // La lingua entra nella key: i titoli JW seguono la lingua query.
  const cacheKey = `${objectType}:${country}:${first}:${pkgKey}:${language}`
  const cached = rankingsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  if (isCircuitOpen()) {
    return []
  }

  const filter: Record<string, unknown> = {
    objectType,
    category: "DAILY_POPULARITY_SAME_CONTENT_TYPE",
  }
  if (packages && packages.length > 0) {
    filter.packages = packages
  }

  let res: Response
  try {
    res = await fetch(JW_API, {
      method: "POST",
      headers: jwHeaders(),
      signal: combineAbortSignals(signal, 8000),
      body: JSON.stringify({
        operationName: "GetStreamingChartInfo",
        query: QUERY,
        variables: {
          country,
          language,
          filter,
          first: Math.max(first * 2, 20),
        },
      }),
    })
  } catch (err) {
    recordCircuitFailure()
    throw err
  }

  captureCookie(res.headers)

  if (!res.ok) {
    recordCircuitFailure(res.status)
    throw new Error(`JustWatch ${objectType} failed: ${res.status}`)
  }

  const json = await res.json()
  if (json.errors && !usablePayload(json.data)) {
    recordCircuitFailure()
    throw new Error(`JustWatch ${objectType} GraphQL error: ${json.errors[0]?.message || "unknown"}`)
  }

  recordCircuitSuccess()

  const edges = json?.data?.streamingCharts?.edges || []
  const seenTmdb = new Set<number>()
  const result: JWRankEntry[] = []
  // Gli streamingCharts includono titoli annunciati ma non ancora usciti:
  // scarta le date future (stesso criterio di getJWTitles/isUnreleased).
  // Data mancante = rilasciato (mai nascondere per metadati incompleti).
  const today = new Date().toISOString().slice(0, 10)

  for (const e of edges) {
    const tmdbId = Number(e?.node?.content?.externalIds?.tmdbId)
    const imdbId = e?.node?.content?.externalIds?.imdbId || null
    const title = e?.node?.content?.title || null
    const relDate = e?.node?.content?.originalReleaseDate
    const rank = e?.streamingChartInfo?.rank
    if (!tmdbId || !rank || seenTmdb.has(tmdbId)) continue
    if (relDate && relDate > today) continue
    seenTmdb.add(tmdbId)
    result.push({ tmdbId, imdbId, rank, title })
    if (result.length >= first) break
  }

  if (result.length > 0) {
    if (rankingsCache.size >= CACHE_MAX) rankingsCache.delete(rankingsCache.keys().next().value!)
    rankingsCache.set(cacheKey, { data: result, timestamp: Date.now() })
  }
  return result
}

const GET_POPULAR_TITLES_QUERY = `query GetPopularTitles(
  $country: Country!
  $language: Language!
  $filter: TitleFilter
  $first: Int!
  $sortBy: PopularTitlesSorting!
  $offset: Int = 0
) {
  popularTitles(
    country: $country
    filter: $filter
    first: $first
    sortBy: $sortBy
    offset: $offset
  ) {
    edges {
      node {
        objectType
        content(country: $country, language: $language) {
          title
          originalReleaseDate
          externalIds { tmdbId imdbId }
        }
      }
    }
  }
}`

export interface JWTitleOptions {
  objectType: "MOVIE" | "SHOW"
  country?: string
  first?: number
  offset?: number
  packages?: readonly string[] | string[]
  genres?: readonly string[] | string[]
  sortBy?: "POPULAR" | "TRENDING" | "RELEASE_YEAR"
  language?: string
}

export async function getJWTitles(opts: JWTitleOptions): Promise<JWRankEntry[]> {
  const {
    objectType,
    country = "IT",
    first = 20,
    offset = 0,
    packages,
    genres,
    sortBy = "POPULAR",
    language = "it-IT",
  } = opts

  const pkgKey = packages && packages.length > 0 ? packages.join(",") : "all"
  const genreKey = genres && genres.length > 0 ? genres.join(",") : "all"
  const cacheKey = `titles:${objectType}:${country}:${first}:${offset}:${sortBy}:${pkgKey}:${genreKey}:${language}`

  const cached = rankingsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  if (isCircuitOpen()) {
    return []
  }

  const filter: Record<string, unknown> = {
    objectTypes: [objectType],
  }
  if (packages && packages.length > 0) {
    filter.packages = packages
  }
  if (genres && genres.length > 0) {
    filter.genres = genres
  }
  if (sortBy === "RELEASE_YEAR") {
    filter.releaseYear = { max: new Date().getFullYear() }
  }

  let res: Response
  try {
    res = await fetch(JW_API, {
      method: "POST",
      headers: jwHeaders(),
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        operationName: "GetPopularTitles",
        query: GET_POPULAR_TITLES_QUERY,
        variables: {
          country,
          language,
          filter,
          first: Math.min(Math.max(first * 2, 20), 60),
          sortBy,
          offset,
        },
      }),
    })
  } catch (err) {
    recordCircuitFailure()
    throw err
  }

  captureCookie(res.headers)

  if (!res.ok) {
    recordCircuitFailure(res.status)
    throw new Error(`JustWatch titles ${objectType} failed: ${res.status}`)
  }

  const json = await res.json()
  if (json.errors && !usablePayload(json.data)) {
    recordCircuitFailure()
    throw new Error(`JustWatch titles ${objectType} GraphQL error: ${json.errors[0]?.message || "unknown"}`)
  }

  recordCircuitSuccess()

  const edges = json?.data?.popularTitles?.edges || []
  const seenTmdb = new Set<number>()
  const result: JWRankEntry[] = []
  const today = new Date().toISOString().slice(0, 10)

  let rank = offset + 1
  for (const e of edges) {
    const tmdbId = Number(e?.node?.content?.externalIds?.tmdbId)
    const imdbId = e?.node?.content?.externalIds?.imdbId || null
    const title = e?.node?.content?.title || null
    const relDate = e?.node?.content?.originalReleaseDate

    if (sortBy === "RELEASE_YEAR" && relDate && relDate > today) {
      continue
    }

    if (!tmdbId || seenTmdb.has(tmdbId)) continue
    seenTmdb.add(tmdbId)
    result.push({ tmdbId, imdbId, rank, title })
    rank++
    if (result.length >= first) break
  }

  if (result.length > 0) {
    if (rankingsCache.size >= CACHE_MAX) rankingsCache.delete(rankingsCache.keys().next().value!)
    rankingsCache.set(cacheKey, { data: result, timestamp: Date.now() })
  }
  return result
}

const TITLE_OFFERS_QUERY = `query GetTitleOffers($country: Country!, $language: Language!, $filter: TitleFilter) {
  popularTitles(country: $country, filter: $filter, first: 5) {
    edges {
      node {
        content(country: $country, language: $language) {
          title
          externalIds { tmdbId imdbId }
        }
        offers(country: $country, platform: WEB) {
          monetizationType
          presentationType
        }
      }
    }
  }
}`

export type JWQuality = "4K" | "1080p" | "SD"

export function resolveMaxQuality(presentationTypes: (string | null | undefined)[]): JWQuality | null {
  const types = presentationTypes.filter(Boolean).map((t) => String(t).toUpperCase())
  if (types.some((t) => t.includes("4K") || t.includes("UHD") || t.includes("2160") || t.includes("_4K"))) {
    return "4K"
  }
  if (types.some((t) => t.includes("HD") || t.includes("1080") || t.includes("720") || t.includes("_1080P") || t.includes("HD_1080"))) {
    return "1080p"
  }
  if (types.some((t) => t.includes("SD") || t.includes("480"))) {
    return "SD"
  }
  return null
}

const qualityCache = new Map<string, { data: JWQuality | null; timestamp: number }>()

export async function getJWTitleQuality(
  tmdbId: number,
  objectType: "MOVIE" | "SHOW",
  searchTitle?: string | null,
  country = "IT",
  signal?: AbortSignal,
  language = "it-IT",
): Promise<JWQuality | null> {
  const cacheKey = `${objectType}:${country}:${tmdbId}`
  const cached = qualityCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  if (isCircuitOpen()) {
    return null
  }

  try {
    const filter: Record<string, unknown> = {
      objectTypes: [objectType],
    }
    if (searchTitle) {
      filter.searchQuery = searchTitle
    }

    const timeoutSignal = AbortSignal.timeout(4000)
    let combinedSignal: AbortSignal = timeoutSignal
    if (signal) {
      if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
        combinedSignal = (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
      } else {
        const ctrl = new AbortController()
        const onAbort = () => ctrl.abort((signal as unknown as { reason?: unknown })?.reason ?? timeoutSignal.reason)
        if (signal.aborted || timeoutSignal.aborted) ctrl.abort()
        else {
          signal.addEventListener("abort", onAbort, { once: true })
          timeoutSignal.addEventListener("abort", onAbort, { once: true })
        }
        combinedSignal = ctrl.signal
      }
    }

    const res = await fetch(JW_API, {
      method: "POST",
      headers: jwHeaders(),
      signal: combinedSignal,
      body: JSON.stringify({
        operationName: "GetTitleOffers",
        query: TITLE_OFFERS_QUERY,
        variables: {
          country,
          language,
          filter,
        },
      }),
    })
    captureCookie(res.headers)
    if (!res.ok) {
      recordCircuitFailure(res.status)
      return null
    }
    const json = await res.json()
    if (json.errors && !usablePayload(json.data)) {
      recordCircuitFailure()
      return null
    }
    recordCircuitSuccess()

    const edges = json?.data?.popularTitles?.edges || []

    let matchedNode = null
    for (const e of edges) {
      const edgeTmdbId = Number(e?.node?.content?.externalIds?.tmdbId)
      if (edgeTmdbId === tmdbId) {
        matchedNode = e.node
        break
      }
    }
    if (!matchedNode && searchTitle && edges.length > 0) {
      matchedNode = edges[0].node
    }

    const offers = (matchedNode?.offers || []) as Array<{ presentationType?: string }>
    const presTypes = offers.map((o) => o.presentationType)
    const maxQ = resolveMaxQuality(presTypes)

    if (qualityCache.size >= CACHE_MAX) qualityCache.delete(qualityCache.keys().next().value!)
    qualityCache.set(cacheKey, { data: maxQ, timestamp: Date.now() })
    return maxQ
  } catch {
    recordCircuitFailure()
    return null
  }
}

const availabilityCache = new Map<string, { data: boolean | null; timestamp: number }>()

/**
 * True se il titolo ha almeno un'offerta streaming/digitale (noleggio,
 * acquisto o abbonamento) nel paese dato, false se nessuna, null se il dato
 * è ignoto (errore fetch o titolo non trovato). Riusa `TITLE_OFFERS_QUERY`:
 * la presenza di offerte — non il loro tipo — è il segnale di disponibilità.
 * Solo film: le serie seguono la first_air_date, già coperta altrove.
 */
export async function hasJWOffers(
  tmdbId: number,
  objectType: "MOVIE" | "SHOW",
  searchTitle?: string | null,
  country = "IT",
  signal?: AbortSignal,
  language = "it-IT",
): Promise<boolean | null> {
  const cacheKey = `avail:${objectType}:${country}:${tmdbId}`
  const cached = availabilityCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  if (isCircuitOpen()) {
    return null
  }

  try {
    const filter: Record<string, unknown> = {
      objectTypes: [objectType],
    }
    if (searchTitle) {
      filter.searchQuery = searchTitle
    }

    const timeoutSignal = AbortSignal.timeout(4000)
    let combinedSignal: AbortSignal = timeoutSignal
    if (signal) {
      if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
        combinedSignal = (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([signal, timeoutSignal])
      } else {
        const ctrl = new AbortController()
        const onAbort = () => ctrl.abort((signal as unknown as { reason?: unknown })?.reason ?? timeoutSignal.reason)
        if (signal.aborted || timeoutSignal.aborted) ctrl.abort()
        else {
          signal.addEventListener("abort", onAbort, { once: true })
          timeoutSignal.addEventListener("abort", onAbort, { once: true })
        }
        combinedSignal = ctrl.signal
      }
    }

    const res = await fetch(JW_API, {
      method: "POST",
      headers: jwHeaders(),
      signal: combinedSignal,
      body: JSON.stringify({
        operationName: "GetTitleOffers",
        query: TITLE_OFFERS_QUERY,
        variables: {
          country,
          language,
          filter,
        },
      }),
    })
    captureCookie(res.headers)
    if (!res.ok) {
      recordCircuitFailure(res.status)
      return null
    }
    const json = await res.json()
    if (json.errors && !usablePayload(json.data)) {
      recordCircuitFailure()
      return null
    }
    recordCircuitSuccess()

    const edges = json?.data?.popularTitles?.edges || []

    let matchedNode = null
    for (const e of edges) {
      const edgeTmdbId = Number(e?.node?.content?.externalIds?.tmdbId)
      if (edgeTmdbId === tmdbId) {
        matchedNode = e.node
        break
      }
    }
    // Titolo non trovato tra i risultati: disponibilità ignota, mai false
    // (un miss non è una prova di assenza).
    if (!matchedNode) return null

    const offers = (matchedNode?.offers || []) as Array<{ presentationType?: string; monetizationType?: string | null }>
    // Solo offerte digitali: CINEMA (biglietti) non è disponibilità
    // digitale/streaming (vedi hasDigitalOffer in pre-release.ts).
    const available = hasDigitalOffer(offers)

    if (availabilityCache.size >= CACHE_MAX) availabilityCache.delete(availabilityCache.keys().next().value!)
    availabilityCache.set(cacheKey, { data: available, timestamp: Date.now() })
    return available
  } catch {
    recordCircuitFailure()
    return null
  }
}

/** Solo per i test: svuota la cache condivisa delle classifiche e qualità JustWatch, cookie e circuit breaker. */
export function __resetJWRankingsCache(): void {
  rankingsCache.clear()
  qualityCache.clear()
  availabilityCache.clear()
  ddCookie = null
  circuitState.consecutiveFailures = 0
  circuitState.cooldownUntil = 0
}
