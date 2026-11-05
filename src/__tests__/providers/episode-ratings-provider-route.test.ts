// @vitest-environment node
/**
 * Route wiring of the episode-ratings provider registry.
 *
 * Proves the end-to-end contract of the thumbnail ★:
 * - default = ShowGrid IMDb poll (`X-Pictorium-Vote-Source: imdb`);
 * - a ShowGrid miss/error fails open to the TMDB episode vote (`tmdb`);
 * - Cinemeta is never fetched on the episode path;
 * - an opt-in provider without ack/URL is served by ShowGrid and disclosed as
 *   `imdb-fallback` (never silently labelled `imdb`);
 * - an acknowledged-but-unimplemented provider fails closed to the TMDB
 *   episode vote, and `off` does the same without consulting ShowGrid.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/sharp-config", () => ({ initSharp: vi.fn() }))

const upstream = vi.hoisted(() => ({
  showgridRating: 9.1 as number | null,
  throwShowgrid: false,
  tmdbVote: 6.1,
  renderInputs: [] as { voteAverage: number; voteSource?: string }[],
  showgridCalls: 0,
  cinemetaFetches: [] as string[],
}))

vi.mock("@/lib/imdb-cache", () => ({
  resolveImdbId: vi.fn(async () => "tt0903747"),
}))

vi.mock("@/lib/showgrid-episode-ratings", () => ({
  fetchShowgridEpisodeRatings: vi.fn(async () => {
    upstream.showgridCalls++
    if (upstream.throwShowgrid) throw new Error("showgrid outage")
    return new Map(
      upstream.showgridRating === null
        ? []
        : [["1:1", { rating: upstream.showgridRating, votes: 12345 }]],
    )
  }),
}))

vi.mock("@/lib/tmdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...mod,
    resolveRouteApiKey: vi.fn(async () => "test-key"),
    getTVEpisodeDetails: vi.fn(async () => ({ vote_average: upstream.tmdbVote })),
  }
})

vi.mock("@/lib/custom-rating", () => ({
  resolveCustomRatingConfig: vi.fn(() => ({ enabled: false })),
  fetchCustomRatings: vi.fn(async () => []),
}))

vi.mock("@/lib/thumbnail-renderer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/thumbnail-renderer")>()
  return {
    ...mod,
    renderEpisodeThumbnail: vi.fn(async (input: { width: number; voteAverage: number; voteSource?: string }) => {
      upstream.renderInputs.push({ voteAverage: input.voteAverage, voteSource: input.voteSource })
      return {
        png: Buffer.from("fake-png"),
        w: input.width,
        h: 180,
        rendered: { vote: true, custom: false },
        voteSource: input.voteSource ?? "imdb",
        geometry: { left: 8, top: 8, w: 100, h: 30 },
      }
    }),
  }
})

const { GET } = await import("@/app/api/thumbnail/tv/[id]/season/[season]/episode/[episode]/route")

function request(): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/thumbnail/tv/1396/season/1/episode/1?still=%2Fstill.jpg&w=320&badges=vote&source=imdb",
  )
}

const params = () => ({ params: Promise.resolve({ id: "1396", season: "1", episode: "1" }) })

function lastRender() {
  return upstream.renderInputs[upstream.renderInputs.length - 1]!
}

/** No Cinemeta request may escape the episode path, mocked or not. */
function cinemetaFetches(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("cinemeta") || url.includes("strem.io"))
}

let globalFetch: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  cacheClear()
  upstream.showgridRating = 9.1
  upstream.throwShowgrid = false
  upstream.renderInputs = []
  upstream.showgridCalls = 0
  upstream.cinemetaFetches = []
  globalFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({}))
  delete process.env.PICTORIUM_EPISODE_RATINGS_PROVIDER
  delete process.env.PICTORIUM_NON_COMMERCIAL_ACK
  delete process.env.PICTORIUM_SERIESGRAPH_URL
  delete process.env.PICTORIUM_IMDB_DATASET_URL
  delete process.env.PICTORIUM_SHOWGRID_URL
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  delete process.env.PICTORIUM_EPISODE_RATINGS_PROVIDER
  delete process.env.PICTORIUM_NON_COMMERCIAL_ACK
  delete process.env.PICTORIUM_SERIESGRAPH_URL
  delete process.env.PICTORIUM_IMDB_DATASET_URL
  delete process.env.PICTORIUM_SHOWGRID_URL
})

describe("thumbnail ★ provider wiring", () => {
  it("defaults to ShowGrid and draws its 9.1 IMDb poll for S01E01", async () => {
    const res = await GET(request(), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("imdb")
    expect(upstream.showgridCalls).toBe(1)
    expect(cinemetaFetches(globalFetch)).toEqual([])
    expect(lastRender()).toEqual({ voteAverage: 9.1, voteSource: "imdb" })
  })

  it("fails open to the TMDB episode vote when ShowGrid misses", async () => {
    upstream.showgridRating = null

    const res = await GET(request(), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("tmdb")
    expect(upstream.showgridCalls).toBe(1)
    expect(cinemetaFetches(globalFetch)).toEqual([])
    expect(lastRender()).toEqual({ voteAverage: 6.1, voteSource: "tmdb" })
  })

  it("fails open to the TMDB episode vote when ShowGrid throws", async () => {
    upstream.throwShowgrid = true

    const res = await GET(request(), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("tmdb")
    expect(cinemetaFetches(globalFetch)).toEqual([])
    expect(lastRender()).toEqual({ voteAverage: 6.1, voteSource: "tmdb" })
  })

  it("serves an unacknowledged SeriesGraph config through ShowGrid and discloses imdb-fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.PICTORIUM_EPISODE_RATINGS_PROVIDER = "seriesgraph"

    const res = await GET(request(), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("imdb-fallback")
    expect(upstream.showgridCalls).toBe(1)
    expect(cinemetaFetches(globalFetch)).toEqual([])
    expect(lastRender()).toEqual({ voteAverage: 9.1, voteSource: "imdb" })
    expect(warn).toHaveBeenCalled()
  })

  it("fails an acknowledged but unimplemented provider closed to the TMDB vote", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.PICTORIUM_EPISODE_RATINGS_PROVIDER = "seriesgraph"
    process.env.PICTORIUM_NON_COMMERCIAL_ACK = "1"
    process.env.PICTORIUM_SERIESGRAPH_URL = "https://sg.example/ratings"

    const res = await GET(request(), params())

    expect(res.status).toBe(200)
    // No fabricated SeriesGraph value: the honest drawn source is TMDB.
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("tmdb")
    expect(upstream.showgridCalls).toBe(0)
    expect(cinemetaFetches(globalFetch)).toEqual([])
    expect(lastRender()).toEqual({ voteAverage: 6.1, voteSource: "tmdb" })
  })

  it("off never consults ShowGrid and uses the TMDB episode vote", async () => {
    process.env.PICTORIUM_EPISODE_RATINGS_PROVIDER = "off"

    const res = await GET(request(), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("tmdb")
    expect(upstream.showgridCalls).toBe(0)
    expect(cinemetaFetches(globalFetch)).toEqual([])
    expect(lastRender()).toEqual({ voteAverage: 6.1, voteSource: "tmdb" })
  })
})
