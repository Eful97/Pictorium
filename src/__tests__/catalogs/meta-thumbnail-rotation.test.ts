// @vitest-environment node
/**
 * Miniature daily-rotation flag → Stremio /meta parity.
 *
 * `thumbnailRotation` is a meta-only space flag like the other Miniature
 * choices: OFF (absent) keeps the historical fixed-still URL and cache key
 * byte-identical; ON emits `rotate=1` and the flag travels in the meta cache
 * key so a toggle can never serve a stale body. The config token overrides the
 * namespace/defaults and an explicit query overrides the token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache, posterUrl } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { encodeConfig } from "@/lib/config-token"
import { getById } from "@/lib/store"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

const defaultsCtl = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => defaultsCtl.value),
    getServerDefaultsChecked: vi.fn(async () => defaultsCtl.value),
    getServerDefaultsForUser: vi.fn(async () => defaultsCtl.value),
  }
})

vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => "e1"),
  bumpCatalogEpoch: vi.fn(async () => "e1"),
}))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

const cacheKeys = vi.hoisted(() => ({ set: [] as string[], get: [] as string[] }))

vi.mock("@/lib/cache", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/cache")>()
  return {
    ...mod,
    cacheGetShared: vi.fn(async (key: string, tags: string[]) => {
      cacheKeys.get.push(key)
      return mod.cacheGetShared(key, tags)
    }),
    cacheSet: vi.fn((key: string, value: unknown, tags: string[], ttl: number) => {
      cacheKeys.set.push(key)
      return mod.cacheSet(key, value, tags, ttl)
    }),
  }
})

const mockedGetById = vi.mocked(getById)
const ORIGIN = "http://localhost:3000"
const SERIES_ID = 94100

function mockSeries() {
  vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
    const value = String(url)
    if (value.includes("/images")) return Promise.resolve(Response.json({ id: SERIES_ID, logos: [] }))
    if (value.includes("/episode_groups")) return Promise.resolve(Response.json({ results: [] }))
    if (value.includes("/season/1")) {
      return Promise.resolve(Response.json({
        id: SERIES_ID,
        season_number: 1,
        name: "Stagione 1",
        episodes: [{
          id: 2001,
          season_number: 1,
          episode_number: 1,
          name: "Episodio 1",
          overview: "Trama 1",
          still_path: "/ep1.jpg",
          air_date: "2024-01-01",
          vote_average: 7.5,
        }],
      }))
    }
    return Promise.resolve(Response.json({
      id: SERIES_ID,
      name: "Serie Thumbnail",
      overview: "Test",
      first_air_date: "2024-01-01",
      vote_average: 8.0,
      genres: [{ id: 18, name: "Dramma" }],
      backdrop_path: "/backdrop.jpg",
      external_ids: { imdb_id: "tt9410000" },
      seasons: [{ season_number: 1, episode_count: 1 }],
      credits: { cast: [], crew: [] },
      videos: { results: [] },
    }))
  })
}

interface VideoLike {
  thumbnail?: string
}
interface MetaLike {
  videos?: VideoLike[]
}

async function getMeta(extraQuery = ""): Promise<{ status: number; body: { meta: MetaLike } }> {
  const req = new NextRequest(`${ORIGIN}/meta/series/tmdb:${SERIES_ID}.json?api_key=settings-key${extraQuery}`)
  const res = await GET(req, { params: Promise.resolve({ type: "series", id: `tmdb:${SERIES_ID}.json` }) })
  return { status: res.status, body: await res.json() }
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

function thumbnailOf(body: { meta: MetaLike }): string {
  return body.meta.videos![0].thumbnail!
}

beforeEach(() => {
  defaultsCtl.value = {}
  cacheKeys.set.length = 0
  cacheKeys.get.length = 0
  mockedGetById.mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  mockedGetById.mockReset()
  cacheClear()
  __clearTMDBCache()
  __clearImdbCache()
})

describe("meta thumbnailRotation", () => {
  it("OFF (absent) keeps the historical URL and cache key byte-identical", async () => {
    defaultsCtl.value = { episodeThumbnails: true }
    mockSeries()

    const { status, body } = await getMeta()
    expect(status).toBe(200)
    const thumbnail = thumbnailOf(body)
    const params = paramsOf(thumbnail)
    expect(params.has("rotate")).toBe(false)
    const key = cacheKeys.get.at(-1)!
    expect(key).toContain(":et1")
    expect(key).not.toContain(":tr1")
  })

  it("defaults ON emits rotate=1 and carries :tr1 in the cache key", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailRotation: true }
    mockSeries()

    const { body } = await getMeta()
    const thumbnail = thumbnailOf(body)
    expect(paramsOf(thumbnail).get("rotate")).toBe("1")
    expect(cacheKeys.get.at(-1)).toContain(":tr1")
  })

  it("config token enables rotation, explicit query overrides it", async () => {
    defaultsCtl.value = { episodeThumbnails: true }
    mockSeries()
    const token = encodeConfig({
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      blurEnabled: false,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: true,
      episodeThumbnails: true,
      thumbnailRotation: true,
    })

    const fromToken = await getMeta(`&config=${encodeURIComponent(token)}`)
    expect(paramsOf(thumbnailOf(fromToken.body)).get("rotate")).toBe("1")

    const fromQuery = await getMeta(`&config=${encodeURIComponent(token)}&rotate=0`)
    expect(paramsOf(thumbnailOf(fromQuery.body)).has("rotate")).toBe(false)
  })

  it("rotation OFF with a composited URL still points at the fixed still", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailRotation: false }
    mockSeries()

    const { body } = await getMeta()
    const thumbnail = thumbnailOf(body)
    expect(thumbnail).toContain("/api/thumbnail")
    expect(paramsOf(thumbnail).get("still")).toBe("/ep1.jpg")
    expect(paramsOf(thumbnail).has("rotate")).toBe(false)
    expect(thumbnail).not.toContain("api_key")
  })

  it("master OFF ignores the rotation flag and keeps the raw still", async () => {
    defaultsCtl.value = { thumbnailRotation: true }
    mockSeries()

    const { body } = await getMeta()
    expect(thumbnailOf(body)).toBe(posterUrl("/ep1.jpg", "w500"))
    expect(thumbnailOf(body)).not.toContain("/api/thumbnail")
  })
})
