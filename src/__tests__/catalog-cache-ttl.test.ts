import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CATALOG_EMPTY_TTL_MS, CATALOG_TTL_MS } from "@/lib/catalog-handler"

// Mock di @vercel/kv (stesso pattern di cache-kv.test.ts): serve solo alla
// sezione KV→L1; senza env KV la L2 resta no-op e gli altri test girano in L1.
const kvMock = {
  get: vi.fn(),
  set: vi.fn(),
}
vi.mock("@vercel/kv", () => ({ kv: kvMock }))

async function importCache() {
  vi.resetModules()
  return await import("@/lib/cache")
}

const MIN = 60 * 1000
// 02:45 UTC: una finestra di 30 min attraversa le 03:00 senza superare 1h.
const T0 = Date.UTC(2026, 0, 1, 2, 45, 0)
const T0_POSTER = Date.UTC(2026, 0, 1, 2, 0, 0)

function nonEmptyBody() {
  return { metas: [{ id: "tmdb:1", type: "movie", name: "Title" }] }
}

describe("catalog response TTL (1h non-vuoto / 60s vuoto)", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    kvMock.get.mockResolvedValue(null)
    kvMock.set.mockResolvedValue("OK")
    const { cacheClear } = await importCache()
    cacheClear()
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.useRealTimers()
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    const { cacheClear } = await import("@/lib/cache")
    cacheClear()
    vi.resetModules()
  })

  it("espone le costanti attese (1h pieno, 60s vuoto)", () => {
    expect(CATALOG_TTL_MS).toBe(60 * 60 * 1000)
    expect(CATALOG_EMPTY_TTL_MS).toBe(60_000)
  })

  it("non-vuoto: valido prima di 1h, scaduto dopo", async () => {
    const { cacheSet, cacheGet } = await import("@/lib/cache")
    vi.setSystemTime(T0)
    cacheSet("cat:full", nonEmptyBody(), ["stremio", "catalog"], CATALOG_TTL_MS)
    vi.setSystemTime(T0 + 59 * MIN)
    expect(cacheGet("cat:full")).toEqual(nonEmptyBody())
    vi.setSystemTime(T0 + 61 * MIN)
    expect(cacheGet("cat:full")).toBeNull()
  })

  it("non-vuoto: attraversare le 03:00 UTC non fa scadere in anticipo", async () => {
    const { cacheSet, cacheGet } = await import("@/lib/cache")
    vi.setSystemTime(T0) // 02:45 UTC
    cacheSet("cat:full:3am", nonEmptyBody(), ["stremio", "catalog"], CATALOG_TTL_MS)
    vi.setSystemTime(T0 + 30 * MIN) // 03:15 UTC: refresh giornaliero alle spalle, 1h no
    expect(cacheGet("cat:full:3am")).toEqual(nonEmptyBody())
    vi.setSystemTime(T0 + 61 * MIN) // oltre 1h dalla generazione
    expect(cacheGet("cat:full:3am")).toBeNull()
  })

  it("vuoto: mantiene il TTL di 60 secondi", async () => {
    const { cacheSet, cacheGet } = await import("@/lib/cache")
    vi.setSystemTime(T0)
    cacheSet("cat:empty", { metas: [] }, ["stremio", "catalog"], CATALOG_EMPTY_TTL_MS)
    vi.setSystemTime(T0 + 59 * 1000)
    expect(cacheGet("cat:empty")).toEqual({ metas: [] })
    vi.setSystemTime(T0 + 61 * 1000)
    expect(cacheGet("cat:empty")).toBeNull()
  })

  it("poster: comportamento invariato (mappato al refresh giornaliero, esplicito oltre le 03:00)", async () => {
    const { cacheSet, cacheGet } = await import("@/lib/cache")
    // Mappato: nessun TTL esplicito → refresh schedulato alle 03:00 UTC.
    vi.setSystemTime(T0_POSTER) // 02:00 UTC
    cacheSet("poster:mapped", "img", ["poster"])
    vi.setSystemTime(T0_POSTER + 59 * MIN) // 02:59 UTC
    expect(cacheGet("poster:mapped")).toBe("img")
    vi.setSystemTime(T0_POSTER + 61 * MIN) // 03:01 UTC
    expect(cacheGet("poster:mapped")).toBeNull()
    // Dinamico/effimero: TTL esplicito vince sul refresh schedulato.
    vi.setSystemTime(T0_POSTER)
    cacheSet("poster:dynamic", "img", ["poster"], 6 * 60 * 60 * 1000)
    vi.setSystemTime(T0_POSTER + 90 * MIN) // 03:30 UTC
    expect(cacheGet("poster:dynamic")).toBe("img")
  })

  it("KV → L1: conserva 1h con EX 3600 e attraversa le 03:00", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.setSystemTime(T0)
    const writer = await importCache()
    writer.cacheSet("cat:kv:full", nonEmptyBody(), ["stremio", "catalog"], CATALOG_TTL_MS)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(kvMock.set).toHaveBeenCalledTimes(1)
    const [key, json, opts] = kvMock.set.mock.calls[0] as [string, string, { ex: number }]
    expect(key).toBe("pictorium:cache:cat:kv:full")
    // Envelope KV: payload + scadenza assoluta (generazione + TTL originale).
    const env = JSON.parse(json)
    expect(env.d).toEqual(nonEmptyBody())
    expect(env.t).toBe(T0)
    expect(env.ttl).toBe(CATALOG_TTL_MS)
    expect(opts.ex).toBe(3600)

    // Altra istanza (L1 vuota): legge dalla KV e ripopola la L1 con 1h.
    kvMock.get.mockResolvedValue(json)
    const fresh = await importCache()
    const ttlFor = (body: { metas: unknown[] } | null) =>
      body?.metas?.length ? CATALOG_TTL_MS : CATALOG_EMPTY_TTL_MS
    expect(
      await fresh.cacheGetShared("cat:kv:full", ["stremio", "catalog"], ttlFor),
    ).toEqual(nonEmptyBody())
    vi.setSystemTime(T0 + 30 * MIN) // 03:15 UTC: oltre il refresh, entro 1h
    expect(fresh.cacheGet("cat:kv:full")).toEqual(nonEmptyBody())
    vi.setSystemTime(T0 + 61 * MIN)
    expect(fresh.cacheGet("cat:kv:full")).toBeNull()
  })

  it("KV → L1: il catalogo vuoto conserva 60s (non il refresh giornaliero)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.setSystemTime(T0)
    const writer = await importCache()
    writer.cacheSet("cat:kv:empty", { metas: [] }, ["stremio", "catalog"], CATALOG_EMPTY_TTL_MS)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    const [, json, opts] = kvMock.set.mock.calls[0] as [string, string, { ex: number }]
    expect(opts.ex).toBe(60)
    const emptyEnv = JSON.parse(json)
    expect(emptyEnv.d).toEqual({ metas: [] })
    expect(emptyEnv.t).toBe(T0)
    expect(emptyEnv.ttl).toBe(CATALOG_EMPTY_TTL_MS)

    kvMock.get.mockResolvedValue(json)
    const fresh = await importCache()
    const ttlFor = (body: { metas: unknown[] } | null) =>
      body?.metas?.length ? CATALOG_TTL_MS : CATALOG_EMPTY_TTL_MS
    expect(
      await fresh.cacheGetShared("cat:kv:empty", ["stremio", "catalog"], ttlFor),
    ).toEqual({ metas: [] })
    vi.setSystemTime(T0 + 59 * 1000)
    expect(fresh.cacheGet("cat:kv:empty")).toEqual({ metas: [] })
    // 61s dopo la generazione: scaduto. Senza selettore la L1 ripopolata
    // ricadrebbe sul refresh giornaliero e resterebbe valida fino alle 03:00.
    vi.setSystemTime(T0 + 61 * 1000)
    expect(fresh.cacheGet("cat:kv:empty")).toBeNull()
  })

  it("KV → L1: lettura a T0+59min non prolunga la scadenza (pieno scade a T0+60min)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.setSystemTime(T0)
    const writer = await importCache()
    writer.cacheSet("cat:kv:noslide", nonEmptyBody(), ["stremio", "catalog"], CATALOG_TTL_MS)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(kvMock.set).toHaveBeenCalledTimes(1)
    const [, json] = kvMock.set.mock.calls[0] as [string, string, { ex: number }]
    kvMock.get.mockResolvedValue(json)
    const ttlFor = (body: { metas: unknown[] } | null) =>
      body?.metas?.length ? CATALOG_TTL_MS : CATALOG_EMPTY_TTL_MS

    // Seconda istanza legge a T0+30min: hit entro la scadenza originale.
    vi.setSystemTime(T0 + 30 * MIN)
    const second = await importCache()
    expect(
      await second.cacheGetShared("cat:kv:noslide", ["stremio", "catalog"], ttlFor),
    ).toEqual(nonEmptyBody())

    // Terza istanza legge a T0+59min: hit, ma senza riscrivere la KV.
    vi.setSystemTime(T0 + 59 * MIN)
    const third = await importCache()
    expect(
      await third.cacheGetShared("cat:kv:noslide", ["stremio", "catalog"], ttlFor),
    ).toEqual(nonEmptyBody())
    expect(kvMock.set).toHaveBeenCalledTimes(1)

    // Entrambe le L1 scadono a T0+60min (non a T0+119min).
    vi.setSystemTime(T0 + 61 * MIN)
    expect(second.cacheGet("cat:kv:noslide")).toBeNull()
    expect(third.cacheGet("cat:kv:noslide")).toBeNull()
  })

  it("KV → L1: vuoto letto a T0+59s scade a T0+60s (no sliding)", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.setSystemTime(T0)
    const writer = await importCache()
    writer.cacheSet("cat:kv:noslide-empty", { metas: [] }, ["stremio", "catalog"], CATALOG_EMPTY_TTL_MS)
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(kvMock.set).toHaveBeenCalledTimes(1)
    const [, json] = kvMock.set.mock.calls[0] as [string, string, { ex: number }]
    kvMock.get.mockResolvedValue(json)
    const ttlFor = (body: { metas: unknown[] } | null) =>
      body?.metas?.length ? CATALOG_TTL_MS : CATALOG_EMPTY_TTL_MS

    vi.setSystemTime(T0 + 59 * 1000)
    const reader = await importCache()
    expect(
      await reader.cacheGetShared("cat:kv:noslide-empty", ["stremio", "catalog"], ttlFor),
    ).toEqual({ metas: [] })
    expect(kvMock.set).toHaveBeenCalledTimes(1)

    vi.setSystemTime(T0 + 61 * 1000)
    expect(reader.cacheGet("cat:kv:noslide-empty")).toBeNull()
  })

  it("KV → L1: payload legacy senza envelope resta leggibile e non riscrive la KV", async () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io"
    process.env.KV_REST_API_TOKEN = "test-token"
    vi.setSystemTime(T0)
    // Entry scritta prima dell'envelope: solo dati grezzi, nessun metadato.
    kvMock.get.mockResolvedValue(JSON.stringify(nonEmptyBody()))
    const reader = await importCache()
    const ttlFor = (body: { metas: unknown[] } | null) =>
      body?.metas?.length ? CATALOG_TTL_MS : CATALOG_EMPTY_TTL_MS
    expect(
      await reader.cacheGetShared("cat:kv:legacy", ["stremio", "catalog"], ttlFor),
    ).toEqual(nonEmptyBody())
    expect(kvMock.set).not.toHaveBeenCalled()
  })
})
