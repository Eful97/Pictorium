import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getAll, getById, getImdbAlias } from "@/lib/store"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds } from "@/lib/tmdb"
import { fetchAggregatedRating } from "@/lib/ratings"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

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

vi.mock("@/lib/svg-badge", () => ({
  renderGenreBadge: vi.fn(async () => null),
  renderRankingBadge: vi.fn(async () => null),
  renderExtraBadge: vi.fn(async () => null),
  renderQualityBadge: vi.fn(async () => null),
}))

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
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

interface LangData {
  title: string
  genre: string
  vote: number
  poster: string
  logo: string
  backdrop: string
}

const LANG: Record<string, LangData> = {
  it: { title: "Titolo Italiano", genre: "Dramma", vote: 7.1, poster: "/clean-it.jpg", logo: "/it-logo.png", backdrop: "/bd-it.jpg" },
  fr: { title: "Titre Francais", genre: "Drame", vote: 8.3, poster: "/clean-fr.jpg", logo: "/fr-logo.png", backdrop: "/bd-fr.jpg" },
}

function detailsFor(lang: string, id: number) {
  const d = LANG[lang] ?? LANG.it
  return {
    id,
    title: d.title,
    genres: [{ id: 18, name: d.genre }],
    vote_average: d.vote,
    vote_count: 100,
    original_language: "en",
    backdrop_path: d.backdrop,
    release_date: "2024-03-01",
    status: "Released",
    number_of_seasons: null,
    networks: [],
    production_companies: [],
  }
}

function imagesFor(languages: string, id: number) {
  const lang = languages.split(",")[0] || "it"
  const d = LANG[lang] ?? LANG.it
  return {
    id,
    posters: [{ file_path: d.poster, iso_639_1: null, vote_average: 8, vote_count: 10, width: 500, height: 750, aspect_ratio: 0.667 }],
    logos: [{ file_path: d.logo, iso_639_1: lang, vote_average: 0, vote_count: 0, width: 400, height: 200, aspect_ratio: 2 }],
    backdrops: [],
  }
}

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(async (mediaType: string, tmdbId: number, language = "it-IT") => detailsFor(language.slice(0, 2), tmdbId)),
  getDetailsWithExternalIds: vi.fn(async (mediaType: string, tmdbId: number, language = "it-IT") => ({
    ...detailsFor(language.slice(0, 2), tmdbId),
    external_ids: { imdb_id: null, tvdb_id: null, wikidata_id: null },
  })),
  getImages: vi.fn(async (mediaType: string, tmdbId: number, languages = "en,null") => imagesFor(languages, tmdbId)),
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

const mockedGetDetailsWithExternalIds = vi.mocked(getDetailsWithExternalIds)
const mockedGetImages = vi.mocked(getImages)
const mockedGetDetails = vi.mocked(getDetails)

async function imageBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 500, height: 750, channels: 4, background: "#101010" } }).png().toBuffer()
}

function autoUrl(id: number, lang: string): string {
  return `http://localhost:3000/api/poster/movie/${id}?api_key=k&lang=${lang}&logoFit=0&debug=1`
}

async function getDebug(url: string) {
  const res = await GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: url.match(/\/movie\/(\d+)/)?.[1] ?? "0" }) })
  expect(res.status).toBe(200)
  return res.json()
}

describe("GET /api/poster session cache language isolation (Phase 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // vi.restoreAllMocks() does not clear history of the vi.mock() factory
    // fns: reset per-test counts so A->B->A assertions are isolated.
    mockedGetDetailsWithExternalIds.mockClear()
    mockedGetImages.mockClear()
    mockedGetDetails.mockClear()
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    cacheClear()
    __resetTMDBSessionCache()
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
    vi.unstubAllGlobals()
  })

  it("A(it) -> B(fr): the second language renders its own data, not a stale hit", async () => {
    const poster = await imageBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(getAll).mockResolvedValue([])
    vi.mocked(getById).mockResolvedValue(null)
    vi.mocked(getImdbAlias).mockResolvedValue(null)
    vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null })

    const first = await getDebug(autoUrl(777, "it"))
    expect(first.images.poster).toBe("/clean-it.jpg")
    expect(first.images.logo).toBe("/it-logo.png")
    expect(first.logoSelection.requestedLang).toBe("it")
    expect(first.logoSelection.usedLang).toBe("it")
    expect(first.genre.name).toBe("Dramma")
    expect(first.vote.average).toBe(7.1)
    expect(mockedGetDetailsWithExternalIds).toHaveBeenCalledTimes(1)
    expect(mockedGetImages).toHaveBeenCalledTimes(1)

    // Same process, session cache populated by the IT request: FR must refetch.
    const second = await getDebug(autoUrl(777, "fr"))
    expect(second.images.poster).toBe("/clean-fr.jpg")
    expect(second.images.logo).toBe("/fr-logo.png")
    expect(second.logoSelection.requestedLang).toBe("fr")
    expect(second.logoSelection.usedLang).toBe("fr")
    expect(second.genre.name).toBe("Drame")
    expect(second.vote.average).toBe(8.3)
    expect(mockedGetDetailsWithExternalIds).toHaveBeenCalledTimes(2)
    expect(mockedGetImages).toHaveBeenCalledTimes(2)
  })

  it("B(fr) -> A(it): the first language is reused without refetch", async () => {
    const poster = await imageBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(getAll).mockResolvedValue([])
    vi.mocked(getById).mockResolvedValue(null)
    vi.mocked(getImdbAlias).mockResolvedValue(null)
    vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null })

    await getDebug(autoUrl(777, "it"))
    await getDebug(autoUrl(777, "fr"))
    expect(mockedGetDetailsWithExternalIds).toHaveBeenCalledTimes(2)

    // Poster runtime cache cleared, session cache kept: IT must be a session hit.
    cacheClear()
    const back = await getDebug(autoUrl(777, "it"))
    expect(back.images.poster).toBe("/clean-it.jpg")
    expect(back.vote.average).toBe(7.1)
    expect(mockedGetDetailsWithExternalIds).toHaveBeenCalledTimes(2)
    expect(mockedGetImages).toHaveBeenCalledTimes(2)

    // Repeated same-language request: still a hit.
    cacheClear()
    const again = await getDebug(autoUrl(777, "fr"))
    expect(again.images.poster).toBe("/clean-fr.jpg")
    expect(mockedGetDetailsWithExternalIds).toHaveBeenCalledTimes(2)
    expect(mockedGetImages).toHaveBeenCalledTimes(2)
  })

  it("landscape fallback isolates languages: IT first, then FR renders its own backdrop", async () => {
    const poster = await imageBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
      headers: { "content-type": "image/png" },
    }))
    vi.mocked(getAll).mockResolvedValue([])
    // Saved mapping without backdrop: the 16:9 base needs the live fallback,
    // which must query TMDB in the requested language (query wins over mapping).
    vi.mocked(getById).mockResolvedValue({
      tmdbId: 778, mediaType: "movie", title: "Mapped Landscape",
      posterPath: "/m778.jpg", logoPath: null, originalPosterPath: null,
      language: "it", showBadges: false, rankingBadges: false,
      updatedAt: "2026-09-20T00:00:00.000Z",
    })
    vi.mocked(getImdbAlias).mockResolvedValue(null)
    vi.mocked(getExternalIds).mockResolvedValue({ imdb_id: null })

    const itUrl = "http://localhost:3000/api/poster/movie/778?api_key=k&lang=it&shape=landscape&logoFit=0&debug=1"
    const frUrl = "http://localhost:3000/api/poster/movie/778?api_key=k&lang=fr&shape=landscape&logoFit=0&debug=1"

    // Same process, IT fallback first: the live backdrop is the IT one.
    const itRes = await getDebug(itUrl)
    expect(itRes.meta.shape).toBe("landscape")
    expect(itRes.images.backdrop).toBe("/bd-it.jpg")
    const itCalls = mockedGetDetails.mock.calls.length
    expect(itCalls).toBeGreaterThan(0)
    expect(mockedGetDetails.mock.calls.map((c) => c[2] as string).every((l) => l === "it")).toBe(true)

    // FR must not reuse the IT fallback entry: it refetches in French and the
    // rendered/debug backdrop is the FR one.
    const frRes = await getDebug(frUrl)
    expect(frRes.meta.shape).toBe("landscape")
    expect(frRes.images.backdrop).toBe("/bd-fr.jpg")
    const frCalls = mockedGetDetails.mock.calls.slice(itCalls).map((c) => c[2] as string)
    expect(frCalls.length).toBeGreaterThan(0)
    expect(frCalls.every((l) => l === "fr")).toBe(true)

    // Poster cache cleared, session kept: the FR fallback must not refetch.
    cacheClear()
    const frAgain = await getDebug(frUrl)
    expect(frAgain.meta.shape).toBe("landscape")
    expect(frAgain.images.backdrop).toBe("/bd-fr.jpg")
    expect(mockedGetDetails.mock.calls.length).toBe(itCalls + frCalls.length)
  })
})
