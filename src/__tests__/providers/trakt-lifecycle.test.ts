import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Boundary mock of the project's KV adapter (`@/lib/kv`): a SHARED
// in-memory backend with atomic EVAL semantics. Each `eval` runs its
// check-and-write synchronously (no awaits inside), so concurrent workers
// serialize exactly like server-side Lua scripts. Production `kv.ts` — and
// its concurrent dynamic `import("@/lib/upstash-kv-client")`, which races the real
// package past `vi.mock` under `resetModules` (`res.map is not a function`)
// — is never loaded here. Production `trakt-auth` / `trakt-profile-lock` /
// `trakt-oauth-state` / `user-auth` / `user-activity` still run unmodified
// and coordinate through this backend via their real lock/CAS/disconnect/
// consume scripts (matched by marker comment, same as the scripts ignore).
const kvStore = vi.hoisted(() => new Map<string, unknown>())
const kvLocks = vi.hoisted(() => new Map<string, { owner: string; expiresAt: number }>())
const kvCtl = vi.hoisted(() => ({ rawEval: false, evalFail: false, noLock: false, getCalls: 0, delCalls: 0 }))
vi.mock("@/lib/kv", () => {
  function globToRegExp(glob: string): RegExp {
    return new RegExp(
      `^${glob
        .split("*")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    )
  }
  function isKvConfiguredMock(): boolean {
    return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
  }
  function isRedisConfiguredMock(): boolean {
    const v = process.env.PICTORIUM_REDIS_URL ?? process.env.POSTERIUM_REDIS_URL ?? process.env.REDIS_URL
    return !!v?.trim()
  }
  function getStorageModeMock(): "kv" | "file" {
    return isRedisConfiguredMock() || isKvConfiguredMock() ? "kv" : "file"
  }
  // Single shared client (stable identity: Vitest keeps `mock:` nodes across
  // `resetModules`, so reloaded worker modules share this exact backend).
  const kvClient = {
    get: async (key: string) => {
      kvCtl.getCalls++
      return kvStore.get(key) ?? null
    },
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
    del: async (key: string) => {
      kvCtl.delCalls++
      kvLocks.delete(key)
      return kvStore.delete(key) ? 1 : 0
    },
    hgetall: async (key: string) => {
      const raw = kvStore.get(key)
      if (raw && typeof raw === "object" && Object.keys(raw as Record<string, unknown>).length > 0) return raw
      return null
    },
    hset: async (key: string, obj: Record<string, unknown>) => {
      const prev = (kvStore.get(key) as Record<string, unknown> | undefined) ?? {}
      kvStore.set(key, { ...prev, ...obj })
      return Object.keys(obj).length
    },
    hdel: async (key: string, ...fields: string[]) => {
      const prev = kvStore.get(key) as Record<string, unknown> | undefined
      if (!prev || typeof prev !== "object") return 0
      let n = 0
      for (const f of fields) {
        if (f in prev) {
          delete prev[f]
          n++
        }
      }
      return n
    },
    incr: async (key: string) => {
      const next = (typeof kvStore.get(key) === "number" ? (kvStore.get(key) as number) : 0) + 1
      kvStore.set(key, next)
      return next
    },
    expire: async () => 1,
    scan: async (cursor: number, opts?: { match?: string; count?: number }): Promise<[number, string[]]> => {
      void cursor
      void opts?.count
      const re = globToRegExp(opts?.match ?? "*")
      return [0, [...kvStore.keys()].filter((k) => re.test(k))]
    },
    sadd: async (key: string, ...members: string[]) => {
      const prev = new Set((kvStore.get(key) as string[] | undefined) ?? [])
      let n = 0
      for (const m of members) {
        if (!prev.has(m)) {
          prev.add(m)
          n++
        }
      }
      kvStore.set(key, [...prev])
      return n
    },
    srem: async (key: string, ...members: string[]) => {
      const prev = new Set((kvStore.get(key) as string[] | undefined) ?? [])
      let n = 0
      for (const m of members) {
        if (prev.delete(m)) n++
      }
      kvStore.set(key, [...prev])
      return n
    },
    smembers: async (key: string): Promise<string[]> => {
      return (kvStore.get(key) as string[] | undefined) ?? []
    },
    zadd: async () => 0,
    zrem: async () => 0,
    zincrby: async () => 0,
    zrevrange: async (): Promise<string[]> => [],
    zscore: async (): Promise<number | null> => null,
    eval: async (_script: string, keys: string[], args: string[]) => {
      if (kvCtl.evalFail) throw new Error("EVAL unavailable (injected)")
      if (_script.includes("trakt-lock-acquire")) {
        // Negative-control switch: always win (simulates removed mutual
        // exclusion; the CAS ownership proof below is bypassed too).
        if (kvCtl.noLock) return 1
        const cur = kvLocks.get(keys[0])
        if (cur && cur.expiresAt > Date.now()) return 0
        kvLocks.set(keys[0], { owner: args[0], expiresAt: Date.now() + Number(args[1]) })
        return 1
      }
      if (_script.includes("trakt-lock-release")) {
        const cur = kvLocks.get(keys[0])
        if (cur && cur.owner === args[0]) {
          kvLocks.delete(keys[0])
          return 1
        }
        return 0
      }
      if (_script.includes("trakt-token-cond-clear")) {
        if (!kvStore.has(keys[2])) return "no_user"
        const g = kvStore.get(keys[1])
        const cur = typeof g === "string" ? g : ""
        if (cur !== (args[0] ?? "")) return "stale"
        if (!kvCtl.noLock) {
          const held = kvLocks.get(keys[3])
          if (!held || held.expiresAt <= Date.now() || held.owner !== args[2]) return "stale"
        }
        kvStore.delete(keys[0])
        kvStore.set(keys[1], args[1])
        return "ok"
      }
      if (_script.includes("trakt-token-cas")) {
        if (!kvStore.has(keys[2])) return "no_user"
        const g = kvStore.get(keys[1])
        const cur = typeof g === "string" ? g : ""
        if (cur !== (args[0] ?? "")) return "stale"
        if (!kvCtl.noLock) {
          const held = kvLocks.get(keys[3])
          if (!held || held.expiresAt <= Date.now() || held.owner !== args[3]) return "stale"
        }
        kvStore.set(keys[0], JSON.parse(args[1]))
        kvStore.set(keys[1], args[2])
        return "ok"
      }
      if (_script.includes("trakt-disconnect")) {
        if (!kvStore.has(keys[2])) return "no_user"
        kvStore.set(keys[1], args[0])
        kvStore.delete(keys[0])
        return "ok"
      }
      const v = kvStore.get(keys[0]) ?? null
      if (v === null || v === undefined) return null
      kvStore.delete(keys[0])
      if (kvCtl.rawEval) return v
      return typeof v === "string" ? v : JSON.stringify(v)
    },
  }
  class KvTimeoutErrorMock extends Error {
    constructor(readonly ms: number) {
      super(`KV read timed out after ${ms}ms`)
      this.name = "KvTimeoutError"
    }
  }
  return {
    getKv: () => kvClient,
    getStorageMode: getStorageModeMock,
    getStorageBackend: () => (isRedisConfiguredMock() ? "redis" : isKvConfiguredMock() ? "upstash" : null),
    isKvConfigured: isKvConfiguredMock,
    isRedisConfigured: isRedisConfiguredMock,
    resolveRedisUrl: () => {
      const v = process.env.PICTORIUM_REDIS_URL ?? process.env.POSTERIUM_REDIS_URL ?? process.env.REDIS_URL
      return v?.trim() ? v.trim() : undefined
    },
    closeKvClient: async () => {},
    withKvTimeout: <T>(promise: Promise<T>) => promise,
    KvTimeoutError: KvTimeoutErrorMock,
  }
})

// Tripwire: production `kv.ts` must stay unloaded in this file (its dynamic
// `import("@/lib/upstash-kv-client")` is the documented race). Any unexpected import of
// the real package throws loudly instead of reaching the network.
vi.mock("@/lib/upstash-kv-client", () => {
  const boom = () => {
    throw new Error("@/lib/upstash-kv-client tripwire: production kv.ts must stay unloaded (mock @/lib/kv instead)")
  }
  return { kv: { get: boom, set: boom, del: boom, eval: boom } }
})

const CLIENT_ID = "test-trakt-client-id"
const REDIRECT_DUCK = "https://pictorium.duckdns.org/api/trakt/callback"
const DISTINCT_SECRET = "DISTINCTIVE_LIFECYCLE_SECRET_abc123"

const OLD_ACCESS = "lifecycle-old-access-0123456789abcdef"
const OLD_REFRESH = "lifecycle-old-refresh-0123456789abcdef"
const NEW_ACCESS = "lifecycle-new-access-fedcba9876543210"
const NEW_REFRESH = "lifecycle-new-refresh-fedcba9876543210"

function tokenReply(access = NEW_ACCESS, refresh = NEW_REFRESH) {
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: 7776000,
    refresh_token: refresh,
    scope: "public",
    created_at: Math.floor(Date.now() / 1000),
  }
}

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PICTORIUM_RATELIMIT_KV",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_TRAKT_CLIENT_ID",
  "POSTERIUM_TRAKT_CLIENT_ID",
  "TRAKT_CLIENT_ID",
  "PICTORIUM_TRAKT_CLIENT_SECRET",
  "POSTERIUM_TRAKT_CLIENT_SECRET",
  "PICTORIUM_TRAKT_REDIRECT_URI",
  "POSTERIUM_TRAKT_REDIRECT_URI",
  "TRAKT_API_URL",
  "PICTORIUM_TRAKT_TIMEOUT_MS",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

function setValidConfig() {
  process.env.PICTORIUM_TRAKT_CLIENT_ID = CLIENT_ID
  process.env.PICTORIUM_TRAKT_REDIRECT_URI = REDIRECT_DUCK
  // Leftover pre-PKCE secret on purpose: ignored everywhere (PKCE needs none).
  process.env.PICTORIUM_TRAKT_CLIENT_SECRET = DISTINCT_SECRET
}

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-traktlife-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  delete process.env.PICTORIUM_RATELIMIT_KV
  delete process.env.PICTORIUM_TRAKT_CLIENT_ID
  delete process.env.POSTERIUM_TRAKT_CLIENT_ID
  delete process.env.TRAKT_CLIENT_ID
  delete process.env.PICTORIUM_TRAKT_CLIENT_SECRET
  delete process.env.POSTERIUM_TRAKT_CLIENT_SECRET
  delete process.env.PICTORIUM_TRAKT_REDIRECT_URI
  delete process.env.POSTERIUM_TRAKT_REDIRECT_URI
  delete process.env.TRAKT_API_URL
  delete process.env.PICTORIUM_TRAKT_TIMEOUT_MS
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  setValidConfig()
  kvStore.clear()
  kvLocks.clear()
  kvCtl.rawEval = false
  kvCtl.evalFail = false
  kvCtl.noLock = false
  kvCtl.getCalls = 0
  kvCtl.delCalls = 0
  vi.restoreAllMocks()
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  kvStore.clear()
  kvLocks.clear()
  kvCtl.rawEval = false
  kvCtl.evalFail = false
  kvCtl.noLock = false
  kvCtl.getCalls = 0
  kvCtl.delCalls = 0
  vi.resetModules()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

async function loadAll() {
  vi.resetModules()
  const auth = await import("@/lib/user-auth")
  const trakt = await import("@/lib/trakt-auth")
  const lock = await import("@/lib/trakt-profile-lock")
  const authorize = await import("@/app/api/users/[uuid]/trakt/authorize/route")
  const status = await import("@/app/api/users/[uuid]/trakt/status/route")
  const disconnect = await import("@/app/api/users/[uuid]/trakt/disconnect/route")
  const callback = await import("@/app/api/trakt/callback/route")
  return { auth, trakt, lock, authorize, status, disconnect, callback }
}

function asKv() {
  process.env.KV_REST_API_URL = "https://example.upstash.io"
  process.env.KV_REST_API_TOKEN = "test-token"
  process.env.PICTORIUM_RATELIMIT_KV = "0"
}

async function seedTokens(
  trakt: Awaited<ReturnType<typeof loadAll>>["trakt"],
  uuid: string,
  opts?: { expired?: boolean; access?: string; refresh?: string },
) {
  await trakt.saveTraktTokens(uuid, {
    accessToken: opts?.access ?? OLD_ACCESS,
    refreshToken: opts?.refresh ?? OLD_REFRESH,
    expiresAt: opts?.expired === false ? Date.now() + 3600_000 : Date.now() - 60_000,
    scope: "public",
    tokenType: "Bearer",
    redirectUri: REDIRECT_DUCK,
  })
}

function stubTokenFetch(opts?: { revokeStatus?: number; tokenImpl?: (url: string) => Promise<Response> }) {
  const calls: string[] = []
  const bodies: unknown[] = []
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push(url)
    bodies.push(init?.body ? JSON.parse(init.body as string) : null)
    if (url.endsWith("/oauth/revoke")) {
      return new Response("{}", { status: opts?.revokeStatus ?? 200 })
    }
    if (opts?.tokenImpl) return opts.tokenImpl(url)
    return new Response(JSON.stringify(tokenReply()), { status: 200, headers: { "Content-Type": "application/json" } })
  })
  return { calls, bodies }
}

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for condition")
    await new Promise((r) => setTimeout(r, 10))
  }
}

function deleteReq(url: string, secret?: string, extra?: Record<string, string>): NextRequest {
  const headers: Record<string, string> = { ...extra }
  if (secret) headers["x-user-token"] = secret
  return new NextRequest(url, { method: "DELETE", headers })
}

describe("coordinated refresh: single-flight", () => {
  it("two simultaneous refreshes share one network call (file, separate import contexts)", async () => {
    const a = await loadAll()
    const created = await a.auth.createUser()
    await seedTokens(a.trakt, created.uuid, { expired: true })
    // Second worker: fresh module state, same filesystem + same user.
    vi.resetModules()
    const b = await import("@/lib/trakt-auth")
    const { calls } = stubTokenFetch()

    const [r1, r2] = await Promise.all([
      a.trakt.getValidTraktAccessToken(created.uuid),
      b.getValidTraktAccessToken(created.uuid),
    ])
    const tokenCalls = calls.filter((u) => u.endsWith("/oauth/token"))
    expect(tokenCalls).toHaveLength(1)
    expect(r1.ok && r2.ok).toBe(true)
    // Exactly one winner performed the write; the loser reused the fresh record.
    const refreshedCount = [r1, r2].filter((r) => r.ok && r.refreshed).length
    expect(refreshedCount).toBe(1)
    const read = await a.trakt.getTraktTokens(created.uuid)
    expect(read.status).toBe("connected")
    if (read.status === "connected") {
      expect(read.tokens.accessToken).toBe(NEW_ACCESS)
      expect(read.tokens.scope).toBe("public")
      expect(read.tokens.tokenType).toBe("Bearer")
    }
  })

  it("KV backend: cross-worker single-flight through the atomic lock", async () => {
    asKv()
    const a = await loadAll()
    const created = await a.auth.createUser()
    await seedTokens(a.trakt, created.uuid, { expired: true })
    // Second worker: fresh module state (a distinct in-process single-flight
    // map) on the SAME shared KV backend + same user. The `@/lib/kv`
    // boundary mock above has a stable hoisted identity across
    // `resetModules` (Vitest keeps `mock:` nodes), so both workers
    // deterministically share one backend — unlike the previous
    // `@/lib/upstash-kv-client` mock, which raced the real package inside `kv.ts`'s
    // concurrent dynamic import (`res.map is not a function`). `a.trakt !==
    // b` proves isolated worker contexts (not one shared inflight Map).
    vi.resetModules()
    const b = await import("@/lib/trakt-auth")
    expect(b).not.toBe(a.trakt)
    const { calls } = stubTokenFetch()

    // Simultaneous entry in the same tick (no staggering: staggering would
    // serialize away the lock contention under test and make it vacuous).
    const [r1, r2] = await Promise.all([
      a.trakt.getValidTraktAccessToken(created.uuid),
      b.getValidTraktAccessToken(created.uuid),
    ])
    expect(calls.filter((u) => u.endsWith("/oauth/token"))).toHaveLength(1)
    expect(r1.ok && r2.ok).toBe(true)
    expect([r1, r2].filter((r) => r.ok && r.refreshed)).toHaveLength(1)
    // Shared KV holds the single refreshed record for both workers.
    for (const mod of [a.trakt, b]) {
      const read = await mod.getTraktTokens(created.uuid)
      expect(read.status).toBe("connected")
      if (read.status === "connected") expect(read.tokens.accessToken).toBe(NEW_ACCESS)
    }
  })

  it("diagnostic: with the distributed lock disabled both workers exchange (proves the test above is sensitive)", async () => {
    asKv()
    // Controlled, mock-level disabling of mutual exclusion ONLY (no source
    // touched): lock acquire always wins and the CAS ownership proof is
    // bypassed, simulating removed distributed coordination.
    kvCtl.noLock = true
    try {
      const a = await loadAll()
      const created = await a.auth.createUser()
      await seedTokens(a.trakt, created.uuid, { expired: true })
      vi.resetModules()
      const b = await import("@/lib/trakt-auth")
      const { calls } = stubTokenFetch()

      const [r1, r2] = await Promise.all([
        a.trakt.getValidTraktAccessToken(created.uuid),
        b.getValidTraktAccessToken(created.uuid),
      ])
      // No single-flight: both workers spend an exchange. (Both still end
      // consistent — the loser's CAS aborts on the moved generation and it
      // reuses the winner's record — but the one-call guarantee is gone,
      // which is exactly what the test above guards.)
      expect(calls.filter((u) => u.endsWith("/oauth/token"))).toHaveLength(2)
      expect(r1.ok && r2.ok).toBe(true)
    } finally {
      kvCtl.noLock = false
    }
  })

  it("fresh token performs no exchange", async () => {
    const { auth, trakt } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: false })
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const res = await trakt.getValidTraktAccessToken(created.uuid)
    expect(res).toEqual({ ok: true, accessToken: OLD_ACCESS, refreshed: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("different-user concurrency is independent (one refresh each)", async () => {
    const { auth, trakt } = await loadAll()
    const u1 = await auth.createUser()
    const u2 = await auth.createUser()
    await seedTokens(trakt, u1.uuid, { expired: true })
    await seedTokens(trakt, u2.uuid, { expired: true })
    let n = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      n++
      return new Response(JSON.stringify(tokenReply(`new-access-${n}`, `new-refresh-${n}`)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })
    const [r1, r2] = await Promise.all([
      trakt.getValidTraktAccessToken(u1.uuid),
      trakt.getValidTraktAccessToken(u2.uuid),
    ])
    expect(n).toBe(2)
    expect(r1.ok && r2.ok).toBe(true)
    const read1 = await trakt.getTraktTokens(u1.uuid)
    const read2 = await trakt.getTraktTokens(u2.uuid)
    expect(read1.status).toBe("connected")
    expect(read2.status).toBe("connected")
    if (read1.status === "connected" && read2.status === "connected") {
      expect(read1.tokens.accessToken).not.toBe(read2.tokens.accessToken)
    }
  })
})

describe("refresh failure taxonomy", () => {
  it("refresh grant is secretless and rotates both materials (single-use)", async () => {
    const { auth, trakt } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })
    const { calls, bodies } = stubTokenFetch()

    const res = await trakt.getValidTraktAccessToken(created.uuid)
    expect(res).toEqual({ ok: true, accessToken: NEW_ACCESS, refreshed: true })
    const tokenCalls = calls.filter((u) => u.endsWith("/oauth/token"))
    expect(tokenCalls).toHaveLength(1)
    const sent = bodies[calls.findIndex((u) => u.endsWith("/oauth/token"))] as Record<string, unknown>
    // Secretless PKCE refresh: client + refresh material + binding, no secret.
    expect(sent).toMatchObject({
      refresh_token: OLD_REFRESH,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_DUCK,
      grant_type: "refresh_token",
    })
    expect(sent).not.toHaveProperty("client_secret")
    expect(sent).not.toHaveProperty("code")
    expect(sent).not.toHaveProperty("code_verifier")
    expect(JSON.stringify(bodies)).not.toContain(DISTINCT_SECRET)
    // Single-use rotation persisted: the replacement is stored, not the old pair.
    const kept = await trakt.getTraktTokens(created.uuid)
    expect(kept.status).toBe("connected")
    if (kept.status === "connected") {
      expect(kept.tokens.accessToken).toBe(NEW_ACCESS)
      expect(kept.tokens.refreshToken).not.toBe(OLD_REFRESH)
    }
  })

  it("invalid_grant clears and reports reconnect_required; transient failures keep credentials", async () => {
    const { auth, trakt } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })

    // Permanent: proven invalid_grant → cleared, reconnect required.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    )
    const dead = await trakt.getValidTraktAccessToken(created.uuid)
    expect(dead).toEqual({ ok: false, reason: "reconnect_required" })
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")

    // Transient battery: every failure keeps the stored credentials intact.
    const transientCases: Array<{ name: string; impl: () => Promise<Response> }> = [
      {
        name: "500",
        impl: async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      },
      {
        name: "429",
        impl: async () =>
          new Response(JSON.stringify({ error: "slow down" }), { status: 429, headers: { "Retry-After": "1" } }),
      },
      {
        name: "400 without invalid_grant (deployment trouble, must not delete)",
        impl: async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 }),
      },
      {
        name: "network failure",
        impl: async () => {
          throw new TypeError("fetch failed")
        },
      },
      {
        name: "malformed 200",
        impl: async () =>
          new Response(JSON.stringify({ access_token: "only-half" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
    ]
    for (const c of transientCases) {
      await seedTokens(trakt, created.uuid, { expired: true })
      vi.restoreAllMocks()
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(c.impl)
      const res = await trakt.getValidTraktAccessToken(created.uuid)
      expect(res, c.name).toEqual({ ok: false, reason: "temporary" })
      const kept = await trakt.getTraktTokens(created.uuid)
      expect(kept.status, `${c.name}: credentials must survive`).toBe("connected")
      if (kept.status === "connected") {
        expect(kept.tokens.accessToken, c.name).toBe(OLD_ACCESS)
        expect(kept.tokens.refreshToken, c.name).toBe(OLD_REFRESH)
      }
      vi.restoreAllMocks()
    }
  })

  it("KV lock EVAL failure is fail-closed: no write, no get+del downgrade, record intact", async () => {
    asKv()
    const { auth, trakt } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })
    kvCtl.evalFail = true
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await trakt.getValidTraktAccessToken(created.uuid)
    expect(res).toEqual({ ok: false, reason: "temporary" })
    expect(fetchSpy).not.toHaveBeenCalled()
    const kept = await trakt.getTraktTokens(created.uuid)
    expect(kept.status).toBe("connected")
    if (kept.status === "connected") expect(kept.tokens.accessToken).toBe(OLD_ACCESS)

    // Outage over: the same call refreshes exactly once.
    kvCtl.evalFail = false
    const { calls } = stubTokenFetch()
    const retry = await trakt.getValidTraktAccessToken(created.uuid)
    expect(retry.ok).toBe(true)
    expect(calls.filter((u) => u.endsWith("/oauth/token"))).toHaveLength(1)
  })
})

describe("races at the storage boundary", () => {
  it("disconnect while refresh is gated: refresh aborts, no resurrection", async () => {
    const { auth, trakt, disconnect } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })

    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let started = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/oauth/revoke")) return new Response("{}", { status: 200 })
      started = true
      return gate
    })
    const pending = trakt.getValidTraktAccessToken(created.uuid)
    await waitFor(() => started)

    const del = await disconnect.DELETE(deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret), {
      params: Promise.resolve({ uuid: created.uuid }),
    })
    expect(del.status).toBe(200)
    expect(del.headers.get("cache-control")).toBe("no-store")
    expect(await del.json()).toEqual({ ok: true, revoked: true })

    release(new Response(JSON.stringify(tokenReply()), { status: 200, headers: { "Content-Type": "application/json" } }))
    const res = await pending
    expect(res.ok).toBe(false)
    // Disconnect won: stale refresh result never replaced it.
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
    expect(await trakt.getTraktTokens(created.uuid)).toEqual({ status: "disconnected", tokens: null, reason: "no_record" })
  })

  it("wipe while callback save is gated: failed redirect, no namespace recreation (file)", async () => {
    const { auth, authorize, callback, trakt } = await loadAll()
    const created = await auth.createUser()
    const flow = await (async () => {
      const res = await authorize.POST(
        new NextRequest(`http://localhost/api/users/${created.uuid}/trakt/authorize`, {
          method: "POST",
          headers: { "x-user-token": created.secret },
        }),
        { params: Promise.resolve({ uuid: created.uuid }) },
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { authorizeUrl: string }
      const setCookie = res.headers.get("set-cookie")!
      const cookieMatch = /pictorium_trakt_oauth=([^;]+)/.exec(setCookie)
      if (!cookieMatch) throw new Error("binding cookie missing")
      const nonce = cookieMatch[1]
      return { state: new URL(body.authorizeUrl).searchParams.get("state")!, cookie: `pictorium_trakt_oauth=${nonce}` }
    })()

    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let started = false
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      started = true
      return gate
    })
    const pending = callback.GET(
      new NextRequest(`http://localhost/api/trakt/callback?code=gated&state=${flow.state}`, {
        headers: { cookie: flow.cookie },
      }),
    )
    await waitFor(() => started)
    const { deleteUser } = await import("@/lib/user-activity")
    await deleteUser(created.uuid)

    release(new Response(JSON.stringify(tokenReply()), { status: 200, headers: { "Content-Type": "application/json" } }))
    const res = await pending
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(`/u/${created.uuid}/configure?trakt=failed`)
    // Closed at the storage boundary: no mkdir resurrection, no orphans.
    await expect(fsp.stat(path.join(tempDir!, "users", created.uuid))).rejects.toThrow()
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
  })

  it("wipe while refresh is gated: no orphan tokens (KV)", async () => {
    asKv()
    const { auth, trakt } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })

    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let started = false
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      started = true
      return gate
    })
    const pending = trakt.getValidTraktAccessToken(created.uuid)
    await waitFor(() => started)
    const { deleteUser } = await import("@/lib/user-activity")
    await deleteUser(created.uuid)

    release(new Response(JSON.stringify(tokenReply()), { status: 200, headers: { "Content-Type": "application/json" } }))
    const res = await pending
    expect(res.ok).toBe(false)
    expect(kvStore.has(`user:${created.uuid}:trakt`)).toBe(false)
    expect(kvStore.has(`user:${created.uuid}:auth`)).toBe(false)
  }, 20000)

  it("in-flight callback + disconnect cannot reconnect (user survives, link does not)", async () => {
    const { auth, authorize, callback, disconnect, trakt } = await loadAll()
    const created = await auth.createUser()
    const init = await authorize.POST(
      new NextRequest(`http://localhost/api/users/${created.uuid}/trakt/authorize`, {
        method: "POST",
        headers: { "x-user-token": created.secret },
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(init.status).toBe(200)
    const initBody = (await init.json()) as { authorizeUrl: string }
    const initCookie = init.headers.get("set-cookie")!
    const initMatch = /pictorium_trakt_oauth=([^;]+)/.exec(initCookie)
    if (!initMatch) throw new Error("binding cookie missing")
    const nonce = initMatch[1]
    const state = new URL(initBody.authorizeUrl).searchParams.get("state")!
    const cookie = `pictorium_trakt_oauth=${nonce}`

    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let started = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/oauth/revoke")) return new Response("{}", { status: 200 })
      started = true
      return gate
    })
    const pending = callback.GET(new NextRequest(`http://localhost/api/trakt/callback?code=late&state=${state}`, {
      headers: { cookie },
    }))
    await waitFor(() => started)

    const del = await disconnect.DELETE(deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret), {
      params: Promise.resolve({ uuid: created.uuid }),
    })
    expect(await del.json()).toEqual({ ok: true, revoked: false })

    release(new Response(JSON.stringify(tokenReply()), { status: 200, headers: { "Content-Type": "application/json" } }))
    const res = await pending
    expect(res.headers.get("location")).toBe(`/u/${created.uuid}/configure?trakt=failed`)
    // The profile survives but the link must not: fencing invalidated the
    // pending save (no recheck-TOCTOU — the generation moved mid-flight).
    expect(await auth.userExists(created.uuid)).toBe(true)
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
    expect(await fsp.stat(path.join(tempDir!, "users", created.uuid, "trakt.json")).catch(() => null)).toBeNull()
  })
})

describe("DELETE /api/users/[uuid]/trakt/disconnect", () => {
  it("auth gate mirrors the other trakt mutations + same-origin + no-store", async () => {
    const { auth, disconnect } = await loadAll()
    const a = await auth.createUser()
    const b = await auth.createUser()
    const url = `http://localhost/api/users/${a.uuid}/trakt/disconnect`
    const ctx = { params: Promise.resolve({ uuid: a.uuid }) }

    expect((await disconnect.DELETE(deleteReq(url), ctx)).status).toBe(401)
    expect((await disconnect.DELETE(deleteReq(url, b.secret), ctx)).status).toBe(401)
    expect(
      (await disconnect.DELETE(deleteReq("http://localhost/api/users/nope/trakt/disconnect", a.secret), {
        params: Promise.resolve({ uuid: "nope" }),
      })).status,
    ).toBe(400)
    expect((await disconnect.DELETE(deleteReq(url, a.secret, { origin: "https://evil.example.com" }), ctx)).status).toBe(403)
    process.env.PICTORIUM_MULTI_USER = "0"
    vi.resetModules()
    const off = await import("@/app/api/users/[uuid]/trakt/disconnect/route")
    expect((await off.DELETE(deleteReq(url, a.secret), ctx)).status).toBe(404)
    process.env.PICTORIUM_MULTI_USER = "1"
  })

  it("revoke upstream then local disconnect: secret-free, no-store, status follows", async () => {
    const { auth, trakt, disconnect, status } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: false })
    const { calls, bodies } = stubTokenFetch()

    const res = await disconnect.DELETE(
      deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ ok: true, revoked: true })
    // Upstream revocation carried the token + client pair server-side…
    expect(calls).toEqual(expect.arrayContaining([expect.stringMatching(/\/oauth\/revoke$/)]))
    const revokeBody = bodies[calls.findIndex((u) => u.endsWith("/oauth/revoke"))] as Record<string, unknown>
    expect(revokeBody.client_id).toBe(CLIENT_ID)
    // …secretless (PKCE public client): no secret key, and the leftover
    // decoy env must never leak into any payload…
    expect(revokeBody).not.toHaveProperty("client_secret")
    expect(JSON.stringify(bodies)).not.toContain(DISTINCT_SECRET)
    // …and nothing secret ever comes back down.
    expect(JSON.stringify(body)).not.toContain(DISTINCT_SECRET)
    expect(JSON.stringify(body)).not.toContain(OLD_ACCESS)
    expect(JSON.stringify(body)).not.toContain(OLD_REFRESH)

    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
    const st = await status.GET(
      new NextRequest(`http://localhost/api/users/${created.uuid}/trakt/status`, {
        headers: { "x-user-token": created.secret },
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(await st.json()).toEqual({ configured: true, status: "disconnected" })
    // The server accessor never returns the disconnected stale token.
    expect(await trakt.getValidTraktAccessToken(created.uuid)).toEqual({ ok: false, reason: "disconnected" })
  })

  it("revoke outage still disconnects locally (revoked:false)", async () => {
    const { auth, trakt, disconnect } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: false })
    stubTokenFetch({ revokeStatus: 500 })

    const res = await disconnect.DELETE(
      deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(await res.json()).toEqual({ ok: true, revoked: false })
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
  })

  it("already disconnected: ok + revoked:false; unconfigured deployment still disconnects", async () => {
    const { auth, trakt, disconnect } = await loadAll()
    const created = await auth.createUser()
    stubTokenFetch()
    const ctx = { params: Promise.resolve({ uuid: created.uuid }) }
    const url = `http://localhost/api/users/${created.uuid}/trakt/disconnect`

    const fresh = await disconnect.DELETE(deleteReq(url, created.secret), ctx)
    expect(await fresh.json()).toEqual({ ok: true, revoked: false })

    // A missing secret alone changes nothing (PKCE needs none): revocation
    // is still attempted secretless and the local disconnect proceeds.
    await seedTokens(trakt, created.uuid, { expired: false })
    delete process.env.PICTORIUM_TRAKT_CLIENT_SECRET
    delete process.env.POSTERIUM_TRAKT_CLIENT_SECRET
    vi.resetModules()
    const nosecret = await import("@/app/api/users/[uuid]/trakt/disconnect/route")
    const stillCfg = await nosecret.DELETE(deleteReq(url, created.secret), ctx)
    expect(await stillCfg.json()).toEqual({ ok: true, revoked: true })

    // A broken deployment config (no client ID) skips the upstream revoke
    // but must never trap the user: the local disconnect still proceeds.
    await seedTokens(trakt, created.uuid, { expired: false })
    delete process.env.PICTORIUM_TRAKT_CLIENT_ID
    delete process.env.POSTERIUM_TRAKT_CLIENT_ID
    delete process.env.TRAKT_CLIENT_ID
    vi.resetModules()
    const bare = await import("@/app/api/users/[uuid]/trakt/disconnect/route")
    const reloaded = await import("@/lib/trakt-auth")
    const res = await bare.DELETE(deleteReq(url, created.secret), ctx)
    expect(await res.json()).toEqual({ ok: true, revoked: false })
    expect(await reloaded.getTraktTokenStatus(created.uuid)).toBe("disconnected")
  })
})

describe("file profile lock primitive", () => {
  it("stale lock file is NEVER auto-removed (fail-closed; crash recovery is manual)", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    // Orphan simulation: a lock file whose TTL long expired (crashed holder,
    // no live owner to release it). No-steal: a contender must NOT unlink
    // it — it waits boundedly and fails closed, and the file survives
    // byte-identical for the documented manual recovery (service stopped).
    const dir = path.join(tempDir!, "trakt-locks")
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${created.uuid.toLowerCase()}.lock`)
    const orphan = JSON.stringify({
      owner: `orphan-${crypto.randomBytes(8).toString("hex")}`,
      expiresAt: Date.now() - 60_000,
    })
    await fsp.writeFile(file, orphan, { mode: 0o600 })
    const t0 = Date.now()
    await expect(lock.acquireTraktProfileLock(created.uuid, { waitMs: 150 })).rejects.toThrowError(
      lock.TraktLockUnavailableError,
    )
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(await fsp.readFile(file, "utf-8")).toBe(orphan)
    // Manual recovery (service-stopped equivalent): only an explicit offline
    // unlink makes the profile acquirable again.
    await fsp.unlink(file)
    const next = await lock.acquireTraktProfileLock(created.uuid, { waitMs: 1000 })
    await next.release()
  })

  it("concurrent contenders on a stale file: neither removes it, neither acquires", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    const dir = path.join(tempDir!, "trakt-locks")
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${created.uuid.toLowerCase()}.lock`)
    const stale = JSON.stringify({
      owner: `orphan-${crypto.randomBytes(8).toString("hex")}`,
      expiresAt: Date.now() - 60_000,
    })
    await fsp.writeFile(file, stale, { mode: 0o600 })
    // The old TOCTOU: two contenders both read the same stale payload, both
    // unlink (the second destroying a live replacement), both claim the
    // lock. No-steal: both fail closed and the file survives byte-identical.
    const [r1, r2] = await Promise.allSettled([
      lock.acquireTraktProfileLock(created.uuid, { waitMs: 200 }),
      lock.acquireTraktProfileLock(created.uuid, { waitMs: 200 }),
    ])
    expect(r1.status).toBe("rejected")
    expect(r2.status).toBe("rejected")
    expect((r1 as PromiseRejectedResult).reason).toBeInstanceOf(lock.TraktLockUnavailableError)
    expect((r2 as PromiseRejectedResult).reason).toBeInstanceOf(lock.TraktLockUnavailableError)
    expect(await fsp.readFile(file, "utf-8")).toBe(stale)
  })

  it("concurrent contenders never disturb the live holder (no unlink of another holder)", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    const held = await lock.acquireTraktProfileLock(created.uuid)
    const file = path.join(tempDir!, "trakt-locks", `${created.uuid.toLowerCase()}.lock`)
    const before = await fsp.readFile(file, "utf-8")
    const [a, b] = await Promise.allSettled([
      lock.acquireTraktProfileLock(created.uuid, { waitMs: 200 }),
      lock.acquireTraktProfileLock(created.uuid, { waitMs: 200 }),
    ])
    expect(a.status).toBe("rejected")
    expect(b.status).toBe("rejected")
    expect((a as PromiseRejectedResult).reason).toBeInstanceOf(lock.TraktLockUnavailableError)
    expect((b as PromiseRejectedResult).reason).toBeInstanceOf(lock.TraktLockUnavailableError)
    // Neither contender unlinked or replaced the live holder's file.
    expect(await fsp.readFile(file, "utf-8")).toBe(before)
    await held.release()
    const next = await lock.acquireTraktProfileLock(created.uuid, { waitMs: 1000 })
    await next.release()
  })

  it("live lock is NEVER stolen on TTL expiry (fail-closed, bounded)", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    const first = await lock.acquireTraktProfileLock(created.uuid, { ttlMs: 150 })
    // TTL expires while the owner process is still alive: a contender must
    // NOT reap the file — it waits boundedly and fails closed.
    await new Promise((r) => setTimeout(r, 250))
    const t0 = Date.now()
    await expect(lock.acquireTraktProfileLock(created.uuid, { waitMs: 150 })).rejects.toThrowError(
      lock.TraktLockUnavailableError,
    )
    expect(Date.now() - t0).toBeLessThan(5000)
    // The live holder's lock survived the contender; its own release still
    // drops it (owner match), and the profile is acquirable again.
    await first.release()
    const third = await lock.acquireTraktProfileLock(created.uuid, { waitMs: 1000 })
    await third.release()
  })

  it("unparseable lock file is never reaped (fail-closed; manual recovery)", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    const dir = path.join(tempDir!, "trakt-locks")
    await fsp.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${created.uuid.toLowerCase()}.lock`)
    await fsp.writeFile(file, "garbage-not-json", { mode: 0o600 })
    // No-steal: the file is never removed automatically — bounded failure,
    // and the file is left for the documented manual recovery (delete by
    // hand with the service stopped).
    await expect(lock.acquireTraktProfileLock(created.uuid, { waitMs: 150 })).rejects.toThrowError(
      lock.TraktLockUnavailableError,
    )
    expect(await fsp.stat(file).catch(() => null)).not.toBeNull()
  })

  it("contention times out boundedly (fail-closed, no hang)", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    const held = await lock.acquireTraktProfileLock(created.uuid)
    const t0 = Date.now()
    await expect(lock.acquireTraktProfileLock(created.uuid, { waitMs: 150 })).rejects.toThrowError(
      lock.TraktLockUnavailableError,
    )
    expect(Date.now() - t0).toBeLessThan(5000)
    await held.release()
  })
})

describe("wipe never disturbs live locks", () => {
  it("wipe never unlinks a live refresh lock (file)", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    const refresh = await lock.acquireTraktRefreshLock(created.uuid)
    const file = path.join(tempDir!, "trakt-locks", `${created.uuid.toLowerCase()}.refresh.lock`)
    const before = await fsp.readFile(file, "utf-8")
    const { deleteUser } = await import("@/lib/user-activity")
    await deleteUser(created.uuid)
    // The wipe removed the namespace but must leave the live refresh
    // holder's mutex alone (offline cleanup only): the file survives
    // byte-identical and the holder still releases it owner-checked.
    expect(await fsp.readFile(file, "utf-8")).toBe(before)
    await refresh.release()
    expect(await fsp.stat(file).catch(() => null)).toBeNull()
  })

  it("wipe never unlinks a live mutation lock (file)", async () => {
    const { auth, lock } = await loadAll()
    const created = await auth.createUser()
    const held = await lock.acquireTraktProfileLock(created.uuid)
    const file = path.join(tempDir!, "trakt-locks", `${created.uuid.toLowerCase()}.lock`)
    const before = await fsp.readFile(file, "utf-8")
    const { deleteUser } = await import("@/lib/user-activity")
    // Best-effort contention: the wipe proceeds (fencing already protects
    // writers) without touching the live holder's file. (20 s budget: the
    // wipe's best-effort lock acquire waits its full 5 s window here.)
    await deleteUser(created.uuid)
    expect(await fsp.readFile(file, "utf-8")).toBe(before)
    await held.release()
    expect(await fsp.stat(file).catch(() => null)).toBeNull()
  }, 20000)

  it("wipe never clears a live mutation lock (KV)", async () => {
    asKv()
    const { auth, trakt, lock } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: false })
    const held = await lock.acquireTraktProfileLock(created.uuid, { waitMs: 5000 })
    const { deleteUser } = await import("@/lib/user-activity")
    await deleteUser(created.uuid)
    // The live holder's mutex survived the wipe (orphans expire via TTL): a
    // contender still contends, and the holder's release still lands.
    // (20 s budget: the wipe's best-effort lock acquire waits its full 5 s
    // window here.)
    await expect(lock.acquireTraktProfileLock(created.uuid, { waitMs: 150 })).rejects.toThrowError(
      lock.TraktLockUnavailableError,
    )
    await held.release()
  }, 20000)
})

describe("lease-loss and newer-token safety (KV)", () => {
  it("mutex lease expired mid-exchange: commit aborts, stale holder writes nothing", async () => {
    asKv()
    const { auth, trakt, lock } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })

    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let started = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/oauth/revoke")) return new Response("{}", { status: 200 })
      started = true
      return gate
    })
    // Short lease: the holder's mutex expires while the exchange is gated.
    const pending = trakt.getValidTraktAccessToken(created.uuid, { lockTtlMs: 300 })
    await waitFor(() => started)
    await new Promise((r) => setTimeout(r, 500))
    // A contender legitimately wins the expired mutex…
    const contender = await lock.acquireTraktProfileLock(created.uuid, { waitMs: 5000 })

    release(new Response(JSON.stringify(tokenReply()), { status: 200, headers: { "Content-Type": "application/json" } }))
    const res = await pending
    // …so the stale holder's commit aborts on the ownership proof (the
    // generation never moved — the abort is purely the lost lease).
    expect(res).toEqual({ ok: false, reason: "temporary" })
    const kept = await trakt.getTraktTokens(created.uuid)
    expect(kept.status).toBe("connected")
    if (kept.status === "connected") {
      expect(kept.tokens.accessToken).toBe(OLD_ACCESS)
      expect(kept.tokens.refreshToken).toBe(OLD_REFRESH)
    }
    await contender.release()

    // Lease free again: the retry refreshes exactly once.
    vi.restoreAllMocks()
    const { calls } = stubTokenFetch()
    const retry = await trakt.getValidTraktAccessToken(created.uuid)
    expect(retry).toEqual({ ok: true, accessToken: NEW_ACCESS, refreshed: true })
    expect(calls.filter((u) => u.endsWith("/oauth/token"))).toHaveLength(1)
  })

  it("invalid_grant never deletes a newer reconnect (conditional clear)", async () => {
    asKv()
    const { auth, trakt, lock } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })

    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let started = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      started = true
      return gate
    })
    const pending = trakt.getValidTraktAccessToken(created.uuid)
    await waitFor(() => started)

    // Meanwhile a newer coordinated write lands (reconnect with valid
    // tokens): raw store + explicit fence, the net effect of a guarded save.
    await trakt.saveTraktTokens(created.uuid, {
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: Date.now() + 3600_000,
      redirectUri: REDIRECT_DUCK,
    })
    await lock.bumpTraktGeneration(created.uuid)

    release(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    const res = await pending
    // The dead grant loses to the valid newer record: reused, never deleted.
    expect(res).toEqual({ ok: true, accessToken: NEW_ACCESS, refreshed: false })
    const kept = await trakt.getTraktTokens(created.uuid)
    expect(kept.status).toBe("connected")
    if (kept.status === "connected") {
      expect(kept.tokens.accessToken).toBe(NEW_ACCESS)
      expect(kept.tokens.refreshToken).toBe(NEW_REFRESH)
    }
  })
})

describe("newer-token safety (file)", () => {
  it("invalid_grant never deletes a newer reconnect (conditional clear)", async () => {
    const { auth, trakt, lock } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })

    let release!: (v: Response) => void
    const gate = new Promise<Response>((resolve) => {
      release = resolve
    })
    let started = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      started = true
      return gate
    })
    const pending = trakt.getValidTraktAccessToken(created.uuid)
    await waitFor(() => started)

    await trakt.saveTraktTokens(created.uuid, {
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: Date.now() + 3600_000,
      redirectUri: REDIRECT_DUCK,
    })
    await lock.bumpTraktGeneration(created.uuid)

    release(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
    const res = await pending
    expect(res).toEqual({ ok: true, accessToken: NEW_ACCESS, refreshed: false })
    const kept = await trakt.getTraktTokens(created.uuid)
    expect(kept.status).toBe("connected")
    if (kept.status === "connected") {
      expect(kept.tokens.accessToken).toBe(NEW_ACCESS)
      expect(kept.tokens.refreshToken).toBe(NEW_REFRESH)
    }
  })
})

describe("initiation-bound OAuth state", () => {
  it("authorize -> disconnect -> callback cannot relink (file)", async () => {
    const { auth, authorize, callback, disconnect, trakt } = await loadAll()
    const created = await auth.createUser()
    const init = await authorize.POST(
      new NextRequest(`http://localhost/api/users/${created.uuid}/trakt/authorize`, {
        method: "POST",
        headers: { "x-user-token": created.secret },
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(init.status).toBe(200)
    const initBody = (await init.json()) as { authorizeUrl: string }
    const initMatch = /pictorium_trakt_oauth=([^;]+)/.exec(init.headers.get("set-cookie")!)
    if (!initMatch) throw new Error("binding cookie missing")
    const state = new URL(initBody.authorizeUrl).searchParams.get("state")!
    const cookie = `pictorium_trakt_oauth=${initMatch[1]}`

    // Disconnect AFTER the flow started: the initiation snapshot is stale.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/oauth/revoke")) return new Response("{}", { status: 200 })
      throw new Error("exchange must not be attempted for a fenced flow")
    })
    const del = await disconnect.DELETE(
      deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(await del.json()).toEqual({ ok: true, revoked: false })

    const res = await callback.GET(
      new NextRequest(`http://localhost/api/trakt/callback?code=late&state=${state}`, {
        headers: { cookie },
      }),
    )
    expect(res.headers.get("location")).toBe(`/u/${created.uuid}/configure?trakt=failed`)
    expect(fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith("/oauth/token"))).toHaveLength(0)
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
    expect(await fsp.stat(path.join(tempDir!, "users", created.uuid, "trakt.json")).catch(() => null)).toBeNull()
  })

  it("authorize -> disconnect -> callback cannot relink (KV)", async () => {
    asKv()
    const { auth, authorize, callback, disconnect, trakt } = await loadAll()
    const created = await auth.createUser()
    const init = await authorize.POST(
      new NextRequest(`http://localhost/api/users/${created.uuid}/trakt/authorize`, {
        method: "POST",
        headers: { "x-user-token": created.secret },
      }),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(init.status).toBe(200)
    const initBody = (await init.json()) as { authorizeUrl: string }
    const initMatch = /pictorium_trakt_oauth=([^;]+)/.exec(init.headers.get("set-cookie")!)
    if (!initMatch) throw new Error("binding cookie missing")
    const state = new URL(initBody.authorizeUrl).searchParams.get("state")!
    const cookie = `pictorium_trakt_oauth=${initMatch[1]}`

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/oauth/revoke")) return new Response("{}", { status: 200 })
      throw new Error("exchange must not be attempted for a fenced flow")
    })
    const del = await disconnect.DELETE(
      deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(await del.json()).toEqual({ ok: true, revoked: false })

    const res = await callback.GET(
      new NextRequest(`http://localhost/api/trakt/callback?code=late&state=${state}`, {
        headers: { cookie },
      }),
    )
    expect(res.headers.get("location")).toBe(`/u/${created.uuid}/configure?trakt=failed`)
    expect(fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith("/oauth/token"))).toHaveLength(0)
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
    expect(kvStore.has(`user:${created.uuid}:trakt`)).toBe(false)
  })
})

describe("generation outage fails closed", () => {
  it("unreadable generation: refresh attempts nothing, record intact", async () => {
    const { auth, trakt } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: true })
    // IO failure (not absence): the generation path is a directory, so the
    // read throws EISDIR instead of resolving to null.
    await fsp.mkdir(path.join(tempDir!, "users", created.uuid, "trakt.gen"))
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await trakt.getValidTraktAccessToken(created.uuid)
    expect(res).toEqual({ ok: false, reason: "temporary" })
    expect(fetchSpy).not.toHaveBeenCalled()
    const kept = await trakt.getTraktTokens(created.uuid)
    expect(kept.status).toBe("connected")
    if (kept.status === "connected") {
      expect(kept.tokens.accessToken).toBe(OLD_ACCESS)
      expect(kept.tokens.refreshToken).toBe(OLD_REFRESH)
    }
  })

  it("KV disconnect EVAL outage: 503, no success claim, record intact", async () => {
    asKv()
    const { auth, trakt, disconnect } = await loadAll()
    const created = await auth.createUser()
    await seedTokens(trakt, created.uuid, { expired: false })
    stubTokenFetch()
    kvCtl.evalFail = true

    const res = await disconnect.DELETE(
      deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(res.status).toBe(503)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("connected")

    // Outage over: the same disconnect succeeds.
    kvCtl.evalFail = false
    const retry = await disconnect.DELETE(
      deleteReq(`http://localhost/api/users/${created.uuid}/trakt/disconnect`, created.secret),
      { params: Promise.resolve({ uuid: created.uuid }) },
    )
    expect(await retry.json()).toEqual({ ok: true, revoked: true })
    expect(await trakt.getTraktTokenStatus(created.uuid)).toBe("disconnected")
  })
})
