import crypto from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { Mapping } from "@/lib/types"

// Store KV in-memory con scan: valida il cablaggio user-activity ->
// kv.ts -> @/lib/upstash-kv-client senza rete. Attivo solo con KV_REST_API_URL/TOKEN.
const kvMemory = vi.hoisted(() => new Map<string, unknown>())
function kvGlobToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`)
}
vi.mock("@/lib/upstash-kv-client", () => ({
  kv: {
    get: async (key: string) => kvMemory.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvMemory.set(key, value)
    },
    del: async (key: string) => (kvMemory.delete(key) ? 1 : 0),
    scan: async (cursor: number, opts?: { match?: string; count?: number }) => {
      void cursor
      void opts?.count
      const re = kvGlobToRegExp(opts?.match ?? "*")
      return [0, [...kvMemory.keys()].filter((k) => re.test(k))]
    },
  },
}))

const ENV_KEYS = [
  "PICTORIUM_DATA_DIR",
  "PICTORIUM_MULTI_USER",
  "PICTORIUM_MAX_MAPPINGS_PER_USER",
  "PICTORIUM_USER_RETENTION_DAYS",
  "PICTORIUM_UNUSED_USER_GRACE_DAYS",
  "PROFILE_ENCRYPTION_KEY",
  "PICTORIUM_TMDB_KEY",
  "PICTORIUM_HOSTED_BY",
  "POSTERIUM_HOSTED_BY",
  "ADMIN_TOKEN",
  "PICTORIUM_PUBLIC_STATS",
  "POSTERIUM_PUBLIC_STATS",
] as const
let savedEnv: Record<string, string | undefined> = {}
let tempDir: string | undefined

beforeEach(async () => {
  savedEnv = {}
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-slice3-"))
  process.env.PICTORIUM_DATA_DIR = tempDir
  process.env.PICTORIUM_MULTI_USER = "1"
  process.env.PROFILE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex")
  process.env.ADMIN_TOKEN = "admin-secret"
  delete process.env.PICTORIUM_MAX_MAPPINGS_PER_USER
  delete process.env.PICTORIUM_USER_RETENTION_DAYS
  delete process.env.PICTORIUM_UNUSED_USER_GRACE_DAYS
  delete process.env.PICTORIUM_TMDB_KEY
  delete process.env.PICTORIUM_HOSTED_BY
  delete process.env.POSTERIUM_HOSTED_BY
  delete process.env.PICTORIUM_PUBLIC_STATS
  delete process.env.POSTERIUM_PUBLIC_STATS
})

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.resetModules()
  vi.restoreAllMocks()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function makeMapping(id: number, title: string): Mapping {
  return {
    tmdbId: id,
    mediaType: "movie",
    title,
    posterPath: `/p${id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    updatedAt: new Date().toISOString(),
  }
}

function nextReq(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): NextRequest {
  return new NextRequest(url, init)
}

async function createUser(): Promise<{ uuid: string; secret: string }> {
  vi.resetModules()
  const auth = await import("@/lib/user-auth")
  return auth.createUser()
}

describe("import/export namespaced", () => {
  it("import nel namespace (token), mai nel globale; export isolato; quota 413", async () => {
    const { uuid, secret } = await createUser()
    vi.resetModules()
    const importRoute = await import("@/app/api/mappings/import/route")
    const exportRoute = await import("@/app/api/mappings/export/route")
    const store = await import("@/lib/store")
    const headers = { "Content-Type": "application/json", "x-user-token": secret }
    const url = `http://localhost:3000/api/mappings/import?u=${uuid}`

    const res = await importRoute.POST(
      nextReq(url, { method: "POST", headers, body: JSON.stringify({ mappings: [makeMapping(1, "Uno"), makeMapping(2, "Due")] }) }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(2)
    expect(await store.getAll(uuid)).toHaveLength(2)
    expect(await store.getAll()).toHaveLength(0)

    const exp = await exportRoute.GET(nextReq(`http://localhost:3000/api/mappings/export?u=${uuid}`, { headers }))
    expect(exp.status).toBe(200)
    expect((await exp.json()).mappings).toHaveLength(2)

    // Senza token → 401, niente scrittura.
    const anon = await importRoute.POST(
      nextReq(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mappings: [makeMapping(9, "X")] }) }),
    )
    expect(anon.status).toBe(401)
    expect(await store.getAll(uuid)).toHaveLength(2)

    // Quota per-utente sull'import.
    process.env.PICTORIUM_MAX_MAPPINGS_PER_USER = "2"
    const over = await importRoute.POST(
      nextReq(url, { method: "POST", headers, body: JSON.stringify({ mappings: [makeMapping(3, "Tre")] }) }),
    )
    expect(over.status).toBe(413)
  })

  it("import-global: solo admin, copia globale→namespace con quota", async () => {
    vi.resetModules()
    const store = await import("@/lib/store")
    await store.upsert(makeMapping(1, "Globale"))
    const route = await import("@/app/api/users/[uuid]/import-global/route")
    const { uuid } = await createUser()

    const anon = await route.POST(nextReq(`http://x/api/users/${uuid}/import-global`, { method: "POST" }), {
      params: Promise.resolve({ uuid }),
    })
    expect(anon.status).toBe(401)
    expect(await store.getAll(uuid)).toHaveLength(0)

    const ok = await route.POST(
      nextReq(`http://x/api/users/${uuid}/import-global`, { method: "POST", headers: { "x-admin-token": "admin-secret" } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).count).toBe(1)
    expect((await store.getById("movie", 1, uuid))?.title).toBe("Globale")
    // Il globale resta intatto.
    expect(await store.getAll()).toHaveLength(1)
  })
})

describe("wipe account (GDPR)", () => {
  it("DELETE cancella il namespace e invalida il token; token errato → 401", async () => {
    const { uuid, secret } = await createUser()
    vi.resetModules()
    const store = await import("@/lib/store")
    const keys = await import("@/lib/user-keys")
    const defaults = await import("@/lib/server-defaults")
    const route = await import("@/app/api/users/[uuid]/route")
    await store.upsert(makeMapping(1, "Mio"), uuid)
    await keys.setUserKeys(uuid, { tmdb: "k" })
    await defaults.setServerDefaultsForUser(uuid, { badgeStyle: "pill" })

    const wrong = await route.DELETE(
      nextReq(`http://x/api/users/${uuid}`, { method: "DELETE", headers: { "x-user-token": "nope" } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(wrong.status).toBe(401)
    expect(await store.getAll(uuid)).toHaveLength(1)

    const res = await route.DELETE(
      nextReq(`http://x/api/users/${uuid}`, { method: "DELETE", headers: { "x-user-token": secret } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(res.status).toBe(200)
    expect(await store.getAll(uuid)).toHaveLength(0)
    expect(await keys.getUserKeysStatus(uuid)).toEqual({ tmdb: false, mdblist: false, tvdb: false, simkl: false, fanart: false })
    // Auth cancellata: il token non verifica più (secondo DELETE → 401).
    const auth = await import("@/lib/user-auth")
    expect(await auth.verifyUserToken(uuid, secret)).toBe(false)
    const again = await route.DELETE(
      nextReq(`http://x/api/users/${uuid}`, { method: "DELETE", headers: { "x-user-token": secret } }),
      { params: Promise.resolve({ uuid }) },
    )
    expect(again.status).toBe(401)
  })
})

describe("cleanup inattivi", () => {
  it("retention 0 = disabilitato", async () => {
    process.env.PICTORIUM_USER_RETENTION_DAYS = "0"
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    expect(activity.getUserRetentionDays()).toBe(0)
    expect(await activity.cleanupInactiveUsers()).toMatchObject({ removed: 0, disabled: true })
  })

  it("rimuove solo gli inattivi oltre soglia, mai senza lastAccess", async () => {
    process.env.PICTORIUM_USER_RETENTION_DAYS = "30"
    const { uuid: oldUuid } = await createUser()
    const { uuid: freshUuid } = await createUser()
    const { uuid: nodataUuid } = await createUser()
    vi.resetModules()
    const store = await import("@/lib/store")
    const activity = await import("@/lib/user-activity")
    await store.upsert(makeMapping(1, "Vecchio"), oldUuid)
    await store.upsert(makeMapping(2, "Fresco"), freshUuid)
    // Vecchio: attività 60gg fa. Fresco: tocco ora.
    await fsp.writeFile(
      path.join(tempDir!, "users", oldUuid, "activity.json"),
      JSON.stringify({ lastAccess: new Date(Date.now() - 60 * 86400000).toISOString() }),
    )
    activity.touchUserActivity(freshUuid)
    await new Promise((r) => setTimeout(r, 50))

    const result = await activity.cleanupInactiveUsers()
    expect(result.removed).toBe(1)
    expect(await store.getAll(oldUuid)).toHaveLength(0)
    expect(await store.getAll(freshUuid)).toHaveLength(1)
    // Senza lastAccess noto (solo auth fresca) → tenuto.
    expect(await store.getAll(nodataUuid)).toHaveLength(0)
    const kept = (await activity.listUsers()).map((u) => u.uuid)
    expect(kept).toContain(freshUuid)
    expect(kept).toContain(nodataUuid)
    expect(kept).not.toContain(oldUuid)
  })

  it("cleanup route: solo admin", async () => {
    vi.resetModules()
    const route = await import("@/app/api/users/cleanup/route")
    const anon = await route.POST(nextReq("http://x/api/users/cleanup", { method: "POST" }))
    expect(anon.status).toBe(401)
    const ok = await route.POST(
      nextReq("http://x/api/users/cleanup", { method: "POST", headers: { "x-admin-token": "admin-secret" } }),
    )
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ disabled: false, retentionDays: 180 })
  })

  it("cleanup route: rifiuta cross-origin anche con admin token (anti-CSRF, v1.23.0)", async () => {
    vi.resetModules()
    const route = await import("@/app/api/users/cleanup/route")
    const evil = await route.POST(
      nextReq("http://x/api/users/cleanup", {
        method: "POST",
        headers: { "x-admin-token": "admin-secret", origin: "https://evil.example.com" },
      }),
    )
    expect(evil.status).toBe(403)
  })
})

describe("status aggregates", () => {
  it("GET /api/status: solo aggregati, mai UUID/segreti", async () => {
    await createUser()
    vi.resetModules()
    const route = await import("@/app/api/status/route")
    const res = await route.GET(nextReq("http://x/api/status"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.multiUser).toBe(true)
    expect(body.users).toBe(1)
    expect(typeof body.activeUsers).toBe("number")
    expect(body.activeUsers).toBeGreaterThanOrEqual(0)
    expect(body.activeUsers).toBeLessThanOrEqual(body.users)
    expect(typeof body.maxUsers).toBe("number")
    expect(body.maxUsers).toBeGreaterThanOrEqual(0)
    expect(typeof body.usersBytes).toBe("number")
    expect(body.keysEncryption).toBe(true)
    expect(body.keyMissing).toMatchObject({ catalogs: expect.any(Number), keyMissing: expect.any(Number) })
    expect(JSON.stringify(body)).not.toContain("11111111")
  })
})

describe("status PUBLIC_STATS", () => {
  const COUNT_FIELDS = ["users", "activeUsers", "maxUsers", "usersBytes", "keysEncryption", "keyMissing"]

  async function status(headers?: Record<string, string>) {
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    const spy = vi.spyOn(activity, "listUsers")
    const route = await import("@/app/api/status/route")
    const res = await route.GET(nextReq("http://x/api/status", { headers }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const body = await res.json()
    const scanned = spy.mock.calls.length > 0
    spy.mockRestore()
    return { body, scanned }
  }

  it("PUBLIC_STATS=0: anonimo riceve solo multiUser/hostedBy e nessuna scansione storage", async () => {
    await createUser()
    process.env.PICTORIUM_PUBLIC_STATS = "0"
    const { body, scanned } = await status()
    expect(body.multiUser).toBe(true)
    expect(body).toHaveProperty("hostedBy")
    for (const k of COUNT_FIELDS) expect(body).not.toHaveProperty(k)
    expect(scanned).toBe(false)
  })

  it("PUBLIC_STATS=false e legacy POSTERIUM_PUBLIC_STATS=0 nascondono i conteggi", async () => {
    await createUser()
    process.env.PICTORIUM_PUBLIC_STATS = "false"
    expect((await status()).body).not.toHaveProperty("users")
    delete process.env.PICTORIUM_PUBLIC_STATS
    process.env.POSTERIUM_PUBLIC_STATS = "0"
    expect((await status()).body).not.toHaveProperty("users")
  })

  it("PUBLIC_STATS=0: token errato non vede i conteggi", async () => {
    await createUser()
    process.env.PICTORIUM_PUBLIC_STATS = "0"
    expect((await status({ "x-admin-token": "nope" })).body).not.toHaveProperty("users")
  })

  it("PUBLIC_STATS=0: admin (x-admin-token o Bearer) vede ancora gli aggregati", async () => {
    await createUser()
    process.env.PICTORIUM_PUBLIC_STATS = "0"
    const adminHeaders: Record<string, string>[] = [{ "x-admin-token": "admin-secret" }, { authorization: "Bearer admin-secret" }]
    for (const headers of adminHeaders) {
      const { body, scanned } = await status(headers)
      expect(body.users).toBe(1)
      expect(typeof body.activeUsers).toBe("number")
      expect(scanned).toBe(true)
    }
  })

  it("default (flag assente): aggregati pubblici come prima", async () => {
    await createUser()
    expect((await status()).body.users).toBe(1)
  })
})

describe("status hostedBy", () => {
  async function hostedBy(env?: string, headers?: Record<string, string>): Promise<unknown> {
    if (env === undefined) delete process.env.PICTORIUM_HOSTED_BY
    else process.env.PICTORIUM_HOSTED_BY = env
    vi.resetModules()
    const route = await import("@/app/api/status/route")
    const res = await route.GET(nextReq("http://x/api/status", { headers }))
    expect(res.status).toBe(200)
    return (await res.json()).hostedBy
  }

  it("default null senza env né host elfhosted", async () => {
    expect(await hostedBy()).toBeNull()
  })

  it("env elfhosted (case-insensitive, trim) → hostedBy", async () => {
    expect(await hostedBy("elfhosted")).toBe("elfhosted")
    expect(await hostedBy(" ElfHosted ")).toBe("elfhosted")
  })

  it("whitelist rigida: altri valori → null, mai echo", async () => {
    expect(await hostedBy("evil\"><script>")).toBeNull()
    expect(await hostedBy("none")).toBeNull()
    expect(await hostedBy("0")).toBeNull()
  })

  it("fallback best-effort da host senza env", async () => {
    expect(await hostedBy(undefined, { host: "pictorium.elfhosted.com" })).toBe("elfhosted")
  })

  it("fallback da x-forwarded-host senza env", async () => {
    expect(await hostedBy(undefined, { "x-forwarded-host": "pictorium.elfhosted.com" })).toBe("elfhosted")
  })

  it("env elfhosted vince su host normale", async () => {
    expect(await hostedBy("elfhosted", { host: "pictorium.duckdns.org" })).toBe("elfhosted")
  })
})

describe("touch activity", () => {
  it("scrive lastAccess throttled senza rompere il chiamante", async () => {
    const { uuid } = await createUser()
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    activity.touchUserActivity(uuid)
    await new Promise((r) => setTimeout(r, 50))
    const raw = await fsp.readFile(path.join(tempDir!, "users", uuid, "activity.json"), "utf-8")
    const parsed = JSON.parse(raw) as { lastAccess: string }
    expect(Date.parse(parsed.lastAccess)).toBeGreaterThan(Date.now() - 60_000)
    // Secondo tocco immediato: nessun throw, nessun loop.
    activity.touchUserActivity(uuid)
  })

  it("non crea directory/chiavi per UUID inventati (anti-crescita incontrollata, v1.23.0)", async () => {
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    const invented = "00000000-0000-4000-8000-000000000000"
    activity.touchUserActivity(invented)
    await new Promise((r) => setTimeout(r, 50))
    await expect(fsp.stat(path.join(tempDir!, "users", invented))).rejects.toThrow()
  })

  it("activityTtlSec segue la retention, cap 1 anno se disabilitata", async () => {
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    expect(activity.activityTtlSec(180)).toBe(180 * 86400)
    expect(activity.activityTtlSec(0)).toBe(365 * 86400)
  })
})

describe("KV backend (Redis/Upstash via lib/kv)", () => {
  it("listUsers trova i namespace via scan, con lastAccess e senza file", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    try {
      vi.resetModules()
      const auth = await import("@/lib/user-auth")
      const activity = await import("@/lib/user-activity")
      const u1 = await auth.createUser()
      const u2 = await auth.createUser()
      activity.touchUserActivity(u1.uuid)
      await new Promise((r) => setTimeout(r, 50))

      const users = await activity.listUsers()
      const uuids = users.map((u) => u.uuid)
      expect(uuids).toContain(u1.uuid)
      expect(uuids).toContain(u2.uuid)
      expect(users.find((u) => u.uuid === u1.uuid)?.lastAccess).toBeTruthy()
      expect(users.every((u) => u.bytes === -1)).toBe(true)
      // Mai file su disco (ramo KV preso davvero).
      expect(await fsp.stat(path.join(tempDir!, "users")).catch(() => null)).toBeNull()
    } finally {
      delete process.env.KV_REST_API_URL
      delete process.env.KV_REST_API_TOKEN
      kvMemory.clear()
      vi.resetModules()
    }
  })
})

describe("cleanup spazi mai usati", () => {
  const DAY = 86400000
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
  const armFile = async (days: number) => {
    await fsp.mkdir(path.join(tempDir!, "instance"), { recursive: true })
    await fsp.writeFile(path.join(tempDir!, "instance", "unused-user-cleanup-armed.json"), JSON.stringify({ armedAt: ago(days) }))
  }
  const backdateFile = async (uuid: string, days: number) => {
    const file = path.join(tempDir!, "users", uuid, "auth.json")
    const rec = JSON.parse(await fsp.readFile(file, "utf-8")) as Record<string, unknown>
    rec.createdAt = ago(days)
    await fsp.writeFile(file, JSON.stringify(rec))
  }

  it("default 14 giorni, 0 = disabilitato, valori invalidi = default", async () => {
    vi.resetModules()
    let activity = await import("@/lib/user-activity")
    expect(activity.getUnusedUserGraceDays()).toBe(14)
    process.env.PICTORIUM_UNUSED_USER_GRACE_DAYS = "0"
    vi.resetModules()
    activity = await import("@/lib/user-activity")
    expect(activity.getUnusedUserGraceDays()).toBe(0)
    process.env.PICTORIUM_UNUSED_USER_GRACE_DAYS = "abc"
    vi.resetModules()
    activity = await import("@/lib/user-activity")
    expect(activity.getUnusedUserGraceDays()).toBe(14)
  })

  it("file mode: rimuove solo gli spazi vecchi senza attività né chiavi", async () => {
    const backdate = async (uuid: string, days: number) => {
      const file = path.join(tempDir!, "users", uuid, "auth.json")
      const rec = JSON.parse(await fsp.readFile(file, "utf-8")) as Record<string, unknown>
      rec.createdAt = ago(days)
      await fsp.writeFile(file, JSON.stringify(rec))
    }
    const { uuid: unused } = await createUser()
    const { uuid: withKeys } = await createUser()
    const { uuid: withActivity } = await createUser()
    const { uuid: young } = await createUser()
    await backdate(unused, 30)
    await backdate(withKeys, 30)
    await backdate(withActivity, 30)
    await backdate(young, 3)
    await armFile(30)
    vi.resetModules()
    const keys = await import("@/lib/user-keys")
    const activity = await import("@/lib/user-activity")
    await keys.setUserKeys(withKeys, { tmdb: "tmdb-key-value" })
    activity.touchUserActivity(withActivity)
    await new Promise((r) => setTimeout(r, 50))

    const result = await activity.cleanupInactiveUsers()
    expect(result).toMatchObject({ removed: 1, removedUnused: 1, kept: 3 })
    const left = (await activity.listUsers()).map((u) => u.uuid)
    expect(left).not.toContain(unused)
    expect(left).toEqual(expect.arrayContaining([withKeys, withActivity, young]))
  })

  it("KV mode: rimuove lo spazio abbandonato, fail-safe sugli errori di lettura", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    try {
      vi.resetModules()
      const auth = await import("@/lib/user-auth")
      const keys = await import("@/lib/user-keys")
      const activity = await import("@/lib/user-activity")
      const backdate = (uuid: string, days: number) => {
        const rec = kvMemory.get(`user:${uuid}:auth`) as Record<string, unknown>
        kvMemory.set(`user:${uuid}:auth`, { ...rec, createdAt: ago(days) })
      }
      const unused = (await auth.createUser()).uuid
      const withKeys = (await auth.createUser()).uuid
      const withActivity = (await auth.createUser()).uuid
      const young = (await auth.createUser()).uuid
      const readFails = (await auth.createUser()).uuid
      const legacy = (await auth.createUser()).uuid
      const arrayKeys = (await auth.createUser()).uuid
      const partialBundle = (await auth.createUser()).uuid
      const emptyKeys = (await auth.createUser()).uuid
      for (const u of [unused, withKeys, withActivity, readFails, arrayKeys, partialBundle, emptyKeys]) backdate(u, 30)
      // Record chiavi malformati → tenuti; record riconosciuto e vuoto → nessuna chiave.
      kvMemory.set(`user:${arrayKeys}:keys`, { version: 1, keys: [], updatedAt: ago(1) })
      kvMemory.set(`user:${partialBundle}:keys`, { version: 1, keys: { tmdb: { iv: "x", ct: "y" } }, updatedAt: ago(1) })
      kvMemory.set(`user:${emptyKeys}:keys`, { version: 1, keys: {}, updatedAt: ago(1) })
      // Usato in passato: activity scaduta (TTL), resta il marker durevole.
      const expiredActivity = (await auth.createUser()).uuid
      backdate(expiredActivity, 30)
      kvMemory.set(`user:${expiredActivity}:used`, "1")
      kvMemory.set("instance:unused-user-cleanup-armed-at", ago(30))
      backdate(young, 3)
      const legacyRec = { ...(kvMemory.get(`user:${legacy}:auth`) as Record<string, unknown>) }
      delete legacyRec.createdAt
      kvMemory.set(`user:${legacy}:auth`, legacyRec)
      await keys.setUserKeys(withKeys, { tmdb: "tmdb-key-value" })
      activity.touchUserActivity(withActivity)
      await new Promise((r) => setTimeout(r, 50))
      // Defaults salvati dall'editor senza chiavi non contano come uso.
      kvMemory.set(`defaults:${unused}`, { some: "defaults" })

      const realGet = kvMemory.get.bind(kvMemory)
      vi.spyOn(kvMemory, "get").mockImplementation((key: string) => {
        if (key === `user:${readFails}:activity`) throw new Error("redis down")
        return realGet(key)
      })

      const result = await activity.cleanupInactiveUsers()
      expect(result).toMatchObject({ removed: 2, removedUnused: 2, kept: 8 })
      expect(kvMemory.has(`user:${unused}:auth`)).toBe(false)
      expect(kvMemory.has(`defaults:${unused}`)).toBe(false)
      expect(kvMemory.has(`user:${emptyKeys}:auth`)).toBe(false)
      expect(kvMemory.get(`user:${withActivity}:used`)).toBe("1")
      for (const u of [withKeys, withActivity, young, readFails, legacy, arrayKeys, partialBundle, expiredActivity]) {
        expect(kvMemory.has(`user:${u}:auth`)).toBe(true)
      }
    } finally {
      delete process.env.KV_REST_API_URL
      delete process.env.KV_REST_API_TOKEN
      kvMemory.clear()
      vi.resetModules()
    }
  })

  it("rollout: il primo run arma la regola e non rimuove nulla fino a fine grace", async () => {
    const { uuid } = await createUser()
    await backdateFile(uuid, 30)
    vi.resetModules()
    let activity = await import("@/lib/user-activity")
    expect(await activity.cleanupInactiveUsers()).toMatchObject({ removed: 0, kept: 1 })
    const armed = JSON.parse(
      await fsp.readFile(path.join(tempDir!, "instance", "unused-user-cleanup-armed.json"), "utf-8"),
    ) as { armedAt: string }
    expect(Date.now() - Date.parse(armed.armedAt)).toBeLessThan(60000)
    // Secondo run subito dopo: ancora dentro la grace dal momento dell'armamento.
    vi.resetModules()
    activity = await import("@/lib/user-activity")
    expect(await activity.cleanupInactiveUsers()).toMatchObject({ removed: 0, kept: 1 })
    await armFile(15)
    vi.resetModules()
    activity = await import("@/lib/user-activity")
    expect(await activity.cleanupInactiveUsers()).toMatchObject({ removed: 1, removedUnused: 1 })
  })

  it("manifest via ?u= e /c/<config>/ registra attività (KV)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    try {
      vi.resetModules()
      const auth = await import("@/lib/user-auth")
      const a = (await auth.createUser()).uuid
      const b = (await auth.createUser()).uuid
      const plain = await import("@/app/manifest.json/route")
      await plain.GET(nextReq(`http://x/manifest.json?u=${a}`))
      const withConfig = await import("@/app/c/[config]/manifest.json/route")
      await withConfig.GET(nextReq(`http://x/c/abc/manifest.json?u=${b}`), { params: Promise.resolve({ config: "abc" }) })
      await new Promise((r) => setTimeout(r, 50))
      expect(kvMemory.get(`user:${a}:used`)).toBe("1")
      expect(kvMemory.get(`user:${b}:used`)).toBe("1")
    } finally {
      delete process.env.KV_REST_API_URL
      delete process.env.KV_REST_API_TOKEN
      kvMemory.clear()
      vi.resetModules()
    }
  })

  it("proxy addon con ?u= registra attività", async () => {
    const { uuid } = await createUser()
    vi.resetModules()
    const proxy = await import("@/app/api/proxy/[...path]/route")
    // Target mancante → 400, ma lo spazio reale viene comunque segnato come usato.
    await proxy.GET(nextReq(`http://x/api/proxy/manifest.json?u=${uuid}`), { params: Promise.resolve({ path: ["manifest.json"] }) })
    await new Promise((r) => setTimeout(r, 50))
    expect(await fsp.stat(path.join(tempDir!, "users", uuid, "activity.json"))).toBeTruthy()
  })

  it("grace 0: nessuno spazio mai usato viene rimosso", async () => {
    process.env.PICTORIUM_UNUSED_USER_GRACE_DAYS = "0"
    const { uuid } = await createUser()
    const file = path.join(tempDir!, "users", uuid, "auth.json")
    const rec = JSON.parse(await fsp.readFile(file, "utf-8")) as Record<string, unknown>
    rec.createdAt = ago(30)
    await fsp.writeFile(file, JSON.stringify(rec))
    vi.resetModules()
    const activity = await import("@/lib/user-activity")
    expect(await activity.cleanupInactiveUsers()).toMatchObject({ removed: 0, removedUnused: 0, kept: 1 })
  })
})
