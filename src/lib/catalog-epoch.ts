import fsp from "node:fs/promises"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode } from "@/lib/kv"

/**
 * Epoch globale dei cataloghi Stremio (F3).
 *
 * La cache dei cataloghi è in-process (`lib/cache.ts`) con refresh schedulato:
 * su deploy multi-istanza (Vercel serverless) l'invalidazione locale
 * `cacheInvalidate("stremio")` non raggiunge le altre istanze e il cambio
 * poster / cambio default resta invisibile fino a ~24h. Includendo questa epoch
 * nel cache key del catalogo, ogni save (mapping o defaults) cambia la chiave
 * su TUTTE le istanze entro il TTL di lettura — invalidazione cross-instance
 * senza refactor della cache.
 *
 * L'epoch è un token opaco che cambia a ogni bump (timestamp + random: niente
 * race read-modify-write tra istanze). Persistenza file (single-instance) o KV
 * (Redis nativo o Vercel KV/Upstash via `lib/kv.ts`), stessi pattern di `lib/store.ts`.
 */

const log = createLogger("catalog-epoch")

// Lettura live (mai a module level): i test mutano le env + resetModules,
// e il backend va rivalutato a ogni chiamata come prima con `useKv`.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}

const KV_KEY = "catalog_epoch"
const FILE = path.join(DATA_DIR, "catalog-epoch.json")

// TTL lettura: speculare a store.ts (500ms, 0 nei test per determinismo).
const READ_TTL_MS = process.env.NODE_ENV === "test" ? 0 : 500
let memCache: string | null = null
let memCacheAt = 0

function newEpoch(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

async function readFromDisk(): Promise<string | null> {
  try {
    const raw = await fsp.readFile(FILE, "utf-8")
    const data = JSON.parse(raw) as { epoch?: unknown }
    return typeof data.epoch === "string" && data.epoch ? data.epoch : null
  } catch {
    return null
  }
}

async function kvRead(): Promise<string | null> {
  try {
    const raw = await getKv().get<string>(KV_KEY)
    return typeof raw === "string" && raw ? raw : null
  } catch (e) {
    log.warn("epoch KV read failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Epoch corrente ("0" se mai impostata). Lettura cachata a finestra breve:
 * il costo per richiesta catalogo è uno stat file / get KV al massimo ogni
 * 500ms, come per i mapping.
 *
 * `userId` null = epoch globale. Con userId = epoch del namespace (isolata:
 * il save di A non invalida la cache di B).
 */
export async function getCatalogEpoch(userId?: string | null): Promise<string> {
  if (userId) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
    return getUserEpoch(userId)
  }
  const now = Date.now()
  if (memCache !== null && now - memCacheAt < READ_TTL_MS) return memCache
  const stored = isKvMode() ? await kvRead() : await readFromDisk()
  memCache = stored ?? "0"
  memCacheAt = Date.now()
  return memCache
}

/**
 * Fa avanzare l'epoch (da chiamare su ogni scrittura mapping/defaults).
 * Aggiorna subito la mem-cache locale così l'istanza che scrive non serve
 * stale nemmeno dentro la finestra TTL.
 *
 * `userId` null = epoch globale. Con userId = solo il namespace.
 */
export async function bumpCatalogEpoch(userId?: string | null): Promise<string> {
  if (userId) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
    return bumpUserEpoch(userId)
  }
  const next = newEpoch()
  try {
    if (isKvMode()) {
      await getKv().set(KV_KEY, next)
    } else {
      await fsp.mkdir(DATA_DIR, { recursive: true })
      await atomicWriteFile(FILE, JSON.stringify({ epoch: next }))
    }
  } catch (e) {
    // L'epoch è un'ottimizzazione di invalidazione, mai un hard-fail del save:
    // se la persist fallisce, la cache in-process resta comunque invalidata.
    log.warn("epoch persist failed", { error: e instanceof Error ? e.message : String(e) })
    return memCache ?? "0"
  }
  memCache = next
  memCacheAt = Date.now()
  return next
}

// ---- Epoch per-utente (multi-user) ----
// Stesso pattern del globale con cap LRU sul numero di namespace in memoria.

const userEpochCache = new Map<string, { epoch: string; at: number }>()
const USER_EPOCH_CAP = 500

function userEpochFile(userId: string): string {
  return path.join(DATA_DIR, "users", userId, "epoch.json")
}

function userEpochKvKey(userId: string): string {
  return `catalog_epoch:${userId}`
}

async function getUserEpoch(userId: string): Promise<string> {
  const now = Date.now()
  const hit = userEpochCache.get(userId)
  if (hit && now - hit.at < READ_TTL_MS) {
    userEpochCache.delete(userId)
    userEpochCache.set(userId, hit)
    return hit.epoch
  }
  let stored: string | null = null
  if (isKvMode()) {
    try {
      const raw = await getKv().get<string>(userEpochKvKey(userId))
      stored = typeof raw === "string" && raw ? raw : null
    } catch (e) {
      log.warn("user epoch KV read failed", { error: e instanceof Error ? e.message : String(e) })
    }
  } else {
    try {
      const raw = await fsp.readFile(userEpochFile(userId), "utf-8")
      const data = JSON.parse(raw) as { epoch?: unknown }
      stored = typeof data.epoch === "string" && data.epoch ? data.epoch : null
    } catch {
      stored = null
    }
  }
  const epoch = stored ?? "0"
  if (userEpochCache.size >= USER_EPOCH_CAP) {
    const oldest = userEpochCache.keys().next().value
    if (oldest !== undefined) userEpochCache.delete(oldest)
  }
  userEpochCache.set(userId, { epoch, at: Date.now() })
  return epoch
}

async function bumpUserEpoch(userId: string): Promise<string> {
  const next = newEpoch()
  try {
    if (isKvMode()) {
      await getKv().set(userEpochKvKey(userId), next)
    } else {
      await fsp.mkdir(path.dirname(userEpochFile(userId)), { recursive: true })
      await atomicWriteFile(userEpochFile(userId), JSON.stringify({ epoch: next }))
    }
  } catch (e) {
    log.warn("user epoch persist failed", { error: e instanceof Error ? e.message : String(e) })
    return userEpochCache.get(userId)?.epoch ?? "0"
  }
  if (userEpochCache.size >= USER_EPOCH_CAP) {
    const oldest = userEpochCache.keys().next().value
    if (oldest !== undefined) userEpochCache.delete(oldest)
  }
  userEpochCache.set(userId, { epoch: next, at: Date.now() })
  return next
}

/** Evict della cache epoch del namespace (wipe account). Solo test + user-activity. */
export function __evictUserEpochCache(userId: string): void {
  userEpochCache.delete(userId)
}
