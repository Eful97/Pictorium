import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  pinChartFamily,
  pinnedFamilyRows,
  releaseChartFamilyLease,
  tryAcquireChartFamilyLease,
  __inMemoryChartGenerationPersist,
  __resetChartGenerationForTest,
  __setChartGenerationPersistForTest,
} from "@/lib/chart-generation"
import { ensureFreshChartFamily } from "@/lib/chart-renewal"

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

describe("chart-renewal lease held through commit", () => {
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
  })

  it("holds the owner lease until the commit completes (competitors lose during commit)", async () => {
    const backing = __inMemoryChartGenerationPersist()
    let releaseCommit!: () => void
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve
    })
    let commitEntered = false
    const origCommit = backing.commitPublished.bind(backing)
    backing.commitPublished = (async (group, family, slot, snap, leaseOwner) => {
      commitEntered = true
      await commitGate
      return origCommit(group, family, slot, snap, leaseOwner)
    }) as typeof backing.commitPublished
    __setChartGenerationPersistForTest(backing)

    const fetch = vi.fn(async () => ({ rows: rowsForFamily(3, 1000), status: "ok" as const }))
    const refresh = ensureFreshChartFamily(JW_MOVIE, { fetch })
    await vi.waitFor(() => expect(commitEntered).toBe(true))

    // The commit is still open and the clock never advanced (lease TTL 30s):
    // a second owner must NOT acquire the lease mid-commit.
    expect(await tryAcquireChartFamilyLease(JW_MOVIE)).toBeNull()

    // Release barrier: the refresh resolves only after the commit lands, the
    // published snapshot is served, and the lease is free again.
    releaseCommit()
    const pin = await refresh
    expect(pin.id).toBe("20261022-06") // JW 6h cadence: Rome 10:00 is the 06 slot
    expect((await pinChartFamily(JW_MOVIE)).id).toBe("20261022-06")
    expect(pinnedFamilyRows(await pinChartFamily(JW_MOVIE))?.map((r) => r.tmdbId)).toEqual([1000, 1001, 1002])
    const nextOwner = await tryAcquireChartFamilyLease(JW_MOVIE)
    expect(typeof nextOwner).toBe("string")
    if (nextOwner) await releaseChartFamilyLease(JW_MOVIE, nextOwner)
  })
})
