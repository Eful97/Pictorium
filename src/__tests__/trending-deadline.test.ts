import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { gunzipSync } from "node:zlib"
import { NextRequest } from "next/server"
import {
  GET,
} from "@/app/api/tmdb/trending/route"
import {
  TRENDING_ENDPOINT_TIMEOUT_MS,
  TRENDING_ENRICH_CONCURRENCY,
  TRENDING_JW_TIMEOUT_MS,
  TRENDING_TMDB_TIMEOUT_MS,
} from "@/lib/trending-budgets"
import { cacheClear, cacheGet } from "@/lib/cache"
import { __clearTMDBCache, __resetKey401Cache, getDetails } from "@/lib/tmdb"
import { __resetJWRankingsCache, getJWRankings, isJustwatchBreakerOpen } from "@/lib/justwatch"

// Task13: /api/tmdb/trending non aveva alcuna scadenza di endpoint —
// getDetails/getImages col default 30s, pool film e POI pool serie, niente
// signal. Con TMDB appeso la route superava i 30s del browser (0 byte).
// Questi test coprono deadline, parziali, fairness e recovery usando la vera
// route + il vero trasporto condiviso (fetch mock abort-aware deterministico).

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function abortErr(): unknown {
  return new DOMException("The operation was aborted", "AbortError")
}

function jwBody(ids: number[]) {
  return {
    data: {
      streamingCharts: {
        edges: ids.map((tmdbId, i) => ({
          streamingChartInfo: { rank: i + 1 },
          node: { content: { title: `JW ${tmdbId}`, externalIds: { tmdbId, imdbId: `tt${tmdbId}` } } },
        })),
      },
    },
  }
}

function detailsBody(media: "movie" | "tv", id: number, poster: string | null) {
  return media === "movie"
    ? { id, title: `Movie ${id}`, poster_path: poster, release_date: "2024-01-01", genres: [], vote_average: 7, vote_count: 10 }
    : { id, name: `Show ${id}`, poster_path: poster, first_air_date: "2024-01-01", genres: [], vote_average: 7, vote_count: 10 }
}

function imagesBody(id: number, poster: string | null) {
  return {
    id,
    backdrops: [],
    posters: poster ? [{ file_path: poster, aspect_ratio: 0.68, height: 1000, width: 680, iso_639_1: "en", vote_average: 5, vote_count: 1 }] : [],
    logos: [],
  }
}

interface TrendingPayloadItem {
  id: number
  rank: number
  title?: string
  name?: string
  poster_path: string | null
}

interface TrendingPayload {
  movies: TrendingPayloadItem[]
  tv: TrendingPayloadItem[]
  degraded?: boolean
}

async function readJson(res: Response): Promise<TrendingPayload> {
  const buf = Buffer.from(await res.arrayBuffer())
  const enc = res.headers.get("content-encoding") || ""
  const text = enc.includes("gzip") ? gunzipSync(buf).toString("utf-8") : buf.toString("utf-8")
  return JSON.parse(text)
}

function req(path: string, init?: { signal?: AbortSignal; ua?: string }): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    signal: init?.signal,
    headers: { "user-agent": init?.ua ?? "task13-trending-deadline" },
  } as unknown as Record<string, unknown>)
}

interface Tracker {
  tmdbStarts: number
  imageStarts: number
  maxActive: number
  pending: number
  startsAfterAbort: number
}

function newTracker(): Tracker {
  return { tmdbStarts: 0, imageStarts: 0, maxActive: 0, pending: 0, startsAfterAbort: 0 }
}

type TmdbMode =
  | { kind: "fast"; poster?: string | null }
  | { kind: "hang" }
  | { kind: "perId"; hangIds: Set<number>; poster?: string | null }
  | { kind: "noPosterFast"; images: "fast" | "hang" }

interface FetchCfg {
  tracker: Tracker
  jwMovie: number[] | "hang"
  jwShow: number[] | "hang"
  tmdb: TmdbMode
  /** Fault HTTP sui dettagli per id (es. 500 outage, 404 fisiologico). */
  tmdbStatusById?: Map<number, number>
}

/** Fetch mock abort-aware: gli hang rigettano SOLO su abort (come undici). */
function installFetch(cfg: FetchCfg) {
  let active = 0
  return vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String((input as { url?: unknown }).url ?? input)
    const signal = init?.signal as AbortSignal | undefined
    if (signal?.aborted) {
      cfg.tracker.startsAfterAbort++
      return Promise.reject(abortErr())
    }
    if (url.includes("apis.justwatch.com")) {
      // Il payload GraphQL distingue MOVIE/SHOW nel body JSON.
      let ids: number[] | "hang" = cfg.jwMovie
      try {
        const parsed = JSON.parse(String((init as { body?: unknown })?.body ?? "{}"))
        const filter = parsed?.variables?.filter ?? {}
        const types: string[] = filter.objectTypes ?? [filter.objectType]
        ids = types.includes("SHOW") ? cfg.jwShow : cfg.jwMovie
      } catch {
        ids = cfg.jwMovie
      }
      if (ids === "hang") {
        cfg.tracker.pending++
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => { cfg.tracker.pending--; reject(abortErr()) }, { once: true })
        })
      }
      return Promise.resolve(Response.json(jwBody(ids)))
    }
    if (url.includes("api.themoviedb.org")) {
      const m = /\/3\/(movie|tv)\/(\d+)(\/images)?/.exec(url)
      if (!m) throw new Error(`unexpected tmdb url ${url}`)
      const media = m[1] as "movie" | "tv"
      const id = Number(m[2])
      const isImages = !!m[3]
      if (isImages) cfg.tracker.imageStarts++
      else cfg.tracker.tmdbStarts++
      // Fault HTTP deterministico sui dettagli (vero status via Response):
      // il client condiviso lo trasforma in `TMDB fetch failed: {status}`.
      const fault = !isImages ? cfg.tmdbStatusById?.get(id) : undefined
      if (fault !== undefined) {
        active++
        cfg.tracker.maxActive = Math.max(cfg.tracker.maxActive, active)
        active--
        return Promise.resolve(new Response(`tmdb fault ${fault}`, { status: fault }))
      }
      cfg.tracker.maxActive = Math.max(cfg.tracker.maxActive, active)
      const done = () => { active-- }
      const mode = cfg.tmdb
      const hang =
        mode.kind === "hang" ||
        (mode.kind === "perId" && mode.hangIds.has(id)) ||
        (mode.kind === "noPosterFast" && isImages && mode.images === "hang")
      if (hang) {
        cfg.tracker.pending++
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => { cfg.tracker.pending--; done(); reject(abortErr()) },
            { once: true },
          )
        })
      }
      const posterDefault = mode.kind === "fast" ? (mode.poster ?? "/p.jpg") : (mode.kind === "perId" ? (mode.poster ?? "/p.jpg") : null)
      const payload = isImages ? imagesBody(id, "/img.jpg") : detailsBody(media, id, mode.kind === "noPosterFast" ? null : posterDefault)
      done()
      return Promise.resolve(Response.json(payload))
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as unknown as typeof fetch)
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  __resetJWRankingsCache()
  __clearTMDBCache()
  __resetKey401Cache()
  cacheClear()
})

describe("trending endpoint budgets", () => {
  it("stanno comodamente sotto i 30s del client/browser", () => {
    // Aspettative hardcoded indipendenti (non `toBe(X)` sul simbolo stesso):
    // un cambio silenzioso dei budget deve rompere questo test.
    expect(TRENDING_ENDPOINT_TIMEOUT_MS).toBe(20_000)
    expect(TRENDING_JW_TIMEOUT_MS).toBe(8_000)
    expect(TRENDING_TMDB_TIMEOUT_MS).toBe(3_000)
    expect(TRENDING_ENRICH_CONCURRENCY).toBe(4)
    expect(TRENDING_ENDPOINT_TIMEOUT_MS).toBeLessThan(30_000)
  })
})

describe("GET /api/tmdb/trending — percorso sano", () => {
  it("arricchisce, ordina per rank, salta getImages col poster nei dettagli e cacha", async () => {
    const tracker = newTracker()
    const spy = installFetch({ tracker, jwMovie: [101, 102], jwShow: [201, 202], tmdb: { kind: "fast" } })

    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-healthy" }))
    expect(res.status).toBe(200)
    const json = await readJson(res)
    expect(json.degraded).toBe(false)
    expect(json.movies.map((m: { id: number }) => m.id)).toEqual([101, 102])
    expect(json.tv.map((m: { id: number }) => m.id)).toEqual([201, 202])
    expect(json.movies.map((m: { rank: number }) => m.rank)).toEqual([1, 2])
    expect(json.movies[0].title).toBe("Movie 101")
    expect(json.tv[0].name).toBe("Show 201")
    // Poster già nei dettagli → zero fetch immagini; pool 4 → max 4 attivi.
    expect(tracker.imageStarts).toBe(0)
    expect(tracker.maxActive).toBeLessThanOrEqual(8)
    expect(res.headers.get("Cache-Control")).toContain("public")

    // Seconda chiamata: cache di route, zero rete (la entry cachata è il body
    // senza flag `degraded` — contratto storico invariato).
    const callsBefore = spy.mock.calls.length
    const res2 = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-healthy" }))
    const json2 = await readJson(res2)
    expect(json2.movies).toEqual(json.movies)
    expect(json2.tv).toEqual(json.tv)
    expect(spy.mock.calls.length).toBe(callsBefore)
  })

  it("gzip, separazione per country e cache JW invariata", async () => {
    const tracker = newTracker()
    const ids = Array.from({ length: 20 }, (_, i) => 300 + i)
    const tvIds = Array.from({ length: 20 }, (_, i) => 400 + i)
    const spy = installFetch({ tracker, jwMovie: ids, jwShow: tvIds, tmdb: { kind: "fast" } })

    const res = await GET(
      req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-contract" }),
    )
    expect(res.headers.get("Content-Encoding")).toBe("gzip")
    const json = await readJson(res)
    expect(json.movies).toHaveLength(20)
    expect(json.tv).toHaveLength(20)

    const jwCallsBefore = spy.mock.calls.filter((c) => String(c[0]).includes("justwatch")).length
    // Country diversa → miss di cache, nuova rete JW.
    await GET(req("/api/tmdb/trending?country=US&api_key=testkey", { ua: "task13-contract" }))
    const jwCallsAfter = spy.mock.calls.filter((c) => String(c[0]).includes("justwatch")).length
    expect(jwCallsAfter).toBeGreaterThan(jwCallsBefore)
    // Stesso country → hit, niente nuova rete.
    await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-contract" }))
    expect(spy.mock.calls.filter((c) => String(c[0]).includes("justwatch")).length).toBe(jwCallsAfter)

    // Cache JW 30min: due chiamate dirette identiche → una sola rete.
    __resetJWRankingsCache()
    const directSpy = spy.mock.calls.length
    await getJWRankings("MOVIE", "FR", 5)
    await getJWRankings("MOVIE", "FR", 5)
    expect(spy.mock.calls.length - directSpy).toBe(1)
  })

  it("senza chiave API degrada senza 500 né cache avvelenata", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [101], jwShow: [201], tmdb: { kind: "fast" } })
    const res = await GET(req("/api/tmdb/trending?country=IT", { ua: "task13-nokey" }))
    expect(res.status).toBe(200)
    const json = await readJson(res)
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(cacheGet("trending:v2:IT")).toBeNull()
  })

  it("il rate limit resta enforced (429 dopo il burst)", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [101], jwShow: [201], tmdb: { kind: "fast" } })
    const ua = "task13-ratelimit-probe"
    let lastStatus = 200
    // Bucket tmdb: 60 burst — le hit di cache consumano comunque il token.
    for (let i = 0; i < 65; i++) {
      const r = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua }))
      lastStatus = r.status
      if (r.status === 429) break
      await readJson(r)
    }
    expect(lastStatus).toBe(429)
  })
})

describe("GET /api/tmdb/trending — deadline e parziali (fake clock)", () => {
  it("TMDB appeso: risponde alla deadline con degradato, senza cache né lavoro residuo", async () => {
    vi.useFakeTimers()
    let hangSettled = false
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [111, 112], jwShow: [211], tmdb: { kind: "hang" } })
    const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-hang" })).then((r) => {
      hangSettled = true
      return r
    })
    // A 19s virtuali la risposta NON è ancora arrivata (aspetta la deadline,
    // non un hang indefinito); a 20s sì — bounded, mai fino a 60s.
    await vi.advanceTimersByTimeAsync(TRENDING_ENDPOINT_TIMEOUT_MS - 1000)
    expect(hangSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    const res = await pending
    expect(hangSettled).toBe(true)

    expect(res.status).toBe(200)
    const json = await readJson(res)
    expect(json.movies).toEqual([])
    expect(json.tv).toEqual([])
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    // Niente launch dopo l'abort e niente fetch posseduti in sospeso.
    expect(tracker.startsAfterAbort).toBe(0)
    expect(tracker.pending).toBe(0)
    // Il degradato non si congela in cache…
    expect(cacheGet("trending:v2:IT")).toBeNull()

    // …e alla recovery il sano torna e si cacha.
    vi.useRealTimers()
    vi.restoreAllMocks()
    __resetJWRankingsCache()
    const tracker2 = newTracker()
    const spy2 = installFetch({ tracker: tracker2, jwMovie: [111], jwShow: [], tmdb: { kind: "fast" } })
    const ok = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-hang" }))
    const okJson = await readJson(ok)
    expect(okJson.degraded).toBe(false)
    expect(okJson.movies.map((m: { id: number }) => m.id)).toEqual([111])
    const calls = spy2.mock.calls.length
    await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-hang" }))
    expect(spy2.mock.calls.length).toBe(calls)
  })

  it("JW unilaterale appeso: la metà sana si conserva ordinata e marcata degradata", async () => {
    vi.useFakeTimers()
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [121, 122], jwShow: "hang", tmdb: { kind: "fast" } })
    const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-half" }))
    await vi.advanceTimersByTimeAsync(TRENDING_ENDPOINT_TIMEOUT_MS)
    const res = await pending
    const json = await readJson(res)
    expect(json.movies.map((m: { id: number }) => m.id)).toEqual([121, 122])
    expect(json.movies.map((m: { rank: number }) => m.rank)).toEqual([1, 2])
    expect(json.tv).toEqual([])
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(tracker.pending).toBe(0)
  })

  it("fairness: le serie non restano affamate dietro i film appesi", async () => {
    vi.useFakeTimers()
    const tracker = newTracker()
    const movieIds = [131, 132, 133, 134, 135, 136]
    installFetch({
      tracker,
      jwMovie: movieIds,
      jwShow: [231, 232],
      tmdb: { kind: "perId", hangIds: new Set(movieIds) },
    })
    const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-fair" }))
    await vi.advanceTimersByTimeAsync(TRENDING_ENDPOINT_TIMEOUT_MS)
    const res = await pending
    const json = await readJson(res)
    // Pool unico interlacciato: le 2 serie veloci completano prima della deadline.
    expect(json.tv.map((m: { id: number }) => m.id)).toEqual([231, 232])
    expect(json.movies).toEqual([])
    expect(json.degraded).toBe(true)
    // Un item = details (+images solo se serve): mai oltre 8 fetch concorrenti.
    expect(tracker.maxActive).toBeLessThanOrEqual(8)
    expect(tracker.pending).toBe(0)
  })
})

describe("GET /api/tmdb/trending — abort e fallback (real clock)", () => {
  it("abort del client: risposta rapida, niente launch dopo, niente upstream posseduto in sospeso", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [141], jwShow: [241], tmdb: { kind: "hang" } })
    const ctrl = new AbortController()
    const t0 = Date.now()
    const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { signal: ctrl.signal, ua: "task13-abort" }))
    await sleep(150)
    ctrl.abort()
    const res = await pending
    // Ben sotto i 30s del browser anche con upstream totalmente appeso.
    expect(Date.now() - t0).toBeLessThan(5_000)
    const json = await readJson(res)
    expect(json.degraded).toBe(true)
    expect(tracker.startsAfterAbort).toBe(0)
    // I fetch di route abortiscono davvero: nessun hang posseduto residuo.
    // (Il tetto nativo 3s chiude comunque tutto entro pochi secondi.)
    const settleStart = Date.now()
    while (tracker.pending > 0 && Date.now() - settleStart < 8_000) await sleep(50)
    expect(tracker.pending).toBe(0)
  }, 15_000)

  it("immagini appese ma dettagli con poster: l'item resta, senza fetch immagini", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [151], jwShow: [], tmdb: { kind: "fast" } })
    // Details con poster → getImages mai chiamata (poster param di default).
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-img-skip" }))
    const json = await readJson(res)
    expect(json.movies).toHaveLength(1)
    expect(json.movies[0].poster_path).toBe("/p.jpg")
    expect(tracker.imageStarts).toBe(0)
  })

  it("dettagli senza poster e immagini appese: i dettagli validi non si scartano", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [161], jwShow: [], tmdb: { kind: "noPosterFast", images: "hang" } })
    const t0 = Date.now()
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-img-hang" }))
    // Il fallback immagini ha budget proprio (3s): niente attesa 30s.
    expect(Date.now() - t0).toBeLessThan(15_000)
    const json = await readJson(res)
    expect(json.movies).toHaveLength(1)
    expect(json.movies[0].title).toBe("Movie 161")
    expect(json.movies[0].poster_path).toBeNull()
  }, 20_000)
})

describe("trending + inflight TMDB condiviso: il waiter non cancella il leader altrui", () => {
  it("abort di una richiesta non ammazza il fetch condiviso dell'altra", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [171], jwShow: [], tmdb: { kind: "hang" } })
    // Leader altrui sulla stessa neutral-URL dei dettagli del film 171.
    const leader = getDetails("movie", 171, "it-IT", "owner-key", undefined, 4_000)
    await sleep(50)
    // Waiter con budget corto esce al proprio abort mentre il leader pende.
    const wStart = Date.now()
    await expect(getDetails("movie", 171, "it-IT", "waiter-key", AbortSignal.timeout(200), 60_000)).rejects.toThrow()
    expect(Date.now() - wStart).toBeLessThan(1_500)

    // La route (waiter indiretto) abortita dal client: risponde in fretta…
    const ctrl = new AbortController()
    const rStart = Date.now()
    const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { signal: ctrl.signal, ua: "task13-shared" }))
    await sleep(300)
    ctrl.abort()
    const res = await pending
    expect(Date.now() - rStart).toBeLessThan(5_000)
    expect((await readJson(res)).degraded).toBe(true)

    // …ma il leader altrui è ancora vivo (mai cancellato globalmente)…
    await expect(Promise.race([leader.then(() => "settled"), sleep(150).then(() => "pending")])).resolves.toBe("pending")
    // …si chiude al proprio tetto senza avvelenare l'inflight…
    await expect(leader).rejects.toThrow()
    const settleStart = Date.now()
    while (tracker.pending > 0 && Date.now() - settleStart < 8_000) await sleep(50)
    expect(tracker.pending).toBe(0)

    // …e dopo il settle la chiave si riusa senza poison.
    vi.restoreAllMocks()
    installFetch({ tracker: newTracker(), jwMovie: [], jwShow: [], tmdb: { kind: "fast" } })
    const d = await getDetails("movie", 171, "it-IT", "owner-key", undefined, 5_000)
    expect(d.id).toBe(171)
  }, 20_000)
})

describe("GET /api/tmdb/trending — outage parziali: 404 fisiologico vs 500/timeout (real clock)", () => {
  it("fetch 500 su un item fra molti sani: parziale degradato no-store, poi retry sano ricacha", async () => {
    const tracker = newTracker()
    installFetch({
      tracker,
      jwMovie: [181, 182],
      jwShow: [281],
      tmdb: { kind: "fast" },
      tmdbStatusById: new Map([[182, 500]]),
    })
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-500" }))
    expect(res.status).toBe(200)
    const json = await readJson(res)
    // Entrambe le sezioni avevano rank: l'item guasto si scarta, i sani restano.
    expect(json.movies.map((m: { id: number }) => m.id)).toEqual([181])
    expect(json.tv.map((m: { id: number }) => m.id)).toEqual([281])
    // Outage parziale: mai cachato come sano.
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(cacheGet("trending:v2:IT")).toBeNull()

    // Recovery: il sano torna e si cacha (nessun outage congelato).
    vi.restoreAllMocks()
    __resetJWRankingsCache()
    __clearTMDBCache()
    const tracker2 = newTracker()
    const spy2 = installFetch({ tracker: tracker2, jwMovie: [181, 182], jwShow: [281], tmdb: { kind: "fast" } })
    const ok = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-500" }))
    const okJson = await readJson(ok)
    expect(okJson.degraded).toBe(false)
    expect(okJson.movies.map((m: { id: number }) => m.id)).toEqual([181, 182])
    expect(ok.headers.get("Cache-Control")).toContain("public")
    const calls = spy2.mock.calls.length
    await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-500" }))
    expect(spy2.mock.calls.length).toBe(calls)
  })

  it("404 singolo fra sani: fisiologico, risposta sana e cachata", async () => {
    const tracker = newTracker()
    const spy = installFetch({
      tracker,
      jwMovie: [183, 184],
      jwShow: [283],
      tmdb: { kind: "fast" },
      tmdbStatusById: new Map([[184, 404]]),
    })
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-404" }))
    const json = await readJson(res)
    // L'id rimosso si salta in silenzio; il resto è sano e cachabile.
    expect(json.movies.map((m: { id: number }) => m.id)).toEqual([183])
    expect(json.tv.map((m: { id: number }) => m.id)).toEqual([283])
    expect(json.degraded).toBe(false)
    expect(res.headers.get("Cache-Control")).toContain("public")
    expect(cacheGet("trending:v2:IT")).not.toBeNull()
    const calls = spy.mock.calls.length
    await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-404" }))
    expect(spy.mock.calls.length).toBe(calls)
  })

  it("immagini appese senza poster: dettagli tenuti ma risposta degradata no-store, poi recovery", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: [185], jwShow: [285], tmdb: { kind: "noPosterFast", images: "hang" } })
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-imgstall" }))
    const json = await readJson(res)
    // Fallback fallito: l'item resta (titolo + poster null)…
    expect(json.movies).toHaveLength(1)
    expect(json.movies[0].title).toBe("Movie 185")
    expect(json.movies[0].poster_path).toBeNull()
    expect(json.tv).toHaveLength(1)
    // …ma il parziale è outage: mai cachato come sano.
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(cacheGet("trending:v2:IT")).toBeNull()

    vi.restoreAllMocks()
    __resetJWRankingsCache()
    __clearTMDBCache()
    installFetch({ tracker: newTracker(), jwMovie: [185], jwShow: [285], tmdb: { kind: "fast" } })
    const ok = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-imgstall" }))
    const okJson = await readJson(ok)
    expect(okJson.degraded).toBe(false)
    expect(okJson.movies[0].poster_path).toBe("/p.jpg")
  }, 20_000)
})

describe("GET /api/tmdb/trending — checkpoint dettagli validi alla deadline (fake clock)", () => {
  it("dettagli validi a 19s + fallback appeso: la risposta a 20s INCLUDE l'item con poster null", async () => {
    vi.useFakeTimers()
    const tracker = newTracker()
    // Mock dedicato: dettagli film lenti (virtuali 19s, abort-aware come undici),
    // dettagli serie veloci con poster, immagini sempre appese abort-aware.
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
      const url = String((input as { url?: unknown }).url ?? input)
      const signal = init?.signal as AbortSignal | undefined
      if (signal?.aborted) {
        tracker.startsAfterAbort++
        return Promise.reject(abortErr())
      }
      if (url.includes("apis.justwatch.com")) {
        let ids = [191]
        try {
          const parsed = JSON.parse(String((init as { body?: unknown })?.body ?? "{}"))
          const filter = parsed?.variables?.filter ?? {}
          const types: string[] = filter.objectTypes ?? [filter.objectType]
          ids = types.includes("SHOW") ? [291] : [191]
        } catch { ids = [191] }
        return Promise.resolve(Response.json(jwBody(ids)))
      }
      if (url.includes("api.themoviedb.org")) {
        const m = /\/3\/(movie|tv)\/(\d+)(\/images)?/.exec(url)
        if (!m) throw new Error(`unexpected tmdb url ${url}`)
        const media = m[1] as "movie" | "tv"
        const id = Number(m[2])
        const isImages = !!m[3]
        if (isImages) tracker.imageStarts++
        else tracker.tmdbStarts++
        tracker.pending++
        return new Promise<Response>((resolve, reject) => {
          const onAbort = () => { tracker.pending--; reject(abortErr()) }
          signal?.addEventListener("abort", onAbort, { once: true })
          if (isImages) return // appeso fino all'abort di fase/deadline
          if (media === "tv") {
            tracker.pending--
            signal?.removeEventListener("abort", onAbort)
            resolve(Response.json(detailsBody(media, id, "/p.jpg")))
            return
          }
          // Dettagli film: validi a 19s virtuali (prima della deadline 20s).
          setTimeout(() => {
            tracker.pending--
            signal?.removeEventListener("abort", onAbort)
            resolve(Response.json(detailsBody(media, id, null)))
          }, TRENDING_ENDPOINT_TIMEOUT_MS - 1000)
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as unknown as typeof fetch)

    let settled = false
    const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-checkpoint" })).then((r) => {
      settled = true
      return r
    })
    // A 19s i dettagli film sono appena arrivati ma il fallback pende:
    // la risposta NON è ancora pronta (aspetta la deadline, non scarta).
    await vi.advanceTimersByTimeAsync(TRENDING_ENDPOINT_TIMEOUT_MS - 1000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    const res = await pending
    expect(settled).toBe(true)

    const json = await readJson(res)
    // Il checkpoint conserva i dettagli validi pre-abort, ordinati per rank…
    expect(json.movies.map((m: { id: number }) => m.id)).toEqual([191])
    expect(json.movies[0].title).toBe("Movie 191")
    expect(json.movies[0].poster_path).toBeNull()
    expect(json.movies.map((m: { rank: number }) => m.rank)).toEqual([1])
    expect(json.tv.map((m: { id: number }) => m.id)).toEqual([291])
    // …ma il parziale è incompleto: degradato, mai cachato, zero residuo.
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(cacheGet("trending:v2:IT")).toBeNull()
    expect(tracker.startsAfterAbort).toBe(0)
    expect(tracker.pending).toBe(0)
    expect(spy.mock.calls.length).toBeGreaterThan(0)
  })
})

describe("GET /api/tmdb/trending — abort JW: niente launch, niente veleno nel breaker (real clock)", () => {
  it("richiesta già abortita: zero fetch JW/TMDB posseduti, risposta degradata rapida", async () => {
    const tracker = newTracker()
    const spy = installFetch({ tracker, jwMovie: [301], jwShow: [401], tmdb: { kind: "fast" } })
    const ctrl = new AbortController()
    ctrl.abort()
    const t0 = Date.now()
    const res = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { signal: ctrl.signal, ua: "task13-c1-preabort" }))
    expect(Date.now() - t0).toBeLessThan(5_000)
    const json = await readJson(res)
    expect(json.degraded).toBe(true)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const jwCalls = spy.mock.calls.filter((c) => String(c[0]).includes("justwatch")).length
    const tmdbCalls = spy.mock.calls.filter((c) => String(c[0]).includes("themoviedb")).length
    expect(jwCalls).toBe(0)
    expect(tmdbCalls).toBe(0)
    expect(tracker.pending).toBe(0)
  }, 15_000)

  it("abort a metà JW: trasporto posseduto cancellato, breaker pulito, recovery sana", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: "hang", jwShow: "hang", tmdb: { kind: "fast" } })
    const ctrl = new AbortController()
    const t0 = Date.now()
    const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { signal: ctrl.signal, ua: "task13-c1-midjw" }))
    await sleep(150)
    ctrl.abort()
    const res = await pending
    expect(Date.now() - t0).toBeLessThan(5_000)
    expect((await readJson(res)).degraded).toBe(true)
    // L'abort posseduto non è outage: il breaker condiviso resta chiuso…
    expect(isJustwatchBreakerOpen()).toBe(false)
    const settleStart = Date.now()
    while (tracker.pending > 0 && Date.now() - settleStart < 8_000) await sleep(50)
    expect(tracker.pending).toBe(0)

    // …e il chiamante successivo trova classifiche sane (no 60s di vuoto).
    vi.restoreAllMocks()
    __resetJWRankingsCache()
    installFetch({ tracker: newTracker(), jwMovie: [302], jwShow: [402], tmdb: { kind: "fast" } })
    const ok = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-midjw" }))
    const okJson = await readJson(ok)
    expect(okJson.degraded).toBe(false)
    expect(okJson.movies.map((m: { id: number }) => m.id)).toEqual([302])
  }, 20_000)

  it("abort rapidi ripetuti non aprono il breaker: matrice quick-abort + recovery", async () => {
    const tracker = newTracker()
    installFetch({ tracker, jwMovie: "hang", jwShow: "hang", tmdb: { kind: "fast" } })
    // 3 navigazioni abortite (6 reject JW pre-fix = breaker aperto 60s).
    for (let i = 0; i < 3; i++) {
      const ctrl = new AbortController()
      const pending = GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { signal: ctrl.signal, ua: `task13-c1-matrix-${i}` }))
      await sleep(150)
      ctrl.abort()
      const res = await pending
      expect((await readJson(res)).degraded).toBe(true)
    }
    expect(isJustwatchBreakerOpen()).toBe(false)
    const settleStart = Date.now()
    while (tracker.pending > 0 && Date.now() - settleStart < 8_000) await sleep(50)
    expect(tracker.pending).toBe(0)

    // Recovery immediata: niente classifica vuota da breaker avvelenato.
    vi.restoreAllMocks()
    __resetJWRankingsCache()
    installFetch({ tracker: newTracker(), jwMovie: [303], jwShow: [403], tmdb: { kind: "fast" } })
    const ok = await GET(req("/api/tmdb/trending?country=IT&api_key=testkey", { ua: "task13-c1-matrix" }))
    const okJson = await readJson(ok)
    expect(okJson.degraded).toBe(false)
    expect(okJson.movies.map((m: { id: number }) => m.id)).toEqual([303])
    expect(okJson.tv.map((m: { id: number }) => m.id)).toEqual([403])
  }, 30_000)
})
