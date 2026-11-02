import { createHash } from "node:crypto"
import fsp from "node:fs/promises"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock di @/lib/upstash-kv-client (usato SOLO dal test in KV mode; in file mode nessun
// ramo tocca mai il client — stesso pattern hoisted di
// ratings-mdblist-raw-kv.test.ts, fasi strettamente seriali).
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

// TASK3: bounded LOCAL MDBList raw ratings persistence (VPS file-storage
// mode). La KV L2 esistente resta il path ElfHosted; qui il file-mode deve
// sopravvivere al restart via DATA_DIR con helper dedicato, scadenza
// assoluta mai rinnovata, mai plaintext, fail-open ovunque, pruning bounded,
// zero I/O disco in KV mode.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const RICH = {
  ratings: [
    { source: "metacritic", value: 85, score: 85 },
    { source: "trakt", value: 83, score: 83 },
  ],
}
const NO_TIMING = { ratings: [{ source: "imdb", value: 72, score: 72 }] }
const OLD_MOVIE = { type: "movie", released: "2015-06-01", ratings: [{ source: "imdb", value: 87, score: 87 }] }

function okRatings(body: unknown) {
  return { ok: true, json: async () => body }
}

function notFound() {
  return { ok: false, status: 404, headers: { get: () => null } }
}

function mdblistFetch(handler: (url: string) => unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    // Qualunque uso del client KV reale fallisce forte: in file mode non
    // deve mai esistere, in KV mode il mock lo intercetta prima.
    if (url.includes("upstash.io")) throw new Error(`real KV client leaked: ${url}`)
    if (url.includes("mdblist.com")) return handler(url) as Response
    // Sidecar gratuito del ramo familyDirectOnly (imdb-only): sempre miss.
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

/** Isola il layer durevole: DATA_DIR temporaneo per test + file mode (stesse
 *  chiavi di awards-rest-fastpath.test.ts). */
async function stubFileMode(): Promise<void> {
  const dir = await fsp.mkdtemp(path.join(approvedBase(), "pictorium-mdblist-raw-"))
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

/** Flush dei write fire-and-forget fino a N file posseduti su disco. */
async function flushOwnedFiles(n: number): Promise<void> {
  for (let i = 0; i < 300 && (await listOwnedFiles()).length < n; i += 1) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function readEnvelopes(): Promise<Array<{ file: string; json: Record<string, unknown> }>> {
  const out: Array<{ file: string; json: Record<string, unknown> }> = []
  for (const file of await listOwnedFiles()) {
    const json = JSON.parse(await fsp.readFile(path.join(rawDir(), file), "utf-8")) as Record<string, unknown>
    out.push({ file, json })
  }
  return out
}

function keyHash(key: string): string {
  return createHash("sha1").update(key).digest("hex").slice(0, 8)
}

async function freshModules() {
  vi.resetModules()
  const ratings = await import("@/lib/ratings")
  const persist = await import("@/lib/mdblist-raw-cache")
  return { ratings, persist }
}

async function flushKvRawSets(n: number): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    const count = [...kvBacking.keys()].filter((k) => k.startsWith("pictorium:cache:mdb:raw:")).length
    if (count >= n) return
    await new Promise((r) => setTimeout(r, 5))
  }
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

describe("MDBList raw LOCAL persistence (task 3, file mode)", () => {
  it("restart hit: la grezza su disco serve dopo il restart senza refetch", async () => {
    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)

    const first = await ratings.fetchAggregatedRating("tt_local_restart", "keyA", undefined, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 2000,
    })
    expect(first?.sources.metacritic).toBe(8.5)
    await flushOwnedFiles(1)
    expect(await listOwnedFiles()).toHaveLength(1)

    // Restart: moduli freschi (L1 vuota), stesso DATA_DIR; l'upstream ora
    // fallisce forte — ogni refetch esploderebbe.
    const { ratings: fresh } = await freshModules()
    fresh.__resetMdblistBreaker()
    const failing = mdblistFetch(() => {
      throw new Error("must not refetch after restart")
    })
    vi.stubGlobal("fetch", failing)
    const second = await fresh.fetchAggregatedRating("tt_local_restart", "keyA", undefined, {
      requestedSources: ["trakt"],
      ratingWaitMs: 2000,
    })
    expect(second?.sources.trakt).toBe(8.3)
    expect(mdblistCalls(failing)).toBe(0)
  })

  it("scadenza assoluta: hit dentro il TTL senza rinnovo, miss oltre con refetch", async () => {
    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch(() => okRatings(NO_TIMING))
    vi.stubGlobal("fetch", fetchMock)

    expect(
      (await ratings.fetchAggregatedRating("tt_local_exp", "keyA", undefined, {
        requestedSources: ["imdb"],
        ratingWaitMs: 2000,
      }))?.sources.imdb,
    ).toBe(7.2)
    await flushOwnedFiles(1)
    const [entry] = await readEnvelopes()
    expect(entry.json.ttl).toBe(DAY)
    const t0 = entry.json.t as number

    // Hit dentro il TTL: zero upstream e `t` invariato (mai sliding).
    const { ratings: hit } = await freshModules()
    hit.__resetMdblistBreaker()
    const hitFetch = mdblistFetch(() => okRatings(NO_TIMING))
    vi.stubGlobal("fetch", hitFetch)
    expect(
      (await hit.fetchAggregatedRating("tt_local_exp", "keyA", undefined, {
        requestedSources: ["imdb"],
        ratingWaitMs: 2000,
      }))?.sources.imdb,
    ).toBe(7.2)
    expect(mdblistCalls(hitFetch)).toBe(0)
    const [still] = await readEnvelopes()
    expect(still.json.t).toBe(t0)

    // Envelope invecchiato oltre i 24h originali: miss + refetch.
    const full = path.join(rawDir(), entry.file)
    const parsed = JSON.parse(await fsp.readFile(full, "utf-8")) as Record<string, unknown>
    await fsp.writeFile(full, JSON.stringify({ ...parsed, t: Date.now() - 25 * HOUR }))
    const { ratings: expired } = await freshModules()
    expired.__resetMdblistBreaker()
    const refetch = mdblistFetch(() => okRatings(NO_TIMING))
    vi.stubGlobal("fetch", refetch)
    expect(
      (await expired.fetchAggregatedRating("tt_local_exp", "keyA", undefined, {
        requestedSources: ["imdb"],
        ratingWaitMs: 2000,
      }))?.sources.imdb,
    ).toBe(7.2)
    expect(mdblistCalls(refetch)).toBe(1)
  })

  it("TTL scelto persistito (7d film vecchi, 24h default), identità hashata, mai plaintext", async () => {
    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const API_KEY = "secret-local-key-456"
    const fetchMock = mdblistFetch((url) => {
      if (url.includes("tt_old")) return okRatings(OLD_MOVIE)
      return okRatings(NO_TIMING)
    })
    vi.stubGlobal("fetch", fetchMock)

    expect(
      (await ratings.fetchAggregatedRating("tt_old", API_KEY, undefined, {
        requestedSources: ["imdb"],
        ratingWaitMs: 2000,
      }))?.sources.imdb,
    ).toBe(8.7)
    expect(
      (await ratings.fetchAggregatedRating("tt_new", API_KEY, undefined, {
        requestedSources: ["imdb"],
        ratingWaitMs: 2000,
      }))?.sources.imdb,
    ).toBe(7.2)
    await flushOwnedFiles(2)

    const envelopes = await readEnvelopes()
    expect(envelopes).toHaveLength(2)
    const kh = keyHash(API_KEY)
    const oldEnv = envelopes.find((e) => String((e.json as { key: string }).key).includes("tt_old"))!.json
    const newEnv = envelopes.find((e) => String((e.json as { key: string }).key).includes("tt_new"))!.json
    // Envelope: dati in `d`, timestamp+TTL originali, chiave hashata.
    expect(oldEnv.d).toEqual({ imdb: 8.7 })
    expect(oldEnv.ttl).toBe(7 * DAY)
    expect(newEnv.d).toEqual({ imdb: 7.2 })
    expect(newEnv.ttl).toBe(DAY)
    for (const { file, json } of envelopes) {
      expect(String((json as { key: string }).key)).toContain(kh)
      expect(JSON.stringify(json)).not.toContain(API_KEY)
      // Filename: solo hash dell'identità completa, mai plaintext.
      expect(file).toMatch(OWNED_RE)
      expect(file).not.toContain(API_KEY)
      expect(file).not.toContain("tt_")
    }
  })

  it("isolamento per chiave: stessa imdb con chiavi diverse non condivide, hit solo con la propria", async () => {
    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)

    await ratings.fetchAggregatedRating("tt_local_iso", "keyA", undefined, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 2000,
    })
    await ratings.fetchAggregatedRating("tt_local_iso", "keyB", undefined, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 2000,
    })
    expect(mdblistCalls(fetchMock)).toBe(2)
    await flushOwnedFiles(2)
    expect(await listOwnedFiles()).toHaveLength(2)
    // Mai plaintext su disco (sorgenti + envelope di entrambi i file).
    let all = ""
    for (const file of await listOwnedFiles()) all += await fsp.readFile(path.join(rawDir(), file), "utf-8")
    expect(all).not.toContain("keyA")
    expect(all).not.toContain("keyB")

    // Restart: keyA fa hit, keyC (mai vista) rifetcha.
    const { ratings: fresh } = await freshModules()
    fresh.__resetMdblistBreaker()
    const phase2 = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", phase2)
    expect(
      (await fresh.fetchAggregatedRating("tt_local_iso", "keyA", undefined, {
        requestedSources: ["trakt"],
        ratingWaitMs: 2000,
      }))?.sources.trakt,
    ).toBe(8.3)
    expect(mdblistCalls(phase2)).toBe(0)
    await fresh.fetchAggregatedRating("tt_local_iso", "keyC", undefined, {
      requestedSources: ["trakt"],
      ratingWaitMs: 2000,
    })
    expect(mdblistCalls(phase2)).toBe(1)
  })

  it("solo positivi persistono; corrotti/oversized fail-open con refetch", async () => {
    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch((url) => {
      if (url.includes("tt_miss")) return notFound()
      if (url.includes("tt_err")) return { ok: false, status: 503, headers: { get: () => null } }
      return okRatings(RICH)
    })
    vi.stubGlobal("fetch", fetchMock)

    // Miss genuini ed errori non raggiungono mai il disco.
    expect(
      await ratings.fetchAggregatedRating("tt_miss", "keyA", undefined, {
        requestedSources: ["imdb"],
        ratingWaitMs: 2000,
      }),
    ).toBeNull()
    expect(
      await ratings.fetchAggregatedRating("tt_err", "keyA", undefined, {
        requestedSources: ["imdb"],
        ratingWaitMs: 2000,
      }),
    ).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(await listOwnedFiles()).toHaveLength(0)

    // Positivo: scritto.
    expect(
      (await ratings.fetchAggregatedRating("tt_ok", "keyA", undefined, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 2000,
      }))?.sources.metacritic,
    ).toBe(8.5)
    await flushOwnedFiles(1)
    const [entry] = await listOwnedFiles()
    const full = path.join(rawDir(), entry)

    // File corrotto: miss + refetch, nessuna eccezione.
    await fsp.writeFile(full, "{not valid json")
    const { ratings: c1 } = await freshModules()
    c1.__resetMdblistBreaker()
    const refetch1 = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", refetch1)
    expect(
      (await c1.fetchAggregatedRating("tt_ok", "keyA", undefined, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 2000,
      }))?.sources.metacritic,
    ).toBe(8.5)
    expect(mdblistCalls(refetch1)).toBe(1)
    await flushOwnedFiles(1)

    // File oversized (>64KiB): miss + refetch, nessuna eccezione.
    await fsp.writeFile(full, "x".repeat(70 * 1024))
    const { ratings: c2 } = await freshModules()
    c2.__resetMdblistBreaker()
    const refetch2 = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", refetch2)
    expect(
      (await c2.fetchAggregatedRating("tt_ok", "keyA", undefined, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 2000,
      }))?.sources.metacritic,
    ).toBe(8.5)
    expect(mdblistCalls(refetch2)).toBe(1)
  })

  it("storage non scrivibile fail-open: l'upstream resta servito, niente throw", async () => {
    const blocker = path.join(dataDir, "blocker")
    await fsp.writeFile(blocker, "x")
    vi.stubEnv("PICTORIUM_DATA_DIR", blocker)
    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)

    const result = await ratings.fetchAggregatedRating("tt_local_ro", "keyA", undefined, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 2000,
    })
    expect(result?.sources.metacritic).toBe(8.5)
    expect(mdblistCalls(fetchMock)).toBe(1)
  })

  it("risultati abbandonati non scrivono mai: zero subscriber, nessuna traccia su disco", async () => {
    const POISON = { ratings: [{ source: "metacritic", value: 11, score: 11 }, { source: "trakt", value: 22, score: 22 }] }
    const FRESH = { ratings: [{ source: "metacritic", value: 99, score: 99 }, { source: "trakt", value: 83, score: 83 }] }
    let releaseOld!: () => void
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve
    })
    let calls = 0
    const fetchMock = mdblistFetch(() => {
      calls += 1
      if (calls === 1) return oldGate.then(() => okRatings(POISON))
      return okRatings(FRESH)
    })
    vi.stubGlobal("fetch", fetchMock)

    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const ctrl = new AbortController()
    const p1 = ratings.fetchAggregatedRating("tt_local_abandoned", "keyA", ctrl.signal, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 3000,
    })
    for (let i = 0; i < 200 && mdblistCalls(fetchMock) === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(mdblistCalls(fetchMock)).toBe(1)
    ctrl.abort()
    expect(await p1).toBeNull()
    // L'upstream orfano completa tardi con dati stantii: non deve scrivere.
    releaseOld()
    await new Promise((r) => setTimeout(r, 100))
    expect(await listOwnedFiles()).toHaveLength(0)

    // Retry fresco: rifetcha (niente cache avvelenata) e persiste il FRESH.
    const r2 = await ratings.fetchAggregatedRating("tt_local_abandoned", "keyA", undefined, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 3000,
    })
    expect(r2?.sources.metacritic).toBe(9.9)
    expect(mdblistCalls(fetchMock)).toBe(2)
    await flushOwnedFiles(1)
    const [entry] = await readEnvelopes()
    expect(entry.json.d).toEqual({ metacritic: 9.9, trakt: 8.3 })
  })

  it("prune bounded: scadenze + cap voci/byte, solo file posseduti", async () => {
    const { persist } = await freshModules()
    expect(persist.MDB_RAW_PERSIST_MAX_FILES).toBe(2000)
    expect(persist.MDB_RAW_PERSIST_MAX_BYTES).toBe(16 * 1024 * 1024)

    for (let i = 0; i < 30; i += 1) {
      const ok = await persist.setPersistedMdbRaw(`mdb:raw:v2:tt_prune_${i}:a1b2c3d4`, { imdb: 7 }, DAY)
      expect(ok).toBe(true)
    }
    expect(await listOwnedFiles()).toHaveLength(30)
    // File estranei alla sottodirectory posseduta: mai toccati.
    await fsp.writeFile(path.join(rawDir(), "notes.txt"), "foreign")
    await fsp.writeFile(path.join(rawDir(), "mdblist-raw-v1-short.json"), "{}")
    // Un file con mtime oltre il TTL massimo: scaduto senza bisogno di parse.
    const [victim] = await listOwnedFiles()
    const old = new Date(Date.now() - 8 * DAY)
    await fsp.utimes(path.join(rawDir(), victim), old, old)

    const res = await persist.pruneMdbRawPersisted({ maxFiles: 10 })
    expect(res.removed).toBe(20)
    expect(res.kept).toBe(10)
    expect(existsSync(path.join(rawDir(), "notes.txt"))).toBe(true)
    expect(existsSync(path.join(rawDir(), "mdblist-raw-v1-short.json"))).toBe(true)

    // Cap byte: il totale rientra nel budget.
    const res2 = await persist.pruneMdbRawPersisted({ maxBytes: 500 })
    expect(res2.kept).toBeLessThan(10)
    let total = 0
    for (const file of await listOwnedFiles()) {
      total += (await fsp.stat(path.join(rawDir(), file))).size
    }
    expect(total).toBeLessThanOrEqual(500)
  })

  it("filename: hash deterministico dell'identità completa, traversal-safe", async () => {
    const { persist } = await freshModules()
    const a = persist.mdbRawPersistFilename("mdb:raw:v2:tt_x:abcd1234")
    const b = persist.mdbRawPersistFilename("mdb:raw:v2:tt_x:abcd1234")
    const c = persist.mdbRawPersistFilename("mdb:raw:v2:tt_x:eeee5678")
    expect(a).toMatch(OWNED_RE)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    for (const bad of ["", "mdb:raw:v2:a/b", "mdb:raw:v2:a\\b", "../x", "/abs", "other:raw:v2:tt:kk"]) {
      expect(persist.mdbRawPersistFilename(bad)).toBeNull()
    }
    // Helper rifiuta input invalidi senza I/O né throw.
    expect(await persist.getPersistedMdbRaw("../x")).toBeNull()
    expect(await persist.setPersistedMdbRaw("", { imdb: 7 }, DAY)).toBe(false)
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt:kk", {}, DAY)).toBe(false)
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt:kk", { imdb: 7 }, 1000)).toBe(false)
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt:kk", { imdb: 7 }, 30 * DAY)).toBe(false)
    expect(await persist.pruneMdbRawPersisted()).toEqual({ removed: 0, kept: 0 })
  })

  it("DATA_DIR non configurato: nessun file nel default ./data, comportamento invariato", async () => {
    vi.unstubAllEnvs()
    vi.stubEnv("PICTORIUM_REDIS_URL", "")
    vi.stubEnv("POSTERIUM_REDIS_URL", "")
    vi.stubEnv("REDIS_URL", "")
    vi.stubEnv("KV_REST_API_URL", "")
    vi.stubEnv("KV_REST_API_TOKEN", "")
    const { ratings, persist } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)

    // Il flusso resta identico (un upstream, dati serviti)…
    const result = await ratings.fetchAggregatedRating("tt_local_unconfigured", "keyA", undefined, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 2000,
    })
    expect(result?.sources.metacritic).toBe(8.5)
    expect(mdblistCalls(fetchMock)).toBe(1)
    await new Promise((r) => setTimeout(r, 50))
    // …ma helper e prune sono no-op senza I/O: niente file nel checkout.
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt:kk", { imdb: 7 }, DAY)).toBe(false)
    expect(await persist.getPersistedMdbRaw("mdb:raw:v2:tt:kk")).toBeNull()
    expect(await persist.pruneMdbRawPersisted()).toEqual({ removed: 0, kept: 0 })
    expect(existsSync(path.join(process.cwd(), "data", "mdblist-raw"))).toBe(false)
  })
})

describe("MDBList raw KV mode (task 3): disco mai toccato, path esistente invariato", () => {  it("in KV mode nessuna lettura/scrittura locale: solo la L2 KV esistente", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io")
    vi.stubEnv("KV_REST_API_TOKEN", "test-token")
    const { ratings } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)

    const result = await ratings.fetchAggregatedRating("tt_kvlocal", "keyA", undefined, {
      requestedSources: ["metacritic"],
      ratingWaitMs: 2000,
    })
    expect(result?.sources.metacritic).toBe(8.5)
    expect(mdblistCalls(fetchMock)).toBe(1)
    await flushKvRawSets(1)

    // Path KV esistente invariato: envelope grezza in KV…
    const rawKeys = [...kvBacking.keys()].filter((k) => k.startsWith("pictorium:cache:mdb:raw:"))
    expect(rawKeys).toHaveLength(1)
    expect(JSON.parse(kvBacking.get(rawKeys[0])!).ttl).toBe(DAY)
    // …e zero file locali (la sottodirectory non viene nemmeno creata).
    expect(existsSync(rawDir())).toBe(false)

    // Anche helper e prune sono no-op in KV mode.
    const { persist } = await freshModules()
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt:kk", { imdb: 7 }, DAY)).toBe(false)
    expect(await persist.getPersistedMdbRaw("mdb:raw:v2:tt:kk")).toBeNull()
    expect(await persist.pruneMdbRawPersisted()).toEqual({ removed: 0, kept: 0 })
    expect(existsSync(rawDir())).toBe(false)
  })
})

describe("MDBList raw LOCAL bounded retention (correction cycle 1)", () => {
  it("il flusso reale di scrittura converge sotto i cap: centinaia di identità distinte restano bounded", async () => {
    const { persist } = await freshModules()
    // Policy di test: cap piccoli così il VERO setPersistedMdbRaw (mai una
    // prune esplicita con limiti ad hoc) deve convergere da solo.
    persist.__resetMdbRawPersistForTests()
    persist.__setMdbRawPersistPolicyForTests({ maxFiles: 20, maxBytes: 4096 })
    // Sincronizzazione deterministica (stessi hook del test di backpressure,
    // mai sleep fissi né mock del fs): il primo write dopo l'import avvia la
    // prune idle (lastPruneAt = 0) e ogni 32 write scatta la prune di cadenza.
    // Sotto prune lenta la finestra coprirebbe >8 write successivi e il drop
    // fail-open intenzionale fallirebbe gli expect(ok). Il warmup drena la
    // idle prima dello stream misurato; il flush dopo ogni write chiude ogni
    // finestra di cadenza prima che la successiva superi la reservation (8).
    // Restano 120 write reali distinti con expect(ok) intatto e convergenza
    // ai cap via flusso reale. Questa è retention a ritmo sostenibile, NON
    // overload: centinaia di tentativi DURANTE un'unica prune tenuta aperta
    // restano coperti dal test di backpressure (drop fail-open intenzionale).
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt_cap_0:a1b2c3d4", { imdb: 7 }, DAY)).toBe(true)
    await persist.__flushMdbRawPersistPrune()
    for (let i = 1; i < 120; i += 1) {
      const ok = await persist.setPersistedMdbRaw(`mdb:raw:v2:tt_cap_${i}:a1b2c3d4`, { imdb: 7 }, DAY)
      expect(ok).toBe(true)
      await persist.__flushMdbRawPersistPrune()
    }
    // La prune di cadenza gira ogni 32 scritture e lascia una coda
    // bounded: altre scritture (overwrite della stessa identità, quindi
    // zero nuovi file) guidano un'ultima prune di convergenza — sempre
    // tramite il flusso reale, mai con prune() esplicita.
    for (let i = 0; i < 40; i += 1) {
      await persist.setPersistedMdbRaw("mdb:raw:v2:tt_cap_0:a1b2c3d4", { imdb: 7 }, DAY)
    }
    let files: string[] = []
    for (let i = 0; i < 200; i += 1) {
      await persist.__flushMdbRawPersistPrune()
      files = await listOwnedFiles()
      if (files.length <= 20) break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(files.length).toBeLessThanOrEqual(20)
    let total = 0
    for (const file of files) total += (await fsp.stat(path.join(rawDir(), file))).size
    expect(total).toBeLessThanOrEqual(4096)
  })

  it("burst concorrenti: concorrenza bounded, drop fail-open senza throw, nessun leak di in-flight", async () => {
    const { persist } = await freshModules()
    persist.__setMdbRawPersistPolicyForTests({ maxFiles: 50, maxBytes: 1024 * 1024, maxConcurrentWrites: 3 })
    const pending = Array.from({ length: 60 }, (_, i) =>
      persist.setPersistedMdbRaw(`mdb:raw:v2:tt_burst_${i}:a1b2c3d4`, { imdb: 7 }, DAY),
    )
    const settled = await Promise.allSettled(pending)
    // Mai un throw: ogni scrittura si risolve con boolean (true = scritta,
    // false = scartata fail-open a saturazione).
    expect(settled.every((s) => s.status === "fulfilled")).toBe(true)
    const values = settled.map((s) => (s as PromiseFulfilledResult<boolean>).value)
    expect(values.filter(Boolean).length).toBeLessThanOrEqual(3)
    expect(values.filter((v) => !v).length).toBeGreaterThan(0)
    const stats = persist.__getMdbRawPersistStatsForTests()
    expect(stats.maxActiveWrites).toBeLessThanOrEqual(3)
    for (let i = 0; i < 200; i += 1) {
      await persist.__flushMdbRawPersistPrune()
      if (persist.__getMdbRawPersistStatsForTests().activeWrites === 0) break
      await new Promise((r) => setTimeout(r, 5))
    }
    expect(persist.__getMdbRawPersistStatsForTests().activeWrites).toBe(0)
    expect((await listOwnedFiles()).length).toBeLessThanOrEqual(50)
  })

  it("letture ripetute non rinnovano mai il TTL (t e mtime invariati, residuo non crescente)", async () => {
    const { persist } = await freshModules()
    expect(await persist.setPersistedMdbRaw("mdb:raw:v2:tt_norenew:a1b2c3d4", { imdb: 7 }, DAY)).toBe(true)
    const [file] = await listOwnedFiles()
    const full = path.join(rawDir(), file)
    const before = (await fsp.stat(full)).mtimeMs
    const t0 = (JSON.parse(await fsp.readFile(full, "utf-8")) as { t: number }).t
    const first = await persist.getPersistedMdbRaw("mdb:raw:v2:tt_norenew:a1b2c3d4")
    expect(first?.sources).toEqual({ imdb: 7 })
    await new Promise((r) => setTimeout(r, 10))
    const second = await persist.getPersistedMdbRaw("mdb:raw:v2:tt_norenew:a1b2c3d4")
    expect(second?.sources).toEqual({ imdb: 7 })
    expect(second!.remainingTtlMs).toBeLessThanOrEqual(first!.remainingTtlMs)
    expect((JSON.parse(await fsp.readFile(full, "utf-8")) as { t: number }).t).toBe(t0)
    expect((await fsp.stat(full)).mtimeMs).toBe(before)
  })

  it("il read path non usa chiamate filesystem sincrone (nessun blocco del loop poster)", async () => {
    // Guardia white-box del contratto async: il modulo non deve contenere
    // alcuna CHIAMATA Sync di node:fs sul read path (statSync/readFileSync/
    // unlinkSync bloccherebbero l'event loop del poster per ogni miss). I
    // commenti vengono esclusi: le doc menzionano i nomi Sync solo per
    // vietarli, le chiamate reali sono `*Sync(` nel codice.
    const source = await fsp.readFile("src/lib/mdblist-raw-cache.ts", "utf-8")
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")
    expect(code).not.toMatch(/\wSync\s*\(/)
    expect(code).not.toMatch(/from\s+["']node:fs["']/)
  })

  it("lettura disco lenta + subscriber cancellato: mai upstream per conto dei cancellati, retry fresco", async () => {
    const { ratings, persist } = await freshModules()
    ratings.__resetMdblistBreaker()
    const fetchMock = mdblistFetch(() => okRatings(RICH))
    vi.stubGlobal("fetch", fetchMock)
    let releaseRead!: (value: null) => void
    const gate = new Promise<null>((resolve) => {
      releaseRead = resolve
    })
    const spy = vi
      .spyOn(persist, "getPersistedMdbRaw")
      .mockImplementation((async () => gate) as unknown as typeof persist.getPersistedMdbRaw)
    const ctrl = new AbortController()
    try {
      const p = ratings.fetchAggregatedRating("tt_slow_read", "keyA", ctrl.signal, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 3000,
      })
      // Sincronizza sull'avvio OSSERVATO della probe disco (mai sleep fissi):
      // solo dopo che l'operazione posseduta è entrata in idratazione
      // l'abort esercita il path "lettura lenta, zero subscriber".
      for (let i = 0; i < 200 && spy.mock.calls.length === 0; i += 1) {
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(spy).toHaveBeenCalledTimes(1)
      ctrl.abort()
      expect(await p).toBeNull()
      // Miss tardiva dopo che ogni subscriber ha lasciato: nessun upstream
      // MDB avviato per conto dei cancellati.
      releaseRead(null)
      await new Promise((r) => setTimeout(r, 100))
      expect(mdblistCalls(fetchMock)).toBe(0)
      // Retry fresco: upstream reale e successo (niente stato avvelenato).
      const retried = await ratings.fetchAggregatedRating("tt_slow_read", "keyA", undefined, {
        requestedSources: ["metacritic"],
        ratingWaitMs: 3000,
      })
      expect(retried?.sources.metacritic).toBe(8.5)
      expect(mdblistCalls(fetchMock)).toBe(1)
    } finally {
      releaseRead(null)
      spy.mockRestore()
    }
  })
})
