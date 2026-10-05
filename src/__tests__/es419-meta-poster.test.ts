import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as GET_META } from "@/app/meta/[type]/[id]/route"
import { GET as GET_POSTER } from "@/app/api/poster/[type]/[id]/route"
import { getById, getAll, getImdbAlias } from "@/lib/store"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

/**
 * es-419 end-to-end language routing (isolated file: other suites untouched).
 * Meta resolves provider details in es-MX while the Stremio poster URL keeps
 * lang=es-419; the poster route forwards es-MX to TMDB and matches es assets.
 */
vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const epochCtl = vi.hoisted(() => ({ value: "e1" }))
vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => epochCtl.value),
  bumpCatalogEpoch: vi.fn(async () => epochCtl.value),
}))

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return { ...mod, enrichVideosWithTvdb: vi.fn() }
})

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/custom-rating")>()),
  fetchCustomRatings: vi.fn(async () => []),
}))
vi.mock("@/lib/multi-rating-renderer", () => ({ renderMultiRatings: vi.fn(async () => null) }))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/stream-quality", () => ({
  resolveStreamQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/awards", () => ({
  fetchAllWikidata: vi.fn(async () => ({ awards: [], nominations: [], studios: [], director: null })),
  getAwardBadgeLabel: vi.fn(),
  getNominationBadgeLabel: vi.fn(),
  matchTMDBStudios: vi.fn(() => []),
  matchDirectorName: vi.fn((name: string | null) => name),
  directorBadgeLabel: vi.fn((name: string | null) => name),
  isValidWikidataQid: (v: unknown): v is string => typeof v === "string" && /^Q\d+$/.test(v),
}))

vi.mock("@/lib/mdblist", () => ({
  fetchMDBList: vi.fn(async () => []),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

const DETAILS_ES_MX = {
  id: 550,
  title: "El club de la pelea",
  overview: "Un oficinista insomne...",
  release_date: "1999-10-15",
  runtime: 139,
  vote_average: 8.4,
  vote_count: 1000,
  original_language: "en",
  genres: [
    { id: 18, name: "Drama" },
    { id: 53, name: "Suspense" },
  ],
  backdrop_path: "/bd-esmx.jpg",
  poster_path: "/p-esmx.jpg",
  status: "Released",
  external_ids: { imdb_id: "tt0137523", tvdb_id: null, wikidata_id: null },
  credits: { cast: [], crew: [] },
  videos: { results: [] },
}

const IMAGES_ES = {
  id: 550,
  posters: [
    { file_path: "/clean-esmx.jpg", iso_639_1: null, vote_average: 8, vote_count: 10, width: 500, height: 750, aspect_ratio: 0.667 },
  ],
  logos: [
    { file_path: "/logo-es.png", iso_639_1: "es", vote_average: 0, vote_count: 0, width: 400, height: 200, aspect_ratio: 2 },
  ],
  backdrops: [],
}

async function imageBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 500, height: 750, channels: 4, background: "#101010" } }).png().toBuffer()
}

describe("es-419 meta/poster routing", () => {
  beforeEach(() => {
    vi.mocked(getById).mockResolvedValue(null)
    vi.mocked(getAll).mockResolvedValue([])
    vi.mocked(getImdbAlias).mockResolvedValue(null)
    cacheClear()
    __clearTMDBCache()
    __resetTMDBSessionCache()
  })

  afterEach(() => {
    cacheClear()
    __clearTMDBCache()
    __resetTMDBSessionCache()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("meta resolves TMDB details in es-MX while the poster URL keeps lang=es-419", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ movie_results: [{ id: 550, title: "El club de la pelea" }] }))
      .mockResolvedValueOnce(Response.json(DETAILS_ES_MX))
      .mockResolvedValueOnce(Response.json(IMAGES_ES))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0137523.json?api_key=k&region=IT&lang=es-419")
    const res = await GET_META(req, { params: Promise.resolve({ type: "movie", id: "tt0137523.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.meta.name).toBe("El club de la pelea")
    const detailsCall = fetchSpy.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("/movie/550"),
    )
    expect(detailsCall?.[0]).toContain("language=es-MX")
    expect(detailsCall?.[0]).not.toContain("es-419")
    const posterLang = new URL(body.meta.poster).searchParams.get("lang")
    expect(posterLang).toBe("es-419")
  })

  it("poster forwards es-MX to TMDB and matches es assets for ?lang=es-419", async () => {
    const poster = await imageBuffer()
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/movie/550?")) return Response.json(DETAILS_ES_MX) as unknown as Response
      if (url.includes("/movie/550/keywords")) return Response.json({ id: 550, keywords: [] }) as unknown as Response
      if (url.includes("/images?")) return Response.json(IMAGES_ES) as unknown as Response
      return new Response(new Uint8Array(poster), { headers: { "content-type": "image/png" } })
    })

    const url = "http://localhost:3000/api/poster/movie/550?api_key=k&lang=es-419&logoFit=0&debug=1"
    const res = await GET_POSTER(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: "550" }) })
    expect(res.status).toBe(200)
    const body = await res.json()

    const tmdbCalls = fetchSpy.mock.calls.map((call) => String(call[0])).filter((u) => u.includes("themoviedb.org"))
    expect(tmdbCalls.length).toBeGreaterThan(0)
    expect(tmdbCalls.some((u) => u.includes("language=es-MX"))).toBe(true)
    expect(tmdbCalls.some((u) => u.includes("es-419"))).toBe(false)
    expect(body.genre.name).toBe("Drama")
    expect(body.images.logo).toBe("/logo-es.png")
    expect(body.logoSelection.requestedLang).toBe("es-419")
    expect(body.logoSelection.usedLang).toBe("es")
  })
})
