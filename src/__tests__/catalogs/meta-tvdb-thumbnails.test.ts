// @vitest-environment node
/**
 * TVDB episode stills → Stremio /meta compositor parity.
 *
 * When the space resolves episode metadata from TheTVDB, the enrichment
 * replaces the TMDB still with a TVDB cover. The composited thumbnail must
 * still carry the SAME badge params as the TMDB path and select the TVDB base
 * (`?stills=tvdb`), using the pre-enrichment TMDB still as the required
 * fail-open fallback. A miss without a TMDB fallback stays raw (never a 500).
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

const tvdbCtl = vi.hoisted(() => ({
  cover: "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/cover.jpg",
  /** When true the enrichment leaves the TMDB thumbnail untouched. */
  miss: false,
}))

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return {
    ...mod,
    enrichVideosWithTvdbDetailed: vi.fn(async (videos: Array<{ thumbnail?: string }>) => {
      if (tvdbCtl.miss) return true
      for (const video of videos) video.thumbnail = tvdbCtl.cover
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

const cacheKeys = vi.hoisted(() => ({ set: [] as string[] }))

vi.mock("@/lib/cache", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/cache")>()
  return {
    ...mod,
    cacheGetShared: vi.fn(async () => undefined),
    cacheSet: vi.fn((key: string, value: unknown, tags: string[], ttl: number) => {
      cacheKeys.set.push(key)
      return mod.cacheSet(key, value, tags, ttl)
    }),
  }
})

const mockedGetById = vi.mocked(getById)
const ORIGIN = "http://localhost:3000"
const SERIES_ID = 94500
const TVDB_KEY = "tvdb-secret-key"

function mockSeries(stills: Array<string | null>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
    const value = String(url)
    if (value.includes("/images")) return Promise.resolve(Response.json({ id: SERIES_ID, logos: [] }))
    if (value.includes("/episode_groups")) return Promise.resolve(Response.json({ results: [] }))
    if (value.includes("/season/1")) {
      return Promise.resolve(Response.json({
        id: SERIES_ID,
        season_number: 1,
        name: "Stagione 1",
        episodes: stills.map((still, index) => ({
          id: 3000 + index,
          season_number: 1,
          episode_number: index + 1,
          name: `Episodio ${index + 1}`,
          overview: `Trama ${index + 1}`,
          still_path: still,
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
      seasons: [{ season_number: 1, episode_count: stills.length }],
      credits: { cast: [], crew: [] },
      videos: { results: [] },
    }))
  })
}

interface VideoLike {
  thumbnail?: string
}
interface MetaLike {
  videos?: VideoLike[]
}

async function getMeta(extraQuery = ""): Promise<{ status: number; body: { meta: MetaLike } }> {
  const req = new NextRequest(
    `${ORIGIN}/meta/series/tmdb:${SERIES_ID}.json?api_key=settings-key&tvdb_key=${TVDB_KEY}${extraQuery}`,
  )
  const res = await GET(req, { params: Promise.resolve({ type: "series", id: `tmdb:${SERIES_ID}.json` }) })
  return { status: res.status, body: await res.json() }
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

describe("meta TVDB stills compositor parity", () => {
  beforeEach(() => {
    tvdbCtl.miss = false
    defaultsCtl.value = {}
    cacheKeys.set.length = 0
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
  })

  it("TVDB covers carry the same badge params and select the TVDB base", async () => {
    defaultsCtl.value = {
      episodeThumbnails: true,
      episodeMetadataSource: "tvdb",
      thumbnailBadgeStyle: "vetro",
      thumbnailAnchor: "bl",
      thumbnailOffsetX: 12,
      thumbnailOffsetY: -8,
      thumbnailBadgeScale: 150,
      thumbnailBlur: true,
      thumbnailVoteSource: "tmdb",
    }
    mockSeries(["/ep1.jpg"])

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    const thumbnail = body.meta.videos![0].thumbnail!
    const thumb = new URL(thumbnail)

    expect(thumb.pathname).toBe(`/api/thumbnail/tv/${SERIES_ID}/season/1/episode/1`)
    expect(thumb.searchParams.get("stills")).toBe("tvdb")
    // The pre-enrichment TMDB still stays the fail-open fallback.
    expect(thumb.searchParams.get("still")).toBe("/ep1.jpg")
    expect(thumb.searchParams.get("bstyle")).toBe("vetro")
    expect(thumb.searchParams.get("anchor")).toBe("bl")
    expect(thumb.searchParams.get("ox")).toBe("12")
    expect(thumb.searchParams.get("oy")).toBe("-8")
    expect(thumb.searchParams.get("bscale")).toBe("150")
    expect(thumb.searchParams.get("source")).toBe("tmdb")
    expect(thumb.searchParams.get("blur")).toBe("1")
    // The TVDB key is server-side only.
    expect(thumbnail).not.toContain(TVDB_KEY)
    // The TVDB base is explicit in the cache key.
    expect(cacheKeys.set.at(-1)).toContain(":tstvdb")
  })

  it("a TVDB miss with no TMDB fallback stays raw (never a 500)", async () => {
    defaultsCtl.value = { episodeThumbnails: true, episodeMetadataSource: "tvdb" }
    mockSeries([null])

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    // No pre-enrichment TMDB still: the compositor URL cannot be built, so the
    // TVDB cover is served untouched instead of a broken/500 request.
    expect(body.meta.videos![0].thumbnail).toBe(tvdbCtl.cover)
    expect(body.meta.videos![0].thumbnail).not.toContain("/api/thumbnail")
  })

  it("TMDB provider path stays byte-identical (no stills param)", async () => {
    defaultsCtl.value = { episodeThumbnails: true, episodeMetadataSource: "tmdb" }
    mockSeries(["/ep1.jpg"])

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    const thumb = paramsOf(body.meta.videos![0].thumbnail!)
    expect(thumb.get("still")).toBe("/ep1.jpg")
    expect(thumb.has("stills")).toBe(false)
    expect(cacheKeys.set.at(-1)).not.toContain(":tstvdb")
  })
})
