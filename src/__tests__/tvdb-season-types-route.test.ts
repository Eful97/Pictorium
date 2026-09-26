import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/tvdb/[id]/seasonTypes/route"
import { cacheClear } from "@/lib/cache"
import { clearTvdbCache } from "@/lib/tvdb"

// Il lib tvdb è fail-soft (gli errori fetch diventano []/null internamente):
// l'unico throw che raggiunge il catch esterno è infrastrutturale
// (es. cacheSet). Flag per simularlo senza rompere gli altri test.
const cacheControl = vi.hoisted(() => ({ fail: false }))
vi.mock("@/lib/cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cache")>()
  return {
    ...actual,
    cacheSet: (...args: Parameters<typeof actual.cacheSet>) => {
      if (cacheControl.fail) throw new Error("disk /secret/path full")
      return actual.cacheSet(...args)
    },
  }
})

describe("GET /api/tvdb/[id]/seasonTypes", () => {
  beforeEach(() => {
    cacheClear()
    clearTvdbCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cacheClear()
    clearTvdbCache()
  })

  it("returns season types when resolved with IMDb ID", async () => {
    vi.spyOn(globalThis, "fetch")
      // 1. Auth token
      .mockResolvedValueOnce(
        Response.json({ status: "success", data: { token: "mock-jwt" } })
      )
      // 2. Search remoteid for IMDb tt6468322
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          data: [{ series: { id: 327153, name: "La Casa de Papel" } }],
        })
      )
      // 3. Series extended
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          data: {
            id: 327153,
            name: "La Casa de Papel",
            seasonTypes: [
              { id: 1, name: "Aired Order", type: "official", alternateName: null },
              { id: 3, name: "Alternate Order", type: "alternate", alternateName: "Netflix" },
            ],
          },
        })
      )

    const req = new NextRequest("http://localhost:3000/api/tvdb/tt6468322/seasonTypes?tvdb_key=valid-key")
    const res = await GET(req, { params: Promise.resolve({ id: "tt6468322" }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.tvdbId).toBe(327153)
    expect(json.results).toHaveLength(2)
    expect(json.results[0].type).toBe("official")
    expect(json.results[1].alternateName).toBe("Netflix")
  })

  it("returns error message when tvdb key is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/tvdb/71446/seasonTypes")
    const res = await GET(req, { params: Promise.resolve({ id: "71446" }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results).toEqual([])
    expect(json.error).toContain("TVDB key missing")
  })

  it("sanitizes upstream errors (no raw message in body, v1.23.0)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ status: "success", data: { token: "mock-jwt" } }))
      .mockResolvedValueOnce(
        Response.json({ status: "success", data: [{ series: { id: 327153, name: "X" } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "success",
          data: { id: 327153, seasonTypes: [{ id: 1, name: "Aired", type: "official", alternateName: null }] },
        }),
      )
    cacheControl.fail = true
    try {
      const req = new NextRequest("http://localhost:3000/api/tvdb/71446/seasonTypes?tvdb_key=valid-key")
      const res = await GET(req, { params: Promise.resolve({ id: "71446" }) })
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.results).toEqual([])
      expect(json.error).toBe("TVDB non disponibile")
      expect(JSON.stringify(json)).not.toContain("secret")
    } finally {
      cacheControl.fail = false
    }
  })
})
