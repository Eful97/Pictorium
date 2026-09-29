// Test del deadline complessivo del render (F2) e della negative cache (F3).
// Env a module level impostate PRIMA del dynamic import: RENDER_TIMEOUT_MS
// corto (1s), un solo slot, slot-wait di 150ms — così i test sono veloci e
// deterministici senza mockare i timer.
process.env.POSTERIUM_RENDER_TIMEOUT_MS = "2000"
process.env.POSTERIUM_MAX_CONCURRENT_RENDERS = "1"
process.env.POSTERIUM_RENDER_SLOT_WAIT_MS = "500"

import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  return { ...mod, getServerDefaults: vi.fn(() => ({ defaultLogoFitEnabled: true, badgeStyle: "shadow", rankingBadgeStyle: "default" })) }
})

vi.mock("@/lib/poster-auto-fit", () => ({
  selectBestLogoFitPosterPath: vi.fn(async () => ({ posterPath: "/best-fit.jpg" })),
}))

vi.mock("@/lib/svg-badge", () => ({
  renderGenreBadge: vi.fn(async () => null),
  renderRankingBadge: vi.fn(async () => null),
  renderExtraBadge: vi.fn(async () => null),
  renderQualityBadge: vi.fn(async () => null),
}))

vi.mock("@/lib/justwatch", () => ({
  getJWRankings: vi.fn(async () => []),
  getJWTitleQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/stream-quality", () => ({
  resolveStreamQuality: vi.fn(async () => null),
}))

vi.mock("@/lib/awards", () => ({
  fetchAllWikidata: vi.fn(async () => ({ awards: [], nominations: [], studios: [], director: null })),
  getAwardBadgeLabel: vi.fn(),
  getNominationBadgeLabel: vi.fn(),
  matchTMDBStudios: vi.fn(() => []),
  matchDirectorName: vi.fn((name: string | null) => name),
  directorBadgeLabel: vi.fn((name: string | null) => name),
  // La route lo importa davvero: senza, la chain wikidataId lancia TypeError.
  isValidWikidataQid: (v: unknown): v is string => typeof v === "string" && /^Q\d+$/.test(v),
}))

vi.mock("@/lib/mdblist", () => ({
  fetchMDBList: vi.fn(async () => []),
}))

vi.mock("@/lib/ratings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ratings")>()
  return {
    ...actual,
    fetchAggregatedRating: vi.fn(async () => null),
  }
})

vi.mock("@/lib/tmdb", () => ({
  getDetails: vi.fn(async () => ({ id: 42, title: "Test", genres: [], vote_average: 0, vote_count: 0 })),
  getDetailsWithExternalIds: vi.fn(async () => ({ id: 42, title: "Test", genres: [], vote_average: 0, vote_count: 0, external_ids: { imdb_id: null, tvdb_id: null } })),
  getImages: vi.fn(async () => ({ id: 42, backdrops: [], posters: [], logos: [] })),
  getExternalIds: vi.fn(async () => ({ imdb_id: null })),
  getKeywords: vi.fn(async () => []),
  resolveRequestApiKey: vi.fn(() => undefined),
  // La route risolve le chiavi via resolveUserApiKeys (namespace incluso):
  // mock fedele = nessuna chiave in questo test.
  resolveUserApiKeys: vi.fn(async () => ({
    tmdb: { key: undefined, source: "none" },
    mdblist: { key: undefined, source: "none" },
    tvdb: { key: undefined, source: "none" },
  })),
}))

vi.mock("@/lib/imdb-resolver", () => ({
  resolveImdbToTmdb: vi.fn(async () => null),
}))

// NB: import dinamici DOPO l'impostazione delle env a module level — i moduli
// leggono le env all'evaluazione, e gli import statici sarebbero hoisted sopra
// le assignment.
const { GET } = await import("@/app/api/poster/[type]/[id]/route")
const { acquirePosterRenderSlot, __resetPosterRenderLimiter } = await import("@/lib/poster-runtime-cache")
const { getById } = await import("@/lib/store")
const mockedGetById = vi.mocked(getById)

const MAPPED = {
  tmdbId: 42,
  mediaType: "movie",
  title: "Hung",
  posterPath: "/poster.jpg",
  logoPath: null,
  originalPosterPath: null,
  language: "it",
  updatedAt: "2026-07-16T10:15:30.000Z",
}

// fetch che pende finché il signal non abbatte: simula upstream degradato su
// cui il deadline del render deve intervenire.
function hangingFetch() {
  vi.spyOn(globalThis, "fetch").mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      ;(init?.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"))
      }, { once: true })
    })
  })
}

function req(id: number): NextRequest {
  return new NextRequest(`http://localhost:3000/api/poster/movie/${id}`)
}

describe("render deadline watchdog (F2)", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    __resetPosterRenderLimiter()
    __resetTMDBSessionCache()
    cacheClear()
  })

  it("releases the slot and inflight map when a render hangs past the deadline", async () => {
    mockedGetById.mockResolvedValue(MAPPED as never)
    hangingFetch()

    const started = Date.now()
    const res = await GET(req(42), { params: Promise.resolve({ type: "movie", id: "42" }) })
    const elapsed = Date.now() - started

    // Il render appeso termina per forza del watchdog (fetch → null). NIENTE
    // 404: il titolo esiste, è solo lento/upstream degradato → 503 (fix H3).
    expect(res.status).toBe(503)
    expect(elapsed).toBeLessThan(5000)

    // Lo slot è stato rilasciato: una nuova acquisizione è immediata.
    const release = await acquirePosterRenderSlot()
    expect(release).toBeTruthy()
    release!()
  })

  it("answers 503 with Retry-After while the only slot is busy, and negative-caches it", async () => {
    mockedGetById.mockResolvedValue(MAPPED as never)
    hangingFetch()

    // La prima richiesta occupa l'unico slot (render appeso fino al deadline).
    const p1 = GET(req(42), { params: Promise.resolve({ type: "movie", id: "42" }) })
    await new Promise((r) => setTimeout(r, 50))
    expect(await acquirePosterRenderSlot()).toBeNull()

    // La seconda richiesta su un titolo diverso: attende RENDER_SLOT_WAIT_MS
    // poi 503 con Retry-After esplicito (F5).
    const res2 = await GET(req(43), { params: Promise.resolve({ type: "movie", id: "43" }) })
    expect(res2.status).toBe(503)
    expect(res2.headers.get("Retry-After")).toBeTruthy()

    const res1 = await p1
    // Deadline sforato → 503 (non 404: fix H3).
    expect(res1.status).toBe(503)
  })

  it("serves the negative cache immediately for a recently failed cache key (F3)", async () => {
    mockedGetById.mockResolvedValue(MAPPED as never)
    hangingFetch()

    // Occupa lo slot, forza un 503 → writePosterError scrive la negative cache.
    const p1 = GET(req(42), { params: Promise.resolve({ type: "movie", id: "42" }) })
    await new Promise((r) => setTimeout(r, 50))
    await GET(req(43), { params: Promise.resolve({ type: "movie", id: "43" }) })

    // Rilascio lo slot (finisce il render appeso) così la negative cache è la
    // sola ragione del 503 immediato.
    await p1
    __resetPosterRenderLimiter()

    // Terza richiesta sulla stessa cache key di 43: risponde 503 senza passare
    // dall'acquisizione slot (il test non va in timeout da 150ms).
    const started = Date.now()
    const res = await GET(req(43), { params: Promise.resolve({ type: "movie", id: "43" }) })
    const elapsed = Date.now() - started
    expect(res.status).toBe(503)
    expect(res.headers.get("Retry-After")).toBeTruthy()
    expect(elapsed).toBeLessThan(120)
  })
})
