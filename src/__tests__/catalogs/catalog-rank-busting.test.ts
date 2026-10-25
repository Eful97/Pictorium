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

  it("emits no automatic rk override in poster URLs for pictorium-jw Top 20 catalogs", async () => {
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

    // Top-20-only contract: badges resolve live at render, so catalog
    // poster URLs carry no automatic rk= (manual rank=/diagnostic rk=
    // transports are unchanged, see list-rank-override).
    const poster0 = new URL(json.metas[0].poster)
    expect(poster0.searchParams.has("rk")).toBe(false)

    const poster1 = new URL(json.metas[1].poster)
    expect(poster1.searchParams.has("rk")).toBe(false)
  })
})

describe("JW popular/trending arbitrary-skip canonical windows carry no automatic rk", () => {
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

  it("skip=0 emits no automatic rk on canonical Top-20 rows (badges resolve live)", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("")
    expect(metas).toHaveLength(20)
    expect(rkOf(metas, 101)).toBeNull()
    expect(rkOf(metas, 110)).toBeNull()
    expect(rkOf(metas, 120)).toBeNull()
  })

  it("skip=5 emits no automatic rk on overlapping or tail rows", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?skip=5")
    expect(metas).toHaveLength(20)
    // No rk= anywhere: same title, same poster URL on every page; the
    // badge resolves live at render from the authorized Top-20 sources.
    expect(rkOf(metas, 106)).toBeNull()
    expect(rkOf(metas, 120)).toBeNull()
    expect(rkOf(metas, 121)).toBeNull()
    expect(rkOf(metas, 125)).toBeNull()
  })

  it("skip=19 emits no automatic rk on the last ranked title or past it", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?skip=19")
    expect(metas).toHaveLength(11)
    expect(rkOf(metas, 120)).toBeNull()
    expect(rkOf(metas, 121)).toBeNull()
    expect(rkOf(metas, 130)).toBeNull()
  })

  it("skip=20 emits no automatic rk on any row", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?skip=20")
    expect(metas).toHaveLength(10)
    for (const m of metas) {
      expect(new URL(m.poster).searchParams.has("rk")).toBe(false)
    }
  })

  it("same title gets the same poster URL on every page (skip 0 vs skip 5)", async () => {
    mockPopularUniverse()
    const page0 = await fetchPopularCatalog("")
    const page5 = await fetchPopularCatalog("?skip=5")
    const url0 = page0.find((m) => m.poster.includes("/106?") || m.poster.includes("/106&"))?.poster
    const url5 = page5.find((m) => m.poster.includes("/106?") || m.poster.includes("/106&"))?.poster
    // Without automatic rk=, pagination cannot fork poster identity: the
    // same title gets the same URL on every page.
    expect(url0).toBeDefined()
    expect(url5).toBeDefined()
    expect(url0).toBe(url5)
  })

  it("genre drill-down emits no automatic rk (live resolution owns the badge)", async () => {
    mockPopularUniverse()
    const metas = await fetchPopularCatalog("?genre=Azione")
    expect(metas).toHaveLength(2)
    // No rk= on either the globally ranked title or the off-chart title.
    expect(rkOf(metas, 103)).toBeNull()
    expect(rkOf(metas, OFF_UNIVERSE_ID)).toBeNull()
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
