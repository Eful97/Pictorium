import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// Regression: warmup resolves the TMDB key (resolveRequestApiKey) for
// getTrending and must forward it to the poster self-fetch via the x-api-key
// header, never in the URL (poster contract: header > query; api_key stays
// out of the cache key). Without a key no header is sent (no "undefined").
vi.mock("@/lib/justwatch", () => ({ getJWRankings: vi.fn(async () => []) }))
vi.mock("@/lib/imdb-top250", () => ({ warmTop250: vi.fn(async () => undefined) }))
vi.mock("@/lib/store", () => ({ getAll: vi.fn(async () => []) }))
vi.mock("@/lib/tmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...actual,
    getTrending: vi.fn(async () => ({ results: [{ id: 42 }] })),
  }
})

const TMDB_ENV_KEYS = [
  "PICTORIUM_TMDB_KEY",
  "POSTERIUM_TMDB_KEY",
  "TMDB_KEY",
  "TMDB_API_KEY",
] as const

function posterCalls(fetchSpy: { mock: { calls: Array<[unknown, RequestInit?]> } }) {
  return fetchSpy.mock.calls.filter(([url]) => String(url).includes("/api/poster/"))
}

describe("POST /api/warmup — TMDB key forwarding to poster self-fetch", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }))
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
    for (const key of [...TMDB_ENV_KEYS, "PICTORIUM_PUBLIC_INSTANCE"] as const) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    // The global setup simulates a public instance (POSTERIUM_PUBLIC_INSTANCE=1):
    // warmup then requires x-warmup-token (fail-closed without a token).
    savedEnv["PICTORIUM_WARMUP_TOKEN"] = process.env.PICTORIUM_WARMUP_TOKEN
    process.env.PICTORIUM_WARMUP_TOKEN = "test-warmup-token"
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fetchSpy.mockReset()
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }))
  })

  function warmupRequest(apiKey?: string): NextRequest {
    // NB: explicit limits — boundedInt maps a missing param (null) to 0,
    // so without a query the queue would be empty (out-of-scope observation).
    return new NextRequest("http://localhost:3000/api/warmup?trending=5&justwatch=0&mappings=0", {
      method: "POST",
      headers: {
        "x-warmup-token": "test-warmup-token",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
    })
  }

  it("forwards the key via the x-api-key header, never in the URL, keeping signal", async () => {
    const { POST } = await import("@/app/api/warmup/route")

    const res = await POST(warmupRequest("secret-tmdb-key"))
    expect(res.status).toBe(200)

    const calls = posterCalls(fetchSpy)
    expect(calls.length).toBeGreaterThan(0)
    for (const [rawUrl, init] of calls) {
      const url = String(rawUrl)
      expect(url).not.toContain("secret-tmdb-key")
      expect(url).not.toContain("api_key")
      const headers = new Headers((init?.headers as HeadersInit | undefined) ?? {})
      expect(headers.get("x-api-key")).toBe("secret-tmdb-key")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  it("sends no x-api-key header without a key (no bare undefined)", async () => {
    const { POST } = await import("@/app/api/warmup/route")

    const res = await POST(warmupRequest())
    expect(res.status).toBe(200)

    const calls = posterCalls(fetchSpy)
    expect(calls.length).toBeGreaterThan(0)
    for (const [rawUrl, init] of calls) {
      const url = String(rawUrl)
      expect(url).not.toContain("api_key")
      const headers = new Headers((init?.headers as HeadersInit | undefined) ?? {})
      expect(headers.get("x-api-key")).toBeNull()
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
  })
})
