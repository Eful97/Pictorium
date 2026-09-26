import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Mapping } from "@/lib/types"

// Hash KV in-memory: valida il cablaggio store -> kv.ts -> @vercel/kv
// senza rete. Attivo solo con KV_REST_API_URL/TOKEN.
const kvHashes = vi.hoisted(() => new Map<string, Map<string, unknown>>())
vi.mock("@vercel/kv", () => ({
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
