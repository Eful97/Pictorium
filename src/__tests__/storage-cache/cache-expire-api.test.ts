import { afterEach, describe, expect, it } from "vitest"
import { POST } from "@/app/api/cache/expire/route"
import { cacheClear, cacheSet, cacheGetStale, cacheGet, cacheExpire } from "@/lib/cache"
import { NextRequest } from "next/server"

afterEach(() => {
  cacheClear()
  delete process.env.ADMIN_TOKEN
  delete process.env.PICTORIUM_ADMIN_TOKEN
})

describe("cacheExpire unit logic", () => {
  it("marks targeted entry as stale in-place preserving data", () => {
    cacheSet("poster:movie:950001", { title: "Test 950001" }, ["poster"])
    cacheSet("poster:movie:950001:headers", { etag: "abc" }, ["poster"])
    cacheSet("catalog:popular", { items: [] }, ["catalog"])

    // Verify initial fresh state
    expect(cacheGetStale("poster:movie:950001").stale).toBe(false)
    expect(cacheGetStale("poster:movie:950001:headers").stale).toBe(false)

    // Expire specific key / substring
    const expiredCount = cacheExpire("movie:950001")
    expect(expiredCount).toBe(2)

    // Verify stale retrieval: data is preserved, but stale=true
    const stalePayload = cacheGetStale<{ title: string }>("poster:movie:950001")
    expect(stalePayload.data).toEqual({ title: "Test 950001" })
    expect(stalePayload.stale).toBe(true)

    const staleHeaders = cacheGetStale<{ etag: string }>("poster:movie:950001:headers")
    expect(staleHeaders.data).toEqual({ etag: "abc" })
    expect(staleHeaders.stale).toBe(true)

    // Regular cacheGet drops the expired entry and returns null
    expect(cacheGet("poster:movie:950001")).toBeNull()

    // Catalog was untouched
    expect(cacheGetStale("catalog:popular").stale).toBe(false)
  })

  it("marks all entries matching a tag as stale", () => {
    cacheSet("p1", "poster1", ["poster"])
    cacheSet("p2", "poster2", ["poster"])
    cacheSet("c1", "catalog1", ["catalog"])

    const count = cacheExpire("poster")
    expect(count).toBe(2)

    expect(cacheGetStale("p1").stale).toBe(true)
    expect(cacheGetStale("p2").stale).toBe(true)
    expect(cacheGetStale("c1").stale).toBe(false)
  })
})

describe("POST /api/cache/expire", () => {
  it("requires admin token when configured", async () => {
    process.env.ADMIN_TOKEN = "supersecret"

    const req = new NextRequest("http://localhost:3000/api/cache/expire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "movie:950001" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("rejects cross-origin requests", async () => {
    process.env.ADMIN_TOKEN = "supersecret"

    const req = new NextRequest("http://localhost:3000/api/cache/expire", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": "supersecret",
        "origin": "https://malicious.evil.com",
      },
      body: JSON.stringify({ key: "movie:950001" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it("returns 400 on missing or empty target parameter", async () => {
    process.env.ADMIN_TOKEN = "supersecret"
    const req = new NextRequest("http://localhost:3000/api/cache/expire", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": "supersecret" },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("Missing or invalid")
  })

  it("successfully expires matching entries with valid auth", async () => {
    process.env.ADMIN_TOKEN = "supersecret"

    cacheSet("poster:movie:950001", "data", ["poster"])
    cacheSet("poster:movie:950001:headers", { etag: "123" }, ["poster"])

    const req = new NextRequest("http://localhost:3000/api/cache/expire", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": "supersecret",
      },
      body: JSON.stringify({ key: "movie:950001" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      ok: true,
      target: "movie:950001",
      expired: 2,
    })

    expect(cacheGetStale("poster:movie:950001").stale).toBe(true)
  })
})
