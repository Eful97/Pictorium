import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { getById } from "@/lib/store"
import { __resetJWRankingsCache, JW_DIGITAL_MONETIZATION_TYPES } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"
import { GLOBAL_REGION_CODE } from "@/lib/regions"

interface JwGraphQLRequestBody {
  variables: {
    offset?: number
    first?: number
    sortBy?: string
    filter: {
      objectTypes?: string[]
      genres?: string[]
      monetizationTypes?: string[]
    }
  }
}

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

function makeJwTitlesResponse(items: Array<{ tmdbId: number; title: string; imdbId?: string }>): Response {
  return Response.json({
    data: {
      popularTitles: {
        edges: items.map((item) => ({
          node: {
            content: {
              title: item.title,
              originalReleaseDate: "2026-01-01",
              externalIds: { tmdbId: item.tmdbId, imdbId: item.imdbId ?? `tt${item.tmdbId}` },
            },
          },
        })),
      },
    },
  })
}

function makeTmdbDetailsResponse(tmdbId: number, title: string): Response {
  return Response.json({
    id: tmdbId,
    title,
    name: title,
    poster_path: "/poster.jpg",
    first_air_date: "2026-01-01",
    release_date: "2026-01-01",
    vote_average: 8.0,
    genres: [{ id: 28, name: "Azione" }],
    external_ids: { imdb_id: `tt${tmdbId}` },
  })
}

describe("Stremio Popular & Trending Pagination (Task B, C, D)", () => {
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

  it("pages with skip=0, 20, 40 using exact disjoint offsets and overfetch=false", async () => {
    const capturedRequests: Array<JwGraphQLRequestBody> = []

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        const body = JSON.parse(init?.body as string)
        capturedRequests.push(body)
        const offset = body.variables?.offset || 0
        if (offset === 0) {
          // Page 1: 20 disjoint titles (101..120)
          const items = Array.from({ length: 20 }, (_, i) => ({
            tmdbId: 101 + i,
            title: `Movie ${101 + i}`,
          }))
          return makeJwTitlesResponse(items)
        }
        if (offset === 20) {
          // Page 2: 20 disjoint titles (201..220)
          const items = Array.from({ length: 20 }, (_, i) => ({
            tmdbId: 201 + i,
            title: `Movie ${201 + i}`,
          }))
          return makeJwTitlesResponse(items)
        }
        // Page 3 (offset=40): empty
        return makeJwTitlesResponse([])
      }
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      const id = m ? Number(m[2]) : 999
      return makeTmdbDetailsResponse(id, `Movie ${id}`)
    })

    // 1. First page: skip=0
    const req0 = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=0")
    const res0 = await GET(req0, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body0 = await res0.json()
    expect(res0.status).toBe(200)
    expect(body0.metas).toHaveLength(20)
    expect(body0.metas[0].id).toBe("tmdb:101")
    expect(body0.metas[19].id).toBe("tmdb:120")

    // Verify first request parameters: offset=0, first=20, overfetch disabled (first=20 not 40)
    expect(capturedRequests[0].variables.offset).toBe(0)
    expect(capturedRequests[0].variables.first).toBe(20)
    expect(capturedRequests[0].variables.sortBy).toBe("POPULAR")
    expect(capturedRequests[0].variables.filter.monetizationTypes).toEqual([...JW_DIGITAL_MONETIZATION_TYPES])

    // 2. Second page: skip=20
    const req20 = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=20")
    const res20 = await GET(req20, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body20 = await res20.json()
    expect(res20.status).toBe(200)
    expect(body20.metas).toHaveLength(20)
    expect(body20.metas[0].id).toBe("tmdb:201")
    expect(body20.metas[19].id).toBe("tmdb:220")

    // Verify second request parameters: offset=20, first=20
    expect(capturedRequests[1].variables.offset).toBe(20)
    expect(capturedRequests[1].variables.first).toBe(20)

    // Verify disjoint items between page 1 and page 2
    const ids0 = new Set(body0.metas.map((m: { id: string }) => m.id))
    const ids20 = body20.metas.map((m: { id: string }) => m.id)
    expect(ids20.some((id: string) => ids0.has(id))).toBe(false)

    // 3. Third page: skip=40 (end of list)
    const req40 = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=40")
    const res40 = await GET(req40, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body40 = await res40.json()
    expect(res40.status).toBe(200)
    expect(body40.metas).toEqual([])
  })

  it("uses TRENDING and SHOW for series slot when configured as trending", async () => {
    let capturedBody: JwGraphQLRequestBody | null = null
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        capturedBody = JSON.parse(init?.body as string)
        return makeJwTitlesResponse([{ tmdbId: 501, title: "Series 501" }])
      }
      return makeTmdbDetailsResponse(501, "Series 501")
    })

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=test-key&skip=0")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(capturedBody).not.toBeNull()
    expect(capturedBody!.variables.sortBy).toBe("TRENDING")
    expect(capturedBody!.variables.filter.objectTypes).toEqual(["SHOW"])
  })

  it("applies genre server-side in JustWatch query and bypasses post-filtering", async () => {
    const capturedBodies: JwGraphQLRequestBody[] = []
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        capturedBodies.push(JSON.parse(init?.body as string))
        return makeJwTitlesResponse([{ tmdbId: 301, title: "Action Movie 301" }])
      }
      return makeTmdbDetailsResponse(301, "Action Movie 301")
    })

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&genre=Azione&skip=20")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(capturedBodies.length).toBeGreaterThan(0)
    // Page window still carries the server-side genre filter and skip.
    const pageCall = capturedBodies.find((b) => b.variables.offset === 20)
    expect(pageCall).not.toBeUndefined()
    // Genre "Azione" maps to "act" in JustWatch
    expect(pageCall!.variables.filter.genres).toEqual(["act"])
    // Canonical snapshot (offset 0, unfiltered) backs the rk mapping — it
    // must never carry the genre-local filter as a global rank source.
    const snapshotCall = capturedBodies.find((b) => b.variables.offset === 0)
    expect(snapshotCall).not.toBeUndefined()
    expect(snapshotCall!.variables.filter.genres).toBeUndefined()
  })

  it("returns empty fail-closed for out-of-scope editorial genres", async () => {
    let jwCalled = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      jwCalled = true
      return makeJwTitlesResponse([])
    })

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&genre=Commedie%20horror")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
    expect(jwCalled).toBe(false)
  })

  it("returns empty fail-closed in global region without national fallback", async () => {
    let jwCalled = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      jwCalled = true
      return makeJwTitlesResponse([])
    })

    const req = new NextRequest(`http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&region=${GLOBAL_REGION_CODE}`)
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
    expect(jwCalled).toBe(false)
  })

  it("returns short page with existing items without filler", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        // Only 3 items returned by JustWatch
        return makeJwTitlesResponse([
          { tmdbId: 701, title: "Tail 1" },
          { tmdbId: 702, title: "Tail 2" },
          { tmdbId: 703, title: "Tail 3" },
        ])
      }
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      const id = m ? Number(m[2]) : 700
      return makeTmdbDetailsResponse(id, `Tail ${id}`)
    })

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=20")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(3)
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tmdb:701", "tmdb:702", "tmdb:703"])
  })

  it("isolates cache between different skip, source modes, and genres", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        const body = JSON.parse(init?.body as string)
        const offset = body.variables?.offset || 0
        const genre = body.variables?.filter?.genres?.[0] || "all"
        const idBase = genre !== "all" ? 900 : 800
        const id = idBase + offset
        return makeJwTitlesResponse([{ tmdbId: id, title: `Item ${offset}-${genre}` }])
      }
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      const id = m ? Number(m[2]) : 800
      return makeTmdbDetailsResponse(id, `Detail ${id}`)
    })

    const reqP1 = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=0")
    const resP1 = await GET(reqP1, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const bodyP1 = await resP1.json()

    const reqP2 = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=20")
    const resP2 = await GET(reqP2, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const bodyP2 = await resP2.json()

    const reqGenre = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=0&genre=Azione")
    const resGenre = await GET(reqGenre, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const bodyGenre = await resGenre.json()

    // Each distinct query produced distinct cached bodies
    expect(bodyP1.metas[0].id).toBe("tmdb:800")
    expect(bodyP2.metas[0].id).toBe("tmdb:820")
    expect(bodyGenre.metas[0].id).toBe("tmdb:900")
  })

  it("does not inject page rank into poster URLs (badge protection Task D)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        return makeJwTitlesResponse([{ tmdbId: 201, title: "Page 2 Item" }])
      }
      return makeTmdbDetailsResponse(201, "Page 2 Item")
    })

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=20")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    const posterUrl = body.metas[0].poster
    expect(posterUrl).toBeDefined()
    // No artificial rank (e.g. animerank=21 or rank=1) injected into the poster URL
    expect(posterUrl).not.toContain("animerank=")
    expect(posterUrl).not.toContain("rank=")
  })
})
