import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  __resetFanartCache,
  FanartError,
  getFanartPosters,
  normalizeFanartPosters,
} from "@/lib/fanart"
import { __clearTMDBCache } from "@/lib/tmdb"

const MOVIE_JSON = {
  tmdb_id: "123",
  movieposter: [
    { id: "1", url: "https://assets.fanart.tv/fanart/movies/123/movieposter/a.jpg", lang: "en", likes: "10" },
    { id: "2", url: "https://assets.fanart.tv/fanart/movies/123/movieposter/b.jpg", lang: "it", likes: "42" },
    { id: "3", url: "https://assets.fanart.tv/fanart/movies/123/movieposter/c.jpg", lang: "00", likes: "3" },
  ],
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  process.env.PICTORIUM_FANART_KEY = "test-project-key"
  delete process.env.FANART_API_URL
  __resetFanartCache()
  __clearTMDBCache()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  __resetFanartCache()
})

describe("normalizeFanartPosters", () => {
  it("ordina per likes desc", () => {
    const out = normalizeFanartPosters(MOVIE_JSON.movieposter)
    expect(out.map((p) => p.url)).toEqual([
      "https://assets.fanart.tv/fanart/movies/123/movieposter/b.jpg",
      "https://assets.fanart.tv/fanart/movies/123/movieposter/a.jpg",
      "https://assets.fanart.tv/fanart/movies/123/movieposter/c.jpg",
    ])
    expect(out[0]).toMatchObject({ lang: "it", likes: 42 })
  })

  it("conserva la lingua ignota senza marcarla come textless", () => {
    const out = normalizeFanartPosters([{ url: "https://assets.fanart.tv/x.jpg", lang: "00", likes: "1" }])
    expect(out[0]?.lang).toBe("00")
    const missing = normalizeFanartPosters([{ url: "https://assets.fanart.tv/y.jpg", likes: "1" }])
    expect(missing[0]?.lang).toBeNull()
  })

  it("deduplica per URL tenendo i likes massimi e scarta non-http", () => {
    const out = normalizeFanartPosters([
      { url: "https://assets.fanart.tv/x.jpg", lang: "en", likes: "2" },
      { url: "https://assets.fanart.tv/x.jpg", lang: "en", likes: "9" },
      { url: "ftp://assets.fanart.tv/z.jpg", lang: "en", likes: "99" },
      { url: "nota-url", lang: "en", likes: "99" },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ url: "https://assets.fanart.tv/x.jpg", likes: 9 })
  })
})

describe("getFanartPosters", () => {
  it("film: chiama /movies/{tmdbId} e normalizza", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOVIE_JSON))
    const posters = await getFanartPosters("movie", 123)
    expect(fetchSpy).toHaveBeenCalledOnce()
    const calledUrl = String(fetchSpy.mock.calls[0]?.[0])
    expect(calledUrl).toContain("/movies/123")
    expect(calledUrl).toContain("api_key=test-project-key")
    expect(posters).toHaveLength(3)
    expect(posters[0]?.likes).toBe(42)
  })

  it("film: 404 = assenza confermata ([]), non errore", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }))
    await expect(getFanartPosters("movie", 999)).resolves.toEqual([])
  })

  it("film: 401 = FanartError auth (mai cachato come vuoto)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }))
    await expect(getFanartPosters("movie", 123)).rejects.toMatchObject({ code: "auth" })
  })

  it("film: 5xx = FanartError upstream", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }))
    await expect(getFanartPosters("movie", 123)).rejects.toMatchObject({ code: "upstream" })
  })

  it("senza chiave progetto = FanartError not_configured", async () => {
    delete process.env.PICTORIUM_FANART_KEY
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await expect(getFanartPosters("movie", 123)).rejects.toMatchObject({ code: "not_configured" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("serie: risolve tvdb_id via TMDB e chiama /tv/{tvdbId} (mai il TMDB-id)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("api.themoviedb.org")) {
        return jsonResponse({ id: 456, tvdb_id: 75710 })
      }
      return jsonResponse({ tvdb_id: 75710, tvposter: [{ id: "9", url: "https://assets.fanart.tv/fanart/tv/75710/tvposter/x.jpg", lang: "en", likes: "7" }] })
    })
    const posters = await getFanartPosters("tv", 456, { tmdbApiKey: "tmdb-key" })
    const fanartCall = fetchSpy.mock.calls.map((c) => String(c[0])).find((u) => u.includes("fanart"))
    expect(fanartCall).toContain("/tv/75710")
    expect(fanartCall).not.toContain("/tv/456")
    expect(posters).toHaveLength(1)
  })

  it("serie senza tvdb_id: [] senza interrogare Fanart", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("api.themoviedb.org")) return jsonResponse({ id: 789 })
      throw new Error("fanart must not be called")
    })
    await expect(getFanartPosters("tv", 789, { tmdbApiKey: "tmdb-key" })).resolves.toEqual([])
    expect(fetchSpy.mock.calls.map((c) => String(c[0])).some((u) => u.includes("fanart"))).toBe(false)
  })

  it("serie con external_ids in errore: upstream, non []", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("api.themoviedb.org")) {
        return new Response("{}", { status: 500 })
      }
      return jsonResponse({})
    })
    await expect(getFanartPosters("tv", 456, { tmdbApiKey: "tmdb-key" })).rejects.toBeInstanceOf(FanartError)
  })

  it("hit in cache: secondo call senza rete", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOVIE_JSON))
    await getFanartPosters("movie", 123)
    await getFanartPosters("movie", 123)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it("due credenziali diverse condividono la cache (chiave progetto globale)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOVIE_JSON))
    await getFanartPosters("movie", 123, { tmdbApiKey: "tmdb-a" })
    await getFanartPosters("movie", 123, { tmdbApiKey: "tmdb-b" })
    // TMDB key diversa, ma la cache Fanart è per titolo (progetto globale).
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("la chiave dello spazio vince sull'env d'istanza", async () => {
    process.env.PICTORIUM_FANART_KEY = "env-key"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("api_key=space-key")) return jsonResponse(MOVIE_JSON)
      return new Response("{}", { status: 401 })
    })
    const posters = await getFanartPosters("movie", 123, { fanartKey: "space-key" })
    expect(posters).toHaveLength(3)
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("api_key=space-key")
  })
})
