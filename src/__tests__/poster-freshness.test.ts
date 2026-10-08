import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getDetails, getImages, getExternalIds } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear, cacheExpire } from "@/lib/cache"
import { resolveStreamQuality } from "@/lib/stream-quality"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { renderRankingBadge } from "@/lib/svg-badge"
import * as runtimeCache from "@/lib/poster-runtime-cache"
import { RENDER_VERSION } from "@/lib/render-version"

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
  // La route legge i default globali via getServerDefaultsChecked (revisione
  // epoch): nei test delega allo stesso mock controllabile.
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))

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

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(),
  getImages: vi.fn(),
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

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

const mockedGetById = vi.mocked(getById)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedFetchMDBList = vi.mocked(fetchMDBList)
const mockedRenderRankingBadge = vi.mocked(renderRankingBadge)

async function imageBuffer(color: string, width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: color },
  }).png().toBuffer()
}

const UPDATED_AT = "2026-09-12T00:00:00.000Z"
const MV = Date.parse(UPDATED_AT)

// Fixture: mapping salvato con ranking live. Il badge è rosso per rank 1 e
// blu per rank 2, così il cambio dei byte è verificabile senza servizi reali.
async function freshnessFixture(id: number, opts?: { ranking?: boolean; format?: string; live?: boolean; versioned?: boolean; resetCache?: boolean }) {
  const { ranking = true, format = "webp", live = false, versioned = true, resetCache = true } = opts ?? {}
  if (resetCache) cacheClear()
  mockedGetById.mockResolvedValue({
    tmdbId: id, mediaType: "movie", title: "Freshness", posterPath: "/fresh.jpg",
    logoPath: null, originalPosterPath: null, language: "it",
    showBadges: true, rankingBadges: ranking, trendRank: 1, updatedAt: UPDATED_AT,
  })
  mockedGetDetails.mockResolvedValue({ id, genres: [], vote_average: 5, vote_count: 10 })
  mockedGetExternalIds.mockResolvedValue({ imdb_id: `tt${id}` })
  mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: id, rank: 1 } as never])
  mockedFetchMDBList.mockReset().mockResolvedValue([])
  const poster = await imageBuffer("#101010", 500, 750)
  const red = await imageBuffer("#ff0000", 100, 30)
  const blue = await imageBuffer("#0000ff", 100, 30)
  mockedRenderRankingBadge.mockReset().mockImplementation(async (rank: unknown) => ({
    png: rank === 1 ? red : blue, w: 100, h: 30,
  }) as never)
  const mockedScheduleRefresh = vi.spyOn(runtimeCache, "schedulePosterRefresh").mockImplementation(() => {})
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(poster), {
    headers: { "content-type": "image/png" },
  }))
  const params = new URLSearchParams({ mv: String(MV), fmt: format, ranking: ranking ? "1" : "0" })
  if (live) params.set("live", "1")
  if (versioned) params.set("rv", RENDER_VERSION)
  const base = `http://localhost:3000/api/poster/movie/${id}?${params.toString()}`
  const request = (etag?: string) => GET(new NextRequest(base, {
    headers: etag ? { "If-None-Match": etag } : {},
  }), { params: Promise.resolve({ type: "movie", id: String(id) }) })
  return { request, refresh: mockedScheduleRefresh }
}

describe("poster freshness: ETag represents the actual bytes (audit problem 1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("different live rank produces different bytes and a different ETag", async () => {
    const { request } = await freshnessFixture(920001)
    const first = await request()
    expect(first.status).toBe(200)
    const oldBody = Buffer.from(await first.arrayBuffer())
    const oldEtag = first.headers.get("etag")!
    cacheClear()
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: 920001, rank: 2 } as never])
    mockedRenderRankingBadge.mockClear()
    const second = await request()
    expect(second.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    expect(Buffer.from(await second.arrayBuffer()).equals(oldBody)).toBe(false)
    expect(second.headers.get("etag")).not.toBe(oldEtag)
  })

  it("rank change bypasses a still-fresh internal poster without clearing the cache", async () => {
    const id = 920030
    const { request } = await freshnessFixture(id)
    const first = await request()
    expect(first.status).toBe(200)
    const oldBody = Buffer.from(await first.arrayBuffer())
    const oldEtag = first.headers.get("etag")!
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: id, rank: 2 } as never])
    mockedRenderRankingBadge.mockClear()

    const changed = await request(oldEtag)
    expect(changed.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    expect(changed.headers.get("etag")).not.toBe(oldEtag)
    expect(Buffer.from(await changed.arrayBuffer()).equals(oldBody)).toBe(false)
  })

  it("leaving the chart removes the badge even with a fresh cached poster and a saved rank", async () => {
    const { request } = await freshnessFixture(920031)
    const first = await request()
    expect(first.status).toBe(200)
    expect(mockedRenderRankingBadge).toHaveBeenCalled()
    mockedGetJWRankings.mockResolvedValue([])
    mockedRenderRankingBadge.mockClear()

    const changed = await request(first.headers.get("etag")!)
    expect(changed.status).toBe(200)
    expect(changed.headers.get("etag")).not.toBe(first.headers.get("etag"))
    expect(mockedRenderRankingBadge).not.toHaveBeenCalled()
  })

  it("a failed ranking lookup can restore the older saved rank instead of the last live rank", async () => {
    const id = 920032
    const { request } = await freshnessFixture(id)
    mockedGetJWRankings.mockResolvedValue([{ tmdbId: id, rank: 2 } as never])
    const first = await request()
    expect(first.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    mockedGetJWRankings.mockRejectedValue(new Error("Ranking source unavailable"))
    mockedRenderRankingBadge.mockClear()

    const changed = await request(first.headers.get("etag")!)
    expect(changed.status).toBe(200)
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(1)
    expect(changed.headers.get("etag")).not.toBe(first.headers.get("etag"))
  })

  it("cold conditional request resolves live data instead of exiting early", async () => {
    const { request } = await freshnessFixture(920002)
    const first = await request()
    expect(first.status).toBe(200)
    const etag = first.headers.get("etag")!
    // Cache interna vuota + validatore legacy (formato pre-fix): nessuna
    // uscita prematura, il ranking live viene interrogato.
    cacheClear()
    mockedGetJWRankings.mockClear().mockResolvedValue([{ tmdbId: 920002, rank: 1 } as never])
    mockedRenderRankingBadge.mockClear()
    const cold = await request('"mdeadbeef:2026-09-12T00:00:00.000Z"')
    expect(cold.status).toBe(200)
    expect(mockedGetJWRankings).toHaveBeenCalled()
    expect(mockedRenderRankingBadge).toHaveBeenCalled()
    expect(cold.headers.get("etag")).toBe(etag)
  })

  it("full sequence: poster, rank change, expiry, old ETag gives 200 + new ETag, then 304", async () => {
    const { request } = await freshnessFixture(920003)
    const first = await request()
    expect(first.status).toBe(200)
    const etag1 = first.headers.get("etag")!
    // Il ranking live cambia e la copia interna scade.
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: 920003, rank: 2 } as never])
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    const changed = await request(etag1)
    expect(changed.status).toBe(200)
    const etag2 = changed.headers.get("etag")!
    expect(etag2).not.toBe(etag1)
    // Contenuto invariato alla rivalidazione successiva → 304.
    const stable = await request(etag2)
    expect(stable.status).toBe(304)
  })
})

describe("poster freshness: stale entries revalidate before 304 (audit problem 2)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it.each(["webp", "jpeg"])("stale conditional %s with changed rank serves 200 with the new poster", async (format) => {
    const id = format === "webp" ? 920004 : 920005
    const { request, refresh } = await freshnessFixture(id, { format })
    const first = await request()
    expect(first.status).toBe(200)
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: id, rank: 2 } as never])
    mockedRenderRankingBadge.mockClear()
    const conditional = await request(first.headers.get("etag")!)
    // Mai 304 sulla copia scaduta: il contenuto è cambiato.
    expect(conditional.status).toBe(200)
    expect(mockedGetJWRankings).toHaveBeenCalled()
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    expect(conditional.headers.get("etag")).not.toBe(first.headers.get("etag"))
    // E nessun refresh differito al posto della rivalidazione sincrona.
    expect(refresh).not.toHaveBeenCalled()
  })

  it("stale conditional with unchanged content serves 304 only after revalidation", async () => {
    const { request } = await freshnessFixture(920006)
    const first = await request()
    expect(first.status).toBe(200)
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    mockedGetJWRankings.mockClear()
    mockedRenderRankingBadge.mockClear()
    const conditional = await request(first.headers.get("etag")!)
    expect(conditional.status).toBe(304)
    // La decisione arriva DOPO aver riletto i dati live, non dal fast-path.
    expect(mockedGetJWRankings).toHaveBeenCalled()
  })

  it("fresh conditional match serves 304 without rendering", async () => {
    const { request } = await freshnessFixture(920007)
    const first = await request()
    expect(first.status).toBe(200)
    mockedGetJWRankings.mockClear()
    mockedRenderRankingBadge.mockClear()
    mockedGetDetails.mockClear()
    mockedGetImages.mockClear()
    mockedGetExternalIds.mockClear()
    mockedFetchMDBList.mockClear()
    const conditional = await request(first.headers.get("etag")!)
    expect(conditional.status).toBe(304)
    // Preflight rank voluto (contratto ranking-sync): UNA sola lookup per
    // calcolare chiave/ETag, con gli argomenti del chart condiviso —
    // nessuna generazione (render) e nessun fetch dati extra.
    expect(mockedGetJWRankings).toHaveBeenCalledTimes(1)
    expect(mockedGetJWRankings.mock.calls[0].slice(0, 5)).toEqual(["MOVIE", "IT", 20, undefined, "it-IT"])
    // Stessa famiglia: preflight anime per la chiave (la${preAnimeRank}).
    expect(mockedFetchMDBList).toHaveBeenCalledTimes(1)
    expect(mockedFetchMDBList.mock.calls[0].slice(0, 2)).toEqual(["mdblistAnimeMovie", undefined])
    expect(mockedRenderRankingBadge).not.toHaveBeenCalled()
    expect(mockedGetDetails).not.toHaveBeenCalled()
    expect(mockedGetImages).not.toHaveBeenCalled()
    expect(mockedGetExternalIds).not.toHaveBeenCalled()
  })

  it("fresh conditional mismatch serves 200 with the available copy", async () => {
    const { request } = await freshnessFixture(920008)
    const first = await request()
    expect(first.status).toBe(200)
    const other = await request('"non-matching-etag"')
    expect(other.status).toBe(200)
    expect(other.headers.get("etag")).toBe(first.headers.get("etag"))
  })

  it.each(["webp", "jpeg"])("stale unconditional %s keeps SWR outside live (copy + scheduled refresh)", async (format) => {
    const id = format === "webp" ? 920009 : 920010
    const { request, refresh } = await freshnessFixture(id, { format })
    const first = await request()
    expect(first.status).toBe(200)
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    const plain = await request()
    expect(plain.status).toBe(200)
    expect(plain.headers.get("etag")).toBe(first.headers.get("etag"))
    expect(refresh).toHaveBeenCalled()
  })
})

describe("poster freshness: no annual immutable for mutable posters (audit problems 3-4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("saved poster with live ranking uses a finite policy on 200 and 304", async () => {
    const { request } = await freshnessFixture(920011)
    const res = await request()
    expect(res.status).toBe(200)
    expect(mockedRenderRankingBadge).toHaveBeenCalled()
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(1)
    for (const response of [res, await request(res.headers.get("etag")!)]) {
      const policy = response.headers.get("cache-control")!
      expect(policy).not.toContain("immutable")
      expect(policy).not.toContain("max-age=31536000")
    }
  })

  it("unversioned request does not inherit immutable from the versioned entry", async () => {
    const { request } = await freshnessFixture(920012, { ranking: false })
    const first = await request()
    expect(first.status).toBe(200)
    const { request: unversionedRequest } = await freshnessFixture(920012, { ranking: false, versioned: false, resetCache: false })
    mockedGetJWRankings.mockClear()
    const unversioned = await unversionedRequest()
    expect(unversioned.status).toBe(200)
    expect(mockedGetJWRankings).not.toHaveBeenCalled()
    expect(unversioned.headers.get("cache-control")).not.toContain("immutable")
    const conditional = await unversionedRequest(first.headers.get("etag")!)
    expect(conditional.headers.get("cache-control")).not.toContain("immutable")
  })

  it("degraded entry keeps the short TTL and no immutable on 200 and 304", async () => {
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: null, status: "timeout", source: "torrentio" })
    const { request } = await freshnessFixture(920013, { ranking: false })
    const first = await request()
    expect(first.status).toBe(200)
    for (const response of [first, await request(first.headers.get("etag")!)]) {
      const policy = response.headers.get("cache-control")!
      expect(policy).toContain("max-age=120")
      expect(policy).not.toContain("immutable")
      expect(policy).not.toContain("max-age=31536000")
    }
    vi.mocked(resolveStreamQuality).mockReset()
  })

  it("reconverted variant preserves the degraded canonical TTL", async () => {
    vi.mocked(resolveStreamQuality).mockResolvedValue({ quality: null, status: "timeout", source: "torrentio" })
    try {
      const { request } = await freshnessFixture(920019, { ranking: false, format: "jpeg" })
      const writes = vi.spyOn(runtimeCache, "writeCachedPoster")
      const first = await request()
      expect(first.status).toBe(200)
      const variantKey = writes.mock.calls.find(([key]) => key.endsWith(":fmtjpeg"))?.[0]
      expect(variantKey).toBeDefined()
      expect(cacheExpire(variantKey!)).toBeGreaterThan(0)
      const converted = await request(first.headers.get("etag")!)
      expect(converted.status).toBe(304)
      expect(converted.headers.get("cache-control")).toContain("max-age=120")
      expect(runtimeCache.readCachedPoster(variantKey!).ttlSec).toBe(120)
    } finally {
      vi.mocked(resolveStreamQuality).mockReset()
    }
  })
})

describe("poster freshness: representation-specific validators (webp/jpeg/avif)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("conditional with the variant ETag gives 304; canonical ETag on a variant URL gives 200", async () => {
    const jpeg = await freshnessFixture(920014, { format: "jpeg" })
    const firstJpeg = await jpeg.request()
    expect(firstJpeg.status).toBe(200)
    const jpegEtag = firstJpeg.headers.get("etag")!
    expect(await jpeg.request(jpegEtag)).toHaveProperty("status", 304)
    // Il validatore canonico (webp) non viene confuso con quello della variante.
    const webp = await freshnessFixture(920014, { format: "webp" })
    const firstWebp = await webp.request()
    expect(firstWebp.status).toBe(200)
    const webpEtag = firstWebp.headers.get("etag")!
    expect(webpEtag).not.toBe(jpegEtag)
    expect(await jpeg.request(webpEtag)).toHaveProperty("status", 200)
  })

  it("explicit avif renders its own bytes with its own validator", async () => {
    const { request } = await freshnessFixture(920015, { format: "avif" })
    const res = await request()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("image/avif")
    const avifEtag = res.headers.get("etag")!
    const jpeg = await freshnessFixture(920015, { format: "jpeg" })
    const jpegRes = await jpeg.request()
    expect(jpegRes.headers.get("etag")).not.toBe(avifEtag)
    expect(await request(avifEtag)).toHaveProperty("status", 304)
    expect(await request(jpegRes.headers.get("etag")!)).toHaveProperty("status", 200)
  }, 30000)
})

describe("poster freshness: live=1 revalidates on every path", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("stale live entry is never served: unconditional revalidates synchronously", async () => {
    const { request, refresh } = await freshnessFixture(920016, { live: true })
    const first = await request()
    expect(first.status).toBe(200)
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    mockedGetJWRankings.mockReset().mockResolvedValue([{ tmdbId: 920016, rank: 2 } as never])
    mockedRenderRankingBadge.mockClear()
    const second = await request()
    expect(second.status).toBe(200)
    expect(second.headers.get("etag")).not.toBe(first.headers.get("etag"))
    expect(mockedRenderRankingBadge.mock.calls[0][0]).toBe(2)
    // Niente SWR deliberato sul percorso live.
    expect(refresh).not.toHaveBeenCalled()
    for (const response of [first, second]) {
      expect(response.headers.get("cache-control")).toBe("public, no-cache, max-age=0, must-revalidate")
    }
  })

  it("fresh live conditional gives 304 with the live policy", async () => {
    const { request } = await freshnessFixture(920017, { live: true })
    const first = await request()
    expect(first.status).toBe(200)
    const conditional = await request(first.headers.get("etag")!)
    expect(conditional.status).toBe(304)
    expect(conditional.headers.get("cache-control")).toBe("public, no-cache, max-age=0, must-revalidate")
    expect(conditional.headers.get("cdn-cache-control")).toBe("public, no-cache, max-age=0, must-revalidate")
  })
})

describe("poster freshness: concurrent conditionals share one render", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetTMDBSessionCache()
  })

  it.each([
    { format: "webp", degraded: false },
    { format: "webp", degraded: true },
    { format: "jpeg", degraded: true },
  ])("concurrent $format requests preserve policy (degraded=$degraded)", async ({ format, degraded }) => {
    __resetImageBytesForTest()
    const id = 920018
    cacheClear()
    mockedGetById.mockResolvedValue({
      tmdbId: id, mediaType: "movie", title: "Coalesced", posterPath: "/coal.jpg",
      logoPath: null, originalPosterPath: null, language: "it",
      showBadges: degraded, rankingBadges: false, updatedAt: UPDATED_AT,
    })
    vi.mocked(resolveStreamQuality).mockResolvedValue(degraded
      ? { quality: null, status: "timeout", source: "torrentio" }
      : { quality: null, status: "resolved", source: "torrentio" })
    mockedGetDetails.mockResolvedValue({ id, genres: [], vote_average: 5, vote_count: 10 })
    mockedGetExternalIds.mockResolvedValue({ imdb_id: `tt${id}` })
    mockedGetImages.mockResolvedValue({ id, posters: [], logos: [], backdrops: [] })
    const poster = await imageBuffer("#101010", 500, 750)
    let releaseFetch!: (v: Response) => void
    const fetchGate = new Promise<Response>((resolve) => { releaseFetch = resolve })
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => fetchGate)
    const url = `http://localhost:3000/api/poster/movie/${id}?mv=${MV}&rv=${RENDER_VERSION}&ranking=0&fmt=${format}`
    const get = () => GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: String(id) }) })
    const pending1 = get()
    // Attende che la prima richiesta arrivi al fetch immagine (render
    // registrato in inflight), poi parte la seconda.
    const deadline = Date.now() + 5000
    while (fetchSpy.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0)
    const pending2 = get()
    await new Promise((r) => setTimeout(r, 10))
    releaseFetch(new Response(new Uint8Array(poster), { headers: { "content-type": "image/png" } }))
    const [res1, res2] = await Promise.all([pending1, pending2])
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    expect(res2.headers.get("etag")).toBe(res1.headers.get("etag"))
    if (degraded) {
      expect(res1.headers.get("cache-control")).toContain("max-age=120")
      expect(res2.headers.get("cache-control")).toContain("max-age=120")
    }
    // Un solo fetch immagine: il secondo waiter si è coalesced, non ha
    // duplicato il render.
    expect(fetchSpy.mock.calls.length).toBe(1)
    vi.mocked(resolveStreamQuality).mockReset()
  }, 30000)
})
