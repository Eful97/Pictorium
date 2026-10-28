/**
 * Imported Stremio-addon catalogs as a ranking source.
 *
 * Contract under test:
 * - the remote page is read through the existing SSRF-safe fetch with the
 *   remote catalog identity (manifest + catalogId + real catalog type);
 * - real positions are preserved: unsupported IDs are dropped, later rows
 *   keep their original rank (no renumbering, no backfill);
 * - a 10-row source is a Top-10 chart, anything longer contributes its first
 *   20 real positions (the name is never consulted);
 * - mixed rows keep their declared media type;
 * - unsupported IDs are a genuine drop, missing keys/fetch failures are
 *   explicit errors and are never cached;
 * - the resolved ranking carries its own freshness (remaining TTL).
 */
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/stremio-addon-server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stremio-addon-server")>()
  return { ...mod, fetchAddonCatalogPage: vi.fn() }
})

vi.mock("@/lib/tmdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...mod,
    tmdbFindByImdb: vi.fn(async () => 105),
    tmdbFindByTvdb: vi.fn(async () => 205),
  }
})

import {
  addonRankingRemainingMs,
  addonRankingSourceKey,
  fetchAddonRanking,
  type FetchAddonRankingInput,
} from "@/lib/addon-ranking"
import { cacheClear } from "@/lib/cache"
import { addonCatalogCacheNamespace, fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import { tmdbFindByTvdb } from "@/lib/tmdb"
import type { StremioAddonSource } from "@/lib/stremio-addon"

const mockedPage = vi.mocked(fetchAddonCatalogPage)

const MANIFEST = "https://addon.example/manifest.json"

function source(overrides: Partial<StremioAddonSource> = {}): StremioAddonSource {
  return {
    manifestUrl: MANIFEST,
    catalogId: "top",
    catalogType: "movie",
    ...overrides,
  }
}

function input(overrides: Partial<FetchAddonRankingInput> = {}): FetchAddonRankingInput {
  return {
    custom: { id: "cat_addon", addon: source() },
    slot: "movie",
    requestOrigin: "https://pictorium.test",
    ...overrides,
  }
}

function tmdbRows(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({ id: `tmdb:${100 + i}`, name: `Title ${i + 1}` }))
}

afterEach(() => {
  vi.restoreAllMocks()
  mockedPage.mockReset()
  cacheClear()
  vi.useRealTimers()
})

describe("addonRankingSourceKey", () => {
  it("identifies the actual remote catalog, never the URL or the local id", () => {
    const movie = addonRankingSourceKey(source())
    const series = addonRankingSourceKey(source({ catalogType: "series" }))
    const otherCatalog = addonRankingSourceKey(source({ catalogId: "last" }))
    const otherManifest = addonRankingSourceKey(source({ manifestUrl: "https://other.example/manifest.json" }))
    expect(movie).toMatch(/^[0-9a-f]{10}$/)
    expect(movie).toBe(addonRankingSourceKey(source()))
    expect(new Set([movie, series, otherCatalog, otherManifest]).size).toBe(4)
    expect(movie).not.toContain("addon.example")
  })
})

describe("fetchAddonRanking", () => {
  it("reads the remote page with the remote identity and namespace", async () => {
    mockedPage.mockResolvedValue({ items: tmdbRows(3) })
    const res = await fetchAddonRanking(input({
      userId: "user-1",
      configParam: "cfg-token",
      apiKey: "tmdb-key",
    }))
    expect(res.status).toBe("ok")
    expect(mockedPage).toHaveBeenCalledWith(
      MANIFEST,
      "movie",
      "top",
      {},
      "https://pictorium.test",
      addonCatalogCacheNamespace("user-1", "cfg-token", "tmdb-key"),
      undefined,
    )
  })

  it("preserves real positions and never renumbers after drops", async () => {
    mockedPage.mockResolvedValue({
      items: [
        { id: "tmdb:101", name: "First" },
        { id: "kitsu:9", name: "Unsupported" },
        { id: "102", name: "Third" },
        { id: "tmdb:101", name: "Duplicate" },
        { id: "tt1234567", name: "Fifth" },
      ],
    })
    const res = await fetchAddonRanking(input({ apiKey: "tmdb-key" }))
    expect(res.status).toBe("ok")
    expect(res.window).toBe(10)
    expect(res.items.map((i) => [i.tmdbId, i.rank])).toEqual([
      [101, 1],
      [102, 3],
      [105, 5],
    ])
  })

  it("uses a Top-10 window for a 10-row source and 20 otherwise (never the name)", async () => {
    mockedPage.mockResolvedValueOnce({ items: tmdbRows(10) })
    const ten = await fetchAddonRanking(input())
    expect(ten.window).toBe(10)
    expect(ten.items).toHaveLength(10)

    cacheClear()
    mockedPage.mockResolvedValueOnce({
      items: tmdbRows(25).map((row) => ({ ...row, name: "Top 10 of everything" })),
    })
    const longer = await fetchAddonRanking(input())
    expect(longer.window).toBe(20)
    expect(longer.items).toHaveLength(20)
    expect(longer.items.map((i) => i.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })

  it("filters mixed rows by their real media type while keeping positions", async () => {
    mockedPage.mockResolvedValue({
      items: [
        { id: "tmdb:101", type: "movie", name: "Film 1" },
        { id: "tmdb:102", type: "series", name: "Serie 2" },
        { id: "tmdb:103", name: "Film 3" },
        { id: "tmdb:104", type: "tv", name: "Serie 4" },
      ],
    })
    const movies = await fetchAddonRanking(input({ slot: "movie" }))
    expect(movies.items.map((i) => [i.tmdbId, i.rank, i.mediaType])).toEqual([
      [101, 1, "movie"],
      [103, 3, "movie"],
    ])
    const series = await fetchAddonRanking(input({ slot: "series" }))
    expect(series.items.map((i) => [i.tmdbId, i.rank, i.mediaType])).toEqual([
      [102, 2, "tv"],
      [104, 4, "tv"],
    ])
  })

  it("surfaces a missing key and a fetch failure explicitly, never cached", async () => {
    mockedPage.mockResolvedValue({ items: [{ id: "tt1234567", name: "Needs key" }] })
    const noKey = await fetchAddonRanking(input())
    expect(noKey.status).toBe("error")
    expect(noKey.errorStatus).toBe("key_missing")
    expect(addonRankingRemainingMs(input())).toBeNull()

    mockedPage.mockResolvedValue({ items: [], error: "private_url" })
    const failed = await fetchAddonRanking(input({ apiKey: "tmdb-key" }))
    expect(failed.status).toBe("error")
    expect(failed.errorStatus).toBe("private_url")
    expect(addonRankingRemainingMs(input({ apiKey: "tmdb-key" }))).toBeNull()
  })

  it("honors the caller deadline while the remote page is pending", async () => {
    mockedPage.mockReturnValue(new Promise(() => {}))
    const ctrl = new AbortController()
    const result = fetchAddonRanking(input({ signal: ctrl.signal }))
    const failure = expect(result).rejects.toThrow("deadline")
    ctrl.abort(new Error("deadline"))
    await failure
    expect(mockedPage.mock.calls[0][6]).toBe(ctrl.signal)
    expect(addonRankingRemainingMs(input())).toBeNull()
  })

  it("resolves TVDB ids through TMDB using only the TMDB credential", async () => {
    mockedPage.mockResolvedValue({ items: [{ id: "tvdb:456" }] })
    const result = await fetchAddonRanking(input({ apiKey: "tmdb-key" }))
    expect(result.status).toBe("ok")
    expect(tmdbFindByTvdb).toHaveBeenCalledWith("456", "movie", "tmdb-key", undefined)
  })

  it("does not renew the lifetime of an already cached remote page", async () => {
    vi.useFakeTimers()
    const expiresAt = Date.now() + 60_000
    mockedPage.mockResolvedValue({ items: tmdbRows(3), expiresAt })
    await fetchAddonRanking(input())
    expect(addonRankingRemainingMs(input())).toBe(60_000)
    vi.advanceTimersByTime(60_001)
    expect(addonRankingRemainingMs(input())).toBeNull()
  })

  it("caches the resolved ranking with its own remaining freshness", async () => {
    mockedPage.mockResolvedValue({ items: tmdbRows(3), expiresAt: Date.now() + 600_000 })
    const first = await fetchAddonRanking(input())
    expect(addonRankingRemainingMs(input())).toBeGreaterThan(0)
    const second = await fetchAddonRanking(input())
    expect(second.items).toEqual(first.items)
    expect(mockedPage).toHaveBeenCalledTimes(1)
  })
})
