import { describe, expect, it, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"

describe("GET /meta unresolvable anime prefixes (P1-2)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("kitsu:123 resolves to { meta: null } without upstream fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const req = new NextRequest("http://localhost:3000/meta/series/kitsu:123.json")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "kitsu:123.json" }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ meta: null })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
