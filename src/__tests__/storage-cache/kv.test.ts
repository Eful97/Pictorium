import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Fake ioredis in-memory: verifica che kv.ts normalizzi correttamente
// ({ex} -> "EX", scan opts -> MATCH/COUNT, encode/decode JSON) senza rete.
const redisRegistry = vi.hoisted(() => ({ instances: [] as FakeState[] }))

interface FakeState {
  url: string
  opts: unknown
  strings: Map<string, string>
  hashes: Map<string, Map<string, string>>
  setCalls: Array<{ key: string; value: string; extra: Array<string | number> }>
  scanCalls: Array<{ cursor: number | string; args: Array<string | number> }>
  evalCalls: Array<{ script: string; numKeys: number; keysAndArgs: Array<string> }>
  evalImpl: ((script: string, numKeys: number, ...keysAndArgs: string[]) => Promise<unknown>) | null
  quitCalls: number
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${escaped}$`)
}

vi.mock("ioredis", () => {
  class FakeRedis {
    state: FakeState
    constructor(url: string, opts: unknown) {
      this.state = {
        url,
        opts,
        strings: new Map(),
        hashes: new Map(),
        setCalls: [],
        scanCalls: [],
        evalCalls: [],
        evalImpl: null,
        quitCalls: 0,
      }
      redisRegistry.instances.push(this.state)
    }
    async get(key: string): Promise<string | null> {
      return this.state.strings.get(key) ?? null
    }
    async set(key: string, value: string, ...extra: Array<string | number>): Promise<string> {
      this.state.setCalls.push({ key, value, extra })
      this.state.strings.set(key, value)
      return "OK"
    }
    async del(key: string): Promise<number> {
      const had = this.state.strings.delete(key) || this.state.hashes.delete(key)
      return had ? 1 : 0
    }
    async hgetall(key: string): Promise<Record<string, string>> {
      const out: Record<string, string> = {}
      for (const [f, v] of this.state.hashes.get(key) ?? []) out[f] = v
      return out
    }
    async hset(key: string, obj: Record<string, string>): Promise<number> {
      let hash = this.state.hashes.get(key)
      if (!hash) {
        hash = new Map()
        this.state.hashes.set(key, hash)
      }
      let added = 0
      for (const [f, v] of Object.entries(obj)) {
        if (!hash.has(f)) added++
        hash.set(f, v)
      }
      return added
    }
    async hdel(key: string, ...fields: string[]): Promise<number> {
      const hash = this.state.hashes.get(key)
      if (!hash) return 0
      let n = 0
      for (const f of fields) if (hash.delete(f)) n++
      return n
    }
    async incr(key: string): Promise<number> {
      const next = (parseInt(this.state.strings.get(key) ?? "0", 10) || 0) + 1
      this.state.strings.set(key, String(next))
      return next
    }
    async expire(_key: string, _seconds: number): Promise<number> {
      return 1
    }
    async scan(cursor: number | string, ...args: Array<string | number>): Promise<[string, string[]]> {
      this.state.scanCalls.push({ cursor, args })
      const matchIdx = args.indexOf("MATCH")
      const pattern = matchIdx >= 0 ? String(args[matchIdx + 1]) : "*"
      const re = globToRegExp(pattern)
      const keys = [
        ...this.state.strings.keys(),
        ...[...this.state.hashes.keys()].map((k) => k),
      ].filter((k) => re.test(k))
      return ["0", keys]
    }
    async quit(): Promise<string> {
      this.state.quitCalls++
      return "OK"
    }
    async eval(script: string, numKeys: number, ...keysAndArgs: string[]): Promise<unknown> {
      this.state.evalCalls.push({ script, numKeys, keysAndArgs })
      if (this.state.evalImpl) return this.state.evalImpl(script, numKeys, ...keysAndArgs)
      return 1
    }
  }
  return { default: FakeRedis }
})

const kvMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  hgetall: vi.fn(),
  hset: vi.fn(),
  hdel: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  scan: vi.fn(),
  eval: vi.fn(),
}))

vi.mock("@/lib/upstash-kv-client", () => ({ kv: kvMock }))

async function importKv() {
  vi.resetModules()
  return await import("@/lib/kv")
}

function clearEnv() {
  delete process.env.PICTORIUM_REDIS_URL
  delete process.env.POSTERIUM_REDIS_URL
  delete process.env.REDIS_URL
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
}

describe("kv.ts (Step 1: selezione backend + serializzazione)", () => {
  beforeEach(() => {
    clearEnv()
    redisRegistry.instances.length = 0
    vi.clearAllMocks()
  })

  afterEach(async () => {
    clearEnv()
    redisRegistry.instances.length = 0
    vi.resetModules()
  })

  it("nessun backend: mode file, getKv lancia", async () => {
    const kv = await importKv()
    expect(kv.getStorageMode()).toBe("file")
    expect(kv.getStorageBackend()).toBeNull()
    expect(() => kv.getKv()).toThrow(/No KV backend/)
    expect(redisRegistry.instances).toHaveLength(0)
  })

  it("import non connette (lazy): nessuna istanza alla sola importazione", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    await importKv()
    expect(redisRegistry.instances).toHaveLength(0)
  })

  it("precedenza URL: PICTORIUM > POSTERIUM > nudo", async () => {
    const kv = await importKv()
    process.env.REDIS_URL = "redis://bare:6379/0"
    expect(kv.resolveRedisUrl()).toBe("redis://bare:6379/0")
    process.env.POSTERIUM_REDIS_URL = "redis://legacy:6379/0"
    expect(kv.resolveRedisUrl()).toBe("redis://legacy:6379/0")
    process.env.PICTORIUM_REDIS_URL = "redis://canon:6379/0"
    expect(kv.resolveRedisUrl()).toBe("redis://canon:6379/0")
    expect(kv.isRedisConfigured()).toBe(true)
  })

  it("solo KV: backend upstash, pass-through con {ex}", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    expect(kv.getStorageMode()).toBe("kv")
    expect(kv.getStorageBackend()).toBe("upstash")
    const client = kv.getKv()
    kvMock.get.mockResolvedValue({ a: 1 })
    expect(await client.get("k")).toEqual({ a: 1 })
    await client.set("k", { a: 1 }, { ex: 60 })
    expect(kvMock.set).toHaveBeenCalledWith("k", { a: 1 }, { ex: 60 })
    await client.set("k2", { a: 1 })
    expect(kvMock.set).toHaveBeenCalledWith("k2", { a: 1 }, undefined)
  })

  it("UPSTASH_REDIS_REST_*: nomi canonici attivi, nessun warning legacy", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://canonical.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "canonical-token"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const kv = await importKv()
      expect(kv.getStorageMode()).toBe("kv")
      expect(kv.getStorageBackend()).toBe("upstash")
      expect(kv.resolveUpstashRestCredentials()).toEqual({
        url: "https://canonical.upstash.io",
        token: "canonical-token",
        legacy: false,
      })
      kv.getKv()
      const legacyWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("legacy KV_REST_API_URL"))
      expect(legacyWarns).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("UPSTASH_* vince sui nomi legacy quando la coppia canonica è completa", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://canonical.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "canonical-token"
    process.env.KV_REST_API_URL = "https://legacy.upstash.io"
    process.env.KV_REST_API_TOKEN = "legacy-token"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const kv = await importKv()
      expect(kv.resolveUpstashRestCredentials()).toMatchObject({
        url: "https://canonical.upstash.io",
        legacy: false,
      })
      kv.getKv()
      kv.getKv()
      const legacyWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("legacy KV_REST_API_URL"))
      expect(legacyWarns).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("solo nomi legacy: backend attivo ma warning di deprecazione una sola volta", async () => {
    process.env.KV_REST_API_URL = "https://legacy.upstash.io"
    process.env.KV_REST_API_TOKEN = "legacy-token"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const kv = await importKv()
      expect(kv.resolveUpstashRestCredentials()).toMatchObject({
        url: "https://legacy.upstash.io",
        legacy: true,
      })
      kv.getKv()
      kv.getKv()
      const legacyWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("legacy KV_REST_API_URL"))
      expect(legacyWarns).toHaveLength(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("coppia Upstash parziale (URL senza token): nessun backend, getKv lancia", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"
    const kv = await importKv()
    expect(kv.isKvConfigured()).toBe(false)
    expect(kv.getStorageMode()).toBe("file")
    expect(kv.getStorageBackend()).toBeNull()
    expect(() => kv.getKv()).toThrow(/No KV backend/)
  })

  it("entrambi configurati: vince Redis + warn esplicito una sola volta", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const kv = await importKv()
      expect(kv.getStorageMode()).toBe("kv")
      expect(kv.getStorageBackend()).toBe("redis")
      kv.getKv()
      kv.getKv()
      const redisWarns = warnSpy.mock.calls.filter((c) =>
        String(c[0]).includes("Redis takes precedence"),
      )
      expect(redisWarns).toHaveLength(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("redis: set/get oggetto, stringa raw pass-through", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    const client = kv.getKv()
    await client.set("obj", { a: 1, b: [1, 2] })
    expect(await client.get("obj")).toEqual({ a: 1, b: [1, 2] })
    await client.set("raw", "hello")
    expect(await client.get<string>("raw")).toBe("hello")
    // Il fake conferma: oggetti stringifati, stringhe raw.
    const state = redisRegistry.instances[0]
    expect(state.strings.get("obj")).toBe('{"a":1,"b":[1,2]}')
    expect(state.strings.get("raw")).toBe("hello")
  })

  it("redis: stringa JSON (caso L2) ritorna parsata — come il ramo object del caller", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    const client = kv.getKv()
    const json = JSON.stringify({ metas: [] })
    await client.set("cat1", json)
    // cache.ts:kvReadThrough gestisce entrambi i rami (string|object): compatibile.
    expect(await client.get("cat1")).toEqual({ metas: [] })
  })

  it("redis: {ex} normalizzato in EX, hset/hgetall con mix, miss -> null", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    const client = kv.getKv()
    await client.set("ttl", { x: 1 }, { ex: 90 })
    const state = redisRegistry.instances[0]
    expect(state.setCalls[0]).toMatchObject({ key: "ttl", extra: ["EX", 90] })
    expect(await client.get("missing")).toBeNull()
    expect(await client.hgetall("hmissing")).toBeNull()
    await client.hset("mappings", { "movie:1": { tmdbId: 1 }, note: "ciao" })
    expect(await client.hgetall("mappings")).toEqual({ "movie:1": { tmdbId: 1 }, note: "ciao" })
    expect(state.hashes.get("mappings")?.get("movie:1")).toBe('{"tmdbId":1}')
    expect(state.hashes.get("mappings")?.get("note")).toBe("ciao")
    expect(await client.hdel("mappings", "note")).toBe(1)
    expect(await client.hgetall("mappings")).toEqual({ "movie:1": { tmdbId: 1 } })
    expect(await client.del("ttl")).toBe(1)
    expect(await client.get("ttl")).toBeNull()
  })

  it("redis: incr/expire/scan normalizzati (MATCH/COUNT, cursore numerico)", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    const client = kv.getKv()
    expect(await client.incr("rl:a:1")).toBe(1)
    expect(await client.incr("rl:a:1")).toBe(2)
    expect(await client.expire("rl:a:1", 2)).toBe(1)
    await client.set("user:aaa:auth", { h: 1 })
    await client.set("user:bbb:auth", { h: 1 })
    await client.set("other", { h: 1 })
    const [cursor, keys] = await client.scan(0, { match: "user:*:auth", count: 100 })
    expect(cursor).toBe(0)
    expect(keys.sort()).toEqual(["user:aaa:auth", "user:bbb:auth"])
    const state = redisRegistry.instances[0]
    expect(state.scanCalls[0]).toMatchObject({
      cursor: 0,
      args: ["MATCH", "user:*:auth", "COUNT", 100],
    })
  })

  it("redis: valore non serializzabile rifiutato invece di scrivere spazzatura", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    await expect(kv.getKv().set("bad", undefined)).rejects.toThrow(/Unserializable/)
  })

  it("redis: eval forwards script/keys/args unchanged (native numKeys first)", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    const client = kv.getKv()
    const script = "return redis.call('incr',KEYS[1])"
    // Pass-through strings: no encode/decode applied to keys/args.
    expect(await client.eval<number>(script, ["quota:u1"], ["5"])).toBe(1)
    expect(await client.eval<number>("return 1", [], [])).toBe(1)
    const state = redisRegistry.instances[0]
    expect(state.evalCalls).toHaveLength(2)
    expect(state.evalCalls[0]).toEqual({ script, numKeys: 1, keysAndArgs: ["quota:u1", "5"] })
    expect(state.evalCalls[1]).toEqual({ script: "return 1", numKeys: 0, keysAndArgs: [] })
  })

  it("redis: eval propagates numeric result and backend errors", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    const client = kv.getKv()
    await client.set("k", "v")
    const state = redisRegistry.instances[0]
    state.evalImpl = async () => 42
    expect(await client.eval<number>("return 42", ["k"], [])).toBe(42)
    state.evalImpl = async () => {
      throw new Error("ERR Error running script: quota exceeded")
    }
    await expect(client.eval<number>("return 0", ["k"], [])).rejects.toThrow(/quota exceeded/)
  })

  it("upstash: eval forwards the (script, keys, args) triple and returns the number", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const kv = await importKv()
    const client = kv.getKv()
    const script = "return redis.call('incr',KEYS[1])"
    kvMock.eval.mockResolvedValue(3)
    expect(await client.eval<number>(script, ["quota:u1", "quota:u2"], ["5"])).toBe(3)
    expect(kvMock.eval).toHaveBeenCalledWith(script, ["quota:u1", "quota:u2"], ["5"])
    expect(kvMock.eval).toHaveBeenCalledTimes(1)
    kvMock.eval.mockRejectedValueOnce(new Error("ERR Error running script: quota exceeded"))
    await expect(client.eval<number>(script, ["quota:u1"], ["5"])).rejects.toThrow(/quota exceeded/)
  })

  it("closeKvClient: chiude e resetta (doppia chiamata sicura, riuso ricrea)", async () => {
    process.env.PICTORIUM_REDIS_URL = "redis://localhost:6379/0"
    const kv = await importKv()
    const client = kv.getKv()
    await client.set("k", "v")
    expect(redisRegistry.instances).toHaveLength(1)
    await kv.closeKvClient()
    expect(redisRegistry.instances[0].quitCalls).toBe(1)
    await kv.closeKvClient()
    await client.set("k2", "v2")
    expect(redisRegistry.instances).toHaveLength(2)
    await kv.closeKvClient()
  })
})
