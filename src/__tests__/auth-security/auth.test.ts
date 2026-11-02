import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { checkAdminToken, hasAdminTokenConfigured, requireAdminToken, isSameOrigin } from "@/lib/auth"

const originalEnv = { ...process.env }

// Fail-closed: senza ADMIN_TOKEN configurato, in produzione le route admin
// rispondono 401. Le vecchie modalità "istanza pubblica" (PICTORIUM_PUBLIC_INSTANCE
// / POSTERIUM_PUBLIC_INSTANCE) sono state RIMOSSE: se presenti vengono ignorate
// come se non esistessero, senza aprire nulla. Resta l'eccezione dev locale
// (NODE_ENV=development su loopback o con ALLOW_DEV_ADMIN=1) e la sessione PIN.
// Con token configurato → fail-closed (header assente/errato → rifiutato).
describe("checkAdminToken", () => {
  beforeEach(() => {
    delete process.env.POSTERIUM_ADMIN_TOKEN
    delete process.env.ADMIN_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("ignores the legacy POSTERIUM_PUBLIC_INSTANCE=1 in production (fail-closed)", () => {
    Object.assign(process.env, { NODE_ENV: "production", POSTERIUM_PUBLIC_INSTANCE: "1" })
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("ignores the legacy PICTORIUM_PUBLIC_INSTANCE=1 in production (fail-closed)", () => {
    Object.assign(process.env, { NODE_ENV: "production", PICTORIUM_PUBLIC_INSTANCE: "1" })
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("rejects without ADMIN_TOKEN and without any instance flag (fail-closed)", () => {
    Object.assign(process.env, { NODE_ENV: "production" })
    delete process.env.POSTERIUM_PUBLIC_INSTANCE
    delete process.env.PICTORIUM_PUBLIC_INSTANCE
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("ignores a non-1 value for the removed legacy flag", () => {
    Object.assign(process.env, { NODE_ENV: "production", POSTERIUM_PUBLIC_INSTANCE: "true" })
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("allows requests in dev without a token (NODE_ENV=development è implicitamente pubblico)", () => {
    Object.assign(process.env, { NODE_ENV: "development" })
    delete process.env.POSTERIUM_PUBLIC_INSTANCE
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(true)
  })

  it("rejects when a token is configured but the header is missing", () => {
    Object.assign(process.env, { NODE_ENV: "production" })
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("accepts a valid x-admin-token header", () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { "x-admin-token": "secret" },
    })
    expect(checkAdminToken(req)).toBe(true)
  })

  it("accepts a valid Authorization Bearer header", () => {
    process.env.ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
    })
    expect(checkAdminToken(req)).toBe(true)
  })

  it("rejects a wrong bearer token", () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("does not short-circuit on prefix matches (constant-time compare)", () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { "x-admin-token": "secre" },
    })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("rejects GET /api/mappings without token on a protected instance", async () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "GET" })
    const { GET } = await import("@/app/api/mappings/route")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("ignores the legacy public-instance flag on GET /api/mappings (401 without token)", async () => {
    process.env.POSTERIUM_PUBLIC_INSTANCE = "1"
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "GET" })
    const { GET } = await import("@/app/api/mappings/route")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it("rejects GET /api/mappings/export without token on a protected instance", async () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings/export", { method: "GET" })
    const { GET } = await import("@/app/api/mappings/export/route")
    const res = await GET(req)
    expect(res.status).toBe(401)
  })
})

describe("requireAdminToken (fail-closed)", () => {
  beforeEach(() => {
    delete process.env.POSTERIUM_ADMIN_TOKEN
    delete process.env.ADMIN_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("rejects when no token is configured (legacy instance flags are ignored)", () => {
    Object.assign(process.env, { NODE_ENV: "production", PICTORIUM_PUBLIC_INSTANCE: "1" })
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "DELETE" })
    expect(requireAdminToken(req)).toBe(false)
  })

  it("rejects when a token is configured but the header is missing", () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "DELETE" })
    expect(requireAdminToken(req)).toBe(false)
  })

  it("accepts a valid x-admin-token header", () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "DELETE",
      headers: { "x-admin-token": "secret" },
    })
    expect(requireAdminToken(req)).toBe(true)
  })

  it("rejects a wrong bearer token", () => {
    process.env.POSTERIUM_ADMIN_TOKEN = "secret"
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "DELETE",
      headers: { authorization: "Bearer wrong" },
    })
    expect(requireAdminToken(req)).toBe(false)
  })

  it("rejects DELETE /api/mappings (wipe-all) without token even with the legacy flag", async () => {
    Object.assign(process.env, { NODE_ENV: "production", POSTERIUM_PUBLIC_INSTANCE: "1" })
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "DELETE" })
    const { DELETE } = await import("@/app/api/mappings/route")
    const res = await DELETE(req)
    expect(res.status).toBe(401)
  })
})

// Defect: `PICTORIUM_ADMIN_TOKEN=""` (definita ma vuota, come materializzato da
// docker-compose) oscurava un `POSTERIUM_ADMIN_TOKEN` legacy reale —
// resolveAdminToken tornava undefined → card "Token admin" nascosta e
// checkAdminToken senza token. Regola: prima variabile NON VUOTA vince.
describe("resolveAdminToken (prima variabile non vuota)", () => {
  beforeEach(() => {
    delete process.env.PICTORIUM_ADMIN_TOKEN
    delete process.env.POSTERIUM_ADMIN_TOKEN
    delete process.env.ADMIN_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  const reqWithToken = (token: string) =>
    new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { "x-admin-token": token },
    })

  it("canonico definito ma vuoto: il legacy configurato resta attivo", () => {
    process.env.PICTORIUM_ADMIN_TOKEN = ""
    process.env.POSTERIUM_ADMIN_TOKEN = "legacy"
    expect(hasAdminTokenConfigured()).toBe(true)
    expect(checkAdminToken(reqWithToken("legacy"))).toBe(true)
  })

  it("canonico di soli spazi vale come vuoto e non diventa il token", () => {
    process.env.PICTORIUM_ADMIN_TOKEN = "   "
    process.env.POSTERIUM_ADMIN_TOKEN = "legacy"
    expect(hasAdminTokenConfigured()).toBe(true)
    expect(checkAdminToken(reqWithToken("legacy"))).toBe(true)
    expect(checkAdminToken(reqWithToken("   "))).toBe(false)
  })

  it("canonico non vuoto vince comunque sul legacy", () => {
    process.env.PICTORIUM_ADMIN_TOKEN = "canonical"
    process.env.POSTERIUM_ADMIN_TOKEN = "legacy"
    expect(checkAdminToken(reqWithToken("canonical"))).toBe(true)
    expect(checkAdminToken(reqWithToken("legacy"))).toBe(false)
  })

  it("ADMIN_TOKEN nudo resta l'ultimo fallback (prefissati vuoti)", () => {
    process.env.PICTORIUM_ADMIN_TOKEN = ""
    process.env.POSTERIUM_ADMIN_TOKEN = "  "
    process.env.ADMIN_TOKEN = "bare"
    expect(hasAdminTokenConfigured()).toBe(true)
    expect(checkAdminToken(reqWithToken("bare"))).toBe(true)
  })

  it("vuoto ovunque: nessun token (fail-closed preservato)", () => {
    process.env.PICTORIUM_ADMIN_TOKEN = ""
    process.env.POSTERIUM_ADMIN_TOKEN = ""
    expect(hasAdminTokenConfigured()).toBe(false)
    expect(requireAdminToken(reqWithToken("anything"))).toBe(false)
  })
})

describe("isSameOrigin (CSRF)", () => {
  it("passes when no Origin header is present (curl/test/Stremio)", () => {
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(isSameOrigin(req)).toBe(true)
  })

  it("passes for a same-origin request (Origin host == Host)", () => {
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    })
    expect(isSameOrigin(req)).toBe(true)
  })

  it("rejects a cross-origin request", () => {
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    })
    expect(isSameOrigin(req)).toBe(false)
  })

  it("matches against X-Forwarded-Host when it agrees with Host (trusted proxy)", () => {
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: {
        origin: "https://pictorium.example.com",
        host: "pictorium.example.com",
        "x-forwarded-host": "pictorium.example.com",
      },
    })
    expect(isSameOrigin(req)).toBe(true)
  })

  it("ignores a spoofed X-Forwarded-Host that disagrees with Host (fix H6)", () => {
    // Attacco: Origin: evil.com + X-Forwarded-Host: evil.com. Prima del fix
    // XFH vinceva sempre e la guardia passava; ora XFH non fidato viene
    // ignorato e il confronto avviene sull'Host reale → rifiuto.
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: {
        origin: "https://evil.example.com",
        host: "localhost:3000",
        "x-forwarded-host": "evil.example.com",
      },
    })
    expect(isSameOrigin(req)).toBe(false)
  })

  it("trusts X-Forwarded-Host when listed in POSTERIUM_ALLOWED_HOSTS", () => {
    process.env.POSTERIUM_ALLOWED_HOSTS = "pictorium.example.com"
    try {
      const req = new NextRequest("http://localhost:3000/api/mappings", {
        method: "POST",
        headers: {
          origin: "https://pictorium.example.com",
          host: "internal.local",
          "x-forwarded-host": "pictorium.example.com",
        },
      })
      expect(isSameOrigin(req)).toBe(true)
    } finally {
      delete process.env.POSTERIUM_ALLOWED_HOSTS
    }
  })

  it("ignores the port when comparing hosts", () => {
    const req = new NextRequest("http://localhost:3000/api/mappings", {
      method: "POST",
      headers: { origin: "http://localhost:8080", host: "localhost:3000" },
    })
    expect(isSameOrigin(req)).toBe(true)
  })
})
