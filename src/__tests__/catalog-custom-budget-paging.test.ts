import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET } from "@/app/catalog/[type]/[id]/route"
import { cacheClear, cacheInvalidate } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache } from "@/lib/imdb-cache"
import { encodeConfig } from "@/lib/config-token"
import { getById } from "@/lib/store"
import { fetchCustomMDBList } from "@/lib/mdblist"
import { fetchUnifiedCatalogResult } from "@/lib/custom-catalog-providers"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

const mockedGetById = vi.mocked(getById)

interface MockItem {
  tmdb?: number
  imdb?: string
  title: string
  year?: number
  mediatype?: string
}

interface RouterOptions {
  mdblistItems: MockItem[]
  /** imdb -> tmdb for /find */
  findMap?: Record<string, number>
  /** tmdb -> { title, genres } for /details */
  detailsMap?: Record<number, { title: string; genres: string[] }>
  /** imdb_id returned by /external_ids per tmdb id */
  externalMap?: Record<number, string | null>
  hangProvider?: boolean
  hangFind?: boolean
  hangEnrich?: boolean
  counters?: { provider: number; find: number; details: number; enrich: number }
}

function hangingPromise(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal as AbortSignal | undefined
    if (!signal) return // never resolves: caller must pass a signal
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"))
      return
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("The operation was aborted", "AbortError")),
      { once: true },
    )
  })
}

/**
 * Routes every outbound fetch by URL: MDBList custom list, TMDB /find,
 * /details, /external_ids and /images. Anything else 404s (fail-closed:
 * unrouted calls surface instead of hanging the suite).
 */
function mockRouter(opts: RouterOptions): void {
  const counters = opts.counters ?? { provider: 0, find: 0, details: 0, enrich: 0 }
  if (!opts.counters) {
    // keep a stable reference even when the caller omits counters
  }
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    if (u.includes("/lists/custom/")) {
      counters.provider++
      if (opts.hangProvider) return hangingPromise(init)
      return Response.json({ items: opts.mdblistItems })
    }
    if (u.includes("/external_ids") || u.includes("/images")) {
      counters.enrich++
      if (opts.hangEnrich) return hangingPromise(init)
      const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
      const id = Number(m?.[1] ?? m?.[2] ?? 0)
      if (u.includes("/external_ids")) {
        return Response.json({ id, imdb_id: opts.externalMap?.[id] ?? null })
      }
      return Response.json({ id, backdrops: [], posters: [], logos: [] })
    }
    if (u.includes("/find/")) {
      counters.find++
      if (opts.hangFind) return hangingPromise(init)
      const m = u.match(/\/find\/([^?]+)/)
      const imdb = m ? decodeURIComponent(m[1]) : ""
      const id = opts.findMap?.[imdb]
      return Response.json(
        id
          ? { movie_results: [{ id }], tv_results: [] }
          : { movie_results: [], tv_results: [] },
      )
    }
    if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
      counters.details++
      const m = u.match(/\/(?:movie|tv)\/(\d+)/)
      const id = Number(m?.[1] ?? 0)
      const known = opts.detailsMap?.[id]
      return Response.json({
        id,
        title: known?.title ?? `Title ${id}`,
        name: known?.title ?? `Title ${id}`,
        genres: (known?.genres ?? []).map((name, i) => ({ id: 1000 + i, name })),
        vote_average: 7.5,
        vote_count: 100,
        release_date: "2024-01-01",
        backdrop_path: null,
        overview: `Overview ${id}`,
      })
    }
    return Response.json({}, { status: 404 })
  })
  ;(mockRouter as unknown as { lastCounters?: unknown }).lastCounters = counters
}

function customToken(cid: string, url: string, type: "movie" | "series" | "mixed" = "movie"): string {
  return encodeConfig({
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "pill",
    rankingBadgeStyle: "pill",
    blurEnabled: true,
    blurIntensity: 12,
    blurFade: 45,
    blurDarkness: 55,
    gradientHeight: 50,
    networkLogo: true,
    autoRotateClean: false,
    customCatalogs: [
      { id: cid, name: `Budget ${cid}`, type, url, enabled: true },
    ],
  })
}

function mdblistToken(cid: string, slug: string, type: "movie" | "series" | "mixed" = "movie"): string {
  return customToken(cid, `https://mdblist.com/lists/u/${slug}`, type)
}

function traktToken(cid: string): string {
  return customToken(cid, "https://trakt.tv/users/testuser/lists/testlist")
}

function catalogUrl(cid: string, token: string, extra = ""): string {
  return `http://localhost:3000/catalog/movie/pictorium-custom-movie-${cid}.json?api_key=test-key&config=${token}${extra}`
}

async function getCatalog(cid: string, token: string, extra = "") {
  const req = new NextRequest(catalogUrl(cid, token, extra))
  const res = await GET(req, { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) })
  const body = await res.json()
  return { res, body: body as { metas: Array<{ id: string; name: string; genres?: string[]; logo?: string }> } }
}

// ---------------------------------------------------------------------------
// Deterministic abort/time infra (no fake timers: native AbortSignal.timeout
// is not driven by them). Mirrors meta-request-budget.test.ts.
// ---------------------------------------------------------------------------

interface CallRec {
  url: string
  abortedAtStart: boolean
  sawAbort: boolean
  responded: boolean
}

/**
 * Abort-aware recording fetch mock: "hang" stays pending until the signal
 * fires (rejects + sawAbort = exact cancellation). Immediate responses mark
 * responded BEFORE any later abort (completed work keeps its outcome).
 * Calls with an already-aborted signal reject at once, like a real fetch.
 */
function recordFetch(calls: CallRec[], handler: (url: string) => Response | "hang"): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const sig = init?.signal as AbortSignal | undefined
    const rec: CallRec = {
      url,
      abortedAtStart: !!sig?.aborted,
      sawAbort: !!sig?.aborted,
      responded: false,
    }
    calls.push(rec)
    if (sig?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
    const out = handler(url)
    if (out === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        sig?.addEventListener(
          "abort",
          () => {
            rec.sawAbort = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      })
    }
    rec.responded = true
    if (sig) sig.addEventListener("abort", () => { if (!rec.responded) rec.sawAbort = true }, { once: true })
    return Promise.resolve(out)
  }) as typeof fetch)
}

/**
 * Makes the shared total budget deterministic without waiting it out: the
 * route's requested total (10000ms) maps to manually-fired controllers,
 * every other (per-step/per-fetch) timeout delegates to the real
 * implementation. Firing the captured controller simulates the total timer
 * expiring. NOTE: the mdblist inner provider fetch ALSO requests a 10000ms
 * per-step timeout, so mdblist-path tests see TWO 10000s ([0] = root shared
 * budget, [1] = inner); trakt-path tests see EXACTLY ONE (the root).
 */
function controllableTotalTimeout(totalMs = 10000) {
  const requestedMs: number[] = []
  const totalControllers: AbortController[] = []
  const realTimeout = AbortSignal.timeout.bind(AbortSignal)
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    ((ms: number) => {
      requestedMs.push(ms)
      if (ms === totalMs) {
        const ctrl = new AbortController()
        totalControllers.push(ctrl)
        return ctrl.signal
      }
      return realTimeout(ms)
    }) as typeof AbortSignal.timeout,
  )
  return { requestedMs, totalControllers }
}

/** Mocked clock for TTL expiry (cache + TMDB layers run on Date.now). */
let now = 0
function mockNow(base = 1_750_000_000_000): void {
  now = base
  vi.spyOn(Date, "now").mockImplementation(() => now)
}

function traktPayload(count: number, firstTmdb: number, imdbBase = 8000000): Array<unknown> {
  return Array.from({ length: count }, (_, i) => {
    const tmdb = firstTmdb + i
    return {
      type: "movie",
      movie: { ids: { imdb: `tt${imdbBase + tmdb}`, tmdb }, title: `Trakt ${tmdb}`, year: 2024 },
    }
  })
}

beforeEach(() => {
  mockedGetById.mockResolvedValue(null)
  vi.stubEnv("MDBLIST_API_URL", "https://mdblist-mock.test")
})

afterEach(() => {
  vi.restoreAllMocks()
  mockedGetById.mockReset()
  cacheClear()
  cacheInvalidate("custom_catalogs")
  cacheInvalidate("mdblist")
  __clearTMDBCache()
  __clearImdbCache()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("custom catalog stable pagination (global dedup before skip)", () => {
  it("raw duplicates/unresolvable rows before the window do not short-change page 1", async () => {
    // 10x dup + 10x bogus-imdb, then 20 valid direct ids.
    // Slicing raw candidates first would resolve ~1 unique row here.
    const mdblistItems: MockItem[] = [
      ...Array.from({ length: 10 }, () => ({ tmdb: 9001, imdb: "tt9000001", title: "Dup" })),
      ...Array.from({ length: 10 }, (_, i) => ({ imdb: `tt99000${i}0`, title: `Bogus ${i}` })),
      ...Array.from({ length: 20 }, (_, i) => ({ tmdb: 9100 + i, title: `Valid ${i}` })),
    ]
    const counters = { provider: 0, find: 0, details: 0, enrich: 0 }
    mockRouter({ mdblistItems, findMap: {}, counters })
    const cid = "budget-page1"
    const token = mdblistToken(cid, "budget-page1")
    const { res, body } = await getCatalog(cid, token)

    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(20)
    expect(body.metas[0].id).toBe("tmdb:9001")
    // The scan walks past the junk and fills the window from later rows.
    expect(body.metas.map((m) => m.id)).toContain("tmdb:9118")
    expect(body.metas.map((m) => m.id)).not.toContain("tmdb:9119")
    // Only the bogus head needed /find calls — the direct-id tail costs none.
    expect(counters.find).toBe(10)
  })

  it("skip=20 page is disjoint from page 1 and never repeats a cross-boundary duplicate", async () => {
    // tmdb:9205 occurs at raw index 5 AND raw index 25 (across the page split).
    const mdblistItems: MockItem[] = Array.from({ length: 45 }, (_, i) => ({
      tmdb: 9200 + i,
      title: `T${9200 + i}`,
    }))
    mdblistItems[25] = { tmdb: 9205, title: "T9205-dup" }
    mockRouter({ mdblistItems })
    const cid = "budget-skip"
    const token = mdblistToken(cid, "budget-skip")

    const page1 = await getCatalog(cid, token)
    const page2 = await getCatalog(cid, token, "&skip=20")
    const ids1 = page1.body.metas.map((m) => m.id)
    const ids2 = page2.body.metas.map((m) => m.id)

    expect(page1.body.metas).toHaveLength(20)
    expect(page2.body.metas).toHaveLength(20)
    expect(ids1).toContain("tmdb:9205")
    expect(ids2).not.toContain("tmdb:9205")
    expect(new Set([...ids1, ...ids2]).size).toBe(40)
    // Later valid rows are not lost when early rows dedupe away.
    expect(ids2).toContain("tmdb:9240")
  })

  it("genre filter resolves the first 100 UNIQUE rows before the tail filter (contract preserved)", async () => {
    // 90 dup rows would eat a raw slice(0,100); the unique window extends past it.
    const mdblistItems: MockItem[] = [
      ...Array.from({ length: 90 }, () => ({ tmdb: 9300, title: "DupDrama" })),
      ...Array.from({ length: 30 }, (_, i) => ({ tmdb: 9350 + i, title: `G${i}` })),
    ]
    const detailsMap: Record<number, { title: string; genres: string[] }> = { 9300: { title: "DupDrama", genres: ["Dramma"] } }
    for (let i = 0; i < 30; i++) {
      detailsMap[9350 + i] = { title: `G${i}`, genres: i % 2 === 0 ? ["Azione"] : ["Dramma"] }
    }
    mockRouter({ mdblistItems, detailsMap })
    const cid = "budget-genre"
    const token = mdblistToken(cid, "budget-genre")

    const { res, body } = await getCatalog(cid, token, "&genre=Azione")
    expect(res.status).toBe(200)
    // 15 even-indexed action rows out of the 30 unique — all survive the tail filter.
    expect(body.metas).toHaveLength(15)
    for (const m of body.metas) {
      expect(m.genres ?? []).toContain("Azione")
    }
    expect(body.metas.map((m) => m.id)).not.toContain("tmdb:9300")
  })

  it("first page of an imdb-only list issues a bounded number of /find calls", async () => {
    const mdblistItems: MockItem[] = Array.from({ length: 60 }, (_, i) => ({
      imdb: `tt91000${String(i).padStart(2, "0")}`,
      title: `ImdbOnly ${i}`,
    }))
    const findMap: Record<string, number> = {}
    for (let i = 0; i < 60; i++) findMap[`tt91000${String(i).padStart(2, "0")}`] = 9500 + i
    const counters = { provider: 0, find: 0, details: 0, enrich: 0 }
    mockRouter({ mdblistItems, findMap, counters })
    const cid = "budget-bounded"
    const token = mdblistToken(cid, "budget-bounded")

    const { body } = await getCatalog(cid, token)
    expect(body.metas).toHaveLength(20)
    // One 20-row stride proves the window — never all 60 (let alone 500).
    expect(counters.find).toBeLessThanOrEqual(25)
    expect(counters.find).toBeGreaterThanOrEqual(20)
  })

  it("mixed lists keep slot filtering (movie catalog hides shows)", async () => {
    const mdblistItems: MockItem[] = [
      { tmdb: 9601, title: "M1", mediatype: "movie" },
      { tmdb: 9602, title: "S1", mediatype: "show" },
      { tmdb: 9603, title: "M2", mediatype: "movie" },
      { tmdb: 9604, title: "S2", mediatype: "tv" },
    ]
    mockRouter({ mdblistItems })
    const cid = "budget-mixed"
    const token = mdblistToken(cid, "budget-mixed", "mixed")
    const { body } = await getCatalog(cid, token)
    // Details titles win over list titles (existing contract); slot
    // filtering is proven by WHICH ids survive.
    expect(body.metas.map((m) => m.id).sort()).toEqual(["tmdb:9601", "tmdb:9603"])
  })
})

describe("custom catalog shared 10s budget", () => {
  it("provider fetches ride the shared signal: an aborted request exits fast on a hanging provider", async () => {
    mockRouter({ mdblistItems: [{ tmdb: 9701, title: "Never" }], hangProvider: true })
    const cid = "budget-abort"
    const token = mdblistToken(cid, "budget-abort")
    const ctrl = new AbortController()
    ctrl.abort()
    const req = new NextRequest(catalogUrl(cid, token), { signal: ctrl.signal })
    const start = Date.now()
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) })
    const body = await res.json()
    expect(Date.now() - start).toBeLessThan(2000)
    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
  }, 15000)

  it("a hanging /find phase hits the shared deadline, serves short-cache, and the retry recovers", async () => {
    mockNow()
    const { requestedMs, totalControllers } = controllableTotalTimeout()
    const calls: CallRec[] = []
    const mdblistItems: MockItem[] = Array.from({ length: 5 }, (_, i) => ({
      imdb: `tt92000${i}`,
      title: `Slow ${i}`,
    }))
    let fired = false
    let countAtFire = 0
    recordFetch(calls, (url) => {
      if (url.includes("/lists/custom/")) return Response.json({ items: mdblistItems })
      if (url.includes("/find/")) {
        // Simulate the 10s total expiring mid-scan: fire the ROOT budget
        // (controllers[0]) on first sight, then hang until it lands.
        if (totalControllers[0] && !fired) {
          fired = true
          countAtFire = requestedMs.filter((ms) => ms === 10000).length
          queueMicrotask(() => totalControllers[0].abort())
        }
        return "hang"
      }
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const cid = "budget-deadline"
    const token = mdblistToken(cid, "budget-deadline")

    const req = new NextRequest(catalogUrl(cid, token))
    const incomingSignal = (req as unknown as { signal?: AbortSignal }).signal
    const start = Date.now()
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) })
    const elapsed = Date.now() - start
    const body = await res.json()

    expect(res.status).toBe(200)
    // Nothing resolved before the deadline: honest empty, never a partial
    // window pretending to be complete.
    expect(body.metas).toEqual([])
    // No real 10s wait: the simulated timer fires in microseconds.
    expect(elapsed).toBeLessThan(5000)
    // Cancellation came only from the total timer, never the client.
    expect(incomingSignal?.aborted).toBe(false)
    expect(fired).toBe(true)
    // Root budget + mdblist inner per-step 10s were both requested up front;
    // the later phases derived from the expired budget instead of a fresh total.
    expect(countAtFire).toBe(2)
    expect(requestedMs.filter((ms) => ms === 10000)).toHaveLength(countAtFire)
    // Exact cancellation: every hanging /find was aborted mid-flight ...
    const finds = calls.filter((c) => c.url.includes("/find/"))
    expect(finds.length).toBeGreaterThan(0)
    for (const f of finds) expect(f.sawAbort).toBe(true)

    // Retry after the 60s short TTL refetches and recovers the full list —
    // WITHOUT clearing any cache manually (clocks only).
    now += 61_000
    vi.restoreAllMocks()
    mockNow(now)
    const findMap: Record<string, number> = {}
    for (let i = 0; i < 5; i++) findMap[`tt92000${i}`] = 9800 + i
    const counters = { provider: 0, find: 0, details: 0, enrich: 0 }
    mockRouter({ mdblistItems, findMap, counters })
    const retry = await GET(
      new NextRequest(catalogUrl(cid, token)),
      { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) },
    )
    const retryBody = await retry.json()
    expect(retryBody.metas).toHaveLength(5)
    // The catalog body recomputed after the short expiry (fresh /find
    // calls) while the healthy provider source cache stayed valid.
    expect(counters.find).toBeGreaterThan(0)
    expect(counters.provider).toBe(0)
  }, 30000)

  it("slow final IMDb/logo enrichment does not hold the page past the shared deadline", async () => {
    mockNow()
    const { requestedMs, totalControllers } = controllableTotalTimeout()
    const calls: CallRec[] = []
    // No imdb on the rows: enrichment must call external_ids + images (both hang).
    const mdblistItems: MockItem[] = [
      { tmdb: 9901, title: "Enrich A" },
      { tmdb: 9902, title: "Enrich B" },
      { tmdb: 9903, title: "Enrich C" },
    ]
    const detailsOf = (id: number): Response =>
      Response.json({
        id,
        title: `Enrich ${String.fromCharCode(64 + (id - 9900))}`,
        name: `Enrich ${String.fromCharCode(64 + (id - 9900))}`,
        genres: [],
        vote_average: 7.5,
        vote_count: 100,
        release_date: "2024-01-01",
        backdrop_path: null,
        overview: `Overview ${id}`,
      })
    let fired = false
    let countAtFire = 0
    recordFetch(calls, (url) => {
      if (url.includes("/lists/custom/")) return Response.json({ items: mdblistItems })
      if (url.includes("/external_ids") || url.includes("/images")) return "hang"
      if (/\/movie\/\d+/.test(url) || /\/tv\/\d+/.test(url)) {
        // Details answer fast; the total then expires before enrichment, so
        // the garnish phase must derive from the same expired budget.
        if (totalControllers[0] && !fired) {
          fired = true
          countAtFire = requestedMs.filter((ms) => ms === 10000).length
          queueMicrotask(() => totalControllers[0].abort())
        }
        const m = url.match(/\/(?:movie|tv)\/(\d+)/)
        return detailsOf(Number(m?.[1] ?? 0))
      }
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const cid = "budget-enrich"
    const token = mdblistToken(cid, "budget-enrich")

    const req = new NextRequest(catalogUrl(cid, token))
    const incomingSignal = (req as unknown as { signal?: AbortSignal }).signal
    const start = Date.now()
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) })
    const elapsed = Date.now() - start
    const body = await res.json()

    // Details were fast: the page is served with list data even though the
    // garnish (IMDb id, logo) timed out at the shared deadline.
    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(3)
    expect(body.metas.map((m: { id: string }) => m.id).sort()).toEqual([
      "tmdb:9901",
      "tmdb:9902",
      "tmdb:9903",
    ])
    expect(body.metas.map((m: { name: string }) => m.name).sort()).toEqual([
      "Enrich A",
      "Enrich B",
      "Enrich C",
    ])
    expect(elapsed).toBeLessThan(5000)
    expect(incomingSignal?.aborted).toBe(false)
    expect(fired).toBe(true)
    expect(countAtFire).toBe(2)
    expect(requestedMs.filter((ms) => ms === 10000)).toHaveLength(countAtFire)
    // Details completed before the expiry and kept their work (the filter
    // excludes the /external_ids + /images garnish URLs, which also match
    // the bare /movie/<id> pattern).
    const isDetailsUrl = (u: string): boolean =>
      (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) && !u.includes("/external_ids") && !u.includes("/images")
    const details = calls.filter((c) => isDetailsUrl(c.url))
    expect(details.length).toBeGreaterThan(0)
    for (const d of details) {
      expect(d.responded).toBe(true)
      expect(d.sawAbort).toBe(false)
    }
    // ... while every enrichment attempt started already-aborted and did no work.
    const enrich = calls.filter((c) => c.url.includes("/external_ids") || c.url.includes("/images"))
    expect(enrich.length).toBeGreaterThan(0)
    for (const e of enrich) {
      expect(e.abortedAtStart).toBe(true)
      expect(e.responded).toBe(false)
    }
  }, 30000)
})

describe("interrupted provider pagination never long-caches (trakt + tmdb list)", () => {
  beforeEach(() => {
    vi.stubEnv("TRAKT_CLIENT_ID", "test-trakt-key")
    vi.stubEnv("TRAKT_API_URL", "https://trakt-mock.test")
  })

  it("trakt abort mid-pagination serves the partial prefix but refetches instead of freezing 30min", async () => {
    const url = "https://trakt.tv/users/testuser/lists/testlist"
    let page1 = 0
    let page2 = 0
    const ctrl = new AbortController()
    let aborted = false
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
      const u = String(input)
      if (u.includes("/users/testuser/lists/testlist/items")) {
        if (u.includes("page=1")) {
          page1++
          return Response.json(traktPayload(100, 7100))
        }
        // Interrupt MID-FLIGHT: the page-2 fetch starts un-aborted, then
        // the signal fires while it is in flight (covers the fetch-error
        // path, not just the loop-top pre-check).
        page2++
        const sig = (init as RequestInit | undefined)?.signal as AbortSignal | undefined
        if (sig?.aborted) throw new DOMException("Aborted", "AbortError")
        if (!aborted) {
          aborted = true
          queueMicrotask(() => ctrl.abort())
        }
        await new Promise<void>((_res, rej) => {
          sig?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")), { once: true })
        })
        throw new DOMException("Aborted", "AbortError")
      }
      return Response.json({}, { status: 404 })
    })

    const first = await fetchUnifiedCatalogResult(url, { signal: ctrl.signal })
    expect(aborted).toBe(true)
    // Partial prefix is servable ...
    expect(first.status).toBe("ok")
    expect(first.items).toHaveLength(100)
    expect(first.incomplete).toBe(true)
    expect(page1).toBe(1)
    // Page 2 was attempted (interruption hit there, not a short list).
    expect(page2).toBe(1)

    // ... but NEVER long-cached: a fresh call refetches (no manual clear).
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/users/testuser/lists/testlist/items")) {
        if (u.includes("page=1")) {
          page1++
          return Response.json(traktPayload(100, 7100))
        }
        page2++
        return Response.json(traktPayload(3, 7200))
      }
      return Response.json({}, { status: 404 })
    })
    const second = await fetchUnifiedCatalogResult(url)
    expect(second.status).toBe("ok")
    expect(second.items).toHaveLength(103)
    expect(second.incomplete).toBeFalsy()
    expect(page1).toBe(2)
    expect(page2).toBe(2)

    // And the healthy result caches normally (no third fetch).
    const third = await fetchUnifiedCatalogResult(url)
    expect(third.items).toHaveLength(103)
    expect(page1).toBe(2)
  }, 15000)

  it("tmdb list page failure serves the landed prefix as incomplete and recovers on retry", async () => {
    const url = "tmdb:list:8249673"
    let calls = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/3/list/8249673")) {
        calls++
        if (u.includes("page=3")) return Response.json({}, { status: 500 })
        if (u.includes("page=2")) {
          return Response.json({
            items: Array.from({ length: 20 }, (_, i) => ({ id: 8200 + i, title: `P2 ${i}`, release_date: "2024-01-01", poster_path: "/p.jpg" })),
          })
        }
        return Response.json({
          total_pages: 3,
          items: Array.from({ length: 20 }, (_, i) => ({ id: 8100 + i, title: `P1 ${i}`, release_date: "2024-01-01", poster_path: "/p.jpg" })),
        })
      }
      return Response.json({}, { status: 404 })
    })

    const first = await fetchUnifiedCatalogResult(url, { apiKey: "k" })
    expect(first.status).toBe("ok")
    // Page 1 (20) + page 2 (20); the failed page 3 contributes nothing.
    expect(first.items).toHaveLength(40)
    expect(first.incomplete).toBe(true)
    const callsAfterFirst = calls

    // Incomplete is not cached: the retry refetches without a manual clear.
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/3/list/8249673")) {
        calls++
        if (u.includes("page=")) {
          const n = Number(u.match(/page=(\d+)/)?.[1] ?? 0)
          return Response.json({
            items: Array.from({ length: 20 }, (_, i) => ({ id: 8100 + (n - 1) * 20 + i, title: `P${n} ${i}`, release_date: "2024-01-01", poster_path: "/p.jpg" })),
          })
        }
        return Response.json({
          total_pages: 3,
          items: Array.from({ length: 20 }, (_, i) => ({ id: 8100 + i, title: `P1 ${i}`, release_date: "2024-01-01", poster_path: "/p.jpg" })),
        })
      }
      return Response.json({}, { status: 404 })
    })
    const second = await fetchUnifiedCatalogResult(url, { apiKey: "k" })
    expect(second.items).toHaveLength(60)
    expect(second.incomplete).toBeFalsy()
    expect(calls).toBeGreaterThan(callsAfterFirst)
  }, 15000)

  it("tmdb v3 paginated page with malformed JSON flags incomplete, keeps landed rows, and recovers on immediate retry", async () => {
    // Correction2: fetchPage did r.json().catch(()=>null) then pick(d) with
    // no shape check, so a malformed page silently looked like a healthy
    // empty tail (incomplete=false, long-cached partial). Page 2 throws in
    // json() (malformed body) and page 3 returns {} (missing items/parts):
    // both must flag incomplete while page-3-independent rows still land.
    const url = "tmdb:list:8249601"
    let calls = 0
    const page = (n: number, base: number) => ({
      items: Array.from({ length: 20 }, (_, i) => ({ id: base + i, title: `P${n} ${i}`, release_date: "2024-01-01", poster_path: "/p.jpg" })),
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/3/list/8249601")) {
        calls++
        if (u.includes("page=2")) {
          return { ok: true, status: 200, json: async () => { throw new Error("bad json") } } as unknown as Response
        }
        if (u.includes("page=3")) {
          return Response.json({ total_pages: 3 })
        }
        return Response.json({ total_pages: 3, ...page(1, 8100) })
      }
      return Response.json({}, { status: 404 })
    })

    const first = await fetchUnifiedCatalogResult(url, { apiKey: "k" })
    expect(first.status).toBe("ok")
    // Page 1 (20) landed; malformed page 2 and shape-less page 3 add nothing
    // but must mark the prefix partial (usable rows retained, no long-cache).
    expect(first.items).toHaveLength(20)
    expect(first.incomplete).toBe(true)
    const callsAfterFirst = calls
    expect(callsAfterFirst).toBeGreaterThanOrEqual(3)

    // Immediate healthy retry WITHOUT manual cache clearing refetches.
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/3/list/8249601")) {
        calls++
        if (u.includes("page=")) {
          const n = Number(u.match(/page=(\d+)/)?.[1] ?? 0)
          return Response.json({ total_pages: 3, ...page(n, 8100 + (n - 1) * 20) })
        }
        return Response.json({ total_pages: 3, ...page(1, 8100) })
      }
      return Response.json({}, { status: 404 })
    })
    const second = await fetchUnifiedCatalogResult(url, { apiKey: "k" })
    expect(second.items).toHaveLength(60)
    expect(second.incomplete).toBeFalsy()
    expect(calls).toBeGreaterThan(callsAfterFirst)
  }, 15000)

  it("tmdb v4 paginated page with malformed JSON flags incomplete and recovers on immediate retry", async () => {
    // Same hole on the v4 path (d?.results || [] with no shape check).
    const url = "tmdb:list:8249602"
    let calls = 0
    const results = (base: number) => ({
      results: Array.from({ length: 20 }, (_, i) => ({ id: base + i, title: `V${base + i}`, release_date: "2024-01-01", poster_path: "/p.jpg" })),
    })
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/3/list/8249602")) {
        calls++
        return Response.json({}, { status: 404 })
      }
      if (u.includes("/4/list/8249602")) {
        calls++
        if (u.includes("page=2")) {
          return { ok: true, status: 200, json: async () => { throw new Error("bad json") } } as unknown as Response
        }
        return Response.json({ total_pages: 2, ...results(8300) })
      }
      return Response.json({}, { status: 404 })
    })

    const first = await fetchUnifiedCatalogResult(url, { apiKey: "k" })
    expect(first.status).toBe("ok")
    expect(first.items).toHaveLength(20)
    expect(first.incomplete).toBe(true)
    const callsAfterFirst = calls

    // Immediate healthy retry WITHOUT manual cache clearing refetches.
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/3/list/8249602")) {
        calls++
        return Response.json({}, { status: 404 })
      }
      if (u.includes("/4/list/8249602")) {
        calls++
        if (u.includes("page=")) {
          const n = Number(u.match(/page=(\d+)/)?.[1] ?? 0)
          return Response.json({ total_pages: 2, ...results(8300 + (n - 1) * 20) })
        }
        return Response.json({ total_pages: 2, ...results(8300) })
      }
      return Response.json({}, { status: 404 })
    })
    const second = await fetchUnifiedCatalogResult(url, { apiKey: "k" })
    expect(second.items).toHaveLength(40)
    expect(second.incomplete).toBeFalsy()
    expect(calls).toBeGreaterThan(callsAfterFirst)
  }, 15000)

  it("trakt page with malformed JSON flags incomplete for the landed prefix and recovers on immediate retry", async () => {
    // Same demonstrated hole: res.json().catch(()=>null) fell through to
    // rawItems=[] + break, freezing the partial prefix as complete. Page 1
    // lands 100 rows, page 2 throws in json(): prefix stays servable but
    // incomplete (never long-cached).
    const url = "https://trakt.tv/users/testuser/lists/badjson-test"
    let page1 = 0
    let page2 = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/users/testuser/lists/badjson-test/items")) {
        if (u.includes("page=1") || !u.includes("page=")) {
          page1++
          return Response.json(traktPayload(100, 7400))
        }
        page2++
        return { ok: true, status: 200, headers: new Headers(), json: async () => { throw new Error("bad json") } } as unknown as Response
      }
      return Response.json({}, { status: 404 })
    })

    const first = await fetchUnifiedCatalogResult(url)
    expect(first.status).toBe("ok")
    expect(first.items).toHaveLength(100)
    expect(first.incomplete).toBe(true)
    expect(page1).toBe(1)
    expect(page2).toBe(1)

    // ... but NEVER long-cached: the immediate healthy retry refetches with
    // no manual cache clearing.
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const u = String(input)
      if (u.includes("/users/testuser/lists/badjson-test/items")) {
        if (u.includes("page=1") || !u.includes("page=")) {
          page1++
          return Response.json(traktPayload(100, 7400))
        }
        page2++
        return Response.json(traktPayload(3, 7500))
      }
      return Response.json({}, { status: 404 })
    })
    const second = await fetchUnifiedCatalogResult(url)
    expect(second.status).toBe("ok")
    expect(second.items).toHaveLength(103)
    expect(second.incomplete).toBeFalsy()
    expect(page1).toBe(2)
    expect(page2).toBe(2)
  }, 15000)
})

describe("transient row failures flag incomplete; confirmed misses do not", () => {
  it("a transient first-/find failure shifts the page, caches short, and the retry corrects it", async () => {
    mockNow()
    // 21 imdb-only rows: the head row fails transiently ONCE (500), every
    // other row (and the retry) resolves. A bogus tail id is a CONFIRMED
    // miss and must not by itself flag anything.
    const rows: MockItem[] = Array.from({ length: 21 }, (_, i) => ({
      imdb: `tt93000${String(i).padStart(2, "0")}`,
      title: `List ${i}`,
    }))
    const findMap: Record<string, number> = {}
    for (let i = 0; i < 21; i++) findMap[`tt93000${String(i).padStart(2, "0")}`] = 9600 + i
    let firstFindAttempts = 0
    const counters = { provider: 0, find: 0, details: 0, enrich: 0 }
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown, _init?: RequestInit) => {
      const u = String(url)
      if (u.includes("/lists/custom/")) {
        counters.provider++
        return Response.json({ items: rows })
      }
      if (u.includes("/external_ids") || u.includes("/images")) {
        counters.enrich++
        const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
        const id = Number(m?.[1] ?? m?.[2] ?? 0)
        if (u.includes("/external_ids")) return Response.json({ id, imdb_id: null })
        return Response.json({ id, backdrops: [], posters: [], logos: [] })
      }
      if (u.includes("/find/")) {
        counters.find++
        const m = u.match(/\/find\/([^?]+)/)
        const imdb = m ? decodeURIComponent(m[1]) : ""
        if (imdb === "tt9300000" && firstFindAttempts === 0) {
          firstFindAttempts++
          return Response.json({}, { status: 500 })
        }
        const id = findMap[imdb]
        return Response.json(
          id ? { movie_results: [{ id }], tv_results: [] } : { movie_results: [], tv_results: [] },
        )
      }
      if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
        counters.details++
        const m = u.match(/\/(?:movie|tv)\/(\d+)/)
        const id = Number(m?.[1] ?? 0)
        return Response.json({
          id,
          title: `Title ${id}`,
          name: `Title ${id}`,
          genres: [{ id: 18, name: "Dramma" }],
          vote_average: 7.5,
          vote_count: 100,
          release_date: "2024-01-01",
          backdrop_path: null,
          overview: `Overview ${id}`,
        })
      }
      return Response.json({}, { status: 404 })
    })
    const cid = "budget-find-shift"
    const token = mdblistToken(cid, "budget-find-shift")

    const first = await getCatalog(cid, token)
    expect(first.res.status).toBe(200)
    expect(first.body.metas).toHaveLength(20)
    // Row 0 dropped transiently: later rows shift up (row 1 leads).
    expect(first.body.metas[0].id).toBe("tmdb:9601")
    expect(first.body.metas.map((m) => m.id)).not.toContain("tmdb:9600")
    const findAfterFirst = counters.find

    // Short TTL, not frozen: after 60s the retry recomputes (fresh /find for
    // the transient row) and the head row is back — no manual cache clear.
    now += 61_000
    const retry = await getCatalog(cid, token)
    expect(retry.body.metas).toHaveLength(20)
    expect(retry.body.metas[0].id).toBe("tmdb:9600")
    expect(retry.body.metas.map((m) => m.id)).toContain("tmdb:9619")
    expect(counters.find).toBeGreaterThan(findAfterFirst)
    expect(counters.provider).toBe(1)
  }, 30000)

  it("confirmed /find misses alone keep the healthy long cache (no transient flag)", async () => {
    mockNow()
    // 1 bogus head (confirmed miss, resolves empty) + 20 direct ids: the
    // window is exact and stable, so the body caches the full hour.
    const rows: MockItem[] = [
      { imdb: "tt9999999", title: "Bogus" },
      ...Array.from({ length: 20 }, (_, i) => ({ tmdb: 9650 + i, title: `Direct ${i}` })),
    ]
    const counters = { provider: 0, find: 0, details: 0, enrich: 0 }
    mockRouter({ mdblistItems: rows, findMap: {}, counters })
    const cid = "budget-miss-stable"
    const token = mdblistToken(cid, "budget-miss-stable")

    const first = await getCatalog(cid, token)
    expect(first.body.metas).toHaveLength(20)
    expect(first.body.metas[0].id).toBe("tmdb:9650")
    expect(counters.find).toBe(1)

    // Past the 60s mark the healthy body is still cached: zero new fetches.
    now += 61_000
    const retry = await getCatalog(cid, token)
    expect(retry.body.metas).toHaveLength(20)
    expect(retry.body.metas[0].id).toBe("tmdb:9650")
    expect(counters.provider).toBe(1)
    expect(counters.find).toBe(1)
    expect(counters.details).toBe(20)
  }, 30000)

  it("a transient details failure keeps the row from list data, caches short, and the retry restores genres", async () => {
    mockNow()
    const rows: MockItem[] = [
      { tmdb: 9911, title: "List A" },
      { tmdb: 9912, title: "List B" },
      { tmdb: 9913, title: "List C" },
    ]
    let details9912Attempts = 0
    const counters = { provider: 0, find: 0, details: 0, enrich: 0 }
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/lists/custom/")) {
        counters.provider++
        return Response.json({ items: rows })
      }
      if (u.includes("/external_ids") || u.includes("/images")) {
        counters.enrich++
        const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
        const id = Number(m?.[1] ?? m?.[2] ?? 0)
        if (u.includes("/external_ids")) return Response.json({ id, imdb_id: null })
        return Response.json({ id, backdrops: [], posters: [], logos: [] })
      }
      if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
        counters.details++
        const m = u.match(/\/(?:movie|tv)\/(\d+)/)
        const id = Number(m?.[1] ?? 0)
        if (id === 9912 && details9912Attempts === 0) {
          details9912Attempts++
          return Response.json({}, { status: 500 })
        }
        return Response.json({
          id,
          title: `Title ${id}`,
          name: `Title ${id}`,
          genres: [{ id: 18, name: "Dramma" }],
          vote_average: 7.5,
          vote_count: 100,
          release_date: "2024-01-01",
          backdrop_path: null,
          overview: `Overview ${id}`,
        })
      }
      return Response.json({}, { status: 404 })
    })
    const cid = "budget-details-genre"
    const token = mdblistToken(cid, "budget-details-genre")

    const first = await getCatalog(cid, token)
    expect(first.res.status).toBe(200)
    expect(first.body.metas).toHaveLength(3)
    // The failed row stays servable from list data (partial, genre-less).
    const partial = first.body.metas.find((m) => m.id === "tmdb:9912")
    expect(partial?.name).toBe("List B")
    expect(partial?.genres ?? []).toEqual([])
    const detailsAfterFirst = counters.details

    // Not frozen: after 60s the retry refetches the failed details only.
    now += 61_000
    const retry = await getCatalog(cid, token)
    const fixed = retry.body.metas.find((m) => m.id === "tmdb:9912")
    expect(fixed?.name).toBe("Title 9912")
    expect(fixed?.genres ?? []).toContain("Dramma")
    expect(counters.details).toBeGreaterThan(detailsAfterFirst)
    expect(counters.provider).toBe(1)
  }, 30000)

  it("an aborted logo lookup is not frozen as a 1h null memo: the retry shows the logo", async () => {
    mockNow()
    const { totalControllers } = controllableTotalTimeout()
    const rows: MockItem[] = [
      { tmdb: 9921, title: "Logo A" },
      { tmdb: 9922, title: "Logo B" },
    ]
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown, _init?: RequestInit) => {
      const u = String(url)
      if (u.includes("/lists/custom/")) return Response.json({ items: rows })
      if (u.includes("/external_ids")) {
        const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
        return Response.json({ id: Number(m?.[1] ?? m?.[2] ?? 0), imdb_id: null })
      }
      if (u.includes("/images")) {
        // Cancel mid-flight, THEN answer "no logos": the outcome is
        // "unknown", and must not be memoized as a 1h miss.
        totalControllers[0]?.abort()
        const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
        const id = Number(m?.[1] ?? m?.[2] ?? 0)
        return Response.json({ id, backdrops: [], posters: [], logos: [] })
      }
      if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
        const m = u.match(/\/(?:movie|tv)\/(\d+)/)
        const id = Number(m?.[1] ?? 0)
        return Response.json({
          id,
          title: `Title ${id}`,
          name: `Title ${id}`,
          genres: [],
          vote_average: 7.5,
          vote_count: 100,
          release_date: "2024-01-01",
          backdrop_path: null,
          overview: `Overview ${id}`,
        })
      }
      return Response.json({}, { status: 404 })
    })
    const cid = "budget-logo-memo"
    const token = mdblistToken(cid, "budget-logo-memo")

    const first = await getCatalog(cid, token)
    expect(first.res.status).toBe(200)
    expect(first.body.metas).toHaveLength(2)
    expect(first.body.metas[0].logo).toBeUndefined()

    // After the short TTL the retry refetches the logo (no frozen null).
    // The retry advances past the 5min shared TMDB layer too: it also
    // caches the raw empty-logos payload, so a 61s retry would still see
    // "no logos" (genuine upstream bytes, not a frozen memo). Past both
    // windows the old code still serves logo-less (1h null memo) while the
    // fix refetches and shows the logo.
    now += 6 * 60_000 + 1_000
    vi.restoreAllMocks()
    mockNow(now)
    let retryImages = 0
    let retryDetails = 0
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/lists/custom/")) return Response.json({ items: rows })
      if (u.includes("/external_ids")) {
        const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
        return Response.json({ id: Number(m?.[1] ?? m?.[2] ?? 0), imdb_id: null })
      }
      if (u.includes("/images")) {
        retryImages++
        const m = u.match(/\/movie\/(\d+)|\/tv\/(\d+)/)
        const id = Number(m?.[1] ?? m?.[2] ?? 0)
        return Response.json({
          id,
          backdrops: [],
          posters: [],
          logos: [{ aspect_ratio: 1.8, file_path: "/logo.png", height: 100, iso_639_1: "en", vote_average: 0, vote_count: 1, width: 180 }],
        })
      }
      if (/\/movie\/\d+/.test(u) || /\/tv\/\d+/.test(u)) {
        retryDetails++
        const m = u.match(/\/(?:movie|tv)\/(\d+)/)
        const id = Number(m?.[1] ?? 0)
        return Response.json({
          id,
          title: `Title ${id}`,
          name: `Title ${id}`,
          genres: [],
          vote_average: 7.5,
          vote_count: 100,
          release_date: "2024-01-01",
          backdrop_path: null,
          overview: `Overview ${id}`,
        })
      }
      return Response.json({}, { status: 404 })
    })
    const retry = await getCatalog(cid, token)
    expect(retry.body.metas).toHaveLength(2)
    // The body recomputed (short TTL, not frozen) AND the logo memo was
    // skipped: both layers refetched, and both rows show the logo.
    expect(retryDetails).toBeGreaterThan(0)
    expect(retryImages).toBeGreaterThan(0)
    expect(retry.body.metas[0].logo).toContain("logo.png")
    expect(retry.body.metas[1].logo).toContain("logo.png")
  }, 30000)
})

describe("deterministic total timeout (trakt path: exactly one root 10s)", () => {
  beforeEach(() => {
    vi.stubEnv("TRAKT_CLIENT_ID", "test-trakt-key")
    vi.stubEnv("TRAKT_API_URL", "https://trakt-mock.test")
  })

  it("provider hanging beyond the total with un-aborted incoming: mid-inflight abort, no fresh total", async () => {
    const { requestedMs, totalControllers } = controllableTotalTimeout()
    const calls: CallRec[] = []
    let fired = false
    recordFetch(calls, (url) => {
      if (url.includes("/users/testuser/lists/testlist/items")) {
        // The total expires while the provider is still in flight.
        if (totalControllers[0] && !fired) {
          fired = true
          queueMicrotask(() => totalControllers[0].abort())
        }
        return "hang"
      }
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const cid = "budget-trakt-hang"
    const token = traktToken(cid)

    const req = new NextRequest(catalogUrl(cid, token))
    const incomingSignal = (req as unknown as { signal?: AbortSignal }).signal
    const start = Date.now()
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) })
    const elapsed = Date.now() - start
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.metas).toEqual([])
    expect(elapsed).toBeLessThan(5000)
    // The incoming signal was never aborted: only the total timer fired.
    expect(incomingSignal?.aborted).toBe(false)
    expect(fired).toBe(true)
    // EXACTLY ONE root 10s instance (trakt per-step is 8s, never 10s): later
    // work derived from the expired budget instead of renewing the total.
    expect(requestedMs.filter((ms) => ms === 10000)).toHaveLength(1)
    // Actual abort record: the hanging provider fetch was cancelled mid-flight.
    const provider = calls.filter((c) => c.url.includes("/users/testuser/lists/testlist/items"))
    expect(provider).toHaveLength(1)
    expect(provider[0].sawAbort).toBe(true)
    expect(provider[0].responded).toBe(false)
    // Sequential budget consumed: no later phase (/find, details, enrich)
    // ever started after the provider died.
    expect(calls).toHaveLength(1)
  }, 15000)

  it("final IMDb/logo phase after previous work consumed most of the budget reuses the expired total", async () => {
    const { requestedMs, totalControllers } = controllableTotalTimeout()
    const calls: CallRec[] = []
    let fired = false
    recordFetch(calls, (url) => {
      if (url.includes("/users/testuser/lists/testlist/items")) {
        return Response.json(traktPayload(3, 7300))
      }
      if (url.includes("/external_ids") || url.includes("/images")) return "hang"
      if (/\/movie\/\d+/.test(url) || /\/tv\/\d+/.test(url)) {
        // Details answer fast; the total then expires before enrichment.
        if (totalControllers[0] && !fired) {
          fired = true
          queueMicrotask(() => totalControllers[0].abort())
        }
        const m = url.match(/\/(?:movie|tv)\/(\d+)/)
        const id = Number(m?.[1] ?? 0)
        return Response.json({
          id,
          title: `TraktTitle ${id}`,
          name: `TraktTitle ${id}`,
          genres: [{ id: 28, name: "Azione" }],
          vote_average: 8.0,
          vote_count: 50,
          release_date: "2024-05-01",
          backdrop_path: null,
          overview: `Overview ${id}`,
        })
      }
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const cid = "budget-trakt-enrich"
    const token = traktToken(cid)

    const req = new NextRequest(catalogUrl(cid, token))
    const incomingSignal = (req as unknown as { signal?: AbortSignal }).signal
    const start = Date.now()
    const res = await GET(req, { params: Promise.resolve({ type: "movie", id: `pictorium-custom-movie-${cid}.json` }) })
    const elapsed = Date.now() - start
    const body = await res.json()

    // Details were fast: the page is served even though the garnish hung
    // past the consumed budget.
    expect(res.status).toBe(200)
    expect(body.metas).toHaveLength(3)
    expect(body.metas.map((m: { id: string }) => m.id).sort()).toEqual(["tmdb:7300", "tmdb:7301", "tmdb:7302"])
    expect(elapsed).toBeLessThan(5000)
    expect(incomingSignal?.aborted).toBe(false)
    expect(fired).toBe(true)
    // No fresh total for the late phase: still exactly one root 10s.
    expect(requestedMs.filter((ms) => ms === 10000)).toHaveLength(1)
    // Earlier phases kept their work ...
    const details = calls.filter((c) => /\/movie\/\d+/.test(c.url) && !c.url.includes("/external_ids") && !c.url.includes("/images"))
    expect(details).toHaveLength(3)
    for (const d of details) {
      expect(d.responded).toBe(true)
      expect(d.sawAbort).toBe(false)
    }
    // ... while the late enrichment performed no work on the expired budget.
    const enrich = calls.filter((c) => c.url.includes("/external_ids") || c.url.includes("/images"))
    expect(enrich.length).toBeGreaterThan(0)
    for (const e of enrich) {
      expect(e.abortedAtStart).toBe(true)
      expect(e.responded).toBe(false)
    }
  }, 15000)
})

describe("custom provider signal threading (backward-compatible)", () => {
  it("fetchCustomMDBList honors an aborted signal instead of hanging", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url: unknown, init?: RequestInit) =>
      hangingPromise(init),
    )
    const ctrl = new AbortController()
    ctrl.abort()
    const start = Date.now()
    await expect(
      fetchCustomMDBList("https://mdblist.com/lists/u/signal-hang", "key", 500, ctrl.signal),
    ).resolves.toEqual([])
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it("fetchUnifiedCatalogResult propagates the signal and stays callable without one", async () => {
    // Without a signal: existing call shape keeps working (backward compat).
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ items: [{ imdb: "tt9300001", title: "NoSignal", year: 2024, tmdb: 9301 }] }),
    )
    const ok = await fetchUnifiedCatalogResult("https://mdblist.com/lists/u/nosignal-x")
    expect(ok.items).toHaveLength(1)
    vi.restoreAllMocks()

    // With an aborted signal: aborts instead of hanging on a stalled upstream.
    vi.spyOn(globalThis, "fetch").mockImplementation((_url: unknown, init?: RequestInit) =>
      hangingPromise(init),
    )
    const ctrl = new AbortController()
    ctrl.abort()
    const start = Date.now()
    const out = await fetchUnifiedCatalogResult("https://mdblist.com/lists/u/signal-hang-y", {
      signal: ctrl.signal,
    })
    expect(Date.now() - start).toBeLessThan(2000)
    expect(out.items).toEqual([])
  })
})
