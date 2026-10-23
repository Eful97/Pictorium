import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  fetchAggregatedRating,
  isMdblistBreakerOpen,
  __resetMdblistBreaker,
  __resetMdbRawForTest,
  __resetRatingsNullForTest,
} from "@/lib/ratings"
import { __resetMdbQuotaForTests } from "@/lib/mdblist-quota"
import { cacheClear } from "@/lib/cache"

// Cross-credential isolation: failures recorded under key A must not
// suppress a healthy key B, and read-only telemetry must not consume the
// half-open trial (which would wedge the breaker open with no trial owner).
function keyedFetch() {
  return vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes("apikey=KEY-A")) {
      return { ok: false, status: 500, headers: { get: (_n: string): string | null => null } }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: (_n: string): string | null => null },
      json: async () => ({ ratings: [{ source: "imdb", value: 84, score: 84 }] }),
    }
  })
}

describe("mdblist breaker cross-credential isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetMdblistBreaker()
    __resetMdbRawForTest()
    __resetRatingsNullForTest()
    __resetMdbQuotaForTests()
    cacheClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    __resetMdblistBreaker()
    __resetMdbRawForTest()
    __resetRatingsNullForTest()
    __resetMdbQuotaForTests()
    cacheClear()
  })

  it("key B still reaches upstream after key A trips its own breaker", async () => {
    const fetchMock = keyedFetch()
    vi.stubGlobal("fetch", fetchMock)

    // Key A fails 3x (500s): its own breaker must open.
    for (let i = 0; i < 3; i++) expect(await fetchAggregatedRating(`ttIsoA${i}`, "KEY-A")).toBeNull()
    const aCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("apikey=KEY-A")).length
    expect(aCalls).toBe(3)

    // Healthy key B must NOT be suppressed by A's failures.
    const b = await fetchAggregatedRating("ttIsoB1", "KEY-B")
    expect(b?.average).toBe(8.4)
    const bCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("apikey=KEY-B")).length
    expect(bCalls).toBe(1)
  })

  it("key A stays protected after its own 3 failures", async () => {
    const fetchMock = keyedFetch()
    vi.stubGlobal("fetch", fetchMock)

    for (let i = 0; i < 3; i++) expect(await fetchAggregatedRating(`ttIsoP${i}`, "KEY-A")).toBeNull()
    // Fourth A request short-circuits on A's own breaker: no new A fetch.
    expect(await fetchAggregatedRating("ttIsoP3", "KEY-A")).toBeNull()
    const aCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("apikey=KEY-A")).length
    expect(aCalls).toBe(3)
  })

  it("read-only telemetry does not steal the half-open trial", async () => {
    const fetchMock = keyedFetch()
    vi.stubGlobal("fetch", fetchMock)

    for (let i = 0; i < 3; i++) await fetchAggregatedRating(`ttIsoT${i}`, "KEY-A")
    expect(fetchMock).toHaveBeenCalledTimes(3)

    // Window expires; a telemetry poll must not consume the single trial
    // (its return value here is irrelevant — recoverable reads closed).
    vi.setSystemTime(Date.now() + 31_000)
    isMdblistBreakerOpen()

    // The trial belongs to this real request: a healthy upstream closes it.
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: { get: (_n: string): string | null => null },
      json: async () => ({ ratings: [{ source: "imdb", value: 84, score: 84 }] }),
    }))
    expect((await fetchAggregatedRating("ttIsoTrial", "KEY-A"))?.average).toBe(8.4)
    expect(isMdblistBreakerOpen()).toBe(false)
  })
})
