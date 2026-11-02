import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import type { Mapping } from "@/lib/types"

// Hash KV in-memory: valida il cablaggio store -> kv.ts -> @/lib/upstash-kv-client
// senza rete. Attivo solo con KV_REST_API_URL/TOKEN.
const kvHashes = vi.hoisted(() => new Map<string, Map<string, unknown>>())
vi.mock("@/lib/upstash-kv-client", () => ({
  kv: {
    hgetall: async (key: string) => {
      const h = kvHashes.get(key)
      if (!h) return null
      return Object.fromEntries(h)
    },
    hset: async (key: string, obj: Record<string, unknown>) => {
      let h = kvHashes.get(key)
      if (!h) {
        h = new Map()
        kvHashes.set(key, h)
      }
      for (const [f, v] of Object.entries(obj)) h.set(f, v)
      return 1
    },
    hdel: async (key: string, ...fields: string[]) => {
      const h = kvHashes.get(key)
      if (!h) return 0
      let n = 0
      for (const f of fields) if (h.delete(f)) n++
      return n
    },
    del: async (key: string) => (kvHashes.delete(key) ? 1 : 0),
    // Truthful modeled EVAL for the known quota scripts (Q2b2): atomic
    // check-then-write on the in-memory hashes, no canned-always-success.
    eval: async (script: string, keys: string[], args: string[]) => {
      const hashOf = (k: string): Map<string, unknown> => {
        let h = kvHashes.get(k)
        if (!h) {
          h = new Map()
          kvHashes.set(k, h)
        }
        return h
      }
      if (script.includes("pictorium:mapping-upsert:v1")) {
        if (keys.length !== 1 || args.length !== 3) throw new Error("unsupported mapping-upsert args in fake eval")
        const [hashK] = keys
        const [maxRaw, field, json] = args
        const h = hashOf(hashK)
        if (h.has(field)) {
          h.set(field, JSON.parse(json))
          return 0
        }
        if (h.size >= parseInt(maxRaw, 10)) return 1
        h.set(field, JSON.parse(json))
        return 0
      }
      if (script.includes("pictorium:mapping-import:v1")) {
        if (keys.length !== 1 || args.length < 1 || (args.length - 1) % 2 !== 0)
          throw new Error("unsupported mapping-import args in fake eval")
        const [hashK] = keys
        const h = hashOf(hashK)
        let fresh = 0
        for (let i = 1; i < args.length; i += 2) if (!h.has(args[i])) fresh++
        if (h.size + fresh > parseInt(args[0], 10)) return 1
        for (let i = 1; i < args.length; i += 2) h.set(args[i], JSON.parse(args[i + 1]))
        return 0
      }
      if (script.includes("pictorium:alias-set:v1")) {
        if (keys.length !== 2 || args.length !== 3) throw new Error("unsupported alias-set args in fake eval")
        const [aliasK, mapK] = keys
        const ah = hashOf(aliasK)
        const mh = kvHashes.get(mapK)
        if (ah.has(args[1])) {
          ah.set(args[1], JSON.parse(args[2]))
          return 0
        }
        if (ah.size + (mh?.size ?? 0) >= parseInt(args[0], 10)) return 1
        ah.set(args[1], JSON.parse(args[2]))
        return 0
      }
      throw new Error("unsupported script in fake eval")
    },
  },
}))

const originalDataDir = process.env.POSTERIUM_DATA_DIR
let tempDir: string | undefined

function makeMapping(id: number, title: string): Mapping {
  return {
    tmdbId: id,
    mediaType: "movie",
    title,
    posterPath: `/p${id}.jpg`,
    logoPath: null,
    originalPosterPath: null,
    language: "it",
    updatedAt: new Date().toISOString(),
  }
}

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.POSTERIUM_DATA_DIR
  } else {
    process.env.POSTERIUM_DATA_DIR = originalDataDir
  }
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvHashes.clear()
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

describe("file mapping store", () => {
  it("reloads mappings written by another server worker", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-store-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const store = await import("@/lib/store")
    expect(await store.getAll()).toEqual([])

    const mapping: Mapping = {
      tmdbId: 42,
      mediaType: "movie",
      title: "Persisted Worker Mapping",
      posterPath: "/persisted.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }
    await fsp.writeFile(path.join(tempDir, "mappings.json"), JSON.stringify({ "movie:42": mapping }))

    expect(await store.getAll()).toEqual([mapping])
  })

  it("handles concurrent upserts without losing writes", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-concurrent-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const store = await import("@/lib/store")

    const makeM = (id: number, title: string): Mapping => ({
      tmdbId: id,
      mediaType: "movie",
      title,
      posterPath: `/p${id}.jpg`,
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: new Date().toISOString(),
    })

    await Promise.all([
      store.upsert(makeM(1, "Movie A")),
      store.upsert(makeM(2, "Movie B")),
    ])

    const all = await store.getAll()
    expect(all).toHaveLength(2)
    const titles = all.map((m) => m.title).sort()
    expect(titles).toEqual(["Movie A", "Movie B"])
  })

  it("importMappings stamps a fresh updatedAt on each imported mapping", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-import-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const store = await import("@/lib/store")

    const stale: Mapping = {
      tmdbId: 7,
      mediaType: "movie",
      title: "Stale Import",
      posterPath: "/stale.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: "it",
      updatedAt: "2020-01-01T00:00:00.000Z",
    }

    await store.importMappings([stale])

    const all = await store.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].updatedAt).not.toBe("2020-01-01T00:00:00.000Z")
    // updatedAt deve essere una data ISO valida recente (timbrata all'import)
    expect(new Date(all[0].updatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it("importMappings([]) è no-op (niente hset vuoto → niente 500, v1.23.0)", async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-import-empty-"))
    process.env.POSTERIUM_DATA_DIR = tempDir
    vi.resetModules()
    const store = await import("@/lib/store")
    await expect(store.importMappings([])).resolves.toBeUndefined()
    expect(await store.getAll()).toHaveLength(0)
  })
})

describe("KV backend (Redis/Upstash via lib/kv)", () => {
  it("upsert/getById/getAll/remove round-trip sull'hash condiviso tra istanze", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.resetModules()
    const store = await import("@/lib/store")
    expect(store.getStorageMode()).toBe("kv")

    await store.upsert(makeMapping(1, "KV A"))
    await store.upsert(makeMapping(2, "KV B"))
    expect(await store.getById("movie", 1)).toMatchObject({ title: "KV A" })
    expect(await store.getAll()).toHaveLength(2)

    // Altra istanza (modulo ricaricato, cache vuota): legge dall'hash condiviso.
    vi.resetModules()
    const reloaded = await import("@/lib/store")
    expect(await reloaded.getAll()).toHaveLength(2)
    await reloaded.remove("movie", 1)
    expect(await reloaded.getById("movie", 1)).toBeNull()
    expect(await reloaded.getAll()).toHaveLength(1)
    await reloaded.removeAll()
    expect(await reloaded.getAll()).toHaveLength(0)
  })

  it("namespace utente isolati sullo stesso backend", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const uuidA = "11111111-1111-4111-8111-111111111111"
    const uuidB = "22222222-2222-4222-8222-222222222222"
    vi.resetModules()
    const store = await import("@/lib/store")
    await store.upsert(makeMapping(1, "A1"), uuidA)
    await store.upsert(makeMapping(1, "B1"), uuidB)
    expect(await store.getById("movie", 1, uuidA)).toMatchObject({ title: "A1" })
    expect(await store.getById("movie", 1, uuidB)).toMatchObject({ title: "B1" })
    // Senza namespace: solo il globale (vuoto qui), mai leak tra namespace.
    expect(await store.getById("movie", 1)).toBeNull()
  })
})

describe("KV per-user quota guards (Q2b2 atomic EVAL)", () => {
  const UUID_Q = "33333333-3333-4333-8333-333333333333"

  // Caller-env snapshots (collection time = pristine): every var the NEW
  // tests below overwrite must come back verbatim — never a bare `delete`
  // that would drop a caller value.
  const origQuotaEnv = new Map<string, string | undefined>([
    ["PICTORIUM_REDIS_URL", process.env.PICTORIUM_REDIS_URL],
    ["POSTERIUM_REDIS_URL", process.env.POSTERIUM_REDIS_URL],
    ["REDIS_URL", process.env.REDIS_URL],
    ["KV_REST_API_URL", process.env.KV_REST_API_URL],
    ["KV_REST_API_TOKEN", process.env.KV_REST_API_TOKEN],
    ["PICTORIUM_MAX_MAPPINGS_PER_USER", process.env.PICTORIUM_MAX_MAPPINGS_PER_USER],
    ["POSTERIUM_MAX_MAPPINGS_PER_USER", process.env.POSTERIUM_MAX_MAPPINGS_PER_USER],
  ])

  function restoreQuotaEnv(): void {
    for (const [k, v] of origQuotaEnv) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }

  function stubFakeRestKv(max: string): void {
    // Fake REST KV explicitly, independent of any caller Redis URL: Redis
    // wins over KV in getKv(), so blank the Redis selectors ("" trims to
    // unset in resolveRedisUrl) to force the mocked @/lib/upstash-kv-client path — never
    // an accidental real Redis when the parent env is configured.
    vi.stubEnv("PICTORIUM_REDIS_URL", "")
    vi.stubEnv("POSTERIUM_REDIS_URL", "")
    vi.stubEnv("REDIS_URL", "")
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io")
    vi.stubEnv("KV_REST_API_TOKEN", "test-token")
    vi.stubEnv("PICTORIUM_MAX_MAPPINGS_PER_USER", max)
  }

  async function kvStore(max: string) {
    stubFakeRestKv(max)
    vi.resetModules()
    return import("@/lib/store")
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // This describe is file-last, but the file-level afterEach unconditionally
  // deletes KV_* after every test — so the per-test unstub above cannot leave
  // the caller values in place. Re-apply the exact snapshots last.
  afterAll(() => {
    restoreQuotaEnv()
  })

  it("overwrite at quota succeeds (same field, max=1)", async () => {
    const store = await kvStore("1")
    await store.upsert(makeMapping(1, "One"), UUID_Q)
    await store.upsert(makeMapping(1, "One v2"), UUID_Q)
    expect(await store.getById("movie", 1, UUID_Q)).toMatchObject({ title: "One v2" })
    await expect(store.upsert(makeMapping(2, "Two"), UUID_Q)).rejects.toMatchObject({
      name: "QuotaExceededError",
      max: 1,
    })
    expect(await store.getAll(UUID_Q)).toHaveLength(1)
  })

  it("import dedupes duplicate IDs: two rows same key count once", async () => {
    const store = await kvStore("2")
    await store.importMappings(
      [
        { ...makeMapping(1, "Dup A"), mediaType: "movie" as const },
        { ...makeMapping(1, "Dup B"), mediaType: "movie" as const },
      ],
      UUID_Q,
    )
    const all = await store.getAll(UUID_Q)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ title: "Dup B" })
  })

  it("import over quota is all-or-nothing (nothing stored)", async () => {
    const store = await kvStore("2")
    await store.upsert(makeMapping(1, "Seed"), UUID_Q)
    await expect(
      store.importMappings([makeMapping(2, "A"), makeMapping(3, "B")], UUID_Q),
    ).rejects.toMatchObject({ name: "QuotaExceededError", max: 2 })
    expect(await store.getAll(UUID_Q)).toHaveLength(1)
  })

  it("all-overwrite import while already over quota is still rejected", async () => {
    const store = await kvStore("2")
    // Seed 2, then lower the cap to 1: the stored count (2) is already over.
    await store.upsert(makeMapping(1, "A"), UUID_Q)
    await store.upsert(makeMapping(2, "B"), UUID_Q)
    vi.stubEnv("PICTORIUM_MAX_MAPPINGS_PER_USER", "1")
    await expect(store.importMappings([makeMapping(1, "A2")], UUID_Q)).rejects.toMatchObject({
      name: "QuotaExceededError",
      max: 1,
    })
    // Overwrite via upsert stays allowed even over quota (historical).
    await store.upsert(makeMapping(1, "A3"), UUID_Q)
    expect(await store.getById("movie", 1, UUID_Q)).toMatchObject({ title: "A3" })
  })

  it("empty user import is a no-op in KV mode (no eval, no write)", async () => {
    const store = await kvStore("2")
    await expect(store.importMappings([], UUID_Q)).resolves.toBeUndefined()
    expect(await store.getAll(UUID_Q)).toHaveLength(0)
  })

  it("backend type error fails closed generic, never QuotaExceededError", async () => {
    stubFakeRestKv("2")
    vi.resetModules()
    const kv = await import("@/lib/kv")
    kv.getKv().eval = async () => 3 as unknown as never
    const store = await import("@/lib/store")
    const err = await store.upsert(makeMapping(1, "X"), UUID_Q).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).not.toBe("QuotaExceededError")
  })
})
