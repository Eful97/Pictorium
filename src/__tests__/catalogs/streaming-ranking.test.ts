/**
 * Imported Top 10 streaming lists as global ranking source (server side).
 *
 * Contract under test:
 * - coordinates: legacy `stream:` family vs generic `stream2:` family, group
 *   = the SELECTION country (never the request region);
 * - official chart ranks 1..10 only — mixed charts keep their real per-row
 *   media type and their positions (no renumber, no invented 11..20);
 * - `error` only on a cold failure (no published snapshot), `empty` for a
 *   genuine empty/slot without matching rows;
 * - `/api/trending/rank` serves the SAME pinned rows with `top: 10` and
 *   `private, no-cache`, never a JW substitute.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/streaming-ranking-test`,
}))

vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn() }
})

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({})),
    getServerDefaultsChecked: vi.fn(async () => ({})),
    getServerDefaultsForUser: vi.fn(async () => ({})),
  }
})

import { GET as rankGET } from "@/app/api/trending/rank/route"
import { cacheClear } from "@/lib/cache"
import { __resetChartGenerationForTest, type ChartRow } from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { getServerDefaults } from "@/lib/server-defaults"
import {
  fetchStreamingRanking,
  streamingRankingCoordinates,
  streamingRankingItemsFromPin,
} from "@/lib/streaming-ranking"
import { genericStreamingCatalogId, streamingCatalogId } from "@/lib/streaming-catalogs"

const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)
const mockedDefaults = vi.mocked(getServerDefaults)

const NETFLIX_MOVIES_ID = streamingCatalogId("netflix", "IT", "movies")
const NETFLIX_SERIES_ID = streamingCatalogId("netflix", "IT", "series")
const HULU_ALL_ID = genericStreamingCatalogId("hulu", "united-states", "all", "auto", null)

function row(tmdbId: number | null, rank: number, mediaType?: "movie" | "tv"): ChartRow {
  return { tmdbId: tmdbId ?? 0, imdbId: null, rank, title: `Title ${tmdbId}`, ...(mediaType ? { mediaType } : {}) }
}

function pinWith(rows: ChartRow[], opts?: { status?: "ok" | "empty"; generation?: string }) {
  const generation = opts?.generation ?? "20261022-12"
  return {
    id: generation,
    snapshot: {
      generation,
      group: "g",
      family: "f",
      status: opts?.status ?? "ok",
      rows,
      fetchedAt: 1,
      publishedAt: 2,
    },
  }
}

const livePin = { id: "live", snapshot: null }

describe("streamingRankingCoordinates", () => {
  it("maps a legacy selection to its isolated stream family and country", () => {
    expect(streamingRankingCoordinates(NETFLIX_MOVIES_ID)).toEqual({
      family: "stream:netflix:movie",
      regionCode: "IT",
      regionLang: "it-IT",
      section: "movies",
    })
    expect(streamingRankingCoordinates(NETFLIX_SERIES_ID)).toEqual({
      family: "stream:netflix:series",
      regionCode: "IT",
      regionLang: "it-IT",
      section: "series",
    })
  })

  it("maps a generic mixed selection to its encoded stream2 family", () => {
    expect(streamingRankingCoordinates(HULU_ALL_ID)).toEqual({
      family: "stream2:auto:hulu:united-states:all:-",
      regionCode: "US",
      regionLang: "en-US",
      section: "all",
    })
  })

  it("rejects malformed ids", () => {
    expect(streamingRankingCoordinates("pictorium-jw-movies")).toBeNull()
    expect(streamingRankingCoordinates("pictorium-stream-nope")).toBeNull()
  })
})

describe("streamingRankingItemsFromPin", () => {
  const legacyCoords = {
    family: "stream:netflix:movie",
    regionCode: "IT",
    regionLang: "it-IT",
    section: "movies" as const,
  }

  it("keeps official ranks and never renumbers or fills", () => {
    const pin = pinWith([row(101, 1), row(102, 2), row(103, 4)])
    const res = streamingRankingItemsFromPin(pin, "movie", legacyCoords)
    expect(res.status).toBe("ok")
    expect(res.items.map((i) => [i.tmdbId, i.rank])).toEqual([[101, 1], [102, 2], [103, 4]])
    expect(res.family).toBe("stream:netflix:movie")
  })

  it("drops rows past the Top 10 window instead of clamping them", () => {
    const pin = pinWith([row(101, 1), row(111, 11), row(120, 20)])
    expect(streamingRankingItemsFromPin(pin, "movie", legacyCoords).items.map((i) => i.rank)).toEqual([1])
  })

  it("filters mixed charts by real media type, keeping chart positions", () => {
    const coords = { ...streamingRankingCoordinates(HULU_ALL_ID)! }
    const pin = pinWith([row(1, 1, "movie"), row(2, 2, "tv"), row(3, 3, "movie"), row(4, 4, "tv")])
    expect(streamingRankingItemsFromPin(pin, "movie", coords).items.map((i) => [i.tmdbId, i.rank])).toEqual([
      [1, 1],
      [3, 3],
    ])
    expect(streamingRankingItemsFromPin(pin, "series", coords).items.map((i) => [i.tmdbId, i.rank])).toEqual([
      [2, 2],
      [4, 4],
    ])
  })

  it("reports error only without a published snapshot", () => {
    const res = streamingRankingItemsFromPin(livePin as never, "movie", legacyCoords)
    expect(res.status).toBe("error")
    expect(res.errorStatus).toBe("unavailable")
    expect(res.items).toEqual([])
  })

  it("reports a genuine empty snapshot as empty", () => {
    const res = streamingRankingItemsFromPin(pinWith([], { status: "empty" }), "movie", legacyCoords)
    expect(res.status).toBe("empty")
    expect(res.items).toEqual([])
  })

  it("reports a slot with no matching rows as empty (mixed chart)", () => {
    const coords = { ...streamingRankingCoordinates(HULU_ALL_ID)! }
    const res = streamingRankingItemsFromPin(pinWith([row(1, 1, "movie")]), "series", coords)
    expect(res.status).toBe("empty")
  })
})

describe("fetchStreamingRanking", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cacheClear()
    __resetChartGenerationForTest()
  })

  it("refreshes/reads the selection's own family with its country coordinates", async () => {
    mockedEnsureFresh.mockResolvedValueOnce(pinWith([row(101, 1), row(102, 2)]) as never)
    const res = await fetchStreamingRanking({ catalogId: NETFLIX_MOVIES_ID, slot: "movie" })
    expect(res.status).toBe("ok")
    expect(res.items.map((i) => i.rank)).toEqual([1, 2])
    expect(mockedEnsureFresh).toHaveBeenCalledWith(
      expect.objectContaining({
        family: "stream:netflix:movie",
        regionCode: "IT",
        regionLang: "it-IT",
      }),
    )
  })
})

describe("GET /api/trending/rank with a streaming ranking source", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockedDefaults.mockReset()
    mockedEnsureFresh.mockReset()
    cacheClear()
    __resetChartGenerationForTest()
  })

  it("serves the official Top 10 position with no JW traffic", async () => {
    mockedDefaults.mockReturnValue({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    } as never)
    mockedEnsureFresh.mockResolvedValue(pinWith([row(101, 1), row(102, 2), row(103, 3)]) as never)
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const res = await rankGET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=102&region=IT"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache, must-revalidate")
    expect(await res.json()).toMatchObject({ rank: 2, period: "streaming", top: 10 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("reports an honest miss for titles outside the pinned Top 10", async () => {
    mockedDefaults.mockReturnValue({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    } as never)
    mockedEnsureFresh.mockResolvedValue(pinWith([row(101, 1)]) as never)

    const res = await rankGET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=999&region=IT"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ rank: null, top: 10, period: "streaming" })
  })

  it("surfaces a cold failure explicitly (never a JW substitute)", async () => {
    mockedDefaults.mockReturnValue({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    } as never)
    mockedEnsureFresh.mockResolvedValue(livePin as never)

    const res = await rankGET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=101&region=IT"))
    expect(res.status).toBe(502)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(await res.json()).toMatchObject({ rank: null, error: "unavailable" })
  })

  it("falls back to JustWatch when the streaming selection is gone", async () => {
    // Stored reference without a matching enabled selection: the resolver
    // returns JustWatch, so this test only asserts the source-independent
    // contract (no 5xx, no streaming period).
    mockedDefaults.mockReturnValue({
      streamingSelections: [],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    } as never)
    // JW fallback (the resolver downgraded the stale reference): the mocked
    // chart family resolves live, so no snapshot and no period override.
    mockedEnsureFresh.mockResolvedValue(livePin as never)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ data: { streamingCharts: { edges: [] } } }),
    )
    const res = await rankGET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=101&region=IT"))
    expect(res.status).toBe(200)
    expect(await res.json()).not.toMatchObject({ period: "streaming" })
  })
})
