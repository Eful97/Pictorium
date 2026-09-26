import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"

const log = createLogger("kv")

/**
 * Storage Key-Value unificato (Step 1: solo definizione + selezione backend).
 *
 * Nessun consumer migrato in questo step: i moduli esistenti continuano a
 * importare `@vercel/kv` direttamente. Questo modulo è usato solo dal suo
 * unit test finché lo Step 2 non migra il primo consumer (`catalog-epoch`).
 *
 * Backend (precedenza):
 *  1. Redis nativo (`PICTORIUM_REDIS_URL`, fallback `POSTERIUM_REDIS_URL`,
 *     fallback `REDIS_URL` nudo per ElfHosted) via `ioredis` (TCP).
 *  2. Vercel KV / Upstash (`KV_REST_API_URL` + `KV_REST_API_TOKEN`) via REST.
 *  3. Altrimenti filesystem locale (i caller usano il ramo file esistente).
 *
 * `getStorageMode()` resta rigorosamente `"kv" | "file"` (contratto di
 * `store.ts`/`health/route.ts`): Redis conta come `"kv"`. La distinzione
 * redis-vs-upstash è solo diagnostica (`getStorageBackend()`).
 */

export interface KvClient {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<void>
  del(key: string): Promise<number>
  hgetall<T = Record<string, unknown>>(key: string): Promise<T | null>
  hset(key: string, obj: Record<string, unknown>): Promise<number>
  hdel(key: string, ...fields: string[]): Promise<number>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  scan(cursor: number, opts?: { match?: string; count?: number }): Promise<[number, string[]]>
}

/** URL Redis: canonico PICTORIUM > legacy POSTERIUM > nudo (ElfHosted). */
export function resolveRedisUrl(): string | undefined {
  const configured = envWithFallback("REDIS_URL") ?? process.env.REDIS_URL
  const trimmed = configured?.trim()
  return trimmed ? trimmed : undefined
}

export function isRedisConfigured(): boolean {
  return resolveRedisUrl() !== undefined
}

export function isKvConfigured(): boolean {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
}

/** Contratto storico: solo "kv" | "file" (Redis conta come "kv"). */
export function getStorageMode(): "kv" | "file" {
  return isRedisConfigured() || isKvConfigured() ? "kv" : "file"
}

/** Diagnostica (solo health): quale backend KV è attivo, se uno lo è. */
export function getStorageBackend(): "redis" | "upstash" | null {
  if (isRedisConfigured()) return "redis"
  if (isKvConfigured()) return "upstash"
  return null
}

let bothWarned = false

function warnBothConfiguredOnce(): void {
  if (bothWarned) return
  bothWarned = true
  log.warn(
    "Both Redis and Vercel KV are configured: Redis takes precedence. No automatic data migration is performed.",
  )
}

/** Ritorna il backend attivo (Redis vince su KV). Throw se nessuno è configurato. */
export function getKv(): KvClient {
  if (isRedisConfigured()) {
    if (isKvConfigured()) warnBothConfiguredOnce()
    return redisKv
  }
  if (isKvConfigured()) return upstashKv
  throw new Error("No KV backend configured (set PICTORIUM_REDIS_URL or KV_REST_API_URL/KV_REST_API_TOKEN)")
}

// ---- Serializzazione (parità Upstash) ----
// Upstash preserva i tipi nativamente; ioredis tratta solo stringhe.
// Regola: stringhe pass-through raw, resto JSON.stringify; in lettura
// JSON.parse tentato con fallback alla raw.
// Edge noto e accettato: una stringa che È JSON valido (es. "123") ritorna
// parsata. Nessun caller attuale memorizza tali valori via set (epoch =
// base36 con lettere, activity/L2 = object-string gestiti dai rami
// string|object dei caller, defaults/auth/keys = oggetti).

function encodeValue(value: unknown): string {
  if (typeof value === "string") return value
  const json = JSON.stringify(value)
  if (json === undefined) throw new Error("Unserializable value (undefined/function/symbol)")
  return json
}

function decodeValue<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as unknown as T
  }
}

// ---- Backend Upstash (pass-through, stessa forma dell'interfaccia) ----

type UpstashKv = {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>
  del(key: string): Promise<number>
  hgetall<T>(key: string): Promise<T | null>
  hset(key: string, obj: Record<string, unknown>): Promise<number>
  hdel(key: string, ...fields: string[]): Promise<number>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  scan(cursor: number, opts?: { match?: string; count?: number }): Promise<[number, string[]]>
}

async function loadUpstash(): Promise<UpstashKv> {
  const { kv } = await import("@vercel/kv")
  return kv as unknown as UpstashKv
}

const upstashKv: KvClient = {
  async get<T>(key: string): Promise<T | null> {
    return (await loadUpstash()).get<T>(key)
  },
  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    await (await loadUpstash()).set(key, value, opts?.ex !== undefined ? { ex: opts.ex } : undefined)
  },
  async del(key: string): Promise<number> {
    return (await loadUpstash()).del(key)
  },
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    return (await loadUpstash()).hgetall<T>(key)
  },
  async hset(key: string, obj: Record<string, unknown>): Promise<number> {
    return (await loadUpstash()).hset(key, obj)
  },
  async hdel(key: string, ...fields: string[]): Promise<number> {
    return (await loadUpstash()).hdel(key, ...fields)
  },
  async incr(key: string): Promise<number> {
    return (await loadUpstash()).incr(key)
  },
  async expire(key: string, seconds: number): Promise<number> {
    return (await loadUpstash()).expire(key, seconds)
  },
  async scan(cursor: number, opts?: { match?: string; count?: number }): Promise<[number, string[]]> {
    return (await loadUpstash()).scan(cursor, opts)
  },
}

// ---- Backend Redis nativo (ioredis, singleton lazy) ----

type RedisLike = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>
  del(key: string): Promise<number>
  hgetall(key: string): Promise<Record<string, string>>
  hset(key: string, obj: Record<string, string>): Promise<number>
  hdel(key: string, ...fields: string[]): Promise<number>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
  scan(cursor: number | string, ...args: (string | number)[]): Promise<[string, string[]]>
  quit(): Promise<unknown>
}

let redisClient: RedisLike | null = null

async function ensureRedis(): Promise<RedisLike> {
  if (redisClient) return redisClient
  const url = resolveRedisUrl()
  if (!url) throw new Error("No Redis URL configured")
  const { default: Redis } = await import("ioredis")
  redisClient = new Redis(url, {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 1,
  }) as unknown as RedisLike
  return redisClient
}

/** Chiude l'handle Redis (test + shutdown). Resetta il singleton. */
export async function closeKvClient(): Promise<void> {
  if (!redisClient) return
  const client = redisClient
  redisClient = null
  try {
    await client.quit()
  } catch {
    // Chiavi in mano: il quit su connessione mai aperta o già caduta non deve mai lanciare.
  }
}

const redisKv: KvClient = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await (await ensureRedis()).get(key)
    if (raw === null) return null
    return decodeValue<T>(raw)
  },
  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    const payload = encodeValue(value)
    const client = await ensureRedis()
    if (opts?.ex !== undefined) {
      await client.set(key, payload, "EX", Math.max(1, Math.floor(opts.ex)))
    } else {
      await client.set(key, payload)
    }
  },
  async del(key: string): Promise<number> {
    return (await ensureRedis()).del(key)
  },
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const raw = await (await ensureRedis()).hgetall(key)
    const entries = Object.entries(raw)
    if (entries.length === 0) return null
    const out: Record<string, unknown> = {}
    for (const [field, val] of entries) out[field] = decodeValue(val)
    return out as T
  },
  async hset(key: string, obj: Record<string, unknown>): Promise<number> {
    const encoded: Record<string, string> = {}
    for (const [field, val] of Object.entries(obj)) encoded[field] = encodeValue(val)
    return (await ensureRedis()).hset(key, encoded)
  },
  async hdel(key: string, ...fields: string[]): Promise<number> {
    return (await ensureRedis()).hdel(key, ...fields)
  },
  async incr(key: string): Promise<number> {
    return (await ensureRedis()).incr(key)
  },
  async expire(key: string, seconds: number): Promise<number> {
    return (await ensureRedis()).expire(key, seconds)
  },
  async scan(cursor: number, opts?: { match?: string; count?: number }): Promise<[number, string[]]> {
    const [next, keys] = await (await ensureRedis()).scan(
      cursor,
      "MATCH",
      opts?.match ?? "*",
      "COUNT",
      opts?.count ?? 100,
    )
    return [Number(next) || 0, keys]
  },
}
