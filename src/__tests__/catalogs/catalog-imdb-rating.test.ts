/**
 * Catalog rows and /meta detail expose IMDb as `imdbRating`.
 *
 * Contract: Cinemeta IMDb is authoritative and unconditional (the field is
 * "IMDb"; the poster badge keeps following `rsrc`), TMDB `vote_average` is the
 * fail-open fallback. Addon passthrough rows keep the remote value verbatim.
 * The (0.1, 10] guard never emits a fake `0.0`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as catalogGET } from "@/app/catalog/[type]/[id]/route"
import { GET as metaGET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"
import { __resetCinemetaBreaker, __resetCinemetaNullForTest } from "@/lib/cinemeta"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { fetchAddonCatalogPage } from "@/lib/stremio-addon-server"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/stremio-addon-server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stremio-addon-server")>()
  return { ...mod, fetchAddonCatalogPage: vi.fn() }
})

const mockedGetById = vi.mocked(getById)
const mockedAddonPage = vi.mocked(fetchAddonCatalogPage)

const CINEMETA = "v3-cinemeta.strem.io"

function justWatchResponse(tmdbId: number, imdbId?: string | null): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          {
            streamingChartInfo: { rank: 1 },
            node: { content: { externalIds: { tmdbId, imdbId: imdbId ?? null } } },
          },
        ],
      },
    },
  })
}

interface CinemetaReply {
  status?: number
  body?: unknown
}

interface MockOptions {
  cinemeta?: (imdbId: string) => CinemetaReply
  detailsVote?: number
  detailsExternalImdb?: string | null
  /** Counts Cinemeta calls per test (URL matching the Cinemeta host). */
  cinemetaCalls?: string[]
}

/**
 * URL-routed transport: unlike ordered `mockResolvedValueOnce` chains this
 * keeps working when the Cinemeta fetch is appended to a row (and it fails
 * closed for every unexpected URL).
 */
function mockTransport(opts: MockOptions = {}) {
  const cinemetaCalls = opts.cinemetaCalls ?? []
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const u = String(input)
    if (u.includes(CINEMETA)) {
      const imdbId = u.match(/\/meta\/(?:movie|series)\/([^./]+)\.json/)?.[1] ?? ""
      cinemetaCalls.push(decodeURIComponent(imdbId))
      const reply = opts.cinemeta?.(decodeURIComponent(imdbId)) ?? { body: { meta: {} } }
      return Response.json(reply.body ?? {}, { status: reply.status ?? 200 })
    }
    if (u.includes("justwatch") || u.includes("graphql")) {
      return justWatchResponse(94997, "tt11198330")
    }
    if (u.includes("/find/")) {
      return Response.json({ movie_results: [{ id: 550 }], tv_results: [] })
    }
    if (u.includes("/external_ids")) {
      return Response.json({ id: 550, imdb_id: opts.detailsExternalImdb ?? null })
    }
    if (u.includes("/images")) {
      return Response.json({ id: 550, logos: [] })
    }
    if (/\/(movie|tv)\/\d+/.test(u)) {
      const id = Number(u.match(/\/(?:movie|tv)\/(\d+)/)?.[1] ?? 0)
      return Response.json({
        id,
        title: "House of the Dragon",
        name: "House of the Dragon",
        genres: [],
        vote_average: opts.detailsVote ?? 8.4,
        release_date: "2024-01-01",
        first_air_date: "2024-01-01",
        backdrop_path: null,
        overview: "Overview",
        ...(opts.detailsExternalImdb !== undefined
          ? { external_ids: { imdb_id: opts.detailsExternalImdb } }
          : {}),
      })
    }
    return Response.json({}, { status: 404 })
  })
}

function freshCaches(): void {
  cacheClear()
  __resetJWRankingsCache()
  __clearTMDBCache()
  __clearImdbCache()
  __resetCinemetaBreaker()
  __resetCinemetaNullForTest()
  __resetChartGenerationForTest()
}

async function getJwSeries() {
  const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
  const res = await catalogGET(req, { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) })
  const body = await res.json()
  return { res, body }
}

async function getMeta(id: string, type: "movie" | "series" = "movie") {
  const req = new NextRequest(`http://localhost:3000/meta/${type}/${id}.json?api_key=settings-key`)
  const res = await metaGET(req, { params: Promise.resolve({ type, id: `${id}.json` }) })
  const body = await res.json()
  return { res, body }
}

beforeEach(() => {
  mockedGetById.mockResolvedValue(null)
  freshCaches()
})

afterEach(() => {
  vi.mocked(getServerDefaults).mockReturnValue({})
  vi.restoreAllMocks()
  mockedGetById.mockReset()
  mockedAddonPage.mockReset()
  freshCaches()
})

describe("catalog rows imdbRating (Cinemeta IMDb, TMDB fail-open)", () => {
  it("prefers the Cinemeta IMDb rating over TMDB vote_average", async () => {
    mockTransport({ cinemeta: () => ({ body: { meta: { imdbRating: "9.1" } } }), detailsVote: 8.4 })
    const { res, body } = await getJwSeries()
    expect(res.status).toBe(200)
    expect(body.metas[0].imdbRating).toBe("9.1")
  })

  it("falls back to TMDB when Cinemeta has no rating (miss)", async () => {
    mockTransport({ cinemeta: () => ({ body: { meta: {} } }), detailsVote: 8.4 })
    const { body } = await getJwSeries()
    expect(body.metas[0].imdbRating).toBe("8.4")
  })

  it("falls back to TMDB on a Cinemeta 429", async () => {
    const calls: string[] = []
    mockTransport({
      cinemeta: () => ({ status: 429, body: {} }),
      detailsVote: 7.2,
      cinemetaCalls: calls,
    })
    const { res, body } = await getJwSeries()
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(body.metas[0].imdbRating).toBe("7.2")
  })

  it("never calls Cinemeta and keeps TMDB when the row has no IMDb id", async () => {
    const calls: string[] = []
    // JustWatch omits the imdbId and the details append is null.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("justwatch") || u.includes("graphql")) return justWatchResponse(94997, null)
      if (u.includes(CINEMETA)) {
        calls.push(u)
        return Response.json({ meta: { imdbRating: "9.9" } })
      }
      if (u.includes("/external_ids")) return Response.json({ id: 94997, imdb_id: null })
      if (u.includes("/images")) return Response.json({ id: 94997, logos: [] })
      if (/\/(movie|tv)\/\d+/.test(u)) {
        return Response.json({
          id: 94997, name: "House of the Dragon", genres: [], vote_average: 6.6,
          first_air_date: "2022-08-21", backdrop_path: null, overview: "Overview",
          external_ids: { imdb_id: null },
        })
      }
      return Response.json({}, { status: 404 })
    })
    const { body } = await getJwSeries()
    expect(calls).toHaveLength(0)
    expect(body.metas[0].id).toBe("tmdb:94997")
    expect(body.metas[0].imdbRating).toBe("6.6")
  })

  it("omits imdbRating (never 0.0) when neither source has a usable vote", async () => {
    mockTransport({ cinemeta: () => ({ body: { meta: {} } }), detailsVote: 0 })
    const { body } = await getJwSeries()
    expect(body.metas[0].imdbRating).toBeUndefined()
  })
})

describe("/meta detail imdbRating (Cinemeta IMDb, TMDB fail-open)", () => {
  it("prefers the Cinemeta IMDb rating over TMDB vote_average", async () => {
    const calls: string[] = []
    mockTransport({ cinemeta: () => ({ body: { meta: { imdbRating: "9.2" } } }), detailsVote: 8.4, cinemetaCalls: calls })
    const { res, body } = await getMeta("tt0137523")
    expect(res.status).toBe(200)
    expect(calls).toEqual(["tt0137523"])
    expect(body.meta.imdbRating).toBe("9.2")
  })

  it("falls back to TMDB when Cinemeta misses", async () => {
    mockTransport({ cinemeta: () => ({ body: { meta: {} } }), detailsVote: 8.4 })
    const { body } = await getMeta("tt0137523")
    expect(body.meta.imdbRating).toBe("8.4")
  })

  it("never returns 500 and keeps TMDB on a Cinemeta 429", async () => {
    mockTransport({ cinemeta: () => ({ status: 429, body: {} }), detailsVote: 8.4 })
    const { res, body } = await getMeta("tt0137523")
    expect(res.status).toBe(200)
    expect(body.meta.imdbRating).toBe("8.4")
  })
})

describe("addon passthrough rows", () => {
  it("keeps the remote imdbRating (no Cinemeta override)", async () => {
    const ADDON = {
      id: "cat_addon",
      name: "Addon Top",
      type: "movie",
      url: "https://addon.example/manifest.json",
      enabled: true,
      addon: {
        manifestUrl: "https://addon.example/manifest.json",
        catalogId: "top",
        catalogType: "movie",
      },
    }
    vi.mocked(getServerDefaults).mockReturnValue({ customCatalogs: [ADDON] } as never)
    mockedAddonPage.mockResolvedValue({
      items: [{ id: "tt0111161", name: "The Shawshank Redemption", imdbRating: "7.7" }],
    })
    const calls: string[] = []
    mockTransport({ cinemetaCalls: calls })
    const req = new NextRequest(
      "http://localhost:3000/catalog/movie/pictorium-custom-movie-cat_addon.json?api_key=settings-key",
    )
    const res = await catalogGET(req, {
      params: Promise.resolve({ type: "movie", id: "pictorium-custom-movie-cat_addon.json" }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.metas[0].id).toBe("tt0111161")
    expect(body.metas[0].imdbRating).toBe("7.7")
    expect(calls).toHaveLength(0)
    expect(mockedAddonPage).toHaveBeenCalledTimes(1)
  })
})
