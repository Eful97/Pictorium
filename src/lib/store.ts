import fsp from "node:fs/promises"
import path from "node:path"
import type { Mapping } from "@/lib/types"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { getMaxMappingsPerUser } from "@/lib/user-auth"
import { getKv, getStorageMode as getKvStorageMode } from "@/lib/kv"

export type { Mapping }

/** Superata la quota mapping del namespace utente → il caller risponde 413. */
export class QuotaExceededError extends Error {
  constructor(readonly max: number) {
    super(`Mapping quota exceeded (max ${max} mappings per user)`)
    this.name = "QuotaExceededError"
  }
}

// userId validati dai caller (sanitizeUserId); qui fail-closed difensivo:
// un id non-UUID non tocca mai path né chiavi KV.
function assertValidUserId(userId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
}

const log = createLogger("store")

// Lettura live (mai a module level): i test mutano le env + resetModules.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getKvStorageMode() === "kv"
}

export function getStorageMode(): "kv" | "file" {
  return getKvStorageMode()
}

const debugStore = envWithFallback("DEBUG") === "1"

if (getKvStorageMode() === "file" && debugStore) {
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
    const raw = await getKv().hgetall<Record<string, Mapping>>("mappings")
    const map = raw ?? {}
    kvCache = map
    kvCacheAt = Date.now()
    return map
  })().finally(() => { kvCacheInflight = null })
  return kvCacheInflight
}

async function kvUpsert(mapping: Mapping) {
  const key = `${mapping.mediaType}:${mapping.tmdbId}`
  const next = { ...mapping, updatedAt: new Date().toISOString() }
  await getKv().hset("mappings", { [key]: next })
  // Dopo un upsert l'utente apre subito il poster (getById): un refetch completo
  // della mappa annullerebbe il beneficio della cache. Update in-place.
  if (kvCache) kvCache[key] = next
}

async function kvRemove(type: "movie" | "tv", id: number) {
  const key = `${type}:${id}`
  await getKv().hdel("mappings", key)
  if (kvCache) delete kvCache[key]
}

async function kvRemoveAll() {
  await getKv().del("mappings")
  kvCache = {}
  kvCacheAt = Date.now()
}

async function kvImportMappings(mappings: Mapping[]) {
  // Import vuoto: hset con 0 campi fa 500 su Redis — niente da scrivere.
  if (mappings.length === 0) return
  const entries: Record<string, Mapping> = {}
  const now = new Date().toISOString()
  for (const m of mappings) {
    // Timbra updatedAt come fa upsert(): i cache key dei poster includono
    // mapping.updatedAt (mapVersion), quindi senza timbro l'import resterebbe
    // invisibile alla cache e i poster continuerebbero ad essere serviti stantii.
    entries[`${m.mediaType}:${m.tmdbId}`] = { ...m, updatedAt: now }
  }
  await getKv().hset("mappings", entries)
  if (kvCache) Object.assign(kvCache, entries)
}

// ---- KV per-utente (multi-user) ----
// Stesso pattern del globale ma su hash `mappings:<uuid>` con cache per-utente
// (cap LRU: i namespace caldi restano in memoria senza OOM su istanze aperte).

interface KvUserCache {
  map: Record<string, Mapping> | null
  at: number
  inflight: Promise<Record<string, Mapping>> | null
}

const kvUserCaches = new Map<string, KvUserCache>()
const KV_USER_CACHE_CAP = 200

function userKvKey(userId: string): string {
  return `mappings:${userId}`
}

function kvUserCacheFor(userId: string): KvUserCache {
  let c = kvUserCaches.get(userId)
  if (c) {
    // Promote LRU.
    kvUserCaches.delete(userId)
    kvUserCaches.set(userId, c)
    return c
  }
  c = { map: null, at: 0, inflight: null }
  if (kvUserCaches.size >= KV_USER_CACHE_CAP) {
    const oldest = kvUserCaches.keys().next().value
    if (oldest !== undefined) kvUserCaches.delete(oldest)
  }
  kvUserCaches.set(userId, c)
  return c
}

async function kvReadAllCachedFor(userId: string): Promise<Record<string, Mapping>> {
  const c = kvUserCacheFor(userId)
  const now = Date.now()
  if (c.map && now - c.at < KV_READ_TTL_MS) return c.map
  if (c.inflight) return c.inflight
  c.inflight = (async () => {
    const raw = await getKv().hgetall<Record<string, Mapping>>(userKvKey(userId))
    const map = raw ?? {}
    c.map = map
    c.at = Date.now()
    return map
  })().finally(() => { c.inflight = null })
  return c.inflight
}

async function kvUpsertFor(userId: string, mapping: Mapping) {
  const key = `${mapping.mediaType}:${mapping.tmdbId}`
  const next = { ...mapping, updatedAt: new Date().toISOString() }
  await getKv().hset(userKvKey(userId), { [key]: next })
  const c = kvUserCaches.get(userId)
  if (c?.map) c.map[key] = next
}

async function kvRemoveFor(userId: string, type: "movie" | "tv", id: number) {
  const key = `${type}:${id}`
  await getKv().hdel(userKvKey(userId), key)
  const c = kvUserCaches.get(userId)
  if (c?.map) delete c.map[key]
}

async function kvRemoveAllFor(userId: string) {
  await getKv().del(userKvKey(userId))
  const c = kvUserCaches.get(userId)
  if (c) {
    c.map = {}
    c.at = Date.now()
  }
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

// ---- File-based per-utente (multi-user) ----
// Mirror in memoria per namespace con cap LRU + TTL: stessi 500ms del globale,
// evict oltre USER_MIRROR_CAP utenti caldi (bound su istanze aperte).

interface UserMirror {
  data: Record<string, Mapping> | null
  time: number
  lastStat: number
}

const userMirrors = new Map<string, UserMirror>()
const USER_MIRROR_CAP = 200

function userFile(userId: string): string {
  return path.join(DATA_DIR, "users", userId, "mappings.json")
}

function userMirrorFor(userId: string): UserMirror {
  let m = userMirrors.get(userId)
  if (m) {
    userMirrors.delete(userId)
    userMirrors.set(userId, m)
    return m
  }
  m = { data: null, time: 0, lastStat: 0 }
  if (userMirrors.size >= USER_MIRROR_CAP) {
    const oldest = userMirrors.keys().next().value
    if (oldest !== undefined) userMirrors.delete(oldest)
  }
  userMirrors.set(userId, m)
  return m
}

async function loadUserFromDisk(userId: string): Promise<Record<string, Mapping>> {
  const file = userFile(userId)
  const mirror = userMirrorFor(userId)
  try {
    const stat = await fsp.stat(file).catch(() => null)
    const raw = await fsp.readFile(file, "utf-8")
    const data = JSON.parse(raw) as Record<string, Mapping>
    mirror.data = data
    mirror.time = stat ? stat.mtimeMs : Date.now()
    return data
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      mirror.data = {}
      mirror.time = 0
      return {}
    }
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to load user mappings", { error: message })
    return mirror.data ?? {}
  }
}

async function readUserFromMem(userId: string): Promise<Record<string, Mapping>> {
  const mirror = userMirrorFor(userId)
  const now = Date.now()
  if (mirror.data && now - mirror.lastStat < READ_STAT_TTL_MS) return mirror.data
  mirror.lastStat = now
  try {
    const stat = await fsp.stat(userFile(userId))
    if (mirror.data && stat.mtimeMs <= mirror.time) return mirror.data
  } catch (e) {
    // File sparito (wipe account): ricarica da disco (resetta il mirror a {}),
    // mai servire lo snapshot stantio. Altri errori → fallback al mirror.
    if (isNodeError(e) && e.code === "ENOENT") return loadUserFromDisk(userId)
    if (mirror.data) return mirror.data
  }
  return loadUserFromDisk(userId)
}

async function persistUser(userId: string, data: Record<string, Mapping>) {
  const file = userFile(userId)
  await fsp.mkdir(path.dirname(file), { recursive: true }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`Failed to create user data dir '${path.dirname(file)}': ${msg}`)
    throw new Error(`Cannot create user data directory: ${msg}`)
  })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
    try {
      await fsp.rename(tmp, file)
    } catch (e) {
      if (isNodeError(e) && (e as NodeJS.ErrnoException).code === "EXDEV") {
        await fsp.copyFile(tmp, file)
        await fsp.unlink(tmp).catch(() => {})
      } else {
        throw e
      }
    }
    const mirror = userMirrorFor(userId)
    mirror.data = data
    mirror.time = Date.now()
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    log.error("Failed to write user mappings", { error: msg })
    throw new Error(`Cannot persist user mappings: ${msg}`)
  }
}

// Code di scrittura per-utente: la coda globale serializzava tutti i
// namespace insieme (uno stallo su un utente bloccava gli altri).
const userWriteQueues = new Map<string, Promise<unknown>>()
const userWriteFailures = new Map<string, number>()

function enqueueUserWrite<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const prev = userWriteQueues.get(userId) ?? Promise.resolve()
  const run = (prev as Promise<unknown>).then(task, task)
  const tracked = run.then(
    () => { userWriteFailures.set(userId, 0) },
    (error) => {
      const n = (userWriteFailures.get(userId) ?? 0) + 1
      userWriteFailures.set(userId, n)
      const msg = error instanceof Error ? error.message : String(error)
      log.error("User write queue task failed", { error: msg, consecutiveFailures: n })
      throw error
    },
  )
  userWriteQueues.set(userId, tracked)
  // L'errore viaggia sul `run` restituito al chiamante: questo catch evita
  // solo la unhandled-rejection sulla promise archiviata in coda.
  tracked.catch(() => {})
  return run
}

/** Quota per-utente: lancia QuotaExceededError se una chiave NUOVA sfora il cap. */
function assertUserQuota(data: Record<string, Mapping>, key: string): void {
  if (key in data) return
  const max = getMaxMappingsPerUser()
  if (Object.keys(data).length >= max) throw new QuotaExceededError(max)
}

/** Evict delle cache in-process del namespace (wipe account). Solo test + user-activity. */
export function __evictUserStoreCache(userId: string): void {
  userMirrors.delete(userId)
  kvUserCaches.delete(userId)
}

// ---- Exported API ----

export async function getAll(userId?: string | null): Promise<Mapping[]> {
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) return Object.values(await kvReadAllCachedFor(userId))
    return Object.values(await readUserFromMem(userId))
  }
  if (isKvMode()) return Object.values(await kvReadAllCached())
  return Object.values(await readFromMem())
}

export async function getById(type: "movie" | "tv", id: number, userId?: string | null): Promise<Mapping | null> {
  // Namespace stretto: con userId SOLO il namespace, mai fallback globale.
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) return (await kvReadAllCachedFor(userId))[`${type}:${id}`] ?? null
    const data = await readUserFromMem(userId)
    return data[`${type}:${id}`] ?? null
  }
  if (isKvMode()) return (await kvReadAllCached())[`${type}:${id}`] ?? null
  const key = `${type}:${id}`
  const data = await readFromMem()
  return data[key] ?? null
}

export async function upsert(mapping: Mapping, userId?: string | null) {
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) {
      const current = await kvReadAllCachedFor(userId)
      assertUserQuota(current, `${mapping.mediaType}:${mapping.tmdbId}`)
      await kvUpsertFor(userId, mapping)
      return
    }
    return enqueueUserWrite(userId, async () => {
      const data = await loadUserFromDisk(userId)
      const key = `${mapping.mediaType}:${mapping.tmdbId}`
      assertUserQuota(data, key)
      data[key] = { ...mapping, updatedAt: new Date().toISOString() }
      await persistUser(userId, data)
    })
  }
  if (isKvMode()) {
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

export async function remove(type: "movie" | "tv", id: number, userId?: string | null) {
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) {
      await kvRemoveFor(userId, type, id)
      return
    }
    return enqueueUserWrite(userId, async () => {
      const data = await loadUserFromDisk(userId)
      const key = `${type}:${id}`
      delete data[key]
      await persistUser(userId, data)
    })
  }
  if (isKvMode()) {
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

export async function removeAll(userId?: string | null) {
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) {
      await kvRemoveAllFor(userId)
      return
    }
    return enqueueUserWrite(userId, async () => {
      await persistUser(userId, {})
    })
  }
  if (isKvMode()) {
    await kvRemoveAll()
    return
  }
  return enqueueWrite(async () => {
    await persist({})
  })
}

export async function importMappings(mappings: Mapping[], userId?: string | null) {
  // Import vuoto: no-op (hset con 0 campi fa 500 su Redis — v1.23.0).
  if (mappings.length === 0) return
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) {
      const current = await kvReadAllCachedFor(userId)
      const max = getMaxMappingsPerUser()
      const fresh = mappings.filter((m) => !(`${m.mediaType}:${m.tmdbId}` in current))
      if (Object.keys(current).length + fresh.length > max) throw new QuotaExceededError(max)
      const entries: Record<string, Mapping> = {}
      const now = new Date().toISOString()
      for (const m of mappings) {
        entries[`${m.mediaType}:${m.tmdbId}`] = { ...m, updatedAt: now }
      }
      await getKv().hset(userKvKey(userId), entries)
      const c = kvUserCaches.get(userId)
      if (c?.map) Object.assign(c.map, entries)
      return
    }
    return enqueueUserWrite(userId, async () => {
      const data = await loadUserFromDisk(userId) // Fix M13: merge sullo stato reale su disco
      const max = getMaxMappingsPerUser()
      const fresh = mappings.filter((m) => !(`${m.mediaType}:${m.tmdbId}` in data))
      if (Object.keys(data).length + fresh.length > max) throw new QuotaExceededError(max)
      const now = new Date().toISOString()
      for (const m of mappings) {
        const key = `${m.mediaType}:${m.tmdbId}`
        // Stesso motivo del ramo KV: updatedAt è parte del cache key dei poster.
        data[key] = { ...m, updatedAt: now }
      }
      await persistUser(userId, data)
    })
  }
  if (isKvMode()) {
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

// ---- IMDb aliases (tt... → show Saved, per-namespace) ----
// Un tt di franchise (es. Monster tt13207736, una sola scheda per 4 stagioni
// su Cinemeta/AIO) non si risolve via TMDB /find sulla entry di stagione
// (es. tv:299939, imdb_id vuoto): l'alias manuale cuce il ponte e vince sul
// /find. Stesso pattern dei mapping (KV + file, globale + per-utente), quota
// condivisa: un alias pesa come un rigo mapping.

export interface ImdbAlias {
  imdbId: string
  mediaType: "movie" | "tv"
  tmdbId: number
  updatedAt?: string
}

const IMDB_ALIAS_RE = /^tt\d{1,20}$/

export function isValidImdbAliasId(value: unknown): value is string {
  return typeof value === "string" && IMDB_ALIAS_RE.test(value.trim())
}

function normalizeAliasId(imdbId: string): string {
  return imdbId.trim()
}

function assertValidAlias(alias: ImdbAlias): void {
  if (!isValidImdbAliasId(alias.imdbId)) throw new Error("Invalid imdbId: must match tt<number>")
  if (alias.mediaType !== "movie" && alias.mediaType !== "tv") throw new Error("Invalid mediaType")
  if (!Number.isInteger(alias.tmdbId) || alias.tmdbId <= 0) throw new Error("Invalid tmdbId")
}

function userAliasKvKey(userId: string): string {
  return `aliases:${userId}`
}

// ---- KV per-utente + globale (mirror del pattern mapping, cache 500ms) ----

interface KvAliasCache {
  map: Record<string, ImdbAlias> | null
  at: number
  inflight: Promise<Record<string, ImdbAlias>> | null
}

let kvAliasGlobal: KvAliasCache = { map: null, at: 0, inflight: null }
const kvAliasUserCaches = new Map<string, KvAliasCache>()
const KV_ALIAS_USER_CACHE_CAP = 200

function kvAliasUserCacheFor(userId: string): KvAliasCache {
  let c = kvAliasUserCaches.get(userId)
  if (c) {
    kvAliasUserCaches.delete(userId)
    kvAliasUserCaches.set(userId, c)
    return c
  }
  c = { map: null, at: 0, inflight: null }
  if (kvAliasUserCaches.size >= KV_ALIAS_USER_CACHE_CAP) {
    const oldest = kvAliasUserCaches.keys().next().value
    if (oldest !== undefined) kvAliasUserCaches.delete(oldest)
  }
  kvAliasUserCaches.set(userId, c)
  return c
}

async function kvAliasRead(entry: KvAliasCache, hash: string): Promise<Record<string, ImdbAlias>> {
  const now = Date.now()
  if (entry.map && now - entry.at < KV_READ_TTL_MS) return entry.map
  if (entry.inflight) return entry.inflight
  entry.inflight = (async () => {
    const raw = await getKv().hgetall<Record<string, ImdbAlias>>(hash)
    const map = raw ?? {}
    entry.map = map
    entry.at = Date.now()
    return map
  })().finally(() => { entry.inflight = null })
  return entry.inflight
}

// ---- File-based (mirror del pattern mapping) ----

const ALIAS_FILE = path.join(DATA_DIR, "aliases.json")
let aliasMemCache: Record<string, ImdbAlias> | null = null
let aliasMemCacheTime = 0
let aliasLastStatAt = 0

function userAliasFile(userId: string): string {
  return path.join(DATA_DIR, "users", userId, "aliases.json")
}

interface UserAliasMirror {
  data: Record<string, ImdbAlias> | null
  time: number
  lastStat: number
}

const userAliasMirrors = new Map<string, UserAliasMirror>()

function userAliasMirrorFor(userId: string): UserAliasMirror {
  let m = userAliasMirrors.get(userId)
  if (m) {
    userAliasMirrors.delete(userId)
    userAliasMirrors.set(userId, m)
    return m
  }
  m = { data: null, time: 0, lastStat: 0 }
  if (userAliasMirrors.size >= USER_MIRROR_CAP) {
    const oldest = userAliasMirrors.keys().next().value
    if (oldest !== undefined) userAliasMirrors.delete(oldest)
  }
  userAliasMirrors.set(userId, m)
  return m
}

async function loadAliasesFromDisk(): Promise<Record<string, ImdbAlias>> {
  try {
    const stat = await fsp.stat(ALIAS_FILE).catch(() => null)
    const raw = await fsp.readFile(ALIAS_FILE, "utf-8")
    const data = JSON.parse(raw) as Record<string, ImdbAlias>
    aliasMemCache = data
    aliasMemCacheTime = stat ? stat.mtimeMs : Date.now()
    return data
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      aliasMemCache = {}
      aliasMemCacheTime = 0
      return {}
    }
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to load aliases", { error: message })
    return aliasMemCache ?? {}
  }
}

async function readAliasesFromMem(): Promise<Record<string, ImdbAlias>> {
  const now = Date.now()
  if (aliasMemCache && now - aliasLastStatAt < READ_STAT_TTL_MS) return aliasMemCache
  aliasLastStatAt = now
  try {
    const stat = await fsp.stat(ALIAS_FILE)
    if (aliasMemCache && stat.mtimeMs <= aliasMemCacheTime) return aliasMemCache
  } catch {
    if (aliasMemCache) return aliasMemCache
  }
  return loadAliasesFromDisk()
}

async function persistAliases(data: Record<string, ImdbAlias>) {
  await ensureDataDir()
  const tmp = `${ALIAS_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
    try {
      await fsp.rename(tmp, ALIAS_FILE)
    } catch (e) {
      if (isNodeError(e) && (e as NodeJS.ErrnoException).code === "EXDEV") {
        await fsp.copyFile(tmp, ALIAS_FILE)
        await fsp.unlink(tmp).catch(() => {})
      } else {
        throw e
      }
    }
    aliasMemCache = data
    aliasMemCacheTime = Date.now()
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    log.error("Failed to write aliases", { file: ALIAS_FILE, error: msg })
    throw new Error(`Cannot persist aliases: ${msg}`)
  }
}

async function loadUserAliasesFromDisk(userId: string): Promise<Record<string, ImdbAlias>> {
  const file = userAliasFile(userId)
  const mirror = userAliasMirrorFor(userId)
  try {
    const stat = await fsp.stat(file).catch(() => null)
    const raw = await fsp.readFile(file, "utf-8")
    const data = JSON.parse(raw) as Record<string, ImdbAlias>
    mirror.data = data
    mirror.time = stat ? stat.mtimeMs : Date.now()
    return data
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      mirror.data = {}
      mirror.time = 0
      return {}
    }
    const message = error instanceof Error ? error.message : String(error)
    log.warn("Failed to load user aliases", { error: message })
    return mirror.data ?? {}
  }
}

async function readUserAliasesFromMem(userId: string): Promise<Record<string, ImdbAlias>> {
  const mirror = userAliasMirrorFor(userId)
  const now = Date.now()
  if (mirror.data && now - mirror.lastStat < READ_STAT_TTL_MS) return mirror.data
  mirror.lastStat = now
  try {
    const stat = await fsp.stat(userAliasFile(userId))
    if (mirror.data && stat.mtimeMs <= mirror.time) return mirror.data
  } catch (e) {
    if (isNodeError(e) && e.code === "ENOENT") return loadUserAliasesFromDisk(userId)
    if (mirror.data) return mirror.data
  }
  return loadUserAliasesFromDisk(userId)
}

async function persistUserAliases(userId: string, data: Record<string, ImdbAlias>) {
  const file = userAliasFile(userId)
  await fsp.mkdir(path.dirname(file), { recursive: true }).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    log.error(`Failed to create user data dir '${path.dirname(file)}': ${msg}`)
    throw new Error(`Cannot create user data directory: ${msg}`)
  })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
    try {
      await fsp.rename(tmp, file)
    } catch (e) {
      if (isNodeError(e) && (e as NodeJS.ErrnoException).code === "EXDEV") {
        await fsp.copyFile(tmp, file)
        await fsp.unlink(tmp).catch(() => {})
      } else {
        throw e
      }
    }
    const mirror = userAliasMirrorFor(userId)
    mirror.data = data
    mirror.time = Date.now()
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    log.error("Failed to write user aliases", { error: msg })
    throw new Error(`Cannot persist user aliases: ${msg}`)
  }
}

async function readAliases(userId?: string | null): Promise<Record<string, ImdbAlias>> {
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) return kvAliasRead(kvAliasUserCacheFor(userId), userAliasKvKey(userId))
    return readUserAliasesFromMem(userId)
  }
  if (isKvMode()) return kvAliasRead(kvAliasGlobal, "aliases")
  return readAliasesFromMem()
}

/** Quota condivisa mapping+alias: un alias pesa come un rigo mapping. */
async function assertAliasQuota(
  aliases: Record<string, ImdbAlias>,
  key: string,
  userId?: string | null,
): Promise<void> {
  if (key in aliases) return
  const max = getMaxMappingsPerUser()
  const mappingCount = Object.keys(
    userId
      ? (isKvMode() ? await kvReadAllCachedFor(userId) : await readUserFromMem(userId))
      : (isKvMode() ? await kvReadAllCached() : await readFromMem()),
  ).length
  if (mappingCount + Object.keys(aliases).length >= max) throw new QuotaExceededError(max)
}

export async function getAllAliases(userId?: string | null): Promise<ImdbAlias[]> {
  return Object.values(await readAliases(userId))
}

/** Alias per-namespace stretto come getById: con userId mai fallback globale. */
export async function getImdbAlias(imdbId: string, userId?: string | null): Promise<ImdbAlias | null> {
  if (!isValidImdbAliasId(imdbId)) return null
  return (await readAliases(userId))[normalizeAliasId(imdbId)] ?? null
}

export async function setImdbAlias(alias: ImdbAlias, userId?: string | null) {
  assertValidAlias(alias)
  const key = normalizeAliasId(alias.imdbId)
  const next = { ...alias, imdbId: key, updatedAt: new Date().toISOString() }
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) {
      const current = await kvAliasRead(kvAliasUserCacheFor(userId), userAliasKvKey(userId))
      await assertAliasQuota(current, key, userId)
      await getKv().hset(userAliasKvKey(userId), { [key]: next })
      const c = kvAliasUserCaches.get(userId)
      if (c?.map) c.map[key] = next
      return
    }
    return enqueueUserWrite(userId, async () => {
      const data = await loadUserAliasesFromDisk(userId)
      await assertAliasQuota(data, key, userId)
      data[key] = next
      await persistUserAliases(userId, data)
    })
  }
  if (isKvMode()) {
    const current = await kvAliasRead(kvAliasGlobal, "aliases")
    await assertAliasQuota(current, key)
    await getKv().hset("aliases", { [key]: next })
    if (kvAliasGlobal.map) kvAliasGlobal.map[key] = next
    return
  }
  return enqueueWrite(async () => {
    const data = await loadAliasesFromDisk()
    await assertAliasQuota(data, key)
    data[key] = next
    await persistAliases(data)
  })
}

export async function removeImdbAlias(imdbId: string, userId?: string | null) {
  if (!isValidImdbAliasId(imdbId)) return
  const key = normalizeAliasId(imdbId)
  if (userId) {
    assertValidUserId(userId)
    if (isKvMode()) {
      await getKv().hdel(userAliasKvKey(userId), key)
      const c = kvAliasUserCaches.get(userId)
      if (c?.map) delete c.map[key]
      return
    }
    return enqueueUserWrite(userId, async () => {
      const data = await loadUserAliasesFromDisk(userId)
      delete data[key]
      await persistUserAliases(userId, data)
    })
  }
  if (isKvMode()) {
    await getKv().hdel("aliases", key)
    if (kvAliasGlobal.map) delete kvAliasGlobal.map[key]
    return
  }
  return enqueueWrite(async () => {
    const data = await loadAliasesFromDisk()
    delete data[key]
    await persistAliases(data)
  })
}

/**
 * Cascata alla cancellazione mapping: senza, un alias orfano continuerebbe a
 * dirottare il tt sul (vecchio) tmdbId anche dopo che l'utente ha eliminato il
 * poster. Ritorna gli imdbId rimossi.
 */
export async function removeAliasesFor(
  type: "movie" | "tv",
  id: number,
  userId?: string | null,
): Promise<string[]> {
  const data = await readAliases(userId)
  const doomed = Object.keys(data).filter(
    (k) => data[k].mediaType === type && data[k].tmdbId === id,
  )
  for (const k of doomed) {
    await removeImdbAlias(k, userId)
  }
  return doomed
}

/** Evict delle cache alias in-process (wipe account / test). */
export function __evictAliasCache(userId?: string | null): void {
  if (userId) {
    kvAliasUserCaches.delete(userId)
    userAliasMirrors.delete(userId)
    return
  }
  kvAliasGlobal = { map: null, at: 0, inflight: null }
  aliasMemCache = null
}
