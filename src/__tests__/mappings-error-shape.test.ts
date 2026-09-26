import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/mappings/route"
import { upsert } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(),
  getById: vi.fn(),
  upsert: vi.fn(),
  removeAll: vi.fn(),
  QuotaExceededError: class QuotaExceededError extends Error {},
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  rateLimitKey: vi.fn(() => "test-key"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const BASE = "http://localhost:3000/api/mappings"

function postMapping(body: unknown): NextRequest {
  return new NextRequest(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function validBody() {
  return { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }
}

describe("POST /api/mappings upsert error contract", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns JSON 500 when storage throws an unexpected error", async () => {
    vi.mocked(upsert).mockRejectedValueOnce(new Error("disk full"))
    const res = await POST(postMapping(validBody()))
    expect(res.status).toBe(500)
    expect(res.headers.get("content-type")).toContain("application/json")
    const json = await res.json()
    expect(json).toEqual({ error: "Internal server error" })
  })
})
