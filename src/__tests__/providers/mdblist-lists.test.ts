import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  MDBLIST_BROWSE_TTL_MS,
  fetchMDBListListSearch,
  fetchMDBListTopLists,
  fetchMDBListUserLists,
  parseMDBListSummaries,
} from "@/lib/mdblist"
import { __resetMdbQuotaForTests } from "@/lib/mdblist-quota"
import { cacheClear } from "@/lib/cache"
import { GET } from "@/app/api/mdblist/lists/route"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const TOP_PAYLOAD = {
  lists: [
    {
      id: 42,
      name: "Trending Movies",
      slug: "trending-movies",
      user_name: "snoak",
      mediatype: "movie",
      items: 120,
      likes: 33,
      description: "What people watch",
    },
    { id: 43, name: "No slug but id", likes: "4" },
    { name: "broken without ids" },
  ],
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  })
}

beforeEach(() => {
  process.env.MDBLIST_API_URL = "http://mock.local/mdblist/api"
  cacheClear()
  __resetMdbQuotaForTests()
  vi.restoreAllMocks()
})

afterEach(() => {
  delete process.env.MDBLIST_API_URL
  __resetMdbQuotaForTests()
})

describe("parseMDBListSummaries", () => {
  it("normalizes envelopes, canonical URLs and skips unusable rows", () => {
    const lists = parseMDBListSummaries(TOP_PAYLOAD)
    expect(lists).toHaveLength(2)
    expect(lists[0]).toMatchObject({
      id: 42,
      name: "Trending Movies",
      userName: "snoak",
      slug: "trending-movies",
      mediaType: "movie",
      itemCount: 120,
      likes: 33,
      url: "https://mdblist.com/lists/snoak/trending-movies",
    })
    expect(lists[1]).toMatchObject({
      id: 43,
      name: "No slug but id",
      url: "https://mdblist.com/lists/43",
    })
  })

  it("accepts a bare array and ignores malformed payloads", () => {
    expect(parseMDBListSummaries([{ name: "A", slug: "a", user_name: "u" }])[0]?.url).toBe(
      "https://mdblist.com/lists/u/a",
    )
    expect(parseMDBListSummaries({ nope: true })).toEqual([])
    expect(parseMDBListSummaries(null)).toEqual([])
  })
})

describe("MDBList browse fetchers", () => {
  it("top lists: fetches once, caches 60 minutes, never leaks the key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(TOP_PAYLOAD))
    const first = await fetchMDBListTopLists("secret-mdblist-key", 20)
    const second = await fetchMDBListTopLists("secret-mdblist-key", 20)
    expect(first).toHaveLength(2)
    expect(second).toEqual(first)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const called = String(fetchSpy.mock.calls[0]?.[0])
    expect(called).toContain("/lists/top")
    expect(called).toContain("limit=20")
    expect(called).toContain("apikey=secret-mdblist-key")
    expect(MDBLIST_BROWSE_TTL_MS).toBe(60 * 60 * 1000)
  })

  it("search and user lists hit their documented endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(TOP_PAYLOAD))
    await fetchMDBListListSearch("dune", "k", 5)
    await fetchMDBListUserLists("snoak", "k", 5)
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain("/lists/search?query=dune")
    expect(urls[0]).toContain("limit=5")
    expect(urls[1]).toContain("/lists/user/snoak")
  })

  it("empty query/user and missing key never touch the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    expect(await fetchMDBListListSearch("   ", "k")).toEqual([])
    expect(await fetchMDBListUserLists("bad user", "k")).toEqual([])
    expect(await fetchMDBListTopLists(undefined)).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("a parked (429 exhausted) key skips the keyed fetch", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({}, 429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }),
      )
    expect(await fetchMDBListTopLists("parked-key")).toEqual([])
    expect(await fetchMDBListTopLists("parked-key")).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe("GET /api/mdblist/lists", () => {
  it("returns browse results with an honest configured flag", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(TOP_PAYLOAD))
    const req = new NextRequest("http://localhost/api/mdblist/lists?mode=top&limit=10&mdblist_key=route-key")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ mode: "top", configured: true })
    expect(body.lists).toHaveLength(2)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("/lists/top")
    // Second request is served from the 60-minute cache.
    await GET(new NextRequest("http://localhost/api/mdblist/lists?mode=top&limit=10&mdblist_key=route-key"))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("is an honest empty list without a key", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const res = await GET(new NextRequest("http://localhost/api/mdblist/lists?mode=top"))
    expect(await res.json()).toMatchObject({ lists: [], configured: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
