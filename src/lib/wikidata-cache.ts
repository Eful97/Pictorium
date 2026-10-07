import { promises as fsp } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { envWithFallback } from "@/lib/env-compat"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode, withKvTimeout } from "@/lib/kv"
import { createLogger } from "@/lib/logger"

const log = createLogger("wikidata-cache")

// ---------------------------------------------------------------------------
// Wikidata persistent cache — per-title durable storage for successful
// Wikidata results (fresh ≤ 7d, usable-stale ≤ 30d).
// Durable fallback for the awards path: on L1/shared (`wikidata:v2:…`)
// miss, fetchAllWikidata serves persisted fresh (≤7d, repopulating shared
// with the remaining lifetime) and retains stale (≤30d) as fail-open
// fallback on transient failure. The short shared cache (`wikidata:v2:…`
// in lib/cache.ts, 7d shared) is a separate namespace and
// remains the first lookup there. This module never changes global
// cache.ts/kv.ts behavior.
// ---------------------------------------------------------------------------
// Semantics:
// - Persist only results explicitly marked `degraded: false`, including
//   genuine empties (no awards anywhere is a real answer, not a failure).
//   Anything else (degraded, missing flag, invalid) is refused without
//   writing. Transient failures stay on the existing 60s in-memory negative
//   cache in awards.ts (invariant, unchanged here).
// - Fresh ≤ 7d, usable-stale ≤ 30d, then miss. Reads NEVER rewrite or touch
//   the record: the absolute age is preserved (no retention reset on read).
// - Backend is exclusive: KV when a KV backend is configured, otherwise one
//   JSON file per title under DATA_DIR/wikidata. Never both (no double
//   write in KV mode), never os.tmpdir() (fake durability), no credentials
//   in keys or payloads (only public catalog coords + labels).
// - Concurrency: per-title files are written via atomicWriteFile (atomic
//   rename → last writer wins); KV set is last-writer-wins. No locking
//   abstraction — a lost race only repeats an idempotent persist.
// ---------------------------------------------------------------------------

/** Fresh window: records at most this old are served as fresh. */
export const WIKIDATA_PERSIST_FRESH_MS = 7 * 24 * 60 * 60 * 1000
/** Hard retention: records older than this are a miss (and pruned on disk). */
export const WIKIDATA_PERSIST_STALE_MS = 30 * 24 * 60 * 60 * 1000
/** KV TTL mirrors disk retention so both backends expire together. */
export const WIKIDATA_PERSIST_KV_EX_SECONDS = 30 * 24 * 60 * 60
/** Soft disk bound enforced by the throttled prune: between prune runs the
 *  count may temporarily exceed this (writes never block on retention);
 *  each prune drops the oldest beyond it (best-effort). */
export const WIKIDATA_PERSIST_MAX_FILES = 2000
/** Clock-skew tolerance for `fetchedAt` slightly in the future. */
const WIKIDATA_PERSIST_FUTURE_SKEW_MS = 60_000
/** KV read cap: a stalled backend is a miss, never a render stall. */
const WIKIDATA_PERSIST_KV_READ_MS = 1500
/** Prune runs off the hot path, at most this often per process. */
const WIKIDATA_PERSIST_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Safety bound for a single prune scan (files are capped at MAX_FILES). */
const WIKIDATA_PERSIST_PRUNE_SCAN_MAX = 10_000

const WIKIDATA_PERSIST_DIRNAME = "wikidata"
/** Dedicated persistent namespace (v1). The short shared cache key
 *  `wikidata:v2:…` in lib/cache.ts is a different namespace and is NOT
 *  read or written here. No user ids in keys: per-title, never per-user. */
const WIKIDATA_PERSIST_KV_PREFIX = "pictorium:wikidata:v1:"

const FILE_NAME_RE = /^wikidata-v1-(movie|tv)-(\d+)\.json$/

const MAX_LABELS = 50
const MAX_LABEL_LEN = 120

export type WikidataMediaType = "movie" | "tv"

/** Neutral successful payload: label lists + canonical director, no locale
 *  rendering, no `degraded` flag (only non-degraded results are stored). */
export interface WikidataPersistPayload {
  awards: string[]
  nominations: string[]
  studios: string[]
  director: string | null
}

/** Accepted by setPersistedWikidata: a WikidataResult-shaped value with an
 *  explicit success marker. Only `degraded: false` is stored — `true` or a
 *  missing flag is refused and never persisted. The 60s in-memory negative
 *  cache owns transient failures. */
export interface WikidataPersistInput extends WikidataPersistPayload {
  degraded: false
}

export type WikidataPersistStatus = "fresh" | "stale"

export interface WikidataPersisted {
  payload: WikidataPersistPayload
  fetchedAt: number
  status: WikidataPersistStatus
}

interface WikidataPersistEnvelope {
  v: 1
  tmdbId: number
  mediaType: WikidataMediaType
  fetchedAt: number
  payload: WikidataPersistPayload
}

function isMediaType(value: unknown): value is WikidataMediaType {
  return value === "movie" || value === "tv"
}

function isValidTmdbId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && Number.isSafeInteger(value)
}

function isLabelList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_LABELS) return false
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_LABEL_LEN) return false
  }
  return true
}

function isValidPayload(raw: unknown): raw is WikidataPersistPayload {
  if (typeof raw !== "object" || raw === null) return false
  const rec = raw as Record<string, unknown>
  if (!isLabelList(rec.awards) || !isLabelList(rec.nominations) || !isLabelList(rec.studios)) return false
  const director = rec.director
  return director === null || (typeof director === "string" && director.length > 0 && director.length <= MAX_LABEL_LEN)
}

function isValidEnvelope(raw: unknown, tmdbId: number, mediaType: WikidataMediaType): raw is WikidataPersistEnvelope {
  if (typeof raw !== "object" || raw === null) return false
  const rec = raw as Record<string, unknown>
  return (
    rec.v === 1 &&
    rec.tmdbId === tmdbId &&
    rec.mediaType === mediaType &&
    typeof rec.fetchedAt === "number" &&
    Number.isFinite(rec.fetchedAt) &&
    isValidPayload(rec.payload)
  )
}

/** Filename for a title. Null when the coords are invalid (never build a
 *  path from unvalidated input — no traversal, digits only). */
export function wikidataPersistFilename(mediaType: string, tmdbId: number): string | null {
  if (!isMediaType(mediaType) || !isValidTmdbId(tmdbId)) return null
  return `wikidata-v1-${mediaType}-${tmdbId}.json`
}

/** DATA_DIR resolved live (tests stub PICTORIUM_DATA_DIR + resetModules):
 *  same pattern as badge-preset-store.ts. */
function wikidataPersistDir(): string {
  const dir = envWithFallback("DATA_DIR") || DATA_DIR
  return path.join(dir, WIKIDATA_PERSIST_DIRNAME)
}

function wikidataPersistKey(mediaType: WikidataMediaType, tmdbId: number): string {
  return `${WIKIDATA_PERSIST_KV_PREFIX}${mediaType}:${tmdbId}`
}

function statusForAge(ageMs: number): WikidataPersistStatus | null {
  if (ageMs > WIKIDATA_PERSIST_STALE_MS) return null
  return ageMs <= WIKIDATA_PERSIST_FRESH_MS ? "fresh" : "stale"
}

/** Shared envelope → record check: schema, coord match, absolute age.
 *  Pure: no I/O, no retention reset. */
function toPersisted(
  raw: unknown,
  tmdbId: number,
  mediaType: WikidataMediaType,
  now: number,
): WikidataPersisted | null {
  if (!isValidEnvelope(raw, tmdbId, mediaType)) return null
  const fetchedAt = raw.fetchedAt
  if (fetchedAt > now + WIKIDATA_PERSIST_FUTURE_SKEW_MS) return null
  const ageMs = Math.max(0, now - fetchedAt)
  const status = statusForAge(ageMs)
  if (status === null) return null
  const p = raw.payload
  return {
    payload: {
      awards: [...p.awards],
      nominations: [...p.nominations],
      studios: [...p.studios],
      director: p.director,
    },
    fetchedAt,
    status,
  }
}

/** Minimum gap between two warnings for the same action: an outage must
 *  not flood the logs (one line per action per minute, then silence). */
const WIKIDATA_PERSIST_WARN_INTERVAL_MS = 60_000
const warnAt = new Map<string, number>()

function warnThrottled(action: string, error: unknown): void {
  const now = Date.now()
  if (now - (warnAt.get(action) ?? 0) < WIKIDATA_PERSIST_WARN_INTERVAL_MS) return
  warnAt.set(action, now)
  log.warn(`wikidata persist ${action} failed, fail-open`, {
    error: error instanceof Error ? error.message : String(error),
  })
}

// --- Disk backend -----------------------------------------------------------

async function readPersistedFile(
  tmdbId: number,
  mediaType: WikidataMediaType,
  signal?: AbortSignal,
): Promise<WikidataPersisted | null> {
  if (signal?.aborted) return null
  const filename = wikidataPersistFilename(mediaType, tmdbId)
  if (!filename) return null
  const file = path.join(wikidataPersistDir(), filename)
  let raw: string
  try {
    // Abortable (verified: fsp.readFile honors `signal`, aborted reads
    // reject with AbortError; `signal: undefined` behaves like the plain
    // encoding form): a budgeted caller aborts instead of orphaning the read.
    raw = await fsp.readFile(file, { encoding: "utf-8", signal })
  } catch (error) {
    // Aborted by the caller (hot-path budget): silent miss, never a warn.
    if (signal?.aborted) return null
    // Missing file = miss (no log spam for the common cold case); other
    // fs errors are fail-open misses with one bounded warn.
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    warnThrottled("read", error)
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Corrupted file: miss + best-effort single-file cleanup (O(1), never a
    // directory scan on the read path).
    await fsp.unlink(file).catch(() => {})
    return null
  }
  const record = toPersisted(parsed, tmdbId, mediaType, Date.now())
  if (record === null) {
    // Schema/coords/age failure. Expired records are removed best-effort so
    // retention does not rely on the throttled prune alone; future-dated or
    // mismatched records are left for prune (mtime-based) to avoid deleting
    // data that a skewed clock could still validate.
    if (
      isValidEnvelope(parsed, tmdbId, mediaType) &&
      Date.now() - parsed.fetchedAt > WIKIDATA_PERSIST_STALE_MS
    ) {
      await fsp.unlink(file).catch(() => {})
    } else if (typeof parsed !== "object" || parsed === null) {
      await fsp.unlink(file).catch(() => {})
    }
  }
  return record
}

async function writePersistedFile(envelope: WikidataPersistEnvelope): Promise<boolean> {
  const filename = wikidataPersistFilename(envelope.mediaType, envelope.tmdbId)
  if (!filename) return false
  const dir = wikidataPersistDir()
  const file = path.join(dir, filename)
  try {
    await fsp.mkdir(dir, { recursive: true })
    await atomicWriteFile(file, JSON.stringify(envelope))
    triggerPruneSoon()
    return true
  } catch (error) {
    // DATA_DIR missing/unwritable (serverless, read-only mount): fail-open,
    // never throw, never fall back to os.tmpdir() (fake durability).
    warnThrottled("write", error)
    return false
  }
}

// --- KV backend (exclusive with disk: in KV mode disk is never touched) -----

async function readPersistedKv(
  tmdbId: number,
  mediaType: WikidataMediaType,
  signal?: AbortSignal,
): Promise<WikidataPersisted | null> {
  if (signal?.aborted) return null
  try {
    const raw: unknown = await withKvTimeout(getKv().get(wikidataPersistKey(mediaType, tmdbId)), WIKIDATA_PERSIST_KV_READ_MS)
    // The KV client may hand back the object already parsed (Upstash native /
    // redis decodeValue) or the raw envelope string: accept both.
    let parsed: unknown = raw
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
    } else if (raw !== null && typeof raw !== "object") {
      return null
    }
    if (parsed === null) return null
    // Never rewrite on read: the stored fetchedAt keeps its absolute age,
    // and KV expiry (EX 30d) enforces retention without SCAN.
    return toPersisted(parsed, tmdbId, mediaType, Date.now())
  } catch (error) {
    warnThrottled("kv read", error)
    return null
  }
}

async function writePersistedKv(envelope: WikidataPersistEnvelope): Promise<boolean> {
  try {
    await withKvTimeout(getKv().set(wikidataPersistKey(envelope.mediaType, envelope.tmdbId), envelope, { ex: WIKIDATA_PERSIST_KV_EX_SECONDS }), WIKIDATA_PERSIST_KV_READ_MS)
    return true
  } catch (error) {
    warnThrottled("kv write", error)
    return false
  }
}

// --- Public API --------------------------------------------------------------

/**
 * Read one title's persisted record. Null = miss (absent, corrupted,
 * coords mismatch, future-dated, or older than 30d). Otherwise the payload
 * with its absolute `fetchedAt` and `status` (`fresh` ≤ 7d, `stale` ≤ 30d).
 * Fail-open on any I/O error. Never extends retention.
 * `signal` (optional) aborts a stalled disk read; an aborted call is a
 * silent miss. The KV path is already capped (WIKIDATA_PERSIST_KV_READ_MS)
 * and fail-open; a caller-side budget simply stops waiting for it.
 */
export async function getPersistedWikidata(
  tmdbId: number,
  mediaType: WikidataMediaType,
  signal?: AbortSignal,
): Promise<WikidataPersisted | null> {
  if (!isValidTmdbId(tmdbId) || !isMediaType(mediaType)) return null
  if (signal?.aborted) return null
  try {
    if (getStorageMode() === "kv") return await readPersistedKv(tmdbId, mediaType, signal)
    return await readPersistedFile(tmdbId, mediaType, signal)
  } catch (error) {
    warnThrottled("read", error)
    return null
  }
}

/**
 * Persist one title's successful result. Only an explicit `degraded: false`
 * is stored — genuine empties included; `degraded: true`, a missing flag,
 * invalid payloads, or invalid coords return false without writing.
 * Overwrites atomically (last writer wins). Fail-open on I/O errors.
 */
export async function setPersistedWikidata(
  tmdbId: number,
  mediaType: WikidataMediaType,
  input: WikidataPersistInput,
): Promise<boolean> {
  if (!isValidTmdbId(tmdbId) || !isMediaType(mediaType)) return false
  if (typeof input !== "object" || input === null || input.degraded !== false) return false
  if (!isValidPayload(input)) return false
  const envelope: WikidataPersistEnvelope = {
    v: 1,
    tmdbId,
    mediaType,
    fetchedAt: Date.now(),
    payload: {
      awards: [...input.awards],
      nominations: [...input.nominations],
      studios: [...input.studios],
      director: input.director,
    },
  }
  try {
    if (getStorageMode() === "kv") return await writePersistedKv(envelope)
    return await writePersistedFile(envelope)
  } catch (error) {
    warnThrottled("write", error)
    return false
  }
}

// --- Bounded retention (disk only; KV expires via EX, never SCAN) ------------

export interface WikidataPruneResult {
  removed: number
  kept: number
}

let lastPruneAt = 0

/** Only for tests: reset the prune throttle and the warn throttle. */
export function __resetWikidataPersistForTests(): void {
  lastPruneAt = 0
  warnAt.clear()
}

/**
 * Remove per-title files older than 30d (by mtime — writes always create a
 * fresh file and reads never touch it, so mtime tracks fetchedAt) and trim
 * beyond the soft file cap by dropping the oldest. Scoped to the wikidata
 * subdir and to `wikidata-v1-*.json` names only: foreign files are never
 * touched. Bounded single pass, disk only (KV mode = no-op). `kept` counts
 * only files actually still present (failed deletes stay counted as kept).
 */
export async function pruneWikidataPersisted(
  opts?: { now?: number; maxFiles?: number },
): Promise<WikidataPruneResult> {
  const empty: WikidataPruneResult = { removed: 0, kept: 0 }
  try {
    if (getStorageMode() === "kv") return empty
  } catch {
    return empty
  }
  const now = opts?.now ?? Date.now()
  const maxFiles = opts?.maxFiles ?? WIKIDATA_PERSIST_MAX_FILES
  let entries: string[]
  try {
    entries = await fsp.readdir(wikidataPersistDir())
  } catch {
    return empty
  }
  const candidates: Array<{ file: string; mtimeMs: number }> = []
  const bounded = entries.slice(0, WIKIDATA_PERSIST_PRUNE_SCAN_MAX)
  for (const entry of bounded) {
    if (!FILE_NAME_RE.test(entry)) continue
    try {
      const st = await fsp.stat(path.join(wikidataPersistDir(), entry))
      if (!st.isFile()) continue
      candidates.push({ file: entry, mtimeMs: st.mtimeMs })
    } catch {
      continue
    }
  }
  let removed = 0
  const live: Array<{ file: string; mtimeMs: number }> = []
  for (const c of candidates) {
    if (now - c.mtimeMs > WIKIDATA_PERSIST_STALE_MS) {
      try {
        await fsp.unlink(path.join(wikidataPersistDir(), c.file))
        removed++
      } catch {
        live.push(c)
      }
    } else {
      live.push(c)
    }
  }
  if (live.length > maxFiles) {
    live.sort((a, b) => a.mtimeMs - b.mtimeMs)
    const excess = live.slice(0, live.length - maxFiles)
    // Files that survive the cap plus excess files whose delete failed.
    let kept = maxFiles
    for (const c of excess) {
      try {
        await fsp.unlink(path.join(wikidataPersistDir(), c.file))
        removed++
      } catch {
        kept++
      }
    }
    return { removed, kept }
  }
  return { removed, kept: live.length }
}

/** Throttled async prune after disk writes only — never on the read path,
 *  never awaited (no latency on the caller), never an orphan rejection. */
function triggerPruneSoon(): void {
  try {
    if (getStorageMode() === "kv") return
  } catch {
    return
  }
  const now = Date.now()
  if (now - lastPruneAt < WIKIDATA_PERSIST_PRUNE_INTERVAL_MS) return
  lastPruneAt = now
  void pruneWikidataPersisted().catch(() => {})
}
