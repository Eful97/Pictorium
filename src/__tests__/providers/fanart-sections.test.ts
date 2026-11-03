import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { __resetFanartCache, getFanartImages, getFanartPosters } from "@/lib/fanart"
import { fanartLandscapeBaseCandidates } from "@/lib/poster-config"
import { __clearTMDBCache } from "@/lib/tmdb"
import { cacheClear } from "@/lib/cache"
import { GET } from "@/app/api/fanart/[id]/images/route"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const MOVIE_SECTIONS = {
  movieposter: [
    { id: "p1", url: "https://assets.fanart.tv/fanart/movies/500/movieposter/p.jpg", lang: "en", likes: "2" },
  ],
  moviebackground: [
    { id: "b1", url: "https://assets.fanart.tv/fanart/movies/500/moviebackground/b1.jpg", lang: "en", likes: "10" },
    { id: "b2", url: "https://assets.fanart.tv/fanart/movies/500/moviebackground/b2.jpg", lang: "00", likes: "20" },
  ],
  moviethumb: [
    { id: "t1", url: "https://assets.fanart.tv/fanart/movies/500/moviethumb/t1.jpg", lang: "en", likes: "5" },
    // Duplicate of a background URL: dedupe lives in the landscape helper.
    { id: "b1dup", url: "https://assets.fanart.tv/fanart/movies/500/moviebackground/b1.jpg", lang: "en", likes: "1" },
  ],
  hdmovielogo: [
    { id: "l1", url: "https://assets.fanart.tv/fanart/movies/500/hdmovielogo/l.png", lang: "it", likes: "7" },
  ],
  hdmovieclearart: [
    { id: "c1", url: "https://assets.fanart.tv/fanart/movies/500/hdmovieclearart/c.png", lang: "en", likes: "3" },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  process.env.PICTORIUM_FANART_KEY = "test-project-key"
  delete process.env.FANART_API_URL
  __resetFanartCache()
  __clearTMDBCache()
  cacheClear()
  vi.restoreAllMocks()
})

describe("getFanartImages", () => {
  it("returns every movie section normalized and likes-sorted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOVIE_SECTIONS))
    const images = await getFanartImages("movie", 500)
    expect(images.posters).toHaveLength(1)
    expect(images.backgrounds.map((p) => p.url)).toEqual([
      "https://assets.fanart.tv/fanart/movies/500/moviebackground/b2.jpg",
      "https://assets.fanart.tv/fanart/movies/500/moviebackground/b1.jpg",
    ])
    expect(images.thumbs).toHaveLength(2)
    expect(images.logos[0]).toMatchObject({ lang: "it", likes: 7 })
    expect(images.clearart).toHaveLength(1)
  })

  it("keeps the historical getFanartPosters contract (posters only)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOVIE_SECTIONS))
    const posters = await getFanartPosters("movie", 500)
    expect(posters).toHaveLength(1)
    expect(posters[0]?.url).toContain("/movieposter/")
  })

  it("maps the TV section names to the same logical sections", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("api.themoviedb.org")) return jsonResponse({ id: 600, tvdb_id: 700 })
      return jsonResponse({
        tvposter: [{ id: "p", url: "https://assets.fanart.tv/fanart/tv/700/tvposter/p.jpg", likes: "1" }],
        tvbackground: [{ id: "b", url: "https://assets.fanart.tv/fanart/tv/700/tvbackground/b.jpg", likes: "2" }],
        tvthumb: [{ id: "t", url: "https://assets.fanart.tv/fanart/tv/700/tvthumb/t.jpg", likes: "3" }],
        hdtvlogo: [{ id: "l", url: "https://assets.fanart.tv/fanart/tv/700/hdtvlogo/l.png", likes: "4" }],
        hdclearart: [{ id: "c", url: "https://assets.fanart.tv/fanart/tv/700/hdclearart/c.png", likes: "5" }],
      })
    })
    const images = await getFanartImages("tv", 600, { tmdbApiKey: "tmdb-key" })
    expect(images.posters).toHaveLength(1)
    expect(images.backgrounds).toHaveLength(1)
    expect(images.thumbs).toHaveLength(1)
    expect(images.logos).toHaveLength(1)
    expect(images.clearart).toHaveLength(1)
  })
})

describe("fanartLandscapeBaseCandidates", () => {
  it("orders backgrounds before thumbs and dedupes URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOVIE_SECTIONS))
    const images = await getFanartImages("movie", 500)
    const candidates = fanartLandscapeBaseCandidates(images)
    expect(candidates).toEqual([
      "https://assets.fanart.tv/fanart/movies/500/moviebackground/b2.jpg",
      "https://assets.fanart.tv/fanart/movies/500/moviebackground/b1.jpg",
      "https://assets.fanart.tv/fanart/movies/500/moviethumb/t1.jpg",
    ])
  })

  it("is empty without sections", () => {
    expect(fanartLandscapeBaseCandidates(null)).toEqual([])
    expect(fanartLandscapeBaseCandidates({ backgrounds: [], thumbs: [] })).toEqual([])
  })
})

describe("GET /api/fanart/[id]/images extra sections", () => {
  it("serves sections and landscape candidates alongside posters", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOVIE_SECTIONS))
    const res = await GET(
      new NextRequest("http://localhost/api/fanart/500/images?type=movie"),
      params("500"),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.posters).toHaveLength(1)
    expect(body.sections.backgrounds).toHaveLength(2)
    expect(body.sections.logos).toHaveLength(1)
    expect(body.sections.clearart).toHaveLength(1)
    expect(body.landscapeCandidates).toHaveLength(3)
    expect(body.source).toBe("fanart")
  })
})
