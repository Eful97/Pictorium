import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"
import { encodeConfig } from "@/lib/config-token"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import * as tmdbModule from "@/lib/tmdb"
import * as sdModule from "@/lib/server-defaults"
import * as storeModule from "@/lib/store"

vi.mock("@/lib/store", () => ({ getById: vi.fn(async () => null) }))
vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({})),
    getServerDefaultsChecked: vi.fn(async () => ({})),
    getServerDefaultsForUser: vi.fn(async () => ({})),
  }
})

function token(url: string, type: "movie" | "series"): string {
  return encodeConfig({
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "pill",
    rankingBadgeStyle: "pill",
    blurEnabled: true,
    blurIntensity: 12,
    blurFade: 45,
    blurDarkness: 55,
    gradientHeight: 50,
    networkLogo: true,
    autoRotateClean: false,
    customCatalogs: [{ id: "jwdyn", name: "JW dynamic", type, url, enabled: true }],
  })
}

beforeEach(() => {
  cacheClear()
  __resetJWRankingsCache()
  vi.restoreAllMocks()
  vi.mocked(storeModule.getById).mockResolvedValue(null)
  vi.mocked(sdModule.getServerDefaults).mockReturnValue({})
  vi.spyOn(tmdbModule, "resolveUserApiKeys").mockResolvedValue({
    tmdb: { key: "tmdb-key", source: "env" },
    mdblist: { key: undefined, source: "none" },
    tvdb: { key: undefined, source: "none" },
    simkl: { key: undefined, source: "none" },
    fanart: { key: undefined, source: "none" },
  })
})

describe("Stremio catalog served from a JustWatch dynamic custom catalog", () => {
  it("fetches the live JustWatch list and emits tmdb-resolvable metas", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("apis.justwatch.com")) {
        return Response.json({
          data: {
            newTitles: {
              edges: [
                { node: { objectType: "MOVIE", content: { title: "Alpha", originalReleaseYear: 2025, externalIds: { tmdbId: "101", imdbId: "tt0000101" } } } },
                { node: { objectType: "MOVIE", content: { title: "Beta", originalReleaseYear: 2024, externalIds: { tmdbId: "102", imdbId: "tt0000102" } } } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        })
      }
      const m = url.match(/\/movie\/(\d+)/)
      if (m) {
        return Response.json({
          id: Number(m[1]),
          title: m[1] === "101" ? "Alpha" : "Beta",
          release_date: "2025-01-01",
          poster_path: "/p.jpg",
          imdb_id: `tt0000${m[1]}`,
          genres: [],
        })
      }
      return Response.json({})
    })
    const t = token("justwatch:new?type=movie&country=IT", "movie")
    const req = new NextRequest(
      `http://localhost:3000/catalog/movie/pictorium-custom-movie-jwdyn.json?api_key=tmdb-key&config=${t}`,
    )
    const { pictoriumCatalog } = await import("@/lib/catalog-handler")
    const res = await pictoriumCatalog(req, "movie", "pictorium-custom-movie-jwdyn", null, t)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt0000101", "tt0000102"])
    expect(body.metas[0].poster).toContain("/api/poster/movie/101")
  })
})
