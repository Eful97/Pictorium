import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import {
  CHART_LIVE_PIN_ID,
  chartFamilyGroupKey,
  commitChartFamilySnapshot,
  pinChartFamily,
  pinnedFamilyRows,
  releaseChartFamilyLease,
  tryAcquireChartFamilyLease,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
} from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"

// ---------------------------------------------------------------------------
// Cross-instance semantics against a fake KV backend with atomic EVAL.
//
// The fake interprets the module's Lua scripts by marker comment (real
// Redis/Upstash just ignore the comments) with a manually advanced clock, so
// lease expiry, compare-and-set generation guards and PX/TTL behavior are
// exercised — something the same-process memory tests cannot prove.
// ---------------------------------------------------------------------------

const { strings, kvState } = vi.hoisted(() => ({
  strings: new Map<string, { value: string; expAt: number | null }>(),
  kvState: { blockFetches: false, failAll: false, gate: null as { release: () => void } | null },
}))

function sweep(now: number): void {
  for (const [k, v] of [...strings.entries()]) {
    if (v.expAt !== null && v.expAt <= now) strings.delete(k)
  }
}

/** Wire-accurate read: values travel as strings, objects as JSON. */
function wireGet(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const fakeKv = {
  async get<T>(key: string): Promise<T | null> {
    if (kvState.failAll) throw new Error("KV down")
    sweep(Date.now())
    const e = strings.get(key)
    return (e ? wireGet(e.value) : null) as T | null
  },
  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    if (kvState.failAll) throw new Error("KV down")
    sweep(Date.now())
    strings.set(key, {
      value: typeof value === "string" ? (value as string) : JSON.stringify(value),
      expAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
    })
  },
  async del(key: string): Promise<number> {
    if (kvState.failAll) throw new Error("KV down")
    sweep(Date.now())
    return strings.delete(key) ? 1 : 0
  },
  async eval<T>(script: string, keys: string[], args: string[]): Promise<T> {
    if (kvState.failAll) throw new Error("KV down")
    sweep(Date.now())
    if (script.includes("chartfam-lease-acquire")) {
      const [key] = keys
      const [owner, px] = args
      if (strings.has(key)) return 0 as T
      strings.set(key, { value: owner, expAt: Date.now() + Number(px) })
      return 1 as T
    }
    if (script.includes("chartfam-lease-release")) {
      const [key] = keys
      const [owner] = args
      if (strings.get(key)?.value === owner) {
        strings.delete(key)
        return 1 as T
      }
      return 0 as T
    }
    if (script.includes("chartfam-commit")) {
      const [leaseKey, genKey, pubKey] = keys
      const [owner, slot, payload, pxMs] = args
      // Atomic: lease ownership + generation ordering checked server-side.
      if (strings.get(leaseKey)?.value !== owner) return "stale-lease" as T
      const cur = strings.get(genKey)?.value
      if (cur && cur >= slot) return "stale-gen" as T
      const px = Number(pxMs)
      strings.set(pubKey, { value: payload, expAt: Date.now() + px })
      strings.set(genKey, { value: slot, expAt: Date.now() + px })
      strings.delete(leaseKey)
      return "ok" as T
    }
    throw new Error(`fakeKv: unknown script ${script.slice(0, 60)}`)
  },
}

vi.mock("@/lib/kv", () => ({
  getStorageMode: () => "kv",
  getKv: () => fakeKv,
}))

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

const GROUP = { regionCode: "IT", regionLang: "it-IT", mdblistKey: null as string | null }
const JW_MOVIE = { ...GROUP, family: "jw:movie:charts" }
const PLATFORM_MOVIE = { ...GROUP, family: "platform:netflix:movie" }

function okFetch(base = 1000) {
  return vi.fn(async () => ({ rows: rowsForFamily(3, base), status: "ok" as const }))
}

describe("chart-generation KV cross-instance semantics", () => {
  let now: number

  beforeEach(() => {
    strings.clear()
    kvState.blockFetches = false
    kvState.failAll = false
    kvState.gate = null
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
    now = utc(2026, 10, 22, 8, 0, 0) // Rome 10:00 -> slot 20261022-00
    vi.spyOn(Date, "now").mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __resetChartGenerationForTest()
    __setChartGenerationPersistForTest(null)
    strings.clear()
  })

  it("one request publishes its family through the atomic commit; cross-instance cutover", async () => {
    const fetch = okFetch(1000)
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pin.id).toBe("20261022-00")
    // Durable keys exist with bounded TTLs (per group+family, no global keys).
    const group = chartFamilyGroupKey(JW_MOVIE)
    expect(strings.has(`chartfam:pub:${group}:jw:movie:charts`)).toBe(true)
    expect(strings.get(`chartfam:pubgen:${group}:jw:movie:charts`)?.value).toBe("20261022-00")
    expect(strings.has(`chartfam:pub:${group}:jw:series:charts`)).toBe(false)
    // A second instance (fresh memory, same KV) pins the published snapshot.
    __resetChartGenerationForTest()
    const pin2 = await pinChartFamily(JW_MOVIE)
    expect(pin2.id).toBe("20261022-00")
    expect(pinnedFamilyRows(pin2)?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
  })

  it("families publish independently: anime outage never blocks JW/platform", async () => {
    await ensureFreshChartFamily({ ...GROUP, family: "anime:movie" }, {
      fetch: vi.fn(async () => {
        throw new Error("mdblist down")
      }),
    })
    const animePin = await pinChartFamily({ ...GROUP, family: "anime:movie" })
    expect(animePin.id).toBe(CHART_LIVE_PIN_ID)
    // JW + platform renewals proceed on the same backend regardless.
    const jwPin = await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    expect(jwPin.id).toBe("20261022-00")
    const fpPin = await ensureFreshChartFamily(PLATFORM_MOVIE, { fetch: okFetch(2000) })
    expect(fpPin.id).toBe("20261022-00")
    expect(pinnedFamilyRows(fpPin)?.map((r) => r.tmdbId)).toEqual([2000, 2001, 2002])
  })

  it("rejects an expired owner's commit after lease lapse (no silent overwrite)", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    // A starts the refresh but its fetch BLOCKS.
    kvState.blockFetches = true
    let releaseA!: () => void
    const gateA = new Promise<void>((r) => {
      releaseA = r
    })
    const pA = ensureFreshChartFamily(JW_MOVIE, {
      fetch: vi.fn(async () => {
        if (kvState.blockFetches) await gateA
        return { rows: rowsForFamily(3, 1000), status: "ok" as const }
      }),
    })
    await new Promise((r) => setTimeout(r, 50))
    // The refresh lease (30s) expires while A's fetch is blocked.
    now += 31_000 // still slot 20261022-12 (Rome 13:00:31)
    // B (lease expired everywhere) refreshes and publishes cleanly.
    kvState.blockFetches = false
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(2000) })
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-12")
    // A's blocked fetch resolves: the lease is gone (B's commit consumed it)
    // so the atomic check rejects it — B's rows win, never a private S12.
    releaseA()
    await pA
    const pin = await pinChartFamily(JW_MOVIE)
    expect(pin.id).toBe("20261022-12")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([2000, 2001, 2002])
  })

  it("rejects out-of-order concurrent generations (older slot never wins)", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-00")
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(2000) })
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-12")
    // A late S00 commit (stale owner, stale generation) loses the CAS guard.
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

  it("lease serializes concurrent publishers; generation guard orders slots", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    const ownerA = (await tryAcquireChartFamilyLease(JW_MOVIE)) as string
    // B cannot acquire while A holds the lease.
    expect(await tryAcquireChartFamilyLease(JW_MOVIE)).toBeNull()
    await releaseChartFamilyLease(JW_MOVIE, ownerA)
    // After release B acquires, but the slot rolled: B publishes the NEW
    // slot (same-slot republish would lose the generation guard, correctly).
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    const ownerB = (await tryAcquireChartFamilyLease(JW_MOVIE)) as string
    expect(ownerB).not.toBeNull()
    const pin = await commitChartFamilySnapshot(
      { ...JW_MOVIE, rows: rowsForFamily(3, 5000), status: "ok" },
      ownerB,
    )
    expect(pin.id).toBe("20261022-12")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([5000, 5001, 5002])
    await releaseChartFamilyLease(JW_MOVIE, ownerB)
    // A's released lease no longer commits anything (already released).
    expect(await tryAcquireChartFamilyLease(JW_MOVIE)).not.toBeNull()
  })

  it("write failure publishes nothing private (last good kept, retry resumes)", async () => {
    await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(1000) })
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-00")
    kvState.failAll = true
    now = utc(2026, 10, 22, 11, 0, 0) // slot 20261022-12
    // Refresh runs against the dead backend: nothing durably publishes.
    // Serving fails open to the LAST GOOD snapshot (KV reads fail → memory).
    const pin = await ensureFreshChartFamily(JW_MOVIE, { fetch: okFetch(2000) })
    expect(pin.id).toBe("20261022-00")
    expect(pinnedFamilyRows(pin)?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
    // A fresh instance with no memory sees live (KV down), never the
    // unpublished S12 rows.
    __resetChartGenerationForTest()
    expect((await pinChartFamily(JW_MOVIE)).id).toBe(CHART_LIVE_PIN_ID)
    kvState.failAll = false
  })
})
