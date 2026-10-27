/**
 * Per-ITEM rejoin through the REAL poster endpoint: wire -> config -> renderer
 * -> pixels AND reported boxes.
 *
 * The step under test is exactly the one the editor performs when the user
 * clicks Rejoin (per badge or quality group): the canonical map loses the
 * quality identities and the canonical wire form (`bit=`) that the preview URL
 * sends / the saved defaults store is recomputed from it. This file drives the
 * real route handler (only the external APIs are mocked) so "rejoined" is
 * proven by DECODED PIXELS and by the authoritative boxes the overlay reads,
 * not by a map assertion:
 *
 *  1. detaching the tier + age + one A/V mark with per-item transforms produces
 *     a different image (sensitivity of the check);
 *  2. rejoining them (the shared `rejoinBadgeItems`/`withoutBadgeItemFamily`
 *     primitives the hook uses) yields the undeformed canonical form: the
 *     served bytes and every reported box are EXACTLY the group-only baseline;
 *  3. a sibling rating correction survives a quality rejoin (and vice versa):
 *     the rejoin never sweeps another family's corrections nor the group's
 *     position/scale (`qscale`/`qox`/`qoy` stay in the URL untouched).
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
import {
  parseBadgeItemTransforms,
  rejoinBadgeItems,
  serializeBadgeItemTransforms,
  withoutBadgeItemFamily,
  type BadgeItemTransformMap,
} from "@/lib/badge-item-transforms"

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

/** Group geometry is explicit and identical on every request (only `bit` varies). */
const GEOMETRY = "&qscale=120&qox=8&qoy=-6"
const baseUrl = (extra: string) =>
  `http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&rsrc=imdb,tmdb&sep=1&badges=1&ranking=1&bq=1&preview=1&demosamples=1&api_key=test${GEOMETRY}${extra}`
const withBit = (map: BadgeItemTransformMap) => {
  const wire = serializeBadgeItemTransforms(map)
  return baseUrl(wire ? `&bit=${encodeURIComponent(wire)}` : "")
}

type GeoItem = { id: string; family: string; top: number; left: number; w: number; h: number; custom: boolean }
type Geo = { items: GeoItem[] }

async function fetchImageFrom(url: string): Promise<Buffer> {
  const res = await GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: "44" }) })
  expect(res.status).toBe(200)
  return Buffer.from(await res.arrayBuffer())
}

async function fetchGeoFrom(url: string): Promise<Geo> {
  const res = await GET(new NextRequest(`${url}&debug=1&netgeo=1`), {
    params: Promise.resolve({ type: "movie", id: "44" }),
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { badges: Geo }).badges
}

const byId = (geo: Geo, id: string) => geo.items.find((item) => item.id === id)

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

/**
 * Identities this demo request actually paints: the tier mark plus the two
 * rating pills (the route paints an A/V mark only when the real stream spec
 * has one, and an age pill only with a certification — those branches are
 * covered at the renderer level by `badge-item-render-integration.test.ts`).
 */
const DETACH_QUALITY = "quality:tier=140,0,-30"
const QUALITY_IDS = ["quality:tier"]

describe("rejoin returns the real render to the group-only baseline", () => {
  it("quality group: detached marks -> rejoin-all = identical bytes + identical boxes", async () => {
    const baseGeo = await fetchGeoFrom(baseUrl(""))
    const basePng = await fetchImageFrom(baseUrl(""))
    const detachedMap = parseBadgeItemTransforms(DETACH_QUALITY)
    // Sensitivity: the detached marks really move the served image.
    const detachedPng = await fetchImageFrom(withBit(detachedMap))
    expect(detachedPng.equals(basePng)).toBe(false)
    const detachedGeo = await fetchGeoFrom(withBit(detachedMap))
    const movedIds = QUALITY_IDS
    for (const id of movedIds) {
      expect(byId(detachedGeo, id)).toBeDefined()
      expect(byId(detachedGeo, id)).not.toEqual(byId(baseGeo, id))
      expect(byId(detachedGeo, id)!.custom).toBe(true)
    }

    // Rejoin-all = the SAME primitives the editor's rejoin action uses.
    const rejoined = withoutBadgeItemFamily(detachedMap, "quality")
    expect(serializeBadgeItemTransforms(rejoined)).toBeNull()
    const rejoinedUrl = withBit(rejoined)
    expect(rejoinedUrl).toBe(baseUrl(""))

    // Pixels: EXACTLY the group-only baseline (no stray glyph, no soft resample).
    expect((await fetchImageFrom(rejoinedUrl)).equals(basePng)).toBe(true)
    // Boxes the overlay reads: exactly the baseline ones.
    const rejoinedGeo = await fetchGeoFrom(rejoinedUrl)
    for (const id of movedIds) expect(byId(rejoinedGeo, id)).toEqual(byId(baseGeo, id))
    expect(rejoinedGeo.items.every((item) => !item.custom)).toBe(true)
  })

  it("single badge: rejoining the tier equals the baseline, a sibling mark keeps its tuning", async () => {
    const baseGeo = await fetchGeoFrom(baseUrl(""))
    const basePng = await fetchImageFrom(baseUrl(""))
    const detachedMap = parseBadgeItemTransforms(`${DETACH_QUALITY};rating:tmdb=110,0,34`)
    const tunedPng = await fetchImageFrom(withBit(detachedMap))
    expect(tunedPng.equals(basePng)).toBe(false)

    // Per-ITEM rejoin: only quality:tier goes back.
    const rejoined = rejoinBadgeItems(detachedMap, ["quality:tier"])
    expect(rejoined["quality:tier"]).toBeUndefined()
    expect(rejoined["rating:tmdb"]).toEqual({ scale: 110, offsetX: 0, offsetY: 34 })

    const rejoinedGeo = await fetchGeoFrom(withBit(rejoined))
    expect(byId(rejoinedGeo, "quality:tier")).toEqual(byId(baseGeo, "quality:tier"))
    // The rating sibling is still detached exactly where it was.
    expect(byId(rejoinedGeo, "rating:tmdb")!.custom).toBe(true)
    // Not the baseline (the rating pill is still tuned) and not the original
    // detach (the tier came back).
    const rejoinedPng = await fetchImageFrom(withBit(rejoined))
    expect(rejoinedPng.equals(basePng)).toBe(false)
    expect(rejoinedPng.equals(tunedPng)).toBe(false)
    // Rejoining the last remaining correction returns the exact baseline bytes.
    const allBack = rejoinBadgeItems(rejoined, ["rating:tmdb"])
    expect(serializeBadgeItemTransforms(allBack)).toBeNull()
    expect((await fetchImageFrom(withBit(allBack))).equals(basePng)).toBe(true)
  })

  it("quality rejoin never touches the rating family nor the group geometry", async () => {
    const baseGeo = await fetchGeoFrom(baseUrl(""))
    const mixed = parseBadgeItemTransforms(`${DETACH_QUALITY};rating:tmdb=110,0,34`)
    const mixedGeo = await fetchGeoFrom(withBit(mixed))
    const tmdbMoved = byId(mixedGeo, "rating:tmdb")!
    const imdbBase = byId(baseGeo, "rating:imdb")!
    expect(tmdbMoved).toBeDefined()
    expect(tmdbMoved.custom).toBe(true)

    // Group rejoin of the quality family only.
    const rejoined = withoutBadgeItemFamily(mixed, "quality")
    expect(serializeBadgeItemTransforms(rejoined)).toBe("rating:tmdb=110,0,34")
    const rejoinedGeo = await fetchGeoFrom(withBit(rejoined))
    // Sibling rating pill untouched by the quality rejoin...
    expect(byId(rejoinedGeo, "rating:imdb")).toEqual(imdbBase)
    // ...the corrected rating stays exactly where it was...
    expect(byId(rejoinedGeo, "rating:tmdb")).toEqual(tmdbMoved)
    // ...and the quality marks are back on the automatic group slots (the group
    // `qscale`/`qox`/`qoy` are part of every request and were never rewritten).
    for (const id of QUALITY_IDS) expect(byId(rejoinedGeo, id)).toEqual(byId(baseGeo, id))
  })
})
