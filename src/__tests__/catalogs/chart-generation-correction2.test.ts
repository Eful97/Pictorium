import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Correction cycle 2: genuine-empty vs failure provenance at the source
// boundary + single-process commit serialization/owner validation.
//
// Drives the REAL adapters (fetchChartFamilyRows default fetch, strict source
// params, real fp source cache in a temp DATA_DIR via a fresh module
// registry) with mocked HTTP — never injected `fetch:` stubs with
// already-correct rows. RED-before/GREEN-after contract tests for:
// - successful zero-row reads publish an EMPTY snapshot (miss stays null,
//   never resurrects a saved rank) on every family;
// - transport failure (HTTP !ok, invalid JSON, abort, open circuit) throws at
//   the strict boundary and retains the last good snapshot with a 60s gate;
// - a cached legacy error-negative never masquerades as a successful empty
//   for strict callers;
// - file-backend delayed/stale-owner writes can never overwrite a newer
//   publish single-process (mutex + owner validation + generation guard).
// ---------------------------------------------------------------------------

function utc(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

type JwLib = typeof import("@/lib/justwatch")
type MdLib = typeof import("@/lib/mdblist")
type Top20Lib = typeof import("@/lib/top20-ranking")
type CgLib = typeof import("@/lib/chart-generation")
type RenewLib = typeof import("@/lib/chart-renewal")

let jw: JwLib
let mdblist: MdLib
let top20: Top20Lib
let cg: CgLib
let renewal: RenewLib
let persist: ReturnType<CgLib["__inMemoryChartGenerationPersist"]>

let now: number
let tmpDataDir: string
let fetchCalls = 0

type JwMode = "rows" | "empty" | "http500" | "invalid-json" | "malformed-empty" | "malformed-null-charts" | "malformed-wrongtype" | "malformed-noids"
type MdbMode = "rows" | "empty" | "fail" | "malformed-empty" | "malformed-wrongtype" | "malformed-error" | "malformed-noids"
type FpMode = "rows" | "no-platform" | "fail" | "malformed-doc" | "malformed-wrongtype" | "malformed-noids"

let jwMode: JwMode = "rows"
let jwChartIds = [101, 102]
let jwPopIds = [501, 502]
let mdbMode: MdbMode = "rows"
let fpMode: FpMode = "rows"

function chartEdges(ids: number[]) {
  return ids.map((tmdbId, i) => ({
    streamingChartInfo: { rank: i + 1 },
    node: {
      content: {
        title: `Chart ${tmdbId}`,
        originalReleaseDate: "2026-01-01",
        externalIds: { tmdbId, imdbId: `tt${1000000 + tmdbId}` },
      },
    },
  }))
}

function mdbItems(ids: number[]) {
  return ids.map((tmdbId) => ({
    imdb_id: `tt${2000000 + tmdbId}`,
    title: `Anime ${tmdbId}`,
    year: 2024,
    tmdb_id: tmdbId,
  }))
}

function fpCatalogWithNetflix(ids: number[]) {
  const entries = ids.map((id, i) => ({
    rank: i + 1,
    title: `FP ${id}`,
    tmdb: { id, media_type: "movie", release_date: "2024-01-01" },
  }))
  return {
    charts: [
      { catalog_id: "c1", platform: "Netflix", category: "movies", entries },
      {
        catalog_id: "c2",
        platform: "Netflix",
        category: "tv shows",
        entries: entries.map((e) => ({ ...e, tmdb: { ...e.tmdb, media_type: "tv" } })),
      },
    ],
  }
}

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const urlStr = String(url)
    fetchCalls++
    if (urlStr.includes("justwatch") || urlStr.includes("graphql")) {
      if (jwMode === "http500") return new Response("err", { status: 500 })
      if (jwMode === "invalid-json") {
        return new Response("not json {{", { status: 200, headers: { "content-type": "application/json" } })
      }
      if (jwMode === "malformed-empty") return Response.json({})
      if (jwMode === "malformed-null-charts") return Response.json({ data: { streamingCharts: null, popularTitles: { edges: [] } } })
      if (jwMode === "malformed-wrongtype") {
        return Response.json({ data: { streamingCharts: { edges: "nope" }, popularTitles: { edges: "nope" } } })
      }
      if (jwMode === "malformed-noids") {
        const bad = [{ streamingChartInfo: { rank: 1 }, node: { content: { title: "NoId", externalIds: {} } } }]
        return Response.json({ data: { streamingCharts: { edges: bad }, popularTitles: { edges: bad } } })
      }
      let op = ""
      try {
        op = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? "")).operationName ?? ""
      } catch {
        op = ""
      }
      const ids = op === "GetPopularTitles" ? (jwMode === "empty" ? [] : jwPopIds) : jwMode === "empty" ? [] : jwChartIds
      const edges = chartEdges(ids)
      return Response.json({ data: { streamingCharts: { edges }, popularTitles: { edges } } })
    }
    if (urlStr.includes("mdblist.test")) {
      if (mdbMode === "fail") return new Response("err", { status: 500 })
      if (mdbMode === "malformed-empty") return Response.json({})
      if (mdbMode === "malformed-wrongtype") return Response.json({ items: "nope" })
      if (mdbMode === "malformed-error") return Response.json({ error: "quota exceeded" })
      if (mdbMode === "malformed-noids") return Response.json([{ foo: 1 }, { bar: 2 }])
      const items = mdbMode === "empty" ? [] : mdbItems([901, 902])
      return Response.json(items)
    }
    if (urlStr.includes("fp-crawler") || urlStr.includes("/catalogs/")) {
      if (fpMode === "fail") throw new Error("fp-crawler down")
      if (fpMode === "no-platform") return Response.json({ charts: [] })
      if (fpMode === "malformed-doc") return Response.json({ bogus: 1 })
      if (fpMode === "malformed-wrongtype") return Response.json({ charts: "nope" })
      if (fpMode === "malformed-noids") {
        return Response.json({
          charts: [
            { catalog_id: "c1", platform: "Netflix", category: "movies", entries: [{ rank: 1, title: "NoId", tmdb: null }] },
            { catalog_id: "c2", platform: "Netflix", category: "tv shows", entries: [{ rank: 1, title: "NoId", tmdb: null }] },
          ],
        })
      }
      return Response.json(fpCatalogWithNetflix([301, 302]))
    }
    throw new Error(`unexpected upstream: ${urlStr.slice(0, 100)}`)
  })
}

const JW_MOVIE = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:charts" }
const JW_POPULAR = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:popular" }
const JW_TRENDING = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:trending" }
const ANIME_MOVIE = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "anime:movie" }
const NETFLIX_MOVIE = { regionCode: "IT", regionLang: "it-IT", family: "platform:netflix:movie" }

describe("correction2: genuine empty vs failure provenance (real adapters)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chartfam-c2-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", tmpDataDir)
    vi.stubEnv("MDBLIST_API_URL", "https://mdblist.test")
    vi.resetModules()
    jw = await import("@/lib/justwatch")
    mdblist = await import("@/lib/mdblist")
    top20 = await import("@/lib/top20-ranking")
    cg = await import("@/lib/chart-generation")
    renewal = await import("@/lib/chart-renewal")
    persist = cg.__inMemoryChartGenerationPersist()
    cg.__setChartGenerationPersistForTest(persist)
    fetchCalls = 0
    jwMode = "rows"
    jwChartIds = [101, 102]
    jwPopIds = [501, 502]
    mdbMode = "rows"
    fpMode = "rows"
    installFetchMock()
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> slot 20261022-00
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    cg.__resetChartGenerationForTest()
    cg.__setChartGenerationPersistForTest(null)
    await new Promise((r) => setTimeout(r, 50))
    fs.rmSync(tmpDataDir, { recursive: true, force: true })
  })

  it("JW charts cold empty publishes an empty snapshot (genuine miss, no outage)", async () => {
    jwMode = "empty"
    const pin = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-00")
    expect(pin.snapshot).not.toBeNull()
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
  })

  it("JW charts genuine empty after nonempty publishes empty (never resurrects old rows)", async () => {
    const first = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([101, 102])
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> slot 20261022-12
    jwMode = "empty"
    const pin = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-12")
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
  })

  it("JW HTTP 500 retains the last good snapshot and gates retry >= 60s", async () => {
    await renewal.ensureFreshChartFamily(JW_MOVIE)
    now = utc(2026, 10, 22, 11, 0, 0)
    jwMode = "http500"
    const callsBefore = fetchCalls
    const pin = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect(fetchCalls).toBeGreaterThan(callsBefore) // a real refresh was attempted
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([101, 102])
    expect(await cg.isChartFamilyGated(JW_MOVIE)).toBe(true)
    const gated = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect(gated.id).toBe("20261022-00")
  })

  it("JW invalid JSON is a failure, not a genuine empty", async () => {
    await renewal.ensureFreshChartFamily(JW_MOVIE)
    now = utc(2026, 10, 22, 11, 0, 0)
    jwMode = "invalid-json"
    const pin = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([101, 102])
    expect(await cg.isChartFamilyGated(JW_MOVIE)).toBe(true)
  })

  it("JW open circuit: strict throws without fetch, legacy stays fail-open []", async () => {
    jwMode = "http500"
    for (let i = 0; i < 5; i++) {
      await expect(
        top20.fetchTop20Ranking({
          slot: "movie",
          source: { kind: "justwatch", mode: "charts" },
          regionCode: "IT",
          regionLang: "it-IT",
          strict: true,
        }),
      ).rejects.toThrow()
    }
    const callsAfterTrip = fetchCalls
    await expect(
      top20.fetchTop20Ranking({
        slot: "movie",
        source: { kind: "justwatch", mode: "charts" },
        regionCode: "IT",
        regionLang: "it-IT",
        strict: true,
      }),
    ).rejects.toThrow(/circuit open/)
    expect(fetchCalls).toBe(callsAfterTrip) // no upstream work on an open circuit
    const legacy = await jw.getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")
    expect(legacy).toEqual([])
    expect(fetchCalls).toBe(callsAfterTrip)
  })

  it("popular strict empty via the real top20 adapter publishes an empty snapshot", async () => {
    jwMode = "empty"
    const pin = await renewal.ensureFreshChartFamily(JW_POPULAR)
    expect(pin.id).toBe("20261022-00")
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
  })

  it("popular strict rows via the real top20 adapter publish sequential ranks", async () => {
    const pin = await renewal.ensureFreshChartFamily(JW_POPULAR)
    expect(pin.id).toBe("20261022-00")
    expect(pin.snapshot?.status).toBe("ok")
    expect((pin.snapshot?.rows ?? []).map((r) => ({ tmdbId: r.tmdbId, rank: r.rank }))).toEqual([
      { tmdbId: 501, rank: 1 },
      { tmdbId: 502, rank: 2 },
    ])
  })

  it("strict MDBList never trusts a cached legacy error-negative as success", async () => {
    // Legacy HTTP failure returns [] without caching (immediate retry);
    // strict records the 60s error-negative instead. Either way strict
    // success must refetch (not serve a negative) and return rows.
    mdbMode = "fail"
    expect(await mdblist.fetchMDBList("mdblistAnimeMovie")).toEqual([])
    // Strict success must refetch (not serve the negative) and return rows.
    mdbMode = "rows"
    const callsBefore = fetchCalls
    const rows = await mdblist.fetchMDBList("mdblistAnimeMovie", undefined, undefined, cg.currentChartSlotFloor(), true)
    expect(fetchCalls).toBeGreaterThan(callsBefore)
    expect(rows.map((r) => r.tmdb)).toEqual([901, 902])
  })

  it("MDBList strict failure throws; renewal retains the last good anime snapshot and gates", async () => {
    const first = await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([901, 902])
    now = utc(2026, 10, 22, 11, 0, 0)
    mdbMode = "fail"
    const pin = await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([901, 902])
    expect(await cg.isChartFamilyGated(ANIME_MOVIE)).toBe(true)
  })

  it("anime cold empty publishes an empty snapshot (genuine miss)", async () => {
    mdbMode = "empty"
    const pin = await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    expect(pin.id).toBe("20261022-00")
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
  })

  it("anime genuine empty after nonempty publishes empty (never resurrects)", async () => {
    await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    now = utc(2026, 10, 22, 11, 0, 0)
    mdbMode = "empty"
    const pin = await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    expect(pin.id).toBe("20261022-12")
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
  })

  it("platform non-global success-empty publishes an empty snapshot (real fp cache)", async () => {
    jwMode = "empty" // JW side genuinely empty -> falls through to the fp fallback
    fpMode = "no-platform" // successful fp read with zero rows for the platform
    const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(pin.id).toBe("20261022-00")
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
    expect(pin.snapshot?.provenance).toBe("flixpatrol")
  })

  it("platform JW+fp failure retains the last good snapshot and gates", async () => {
    // JW side genuinely empty -> the renewal falls through to the REAL fp
    // fallback, which publishes its rows; the outage below must retain them.
    jwMode = "empty"
    const first = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    expect(first.snapshot?.provenance).toBe("flixpatrol")
    now = utc(2026, 10, 22, 11, 0, 0)
    jwMode = "http500"
    fpMode = "fail"
    const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    expect(await cg.isChartFamilyGated(NETFLIX_MOVIE)).toBe(true)
  })

  it("c3: JW HTTP200 malformed shape retains last good and gates (not genuine empty)", async () => {
    await renewal.ensureFreshChartFamily(JW_MOVIE)
    now = utc(2026, 10, 22, 11, 0, 0)
    for (const bad of ["malformed-empty", "malformed-null-charts", "malformed-wrongtype", "malformed-noids"] as const) {
      jwMode = bad
      const pin = await renewal.ensureFreshChartFamily(JW_MOVIE)
      expect(pin.id).toBe("20261022-00")
      expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([101, 102])
      expect(await cg.isChartFamilyGated(JW_MOVIE)).toBe(true)
      // Advance past the 60s gate for the next malformed variant (same slot:
      // the pin stays stale so each variant triggers a real refresh attempt).
      now += 61_000
    }
  })

  it("c3: JW strict ignores a legacy-poisoned empty cache and publishes rows", async () => {
    // Legacy (non-strict) admits the malformed body as [] and caches it.
    jwMode = "malformed-empty"
    expect(await jw.getJWRankings("MOVIE", "IT", 20, undefined, "it-IT")).toEqual([])
    // Strict must refetch (not trust the poisoned []) and publish real rows.
    jwMode = "rows"
    jwChartIds = [101, 102]
    const pin = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([101, 102])
    expect(pin.snapshot?.status).toBe("ok")
  })

  it("c3: JW cold malformed never publishes (stays live, gated)", async () => {
    jwMode = "malformed-empty"
    const pin = await renewal.ensureFreshChartFamily(JW_MOVIE)
    expect(pin.id).toBe(cg.CHART_LIVE_PIN_ID)
    expect(pin.snapshot).toBeNull()
    expect(await cg.isChartFamilyGated(JW_MOVIE)).toBe(true)
  })

  it("c3: popular/trending malformed retains last good, valid empty advances", async () => {
    const first = await renewal.ensureFreshChartFamily(JW_POPULAR)
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([501, 502])
    now = utc(2026, 10, 22, 11, 0, 0)
    jwMode = "malformed-wrongtype"
    const bad = await renewal.ensureFreshChartFamily(JW_POPULAR)
    expect(bad.id).toBe("20261022-00")
    expect((bad.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([501, 502])
    expect(await cg.isChartFamilyGated(JW_POPULAR)).toBe(true)
    now += 61_000
    jwMode = "empty"
    const emptied = await renewal.ensureFreshChartFamily(JW_POPULAR)
    expect(emptied.id).toBe("20261022-12")
    expect(emptied.snapshot?.status).toBe("empty")
    // Trending follows the same strict boundary through GetPopularTitles.
    now += 61_000
    jwMode = "rows"
    const tFirst = await renewal.ensureFreshChartFamily(JW_TRENDING)
    expect(tFirst.snapshot?.status).toBe("ok")
    now += 61_000
    // Move to the next slot so the malformed trending read is a real refresh.
    now = utc(2026, 10, 22, 20, 0, 0) // Rome 22:00 -> still slot 20261022-12? force next day slot
    now = utc(2026, 10, 23, 8, 0, 0) // Rome 10:00 -> slot 20261023-00
    jwMode = "malformed-noids"
    const tBad = await renewal.ensureFreshChartFamily(JW_TRENDING)
    expect((tBad.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual(
      (tFirst.snapshot?.rows ?? []).map((r) => r.tmdbId),
    )
    expect(await cg.isChartFamilyGated(JW_TRENDING)).toBe(true)
  })

  it("c3: MDBList malformed shapes retain last good and gate (not genuine empty)", async () => {
    await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    now = utc(2026, 10, 22, 11, 0, 0)
    for (const bad of ["malformed-empty", "malformed-wrongtype", "malformed-error", "malformed-noids"] as const) {
      mdbMode = bad
      const pin = await renewal.ensureFreshChartFamily(ANIME_MOVIE)
      expect(pin.id).toBe("20261022-00")
      expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([901, 902])
      expect(await cg.isChartFamilyGated(ANIME_MOVIE)).toBe(true)
      now += 61_000
    }
  })

  it("c3: MDBList cold malformed never publishes (stays live, gated)", async () => {
    mdbMode = "malformed-error"
    const pin = await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    expect(pin.id).toBe(cg.CHART_LIVE_PIN_ID)
    expect(pin.snapshot).toBeNull()
    expect(await cg.isChartFamilyGated(ANIME_MOVIE)).toBe(true)
  })

  it("c3: MDBList valid empty shape still advances to empty", async () => {
    await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    now = utc(2026, 10, 22, 11, 0, 0)
    mdbMode = "empty"
    const pin = await renewal.ensureFreshChartFamily(ANIME_MOVIE)
    expect(pin.id).toBe("20261022-12")
    expect(pin.snapshot?.status).toBe("empty")
  })

  it("c3: FP malformed document retains last good and gates (not genuine empty)", async () => {
    jwMode = "empty"
    const first = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    now = utc(2026, 10, 22, 11, 0, 0)
    for (const bad of ["malformed-doc", "malformed-wrongtype", "malformed-noids"] as const) {
      fpMode = bad
      const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
      expect(pin.id).toBe("20261022-00")
      expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
      expect(await cg.isChartFamilyGated(NETFLIX_MOVIE)).toBe(true)
      now += 61_000
    }
  })

  it("c3: FP cold malformed never publishes (stays live, gated)", async () => {
    jwMode = "empty"
    fpMode = "malformed-doc"
    const pin = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(pin.id).toBe(cg.CHART_LIVE_PIN_ID)
    expect(pin.snapshot).toBeNull()
    expect(await cg.isChartFamilyGated(NETFLIX_MOVIE)).toBe(true)
  })
})

describe("correction2: file-backend commit serialization and stale-owner rejection", () => {
  let dir: string
  let fileCg: CgLib

  const FAM = { regionCode: "IT", regionLang: "it-IT", family: "jw:movie:charts" }
  // Lease/group identity MUST match the module under test (hash, not a
  // literal): the owner check keys on chartFamilyGroupKey(FAM).
  const group = () => fileCg.chartFamilyGroupKey(FAM)
  const family = "jw:movie:charts"

  const snap = (generation: string, ids: number[]) => ({
    generation,
    group: group(),
    family,
    status: "ok" as const,
    rows: ids.map((tmdbId, i) => ({ tmdbId, imdbId: null as string | null, rank: i + 1, title: null, year: null })),
    fetchedAt: now,
    publishedAt: now,
    provenance: null,
  })

  beforeEach(async () => {
    vi.restoreAllMocks()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chartfam-c2file-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", dir)
    vi.resetModules()
    fileCg = await import("@/lib/chart-generation")
    now = utc(2026, 10, 22, 8, 0, 0)
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fileCg.__resetChartGenerationForTest()
    fileCg.__setChartGenerationPersistForTest(null)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("blocks a stale-owner write on a current slot with no prior publish (owner check, not generation)", async () => {
    const persist = fileCg.__fileChartGenerationPersistForTest(dir)
    const slot = fileCg.romeSlotKey()
    // Owner A acquires, then hands over (its window lapped): B holds the lease.
    const ownerA = await fileCg.tryAcquireChartFamilyLease(FAM)
    expect(ownerA).not.toBeNull()
    await fileCg.releaseChartFamilyLease(FAM, ownerA as string)
    const ownerB = await fileCg.tryAcquireChartFamilyLease(FAM)
    expect(ownerB).not.toBeNull()
    // No prior publish: the generation guard would allow anything, so only
    // the owner check can reject A's delayed in-flight write.
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [1]), ownerA as string)).toBe("stale")
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [2]), ownerB as string)).toBe("ok")
    await fileCg.releaseChartFamilyLease(FAM, ownerB as string)
    const loaded = await persist.loadPublished(group(), family)
    expect(loaded?.rows.map((r) => r.tmdbId)).toEqual([2])
  })

  it("serializes concurrent same-owner commits: exactly one wins, out-of-order loses", async () => {
    const persist = fileCg.__fileChartGenerationPersistForTest(dir)
    const slot = fileCg.romeSlotKey()
    const owner = await fileCg.tryAcquireChartFamilyLease(FAM)
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [10]), owner as string)).toBe("ok")
    // Next slot, two concurrent commits: re-acquire a live lease first (the
    // 3h jump lapses the 30s TTL, and guarded publication rejects expired
    // owners). The mutex then serializes read-check-write, so the second
    // sees the winner's equal-or-newer generation and loses.
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    await fileCg.releaseChartFamilyLease(FAM, owner as string)
    const owner12 = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(owner12).not.toBeNull()
    const slot12 = fileCg.romeSlotKey()
    const [r1, r2] = await Promise.all([
      persist.commitPublished(group(), family, slot12, snap(slot12, [11]), owner12),
      persist.commitPublished(group(), family, slot12, snap(slot12, [12]), owner12),
    ])
    expect([r1, r2].sort()).toEqual(["ok", "stale"])
    const loaded = await persist.loadPublished(group(), family)
    expect([[11], [12]]).toContainEqual(loaded?.rows.map((r) => r.tmdbId))
    // An out-of-order older slot never overwrites the winner.
    await fileCg.releaseChartFamilyLease(FAM, owner12)
    const owner2 = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(await persist.commitPublished(group(), family, "20261021-12", snap("20261021-12", [99]), owner2)).toBe("stale")
    expect((await persist.loadPublished(group(), family))?.generation).toBe(slot12)
    await fileCg.releaseChartFamilyLease(FAM, owner2)
  })

  it("preserves the sequential generation guard (delayed older commit loses)", async () => {
    const persist = fileCg.__fileChartGenerationPersistForTest(dir)
    // Direct persist calls MUST hold a live lease (guarded publication):
    // acquire the owner first instead of using fixture strings.
    const owner = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(owner).not.toBeNull()
    expect(await persist.commitPublished(group(), family, "20261022-12", snap("20261022-12", [201]), owner)).toBe("ok")
    expect(await persist.commitPublished(group(), family, "20261022-00", snap("20261022-00", [101]), owner)).toBe("stale")
    expect(await persist.commitPublished(group(), family, "20261022-12", snap("20261022-12", [202]), owner)).toBe("stale")
    const loaded = await persist.loadPublished(group(), family)
    expect(loaded?.rows.map((r) => r.tmdbId)).toEqual([201])
    await fileCg.releaseChartFamilyLease(FAM, owner)
  })

  it("c3: rejects commits with no lease, an expired lease, or a released lease", async () => {
    const persist = fileCg.__fileChartGenerationPersistForTest(dir)
    const slot = fileCg.romeSlotKey()
    // No lease ever acquired: random owner strings never publish.
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [91]), "no-lease-owner")).toBe("stale")
    // Expired lease: acquire, lapse past the 30s TTL, then commit.
    const owner = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(owner).not.toBeNull()
    now += 31_000
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [92]), owner)).toBe("stale")
    // Released lease: re-acquire fresh, release, then commit with the old owner.
    fileCg.__resetChartGenerationForTest()
    const fresh = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    await fileCg.releaseChartFamilyLease(FAM, fresh)
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [93]), fresh)).toBe("stale")
    expect(await persist.loadPublished(group(), family)).toBeNull()
  })

  it("c3: blocked writer loses, handoff winner publishes (A holds, B blocked, B takes over)", async () => {
    const persist = fileCg.__fileChartGenerationPersistForTest(dir)
    const slot = fileCg.romeSlotKey()
    const ownerA = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(ownerA).not.toBeNull()
    // B cannot even acquire while A holds the lease.
    expect(await fileCg.tryAcquireChartFamilyLease(FAM)).toBeNull()
    // B's forged write with a non-owner string loses even on a current slot.
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [71]), "forged-B")).toBe("stale")
    // A publishes, releases; B takes over the handoff and publishes next.
    expect(await persist.commitPublished(group(), family, slot, snap(slot, [70]), ownerA)).toBe("ok")
    await fileCg.releaseChartFamilyLease(FAM, ownerA)
    const ownerB = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(ownerB).not.toBeNull()
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12: re-acquire (TTL lapsed)
    await fileCg.releaseChartFamilyLease(FAM, ownerB)
    const ownerB12 = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(ownerB12).not.toBeNull()
    const slot12 = fileCg.romeSlotKey()
    expect(await persist.commitPublished(group(), family, slot12, snap(slot12, [72]), ownerB12)).toBe("ok")
    await fileCg.releaseChartFamilyLease(FAM, ownerB12)
    expect((await persist.loadPublished(group(), family))?.rows.map((r) => r.tmdbId)).toEqual([72])
  })

  it("c3: realistic deferred write loses (stale read, newer publish wins first)", async () => {
    const persist = fileCg.__fileChartGenerationPersistForTest(dir)
    const slot00 = "20261022-00"
    const slot12 = "20261022-12"
    // A acquires for slot00 and starts a slow commit (deferred write): hold
    // the family mutex externally so A's read-check-write cannot interleave.
    const ownerA = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    // B cannot acquire while A holds the lease, so B waits; A publishes 00.
    expect(await persist.commitPublished(group(), family, slot00, snap(slot00, [81]), ownerA)).toBe("ok")
    await fileCg.releaseChartFamilyLease(FAM, ownerA)
    // B takes over and publishes the newer generation 12.
    const ownerB = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(await persist.commitPublished(group(), family, slot12, snap(slot12, [82]), ownerB)).toBe("ok")
    await fileCg.releaseChartFamilyLease(FAM, ownerB)
    // A's delayed retry of the older slot (same wall-clock content, lapped
    // owner) must lose to the newer publish — never resurrect 00 over 12.
    const ownerC = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(await persist.commitPublished(group(), family, slot00, snap(slot00, [83]), ownerC)).toBe("stale")
    await fileCg.releaseChartFamilyLease(FAM, ownerC)
    const loaded = await persist.loadPublished(group(), family)
    expect(loaded?.generation).toBe(slot12)
    expect(loaded?.rows.map((r) => r.tmdbId)).toEqual([82])
  })

  it("c3: in-memory backend enforces the same live-owner guard", async () => {
    const mem = fileCg.__inMemoryChartGenerationPersist()
    const slot = fileCg.romeSlotKey()
    expect(await mem.commitPublished(group(), family, slot, snap(slot, [95]), "ghost")).toBe("stale")
    const owner = (await fileCg.tryAcquireChartFamilyLease(FAM)) as string
    expect(await mem.commitPublished(group(), family, slot, snap(slot, [96]), owner)).toBe("ok")
    await fileCg.releaseChartFamilyLease(FAM, owner)
    expect(await mem.commitPublished(group(), family, slot, snap(slot, [97]), owner)).toBe("stale")
    expect((await mem.loadPublished(group(), family))?.rows.map((r) => r.tmdbId)).toEqual([96])
  })
})
