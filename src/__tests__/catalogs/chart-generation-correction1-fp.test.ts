import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Correction cycle 1, issue 2: FlixPatrol stale-as-new.
//
// Uses the REAL fp source cache (in-memory + on-disk in a temp DATA_DIR via a
// fresh module registry) — never a getTop10 mock with already-correct rows.
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
let fpPhase: "ok-new-a" | "ok-new-b" | "fail" = "ok-new-a"
let fetchCalls = 0

function fpCatalog(ids: number[]) {
  const entries = ids.map((id, i) => ({
    rank: i + 1,
    title: `FP ${id}`,
    tmdb: { id, media_type: "movie", release_date: "2024-01-01" },
  }))
  // All phases run on Rome Oct 22 (see `now` below), so the chart date is
  // fresh for every read; staleness is covered by dedicated date tests.
  return {
    date: "October 22, 2026",
    scraped_at_utc: "2026-10-22T08:00:00.000Z",
    charts: [
      { catalog_id: "c1", platform: "Netflix", category: "movies", date: "October 22, 2026", entries },
      {
        catalog_id: "c2",
        platform: "Netflix",
        category: "tv shows",
        date: "October 22, 2026",
        entries: entries.map((e) => ({ ...e, tmdb: { ...e.tmdb, media_type: "tv" } })),
      },
    ],
  }
}

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url)
    fetchCalls++
    if (urlStr.includes("fp-crawler") || urlStr.includes("/catalogs/")) {
      if (fpPhase === "fail") throw new Error("fp-crawler down")
      return Response.json(fpPhase === "ok-new-a" ? fpCatalog([301, 302]) : fpCatalog([401, 402]))
    }
    // Every other upstream (JustWatch GraphQL included) is down: the renewal
    // must fall through to the REAL fp source cache path.
    throw new Error(`upstream down: ${urlStr.slice(0, 80)}`)
  })
}

const NETFLIX_MOVIE = { regionCode: "IT", regionLang: "it-IT", family: "platform:netflix:movie" }

describe("correction1: flixpatrol stale rows never publish as a new generation", () => {
  let tmpDataDir: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-c1-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", tmpDataDir)
    vi.resetModules()
    fp = await import("@/lib/flixpatrol")
    cg = await import("@/lib/chart-generation")
    renewal = await import("@/lib/chart-renewal")
    persist = cg.__inMemoryChartGenerationPersist()
    cg.__setChartGenerationPersistForTest(persist)
    fetchCalls = 0
    fpPhase = "ok-new-a"
    installFetchMock()
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> slot 20261022-00
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    cg.__resetChartGenerationForTest()
    cg.__setChartGenerationPersistForTest(null)
    // Let pending fire-and-forget disk saves land before removing the dir
    // (their failure is benign and caught, this only keeps logs clean).
    await new Promise((r) => setTimeout(r, 50))
    fs.rmSync(tmpDataDir, { recursive: true, force: true })
  })

  it("failure past the boundary keeps the OLD generation, gates 60s, publishes nothing new; recovery advances", async () => {
    // Cold publish in slot 00 through the REAL fp cache (disk + memory).
    const first = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(first.id).toBe("20261022-00")
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    // The disk seed is written fire-and-forget: poll for it (real async IO).
    await vi.waitFor(() => {
      const p = path.join(tmpDataDir, "flixpatrol_cache_italy.json")
      if (!fs.existsSync(p)) throw new Error("waiting for fp disk seed")
      const diskBody = JSON.parse(fs.readFileSync(p, "utf-8"))
      expect(diskBody.catalog.charts).toHaveLength(2)
    }, 10000)

    // Past the Rome 12:00 boundary, every upstream fails. The fp disk/memory
    // body is now pre-floor (stale-for-cycle): it must NOT be stamped as a
    // fresh slot-12 fetch.
    now = utc(2026, 10, 22, 11, 5, 0) // Rome 13:05 -> slot 20261022-12
    fpPhase = "fail"
    const callsBefore = fetchCalls
    const failed = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(fetchCalls).toBeGreaterThan(callsBefore) // a real refresh was attempted
    expect(failed.id).toBe("20261022-00") // OLD generation kept
    expect((failed.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([301, 302])
    // No new publication landed: the durable generation pointer is untouched.
    const group = cg.chartFamilyGroupKey({ ...NETFLIX_MOVIE, mdblistKey: undefined })
    expect(persist.published.get(`${group}:${NETFLIX_MOVIE.family}`)?.generation).toBe("20261022-00")
    // Failure gate: an immediate retry performs zero upstream work.
    const gatedCalls = fetchCalls
    const gated = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(gated.id).toBe("20261022-00")
    expect(fetchCalls).toBe(gatedCalls)

    // Recovery after the 60s gate with genuinely new upstream rows: the
    // refresh advances to the new generation (same slot, new rows).
    now += 61_000
    fpPhase = "ok-new-b"
    const recovered = await renewal.ensureFreshChartFamily({ ...NETFLIX_MOVIE, tmdbKey: "k" })
    expect(recovered.id).toBe("20261022-12")
    expect((recovered.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([401, 402])
  })

  it("legacy callers without a cycle floor keep the stale fail-open fallback", async () => {
    now = utc(2026, 10, 22, 8, 0, 0)
    fpPhase = "ok-new-a"
    const seeded = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(seeded.movies.map((m) => m.tmdbId)).toEqual([301, 302])
    // Same instant needs no floor: entry is TTL-fresh, served without fetch.
    now = utc(2026, 10, 22, 11, 5, 0)
    fpPhase = "fail"
    const staleOk = await fp.getTop10("netflix", "italy", "k", { enrich: false })
    expect(staleOk.movies.map((m) => m.tmdbId)).toEqual([301, 302])
  })

  it("fixed-cycle fetch with freshOrThrow surfaces the outage instead of stale rows", async () => {
    now = utc(2026, 10, 22, 8, 0, 0)
    fpPhase = "ok-new-a"
    await fp.getTop10("netflix", "italy", "k", { enrich: false })
    now = utc(2026, 10, 22, 11, 5, 0) // slot 20261022-12 floor
    fpPhase = "fail"
    const floor = cg.currentChartSlotFloor()
    await expect(
      fp.getTop10("netflix", "italy", "k", { enrich: false, minFetchedAtMs: floor, freshOrThrow: true }),
    ).rejects.toThrow()
  })
})
