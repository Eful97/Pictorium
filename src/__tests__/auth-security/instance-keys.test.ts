import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// KV backend in-memory: exercises the real `kv.ts` adapter (and therefore the
// KV branch of instance-keys) without network or a real deployment.
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
    del: async (key: string) => (kvStore.delete(key) ? 1 : 0),
    incr: async (key: string) => {
      const next = Number(kvStore.get(key) ?? 0) + 1
      kvStore.set(key, next)
      return next
    },
    expire: async () => 1,
  },
}))

const TEST_ADMIN_TOKEN = "instance-keys-admin-token"
const UUID_A = "11111111-1111-4111-8111-111111111111"
const UUID_B = "22222222-2222-4222-8222-222222222222"
const PROFILE_KEY_HEX = crypto.randomBytes(32).toString("hex")
const API = "http://localhost:3000/api/instance-keys"

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_MULTI_USER",
  "POSTERIUM_MULTI_USER",
  "PICTORIUM_MULTI_USER_ALLOW_ENV_FALLBACK",
  "POSTERIUM_MULTI_USER_ALLOW_ENV_FALLBACK",
  "PICTORIUM_TMDB_KEY",
  "POSTERIUM_TMDB_KEY",
  "TMDB_KEY",
  "TMDB_API_KEY",
  "PICTORIUM_MDBLIST_KEY",
  "POSTERIUM_MDBLIST_KEY",
  "MDBLIST_KEY",
  "MDBLIST_API_KEY",
  "PICTORIUM_TVDB_API_KEY",
  "TVDB_API_KEY",
  "PICTORIUM_SIMKL_CLIENT_ID",
  "SIMKL_CLIENT_ID",
  "PICTORIUM_FANART_KEY",
  "FANART_KEY",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "PICTORIUM_RATELIMIT_KV",
  "ADMIN_TOKEN",
  "PICTORIUM_ADMIN_TOKEN",
  "POSTERIUM_ADMIN_TOKEN",
] as const

let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

beforeEach(async () => {
  savedEnv = {}
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-instance-keys-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
  delete process.env.PROFILE_ENCRYPTION_KEY
  delete process.env.PICTORIUM_MULTI_USER
  delete process.env.POSTERIUM_MULTI_USER
  delete process.env.PICTORIUM_MULTI_USER_ALLOW_ENV_FALLBACK
  delete process.env.POSTERIUM_MULTI_USER_ALLOW_ENV_FALLBACK
  delete process.env.PICTORIUM_TMDB_KEY
  delete process.env.POSTERIUM_TMDB_KEY
  delete process.env.TMDB_KEY
  delete process.env.TMDB_API_KEY
  delete process.env.PICTORIUM_MDBLIST_KEY
  delete process.env.POSTERIUM_MDBLIST_KEY
  delete process.env.MDBLIST_KEY
  delete process.env.MDBLIST_API_KEY
  delete process.env.PICTORIUM_TVDB_API_KEY
  delete process.env.TVDB_API_KEY
  delete process.env.PICTORIUM_SIMKL_CLIENT_ID
  delete process.env.SIMKL_CLIENT_ID
  delete process.env.PICTORIUM_FANART_KEY
  delete process.env.FANART_KEY
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.PICTORIUM_RATELIMIT_KV
  kvStore.clear()
  vi.resetModules()
})

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  kvStore.clear()
  vi.resetModules()
  vi.restoreAllMocks()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function nextReq(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): NextRequest {
  return new NextRequest(url, init)
}

function putReq(body: unknown, headers?: Record<string, string>): NextRequest {
  return nextReq(API, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-admin-token": TEST_ADMIN_TOKEN,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function anonymousKeyRequest(url = "http://x/"): { headers: Headers; nextUrl: { searchParams: URLSearchParams } } {
  return {
    headers: new Headers(),
    nextUrl: { searchParams: new URL(url).searchParams },
  }
}

describe("instance keys store (file mode)", () => {
  it("PUT persists encrypted (0600), GET returns presence only, anonymous resolve uses it with zero env", async () => {
    const SECRET = "tmdb-instance-secret-abc123"
    const route = await import("@/app/api/instance-keys/route")

    const putRes = await route.PUT(putReq({ tmdb: `  ${SECRET}  ` }))
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as Record<string, unknown>
    expect(putBody).toMatchObject({ tmdb: true, storage: "file", writable: true, decryptable: true })
    expect(JSON.stringify(putBody)).not.toContain(SECRET)

    const getRes = await route.GET(nextReq(API))
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get("cache-control")).toBe("no-store")
    const getBody = (await getRes.json()) as Record<string, unknown>
    expect(getBody).toMatchObject({
      tmdb: true,
      mdblist: false,
      tvdb: false,
      simkl: false,
      fanart: false,
      storage: "file",
      writable: true,
      decryptable: true,
    })
    expect(JSON.stringify(getBody)).not.toContain(SECRET)
    expect(getBody).not.toHaveProperty("values")
    expect(getBody).not.toHaveProperty("keys")

    // At rest: never plaintext; generated instance key persisted 0600.
    const keysPath = path.join(tempDir!, "instance", "keys.json")
    const raw = await fsp.readFile(keysPath, "utf-8")
    expect(raw).not.toContain(SECRET)
    const parsed = JSON.parse(raw) as { keys: { tmdb: Record<string, unknown> } }
    expect(parsed.keys.tmdb).toMatchObject({
      iv: expect.any(String),
      tag: expect.any(String),
      data: expect.any(String),
    })
    const encPath = path.join(tempDir!, "instance", "enc.key")
    const enc = (await fsp.readFile(encPath, "utf-8")).trim()
    expect(enc).toMatch(/^[0-9a-f]{64}$/)
    if (process.platform !== "win32") {
      expect((await fsp.stat(keysPath)).mode & 0o777).toBe(0o600)
      expect((await fsp.stat(encPath)).mode & 0o777).toBe(0o600)
    }

    // Anonymous Stremio-shaped request: zero env, key comes from the store.
    const tmdb = await import("@/lib/tmdb")
    const resolved = await tmdb.resolveUserApiKeys(anonymousKeyRequest(), null)
    expect(resolved.tmdb).toEqual({ key: SECRET, source: "instance" })

    const keys = await import("@/lib/instance-keys")
    expect(await keys.getInstanceKeys()).toEqual({ tmdb: SECRET })
  })

  it("clear semantics: \"\"/null clears, absent kind is unchanged", async () => {
    const route = await import("@/app/api/instance-keys/route")
    expect((await route.PUT(putReq({ tmdb: "tmdb-key-1", mdblist: "mdb-key-1" }))).status).toBe(200)
    let body = (await (await route.GET(nextReq(API))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ tmdb: true, mdblist: true })

    expect((await route.PUT(putReq({ tmdb: "" }))).status).toBe(200)
    body = (await (await route.GET(nextReq(API))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ tmdb: false, mdblist: true })

    expect((await route.PUT(putReq({ mdblist: null }))).status).toBe(200)
    body = (await (await route.GET(nextReq(API))).json()) as Record<string, unknown>
    expect(body).toMatchObject({ tmdb: false, mdblist: false })
  })

  it("decryptable=false and degraded (no throw) when the stored bundle cannot be decrypted", async () => {
    process.env.PROFILE_ENCRYPTION_KEY = PROFILE_KEY_HEX
    const keys = await import("@/lib/instance-keys")
    await keys.setInstanceKeys({ tmdb: "profile-protected-key" })
    // No generated instance key exists (write used the profile key).
    delete process.env.PROFILE_ENCRYPTION_KEY
    vi.resetModules()

    const reloaded = await import("@/lib/instance-keys")
    const status = await reloaded.getInstanceKeyStatus()
    expect(status.tmdb).toBe(true)
    expect(status.decryptable).toBe(false)
    // Hot path degrades to "missing" instead of throwing.
    expect(await reloaded.getInstanceKeys()).toEqual({})
  })
})

describe("instance keys precedence (resolveUserApiKeys)", () => {
  it("header/query > namespace > instance > env; scoped ?u= never sees the instance store", async () => {
    const INSTANCE_KEY = "instance-key-1234"
    process.env.PICTORIUM_MULTI_USER = "1"
    process.env.PROFILE_ENCRYPTION_KEY = PROFILE_KEY_HEX

    const keys = await import("@/lib/instance-keys")
    await keys.setInstanceKeys({ tmdb: INSTANCE_KEY })
    const userKeys = await import("@/lib/user-keys")
    await userKeys.setUserKeys(UUID_A, { tmdb: "namespace-key-1234" })
    const tmdb = await import("@/lib/tmdb")

    // Explicit request wins over everything.
    let r = await tmdb.resolveUserApiKey(
      {
        headers: new Headers({ "x-api-key": "header-key" }),
        nextUrl: { searchParams: new URLSearchParams("api_key=query-key") },
      },
      UUID_A,
      "tmdb",
    )
    expect(r).toEqual({ key: "header-key", source: "header" })
    r = await tmdb.resolveUserApiKey(
      { headers: new Headers(), nextUrl: { searchParams: new URLSearchParams("api_key=query-key") } },
      UUID_A,
      "tmdb",
    )
    expect(r).toEqual({ key: "query-key", source: "query" })

    // Namespace wins over the instance store.
    r = await tmdb.resolveUserApiKey(
      { headers: new Headers(), nextUrl: { searchParams: new URLSearchParams(`u=${UUID_A}`) } },
      UUID_A,
      "tmdb",
    )
    expect(r).toEqual({ key: "namespace-key-1234", source: "namespace" })

    // Scoped request without namespace keys: the instance store is NOT used
    // (same gate as the env fallback — no open proxy on the operator key).
    r = await tmdb.resolveUserApiKey(
      { headers: new Headers(), nextUrl: { searchParams: new URLSearchParams(`u=${UUID_B}`) } },
      UUID_B,
      "tmdb",
    )
    expect(r).toEqual({ key: undefined, source: "none" })

    // Global request: instance wins over env.
    process.env.PICTORIUM_TMDB_KEY = "env-key-1234"
    r = await tmdb.resolveUserApiKey({ headers: new Headers(), nextUrl: { searchParams: new URLSearchParams() } }, null, "tmdb")
    expect(r).toEqual({ key: INSTANCE_KEY, source: "instance" })

    // Empty instance store: env fallback still works (no regression).
    await keys.setInstanceKeys({ tmdb: "" })
    r = await tmdb.resolveUserApiKey({ headers: new Headers(), nextUrl: { searchParams: new URLSearchParams() } }, null, "tmdb")
    expect(r).toEqual({ key: "env-key-1234", source: "env" })
  })

  it("multi-user OFF still applies the instance store to a request that carries ?u=", async () => {
    const INSTANCE_KEY = "instance-key-mu-off"
    delete process.env.PICTORIUM_MULTI_USER
    const keys = await import("@/lib/instance-keys")
    await keys.setInstanceKeys({ tmdb: INSTANCE_KEY })
    const tmdb = await import("@/lib/tmdb")
    const r = await tmdb.resolveUserApiKey(
      { headers: new Headers(), nextUrl: { searchParams: new URLSearchParams(`u=${UUID_A}`) } },
      null,
      "tmdb",
    )
    expect(r).toEqual({ key: INSTANCE_KEY, source: "instance" })
  })
})

describe("instance keys KV mode", () => {
  it("uses KV instance:keys/instance:enc (no file branch) and resolves anonymously", async () => {
    process.env.KV_REST_API_URL = "https://kv.test"
    process.env.KV_REST_API_TOKEN = "kv-token"
    process.env.PICTORIUM_RATELIMIT_KV = "0"
    vi.resetModules()
    const SECRET = "kv-instance-secret-9876"
    const kv = await import("@/lib/kv")
    expect(kv.getStorageMode()).toBe("kv")
    const route = await import("@/app/api/instance-keys/route")

    const putRes = await route.PUT(putReq({ tmdb: SECRET }))
    expect(putRes.status).toBe(200)
    const getBody = (await (await route.GET(nextReq(API))).json()) as Record<string, unknown>
    expect(getBody).toMatchObject({ tmdb: true, storage: "kv", writable: true, decryptable: true })
    expect(JSON.stringify(getBody)).not.toContain(SECRET)

    expect(kvStore.has("instance:keys")).toBe(true)
    expect(kvStore.has("instance:enc")).toBe(true)
    expect(JSON.stringify(kvStore.get("instance:keys"))).not.toContain(SECRET)
    // KV mode never touches the file branch.
    await expect(fsp.stat(path.join(tempDir!, "instance", "keys.json"))).rejects.toMatchObject({ code: "ENOENT" })

    const tmdb = await import("@/lib/tmdb")
    const resolved = await tmdb.resolveUserApiKeys(anonymousKeyRequest(), null)
    expect(resolved.tmdb).toEqual({ key: SECRET, source: "instance" })
  })
})

describe("instance keys API security", () => {
  it("rejects PUT without admin token (401) and cross-origin (403); validates the body (400)", async () => {
    const route = await import("@/app/api/instance-keys/route")

    delete process.env.ADMIN_TOKEN
    delete process.env.PICTORIUM_ADMIN_TOKEN
    delete process.env.POSTERIUM_ADMIN_TOKEN
    const unauth = await route.PUT(
      nextReq(API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tmdb: "should-not-save" }),
      }),
    )
    expect(unauth.status).toBe(401)

    // Restore admin for the authenticated checks below.
    process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
    const crossOrigin = await route.PUT(putReq({ tmdb: "x" }, { origin: "https://evil.example" }))
    expect(crossOrigin.status).toBe(403)

    expect((await route.PUT(putReq({ tmdb: "a".repeat(300) }))).status).toBe(400)
    expect((await route.PUT(putReq({ tmdb: "has whitespace" }))).status).toBe(400)
    expect((await route.PUT(putReq({ tmdb: { nested: true } }))).status).toBe(400)

    // Nothing was persisted by the rejected requests.
    const getBody = (await (await route.GET(nextReq(API))).json()) as Record<string, unknown>
    expect(getBody).toMatchObject({ tmdb: false })
  })

  it("fails closed with 503 when the file store cannot be persisted", async () => {
    // A regular file where the store directory should be makes mkdir/persist fail.
    await fsp.writeFile(path.join(tempDir!, "instance"), "blocker")
    const route = await import("@/app/api/instance-keys/route")

    const getBody = (await (await route.GET(nextReq(API))).json()) as Record<string, unknown>
    expect(getBody).toMatchObject({ storage: "file", writable: false, tmdb: false })

    const res = await route.PUT(putReq({ tmdb: "never-persisted-plaintext" }))
    expect(res.status).toBe(503)
    const body = (await res.json()) as Record<string, unknown>
    expect(String(body.error)).toMatch(/unavailable/i)
  })

  it("never logs key values (log spy clean)", async () => {
    const SECRET = "log-spy-secret-4242"
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const route = await import("@/app/api/instance-keys/route")
    await route.PUT(putReq({ tmdb: SECRET }))
    await route.GET(nextReq(API))
    const logged = [...spy.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .map((args) => args.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "))
      .join("\n")
    expect(logged).not.toContain(SECRET)
  })
})

const REVEAL_API = "http://localhost:3000/api/instance-keys/reveal"

function revealReq(
  body: unknown,
  opts?: { admin?: boolean; headers?: Record<string, string> },
): NextRequest {
  const admin = opts?.admin !== false
  return nextReq(REVEAL_API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(admin ? { "x-admin-token": TEST_ADMIN_TOKEN } : {}),
      ...opts?.headers,
    },
    body: JSON.stringify(body),
  })
}

describe("instance keys reveal (explicit, admin-only)", () => {
  it("401 without admin, 403 cross-origin, 400 malformed, 404 unknown/unset kind, 200 value for the stored kind (never logged)", async () => {
    const SECRET = "reveal-secret-9090"
    const keysRoute = await import("@/app/api/instance-keys/route")
    const revealRoute = await import("@/app/api/instance-keys/reveal/route")
    expect((await keysRoute.PUT(putReq({ tmdb: SECRET }))).status).toBe(200)

    // 401: no admin token and no PIN session.
    delete process.env.ADMIN_TOKEN
    delete process.env.PICTORIUM_ADMIN_TOKEN
    delete process.env.POSTERIUM_ADMIN_TOKEN
    let res = await revealRoute.POST(revealReq({ kind: "tmdb" }, { admin: false }))
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain(SECRET)

    process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN

    // 403: cross-origin mutation even with admin credentials.
    res = await revealRoute.POST(revealReq({ kind: "tmdb" }, { headers: { origin: "https://evil.example" } }))
    expect(res.status).toBe(403)

    // 400: malformed body; 404: unknown kind and known-but-unset kind.
    expect((await revealRoute.POST(revealReq(null))).status).toBe(400)
    expect((await revealRoute.POST(revealReq({ kind: "bogus" }))).status).toBe(404)
    expect((await revealRoute.POST(revealReq({ kind: "mdblist" }))).status).toBe(404)

    // 200: the single explicit read, value in the JSON body only.
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    res = await revealRoute.POST(revealReq({ kind: "tmdb" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ kind: "tmdb", value: SECRET })

    // Presence status stays value-free (the reveal never widens GET).
    const getBody = (await (await keysRoute.GET(nextReq(API))).json()) as Record<string, unknown>
    expect(getBody).toMatchObject({ tmdb: true })
    expect(getBody).not.toHaveProperty("value")
    expect(JSON.stringify(getBody)).not.toContain(SECRET)

    const logged = [...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .map((args) => args.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" "))
      .join("\n")
    expect(logged).not.toContain(SECRET)
  })

  it("is rate limited on the shared instance-keys bucket", async () => {
    const revealRoute = await import("@/app/api/instance-keys/reveal/route")
    const statuses: number[] = []
    for (let i = 0; i < 130; i++) {
      // Unknown kind = cheap 404 that still consumes a rate-limit token.
      const res = await revealRoute.POST(revealReq({ kind: "bogus" }))
      statuses.push(res.status)
    }
    expect(statuses.filter((s) => s === 404).length).toBeGreaterThan(0)
    expect(statuses).toContain(429)
  })
})

describe("instance keys are never exported by backups", () => {
  it("stripBackupSecrets drops the presence flag and every key-like field", async () => {
    const { stripBackupSecrets } = await import("@/lib/backup-schema")
    const cleaned = stripBackupSecrets({
      hasInstanceKeys: { tmdbKey: true },
      serverKeys: { tmdbKey: "secret" },
      tmdbKey: "secret",
      mdblistApiKey: "secret",
      badgeStyle: "shadow",
    })
    expect(cleaned).toEqual({ badgeStyle: "shadow" })
  })
})

describe("defaults integration", () => {
  it("hasInstanceKeys includes the store, serverKeys stays env-only, values never leave", async () => {
    const SECRET = "defaults-instance-secret-0001"
    const instanceRoute = await import("@/app/api/instance-keys/route")
    expect((await instanceRoute.PUT(putReq({ tmdb: SECRET }))).status).toBe(200)

    const defaults = await import("@/app/api/defaults/route")
    const publicBody = (await (
      await defaults.GET(nextReq("http://localhost:3000/api/defaults"))
    ).json()) as Record<string, unknown>
    expect(publicBody.hasInstanceKeys).toMatchObject({ tmdbKey: true, mdblistKey: false, tvdbKey: false })
    expect(publicBody).not.toHaveProperty("serverKeys")
    expect(JSON.stringify(publicBody)).not.toContain(SECRET)

    // Authenticated admin: serverKeys is still the ENV projection only, never
    // an echo of the instance store.
    const adminBody = (await (
      await defaults.GET(
        nextReq("http://localhost:3000/api/defaults", { headers: { "x-admin-token": TEST_ADMIN_TOKEN } }),
      )
    ).json()) as Record<string, unknown>
    expect(adminBody).toHaveProperty("serverKeys")
    expect((adminBody.serverKeys as Record<string, unknown>).tmdbKey).toBe("")
    expect(JSON.stringify(adminBody)).not.toContain(SECRET)
  })
})
