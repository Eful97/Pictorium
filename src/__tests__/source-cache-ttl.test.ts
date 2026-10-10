import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { getJWRankings, getJWTitles, __resetJWRankingsCache } from "@/lib/justwatch"
import { fetchMDBList, fetchCustomMDBList } from "@/lib/mdblist"
import { fetchUnifiedCatalogResult } from "@/lib/custom-catalog-providers"
import { cacheInvalidate } from "@/lib/cache"
import { CATALOG_TTL_MS, CATALOG_EMPTY_TTL_MS } from "@/lib/catalog-handler"

// Source TTLs: FlixPatrol 12h, MDBList 12h, JustWatch 6h. The final catalog
// stays at 1h and negative/empty TTLs at 60s. Time is controlled via
// mocked Date.now (no fake timers: fetches aborted by real timeouts
// stay deterministic).

const HOUR = 60 * 60 * 1000
let now = 0

function jwRankingsPayload(ids: number[]): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: ids.map((tmdbId, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: { content: { title: `Film ${tmdbId}`, externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
        })),
      },
    },
  })
}

function jwTitlesPayload(ids: number[]): Response {
  return Response.json({
    data: {
      popularTitles: {
        edges: ids.map((tmdbId) => ({
          node: { content: { title: `Titolo ${tmdbId}`, externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
        })),
      },
    },
  })
}

function mdblistPayload(tag: string): Response {
  return Response.json({ items: [{ imdb: "tt1", title: `${tag} A`, year: 2024, tmdb: 1 }] })
}

describe("source cache TTL (FP 12h / MDBList 12h / JW 6h)", () => {
  beforeEach(() => {
    now = 1_750_000_000_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    __resetJWRankingsCache()
    cacheInvalidate("mdblist")
    cacheInvalidate("custom_catalogs")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetJWRankingsCache()
    cacheInvalidate("mdblist")
    cacheInvalidate("custom_catalogs")
  })

  it("JustWatch rankings: reuse within 6h, refetch after", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jwRankingsPayload([101]))
    const first = await getJWRankings("MOVIE", "IT", 20)
    expect(first).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 6 * HOUR - 60_000
    await getJWRankings("MOVIE", "IT", 20)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 61_000 // past 6h since generation
    await getJWRankings("MOVIE", "IT", 20)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("JustWatch titles (shared cache): reuse within 6h, refetch after", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jwTitlesPayload([201, 202]))
    const first = await getJWTitles({ objectType: "MOVIE", country: "IT", first: 2 })
    expect(first).toHaveLength(2)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 6 * HOUR - 60_000
    await getJWTitles({ objectType: "MOVIE", country: "IT", first: 2 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 61_000
    await getJWTitles({ objectType: "MOVIE", country: "IT", first: 2 })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("JustWatch negative cache: empties stay at 60s", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jwRankingsPayload([]))
    expect(await getJWRankings("MOVIE", "IT", 20)).toEqual([])
    expect(await getJWRankings("MOVIE", "IT", 20)).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 59_000
    expect(await getJWRankings("MOVIE", "IT", 20)).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 2_000 // 61s: the negative entry has expired
    expect(await getJWRankings("MOVIE", "IT", 20)).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("MDBList built-in: reuse within 12h, refetch after", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mdblistPayload("Built-in"))
    const first = await fetchMDBList("mdblistMovie", "ttl-key")
    expect(first).toEqual([{ imdb: "tt1", title: "Built-in A", year: 2024, tmdb: 1 }])
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 12 * HOUR - 60_000
    await fetchMDBList("mdblistMovie", "ttl-key")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 61_000 // past 12h
    await fetchMDBList("mdblistMovie", "ttl-key")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("MDBList custom (inner): reuse within 12h, refetch after", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mdblistPayload("Custom"))
    const first = await fetchCustomMDBList("snoak/trending-movies", "ttl-key")
    expect(first).toEqual([{ imdb: "tt1", title: "Custom A", year: 2024, tmdb: 1 }])
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 12 * HOUR - 60_000
    await fetchCustomMDBList("snoak/trending-movies", "ttl-key")
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 61_000
    await fetchCustomMDBList("snoak/trending-movies", "ttl-key")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("outer custom catalog: mdblist honors 12h even without inner cache", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mdblistPayload("Outer"))
    const url = "https://mdblist.com/lists/snoak/trending-movies"
    const first = await fetchUnifiedCatalogResult(url)
    expect(first.status).toBe("ok")
    expect(first.items).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Clear ONLY the inner mdblist cache: if the outer were still at 30 min,
    // at +6h it would miss and refetch. At 12h it stays a hit with no fetch.
    cacheInvalidate("mdblist")
    now += 6 * HOUR
    const second = await fetchUnifiedCatalogResult(url)
    expect(second.status).toBe("ok")
    expect(second.items).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 6 * HOUR + 1_000 // past 12h: both caches expired
    await fetchUnifiedCatalogResult(url)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("outer custom catalog: other sources stay at 30 min (tmdb_collection)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ parts: [{ id: 11, title: "Saga Uno", release_date: "2012-01-01", poster_path: "/p.jpg" }] }),
    )
    const first = await fetchUnifiedCatalogResult("tmdb:collection:86311", { apiKey: "k" })
    expect(first.status).toBe("ok")
    expect(first.items).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 29 * 60_000
    await fetchUnifiedCatalogResult("tmdb:collection:86311", { apiKey: "k" })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    now += 2 * 60_000 // 31 min: the 30 min outer cache has expired
    await fetchUnifiedCatalogResult("tmdb:collection:86311", { apiKey: "k" })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("final catalog and empties: TTLs unchanged (1h / 60s)", () => {
    expect(CATALOG_TTL_MS).toBe(60 * 60 * 1000)
    expect(CATALOG_EMPTY_TTL_MS).toBe(60_000)
  })
})

describe("FlixPatrol disk+memory validity 12h", () => {
  // Approved scratch root for the test fixture (created in beforeAll,
  // removed in afterAll so no temp dir leaks between runs).
  const SCRATCH_BASE = "C:\\Users\\lucaf\\AppData\\Local\\Temp\\opencode"
  let tmpDir = ""

  function createScratchDir(): string {
    try {
      fs.mkdirSync(SCRATCH_BASE, { recursive: true })
      return fs.mkdtempSync(path.join(SCRATCH_BASE, "pictorium-fp-ttl-"))
    } catch {
      // Fallback when the approved scratch root is unavailable (other OS/CI).
      return fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-fp-ttl-"))
    }
  }

  function readDiskCache(file: string): { timestamp: number; catalog: unknown } | null {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as { timestamp?: unknown; catalog?: unknown }
      if (raw && typeof raw === "object" && typeof raw.timestamp === "number" && raw.catalog) {
        return { timestamp: raw.timestamp, catalog: raw.catalog }
      }
      return null
    } catch {
      return null
    }
  }

  // Bounded condition-based wait for the async saveCache disk flush: polls
  // for a valid disk cache instead of sleeping a fixed delay. Attempt-counted
  // (not Date.now-based: the clock is mocked in these tests).
  async function waitForDiskCache(file: string, expectedTimestamp: number, maxAttempts = 40, delayMs = 50): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const cached = readDiskCache(file)
      if (cached && cached.timestamp === expectedTimestamp) return
      await new Promise((r) => setTimeout(r, delayMs))
    }
    throw new Error(`Timed out waiting for FlixPatrol disk cache at ${file}`)
  }

  function makeCatalog(prefix: string): unknown {
    return {
      charts: [
        {
          catalog_id: "netflix",
          platform: "Netflix",
          category: "movies",
          entries: [{ rank: 1, title: `${prefix} Movie`, tmdb: { id: 1, media_type: "movie", release_date: "2024-01-01" } }],
        },
        {
          catalog_id: "netflix",
          platform: "Netflix",
          category: "tv shows",
          entries: [{ rank: 1, title: `${prefix} Show`, tmdb: { id: 2, media_type: "tv", release_date: "2024-02-01" } }],
        },
      ],
    }
  }

  beforeAll(() => {
    tmpDir = createScratchDir()
  })

  afterAll(async () => {
    try {
      // Drain any in-flight async disk flush before removing the fixture dir.
      if (tmpDir) {
        await waitForDiskCache(path.join(tmpDir, "flixpatrol_cache_italy.json"), now).catch(() => {})
      }
    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
      tmpDir = ""
    }
  })

  beforeEach(() => {
    now = 1_750_000_000_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    vi.stubEnv("POSTERIUM_DATA_DIR", tmpDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("memory reuse within 12h, disk across restart, refetch after", async () => {
    vi.resetModules()
    let catalogFetches = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const u = String(url)
        if (u.includes("justwatch")) {
          return Response.json({ data: { streamingCharts: { edges: [] }, popularTitles: { edges: [] } } })
        }
        if (u.endsWith(".json")) {
          catalogFetches++
          return new Response(JSON.stringify(makeCatalog("IT")))
        }
        return new Response("not found", { status: 404 })
      }),
    )
    const fp1 = await import("@/lib/flixpatrol")
    const cacheFile = path.join(tmpDir, "flixpatrol_cache_italy.json")
    const first = await fp1.getTop10("netflix", "italy", undefined, { enrich: false })
    expect(first.movies[0].title).toBe("IT Movie")
    expect(catalogFetches).toBe(1)
    // Wait for the async saveCache disk flush before the simulated restart.
    await waitForDiskCache(cacheFile, now)

    now += 11 * HOUR
    const second = await fp1.getTop10("netflix", "italy", undefined, { enrich: false })
    expect(second.movies[0].title).toBe("IT Movie")
    expect(catalogFetches).toBe(1)

    // Simulated restart: empty memory, disk within 12h avoids refetch.
    vi.resetModules()
    const fp2 = await import("@/lib/flixpatrol")
    const third = await fp2.getTop10("netflix", "italy", undefined, { enrich: false })
    expect(third.movies[0].title).toBe("IT Movie")
    expect(catalogFetches).toBe(1)

    now += 61 * 60_000 // 12h01 since generation: memory+disk expired
    const fourth = await fp2.getTop10("netflix", "italy", undefined, { enrich: false })
    expect(fourth.movies[0].title).toBe("IT Movie")
    expect(catalogFetches).toBe(2)
    // Drain the final async disk flush so cleanup never races a pending write.
    await waitForDiskCache(cacheFile, now)
  })
})
