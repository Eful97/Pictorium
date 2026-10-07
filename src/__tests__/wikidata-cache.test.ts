import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Fake ioredis in-memory (strings with EX expiry, no network).
const fakeKv = vi.hoisted(() => ({
  strings: new Map<string, { value: string; expiresAt: number | null }>(),
  lastKey: "",
  lastEx: null as number | null,
  failGet: false,
  failSet: false,
}))

vi.mock("ioredis", () => {
  class FakeRedis {
    constructor(
      _url: string,
      _opts: unknown,
    ) {}
    async get(key: string): Promise<string | null> {
      if (fakeKv.failGet) throw new Error("kv down")
      const entry = fakeKv.strings.get(key)
      if (!entry) return null
      if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
        fakeKv.strings.delete(key)
        return null
      }
      return entry.value
    }
    async set(key: string, value: string, ...args: Array<string | number>): Promise<string> {
      if (fakeKv.failSet) throw new Error("kv down")
      let ex: number | null = null
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "EX" && typeof args[i + 1] === "number") ex = args[i + 1] as number
      }
      fakeKv.lastKey = key
      fakeKv.lastEx = ex
      fakeKv.strings.set(key, { value, expiresAt: ex !== null ? Date.now() + ex * 1000 : null })
      return "OK"
    }
    async quit(): Promise<string> {
      return "OK"
    }
  }
  return { default: FakeRedis }
})

import { closeKvClient } from "@/lib/kv"
import {
  WIKIDATA_PERSIST_FRESH_MS,
  WIKIDATA_PERSIST_KV_EX_SECONDS,
  WIKIDATA_PERSIST_MAX_FILES,
  WIKIDATA_PERSIST_STALE_MS,
  __resetWikidataPersistForTests,
  getPersistedWikidata,
  pruneWikidataPersisted,
  setPersistedWikidata,
  wikidataPersistFilename,
  type WikidataPersistInput,
} from "@/lib/wikidata-cache"

const DAY_MS = 24 * 60 * 60 * 1000

const SAMPLE_PAYLOAD = {
  awards: ["Oscar"],
  nominations: ["Golden Globe"],
  studios: ["HBO"],
  director: "Christopher Nolan",
}

const SAMPLE: WikidataPersistInput = {
  ...SAMPLE_PAYLOAD,
  degraded: false,
}

const EMPTY_OK: WikidataPersistInput = {
  awards: [],
  nominations: [],
  studios: [],
  director: null,
  degraded: false,
}

const tmpDirs: string[] = []

/** Scoped temp base for this suite only (other suites keep os.tmpdir()):
 *  prefer the approved workspace temp dir when present, platform default
 *  otherwise. */
function testTmpBase(): string {
  try {
    const scoped = path.join(os.tmpdir(), "opencode")
    if (fs.existsSync(scoped)) return scoped
  } catch {
    // fall through to the platform default
  }
  return os.tmpdir()
}

async function freshDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(testTmpBase(), "pictorium-wikidata-"))
  tmpDirs.push(dir)
  return dir
}

function stubFileMode(dir: string): void {
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("POSTERIUM_REDIS_URL", "")
  vi.stubEnv("REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
}

function stubKvMode(dir: string): void {
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  vi.stubEnv("PICTORIUM_REDIS_URL", "redis://localhost:6379")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
  fakeKv.strings.clear()
  fakeKv.lastKey = ""
  fakeKv.lastEx = null
  fakeKv.failGet = false
  fakeKv.failSet = false
}

function wikidataFile(dir: string, mediaType: "movie" | "tv", tmdbId: number): string {
  const name = wikidataPersistFilename(mediaType, tmdbId)
  if (!name) throw new Error("bad filename fixture")
  return path.join(dir, "wikidata", name)
}

async function plantFile(dir: string, mediaType: "movie" | "tv", tmdbId: number, fetchedAt: number): Promise<void> {
  const file = wikidataFile(dir, mediaType, tmdbId)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(
    file,
    JSON.stringify({ v: 1, tmdbId, mediaType, fetchedAt, payload: { ...SAMPLE_PAYLOAD } }),
  )
}

afterAll(async () => {
  await closeKvClient()
  vi.unstubAllEnvs()
  for (const dir of tmpDirs) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})

describe("wikidata-cache (file backend)", () => {
  beforeEach(async () => {
    stubFileMode(await freshDir())
    __resetWikidataPersistForTests()
  })

  it("round-trips a valid result as fresh with a preserved timestamp", async () => {
    expect(await setPersistedWikidata(101, "movie", SAMPLE)).toBe(true)
    const first = await getPersistedWikidata(101, "movie")
    expect(first?.status).toBe("fresh")
    expect(first?.payload).toEqual(SAMPLE_PAYLOAD)
    expect(typeof first?.fetchedAt).toBe("number")
    // Reads never reset retention: same absolute timestamp on re-read.
    const second = await getPersistedWikidata(101, "movie")
    expect(second?.fetchedAt).toBe(first?.fetchedAt)
    expect(second?.status).toBe("fresh")
  })

  it("persists a genuine empty (no awards anywhere is a real answer)", async () => {
    expect(await setPersistedWikidata(102, "movie", EMPTY_OK)).toBe(true)
    const got = await getPersistedWikidata(102, "movie")
    expect(got?.status).toBe("fresh")
    expect(got?.payload).toEqual({ awards: [], nominations: [], studios: [], director: null })
  })

  it("refuses degraded payloads and writes nothing", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    expect(await setPersistedWikidata(103, "movie", { ...SAMPLE, degraded: true } as unknown as WikidataPersistInput)).toBe(false)
    expect(await getPersistedWikidata(103, "movie")).toBeNull()
    await expect(fsp.stat(wikidataFile(dir, "movie", 103))).rejects.toThrow()
  })

  it("requires an explicit degraded:false flag (missing flag refused)", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const { degraded: _dropped, ...bare } = SAMPLE
    void _dropped
    expect(await setPersistedWikidata(111, "movie", bare as unknown as WikidataPersistInput)).toBe(false)
    expect(await getPersistedWikidata(111, "movie")).toBeNull()
    await expect(fsp.stat(wikidataFile(dir, "movie", 111))).rejects.toThrow()
  })

  it("rejects invalid coords without touching the filesystem", async () => {
    expect(wikidataPersistFilename("movie", 0)).toBeNull()
    expect(wikidataPersistFilename("movie", -5)).toBeNull()
    expect(wikidataPersistFilename("nope", 5)).toBeNull()
    expect(wikidataPersistFilename("movie", Number.NaN)).toBeNull()
    expect(await getPersistedWikidata(0, "movie")).toBeNull()
    expect(await setPersistedWikidata(-1, "movie", SAMPLE)).toBe(false)
    expect(await setPersistedWikidata(104, "tv", { ...SAMPLE, awards: [123 as unknown as string] })).toBe(false)
    expect(await getPersistedWikidata(999_999, "movie")).toBeNull()
  })

  it("treats corrupted files as a miss and removes them", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = wikidataFile(dir, "movie", 105)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, "{not json")
    expect(await getPersistedWikidata(105, "movie")).toBeNull()
    await expect(fsp.stat(file)).rejects.toThrow()
  })

  it("treats future-dated envelopes as a miss", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    await plantFile(dir, "movie", 106, Date.now() + 60 * 60 * 1000)
    expect(await getPersistedWikidata(106, "movie")).toBeNull()
  })

  it("serves 10-day records as stale and drops 31-day records", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const now = Date.now()
    expect(WIKIDATA_PERSIST_FRESH_MS).toBe(7 * DAY_MS)
    expect(WIKIDATA_PERSIST_STALE_MS).toBe(30 * DAY_MS)
    await plantFile(dir, "movie", 107, now - 10 * DAY_MS)
    const stale = await getPersistedWikidata(107, "movie")
    expect(stale?.status).toBe("stale")
    expect(stale?.payload.awards).toEqual(["Oscar"])
    await plantFile(dir, "movie", 108, now - 31 * DAY_MS)
    expect(await getPersistedWikidata(108, "movie")).toBeNull()
    // Expired single-file cleanup is best-effort on the miss path.
    await expect(fsp.stat(wikidataFile(dir, "movie", 108))).rejects.toThrow()
  })

  it("never touches the file on read (no retention reset)", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    await setPersistedWikidata(109, "tv", SAMPLE)
    const file = wikidataFile(dir, "tv", 109)
    const before = await fsp.stat(file)
    await getPersistedWikidata(109, "tv")
    await getPersistedWikidata(109, "tv")
    const after = await fsp.stat(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it("fail-opens when DATA_DIR is not writable", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const blocker = path.join(dir, "blocker")
    await fsp.writeFile(blocker, "x")
    vi.stubEnv("PICTORIUM_DATA_DIR", blocker)
    expect(await setPersistedWikidata(110, "movie", SAMPLE)).toBe(false)
    expect(await getPersistedWikidata(110, "movie")).toBeNull()
  })

  it("returns null for an aborted read without touching the record", async () => {
    expect(await setPersistedWikidata(112, "movie", SAMPLE)).toBe(true)
    const dir = process.env.PICTORIUM_DATA_DIR as string
    const file = wikidataFile(dir, "movie", 112)
    const before = await fsp.stat(file)
    const ctrl = new AbortController()
    ctrl.abort()
    expect(await getPersistedWikidata(112, "movie", ctrl.signal)).toBeNull()
    // No late write from the aborted read: same payload and timestamp.
    const after = await getPersistedWikidata(112, "movie")
    expect(after?.status).toBe("fresh")
    expect(after?.payload).toEqual(SAMPLE_PAYLOAD)
    expect((await fsp.stat(file)).mtimeMs).toBe(before.mtimeMs)
  })

  it("prunes expired + oldest-beyond-cap files only, never foreign files", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    expect(WIKIDATA_PERSIST_MAX_FILES).toBe(2000)
    await setPersistedWikidata(201, "movie", SAMPLE)
    await setPersistedWikidata(202, "movie", SAMPLE)
    // B older by mtime so the count cap deterministically keeps A.
    await fsp.utimes(wikidataFile(dir, "movie", 202), new Date(), new Date(Date.now() - 60 * 60 * 1000))
    // Expired by age and by mtime.
    await plantFile(dir, "movie", 203, Date.now() - 31 * DAY_MS)
    await fsp.utimes(wikidataFile(dir, "movie", 203), new Date(), new Date(Date.now() - 31 * DAY_MS))
    // Foreign files in the same subdir are never touched.
    await fsp.writeFile(path.join(dir, "wikidata", "mappings.json"), "{}")
    await fsp.writeFile(path.join(dir, "wikidata", "notes.txt"), "x")

    const first = await pruneWikidataPersisted({ maxFiles: 100 })
    expect(first).toEqual({ removed: 1, kept: 2 })
    await expect(fsp.stat(path.join(dir, "wikidata", "mappings.json"))).resolves.toBeDefined()

    const second = await pruneWikidataPersisted({ maxFiles: 1 })
    expect(second).toEqual({ removed: 1, kept: 1 })
    expect(await getPersistedWikidata(201, "movie")).not.toBeNull()
    expect(await getPersistedWikidata(202, "movie")).toBeNull()
  })

  it("last writer wins without throwing under concurrent sets", async () => {
    await setPersistedWikidata(204, "tv", SAMPLE)
    await setPersistedWikidata(204, "tv", EMPTY_OK)
    expect((await getPersistedWikidata(204, "tv"))?.payload).toEqual({
      awards: [],
      nominations: [],
      studios: [],
      director: null,
    })
    await Promise.all([
      setPersistedWikidata(204, "tv", SAMPLE),
      setPersistedWikidata(204, "tv", EMPTY_OK),
    ])
    expect(await getPersistedWikidata(204, "tv")).not.toBeNull()
  })
})

describe("wikidata-cache (KV backend)", () => {
  beforeEach(async () => {
    stubKvMode(await freshDir())
    __resetWikidataPersistForTests()
  })

  it("round-trips via KV with a bounded 30-day EX and never touches disk", async () => {
    const dir = process.env.PICTORIUM_DATA_DIR as string
    expect(WIKIDATA_PERSIST_KV_EX_SECONDS).toBe(30 * 24 * 60 * 60)
    expect(await setPersistedWikidata(901, "movie", SAMPLE)).toBe(true)
    expect(fakeKv.lastKey).toBe("pictorium:wikidata:v1:movie:901")
    expect(fakeKv.lastEx).toBe(WIKIDATA_PERSIST_KV_EX_SECONDS)
    const got = await getPersistedWikidata(901, "movie")
    expect(got?.status).toBe("fresh")
    expect(got?.payload).toEqual(SAMPLE_PAYLOAD)
    await expect(fsp.stat(path.join(dir, "wikidata"))).rejects.toThrow()
  })

  it("refuses degraded payloads in KV mode too", async () => {
    expect(await setPersistedWikidata(902, "movie", { ...SAMPLE, degraded: true } as unknown as WikidataPersistInput)).toBe(false)
    expect(
      await setPersistedWikidata(902, "movie", {
        awards: [],
        nominations: [],
        studios: [],
        director: null,
      } as unknown as WikidataPersistInput),
    ).toBe(false)
    expect(fakeKv.strings.size).toBe(0)
    expect(await getPersistedWikidata(902, "movie")).toBeNull()
  })

  it("fail-opens on KV outages without throwing", async () => {
    expect(await setPersistedWikidata(903, "movie", SAMPLE)).toBe(true)
    fakeKv.failGet = true
    expect(await getPersistedWikidata(903, "movie")).toBeNull()
    fakeKv.failGet = false
    fakeKv.failSet = true
    expect(await setPersistedWikidata(904, "movie", SAMPLE)).toBe(false)
  })

  it("returns null for an aborted read", async () => {
    expect(await setPersistedWikidata(909, "movie", SAMPLE)).toBe(true)
    const ctrl = new AbortController()
    ctrl.abort()
    expect(await getPersistedWikidata(909, "movie", ctrl.signal)).toBeNull()
    // Non-aborted read still works (the aborted one wrote nothing).
    expect((await getPersistedWikidata(909, "movie"))?.status).toBe("fresh")
  })

  it("bounds repeated failure warnings (no log flood on outage)", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      fakeKv.failGet = true
      for (let i = 0; i < 5; i++) {
        expect(await getPersistedWikidata(908, "movie")).toBeNull()
      }
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
    } finally {
      fakeKv.failGet = false
      spy.mockRestore()
    }
  })

  it("treats corrupted KV envelopes as a miss", async () => {
    fakeKv.strings.set("pictorium:wikidata:v1:movie:905", { value: "not-json{{{", expiresAt: null })
    expect(await getPersistedWikidata(905, "movie")).toBeNull()
  })

  it("enforces absolute 7d/30d age on KV records", async () => {
    const now = Date.now()
    fakeKv.strings.set(
      "pictorium:wikidata:v1:movie:906",
      {
        value: JSON.stringify({ v: 1, tmdbId: 906, mediaType: "movie", fetchedAt: now - 10 * DAY_MS, payload: { ...SAMPLE_PAYLOAD } }),
        expiresAt: now + DAY_MS,
      },
    )
    expect((await getPersistedWikidata(906, "movie"))?.status).toBe("stale")
    fakeKv.strings.set(
      "pictorium:wikidata:v1:tv:907",
      {
        value: JSON.stringify({ v: 1, tmdbId: 907, mediaType: "tv", fetchedAt: now - 31 * DAY_MS, payload: { ...SAMPLE_PAYLOAD } }),
        expiresAt: now + DAY_MS,
      },
    )
    expect(await getPersistedWikidata(907, "tv")).toBeNull()
  })
})
