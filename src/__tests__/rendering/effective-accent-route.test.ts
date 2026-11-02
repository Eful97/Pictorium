/**
 * Effective-accent route branch (Stage 1, server-only): `?accentmeta=1`
 * through the SAME real handler as the image.
 *
 * Fixture pattern mirrors `poster-route-mapping.test.ts` (upstream mocked,
 * deterministic scene bytes, no creds/network) with two deliberate deltas:
 * `svg-badge` is NOT mocked (real badge bitmaps — the metadata must prove
 * the actual painted fills) and `poster-service.generatePosterBuffer` is
 * wrapped (real implementation, call-counted) to prove render sharing.
 *
 * - image + accentmeta URLs compute the canonical key identically (only the
 *   diagnostic flag differs; preview/tl/bl/config untouched);
 * - cold metadata → 202 unknown with zero renders and zero slots;
 * - image completed before metadata arrival → 200 with the same hex;
 * - overlapping image + metadata → exactly one real generate, shared;
 * - failures/negative → 202 unknown, never a render or slot acquisition;
 * - 304/image-body/PNG-header behavior unchanged; response carries no
 *   secrets and only the minimal field set.
 * - stale sidecars are never served (fresh-only guard): an expired entry
 *   answers 202 unknown (or the current inflight/completed record), while
 *   the image keeps its existing SWR behavior byte-for-byte.
 */
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getAll, getById, getImdbAlias } from "@/lib/store"
import { resolveImdbToTmdb } from "@/lib/imdb-resolver"
import { selectBestLogoFitPosterPath } from "@/lib/poster-auto-fit"
import { getServerDefaults } from "@/lib/server-defaults"
import { getDetails, getDetailsWithExternalIds, getImages, getExternalIds } from "@/lib/tmdb"
import { getJWRankings } from "@/lib/justwatch"
import { fetchMDBList } from "@/lib/mdblist"
import { cacheClear, cacheExpire } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { resolveStreamQuality } from "@/lib/stream-quality"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { fetchCustomRatings } from "@/lib/custom-rating"
import { fetchAllWikidata } from "@/lib/awards"
import { fetchAggregatedRating } from "@/lib/ratings"
import { generatePosterBuffer } from "@/lib/poster-service"
import { __resetCompletedAccentForTests } from "@/lib/poster-runtime-cache"
import {
  ACCENT_META_HEADER,
  parseEffectiveAccentHeader,
} from "@/lib/effective-accent"
import { POSTER_CACHE_ALLOWLIST } from "@/lib/poster-params-hardening"
import * as hardening from "@/lib/poster-params-hardening"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"

vi.mock("@/lib/poster-service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-service")>()
  return { ...mod, generatePosterBuffer: vi.fn(mod.generatePosterBuffer) }
})

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
  const mocked = vi.fn(() => ({
    defaultLogoFitEnabled: true,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
  }))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))

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

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(
    async (
      mediaType: "movie" | "tv",
      tmdbId: number,
      language?: string,
      apiKey?: string,
      signal?: AbortSignal,
      timeoutMs?: number,
    ) => {
      const det = await mockedGetDetails(mediaType, tmdbId, language, apiKey, signal, timeoutMs)
      const ext = await mockedGetExternalIds(mediaType, tmdbId, apiKey, signal, timeoutMs)
      return { ...det, external_ids: ext }
    },
  ),
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
const mockedGetDetails = vi.mocked(getDetails)
const mockedGetImages = vi.mocked(getImages)
const mockedGetExternalIds = vi.mocked(getExternalIds)
const mockedGenerate = vi.mocked(generatePosterBuffer)

void getAll
void getImdbAlias
void resolveImdbToTmdb
void selectBestLogoFitPosterPath
void getServerDefaults
void getDetailsWithExternalIds
void getJWRankings
void fetchMDBList
void resolveStreamQuality
void fetchCustomRatings
void fetchAllWikidata
void fetchAggregatedRating

/** Deterministic scene: The Boys-ish teal base, dark top / light bottom bands. */
async function sceneBuffer(): Promise<Buffer> {
  const w = 500
  const h = 750
  const stripH = Math.round(h * 0.08)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="rgb(78,128,135)"/>` +
    `<rect width="${w}" height="${stripH}" fill="rgb(14,16,26)"/>` +
    `<rect y="${h - stripH}" width="${w}" height="${stripH}" fill="rgb(236,231,216)"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}

function savedMapping(tmdbId: number) {
  return {
    tmdbId,
    mediaType: "movie" as const,
    title: "Accent Stage",
    posterPath: "/accent-stage.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    showBadges: true,
    rankingBadges: true,
    updatedAt: "2026-10-01T00:00:00.000Z",
  }
}

function armUpstream(scene: Buffer) {
  mockedGetDetails.mockResolvedValue({
    id: 0,
    title: "Accent Stage",
    genres: [{ id: 35, name: "Comedy" }],
    vote_average: 7.5,
    vote_count: 100,
    original_language: "en",
    release_date: "2024-03-10",
    production_companies: [],
  })
  mockedGetImages.mockResolvedValue({ id: 0, posters: [], logos: [], backdrops: [] })
  mockedGetExternalIds.mockResolvedValue({ imdb_id: null })
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(scene), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  }))
}

const imgUrl = (id: number, extra = "") =>
  `http://localhost:3000/api/poster/movie/${id}?bs=colored&extra=NEW&xbs=colored${extra}`
const metaUrl = (id: number, extra = "") => `${imgUrl(id, extra)}&accentmeta=1`

describe("GET accentmeta branch (same real handler)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Free (private) mode: the global setup simulates shared hosting
    // (HOSTED_BY=elfhosted → presets hardening would strip free-text `extra`
    // and non-palette `ac`). These vectors need the raw query chain.
    vi.spyOn(hardening, "isPresetsPosterMode").mockReturnValue(false)
    vi.spyOn(hardening, "isPublicPosterInstance").mockReturnValue(false)
    vi.spyOn(hardening, "isPreviewAuthRequired").mockReturnValue(false)
    __resetImageBytesForTest()
    mockedGenerate.mockClear()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetCompletedAccentForTests()
    __resetTMDBSessionCache()
  })

  it("allowlist carries accentmeta and only it is stripped from the canonical key", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("accentmeta")).toBe(true)
    const withFlag = new URLSearchParams("bs=colored&preview=1&tl=1&bl=0&config=abc&accentmeta=1")
    const withoutFlag = new URLSearchParams("bs=colored&preview=1&tl=1&bl=0&config=abc")
    // Route strips accentmeta before normalize (mirror of the L479 pattern).
    withFlag.delete("accentmeta")
    const a = normalizePosterCacheParams(withFlag)
    const b = normalizePosterCacheParams(withoutFlag)
    expect(a.toString()).toBe(b.toString())
    // Nothing else is stripped: preview/tl/bl survive normalization.
    expect(a.get("preview")).toBe("1")
    expect(a.get("tl")).toBe("1")
    expect(a.get("bl")).toBe("0")
  })

  it("cold metadata answers 202 unknown with zero renders", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71001))
    const res = await GET(new NextRequest(metaUrl(71001)), {
      params: Promise.resolve({ type: "movie", id: "71001" }),
    })
    expect(res.status).toBe(202)
    expect(mockedGenerate).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body.status).toBe("unknown")
    expect(body.genreHex).toBeNull()
    expect(body.rankHex).toBeNull()
    expect(body.provGenre).toBe("unknown")
    expect(body.provRank).toBe("unknown")
    // Minimal field set, no secrets.
    expect(Object.keys(body).sort()).toEqual(
      ["genreHex", "genrePaints", "gradientHex", "gradientPaints", "provGradient", "provGenre", "provRank", "rankHex", "status", "topPaints", "topType"].sort(),
    )
    expect(JSON.stringify(body)).not.toContain("api_key")
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(res.headers.get("Content-Type")).toContain("application/json")
  })

  it("image completed before metadata arrival returns 200 with the same hex (non-preview sidecar)", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71002))
    const img = await GET(new NextRequest(imgUrl(71002)), {
      params: Promise.resolve({ type: "movie", id: "71002" }),
    })
    expect(img.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    const firstMeta = await GET(new NextRequest(metaUrl(71002)), {
      params: Promise.resolve({ type: "movie", id: "71002" }),
    })
    expect(firstMeta.status).toBe(200)
    const first = await firstMeta.json()
    expect(first.status).toBe("ready")
    expect(first.genreHex).toMatch(/^#[0-9a-f]{6}$/)
    expect(first.rankHex).toMatch(/^#[0-9a-f]{6}$/)
    expect(first.genrePaints).toBe(true)
    expect(first.topPaints).toBe(true)
    expect(first.topType).toBe("extra")
    // Warm repeat: same hex, still no new render.
    const secondMeta = await GET(new NextRequest(metaUrl(71002)), {
      params: Promise.resolve({ type: "movie", id: "71002" }),
    })
    expect(secondMeta.status).toBe(200)
    expect(await secondMeta.json()).toEqual(first)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })

  it("late preview subscriber reads the completed record (preview PNG stays no-store)", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71003))
    const img = await GET(new NextRequest(imgUrl(71003, "&preview=1")), {
      params: Promise.resolve({ type: "movie", id: "71003" }),
    })
    expect(img.status).toBe(200)
    expect(img.headers.get("Cache-Control")).toContain("no-store")
    // Inflight is gone and nothing was persisted — the late fetch still
    // resolves from the completed record written before completion.
    const meta = await GET(new NextRequest(metaUrl(71003, "&preview=1")), {
      params: Promise.resolve({ type: "movie", id: "71003" }),
    })
    expect(meta.status).toBe(200)
    const body = await meta.json()
    expect(body.status).toBe("ready")
    expect(body.genreHex).toMatch(/^#[0-9a-f]{6}$/)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })

  it("overlapping image + metadata share one real generate", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71004))
    const [img, meta] = await Promise.all([
      GET(new NextRequest(imgUrl(71004)), {
        params: Promise.resolve({ type: "movie", id: "71004" }),
      }),
      GET(new NextRequest(metaUrl(71004)), {
        params: Promise.resolve({ type: "movie", id: "71004" }),
      }),
    ])
    expect(img.status).toBe(200)
    expect(meta.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect((await meta.json()).status).toBe("ready")
  })

  it("failures answer 202 unknown without rendering or slotting", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71005))
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 404 }))
    const img = await GET(new NextRequest(imgUrl(71005)), {
      params: Promise.resolve({ type: "movie", id: "71005" }),
    })
    expect(img.status).toBe(404)
    const callsAfterImage = mockedGenerate.mock.calls.length
    const meta = await GET(new NextRequest(metaUrl(71005)), {
      params: Promise.resolve({ type: "movie", id: "71005" }),
    })
    expect(meta.status).toBe(202)
    expect(await meta.json()).toMatchObject({ status: "unknown" })
    expect(mockedGenerate.mock.calls.length).toBe(callsAfterImage)
  })

  it("normal image 304/body/headers behavior is unchanged", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71006))
    const first = await GET(new NextRequest(imgUrl(71006)), {
      params: Promise.resolve({ type: "movie", id: "71006" }),
    })
    expect(first.status).toBe(200)
    const etag = first.headers.get("etag")
    expect(etag).toBeTruthy()
    expect(first.headers.get("Content-Type")).toContain("image/")
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe("*")
    const body = Buffer.from(await first.arrayBuffer())
    expect(body.length).toBeGreaterThan(1000)
    const cond = await GET(
      new NextRequest(imgUrl(71006), { headers: { "If-None-Match": etag! } }),
      { params: Promise.resolve({ type: "movie", id: "71006" }) },
    )
    expect(cond.status).toBe(304)
    // The metadata branch keeps its own JSON validator (never the PNG ETag).
    const meta = await GET(
      new NextRequest(metaUrl(71006), { headers: { "If-None-Match": etag! } }),
      { params: Promise.resolve({ type: "movie", id: "71006" }) },
    )
    expect(meta.status).toBe(200)
    expect(meta.headers.get("ETag")).not.toBe(etag)
  })

  it("invented user namespaces collapse to anon without leaking (existing policy, no new rules)", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71007))
    const img = await GET(new NextRequest(`${imgUrl(71007)}&u=00000000-0000-4000-8000-000000000000`), {
      params: Promise.resolve({ type: "movie", id: "71007" }),
    })
    expect(img.status).toBe(200)
    const meta = await GET(new NextRequest(`${metaUrl(71007)}&u=00000000-0000-4000-8000-000000000000`), {
      params: Promise.resolve({ type: "movie", id: "71007" }),
    })
    // Same collapsed namespace as the image above: the sidecar/completed
    // record written by the image request is readable here.
    expect(meta.status).toBe(200)
    expect((await meta.json()).status).toBe("ready")
  })

  it("manual ac= is reported exactly through the real handler", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(71008))
    const img = await GET(
      new NextRequest(`${imgUrl(71008)}&ac=%23123456`),
      { params: Promise.resolve({ type: "movie", id: "71008" }) },
    )
    expect(img.status).toBe(200)
    const meta = await GET(
      new NextRequest(`${metaUrl(71008)}&ac=%23123456`),
      { params: Promise.resolve({ type: "movie", id: "71008" }) },
    )
    expect(meta.status).toBe(200)
    const body = await meta.json()
    expect(body.genreHex).toBe("#123456")
    expect(body.provGenre).toBe("manual")
  })
})

describe("GET accentmeta ignores stale sidecars (fresh-only guard)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Same free (private) mode as the suite above: raw query chain.
    vi.spyOn(hardening, "isPresetsPosterMode").mockReturnValue(false)
    vi.spyOn(hardening, "isPublicPosterInstance").mockReturnValue(false)
    vi.spyOn(hardening, "isPreviewAuthRequired").mockReturnValue(false)
    __resetImageBytesForTest()
    mockedGenerate.mockClear()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetCompletedAccentForTests()
    __resetTMDBSessionCache()
  })

  /** Second deterministic scene (yellow base): a hue far from the teal base. */
  async function yellowScene(): Promise<Buffer> {
    const w = 500
    const h = 750
    const stripH = Math.round(h * 0.08)
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="rgb(232,200,60)"/>` +
      `<rect width="${w}" height="${stripH}" fill="rgb(14,16,26)"/>` +
      `<rect y="${h - stripH}" width="${w}" height="${stripH}" fill="rgb(236,231,216)"/>` +
      `</svg>`
    return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
  }

  it("stale sidecar alone answers 202 unknown with zero renders (image SWR unchanged)", async () => {
    armUpstream(await sceneBuffer())
    mockedGetById.mockResolvedValue(savedMapping(72011))
    const img = await GET(new NextRequest(imgUrl(72011)), {
      params: Promise.resolve({ type: "movie", id: "72011" }),
    })
    expect(img.status).toBe(200)
    const etag = img.headers.get("etag")
    expect(etag).toBeTruthy()
    const warm = await GET(new NextRequest(metaUrl(72011)), {
      params: Promise.resolve({ type: "movie", id: "72011" }),
    })
    expect(warm.status).toBe(200)
    const oldHex = (await warm.json()).genreHex as string
    expect(oldHex).toMatch(/^#[0-9a-f]{6}$/)
    // Isolate the persisted sidecar: drop the short-lived completed record so
    // only the expired cache entry could answer with the old hex.
    __resetCompletedAccentForTests()
    // Force expiry without touching the payload (SWR staleness, not deletion).
    expect(cacheExpire("poster")).toBeGreaterThan(0)
    const staleMeta = await GET(new NextRequest(metaUrl(72011)), {
      params: Promise.resolve({ type: "movie", id: "72011" }),
    })
    expect(staleMeta.status).toBe(202)
    expect(await staleMeta.json()).toMatchObject({ status: "unknown", genreHex: null })
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    // Image behavior is unchanged: the same stale bytes still serve 200 via SWR.
    const staleImg = await GET(new NextRequest(imgUrl(72011)), {
      params: Promise.resolve({ type: "movie", id: "72011" }),
    })
    expect(staleImg.status).toBe(200)
    expect(staleImg.headers.get("etag")).toBe(etag)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })

  it("fresh sidecar answers 200 with the exact painted hex", async () => {
    armUpstream(await sceneBuffer())
    mockedGetById.mockResolvedValue(savedMapping(72012))
    const img = await GET(new NextRequest(imgUrl(72012)), {
      params: Promise.resolve({ type: "movie", id: "72012" }),
    })
    expect(img.status).toBe(200)
    const first = await GET(new NextRequest(metaUrl(72012)), {
      params: Promise.resolve({ type: "movie", id: "72012" }),
    })
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body.status).toBe("ready")
    expect(body.genreHex).toMatch(/^#[0-9a-f]{6}$/)
    expect(body.rankHex).toMatch(/^#[0-9a-f]{6}$/)
    const second = await GET(new NextRequest(metaUrl(72012)), {
      params: Promise.resolve({ type: "movie", id: "72012" }),
    })
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(body)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })

  it("stale sidecar plus a current inflight answers 200 with the NEW hex", async () => {
    armUpstream(await sceneBuffer())
    mockedGetById.mockResolvedValue(savedMapping(72013))
    const firstImg = await GET(new NextRequest(imgUrl(72013)), {
      params: Promise.resolve({ type: "movie", id: "72013" }),
    })
    expect(firstImg.status).toBe(200)
    const warmMeta = await GET(new NextRequest(metaUrl(72013)), {
      params: Promise.resolve({ type: "movie", id: "72013" }),
    })
    expect(warmMeta.status).toBe(200)
    const oldHex = (await warmMeta.json()).genreHex as string
    expect(oldHex).toMatch(/^#[0-9a-f]{6}$/)
    // New upstream scene with a cold image-byte cache so the re-render really
    // extracts from the new bytes instead of reusing the cached old ones.
    __resetImageBytesForTest()
    armUpstream(await yellowScene())
    // Slow the next real generate so the metadata fetch provably overlaps it.
    const realGenerate = mockedGenerate.getMockImplementation()
    expect(realGenerate).toBeTruthy()
    mockedGenerate.mockImplementationOnce(async (input) => {
      await new Promise((r) => setTimeout(r, 400))
      return realGenerate!(input)
    })
    // Expire the persisted entry. The completed record still holds the OLD
    // hex, so only the inflight below may answer — with the new one.
    cacheExpire("poster")
    const callsBefore = mockedGenerate.mock.calls.length
    // A conditional image fetch forces revalidation on the same key (SWR
    // never serves a conditional from a stale copy); the bogus validator
    // guarantees a 200 (not a 304) once the new bytes land.
    const imgPromise = GET(
      new NextRequest(imgUrl(72013), { headers: { "If-None-Match": '"bogus"' } }),
      { params: Promise.resolve({ type: "movie", id: "72013" }) },
    )
    // Wait until the re-render provably holds the inflight entry (generate
    // runs strictly inside it), then attach the metadata reader to it.
    const t0 = Date.now()
    while (mockedGenerate.mock.calls.length <= callsBefore) {
      if (Date.now() - t0 > 10000) throw new Error("re-render never started")
      await new Promise((r) => setTimeout(r, 25))
    }
    const metaPromise = GET(new NextRequest(metaUrl(72013)), {
      params: Promise.resolve({ type: "movie", id: "72013" }),
    })
    const [secondImg, freshMeta] = await Promise.all([imgPromise, metaPromise])
    expect(secondImg.status).toBe(200)
    expect(freshMeta.status).toBe(200)
    const freshBody = await freshMeta.json()
    expect(freshBody.status).toBe("ready")
    expect(freshBody.genreHex).toMatch(/^#[0-9a-f]{6}$/)
    // The stale old hex is gone: exactly one shared re-render produced this.
    expect(freshBody.genreHex).not.toBe(oldHex)
    expect(mockedGenerate.mock.calls.length).toBe(callsBefore + 1)
  })

  it("stale sidecar plus a fresh completed record answers the completed window", async () => {
    // Documented 45s overlap, no new policy: mapped entries refresh on the
    // daily schedule and dynamic entries live >= 5min, both outliving the
    // completed window — this overlap only arises with explicit short TTLs
    // or forced expiry. Completed freshness is its own 45s TTL, independent
    // of the bytes entry; serving it keeps image (stale SWR) and metadata
    // consistent instead of desyncing them.
    armUpstream(await sceneBuffer())
    mockedGetById.mockResolvedValue(savedMapping(72014))
    const img = await GET(new NextRequest(imgUrl(72014)), {
      params: Promise.resolve({ type: "movie", id: "72014" }),
    })
    expect(img.status).toBe(200)
    const warm = await GET(new NextRequest(metaUrl(72014)), {
      params: Promise.resolve({ type: "movie", id: "72014" }),
    })
    expect(warm.status).toBe(200)
    const oldHex = (await warm.json()).genreHex as string
    cacheExpire("poster")
    const late = await GET(new NextRequest(metaUrl(72014)), {
      params: Promise.resolve({ type: "movie", id: "72014" }),
    })
    expect(late.status).toBe(200)
    expect((await late.json()).genreHex).toBe(oldHex)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })
})

describe("GET image responses carry the accent header (primary transport)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Same free (private) mode as the suites above: raw query chain.
    vi.spyOn(hardening, "isPresetsPosterMode").mockReturnValue(false)
    vi.spyOn(hardening, "isPublicPosterInstance").mockReturnValue(false)
    vi.spyOn(hardening, "isPreviewAuthRequired").mockReturnValue(false)
    __resetImageBytesForTest()
    mockedGenerate.mockClear()
    vi.mocked(fetchCustomRatings).mockReset().mockResolvedValue([])
    vi.mocked(fetchAggregatedRating).mockReset().mockResolvedValue(null)
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
  })

  afterEach(() => {
    cacheClear()
    __resetCompletedAccentForTests()
    __resetTMDBSessionCache()
  })

  /** Second deterministic scene (yellow base): a hue far from the teal base. */
  async function yellowScene(): Promise<Buffer> {
    const w = 500
    const h = 750
    const stripH = Math.round(h * 0.08)
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="rgb(232,200,60)"/>` +
      `<rect width="${w}" height="${stripH}" fill="rgb(14,16,26)"/>` +
      `<rect y="${h - stripH}" width="${w}" height="${stripH}" fill="rgb(236,231,216)"/>` +
      `</svg>`
    return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
  }

  it("portrait image 200 carries the header, identical to the diagnostic JSON", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(73011))
    const img = await GET(new NextRequest(imgUrl(73011)), {
      params: Promise.resolve({ type: "movie", id: "73011" }),
    })
    expect(img.status).toBe(200)
    // PNG behavior preserved alongside the additive header.
    expect(img.headers.get("Content-Type")).toContain("image/")
    expect(img.headers.get("ETag")).toBeTruthy()
    expect(img.headers.get("Access-Control-Expose-Headers")).toContain(ACCENT_META_HEADER)
    const body = Buffer.from(await img.arrayBuffer())
    expect(body.length).toBeGreaterThan(1000)
    const headerMeta = parseEffectiveAccentHeader(img.headers.get(ACCENT_META_HEADER))
    expect(headerMeta).not.toBeNull()
    expect(headerMeta).toMatchObject({
      genrePaints: true,
      topPaints: true,
      topType: "extra",
      provGenre: "extracted",
      provRank: "extracted",
    })
    // The SAME render's diagnostic JSON reports the SAME hexes: the header
    // is the actual painted fills, not a second computation.
    const meta = await GET(new NextRequest(metaUrl(73011)), {
      params: Promise.resolve({ type: "movie", id: "73011" }),
    })
    expect(meta.status).toBe(200)
    const { status: _status, ...diagnostic } = (await meta.json()) as Record<string, unknown>
    void _status
    expect(diagnostic).toEqual(JSON.parse(JSON.stringify(headerMeta)))
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })

  it("landscape image 200 carries its own header, identical to its diagnostic JSON", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(73012))
    const img = await GET(new NextRequest(imgUrl(73012, "&shape=landscape")), {
      params: Promise.resolve({ type: "movie", id: "73012" }),
    })
    expect(img.status).toBe(200)
    const headerMeta = parseEffectiveAccentHeader(img.headers.get(ACCENT_META_HEADER))
    expect(headerMeta).not.toBeNull()
    const meta = await GET(new NextRequest(metaUrl(73012, "&shape=landscape")), {
      params: Promise.resolve({ type: "movie", id: "73012" }),
    })
    expect(meta.status).toBe(200)
    const { status: _status, ...diagnostic } = (await meta.json()) as Record<string, unknown>
    void _status
    expect(diagnostic).toEqual(JSON.parse(JSON.stringify(headerMeta)))
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })

  it("same scene portrait vs landscape headers differ naturally (solver-determined, never forced)", async () => {
    armUpstream(await sceneBuffer())
    mockedGetById.mockResolvedValue(savedMapping(73013))
    const portrait = await GET(new NextRequest(imgUrl(73013)), {
      params: Promise.resolve({ type: "movie", id: "73013" }),
    })
    expect(portrait.status).toBe(200)
    const portraitMeta = parseEffectiveAccentHeader(portrait.headers.get(ACCENT_META_HEADER))!
    const land = await GET(new NextRequest(imgUrl(73013, "&shape=landscape")), {
      params: Promise.resolve({ type: "movie", id: "73013" }),
    })
    expect(land.status).toBe(200)
    const landMeta = parseEffectiveAccentHeader(land.headers.get(ACCENT_META_HEADER))!
    // Band geometry differs by shape, so the same tint adapts to different
    // fills by itself: the picker value varies with no user brightening step.
    expect(portraitMeta.provGenre).toBe("extracted")
    expect(landMeta.provGenre).toBe("extracted")
    expect(landMeta.genreHex).toMatch(/^#[0-9a-f]{6}$/)
    expect(landMeta.genreHex).not.toBe(portraitMeta.genreHex)
  })

  it("yellow scene header equals its diagnostic JSON (solver-anchored fills)", async () => {
    __resetImageBytesForTest()
    armUpstream(await yellowScene())
    mockedGetById.mockResolvedValue(savedMapping(73014))
    const yellow = await GET(new NextRequest(imgUrl(73014)), {
      params: Promise.resolve({ type: "movie", id: "73014" }),
    })
    expect(yellow.status).toBe(200)
    const yellowMeta = parseEffectiveAccentHeader(yellow.headers.get(ACCENT_META_HEADER))!
    expect(yellowMeta).toMatchObject({ genrePaints: true, provGenre: "extracted" })
    const meta = await GET(new NextRequest(metaUrl(73014)), {
      params: Promise.resolve({ type: "movie", id: "73014" }),
    })
    expect(meta.status).toBe(200)
    const { status: _status, ...diagnostic } = (await meta.json()) as Record<string, unknown>
    void _status
    expect(diagnostic).toEqual(JSON.parse(JSON.stringify(yellowMeta)))
  })

  it("cache HIT serves the header with zero new renders", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(73015))
    const first = await GET(new NextRequest(imgUrl(73015)), {
      params: Promise.resolve({ type: "movie", id: "73015" }),
    })
    expect(first.status).toBe(200)
    const firstHeader = first.headers.get(ACCENT_META_HEADER)
    expect(firstHeader).toBeTruthy()
    const second = await GET(new NextRequest(imgUrl(73015)), {
      params: Promise.resolve({ type: "movie", id: "73015" }),
    })
    expect(second.status).toBe(200)
    expect(second.headers.get(ACCENT_META_HEADER)).toBe(firstHeader)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })

  it("manual ac= image reports the exact manual hexes in the header", async () => {
    const scene = await sceneBuffer()
    armUpstream(scene)
    mockedGetById.mockResolvedValue(savedMapping(73016))
    const img = await GET(
      new NextRequest(`${imgUrl(73016)}&ac=%23123456`),
      { params: Promise.resolve({ type: "movie", id: "73016" }) },
    )
    expect(img.status).toBe(200)
    const headerMeta = parseEffectiveAccentHeader(img.headers.get(ACCENT_META_HEADER))
    expect(headerMeta).toMatchObject({
      genreHex: "#123456",
      rankHex: "#123456",
      provGenre: "manual",
      provRank: "manual",
    })
  })
})
