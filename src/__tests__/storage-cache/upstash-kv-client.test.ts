import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Fake `@upstash/redis`: records the constructor config (credential resolution)
// and every command forwarded by the wrapper, without any network.
const sdk = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ method: string; args: unknown[] }>,
  results: new Map<string, unknown>(),
}))

vi.mock("@upstash/redis", () => {
  const handler = (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      sdk.calls.push({ method, args })
      return Promise.resolve(sdk.results.get(method))
    }
  class Redis {
    constructor(config: Record<string, unknown>) {
      sdk.configs.push(config)
    }
    get = handler("get")
    set = handler("set")
    del = handler("del")
    hgetall = handler("hgetall")
    hset = handler("hset")
    hdel = handler("hdel")
    incr = handler("incr")
    expire = handler("expire")
    scan = handler("scan")
    sadd = handler("sadd")
    srem = handler("srem")
    smembers = handler("smembers")
    zadd = handler("zadd")
    zrem = handler("zrem")
    zincrby = handler("zincrby")
    zrange = handler("zrange")
    zscore = handler("zscore")
    eval = handler("eval")
  }
  return { Redis }
})

const ENV_KEYS = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key]
}

async function importClient() {
  // Per-test registry: the module caches one client per credential pair.
  vi.resetModules()
  return await import("@/lib/upstash-kv-client")
}

describe("upstash-kv-client (client REST Upstash: credenziali, fail-closed, inoltro comandi)", () => {
  beforeEach(() => {
    clearEnv()
    sdk.configs.length = 0
    sdk.calls.length = 0
    sdk.results.clear()
  })

  afterEach(() => {
    clearEnv()
    vi.resetModules()
  })

  it("senza credenziali: fail-closed, nessun client costruito", async () => {
    const { kv } = await importClient()
    await expect(kv.get("k")).rejects.toThrow(/No Upstash Redis credentials/)
    await expect(kv.set("k", "v")).rejects.toThrow(/No Upstash Redis credentials/)
    await expect(kv.del("k")).rejects.toThrow(/No Upstash Redis credentials/)
    expect(sdk.configs).toHaveLength(0)
    expect(sdk.calls).toHaveLength(0)
  })

  it("coppia parziale (URL senza token): resta fail-closed", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"
    const { kv } = await importClient()
    await expect(kv.get("k")).rejects.toThrow(/No Upstash Redis credentials/)
    expect(sdk.configs).toHaveLength(0)
  })

  it("UPSTASH_REDIS_REST_*: client configurato e get/set/del inoltrati", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://canonical.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "canonical-token"
    sdk.results.set("get", { a: 1 })
    sdk.results.set("set", "OK")
    sdk.results.set("del", 1)

    const { kv } = await importClient()
    await expect(kv.get<{ a: number }>("k")).resolves.toEqual({ a: 1 })
    await kv.set("k", { a: 1 }, { ex: 60 })
    await kv.set("raw", "hello")
    await expect(kv.del("k")).resolves.toBe(1)

    expect(sdk.configs).toEqual([
      {
        url: "https://canonical.upstash.io",
        token: "canonical-token",
        // Parità con il client ritirato: la deserializzazione JSON resta attiva.
        automaticDeserialization: true,
      },
    ])
    expect(sdk.calls).toEqual([
      { method: "get", args: ["k"] },
      { method: "set", args: ["k", { a: 1 }, { ex: 60 }] },
      { method: "set", args: ["raw", "hello", undefined] },
      { method: "del", args: ["k"] },
    ])
  })

  it("nomi legacy KV_REST_API_*: accettati, poi UPSTASH_* vince quando compare", async () => {
    process.env.KV_REST_API_URL = "https://legacy.upstash.io"
    process.env.KV_REST_API_TOKEN = "legacy-token"

    const { kv } = await importClient()
    await kv.get("k")
    expect(sdk.configs[0]).toMatchObject({ url: "https://legacy.upstash.io", token: "legacy-token" })

    // Canonical pair appears later (e.g. staged migration): it takes precedence
    // and rebuilds the client instead of reusing the legacy one.
    process.env.UPSTASH_REDIS_REST_URL = "https://canonical.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "canonical-token"
    await kv.get("k2")
    expect(sdk.configs[1]).toMatchObject({ url: "https://canonical.upstash.io", token: "canonical-token" })
    expect(sdk.configs).toHaveLength(2)
  })

  it("adatta scan (cursore numerico) e zadd (coppie score/member)", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://canonical.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "canonical-token"
    sdk.results.set("scan", ["0", ["a", "b"]])
    sdk.results.set("zadd", 1)

    const { kv } = await importClient()
    await expect(kv.scan(0, { match: "user:*", count: 100 })).resolves.toEqual([0, ["a", "b"]])
    await expect(kv.zadd("rank", { score: 3, member: "m" })).resolves.toBe(1)

    expect(sdk.calls).toEqual([
      { method: "scan", args: [0, { match: "user:*", count: 100 }] },
      { method: "zadd", args: ["rank", { score: 3, member: "m" }] },
    ])
  })
})
