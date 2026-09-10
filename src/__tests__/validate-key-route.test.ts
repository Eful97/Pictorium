import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/validate-key/route"

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
})
