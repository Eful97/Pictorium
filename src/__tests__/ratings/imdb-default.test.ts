import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_RATING_SOURCES,
  fetchAggregatedRating,
  resolveRatingSources,
  __resetMdbRawForTest,
  __resetMdblistBreaker,
  __resetRatingsNullForTest,
} from "@/lib/ratings"
import { __resetCinemetaBreaker, __resetCinemetaNullForTest } from "@/lib/cinemeta"
import { cacheClear } from "@/lib/cache"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  __resetMdblistBreaker()
  __resetRatingsNullForTest()
  __resetMdbRawForTest()
  __resetCinemetaBreaker()
  __resetCinemetaNullForTest()
  cacheClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  cacheClear()
})

describe("IMDb (Cinemeta) è il default del voto", () => {
  it("fresh defaults (no query/mapping/config/sd) risolvono su IMDb-only", () => {
    expect(DEFAULT_RATING_SOURCES).toEqual(["imdb"])
    expect(resolveRatingSources(null)).toEqual(["imdb"])
    expect(resolveRatingSources("", null, undefined, [])).toEqual(["imdb"])
    // Garbage esplicito cade sul default, mai su una media implicita.
    expect(resolveRatingSources("xyz")).toEqual(["imdb"])
  })

  it("default: Cinemeta è primario, MDBList non viene chiamato quando l'IMDb risolve", async () => {
    const seen: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/meta/")) return jsonResponse({ meta: { imdbRating: "8.7" } })
      // Nessun upstream rating dovrebbe chiedere altro: se accade, serve una
      // risposta valida ma il test fallisce sulle asserzioni di chiamata.
      return jsonResponse({ ratings: [{ source: "tmdb", value: 70, score: 70 }] })
    }))

    const result = await fetchAggregatedRating("tt0111161", "k", undefined, {
      mediaType: "movie",
      requestedSources: resolveRatingSources(null),
      ratingWaitMs: 1500,
      tmdbFallbackVote: 7.0,
    })

    expect(result?.sources.imdb).toBe(8.7)
    // TMDB diretto è solo fallback/overlay: con IMDb disponibile non è primario
    // né viene fuso nella lettura di default.
    expect(result?.sources.tmdb).toBeUndefined()
    expect(seen.some((u) => u.includes("/meta/movie/tt0111161"))).toBe(true)
    expect(seen.some((u) => u.includes("mdblist.com"))).toBe(false)
  })

  it("fallback: senza voto Cinemeta i provider restano utilizzabili per l'IMDb", async () => {
    const seen: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/meta/")) return jsonResponse({ meta: {} })
      if (url.includes("mdblist.com")) {
        return jsonResponse({ ratings: [{ source: "imdb", value: 91, score: 91 }] })
      }
      return jsonResponse({ meta: {} })
    }))

    const result = await fetchAggregatedRating("tt0133093", "k", undefined, {
      mediaType: "movie",
      requestedSources: resolveRatingSources(null),
      ratingWaitMs: 1500,
    })

    expect(result?.sources.imdb).toBe(9.1)
    expect(seen.some((u) => u.includes("/meta/"))).toBe(true)
    expect(seen.some((u) => u.includes("mdblist.com"))).toBe(true)
  })

  it("una selezione salvata esplicita è preservata (tmdb-only resta tale, zero Cinemeta)", async () => {
    // Catena del resolver: il livello salvato vince sull'assenza del default.
    expect(resolveRatingSources(null, ["tmdb"])).toEqual(["tmdb"])
    expect(resolveRatingSources(null, undefined, ["imdb", "tmdb"])).toEqual(["imdb", "tmdb"])

    const seen: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/meta/")) return jsonResponse({ meta: { imdbRating: "9.9" } })
      return jsonResponse({ ratings: [{ source: "tmdb", value: 82, score: 82 }] })
    }))

    const result = await fetchAggregatedRating("tt0068646", "k", undefined, {
      mediaType: "movie",
      requestedSources: ["tmdb"],
      ratingWaitMs: 1500,
      tmdbFallbackVote: 7.0,
    })

    expect(result?.sources.tmdb).toBe(7.0)
    expect(seen.some((u) => u.includes("/meta/"))).toBe(false)
    expect(seen.some((u) => u.includes("mdblist.com"))).toBe(false)
  })
})
