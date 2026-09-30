import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/fanart/[id]/images/route"
import { __resetFanartCache } from "@/lib/fanart"
import { __clearTMDBCache } from "@/lib/tmdb"
import { cacheClear } from "@/lib/cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

function makeRequest(id: string, type: string): NextRequest {
  return new NextRequest(`http://localhost/api/fanart/${id}/images?type=${type}`)
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  process.env.PICTORIUM_FANART_KEY = "test-project-key"
  __resetFanartCache()
  __clearTMDBCache()
  cacheClear()
  vi.restoreAllMocks()
})

describe("GET /api/fanart/[id]/images", () => {
  it("400 su tipo non valido", async () => {
    const res = await GET(makeRequest("123", "song"), params("123"))
    expect(res.status).toBe(400)
  })

  it("400 su id non valido", async () => {
    const res = await GET(makeRequest("abc", "movie"), params("abc"))
    expect(res.status).toBe(400)
  })

  it("503 con codice fanart_not_configured senza chiave progetto", async () => {
    delete process.env.PICTORIUM_FANART_KEY
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const res = await GET(makeRequest("321", "movie"), params("321"))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: "fanart_not_configured" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("200 con poster normalizzati (film)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        movieposter: [
          { id: "1", url: "https://assets.fanart.tv/fanart/movies/322/movieposter/a.jpg", lang: "it", likes: "5" },
        ],
      }),
    )
    const res = await GET(makeRequest("322", "movie"), params("322"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      posters: [{ url: "https://assets.fanart.tv/fanart/movies/322/movieposter/a.jpg", lang: "it", likes: 5 }],
      source: "fanart",
    })
  })

  it("502 con codice fanart_unavailable su guasto upstream (mai cachato come vuoto)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }))
    const first = await GET(makeRequest("323", "movie"), params("323"))
    expect(first.status).toBe(502)
    expect(await first.json()).toMatchObject({ code: "fanart_unavailable" })
    const second = await GET(makeRequest("323", "movie"), params("323"))
    expect(second.status).toBe(502)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
