import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import type { Mapping } from "@/lib/types"

// Hash KV in-memory: valida il cablaggio alias -> kv.ts -> @/lib/upstash-kv-client.
// Attivo solo con KV_REST_API_URL/TOKEN.
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

const UUID_A = "11111111-1111-1111-1111-111111111111"
const UUID_B = "22222222-2222-2222-2222-222222222222"

const originalDataDir = process.env.POSTERIUM_DATA_DIR
const originalMax = process.env.PICTORIUM_MAX_MAPPINGS_PER_USER
let tempDir: string | undefined

async function freshStore() {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "pictorium-alias-"))
  process.env.POSTERIUM_DATA_DIR = tempDir
  vi.resetModules()
  return import("@/lib/store")
}

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.POSTERIUM_DATA_DIR
  else process.env.POSTERIUM_DATA_DIR = originalDataDir
  if (originalMax === undefined) delete process.env.PICTORIUM_MAX_MAPPINGS_PER_USER
  else process.env.PICTORIUM_MAX_MAPPINGS_PER_USER = originalMax
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvHashes.clear()
  vi.resetModules()
  if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function mapping(id: number): Mapping {
  return {
    tmdbId: id, mediaType: "tv", title: `T${id}`, posterPath: `/p${id}.jpg`,
    logoPath: null, originalPosterPath: null, language: "it",
    updatedAt: new Date().toISOString(),
  }
}

describe("imdb alias store", () => {
  it("set/get roundtrip con updatedAt timbrato", async () => {
    const store = await freshStore()
    expect(await store.getImdbAlias("tt13207736", UUID_A)).toBeNull()
    await store.setImdbAlias({ imdbId: "tt13207736", mediaType: "tv", tmdbId: 299939 }, UUID_A)
    const got = await store.getImdbAlias("tt13207736", UUID_A)
    expect(got).toMatchObject({ imdbId: "tt13207736", mediaType: "tv", tmdbId: 299939 })
    expect(typeof got?.updatedAt).toBe("string")
    expect(await store.getAllAliases(UUID_A)).toHaveLength(1)
  })

  it("isola i namespace (scoped vs globale vs altro uuid)", async () => {
    const store = await freshStore()
    await store.setImdbAlias({ imdbId: "tt1", mediaType: "tv", tmdbId: 1 }, UUID_A)
    await store.setImdbAlias({ imdbId: "tt1", mediaType: "movie", tmdbId: 2 }, UUID_B)
    await store.setImdbAlias({ imdbId: "tt1", mediaType: "movie", tmdbId: 3 })
    expect(await store.getImdbAlias("tt1", UUID_A)).toMatchObject({ tmdbId: 1 })
    expect(await store.getImdbAlias("tt1", UUID_B)).toMatchObject({ tmdbId: 2 })
    expect(await store.getImdbAlias("tt1")).toMatchObject({ tmdbId: 3 })
  })

  it("rifiuta alias invalidi senza scrivere", async () => {
    const store = await freshStore()
    await expect(store.setImdbAlias({ imdbId: "xyz", mediaType: "tv", tmdbId: 1 }, UUID_A)).rejects.toThrow()
    await expect(store.setImdbAlias({ imdbId: "tt1", mediaType: "tv", tmdbId: 0 }, UUID_A)).rejects.toThrow()
    await expect(store.setImdbAlias({ imdbId: "tt1", mediaType: "x" as never, tmdbId: 1 }, UUID_A)).rejects.toThrow()
    expect(await store.getAllAliases(UUID_A)).toHaveLength(0)
    expect(await store.getImdbAlias("xyz", UUID_A)).toBeNull()
  })

  it("condivide la quota con i mapping", async () => {
    process.env.PICTORIUM_MAX_MAPPINGS_PER_USER = "1"
    const store = await freshStore()
    await store.upsert(mapping(1), UUID_A)
    await expect(
      store.setImdbAlias({ imdbId: "tt1", mediaType: "tv", tmdbId: 2 }, UUID_A),
    ).rejects.toThrow(/quota/i)
    // L'update della stessa chiave non conta come nuovo rigo
    await store.setImdbAlias({ imdbId: "tt1", mediaType: "tv", tmdbId: 2 })
    await store.setImdbAlias({ imdbId: "tt1", mediaType: "tv", tmdbId: 3 })
    expect(await store.getImdbAlias("tt1")).toMatchObject({ tmdbId: 3 })
  })

  it("removeAliasesFor pulisce solo il target (cascata delete mapping)", async () => {
    const store = await freshStore()
    await store.setImdbAlias({ imdbId: "tt1", mediaType: "tv", tmdbId: 10 }, UUID_A)
    await store.setImdbAlias({ imdbId: "tt2", mediaType: "tv", tmdbId: 10 }, UUID_A)
    await store.setImdbAlias({ imdbId: "tt3", mediaType: "tv", tmdbId: 11 }, UUID_A)
    const removed = await store.removeAliasesFor("tv", 10, UUID_A)
    expect(removed.sort()).toEqual(["tt1", "tt2"])
    expect(await store.getImdbAlias("tt1", UUID_A)).toBeNull()
    expect(await store.getImdbAlias("tt3", UUID_A)).toMatchObject({ tmdbId: 11 })
  })

  it("removeImdbAlias invalido è no-op", async () => {
    const store = await freshStore()
    await store.removeImdbAlias("xyz", UUID_A)
    await store.removeImdbAlias("tt999", UUID_A)
  })
})

describe("imdb alias KV backend (Redis/Upstash via lib/kv)", () => {
  it("set/get/remove round-trip sull'hash condiviso, namespace isolati", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.resetModules()
    const store = await import("@/lib/store")
    await store.setImdbAlias({ imdbId: "tt13207736", mediaType: "tv", tmdbId: 299939 }, UUID_A)
    await store.setImdbAlias({ imdbId: "tt13207736", mediaType: "movie", tmdbId: 1 }, UUID_B)
    expect(await store.getImdbAlias("tt13207736", UUID_A)).toMatchObject({ tmdbId: 299939 })
    expect(await store.getImdbAlias("tt13207736", UUID_B)).toMatchObject({ tmdbId: 1 })
    expect(await store.getImdbAlias("tt13207736")).toBeNull()

    // Altra istanza: legge dall'hash condiviso.
    vi.resetModules()
    const reloaded = await import("@/lib/store")
    expect(await reloaded.getImdbAlias("tt13207736", UUID_A)).toMatchObject({ tmdbId: 299939 })
    await reloaded.removeImdbAlias("tt13207736", UUID_A)
    expect(await reloaded.getImdbAlias("tt13207736", UUID_A)).toBeNull()
    expect(await reloaded.getImdbAlias("tt13207736", UUID_B)).toMatchObject({ tmdbId: 1 })
  })
})

describe("imdb alias KV quota guards (Q2b2 atomic EVAL)", () => {
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

  async function kvStore(max: string) {
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

  it("new alias gated on combined mappings+aliases; overwrite at quota allowed", async () => {
    const store = await kvStore("2")
    await store.upsert(mapping(1), UUID_A)
    await store.setImdbAlias({ imdbId: "tt10000001", mediaType: "tv", tmdbId: 101 }, UUID_A)
    // Combined usage is now 2/2: a second NEW alias is rejected with quota.
    await expect(
      store.setImdbAlias({ imdbId: "tt10000002", mediaType: "tv", tmdbId: 102 }, UUID_A),
    ).rejects.toMatchObject({ name: "QuotaExceededError", max: 2 })
    expect(await store.getAllAliases(UUID_A)).toHaveLength(1)
    // Overwrite of the existing alias is allowed even at quota.
    await store.setImdbAlias({ imdbId: "tt10000001", mediaType: "tv", tmdbId: 103 }, UUID_A)
    expect(await store.getImdbAlias("tt10000001", UUID_A)).toMatchObject({ tmdbId: 103 })
    expect(await store.getAllAliases(UUID_A)).toHaveLength(1)
  })

  it("global aliases count against global mappings; namespaces stay isolated", async () => {
    const store = await kvStore("2")
    await store.upsert(mapping(1))
    await store.setImdbAlias({ imdbId: "tt20000002", mediaType: "tv", tmdbId: 202 })
    // Global combined usage is now 2/2: a second NEW global alias is rejected …
    await expect(
      store.setImdbAlias({ imdbId: "tt20000001", mediaType: "tv", tmdbId: 201 }),
    ).rejects.toMatchObject({ name: "QuotaExceededError", max: 2 })
    // … but the user namespace is unaffected (its own hashes).
    await store.setImdbAlias({ imdbId: "tt20000001", mediaType: "tv", tmdbId: 201 }, UUID_A)
    expect(await store.getImdbAlias("tt20000001", UUID_A)).toMatchObject({ tmdbId: 201 })
    expect(await store.getImdbAlias("tt20000001")).toBeNull()
    // Global overwrite stays allowed at quota.
    await store.setImdbAlias({ imdbId: "tt20000002", mediaType: "tv", tmdbId: 203 })
    expect(await store.getImdbAlias("tt20000002")).toMatchObject({ tmdbId: 203 })
  })

  it("mapping writes never count aliases (residual asymmetry, preserved)", async () => {
    const store = await kvStore("2")
    await store.setImdbAlias({ imdbId: "tt30000001", mediaType: "tv", tmdbId: 301 }, UUID_A)
    await store.setImdbAlias({ imdbId: "tt30000002", mediaType: "tv", tmdbId: 302 }, UUID_A)
    // 2 aliases stored with max=2: a mapping upsert still succeeds because
    // mapping quota counts mappings only (documented residual asymmetry).
    await store.upsert(mapping(9), UUID_A)
    expect(await store.getById("tv", 9, UUID_A)).toMatchObject({ title: "T9" })
  })
})
