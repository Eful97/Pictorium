import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { fetchTop20Ranking } from "@/lib/top20-ranking"
import { cacheClear } from "@/lib/cache"
import { getById } from "@/lib/store"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
  getAll: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:trending",
    })),
    getServerDefaultsChecked: vi.fn(async () => ({
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:trending",
    })),
    getServerDefaultsForUser: vi.fn(async () => ({
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:trending",
    })),
  }
})

const mockedGetById = vi.mocked(getById)

function titlesResponse(items: Array<{ tmdbId?: number | null; title: string; imdbId?: string }>): Response {
  return Response.json({
    data: {
      popularTitles: {
        edges: items.map((item) => ({
          node: {
            content: {
              title: item.title,
              originalReleaseDate: "2026-01-01",
              externalIds: {
                ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
                imdbId: item.imdbId ?? (item.tmdbId ? `tt${item.tmdbId}` : null),
              },
            },
          },
        })),
      },
    },
  })
}

function detailsResponse(tmdbId: number, title: string): Response {
  return Response.json({
    id: tmdbId,
    title,
    name: title,
    poster_path: "/poster.jpg",
    release_date: "2026-01-01",
    first_air_date: "2026-01-01",
    vote_average: 8.0,
    genres: [{ id: 28, name: "Azione" }],
    external_ids: { imdb_id: `tt${tmdbId}` },
  })
}

function catalogReq(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`)
}

describe("Task2 JustWatch page/preview correctness", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
    __resetJWRankingsCache()
    cacheClear()
    __resetChartGenerationForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    __resetJWRankingsCache()
    cacheClear()
    __resetChartGenerationForTest()
  })

  it("RED-check guard: All, Tutti and no genre all query unfiltered with identical bodies", async () => {
    const seenFilters: Array<Record<string, unknown>> = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        const body = JSON.parse(init?.body as string)
        seenFilters.push(body.variables?.filter ?? {})
        return titlesResponse([{ tmdbId: 901, title: "Unfiltered 901" }])
      }
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      return detailsResponse(m ? Number(m[2]) : 901, "Unfiltered 901")
    })

    const paths = [
      "/catalog/movie/pictorium-jw-movies.json?api_key=test-key",
      "/catalog/movie/pictorium-jw-movies.json?api_key=test-key&genre=Tutti",
      "/catalog/movie/pictorium-jw-movies.json?api_key=test-key&genre=All",
    ]
    const bodies: Array<{ metas: Array<{ id: string; poster: string }> }> = []
    for (const p of paths) {
      const res = await GET(catalogReq(p), { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
      expect(res.status).toBe(200)
      bodies.push(await res.json())
      // Same unfiltered cache key by design (no genre fragment): reset all
      // caches so each variant performs its own upstream query and the
      // filter shape below is observed three times, not served from cache
      // or from the pinned snapshot.
      cacheClear()
      __resetJWRankingsCache()
      __resetChartGenerationForTest()
    }
    // All three serve the same unfiltered title.
    for (const b of bodies) {
      expect(b.metas.map((m) => m.id)).toEqual(["tmdb:901"])
    }
    // None of the three JW queries carried a server-side genre code.
    expect(seenFilters).toHaveLength(3)
    for (const f of seenFilters) {
      expect(f).not.toHaveProperty("genres")
    }
    // No page-positional rank leaks into the badge URL on the unfiltered page.
    expect(bodies[0].metas[0].poster).not.toContain("animerank=")
    expect(bodies[0].metas[0].poster).not.toContain("rank=")
  })

  it("first page shares the preview baseTop20 window with duplicate/invalid upstream edges (fetch seam, short page allowed)", async () => {
    // Native first-20 window: duplicates + unresolvable rows. No filler is
    // expected: the page may legitimately be short, but preview and page 0
    // must carry the same ids in the same order.
    const native = [
      { tmdbId: 101, title: "W 101" },
      { tmdbId: 102, title: "W 102" },
      { tmdbId: 102, title: "W 102 dup" },
      { tmdbId: null, title: "W invalid" },
      { tmdbId: 103, title: "W 103" },
      { tmdbId: 104, title: "W 104" },
      { tmdbId: 104, title: "W 104 dup" },
      { tmdbId: 105, title: "W 105" },
    ]
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        const body = JSON.parse(init?.body as string)
        // Both callers share the same native window: first=20, offset=0.
        expect(body.variables.first).toBe(20)
        expect(body.variables.offset).toBe(0)
        return titlesResponse(native)
      }
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      const id = m ? Number(m[2]) : 0
      return detailsResponse(id, `W ${id}`)
    })

    const res = await GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=0"),
      { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) },
    )
    expect(res.status).toBe(200)
    const page0 = await res.json()
    const pageIds = page0.metas.map((m: { id: string }) => m.id)

    // Preview baseTop20 through the REAL shared service + same fetch seam
    // (not a hardcoded rank mock). JW source cache may serve it; the window
    // is still the same native first-20.
    const preview = await fetchTop20Ranking({
      slot: "movie",
      source: { kind: "justwatch", mode: "popular" },
      regionCode: "IT",
      regionLang: "it-IT",
    })
    const previewIds = preview.items.map((it) => `tmdb:${it.tmdbId}`)

    // Deduplicated, invalid rows dropped, order kept, short page allowed.
    expect(pageIds).toEqual(["tmdb:101", "tmdb:102", "tmdb:103", "tmdb:104", "tmdb:105"])
    expect(previewIds).toEqual(pageIds)
    expect(preview.items.map((it) => it.rank)).toEqual([1, 2, 3, 4, 5])
  })

  it("thrown JW errors are not cached (retry recovers) while genuine empty EOF stays a short cached empty", async () => {
    let mode: "throw" | "empty" | "ok" = "throw"
    let jwCalls = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        jwCalls++
        if (mode === "throw") {
          return new Response("upstream down", { status: 500 })
        }
        if (mode === "empty") return titlesResponse([])
        return titlesResponse([{ tmdbId: 771, title: "Recovered 771" }])
      }
      return detailsResponse(771, "Recovered 771")
    })

    const path = "/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=0"
    // 1. Thrown error surfaces as an uncached empty page.
    const errRes = await GET(catalogReq(path), { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    expect(errRes.status).toBe(200)
    expect((await errRes.json()).metas).toEqual([])
    const callsAfterError = jwCalls

    // 2. Same URL recovers without poison: the error wrote no cache entry.
    mode = "ok"
    const okRes = await GET(catalogReq(path), { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    expect(okRes.status).toBe(200)
    expect((await okRes.json()).metas.map((m: { id: string }) => m.id)).toEqual(["tmdb:771"])
    expect(jwCalls).toBeGreaterThan(callsAfterError)

    // 3. Genuine empty EOF: second identical request reuses the short
    // empty entry instead of refetching upstream.
    __resetJWRankingsCache()
    cacheClear()
    mode = "empty"
    jwCalls = 0
    const emptyPath = "/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=40"
    const e1 = await GET(catalogReq(emptyPath), { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    expect((await e1.json()).metas).toEqual([])
    expect(jwCalls).toBe(1)
    const e2 = await GET(catalogReq(emptyPath), { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    expect((await e2.json()).metas).toEqual([])
    expect(jwCalls).toBe(1)
  })
})
