/**
 * Admission gates for the shared poster route (audit A1/F4/F3-poster):
 * - `?netgeo=1` forces a full render (all fast paths skipped): it must be
 *   owner-only (effective preview or unlocked session), never an anonymous
 *   cache bypass.
 * - `preview=1` with a bare `?u=` (manifest capability UUID) stays hardened
 *   unless the session is actually unlocked (PIN/admin).
 * - the anime MDBList key must come from the guard-aware resolver, so a
 *   scoped request never burns the operator's MDBLIST_KEY env.
 */
import sharp from "sharp"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { resolveStreamQuality } from "@/lib/stream-quality"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAllWikidata } from "@/lib/awards"
import { fetchAggregatedRating } from "@/lib/ratings"
import { createUser } from "@/lib/user-auth"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  fetchCustomRatings: vi.fn(async () => []),
}))
vi.mock("@/lib/multi-rating-renderer", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/multi-rating-renderer")>(),
  renderMultiRatings: vi.fn(async () => null),
}))
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
vi.mock("@/lib/svg-badge", async () => {
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#ffffff" } }).png().toBuffer()
  const png = () => ({ png: tiny, w: 8, h: 8 })
  const renderSVG = async (_svg: string, w: number) => {
    const width = Math.max(1, Math.round(w || 1))
    return sharp({ create: { width, height: width, channels: 4, background: "#ffffff" } }).png().toBuffer()
  }
  return {
    renderSVG,
    renderGenreBadge: vi.fn(async () => png()),
    renderRankingBadge: vi.fn(async () => png()),
    renderExtraBadge: vi.fn(async () => png()),
    renderQualityBadge: vi.fn(async () => png()),
    buildTextLogoBuffer: vi.fn(async () => tiny),
  }
})
vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  jwRankingsRemainingMs: vi.fn(() => null),
  jwTitlesRemainingMs: vi.fn(() => null),
  jwAvailabilityRemainingMs: vi.fn(() => null),
  JW_DIGITAL_MONETIZATION_TYPES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
  hasJWOffers: vi.fn(async () => false),
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
  mdblistRemainingMs: vi.fn(() => null),
}))
vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})
vi.mock("@/lib/imdb-resolver", () => ({ resolveImdbToTmdb: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-cache", () => ({ resolveWikidataId: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-top250", () => ({
  isImdbTop250: vi.fn(async () => false),
  isImdbTop100: vi.fn(async () => false),
}))
// Keep the REAL resolveUserApiKeys (it owns the multi-user env-fallback guard).
vi.mock("@/lib/tmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tmdb")>()
  return {
    ...actual,
    getDetails: vi.fn(),
    getDetailsWithExternalIds: vi.fn(),
    getImages: vi.fn(),
    getExternalIds: vi.fn(async () => ({ imdb_id: null })),
    getKeywords: vi.fn(async () => []),
  }
})

const mockedGetById = vi.mocked(getById)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedFetchMDBList = vi.mocked(fetchMDBList)

const TEST_ADMIN_TOKEN = "poster-admission-admin-token"

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()
}

function armUpstream() {
  mockedGetById.mockResolvedValue(null)
  const details = {
    id: 44, title: "Admission Debug", genres: [], vote_average: 0, vote_count: 0,
    original_language: "en", release_date: null, first_air_date: null,
    last_air_date: null, number_of_seasons: null, number_of_episodes: null,
    type: undefined, status: undefined,
    networks: [{ name: "Netflix", logo_path: "/netflix.png" }],
    production_companies: [],
  }
  mockedGetDetails.mockResolvedValue({ ...details } as never)
  mockedGetDetailsWithExternalIds.mockResolvedValue({ ...details, external_ids: { imdb_id: null } } as never)
  mockedGetImages.mockResolvedValue({
    id: 44,
    posters: [{ file_path: "/p.jpg", iso_639_1: null, width: 500, height: 750, vote_average: 0, vote_count: 0, aspect_ratio: 0.667 }],
    logos: [{ file_path: "/logo.png", iso_639_1: "en", width: 220, height: 80, vote_average: 0, vote_count: 0, aspect_ratio: 2.75 }],
    backdrops: [],
  })
  mockedGetExternalIds.mockResolvedValue({ imdb_id: null })
  mockedGetJWRankings.mockResolvedValue([])
  vi.mocked(fetchMDBList).mockResolvedValue([])
  vi.mocked(fetchAggregatedRating).mockResolvedValue(null)
  vi.mocked(resolveStreamQuality).mockResolvedValue(null as never)
  vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null })
}

const baseUrl = "http://pictorium.test/api/poster/movie/44?poster=%2Fp.jpg&logo=%2Flogo.png&api_key=test"
const adminReq = (url: string) => new NextRequest(url, { headers: { "x-admin-token": TEST_ADMIN_TOKEN } })

beforeAll(() => {
  process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
})

describe("GET /api/poster admission gates", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
    __resetChartGenerationForTest()
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    armUpstream()
    const posterBuf = await imageBuffer("#101010", 500, 750)
    const logoBuf = await imageBuffer("#ffffff", 220, 80)
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input)
      const body = url.includes("/logo.png") ? logoBuf : posterBuf
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(body.length) },
      })
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete process.env.PICTORIUM_MULTI_USER
    delete process.env.MULTI_USER
    delete process.env.MDBLIST_KEY
    delete process.env.PICTORIUM_MDBLIST_KEY
    cacheClear()
  })

  it("A1: anonymous ?netgeo=1 does not force a full render (plain debug only)", async () => {
    const res = await GET(new NextRequest(`${baseUrl}&debug=1&netgeo=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    const body = (await res.json()) as Record<string, unknown>
    // Gate ignored netgeo: the render-free debug response, no composed geometry.
    expect("network" in body).toBe(false)
    expect("badges" in body).toBe(false)
  })

  it("A1: an unlocked owner keeps the diagnostics", async () => {
    const res = await GET(adminReq(`${baseUrl}&debug=1&netgeo=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.network).not.toBeNull()
    expect(body.badges).not.toBeNull()
  })

  it("F4: bare ?u= + preview=1 stays downgraded without a session", async () => {
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    const { uuid } = await createUser()
    const res = await GET(new NextRequest(`${baseUrl}&u=${uuid}&preview=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("image/")
    // Preview responses are no-store; a downgraded one is the canonical render.
    expect(res.headers.get("cache-control") ?? "").not.toContain("no-store")
  })

  it("F4: an unlocked session keeps the live preview", async () => {
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    const { uuid } = await createUser()
    const res = await GET(adminReq(`${baseUrl}&u=${uuid}&preview=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control") ?? "").toContain("no-store")
  })

  it("F4: a VERIFIED user-space credential keeps the live preview + geometry (Settings editor)", async () => {
    // The multi-user Settings editor is unlocked by the space credential
    // (secret/password), not by the instance PIN: without recognizing it the
    // owner's preview was downgraded (no demo samples, no badge geometry),
    // which broke "preview shows every enabled badge" and the drag handles.
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    const { uuid, secret } = await createUser()
    const req = new NextRequest(
      `${baseUrl}&u=${uuid}&preview=1&demosamples=1&ranking=1&sash=rank&debug=1&netgeo=1`,
      { headers: { "x-user-token": secret } },
    )
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      badges?: { kind?: string | null; layout?: string; families?: Record<string, unknown> } | null
    }
    // Owner-only diagnostics: the drag overlay reads exactly these boxes.
    expect(body.badges).not.toBeNull()
    // Demo sample fills the rank slot of an unranked demo title, so an
    // enabled rank is visible in the Settings preview (the top slot is a rank
    // and the whole layout is "ranked", never the without-ranking fallback).
    expect(body.badges?.kind).toBe("rank")
    expect(body.badges?.layout).toBe("ranked")
    expect(Object.keys(body.badges?.families ?? {}).length).toBeGreaterThan(0)
  })

  it("F4: a WRONG user-space credential still stays downgraded", async () => {
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    const { uuid } = await createUser()
    const req = new NextRequest(
      `${baseUrl}&u=${uuid}&preview=1&debug=1&netgeo=1`,
      { headers: { "x-user-token": "not-the-secret" } },
    )
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control") ?? "").not.toContain("no-store")
    const body = (await res.json()) as Record<string, unknown>
    expect("badges" in body).toBe(false)
  })

  it("F3: scoped ?u= never uses the operator MDBLIST_KEY for the anime rankings", async () => {
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    vi.stubEnv("PICTORIUM_MDBLIST_KEY", "operator-mdblist-secret")
    const { uuid } = await createUser()
    mockedFetchMDBList.mockClear()
    const res = await GET(new NextRequest(`${baseUrl}&u=${uuid}&ranking=1&debug=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const animeCall = mockedFetchMDBList.mock.calls.find(([listKey]) => listKey === "mdblistAnimeMovie")
    expect(animeCall).toBeTruthy()
    expect(animeCall?.[1]).toBeUndefined()
    await res.body?.cancel().catch(() => {})

    // Global (unscoped) requests keep the historical env fallback.
    mockedFetchMDBList.mockClear()
    const global = await GET(new NextRequest(`${baseUrl}&ranking=1&debug=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(global.status).toBe(200)
    const globalAnime = mockedFetchMDBList.mock.calls.find(([listKey]) => listKey === "mdblistAnimeMovie")
    expect(globalAnime).toBeTruthy()
    expect(globalAnime?.[1]).toBe("operator-mdblist-secret")
  })
})
