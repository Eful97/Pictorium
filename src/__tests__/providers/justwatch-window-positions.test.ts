/**
 * Automatic Top-20 badge window (shared contract).
 *
 * Source truth for AUTOMATIC numeric badges: general JW Top 20 (official
 * positions 1..20) and Anime Top 20 (positions 1..20). The adapter preserves
 * official `streamingChartInfo.rank` values verbatim — including values past
 * the window (overfetch/unreleased filtering, package-filter ranks in the
 * hundreds) — and the badge channel admits ONLY official 1..20 (never
 * clamped, never remapped, never filled from outside the Top 20).
 * Platform/FP/stream lists and ordinary custom lists never supply their own
 * rank; an explicitly selected custom ranking source stays fully functional
 * as a badge source (positions 1..20). Manual `rank=` overrides, diagnostic
 * `rk=` and Fresh 1..100 are untouched by this contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getJWRankings, __resetJWRankingsCache } from "@/lib/justwatch"
import { isAutomaticTrendRank } from "@/lib/badge-priority"

function edgesResponse(
  edges: Array<{ tmdbId: number; rank?: number | null; date?: string | null }>,
): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: edges.map((e) => ({
          ...(e.rank === undefined ? {} : { streamingChartInfo: { rank: e.rank } }),
          node: {
            content: {
              title: `Title ${e.tmdbId}`,
              ...(e.date !== undefined ? { originalReleaseDate: e.date } : {}),
              externalIds: { tmdbId: e.tmdbId, imdbId: `tt${e.tmdbId}` },
            },
          },
        })),
      },
    },
  })
}

beforeEach(() => {
  __resetJWRankingsCache()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetJWRankingsCache()
})

describe("automatic Top-20 window (shared contract)", () => {
  it("adapter preserves official ranks verbatim, including past-window values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      edgesResponse([
        { tmdbId: 11, rank: 5, date: "2024-01-01" },
        { tmdbId: 12, rank: 21, date: "2024-01-01" },
        { tmdbId: 13, rank: 482, date: "2024-01-01" },
      ]),
    )

    const rows = await getJWRankings("MOVIE", "IT", 10)
    // Order preserved, official ranks untouched: filtering happens at the
    // badge channel (route / rank API / catalog rk=), never here.
    expect(rows.map((r) => r.tmdbId)).toEqual([11, 12, 13])
    expect(rows.map((r) => r.rank)).toEqual([5, 21, 482])
  })

  it("isAutomaticTrendRank admits only official Top-20 positions", () => {
    expect(isAutomaticTrendRank(1)).toBe(true)
    expect(isAutomaticTrendRank(20)).toBe(true)
    expect(isAutomaticTrendRank(0)).toBe(false)
    expect(isAutomaticTrendRank(21)).toBe(false)
    expect(isAutomaticTrendRank(22)).toBe(false)
    expect(isAutomaticTrendRank(482)).toBe(false)
    expect(isAutomaticTrendRank(1.5)).toBe(false)
    expect(isAutomaticTrendRank(null)).toBe(false)
    expect(isAutomaticTrendRank(undefined)).toBe(false)
    expect(isAutomaticTrendRank("5")).toBe(false)
  })

  it("still skips unreleased, duplicates and rankless rows with compact order", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      edgesResponse([
        { tmdbId: 301, rank: 5, date: "2024-01-01" },
        { tmdbId: 301, rank: 6, date: "2024-01-01" },
        { tmdbId: 302, rank: 7, date: "2999-01-01" },
        { tmdbId: 303, date: "2024-01-01" },
        { tmdbId: 304, rank: 9, date: "2024-01-01" },
      ]),
    )

    const rows = await getJWRankings("SHOW", "IT", 10)
    expect(rows.map((r) => r.tmdbId)).toEqual([301, 304])
    expect(rows.map((r) => r.rank)).toEqual([5, 9])
  })
})
