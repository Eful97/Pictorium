import { describe, expect, it, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/custom-catalog-providers", () => ({
  detectCatalogProvider: vi.fn(() => ({ provider: "test", nameSuggestion: "T", defaultType: "movie" })),
  fetchUnifiedCatalogItems: vi.fn(async () => []),
}))

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  resolveRouteApiKey: vi.fn(async () => "k"),
  tmdbFindByImdb: vi.fn(async () => 0),
}))

import { GET } from "@/app/api/mdblist/custom/route"
import { fetchUnifiedCatalogItems } from "@/lib/custom-catalog-providers"
import { getDetails } from "@/lib/tmdb"

describe("GET /api/mdblist/custom fan-out cap (v1.23.0)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("bounds per-item TMDB concurrency and preserves order", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      tmdb: 1000 + i,
      mediatype: "movie",
      title: `T${i}`,
      year: 2020 + (i % 5),
    }))
    vi.mocked(fetchUnifiedCatalogItems).mockResolvedValue(items as never)

    let active = 0
    let maxActive = 0
    vi.mocked(getDetails).mockImplementation(async (_t, id) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 20))
      active--
      return { poster_path: `/p${id}.jpg` } as never
    })

    const req = new NextRequest("http://localhost:3000/api/mdblist/custom?url=https://example.com/list&limit=12")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: { tmdbId: number; poster_path: string }[] }
    expect(json.items).toHaveLength(12)
    expect(json.items.map((i) => i.tmdbId)).toEqual(items.map((i) => i.tmdb))
    expect(json.items[0].poster_path).toBe("/p1000.jpg")
    expect(maxActive).toBeLessThanOrEqual(5)
    expect(maxActive).toBeGreaterThan(1) // davvero parallelo, non seriale
  })
})
