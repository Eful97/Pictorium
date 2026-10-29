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
import { DEMO_SAMPLE_AGE_LABEL } from "@/lib/demo-samples"
import { getReleaseDates } from "@/lib/tmdb"
import * as posterService from "@/lib/poster-service"
import {
  __inMemoryChartGenerationPersist,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
} from "@/lib/chart-generation"
import { renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid } from "@/lib/network-svgs"

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
  // Valid tiny bitmaps (never null): the service spreads renderer results,
  // so a null mock would poison layout with a png-less object.
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

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

vi.mock("@/lib/imdb-cache", () => ({
  resolveWikidataId: vi.fn(async () => null),
}))

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
  // Age badge sources: genuine miss (data ok, no country match) unless a test
  // supplies a certification. Declared here because the route's optional age
  // fetch has to stay resolvable in this harness.
  getReleaseDates: vi.fn(async () => null),
  getContentRatings: vi.fn(async () => null),
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

const mockedGetById = vi.mocked(getById)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)

const EMPTY_DETAILS = {
  id: 44,
  title: "No Data Title",
  name: undefined,
  genres: [],
  vote_average: 0,
  vote_count: 0,
  original_language: "en",
  release_date: null,
  first_air_date: null,
  last_air_date: null,
  number_of_seasons: null,
  number_of_episodes: null,
  type: undefined,
  status: undefined,
  networks: [],
  production_companies: [],
}

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

function armEmptyUpstream() {
  mockedGetById.mockResolvedValue(null)
  mockedGetDetails.mockResolvedValue({ ...EMPTY_DETAILS } as never)
  mockedGetDetailsWithExternalIds.mockResolvedValue({ ...EMPTY_DETAILS, external_ids: { imdb_id: null } } as never)
  mockedGetImages.mockResolvedValue({ id: 44, posters: [], logos: [], backdrops: [] })
  mockedGetExternalIds.mockResolvedValue({ imdb_id: null })
  mockedGetJWRankings.mockResolvedValue([])
  vi.mocked(fetchMDBList).mockResolvedValue([])
  vi.mocked(fetchAggregatedRating).mockResolvedValue(null)
  vi.mocked(resolveStreamQuality).mockResolvedValue(null as never)
  vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null })
}

describe("GET /api/poster demo samples (Settings preview only)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    cacheClear()
    // Real chart-state isolation (test hook, not a mock): a snapshot published
    // by an earlier test must not shadow the rank mocks below.
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    __resetTMDBSessionCache()
    __resetImageBytesForTest()
    // Spy the real renderer: tests below inspect the production input.
    vi.spyOn(posterService, "generatePosterBuffer")
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    armEmptyUpstream()
    const posterBuf = await imageBuffer("#101010", 500, 750)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBuf), {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
    }))
  })

  afterEach(() => {
    cacheClear()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
    __resetTMDBSessionCache()
  })

  const debugUrl = (extra: string) =>
    `http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&rsrc=imdb,tmdb&badges=1&ranking=1${extra}&api_key=test`

  it("fills rank, ratings average, quality tier and genre/year gaps on an accepted preview", async () => {
    const res = await GET(new NextRequest(debugUrl("&preview=1&demosamples=1&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.finalRank).toBe(11)
    expect(body.vote.average).toBeCloseTo(7.9, 5)
    expect(body.quality.value).toBe("4K")
    expect(body.genre.name).toBe("Avventura")
    expect(body.genre.year).toBe("2009")
  })

  it("renders genuine emptiness without the flag on the same preview", async () => {
    const res = await GET(new NextRequest(debugUrl("&preview=1&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.finalRank).toBeNull()
    // Genuine emptiness: no fetched vote exists (null, not an invented 0).
    expect(body.vote.average).toBeNull()
    expect(body.quality.value).toBeNull()
    expect(body.genre.name).toBeNull()
  })

  it("ignores the flag without preview=1 (no sample leaks to final posters)", async () => {
    // Saved mapping render (no poster= override, so public hardening cannot
    // strip the base): the flag alone must not inject samples.
    mockedGetById.mockResolvedValue({
      tmdbId: 44,
      mediaType: "movie",
      title: "Mapped",
      posterPath: "/mapped.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      imdbId: "tt0000044",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?rsrc=imdb,tmdb&badges=1&ranking=1&demosamples=1&debug=1&api_key=test",
    ), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.finalRank).toBeNull()
    expect(body.vote.average).toBeNull()
    expect(body.quality.value).toBeNull()
    expect(body.genre.name).toBeNull()
  })

  it("honors ranking=0 even with samples (toggles are never forced)", async () => {
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&rsrc=imdb,tmdb&badges=1&ranking=0&preview=1&demosamples=1&debug=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.finalRank).toBeNull()
  })

  it("keeps the 4K sample tier with formats=none (no invented format icons)", async () => {
    const res = await GET(new NextRequest(debugUrl("&preview=1&demosamples=1&formats=none&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quality.value).toBe("4K")
  })

  it("falls back to the bundled brand only after real candidates miss", async () => {
    const hybrid = vi.mocked(renderFirstMatchingNetworkLogoBadgeHybrid)
    const rawHybrid = vi.mocked(renderFirstMatchingNetworkRawBadgeHybrid)
    hybrid.mockClear()
    rawHybrid.mockClear()
    // Pill mock resolves the bundled brand only (unknown names miss, like
    // the real matcher); raw stays null like a plain logo fetch.
    hybrid.mockImplementation(async (cands) =>
      cands.some((c) => !!c && typeof c !== "string" && c.name === "Netflix")
        ? { png: Buffer.alloc(8), w: 8, h: 8, networkKey: "netflix", matchedName: "Netflix" }
        : null,
    )
    const base = "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=1&api_key=test"
    const withSamples = await GET(new NextRequest(`${base}&preview=1&demosamples=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(withSamples.status).toBe(200)
    // Empty genuine candidates take the legacy path (no match); the service
    // fallback retries once with the bundled brand through the same renderer.
    expect(hybrid.mock.calls.length).toBe(1)
    expect(hybrid.mock.calls[0][0]).toEqual([{ name: "Netflix", logoPath: null }])
    expect(rawHybrid.mock.calls.length).toBe(1)
    expect(rawHybrid.mock.calls[0][0]).toEqual([{ name: "Netflix", logoPath: null }])

    hybrid.mockClear()
    rawHybrid.mockClear()
    const genuine = await GET(new NextRequest(`${base}&preview=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(genuine.status).toBe(200)
    // Genuine path: legacy empty candidates only, never the bundled brand.
    expect(hybrid).not.toHaveBeenCalled()
    expect(rawHybrid).not.toHaveBeenCalled()
  })

  it("keeps real brands first: a matching network never reaches the fallback", async () => {
    const hboDetails = {
      ...EMPTY_DETAILS,
      networks: [{ name: "HBO", logo_path: null, origin_country: "US" }],
    }
    mockedGetDetails.mockResolvedValue(hboDetails as never)
    mockedGetDetailsWithExternalIds.mockResolvedValue({ ...hboDetails, external_ids: { imdb_id: null } } as never)
    const hybrid = vi.mocked(renderFirstMatchingNetworkLogoBadgeHybrid)
    hybrid.mockClear()
    hybrid.mockImplementation(async (cands) =>
      cands.some((c) => !!c && typeof c !== "string" && c.name === "HBO")
        ? { png: Buffer.alloc(8), w: 8, h: 8, networkKey: "hbo", matchedName: "HBO" }
        : null,
    )
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=1&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    // Matched on the first pass: no fallback call at all.
    expect(hybrid.mock.calls.length).toBe(1)
    expect(hybrid.mock.calls[0][0]).toContainEqual({ name: "HBO", logoPath: null })
    expect(hybrid.mock.calls[0][0]).not.toContainEqual({ name: "Netflix", logoPath: null })
  })

  it("merges real scores with samples for partial providers", async () => {
    const { fetchAggregatedRating } = await import("@/lib/ratings")
    vi.mocked(fetchAggregatedRating).mockResolvedValue({ sources: { imdb: 9.0 }, average: 9.0, count: 1 })
    // Real imdbId through external_ids so the ratings fetch actually runs.
    mockedGetDetailsWithExternalIds.mockResolvedValue({ ...EMPTY_DETAILS, external_ids: { imdb_id: "tt0000044" } } as never)
    mockedGetById.mockResolvedValue(null)
    const spy = vi.mocked(posterService.generatePosterBuffer)
    spy.mockClear()
    // Full render (no debug short-circuit: compose is what consumes the input).
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&rsrc=imdb,tmdb&sep=1&badges=1&ranking=1&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalled()
    // Separate column through the production input: real imdb kept, tmdb sampled.
    const genInput = spy.mock.calls[spy.mock.calls.length - 1][0] as {
      separateRatings: Array<{ id: string; value: number }> | undefined
      voteAverage: number | null
    }
    expect(genInput.separateRatings).toEqual([
      { id: "imdb", value: 9.0 },
      { id: "tmdb", value: 7.6 },
    ])
    // multiRatingOnly preserved: the legacy vote is kept, never averaged up.
    expect(genInput.voteAverage).toBeNull()
  })

  it("prefers a real resolved quality tier over the sample", async () => {
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: "FHD", status: "resolved", source: "test" } as never)
    const res = await GET(new NextRequest(debugUrl("&preview=1&demosamples=1&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).quality.value).toBe("FHD")
  })

  it("prefers a real chart rank over the sample", async () => {
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: 44, rank: 5 }] as never)
    const res = await GET(new NextRequest(debugUrl("&preview=1&demosamples=1&debug=1")), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).rankings.finalRank).toBe(5)
  })

  it("samples the vote with ranking off but rating on (actual consumers gate)", async () => {
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&rsrc=imdb,tmdb&badges=1&ranking=0&br=1&preview=1&demosamples=1&debug=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rankings.finalRank).toBeNull()
    expect(body.vote.average).toBeCloseTo(7.9, 5)
  })

  it("passes sampled values to the production renderer input", async () => {
    const spy = vi.mocked(posterService.generatePosterBuffer)
    spy.mockClear()
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&rsrc=imdb,tmdb&badges=1&ranking=1&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    expect(spy).toHaveBeenCalled()
    const genInput = spy.mock.calls[spy.mock.calls.length - 1][0] as {
      finalRank: number | null
      quality: string | null
      voteAverage: number | null
      genreName: string | null
      separateRatings: Array<{ id: string; value: number }> | undefined
      badgesEnabled: boolean
      rankingEnabled: boolean
    }
    expect(genInput.finalRank).toBe(11)
    expect(genInput.quality).toBe("4K")
    expect(genInput.voteAverage).toBeCloseTo(7.9, 5)
    expect(genInput.genreName).toBe("Avventura")
    // No separate column without sep=1: the data stays column-ready upstream.
    expect(genInput.separateRatings).toBeUndefined()
    expect(genInput.badgesEnabled).toBe(true)
    expect(genInput.rankingEnabled).toBe(true)
  })

  it("renders nothing with all badges off despite sampled data", async () => {
    const res = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=0&ranking=0&preview=1&demosamples=1&debug=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    // Toggles gate every badge slot: no rank, no badge rendering.
    expect(body.badge.settings.badgesEnabled).toBe(false)
    expect(body.badge.settings.rankingEnabled).toBe(false)
    expect(body.rankings.finalRank).toBeNull()
  })

  it("samples the enabled A/V marks and the age label on an accepted preview", async () => {
    // Enabled-but-missing formats: the restricted selection is the only gate.
    const spy = vi.mocked(posterService.generatePosterBuffer)
    spy.mockClear()
    const formatsRes = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=1&formats=dv,atmos&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(formatsRes.status).toBe(200)
    expect(spy).toHaveBeenCalled()
    const genInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    // Exactly the enabled formats: no format the user turned off is sampled.
    expect(genInput.videoFormats).toEqual(["dv", "atmos"])

    // Age: no certification resolves for this title/country → style sample.
    const ageRes = await GET(new NextRequest(
      debugUrl("&age=1&agecountry=IT&preview=1&demosamples=1&debug=1"),
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(ageRes.status).toBe(200)
    const body = await ageRes.json()
    expect(body.age.label).toBe(DEMO_SAMPLE_AGE_LABEL)
  })

  it("samples every known format when no format is disabled and formats=none samples none", async () => {
    const spy = vi.mocked(posterService.generatePosterBuffer)
    spy.mockClear()
    const unrestricted = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=1&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(unrestricted.status).toBe(200)
    const unrestrictedInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    expect(unrestrictedInput.videoFormats).toEqual(["dv", "hdr", "hdr10plus", "atmos", "imax"])

    spy.mockClear()
    const none = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=1&formats=none&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(none.status).toBe(200)
    const noneInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    // Disabled toggles are never forced: nothing enabled, nothing sampled.
    expect(noneInput.videoFormats).toBeNull()
  })

  it("never invents formats or an age label without the flag or with the age toggle off", async () => {
    const spy = vi.mocked(posterService.generatePosterBuffer)
    spy.mockClear()
    const genuine = await GET(new NextRequest(
      debugUrl("&formats=dv,atmos&age=1&agecountry=IT&preview=1&debug=1"),
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(genuine.status).toBe(200)
    expect((await genuine.json()).age.label).toBeNull()

    spy.mockClear()
    const genuineRender = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0000044&badges=1&ranking=1&formats=dv,atmos&preview=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(genuineRender.status).toBe(200)
    const genuineInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    expect(genuineInput.videoFormats).toBeNull()

    const ageOff = await GET(new NextRequest(
      debugUrl("&age=0&preview=1&demosamples=1&debug=1"),
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(ageOff.status).toBe(200)
    expect((await ageOff.json()).age.label).toBeNull()
  })

  it("gates real AV specs by the enabled selection: formats=none and a restricted list", async () => {
    // tt0021749 carries a real local spec (4K, DV only). The Settings demo
    // preview still honors the user's format selection: a disabled mark is
    // never resurrected just because the title really has it.
    const spy = vi.mocked(posterService.generatePosterBuffer)
    spy.mockClear()
    const none = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0021749&badges=1&ranking=1&formats=none&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(none.status).toBe(200)
    const noneInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    expect(noneInput.videoFormats).toBeNull()

    spy.mockClear()
    const restricted = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0021749&badges=1&ranking=1&formats=imax&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(restricted.status).toBe(200)
    const restrictedInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    // Exactly the enabled selection: real DV was turned off by the user.
    expect(restrictedInput.videoFormats).toEqual(["imax"])

    spy.mockClear()
    const kept = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0021749&badges=1&ranking=1&formats=dv,imax&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(kept.status).toBe(200)
    const keptInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    expect(keptInput.videoFormats).toEqual(["dv", "imax"])
  })

  it("keeps real AV specs and real certifications ahead of the samples", async () => {
    // tt0021749 carries a real local spec (4K, DV only).
    const spy = vi.mocked(posterService.generatePosterBuffer)
    spy.mockClear()
    const specRes = await GET(new NextRequest(
      "http://localhost:3000/api/poster/movie/44?poster=%2Fq.jpg&imdbId=tt0021749&badges=1&ranking=1&preview=1&demosamples=1&api_key=test",
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(specRes.status).toBe(200)
    const specInput = spy.mock.calls[spy.mock.calls.length - 1][0] as { videoFormats?: string[] | null }
    // Every ENABLED mark is demoed even when the real spec is partial: the
    // real DV stays first and no enabled mark is silently absent.
    expect(specInput.videoFormats).toEqual(["dv", "hdr", "hdr10plus", "atmos", "imax"])

    vi.mocked(getReleaseDates).mockResolvedValue({
      id: 44,
      results: [{ iso_3166_1: "IT", release_dates: [{ certification: "VM14", release_date: "2024-01-10T00:00:00.000Z", type: 3 }] }],
    } as never)
    const ageRes = await GET(new NextRequest(
      debugUrl("&age=1&agecountry=IT&preview=1&demosamples=1&debug=1"),
    ), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(ageRes.status).toBe(200)
    expect((await ageRes.json()).age.label).toBe("VM14")
  })

  it("downgraded previews drop the flag and serve genuine canonical renders", async () => {
    // Locked session on a public instance: anonymous previews downgrade to
    // normal renders (opt-in chain complete).
    vi.stubEnv("PICTORIUM_ADMIN_TOKEN", "locked-test-token")
    vi.stubEnv("ADMIN_TOKEN", "locked-test-token")
    mockedGetById.mockResolvedValue({
      tmdbId: 44,
      mediaType: "movie",
      title: "Mapped",
      posterPath: "/mapped.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      showBadges: true,
      rankingBadges: true,
      imdbId: "tt0000044",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    const { fetchAggregatedRating } = await import("@/lib/ratings")
    const agg = vi.mocked(fetchAggregatedRating)
    const callsBefore = agg.mock.calls.length
    // sep=1 starts the ratings fetch (its result is genuinely empty here).
    const renderUrl = "http://localhost:3000/api/poster/movie/44?rsrc=imdb,tmdb&sep=1&badges=1&ranking=1&preview=1&demosamples=1&api_key=test"
    const first = await GET(new NextRequest(renderUrl), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(first.status).toBe(200)
    expect(agg.mock.calls.length).toBe(callsBefore + 1)
    // Canonical render was cached: the repeat serves it with zero refetch.
    const second = await GET(new NextRequest(renderUrl), { params: Promise.resolve({ type: "movie", id: "44" }) })
    expect(second.status).toBe(200)
    expect(agg.mock.calls.length).toBe(callsBefore + 1)
    // Genuine data: the downgrade removed preview semantics and samples.
    const debug = await GET(new NextRequest(`${renderUrl}&debug=1`), {
      params: Promise.resolve({ type: "movie", id: "44" }),
    })
    expect(debug.status).toBe(200)
    const body = await debug.json()
    expect(body.rankings.finalRank).toBeNull()
    expect(body.vote.average).toBeNull()
    expect(body.quality.value).toBeNull()
    expect(body.genre.name).toBeNull()
  })
})
