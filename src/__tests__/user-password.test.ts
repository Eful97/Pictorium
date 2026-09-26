import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

// Store KV in-memory: valida il cablaggio user-auth -> kv.ts -> @vercel/kv
// senza rete. Attivo solo quando il test imposta KV_REST_API_URL/TOKEN.
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
  },
}))

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PICTORIUM_MAX_MAPPINGS_PER_USER",
  "PROFILE_ENCRYPTION_KEY",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-userpw-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  delete process.env.PICTORIUM_MAX_MAPPINGS_PER_USER
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvStore.clear()
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvStore.clear()
  vi.resetModules()
  vi.restoreAllMocks()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function nextReq(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): NextRequest {
  return new NextRequest(url, init)
}

describe("user password (stile AIO)", () => {
  it("create con password: entrambe le credenziali valide, secret mai persistito", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const created = await auth.createUser("mypassword123")
    expect(await auth.verifyUserPassword(created.uuid, "mypassword123")).toBe(true)
    expect(await auth.verifyUserPassword(created.uuid, "  mypassword123  ")).toBe(true)
    expect(await auth.verifyUserPassword(created.uuid, "wrongpass1")).toBe(false)
    expect(await auth.verifyUserToken(created.uuid, created.secret)).toBe(true)
    expect(await auth.hasUserPassword(created.uuid)).toBe(true)
    const raw = await fsp.readFile(path.join(tempDir!, "users", created.uuid, "auth.json"), "utf-8")
    expect(raw).not.toContain("mypassword123")
    expect(raw).not.toContain(created.secret)
  })

  it("senza password: verify false, secret valido (retrocompat)", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const created = await auth.createUser()
    expect(await auth.verifyUserPassword(created.uuid, "anything12")).toBe(false)
    expect(await auth.hasUserPassword(created.uuid)).toBe(false)
    expect(await auth.verifyUserToken(created.uuid, created.secret)).toBe(true)
  })

  it("record legacy {hash} senza passwordHash: si legge ancora", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const created = await auth.createUser()
    expect(await auth.verifyUserToken(created.uuid, created.secret)).toBe(true)
  })

  it("set/clear con validazione: corta, non-stringa, ok", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const created = await auth.createUser()
    await expect(auth.setUserPassword(created.uuid, "short")).rejects.toThrowError(auth.InvalidUserPasswordError)
    await expect(auth.setUserPassword(created.uuid, 123 as unknown as string)).rejects.toThrowError(auth.InvalidUserPasswordError)
    await expect(auth.setUserPassword(created.uuid, "x".repeat(129))).rejects.toThrowError(auth.InvalidUserPasswordError)
    await auth.setUserPassword(created.uuid, "with spaces inside 1")
    expect(await auth.verifyUserPassword(created.uuid, "with spaces inside 1")).toBe(true)
    // Il secret resta valido dopo il set.
    expect(await auth.verifyUserToken(created.uuid, created.secret)).toBe(true)
    await auth.clearUserPassword(created.uuid)
    expect(await auth.verifyUserPassword(created.uuid, "with spaces inside 1")).toBe(false)
    expect(await auth.hasUserPassword(created.uuid)).toBe(false)
  })

  it("checkUserAuth: token ok, password ok, niente → false", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const created = await auth.createUser("daily-pass-99")
    const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null })
    expect(await auth.checkUserAuth({ headers: headers({ "x-user-token": created.secret }) }, created.uuid)).toBe(true)
    expect(await auth.checkUserAuth({ headers: headers({ "x-user-password": "daily-pass-99" }) }, created.uuid)).toBe(true)
    expect(await auth.checkUserAuth({ headers: headers({ "x-user-password": "nope-nope-no" }) }, created.uuid)).toBe(false)
    expect(await auth.checkUserAuth({ headers: headers({}) }, created.uuid)).toBe(false)
    expect(auth.extractUserPassword({ headers: headers({ "x-user-password": "p" }) })).toBe("p")
    expect(auth.extractUserPassword({ headers: headers({}) })).toBeNull()
  })
})

describe("password API routes", () => {
  it("POST /api/users richiede la password (min 8); assente/corta → 400", async () => {
    vi.resetModules()
    const route = await import("@/app/api/users/route")
    const auth = await import("@/lib/user-auth")
    const ok = await route.POST(nextReq("http://x/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "create-pass-1" }),
    }))
    expect(ok.status).toBe(200)
    const created = await ok.json()
    expect(await auth.verifyUserPassword(created.uuid, "create-pass-1")).toBe(true)

    const bad = await route.POST(nextReq("http://x/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "x" }),
    }))
    expect(bad.status).toBe(400)

    // Senza body e con body vuoto: 400 (niente spazi senza login).
    const plain = await route.POST(nextReq("http://x/api/users", { method: "POST" }))
    expect(plain.status).toBe(400)
    const empty = await route.POST(nextReq("http://x/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }))
    expect(empty.status).toBe(400)
  })

  it("POST verify: ok / 401 / 400 / uuid invalido", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const route = await import("@/app/api/users/[uuid]/verify/route")
    const created = await auth.createUser("verify-me-12")
    const base = `http://x/api/users/${created.uuid}/verify`
    const good = await route.POST(nextReq(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "verify-me-12" }),
    }), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(good.status).toBe(200)

    const wrong = await route.POST(nextReq(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrongpass1" }),
    }), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(wrong.status).toBe(401)

    const missing = await route.POST(nextReq(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(missing.status).toBe(400)

    const badUuid = await route.POST(nextReq(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "verify-me-12" }),
    }), { params: Promise.resolve({ uuid: "nope" }) })
    expect(badUuid.status).toBe(400)
  })

  it("PUT password: set col secret, cambio con vecchia, 401 senza current, clear", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const route = await import("@/app/api/users/[uuid]/password/route")
    const created = await auth.createUser()
    const base = `http://x/api/users/${created.uuid}/password`
    const json = { "Content-Type": "application/json" }

    // Primo set col secret (niente current).
    const set = await route.PUT(nextReq(base, {
      method: "PUT",
      headers: { ...json, "x-user-token": created.secret },
      body: JSON.stringify({ password: "first-pass-1" }),
    }), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(set.status).toBe(200)
    expect(await auth.verifyUserPassword(created.uuid, "first-pass-1")).toBe(true)

    // Cambio senza current e senza secret → 401.
    const noAuth = await route.PUT(nextReq(base, {
      method: "PUT", headers: json,
      body: JSON.stringify({ password: "second-pass-2" }),
    }), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(noAuth.status).toBe(401)

    // Cambio con vecchia password.
    const change = await route.PUT(nextReq(base, {
      method: "PUT", headers: json,
      body: JSON.stringify({ password: "second-pass-2", current: "first-pass-1" }),
    }), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(change.status).toBe(200)
    expect(await auth.verifyUserPassword(created.uuid, "second-pass-2")).toBe(true)
    expect(await auth.verifyUserPassword(created.uuid, "first-pass-1")).toBe(false)

    // Clear con secret (resta il secret).
    const clear = await route.PUT(nextReq(base, {
      method: "PUT",
      headers: { ...json, "x-user-token": created.secret },
      body: JSON.stringify({ password: null }),
    }), { params: Promise.resolve({ uuid: created.uuid }) })
    expect(clear.status).toBe(200)
    expect(await auth.hasUserPassword(created.uuid)).toBe(false)
    expect(await auth.verifyUserToken(created.uuid, created.secret)).toBe(true)
  })

  it("endpoint scoped accettano x-user-password (mappings + keys)", async () => {
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const mappings = await import("@/app/api/mappings/route")
    const keys = await import("@/app/api/users/[uuid]/keys/route")
    const created = await auth.createUser("scoped-pass-7")
    const pw = { "x-user-password": "scoped-pass-7" }

    const post = await mappings.POST(nextReq(`http://x/api/mappings?u=${created.uuid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...pw },
      body: JSON.stringify({ tmdbId: 5, mediaType: "movie", title: "T", posterPath: "/p.jpg" }),
    }))
    expect(post.status).toBe(200)

    const get = await mappings.GET(nextReq(`http://x/api/mappings?u=${created.uuid}`, { headers: pw }))
    expect(get.status).toBe(200)
    expect((await get.json()).mappings).toHaveLength(1)

    const k = await keys.GET(nextReq(`http://x/api/users/${created.uuid}/keys`, { headers: pw }), {
      params: Promise.resolve({ uuid: created.uuid }),
    })
    expect(k.status).toBe(200)
    expect(await k.json()).toMatchObject({ tmdb: false, hasPassword: true })
  })
})

describe("user-auth KV backend (Redis/Upstash via lib/kv)", () => {
  it("createUser/userExists/verify round-trip sulla KV condivisa tra istanze", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.resetModules()
    const auth = await import("@/lib/user-auth")
    const created = await auth.createUser("kv-password-1")
    expect(await auth.userExists(created.uuid)).toBe(true)
    expect(await auth.verifyUserToken(created.uuid, created.secret)).toBe(true)
    expect(await auth.verifyUserPassword(created.uuid, "kv-password-1")).toBe(true)

    // Altra istanza (modulo ricaricato): legge dalla KV condivisa.
    vi.resetModules()
    const reloaded = await import("@/lib/user-auth")
    expect(await reloaded.userExists(created.uuid)).toBe(true)
    expect(await reloaded.verifyUserToken(created.uuid, created.secret)).toBe(true)
    expect(await reloaded.verifyUserPassword(created.uuid, "kv-password-1")).toBe(true)
    expect(await reloaded.userExists("00000000-0000-4000-8000-000000000000")).toBe(false)
  })
})
