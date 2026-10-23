import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getImages, getExternalIds } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear, cacheExpire } from "@/lib/cache"
import { resolveStreamQuality } from "@/lib/stream-quality"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { renderRankingBadge } from "@/lib/svg-badge"
import * as runtimeCache from "@/lib/poster-runtime-cache"
import {
  __inMemoryChartGenerationPersist,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
  nextRomeSlotStartMs,
} from "@/lib/chart-generation"
import { RENDER_VERSION } from "@/lib/render-version"

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  fetchCustomRatings: vi.fn(async () => []),
}))
vi.mock("@/lib/multi-rating-renderer", () => ({ renderMultiRatings: vi.fn(async () => null) }))

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
  // La route legge i default globali via getServerDefaultsChecked (revisione
  // epoch): nei test delega allo stesso mock controllabile.
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
}))

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  // Task D freshness readers: fail-closed null here (legacy TTL path); the
  // dedicated Task D tests arm them explicitly where a cap is expected.
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
  // Task D freshness reader: fail-closed null here (legacy TTL path).
  mdblistRemainingMs: vi.fn(() => null),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(),
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
}))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

const mockedGetById = vi.mocked(getById)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedFetchMDBList = vi.mocked(fetchMDBList)
const mockedRenderRankingBadge = vi.mocked(renderRankingBadge)

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

const UPDATED_AT = "2026-09-12T00:00:00.000Z"
const MV = Date.parse(UPDATED_AT)

// Controlled Rome clock shared by the chart contract below: T0 is mid-slot
// (2026-10-15 12:00 UTC = 14:00 Rome, slot 20261015-12), so the first request
// of each test publishes a current-slot snapshot and crossSlotBoundary()
// moves just past its end. Same-slot snapshots are served even when the
// mocked upstream payload changes — rank changes only take effect after a
// real slot advance (no chart reset mid-test to fake a refresh).
let fakeNow = Date.UTC(2026, 9, 15, 12, 0, 0)

function installFakeClock(): void {
  vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
}

/** Advance the controlled clock just past the current Rome slot end. */
function crossSlotBoundary(): void {
  fakeNow = nextRomeSlotStartMs(fakeNow) + 1_000
}

function resetChartStateForTest(): void {
  __resetChartGenerationForTest()
  __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
}

function clearChartStateForTest(): void {
  __resetChartGenerationForTest()
  __setChartGenerationPersistForTest(null)
}

// Fixture: mapping salvato con ranking live. Il badge è rosso per rank 1 e
// blu per rank 2, così il cambio dei byte è verificabile senza servizi reali.
async function freshnessFixture(id: number, opts?: { ranking?: boolean; format?: string; live?: boolean; versioned?: boolean; resetCache?: boolean }) {
  const { ranking = true, format = "webp", live = false, versioned = true, resetCache = true } = opts ?? {}
  if (resetCache) cacheClear()
  mockedGetById.mockResolvedValue({
    tmdbId: id, mediaType: "movie", title: "Freshness", posterPath: "/fresh.jpg",
    logoPath: null, originalPosterPath: null, language: "it",
    showBadges: true, rankingBadges: ranking, trendRank: 1, updatedAt: UPDATED_AT,
  })
  mockedGetDetails.mockResolvedValue({ id, genres: [], vote_average: 5, vote_count: 10 })
  mockedGetExternalIds.mockResolvedValue({ imdb_id: `tt${id}` })
  mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: id, rank: 1 } as never])
  mockedFetchMDBList.mockReset().mockResolvedValue([])
  const poster = await imageBuffer("#101010", 500, 750)
  const red = await imageBuffer("#ff0000", 100, 30)
  const blue = await imageBuffer("#0000ff", 100, 30)
  mockedRenderRankingBadge.mockReset().mockImplementation(async (rank: unknown) => ({
    png: rank === 1 ? red : blue, w: 100, h: 30,
  }) as never)
  const mockedScheduleRefresh = vi.spyOn(runtimeCache, "schedulePosterRefresh").mockImplementation(() => {})
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
    headers: { "content-type": "image/png" },
  }))
  const params = new URLSearchParams({ mv: String(MV), fmt: format, ranking: ranking ? "1" : "0" })
  if (live) params.set("live", "1")
  if (versioned) params.set("rv", RENDER_VERSION)
  const base = `http://localhost:3000/api/poster/movie/${id}?${params.toString()}`
  const request = (etag?: string) => GET(new NextRequest(base, {
    headers: etag ? { "If-None-Match": etag } : {},
  }), { params: Promise.resolve({ type: "movie", id: String(id) }) })
  return { request, refresh: mockedScheduleRefresh }
}

describe("poster freshness: ETag represents the actual bytes (audit problem 1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fakeNow = Date.UTC(2026, 9, 15, 12, 0, 0)
    installFakeClock()
    resetChartStateForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    clearChartStateForTest()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("different live rank produces different bytes and a different ETag", async () => {
    const { request } = await freshnessFixture(920001)
    const first = await request()
    expect(first.status).toBe(200)
    const oldBody = Buffer.from(await first.arrayBuffer())
    const oldEtag = first.headers.get("etag")!
    // Rank changes take effect after a real slot advance: same-slot upstream
    // changes never bypass the published snapshot (pinned below).
    crossSlotBoundary()
    cacheClear()
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: 920001, rank: 2 } as never])
    mockedRenderRankingBadge.mockClear()
    const second = await request()
    expect(second.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    expect(Buffer.from(await second.arrayBuffer()).equals(oldBody)).toBe(false)
    expect(second.headers.get("etag")).not.toBe(oldEtag)
  })

  it("rank change revalidates past the fact deadline without clearing the cache", async () => {
    const id = 920030
    const { request } = await freshnessFixture(id)
    const first = await request()
    expect(first.status).toBe(200)
    const oldBody = Buffer.from(await first.arrayBuffer())
    const oldEtag = first.headers.get("etag")!
    // Past the snapshot expiry the entry revalidates instead of stale-serving.
    crossSlotBoundary()
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: id, rank: 2 } as never])
    mockedRenderRankingBadge.mockClear()

    const changed = await request(oldEtag)
    expect(changed.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    expect(changed.headers.get("etag")).not.toBe(oldEtag)
    expect(Buffer.from(await changed.arrayBuffer()).equals(oldBody)).toBe(false)
  })

  it("leaving the chart removes the badge even with a fresh cached poster and a saved rank", async () => {
    const { request } = await freshnessFixture(920031)
    const first = await request()
    expect(first.status).toBe(200)
    expect(mockedRenderRankingBadge).toHaveBeenCalled()
    // A genuine empty in the new slot publishes an empty snapshot: the miss
    // stays null and never resurrects the saved rank.
    crossSlotBoundary()
    mockedGetJWRankings.mockResolvedValue([])
    mockedRenderRankingBadge.mockClear()

    const changed = await request(first.headers.get("etag")!)
    expect(changed.status).toBe(200)
    expect(changed.headers.get("etag")).not.toBe(first.headers.get("etag"))
    expect(mockedRenderRankingBadge).not.toHaveBeenCalled()
  })

  it("same-slot upstream rank change does not bypass the published snapshot", async () => {
    const id = 920034
    const { request } = await freshnessFixture(id)
    const first = await request()
    expect(first.status).toBe(200)
    // Upstream moves to rank 2 but the slot has NOT advanced: the published
    // snapshot keeps serving — no extra JW fetch on the hit, no re-render.
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: id, rank: 2 } as never])
    mockedGetJWRankings.mockClear()
    mockedRenderRankingBadge.mockClear()
    const same = await request(first.headers.get("etag")!)
    expect(same.status).toBe(304)
    expect(same.headers.get("etag")).toBe(first.headers.get("etag"))
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
    expect(mockedRenderRankingBadge).not.toHaveBeenCalled()
  })

  it("charts outage retains the last published rank instead of the saved rank", async () => {
    const id = 920032
    const { request } = await freshnessFixture(id)
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: id, rank: 2 } as never])
    const first = await request()
    expect(first.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    // Cross the slot with the upstream down: the refresh fails and the
    // published snapshot is retained — the older saved rank 1 must NOT win.
    crossSlotBoundary()
    mockedGetJWRankings.mockRejectedValue(new Error("Ranking source unavailable"))
    mockedRenderRankingBadge.mockClear()

    const retained = await request(first.headers.get("etag")!)
    // Same pinned rank under the same rank-carrying key: the mapped entry is
    // still storage-fresh, so the conditional is a 304 with a zero deadline —
    // no re-render, no saved-rank fallback. (A fallback to saved rank 1 would
    // change the key, miss, and render different bytes with a 200.)
    expect(retained.status).toBe(304)
    expect(mockedRenderRankingBadge).not.toHaveBeenCalled()
    expect(retained.headers.get("etag")).toBe(first.headers.get("etag"))
    // Expired pinned fact: zero deadline, must-revalidate, no SWR anywhere.
    const retainedCC = retained.headers.get("cache-control")!
    expect(retainedCC).toContain("max-age=0")
    expect(retainedCC).toContain("must-revalidate")
    expect(retainedCC).not.toContain("stale-while-revalidate")
    expect(retainedCC).not.toContain("stale-if-error")
    expect(retainedCC).not.toContain("immutable")
  })

  it("cold charts failure falls back to the saved rank", async () => {
    const id = 920033
    const { request } = await freshnessFixture(id)
    // Hermetic chart state is empty (beforeEach reset) and the upstream is
    // down from the start: cold outage → degraded with the saved rank.
    mockedGetJWRankings.mockRejectedValue(new Error("Ranking source unavailable"))
    mockedRenderRankingBadge.mockClear()

    const degraded = await request()
    expect(degraded.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(1)
    expect(degraded.headers.get("etag")).not.toBeNull()
  })

  it("cold poster-cache miss reuses the published snapshot without refetching", async () => {
    const { request } = await freshnessFixture(920002)
    const first = await request()
    expect(first.status).toBe(200)
    const etag = first.headers.get("etag")!
    // Poster cache empty, legacy validator (pre-fix format): the published
    // snapshot still pins the rank, so the cold miss re-renders from the pin
    // with zero upstream refetch — no extra JW fetch within one slot.
    cacheClear()
    mockedGetJWRankings.mockClear().mockResolvedValue([{ tmdbId: 920002, rank: 1 } as never])
    mockedRenderRankingBadge.mockClear()
    const cold = await request('"mdeadbeef:2026-09-12T00:00:00.000Z"')
    expect(cold.status).toBe(200)
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
    expect(mockedRenderRankingBadge).toHaveBeenCalled()
    expect(cold.headers.get("etag")).toBe(etag)
  })

  it("full sequence: poster, rank change, expiry, old ETag gives 200 + new ETag, then 304", async () => {
    const { request } = await freshnessFixture(920003)
    const first = await request()
    expect(first.status).toBe(200)
    const etag1 = first.headers.get("etag")!
    // The live rank changes and the snapshot expires (slot advance).
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: 920003, rank: 2 } as never])
    crossSlotBoundary()
    const changed = await request(etag1)
    expect(changed.status).toBe(200)
    const etag2 = changed.headers.get("etag")!
    expect(etag2).not.toBe(etag1)
    // Contenuto invariato alla rivalidazione successiva → 304.
    const stable = await request(etag2)
    expect(stable.status).toBe(304)
  })
})

describe("poster freshness: stale entries revalidate before 304 (audit problem 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fakeNow = Date.UTC(2026, 9, 15, 12, 0, 0)
    installFakeClock()
    resetChartStateForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    clearChartStateForTest()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each(["webp", "jpeg"])("stale conditional %s with changed rank serves 200 with the new poster", async (format) => {
    const id = format === "webp" ? 920004 : 920005
    const { request, refresh } = await freshnessFixture(id, { format })
    const first = await request()
    expect(first.status).toBe(200)
    // Snapshot expired (slot advance) with a changed live rank.
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: id, rank: 2 } as never])
    crossSlotBoundary()
    mockedRenderRankingBadge.mockClear()
    const conditional = await request(first.headers.get("etag")!)
    // Mai 304 sulla copia scaduta: il contenuto è cambiato.
    expect(conditional.status).toBe(200)
    expect(mockedGetJWRankings).toHaveBeenCalled()
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    expect(conditional.headers.get("etag")).not.toBe(first.headers.get("etag"))
    // E nessun refresh differito al posto della rivalidazione sincrona.
    expect(refresh).not.toHaveBeenCalled()
  })

  it("stale conditional with unchanged content serves 304 only after revalidation", async () => {
    const { request } = await freshnessFixture(920006)
    const first = await request()
    expect(first.status).toBe(200)
    // Snapshot expired (slot advance): the refresh refetches the same live
    // rank and publishes the new slot before the 304 decision.
    crossSlotBoundary()
    mockedGetJWRankings.mockClear()
    mockedRenderRankingBadge.mockClear()
    const conditional = await request(first.headers.get("etag")!)
    expect(conditional.status).toBe(304)
    // La decisione arriva DOPO aver riletto i dati live, non dal fast-path.
    expect(mockedGetJWRankings).toHaveBeenCalled()
  })

  it("fresh conditional match serves 304 without rendering", async () => {
    const { request } = await freshnessFixture(920007)
    const first = await request()
    expect(first.status).toBe(200)
    mockedGetJWRankings.mockClear()
    mockedRenderRankingBadge.mockClear()
    mockedGetDetails.mockClear()
    mockedGetImages.mockClear()
    mockedGetExternalIds.mockClear()
    mockedFetchMDBList.mockClear()
    const conditional = await request(first.headers.get("etag")!)
    expect(conditional.status).toBe(304)
    // Preflight pins the published snapshot in-request: on a current pin the
    // rank resolves with zero upstream fetches (deliberately no extra JW
    // fetch on every poster hit within one slot) — no render and no data
    // fetch either. The rank still rides the cache key, so a newly published
    // generation still bypasses the fresh poster (see the tests above).
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
    // Same family: the anime preflight also resolves from its current pin.
    expect(mockedFetchMDBList).not.toHaveBeenCalled()
    expect(mockedRenderRankingBadge).not.toHaveBeenCalled()
    expect(mockedGetDetails).not.toHaveBeenCalled()
    expect(mockedGetImages).not.toHaveBeenCalled()
    expect(mockedGetExternalIds).not.toHaveBeenCalled()
  })

  it("fresh conditional mismatch serves 200 with the available copy", async () => {
    const { request } = await freshnessFixture(920008)
    const first = await request()
    expect(first.status).toBe(200)
    const other = await request('"non-matching-etag"')
    expect(other.status).toBe(200)
    expect(other.headers.get("etag")).toBe(first.headers.get("etag"))
  })

  it.each(["webp", "jpeg"])("stale unconditional %s with a consumed rank fact revalidates synchronously (no SWR)", async (format) => {
    const id = format === "webp" ? 920009 : 920010
    const { request, refresh } = await freshnessFixture(id, { format })
    const first = await request()
    expect(first.status).toBe(200)
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    const plain = await request()
    expect(plain.status).toBe(200)
    expect(plain.headers.get("etag")).toBe(first.headers.get("etag"))
    // Fact-capped entries never serve stale/SWR: the consumed rank fact owns
    // the lifetime, so a poster-cache expiry revalidates inline (same bytes
    // here) instead of serving the copy + scheduling a refresh.
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("poster freshness: no annual immutable for mutable posters (audit problems 3-4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fakeNow = Date.UTC(2026, 9, 15, 12, 0, 0)
    installFakeClock()
    resetChartStateForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    clearChartStateForTest()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("saved poster with live ranking uses a finite policy on 200 and 304", async () => {
    const { request } = await freshnessFixture(920011)
    const res = await request()
    expect(res.status).toBe(200)
    expect(mockedRenderRankingBadge).toHaveBeenCalled()
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(1)
    for (const response of [res, await request(res.headers.get("etag")!)]) {
      const policy = response.headers.get("cache-control")!
      expect(policy).not.toContain("immutable")
      expect(policy).not.toContain("max-age=31536000")
    }
  })

  it("unversioned request does not inherit immutable from the versioned entry", async () => {
    const { request } = await freshnessFixture(920012, { ranking: false })
    const first = await request()
    expect(first.status).toBe(200)
    const { request: unversionedRequest } = await freshnessFixture(920012, { ranking: false, versioned: false, resetCache: false })
    mockedGetJWRankings.mockClear()
    const unversioned = await unversionedRequest()
    expect(unversioned.status).toBe(200)
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
    expect(unversioned.headers.get("cache-control")).not.toContain("immutable")
    const conditional = await unversionedRequest(first.headers.get("etag")!)
    expect(conditional.headers.get("cache-control")).not.toContain("immutable")
  })

  it("degraded entry keeps the short TTL and no immutable on 200 and 304", async () => {
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: null, status: "timeout", source: "torrentio" })
    const { request } = await freshnessFixture(920013, { ranking: false })
    const first = await request()
    expect(first.status).toBe(200)
    for (const response of [first, await request(first.headers.get("etag")!)]) {
      const policy = response.headers.get("cache-control")!
      expect(policy).toContain("max-age=120")
      expect(policy).not.toContain("immutable")
      expect(policy).not.toContain("max-age=31536000")
    }
    vi.mocked(resolveStreamQuality).mockReset()
  })

  it("reconverted variant preserves the degraded canonical TTL", async () => {
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: null, status: "timeout", source: "torrentio" })
    try {
      const { request } = await freshnessFixture(920019, { ranking: false, format: "jpeg" })
      const writes = vi.spyOn(runtimeCache, "writeCachedPoster")
      const first = await request()
      expect(first.status).toBe(200)
      const variantKey = writes.mock.calls.find(([key]) => key.endsWith(":fmtjpeg"))?.[0]
      expect(variantKey).toBeDefined()
      expect(cacheExpire(variantKey!)).toBeGreaterThan(0)
      const converted = await request(first.headers.get("etag")!)
      expect(converted.status).toBe(304)
      expect(converted.headers.get("cache-control")).toContain("max-age=120")
      expect(runtimeCache.readCachedPoster(variantKey!).ttlSec).toBe(120)
    } finally {
      vi.mocked(resolveStreamQuality).mockReset()
    }
  })
})

describe("poster freshness: representation-specific validators (webp/jpeg/avif)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fakeNow = Date.UTC(2026, 9, 15, 12, 0, 0)
    installFakeClock()
    resetChartStateForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    clearChartStateForTest()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("conditional with the variant ETag gives 304; canonical ETag on a variant URL gives 200", async () => {
    const jpeg = await freshnessFixture(920014, { format: "jpeg" })
    const firstJpeg = await jpeg.request()
    expect(firstJpeg.status).toBe(200)
    const jpegEtag = firstJpeg.headers.get("etag")!
    expect(await jpeg.request(jpegEtag)).toHaveProperty("status", 304)
    // Il validatore canonico (webp) non viene confuso con quello della variante.
    const webp = await freshnessFixture(920014, { format: "webp" })
    const firstWebp = await webp.request()
    expect(firstWebp.status).toBe(200)
    const webpEtag = firstWebp.headers.get("etag")!
    expect(webpEtag).not.toBe(jpegEtag)
    expect(await jpeg.request(webpEtag)).toHaveProperty("status", 200)
  })

  it("explicit avif renders its own bytes with its own validator", async () => {
    const { request } = await freshnessFixture(920015, { format: "avif" })
    const res = await request()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/avif")
    const avifEtag = res.headers.get("etag")!
    const jpeg = await freshnessFixture(920015, { format: "jpeg" })
    const jpegRes = await jpeg.request()
    expect(jpegRes.headers.get("etag")).not.toBe(avifEtag)
    expect(await request(avifEtag)).toHaveProperty("status", 304)
    expect(await request(jpegRes.headers.get("etag")!)).toHaveProperty("status", 200)
  }, 30000)
})

describe("poster freshness: live=1 revalidates on every path", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fakeNow = Date.UTC(2026, 9, 15, 12, 0, 0)
    installFakeClock()
    resetChartStateForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    clearChartStateForTest()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("stale live entry is never served: unconditional revalidates synchronously", async () => {
    const { request, refresh } = await freshnessFixture(920016, { live: true })
    const first = await request()
    expect(first.status).toBe(200)
    // Snapshot expired (slot advance) with a changed live rank: the live path
    // always revalidates against the current facts (no per-hit fetch within
    // the slot, full refresh across it).
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: 920016, rank: 2 } as never])
    crossSlotBoundary()
    mockedRenderRankingBadge.mockClear()
    const second = await request()
    expect(second.status).toBe(200)
    expect(second.headers.get("etag")).not.toBe(first.headers.get("etag"))
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    // Niente SWR deliberato sul percorso live.
    expect(refresh).not.toHaveBeenCalled()
    for (const response of [first, second]) {
      expect(response.headers.get("cache-control")).toBe("public, no-cache, max-age=0, must-revalidate")
    }
  })

  it("fresh live conditional gives 304 with the live policy", async () => {
    const { request } = await freshnessFixture(920017, { live: true })
    const first = await request()
    expect(first.status).toBe(200)
    const conditional = await request(first.headers.get("etag")!)
    expect(conditional.status).toBe(304)
    expect(conditional.headers.get("cache-control")).toBe("public, no-cache, max-age=0, must-revalidate")
    expect(conditional.headers.get("cdn-cache-control")).toBe("public, no-cache, max-age=0, must-revalidate")
  })
})

describe("poster freshness: concurrent conditionals share one render", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    fakeNow = Date.UTC(2026, 9, 15, 12, 0, 0)
    installFakeClock()
    resetChartStateForTest()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    clearChartStateForTest()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it.each([
    { format: "webp", degraded: false },
    { format: "webp", degraded: true },
    { format: "jpeg", degraded: true },
  ])("concurrent $format requests preserve policy (degraded=$degraded)", async ({ format, degraded }) => {
    __resetImageBytesForTest()
    const id = 920018
    cacheClear()
    mockedGetById.mockResolvedValue({
      tmdbId: id, mediaType: "movie", title: "Coalesced", posterPath: "/coal.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      showBadges: degraded, rankingBadges: false, updatedAt: UPDATED_AT,
    })
    vi.mocked(resolveStreamQuality).mockResolvedValue(degraded
      ? { quality: null, status: "timeout", source: "torrentio" }
      : { quality: null, status: "resolved", source: "torrentio" })
    mockedGetDetails.mockResolvedValue({ id, genres: [], vote_average: 5, vote_count: 10 })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: `tt${id}` })
    mockedGetImages.mockResolvedValue({ id, posters: [], logos: [], backdrops: [] })
    const poster = await imageBuffer("#101010", 500, 750)
    let releaseFetch!: (v: Response) => void
    const fetchGate = new Promise<Response>((resolve) => { releaseFetch = resolve })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => fetchGate)
    const url = `http://localhost:3000/api/poster/movie/${id}?mv=${MV}&rv=${RENDER_VERSION}&ranking=0&fmt=${format}`
    const get = () => GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: String(id) }) })
    const pending1 = get()
    // Attende che la prima richiesta arrivi al fetch immagine (render
    // registrato in inflight), poi parte la seconda.
    const deadline = Date.now() + 5000
    while (fetchSpy.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0)
    const pending2 = get()
    await new Promise((r) => setTimeout(r, 10))
    releaseFetch(new Response(new Uint8Array(poster), { headers: { "content-type": "image/png" } }))
    const [res1, res2] = await Promise.all([pending1, pending2])
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res2.headers.get("etag")).toBe(res1.headers.get("etag"))
    if (degraded) {
      expect(res1.headers.get("cache-control")).toContain("max-age=120")
      expect(res2.headers.get("cache-control")).toContain("max-age=120")
    }
    // Un solo fetch immagine: il secondo waiter si è coalesced, non ha
    // duplicato il render.
    expect(fetchSpy.mock.calls.length).toBe(1)
    vi.mocked(resolveStreamQuality).mockReset()
  }, 30000)
})
