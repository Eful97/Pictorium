import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/custom-colors/route"
import { cacheClear } from "@/lib/cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const COLORS = { accent: "#7f5401", topEdge: "#111111", bottomEdge: "#222222" }

vi.mock("@/lib/custom-colors", () => ({
  sampleCustomImageColors: vi.fn(async () => ({ ...COLORS })),
}))

import { sampleCustomImageColors } from "@/lib/custom-colors"
const mockedSample = vi.mocked(sampleCustomImageColors)

function makeRequest(params: string): NextRequest {
  return new NextRequest(`http://localhost/api/custom-colors?${params}`)
}

beforeEach(() => {
  cacheClear()
  vi.clearAllMocks()
  mockedSample.mockResolvedValue({ ...COLORS })
})

describe("GET /api/custom-colors", () => {
  it("400 senza url o con scheme non-HTTP", async () => {
    expect((await GET(makeRequest(""))).status).toBe(400)
    expect((await GET(makeRequest("url=ftp://assets.fanart.tv/x.jpg"))).status).toBe(400)
    expect((await GET(makeRequest("url=nota-url"))).status).toBe(400)
  })

  it("403 su host fuori allowlist (mai rete)", async () => {
    const res = await GET(makeRequest("url=https://evil.com/x.jpg"))
    expect(res.status).toBe(403)
    expect(mockedSample).not.toHaveBeenCalled()
  })

  it("403 su shape direct-only invalida (mai rete), 200 su bare/ TMDB validi", async () => {
    for (const bad of [
      "url=https://image.tmdb.org/t/p/w999/x.jpg",
      "url=https://image.tmdb.org/t/p/original/x.svg",
      "url=https://theposterdb.com/poster/757201",
      "url=https://www.image.tmdb.org/t/p/w500/x.jpg",
    ]) {
      const res = await GET(makeRequest(bad))
      expect(res.status).toBe(403)
    }
    expect(mockedSample).not.toHaveBeenCalled()
    for (const good of [
      "url=https://theposterdb.com/api/assets/670524",
      "url=https://image.tmdb.org/t/p/original/dZSyWJ7F78W725BI7CKQIesvmKy.jpg",
    ]) {
      const res = await GET(makeRequest(good))
      expect(res.status).toBe(200)
    }
    expect(mockedSample).toHaveBeenCalledTimes(2)
  })

  it("200 con accent/top/bottom e cache al secondo hit", async () => {
    const params = "url=https://assets.fanart.tv/fanart/movies/1/movieposter/a.jpg&genre=Dramma"
    const first = await GET(makeRequest(params))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual(COLORS)
    const second = await GET(makeRequest(params))
    expect(second.status).toBe(200)
    // Secondo hit da cache: il sampler gira una volta sola.
    expect(mockedSample).toHaveBeenCalledTimes(1)
  })

  it("502 quando il campionamento fallisce (mai cachato come colore)", async () => {
    mockedSample.mockResolvedValueOnce(null)
    const params = "url=https://assets.fanart.tv/fanart/movies/2/movieposter/b.jpg"
    const res = await GET(makeRequest(params))
    expect(res.status).toBe(502)
    expect(mockedSample).toHaveBeenCalledTimes(1)
  })
})
