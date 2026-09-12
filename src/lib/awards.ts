import { cacheGetShared, cacheSet } from "./cache"
import { createLogger } from "@/lib/logger"
import { combineAbortSignals } from "./abort-signal"

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
}

// ---- Circuit breaker ----
let breakerFailures = 0
let breakerOpenUntil = 0
let breakerHalfOpen = false
const BREAKER_THRESHOLD = 5
const BREAKER_BACKOFF_MS = 60_000

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
  const now = Date.now()
  // Finestra di backoff: tutte le richieste rifiutate.
  if (breakerOpenUntil > now) return true
  // Soglia raggiunta e finestra scaduta: entra in half-open.
  if (breakerFailures >= BREAKER_THRESHOLD) {
    if (breakerHalfOpen) return true // una prova è già in corso → rifiuta
    breakerHalfOpen = true
    log.info("Circuit breaker half-open: one trial request allowed")
    return false
  }
  return false
}

function recordSuccess(): void {
  breakerFailures = 0
  breakerHalfOpen = false
}

function recordFailure(): void {
  breakerFailures++
  breakerHalfOpen = false
  // Apre la finestra di backoff solo al raggiungimento della soglia: i primi
  // N fallimenti non devono ancora rifiutare alcuna richiesta. Anche il
  // fallimento della prova half-open (già sopra soglia) impone un'altra
  // attesa prima della prossima prova.
  if (breakerFailures >= BREAKER_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_BACKOFF_MS
    log.warn(`Circuit breaker failure #${breakerFailures} — backoff ${BREAKER_BACKOFF_MS}ms`)
  }
}

// Esposte per i test unitari del circuito (stesso pattern di __resetJWRankingsCache).
export { isBreakerOpen, recordSuccess, recordFailure }

/** Solo per i test: azzera lo stato del circuit breaker. */
export function __resetCircuitBreaker(): void {
  breakerFailures = 0
  breakerOpenUntil = 0
  breakerHalfOpen = false
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
        const res = await fetch(url, {
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

// ---- Matching logic ----

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

const NETWORKS = [
  "Netflix", "Amazon Prime Video", "Apple TV+", "Disney+", "HBO", "Max",
  "Paramount+", "Crunchyroll", "Prime Video",
  "Rai", "Mediaset", "Sky", "Cartoon Network", "Nickelodeon", "Adult Swim",
  "Universal Pictures", "Warner Bros.", "Paramount Pictures", "Columbia Pictures",
  "20th Century Studios", "Walt Disney Pictures", "Marvel Studios", "Pixar",
  "Studio Ghibli", "Sony Pictures",
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Match network name with word boundaries to avoid false positives (e.g. "rai" in "raindrop") */
function nameMatchesNetwork(name: string, network: string): boolean {
  if (name === network) return true
  // Use word boundary: matches "rai cinema" but not "raindrop" or "tutorial"
  // Escape network for RegExp (e.g. "Apple TV+", "Paramount+" contain +)
  return new RegExp(`\\b${escapeRegExp(network)}\\b`).test(name)
}

export function matchTMDBStudios(names: string[]): string[] {
  const found = new Set<string>()
  for (const name of names) {
    const lower = name.toLowerCase().trim()
    for (const net of NETWORKS) {
      const nLower = net.toLowerCase()
      if (lower === nLower || nameMatchesNetwork(lower, nLower)) {
        found.add(net)
        break
      }
    }
  }
  return [...found]
}

function matchStudios(labels: string[]): string[] {
  const unique = [...new Set(labels.map((l) => l.trim()))].filter(Boolean)
  const found = new Set<string>()
  for (const label of unique) {
    const lower = label.toLowerCase()
    for (const net of NETWORKS) {
      const nLower = net.toLowerCase()
      if (lower === nLower || nameMatchesNetwork(lower, nLower)) {
        found.add(net)
        break
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

/**
 * Titolo del sitelink enwiki di un item (es. Q25191 → "Christopher Nolan").
 * Fallback fail-open per item senza label: 1 chiamata API veloce con timeout
 * breve, MAI join sitelink in SPARQL (rende la query 10x più lenta).
 */
async function enwikiTitle(qid: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=sitelinks&sitefilter=enwiki&format=json`
    const res = await fetch(url, {
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

function matchDirector(name: string | null, t?: (key: string, params?: Record<string, string | number>) => string): string | null {  if (!name) return null
  const lower = name.toLowerCase().trim()
  for (const d of DIRECTORS) {
    if (lower === d.toLowerCase() || lower.includes(d.toLowerCase())) {
      return t ? t("badge.director", { name: d }) : `Di ${d}`
    }
  }
  return null
}

const WIKIDATA_CACHE_TTL = 24 * 60 * 60 * 1000

export async function fetchAllWikidata(
  tmdbId: number,
  mediaType: "movie" | "tv",
  t?: (key: string, params?: Record<string, string | number>) => string,
  // R3: signal esterno (es. deadline render) — senza, il fetch sopravvive al
  // watchdog come zombie anche dopo il 503.
  signal?: AbortSignal,
): Promise<WikidataResult> {
  const cacheKey = `wikidata:${mediaType}:${tmdbId}`

  // Check shared cache first (typed, with TTL). L1 + L2 KV cross-istanza:
  // la prima istanza che riesce condivide con tutte (prima ogni istanza
  // ritirava i dadi SPARQL per conto suo → lotteria badge multi-istanza).
  const cached = await cacheGetShared<WikidataResult>(cacheKey, ["wikidata"])
  if (cached) return cached

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
      // Fallimento transitorio (breaker, timeout, 5xx): non inquinare la cache 24h
      return { awards: [], nominations: [], studios: [], director: null }
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
    // l'intera query). matchDirector usa comunque il nome canonico.
    let director = [...directorLabels][0] || null
    if (!director) {
      const fallbackQid = [...directorQids][0]
      if (fallbackQid) {
        const wikiTitle = await enwikiTitle(fallbackQid, signal).catch(() => null)
        if (wikiTitle) director = wikiTitle
      }
    }
    const directorBadge = matchDirector(director, t)

    const result: WikidataResult = {
      awards: matchRules([...awardLabels]),
      nominations: matchRules([...nominationLabels]),
      studios: matchStudios([...networkLabels]),
      director: directorBadge,
    }

    // Store in shared cache with tags for targeted invalidation
    cacheSet(cacheKey, result, ["wikidata"], WIKIDATA_CACHE_TTL)
    return result
  } catch {
    return { awards: [], nominations: [], studios: [], director: null }
  }
}

export async function fetchAwards(tmdbId: number, mediaType: "movie" | "tv"): Promise<string[]> {
  const data = await fetchAllWikidata(tmdbId, mediaType)
  return data.awards
}

export function getAwardBadgeLabel(awards: string[], t?: (key: string, params?: Record<string, string | number>) => string): string | null {
  const priority = ["Oscar", "Cannes", "Venezia", "BAFTA", "Golden Globe", "Emmy", "David"]
  for (const a of priority) {
    if (awards.includes(a)) return t ? t("badge.winner", { name: t(`award.${a.toLowerCase().replace(/ /g, "_")}`) }) : `${a}`
  }
  return null
}

export function getNominationBadgeLabel(nominations: string[], t?: (key: string, params?: Record<string, string | number>) => string): string | null {
  const priority = ["Oscar", "Cannes", "Venezia", "BAFTA", "Golden Globe", "Emmy", "David"]
  for (const a of priority) {
    if (nominations.includes(a)) return t ? t("badge.nominee", { name: t(`award.${a.toLowerCase().replace(/ /g, "_")}`) }) : `Candidato ${a}`
  }
  return null
}
