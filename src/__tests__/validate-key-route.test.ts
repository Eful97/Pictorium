import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/validate-key/route"

// Il bucket validate-key (10 token) si esaurirebbe tra i test: qui si testa la
// logica di validazione provider, il rate limiting ha i suoi file dedicati.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/rate-limit")>()
  return { ...mod, rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })) }
})

describe("POST /api/validate-key", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns 400 when missing key or provider", async () => {
    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("validates valid TMDB key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ success: true, status_code: 1, status_message: "Success." })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tmdb", key: "valid-tmdb-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(true)
  })

  it("validates invalid TMDB key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status_message: "Invalid API key" }), { status: 401 })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tmdb", key: "invalid-tmdb-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(false)
  })

  it("validates valid MDBList key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ title: "The Shawshank Redemption", year: 1994 })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "mdblist", key: "valid-mdblist-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(true)
  })

  it("validates invalid MDBList key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ response: false, error: "Invalid API key" })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "mdblist", key: "invalid-mdblist-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(false)
  })

  it("validates valid TVDB key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ status: "success", data: { token: "tvdb-token-abc" } })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tvdb", key: "valid-tvdb-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(true)
  })

  it("rejects cross-origin requests (C6)", async () => {
    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        Host: "localhost:3000",
      },
      body: JSON.stringify({ provider: "tmdb", key: "some-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it("merges upstream errors into the generic invalid response, never 502 (C6)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("connection reset"))

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tmdb", key: "any-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(false)
  })

  it("validates invalid TVDB key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Invalid key" }), { status: 401 })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tvdb", key: "bad-tvdb-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(false)
  })

  it("validates valid Simkl key (301 + Location)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://api.simkl.com/movies/123" } })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "simkl", key: "valid-simkl-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(true)
  })

  it("validates invalid Simkl key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid client id" }), { status: 401 })
    )

    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "simkl", key: "bad-simkl-key" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.valid).toBe(false)
  })

  it("rejects oversized bodies with 413 before buffering (anti-OOM v1.23.0)", async () => {
    const req = new NextRequest("http://localhost:3000/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tmdb", key: "x".repeat(8192) }),
    })
    const res = await POST(req)
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.valid).toBe(false)
  })
})
