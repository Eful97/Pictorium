import type { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GET, PUT } from "@/app/api/defaults/route"
import { cacheClear, cacheGet, cacheSet } from "@/lib/cache"

// I PUT di questo file scrivono i defaults via file; isoliamo lo store in una
// dir temporanea (test-results/, gitignored) così i config di test non toccano
// il reale data/defaults.json dell'istanza.
vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-defaults-test`,
}))

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  delete process.env.ADMIN_TOKEN
})

function mockPutRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/defaults", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PUT /api/defaults", () => {
  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost:3000/api/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "not json",
    })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid body fields", async () => {
    const req = mockPutRequest({ badgeStyle: 123, blurEnabled: "yes" })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it("returns 401 when ADMIN_TOKEN is set and header is missing", async () => {
    process.env.ADMIN_TOKEN = "secret-token"
    const req = mockPutRequest({ badgeStyle: "bar" })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(401)
  })

  it("accepts valid body with no auth token set", async () => {
    delete process.env.ADMIN_TOKEN
    const req = mockPutRequest({ badgeStyle: "bar", rankingBadges: true })
    const res = await PUT(req as unknown as NextRequest)
    expect(res.status).toBe(200)
  })

  it("invalidates poster and catalog cache after saving defaults", async () => {
    delete process.env.ADMIN_TOKEN
    cacheSet("poster:movie:1", "poster", ["poster"])
    cacheSet("catalog:movie:top", "catalog", ["catalog"])
    cacheSet("tmdb:search:avatar", "search", ["tmdb"])

    const req = mockPutRequest({ badgeStyle: "bar" })
    const res = await PUT(req as unknown as NextRequest)

    expect(res.status).toBe(200)
    expect(cacheGet("poster:movie:1")).toBeNull()
    expect(cacheGet("catalog:movie:top")).toBeNull()
    expect(cacheGet("tmdb:search:avatar")).toBe("search")
  })

  it("merge: un payload parziale preserva i default già salvati", async () => {
    delete process.env.ADMIN_TOKEN
    await PUT(mockPutRequest({ badgeStyle: "bar", gradientHeight: 40 }) as unknown as NextRequest)

    const res = await PUT(mockPutRequest({ gradientHeight: 55 }) as unknown as NextRequest)
    expect(res.status).toBe(200)

    const resGet = await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    const body = (await resGet.json()) as Record<string, unknown>
    expect(body.badgeStyle).toBe("bar")
    expect(body.gradientHeight).toBe(55)
  })

  it("accepts a valid custom rating endpoint and rejects unsafe ones", async () => {
    delete process.env.ADMIN_TOKEN
    const ok = await PUT(mockPutRequest({ customRatingEndpoint: "https://example.com/ratings/{imdbId}" }) as unknown as NextRequest)
    expect(ok.status).toBe(200)
    for (const bad of [
      "https://example.com/ratings/no-placeholder",
      "file:///ratings/{imdbId}",
      "https://user:pass@example.com/{imdbId}",
      "not a url {imdbId}",
    ]) {
      const res = await PUT(mockPutRequest({ customRatingEndpoint: bad }) as unknown as NextRequest)
      expect(res.status).toBe(400)
    }
  })
})
