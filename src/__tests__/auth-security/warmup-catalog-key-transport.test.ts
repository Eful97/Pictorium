/**
 * A6 regression: the catalog warm-up self-fetch must never place API keys in
 * the URL query string (secrets in logs/CDN). Same contract as the poster
 * self-fetch: forward `x-api-key` as a header only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/justwatch", () => ({ getJWRankings: vi.fn(async () => []) }))
vi.mock("@/lib/imdb-top250", () => ({ warmTop250: vi.fn(async () => undefined) }))
vi.mock("@/lib/store", () => ({ getAll: vi.fn(async () => []) }))
vi.mock("@/lib/tmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tmdb")>()
  return { ...actual, getTrending: vi.fn(async () => ({ results: [] })) }
})

import { POST } from "@/app/api/warmup/route"

describe("POST /api/warmup — catalog self-fetch keeps keys out of the URL", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }))

  beforeEach(() => {
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubEnv("PICTORIUM_WARMUP_TOKEN", "test-warmup-token")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.PICTORIUM_WARMUP_TOKEN
    delete process.env.ADMIN_TOKEN
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
  })

  it("forwards the TMDB key via x-api-key header and drops key query params", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/warmup?catalogs=1&trending=0&justwatch=0&mappings=0&api_key=warm-secret&mdblist_key=warm-mdblist",
      { method: "POST", headers: { "x-warmup-token": "test-warmup-token" } },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)

    const catalogCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/catalog/"))
    expect(catalogCalls.length).toBeGreaterThan(0)
    for (const [rawUrl, init] of catalogCalls) {
      const url = String(rawUrl)
      expect(url).not.toContain("warm-secret")
      expect(url).not.toContain("api_key")
      expect(url).not.toContain("mdblist_key")
      expect(url).not.toContain("warm-mdblist")
      const headers = new Headers((init?.headers as HeadersInit | undefined) ?? {})
      expect(headers.get("x-api-key")).toBe("warm-secret")
    }
  })

  it("sends no x-api-key header when the caller provided no key", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/warmup?catalogs=1&trending=0&justwatch=0&mappings=0",
      { method: "POST", headers: { "x-warmup-token": "test-warmup-token" } },
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    const catalogCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/catalog/"))
    expect(catalogCalls.length).toBeGreaterThan(0)
    for (const [rawUrl, init] of catalogCalls) {
      expect(String(rawUrl)).not.toContain("api_key")
      const headers = new Headers((init?.headers as HeadersInit | undefined) ?? {})
      expect(headers.get("x-api-key")).toBeNull()
    }
  })
})
