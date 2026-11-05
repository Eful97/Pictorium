// @vitest-environment node
/**
 * Miniature settings → Stremio /meta parity.
 *
 * The settings preview always emitted `bstyle`/`anchor`/`ox`/`oy`/`source`/
 * `blur`; before this feature they were session-only. Persisted defaults must
 * reach the /meta composited URL with the same values (WYSIWYG), and every
 * value must be part of the meta cache key so a change can never serve a
 * stale Stremio body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache, posterUrl } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { encodeConfig } from "@/lib/config-token"
import { getById } from "@/lib/store"
import { buildThumbnailPreviewUrl } from "@/components/settings/thumbnail-preview"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

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
const SERIES_ID = 94100

function mockSeries(episodes = 1) {
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
          id: 2000 + index,
          season_number: 1,
          episode_number: index + 1,
          name: `Episodio ${index + 1}`,
          overview: `Trama ${index + 1}`,
          still_path: `/ep${index + 1}.jpg`,
          air_date: "2024-01-01",
          vote_average: 7.5,
        })),
      }))
    }
    return Promise.resolve(Response.json({
      id: SERIES_ID,
      name: "Serie Thumbnail",
      overview: "Test",
      first_air_date: "2024-01-01",
      vote_average: 8.0,
      genres: [{ id: 18, name: "Dramma" }],
      backdrop_path: "/backdrop.jpg",
      external_ids: { imdb_id: "tt9410000" },
      seasons: [{ season_number: 1, episode_count: episodes }],
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
  const req = new NextRequest(`${ORIGIN}/meta/series/tmdb:${SERIES_ID}.json?api_key=settings-key${extraQuery}`)
  const res = await GET(req, { params: Promise.resolve({ type: "series", id: `tmdb:${SERIES_ID}.json` }) })
  return { status: res.status, body: await res.json() }
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

const THUMBNAIL_PARAM_KEYS = ["bstyle", "anchor", "ox", "oy", "bscale", "source", "blur"] as const

describe("meta Miniature settings (persisted WYSIWYG)", () => {
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

  it("persisted choices reach /meta with the same values as the preview builder", async () => {
    defaultsCtl.value = {
      episodeThumbnails: true,
      thumbnailBadgeStyle: "vetro",
      thumbnailAnchor: "bl",
      thumbnailOffsetX: 12,
      thumbnailOffsetY: -8,
      thumbnailBadgeScale: 150,
      thumbnailBlur: true,
      thumbnailVoteSource: "tmdb",
    }
    mockSeries()

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    const thumbnail = body.meta.videos![0].thumbnail!
    const meta = paramsOf(thumbnail)

    const preview = paramsOf(
      buildThumbnailPreviewUrl({
        demoMedia: { mediaType: "tv", id: SERIES_ID, title: "Serie Thumbnail" },
        still: "/ep1.jpg",
        badgeStyle: "vetro",
        anchor: "bl",
        offsetX: 12,
        offsetY: -8,
        badgeScale: 150,
        blur: true,
        voteSource: "tmdb",
        showBadges: true,
        badgesEnabled: true,
      }),
    )

    for (const key of THUMBNAIL_PARAM_KEYS) {
      expect(meta.get(key)).toBe(preview.get(key))
    }
    expect(meta.get("bstyle")).toBe("vetro")
    expect(meta.get("anchor")).toBe("bl")
    expect(meta.get("ox")).toBe("12")
    expect(meta.get("oy")).toBe("-8")
    expect(meta.get("bscale")).toBe("150")
    expect(meta.get("source")).toBe("tmdb")
    expect(meta.get("blur")).toBe("1")
    // Never a secret in the emitted URL.
    expect(thumbnail).not.toContain("api_key")
    expect(thumbnail).not.toContain("settings-key")
  })

  it("carries the naked style to /meta and the preview builder", async () => {
    defaultsCtl.value = {
      episodeThumbnails: true,
      thumbnailBadgeStyle: "naked",
      thumbnailAnchor: "tr",
      thumbnailOffsetX: 0,
      thumbnailOffsetY: 0,
      thumbnailBadgeScale: 100,
      thumbnailBlur: false,
      thumbnailVoteSource: "imdb",
    }
    mockSeries()

    const { body } = await getMeta()
    const meta = paramsOf(body.meta.videos![0].thumbnail!)
    const preview = paramsOf(
      buildThumbnailPreviewUrl({
        demoMedia: { mediaType: "tv", id: SERIES_ID, title: "Serie Thumbnail" },
        still: "/ep1.jpg",
        badgeStyle: "naked",
        showBadges: true,
        badgesEnabled: true,
      }),
    )

    expect(meta.get("bstyle")).toBe("naked")
    expect(preview.get("bstyle")).toBe("naked")
    // Naked style is part of the meta cache identity (never a stale pill body).
    expect(cacheKeys.get.at(-1)).toContain(":tbnaked")
  })

  it("carries the score style to /meta and the preview builder", async () => {
    defaultsCtl.value = {
      episodeThumbnails: true,
      thumbnailBadgeStyle: "score",
      thumbnailAnchor: "tr",
      thumbnailOffsetX: 0,
      thumbnailOffsetY: 0,
      thumbnailBadgeScale: 100,
      thumbnailBlur: false,
      thumbnailVoteSource: "imdb",
    }
    mockSeries()

    const { body } = await getMeta()
    const meta = paramsOf(body.meta.videos![0].thumbnail!)
    const preview = paramsOf(
      buildThumbnailPreviewUrl({
        demoMedia: { mediaType: "tv", id: SERIES_ID, title: "Serie Thumbnail" },
        still: "/ep1.jpg",
        badgeStyle: "score",
        showBadges: true,
        badgesEnabled: true,
      }),
    )

    expect(meta.get("bstyle")).toBe("score")
    expect(preview.get("bstyle")).toBe("score")
    // Score style is part of the meta cache identity (never a stale pill body).
    expect(cacheKeys.get.at(-1)).toContain(":tbscore")
  })

  it("fresh defaults = pill / tr / 0 / 0 / no blur / imdb", async () => {
    defaultsCtl.value = { episodeThumbnails: true }
    mockSeries()

    const { body } = await getMeta()
    const params = paramsOf(body.meta.videos![0].thumbnail!)
    expect(params.get("bstyle")).toBe("pill")
    expect(params.get("anchor")).toBe("tr")
    expect(params.get("ox")).toBe("0")
    expect(params.get("oy")).toBe("0")
    expect(params.get("bscale")).toBe("100")
    expect(params.get("source")).toBe("imdb")
    expect(params.has("blur")).toBe(false)
    // Same fresh-default request as the preview builder.
    const preview = paramsOf(
      buildThumbnailPreviewUrl({
        demoMedia: { mediaType: "tv", id: SERIES_ID, title: "Serie Thumbnail" },
        still: "/ep1.jpg",
        showBadges: true,
        badgesEnabled: true,
      }),
    )
    for (const key of THUMBNAIL_PARAM_KEYS) {
      expect(params.get(key)).toBe(preview.get(key))
    }
  })

  it("config token overrides defaults, explicit query overrides the token", async () => {
    defaultsCtl.value = {
      episodeThumbnails: true,
      thumbnailBadgeStyle: "pill",
      thumbnailAnchor: "tr",
      thumbnailOffsetX: 0,
      thumbnailOffsetY: 0,
      thumbnailBadgeScale: 100,
      thumbnailBlur: false,
      thumbnailVoteSource: "imdb",
    }
    mockSeries()
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
      thumbnailBadgeStyle: "bordo",
      thumbnailAnchor: "tl",
      thumbnailOffsetX: 3,
      thumbnailOffsetY: 4,
      thumbnailBadgeScale: 175,
      thumbnailBlur: true,
      thumbnailVoteSource: "tmdb",
    })

    const fromToken = await getMeta(`&config=${encodeURIComponent(token)}`)
    const tokenParams = paramsOf(fromToken.body.meta.videos![0].thumbnail!)
    expect(tokenParams.get("bstyle")).toBe("bordo")
    expect(tokenParams.get("anchor")).toBe("tl")
    expect(tokenParams.get("ox")).toBe("3")
    expect(tokenParams.get("oy")).toBe("4")
    expect(tokenParams.get("bscale")).toBe("175")
    expect(tokenParams.get("source")).toBe("tmdb")
    expect(tokenParams.get("blur")).toBe("1")

    const fromQuery = await getMeta(
      `&config=${encodeURIComponent(token)}&bstyle=branded&anchor=br&ox=-5&oy=7&bscale=120&source=imdb&blur=0`,
    )
    const queryParams = paramsOf(fromQuery.body.meta.videos![0].thumbnail!)
    expect(queryParams.get("bstyle")).toBe("branded")
    expect(queryParams.get("anchor")).toBe("br")
    expect(queryParams.get("ox")).toBe("-5")
    expect(queryParams.get("oy")).toBe("7")
    expect(queryParams.get("bscale")).toBe("120")
    expect(queryParams.get("source")).toBe("imdb")
    expect(queryParams.has("blur")).toBe(false)
  })

  it("every persisted choice changes the meta cache key (no stale mix)", async () => {
    const base = {
      episodeThumbnails: true,
      thumbnailBadgeStyle: "pill",
      thumbnailAnchor: "tr",
      thumbnailOffsetX: 0,
      thumbnailOffsetY: 0,
      thumbnailBadgeScale: 100,
      thumbnailBlur: false,
      thumbnailVoteSource: "imdb",
    }
    mockSeries()
    defaultsCtl.value = base
    await getMeta()
    const baseline = cacheKeys.get.at(-1)!
    expect(baseline).toContain(":et1")
    expect(baseline).toContain(":tbpill")

    const variants: Array<Record<string, unknown>> = [
      { thumbnailBadgeStyle: "bordo" },
      { thumbnailBadgeStyle: "naked" },
      { thumbnailBadgeStyle: "score" },
      { thumbnailAnchor: "bl" },
      { thumbnailOffsetX: 5 },
      { thumbnailOffsetY: -5 },
      { thumbnailBadgeScale: 150 },
      { thumbnailBlur: true },
      { thumbnailVoteSource: "tmdb" },
    ]
    const keys = new Set<string>([baseline])
    for (const patch of variants) {
      defaultsCtl.value = { ...base, ...patch }
      await getMeta()
      const key = cacheKeys.get.at(-1)!
      expect(key).not.toBe(baseline)
      expect(keys.has(key)).toBe(false)
      keys.add(key)
    }
    expect(keys.size).toBe(variants.length + 1)
  })

  it("master OFF keeps the raw TMDB still and the historical cache key", async () => {
    defaultsCtl.value = {
      thumbnailBadgeStyle: "vetro",
      thumbnailAnchor: "bl",
      thumbnailOffsetX: 9,
      thumbnailOffsetY: -9,
      thumbnailBlur: true,
      thumbnailVoteSource: "tmdb",
    }
    mockSeries()

    const { body } = await getMeta()
    expect(body.meta.videos![0].thumbnail).toBe(posterUrl("/ep1.jpg", "w500"))
    expect(body.meta.videos![0].thumbnail).not.toContain("/api/thumbnail")
    const key = cacheKeys.get.at(-1)!
    expect(key).not.toContain(":et1")
    expect(key).not.toContain(":tb")
  })
})
