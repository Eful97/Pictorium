import { describe, expect, it, beforeEach, vi, afterEach } from "vitest"
import { getJWRankings, getJWTitleQualityResult, resolveJWLeavingDate, __resetJWRankingsCache } from "@/lib/justwatch"

const TODAY = "2026-11-25"

describe("resolveJWLeavingDate", () => {
  it("returns the nearest future availableTo among streaming offers", () => {
    expect(
      resolveJWLeavingDate(
        [
          { monetizationType: "FLATRATE", availableTo: "2027-03-01" },
          { monetizationType: "FLATRATE", availableTo: "2026-12-10" },
        ],
        TODAY,
      ),
    ).toBe("2026-12-10")
  })

  it("ignores buy/rent, past dates and malformed values", () => {
    expect(
      resolveJWLeavingDate(
        [
          { monetizationType: "RENT", availableTo: "2026-12-01" },
          { monetizationType: "BUY", availableTo: "2026-12-02" },
          { monetizationType: "FLATRATE", availableTo: "2026-01-01" },
        ],
        TODAY,
      ),
    ).toBeNull()
  })

  it("returns null when an open-ended streaming offer keeps the title available", () => {
    expect(
      resolveJWLeavingDate(
        [
          { monetizationType: "FLATRATE", availableTo: "2026-12-10" },
          { monetizationType: "FLATRATE", availableTo: null },
        ],
        TODAY,
      ),
    ).toBeNull()
  })

  it("accepts ISO timestamps and returns the date part", () => {
    expect(resolveJWLeavingDate([{ monetizationType: "FREE", availableTo: "2026-12-10T00:00:00Z" }], TODAY)).toBe("2026-12-10")
  })
})

describe("JW chart trend fields and leavingOn", () => {
  beforeEach(() => {
    __resetJWRankingsCache()
    vi.restoreAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  const edge = (tmdbId: number, info: Record<string, unknown>) => ({
    streamingChartInfo: info,
    node: { content: { title: `T${tmdbId}`, originalReleaseDate: "2020-01-01", externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
  })

  it("maps trend, trendDifference, topRank and daysInTop10 when present, omits them otherwise", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            streamingCharts: {
              edges: [
                edge(1, { rank: 1, trend: "UP", trendDifference: 8, topRank: 1, daysInTop10: 24 }),
                edge(2, { rank: 2 }),
                edge(3, { rank: 3, trend: "WEIRD" }),
              ],
            },
          },
        }),
        { status: 200 },
      ),
    )
    const rows = await getJWRankings("MOVIE", "IT", 3, undefined, "it-IT")
    expect(rows[0]).toMatchObject({ tmdbId: 1, rank: 1, trend: "UP", trendDifference: 8, topRank: 1, daysInTop10: 24 })
    expect(rows[1]).toEqual({ tmdbId: 2, imdbId: "tt2", rank: 2, title: "T2" })
    expect(rows[2]).not.toHaveProperty("trend")
  })

  it("exposes leavingOn from offers when every streaming offer has an expiry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            popularTitles: {
              edges: [
                {
                  node: {
                    content: { title: "X", externalIds: { tmdbId: 42 } },
                    offers: [{ monetizationType: "FLATRATE", presentationType: "HD", availableTo: "2099-01-01" }],
                  },
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    )
    const res = await getJWTitleQualityResult(42, "MOVIE", "X", "IT")
    expect(res.ok).toBe(true)
    expect(res.leavingOn).toBe("2099-01-01")
  })
})
