import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { getById } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => "e1"),
  bumpCatalogEpoch: vi.fn(async () => "e1"),
}))

const mockedGetById = vi.mocked(getById)

describe("meta links (stremio-core categories)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
  })

  it("exposes Genres discover links and the IMDb title link", async () => {
    vi.spyOn(globalThis, "fetch")
      // /find/tt0137523
      .mockResolvedValueOnce(Response.json({
        movie_results: [{ id: 550, title: "Fight Club" }],
      }))
      // /movie/550 details
      .mockResolvedValueOnce(Response.json({
        id: 550,
        title: "Fight Club",
        overview: "Un impiegato insonne...",
        release_date: "1999-10-15",
        genres: [{ id: 18, name: "Dramma" }, { id: 53, name: "Thriller" }],
        backdrop_path: "/backdrop.jpg",
        external_ids: { imdb_id: "tt0137523" },
        credits: { cast: [], crew: [] },
        videos: { results: [] },
      }))
      // /movie/550/images
      .mockResolvedValueOnce(Response.json({ id: 550, logos: [] }))

    const req = new NextRequest("http://localhost:3000/meta/movie/tt0137523.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tt0137523.json" }) })
    const { meta } = await res.json()

    const manifestUrl = encodeURIComponent("http://localhost:3000/manifest.json")
    expect(meta.links).toEqual([
      {
        name: "Dramma",
        category: "Genres",
        url: `stremio:///discover/${manifestUrl}/movie/pictorium-jw-movies?genre=Dramma`,
      },
      {
        name: "Thriller",
        category: "Genres",
        url: `stremio:///discover/${manifestUrl}/movie/pictorium-jw-movies?genre=Thriller`,
      },
      {
        name: "IMDb",
        category: "imdb",
        url: "https://www.imdb.com/title/tt0137523/",
      },
    ])
  })

  it("keeps only the genre links when no valid IMDb id is resolved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const value = String(url)
      if (value.includes("/find/")) return Promise.resolve(Response.json({ movie_results: [{ id: 550 }] }))
      if (value.includes("/external_ids")) return Promise.resolve(Response.json({ id: 550, imdb_id: null }))
      if (value.includes("/images")) return Promise.resolve(Response.json({ id: 550, logos: [] }))
      return Promise.resolve(Response.json({
        id: 550,
        title: "Fight Club",
        genres: [{ id: 18, name: "Dramma" }],
        external_ids: {},
        credits: { cast: [], crew: [] },
        videos: { results: [] },
      }))
    })

    const req = new NextRequest("http://localhost:3000/meta/movie/tmdb:550.json?api_key=settings-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "tmdb:550.json" }) })
    const { meta } = await res.json()

    expect(meta.links).toHaveLength(1)
    expect(meta.links[0]).toMatchObject({ name: "Dramma", category: "Genres" })
    expect(meta.links.some((link: { category: string }) => link.category === "imdb")).toBe(false)
  })
})
