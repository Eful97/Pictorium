// Task D — poster freshness cap (RED-first).
//
// Proves the stale condition with a fake clock + source fixtures BEFORE the
// fix: a poster baked from a nearly-expired source fact must expire at that
// fact's real deadline, not at the flat 6h/24h TTL. A source cache HIT must
// not renew the deadline (absolute generation+TTL provenance, no sliding).
//
// No live network: the JustWatch source cache is populated through the real
// `getJWRankings` code path with a stubbed global fetch, then time-travelled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cacheClear, cacheSet, cacheRemainingMs } from "@/lib/cache"
import {
  __resetJWRankingsCache,
  getJWRankings,
  jwRankingsRemainingMs,
} from "@/lib/justwatch"
import {
  POSTER_FACT_FLOOR_MS,
  capPosterTtlMs,
  isPreReleaseDetectionUndecided,
  isRankFactConsumed,
  msUntilLocalDateBoundary,
  msUntilUtcDateBoundary,
  resolvePosterFactCapMs,
} from "@/lib/poster-freshness"
import {
  __resetPosterStatsForTest,
  canServePosterStaleHit,
  readCachedPoster,
  writeCachedPoster,
} from "@/lib/poster-runtime-cache"

const HOUR_MS = 60 * 60 * 1000
const T0 = Date.UTC(2026, 9, 15, 12, 0, 0) // fixed fake "now"
let fakeNow = T0

function jwGraphqlResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      data: {
        streamingCharts: {
          edges: [
            {
              streamingChartInfo: { rank: 3 },
              node: {
                content: {
                  title: "Fixture Film",
                  originalReleaseDate: "2020-01-01",
                  externalIds: { tmdbId: 123, imdbId: "tt0000123" },
                },
              },
            },
          ],
        },
      },
    }),
  }
}

beforeEach(() => {
  fakeNow = T0
  vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
  cacheClear()
  __resetJWRankingsCache()
  __resetPosterStatsForTest()
  vi.stubGlobal("fetch", vi.fn(async () => jwGraphqlResponse() as unknown as Response))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("source provenance is absolute (generation + TTL, never sliding)", () => {
  it("a source cache HIT does not renew the deadline", async () => {
    const rows = await getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")
    expect(rows).toHaveLength(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

    // 5h59m later the entry is still served from cache (no second fetch)…
    fakeNow = T0 + 6 * HOUR_MS - 60_000
    const hit = await getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")
    expect(hit).toHaveLength(1)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

    // …and the remaining lifetime reflects the ORIGINAL generation, not now+TTL.
    const remaining = jwRankingsRemainingMs("MOVIE", "IT", 20, undefined, "it-IT")
    expect(remaining).not.toBeNull()
    expect(remaining as number).toBeGreaterThan(0)
    expect(remaining as number).toBeLessThanOrEqual(61_000)
  })

  it("cacheRemainingMs decreases across reads without renewal", () => {
    cacheSet("fact:k", { v: 1 }, ["mdblist"], 12 * HOUR_MS)
    fakeNow = T0 + HOUR_MS
    const first = cacheRemainingMs("fact:k")
    fakeNow = T0 + 2 * HOUR_MS
    const second = cacheRemainingMs("fact:k")
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect((second as number)).toBeLessThan(first as number)
    // ~10h left, not a renewed 12h.
    expect(second as number).toBeLessThanOrEqual(10 * HOUR_MS + 1000)
    expect(second as number).toBeGreaterThan(9 * HOUR_MS)
  })
})

describe("capPosterTtlMs — poster must not outlive its facts", () => {
  it("RED core: a fact expiring in 60s caps a 6h poster at ~60s", () => {
    const capped = capPosterTtlMs(6 * HOUR_MS, [60_000])
    expect(capped).toBeLessThanOrEqual(60_000)
    expect(capped).toBeGreaterThanOrEqual(POSTER_FACT_FLOOR_MS)
  })

  it("the earliest of several facts wins", () => {
    const capped = capPosterTtlMs(6 * HOUR_MS, [5 * HOUR_MS, 90_000, 12 * HOUR_MS])
    expect(capped).toBeLessThanOrEqual(90_000)
  })

  it("a base TTL shorter than every fact is preserved (ephemeral stays ephemeral)", () => {
    expect(capPosterTtlMs(120_000, [6 * HOUR_MS])).toBe(120_000)
  })

  it("deterministic jitter must never extend past the cap", () => {
    const jittered = Math.round((6 * HOUR_MS * 110) / 100) // +10% jitter
    expect(capPosterTtlMs(jittered, [6 * HOUR_MS])).toBeLessThanOrEqual(6 * HOUR_MS)
  })

  it("absent/disabled/unconsumed facts impose no cap", () => {
    expect(capPosterTtlMs(6 * HOUR_MS, [null, undefined])).toBe(6 * HOUR_MS)
    expect(capPosterTtlMs(6 * HOUR_MS, [])).toBe(6 * HOUR_MS)
  })

  it("invalid deadlines never extend the TTL; past deadlines are safe, never zero", () => {
    expect(capPosterTtlMs(6 * HOUR_MS, [NaN])).toBe(6 * HOUR_MS)
    expect(capPosterTtlMs(6 * HOUR_MS, [Infinity])).toBe(6 * HOUR_MS)
    // Already-expired fact: immediate-ish TTL, never 0 (0 would mean
    // infinite/scheduled in the cache layer) and never beyond the base.
    for (const past of [-5_000, 0]) {
      const capped = capPosterTtlMs(6 * HOUR_MS, [past])
      expect(capped).toBeGreaterThan(0)
      expect(capped).toBeLessThanOrEqual(6 * HOUR_MS)
    }
  })
  it("a genuine chart miss is an absent fact: no cap, policy TTL stands", () => {
    // Live fetch won but the title is outside the chart (rank null): the
    // poster bakes "no badge" like history — the source 60s empty cadence
    // must not shrink every unranked poster to a 1-minute TTL.
    expect(
      isRankFactConsumed({ rankingEnabled: true, fetchNeeded: true, fetchWon: true, rank: null }),
    ).toBe(false)
    expect(
      isRankFactConsumed({ rankingEnabled: true, fetchNeeded: true, fetchWon: true, rank: 3 }),
    ).toBe(true)
    // Saved-rank fallback (fetch lost) is stable, never volatile.
    expect(
      isRankFactConsumed({ rankingEnabled: true, fetchNeeded: true, fetchWon: false, rank: 15 }),
    ).toBe(false)
    // Disabled channel and query overrides never consume the source.
    expect(
      isRankFactConsumed({ rankingEnabled: false, fetchNeeded: true, fetchWon: true, rank: 3 }),
    ).toBe(false)
    expect(
      isRankFactConsumed({ rankingEnabled: true, fetchNeeded: false, fetchWon: false, rank: 4 }),
    ).toBe(false)
  })
})

describe("resolvePosterFactCapMs — only consumed facts cap", () => {
  it("returns the earliest consumed deadline", () => {
    const cap = resolvePosterFactCapMs({
      trendRankRemainingMs: 5 * HOUR_MS,
      animeRankRemainingMs: 90_000,
      nowMs: T0,
    })
    expect(cap).not.toBeNull()
    expect(cap as number).toBeLessThanOrEqual(90_000)
  })

  it("ignores unconsumed facts (override/disabled/unknown)", () => {
    expect(
      resolvePosterFactCapMs({
        trendRankRemainingMs: null, // qRank override: trend never fetched
        animeRankRemainingMs: null, // ranking disabled
        availabilityRemainingMs: null, // pre-release off / unknown
        digitalReleaseDate: null,
        upcomingReleaseDate: null,
        nowMs: T0,
      }),
    ).toBeNull()
  })

  it("a future digital date bounds the pre-release badge at UTC midnight", () => {
    // T0 = 2026-10-15T12:00Z → a 2026-10-16 digital date flips the badge at
    // the START of that day (2026-10-16T00:00Z), 12h away.
    const cap = resolvePosterFactCapMs({
      availabilityRemainingMs: 6 * HOUR_MS,
      digitalReleaseDate: "2026-10-16",
      nowMs: T0,
    })
    expect(cap).not.toBeNull()
    // The earlier fact wins: 6h offers beat the 12h digital boundary.
    expect(cap as number).toBe(6 * HOUR_MS)
    expect(msUntilUtcDateBoundary("2026-10-16", T0)).toBe(12 * HOUR_MS)
  })

  it("a past digital date is not a deadline (no inferred staleness)", () => {
    expect(msUntilUtcDateBoundary("2020-01-01", T0)).toBeNull()
  })

  it("an upcoming calendar date bounds only at its local-midnight change", () => {
    const boundary = msUntilLocalDateBoundary("2026-10-16", T0)
    expect(boundary).not.toBeNull()
    expect(boundary as number).toBeGreaterThan(0)
    expect(boundary as number).toBeLessThanOrEqual(48 * HOUR_MS)
    // Garbage is never a deadline.
    expect(msUntilLocalDateBoundary("not-a-date", T0)).toBeNull()
    expect(msUntilLocalDateBoundary(null, T0)).toBeNull()
  })
})

describe("capped entries are never served stale/SWR past the fact deadline", () => {
  it("a fact-capped entry reads stale after its cap and is not SWR-servable", () => {
    writeCachedPoster(
      "poster:factcap",
      { buffer: Buffer.from([9]), etag: '"fc"', ttlSec: 60 },
      "poster:movie:1",
      { ttlMs: 60_000, factCapped: true },
    )
    const fresh = readCachedPoster("poster:factcap")
    expect(fresh.stale).toBe(false)
    expect(fresh.factCapped).toBe(true)

    // Past the cap: stale read, and the route must revalidate, not SWR-serve.
    fakeNow = T0 + 61_000
    const past = readCachedPoster("poster:factcap")
    expect(past.payload).not.toBeNull()
    expect(past.stale).toBe(true)
    expect(canServePosterStaleHit(past)).toBe(false)
  })

  it("policy entries keep the historical SWR behavior", () => {
    writeCachedPoster(
      "poster:policy",
      { buffer: Buffer.from([9]), etag: '"pl"', ttlSec: 120 },
      "poster:movie:2",
      { ttlMs: 120_000 },
    )
    fakeNow = T0 + 121_000
    const past = readCachedPoster("poster:policy")
    expect(past.stale).toBe(true)
    expect(canServePosterStaleHit(past)).toBe(true)
  })
})

describe("undecided pre-release detection must not freeze the poster", () => {
  it("pre enabled + unknown JW (null / race lost) is ephemeral", () => {
    expect(
      isPreReleaseDetectionUndecided({
        preReleaseEnabled: true,
        mediaType: "movie",
        jwAvailable: null,
      }),
    ).toBe(true)
  })

  it("pre disabled never adds an ephemeral marker from this path", () => {
    expect(
      isPreReleaseDetectionUndecided({
        preReleaseEnabled: false,
        mediaType: "movie",
        jwAvailable: null,
      }),
    ).toBe(false)
  })

  it("known JW answers keep the existing behavior (no ephemeral)", () => {
    for (const jwAvailable of [true, false]) {
      expect(
        isPreReleaseDetectionUndecided({
          preReleaseEnabled: true,
          mediaType: "movie",
          jwAvailable,
        }),
      ).toBe(false)
    }
  })

  it("series never take the pre-release path", () => {
    expect(
      isPreReleaseDetectionUndecided({
        preReleaseEnabled: true,
        mediaType: "tv",
        jwAvailable: null,
      }),
    ).toBe(false)
  })
})

describe("absent sources never cap (fail-closed to policy TTL)", () => {
  it("unknown coordinates yield null, never a guessed deadline", async () => {
    const { jwTitlesRemainingMs } = await import("@/lib/justwatch")
    const { mdblistRemainingMs } = await import("@/lib/mdblist")
    const { customRankingRemainingMs } = await import("@/lib/custom-ranking")
    expect(
      jwTitlesRemainingMs(
        {
          objectType: "MOVIE",
          country: "IT",
          first: 20,
          offset: 0,
          sortBy: "POPULAR",
          packages: undefined,
          genres: undefined,
          monetizationTypes: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
          language: "it-IT",
          overfetch: false,
        },
        T0,
      ),
    ).toBeNull()
    expect(mdblistRemainingMs("mdblistAnime", "some-key", T0)).toBeNull()
    expect(
      customRankingRemainingMs(
        { custom: { url: "https://mdblist.com/lists/u/nope" }, slot: "movie" },
        T0,
      ),
    ).toBeNull()
    // And a null cap leaves the policy TTL untouched.
    expect(capPosterTtlMs(6 * HOUR_MS, [null])).toBe(6 * HOUR_MS)
  })
})

describe("capped TTL is honored by storage and HTTP headers", () => {
  it("write→read round-trips the capped ttl and it reads fresh (not stale)", async () => {
    const { posterHeaders, posterResponse } = await import("@/lib/poster-runtime-cache")
    writeCachedPoster(
      "poster:cap",
      { buffer: Buffer.from([1, 2, 3]), etag: '"abc"', ttlSec: 60 },
      undefined,
      { ttlMs: 60_000 },
    )
    const hit = readCachedPoster("poster:cap")
    expect(hit.payload).not.toBeNull()
    expect(hit.stale).toBe(false)
    expect(hit.ttlSec).toBe(60)

    // The HTTP layer advertises the REMAINING capped lifetime, never a
    // fresh full 6h on old data.
    const headers = posterHeaders('"abc"', false, false, true, "jpeg", hit.ttlSec)
    expect(headers["Cache-Control"]).toContain("max-age=60")
    const res = posterResponse(hit.payload!, false, false, true, "jpeg", hit.ttlSec)
    expect(res.headers.get("Cache-Control")).toContain("max-age=60")
  })
})
