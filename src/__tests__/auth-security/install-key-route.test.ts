import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// The validate-key bucket (10 tokens) would drain across tests: this file tests the
// resolution/anonymity policy; rate limiting has its own dedicated files.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/rate-limit")>()
  return { ...mod, rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })) }
})

const AUTH = vi.hoisted(() => ({ check: vi.fn(async (_req: unknown, _user: string) => true) }))
vi.mock("@/lib/user-auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-auth")>()
  return { ...mod, checkUserAuth: (...args: [unknown, string]) => AUTH.check(...args) }
})

const KEYS = vi.hoisted(() => ({ getUserKeys: vi.fn(async (_user: string) => ({})) }))
vi.mock("@/lib/user-keys", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-keys")>()
  return { ...mod, getUserKeys: (...args: [string]) => KEYS.getUserKeys(...args) }
})

const UUID = "123e4567-e89b-12d3-a456-426614174000"
const NS_KEY = "ns-secret-tmdb-key"
const ENV_KEY = "env-fallback-tmdb-key"

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/diagnostics/install-key", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("POST /api/diagnostics/install-key", () => {
  const prevMulti = process.env.PICTORIUM_MULTI_USER
  const prevEnvKey = process.env.PICTORIUM_TMDB_KEY

  beforeEach(() => {
    vi.restoreAllMocks()
    AUTH.check.mockReset().mockResolvedValue(true)
    KEYS.getUserKeys.mockReset().mockResolvedValue({})
    delete process.env.PICTORIUM_MULTI_USER
    delete process.env.PICTORIUM_TMDB_KEY
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (prevMulti === undefined) delete process.env.PICTORIUM_MULTI_USER
    else process.env.PICTORIUM_MULTI_USER = prevMulti
    if (prevEnvKey === undefined) delete process.env.PICTORIUM_TMDB_KEY
    else process.env.PICTORIUM_TMDB_KEY = prevEnvKey
  })

  it("reports missing when no usable key exists for the global context", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({}))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe("missing")
    expect(json.source).toBe("none")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("validates the global env fallback with a live TMDB probe", async () => {
    process.env.PICTORIUM_TMDB_KEY = ENV_KEY
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ success: true }))
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({}))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.code).toBe("ok")
    expect(json.source).toBe("env")
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(encodeURIComponent(ENV_KEY))
  })

  it("never reports success for a rejected key", async () => {
    process.env.PICTORIUM_TMDB_KEY = ENV_KEY
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status_message: "Invalid API key" }), { status: 401 }),
    )
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({}))
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe("invalid")
  })

  it("never exposes key material in the response", async () => {
    process.env.PICTORIUM_TMDB_KEY = ENV_KEY
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ success: true }))
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({}))
    const raw = await res.text()
    expect(raw).not.toContain(ENV_KEY)
    expect(raw).not.toContain(NS_KEY)
  })

  it("rejects an unauthorized namespace without falling through to the global key", async () => {
    process.env.PICTORIUM_MULTI_USER = "1"
    process.env.PICTORIUM_TMDB_KEY = ENV_KEY
    AUTH.check.mockResolvedValue(false)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({ u: UUID }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.code).toBe("unauthorized")
    // No probe: the instance key must never vouch for someone else's space.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("uses the saved namespace key for an authorized space, never the env fallback", async () => {
    process.env.PICTORIUM_MULTI_USER = "1"
    process.env.PICTORIUM_TMDB_KEY = ENV_KEY
    AUTH.check.mockResolvedValue(true)
    KEYS.getUserKeys.mockResolvedValue({ tmdb: NS_KEY })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ success: true }))
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({ u: UUID }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.source).toBe("namespace")
    const called = String(fetchSpy.mock.calls[0]?.[0])
    expect(called).toContain(encodeURIComponent(NS_KEY))
    expect(called).not.toContain(encodeURIComponent(ENV_KEY))
  })

  it("rejects a malformed config token without probing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({ config: "not-a-token!!!" }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("bad-config")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("rejects an invalid user id without probing", async () => {
    process.env.PICTORIUM_MULTI_USER = "1"
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({ u: "not-a-uuid" }))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("ignores the namespace when multi-user is disabled (global policy)", async () => {
    process.env.PICTORIUM_TMDB_KEY = ENV_KEY
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ success: true }))
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(post({ u: UUID }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.source).toBe("env")
  })

  it("rejects cross-origin requests", async () => {
    const { POST } = await import("@/app/api/diagnostics/install-key/route")
    const res = await POST(
      post({}, { Origin: "https://evil.example", Host: "localhost:3000" }),
    )
    expect(res.status).toBe(403)
  })
})
