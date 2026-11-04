import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock di @/lib/upstash-kv-client: il modulo deve esistere PRIMA dell'import di rate-limit
// (vi.mock è hoisted) e il mock viene risetolto con vi.resetModules + reimport
// perché rate-limit.ts legge le env a module level.
const kvMock = vi.hoisted(() => ({
  incr: vi.fn<(key: string) => Promise<number>>(),
  expire: vi.fn<(key: string, seconds: number) => Promise<number>>(),
  eval: vi.fn<(script: string, keys: string[], args: string[]) => Promise<unknown>>(),
}))

vi.mock("@/lib/upstash-kv-client", () => ({ kv: kvMock }))

// Fake ioredis con contatori reali: valida il rate-limit distribuito sul
// backend Redis nativo (stessa semantica fixed-window di Upstash).
const redisCounters = vi.hoisted(() => new Map<string, number>())
const redisExpireCalls = vi.hoisted((): Array<{ key: string; seconds: number }> => [])
vi.mock("ioredis", () => ({
  default: class {
    async eval(script: string, numKeys: number, ...rest: string[]): Promise<unknown> {
      const keys = rest.slice(0, numKeys)
      const args = rest.slice(numKeys)
      const key = keys[0]
      // Minimal token-bucket shim mirroring the Lua for tests.
      const maxTokens = Number(args[0])
      const refillRate = Number(args[1])
      const refillWindow = Number(args[2])
      const now = Number(args[3])
      let tokens = redisCounters.get(key + ":tokens")
      let lastRefill = redisCounters.get(key + ":last")
      if (tokens === undefined) tokens = maxTokens
      if (lastRefill === undefined) lastRefill = now
      const elapsed = now - lastRefill
      if (elapsed >= refillWindow) {
        const cycles = Math.floor(elapsed / refillWindow)
        tokens = Math.min(tokens + cycles * refillRate, maxTokens)
        lastRefill = lastRefill + cycles * refillWindow
      }
      let ok = 0
      let retAfter = 0
      if (tokens > 0) { tokens--; ok = 1 }
      else {
        const waitMs = lastRefill + refillWindow - now
        retAfter = Math.ceil(waitMs / 1000)
        if (retAfter < 1) retAfter = 1
      }
      redisCounters.set(key + ":tokens", tokens)
      redisCounters.set(key + ":last", lastRefill)
      redisExpireCalls.push({ key, seconds: Number(args[4]) })
      return [ok, retAfter]
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
    kvMock.eval.mockReset()
    kvMock.eval.mockResolvedValue([1, 0])
  })

  afterEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    delete process.env.PICTORIUM_REDIS_URL
    delete process.env.POSTERIUM_RATELIMIT_KV
    redisCounters.clear()
    redisExpireCalls.length = 0
  })

  it("usa kv.eval token bucket su una chiave composta (bucket:client) e impagina maxTokens", async () => {
    const { rateLimit } = await importRateLimit()
    // warmup: maxTokens=5 → i primi 5 ok, il 6° bloccato
    for (let i = 0; i < 5; i++) {
      kvMock.eval.mockResolvedValueOnce([1, 0])
      expect(await rateLimit("client-a", "warmup")).toEqual({ ok: true, retAfter: 0 })
    }
    kvMock.eval.mockResolvedValueOnce([0, 1])
    const denied = await rateLimit("client-a", "warmup")
    expect(denied.ok).toBe(false)
    expect(denied.retAfter).toBeGreaterThan(0)
    // Nessun INCR/EXPIRE separato: un solo EVAL atomico.
    expect(kvMock.incr).not.toHaveBeenCalled()
    expect(kvMock.expire).not.toHaveBeenCalled()
    // La chiave non porta più il numero di finestra.
    const keys = kvMock.eval.mock.calls.map((c) => (c[1] as string[])[0])
    expect(keys.every((k) => /^rl:warmup:client-a$/.test(k))).toBe(true)
  })

  it("buckets diversi producono chiavi KV diverse (nessun bucket condiviso)", async () => {
    const { rateLimit } = await importRateLimit()
    kvMock.eval.mockResolvedValue([1, 0])
    await rateLimit("client-b", "warmup")
    await rateLimit("client-b", "poster")
    const keys = kvMock.eval.mock.calls.map((call) => (call[1] as string[])[0] as string)
    expect(keys.some((k) => k === "rl:warmup:client-b")).toBe(true)
    expect(keys.some((k) => k === "rl:poster:client-b")).toBe(true)
  })

  it("POSTERIUM_RATELIMIT_KV=0 forza lo store in-memory (zero chiamate KV)", async () => {
    process.env.POSTERIUM_RATELIMIT_KV = "0"
    const { rateLimit } = await importRateLimit()
    expect(await rateLimit("client-c", "warmup").then((r) => r.ok)).toBe(true)
    expect(kvMock.incr).not.toHaveBeenCalled()
  })

  it("su errore KV degrada al bucket in-memory senza lanciare (fail-open locale)", async () => {
    const { rateLimit } = await importRateLimit()
    kvMock.eval.mockRejectedValue(new Error("upstash down"))
    // Il fallback in-memory deve comportarsi come il rate limit normale:
    // 5 richieste ok (warmup max 5), la sesta negata dal bucket locale.
    for (let i = 0; i < 5; i++) {
      expect((await rateLimit("client-d", "warmup")).ok).toBe(true)
    }
    expect((await rateLimit("client-d", "warmup")).ok).toBe(false)
  })

  it("backend Redis nativo: token bucket condiviso via EVAL", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const { rateLimit } = await importRateLimit()
    for (let i = 0; i < 5; i++) {
      expect(await rateLimit("client-e", "warmup")).toEqual({ ok: true, retAfter: 0 })
    }
    // Un EVAL per richiesta, nessun INCR/EXPIRE separato.
    expect(redisExpireCalls.length).toBeGreaterThanOrEqual(5)
    expect(redisExpireCalls[0].key).toBe("rl:warmup:client-e")
    expect(redisExpireCalls[0].seconds).toBe(30 * 60)

    const denied = await rateLimit("client-e", "warmup")
    expect(denied.ok).toBe(false)
    expect(denied.retAfter).toBeGreaterThan(0)
    // Mai toccato Upstash: il backend attivo è Redis.
    expect(kvMock.eval).not.toHaveBeenCalled()
  })
})