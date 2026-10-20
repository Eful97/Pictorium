// Poster latency diagnostics: rolling window, capacity, quantile math,
// invalid samples, reset. Pure store-level (no route harness).
import { beforeEach, describe, expect, it } from "vitest"
import {
  POSTER_LATENCY_MAX_SAMPLES,
  POSTER_LATENCY_WINDOW_MS,
  __resetPosterLatencyForTests,
  __resetPosterStatsForTest,
  getPosterLatencyStats,
  getPosterStats,
  posterLatencyQuantile,
  recordPosterLatency,
} from "@/lib/poster-runtime-cache"

describe("poster latency quantile math (linear interpolation, R-7)", () => {
  it("returns null on empty input", () => {
    expect(posterLatencyQuantile([], 0.5)).toBeNull()
    expect(posterLatencyQuantile([], 0.95)).toBeNull()
  })

  it("returns the single value for any quantile", () => {
    expect(posterLatencyQuantile([42], 0.5)).toBe(42)
    expect(posterLatencyQuantile([42], 0.95)).toBe(42)
  })

  it("interpolates linearly: rank = q * (n - 1)", () => {
    // n = 4: p50 rank = 1.5 → 20 + 0.5 * (30 - 20) = 25.
    expect(posterLatencyQuantile([10, 20, 30, 40], 0.5)).toBe(25)
    // p95 rank = 0.95 * 3 = 2.85 → 30 + 0.85 * 10 = 38.5.
    expect(posterLatencyQuantile([10, 20, 30, 40], 0.95)).toBe(38.5)
  })

  it("hits exact ranks without interpolation", () => {
    // n = 5: p50 rank = 2 → values[2].
    expect(posterLatencyQuantile([1, 2, 3, 4, 5], 0.5)).toBe(3)
  })
})

describe("poster latency rolling observations", () => {
  beforeEach(() => {
    __resetPosterLatencyForTests()
  })

  it("exposes the documented window and per-bucket capacity", () => {
    const stats = getPosterLatencyStats()
    expect(stats.windowMs).toBe(POSTER_LATENCY_WINDOW_MS)
    expect(stats.windowMs).toBe(15 * 60 * 1000)
    expect(stats.capacity).toBe(POSTER_LATENCY_MAX_SAMPLES)
    expect(stats.capacity).toBe(1024)
  })

  it("reports honest empty (no green zero): count 0 with null quantiles", () => {
    const stats = getPosterLatencyStats()
    expect(stats.cached).toEqual({ count: 0, p50Ms: null, p95Ms: null })
    expect(stats.render).toEqual({ count: 0, p50Ms: null, p95Ms: null })
  })

  it("separates cached vs render buckets with count/p50/p95", () => {
    recordPosterLatency("cached", 10)
    recordPosterLatency("cached", 20)
    recordPosterLatency("cached", 30)
    recordPosterLatency("render", 2000)
    const stats = getPosterLatencyStats()
    expect(stats.cached.count).toBe(3)
    expect(stats.cached.p50Ms).toBe(20)
    // p95 rank = 0.95 * 2 = 1.9 → 20 + 0.9 * 10 = 29.
    expect(stats.cached.p95Ms).toBe(29)
    expect(stats.render.count).toBe(1)
    expect(stats.render.p50Ms).toBe(2000)
    expect(stats.render.p95Ms).toBe(2000)
  })

  it("rounds summaries to 1 decimal", () => {
    recordPosterLatency("cached", 10)
    recordPosterLatency("cached", 11)
    const stats = getPosterLatencyStats()
    // p50 = 10.5 exact; p95 = 10 + 0.95 = 10.95 → 11 after rounding.
    expect(stats.cached.p50Ms).toBe(10.5)
    expect(stats.cached.p95Ms).toBe(11)
  })

  it("drops invalid samples: negative, NaN, Infinity, bad timestamps", () => {
    recordPosterLatency("cached", -5)
    recordPosterLatency("cached", Number.NaN)
    recordPosterLatency("cached", Number.POSITIVE_INFINITY)
    recordPosterLatency("cached", 10, Number.NaN)
    recordPosterLatency("cached", 10, -1)
    recordPosterLatency("render", 100)
    const stats = getPosterLatencyStats()
    expect(stats.cached.count).toBe(0)
    expect(stats.cached.p50Ms).toBeNull()
    expect(stats.render.count).toBe(1)
  })

  it("ignores unknown kinds without creating buckets", () => {
    recordPosterLatency("stale" as never, 10)
    const stats = getPosterLatencyStats()
    expect(stats.cached.count).toBe(0)
    expect(stats.render.count).toBe(0)
    expect(Object.keys(stats)).toEqual(["windowMs", "capacity", "cached", "render"])
  })

  it("caps each bucket at capacity, evicting oldest first", () => {
    for (let i = 1; i <= POSTER_LATENCY_MAX_SAMPLES + 100; i++) {
      recordPosterLatency("cached", i)
    }
    const stats = getPosterLatencyStats()
    expect(stats.cached.count).toBe(POSTER_LATENCY_MAX_SAMPLES)
    // Oldest 100 evicted: smallest retained is 101 → p50 of 101..1124.
    // p50 rank = 0.5 * 1023 = 511.5 → 612.5 (values 101 + 511/512).
    expect(stats.cached.p50Ms).toBe(612.5)
    expect(stats.render.count).toBe(0)
  })

  it("ages samples out of the rolling window on read", () => {
    const t0 = 1_700_000_000_000
    recordPosterLatency("cached", 10, t0)
    recordPosterLatency("cached", 20, t0 + POSTER_LATENCY_WINDOW_MS - 1000)
    // Just before expiry both are visible.
    expect(getPosterLatencyStats(t0 + POSTER_LATENCY_WINDOW_MS - 1000).cached.count).toBe(2)
    // Past the window the old sample is gone (boundary is exclusive).
    const aged = getPosterLatencyStats(t0 + POSTER_LATENCY_WINDOW_MS + 1)
    expect(aged.cached.count).toBe(1)
    expect(aged.cached.p50Ms).toBe(20)
    // Everything expired → honest empty again.
    const empty = getPosterLatencyStats(t0 + 2 * POSTER_LATENCY_WINDOW_MS)
    expect(empty.cached).toEqual({ count: 0, p50Ms: null, p95Ms: null })
  })

  it("reset clears both buckets", () => {
    recordPosterLatency("cached", 10)
    recordPosterLatency("render", 100)
    __resetPosterLatencyForTests()
    const stats = getPosterLatencyStats()
    expect(stats.cached.count).toBe(0)
    expect(stats.render.count).toBe(0)
  })

  it("stats reset clears latency too, and getPosterStats carries it additively", () => {
    recordPosterLatency("cached", 10)
    recordPosterLatency("render", 100)
    expect(getPosterStats().latency.cached.count).toBe(1)
    expect(getPosterStats().latency.render.count).toBe(1)
    __resetPosterStatsForTest()
    const stats = getPosterLatencyStats()
    expect(stats.cached.count).toBe(0)
    expect(stats.render.count).toBe(0)
    // Additive shape preserved on the empty read.
    const poster = getPosterStats()
    expect(poster.latency.windowMs).toBe(POSTER_LATENCY_WINDOW_MS)
    expect(poster.latency.cached).toEqual({ count: 0, p50Ms: null, p95Ms: null })
  })
})
