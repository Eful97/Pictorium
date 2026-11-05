// @vitest-environment node
/**
 * Per-title Miniature rotation override → Stremio /meta.
 *
 * `mapping.thumbnailRotation` is a tri-state: explicit true/false wins on the
 * space `thumbnailRotation` default (and its config token), null/absent
 * inherits it. The ephemeral `?rotate=` query still wins over both. Only the
 * effective ON emits `rotate=1` (and the `:tr1` cache fragment), so OFF keeps
 * the fixed-still URL/body byte-identical.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/meta/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
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

function mockMapping(thumbnailRotation: boolean | null) {
  mockedGetById.mockResolvedValue({
    tmdbId: SERIES_ID,
    mediaType: "tv",
    title: "Serie Thumbnail",
    posterPath: "/poster.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2024-01-01T00:00:00.000Z",
    thumbnailRotation,
  })
}

beforeEach(() => {
  defaultsCtl.value = { episodeThumbnails: true }
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

describe("meta per-title thumbnailRotation override", () => {
  it("inherits the space default when the mapping has no choice", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailRotation: true }
    mockSeries()

    const { body } = await getMeta()
    expect(paramsOf(thumbnailOf(body)).get("rotate")).toBe("1")
    expect(cacheKeys.get.at(-1)).toContain(":tr1")
  })

  it("explicit ON wins over a space default OFF", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailRotation: false }
    mockMapping(true)
    mockSeries()

    const { body } = await getMeta()
    expect(paramsOf(thumbnailOf(body)).get("rotate")).toBe("1")
    expect(cacheKeys.get.at(-1)).toContain(":tr1")
  })

  it("explicit OFF wins over a space default ON and emits no rotate param", async () => {
    defaultsCtl.value = { episodeThumbnails: true, thumbnailRotation: true }
    mockMapping(false)
    mockSeries()

    const { body } = await getMeta()
    expect(paramsOf(thumbnailOf(body)).has("rotate")).toBe(false)
    // The composited URL still points at the fixed episode still.
    expect(paramsOf(thumbnailOf(body)).get("still")).toBe("/ep1.jpg")
    expect(cacheKeys.get.at(-1)).not.toContain(":tr1")
  })

  it("explicit OFF wins over an enabling config token", async () => {
    mockMapping(false)
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

    const { body } = await getMeta(`&config=${encodeURIComponent(token)}`)
    expect(paramsOf(thumbnailOf(body)).has("rotate")).toBe(false)
  })

  it("the ephemeral query still overrides the per-title choice", async () => {
    mockMapping(true)
    mockSeries()

    const { body } = await getMeta("&rotate=0")
    expect(paramsOf(thumbnailOf(body)).has("rotate")).toBe(false)
  })

  it("the ephemeral query can also turn rotation ON over an explicit per-title OFF", async () => {
    mockMapping(false)
    mockSeries()

    const { body } = await getMeta("&rotate=1")
    expect(paramsOf(thumbnailOf(body)).get("rotate")).toBe("1")
  })
})
