// Poster streaming ranking integration: when the global Top 20 source is an
// imported Top 10 list, the poster preflight reads the SAME pinned family the
// list's own catalog serves (official chart position on the trendRank
// channel). JustWatch must never be consulted, and positions past the Top 10
// never produce a badge. Rank is read back from the response ETag (the badge
// SVG path itself is covered by the visual suite).

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(async () => null),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return {
    ...mod,
    getServerDefaults: mocked,
    getServerDefaultsChecked: vi.fn(async () => mocked()),
    getServerDefaultsForUser: vi.fn(async () => mocked()),
  }
})

vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn() }
})

vi.mock("@/lib/stremio-addon-server", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/stremio-addon-server")>()
  return { ...mod, fetchAddonCatalogPage: vi.fn() }
})

import { GET as posterGET } from "@/app/api/poster/[type]/[id]/route"
import { fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetPosterRenderLimiter } from "@/lib/poster-runtime-cache"
import { __resetMdblistBreaker } from "@/lib/ratings"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetCircuitBreaker } from "@/lib/awards"
import { clearTvdbCache } from "@/lib/tvdb"
import { __clearTMDBCache } from "@/lib/tmdb"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { familySlotKey, __resetChartGenerationForTest, type ChartRow } from "@/lib/chart-generation"
import { getServerDefaults } from "@/lib/server-defaults"
import { streamingCatalogId } from "@/lib/streaming-catalogs"

const mockedDefaults = vi.mocked(getServerDefaults)
const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)

const NETFLIX_MOVIES_ID = streamingCatalogId("netflix", "IT", "movies")

let posterPng: Buffer
let jwCalls = 0

function tmdbDetails(id: number) {
  return {
    id,
    title: `Film ${id}`,
    original_language: "en",
    genres: [{ id: 28, name: "Action" }],
    vote_average: 8.5,
    vote_count: 100,
    status: "Released",
    release_date: "2024-01-01",
    poster_path: `/p${id}.jpg`,
    backdrop_path: null,
    networks: [],
    production_companies: [],
  }
}

function pinWith(rows: Array<{ tmdbId: number; rank: number }>) {
  const generation = familySlotKey("stream:netflix:movie")
  return {
    id: generation,
    snapshot: {
      generation,
      group: "g",
      family: "stream:netflix:movie",
      status: "ok",
      rows: rows.map((r): ChartRow => ({ imdbId: null, title: null, ...r })),
      fetchedAt: 1,
      publishedAt: 2,
    },
  }
}

async function router(input: unknown): Promise<Response> {
  const url = String((input as { url?: unknown }).url ?? input)
  if (url.includes("apis.justwatch.com")) {
    jwCalls++
    return Response.json({ data: { streamingCharts: { edges: [] } } })
  }
  if (url.includes("api.mdblist.com")) return Response.json({ ratings: [] })
  if (url.includes("mdblist")) return Response.json([])
  if (url.includes("sparql") || url.includes("wikidata")) {
    return Response.json({ results: { bindings: [] } })
  }
  if (url.includes("image.tmdb.org")) {
    return new Response(new Uint8Array(posterPng), {
      status: 200,
      headers: { "content-type": "image/png" },
    })
  }
  const id = Number(/\/3\/(?:movie|tv)\/(\d+)/.exec(url)?.[1] ?? 0)
  if (url.includes("/external_ids")) return Response.json({ id, imdb_id: `tt${id}` })
  if (url.includes("/images")) {
    return Response.json({
      id,
      posters: [{ file_path: `/p${id}.jpg`, iso_639_1: null, width: 1000, height: 1500 }],
      logos: [],
      backdrops: [],
    })
  }
  if (url.includes("/keywords")) return Response.json({ id, keywords: [] })
  return Response.json(tmdbDetails(id))
}

function rankOfEtag(etag: string | null): string | null {
  const match = /^"([0-9a-f]{64}):(\d+|X):/.exec(etag ?? "")
  return match ? match[2] : null
}

async function getPoster(id: number) {
  return posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
}

function mockStreamingDefaults(rows: Array<{ tmdbId: number; rank: number }> | null) {
  mockedDefaults.mockReturnValue({
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    rankingBadges: true,
    globalBadges: true,
    badgeQuality: false,
    preRelease: false,
    region: "IT",
    streamingSelections: [{ service: "netflix", country: "IT" }],
    rankingSourceMovie: NETFLIX_MOVIES_ID,
  } as never)
  mockedEnsureFresh.mockResolvedValue((rows ? pinWith(rows) : { id: "live", snapshot: null }) as never)
}

describe("GET /api/poster with a streaming ranking source", () => {
  beforeEach(async () => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetPosterRenderLimiter()
    __resetMdblistBreaker()
    __resetJWRankingsCache()
    __resetCircuitBreaker()
    clearTvdbCache()
    __clearTMDBCache()
    __resetChartGenerationForTest()
    jwCalls = 0
    posterPng = await sharp({
      create: { width: 500, height: 750, channels: 3, background: "#28304a" },
    })
      .png()
      .toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(router as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedDefaults.mockReturnValue({} as never)
    mockedEnsureFresh.mockReset()
    vi.mocked(fetchAddonCatalogPage).mockReset()
    cacheClear()
  })

  it("renders the real addon list position without JW traffic or ranking-chart renewal", async () => {
    mockStreamingDefaults([])
    mockedDefaults.mockReturnValue({
      ...mockedDefaults(),
      rankingSourceMovie: "addon-movies",
      customCatalogs: [{
        id: "addon-movies",
        name: "Imported chart",
        type: "movie",
        url: "https://addon.example/manifest.json",
        addon: { manifestUrl: "https://addon.example/manifest.json", catalogId: "top", catalogType: "movie" },
      }],
    } as never)
    vi.mocked(fetchAddonCatalogPage).mockResolvedValue({
      items: [{ id: "tmdb:801" }, { id: "kitsu:9" }, { id: "tmdb:803" }],
      expiresAt: Date.now() + 60_000,
    })
    const response = await getPoster(803)
    expect(response.status).toBe(200)
    expect(rankOfEtag(response.headers.get("etag"))).toBe("3")
    expect(jwCalls).toBe(0)
    // Anime is an independent channel; only JW/streaming ranking renewal
    // must be absent when the selected source is an imported addon.
    expect(mockedEnsureFresh.mock.calls.every(([args]) => args.family.startsWith("anime:"))).toBe(true)
  })

  it("renders the official chart position without JW traffic", async () => {
    mockStreamingDefaults([
      { tmdbId: 801, rank: 1 },
      { tmdbId: 802, rank: 2 },
      { tmdbId: 803, rank: 5 },
    ])

    const res = await getPoster(803)

    expect(res.status).toBe(200)
    // Official position preserved (not renumbered to 3).
    expect(rankOfEtag(res.headers.get("etag"))).toBe("5")
    expect(jwCalls).toBe(0)
    expect(mockedEnsureFresh).toHaveBeenCalledWith(
      expect.objectContaining({ family: "stream:netflix:movie", regionCode: "IT" }),
    )
  })

  it("renders no badge outside the pinned Top 10", async () => {
    mockStreamingDefaults([{ tmdbId: 801, rank: 1 }])

    const res = await getPoster(999)

    expect(res.status).toBe(200)
    expect(rankOfEtag(res.headers.get("etag"))).toBe("X")
    expect(jwCalls).toBe(0)
  })

  it("renders no badge on a cold failure (never a JW substitute)", async () => {
    mockStreamingDefaults(null)

    const res = await getPoster(801)

    expect(res.status).toBe(200)
    expect(rankOfEtag(res.headers.get("etag"))).toBe("X")
    expect(jwCalls).toBe(0)
  })
})
