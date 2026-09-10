import sharp from "sharp"

let initialized = false

/**
 * Inizializza la configurazione globale di sharp.
 * Va chiamata una volta all'avvio prima di usare sharp.
 * Separata dal module level per evitare side-effect all'import.
 */
export function initSharp(): void {
  if (initialized) return
  initialized = true

  // D3: default conservativi quando le env mancano. Prima, senza env, sharp
  // usava i default libvips (concurrency = n° core, cache ~100MB): su
  // container piccoli con molte vCPU (o serverless) 8+ thread × buffer
  // portavano a OOM. Il Dockerfile/compose impostano già 2/64 espliciti.
  const rawConcurrency = Number(process.env.SHARP_CONCURRENCY)
  const rawCacheMemory = Number(process.env.SHARP_CACHE_MEMORY_MB)
  const rawCacheItems = Number(process.env.SHARP_CACHE_ITEMS)
  const concurrency = Number.isFinite(rawConcurrency) && rawConcurrency > 0 ? Math.floor(rawConcurrency) : 2
  const cacheMemory = Number.isFinite(rawCacheMemory) && rawCacheMemory > 0 ? Math.floor(rawCacheMemory) : 32
  const cacheItems = Number.isFinite(rawCacheItems) && rawCacheItems > 0 ? Math.floor(rawCacheItems) : 50

  sharp.concurrency(concurrency)
  sharp.cache({ memory: cacheMemory, items: cacheItems })
}

// Solo per i test: riapre initSharp con env diverse.
export function __resetSharpInit(): void {
  initialized = false
}

export default sharp
