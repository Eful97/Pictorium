import { describe, expect, it, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/custom-catalog-providers", () => ({
  detectCatalogProvider: vi.fn(() => ({ provider: "test", nameSuggestion: "T", defaultType: "movie" })),
  fetchUnifiedCatalogResult: vi.fn(async () => ({ items: [], status: "ok" })),
}))

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  resolveRouteApiKey: vi.fn(async () => "k"),
  tmdbFindByImdb: vi.fn(async () => 0),
  tmdbFindByTvdb: vi.fn(async () => 0),
}))

import { GET } from "@/app/api/mdblist/custom/route"
import { fetchUnifiedCatalogResult } from "@/lib/custom-catalog-providers"
import { getDetails, tmdbFindByTvdb } from "@/lib/tmdb"

describe("GET /api/mdblist/custom fan-out cap (v1.23.0)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves TVDB-only entries and fills their missing metadata", async () => {
    vi.mocked(fetchUnifiedCatalogResult).mockResolvedValue({
      items: [{ imdb: "", tvdb: 456, title: "", year: 0, mediatype: "tv" }], status: "ok",
    })
    vi.mocked(tmdbFindByTvdb).mockResolvedValue(1396)
    vi.mocked(getDetails).mockResolvedValue({ name: "Breaking Bad", first_air_date: "2008-01-20", poster_path: "/bb.jpg" } as never)
    const res = await GET(new NextRequest("http://localhost:3000/api/mdblist/custom?url=https://thetvdb.com/lists/test"))
    expect(tmdbFindByTvdb).toHaveBeenCalledWith(456, "tv", "k")
    expect((await res.json()).items[0]).toMatchObject({ id: 1396, tmdbId: 1396, title: "Breaking Bad", year: 2008, poster_path: "/bb.jpg" })
  })

  it("bounds per-item TMDB concurrency and preserves order", async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      tmdb: 1000 + i,
      mediatype: "movie",
      title: `T${i}`,
      year: 2020 + (i % 5),
    }))
    vi.mocked(fetchUnifiedCatalogResult).mockResolvedValue({ items: items as never, status: "ok" })

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
