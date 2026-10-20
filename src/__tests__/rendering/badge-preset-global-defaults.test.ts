/**
 * BadgeLab family presets as GLOBAL DEFAULTS (+ config-token level).
 *
 * Task G1 (server/data foundation, no UI): the sparse per-family map already
 * existed per title; this suite pins the new global layers:
 * - `effectiveDefaultsForShape` merges the landscape profile over the flat
 *   map key-by-key (explicit null shadows, absent inherits);
 * - `resolveFamilyPresetBindings` precedence per family
 *   staged > legacy query > mapping > legacy mapping fan-out > config token >
 *   global defaults > native, with preview still consulting config/defaults
 *   (never the saved mapping);
 * - URL builders stay byte-identical without a map; the per-title map is the
 *   only one emitted as `bp` (mapping wins per family, explicit clears
 *   included), while the global defaults map stays server-resolved and only
 *   feeds the cache-only `dv` dependency;
 * - the poster route resolves/prewarms the authorized ids from config/defaults
 *   with the same single store snapshot;
 * - the catalog-only config token does NOT bake the flat global map (that
 *   would shadow the landscape profile at delivery); the server resolves it.
 */
import sharp from "sharp"
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  BADGE_FAMILY_IDS,
  mergeBadgeFamilyBindings,
} from "@/lib/badge-preset"
import { resolveFamilyPresetBindings } from "@/lib/badge-preset-binding"
import {
  effectiveDefaultsForShape,
  type LandscapeServerDefaults,
  type ServerDefaults,
} from "@/lib/server-defaults"
import type { Mapping } from "@/lib/types"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { POST as postConfigToken } from "@/app/api/config-token/route"
import { getById } from "@/lib/store"
import { getPresetForUser } from "@/lib/badge-preset-store"
import {
  generatePosterBuffer,
  __resetPresetJsonCacheForTests,
  type GenerationInput,
} from "@/lib/poster-service"
import type { BadgePreset } from "@/lib/badge-preset"
import type { StoredPreset } from "@/lib/badge-preset-store"
import { decodeConfig, encodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"
const DEF_ID = "Default1-aaa"
const DEF_ID_2 = "Default2-bbb"
const CFG_ID = "Config11-ccc"
const MAP_ID = "Mapped11-ddd"
const DEF_REV = "deadbeef"
const CFG_REV = "abcdef01"
const MAP_REV = "12345678"

const none = { id: null, rev: null }

function binding(id: string, rev: string = DEF_REV) {
  return { id, rev }
}

function customPreset(id: string, target: BadgePreset["target"], rev = DEF_REV): BadgePreset {
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

function savedMapping(overrides: Record<string, unknown> = {}): Mapping {
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
  } as Mapping
}

// ---------------------------------------------------------------------------
// Pure: effectiveDefaultsForShape profile merge
// ---------------------------------------------------------------------------

describe("effectiveDefaultsForShape family map merge", () => {
  it("returns the same object in portrait (no overlay)", () => {
    const sd: ServerDefaults = { badgePresets: { genre: binding(DEF_ID) } }
    expect(effectiveDefaultsForShape(sd, "poster")).toBe(sd)
  })

  it("merges the landscape profile per family over the flat map", () => {
    const sd: ServerDefaults = {
      badgePresets: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
      landscape: { badgePresets: { genre: null } },
    }
    const land = effectiveDefaultsForShape(sd, "landscape")
    expect(land.badgePresets).toEqual({ genre: null, rank: binding(DEF_ID_2) })
    // Flat input is never mutated.
    expect(sd.badgePresets).toEqual({ genre: binding(DEF_ID), rank: binding(DEF_ID_2) })
  })

  it("inherits the flat map when the profile map is null/absent", () => {
    const flat = { genre: binding(DEF_ID) }
    expect(
      effectiveDefaultsForShape({ badgePresets: flat, landscape: { badgePresets: null } }, "landscape")
        .badgePresets,
    ).toEqual(flat)
    expect(
      effectiveDefaultsForShape({ badgePresets: flat, landscape: { blurFade: 70 } }, "landscape")
        .badgePresets,
    ).toEqual(flat)
  })

  it("adds a profile-only map without inventing a flat key", () => {
    const land = effectiveDefaultsForShape(
      { landscape: { badgePresets: { quality: binding(DEF_ID) } } },
      "landscape",
    )
    expect(land.badgePresets).toEqual({ quality: binding(DEF_ID) })
    const empty = effectiveDefaultsForShape({ landscape: {} }, "landscape")
    expect(empty.badgePresets).toBeUndefined()
  })
})

describe("mergeBadgeFamilyBindings", () => {
  it("returns undefined when both layers are absent (legacy URLs)", () => {
    expect(mergeBadgeFamilyBindings(undefined, undefined)).toBeUndefined()
    expect(mergeBadgeFamilyBindings(null, null)).toBeUndefined()
  })

  it("override wins per family, explicit null included, siblings inherited", () => {
    expect(
      mergeBadgeFamilyBindings(
        { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
        { genre: null, quality: binding(CFG_ID) },
      ),
    ).toEqual({ genre: null, rank: binding(DEF_ID_2), quality: binding(CFG_ID) })
    expect(mergeBadgeFamilyBindings(undefined, { rank: binding(MAP_ID) })).toEqual({
      rank: binding(MAP_ID),
    })
  })
})

// ---------------------------------------------------------------------------
// Pure: resolver precedence including config/defaults
// ---------------------------------------------------------------------------

describe("resolveFamilyPresetBindings config/defaults layers", () => {
  it("resolves the global defaults map without any per-title binding", () => {
    const out = resolveFamilyPresetBindings({
      mapping: null,
      shape: "poster",
      isPreview: false,
      defaultsFamilies: { genre: binding(DEF_ID), quality: binding(DEF_ID_2) },
    })
    expect(out.genre).toEqual(binding(DEF_ID))
    expect(out.quality).toEqual(binding(DEF_ID_2))
    expect(out.rank).toEqual(none)
  })

  it("lets the config token win over the global defaults", () => {
    const out = resolveFamilyPresetBindings({
      mapping: null,
      shape: "poster",
      isPreview: false,
      configFamilies: { genre: binding(CFG_ID, CFG_REV) },
      defaultsFamilies: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
    })
    expect(out.genre).toEqual(binding(CFG_ID, CFG_REV))
    // Siblings keep falling through to the defaults layer.
    expect(out.rank).toEqual(binding(DEF_ID_2))
  })

  it("an explicit config clear blocks the defaults for that family only", () => {
    const out = resolveFamilyPresetBindings({
      mapping: null,
      shape: "poster",
      isPreview: false,
      configFamilies: { genre: null },
      defaultsFamilies: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
    })
    expect(out.genre).toEqual(none)
    expect(out.rank).toEqual(binding(DEF_ID_2))
  })

  it("keeps the mapping above config/defaults, with explicit clear blocking them", () => {
    const mapped = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresets: { genre: binding(MAP_ID, MAP_REV) } }),
      shape: "poster",
      isPreview: false,
      configFamilies: { genre: binding(CFG_ID), rank: binding(CFG_ID) },
      defaultsFamilies: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
    })
    expect(mapped.genre).toEqual(binding(MAP_ID, MAP_REV))
    expect(mapped.rank).toEqual(binding(CFG_ID))
    const cleared = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresets: { genre: null } }),
      shape: "poster",
      isPreview: false,
      defaultsFamilies: { genre: binding(DEF_ID) },
    })
    expect(cleared.genre).toEqual(none)
  })

  it("fans the legacy mapped top out before the config/defaults layers", () => {
    const out = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresetId: MAP_ID, badgePresetRev: MAP_REV }),
      shape: "poster",
      isPreview: false,
      legacyMappingTarget: "top",
      defaultsFamilies: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
      configFamilies: { rank: binding(CFG_ID) },
    })
    // Legacy top still covers rank+extra (before config/defaults), while the
    // unconcerned genre follows the defaults.
    expect(out.rank).toEqual(binding(MAP_ID, MAP_REV))
    expect(out.extra).toEqual(binding(MAP_ID, MAP_REV))
    expect(out.genre).toEqual(binding(DEF_ID))
  })

  it("consults config/defaults in preview but never the saved mapping", () => {
    const out = resolveFamilyPresetBindings({
      mapping: savedMapping({ badgePresets: { genre: binding(MAP_ID), quality: binding(MAP_ID) } }),
      shape: "poster",
      isPreview: true,
      configFamilies: { genre: binding(CFG_ID) },
      defaultsFamilies: { quality: binding(DEF_ID) },
    })
    expect(out.genre).toEqual(binding(CFG_ID))
    expect(out.quality).toEqual(binding(DEF_ID))
    expect(out.rank).toEqual(none)
  })

  it("keeps staged presence above config/defaults", () => {
    const out = resolveFamilyPresetBindings({
      staged: { genre: null, rank: { id: MAP_ID, rev: MAP_REV } },
      mapping: null,
      shape: "poster",
      isPreview: true,
      configFamilies: { genre: binding(CFG_ID), rank: binding(CFG_ID) },
      defaultsFamilies: { genre: binding(DEF_ID) },
    })
    expect(out.genre).toEqual(none)
    expect(out.rank).toEqual(binding(MAP_ID, MAP_REV))
  })

  it("fails closed on malformed config/default entries without resurrecting lower layers", () => {
    const out = resolveFamilyPresetBindings({
      mapping: null,
      shape: "poster",
      isPreview: false,
      configFamilies: { genre: { id: "<script>", rev: DEF_REV } },
      defaultsFamilies: { genre: binding(DEF_ID) },
    })
    expect(out.genre).toEqual(none)
  })

  it("keeps all families independent when only some are configured", () => {
    const out = resolveFamilyPresetBindings({
      mapping: null,
      shape: "poster",
      isPreview: false,
      defaultsFamilies: { comingSoon: binding(DEF_ID) },
    })
    for (const family of BADGE_FAMILY_IDS) {
      if (family === "comingSoon") expect(out[family]).toEqual(binding(DEF_ID))
      else expect(out[family]).toEqual(none)
    }
  })
})

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

const BASE_DEFAULTS: ServerDefaults = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  gradientHeight: 30,
  networkLogo: true,
}

function stremioUrl(overrides: Partial<Parameters<typeof buildStremioPosterUrl>[0]> = {}) {
  return buildStremioPosterUrl({
    origin: "https://example.com",
    type: "movie",
    id: 4242,
    defaults: BASE_DEFAULTS,
    mapping: null,
    lang: "it",
    ...overrides,
  })
}

describe("buildStremioPosterUrl with global family defaults", () => {
  it("keeps legacy URLs byte-identical without a map", () => {
    const url = stremioUrl()
    expect(url.searchParams.get("bp")).toBeNull()
    const withMap = stremioUrl({ mapping: savedMapping() })
    expect(withMap.searchParams.get("bp")).toBeNull()
  })

  it("keeps the global defaults map off the query (server-resolved)", () => {
    const url = stremioUrl({
      defaults: { ...BASE_DEFAULTS, badgePresets: { genre: binding(DEF_ID) } },
    })
    expect(url.searchParams.get("bp")).toBeNull()
    // Cache-only dependency: the URL still rotates when the map changes.
    expect(url.searchParams.get("dv")).toBeTruthy()
  })

  it("emits only the per-title map (mapping wins, defaults never travel)", () => {
    const url = stremioUrl({
      defaults: {
        ...BASE_DEFAULTS,
        badgePresets: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
      },
      mapping: savedMapping({ badgePresets: { genre: null, quality: binding(MAP_ID, MAP_REV) } }),
    })
    expect(url.searchParams.get("bp")).toBe(`genre:-,quality:${MAP_ID}.${MAP_REV}`)
  })

  it("keeps the landscape profile map off the query too, still rotating dv", () => {
    const defaults = {
      ...BASE_DEFAULTS,
      badgePresets: { genre: binding(DEF_ID) },
      landscape: { badgePresets: { genre: null, rank: binding(DEF_ID_2) } },
    } as ServerDefaults
    const portrait = stremioUrl({ defaults })
    const landscape = stremioUrl({ defaults, forceShape: "landscape" })
    expect(portrait.searchParams.get("bp")).toBeNull()
    expect(landscape.searchParams.get("bp")).toBeNull()
    expect(portrait.searchParams.get("dv")).not.toBe(landscape.searchParams.get("dv"))
  })

  it("with a config token emits only the mapping map (config > defaults)", () => {
    const url = stremioUrl({
      config: "signed-token",
      defaults: {
        ...BASE_DEFAULTS,
        badgePresets: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
      },
      mapping: savedMapping({ badgePresets: { quality: binding(MAP_ID, MAP_REV) } }),
    })
    expect(url.searchParams.get("bp")).toBe(`quality:${MAP_ID}.${MAP_REV}`)
    const bare = stremioUrl({ config: "signed-token", defaults: { ...BASE_DEFAULTS, badgePresets: { genre: binding(DEF_ID) } } })
    expect(bare.searchParams.get("bp")).toBeNull()
  })
})

describe("buildDefaultsPreviewUrl with global family defaults", () => {
  it("stays byte-identical without a map", () => {
    const url = new URL(buildDefaultsPreviewUrl({ defaultGlobalBadges: true, defaultRankingBadges: true }))
    expect(url.searchParams.get("bp")).toBeNull()
  })

  it("emits the flat map and merges the landscape profile over it", () => {
    const portrait = new URL(
      buildDefaultsPreviewUrl({
        defaultGlobalBadges: true,
        defaultRankingBadges: true,
        defaultBadgePresets: { genre: binding(DEF_ID) },
        previewShape: "portrait",
      }),
    )
    expect(portrait.searchParams.get("bp")).toBe(`genre:${DEF_ID}.${DEF_REV}`)
    const landscape = new URL(
      buildDefaultsPreviewUrl({
        defaultGlobalBadges: true,
        defaultRankingBadges: true,
        defaultBadgePresets: { genre: binding(DEF_ID), rank: binding(DEF_ID_2) },
        landscape: { badgePresets: { genre: null } },
        previewShape: "landscape",
      }),
    )
    expect(landscape.searchParams.get("bp")).toBe(`rank:${DEF_ID_2}.${DEF_REV},genre:-`)
  })
})

// ---------------------------------------------------------------------------
// Route wiring (mocked boundaries, real cache + URL parsing)
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  defaults: {} as Record<string, unknown>,
}))

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
  return {
    ...mod,
    getServerDefaults: vi.fn(() => mockState.defaults),
    getServerDefaultsChecked: vi.fn(async () => mockState.defaults),
    getServerDefaultsForUser: vi.fn(async () => mockState.defaults),
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

vi.mock("@/lib/badge-preset-store", () => ({
  getPresetForUser: vi.fn(),
}))

vi.mock("@/lib/poster-service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-service")>()
  return { ...mod, generatePosterBuffer: vi.fn(async () => Buffer.from(stubBytes)) }
})
let stubBytes: Buffer = Buffer.alloc(0)

const mockedGetById = vi.mocked(getById)
const mockedGenerate = vi.mocked(generatePosterBuffer)
const mockedGetPresetForUser = vi.mocked(getPresetForUser)

function lastGenInput(): GenerationInput {
  expect(mockedGenerate).toHaveBeenCalled()
  return mockedGenerate.mock.calls[mockedGenerate.mock.calls.length - 1][0] as GenerationInput
}

async function getPoster(url: string) {
  return GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: "4242" }) })
}

function livePreset(id: string, target: BadgePreset["target"], rev: string): StoredPreset {
  return { preset: customPreset(id, target, rev), downloads: 0 }
}

function mockLivePresets(entries: Record<string, { target: BadgePreset["target"]; rev: string }>) {
  mockedGetPresetForUser.mockImplementation(async (id: string) => {
    const entry = entries[id]
    return entry ? livePreset(id, entry.target, entry.rev) : null
  })
}

const BASE_CONFIG: PictoriumUserConfig = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  gradientHeight: 30,
  networkLogo: true,
  autoRotateClean: false,
}

describe("GET /api/poster global family defaults", () => {
  beforeAll(async () => {
    stubBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#101010" } })
      .jpeg()
      .toBuffer()
  })

  beforeEach(async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
    mockState.defaults = { defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" }
    mockedGenerate.mockClear()
    mockedGetPresetForUser.mockReset().mockResolvedValue(null)
    mockedGetById.mockResolvedValue(savedMapping())
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
    vi.unstubAllEnvs()
    cacheClear()
    __resetTMDBSessionCache()
  })

  it("renders the global defaults family map without any per-title binding", async () => {
    mockLivePresets({ [DEF_ID]: { target: "genre", rev: DEF_REV } })
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV) },
    }
    const res = await getPoster("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre?.id).toBe(DEF_ID)
    expect(lastGenInput().badgeFamilyPresets?.rank ?? null).toBeNull()
  })

  it("lets the config token win over the global defaults", async () => {
    mockLivePresets({
      [DEF_ID]: { target: "genre", rev: DEF_REV },
      [CFG_ID]: { target: "genre", rev: CFG_REV },
    })
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV) },
    }
    const token = encodeConfig({ ...BASE_CONFIG, badgePresets: { genre: binding(CFG_ID, CFG_REV) } })
    const res = await getPoster(`http://localhost:3000/api/poster/movie/4242?config=${token}`)
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre?.id).toBe(CFG_ID)
    expect(lastGenInput().badgeFamilyPresets?.genre?.revision).toBe(CFG_REV)
  })

  it("lets an explicit mapped clear block the global default for that family only", async () => {
    mockLivePresets({
      [DEF_ID]: { target: "rank", rev: DEF_REV },
      [MAP_ID]: { target: "genre", rev: MAP_REV },
    })
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV), rank: binding(DEF_ID, DEF_REV) },
    }
    mockedGetById.mockResolvedValue(
      savedMapping({ badgePresets: { genre: null, quality: binding(MAP_ID, MAP_REV) } }),
    )
    const res = await getPoster("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    const families = lastGenInput().badgeFamilyPresets ?? {}
    expect(families.genre).toBeNull()
    // Siblings still inherit the global default (the mapped quality entry is
    // target-incompatible and degrades to native, never leaks).
    expect(families.rank?.id).toBe(DEF_ID)
  })

  it("merges the landscape profile map on the landscape canvas", async () => {
    mockLivePresets({
      [DEF_ID]: { target: "genre", rev: DEF_REV },
      [DEF_ID_2]: { target: "rank", rev: DEF_REV },
    })
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV), rank: binding(DEF_ID_2, DEF_REV) },
      landscape: { badgePresets: { genre: null } },
    }
    mockedGetById.mockResolvedValue(savedMapping({ backdropPath: "/back.jpg" }))
    const res = await getPoster("http://localhost:3000/api/poster/movie/4242?shape=landscape")
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre).toBeNull()
    expect(lastGenInput().badgeFamilyPresets?.rank?.id).toBe(DEF_ID_2)
  })

  it("preview consults the global defaults but never resurrects the saved mapping", async () => {
    mockLivePresets({
      [DEF_ID]: { target: "genre", rev: DEF_REV },
      [MAP_ID]: { target: "quality", rev: MAP_REV },
    })
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV) },
    }
    mockedGetById.mockResolvedValue(
      savedMapping({ badgePresets: { quality: binding(MAP_ID, MAP_REV) } }),
    )
    const res = await getPoster("http://localhost:3000/api/poster/movie/4242?preview=1")
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre?.id).toBe(DEF_ID)
    expect(lastGenInput().badgeFamilyPresets?.quality ?? null).toBeNull()
  })

  it("fails native for a default id that is not authorized (no store leak)", async () => {
    // Private/other-namespace/revoked defaults resolve to no preset; the
    // render must fall back to native without any binding or error.
    mockLivePresets({})
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV) },
    }
    const res = await getPoster("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    expect(lastGenInput().badgeFamilyPresets?.genre ?? null).toBeNull()
  })

  it("rotates the cache key when the authorized revision changes", async () => {
    mockLivePresets({ [DEF_ID]: { target: "genre", rev: DEF_REV } })
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV) },
    }
    const url = "http://localhost:3000/api/poster/movie/4242"
    const first = await getPoster(url)
    expect(first.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect(lastGenInput().badgeFamilyPresets?.genre?.revision).toBe(DEF_REV)

    // Same id and same default binding: only the live preset snapshot moved.
    // The key fragment carries the CURRENT authorized revision, so the next
    // request must render again instead of serving the stale bitmap.
    mockLivePresets({ [DEF_ID]: { target: "genre", rev: "cafebabe" } })
    const second = await getPoster(url)
    expect(second.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    expect(lastGenInput().badgeFamilyPresets?.genre?.revision).toBe("cafebabe")
  })

  it("rotates the cache key when the global defaults map changes", async () => {
    mockLivePresets({
      [DEF_ID]: { target: "genre", rev: DEF_REV },
      [DEF_ID_2]: { target: "genre", rev: DEF_REV },
    })
    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID, DEF_REV) },
    }
    const url = "http://localhost:3000/api/poster/movie/4242"
    const first = await getPoster(url)
    expect(first.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect(lastGenInput().badgeFamilyPresets?.genre?.id).toBe(DEF_ID)

    mockState.defaults = {
      ...mockState.defaults,
      badgePresets: { genre: binding(DEF_ID_2, DEF_REV) },
    }
    const second = await getPoster(url)
    expect(second.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    expect(lastGenInput().badgeFamilyPresets?.genre?.id).toBe(DEF_ID_2)
  })
})

// ---------------------------------------------------------------------------
// Catalog-only config token composition
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// G1 correction cycle 1: URL precedence through the REAL builder + route.
//
// Global default maps stay server-resolved: they are never emitted as `bp`
// (query/staged wins over mapping/config server-side), so a legacy singleton
// mapping must keep winning over an overlapping global default, mapped
// clears must keep blocking globals, and a mapped family must not block the
// globals of its siblings. Each URL is built by `buildStremioPosterUrl` and
// then resolved by the real poster route; the assertion is on the exact
// `GenerationInput` the single renderer receives.
// ---------------------------------------------------------------------------

const DEF_ID_3 = "Default3-ccc"
const RANK_MAP_ID = "RankMap-4444"
const TOP_MAP_ID = "TopMap-66666"
const CFG_GENRE_ID = "CfgGenre-7777"
const REV_A = "aaaabbbb"
const REV_B = "bbbbcccc"
const REV_C = "ccccdddd"

function defaultsWith(
  map: ServerDefaults["badgePresets"],
  landscapeMap?: LandscapeServerDefaults["badgePresets"],
): ServerDefaults {
  return {
    ...BASE_DEFAULTS,
    ...(map ? { badgePresets: map } : {}),
    ...(landscapeMap !== undefined ? { landscape: { badgePresets: landscapeMap } } : {}),
  }
}

function familyPresets(input: GenerationInput) {
  return input.badgeFamilyPresets ?? {}
}

describe("G1 correction: URL emission keeps global maps server-resolved", () => {
  it("does not emit a global defaults map as an overriding `bp`", () => {
    const defaults = defaultsWith({ genre: binding(DEF_ID_3, REV_A) })
    const url = stremioUrl({ defaults })
    expect(url.searchParams.get("bp")).toBeNull()
    // The same map feeds the cache-only identity so browser/edge/Stremio
    // rotate when the global defaults change.
    expect(url.searchParams.get("dv")).toBeTruthy()
  })

  it("keeps profile-sparse landscape maps off the query too", () => {
    const defaults = defaultsWith(
      { rank: binding(DEF_ID, REV_A), genre: binding(DEF_ID_3, REV_A) },
      { genre: null },
    )
    const portrait = stremioUrl({ defaults })
    const landscape = stremioUrl({ defaults, forceShape: "landscape" })
    expect(portrait.searchParams.get("bp")).toBeNull()
    expect(landscape.searchParams.get("bp")).toBeNull()
    expect(portrait.searchParams.get("dv")).not.toBe(landscape.searchParams.get("dv"))
  })

  it("still emits the per-title map (mapping wins, defaults never travel)", () => {
    const defaults = defaultsWith({ rank: binding(DEF_ID, REV_A), genre: binding(DEF_ID_3, REV_A) })
    const url = stremioUrl({
      defaults,
      mapping: savedMapping({ badgePresets: { genre: null, quality: binding(MAP_ID, MAP_REV) } }),
    })
    expect(url.searchParams.get("bp")).toBe(`genre:-,quality:${MAP_ID}.${MAP_REV}`)
  })

  it("rotates dv when only the global map moves, also with a config token (non-compact)", () => {
    const base = stremioUrl()
    const withMap = stremioUrl({ defaults: defaultsWith({ genre: binding(DEF_ID_3, REV_A) }) })
    expect(withMap.searchParams.get("dv")).toBeTruthy()
    expect(withMap.searchParams.get("dv")).not.toBe(base.searchParams.get("dv"))
    const same = stremioUrl({ defaults: defaultsWith({ genre: binding(DEF_ID_3, REV_A) }) })
    expect(same.searchParams.get("dv")).toBe(withMap.searchParams.get("dv"))
    const moved = stremioUrl({ defaults: defaultsWith({ genre: binding(DEF_ID_3, REV_B) }) })
    expect(moved.searchParams.get("dv")).not.toBe(withMap.searchParams.get("dv"))

    const cfgBase = stremioUrl({ config: "signed-token" })
    expect(cfgBase.searchParams.get("dv")).toBeNull()
    const cfgMap = stremioUrl({ config: "signed-token", defaults: defaultsWith({ genre: binding(DEF_ID_3, REV_A) }) })
    expect(cfgMap.searchParams.get("dv")).toBeTruthy()
    expect(cfgMap.searchParams.get("dv")).not.toBe(base.searchParams.get("dv"))
  })
})

describe("G1 correction: builder URL -> real route precedence", () => {
  beforeEach(() => {
    mockState.defaults = {
      defaultLogoFitEnabled: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
    }
  })

  it("legacy mapped top wins over overlapping global defaults (portrait)", async () => {
    mockLivePresets({
      [TOP_MAP_ID]: { target: "top", rev: MAP_REV },
      [DEF_ID]: { target: "rank", rev: REV_A },
      [DEF_ID_2]: { target: "extra", rev: REV_B },
      [DEF_ID_3]: { target: "genre", rev: REV_C },
    })
    const defaults = defaultsWith({
      rank: binding(DEF_ID, REV_A),
      extra: binding(DEF_ID_2, REV_B),
      genre: binding(DEF_ID_3, REV_C),
    })
    mockState.defaults = { ...mockState.defaults, ...defaults }
    const mapping = savedMapping({ badgePresetId: TOP_MAP_ID, badgePresetRev: MAP_REV })
    mockedGetById.mockResolvedValue(mapping)
    const url = stremioUrl({ defaults, mapping })
    expect(url.searchParams.get("bp")).toBeNull()
    const res = await getPoster(url.toString())
    expect(res.status).toBe(200)
    const fam = familyPresets(lastGenInput())
    // Mapping/singleton > defaults: the top singleton keeps both slots.
    expect(fam.rank?.id).toBe(TOP_MAP_ID)
    expect(fam.extra?.id).toBe(TOP_MAP_ID)
    // Unconcerned sibling still follows the global default.
    expect(fam.genre?.id).toBe(DEF_ID_3)
  })

  it("legacy mapped top + sparse profile still beats the landscape defaults", async () => {
    mockLivePresets({
      [TOP_MAP_ID]: { target: "top", rev: MAP_REV },
      [DEF_ID]: { target: "rank", rev: REV_A },
      [DEF_ID_2]: { target: "extra", rev: REV_B },
      [DEF_ID_3]: { target: "genre", rev: REV_C },
    })
    const defaults = defaultsWith(
      {
        rank: binding(DEF_ID, REV_A),
        extra: binding(DEF_ID_2, REV_B),
        genre: binding(DEF_ID_3, REV_C),
      },
      { rank: binding(DEF_ID_3, REV_C), genre: null },
    )
    mockState.defaults = { ...mockState.defaults, ...defaults }
    const mapping = savedMapping({
      badgePresetId: TOP_MAP_ID,
      badgePresetRev: MAP_REV,
      backdropPath: "/back.jpg",
    })
    mockedGetById.mockResolvedValue(mapping)
    const url = stremioUrl({ defaults, mapping, forceShape: "landscape" })
    expect(url.searchParams.get("bp")).toBeNull()
    const res = await getPoster(url.toString())
    expect(res.status).toBe(200)
    const fam = familyPresets(lastGenInput())
    expect(fam.rank?.id).toBe(TOP_MAP_ID)
    expect(fam.extra?.id).toBe(TOP_MAP_ID)
    // Profile clear wins over the flat default, mapping does not cover genre.
    expect(fam.genre).toBeNull()
  })

  it("mapped null blocks the global map for that family only (portrait + landscape)", async () => {
    mockLivePresets({
      [RANK_MAP_ID]: { target: "rank", rev: MAP_REV },
      [DEF_ID]: { target: "rank", rev: REV_A },
      [DEF_ID_3]: { target: "genre", rev: REV_C },
      [DEF_ID_2]: { target: "quality", rev: REV_B },
    })
    const defaults = defaultsWith({
      rank: binding(DEF_ID, REV_A),
      genre: binding(DEF_ID_3, REV_C),
      quality: binding(DEF_ID_2, REV_B),
    })
    mockState.defaults = { ...mockState.defaults, ...defaults }
    const mapping = savedMapping({
      badgePresets: { genre: null, rank: { id: RANK_MAP_ID, rev: MAP_REV } },
      backdropPath: "/back.jpg",
    })
    mockedGetById.mockResolvedValue(mapping)
    const portrait = stremioUrl({ defaults, mapping })
    expect(portrait.searchParams.get("bp")).toBe(`rank:${RANK_MAP_ID}.${MAP_REV},genre:-`)
    const portRes = await getPoster(portrait.toString())
    expect(portRes.status).toBe(200)
    const portFam = familyPresets(lastGenInput())
    expect(portFam.genre).toBeNull()
    expect(portFam.rank?.id).toBe(RANK_MAP_ID)
    expect(portFam.quality?.id).toBe(DEF_ID_2)

    cacheClear()
    const landscape = stremioUrl({ defaults, mapping, forceShape: "landscape" })
    const landRes = await getPoster(landscape.toString())
    expect(landRes.status).toBe(200)
    const landFam = familyPresets(lastGenInput())
    expect(landFam.genre).toBeNull()
    expect(landFam.rank?.id).toBe(RANK_MAP_ID)
    expect(landFam.quality?.id).toBe(DEF_ID_2)
  })

  it("a mapped family never blocks the globals of its siblings (both shapes)", async () => {
    mockLivePresets({
      [RANK_MAP_ID]: { target: "rank", rev: MAP_REV },
      [DEF_ID_3]: { target: "genre", rev: REV_C },
    })
    const defaults = defaultsWith({ genre: binding(DEF_ID_3, REV_C), rank: binding(DEF_ID, REV_A) })
    mockState.defaults = { ...mockState.defaults, ...defaults }
    const mapping = savedMapping({
      badgePresets: { rank: { id: RANK_MAP_ID, rev: MAP_REV } },
      backdropPath: "/back.jpg",
    })
    mockedGetById.mockResolvedValue(mapping)
    for (const forceShape of ["poster", "landscape"] as const) {
      cacheClear()
      const url = stremioUrl({ defaults, mapping, forceShape })
      expect(url.searchParams.get("bp")).toBe(`rank:${RANK_MAP_ID}.${MAP_REV}`)
      const res = await getPoster(url.toString())
      expect(res.status).toBe(200)
      const fam = familyPresets(lastGenInput())
      expect(fam.rank?.id).toBe(RANK_MAP_ID)
      expect(fam.genre?.id).toBe(DEF_ID_3)
    }
  })

  it("config token wins over global defaults on both shapes", async () => {
    mockLivePresets({
      [CFG_GENRE_ID]: { target: "genre", rev: CFG_REV },
      [DEF_ID_3]: { target: "genre", rev: REV_C },
      [DEF_ID]: { target: "genre", rev: REV_A },
    })
    const defaults = defaultsWith({ genre: binding(DEF_ID_3, REV_C) }, { genre: binding(DEF_ID, REV_A) })
    mockState.defaults = { ...mockState.defaults, ...defaults }
    mockedGetById.mockResolvedValue(savedMapping({ backdropPath: "/back.jpg" }))
    const token = encodeConfig({ ...BASE_CONFIG, badgePresets: { genre: binding(CFG_GENRE_ID, CFG_REV) } })
    for (const forceShape of ["poster", "landscape"] as const) {
      cacheClear()
      const url = stremioUrl({ config: token, defaults, forceShape })
      expect(url.searchParams.get("bp")).toBeNull()
      const res = await getPoster(url.toString())
      expect(res.status).toBe(200)
      expect(familyPresets(lastGenInput()).genre?.id).toBe(CFG_GENRE_ID)
    }
  })

  it("catalog-only token never bakes the flat map over the delivery profile", async () => {
    mockLivePresets({
      [DEF_ID_3]: { target: "genre", rev: REV_C },
      [DEF_ID]: { target: "genre", rev: REV_A },
    })
    const defaults = defaultsWith({ genre: binding(DEF_ID_3, REV_C) }, { genre: binding(DEF_ID, REV_A) })
    mockState.defaults = { ...mockState.defaults, ...defaults }
    const req = new NextRequest("http://localhost/api/config-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ config: { rankingSourceMovie: "cat_m" } }),
    })
    const minted = await postConfigToken(req)
    expect(minted.status).toBe(200)
    const token = (await minted.json()).token as string
    // The token stays flat-visual/back-compat: it must not freeze the flat
    // map (that would shadow the server landscape profile at delivery).
    expect(decodeConfig(token)?.badgePresets).toBeUndefined()

    mockedGetById.mockResolvedValue(savedMapping({ backdropPath: "/back.jpg" }))
    for (const forceShape of ["poster", "landscape"] as const) {
      cacheClear()
      const res = await getPoster(
        `http://localhost:3000/api/poster/movie/4242?config=${encodeURIComponent(token)}&shape=${forceShape === "landscape" ? "landscape" : "poster"}`,
      )
      expect(res.status).toBe(200)
      expect(familyPresets(lastGenInput()).genre?.id).toBe(forceShape === "landscape" ? DEF_ID : DEF_ID_3)
    }
  })
})

describe("POST /api/config-token keeps global family defaults server-resolved", () => {
  beforeEach(() => {
    mockState.defaults = {
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      blurEnabled: true,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: false,
      badgePresets: { genre: binding(DEF_ID) },
    }
  })

  it("never bakes the flat global map into a catalog-only token", async () => {
    const req = new NextRequest("http://localhost/api/config-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ config: { rankingSourceMovie: "cat_m" } }),
    })
    const res = await postConfigToken(req)
    expect(res.status).toBe(200)
    const token = (await res.json()).token as string
    const decoded = decodeConfig(token)
    // A baked flat map would be a config-level override (config > defaults)
    // and would shadow the server landscape profile at delivery.
    expect(decoded?.badgePresets).toBeUndefined()
    expect(decoded?.rankingSourceMovie).toBe("cat_m")
  })

  it("keeps the token free of badgePresets when the defaults have none", async () => {
    mockState.defaults = { ...mockState.defaults, badgePresets: undefined }
    const req = new NextRequest("http://localhost/api/config-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ config: { rankingSourceMovie: "cat_m" } }),
    })
    const res = await postConfigToken(req)
    expect(res.status).toBe(200)
    const token = (await res.json()).token as string
    expect(decodeConfig(token)?.badgePresets).toBeUndefined()
  })
})
