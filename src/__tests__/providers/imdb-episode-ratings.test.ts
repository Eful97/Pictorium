import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { fetchCinemetaEpisodeRatings } from "@/lib/imdb-episode-ratings"
import { cacheClear } from "@/lib/cache"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

const originalFetch = globalThis.fetch

// Deterministic Cinemeta series payload shaped like `meta/series/tt0944947.json`:
// genuine polls, "0"/"N/A"/missing ratings, out-of-range values, malformed
// indices and non-string thumbnails all in the same document.
const SERIES_PAYLOAD = {
  meta: {
    id: "tt0944947",
    type: "series",
    name: "Game of Thrones",
    videos: [
      { season: 1, episode: 1, rating: "8.7", thumbnail: "https://images.metahub.space/meta/tt0944947/w780.jpg" },
      { season: 1, episode: 2, rating: "0", thumbnail: "https://images.metahub.space/meta/tt0944947/w780.jpg" },
      { season: 1, episode: 3, rating: "N/A" },
      { season: 1, episode: 4 },
      { season: 1, episode: 5, rating: "9.1", thumbnail: "" },
      { season: "2", episode: "1", rating: 9.2, thumbnail: "   " },
      { season: 2, episode: 2, rating: 12 },
      { season: 2, episode: 3, rating: "8.0", thumbnail: 42 },
      { season: -1, episode: 3, rating: "7.5" },
      { season: 3, episode: "x", rating: "7.5" },
      null,
      "not-a-video",
    ],
  },
}

describe("Cinemeta per-episode IMDb ratings", () => {
  beforeEach(() => {
    cacheClear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("maps valid S:E polls and skips 0/missing/invalid entries", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(SERIES_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const map = await fetchCinemetaEpisodeRatings("tt0944947")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = String(fetchSpy.mock.calls[0][0])
    expect(url).toContain("/meta/series/tt0944947.json")
    // Public endpoint: never an API key.
    expect(url).not.toContain("api_key")

    expect(map.size).toBe(4)
    expect(map.get("1:1")).toEqual({
      rating: 8.7,
      thumbnail: "https://images.metahub.space/meta/tt0944947/w780.jpg",
    })
    // Whitespace-only / non-string thumbnails become null, rating preserved.
    expect(map.get("1:5")).toEqual({ rating: 9.1, thumbnail: null })
    expect(map.get("2:1")).toEqual({ rating: 9.2, thumbnail: null })
    expect(map.get("2:3")).toEqual({ rating: 8, thumbnail: null })

    // "0", "N/A", missing, > 10 and malformed season/episode are skipped.
    expect(map.has("1:2")).toBe(false)
    expect(map.has("1:3")).toBe(false)
    expect(map.has("1:4")).toBe(false)
    expect(map.has("2:2")).toBe(false)
    expect(map.has("-1:3")).toBe(false)
    expect(map.has("2:-1")).toBe(false)
  })

  it("caches by imdbId: a second call never refetches; a different id does", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(SERIES_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const first = await fetchCinemetaEpisodeRatings("tt0944947")
    const second = await fetchCinemetaEpisodeRatings("tt0944947")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(second.get("1:1")).toEqual(first.get("1:1"))
    // The public result is rebuilt, never the same mutable Map instance.
    expect(second).not.toBe(first)

    await fetchCinemetaEpisodeRatings("tt1111111")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("does not cache transport failures: a later call retries and succeeds", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("socket hang up", "AbortError"))
      .mockResolvedValueOnce(jsonResponse(SERIES_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const failed = await fetchCinemetaEpisodeRatings("tt0944947")
    expect(failed.size).toBe(0)

    const retried = await fetchCinemetaEpisodeRatings("tt0944947")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(retried.get("1:1")?.rating).toBe(8.7)
  })

  it("does not cache HTTP failures (404/500): empty result, never throws", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await expect(fetchCinemetaEpisodeRatings("tt0944947")).resolves.toEqual(new Map())
    await expect(fetchCinemetaEpisodeRatings("tt0944947")).resolves.toEqual(new Map())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("returns an empty Map on malformed JSON and on 200 without videos", async () => {
    globalThis.fetch = vi.fn(async () => new Response("not json", { status: 200 })) as unknown as typeof fetch

    const malformed = await fetchCinemetaEpisodeRatings("tt0944947")
    expect(malformed.size).toBe(0)

    globalThis.fetch = vi.fn(async () => jsonResponse({ meta: { id: "tt0944947" } })) as unknown as typeof fetch
    const withoutVideos = await fetchCinemetaEpisodeRatings("tt0944947")
    expect(withoutVideos.size).toBe(0)
  })

  it("fails open on an already-aborted caller signal", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError")
      return jsonResponse(SERIES_PAYLOAD)
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await expect(fetchCinemetaEpisodeRatings("tt0944947", controller.signal)).resolves.toEqual(new Map())
  })

  it("validates the imdbId shape fail-closed: no fetch, empty Map", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(SERIES_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const invalidIds = [null, undefined, "", "0944947", "tt", "ttabc", "TT0944947", " tt0944947", "tt0944947 ", "tt0944947x", "nm0000001"]
    for (const id of invalidIds) {
      const map = await fetchCinemetaEpisodeRatings(id as string | null | undefined)
      expect(map.size).toBe(0)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
