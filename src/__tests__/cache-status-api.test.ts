import { afterEach, describe, expect, it } from "vitest"
import { GET } from "@/app/api/cache/status/route"
import { cacheClear, cacheSet } from "@/lib/cache"

afterEach(() => {
  cacheClear()
  delete process.env.ADMIN_TOKEN
})

const TEST_TOKEN = "secret"

/** Richiesta autenticata (il token va anche in env: resolveAdminToken). */
function statusReq(withAuth: boolean) {
  process.env.ADMIN_TOKEN = TEST_TOKEN
  return new Request("http://localhost:3000/api/cache/status", {
    headers: withAuth ? { "x-admin-token": TEST_TOKEN } : {},
  })
}

describe("GET /api/cache/status", () => {
  it("returns cache status grouped by tag", async () => {
    cacheSet("poster:1", "a", ["poster"])
    cacheSet("poster:2", "b", ["poster"])
    cacheSet("catalog:1", "c", ["catalog", "stremio"])
    cacheSet("misc", "d")

    const req = statusReq(true)
    const res = await GET(req as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      totalEntries: 4,
      taggedEntries: [
        { tag: "catalog", count: 1 },
        { tag: "poster", count: 2 },
        { tag: "stremio", count: 1 },
      ],
      untaggedEntries: 1,
      totalBytes: expect.any(Number),
      staleBytes: 0,
      retainedBytes: expect.any(Number),
      maxBytes: expect.any(Number),
      maxEntries: expect.any(Number),
      posterErrors: { writes: 0, hits: 0 },
      poster: expect.objectContaining({
        requests: expect.any(Number),
        hits: expect.any(Number),
        renders: expect.any(Number),
        hitRate: expect.any(String),
      }),
      tmdb: expect.objectContaining({
        totalCalls: expect.any(Number),
        cacheHits: expect.any(Number),
        networkCalls: expect.any(Number),
      }),
      system: expect.objectContaining({
        sharp: expect.any(Object),
        memory: expect.any(Object),
        uptimeSeconds: expect.any(Number),
      }),
      circuitBreakers: expect.any(Object),
      outbound: expect.any(Object),
      imageBytes: expect.objectContaining({
        enabled: expect.any(Boolean),
        hits: expect.any(Number),
        misses: expect.any(Number),
        entries: expect.any(Number),
        bytes: expect.any(Number),
      }),
    })
  })

  it("requires admin token when configured", async () => {
    const req = statusReq(false)
    const res = await GET(req as never)

    expect(res.status).toBe(401)
  })

  it("stays fail-closed without token even on public instances", async () => {
    // Nessun ADMIN_TOKEN (ma POSTERIUM_PUBLIC_INSTANCE=1 dal setup): la
    // telemetria non è più aperta a chiunque come con checkAdminToken.
    const req = new Request("http://localhost:3000/api/cache/status")
    const res = await GET(req as never)

    expect(res.status).toBe(401)
  })

  it("does not count expired entries", async () => {
    cacheSet("expired", "old", ["short-lived"], -1)

    const req = statusReq(true)
    const res = await GET(req as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      totalEntries: 0,
      taggedEntries: [],
      untaggedEntries: 0,
      totalBytes: 0,
      staleBytes: 0,
      retainedBytes: 0,
      maxBytes: expect.any(Number),
      maxEntries: expect.any(Number),
      posterErrors: { writes: 0, hits: 0 },
      poster: expect.any(Object),
      tmdb: expect.any(Object),
      system: expect.any(Object),
      circuitBreakers: expect.any(Object),
      outbound: expect.any(Object),
      imageBytes: expect.any(Object),
    })
  })
})
