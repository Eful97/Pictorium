import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"
import { encodeConfig, decodeConfig } from "@/lib/config-token"
import { customCatalogSortFragment, sanitizeCustomCatalogSort } from "@/lib/types"
import * as providersModule from "@/lib/custom-catalog-providers"
import * as tmdbModule from "@/lib/tmdb"
import * as sdModule from "@/lib/server-defaults"
import * as cacheModule from "@/lib/cache"
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

function tokenWithSort(sortBy?: string, sortHow?: "asc" | "desc"): string {
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
    customCatalogs: [
      {
        id: "sorted-list",
        name: "Sorted",
        type: "movie",
        url: "https://mdblist.com/lists/u/sorted",
        enabled: true,
        ...(sortBy ? { sortBy, sortHow } : {}),
      },
    ],
  })
}

beforeEach(() => {
  cacheClear()
  vi.restoreAllMocks()
  vi.mocked(storeModule.getById).mockResolvedValue(null)
  vi.mocked(sdModule.getServerDefaults).mockReturnValue({})
  vi.spyOn(tmdbModule, "resolveUserApiKeys").mockResolvedValue({
    tmdb: { key: "tmdb-key", source: "env" },
    mdblist: { key: "mdblist-key", source: "env" },
    tvdb: { key: undefined, source: "none" },
    simkl: { key: undefined, source: "none" },
    fanart: { key: undefined, source: "none" },
  })
})

afterEach(() => {
  delete process.env.MDBLIST_API_URL
})

describe("custom catalog sort fragment", () => {
  it("is provider-validated and legacy-identical without a sort", () => {
    expect(customCatalogSortFragment("mdblist", "added", "desc")).toBe(":soadded:desc")
    expect(customCatalogSortFragment("trakt", "rank", "asc")).toBe(":sorank:asc")
    expect(customCatalogSortFragment("mdblist", "not-a-field", "asc")).toBe("")
    expect(customCatalogSortFragment("letterboxd", "added", "asc")).toBe("")
    expect(sanitizeCustomCatalogSort("mdblist", "added", "garbage")).toEqual({ sortBy: "added", sortHow: "asc" })
  })
})

describe("config token preserves custom list sort", () => {
  it("round-trips sortBy/sortHow through encode/decode", () => {
    const decoded = decodeConfig(tokenWithSort("added", "desc"))
    expect(decoded?.customCatalogs?.[0]).toMatchObject({
      id: "sorted-list",
      sortBy: "added",
      sortHow: "desc",
    })
  })

  it("keeps legacy tokens without sort valid", () => {
    const decoded = decodeConfig(tokenWithSort())
    expect(decoded?.customCatalogs?.[0]).toMatchObject({ id: "sorted-list" })
    expect(decoded?.customCatalogs?.[0]?.sortBy).toBeUndefined()
  })
})

describe("provider fetch honors the explicit sort", () => {
  it("appends MDBList sort/order to the upstream items request", async () => {
    process.env.MDBLIST_API_URL = "http://mock.local/mdblist/api"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ items: [{ id: 1, title: "One", year: 2024, imdb_id: "tt1" }] }),
    )
    const result = await providersModule.fetchUnifiedCatalogResult(
      "https://mdblist.com/lists/u/sorted",
      { limit: 10, sortBy: "added", sortHow: "desc" },
    )
    expect(result.items).toHaveLength(1)
    const called = fetchSpy.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/lists/custom/"))
    expect(called).toBeTruthy()
    expect(called).toContain("sort=added")
    expect(called).toContain("order=desc")
  })
})

describe("catalog handler sort wiring + outer cache fence", () => {
  function catalogRequest(token: string): NextRequest {
    return new NextRequest(
      `http://localhost:3000/catalog/movie/pictorium-custom-movie-sorted-list.json?api_key=tmdb-key&config=${token}`,
    )
  }

  it("passes the configured sort to the provider and fences the body key", async () => {
    const token = tokenWithSort("added", "desc")
    const providerSpy = vi.spyOn(providersModule, "fetchUnifiedCatalogResult").mockResolvedValue({
      items: [],
      status: "empty",
    })
    const seenKeys: string[] = []
    vi.spyOn(cacheModule, "cacheGetShared").mockImplementation(async (key: string) => {
      seenKeys.push(key)
      return null
    })

    const { pictoriumCatalog } = await import("@/lib/catalog-handler")
    const res = await pictoriumCatalog(catalogRequest(token), "movie", "pictorium-custom-movie-sorted-list", null, token)
    expect(res.status).toBe(200)

    expect(providerSpy).toHaveBeenCalledTimes(1)
    expect(providerSpy.mock.calls[0]?.[1]).toMatchObject({ sortBy: "added", sortHow: "desc" })
    expect(seenKeys).toHaveLength(1)
    expect(seenKeys[0]).toContain(":soadded:desc")
  })

  it("keeps unsorted keys free of the sort fragment", async () => {
    const token = tokenWithSort()
    vi.spyOn(providersModule, "fetchUnifiedCatalogResult").mockResolvedValue({
      items: [],
      status: "empty",
    })
    const seenKeys: string[] = []
    vi.spyOn(cacheModule, "cacheGetShared").mockImplementation(async (key: string) => {
      seenKeys.push(key)
      return null
    })

    const { pictoriumCatalog } = await import("@/lib/catalog-handler")
    await pictoriumCatalog(catalogRequest(token), "movie", "pictorium-custom-movie-sorted-list", null, token)
    expect(seenKeys[0]).not.toContain(":so")
  })
})
