import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Hung backends, no network: every command returns a never-settling promise
// (ioredis and @vercel/kv are both mocked).
const hang = <T,>(): Promise<T> => new Promise<T>(() => {})

vi.mock("ioredis", () => {
  class HungRedis {
    constructor(..._args: unknown[]) {}
    get(): Promise<never> { return hang() }
    set(): Promise<never> { return hang() }
    del(): Promise<never> { return hang() }
    hgetall(): Promise<never> { return hang() }
    hset(): Promise<never> { return hang() }
    hdel(): Promise<never> { return hang() }
    incr(): Promise<never> { return hang() }
    expire(): Promise<never> { return hang() }
    scan(): Promise<never> { return hang() }
    sadd(): Promise<never> { return hang() }
    srem(): Promise<never> { return hang() }
    smembers(): Promise<never> { return hang() }
    zadd(): Promise<never> { return hang() }
    zrem(): Promise<never> { return hang() }
    zincrby(): Promise<never> { return hang() }
    zrevrange(): Promise<never> { return hang() }
    zscore(): Promise<never> { return hang() }
    async quit(): Promise<string> { return "OK" }
  }
  return { default: HungRedis }
})

const kvMock = vi.hoisted(() => {
  const hung = (): Promise<unknown> => new Promise(() => {})
  return {
    get: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    set: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    del: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    hgetall: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    hset: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    hdel: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    incr: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    expire: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    scan: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    sadd: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    srem: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    smembers: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    zadd: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    zrem: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    zincrby: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    zrange: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
    zscore: vi.fn<(...args: unknown[]) => Promise<unknown>>(hung),
  }
})

vi.mock("@vercel/kv", () => ({ kv: kvMock }))

function clearEnv() {
  delete process.env.PICTORIUM_REDIS_URL
  delete process.env.POSTERIUM_REDIS_URL
  delete process.env.REDIS_URL
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.PICTORIUM_KV_COMMAND_TIMEOUT_MS
  delete process.env.POSTERIUM_KV_COMMAND_TIMEOUT_MS
}

async function importKv() {
  vi.resetModules()
  return await import("@/lib/kv")
}

beforeEach(() => {
  clearEnv()
  vi.clearAllMocks()
  for (const fn of Object.values(kvMock)) fn.mockImplementation((): Promise<unknown> => hang())
})

afterEach(async () => {
  vi.useRealTimers()
  clearEnv()
  vi.resetModules()
})

describe("kv adapter: central timeout on a hung backend", () => {
  it("upstash: all primitives reject with KvTimeoutError", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    const client = kv.getKv()
    vi.useFakeTimers()
    try {
      const calls: Array<() => Promise<unknown>> = [
        () => client.get("k"),
        () => client.set("k", { a: 1 }, { ex: 60 }),
        () => client.set("k", { a: 1 }),
        () => client.del("k"),
        () => client.hgetall("h"),
        () => client.hset("h", { f: 1 }),
        () => client.hdel("h", "f"),
        () => client.incr("c"),
        () => client.expire("c", 5),
        () => client.scan(0, { match: "user:*:auth", count: 100 }),
        () => client.sadd("s", "a"),
        () => client.srem("s", "a"),
        () => client.smembers("s"),
        () => client.zadd("z", 1, "m"),
        () => client.zrem("z", "m"),
        () => client.zincrby("z", 1, "m"),
        () => client.zrevrange("z", 0, 9),
        () => client.zscore("z", "m"),
      ]
      for (const call of calls) {
        const assertion = expect(call()).rejects.toBeInstanceOf(kv.KvTimeoutError)
        await vi.advanceTimersByTimeAsync(3000)
        await assertion
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it("default cap is exactly 2000ms: pending at 1999, rejected at 2000", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    vi.useFakeTimers()
    try {
      let settled = false
      const p = kv.getKv().get("k")
      void p.then(
        () => { settled = true },
        () => { settled = true },
      )
      await vi.advanceTimersByTimeAsync(1999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const err = await p.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(kv.KvTimeoutError)
      expect((err as { ms: number }).ms).toBe(2000)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("PICTORIUM_KV_COMMAND_TIMEOUT_MS override moves the cap (500: pending at 499, rejected at 500)", async () => {
    process.env.PICTORIUM_KV_COMMAND_TIMEOUT_MS = "500"
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    vi.useFakeTimers()
    try {
      let settled = false
      const p = kv.getKv().get("k")
      void p.then(
        () => { settled = true },
        () => { settled = true },
      )
      await vi.advanceTimersByTimeAsync(499)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const err = await p.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(kv.KvTimeoutError)
      expect((err as { ms: number }).ms).toBe(500)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("explicit caller cap of 100ms: pending at 99, rejected at 100", async () => {
    const kv = await importKv()
    vi.useFakeTimers()
    try {
      let settled = false
      const p = kv.withKvTimeout(hang(), 100)
      void p.then(
        () => { settled = true },
        () => { settled = true },
      )
      await vi.advanceTimersByTimeAsync(99)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const err = await p.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(kv.KvTimeoutError)
      expect((err as { ms: number }).ms).toBe(100)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("double wrap: the tighter caller cap wins (rejects with ms 100, not 2000)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    vi.useFakeTimers()
    try {
      let settled = false
      const p = kv.withKvTimeout(kv.getKv().get("k"), 100)
      void p.then(
        () => { settled = true },
        () => { settled = true },
      )
      await vi.advanceTimersByTimeAsync(99)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const err = await p.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(kv.KvTimeoutError)
      expect((err as { ms: number }).ms).toBe(100)
    } finally {
      vi.useRealTimers()
    }
  })

  it("late rejection after the timeout is handled (no unhandled rejection)", async () => {
    const kv = await importKv()
    vi.useFakeTimers()
    try {
      let rejectLate!: (reason?: unknown) => void
      const inner = new Promise<never>((_, reject) => { rejectLate = reject })
      const p = kv.withKvTimeout(inner, 200)
      const assertion = expect(p).rejects.toBeInstanceOf(kv.KvTimeoutError)
      await vi.advanceTimersByTimeAsync(300)
      await assertion
      // Settles after the race already rejected: must stay handled.
      rejectLate(new Error("late failure"))
      await vi.advanceTimersByTimeAsync(100)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("upstash: client stays usable after a timeout (recovery)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    const client = kv.getKv()
    // 1. Hung -> timeout.
    vi.useFakeTimers()
    try {
      const assertion = expect(client.get("k")).rejects.toBeInstanceOf(kv.KvTimeoutError)
      await vi.advanceTimersByTimeAsync(3000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
    // 2. Backend alive again -> all primitives resolve.
    kvMock.get.mockResolvedValue({ a: 1 })
    kvMock.set.mockResolvedValue("OK")
    kvMock.del.mockResolvedValue(1)
    kvMock.hgetall.mockResolvedValue({ f: 1 })
    kvMock.hset.mockResolvedValue(1)
    kvMock.hdel.mockResolvedValue(1)
    kvMock.incr.mockResolvedValue(2)
    kvMock.expire.mockResolvedValue(1)
    kvMock.scan.mockResolvedValue([0, ["k1"]])
    kvMock.sadd.mockResolvedValue(1)
    kvMock.srem.mockResolvedValue(1)
    kvMock.smembers.mockResolvedValue(["a"])
    kvMock.zadd.mockResolvedValue(1)
    kvMock.zrem.mockResolvedValue(1)
    kvMock.zincrby.mockResolvedValue(3)
    kvMock.zrange.mockResolvedValue(["m"])
    kvMock.zscore.mockResolvedValue(4)
    await expect(client.get("k")).resolves.toEqual({ a: 1 })
    await expect(client.set("k", { a: 1 }, { ex: 60 })).resolves.toBeUndefined()
    await expect(client.del("k")).resolves.toBe(1)
    await expect(client.hgetall("h")).resolves.toEqual({ f: 1 })
    await expect(client.hset("h", { f: 1 })).resolves.toBe(1)
    await expect(client.hdel("h", "f")).resolves.toBe(1)
    await expect(client.incr("c")).resolves.toBe(2)
    await expect(client.expire("c", 5)).resolves.toBe(1)
    await expect(client.scan(0, { match: "*", count: 10 })).resolves.toEqual([0, ["k1"]])
    await expect(client.sadd("s", "a")).resolves.toBe(1)
    await expect(client.srem("s", "a")).resolves.toBe(1)
    await expect(client.smembers("s")).resolves.toEqual(["a"])
    await expect(client.zadd("z", 1, "m")).resolves.toBe(1)
    await expect(client.zrem("z", "m")).resolves.toBe(1)
    await expect(client.zincrby("z", 1, "m")).resolves.toBe(3)
    await expect(client.zrevrange("z", 0, 9)).resolves.toEqual(["m"])
    await expect(client.zscore("z", "m")).resolves.toBe(4)
  })

  it("redis: hung sample (get/set/hgetall/incr/expire/scan/zrevrange) rejects with KvTimeoutError", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:9"
    const kv = await importKv()
    const client = kv.getKv()
    vi.useFakeTimers()
    try {
      const calls: Array<() => Promise<unknown>> = [
        () => client.get("k"),
        () => client.set("k", { a: 1 }, { ex: 60 }),
        () => client.hgetall("mappings"),
        () => client.incr("rl:a:1"),
        () => client.expire("rl:a:1", 2),
        () => client.scan(0, { match: "user:*:auth", count: 100 }),
        () => client.zrevrange("z", 0, 9),
      ]
      for (const call of calls) {
        const assertion = expect(call()).rejects.toBeInstanceOf(kv.KvTimeoutError)
        await vi.advanceTimersByTimeAsync(3000)
        await assertion
      }
    } finally {
      vi.useRealTimers()
    }
    await kv.closeKvClient()
  })

  it("stable identity: getKv() returns the same wrapper per backend", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    expect(kv.getKv()).toBe(kv.getKv())
  })

  it("closeKvClient is not wrapped: resolves without KvTimeoutError", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:9"
    const kv = await importKv()
    kv.getKv()
    await expect(kv.closeKvClient()).resolves.toBeUndefined()
  })

  it("fast resolve leaves no pending timer", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    kvMock.get.mockResolvedValue({ a: 1 })
    const kv = await importKv()
    vi.useFakeTimers()
    try {
      await expect(kv.getKv().get("k")).resolves.toEqual({ a: 1 })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
