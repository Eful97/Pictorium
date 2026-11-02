import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { existsSync } from "node:fs"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const kvBacking = vi.hoisted(() => new Map<string, string>())
vi.mock("@/lib/upstash-kv-client", () => ({
  kv: {
    get: async (key: string): Promise<string | null> => kvBacking.get(key) ?? null,
    set: async (key: string, value: unknown): Promise<string> => {
      kvBacking.set(key, typeof value === "string" ? value : JSON.stringify(value))
      return "OK"
    },
    del: async (key: string): Promise<number> => (kvBacking.delete(key) ? 1 : 0),
  },
}))

const DAY = 24 * 60 * 60 * 1000

function okRatings(body: unknown) {
  return { ok: true, json: async () => body }
}

function notFound() {
  return { ok: false, status: 404, headers: { get: () => null } }
}

function mdblistFetch(handler: (url: string) => unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("upstash.io")) throw new Error(`real KV client leaked: ${url}`)
    if (url.includes("mdblist.com")) return handler(url) as Response
    if (url.includes("cinemeta")) return notFound() as unknown as Response
    throw new Error(`unexpected upstream ${url}`)
  })
}

function mdblistCalls(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter(([input]) => String(input).includes("mdblist.com")).length
}

const tmpDirs: string[] = []
let dataDir = ""

function approvedBase(): string {
  const approved = "C:\\Users\\lucaf\\AppData\\Local\\Temp\\opencode"
  try {
    if (existsSync(approved)) return approved
  } catch {
    // platform default
  }
  return os.tmpdir()
}

async function stubFileMode(): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(approvedBase(), "pictorium-mdblist-raw-bp-"))
  tmpDirs.push(dir)
  dataDir = dir
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("POSTERIUM_REDIS_URL", "")
  vi.stubEnv("REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
}

function rawDir(): string {
  return path.join(dataDir, "mdblist-raw")
}

const OWNED_RE = /^mdblist-raw-v1-[0-9a-f]{64}\.json$/

async function listOwnedFiles(): Promise<string[]> {
  try {
    return (await fsp.readdir(rawDir())).filter((f) => OWNED_RE.test(f))
  } catch {
    return []
  }
}

async function freshModules() {
  vi.resetModules()
  const ratings = await import("@/lib/ratings")
  const persist = await import("@/lib/mdblist-raw-cache")
  return { ratings, persist }
}

beforeEach(async () => {
  kvBacking.clear()
  await stubFileMode()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  kvBacking.clear()
  vi.resetModules()
})

afterAll(async () => {
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

describe("MDBList raw prune backpressure (correction cycle 2)", () => {
  it("paused prune after snapshot: hundreds of attempts stay bounded, flush alone converges (no manual prune)", async () => {
    const { persist } = await freshModules()
    persist.__resetMdbRawPersistForTests()
    persist.__setMdbRawPersistPolicyForTests({ maxFiles: 20, maxBytes: 1024 * 1024 })
    // Warmup: the very first write after a reset triggers the idle prune
    // (lastPruneAt = 0). Complete it first so the paused prune below is the
    // deterministic cadence prune (32 writes), not the idle one.
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt_pause_warmup:a1b2c3d4", { imdb: 7 }, DAY)).toBe(true)
    await persist.__flushMdbRawPersistPrune()
    expect(persist.__getMdbRawPersistStatsForTests().pruneInFlight).toBe(false)
    // Hold the first background prune open right after its readdir snapshot.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    persist.__setMdbRawPrunePauseAfterSnapshotForTests(() => gate)

    // 32 sequential writes trigger the cadence prune (writesSincePrune >= 32).
    let admitted = 0
    for (let i = 0; i < 32; i += 1) {
      const ok = await persist.setPersistedMdbRaw(`mdb:raw:v2:tt_pause_${i}:a1b2c3d4`, { imdb: 7 }, DAY)
      if (ok) admitted += 1
    }
    expect(admitted).toBe(32)
    // Wait until the background prune is actually in flight (paused at gate).
    for (let i = 0; i < 200 && !persist.__getMdbRawPersistStatsForTests().pruneInFlight; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(persist.__getMdbRawPersistStatsForTests().pruneInFlight).toBe(true)

    // Stream hundreds more DISTINCT attempts while the prune is held open.
    // Old code admitted all of them post-snapshot (unbounded growth to
    // 300+ files); with reservation backpressure at most maxConcurrent (8)
    // are admitted and the rest are dropped fail-open — the namespace
    // cannot grow unbounded no matter how many attempts arrive.
    let extraAdmitted = 0
    for (let i = 32; i < 332; i += 1) {
      const ok = await persist.setPersistedMdbRaw(`mdb:raw:v2:tt_pause_${i}:a1b2c3d4`, { imdb: 7 }, DAY)
      if (ok) extraAdmitted += 1
    }
    const duringFiles = await listOwnedFiles()
    // Bounded: the 300 post-snapshot attempts contribute at most the owned
    // reservation (8); total distinct stays at the soft bound
    // (caps 20 + cadence 32 + reservation 8 + warmup 1).
    expect(extraAdmitted).toBeLessThanOrEqual(8)
    expect(extraAdmitted).toBeLessThan(300)
    expect(admitted + extraAdmitted).toBeLessThanOrEqual(20 + 32 + 8 + 1)
    expect(duringFiles.length).toBeLessThanOrEqual(20 + 32 + 8 + 1)

    // Release the paused prune; the background prune (+ automatic dirty
    // follow-up via flush) must converge WITHOUT any explicit manual prune.
    release()
    persist.__setMdbRawPrunePauseAfterSnapshotForTests(null)
    await persist.__flushMdbRawPersistPrune()
    // Flush must have awaited the full chain (including any dirty-tail
    // follow-up): no prune left owned.
    expect(persist.__getMdbRawPersistStatsForTests().pruneInFlight).toBe(false)
    const after = await listOwnedFiles()
    expect(after.length).toBeLessThanOrEqual(20)
  })

  it("stalled disk read with no caller budget still misses (owned timeout), aborted caller starts no upstream", async () => {
    const { ratings, persist } = await freshModules()
    persist.__resetMdbRawPersistForTests()
    ratings.__resetMdblistBreaker()
    // Deterministic stalled disk (no node:fs mock — a test-only gate inside
    // the probe races the same owned bound, so it can never hang the caller
    // forever even when the caller passes no explicit budget).
    const never = new Promise<void>(() => {})
    persist.__setMdbRawReadGateForTests(() => never)

    try {
      // Direct probe with NO caller signal: must miss via the owned
      // disk-read bound instead of hanging forever.
      const start = Date.now()
      const miss = await persist.getPersistedMdbRaw("mdb:raw:v2:tt_stalled:a1b2c3d4")
      const elapsed = Date.now() - start
      expect(miss).toBeNull()
      expect(elapsed).toBeLessThan(5000)

      // Through the shared inflight: abort while the disk probe is stalled —
      // no upstream MDBList fetch may start on behalf of departed callers.
      const RICH = { ratings: [{ source: "metacritic", value: 85 }] }
      const fetchMock = mdblistFetch(() => okRatings(RICH))
      vi.stubGlobal("fetch", fetchMock)
      const ctrl = new AbortController()
      const p = ratings.fetchAggregatedRating("tt_stalled_ghost", "keyA", ctrl.signal, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 3000,
      })
      await new Promise((r) => setTimeout(r, 100))
      ctrl.abort()
      expect(await p).toBeNull()
      // Let any orphan settle: the stalled probe misses owned-side, and the
      // departed subscriber must not have triggered an upstream fetch.
      await new Promise((r) => setTimeout(r, 200))
      expect(mdblistCalls(fetchMock)).toBe(0)
    } finally {
      persist.__setMdbRawReadGateForTests(null)
    }
  })

  it("stalled best-effort cleanup still returns a bounded miss on every branch (oversized/corrupt/expired)", async () => {
    const { persist } = await freshModules()
    persist.__resetMdbRawPersistForTests()
    // Stall ONLY the read-path cleanup unlink (narrow existing facility —
    // no node:fs mock, no prune/read-gate refactor). Every branch below must
    // still miss within the owned bound instead of hanging on cleanup.
    const never = new Promise<void>(() => {})
    persist.__setMdbRawCleanupGateForTests(() => never)
    try {
      await fsp.mkdir(rawDir(), { recursive: true })

      // Oversized branch (>64KiB).
      const overKey = "mdb:raw:v2:tt_cleanup_over:a1b2c3d4"
      const overFile = persist.mdbRawPersistFilename(overKey)!
      await fsp.writeFile(path.join(rawDir(), overFile), "x".repeat(70 * 1024))
      let start = Date.now()
      expect(await persist.getPersistedMdbRaw(overKey)).toBeNull()
      expect(Date.now() - start).toBeLessThan(5000)

      // Corrupt branch (invalid JSON).
      const corruptKey = "mdb:raw:v2:tt_cleanup_corrupt:a1b2c3d4"
      const corruptFile = persist.mdbRawPersistFilename(corruptKey)!
      await fsp.writeFile(path.join(rawDir(), corruptFile), "{not valid json")
      start = Date.now()
      expect(await persist.getPersistedMdbRaw(corruptKey)).toBeNull()
      expect(Date.now() - start).toBeLessThan(5000)

      // Expired branch (valid envelope past the 24h absolute TTL).
      const expiredKey = "mdb:raw:v2:tt_cleanup_expired:a1b2c3d4"
      const expiredFile = persist.mdbRawPersistFilename(expiredKey)!
      await fsp.writeFile(
        path.join(rawDir(), expiredFile),
        JSON.stringify({ v: 1, key: expiredKey, d: { imdb: 7 }, t: Date.now() - 25 * 60 * 60 * 1000, ttl: DAY }),
      )
      start = Date.now()
      expect(await persist.getPersistedMdbRaw(expiredKey)).toBeNull()
      expect(Date.now() - start).toBeLessThan(5000)
    } finally {
      persist.__setMdbRawCleanupGateForTests(null)
    }
  })
})
