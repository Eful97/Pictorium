/**
 * `/api/trending/rank` with an imported Stremio-addon ranking source.
 *
 * The badge must serve the REAL positions of the same remote catalog the
 * addon passthrough serves: no JW traffic, no renumbering after a drop, the
 * effective Top-10/Top-20 window and the addon source freshness.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/stremio-addon-server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stremio-addon-server")>()
  return { ...mod, fetchAddonCatalogPage: vi.fn() }
})

vi.mock("@/lib/tmdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...mod,
    resolveUserApiKeys: vi.fn(async () => ({
      tmdb: { key: undefined, source: "none" },
      mdblist: { key: undefined, source: "none" },
      tvdb: { key: undefined, source: "none" },
    })),
    tmdbFindByImdb: vi.fn(async () => 105),
    tmdbFindByTvdb: vi.fn(async () => 205),
  }
})

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({})),
    getServerDefaultsChecked: vi.fn(async () => ({})),
    getServerDefaultsForUser: vi.fn(async () => ({})),
  }
})

import { GET as rankGET } from "@/app/api/trending/rank/route"
import { cacheClear } from "@/lib/cache"
import { getServerDefaults } from "@/lib/server-defaults"
import { addonCatalogCacheNamespace, fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import type { CustomCatalogConfig } from "@/lib/types"

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

afterEach(() => {
  vi.restoreAllMocks()
  mockedDefaults.mockReset()
  mockedPage.mockReset()
  cacheClear()
})

function useAddonSelection() {
  mockedDefaults.mockReturnValue({
    customCatalogs: [ADDON],
    rankingSourceMovie: ADDON.id,
  } as never)
}

describe("GET /api/trending/rank with an imported addon source", () => {
  it("serves the real position and the effective Top-10 window", async () => {
    useAddonSelection()
    mockedPage.mockResolvedValue({
      items: [
        { id: "tmdb:101", name: "First" },
        { id: "kitsu:9", name: "Unsupported" },
        { id: "tmdb:102", name: "Third" },
      ],
    })
    const res = await rankGET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=102&region=IT"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache, must-revalidate")
    expect(await res.json()).toMatchObject({ rank: 3, period: "addon", top: 10 })
  })

  it("reads the same remote page as the catalog passthrough", async () => {
    useAddonSelection()
    mockedPage.mockResolvedValue({ items: [{ id: "tmdb:101", name: "First" }] })
    await rankGET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=101&region=IT"))
    expect(mockedPage).toHaveBeenCalledWith(
      "https://addon.example/manifest.json",
      "movie",
      "top",
      {},
      expect.any(String),
      addonCatalogCacheNamespace(null, null, undefined),
      undefined,
    )
  })

  it("surfaces a missing key explicitly (never a JW substitute)", async () => {
    useAddonSelection()
    mockedPage.mockResolvedValue({ items: [{ id: "tt1234567", name: "Needs key" }] })
    const res = await rankGET(new NextRequest("http://localhost:3000/api/trending/rank?type=movie&id=105&region=IT"))
    expect(res.status).toBe(502)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(await res.json()).toMatchObject({ rank: null, error: "key_missing" })
  })
})
