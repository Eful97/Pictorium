// B2 backdrop-crop fallback: titolo senza poster TMDB ma con backdrop →
// 200 con base 2:3 dal crop (attention) invece di 404. Trigger SOLO in
// sostituzione del 404: senza backdrop resta 404. Pipeline REALE con fetch
// stubbato (stesso pattern di provider-chaos.test.ts, harness minimo).

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
      defaultLogoFitEnabled: true,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      region: "IT",
      badgeQuality: false,
      preRelease: false,
    })),
  }
})

let backdropPng: Buffer

function tmdbDetails(id: number, withBackdrop: boolean) {
  return {
    id,
    title: `Film ${id}`,
    original_language: "en",
    genres: [{ id: 28, name: "Action" }],
    vote_average: 7.5,
    vote_count: 100,
    status: "Released",
    release_date: "2020-01-01",
    backdrop_path: withBackdrop ? `/bd${id}.jpg` : null,
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
    // w780 (backdrop crop source) o qualsiasi immagine: 16:9 di test.
    return new Response(new Uint8Array(backdropPng), {
      status: 200,
      headers: { "content-type": "image/png" },
    })
  }
  const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
  const id = Number(m?.[1] ?? 0)
  // Solo 620101 ha backdrop; 620102 è orfano totale (controllo 404).
  const withBackdrop = id === 620101 || id === 620103
  if (url.includes("/external_ids")) return Response.json({ id, imdb_id: `tt${id}` })
  if (url.includes("/images")) {
    return Response.json({ id, posters: [], logos: [], backdrops: [] })
  }
  if (url.includes("/keywords")) return Response.json({ id, keywords: [] })
  if (/\/3\/(?:movie|tv)\/\d+/.test(url)) return Response.json(tmdbDetails(id, withBackdrop))
  throw new Error(`backdrop-crop router: URL non gestito ${url.slice(0, 120)}`)
}

async function getPoster(id: number, extra = "") {
  const res = await posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test${extra}`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
  const buf = Buffer.from(await res.arrayBuffer())
  return { res, buf }
}

describe("B2 backdrop-crop fallback (404 → 200 con base 2:3)", () => {
  beforeEach(async () => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetPosterRenderLimiter()
    __resetMdblistBreaker()
    __resetJWRankingsCache()
    __resetCircuitBreaker()
    clearTvdbCache()
    backdropPng = await sharp({
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

  it("renders 200 portrait 500x750 from the backdrop crop when no poster exists", async () => {
    const { res, buf } = await getPoster(620101)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("image/webp")
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
  })

  it("keeps 404 when neither poster nor backdrop exists", async () => {
    const { res } = await getPoster(620102)
    expect(res.status).toBe(404)
  })

  it("renders 200 landscape from backdrop when no poster exists", async () => {
    const { res, buf } = await getPoster(620103, "&shape=landscape")
    expect(res.status).toBe(200)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(768)
    expect(meta.height).toBe(432)
  })
})
