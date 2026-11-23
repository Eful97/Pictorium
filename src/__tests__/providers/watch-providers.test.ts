import { afterEach, describe, expect, it, vi } from "vitest"
import { __clearTMDBCache } from "@/lib/tmdb"
import { getWatchProviders, getWatchProvidersResult, parseWatchProviders } from "@/lib/watch-providers"

const doc = {
  results: {
    IT: {
      flatrate: [
        { provider_id: 337, provider_name: "Disney Plus", logo_path: "/d.jpg", display_priority: 2 },
        { provider_id: 8, provider_name: "Netflix", logo_path: "/n.jpg", display_priority: 0 },
        { provider_id: 99, provider_name: "NoLogo", logo_path: null, display_priority: 1 },
      ],
      rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg", display_priority: 0 }],
      buy: [{ provider_id: 3, provider_name: "Google Play", logo_path: "/g.jpg", display_priority: 0 }],
    },
  },
}

describe("parseWatchProviders", () => {
  it("returns flatrate only, ordered by display_priority, skipping entries without logo", () => {
    expect(parseWatchProviders(doc, "IT")).toEqual([
      { id: 8, name: "Netflix", logoPath: "/n.jpg" },
      { id: 337, name: "Disney Plus", logoPath: "/d.jpg" },
    ])
  })

  it("drops duplicates: same logo or same provider family (Apple TV / Apple TV Plus / Amazon Channel)", () => {
    const dup = {
      results: {
        IT: {
          flatrate: [
            { provider_id: 2, provider_name: "Apple TV", logo_path: "/a.jpg", display_priority: 0 },
            { provider_id: 350, provider_name: "Apple TV Plus", logo_path: "/a2.jpg", display_priority: 1 },
            { provider_id: 8, provider_name: "Netflix", logo_path: "/n.jpg", display_priority: 2 },
            { provider_id: 9, provider_name: "Netflix Standard", logo_path: "/n.jpg", display_priority: 3 },
            { provider_id: 119, provider_name: "Netflix Amazon Channel", logo_path: "/n3.jpg", display_priority: 4 },
          ],
        },
      },
    }
    expect(parseWatchProviders(dup, "IT").map((p) => p.id)).toEqual([2, 8])
  })

  it("returns [] for a missing region", () => {
    expect(parseWatchProviders(doc, "US")).toEqual([])
  })

  it("returns [] for malformed input and prototype keys", () => {
    expect(parseWatchProviders(null, "IT")).toEqual([])
    expect(parseWatchProviders("x", "IT")).toEqual([])
    expect(parseWatchProviders({ results: [] }, "IT")).toEqual([])
    expect(parseWatchProviders(doc, "__proto__")).toEqual([])
  })
})

describe("getWatchProviders", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
  })

  it("requests /watch/providers and parses the region", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(doc))
    const out = await getWatchProviders("tv", 1396, "IT", "test-key")
    expect(String(spy.mock.calls[0][0])).toContain("/tv/1396/watch/providers")
    expect(out.map((p) => p.name)).toEqual(["Netflix", "Disney Plus"])
  })

  it("never throws: 401 and network failure resolve to []", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 401 }))
    expect(await getWatchProviders("movie", 1, "IT", "bad-key")).toEqual([])
    __clearTMDBCache()
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"))
    expect(await getWatchProviders("movie", 2, "IT", "test-key")).toEqual([])
  })
})

describe("getWatchProvidersResult", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
  })

  it("failed=false on success and on a region with no providers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(doc))
    expect((await getWatchProvidersResult("tv", 1, "IT", "k")).failed).toBe(false)
    expect(await getWatchProvidersResult("tv", 1, "US", "k")).toEqual({ providers: [], failed: false })
  })

  it("failed=true on 401 and on network error (distinct from 'no providers')", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 401 }))
    expect(await getWatchProvidersResult("movie", 3, "IT", "bad")).toEqual({ providers: [], failed: true })
    __clearTMDBCache()
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"))
    expect((await getWatchProvidersResult("movie", 4, "IT", "k")).failed).toBe(true)
  })
})
