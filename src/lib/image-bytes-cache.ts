/**
 * Cache LRU dei byte immagine grezzi, keyed per URL finale (F3, I/O audit).
 *
 * Le cache image-level esistenti salvano artefatti sharp (colori, resize) ma
 * non i byte scaricati: ogni render con cache key diversa per lo stesso titolo
 * (tick di preview, rank che cambia, bump mapping/RENDER_VERSION) ripagava la
 * CDN anche a passaggi sharp già cachati. Questo strato azzera i re-download.
 *
 * Limiti deliberati:
 * - Solo URL finali (path TMDB/artworks immutabili per costruzione) con TTL
 *   24h — le URL immagine non portano mai api_key, niente segreti in chiave.
 * - Budget byte DEDICATO (default 32MB, `PICTORIUM_IMG_CACHE_MB`, 0 = off),
 *   separato dal budget dei poster renderizzati: i byte non devono mai far
 *   evictare l'entry più preziosa (il poster composto).
 * - Mai abort/errori in cache: solo buffer completi e validati dal chiamante.
 * - Solo osservabilità aggiuntiva (stats), nessuna semantica di fetch alterata.
 */

import { envWithFallback } from "./env-compat"
import { raceWithAbort, signalAbortReason } from "./abort-signal"

const IMG_BYTES_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRY_BYTES = 10 * 1024 * 1024
const MAX_CACHED_URLS = 2000

const IMG_CACHE_MB = (() => {
  const raw = envWithFallback("IMG_CACHE_MB")
  const n = raw ? parseFloat(raw) : 32
  // Clamp 0off–512MB: 0 disabilita, oltre è heap senza senso per i byte.
  return Number.isFinite(n) && n >= 0 && n <= 512 ? n : 32
})()
const IMG_CACHE_BUDGET_BYTES = Math.round(IMG_CACHE_MB * 1024 * 1024)

interface BytesEntry {
  readonly buf: Buffer
  readonly ts: number
}

const bytesCache = new Map<string, BytesEntry>()
const inflightBytes = new Map<string, Promise<Buffer>>()
let cachedBytes = 0

const bytesStats = { hits: 0, misses: 0, evictions: 0 }

export interface ImageBytesStats {
  readonly enabled: boolean
  readonly hits: number
  readonly misses: number
  readonly evictions: number
  readonly entries: number
  readonly bytes: number
  readonly budgetBytes: number
}

function bytesCacheHasFresh(url: string): boolean {
  const hit = bytesCache.get(url)
  return !!hit && Date.now() - hit.ts < IMG_BYTES_TTL_MS
}

function evictFor(size: number): void {
  while (bytesCache.size > 0 && cachedBytes + size > IMG_CACHE_BUDGET_BYTES) {
    const oldest = bytesCache.keys().next().value!
    const victim = bytesCache.get(oldest)!
    bytesCache.delete(oldest)
    cachedBytes -= victim.buf.length
    bytesStats.evictions++
  }
}

/**
 * Read-through sui byte immagine: hit → buffer cachato; miss → `doFetch()`
 * (la logica esistente del chiamante: SSRF check, signal, validazione size)
 * e memorizzazione solo su successo. Stesso pattern di coalescing di tmdb.ts:
 * N waiter concorrenti sullo stesso URL condividono un solo download.
 *
 * Un waiter non eredita il fallimento del download altrui: il leader gira col
 * PROPRIO signal (deadline del suo render, cap 5s del best-fit), quindi il suo
 * abort non dice nulla sul waiter. Su rejection del leader il waiter rientra
 * una sola volta col proprio `doFetch` (coalescing di nuovo attivo tra i
 * waiter che riprovano; nessun secondo retry, niente catene).
 *
 * Il waiter non eredita nemmeno l'attesa del leader: con `signal` il waiter
 * gareggia col proprio abort (raceWithAbort, come tmdb.ts) invece di restare
 * ostaggio di un download lento oltre il proprio timeout interno (15s di
 * fetchImg) o la deadline del proprio render. Il detach non abortisce il
 * leader né gli altri waiter (solo la propria attesa); dopo il proprio abort
 * mai retry (l'entry condivisa resta del leader). Senza `signal` il percorso
 * resta byte-identico a prima.
 */
export async function cachedImageBytes(
  url: string,
  doFetch: () => Promise<Buffer>,
  signal?: AbortSignal,
): Promise<Buffer> {
  return cachedImageBytesOnce(url, doFetch, true, signal)
}

function abortRejection(signal: AbortSignal): Promise<never> {
  return Promise.reject(signalAbortReason(signal))
}

async function cachedImageBytesOnce(
  url: string,
  doFetch: () => Promise<Buffer>,
  retryAsWaiter: boolean,
  signal?: AbortSignal,
): Promise<Buffer> {
  // Waiter pre-abortito: mai join/start/retry — ma una hit già disponibile
  // resta servita (stessa semantica degli altri layer: la cache non abortisce).
  if (signal?.aborted && !bytesCacheHasFresh(url)) return abortRejection(signal)
  if (IMG_CACHE_BUDGET_BYTES <= 0) {
    if (signal?.aborted) return abortRejection(signal)
    return doFetch()
  }
  const hit = bytesCache.get(url)
  if (hit) {
    if (Date.now() - hit.ts < IMG_BYTES_TTL_MS) {
      // Promote a MRU.
      bytesCache.delete(url)
      bytesCache.set(url, hit)
      bytesStats.hits++
      return hit.buf
    }
    bytesCache.delete(url)
    cachedBytes -= hit.buf.length
  }
  const existing = inflightBytes.get(url)
  if (existing) {
    // Gara col proprio abort (come tmdb.ts): il waiter esce alla propria
    // scadenza senza abortire il leader né gli altri waiter — solo la sua
    // attesa. Senza signal il percorso resta byte-identico a prima.
    if (!retryAsWaiter) return raceWithAbort(existing, signal)
    if (!signal) return existing.catch(() => cachedImageBytesOnce(url, doFetch, false))
    try {
      return await raceWithAbort(existing, signal)
    } catch {
      // Abort proprio: mai retry dopo il proprio abort (né join all'entry
      // fresca del retry altrui: l'attesa è finita). Fallimento del leader a
      // waiter sano: un solo retry col proprio doFetch, come prima.
      if (signal.aborted) {
        throw signalAbortReason(signal)
      }
      return cachedImageBytesOnce(url, doFetch, false, signal)
    }
  }
  bytesStats.misses++
  const promise = doFetch().then(
    (buf) => {
      if (inflightBytes.get(url) === promise) inflightBytes.delete(url)
      storeImageBytes(url, buf)
      return buf
    },
    (err) => {
      if (inflightBytes.get(url) === promise) inflightBytes.delete(url)
      throw err
    },
  )
  inflightBytes.set(url, promise)
  return promise
}

export function imageBytesStats(): ImageBytesStats {
  return {
    enabled: IMG_CACHE_BUDGET_BYTES > 0,
    hits: bytesStats.hits,
    misses: bytesStats.misses,
    evictions: bytesStats.evictions,
    entries: bytesCache.size,
    bytes: cachedBytes,
    budgetBytes: IMG_CACHE_BUDGET_BYTES,
  }
}

/**
 * Lettura senza fetch (hit → buffer + promote MRU, miss/scaduto → null).
 * Serve ai consumer con condivisione in-flight propria (basi custom): la hit
 * non tocca la rete, il miss passa dal loro download condiviso e rientra con
 * storeImageBytes. Stesse regole di cachedImageBytes (TTL, budget, conteggi).
 */
export function peekImageBytes(url: string): Buffer | null {
  if (IMG_CACHE_BUDGET_BYTES <= 0) return null
  const hit = bytesCache.get(url)
  if (!hit) return null
  if (Date.now() - hit.ts >= IMG_BYTES_TTL_MS) {
    bytesCache.delete(url)
    cachedBytes -= hit.buf.length
    return null
  }
  // Promote a MRU.
  bytesCache.delete(url)
  bytesCache.set(url, hit)
  bytesStats.hits++
  return hit.buf
}

/**
 * Memorizza buffer già scaricati e validati dal chiamante (mai abort/errori).
 * Stesse regole di cachedImageBytes (cap entry, budget, max URL, MRU).
 */
export function storeImageBytes(url: string, buf: Buffer): void {
  if (IMG_CACHE_BUDGET_BYTES <= 0) return
  if (buf.length === 0 || buf.length > MAX_ENTRY_BYTES) return
  const prev = bytesCache.get(url)
  if (prev) {
    bytesCache.delete(url)
    cachedBytes -= prev.buf.length
  }
  evictFor(buf.length)
  if (cachedBytes + buf.length > IMG_CACHE_BUDGET_BYTES) return
  if (bytesCache.size >= MAX_CACHED_URLS) {
    const evictedKey = bytesCache.keys().next().value!
    const victim = bytesCache.get(evictedKey)!
    bytesCache.delete(evictedKey)
    cachedBytes -= victim.buf.length
    bytesStats.evictions++
  }
  bytesCache.set(url, { buf, ts: Date.now() })
  cachedBytes += buf.length
}

/** Solo per i test: svuota cache, inflight e contatori. */
export function __resetImageBytesForTest(): void {
  bytesCache.clear()
  inflightBytes.clear()
  cachedBytes = 0
  bytesStats.hits = 0
  bytesStats.misses = 0
  bytesStats.evictions = 0
}
