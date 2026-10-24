import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { pictoriumCatalog } from "@/lib/catalog-handler"
import { encodeConfig } from "@/lib/config-token"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import * as mdbModule from "@/lib/mdblist"
import * as jwModule from "@/lib/justwatch"
import * as fpModule from "@/lib/flixpatrol"
import {
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
  __inMemoryChartGenerationPersist,
} from "@/lib/chart-generation"

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

const cacheStore = new Map<string, unknown>()
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn((k: string) => (cacheStore.get(k) as never) ?? null),
  cacheSet: vi.fn((k: string, v: unknown) => {
    cacheStore.set(k, v)
  }),
  cacheGetShared: vi.fn(async (k: string) => (cacheStore.get(k) as never) ?? null),
  cacheClear: vi.fn(() => {
    cacheStore.clear()
  }),
  hashUserFragment: vi.fn((u: string) => u.slice(0, 8)),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(async () => null),
  getAll: vi.fn(async () => []),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

interface Counters {
  provider: number
  find: number
  detailsPlain: number
  detailsAppend: number
  external: number
  images: number
}

interface RouterOpts {
  counters: Counters
  /** tmdbId -> imdb served inside the DETAILS payload (append simulation) */
  appendMap?: Record<number, string | null>
  /** tmdbId -> imdb served by the standalone /external_ids endpoint */
  externalMap?: Record<number, string | null>
  /** tmdbIds whose details fetch throws (fail-open path) */
  failDetails?: number[]
}

function installRouter(opts: RouterOpts): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
    const u = String(url)
    if (u.includes("/lists/custom/")) {
      opts.counters.provider++
      return Response.json({ items: (installRouter as unknown as { items?: unknown[] }).items ?? [] })
    }
    if (u.includes("/external_ids")) {
      opts.counters.external++
      const m = u.match(/\/(?:movie|tv)\/(\d+)/)
      const id = Number(m?.[1] ?? 0)
      return Response.json({ id, imdb_id: opts.externalMap?.[id] ?? null })
    }
    if (u.includes("/images")) {
      opts.counters.images++
      const m = u.match(/\/(?:movie|tv)\/(\d+)/)
      return Response.json({ id: Number(m?.[1] ?? 0), backdrops: [], posters: [], logos: [] })
    }
    if (u.includes("/find/")) {
      opts.counters.find++
      return Response.json({ movie_results: [], tv_results: [] })
    }
    if (u.includes("/genre/")) {
      return Response.json({ genres: [] })
    }
    if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
      const m = u.match(/\/(?:movie|tv)\/(\d+)/)
      const id = Number(m?.[1] ?? 0)
      if (opts.failDetails?.includes(id)) throw new Error("details down")
      if (u.includes("append_to_response")) opts.counters.detailsAppend++
      else opts.counters.detailsPlain++
      return Response.json({
        id,
        title: `Title ${id}`,
        name: `Title ${id}`,
        genres: [],
        vote_average: 7.5,
        vote_count: 100,
        release_date: "2024-03-01",
        backdrop_path: null,
        overview: `Overview ${id}`,
        external_ids: { imdb_id: opts.appendMap?.[id] ?? null },
      })
    }
    return Response.json({}, { status: 404 })
  })
}

function setProviderItems(items: Array<{ tmdb?: number; imdb?: string; title: string; year?: number; mediatype?: string }>): void {
  ;(installRouter as unknown as { items?: unknown[] }).items = items
}

function freshCounters(): Counters {
  return { provider: 0, find: 0, detailsPlain: 0, detailsAppend: 0, external: 0, images: 0 }
}

function customToken(cid: string, url: string, type: "movie" | "series" | "mixed" = "movie"): string {
  return encodeConfig({
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "pill",
    rankingBadgeStyle: "pill",
    blurEnabled: true,
    blurIntensity: 12,
    blurFade: 45,
    blurDarkness: 55,
    gradientHeight: 50,
    networkLogo: true,
    autoRotateClean: false,
    customCatalogs: [{ id: cid, name: `C1 ${cid}`, type, url, enabled: true }],
  })
}

async function getCustom(cid: string, token: string, stType: "movie" | "series", extra = "") {
  const req = new NextRequest(
    `https://example.com/catalog/${stType}/pictorium-custom-${stType}-${cid}.json?api_key=test-key${extra}`,
  )
  const res = await pictoriumCatalog(req, stType, `pictorium-custom-${stType}-${cid}`, null, token)
  expect(res.status).toBe(200)
  return (await res.json()) as { metas: Array<{ id: string; name: string }> }
}

beforeEach(() => {
  vi.restoreAllMocks()
  cacheStore.clear()
  __clearTMDBCache()
  __clearImdbCache()
  __resetChartGenerationForTest()
  __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
  vi.stubEnv("MDBLIST_API_URL", "https://mdblist-mock.test")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("catalog details+external_ids aggregation (C1, actual handler)", () => {
  it("custom movie: valid source IMDb keeps precedence; valid append eliminates standalone lookups", async () => {
    const counters = freshCounters()
    // A/B carry a valid source IMDb (control: plain details, never append).
    // C/D carry no source IMDb but the appended payload is valid.
    setProviderItems([
      { tmdb: 101, imdb: "tt1000101", title: "Src A", year: 2024 },
      { tmdb: 102, imdb: "tt1000102", title: "Src B", year: 2024 },
      { tmdb: 103, title: "Appended C", year: 2023 },
      { tmdb: 104, title: "Appended D", year: 2023 },
    ])
    installRouter({
      counters,
      appendMap: { 103: "tt1000103", 104: "tt1000104" },
      externalMap: { 103: "tt1000103", 104: "tt1000104" },
    })
    const body = await getCustom(
      "c1save",
      customToken("c1save", "https://mdblist.com/lists/u/c1save"),
      "movie",
    )
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000101", "tt1000102", "tt1000103", "tt1000104"])
    expect(body.metas.map((m) => m.name)).toEqual(["Title 101", "Title 102", "Title 103", "Title 104"])
    // 2 plain details (source-present rows avoid the append payload) +
    // 2 appended details (source-missing rows), zero standalone external_ids.
    expect(counters.detailsPlain).toBe(2)
    expect(counters.detailsAppend).toBe(2)
    expect(counters.external).toBe(0)
  })

  it("custom movie: absent/invalid append falls back to standalone resolveImdbId (cached ids still resolve)", async () => {
    const counters = freshCounters()
    setProviderItems([
      { tmdb: 111, title: "NoAppend", year: 2023 },
      { tmdb: 112, title: "BadAppend", year: 2023 },
      { tmdb: 113, title: "NoAppendNoExternal", year: 2023 },
    ])
    installRouter({
      counters,
      appendMap: { 111: null, 112: "not-an-id", 113: null },
      externalMap: { 111: "tt1000111", 112: "tt1000112", 113: null },
    })
    const body = await getCustom(
      "c1fb",
      customToken("c1fb", "https://mdblist.com/lists/u/c1fb"),
      "movie",
    )
    // Independently available external_ids still resolve despite missing/bad append.
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000111", "tt1000112", "tmdb:113"])
    expect(counters.detailsAppend).toBe(3)
    expect(counters.detailsPlain).toBe(0)
    expect(counters.external).toBe(3)
  })

  it("custom movie: failed details keep the row via title/year fallback + standalone imdb", async () => {
    const counters = freshCounters()
    setProviderItems([
      { tmdb: 121, title: "DetailsDown", year: 2022 },
      { tmdb: 122, title: "DetailsOk", year: 2022 },
    ])
    installRouter({
      counters,
      appendMap: { 122: "tt1000122" },
      externalMap: { 121: "tt1000121", 122: "tt1000122" },
      failDetails: [121],
    })
    const body = await getCustom(
      "c1fail",
      customToken("c1fail", "https://mdblist.com/lists/u/c1fail"),
      "movie",
    )
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000121", "tt1000122"])
    // Failed-details row falls back to the provider title.
    expect(body.metas.map((m) => m.name)).toEqual(["DetailsDown", "Title 122"])
  })

  it("custom series: same aggregation semantics on the tv path", async () => {
    const counters = freshCounters()
    setProviderItems([
      { tmdb: 131, imdb: "tt1000131", title: "Src Series", year: 2024 },
      { tmdb: 132, title: "Appended Series", year: 2024 },
    ])
    installRouter({
      counters,
      appendMap: { 132: "tt1000132" },
      externalMap: { 132: "tt1000132" },
    })
    const body = await getCustom(
      "c1series",
      customToken("c1series", "https://mdblist.com/lists/u/c1series", "series"),
      "series",
    )
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000131", "tt1000132"])
    expect(counters.detailsPlain).toBe(1)
    expect(counters.detailsAppend).toBe(1)
    expect(counters.external).toBe(0)
  })

  it("custom keyless: notice only, zero TMDB fetches (unchanged)", async () => {
    const counters = freshCounters()
    setProviderItems([{ tmdb: 141, imdb: "tt1000141", title: "Keyless", year: 2024 }])
    installRouter({ counters })
    const req = new NextRequest(
      `https://example.com/catalog/movie/pictorium-custom-movie-c1keyless.json?config=${customToken("c1keyless", "https://mdblist.com/lists/u/c1keyless")}`,
    )
    const res = await pictoriumCatalog(req, "movie", "pictorium-custom-movie-c1keyless", null, null)
    expect(res.status).toBe(200)
    expect(counters.detailsPlain + counters.detailsAppend + counters.external + counters.find).toBe(0)
  })

  it("anime movies: valid source keeps precedence, valid append eliminates standalone lookups", async () => {
    const counters = freshCounters()
    vi.spyOn(mdbModule, "fetchMDBList").mockResolvedValue([
      { imdb: "tt1000201", title: "Anime Src", year: 2024, tmdb: 201 },
      { imdb: "", title: "Anime Appended", year: 2024, tmdb: 202 },
    ])
    installRouter({
      counters,
      appendMap: { 202: "tt1000202" },
      externalMap: { 202: "tt1000202" },
    })
    const req = new NextRequest("https://example.com/catalog/movie/pictorium-anime-movies.json?api_key=test-key")
    const res = await pictoriumCatalog(req, "movie", "pictorium-anime-movies", null, null)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { metas: Array<{ id: string; name: string }> }
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000201", "tt1000202"])
    expect(counters.detailsPlain).toBe(1)
    expect(counters.detailsAppend).toBe(1)
    expect(counters.external).toBe(0)
  })

  it("anime series: invalid append falls back to standalone external_ids", async () => {
    const counters = freshCounters()
    vi.spyOn(mdbModule, "fetchMDBList").mockResolvedValue([
      { imdb: "", title: "Anime Bad Append", year: 2024, tmdb: 211 },
    ])
    installRouter({
      counters,
      appendMap: { 211: "junk" },
      externalMap: { 211: "tt1000211" },
    })
    const req = new NextRequest("https://example.com/catalog/series/pictorium-anime.json?api_key=test-key")
    const res = await pictoriumCatalog(req, "series", "pictorium-anime", null, null)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { metas: Array<{ id: string }> }
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000211"])
    expect(counters.detailsAppend).toBe(1)
    expect(counters.external).toBe(1)
  })

  it("flixpatrol fallback preserves original concurrent details+external_ids behavior (FP optimization deliberately deferred)", async () => {
    // Correction C1: the FlixPatrol aggregation was restored byte-identical
    // to the pre-task concurrent Promise.all (details + external_ids race
    // with independent caps). Rationale for deferring the optimization on
    // this branch only: making the standalone imdb lookup sequential after
    // details settle would roughly double failure-path latency, and starting
    // poster/logo promises before attaching aggregate rejection handlers
    // opened an unhandled-rejection window. Custom/anime rows were already
    // sequential, so only FP is deferred.
    vi.spyOn(jwModule, "getJWRankings").mockResolvedValue([])
    vi.spyOn(jwModule, "getJWTitles").mockResolvedValue([])
    // skip=1 keeps pinnedPlatform null so the request genuinely exercises the
    // catalog-handler FlixPatrol fallback branch (the skip=0 window would be
    // served from the published platform snapshot instead).
    vi.spyOn(fpModule, "getTop10").mockResolvedValue({
      movies: [
        { tmdbId: 400, title: "FP Skipped", releaseDate: "2024-01-01" },
        { tmdbId: 401, title: "FP Gated", releaseDate: "2024-01-01" },
      ],
      tv: [],
    } as unknown as fpModule.FlixPatrolTop10)
    let releaseDetails!: () => void
    const detailsGate = new Promise<void>((resolve) => {
      releaseDetails = resolve
    })
    const seenUrls: string[] = []
    let detailsPlain = 0
    let detailsAppend = 0
    let external = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const u = String(url)
      seenUrls.push(u)
      if (u.includes("/external_ids")) {
        external++
        return Response.json({ id: 401, imdb_id: "tt1000401" })
      }
      if (u.includes("/images")) {
        const m = u.match(/\/(?:movie|tv)\/(\d+)/)
        return Response.json({ id: Number(m?.[1] ?? 0), backdrops: [], posters: [], logos: [] })
      }
      if (/\/movie\/401(?!\d)/.test(u)) {
        if (u.includes("append_to_response")) detailsAppend++
        else detailsPlain++
        await detailsGate
        return Response.json({
          id: 401,
          title: "Title 401",
          name: "Title 401",
          genres: [],
          vote_average: 7.5,
          vote_count: 100,
          release_date: "2024-03-01",
          backdrop_path: null,
          overview: "Overview 401",
        })
      }
      if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
        const m = u.match(/\/(?:movie|tv)\/(\d+)/)
        const id = Number(m?.[1] ?? 0)
        return Response.json({
          id,
          title: `Title ${id}`,
          name: `Title ${id}`,
          genres: [],
          vote_average: 7.5,
          vote_count: 100,
          release_date: "2024-03-01",
          backdrop_path: null,
          overview: `Overview ${id}`,
        })
      }
      return Response.json({}, { status: 404 })
    })
    const req = new NextRequest(
      "https://example.com/catalog/movie/pictorium-netflix-movies.json?api_key=test-key&skip=1",
    )
    const pending = pictoriumCatalog(req, "movie", "pictorium-netflix-movies", null, null)
    // The standalone external_ids lookup must fire while details are still
    // gated — sequential-after-settle code could never satisfy this.
    const deadline = Date.now() + 1500
    while (!seenUrls.some((u) => u.includes("/external_ids"))) {
      if (Date.now() > deadline) {
        throw new Error("external_ids was not requested while details were pending (concurrency regressed)")
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    releaseDetails()
    const res = await pending
    expect(res.status).toBe(200)
    const body = (await res.json()) as { metas: Array<{ id: string; name: string }> }
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000401"])
    expect(body.metas.map((m) => m.name)).toEqual(["Title 401"])
    // Restored semantics: plain details (no append payload) + standalone lookup.
    expect(detailsAppend).toBe(0)
    expect(detailsPlain).toBe(1)
    expect(external).toBe(1)
  })

  it("flixpatrol series fallback: failed details keep the row via standalone imdb (restored concurrent semantics)", async () => {
    const counters = freshCounters()
    vi.spyOn(jwModule, "getJWRankings").mockResolvedValue([])
    vi.spyOn(jwModule, "getJWTitles").mockResolvedValue([])
    // skip=1: same pinned-snapshot bypass as above — the genuine fallback branch.
    // No appendMap: the restored branch uses plain getDetails (no
    // append_to_response payload), so every row resolves IMDb standalone.
    vi.spyOn(fpModule, "getTop10").mockResolvedValue({
      movies: [],
      tv: [
        { tmdbId: 310, title: "FP Skipped", releaseDate: "2023-05-05" },
        { tmdbId: 311, title: "FP Down", releaseDate: "2023-05-05" },
        { tmdbId: 312, title: "FP Plain", releaseDate: "2023-05-05" },
      ],
    } as unknown as fpModule.FlixPatrolTop10)
    installRouter({
      counters,
      externalMap: { 311: "tt1000311", 312: "tt1000312" },
      failDetails: [311],
    })
    const req = new NextRequest(
      "https://example.com/catalog/series/pictorium-netflix-series.json?api_key=test-key&skip=1",
    )
    const res = await pictoriumCatalog(req, "series", "pictorium-netflix-series", null, null)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { metas: Array<{ id: string; name: string }> }
    expect(body.metas.map((m) => m.id)).toEqual(["tt1000311", "tt1000312"])
    // Failed-details row keeps the provider title (fail-open, unchanged).
    expect(body.metas.map((m) => m.name)).toEqual(["FP Down", "Title 312"])
    expect(counters.detailsAppend).toBe(0)
    expect(counters.external).toBe(2)
  })

  it("identical custom fixture yields identical full metadata bodies across refetches (shape, not just ids/names)", async () => {
    // The per-test assertions above compare ids/names only; on their own
    // they cannot support a byte-identical-metadata claim. This test pins
    // the entire response body: same fixture refetched with cleared caches
    // must be deeply equal (every meta field, not just id/name).
    const items = [
      { tmdb: 151, imdb: "tt1000151", title: "Shape A", year: 2024 },
      { tmdb: 152, title: "Shape B", year: 2023 },
    ]
    const token = customToken("c1shape", "https://mdblist.com/lists/u/c1shape")
    setProviderItems(items)
    installRouter({
      counters: freshCounters(),
      appendMap: { 152: "tt1000152" },
      externalMap: { 152: "tt1000152" },
    })
    const first = await getCustom("c1shape", token, "movie")
    cacheStore.clear()
    __clearTMDBCache()
    __clearImdbCache()
    const second = await getCustom("c1shape", token, "movie")
    expect(second).toEqual(first)
    expect(first.metas).toMatchObject([
      {
        id: "tt1000151",
        type: "movie",
        name: "Title 151",
        releaseInfo: "2024",
        imdbRating: "7.5",
        genres: [],
        description: "Overview 151",
      },
      {
        id: "tt1000152",
        type: "movie",
        name: "Title 152",
        releaseInfo: "2024",
        imdbRating: "7.5",
        genres: [],
        description: "Overview 152",
      },
    ])
  })
})
