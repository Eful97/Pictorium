import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/flixpatrol/top10/route"
import { __resetJWRankingsCache } from "@/lib/justwatch"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(),
}))
vi.mock("@/lib/tmdb", () => ({ resolveRouteApiKey: vi.fn(async () => undefined) }))

describe("GET /api/flixpatrol/top10 global charts", () => {
  beforeEach(() => { __resetJWRankingsCache() })
  afterEach(() => { vi.restoreAllMocks() })

  it("accepts the UI's global request and fetches worldwide platform charts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const { variables } = JSON.parse(String(init?.body))
      expect(variables.countryStreamingCharts).toBeNull()
      expect(variables.filter.packages).toContain("nfx")
      return Response.json({ data: { streamingCharts: { edges: [{
        streamingChartInfo: { rank: 1 },
        node: { content: { title: "Worldwide Netflix title", externalIds: { tmdbId: 550 } } },
      }] } } })
    })
    const res = await GET(new NextRequest("http://localhost/api/flixpatrol/top10?platform=netflix&country=global"))
    expect(res.status).toBe(200)
    const chart = await res.json()
    expect(chart.country).toBe("global")
    expect(chart.movies[0]).toMatchObject({ tmdbId: 550, title: "Worldwide Netflix title" })
    expect(chart.tv).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("still rejects unknown countries before contacting providers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const res = await GET(new NextRequest("http://localhost/api/flixpatrol/top10?platform=netflix&country=atlantis"))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
