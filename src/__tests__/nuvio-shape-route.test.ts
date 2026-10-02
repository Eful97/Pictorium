// Nuvio {shape} a livello HTTP: la route risponde 200 con il canvas giusto
// per poster/landscape/square e per il placeholder non sostituito (raw ed
// encoded). Pipeline REALE con fetch stubbato (stesso harness di
// backdrop-crop-fallback.test.ts).

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
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      region: "IT",
      badgeQuality: false,
      preRelease: false,
    })),
  }
})

let testPng: Buffer

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
    backdrop_path: `/bd${id}.jpg`,
    networks: [],
    production_companies: [],
  }
}

async function router(input: unknown): Promise<Response> {
  const url = String(input)
  if (url.includes("mdblist.com/api")) {
    return Response.json({ ratings: [{ source: "imdb", value: 8.0 }] })
  }
  if (url.includes("mdblist")) return Response.json([])
  if (url.includes("justwatch") || url.includes("graphql")) {
    return Response.json({ data: { streamingCharts: { edges: [] } } })
  }
  if (url.includes("sparql") || url.includes("wikidata")) {
    return Response.json({ results: { bindings: [] } })
  }
  if (url.includes("image.tmdb.org")) {
    return new Response(new Uint8Array(testPng), {
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
      posters: [{ file_path: `/p${id}.jpg`, iso_639_1: "en", width: 500, height: 750 }],
      logos: [],
      backdrops: [{ file_path: `/bd${id}.jpg`, iso_639_1: null, width: 1280, height: 720 }],
    })
  }
  if (url.includes("/keywords")) return Response.json({ id, keywords: [] })
  if (/\/3\/(?:movie|tv)\/\d+/.test(url)) return Response.json(tmdbDetails(id))
  throw new Error(`nuvio-shape router: URL non gestito ${url.slice(0, 120)}`)
}

async function getPoster(id: number, extra = "") {
  const res = await posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test${extra}`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
  const buf = Buffer.from(await res.arrayBuffer())
  return { res, buf }
}

async function dims(buf: Buffer) {
  const meta = await sharp(buf).metadata()
  return { width: meta.width, height: meta.height }
}

describe("Nuvio shape placeholder (HTTP)", () => {
  beforeEach(async () => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetPosterRenderLimiter()
    __resetMdblistBreaker()
    __resetJWRankingsCache()
    __resetCircuitBreaker()
    clearTvdbCache()
    testPng = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#28304a" },
    })
      .png()
      .toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(router as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cacheClear()
  })

  it("shape=poster renders the portrait canvas", async () => {
    const { res, buf } = await getPoster(630301, "&shape=poster")
    expect(res.status).toBe(200)
    expect(await dims(buf)).toEqual({ width: 500, height: 750 })
  })

  it("shape=landscape renders the 16:9 canvas", async () => {
    const { res, buf } = await getPoster(630302, "&shape=landscape")
    expect(res.status).toBe(200)
    expect(await dims(buf)).toEqual({ width: 768, height: 432 })
  })

  it("shape=square falls back to the portrait canvas", async () => {
    const { res, buf } = await getPoster(630303, "&shape=square")
    expect(res.status).toBe(200)
    expect(await dims(buf)).toEqual({ width: 500, height: 750 })
  })

  it("unsubstituted placeholder (encoded) keeps the ordinary fallback without error", async () => {
    const { res, buf } = await getPoster(630304, "&shape=%7Bshape%7D")
    expect(res.status).toBe(200)
    // Senza mapping salvato il fallback ordinario è il verticale.
    expect(await dims(buf)).toEqual({ width: 500, height: 750 })
  })

  it("portrait and landscape renders differ", async () => {
    const portrait = await getPoster(630305, "&shape=poster")
    const landscape = await getPoster(630305, "&shape=landscape")
    expect(portrait.res.status).toBe(200)
    expect(landscape.res.status).toBe(200)
    expect(portrait.buf.equals(landscape.buf)).toBe(false)
  })
})
