import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Platform streaming charts: FlixPatrol-first with per-media JustWatch
// fallback (never blended within one chart).
//
// Drives the REAL flixpatrol adapter (+ renewal) with mocked HTTP, dated
// fixtures and a frozen clock — never injected rows. Covers:
// - chart-date validation boundaries (age 0..2 fresh; older stale;
//   future/invalid rejected; doc-level fallback only when the chart carries
//   no date);
// - FP fresh on the requested chart → ZERO JW traffic;
// - missing split (overall-only), stale/invalid dates, transport errors →
//   per-media JW fallback with accurate provenance, no cross-side filling;
// - both sources down → throw (failure retention signal);
// - genuine supported empty (fresh chart, zero entries) → empty, no JW;
// - TTL-fresh cache hits with stale chart dates rejected like network docs;
// - cycle-aware stale-side recovery: ONE bounded refetch when the cached
//   document's chart date is stale (upstream skipped a publish day);
// - renewal coherence (provenance per actual source) + GLOBAL JW unchanged.
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

// Upstream phases (per test).
let fpDoc: unknown | "throw" = "throw"
let jwMode: "rows" | "empty" | "fail" = "rows"
// JW ids per media type (titles make the source visible per side).
let jwMovieIds = [701, 702]
let jwShowIds = [801, 802]

const D_FRESH = "October 22, 2026" // age 0
const D_YESTERDAY = "October 21, 2026" // age 1
const D_TWO_DAYS = "October 20, 2026" // age 2 (publish-gap tolerance) — still fresh
const D_STALE = "October 19, 2026" // age 3 — stale
const D_FUTURE = "October 23, 2026"

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
const GLOBAL_MOVIE = { regionCode: "GLOBAL", regionLang: "en-US", family: "platform:netflix:movie" }

describe("platform FP-first (flixpatrol adapter)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-first-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", tmpDataDir)
    vi.resetModules()
    fp = await import("@/lib/flixpatrol")
    cg = await import("@/lib/chart-generation")
    renewal = await import("@/lib/chart-renewal")
    persist = cg.__inMemoryChartGenerationPersist()
    cg.__setChartGenerationPersistForTest(persist)
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> Rome day Oct 22
    vi.spyOn(Date, "now").mockImplementation(() => now)
    fpDoc = "throw"
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

  it("pure: date parsing and freshness boundaries", () => {
    expect(fp.parseFlixChartDate("October 22, 2026")).toEqual({ year: 2026, month: 9, day: 22 })
    expect(fp.parseFlixChartDate("october 2, 2026")).toEqual({ year: 2026, month: 9, day: 2 })
    expect(fp.parseFlixChartDate("2026-10-22")).toEqual({ year: 2026, month: 9, day: 22 })
    expect(fp.parseFlixChartDate("October 32, 2026")).toBeNull()
    expect(fp.parseFlixChartDate("February 30, 2026")).toBeNull()
    expect(fp.parseFlixChartDate("22 October 2026")).toBeNull()
    expect(fp.parseFlixChartDate("")).toBeNull()
    expect(fp.parseFlixChartDate(null)).toBeNull()
    expect(fp.parseFlixChartDate(123)).toBeNull()

    // Rome day is Oct 22 at `now`: age 0..2 fresh (one skipped publish day is
    // tolerated), older stale.
    expect(fp.isFreshFlixChartDate(D_FRESH, undefined, now)).toBe(true)
    expect(fp.isFreshFlixChartDate(D_YESTERDAY, undefined, now)).toBe(true)
    expect(fp.isFreshFlixChartDate(D_TWO_DAYS, undefined, now)).toBe(true)
    expect(fp.isFreshFlixChartDate(D_STALE, undefined, now)).toBe(false)
    // Diagnosed live on 2026-10-30: the upstream skipped the Oct 29 publish,
    // so a document still dated Oct 28 (age 2) must stay usable — Oct 27
    // (age 3) is the first stale day.
    const diagNow = utc(2026, 10, 30, 8, 0, 0)
    expect(fp.isFreshFlixChartDate("October 30, 2026", undefined, diagNow)).toBe(true)
    expect(fp.isFreshFlixChartDate("October 29, 2026", undefined, diagNow)).toBe(true)
    expect(fp.isFreshFlixChartDate("October 28, 2026", undefined, diagNow)).toBe(true)
    expect(fp.isFreshFlixChartDate("October 27, 2026", undefined, diagNow)).toBe(false)
    // Future dates are rejected, never trusted.
    expect(fp.isFreshFlixChartDate(D_FUTURE, undefined, now)).toBe(false)
    // Garbage is stale, even with a fresh document date (no rescue).
    expect(fp.isFreshFlixChartDate("not a date", D_FRESH, now)).toBe(false)
    expect(fp.isFreshFlixChartDate(undefined, undefined, now)).toBe(false)
    // The document date fills in only when the chart carries none.
    expect(fp.isFreshFlixChartDate(undefined, D_FRESH, now)).toBe(true)
    expect(fp.isFreshFlixChartDate("", D_FRESH, now)).toBe(true)
    expect(fp.isFreshFlixChartDate(undefined, D_TWO_DAYS, now)).toBe(true)
    expect(fp.isFreshFlixChartDate(undefined, D_STALE, now)).toBe(false)
  })

  it("FP fresh on both charts: zero JW traffic, FP rows served", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      fpChart("Netflix", "tv shows", D_FRESH, [401, 402]),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([301, 302])
    expect(data.tv.map((m) => m.tmdbId)).toEqual([401, 402])
    expect(data.movies[0].title).toBe("FP 301")
    expect(jwCalls).toEqual([])
    expect(fpFetches).toBe(1) // single catalog fetch for both sides
  })

  it("missing split (overall-only) falls back per media type without blending", async () => {
    // Crunchyroll-style: only an overall chart, no movies/tv split.
    fpDoc = fpDocFor([
      { catalog_id: "crunchyroll.overall", platform: "Crunchyroll", category: "overall", date: D_FRESH, entries: fpEntries([901], "tv") },
    ])
    const data = await fp.getTop10("crunchyroll", "italy", "k", { enrich: false })
    // Both sides miss FP (absence, not a fake empty) → both fall back to JW.
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.tv.map((m) => m.tmdbId)).toEqual([801, 802])
    expect(data.movies[0].title).toBe("JW 701")
    // No FP row leaks into either chart.
    expect(data.movies.every((m) => !String(m.title).startsWith("FP"))).toBe(true)
    expect(data.tv.every((m) => !String(m.title).startsWith("FP"))).toBe(true)
  })

  it("fresh movies + stale series: per-side fallback, no cross-side filling", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      fpChart("Netflix", "tv shows", D_STALE, [401, 402]),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([301, 302])
    expect(data.movies[0].title).toBe("FP 301")
    // The stale series chart never suppresses the series fallback.
    expect(data.tv.map((m) => m.tmdbId)).toEqual([801, 802])
    expect(data.tv[0].title).toBe("JW 801")
    // Only the SHOW side consumed JW traffic.
    expect(jwCalls.filter((c) => c.objectType === "MOVIE")).toEqual([])
    expect(jwCalls.some((c) => c.objectType === "SHOW")).toBe(true)
  })

  it("stale charts on both sides: JW rows served, stale FP never surfaces", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_STALE, [301, 302]),
      fpChart("Netflix", "tv shows", D_STALE, [401, 402]),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.tv.map((m) => m.tmdbId)).toEqual([801, 802])
  })

  it("invalid chart dates fall back to JW like stale ones", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", "someday", [301]),
      fpChart("Netflix", "tv shows", "someday", [401]),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.tv.map((m) => m.tmdbId)).toEqual([801, 802])
  })

  it("FP transport failure falls back to JW", async () => {
    fpDoc = "throw"
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.tv.map((m) => m.tmdbId)).toEqual([801, 802])
  })

  it("both sources down throws (legacy and strict retention signal)", async () => {
    fpDoc = "throw"
    jwMode = "fail"
    await expect(fp.getTop10("netflix", "italy", "k", { enrich: false })).rejects.toThrow()
    await expect(
      fp.getTop10("netflix", "italy", "k", { enrich: false, minFetchedAtMs: cg.currentChartSlotFloor(), freshOrThrow: true }),
    ).rejects.toThrow()
  })

  it("genuine supported empty: fresh chart with zero entries, no JW fetch", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, []),
      fpChart("Netflix", "tv shows", D_FRESH, []),
    ])
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies).toEqual([])
    expect(data.tv).toEqual([])
    expect(jwCalls).toEqual([])
  })

  it("TTL-fresh cache hit with stale chart dates is rejected like a network doc", async () => {
    // Seed the cache with a stale-dated doc (fetch succeeds once).
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_STALE, [301]),
      fpChart("Netflix", "tv shows", D_STALE, [401]),
    ])
    const seeded = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    // Stale on arrival: already JW fallback, never stale FP rows.
    expect(seeded.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    // Now the network fails but the TTL-fresh cache holds the stale doc:
    // the cache hit must be rejected the same way, not laundered.
    fpDoc = "throw"
    const data = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(data.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(data.movies.every((m) => !String(m.title).startsWith("FP"))).toBe(true)
  })

  it("cycle-aware stale-side recovery: one bounded refetch serves the fresh side (diagnosed 2026-10-30 case)", async () => {
    // Rome 2026-10-30: the upstream skipped the Oct 29 publish; the cached
    // document is still dated Oct 28 (age 2, trusted by the widened window).
    now = utc(2026, 10, 30, 8, 0, 0)
    fpDoc = fpDocFor(
      [fpChart("Netflix", "movies", "October 28, 2026", [301]), fpChart("Netflix", "tv shows", "October 28, 2026", [401])],
      "October 28, 2026",
    )
    const seeded = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(seeded.movies.map((m) => m.tmdbId)).toEqual([301])
    expect(fpFetches).toBe(1)

    // One day later the same cache is age 3 → stale on every side, while the
    // live feed now carries a newer publish. Cycle-aware serving must refetch
    // ONCE instead of waiting for the next slot boundary.
    now = utc(2026, 10, 31, 8, 0, 0)
    jwCalls = []
    fpDoc = fpDocFor(
      [fpChart("Netflix", "movies", "October 30, 2026", [311, 312]), fpChart("Netflix", "tv shows", "October 30, 2026", [411, 412])],
      "October 30, 2026",
    )
    const recovered = await fp.getTop10("netflix", "italy", "k", { enrich: false, minFetchedAtMs: 0 })
    expect(recovered.movies.map((m) => m.tmdbId)).toEqual([311, 312])
    expect(recovered.tv.map((m) => m.tmdbId)).toEqual([411, 412])
    expect(recovered.movies[0].title).toBe("FP 311")
    // Exactly one extra upstream read, zero JW traffic (the fresh side won).
    expect(fpFetches).toBe(2)
    expect(jwCalls).toEqual([])

    // Fresh-hit path keeps its cost: the healed cache serves without fetching.
    const reused = await fp.getTop10("netflix", "italy", "k", { enrich: false, minFetchedAtMs: 0 })
    expect(reused.movies.map((m) => m.tmdbId)).toEqual([311, 312])
    expect(fpFetches).toBe(2)
  })

  it("cycle-aware stale-side refetch stays bounded: still-stale live doc is refetched once per 60s cooldown", async () => {
    now = utc(2026, 10, 30, 8, 0, 0)
    fpDoc = fpDocFor(
      [fpChart("Netflix", "movies", D_STALE, [301]), fpChart("Netflix", "tv shows", D_STALE, [401])],
      D_STALE,
    )
    // Seed the cache with the stale document (legacy: fail-open miss → JW).
    const seeded = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(seeded.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(fpFetches).toBe(1)

    // Cycle-aware: cache is TTL-fresh but its charts are stale → ONE refetch.
    const first = await fp.getTop10("netflix", "italy", "k", { enrich: false, minFetchedAtMs: 0 })
    expect(first.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(fpFetches).toBe(2)
    // The refetch was still stale: the shared 60s cooldown is armed, so a
    // second cycle-aware request serves the cached doc with NO extra read.
    const second = await fp.getTop10("netflix", "italy", "k", { enrich: false, minFetchedAtMs: 0 })
    expect(second.movies.map((m) => m.tmdbId)).toEqual([701, 702])
    expect(fpFetches).toBe(2)

    // Past the cooldown the feed heals: recovery costs exactly one more read.
    now += 61_000
    fpDoc = fpDocFor(
      [fpChart("Netflix", "movies", "October 30, 2026", [311]), fpChart("Netflix", "tv shows", "October 30, 2026", [411])],
      "October 30, 2026",
    )
    const healed = await fp.getTop10("netflix", "italy", "k", { enrich: false, minFetchedAtMs: 0 })
    expect(healed.movies.map((m) => m.tmdbId)).toEqual([311])
    expect(healed.tv.map((m) => m.tmdbId)).toEqual([411])
    expect(fpFetches).toBe(3)
  })
})

describe("platform FP-first (renewal coherence)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-first-renew-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", tmpDataDir)
    vi.resetModules()
    fp = await import("@/lib/flixpatrol")
    cg = await import("@/lib/chart-generation")
    renewal = await import("@/lib/chart-renewal")
    persist = cg.__inMemoryChartGenerationPersist()
    cg.__setChartGenerationPersistForTest(persist)
    now = utc(2026, 10, 22, 8, 0, 0)
    vi.spyOn(Date, "now").mockImplementation(() => now)
    fpDoc = "throw"
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

  it("FP fresh publishes flixpatrol provenance with zero JW traffic", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      fpChart("Netflix", "tv shows", D_FRESH, [401, 402]),
    ])
    const moviePin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(moviePin.id).toBe("20261022-00")
    expect((moviePin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    expect(moviePin.snapshot?.provenance).toBe("flixpatrol")
    const seriesPin = await renewal.ensureFreshChartFamily({ ...NETFLIX_SERIES, tmdbKey: "k" })
    expect((seriesPin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([401, 402])
    expect(seriesPin.snapshot?.provenance).toBe("flixpatrol")
    expect(jwCalls).toEqual([])
  })

  it("FP stale falls back to JW with justwatch provenance (per requested side)", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_STALE, [301]),
      fpChart("Netflix", "tv shows", D_STALE, [401]),
    ])
    const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(pin.snapshot?.provenance).toBe("justwatch")
  })

  it("mixed freshness renews each family from its own source", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      fpChart("Netflix", "tv shows", D_STALE, [401]),
    ])
    const moviePin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((moviePin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    expect(moviePin.snapshot?.provenance).toBe("flixpatrol")
    const seriesPin = await renewal.ensureFreshChartFamily({ ...NETFLIX_SERIES, tmdbKey: "k" })
    expect((seriesPin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([801, 802])
    expect(seriesPin.snapshot?.provenance).toBe("justwatch")
    // The movie renewal spent no JW traffic; the series one fetched SHOW only.
    expect(jwCalls.filter((c) => c.objectType === "MOVIE")).toEqual([])
    expect(jwCalls.some((c) => c.objectType === "SHOW")).toBe(true)
  })

  it("GLOBAL keeps the historical JW-only path (no FP fetch)", async () => {
    fpDoc = fpDocFor([
      fpChart("Netflix", "movies", D_FRESH, [301, 302]),
      fpChart("Netflix", "tv shows", D_FRESH, [401, 402]),
    ])
    const pin = await renewal.ensureFreshChartFamily({ ...GLOBAL_MOVIE, tmdbKey: "k" })
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(pin.snapshot?.provenance).toBe("justwatch")
    expect(fpFetches).toBe(0)
  })
})
