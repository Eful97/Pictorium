// Step 2 — MDBList zero-fetch gaps: `score_average` alias, lenient payload
// shapes and `whatson_features` parsing.
//
// Contract (observed MDBList/WhatsOn payload + Jellyfin MDBList plugin model):
//   root: { score?: 0-100, score_average?: 0-100, ratings: [...],
//           whatson_features?: {
//             imdb_top_ranking: number|string|null,
//             metacritic_must_see: boolean|null,
//             rotten_tomatoes_critics_certified: boolean|null,
//             rotten_tomatoes_users_certified: boolean|null } }
// Both root scores share the SAME strict 0-100 contract (never a second
// scale). Lenient shapes ("N/A", "123.0", numeric strings, null) must neither
// crash nor reinterpret a native value as another scale.
//
// Env: no real network/credentials; `fetch` is stubbed per test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cacheClear } from "@/lib/cache"
import {
  fetchAggregatedRating,
  parseMdbWhatsOnFeatures,
  __resetMdblistBreaker,
  __resetRatingsNullForTest,
} from "@/lib/ratings"
import { __resetMdbQuotaForTests } from "@/lib/mdblist-quota"

async function resetMdbRaw(): Promise<void> {
  const mod = (await import("@/lib/ratings")) as unknown as Record<string, unknown>
  const fn = mod.__resetMdbRawForTest
  if (typeof fn === "function") (fn as () => void)()
}

function jsonOk(body: unknown): unknown {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body }
}

/** Minimal valid media payload: one numeric IMDb source, no root score. */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "movie",
    title: "Sample",
    year: 2024,
    released: "2024-01-01",
    ratings: [{ source: "imdb", value: 8.0, score: 80, votes: 1000 }],
    ...over,
  }
}

beforeEach(async () => {
  delete process.env.MDBLIST_API_URL
  vi.unstubAllEnvs()
  cacheClear()
  __resetMdblistBreaker()
  __resetRatingsNullForTest()
  __resetMdbQuotaForTests()
  await resetMdbRaw()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete process.env.MDBLIST_API_URL
  cacheClear()
  __resetMdblistBreaker()
  __resetRatingsNullForTest()
  __resetMdbQuotaForTests()
  await resetMdbRaw()
  vi.restoreAllMocks()
})

describe("score_average alias (same strict 0-100 contract)", () => {
  it("keeps the mdblist source when the API returns score_average without score", async () => {
    const fetchMock = vi.fn(async () => jsonOk(payload({ score_average: 89 })))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_sa1", "k", undefined, { mediaType: "movie" })
    expect(r?.sources.mdblist).toBe(8.9)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("accepts numeric-string score_average and divides 0-100 unconditionally", async () => {
    const fetchMock = vi.fn(async () => jsonOk(payload({ score_average: "89.0" })))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_sa2", "k", undefined, { mediaType: "movie" })
    expect(r?.sources.mdblist).toBe(8.9)
  })

  it("score wins over score_average when both are valid", async () => {
    const fetchMock = vi.fn(async () => jsonOk(payload({ score: 76, score_average: 90 })))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_sa3", "k", undefined, { mediaType: "movie" })
    expect(r?.sources.mdblist).toBe(7.6)
  })

  it("falls back to score_average when score is present but malformed", async () => {
    const fetchMock = vi.fn(async () => jsonOk(payload({ score: "N/A", score_average: "88.0" })))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_sa4", "k", undefined, { mediaType: "movie" })
    expect(r?.sources.mdblist).toBe(8.8)
  })

  it("out-of-range/invalid on both fields yields no mdblist source (never normalized)", async () => {
    const fetchMock = vi.fn(async () => jsonOk(payload({ score: 150, score_average: -3 })))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_sa5", "k", undefined, { mediaType: "movie" })
    expect(r?.sources.mdblist).toBeUndefined()
    // The other valid source is still served.
    expect(r?.sources.imdb).toBe(8.0)
  })
})

describe("lenient payload shapes (no crash, no scale reinterpretation)", () => {
  it("numeric-string scores, N/A and null are handled without reinterpretation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonOk(payload({
        ratings: [
          { source: "imdb", value: "8.4", score: "84.0", votes: "1200" },
          { source: "tomatoes", value: 88, score: "N/A", votes: 100 },
          { source: "trakt", value: 90, score: null, votes: 50 },
          { source: "letterboxd", value: 4.5, score: null, votes: 900 },
          { source: "rogerebert", value: "3.5", score: null, votes: null },
        ],
      })),
    )
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_lenient1", "k", undefined, { mediaType: "movie" })
    expect(r?.sources.imdb).toBe(8.4)
    // Missing/malformed score is unavailable for these providers: the native
    // value is never reinterpreted as x/10 (historical heuristic is gone).
    expect(r?.sources.tomatoes).toBeUndefined()
    expect(r?.sources.trakt).toBeUndefined()
    expect(r?.sources.letterboxd).toBeUndefined()
    // Documented/observed RogerEbert 0-4 native scale is the only exception.
    expect(r?.sources.rogerebert).toBe(8.8)
  })

  it("per-item score_average aliases score with the same 0-100 contract", async () => {
    const fetchMock = vi.fn(async () =>
      jsonOk(payload({
        ratings: [{ source: "trakt", value: 9.0, score_average: "90.0", votes: 10 }],
      })),
    )
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_lenient2", "k", undefined, { mediaType: "movie" })
    expect(r?.sources.trakt).toBe(9.0)
  })

  it("does not crash on non-object bodies and missing ratings", async () => {
    const fetchMock = vi.fn(async () => jsonOk("N/A"))
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchAggregatedRating("tt_lenient3", "k", undefined, { mediaType: "movie" })).toBeNull()
    fetchMock.mockResolvedValueOnce(jsonOk({ score: "N/A", ratings: "N/A", whatson_features: [] }))
    expect(await fetchAggregatedRating("tt_lenient4", "k", undefined, { mediaType: "movie" })).toBeNull()
  })
})

describe("whatson_features parsing", () => {
  it("parses every feature and keeps them on the fetched result (zero extra fetch)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonOk(payload({
        whatson_features: {
          imdb_top_ranking: "123.0",
          metacritic_must_see: true,
          rotten_tomatoes_critics_certified: true,
          rotten_tomatoes_users_certified: true,
        },
      })),
    )
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_wf1", "k", undefined, { mediaType: "movie" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r?.whatsonFeatures).toEqual({
      imdbTopRanking: 123,
      metacriticMustSee: true,
      rottenTomatoesCriticsCertified: true,
      rottenTomatoesUsersCertified: true,
    })
  })

  it("features travel with the aggregate cache hit (still one fetch)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonOk(payload({ whatson_features: { metacritic_must_see: true } })),
    )
    vi.stubGlobal("fetch", fetchMock)
    const first = await fetchAggregatedRating("tt_wf2", "k", undefined, { mediaType: "movie" })
    const second = await fetchAggregatedRating("tt_wf2", "k", undefined, { mediaType: "movie" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first?.whatsonFeatures?.metacriticMustSee).toBe(true)
    expect(second?.whatsonFeatures?.metacriticMustSee).toBe(true)
  })

  it("features survive a raw-cache hit (different selection, still one fetch)", async () => {
    // The raw layer is shared across rating selections; the derived aggregate
    // cache is not. A second selection therefore exercises the raw hit.
    const fetchMock = vi.fn(async () =>
      jsonOk(payload({
        whatson_features: {
          imdb_top_ranking: 12,
          metacritic_must_see: true,
        },
      })),
    )
    vi.stubGlobal("fetch", fetchMock)
    const first = await fetchAggregatedRating("tt_wf_raw", "k", undefined, {
      mediaType: "movie",
      requestedSources: ["metacritic"],
    })
    const second = await fetchAggregatedRating("tt_wf_raw", "k", undefined, {
      mediaType: "movie",
      requestedSources: ["trakt"],
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first?.whatsonFeatures).toEqual({ imdbTopRanking: 12, metacriticMustSee: true, rottenTomatoesCriticsCertified: false, rottenTomatoesUsersCertified: false })
    expect(second?.whatsonFeatures).toEqual(first?.whatsonFeatures)
  })

  it("N/A / null / non-boolean values never invent a certification", async () => {
    const fetchMock = vi.fn(async () =>
      jsonOk(payload({
        whatson_features: {
          imdb_top_ranking: "N/A",
          metacritic_must_see: null,
          rotten_tomatoes_critics_certified: "true",
          rotten_tomatoes_users_certified: 1,
        },
      })),
    )
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt_wf3", "k", undefined, { mediaType: "movie" })
    expect(r?.whatsonFeatures).toBeUndefined()
  })

  it("out-of-window IMDb ranks and malformed objects are dropped, never clamped", () => {
    expect(parseMdbWhatsOnFeatures({ imdb_top_ranking: 0 })).toBeNull()
    expect(parseMdbWhatsOnFeatures({ imdb_top_ranking: 251 })).toBeNull()
    expect(parseMdbWhatsOnFeatures({ imdb_top_ranking: 12.5 })).toBeNull()
    expect(parseMdbWhatsOnFeatures({ imdb_top_ranking: "abc" })).toBeNull()
    expect(parseMdbWhatsOnFeatures({})).toBeNull()
    expect(parseMdbWhatsOnFeatures([])).toBeNull()
    expect(parseMdbWhatsOnFeatures(null)).toBeNull()
    expect(parseMdbWhatsOnFeatures("N/A")).toBeNull()
    expect(parseMdbWhatsOnFeatures({ imdb_top_ranking: 7 })).toEqual({
      imdbTopRanking: 7,
      metacriticMustSee: false,
      rottenTomatoesCriticsCertified: false,
      rottenTomatoesUsersCertified: false,
    })
  })

  it("a response without usable sources never carries a feature payload", async () => {
    const fetchMock = vi.fn(async () =>
      jsonOk({ type: "movie", ratings: [], whatson_features: { metacritic_must_see: true } }),
    )
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchAggregatedRating("tt_wf4", "k", undefined, { mediaType: "movie" })).toBeNull()
  })
})
