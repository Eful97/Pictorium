import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getById } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", () => ({
  getServerDefaults: vi.fn(() => ({})),
}))

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return { ...mod, enrichVideosWithTvdb: vi.fn() }
})

import { enrichVideosWithTvdb } from "@/lib/tvdb"

const mockedEnrich = vi.mocked(enrichVideosWithTvdb)

const mockedGetById = vi.mocked(getById)

describe("GET /meta/[type]/[id]", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    // Isolamento tra test: tmdbFetch ha una LRU in-memory (5 min) che
    // sopravvive ai mock di fetch — senza clear, due test sugli stessi
    // URL TMDB si avvelenano a vicenda (cfr. default Parts su tt6468322).
    __clearTMDBCache()
  })

  it("returns complete movie metadata with Pictorium poster URL and cast/crew", async () => {
    vi.spyOn(globalThis, "fetch")
      // /find/tt0137523
      .mockResolvedValueOnce(Response.json({
        movie_results: [{ id: 550, title: "Fight Club" }],
      }))
      // /movie/550 details
      .mockResolvedValueOnce(Response.json({
        id: 550,
        title: "Fight Club",
        overview: "Un impiegato insonne...",
        release_date: "1999-10-15",
        runtime: 139,
        vote_average: 8.4,
        genres: [{ id: 18, name: "Dramma" }, { id: 53, name: "Thriller" }],
        backdrop_path: "/backdrop.jpg",
        external_ids: { imdb_id: "tt0137523" },
        credits: {
          cast: [{ name: "Brad Pitt" }, { name: "Edward Norton" }],
          crew: [{ name: "David Fincher", job: "Director" }],
        },
        videos: {
          results: [{ site: "YouTube", key: "trailer123", type: "Trailer", name: "Trailer Ufficiale" }],
        },
      }))
      // /movie/550/images for logo
      .mockResolvedValueOnce(Response.json({
        id: 550,
        logos: [{ file_path: "/fight-club-logo.png", iso_639_1: "it" }],
      }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0137523.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({ type: "movie", id: "tt0137523.json" }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta).toMatchObject({
      id: "tt0137523",
      type: "movie",
      name: "Fight Club",
      releaseInfo: "1999",
      runtime: "139 min",
      imdbRating: "8.4",
      genres: ["Dramma", "Thriller"],
      cast: ["Brad Pitt", "Edward Norton"],
      director: ["David Fincher"],
      behaviorHints: { defaultVideoId: "tt0137523" },
    })
    expect(body.meta.poster).toContain("/api/poster/movie/550")
    expect(body.meta.poster).toContain(`rv=${POSTER_URL_VERSION}`)
    expect(body.meta.background).toContain("/backdrop.jpg")
    expect(body.meta.logo).toContain("/fight-club-logo.png")
    expect(body.meta.trailers).toEqual([{ source: "trailer123", type: "Trailer" }])
  })

  it("returns complete series metadata with seasons and episode videos", async () => {
    vi.spyOn(globalThis, "fetch")
      // /tv/94997 details
      .mockResolvedValueOnce(Response.json({
        id: 94997,
        name: "House of the Dragon",
        overview: "La storia della Casa Targaryen...",
        first_air_date: "2022-08-21",
        vote_average: 8.4,
        genres: [{ id: 10765, name: "Sci-Fi & Fantasy" }, { id: 18, name: "Dramma" }],
        backdrop_path: "/hotd-backdrop.jpg",
        external_ids: { imdb_id: "tt11198330" },
        seasons: [
          { season_number: 1, episode_count: 2 },
        ],
        credits: {
          cast: [{ name: "Matt Smith" }, { name: "Emma D'Arcy" }],
        },
      }))
      // /tv/94997/images
      .mockResolvedValueOnce(Response.json({ logos: [] }))
      // /tv/94997/episode_groups (default automatico: nessun gruppo → standard)
      .mockResolvedValueOnce(Response.json({ results: [] }))
      // /tv/94997/season/1
      .mockResolvedValueOnce(Response.json({
        id: 1234,
        season_number: 1,
        name: "Stagione 1",
        episodes: [
          {
            id: 101,
            season_number: 1,
            episode_number: 1,
            name: "Gli eredi del drago",
            overview: "Re Viserys organizza un torneo...",
            still_path: "/ep1.jpg",
            air_date: "2022-08-21",
            vote_average: 8.1,
          },
          {
            id: 102,
            season_number: 1,
            episode_number: 2,
            name: "Il principe canaglia",
            overview: "Rhaenyra propone un piano...",
            still_path: "/ep2.jpg",
            air_date: "2022-08-28",
            vote_average: 8.3,
          },
        ],
      }))

    const req = new NextRequest("http://localhost:3000/meta/series/tmdb:94997.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({ type: "series", id: "tmdb:94997.json" }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta).toMatchObject({
      id: "tmdb:94997",
      imdb_id: "tt11198330",
      type: "series",
      name: "House of the Dragon",
      releaseInfo: "2022",
      imdbRating: "8.4",
      genres: ["Sci-Fi & Fantasy", "Dramma"],
      cast: ["Matt Smith", "Emma D'Arcy"],
    })
    expect(body.meta.videos).toHaveLength(2)
    expect(body.meta.videos[0]).toMatchObject({
      id: "tt11198330:1:1",
      season: 1,
      episode: 1,
      name: "Gli eredi del drago",
      thumbnail: expect.stringContaining("/ep1.jpg"),
    })
    expect(body.meta.videos[1]).toMatchObject({
      id: "tt11198330:1:2",
      season: 1,
      episode: 2,
      name: "Il principe canaglia",
      thumbnail: expect.stringContaining("/ep2.jpg"),
    })
  })

  it("auto-selects Original Parts with no saved mapping (Casa di Carta 5 parti)", async () => {
    // Nessun mapping salvato (default beforeEach = null) → default automatico.
    // NB: fixture ID diversi dal test Netflix sotto (tt6468322/71446) perché
    // tmdbFetch cacherebbe gli URL in comune tra i test.
    const partSizes = [9, 6, 8, 8, 10]
    const groups = partSizes.map((size, p) => ({
      id: `part_${p + 1}`,
      name: `Parte ${p + 1}`,
      order: p + 1,
      episodes: Array.from({ length: size }, (_, i) => ({
        id: (p + 1) * 100 + i,
        episode_number: i + 1,
        name: `P${p + 1}E${i + 1}`,
        air_date: "2017-05-02",
        order: i,
      })),
    }))
    vi.spyOn(globalThis, "fetch")
      // /find/tt6468301
      .mockResolvedValueOnce(Response.json({
        tv_results: [{ id: 714401 }],
      }))
      // /tv/714401 details (standard: 3 stagioni, 41 episodi)
      .mockResolvedValueOnce(Response.json({
        id: 714401,
        name: "La casa di carta",
        overview: "Una banda di ladri...",
        first_air_date: "2017-05-02",
        vote_average: 8.2,
        genres: [{ id: 80, name: "Crime" }],
        external_ids: { imdb_id: "tt6468301" },
        seasons: [
          { season_number: 1, episode_count: 15 },
          { season_number: 2, episode_count: 16 },
          { season_number: 3, episode_count: 10 },
        ],
      }))
      // /tv/714401/images
      .mockResolvedValueOnce(Response.json({ logos: [] }))
      // /tv/714401/episode_groups
      .mockResolvedValueOnce(Response.json({
        results: [
          { id: "grp_original", name: "Original Parts", description: "Antena 3", group_count: 5, episode_count: 41 },
          { id: "grp_recut", name: "Parts (edited version)", description: "Netflix re-cut", group_count: 5, episode_count: 48 },
        ],
      }))
      // /tv/episode_group/grp_original
      .mockResolvedValueOnce(Response.json({
        id: "grp_original",
        name: "Original Parts",
        group_count: 5,
        groups,
      }))

    const req = new NextRequest("http://localhost:3000/meta/series/tt6468301.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({ type: "series", id: "tt6468301.json" }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.videos).toHaveLength(41)
    expect(body.meta.videos[0]).toMatchObject({ id: "tt6468301:1:1", season: 1, episode: 1 })
    expect(body.meta.videos[8]).toMatchObject({ season: 1, episode: 9 })
    expect(body.meta.videos[9]).toMatchObject({ season: 2, episode: 1 })
    expect(body.meta.videos[40]).toMatchObject({ id: "tt6468301:5:10", season: 5, episode: 10 })
  })

  it("supports alternative Netflix Episode Groups (e.g. 5 parts for La Casa de Papel)", async () => {
    // Default è standard TMDB: l'episode group si usa solo se salvato esplicitamente
    mockedGetById.mockResolvedValue({ episodeGroupId: "grp_netflix_5" } as unknown as Awaited<ReturnType<typeof getById>>)
    vi.spyOn(globalThis, "fetch")
      // /find/tt6468322
      .mockResolvedValueOnce(Response.json({
        tv_results: [{ id: 71446 }],
      }))
      // /tv/71446 details
      .mockResolvedValueOnce(Response.json({
        id: 71446,
        name: "La casa di carta",
        overview: "Una banda di ladri...",
        first_air_date: "2017-05-02",
        vote_average: 8.2,
        genres: [{ id: 80, name: "Crime" }, { id: 18, name: "Dramma" }],
        external_ids: { imdb_id: "tt6468322" },
        seasons: [{ season_number: 1 }, { season_number: 2 }],
      }))
      // /tv/71446/images
      .mockResolvedValueOnce(Response.json({ logos: [] }))
      // /tv/episode_group/grp_netflix_5
      .mockResolvedValueOnce(Response.json({
        id: "grp_netflix_5",
        name: "Netflix Order",
        groups: [
          {
            id: "part_1",
            name: "Parte 1",
            order: 1,
            episodes: [{ id: 1, episode_number: 1, name: "Effetto Guggenheim", air_date: "2017-12-20" }],
          },
          {
            id: "part_5",
            name: "Parte 5",
            order: 5,
            episodes: [{ id: 50, episode_number: 1, name: "Fine della corsa", air_date: "2021-09-03" }],
          },
        ],
      }))

    const req = new NextRequest("http://localhost:3000/meta/series/tt6468322.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({ type: "series", id: "tt6468322.json" }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.videos).toHaveLength(2)
    // Parte 1
    expect(body.meta.videos[0]).toMatchObject({
      id: "tt6468322:1:1",
      season: 1,
      episode: 1,
      name: "Effetto Guggenheim",
    })
    // Parte 5
    expect(body.meta.videos[1]).toMatchObject({
      id: "tt6468322:5:1",
      season: 5,
      episode: 1,
      name: "Fine della corsa",
    })
  })

  it("returns null meta when title cannot be found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ movie_results: [] }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0000000.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({ type: "movie", id: "tt0000000.json" }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta).toBeNull()
  })

  it("resolves tvdb: IDs via /find?external_source=tvdb_id", async () => {
    vi.spyOn(globalThis, "fetch")
      // /find/81189?external_source=tvdb_id
      .mockResolvedValueOnce(Response.json({
        tv_results: [{ id: 1396, name: "Breaking Bad" }],
      }))
      // /tv/1396 details
      .mockResolvedValueOnce(Response.json({
        id: 1396,
        name: "Breaking Bad",
        overview: "Un professore di chimica...",
        first_air_date: "2008-01-20",
        vote_average: 8.9,
        genres: [{ id: 18, name: "Dramma" }],
        external_ids: { imdb_id: "tt0903747" },
        seasons: [{ season_number: 1, episode_count: 7 }],
      }))
      // /tv/1396/images
      .mockResolvedValueOnce(Response.json({ logos: [] }))
      // /tv/1396/episode_groups (default automatico: nessun gruppo → standard)
      .mockResolvedValueOnce(Response.json({ results: [] }))
      // /tv/1396/season/1
      .mockResolvedValueOnce(Response.json({
        id: 1396,
        season_number: 1,
        name: "Season 1",
        overview: "",
        episodes: [{ id: 101, season_number: 1, episode_number: 1, name: "Pilot" }],
      }))

    const req = new NextRequest("http://localhost:3000/meta/series/tvdb:81189.json?api_key=settings-key")
    const res = await GET(req, {
      params: Promise.resolve({ type: "series", id: "tvdb:81189.json" }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta).not.toBeNull()
    expect(body.meta.name).toBe("Breaking Bad")
    expect(body.meta.videos[0].id).toBe("tt0903747:1:1")
  })

  it("skips TVDB enrichment for group-ordered videos (S:E would misalign)", async () => {
    mockedGetById.mockResolvedValue({ episodeGroupId: "grp_parts" } as unknown as Awaited<ReturnType<typeof getById>>)
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ tv_results: [{ id: 715001 }] }))
      .mockResolvedValueOnce(Response.json({
        id: 715001,
        name: "Serie Parti",
        first_air_date: "2020-01-01",
        vote_average: 8.0,
        genres: [],
        external_ids: { imdb_id: "tt6468001" },
        seasons: [{ season_number: 1, episode_count: 2 }],
      }))
      .mockResolvedValueOnce(Response.json({ logos: [] }))
      .mockResolvedValueOnce(Response.json({
        id: "grp_parts",
        name: "Original Parts",
        groups: [
          { id: "p1", name: "Parte 1", order: 1, episodes: [{ id: 1, episode_number: 1, name: "E1" }] },
          { id: "p2", name: "Parte 2", order: 2, episodes: [{ id: 2, episode_number: 1, name: "E2" }] },
        ],
      }))

    const req = new NextRequest("http://localhost:3000/meta/series/tt6468001.json?api_key=k&tvdb_key=tvdbk")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "tt6468001.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.videos).toHaveLength(2)
    expect(mockedEnrich).not.toHaveBeenCalled()
  })

  it("keeps TVDB enrichment for standard-ordered videos", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ tv_results: [{ id: 715002 }] }))
      .mockResolvedValueOnce(Response.json({
        id: 715002,
        name: "Serie Standard",
        first_air_date: "2020-01-01",
        vote_average: 8.0,
        genres: [],
        external_ids: { imdb_id: "tt6468002" },
        seasons: [{ season_number: 1, episode_count: 1 }],
      }))
      .mockResolvedValueOnce(Response.json({ logos: [] }))
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({
        id: 715002,
        season_number: 1,
        name: "Stagione 1",
        episodes: [{ id: 11, season_number: 1, episode_number: 1, name: "Pilot" }],
      }))

    const req = new NextRequest("http://localhost:3000/meta/series/tt6468002.json?api_key=k&tvdb_key=tvdbk")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "tt6468002.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.videos).toHaveLength(1)
    expect(mockedEnrich).toHaveBeenCalledTimes(1)
  })

  it("resolves language and details according to region parameter (e.g. MX -> es-MX)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ movie_results: [{ id: 550, title: "El club de la pelea" }] }))
      .mockResolvedValueOnce(Response.json({
        id: 550,
        title: "El club de la pelea",
        overview: "Un oficinista insomne...",
        external_ids: { imdb_id: "tt0137523" },
      }))
      .mockResolvedValueOnce(Response.json({ id: 550, logos: [] }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0137523.json?api_key=k&region=MX")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tt0137523.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.name).toBe("El club de la pelea")
    const detailsCall = fetchSpy.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("/movie/550"))
    expect(detailsCall?.[0]).toContain("language=es-MX")
  })

  it("resolves Hebrew metadata and images for region IL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ movie_results: [{ id: 550, title: "מועדון קרב" }] }))
      .mockResolvedValueOnce(Response.json({
        id: 550,
        title: "מועדון קרב",
        overview: "פקיד נדודי שינה...",
        external_ids: { imdb_id: "tt0137523" },
      }))
      .mockResolvedValueOnce(Response.json({
        id: 550,
        // Nessun logo ebraico: deve vincere l'inglese, non l'italiano né il
        // primo della lista (giapponese).
        logos: [
          { file_path: "/ja.png", iso_639_1: "ja", vote_average: 5, width: 500, height: 200 },
          { file_path: "/it.png", iso_639_1: "it", vote_average: 5, width: 500, height: 200 },
          { file_path: "/en.png", iso_639_1: "en", vote_average: 5, width: 500, height: 200 },
        ],
      }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0137523.json?api_key=k&region=IL")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tt0137523.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.name).toBe("מועדון קרב")
    expect(body.meta.description).toBe("פקיד נדודי שינה...")
    expect(body.meta.logo).toContain("/en.png")
    const detailsCall = fetchSpy.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("/movie/550?"))
    expect(detailsCall?.[0]).toContain("language=he-IL")
    const imagesCall = fetchSpy.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("/images"))
    expect(imagesCall?.[0]).toContain("include_image_language=he%2Cen%2Cnull")
  })
})
