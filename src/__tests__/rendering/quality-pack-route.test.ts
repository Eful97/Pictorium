/**
 * NON-EMPTY quality pack through the REAL poster endpoint (wire -> validation
 * -> hardening -> selection -> renderer -> pixels).
 *
 * Why this file exists: the pack is empty by default, so the existing pack
 * suites mock the manifest at the registry/renderer level only. That misses the
 * ROUTE boundary, where the wire value is validated (`posterQuerySchema`),
 * canonicalized, gated by the selection and finally painted. Two reviewed
 * behaviours live exactly there:
 *
 * 1. A legitimate FULL selection must never turn into a 400. The retired bound
 *    was 256 chars while a legal MAX_QUALITY_MARKS selection of longest-id
 *    (32 chars) marks is 8 * 32 + 7 = 263 - the route now accepts it.
 * 2. `tintable` and `opaque` pack marks must both reach the renderer from the
 *    wire, each with its own per-item identity (`quality:format:<id>`).
 */
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Synthetic manifest: one tintable mark (real vendored asset + measured ink
 * box) and a set of opaque marks. Eight 32-char opaque ids build the longest
 * legal wire selection; they share the vendored opaque fixture because the
 * opaque path only needs `aspect` per id (no ink-box lookup by icon).
 */
const LONG_OPAQUE_IDS = Array.from({ length: 8 }, (_, index) => `opaque${index}${"x".repeat(25)}`)
LONG_OPAQUE_IDS.forEach((id) => expect(id).toHaveLength(32))

vi.mock("@/data/quality-badge-pack.json", () => ({
  default: {
    version: "test",
    marks: [
      {
        id: "remux",
        label: "REMUX",
        icon: "quality-badges/pack/remux.svg",
        mode: "tintable",
        inkBox: { x: 25.9, y: 14.9, w: 149.5, h: 29.5 },
        accent: "gold",
        gradientStops: ["#FF2D2D", "#FFB800"],
      },
      {
        id: "stamp",
        label: "STAMP",
        icon: "quality-badges/pack/opaque-fixture.png",
        mode: "opaque",
        aspect: 2.5,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `opaque${index}${"x".repeat(25)}`,
        label: `OPAQUE ${index}`,
        icon: "quality-badges/pack/opaque-fixture.png",
        mode: "opaque",
        aspect: 2.5,
      })),
    ],
  },
}))

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
import { MAX_QUALITY_MARKS } from "@/lib/quality-badge-pack"

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
vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
  jwRankingsRemainingMs: vi.fn(() => null),
  jwTitlesRemainingMs: vi.fn(() => null),
  jwAvailabilityRemainingMs: vi.fn(() => null),
  JW_DIGITAL_MONETIZATION_TYPES: ["FLATRATE", "FREE", "BUY", "RENT", "ADS"],
}))
vi.mock("@/lib/stream-quality", () => ({ resolveStreamQuality: vi.fn(async () => null) }))
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
vi.mock("@/lib/network-svgs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/network-svgs")>()
  return {
    ...actual,
    renderFirstMatchingNetworkLogoBadgeHybrid: vi.fn(async () => null),
    renderFirstMatchingNetworkRawBadgeHybrid: vi.fn(async () => null),
  }
})
vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: (req: { nextUrl?: { searchParams: URLSearchParams } }) => req.nextUrl?.searchParams.get("api_key") || undefined,
  resolveUserApiKeys: vi.fn(async (req: { nextUrl?: { searchParams: URLSearchParams } }) => {
    const q = req.nextUrl?.searchParams.get("api_key") || undefined
    const none = { key: undefined, source: "none" } as const
    return { tmdb: q ? { key: q, source: "query" } : none, mdblist: none, tvdb: none }
  }),
}))

const EMPTY_DETAILS = {
  id: 44, title: "No Data Title", name: undefined, genres: [], vote_average: 0, vote_count: 0,
  original_language: "en", release_date: null, first_air_date: null, last_air_date: null,
  number_of_seasons: null, number_of_episodes: null, type: undefined, status: undefined,
  networks: [], production_companies: [],
}

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: color } }).png().toBuffer()
}

function armUpstream() {
  vi.mocked(getById).mockResolvedValue(null)
  vi.mocked(getDetails).mockResolvedValue({ ...EMPTY_DETAILS } as never)
  vi.mocked(getDetailsWithExternalIds).mockResolvedValue({ ...EMPTY_DETAILS, external_ids: { imdb_id: null } } as never)
  vi.mocked(getImages).mockResolvedValue({ id: 44, posters: [], logos: [], backdrops: [] } as never)
  vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null } as never)
  vi.mocked(getJWRankings).mockResolvedValue([] as never)
  vi.mocked(fetchMDBList).mockResolvedValue([])
  vi.mocked(fetchAggregatedRating).mockResolvedValue(null)
  vi.mocked(resolveStreamQuality).mockResolvedValue(null as never)
  vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null })
}

const TEST_ADMIN_TOKEN = "route-tests-admin-token"
process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
const adminReq = (url: string, init?: { headers?: Record<string, string> }) =>
  new NextRequest(url, { ...init, headers: { ...(init?.headers ?? {}), "x-admin-token": TEST_ADMIN_TOKEN } })

/** The 4K demo tier gives the quality group a tier to compose (as the editor preview). */
const formatsUrl = (formats: string) =>
  `http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&sep=0&badges=1&ranking=1&bq=1&formats=${formats}&preview=1&demosamples=1&api_key=test`

type QualityGeo = { items: { id: string }[] }

async function fetchGeo(formats: string): Promise<QualityGeo> {
  const res = await GET(adminReq(`${formatsUrl(formats)}&debug=1&netgeo=1`), {
    params: Promise.resolve({ type: "movie", id: "44" }),
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { badges: QualityGeo }).badges
}

async function fetchImage(formats: string): Promise<Buffer> {
  const res = await GET(adminReq(formatsUrl(formats)), { params: Promise.resolve({ type: "movie", id: "44" }) })
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer())
}

function formatIds(geo: QualityGeo): string[] {
  return geo.items.map((item) => item.id).filter((id) => id.startsWith("quality:format:"))
}

beforeEach(async () => {
  vi.restoreAllMocks()
  cacheClear()
  __resetTMDBSessionCache()
  __resetImageBytesForTest()
  vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
  vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  armUpstream()
  const posterBuf = await imageBuffer("#101010", 500, 750)
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBuf), {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
  }))
})

afterEach(() => {
  cacheClear()
  __resetTMDBSessionCache()
  vi.unstubAllEnvs()
})

describe("GET /api/poster with a NON-EMPTY quality pack", () => {
  it("paints tintable and opaque pack marks from the wire, each with its own identity", async () => {
    const both = await fetchGeo("remux,stamp")
    expect(formatIds(both)).toEqual(["quality:format:remux", "quality:format:stamp"])

    const tintableOnly = await fetchGeo("remux")
    const opaqueOnly = await fetchGeo("stamp")
    expect(formatIds(tintableOnly)).toEqual(["quality:format:remux"])
    expect(formatIds(opaqueOnly)).toEqual(["quality:format:stamp"])

    // The served pixels really change with the selection: both marks are
    // rendered, not merely parsed.
    const bothPng = await fetchImage("remux,stamp")
    const tintablePng = await fetchImage("remux")
    const opaquePng = await fetchImage("stamp")
    expect(bothPng.equals(tintablePng)).toBe(false)
    expect(bothPng.equals(opaquePng)).toBe(false)
    expect(tintablePng.equals(opaquePng)).toBe(false)
  }, 60000)

  it("accepts a full MAX_QUALITY_MARKS selection whose wire value exceeds the retired 256-char bound", async () => {
    // 8 ids x 32 chars + 7 commas = 263 chars: legal by the schema, but a
    // 256-char bound rejected it (the reviewed bug) before any render.
    const fullSelection = LONG_OPAQUE_IDS.join(",")
    expect(fullSelection).toHaveLength(MAX_QUALITY_MARKS * 32 + (MAX_QUALITY_MARKS - 1))
    expect(fullSelection.length).toBeGreaterThan(256)
    expect(fullSelection.length).toBeLessThanOrEqual(MAX_QUALITY_MARKS * 33)

    const geo = await fetchGeo(fullSelection)
    expect(formatIds(geo)).toEqual(LONG_OPAQUE_IDS.map((id) => `quality:format:${id}`))
    const png = await fetchImage(fullSelection)
    expect(png.length).toBeGreaterThan(0)

    // Negative control: only values BEYOND the bound are rejected (400 before
    // any render), so the acceptance above is the bound, not a no-op schema.
    const overBound = `${fullSelection},a`
    expect(overBound).toHaveLength(MAX_QUALITY_MARKS * 33 + 1)
    const rejected = await GET(adminReq(formatsUrl(overBound)), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(rejected.status).toBe(400)
  }, 120000)
})
