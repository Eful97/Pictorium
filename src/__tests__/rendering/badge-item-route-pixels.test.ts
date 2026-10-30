/**
 * Per-ITEM transforms through the REAL poster endpoint (wire -> config ->
 * cache -> pixels).
 *
 * Why this file exists: the regression "single badge drag moves only the
 * overlay frame" is a TRANSPORT bug class, not a renderer-geometry one — the
 * overlay reads the boxes of a `debug=1&netgeo=1` render, so geometry alone can
 * be right while the served image never changes. These tests drive the real
 * route handler (only external APIs are mocked) and compare the DECODED poster
 * pixels of two requests that differ only in the canonical `bit=` wire value.
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

const baseUrl = (extra: string) =>
  `http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&rsrc=imdb,tmdb&sep=1&badges=1&ranking=1&bq=1&preview=1&demosamples=1&api_key=test${extra}`

/** Geometry of the per-item boxes, as the editor overlay reads it. */
type Geo = {
  items: { id: string; family: string; top: number; left: number; w: number; h: number; custom: boolean; ghost?: boolean }[]
}

/** Demo preview WITHOUT the separate column: ONE painted quality mark.
 *  `formats=none` keeps it single: demo samples now fill the enabled A/V marks
 *  too, and this test measures the tier mark of the quality group. */
const singleMarkUrl = (extra: string) =>
  `http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&sep=0&badges=1&ranking=1&bq=1&formats=none&preview=1&demosamples=1&api_key=test${extra}`

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

/** Peak/mean luminance of a box on the decoded poster (glyph presence proof). */
async function luma(
  png: Buffer,
  box: { top: number; left: number; w: number; h: number },
): Promise<{ max: number; mean: number }> {
  const meta = await sharp(png).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  const left = Math.max(0, Math.min(width - 1, Math.round(box.left)))
  const top = Math.max(0, Math.min(height - 1, Math.round(box.top)))
  const w = Math.max(1, Math.min(Math.round(box.w), width - left))
  const h = Math.max(1, Math.min(Math.round(box.h), height - top))
  const raw = await sharp(png).extract({ left, top, width: w, height: h }).greyscale().raw().toBuffer()
  let max = 0
  let sum = 0
  for (const v of raw) { if (v > max) max = v; sum += v }
  return { max, mean: sum / raw.length }
}

/** A painted badge on the dark test poster / the bare background. */
const MARK_ON = 100
const MARK_OFF = 40

describe("GET /api/poster per-ITEM corrections (`bit=`) move the served pixels", () => {
  it("single quality mark: the automatic slot is vacated, the wire value moves it", async () => {
    // Canonical wire value of the editor write (`serializeBadgeItemTransforms`).
    const bit = "quality:tier=100,0,40"
    const baseUrlNoBit = singleMarkUrl("")
    const geoBase = await fetchGeoFrom(baseUrlNoBit)
    const tier = geoBase.items.find((i) => i.id === "quality:tier")!
    expect(tier).toBeDefined()
    expect(geoBase.items).toHaveLength(1)
    expect(tier.custom).toBe(false)

    const geoTuned = await fetchGeoFrom(singleMarkUrl(`&bit=${encodeURIComponent(bit)}`))
    const moved = geoTuned.items.find((i) => i.id === "quality:tier")!
    expect(moved.top).toBe(tier.top + 40)
    expect(moved.left).toBe(tier.left)
    expect(moved.custom).toBe(true)

    const base = await fetchImageFrom(baseUrlNoBit)
    // Same URL twice: the internal cache must return the same bytes (no
    // poisoning between requests of different `bit`).
    expect((await fetchImageFrom(baseUrlNoBit)).equals(base)).toBe(true)
    const tuned = await fetchImageFrom(singleMarkUrl(`&bit=${encodeURIComponent(bit)}`))

    // The REPORTED box moved AND the served image moved: the old slot is bare
    // and the glyph is at the corrected slot. (Before the fix the group bitmap
    // kept the glyph, so the automatic slot stayed painted and the image was a
    // no-op whenever the detached copy was clipped at the canvas edge.)
    // Band of the old box ABOVE the corrected copy: no overlap, so it proves
    // the glyph really left (the boxes share only shadow padding).
    const vacated = { top: tier.top, left: tier.left, w: tier.w, h: moved.top - tier.top }
    expect((await luma(base, vacated)).max).toBeGreaterThan(MARK_ON)
    expect((await luma(tuned, vacated)).max).toBeLessThan(MARK_OFF)
    expect((await luma(tuned, moved)).max).toBeGreaterThan(MARK_ON)
    expect(tuned.equals(base)).toBe(false)
  })

  it("separate rating pill: only that provider moves, its neighbour stays put", async () => {
    const bit = "rating:tmdb=100,0,40"
    const geoBase = await fetchGeoFrom(baseUrl(""))
    const imdb = geoBase.items.find((i) => i.id === "rating:imdb")!
    const tmdb = geoBase.items.find((i) => i.id === "rating:tmdb")!
    expect(tmdb).toBeDefined()

    const geoTuned = await fetchGeoFrom(baseUrl(`&bit=${encodeURIComponent(bit)}`))
    const movedTmdb = geoTuned.items.find((i) => i.id === "rating:tmdb")!
    expect(movedTmdb.top).toBe(tmdb.top + 40)
    expect(movedTmdb.custom).toBe(true)
    expect(geoTuned.items.find((i) => i.id === "rating:imdb")).toEqual(imdb)

    const base = await fetchImageFrom(baseUrl(""))
    const tuned = await fetchImageFrom(baseUrl(`&bit=${encodeURIComponent(bit)}`))
    expect(tuned.equals(base)).toBe(false)
    // The untouched sibling is pixel-identical in place.
    const sibling = await luma(base, imdb)
    const siblingTuned = await luma(tuned, imdb)
    expect(siblingTuned.max).toBe(sibling.max)
    expect(Math.abs(siblingTuned.mean - sibling.mean)).toBeLessThan(1)
    // The corrected pill is painted at the corrected slot, and its automatic
    // slot band above the copy is bare.
    const vacated = { top: tmdb.top, left: tmdb.left, w: tmdb.w, h: movedTmdb.top - tmdb.top }
    expect((await luma(base, vacated)).max).toBeGreaterThan(MARK_ON)
    expect((await luma(tuned, vacated)).max).toBeLessThan(MARK_OFF)
    expect((await luma(tuned, movedTmdb)).max).toBeGreaterThan(MARK_ON)
  })

  it("group baseline: `qoy` still moves the whole quality group (no regression)", async () => {
    // Explicit offsets on both sides: the group slider keeps moving the whole
    // stack exactly like before the per-item layer existed.
    const geoBase = await fetchGeoFrom(baseUrl("&qoy=0"))
    const tier = geoBase.items.find((i) => i.id === "quality:tier")!
    const geoTuned = await fetchGeoFrom(baseUrl("&qoy=40"))
    expect(geoTuned.items.find((i) => i.id === "quality:tier")!.top).toBe(tier.top + 40)

    const base = await fetchImageFrom(baseUrl("&qoy=0"))
    const tuned = await fetchImageFrom(baseUrl("&qoy=40"))
    expect(tuned.equals(base)).toBe(false)
    expect((await luma(base, tier)).max).toBeGreaterThan(MARK_ON)
    expect((await luma(tuned, { ...tier, top: tier.top + 40 })).max).toBeGreaterThan(MARK_ON)
  })

  it("a garbage/neutral `bit` collapses onto the automatic render", async () => {
    const base = await fetchImageFrom(baseUrl(""))
    const neutral = await fetchImageFrom(baseUrl(`&bit=${encodeURIComponent("quality:tier=100,0,0")}`))
    const garbage = await fetchImageFrom(baseUrl(`&bit=${encodeURIComponent("nope=1,2,3;rating:imdb=abc")}`))
    expect(neutral.equals(base)).toBe(true)
    expect(garbage.equals(base)).toBe(true)
  })
})

/**
 * Quality HOME corrections on the real wire: `bit=quality:home:<kind>=…` is
 * accepted like every other identity, reaches the renderer and moves the
 * reported box, while the additive `?ghosts=1` preview flag publishes the
 * EMPTY homes as box-only entries without touching a pixel or the cache key.
 */
describe("quality homes on the route (wire + ghosts flag)", () => {
  it("moves the painted group through a home correction (same wire form)", async () => {
    const base = singleMarkUrl("")
    const tuned = `${base}&bit=${encodeURIComponent("quality:home:tier=100,0,25")}`
    const baseGeo = await fetchGeoFrom(base)
    const tunedGeo = await fetchGeoFrom(tuned)
    const baseTier = baseGeo.items.find((item) => item.id === "quality:tier")!
    const tunedTier = tunedGeo.items.find((item) => item.id === "quality:tier")!
    expect(tunedTier.top).toBe(baseTier.top + 25)
    expect(tunedTier.left).toBe(baseTier.left)
    expect(tunedTier.custom).toBe(true)
    // The served image really changed (the correction is not overlay-only).
    const basePng = await fetchImageFrom(base)
    const tunedPng = await fetchImageFrom(tuned)
    expect(tunedPng.equals(basePng)).toBe(false)
  }, 60000)

  it("publishes the empty homes only with ghosts=1, never a pixel", async () => {
    const url = singleMarkUrl("")
    const off = await fetchGeoFrom(url)
    expect(off.items.some((item) => item.ghost === true)).toBe(false)
    const on = await fetchGeoFrom(`${url}&ghosts=1`)
    const ghosts = on.items.filter((item) => item.ghost === true)
    // Only the tier is painted on this sample: the other four homes are ghosts.
    expect(ghosts.map((ghost) => ghost.id)).toEqual([
      "quality:home:age",
      "quality:home:dolby",
      "quality:home:hdr",
      "quality:home:imax",
    ])
    for (const ghost of ghosts) {
      expect(ghost.family).toBe("quality")
      expect(ghost.w).toBeGreaterThan(0)
      expect(ghost.h).toBeGreaterThan(0)
    }
    // The painted items are the same boxes with and without the flag.
    expect(on.items.filter((item) => item.ghost !== true)).toEqual(off.items)
    // The flag is a diagnostic: identical bytes, no cache-key fragment.
    const plain = await fetchImageFrom(url)
    const withGhosts = await fetchImageFrom(`${url}&ghosts=1`)
    expect(withGhosts.equals(plain)).toBe(true)
  }, 60000)
})
