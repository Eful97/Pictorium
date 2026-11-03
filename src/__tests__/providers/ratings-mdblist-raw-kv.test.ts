import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock di @/lib/upstash-kv-client: vi.mock è hoisted, i moduli vengono reimportati
// per-fase con vi.resetModules (stesso pattern di cache-kv.test.ts). Il
// backing Map simula la KV condivisa tra istanze/restart.
//
// NOTA INFRA (evidenza durante il task): le import dinamiche CONCORRENTI di
// un modulo mockato corrono il mock-registry — solo una vince il mock, le
// altre cadono sul client reale (fail-open con retry). Il write-through
// produzione è fire-and-forget, quindi due scritture concorrenti perdono il
// mock in modo non deterministico. Qui le fasi sono strettamente seriali con
// flush tra una KV-op e l'altra, e la selezione è tmdb+imdb con direct vote
// (ramo familyDirectOnly: la base con voto diretto non si congela mai in
// aggregata) così c'è una sola write-through (grezza) per upstream: ogni
// KV-op è sole-in-flight e il mock è deterministico.
const kvBacking = vi.hoisted(() => new Map<string, string>())
const kvMock = {
  get: vi.fn(async (key: string): Promise<string | null> => kvBacking.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown): Promise<string> => {
    kvBacking.set(key, typeof value === "string" ? value : JSON.stringify(value))
    return "OK"
  }),
}
vi.mock("@/lib/upstash-kv-client", () => ({ kv: kvMock }))

const OLD_MOVIE = {
  type: "movie",
  released: "2015-06-01",
  ratings: [{ source: "imdb", value: 87, score: 87 }],
}
const NO_TIMING = {
  ratings: [{ source: "imdb", value: 72, score: 72 }],
}

function okRatings(body: unknown) {
  return { ok: true, json: async () => body }
}

function notFound() {
  return { ok: false, status: 404, headers: { get: () => null } }
}

function mdblistFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    // Qualunque uso del client KV reale (perso il mock-race) fallisce forte:
    // in questo file ogni KV-op è sole-in-flight e deve restare sul mock.
    if (url.includes("upstash.io")) throw new Error(`real KV client leaked: ${url}`)
    if (url.includes("mdblist.com")) {
      if (url.includes("tt_kv_old")) return okRatings(OLD_MOVIE)
      if (url.includes("tt_kv_new")) return okRatings(NO_TIMING)
      if (url.includes("tt_kv_miss")) return notFound()
      return { ok: false, status: 503, headers: { get: () => null } }
    }
    // Cinemeta (sidecar gratuito del ramo familyDirectOnly): sempre miss.
    if (url.includes("cinemeta")) return notFound()
    throw new Error(`unexpected upstream ${url}`)
  })
}

function mdblistCalls(mock: ReturnType<typeof vi.fn>): number {
  return mock.mock.calls.filter(([input]) => String(input).includes("mdblist.com")).length
}

/** Solo le scritture KV della cache grezza (non le aggregate per-selezione). */
function rawKvSets(): Array<{ key: string; envelope: string; ex: number }> {
  const calls = kvMock.set.mock.calls as Array<[key: unknown, value: unknown, opts?: { ex?: number }]>
  return calls
    .filter(([key]) => String(key).startsWith("pictorium:cache:mdb:raw:"))
    .map(([key, value, opts]) => ({ key: String(key), envelope: String(value), ex: opts?.ex ?? 0 }))
}

async function importRatings() {
  vi.resetModules()
  return await import("@/lib/ratings")
}

/** Flush dei write-through fire-and-forget fino a N scritture grezze mock. */
async function flushRawSets(n: number): Promise<void> {
  for (let i = 0; i < 200 && rawKvSets().length < n; i += 1) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

const API_KEY = "secret-key-123"
// tmdb diretto + imdb (senza fonti MDBList-exclusive): ramo familyDirectOnly
// con Cinemeta primario (stub 404) + fallback MDBList; la base con voto
// diretto non si congela mai in aggregata → una sola write-through (grezza).
const SEL = { requestedSources: ["tmdb", "imdb"], ratingWaitMs: 2000, tmdbFallbackVote: 8.0 } as const
// Senza voto diretto: miss/errori restano null (gap-fill tmdb disattivato).
const SEL_NODIRECT = { requestedSources: ["imdb"], ratingWaitMs: 2000 } as const

beforeEach(() => {
  kvBacking.clear()
  vi.clearAllMocks()
  process.env.KV_REST_API_URL = "https://example.upstash.io"
  process.env.KV_REST_API_TOKEN = "test-token"
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  kvBacking.clear()
  vi.resetModules()
})

describe("MDBList raw KV persistence (task 2)", () => {
  it("write-through con envelope TTL assoluto, idratazione al restart senza refetch", async () => {
    const first = await importRatings()
    first.__resetMdblistBreaker()
    const fetchMock = mdblistFetch()
    vi.stubGlobal("fetch", fetchMock)

    const rOld = await first.fetchAggregatedRating("tt_kv_old", API_KEY, undefined, SEL)
    expect(rOld?.sources.imdb).toBe(8.7)
    expect(rOld?.sources.tmdb).toBe(8.0)
    await flushRawSets(1)
    const rNew = await first.fetchAggregatedRating("tt_kv_new", API_KEY, undefined, SEL)
    expect(rNew?.sources.imdb).toBe(7.2)
    expect(rNew?.sources.tmdb).toBe(8.0)
    await flushRawSets(2)
    // Un upstream MDBList per identità; i metadati temporali vengono dalla
    // risposta esistente, mai da fetch extra a pagamento.
    expect(mdblistCalls(fetchMock)).toBe(2)

    const sets = rawKvSets()
    expect(sets).toHaveLength(2)

    const keyHash = createHash("sha1").update(API_KEY).digest("hex").slice(0, 8)
    for (const s of sets) {
      // Isolamento imdb+hash-chiave, mai plaintext.
      expect(s.key).toContain(keyHash)
      expect(s.key).not.toContain(API_KEY)
      expect(s.envelope).not.toContain(API_KEY)
    }
    const oldSet = sets.find((s) => s.key.includes("tt_kv_old"))!
    const newSet = sets.find((s) => s.key.includes("tt_kv_new"))!
    // Envelope: data payload in `d` (v2 `{ s }` sources wrapper, features
    // optionally under `f`), timestamp+TTL originali, EX coerente.
    expect(JSON.parse(oldSet.envelope).d).toEqual({ s: { imdb: 8.7 } })
    expect(JSON.parse(oldSet.envelope).ttl).toBe(7 * 24 * 60 * 60 * 1000)
    expect(oldSet.ex).toBe(7 * 24 * 60 * 60)
    expect(JSON.parse(newSet.envelope).d).toEqual({ s: { imdb: 7.2 } })
    expect(JSON.parse(newSet.envelope).ttl).toBe(24 * 60 * 60 * 1000)
    expect(newSet.ex).toBe(24 * 60 * 60)

    // Simula il restart: modulo fresco (L1 vuota), stessa KV condivisa.
    const second = await importRatings()
    second.__resetMdblistBreaker()
    fetchMock.mockClear()
    const hOld = await second.fetchAggregatedRating("tt_kv_old", API_KEY, undefined, SEL)
    expect(hOld?.sources.imdb).toBe(8.7)
    expect(hOld?.sources.tmdb).toBe(8.0)
    const hNew = await second.fetchAggregatedRating("tt_kv_new", API_KEY, undefined, SEL)
    expect(hNew?.sources.imdb).toBe(7.2)
    expect(hNew?.sources.tmdb).toBe(8.0)
    // Idratazione da KV: zero upstream MDBList (resta solo il sidecar
    // gratuito Cinemeta, senza chiave e fuori quota MDBList).
    expect(mdblistCalls(fetchMock)).toBe(0)
  })

  it("scadenze assolute preservate: envelope oltre il TTL originale = miss + refetch", async () => {
    const first = await importRatings()
    first.__resetMdblistBreaker()
    const fetchMock = mdblistFetch()
    vi.stubGlobal("fetch", fetchMock)
    await first.fetchAggregatedRating("tt_kv_new", API_KEY, undefined, SEL)
    await flushRawSets(1)
    expect(rawKvSets()).toHaveLength(1)
    const rawKvKey = rawKvSets()[0].key
    const parsed = JSON.parse(rawKvSets()[0].envelope)

    // Envelope invecchiato oltre i 24h originali: al restart è miss.
    kvBacking.set(rawKvKey, JSON.stringify({ ...parsed, t: Date.now() - 25 * 60 * 60 * 1000 }))

    const second = await importRatings()
    second.__resetMdblistBreaker()
    fetchMock.mockClear()
    expect((await second.fetchAggregatedRating("tt_kv_new", API_KEY, undefined, SEL))?.sources.imdb).toBe(7.2)
    // Scaduto assoluto: niente sliding, di nuovo upstream.
    expect(mdblistCalls(fetchMock)).toBe(1)
    await flushRawSets(2)

    // Envelope ancora dentro i 24h originali: hit senza refetch.
    kvBacking.set(rawKvKey, JSON.stringify({ ...parsed, t: Date.now() - 23 * 60 * 60 * 1000 }))
    const third = await importRatings()
    third.__resetMdblistBreaker()
    fetchMock.mockClear()
    expect((await third.fetchAggregatedRating("tt_kv_new", API_KEY, undefined, SEL))?.sources.imdb).toBe(7.2)
    expect(mdblistCalls(fetchMock)).toBe(0)
  })

  it("miss genuini ed errori non raggiungono mai la KV", async () => {
    const mod = await importRatings()
    mod.__resetMdblistBreaker()
    const fetchMock = mdblistFetch()
    vi.stubGlobal("fetch", fetchMock)

    expect(await mod.fetchAggregatedRating("tt_kv_miss", API_KEY, undefined, SEL_NODIRECT)).toBeNull()
    expect(await mod.fetchAggregatedRating("tt_kv_err", API_KEY, undefined, SEL_NODIRECT)).toBeNull()
    expect(await mod.fetchAggregatedRating("tt_kv_err", API_KEY, undefined, SEL_NODIRECT)).toBeNull()
    expect(mdblistCalls(fetchMock)).toBe(3)
    await new Promise((r) => setTimeout(r, 50))
    expect(rawKvSets()).toHaveLength(0)
    expect(kvMock.set).not.toHaveBeenCalled()
  })
})
