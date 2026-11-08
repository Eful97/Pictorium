// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache, posterUrl } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { decodeConfig, encodeConfig } from "@/lib/config-token"
import { getById } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

// Controllable effective defaults: the meta handler reads them through
// getServerDefaultsChecked (no scoped user in these tests).
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

// Scoped-user propagation: a `/meta` request with `?u=<uuid>` must emit the
// same namespace in the composited image URL (the image request carries no
// session headers). The real auth store is not needed for the URL contract.
vi.mock("@/lib/user-auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-auth")>()
  return {
    ...mod,
    getScopedUserId: (raw: string | null | undefined) => (raw ? raw : null),
    userExists: vi.fn(async () => true),
    userRateLimitKey: vi.fn(() => "test"),
    touchUserActivity: vi.fn(),
  }
})

// Capture the meta cache keys so the `:et1` fragment is asserted directly
// (default OFF must not add any fragment).
const cacheKeys = vi.hoisted(() => ({ set: [] as string[], get: [] as string[] }))

vi.mock("@/lib/cache", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/cache")>()
  return {
    ...mod,
    cacheGetShared: vi.fn(async (key: string, tags: string[]) => {
      cacheKeys.get.push(key)
      return mod.cacheGetShared(key, tags)
    }),
    cacheSet: vi.fn((key: string, value: unknown, tags: string[], ttl: number) => {
      cacheKeys.set.push(key)
      return mod.cacheSet(key, value, tags, ttl)
    }),
  }
})

const mockedGetById = vi.mocked(getById)

const ORIGIN = "http://localhost:3000"

interface SeriesFixture {
  id: number
  imdbId: string
  episodes: Array<{ still?: string | null }>
  /** Episode Group payloads for remapped-ordering tests. */
  episodeGroupsResults?: unknown[]
  episodeGroupDetails?: Record<string, unknown>
}

/** Minimal series fetch graph used by the meta handler (standard ordering). */
function mockSeries(fixture: SeriesFixture) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
    const value = String(url)
    if (value.includes("/images")) {
      return Promise.resolve(Response.json({ id: fixture.id, logos: [] }))
    }
    // Singular endpoint before the plural list: `/episode_group/<id>`.
    if (value.includes("/episode_group/")) {
      return Promise.resolve(Response.json(fixture.episodeGroupDetails ?? {}))
    }
    if (value.includes("/episode_groups")) {
      return Promise.resolve(Response.json({ results: fixture.episodeGroupsResults ?? [] }))
    }
    if (value.includes("/season/1")) {
      return Promise.resolve(Response.json({
        id: fixture.id,
        season_number: 1,
        name: "Stagione 1",
        episodes: fixture.episodes.map((ep, index) => ({
          id: 1000 + index,
          season_number: 1,
          episode_number: index + 1,
          name: `Episodio ${index + 1}`,
          overview: `Trama ${index + 1}`,
          still_path: ep.still === undefined ? `/ep${index + 1}.jpg` : ep.still,
          air_date: "2024-01-01",
          vote_average: 7.5,
        })),
      }))
    }
    return Promise.resolve(Response.json({
      id: fixture.id,
      name: "Serie Thumbnail",
      overview: "Test",
      first_air_date: "2024-01-01",
      vote_average: 8.0,
      genres: [{ id: 18, name: "Dramma" }],
      backdrop_path: "/backdrop.jpg",
      external_ids: { imdb_id: fixture.imdbId },
      seasons: [{ season_number: 1, episode_count: fixture.episodes.length }],
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

async function getMeta(
  id: string,
  extraQuery = "",
  userId?: string,
): Promise<{ status: number; body: { meta: MetaLike } }> {
  const userQuery = userId ? `&u=${encodeURIComponent(userId)}` : ""
  const req = new NextRequest(`${ORIGIN}/meta/series/${id}.json?api_key=settings-key${userQuery}${extraQuery}`)
  const res = await GET(req, { params: Promise.resolve({ type: "series", id: `${id}.json` }) })
  return { status: res.status, body: await res.json() }
}

describe("meta composited episode thumbnails (opt-in)", () => {
  beforeEach(() => {
    defaultsCtl.value = {}
    cacheKeys.set.length = 0
    cacheKeys.get.length = 0
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
  })

  it("default OFF: keeps raw TMDB w500 stills and never emits /api/thumbnail", async () => {
    mockSeries({ id: 94001, imdbId: "tt9400001", episodes: [{ still: "/ep1.jpg" }, { still: "/ep2.jpg" }] })

    const { status, body } = await getMeta("tmdb:94001")

    expect(status).toBe(200)
    const videos = body.meta.videos!
    expect(videos).toHaveLength(2)
    expect(videos[0].thumbnail).toBe(posterUrl("/ep1.jpg", "w500"))
    expect(videos[1].thumbnail).toBe(posterUrl("/ep2.jpg", "w500"))
    expect(videos[0].thumbnail).not.toContain("/api/thumbnail")
  })

  it("enabled via namespace defaults: rewrites stills to the compositor URL", async () => {
    defaultsCtl.value = { episodeThumbnails: true }
    mockSeries({ id: 94002, imdbId: "tt9400002", episodes: [{ still: "/ep1.jpg" }, { still: "/ep2.jpg" }] })

    const { status, body } = await getMeta("tmdb:94002")

    expect(status).toBe(200)
    const videos = body.meta.videos!
    const thumb = new URL(videos[0].thumbnail!)
    expect(thumb.origin).toBe(ORIGIN)
    expect(thumb.pathname).toBe("/api/thumbnail/tv/94002/season/1/episode/1")
    expect(thumb.searchParams.get("still")).toBe("/ep1.jpg")
    expect(thumb.searchParams.get("w")).toBe("320")
    expect(thumb.searchParams.get("badges")).toBe("both")
    // Encoded still path stays traceable in the query (raw URL is replaced).
    expect(videos[0].thumbnail).toContain("still=%2Fep1.jpg")

    const second = new URL(videos[1].thumbnail!)
    expect(second.pathname).toBe("/api/thumbnail/tv/94002/season/1/episode/2")
    expect(second.searchParams.get("still")).toBe("/ep2.jpg")
  })

  it("mapping still override (S:E) replaces the raw still only when enabled", async () => {
    defaultsCtl.value = { episodeThumbnails: true }
    mockedGetById.mockResolvedValue({
      tmdbId: 94006,
      mediaType: "tv",
      title: "Serie Thumbnail",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2024-01-01T00:00:00.000Z",
      episodeThumbnailStills: { "1:1": "/chosen.jpg", "1:2": "/bad still.jpg" },
    })
    mockSeries({ id: 94006, imdbId: "tt9400006", episodes: [{ still: "/ep1.jpg" }, { still: "/ep2.jpg" }] })

    const { status, body } = await getMeta("tmdb:94006")

    expect(status).toBe(200)
    const videos = body.meta.videos!
    const first = new URL(videos[0].thumbnail!)
    expect(first.searchParams.get("still")).toBe("/chosen.jpg")
    // Invalid override (shared sanitizer) falls back to the episode still.
    const second = new URL(videos[1].thumbnail!)
    expect(second.searchParams.get("still")).toBe("/ep2.jpg")
  })

  it("mapping override is ignored while episode thumbnails are OFF", async () => {
    defaultsCtl.value = {}
    mockedGetById.mockResolvedValue({
      tmdbId: 94007,
      mediaType: "tv",
      title: "Serie Thumbnail",
      posterPath: "/poster.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2024-01-01T00:00:00.000Z",
      episodeThumbnailStills: { "1:1": "/chosen.jpg" },
    })
    mockSeries({ id: 94007, imdbId: "tt9400007", episodes: [{ still: "/ep1.jpg" }] })

    const { status, body } = await getMeta("tmdb:94007")

    expect(status).toBe(200)
    expect(body.meta.videos![0].thumbnail).toBe(posterUrl("/ep1.jpg", "w500"))
    expect(body.meta.videos![0].thumbnail).not.toContain("/api/thumbnail")
  })

  it("enabled via config token: same compositor URL without any secret in the response", async () => {
    mockSeries({ id: 94003, imdbId: "tt9400003", episodes: [{ still: "/ep1.jpg" }] })
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      blurEnabled: false,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: true,
      episodeThumbnails: true,
    })
    expect(decodeConfig(token)?.episodeThumbnails).toBe(true)

    const { status, body } = await getMeta("tmdb:94003", `&config=${encodeURIComponent(token)}`)

    expect(status).toBe(200)
    const thumbnail = body.meta.videos![0].thumbnail!
    const thumb = new URL(thumbnail)
    expect(thumb.pathname).toBe("/api/thumbnail/tv/94003/season/1/episode/1")
    expect(thumb.searchParams.get("still")).toBe("/ep1.jpg")
    // The TMDB key travels server-side only: never in the emitted URL.
    expect(thumbnail).not.toContain("api_key")
    expect(thumbnail).not.toContain("settings-key")
  })

  it("invalid still path falls back to the raw still (never 500 / broken URL)", async () => {
    defaultsCtl.value = { episodeThumbnails: true }
    mockSeries({ id: 94004, imdbId: "tt9400004", episodes: [{ still: "/bad still.jpg" }] })

    const { status, body } = await getMeta("tmdb:94004")

    expect(status).toBe(200)
    expect(body.meta.videos![0].thumbnail).toBe(posterUrl("/bad still.jpg", "w500"))
    expect(body.meta.videos![0].thumbnail).not.toContain("/api/thumbnail")
  })

  it("query override and cache key fragment: ON and OFF never share a cached body", async () => {
    mockSeries({ id: 94005, imdbId: "tt9400005", episodes: [{ still: "/ep1.jpg" }] })
    const first = await getMeta("tmdb:94005", "&thumbnails=1")
    expect(new URL(first.body.meta.videos![0].thumbnail!).pathname).toBe("/api/thumbnail/tv/94005/season/1/episode/1")
    const onKey = cacheKeys.set.at(-1)!
    expect(onKey).toContain(":et1")
    // Compositor URL shape v2 (original TMDB S:E path on Episode Group rows):
    // pre-fix bodies must never be reused.
    expect(onKey).toContain(":tpath2")

    // 2. Same defaults, query absent = OFF. If the :et1 fragment were missing
    //    this would be a cache hit and wrongly return the composed body.
    const second = await getMeta("tmdb:94005")
    expect(second.body.meta.videos![0].thumbnail).toBe(posterUrl("/ep1.jpg", "w500"))
    const offKey = cacheKeys.set.at(-1)!
    expect(offKey).not.toContain(":et1")
    expect(offKey).not.toContain(":et0")
    expect(offKey).not.toBe(onKey)

    // 3. ON again still resolves to the composed representation.
    const third = await getMeta("tmdb:94005", "&thumbnails=1")
    expect(new URL(third.body.meta.videos![0].thumbnail!).pathname).toBe("/api/thumbnail/tv/94005/season/1/episode/1")
  })

  it("episode-group ordering builds the compositor URL with the ORIGINAL TMDB S:E", async () => {
    // Visible group rows are remapped (S2:E17 below), but the compositor route
    // resolves the episode vote by the URL path: a visible pair that does not
    // exist on TMDB fails the ★ fallback closed (502 "TMDB episode details
    // unavailable"). The path must therefore carry the ORIGINAL TMDB pair.
    defaultsCtl.value = { episodeThumbnails: true }
    mockedGetById.mockResolvedValue({
      tmdbId: 94009,
      mediaType: "tv",
      episodeGroupId: "grp_remap",
    } as unknown as Awaited<ReturnType<typeof getById>>)
    mockSeries({
      id: 94009,
      imdbId: "tt9400009",
      episodes: [],
      episodeGroupDetails: {
        id: "grp_remap",
        name: "TVDB Order",
        groups: [
          {
            id: "p2",
            name: "Season 2",
            order: 2,
            episodes: [
              { id: 21, season_number: 1, episode_number: 25, order: 16, name: "E17", still_path: "/g17.jpg" },
            ],
          },
        ],
      },
    })

    const { status, body } = await getMeta("tmdb:94009")

    expect(status).toBe(200)
    const videos = body.meta.videos!
    expect(videos).toHaveLength(1)
    // Visible S:E stays what Stremio shows as the episode row.
    expect((videos[0] as unknown as { season: number }).season).toBe(2)
    expect((videos[0] as unknown as { episode: number }).episode).toBe(17)
    const thumb = new URL(videos[0].thumbnail!)
    expect(thumb.pathname).toBe("/api/thumbnail/tv/94009/season/1/episode/25")
    expect(thumb.searchParams.get("still")).toBe("/g17.jpg")
  })

  it("propagates the scoped user to the composited URL (multi-user image request)", async () => {
    // The thumbnail is a separate image request: it cannot carry the session
    // headers, so the namespace must travel in the URL for the route to
    // resolve the same TVDB/TMDB keys this /meta request used.
    const user = "11111111-2222-3333-4444-555555555555"
    defaultsCtl.value = { episodeThumbnails: true }
    mockSeries({ id: 94008, imdbId: "tt9400008", episodes: [{ still: "/ep1.jpg" }] })

    const { status, body } = await getMeta("tmdb:94008", "", user)

    expect(status).toBe(200)
    const thumbnail = new URL(body.meta.videos![0].thumbnail!)
    expect(thumbnail.searchParams.get("u")).toBe(user)
    // The meta cache key is already scoped, so two users never share a body.
    expect(cacheKeys.get.at(-1)).toContain(":u")
  })
})
