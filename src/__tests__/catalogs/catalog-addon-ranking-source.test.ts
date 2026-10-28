/**
 * Global Top 20 catalog driven by an imported Stremio-addon catalog.
 *
 * The JW catalog must serve the SAME remote rows (order/positions) the addon
 * passthrough serves, with zero JustWatch traffic and no renumbering after an
 * unresolvable ID.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/stremio-addon-server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stremio-addon-server")>()
  return { ...mod, fetchAddonCatalogPage: vi.fn() }
})

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear, cacheInvalidate } from "@/lib/cache"
import { getById } from "@/lib/store"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { getServerDefaults } from "@/lib/server-defaults"
import { addonCatalogCacheNamespace, fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import type { CustomCatalogConfig } from "@/lib/types"

const mockedGetById = vi.mocked(getById)
const mockedDefaults = vi.mocked(getServerDefaults)
const mockedPage = vi.mocked(fetchAddonCatalogPage)

const ADDON: CustomCatalogConfig = {
  id: "cat_addon",
  name: "Addon Top",
  type: "movie",
  url: "https://addon.example/manifest.json",
  addon: {
    manifestUrl: "https://addon.example/manifest.json",
    catalogId: "top",
    catalogType: "movie",
  },
}

function mockTmdbFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
    const u = String(url)
    if (u.includes("justwatch") || u.includes("graphql")) {
      throw new Error("JustWatch must not be touched for an addon ranking source")
    }
    if (u.includes("/external_ids")) {
      const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
      const id = Number(m?.[1] ?? m?.[2] ?? 0)
      return Response.json({ id, imdb_id: `tt90000${String(id).padStart(2, "0")}` })
    }
    if (u.includes("/images")) {
      const id = Number(u.match(/\/(?:movie|tv)\/(\d+)/)?.[1] ?? 0)
      return Response.json({ id, logos: [] })
    }
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

beforeEach(() => {
  mockedGetById.mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  mockedGetById.mockReset()
  mockedDefaults.mockReset()
  mockedPage.mockReset()
  cacheClear()
  cacheInvalidate("catalog")
  cacheInvalidate("stremio")
  __clearTMDBCache()
  __clearImdbCache()
})

describe("global Top 20 catalog driven by an imported addon list", () => {
  it("serves the remote rows in order with zero JW traffic", async () => {
    mockedDefaults.mockReturnValue({
      customCatalogs: [ADDON],
      rankingSourceMovie: ADDON.id,
    } as never)
    mockedPage.mockResolvedValue({
      items: [
        { id: "tmdb:7701", name: "First" },
        { id: "kitsu:9", name: "Unsupported" },
        { id: "tmdb:7702", name: "Third" },
      ],
    })
    const fetchSpy = mockTmdbFetch()

    const req = new NextRequest(
      "http://localhost:3000/catalog/movie/pictorium-jw-movies.json?api_key=test-key",
    )
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) })
    const body = (await res.json()) as { metas: Array<{ name: string }> }
    expect(res.status).toBe(200)
    expect(body.metas.map((m) => m.name)).toEqual(["Pinned 7701", "Pinned 7702"])
    expect(mockedPage).toHaveBeenCalledWith(
      "https://addon.example/manifest.json",
      "movie",
      "top",
      {},
      expect.any(String),
      addonCatalogCacheNamespace(null, null, "test-key"),
      undefined,
    )
    const calledUrls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(calledUrls.some((u) => u.includes("justwatch"))).toBe(false)
  })
})
