/**
 * T1 shared backend contract — fixed family cadence.
 *
 * User-confirmed policy: Top 20 JustWatch (charts/popular/trending, incl.
 * `stream2:justwatch:*` opt-in selections) refresh on Europe/Rome
 * 00/06/12/18 boundaries; legacy `stream:`/platforms, `stream2:auto|flixpatrol`
 * and anime stay on 00/12. The policy is by FAMILY NAME (selection policy),
 * never by provenance. No new scheduler: lazy first-request-after-boundary
 * refresh is retained. DST-aware absolute ends; no wall-clock 6h real-
 * timedelta claim on DST days.
 *
 * Old 12h pins migrate naturally (same ids at 00/12): a JW pin from 00:xx is
 * current until 06:00, then stale (refresh); FP/anime 00 pins stay fresh
 * until 12:00. Leases/publish out-of-order/retention/group isolation are
 * unchanged (covered by the existing chart-generation suites).
 */
import { describe, expect, it, vi } from "vitest"
import {
  __resetChartGenerationForTest,
  __inMemoryChartGenerationPersist,
  __setChartGenerationPersistForTest,
  familySlotEndMs,
  familySlotFloorMs,
  familySlotKey,
  isSixHourChartFamily,
  nextFamilySlotKey,
  pinChartFamily,
  romeSlotStartMs,
} from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"

const utc = (...args: [number, number, number, number, number, number]) =>
  Date.UTC(...args)

const JW_MOVIE = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:charts" }
const JW_POPULAR = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:movie:popular" }
const JW_TRENDING = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "jw:series:trending" }
const STREAM2_JW = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "stream2:justwatch:netflix:italy:movies:-" }
const STREAM2_AUTO = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "stream2:auto:netflix:italy:movies:-" }
const STREAM2_FP = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "stream2:flixpatrol:netflix:italy:movies:-" }
const LEGACY_STREAM = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "stream:netflix:movie" }
const PLATFORM = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "platform:netflix:movie" }
const ANIME = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null, family: "anime:movie" }

function okFetch(ids: number[]) {
  return vi.fn(async () => ({
    rows: ids.map((tmdbId, i) => ({ tmdbId, imdbId: null, rank: i + 1, title: `T${tmdbId}` })),
    status: "ok" as const,
  }))
}

describe("family cadence policy (6h JW vs 12h legacy)", () => {
  it("selects cadence by exact family id, never by provenance", () => {
    for (const f of [
      "jw:movie:charts",
      "jw:movie:popular",
      "jw:movie:trending",
      "jw:series:charts",
      "jw:series:popular",
      "jw:series:trending",
      "stream2:justwatch:netflix:italy:movies:-",
      "stream2:justwatch:rai:italy:all:it",
    ]) {
      expect(isSixHourChartFamily(f)).toBe(true)
    }
    for (const f of [
      "platform:netflix:movie",
      "platform:prime:series",
      "stream:netflix:movie",
      "stream:now:series",
      "stream2:auto:netflix:italy:movies:-",
      "stream2:flixpatrol:netflix:italy:movies:-",
      "stream2:auto:rai:italy:all:it",
      "anime:movie",
      "anime:series",
      "jw:movie:charts:extra",
      "stream2:justwatch",
    ]) {
      expect(isSixHourChartFamily(f)).toBe(false)
    }
  })

  it("6h slot ids coincide with 12h ids at 00/12 (natural migration, no flush)", () => {
    // Rome 04:00 -> 00 window; Rome 07:00/10:00 -> 06 window; 13:00 -> 12; 22:00 -> 18.
    expect(familySlotKey("jw:movie:charts", utc(2026, 9, 22, 2, 0, 0))).toBe("20261022-00")
    expect(familySlotKey("jw:movie:charts", utc(2026, 9, 22, 5, 0, 0))).toBe("20261022-06")
    expect(familySlotKey("jw:movie:charts", utc(2026, 9, 22, 8, 0, 0))).toBe("20261022-06")
    expect(familySlotKey("jw:movie:charts", utc(2026, 9, 22, 11, 0, 0))).toBe("20261022-12")
    expect(familySlotKey("jw:movie:charts", utc(2026, 9, 22, 20, 0, 0))).toBe("20261022-18")
    expect(familySlotKey("jw:movie:charts", utc(2026, 9, 22, 22, 0, 0))).toBe("20261023-00")
    // Legacy families keep the 12h ids byte-identically (incl. stream2:auto).
    expect(familySlotKey(PLATFORM.family, utc(2026, 9, 22, 8, 0, 0))).toBe("20261022-00")
    expect(familySlotKey(PLATFORM.family, utc(2026, 9, 22, 20, 0, 0))).toBe("20261022-12")
    expect(familySlotKey(STREAM2_AUTO.family, utc(2026, 9, 22, 8, 0, 0))).toBe("20261022-00")
    expect(familySlotKey(STREAM2_FP.family, utc(2026, 9, 22, 8, 0, 0))).toBe("20261022-00")
    expect(familySlotKey(LEGACY_STREAM.family, utc(2026, 9, 22, 20, 0, 0))).toBe("20261022-12")
    expect(familySlotKey(ANIME.family, utc(2026, 9, 22, 8, 0, 0))).toBe("20261022-00")
    expect(familySlotKey(ANIME.family, utc(2026, 9, 22, 20, 0, 0))).toBe("20261022-12")
    expect(familySlotKey(STREAM2_JW.family, utc(2026, 9, 22, 8, 0, 0))).toBe("20261022-06")
  })

  it("6h chains advance 00->06->12->18->next-day 00; 12h chains unchanged", () => {
    expect(nextFamilySlotKey("jw:movie:charts", "20261022-00")).toBe("20261022-06")
    expect(nextFamilySlotKey("jw:movie:charts", "20261022-06")).toBe("20261022-12")
    expect(nextFamilySlotKey("jw:movie:charts", "20261022-12")).toBe("20261022-18")
    expect(nextFamilySlotKey("jw:movie:charts", "20261022-18")).toBe("20261023-00")
    expect(nextFamilySlotKey("platform:netflix:movie", "20261022-00")).toBe("20261022-12")
    expect(nextFamilySlotKey("platform:netflix:movie", "20261022-12")).toBe("20261023-00")
    expect(nextFamilySlotKey("jw:movie:charts", "garbage")).toBeNull()
    expect(nextFamilySlotKey("anime:movie", "20261022-06")).toBe("20261022-12")
  })

  it("family ends are absolute slot boundaries (DST-aware, no fixed-delta claim)", () => {
    // Ordinary day: 6h ends land on wall-clock boundaries.
    expect(familySlotEndMs("jw:movie:charts", "20261022-06")).toBe(romeSlotStartMs("20261022-12"))
    expect(familySlotEndMs("jw:movie:charts", "20261022-18")).toBe(romeSlotStartMs("20261023-00"))
    // Legacy end unchanged (12h chain).
    expect(familySlotEndMs("platform:netflix:movie", "20261022-00")).toBe(romeSlotStartMs("20261022-12"))
    expect(familySlotEndMs("anime:movie", "20261022-00")).toBe(romeSlotStartMs("20261022-12"))
    // Old 12h ids under a 6h family resolve onto the 6h chain (migration).
    expect(familySlotEndMs("jw:movie:charts", "20261022-00")).toBe(romeSlotStartMs("20261022-06"))
    expect(familySlotEndMs("jw:movie:charts", "garbage")).toBe(0)
    // DST spring-forward day (2026-03-29): absolute ends stay wall-clock exact.
    expect(familySlotEndMs("jw:movie:charts", "20260329-00")).toBe(Date.parse("2026-03-29T04:00:00Z"))
    expect(familySlotEndMs("jw:movie:charts", "20260329-06")).toBe(Date.parse("2026-03-29T10:00:00Z"))
    // DST fall-back day (2026-10-25): repeated 02:xx stays in the 00 slot.
    expect(familySlotKey("jw:series:charts", Date.parse("2026-10-25T00:30:00Z"))).toBe("20261025-00")
    expect(familySlotKey("jw:series:charts", Date.parse("2026-10-25T01:30:00Z"))).toBe("20261025-00")
    expect(familySlotKey("jw:series:charts", Date.parse("2026-10-25T11:00:00Z"))).toBe("20261025-12")
  })

  it("family floor is the current slot start (6h JW vs 12h legacy)", () => {
    const at = utc(2026, 9, 22, 8, 0, 0) // Rome 10:00
    expect(familySlotFloorMs("jw:movie:charts", at)).toBe(romeSlotStartMs("20261022-06"))
    expect(familySlotFloorMs("jw:series:trending", at)).toBe(romeSlotStartMs("20261022-06"))
    expect(familySlotFloorMs("stream2:justwatch:netflix:italy:movies:-", at)).toBe(romeSlotStartMs("20261022-06"))
    expect(familySlotFloorMs("platform:netflix:movie", at)).toBe(romeSlotStartMs("20261022-00"))
    expect(familySlotFloorMs("stream:netflix:movie", at)).toBe(romeSlotStartMs("20261022-00"))
    expect(familySlotFloorMs("stream2:auto:netflix:italy:movies:-", at)).toBe(romeSlotStartMs("20261022-00"))
    expect(familySlotFloorMs("anime:movie", at)).toBe(romeSlotStartMs("20261022-00"))
  })

  it("old 12h JW pins stay current until 06:00, then refresh (no flush)", async () => {
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    try {
      const fetch = okFetch([1, 2, 3])
      // Publish in the 00-06 window with an old-style id (same string as the
      // new 6h slot: natural migration, no flush).
      vi.spyOn(Date, "now").mockImplementation(() => utc(2026, 9, 22, 1, 0, 0))
      const first = await ensureFreshChartFamily(JW_MOVIE, { fetch })
      expect(first.id).toBe("20261022-00")
      expect(fetch).toHaveBeenCalledTimes(1)
      // Still 00-06: current, zero refetch.
      vi.spyOn(Date, "now").mockImplementation(() => utc(2026, 9, 22, 3, 30, 0))
      const current = await ensureFreshChartFamily(JW_MOVIE, { fetch })
      expect(current.id).toBe("20261022-00")
      expect(fetch).toHaveBeenCalledTimes(1)
      // Past 06:00 the same pin is stale: exactly one refresh to the 06 slot.
      vi.spyOn(Date, "now").mockImplementation(() => utc(2026, 9, 22, 5, 0, 0))
      const refreshed = await ensureFreshChartFamily(JW_MOVIE, { fetch })
      expect(refreshed.id).toBe("20261022-06")
      expect(fetch).toHaveBeenCalledTimes(2)
      // FP/anime 12h pins are unaffected at the same instant: anime publishes
      // its own 00 slot here (proving the 6h change is JW-scoped).
      const anime = await ensureFreshChartFamily(
        { regionCode: "IT", regionLang: "it-IT", mdblistKey: null, family: "anime:movie" },
        { fetch },
      )
      expect(anime.id).toBe("20261022-00")
    } finally {
      vi.restoreAllMocks()
      __resetChartGenerationForTest()
      __setChartGenerationPersistForTest(null)
    }
  })

  it("JW popular/trending families follow the 6h cadence with independent generations", async () => {
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    try {
      vi.spyOn(Date, "now").mockImplementation(() => utc(2026, 9, 22, 8, 0, 0))
      const charts = await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch([1]) })
      const popular = await ensureFreshChartFamily(JW_POPULAR, { fetch: okFetch([2]) })
      const trending = await ensureFreshChartFamily(JW_TRENDING, { fetch: okFetch([3]) })
      expect(charts.id).toBe("20261022-06")
      expect(popular.id).toBe("20261022-06")
      expect(trending.id).toBe("20261022-06")
      // Same generation, isolated rows (no cross-mode leakage).
      expect(((await pinChartFamily(JW_MOVIE)).snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([1])
      expect(((await pinChartFamily(JW_TRENDING)).snapshot?.rows ?? []).map((r) => r.tmdbId)).toEqual([3])
    } finally {
      vi.restoreAllMocks()
      __resetChartGenerationForTest()
      __setChartGenerationPersistForTest(null)
    }
  })
})
