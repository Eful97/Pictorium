import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { checkAdminToken, requireAdminToken, isSameOrigin } from "@/lib/auth"

const originalEnv = { ...process.env }

// Regressione per il bug HF: senza ADMIN_TOKEN configurato, in produzione il
// salvataggio poster (POST /api/mappings) era bloccato (fail-closed introdotto
// in 415aad3) → 401 su HF Spaces dove il token non è mai impostato.
// Il comportamento (da S1 + fix dev): senza token le route restano aperte in
// modalità pubblica — esplicita (POSTERIUM_PUBLIC_INSTANCE=1) o dev locale
// (NODE_ENV=development); in produzione senza flag restano fail-closed. Con
// token configurato → fail-closed (header assente/errato → rifiutato).
// Nota: setup.ts imposta POSTERIUM_PUBLIC_INSTANCE=1 come default per i test.
describe("checkAdminToken", () => {
  beforeEach(() => {
    delete process.env.POSTERIUM_ADMIN_TOKEN
    delete process.env.ADMIN_TOKEN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("allows requests in production with POSTERIUM_PUBLIC_INSTANCE=1 (public instance, HF Spaces)", () => {
    Object.assign(process.env, { NODE_ENV: "production", POSTERIUM_PUBLIC_INSTANCE: "1" })
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(true)
  })

  it("rejects without ADMIN_TOKEN and without the public-instance flag (fail-closed)", () => {
    Object.assign(process.env, { NODE_ENV: "production" })
    delete process.env.POSTERIUM_PUBLIC_INSTANCE
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "POST" })
    expect(checkAdminToken(req)).toBe(false)
  })

  it("rejects a non-1 value for POSTERIUM_PUBLIC_INSTANCE", () => {
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

  it("allows GET /api/mappings on a public instance (flag set, no token)", async () => {
    process.env.POSTERIUM_PUBLIC_INSTANCE = "1"
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "GET" })
    const { GET } = await import("@/app/api/mappings/route")
    const res = await GET(req)
    expect(res.status).toBe(200)
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

  it("rejects when no token is configured (even on a public instance)", () => {
    Object.assign(process.env, { NODE_ENV: "production" })
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

  it("rejects DELETE /api/mappings (wipe-all) without token on a public instance", async () => {
    Object.assign(process.env, { NODE_ENV: "production" })
    const req = new NextRequest("http://localhost:3000/api/mappings", { method: "DELETE" })
    const { DELETE } = await import("@/app/api/mappings/route")
    const res = await DELETE(req)
    expect(res.status).toBe(401)
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
