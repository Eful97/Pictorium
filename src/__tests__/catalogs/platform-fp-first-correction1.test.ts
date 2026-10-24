import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Correction cycle 1 (FP-first per-side isolation): RED-before/GREEN-after.
//
// The strict adapter (`resolveFlixPlatformSides` with `freshOrThrow`) used to
// resolve BOTH sides eagerly and throw on ANY integrity violation — a
// malformed TV chart aborted a requested MOVIE renewal (and vice versa), and
// a malformed requested chart/doc threw before the strict JW fallback was
// ever attempted. Legacy callers additionally served unusable charts (entries
// with zero valid tmdbIds) as hits instead of falling back.
//
// Corrected contract (this file):
// - per-side independence: a fresh usable REQUESTED chart wins with ZERO JW
//   traffic even when the opposite side is malformed/missing/stale;
// - a malformed requested chart/doc is a MISS for that side, eligible for the
//   strict JW fallback (never an immediate throw, never a fake empty);
// - both sources down (FP miss + JW failure) throws / retains + gates;
// - a successful strict JW empty publishes a genuine empty;
// - legacy charts with zero usable tmdbIds fall back to JW.
// ---------------------------------------------------------------------------

function utc(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

type FpLib = typeof import("@/lib/flixpatrol")
type CgLib = typeof import("@/lib/chart-generation")
type RenewLib = typeof import("@/lib/chart-renewal")

let fp: FpLib
let cg: CgLib
let renewal: RenewLib
let persist: ReturnType<CgLib["__inMemoryChartGenerationPersist"]>

let now: number
let tmpDataDir: string

let fpDoc: unknown = null
let jwMode: "rows" | "empty" | "fail" = "rows"
let jwMovieIds = [701, 702]
let jwShowIds = [801, 802]

const D_FRESH = "October 22, 2026"

function fpEntries(ids: number[], mediaType: "movie" | "tv") {
  return ids.map((id, i) => ({
    rank: i + 1,
    title: `FP ${id}`,
    tmdb: { id, media_type: mediaType, release_date: "2024-01-01" },
  }))
}

function fpChart(platform: string, category: "movies" | "tv shows", date: string | undefined, ids: number[]) {
  const mediaType = category === "movies" ? ("movie" as const) : ("tv" as const)
  return {
    catalog_id: `${platform}.${category}`,
    platform,
    category,
    ...(date === undefined ? {} : { date }),
    entries: fpEntries(ids, mediaType),
  }
}

function badEntriesChart(platform: string, category: "movies" | "tv shows", date: string, badEntries: unknown) {
  return {
    catalog_id: `${platform}.${category}`,
    platform,
    category,
    date,
    entries: badEntries,
  }
}

function fpDocFor(charts: unknown[], docDate: string | undefined = D_FRESH) {
  return {
    ...(docDate === undefined ? {} : { date: docDate }),
    scraped_at_utc: "2026-10-22T08:00:00.000Z",
    charts,
  }
}

function jwChartEdges(ids: number[]) {
  return ids.map((tmdbId, i) => ({
    streamingChartInfo: { rank: i + 1 },
    node: {
      content: {
        title: `JW ${tmdbId}`,
        externalIds: { tmdbId, imdbId: `tt${1000000 + tmdbId}` },
      },
    },
  }))
}

let jwCalls: Array<{ operation: string; objectType: string }> = []
let fpFetches = 0

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const urlStr = String(url)
    if (urlStr.includes("fp-crawler") || urlStr.includes("/catalogs/")) {
      fpFetches++
      if (fpDoc === "throw") throw new Error("fp-crawler down")
      return Response.json(fpDoc)
    }
    if (urlStr.includes("graphql") || urlStr.includes("justwatch")) {
      let operation = ""
      let objectType = ""
      try {
        const body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? ""))
        operation = body.operationName ?? ""
        objectType = body.variables?.filter?.objectType ?? body.variables?.filter?.objectTypes?.[0] ?? ""
      } catch {
        operation = ""
      }
      jwCalls.push({ operation, objectType })
      if (jwMode === "fail") throw new Error("justwatch down")
      const ids = objectType === "MOVIE" ? (jwMode === "empty" ? [] : jwMovieIds) : jwMode === "empty" ? [] : jwShowIds
      if (operation === "GetPopularTitles") {
        return Response.json({ data: { popularTitles: { edges: jwChartEdges(ids) } } })
      }
      return Response.json({ data: { streamingCharts: { edges: jwChartEdges(ids) } } })
    }
    throw new Error(`unexpected upstream (no TMDB traffic expected): ${urlStr.slice(0, 100)}`)
  })
}

const NETFLIX_MOVIE = { regionCode: "IT", regionLang: "it-IT", family: "platform:netflix:movie" }
const NETFLIX_SERIES = { regionCode: "IT", regionLang: "it-IT", family: "platform:netflix:series" }

describe("correction1: FP-first per-side isolation (real adapter + renewal)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-c1-isolation-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", tmpDataDir)
    vi.resetModules()
    fp = await import("@/lib/flixpatrol")
    cg = await import("@/lib/chart-generation")
    renewal = await import("@/lib/chart-renewal")
    persist = cg.__inMemoryChartGenerationPersist()
    cg.__setChartGenerationPersistForTest(persist)
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> Rome day Oct 22
    vi.spyOn(Date, "now").mockImplementation(() => now)
    fpDoc = null
    jwMode = "rows"
    jwMovieIds = [701, 702]
    jwShowIds = [801, 802]
    jwCalls = []
    fpFetches = 0
    installFetchMock()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    cg.__resetChartGenerationForTest()
    cg.__setChartGenerationPersistForTest(null)
    await new Promise((r) => setTimeout(r, 50))
    fs.rmSync(tmpDataDir, { recursive: true, force: true })
  })

  it("adapter: fresh movies + malformed TV entries -> movies FP, series JW (no cross-side throw)", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      badEntriesChart("Netflix", "tv shows", D_FRESH, "nope-not-an-array"),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", {
      enrich: false,
      minFetchedAtMs: cg.currentChartSlotFloor(),
      freshOrThrow: true,
    })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([301, 302])
    expect(data.movies[0].title).toBe("FP 301")
    expect(data.tv.map((m) => m.tmdbId)).toEqual([801, 802])
    expect(data.tv[0].title).toBe("JW 801")
    expect(fpFetches).toBe(1) // single catalog fetch for both sides
  })

  it("adapter inverse: malformed movies + fresh TV -> movies JW, series FP", async () => {    fpDoc = fpDocFor([
      badEntriesChart("Netflix", "movies", D_FRESH, "nope-not-an-array"),
      fpChart("Netflix", "tv shows", D_FRESH, [401, 402]),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", {
      enrich: false,
      minFetchedAtMs: cg.currentChartSlotFloor(),
      freshOrThrow: true,
    })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.movies[0].title).toBe("JW 701")
    expect(data.tv.map((m) => m.tmdbId)).toEqual([401, 402])
    expect(data.tv[0].title).toBe("FP 401")
  })

  it("adapter legacy: chart with zero usable tmdbIds falls back to JW (never served unusable)", async () => {
    fpDoc = fpDocFor([
      {
        catalog_id: "Netflix.movies",
        platform: "Netflix",
        category: "movies",
        date: D_FRESH,
        entries: [{ rank: 1, title: "NoId", tmdb: null }],
      },
      fpChart("Netflix", "tv shows", D_FRESH, [401]),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.movies[0].title).toBe("JW 701")
    expect(data.tv.map((m) => m.tmdbId)).toEqual([401])
  })

  it("adapter strict: malformed document + successful JW -> JW fallback (never throws)", async () => {
    fpDoc = { bogus: 1 }
    const data = await fp.getTop10("netflix", "italy", "k", {
      enrich: false,
      minFetchedAtMs: cg.currentChartSlotFloor(),
      freshOrThrow: true,
    })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.tv.map((m) => m.tmdbId)).toEqual([801, 802])
  })

  it("adapter strict: malformed requested chart + successful JW -> JW fallback", async () => {
    fpDoc = fpDocFor([
      badEntriesChart("Netflix", "movies", D_FRESH, { not: "an-array" }),
      fpChart("Netflix", "tv shows", D_FRESH, [401, 402]),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", {
      enrich: false,
      minFetchedAtMs: cg.currentChartSlotFloor(),
      freshOrThrow: true,
    })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.tv.map((m) => m.tmdbId)).toEqual([401, 402])
  })

  it("adapter strict: both sources down throws (failure retention signal, never fake empty)", async () => {
    fpDoc = { bogus: 1 }
    jwMode = "fail"
    await expect(
      fp.getTop10("netflix", "italy", "k", {
        enrich: false,
        minFetchedAtMs: cg.currentChartSlotFloor(),
        freshOrThrow: true,
      }),
    ).rejects.toThrow()
  })

  it("renewal: fresh movies + malformed TV -> movie publishes flixpatrol with zero JW, series falls back", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      badEntriesChart("Netflix", "tv shows", D_FRESH, "nope-not-an-array"),
    ])
    const moviePin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((moviePin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    expect(moviePin.snapshot?.provenance).toBe("flixpatrol")
    expect(jwCalls.filter((c) => c.objectType === "MOVIE")).toEqual([])
    const seriesPin = await renewal.ensureFreshChartFamily({ ...NETFLIX_SERIES, tmdbKey: "k" })
    expect((seriesPin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([801, 802])
    expect(seriesPin.snapshot?.provenance).toBe("justwatch")
    expect(fpFetches).toBe(1) // one catalog fetch total: the sibling reuses it, no second load
  })

  it("renewal inverse: malformed movies + fresh TV -> series publishes flixpatrol with zero SHOW JW on its path", async () => {
    fpDoc = fpDocFor([
      badEntriesChart("Netflix", "movies", D_FRESH, "nope-not-an-array"),
      fpChart("Netflix", "tv shows", D_FRESH, [401, 402]),
    ])
    const seriesPin = await renewal.ensureFreshChartFamily({ ...NETFLIX_SERIES, tmdbKey: "k" })
    expect((seriesPin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([401, 402])
    expect(seriesPin.snapshot?.provenance).toBe("flixpatrol")
    const moviePin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((moviePin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(moviePin.snapshot?.provenance).toBe("justwatch")
  })

  it("renewal: malformed requested doc + successful JW -> justwatch rows (never throws, never fake empty)", async () => {
    fpDoc = { bogus: 1 }
    const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(pin.snapshot?.provenance).toBe("justwatch")
    expect(pin.snapshot?.status).toBe("ok")
  })

  it("renewal: malformed requested chart + successful JW empty -> genuine empty with justwatch provenance", async () => {
    fpDoc = fpDocFor([
      badEntriesChart("Netflix", "movies", D_FRESH, "nope-not-an-array"),
      fpChart("Netflix", "tv shows", D_FRESH, [401]),
    ])
    jwMode = "empty"
    const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
    expect(pin.snapshot?.provenance).toBe("justwatch")
  })

  it("renewal: FP malformed + JW failure retains last good and gates (both fail, never empty)", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      fpChart("Netflix", "tv shows", D_FRESH, [401, 402]),
    ])
    const first = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> slot 20261022-12
    fpDoc = { bogus: 1 }
    jwMode = "fail"
    const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    expect(await cg.isChartFamilyGated(NETFLIX_MOVIE)).toBe(true)
  })
})
