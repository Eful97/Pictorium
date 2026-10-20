import { afterEach, describe, expect, it, vi } from "vitest"
import {
  __clearTMDBCache,
  __resetKey401Cache,
  getDetails,
  getImages,
  getTmdbInflightSize,
} from "@/lib/tmdb"

// Regression: a TMDB upstream that never settles must not poison the shared
// neutral-URL inflight entry forever. Waiters escape via their own cap, but
// the OWNER awaited the shared promise directly with no forced settlement:
// - headers arrived but `res.json()` stalled -> `await res.json()` hung with
//   no signal and no deadline;
// - a transport ignoring abort -> `timedFetch` hung despite the owner signal.
// Either way the entry survived (`.finally` never ran), so every later caller
// on the SAME key coalesced onto the dead promise and 502'd at its own cap
// while other keys (e.g. another language order) stayed healthy — the exact
// selective-hang signature seen in prod (same URL 502s, permutation 200).

/** Transport that never settles and ignores abort (non-cooperative). */
function mockNeverSettlingFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}))
}

/** Headers resolve at once, but the body never completes. */
function mockBodyHangingFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      ({
        status: 200,
        ok: true,
        json: () => new Promise<unknown>(() => {}),
      }) as unknown as Response,
  )
}

function mockHealthyImages(id: number) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ id, backdrops: [], posters: [], logos: [] }))
}

afterEach(() => {
  vi.restoreAllMocks()
  __clearTMDBCache()
  __resetKey401Cache()
})

describe("tmdbFetch owner deadline vs poisoned inflight entry", () => {
  it("headers stall: owner rejects at its own cap, entry freed, same key recovers", async () => {
    const before = getTmdbInflightSize()
    mockNeverSettlingFetch()
    const start = Date.now()
    await expect(getImages("tv", 918001, "it,en,null", "poison-hdr", undefined, 200)).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(2500)
    expect(getTmdbInflightSize()).toBe(before)
    vi.restoreAllMocks()
    mockHealthyImages(918001)
    const data = await getImages("tv", 918001, "it,en,null", "poison-hdr", undefined, 5000)
    expect(data.id).toBe(918001)
    expect(getTmdbInflightSize()).toBe(before)
  }, 8000)

  it("body stall after headers: owner rejects at its own cap, entry freed, same key recovers", async () => {
    const before = getTmdbInflightSize()
    mockBodyHangingFetch()
    const start = Date.now()
    await expect(getImages("tv", 918002, "it,en,null", "poison-body", undefined, 200)).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(2500)
    expect(getTmdbInflightSize()).toBe(before)
    vi.restoreAllMocks()
    mockHealthyImages(918002)
    const data = await getImages("tv", 918002, "it,en,null", "poison-body", undefined, 5000)
    expect(data.id).toBe(918002)
    expect(getTmdbInflightSize()).toBe(before)
  }, 8000)

  it("late settlement of a timed-out owner neither evicts the new entry nor overwrites its cache", async () => {
    const before = getTmdbInflightSize()
    let resolveStaleHeaders!: (res: Response) => void
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      if (fetchMock.mock.calls.length === 1) {
        return new Promise<Response>((resolve) => {
          resolveStaleHeaders = resolve
        })
      }
      return Promise.resolve(
        Response.json({ id: 918003, genres: [], vote_average: 9.9, vote_count: 10 }),
      )
    })
    // Stale owner: hangs on headers, must reject at its own cap.
    await expect(getDetails("movie", 918003, "it-IT", "stale-key", undefined, 150)).rejects.toThrow()
    expect(getTmdbInflightSize()).toBe(before)
    // Fresh owner on the same key: healthy upstream, caches its own value.
    const fresh = await getDetails("movie", 918003, "it-IT", "stale-key", undefined, 5000)
    expect(fresh.vote_average).toBe(9.9)
    // The stale transport finally answers with a DIFFERENT payload: it must
    // not clobber the fresh cache entry nor delete the (already settled) key.
    resolveStaleHeaders(
      Response.json({ id: 918003, genres: [], vote_average: 1.1, vote_count: 1 }),
    )
    await new Promise((r) => setTimeout(r, 150))
    expect(getTmdbInflightSize()).toBe(before)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const cached = await getDetails("movie", 918003, "it-IT", "stale-key", undefined, 5000)
    expect(cached.vote_average).toBe(9.9)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  }, 8000)

  it("waiter abort exits early without evicting a healthy owner; one upstream serves both", async () => {
    const before = getTmdbInflightSize()
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(Response.json({ id: 918004, genres: [], vote_average: 7, vote_count: 10 }))
        }, 250)
        ;(init?.signal as AbortSignal | undefined)?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer)
            reject(new DOMException("The operation was aborted", "AbortError"))
          },
          { once: true },
        )
      })
    })
    const owner = getDetails("movie", 918004, "it-IT", "shared-key", undefined, 5000)
    await new Promise((r) => setTimeout(r, 50))
    const start = Date.now()
    await expect(
      getDetails("movie", 918004, "it-IT", "shared-key", AbortSignal.timeout(100), 10000),
    ).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(2000)
    // Healthy owner untouched by the waiter abort: resolves with its data.
    const data = await owner
    expect(data.id).toBe(918004)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getTmdbInflightSize()).toBe(before)
  }, 8000)

  it("upstream HTTP error rejects without caching and frees the key", async () => {
    const before = getTmdbInflightSize()
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("boom", { status: 500 }))
    await expect(getDetails("movie", 918005, "it-IT", "err-key", undefined, 2000)).rejects.toThrow(
      "TMDB fetch failed: 500",
    )
    expect(getTmdbInflightSize()).toBe(before)
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ id: 918005, genres: [], vote_average: 7, vote_count: 10 }),
    )
    const data = await getDetails("movie", 918005, "it-IT", "err-key", undefined, 5000)
    expect(data.id).toBe(918005)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getTmdbInflightSize()).toBe(before)
  }, 8000)
})
