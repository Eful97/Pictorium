// @vitest-environment node
/**
 * Anime filler banner on /meta episode thumbnails.
 *
 * Contract under test:
 * - `fill=manga|anime|filler|mixed` is emitted only when the space toggle is
 *   ON and the bundled snapshot classifies the episode (unknown/out-of-window
 *   → no param, so the compositor draws no banner);
 * - the absolute episode is derived from standard TMDB season numbering
 *   (`details.seasons` regular seasons, cumulative `episode_count`), or from
 *   the ORIGINAL TMDB S:E carried by an Episode Group (its visible S:E is
 *   remapped);
 * - TVDB/AniZip orderings suppress the banner: they expose no original TMDB
 *   S:E to derive a trustworthy absolute episode;
 * - the toggle travels in the meta cache key (`:fi1`) only when ON, and the
 *   OFF compositor URLs stay byte-identical to the pre-feature representation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache, posterUrl } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { __clearAnizipCache } from "@/lib/episode-ordering"
import { encodeConfig } from "@/lib/config-token"
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

/**
 * Snapshot record `t: 46260` (220 classified absolute episodes, legacy v1
 * `canon` ranges): canon 1..6, mixed 7, canon 8, mixed 9, canon 10..13,
 * mixed 14..16, canon 17, mixed 18..21, canon 22, mixed 23..24, canon 25,
 * filler 26, mixed 27..30. The resolver exposes the legacy canon ranges as
 * `manga`. Splitting it as 24 + 3 regular seasons exercises the season-offset
 * conversion (S2E1 → absolute 25, S2E2 → 26, S2E3 → 27).
 */
const FILLER_SERIES_ID = 46260
const FILLER_IMDB = "tt4626000"

interface SeasonFixture {
  season_number: number
  episode_count: number
  episodes?: number
}

interface SeriesGraph {
  id: number
  imdbId: string
  seasons: SeasonFixture[]
  episodeGroupsResults?: unknown[]
  episodeGroupDetails?: Record<string, unknown>
  anizip?: Record<string, unknown>
}

/** Minimal series fetch graph used by the meta handler. */
function mockSeriesGraph(graph: SeriesGraph) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
    const value = String(input)
    if (value.includes("api.ani.zip")) {
      return Promise.resolve(Response.json(graph.anizip ?? {}))
    }
    if (value.includes("/images")) {
      return Promise.resolve(Response.json({ id: graph.id, logos: [] }))
    }
    if (value.includes("/episode_groups")) {
      return Promise.resolve(Response.json({ results: graph.episodeGroupsResults ?? [] }))
    }
    if (value.includes("/episode_group/")) {
      return Promise.resolve(Response.json(graph.episodeGroupDetails ?? {}))
    }
    const seasonMatch = value.match(/\/season\/(\d+)/)
    if (seasonMatch) {
      const seasonNumber = Number(seasonMatch[1])
      const season = graph.seasons.find((s) => s.season_number === seasonNumber)
      const count = season?.episodes ?? season?.episode_count ?? 0
      return Promise.resolve(Response.json({
        id: graph.id,
        season_number: seasonNumber,
        name: `Stagione ${seasonNumber}`,
        episodes: Array.from({ length: count }, (_, index) => ({
          id: graph.id * 1000 + seasonNumber * 100 + index,
          season_number: seasonNumber,
          episode_number: index + 1,
          name: `Episodio ${index + 1}`,
          overview: `Trama ${index + 1}`,
          still_path: `/s${seasonNumber}e${index + 1}.jpg`,
          air_date: "2024-01-01",
          vote_average: 7.5,
        })),
      }))
    }
    return Promise.resolve(Response.json({
      id: graph.id,
      name: "Filler Series",
      overview: "Test",
      first_air_date: "2024-01-01",
      vote_average: 8.0,
      genres: [{ id: 18, name: "Dramma" }],
      backdrop_path: "/backdrop.jpg",
      external_ids: { imdb_id: graph.imdbId },
      seasons: graph.seasons.map((s) => ({
        season_number: s.season_number,
        episode_count: s.episode_count,
      })),
      credits: { cast: [], crew: [] },
      videos: { results: [] },
    }))
  })
}

interface VideoLike {
  thumbnail?: string
  season?: number
  episode?: number
}
interface MetaLike {
  videos?: VideoLike[]
}

async function getMeta(id: string, extraQuery = ""): Promise<{ status: number; body: { meta: MetaLike } }> {
  const req = new NextRequest(`${ORIGIN}/meta/series/${id}.json?api_key=settings-key${extraQuery}`)
  const res = await GET(req, { params: Promise.resolve({ type: "series", id: `${id}.json` }) })
  return { status: res.status, body: await res.json() }
}

function thumbParams(video: VideoLike): URLSearchParams {
  return new URL(video.thumbnail!, "http://localhost").searchParams
}

function fillByEpisode(body: { meta: MetaLike }): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const video of body.meta.videos ?? []) {
    out.set(`${video.season}:${video.episode}`, thumbParams(video).get("fill"))
  }
  return out
}

describe("meta anime filler banner (fill=)", () => {
  beforeEach(() => {
    defaultsCtl.value = {}
    cacheKeys.set.length = 0
    cacheKeys.get.length = 0
    mockedGetById.mockResolvedValue(null)
    __clearAnizipCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
    __clearAnizipCache()
  })

  it("derives absolute episodes across regular seasons and emits only known codes", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: true }
    mockSeriesGraph({
      id: FILLER_SERIES_ID,
      imdbId: FILLER_IMDB,
      seasons: [
        { season_number: 1, episode_count: 24 },
        { season_number: 2, episode_count: 3 },
      ],
    })

    const { status, body } = await getMeta(`tmdb:${FILLER_SERIES_ID}`)

    expect(status).toBe(200)
    const fill = fillByEpisode(body)
    // Season 1 starts at absolute 1. Legacy v1 `canon` ranges resolve to the
    // explicit manga-canon code.
    expect(fill.get("1:1")).toBe("manga")
    expect(fill.get("1:7")).toBe("mixed")
    expect(fill.get("1:24")).toBe("mixed")
    // Season 2 starts after 24 classified episodes.
    expect(fill.get("2:1")).toBe("manga")
    expect(fill.get("2:2")).toBe("filler")
    expect(fill.get("2:3")).toBe("mixed")
    // The banner toggle is part of the meta cache identity.
    expect(cacheKeys.set.at(-1)).toContain(":fi1")
  })

  it("emits fillStyle=strip only for the non-default layout", async () => {
    mockSeriesGraph({
      id: FILLER_SERIES_ID,
      imdbId: FILLER_IMDB,
      seasons: [{ season_number: 1, episode_count: 26 }],
    })

    // Default corner: no fillStyle param (pre-style URLs stay byte-identical),
    // no style fragment in the meta cache key.
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: true }
    let meta = await getMeta(`tmdb:${FILLER_SERIES_ID}`)
    const cornerVideo = (meta.body.meta.videos ?? []).find((v) => v.season === 1 && v.episode === 26)!
    expect(thumbParams(cornerVideo).get("fill")).toBe("filler")
    expect(thumbParams(cornerVideo).has("fillStyle")).toBe(false)
    expect(cacheKeys.set.at(-1)).not.toContain(":fsstrip")

    // Explicit strip: emitted per episode (token-only spaces have no namespace
    // fallback) and part of the meta cache identity.
    cacheClear()
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: true, thumbnailFillerStyle: "strip" }
    meta = await getMeta(`tmdb:${FILLER_SERIES_ID}`)
    const stripVideo = (meta.body.meta.videos ?? []).find((v) => v.season === 1 && v.episode === 26)!
    expect(thumbParams(stripVideo).get("fill")).toBe("filler")
    expect(thumbParams(stripVideo).get("fillStyle")).toBe("strip")
    expect(cacheKeys.set.at(-1)).toContain(":fsstrip")
  })

  it("default OFF keeps compositor URLs byte-identical (no fill, no :fi1)", async () => {
    mockSeriesGraph({
      id: FILLER_SERIES_ID,
      imdbId: FILLER_IMDB,
      seasons: [{ season_number: 1, episode_count: 3 }],
    })

    defaultsCtl.value = { episodeThumbnails: true }
    const absent = await getMeta(`tmdb:${FILLER_SERIES_ID}`)
    const absentKey = cacheKeys.set.at(-1)!
    for (const video of absent.body.meta.videos ?? []) {
      expect(thumbParams(video).has("fill")).toBe(false)
    }
    expect(absentKey).not.toContain(":fi1")

    // Explicit false must stay the same representation as absent.
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: false }
    const explicitOff = await getMeta(`tmdb:${FILLER_SERIES_ID}`)
    expect(cacheKeys.set.at(-1)).not.toContain(":fi1")
    expect(explicitOff.body.meta.videos).toEqual(absent.body.meta.videos)
  })

  it("unknown titles never get a fill param even with the toggle ON", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: true }
    mockSeriesGraph({
      id: 94001,
      imdbId: "tt9400001",
      seasons: [{ season_number: 1, episode_count: 2 }],
    })

    const { body } = await getMeta("tmdb:94001")

    for (const video of body.meta.videos ?? []) {
      expect(video.thumbnail).toContain("/api/thumbnail")
      expect(thumbParams(video).has("fill")).toBe(false)
    }
    // The toggle still identifies the representation (no stale body reuse).
    expect(cacheKeys.set.at(-1)).toContain(":fi1")
  })

  it("episode-group ordering resolves the banner through the ORIGINAL TMDB S:E", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: true }
    mockedGetById.mockResolvedValue({ episodeGroupId: "grp_filler" } as unknown as Awaited<ReturnType<typeof getById>>)
    mockSeriesGraph({
      id: FILLER_SERIES_ID,
      imdbId: FILLER_IMDB,
      seasons: [{ season_number: 1, episode_count: 2 }],
      episodeGroupDetails: {
        id: "grp_filler",
        name: "Parts",
        groups: [
          // Visible rows are remapped to S1:E1 / S2:E1; the original TMDB
          // numbering is S1:E26 (filler) / S1:E27 (mixed).
          { id: "p1", name: "Parte 1", order: 1, episodes: [{ id: 1, season_number: 1, episode_number: 26, order: 0, name: "E1", still_path: "/g1.jpg" }] },
          { id: "p2", name: "Parte 2", order: 2, episodes: [{ id: 2, season_number: 1, episode_number: 27, order: 0, name: "E2", still_path: "/g2.jpg" }] },
        ],
      },
    })

    const { body } = await getMeta(`tmdb:${FILLER_SERIES_ID}`)

    expect(body.meta.videos).toHaveLength(2)
    const bySeason = new Map((body.meta.videos ?? []).map((video) => [video.season, video]))
    // If the visible S:E were used instead, part 1 would resolve absolute 1
    // (manga) and part 2 would be out of window (no fill). The banner proves
    // the original pair is the source of truth.
    expect(thumbParams(bySeason.get(1)!).get("fill")).toBe("filler")
    expect(thumbParams(bySeason.get(2)!).get("fill")).toBe("mixed")
  })

  it("tvdb ordering suppresses the banner", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: true }
    mockedGetById.mockResolvedValue({ episodeGroupId: "tvdb" } as unknown as Awaited<ReturnType<typeof getById>>)
    mockSeriesGraph({
      id: FILLER_SERIES_ID,
      imdbId: FILLER_IMDB,
      seasons: [{ season_number: 1, episode_count: 2 }],
    })

    const { body } = await getMeta(`tmdb:${FILLER_SERIES_ID}`)

    // TVDB ordering failed open to standard videos (no TVDB key): they are
    // still standard S:E, but the explicit ordering choice must not be
    // second-guessed by heuristics.
    expect(body.meta.videos).toHaveLength(2)
    for (const video of body.meta.videos ?? []) {
      expect(video.thumbnail).toContain("/api/thumbnail")
      expect(thumbParams(video).has("fill")).toBe(false)
    }
  })

  it("anizip ordering suppresses the banner", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailFillerBadge: true }
    mockedGetById.mockResolvedValue({ episodeGroupId: "anizip" } as unknown as Awaited<ReturnType<typeof getById>>)
    mockSeriesGraph({
      id: FILLER_SERIES_ID,
      imdbId: FILLER_IMDB,
      seasons: [{ season_number: 1, episode_count: 2 }],
      anizip: {
        episodes: {
          "1": { seasonNumber: 1, episodeNumber: 1, title: { en: "E1" }, image: posterUrl("/ani1.jpg", "w500") },
          "2": { seasonNumber: 1, episodeNumber: 2, title: { en: "E2" }, image: posterUrl("/ani2.jpg", "w500") },
        },
      },
    })

    const { body } = await getMeta(`tmdb:${FILLER_SERIES_ID}`)

    expect(body.meta.videos).toHaveLength(2)
    for (const video of body.meta.videos ?? []) {
      expect(video.thumbnail).toContain("/api/thumbnail")
      expect(thumbParams(video).has("fill")).toBe(false)
    }
  })

  it("config token enables the banner and the emitted code is self-contained", async () => {
    mockSeriesGraph({
      id: FILLER_SERIES_ID,
      imdbId: FILLER_IMDB,
      seasons: [
        { season_number: 1, episode_count: 24 },
        { season_number: 2, episode_count: 3 },
      ],
    })
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
      thumbnailFillerBadge: true,
    })

    const { body } = await getMeta(`tmdb:${FILLER_SERIES_ID}`, `&config=${encodeURIComponent(token)}`)

    const fill = fillByEpisode(body)
    expect(fill.get("2:2")).toBe("filler")
    // The image request is self-contained: no config token / API key leaks.
    const thumbnail = body.meta.videos!.find((v) => v.season === 2 && v.episode === 2)!.thumbnail!
    expect(thumbnail).not.toContain("config=")
    expect(thumbnail).not.toContain("api_key")
    expect(thumbnail).not.toContain("settings-key")
    expect(cacheKeys.set.at(-1)).toContain(":fi1")
  })
})
