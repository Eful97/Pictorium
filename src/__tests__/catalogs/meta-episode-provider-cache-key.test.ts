// @vitest-environment node
/**
 * Episode provider switch (TMDB <-> TVDB) must reach `/meta`.
 *
 * The catalog-only config token minted for local-only/profileless installs
 * (`/c/<config>/...`) never carries `episodeMetadataSource`: the saved choice
 * lives in the namespace/instance defaults. The resolver therefore has to
 * follow token > defaults > key-presence; falling straight from the token to
 * "TVDB when a key exists" made the settings toggle invisible on those
 * installs (covers kept the key-derived provider) AND resolved the same `:es`
 * cache-key fragment across the switch.
 *
 * These tests exercise the real `/c/<config>/meta/...` install path with a
 * real signed/unsigned token, a configurable defaults store and a controllable
 * TVDB enrichment step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/c/[config]/meta/[type]/[id]/route"
import { encodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { getById } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

const tvdbCtl = vi.hoisted(() => ({
  cover: "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/cover.jpg",
}))

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return {
    ...mod,
    enrichVideosWithTvdbDetailed: vi.fn(async (videos: Array<{ thumbnail?: string }>) => {
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

// Title ratings are not part of this test: never touch the network for them.
vi.mock("@/lib/cinemeta", () => ({
  fetchCinemetaRating: vi.fn(async () => null),
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
const SERIES_ID = 94510
const TVDB_KEY = "tvdb-secret-key"

/**
 * A catalog-only token (the shape `/api/config-token` completes for
 * local-only/profileless installs): required visuals only, and crucially NO
 * `episodeMetadataSource` — that choice stays in the defaults.
 */
const CATALOG_ONLY_TOKEN = encodeConfig({
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: false,
  blurIntensity: 3,
  blurFade: 50,
  blurDarkness: 30,
  gradientHeight: 20,
  networkLogo: true,
  autoRotateClean: false,
  logoFitEnabled: false,
} satisfies PictoriumUserConfig)

function mockSeries() {
  vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
    const value = String(url)
    if (value.includes("/images")) return Promise.resolve(Response.json({ id: SERIES_ID, logos: [] }))
    if (value.includes("/episode_groups")) return Promise.resolve(Response.json({ results: [] }))
    if (value.includes("/season/1")) {
      return Promise.resolve(Response.json({
        id: SERIES_ID,
        season_number: 1,
        name: "Stagione 1",
        episodes: [{
          id: 3100,
          season_number: 1,
          episode_number: 1,
          name: "Episodio 1",
          overview: "Trama 1",
          still_path: "/ep1.jpg",
          air_date: "2024-01-01",
          vote_average: 7.5,
        }],
      }))
    }
    return Promise.resolve(Response.json({
      id: SERIES_ID,
      name: "Serie provider",
      overview: "Test",
      first_air_date: "2024-01-01",
      vote_average: 8.0,
      genres: [{ id: 18, name: "Dramma" }],
      backdrop_path: "/backdrop.jpg",
      external_ids: { imdb_id: "tt9451000" },
      seasons: [{ season_number: 1, episode_count: 1 }],
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

async function getMeta(withTvdbKey = true): Promise<{ status: number; body: { meta: MetaLike } }> {
  const keyQuery = withTvdbKey ? `&tvdb_key=${TVDB_KEY}` : ""
  const req = new NextRequest(
    `${ORIGIN}/c/${CATALOG_ONLY_TOKEN}/meta/series/tmdb:${SERIES_ID}.json?api_key=settings-key${keyQuery}`,
  )
  const res = await GET(req, {
    params: Promise.resolve({
      config: CATALOG_ONLY_TOKEN,
      type: "series",
      id: `tmdb:${SERIES_ID}.json`,
    }),
  })
  return { status: res.status, body: await res.json() }
}

describe("episode provider switch resolves through the defaults (config-token install)", () => {
  beforeEach(() => {
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

  it("saved TMDB provider wins over the TVDB key present on the request", async () => {
    defaultsCtl.value = { episodeMetadataSource: "tmdb" }
    mockSeries()

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    const thumbnail = body.meta.videos![0].thumbnail!
    // TMDB still, never the TVDB cover the enrichment stub would write.
    expect(thumbnail).toContain("image.tmdb.org")
    expect(thumbnail).not.toContain("artworks.thetvdb.com")
    // Resolved provider is explicit in the meta cache key.
    expect(cacheKeys.set.at(-1)).toContain(":estmdb")
    expect(cacheKeys.set.at(-1)).not.toContain(":estvdb")
  })

  it("saved TVDB provider serves TVDB covers", async () => {
    defaultsCtl.value = { episodeMetadataSource: "tvdb" }
    mockSeries()

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    expect(body.meta.videos![0].thumbnail).toBe(tvdbCtl.cover)
    expect(cacheKeys.set.at(-1)).toContain(":estvdb")
  })

  it("switching providers selects a different meta cache key (never stale)", async () => {
    defaultsCtl.value = { episodeMetadataSource: "tmdb" }
    mockSeries()
    await getMeta()
    const tmdbKey = cacheKeys.set.at(-1)!

    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
    vi.restoreAllMocks()
    defaultsCtl.value = { episodeMetadataSource: "tvdb" }
    mockSeries()
    await getMeta()
    const tvdbKey = cacheKeys.set.at(-1)!

    expect(tmdbKey).not.toBe(tvdbKey)
  })

  it("a TVDB miss keeps the TMDB cover and never a 500", async () => {
    defaultsCtl.value = { episodeMetadataSource: "tvdb" }
    mockSeries()
    const { enrichVideosWithTvdbDetailed } = await import("@/lib/tvdb")
    vi.mocked(enrichVideosWithTvdbDetailed).mockImplementationOnce(async () => true)

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    expect(body.meta.videos![0].thumbnail).toContain("image.tmdb.org")
  })

  it("TVDB selected without any key fails open to TMDB covers", async () => {
    defaultsCtl.value = { episodeMetadataSource: "tvdb" }
    mockSeries()

    const { status, body } = await getMeta(false)
    expect(status).toBe(200)
    // The provider can be requested but no key can resolve a TVDB still: the
    // TMDB path is served, no error.
    expect(body.meta.videos![0].thumbnail).toContain("image.tmdb.org")
  })
})
