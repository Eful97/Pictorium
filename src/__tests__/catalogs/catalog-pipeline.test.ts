import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear } from "@/lib/cache"
import { getById } from "@/lib/store"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetChartGenerationForTest } from "@/lib/chart-generation"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { encodeConfig } from "@/lib/config-token"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
  getAll: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return {
    ...mod,
    getServerDefaults: vi.fn(() => ({
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:trending",
    })),
    getServerDefaultsChecked: vi.fn(async () => ({
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:trending",
    })),
    getServerDefaultsForUser: vi.fn(async () => ({
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:trending",
    })),
  }
})

const mockedGetById = vi.mocked(getById)

const SLOW_ID = 1010101
const FAST_ID = 2020202
const FAIL_ID = 3030303

function titlesResponse(): Response {
  return Response.json({
    data: {
      popularTitles: {
        edges: [
          { node: { content: { title: "Slow Film", originalReleaseDate: "2026-01-01", externalIds: { tmdbId: SLOW_ID, imdbId: "tt1111111" } } } },
          { node: { content: { title: "Fast Film", originalReleaseDate: "2026-01-01", externalIds: { tmdbId: FAST_ID, imdbId: "tt2222222" } } } },
          { node: { content: { title: "Fallback Film", originalReleaseDate: "2026-01-01", externalIds: { tmdbId: FAIL_ID, imdbId: "tt3333333" } } } },
        ],
      },
    },
  })
}

function chartsResponse(): Response {
  // Platform branch source shape (streamingCharts): rank is required and past
  // release dates pass the unreleased filter. The duplicate FAST edge proves
  // the per-branch dedup (upstream getJWRankings also dedupes by tmdbId).
  return Response.json({
    data: {
      streamingCharts: {
        edges: [
          { streamingChartInfo: { rank: 1 }, node: { content: { title: "Slow Film", originalReleaseDate: "2026-01-01", externalIds: { tmdbId: SLOW_ID, imdbId: "tt1111111" } } } },
          { streamingChartInfo: { rank: 2 }, node: { content: { title: "Fast Film", originalReleaseDate: "2026-01-01", externalIds: { tmdbId: FAST_ID, imdbId: "tt2222222" } } } },
          { streamingChartInfo: { rank: 3 }, node: { content: { title: "Fast Film Dup", originalReleaseDate: "2026-01-01", externalIds: { tmdbId: FAST_ID, imdbId: "tt2222222" } } } },
          { streamingChartInfo: { rank: 4 }, node: { content: { title: "Fallback Film", originalReleaseDate: "2026-01-01", externalIds: { tmdbId: FAIL_ID, imdbId: "tt3333333" } } } },
        ],
      },
    },
  })
}

function animeItemsResponse(): Response {
  // fetchMDBList shape ({ items }) — the duplicate FAST tmdb proves dedup and
  // the FAIL row (details throws below) proves the fail-open list-data path.
  return Response.json({
    items: [
      { imdb: "tt1111111", title: "Slow Anime", year: 2026, tmdb: SLOW_ID },
      { imdb: "tt2222222", title: "Fast Anime", year: 2026, tmdb: FAST_ID },
      { imdb: "tt2222222", title: "Fast Anime Dup", year: 2026, tmdb: FAST_ID },
      { imdb: "tt3333333", title: "Fallback Anime", year: 2026, tmdb: FAIL_ID },
    ],
  })
}

function customItemsResponse(): Response {
  // fetchCustomMDBList shape ({ items }); direct tmdb ids skip the /find scan.
  // The FAIL row throws at details (transient/abort path): the row is still
  // served from list data and the body is flagged for short-TTL caching.
  return Response.json({
    items: [
      { tmdb: SLOW_ID, imdb: "tt1111111", title: "Slow Custom", year: 2026 },
      { tmdb: FAST_ID, imdb: "tt2222222", title: "Fast Custom", year: 2026 },
      { tmdb: FAIL_ID, imdb: "tt3333333", title: "Fallback Custom", year: 2026 },
    ],
  })
}

function detailsResponse(tmdbId: number, title: string, imdbId: string): Response {
  return Response.json({
    id: tmdbId,
    title,
    name: title,
    poster_path: "/poster.jpg",
    release_date: "2026-01-01",
    first_air_date: "2026-01-01",
    vote_average: 8.0,
    genres: [{ id: 28, name: "Azione" }],
    external_ids: { imdb_id: imdbId },
  })
}

function logosResponse(): Response {
  return Response.json({
    id: 1,
    logos: [{ file_path: "/logo.png", iso_639_1: "it" }],
  })
}

function catalogReq(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`)
}

function customToken(cid: string): string {
  return encodeConfig({
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "pill",
    rankingBadgeStyle: "pill",
    blurEnabled: true,
    blurIntensity: 12,
    blurFade: 45,
    blurDarkness: 55,
    gradientHeight: 50,
    networkLogo: true,
    autoRotateClean: false,
    customCatalogs: [
      { id: cid, name: `Pipe ${cid}`, type: "movie", url: "https://mdblist.com/lists/u/testuser/pipe", enabled: true },
    ],
  })
}

/**
 * Shared pipelined fetch router: list rows come from `rows`, logos from
 * `logosResponse`, details for SLOW_ID wait on `slowGate` (proves no
 * whole-batch barrier when another row enriches first), FAIL_ID throws
 * (proves the fail-open list-data path). Events record the observable order.
 */
function installPipelinedFetch(events: string[], rows: () => Response, slowGate: Promise<Response>): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url)
    if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
      return rows()
    }
    if (urlStr.includes("/lists/custom/") || urlStr.includes("/lists/snoak/") || urlStr.includes("mdblist")) {
      return rows()
    }
    // Images (logo enrichment) before details: the pattern below matches both.
    if (urlStr.includes("/images")) {
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      const id = m ? Number(m[2]) : 0
      events.push(`images-start:${id}`)
      const res = logosResponse()
      events.push(`images-settle:${id}`)
      return res
    }
    if (urlStr.includes("/external_ids")) {
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      const id = m ? Number(m[2]) : 0
      return Response.json({ id, imdb_id: null })
    }
    const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
    const id = m ? Number(m[2]) : 0
    if (id === SLOW_ID) {
      events.push(`details-start:${id}`)
      const res = await slowGate
      events.push(`details-settle:${id}`)
      return res
    }
    if (id === FAIL_ID) {
      events.push(`details-start:${id}`)
      events.push(`details-throw:${id}`)
      throw new Error("downstream down")
    }
    events.push(`details-start:${id}`)
    const res = detailsResponse(id, id === FAST_ID ? "Fast Film" : `Film ${id}`, id === FAST_ID ? "tt2222222" : `tt${id}`)
    events.push(`details-settle:${id}`)
    return res
  })
}

/**
 * Event-driven pipelining proof: the fast row's logo fetch began before the
 * slow row's details settled. With the old whole-batch barrier, no
 * images-start could precede every details-settle. Bounded (5s) so a
 * regression fails instead of hanging.
 */
async function expectPipelinedBeforeSlowSettle(events: string[], fastId: number, slowId: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(events).toContain(`images-start:${fastId}`)
    },
    { timeout: 5000, interval: 20 },
  )
  const slowSettle = events.indexOf(`details-settle:${slowId}`)
  expect(events.indexOf(`images-start:${fastId}`)).toBeLessThan(
    slowSettle === -1 ? Number.POSITIVE_INFINITY : slowSettle,
  )
}

describe("Catalog details→enrichment pipelining (no whole-batch barrier)", () => {
  beforeEach(() => {
    mockedGetById.mockResolvedValue(null)
    __resetJWRankingsCache()
    __clearTMDBCache()
    __clearImdbCache()
    cacheClear()
    // Per-family snapshots persist in memory across tests: without a reset,
    // an earlier publish would serve stale pinned rows instead of the mock.
    __resetChartGenerationForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    mockedGetById.mockReset()
    __resetJWRankingsCache()
    __clearTMDBCache()
    __clearImdbCache()
    cacheClear()
    __resetChartGenerationForTest()
  })

  it("JW: fast item enrichment starts before slow item details settle; order and fallback preserved", async () => {
    const events: string[] = []
    let resolveSlow!: (r: Response) => void
    const slowGate = new Promise<Response>((res) => {
      resolveSlow = res
    })
    installPipelinedFetch(events, titlesResponse, slowGate)

    const getPromise = GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=0"),
      { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) },
    )
    // The slow gate is always released and the owned GET always awaited, even
    // when the pipelining assertion above fails (no dangling request).
    let res: Response
    try {
      await expectPipelinedBeforeSlowSettle(events, FAST_ID, SLOW_ID)
    } finally {
      resolveSlow(detailsResponse(SLOW_ID, "Slow Film", "tt9999999"))
      res = await getPromise
    }
    expect(res!.status).toBe(200)
    const body = await res!.json()

    // Output order follows the ranking rows, not settle order.
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt1111111", "tt2222222", "tt3333333"])
    expect(body.metas.map((m: { name: string }) => m.name)).toEqual(["Slow Film", "Fast Film", "Fallback Film"])
    // IMDb-source-first: the JW-provided imdbId wins over details external_ids.
    expect(body.metas[0].id).toBe("tt1111111")
    // Fail-open fallback: the row whose details threw is still served from list data.
    expect(body.metas[2].name).toBe("Fallback Film")
    for (const meta of body.metas) {
      expect(typeof meta.poster).toBe("string")
      expect(typeof meta.banner).toBe("string")
    }
  })

  it("platform: pipelined enrichment with dedup, order and fail-open fallback", async () => {
    const events: string[] = []
    let resolveSlow!: (r: Response) => void
    const slowGate = new Promise<Response>((res) => {
      resolveSlow = res
    })
    installPipelinedFetch(events, chartsResponse, slowGate)

    const getPromise = GET(
      catalogReq("/catalog/movie/pictorium-netflix-movies.json?api_key=test-key&skip=0"),
      { params: Promise.resolve({ type: "movie", id: "pictorium-netflix-movies.json" }) },
    )
    let res: Response
    try {
      await expectPipelinedBeforeSlowSettle(events, FAST_ID, SLOW_ID)
    } finally {
      resolveSlow(detailsResponse(SLOW_ID, "Slow Film", "tt9999999"))
      res = await getPromise
    }
    expect(res!.status).toBe(200)
    const body = await res!.json()

    // Duplicate FAST edge collapsed, order follows the chart rows.
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt1111111", "tt2222222", "tt3333333"])
    expect(body.metas.map((m: { name: string }) => m.name)).toEqual(["Slow Film", "Fast Film", "Fallback Film"])
    expect(body.metas[0].id).toBe("tt1111111")
    expect(body.metas[2].name).toBe("Fallback Film")
    for (const meta of body.metas) {
      expect(typeof meta.poster).toBe("string")
      expect(typeof meta.banner).toBe("string")
    }
  })

  it("anime: pipelined enrichment with dedup, order and fail-open fallback", async () => {
    vi.stubEnv("MDBLIST_API_URL", "https://mdblist-mock.test")
    const events: string[] = []
    let resolveSlow!: (r: Response) => void
    const slowGate = new Promise<Response>((res) => {
      resolveSlow = res
    })
    installPipelinedFetch(events, animeItemsResponse, slowGate)

    const getPromise = GET(
      catalogReq("/catalog/movie/pictorium-anime-movies.json?api_key=test-key&skip=0"),
      { params: Promise.resolve({ type: "movie", id: "pictorium-anime-movies.json" }) },
    )
    let res: Response
    try {
      await expectPipelinedBeforeSlowSettle(events, FAST_ID, SLOW_ID)
    } finally {
      resolveSlow(detailsResponse(SLOW_ID, "Slow Anime", "tt9999999"))
      res = await getPromise
    }
    expect(res!.status).toBe(200)
    const body = await res!.json()

    // Duplicate FAST tmdb collapsed, order follows the MDBList rows.
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt1111111", "tt2222222", "tt3333333"])
    expect(body.metas.map((m: { name: string }) => m.name)).toEqual(["Slow Anime", "Fast Film", "Fallback Anime"])
    // Fail-open fallback: the row whose details threw keeps the list title.
    expect(body.metas[2].name).toBe("Fallback Anime")
    for (const meta of body.metas) {
      expect(typeof meta.poster).toBe("string")
      expect(typeof meta.banner).toBe("string")
    }
  })

  it("custom: pipelined enrichment with order and transient-failure fallback", async () => {
    vi.stubEnv("MDBLIST_API_URL", "https://mdblist-mock.test")
    const events: string[] = []
    let resolveSlow!: (r: Response) => void
    const slowGate = new Promise<Response>((res) => {
      resolveSlow = res
    })
    installPipelinedFetch(events, customItemsResponse, slowGate)

    const cid = "pipecustom"
    const token = customToken(cid)
    const getPromise = GET(
      catalogReq(`/catalog/movie/pictorium-custom-movie-${cid}.json?api_key=test-key&config=${token}`),
      { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) },
    )
    let res: Response
    try {
      await expectPipelinedBeforeSlowSettle(events, FAST_ID, SLOW_ID)
    } finally {
      resolveSlow(detailsResponse(SLOW_ID, "Slow Custom", "tt9999999"))
      res = await getPromise
    }
    expect(res!.status).toBe(200)
    const body = await res!.json()

    // Order follows the resolved source rows, not settle order; the transient
    // details failure (throw, i.e. the abort/timeout path that flags the body
    // for short-TTL retry caching) still serves the row from list data.
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(["tt1111111", "tt2222222", "tt3333333"])
    expect(body.metas.map((m: { name: string }) => m.name)).toEqual(["Slow Custom", "Fast Film", "Fallback Custom"])
    expect(body.metas[2].name).toBe("Fallback Custom")
    for (const meta of body.metas) {
      expect(typeof meta.poster).toBe("string")
      expect(typeof meta.banner).toBe("string")
    }
  })

  it("caps in-flight title tasks at 5 with more rows than workers", async () => {
    const N = 7
    const ids = Array.from({ length: N }, (_, i) => 5000000 + i)
    const rowsPayload = () =>
      Response.json({
        data: {
          popularTitles: {
            edges: ids.map((id, i) => ({
              node: { content: { title: `Film ${i}`, originalReleaseDate: "2026-01-01", externalIds: { tmdbId: id, imdbId: `tt${6000000 + i}` } } },
            })),
          },
        },
      })
    let active = 0
    let maxActive = 0
    let started = 0
    let releaseGate!: () => void
    const gate = new Promise<void>((r) => {
      releaseGate = r
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url)
      if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
        return rowsPayload()
      }
      if (urlStr.includes("/images")) {
        return logosResponse()
      }
      const m = urlStr.match(/\/(movie|tv)\/(\d+)/)
      const id = m ? Number(m[2]) : 0
      started++
      active++
      maxActive = Math.max(maxActive, active)
      try {
        await gate
      } finally {
        active--
      }
      return detailsResponse(id, `Film ${ids.indexOf(id)}`, `tt${6000000 + ids.indexOf(id)}`)
    })

    const getPromise = GET(
      catalogReq("/catalog/movie/pictorium-jw-movies.json?api_key=test-key&skip=0"),
      { params: Promise.resolve({ type: "movie", id: "pictorium-jw-movies.json" }) },
    )
    // concurrentMap(limit 5) starts at most 5 title tasks: the 6th/7th rows
    // cannot start while the first 5 are gated. Bounded wait, always release
    // the gate and always await the owned GET, even on assertion failure.
    let res: Response
    try {
      await vi.waitFor(
        () => {
          expect(started).toBe(5)
        },
        { timeout: 5000, interval: 20 },
      )
      expect(maxActive).toBeLessThanOrEqual(5)
    } finally {
      releaseGate()
      res = await getPromise
    }
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metas).toHaveLength(N)
    // All 5 workers were simultaneously busy: the cap is tight, not just an
    // upper bound, and output order still follows the ranking rows.
    expect(maxActive).toBe(5)
    expect(body.metas.map((m: { id: string }) => m.id)).toEqual(ids.map((_, i) => `tt${6000000 + i}`))
  })
})
