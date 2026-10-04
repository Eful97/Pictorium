import { afterEach, describe, expect, it, vi } from "vitest"

// Budget deterministico: 11 MiB (minimo accettato dalla guardia `> 10`,
// valori inferiori ricadrebbero nel default di 150 MiB).
process.env.PICTORIUM_CACHE_MAX_MB = "11"

// Mock KV (stesso pattern di cache-kv.test.ts): serve solo al test di
// ripopolamento da L2, gli altri test restano puramente in memoria.
const kvMock = {
  get: vi.fn(),
  set: vi.fn(),
}
vi.mock("@vercel/kv", () => ({ kv: kvMock }))

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

const MB = 1024 * 1024
const MAX_BYTES = 11 * MB

type CacheModule = typeof import("@/lib/cache")

let activeCache: CacheModule | null = null

async function freshCache(): Promise<CacheModule> {
  vi.resetModules()
  activeCache = await import("@/lib/cache")
  return activeCache
}

afterEach(() => {
  activeCache?.cacheClear()
  activeCache = null
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.ADMIN_TOKEN
  redisStore.clear()
  vi.clearAllMocks()
  kvMock.get.mockResolvedValue(null)
})

describe("cache: budget rispettato nelle sostituzioni", () => {
  it("la sostituzione in crescita evitta LRU senza superare MAX_BYTES", async () => {
    const cache = await freshCache()
    cache.cacheSet("k1", Buffer.alloc(4 * MB))
    cache.cacheSet("k2", Buffer.alloc(4 * MB))
    cache.cacheSet("k3", Buffer.alloc(2 * MB))
    expect(cache.cacheStatus().totalBytes).toBe(10 * MB)

    // Crescita netta +3 MiB: 13 MiB non ci stanno, va evitta k1 (LRU).
    cache.cacheSet("k3", Buffer.alloc(5 * MB))

    expect(cache.cacheGet("k1")).toBeNull()
    expect(cache.cacheGet("k2")).not.toBeNull()
    expect(cache.cacheGet("k3")).not.toBeNull()
    const status = cache.cacheStatus()
    expect(status.totalBytes).toBe(9 * MB)
    expect(status.totalBytes).toBeLessThanOrEqual(status.maxBytes)
    expect(status.maxBytes).toBe(MAX_BYTES)
  })

  it("la sostituzione che evitta ogni altra voce resta coerente", async () => {
    const cache = await freshCache()
    cache.cacheSet("k1", Buffer.alloc(4 * MB))
    cache.cacheSet("k2", Buffer.alloc(4 * MB))

    // Crescita netta +6 MiB: l'unico modo di starci è evitta k2 per intero.
    cache.cacheSet("k1", Buffer.alloc(10 * MB))

    expect(cache.cacheGet("k2")).toBeNull()
    expect(cache.cacheGet("k1")).not.toBeNull()
    const status = cache.cacheStatus()
    // Conteggio coerente: una sola entry attiva, totale esatto, nel budget.
    expect(status.totalEntries).toBe(1)
    expect(status.totalBytes).toBe(10 * MB)
    expect(status.totalBytes).toBeLessThanOrEqual(status.maxBytes)
    // Ordine LRU coerente: lo store resta funzionale dopo lo svuotamento,
    // con totali esatti sulle operazioni successive.
    cache.cacheSet("k1", Buffer.alloc(2 * MB))
    cache.cacheSet("k3", Buffer.alloc(1 * MB))
    expect(cache.cacheGet("k1")).not.toBeNull()
    expect(cache.cacheGet("k3")).not.toBeNull()
    const after = cache.cacheStatus()
    expect(after.totalEntries).toBe(2)
    expect(after.totalBytes).toBe(3 * MB)
  })

  it("la sostituzione in riduzione non evitta nulla", async () => {
    const cache = await freshCache()
    cache.cacheSet("k1", Buffer.alloc(4 * MB))
    cache.cacheSet("k2", Buffer.alloc(4 * MB))

    cache.cacheSet("k1", Buffer.alloc(1 * MB))

    expect(cache.cacheGet("k1")).not.toBeNull()
    expect(cache.cacheGet("k2")).not.toBeNull()
    expect(cache.cacheStatus().totalBytes).toBe(5 * MB)
  })

  it("accetta un valore che porta il totale esattamente al limite", async () => {
    const cache = await freshCache()
    cache.cacheSet("only", Buffer.alloc(8 * MB))

    cache.cacheSet("only", Buffer.alloc(11 * MB))

    expect(cache.cacheGet("only")).not.toBeNull()
    const status = cache.cacheStatus()
    expect(status.totalBytes).toBe(MAX_BYTES)
    expect(status.totalBytes).toBeLessThanOrEqual(status.maxBytes)
  })

  it("rifiuta il payload singolo oltre budget conservando la voce precedente", async () => {
    const cache = await freshCache()
    cache.cacheSet("k1", "keep-me")

    cache.cacheSet("k1", Buffer.alloc(12 * MB))

    expect(cache.cacheGet("k1")).toBe("keep-me")
    // Stesso comportamento per una chiave nuova: rifiutata, resto intatto.
    cache.cacheSet("k-big", Buffer.alloc(12 * MB))
    expect(cache.cacheGet("k-big")).toBeNull()
    expect(cache.cacheGet("k1")).toBe("keep-me")
  })

  it("l'evizione colpisce la voce meno recentemente usata", async () => {
    const cache = await freshCache()
    cache.cacheSet("k1", Buffer.alloc(4 * MB))
    cache.cacheSet("k2", Buffer.alloc(4 * MB))
    cache.cacheSet("k3", Buffer.alloc(2 * MB))
    // k1 diventa most-recently-used: la vittima designata è k2.
    expect(cache.cacheGet("k1")).not.toBeNull()

    // Crescita netta +2 MiB su k3: serve esattamente un'evizione da 4 MiB.
    cache.cacheSet("k3", Buffer.alloc(4 * MB))

    expect(cache.cacheGet("k2")).toBeNull()
    expect(cache.cacheGet("k1")).not.toBeNull()
    expect(cache.cacheGet("k3")).not.toBeNull()
    expect(cache.cacheStatus().totalBytes).toBeLessThanOrEqual(MAX_BYTES)
  })

  it("sostituzioni ripetute senza deriva nei contatori", async () => {
    const cache = await freshCache()
    cache.cacheSet("stable", Buffer.alloc(4 * MB))
    cache.cacheSet("other", Buffer.alloc(4 * MB))

    let lastSize = 0
    for (let i = 0; i < 20; i++) {
      lastSize = i % 2 === 0 ? 1 * MB : 2 * MB
      cache.cacheSet("churn", Buffer.alloc(lastSize))
      const total = cache.cacheStatus().totalBytes
      expect(total).toBeGreaterThanOrEqual(0)
      expect(total).toBeLessThanOrEqual(MAX_BYTES)
    }

    expect(cache.cacheStatus().totalBytes).toBe(8 * MB + lastSize)
    expect(cache.cacheGet("stable")).not.toBeNull()
    expect(cache.cacheGet("other")).not.toBeNull()
    expect(cache.cacheGet("churn")).not.toBeNull()
  })

  it("la sostituzione applica i metadati della nuova scrittura", async () => {
    const cache = await freshCache()
    cache.cacheSet("k1", "v1", ["mytag"], 60_000)

    // Semantica esistente: la sostituzione è una scrittura completa
    // (valore + tag + TTL della nuova chiamata).
    cache.cacheSet("k1", "v2", ["mytag"], 60_000)
    expect(cache.cacheGet("k1")).toBe("v2")

    // I tag della nuova scrittura restano: l'invalidazione li trova.
    cache.cacheInvalidate("mytag")
    expect(cache.cacheGet("k1")).toBeNull()
  })
})

describe("cache: contatori di payload attivi e stale", () => {
  it("le entry stale trattenute sono conteggiate a parte", async () => {
    const cache = await freshCache()
    cache.cacheSet("p1", Buffer.alloc(4 * MB), ["poster"])
    cache.cacheExpire("p1")

    const status = cache.cacheStatus()

    expect(status.totalEntries).toBe(0)
    expect(status.totalBytes).toBe(0)
    expect(status.staleBytes).toBe(4 * MB)
    expect(status.retainedBytes).toBe(4 * MB)
    // La stale resta servibile per la rivalidazione in background.
    expect(cache.cacheGetStale("p1").stale).toBe(true)
  })

  it("retained = attivi + stale e le non-SWR scadute non contano", async () => {
    const cache = await freshCache()
    cache.cacheSet("active", Buffer.alloc(1 * MB))
    cache.cacheSet("p1", Buffer.alloc(4 * MB), ["poster"])
    cache.cacheExpire("p1")
    // Senza tag SWR: lo status pass la rimuove invece di trattenerla.
    cache.cacheSet("tmp", "x", [], -1)

    const status = cache.cacheStatus()

    expect(status.totalBytes).toBe(1 * MB)
    expect(status.staleBytes).toBe(4 * MB)
    expect(status.retainedBytes).toBe(status.totalBytes + status.staleBytes)
    expect(status.retainedBytes).toBe(5 * MB)
    expect(cache.cacheGet("tmp")).toBeNull()
  })

  it("l'API di stato resta compatibile ed espone i nuovi campi", async () => {
    vi.resetModules()
    const cache = (activeCache = await import("@/lib/cache"))
    const { GET } = await import("@/app/api/cache/status/route")
    process.env.ADMIN_TOKEN = "secret"

    cache.cacheSet("a", "one")
    cache.cacheSet("p1", "poster-payload", ["poster"])
    cache.cacheExpire("p1")

    const res = await GET(
      new Request("http://localhost:3000/api/cache/status", {
        headers: { "x-admin-token": "secret" },
      }) as never,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    // Contratto storico invariato.
    expect(body.totalEntries).toBe(1)
    expect(body.untaggedEntries).toBe(1)
    expect(typeof body.totalBytes).toBe("number")
    expect(typeof body.maxBytes).toBe("number")
    expect(typeof body.maxEntries).toBe("number")
    // Nuovi campi espliciti e coerenti.
    expect(typeof body.staleBytes).toBe("number")
    expect(body.staleBytes).toBeGreaterThan(0)
    expect(body.retainedBytes).toBe(body.totalBytes + body.staleBytes)
  })
})

describe("cache: ripopolamento da KV attraversa il budget", () => {
  it("la read path KV→L1 resta nel budget e non riscrive la KV", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    const writer = await freshCache()
    writer.cacheSet("shared", { n: 1 }, ["catalog"], 60_000)
    await new Promise((r) => setTimeout(r, 10))
    expect(kvMock.set).toHaveBeenCalledTimes(1)
    const envelope = kvMock.set.mock.calls[0][1] as string
    writer.cacheClear()
    activeCache = null

    // Altra istanza: L1 quasi piena, il ripopolamento deve starci dentro.
    kvMock.get.mockResolvedValue(envelope)
    const reader = await freshCache()
    reader.cacheSet("b1", Buffer.alloc(4 * MB))
    reader.cacheSet("b2", Buffer.alloc(4 * MB))

    const data = await reader.cacheGetShared<{ n: number }>("shared", ["catalog"])

    expect(data).toEqual({ n: 1 })
    // Contenuto finale: i vicini L1 ci sono ancora più la voce ripopolata.
    expect(reader.cacheGet("b1")).not.toBeNull()
    expect(reader.cacheGet("b2")).not.toBeNull()
    const status = reader.cacheStatus()
    // Contatori coerenti: 3 entry attive, somma esatta dei payload stimati
    // (8 MiB di Buffer + 9 byte dell'oggetto { n: 1 }), nel budget.
    expect(status.totalEntries).toBe(3)
    expect(status.totalBytes).toBe(8 * MB + 9)
    expect(status.totalBytes).toBeLessThanOrEqual(status.maxBytes)
    expect(status.retainedBytes).toBe(status.totalBytes + status.staleBytes)
    // Secondo accesso: hit L1, nessun altro round-trip; mai rewrite KV.
    expect(await reader.cacheGetShared("shared", ["catalog"])).toEqual({ n: 1 })
    expect(kvMock.get).toHaveBeenCalledTimes(1)
    expect(kvMock.set).toHaveBeenCalledTimes(1)
  })
})
