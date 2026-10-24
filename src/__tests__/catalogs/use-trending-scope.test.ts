import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { http, userFetch } from "@/lib/http"
import { useTrending, type TrendingScope } from "@/lib/useTrending"

vi.mock("@/lib/http", () => ({ http: vi.fn(), userFetch: vi.fn() }))
const mockToast = Object.assign(vi.fn(), { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() })
vi.mock("sonner", () => ({ toast: mockToast }))

const mockedHttp = vi.mocked(http)
const mockedUserFetch = vi.mocked(userFetch)

// Disjoint rows per token scope: stale-source writes are observable by id.
function trendPayload(prefix: number) {
  return {
    movies: [{ id: prefix + 1, media_type: "movie", rank: 1 }],
    tv: [{ id: prefix + 2, media_type: "tv", rank: 1 }],
  }
}

function animePayload() {
  return [{ id: 900, title: "Anime", poster_path: "/a.jpg", rank: 1, media_type: "tv" }]
}

function animeResponse(items: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => items,
  } as unknown as Response
}

function routeHttpByToken() {
  mockedHttp.mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.includes("/api/tmdb/trending/tv/week")) return { results: [] } as never
    if (u.includes("/api/tmdb/trending")) {
      if (u.includes("config=tok-b")) return trendPayload(200) as never
      return trendPayload(100) as never
    }
    throw new Error(`unexpected url ${u}`)
  })
  mockedUserFetch.mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.includes("/api/mdblist/anime")) return animeResponse(animePayload())
    throw new Error(`unexpected url ${u}`)
  })
}

function animeCalls() {
  return mockedUserFetch.mock.calls.filter(([url]) => String(url).includes("/api/mdblist/anime"))
}

function trendingUrls() {
  return mockedHttp.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/api/tmdb/trending") && !u.includes("tv/week"))
}

function flush() {
  return act(async () => {
    await Promise.resolve()
  })
}

describe("useTrending Top 20 scope", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  })

  it("carries namespace and device token on the Top 20 request", async () => {
    routeHttpByToken()
    const scope: TrendingScope = {
      movieSource: "jw:popular",
      seriesSource: "",
      userId: "user-1",
      configToken: "tok-a",
      tokenStatus: "ready",
    }
    const { result } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), { initialProps: { s: scope } })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    const urls = trendingUrls()
    expect(urls.length).toBeGreaterThan(0)
    expect(urls[0]).toContain("u=user-1")
    expect(urls[0]).toContain("config=tok-a")
    expect(result.current.trending.map((r) => r.id)).toEqual([101, 102])
  })

  it("replaces rows on source switch without refetching anime", async () => {
    routeHttpByToken()
    const mkScope = (configToken: string): TrendingScope => ({
      movieSource: "jw:popular",
      seriesSource: "",
      userId: "user-1",
      configToken,
      tokenStatus: "ready",
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope("tok-a") },
    })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.trending.map((r) => r.id)).toEqual([101, 102])
    const animeCallsBefore = animeCalls().length
    expect(animeCallsBefore).toBe(1)
    rerender({ s: mkScope("tok-b") })
    await waitFor(() => expect(result.current.trending.map((r) => r.id)).toEqual([201, 202]), { timeout: 2000 })
    // Same mounted state, disjoint rows: the switch replaced the content.
    expect(result.current.trendingStatus).toBe("ready")
    // Anime untouched by the Top 20 switch (no blind refetch).
    expect(animeCalls().length).toBe(animeCallsBefore)
  })

  it("ignores a stale source response that resolves late", async () => {
    let releaseSlow!: (v: unknown) => void
    const slow = new Promise((resolve) => { releaseSlow = resolve })
    mockedHttp.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes("/api/tmdb/trending/tv/week")) return { results: [] } as never
      if (u.includes("/api/tmdb/trending")) {
        if (u.includes("config=tok-slow")) return slow as never
        return trendPayload(200) as never
      }
      throw new Error(`unexpected url ${u}`)
    })
    mockedUserFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/mdblist/anime")) return animeResponse(animePayload())
      throw new Error(`unexpected url ${url}`)
    })
    const mkScope = (configToken: string): TrendingScope => ({
      movieSource: "custom-slow",
      seriesSource: "",
      userId: "user-1",
      configToken,
      tokenStatus: "ready",
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope("tok-slow") },
    })
    await flush()
    // Switch scope while the first response is still in flight.
    rerender({ s: { ...mkScope("tok-fast"), movieSource: "jw:popular" } })
    await waitFor(() => expect(result.current.trending.map((r) => r.id)).toEqual([201, 202]), { timeout: 2000 })
    // The stale slow response resolves after the switch: dropped, not stamped.
    await act(async () => {
      releaseSlow(trendPayload(100))
      await Promise.resolve()
    })
    await flush()
    expect(result.current.trending.map((r) => r.id)).toEqual([201, 202])
  })

  it("manual refresh respects the current scope", async () => {
    routeHttpByToken()
    const scope: TrendingScope = {
      movieSource: "jw:popular",
      seriesSource: "",
      userId: "user-9",
      configToken: "tok-a",
      tokenStatus: "ready",
    }
    const { result } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), { initialProps: { s: scope } })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    mockToast.mockClear()
    await act(async () => {
      await result.current.refreshLists()
    })
    const urls = trendingUrls()
    const last = urls[urls.length - 1]
    expect(last).toContain("u=user-9")
    expect(last).toContain("config=tok-a")
    expect(result.current.trending.map((r) => r.id)).toEqual([101, 102])
  })

  it("suspends on pending token and resumes on ready without silent defaults", async () => {
    routeHttpByToken()
    const mkScope = (tokenStatus: TrendingScope["tokenStatus"]): TrendingScope => ({
      movieSource: "trakt-movies",
      seriesSource: "",
      userId: "user-1",
      configToken: null,
      tokenStatus,
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope("pending") },
    })
    await flush()
    // No Top 20 fetch while the device selection is minting (never the
    // empty-namespace charts as a silent stand-in).
    expect(trendingUrls()).toHaveLength(0)
    expect(result.current.trendingStatus).toBe("loading")
    expect(result.current.trending).toEqual([])
    rerender({ s: { ...mkScope("ready"), configToken: "tok-a" } })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    const urls = trendingUrls()
    expect(urls.length).toBeGreaterThan(0)
    expect(urls[0]).toContain("config=tok-a")
  })

  it("surfaces token error instead of silent charts", async () => {
    routeHttpByToken()
    const { result } = renderHook(() => useTrending("k", "m", "IT", false, {
      movieSource: "trakt-movies",
      seriesSource: "",
      userId: "user-1",
      configToken: null,
      tokenStatus: "error",
    }))
    await flush()
    expect(trendingUrls()).toHaveLength(0)
    expect(result.current.trendingStatus).toBe("error")
    expect(result.current.trendingError).toBe(true)
  })

  it("refetches on ranking-save nonce even with identical scope", async () => {
    routeHttpByToken()
    const mkScope = (rankNonce: number): TrendingScope => ({
      movieSource: "",
      seriesSource: "",
      userId: null,
      configToken: null,
      tokenStatus: "off",
      rankNonce,
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope(0) },
    })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    const callsBefore = trendingUrls().length
    rerender({ s: mkScope(1) })
    await waitFor(() => expect(trendingUrls().length).toBeGreaterThan(callsBefore), { timeout: 2000 })
  })

  it("suspends fetch and clears previous titles while saveStatus is saving, then fetches once on ready without duplicate calls", async () => {
    routeHttpByToken()
    const mkScope = (saveStatus: TrendingScope["saveStatus"], movieSource: string): TrendingScope => ({
      movieSource,
      seriesSource: "",
      userId: null,
      configToken: null,
      tokenStatus: "off",
      saveStatus,
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope("ready", "") },
    })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.trending.map((r) => r.id)).toEqual([101, 102])
    const callsBefore = trendingUrls().length
    expect(callsBefore).toBe(1)

    // User picks new source: local save is initiated (saveStatus="saving")
    rerender({ s: mkScope("saving", "jw:popular") })
    await flush()
    // Old titles are immediately cleared, status is loading, and NO new HTTP call is sent while saving
    expect(result.current.trending).toEqual([])
    expect(result.current.trendingStatus).toBe("loading")
    expect(trendingUrls().length).toBe(callsBefore)

    // Server save completes (saveStatus="ready")
    rerender({ s: mkScope("ready", "jw:popular") })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    // Exactly ONE new call was made (total calls = callsBefore + 1) — no duplicates!
    expect(trendingUrls().length).toBe(callsBefore + 1)
  })

  it("surfaces saveStatus error explicitly without false success", async () => {
    routeHttpByToken()
    const { result } = renderHook(() => useTrending("k", "m", "IT", false, {
      movieSource: "jw:popular",
      seriesSource: "",
      userId: null,
      configToken: null,
      tokenStatus: "off",
      saveStatus: "error",
    }))
    await flush()
    expect(trendingUrls()).toHaveLength(0)
    expect(result.current.trending).toEqual([])
    expect(result.current.trendingStatus).toBe("error")
  })
})

describe("useTrending publication stamps", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  })

  function bodyWithStamps(movies: unknown[], tv: unknown[], updatedAt: unknown) {
    return { movies, tv, updatedAt }
  }

  const scope: TrendingScope = {
    movieSource: "",
    seriesSource: "",
    userId: null,
    configToken: null,
    tokenStatus: "off",
    saveStatus: "idle",
    rankNonce: 0,
  }

  it("exposes per-slot stamps from the served body and clears them on scope change", async () => {
    mockedHttp.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes("/api/tmdb/trending")) {
        return bodyWithStamps(
          [{ id: 1, media_type: "movie", rank: 1 }],
          [{ id: 2, media_type: "tv", rank: 1 }],
          { movie: 1761331200000, series: 1761334800000 },
        ) as never
      }
      throw new Error(`unexpected url ${u}`)
    })
    mockedUserFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/mdblist/anime")) return animeResponse([])
      throw new Error(`unexpected url ${url}`)
    })
    const { result } = renderHook(
      ({ s }: { s: TrendingScope }) => useTrending("k", "m", "IT", false, s),
      { initialProps: { s: scope } },
    )
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    // Distinct per-slot stamps from the served snapshot (never page clock).
    expect(result.current.trendingUpdatedAt).toEqual({ movie: 1761331200000, series: 1761334800000 })
    expect(result.current.trendingUpdatedAt?.movie).not.toBe(result.current.trendingUpdatedAt?.series)
  })

  it("clears stamps while a scope change refetches (never the stale stamp)", async () => {
    let release!: (v: unknown) => void
    const gate = new Promise((resolve) => { release = resolve })
    let calls = 0
    mockedHttp.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/tmdb/trending")) {
        calls += 1
        if (calls === 1) {
          return bodyWithStamps(
            [{ id: 1, media_type: "movie", rank: 1 }],
            [],
            { movie: 1761331200000, series: null },
          ) as never
        }
        return gate as never
      }
      throw new Error("unexpected url")
    })
    mockedUserFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/mdblist/anime")) return animeResponse([])
      throw new Error("unexpected url")
    })
    const { result, rerender } = renderHook(
      ({ s }: { s: TrendingScope }) => useTrending("k", "m", "IT", false, s),
      { initialProps: { s: scope } },
    )
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.trendingUpdatedAt).toEqual({ movie: 1761331200000, series: null })
    rerender({ s: { ...scope, rankNonce: 1 } })
    await act(async () => {})
    // New fetch in flight: rows AND stamps cleared, never the stale pair.
    expect(result.current.trending).toEqual([])
    expect(result.current.trendingUpdatedAt).toBeNull()
    await act(async () => {
      release(bodyWithStamps(
        [{ id: 201, media_type: "movie", rank: 1 }],
        [],
        { movie: 1761338400000, series: null },
      ))
    })
    await waitFor(() => expect(result.current.trending.map((r) => r.id)).toEqual([201]), { timeout: 2000 })
    expect(result.current.trendingUpdatedAt).toEqual({ movie: 1761338400000, series: null })
  })

  it("treats missing or invalid stamps as unknown, not as fresh", async () => {
    const bodies = [
      {},
      { updatedAt: null },
      { updatedAt: { movie: "yesterday", series: -5 } },
      { updatedAt: { movie: 0, series: Number.NaN } },
    ]
    mockedHttp.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/tmdb/trending/tv/week")) return { results: [] }
      throw new Error("unexpected trending url")
    })
    for (const body of bodies) {
      mockedHttp.mockResolvedValueOnce({ movies: [{ id: 1, media_type: "movie", rank: 1 }], tv: [], ...body } as never)
      mockedUserFetch.mockImplementation(async () => animeResponse([]))
      const { result, unmount } = renderHook(() => useTrending("k", "m", "IT", false, scope))
      await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
      expect(result.current.trendingUpdatedAt).toEqual({ movie: null, series: null })
      unmount()
      vi.clearAllMocks()
    }
  })

  it("reads anime stamps from response headers and keeps a cache reload identical", async () => {
    const stamps = { "x-pictorium-updated-at-movie": "1761331200000", "x-pictorium-updated-at-series": "1761334800000" }
    mockedHttp.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/tmdb/trending")) return trendPayload(100) as never
      throw new Error(`unexpected url ${url}`)
    })
    mockedUserFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/mdblist/anime")) return animeResponse(animePayload(), stamps)
      throw new Error(`unexpected url ${url}`)
    })
    const { result } = renderHook(() => useTrending("k", "m", "IT", false, scope))
    await waitFor(() => expect(result.current.animeStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.animeUpdatedAt).toEqual({ movie: 1761331200000, series: 1761334800000 })
    // Manual refresh re-reads the same pinned stamp from the server (never
    // the client clock): one more anime fetch, identical stamps.
    const before = animeCalls().length
    await act(async () => {
      await result.current.refreshLists()
    })
    expect(animeCalls().length).toBeGreaterThan(before)
    expect(result.current.animeUpdatedAt).toEqual({ movie: 1761331200000, series: 1761334800000 })
  })

  it("drops anime stamps on transport failure instead of retaining them", async () => {
    mockedHttp.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/tmdb/trending/tv/week")) throw new Error("down")
      if (String(url).includes("/api/tmdb/trending")) return trendPayload(100) as never
      throw new Error(`unexpected url ${url}`)
    })
    mockedUserFetch.mockRejectedValueOnce(new Error("down"))
    const { result } = renderHook(() => useTrending("k", "m", "IT", false, scope))
    await waitFor(() => expect(result.current.animeStatus).toBe("error"), { timeout: 2000 })
    // Unknown stays unknown: no stamp object is minted on failure.
    expect(result.current.animeUpdatedAt).toBeNull()
  })
})
