import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import crypto from "node:crypto"

// Regressione: su istanze con Redis/KV l'auth admin via sessione PIN deve
// funzionare anche su un'istanza serverless "fredda" (cache in-memory vuota).
// Il vecchio path sync (readSecurityConfigSync) non può leggere la KV e
// falliva chiuso in locale → 401 intermittenti. checkAdminToken deve usare il
// path async che legge la KV.
//
// Nota sul mock: setup.ts importa già @/lib/pin-auth (con la KV reale), quindi
// il mock di @/lib/kv richiede vi.resetModules() + re-import dinamico — stesso
// pattern del blocco KV in pin-auth.test.ts.
const getMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/kv", () => ({
  getStorageMode: () => "kv",
  getKv: () => ({
    get: getMock,
    set: async () => {},
  }),
}))

const SESSION_SECRET = "cold-cache-test-session-secret"
const PIN_HASH = `${"ab".repeat(8)}:${"cd".repeat(64)}`

function sessionToken(payload: string, secret: string): string {
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex")
  return `${payload}.${signature}`
}

function reqWithSession(token: string | null): Request {
  const headers: Record<string, string> = {}
  if (token) headers.cookie = `pictorium_pin_session=${encodeURIComponent(token)}`
  return new Request("http://localhost:3000/api/mappings", { headers })
}

describe("admin auth on a KV cold cache", () => {
  const savedEnv = { ...process.env }
  let checkAdminToken: (req: Request) => Promise<boolean>

  beforeEach(async () => {
    delete process.env.PICTORIUM_ADMIN_TOKEN
    delete process.env.POSTERIUM_ADMIN_TOKEN
    delete process.env.ADMIN_TOKEN
    getMock.mockReset()
    getMock.mockResolvedValue({ pinHash: PIN_HASH, sessionSecret: SESSION_SECRET })
    // Istanza "fredda": moduli ricaricati, cache in-memory vuota.
    vi.resetModules()
    const pinAuth = await import("@/lib/pin-auth")
    const auth = await import("@/lib/auth")
    pinAuth._resetPinCache()
    checkAdminToken = auth.checkAdminToken
  })

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  it("accepts a valid PIN session read from KV with an empty in-memory cache", async () => {
    const token = sessionToken(String(Date.now() + 60_000), SESSION_SECRET)
    await expect(checkAdminToken(reqWithSession(token))).resolves.toBe(true)
    // Prova che la config è arrivata davvero dalla KV (e non dalla cache locale).
    expect(getMock).toHaveBeenCalledWith("security")
  })

  it("rejects a tampered session signature", async () => {
    const token = sessionToken(String(Date.now() + 60_000), SESSION_SECRET)
    const bad = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0")
    await expect(checkAdminToken(reqWithSession(bad))).resolves.toBe(false)
    expect(getMock).toHaveBeenCalled()
  })

  it("rejects a missing session", async () => {
    await expect(checkAdminToken(reqWithSession(null))).resolves.toBe(false)
  })

  it("skips the KV read entirely when no session credential is present (hot path)", async () => {
    await expect(checkAdminToken(reqWithSession(null))).resolves.toBe(false)
    expect(getMock).not.toHaveBeenCalled()
  })

  it("reads KV but still rejects when no PIN is configured", async () => {
    getMock.mockResolvedValue({})
    const token = sessionToken(String(Date.now() + 60_000), SESSION_SECRET)
    await expect(checkAdminToken(reqWithSession(token))).resolves.toBe(false)
    expect(getMock).toHaveBeenCalledWith("security")
  })
})
