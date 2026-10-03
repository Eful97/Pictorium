// Local-only flow proof: a device without namespace state (profileless)
// mints a catalog-only token through the shared POST /api/config-token
// builder, then the rank API and the poster route resolve the SAME custom
// rank from `?config=` alone — no `u=`, no namespace customs, no JW.

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { POST as mintPOST } from "@/app/api/config-token/route"
import { GET as rankGET } from "@/app/api/trending/rank/route"
import { GET as posterGET } from "@/app/api/poster/[type]/[id]/route"
import { GET as configCatalogGET } from "@/app/c/[config]/catalog/[type]/[id]/route"
import { buildManifestResponse } from "@/lib/build-manifest"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetPosterRenderLimiter } from "@/lib/poster-runtime-cache"
import { __resetMdblistBreaker } from "@/lib/ratings"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetCircuitBreaker } from "@/lib/awards"
import { clearTvdbCache } from "@/lib/tvdb"
import { __clearTMDBCache } from "@/lib/tmdb"

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
  const visuals = {
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    blurEnabled: true,
    blurIntensity: 5,
    blurFade: 60,
    blurDarkness: 40,
    gradientHeight: 30,
    networkLogo: true,
    autoRotateClean: false,
    region: "IT",
  }
  const mocked = vi.fn(() => ({}))
  return {
    ...mod,
    getServerDefaults: mocked,
    getServerDefaultsChecked: vi.fn(async () => ({ ...visuals })),
    getServerDefaultsForUser: vi.fn(async () => ({})),
  }
})

const LIST_URL = "https://mdblist.com/lists/u/local-movies"
const LIST = [811, 812, 813].map((tmdb) => ({
  tmdb_id: tmdb,
  title: `Film ${tmdb}`,
  year: 2024,
  imdb_id: `tt${tmdb}`,
}))

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

async function router(input: unknown, init?: { body?: unknown }): Promise<Response> {
  const url = String((input as { url?: unknown }).url ?? input)
  if (url.includes("apis.justwatch.com")) {
    // Ranking charts (the contract under test) vs title offers (quality
    // badges, pre-existing and ranking-independent): count only the former.
    const body = typeof init?.body === "string" ? init.body : ""
    if (body.includes("streamingCharts")) {
      jwCalls++
      return Response.json({
        data: {
          streamingCharts: {
            edges: [
              { streamingChartInfo: { rank: 1 }, node: { content: { title: "JW 813", externalIds: { tmdbId: 813, imdbId: null } } } },
            ],
          },
        },
      })
    }
    return Response.json({ data: { popularTitles: { edges: [] } } })
  }
  if (url.includes("/lists/u/local-movies")) return Response.json(LIST)
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
  throw new Error(`local-only router: unhandled URL ${url.slice(0, 160)}`)
}

function rankOfEtag(etag: string | null): string | null {
  const match = /^"([0-9a-f]{64}):(\d+|X):/.exec(etag ?? "")
  return match ? match[2] : null
}

describe("local-only import list + source via config token", () => {
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
    cacheClear()
  })

  it("rank API and poster resolve the same custom rank from ?config= alone", async () => {
    // The device mints a catalog-only token (no namespace state anywhere).
    const mintRes = await mintPOST(
      new NextRequest("http://localhost/api/config-token", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          config: {
            customCatalogs: [
              { id: "local_m", name: "Local", type: "movie", url: LIST_URL },
            ],
            rankingSourceMovie: "local_m",
          },
        }),
      }),
    )
    expect(mintRes.status).toBe(200)
    const { token } = (await mintRes.json()) as { token: string }

    const rankRes = await rankGET(
      new NextRequest(
        `http://localhost:3000/api/trending/rank?type=movie&id=813&config=${token}`,
      ),
    )
    expect(rankRes.status).toBe(200)
    expect(await rankRes.json()).toMatchObject({ rank: 3, top: 20 })

    const posterRes = await posterGET(
      new NextRequest(`http://localhost:3000/api/poster/movie/813?api_key=test&config=${token}`),
      { params: Promise.resolve({ type: "movie", id: "813" }) },
    )
    expect(posterRes.status).toBe(200)
    expect(rankOfEtag(posterRes.headers.get("etag"))).toBe("3")
    expect(jwCalls).toBe(0)
  })

  it("install chain: manifest, /c/ catalog Top 20 and posters follow the token", async () => {
    const mintRes = await mintPOST(
      new NextRequest("http://localhost/api/config-token", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          config: {
            customCatalogs: [
              { id: "local_m", name: "Local", type: "movie", url: LIST_URL },
            ],
            rankingSourceMovie: "local_m",
          },
        }),
      }),
    )
    const { token } = (await mintRes.json()) as { token: string }

    // What Stremio installs: the manifest generated from the token URL.
    const manifestRes = await buildManifestResponse(
      new NextRequest(`https://pictorium.test/manifest.json?config=${token}`),
      null,
      token,
    )
    const manifest = (await manifestRes.json()) as {
      catalogs: Array<{ id: string; name: string; type: string }>
    }
    const jwMovies = manifest.catalogs.find((c) => c.id === "pictorium-jw-movies")
    expect(jwMovies?.name).toBe("Local")
    expect(manifest.catalogs.some((c) => c.id === "pictorium-custom-movie-local_m")).toBe(true)

    // What Stremio home calls: the Top 20 catalog under the token path.
    const catalogRes = await configCatalogGET(
      new NextRequest(`http://localhost:3000/c/${token}/catalog/movie/pictorium-jw-movies.json?api_key=test`),
      { params: Promise.resolve({ config: token, type: "movie", id: "pictorium-jw-movies.json" }) },
    )
    const catalog = (await catalogRes.json()) as {
      metas: Array<{ id: string; name: string; poster: string }>
    }
    expect(catalogRes.status).toBe(200)
    expect(catalog.metas.map((m) => m.id)).toEqual(["tmdb:811", "tmdb:812", "tmdb:813"])
    expect(jwCalls).toBe(0)

    // ...and its posters resolve through the same token (config travels in
    // the catalog poster URLs, never any key). Served poster URLs carry no
    // api_key by design, so the render uses the instance fallback here.
    const firstPoster = new NextRequest(catalog.metas[0].poster)
    expect(firstPoster.nextUrl.searchParams.get("config")).toBe(token)
    expect(firstPoster.nextUrl.searchParams.has("api_key")).toBe(false)
    process.env.PICTORIUM_TMDB_KEY = "test-instance-key"
    try {
      const posterRes = await posterGET(firstPoster, {
        params: Promise.resolve({ type: "movie", id: "811" }),
      })
      expect(posterRes.status).toBe(200)
      expect(rankOfEtag(posterRes.headers.get("etag"))).toBe("1")
      expect(jwCalls).toBe(0)
    } finally {
      delete process.env.PICTORIUM_TMDB_KEY
    }
  })
})
