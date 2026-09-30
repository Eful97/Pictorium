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
 */
export async function cachedImageBytes(url: string, doFetch: () => Promise<Buffer>): Promise<Buffer> {
  if (IMG_CACHE_BUDGET_BYTES <= 0) return doFetch()
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
  if (existing) return existing
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
