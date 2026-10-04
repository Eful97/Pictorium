import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchAnimeRatings,
  localAnimeIdsForMatches,
  normalizeAnimeSide,
  resolveAnimeIds,
  __resetAnimeBreakers,
  __resetAnimeNullForTest,
} from "@/lib/anime-ratings"
import { findAnimeByImdb, findAnimeByTmdb } from "@/lib/anime-id-map"
import { fetchAggregatedRating } from "@/lib/ratings"
import { cacheClear } from "@/lib/cache"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("anime local-first rating resolution", () => {
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

  it("unique local match skips the AniZip mapping request (rating fetches still occur)", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/mappings")) return jsonResponse({ mappings: { anilist_id: 1, kitsu_id: 1 } })
      if (url.includes("graphql") || url.includes("anilist")) return jsonResponse({ data: { Media: { averageScore: 87 } } })
      if (url.includes("/anime/")) return jsonResponse({ data: { attributes: { averageRating: "84.01" } } })
      return new Response("Not found", { status: 404 })
    })

    // tmdb:128 (Mononoke) è unico nello snapshot → {164, 142}, zero /mappings.
    const ids = await resolveAnimeIds("tt0119698", 128)
    expect(ids).toEqual({ anilistId: 164, kitsuId: 142 })
    expect(seen.some((u) => u.includes("/mappings"))).toBe(false)

    const ratings = await fetchAnimeRatings("tt0119698", { tmdbId: 128, wantAnilist: true, wantKitsu: true })
    expect(ratings).toEqual({ anilist: 8.7, kitsu: 8.4 })
    expect(seen.some((u) => u.includes("/mappings"))).toBe(false)
    expect(seen.some((u) => u.includes("graphql") || u.includes("anilist"))).toBe(true)
    expect(seen.some((u) => u.includes("/anime/"))).toBe(true)
  })

  it("local imdb match works when tmdbId is absent", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("graphql") || url.includes("anilist")) return jsonResponse({ data: { Media: { averageScore: 90 } } })
      return new Response("Not found", { status: 404 })
    })
    const ratings = await fetchAnimeRatings("tt0119698", { wantAnilist: true })
    expect(ratings).toEqual({ anilist: 9 })
  })

  it("ambiguous local match keeps the AniZip fallback (never an arbitrary season)", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("/mappings")) return jsonResponse({ mappings: { anilist_id: 21, kitsu_id: 12 } })
      if (url.includes("graphql") || url.includes("anilist")) return jsonResponse({ data: { Media: { averageScore: 87 } } })
      if (url.includes("/anime/")) return jsonResponse({ data: { attributes: { averageRating: "84.01" } } })
      return new Response("Not found", { status: 404 })
    })

    // tmdb:26209 ha 7 stagioni nello snapshot → locale ambiguo → AniZip.
    expect(findAnimeByTmdb(26209, "tv").length).toBeGreaterThan(1)
    expect(localAnimeIdsForMatches(findAnimeByTmdb(26209, "tv"))).toBeNull()
    const ids = await resolveAnimeIds("tt0286390", 26209)
    expect(ids).toEqual({ anilistId: 21, kitsuId: 12 })
    expect(seen.some((u) => u.includes("/mappings"))).toBe(true)
  })

  it("local miss keeps the existing AniZip path untouched", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async () => {
      seen.push("mappings")
      return new Response("not found", { status: 404 })
    })
    expect(await resolveAnimeIds("tt0137523", 550)).toBeNull()
    expect(seen.length).toBe(2) // tmdb 404 → fallback imdb, come prima
  })

  it("respects requested sources (no unrequested fetches)", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.includes("graphql") || url.includes("anilist")) return jsonResponse({ data: { Media: { averageScore: 87 } } })
      return new Response("Not found", { status: 404 })
    })
    const ratings = await fetchAnimeRatings("tt0119698", { tmdbId: 128, wantAnilist: true })
    expect(ratings).toEqual({ anilist: 8.7 })
    expect(seen.some((u) => u.includes("/anime/"))).toBe(false)
    expect(seen.some((u) => u.includes("/mappings"))).toBe(false)
  })

  it("aborted signal fails open (null, no throw) on a local hit", async () => {
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError")
      return jsonResponse({ data: { Media: { averageScore: 87 } } })
    })
    const ctrl = new AbortController()
    ctrl.abort()
    const ratings = await fetchAnimeRatings("tt0119698", { tmdbId: 128, wantAnilist: true, signal: ctrl.signal })
    expect(ratings).toBeNull()
  })

  it("local uniqueness policy: duplicate rows of the same anime are usable", () => {
    expect(localAnimeIdsForMatches([{ a: 5, k: 6, t: 1, y: "tv" }, { a: 5, k: 6, t: 1, y: "tv" }])).toEqual({
      anilistId: 5,
      kitsuId: 6,
    })
    expect(localAnimeIdsForMatches([{ a: 5, t: 1, y: "tv" }, { a: 7, t: 1, y: "tv" }])).toBeNull()
    expect(localAnimeIdsForMatches([{ t: 1, y: "tv" }])).toBeNull()
    expect(localAnimeIdsForMatches([])).toBeNull()
  })

  it("imdb reverse fixture: tt0202430 maps to kitsu:123 uniquely", () => {
    const matches = findAnimeByImdb("tt0202430")
    expect(matches).toHaveLength(1)
    expect(localAnimeIdsForMatches(matches)).toEqual({ anilistId: 145, kitsuId: 123 })
  })

  it("normalizeAnimeSide maps caller types to snapshot sides", () => {
    expect(normalizeAnimeSide("movie")).toBe("movie")
    expect(normalizeAnimeSide("tv")).toBe("tv")
    expect(normalizeAnimeSide("series")).toBe("tv")
    expect(normalizeAnimeSide("Series")).toBe("tv")
    expect(normalizeAnimeSide("anime")).toBeNull()
    expect(normalizeAnimeSide("")).toBeNull()
    expect(normalizeAnimeSide(null)).toBeNull()
    expect(normalizeAnimeSide(undefined)).toBeNull()
    expect(normalizeAnimeSide("ova")).toBeNull()
  })

  it("P1: a TV request never inherits the movie mapping sharing the numeric id", async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      // AniZip non conosce questo titolo: il locale tv deve restare un miss.
      return new Response("not found", { status: 404 })
    })

    // tmdb 128 è il film Mononoke (a164/k142) — lato movie: hit locale.
    expect(await resolveAnimeIds("tt0119698", 128, undefined, "movie")).toEqual({ anilistId: 164, kitsuId: 142 })
    // Stesso id numerico richiesto come serie, con l'imdb del film:
    // né il lookup tmdb (tv:128 assente) né quello imdb (filtrato per lato)
    // possono prestare il voto del film → AniZip 404 → null.
    expect(await resolveAnimeIds("tt0119698", 128, undefined, "tv")).toBeNull()
    // E senza lato il comportamento legacy resta (hit del film).
    expect(await resolveAnimeIds("tt0119698", 128)).toEqual({ anilistId: 164, kitsuId: 142 })
    expect(await fetchAnimeRatings("tt0119698", { tmdbId: 128, mediaType: "tv", wantAnilist: true })).toBeNull()
  })

  it("P1: colliding movie/tv id resolves each side to its own anime", async () => {
    globalThis.fetch = vi.fn(async () => new Response("not found", { status: 404 }))
    // tmdb 34775: film a3120/k2809 vs serie a1693/k1521 (snapshot reale).
    expect(await resolveAnimeIds("tt0185196", 34775, undefined, "movie")).toEqual({ anilistId: 3120, kitsuId: 2809 })
    expect(await resolveAnimeIds("tt0989787", 34775, undefined, "tv")).toEqual({ anilistId: 1693, kitsuId: 1521 })
    // Con tmdb presente il lato tmdb vince (stessa precedenza tmdb→imdb del
    // percorso AniZip); l'imdb incrociato non contamina.
    expect(await resolveAnimeIds("tt0185196", 34775, undefined, "tv")).toEqual({ anilistId: 1693, kitsuId: 1521 })
    // Solo-imdb incrociato: l'imdb di un lato non serve l'altro.
    expect(await resolveAnimeIds("tt0185196", undefined, undefined, "tv")).toBeNull()
    expect(await resolveAnimeIds("tt0185196", undefined, undefined, "movie")).toEqual({ anilistId: 3120, kitsuId: 2809 })
    expect(await resolveAnimeIds("tt0989787", undefined, undefined, "movie")).toBeNull()
  })

  it("P1: aggregated ratings cache keeps movie and tv anime sources apart", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("mdblist.com")) return jsonResponse({ ratings: [] })
      if (url.includes("graphql") || url.includes("anilist")) return jsonResponse({ data: { Media: { averageScore: 87 } } })
      return new Response("not found", { status: 404 })
    })
    const movie = await fetchAggregatedRating("tt0119698", "k", undefined, {
      tmdbId: 128,
      mediaType: "movie",
      wantAnilist: true,
    })
    expect(movie?.sources.anilist).toBe(8.7)
    // Stesso imdb richiesto come serie: il miss tv non deve servire l'anilist del film.
    const tv = await fetchAggregatedRating("tt0119698", "k", undefined, {
      tmdbId: 128,
      mediaType: "tv",
      wantAnilist: true,
    })
    expect(tv?.sources.anilist).toBeUndefined()
  })
})
