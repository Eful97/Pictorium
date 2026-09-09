import fsp from "node:fs/promises"
import path from "node:path"
import type { Mapping } from "@/lib/types"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"

export type { Mapping }

const log = createLogger("store")

const useKv = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN

export function getStorageMode(): "kv" | "file" {
  return useKv ? "kv" : "file"
}

const debugStore = envWithFallback("DEBUG") === "1"

if (!useKv && debugStore) {
  log.info("Data directory", { dir: DATA_DIR, file: path.join(DATA_DIR, "mappings.json") })
}

// ---- Vercel KV helpers ----

// C5: cache di lettura per la modalità KV. Il poster hot path chiama getById a
// ogni render: senza cache, in modalità KV è un round-trip di rete verso Vercel
// KV per richiesta. TTL breve + inflight dedup: più render concorrenti condividono
// UN solo hgetall per finestra (500ms) — coerente col file mode (staleness
// bounded, multi-istanza). Le scritture aggiornano la cache in-place.
const KV_READ_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 500
let kvCache: Record<string, Mapping> | null = null
let kvCacheAt = 0
let kvCacheInflight: Promise<Record<string, Mapping>> | null = null

async function kvReadAllCached(): Promise<Record<string, Mapping>> {
  const now = Date.now()
  if (kvCache && now - kvCacheAt < KV_READ_TTL_MS) return kvCache
  if (kvCacheInflight) return kvCacheInflight
  kvCacheInflight = (async () => {
    const { kv } = await import("@vercel/kv")
    const raw = await kv.hgetall<Record<string, Mapping>>("mappings")
    const map = raw ?? {}
    kvCache = map
    kvCacheAt = Date.now()
    return map
  })().finally(() => { kvCacheInflight = null })
  return kvCacheInflight
}

async function kvUpsert(mapping: Mapping) {
  const { kv } = await import("@vercel/kv")
  const key = `${mapping.mediaType}:${mapping.tmdbId}`
  const next = { ...mapping, updatedAt: new Date().toISOString() }
  await kv.hset("mappings", { [key]: next })
  // Dopo un upsert l'utente apre subito il poster (getById): un refetch completo
  // della mappa annullerebbe il beneficio della cache. Update in-place.
  if (kvCache) kvCache[key] = next
}

async function kvRemove(type: "movie" | "tv", id: number) {
  const { kv } = await import("@vercel/kv")
  const key = `${type}:${id}`
  await kv.hdel("mappings", key)
  if (kvCache) delete kvCache[key]
}

async function kvRemoveAll() {
  const { kv } = await import("@vercel/kv")
  await kv.del("mappings")
  kvCache = {}
  kvCacheAt = Date.now()
}

async function kvImportMappings(mappings: Mapping[]) {
  const { kv } = await import("@vercel/kv")
  const entries: Record<string, Mapping> = {}
  const now = new Date().toISOString()
  for (const m of mappings) {
    // Timbra updatedAt come fa upsert(): i cache key dei poster includono
    // mapping.updatedAt (mapVersion), quindi senza timbro l'import resterebbe
    // invisibile alla cache e i poster continuerebbero ad essere serviti stantii.
    entries[`${m.mediaType}:${m.tmdbId}`] = { ...m, updatedAt: now }
  }
  await kv.hset("mappings", entries)
  if (kvCache) Object.assign(kvCache, entries)
}

// ---- File-based helpers (HF / local) ----

const DATA_FILE = path.join(DATA_DIR, "mappings.json")
let writeQueue = Promise.resolve()
// In-memory mirror so reads never go stale during a write
let memCache: Record<string, Mapping> | null = null
let memCacheTime = 0

// Leggere lo stat del file a ogni lettura è costoso su storage remoti
// (HF Spaces: bucket FUSE con round-trip di rete per ogni stat). Lo stat viene
// fatto al massimo ogni READ_STAT_TTL_MS; le scritture nostre aggiornano la
// memCache subito, quindi la staleness è limitata alle scritture di ALTRI
// processi (multi-istanza) ed è bounded a 500ms. Nei test il TTL è 0 per
// mantenere il determinismo (i test scrivono il file e lo rileggono subito).
const READ_STAT_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 500
let lastStatAt = 0

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

/** Consecutive write failures — resets to 0 on success */
let writeFailures = 0

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task)
  writeQueue = run.then(
    () => { writeFailures = 0 },
    (error) => {
      writeFailures++
      const msg = error instanceof Error ? error.message : String(error)
      log.error("Write queue task failed", { error: msg, consecutiveFailures: writeFailures })
      if (writeFailures >= 5) {
        log.error("Write queue has 5+ consecutive failures — check disk permissions or storage backend")
      }
      throw error
    },
  )
  return run
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`Failed to create data dir '${DATA_DIR}': ${msg}`)
    throw new Error(`Cannot create data directory: ${msg}`)
  })
}

/**
 * Read from disk, then update the in-memory mirror.
 */
async function loadFromDisk(): Promise<Record<string, Mapping>> {
  try {
    const stat = await fsp.stat(DATA_FILE).catch(() => null)
    const raw = await fsp.readFile(DATA_FILE, "utf-8")
    const data = JSON.parse(raw) as Record<string, Mapping>
    memCache = data
    memCacheTime = stat ? stat.mtimeMs : Date.now()
    return data
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      memCache = {}
      // Sentinella: il file non esiste. Con memCacheTime=0 qualsiasi file
      // creato successivamente (anche nello stesso millisecondo da un altro
      // worker) ha mtime > 0 e viene rilevato al prossimo stat. Con Date.now()
      // una scrittura nello stesso ms non veniva vista (mtime == cacheTime) e
      // la cache restava stantia (race vista nei test CI).
      memCacheTime = 0
      return {}
    }
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to load mappings", { error: message })
    return memCache ?? {}
  }
}

/**
 * Fast read via in-memory mirror, refreshing from disk if file was modified.
 */
async function readFromMem(): Promise<Record<string, Mapping>> {
  const now = Date.now()
  if (memCache && now - lastStatAt < READ_STAT_TTL_MS) return memCache
  lastStatAt = now
  try {
    const stat = await fsp.stat(DATA_FILE)
    if (memCache && stat.mtimeMs <= memCacheTime) return memCache
  } catch {
    if (memCache) return memCache
  }
  return loadFromDisk()
}

async function persist(data: Record<string, Mapping>) {
  await ensureDataDir()
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
    try {
      await fsp.rename(tmp, DATA_FILE)
    } catch (e) {
      if (isNodeError(e) && (e as NodeJS.ErrnoException).code === "EXDEV") {
        // HF Storage FUSE può dare EXDEV se tmp e DATA_FILE sono su mount diversi
        // (es. symlink o /tmp separato). Fallback come in flixpatrol.ts: copy+unlink
        await fsp.copyFile(tmp, DATA_FILE)
        await fsp.unlink(tmp).catch(() => {})
      } else {
        throw e
      }
    }
    // Aggiorna la memCache SOLO dopo la write riuscita: se la persist fallisce,
    // la memCache resta coerente con il disco e non serve dati mai persistiti.
    memCache = data
    memCacheTime = Date.now()
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    log.error("Failed to write mappings", { file: DATA_FILE, error: msg })
    if (msg.includes("EACCES") || msg.includes("EPERM")) {
      log.error("Permission error — check that data dir is writable", { dir: DATA_DIR })
      log.error("If using HF Storage Bucket, verify it's linked in Space Settings -> Storage")
    }
    throw new Error(`Cannot persist mappings: ${msg}`)
  }
}

// ---- Exported API ----

export async function getAll(): Promise<Mapping[]> {
  if (useKv) return Object.values(await kvReadAllCached())
  return Object.values(await readFromMem())
}

export async function getById(type: "movie" | "tv", id: number): Promise<Mapping | null> {
  if (useKv) return (await kvReadAllCached())[`${type}:${id}`] ?? null
  const key = `${type}:${id}`
  const data = await readFromMem()
  return data[key] ?? null
}

export async function upsert(mapping: Mapping) {
  if (useKv) {
    await kvUpsert(mapping)
    return
  }
  return enqueueWrite(async () => {
    // Fix M13: rilettura FORZATA da disco dentro la coda di scrittura.
    // Prima readFromMem() poteva restituire la memCache stantia (TTL 500ms):
    // due istanze che scrivevano insieme si sovrascrivevano le entry (lost
    // update). La coda serializza le scritture di questo processo, ma il
    // merge deve partire dallo stato reale su disco, non dal mirror.
    const data = await loadFromDisk()
    const key = `${mapping.mediaType}:${mapping.tmdbId}`
    data[key] = { ...mapping, updatedAt: new Date().toISOString() }
    await persist(data)
  })
}

export async function remove(type: "movie" | "tv", id: number) {
  if (useKv) {
    await kvRemove(type, id)
    return
  }
  return enqueueWrite(async () => {
    const data = await loadFromDisk()
    const key = `${type}:${id}`
    delete data[key]
    await persist(data)
  })
}

export async function removeAll() {
  if (useKv) {
    await kvRemoveAll()
    return
  }
  return enqueueWrite(async () => {
    await persist({})
  })
}

export async function importMappings(mappings: Mapping[]) {
  if (useKv) {
    await kvImportMappings(mappings)
    return
  }
  return enqueueWrite(async () => {
    const data = await loadFromDisk() // Fix M13: merge sullo stato reale su disco
    const now = new Date().toISOString()
    for (const m of mappings) {
      const key = `${m.mediaType}:${m.tmdbId}`
      // Stesso motivo del ramo KV: updatedAt è parte del cache key dei poster.
      data[key] = { ...m, updatedAt: now }
    }
    await persist(data)
  })
}
