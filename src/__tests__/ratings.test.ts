import { afterEach, describe, expect, it, vi } from "vitest"
import { fetchAggregatedRating, calculateAverageRating, parseRatingSources, resolveRatingSources, pickSeparateRatings, formatSeparateValue, MAX_SEPARATE_RATINGS } from "@/lib/ratings"
import { cacheClear } from "@/lib/cache"
import * as cacheModule from "@/lib/cache"

function okFetch(_url: string | URL | Request) {
  return { ok: true, json: async () => ({ ratings: [{ source: "imdb", value: 8.4 }] }) }
}

describe("fetchAggregatedRating (D4 — mdblist key nel cache key, D5 — niente chiave d'istanza)", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    cacheClear()
    vi.clearAllMocks()
  })

  it("senza key esplicita nessun fallback d'istanza: richiesta senza apikey (D5)", async () => {
    const fetchMock = vi.fn(okFetch)
    vi.stubGlobal("fetch", fetchMock)

    const result = await fetchAggregatedRating("tt123")

    expect(result?.average).toBe(8.4)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).not.toContain("apikey=")
  })

  it("cache key con hash della chiave mdblist, mai plaintext, e distinto per key (D4)", async () => {
    vi.stubGlobal("fetch", vi.fn(okFetch))
    const keys: string[] = []
    const originalSet = cacheModule.cacheSet
    const spy = vi.spyOn(cacheModule, "cacheSet").mockImplementation((k: string, v: unknown, tags?: string[]) => {
      keys.push(k)
      originalSet(k, v, tags)
    })

    await fetchAggregatedRating("tt1", "keyAAA")
    await fetchAggregatedRating("tt1", "keyBBB")

    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/^mdb:ratings:tt1:/)
    expect(keys[0]).not.toBe(keys[1])
    expect(keys[0]).not.toContain("keyAAA")
    expect(keys[1]).not.toContain("keyBBB")
    spy.mockRestore()
  })

  it("parsa correttamente tutte le fonti supportate (IMDb, TMDB, MDBList, Rotten Tomatoes, Popcorntime, Metacritic, SIMKL, Filmweb, Roger Ebert, AniList, Kitsu, etc.)", async () => {
    const multiSourceFetch = () => ({
      ok: true,
      json: async () => ({
        score: 75,
        ratings: [
          { source: "imdb", value: 8.4, score: 84 },
          { source: "tmdb", value: 8.0, score: 80 },
          { source: "tomatoes", value: 92, score: 92 },
          { source: "popcorn", value: 7.9, score: 79 },
          { source: "metacritic", value: 85, score: 85 },
          { source: "metacriticuser", value: 7.7, score: 77 },
          { source: "letterboxd", value: 4.1, score: 82 },
          { source: "trakt", value: 8.3, score: 83 },
          { source: "simkl", value: 8.1, score: 81 },
          { source: "filmweb", value: 7.6, score: 76 },
          { source: "filmweb_critics", value: 8.0, score: 80 },
          { source: "roger_ebert", value: 3.5 },
          { source: "myanimelist", value: 8.9, score: 89 },
          { source: "anilist", score: 86 },
          { source: "kitsu", score: 82 },
        ],
      }),
    })
    vi.stubGlobal("fetch", vi.fn(multiSourceFetch))

    const result = await fetchAggregatedRating("tt999")
    expect(result).not.toBeNull()
    expect(result?.sources.imdb).toBe(8.4)
    expect(result?.sources.tmdb).toBe(8.0)
    expect(result?.sources.mdblist).toBe(7.5)
    expect(result?.sources.tomatoes).toBe(9.2)
    expect(result?.sources.popcorntime).toBe(7.9)
    expect(result?.sources.metacritic).toBe(8.5)
    expect(result?.sources.metacriticuser).toBe(7.7)
    expect(result?.sources.letterboxd).toBe(8.2)
    expect(result?.sources.trakt).toBe(8.3)
    expect(result?.sources.simkl).toBe(8.1)
    expect(result?.sources.filmweb).toBe(7.6)
    expect(result?.sources.filmwebcritics).toBe(8.0)
    expect(result?.sources.rogerebert).toBe(8.8) // 3.5 * 2.5 = 8.75 -> 8.8
    expect(result?.sources.mal).toBe(8.9)
    expect(result?.sources.anilist).toBe(8.6)
    expect(result?.sources.kitsu).toBe(8.2)
    // Default average is between IMDb and TMDB
    expect(result?.average).toBe(8.2)
  })

  it("calculateAverageRating calcola la media in base alle fonti richieste", () => {
    const sample = {
      sources: {
        imdb: 8.0,
        tmdb: 9.0,
        tomatoes: 9.5,
        metacritic: 7.0,
      },
      average: 8.5,
      count: 4,
    }

    // Default: imdb + tmdb -> (8.0 + 9.0) / 2 = 8.5
    expect(calculateAverageRating(sample)).toBe(8.5)
    // Custom: tomatoes + metacritic -> (9.5 + 7.0) / 2 = 8.25
    expect(calculateAverageRating(sample, ["tomatoes", "metacritic"])).toBe(8.25)
    // Custom: solo metacritic -> 7.0
    expect(calculateAverageRating(sample, ["metacritic"])).toBe(7.0)
    // Fonte assente: ignora e usa le presenti
    expect(calculateAverageRating(sample, ["tomatoes", "letterboxd"])).toBe(9.5)
    // Nessuna fonte trovata -> null
    expect(calculateAverageRating(sample, ["letterboxd", "mal"])).toBeNull()
    expect(calculateAverageRating(null)).toBeNull()
  })

  it("tmdbFallbackVote riempie sources.tmdb solo se MDBList manca", async () => {
    // MDBList down (503) + voto diretto → backfill tmdb
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null } })))
    const down = await fetchAggregatedRating("tt_fb1", "k", undefined, { tmdbFallbackVote: 7.86 })
    expect(down?.sources.tmdb).toBe(7.9)
    expect(down?.sources.imdb).toBeUndefined()

    // MDBList ok con tmdb → vince MDBList, mai sovrascrittura
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ratings: [{ source: "tmdb", value: 8.2 }] }),
    })))
    const up = await fetchAggregatedRating("tt_fb2", "k", undefined, { tmdbFallbackVote: 7.0 })
    expect(up?.sources.tmdb).toBe(8.2)

    // Fallback invalido → ignorato
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, headers: { get: () => null } })))
    const bad = await fetchAggregatedRating("tt_fb3", "k", undefined, { tmdbFallbackVote: 0 })
    expect(bad).toBeNull()
  })
})

describe("pickSeparateRatings / formatSeparateValue (colonna separati)", () => {
  const sample = {
    sources: { imdb: 8.4, tmdb: 8.0, tomatoes: 9.2, popcorntime: 7.9 },
    average: 8.2,
    count: 4,
  }

  it("ordine di selezione, skip miss/zero, cap MAX_SEPARATE_RATINGS", () => {
    expect(MAX_SEPARATE_RATINGS).toBe(5)
    expect(pickSeparateRatings(sample, ["tmdb", "imdb"])).toEqual([
      { id: "tmdb", value: 8.0 },
      { id: "imdb", value: 8.4 },
    ])
    // Miss skippata, ordine preservato
    expect(pickSeparateRatings(sample, ["letterboxd", "tomatoes"])).toEqual([{ id: "tomatoes", value: 9.2 }])
    // Cap a 5: 4 disponibili passano tutti, in ordine di selezione
    expect(pickSeparateRatings(sample, ["imdb", "tmdb", "tomatoes", "popcorntime"])).toEqual([
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
      { id: "tomatoes", value: 9.2 },
      { id: "popcorntime", value: 7.9 },
    ])
    // Zero/mancanti → []
    expect(pickSeparateRatings(sample, ["letterboxd", "mal"])).toEqual([])
    expect(pickSeparateRatings(null, ["imdb"])).toEqual([])
    // Default imdb+tmdb senza selezione
    expect(pickSeparateRatings(sample)).toEqual([
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
    ])
  })

  it("cap a 5 con 6+ fonti: ordine rsrc preservato, miss/zero skippati prima del cap", () => {
    const six = {
      sources: { imdb: 8.4, tmdb: 8.0, tomatoes: 9.2, popcorntime: 7.9, letterboxd: 4.1, trakt: 7.5, mal: 0 },
      average: 7.5,
      count: 7,
    }
    expect(pickSeparateRatings(six, ["imdb", "tmdb", "tomatoes", "popcorntime", "letterboxd", "trakt", "mal"])).toEqual([
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
      { id: "tomatoes", value: 9.2 },
      { id: "popcorntime", value: 7.9 },
      { id: "letterboxd", value: 4.1 },
    ])
    // Miss/zero non consumano il cap: saltati prima di contare i visibili.
    expect(pickSeparateRatings(six, ["mal", "imdb", "tmdb", "tomatoes", "popcorntime", "letterboxd", "trakt"])).toEqual([
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
      { id: "tomatoes", value: 9.2 },
      { id: "popcorntime", value: 7.9 },
      { id: "letterboxd", value: 4.1 },
    ])
  })

  it("formato: decimale 1 cifra, percent per tomatoes/popcorntime", () => {
    expect(formatSeparateValue("imdb", 8.44)).toBe("8.4")
    expect(formatSeparateValue("tmdb", 8.0)).toBe("8.0")
    expect(formatSeparateValue("tomatoes", 9.2)).toBe("92%")
    expect(formatSeparateValue("popcorntime", 7.9)).toBe("79%")
  })
})

describe("parseRatingSources / resolveRatingSources (Fix D — parser unico rsrc)", () => {
  it("null quando assente; whitelist + lowercase + trim quando presente", () => {
    expect(parseRatingSources(null)).toBeNull()
    expect(parseRatingSources(undefined)).toBeNull()
    expect(parseRatingSources("IMDb, Tomatoes ")).toEqual(["imdb", "tomatoes"])
    expect(parseRatingSources("imdb,xyz,trakt")).toEqual(["imdb", "trakt"])
    expect(parseRatingSources("xyz")).toEqual([])
    expect(parseRatingSources("")).toEqual([])
  })

  it("catena query > mapping > config > defaults > imdb+tmdb; vuoti saltati", () => {
    expect(resolveRatingSources("trakt", ["imdb"], ["letterboxd"], ["metacritic"])).toEqual(["trakt"])
    expect(resolveRatingSources(null, ["imdb"], ["letterboxd"], ["metacritic"])).toEqual(["imdb"])
    expect(resolveRatingSources(null, null, ["letterboxd"], ["metacritic"])).toEqual(["letterboxd"])
    expect(resolveRatingSources(null, [], undefined, ["metacritic"])).toEqual(["metacritic"])
    expect(resolveRatingSources("xyz", ["imdb"])).toEqual(["imdb"])
    expect(resolveRatingSources(null)).toEqual(["imdb", "tmdb"])
  })
})
