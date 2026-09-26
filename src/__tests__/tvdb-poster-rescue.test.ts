// B1 TVDB rescue: titolo senza clean TMDB ma con logo + chiave TVDB →
// poster textless TVDB con logo composto (invece del fallback in lingua
// senza logo). Gating fail-fast: senza chiave, zero chiamate TVDB.
// Pipeline REALE con fetch stubbato (pattern backdrop-crop-fallback).

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

vi.mock("@/lib/server-defaults", () => ({
  getServerDefaults: vi.fn(() => ({
    defaultLogoFitEnabled: true,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    region: "IT",
    badgeQuality: false,
    preRelease: false,
  })),
}))

let posterPng: Buffer
let logoPng: Buffer
const requestedUrls: string[] = []
// Flag per-test: artwork TVDB con testo incorporato (invece che textless).
let tvdbWithText = false

function tmdbDetails(id: number) {
  return {
    id,
    title: `Serie ${id}`,
    original_language: "en",
    genres: [{ id: 18, name: "Dramma" }],
    vote_average: 8.0,
    vote_count: 50,
    status: "Continuing",
    first_air_date: "2020-01-01",
    backdrop_path: null,
    networks: [],
    production_companies: [],
    // Il vero TMDB con append_to_response=external_ids include sempre gli
    // external_ids (come il mock e2e): senza, il rescue non vedrebbe tvdb_id.
    external_ids: { imdb_id: `tt${id}`, tvdb_id: 75710 },
  }
}

async function router(input: unknown): Promise<Response> {
  const url = String(input)
  requestedUrls.push(url)
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
  // TVDB v4 (login → remoteid → artworks).
  if (url.includes("api4.thetvdb.com")) {
    if (url.endsWith("/login")) {
      return Response.json({ status: "success", data: { token: "mock-jwt" } })
    }
    if (url.includes("/search/remoteid/")) {
      return Response.json({ status: "success", data: [{ series: { id: 75710 } }] })
    }
    if (url.includes("/series/75710/artworks")) {
      return Response.json({
        status: "success",
        data: [
          { id: 1, image: "https://artworks.thetvdb.com/banners/v4/poster/1.jpg", language: "eng", type: 2, width: 680, height: 1000, includesText: tvdbWithText ? true : false, score: 9 },
          { id: 2, image: "https://artworks.thetvdb.com/banners/v4/fanart/2.jpg", language: "eng", type: 3, width: 1920, height: 1080, includesText: false, score: 9.9 },
        ],
      })
    }
    throw new Error(`tvdb router: URL non gestito ${url.slice(0, 120)}`)
  }
  if (url.includes("image.tmdb.org")) {
    const body = url.includes("/logo") ? logoPng : posterPng
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { "content-type": "image/png" },
    })
  }
  if (url.includes("artworks.thetvdb.com")) {
    return new Response(new Uint8Array(posterPng), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    })
  }
  const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
  const id = Number(m?.[1] ?? 0)
  if (url.includes("/external_ids")) {
    // tvdb_id diretto: zero RTT di search nel rescue.
    return Response.json({ id, imdb_id: `tt${id}`, tvdb_id: 75710 })
  }
  if (url.includes("/images")) {
    // Niente clean, un poster in lingua, un logo: il caso rescue.
    return Response.json({
      id,
      posters: [{ file_path: `/lang${id}.jpg`, iso_639_1: "en", width: 500, height: 750 }],
      logos: [{ file_path: `/logo${id}.png`, iso_639_1: "en", width: 400, height: 150 }],
      backdrops: [],
    })
  }
  if (url.includes("/keywords")) return Response.json({ id, keywords: [] })
  if (/\/3\/(?:movie|tv)\/\d+/.test(url)) return Response.json(tmdbDetails(id))
  throw new Error(`tvdb-rescue router: URL non gestito ${url.slice(0, 120)}`)
}

async function getPoster(type: string, id: number, extra = "") {
  const res = await posterGET(
    new NextRequest(`http://localhost:3000/api/poster/${type}/${id}?api_key=test${extra}`),
    { params: Promise.resolve({ type, id: String(id) }) },
  )
  const buf = Buffer.from(await res.arrayBuffer())
  return { res, buf }
}

describe("B1 TVDB poster rescue (no TMDB clean + logo + key)", () => {
  beforeEach(async () => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetPosterRenderLimiter()
    __resetMdblistBreaker()
    __resetJWRankingsCache()
    __resetCircuitBreaker()
    clearTvdbCache()
    requestedUrls.length = 0
    tvdbWithText = false
    posterPng = await sharp({
      create: { width: 500, height: 750, channels: 3, background: "#28304a" },
    })
      .png()
      .toBuffer()
    logoPng = await sharp({
      create: { width: 400, height: 150, channels: 4, background: "#ffffff" },
    })
      .png()
      .toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(router as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cacheClear()
  })

  it("renders 200 with the TVDB textless poster and keeps the logo", async () => {
    const { res, buf } = await getPoster("tv", 630101, "&tvdb_key=K")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("image/jpeg")
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
    // Il poster TVDB è stato scaricato e il logo TMDB composto (non droppato).
    expect(requestedUrls.some((u) => u.includes("artworks.thetvdb.com/banners/v4/poster/1.jpg"))).toBe(true)
    expect(requestedUrls.some((u) => u.includes("/logo630101.png"))).toBe(true)
  })

  it("gating fail-fast: without key, zero TVDB calls and language fallback", async () => {
    const { res, buf } = await getPoster("tv", 630102)
    expect(res.status).toBe(200)
    expect(requestedUrls.some((u) => u.includes("api4.thetvdb.com"))).toBe(false)
    expect(requestedUrls.some((u) => u.includes("artworks.thetvdb.com"))).toBe(false)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
  })

  it("rescue con testo: niente logo sopra (no doppio logo), blur forzato a 20/80", async () => {
    tvdbWithText = true
    // Stile Stremio unmapped: default globali iniettati nell'URL.
    const res = await posterGET(
      new NextRequest("http://localhost:3000/api/poster/tv/630103?api_key=test&tvdb_key=K&gradHeight=30&bf=50&debug=1"),
      { params: Promise.resolve({ type: "tv", id: "630103" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    // Base TVDB con testo, logo azzerato.
    expect(String(body.images.poster)).toContain("artworks.thetvdb.com")
    expect(body.images.logo).toBeNull()
    // Poster finale non-clean: i default 30/50 non vincono sul profilo 20/80.
    expect(body.appearance.blurHeight).toBe(20)
    expect(body.appearance.blurFade).toBe(80)
  })

  it("rescue textless: logo tenuto e blur ai default (base clean)", async () => {
    const res = await posterGET(
      new NextRequest("http://localhost:3000/api/poster/tv/630104?api_key=test&tvdb_key=K&gradHeight=30&bf=50&debug=1"),
      { params: Promise.resolve({ type: "tv", id: "630104" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(String(body.images.poster)).toContain("artworks.thetvdb.com")
    expect(body.images.logo).toContain("/logo630104.png")
    // Base clean-equivalente: nessuna forzatura.
    expect(body.appearance.blurHeight).toBe(30)
    expect(body.appearance.blurFade).toBe(50)
  })
})
