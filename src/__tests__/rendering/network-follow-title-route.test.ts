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
  // Fresh/Card compositors rasterize their own vectors: a tile matching the
  // SVG's own declared size keeps the layout math real (crops) without a
  // second renderer in the fixture.
  const renderSVG = async (svg: string, w: number) => {
    const declaredW = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 0)
    const declaredH = Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? 0)
    const width = Math.max(1, Math.round(w || declaredW))
    const height = Math.max(1, Math.round(declaredH && declaredW ? (declaredH * width) / declaredW : width))
    return sharp({ create: { width, height, channels: 4, background: "#ffffff" } }).png().toBuffer()
  }
  return {
    renderSVG,
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
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})
vi.mock("@/lib/imdb-resolver", () => ({ resolveImdbToTmdb: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-cache", () => ({ resolveWikidataId: vi.fn(async () => null) }))
vi.mock("@/lib/imdb-top250", () => ({ isImdbTop250: vi.fn(async () => false), isImdbTop100: vi.fn(async () => false) }))
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

/**
 * Badge geometry for the Settings drag handles (`debug=1&netgeo=1`): the boxes
 * are the ones this renderer actually composed, the top slot names the layout
 * it painted (rank vs extra/fallback) and an offset moves the reported box by
 * exactly the stored px (the slope-1 contract the client drag math relies on).
 */
describe("GET /api/poster debug badge geometry", () => {
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

  type Badges = {
    canvasW: number
    canvasH: number
    layout: "ranked" | "fallback"
    kind: "rank" | "extra" | null
    families: Record<string, { top: number; left: number; w: number; h: number }>
    fixedX: Record<string, boolean>
  }
  const badgesOf = (body: Record<string, unknown>): Badges => body.badges as Badges

  it("reports the rendered canvas and never invents a top-slot box", async () => {
    const { status, body } = await getDebugGeo("")
    expect(status).toBe(200)
    const badges = badgesOf(body)
    expect(badges.canvasW).toBe(500)
    expect(badges.canvasH).toBe(750)
    // No rank data and no custom extra in this fixture: the without-ranking
    // whole-poster layout is displayed, with no top badge box.
    expect(badges.layout).toBe("fallback")
    expect(badges.kind).toBeNull()
    expect(badges.families.rank).toBeUndefined()
    expect(badges.families.extra).toBeUndefined()
  })

  it("names the fallback layout when an extra badge is the one painted", async () => {
    const { status, body } = await getDebugGeo("&extra=Test%20Award")
    expect(status).toBe(200)
    const badges = badgesOf(body)
    expect(badges.layout).toBe("fallback")
    expect(badges.kind).toBe("extra")
    const extra = badges.families.extra
    expect(extra).toBeTruthy()
    expect(extra.w).toBeGreaterThan(0)
    expect(extra.h).toBeGreaterThan(0)
    expect(Number.isFinite(extra.top)).toBe(true)
    expect(Number.isFinite(extra.left)).toBe(true)
    expect(badges.families.rank).toBeUndefined()
  })

  it("names the ranked layout and moves the reported box by exactly the stored offset", async () => {
    // Non-ribbon ranking style: the Netflix ribbon deliberately ignores X/Y, so
    // it reports no rank box at all (fixed-layout exclusion, next test).
    const base = await getDebugGeo("&rank=7&rs=pill")
    expect(base.status).toBe(200)
    const baseBadges = badgesOf(base.body)
    expect(baseBadges.layout).toBe("ranked")
    expect(baseBadges.kind).toBe("rank")
    const baseRank = baseBadges.families.rank
    expect(baseRank).toBeTruthy()
    expect(baseBadges.families.extra).toBeUndefined()

    const shifted = await getDebugGeo("&rank=7&rs=pill&tox=40&toy=25")
    expect(shifted.status).toBe(200)
    const shiftedRank = badgesOf(shifted.body).families.rank
    // Client drag math: canvas-px delta == stored offset delta (same width).
    expect(shiftedRank.left - baseRank.left).toBe(40)
    expect(shiftedRank.top - baseRank.top).toBe(25)
    expect(shiftedRank.w).toBe(baseRank.w)
  })

  it("never reports a rank box when the ribbon anchor ignores the offsets", async () => {
    const ribbon = await getDebugGeo("&rank=7")
    expect(ribbon.status).toBe(200)
    const badges = badgesOf(ribbon.body)
    expect(badges.kind).toBe("rank")
    // Netflix/ribbon anchor: tox/toy are not applied, so no handle is offered.
    expect(badges.families.rank).toBeUndefined()
  })

  it("keeps the two layouts independent once the fallback profile is explicit", async () => {
    // Legacy fallback (no extra tuning): the extra badge follows the ranked
    // offsets axis by axis — the historic contract, unchanged.
    const legacyA = badgesOf((await getDebugGeo("&extra=Test%20Award")).body).families.extra
    const legacyB = badgesOf((await getDebugGeo("&extra=Test%20Award&tox=40&toy=25")).body).families.extra
    expect(legacyB.left - legacyA.left).toBe(40)

    // Complete fallback layout (exactly the triple the drag writes): its own
    // values win and the ranked offsets no longer move it.
    const explicitA = badgesOf((await getDebugGeo("&extra=Test%20Award&exscale=100&exox=0&exoy=0")).body).families.extra
    const explicitB = badgesOf((await getDebugGeo("&extra=Test%20Award&exscale=100&exox=0&exoy=0&tox=40&toy=25")).body).families.extra
    expect({ top: explicitB.top, left: explicitB.left }).toEqual({ top: explicitA.top, left: explicitA.left })
  })

  it("reports the landscape canvas for landscape renders", async () => {
    const res = await GET(
      new NextRequest(`${debugBase}&shape=landscape&debug=1&netgeo=1`),
      { params: Promise.resolve({ type: "movie", id: "44" }) },
    )
    expect(res.status).toBe(200)
    const badges = badgesOf((await res.json()) as Record<string, unknown>)
    expect(badges.canvasW).toBe(768)
    expect(badges.canvasH).toBe(432)
  })

  it("reports the composed title-logo box with the exact offset slope", async () => {
    // Standard layout: the logo bitmap IS composited by this renderer, so its
    // box is authoritative for the drag handles.
    const base = badgesOf((await getDebugGeo("")).body)
    const logo = base.families.logo
    expect(logo).toBeTruthy()
    expect(logo.w).toBeGreaterThan(0)
    expect(logo.h).toBeGreaterThan(0)
    const shifted = badgesOf((await getDebugGeo("&ox=40&oy=25")).body).families.logo
    expect(shifted.left - logo.left).toBe(40)
    expect(shifted.top - logo.top).toBe(25)
    expect(shifted.w).toBe(logo.w)
  })

  it("reports the Fresh composed layers (numeral, meta, provider, logo) and the exact offset slope", async () => {
    // The numeral's own rim can be clipped at the left canvas edge with a
    // neutral X, so the slope is measured between two in-canvas positions.
    const fresh = badgesOf((await getDebugGeo("&layout=fresh&rank=7&tox=100")).body)
    expect(fresh.layout).toBe("ranked")
    expect(fresh.kind).toBe("rank")
    // The numeral (rank family) and the title are both composed by the Fresh
    // compositor: authoritative boxes for every handle.
    expect(fresh.families.rank).toBeTruthy()
    expect(fresh.families.logo).toBeTruthy()
    const shifted = badgesOf((await getDebugGeo("&layout=fresh&rank=7&ox=-20&oy=-10&tox=200&toy=8")).body)
    expect(shifted.families.logo!.left - fresh.families.logo!.left).toBe(-20)
    expect(shifted.families.logo!.top - fresh.families.logo!.top).toBe(-10)
    expect(shifted.families.rank!.left - fresh.families.rank!.left).toBe(100)
    expect(shifted.families.rank!.top - fresh.families.rank!.top).toBe(8)
  })

  it("reports the Fresh without-ranking layout as a complete fallback composition", async () => {
    const fresh = badgesOf((await getDebugGeo("&layout=fresh")).body)
    expect(fresh.layout).toBe("fallback")
    expect(fresh.kind).toBeNull()
    expect(fresh.families.rank).toBeUndefined()
    // The fixture has no meta rows in this composition: the title logo is
    // still reported from the real fallback placement (never a guessed box).
    expect(fresh.families.logo).toBeTruthy()
  })

  it("reports the Card composed layers and applies the same user offsets", async () => {
    const card = badgesOf((await getDebugGeo("&layout=nuvio&rank=7")).body)
    expect(card.layout).toBe("ranked")
    expect(card.kind).toBe("rank")
    expect(card.families.logo).toBeTruthy()
    expect(card.families.network).toBeTruthy()
    const shifted = badgesOf((await getDebugGeo("&layout=nuvio&rank=7&ox=40&oy=25&nox=6&noy=-4")).body)
    expect(shifted.families.logo!.left - card.families.logo!.left).toBe(40)
    expect(shifted.families.logo!.top - card.families.logo!.top).toBe(25)
    expect(shifted.families.network!.left - card.families.network!.left).toBe(6)
    expect(shifted.families.network!.top - card.families.network!.top).toBe(-4)
  })
})
