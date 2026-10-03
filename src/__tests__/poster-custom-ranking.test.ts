// Poster custom ranking integration: the poster route resolves the global
// Top 20 source through the shared service (same selection as catalogs and
// trending/rank) on the trendRank channel. Rank is read back from the
// response ETag (`:<rank>:` right after the sha, appended for unmapped
// non-preview renders): it proves which channel fed finalRank without
// screenshotting pixels (the badge SVG path itself is covered by the visual
// suite). JustWatch must never be consulted on a custom-driven slot.

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
import { __clearTMDBCache } from "@/lib/tmdb"
import type { CustomCatalogConfig } from "@/lib/types"

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

import { getServerDefaults } from "@/lib/server-defaults"

const mockedDefaults = vi.mocked(getServerDefaults)

const RANK_CUSTOM: CustomCatalogConfig = {
  id: "rank-seven",
  name: "Seven List",
  type: "movie",
  url: "https://mdblist.com/lists/u/rank-seven",
}

const OUT_CUSTOM: CustomCatalogConfig = {
  id: "rank-out",
  name: "Out List",
  type: "movie",
  url: "https://mdblist.com/lists/u/rank-out",
}

const BROKEN_CUSTOM: CustomCatalogConfig = {
  id: "rank-broken",
  name: "Broken",
  type: "movie",
  url: "https://www.imdb.com/list/ls1234567/",
}

let posterPng: Buffer
let jwCalls = 0
let listPayload: unknown[] = []

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

function jwEdges(ids: number[]) {
  return {
    data: {
      streamingCharts: {
        edges: ids.map((tmdbId, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: { content: { title: `JW ${tmdbId}`, externalIds: { tmdbId, imdbId: null } } },
        })),
      },
    },
  }
}

async function router(input: unknown): Promise<Response> {
  const url = String((input as { url?: unknown }).url ?? input)
  if (url.includes("apis.justwatch.com")) {
    jwCalls++
    return Response.json(jwEdges([707, 709]))
  }
  if (url.includes("/lists/u/rank-")) return Response.json(listPayload)
  if (url.includes("mdblist.com/api")) {
    return Response.json({ ratings: [{ source: "imdb", value: 8.0 }] })
  }
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
  const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
  const id = Number(m?.[1] ?? 0)
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
  if (/\/3\/(?:movie|tv)\/\d+/.test(url)) return Response.json(tmdbDetails(id))
  throw new Error(`poster-rank router: unhandled URL ${url.slice(0, 160)}`)
}

function rankOfEtag(etag: string | null): string | null {
  const match = /^"([0-9a-f]{64}):(\d+|X):/.exec(etag ?? "")
  return match ? match[2] : null
}

async function getPoster(id: number) {
  const res = await posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
  return res
}

function mockDefaults(custom: CustomCatalogConfig, sourceId: string) {
  mockedDefaults.mockReturnValue({
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    rankingBadges: true,
    globalBadges: true,
    badgeQuality: false,
    preRelease: false,
    region: "IT",
    customCatalogs: [custom],
    rankingSourceMovie: sourceId,
  })
}

describe("GET /api/poster with custom ranking source", () => {
  beforeEach(async () => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetPosterRenderLimiter()
    __resetMdblistBreaker()
    __resetJWRankingsCache()
    __resetCircuitBreaker()
    clearTvdbCache()
    __clearTMDBCache()
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
    mockedDefaults.mockReturnValue({})
    cacheClear()
  })

  it("renders the custom position on the trendRank channel without JW", async () => {
    mockDefaults(RANK_CUSTOM, "rank-seven")
    listPayload = [701, 702, 703, 704, 705, 706, 707].map((tmdb) => ({
      tmdb_id: tmdb,
      title: `Film ${tmdb}`,
      year: 2024,
      imdb_id: `tt${tmdb}`,
    }))

    const res = await getPoster(707)

    expect(res.status).toBe(200)
    // Custom #7 wins; the JW chart (which ranks 707 #1) is never consulted.
    expect(rankOfEtag(res.headers.get("etag"))).toBe("7")
    expect(jwCalls).toBe(0)
  })

  it("renders no badge outside the custom Top 20 even when JW ranks it #1", async () => {
    mockDefaults(OUT_CUSTOM, "rank-out")
    listPayload = [701, 702].map((tmdb) => ({
      tmdb_id: tmdb,
      title: `Film ${tmdb}`,
      year: 2024,
      imdb_id: `tt${tmdb}`,
    }))

    const res = await getPoster(707)

    expect(res.status).toBe(200)
    expect(rankOfEtag(res.headers.get("etag"))).toBe("X")
    expect(jwCalls).toBe(0)
  })

  it("renders no badge on provider errors without JW substitution", async () => {
    mockDefaults(BROKEN_CUSTOM, "rank-broken")
    listPayload = []

    const res = await getPoster(707)

    expect(res.status).toBe(200)
    expect(rankOfEtag(res.headers.get("etag"))).toBe("X")
    expect(jwCalls).toBe(0)
  })
})
