/**
 * IMDb Top 250 fetcher & membership checker.
 *
 * Fetches the IMDb Top 250 chart, caches the list of IMDb IDs in the
 * in-memory cache (customisable 24 h TTL), and provides a simple check
 * function. Used both server-side (poster generation) and client-side
 * (preview) via the API route.
 */

import { cacheGet, cacheSet } from "./cache"
import { IMDB_TOP_250_IDS } from "./imdb-top250-data"
import { combineAbortSignals } from "./abort-signal"
import { timedFetch } from "./outbound-stats"

const CACHE_KEY = "imdb:top250"
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
const TT_ID_RE = /^tt\d{7,8}$/

// In-memory session cache (avoids serialisation overhead on repeated checks)
let memCache: Set<string> | null = null
let memCacheAt = 0

// A4: inflight dedup — con più poster concorrenti (fetch del chart da 10s) il
// primo livello di cache rischia N fetch uguali nello stesso istante. Tutti i
// caller concorrenti condividono un'unica promise; al settle si resetta.
let inflightTop250: Promise<Set<string>> | null = null

function isMemFresh(): boolean {
  return memCache !== null && (Date.now() - memCacheAt) < CACHE_TTL_MS
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
 *    (un edge per voce di classifica, nell'ordine della chart).
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
function extractNextDataChartIds(html: string): string[] | null {
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
    for (const edge of edges) {
      const node = (edge as { node?: unknown })?.node
      const id =
        typeof (node as { id?: unknown })?.id === "string"
          ? (node as { id: string }).id
          : null
      if (typeof id !== "string") return []
      ids.push(id)
    }
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

async function fetchTop250Ids(signal?: AbortSignal): Promise<string[]> {
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
    if (!res.ok) return []
    const html = await res.text()
    // Solo dati strutturati della classifica: ID fuori chart mai accettati.
    return parseImdbTop250Ids(html)
  } catch {
    return []
  }
}

/**
 * Returns the current list of IMDb Top 250 IDs (as a fresh Set).
 *
 * Uses a three-tier strategy:
 *  1. In-memory hot cache (instant, 0ms)
 *  2. Shared cache
 *  3. Dynamic fetch with guaranteed curated static fallback
 */
async function getTop250Ids(signal?: AbortSignal): Promise<Set<string>> {
  // 1. In-memory hot cache
  if (isMemFresh()) return memCache!

  // 2. Shared cache
  const shared = cacheGet<string[]>(CACHE_KEY)
  if (shared && shared.length === TOP_250_EXPECTED_COUNT) {
    memCache = new Set(shared)
    memCacheAt = Date.now()
    return memCache
  }

  // 3. Inflight dedup: una sola fetch condivisa da tutti i caller concorrenti
  if (inflightTop250) return inflightTop250

  // 4. Dynamic fetch with curated static fallback.
  // R3: il signal del caller che avvia il fetch lo abortisce per tutti i
  // waiter — degradazione sicura: ogni waiter ripiega sul dataset statico.
  inflightTop250 = (async () => {
    const fetched = await fetchTop250Ids(signal)
    if (fetched.length === TOP_250_EXPECTED_COUNT) {
      const set = new Set(fetched)
      cacheSet(CACHE_KEY, fetched, ["imdb"], CACHE_TTL_MS)
      memCache = set
      memCacheAt = Date.now()
      return set
    }

    // Use curated static Top 250 dataset
    memCache = IMDB_TOP_250_IDS
    memCacheAt = Date.now()
    return IMDB_TOP_250_IDS
  })().finally(() => { inflightTop250 = null })

  return inflightTop250
}

/**
 * Precarica la chart Top 250 (mem + shared cache) senza mai lanciare.
 * Idempotente via inflight dedup + cache 24h: chiamate ripetute costano zero.
 * Pensato per il warmup al boot così il primo render non paga il download
 * dell'HTML (1-2MB) sul critical path.
 */
export function warmTop250(signal?: AbortSignal): Promise<void> {
  return getTop250Ids(signal).then(
    () => {},
    () => {},
  )
}

/** Solo per i test: svuota mem cache e inflight. */
export function __resetTop250ForTest(): void {
  memCache = null
  memCacheAt = 0
  inflightTop250 = null
}

/**
 * Returns `true` when the given IMDb ID is in the current Top 250.
 *
 * Guaranteed 100% reliable via static fallback dataset.
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
