// @vitest-environment node
/**
 * Default ShowGrid per-episode ratings.
 *
 * Product decision: with no configuration the thumbnail ★ uses ShowGrid. The
 * operator explicitly accepted the third-party risk (no licence, permission
 * pending), so neither an acknowledgement nor a URL is required; the public
 * origin is the built-in default and `PICTORIUM_SHOWGRID_URL` only overrides
 * it. This module maps the native `sno`/`eno` rows (unordered) into an `S:E`
 * map, rejects 0/out-of-range/non-numeric scores, caches successes for 12
 * hours under the `showgrid` tag and never caches failures. ShowGrid needs no
 * API key, so no secret can appear in the URL, the cache key or the logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cacheClear, cacheGet, cacheInvalidate } from "@/lib/cache"
import { fetchShowgridEpisodeRatings } from "@/lib/showgrid-episode-ratings"
import {
  __resetEpisodeRatingsProviderWarnings,
  getEpisodeRatingsProvider,
  resolveEpisodeRatingsProvider,
} from "@/lib/episode-ratings-provider"

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function capturedWarnings(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n")
}

// Native ShowGrid payload (verified against the public API): the rows are NOT
// ordered by episode, `r` is the IMDb score and `v` the vote count.
const RATINGS_PAYLOAD = {
  details: [{ n: "Game of Thrones", r: 9.2, t: 60, v: 2680974, y: "2011", ec: 73, ey: "2019" }],
  ratings: [
    { r: 9.4, v: 68673, en: "Fire and Blood", eid: "tt1851397", eno: 10, sno: 1 },
    { r: 8.9, v: 82966, en: "Winter Is Coming", eid: "tt1480055", eno: 1, sno: 1 },
    // String indices, no vote count: still a genuine poll.
    { r: "8.6", eno: "2", sno: "1" },
  ],
}

beforeEach(() => {
  cacheClear()
  __resetEpisodeRatingsProviderWarnings()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.PICTORIUM_SHOWGRID_URL
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("ShowGrid episode payload", () => {
  it("maps sno:eno rows (order ignored) and keeps the vote count", async () => {
    process.env.PICTORIUM_SHOWGRID_URL = "https://mock.showgrid.test/"
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(RATINGS_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const map = await fetchShowgridEpisodeRatings("tt0944947")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = String(fetchSpy.mock.calls[0]![0])
    // Base override honored, endpoint + imdbID only: never a key/secret.
    expect(url).toBe("https://mock.showgrid.test/api/sg/getEpisodeRatings?imdbID=tt0944947")
    expect(url).not.toContain("key")
    expect(url).not.toContain("token")

    expect(map.size).toBe(3)
    expect(map.get("1:10")).toEqual({ rating: 9.4, votes: 68673 })
    expect(map.get("1:1")).toEqual({ rating: 8.9, votes: 82966 })
    expect(map.get("1:2")).toEqual({ rating: 8.6, votes: null })

    // The cache key carries the public IMDb id and nothing else.
    const cached = cacheGet<[string, unknown][]>("showgrid:episodes:tt0944947")
    expect(Array.isArray(cached)).toBe(true)
  })

  it("rejects 0/out-of-range/non-numeric rows and never invents a season 0 entry", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        ratings: [
          { r: 0, eno: 1, sno: 1 },
          { r: 11, eno: 2, sno: 1 },
          { r: "N/A", eno: 3, sno: 1 },
          { r: 8, eno: "x", sno: 1 },
          { r: 8, eno: 0, sno: 1 },
          { r: 8, eno: 1, sno: -1 },
          { r: 8, sno: 1 },
          { r: 8, eno: 2 },
          { r: 7.5, eno: 4, sno: 1 },
          // Season 0 (specials) is legitimate only when the source returns it.
          { r: 8.2, eno: 5, sno: 0 },
          null,
          "not-a-row",
        ],
      }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const map = await fetchShowgridEpisodeRatings("tt0944947")

    expect(map.size).toBe(2)
    expect(map.get("1:4")).toEqual({ rating: 7.5, votes: null })
    expect(map.get("0:5")).toEqual({ rating: 8.2, votes: null })
    expect(map.has("0:1")).toBe(false)
    expect(map.has("1:1")).toBe(false)
    expect(map.has("1:2")).toBe(false)
    expect(map.has("1:3")).toBe(false)
  })

  it("fails open (empty, never cached) on 404, malformed JSON and oversized bodies", async () => {
    const cases: (() => Response)[] = [
      () => jsonResponse({ error: "not found" }, 404),
      () => new Response("not json", { status: 200 }),
      () => new Response("x".repeat(512 * 1024 + 1), { status: 200 }),
    ]

    for (const make of cases) {
      cacheClear()
      const fetchSpy = vi.fn(async () => make())
      globalThis.fetch = fetchSpy as unknown as typeof fetch

      await expect(fetchShowgridEpisodeRatings("tt0944947")).resolves.toEqual(new Map())
      // No negative cache: the same id is retried on the next request.
      await expect(fetchShowgridEpisodeRatings("tt0944947")).resolves.toEqual(new Map())
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    }
  })

  it("fails open on a transport error and on an already-aborted caller signal", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("socket hang up", "AbortError")) as unknown as typeof fetch
    await expect(fetchShowgridEpisodeRatings("tt0944947")).resolves.toEqual(new Map())

    const controller = new AbortController()
    controller.abort()
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError")
      return jsonResponse(RATINGS_PAYLOAD)
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    await expect(fetchShowgridEpisodeRatings("tt0944947", controller.signal)).resolves.toEqual(new Map())
  })

  it("validates the imdbId shape fail-closed: no fetch, empty Map", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(RATINGS_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const invalidIds = [null, undefined, "", "0944947", "tt", "ttabc", "TT0944947", " tt0944947", "tt0944947 ", "tt0944947x"]
    for (const id of invalidIds) {
      const map = await fetchShowgridEpisodeRatings(id as string | null | undefined)
      expect(map.size).toBe(0)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("caches successes for 12h under the showgrid tag and respects invalidation", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    const fetchSpy = vi.fn(async () => jsonResponse(RATINGS_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await fetchShowgridEpisodeRatings("tt0944947")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // 11h later: still the same entry (no refetch).
    vi.setSystemTime(new Date("2026-01-01T11:00:00Z"))
    const hit = await fetchShowgridEpisodeRatings("tt0944947")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(hit.get("1:1")?.rating).toBe(8.9)

    // The entry belongs to the `showgrid` tag.
    vi.setSystemTime(new Date("2026-01-01T11:00:01Z"))
    cacheInvalidate("showgrid")
    await fetchShowgridEpisodeRatings("tt0944947")
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    // 12h after the refreshed write the entry expires and refetches.
    vi.setSystemTime(new Date("2026-01-01T23:30:00Z"))
    await fetchShowgridEpisodeRatings("tt0944947")
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})

describe("ShowGrid as the default provider", () => {
  it("defaults to ShowGrid with no acknowledgement/URL and serves the mocked S:E map", async () => {
    process.env.PICTORIUM_SHOWGRID_URL = "https://mock.showgrid.test"
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(RATINGS_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const selection = resolveEpisodeRatingsProvider({})
    expect(selection).toEqual({
      provider: "showgrid",
      requested: "showgrid",
      usedFallback: false,
      reason: null,
    })

    const provider = getEpisodeRatingsProvider(selection.provider)
    expect(provider.id).toBe("showgrid")
    await expect(
      provider.fetch({ seriesId: 1, imdbId: "tt0944947", season: 1, episode: 10 }),
    ).resolves.toBe(9.4)
    // A genuine miss stays null: the route then uses the TMDB episode vote.
    await expect(
      provider.fetch({ seriesId: 1, imdbId: "tt0944947", season: 1, episode: 99 }),
    ).resolves.toBeNull()
    // Cinemeta is never part of the episode path.
    expect(String(fetchSpy.mock.calls[0]![0])).not.toContain("cinemeta")
  })

  it("explicit showgrid needs no ack and uses the built-in public origin by default", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => jsonResponse(RATINGS_PAYLOAD))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const selection = resolveEpisodeRatingsProvider({
      PICTORIUM_EPISODE_RATINGS_PROVIDER: "showgrid",
    })
    expect(selection.provider).toBe("showgrid")
    expect(selection.usedFallback).toBe(false)

    await getEpisodeRatingsProvider(selection.provider).fetch({
      seriesId: 1,
      imdbId: "tt0944947",
      season: 1,
      episode: 1,
    })
    const url = String(fetchSpy.mock.calls[0]![0])
    expect(url).toContain("https://api.theshowgrid.com/api/sg/getEpisodeRatings?imdbID=tt0944947")
    expect(url).not.toContain("cinemeta")
  })

  it("keeps the opt-in providers fail-closed and falls back to ShowGrid with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    for (const env of [
      { PICTORIUM_EPISODE_RATINGS_PROVIDER: "seriesgraph" },
      { PICTORIUM_EPISODE_RATINGS_PROVIDER: "dataset", PICTORIUM_NON_COMMERCIAL_ACK: "1" },
    ]) {
      const selection = resolveEpisodeRatingsProvider(env)
      expect(selection.provider).toBe("showgrid")
      expect(selection.usedFallback).toBe(true)
    }
    expect(warn).toHaveBeenCalled()
    expect(capturedWarnings(warn)).toContain("using ShowGrid instead")
  })
})
