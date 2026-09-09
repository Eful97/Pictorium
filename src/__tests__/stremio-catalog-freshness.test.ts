import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __clearTMDBCache } from "@/lib/tmdb"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", () => ({
  getServerDefaults: vi.fn(() => ({})),
}))

// Epoch controllabile: simula il bump visto da UN'ALTRA istanza serverless.
let epoch = "e1"
vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => epoch),
  bumpCatalogEpoch: vi.fn(async () => epoch),
}))

const mockedGetById = vi.mocked(getById)
const mockedDefaults = vi.mocked(getServerDefaults)

function justWatchResponse(tmdbId: number): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          {
            streamingChartInfo: { rank: 1 },
            node: { content: { externalIds: { tmdbId, imdbId: "tt11198330" } } },
          },
        ],
      },
    },
  })
}

function tmdbShowResponse(tmdbId: number, name: string): Response {
  return Response.json({
    id: tmdbId,
    name,
    poster_path: "/poster.jpg",
    first_air_date: "2022-08-21",
  })
}

function emptyImagesResponse(): Response {
  return Response.json({ posters: [], logos: [], backdrops: [] })
}

function catalogRequest() {
  return new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
}

const PARAMS = { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) }

// Prepara una fase con titolo diverso: reset delle cache interne (JW + TMDB)
// così la nuova risposta mock viene davvero consumata.
function mockPhase(tmdbId: number, name: string) {
  __resetJWRankingsCache()
  __clearTMDBCache()
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(justWatchResponse(tmdbId))
    .mockResolvedValueOnce(tmdbShowResponse(tmdbId, name))
    .mockResolvedValueOnce(emptyImagesResponse())
}

async function catalogName(): Promise<string> {
  const res = await GET(catalogRequest(), PARAMS)
  const body = await res.json()
  expect(body.metas).toHaveLength(1)
  return body.metas[0].name as string
}

describe("catalog freshness across instances (F3)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
    epoch = "e1"
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    mockedDefaults.mockReset()
    mockedDefaults.mockReturnValue({})
    __resetJWRankingsCache()
    __clearTMDBCache()
    cacheClear()
  })

  it("serves the cached catalog on repeat calls, then recomputes after an epoch bump", async () => {
    mockPhase(94997, "Title One")
    expect(await catalogName()).toBe("Title One")

    // Stessa epoch, upstream cambiato → resta il cachato (nessun refetch utile).
    mockPhase(94998, "Title Two")
    expect(await catalogName()).toBe("Title One")

    // Bump visto da un'altra istanza → ricomputa, nuovo titolo.
    epoch = "e2"
    expect(await catalogName()).toBe("Title Two")
  })

  it("recomputes when server defaults change (sd hash in key)", async () => {
    mockPhase(94997, "Title One")
    expect(await catalogName()).toBe("Title One")

    mockedDefaults.mockReturnValue({ globalBadges: false })
    mockPhase(94998, "Title Two")
    const res = await GET(catalogRequest(), PARAMS)
    const body = await res.json()
    expect(body.metas[0].name).toBe("Title Two")
    // E i nuovi poster URL riflettono i default (badges=0 esplicito).
    expect(body.metas[0].poster).toContain("badges=0")
  })
})
