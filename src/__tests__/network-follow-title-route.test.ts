/**
 * Debug server della geometria network realmente composta (`debug=1`):
 * unica fonte per il freeze senza salto (il client non duplica il layout).
 * Solo numeri/config risolta, nessun dato sensibile; risposte normali invariate.
 */
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})
vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))
vi.mock("@/lib/svg-badge", async () => {
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#ffffff" } }).png().toBuffer()
  const png = () => ({ png: tiny, w: 8, h: 8 })
  return {
    renderGenreBadge: vi.fn(async () => png()),
    renderRankingBadge: vi.fn(async () => png()),
    renderExtraBadge: vi.fn(async () => png()),
    renderQualityBadge: vi.fn(async () => png()),
  }
})
vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
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
}))
vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})
vi.mock("@/lib/imdb-resolver", () => ({ resolveImdbToTmdb: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-cache", () => ({ resolveWikidataId: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-top250", () => ({ isImdbTop250: vi.fn(async () => false) }))
vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn((req: { nextUrl?: { searchParams: URLSearchParams } }) => req.nextUrl?.searchParams.get("api_key") || undefined),
  resolveUserApiKeys: vi.fn(async () => {
    const none = { key: undefined, source: "none" } as const
    return { tmdb: none, mdblist: none, tvdb: none }
  }),
}))

const mockedGetById = vi.mocked(getById)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()
}

function armUpstream() {
  mockedGetById.mockResolvedValue(null)
  const details = {
    id: 44, title: "Network Debug", genres: [], vote_average: 0, vote_count: 0,
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

const debugBase = "http://localhost:3000/api/poster/movie/44?poster=%2Fp.jpg&logo=%2Flogo.png&preview=1&api_key=test"

async function getDebug(extra: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new NextRequest(`${debugBase}${extra}&debug=1`), {
    params: Promise.resolve({ type: "movie", id: "44" }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function getDebugGeo(extra: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new NextRequest(`${debugBase}${extra}&debug=1&netgeo=1`), {
    params: Promise.resolve({ type: "movie", id: "44" }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

describe("GET /api/poster debug network geometry", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
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
    cacheClear()
    vi.unstubAllGlobals()
  })

  it("reports the actually rendered network geometry (follow historic)", async () => {
    const { status, body } = await getDebugGeo("")
    expect(status).toBe(200)
    const network = body.network as Record<string, unknown> | null
    expect(network).not.toBeNull()
    expect(network?.followTitle).toBe(true)
    for (const k of ["top", "left", "w", "h"]) {
      expect(typeof network?.[k]).toBe("number")
      expect(Number.isFinite(network?.[k] as number)).toBe(true)
    }
    expect((network?.w as number)).toBeGreaterThan(0)
    const logos = body.logos as Record<string, unknown>
    expect(logos.networkLogoFollowTitle).toBe(true)
    // Legacy shape: no netFollow key anywhere in normal debug output.
    expect("netFollow" in body).toBe(false)
  })

  it("freezing the reported actuals renders the identical geometry", async () => {
    const first = await getDebugGeo("")
    expect(first.status).toBe(200)
    const net = first.body.network as { top: number; left: number; w: number; h: number }
    const second = await getDebugGeo(`&netFollow=0&nox=${net.left}&noy=${net.top}`)
    expect(second.status).toBe(200)
    expect(second.body.network).toEqual({ ...net, followTitle: false })
  })

  it("plain debug stays render-free and carries no network key", async () => {
    const { status, body } = await getDebug("")
    expect(status).toBe(200)
    expect("network" in body).toBe(false)
    // ...but still reports the resolved follow config.
    expect((body.logos as Record<string, unknown>).networkLogoFollowTitle).toBe(true)
  })

  it("landscape with portrait-fixed mapping renders historic geometry (no leak)", async () => {
    const base = {
      tmdbId: 44, mediaType: "movie", title: "Mapped", posterPath: "/p.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    const plain: Record<string, unknown> = { ...base }
    const fixedFlat: Record<string, unknown> = {
      ...base, networkLogoFollowTitle: false, networkLogoOffsetX: 200, networkLogoOffsetY: 500,
    }
    const urlFor = (mapping: unknown) => {
      mockedGetById.mockResolvedValue(mapping as never)
      mockedGetImages.mockResolvedValue({
        id: 44, posters: [], logos: [],
        backdrops: [{ file_path: "/bg.jpg", width: 1280, height: 720, vote_average: 0, vote_count: 0, aspect_ratio: 1.78 }],
      } as never)
      return GET(new NextRequest(
        "http://localhost:3000/api/poster/movie/44?shape=landscape&debug=1&netgeo=1&api_key=test",
      ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    }
    const resPlain = await urlFor(plain)
    expect(resPlain.status).toBe(200)
    const netPlain = ((await resPlain.json()) as Record<string, unknown>).network as Record<string, unknown>
    const resFixed = await urlFor(fixedFlat)
    expect(resFixed.status).toBe(200)
    const netFixed = ((await resFixed.json()) as Record<string, unknown>).network as Record<string, unknown>
    // Stessa geometria storica: niente +200/+500 dal flat portrait.
    expect(netFixed).toEqual(netPlain)
    expect(netFixed.followTitle).toBe(true)
  })

  it("normal (non-debug) responses are unchanged by the collector", async () => {
    const res = await GET(new NextRequest(debugBase), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("image/")
  })
})
