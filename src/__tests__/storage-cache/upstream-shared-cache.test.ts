/**
 * Fase 4: shared layer + dedupe for upstream metadata.
 *
 * The per-process Maps of TMDB/JustWatch/FlixPatrol stay authoritative for
 * capacity, LRU, TTL and negative-cache semantics (no KV -> byte-identical
 * behaviour). When KV L2 is configured they gain a read-only-on-hit shared
 * fallback so a replica with a cold L1 does not repeat the same upstream.
 *
 * Contracts asserted here:
 * - L2 disabled = zero KV traffic (local-only, histology unchanged);
 * - shared keys are hash-only (no URL, query text or API key reaches KV);
 * - envelope carries the writer timestamp + TTL (absolute expiry preserved);
 * - >64KB payloads and Buffers stay local (cost guard);
 * - KV errors are misses (fail-open, never a hang);
 * - a second module instance (new replica, empty L1/disk) serves the same
 *   TMDB/JustWatch/FlixPatrol data without a second upstream fetch.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const kvStore = vi.hoisted(() => new Map<string, string>())
const kvMock = vi.hoisted(() => ({
  get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    kvStore.set(key, value)
  }),
}))

vi.mock("@/lib/upstash-kv-client", () => ({ kv: kvMock }))

const tick = () => new Promise((r) => setTimeout(r, 10))

function enableKv(): void {
  process.env.KV_REST_API_URL = "https://example.upstash.io"
  process.env.KV_REST_API_TOKEN = "test-token"
}

function romeChartDateLabel(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Rome",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(nowMs)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("month")} ${Number(get("day"))}, ${get("year")}`
}

function jwChartsResponse(startId = 500): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: Array.from({ length: 10 }, (_, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: {
            content: {
              title: `Shared Title ${i + 1}`,
              externalIds: { tmdbId: startId + i, imdbId: `tt00${startId + i}` },
            },
          },
        })),
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  kvStore.clear()
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.PICTORIUM_KV_CACHE
  vi.resetModules()
})

describe("shared upstream cache (cache.ts helper)", () => {
  it("without KV: no traffic, local-only miss", async () => {
    const cache = await import("@/lib/cache")
    cache.cacheSetSharedUpstream("tmdb:neutral-key", { a: 1 }, 60_000)
    expect(kvMock.set).not.toHaveBeenCalled()
    expect(await cache.cacheGetSharedUpstream("tmdb:neutral-key")).toBeNull()
    expect(kvMock.get).not.toHaveBeenCalled()
  })

  it("hash-only key + envelope with writer provenance, cross-instance hit", async () => {
    enableKv()
    vi.resetModules()
    const cache = await import("@/lib/cache")
    const rawKey = "tmdb:https://api.themoviedb.org/3/movie/1?language=it&query=private-text"
    cache.cacheSetSharedUpstream(rawKey, { id: 1 }, 300_000)
    await tick()

    expect(kvStore.size).toBe(1)
    const [kvKey, json] = [...kvStore.entries()][0]
    expect(kvKey).toMatch(/^pictorium:cache:src:[0-9a-f]{64}$/)
    expect(kvKey).not.toContain("api.themoviedb.org")
    expect(kvKey).not.toContain("private-text")
    const envelope = JSON.parse(json) as { __pictoriumKv: number; d: unknown; t: number; ttl?: number }
    expect(envelope.__pictoriumKv).toBe(1)
    expect(envelope.d).toEqual({ id: 1 })
    expect(envelope.ttl).toBe(300_000)
    expect(typeof envelope.t).toBe("number")

    // Another replica: fresh module registry (empty L1), same shared KV.
    vi.resetModules()
    const reader = await import("@/lib/cache")
    const hit = await reader.cacheGetSharedUpstream<{ id: number }>(rawKey)
    expect(hit?.data).toEqual({ id: 1 })
    expect(hit?.ttlMs).toBe(300_000)
    expect(kvMock.get).toHaveBeenCalledTimes(1)
  })

  it(">64KB payloads and Buffers stay local", async () => {
    enableKv()
    vi.resetModules()
    const cache = await import("@/lib/cache")
    cache.cacheSetSharedUpstream("big", { s: "x".repeat(70 * 1024) }, 60_000)
    cache.cacheSetSharedUpstream("buf", Buffer.alloc(128), 60_000)
    await tick()
    expect(kvStore.size).toBe(0)
    expect(kvMock.set).not.toHaveBeenCalled()
  })

  it("KV errors are misses (fail-open)", async () => {
    enableKv()
    kvMock.get.mockRejectedValueOnce(new Error("KV down"))
    vi.resetModules()
    const cache = await import("@/lib/cache")
    await expect(cache.cacheGetSharedUpstream("broken")).resolves.toBeNull()
  })
})

describe("adapter integration (second replica with cold L1)", () => {
  it("TMDB details: one upstream, second replica from shared layer, no key leakage", async () => {
    enableKv()
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ id: 990101, vote_average: 7.5 }))

    const a = await import("@/lib/tmdb")
    const first = await a.getDetails("movie", 990101, "it-IT", "secret-tmdb-key", undefined, 5000)
    expect(first.id).toBe(990101)
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    for (const [key, value] of kvStore) {
      expect(key).not.toContain("secret-tmdb-key")
      expect(value).not.toContain("secret-tmdb-key")
    }

    vi.resetModules()
    const b = await import("@/lib/tmdb")
    const second = await b.getDetails("movie", 990101, "it-IT", "secret-tmdb-key", undefined, 5000)
    expect(second.id).toBe(990101)
    expect(second.vote_average).toBe(7.5)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("JustWatch rankings: one GraphQL upstream, second replica from shared layer", async () => {
    enableKv()
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jwChartsResponse(600))

    const a = await import("@/lib/justwatch")
    const first = await a.getJWRankings("MOVIE", "IT", 10, undefined, "it-IT")
    expect(first).toHaveLength(10)
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.resetModules()
    const b = await import("@/lib/justwatch")
    const second = await b.getJWRankings("MOVIE", "IT", 10, undefined, "it-IT")
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("FlixPatrol country document: second replica uses the shared document (no refetch)", async () => {
    enableKv()
    const label = romeChartDateLabel()
    const doc = {
      date: label,
      charts: [
        {
          catalog_id: "netflix.movies",
          platform: "Netflix",
          category: "movies",
          date: label,
          entries: [{ rank: 1, title: "Shared Movie", tmdb: { id: 1, media_type: "movie", release_date: "2024-01-01" } }],
        },
        {
          catalog_id: "netflix.series",
          platform: "Netflix",
          category: "tv shows",
          date: label,
          entries: [{ rank: 1, title: "Shared Show", tmdb: { id: 2, media_type: "tv", release_date: "2024-01-01" } }],
        },
      ],
    }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(doc))

    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-fp-shared-a-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", dirA)
    vi.resetModules()
    const a = await import("@/lib/flixpatrol")
    const sidesA = await a.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(sidesA.movie.kind).toBe("hit")
    expect(sidesA.tv.kind).toBe("hit")
    await tick()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // New replica: fresh module, empty DATA_DIR (no memory/disk copy).
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-fp-shared-b-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", dirB)
    vi.resetModules()
    const b = await import("@/lib/flixpatrol")
    const sidesB = await b.resolveFlixPlatformSides("netflix", "italy", { freshOrThrow: true })
    expect(sidesB.movie.kind).toBe("hit")
    expect(sidesB.tv.kind).toBe("hit")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
