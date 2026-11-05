// @vitest-environment node
/**
 * `?rotate=1` wiring on the episode-thumbnail route.
 *
 * The day bucket is the shared poster rotation bucket (02:00 UTC cut). The
 * route must select the day's still from the episode `/images` list, keep the
 * selected still/bucket in the cache identity, and fail open to the fixed
 * `?still` (never a 500) when the list is unusable or the upstream fails.
 * Rotation OFF must stay byte-identical to the historical fixed-still render.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import sharp from "sharp"
import { __clearTMDBCache, __resetKey401Cache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { cacheClear } from "@/lib/cache"
import { thumbnailRotationBucket } from "@/lib/thumbnail-renderer"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const { GET } = await import("@/app/api/thumbnail/tv/[id]/season/[season]/episode/[episode]/route")

const SERIES = 123
const SEASON = 1
const EPISODE = 2
const FIXED_STILL = "/still-fixed.jpg"
const DAY = 24 * 60 * 60 * 1000
/** 2026-10-01T02:00:00Z: exactly at the 02:00 UTC cut. */
const AT_CUT = Date.UTC(2026, 9, 1, 2, 0, 0)

const buffers = new Map<string, Buffer>()

beforeAll(async () => {
  buffers.set(FIXED_STILL, await solid(30, 60, 90))
  buffers.set("/rot-a.jpg", await solid(190, 40, 40))
  buffers.set("/rot-b.jpg", await solid(40, 180, 60))
  buffers.set("/rot-c.jpg", await solid(50, 60, 200))
})

async function solid(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 180, channels: 3, background: { r, g, b } } }).png().toBuffer()
}

interface UpstreamOptions {
  imagesStatus?: number
  stills?: string[]
}

function mockUpstream(options: UpstreamOptions = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
    if (url.includes("image.tmdb.org")) {
      const path = new URL(url).pathname.replace(/^\/t\/p\/[^/]+/, "")
      return new Response(new Uint8Array(buffers.get(path) ?? buffers.get(FIXED_STILL)!), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    // Episode `/images`: must be matched before the episode-details route.
    if (/\/tv\/\d+\/season\/\d+\/episode\/\d+\/images/.test(url)) {
      if (options.imagesStatus && options.imagesStatus >= 400) {
        return new Response("upstream failed", { status: options.imagesStatus })
      }
      const stills = options.stills ?? [FIXED_STILL, "/rot-a.jpg", "/rot-b.jpg", "/rot-c.jpg"]
      return Response.json({
        id: SERIES,
        stills: stills.map((file_path) => ({ file_path, width: 320, height: 180 })),
      })
    }
    if (url.includes("/external_ids")) {
      return Response.json({ id: SERIES, imdb_id: "tt1234567" })
    }
    if (/\/tv\/\d+\/season\/\d+\/episode\/\d+/.test(url)) {
      return Response.json({
        id: 9001,
        episode_number: EPISODE,
        season_number: SEASON,
        name: "Episode",
        vote_average: 7.3,
        vote_count: 42,
      })
    }
    if (url.includes("/tv/")) {
      return Response.json({ id: SERIES, vote_average: 8.9, vote_count: 100, genres: [] })
    }
    return Response.json({})
  })
}

function request(query: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/thumbnail/tv/${SERIES}/season/${SEASON}/episode/${EPISODE}?still=${encodeURIComponent(FIXED_STILL)}&w=320&badges=both&source=tmdb${query}`,
    { headers: { "x-api-key": "test-key" } },
  )
}

function params() {
  return { params: Promise.resolve({ id: String(SERIES), season: String(SEASON), episode: String(EPISODE) }) }
}

async function render(query: string): Promise<{ status: number; png: Buffer }> {
  const res = await GET(request(query), params())
  return { status: res.status, png: Buffer.from(await res.arrayBuffer()) }
}

function stillFetchPaths(spy: ReturnType<typeof mockUpstream>): string[] {
  return spy.mock.calls
    .map(([input]) => String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url))
    .filter((url) => url.includes("image.tmdb.org"))
    .map((url) => new URL(url).pathname.replace(/^\/t\/p\/[^/]+/, ""))
}

let nowSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  cacheClear()
  __clearTMDBCache()
  __resetKey401Cache()
  __clearImdbCache()
  nowSpy = vi.spyOn(Date, "now").mockReturnValue(AT_CUT)
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  __clearTMDBCache()
  __resetKey401Cache()
  __clearImdbCache()
})

describe("thumbnail route ?rotate", () => {
  it("rejects garbage with 400 (never a render)", async () => {
    const fetchSpy = mockUpstream()
    const { status } = await render("&rotate=2")
    expect(status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("OFF keeps the historical fixed still and bytes", async () => {
    const fetchSpy = mockUpstream()
    const fixed = await render("")
    expect(fixed.status).toBe(200)
    expect(stillFetchPaths(fetchSpy)).toContain(FIXED_STILL)
    expect(stillFetchPaths(fetchSpy)).not.toContain("/rot-a.jpg")

    cacheClear()
    nowSpy.mockReturnValue(AT_CUT + 3 * DAY)
    const later = await render("")
    expect(later.status).toBe(200)
    expect(later.png.equals(fixed.png)).toBe(true)
  })

  it("same day ⇒ same rotated still; next day advances; full cycle wraps", async () => {
    mockUpstream()
    nowSpy.mockReturnValue(AT_CUT)
    const day1 = await render("&rotate=1")
    expect(day1.status).toBe(200)

    // Same 02:00→02:00 window, even with a fresh cache: same still, same bytes.
    cacheClear()
    nowSpy.mockReturnValue(AT_CUT + DAY - 1)
    const day1Again = await render("&rotate=1")
    expect(day1Again.png.equals(day1.png)).toBe(true)

    cacheClear()
    nowSpy.mockReturnValue(AT_CUT + DAY)
    const day2 = await render("&rotate=1")
    expect(day2.png.equals(day1.png)).toBe(false)

    // One full candidate-list length later the first still comes back.
    cacheClear()
    nowSpy.mockReturnValue(AT_CUT + 4 * DAY)
    const wrapped = await render("&rotate=1")
    expect(wrapped.png.equals(day1.png)).toBe(true)
  })

  it("uses the 02:00 UTC bucket of the shared poster rotation", () => {
    expect(thumbnailRotationBucket(AT_CUT)).toBe(thumbnailRotationBucket(AT_CUT + DAY - 1))
    expect(thumbnailRotationBucket(AT_CUT)).toBe(thumbnailRotationBucket(AT_CUT - 1) + 1)
  })

  it("fails open to the fixed still when the list endpoint errors (never 500)", async () => {
    const fetchSpy = mockUpstream({ imagesStatus: 500 })
    const res = await render("&rotate=1")
    expect(res.status).toBe(200)
    expect(stillFetchPaths(fetchSpy)).toContain(FIXED_STILL)
  })

  it("fails open to the fixed still when the list is empty", async () => {
    const fetchSpy = mockUpstream({ stills: [] })
    const res = await render("&rotate=1")
    expect(res.status).toBe(200)
    expect(stillFetchPaths(fetchSpy)).toContain(FIXED_STILL)
  })
})
