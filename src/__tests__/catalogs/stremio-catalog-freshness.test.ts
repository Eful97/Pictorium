import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest, pinChartFamily } from "@/lib/chart-generation"
import { __clearTMDBCache } from "@/lib/tmdb"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  // La route legge i default via getServerDefaultsChecked (revisione epoch):
  // nei test delega allo stesso mock controllabile (stesse asserzioni).
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

// Epoch controllabile: simula il bump visto da UN'ALTRA istanza serverless.
let epoch = "e1"
vi.mock("@/lib/catalog-epoch", () => ({
  getCatalogEpoch: vi.fn(async () => epoch),
  bumpCatalogEpoch: vi.fn(async () => epoch),
}))

const mockedGetById = vi.mocked(getById)
const mockedDefaults = vi.mocked(getServerDefaults)

let jwPhase: "one" | "two" = "one"
let jwCalls = 0
let detailCalls = 0

function justWatchResponse(tmdbId: number): Response {
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          {
            streamingChartInfo: { rank: 1 },
            node: { content: { title: `Chart ${tmdbId}`, externalIds: { tmdbId, imdbId: "tt11198330" } } },
          },
        ],
      },
    },
  })
}

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url)
    if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
      jwCalls++
      return justWatchResponse(jwPhase === "one" ? 94997 : 94998)
    }
    const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
    if (m) {
      if (urlStr.includes("/images")) return Response.json({ posters: [], logos: [], backdrops: [] })
      const id = Number(m[2])
      detailCalls++
      return Response.json({
        id,
        name: `Detail ${id}`,
        poster_path: "/poster.jpg",
        first_air_date: "2022-08-21",
      })
    }
    return Response.json({})
  })
}

function catalogRequest() {
  return new NextRequest("http://localhost:3000/catalog/series/pictorium-jw-series.json?api_key=settings-key")
}

const PARAMS = { params: Promise.resolve({ type: "series", id: "pictorium-jw-series.json" }) }

async function catalogName(): Promise<string> {
  const res = await GET(catalogRequest(), PARAMS)
  const body = await res.json()
  expect(body.metas).toHaveLength(1)
  return body.metas[0].name as string
}

const JW_SERIES = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:series:charts" }

describe("catalog freshness across instances (F3)", () => {
  let now: number

  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
    epoch = "e1"
    jwPhase = "one"
    jwCalls = 0
    detailCalls = 0
    now = Date.UTC(2026, 9, 22, 8, 0, 0) // Rome 10:00 -> slot 20261022-00
    vi.spyOn(Date, "now").mockImplementation(() => now)
    installFetchMock()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    mockedDefaults.mockReset()
    mockedDefaults.mockReturnValue({})
    __resetJWRankingsCache()
    __clearTMDBCache()
    cacheClear()
    // Fixed chart cycles: no cross-test snapshot/lease leakage.
    __resetChartGenerationForTest()
  })

  it("serves the cached catalog on repeat calls, then recomputes from the pin after an epoch bump", async () => {
    expect(await catalogName()).toBe("Detail 94997")
    expect(jwCalls).toBe(1)
    expect(detailCalls).toBe(1)

    // Stessa epoch, upstream cambiato → resta il cachato (nessun refetch utile).
    jwPhase = "two"
    expect(await catalogName()).toBe("Detail 94997")
    expect(jwCalls).toBe(1)
    expect(detailCalls).toBe(1)

    // Bump visto da un'altra istanza (con cache TMDB fredde: le svuotiamo per
    // simulare il cold start dell'altra istanza) → la chiave cambia e il body
    // viene ricomputato (details rifetchati), ma le righe restano quelle
    // pubblicate dello slot corrente: nessun refetch JW, nessun titolo fantasma.
    __clearTMDBCache()
    epoch = "e2"
    expect(await catalogName()).toBe("Detail 94997")
    expect(jwCalls).toBe(1)
    expect(detailCalls).toBe(2)
    const pin = await pinChartFamily(JW_SERIES)
    expect(pin.snapshot).not.toBeNull()
  })

  it("recomputes with new upstream rows after a slot boundary", async () => {
    expect(await catalogName()).toBe("Detail 94997")

    // Oltre il boundary di Roma le righe pubblicate scadono: il refresh
    // rifetcha upstream e pubblica la nuova classifica.
    now = Date.UTC(2026, 9, 22, 11, 0, 0) // Rome 13:00 -> slot 20261022-12
    jwPhase = "two"
    expect(await catalogName()).toBe("Detail 94998")
    expect(jwCalls).toBe(2)
    const pin = await pinChartFamily(JW_SERIES)
    expect(pin.id).toBe("20261022-12")
  })

  it("recomputes when server defaults change (sd hash in key)", async () => {
    expect(await catalogName()).toBe("Detail 94997")

    mockedDefaults.mockReturnValue({ globalBadges: false })
    jwPhase = "two"
    const res = await GET(catalogRequest(), PARAMS)
    const body = await res.json()
    // Stesso slot: righe pubblicate invariate, ma nuovo body con i default.
    expect(body.metas[0].name).toBe("Detail 94997")
    // E i nuovi poster URL riflettono i default (badges=0 esplicito).
    expect(body.metas[0].poster).toContain("badges=0")
  })
})
