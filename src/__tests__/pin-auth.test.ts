import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import {
  hasPinConfigured,
  verifyPin,
  setPin,
  removePin,
  createSessionToken,
  verifySessionToken,
  buildSessionCookie,
  extractSessionToken,
  _resetPinCache,
} from "@/lib/pin-auth"
import { checkAdminToken } from "@/lib/auth"
import { NextRequest } from "next/server"
import { GET, POST, PUT, DELETE } from "@/app/api/auth/pin/route"

// Store KV in-memory: valida il cablaggio pin-auth -> kv.ts -> @vercel/kv
// senza rete. Attivo solo quando il test imposta KV_REST_API_URL/TOKEN
// (gli altri test restano in file-mode).
const kvStore = vi.hoisted(() => new Map<string, unknown>())
vi.mock("@vercel/kv", () => ({
  kv: {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kvStore.set(key, value)
    },
  },
}))

function createReq(method: string, pathUrl: string, body?: unknown, headers?: Record<string, string>): NextRequest {
  const reqHeaders: Record<string, string> = {
    host: "localhost:3000",
    origin: "http://localhost:3000",
    ...(headers ?? {}),
  }
  if (body) {
    reqHeaders["content-type"] = "application/json"
    return new NextRequest(`http://localhost:3000${pathUrl}`, {
      method,
      headers: reqHeaders,
      body: JSON.stringify(body),
    })
  }
  return new NextRequest(`http://localhost:3000${pathUrl}`, {
    method,
    headers: reqHeaders,
  })
}

describe("PIN Authentication & Security", () => {
  let tempDir: string
  let file: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pin-auth-test-"))
    process.env.PICTORIUM_DATA_DIR = tempDir
    file = path.join(tempDir, "security.json")
  })

  afterAll(async () => {
    _resetPinCache()
    delete process.env.PICTORIUM_DATA_DIR
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {}
  })

  beforeEach(async () => {
    _resetPinCache()
    try {
      await fs.unlink(file)
    } catch {}
  })

  afterEach(async () => {
    _resetPinCache()
    try {
      await fs.unlink(file)
    } catch {}
  })

  it("inizia senza PIN configurato", async () => {
    expect(await hasPinConfigured()).toBe(false)
  })

  it("imposta un nuovo PIN e lo verifica", async () => {
    const success = await setPin("123456")
    expect(success).toBe(true)
    expect(await hasPinConfigured()).toBe(true)

    expect(await verifyPin("123456")).toBe(true)
    expect(await verifyPin("000000")).toBe(false)
    expect(await verifyPin("")).toBe(false)
  })

  it("rifiuta PIN troppo corti (< 6 cifre)", async () => {
    expect(await setPin("123")).toBe(false)
    expect(await setPin("12345")).toBe(false)
    expect(await hasPinConfigured()).toBe(false)
  })

  it("crea e valida i token di sessione firmati HMAC", async () => {
    await setPin("654321")
    const token = await createSessionToken()
    expect(token).toBeTruthy()
    expect(await verifySessionToken(token)).toBe(true)

    // Token manomesso
    expect(await verifySessionToken(token + "x")).toBe(false)
    // Token malformato
    expect(await verifySessionToken("invalid.token")).toBe(false)
  })

  it("estrae correttamente il token da cookie o header", async () => {
    await setPin("999999")
    const token = (await createSessionToken())!
    const cookie = buildSessionCookie(token)

    const reqWithCookie = new Request("http://localhost:3000/api/mappings", {
      headers: { cookie },
    })
    expect(extractSessionToken(reqWithCookie)).toBe(token)

    const reqWithHeader = new Request("http://localhost:3000/api/mappings", {
      headers: { "x-pin-token": token },
    })
    expect(extractSessionToken(reqWithHeader)).toBe(token)
  })

  it("consente checkAdminToken solo con sessione valida quando il PIN è attivo", async () => {
    await setPin("777777")
    const token = (await createSessionToken())!
    const cookie = buildSessionCookie(token)

    // Senza cookie di sessione -> fallisce
    const unauthReq = new Request("http://localhost:3000/api/mappings")
    expect(checkAdminToken(unauthReq)).toBe(false)

    // Con cookie di sessione valido -> passa
    const authReq = new Request("http://localhost:3000/api/mappings", {
      headers: { cookie },
    })
    expect(checkAdminToken(authReq)).toBe(true)
  })

  it("rimuove il PIN solo con il PIN corrente corretto", async () => {
    await setPin("555555")
    expect(await removePin("wrong")).toBe(false)
    expect(await hasPinConfigured()).toBe(true)

    expect(await removePin("555555")).toBe(true)
    expect(await hasPinConfigured()).toBe(false)
  })

  describe("API Route /api/auth/pin", () => {
    it("GET: riporta hasPin: false se nessun PIN è impostato", async () => {
      const res = await GET(createReq("GET", "/api/auth/pin"))
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(json.hasPin).toBe(false)
      expect(json.authenticated).toBe(true)
      expect(typeof json.hasAdminToken).toBe("boolean")
    })

    it("PUT: imposta un nuovo PIN con successo", async () => {
      const res = await PUT(createReq("PUT", "/api/auth/pin", { newPin: "123456" }))
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)

      const cookieHeader = res.headers.get("set-cookie")
      expect(cookieHeader).toContain("pictorium_pin_session=")
    })

    it("PUT: rifiuta PIN sotto 6 cifre", async () => {
      const res = await PUT(createReq("PUT", "/api/auth/pin", { newPin: "12345" }))
      expect(res.status).toBe(400)
    })

    it("cambiare PIN invalida le sessioni precedenti (rotazione secret)", async () => {
      await setPin("111111")
      const oldToken = await createSessionToken()
      expect(await verifySessionToken(oldToken)).toBe(true)

      await setPin("222222")
      expect(await verifySessionToken(oldToken)).toBe(false)
      const newToken = await createSessionToken()
      expect(await verifySessionToken(newToken)).toBe(true)
    })

    it("POST: login con PIN corretto ed errato", async () => {
      // 1. Imposta PIN
      await PUT(createReq("PUT", "/api/auth/pin", { newPin: "987654" }))

      // 2. Login con PIN errato -> 401
      const failRes = await POST(createReq("POST", "/api/auth/pin", { pin: "000000" }))
      expect(failRes.status).toBe(401)

      // 3. Login con PIN corretto -> 200 + Set-Cookie
      const okRes = await POST(createReq("POST", "/api/auth/pin", { pin: "987654" }))
      expect(okRes.status).toBe(200)
      const json = await okRes.json()
      expect(json.success).toBe(true)
      expect(okRes.headers.get("set-cookie")).toContain("pictorium_pin_session=")
    })

    it("DELETE: rimuove il PIN solo fornendo quello corretto", async () => {
      await PUT(createReq("PUT", "/api/auth/pin", { newPin: "555555" }))

      // Tentativo con PIN errato
      const failDel = await DELETE(createReq("DELETE", "/api/auth/pin", { currentPin: "wrong" }))
      expect(failDel.status).toBe(401)

      // Tentativo con PIN corretto
      const okDel = await DELETE(createReq("DELETE", "/api/auth/pin", { currentPin: "555555" }))
      expect(okDel.status).toBe(200)

      const checkRes = await GET(createReq("GET", "/api/auth/pin"))
      const json = await checkRes.json()
      expect(json.hasPin).toBe(false)
    })
  })

  describe("KV backend (Redis/Upstash via lib/kv)", () => {
    it("setPin/verifyPin round-trip sulla KV condivisa tra istanze", async () => {
      process.env.KV_REST_API_URL = "https://example.upstash.io"
      process.env.KV_REST_API_TOKEN = "test-token"
      try {
        vi.resetModules()
        const fresh = await import("@/lib/pin-auth")
        fresh._resetPinCache()
        expect(await fresh.hasPinConfigured()).toBe(false)
        expect(await fresh.setPin("123456")).toBe(true)
        expect(await fresh.hasPinConfigured()).toBe(true)
        expect(await fresh.verifyPin("123456")).toBe(true)
        expect(await fresh.verifyPin("000000")).toBe(false)

        // Altra istanza (modulo ricaricato): legge dalla KV condivisa.
        vi.resetModules()
        const reloaded = await import("@/lib/pin-auth")
        expect(await reloaded.verifyPin("123456")).toBe(true)
      } finally {
        delete process.env.KV_REST_API_URL
        delete process.env.KV_REST_API_TOKEN
        kvStore.clear()
        vi.resetModules()
      }
    })
  })

  describe("binding PIN↔admin token (v1.23.0)", () => {
    const OLD_ENV = { pictorium: process.env.PICTORIUM_ADMIN_TOKEN, bare: process.env.ADMIN_TOKEN }
    afterEach(() => {
      if (OLD_ENV.pictorium === undefined) delete process.env.PICTORIUM_ADMIN_TOKEN
      else process.env.PICTORIUM_ADMIN_TOKEN = OLD_ENV.pictorium
      if (OLD_ENV.bare === undefined) delete process.env.ADMIN_TOKEN
      else process.env.ADMIN_TOKEN = OLD_ENV.bare
    })

    it("il PIN impostato via token muore con la rotazione dell'env", async () => {
      process.env.PICTORIUM_ADMIN_TOKEN = "token-A"
      expect(await setPin("123456", { viaAdminToken: true })).toBe(true)
      expect(await verifyPin("123456")).toBe(true)
      expect(await hasPinConfigured()).toBe(true)
      const session = await createSessionToken()
      expect(await verifySessionToken(session)).toBe(true)

      // Rotazione: stesso PIN, token diverso → tutto inerte.
      process.env.PICTORIUM_ADMIN_TOKEN = "token-B"
      expect(await verifyPin("123456")).toBe(false)
      expect(await hasPinConfigured()).toBe(false)
      expect(await verifySessionToken(session)).toBe(false)
    })

    it("il PIN impostato via PIN (o senza token) sopravvive all'env", async () => {
      delete process.env.PICTORIUM_ADMIN_TOKEN
      delete process.env.ADMIN_TOKEN
      expect(await setPin("123456")).toBe(true)
      process.env.PICTORIUM_ADMIN_TOKEN = "token-C"
      expect(await verifyPin("123456")).toBe(true)
      expect(await hasPinConfigured()).toBe(true)
    })

    it("il PIN sopravvive quando il token non cambia", async () => {
      process.env.PICTORIUM_ADMIN_TOKEN = "token-A"
      expect(await setPin("123456", { viaAdminToken: true })).toBe(true)
      expect(await verifyPin("123456")).toBe(true)
    })
  })
})
