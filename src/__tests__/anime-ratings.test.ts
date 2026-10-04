import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  fetchAnimeRatings,
  resolveAnimeIds,
  __resetAnimeBreakers,
  __resetAnimeNullForTest,
} from "@/lib/anime-ratings"
import { fetchAggregatedRating } from "@/lib/ratings"
import { cacheClear } from "@/lib/cache"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("anime-ratings (AniZip + AniList + Kitsu)", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    __resetAnimeBreakers()
    __resetAnimeNullForTest()
    cacheClear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("zero chiamate se nessuna fonte anime richiesta", async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    expect(await fetchAnimeRatings("tt1234567", {})).toBeNull()
    expect(await fetchAnimeRatings("tt1234567")).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("resolve via tmdbId dallo snapshot locale e fetch parallelo AniList + Kitsu", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/mappings")) {
        return jsonResponse({ mappings: { anilist_id: 21, kitsu_id: 12 } })
      }
      if (url.includes("anilist") || url.includes("/graphql")) {
        return jsonResponse({ data: { Media: { id: 21, averageScore: 87 } } })
      }
      if (url.includes("/anime/12")) {
        return jsonResponse({ data: { attributes: { averageRating: "84.01" } } })
      }
      return new Response("Not found", { status: 404 })
    })

    // tmdb:37854 è unico nello snapshot locale → {21, 12} senza /mappings.
    const ids = await resolveAnimeIds("tt0388629", 37854)
    expect(ids).toEqual({ anilistId: 21, kitsuId: 12 })
    expect(seen.some((u) => u.includes("/mappings"))).toBe(false)

    const ratings = await fetchAnimeRatings("tt0388629", { tmdbId: 37854, wantAnilist: true, wantKitsu: true })
    expect(ratings).toEqual({ anilist: 8.7, kitsu: 8.4 })
    expect(seen.some((u) => u.includes("/mappings"))).toBe(false)
  })

  it("resolve via imdbId quando tmdbId assente", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/mappings")) {
        expect(url).toContain("imdb_id=tt1000000")
        return jsonResponse({ mappings: { anilist_id: 21, kitsu_id: null } })
      }
      if (url.includes("anilist") || url.includes("/graphql")) {
        return jsonResponse({ data: { Media: { averageScore: 90 } } })
      }
      return new Response("Not found", { status: 404 })
    })

    // tt1000000 non è nello snapshot locale → percorso AniZip invariato.
    const ratings = await fetchAnimeRatings("tt1000000", { wantAnilist: true, wantKitsu: true })
    // kitsu_id null → solo anilist, nessuna chiamata Kitsu sprecata
    expect(ratings).toEqual({ anilist: 9 })
  })

  it("fallback imdb quando il mapping tmdb fa 404", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/mappings")) {
        if (url.includes("themoviedb_id=")) return new Response("not found", { status: 404 })
        return jsonResponse({ mappings: { anilist_id: 21, kitsu_id: null } })
      }
      if (url.includes("anilist") || url.includes("/graphql")) {
        return jsonResponse({ data: { Media: { averageScore: 88 } } })
      }
      return new Response("Not found", { status: 404 })
    })

    // tmdb:999999 e tt1000001 assenti dallo snapshot → AniZip come prima.
    const ratings = await fetchAnimeRatings("tt1000001", { tmdbId: 999999, wantAnilist: true })
    expect(ratings).toEqual({ anilist: 8.8 })
    expect(seen.filter((u) => u.includes("/mappings"))).toHaveLength(2)
  })

  it("404 AniZip (non-anime) → null + negativa senza breaker", async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return new Response("not found", { status: 404 })
    })

    expect(await fetchAnimeRatings("tt0137523", { tmdbId: 550, wantAnilist: true })).toBeNull()
    // tmdb 404 → fallback imdb 404: 2 chiamate, poi la negativa copre entrambe
    expect(calls).toBe(2)
    expect(await fetchAnimeRatings("tt0137523", { tmdbId: 550, wantAnilist: true })).toBeNull()
    expect(calls).toBe(2)
  })

  it("Media null / averageRating null → miss senza 500", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/mappings")) return jsonResponse({ mappings: { anilist_id: 21, kitsu_id: 12 } })
      if (url.includes("anilist") || url.includes("/graphql")) return jsonResponse({ data: { Media: null } })
      if (url.includes("/anime/12")) return jsonResponse({ data: { attributes: { averageRating: null } } })
      return new Response("Not found", { status: 404 })
    })

    expect(await fetchAnimeRatings("tt1", { tmdbId: 1, wantAnilist: true, wantKitsu: true })).toBeNull()
  })

  it("circuit breaker: 3 errori 500 consecutivi aprono il breaker (fail-open)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Server error", { status: 500 }))

    expect(await fetchAnimeRatings("tt_f1", { tmdbId: "f1", wantAnilist: true })).toBeNull()
    expect(await fetchAnimeRatings("tt_f2", { tmdbId: "f2", wantAnilist: true })).toBeNull()
    expect(await fetchAnimeRatings("tt_f3", { tmdbId: "f3", wantAnilist: true })).toBeNull()

    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    expect(await fetchAnimeRatings("tt_f4", { tmdbId: "f4", wantAnilist: true })).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("integrazione fetchAggregatedRating: popola sources.anilist/kitsu", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("mdblist.com")) {
        return jsonResponse({ score: 80, ratings: [{ source: "imdb", value: 8.5 }] })
      }
      if (url.includes("/mappings")) return jsonResponse({ mappings: { anilist_id: 21, kitsu_id: 12 } })
      if (url.includes("anilist") || url.includes("/graphql")) {
        return jsonResponse({ data: { Media: { averageScore: 87 } } })
      }
      if (url.includes("/anime/12")) return jsonResponse({ data: { attributes: { averageRating: "84.01" } } })
      return new Response("Not found", { status: 404 })
    })

    const aggregated = await fetchAggregatedRating("tt_anime_agg", "fake-mdb-key", undefined, {
      tmdbId: 37854,
      wantAnilist: true,
      wantKitsu: true,
    })

    expect(aggregated).not.toBeNull()
    expect(aggregated?.sources.imdb).toBe(8.5)
    expect(aggregated?.sources.anilist).toBe(8.7)
    expect(aggregated?.sources.kitsu).toBe(8.4)
  })

  it("fetchAggregatedRating senza flag anime: nessuna chiamata AniZip", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("mdblist.com")) return jsonResponse({ ratings: [{ source: "imdb", value: 8.5 }] })
      return new Response("Not found", { status: 404 })
    })

    const aggregated = await fetchAggregatedRating("tt_noanime", "k", undefined, { tmdbId: 550 })
    expect(aggregated?.sources.anilist).toBeUndefined()
    expect(seen.some((u) => u.includes("ani.zip") || u.includes("/mappings"))).toBe(false)
  })
})
