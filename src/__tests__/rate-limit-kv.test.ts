import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock di @vercel/kv: il modulo deve esistere PRIMA dell'import di rate-limit
// (vi.mock è hoisted) e il mock viene risetolto con vi.resetModules + reimport
// perché rate-limit.ts legge le env a module level.
const kvMock = vi.hoisted(() => ({
  incr: vi.fn<(key: string) => Promise<number>>(),
  expire: vi.fn<(key: string, seconds: number) => Promise<number>>(),
}))

vi.mock("@vercel/kv", () => ({ kv: kvMock }))

// Fake ioredis con contatori reali: valida il rate-limit distribuito sul
// backend Redis nativo (stessa semantica fixed-window di Upstash).
const redisCounters = vi.hoisted(() => new Map<string, number>())
const redisExpireCalls = vi.hoisted((): Array<{ key: string; seconds: number }> => [])
vi.mock("ioredis", () => ({
  default: class {
    async incr(key: string): Promise<number> {
      const next = (redisCounters.get(key) ?? 0) + 1
      redisCounters.set(key, next)
      return next
    }
    async expire(key: string, seconds: number): Promise<number> {
      redisExpireCalls.push({ key, seconds })
      return 1
    }
    async quit(): Promise<string> {
      return "OK"
    }
  },
}))

async function importRateLimit() {
  vi.resetModules()
  return await import("@/lib/rate-limit")
}

describe("rateLimit con store KV condiviso (KV_REST_API_URL/TOKEN configurati)", () => {
  beforeEach(() => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    kvMock.incr.mockReset()
    kvMock.expire.mockReset()
    kvMock.expire.mockResolvedValue(1)
  })

  afterEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.PICTORIUM_REDIS_URL
    delete process.env.POSTERIUM_RATELIMIT_KV
    redisCounters.clear()
    redisExpireCalls.length = 0
  })

  it("usa kv.incr su una chiave composta (bucket:client:finestra) e impagina maxTokens", async () => {
    const { rateLimit } = await importRateLimit()
    // warmup: maxTokens=5 → count 1..5 ok, 6 bloccato
    for (let count = 1; count <= 5; count++) {
      kvMock.incr.mockResolvedValueOnce(count)
      expect(await rateLimit("client-a", "warmup")).toEqual({ ok: true, retAfter: 0 })
    }
    // La prima richiesta della finestra imposta il TTL (2× finestra = 2s)
    expect(kvMock.expire).toHaveBeenCalledTimes(1)
    expect(kvMock.expire).toHaveBeenCalledWith(expect.stringMatching(/^rl:warmup:client-a:\d+$/), 2)

    kvMock.incr.mockResolvedValueOnce(6)
    const denied = await rateLimit("client-a", "warmup")
    expect(denied.ok).toBe(false)
    expect(denied.retAfter).toBeGreaterThan(0)
  })

  it("buckets diversi producono chiavi KV diverse (nessun bucket condiviso)", async () => {
    const { rateLimit } = await importRateLimit()
    kvMock.incr.mockResolvedValue(1)
    await rateLimit("client-b", "warmup")
    await rateLimit("client-b", "poster")
    const keys = kvMock.incr.mock.calls.map((call) => call[0] as string)
    expect(keys.some((k) => k.startsWith("rl:warmup:client-b:"))).toBe(true)
    expect(keys.some((k) => k.startsWith("rl:poster:client-b:"))).toBe(true)
  })

  it("POSTERIUM_RATELIMIT_KV=0 forza lo store in-memory (zero chiamate KV)", async () => {
    process.env.POSTERIUM_RATELIMIT_KV = "0"
    const { rateLimit } = await importRateLimit()
    expect(await rateLimit("client-c", "warmup").then((r) => r.ok)).toBe(true)
    expect(kvMock.incr).not.toHaveBeenCalled()
  })

  it("su errore KV degrada al bucket in-memory senza lanciare (fail-open locale)", async () => {
    const { rateLimit } = await importRateLimit()
    kvMock.incr.mockRejectedValue(new Error("upstash down"))
    // Il fallback in-memory deve comportarsi come il rate limit normale:
    // 5 richieste ok (warmup max 5), la sesta negata dal bucket locale.
    for (let i = 0; i < 5; i++) {
      expect((await rateLimit("client-d", "warmup")).ok).toBe(true)
    }
    expect((await rateLimit("client-d", "warmup")).ok).toBe(false)
  })

  it("backend Redis nativo: fixed-window condiviso con TTL 2x finestra", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const { rateLimit } = await importRateLimit()
    for (let i = 0; i < 5; i++) {
      expect(await rateLimit("client-e", "warmup")).toEqual({ ok: true, retAfter: 0 })
    }
    // La prima richiesta della finestra imposta il TTL (2× finestra = 2s).
    expect(redisExpireCalls).toHaveLength(1)
    expect(redisExpireCalls[0].key).toMatch(/^rl:warmup:client-e:\d+$/)
    expect(redisExpireCalls[0].seconds).toBe(2)

    const denied = await rateLimit("client-e", "warmup")
    expect(denied.ok).toBe(false)
    expect(denied.retAfter).toBeGreaterThan(0)
    // Mai toccato Upstash: il backend attivo è Redis.
    expect(kvMock.incr).not.toHaveBeenCalled()
  })
})