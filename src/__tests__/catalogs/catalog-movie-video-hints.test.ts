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

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return { ...mod, enrichVideosWithTvdb: vi.fn(), enrichVideosWithTvdbDetailed: vi.fn(async () => true) }
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

function movieDetailsResponse(tmdbId: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({
    id: tmdbId,
    title: "Fight Club",
    release_date: "1999-10-15",
    vote_average: 8.4,
    genres: [{ id: 18, name: "Dramma" }],
    backdrop_path: "/fight-club-bg.jpg",
    overview: "Trama",
    ...extra,
  })
}

function freshCaches(): void {
  cacheClear()
  __resetJWRankingsCache()
  __clearTMDBCache()
  __clearImdbCache()
}

describe("movie video-navigation hints (Easy parity)", () => {
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

  it("movie JW catalog emits Easy-shaped hints and empty videos with the emitted id", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(550, "tt0137523"))
      .mockResolvedValueOnce(movieDetailsResponse(550))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt0137523")
    expect(body.metas[0].behaviorHints).toEqual({ defaultVideoId: "tt0137523", hasScheduledVideos: false })
    expect(body.metas[0].videos).toEqual([])
    // Numeric poster identity preserved (mapping/selection contract untouched).
    expect(body.metas[0].poster).toContain("/api/poster/movie/550")
  })

  it("movie catalog typed tmdb: fallback emits matching defaultVideoId", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(67890))
      .mockResolvedValueOnce(movieDetailsResponse(67890))
      .mockResolvedValueOnce(Response.json({ id: 67890, imdb_id: null }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tmdb:67890")
    expect(body.metas[0].behaviorHints).toEqual({ defaultVideoId: "tmdb:67890", hasScheduledVideos: false })
    expect(body.metas[0].videos).toEqual([])
    expect(body.metas[0].poster).toContain("/api/poster/movie/67890")
  })

  it("series catalog stays byte-equivalent without movie hints", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchResponse(94997, "tt11198330"))
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        name: "House of the Dragon",
        poster_path: "/hotd.jpg",
        first_air_date: "2022-08-21",
      }))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
    const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt11198330")
    expect(body.metas[0].behaviorHints).toBeUndefined()
    expect(body.metas[0].videos).toBeUndefined()
  })

  it("movie full-text search emits hints with the emitted id", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        page: 1,
        results: [{ id: 550, title: "Fight Club", release_date: "1999-10-15" }],
        total_pages: 1,
        total_results: 1,
      }))
      .mockResolvedValueOnce(Response.json({ genres: [{ id: 18, name: "Dramma" }] }))
      .mockResolvedValueOnce(Response.json({ id: 550, imdb_id: "tt0137523" }))

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-search-movies/search=fight%20club.json?api_key=settings-key")
    const res = await catalogExtraGET(req, {
      params: Promise.resolve({ type: "movie", id: "pictorium-search-movies", extra: ["search=fight%20club.json"] }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].id).toBe("tt0137523")
    expect(body.metas[0].behaviorHints).toEqual({ defaultVideoId: "tt0137523", hasScheduledVideos: false })
    expect(body.metas[0].videos).toEqual([])
    expect(body.metas[0].poster).toContain("/api/poster/movie/550")
  })

  it("movie /meta emits hasScheduledVideos:false and empty videos, keeping primaryId semantics", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ movie_results: [{ id: 550, title: "Fight Club" }] }))
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
        credits: { cast: [], crew: [] },
        videos: { results: [] },
      }))
      .mockResolvedValueOnce(Response.json({ id: 550, logos: [] }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0137523.json?api_key=settings-key")
    const res = await metaGET(req, { params: Promise.resolve({ type: "movie", id: "tt0137523.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.behaviorHints).toEqual({ defaultVideoId: "tt0137523", hasScheduledVideos: false })
    expect(body.meta.videos).toEqual([])
  })

  it("movie /meta typed tmdb: fallback without IMDb keeps tmdb: defaultVideoId", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        id: 67890,
        title: "Senza IMDb",
        overview: "x",
        release_date: "2021-01-01",
        vote_average: 7.0,
        genres: [],
        external_ids: { imdb_id: null },
        credits: { cast: [], crew: [] },
        videos: { results: [] },
      }))
      .mockResolvedValueOnce(Response.json({ id: 67890, imdb_id: null }))
      .mockResolvedValueOnce(Response.json({ id: 67890, logos: [] }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tmdb:67890.json?api_key=settings-key")
    const res = await metaGET(req, { params: Promise.resolve({ type: "movie", id: "tmdb:67890.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.id).toBe("tmdb:67890")
    expect(body.meta.behaviorHints).toEqual({ defaultVideoId: "tmdb:67890", hasScheduledVideos: false })
    expect(body.meta.videos).toEqual([])
  })

  it("series /meta keeps episode videos and no behaviorHints", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        name: "House of the Dragon",
        overview: "La storia...",
        first_air_date: "2022-08-21",
        vote_average: 8.4,
        genres: [{ id: 18, name: "Dramma" }],
        backdrop_path: "/hotd-backdrop.jpg",
        external_ids: { imdb_id: "tt11198330" },
        seasons: [{ season_number: 1, episode_count: 1 }],
        credits: { cast: [], crew: [] },
      }))
      .mockResolvedValueOnce(Response.json({ logos: [] }))
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({
        id: 1234,
        season_number: 1,
        name: "Stagione 1",
        episodes: [{ id: 101, season_number: 1, episode_number: 1, name: "Episodio 1" }],
      }))

    const req = new NextRequest("http://localhost:3000/meta/series/tmdb:94997.json?api_key=settings-key")
    const res = await metaGET(req, { params: Promise.resolve({ type: "series", id: "tmdb:94997.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.behaviorHints).toBeUndefined()
    expect(body.meta.videos).toHaveLength(1)
    expect(body.meta.videos[0]).toMatchObject({ season: 1, episode: 1 })
  })
})
