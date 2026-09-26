import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock di @vercel/kv: vi.mock è hoisted, il modulo cache viene reimportato
// per-test con vi.resetModules (stesso pattern di rate-limit-kv.test.ts).
const kvMock = {
  get: vi.fn(),
  set: vi.fn(),
}
vi.mock("@vercel/kv", () => ({ kv: kvMock }))

// Fake ioredis in-memory (condiviso tra i resetModules: simula il Redis
// condiviso tra istanze). Serve al test del backend Redis nativo.
const redisStore = vi.hoisted(() => new Map<string, string>())
vi.mock("ioredis", () => ({
  default: class {
    async get(key: string): Promise<string | null> {
      return redisStore.get(key) ?? null
    }
    async set(key: string, value: string): Promise<string> {
      redisStore.set(key, value)
      return "OK"
    }
    async quit(): Promise<string> {
      return "OK"
    }
  },
}))

async function importCache() {
  vi.resetModules()
  return await import("@/lib/cache")
}

describe("cache L2 condivisa (C1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    kvMock.get.mockResolvedValue(null)
    kvMock.set.mockResolvedValue("OK")
  })

  afterEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.PICTORIUM_REDIS_URL
    redisStore.clear()
    vi.resetModules()
  })

  it("senza KV: L2 no-op, solo memoria", async () => {
    const { cacheSet, cacheGetShared } = await importCache()
    cacheSet("k1", { a: 1 }, ["stremio", "catalog"], 60_000)
    expect(await cacheGetShared("k1")).toEqual({ a: 1 })
    expect(kvMock.set).not.toHaveBeenCalled()
    expect(kvMock.get).not.toHaveBeenCalled()
    expect(await cacheGetShared("missing")).toBeNull()
    expect(kvMock.get).not.toHaveBeenCalled()
  })

  it("con KV: write-through + read-through con ripopolazione L1", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const { cacheSet } = await importCache()
    cacheSet("cat1", { metas: [] }, ["stremio", "catalog"], 60_000)
    await new Promise((r) => setTimeout(r, 10))
    expect(kvMock.set).toHaveBeenCalledTimes(1)
    const [key, json, opts] = kvMock.set.mock.calls[0] as [string, string, { ex: number }]
    expect(key).toBe("pictorium:cache:cat1")
    expect(JSON.parse(json)).toEqual({ metas: [] })
    expect(opts.ex).toBeGreaterThanOrEqual(60)

    // Simula altra istanza: modulo fresco (L1 vuota), KV risponde
    kvMock.get.mockResolvedValue(json)
    const fresh = await importCache()
    expect(await fresh.cacheGetShared<{ metas: unknown[] }>("cat1", ["stremio", "catalog"])).toEqual({ metas: [] })
    expect(kvMock.get).toHaveBeenCalledTimes(1)
    // Secondo accesso: hit L1, niente altro round-trip KV
    expect(await fresh.cacheGetShared("cat1", ["stremio", "catalog"])).toEqual({ metas: [] })
    expect(kvMock.get).toHaveBeenCalledTimes(1)
  })

  it("Buffer e payload >64KB restano locali", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const { cacheSet } = await importCache()
    cacheSet("buf1", Buffer.alloc(100), ["poster"], 60_000)
    cacheSet("big1", { s: "x".repeat(70 * 1024) }, ["stremio", "catalog"], 60_000)
    expect(kvMock.set).not.toHaveBeenCalled()
  })

  it("errori KV = miss (fail-open)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    kvMock.get.mockRejectedValue(new Error("KV down"))
    kvMock.set.mockRejectedValue(new Error("KV down"))
    const { cacheSet } = await importCache()
    cacheSet("k2", { a: 1 }, [], 60_000)
    await new Promise((r) => setTimeout(r, 10))
    const fresh = await importCache()
    expect(await fresh.cacheGetShared("k2")).toBeNull()
  })

  it("backend Redis nativo: write-through + read-through cross-istanza", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const { cacheSet } = await importCache()
    cacheSet("rcat1", { metas: [] }, ["stremio", "catalog"], 60_000)
    await new Promise((r) => setTimeout(r, 10))
    expect(redisStore.get("pictorium:cache:rcat1")).toBe(JSON.stringify({ metas: [] }))

    // Altra istanza: L1 vuota, legge dal Redis condiviso e ripopola la L1.
    const fresh = await importCache()
    expect(await fresh.cacheGetShared<{ metas: unknown[] }>("rcat1", ["stremio", "catalog"])).toEqual({ metas: [] })
    expect(await fresh.cacheGetShared("missing")).toBeNull()
  })
})
