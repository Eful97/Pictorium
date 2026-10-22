import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { NextRequest } from "next/server"
import { pictoriumCatalog, CATALOG_TTL_MS, CATALOG_EMPTY_TTL_MS } from "@/lib/catalog-handler"
import { GET as rankGET } from "@/app/api/trending/rank/route"
import * as mdbModule from "@/lib/mdblist"
import * as tmdbModule from "@/lib/tmdb"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __clearTMDBCache } from "@/lib/tmdb"
import {
  CHART_LIVE_PIN_ID,
  CHART_READY_TTL_MS,
  pinChartFamily,
  pinnedFamilyRows,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
  __inMemoryChartGenerationPersist,
} from "@/lib/chart-generation"

vi.mock("@/lib/user-auth", () => ({
  getScopedUserId: vi.fn().mockReturnValue(null),
  userExists: vi.fn().mockResolvedValue(false),
  userRateLimitKey: vi.fn().mockReturnValue("rl-test"),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
  rateLimitKey: vi.fn().mockReturnValue("rate-key"),
  rateLimitResponse: vi.fn(),
}))

const cacheStore = new Map<string, unknown>()
const cacheSets: Array<{ key: string; ttl: number | undefined }> = []
const cacheGets: string[] = []
vi.mock("@/lib/cache", () => ({
  cacheGet: vi.fn((k: string) => {
    cacheGets.push(k)
    return (cacheStore.get(k) as unknown) ?? null
  }),
  cacheSet: vi.fn((k: string, v: unknown, _t: unknown, ttl?: number) => {
    cacheSets.push({ key: k, ttl })
    cacheStore.set(k, v)
  }),
  cacheGetShared: vi.fn(async (k: string) => {
    cacheGets.push(k)
    return (cacheStore.get(k) as unknown) ?? null
  }),
  cacheClear: vi.fn(() => {
    cacheStore.clear()
  }),
  hashUserFragment: vi.fn((u: string) => u.slice(0, 8)),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(async () => null),
  getAll: vi.fn(async () => []),
}))

vi.mock("@/lib/imdb-cache", () => ({
  resolveImdbId: vi.fn(async () => null),
}))

function utc(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

// Phase-driven upstream: phases advance explicitly per test.
let jwPhase: "one" | "two" | "fail" = "one"
let jwCalls = 0

function chartEdges(ids: number[]) {
  return ids.map((tmdbId, i) => ({
    streamingChartInfo: { rank: i + 1 },
    node: {
      content: {
        title: `Chart ${tmdbId}`,
        originalReleaseDate: "2026-01-01",
        // Realistic 7-digit IMDb ids: the fail-closed catalogMetaId regex
        // (`tt` + 7-10 digits) would reject short `tt101`-style placeholders.
        externalIds: { tmdbId, imdbId: `tt${1000000 + tmdbId}` },
      },
    },
  }))
}

function jwChartResponse(ids: number[]): Response {
  // Combined shape: getJWRankings reads streamingCharts, getJWTitles reads
  // popularTitles — one mock serves both canonical coordinates.
  const edges = chartEdges(ids)
  return Response.json({ data: { streamingCharts: { edges }, popularTitles: { edges } } })
}

function tmdbDetailsResponse(tmdbId: number): Response {
  return Response.json({
    id: tmdbId,
    title: `Title ${tmdbId}`,
    overview: "Desc",
    genres: [],
    backdrop_path: null,
    vote_average: 7.5,
    external_ids: { imdb_id: null },
  })
}

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, _init) => {
    const urlStr = String(url)
    if (urlStr.includes("justwatch") || urlStr.includes("graphql")) {
      jwCalls++
      if (jwPhase === "fail") throw new Error("JW down")
      return jwChartResponse(jwPhase === "one" ? [101, 102] : [201, 202])
    }
    const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
    if (m) return tmdbDetailsResponse(Number(m[2]))
    if (urlStr.includes("/images")) return Response.json({ logos: [] })
    if (urlStr.includes("/genre/")) return Response.json({ genres: [] })
    return Response.json({})
  })
}

function mockTmdbKeys() {
  vi.spyOn(tmdbModule, "resolveUserApiKeys").mockImplementation(async (req: { url?: string }) => {
    const sp = new URL(req.url ?? "http://localhost/").searchParams
    return {
      tmdb: { key: "mock-tmdb-key", source: "env" },
      mdblist: { key: sp.get("mdblist_key") ?? undefined, source: "query" },
      tvdb: { key: undefined, source: "env" },
      simkl: { key: undefined, source: "env" },
      fanart: { key: undefined, source: "env" },
    } as unknown as Awaited<ReturnType<typeof tmdbModule.resolveUserApiKeys>>
  })
}

const JW_MOVIE = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:charts" }
const PLATFORM_NETFLIX = { ...JW_MOVIE, family: "platform:netflix:movie" }
const ANIME_MOVIE = { ...GROUP_ANIME(), family: "anime:movie" }
function GROUP_ANIME() {
  return { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null }
}

function catalogReq(id: string, query = "api_key=test-key"): NextRequest {
  return new NextRequest(`https://example.com/catalog/movie/${id}.json?${query}`)
}

function readyTtl(keyPrefix: string): number | undefined {
  const found = [...cacheSets].reverse().find((s) => s.key.startsWith(keyPrefix))
  return found?.ttl
}

describe("chart-generation serving integration (entry paths only)", () => {
  let now: number

  beforeEach(() => {
    vi.restoreAllMocks()
    cacheStore.clear()
    cacheSets.length = 0
    cacheGets.length = 0
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    __resetJWRankingsCache()
    __clearTMDBCache()
    mockTmdbKeys()
    jwPhase = "one"
    jwCalls = 0
    installFetchMock()
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> slot 20261022-00
    vi.spyOn(Date, "now").mockImplementation(() => now)
    vi.spyOn(mdbModule, "fetchMDBList").mockImplementation(async () => [
      { imdb: "tt901", title: "Anime 901", year: 2024, tmdb: 901 },
      { imdb: "tt902", title: "Anime 902", year: 2024, tmdb: 902 },
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
  })

  it("cold catalog request fetches once and publishes immediately; repeat is upstream-free", async () => {
    const res1 = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(res1.status).toBe(200)
    const body1 = await res1.json()
    expect(body1.metas).toHaveLength(2)
    expect(jwCalls).toBe(1)
    // Cold success is immediately published: same-slot pin, fenced ready key.
    const pin = await pinChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-00")
    expect(cacheGets.some((k) => k.includes(":cg20261022-00"))).toBe(true)
    // In-scope nonempty ready body reuses up to 12h.
    const ttl = readyTtl("stremio:catalog:v4:movie:pictorium-jw-movies")
    expect(ttl).toBe(CHART_READY_TTL_MS)
    // Repeat request: ready-body hit, zero upstream calls.
    const res2 = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect((await res2.json()).metas).toHaveLength(2)
    expect(jwCalls).toBe(1)
  })

  it("boundary crossing refreshes THAT family only, with a real upstream refetch", async () => {
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(jwCalls).toBe(1)
    // Sibling families are untouched by the JW request.
    expect((await pinChartFamily(PLATFORM_NETFLIX)).id).toBe(CHART_LIVE_PIN_ID)
    expect((await pinChartFamily(ANIME_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
    // Cross the 12:00 Rome boundary (3h later: inside the 6h rolling JW TTL,
    // but past the slot — the floor must force a REAL refetch, not relabel).
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> slot 20261022-12
    jwPhase = "two"
    const res = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(jwCalls).toBe(2)
    const body = await res.json()
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt1000201", "tt1000202"])
    const pin = await pinChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-12")
    // Old ready-body keys are unreachable: the fence rotated.
    expect(cacheGets.some((k) => k.includes(":cg20261022-12"))).toBe(true)
    // Still no unrelated fetching: anime/platform families stay live.
    expect((await pinChartFamily(PLATFORM_NETFLIX)).id).toBe(CHART_LIVE_PIN_ID)
    expect((await pinChartFamily(ANIME_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
    expect(mdbModule.fetchMDBList).not.toHaveBeenCalled()
  })

  it("same-slot snapshot is served even after the underlying rolling cache expires", async () => {
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(jwCalls).toBe(1)
    // Expire the rolling 6h JW cache AND drop the ready body: the re-render
    // still serves the pinned same-slot snapshot with zero upstream refetch.
    __resetJWRankingsCache()
    cacheStore.clear()
    const res = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect((await res.json()).metas).toHaveLength(2)
    expect(jwCalls).toBe(1)
  })

  it("catalog and rank route read the SAME rows after a cycle", async () => {
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(jwCalls).toBe(1)
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    jwPhase = "two"
    const catRes = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    const catIds = (await catRes.json()).metas.map((m: { id: string }) => m.id)
    expect(catIds).toEqual(["tt1000201", "tt1000202"])
    expect(jwCalls).toBe(2)
    // Rank route for the new top title (canonical first=20 window): same
    // published snapshot, same rank.
    const rankRes = await rankGET(new NextRequest("https://example.com/api/trending/rank?type=movie&id=201&first=20"))
    const rankBody = await rankRes.json()
    expect(rankBody.rank).toBe(1)
    // The retired title has no rank (never a resurrected stale rank).
    const staleRes = await rankGET(new NextRequest("https://example.com/api/trending/rank?type=movie&id=101&first=20"))
    expect((await staleRes.json()).rank).toBeNull()
    // No extra upstream fetch for the rank reads (pin served both).
    expect(jwCalls).toBe(2)
  })

  it("upstream failure retains previous catalog rows with a 60s gate", async () => {
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(jwCalls).toBe(1)
    now = utc(2026, 10, 22, 11, 0, 0)
    jwPhase = "fail"
    const res = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(jwCalls).toBe(2) // the failed refresh attempt
    const body = await res.json()
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt1000101", "tt1000102"])
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-00")
    // Immediate retry: gated, no upstream call, old rows kept.
    const res2 = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect((await res2.json()).metas.map((m: { id: string }) => m.id)).toEqual(["tt1000101", "tt1000102"])
  })

  it("MDB failure does not block JW/platform renewal", async () => {
    vi.mocked(mdbModule.fetchMDBList).mockRejectedValue(new Error("mdblist down"))
    now = utc(2026, 10, 22, 8, 0, 0)
    // Anime family fails cold -> live, but JW publishes fine in the same slot.
    const animeRes = await pictoriumCatalog(catalogReq("pictorium-anime-movies"), "movie", "pictorium-anime-movies", null, null)
    expect((await animeRes.json()).metas).toEqual([])
    expect((await pinChartFamily(ANIME_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
    const jwRes = await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect((await jwRes.json()).metas).toHaveLength(2)
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-00")
  })

  it("isolates keyed vs public anime snapshots", async () => {
    const keyedFetch = vi.mocked(mdbModule.fetchMDBList)
    await pictoriumCatalog(catalogReq("pictorium-anime-movies", "api_key=test-key&mdblist_key=k1"), "movie", "pictorium-anime-movies", null, null)
    expect(keyedFetch).toHaveBeenCalled()
    const keyedPin = await pinChartFamily({ ...GROUP_ANIME(), mdblistKey: "k1", family: "anime:movie" })
    expect(keyedPin.id).toBe("20261022-00")
    const pubPin = await pinChartFamily(ANIME_MOVIE)
    expect(pubPin.id).toBe(CHART_LIVE_PIN_ID)
    // Public request publishes its own snapshot without touching the keyed one.
    await pictoriumCatalog(catalogReq("pictorium-anime-movies", "api_key=test-key"), "movie", "pictorium-anime-movies", null, null)
    expect((await pinChartFamily(ANIME_MOVIE)).id).toBe("20261022-00")
    expect(pinnedFamilyRows(await pinChartFamily({ ...GROUP_ANIME(), mdblistKey: "k1", family: "anime:movie" }))?.length).toBe(2)
  })

  it("uses historical TTLs for excluded windows (variant 1h, empty 60s)", async () => {
    // Canonical default window: 12h.
    await pictoriumCatalog(catalogReq("pictorium-jw-movies"), "movie", "pictorium-jw-movies", null, null)
    expect(readyTtl("stremio:catalog:v4:movie:pictorium-jw-movies")).toBe(CHART_READY_TTL_MS)
    // Excluded variant window (platform genre drill-down, live content):
    // unchanged 1h.
    await pictoriumCatalog(catalogReq("pictorium-netflix-movies", "api_key=test-key&genre=Azione"), "movie", "pictorium-netflix-movies", null, null)
    const variantKey = cacheSets.map((s) => s.key).find((k) => k.includes("pictorium-netflix-movies") && k.includes(":g"))
    expect(variantKey).toBeTruthy()
    expect([...cacheSets].reverse().find((s) => s.key === variantKey)?.ttl).toBe(CATALOG_TTL_MS)
    // Empty canonical slice (past the Top 20): unchanged 60s.
    await pictoriumCatalog(catalogReq("pictorium-jw-movies", "api_key=test-key&skip=25"), "movie", "pictorium-jw-movies", null, null)
    const emptyKey = cacheSets.map((s) => s.key).find((k) => k.includes("pictorium-jw-movies") && k.includes(":s25"))
    expect(emptyKey).toBeTruthy()
    const emptyTtl = [...cacheSets].reverse().find((s) => s.key === emptyKey)?.ttl
    expect(emptyTtl).toBe(CATALOG_EMPTY_TTL_MS)
  })

  it("platform default window serves pinned rows fenced by generation", async () => {
    const res = await pictoriumCatalog(catalogReq("pictorium-netflix-movies"), "movie", "pictorium-netflix-movies", null, null)
    const body = await res.json()
    expect(body.metas).toHaveLength(2)
    expect((await pinChartFamily(PLATFORM_NETFLIX)).id).toBe("20261022-00")
    expect(pinnedFamilyRows(await pinChartFamily(PLATFORM_NETFLIX))?.map((r) => r.tmdbId)).toEqual([101, 102])
    // JW charts family untouched by the platform request.
    expect((await pinChartFamily(JW_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
    expect(readyTtl("stremio:catalog:v4:movie:pictorium-netflix-movies")).toBe(CHART_READY_TTL_MS)
  })
})
