// B2 backdrop-crop fallback: titolo senza poster TMDB ma con backdrop →
// 200 con base 2:3 dal crop (attention) invece di 404. Trigger SOLO in
// sostituzione del 404: senza backdrop resta 404. Pipeline REALE con fetch
// stubbato (stesso pattern di provider-chaos.test.ts, harness minimo).
// Lo stesso harness copre il ramo portrait SENZA poster clean (base dal
// primo backdrop clean, logo composto sopra): casi 620104-620106.

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
import { getById } from "@/lib/store"

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
// Colori distinti per path così i test possono PROVARE quale sorgente ha
// alimentato la base: backdrop clean = rosso, backdrop in lingua = blu scuro
// (backdropPng storico), poster = blu, logo = grigio chiaro.
let cleanBackdropPng: Buffer
let posterPng: Buffer
let logoPng: Buffer

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
  if (url.includes("api.mdblist.com")) {
    return Response.json({ ratings: [{ source: "imdb", value: 80, score: 80 }] })
  }
  if (url.includes("mdblist")) return Response.json([])
  if (url.includes("justwatch") || url.includes("graphql")) {
    return Response.json({ data: { streamingCharts: { edges: [] } } })
  }
  if (url.includes("sparql") || url.includes("wikidata")) {
    return Response.json({ results: { bindings: [] } })
  }
  if (url.includes("image.tmdb.org")) {
    // Backdrop crop source (w780) o qualsiasi immagine della pipeline.
    // `/bd404.jpg` simula un backdrop sparito da TMDB (fallback al poster).
    if (/\/bd404\.jpg$/.test(url)) return new Response(null, { status: 404 })
    const png = /\/bdclean\.jpg$/.test(url)
      ? cleanBackdropPng
      : url.includes("/logo") ? logoPng
        : /\/bd[^/]*\.jpg$/.test(url) ? backdropPng
          : posterPng
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "content-type": "image/png" },
    })
  }
  const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
  const id = Number(m?.[1] ?? 0)
  // Solo 620101/620103 hanno backdrop; 620102 è orfano totale (controllo 404).
  // 620104-620106: portrait senza clean (620105 senza backdrops, 620106 per
  // il controllo landscape invariato).
  const withBackdrop = id === 620101 || id === 620103
  if (url.includes("/external_ids")) return Response.json({ id, imdb_id: `tt${id}` })
  if (url.includes("/images")) {
    if (id === 620104 || id === 620106) {
      return Response.json({
        id,
        posters: [
          { aspect_ratio: 0.667, file_path: "/lang-it.jpg", height: 1500, iso_639_1: "it", vote_average: 7, width: 1000 },
          { aspect_ratio: 0.667, file_path: "/lang-en.jpg", height: 1500, iso_639_1: "en", vote_average: 7, width: 1000 },
        ],
        logos: [{ aspect_ratio: 3, file_path: "/logo-it.png", height: 100, iso_639_1: "it", vote_average: 0, width: 300 }],
        // Il PRIMO backdrop è in lingua (fr): la base deve venire dal clean.
        backdrops: [
          { aspect_ratio: 1.78, file_path: "/bdfr.jpg", height: 720, iso_639_1: "fr", vote_average: 0, width: 1280 },
          { aspect_ratio: 1.78, file_path: "/bdclean.jpg", height: 720, iso_639_1: null, vote_average: 0, width: 1280 },
        ],
      })
    }
    if (id === 620105) {
      return Response.json({
        id,
        posters: [{ aspect_ratio: 0.667, file_path: "/lang-it.jpg", height: 1500, iso_639_1: "it", vote_average: 7, width: 1000 }],
        logos: [{ aspect_ratio: 3, file_path: "/logo-it.png", height: 100, iso_639_1: "it", vote_average: 0, width: 300 }],
        backdrops: [],
      })
    }
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

/** Medie canale del render: la tinta della base sopravvive a gradiente/blur,
 *  così il test prova QUALE sorgente ha alimentato il canvas. */
async function avgChannels(buf: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let r = 0, g = 0, b = 0
  const n = info.width * info.height
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]
  }
  return { r: r / n, g: g / n, b: b / n }
}

async function getDebug(id: number, extra = ""): Promise<Record<string, unknown>> {
  const res = await posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test&debug=1${extra}`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
  return await res.json()
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
    cleanBackdropPng = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#c81e1e" },
    })
      .png()
      .toBuffer()
    posterPng = await sharp({
      create: { width: 1000, height: 1500, channels: 3, background: "#1e1ec8" },
    })
      .png()
      .toBuffer()
    logoPng = await sharp({
      create: { width: 300, height: 100, channels: 3, background: "#e5e7eb" },
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

// Portrait senza poster clean (ma con poster in lingua): la base diventa il
// cover-crop 2:3 del PRIMO backdrop clean e il logo resta composto sopra
// (base senza titolo cotto = clean, stesso invariante del ramo landscape).
describe("Portrait senza clean — base dal primo backdrop clean", () => {
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
    cleanBackdropPng = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#c81e1e" },
    })
      .png()
      .toBuffer()
    posterPng = await sharp({
      create: { width: 1000, height: 1500, channels: 3, background: "#1e1ec8" },
    })
      .png()
      .toBuffer()
    logoPng = await sharp({
      create: { width: 300, height: 100, channels: 3, background: "#e5e7eb" },
    })
      .png()
      .toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(router as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cacheClear()
  })

  it("usa il primo backdrop clean (non il primo in lingua) e tiene il logo", async () => {
    const { res, buf } = await getPoster(620104)
    expect(res.status).toBe(200)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
    // Base = backdrop clean (rosso), non il backdrop fr né il poster (blu).
    const avg = await avgChannels(buf)
    expect(avg.r).toBeGreaterThan(avg.b * 1.2)

    const debug = await getDebug(620104)
    const images = debug.images as { poster: string | null; logo: string | null }
    expect(images.poster).toBe("/bdclean.jpg")
    expect(images.logo).toBe("/logo-it.png")
  })

  it("senza backdrops la catena in lingua resta intatta e il logo è tolto", async () => {
    const { res, buf } = await getPoster(620105)
    expect(res.status).toBe(200)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
    // Base = poster in lingua (blu).
    const avg = await avgChannels(buf)
    expect(avg.b).toBeGreaterThan(avg.r * 1.2)

    const debug = await getDebug(620105)
    const images = debug.images as { poster: string | null; logo: string | null }
    expect(images.poster).toBe("/lang-it.jpg")
    expect(images.logo).toBeNull()
  })

  it("landscape resta invariato (base 16:9 dal backdrop)", async () => {
    const { res, buf } = await getPoster(620106, "&shape=landscape")
    expect(res.status).toBe(200)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(768)
    expect(meta.height).toBe(432)
  })
})

// Base portrait CONGELATA dal save (`portraitBackdropPath`): riaprendo il
// titolo il mapping governa la base, quindi il ramo mapping deve comporre lo
// stesso crop 2:3 del ramo automatico (non il poster in lingua), con il logo
// salvato sopra. Fallback: ogni errore torna al poster nominale del mapping.
describe("mapping con base portrait congelata (portraitBackdropPath)", () => {
  const savedMapping = (overrides: Record<string, unknown> = {}) => ({
    tmdbId: 620110,
    mediaType: "movie" as const,
    title: "Film 620110",
    posterPath: "/lang-it.jpg",
    logoPath: "/logo-it.png",
    originalPosterPath: "/lang-it.jpg",
    language: "it",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  })

  beforeEach(async () => {
    cacheClear()
    __resetTMDBSessionCache()
    __resetPosterRenderLimiter()
    __resetMdblistBreaker()
    __resetJWRankingsCache()
    __resetCircuitBreaker()
    clearTvdbCache()
    cleanBackdropPng = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#c81e1e" },
    })
      .png()
      .toBuffer()
    posterPng = await sharp({
      create: { width: 1000, height: 1500, channels: 3, background: "#1e1ec8" },
    })
      .png()
      .toBuffer()
    logoPng = await sharp({
      create: { width: 300, height: 100, channels: 3, background: "#e5e7eb" },
    })
      .png()
      .toBuffer()
    vi.spyOn(globalThis, "fetch").mockImplementation(router as typeof fetch)
  })

  afterEach(() => {
    vi.mocked(getById).mockReset()
    vi.restoreAllMocks()
    cacheClear()
  })

  it("usa il backdrop salvato (crop 2:3) invece del poster in lingua", async () => {
    vi.mocked(getById).mockResolvedValue(savedMapping({ portraitBackdropPath: "/bdclean.jpg" }) as never)
    const { res, buf } = await getPoster(620110)
    expect(res.status).toBe(200)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
    const avg = await avgChannels(buf)
    expect(avg.r).toBeGreaterThan(avg.b * 1.2)

    const debug = await getDebug(620110)
    const images = debug.images as { poster: string | null; logo: string | null }
    expect(images.poster).toBe("/bdclean.jpg")
    expect(images.logo).toBe("/logo-it.png")
  })

  it("backdrop sparito → fallback al poster nominale del mapping", async () => {
    vi.mocked(getById).mockResolvedValue(savedMapping({ portraitBackdropPath: "/bd404.jpg" }) as never)
    const { res, buf } = await getPoster(620110)
    expect(res.status).toBe(200)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
    const avg = await avgChannels(buf)
    expect(avg.b).toBeGreaterThan(avg.r * 1.2)

    const debug = await getDebug(620110)
    const images = debug.images as { poster: string | null }
    expect(images.poster).toBe("/lang-it.jpg")
  })

  it("landscape resta sul backdrop 16:9 (base congelata ignorata)", async () => {
    vi.mocked(getById).mockResolvedValue(savedMapping({ portraitBackdropPath: "/bdclean.jpg", backdropPath: "/bdfr.jpg" }) as never)
    const { res, buf } = await getPoster(620110, "&shape=landscape")
    expect(res.status).toBe(200)
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(768)
    expect(meta.height).toBe(432)
  })

  it("nessun portraitBackdropPath salvato → base storica (poster in lingua)", async () => {
    vi.mocked(getById).mockResolvedValue(savedMapping() as never)
    const { res, buf } = await getPoster(620110)
    expect(res.status).toBe(200)
    const avg = await avgChannels(buf)
    expect(avg.b).toBeGreaterThan(avg.r * 1.2)
  })
})
