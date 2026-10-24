import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// ---------------------------------------------------------------------------
// Correction cycle 2 (task2 bug C): fixed-cycle `stream:` families WITHOUT a
// JustWatch fallback (no-alias pairs such as NOW+US) must distinguish an
// actually absent/unusable FP split from a failed/unusable FP source.
//
// - FP transport outage (`loadFailed`) or an unusable FP source (malformed
//   document, malformed requested-side entries) THROWS at the strict boundary:
//   the refresh converts it to an error contribution (old pin kept + 60s
//   gate), never a fake empty that would retire the last-good snapshot.
// - An actually absent split (no chart) or a stale-dated chart for the
//   requested side publishes a genuine empty (unavailable pair).
// - An explicit fresh `entries: []` chart publishes a genuine empty.
//
// Drives the REAL renewal adapters (default fetch, strict source params,
// real fp source cache in a temp DATA_DIR via a fresh module registry) with
// mocked HTTP. JW is never touched on this path: any justwatch/graphql fetch
// throws, proving FP-only behavior for no-JW pairs.
// ---------------------------------------------------------------------------

function utc(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

type CgLib = typeof import("@/lib/chart-generation")
type RenewLib = typeof import("@/lib/chart-renewal")

let cg: CgLib
let renewal: RenewLib
let persist: ReturnType<CgLib["__inMemoryChartGenerationPersist"]>

let now: number
let tmpDataDir: string

type FpUsMode = "rows" | "fail" | "malformed-doc" | "malformed-noids" | "empty" | "absent"
let fpUsMode: FpUsMode = "rows"

function tvEntry(id: number, rank: number) {
  return { rank, title: `NOW Show ${id}`, tmdb: { id, media_type: "tv", release_date: "2024-01-01" } }
}

function movieEntry(id: number, rank: number) {
  return { rank, title: `NOW Film ${id}`, tmdb: { id, media_type: "movie", release_date: "2024-01-01" } }
}

function nowUsCatalog(tvEntries: unknown[], movieEntries: unknown[]) {
  // All FP-serving phases run on Rome Oct 22 (see `now` below), so the chart
  // date is fresh for every read; staleness is covered by date tests.
  return {
    date: "October 22, 2026",
    scraped_at_utc: "2026-10-22T08:00:00.000Z",
    charts: [
      { catalog_id: "n1", platform: "NOW", category: "movies", date: "October 22, 2026", entries: movieEntries },
      { catalog_id: "n2", platform: "NOW", category: "tv shows", date: "October 22, 2026", entries: tvEntries },
    ],
  }
}

function installFetchMock() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url)
    if (urlStr.includes("justwatch") || urlStr.includes("graphql")) {
      throw new Error("JW must not be touched on the FP-only no-JW path")
    }
    if (urlStr.includes("united-states.json")) {
      if (fpUsMode === "fail") throw new Error("fp-crawler down")
      if (fpUsMode === "malformed-doc") return Response.json({ bogus: 1 })
      if (fpUsMode === "absent") {
        return Response.json({
          date: "October 22, 2026",
          charts: [
            {
              catalog_id: "x1",
              platform: "Netflix",
              category: "tv shows",
              date: "October 22, 2026",
              entries: [tvEntry(901, 1)],
            },
          ],
        })
      }
      const tv =
        fpUsMode === "empty"
          ? []
          : fpUsMode === "malformed-noids"
            ? [{ rank: 1, title: "NoId", tmdb: null }]
            : [tvEntry(701, 1), tvEntry(702, 2)]
      return Response.json(nowUsCatalog(tv, [movieEntry(711, 1)]))
    }
    throw new Error(`unexpected upstream: ${urlStr.slice(0, 100)}`)
  })
}

// NOW+US has no verified own-brand JW fallback: FP-only, unavailable when the
// FP index has no chart. Probes first, then the requested tv side decides.
const NOW_US_SERIES = { regionCode: "US", regionLang: "en-US", mdblistKey: null as string | null, family: "stream:now:series" }

describe("correction2/c2: stream no-JW failure retention (real adapters)", () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chartfam-stream-"))
    vi.stubEnv("PICTORIUM_DATA_DIR", tmpDataDir)
    vi.resetModules()
    cg = await import("@/lib/chart-generation")
    renewal = await import("@/lib/chart-renewal")
    persist = cg.__inMemoryChartGenerationPersist()
    cg.__setChartGenerationPersistForTest(persist)
    fpUsMode = "rows"
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

  it("seeds a NOW+US series snapshot from a fresh FP chart (FP-only, zero JW traffic)", async () => {
    const pin = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect(pin.id).toBe("20261022-00")
    expect(pin.snapshot?.status).toBe("ok")
    expect(pin.snapshot?.provenance).toBe("flixpatrol")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
  })

  it("FP transport outage retains the last good snapshot and gates retry >= 60s (never a fake empty)", async () => {
    await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> slot 20261022-12
    fpUsMode = "fail"
    const pin = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(await cg.isChartFamilyGated(NOW_US_SERIES)).toBe(true)
    const gated = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect(gated.id).toBe("20261022-00")
  })

  it("malformed FP document retains the last good snapshot (integrity failure, not a genuine empty)", async () => {
    await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    now = utc(2026, 10, 22, 11, 0, 0)
    fpUsMode = "malformed-doc"
    const pin = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(await cg.isChartFamilyGated(NOW_US_SERIES)).toBe(true)
  })

  it("malformed requested-side entries retain the last good snapshot (per-side unusable source)", async () => {
    await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    now = utc(2026, 10, 22, 11, 0, 0)
    fpUsMode = "malformed-noids"
    const pin = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect(pin.id).toBe("20261022-00")
    expect((pin.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    expect(await cg.isChartFamilyGated(NOW_US_SERIES)).toBe(true)
  })

  it("explicit fresh entries[] publishes a genuine empty (never resurrects old rows)", async () => {
    const first = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    now = utc(2026, 10, 22, 11, 0, 0)
    fpUsMode = "empty"
    const pin = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect(pin.id).toBe("20261022-12")
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
  })

  it("absent FP split publishes a genuine unavailable empty (no provenance, no throw)", async () => {
    const first = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect((first.snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([701, 702])
    now = utc(2026, 10, 22, 11, 0, 0)
    fpUsMode = "absent"
    const pin = await renewal.ensureFreshChartFamily(NOW_US_SERIES)
    expect(pin.id).toBe("20261022-12")
    expect(pin.snapshot?.status).toBe("empty")
    expect(pin.snapshot ? [...pin.snapshot.rows] : null).toEqual([])
    expect(pin.snapshot?.provenance ?? null).toBeNull()
  })
})
