import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Mapping } from "@/lib/types"
import type { ImdbAlias } from "@/lib/store"

// Task4/point4 regression: the file persists (global + per-user, mappings +
// aliases) write compact JSON (no pretty indentation). Readers use JSON.parse
// (format-agnostic, proven by the round-trips below).

// Network guard: even a programming error that reaches the KV backend must
// fail loudly instead of hitting real Redis/Upstash from a configured runner.
vi.mock("@vercel/kv", () => {
  const fail = async (): Promise<never> => {
    throw new Error("compact-persistence test must not reach the KV network backend")
  }
  return {
    kv: {
      get: fail,
      set: fail,
      del: fail,
      hgetall: fail,
      hset: fail,
      hdel: fail,
      incr: fail,
      expire: fail,
      scan: fail,
      sadd: fail,
      srem: fail,
      smembers: fail,
      zadd: fail,
      zrem: fail,
      zincrby: fail,
      zrange: fail,
      zscore: fail,
      eval: fail,
    },
  }
})

const UUID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
const STALE_UPDATED_AT = "2020-01-01T00:00:00.000Z"

// Portable scratch root: os.tmpdir() resolves to the approved temp root on
// this host and to a valid temp dir on any other OS/user.
const SCRATCH_ROOT = path.join(os.tmpdir(), "opencode")
const tempDirs: string[] = []

async function freshStore() {
  await fsp.mkdir(SCRATCH_ROOT, { recursive: true })
  const dir = await fsp.mkdtemp(path.join(SCRATCH_ROOT, "pictorium-compact-"))
  tempDirs.push(dir)
  // Canonical data dir first (PICTORIUM_* wins over POSTERIUM_* in
  // envWithFallback): pin both to the same temp dir so the legacy value can
  // never shadow the canonical one.
  vi.stubEnv("PICTORIUM_DATA_DIR", dir)
  vi.stubEnv("POSTERIUM_DATA_DIR", dir)
  // Blank every KV backend selector read by src/lib/kv.ts (resolveRedisUrl:
  // PICTORIUM/POSTERIUM/REDIS_URL; isKvConfigured: KV_REST_API_URL/TOKEN) so
  // getStorageMode() is "file" even when the runner env carries real
  // credentials. "" trims to unset for Redis and is falsy for KV.
  vi.stubEnv("PICTORIUM_REDIS_URL", "")
  vi.stubEnv("POSTERIUM_REDIS_URL", "")
  vi.stubEnv("REDIS_URL", "")
  vi.stubEnv("KV_REST_API_URL", "")
  vi.stubEnv("KV_REST_API_TOKEN", "")
  vi.resetModules()
  const store = await import("@/lib/store")
  // Prove isolation on every test: file backend, no live data or network.
  expect(store.getStorageMode()).toBe("file")
  return { store, dir }
}

afterEach(async () => {
  // unstubAllEnvs restores every stubbed var to its pre-test value (never a
  // bare delete that would drop a caller-provided credential).
  vi.unstubAllEnvs()
  vi.resetModules()
  const dirs = tempDirs.splice(0)
  await Promise.all(dirs.map((d) => fsp.rm(d, { recursive: true, force: true })))
})

function mapping(id: number, title: string, extra: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: id,
    mediaType: "movie",
    title,
    posterPath: `/p${id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    updatedAt: STALE_UPDATED_AT,
    ...extra,
  }
}

function expectRecentStamp(stamp: string | undefined): void {
  expect(typeof stamp).toBe("string")
  expect(stamp).not.toBe(STALE_UPDATED_AT)
  expect(new Date(stamp as string).getTime()).toBeGreaterThan(Date.now() - 60_000)
}

async function expectCompactFile(file: string): Promise<string> {
  const raw = await fsp.readFile(file, "utf-8")
  // JSON escapes embedded newlines as the two-char sequence \n, so a literal
  // 0x0A byte in the file can only come from pretty indentation.
  expect(raw).not.toContain("\n")
  expect(raw).toBe(JSON.stringify(JSON.parse(raw)))
  return raw
}

describe("store compact persistence (task4/point4)", () => {
  it("global mappings persist as compact JSON with unicode, sparse fields, embedded newline, and fresh updatedAt", async () => {
    const { store, dir } = await freshStore()
    await store.upsert(
      mapping(1, "Unicode title \u{1F3AC} \u00E0\u00E8\u00E9\u00FC \u65E5\u672C\u8A9E\nsecond line", {
        genreName: "Dramma",
        voteAverage: 7.3,
      }),
    )
    // Sparse: only some optionals set; the rest must stay absent, never
    // serialized as spurious nulls.
    await store.upsert(mapping(2, "Sparse", { backdropPath: "/b2.jpg" }))

    const raw = await expectCompactFile(path.join(dir, "mappings.json"))
    expect(raw).toContain("\u{1F3AC}")
    expect(raw).toContain("\u65E5\u672C\u8A9E")
    // Embedded newline is escaped (two chars), never a literal line break.
    expect(raw).toContain("\\n")
    const parsed = JSON.parse(raw) as Record<string, Mapping>
    expect(Object.keys(parsed).sort()).toEqual(["movie:1", "movie:2"])
    expect(parsed["movie:1"].title).toBe("Unicode title \u{1F3AC} \u00E0\u00E8\u00E9\u00FC \u65E5\u672C\u8A9E\nsecond line")
    expect(parsed["movie:1"].genreName).toBe("Dramma")
    expect(parsed["movie:1"].voteAverage).toBe(7.3)
    expect("customPosterUrl" in parsed["movie:2"]).toBe(false)
    expect(parsed["movie:2"].backdropPath).toBe("/b2.jpg")
    // updatedAt is stamped on every upsert, never skipped by compaction.
    expectRecentStamp(parsed["movie:1"].updatedAt)
    expectRecentStamp(parsed["movie:2"].updatedAt)

    const all = await store.getAll()
    expect(all).toHaveLength(2)
  })

  it("user mappings persist as compact JSON in the namespace with fresh updatedAt", async () => {
    const { store, dir } = await freshStore()
    await store.upsert(mapping(9, "User unicode \u00E8 \u{1F37F}\nsecond line", { genreName: "Commedia" }), UUID_A)
    const raw = await expectCompactFile(path.join(dir, "users", UUID_A, "mappings.json"))
    expect(raw).toContain("\u{1F37F}")
    expect(raw).toContain("\\n")
    const parsed = JSON.parse(raw) as Record<string, Mapping>
    expect(parsed["movie:9"].title).toBe("User unicode \u00E8 \u{1F37F}\nsecond line")
    expect(parsed["movie:9"].genreName).toBe("Commedia")
    expectRecentStamp(parsed["movie:9"].updatedAt)
    expect(await store.getById("movie", 9, UUID_A)).toMatchObject({
      title: "User unicode \u00E8 \u{1F37F}\nsecond line",
    })
    // Strict namespace: nothing leaks into the global store.
    expect(await store.getById("movie", 9)).toBeNull()
  })

  it("global and user aliases persist as compact JSON with fresh updatedAt", async () => {
    const { store, dir } = await freshStore()
    await store.setImdbAlias({ imdbId: "tt13207736", mediaType: "tv", tmdbId: 299939 })
    await store.setImdbAlias({ imdbId: "tt0111161", mediaType: "movie", tmdbId: 278 }, UUID_A)
    const globalRaw = await expectCompactFile(path.join(dir, "aliases.json"))
    const userRaw = await expectCompactFile(path.join(dir, "users", UUID_A, "aliases.json"))
    const globalParsed = JSON.parse(globalRaw) as Record<string, ImdbAlias>
    const userParsed = JSON.parse(userRaw) as Record<string, ImdbAlias>
    expect(globalParsed["tt13207736"]).toMatchObject({
      imdbId: "tt13207736",
      mediaType: "tv",
      tmdbId: 299939,
    })
    expect(userParsed["tt0111161"]).toMatchObject({
      imdbId: "tt0111161",
      mediaType: "movie",
      tmdbId: 278,
    })
    // updatedAt is stamped on every alias write, like on mappings.
    expectRecentStamp(globalParsed["tt13207736"].updatedAt)
    expectRecentStamp(userParsed["tt0111161"].updatedAt)
    expect(await store.getImdbAlias("tt13207736")).toMatchObject({ tmdbId: 299939 })
    expect(await store.getImdbAlias("tt0111161", UUID_A)).toMatchObject({ tmdbId: 278 })
    // Strict namespaces: user alias invisible globally and vice versa.
    expect(await store.getImdbAlias("tt0111161")).toBeNull()
    expect(await store.getImdbAlias("tt13207736", UUID_A)).toBeNull()
  })

  it("sequential and concurrent queued upserts stay correct and compact", async () => {
    const { store, dir } = await freshStore()
    await Promise.all([
      store.upsert(mapping(1, "Movie A")),
      store.upsert(mapping(2, "Movie B")),
      store.upsert(mapping(3, "Movie C"), UUID_A),
      store.upsert(mapping(4, "Movie D"), UUID_A),
    ])
    await store.upsert(mapping(5, "Movie E"))
    expect(
      (await store.getAll()).map((m) => m.title).sort(),
    ).toEqual(["Movie A", "Movie B", "Movie E"])
    expect(
      (await store.getAll(UUID_A)).map((m) => m.title).sort(),
    ).toEqual(["Movie C", "Movie D"])
    const globalParsed = JSON.parse(
      await expectCompactFile(path.join(dir, "mappings.json")),
    ) as Record<string, Mapping>
    const userParsed = JSON.parse(
      await expectCompactFile(path.join(dir, "users", UUID_A, "mappings.json")),
    ) as Record<string, Mapping>
    expectRecentStamp(globalParsed["movie:5"].updatedAt)
    expectRecentStamp(userParsed["movie:3"].updatedAt)
    // removeAll + fresh save: lifecycle recovery unchanged.
    await store.removeAll()
    expect(await store.getAll()).toHaveLength(0)
    await store.upsert(mapping(6, "After wipe"))
    expect(await store.getAll()).toHaveLength(1)
  })

  it("corrupt file reads fail open and the next save recovers", async () => {
    const { store, dir } = await freshStore()
    const file = path.join(dir, "mappings.json")
    await fsp.writeFile(file, "{corrupt!!!")
    // Corrupt-read fail-open only (loadFromDisk falls back to the
    // last-known-good mirror, {} when cold).
    expect(await store.getAll()).toEqual([])
    await store.upsert(mapping(7, "Recovered"))
    expect(await store.getAll()).toHaveLength(1)
    const parsed = JSON.parse(await expectCompactFile(file)) as Record<string, Mapping>
    expect(parsed["movie:7"].title).toBe("Recovered")
    expectRecentStamp(parsed["movie:7"].updatedAt)
  })

  it("stays on the file backend when the runner env carries KV/Redis credentials", async () => {
    // Simulate a configured runner: ambient live credentials present BEFORE
    // the harness runs. freshStore() must neutralize every backend selector,
    // so the store can never switch to kv or touch live data. Probe-guarded:
    // only getStorageMode()/getStorageBackend() (pure selectors, no I/O) are
    // read — getKv() is never called, and the @vercel/kv mock above would
    // throw on any accidental network use.
    vi.stubEnv("PICTORIUM_REDIS_URL", "redis://localhost:6379/0")
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io")
    vi.stubEnv("KV_REST_API_TOKEN", "test-token")
    const { store, dir } = await freshStore()
    expect(store.getStorageMode()).toBe("file")
    const kv = await import("@/lib/kv")
    expect(kv.getStorageMode()).toBe("file")
    expect(kv.getStorageBackend()).toBeNull()
    // Canonical data-dir precedence: a legacy decoy must never shadow
    // PICTORIUM_DATA_DIR.
    const decoy = path.join(dir, "decoy-legacy")
    vi.stubEnv("POSTERIUM_DATA_DIR", decoy)
    vi.resetModules()
    const restubbed = await import("@/lib/store")
    expect(restubbed.getStorageMode()).toBe("file")
    await restubbed.upsert(mapping(77, "Precedence probe"))
    expect(await restubbed.getById("movie", 77)).toMatchObject({ title: "Precedence probe" })
    const landed = await fsp.readFile(path.join(dir, "mappings.json"), "utf-8")
    expect((JSON.parse(landed) as Record<string, Mapping>)["movie:77"].title).toBe("Precedence probe")
    await expect(fsp.stat(path.join(decoy, "mappings.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })
})
