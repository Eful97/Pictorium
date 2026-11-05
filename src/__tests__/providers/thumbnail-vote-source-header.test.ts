// @vitest-environment node
/**
 * Additive provenance header for the episode thumbnail ★.
 *
 * `?source` already selects the vote leg (default `imdb`), but the effective
 * source after a fail-open fallback was invisible. The response now echoes
 * `X-Pictorium-Vote-Source: imdb|tmdb` so a TMDB fallback is observable
 * without inferring it from the pixels (body/ETag unchanged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/sharp-config", () => ({ initSharp: vi.fn() }))

const upstream = vi.hoisted(() => ({
  imdbRating: 8.7 as number | null,
  tmdbVote: 6.1,
}))

vi.mock("@/lib/imdb-cache", () => ({
  resolveImdbId: vi.fn(async () => "tt1234567"),
}))

vi.mock("@/lib/showgrid-episode-ratings", () => ({
  fetchShowgridEpisodeRatings: vi.fn(async () => {
    const rating = upstream.imdbRating
    return new Map(rating === null ? [] : [["1:2", { rating, votes: 1234 }]])
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
    renderEpisodeThumbnail: vi.fn(async (input: { voteSource?: string }) => ({
      png: Buffer.from("fake-png"),
      w: 320,
      h: 180,
      rendered: true,
      voteSource: input.voteSource ?? "imdb",
      geometry: { left: 8, top: 8, w: 100, h: 30 },
    })),
  }
})

const { GET } = await import("@/app/api/thumbnail/tv/[id]/season/[season]/episode/[episode]/route")

function request(still: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/thumbnail/tv/123/season/1/episode/2?still=${encodeURIComponent(still)}&w=320&badges=vote&source=imdb`,
  )
}

const params = () => ({ params: Promise.resolve({ id: "123", season: "1", episode: "2" }) })

describe("thumbnail vote provenance header", () => {
  beforeEach(() => {
    cacheClear()
    upstream.imdbRating = 8.7
  })

  it("echoes imdb when the default ShowGrid per-episode poll wins", async () => {
    const res = await GET(request("/still-imdb.jpg"), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("imdb")
  })

  it("echoes the tmdb fallback when the IMDb episode poll misses", async () => {
    upstream.imdbRating = null
    const res = await GET(request("/still-tmdb.jpg"), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Pictorium-Vote-Source")).toBe("tmdb")
  })
})
