import type { NextRequest } from "next/server"
import { cacheGet, cacheGetStale, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { isBadgeStyle, isRankingBadgeStyle } from "@/lib/badge-styles"
import { POSTER_CACHE_ALLOWLIST } from "./poster-params-hardening"

const log = createLogger("poster-cache")

export const POSTER_REFRESH_PARAM = "__poster_refresh"

const POSTER_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
const POSTER_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable"
const PREVIEW_CACHE_CONTROL = "no-cache, no-store, must-revalidate, max-age=0"

export interface PosterCachePayload {
  readonly buffer: Buffer
  readonly etag: string
}

// TTL dei poster dinamici (non-mappati, composti al volo): default 6h.
// Sovrascrivibile via env a module level (un cambio richiede restart).
// Gli header Cache-Control/Surrogate derivano dallo STESSO valore del TTL di
// storage: l'header HTTP non può mentire rispetto a quanto resta in cache
// (coerente con fix M3).
const DYNAMIC_POSTER_TTL_SEC = (() => {
  const raw = envWithFallback("DYNAMIC_POSTER_TTL_MS")
  const n = raw ? parseInt(raw, 10) : 6 * 60 * 60 * 1000
  // Clamp 5min–24h: sotto i 5 minuti la CDN martellerebbe il render pipeline,
  // sopra le 24h i dati dinamici (rank, IMDb Top 250) diventano troppo stantii.
  return Number.isFinite(n) && n >= 5 * 60 * 1000 && n <= 24 * 60 * 60 * 1000
    ? Math.round(n / 1000)
    : 6 * 60 * 60
})()
const DYNAMIC_POSTER_TTL_MS = DYNAMIC_POSTER_TTL_SEC * 1000

// Jitter deterministico anti-thundering-herd (Milestone A): il TTL dinamico
// varia ±10% in base all'hash FNV-1a della cache key. Deterministico: stessa
// key → stesso TTL su tutte le istanze (mai Math.random, che frammenterebbe
// la scadenza tra processi). Su un warmup bulk spalma le scadenze su ~72min
// invece di farle collassare tutte nello stesso secondo.
const DYNAMIC_TTL_JITTER_PCT = 10

/** TTL di storage (ms) per una entry dinamica: base ±10% deterministico. */
export function dynamicPosterTtlMs(cacheKey: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < cacheKey.length; i++) {
    h ^= cacheKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  const pct = ((h >>> 0) % (2 * DYNAMIC_TTL_JITTER_PCT + 1)) - DYNAMIC_TTL_JITTER_PCT
  return Math.round((DYNAMIC_POSTER_TTL_MS * (100 + pct)) / 100)
}

/** TTL dinamico in secondi (per gli header HTTP): deriva dallo stesso valore
 *  dello storage — l'header non mente mai rispetto alla cache (M3). */
export function dynamicPosterTtlSec(cacheKey: string): number {
  return Math.round(dynamicPosterTtlMs(cacheKey) / 1000)
}

const POSTER_CDN_CACHE_CONTROL = POSTER_CACHE_CONTROL


export type PosterHeaders = Readonly<Record<string, string>>

export interface ImmutablePosterRequestState {
  readonly hasMapping?: boolean
  readonly isRotating?: boolean
  readonly mappingVersionMatches?: boolean
}

const inflight = new Map<string, Promise<PosterCachePayload | null>>()

const refreshInFlight = new Set<string>()
const lastRefreshAt = new Map<string, number>()
const MIN_REFRESH_INTERVAL_MS = 60_000
const MAX_REFRESH_TRACKED = 500

// Se un render in flight muore (crash/timeout serverless) senza chiamare la
// funzione di completamento, la promise resterebbe appesa nella map per sempre
// bloccando ogni richiesta successiva con la stessa cache key su await.
// Timeout difensivo: dopo N secondi risolve con null e libera la map.
const INFLIGHT_TIMEOUT_MS = 60_000

export function normalizePosterCacheParams(searchParams: URLSearchParams): URLSearchParams {
  // Allowlist rigida anti cache-busting (v1.23.0): solo i parametri noti
  // entrano nella chiave — ?x=$RANDOM collassa invece di missare. I repeat
  // multipli della stessa chiave sono preservati come prima.
  const params = new URLSearchParams()
  const seen = new Set<string>()
  for (const [key, value] of searchParams) {
    if (!POSTER_CACHE_ALLOWLIST.has(key)) continue
    // Dedup al primo valore (v1.23.0): il render legge .get() (prima
    // occorrenza), ma la serializzazione includerebbe i repeat —
    // ?blur=20&blur=20 sarebbe una chiave diversa a render identico.
    if (seen.has(key)) continue
    seen.add(key)
    params.append(key, value)
  }
  params.delete("rv")
  params.delete("v")
  params.delete(POSTER_REFRESH_PARAM)

  const ac = params.get("ac")
  if (ac !== null && !/^#([0-9A-Fa-f]{3}){1,2}$/.test(ac)) {
    params.delete("ac")
  }
  const tl = params.get("tl")
  if (tl !== null && tl !== "1" && tl !== "0" && tl !== "true" && tl !== "false") {
    params.delete("tl")
  }
  const bl = params.get("bl")
  if (bl !== null && bl !== "1" && bl !== "0" && bl !== "true" && bl !== "false") {
    params.delete("bl")
  }
  const bs = params.get("bs")
  if (bs !== null && !isBadgeStyle(bs)) {
    params.delete("bs")
  }
  const rs = params.get("rs")
  if (rs !== null && !isRankingBadgeStyle(rs)) {
    params.delete("rs")
  }

  return params
}

export function isPosterRefreshRequest(searchParams: URLSearchParams): boolean {
  return searchParams.get(POSTER_REFRESH_PARAM) === "1"
}

export function isImmutablePosterRequest(searchParams: URLSearchParams, state: ImmutablePosterRequestState = {}): boolean {
  if (!searchParams.has("rv") || state.isRotating) return false
  // Senza mapping il poster NON può essere immutable per un anno: viene composto
  // al volo con dati dinamici (rank JustWatch, premi, IMDb Top 250) che cambiano
  // di settimana in settimana — un header immutable li congelerebbe alla CDN.
  // Con mapping, l'immutable richiede anche che il versionamento del mapping
  // (mv) corrisponda, altrimenti la cache edge può servire un poster stantio.
  return state.hasMapping === true && state.mappingVersionMatches === true
}

export type PosterImageFormat = "jpeg" | "webp" | "avif"

const FORMAT_MIME_TYPES: Record<PosterImageFormat, string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
}

export function resolveImageFormat(acceptHeader?: string | null, queryFmt?: string | null): PosterImageFormat {
  if (queryFmt) {
    const q = queryFmt.toLowerCase()
    if (q === "webp") return "webp"
    // C3: ?fmt=avif esplicito resta onorato (render dedicato legacy); via
    // Accept l'avif mappa a webp (tutti i client avif accettano anche webp,
    // l'encode avif costa 3-5× e triplicherebbe render+cache).
    if (q === "avif") return "avif"
    if (q === "jpeg" || q === "jpg") return "jpeg"
  }
  if (!acceptHeader) return "jpeg"
  const accept = acceptHeader.toLowerCase()
  if (accept.includes("image/webp")) return "webp"
  return "jpeg"
}

// C3: conversione jpeg canonico → webp on-the-fly. Stesse opzioni
// dell'encode webp diretto in poster-service (q80, effort 2): byte non
// identici al render diretto (doppia compressione), ma stessa qualità
// percepita — il webp esiste solo come variante di risposta, mai come chiave
// di render. ~20-50ms contro ~2-8s di re-render completo.
export async function convertPosterFormat(jpeg: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default
  return sharp(jpeg).webp({ quality: 80, effort: 2 }).toBuffer()
}

/** ETag deterministico della variante webp derivato da quello canonico. */
export function variantEtagFor(canonicalEtag: string): string {
  let h = 0x811c9dc5
  const s = `${canonicalEtag}:webp`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `"${(h >>> 0).toString(16).padStart(8, "0")}"`
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "ETag, Cache-Control",
  "Vary": "Accept",
}

export function posterHeaders(etag: string, immutable: boolean, isPreview: boolean = false, dynamic: boolean = false, format: PosterImageFormat = "jpeg", dynamicTtlSec?: number): PosterHeaders {
  const contentType = FORMAT_MIME_TYPES[format] || "image/jpeg"
  if (isPreview) {
    return {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": PREVIEW_CACHE_CONTROL,
      "Pragma": "no-cache",
      "Expires": "0",
      "ETag": etag,
    }
  }
  // TTL reale della entry (con jitter) o base quando omesso: header e storage
  // restano sincronizzati per costruzione (M3) — entrambi derivano da
  // dynamicPosterTtlSec(cacheKey) nel chiamante.
  const dynSec = dynamicTtlSec ?? DYNAMIC_POSTER_TTL_SEC
  const dynamicCacheControl = `public, max-age=${dynSec}, s-maxage=${dynSec}, stale-while-revalidate=86400`
  const dynamicSurrogate = `max-age=${dynSec}, stale-while-revalidate=86400`
  const cacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? dynamicCacheControl : POSTER_CACHE_CONTROL
  const cdnCacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? dynamicCacheControl : POSTER_CDN_CACHE_CONTROL
  const surrogate = immutable ? "max-age=31536000" : dynamic ? dynamicSurrogate : "max-age=86400, stale-while-revalidate=604800"
  return {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cdnCacheControl,
    "Surrogate-Control": surrogate,
    "ETag": etag,
  }
}

export function posterNotModifiedHeaders(etag: string, immutable: boolean, dynamic: boolean = false, dynamicTtlSec?: number): PosterHeaders {
  const dynSec = dynamicTtlSec ?? DYNAMIC_POSTER_TTL_SEC
  const dynamicCacheControl = `public, max-age=${dynSec}, s-maxage=${dynSec}, stale-while-revalidate=86400`
  const dynamicSurrogate = `max-age=${dynSec}, stale-while-revalidate=86400`
  const cacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? dynamicCacheControl : POSTER_CACHE_CONTROL
  const cdnCacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? dynamicCacheControl : POSTER_CDN_CACHE_CONTROL
  const surrogate = immutable ? "max-age=31536000" : dynamic ? dynamicSurrogate : "max-age=86400, stale-while-revalidate=604800"
  return {
    ...CORS_HEADERS,
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cdnCacheControl,
    "Surrogate-Control": surrogate,
    "ETag": etag,
  }
}

export interface ServerTimingEntry {
  readonly name: string
  readonly durMs?: number
  readonly desc?: string
}

/**
 * Valore `Server-Timing` per le risposte poster (`fetch;dur=123, total;dur=456`,
 * `cache;desc="HIT", total;dur=4`). Diagnostica per-request senza righe di log
 * aggiuntive: la scomposizione fetch/prep/composite vive già nel log
 * "Poster rendered". Solo esposizione, mai raccolta di dati personali.
 */
export function serverTimingValue(entries: readonly ServerTimingEntry[]): string {
  return entries
    .map((e) => {
      const dur = e.durMs === undefined ? "" : `;dur=${Math.max(0, Math.round(e.durMs))}`
      const desc = e.desc === undefined ? "" : `;desc="${e.desc}"`
      return `${e.name}${desc}${dur}`
    })
    .join(", ")
}

export function posterResponse(payload: PosterCachePayload, immutable: boolean, isPreview: boolean = false, dynamic: boolean = false, format: PosterImageFormat = "jpeg", dynamicTtlSec?: number, serverTiming?: string): Response {
  const headers = posterHeaders(payload.etag, immutable, isPreview, dynamic, format, dynamicTtlSec)
  return new Response(new Uint8Array(payload.buffer), {
    headers: serverTiming ? { ...headers, "Server-Timing": serverTiming } : headers,
  })
}

export interface PosterHeadersRecord {
  readonly etag: string
  readonly ttlSec?: number
  readonly immutable?: boolean
}

export function readCachedPoster(cacheKey: string): { readonly payload: PosterCachePayload | null; readonly stale: boolean; readonly ttlSec?: number; readonly immutable?: boolean } {
  const cached = cacheGetStale<Buffer>(cacheKey)
  const cachedHeaders = cacheGetStale<PosterHeadersRecord>(`${cacheKey}:headers`)
  if (!cached.data || !cachedHeaders.data) return { payload: null, stale: false }
  return {
    payload: { buffer: cached.data, etag: cachedHeaders.data.etag },
    stale: cached.stale || cachedHeaders.stale,
    ttlSec: cachedHeaders.data.ttlSec,
    immutable: cachedHeaders.data.immutable,
  }
}

// Poster non-mappati (composti al volo con dati dinamici): TTL esplicito
// (fix M3). Prima writeCachedPoster non passava alcun TTL → il tag "poster"
// finiva nel refresh schedulato giornaliero alle 3 UTC (cache.ts) e l'header
// HTTP dynamic (6h) mentiva: in memoria il payload restava fino al refresh
// delle 3, con rank/IMDb Top 250 potenzialmente stantii per un giorno intero.
// DYNAMIC_POSTER_TTL_MS è definito in testa al modulo (env-parametrizzato);
// dynamicPosterTtlMs aggiunge il jitter deterministico ±10% per key e gli
// header dynamic derivano dallo stesso dynamicPosterTtlSec, così header e
// storage restano sincronizzati.

export interface WriteCachedPosterOpts {
  /** TTL esplicito in ms (es. qualità effimera): vince su default mapping/dinamico. */
  readonly ttlMs?: number
  /** Flag immutable effettivo della risposta: persistito per le HIT (M3). */
  readonly immutable?: boolean
}

export function writeCachedPoster(cacheKey: string, payload: PosterCachePayload, mappingTag?: string, opts?: WriteCachedPosterOpts): void {
  const tags = mappingTag ? ["poster", mappingTag] : ["poster"]
  // TTL esplicito solo per i non-mappati: per i mappati resta il refresh
  // schedulato giornaliero (immutable per un anno alla CDN, invalido per tag).
  // Jitter deterministico anti-herd: stessa key → stesso TTL ovunque (M3
  // garantito perché gli header derivano dallo stesso dynamicPosterTtlSec).
  // opts.ttlMs (es. qualità effimera dopo timeout upstream) vince su tutto,
  // anche sul path mappato: un render degradato non deve mai restare 24h.
  const explicitTtlMs = opts?.ttlMs
  const ttl = explicitTtlMs ?? (mappingTag ? undefined : dynamicPosterTtlMs(cacheKey))
  // ttlSec/immutable nel record header: le HIT riusano gli stessi valori dello
  // storage (M3) invece di sovrastimare max-age/immutable con i default di
  // richiesta su entry effimere. Record vecchi senza campi → fallback invariato.
  const ttlSec = explicitTtlMs !== undefined
    ? Math.max(1, Math.round(explicitTtlMs / 1000))
    : (mappingTag ? undefined : dynamicPosterTtlSec(cacheKey))
  const record: PosterHeadersRecord = { etag: payload.etag, ttlSec, immutable: opts?.immutable }
  cacheSet(cacheKey, payload.buffer, tags, ttl)
  cacheSet(`${cacheKey}:headers`, record, tags, ttl)
}

// ---------------------------------------------------------------------------
// Negative cache (F3): un errore 500/503 recente evita di ri-rendere la stessa
// cache key per il TTL, altrimenti ogni retry ricolpisce upstream e slot con la
// pipeline completa. TTL breve: si svuota da sola, senza invalidation esplicita.
// ---------------------------------------------------------------------------

export type PosterErrorStatus = 500 | 503 | 404

export interface PosterErrorRecord {
  readonly status: PosterErrorStatus
}

const NEGATIVE_TTL_MS = (() => {
  const raw = envWithFallback("NEGATIVE_CACHE_TTL_MS")
  const n = raw ? parseInt(raw, 10) : 5000
  return Number.isFinite(n) && n >= 1000 && n <= 60000 ? n : 5000
})()

let negativeWrites = 0
let negativeHits = 0

export function writePosterError(cacheKey: string, status: PosterErrorStatus): void {
  negativeWrites++
  cacheSet(`${cacheKey}:err`, { status } satisfies PosterErrorRecord, ["poster-error"], NEGATIVE_TTL_MS)
}

export function readPosterError(cacheKey: string): PosterErrorRecord | null {
  const rec = cacheGet<PosterErrorRecord>(`${cacheKey}:err`)
  if (rec) negativeHits++
  return rec
}

/** Contatori della negative cache per /status. */
export function posterErrorStats(): { readonly writes: number; readonly hits: number } {
  return { writes: negativeWrites, hits: negativeHits }
}

export function getPendingPoster(cacheKey: string): Promise<PosterCachePayload | null> | null {
  return inflight.get(cacheKey) ?? null
}

export function beginPosterRender(
  cacheKey: string,
): (payload: PosterCachePayload | null, keepEntry?: boolean) => void {
  // Race guard: non sovrascrivere un render già in corso. (Il tratto
  // getPendingPoster→begin nella route non ha await in mezzo, quindi in Node
  // è atomico: questa guardia è difensiva, non il meccanismo primario.)
  if (inflight.has(cacheKey)) return () => {}

  let resolveRender: (payload: PosterCachePayload | null) => void = () => {}
  const promise = new Promise<PosterCachePayload | null>((resolve) => {
    resolveRender = resolve
  })
  const timer = setTimeout(() => {
    resolveRender(null)
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey)
  }, INFLIGHT_TIMEOUT_MS)
  if (typeof timer.unref === "function") timer.unref()
  inflight.set(cacheKey, promise)
  return (payload, keepEntry = false) => {
    // R4: al watchdog (keepEntry=true) i waiter vengono risolti con null MA
    // l'entry resta prenotata allo zombie finché finisce (o fino al timeout
    // 60s sopra). Prima l'entry veniva cancellata subito: ogni richiesta
    // successiva con la stessa key non trovava inflight e duplicava l'intero
    // render proprio con upstream lento — moltiplicatore di carico invece di
    // coalescing. I nuovi arrivati si attaccano alla promise già risolta con
    // null → 503 immediato, zero lavoro duplicato.
    if (!keepEntry) clearTimeout(timer)
    resolveRender(payload)
    if (!keepEntry && inflight.get(cacheKey) === promise) inflight.delete(cacheKey)
  }
}

export function schedulePosterRefresh(req: NextRequest, isPreview: boolean = false): void {
  // Le preview (`preview=1`) non vengono servite alle CDN: rigenerarle in
  // background è inutile. Il refresh serve solo per riscaldare la cache edge.
  if (isPreview) return
  if (process.env.VERCEL) return // Serverless: nessun self-fetch in background
  const internalOrigin = `http://127.0.0.1:${process.env.PORT || "3000"}`
  const searchParams = new URLSearchParams(req.nextUrl.searchParams)
  // Fix M1: non inoltrare api_key in chiaro nell'URL di loopback — la chiave
  // viene passata via header x-api-key (come già fa il warmup dei cataloghi).
  // route.ts:167 rimuove già api_key dal cacheKey per non tenerla in memoria.
  const apiKeyForRefresh = searchParams.get("api_key") || req.headers.get("x-api-key") || undefined
  searchParams.delete("api_key")
  searchParams.delete("x-api-key")
  searchParams.set(POSTER_REFRESH_PARAM, "1")
  const refreshUrl = `${internalOrigin}${req.nextUrl.pathname}?${searchParams.toString()}`
  const key = `${req.nextUrl.pathname}?${searchParams.toString()}`
  // Dedup: non avviare due refresh concorrenti per la stessa URL.
  if (refreshInFlight.has(key)) return
  // Min-interval: evita che un titolo sotto attacco (o una catena di stale hit)
  // generi un self-fetch a ogni richiesta — la cache locale viene comunque
  // rigenerata dalla prima richiesta che arriva con il param di refresh.
  const now = Date.now()
  const last = lastRefreshAt.get(key)
  if (last !== undefined && now - last < MIN_REFRESH_INTERVAL_MS) return
  if (lastRefreshAt.size >= MAX_REFRESH_TRACKED) lastRefreshAt.delete(lastRefreshAt.keys().next().value!)
  lastRefreshAt.set(key, now)
  refreshInFlight.add(key)
  const refreshHeaders: Record<string, string> = {}
  if (apiKeyForRefresh) refreshHeaders["x-api-key"] = apiKeyForRefresh
  void fetch(refreshUrl, {
    headers: Object.keys(refreshHeaders).length > 0 ? refreshHeaders : undefined,
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (res) => {
      // Consuma/cancella il body per evitare memory leak senza allocare buffer enormi
      await res.body?.cancel().catch(() => {})
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn("Background refresh failed", { error: msg })
    })
    .finally(() => { refreshInFlight.delete(key) })
}

// ---------------------------------------------------------------------------
// Render concurrency limiter (anti-OOM)
// ---------------------------------------------------------------------------
// Un cache-miss tiene in memoria poster originali + logo + backdrop + buffer
// RGBA e i risultati delle composizioni sharp (decine di MB per richiesta).
// Su istanze con heap limitato (Docker: --max-old-space-size=384) un burst di
// miss su titoli diversi può portare a OOM senza backpressure. Questo limiter
// serializza i render costosi: le richieste in eccesso attendono un posto per
// un tempo limitato, poi ricevono 503 invece di accodarsi all'infinito.

const MAX_CONCURRENT_RENDERS = (() => {
  const raw = envWithFallback("MAX_CONCURRENT_RENDERS")
  const n = raw ? parseInt(raw, 10) : 4
  return Number.isFinite(n) && n > 0 && n <= 32 ? n : 4
})()
// Attesa massima di un posto di render prima del 503 (F5). Lettura a module
// level: un cambio env richiede restart, non hot-reload.
// Default 15000: le griglie catalogo (Stremio/AIOMetadata) richiedono ~20 poster
// in parallelo su cache fredda; con 4 slot e 5s molti ricevevano 503 (poster
// mancanti). I waiter non tengono buffer immagini (i fetch avvengono dentro lo
// slot), quindi allungare l'attesa è memory-neutral.
export const RENDER_SLOT_WAIT_MS = (() => {
  const raw = envWithFallback("RENDER_SLOT_WAIT_MS")
  // Vercel Hobby: 10s di limite funzione — con 15s di attesa la piattaforma
  // chiuderebbe con 504 prima del nostro 503. Default hobby-safe SOLO se
  // l'utente non ha impostato un valore esplicito (su Pro vale il default).
  const fallback = process.env.VERCEL && raw === undefined ? 7500 : 15000
  const n = raw ? parseInt(raw, 10) : fallback
  return Number.isFinite(n) && n >= 500 && n <= 60000 ? n : fallback
})()
// Coda bounded (opzionale): con 0 il comportamento è attuale (i waiter oltre i
// posti attendono fino a RENDER_SLOT_WAIT_MS). Con N>0 i waiter oltre N
// ricevono 503 immediato invece di accodarsi: backpressure senza code infinite.
const RENDER_QUEUE_LIMIT = (() => {
  const raw = envWithFallback("RENDER_QUEUE")
  const n = raw ? parseInt(raw, 10) : 0
  return Number.isFinite(n) && n >= 0 && n <= 128 ? n : 0
})()

let activeRenders = 0
let zombieRenders = 0
// Picchi cumulativi da avvio processo (telemetria bench/produzione): il
// polling esterno di /api/cache/status può mancare slot brevi, questi
// contatori no (due interi, costo zero). Vedi getPosterStats().
let peakActiveRenders = 0
let peakQueuedRenders = 0
const renderWaiters: Array<() => void> = []
// Quante volte uno zombie ha superato la grazia ed è stato sganciato dal
// budget slot (metrica cumulativa, esposta in getPosterStats).
let zombieGraceExpired = 0

// Tetto di grazia per i render abbandonati dal watchdog (R5): oltre questo
// tempo lo zombie smette di occupare budget slot. Senza, N zombie = N slot
// bruciati con active=0 → 503 a catena anche a pipeline scarica (deadlock
// morbido sotto upstream lento). Lo zombie continua comunque in background
// fino al settle (la sua cleanup è guarded) — si libera solo il conteggio,
// con un warn per distinguere "zombie veloci" (post-R3: abort immediato dei
// fetch) da quelli patologici (sharp appeso).
const ZOMBIE_GRACE_MS = (() => {
  const raw = envWithFallback("ZOMBIE_GRACE_MS")
  const n = raw ? parseInt(raw, 10) : 10000
  return Number.isFinite(n) && n >= 1000 && n <= 120000 ? n : 10000
})()
const pendingGraceTimers = new Set<ReturnType<typeof setTimeout>>()

function pumpWaiters(): void {
  while (renderWaiters.length > 0 && activeRenders + zombieRenders < MAX_CONCURRENT_RENDERS) {
    const next = renderWaiters.shift()
    if (next) next()
  }
}

function releaseRenderSlot(): void {
  activeRenders = Math.max(0, activeRenders - 1)
  pumpWaiters()
}

/** Notifica al limiter che un render è stato abbandonato dalla deadline ma continua in background */
export function recordZombieRenderStart(label?: string): () => void {
  zombieRenders++
  let settled = false
  const settle = (): void => {
    if (settled) return
    settled = true
    zombieRenders = Math.max(0, zombieRenders - 1)
    pumpWaiters()
  }
  const grace = setTimeout(() => {
    pendingGraceTimers.delete(grace)
    if (settled) return
    settled = true
    zombieRenders = Math.max(0, zombieRenders - 1)
    zombieGraceExpired++
    log.warn("Zombie render grace expired — slot force-released", label ? { zombies: zombieRenders, render: label } : { zombies: zombieRenders })
    pumpWaiters()
  }, ZOMBIE_GRACE_MS)
  if (typeof grace.unref === "function") grace.unref()
  pendingGraceTimers.add(grace)
  return () => {
    pendingGraceTimers.delete(grace)
    clearTimeout(grace)
    settle()
  }
}

/** Acquisisce un posto di render. Risolve con la release function, o null se il timeout scade. */
export async function acquirePosterRenderSlot(): Promise<(() => void) | null> {
  if (activeRenders + zombieRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++
    peakActiveRenders = Math.max(peakActiveRenders, activeRenders)
    return releaseRenderSlot
  }
  if (RENDER_QUEUE_LIMIT > 0 && renderWaiters.length >= RENDER_QUEUE_LIMIT) {
    return null
  }
  return new Promise<(() => void) | null>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const i = renderWaiters.indexOf(handoff)
      if (i >= 0) renderWaiters.splice(i, 1)
      resolve(null)
    }, RENDER_SLOT_WAIT_MS)
    const handoff = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeRenders++
      peakActiveRenders = Math.max(peakActiveRenders, activeRenders)
      resolve(releaseRenderSlot)
    }
    renderWaiters.push(handoff)
    peakQueuedRenders = Math.max(peakQueuedRenders, renderWaiters.length)
  })
}

/** Solo per i test: svuota lo stato del limiter. */
export function __resetPosterRenderLimiter(): void {
  activeRenders = 0
  zombieRenders = 0
  peakActiveRenders = 0
  peakQueuedRenders = 0
  renderWaiters.length = 0
  for (const t of pendingGraceTimers) clearTimeout(t)
  pendingGraceTimers.clear()
}

// ---------------------------------------------------------------------------
// Poster metrics & telemetry
// ---------------------------------------------------------------------------

export interface PosterStats {
  requests: number
  hits: number
  renders: number
  errors: number
  staleHits: number
  coalescedHits: number
  rescues: {
    tvdb: number
    backdropCrop: number
  }
  formats: {
    jpeg: number
    webp: number
    avif: number
  }
}

const posterMetrics: PosterStats = {
  requests: 0,
  hits: 0,
  renders: 0,
  errors: 0,
  staleHits: 0,
  coalescedHits: 0,
  rescues: {
    tvdb: 0,
    backdropCrop: 0,
  },
  formats: {
    jpeg: 0,
    webp: 0,
    avif: 0,
  },
}

export function recordPosterRequest(hit: boolean, format: PosterImageFormat = "jpeg"): void {
  posterMetrics.requests++
  if (hit) {
    posterMetrics.hits++
  } else {
    posterMetrics.renders++
  }
  posterMetrics.formats[format] = (posterMetrics.formats[format] || 0) + 1
}

export function recordPosterError(): void {
  posterMetrics.requests++
  posterMetrics.errors++
}

export function recordPosterStaleHit(): void {
  posterMetrics.staleHits++
}

export function recordPosterCoalescedHit(): void {
  posterMetrics.coalescedHits++
}

export function recordTvdbRescue(): void {
  posterMetrics.rescues.tvdb++
}

export function recordBackdropCropRescue(): void {
  posterMetrics.rescues.backdropCrop++
}

/** Solo per i test: azzera i contatori telemetria poster. */
export function __resetPosterStatsForTest(): void {
  posterMetrics.requests = 0
  posterMetrics.hits = 0
  posterMetrics.renders = 0
  posterMetrics.errors = 0
  posterMetrics.staleHits = 0
  posterMetrics.coalescedHits = 0
  posterMetrics.rescues.tvdb = 0
  posterMetrics.rescues.backdropCrop = 0
  posterMetrics.formats.jpeg = 0
  posterMetrics.formats.webp = 0
  posterMetrics.formats.avif = 0
}

export function getPosterStats() {
  const hitRate = posterMetrics.requests > 0
    ? Math.round((posterMetrics.hits / posterMetrics.requests) * 1000) / 10
    : 0
  return {
    requests: posterMetrics.requests,
    hits: posterMetrics.hits,
    renders: posterMetrics.renders,
    errors: posterMetrics.errors,
    staleHits: posterMetrics.staleHits,
    coalescedHits: posterMetrics.coalescedHits,
    rescues: { ...posterMetrics.rescues },
    hitRate: `${hitRate}%`,
    hitRateNum: hitRate,
    formats: { ...posterMetrics.formats },
    activeRenders,
    zombieRenders,
    zombieGraceExpired,
    queuedRenders: renderWaiters.length,
    peakActiveRenders,
    peakQueuedRenders,
    maxConcurrent: MAX_CONCURRENT_RENDERS,
  }
}
