import { Redis } from "@upstash/redis"

/**
 * Upstash Redis REST client used by `lib/kv.ts` as the serverless KV backend.
 *
 * Replaces the deprecated Vercel KV SDK with the first-party
 * `@upstash/redis` client. The retired package was itself a thin wrapper
 * around exactly this SDK (REST API + automatic JSON deserialization), so this
 * module reproduces the same surface and byte format: `set()` stores strings
 * raw and JSON-serializes everything else, `get()` JSON-parses with a raw
 * fallback, and `automaticDeserialization` stays enabled (the default, kept
 * explicit here so a future SDK default change cannot silently alter stored
 * values).
 *
 * Credentials are resolved lazily on the first command:
 *   1. `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (canonical)
 *   2. `KV_REST_API_URL` + `KV_REST_API_TOKEN` (legacy Vercel KV names, same
 *      credentials injected by the Vercel Marketplace integration)
 *
 * The precedence mirrors `resolveUpstashRestCredentials()` in `lib/kv.ts`, the
 * module that decides whether this backend is configured at all; keep the two
 * in sync. Fail-closed: a missing (or half-configured) credential pair throws
 * a descriptive error instead of falling back to another store.
 *
 * Only `@upstash/redis` is imported here, and `lib/kv.ts` loads this module
 * dynamically, so the SDK stays out of the module graph until a REST KV
 * backend is actually used (same laziness as before the migration).
 */

type ResolvedCredentials = { url: string; token: string }

function resolveCredentials(): ResolvedCredentials | null {
  const canonicalUrl = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const canonicalToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (canonicalUrl && canonicalToken) return { url: canonicalUrl, token: canonicalToken }

  const legacyUrl = process.env.KV_REST_API_URL?.trim()
  const legacyToken = process.env.KV_REST_API_TOKEN?.trim()
  if (legacyUrl && legacyToken) return { url: legacyUrl, token: legacyToken }

  return null
}

// One client per credential pair: a hot env swap (tests) rebuilds instead of
// silently reusing a client pointed at the previous store.
let cached: { url: string; token: string; client: Redis } | null = null

function client(): Redis {
  const credentials = resolveCredentials()
  if (!credentials) {
    throw new Error(
      "No Upstash Redis credentials configured (set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN, or the legacy KV_REST_API_URL/KV_REST_API_TOKEN)",
    )
  }
  if (cached && cached.url === credentials.url && cached.token === credentials.token) {
    return cached.client
  }
  const created = new Redis({
    url: credentials.url,
    token: credentials.token,
    automaticDeserialization: true,
  })
  cached = { ...credentials, client: created }
  return created
}

/**
 * Drop-in replacement for the `kv` singleton the retired Vercel KV SDK
 * exported. The method surface matches the subset `lib/kv.ts` consumes (see
 * `UpstashKv` there), so callers stay unchanged; the few SDK return types that
 * widen to `null` are normalized to the historical numeric contract.
 */
export const kv = {
  async get<T = unknown>(key: string): Promise<T | null> {
    return client().get<T>(key)
  },
  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    await client().set(key, value, opts?.ex !== undefined ? { ex: opts.ex } : undefined)
  },
  async del(key: string): Promise<number> {
    return client().del(key)
  },
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    // The SDK constrains the result to a record (automatic deserialization
    // returns object maps); callers keep their historical unconstrained cast.
    return client().hgetall(key) as Promise<T | null>
  },
  async hset(key: string, obj: Record<string, unknown>): Promise<number> {
    return client().hset(key, obj)
  },
  async hdel(key: string, ...fields: string[]): Promise<number> {
    return client().hdel(key, ...fields)
  },
  async incr(key: string): Promise<number> {
    return client().incr(key)
  },
  async expire(key: string, seconds: number): Promise<number> {
    return client().expire(key, seconds)
  },
  async scan(cursor: number, opts?: { match?: string; count?: number }): Promise<[number, string[]]> {
    // The SDK returns the next cursor as a string; normalizes to the numeric
    // cursor `KvClient.scan` has always exposed.
    const [next, keys] = await client().scan(cursor, opts ?? {})
    return [Number(next) || 0, keys]
  },
  async sadd(key: string, ...members: string[]): Promise<number> {
    // The SDK types the member list as a non-empty rest tuple; an empty call
    // is a no-op (Redis rejects SADD with just a key).
    if (members.length === 0) return 0
    return client().sadd(key, ...(members as [string, ...string[]]))
  },
  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0
    return client().srem(key, ...(members as [string, ...string[]]))
  },
  async smembers<T extends string = string>(key: string): Promise<T[]> {
    return client().smembers<T[]>(key)
  },
  async zadd(key: string, ...args: Array<{ score: number; member: string }>): Promise<number> {
    const [first, ...rest] = args
    if (!first) return 0
    // The SDK types the pairs as a tuple; the project only ever adds complete
    // score-member pairs through this adapter.
    const scoreMembers = [first, ...rest] as [
      { score: number; member: string },
      ...Array<{ score: number; member: string }>,
    ]
    const added = await client().zadd(key, ...scoreMembers)
    return added ?? 0
  },
  async zrem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0
    return client().zrem(key, ...(members as [string, ...string[]]))
  },
  async zincrby(key: string, increment: number, member: string): Promise<number> {
    return Number(await client().zincrby(key, increment, member))
  },
  async zrange(key: string, start: number, stop: number, opts?: { rev?: boolean }): Promise<string[]> {
    return client().zrange<string[]>(key, start, stop, opts)
  },
  async zscore(key: string, member: string): Promise<number | null> {
    const value = await client().zscore(key, member)
    return value === null || value === undefined ? null : Number(value)
  },
  async eval<T = unknown>(script: string, keys: string[], args: string[]): Promise<T> {
    return client().eval<string[], T>(script, keys, args)
  },
}

