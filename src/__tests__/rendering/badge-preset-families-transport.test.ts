/**
 * End-to-end per-family preset transport/resolution/cache + shared
 * rank/extra/genre rendering (existing builders only).
 *
 * Covers the bounded `bp` query encoding (canonical, no free text), the
 * server-written `bpt` target fragment, hardening/cache normalization,
 * route->service typed resolved map (single store snapshot, no double
 * lookup), independent rank vs extra vs genre rendering, and Stremio/preview
 * URL emission. Families without a dedicated renderer (quality/age/network/
 * separate/custom/comingSoon) travel through transport+cache but keep the
 * native standard render — asserted as retained, not rendered.
 */
import sharp from "sharp"
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  encodeFamilyBpParam,
  encodeFamilyTargetsParam,
  filterCompatibleFamilyPreset,
  isPresetTargetCompatibleWithFamily,
  parseFamilyBpParam,
  parseFamilyTargetsParam,
} from "@/lib/badge-preset-family-transport"
import { resolveFamilyPresetBindings } from "@/lib/badge-preset-binding"
import { selectFamilySlotPresets } from "@/lib/poster-service"
import { validatePosterQuery } from "@/lib/validation"
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import {
  generatePosterBuffer,
  __resetPresetJsonCacheForTests,
  type GenerationInput,
} from "@/lib/poster-service"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildPreviewUrl } from "@/lib/poster-url"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { BadgePreset } from "@/lib/badge-preset"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"
const FLAT_ID = "Abc123-_XyZ"
const FLAT_REV = "deadbeef"
const RANK_ID = "Rank0000-aaa"
const RANK_REV = "12345678"
const GENRE_ID = "Genre1111-bb"
const GENRE_REV = "abcdef01"
const NEW_REV = "1234abcd"
const QUALITY_ID = "Qual2222-ccc"

function customPreset(id: string, target: BadgePreset["target"], rev = FLAT_REV): BadgePreset {
  return {
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "P", tags: [] },
    variant: "custom",
    design: {
      shape: "pill",
      padding: { x: 12, y: 6 },
      background: { type: "solid", color: "#cc0000", opacity: 100 },
      text: {
        template: "P",
        color: "#ffffff",
        opacity: 100,
        fontSize: 20,
        fontWeight: 700,
        uppercase: false,
        letterSpacing: 0,
        align: "center",
      },
      scale: 100,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: rev,
  }
}

// ---------------------------------------------------------------------------
// Transport: bounded canonical encoding
// ---------------------------------------------------------------------------

describe("family bp transport (shared serializer/parser)", () => {
  it("round-trips sparse maps in canonical order with clears and unpinned revs", () => {
    const encoded = encodeFamilyBpParam({
      genre: { id: GENRE_ID, rev: GENRE_REV },
      rank: { id: RANK_ID },
      quality: null,
    })
    // Canonical family order: rank, extra, genre, ... (BADGE_FAMILY_IDS).
    expect(encoded).toBe(`rank:${RANK_ID},genre:${GENRE_ID}.${GENRE_REV},quality:-`)
    const parsed = parseFamilyBpParam(encoded)
    expect(parsed).toEqual({
      rank: { id: RANK_ID },
      genre: { id: GENRE_ID, rev: GENRE_REV },
      quality: null,
    })
  })

  it("returns null/undefined on absent/empty maps (legacy URLs stay byte-identical)", () => {
    expect(encodeFamilyBpParam(null)).toBeNull()
    expect(encodeFamilyBpParam({})).toBeNull()
    expect(parseFamilyBpParam(null)).toBeUndefined()
    expect(parseFamilyBpParam("")).toEqual({})
  })

  it("drops unknown families, keeps first duplicate, caps at nine families", () => {
    const parsed = parseFamilyBpParam(
      `nope:${FLAT_ID},rank:${RANK_ID},rank:${FLAT_ID},genre:${GENRE_ID}`,
    )
    expect(parsed).toEqual({ rank: { id: RANK_ID }, genre: { id: GENRE_ID } })
    const many = [
      "rank", "extra", "genre", "quality", "age", "network",
      "separateRatings", "customRatings", "comingSoon",
    ]
      .map((f) => `${f}:${FLAT_ID}`)
      .join(",")
    expect(Object.keys(parseFamilyBpParam(`${many},rank:${RANK_ID}`) ?? {}).length).toBe(9)
  })

  it("shadows a known family with malformed id as an explicit clear (fail-closed)", () => {
    expect(parseFamilyBpParam(`genre:<script>,rank:${RANK_ID}`)).toEqual({
      genre: null,
      rank: { id: RANK_ID },
    })
    // Invalid rev pins rev null but keeps the binding (rev is cache identity).
    expect(parseFamilyBpParam(`rank:${RANK_ID}.random`)).toEqual({ rank: { id: RANK_ID } })
  })

  it("encodes and parses the server-written target fragment", () => {
    const encoded = encodeFamilyTargetsParam({ rank: "top", genre: "genre", nope: "top" } as never)
    expect(encoded).toBe("rank:top,genre:genre")
    expect(parseFamilyTargetsParam(encoded)).toEqual({ rank: "top", genre: "genre" })
    expect(parseFamilyTargetsParam("rank:bogus")).toEqual({})
    expect(parseFamilyTargetsParam(null)).toBeUndefined()
  })

  it("validates target compatibility: legacy top covers rank+extra, others are same-family", () => {
    expect(isPresetTargetCompatibleWithFamily("top", "rank")).toBe(true)
    expect(isPresetTargetCompatibleWithFamily("top", "extra")).toBe(true)
    expect(isPresetTargetCompatibleWithFamily("top", "genre")).toBe(false)
    expect(isPresetTargetCompatibleWithFamily("genre", "genre")).toBe(true)
    expect(isPresetTargetCompatibleWithFamily("rank", "extra")).toBe(false)
    expect(isPresetTargetCompatibleWithFamily("quality", "quality")).toBe(true)
    expect(filterCompatibleFamilyPreset(customPreset(FLAT_ID, "top"), "rank")).not.toBeNull()
    expect(filterCompatibleFamilyPreset(customPreset(FLAT_ID, "quality"), "genre")).toBeNull()
    expect(filterCompatibleFamilyPreset(null, "genre")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Query bounds + hardening + cache normalization
// ---------------------------------------------------------------------------

describe("family transport bounds (schema/hardening/normalize)", () => {
  it("rejects an overlong bp at the query boundary", () => {
    expect(validatePosterQuery(new URLSearchParams("bp=rank%3AAbc123-_XyZ"))).toBeNull()
    const overlong = `rank:${"A".repeat(600)}`
    expect(validatePosterQuery(new URLSearchParams(`bp=${overlong}`))).toMatch(/bp/)
  })

  it("hardening canonicalizes bp order and drops the server-written bpt", () => {
    const base = { presets: true, preview: false, anonymous: true, publicInstance: false, hasMapping: true, mappingCustomBadge: null }
    const out = hardenPosterSearchParams(
      new URLSearchParams(`bp=genre%3A${GENRE_ID}%2Crank%3A${RANK_ID}&bpt=rank%3Atop`),
      base,
    )
    expect(out.get("bp")).toBe(`rank:${RANK_ID},genre:${GENRE_ID}`)
    expect(out.has("bpt")).toBe(false)
    // Empty after canonicalization collapses onto absent (legacy key intact).
    const empty = hardenPosterSearchParams(new URLSearchParams("bp="), base)
    expect(empty.has("bp")).toBe(false)
  })

  it("normalize keeps the authorized pair and drops orphan bpt", () => {
    const kept = normalizePosterCacheParams(
      new URLSearchParams(`bp=rank%3A${RANK_ID}.${RANK_REV}&bpt=rank%3Atop`),
    )
    expect(kept.get("bp")).toBe(`rank:${RANK_ID}.${RANK_REV}`)
    expect(kept.get("bpt")).toBe("rank:top")
    const orphan = normalizePosterCacheParams(new URLSearchParams("bpt=rank%3Atop"))
    expect(orphan.has("bpt")).toBe(false)
    const junk = normalizePosterCacheParams(new URLSearchParams(`bp=nope%3A${FLAT_ID}`))
    expect(junk.has("bp")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Slot selection (pure)
// ---------------------------------------------------------------------------

describe("selectFamilySlotPresets", () => {
  const genre = customPreset(GENRE_ID, "genre", GENRE_REV)
  const top = customPreset(RANK_ID, "top", RANK_REV)

  it("follows the legacy singleton when the map is undefined (byte-identical)", () => {
    const empty = {
      quality: null,
      age: null,
      network: null,
      separateRatings: null,
      customRatings: null,
      comingSoon: null,
    }
    expect(selectFamilySlotPresets(undefined, genre)).toEqual({ genre, rank: null, extra: null, ...empty })
    expect(selectFamilySlotPresets(undefined, top)).toEqual({ genre: null, rank: top, extra: top, ...empty })
    expect(selectFamilySlotPresets(undefined, null)).toEqual({ genre: null, rank: null, extra: null, ...empty })
  })

  it("renders rank/extra/genre independently from their own families", () => {
    const out = selectFamilySlotPresets({ genre, rank: top, extra: null }, top)
    expect(out.genre).toBe(genre)
    expect(out.rank).toBe(top)
    expect(out.extra).toBeNull()
  })

  it("filters incompatible targets (technical slots stay independent)", () => {
    const quality = customPreset(QUALITY_ID, "quality")
    const out = selectFamilySlotPresets({ genre: quality, quality, rank: top }, null)
    expect(out.genre).toBeNull()
    expect(out.rank).toBe(top)
    expect(out.extra).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Service rendering with the family map (existing builders)
// ---------------------------------------------------------------------------

vi.mock("@/lib/badge-preset-store", () => ({
  getPresetForUser: vi.fn(),
}))

import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import { getPresetForUser } from "@/lib/badge-preset-store"

// ---------------------------------------------------------------------------
// Route wiring (mocked boundary, real cache + real URL parsing)
// ---------------------------------------------------------------------------

vi.mock("@/lib/custom-rating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/custom-rating")>()),
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
  findMappingByImdb: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" }))
  return {
    ...mod,
    getServerDefaults: mocked,
    getServerDefaultsChecked: vi.fn(async () => mocked()),
    getServerDefaultsForUser: vi.fn(async () => mocked()),
  }
})

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
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
  mdblistRemainingMs: vi.fn(() => null),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return { ...actual, fetchAggregatedRating: vi.fn(async () => null) }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(),
  getDetailsWithExternalIds: vi.fn(async () => null),
  getImages: vi.fn(),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn(() => undefined),
  resolveUserApiKeys: vi.fn(async () => {
    const none = { key: undefined, source: "none" } as const
    return { tmdb: none, mdblist: none, tvdb: none }
  }),
}))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

vi.mock("@/lib/user-auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-auth")>()
  return { ...mod, userExists: vi.fn(async () => true) }
})

vi.mock("@/lib/user-activity", () => ({
  touchUserActivity: vi.fn(),
}))

vi.mock("@/lib/poster-service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-service")>()
  return { ...mod, generatePosterBuffer: vi.fn(async () => Buffer.from(stubBytes)) }
})
let stubBytes: Buffer = Buffer.alloc(0)

const mockedGetById = vi.mocked(getById)
const mockedGenerate = vi.mocked(generatePosterBuffer)
const mockedGetPresetForUser = vi.mocked(getPresetForUser)

function savedMapping(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tmdbId: 4242,
    mediaType: "movie",
    title: "Bound",
    posterPath: "/saved.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    showBadges: false,
    rankingBadges: false,
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  }
}

function lastGenInput(): GenerationInput {
  expect(mockedGenerate).toHaveBeenCalled()
  return mockedGenerate.mock.calls[mockedGenerate.mock.calls.length - 1][0] as GenerationInput
}

async function get(url: string) {
  return GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: "4242" }) })
}

describe("GET /api/poster family wiring", () => {
  beforeAll(async () => {
    stubBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#101010" } })
      .jpeg()
      .toBuffer()
  })

  beforeEach(async () => {
    mockedGenerate.mockClear()
    mockedGetPresetForUser.mockReset().mockResolvedValue(null)
    __resetPresetJsonCacheForTests()
    __resetImageBytesForTest()
    const poster = await sharp({ create: { width: 500, height: 750, channels: 4, background: "#101010" } })
      .png()
      .toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(new Uint8Array(poster), { headers: { "content-type": "image/png" } }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("keeps two selected families coexisting end-to-end (rank + genre)", async () => {
    mockedGetPresetForUser.mockImplementation(async (id: string) =>
      id === RANK_ID
        ? { preset: customPreset(RANK_ID, "rank", RANK_REV), downloads: 0 }
        : id === GENRE_ID
          ? { preset: customPreset(GENRE_ID, "genre", GENRE_REV), downloads: 0 }
          : null,
    )
    mockedGetById.mockResolvedValue(
      savedMapping({
        badgePresets: {
          rank: { id: RANK_ID, rev: RANK_REV },
          genre: { id: GENRE_ID, rev: GENRE_REV },
        },
      }) as never,
    )
    const res = await get("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    const families = lastGenInput().badgeFamilyPresets ?? {}
    expect(families.rank?.id).toBe(RANK_ID)
    expect(families.genre?.id).toBe(GENRE_ID)
    expect(families.extra).toBeNull()
    // One store lookup per distinct id (single snapshot, no double lookup).
    const seen = mockedGetPresetForUser.mock.calls.map((c) => c[0]).sort()
    expect(seen).toEqual([GENRE_ID, RANK_ID])
  })

  it("lets an outside-preview mapped family override the legacy singleton only for that family", async () => {
    const LEGACY_TOP = "LegacyTop-1a"
    mockedGetPresetForUser.mockImplementation(async (id: string) =>
      id === LEGACY_TOP
        ? { preset: customPreset(LEGACY_TOP, "top", FLAT_REV), downloads: 0 }
        : id === GENRE_ID
          ? { preset: customPreset(GENRE_ID, "genre", GENRE_REV), downloads: 0 }
          : null,
    )
    mockedGetById.mockResolvedValue(
      savedMapping({
        badgePresetId: LEGACY_TOP,
        badgePresetRev: FLAT_REV,
        badgePresets: { genre: { id: GENRE_ID, rev: GENRE_REV } },
      }) as never,
    )
    const res = await get("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    const families = lastGenInput().badgeFamilyPresets ?? {}
    expect(families.genre?.id).toBe(GENRE_ID)
    // The legacy top singleton still fans out to the uncovered rank+extra.
    expect(families.rank?.id).toBe(LEGACY_TOP)
    expect(families.extra?.id).toBe(LEGACY_TOP)
  })

  it("never resurrects the saved map or singleton from a preview explicit clear", async () => {
    mockedGetPresetForUser.mockResolvedValue({ preset: customPreset(GENRE_ID, "genre", GENRE_REV), downloads: 0 })
    mockedGetById.mockResolvedValue(
      savedMapping({
        badgePresetId: GENRE_ID,
        badgePresetRev: GENRE_REV,
        badgePresets: { genre: { id: GENRE_ID, rev: GENRE_REV } },
      }) as never,
    )
    const res = await get(`http://localhost:3000/api/poster/movie/4242?preview=1&bp=genre%3A-`)
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre).toBeNull()
  })

  it("degrades a target-mismatched family binding to standard (never a stale preset)", async () => {
    mockedGetPresetForUser.mockResolvedValue({ preset: customPreset(QUALITY_ID, "quality"), downloads: 0 })
    mockedGetById.mockResolvedValue(
      savedMapping({ badgePresets: { genre: { id: QUALITY_ID, rev: FLAT_REV } } }) as never,
    )
    const res = await get("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre).toBeNull()
  })

  it("hides private family presets from a foreign namespace", async () => {
    const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    mockedGetPresetForUser.mockImplementation(async (id: string, userUuid: string) =>
      id === GENRE_ID && userUuid === OWNER ? { preset: customPreset(GENRE_ID, "genre", GENRE_REV), downloads: 0 } : null,
    )
    mockedGetById.mockResolvedValue(
      savedMapping({ badgePresets: { genre: { id: GENRE_ID, rev: GENRE_REV } } }) as never,
    )
    const res = await get(`http://localhost:3000/api/poster/movie/4242?u=${OTHER}`)
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre).toBeNull()
  })

  it("invalidates the selection on store revision change even with a fixed client rev", async () => {
    mockedGetPresetForUser.mockResolvedValue({ preset: customPreset(GENRE_ID, "genre", GENRE_REV), downloads: 0 })
    mockedGetById.mockResolvedValue(
      savedMapping({ badgePresets: { genre: { id: GENRE_ID, rev: FLAT_REV } } }) as never,
    )
    const url = "http://localhost:3000/api/poster/movie/4242"
    const first = await get(url)
    expect(first.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre?.revision).toBe(GENRE_REV)
    const second = await get(url)
    expect(second.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    // BadgeLab edit: the mapping still pins the old rev, the key must turn over.
    mockedGetPresetForUser.mockResolvedValue({ preset: customPreset(GENRE_ID, "genre", NEW_REV), downloads: 0 })
    const third = await get(url)
    expect(third.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    expect(lastGenInput().badgeFamilyPresets?.genre?.revision).toBe(NEW_REV)
  })

  it("merges the landscape profile per family (explicit null shadows, portrait keeps flat)", async () => {
    mockedGetPresetForUser.mockImplementation(async (id: string) =>
      id === RANK_ID
        ? { preset: customPreset(RANK_ID, "rank", RANK_REV), downloads: 0 }
        : id === GENRE_ID
          ? { preset: customPreset(GENRE_ID, "genre", GENRE_REV), downloads: 0 }
          : null,
    )
    mockedGetById.mockResolvedValue(
      savedMapping({
        backdropPath: "/back.jpg",
        badgePresets: {
          rank: { id: RANK_ID, rev: RANK_REV },
          genre: { id: GENRE_ID, rev: GENRE_REV },
        },
        landscape: { badgePresets: { genre: null } },
      }) as never,
    )
    const land = await get("http://localhost:3000/api/poster/movie/4242?shape=landscape")
    expect(land.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre).toBeNull()
    expect(lastGenInput().badgeFamilyPresets?.rank?.id).toBe(RANK_ID)
    cacheClear()
    const port = await get("http://localhost:3000/api/poster/movie/4242")
    expect(port.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre?.id).toBe(GENRE_ID)
  })

  it("leaves legacy URLs byte-identical when the family map is absent", async () => {
    mockedGetById.mockResolvedValue(savedMapping() as never)
    const first = await get("http://localhost:3000/api/poster/movie/4242")
    expect(first.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre ?? null).toBeNull()
    const second = await get("http://localhost:3000/api/poster/movie/4242")
    expect(second.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Stremio + preview URL emission
// ---------------------------------------------------------------------------

describe("family map URL emission (Stremio + preview)", () => {
  const defaults = {} as ServerDefaults

  function mappingWithFamilies(overrides: Record<string, unknown> = {}) {
    return {
      tmdbId: 7,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2026-09-01T10:00:00.000Z",
      ...overrides,
    } as never
  }

  it("emits bp from the effective shape map in Stremio URLs (absent stays absent)", () => {
    const withMap = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 7,
      defaults,
      mapping: mappingWithFamilies({
        badgePresets: { rank: { id: RANK_ID, rev: RANK_REV }, genre: null },
      }),
    })
    expect(withMap.searchParams.get("bp")).toBe(`rank:${RANK_ID}.${RANK_REV},genre:-`)
    const legacy = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 7,
      defaults,
      mapping: mappingWithFamilies(),
    })
    expect(legacy.searchParams.has("bp")).toBe(false)
  })

  it("keeps bp explicit in compact mode (never inside dv)", () => {
    const url = buildStremioPosterSearchParams({
      badgePresets: { rank: { id: RANK_ID, rev: RANK_REV } },
      compactTuning: true,
    })
    expect(url.get("bp")).toBe(`rank:${RANK_ID}.${RANK_REV}`)
    expect(url.get("dv")).not.toContain("rank")
  })

  it("emits staged families in preview URLs without resurrecting the saved map", () => {
    const ps = {
      selected: { id: 7, media_type: "movie" },
      previewPoster: null,
      selectedLogo: null,
      selectedBackdrop: null,
      logoScale: 100,
      logoOffsetX: 0,
      logoOffsetY: 0,
      backdropScale: 100,
      backdropOffsetX: 0,
      backdropOffsetY: 0,
      metaInfo: { genres: [], voteAverage: 0 },
      trendRank: null,
      mdblistAnimeList: [],
      topEdgeColor: null,
      lang: "it",
    }
    const bp = {
      globalBadges: true,
      rankingBadges: false,
      gradientHeight: 30,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      blurEnabled: true,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      genreBadgeOffsetX: 0,
      genreBadgeOffsetY: 0,
      qualityBadgeScale: 100,
      qualityBadgeOffsetX: 0,
      qualityBadgeOffsetY: 0,
      networkLogoScale: 100,
      networkLogoOffsetX: 0,
      networkLogoOffsetY: 0,
      customBadge: null,
      badgePresets: { genre: null, rank: { id: RANK_ID, rev: RANK_REV } },
    }
    const url = buildPreviewUrl(ps as never, bp as never)
    expect(url).toContain(`bp=${encodeURIComponent(`rank:${RANK_ID}.${RANK_REV},genre:-`)}`)
    const bare = buildPreviewUrl(ps as never, { ...bp, badgePresets: undefined } as never)
    expect(bare).not.toContain("bp=")
  })
})

// ---------------------------------------------------------------------------
// Pure resolver integration (preview clears + shape merge at binding level)
// ---------------------------------------------------------------------------

describe("family binding resolution integration", () => {
  function mapping(overrides: Record<string, unknown> = {}) {
    return {
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2026-09-01T10:00:00.000Z",
      ...overrides,
    } as never
  }

  it("staged clears shadow both the map and the legacy singleton in preview", () => {
    const out = resolveFamilyPresetBindings({
      staged: parseFamilyBpParam(`genre:-`),
      mapping: mapping({
        badgePresetId: GENRE_ID,
        badgePresets: { genre: { id: GENRE_ID, rev: GENRE_REV } },
      }),
      shape: "poster",
      isPreview: true,
      legacyMappingTarget: "genre",
    })
    expect(out.genre).toEqual({ id: null, rev: null })
  })
})
