import { describe, it, expect, vi, beforeEach } from "vitest"
import { detectCatalogProvider, fetchUnifiedCatalogItems } from "@/lib/custom-catalog-providers"

describe("detectCatalogProvider", () => {
  it("detects Letterboxd list URL", () => {
    const res = detectCatalogProvider("https://letterboxd.com/arinbicer/list/mcu/")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("letterboxd")
    expect(res?.nameSuggestion).toBe("Mcu")
    expect(res?.defaultType).toBe("mixed")
  })

  it("detects Letterboxd watchlist URL", () => {
    const res = detectCatalogProvider("https://letterboxd.com/dave/watchlist/")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("letterboxd")
    expect(res?.nameSuggestion).toBe("Watchlist di dave")
    expect(res?.defaultType).toBe("mixed")
  })

  it("detects Trakt list URL", () => {
    const res = detectCatalogProvider("https://trakt.tv/users/donxy/lists/marvel-cinematic-universe")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("trakt")
    expect(res?.nameSuggestion).toBe("Marvel Cinematic Universe")
    expect(res?.defaultType).toBe("mixed")
  })

  it("detects TMDb Collection URL with slug and generates nameSuggestion", () => {
    const res = detectCatalogProvider("https://www.themoviedb.org/collection/86311-the-avengers-collection")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("tmdb_collection")
    expect(res?.identifier).toBe("86311")
    expect(res?.nameSuggestion).toBe("The Avengers Collection")
    expect(res?.defaultType).toBe("movie")
  })

  it("detects TMDb Collection URL without slug", () => {
    const res = detectCatalogProvider("https://themoviedb.org/collection/86311")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("tmdb_collection")
    expect(res?.identifier).toBe("86311")
    expect(res?.nameSuggestion).toBe("TMDb Collezione 86311")
  })

  it("detects TMDb List URL with slug and generates nameSuggestion", () => {
    const res = detectCatalogProvider("https://www.themoviedb.org/list/8249673-marvel-cinematic-universe")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("tmdb_list")
    expect(res?.identifier).toBe("8249673")
    expect(res?.nameSuggestion).toBe("Marvel Cinematic Universe")
    expect(res?.defaultType).toBe("movie")
  })

  it("detects TMDb List URL without slug and with user path", () => {
    const res = detectCatalogProvider("https://themoviedb.org/u/stanlee/list/8249673")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("tmdb_list")
    expect(res?.identifier).toBe("8249673")
    expect(res?.nameSuggestion).toBe("TMDb Lista 8249673")
  })

  it("detects tmdb: prefix for collection and list", () => {
    const resCol = detectCatalogProvider("tmdb:collection:86311")
    expect(resCol?.provider).toBe("tmdb_collection")
    expect(resCol?.identifier).toBe("86311")

    const resList = detectCatalogProvider("tmdb:list:8249673")
    expect(resList?.provider).toBe("tmdb_list")
    expect(resList?.identifier).toBe("8249673")
  })

  it("detects TheTVDB list URL", () => {
    const res = detectCatalogProvider("https://thetvdb.com/lists/top-shows")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("tvdb")
    expect(res?.identifier).toBe("top-shows")
  })

  it("detects IMDb list URL", () => {
    const res = detectCatalogProvider("https://www.imdb.com/list/ls000000000/")
    expect(res).not.toBeNull()
    expect(res?.provider).toBe("imdb")
    expect(res?.identifier).toBe("ls000000000")
  })



  it("falls back to MDBList for other URLs or slugs", () => {
    const res = detectCatalogProvider("https://mdblist.com/lists/snoak/sky-now-top10")
    expect(res?.provider).toBe("mdblist")

    const resSlug = detectCatalogProvider("snoak/trending-movies")
    expect(resSlug?.provider).toBe("mdblist")
  })

  it("returns null for empty input", () => {
    expect(detectCatalogProvider("")).toBeNull()
    expect(detectCatalogProvider("   ")).toBeNull()
  })
})

describe("fetchUnifiedCatalogItems", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns empty array on empty input", async () => {
    const items = await fetchUnifiedCatalogItems("")
    expect(items).toEqual([])
  })

  it("fetches Letterboxd list through HEAD + StremThru", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === "HEAD") {
        return Promise.resolve({
          ok: true,
          headers: new Headers({
            "x-letterboxd-identifier": "1XEE4",
          }),
        })
      }
      if (typeof url === "string" && url.includes("stremthru")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              title: "MCU",
              items: [
                {
                  id: "28dA",
                  title: "Iron Man",
                  year: 2008,
                  type: "movie",
                  id_map: { imdb: "tt0371746", tmdb: "1726" },
                },
                {
                  id: "28dB",
                  title: "The Incredible Hulk",
                  year: 2008,
                  type: "movie",
                  id_map: { imdb: "tt0800080", tmdb: "1724" },
                },
              ],
            },
          }),
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    }) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems("https://letterboxd.com/arinbicer/list/mcu/")
    expect(items.length).toBe(2)
    expect(items[0].title).toBe("Iron Man")
    expect(items[0].imdb).toBe("tt0371746")
    expect(items[0].tmdb).toBe(1726)
    expect(items[0].mediatype).toBe("movie")
  })

  it("fetches TMDb collection with poster_path", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/collection/86311")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 86311,
            name: "The Avengers Collection",
            parts: [
              {
                id: 24428,
                title: "The Avengers",
                release_date: "2012-04-25",
                poster_path: "/avengers.jpg",
              },
              {
                id: 99861,
                title: "Avengers: Age of Ultron",
                release_date: "2015-04-22",
                poster_path: "/ultron.jpg",
              },
            ],
          }),
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    }) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems("https://www.themoviedb.org/collection/86311-the-avengers-collection", { apiKey: "test-tmdb-key" })
    expect(items.length).toBe(2)
    expect(items[0].title).toBe("The Avengers")
    expect(items[0].tmdb).toBe(24428)
    expect(items[0].year).toBe(2012)
    expect(items[0].poster_path).toBe("/avengers.jpg")
    expect(items[0].mediatype).toBe("movie")
  })

  it("fetches TMDb v3 list with items", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/3/list/8249673")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "8249673",
            name: "MCU",
            items: [
              {
                id: 1726,
                title: "Iron Man",
                release_date: "2008-04-30",
                poster_path: "/ironman.jpg",
              },
            ],
          }),
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    }) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems("https://www.themoviedb.org/list/8249673-marvel-cinematic-universe", { apiKey: "test-tmdb-key" })
    expect(items.length).toBe(1)
    expect(items[0].title).toBe("Iron Man")
    expect(items[0].tmdb).toBe(1726)
    expect(items[0].poster_path).toBe("/ironman.jpg")
  })

  it("fetches TMDb v4 list when v3 returns 404", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/3/list/999999")) {
        return Promise.resolve({ ok: false, status: 404 })
      }
      if (typeof url === "string" && url.includes("/4/list/999999")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            name: "Modern List",
            results: [
              {
                id: 550,
                title: "Fight Club",
                release_date: "1999-10-15",
                poster_path: "/fightclub.jpg",
              },
            ],
          }),
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    }) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems("https://themoviedb.org/list/999999", { apiKey: "test-tmdb-key" })
    expect(items.length).toBe(1)
    expect(items[0].title).toBe("Fight Club")
    expect(items[0].tmdb).toBe(550)
    expect(items[0].year).toBe(1999)
    expect(items[0].poster_path).toBe("/fightclub.jpg")
  })

  it("fetches multi-page TMDb lists across multiple pages", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/3/list/310") && url.includes("page=2")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "310",
            total_pages: 2,
            items: [
              {
                id: 200,
                title: "Movie Page 2",
                release_date: "2010-01-01",
                poster_path: "/p2.jpg",
              },
            ],
          }),
        })
      }
      if (typeof url === "string" && url.includes("/3/list/310")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "310",
            total_pages: 2,
            items: [
              {
                id: 100,
                title: "Movie Page 1",
                release_date: "2009-01-01",
                poster_path: "/p1.jpg",
              },
            ],
          }),
        })
      }
      return Promise.resolve({ ok: false, status: 404 })
    }) as unknown as typeof fetch

    const items = await fetchUnifiedCatalogItems("https://www.themoviedb.org/list/310-my-movie-list", { apiKey: "test-tmdb-key" })
    expect(items.length).toBe(2)
    expect(items[0].title).toBe("Movie Page 1")
    expect(items[1].title).toBe("Movie Page 2")
    expect(items[1].poster_path).toBe("/p2.jpg")
  })

  it("isolates cache entries per API key (no cross-user poisoning)", async () => {
    // Stesso URL, chiavi diverse → payload diversi: senza hash delle chiavi
    // nel cache key, il fallback pubblico senza chiave avvelenava la vista
    // keyed (e viceversa).
    const calls: string[] = []
    global.fetch = vi.fn().mockImplementation((url: string) => {
      calls.push(url)
      const title = typeof url === "string" && url.includes("apikey=KEY-ONE") ? "Movie One" : "Movie Two"
      return Promise.resolve({
        ok: true,
        json: async () => [{ imdb_id: "tt0000001", title, year: 2020, tmdb_id: 1 }],
      })
    }) as unknown as typeof fetch

    const url = "https://mdblist.com/lists/snoak/keyed-cache-test"
    const one = await fetchUnifiedCatalogItems(url, { mdblistKey: "KEY-ONE" })
    const two = await fetchUnifiedCatalogItems(url, { mdblistKey: "KEY-TWO" })
    expect(one[0]?.title).toBe("Movie One")
    expect(two[0]?.title).toBe("Movie Two")

    // Stessa chiave → cache hit, nessun refetch.
    const again = await fetchUnifiedCatalogItems(url, { mdblistKey: "KEY-ONE" })
    expect(again[0]?.title).toBe("Movie One")
    expect(calls.length).toBe(2)
  })
})
