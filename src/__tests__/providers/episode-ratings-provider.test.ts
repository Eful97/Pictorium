// @vitest-environment node
/**
 * Episode ratings provider registry.
 *
 * Product decision: with no configuration the thumbnail ★ uses ShowGrid (IMDb
 * per-episode poll) then the TMDB fallback. The operator explicitly accepted
 * the third-party risk (no licence, permission pending). Cinemeta is no longer
 * consulted on the episode path; legacy aliases resolve to ShowGrid. The
 * opt-in `seriesgraph`/`dataset` providers remain unreachable without an
 * explicit acknowledgement (and URL) and otherwise fail closed to ShowGrid with
 * a warning — never a silent terms-of-service bypass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetEpisodeRatingsProviderWarnings,
  getEpisodeRatingsProvider,
  resolveEpisodeRatingsProvider,
  resolveEpisodeVoteProvenance,
} from "@/lib/episode-ratings-provider"
import { thumbnailCacheKey } from "@/lib/thumbnail-renderer"
import { cacheClear } from "@/lib/cache"

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function capturedWarnings(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n")
}

beforeEach(() => {
  cacheClear()
  __resetEpisodeRatingsProviderWarnings()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.PICTORIUM_SHOWGRID_URL
  vi.restoreAllMocks()
})

describe("resolveEpisodeRatingsProvider", () => {
  it("defaults to ShowGrid with no env and treats legacy Cinemeta values as aliases", () => {
    expect(resolveEpisodeRatingsProvider({})).toEqual({
      provider: "showgrid",
      requested: "showgrid",
      usedFallback: false,
      reason: null,
    })

    for (const value of ["cinemeta", "imdb", "imdb-cinemeta", " IMDb "]) {
      const selection = resolveEpisodeRatingsProvider({ PICTORIUM_EPISODE_RATINGS_PROVIDER: value })
      expect(selection.provider).toBe("showgrid")
      expect(selection.usedFallback).toBe(false)
    }
  })

  it("selects the route-owned TMDB leg for tmdb/off without a fallback", () => {
    for (const value of ["tmdb", "off", " OFF "]) {
      const selection = resolveEpisodeRatingsProvider({ PICTORIUM_EPISODE_RATINGS_PROVIDER: value })
      expect(selection.provider).toBe("tmdb")
      expect(selection.usedFallback).toBe(false)
      expect(selection.reason).toBeNull()
    }
  })

  it("selects ShowGrid with neither acknowledgement nor URL (default, no gate)", () => {
    const selection = resolveEpisodeRatingsProvider({
      PICTORIUM_EPISODE_RATINGS_PROVIDER: "showgrid",
    })
    expect(selection).toEqual({
      provider: "showgrid",
      requested: "showgrid",
      usedFallback: false,
      reason: null,
    })
  })

  it("fails closed to ShowGrid (with a warning) when SeriesGraph has no acknowledgement", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    for (const env of [
      { PICTORIUM_EPISODE_RATINGS_PROVIDER: "seriesgraph" },
      {
        PICTORIUM_EPISODE_RATINGS_PROVIDER: "seriesgraph",
        PICTORIUM_NON_COMMERCIAL_ACK: "0",
        PICTORIUM_SERIESGRAPH_URL: "https://sg.example/ratings",
      },
    ]) {
      const selection = resolveEpisodeRatingsProvider(env)
      expect(selection.provider).toBe("showgrid")
      expect(selection.usedFallback).toBe(true)
      expect(selection.reason).toBe("missing-ack")
    }

    expect(capturedWarnings(warn)).toContain("PICTORIUM_NON_COMMERCIAL_ACK=1")
    // Warn-once per misconfiguration: the second resolve above did not repeat.
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("fails closed to ShowGrid when the acknowledgement exists but the URL does not", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    for (const env of [
      { PICTORIUM_EPISODE_RATINGS_PROVIDER: "seriesgraph", PICTORIUM_NON_COMMERCIAL_ACK: "1" },
      {
        PICTORIUM_EPISODE_RATINGS_PROVIDER: "seriesgraph",
        PICTORIUM_NON_COMMERCIAL_ACK: "1",
        PICTORIUM_SERIESGRAPH_URL: "not-a-url",
      },
      { PICTORIUM_EPISODE_RATINGS_PROVIDER: "dataset", PICTORIUM_NON_COMMERCIAL_ACK: "1" },
      {
        PICTORIUM_EPISODE_RATINGS_PROVIDER: "dataset",
        PICTORIUM_NON_COMMERCIAL_ACK: "1",
        PICTORIUM_IMDB_DATASET_URL: "/local/path",
      },
    ]) {
      const selection = resolveEpisodeRatingsProvider(env)
      expect(selection.provider).toBe("showgrid")
      expect(selection.usedFallback).toBe(true)
      expect(selection.reason).toBe("missing-url")
    }
    expect(capturedWarnings(warn)).toContain("PICTORIUM_SERIESGRAPH_URL")
  })

  it("selects SeriesGraph/dataset only with the ack AND the provider URL", () => {
    const seriesgraph = resolveEpisodeRatingsProvider({
      PICTORIUM_EPISODE_RATINGS_PROVIDER: "seriesgraph",
      PICTORIUM_NON_COMMERCIAL_ACK: "1",
      PICTORIUM_SERIESGRAPH_URL: "https://sg.example/ratings",
    })
    expect(seriesgraph).toEqual({
      provider: "seriesgraph",
      requested: "seriesgraph",
      usedFallback: false,
      reason: null,
    })

    const dataset = resolveEpisodeRatingsProvider({
      PICTORIUM_EPISODE_RATINGS_PROVIDER: "dataset",
      PICTORIUM_NON_COMMERCIAL_ACK: "1",
      PICTORIUM_IMDB_DATASET_URL: "https://data.example/episodes.tsv",
    })
    expect(dataset).toEqual({
      provider: "dataset",
      requested: "dataset",
      usedFallback: false,
      reason: null,
    })
  })

  it("warns and uses ShowGrid for an unknown provider value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const selection = resolveEpisodeRatingsProvider({ PICTORIUM_EPISODE_RATINGS_PROVIDER: "letterboxd" })

    expect(selection).toEqual({
      provider: "showgrid",
      requested: "letterboxd",
      usedFallback: true,
      reason: "unknown-provider",
    })
    expect(capturedWarnings(warn)).toContain("Unknown PICTORIUM_EPISODE_RATINGS_PROVIDER")
  })
})

describe("provider transports", () => {
  it("serves the ShowGrid default: IMDb poll hit, then null on a miss (no Cinemeta call)", async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) =>
      jsonResponse({
        ratings: [
          { sno: 1, eno: 1, r: 9.1, v: 12345 },
          { sno: 1, eno: 2, r: "8.7" },
        ],
      }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const provider = getEpisodeRatingsProvider("showgrid")
    expect(provider.id).toBe("showgrid")

    await expect(
      provider.fetch({ seriesId: 1396, imdbId: "tt0903747", season: 1, episode: 1 }),
    ).resolves.toBe(9.1)
    const url = String(fetchSpy.mock.calls[0]![0])
    expect(url).toContain("/api/sg/getEpisodeRatings?imdbID=tt0903747")
    expect(url).not.toContain("cinemeta")

    // Missing episode = fail-open miss (the route then uses the TMDB vote).
    await expect(
      provider.fetch({ seriesId: 1396, imdbId: "tt0903747", season: 1, episode: 9 }),
    ).resolves.toBeNull()
  })

  it("never fetches from an unimplemented opt-in provider (fail-closed stub)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    for (const id of ["seriesgraph", "dataset"] as const) {
      const provider = getEpisodeRatingsProvider(id)
      await expect(
        provider.fetch({ seriesId: 123, imdbId: "tt1234567", season: 1, episode: 2 }),
      ).resolves.toBeNull()
    }

    // Neither integration ships a fetch: the permission/integration work is a
    // follow-up, and an enabled-but-missing source must degrade to TMDB.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(capturedWarnings(warn)).toContain("not implemented")
  })

  it("marks the TMDB provider as route-owned (no fetch, no value)", async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const provider = getEpisodeRatingsProvider("tmdb")
    await expect(
      provider.fetch({ seriesId: 123, imdbId: "tt1234567", season: 1, episode: 2 }),
    ).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("vote provenance", () => {
  const showgrid = resolveEpisodeRatingsProvider({})
  const fallback = resolveEpisodeRatingsProvider({ PICTORIUM_EPISODE_RATINGS_PROVIDER: "seriesgraph" })

  it("reports the value actually drawn, distinguishing the acknowledgeless fallback", () => {
    expect(resolveEpisodeVoteProvenance(showgrid, "imdb")).toBe("imdb")
    expect(resolveEpisodeVoteProvenance(showgrid, "tmdb")).toBe("tmdb")
    // Opt-in provider configured but unusable: the pixels are the default
    // ShowGrid IMDb poll, and the header says the configured source did not run.
    expect(resolveEpisodeVoteProvenance(fallback, "imdb")).toBe("imdb-fallback")
    expect(resolveEpisodeVoteProvenance(fallback, "tmdb")).toBe("tmdb")
  })
})

describe("thumbnail cache identity", () => {
  const base = {
    seriesId: 123,
    seasonNumber: 1,
    episodeNumber: 2,
    still: "/still.jpg",
    width: 320 as const,
    badges: "vote" as const,
    languages: "en,null",
    blur: false,
  }

  it("includes the effective provider id, defaulting to ShowGrid", () => {
    expect(thumbnailCacheKey(base)).toBe(thumbnailCacheKey({ ...base, provider: "showgrid" }))
    expect(thumbnailCacheKey(base)).toContain(":prshowgrid:")
    expect(thumbnailCacheKey({ ...base, provider: "seriesgraph" })).toContain(":prseriesgraph:")
    expect(thumbnailCacheKey({ ...base, provider: "seriesgraph" })).not.toBe(thumbnailCacheKey(base))
    expect(thumbnailCacheKey({ ...base, provider: "dataset" })).not.toBe(thumbnailCacheKey(base))
  })
})
