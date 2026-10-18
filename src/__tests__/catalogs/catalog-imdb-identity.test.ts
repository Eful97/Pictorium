import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as catalogGET } from "@/app/catalog/[type]/[id]/route"
import { GET as catalogExtraGET } from "@/app/catalog/[type]/[id]/[...extra]/route"
import { GET as metaGET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { __resetJWRankingsCache } from "@/lib/justwatch"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const mockedGetById = vi.mocked(getById)

function justWatchResponse(tmdbId: number, imdbId?: string | null): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          {
            streamingChartInfo: { rank: 1 },
            node: {
              content: {
                externalIds: { tmdbId, imdbId: imdbId ?? null },
              },
            },
          },
        ],
      },
    },
  })
}

function detailsResponse(tmdbId: number, imdbId?: string | null): Response {
  return Response.json({
    id: tmdbId,
    name: "House of the Dragon",
    poster_path: "/house-of-the-dragon.jpg",
    first_air_date: "2022-08-21",
    ...(imdbId !== undefined
      ? { external_ids: { imdb_id: imdbId } }
      : {}),
  })
}

function freshCaches(): void {
  cacheClear()
  __resetJWRankingsCache()
  __clearTMDBCache()
  __clearImdbCache()
}

describe("catalog IMDb-first identity (catalogMetaId)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
    freshCaches()
  })

  afterEach(() => {
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    freshCaches()
  })

  it("emits the valid IMDb id supplied by JustWatch as the catalog id", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(detailsResponse(94997))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt11198330")
    // Poster URLs stay numeric TMDB (store/mapping/contract unchanged).
    expect(body.metas[0].poster).toContain("/api/poster/series/94997")
  })

  it("uses the fused details external_ids IMDb id when JustWatch omits it", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(123456))
      .mockResolvedValueOnce(detailsResponse(123456, "tt9999999"))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt9999999")
  })

  it.each([
    ["short tt", "tt123"],
    ["bare numeric string", "123456"],
    ["empty", ""],
    ["tt prefix only", "tt"],
    ["overlong tt", "tt12345678901"],
  ])("fails closed to tmdb: for invalid IMDb (%s)", async (_label, badImdb) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(123456, badImdb))
      .mockResolvedValueOnce(detailsResponse(123456))
      .mockResolvedValueOnce(Response.json({ id: 123456, imdb_id: null }))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    // Never a bare number, never the garbage string — typed TMDB fallback.
    expect(body.metas[0].id).toBe("tmdb:123456")
  })

  it("normalizes uppercase TT ids to lowercase so /meta stays resolvable", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(424242, "TT4242420"))
      .mockResolvedValueOnce(detailsResponse(424242))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt4242420")
  })

  it("falls back to tmdb: when no IMDb id is resolvable anywhere (AIOMetadata-compat path kept)", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(67890))
      .mockResolvedValueOnce(detailsResponse(67890))
      .mockResolvedValueOnce(Response.json({ id: 67890, imdb_id: null }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tmdb:67890")
  })

  it("exact-Imdb search emits the queried tt id instead of tmdb:", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        movie_results: [{ id: 550 }],
        tv_results: [],
      }))
      .mockResolvedValueOnce(Response.json({
        id: 550,
        title: "Fight Club",
        release_date: "1999-10-15",
        genres: [{ id: 28, name: "Azione" }],
        vote_average: 8.4,
        backdrop_path: "/fight-club-bg.jpg",
        overview: "Trama",
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 28, name: "Azione" }] }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=tt0137523.json?api_key=settings-key")
    const res = await catalogExtraGET(req, {
      params: Promise.resolve({
        type: "movie",
        id: "pictorium-search-movies",
        extra: ["search=tt0137523.json"],
      }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0]).toMatchObject({
      id: "tt0137523",
      type: "movie",
      name: "Fight Club",
    })
  })

  it("a catalog-emitted tt id resolves through /meta (catalog -> meta round trip)", async () => {
    vi.spyOn(globalThis, "fetch")
      // /find/tt0137523
      .mockResolvedValueOnce(Response.json({
        movie_results: [{ id: 550, title: "Fight Club" }],
      }))
      // /movie/550 details (getFullDetails)
      .mockResolvedValueOnce(Response.json({
        id: 550,
        title: "Fight Club",
        overview: "Un impiegato insonne...",
        release_date: "1999-10-15",
        runtime: 139,
        vote_average: 8.4,
        genres: [{ id: 18, name: "Dramma" }],
        backdrop_path: "/backdrop.jpg",
        external_ids: { imdb_id: "tt0137523" },
        credits: { cast: [{ name: "Brad Pitt" }], crew: [] },
        videos: { results: [] },
      }))
      // /movie/550/images for logo
      .mockResolvedValueOnce(Response.json({ id: 550, logos: [] }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0137523.json?api_key=settings-key")
    const res = await metaGET(req, { params: Promise.resolve({ type: "movie", id: "tt0137523.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta).toMatchObject({
      id: "tt0137523",
      imdb_id: "tt0137523",
      type: "movie",
      name: "Fight Club",
    })
    expect(body.meta.poster).toContain("/api/poster/movie/550")
  })
})
