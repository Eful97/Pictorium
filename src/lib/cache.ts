import crypto from "node:crypto"
import { envWithFallback } from "@/lib/env-compat"
import { getKv, getStorageMode, withKvTimeout } from "@/lib/kv"

interface CacheEntry<T> {
  data: T
  timestamp: number
  tags: string[]
  ttl?: number
}

export type CacheTagStats = {
  readonly tag: string
  readonly count: number
}

export type CacheStatus = {
  readonly totalEntries: number
  readonly taggedEntries: readonly CacheTagStats[]
  readonly untaggedEntries: number
  /**
   * Stima dei payload delle entry attive (significato storico, invariato).
   * Come gli altri contatori byte è una stima dei payload, non la memoria
   * complessiva del processo (esclude l'overhead delle strutture).
   */
  readonly totalBytes: number
  /** Stima dei payload stale trattenuti per la rivalidazione (tag poster/catalog). */
  readonly staleBytes: number
  /** Stima totale trattenuta: payload attivi + stale (sempre totalBytes + staleBytes). */
  readonly retainedBytes: number
  readonly maxBytes: number
  readonly maxEntries: number
}

const store = new Map<string, CacheEntry<unknown>>()

// ---------------------------------------------------------------------------
// C1: L2 condivisa su KV (opt-in: Redis nativo o Vercel KV/Upstash via
// `lib/kv.ts`). La Map resta L1: su VPS/HF senza backend configurato non
// cambia nulla (stesso pattern di store.ts).
// Solo JSON piccoli (<=64KB, mai Buffer): i poster/badge PNG resterebbero
// locali comunque (base64 +33%, limiti di valore e costi KV, latenza sul path
// caldo). Il premio è per i body catalogo/meta: su multi-istanza la seconda
// istanza serve dalla KV invece di rifare ~60 upstream.
// Chiavi auto-invalidanti: epoch/versioni sono già dentro le cache key
// (catalog-epoch, RENDER_VERSION, mapVersion) → le entry KV orfane scadono
// via EX, nessuna invalidazione per-tag necessaria su KV.
// Scrittura fire-and-forget (mai latenza sul path caldo); lettura solo su
// miss L1 (quando comunque si farebbe upstream lento). Errori KV = miss.
// ---------------------------------------------------------------------------
// Lettura live (mai a module level): i test mutano le env + resetModules.
// PICTORIUM_KV_CACHE=0 (or false/off/no) keeps the response cache in process
// memory only while state (users, mappings, settings, epochs) stays in KV.
// On a public instance write-through lets anonymous requests grow KV: every
// JSON cacheSet is written, and keys carry caller-controlled parts (api_key
// hash, config token, region) that live until each entry's TTL (up to ~24h
// for catalogs). The in-memory L1 is size-capped. Cost: replicas no longer
// share hits, so each one fetches upstream on its own.
function isKvL2(): boolean {
  const flag = (envWithFallback("KV_CACHE") || "").toLowerCase().trim()
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false
  return getStorageMode() === "kv"
}
const KV_L2_PREFIX = "pictorium:cache:"
const KV_L2_MAX_BYTES = 64 * 1024

function secondsUntilScheduledRefresh(): number {
  const now = new Date()
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), REFRESH_HOUR, 0, 0, 0)
  const target = next > now.getTime() ? next : next + 86400000
  return Math.max(60, Math.round((target - now.getTime()) / 1000))
}

/** Serializza per L2 solo se JSON piccolo senza Buffer; null = resta locale. */
function toKvPayload(data: unknown): string | null {
  if (Buffer.isBuffer(data)) return null
  try {
    const json = JSON.stringify(data)
    if (json.length > KV_L2_MAX_BYTES) return null
    // Buffer annidati serializzerebbero come {type:"Buffer",data:[...]} con
    // bloat e revive mancato → solo JSON puro in L2.
    if (json.includes('"type":"Buffer"')) return null
    return json
  } catch {
    return null
  }
}

function kvWriteThrough(key: string, data: unknown, ttlMs?: number, tags: string[] = [], timestamp: number = Date.now()): void {
  // Guardia dimensione/contenuto sul payload grezzo (mai Buffer, <=64KB).
  if (toKvPayload(data) === null) return
  const ex = ttlMs !== undefined
    ? Math.max(60, Math.round(ttlMs / 1000))
    : (isScheduledRefresh(tags) !== null ? secondsUntilScheduledRefresh() : Math.round(MAX_TTL / 1000));
  // Envelope con scadenza assoluta: generazione + TTL esplicito viaggiano con
  // il payload così il ripopolamento L1 su un'altra istanza conserva la
  // scadenza originale invece di ripartire da un'ora intera (no sliding
  // expiration: la read path non riscrive mai la KV).
  let envelope: string
  try {
    envelope = JSON.stringify({
      __pictoriumKv: 1,
      d: data,
      t: timestamp,
      ...(ttlMs !== undefined ? { ttl: ttlMs } : {}),
    })
    if (envelope.length > KV_L2_MAX_BYTES) return
  } catch {
    return
  }
  (async () => {
    try {
      await getKv().set(`${KV_L2_PREFIX}${key}`, envelope, { ex })
    } catch {
      // fail-open: la L1 resta valida, la L2 si ripopola al prossimo set
    }
  })()
}

/** Envelope KV→L1: payload + metadati di scadenza assoluta. */
interface KvEnvelope<T> {
  __pictoriumKv: 1
  d: T
  /** Generazione (ms epoch, = timestamp L1 dell'istanza scrittrice). */
  t: number
  /** TTL esplicito del writer; assente = regole scheduled/MAX_TTL dai tag. */
  ttl?: number
}

function isKvEnvelope(raw: unknown): raw is KvEnvelope<unknown> {
  if (typeof raw !== "object" || raw === null) return false
  const rec = raw as Record<string, unknown>
  return rec.__pictoriumKv === 1 && "d" in rec && typeof rec.t === "number"
}

async function kvReadThrough<T>(key: string): Promise<T | null> {
  try {
    // Tetto perentorio: una L2 stallata è un miss, mai un hang della route.
    const raw: unknown = await withKvTimeout(getKv().get(`${KV_L2_PREFIX}${key}`), 1500)
    // C1: il client KV può restituire la stringa così com'è o già parsata
    // (deserializzazione automatica Upstash / decode `kv.ts` su Redis):
    // accetta entrambi, scarta il resto.
    if (typeof raw === "string") return JSON.parse(raw) as T
    if (raw !== null && typeof raw === "object") return raw as T
    return null
  } catch {
    return null
  }
}

/** Miss L1 + hit L2: ripopola la L1 con gli stessi tag (stesse regole TTL).
 *  Ritorna null se L2 disabilitata/miss/errore.
 *  `ttlMs`: per i payload legacy senza envelope (che non trasportano metadati
 *  di scadenza) — senza un TTL esplicito la L1 ripopolata ricadrebbe nelle
 *  regole scheduled/MAX_TTL invece del TTL originale (es. catalogo non-vuoto
 *  1h → refresh giornaliero). Accetta il valore o un selettore sul dato (es.
 *  pieno/vuoto). Default undefined = comportamento storico per gli altri
 *  chiamanti. Gli envelope correnti vincono sul selettore (timestamp+TTL
 *  originali) e il ripopolamento è solo locale: mai rewrite KV, mai sliding
 *  expiration. */
export async function cacheGetShared<T>(key: string, tags: string[] = [], ttlMs?: number | ((data: T) => number | undefined)): Promise<T | null> {
  const local = cacheGet<T>(key)
  if (local !== null) return local
  if (!isKvL2()) return null
  const raw = await kvReadThrough<unknown>(key)
  if (raw === null) return null
  // Stessi tag dell'originale → stesse regole (MAX_TTL/scheduled); la
  // scadenza assoluta resta garantita dall'EX della entry KV.
  const data = (isKvEnvelope(raw) ? raw.d : raw) as T
  const envelopeTtl = isKvEnvelope(raw) ? raw.ttl : undefined
  const repopulateTtl = envelopeTtl ?? (typeof ttlMs === "function" ? ttlMs(data) : ttlMs)
  const timestamp = isKvEnvelope(raw) ? raw.t : Date.now()
  cacheSetLocalOnly(key, data, tags, repopulateTtl, timestamp)
  // Rilettura tramite cacheGet: se il residuo è già esaurito (es. envelope
  // letto oltre la scadenza originale) isExpired la scarta → miss.
  return cacheGet<T>(key)
}

const MAX_TTL = 30 * 60 * 1000
const rawMaxEntries = envWithFallback("CACHE_MAX")
const ENV_MAX_ENTRIES = rawMaxEntries ? parseInt(rawMaxEntries, 10) : 2000
const MAX_ENTRIES = Number.isFinite(ENV_MAX_ENTRIES) && ENV_MAX_ENTRIES > 100 ? ENV_MAX_ENTRIES : 2000
const rawMaxMb = envWithFallback("CACHE_MAX_MB")
const ENV_MAX_MB = rawMaxMb ? parseFloat(rawMaxMb) : 150
const MAX_BYTES = (Number.isFinite(ENV_MAX_MB) && ENV_MAX_MB > 10 ? ENV_MAX_MB : 150) * 1024 * 1024
const rawRefreshHour = envWithFallback("CACHE_REFRESH_HOUR")
const ENV_REFRESH_HOUR = rawRefreshHour ? parseInt(rawRefreshHour, 10) : 3
const REFRESH_HOUR = Number.isFinite(ENV_REFRESH_HOUR) && ENV_REFRESH_HOUR >= 0 && ENV_REFRESH_HOUR <= 23 ? ENV_REFRESH_HOUR : 3

let totalBytes = 0

const TAG_TTL: Record<string, number> = {}

const SCHEDULED_REFRESH: Record<string, number> = {
  poster: REFRESH_HOUR,
  catalog: REFRESH_HOUR,
}

function isScheduledRefresh(tags: string[]): number | null {
  for (const tag of tags) {
    if (SCHEDULED_REFRESH[tag] !== undefined) return SCHEDULED_REFRESH[tag]
  }
  return null
}

function ttlForTags(tags: string[]): number {
  for (const tag of tags) {
    if (TAG_TTL[tag]) return TAG_TTL[tag]
  }
  return MAX_TTL
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  // D3: Date.now() hoisted — prima veniva chiamato due volte per ogni
  // isExpired (refresh branch + fallback TTL). isExpired gira su ogni
  // cacheGet e nel cleanup: un solo clock read per controllo.
  const now = Date.now()
  // Un `ttl` esplicito vince sempre sul refresh schedulato: chi cacchetta con
  // un TTL corto (es. catalogo vuoto a 60s) non deve restare congelato fino
  // all'ora di refresh giornaliera.
  const refreshHour = entry.ttl === undefined ? isScheduledRefresh(entry.tags) : null
  if (refreshHour !== null) {
    // Use UTC so the refresh time is the same regardless of server timezone
    const nowDate = new Date(now)
    const todayRefresh = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate(), refreshHour, 0, 0, 0)

    if (now >= todayRefresh) {
      return entry.timestamp < todayRefresh
    } else {
      const yesterdayRefresh = todayRefresh - 86400000
      return entry.timestamp < yesterdayRefresh
    }
  }
  const ttl = entry.ttl || ttlForTags(entry.tags)
  return now - entry.timestamp > ttl
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null
let cleanupActive = false

function startCleanup() {
  if (cleanupActive) return
  cleanupActive = true
  cleanupTimer = setInterval(() => {
    if (store.size === 0) {
      // Cache empty — stop the timer until next use
      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
      cleanupActive = false
      return
    }
    const now = Date.now()
    for (const [key, entry] of store) {
      if (isExpired(entry)) {
        const isSwr = entry.tags.includes("poster") || entry.tags.includes("catalog")
        const graceMs = isSwr ? 24 * 60 * 60 * 1000 : 0
        const ttl = entry.ttl || ttlForTags(entry.tags)
        if (now - entry.timestamp > ttl + graceMs) {
          deleteEntry(key)
        }
      }
    }
  }, 60_000)
}

/**
 * Stima la dimensione in bytes di un valore per il memory tracking.
 *
 * Ricorsiva: somma `byteLength` dei Buffer figli. Prima si usava
 * JSON.stringify — per oggetti con Buffer annidati (es. badge `{png, w, h}`)
 * la stima era 2-6× il peso reale → makeSpace evictava poster/badge troppo
 * presto e la cache restava sotto-utilizzata rispetto al byte-limit reale.
 */
function estimateBytes(data: unknown): number {
  if (Buffer.isBuffer(data)) return data.byteLength
  if (typeof data === "string") return Buffer.byteLength(data)
  if (data === null || data === undefined) return 0
  if (typeof data === "number" || typeof data === "boolean") return 8
  if (Array.isArray(data)) {
    let total = 0
    for (const item of data) total += estimateBytes(item)
    return total
  }
  if (typeof data === "object") {
    let total = 0
    for (const [key, value] of Object.entries(data)) {
      total += Buffer.byteLength(key) + estimateBytes(value)
    }
    return total
  }
  return 0
}

function makeSpace(count: number, incomingBytes: number = 0, excludeKey?: string): void {
  if (store.size + count < MAX_ENTRIES && totalBytes + incomingBytes < MAX_BYTES) return
  // Map preserves insertion order; delete+set on read promotes accessed entries to end.
  // First keys are the least recently used. Evict in batches.
  const byteTarget = Math.max(0, Math.floor(MAX_BYTES * 0.9) - incomingBytes)
  for (const key of store.keys()) {
    // Stop solo quando ENTRAMBI i target sono soddisfatti: entry count sotto il
    // limite E byte sotto il target. Il vecchio blocco su entryLimit lasciava
    // la cache sopra MAX_BYTES quando una singola entry pesava molto (poster grandi).
    if (totalBytes <= byteTarget && store.size + count <= MAX_ENTRIES) break
    // La chiave in sostituzione non è mai evitta: il suo peso è già stato
    // rilasciato dal chiamante, evitta significherebbe doppia sottrazione.
    if (excludeKey !== undefined && key === excludeKey) continue
    const entry = store.get(key)
    if (entry) {
      totalBytes -= estimateBytes(entry.data)
    }
    store.delete(key)
  }
}

function deleteEntry(key: string): void {
  const entry = store.get(key)
  if (entry) totalBytes -= estimateBytes(entry.data)
  store.delete(key)
}

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (isExpired(entry)) {
    deleteEntry(key)
    return null
  }
  // Promote to most-recently-used (Map preserves insertion order)
  store.delete(key)
  store.set(key, entry)
  return entry.data
}

export function cacheGetStale<T>(key: string): { data: T | null; stale: boolean } {
  const entry = store.get(key) as CacheEntry<T> | undefined
  if (!entry) return { data: null, stale: false }
  if (isExpired(entry)) {
    return { data: entry.data as T, stale: true }
  }
  store.delete(key)
  store.set(key, entry)
  return { data: entry.data, stale: false }
}

/**
 * Inserimento solo-L1 (mai write-through KV): la read path KV→L1 lo usa per
 * ripopolare la memoria senza rinnovare la scadenza della entry KV condivisa
 * (no sliding expiration) e con il timestamp originale per conservare la
 * scadenza assoluta anche in locale.
 */
function cacheSetLocalOnly<T>(key: string, data: T, tags: string[], ttlMs: number | undefined, timestamp: number): void {
  if (!cleanupActive) startCleanup()
  const incomingBytes = estimateBytes(data)
  // Entry singola fuori budget: scartata invece di wipeare l'intera cache
  // (byteTarget 0 in makeSpace svuoterebbe tutto per un solo payload anomalo).
  // Vale anche per le sostituzioni: la voce precedente resta intatta.
  if (incomingBytes > MAX_BYTES) return
  const existing = store.get(key)
  if (!existing) {
    makeSpace(1, incomingBytes)
  } else {
    // Sostituzione: rilascia prima il peso precedente così l'evizione LRU
    // valuta solo la crescita netta e il totale stimato non supera mai
    // MAX_BYTES. La chiave sostituita è esclusa dall'evizione (il suo peso
    // è già stato sottratto una sola volta qui). `store.set` su chiave
    // esistente conserva la posizione d'inserzione: l'ordine LRU resta quello
    // storico (solo la lettura promuove a most-recently-used).
    totalBytes -= estimateBytes(existing.data)
    makeSpace(0, incomingBytes, key)
  }
  totalBytes += incomingBytes
  store.set(key, { data, timestamp, tags, ttl: ttlMs })
}

export function cacheSet<T>(key: string, data: T, tags: string[] = [], ttlMs?: number): void {
  const now = Date.now()
  cacheSetLocalOnly(key, data, tags, ttlMs, now)
  // C1: write-through L2 (fire-and-forget, mai latenza sul chiamante).
  if (isKvL2()) {
    kvWriteThrough(key, data, ttlMs, tags, now)
  }
}

export function cacheHas(key: string): boolean {
  return cacheGet(key) !== null
}

export function cacheInvalidate(tag: string): void {
  for (const [key, entry] of store) {
    if (entry.tags.includes(tag)) deleteEntry(key)
  }
}

/**
 * Pone timestamp = 0 su tutte le entry che matchano tagOrKey (tag, key esatta o prefisso/substring),
 * rendendole immediatamente stale per il pattern SWR senza cancellare il payload dalla memoria.
 * Ritorna il numero di entry scadute.
 */
export function cacheExpire(tagOrKey: string): number {
  let count = 0
  for (const [key, entry] of store) {
    if (entry.tags.includes(tagOrKey) || key === tagOrKey || key.startsWith(tagOrKey) || key.includes(tagOrKey)) {
      entry.timestamp = 0
      count++
    }
  }
  return count
}

export function cacheInvalidatePosterData(): void {
  cacheInvalidate("poster")
  cacheInvalidate("catalog")
  cacheInvalidate("stremio")
  cacheInvalidate("badge")
}

/**
 * Invalida solo la cache relativa a un mapping specifico (poster + badge).
 * Più mirato di cacheInvalidatePosterData() che svuota tutto.
 */
export function cacheInvalidatePosterDataFor(type: string, tmdbId: number): void {
  const mappingTag = `poster:${type}:${tmdbId}`
  cacheInvalidate(mappingTag)
}

/**
 * Come sopra ma solo per il namespace utente (multi-user): il save di A non
 * invalida i poster cachati di B. Il tag deve coincidere con quello scritto
 * dalla poster route (`poster:${type}:${id}:u<hash>`): l'UUID viaggia solo
 * come md5-8, mai in chiaro nei tag (stessa forma della cache key poster).
 */
export function cacheInvalidatePosterDataForUser(type: string, tmdbId: number, userId: string): void {
  cacheInvalidate(`poster:${type}:${tmdbId}:${userTagFragment(userId)}`)
}

/** Frammento tag/cache per-namespace: md5-8 dell'UUID, mai l'UUID in chiaro. */
export function userTagFragment(userId: string): string {
  return `u${crypto.createHash("md5").update(userId).digest("hex").slice(0, 8)}`
}

/**
 * Frammento utente per le CACHE KEY (catalog/meta/poster): sha256-16, mai
 * l'UUID in chiaro. I vecchi 32-bit collidono al ~1% già a 10k utenti
 * (birthday bound) e una collisione serve a B il render cachato di A
 * (mapping/default altrui = leak visivo). I tag restano a userTagFragment
 * (lì una collisione causa solo over-invalidazione, direzione sicura).
 */
export function hashUserFragment(userId: string): string {
  return crypto.createHash("sha256").update(userId).digest("hex").slice(0, 16)
}

export function cacheStatus(): CacheStatus {
  const tagCounts = new Map<string, number>()
  let totalEntries = 0
  let untaggedEntries = 0
  let activeBytes = 0
  let staleBytes = 0

  for (const [key, entry] of store) {
    if (isExpired(entry)) {
      // Entry senza supporto SWR: evizione immediata su status pass.
      // Entry SWR (poster/catalog): non cancellare per consentire la revalidazione in background,
      // ma escludere dai conteggi di entry attive. Il payload resta in memoria:
      // va conteggiato a parte come byte stale trattenuti.
      const isSwr = entry.tags.includes("poster") || entry.tags.includes("catalog")
      if (!isSwr) {
        deleteEntry(key)
      } else {
        staleBytes += estimateBytes(entry.data)
      }
      continue
    }

    totalEntries += 1
    activeBytes += estimateBytes(entry.data)

    if (entry.tags.length === 0) {
      untaggedEntries += 1
      continue
    }

    for (const tag of entry.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }

  const taggedEntries = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))

  return {
    totalEntries,
    taggedEntries,
    untaggedEntries,
    totalBytes: activeBytes,
    staleBytes,
    retainedBytes: activeBytes + staleBytes,
    maxBytes: MAX_BYTES,
    maxEntries: MAX_ENTRIES,
  }
}

export function cacheClear(): void {
  store.clear()
  totalBytes = 0
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
  cleanupActive = false
}
