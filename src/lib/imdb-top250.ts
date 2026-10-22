/**
 * IMDb Top 250 fetcher & membership checker.
 *
 * Fetches the IMDb Top 250 chart, caches the list of IMDb IDs in the
 * in-memory cache (customisable 24 h TTL), and provides a simple check
 * function. Used both server-side (poster generation) and client-side
 * (preview) via the API route.
 */

import { cacheGet, cacheSet } from "./cache"
import { IMDB_TOP_250_IDS, IMDB_TOP_250_ORDERED_IDS } from "./imdb-top250-data"
import { combineAbortSignals } from "./abort-signal"
import { timedFetch } from "./outbound-stats"

const CACHE_KEY = "imdb:top250"
/**
 * Versioned ordered cache for the RANK-VERIFIED Top 250 (Top100 source).
 * A distinct key (not an envelope on the legacy key) so entries cached by
 * older rank-unaware code — raw 250 id arrays with unproven order — are
 * NEVER trusted for the Top100 badge. Only full ordered snapshots with
 * exact rank coverage 1..250 are stored here.
 */
const RANKED_CACHE_KEY = "imdb:top250:ranked:v1"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/**
 * Numero atteso di voci della classifica: la Top 250 è per definizione una
 * lista di 250 titoli. Accettare solo liste complete evita di congelare in
 * cache per 24h una classifica tronca (risposta parziale, rate-limit HTML,
 * markup cambiato a metà).
 */
export const TOP_250_EXPECTED_COUNT = 250
/**
 * Absolute Cinema eligibility: only movies ranked 1..100 of the ordered
 * chart carry the badge (rank 100 in, rank 101 out). The name stays
 * "Absolute Cinema"; only the eligibility window is new.
 */
export const ABSOLUTE_CINEMA_MAX_RANK = 100
const TT_ID_RE = /^tt\d{7,8}$/

// In-memory session cache (avoids serialisation overhead on repeated checks)
// Ordered array preserves chart rank (index + 1); the Set is the legacy view.
let memCache: Set<string> | null = null
let memOrdered: readonly string[] | null = null
let memCacheAt = 0
// Rank-verified tier (Top100 source): only exact 1..250 rank coverage lands
// here — never raw edge order from rankless HTML, never the legacy key.
let memRanked: readonly string[] | null = null
let memRankedAt = 0

// A4: inflight dedup — con più poster concorrenti (fetch del chart da 10s) il
// primo livello di cache rischia N fetch uguali nello stesso istante. Tutti i
// caller concorrenti condividono un'unica promise; al settle si resetta.
let inflightTop250: Promise<Set<string>> | null = null
let inflightRanked: Promise<Set<string>> | null = null
// Raw chart HTML inflight: legacy and ranked parsers share one download, so
// warming (or racing) both tiers costs a single fetch — never one per tier.
let inflightHtml: Promise<string | null> | null = null

function isMemFresh(): boolean {
  return memCache !== null && (Date.now() - memCacheAt) < CACHE_TTL_MS
}

function isRankedMemFresh(): boolean {
  return memRanked !== null && (Date.now() - memRankedAt) < CACHE_TTL_MS
}

/**
 * Full ordered-snapshot validation: exactly 250 unique valid IMDb ids.
 * Applies to shared-cache consumption on BOTH tiers — a corrupt entry
 * (dupes, invalid ids, truncation) is never trusted and falls through to
 * live fetch or the verified static snapshot.
 */
function isValidOrderedCache(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length !== TOP_250_EXPECTED_COUNT) return false
  if (!value.every((id) => typeof id === "string" && TT_ID_RE.test(id))) return false
  return new Set(value).size === TOP_250_EXPECTED_COUNT
}

/**
 * Estrae gli ID tt… esclusivamente dagli elementi della classifica IMDb,
 * usando i dati strutturati della pagina e MAI il testo libero dell'HTML
 * (link correlati, footer, pubblicità e JSON di navigazione contengono ID
 * estranei alla chart).
 *
 * Fonti riconosciute, in ordine di preferenza:
 * 1. `<script id="__NEXT_DATA__" type="application/json">` — payload Next.js
 *    della pagina chart: `props.pageProps.pageData.chartTitles.edges[].node.id`
 *    (un edge per voce di classifica, nell'ordine della chart). Quando gli
 *    edge portano `currentRank` (chart ufficiale attuale) la copertura
 *    1..250 è richiesta e gli ID sono restituiti in ordine di rank; quando
 *    portano `node.titleType` ogni riga deve essere `movie` (righe tv
 *    rifiutate). Edge legacy senza rank/tipo restano accettati con la
 *    validazione storica (ordine edge, 250 unici) così i fixture sintetici
 *    non si rompono.
 * 2. `<script type="application/ld+json">` con `@type: "ItemList"` — markup
 *    schema.org della classifica: `itemListElement[]` da 250 `ListItem` con
 *    `position` 1..250 e URL `/title/tt…/`, letti in ordine di posizione.
 *
 * Criteri di accettazione (tutti obbligatori, motivati dalla risposta
 * osservata del 2026-10-03: fetch server-side bloccato dal challenge
 * JavaScript AWS WAF — pagina senza alcuno di questi blocchi → fallback):
 * - struttura: almeno una delle due fonti deve essere presente e leggibile;
 *   pagina bloccata/troncata o markup incompatibile → lista vuota;
 * - ID: ogni voce deve corrispondere a `^tt\d{7,8}$` (niente slug, niente
 *   ID di navigazione non-titolo);
 * - duplicati: la sequenza grezza non deve contenerne (un duplicato indica
 *   parse rotto o chart corrotta, non una classifica valida);
 * - completezza: esattamente 250 voci uniche; per JSON-LD le `position`
 *   devono essere tutte presenti (parziali = lista rifiutata) e coprire
 *   interamente 1..250 — così duplicati, negative e fuori scala sono
 *   respinti dalla copertura, senza eccezioni.
 *
 * Ritorna la lista ordinata della chart, oppure `[]` quando va usato il
 * fallback locale esistente.
 */
export function parseImdbTop250Ids(html: string): string[] {
  const fromNextData = extractNextDataChartIds(html)
  if (fromNextData && isValidChartIds(fromNextData, null)) return fromNextData
  for (const itemList of extractItemListCharts(html)) {
    if (isValidChartIds(itemList.ids, itemList.positions)) return itemList.ids
  }
  return []
}

/**
 * Rank-aware chart parser — the ONLY runtime source for the Top100 badge.
 *
 * Unlike the legacy parser above (rankless 250-membership contract: any 250
 * unique valid ids in edge order), this requires EXACT verified rank
 * coverage 1..250 from the live page: `__NEXT_DATA__` edges carrying
 * `currentRank`, or a JSON-LD `ItemList` with full `position` coverage.
 * Rankless/shuffled HTML yields `[]` (fall through to live-ranked or the
 * verified static snapshot — never the arbitrary first 100 of edge order).
 */
export function parseImdbTop250RankedIds(html: string): string[] {
  const fromNextData = extractNextDataChartIds(html, true)
  if (fromNextData && isValidChartIds(fromNextData, fullCoveragePositions(fromNextData.length))) {
    return fromNextData
  }
  for (const itemList of extractItemListCharts(html)) {
    if (itemList.positions && isValidChartIds(itemList.ids, itemList.positions)) return itemList.ids
  }
  return []
}

/** Synthetic 1..N positions for a Next.js payload already sorted by rank. */
function fullCoveragePositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1)
}

function isValidChartIds(ids: string[], positions: number[] | null): boolean {
  if (ids.length !== TOP_250_EXPECTED_COUNT) return false
  if (!ids.every((id) => TT_ID_RE.test(id))) return false
  if (new Set(ids).size !== ids.length) return false
  if (positions) {
    if (positions.length !== TOP_250_EXPECTED_COUNT) return false
    const seen = new Set(positions)
    if (seen.size !== TOP_250_EXPECTED_COUNT) return false
    for (let p = 1; p <= TOP_250_EXPECTED_COUNT; p++) {
      if (!seen.has(p)) return false
    }
  }
  return true
}

/** Punto 1: edge `chartTitles` dal payload `__NEXT_DATA__`, null se assente. */
function extractNextDataChartIds(html: string, rankedOnly = false): string[] | null {
  const blocks = matchScriptJson(html, "__NEXT_DATA__")
  for (const raw of blocks) {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      continue
    }
    const edges = findChartTitlesEdges(json)
    if (!edges) continue
    const ids: string[] = []
    const ranks: number[] = []
    let hasRank = false
    let hasType = false
    for (const edge of edges) {
      const record = edge as { currentRank?: unknown; node?: unknown }
      const node = record?.node
      const id =
        typeof (node as { id?: unknown })?.id === "string"
          ? (node as { id: string }).id
          : null
      if (typeof id !== "string") return []
      ids.push(id)
      const rank = record?.currentRank
      if (typeof rank === "number" && Number.isInteger(rank)) {
        hasRank = true
        ranks.push(rank)
      } else if (rank !== undefined) {
        // currentRank presente ma malformato: chart non attendibile.
        return []
      }
      const titleType =
        (node as { titleType?: unknown })?.titleType
      const typeId =
        typeof titleType === "string"
          ? titleType
          : typeof (titleType as { id?: unknown } | null)?.id === "string"
            ? ((titleType as { id: string }).id)
            : null
      if (typeId !== null) {
        hasType = true
        if (typeId !== "movie") return []
      }
    }
    if (hasRank) {
      // Chart ufficiale attuale: rank esatti 1..250, ID restituiti in
      // ordine di rank (non in ordine edge grezzo).
      if (ranks.length !== ids.length) return []
      const seen = new Set(ranks)
      if (seen.size !== TOP_250_EXPECTED_COUNT) return []
      for (let p = 1; p <= TOP_250_EXPECTED_COUNT; p++) {
        if (!seen.has(p)) return []
      }
      const pairs = ids.map((id, i) => ({ id, rank: ranks[i] }))
      pairs.sort((a, b) => a.rank - b.rank)
      return pairs.map((p) => p.id)
    }
    // No verified rank coverage on this payload: the legacy membership
    // contract still accepts edge order, but the ranked source refuses it.
    if (rankedOnly) return null
    void hasType
    return ids
  }
  return null
}

/** Percorso canonico, poi ricerca profonda (resiste a ristrutturazioni minori). */
function findChartTitlesEdges(json: unknown): unknown[] | null {
  const root = json as {
    props?: { pageProps?: { pageData?: { chartTitles?: { edges?: unknown } } } }
  }
  const direct = root?.props?.pageProps?.pageData?.chartTitles?.edges
  if (Array.isArray(direct)) return direct
  let found: unknown[] | null = null
  const visit = (value: unknown): void => {
    if (found || value === null || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const record = value as Record<string, unknown>
    const chart = record["chartTitles"] as { edges?: unknown } | undefined
    if (chart && Array.isArray(chart.edges)) {
      found = chart.edges
      return
    }
    for (const key of Object.keys(record)) visit(record[key])
  }
  visit(json)
  return found
}

/** Punto 2: `ItemList` schema.org (tutte le candidate, in ordine di apparizione). */
function extractItemListCharts(html: string): Array<{ ids: string[]; positions: number[] | null }> {
  const blocks = matchScriptJson(html, "ld+json")
  const found: Array<{ ids: string[]; positions: number[] | null }> = []
  for (const raw of blocks) {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      continue
    }
    for (const candidate of flattenJsonLd(json)) {
      const list = asItemList(candidate)
      if (list) found.push(list)
    }
  }
  return found
}

function flattenJsonLd(json: unknown): unknown[] {
  if (Array.isArray(json)) return json.flatMap(flattenJsonLd)
  if (json !== null && typeof json === "object") {
    const record = json as Record<string, unknown>
    if (Array.isArray(record["@graph"])) {
      return (record["@graph"] as unknown[]).flatMap(flattenJsonLd)
    }
    return [json]
  }
  return []
}

function asItemList(candidate: unknown): { ids: string[]; positions: number[] | null } | null {
  if (candidate === null || typeof candidate !== "object") return null
  const record = candidate as Record<string, unknown>
  const type = record["@type"]
  const isItemList =
    type === "ItemList" ||
    (Array.isArray(type) && (type as unknown[]).includes("ItemList"))
  if (!isItemList) return null
  const elements = record["itemListElement"]
  if (!Array.isArray(elements)) return null
  const pairs: Array<{ id: string; position: number | null }> = []
  for (const el of elements) {
    if (el === null || typeof el !== "object") return null
    const item = el as Record<string, unknown>
    const url =
      typeof item["url"] === "string"
        ? (item["url"] as string)
        : item["item"] !== null && typeof item["item"] === "object"
          ? (item["item"] as Record<string, unknown>)["url"]
          : undefined
    if (typeof url !== "string") return null
    const m = /\/title\/(tt\d{7,8})(?:\/|$)/.exec(url)
    if (!m) return null
    // undefined = voce malformata (scarta l'intera lista, mai inventare).
    const position = normalizePosition(item["position"])
    if (position === undefined) return null
    pairs.push({ id: m[1], position })
  }
  pairs.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  // Posizioni parziali (alcune presenti, altre assenti): la copertura non è
  // verificabile e i buchi possono nascondere duplicati o valori fuori scala
  // (es. negative) — lista rifiutata, mai validazione a metà.
  const presentCount = pairs.filter((p) => p.position !== null).length
  if (presentCount > 0 && presentCount < pairs.length) return null
  const positions = pairs.every((p) => p.position !== null)
    ? pairs.map((p) => p.position as number)
    : null
  return { ids: pairs.map((p) => p.id), positions }
}

/** Position schema.org: intero o stringa numerica; null se assente, undefined se malformata. */
function normalizePosition(value: unknown): number | null | undefined {
  if (value === undefined) return null
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number.parseInt(value.trim(), 10)
    return Number.isSafeInteger(n) ? n : undefined
  }
  return undefined
}

/** Contenuto raw dei `<script>` con id/type corrispondente (case-insensitive). */
function matchScriptJson(html: string, kind: "__NEXT_DATA__" | "ld+json"): string[] {
  const out: string[] = []
  const re =
    kind === "__NEXT_DATA__"
      ? /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/gi
      : /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    out.push(m[1])
  }
  return out
}

/**
 * Single shared download of the chart HTML (inflight-deduped across the
 * legacy and ranked tiers, so warming both costs one fetch).
 * Returns null on any transport failure — callers fall back, never throw.
 */
async function fetchChartHtml(signal?: AbortSignal): Promise<string | null> {
  if (inflightHtml) return inflightHtml
  inflightHtml = (async () => {
    try {
      // Chart URL sovrascrivibile via env: nei test E2E punta al mock server
      // locale, così il fetch resta deterministico (fallback al dataset statico).
      const chartUrl = process.env.IMDB_CHART_URL || "https://www.imdb.com/chart/top/"
      const res = await timedFetch(chartUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: combineAbortSignals(signal, FETCH_TIMEOUT_MS),
      })
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  })().finally(() => {
    inflightHtml = null
  })
  return inflightHtml
}

async function fetchTop250Ids(signal?: AbortSignal): Promise<string[]> {
  const html = await fetchChartHtml(signal)
  if (!html) return []
  // Solo dati strutturati della classifica: ID fuori chart mai accettati.
  // Legacy membership contract: rankless 250 accettati (ordine edge).
  return parseImdbTop250Ids(html)
}

async function fetchTop250RankedIds(signal?: AbortSignal): Promise<string[]> {
  const html = await fetchChartHtml(signal)
  if (!html) return []
  // Ranked source: exact 1..250 coverage required, rankless rejected.
  return parseImdbTop250RankedIds(html)
}

/**
 * Returns the current ORDERED list of IMDb Top 250 IDs (rank 1..250).
 *
 * Same three-tier strategy as the legacy Set view (mem → shared → live
 * fetch with curated static fallback). The shared entry stores the ordered
 * array, so rank survives the cache; the legacy Set is derived from it.
 * No extra fetch per poster: badge and API share this single source.
 */
async function getTop250OrderedIds(signal?: AbortSignal): Promise<readonly string[]> {
  // 1. In-memory hot cache
  if (isMemFresh() && memOrdered) return memOrdered

  // 2. Shared cache (must be a complete ordered snapshot, not a prefix;
  //    dupes and invalid ids are rejected, never trusted)
  const shared = cacheGet<string[]>(CACHE_KEY)
  if (isValidOrderedCache(shared)) {
    memOrdered = [...shared]
    memCache = new Set(shared)
    memCacheAt = Date.now()
    return memOrdered
  }

  // 3. Inflight dedup: una sola fetch condivisa da tutti i caller concorrenti
  if (inflightTop250) {
    const set = await inflightTop250
    return [...set]
  }

  // 4. Dynamic fetch with curated static fallback (verified ordered snapshot
  //    dated 2026-10-22, see src/lib/imdb-top250-data.ts provenance).
  // R3: il signal del caller che avvia il fetch lo abortisce per tutti i
  // waiter — degradazione sicura: ogni waiter ripiega sul dataset statico.
  inflightTop250 = (async () => {
    const fetched = await fetchTop250Ids(signal)
    if (isValidOrderedCache(fetched)) {
      const set = new Set(fetched)
      cacheSet(CACHE_KEY, fetched, ["imdb"], CACHE_TTL_MS)
      memOrdered = [...fetched]
      memCache = set
      memCacheAt = Date.now()
      return set
    }

    // Use curated static Top 250 dataset (ordered snapshot, correct 250).
    memOrdered = IMDB_TOP_250_ORDERED_IDS
    memCache = IMDB_TOP_250_IDS
    memCacheAt = Date.now()
    return IMDB_TOP_250_IDS
  })().finally(() => { inflightTop250 = null })

  const set = await inflightTop250
  return [...set]
}

/**
 * Returns the current RANK-VERIFIED ordered list of IMDb Top 250 IDs.
 *
 * Same three-tier strategy as the legacy view (mem → versioned shared →
 * live ranked fetch with curated static fallback), but the live and shared
 * tiers require exact rank coverage 1..250: rankless or shuffled HTML and
 * any corrupt shared entry fall through to the verified static snapshot —
 * never the arbitrary first 100 of an unproven order. No extra fetch per
 * poster: badge and API share this single ranked source (one download is
 * shared with the legacy tier via the raw-HTML inflight).
 */
async function getTop250RankedOrderedIds(signal?: AbortSignal): Promise<readonly string[]> {
  // 1. In-memory hot cache (rank-verified only)
  if (isRankedMemFresh() && memRanked) return memRanked

  // 2. Versioned shared cache: old unversioned entries are never read here,
  //    and corrupt entries (dupes/invalid ids) are rejected, never trusted.
  const shared = cacheGet<string[]>(RANKED_CACHE_KEY)
  if (isValidOrderedCache(shared)) {
    memRanked = [...shared]
    memRankedAt = Date.now()
    return memRanked
  }

  // 3. Inflight dedup: una sola fetch condivisa da tutti i caller concorrenti
  if (inflightRanked) {
    const set = await inflightRanked
    return [...set]
  }

  // 4. Ranked live fetch with curated static fallback (verified ordered
  //    snapshot dated 2026-10-22, see src/lib/imdb-top250-data.ts).
  inflightRanked = (async () => {
    const fetched = await fetchTop250RankedIds(signal)
    if (isValidOrderedCache(fetched)) {
      const set = new Set(fetched)
      cacheSet(RANKED_CACHE_KEY, fetched, ["imdb"], CACHE_TTL_MS)
      memRanked = [...fetched]
      memRankedAt = Date.now()
      return set
    }

    // Rank unverified (rankless/shuffled/corrupt/blocked): verified static
    // snapshot — never an unproven order.
    memRanked = IMDB_TOP_250_ORDERED_IDS
    memRankedAt = Date.now()
    return IMDB_TOP_250_IDS
  })().finally(() => { inflightRanked = null })

  const set = await inflightRanked
  return [...set]
}

async function getTop250Ids(signal?: AbortSignal): Promise<Set<string>> {
  const ordered = await getTop250OrderedIds(signal)
  return new Set(ordered)
}

/**
 * Precarica la chart Top 250 (mem + shared cache) senza mai lanciare.
 * Idempotente via inflight dedup + cache 24h: chiamate ripetute costano zero.
 * Pensato per il warmup al boot così il primo render non paga il download
 * dell'HTML (1-2MB) sul critical path. Both tiers share one HTML download.
 */
export function warmTop250(signal?: AbortSignal): Promise<void> {
  return Promise.all([getTop250OrderedIds(signal), getTop250RankedOrderedIds(signal)]).then(
    () => {},
    () => {},
  )
}

/** Solo per i test: svuota mem cache e inflight. */
export function __resetTop250ForTest(): void {
  memCache = null
  memOrdered = null
  memCacheAt = 0
  memRanked = null
  memRankedAt = 0
  inflightTop250 = null
  inflightRanked = null
  inflightHtml = null
}

/**
 * Rank 1..250 of an IMDb ID in the current chart, or null when absent.
 * Rank comes from the rank-VERIFIED ordered snapshot (live ranked or curated
 * fallback) — never from unproven edge order.
 */
export async function getImdbTopRank(
  imdbId: string | null | undefined,
  signal?: AbortSignal,
): Promise<number | null> {
  if (!imdbId || !/^tt\d{7,8}$/.test(imdbId)) return null
  try {
    const ordered = await getTop250RankedOrderedIds(signal)
    const idx = ordered.indexOf(imdbId)
    return idx >= 0 ? idx + 1 : null
  } catch {
    const idx = IMDB_TOP_250_ORDERED_IDS.indexOf(imdbId)
    return idx >= 0 ? idx + 1 : null
  }
}

/**
 * Returns `true` when the given IMDb ID is in the current Top 250.
 *
 * Legacy 250-membership contract (kept for non-badge consumers and
 * back-compat API callers). Best-effort live with a curated static fallback
 * snapshot — not a freshness guarantee: when the live chart is blocked the
 * dated fallback answers.
 */
export async function isImdbTop250(imdbId: string | null | undefined, signal?: AbortSignal): Promise<boolean> {
  if (!imdbId || !/^tt\d{7,8}$/.test(imdbId)) return false
  try {
    const ids = await getTop250Ids(signal)
    return ids.has(imdbId)
  } catch {
    return IMDB_TOP_250_IDS.has(imdbId)
  }
}

/**
 * Absolute Cinema eligibility: rank 1..100 of the rank-VERIFIED ordered
 * Top 250 chart. Movies only (the badge layer gates `mediaType === "movie"`);
 * this helper is rank-based on purpose — never "first 100 of an unordered
 * set". Unproven live order falls back to the verified static snapshot.
 * Best-effort live with the same curated fallback as the 250 contract.
 */
export async function isImdbTop100(imdbId: string | null | undefined, signal?: AbortSignal): Promise<boolean> {
  const rank = await getImdbTopRank(imdbId, signal)
  return rank !== null && rank >= 1 && rank <= ABSOLUTE_CINEMA_MAX_RANK
}
