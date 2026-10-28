/**
 * Global Top 20 catalog driven by an imported Top 10 streaming list.
 *
 * The JW catalog must serve the SAME published rows (and official 1..10
 * order/ranks) of the selected streaming family — selection country
 * coordinates, zero JustWatch traffic, no filled positions past the Top 10.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn() }
})

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear, cacheInvalidate } from "@/lib/cache"
import { familySlotKey, __resetChartGenerationForTest } from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { getById } from "@/lib/store"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { getServerDefaults } from "@/lib/server-defaults"
import { streamingCatalogId } from "@/lib/streaming-catalogs"

const mockedGetById = vi.mocked(getById)
const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)
const mockedDefaults = vi.mocked(getServerDefaults)

const NETFLIX_MOVIES_ID = streamingCatalogId("netflix", "IT", "movies")

function mockTmdbFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
    const u = String(url)
    if (u.includes("justwatch") || u.includes("graphql")) {
      throw new Error("JustWatch must not be touched for a streaming ranking source")
    }
    if (u.includes("/external_ids")) {
      const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
      const id = Number(m?.[1] ?? m?.[2] ?? 0)
      return Response.json({ id, imdb_id: `tt90000${String(id).padStart(2, "0")}` })
    }
    if (u.includes("/images")) return Response.json({ logos: [] })
    if (/\/(movie|tv)\/\d+/.test(u)) {
      const m = u.match(/\/(movie|tv)\/(\d+)/)
      const id = Number(m?.[2] ?? 0)
      return Response.json({
        id,
        title: `Pinned ${id}`,
        name: `Pinned ${id}`,
        genres: [],
        vote_average: 7.5,
        release_date: "2024-01-01",
        first_air_date: "2024-01-01",
        backdrop_path: null,
        overview: "Overview",
      })
    }
    throw new Error(`unexpected fetch ${u}`)
  })
}

function pinWith(rows: Array<{ tmdbId: number; rank: number; title: string }>) {
  const generation = familySlotKey("stream:netflix:movie")
  return {
    id: generation,
    snapshot: {
      generation,
      group: "g",
      family: "stream:netflix:movie",
      status: "ok",
      rows: rows.map((r) => ({ imdbId: null, ...r })),
      fetchedAt: 1,
      publishedAt: 2,
      provenance: "flixpatrol",
    },
  }
}

async function getJwCatalog(stType: "movie" | "series") {
  const req = new NextRequest(`http://localhost:3000/catalog/${stType}/pictorium-jw-${stType}s.json?api_key=test-key`)
  const res = await GET(req, {
    params: Promise.resolve({ type: stType, id: `pictorium-jw-${stType}s.json` }),
  })
  const body = (await res.json()) as { metas: Array<{ id: string; name: string; poster: string }> }
  return { res, body }
}

beforeEach(() => {
  mockedGetById.mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  mockedGetById.mockReset()
  mockedDefaults.mockReset()
  mockedEnsureFresh.mockReset()
  cacheClear()
  cacheInvalidate("catalog")
  cacheInvalidate("stremio")
  __clearTMDBCache()
  __clearImdbCache()
  __resetChartGenerationForTest()
})

describe("global Top 20 catalog driven by an imported Top 10 list", () => {
  it("serves the pinned streaming rows in official order with zero JW traffic", async () => {
    mockedDefaults.mockReturnValue({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    } as never)
    mockedEnsureFresh.mockResolvedValue(pinWith([
      { tmdbId: 7701, rank: 1, title: "First" },
      { tmdbId: 7702, rank: 2, title: "Second" },
      { tmdbId: 7703, rank: 3, title: "Third" },
    ]) as never)
    const fetchSpy = mockTmdbFetch()

    const { res, body } = await getJwCatalog("movie")
    expect(res.status).toBe(200)
    expect(body.metas.map((m) => m.name)).toEqual(["Pinned 7701", "Pinned 7702", "Pinned 7703"])
    // Selection country coordinates, never the request/global region.
    expect(mockedEnsureFresh).toHaveBeenCalledWith(
      expect.objectContaining({
        family: "stream:netflix:movie",
        regionCode: "IT",
        regionLang: "it-IT",
      }),
    )
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(calledUrls.some((u) => u.includes("justwatch"))).toBe(false)
  })

  it("serves an empty window past the Top 10 instead of inventing 11..20", async () => {
    mockedDefaults.mockReturnValue({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    } as never)
    mockedEnsureFresh.mockResolvedValue(pinWith([
      { tmdbId: 7701, rank: 1, title: "First" },
    ]) as never)
    mockTmdbFetch()

    const req = new NextRequest(
      `http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=20`,
    )
    const res = await GET(req, {
      params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }),
    })
    const body = (await res.json()) as { metas: unknown[] }
    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
  })

  it("surfaces an explicit notice on a cold failure (never a JW substitute)", async () => {
    mockedDefaults.mockReturnValue({
      streamingSelections: [{ service: "netflix", country: "IT" }],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    } as never)
    mockedEnsureFresh.mockResolvedValue({ id: "live", snapshot: null } as never)
    mockTmdbFetch()

    const { body } = await getJwCatalog("movie")
    expect(body.metas).toHaveLength(1)
    expect(body.metas[0].poster).toContain("/pictorium.png")
  })
})
