/**
 * Poster disk cache (L1.5): rendered canonical posters survive a restart or
 * deploy instead of every title re-rendering cold. Only the canonical bytes +
 * their headers record are persisted (format variants are cheap response-time
 * conversions). Hydration restores the L1 entry with its ORIGINAL timestamp,
 * so TTL / scheduled refresh / SWR / factCapped behave as if it never left
 * memory. Keys are self-invalidating (RENDER_VERSION, sdHash, mapVersion...);
 * whole-poster invalidations wipe the directory from cache.ts and bump its
 * generation, which this module checks before every read/write.
 *
 * On by default where the filesystem is real (not Vercel, not tests).
 * Env: PICTORIUM_POSTER_DISK_CACHE=0 disables; PICTORIUM_POSTER_DISK_CACHE_MB
 * (default 512, 16–10240) bounds the directory, oldest-used evicted first.
 */
import crypto from "node:crypto"
import fsp from "node:fs/promises"
import path from "node:path"
import { atomicWriteFile } from "@/lib/atomic-write"
import { cacheGetStale, cacheRestoreLocal, posterDiskWipeGeneration } from "@/lib/cache"
import { POSTER_DISK_CACHE_DIR } from "@/lib/data-dir"
import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"

const log = createLogger("poster-disk-cache")

/** Below this TTL an entry is ephemeral (degraded render): never persisted. */
const MIN_PERSIST_TTL_MS = 10 * 60 * 1000
/** Never resurrect anything older than this, stale-serving included. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const MAX_BYTES = (() => {
  const n = Number(envWithFallback("POSTER_DISK_CACHE_MB"))
  return (Number.isFinite(n) && n >= 16 && n <= 10240 ? n : 512) * 1024 * 1024
})()

function defaultDir(): string | null {
  const flag = (envWithFallback("POSTER_DISK_CACHE") ?? "").toLowerCase()
  if (["0", "false", "off", "no"].includes(flag)) return null
  if (process.env.VERCEL || process.env.VITEST) return null
  return POSTER_DISK_CACHE_DIR
}

let dir: string | null = defaultDir()
/** Last cache.ts wipe generation seen: a write/read started before a wipe never lands after it. */
let generation = posterDiskWipeGeneration()
let wipedAt = 0
let index: Map<string, { size: number; usedAt: number }> | null = null
let indexLoading: Promise<void> | null = null
let totalBytes = 0
const hydrating = new Map<string, Promise<void>>()

interface DiskHeader {
  readonly key: string
  readonly timestamp: number
  readonly writtenAt: number
  readonly ttl: number | undefined
  readonly tags: string[]
  readonly headers: unknown
}

/** Catch up with a cache.ts wipe: drop the index and this dir's files. */
function syncWipe(): void {
  const g = posterDiskWipeGeneration()
  if (g === generation) return
  generation = g
  // Unlinks below are async: until they land, reject anything written before now.
  wipedAt = Date.now()
  index = null
  totalBytes = 0
  const d = dir
  if (!d) return
  void fsp.readdir(d).then(
    (names) => Promise.all(names.filter((n) => n.endsWith(".bin")).map((n) => fsp.unlink(path.join(d, n)).catch(() => {}))),
    () => {},
  )
}

function fileName(key: string): string {
  return `${crypto.createHash("sha256").update(key).digest("hex").slice(0, 40)}.bin`
}

async function ensureIndex(d: string): Promise<void> {
  if (index) return
  indexLoading ??= (async () => {
    const next = new Map<string, { size: number; usedAt: number }>()
    let bytes = 0
    await fsp.mkdir(d, { recursive: true })
    for (const name of await fsp.readdir(d)) {
      if (!name.endsWith(".bin")) continue
      const st = await fsp.stat(path.join(d, name)).catch(() => null)
      if (!st) continue
      next.set(name, { size: st.size, usedAt: st.mtimeMs })
      bytes += st.size
    }
    index = next
    totalBytes = bytes
  })().finally(() => { indexLoading = null })
  await indexLoading
}

async function evictIfNeeded(d: string): Promise<void> {
  if (!index || totalBytes <= MAX_BYTES) return
  // ponytail: full sort on overflow only, O(n log n) on a few thousand files.
  const target = MAX_BYTES * 0.9
  for (const [name, e] of [...index].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
    if (totalBytes <= target || !index) break
    // A concurrent eviction (or wipe) may already have dropped it.
    if (!index.delete(name)) continue
    totalBytes -= e.size
    await fsp.unlink(path.join(d, name)).catch(() => {})
  }
}

function track(name: string, size: number): void {
  if (!index) return
  const prev = index.get(name)
  if (prev) totalBytes -= prev.size
  index.set(name, { size, usedAt: Date.now() })
  totalBytes += size
}

function forget(name: string): void {
  const prev = index?.get(name)
  if (prev) { totalBytes -= prev.size; index!.delete(name) }
}

/** Fire-and-forget persist of one canonical poster (never throws, never awaited by the render). */
export function persistPosterToDisk(
  key: string,
  buffer: Buffer,
  headers: unknown,
  tags: string[],
  ttlMs: number | undefined,
  timestamp: number,
): void {
  const d = dir
  if (!d || (ttlMs !== undefined && ttlMs < MIN_PERSIST_TTL_MS)) return
  syncWipe()
  const gen = generation
  const name = fileName(key)
  void (async () => {
    await ensureIndex(d)
    const header = Buffer.from(JSON.stringify({ key, timestamp, writtenAt: Date.now(), ttl: ttlMs, tags, headers } satisfies DiskHeader))
    const len = Buffer.alloc(4)
    len.writeUInt32LE(header.length)
    const data = Buffer.concat([len, header, buffer])
    await atomicWriteFile(path.join(d, name), data)
    if (gen !== posterDiskWipeGeneration() || d !== dir) {
      await fsp.unlink(path.join(d, name)).catch(() => {})
      return
    }
    track(name, data.length)
    await evictIfNeeded(d)
  })().catch((e) => log.debug("poster disk write failed", { error: String(e) }))
}

/**
 * On an L1 miss, hydrate the canonical poster (bytes + `:headers` record, the
 * writeCachedPoster pair) from disk. Concurrent callers share one read. Never
 * throws: any disk problem is a plain miss and the caller renders as before.
 */
export function hydratePosterFromDisk(key: string): Promise<void> {
  const d = dir
  if (!d || cacheGetStale(key).data != null) return Promise.resolve()
  const headersKey = `${key}:headers`
  syncWipe()
  const pending = hydrating.get(key)
  if (pending) return pending
  const gen = generation
  const p = (async () => {
    const name = fileName(key)
    const file = path.join(d, name)
    let raw: Buffer
    try {
      raw = await fsp.readFile(file)
    } catch {
      return
    }
    const len = raw.length >= 4 ? raw.readUInt32LE(0) : -1
    const header = len > 0 && 4 + len <= raw.length
      ? (JSON.parse(raw.subarray(4, 4 + len).toString("utf8")) as DiskHeader)
      : null
    if (!header || header.key !== key || !(header.writtenAt >= wipedAt) || Date.now() - header.timestamp > MAX_AGE_MS) {
      forget(name)
      await fsp.unlink(file).catch(() => {})
      return
    }
    // A wipe landed during the read: never resurrect into a cleared L1.
    if (gen !== posterDiskWipeGeneration()) return
    const bytes = Buffer.from(raw.subarray(4 + len))
    cacheRestoreLocal(key, bytes, header.tags, header.ttl, header.timestamp)
    cacheRestoreLocal(headersKey, header.headers, header.tags, header.ttl, header.timestamp)
    // LRU signal for eviction (mtime = last use).
    const now = new Date()
    void fsp.utimes(file, now, now).catch(() => {})
    if (index?.has(name)) index.get(name)!.usedAt = now.getTime()
  })()
    .catch((e) => log.debug("poster disk read failed", { error: String(e) }))
    .finally(() => hydrating.delete(key))
  hydrating.set(key, p)
  return p
}

/** Test-only: point the cache at a directory (null disables) and reset state. */
export function __setPosterDiskCacheDirForTest(next: string | null): void {
  dir = next
  generation = posterDiskWipeGeneration()
  index = null
  totalBytes = 0
  hydrating.clear()
}
