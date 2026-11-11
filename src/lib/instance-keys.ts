/**
 * Instance-level API keys (single-user deployments), server-only.
 *
 * Dedicated store for the keys an operator configures once through the app
 * (Settings → API keys, follow-up UI) so pristine Docker / Stremio requests
 * can render catalogs and posters with ZERO `PICTORIUM_*_KEY` env vars. It is
 * deliberately separate from the per-namespace store (`user-keys.ts`): the
 * instance store belongs to the deployment, the namespace store to a space.
 *
 * Storage: KV `instance:keys` when a KV backend is configured, otherwise
 * `DATA_DIR/instance/keys.json` (atomic write, mode 0600). Values are NEVER
 * stored in plaintext: the same AES-256-GCM primitives as namespace keys
 * (`encryptProfileSecret`/`decryptProfileSecret`). Encryption material:
 * `PROFILE_ENCRYPTION_KEY` when present, otherwise a generated 32-byte key
 * persisted as `DATA_DIR/instance/enc.key` (0600) or KV `instance:enc`. If the
 * generated key cannot be persisted the save fails closed with
 * `InstanceKeysUnavailableError` — plaintext is never an option.
 *
 * Every kind records its key provenance (`profile`/`instance`), so setting
 * `PROFILE_ENCRYPTION_KEY` later does not orphan keys written before it and
 * rotating/removing it only affects the keys it actually protected.
 *
 * Reads are cached with a bounded revalidation window (30s in production, 0
 * under Vitest) plus in-process invalidation on write: the catalog/poster hot
 * path never touches disk on every request, while `getInstanceKeyStatus()`
 * (admin/UI surface) always re-reads the store. This mirrors the
 * `server-defaults` hot/checked split; the record carries a monotonic
 * `revision` bumped on every write.
 *
 * Security: no value is ever logged, returned by the status API, put in a URL
 * or used as a cache key. `getInstanceKeyStatus()` exposes booleans plus
 * `{storage, writable, decryptable}` only; a stored value leaves the server
 * exclusively through `revealInstanceKey()` (explicit admin/PIN-gated request,
 * JSON body, `Cache-Control: no-store`).
 */
import crypto from "node:crypto"
import fsp from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode } from "@/lib/kv"
import { createLogger } from "@/lib/logger"
import {
  decryptProfileSecret,
  encryptProfileSecret,
  isValidEncBundle,
  profileEncryptionKey,
  type EncBundle,
} from "@/lib/profile-crypto"
import { InvalidUserKeyError, USER_KEY_KINDS, type UserKeyKind } from "@/lib/user-keys"

const log = createLogger("instance-keys")

/** Save refused: storage and/or encryption material cannot be persisted. */
export class InstanceKeysUnavailableError extends Error {
  constructor() {
    super("Instance API-key storage is unavailable: cannot persist encryption material (check DATA_DIR write permissions or the KV configuration)")
    this.name = "InstanceKeysUnavailableError"
  }
}

export type InstanceKeys = Partial<Record<UserKeyKind, string>>

export interface InstanceKeysStatus {
  tmdb: boolean
  mdblist: boolean
  tvdb: boolean
  simkl: boolean
  fanart: boolean
  storage: "kv" | "file"
  /** The store can accept writes (KV configured, or the file dir is writable). */
  writable: boolean
  /** Every stored bundle decrypts with the current key material. */
  decryptable: boolean
}

type KeySource = "profile" | "instance"

interface InstanceKeysRecord {
  version: 1
  keys: Partial<Record<UserKeyKind, EncBundle>>
  /** Per-kind provenance of the key that encrypted the bundle. */
  keySources?: Partial<Record<UserKeyKind, KeySource>>
  /** Monotonic write counter (diagnostics; never contains secrets). */
  revision: number
  updatedAt: string
}

const KEYS_KV = "instance:keys"
const ENC_KV = "instance:enc"
const MAX_KEY_LENGTH = 256
/** Bounded staleness for the hot path: a local write always invalidates. */
const CACHE_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 30_000

function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

// Function (not module const): DATA_DIR can be replaced by tests before the
// first use, and never becomes a stale path captured at import time.
function instanceDir(): string {
  return path.join(DATA_DIR, "instance")
}

function keysFile(): string {
  return path.join(instanceDir(), "keys.json")
}

function encKeyFile(): string {
  return path.join(instanceDir(), "enc.key")
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}

function isValidRecord(value: unknown): value is InstanceKeysRecord {
  if (!value || typeof value !== "object") return false
  const v = value as Partial<InstanceKeysRecord>
  return v.version === 1 && !!v.keys && typeof v.keys === "object"
}

function presenceOf(record: InstanceKeysRecord | null): Record<UserKeyKind, boolean> {
  return {
    tmdb: isValidEncBundle(record?.keys.tmdb),
    mdblist: isValidEncBundle(record?.keys.mdblist),
    tvdb: isValidEncBundle(record?.keys.tvdb),
    simkl: isValidEncBundle(record?.keys.simkl),
    fanart: isValidEncBundle(record?.keys.fanart),
  }
}

async function readRecord(): Promise<InstanceKeysRecord | null> {
  if (isKvMode()) {
    try {
      const raw = await getKv().get<InstanceKeysRecord>(KEYS_KV)
      return isValidRecord(raw) ? raw : null
    } catch (error) {
      log.warn("Instance keys KV read failed", { error: errMessage(error) })
      return null
    }
  }
  try {
    const raw = await fsp.readFile(keysFile(), "utf-8")
    const parsed = JSON.parse(raw) as unknown
    return isValidRecord(parsed) ? parsed : null
  } catch (error) {
    if (!isEnoent(error)) log.warn("Instance keys read failed", { error: errMessage(error) })
    return null
  }
}

/** Persisted generated instance key (memory-cached per process). */
let generatedKeyCache: Buffer | null = null

function parseKeyHex(raw: unknown): Buffer | null {
  if (typeof raw !== "string") return null
  const value = raw.trim()
  if (!/^[0-9a-f]{64}$/i.test(value)) return null
  return Buffer.from(value, "hex")
}

/** Read-only lookup: never creates key material on a catalog/poster request. */
async function readGeneratedKey(): Promise<Buffer | null> {
  if (generatedKeyCache) return generatedKeyCache
  if (isKvMode()) {
    try {
      const raw = await getKv().get<unknown>(ENC_KV)
      const key = parseKeyHex(raw)
      if (key) generatedKeyCache = key
      return key
    } catch (error) {
      log.warn("Instance encryption key KV read failed", { error: errMessage(error) })
      return null
    }
  }
  try {
    const key = parseKeyHex(await fsp.readFile(encKeyFile(), "utf-8"))
    if (key) generatedKeyCache = key
    return key
  } catch (error) {
    if (!isEnoent(error)) log.warn("Instance encryption key read failed", { error: errMessage(error) })
    return null
  }
}

/**
 * Get-or-create the generated key. Used only by writes: persistence failure
 * propagates so the caller can refuse the save (never plaintext).
 */
async function ensureGeneratedKey(): Promise<Buffer> {
  const existing = await readGeneratedKey()
  if (existing) return existing
  const key = crypto.randomBytes(32)
  if (isKvMode()) {
    await getKv().set(ENC_KV, key.toString("hex"))
  } else {
    await fsp.mkdir(instanceDir(), { recursive: true, mode: 0o700 })
    await atomicWriteFile(encKeyFile(), key.toString("hex"), { mode: 0o600 })
  }
  generatedKeyCache = key
  return key
}

function decryptCandidates(source: KeySource | undefined, profile: Buffer | null, generated: Buffer | null): Buffer[] {
  if (source === "profile") return profile ? [profile] : generated ? [generated] : []
  if (source === "instance") return generated ? [generated] : profile ? [profile] : []
  // Legacy/unknown provenance: try both (bounded, no recursion).
  return [profile, generated].filter((k): k is Buffer => k !== null)
}

async function decryptRecord(record: InstanceKeysRecord | null): Promise<{ keys: InstanceKeys; decryptable: boolean }> {
  const keys: InstanceKeys = {}
  if (!record) return { keys, decryptable: true }
  const profile = profileEncryptionKey()
  const generated = await readGeneratedKey()
  let decryptable = true
  for (const kind of USER_KEY_KINDS) {
    const bundle = record.keys[kind]
    if (!isValidEncBundle(bundle)) continue
    let value: string | null = null
    for (const candidate of decryptCandidates(record.keySources?.[kind], profile, generated)) {
      try {
        value = decryptProfileSecret(bundle, candidate)
        break
      } catch {
        // Try the other provenance; only a total miss is reported below.
      }
    }
    if (value) keys[kind] = value
    else {
      decryptable = false
      // Kind only: a value never reaches the log.
      log.error("Instance key failed to decrypt — treating as missing", { kind })
    }
  }
  return { keys, decryptable }
}

interface CachedState {
  keys: InstanceKeys
  presence: Record<UserKeyKind, boolean>
  decryptable: boolean
  loadedAt: number
  revision: number
}

let cachedState: CachedState | null = null
let reloadPromise: Promise<CachedState> | null = null

async function loadState(fresh: boolean): Promise<CachedState> {
  const now = Date.now()
  if (!fresh && cachedState && now - cachedState.loadedAt < CACHE_TTL_MS) return cachedState
  if (reloadPromise) return reloadPromise
  reloadPromise = (async () => {
    const record = await readRecord()
    const { keys, decryptable } = await decryptRecord(record)
    const state: CachedState = {
      keys,
      presence: presenceOf(record),
      decryptable,
      loadedAt: Date.now(),
      revision: record?.revision ?? 0,
    }
    cachedState = state
    return state
  })().finally(() => {
    reloadPromise = null
  })
  return reloadPromise
}

/**
 * Decrypted instance keys (hot path: catalogs, posters, meta). Degrades to an
 * empty object on any storage failure — an outage never breaks serving, the
 * request simply falls through to the namespace/env ladder.
 */
export async function getInstanceKeys(): Promise<InstanceKeys> {
  try {
    const state = await loadState(false)
    return { ...state.keys }
  } catch (error) {
    log.warn("Instance keys unavailable — resolving without them", { error: errMessage(error) })
    return {}
  }
}

async function probeWritable(): Promise<boolean> {
  if (isKvMode()) return true
  try {
    await fsp.mkdir(instanceDir(), { recursive: true, mode: 0o700 })
    await fsp.access(instanceDir(), fsConstants.W_OK)
    return true
  } catch {
    // Honest flag only: the status call is frequent (defaults/UI). The write
    // path logs the real error when a save is refused.
    return false
  }
}

/**
 * Presence + storage health. Always re-reads the store (UI/admin surface) and
 * NEVER returns values: a boolean per kind plus `{storage, writable,
 * decryptable}`.
 */
export async function getInstanceKeyStatus(): Promise<InstanceKeysStatus> {
  const state = await loadState(true)
  return {
    ...state.presence,
    storage: getStorageMode(),
    writable: await probeWritable(),
    decryptable: state.decryptable,
  }
}

/**
 * Explicit single-key reveal for the authenticated admin surface
 * (`POST /api/instance-keys/reveal`): the ONLY path that returns a stored
 * instance value. Always re-reads the store, never caches, never logs (not
 * even the kind) and returns null for an unknown or unreadable kind — the
 * caller maps that to 404 without inventing a value.
 */
export async function revealInstanceKey(kind: string): Promise<string | null> {
  if (!(USER_KEY_KINDS as readonly string[]).includes(kind)) return null
  const state = await loadState(true)
  return state.keys[kind as UserKeyKind] ?? null
}

function normalizeKeyInput(kind: string, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "string") throw new InvalidUserKeyError(kind)
  const value = raw.trim()
  if (!value) return null
  if (value.length > MAX_KEY_LENGTH || /\s/.test(value)) throw new InvalidUserKeyError(kind)
  return value
}

async function persistRecord(record: InstanceKeysRecord): Promise<void> {
  if (isKvMode()) {
    await getKv().set(KEYS_KV, record)
    return
  }
  await fsp.mkdir(instanceDir(), { recursive: true, mode: 0o700 })
  await atomicWriteFile(keysFile(), JSON.stringify(record), { mode: 0o600 })
}

// Serialize read-modify-write so two concurrent admin saves cannot drop a kind.
let writeChain: Promise<unknown> = Promise.resolve()

async function applyPatch(input: Partial<Record<UserKeyKind, unknown>>): Promise<void> {
  const writes: Partial<Record<UserKeyKind, string>> = {}
  const deletes: UserKeyKind[] = []
  for (const kind of USER_KEY_KINDS) {
    if (!(kind in input)) continue
    const normalized = normalizeKeyInput(kind, input[kind])
    if (normalized === null) deletes.push(kind)
    else writes[kind] = normalized
  }

  const current = (await readRecord()) ?? { version: 1 as const, keys: {}, revision: 0, updatedAt: "" }
  const next: InstanceKeysRecord = {
    version: 1,
    keys: { ...current.keys },
    revision: (current.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  const keySources = { ...(current.keySources ?? {}) }
  for (const kind of deletes) {
    delete next.keys[kind]
    delete keySources[kind]
  }
  if (Object.keys(writes).length > 0) {
    const profile = profileEncryptionKey()
    let key: Buffer
    let source: KeySource
    if (profile) {
      key = profile
      source = "profile"
    } else {
      try {
        key = await ensureGeneratedKey()
      } catch (error) {
        log.error("Instance key encryption material cannot be persisted — save refused", { error: errMessage(error) })
        throw new InstanceKeysUnavailableError()
      }
      source = "instance"
    }
    for (const [kind, value] of Object.entries(writes) as [UserKeyKind, string][]) {
      next.keys[kind] = encryptProfileSecret(value, key)
      keySources[kind] = source
    }
  }
  if (Object.keys(keySources).length > 0) next.keySources = keySources
  try {
    await persistRecord(next)
  } catch (error) {
    log.error("Instance keys write failed", { error: errMessage(error) })
    throw new InstanceKeysUnavailableError()
  }
  cachedState = null
  // Kinds only: `-kind` = cleared, plain kind = set. Values never logged.
  log.info("Instance keys updated", {
    kinds: [...Object.keys(writes), ...deletes.map((k) => `-${k}`)],
    revision: next.revision,
  })
}

/**
 * Merge patch: a string sets (trimmed, 1..256 chars, no whitespace), `""`/
 * `null` clears, an absent kind is unchanged. Throws `InvalidUserKeyError`
 * for bad input and `InstanceKeysUnavailableError` when the encrypted store
 * cannot be persisted (fail-closed: never plaintext).
 */
export async function setInstanceKeys(input: Partial<Record<UserKeyKind, unknown>>): Promise<void> {
  const run = writeChain.then(() => applyPatch(input))
  writeChain = run.catch(() => {})
  return run
}

