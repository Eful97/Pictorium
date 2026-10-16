/**
 * Route wiring for shape-specific BadgeLab bindings (dead-plumbing RED test).
 *
 * The renderer (`generatePosterBuffer` + `getPresetForPoster`) already renders
 * bound presets, but the poster route never forwarded the shape-effective
 * authorized binding (`badgePresetId`/`badgePresetRev`/`badgePresetUser`) into
 * `genInput`. These tests intercept `generatePosterBuffer` at the route
 * boundary and pin the full precedence contract:
 * query > saved effective-for-shape, preview never resurrects a cleared
 * binding, per-shape profile independence, scoped user, cache non-collision
 * across namespaces, and the fail-open/fail-closed security intent.
 */
import sharp from "sharp"
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/api/poster/[type]/[id]/route"
import { getById } from "@/lib/store"
import {
  generatePosterBuffer,
  getPresetForPoster,
  __resetPresetJsonCacheForTests,
  type GenerationInput,
} from "@/lib/poster-service"
import { getPresetForUser } from "@/lib/badge-preset-store"
import { resolvePresetBinding } from "@/lib/badge-preset-binding"
import type { BadgePreset } from "@/lib/badge-preset"
import type { StoredPreset } from "@/lib/badge-preset-store"
import type { Mapping } from "@/lib/types"
import { cacheClear } from "@/lib/cache"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

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

// Route-level interception: capture the exact GenerationInput the route hands
// to the single existing renderer, without running the heavy composite.
vi.mock("@/lib/poster-service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-service")>()
  return { ...mod, generatePosterBuffer: vi.fn(async () => Buffer.from(stubBytes)) }
})
let stubBytes: Buffer = Buffer.alloc(0)

const mockedGetById = vi.mocked(getById)
const mockedGenerate = vi.mocked(generatePosterBuffer)
const mockedGetPresetForUser = vi.mocked(getPresetForUser)

const FLAT_ID = "Abc123-_XyZ"
const FLAT_REV = "deadbeef"
const LAND_ID = "Land4567-890"
const LAND_REV = "abcdef01"
const QUERY_ID = "Query9999-abc"
const QUERY_REV = "12345678"

function savedMapping(overrides: Partial<Mapping> = {}): Mapping {
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

function lastGenInput(): GenerationInput {
  expect(mockedGenerate).toHaveBeenCalled()
  return mockedGenerate.mock.calls[mockedGenerate.mock.calls.length - 1][0] as GenerationInput
}

async function get(url: string) {
  return GET(new NextRequest(url), { params: Promise.resolve({ type: "movie", id: "4242" }) })
}

beforeAll(async () => {
  stubBytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#101010" } })
    .jpeg()
    .toBuffer()
})

beforeEach(async () => {
  vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "false")
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
  vi.unstubAllEnvs()
  cacheClear()
  __resetTMDBSessionCache()
})

describe("resolvePresetBinding (pure precedence)", () => {
  const shapeMapping = () =>
    savedMapping({
      badgePresetId: FLAT_ID,
      badgePresetRev: FLAT_REV,
      landscape: { badgePresetId: LAND_ID, badgePresetRev: LAND_REV },
    } as Partial<Mapping>)

  it("uses the query binding over the saved mapping", () => {
    expect(
      resolvePresetBinding({
        queryId: QUERY_ID,
        queryRev: QUERY_REV,
        mapping: shapeMapping(),
        shape: "poster",
        isPreview: false,
      }),
    ).toEqual({ id: QUERY_ID, rev: QUERY_REV })
  })

  it("falls back to the saved flat binding off-preview", () => {
    expect(
      resolvePresetBinding({ queryId: null, queryRev: null, mapping: shapeMapping(), shape: "poster", isPreview: false }),
    ).toEqual({ id: FLAT_ID, rev: FLAT_REV })
  })

  it("uses the landscape profile pair on the landscape shape", () => {
    expect(
      resolvePresetBinding({
        queryId: null,
        queryRev: null,
        mapping: shapeMapping(),
        shape: "landscape",
        isPreview: false,
      }),
    ).toEqual({ id: LAND_ID, rev: LAND_REV })
  })

  it("an explicit profile clear never resurrects the flat", () => {
    const cleared = savedMapping({
      badgePresetId: FLAT_ID,
      badgePresetRev: FLAT_REV,
      landscape: { badgePresetId: null, badgePresetRev: null },
    } as Partial<Mapping>)
    expect(
      resolvePresetBinding({ queryId: null, queryRev: null, mapping: cleared, shape: "landscape", isPreview: false }),
    ).toEqual({ id: null, rev: null })
    // Portrait keeps the flat.
    expect(
      resolvePresetBinding({ queryId: null, queryRev: null, mapping: cleared, shape: "poster", isPreview: false }),
    ).toEqual({ id: FLAT_ID, rev: FLAT_REV })
  })

  it("preview without query never inherits the saved binding", () => {
    expect(
      resolvePresetBinding({ queryId: null, queryRev: null, mapping: shapeMapping(), shape: "poster", isPreview: true }),
    ).toEqual({ id: null, rev: null })
    expect(
      resolvePresetBinding({
        queryId: null,
        queryRev: null,
        mapping: shapeMapping(),
        shape: "landscape",
        isPreview: true,
      }),
    ).toEqual({ id: null, rev: null })
  })

  it("staged preview with query renders the staged binding", () => {
    expect(
      resolvePresetBinding({
        queryId: QUERY_ID,
        queryRev: QUERY_REV,
        mapping: shapeMapping(),
        shape: "poster",
        isPreview: true,
      }),
    ).toEqual({ id: QUERY_ID, rev: QUERY_REV })
  })

  it("drops invalid identities instead of rendering junk", () => {
    expect(
      resolvePresetBinding({
        queryId: "<script>",
        queryRev: "random",
        mapping: savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }),
        shape: "poster",
        isPreview: true,
      }),
    ).toEqual({ id: null, rev: null })
  })

  it("drops an invalid saved identity (fail-open, legacy output)", () => {
    expect(
      resolvePresetBinding({
        queryId: null,
        queryRev: null,
        mapping: savedMapping({ badgePresetId: "<script>", badgePresetRev: "random" }),
        shape: "poster",
        isPreview: false,
      }),
    ).toEqual({ id: null, rev: null })
  })
})

describe("GET /api/poster forwards the authorized binding to the renderer", () => {
  function livePreset(id: string, rev: string): StoredPreset {
    return {
      preset: {
        version: 1,
        id,
        ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
        target: "genre",
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
      },
      downloads: 0,
    }
  }

  function mockLivePresets(entries: Record<string, string>) {
    mockedGetPresetForUser.mockImplementation(async (id: string) =>
      entries[id] ? livePreset(id, entries[id]) : null,
    )
  }

  it("passes the saved flat binding on Stremio-style requests", async () => {
    mockLivePresets({ [FLAT_ID]: FLAT_REV })
    mockedGetById.mockResolvedValue(savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }))
    const res = await get("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    const input = lastGenInput()
    expect(input.badgePresetId).toBe(FLAT_ID)
    expect(input.badgePresetRev).toBe(FLAT_REV)
    expect(input.badgePresetUser).toBeNull()
  })

  it("lets an explicit query binding win over the saved mapping", async () => {
    mockLivePresets({ [FLAT_ID]: FLAT_REV, [QUERY_ID]: QUERY_REV })
    mockedGetById.mockResolvedValue(savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }))
    const res = await get(`http://localhost:3000/api/poster/movie/4242?badgePreset=${QUERY_ID}&prv=${QUERY_REV}`)
    expect(res.status).toBe(200)
    const input = lastGenInput()
    expect(input.badgePresetId).toBe(QUERY_ID)
    expect(input.badgePresetRev).toBe(QUERY_REV)
  })

  it("falls back to the saved binding on junk query (fail-open preserved)", async () => {
    mockLivePresets({ [FLAT_ID]: FLAT_REV })
    mockedGetById.mockResolvedValue(savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }))
    const res = await get("http://localhost:3000/api/poster/movie/4242?badgePreset=%3Cscript%3E&prv=random")
    expect(res.status).toBe(200)
    const input = lastGenInput()
    expect(input.badgePresetId).toBe(FLAT_ID)
    expect(input.badgePresetRev).toBe(FLAT_REV)
  })

  it("preview without query renders no preset even with a saved binding", async () => {
    mockLivePresets({ [FLAT_ID]: FLAT_REV })
    mockedGetById.mockResolvedValue(savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }))
    const res = await get("http://localhost:3000/api/poster/movie/4242?preview=1")
    expect(res.status).toBe(200)
    const input = lastGenInput()
    expect(input.badgePresetId).toBeNull()
    expect(input.badgePresetRev).toBeNull()
  })

  it("staged preview with query agrees with the renderer", async () => {
    mockLivePresets({ [FLAT_ID]: FLAT_REV, [QUERY_ID]: QUERY_REV })
    mockedGetById.mockResolvedValue(savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }))
    const res = await get(`http://localhost:3000/api/poster/movie/4242?preview=1&badgePreset=${QUERY_ID}&prv=${QUERY_REV}`)
    expect(res.status).toBe(200)
    const input = lastGenInput()
    expect(input.badgePresetId).toBe(QUERY_ID)
    expect(input.badgePresetRev).toBe(QUERY_REV)
  })

  it("passes no binding for legacy mappings (output unchanged)", async () => {
    mockedGetById.mockResolvedValue(savedMapping())
    const res = await get("http://localhost:3000/api/poster/movie/4242")
    expect(res.status).toBe(200)
    const input = lastGenInput()
    expect(input.badgePresetId).toBeNull()
    expect(input.badgePresetRev).toBeNull()
  })

  it("resolves the binding per shape: profile on landscape, flat on portrait", async () => {
    mockLivePresets({ [FLAT_ID]: FLAT_REV, [LAND_ID]: LAND_REV })
    mockedGetById.mockResolvedValue(
      savedMapping({
        badgePresetId: FLAT_ID,
        badgePresetRev: FLAT_REV,
        backdropPath: "/back.jpg",
        landscape: { badgePresetId: LAND_ID, badgePresetRev: LAND_REV },
      } as Partial<Mapping>),
    )
    const land = await get("http://localhost:3000/api/poster/movie/4242?shape=landscape")
    expect(land.status).toBe(200)
    expect(lastGenInput().badgePresetId).toBe(LAND_ID)
    expect(lastGenInput().badgePresetRev).toBe(LAND_REV)
    cacheClear()
    const port = await get("http://localhost:3000/api/poster/movie/4242")
    expect(port.status).toBe(200)
    expect(lastGenInput().badgePresetId).toBe(FLAT_ID)
  })

  it("an explicit landscape profile clear stays cleared on that shape", async () => {
    mockedGetById.mockResolvedValue(
      savedMapping({
        badgePresetId: FLAT_ID,
        badgePresetRev: FLAT_REV,
        backdropPath: "/back.jpg",
        landscape: { badgePresetId: null, badgePresetRev: null },
      } as Partial<Mapping>),
    )
    const land = await get("http://localhost:3000/api/poster/movie/4242?shape=landscape")
    expect(land.status).toBe(200)
    expect(lastGenInput().badgePresetId).toBeNull()
  })
})

describe("scoped preset identity (no cross-user leaks)", () => {
  const USER_A = "123e4567-e89b-12d3-a456-426614174000"
  const USER_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

  function presetFor(owner: string, target: "top" | "genre" = "genre"): BadgePreset {
    return {
      version: 1,
      id: FLAT_ID,
      ownerUuid: owner,
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
      revision: FLAT_REV,
    }
  }

  it("never serves a cached private preset to another namespace", async () => {
    const owned = presetFor(USER_A)
    mockedGetPresetForUser.mockImplementation(async (id: string, userUuid: string) =>
      id === FLAT_ID && userUuid === USER_A ? { preset: owned, downloads: 0 } : null,
    )
    await expect(getPresetForPoster(FLAT_ID, FLAT_REV, USER_A)).resolves.toEqual(owned)
    // Same id, foreign user: must miss even though the owner's entry is cached.
    await expect(getPresetForPoster(FLAT_ID, FLAT_REV, USER_B)).resolves.toBeNull()
    // Same id, anonymous: must miss as well.
    await expect(getPresetForPoster(FLAT_ID, FLAT_REV, null)).resolves.toBeNull()
    // Owner still resolves.
    await expect(getPresetForPoster(FLAT_ID, FLAT_REV, USER_A)).resolves.toEqual(owned)
  })

  it("passes the resolved scoped user to the renderer and isolates the poster cache per namespace", async () => {
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    mockedGetById.mockImplementation(async (_t, _id, _userId) =>
      savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }),
    )
    const a = await get(`http://localhost:3000/api/poster/movie/4242?u=${USER_A}`)
    expect(a.status).toBe(200)
    expect(lastGenInput().badgePresetUser).toBe(USER_A)
    const b = await get(`http://localhost:3000/api/poster/movie/4242?u=${USER_B}`)
    expect(b.status).toBe(200)
    expect(lastGenInput().badgePresetUser).toBe(USER_B)
    // Same id, different namespaces: two isolated renders, never one shared entry.
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    // Same namespace twice: the second is a cache hit, no re-render.
    const a2 = await get(`http://localhost:3000/api/poster/movie/4242?u=${USER_A}`)
    expect(a2.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
  })
})

/**
 * BadgeLab mutation invalidation against a WARM poster cache (behavioral
 * RED/GREEN, not import-shape tests).
 *
 * The saved `badgePresetRev` pinned in a mapping (or a stale `prv` in a
 * bookmarked URL) does not move when the BadgeLab store edits, deletes, or
 * revokes the preset — so a poster cache key built from the pinned revision
 * keeps serving pre-edit bytes for hours, and a cached public copy keeps
 * serving after a public→private revocation. These tests warm the cache,
 * mutate the store mock, re-read the SAME poster URL, and require the
 * current authorized design (or standard fallback) — never stale bytes.
 */
describe("BadgeLab edit/delete/revocation against a warm poster cache", () => {
  const OWNER = "123e4567-e89b-12d3-a456-426614174000"
  const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  const NEW_REV = "1234abcd"

  function storedPreset(opts: {
    rev?: string
    target?: "top" | "genre"
    visibility?: "public" | "private"
    owner?: string
  } = {}): StoredPreset {
    const preset: BadgePreset = {
      version: 1,
      id: FLAT_ID,
      ownerUuid: opts.owner ?? OWNER,
      target: opts.target ?? "genre",
      visibility: opts.visibility ?? "private",
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
      revision: opts.rev ?? FLAT_REV,
    }
    return { preset, downloads: 0 }
  }

  function mockLivePreset(current: StoredPreset | null) {
    mockedGetPresetForUser.mockImplementation(async (id: string) =>
      id === FLAT_ID ? current : null,
    )
  }

  function mockOwnerScoped(opts: {
    rev?: string
    target?: "top" | "genre"
    visibility?: "public" | "private"
  } = {}) {
    const live = storedPreset({ owner: OWNER, ...opts })
    mockedGetPresetForUser.mockImplementation(async (id: string, userUuid: string) =>
      id === FLAT_ID && (live.preset.visibility === "public" || userUuid === OWNER)
        ? live
        : null,
    )
    return live
  }

  beforeEach(() => {
    mockedGetById.mockResolvedValue(
      savedMapping({ badgePresetId: FLAT_ID, badgePresetRev: FLAT_REV }),
    )
  })

  it("a Lab edit (new revision) re-renders the SAME saved-binding URL with the current design", async () => {
    mockLivePreset(storedPreset({ rev: FLAT_REV }))
    const first = await get("http://localhost:3000/api/poster/movie/4242")
    expect(first.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect(lastGenInput().badgePresetRev).toBe(FLAT_REV)

    // BadgeLab edit: same id, new store revision. The mapping still pins
    // the old rev and the poster cache is warm from the first request.
    mockLivePreset(storedPreset({ rev: NEW_REV }))
    const second = await get("http://localhost:3000/api/poster/movie/4242")
    expect(second.status).toBe(200)
    // A stale key would serve the warm entry with no re-render.
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    expect(lastGenInput().badgePresetId).toBe(FLAT_ID)
    expect(lastGenInput().badgePresetRev).toBe(NEW_REV)
    expect(lastGenInput().badgePresetResolved?.revision).toBe(NEW_REV)
  })

  it("a stale query prv converges onto the current store revision", async () => {
    mockLivePreset(storedPreset({ rev: NEW_REV }))
    const staleUrl = `http://localhost:3000/api/poster/movie/4242?badgePreset=${FLAT_ID}&prv=${FLAT_REV}`
    const first = await get(staleUrl)
    expect(first.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)

    // Same bookmarked URL again: the pinned prv is stale, the render must
    // still be the current authorized design (prv is a cache identity, not
    // a pinned historical render).
    const second = await get(staleUrl)
    expect(second.status).toBe(200)
    expect(lastGenInput().badgePresetId).toBe(FLAT_ID)
    expect(lastGenInput().badgePresetRev).toBe(NEW_REV)
    expect(lastGenInput().badgePresetResolved?.revision).toBe(NEW_REV)
  })

  it("a Lab delete degrades the SAME saved-binding URL to standard (no ghost preset)", async () => {
    mockLivePreset(storedPreset({ rev: FLAT_REV }))
    const first = await get("http://localhost:3000/api/poster/movie/4242")
    expect(first.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect(lastGenInput().badgePresetId).toBe(FLAT_ID)

    // BadgeLab delete: the mapping still references the id.
    mockLivePreset(null)
    const second = await get("http://localhost:3000/api/poster/movie/4242")
    expect(second.status).toBe(200)
    // A stale key would serve the warm preset bytes with no re-render.
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    expect(lastGenInput().badgePresetId).toBeNull()
    expect(lastGenInput().badgePresetRev).toBeNull()
    expect(lastGenInput().badgePresetResolved).toBeNull()
  })

  it("a target flip with an unchanged revision still invalidates the warm entry", async () => {
    mockLivePreset(storedPreset({ rev: FLAT_REV, target: "genre" }))
    const first = await get("http://localhost:3000/api/poster/movie/4242")
    expect(first.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)

    // Target genre→top with an identical design: the revision (design hash)
    // does not move, but the render slot does — the key must still turn over.
    mockLivePreset(storedPreset({ rev: FLAT_REV, target: "top" }))
    const second = await get("http://localhost:3000/api/poster/movie/4242")
    expect(second.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    expect(lastGenInput().badgePresetResolved?.target).toBe("top")
  })

  it("a public→private revocation never serves cached bytes to another namespace", async () => {
    vi.stubEnv("PICTORIUM_MULTI_USER", "1")
    mockOwnerScoped({ rev: FLAT_REV, target: "genre", visibility: "public" })
    const foreign = await get(`http://localhost:3000/api/poster/movie/4242?u=${OTHER}`)
    expect(foreign.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect(lastGenInput().badgePresetResolved?.visibility).toBe("public")

    // Owner revokes to private. Same foreign URL (warm B-scoped entry):
    // must re-render to standard, never serve the public-era bytes, and the
    // renderer must receive no authorized preset for the foreign namespace.
    mockOwnerScoped({ rev: FLAT_REV, target: "genre", visibility: "private" })
    const after = await get(`http://localhost:3000/api/poster/movie/4242?u=${OTHER}`)
    expect(after.status).toBe(200)
    expect(mockedGenerate).toHaveBeenCalledTimes(2)
    expect(lastGenInput().badgePresetUser).toBe(OTHER)
    expect(lastGenInput().badgePresetId).toBeNull()
    expect(lastGenInput().badgePresetResolved).toBeNull()

    // Owner still renders the (now private) preset in their own namespace.
    const owner = await get(`http://localhost:3000/api/poster/movie/4242?u=${OWNER}`)
    expect(owner.status).toBe(200)
    expect(lastGenInput().badgePresetResolved?.visibility).toBe("private")
  })
})
