import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  fetchTvmazeRating,
  isTvmazeBreakerOpen,
  __resetTvmazeBreaker,
  __resetTvmazeNullForTest,
} from "@/lib/tvmaze"
import { fetchAggregatedRating } from "@/lib/ratings"
import { cacheClear } from "@/lib/cache"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const originalFetch = globalThis.fetch

describe("TVmaze opt-in rating provider", () => {
  beforeEach(() => {
    __resetTvmazeBreaker()
    __resetTvmazeNullForTest()
    cacheClear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("series: returns the upstream 0-10 average unchanged (one lookup by IMDb id)", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ id: 82, name: "Game of Thrones", rating: { average: 8.4 } }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const rating = await fetchTvmazeRating("tt0944947", { mediaType: "series" })

    expect(rating).toBe(8.4)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toBe("https://api.tvmaze.com/lookup/shows?imdb=tt0944947")
    // Positive cache: a second call never hits the upstream again.
    expect(await fetchTvmazeRating("tt0944947", { mediaType: "series" })).toBe(8.4)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("movies are out of scope: zero upstream, clean miss", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ rating: { average: 9 } }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await fetchTvmazeRating("tt0111161", { mediaType: "movie" })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("404 / missing rating / out-of-range values are genuine misses (negative cached)", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(null, 404))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await fetchTvmazeRating("tt1111111", { mediaType: "series" })).toBeNull()
    // Negative cache: same id within the TTL does not refetch.
    expect(await fetchTvmazeRating("tt1111111", { mediaType: "series" })).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const cases: Array<[string, unknown]> = [
      ["tt1111112", null],
      ["tt1111113", 0],
      ["tt1111114", 12],
      ["tt1111115", "N/A"],
    ]
    for (const [id, value] of cases) {
      __resetTvmazeNullForTest()
      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ rating: { average: value } })) as unknown as typeof fetch
      expect(await fetchTvmazeRating(id, { mediaType: "series" })).toBeNull()
    }
  })

  it("thetvdb fallback is used only when no IMDb id is supplied", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ rating: { average: 7.1 } }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    expect(await fetchTvmazeRating(null, { mediaType: "series", tvdbId: 121361 })).toBe(7.1)
    expect(String(fetchSpy.mock.calls[0][0])).toBe("https://api.tvmaze.com/lookup/shows?thetvdb=121361")

    const before = fetchSpy.mock.calls.length
    expect(await fetchTvmazeRating("", { mediaType: "series" })).toBeNull()
    expect(fetchSpy.mock.calls.length).toBe(before)
  })

  it("upstream failures fail open (never throw) and open the breaker", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ error: "boom" }, 503))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    for (let i = 0; i < 3; i++) {
      expect(await fetchTvmazeRating(`tt333333${i}`, { mediaType: "series" })).toBeNull()
    }
    expect(isTvmazeBreakerOpen()).toBe(true)
    const calls = fetchSpy.mock.calls.length
    expect(await fetchTvmazeRating("tt4444444", { mediaType: "series" })).toBeNull()
    expect(fetchSpy.mock.calls.length).toBe(calls)
  })

  it("aggregated: rsrc=tvmaze feeds a series vote and misses a movie without inventing one", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ rating: { average: 8.8 } }))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const series = await fetchAggregatedRating("tt5555555", undefined, undefined, {
      mediaType: "series",
      requestedSources: ["tvmaze"],
    })
    expect(series?.sources.tvmaze).toBe(8.8)
    expect(series?.sources.imdb).toBeUndefined()
    expect(series?.count).toBe(1)

    const movie = await fetchAggregatedRating("tt6666666", undefined, undefined, {
      mediaType: "movie",
      requestedSources: ["tvmaze"],
    })
    expect(movie).toBeNull()
    // Only the series lookup went out.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
