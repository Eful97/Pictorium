import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __resetMdblistBreaker,
  __resetRatingsNullForTest,
  RATINGS_SUCCESS_TTL_MS,
  fetchAggregatedRating,
} from "@/lib/ratings"
import { cacheClear } from "@/lib/cache"
import * as cacheModule from "@/lib/cache"

const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 0, 1, 12, 0, 0)

function okResponse() {
  return Response.json({ ratings: [{ source: "imdb", value: 8.4 }] })
}

beforeEach(() => {
  cacheClear()
  __resetMdblistBreaker()
  __resetRatingsNullForTest()
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  cacheClear()
  __resetRatingsNullForTest()
})

describe("ratings success explicit TTL 6h (success only)", () => {
  it("exposes the expected constant (6h)", () => {
    expect(RATINGS_SUCCESS_TTL_MS).toBe(6 * HOUR)
  })

  it("success writes to cache with explicit 6h TTL", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => okResponse())
    const seen: Array<{ key: string; ttl: number | undefined }> = []
    const originalSet = cacheModule.cacheSet
    const spy = vi
      .spyOn(cacheModule, "cacheSet")
      .mockImplementation((k: string, v: unknown, tags?: string[], ttlMs?: number) => {
        if (k.startsWith("mdb:ratings:")) seen.push({ key: k, ttl: ttlMs })
        originalSet(k, v, tags ?? [], ttlMs)
      })

    const r = await fetchAggregatedRating("tt6h001")
    expect(r?.average).toBe(8.4)
    expect(seen).toHaveLength(1)
    expect(seen[0].ttl).toBe(6 * HOUR)
    spy.mockRestore()
  })

  it("reuse before 6h without refetch, refetch after 6h", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => okResponse())
    const first = await fetchAggregatedRating("tt6h002")
    expect(first?.average).toBe(8.4)
    expect(spy).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + 6 * HOUR - 60_000)
    const reused = await fetchAggregatedRating("tt6h002")
    expect(reused?.average).toBe(8.4)
    expect(spy).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + 6 * HOUR + 1_000)
    const refetched = await fetchAggregatedRating("tt6h002")
    expect(refetched?.average).toBe(8.4)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("null 60s unchanged: genuine miss reused within 60s, refetch after", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response("{}", { status: 404 })))
    expect(await fetchAggregatedRating("tt6h003")).toBeNull()
    expect(await fetchAggregatedRating("tt6h003")).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + 61_000)
    expect(await fetchAggregatedRating("tt6h003")).toBeNull()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("503 errors never cached: every access refetches", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response("{}", { status: 503, headers: { "retry-after": "0" } })))
    expect(await fetchAggregatedRating("tt6h004")).toBeNull()
    expect(await fetchAggregatedRating("tt6h004")).toBeNull()
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
