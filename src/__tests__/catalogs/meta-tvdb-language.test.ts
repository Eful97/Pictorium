// @vitest-environment node
/**
 * `/meta` must pass the RESOLVED content language to TVDB, not a hard-coded
 * `ita`.
 *
 * The fix ("Episode titles follow the selected language") maps the request
 * language to a TVDB ISO 639-2 code and feeds BOTH TVDB entry points:
 * - explicit TVDB ordering (`episodeGroupId: "tvdb"` ->
 *   `buildVideosFromTvdbDetailed`)
 * - TVDB episode enrichment (`episodeMetadataSource: "tvdb"` ->
 *   `enrichVideosWithTvdbDetailed`)
 *
 * The mapper itself is covered by `providers/tvdb.test.ts`; this suite covers
 * the WIRING at meta-handler.ts:939/1072, which is what a regression would
 * silently break (episode titles back to Italian for every UI language).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { getById } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

const orderingCtl = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock("@/lib/episode-ordering", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/episode-ordering")>()
  return {
    ...mod,
    buildVideosFromTvdbDetailed: vi.fn(async (...args: unknown[]) => {
      orderingCtl.calls.push(args)
      return {
        videos: [{ id: "tt9450000:1:1", name: "TVDB S1E1", season: 1, episode: 1 }],
        complete: true,
      }
    }),
  }
})

const enrichCtl = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return {
    ...mod,
    enrichVideosWithTvdbDetailed: vi.fn(async (...args: unknown[]) => {
      enrichCtl.calls.push(args)
      return true
    }),
  }
})

const defaultsCtl = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => defaultsCtl.value),
    getServerDefaultsChecked: vi.fn(async () => defaultsCtl.value),
    getServerDefaultsForUser: vi.fn(async () => defaultsCtl.value),
  }
})

vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => "e1"),
  bumpCatalogEpoch: vi.fn(async () => "e1"),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/cinemeta", () => ({
  fetchCinemetaRating: vi.fn(async () => null),
}))

const mockedGetById = vi.mocked(getById)
const ORIGIN = "http://localhost:3000"
const SERIES_ID = 94500
const TVDB_KEY = "tvdb-secret-key"

function mockSeries(episodes: number) {
  vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
    const value = String(url)
    if (value.includes("/images")) return Promise.resolve(Response.json({ id: SERIES_ID, logos: [] }))
    if (value.includes("/episode_groups")) return Promise.resolve(Response.json({ results: [] }))
    if (value.includes("/season/1")) {
      return Promise.resolve(Response.json({
        id: SERIES_ID,
        season_number: 1,
        name: "Stagione 1",
        episodes: Array.from({ length: episodes }, (_, index) => ({
          id: 3000 + index,
          season_number: 1,
          episode_number: index + 1,
          name: `Episodio ${index + 1}`,
          overview: `Trama ${index + 1}`,
          still_path: null,
          air_date: "2024-01-01",
          vote_average: 7.5,
        })),
      }))
    }
    return Promise.resolve(Response.json({
      id: SERIES_ID,
      name: "Serie TVDB",
      overview: "Test",
      first_air_date: "2024-01-01",
      vote_average: 8.0,
      genres: [{ id: 18, name: "Dramma" }],
      backdrop_path: "/backdrop.jpg",
      external_ids: { imdb_id: "tt9450000" },
      seasons: [{ season_number: 1, episode_count: episodes }],
      credits: { cast: [], crew: [] },
      videos: { results: [] },
    }))
  })
}

async function getMeta(query: string): Promise<{ status: number; body: { meta: { videos?: unknown[] } } }> {
  const req = new NextRequest(
    `${ORIGIN}/meta/series/tmdb:${SERIES_ID}.json?api_key=settings-key&tvdb_key=${TVDB_KEY}${query}`,
  )
  const res = await GET(req, { params: Promise.resolve({ type: "series", id: `tmdb:${SERIES_ID}.json` }) })
  return { status: res.status, body: await res.json() }
}

describe("meta TVDB language wiring", () => {
  beforeEach(() => {
    orderingCtl.calls.length = 0
    enrichCtl.calls.length = 0
    defaultsCtl.value = {}
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
  })

  it("explicit TVDB ordering receives the TVDB code of the request language", async () => {
    mockedGetById.mockResolvedValue({ episodeGroupId: "tvdb" } as unknown as Awaited<ReturnType<typeof getById>>)
    mockSeries(1)

    const { status, body } = await getMeta("&lang=es&region=IT")
    expect(status).toBe(200)
    expect(body.meta.videos).toHaveLength(1)
    expect(orderingCtl.calls).toHaveLength(1)
    // (imdbId, tmdbId, primaryId, tvdbApiKey, seasonType, apiKey, signal, language)
    expect(orderingCtl.calls[0]![7]).toBe("spa")
  })

  it("TVDB enrichment receives the TVDB code of the request language", async () => {
    defaultsCtl.value = { episodeMetadataSource: "tvdb" }
    mockSeries(2)

    const { status, body } = await getMeta("&lang=de&region=IT")
    expect(status).toBe(200)
    expect(body.meta.videos).toHaveLength(2)
    expect(enrichCtl.calls).toHaveLength(1)
    // (videos, imdbId, tmdbId, tvdbApiKey, language, tmdbApiKey, signal)
    expect(enrichCtl.calls[0]![4]).toBe("deu")
  })
})
