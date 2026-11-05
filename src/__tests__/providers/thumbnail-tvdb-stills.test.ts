// @vitest-environment node
/**
 * `?stills=tvdb`: the TVDB episode image becomes the thumbnail base with the
 * SAME badge compositing as the TMDB path.
 *
 * The third-party leg is strictly best-effort: no key, no series id, no
 * matching episode, a transport error or a non-image body all fail open to the
 * required TMDB still (never a 500). The provider is part of the render
 * identity; the TVDB API key is server-side only and never enters the client
 * URL or the cache key.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import sharp from "sharp"
import { cacheClear, cacheGet } from "@/lib/cache"
import {
  renderEpisodeThumbnail,
  sanitizeTvdbStillUrl,
  thumbnailCacheKey,
} from "@/lib/thumbnail-renderer"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/sharp-config", () => ({ initSharp: vi.fn() }))

vi.mock("@/lib/custom-rating", () => ({
  resolveCustomRatingConfig: vi.fn(() => ({ enabled: false })),
  fetchCustomRatings: vi.fn(async () => []),
}))

const tvdb = vi.hoisted(() => ({
  key: "tvdb-secret-key" as string | null,
  seriesId: 555 as number | null,
  loadThrows: false,
  episodes: [] as { id: number; name?: string; seasonNumber: number; number: number; image?: string }[],
}))

vi.mock("@/lib/tmdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...mod,
    resolveRouteApiKey: vi.fn(async (_req: unknown, kind?: string) =>
      kind === "tvdb" ? (tvdb.key ?? undefined) : "tmdb-key",
    ),
    getExternalIds: vi.fn(async () => ({ imdb_id: "tt1234567", tvdb_id: 555 })),
    getTVEpisodeDetails: vi.fn(async () => ({ vote_average: 7.3, vote_count: 10 })),
  }
})

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return {
    ...mod,
    getTvdbSeriesId: vi.fn(async () => tvdb.seriesId),
    getTvdbEpisodesResult: vi.fn(async () => {
      if (tvdb.loadThrows) throw new Error("tvdb down")
      return { episodes: tvdb.episodes, complete: true }
    }),
  }
})

const { GET } = await import("@/app/api/thumbnail/tv/[id]/season/[season]/episode/[episode]/route")

const SERIES = 123
const SEASON = 1
const EPISODE = 2
const TMDB_STILL = "/still-one.jpg"
const TVDB_STILL = "https://artworks.thetvdb.com/banners/v4/episode/1/screencap/abc.jpg"
const TVDB_KEY = "tvdb-secret-key"

const GREEN = { r: 25, g: 200, b: 90 }
const BLUE = { r: 30, g: 60, b: 200 }

let tvdbBuffer: Buffer
let tmdbBuffer: Buffer

beforeAll(async () => {
  // Solid colors so the base provider is provable from a clean corner pixel.
  tvdbBuffer = await sharp({
    create: { width: 640, height: 360, channels: 3, background: GREEN },
  }).png().toBuffer()
  tmdbBuffer = await sharp({
    create: { width: 640, height: 360, channels: 3, background: BLUE },
  }).png().toBuffer()
})

interface UpstreamOptions {
  tvdbStatus?: number
  tvdbBuffer?: Buffer
  tmdbBuffer?: Buffer
}

function mockUpstream(options: UpstreamOptions = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    if (url.includes("artworks.thetvdb.com")) {
      if (options.tvdbStatus && options.tvdbStatus >= 400) {
        return new Response("not found", { status: options.tvdbStatus })
      }
      return new Response(new Uint8Array(options.tvdbBuffer ?? tvdbBuffer), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    if (url.includes("image.tmdb.org")) {
      return new Response(new Uint8Array(options.tmdbBuffer ?? tmdbBuffer), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    return Response.json({})
  })
}

function callCount(spy: ReturnType<typeof mockUpstream>, needle: string): number {
  return spy.mock.calls.filter(([input]) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url)
    return url.includes(needle)
  }).length
}

function thumbRequest(query: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}${query}`,
    { headers: { "x-api-key": "test-key" } },
  )
}

function thumbParams() {
  return { params: Promise.resolve({ id: String(SERIES), season: String(SEASON), episode: String(EPISODE) }) }
}

interface RegionStats {
  readonly brightPixels: number
  readonly maxLum: number
}

async function regionStats(png: Buffer, x0: number, y0: number, w: number, h: number): Promise<RegionStats> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels
  let maxLum = 0
  let brightPixels = 0
  for (let y = y0; y < Math.min(y0 + h, info.height); y++) {
    for (let x = x0; x < Math.min(x0 + w, info.width); x++) {
      const i = (y * info.width + x) * channels
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      if (lum > maxLum) maxLum = lum
      if (lum > 180) brightPixels++
    }
  }
  return { brightPixels, maxLum }
}

/** RGB of a clean (badge-free) corner. */
async function cornerRgb(png: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const i = (4 * info.width + 4) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}

function key(stills?: "tmdb" | "tvdb", still = TMDB_STILL, width: 160 | 320 | 480 | 640 | 768 | 1280 = 320) {
  return thumbnailCacheKey({
    seriesId: SERIES,
    seasonNumber: SEASON,
    episodeNumber: EPISODE,
    still,
    width,
    badges: "vote",
    languages: "en,null",
    blur: false,
    voteSource: "tmdb",
    stills,
  })
}

beforeEach(() => {
  cacheClear()
  tvdb.key = TVDB_KEY
  tvdb.seriesId = 555
  tvdb.loadThrows = false
  tvdb.episodes = [{ id: 1, name: "Episode", seasonNumber: SEASON, number: EPISODE, image: TVDB_STILL }]
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
})

describe("sanitizeTvdbStillUrl", () => {
  it("accepts the exact artworks host with a raster nested path", () => {
    expect(sanitizeTvdbStillUrl(TVDB_STILL)).toBe(TVDB_STILL)
    expect(sanitizeTvdbStillUrl(" https://artworks.thetvdb.com/banners/x.png ")).toBe(
      "https://artworks.thetvdb.com/banners/x.png",
    )
    const webp = "https://artworks.thetvdb.com/banners/x.webp"
    expect(sanitizeTvdbStillUrl(webp)).toBe(webp)
  })

  it("rejects other hosts, credentials, ports, queries, traversal and non-raster paths", () => {
    expect(sanitizeTvdbStillUrl(null)).toBeNull()
    expect(sanitizeTvdbStillUrl("")).toBeNull()
    expect(sanitizeTvdbStillUrl("http://artworks.thetvdb.com/banners/x.jpg")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://evil.thetvdb.com/banners/x.jpg")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://artworks.thetvdb.com.evil.com/banners/x.jpg")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://user:pass@artworks.thetvdb.com/banners/x.jpg")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://artworks.thetvdb.com:8443/banners/x.jpg")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://artworks.thetvdb.com/banners/x.jpg?token=1")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://artworks.thetvdb.com/banners/x.svg")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://artworks.thetvdb.com/banners/../x.jpg")).toBeNull()
    expect(sanitizeTvdbStillUrl("https://artworks.thetvdb.com/banners//x.jpg")).toBeNull()
  })
})

describe("thumbnail cache identity", () => {
  it("includes the stills provider and never the TVDB key or URL", () => {
    expect(key()).toBe(key("tmdb"))
    expect(key("tvdb")).toBe(key("tvdb"))
    expect(key("tvdb")).not.toBe(key("tmdb"))
    expect(key("tvdb")).toContain(":sitvdb:")
    expect(key("tvdb")).not.toContain(TVDB_KEY)
    expect(key("tvdb")).not.toContain("artworks.thetvdb.com")
  })
})

describe("renderEpisodeThumbnail (renderer leg)", () => {
  it("uses the TVDB still as base and composites the same badge overlay", async () => {
    const spy = mockUpstream()

    const result = await renderEpisodeThumbnail({
      still: TMDB_STILL,
      stills: "tvdb",
      tvdbStill: TVDB_STILL,
      width: 320,
      badgeMode: "vote",
      voteAverage: 8.2,
      customRatings: [],
      blur: false,
    })

    expect(result.stillSource).toBe("tvdb")
    // Clean bottom-left corner is the TVDB base, not the TMDB fallback.
    const corner = await cornerRgb(result.png)
    expect(corner[1]).toBeGreaterThan(150)
    expect(corner[2]).toBeLessThan(140)
    // The badge is composited afterwards (bright pill ink top-right).
    const badge = await regionStats(result.png, 250, 0, 66, 60)
    expect(badge.brightPixels).toBeGreaterThan(10)
    expect(badge.maxLum).toBeGreaterThan(180)
    expect(callCount(spy, "image.tmdb.org")).toBe(0)
  })

  it("fails open to the TMDB still for an invalid TVDB URL", async () => {
    const spy = mockUpstream()

    const result = await renderEpisodeThumbnail({
      still: TMDB_STILL,
      stills: "tvdb",
      tvdbStill: "https://evil.example/still.jpg",
      width: 320,
      badgeMode: "vote",
      voteAverage: 8.2,
      customRatings: [],
      blur: false,
    })

    expect(result.stillSource).toBe("tmdb")
    const corner = await cornerRgb(result.png)
    expect(corner[2]).toBeGreaterThan(150)
    expect(corner[1]).toBeLessThan(140)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(0)
    expect(callCount(spy, "image.tmdb.org")).toBe(1)
  })
})

describe("GET ?stills=tvdb", () => {
  it("uses the TVDB episode image as base (badges unchanged) and never fetches the TMDB still", async () => {
    const spy = mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(TMDB_STILL)}&w=320&badges=vote&source=tmdb&stills=tvdb`), thumbParams())

    expect(res.status).toBe(200)
    const buffer = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(buffer).metadata()
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(180)
    const corner = await cornerRgb(buffer)
    expect(corner[1]).toBeGreaterThan(150)
    expect(corner[2]).toBeLessThan(140)
    const badge = await regionStats(buffer, 250, 0, 66, 60)
    expect(badge.brightPixels).toBeGreaterThan(10)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(1)
    expect(callCount(spy, "image.tmdb.org")).toBe(0)
    expect(cacheGet(key("tvdb"))).not.toBeNull()
    expect(cacheGet(key("tmdb"))).toBeNull()
  })

  it("keeps the TMDB path byte-identical when ?stills is absent (default tmdb)", async () => {
    const spy = mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(TMDB_STILL)}&w=320&badges=vote&source=tmdb`), thumbParams())

    expect(res.status).toBe(200)
    const corner = await cornerRgb(Buffer.from(await res.arrayBuffer()))
    expect(corner[2]).toBeGreaterThan(150)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(0)
    expect(callCount(spy, "image.tmdb.org")).toBe(1)
    expect(cacheGet(key())).not.toBeNull()
    expect(cacheGet(key("tvdb"))).toBeNull()
  })

  it("fails open to the TMDB still when the TVDB episode has no image", async () => {
    tvdb.episodes = []
    const spy = mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(TMDB_STILL)}&w=320&badges=vote&source=tmdb&stills=tvdb`), thumbParams())

    expect(res.status).toBe(200)
    const corner = await cornerRgb(Buffer.from(await res.arrayBuffer()))
    expect(corner[2]).toBeGreaterThan(150)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(0)
    expect(callCount(spy, "image.tmdb.org")).toBe(1)
    // The fallback is still scoped to the tvdb key, never leaked into tmdb.
    expect(cacheGet(key("tvdb"))).not.toBeNull()
    expect(cacheGet(key("tmdb"))).toBeNull()
  })

  it("fails open to the TMDB still when the TVDB image fetch fails", async () => {
    const spy = mockUpstream({ tvdbStatus: 404 })

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(TMDB_STILL)}&w=320&badges=vote&source=tmdb&stills=tvdb`), thumbParams())

    expect(res.status).toBe(200)
    const corner = await cornerRgb(Buffer.from(await res.arrayBuffer()))
    expect(corner[2]).toBeGreaterThan(150)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(1)
    expect(callCount(spy, "image.tmdb.org")).toBe(1)
  })

  it("fails open to the TMDB still when the TVDB lookup throws", async () => {
    tvdb.loadThrows = true
    const spy = mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(TMDB_STILL)}&w=320&badges=vote&source=tmdb&stills=tvdb`), thumbParams())

    expect(res.status).toBe(200)
    const corner = await cornerRgb(Buffer.from(await res.arrayBuffer()))
    expect(corner[2]).toBeGreaterThan(150)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(0)
    expect(callCount(spy, "image.tmdb.org")).toBe(1)
  })

  it("fails open without a TVDB key and never leaks the key into URL or cache key", async () => {
    tvdb.key = null
    const spy = mockUpstream()

    const res = await GET(thumbRequest(`?still=${encodeURIComponent(TMDB_STILL)}&w=320&badges=vote&source=tmdb&stills=tvdb`), thumbParams())

    expect(res.status).toBe(200)
    const corner = await cornerRgb(Buffer.from(await res.arrayBuffer()))
    expect(corner[2]).toBeGreaterThan(150)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(0)
    expect(callCount(spy, "image.tmdb.org")).toBe(1)
    expect(res.url).not.toContain(TVDB_KEY)
    expect(key("tvdb")).not.toContain(TVDB_KEY)
  })

  it("serves a second identical request from cache without re-resolving TVDB", async () => {
    const spy = mockUpstream()
    const query = `?still=${encodeURIComponent(TMDB_STILL)}&w=320&badges=vote&source=tmdb&stills=tvdb`

    const first = await GET(thumbRequest(query), thumbParams())
    expect(first.status).toBe(200)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(1)

    const second = await GET(thumbRequest(query), thumbParams())
    expect(second.status).toBe(200)
    expect(callCount(spy, "artworks.thetvdb.com")).toBe(1)
    expect(Buffer.compare(Buffer.from(await first.arrayBuffer()), Buffer.from(await second.arrayBuffer()))).toBe(0)
  })

  it("rejects an invalid stills value with 400 before any upstream call", async () => {
    const spy = mockUpstream()

    for (const value of ["", "imdb", "TVDBx", "1"]) {
      const res = await GET(
        thumbRequest(`?still=${encodeURIComponent(TMDB_STILL)}&stills=${encodeURIComponent(value)}`),
        thumbParams(),
      )
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: "Invalid stills: must be tmdb or tvdb" })
    }
    expect(spy).not.toHaveBeenCalled()
  })
})
