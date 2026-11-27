import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import {
  buildJWDynamicUrl,
  detectCatalogProvider,
  parseJWDynamicUrl,
} from "@/lib/catalog-provider-detect"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { fetchJWDynamicList } from "@/lib/jw-dynamic"
import { fetchUnifiedCatalogResult } from "@/lib/custom-catalog-providers"

describe("JW dynamic URL contract", () => {
  it("round-trips every kind, normalizing the country", () => {
    const url = buildJWDynamicUrl({ kind: "new", type: "movie", country: "it" })
    expect(url).toBe("justwatch:new?type=movie&country=IT")
    expect(parseJWDynamicUrl(url)).toEqual({ kind: "new", type: "movie", country: "IT" })
    const g = buildJWDynamicUrl({ kind: "genre", type: "series", country: "US", genre: "hrr" })
    expect(g).toBe("justwatch:genre?type=series&country=US&genre=hrr")
    expect(parseJWDynamicUrl(g)).toEqual({ kind: "genre", type: "series", country: "US", genre: "hrr" })
  })

  it("fails closed on unknown kind/type/country/genre", () => {
    expect(parseJWDynamicUrl("justwatch:bogus?type=movie&country=IT")).toBeNull()
    expect(parseJWDynamicUrl("justwatch:new?type=mixed&country=IT")).toBeNull()
    expect(parseJWDynamicUrl("justwatch:new?type=movie&country=ITA")).toBeNull()
    expect(parseJWDynamicUrl("justwatch:genre?type=movie&country=IT")).toBeNull()
    expect(parseJWDynamicUrl("justwatch:genre?type=movie&country=IT&genre=xxx")).toBeNull()
    expect(parseJWDynamicUrl("https://www.justwatch.com/it/new")).toBeNull()
  })

  it("is detected as the justwatch provider with the URL type as default", () => {
    expect(detectCatalogProvider("justwatch:leaving?type=series&country=GB")).toMatchObject({
      provider: "justwatch",
      defaultType: "series",
    })
  })
})

const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const titleEdge = (objectType: string, tmdbId: string, imdbId: string | null, show?: { tmdbId: string; imdbId: string | null }) => ({
  node: {
    objectType,
    content: { title: `T${tmdbId}`, originalReleaseYear: 2020, externalIds: { tmdbId, imdbId } },
    ...(show ? { show: { content: { title: `S${show.tmdbId}`, externalIds: show } } } : {}),
  },
})

describe("fetchJWDynamicList", () => {
  beforeEach(() => {
    __resetJWRankingsCache()
    vi.restoreAllMocks()
  })
  afterEach(() => vi.restoreAllMocks())

  it("new/movie: sends the NEW page type and returns tmdb+imdb ids, deduped", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        newTitles: {
          edges: [titleEdge("MOVIE", "10", "tt0000010"), titleEdge("MOVIE", "10", "tt0000010"), titleEdge("MOVIE", "11", null)],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    )
    const r = await fetchJWDynamicList({ kind: "new", type: "movie", country: "IT" })
    expect(r.status).toBe("ok")
    expect(r.items.map((i) => i.tmdb)).toEqual([10, 11])
    expect(r.items[0]).toMatchObject({ imdb: "tt0000010", mediatype: "movie", title: "T10" })
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(body.variables).toMatchObject({ country: "IT", pageType: "NEW", filter: { objectTypes: ["MOVIE"] } })
  })

  it("series: resolves season nodes to the parent show (never a '<id>:<season>' id)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        newTitles: {
          edges: [
            titleEdge("SHOW_SEASON", "84773:3", null, { tmdbId: "84773", imdbId: "tt7631058" }),
            titleEdge("SHOW_SEASON", "84773:2", null, { tmdbId: "84773", imdbId: "tt7631058" }),
            titleEdge("SHOW_SEASON", "99:1", null, { tmdbId: "99", imdbId: null }),
          ],
          pageInfo: { hasNextPage: false },
        },
      }),
    )
    const r = await fetchJWDynamicList({ kind: "upcoming", type: "series", country: "IT" })
    expect(r.items.map((i) => i.tmdb)).toEqual([84773, 99])
    expect(r.items.every((i) => i.mediatype === "tv")).toBe(true)
  })

  it("leaving: drops wrong-type rows (the API ignores the objectTypes filter) and follows pagination", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          newTitles: {
            edges: [titleEdge("MOVIE", "1", "tt1")],
            pageInfo: { hasNextPage: true, endCursor: "c1" },
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          newTitles: {
            edges: [titleEdge("SHOW_SEASON", "5:1", null, { tmdbId: "5", imdbId: "tt5" })],
            pageInfo: { hasNextPage: false },
          },
        }),
      )
    const r = await fetchJWDynamicList({ kind: "leaving", type: "series", country: "US" })
    expect(r.items.map((i) => i.tmdb)).toEqual([5])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((spy.mock.calls[1][1] as RequestInit).body)).variables).toMatchObject({ after: "c1", pageType: "LEAVING_SOON" })
  })

  it("rising: only UP rows, biggest jump first", async () => {
    const edge = (tmdbId: number, info: Record<string, unknown>) => ({
      streamingChartInfo: info,
      node: { content: { title: `T${tmdbId}`, originalReleaseDate: "2020-01-01", externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        streamingCharts: {
          edges: [
            edge(1, { rank: 1, trend: "DOWN", trendDifference: 3 }),
            edge(2, { rank: 2, trend: "UP", trendDifference: 4 }),
            edge(3, { rank: 3, trend: "UP", trendDifference: 9 }),
            edge(4, { rank: 4, trend: "STABLE", trendDifference: 0 }),
          ],
        },
      }),
    )
    const r = await fetchJWDynamicList({ kind: "rising", type: "movie", country: "IT" })
    expect(r.items.map((i) => i.tmdb)).toEqual([3, 2])
  })

  it("genre: queries the popular titles of that genre only", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ popularTitles: { edges: [{ node: { content: { title: "H", externalIds: { tmdbId: 7, imdbId: "tt7" } } } }] } }),
    )
    const r = await fetchJWDynamicList({ kind: "genre", type: "movie", country: "IT", genre: "hrr" })
    expect(r.items.map((i) => i.tmdb)).toEqual([7])
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(JSON.stringify(body.variables)).toContain("hrr")
  })

  it("reports unavailable (never a fake empty) when JustWatch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 500 }))
    const r = await fetchJWDynamicList({ kind: "new", type: "movie", country: "IT" })
    expect(r).toEqual({ items: [], status: "unavailable" })
  })
})

describe("custom catalog dispatcher with a justwatch: URL", () => {
  beforeEach(() => {
    __resetJWRankingsCache()
    vi.restoreAllMocks()
  })

  it("routes to the JustWatch fetcher and returns normalized items", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ newTitles: { edges: [titleEdge("MOVIE", "321", "tt0000321")], pageInfo: { hasNextPage: false } } }),
    )
    const r = await fetchUnifiedCatalogResult("justwatch:new?type=movie&country=FR")
    expect(r.status).toBe("ok")
    expect(r.items[0]).toMatchObject({ tmdb: 321, imdb: "tt0000321" })
  })

  it("rejects a malformed justwatch: URL as unsupported without any network call", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
    const r = await fetchUnifiedCatalogResult("justwatch:nope?type=movie&country=IT")
    expect(spy).not.toHaveBeenCalled()
    expect(r.items).toEqual([])
  })
})
