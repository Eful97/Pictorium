import { describe, expect, it, beforeEach, vi, afterEach } from "vitest"
import { resolveMaxQuality, getJWTitleQuality, __resetJWRankingsCache } from "@/lib/justwatch"

describe("resolveMaxQuality", () => {
  it("returns null for empty offers", () => {
    expect(resolveMaxQuality([])).toBeNull()
  })

  it("returns 4K if any offer is 4K", () => {
    expect(resolveMaxQuality(["SD", "HD", "4k"])).toBe("4K")
    expect(resolveMaxQuality(["4K", "HD"])).toBe("4K")
    expect(resolveMaxQuality(["UHD"])).toBe("4K")
  })

  it("returns FHD if max offer is HD/1080p/FHD/720p", () => {
    expect(resolveMaxQuality(["SD", "HD"])).toBe("FHD")
    expect(resolveMaxQuality(["1080p"])).toBe("FHD")
    expect(resolveMaxQuality(["FHD"])).toBe("FHD")
    expect(resolveMaxQuality(["SD", "720p"])).toBe("FHD")
  })

  it("returns SD if only SD/480 offers are available", () => {
    expect(resolveMaxQuality(["SD"])).toBe("SD")
    expect(resolveMaxQuality(["480p"])).toBe("SD")
  })
})

describe("getJWTitleQuality", () => {
  beforeEach(() => {
    __resetJWRankingsCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches quality offers via GraphQL and returns highest quality", async () => {
    const mockGraphQLResponse = {
      data: {
        popularTitles: {
          edges: [
            {
              node: {
                content: {
                  title: "Avatar",
                  externalIds: { tmdbId: 19995 },
                },
                offers: [
                  { presentationType: "HD" },
                  { presentationType: "4K" },
                ],
              },
            },
          ],
        },
      },
    }

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockGraphQLResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const quality = await getJWTitleQuality(19995, "MOVIE", "Avatar", "IT")
    expect(quality).toBe("4K")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Check caching: second call for same tmdbId should not trigger fetch
    const cachedQuality = await getJWTitleQuality(19995, "MOVIE", "Avatar", "IT")
    expect(cachedQuality).toBe("4K")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("returns null if response is invalid or empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { popularTitles: { edges: [] } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const quality = await getJWTitleQuality(999999, "MOVIE", "Nonexistent", "IT")
    expect(quality).toBeNull()
  })
})
