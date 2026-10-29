/**
 * Automatic title wordmark — route gating and precedence (mocked production
 * GET, no live credentials).
 *
 * A title without ANY TMDB logo gets its wordmark from the title, but only on a
 * textless portrait base: the clean poster branch, the portrait backdrop-crop
 * base (including the frozen mapping base) and the landscape backdrop. A
 * language poster (baked title) keeps the historic no-logo render, a real TMDB
 * logo wins, a typed/saved wordmark wins and `logoDisabled` always wins. The
 * derived text is never persisted (no `logoText` in any save payload): it is
 * regenerated deterministically at every render.
 */
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds, getReleaseDates, getContentRatings } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAllWikidata } from "@/lib/awards"
import { fetchAggregatedRating } from "@/lib/ratings"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { resolveStreamQuality } from "@/lib/stream-quality"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { TMDBImage } from "@/lib/types"
import { AUTO_WORDMARK_ELLIPSIS, AUTO_WORDMARK_FONT, AUTO_WORDMARK_MAX_CHARS } from "@/lib/text-logo"

vi.mock("@/lib/poster-service", async () => {
  const png = await sharp({ create: { width: 12, height: 12, channels: 4, background: "#000000" } }).png().toBuffer()
  return { generatePosterBuffer: vi.fn(async () => png) }
})

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/custom-rating")>(),
  fetchCustomRatings: vi.fn(async () => []),
}))
vi.mock("@/lib/multi-rating-renderer", () => ({ renderMultiRatings: vi.fn(async () => null) }))
vi.mock("@/lib/svg-badge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/svg-badge")>()
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#ffffff" } }).png().toBuffer()
  const png = () => ({ png: tiny, w: 8, h: 8 })
  return {
    ...actual,
    renderGenreBadge: vi.fn(async () => png()),
    renderRankingBadge: vi.fn(async () => png()),
    renderExtraBadge: vi.fn(async () => png()),
    renderQualityBadge: vi.fn(async () => png()),
    renderQualityKnockoutBadge: vi.fn(async () => png()),
  }
})
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

let serverDefaults: ServerDefaults = {
  defaultLogoFitEnabled: false,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
}
vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => serverDefaults),
    getServerDefaultsChecked: vi.fn(async () => serverDefaults),
  }
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
vi.mock("@/lib/imdb-top250", () => ({ isImdbTop250: vi.fn(async () => false), isImdbTop100: vi.fn(async () => false) }))
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
  getReleaseDates: vi.fn(),
  getContentRatings: vi.fn(),
  resolveRequestApiKey: vi.fn((req: { nextUrl?: { searchParams: URLSearchParams } }) => req.nextUrl?.searchParams.get("api_key") || undefined),
  resolveUserApiKeys: vi.fn(async (req: { nextUrl?: { searchParams: URLSearchParams } }) => {
    const q = req.nextUrl?.searchParams.get("api_key") || undefined
    const none = { key: undefined, source: "none" } as const
    return { tmdb: q ? { key: q, source: "query" } : none, mdblist: none, tvdb: none }
  }),
}))

const mockedGetById = vi.mocked(getById)
const mockedGenerate = vi.mocked(generatePosterBuffer)

const img = (file_path: string, iso: string | null): TMDBImage => ({
  file_path,
  iso_639_1: iso,
  vote_average: 0,
  width: 500,
  height: 750,
})

let detailsTitle = "Dune"
let backdrops: TMDBImage[] = []
let posterList: TMDBImage[] = []
let logoList: TMDBImage[] = []

function armUpstream() {
  mockedGetById.mockResolvedValue(null)
  // Implementation (not mockResolvedValue): the fixtures are reassigned by each
  // test and must be read at call time.
  const makeDetails = () => ({
    id: 88,
    title: detailsTitle,
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
    backdrop_path: backdrops[0]?.file_path ?? null,
    networks: [],
    production_companies: [],
  })
  vi.mocked(getDetails).mockImplementation(async () => makeDetails() as never)
  vi.mocked(getDetailsWithExternalIds).mockImplementation(async () => ({ ...makeDetails(), external_ids: { imdb_id: null } } as never))
  vi.mocked(getImages).mockImplementation(async () => ({ id: 88, posters: posterList, logos: logoList, backdrops } as never))
  vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null })
  vi.mocked(getJWRankings).mockResolvedValue([])
  vi.mocked(getReleaseDates).mockReset().mockResolvedValue({ id: 88, results: [] } as never)
  vi.mocked(getContentRatings).mockReset().mockResolvedValue({ id: 88, results: [] } as never)
  vi.mocked(fetchMDBList).mockResolvedValue([])
  vi.mocked(fetchAggregatedRating).mockResolvedValue(null)
  vi.mocked(resolveStreamQuality).mockResolvedValue(null as never)
  vi.mocked(fetchAllWikidata).mockResolvedValue({ awards: [], nominations: [], studios: [], director: null })
}

function lastInput(): GenerationInput {
  const calls = mockedGenerate.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0]
}

async function get(url: string) {
  const res = await GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: "88" }) })
  expect(res.status).toBe(200)
  return lastInput()
}

const BASE_URL = "http://localhost:3000/api/poster/movie/88?badges=0&ranking=0&api_key=test"

beforeEach(async () => {
  vi.restoreAllMocks()
  cacheClear()
  __resetTMDBSessionCache()
  __resetImageBytesForTest()
  mockedGenerate.mockClear()
  vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
  vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  serverDefaults = { defaultLogoFitEnabled: false, badgeStyle: "shadow", rankingBadgeStyle: "default" }
  detailsTitle = "Dune"
  backdrops = []
  posterList = []
  logoList = []
  armUpstream()
  const posterBuf = await sharp({ create: { width: 500, height: 750, channels: 4, background: "#101010" } }).png().toBuffer()
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(posterBuf), {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(posterBuf.length) },
  }))
})

afterEach(() => {
  vi.mocked(getById).mockReset()
  cacheClear()
  __resetTMDBSessionCache()
})

function savedMapping(overrides: Record<string, unknown> = {}) {
  return {
    tmdbId: 88,
    mediaType: "movie",
    title: "Dune",
    posterPath: "/clean.jpg",
    logoPath: null,
    originalPosterPath: "/clean.jpg",
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("auto wordmark — clean poster base", () => {
  it("composes the title wordmark when no TMDB logo exists", async () => {
    posterList = [img("/clean.jpg", null)]
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:DUNE`)
    expect(input.logoFetch).toBeInstanceOf(Buffer)
    expect(input.posterSrc).toBe("/clean.jpg")
  })

  it("truncates a long title at a word boundary (uppercase + ellipsis)", async () => {
    detailsTitle = "The Lord of the Rings: The Fellowship of the Ring"
    posterList = [img("/clean.jpg", null)]
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:THE LORD OF THE RINGS: THE${AUTO_WORDMARK_ELLIPSIS}`)
    const text = input.logoSrc!.split(":").slice(2).join(":")
    expect(text.length).toBeLessThanOrEqual(AUTO_WORDMARK_MAX_CHARS + AUTO_WORDMARK_ELLIPSIS.length)
  })

  it("a real TMDB logo keeps precedence (no auto wordmark)", async () => {
    posterList = [img("/clean.jpg", null)]
    logoList = [img("/logo-en.png", "en")]
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe("/logo-en.png")
  })

  it("a typed wordmark keeps precedence over the automatic one", async () => {
    posterList = [img("/clean.jpg", null)]
    const input = await get(`${BASE_URL}&ltext=Dune&lfont=oswald&preview=1`)
    // Manual recipe (typed text is not uppercased, manual font), not "auto".
    expect(input.logoSrc).toBe("text-logo:oswald:Dune")
  })

  it("clean disabled: the language poster keeps the historic no-logo render", async () => {
    serverDefaults = { ...serverDefaults, disableCleanPosters: true }
    posterList = [img("/lang-it.jpg", "it")]
    const input = await get(`${BASE_URL}&lang=it`)
    expect(input.logoSrc).toBeNull()
    expect(input.posterSrc).toBe("/lang-it.jpg")
  })
})

describe("auto wordmark — portrait backdrop-crop base", () => {
  it("never composes over a language poster (no clean, no backdrop)", async () => {
    posterList = [img("/lang-it.jpg", "it")]
    const input = await get(`${BASE_URL}&lang=it`)
    expect(input.logoSrc).toBeNull()
    expect(input.posterSrc).toBe("/lang-it.jpg")
  })

  it("uses the first clean backdrop as base and composes the wordmark", async () => {
    posterList = [img("/lang-it.jpg", "it")]
    backdrops = [img("/bd-fr.jpg", "fr"), img("/bd-clean.jpg", null)]
    const input = await get(`${BASE_URL}&lang=it`)
    expect(input.posterSrc).toBe("/bd-clean.jpg")
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:DUNE`)
  })
})

describe("auto wordmark — saved mapping", () => {
  it("clean saved base (language null) + no saved logo → auto wordmark", async () => {
    mockedGetById.mockResolvedValue(savedMapping() as never)
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:DUNE`)
    expect(input.posterSrc).toBe("/clean.jpg")
  })

  it("frozen portrait backdrop base → auto wordmark on the crop", async () => {
    mockedGetById.mockResolvedValue(savedMapping({ portraitBackdropPath: "/bd-clean.jpg", language: "it" }) as never)
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:DUNE`)
    expect(input.posterSrc).toBe("/bd-clean.jpg")
  })

  it("language poster base (baked title) → no wordmark", async () => {
    mockedGetById.mockResolvedValue(savedMapping({ posterPath: "/lang-it.jpg", language: "it" }) as never)
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBeNull()
    expect(input.posterSrc).toBe("/lang-it.jpg")
  })

  it("saved image logo keeps precedence", async () => {
    mockedGetById.mockResolvedValue(savedMapping({ logoPath: "/logo-it.png" }) as never)
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe("/logo-it.png")
  })

  it("saved wordmark keeps precedence", async () => {
    mockedGetById.mockResolvedValue(savedMapping({ logoText: "Nightmare Alley", logoFont: "barlow-condensed" }) as never)
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe("text-logo:barlow-condensed:Nightmare Alley")
  })

  it("logoDisabled suppresses the automatic wordmark", async () => {
    mockedGetById.mockResolvedValue(savedMapping({ logoDisabled: true }) as never)
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBeNull()
    expect(input.logoFetch).toBeNull()
  })

  it("the mapping title drives the auto wordmark (language-appropriate)", async () => {
    mockedGetById.mockResolvedValue(savedMapping({ title: "Il signore degli anelli" }) as never)
    const input = await get(BASE_URL)
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:IL SIGNORE DEGLI ANELLI`)
  })
})

describe("auto wordmark — preview transport (lauto)", () => {
  const query = (extra: string) =>
    `http://localhost:3000/api/poster/movie/88?poster=%2Fclean.jpg&title=Dune&badges=0&ranking=0&preview=1&api_key=test${extra}`

  it("lauto=1 derives the wordmark from the query title (no text travels)", async () => {
    const input = await get(query("&lauto=1"))
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:DUNE`)
  })

  it("lauto=1 without a title is inert (no wordmark to derive)", async () => {
    const input = await get("http://localhost:3000/api/poster/movie/88?poster=%2Fclean.jpg&badges=0&ranking=0&preview=1&api_key=test&lauto=1")
    expect(input.logoSrc).toBeNull()
  })

  it("lauto never overrides a typed wordmark or an image logo", async () => {
    const typed = await get(`${query("&lauto=1")}&ltext=Dune&lfont=oswald`)
    expect(typed.logoSrc).toBe("text-logo:oswald:Dune")
    const image = await get(`${query("&lauto=1")}&logo=%2Flogo-en.png`)
    expect(image.logoSrc).toBe("/logo-en.png")
  })

  it("lauto is inert on a custom base URL", async () => {
    const custom = await get(
      "http://localhost:3000/api/poster/movie/88?poster=https%3A%2F%2Fi.imgur.com%2Fclean.jpg&title=Dune&badges=0&ranking=0&preview=1&api_key=test&lauto=1",
    )
    expect(custom.logoSrc).toBeNull()
  })

  it("landscape: the server-resolved TMDB backdrop is textless, so lauto composes there", async () => {
    backdrops = [img("/bd.jpg", null)]
    const input = await get(
      "http://localhost:3000/api/poster/movie/88?poster=%2Fclean.jpg&title=Dune&badges=0&ranking=0&shape=landscape&preview=1&api_key=test&lauto=1",
    )
    expect(input.posterSrc).toBe("/bd.jpg")
    expect(input.logoSrc).toBe(`text-logo-auto:${AUTO_WORDMARK_FONT}:DUNE`)
  })
})
