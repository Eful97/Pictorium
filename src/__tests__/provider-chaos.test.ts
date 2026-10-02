// Chaos test provider resilience: interazione Slot Limiter ↔ Timeout Interno
// ↔ Race Metadati ↔ Breaker ↔ Sharp Render, con fault iniettati per upstream.
//
// A differenza degli *-breaker.test.ts (matematica dei contatori in provetta),
// qui gira la pipeline REALE (route poster + provider reali) con fetch globale
// stubbato da un router per host. Timer reali + default di produzione: niente
// shrinking via env (fragile, tranne WIKIDATA_TIMEOUT che è letto per-request),
// fault immediati per il counting, UN hang reale per provider per il bound.
// Timeout per-test 30s, durata attesa ~35s totali.
//
// Harness: ramo non-mappato (getById → null), TMDB canned con poster in lingua
// (niente logo → niente best-fit), api_key=test in query (esclusa dal cache
// key), id TMDB distinti per request (cold garantito, niente hit di cache).

import sharp from "sharp"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { request as undiciRequest } from "undici"
import { GET as posterGET } from "@/app/api/poster/[type]/[id]/route"
import { GET as seasonTypesGET } from "@/app/api/tvdb/[id]/seasonTypes/route"
import { cacheClear } from "@/lib/cache"
import { __resetTMDBSessionCache } from "@/lib/tmdb-session-cache"
import { __resetPosterRenderLimiter, getPosterStats } from "@/lib/poster-runtime-cache"
import { __resetMdblistBreaker } from "@/lib/ratings"
import { __resetJWRankingsCache } from "@/lib/justwatch"
import { __resetCircuitBreaker } from "@/lib/awards"
import { clearTvdbCache } from "@/lib/tvdb"

vi.mock("undici", () => ({ Agent: class {}, request: vi.fn() }))

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, retAfter: 0 })),
  rateLimitKey: vi.fn(() => "test"),
  rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}))

vi.mock("@/lib/store", () => ({
  getAll: vi.fn(async () => []),
  getById: vi.fn(async () => null),
  upsert: vi.fn(),
  getImdbAlias: vi.fn(async () => null),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({
    defaultLogoFitEnabled: true,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    region: "IT",
    badgeQuality: false,
    preRelease: false,
  }))
  return {
    ...mod,
    getServerDefaults: mocked,
    getServerDefaultsChecked: vi.fn(async () => mocked()),
  }
})

type Fault = "hang" | "reject" | { status: number; retryAfter?: string }

interface FaultSet {
  mdblist?: Fault
  justwatch?: Fault
  wikidata?: Fault
  tvdb?: Fault
}

const faults: FaultSet = {}
const calls = { mdblist: 0, justwatch: 0, wikidata: 0, tmdb: 0, images: 0, tvdb: 0 }

function hangUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_, rej) => {
    const err = () => rej(new DOMException("aborted", "AbortError"))
    if (!signal) return // senza signal pende per sempre (solo dove serve)
    if (signal.aborted) err()
    else signal.addEventListener("abort", err, { once: true })
  })
}

function statusRes(status: number, retryAfter?: string): Response {
  return {
    ok: false,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? retryAfter ?? null : null) },
    json: async () => ({}),
  } as unknown as Response
}

// Ritorna null quando il provider è sano (il chiamante risponde col default).
function applyFault(fault: Fault | undefined, signal?: AbortSignal): Response | Promise<never> | null {
  if (fault === undefined) return null
  if (fault === "hang") return hangUntilAbort(signal)
  if (fault === "reject") throw new Error("upstream down")
  return statusRes(fault.status, fault.retryAfter)
}

let posterPng: Buffer

function tmdbDetails(id: number) {
  return {
    id,
    title: `Film ${id}`,
    original_language: "en",
    genres: [{ id: 28, name: "Action" }],
    vote_average: 7.5,
    vote_count: 100,
    status: "Released",
    release_date: "2020-01-01",
    backdrop_path: null,
    networks: [],
    production_companies: [],
    // F5a: il path poster usa details+external_ids in un colpo solo — il vero
    // TMDB con append_to_response li include sempre (come il mock e2e).
    external_ids: { imdb_id: `tt${id}`, tvdb_id: null },
  }
}

function tmdbImages(id: number) {
  return {
    posters: [{ file_path: `/p${id}.jpg`, iso_639_1: "en", width: 500, height: 750 }],
    logos: [],
    backdrops: [],
  }
}

async function router(input: unknown, init?: { signal?: AbortSignal }): Promise<Response> {
  const url = String(input)
  const signal = init?.signal
  if (url.includes("mdblist.com/api")) {
    calls.mdblist++
    const r = applyFault(faults.mdblist, signal)
    if (r) return r as Response
    return Response.json({ ratings: [{ source: "imdb", value: 8.0 }] })
  }
  if (url.includes("mdblist")) {
    return Response.json([]) // liste anime: fuori chart → rank null
  }
  if (url.includes("justwatch") || url.includes("graphql")) {
    calls.justwatch++
    const r = applyFault(faults.justwatch, signal)
    if (r) return r as Response
    return Response.json({ data: { streamingCharts: { edges: [] } } })
  }
  if (url.includes("sparql") || url.includes("wikidata")) {
    calls.wikidata++
    const r = applyFault(faults.wikidata, signal)
    if (r) return r as Response
    return Response.json({ results: { bindings: [] } })
  }
  if (url.includes("api4.thetvdb.com")) {
    calls.tvdb++
    const r = applyFault(faults.tvdb, signal)
    if (r) return r as Response
    throw new Error("chaos router: tvdb senza fault configurato")
  }
  if (url.includes("image.tmdb.org")) {
    calls.images++
    return new Response(new Uint8Array(posterPng), {
      status: 200,
      headers: { "content-type": "image/png" },
    })
  }
  if (url.includes("/external_ids")) {
    calls.tmdb++
    const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
    return Response.json({ id: Number(m?.[1] ?? 0), imdb_id: `tt${m?.[1] ?? "1000000"}` })
  }
  if (url.includes("/images")) {
    calls.tmdb++
    const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
    return Response.json({ id: Number(m?.[1] ?? 0), ...tmdbImages(Number(m?.[1] ?? 0)) })
  }
  if (url.includes("/keywords")) {
    calls.tmdb++
    const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
    return Response.json({ id: Number(m?.[1] ?? 0), keywords: [] })
  }
  if (/\/3\/(?:movie|tv)\/\d+/.test(url)) {
    calls.tmdb++
    const m = /\/3\/(?:movie|tv)\/(\d+)/.exec(url)
    return Response.json(tmdbDetails(Number(m?.[1] ?? 0)))
  }
  throw new Error(`chaos router: URL non gestito ${url.slice(0, 120)}`)
}

async function getPoster(id: number) {
  const t0 = Date.now()
  const res = await posterGET(
    new NextRequest(`http://localhost:3000/api/poster/movie/${id}?api_key=test`),
    { params: Promise.resolve({ type: "movie", id: String(id) }) },
  )
  await res.arrayBuffer().catch(() => {})
  return { res, ms: Date.now() - t0 }
}

function resetAll() {
  cacheClear()
  __resetTMDBSessionCache()
  __resetPosterRenderLimiter()
  __resetMdblistBreaker()
  __resetJWRankingsCache()
  __resetCircuitBreaker()
  clearTvdbCache()
  faults.mdblist = undefined
  faults.justwatch = undefined
  faults.wikidata = undefined
  faults.tvdb = undefined
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k] = 0
}

describe("provider chaos (slot ↔ timeout ↔ race ↔ breaker ↔ render)", () => {
  beforeAll(async () => {
    posterPng = await sharp({
      create: { width: 500, height: 750, channels: 4, background: "#202040" },
    })
      .png()
      .toBuffer()
  })

  beforeEach(() => {
    resetAll()
    vi.spyOn(globalThis, "fetch").mockImplementation(router as typeof fetch)
    vi.mocked(undiciRequest).mockReset()
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    resetAll()
  })

  it("S1 MDBList hang → poster 200 boundato; poi 3 reject aprono, 4ª short-circuit", { timeout: 30000 }, async () => {
    // Bound: hang reale, race RATING_WAIT_MS 1500 + render.
    faults.mdblist = "hang"
    const first = await getPoster(610101)
    expect(first.res.status).toBe(200)
    expect(first.ms).toBeLessThan(5000)
    expect(getPosterStats().activeRenders).toBe(0)

    // Counting deterministico (il record dell'hang dipende dal tiebreak dei
    // timer a 1500ms, quindi si azzera e si conta con reject immediati).
    __resetMdblistBreaker()
    faults.mdblist = "reject"
    for (const id of [610102, 610103, 610104]) {
      expect((await getPoster(id)).res.status).toBe(200)
    }
    expect(calls.mdblist).toBeGreaterThanOrEqual(3)

    const before = calls.mdblist
    const fourth = await getPoster(610105)
    expect(fourth.res.status).toBe(200)
    expect(calls.mdblist).toBe(before) // short-circuit: 0 fetch
    expect(fourth.ms).toBeLessThan(3000)
    expect(getPosterStats().activeRenders).toBe(0)
  })

  it("S2 MDBList 429+60 → fallback immediato, finestra 60s", { timeout: 30000 }, async () => {
    faults.mdblist = { status: 429, retryAfter: "60" }
    for (const id of [610201, 610202, 610203]) {
      expect((await getPoster(id)).res.status).toBe(200)
    }
    expect(calls.mdblist).toBe(3)

    const fourth = await getPoster(610204)
    expect(fourth.res.status).toBe(200)
    expect(calls.mdblist).toBe(3) // ancora in finestra: 0 fetch
    expect(getPosterStats().activeRenders).toBe(0)
  })

  it("S3 JustWatch 403 → trip istantaneo, niente rank, niente crash", { timeout: 30000 }, async () => {
    faults.justwatch = { status: 403 }
    const first = await getPoster(610301)
    expect(first.res.status).toBe(200)
    expect(calls.justwatch).toBe(1)
    expect(getPosterStats().activeRenders).toBe(0)

    const second = await getPoster(610302)
    expect(second.res.status).toBe(200)
    expect(calls.justwatch).toBe(1) // trip(300s): 0 fetch
    expect(getPosterStats().activeRenders).toBe(0)
  })

  it("S4 Wikidata hang ×5 veloci (wdAbort uccide gli zombie), poi short-circuit", { timeout: 30000 }, async () => {
    vi.stubEnv("WIKIDATA_TIMEOUT", "300")
    faults.wikidata = "hang"
    // Senza il wdAbort post-race, dalla 3ª request gli slot awards (max 2)
    // sarebbero occupati dagli zombie da 5s e la latenza esploderebbe.
    for (const id of [610401, 610402, 610403, 610404, 610405]) {
      const r = await getPoster(id)
      expect(r.res.status).toBe(200)
      expect(r.ms).toBeLessThan(2500)
    }
    // I record viaggiano sul retry in background: settle prima del check.
    await new Promise((r) => setTimeout(r, 1500))
    // 5 × (attempt + retry) = 10 fetch: OGNI request ha tentato davvero.
    // Senza wdAbort il limiter awards (max 2) strangolava le request 3-5 con
    // gli zombie da 5s e il conteggio restava a 2 — 0 fetch osservato per
    // coda, non per breaker aperto (falso positivo).
    expect(calls.wikidata).toBe(10)
    const before = calls.wikidata
    const sixth = await getPoster(610406)
    expect(sixth.res.status).toBe(200)
    expect(calls.wikidata).toBe(before) // breaker aperto: 0 fetch
    expect(getPosterStats().activeRenders).toBe(0)
  })

  it("S5 custom rating hang → bound 1500ms, fail-open [], slot libero", { timeout: 30000 }, async () => {
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENABLED", "true")
    vi.stubEnv("PICTORIUM_CUSTOM_RATING_ENDPOINT", "https://example.com/{imdbId}")
    const mocked = vi.mocked(undiciRequest)

    // (a) refused → fail-open immediato.
    mocked.mockRejectedValueOnce(new Error("refused"))
    expect((await getPoster(610501)).res.status).toBe(200)
    expect(mocked).toHaveBeenCalledTimes(1)
    expect(getPosterStats().activeRenders).toBe(0)

    // (b) hang → abort interno a 1500ms, poster 200 boundato.
    mocked.mockImplementationOnce((_url, opts) =>
      hangUntilAbort((opts as { signal?: AbortSignal } | undefined)?.signal),
    )
    const slow = await getPoster(610502)
    expect(slow.res.status).toBe(200)
    expect(slow.ms).toBeLessThan(4000)
    expect(mocked).toHaveBeenCalledTimes(2)
    expect(getPosterStats().activeRenders).toBe(0)
  })

  it("S6 TVDB hang → seasonTypes 200 fallback, boundato; poi 0 fetch in cooldown", { timeout: 30000 }, async () => {
    const getTypes = async (tt: string) => {
      const t0 = Date.now()
      const res = await seasonTypesGET(
        new NextRequest(`http://localhost:3000/api/tvdb/${tt}/seasonTypes?tvdb_key=K`),
        { params: Promise.resolve({ id: tt }) },
      )
      const body = (await res.json()) as { results: unknown[]; error?: string }
      return { status: res.status, body, ms: Date.now() - t0 }
    }

    // Hang: login 5s (default) ×2 (seriesId + diagnostica) → fallback [].
    faults.tvdb = "hang"
    const first = await getTypes("tt7101011")
    expect(first.status).toBe(200)
    expect(first.body.results).toEqual([])
    expect(first.ms).toBeLessThan(15000)

    // Counting veloce: ogni request fallita = 2 failure (login + diagnostica).
    faults.tvdb = "reject"
    for (const tt of ["tt7101012", "tt7101013"]) {
      const r = await getTypes(tt)
      expect(r.status).toBe(200)
      expect(r.body.results).toEqual([])
    }

    const before = calls.tvdb
    const cooled = await getTypes("tt7101014")
    expect(cooled.status).toBe(200)
    expect(cooled.body.results).toEqual([])
    expect(calls.tvdb).toBe(before) // cooldown 60s: 0 fetch
  })
})
