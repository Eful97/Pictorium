import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { pictoriumCatalog } from "@/lib/catalog-handler"
import * as top20Module from "@/lib/top20-ranking"
import * as tmdbModule from "@/lib/tmdb"
import * as jwModule from "@/lib/justwatch"
import * as sdModule from "@/lib/server-defaults"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"

vi.mock("@/lib/user-auth", () => ({
  getScopedUserId: vi.fn().mockReturnValue(null),
  userExists: vi.fn().mockResolvedValue(false),
  userRateLimitKey: vi.fn().mockReturnValue("rl-test"),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
  rateLimitKey: vi.fn().mockReturnValue("rate-key"),
  rateLimitResponse: vi.fn(),
}))

vi.mock("@/lib/cache", () => {
  const store = new Map<string, unknown>()
  return {
    cacheGet: vi.fn((k: string) => store.get(k) ?? null),
    cacheSet: vi.fn((k: string, v: unknown) => { store.set(k, v) }),
    cacheGetShared: vi.fn((k: string) => store.get(k) ?? null),
    hashUserFragment: vi.fn((u: string) => u.slice(0, 8)),
  }
})

describe("catalog rank cache-busting integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Fixed chart cycles: reset snapshot state between tests so publishes
    // never accumulate into a mid-file snapshot (which would serve snapshots
    // instead of the live rows these tests assert; the lifecycle is covered
    // by dedicated chart-generation tests).
    __resetChartGenerationForTest()
    vi.spyOn(tmdbModule, "resolveUserApiKeys").mockResolvedValue({
      tmdb: { key: "mock-tmdb-key", source: "env" },
      mdblist: { key: undefined, source: "env" },
      tvdb: { key: undefined, source: "env" },
      simkl: { key: undefined, source: "env" },
      fanart: { key: undefined, source: "env" },
    })
    vi.spyOn(tmdbModule, "getDetailsWithExternalIds").mockImplementation(async (_type, id) => ({
      id,
      title: `Movie ${id}`,
      overview: "Desc",
      external_ids: { imdb_id: `tt${id}` },
    } as unknown as tmdbModule.TMDBDetails))
  })

  it("injects rk parameter in poster URLs for pictorium-jw Top 20 catalogs", async () => {
    vi.spyOn(top20Module, "fetchTop20Ranking").mockResolvedValue({
      status: "ok",
      period: "day",
      items: [
        { tmdbId: 101, imdbId: "tt101", rank: 1, title: "Movie 101" },
        { tmdbId: 102, imdbId: "tt102", rank: 2, title: "Movie 102" },
      ],
    })

    const req = new NextRequest("https://example.com/catalog/movie/pictorium-jw-movies.json")
    const res = await pictoriumCatalog(req, "movie", "pictorium-jw-movies", null, null)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.metas).toHaveLength(2)

    const poster0 = new URL(json.metas[0].poster)
    expect(poster0.searchParams.get("rk")).toBe("1")

    const poster1 = new URL(json.metas[1].poster)
    expect(poster1.searchParams.get("rk")).toBe("2")
  })
})

describe("JW popular/trending arbitrary-skip canonical rank mapping", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Same isolation as above: chart contributions must not leak across tests.
    __resetChartGenerationForTest()
    vi.spyOn(tmdbModule, "resolveUserApiKeys").mockResolvedValue({
      tmdb: { key: "mock-tmdb-key", source: "env" },
      mdblist: { key: undefined, source: "env" },
      tvdb: { key: undefined, source: "env" },
      simkl: { key: undefined, source: "env" },
      fanart: { key: undefined, source: "env" },
    })
    vi.spyOn(tmdbModule, "getDetailsWithExternalIds").mockImplementation(async (_type, id) => ({
      id,
      title: `Movie ${id}`,
      overview: "Desc",
      external_ids: { imdb_id: `tt${id}` },
    } as unknown as tmdbModule.TMDBDetails))
    vi.spyOn(sdModule, "getServerDefaultsChecked").mockImplementation(async () => ({
      ...sdModule.getServerDefaults(),
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:popular",
    }))
    vi.spyOn(sdModule, "getServerDefaultsForUser").mockImplementation(async () => ({
      ...sdModule.getServerDefaults(),
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:popular",
    }))
    vi.spyOn(tmdbModule, "getImages").mockResolvedValue({ logos: [] } as unknown as tmdbModule.TMDBImagesResponse)
  })
  // 30-title universe: canonical Top 20 = tmdbId 101..120 (ranks 1..20).
  const UNIVERSE = Array.from({ length: 30 }, (_, i) => ({
    tmdbId: 101 + i,
    imdbId: `tt${101 + i}`,
    title: `Movie ${101 + i}`,
  }))
  const OFF_UNIVERSE_ID = 999

  function mockPopularUniverse() {
    const titlesSpy = vi.spyOn(jwModule, "getJWTitles").mockImplementation(async (opts) => {
      const offset = opts.offset ?? 0
      const first = opts.first ?? 20
      // Genre drill-down: one globally-ranked title + one outside the Top 20.
      // The genre-local position must never pose as the global rank.
      if (opts.genres && opts.genres.length > 0) {
        return [
          { tmdbId: 103, imdbId: "tt103", rank: offset + 1, title: "Movie 103" },
          { tmdbId: OFF_UNIVERSE_ID, imdbId: "tt999", rank: offset + 2, title: "Off-chart" },
        ]
      }
      return UNIVERSE.slice(offset, offset + first).map((t, i) => ({
        tmdbId: t.tmdbId,
        imdbId: t.imdbId,
        rank: offset + i + 1,
        title: t.title,
      }))
    })
    // Logo enrichment is irrelevant here: keep it off-network.
    return titlesSpy
  }

  function rkOf(metas: Array<{ poster: string }>, tmdbId: number): string | null {
    const meta = metas.find((m) => m.poster.includes(`%2F${tmdbId}`) || m.poster.includes(`/${tmdbId}?`) || m.poster.includes(`/${tmdbId}&`))
    if (!meta) throw new Error(`poster for tmdb ${tmdbId} not found`)
    return new URL(meta.poster).searchParams.get("rk")
  }

  async function fetchPopularCatalog(query: string): Promise<Array<{ poster: string }>> {
    const req = new NextRequest(`https://example.com/catalog/movie/pictorium-jw-movies.json${query}`)
    const res = await pictoriumCatalog(req, "movie", "pictorium-jw-movies", null, null)
    expect(res.status).toBe(200)
    const json = await res.json()
    return json.metas as Array<{ poster: string }>
  }

  it("skip=0 emits canonical ranks 1..20", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("")
    expect(metas).toHaveLength(20)
    expect(rkOf(metas, 101)).toBe("1")
    expect(rkOf(metas, 110)).toBe("10")
    expect(rkOf(metas, 120)).toBe("20")
  })

  it("skip=5 maps overlapping titles to canonical ranks and the tail to rk=0", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?skip=5")
    expect(metas).toHaveLength(20)
    // Overlapping window: global ranks, not offset+idx.
    expect(rkOf(metas, 106)).toBe("6")
    expect(rkOf(metas, 120)).toBe("20")
    // Past the canonical Top 20: explicit unranked.
    expect(rkOf(metas, 121)).toBe("0")
    expect(rkOf(metas, 125)).toBe("0")
  })

  it("skip=19 gives rk=20 to the last ranked title and rk=0 past it", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?skip=19")
    expect(metas).toHaveLength(11)
    expect(rkOf(metas, 120)).toBe("20")
    expect(rkOf(metas, 121)).toBe("0")
    expect(rkOf(metas, 130)).toBe("0")
  })

  it("skip=20 marks every title explicitly unranked (rk=0)", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?skip=20")
    expect(metas).toHaveLength(10)
    for (const m of metas) {
      expect(new URL(m.poster).searchParams.get("rk")).toBe("0")
    }
  })

  it("same ranked title gets the same rk on every page (skip 0 vs skip 5)", async () => {
    mockPopularUniverse()
    const page0 = await fetchPopularCatalog("")
    const page5 = await fetchPopularCatalog("?skip=5")
    expect(rkOf(page0, 106)).toBe("6")
    expect(rkOf(page5, 106)).toBe("6")
  })

  it("genre drill-down uses the global snapshot, never the genre-local position", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?genre=Azione")
    expect(metas).toHaveLength(2)
    // Globally #3 keeps its global rank even though it leads the genre window.
    expect(rkOf(metas, 103)).toBe("3")
    // Off-chart title is explicit unranked, not genre-local #2.
    expect(rkOf(metas, OFF_UNIVERSE_ID)).toBe("0")
  })

  it("uses one shared snapshot per request, never per-title upstream", async () => {
    const titlesSpy = mockPopularUniverse()
    // Fresh skip (uncached in this file) so the request really executes.
    await fetchPopularCatalog("?skip=7")
    // Page window (offset 7) + ONE canonical snapshot (offset 0, shared with
    // the renderer). No per-title rank fetch exists on this path. (The
    // per-family refresh IS the canonical fetch here, so serving assertions
    // stay exact.)
    expect(titlesSpy).toHaveBeenCalledTimes(2)
    const offsets = titlesSpy.mock.calls.map((c) => (c[0] as { offset?: number }).offset ?? 0).sort((a, b) => a - b)
    expect(offsets).toEqual([0, 7])
  })
})
