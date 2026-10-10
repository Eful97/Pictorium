import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET as metaGET } from "@/app/meta/[type]/[id]/route"
import { GET as previewGET } from "@/app/api/preview/episodes/route"
import { cacheClear } from "@/lib/cache"
import { __clearTMDBCache } from "@/lib/tmdb"
import { __clearImdbCache, resolveImdbId } from "@/lib/imdb-cache"
import { resolveDefaultEpisodeGroupId } from "@/lib/episode-group-default"
import { __clearAnizipCache, buildVideosFromAnizip } from "@/lib/episode-ordering"
import { clearTvdbCache } from "@/lib/tvdb"
import { getById } from "@/lib/store"
import { getServerDefaults } from "@/lib/server-defaults"

vi.mock("@/lib/store", () => ({
  getById: vi.fn(),
}))

vi.mock("@/lib/server-defaults", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/server-defaults")>()
  const mocked = vi.fn(() => ({}))
  return { ...mod, getServerDefaults: mocked, getServerDefaultsChecked: vi.fn(async () => mocked()) }
})

vi.mock("@/lib/tvdb", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/tvdb")>()
  return { ...mod, enrichVideosWithTvdb: vi.fn(), enrichVideosWithTvdbDetailed: vi.fn(async () => true) }
})

const mockedGetById = vi.mocked(getById)

interface FetchCall {
  url: string
  abortedAtStart: boolean
  sawAbort: boolean
  responded: boolean
}

let calls: FetchCall[] = []

/**
 * Abort-aware mock: records every call with its signal. "hang" stays pending
 * until the signal fires (rejects with AbortError and marks sawAbort = EXACT
 * cancellation, not mere signal presence). A call with an already-aborted
 * signal rejects immediately without responding -- like a real fetch, which
 * performs no I/O on an aborted signal.
 */
function mockFetch(handler: (url: string) => Response | "hang") {
  vi.spyOn(globalThis, "fetch").mockImplementation(((input: unknown, init?: RequestInit) => {
    const url = String(input)
    const sig = init?.signal as AbortSignal | undefined
    const rec: FetchCall = {
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
    // Immediate response: mark responded BEFORE attaching the listener --
    // a later abort (after completed work) is not cancellation.
    rec.responded = true
    if (sig) sig.addEventListener("abort", () => { if (!rec.responded) rec.sawAbort = true }, { once: true })
    return Promise.resolve(out)
  }) as typeof fetch)
}

function reqWithSignal(url: string, ctrl: AbortController): NextRequest {
  const req = new NextRequest(url, { signal: ctrl.signal })
  if ((req as unknown as { signal?: AbortSignal }).signal !== ctrl.signal) {
    Object.defineProperty(req, "signal", { value: ctrl.signal, configurable: true })
  }
  // Fail loud: without a controllable signal the test would prove nothing.
  expect((req as unknown as { signal?: AbortSignal }).signal).toBe(ctrl.signal)
  return req
}

const metaParams = (type: string, id: string) => ({ params: Promise.resolve({ type, id }) })
const abortAfter = (ctrl: AbortController, ms = 50) => setTimeout(() => ctrl.abort(), ms)

describe("shared 15s request budget (meta + preview)", () => {
  beforeEach(() => {
    calls = []
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
    __clearAnizipCache()
    clearTvdbCache()
  })

  it("slow initial /find cancels the whole request: no later phase ever starts", async () => {
    mockFetch((url) => {
      if (url.includes("/find/tt9990001")) return "hang"
      throw new Error(`leaked upstream fetch after /find abort: ${url}`)
    })
    const ctrl = new AbortController()
    const t = abortAfter(ctrl)
    const started = Date.now()
    const res = await metaGET(
      reqWithSignal("http://localhost:3000/meta/series/tt9990001.json?api_key=k", ctrl),
      metaParams("series", "tt9990001.json"),
    )
    const elapsed = Date.now() - started
    clearTimeout(t)

    expect(res.status).toBe(200)
    expect((await res.json()).meta).toBeNull()
    // No real 15s wait: the shared budget closes in milliseconds.
    expect(elapsed).toBeLessThan(5000)
    const finds = calls.filter((c) => c.url.includes("/find/"))
    expect(finds).toHaveLength(1)
    // Exact cancellation: the hanging /find was aborted ...
    expect(finds[0]!.sawAbort).toBe(true)
    // ... and NO later phase (details/images/seasons/groups) ever started.
    expect(calls).toHaveLength(1)
  })

  it("slow episode-group listing aborts exactly and never reaches group detail", async () => {
    mockFetch((url) => {
      if (url.includes("/tv/947001?")) {
        return Response.json({
          id: 947001,
          name: "Serie Budget",
          first_air_date: "2020-01-01",
          vote_average: 8.0,
          genres: [],
          seasons: [
            { season_number: 1, episode_count: 2 },
            { season_number: 2, episode_count: 1 },
          ],
        })
      }
      if (url.includes("/tv/947001/external_ids")) {
        return Response.json({ id: 947001, imdb_id: "tt9470010" })
      }
      if (url.includes("/tv/947001/images")) return Response.json({ id: 947001, logos: [] })
      if (url.includes("/tv/947001/episode_groups")) return "hang"
      // Standard seasons: with the budget already expired they reject immediately.
      if (url.includes("/tv/947001/season/")) throw new Error(`season fetch must abort, not run: ${url}`)
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const ctrl = new AbortController()
    const t = abortAfter(ctrl)
    const started = Date.now()
    const res = await metaGET(
      reqWithSignal("http://localhost:3000/meta/series/tmdb:947001.json?api_key=k", ctrl),
      metaParams("series", "tmdb:947001.json"),
    )
    const elapsed = Date.now() - started
    clearTimeout(t)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta).not.toBeNull()
    expect(body.meta.name).toBe("Serie Budget")
    expect(elapsed).toBeLessThan(5000)
    const listing = calls.filter((c) => c.url.includes("/episode_groups"))
    expect(listing).toHaveLength(1)
    expect(listing[0]!.sawAbort).toBe(true)
    // The group detail (later phase) never started ...
    expect(calls.some((c) => c.url.includes("/tv/episode_group/"))).toBe(false)
    // ... while the earlier phases (details + resolveImdbId) had completed
    // BEFORE the abort: total deadline over sequential phases.
    const ext = calls.find((c) => c.url.includes("/external_ids"))
    expect(ext?.responded).toBe(true)
    expect(ext?.sawAbort).toBe(false)
  })

  it("slow resolveImdbId aborts exactly and the meta still completes via tmdb: fallback", async () => {
    // Direct tmdb: id (no /find phase): details carry no imdb_id, so the
    // resolveImdbId path (external_ids) kicks in and stays hanging.
    mockFetch((url) => {
      if (url.includes("/movie/948001?")) {
        return Response.json({ id: 948001, title: "Film Budget", vote_average: 7.5, genres: [] })
      }
      if (url.includes("/movie/948001/external_ids")) return "hang"
      if (url.includes("/movie/948001/images")) throw new Error(`images must abort, not run: ${url}`)
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const ctrl = new AbortController()
    const t = abortAfter(ctrl)
    const started = Date.now()
    const res = await metaGET(
      reqWithSignal("http://localhost:3000/meta/movie/tmdb:948001.json?api_key=k", ctrl),
      metaParams("movie", "tmdb:948001.json"),
    )
    const elapsed = Date.now() - started
    clearTimeout(t)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta).not.toBeNull()
    expect(body.meta.poster).toContain("/api/poster/movie/948001")
    expect(elapsed).toBeLessThan(5000)
    const ext = calls.filter((c) => c.url.includes("/external_ids"))
    expect(ext).toHaveLength(1)
    expect(ext[0]!.sawAbort).toBe(true)
    // Later images performed no work: calls were already aborted.
    for (const c of calls.filter((c) => c.url.includes("/images"))) {
      expect(c.abortedAtStart).toBe(true)
      expect(c.responded).toBe(false)
    }
  })

  it("slow AniZip aborts exactly and never yields videos", async () => {
    mockedGetById.mockResolvedValue({ episodeGroupId: "anizip" } as unknown as Awaited<ReturnType<typeof getById>>)
    mockFetch((url) => {
      if (url.includes("/tv/949001?")) {
        return Response.json({
          id: 949001,
          name: "Serie AniZip",
          first_air_date: "2021-01-01",
          vote_average: 8.0,
          genres: [],
          external_ids: { imdb_id: "tt9490010" },
          seasons: [{ season_number: 1, episode_count: 2 }],
        })
      }
      if (url.includes("/tv/949001/images")) return Response.json({ id: 949001, logos: [] })
      if (url.includes("api.ani.zip")) return "hang"
      if (url.includes("/tv/949001/season/")) throw new Error(`season fetch must abort, not run: ${url}`)
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const ctrl = new AbortController()
    const t = abortAfter(ctrl)
    const started = Date.now()
    const res = await metaGET(
      reqWithSignal("http://localhost:3000/meta/series/tmdb:949001.json?api_key=k", ctrl),
      metaParams("series", "tmdb:949001.json"),
    )
    const elapsed = Date.now() - started
    clearTimeout(t)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta).not.toBeNull()
    expect(body.meta.videos).toBeUndefined()
    expect(elapsed).toBeLessThan(5000)
    const ani = calls.filter((c) => c.url.includes("api.ani.zip"))
    expect(ani).toHaveLength(1)
    expect(ani[0]!.sawAbort).toBe(true)
  })

  it("preview episodes: slow AniZip aborts exactly and answers empty without 15s waits", async () => {
    mockFetch((url) => {
      if (url.includes("/tv/949002?")) {
        return Response.json({
          id: 949002,
          name: "Preview AniZip",
          external_ids: { imdb_id: "tt9490020" },
          seasons: [{ season_number: 1, episode_count: 2, name: "Stagione 1" }],
        })
      }
      if (url.includes("api.ani.zip")) return "hang"
      if (url.includes("/tv/949002/season/")) throw new Error(`season fetch must abort, not run: ${url}`)
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const ctrl = new AbortController()
    const t = abortAfter(ctrl)
    const started = Date.now()
    const res = await previewGET(
      reqWithSignal("http://localhost:3000/api/preview/episodes?tmdbId=949002&episodeGroupId=anizip&api_key=k", ctrl),
    )
    const elapsed = Date.now() - started
    clearTimeout(t)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.videos).toEqual([])
    expect(elapsed).toBeLessThan(5000)
    const ani = calls.filter((c) => c.url.includes("api.ani.zip"))
    expect(ani).toHaveLength(1)
    expect(ani[0]!.sawAbort).toBe(true)
  })

  it("pre-aborted incoming signal: no upstream call performs any work", async () => {
    mockFetch((url) => {
      if (url.includes("/find/tt9500010")) return "hang"
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const ctrl = new AbortController()
    ctrl.abort()
    const started = Date.now()
    const res = await metaGET(
      reqWithSignal("http://localhost:3000/meta/movie/tt9500010.json?api_key=k", ctrl),
      metaParams("movie", "tt9500010.json"),
    )
    const elapsed = Date.now() - started

    expect(res.status).toBe(200)
    expect((await res.json()).meta).toBeNull()
    expect(elapsed).toBeLessThan(5000)
    expect(calls.length).toBeGreaterThan(0)
    // Exact: every attempt was already aborted and none ever responded.
    for (const c of calls) {
      expect(c.abortedAtStart).toBe(true)
      expect(c.responded).toBe(false)
    }
  })
})

describe("automatic 15s total timeout (no incoming abort)", () => {
  beforeEach(() => {
    calls = []
    mockedGetById.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.mocked(getServerDefaults).mockReturnValue({})
    vi.restoreAllMocks()
    mockedGetById.mockReset()
    cacheClear()
    __clearTMDBCache()
    __clearImdbCache()
    __clearAnizipCache()
    clearTvdbCache()
  })

  /**
   * Makes AbortSignal.timeout deterministic without waiting 15s: the route's
   * requested total budget (15000ms) maps to a manually-fired controller,
   * while every other (per-phase/per-fetch) timeout delegates to the real
   * implementation. Firing the captured controller simulates the total timer
   * expiring. (Native AbortSignal.timeout is not driven by fake timers, so a
   * controllable stand-in is the deterministic option.)
   */
  function controllableTotalTimeout() {
    const requestedMs: number[] = []
    const totalControllers: AbortController[] = []
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, "timeout").mockImplementation(
      ((ms: number) => {
        requestedMs.push(ms)
        if (ms === 15000) {
          const ctrl = new AbortController()
          totalControllers.push(ctrl)
          return ctrl.signal
        }
        return realTimeout(ms)
      }) as typeof AbortSignal.timeout,
    )
    return { requestedMs, totalControllers }
  }

  it("meta: total timer fires on its own; earlier phases keep their work, later phases reuse the expired budget", async () => {
    const { requestedMs, totalControllers } = controllableTotalTimeout()
    mockFetch((url) => {
      if (url.includes("/tv/951001?")) {
        // Details answer fast; the 15s total then expires before the next
        // phase starts, so images/seasons must derive from that same expired
        // budget instead of a renewed one.
        queueMicrotask(() => totalControllers[0]?.abort())
        return Response.json({
          id: 951001,
          name: "Total Budget",
          first_air_date: "2020-01-01",
          vote_average: 8.0,
          genres: [],
          external_ids: { imdb_id: "tt9510010" },
          seasons: [
            { season_number: 1, episode_count: 1 },
            { season_number: 2, episode_count: 1 },
          ],
        })
      }
      if (url.includes("/tv/951001/images")) return Response.json({ id: 951001, logos: [] })
      if (url.includes("/tv/951001/episode_groups")) return Response.json({ results: [] })
      if (url.includes("/tv/951001/season/")) return Response.json({ id: 1, season_number: 1, episodes: [] })
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const req = new NextRequest("http://localhost:3000/meta/series/tmdb:951001.json?api_key=k")
    const incomingSignal = (req as unknown as { signal?: AbortSignal }).signal
    const started = Date.now()
    const res = await metaGET(req, metaParams("series", "tmdb:951001.json"))
    const elapsed = Date.now() - started

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.meta).not.toBeNull()
    expect(body.meta.name).toBe("Total Budget")
    // No real 15s wait: the simulated timer fires in microseconds.
    expect(elapsed).toBeLessThan(5000)
    // The route requested exactly one 15s total budget: later phases derive
    // per-phase caps from it and never renew the total.
    expect(requestedMs.filter((ms) => ms === 15000)).toHaveLength(1)
    // The incoming signal was never aborted: cancellation came only from the total timer.
    expect(incomingSignal?.aborted).toBe(false)
    // Preceding phase (details) completed before the expiry and kept its work ...
    const details = calls.find((c) => c.url.includes("/tv/951001?"))
    expect(details?.responded).toBe(true)
    expect(details?.sawAbort).toBe(false)
    // ... while every later phase started already-aborted and performed no work.
    const later = calls.filter((c) => !c.url.includes("/tv/951001?"))
    expect(later.length).toBeGreaterThan(0)
    for (const c of later) {
      expect(c.abortedAtStart).toBe(true)
      expect(c.responded).toBe(false)
    }
  })

  it("preview: total timer fires on its own; seasons reuse the expired budget and answer empty", async () => {
    const { requestedMs, totalControllers } = controllableTotalTimeout()
    mockFetch((url) => {
      if (url.includes("/tv/952001?")) {
        // Details answer fast; the 15s total then expires before the season
        // phase starts, so seasons must derive from that same expired budget.
        queueMicrotask(() => totalControllers[0]?.abort())
        return Response.json({
          id: 952001,
          name: "Preview Total",
          external_ids: { imdb_id: "tt9520010" },
          seasons: [
            { season_number: 1, episode_count: 1, name: "Season 1" },
            { season_number: 2, episode_count: 1, name: "Season 2" },
          ],
        })
      }
      if (url.includes("/tv/952001/season/")) return Response.json({ id: 1, season_number: 1, episodes: [] })
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const req = new NextRequest("http://localhost:3000/api/preview/episodes?tmdbId=952001&api_key=k")
    const incomingSignal = (req as unknown as { signal?: AbortSignal }).signal
    const started = Date.now()
    const res = await previewGET(req)
    const elapsed = Date.now() - started

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.videos).toEqual([])
    expect(elapsed).toBeLessThan(5000)
    // Exactly one 15s total budget: the season phase derives from it and never renews it.
    expect(requestedMs.filter((ms) => ms === 15000)).toHaveLength(1)
    // The incoming signal was never aborted: cancellation came only from the total timer.
    expect(incomingSignal?.aborted).toBe(false)
    // Details completed before the expiry ...
    const details = calls.find((c) => c.url.includes("/tv/952001?"))
    expect(details?.responded).toBe(true)
    expect(details?.sawAbort).toBe(false)
    // ... while every season fetch started already-aborted and performed no work.
    const seasons = calls.filter((c) => c.url.includes("/season/"))
    expect(seasons.length).toBeGreaterThan(0)
    for (const c of seasons) {
      expect(c.abortedAtStart).toBe(true)
      expect(c.responded).toBe(false)
    }
  })
})

describe("budget-aware helper signal args (backward compatible)", () => {
  beforeEach(() => {
    calls = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
    __clearTMDBCache()
    __clearImdbCache()
    __clearAnizipCache()
  })

  it("resolveImdbId honors a pre-aborted signal and resolves null", async () => {
    mockFetch(() => Response.json({ id: 960001, imdb_id: "tt9600010" }))
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(resolveImdbId("movie", 960001, "k", 5000, ctrl.signal)).resolves.toBeNull()
    const ext = calls.filter((c) => c.url.includes("/external_ids"))
    expect(ext).toHaveLength(1)
    expect(ext[0]!.abortedAtStart).toBe(true)
    expect(ext[0]!.responded).toBe(false)
  })

  it("resolveDefaultEpisodeGroupId honors a pre-aborted signal and resolves null", async () => {
    mockFetch(() => Response.json({ results: [] }))
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(resolveDefaultEpisodeGroupId(960002, 3, 41, "k", undefined, ctrl.signal)).resolves.toBeNull()
    const listing = calls.filter((c) => c.url.includes("/episode_groups"))
    expect(listing).toHaveLength(1)
    expect(listing[0]!.abortedAtStart).toBe(true)
    expect(listing[0]!.responded).toBe(false)
  })

  it("buildVideosFromAnizip honors a pre-aborted signal without fetching", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"))
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(buildVideosFromAnizip(960003, "tt9600030", ctrl.signal)).resolves.toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it("AniZip cache hits are preserved even when the signal is already aborted", async () => {
    mockFetch((url) => {
      if (url.includes("api.ani.zip")) {
        return Response.json({
          episodes: {
            e1: { seasonNumber: 1, episodeNumber: 1, title: { en: "Pilot" } },
          },
        })
      }
      throw new Error(`unexpected upstream fetch: ${url}`)
    })
    const videos = await buildVideosFromAnizip(960004, "tt9600040")
    expect(videos).toHaveLength(1)
    expect(calls.filter((c) => c.url.includes("api.ani.zip"))).toHaveLength(1)

    vi.restoreAllMocks()
    calls = []
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("cache hit must not fetch"))
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(buildVideosFromAnizip(960004, "tt9600040", ctrl.signal)).resolves.toEqual(videos)
    expect(spy).not.toHaveBeenCalled()
  })
})
