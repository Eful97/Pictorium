import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "@/app/api/mappings/import/route"
import { importMappings } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  importMappings: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  checkAdminToken: vi.fn(() => true),
  isSameOrigin: vi.fn(() => true),
  adminAuthResponse: vi.fn(() => new Response("unauthorized", { status: 401 })),
  originMismatchResponse: vi.fn(() => new Response("forbidden", { status: 403 })),
}))

const BASE = "http://localhost:3000/api/mappings/import"

function mockRequest(body: unknown, contentLength?: number): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (contentLength !== undefined) headers["content-length"] = String(contentLength)
  return new NextRequest(BASE, { method: "POST", headers, body: JSON.stringify(body) })
}

function validMapping(tmdbId: number) {
  return { tmdbId, mediaType: "movie", title: `T${tmdbId}`, posterPath: `/p${tmdbId}.jpg`, originalPosterPath: `/p${tmdbId}.jpg` }
}

describe("POST /api/mappings/import (M12 — rate limit + cap)", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("rejects more than 1000 mappings with 413 and does not import", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => validMapping(i + 1))
    const res = await POST(mockRequest({ mappings: many }))
    expect(res.status).toBe(413)
    expect(importMappings).not.toHaveBeenCalled()
  })

  it("accepts exactly 1000 mappings", async () => {
    const exactly = Array.from({ length: 1000 }, (_, i) => validMapping(i + 1))
    const res = await POST(mockRequest({ mappings: exactly }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.count).toBe(1000)
    expect(importMappings).toHaveBeenCalledTimes(1)
  })

  it("rejects a body larger than 2.5MB (content-length) with 413", async () => {
    const res = await POST(mockRequest({ mappings: [] }, 3_000_000))
    expect(res.status).toBe(413)
    expect(importMappings).not.toHaveBeenCalled()
  })

  it("imports valid mappings and reports count", async () => {
    const body = { mappings: [validMapping(1), validMapping(2)] }
    const res = await POST(mockRequest(body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.count).toBe(2)
    expect(importMappings).toHaveBeenCalledWith([
      expect.objectContaining({ tmdbId: 1 }),
      expect.objectContaining({ tmdbId: 2 }),
    ], null)
  })
})
