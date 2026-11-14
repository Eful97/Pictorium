import crypto from "node:crypto"
import fsp from "node:fs/promises"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"
import { cacheExpire } from "@/lib/cache"
import { userDir, userExists } from "@/lib/user-auth"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode } from "@/lib/kv"

const log = createLogger("user-activity")

// Lettura live (mai a module level): i test mutano le env + resetModules.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

function assertValidUserId(userId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
}

// ── lastAccess throttled (1/die) ─────────────────────────────────────────
// Traccia l'attività di lettura (catalog/meta/poster) per il cleanup degli
// inattivi. Throttle in memoria: al massimo una scrittura al giorno per
// utente, fire-and-forget (mai latenza né hard-fail sul path di lettura).

const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000
const TOUCH_CAP = 1000
const lastTouch = new Map<string, number>()

function activityFile(userId: string): string {
  return path.join(userDir(userId), "activity.json")
}

function activityKvKey(userId: string): string {
  return `user:${userId}:activity`
}

/** Durable "this space has been used" marker (KV, no TTL). The activity key
 * expires with the retention window, so its absence alone proves nothing. */
function usedKvKey(userId: string): string {
  return `user:${userId}:used`
}

async function persistActivity(userId: string, now: number): Promise<void> {
  // Solo spazi reali (v1.23.0): gli UUID inventati non devono creare
  // directory/chiavi orfane mai visibili al cleanup (crescita incontrollata).
  if (!(await userExists(userId))) return
  const payload = JSON.stringify({ lastAccess: new Date(now).toISOString() })
  if (isKvMode()) {
    // TTL = finestra retention (v1.23.0): oltre, il cleanup rimuoverebbe
    // comunque lo spazio — la chiave si auto-estingue senza cron. Con
    // retention disabilitata (0) cap a 1 anno: i dati restano utili allo
    // status ma smettono di accumularsi per sempre.
    await getKv().set(activityKvKey(userId), payload, { ex: activityTtlSec() })
    await getKv().set(usedKvKey(userId), "1")
    return
  }
  await fsp.mkdir(userDir(userId), { recursive: true })
  await atomicWriteFile(activityFile(userId), payload)
}

/** Registra attività di lettura (non bloccante, throttled 1/die). */
export function touchUserActivity(userId: string): void {
  try {
    const now = Date.now()
    const prev = lastTouch.get(userId)
    if (prev !== undefined && now - prev < TOUCH_INTERVAL_MS) return
    lastTouch.set(userId, now)
    if (lastTouch.size > TOUCH_CAP) {
      const oldest = lastTouch.keys().next().value
      if (oldest !== undefined) lastTouch.delete(oldest)
    }
    void persistActivity(userId, now).catch(() => {})
  } catch {
    /* mai rompere il path di lettura */
  }
}

// ── Inventario utenti ─────────────────────────────────────────────────────

export interface UserInfo {
  uuid: string
  /** ISO timestamp o null se mai registrato. */
  lastAccess: string | null
  /** Byte stimati dei file del namespace (file mode) o -1 (KV). */
  bytes: number
}

/** Finestra Weekly Active Users: 7 giorni. */
export const USER_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Quanti spazi sono attivi (lastAccess valido entro la finestra rispetto a
 * Date.now()). Stessa semantica inclusiva del cleanup (`>= cutoff`): senza
 * lastAccess noto o con data illeggibile lo spazio è dormiente, mai attivo.
 */
export function countActiveUsers(users: readonly UserInfo[], windowMs: number = USER_ACTIVE_WINDOW_MS): number {
  const cutoff = Date.now() - windowMs
  let active = 0
  for (const u of users) {
    if (!u.lastAccess) continue
    const last = Date.parse(u.lastAccess)
    if (Number.isFinite(last) && last >= cutoff) active++
  }
  return active
}

const UUID_RE = /^[0-9a-f-]{36}$/i

async function userDirBytes(dir: string): Promise<number> {
  try {
    const entries = await fsp.readdir(dir)
    let total = 0
    for (const e of entries) {
      try {
        const st = await fsp.stat(path.join(dir, e))
        if (st.isFile()) total += st.size
      } catch {
        /* race: file sparito nel mentre */
      }
    }
    return total
  } catch {
    return 0
  }
}

/**
 * True when there is any evidence the space was ever read by the addon:
 * the durable `used` marker or a live activity key (KV), or activity.json
 * (file mode, no TTL). Throws on read errors other than "absent", so a
 * degraded backend never makes a used space look unused.
 */
async function hasUsageEvidenceStrict(userId: string): Promise<boolean> {
  if (isKvMode()) {
    const kv = getKv()
    const used = await kv.get<unknown>(usedKvKey(userId))
    if (used !== null && used !== undefined) return true
    const act = await kv.get<unknown>(activityKvKey(userId))
    return act !== null && act !== undefined
  }
  try {
    await fsp.stat(activityFile(userId))
    return true
  } catch (e) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT") return false
    throw e
  }
}

const UNUSED_ARMED_KV_KEY = "instance:unused-user-cleanup-armed-at"

function unusedArmedFile(): string {
  return path.join(DATA_DIR, "instance", "unused-user-cleanup-armed.json")
}

/**
 * When the unused-space rule was first armed on this instance (ms), written on
 * the first cleanup run that has it enabled. Spaces are only removed once the
 * rule has been armed for a full grace period, so spaces that predate it (and
 * were used only through routes that did not record activity before) get a
 * full window to record usage. Null on any read/write error: skip this run.
 */
async function getUnusedRuleArmedAt(now: number): Promise<number | null> {
  try {
    if (isKvMode()) {
      const kv = getKv()
      const raw = await kv.get<unknown>(UNUSED_ARMED_KV_KEY)
      if (raw !== null && raw !== undefined) {
        const t = Date.parse(String(raw))
        return Number.isFinite(t) ? t : null
      }
      await kv.set(UNUSED_ARMED_KV_KEY, new Date(now).toISOString())
      return now
    }
    try {
      const parsed = JSON.parse(await fsp.readFile(unusedArmedFile(), "utf-8")) as { armedAt?: unknown }
      const t = typeof parsed.armedAt === "string" ? Date.parse(parsed.armedAt) : NaN
      return Number.isFinite(t) ? t : null
    } catch (e) {
      if (!(e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT")) return null
    }
    await fsp.mkdir(path.dirname(unusedArmedFile()), { recursive: true })
    await atomicWriteFile(unusedArmedFile(), JSON.stringify({ armedAt: new Date(now).toISOString() }))
    return now
  } catch (e) {
    log.warn("unused-user cleanup arm marker unavailable, skipping unused rule", {
      error: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

async function readLastAccessFile(userId: string): Promise<string | null> {
  try {
    const raw = await fsp.readFile(activityFile(userId), "utf-8")
    const parsed = JSON.parse(raw) as { lastAccess?: unknown }
    if (typeof parsed.lastAccess === "string" && parsed.lastAccess) return parsed.lastAccess
  } catch {
    /* assente o illeggibile */
  }
  // Fallback: mtime di auth.json (creazione utente) come ultima attività nota.
  try {
    const st = await fsp.stat(path.join(userDir(userId), "auth.json"))
    return st.mtime.toISOString()
  } catch {
    return null
  }
}

/** Elenca i namespace utente (file mode; KV best-effort). Mai dati sensibili. */
export async function listUsers(): Promise<UserInfo[]> {
  if (isKvMode()) return listUsersKv()
  let entries: string[]
  try {
    entries = await fsp.readdir(path.join(DATA_DIR, "users"))
  } catch {
    return []
  }
  const out: UserInfo[] = []
  for (const uuid of entries) {
    if (!UUID_RE.test(uuid)) continue
    const dir = path.join(DATA_DIR, "users", uuid)
    try {
      const st = await fsp.stat(dir)
      if (!st.isDirectory()) continue
    } catch {
      continue
    }
    out.push({ uuid, lastAccess: await readLastAccessFile(uuid), bytes: await userDirBytes(dir) })
  }
  return out
}

async function listUsersKv(): Promise<UserInfo[]> {
  try {
    const kv = getKv()
    const uuids = new Set<string>()
    let cursor = 0
    do {
      const [next, keys] = await kv.scan(cursor, { match: "user:*:auth", count: 100 })
      cursor = next
      for (const k of keys ?? []) {
        const m = /^user:([0-9a-f-]{36}):auth$/i.exec(k)
        if (m?.[1]) uuids.add(m[1].toLowerCase())
      }
    } while (cursor !== 0)
    const out: UserInfo[] = []
    for (const uuid of uuids) {
      let lastAccess: string | null = null
      try {
        const raw = await kv.get<string>(activityKvKey(uuid))
        if (typeof raw === "string") {
          const parsed = JSON.parse(raw) as { lastAccess?: unknown }
          if (typeof parsed.lastAccess === "string" && parsed.lastAccess) lastAccess = parsed.lastAccess
        } else if (raw && typeof raw === "object") {
          const parsed = raw as { lastAccess?: unknown }
          if (typeof parsed.lastAccess === "string" && parsed.lastAccess) lastAccess = parsed.lastAccess
        }
      } catch {
        /* ignora */
      }
      out.push({ uuid, lastAccess, bytes: -1 })
    }
    return out
  } catch (e) {
    log.warn("user list KV scan failed", { error: e instanceof Error ? e.message : String(e) })
    return []
  }
}

// ── Wipe account (GDPR) ───────────────────────────────────────────────────

const USER_KV_KEYS = ["auth", "keys", "activity", "used", "trakt"] as const

/** Cancella integralmente un namespace (dati + epoch). Ritorna i byte liberati (file) o -1 (KV). */
export async function deleteUser(userId: string): Promise<number> {
  assertValidUserId(userId)
  // Evict in-process PRIMA di cancellare: niente snapshot stantii dopo il wipe.
  const { __evictUserStoreCache } = await import("@/lib/store")
  const { __evictUserDefaultsCache } = await import("@/lib/server-defaults")
  const { __evictUserEpochCache } = await import("@/lib/catalog-epoch")
  __evictUserStoreCache(userId)
  __evictUserDefaultsCache(userId)
  __evictUserEpochCache(userId)
  // Task 3 fencing: bump the Trakt generation FIRST so an in-flight
  // callback exchange or refresh save (which captured the old generation
  // before its network round-trip) aborts at the storage boundary instead
  // of recreating the namespace. Then serialize the actual deletes under
  // the profile lock when free (best-effort: contention or a lock outage
  // must never fail the wipe — fencing already protects the writers).
  const { acquireTraktProfileLock, bumpTraktGeneration, clearTraktGeneration } = await import(
    "@/lib/trakt-profile-lock"
  )
  try {
    await bumpTraktGeneration(userId)
  } catch (e) {
    log.warn("user wipe trakt fence failed (best-effort)", { error: e instanceof Error ? e.message : String(e) })
  }
  let traktLock: { release(): Promise<void> } | null = null
  try {
    traktLock = await acquireTraktProfileLock(userId, { waitMs: 5000 })
  } catch {
    traktLock = null
  }
  try {
    if (isKvMode()) {
      const kv = getKv()
      const keys = [
        ...USER_KV_KEYS.map((k) => `user:${userId}:${k}`),
        `user:${userId}:trakt:gen`,
        // NOTE: the lock key (`user:<uuid>:trakt:lock`) is deliberately NOT
        // deleted: it may be held by a live refresh worker, and deleting
        // another holder's mutex lets two writers coexist. The orphaned key
        // holds no tokens and expires via its server-side TTL.
        `mappings:${userId}`,
        `defaults:${userId}`,
        `catalog_epoch:${userId}`,
      ]
      for (const k of keys) {
        try {
          await kv.del(k)
        } catch (e) {
          log.warn("user wipe KV del failed", { error: e instanceof Error ? e.message : String(e) })
        }
      }
      lastTouch.delete(userId)
      expireUserCache(userId)
      log.info("User wiped", { uuid: userId })
      return -1
    }
    const dir = userDir(userId)
    const bytes = await userDirBytes(dir)
    await fsp.rm(dir, { recursive: true, force: true })
    // Generation sidecar lives inside the namespace: already removed with it
    // (GDPR-clean, no tombstone). Lock files live OUTSIDE the namespace and
    // are deliberately LEFT ALONE: unlinking them under a running service
    // could destroy a live refresh worker's mutex (two writers coexist).
    // Orphaned lock files hold no tokens; file-mode orphans are removed by
    // the documented manual procedure (service stopped), KV orphans expire
    // via TTL. A post-wipe save is still stopped by the existence check +
    // the no-mkdir write rule (same-UUID recreation is impossible in
    // practice — createUser mints a fresh randomUUID).
    await clearTraktGeneration(userId)
    lastTouch.delete(userId)
    expireUserCache(userId)
    log.info("User wiped", { uuid: userId })
    return bytes
  } finally {
    if (traktLock) await traktLock.release()
  }
}

/**
 * Scade le entry di cache in-process del namespace (catalog/meta `:u<sha1>` +
 * poster `:u<md5>`). La L2 KV (quando attiva) resta fino a EX — residuo
 * documentato: le URL scadono comunque verso render senza mapping (no leak).
 */
export function expireUserCache(userId: string): number {
  const sha1 = crypto.createHash("sha1").update(userId).digest("hex").slice(0, 8)
  const md5 = crypto.createHash("md5").update(userId).digest("hex").slice(0, 8)
  return cacheExpire(`:u${sha1}`) + cacheExpire(`:u${md5}`)
}

// ── Cleanup inattivi ──────────────────────────────────────────────────────

export function getUserRetentionDays(): number {
  const raw = envWithFallback("USER_RETENTION_DAYS")
  if (raw === undefined) return 180
  const n = parseInt(raw, 10)
  if (raw.trim() === "0") return 0
  return Number.isFinite(n) && n > 0 ? n : 180
}

/** TTL (secondi) delle chiavi activity in KV: finestra retention, cap 1 anno se disabilitata. */
export function activityTtlSec(retentionDays = getUserRetentionDays()): number {
  return (retentionDays > 0 ? retentionDays : 365) * 24 * 60 * 60
}

/**
 * Grace period (days) after which a space that was never used is removed by
 * the cleanup. "Never used" = no recorded addon activity (catalog, meta,
 * poster) since creation AND no saved API keys. Env
 * PICTORIUM_UNUSED_USER_GRACE_DAYS, default 14, `0` = never. The rule takes
 * effect one grace period after the first cleanup run that has it enabled.
 * Without this, KV spaces created and abandoned have no lastAccess and are
 * kept forever, filling PICTORIUM_MAX_USERS on public instances.
 */
export function getUnusedUserGraceDays(): number {
  const raw = envWithFallback("UNUSED_USER_GRACE_DAYS")
  if (raw === undefined || raw.trim() === "") return 14
  if (raw.trim() === "0") return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 14
}

/** True only when every check positively says the space was never used (fails safe). */
async function isUnusedSpace(userId: string, createdCutoff: number): Promise<boolean> {
  const { getUserCreatedAt } = await import("@/lib/user-auth")
  const { hasStoredUserKeys } = await import("@/lib/user-keys")
  const createdAt = await getUserCreatedAt(userId)
  const created = createdAt ? Date.parse(createdAt) : NaN
  if (!Number.isFinite(created) || created >= createdCutoff) return false
  try {
    if (await hasUsageEvidenceStrict(userId)) return false
  } catch {
    return false
  }
  if (await hasStoredUserKeys(userId)) return false
  return true
}

export interface CleanupResult {
  removed: number
  /** Subset of `removed`: spaces never used within the grace period. */
  removedUnused: number
  kept: number
  disabled: boolean
  freedBytes: number
}

/**
 * Rimuove i namespace senza attività da più di `retentionDays` (default 180,
 * env PICTORIUM_USER_RETENTION_DAYS, `0` = mai). Senza lastAccess noto il
 * namespace è tenuto (safe). Solo log aggregati + uuid rimossi.
 */
export async function cleanupInactiveUsers(retentionDays = getUserRetentionDays()): Promise<CleanupResult> {
  if (!retentionDays || retentionDays <= 0) {
    return { removed: 0, removedUnused: 0, kept: 0, disabled: true, freedBytes: 0 }
  }
  const now = Date.now()
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  const graceDays = getUnusedUserGraceDays()
  const unusedCutoff = now - graceDays * 24 * 60 * 60 * 1000
  const armedAt = graceDays > 0 ? await getUnusedRuleArmedAt(now) : null
  const unusedRuleLive = armedAt !== null && armedAt < unusedCutoff
  const users = await listUsers()
  let removed = 0
  let removedUnused = 0
  let kept = 0
  let freedBytes = 0
  for (const u of users) {
    const last = u.lastAccess ? Date.parse(u.lastAccess) : NaN
    const inactive = Number.isFinite(last) && last < cutoff
    const unused = !inactive && unusedRuleLive && (await isUnusedSpace(u.uuid, unusedCutoff))
    if (!inactive && !unused) {
      kept++
      continue
    }
    try {
      const freed = await deleteUser(u.uuid)
      if (freed > 0) freedBytes += freed
      removed++
      if (unused) {
        removedUnused++
        log.info("Unused user cleaned up", { uuid: u.uuid })
      } else {
        log.info("Inactive user cleaned up", { uuid: u.uuid, lastAccess: u.lastAccess })
      }
    } catch (e) {
      log.warn("user cleanup failed", { error: e instanceof Error ? e.message : String(e) })
      kept++
    }
  }
  log.info("User cleanup done", { removed, removedUnused, kept, retentionDays, unusedGraceDays: graceDays })
  return { removed, removedUnused, kept, disabled: false, freedBytes }
}
