import { cacheGetShared, cacheSet } from "./cache"
import { matchStudios, isValidWikidataQid } from "./badge-labels"

// Re-export per compatibilità: le label pure vivono in badge-labels.ts
// (foglia client-safe); poster route, poster-badge e test continuano a
// importarle da qui senza modifiche.
export { matchTMDBStudios, getAwardBadgeLabel, getNominationBadgeLabel, isValidWikidataQid } from "./badge-labels"
import { combineAbortSignals } from "./abort-signal"
import { timedFetch } from "./outbound-stats"
import { createCircuitBreaker } from "@/lib/circuit-breaker"
import { createLogger } from "@/lib/logger"

const log = createLogger("awards")

interface AwardRule {
  keywords: string[]
  label: string
}

const RULES: AwardRule[] = [
  { keywords: ["Oscar", "Academy Award", "Premio Oscar"], label: "Oscar" },
  { keywords: ["BAFTA", "British Academy"], label: "BAFTA" },
  { keywords: ["Golden Globe"], label: "Golden Globe" },
  { keywords: ["Primetime Emmy", "Emmy Award", "Premio Emmy"], label: "Emmy" },
  { keywords: ["David di Donatello"], label: "David" },
  { keywords: ["Venice", "Golden Lion", "Leone d'Oro", "Mostra", "Venezia"], label: "Venezia" },
  { keywords: ["Cannes", "Palme d'Or", "Palma d'Oro", "Festival di Cannes"], label: "Cannes" },
]

export interface WikidataResult {
  awards: string[]
  nominations: string[]
  studios: string[]
  director: string | null
  /**
   * True quando il risultato è un fallback da fallimento upstream (negative
   * cache, breaker aperto, timeout, 5xx) invece di un esito accertato.
   * Assente nei mock storici dei test → trattato come false dal chiamante.
   * Serve a non congelare in cache 24h un poster senza premi per un miss
   * transitorio (stesso pattern di qualityEphemeral nella route poster).
   */
  degraded?: boolean
}

// ---- Circuit breaker (Wikidata SPARQL) ----
// Generic primitive in circuit-breaker.ts; same threshold/backoff as before
// (5 failures → 60s backoff). Half-open semantics unchanged, see the factory.
const wikidataBreaker = createCircuitBreaker({ name: "awards", failureThreshold: 5, backoffMs: 60_000 })

/**
 * True se le richieste verso Wikidata devono essere rifiutate subito.
 *
 * Half-open: una volta raggiunta la soglia, la finestra di backoff viene
 * aperta al momento del fallimento (recordFailure). Alla scadenza della
 * finestra UNA sola richiesta di prova attraversa per verificare lo stato
 * dell'upstream; le altre restano rifiutate finché la prova non decide.
 * Prima il breaker restava aperto per sempre: nessuna richiesta usciva mai a
 * resettare i contatori, quindi allo scadere della finestra si riapriva.
 */
function isBreakerOpen(): boolean {
  return wikidataBreaker.isOpen()
}

function recordSuccess(): void {
  wikidataBreaker.recordSuccess()
}

function recordFailure(): void {
  wikidataBreaker.recordFailure()
}

// Esposte per i test unitari del circuito (stesso pattern di __resetJWRankingsCache).
export { isBreakerOpen, recordSuccess, recordFailure }

/** Solo per i test: azzera lo stato dei circuit breaker Wikidata. */
export function __resetCircuitBreaker(): void {
  wikidataBreaker.reset()
  wikidataRestBreaker.reset()
}

// ---- Concurrency limiter (max 2 parallel SPARQL queries) ----
const MAX_CONCURRENT = 2
let inFlight = 0
const pendingQueue: Array<() => void> = []

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++
    return
  }
  return new Promise((resolve) => {
    pendingQueue.push(resolve)
  })
}

function release(): void {
  const next = pendingQueue.shift()
  if (next) {
    next()
  } else {
    inFlight--
  }
}

// ---- SPARQL helper ----

async function sparqlQuery(query: string, signal?: AbortSignal): Promise<Record<string, { value: string; type: string }>[] | null> {
  if (isBreakerOpen()) return null
  // R3: signal esterno già abortito → niente rete inutile.
  if (signal?.aborted) return null

  await acquire()
  try {
    // Endpoint sovrascrivibile via env: nei test E2E punta al mock server
    // locale per risposte deterministiche (bindings vuoti).
    const sparqlBase = process.env.WIKIDATA_SPARQL_URL || "https://query.wikidata.org/sparql"
    const url = `${sparqlBase}?format=json&query=${encodeURIComponent(query)}`
    // Retry once with jitter on failure (but not on breaker)
    for (let attempt = 0; attempt < 2; attempt++) {
      const timeout = 5000 + Math.round(Math.random() * 1000)
      try {
        const res = await timedFetch(url, {
          headers: { "User-Agent": "Pictorium/1.0" },
          signal: combineAbortSignals(signal, timeout),
        })
        if (res.status === 429) {
          recordFailure()
          const retryAfter = res.headers.get("Retry-After")
          const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000
          await new Promise((r) => setTimeout(r, wait + Math.round(Math.random() * 1000)))
          continue
        }
        if (!res.ok) {
          if (attempt === 0) continue // retry
          recordFailure()
          return null
        }
        recordSuccess()
        const json = await res.json()
        return json?.results?.bindings || []
      } catch {
        if (attempt === 1) {
          recordFailure()
          return null
        }
        // Small jitter before retry
        await new Promise((r) => setTimeout(r, 500 + Math.round(Math.random() * 500)))
      }
    }
    return null
  } finally {
    release()
  }
}

// ---- Matching logic (studio/network + label vivono in badge-labels.ts) ----

function matchRules(labels: string[]): string[] {
  const found = new Set<string>()
  for (const label of labels) {
    for (const rule of RULES) {
      if (rule.keywords.some((kw) => label.toLowerCase().includes(kw.toLowerCase()))) {
        found.add(rule.label)
      }
    }
  }
  return [...found]
}

const DIRECTORS = [
  "Alfred Hitchcock", "Orson Welles", "John Ford", "Akira Kurosawa",
  "Charles Chaplin", "Federico Fellini", "Ingmar Bergman", "Steven Spielberg",
  "Stanley Kubrick", "D.W. Griffith", "William Wyler", "Howard Hawks",
  "David Lean", "Martin Scorsese", "Jean Renoir", "Robert Bresson",
  "Jean-Luc Godard", "Frank Capra", "Andrei Tarkovsky", "Luis Buñuel",
  "Michael Powell", "John Huston", "Michael Curtiz", "Billy Wilder",
  "Carl Theodor Dreyer", "Yasujirō Ozu", "Woody Allen", "Abel Gance",
  "Ernst Lubitsch", "Paul Thomas Anderson", "Francis Ford Coppola",
  "Michelangelo Antonioni", "Sergio Leone", "F.W. Murnau", "Ridley Scott",
  "David Lynch", "George Stevens", "Fritz Lang", "Roman Polanski",
  "Miloš Forman", "James Cameron", "Tim Burton", "Elia Kazan",
  "François Truffaut", "George Cukor", "Buster Keaton", "Werner Herzog",
  "Sergei Eisenstein", "Cecil B. DeMille", "Kenji Mizoguchi", "Nicholas Ray",
  "Tod Browning", "John Sturges", "Otto Preminger", "Victor Fleming",
  "Carol Reed", "Roberto Rossellini", "Fred Zinnemann", "Sidney Lumet",
  "Marcel Carné", "Quentin Tarantino", "Raoul Walsh", "Henry King",
  "Dziga Vertov", "Lewis Milestone", "Rex Ingram", "Christopher Nolan",
  "Max Ophüls",
]

/** Estrae "Q123" da un URI entità Wikidata (o da un QID già nudo). */
function qidFromEntityUri(value: string | null | undefined): string | null {
  if (!value) return null
  const m = value.match(/(Q\d+)\s*$/)
  return m ? m[1] : null
}

// Base Action API sovrascrivibile via env: nei test E2E punta al mock server
// locale (stesso pattern di WIKIDATA_SPARQL_URL per lo SPARQL).
const wikidataApiBase = () =>
  process.env.WIKIDATA_API_URL || "https://www.wikidata.org/w/api.php"

/**
 * Titolo del sitelink enwiki di un item (es. Q25191 → "Christopher Nolan").
 * Fallback fail-open per item senza label: 1 chiamata API veloce con timeout
 * breve, MAI join sitelink in SPARQL (rende la query 10x più lenta).
 */
async function enwikiTitle(qid: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const url = `${wikidataApiBase()}?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=sitelinks&sitefilter=enwiki&format=json`
    const res = await timedFetch(url, {
      headers: { "User-Agent": "Pictorium/1.0" },
      signal: combineAbortSignals(signal, 4000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const title = json?.entities?.[qid]?.sitelinks?.enwiki?.title
    return typeof title === "string" && title.length > 0 ? title : null
  } catch {
    return null
  }
}

/**
 * Nome canonico del regista se in allowlist, altrimenti null. Usato per lo
 * storage neutro in cache: la cache è per titolo, non per lingua, quindi non
 * può contenere label già rese (chi chiede per primo in una lingua
 * avvelenerebbe le altre per 24h). La resa avviene con directorBadgeLabel
 * dove la locale è nota.
 */
export function matchDirectorName(name: string | null): string | null {
  if (!name) return null
  const lower = name.toLowerCase().trim()
  for (const d of DIRECTORS) {
    if (lower === d.toLowerCase() || lower.includes(d.toLowerCase())) {
      return d
    }
  }
  return null
}

/** Etichetta localizzata a render-time dal nome canonico (mai dalla cache). */
export function directorBadgeLabel(name: string | null, t?: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (!name) return null
  const canonical = matchDirectorName(name) ?? name
  return t ? t("badge.director", { name: canonical }) : `Di ${canonical}`
}

const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000

// Negative cache in-memory per i fallimenti transitori (breaker, timeout,
// 5xx): senza, un outage SPARQL fa pagare la race da 2500ms a OGNI render.
// Solo memoria locale (mai KV: durante un outage il KV è l'ultima cosa da
// stressare), TTL 60s: al recovery i premi ricompaiono entro un minuto.
const WIKIDATA_NEGATIVE_TTL_MS = 60_000
const wikidataNegative = new Map<string, number>()
const WIKIDATA_NEGATIVE_MAX = 500

function wikidataNegativeHit(cacheKey: string): boolean {
  const at = wikidataNegative.get(cacheKey)
  if (at === undefined) return false
  if (Date.now() - at > WIKIDATA_NEGATIVE_TTL_MS) {
    wikidataNegative.delete(cacheKey)
    return false
  }
  return true
}

function wikidataNegativeSet(cacheKey: string): void {
  if (wikidataNegative.size >= WIKIDATA_NEGATIVE_MAX) wikidataNegative.delete(wikidataNegative.keys().next().value!)
  wikidataNegative.set(cacheKey, Date.now())
}

/** Solo per i test: svuota la negative cache. */
export function __resetWikidataNegativeForTest(): void {
  wikidataNegative.clear()
}

// ---- Circuit breaker isolato per il fast-path REST (Action API) ----
// Stesse soglie dello SPARQL ma finestre indipendenti: un outage SPARQL non
// deve chiudere il REST (CDN diversa) e viceversa.
const wikidataRestBreaker = createCircuitBreaker({ name: "awards-rest", failureThreshold: 5, backoffMs: 60_000 })

/** Solo per i test: azzera il breaker REST. */
export function __resetWikidataRestBreakerForTest(): void {
  wikidataRestBreaker.reset()
}

interface WikidataClaims {
  awardQids: string[]
  nominationQids: string[]
  directorQids: string[]
  networkQids: string[]
}

function claimQids(claims: Record<string, unknown> | undefined, prop: string): string[] {
  if (!claims || !Array.isArray((claims as Record<string, unknown>)[prop])) return []
  const out: string[] = []
  for (const item of (claims as Record<string, unknown[]>)[prop]) {
    const qid = qidFromEntityUri(
      (item as { mainsnak?: { datavalue?: { value?: { id?: string } } } })?.mainsnak?.datavalue?.value?.id,
    )
    if (qid) out.push(qid)
  }
  return out
}

/**
 * Fast-path REST via Wikidata Action API (CDN Fastly, sub-secondo) usando il
 * wikidata_id nativo di TMDB. Due RTT sequenziali dentro il budget della race
 * (claims ~1000ms + labels batch ~800ms < 2500ms):
 *  1. claims P166 (premi) / P1411 (nomination) / P57 (regista) / P449 (network, solo tv);
 *  2. un'unica labels batch en (cap 50 QID).
 * Ritorna null su qualsiasi fallimento (fallback SPARQL a valle).
 */
export async function fetchWikidataRest(
  qid: string,
  mediaType: "movie" | "tv",
  signal?: AbortSignal,
): Promise<WikidataResult | null> {
  if (!isValidWikidataQid(qid)) return null
  if (wikidataRestBreaker.isOpen()) return null
  if (signal?.aborted) return null
  try {
    const claimsUrl = `${wikidataApiBase()}?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=claims&format=json`
    const claimsRes = await timedFetch(claimsUrl, {
      headers: { "User-Agent": "Pictorium/1.0" },
      signal: combineAbortSignals(signal, 1000),
    })
    if (!claimsRes.ok) {
      wikidataRestBreaker.recordFailure()
      return null
    }
    const claimsJson = await claimsRes.json()
    const claims = claimsJson?.entities?.[qid]?.claims as Record<string, unknown> | undefined
    if (!claims) {
      wikidataRestBreaker.recordFailure()
      return null
    }
    const parsed: WikidataClaims = {
      awardQids: claimQids(claims, "P166"),
      nominationQids: claimQids(claims, "P1411"),
      directorQids: claimQids(claims, "P57"),
      // P449 (network) ha senso solo per le serie: lo SPARQL lo chiede solo lì.
      networkQids: mediaType === "tv" ? claimQids(claims, "P449") : [],
    }
    const allQids = [...new Set([...parsed.awardQids, ...parsed.nominationQids, ...parsed.directorQids, ...parsed.networkQids])].slice(0, 50)
    const labels = new Map<string, string>()
    if (allQids.length > 0) {
      const labelsUrl = `${wikidataApiBase()}?action=wbgetentities&ids=${encodeURIComponent(allQids.join("|"))}&props=labels&languages=en&format=json`
      const labelsRes = await timedFetch(labelsUrl, {
        headers: { "User-Agent": "Pictorium/1.0" },
        signal: combineAbortSignals(signal, 800),
      })
      if (!labelsRes.ok) {
        wikidataRestBreaker.recordFailure()
        return null
      }
      const labelsJson = await labelsRes.json()
      const entities = labelsJson?.entities as Record<string, { labels?: Record<string, { value?: string }> }> | undefined
      if (entities) {
        for (const [id, ent] of Object.entries(entities)) {
          const label = ent?.labels?.en?.value
          if (typeof label === "string" && label.length > 0) labels.set(id, label)
        }
      }
    }
    const labelOf = (ids: string[]): string[] =>
      ids.map((id) => labels.get(id)).filter((l): l is string => !!l)

    // Regista: label batch, poi sitelink enwiki come ultima spiaggia (stesso
    // pattern del ramo SPARQL per item senza label).
    let director: string | null = labelOf(parsed.directorQids)[0] || null
    if (!director && parsed.directorQids[0]) {
      director = await enwikiTitle(parsed.directorQids[0], signal).catch(() => null)
    }

    wikidataRestBreaker.recordSuccess()
    return {
      awards: matchRules(labelOf(parsed.awardQids)),
      nominations: matchRules(labelOf(parsed.nominationQids)),
      studios: matchStudios(labelOf(parsed.networkQids)),
      director: matchDirectorName(director),
    }
  } catch {
    wikidataRestBreaker.recordFailure()
    return null
  }
}

export async function fetchAllWikidata(
  tmdbId: number,
  mediaType: "movie" | "tv",
  // R3: signal esterno (es. deadline render) — senza, il fetch sopravvive al
  // watchdog come zombie anche dopo il 503.
  signal?: AbortSignal,
  opts?: { wikidataId?: string | null },
): Promise<WikidataResult> {
  const cacheKey = `wikidata:v2:${mediaType}:${tmdbId}`

  // Check shared cache first (typed, with TTL). L1 + L2 KV cross-istanza:
  // la prima istanza che riesce condivide con tutte (prima ogni istanza
  // ritirava i dadi SPARQL per conto suo → lotteria badge multi-istanza).
  const cached = await cacheGetShared<WikidataResult>(cacheKey, ["wikidata"])
  if (cached) return cached
  if (wikidataNegativeHit(cacheKey)) {
    return { awards: [], nominations: [], studios: [], director: null, degraded: true }
  }

  // Fast-path REST a costo zero RTT TMDB (QID già in mano dalla route via
  // append_to_response=external_ids). Successo → stessa cache condivisa 24h
  // dello SPARQL; fallimento → fallback SPARQL sotto (QID null o assente
  // compreso: TMDB lo restituisce null per una fetta reale di titoli).
  if (isValidWikidataQid(opts?.wikidataId)) {
    const rest = await fetchWikidataRest(opts.wikidataId, mediaType, signal).catch(() => null)
    if (rest) {
      // Osservabilità path (Dexter): con PICTORIUM_LOG_LEVEL=debug si vede se
      // il badge è arrivato via REST veloce o via lotteria SPARQL.
      log.debug("Wikidata fast-path REST hit", { mediaType, tmdbId, awards: rest.awards.length })
      const hit: WikidataResult = { ...rest, degraded: false }
      cacheSet(cacheKey, hit, ["wikidata"], WIKIDATA_CACHE_TTL)
      return hit
    }
  }
  log.debug("Wikidata SPARQL fallback", { mediaType, tmdbId, hadQid: isValidWikidataQid(opts?.wikidataId) })

  const tmdbProp = mediaType === "movie" ? "P4947" : "P4983"
  const networkQuery = mediaType === "tv" ? `OPTIONAL { ?item wdt:P449 ?network . ?network rdfs:label ?networkLabel . FILTER(LANG(?networkLabel) = "en") }` : ""
  const query = `SELECT ?awardLabel ?nominationLabel ?networkLabel ?directorLabel ?director WHERE {
    ?item wdt:${tmdbProp} "${tmdbId}" .
    OPTIONAL { ?item wdt:P166 ?award . ?award rdfs:label ?awardLabel . FILTER(LANG(?awardLabel) = "en") }
    OPTIONAL { ?item wdt:P1411 ?nomination . ?nomination rdfs:label ?nominationLabel . FILTER(LANG(?nominationLabel) = "en") }
    ${networkQuery}
    OPTIONAL { ?item wdt:P57 ?director }
    OPTIONAL { ?director rdfs:label ?directorLabel . FILTER(LANG(?directorLabel) = "en") }
  }`

  try {
    const bindings = await sparqlQuery(query, signal)
    if (bindings === null) {
      // Fallimento transitorio (breaker, timeout, 5xx): non inquinare la cache 24h,
      // ma registra la negativa breve così l'outage non tassa ogni render.
      // Mai a breaker già aperto: lì sopprime già lui (stesso TTL), e la
      // negativa non deve nascondere i fallimenti che il breaker deve contare.
      if (!isBreakerOpen()) wikidataNegativeSet(cacheKey)
      return { awards: [], nominations: [], studios: [], director: null, degraded: true }
    }

    const awardLabels = new Set<string>()
    const nominationLabels = new Set<string>()
    const networkLabels = new Set<string>()
    const directorLabels = new Set<string>()
    const directorQids = new Set<string>()

    for (const b of bindings) {
      if (b.awardLabel?.value) awardLabels.add(b.awardLabel.value)
      if (b.nominationLabel?.value) nominationLabels.add(b.nominationLabel.value)
      if (b.networkLabel?.value) networkLabels.add(b.networkLabel.value)
      if (b.directorLabel?.value) directorLabels.add(b.directorLabel.value)
      const qid = qidFromEntityUri(b.director?.value)
      if (qid) directorQids.add(qid)
    }

    // Titolo enwiki come fallback quando l'item regista non ha label
    // (vandalismo/decadimento dati: es. Q25191 senza label ma con sitelink
    // "Christopher Nolan"). Solo quando la label manca: 1 chiamata API
    // veloce, mai join sitelink in SPARQL (troppo lento, manda in timeout
    // l'intera query). In cache va il nome canonico (matchDirectorName),
    // mai reso: la chiave non contiene la lingua.
    let director = [...directorLabels][0] || null
    if (!director) {
      const fallbackQid = [...directorQids][0]
      if (fallbackQid) {
        const wikiTitle = await enwikiTitle(fallbackQid, signal).catch(() => null)
        if (wikiTitle) director = wikiTitle
      }
    }
    const directorName = matchDirectorName(director)

    const result: WikidataResult = {
      awards: matchRules([...awardLabels]),
      nominations: matchRules([...nominationLabels]),
      studios: matchStudios([...networkLabels]),
      director: directorName,
      degraded: false,
    }

    // Store in shared cache with tags for targeted invalidation
    cacheSet(cacheKey, result, ["wikidata"], WIKIDATA_CACHE_TTL)
    return result
  } catch {
    return { awards: [], nominations: [], studios: [], director: null, degraded: true }
  }
}

export async function fetchAwards(tmdbId: number, mediaType: "movie" | "tv"): Promise<string[]> {
  const data = await fetchAllWikidata(tmdbId, mediaType)
  return data.awards
}
