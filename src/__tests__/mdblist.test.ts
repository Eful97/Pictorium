import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheInvalidate } from "@/lib/cache"

// `fetchMDBList` è il parsing del list endpoint MDBList usato dal rank anime
// (poster route + catalogo pictorium-anime). Nessun altro test lo copre: i
// mock dei test esistenti servono la forma normalizzata, mentre l'API reale
// (OpenAPI ufficiale api.mdblist.com) risponde `{ movies: [...], shows: [...] }`
// con gli item shows privi di `ids`/`tmdb` (l'id TMDB è il campo `id`).
// Questi test fissano il parsing sulla forma REALE.

// Forma reale documentata: /lists/{username}/{listname}/items
const realShapeResponse = {
  movies: [
    {
      id: 917496, rank: 1, title: "Beetlejuice Beetlejuice", imdb_id: "tt2049403",
      ids: { mdblist: "m917496", imdb: "tt2049403", tmdb: 917496 }, release_year: 2024,
    },
  ],
  shows: [
    { id: 258902, rank: 1, title: "English Teacher", imdb_id: "tt20782190", tvdb_id: 421968, language: "en", mediatype: "show", release_year: 2024 },
    { id: 241259, rank: 3, title: "Baby Reindeer", imdb_id: "tt13649112", tvdb_id: 417223, language: "en", mediatype: "show", release_year: 2024 },
  ],
}

describe("fetchMDBList", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Lo spy va ricreato a ogni test: restoreAllMocks() nell'afterEach
    // ripristina il fetch reale e uno spy persistente non intercetterebbe più.
    fetchSpy = vi.spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // La cache in-memory è condivisa tra i test dello stesso file: svuota le
    // entry mdblist per non far collidere chiavi/cache-hit tra i casi.
    cacheInvalidate("mdblist")
  })

  it("parses the real API shape { movies, shows }: tmdb from ids.tmdb for movies and from id for shows", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json(realShapeResponse))

    const items = await fetchMDBList("mdblistAnime", "test-key")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(items).toEqual([
      { imdb: "tt20782190", title: "English Teacher", year: 2024, tmdb: 258902 },
      { imdb: "tt13649112", title: "Baby Reindeer", year: 2024, tmdb: 241259 },
    ])
    // Il matching della poster route: Number(entry.tmdb) === tmdbId
    const idx = items.findIndex((e) => Number(e.tmdb) === 241259)
    expect(idx).toBe(1)
  })

  it("parses mdblistAnimeMovie correctly when API returns movies with empty shows array", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({
      movies: [
        {
          id: 1311031,
          rank: 1,
          title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
          imdb_id: "tt32820897",
          ids: { tmdb: 1311031, imdb: "tt32820897" },
          release_year: 2025,
        },
      ],
      shows: [],
    }))

    const items = await fetchMDBList("mdblistAnimeMovie", "test-key")

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(items).toEqual([
      {
        imdb: "tt32820897",
        title: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
        year: 2025,
        tmdb: 1311031,
      },
    ])
  })

  it("parses the normalized { items } shape used by the e2e mock server", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({
      items: [
        { imdb: "tt0499549", title: "Avatar: The Last Airbender", year: 2024, tmdb: 19995 },
      ],
    }))

    const items = await fetchMDBList("mdblistAnime", "test-key")

    expect(items).toEqual([{ imdb: "tt0499549", title: "Avatar: The Last Airbender", year: 2024, tmdb: 19995 }])
  })

  it("returns [] on HTTP error (keyless 503) without caching the failure", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ response: "False", error: "Invalid API key or Rate Limiter Reached!" }), { status: 503 }))

    const first = await fetchMDBList("mdblistAnime")
    expect(first).toEqual([])

    // Risultato vuoto NON cachato: il prossimo accesso ritenta il fetch.
    fetchSpy.mockResolvedValueOnce(Response.json({ items: [{ imdb: "tt1", title: "A", year: 2024, tmdb: 1 }] }))
    const second = await fetchMDBList("mdblistAnime")
    expect(second).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("caches non-empty results per key (no refetch) and keys differ between keys", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({ items: [{ imdb: "tt1", title: "A", year: 2024, tmdb: 1 }] }))
    await fetchMDBList("mdblistAnime", "key-a")

    // Stessa chiave: cache hit, nessun secondo fetch.
    const cached = await fetchMDBList("mdblistAnime", "key-a")
    expect(cached).toEqual([{ imdb: "tt1", title: "A", year: 2024, tmdb: 1 }])
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Chiave diversa: cache key diverso (hash), nuovo fetch.
    fetchSpy.mockResolvedValueOnce(Response.json({ items: [{ imdb: "tt2", title: "B", year: 2024, tmdb: 2 }] }))
    const other = await fetchMDBList("mdblistAnime", "key-b")
    expect(other).toEqual([{ imdb: "tt2", title: "B", year: 2024, tmdb: 2 }])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("returns [] for an unknown list key", async () => {
    const items = await fetchMDBList("not-a-list", "test-key")
    expect(items).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
