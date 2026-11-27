import { beforeEach, describe, expect, it } from "vitest"
import {
  __inMemoryChartGenerationPersist,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
  commitChartFamilySnapshot,
  pinChartFamily,
  pinnedFamilyRows,
  tryAcquireChartFamilyLease,
} from "@/lib/chart-generation"

const FAMILY = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:charts" }

describe("ChartRow trend fields survive snapshot normalization", () => {
  beforeEach(() => {
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
  })

  it("keeps valid trend metadata and drops invalid values", async () => {
    const owner = await tryAcquireChartFamilyLease(FAMILY)
    expect(owner).toBeTruthy()
    await commitChartFamilySnapshot(
      {
        ...FAMILY,
        status: "ok",
        rows: [
          { tmdbId: 1, imdbId: "tt1", rank: 1, title: "A", trend: "UP", trendDifference: 8, topRank: 1, daysInTop10: 24 },
          { tmdbId: 2, imdbId: null, rank: 2, title: "B", trend: "SIDEWAYS", trendDifference: "x", topRank: 0, daysInTop10: -3 },
          { tmdbId: 3, imdbId: null, rank: 3, title: "C" },
        ],
      },
      owner as string,
    )
    const rows = pinnedFamilyRows(await pinChartFamily(FAMILY)) ?? []
    expect(rows[0]).toMatchObject({ tmdbId: 1, trend: "UP", trendDifference: 8, topRank: 1, daysInTop10: 24 })
    for (const k of ["trend", "trendDifference", "topRank", "daysInTop10"]) {
      expect(rows[1]).not.toHaveProperty(k)
      expect(rows[2]).not.toHaveProperty(k)
    }
  })
})
