import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchTop20Ranking } from "@/lib/top20-ranking"
import * as justwatch from "@/lib/justwatch"
import * as customRanking from "@/lib/custom-ranking"

describe("fetchTop20Ranking (shared ranking retrieval)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("retrieves JustWatch charts as default with official ranks preserved", async () => {
    const mockCharts = vi.spyOn(justwatch, "getJWRankings").mockResolvedValueOnce([
      { tmdbId: 101, imdbId: "tt101", rank: 1, title: "Movie 1" },
      { tmdbId: 102, imdbId: "tt102", rank: 3, title: "Movie 2" }, // official rank 3 (gap)
    ])

    const res = await fetchTop20Ranking({
      slot: "movie",
      source: { kind: "justwatch", mode: "charts" },
      regionCode: "IT",
      regionLang: "it-IT",
    })

    expect(mockCharts).toHaveBeenCalledWith("MOVIE", "IT", 20, undefined, "it-IT", undefined, undefined)
    expect(res.status).toBe("ok")
    expect(res.period).toBe("day")
    expect(res.items).toEqual([
      { tmdbId: 101, imdbId: "tt101", rank: 1, title: "Movie 1" },
      { tmdbId: 102, imdbId: "tt102", rank: 3, title: "Movie 2" },
    ])
  })

  it("retrieves POPULAR with digital monetization filter and sequential ranks 1..N", async () => {
    const mockTitles = vi.spyOn(justwatch, "getJWTitles").mockResolvedValueOnce([
      { tmdbId: 201, imdbId: "tt201", rank: 1, title: "Pop 1" },
      { tmdbId: 202, imdbId: "tt202", rank: 2, title: "Pop 2" },
    ])

    const res = await fetchTop20Ranking({
      slot: "movie",
      source: { kind: "justwatch", mode: "popular" },
      regionCode: "IT",
      regionLang: "it-IT",
    })

    expect(mockTitles).toHaveBeenCalledWith({
      objectType: "MOVIE",
      country: "IT",
      first: 20,
      offset: 0,
      sortBy: "POPULAR",
      language: "it-IT",
      monetizationTypes: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
      overfetch: false,
      signal: undefined,
      minFetchedAtMs: undefined,
    })
    expect(res.status).toBe("ok")
    expect(res.period).toBe("popular")
    expect(res.items).toEqual([
      { tmdbId: 201, imdbId: "tt201", rank: 1, title: "Pop 1" },
      { tmdbId: 202, imdbId: "tt202", rank: 2, title: "Pop 2" },
    ])
  })

  it("retrieves TRENDING with digital monetization filter and sequential ranks 1..N", async () => {
    const mockTitles = vi.spyOn(justwatch, "getJWTitles").mockResolvedValueOnce([
      { tmdbId: 301, imdbId: "tt301", rank: 1, title: "Trend 1" },
      { tmdbId: 302, imdbId: "tt302", rank: 2, title: "Trend 2" },
    ])

    const res = await fetchTop20Ranking({
      slot: "series",
      source: { kind: "justwatch", mode: "trending" },
      regionCode: "FR",
      regionLang: "fr-FR",
    })

    expect(mockTitles).toHaveBeenCalledWith({
      objectType: "SHOW",
      country: "FR",
      first: 20,
      offset: 0,
      sortBy: "TRENDING",
      language: "fr-FR",
      monetizationTypes: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
      overfetch: false,
      signal: undefined,
      minFetchedAtMs: undefined,
    })
    expect(res.status).toBe("ok")
    expect(res.period).toBe("trending")
    expect(res.items).toEqual([
      { tmdbId: 301, imdbId: "tt301", rank: 1, title: "Trend 1" },
      { tmdbId: 302, imdbId: "tt302", rank: 2, title: "Trend 2" },
    ])
  })

  it("returns unsupported and empty list for GLOBAL region with POPULAR or TRENDING (no fallback to US)", async () => {
    const mockTitles = vi.spyOn(justwatch, "getJWTitles")

    const resPop = await fetchTop20Ranking({
      slot: "movie",
      source: { kind: "justwatch", mode: "popular" },
      regionCode: "GLOBAL",
    })
    expect(resPop.status).toBe("unsupported")
    expect(resPop.items).toEqual([])
    expect(mockTitles).not.toHaveBeenCalled()

    const resTrend = await fetchTop20Ranking({
      slot: "series",
      source: { kind: "justwatch", mode: "trending" },
      regionCode: "GLOBAL",
    })
    expect(resTrend.status).toBe("unsupported")
    expect(resTrend.items).toEqual([])
    expect(mockTitles).not.toHaveBeenCalled()
  })

  it("deduplicates tmdbId and caps at 20 items without backfilling", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      tmdbId: i < 5 ? 100 : i, // duplicate 100 in first 5 rows
      imdbId: `tt${i}`,
      rank: i + 1,
      title: `Item ${i}`,
    }))
    vi.spyOn(justwatch, "getJWTitles").mockResolvedValueOnce(rows)

    const res = await fetchTop20Ranking({
      slot: "movie",
      source: { kind: "justwatch", mode: "popular" },
      regionCode: "IT",
    })

    expect(res.items.length).toBeLessThanOrEqual(20)
    const ids = res.items.map((it) => it.tmdbId)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it("forwards custom ranking requests through fetchCustomRankingTop20", async () => {
    const mockCustom = vi.spyOn(customRanking, "fetchCustomRankingTop20").mockResolvedValueOnce({
      status: "ok",
      items: [
        { tmdbId: 501, imdb: "tt501", title: "Custom 1", year: 2024 },
        { tmdbId: 502, imdb: "tt502", title: "Custom 2", year: 2023 },
      ],
    })

    const customList = {
      id: "my_custom",
      name: "My Custom",
      type: "movie" as const,
      url: "https://example.com/list",
    }

    const res = await fetchTop20Ranking({
      slot: "movie",
      source: { kind: "custom", customId: "my_custom" },
      regionCode: "IT",
      customCatalogs: [customList],
    })

    expect(mockCustom).toHaveBeenCalled()
    expect(res.status).toBe("ok")
    expect(res.period).toBe("custom")
    expect(res.items).toEqual([
      { tmdbId: 501, imdbId: "tt501", rank: 1, title: "Custom 1" },
      { tmdbId: 502, imdbId: "tt502", rank: 2, title: "Custom 2" },
    ])
  })
})
