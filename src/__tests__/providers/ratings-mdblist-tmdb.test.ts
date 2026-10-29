// TASK C — ratings coverage via TMDB identifier when IMDb is absent.
//
// Precedence: a usable IMDb id (`tt…`) always wins (same single /imdb/ call,
// no order change, no second call on 404). Only without IMDb — and only with
// a reliable positive-integer TMDB id + explicitly normalizable type
// (movie → movie, tv/series/show → show) — a single call to the new typed
// endpoint /tmdb/{movie|show}/{id}/ is attempted. Verified live 2026-10-15
// (six authorized samples, anonymous values, no key material):
// /imdb/movie/tt0111161 ≡ /tmdb/movie/278 and /imdb/show/tt0944947 ≡
// /tmdb/show/1399 (same bodies); wrong-type 404 ≡ unknown (no retry).
//
// Env: no real network/credentials anywhere; `fetch` is stubbed per test.
// Fixtures reuse the verified anonymous sample values (tt0111161 movie; show
// with null popcorn votes) — titles/years only, no account data.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cacheClear } from "@/lib/cache"
import * as cacheModule from "@/lib/cache"
import {
  buildMdbTmdbRatingsUrl,
  fetchAggregatedRating,
  isMdbTmdbIdentityUsable,
  isValidImdbId,
  mdbTmdbSegment,
  parseTmdbId,
  __resetMdblistBreaker,
  __resetRatingsNullForTest,
} from "@/lib/ratings"
import { __resetMdbQuotaForTests } from "@/lib/mdblist-quota"
import sharp from "sharp"
import { NextRequest } from "next/server"
import { GET as posterGET } from "@/app/api/poster/[type]/[id]/route"
import { GET as detailsGET } from "@/app/api/tmdb/[id]/details/route"
import { getById } from "@/lib/store"
import { getDetails, getExternalIds, getImages } from "@/lib/tmdb"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))

vi.mock("@/lib/svg-badge", () => ({
  renderGenreBadge: vi.fn(async () => null),
  renderRankingBadge: vi.fn(async () => null),
  renderExtraBadge: vi.fn(async () => null),
  renderQualityBadge: vi.fn(async () => null),
  // Automatic title wordmark (title without any TMDB logo): the route
  // rasterizes the derived title here. A valid 1x1 PNG keeps the real
  // composite path satisfied — these tests assert base/headers/TTL, never the
  // wordmark pixels (the badge renderers above are stubbed too).
  buildTextLogoBuffer: vi.fn(async () => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAYAAACzzX7wAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQI12P4TwAw0F4BAOFkf4EHRdBsAAAAAElFTkSuQmCC", "base64")),
}))

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  // Task D freshness readers: fail-closed null in route tests (legacy TTL path).
  jwRankingsRemainingMs: vi.fn(() => null),
  jwTitlesRemainingMs: vi.fn(() => null),
  jwAvailabilityRemainingMs: vi.fn(() => null),
  JW_DIGITAL_MONETIZATION_TYPES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
}))

vi.mock("@/lib/stream-quality", () => ({
  resolveStreamQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/awards", () => ({
  fetchAllWikidata: vi.fn(async () => ({ awards: [], nominations: [], studios: [], director: null })),
  getAwardBadgeLabel: vi.fn(),
  getNominationBadgeLabel: vi.fn(),
  matchTMDBStudios: vi.fn(() => []),
  matchDirectorName: vi.fn((name: string | null) => name),
  directorBadgeLabel: vi.fn((name: string | null) => name),
  isValidWikidataQid: (v: unknown): v is string => typeof v === "string" && /^Q\d+$/.test(v),
}))

vi.mock("@/lib/mdblist", () => ({
  fetchMDBList: vi.fn(async () => []),
  // Task D freshness reader: fail-closed null in route tests (legacy TTL path).
  mdblistRemainingMs: vi.fn(() => null),
}))

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  fetchCustomRatings: vi.fn(async () => []),
}))

vi.mock("@/lib/multi-rating-renderer", () => ({ renderMultiRatings: vi.fn(async () => null) }))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

// NOTE: @/lib/ratings stays REAL here (mocked in poster-route-mapping.test.ts).
// @/lib/tmdb is mocked, including the query-based resolveRouteApiKey used by
// the details route (same shape as tmdb-details-route.test.ts).
vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(
    async (
      mediaType: "movie" | "tv",
      tmdbId: number,
      language?: string,
      apiKey?: string,
      signal?: AbortSignal,
      timeoutMs?: number,
    ) => {
      const det = await mockedTmdbGetDetails(mediaType, tmdbId, language, apiKey, signal, timeoutMs)
      const ext = await mockedTmdbGetExternalIds(mediaType, tmdbId, apiKey, signal, timeoutMs)
      return { ...det, external_ids: ext }
    },
  ),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn((req: { nextUrl?: { searchParams: URLSearchParams } }) => req.nextUrl?.searchParams.get("api_key") || undefined),
  resolveUserApiKeys: vi.fn(async (req: { headers: { get: (n: string) => string | null }; nextUrl?: { searchParams: URLSearchParams } }) => {
    const q = req.nextUrl?.searchParams.get("api_key") || undefined
    const none = { key: undefined, source: "none" } as const
    return {
      tmdb: q ? { key: q, source: "query" } : none,
      mdblist: none,
      tvdb: none,
    }
  }),
  resolveRouteApiKey: vi.fn(async (req: Request, kind?: string) => {
    const q = new URL(req.url).searchParams
    return (kind === "mdblist" ? q.get("mdblist_key") : q.get("api_key")) || undefined
  }),
}))

const mockedGetById = vi.mocked(getById)
const mockedTmdbGetDetails = vi.mocked(getDetails)
const mockedTmdbGetImages = vi.mocked(getImages)
const mockedTmdbGetExternalIds = vi.mocked(getExternalIds)

async function resetMdbRaw(): Promise<void> {
  const mod = (await import("@/lib/ratings")) as unknown as Record<string, unknown>
  const fn = mod.__resetMdbRawForTest
  if (typeof fn === "function") (fn as () => void)()
}

function jsonOk(body: unknown): unknown {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body }
}

function notFound(): unknown {
  return { ok: false, status: 404, headers: new Headers(), json: async () => ({ error: "Item not found" }) }
}

// Verified 2026-10-15 anonymous sample: imdb/movie/tt0111161 ≡ tmdb/movie/278
// (subset of the observed ratings[], values as returned — no account data).
const SHAWSHANK = {
  type: "movie",
  title: "The Shawshank Redemption",
  year: 1994,
  released: "1994-09-23",
  score: 89,
  ratings: [
    { source: "imdb", value: 9.3, score: 93, votes: 3251848 },
    { source: "metacritic", value: 82, score: 82, votes: 22 },
    { source: "trakt", value: 91, score: 91, votes: 48287 },
    { source: "tomatoes", value: 89, score: 89, votes: 147 },
    { source: "popcorn", value: 98, score: 98, votes: 53483 },
    { source: "tmdb", value: 87, score: 87, votes: 31580 },
    { source: "letterboxd", value: 4.6, score: 92, votes: 3179221 },
    { source: "rogerebert", value: 3.5, score: null, votes: null },
    { source: "myanimelist", value: null, score: null, votes: null },
  ],
}

// Verified 2026-10-15 anonymous sample shape: imdb/show/tt0944947 ≡
// tmdb/show/1399 (same body). Popcorn votes null must be kept (missing counts
// never filter).
const SHOW = {
  type: "show",
  title: "Sample Show",
  year: 2008,
  released: "2008-01-20",
  score: 87,
  ratings: [
    { source: "imdb", value: 9.5, score: 95, votes: 2100000 },
    { source: "popcorn", value: 85, score: 85, votes: null },
    { source: "tmdb", value: 8.9, score: 89, votes: 15000 },
  ],
}

beforeEach(async () => {
  delete process.env.MDBLIST_API_URL
  vi.unstubAllEnvs()
  cacheClear()
  __resetMdblistBreaker()
  __resetRatingsNullForTest()
  __resetMdbQuotaForTests()
  await resetMdbRaw()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete process.env.MDBLIST_API_URL
  cacheClear()
  __resetMdblistBreaker()
  __resetRatingsNullForTest()
  __resetMdbQuotaForTests()
  await resetMdbRaw()
  vi.restoreAllMocks()
})

describe("TMDB identifier validation (no bare-numeric IMDb, no fabricated tt)", () => {
  it("isValidImdbId accepts tt… strings, rejects bare numerics and empties", () => {
    expect(isValidImdbId("tt0111161")).toBe(true)
    expect(isValidImdbId("tt_show1")).toBe(true)
    expect(isValidImdbId("TT1234567")).toBe(true)
    expect(isValidImdbId("278")).toBe(false)
    expect(isValidImdbId("tt")).toBe(false)
    expect(isValidImdbId("")).toBe(false)
    expect(isValidImdbId(null)).toBe(false)
    expect(isValidImdbId(undefined)).toBe(false)
    expect(isValidImdbId(278)).toBe(false)
  })

  it("parseTmdbId accepts positive integers only", () => {
    expect(parseTmdbId(278)).toBe(278)
    expect(parseTmdbId("278")).toBe(278)
    expect(parseTmdbId(" 278 ")).toBe(278)
    expect(parseTmdbId(0)).toBeNull()
    expect(parseTmdbId(-3)).toBeNull()
    expect(parseTmdbId(27.5)).toBeNull()
    expect(parseTmdbId("27.5")).toBeNull()
    expect(parseTmdbId("abc")).toBeNull()
    expect(parseTmdbId("")).toBeNull()
    expect(parseTmdbId("tt0111161")).toBeNull()
    expect(parseTmdbId(null)).toBeNull()
    expect(parseTmdbId(undefined)).toBeNull()
    expect(parseTmdbId(NaN)).toBeNull()
  })

  it("mdbTmdbSegment keeps explicit movie/show only (ambiguous → null)", () => {
    expect(mdbTmdbSegment("movie")).toBe("movie")
    expect(mdbTmdbSegment("tv")).toBe("show")
    expect(mdbTmdbSegment("series")).toBe("show")
    expect(mdbTmdbSegment("show")).toBe("show")
    expect(mdbTmdbSegment("anime")).toBeNull()
    expect(mdbTmdbSegment("any")).toBeNull()
    expect(mdbTmdbSegment(undefined)).toBeNull()
    expect(mdbTmdbSegment(null)).toBeNull()
    expect(mdbTmdbSegment("")).toBeNull()
  })

  it("isMdbTmdbIdentityUsable gates reliable id + explicit type", () => {
    expect(isMdbTmdbIdentityUsable(278, "movie")).toBe(true)
    expect(isMdbTmdbIdentityUsable("278", "tv")).toBe(true)
    expect(isMdbTmdbIdentityUsable(1399, "series")).toBe(true)
    expect(isMdbTmdbIdentityUsable(278, "anime")).toBe(false)
    expect(isMdbTmdbIdentityUsable(278, undefined)).toBe(false)
    expect(isMdbTmdbIdentityUsable(0, "movie")).toBe(false)
    expect(isMdbTmdbIdentityUsable("abc", "movie")).toBe(false)
    expect(isMdbTmdbIdentityUsable(null, "movie")).toBe(false)
  })

  it("buildMdbTmdbRatingsUrl uses the typed TMDB path with apikey query", () => {
    expect(buildMdbTmdbRatingsUrl(278, "k", "movie")).toBe(
      "https://api.mdblist.com/tmdb/movie/278/?apikey=k",
    )
    expect(buildMdbTmdbRatingsUrl(1399, "k", "show")).toBe(
      "https://api.mdblist.com/tmdb/show/1399/?apikey=k",
    )
    process.env.MDBLIST_API_URL = "http://mock.test/md"
    expect(buildMdbTmdbRatingsUrl(278, undefined, "movie")).toBe(
      "http://mock.test/md/tmdb/movie/278/",
    )
  })
})

describe("TMDB transport (single typed call, IMDb preferred)", () => {
  it("tmdb-only movie → one /tmdb/movie/ call with normalized sources", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: "movie" })
    expect(r?.sources.imdb).toBe(9.3)
    expect(r?.sources.tmdb).toBe(8.7)
    expect(r?.sources.mdblist).toBe(8.9)
    expect(r?.sources.rogerebert).toBe(8.8)
    expect(r?.sources.popcorntime).toBe(9.8)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.mdblist.com/tmdb/movie/278/?apikey=k")
  })

  it("tv/series/show → /tmdb/show/ (null popcorn votes kept); string tmdbId works", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url).includes("/tmdb/show/1399/")).toBe(true)
      return jsonOk(SHOW)
    })
    vi.stubGlobal("fetch", fetchMock)
    for (const mediaType of ["tv", "series", "show"] as const) {
      cacheClear()
      const r = await fetchAggregatedRating(null, "k", undefined, { tmdbId: "1399", mediaType: mediaType as unknown as "tv" })
      expect(r?.sources.imdb).toBe(9.5)
      expect(r?.sources.tmdb).toBe(8.9)
      expect(r?.sources.popcorntime).toBe(8.5)
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("IMDb present → only the /imdb/ call (no order change, no TMDB call)", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("tt0111161", "k", undefined, { tmdbId: 278, mediaType: "movie" })
    expect(r?.sources.imdb).toBe(9.3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.mdblist.com/imdb/movie/tt0111161/?apikey=k")
  })

  it("IMDb 404 → genuine miss, no second TMDB call", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => notFound())
    vi.stubGlobal("fetch", fetchMock)
    const opts = { tmdbId: 278, mediaType: "movie" } as const
    expect(await fetchAggregatedRating("tt_wrongtype", "k", undefined, opts)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.mdblist.com/imdb/movie/tt_wrongtype/?apikey=k")
    // Same identity: negative-cached, still a single upstream call.
    expect(await fetchAggregatedRating("tt_wrongtype", "k", undefined, opts)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("TMDB 404 → null with no IMDb retry (single call, negative-cached)", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url).includes("/tmdb/")).toBe(true)
      return notFound()
    })
    vi.stubGlobal("fetch", fetchMock)
    const opts = { tmdbId: 9999, mediaType: "movie" } as const
    expect(await fetchAggregatedRating(null, "k", undefined, opts)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.mdblist.com/tmdb/movie/9999/?apikey=k")
    expect(await fetchAggregatedRating(null, "k", undefined, opts)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("bare-numeric imdbId is never queried as /imdb/ (TMDB path instead)", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating("278", "k", undefined, { tmdbId: 278, mediaType: "movie" })
    expect(r?.sources.imdb).toBe(9.3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls[0]).toContain("/tmdb/movie/278/")
    expect(urls.some((u) => u.includes("/imdb/"))).toBe(false)
  })
})

describe("invalid inputs: no MDBList call (safe direct fallback or null)", () => {
  it("bare-numeric imdb without tmdb → null, zero fetch", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchAggregatedRating("278", "k")).toBeNull()
    expect(await fetchAggregatedRating("", "k")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("non-positive/non-integer tmdbId → null, zero fetch", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    for (const bad of [0, -3, 27.5, "abc", "", "27.5", NaN, null, undefined]) {
      expect(await fetchAggregatedRating(null, "k", undefined, { tmdbId: bad as number, mediaType: "movie" })).toBeNull()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("valid tmdbId with ambiguous type → null, zero fetch", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    for (const mediaType of [undefined, null, "anime", "any", ""] as const) {
      expect(
        await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: mediaType as "anime" }),
      ).toBeNull()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("ambiguous type with anime requested → MDBList untouched (direct-only path)", async () => {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        urls.push(String(url))
        return notFound()
      }),
    )
    const r = await fetchAggregatedRating(null, "k", undefined, {
      tmdbId: 278,
      mediaType: "anime",
      wantAnilist: true,
    })
    expect(r).toBeNull()
    expect(urls.some((u) => u.includes("mdblist"))).toBe(false)
  })

  it("tmdb-only selection with genuine direct vote needs no identity and no fetch", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const r = await fetchAggregatedRating(null, undefined, undefined, {
      requestedSources: ["tmdb"],
      tmdbFallbackVote: 7.9,
    })
    expect(r).toEqual({ sources: { tmdb: 7.9 }, average: 7.9, count: 1 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("typed cache isolation: provider namespace + type + id + policy", () => {
  it("film278 ≠ show278: isolated raw entries, own upstream each", async () => {
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).includes("/tmdb/show/278/") ? jsonOk(SHOW) : jsonOk(SHAWSHANK),
    )
    vi.stubGlobal("fetch", fetchMock)
    const seen: string[] = []
    const originalSet = cacheModule.cacheSet
    const spy = vi.spyOn(cacheModule, "cacheSet").mockImplementation((k: string, v: unknown, tags?: string[], ttlMs?: number) => {
      seen.push(k)
      originalSet(k, v, tags ?? [], ttlMs)
    })
    try {
      await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: "movie" })
      await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: "tv" })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const rawKeys = seen.filter((k) => k.startsWith("mdb:raw:"))
      expect(rawKeys).toHaveLength(2)
      expect(rawKeys[0]).toMatch(/^mdb:raw:v3:movie:tmdb278:[0-9a-f]{8}:mv10$/)
      expect(rawKeys[1]).toMatch(/^mdb:raw:v3:show:tmdb278:[0-9a-f]{8}:mv10$/)
    } finally {
      spy.mockRestore()
    }
  })

  it("IMDb string ≠ tmdb numeric: aggregated and raw keys namespaced", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const seen: string[] = []
    const originalSet = cacheModule.cacheSet
    const spy = vi.spyOn(cacheModule, "cacheSet").mockImplementation((k: string, v: unknown, tags?: string[], ttlMs?: number) => {
      seen.push(k)
      originalSet(k, v, tags ?? [], ttlMs)
    })
    try {
      await fetchAggregatedRating("tt0111161", "k", undefined, { mediaType: "movie" })
      await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: "movie" })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const aggKeys = seen.filter((k) => k.startsWith("mdb:ratings:"))
      expect(aggKeys.some((k) => k.includes(":v3:tt0111161:"))).toBe(true)
      expect(aggKeys.some((k) => k.includes(":v3:tmdb278:"))).toBe(true)
      const rawKeys = seen.filter((k) => k.startsWith("mdb:raw:"))
      expect(rawKeys.some((k) => k.includes(":movie:tt0111161:"))).toBe(true)
      expect(rawKeys.some((k) => k.includes(":movie:tmdb278:"))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it("cached hits stay parked per key: same key reuses, other key refetches", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const opts = { tmdbId: 278, mediaType: "movie" } as const
    await fetchAggregatedRating(null, "keyA", undefined, opts)
    await fetchAggregatedRating(null, "keyA", undefined, opts)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await fetchAggregatedRating(null, "keyB", undefined, opts)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("min-votes policy segments the tmdb raw key (mv0 with filter off)", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const seen: string[] = []
    const originalSet = cacheModule.cacheSet
    const spy = vi.spyOn(cacheModule, "cacheSet").mockImplementation((k: string, v: unknown, tags?: string[], ttlMs?: number) => {
      seen.push(k)
      originalSet(k, v, tags ?? [], ttlMs)
    })
    try {
      vi.stubEnv("PICTORIUM_RATING_MIN_VOTES", "0")
      await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: "movie" })
      expect(seen.filter((k) => k.startsWith("mdb:raw:")).pop()).toMatch(/:mv0$/)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("known-pair raw dedup vs unknown-alias separation", () => {
  it("caller-known IMDb+TMDB pair: tmdb-only reuses the imdb raw entry (one fetch)", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const seen: string[] = []
    const originalSet = cacheModule.cacheSet
    const spy = vi.spyOn(cacheModule, "cacheSet").mockImplementation((k: string, v: unknown, tags?: string[], ttlMs?: number) => {
      seen.push(k)
      originalSet(k, v, tags ?? [], ttlMs)
    })
    try {
      const a = await fetchAggregatedRating("tt0111161", "k", undefined, { tmdbId: 278, mediaType: "movie" })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const b = await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: "movie" })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(b?.sources).toEqual(a?.sources)
      const rawKeys = seen.filter((k) => k.startsWith("mdb:raw:"))
      expect(rawKeys.some((k) => k.includes(":movie:tt0111161:"))).toBe(true)
      expect(rawKeys.some((k) => k.includes(":movie:tmdb278:"))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it("response-observed counterpart: imdb reuses the tmdb raw entry (one fetch)", async () => {
    const observed = {
      type: "movie",
      title: "Observed",
      year: 2020,
      released: "2020-01-01",
      score: 80,
      imdb_id: "tt0279001",
      tmdb_id: 279,
      ratings: [
        { source: "imdb", value: 8.1, score: 81, votes: 5000 },
        { source: "tmdb", value: 7.7, score: 77, votes: 3000 },
      ],
    }
    const fetchMock = vi.fn(async (url: unknown) => {
      expect(String(url).includes("/tmdb/movie/279/")).toBe(true)
      return jsonOk(observed)
    })
    vi.stubGlobal("fetch", fetchMock)
    const a = await fetchAggregatedRating(null, "k", undefined, { tmdbId: 279, mediaType: "movie" })
    expect(a?.sources.imdb).toBe(8.1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Same segment: the observed imdb_id alias serves the later IMDb lookup.
    const b = await fetchAggregatedRating("tt0279001", "k", undefined, { mediaType: "movie" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(b?.sources).toEqual(a?.sources)
  })

  it("conflicting evidence (caller 278 vs observed 999): entries stay separate", async () => {
    const conflict = {
      type: "movie",
      title: "Conflict",
      year: 2020,
      released: "2020-01-01",
      score: 80,
      tmdb_id: 999,
      ratings: [{ source: "imdb", value: 8.1, score: 81, votes: 5000 }],
    }
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/imdb/movie/tt_c1/")) return jsonOk(conflict)
      if (u.includes("/tmdb/movie/278/")) return jsonOk(SHAWSHANK)
      return notFound()
    })
    vi.stubGlobal("fetch", fetchMock)
    const a = await fetchAggregatedRating("tt_c1", "k", undefined, { tmdbId: 278, mediaType: "movie" })
    expect(a?.sources.imdb).toBe(8.1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // No alias was written: the tmdb lookup fetches its own entry (no
    // coalescing with the conflicting imdb sources).
    const b = await fetchAggregatedRating(null, "k", undefined, { tmdbId: 278, mediaType: "movie" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(b?.sources.imdb).toBe(9.3)
    // The observed-but-conflicted 999 is likewise separate (404, its own miss).
    expect(await fetchAggregatedRating(null, "k", undefined, { tmdbId: 999, mediaType: "movie" })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("unknown alias: imdb-only then tmdb-only stay separate entries", async () => {
    const movie888 = {
      type: "movie",
      title: "Other",
      year: 2021,
      released: "2021-05-01",
      score: 70,
      ratings: [{ source: "tmdb", value: 7.0, score: 70, votes: 900 }],
    }
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/imdb/movie/tt_u1/")) return jsonOk(SHAWSHANK)
      if (u.includes("/tmdb/movie/888/")) return jsonOk(movie888)
      return notFound()
    })
    vi.stubGlobal("fetch", fetchMock)
    const seen: string[] = []
    const originalSet = cacheModule.cacheSet
    const spy = vi.spyOn(cacheModule, "cacheSet").mockImplementation((k: string, v: unknown, tags?: string[], ttlMs?: number) => {
      seen.push(k)
      originalSet(k, v, tags ?? [], ttlMs)
    })
    try {
      expect((await fetchAggregatedRating("tt_u1", "k", undefined, { mediaType: "movie" }))?.sources.imdb).toBe(9.3)
      expect((await fetchAggregatedRating(null, "k", undefined, { tmdbId: 888, mediaType: "movie" }))?.sources.tmdb).toBe(7)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const rawKeys = seen.filter((k) => k.startsWith("mdb:raw:"))
      expect(rawKeys.some((k) => k.includes(":movie:tt_u1:"))).toBe(true)
      expect(rawKeys.some((k) => k.includes(":movie:tmdb888:"))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("request abort: transient, no extra upstream", () => {
  it("pre-aborted caller resolves null without touching the network", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => jsonOk(SHAWSHANK))
    vi.stubGlobal("fetch", fetchMock)
    const ctrl = new AbortController()
    ctrl.abort()
    expect(await fetchAggregatedRating(null, "k", ctrl.signal, { tmdbId: 278, mediaType: "movie" })).toBeNull()
    expect(await fetchAggregatedRating("tt0111161", "k", ctrl.signal, { mediaType: "movie" })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// Task C fixture for the route tests below: same shape as the mock-server
// /tmdb/movie/278 body (anonymous values, no key material).
const MOVIE_TMDB = {
  type: "movie",
  title: "Mock",
  year: 2020,
  score: 80,
  ratings: [
    { source: "imdb", value: 8.7, score: 87, votes: 5000 },
    { source: "tmdb", value: 7.9, score: 79, votes: 3000 },
    { source: "tomatoes", value: 88, score: 88, votes: 900 },
    { source: "popcorntime", value: 9.2, score: 92, votes: 1500 },
    { source: "metacritic", value: 75, score: 75, votes: 800 },
  ],
}

describe("route regression: details honors TMDB sources without IMDb", () => {
  it("no-imdb details requests /tmdb/show/ and averages the chosen sources", async () => {
    process.env.MDBLIST_API_URL = "http://mock.test/md";
    (mockedTmdbGetDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      title: "Mock Show",
      name: null,
      genres: [],
      // Same as the provider tmdb below: the genuine direct-vote overlay is
      // a no-op here (its precedence is covered elsewhere).
      vote_average: 8.9,
      vote_count: 0,
      type: "show",
      status: null,
      release_date: null,
      first_air_date: "2008-01-20",
      last_air_date: null,
      next_episode_to_air: null,
      number_of_seasons: null,
      number_of_episodes: null,
      networks: [],
      production_companies: [],
      original_language: "en",
    });
    (mockedTmdbGetExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: null })
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url)
        seen.push(u)
        if (u.startsWith("http://mock.test/md/tmdb/show/1399/")) return jsonOk(SHOW)
        return notFound()
      }),
    )
    const req = new NextRequest(
      "http://localhost:3000/api/tmdb/1399/details?type=tv&language=it-IT&api_key=k&mdblist_key=k&rsrc=imdb,tmdb",
    )
    const res = await detailsGET(req, { params: Promise.resolve({ id: "1399" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imdb_id).toBeNull()
    // Selection rsrc=imdb,tmdb: the family branch carries only the requested
    // sources (existing selection filtering, unchanged by task C).
    expect(body.aggregatedRatings?.sources.imdb).toBe(9.5)
    expect(body.aggregatedRatings?.sources.tmdb).toBe(8.9)
    expect(body.voteAverage).toBe((9.5 + 8.9) / 2)
    const mdbCalls = seen.filter((u) => u.includes("mock.test/md"))
    expect(mdbCalls).toHaveLength(1)
    expect(mdbCalls[0]).toBe("http://mock.test/md/tmdb/show/1399/?apikey=k")
  })
})

describe("route regression: poster auto/mapped without IMDb share the TMDB path", () => {
  async function imageBytes(): Promise<Buffer> {
    return sharp({ create: { width: 500, height: 750, channels: 4, background: "#101010" } }).png().toBuffer()
  }

  it("auto (preview) without IMDb requests /tmdb/movie/ and renders 200", async () => {
    process.env.MDBLIST_API_URL = "http://mock.test/md"
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    __resetTMDBSessionCache()
    __resetImageBytesForTest();
    (mockedGetById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockedTmdbGetDetails as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 278001,
      title: "TMDB Only",
      genres: [{ id: 18, name: "Drama" }],
      vote_average: 7.5,
      vote_count: 100,
      original_language: "en",
      release_date: "2020-01-01",
      production_companies: [],
      networks: [],
    });
    (mockedTmdbGetImages as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 278001,
      posters: [
        { file_path: "/t278001.jpg", iso_639_1: null, vote_average: 7, vote_count: 10, width: 500, height: 750, aspect_ratio: 0.667 },
      ],
      logos: [],
      backdrops: [],
    });
    (mockedTmdbGetExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: null })
    const buf = await imageBytes()
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const u = String(input)
        seen.push(u)
        if (u.startsWith("http://mock.test/md/tmdb/")) {
          if (u.includes("/tmdb/movie/278001/")) return jsonOk(MOVIE_TMDB)
          return notFound()
        }
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } })
      }),
    )
    const res = await posterGET(new NextRequest("http://localhost:3000/api/poster/movie/278001?preview=1&rsrc=imdb,tmdb"), {
      params: Promise.resolve({ type: "movie", id: "278001" }),
    })
    expect(res.status).toBe(200)
    const mdbCalls = seen.filter((u) => u.includes("mock.test/md"))
    expect(mdbCalls).toHaveLength(1)
    expect(mdbCalls[0].includes("/tmdb/movie/278001/")).toBe(true)
    expect(mdbCalls.some((u) => u.includes("/imdb/"))).toBe(false)
  })

  it("mapped (final) without IMDb requests /tmdb/movie/ on the same endpoint", async () => {
    process.env.MDBLIST_API_URL = "http://mock.test/md"
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    __resetTMDBSessionCache()
    __resetImageBytesForTest();
    (mockedGetById as ReturnType<typeof vi.fn>).mockResolvedValue({
      tmdbId: 278002,
      mediaType: "movie",
      title: "Mapped TMDB Only",
      posterPath: "/m278002.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      voteAverage: 7.5,
      rankingBadges: false,
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    (mockedTmdbGetExternalIds as ReturnType<typeof vi.fn>).mockResolvedValue({ imdb_id: null })
    const buf = await imageBytes()
    const seen: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const u = String(input)
        seen.push(u)
        if (u.startsWith("http://mock.test/md/tmdb/")) {
          if (u.includes("/tmdb/movie/278002/")) return jsonOk(MOVIE_TMDB)
          return notFound()
        }
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } })
      }),
    )
    // Final-style (no preview): same shared renderer, separate-column sources
    // requested via sep=1 + rsrc.
    const res = await posterGET(new NextRequest("http://localhost:3000/api/poster/movie/278002?sep=1&rsrc=imdb,tmdb"), {
      params: Promise.resolve({ type: "movie", id: "278002" }),
    })
    expect(res.status).toBe(200)
    const mdbCalls = seen.filter((u) => u.includes("mock.test/md"))
    expect(mdbCalls).toHaveLength(1)
    expect(mdbCalls[0].includes("/tmdb/movie/278002/")).toBe(true)
    expect(mdbCalls.some((u) => u.includes("/imdb/"))).toBe(false)
  })
})
