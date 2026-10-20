import * as fsp from "node:fs/promises"
import crypto from "node:crypto"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { envWithFallback } from "@/lib/env-compat"
import { atomicWriteFile } from "@/lib/atomic-write"
import { combineAbortSignals, raceWithAbort } from "@/lib/abort-signal"
import { getStorageMode } from "@/lib/kv"
import { createLogger } from "@/lib/logger"

const log = createLogger("mdblist-raw-cache")

// ---------------------------------------------------------------------------
// MDBList raw ratings — durable L2 for FILE storage mode (VPS/local disk).
//
// The shared raw MDBList cache (keyed by imdb-id or tmdb{numeric}-id + key
// hash, 24h default / 7d old movies) already persists across restarts via the KV L2 envelope when a KV
// backend is configured (ElfHosted/Redis, Vercel/Upstash). On file-mode
// instances (VPS with a persistent volume) there is no KV, so without this
// module every process restart refetched every raw rating from MDBList.
//
// This module is the file-mode counterpart: one small JSON file per raw
// identity under DATA_DIR/mdblist-raw. Semantics mirror the KV envelope:
// absolute expiry is preserved (reads never renew it, L1 is repopulated with
// the REMAINING lifetime), only positive results are stored (misses/errors
// never reach the disk), and everything is fail-open (unknown/read-only
// storage, corrupt/oversized/expired files are a miss, never an upstream
// cancellation or a latency regression).
//
// Backend exclusivity: in KV mode every function here is a no-op (the
// existing KV L2 path in lib/cache.ts owns persistence); the disk is never
// read, written, pruned, or even stat'ed. Disk persistence additionally
// requires EXPLICITLY configured durable storage (PICTORIUM_DATA_DIR /
// POSTERIUM_DATA_DIR present and non-empty): every blessed runtime path sets
// it (entrypoint.sh exports it unconditionally, defaulting to /data;
// Playwright/scripts isolate it per run), while bare dev (`next dev`) and
// unit tests fall back to the CWD-relative ./data default. Gating on the
// explicit configuration keeps unconfigured checkouts bit-identical to the
// pre-existing behavior (no cache files appear in the repo working copy,
// no timing change at all) and restricts disk writes to operator-chosen
// durable locations. No os.tmpdir() fallback (fake durability), no
// credentials in keys, filenames, payloads, or logs: the API key travels
// only as the sha1-8 hash fragment already present in the raw cache key,
// and filenames hash the FULL raw identity (sha256, no plaintext).
//
// Concurrency: files are written via atomicWriteFile (atomic rename, last
// writer wins). Writes are fire-and-forget from the hot path (never awaited
// by the request) with a bounded number of concurrent disk writes — excess
// writes are dropped fail-open (return false) instead of queueing unbounded
// payload memory. While a background prune is in flight admissions are
// reservation-bounded (at most MAX_CONCURRENT_WRITES total new writes; the
// rest are dropped fail-open): the prune snapshot (readdir) cannot account
// for writes landing after it, so unbounded admissions would grow the
// namespace without bound until the next cadence window. Writes already in
// flight plus the bounded reservation (≤MAX_CONCURRENT_WRITES each) may
// still land during the prune and are tracked as dirty; the prune
// completion schedules exactly one follow-up prune when dirty > 0 (no rerun
// when nothing landed, so no infinite loop). Retention is enforced by a background prune triggered by the write flow itself
// (every N writes or after the throttle interval), never by a scan on the
// read path.
//
// Soft-cap bound (single process): at most caps + PRUNE_EVERY_WRITES +
// MAX_CONCURRENT_WRITES files may transiently exist (one cadence window of
// completed writes plus the bounded owned writers). A residual batch below
// the cadence (<32) may remain until the next prune triggers — the steady
// state is NOT exactly ≤caps at every instant, only bounded and converging
// via the cadence + dirty follow-up.
//
// Read path: fully asynchronous single-file probes (stat + read, ≤64KiB,
// existence-checked first) with an OWNED disk-read bound
// (MDB_RAW_PERSIST_DISK_READ_MS via combineAbortSignals + raceWithAbort):
// the caller race budget alone cannot protect a caller that passes no
// budget, so the probe itself stops waiting and misses fail-open. The
// underlying fs call cannot always be cancelled (stat has no signal), the
// late outcome is simply ignored. Probes run owned by the shared inflight
// lib/ratings.ts, which checks its subscriber count and owned abort before
// AND after the await — a slow or cancelled read never starts an upstream
// MDBList fetch on behalf of departed callers. No synchronous filesystem
// call exists on this module's read path (no statSync/readFileSync/
// unlinkSync/unlink blocking the poster event loop); file size bounds the
// payload, the owned abort bounds the wait.
//
// Multi-process caveat: the caps are enforced per process by the writers it
// observes plus its background prune (last writer wins, deletes target only
// expired/oldest owned files, so concurrent pruners never corrupt data).
// Two processes writing distinct identities at full rate can transiently
// exceed the caps until each process's next prune converges them back down.
// The single-process transient overshoot is soft-bounded by caps +
// PRUNE_EVERY_WRITES + MAX_CONCURRENT_WRITES (see Concurrency above); it is
// NOT exactly ≤caps at every instant. The prune itself scans the whole
// owned namespace (no partial-scan blind spot: every owned file is
// accounted, foreign files never touched).
// ---------------------------------------------------------------------------

/** Disk bound: at most this many raw rating files (oldest-first trim). */
export const MDB_RAW_PERSIST_MAX_FILES = 2000
/** Disk bound: at most this many bytes across raw rating files. */
export const MDB_RAW_PERSIST_MAX_BYTES = 16 * 1024 * 1024
/** Single-file bound: raw rating payloads are tiny (a few sources). */
export const MDB_RAW_PERSIST_MAX_ENVELOPE_BYTES = 64 * 1024
/** Accepted TTL window: the raw policy only ever emits 24h (default) or 7d
 *  (old movies); anything outside is refused rather than persisted. */
export const MDB_RAW_PERSIST_MIN_TTL_MS = 24 * 60 * 60 * 1000
export const MDB_RAW_PERSIST_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Clock-skew tolerance for `t` slightly in the future. */
const MDB_RAW_PERSIST_FUTURE_SKEW_MS = 60_000
/** Prune runs off the hot path, at most this often per process when idle. */
const MDB_RAW_PERSIST_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000
/** Write-flow prune cadence: every this many disk writes a background prune
 *  is scheduled (when none is already running), so sustained write streams
 *  converge under the caps without waiting for the idle interval. */
const MDB_RAW_PERSIST_PRUNE_EVERY_WRITES = 32
/** Bound on concurrent disk writes from this process: excess writes are
 *  dropped fail-open (false) instead of queueing unbounded work/payloads. */
const MDB_RAW_PERSIST_MAX_CONCURRENT_WRITES = 8
/** Owned bound for one disk probe (stat + read): a stalled disk is a miss,
 *  never a hang — even for callers that pass no explicit budget. Fail-open
 *  caller-side wait only; the underlying fs call (stat has no signal) may
 *  still complete late and its outcome is ignored. Uses the shared
 *  combineAbortSignals + raceWithAbort utility, no sync I/O. */
const MDB_RAW_PERSIST_DISK_READ_MS = 1500

const MDB_RAW_PERSIST_DIRNAME = "mdblist-raw"

const FILE_NAME_RE = /^mdblist-raw-v1-[0-9a-f]{64}\.json$/

export interface MdbRawPersisted {
  sources: Record<string, number>
  /** Remaining lifetime (ms) of the absolute expiry: repopulate L1 with
   *  exactly this, never with a fresh TTL (no sliding expiration). */
  remainingTtlMs: number
}

interface MdbRawEnvelope {
  v: 1
  /** Full raw cache key (`mdb:raw:<version>:<type-segment>:<imdb|tmdb{id}>:<keyHash>:mv<minVotes>`):
   *  identity check on read, never a plaintext secret (only the key hash fragment). */
  key: string
  d: Record<string, number>
  /** Generation (ms epoch): absolute age is `now - t`, never renewed. */
  t: number
  /** Explicit TTL chosen at write time (24h default, 7d old movies). */
  ttl: number
}

/** Never build a path from unvalidated input: the raw key must be a
 *  well-formed `mdb:raw:…` identity without separators, so no traversal is
 *  possible and foreign keys are refused before any I/O. */
function isValidRawKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return false
  if (!value.startsWith("mdb:raw:")) return false
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) return false
  return true
}

/** Filename for a raw identity: sha256 of the FULL key (namespace isolation
 *  preserved — distinct imdb/key pairs hash to distinct files), never any
 *  plaintext. Null when the identity is invalid (never build a path). */
export function mdbRawPersistFilename(rawKey: string): string | null {
  if (!isValidRawKey(rawKey)) return null
  return `mdblist-raw-v1-${crypto.createHash("sha256").update(rawKey).digest("hex")}.json`
}

/** DATA_DIR resolved live (tests stub PICTORIUM_DATA_DIR + resetModules). */
function mdbRawPersistDir(): string {
  const dir = envWithFallback("DATA_DIR") || DATA_DIR
  return path.join(dir, MDB_RAW_PERSIST_DIRNAME)
}

function isValidTtl(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MDB_RAW_PERSIST_MIN_TTL_MS
    && value <= MDB_RAW_PERSIST_MAX_TTL_MS
}

function isValidSources(raw: unknown): raw is Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false
  const entries = Object.entries(raw)
  if (entries.length === 0 || entries.length > 64) return false
  for (const [k, v] of entries) {
    if (typeof k !== "string" || k.length === 0 || k.length > 32) return false
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false
  }
  return true
}

function isValidEnvelope(raw: unknown, rawKey: string): raw is MdbRawEnvelope {
  if (typeof raw !== "object" || raw === null) return false
  const rec = raw as Record<string, unknown>
  return rec.v === 1
    && rec.key === rawKey
    && isValidSources(rec.d)
    && typeof rec.t === "number"
    && Number.isFinite(rec.t)
    && isValidTtl(rec.ttl)
}

/** Minimum gap between two warnings for the same action: an outage must
 *  not flood the logs (one line per action per minute, then silence). */
const MDB_RAW_PERSIST_WARN_INTERVAL_MS = 60_000
const warnAt = new Map<string, number>()

function warnThrottled(action: string, error: unknown): void {
  const now = Date.now()
  if (now - (warnAt.get(action) ?? 0) < MDB_RAW_PERSIST_WARN_INTERVAL_MS) return
  warnAt.set(action, now)
  log.warn(`mdblist raw persist ${action} failed, fail-open`, {
    error: error instanceof Error ? error.message : String(error),
  })
}

/** Disk persistence gate: KV mode never touches disk, and file mode only
 *  persists when durable storage was explicitly configured (see module
 *  header). Synchronous and side-effect free (no I/O, no logging). */
function isDiskPersistEnabled(): boolean {
  try {
    if (getStorageMode() === "kv") return false
  } catch {
    return false
  }
  return !!envWithFallback("DATA_DIR")
}

/** Test-only retention/write policy override (never read in production):
 *  lets tests exercise the ACTUAL setPersistedMdbRaw flow against small caps
 *  instead of only calling prune() with tiny ad-hoc limits. Null = production
 *  constants. Cleared by __resetMdbRawPersistForTests. */
interface MdbRawPersistTestPolicy {
  maxFiles: number
  maxBytes: number
  maxConcurrentWrites: number
}

let testPolicy: MdbRawPersistTestPolicy | null = null

/** Only for tests: override retention caps and the write-concurrency bound
 *  so the real write flow (not just explicit prune calls) can be proven to
 *  converge under small caps. */
export function __setMdbRawPersistPolicyForTests(
  policy: Partial<MdbRawPersistTestPolicy>,
): void {
  testPolicy = {
    maxFiles: policy.maxFiles ?? MDB_RAW_PERSIST_MAX_FILES,
    maxBytes: policy.maxBytes ?? MDB_RAW_PERSIST_MAX_BYTES,
    maxConcurrentWrites: policy.maxConcurrentWrites ?? MDB_RAW_PERSIST_MAX_CONCURRENT_WRITES,
  }
}

let activeWrites = 0
let maxActiveWrites = 0
let writesSincePrune = 0
let pruneInFlight = false
let pruneDirtyWrites = 0
let pruneAdmissionsDuringPrune = 0
let currentPrune: Promise<MdbRawPruneResult> | null = null
let lastPruneAt = 0
let pruneAfterSnapshotGateForTests: (() => Promise<void>) | null = null
let readGateForTests: (() => Promise<void>) | null = null
let cleanupGateForTests: (() => Promise<void>) | null = null

/** Only for tests: pause the background prune right after its readdir
 *  snapshot (before scanning/deleting) so the regression can hold the
 *  prune open while streaming hundreds of write attempts. Null = no pause.
 *  The gate rejection is fail-open (prune continues). */
export function __setMdbRawPrunePauseAfterSnapshotForTests(
  gate: (() => Promise<void>) | null,
): void {
  pruneAfterSnapshotGateForTests = gate
}

/** Only for tests: hang the disk probe before any fs call (simulates a
 *  stalled disk deterministically without mocking node:fs). The owned
 *  disk-read bound still applies — the wait races the same owned signal,
 *  so a gate that never resolves ends as a fail-open miss. */
export function __setMdbRawReadGateForTests(
  gate: (() => Promise<void>) | null,
): void {
  readGateForTests = gate
}

/** Only for tests: stall the best-effort single-file cleanup unlink on the
 *  read path (simulates a stalled disk during corrupt/oversized/expired
 *  cleanup deterministically without mocking node:fs). The cleanup races
 *  the same owned bound, so a never-resolving gate still returns fail-open.
 *  Narrow scope: only the three read-path unlinks consult this gate. */
export function __setMdbRawCleanupGateForTests(
  gate: (() => Promise<void>) | null,
): void {
  cleanupGateForTests = gate
}

/** Only for tests: observe write/prune pressure (assert bounded
 *  concurrency), and await the background prune. */
export function __getMdbRawPersistStatsForTests(): {
  activeWrites: number
  maxActiveWrites: number
  writesSincePrune: number
  pruneInFlight: boolean
} {
  return { activeWrites, maxActiveWrites, writesSincePrune, pruneInFlight }
}

/** Only for tests: await the currently running background prune, if any,
 *  including any dirty-tail follow-up prune it schedules (loops until no
 *  prune is owned). Bounded: at most a few rounds can chain because no new
 *  write is admitted while a prune is in flight. */
export async function __flushMdbRawPersistPrune(): Promise<void> {
  for (let i = 0; i < 10 && currentPrune; i += 1) {
    const pending = currentPrune
    try {
      await pending
    } catch {
      // fail-open: prune errors never reject test flushes
    }
    if (currentPrune === pending) break
    // Else a dirty-tail follow-up was scheduled during completion: loop
    // and await it too. Yield once so the scheduler can attach it.
    await new Promise((r) => setTimeout(r, 0))
  }
}

/** Only for tests: reset the prune throttle, write counters, and the warn
 *  throttle (plus any test policy override and prune/read gates). */
export function __resetMdbRawPersistForTests(): void {
  lastPruneAt = 0
  writesSincePrune = 0
  pruneInFlight = false
  pruneDirtyWrites = 0
  pruneAdmissionsDuringPrune = 0
  currentPrune = null
  activeWrites = 0
  maxActiveWrites = 0
  testPolicy = null
  pruneAfterSnapshotGateForTests = null
  readGateForTests = null
  cleanupGateForTests = null
  warnAt.clear()
}

// --- Disk backend (file mode only; KV mode is a no-op above it) -------------
//
// Reads are fully ASYNCHRONOUS single-file probes (stat + read of one tiny
// file ≤64KiB, existence-checked first via the stat miss). They run owned by
// the shared inflight operation in lib/ratings.ts, which re-checks its
// subscriber count and owned abort after the await: a slow read with no
// remaining subscribers never starts an upstream fetch, and a cancelled
// caller's wait ends on its own budget via raceWithAbort without aborting
// the shared work. Fail-open on every I/O error (including read-only
// mounts): never throws.

/**
 * Read one raw identity's persisted record. Null = miss (KV mode,
 * cancelled, absent, oversized, corrupted, identity mismatch, future-dated,
 * or past the absolute expiry). Otherwise the sources with their REMAINING
 * lifetime — the caller repopulates L1 with exactly that (never a fresh
 * TTL). Fail-open on any I/O error: never throws. Never extends retention
 * (no mtime update, no rewrite): repeated reads never renew the TTL.
 * Corrupt/oversized/expired files are removed best-effort bounded by the
 * owned read bound (single file, never a directory scan on the read path):
 * a stalled cleanup unlink is a miss either way, never a hang.
 */
/**
 * Best-effort single-file cleanup raced against the probe's owned bound:
 * the read-path return can never hang on a stalled unlink (fail-open miss,
 * file left for the background prune). Scoped to the already-validated
 * owned `file` path only — foreign files are never touched. No sync I/O.
 */
async function boundedCleanupUnlink(file: string, owned: AbortSignal): Promise<void> {
  if (cleanupGateForTests) {
    try {
      await raceWithAbort(cleanupGateForTests(), owned)
    } catch {
      return
    }
    if (owned.aborted) return
  }
  try {
    await raceWithAbort(fsp.unlink(file), owned)
  } catch {
    // best-effort (missing, stalled, or aborted): miss either way
  }
}

export async function getPersistedMdbRaw(
  rawKey: string,
  opts?: { signal?: AbortSignal },
): Promise<MdbRawPersisted | null> {
  if (!isValidRawKey(rawKey) || !isDiskPersistEnabled()) return null
  if (opts?.signal?.aborted) return null
  const filename = mdbRawPersistFilename(rawKey)
  if (!filename) return null
  const file = path.join(mdbRawPersistDir(), filename)
  // Owned disk-read bound: even a caller with no explicit budget stops
  // waiting after MDB_RAW_PERSIST_DISK_READ_MS (fail-open miss). The race
  // is caller-side only — stat/readFile cannot always be cancelled — and
  // uses the shared abort utility (no sync I/O).
  const owned = combineAbortSignals(opts?.signal, MDB_RAW_PERSIST_DISK_READ_MS)
  // Test-only stalled-disk simulation (no fs mock): races the same owned
  // bound, so a never-resolving gate still misses fail-open.
  if (readGateForTests) {
    try {
      await raceWithAbort(readGateForTests(), owned)
    } catch {
      return null
    }
    if (opts?.signal?.aborted || owned.aborted) return null
  }
  let size = 0
  try {
    const st = await raceWithAbort(fsp.stat(file), owned)
    if (!st.isFile()) return null
    size = st.size
  } catch {
    // Missing file = miss (the common cold case, no log spam); timeout or
    // abort is likewise a silent miss (stalled disk, departed caller).
    return null
  }
  if (opts?.signal?.aborted || owned.aborted) return null
  if (size > MDB_RAW_PERSIST_MAX_ENVELOPE_BYTES) {
    await boundedCleanupUnlink(file, owned)
    return null
  }
  let raw: string
  try {
    raw = await raceWithAbort(
      fsp.readFile(file, { encoding: "utf-8", signal: owned }),
      owned,
    )
  } catch (error) {
    // Abort/timeout (stalled disk or departed caller) is a silent miss;
    // other I/O errors are fail-open misses with one bounded warn.
    if (opts?.signal?.aborted || owned.aborted) return null
    warnThrottled("read", error)
    return null
  }
  if (opts?.signal?.aborted) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    await boundedCleanupUnlink(file, owned)
    return null
  }
  const now = Date.now()
  if (!isValidEnvelope(parsed, rawKey)) return null
  if (parsed.t > now + MDB_RAW_PERSIST_FUTURE_SKEW_MS) return null
  const ageMs = Math.max(0, now - parsed.t)
  if (ageMs >= parsed.ttl) {
    // Past the absolute expiry: miss + best-effort cleanup so retention does
    // not rely on the throttled prune alone. Never sliding: nothing is
    // rewritten on read.
    await boundedCleanupUnlink(file, owned)
    return null
  }
  return { sources: { ...parsed.d }, remainingTtlMs: parsed.ttl - ageMs }
}

/**
 * Persist one raw identity's positive result. Only finite positive source
 * maps with a TTL inside the raw policy window (24h–7d) are stored —
 * misses, errors, and out-of-policy TTLs return false without writing.
 * Overwrites atomically (last writer wins). Fail-open on I/O errors, and a
 * no-op in KV mode (the KV L2 envelope owns persistence there).
 * Fire-and-forget from the hot path: callers never await this.
 *
 * Bounded: at most MDB_RAW_PERSIST_MAX_CONCURRENT_WRITES disk writes are
 * in flight per process — excess calls are dropped fail-open (false) rather
 * than queueing unbounded work and payload memory. While a prune is in
 * flight admissions are additionally reservation-bounded (same bound, total
 * not just concurrent): post-snapshot writes beyond the reservation are
 * dropped fail-open instead of growing the namespace unbounded before the
 * slow prune ends.
 * Every successful write outside a prune feeds the write-triggered
 * background prune, so sustained streams of distinct identities converge
 * under the retention caps without waiting for the idle throttle
 * interval. Soft bound: caps + 32 (cadence) + 8 (owned writers); a residual
 * batch below the cadence may remain until the next prune.
 */
export async function setPersistedMdbRaw(
  rawKey: string,
  sources: Record<string, number>,
  ttlMs: number,
): Promise<boolean> {
  if (!isValidRawKey(rawKey) || !isValidSources(sources) || !isValidTtl(ttlMs)) return false
  if (!isDiskPersistEnabled()) return false
  const maxConcurrent = testPolicy?.maxConcurrentWrites ?? MDB_RAW_PERSIST_MAX_CONCURRENT_WRITES
  // Bounded reservation during pruning (equivalent to fail-open admission
  // backpressure with an evidence-backed bound): a prune snapshot cannot
  // account for writes landing after it, so admissions while a prune is in
  // flight are capped to at most maxConcurrent TOTAL (not just concurrent)
  // — the already-bounded owned writers. Anything beyond is dropped
  // fail-open (false). Each admitted write that lands marks a dirty tail
  // for exactly one follow-up prune. Fast prunes overlap only a couple of
  // sequential writes (all within the reservation, so the normal flow never
  // observes a drop); a slow/held prune cannot grow the namespace beyond
  // the reservation no matter how many hundreds of attempts arrive.
  if (pruneInFlight) {
    if (pruneAdmissionsDuringPrune >= maxConcurrent) return false
    pruneAdmissionsDuringPrune += 1
  }
  if (activeWrites >= maxConcurrent) {
    // Reservation taken but concurrency saturated: release it so a slow
    // prune is not starved by phantom reservations that never wrote.
    if (pruneInFlight) pruneAdmissionsDuringPrune -= 1
    return false
  }
  const filename = mdbRawPersistFilename(rawKey)
  if (!filename) return false
  const envelope: MdbRawEnvelope = {
    v: 1,
    key: rawKey,
    d: { ...sources },
    t: Date.now(),
    ttl: Math.floor(ttlMs),
  }
  let payload: string
  try {
    payload = JSON.stringify(envelope)
    if (payload.length > MDB_RAW_PERSIST_MAX_ENVELOPE_BYTES) return false
  } catch {
    return false
  }
  activeWrites += 1
  if (activeWrites > maxActiveWrites) maxActiveWrites = activeWrites
  const dir = mdbRawPersistDir()
  const file = path.join(dir, filename)
  try {
    await fsp.mkdir(dir, { recursive: true })
    await atomicWriteFile(file, payload)
    if (pruneInFlight) {
      // Landed after the prune snapshot: not counted in this prune, so mark
      // the tail dirty for exactly one follow-up prune (no rerun when no
      // successful write lands during the prune).
      pruneDirtyWrites += 1
    } else {
      writesSincePrune += 1
      triggerPruneSoon()
    }
    return true
  } catch (error) {
    // DATA_DIR missing/unwritable (read-only mount): fail-open, never throw,
    // never fall back to os.tmpdir() (fake durability).
    warnThrottled("write", error)
    return false
  } finally {
    activeWrites -= 1
  }
}

// --- Bounded retention (disk only; KV mode = no-op) --------------------------

export interface MdbRawPruneResult {
  removed: number
  kept: number
}

/**
 * Remove raw rating files past their absolute expiry and trim beyond the
 * retention caps (≤2000 entries, ≤16MiB by default) oldest-first. Scoped to
 * the mdblist-raw subdir and to `mdblist-raw-v1-*.json` names only: foreign
 * files are never touched. Bounded single pass over the WHOLE owned
 * namespace (no partial-scan blind spot: the subdir holds at most ~caps
 * files in steady state, so one readdir + one stat per owned file is the
 * bounded cost), disk only (KV mode = no-op). `kept` counts only files
 * actually still present (failed deletes stay counted as kept).
 *
 * I/O is bounded: one stat per candidate, and the envelope is parsed only
 * inside the ambiguous mtime window — files provably fresh for every TTL
 * (mtime < 24h) are kept without parsing, files past the longest TTL
 * (mtime > 7d) are dropped without parsing.
 */
export async function pruneMdbRawPersisted(
  opts?: { now?: number; maxFiles?: number; maxBytes?: number },
): Promise<MdbRawPruneResult> {
  const empty: MdbRawPruneResult = { removed: 0, kept: 0 }
  if (!isDiskPersistEnabled()) return empty
  const now = opts?.now ?? Date.now()
  const maxFiles = opts?.maxFiles ?? testPolicy?.maxFiles ?? MDB_RAW_PERSIST_MAX_FILES
  const maxBytes = opts?.maxBytes ?? testPolicy?.maxBytes ?? MDB_RAW_PERSIST_MAX_BYTES
  const dir = mdbRawPersistDir()
  let entries: string[]
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return empty
  }
  // Test-only deterministic pause AFTER the snapshot (before any scan or
  // delete): holds the prune open while the regression streams write
  // attempts. Fail-open on gate errors.
  if (pruneAfterSnapshotGateForTests) {
    try {
      await pruneAfterSnapshotGateForTests()
    } catch {
      // fail-open: a broken gate never blocks retention
    }
  }
  let removed = 0
  const live: Array<{ file: string; mtimeMs: number; size: number }> = []
  for (const entry of entries) {
    if (!FILE_NAME_RE.test(entry)) continue
    const full = path.join(dir, entry)
    try {
      const st = await fsp.stat(full)
      if (!st.isFile()) continue
      let expired: boolean
      if (st.size > MDB_RAW_PERSIST_MAX_ENVELOPE_BYTES) {
        expired = true
      } else if (now - st.mtimeMs > MDB_RAW_PERSIST_MAX_TTL_MS) {
        // Past the longest possible TTL: expired without parsing.
        expired = true
      } else if (st.mtimeMs <= now + MDB_RAW_PERSIST_FUTURE_SKEW_MS && now - st.mtimeMs < MDB_RAW_PERSIST_MIN_TTL_MS) {
        // Provably fresh for every admittable TTL (writes always create a
        // fresh file, reads never touch it): live without parsing.
        expired = false
      } else if (st.mtimeMs > now + MDB_RAW_PERSIST_FUTURE_SKEW_MS) {
        // Future-dated (skewed clock): keep, never delete on suspicion.
        expired = false
      } else {
        // Ambiguous window (24h–7d): the envelope decides (TTLs vary).
        try {
          const parsed: unknown = JSON.parse(await fsp.readFile(full, "utf-8"))
          if (
            typeof parsed !== "object" || parsed === null
            || (parsed as Record<string, unknown>).v !== 1
            || typeof (parsed as Record<string, unknown>).t !== "number"
            || !isValidTtl((parsed as Record<string, unknown>).ttl)
          ) {
            // Corrupt or out-of-policy envelope in our own scoped file: drop.
            expired = true
          } else {
            const rec = parsed as { t: number; ttl: number }
            expired = rec.t > now + MDB_RAW_PERSIST_FUTURE_SKEW_MS || now - rec.t >= rec.ttl
          }
        } catch {
          expired = true
        }
      }
      if (expired) {
        try {
          await fsp.unlink(full)
          removed++
        } catch {
          live.push({ file: entry, mtimeMs: st.mtimeMs, size: st.size })
        }
      } else {
        live.push({ file: entry, mtimeMs: st.mtimeMs, size: st.size })
      }
    } catch {
      continue
    }
  }
  let totalBytes = live.reduce((sum, c) => sum + c.size, 0)
  if (live.length > maxFiles || totalBytes > maxBytes) {
    // Oldest-first until BOTH caps hold (mtime tracks generation: writes
    // always create fresh files, reads never touch them).
    live.sort((a, b) => a.mtimeMs - b.mtimeMs)
    let kept = live.length
    for (const c of live) {
      if (kept <= maxFiles && totalBytes <= maxBytes) break
      try {
        await fsp.unlink(path.join(dir, c.file))
        removed++
        kept--
        totalBytes -= c.size
      } catch {
        // Delete failed: stays counted as kept.
      }
    }
    return { removed, kept }
  }
  return { removed, kept: live.length }
}

/** Write-triggered background prune — never on the read path, never awaited
 *  (no latency on the caller), at most one in flight, never an orphan
 *  rejection. Scheduled every PRUNE_EVERY_WRITES writes even when the idle
 *  throttle interval has not elapsed, so sustained write streams converge
 *  under the caps. While a prune runs, new writes are reservation-bounded
 *  (see setPersistedMdbRaw); writes that land during the prune mark a dirty
 *  tail that schedules exactly one follow-up prune — no rerun when nothing
 *  landed, so no infinite loop. */
function triggerPruneSoon(): void {
  try {
    if (!isDiskPersistEnabled()) return
  } catch {
    return
  }
  if (pruneInFlight) return
  const now = Date.now()
  const idleDue = now - lastPruneAt >= MDB_RAW_PERSIST_PRUNE_INTERVAL_MS
  const writesDue = writesSincePrune >= MDB_RAW_PERSIST_PRUNE_EVERY_WRITES
  if (!idleDue && !writesDue) return
  startPrune()
}

/** Launch one background prune (caller already decided it is due, or a
 *  dirty tail forces it). Resets both the cadence counter and the dirty
 *  tail at start; completion clears the in-flight flag and chains exactly
 *  one follow-up when writes landed mid-prune. */
function startPrune(): void {
  lastPruneAt = Date.now()
  writesSincePrune = 0
  pruneDirtyWrites = 0
  pruneAdmissionsDuringPrune = 0
  pruneInFlight = true
  const pending = pruneMdbRawPersisted().then(
    (result) => result,
    () => ({ removed: 0, kept: 0 }) as MdbRawPruneResult,
  )
  currentPrune = pending
  void pending.then(() => {
    if (currentPrune === pending) currentPrune = null
    pruneInFlight = false
    const dirty = pruneDirtyWrites
    pruneDirtyWrites = 0
    // Dirty tail (bounded ≤MAX_CONCURRENT_WRITES owned writers): files that
    // landed after the snapshot need one more pass. No successful write
    // during the prune → no rerun.
    if (dirty > 0) startPrune()
  })
}
