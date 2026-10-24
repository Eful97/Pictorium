import os from "node:os"
import path from "node:path"
import fsp from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CHART_FAILURE_RETRY_MS,
  CHART_LIVE_PIN_ID,
  CHART_READY_TTL_MS,
  chartFamilyGroupKey,
  chartGroupKey,
  chartListGroupKey,
  chartPinCacheFragment,
  commitChartFamilySnapshot,
  currentChartSlotFloor,
  describeChartGroup,
  isBuiltInChartCatalogId,
  isChartFamilyGated,
  isEmptyLegitimateFamily,
  isKeyedChartFamily,
  nextRomeSlotStartMs,
  pinChartFamily,
  pinnedFamilyRows,
  releaseChartFamilyLease,
  romeSlotKey,
  romeSlotStartMs,
  tryAcquireChartFamilyLease,
  __fileChartGenerationPersistForTest,
  __inMemoryChartGenerationPersist,
  __resetChartGenerationForTest,
  __setChartGenerationDirForTest,
  __setChartGenerationPersistForTest,
} from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"
import { GLOBAL_REGION_CODE } from "@/lib/regions"

function utc(y: number, mo: number, d: number, h: number, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

function rowsForFamily(n = 3, base = 1000) {
  return Array.from({ length: n }, (_, i) => ({
    tmdbId: base + i,
    imdbId: `tt${base + i}`,
    rank: i + 1,
    title: `title ${base + i}`,
  }))
}

function okFetch(base = 1000, n = 3) {
  return vi.fn(async () => ({ rows: rowsForFamily(n, base), status: "ok" as const }))
}

function failingFetch() {
  return vi.fn(async (): Promise<{ rows: unknown[]; status: "error" }> => {
    throw new Error("upstream down")
  })
}

function neverFetch() {
  return vi.fn(async (): Promise<never> => {
    throw new Error("must not fetch")
  })
}

const GROUP = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null }
const JW_MOVIE = { ...GROUP, family: "jw:movie:charts" }
const ANIME_MOVIE = { ...GROUP, family: "anime:movie" }

describe("chart-generation Rome slots (portable, DST-aware)", () => {
  beforeEach(() => {
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
  })

  it("maps winter UTC boundaries to Rome 00/12 slots", () => {
    // Rome = UTC+1 in January.
    expect(romeSlotKey(utc(2026, 1, 15, 10, 59, 59))).toBe("20260115-00")
    expect(romeSlotKey(utc(2026, 1, 15, 11, 0, 0))).toBe("20260115-12")
    expect(romeSlotKey(utc(2026, 1, 14, 22, 59, 59))).toBe("20260114-12")
    expect(romeSlotKey(utc(2026, 1, 14, 23, 0, 0))).toBe("20260115-00")
  })

  it("maps summer UTC boundaries to Rome 00/12 slots", () => {
    // Rome = UTC+2 in July.
    expect(romeSlotKey(utc(2026, 7, 1, 9, 59, 59))).toBe("20260701-00")
    expect(romeSlotKey(utc(2026, 7, 1, 10, 0, 0))).toBe("20260701-12")
    expect(romeSlotKey(utc(2026, 6, 30, 21, 59, 59))).toBe("20260630-12")
    expect(romeSlotKey(utc(2026, 6, 30, 22, 0, 0))).toBe("20260701-00")
  })

  it("handles spring-forward (2026-03-29, 02:00 -> 03:00) inside slot 00", () => {
    expect(romeSlotKey(utc(2026, 3, 29, 0, 59))).toBe("20260329-00") // 01:59 +01
    expect(romeSlotKey(utc(2026, 3, 29, 1, 0))).toBe("20260329-00") // 03:00 +02
    expect(romeSlotKey(utc(2026, 3, 29, 9, 59))).toBe("20260329-00") // 11:59 +02
    expect(romeSlotKey(utc(2026, 3, 29, 10, 0))).toBe("20260329-12") // 12:00 +02
  })

  it("handles fall-back (2026-10-25, repeated 02:xx) inside slot 00", () => {
    expect(romeSlotKey(utc(2026, 10, 25, 0, 30))).toBe("20261025-00") // 02:30 +02 (first)
    expect(romeSlotKey(utc(2026, 10, 25, 1, 30))).toBe("20261025-00") // 02:30 +01 (second)
    expect(romeSlotKey(utc(2026, 10, 25, 10, 59))).toBe("20261025-00") // 11:59 +01
    expect(romeSlotKey(utc(2026, 10, 25, 11, 0))).toBe("20261025-12") // 12:00 +01
  })

  it("is independent of the server timezone", () => {
    const prev = process.env.TZ
    try {
      const t = utc(2026, 10, 22, 10, 0, 0)
      process.env.TZ = "America/New_York"
      const a = romeSlotKey(t)
      process.env.TZ = "Pacific/Kiritimati"
      const b = romeSlotKey(t)
      process.env.TZ = "UTC"
      const c = romeSlotKey(t)
      expect(a).toBe("20261022-12")
      expect(b).toBe("20261022-12")
      expect(c).toBe("20261022-12")
    } finally {
      if (prev === undefined) delete process.env.TZ
      else process.env.TZ = prev
    }
  })

  it("slot starts are 12h apart and bracket their slot", () => {
    const slot = "20260115-00"
    const start = romeSlotStartMs(slot)
    expect(start).toBeGreaterThan(0)
    expect(romeSlotKey(start)).toBe(slot)
    expect(romeSlotKey(start + 12 * 3600 * 1000 - 1)).toBe(slot)
    expect(romeSlotKey(start + 12 * 3600 * 1000)).toBe("20260115-12")
    expect(romeSlotStartMs("20260115-12") - start).toBe(12 * 3600 * 1000)
    expect(romeSlotStartMs("garbage")).toBe(0)
  })

  it("spring-forward 00 slots last 11h, fall-back 00 slots last 13h", () => {
    // 2026-03-29: 00:00 +01 -> 12:00 +02 is 11 wall hours.
    const springStart = romeSlotStartMs("20260329-00")
    expect(romeSlotStartMs("20260329-12") - springStart).toBe(11 * 3600 * 1000)
    expect(nextRomeSlotStartMs(springStart)).toBe(romeSlotStartMs("20260329-12"))
    // 2026-10-25: 00:00 +02 -> 12:00 +01 is 13 wall hours.
    const fallStart = romeSlotStartMs("20261025-00")
    expect(romeSlotStartMs("20261025-12") - fallStart).toBe(13 * 3600 * 1000)
    expect(nextRomeSlotStartMs(fallStart)).toBe(romeSlotStartMs("20261025-12"))
  })

  it("freshness floor is the current slot start", () => {
    const now = utc(2026, 10, 22, 8, 0, 0)
    expect(romeSlotKey(now)).toBe("20261022-00")
    expect(currentChartSlotFloor(now)).toBe(romeSlotStartMs("20261022-00"))
  })
})

describe("chart-generation group identity (no global barrier)", () => {
  beforeEach(() => {
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
  })
  afterEach(() => {
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
  })

  it("isolates credential-bearing anime on the MDB key hash, never raw secrets", () => {
    const a = chartGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: "secret-key-1" })
    const b = chartGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: "secret-key-1" })
    const c = chartGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: "secret-key-2" })
    const d = chartGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: null })
    expect(a).toBe(b)
    expect(new Set([a, c, d]).size).toBe(3)
    for (const k of [a, c, d]) expect(k).not.toContain("secret-key")
    expect(describeChartGroup({ regionCode: "IT", regionLang: "it-IT", mdblistKey: "secret-key-1" })).not.toContain("secret-key-1")
    expect(describeChartGroup({ regionCode: "IT", regionLang: "it-IT", mdblistKey: null })).toContain("public")
  })

  it("shares JW/platform rows regardless of unrelated MDB credentials", () => {
    const plain = chartListGroupKey({ regionCode: "IT", regionLang: "it-IT" })
    expect(plain).toBe(chartListGroupKey({ regionCode: "IT", regionLang: "it-IT" }))
    expect(chartListGroupKey({ regionCode: "IT", regionLang: "fr-FR" })).not.toBe(plain)
    // Family-aware routing: anime isolates on the key, everything else shares.
    expect(isKeyedChartFamily("anime:movie")).toBe(true)
    expect(isKeyedChartFamily("anime:series")).toBe(true)
    expect(isKeyedChartFamily("jw:movie:charts")).toBe(false)
    expect(isKeyedChartFamily("platform:netflix:movie")).toBe(false)
    const keyed = chartFamilyGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: "k1", family: "anime:movie" })
    const pub = chartFamilyGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: null, family: "anime:movie" })
    expect(keyed).not.toBe(pub)
    expect(keyed).not.toContain("k1")
    const jwA = chartFamilyGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: "k1", family: "jw:movie:charts" })
    const jwB = chartFamilyGroupKey({ regionCode: "IT", regionLang: "it-IT", mdblistKey: null, family: "jw:movie:charts" })
    expect(jwA).toBe(jwB)
  })

  it("treats empty as legitimate only for GLOBAL platform charts", () => {
    expect(isEmptyLegitimateFamily("platform:netflix:movie", GLOBAL_REGION_CODE)).toBe(true)
    expect(isEmptyLegitimateFamily("platform:netflix:movie", "IT")).toBe(false)
    expect(isEmptyLegitimateFamily("jw:movie:charts", GLOBAL_REGION_CODE)).toBe(false)
    expect(isEmptyLegitimateFamily("anime:movie", GLOBAL_REGION_CODE)).toBe(false)
  })

  it("routes built-in family-backed catalogs, excluding custom/search", () => {
    expect(isBuiltInChartCatalogId("pictorium-jw-movies")).toBe(true)
    expect(isBuiltInChartCatalogId("pictorium-jw-series")).toBe(true)
    expect(isBuiltInChartCatalogId("pictorium-anime-movies")).toBe(true)
    expect(isBuiltInChartCatalogId("pictorium-anime")).toBe(true)
    expect(isBuiltInChartCatalogId("pictorium-netflix-movies")).toBe(true)
    expect(isBuiltInChartCatalogId("pictorium-prime-series")).toBe(true)
    expect(isBuiltInChartCatalogId("pictorium-search-movies")).toBe(false)
    expect(isBuiltInChartCatalogId("pictorium-custom-abc")).toBe(false)
  })

  it("pins the ready-body TTL contract", () => {
    expect(CHART_READY_TTL_MS).toBe(12 * 60 * 60 * 1000)
  })
})

describe("chart-generation per-family refresh lifecycle", () => {
  let now: number

  beforeEach(() => {
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(__inMemoryChartGenerationPersist())
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> 6h slot 20261022-06 (12h: -00), 13:00 -> -12
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
  })

  it("cold start pins live with no rows", async () => {
    const pin = await pinChartFamily(JW_MOVIE)
    expect(pin.id).toBe(CHART_LIVE_PIN_ID)
    expect(pin.snapshot).toBeNull()
    expect(pinnedFamilyRows(pin)).toBeNull()
    expect(chartPinCacheFragment(pin)).toBe(":cglive")
  })

  it("cold success publishes immediately (one fetch, no unrelated families)", async () => {
    const fetch = okFetch(1000)
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pin.id).toBe("20261022-06")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
    expect(chartPinCacheFragment(pin)).toBe(":cg20261022-06")
    // Sibling families are untouched: no barrier, no piggyback.
    expect((await pinChartFamily({ ...GROUP, family: "jw:series:charts" })).id).toBe(CHART_LIVE_PIN_ID)
    expect((await pinChartFamily(ANIME_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
  })

  it("current pin serves with zero fetches (no churn inside the slot)", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    const fetch = neverFetch()
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch })
    expect(fetch).not.toHaveBeenCalled()
    expect(pin.id).toBe("20261022-06")
  })

  it("one stale request refreshes THAT family only", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> slot 20261022-12
    const fetch = okFetch(2000)
    const otherFetch = neverFetch()
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pin.id).toBe("20261022-12")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([2000, 2001, 2002])
    // No unrelated fetching: other families stay exactly as they were.
    expect(otherFetch).not.toHaveBeenCalled()
    expect((await pinChartFamily({ ...GROUP, family: "jw:series:charts" })).id).toBe(CHART_LIVE_PIN_ID)
    expect((await pinChartFamily(ANIME_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
  })

  it("competitors serve old rows while the owner refreshes; new rows after", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const blockingFetch = vi.fn(async () => {
      await gate
      return { rows: rowsForFamily(3, 2000), status: "ok" as const }
    })
    const pOwner = ensureFreshChartFamily(JW_MOVIE, { fetch: blockingFetch })
    await new Promise((r) => setTimeout(r, 20)) // owner holds the lease, fetching
    const competitor = await ensureFreshChartFamily(JW_MOVIE, { fetch: neverFetch() })
    expect(competitor.id).toBe("20261022-06")
    expect(pinnedFamilyRows(competitor)?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
    release()
    const ownerPin = await pOwner
    expect(ownerPin.id).toBe("20261022-12")
    expect(pinnedFamilyRows(ownerPin)?.map((r) => r.tmdbId)).toEqual([2000, 2001, 2002])
    // Converged: later reads serve new rows with zero fetches.
    const after = await ensureFreshChartFamily(JW_MOVIE, { fetch: neverFetch() })
    expect(after.id).toBe("20261022-12")
  })

  it("source failure retains the previous snapshot and gates retry >= 60s", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> current slot 20261022-12; retained pin is the 06 slot
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch: failingFetch() })
    expect(pin.id).toBe("20261022-06")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
    expect(await isChartFamilyGated(JW_MOVIE)).toBe(true)
    // Gated retry 10s later: no fetch, old rows kept.
    now += 10_000
    const gated = await ensureFreshChartFamily(JW_MOVIE, { fetch: neverFetch() })
    expect(gated.id).toBe("20261022-06")
    // After the gate, the refresh succeeds.
    now += CHART_FAILURE_RETRY_MS
    const recovered = await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(2000) })
    expect(recovered.id).toBe("20261022-12")
  })

  it("MDB failure blocks only anime; JW renews independently", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    const animePin = await ensureFreshChartFamily(ANIME_MOVIE, { fetch: failingFetch() })
    expect(animePin.id).toBe(CHART_LIVE_PIN_ID) // cold + failure -> live
    const jwPin = await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(2000) })
    expect(jwPin.id).toBe("20261022-12")
    expect(pinnedFamilyRows(jwPin)?.map((r) => r.tmdbId)).toEqual([2000, 2001, 2002])
  })

  it("retains the previous anime snapshot across an MDB outage", async () => {
    await ensureFreshChartFamily(ANIME_MOVIE, { fetch: okFetch(9000) })
    expect((await pinChartFamily(ANIME_MOVIE)).id).toBe("20261022-00")
    now = utc(2026, 10, 22, 11, 0, 0)
    const pin = await ensureFreshChartFamily(ANIME_MOVIE, { fetch: failingFetch() })
    expect(pin.id).toBe("20261022-00")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([9000, 9001, 9002])
  })

  it("isolates keyed vs public anime payloads", async () => {
    const keyed = { ...GROUP, mdblistKey: "k1", family: "anime:movie" }
    const pub = { ...GROUP, mdblistKey: null, family: "anime:movie" }
    await ensureFreshChartFamily(keyed, { fetch: okFetch(1000) })
    expect((await pinChartFamily(keyed)).id).toBe("20261022-00")
    expect((await pinChartFamily(pub)).id).toBe(CHART_LIVE_PIN_ID)
    expect(pinnedFamilyRows(await pinChartFamily(pub))).toBeNull()
    expect(pinnedFamilyRows(await pinChartFamily(keyed))).toHaveLength(3)
  })

  it("shares JW rows across unrelated MDB credentials", async () => {
    const keyed = { ...GROUP, mdblistKey: "k1", family: "jw:movie:charts" }
    const pub = { ...GROUP, mdblistKey: null, family: "jw:movie:charts" }
    await ensureFreshChartFamily(keyed, { fetch: okFetch(1000) })
    const pin = await pinChartFamily(pub)
    expect(pin.id).toBe("20261022-06")
    expect(pinnedFamilyRows(pin)).toHaveLength(3)
  })

  it("fails closed on invalid rows (no publish, gated)", async () => {
    const pin = await ensureFreshChartFamily(JW_MOVIE, {
      fetch: vi.fn(async () => ({ rows: [{ nope: 1 }], status: "ok" as const })),
    })
    expect(pin.id).toBe(CHART_LIVE_PIN_ID)
    expect(await isChartFamilyGated(JW_MOVIE)).toBe(true)
  })

  it("records the winning provenance (JW fast-path vs FlixPatrol fallback)", async () => {
    const owner = await tryAcquireChartFamilyLease(JW_MOVIE)
    expect(owner).not.toBeNull()
    try {
      const pin = await commitChartFamilySnapshot(
        { ...JW_MOVIE, rows: rowsForFamily(3, 1000), status: "ok", provenance: "flixpatrol" },
        owner as string,
      )
      expect(pin.snapshot?.provenance).toBe("flixpatrol")
    } finally {
      await releaseChartFamilyLease(JW_MOVIE, owner as string)
    }
  })

  it("rejects out-of-order completion (older slot never overwrites a newer publish)", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(2000) })
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-12")
    // A late S00 completion (clock back in S00) never resurrects: the newer
    // pin wins the currency check and no fetch even runs.
    now = utc(2026, 10, 22, 8, 30, 0) // back in S00
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch: neverFetch() })
    expect(pin.id).toBe("20261022-12")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([2000, 2001, 2002])
    // Same guarantee at the commit layer: a guarded stale write loses.
    const owner = (await tryAcquireChartFamilyLease(JW_MOVIE)) as string
    try {
      const stale = await commitChartFamilySnapshot(
        { ...JW_MOVIE, rows: rowsForFamily(3, 3000), status: "ok", slot: "20261022-00" },
        owner,
      )
      expect(stale.id).toBe("20261022-12")
      expect(pinnedFamilyRows(stale)?.map((r) => r.tmdbId)).toEqual([2000, 2001, 2002])
    } finally {
      await releaseChartFamilyLease(JW_MOVIE, owner)
    }
  })

  it("refuses oversized snapshots (bounded footprint, last good kept)", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    const owner = (await tryAcquireChartFamilyLease(JW_MOVIE)) as string
    try {
      const big = Array.from({ length: 100_000 }, (_, i) => ({ tmdbId: i + 1, imdbId: null, rank: i + 1 }))
      const pin = await commitChartFamilySnapshot({ ...JW_MOVIE, rows: big, status: "ok" }, owner)
      expect(pin.id).toBe("20261022-06")
      expect(pinnedFamilyRows(pin)).toHaveLength(3)
    } finally {
      await releaseChartFamilyLease(JW_MOVIE, owner)
    }
  })
})

describe("chart-generation persistence (restart + cross-instance + file)", () => {
  let now: number

  beforeEach(() => {
    __resetChartGenerationForTest()
    now = utc(2026, 10, 22, 8, 0, 0)
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
    __setChartGenerationDirForTest(null)
  })

  it("reloads the published snapshot after restart (fresh memory, same backend)", async () => {
    const shared = __inMemoryChartGenerationPersist()
    __setChartGenerationPersistForTest(shared)
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-06")
    // "Restart": drop all in-memory state, keep the backend.
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(shared)
    const pin = await pinChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-06")
    expect(pinnedFamilyRows(pin)).toHaveLength(3)
  })

  it("second instance sees the first instance publish (cross-instance)", async () => {
    const shared = __inMemoryChartGenerationPersist()
    __setChartGenerationPersistForTest(shared)
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    // Instance B (fresh memory, same backend) pins the published snapshot.
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(shared)
    const pin = await pinChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-06")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
  })

  it("persists to a file backend with atomic replace (restart-safe without KV)", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "chartfam-test-"))
    try {
      __setChartGenerationPersistForTest(__fileChartGenerationPersistForTest(dir))
      await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
      expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-06")
      const files = await fsp.readdir(dir)
      expect(files.some((f) => f.startsWith("chartfam-pub-"))).toBe(true)
      // No tmp litter from failed atomic replaces.
      expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([])
      // "Restart": drop memory, keep the directory -> snapshot reloads.
      __resetChartGenerationForTest()
      __setChartGenerationPersistForTest(__fileChartGenerationPersistForTest(dir))
      const pin = await pinChartFamily(JW_MOVIE)
      expect(pin.id).toBe("20261022-06")
      expect(pinnedFamilyRows(pin)).toHaveLength(3)
      const blob = JSON.stringify(await fsp.readFile(files.filter((f) => f.startsWith("chartfam-pub-")).map((f) => path.join(dir, f))[0], "utf-8"))
      expect(blob).not.toContain("super-secret")
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })

  it("refuses private publication when durable storage fails (cold stays live)", async () => {
    const failing = __inMemoryChartGenerationPersist()
    failing.loadPublished = async () => {
      throw new Error("KV down")
    }
    failing.commitPublished = async () => {
      throw new Error("KV down")
    }
    failing.loadMeta = async () => {
      throw new Error("KV down")
    }
    __setChartGenerationPersistForTest(failing)
    // The commit throws: memory must NOT be marked — no private unpublished
    // publication. Serving fails open to live.
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    expect(pin.id).toBe(CHART_LIVE_PIN_ID)
    // A fresh process (same backend) still sees live, never the unpublished.
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(failing)
    expect((await pinChartFamily(JW_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
  })

  it("keeps serving the last published snapshot when storage fails mid-cycle", async () => {
    const shared = __inMemoryChartGenerationPersist()
    __setChartGenerationPersistForTest(shared)
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-06")
    shared.loadPublished = async () => {
      throw new Error("KV down")
    }
    shared.commitPublished = async () => {
      throw new Error("KV down")
    }
    now = utc(2026, 10, 22, 11, 0, 0) // Rome 13:00 -> current slot 20261022-12; last good is the 06 pin
    // Durable reads fail -> memory fallback serves the last good snapshot.
    // The refresh fetch still runs (bounded) but its commit cannot land, so
    // the pin stays on the old snapshot — never a private publication.
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(2000) })
    expect(pin.id).toBe("20261022-06")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
  })

  it("single-process file mode stays exact; multi-process file is best-effort", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "chartfam-test-"))
    try {
      __setChartGenerationPersistForTest(__fileChartGenerationPersistForTest(dir))
      // Two concurrent owners for the same family: the memory lease
      // serializes them single-process (competitor serves old, no double
      // publish); the generation guard is the durable backstop.
      await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
      const ownerA = await tryAcquireChartFamilyLease(JW_MOVIE)
      expect(ownerA).not.toBeNull()
      const ownerB = await tryAcquireChartFamilyLease(JW_MOVIE)
      expect(ownerB).toBeNull()
      await releaseChartFamilyLease(JW_MOVIE, ownerA as string)
      const ownerC = await tryAcquireChartFamilyLease(JW_MOVIE)
      expect(ownerC).not.toBeNull()
      await releaseChartFamilyLease(JW_MOVIE, ownerC as string)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})
