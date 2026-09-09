import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { getById } from "@/lib/store"
import { __resetJWRankingsCache } from "@/lib/justwatch"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", () => ({
  getServerDefaults: vi.fn(() => ({})),
}))

const mockedGetById = vi.mocked(getById)

function justWatchPopularTitlesResponse(items: Array<{ tmdbId: number; title: string; imdbId?: string; date?: string }>): Response {
  return Response.json({
    data: {
      popularTitles: {
        edges: items.map((item) => ({
          node: {
            objectType: "MOVIE",
            content: {
              title: item.title,
              originalReleaseDate: item.date ?? "2026-01-01",
              externalIds: { tmdbId: item.tmdbId, imdbId: item.imdbId ?? null },
            },
          },
        })),
      },
    },
  })
}

function justWatchStreamingChartResponse(tmdbId: number, imdbId?: string): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          {
            streamingChartInfo: { rank: 1 },
            node: {
              content: {
                title: "Mock Title",
                externalIds: { tmdbId, imdbId: imdbId ?? null },
              },
            },
          },
        ],
      },
    },
  })
}

function tmdbDetailsResponse(tmdbId: number, title: string): Response {
  return Response.json({
    id: tmdbId,
    title,
    name: title,
    poster_path: "/poster.jpg",
    first_air_date: "2026-01-01",
    release_date: "2026-01-01",
    vote_average: 8.2,
    genres: [{ id: 878, name: "Fantascienza" }],
  })
}

describe("New JustWatch Catalogs & Genre Filtering", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
    __resetJWRankingsCache()
    cacheClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    __resetJWRankingsCache()
    cacheClear()
  })

  it("serves Crunchyroll catalog using cru package", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(justWatchStreamingChartResponse(201, "tt201"))
      .mockResolvedValueOnce(tmdbDetailsResponse(201, "One Piece"))

    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-crunchyroll-series.json?api_key=test-api-key")
    const res = await GET(req, { params: Promise.resolve({ type: "series", id: "pictorium-crunchyroll-series.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].name).toBe("One Piece")
    expect(body.metas[0].poster).toContain("/api/poster/series/201")
  })

  it("filters platform catalog by genre using JustWatch genre codes", async () => {
    let capturedBody: string | undefined

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        capturedBody = init?.body as string
        return justWatchPopularTitlesResponse([
          { tmdbId: 301, title: "Interstellar", imdbId: "tt0816692", date: "2014-11-07" },
        ])
      }
      return tmdbDetailsResponse(301, "Interstellar")
    })

    const req = new NextRequest("http://localhost:3000/catalog/movie/pictorium-netflix-movies.json?genre=Fantascienza&api_key=test-api-key")
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-netflix-movies.json" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].name).toBe("Interstellar")
    expect(capturedBody).toBeDefined()
    expect(capturedBody).toContain('"scf"') // Codice genere JustWatch per Fantascienza
    expect(capturedBody).toContain('"nfx"') // Package JustWatch per Netflix
  })

  it("includes crunchyroll in STREAMING_PLATFORMS", async () => {
    const { STREAMING_PLATFORMS } = await import("@/lib/utils")
    const slugs = STREAMING_PLATFORMS.map((p) => p.slug)
    expect(slugs).toContain("crunchyroll")
    expect(slugs).not.toContain("raiplay")
    expect(slugs).not.toContain("infinity")
  })

  it("getTop10 supports crunchyroll with popular titles fallback", async () => {
    const { getTop10 } = await import("@/lib/flixpatrol")
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        return justWatchPopularTitlesResponse([
          { tmdbId: 501, title: "Demon Slayer", imdbId: "tt501", date: "2026-01-01" },
        ])
      }
      return tmdbDetailsResponse(501, "Demon Slayer")
    })

    const data = await getTop10("crunchyroll", "italy", "test-key", { enrich: true })
    expect(data.platform).toBe("crunchyroll")
    expect(data.platformName).toBe("Crunchyroll")
    expect(data.movies[0]?.title).toBe("Demon Slayer")
  })
})
