import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/tmdb/[id]/details/route"
import { getDetails, getExternalIds } from "@/lib/tmdb"
import { fetchAggregatedRating } from "@/lib/ratings"
import { cacheClear } from "@/lib/cache"
import * as cacheModule from "@/lib/cache"

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getExternalIds: vi.fn(),
  // La route risolve la chiave via helper (query > namespace > env): qui
  // basta l'equivalente query-only per kind, la risoluzione namespace è
  // coperta da namespace-keys.test.ts.
  resolveRouteApiKey: vi.fn(async (req: Request, kind?: string) => {
    const q = new URL(req.url).searchParams
    return (kind === "mdblist" ? q.get("mdblist_key") : q.get("api_key")) || undefined
  }),
}))
vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

const BASE_DETAILS = {
  title: "Test", name: null, genres: [], vote_average: 7.3, vote_count: 0, type: "movie",
  status: null, release_date: null, first_air_date: null, last_air_date: null,
  next_episode_to_air: null, number_of_seasons: null, number_of_episodes: null,
  networks: [], production_companies: [], original_language: "en",
}

function makeReq(mdblistKey?: string): NextRequest {
  const query = mdblistKey
    ? `?type=movie&language=it-IT&api_key=k&mdblist_key=${mdblistKey}`
    : "?type=movie&language=it-IT&api_key=k"
  return new NextRequest(`http://localhost:3000/api/tmdb/123/details${query}`)
}

describe("GET /api/tmdb/[id]/details (voto medio IMDb di default)", () => {
  afterEach(() => {
    vi.clearAllMocks()
    cacheClear()
  })

  it("falls back to TMDB vote_average when no aggregated rating is available", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt123" })

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "123" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.voteAverage).toBe(7.3)
  })

  it("exposes local Kitsu and MAL IDs on fresh and cached details", async () => {
    vi.mocked(getDetails).mockResolvedValue(BASE_DETAILS as never)
    vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null } as never)
    const req = new NextRequest("http://localhost:3000/api/tmdb/128/details?type=movie&api_key=k")
    for (let i = 0; i < 2; i++) {
      const res = await GET(req, { params: Promise.resolve({ id: "128" }) })
      expect((await res.json()).anime_ids).toEqual({ kitsu: [142], mal: [164] })
    }
    expect(getDetails).toHaveBeenCalledTimes(1)
    // Task C: senza IMDb la route richiede comunque le fonti via TMDB id
    // (imdb null + tmdbId/mediaType in opts); il mock risponde null.
    expect(fetchAggregatedRating).toHaveBeenCalledTimes(1)
    expect(fetchAggregatedRating).toHaveBeenCalledWith(
      null,
      undefined,
      expect.any(AbortSignal),
      expect.objectContaining({ tmdbId: 128, mediaType: "movie", requestedSources: ["imdb"] }),
    )
  })

  it("keeps film and series associations separate", async () => {
    vi.mocked(getDetails).mockResolvedValue(BASE_DETAILS as never)
    vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null } as never)
    const req = new NextRequest("http://localhost:3000/api/tmdb/128/details?type=tv&api_key=k")
    const res = await GET(req, { params: Promise.resolve({ id: "128" }) })
    expect((await res.json()).anime_ids).toEqual({ kitsu: [], mal: [] })
  })

  it("preserves all season associations for a series without picking one", async () => {
    vi.mocked(getDetails).mockResolvedValue(BASE_DETAILS as never)
    vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null } as never)
    const req = new NextRequest("http://localhost:3000/api/tmdb/26209/details?type=tv&api_key=k")
    const res = await GET(req, { params: Promise.resolve({ id: "26209" }) })
    const { anime_ids } = await res.json()
    expect(anime_ids.kitsu).toContain(265)
    expect(anime_ids.kitsu).toContain(363)
    expect(anime_ids.mal).toContain(290)
    expect(anime_ids.mal).toContain(396)
    expect(new Set(anime_ids.kitsu).size).toBe(anime_ids.kitsu.length)
    expect(new Set(anime_ids.mal).size).toBe(anime_ids.mal.length)
  })

  it("exposes wikidata_id from external_ids (preview fast-path, zero extra RTT)", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt123", wikidata_id: "Q23577" })

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "123" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.wikidata_id).toBe("Q23577")
    expect(body.imdb_id).toBe("tt123")
  })

  it("nulls wikidata_id when TMDB has no link (SPARQL fallback preserved)", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt123" })

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "123" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.wikidata_id).toBeNull()
  })

  it("uses the IMDb vote (default source) when the aggregated rating is available", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt123" })
    ;(fetchAggregatedRating as ReturnType<typeof vi.fn>).mockResolvedValue({
      sources: { imdb: 8.0, tmdb: 7.3 }, average: 7.65, count: 2,
    })

    const res = await GET(makeReq(), { params: Promise.resolve({ id: "123" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.voteAverage).toBe(8.0)
  })

  it("passes requestedSources, ratingWaitMs and an abortable signal to fetchAggregatedRating", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt999" })
    // Mock implementation leaks across tests (clearAllMocks non la rimuove):
    // qui serve l'assenza di aggregato per il fallback TMDB.
    ;(fetchAggregatedRating as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const req = new NextRequest("http://localhost:3000/api/tmdb/124/details?type=movie&language=it-IT&api_key=k&rsrc=imdb,tmdb")
    const res = await GET(req, { params: Promise.resolve({ id: "124" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.voteAverage).toBe(7.3)
    expect(fetchAggregatedRating).toHaveBeenCalledWith(
      "tt999",
      undefined,
      expect.any(AbortSignal),
      expect.objectContaining({
        requestedSources: ["imdb", "tmdb"],
        ratingWaitMs: expect.any(Number),
        tmdbFallbackVote: 7.3,
      }),
    )
    // La route abortisce l'upstream residuo in finally dopo la race.
    const passedSignal = vi.mocked(fetchAggregatedRating).mock.calls[0][2] as AbortSignal | undefined
    expect(passedSignal).toBeInstanceOf(AbortSignal)
    expect(passedSignal?.aborted).toBe(true)
  })

  it("absent-empty-invalid rsrc resolve to the explicit IMDb default", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt997" })
    ;(fetchAggregatedRating as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    for (const q of ["", "&rsrc=", "&rsrc=xyz", "&rsrc=xyz,abc"]) {
      vi.mocked(fetchAggregatedRating).mockClear()
      cacheClear()
      const req = new NextRequest(`http://localhost:3000/api/tmdb/127/details?type=movie&language=it-IT&api_key=k${q}`)
      const res = await GET(req, { params: Promise.resolve({ id: "127" }) })
      expect(res.status).toBe(200)
      expect(fetchAggregatedRating).toHaveBeenCalledWith(
        "tt997",
        undefined,
        expect.any(AbortSignal),
        expect.objectContaining({ requestedSources: ["imdb"] }),
      )
    }
  })

  it("propagates single-source rsrc to the rating fetch", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt998" })

    const req = new NextRequest("http://localhost:3000/api/tmdb/125/details?type=movie&language=it-IT&api_key=k&rsrc=tmdb")
    const res = await GET(req, { params: Promise.resolve({ id: "125" }) })
    expect(res.status).toBe(200)
    expect(fetchAggregatedRating).toHaveBeenCalledWith(
      "tt998",
      undefined,
      expect.any(AbortSignal),
      expect.objectContaining({ requestedSources: ["tmdb"] }),
    )
  })

  it("uses distinct cache keys for different mdblist_key values (hash, not plaintext)", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt123" })

    const keys: string[] = []
    const spy = vi.spyOn(cacheModule, "cacheSet").mockImplementation((key: string, _value: unknown, _tags?: string[]) => {
      keys.push(key)
      return cacheModule.cacheGet(key) as void
    })

    try {
      const res1 = await GET(makeReq("keyAAA"), { params: Promise.resolve({ id: "123" }) })
      const res2 = await GET(makeReq("keyBBB"), { params: Promise.resolve({ id: "123" }) })

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      expect(keys).toHaveLength(2)
      // Chiavi diverse → non c'è cache hit incrociato con un'altra chiave mdblist.
      expect(keys[0]).not.toBe(keys[1])
      // Prefisso standard details:v15 (default esplicito via rsrcKey).
      expect(keys[0]).toMatch(/^details:v15:movie:123:it-IT:/)
      // La chiave API non deve apparire in chiaro nel cache key (hash sha1 a 8 hex).
      expect(keys[0]).not.toContain("keyAAA")
      expect(keys[1]).not.toContain("keyBBB")
    } finally {
      spy.mockRestore()
    }
  })

  it("uses the same cache key for repeated requests with the same mdblist_key (cache hit)", async () => {
    ;(getDetails as ReturnType<typeof vi.fn>).mockResolvedValue(BASE_DETAILS)
    ;(getExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: "tt123" })

    const spy = vi.spyOn(cacheModule, "cacheSet")

    try {
      await GET(makeReq("keyAAA"), { params: Promise.resolve({ id: "123" }) })
      await GET(makeReq("keyAAA"), { params: Promise.resolve({ id: "123" }) })

      // Seconda chiamata servita dalla cache: cacheSet chiamato una sola volta.
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})
