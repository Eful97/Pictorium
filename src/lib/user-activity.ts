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

const USER_KV_KEYS = ["auth", "keys", "activity"] as const

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
  if (isKvMode()) {
    const kv = getKv()
    const keys = [
      ...USER_KV_KEYS.map((k) => `user:${userId}:${k}`),
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
  lastTouch.delete(userId)
  expireUserCache(userId)
  log.info("User wiped", { uuid: userId })
  return bytes
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

export interface CleanupResult {
  removed: number
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
    return { removed: 0, kept: 0, disabled: true, freedBytes: 0 }
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const users = await listUsers()
  let removed = 0
  let kept = 0
  let freedBytes = 0
  for (const u of users) {
    const last = u.lastAccess ? Date.parse(u.lastAccess) : NaN
    if (!Number.isFinite(last) || last >= cutoff) {
      kept++
      continue
    }
    try {
      const freed = await deleteUser(u.uuid)
      if (freed > 0) freedBytes += freed
      removed++
      log.info("Inactive user cleaned up", { uuid: u.uuid, lastAccess: u.lastAccess })
    } catch (e) {
      log.warn("user cleanup failed", { error: e instanceof Error ? e.message : String(e) })
      kept++
    }
  }
  log.info("User cleanup done", { removed, kept, retentionDays })
  return { removed, kept, disabled: false, freedBytes }
}
