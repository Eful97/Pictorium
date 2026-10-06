// 24h rotation — concrete verification WITHOUT changing the implementation.
// Targeted extra file (does not touch poster-rotation.test.ts or any source):
// - tryRotatePoster / tryRotateBackdrop against a mocked store: before/exact/after
//   24h, wrap-around, stale exclusions, pool<2, flag off, missing timestamp,
//   idempotence, concurrency (same image + shared poster/backdrop lock);
//   both the returned mapping and the persisted store are asserted;
// - `mv` URL path via the real mappingVersionParam;
// - dynamic wiring (bucket/TTL/index/gating) via the real functions the route uses;
// - targeted GET /api/poster integration (same harness as
//   backdrop-crop-fallback.test.ts): rotation runs BEFORE any cache read
//   (route.ts:413-429 vs first cache read at :721);
// - namespaced requests over real GET ?u=: regression tests proving the
//   rotation re-read/write stays in the caller's namespace for both posters
//   and backdrops (user rotates, global and other users untouched), plus
//   two-user isolation. No implementation fix here.

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as posterGET } from "@/app/api/poster/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetPosterRenderLimiter } from "@/lib/poster-runtime-cache"
import { __resetMdblistBreaker } from "@/lib/ratings"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetCircuitBreaker } from "@/lib/awards"
import { clearTvdbCache } from "@/lib/tvdb"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import {
  getEffectiveRotationState,
  getEffectiveBackdropRotationState,
  tryRotatePoster,
  tryRotateBackdrop,
  dynamicRotationBucket,
  secondsUntilDynamicRotationCut,
  rotationIndexFor,
  getDynamicRotationBucket,
} from "@/lib/poster-rotation"
import { getAll, getById, getImdbAlias, upsert } from "@/lib/store"
import { mappingVersionParam } from "@/lib/stremio-poster-url"
import type { Mapping } from "@/lib/types"

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(async () => null),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
  userRateLimitKey: vi.fn(() => "test-user-key"),
}))

// Namespaced ?u= requests: keep every real behavior except the three seam
// functions (same passthrough pattern as imdb-alias-route.test.ts).
vi.mock("@/lib/user-auth", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-auth")>()
  return {
    ...mod,
    getScopedUserId: (raw: string | null) => raw,
    userExists: async () => true,
    userRateLimitKey: () => "test-user-key",
  }
})

vi.mock("@/lib/user-activity", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/user-activity")>()
  return { ...mod, touchUserActivity: vi.fn() }
})

// The dynamic rotation flags live in server defaults; enable them here so the
// unmapped GET test exercises the real dynamic branch. Saved-mapping tests are
// unaffected (a mapping disables the dynamic branch by construction).
vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaultsChecked: async () => ({
      autoRotateClean: true,
      defaultAutoRotateBackdrop: true,
      region: "IT",
    }),
  }
})

const HOUR = 3_600_000
const DAY = 24 * HOUR
const USER = "11111111-2222-3333-4444-555555555555"

function baseMapping(input: Partial<Mapping> & { tmdbId: number }): Mapping {
  return {
    mediaType: "movie",
    title: "Rotation Store Test",
    posterPath: "/a.jpg",
    logoPath: null,
    originalPosterPath: "/a.jpg",
    language: null,
    updatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
    ...input,
  }
}

// Separate maps mirror the real store strictness: a namespaced read never
// falls back to global (store.ts getById). The user map is keyed by namespace
// so two-user isolation is testable. getById returns a clone, as on disk:
// callers cannot mutate the store without going through upsert.
let globalDb: Map<string, Mapping>
let userDb: Map<string, Mapping>
const dbKey = (type: string, id: number) => `${type}:${id}`
const userKey = (userId: string, type: string, id: number) => `${userId}:${type}:${id}`

function seedGlobal(m: Mapping): Mapping {
  const copy = { ...m }
  globalDb.set(dbKey(copy.mediaType, copy.tmdbId), copy)
  return copy
}

function seedUser(userId: string, m: Mapping): Mapping {
  const copy = { ...m }
  userDb.set(userKey(userId, copy.mediaType, copy.tmdbId), copy)
  return copy
}

function storedGlobal(type: string, id: number): Mapping | undefined {
  return globalDb.get(dbKey(type, id))
}

function storedUser(userId: string, type: string, id: number): Mapping | undefined {
  return userDb.get(userKey(userId, type, id))
}

// Shared TMDB/fetch harness for the GET tests.
let png: Buffer
const fetchedUrls: string[] = []
let imagesFixture: (id: number) => { posters: unknown[]; logos: unknown[]; backdrops: unknown[] } =
  () => ({ posters: [], logos: [], backdrops: [] })

function tmdbImage(filePath: string, iso: string | null, w: number, h: number) {
  return { file_path: filePath, iso_639_1: iso, vote_average: 0, width: w, height: h }
}

function tmdbDetails(id: number) {
  return {
    id,
    title: `Film ${id}`,
    original_language: "en",
    genres: [{ id: 28, name: "Action" }],
    vote_average: 7.5,
    vote_count: 100,
    status: "Released",
    release_date: "2020-01-01",
    backdrop_path: null,
    networks: [],
    production_companies: [],
  }
}

async function fetchRouter(input: unknown): Promise<Response> {
  const url = String(input)
  if (url.includes("mdblist.com/api")) return Response.json({ ratings: [] })
  if (url.includes("mdblist")) return Response.json([])
  if (url.includes("justwatch") || url.includes("graphql")) {
    return Response.json({ data: { streamingCharts: { edges: [] } } })
  }
  if (url.includes("sparql") || url.includes("wikidata")) {
    return Response.json({ results: { bindings: [] } })
  }
  if (url.includes("image.tmdb.org")) {
    fetchedUrls.push(url)
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "content-type": "image/png" },
    })
  }
  const m = /\/(movie|tv)\/(\d+)/.exec(url)
  const id = Number(m?.[2] ?? 0)
  if (url.includes("/external_ids")) return Response.json({ id, imdb_id: `tt${id}` })
  if (url.includes("/images")) return Response.json({ id, ...imagesFixture(id) })
  if (url.includes("/keywords")) return Response.json({ id, keywords: [] })
  if (url.includes("/videos")) return Response.json({ id, results: [] })
  if (url.includes("/credits")) return Response.json({ id, cast: [], crew: [] })
  if (url.includes("/release_dates")) return Response.json({ id, results: [] })
  if (/\/3\/(?:movie|tv)\/\d+/.test(url)) return Response.json(tmdbDetails(id))
  throw new Error(`rotation router: unhandled URL ${url.slice(0, 120)}`)
}

async function getPoster(id: number, extra = ""): Promise<Response> {
  return posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test${extra}`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
}

beforeEach(async () => {
  globalDb = new Map()
  userDb = new Map()
  vi.clearAllMocks()
  vi.mocked(getById).mockImplementation(async (type, id, userId?: string | null) => {
    const hit = userId
      ? userDb.get(userKey(userId, type, id))
      : globalDb.get(dbKey(type, id))
    return hit ? { ...hit } : null
  })
  vi.mocked(upsert).mockImplementation(async (m, userId?: string | null) => {
    if (userId) userDb.set(userKey(userId, m.mediaType, m.tmdbId), { ...m })
    else globalDb.set(dbKey(m.mediaType, m.tmdbId), { ...m })
  })
  vi.mocked(getAll).mockImplementation(async (userId?: string | null) => {
    if (!userId) return [...globalDb.values()].map((m) => ({ ...m }))
    const prefix = `${userId}:`
    return [...userDb.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, m]) => ({ ...m }))
  })
  vi.mocked(getImdbAlias).mockResolvedValue(null)
  cacheClear()
  __resetTMDBSessionCache()
  __resetPosterRenderLimiter()
  __resetMdblistBreaker()
  __resetJWRankingsCache()
  __resetCircuitBreaker()
  clearTvdbCache()
  __resetImageBytesForTest()
  fetchedUrls.length = 0
  imagesFixture = () => ({ posters: [], logos: [], backdrops: [] })
  png = await sharp({
    create: { width: 500, height: 750, channels: 3, background: "#28304a" },
  })
    .png()
    .toBuffer()
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchRouter as typeof fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
})

describe("tryRotatePoster against the store (sliding 24h, not a UTC day)", () => {
  function rotatingPoster(input: Partial<Mapping> & { tmdbId: number }): Mapping {
    return seedGlobal(baseMapping({
      posterPath: "/a.jpg",
      cleanPosters: ["/a.jpg", "/b.jpg"],
      cleanPosterIndex: 0,
      cleanPosterUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateClean: true,
      ...input,
    }))
  }

  it("returns null before 24h with no write and an untouched store", async () => {
    const m = rotatingPoster({
      tmdbId: 611001,
      cleanPosterUpdatedAt: new Date(Date.now() - DAY + 60_000).toISOString(),
    })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res).toBeNull()
    expect(vi.mocked(upsert)).not.toHaveBeenCalled()
    expect(storedGlobal("movie", 611001)?.posterPath).toBe("/a.jpg")
  })

  it("does not rotate at exactly 24h (the <= bound is deliberate: sliding window, not a day cut)", async () => {
    const T = Date.UTC(2026, 9, 6, 12, 0, 0)
    vi.spyOn(Date, "now").mockReturnValue(T)
    const m = rotatingPoster({
      tmdbId: 611002,
      cleanPosterUpdatedAt: new Date(T - DAY).toISOString(),
    })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res).toBeNull()
    expect(vi.mocked(upsert)).not.toHaveBeenCalled()
  })

  it("rotates just after 24h: returns the updated mapping AND persists the store", async () => {
    const T = Date.UTC(2026, 9, 6, 12, 0, 0)
    vi.spyOn(Date, "now").mockReturnValue(T)
    const m = rotatingPoster({
      tmdbId: 611003,
      cleanPosterUpdatedAt: new Date(T - DAY - 1_000).toISOString(),
    })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res).not.toBeNull()
    expect(res?.posterPath).toBe("/b.jpg")
    expect(res?.cleanPosterIndex).toBe(1)
    expect(res?.cleanPosterUpdatedAt).toBe(new Date(T).toISOString())
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    const persisted = storedGlobal("movie", 611003)
    expect(persisted?.posterPath).toBe("/b.jpg")
    expect(persisted?.cleanPosterIndex).toBe(1)
    expect(persisted?.cleanPosterUpdatedAt).toBe(new Date(T).toISOString())
  })

  it("starts at index 0 when index/timestamp are missing (missing timestamp is always due)", async () => {
    const m = rotatingPoster({
      tmdbId: 611004,
      posterPath: "/other.jpg",
      cleanPosterIndex: undefined,
      cleanPosterUpdatedAt: undefined,
    })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res?.posterPath).toBe("/a.jpg")
    expect(res?.cleanPosterIndex).toBe(0)
    expect(storedGlobal("movie", 611004)?.posterPath).toBe("/a.jpg")
  })

  it("wraps around from the last poster to the first", async () => {
    const m = rotatingPoster({
      tmdbId: 611005,
      posterPath: "/c.jpg",
      cleanPosters: ["/a.jpg", "/b.jpg", "/c.jpg"],
      cleanPosterIndex: 2,
    })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res?.posterPath).toBe("/a.jpg")
    expect(res?.cleanPosterIndex).toBe(0)
  })

  it("same path refreshes only the timestamps and returns null", async () => {
    // Index 0 over [/a, /b] with posterPath already /b.jpg: next index is 1,
    // which points at the current path.
    const m = rotatingPoster({ tmdbId: 611006, posterPath: "/b.jpg" })
    const before = storedGlobal("movie", 611006)?.cleanPosterUpdatedAt
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res).toBeNull()
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(storedGlobal("movie", 611006)?.posterPath).toBe("/b.jpg")
    expect(storedGlobal("movie", 611006)?.cleanPosterUpdatedAt).not.toBe(before)
  })

  it("is idempotent: a second immediate call returns null with a single total write", async () => {
    const m = rotatingPoster({ tmdbId: 611007 })
    const first = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(first).not.toBeNull()
    const second = await tryRotatePoster(first!, getEffectiveRotationState(first!))
    expect(second).toBeNull()
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
  })

  it("flag off returns null without even reading the store", async () => {
    const m = rotatingPoster({ tmdbId: 611008, autoRotateClean: false })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res).toBeNull()
    expect(vi.mocked(getById)).not.toHaveBeenCalled()
    expect(vi.mocked(upsert)).not.toHaveBeenCalled()
  })

  it("pool < 2 in the passed state returns null without reading the store", async () => {
    const m = rotatingPoster({ tmdbId: 611009, cleanPosters: ["/a.jpg"] })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res).toBeNull()
    expect(vi.mocked(getById)).not.toHaveBeenCalled()
  })

  it("stale snapshot: an exclusion added after the state was computed wins via re-read, null", async () => {
    const stale = baseMapping({
      tmdbId: 611010,
      posterPath: "/a.jpg",
      cleanPosters: ["/a.jpg", "/b.jpg"],
      autoRotateClean: true,
    })
    // State computed BEFORE the exclusion (2 available -> rotating).
    const staleState = getEffectiveRotationState(stale)
    expect(staleState.isRotating).toBe(true)
    // The store already excludes /b.jpg -> only 1 available.
    seedGlobal(baseMapping({
      tmdbId: 611010,
      posterPath: "/a.jpg",
      cleanPosters: ["/a.jpg", "/b.jpg"],
      cleanPosterIndex: 0,
      cleanPosterUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateClean: true,
      excludedPosters: ["/b.jpg"],
    }))
    const res = await tryRotatePoster(stale, staleState)
    expect(res).toBeNull()
    expect(vi.mocked(upsert)).not.toHaveBeenCalled()
  })

  it("missing mapping in the store returns null", async () => {
    const m = baseMapping({
      tmdbId: 611011,
      cleanPosters: ["/a.jpg", "/b.jpg"],
      autoRotateClean: true,
    })
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    expect(res).toBeNull()
  })

  it("concurrent calls produce exactly one rotation", async () => {
    const m = rotatingPoster({ tmdbId: 611012 })
    const state = getEffectiveRotationState(m)
    const [r1, r2] = await Promise.all([
      tryRotatePoster(m, state),
      tryRotatePoster(m, state),
    ])
    expect([r1, r2].filter(Boolean)).toHaveLength(1)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(storedGlobal("movie", 611012)?.posterPath).toBe("/b.jpg")
    expect(storedGlobal("movie", 611012)?.cleanPosterIndex).toBe(1)
  })

  it("the real mv changes with the rotation (invalidates Stremio URLs)", async () => {
    const m = rotatingPoster({ tmdbId: 611013 })
    const before = mappingVersionParam(m)
    expect(before).not.toBeNull()
    const res = await tryRotatePoster(m, getEffectiveRotationState(m))
    const after = mappingVersionParam(res)
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  })
})

describe("tryRotateBackdrop against the store (landscape mirror)", () => {
  function rotatingBackdrop(input: Partial<Mapping> & { tmdbId: number }): Mapping {
    return seedGlobal(baseMapping({
      backdropPath: "/bd1.jpg",
      cleanBackdrops: ["/bd1.jpg", "/bd2.jpg"],
      cleanBackdropIndex: 0,
      cleanBackdropUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateBackdrop: true,
      ...input,
    }))
  }

  it("rotates the backdrop after 24h: returned and persisted", async () => {
    const m = rotatingBackdrop({ tmdbId: 612001 })
    const res = await tryRotateBackdrop(m, getEffectiveBackdropRotationState(m))
    expect(res?.backdropPath).toBe("/bd2.jpg")
    expect(res?.cleanBackdropIndex).toBe(1)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(storedGlobal("movie", 612001)?.backdropPath).toBe("/bd2.jpg")
  })

  it("returns null before 24h and at exactly 24h", async () => {
    const m1 = rotatingBackdrop({
      tmdbId: 612002,
      cleanBackdropUpdatedAt: new Date(Date.now() - DAY + 60_000).toISOString(),
    })
    expect(await tryRotateBackdrop(m1, getEffectiveBackdropRotationState(m1))).toBeNull()
    const T = Date.UTC(2026, 9, 6, 12, 0, 0)
    vi.spyOn(Date, "now").mockReturnValue(T)
    const m2 = rotatingBackdrop({
      tmdbId: 612003,
      cleanBackdropUpdatedAt: new Date(T - DAY).toISOString(),
    })
    expect(await tryRotateBackdrop(m2, getEffectiveBackdropRotationState(m2))).toBeNull()
    expect(vi.mocked(upsert)).not.toHaveBeenCalled()
  })

  it("pool < 2 and flag off return null without reading the store", async () => {
    const m1 = rotatingBackdrop({ tmdbId: 612004, cleanBackdrops: ["/bd1.jpg"] })
    expect(await tryRotateBackdrop(m1, getEffectiveBackdropRotationState(m1))).toBeNull()
    const m2 = rotatingBackdrop({ tmdbId: 612005, autoRotateBackdrop: false })
    expect(await tryRotateBackdrop(m2, getEffectiveBackdropRotationState(m2))).toBeNull()
    expect(vi.mocked(getById)).not.toHaveBeenCalled()
  })

  it("shared poster/backdrop lock: both rotate with no lost update", async () => {
    const m = seedGlobal(baseMapping({
      tmdbId: 612006,
      posterPath: "/a.jpg",
      cleanPosters: ["/a.jpg", "/b.jpg"],
      cleanPosterIndex: 0,
      cleanPosterUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateClean: true,
      backdropPath: "/bd1.jpg",
      cleanBackdrops: ["/bd1.jpg", "/bd2.jpg"],
      cleanBackdropIndex: 0,
      cleanBackdropUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateBackdrop: true,
    }))
    const [rp, rb] = await Promise.all([
      tryRotatePoster(m, getEffectiveRotationState(m)),
      tryRotateBackdrop(m, getEffectiveBackdropRotationState(m)),
    ])
    expect(rp?.posterPath).toBe("/b.jpg")
    expect(rb?.backdropPath).toBe("/bd2.jpg")
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(2)
    const final = storedGlobal("movie", 612006)
    expect(final?.posterPath).toBe("/b.jpg")
    expect(final?.backdropPath).toBe("/bd2.jpg")
  })
})

describe("dynamic wiring with the real functions (02:00 UTC cut, no store)", () => {
  const beforeCut = Date.UTC(2026, 9, 1, 0, 0, 0)
  const atCut = Date.UTC(2026, 9, 1, 2, 0, 0)

  it("the bucket changes at the cut, so the :dd key fragment changes", async () => {
    const b1 = dynamicRotationBucket(atCut - 1)
    const b2 = dynamicRotationBucket(atCut)
    expect(b2).toBe(b1 + 1)
    expect(`:dd${b1}`).not.toBe(`:dd${b2}`)
  })

  it("the cut-aligned TTL is positive, never over 24h, minimum 60s", async () => {
    expect(secondsUntilDynamicRotationCut(Date.UTC(2026, 9, 1, 1, 0, 0))).toBe(3600)
    const ttl = secondsUntilDynamicRotationCut(Date.UTC(2026, 9, 1, 3, 0, 0))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(DAY / 1000)
  })

  it("the index advances by one per bucket over an even pool (same input, same image)", async () => {
    const pool = ["/a.jpg", "/b.jpg", "/c.jpg"]
    const b = dynamicRotationBucket(atCut)
    expect(pool[rotationIndexFor(b + 1, pool.length)]).not.toBe(pool[rotationIndexFor(b, pool.length)])
    expect(dynamicRotationBucket(beforeCut)).toBe(dynamicRotationBucket(atCut - 1))
    expect(dynamicRotationBucket(atCut + DAY)).toBe(b + 1)
  })

  it("opt-in gating: mapping, explicit poster, or flag off yields null", async () => {
    const open = {
      hasMapping: false,
      hasQueryPoster: false,
      isLandscape: false,
      portraitEnabled: true,
      backdropEnabled: true,
    }
    expect(getDynamicRotationBucket(open)).not.toBeNull()
    expect(getDynamicRotationBucket({ ...open, hasMapping: true })).toBeNull()
    expect(getDynamicRotationBucket({ ...open, hasQueryPoster: true })).toBeNull()
    expect(getDynamicRotationBucket({ ...open, portraitEnabled: false })).toBeNull()
    expect(getDynamicRotationBucket({
      ...open, isLandscape: true, portraitEnabled: true, backdropEnabled: false,
    })).toBeNull()
  })
})

describe("saved-poster GET: rotation runs before any cache read", () => {
  it("first GET rotates (one write) and changes mv; second GET does not rewrite", async () => {
    seedGlobal(baseMapping({
      tmdbId: 614001,
      title: "Rotation E2E",
      posterPath: "/a.jpg",
      cleanPosters: ["/a.jpg", "/b.jpg"],
      cleanPosterIndex: 0,
      cleanPosterUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateClean: true,
      showBadges: false,
      rankingBadges: false,
    }))
    const mvBefore = mappingVersionParam(storedGlobal("movie", 614001) ?? null)
    const first = await getPoster(614001)
    expect(first.status).toBe(200)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    const afterFirst = storedGlobal("movie", 614001)
    expect(afterFirst?.posterPath).toBe("/b.jpg")
    expect(afterFirst?.cleanPosterIndex).toBe(1)
    expect(mappingVersionParam(afterFirst ?? null)).not.toBe(mvBefore)

    const second = await getPoster(614001)
    expect(second.status).toBe(200)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(storedGlobal("movie", 614001)?.posterPath).toBe("/b.jpg")
  })
})

describe("namespaced rotation over real GET ?u= (regression)", () => {
  function dueUserMapping(userId: string, tmdbId: number, posterA: string, posterB: string): Mapping {
    return seedUser(userId, baseMapping({
      tmdbId,
      title: "User Rotation",
      posterPath: posterA,
      cleanPosters: [posterA, posterB],
      cleanPosterIndex: 0,
      cleanPosterUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateClean: true,
      showBadges: false,
      rankingBadges: false,
    }))
  }

  function dueGlobalMapping(tmdbId: number, posterA: string, posterB: string): Mapping {
    return seedGlobal(baseMapping({
      tmdbId,
      title: "Global Rotation",
      posterPath: posterA,
      cleanPosters: [posterA, posterB],
      cleanPosterIndex: 0,
      cleanPosterUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateClean: true,
      showBadges: false,
      rankingBadges: false,
    }))
  }

  it("a due user mapping rotates in its own namespace, global untouched", async () => {
    dueUserMapping(USER, 616001, "/u-a.jpg", "/u-b.jpg")
    const res = await getPoster(616001, `&u=${USER}`)
    expect(res.status).toBe(200)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsert).mock.calls[0][1]).toBe(USER)
    expect(storedUser(USER, "movie", 616001)?.posterPath).toBe("/u-b.jpg")
    expect(storedUser(USER, "movie", 616001)?.cleanPosterIndex).toBe(1)
    expect(storedGlobal("movie", 616001)).toBeUndefined()
    // The render uses the rotated user mapping.
    expect(fetchedUrls.some((u) => u.includes("/u-b.jpg"))).toBe(true)
  })

  it("with distinct global and user mappings, GET rotates only the user one", async () => {
    dueGlobalMapping(616002, "/g-a.jpg", "/g-b.jpg")
    dueUserMapping(USER, 616002, "/u-a.jpg", "/u-b.jpg")
    const res = await getPoster(616002, `&u=${USER}`)
    expect(res.status).toBe(200)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsert).mock.calls[0][1]).toBe(USER)
    expect(storedUser(USER, "movie", 616002)?.posterPath).toBe("/u-b.jpg")
    expect(storedGlobal("movie", 616002)?.posterPath).toBe("/g-a.jpg")
    expect(storedGlobal("movie", 616002)?.cleanPosterIndex).toBe(0)
    expect(fetchedUrls.some((u) => u.includes("/u-b.jpg"))).toBe(true)
    expect(fetchedUrls.some((u) => u.includes("/g-b.jpg"))).toBe(false)
  })

  it("two users stay isolated: only the requesting namespace rotates", async () => {
    const USER_B = "22222222-3333-4444-5555-666666666666"
    dueUserMapping(USER, 616004, "/a-a.jpg", "/a-b.jpg")
    dueUserMapping(USER_B, 616004, "/b-a.jpg", "/b-b.jpg")
    const res = await getPoster(616004, `&u=${USER}`)
    expect(res.status).toBe(200)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsert).mock.calls[0][1]).toBe(USER)
    expect(storedUser(USER, "movie", 616004)?.posterPath).toBe("/a-b.jpg")
    expect(storedUser(USER_B, "movie", 616004)?.posterPath).toBe("/b-a.jpg")
    expect(storedUser(USER_B, "movie", 616004)?.cleanPosterIndex).toBe(0)
    expect(storedGlobal("movie", 616004)).toBeUndefined()
  })

  it("a due user backdrop mapping rotates in its own namespace", async () => {
    seedUser(USER, baseMapping({
      tmdbId: 616005,
      title: "User Backdrop Rotation",
      posterShape: "landscape",
      backdropPath: "/bd-u1.jpg",
      cleanBackdrops: ["/bd-u1.jpg", "/bd-u2.jpg"],
      cleanBackdropIndex: 0,
      cleanBackdropUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateBackdrop: true,
      showBadges: false,
      rankingBadges: false,
    }))
    seedGlobal(baseMapping({
      tmdbId: 616005,
      title: "Global Backdrop Rotation",
      posterShape: "landscape",
      backdropPath: "/bd-g1.jpg",
      cleanBackdrops: ["/bd-g1.jpg", "/bd-g2.jpg"],
      cleanBackdropIndex: 0,
      cleanBackdropUpdatedAt: new Date(Date.now() - 25 * HOUR).toISOString(),
      autoRotateBackdrop: true,
      showBadges: false,
      rankingBadges: false,
    }))
    const res = await getPoster(616005, `&u=${USER}`)
    expect(res.status).toBe(200)
    expect(vi.mocked(upsert)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(upsert).mock.calls[0][1]).toBe(USER)
    expect(storedUser(USER, "movie", 616005)?.backdropPath).toBe("/bd-u2.jpg")
    expect(storedGlobal("movie", 616005)?.backdropPath).toBe("/bd-g1.jpg")
  })
})

describe("dynamic GET across the day cut (unmapped, logo + 2 clean posters)", () => {
  const T1 = Date.UTC(2026, 9, 1, 1, 59, 0)
  const T2 = Date.UTC(2026, 9, 1, 2, 1, 0)

  beforeEach(() => {
    imagesFixture = (id) =>
      id === 616003
        ? {
            posters: [
              tmdbImage("/dyn-a.jpg", null, 500, 750),
              tmdbImage("/dyn-b.jpg", null, 500, 750),
              tmdbImage("/dyn-lang.jpg", "en", 500, 750),
            ],
            logos: [{ ...tmdbImage("/dyn-logo.png", "en", 300, 150) }],
            backdrops: [],
          }
        : { posters: [], logos: [], backdrops: [] }
  })

  it("switches the base image and ETag at the cut with cut-aligned TTL headers", async () => {
    const pool = ["/dyn-a.jpg", "/dyn-b.jpg"]
    const b1 = dynamicRotationBucket(T1)
    const b2 = dynamicRotationBucket(T2)
    expect(b2).toBe(b1 + 1)
    const expected1 = pool[rotationIndexFor(b1, pool.length)]
    const expected2 = pool[rotationIndexFor(b2, pool.length)]
    expect(expected2).not.toBe(expected1)

    vi.spyOn(Date, "now").mockReturnValue(T1)
    const res1 = await getPoster(616003)
    expect(res1.status).toBe(200)
    expect(fetchedUrls.some((u) => u.includes(expected1))).toBe(true)

    fetchedUrls.length = 0
    vi.spyOn(Date, "now").mockReturnValue(T2)
    const res2 = await getPoster(616003)
    expect(res2.status).toBe(200)
    expect(fetchedUrls.some((u) => u.includes(expected2))).toBe(true)

    const etag1 = res1.headers.get("etag")
    const etag2 = res2.headers.get("etag")
    expect(etag1).not.toBeNull()
    expect(etag2).not.toBeNull()
    expect(etag2).not.toBe(etag1)

    const cc1 = res1.headers.get("cache-control") ?? ""
    const cc2 = res2.headers.get("cache-control") ?? ""
    expect(cc1).toContain(`max-age=${secondsUntilDynamicRotationCut(T1)}`)
    expect(cc2).toContain(`max-age=${secondsUntilDynamicRotationCut(T2)}`)
  })
})
