/**
 * Task D slice: honest `X-Pictorium-Source` on cache HIT and MISS.
 *
 * Regression: the hit path keyed the header on snapshot existence alone, so
 * cached skip/genre variant windows overclaimed the canonical snapshot's
 * FP/JW provenance while the identical miss said "unknown". The header must
 * derive the canonical-window status from the request (skip/genre/gate) plus
 * pin state, identically on both paths — with zero extra source I/O.
 *
 * Isolated from sibling slices: own DATA_DIR, own cache clears, file-scoped
 * module mocks (same pattern as streaming-selections.test.ts, disjoint dir).
 */
import fsp from "node:fs/promises"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/streaming-source-headers-test`,
}))

vi.mock("@/lib/flixpatrol", () => ({
  getTop10: vi.fn(),
  resolveFlixPlatformSides: vi.fn(),
}))

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/chart-renewal", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/chart-renewal")>()
  return { ...mod, ensureFreshChartFamily: vi.fn() }
})

vi.mock("@/lib/justwatch", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/justwatch")>()
  return { ...mod, getJWRankings: vi.fn(), getJWTitles: vi.fn() }
})

import { GET as catalogGET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { getTop10, resolveFlixPlatformSides } from "@/lib/flixpatrol"
import { getById } from "@/lib/store"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { getJWRankings, getJWTitles } from "@/lib/justwatch"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import {
  STREAMING_CATALOG_ID_PREFIX,
  STREAMING_SOURCE_HEADER,
} from "@/lib/streaming-catalogs"

const mockedGetTop10 = vi.mocked(getTop10)
const mockedResolveFlixSides = vi.mocked(resolveFlixPlatformSides)
const mockedGetById = vi.mocked(getById)
const mockedEnsureFresh = vi.mocked(ensureFreshChartFamily)
const mockedGetJWRankings = vi.mocked(getJWRankings)
const mockedGetJWTitles = vi.mocked(getJWTitles)

function tmdbDetails(id: number, name: string) {
  return {
    id,
    name,
    first_air_date: "2023-04-01",
    vote_average: 7.5,
    genres: [{ id: 18, name: "Dramma" }],
    backdrop_path: "/bd.jpg",
    overview: "Overview",
  }
}

function mockTmdbFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = String(input)
    if (url.includes("/images")) return Response.json({ logos: [] })
    if (url.includes("/external_ids")) return Response.json({ imdb_id: "tt9000001" })
    const m = /\/(movie|tv)\/(\d+)/.exec(url)
    if (m) return Response.json(tmdbDetails(Number(m[2]), m[1] === "movie" ? "Test Film" : "Test Show"))
    throw new Error(`unexpected fetch in test: ${url}`)
  })
}

function pinWith(
  rows: Array<{ tmdbId: number; imdbId: string | null; rank: number; title: string }>,
  provenance: string | null,
) {
  return {
    id: "20261022-00",
    snapshot: {
      generation: "20261022-00",
      group: "g",
      family: "platform:netflix:series",
      status: "ok",
      rows,
      fetchedAt: Date.now(),
      publishedAt: Date.now(),
      provenance,
    },
  }
}

const LIVE_PIN = { id: "live", snapshot: null }

const STREAM_ID = `${STREAMING_CATALOG_ID_PREFIX}netflix-it-series`

function liveRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    tmdbId: 100 + i,
    imdbId: `tt90000${String(i).padStart(2, "0")}`,
    rank: i + 1,
    title: `Live Title ${i + 1}`,
  }))
}

async function getCatalog(url: string) {
  const req = new NextRequest(url)
  return catalogGET(req, {
    params: Promise.resolve({ type: "series", id: `${STREAM_ID}.json` }),
  })
}

const STREAM_URL = `http://localhost:3000/catalog/series/${STREAM_ID}.json?api_key=k`

beforeEach(async () => {
  mockedGetById.mockResolvedValue(null)
  mockedGetTop10.mockReset()
  mockedResolveFlixSides.mockReset()
  mockedEnsureFresh.mockReset()
  mockedGetJWRankings.mockReset()
  mockedGetJWTitles.mockReset()
  // Genuine empty FP live result (no chart for the requested side): the
  // desired scenario is "FP live absent", represented honestly as an empty
  // payload — never a null that the typed contract forbids.
  mockedGetTop10.mockResolvedValue({ platform: "netflix", platformName: "Netflix", country: "it", movies: [], tv: [] })
  mockedGetJWRankings.mockResolvedValue(liveRows(12))
  mockedGetJWTitles.mockResolvedValue(liveRows(12))
  const { setServerDefaults } = await import("@/lib/server-defaults")
  await setServerDefaults({})
})

afterEach(() => {
  vi.restoreAllMocks()
  cacheClear()
  __clearTMDBCache()
  __clearImdbCache()
})

afterAll(async () => {
  await fsp.rm(`${process.cwd()}/test-results/streaming-source-headers-test`, { recursive: true, force: true })
})

describe("streaming source header hit/miss parity", () => {
  it("canonical fresh FP snapshot reports flixpatrol on miss and hit, with no fallback I/O", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never,
    )
    const first = await getCatalog(STREAM_URL)
    const second = await getCatalog(STREAM_URL)
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    expect(first.headers.get("Access-Control-Expose-Headers")).toContain(STREAMING_SOURCE_HEADER)
    expect(second.headers.get("Access-Control-Expose-Headers")).toContain(STREAMING_SOURCE_HEADER)
    expect(mockedGetTop10).not.toHaveBeenCalled()
    const body = await second.json()
    expect(body.metas).toHaveLength(1)
  })

  it("canonical JW snapshot reports justwatch on miss and hit", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "justwatch") as never,
    )
    const first = await getCatalog(STREAM_URL)
    const second = await getCatalog(STREAM_URL)
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("justwatch")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("justwatch")
  })

  it("skip variant stays unknown on miss and hit even with an FP pin", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never,
    )
    const url = `${STREAM_URL}&skip=10`
    const first = await getCatalog(url)
    const second = await getCatalog(url)
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
  })

  it("mapped genre variant stays unknown on miss and hit even with an FP pin", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never,
    )
    const url = `${STREAM_URL}&genre=Azione`
    const first = await getCatalog(url)
    const second = await getCatalog(url)
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
  })

  it("unmapped genre variant stays unknown on miss and hit even with an FP pin", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never,
    )
    const url = `${STREAM_URL}&genre=Supereroi`
    const first = await getCatalog(url)
    const second = await getCatalog(url)
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
  })

  it("genuine empty canonical snapshot keeps its provenance on miss and hit", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(pinWith([], "flixpatrol") as never)
    const first = await getCatalog(STREAM_URL)
    const second = await getCatalog(STREAM_URL)
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("flixpatrol")
    expect((await first.json()).metas).toEqual([])
  })

  it("live (unpinned) canonical window reports unknown on miss and hit", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(LIVE_PIN as never)
    const first = await getCatalog(STREAM_URL)
    const second = await getCatalog(STREAM_URL)
    expect(first.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
    expect(second.headers.get(STREAMING_SOURCE_HEADER)).toBe("unknown")
  })

  it("legacy platform catalogs send no source header (byte-identical contract)", async () => {
    mockTmdbFetch()
    mockedEnsureFresh.mockResolvedValue(
      pinWith([{ tmdbId: 11, imdbId: "tt1000001", rank: 1, title: "Test Show" }], "flixpatrol") as never,
    )
    const req = new NextRequest("http://localhost:3000/catalog/series/pictorium-netflix-series.json?api_key=k")
    const res = await catalogGET(req, {
      params: Promise.resolve({ type: "series", id: "pictorium-netflix-series.json" }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get(STREAMING_SOURCE_HEADER)).toBeNull()
    expect(res.headers.get("Access-Control-Expose-Headers")).toBeNull()
  })
})
