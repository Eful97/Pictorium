import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { http, userFetch } from "@/lib/http"
import { useTrending, type TrendingScope } from "@/lib/useTrending"

vi.mock("@/lib/http", () => ({ http: vi.fn(), userFetch: vi.fn() }))
const mockToast = Object.assign(vi.fn(), { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() })
vi.mock("sonner", () => ({ toast: mockToast }))

const mockedHttp = vi.mocked(http)
const mockedUserFetch = vi.mocked(userFetch)

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

function routeHttp() {
  mockedHttp.mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.includes("/api/tmdb/trending/tv/week")) return { results: [] } as never
    if (u.includes("/api/tmdb/trending")) return trendPayload(100) as never
    throw new Error(`unexpected url ${u}`)
  })
  // Production fetches the anime list via userFetch (header access for the
  // per-slot publication stamps), same timeout/abort semantics as http.
  mockedUserFetch.mockImplementation(async (url: string) => {
    if (String(url).includes("/api/mdblist/anime")) return animeResponse(animePayload())
    throw new Error(`unexpected url ${url}`)
  })
}

function trendingUrls() {
  return mockedHttp.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/api/tmdb/trending") && !u.includes("tv/week"))
}

function animeUrls() {
  return mockedUserFetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes("/api/mdblist/anime"))
}

function flush() {
  return act(async () => {
    await Promise.resolve()
  })
}

describe("useTrending manual refresh during ranking saves", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  })

  it("refreshLists while saving skips the trend endpoint but still refreshes anime", async () => {
    routeHttp()
    const mkScope = (saveStatus: TrendingScope["saveStatus"]): TrendingScope => ({
      movieSource: "",
      seriesSource: "",
      userId: null,
      configToken: null,
      tokenStatus: "off",
      saveStatus,
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope("idle") },
    })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    const trendBefore = trendingUrls().length
    expect(trendBefore).toBeGreaterThan(0)
    const animeBefore = animeUrls().length

    // A ranking save starts: rows clear immediately, no trend fetch on the
    // stale server config.
    rerender({ s: mkScope("saving") })
    await flush()
    expect(result.current.trending).toEqual([])
    expect(result.current.trendingStatus).toBe("loading")
    expect(trendingUrls().length).toBe(trendBefore)

    // Manual refresh during the save: never hits the trend endpoint with the
    // old config; anime/platform refresh stays independent.
    mockToast.mockClear()
    await act(async () => {
      await result.current.refreshLists()
    })
    expect(trendingUrls().length).toBe(trendBefore)
    expect(animeUrls().length).toBeGreaterThan(animeBefore)
    expect(result.current.mdblistAnimeList.length).toBeGreaterThan(0)
    // Trend rows stay effect-owned (untouched, still loading) and the toast
    // stays honest: no false success while the trend refresh was skipped.
    expect(result.current.trending).toEqual([])
    expect(result.current.trendingStatus).toBe("loading")
    expect(mockToast).not.toHaveBeenCalledWith("ui.listsRefreshed")
    expect(mockToast.warning).toHaveBeenCalledWith("ui.listsPartial")
  })

  it("refreshLists while the save failed stays explicit and never stamps stale success", async () => {
    routeHttp()
    const mkScope = (saveStatus: TrendingScope["saveStatus"]): TrendingScope => ({
      movieSource: "",
      seriesSource: "",
      userId: null,
      configToken: null,
      tokenStatus: "off",
      saveStatus,
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope("idle") },
    })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    const trendBefore = trendingUrls().length

    rerender({ s: mkScope("error") })
    await flush()
    expect(result.current.trendingStatus).toBe("error")

    mockToast.mockClear()
    await act(async () => {
      await result.current.refreshLists()
    })
    expect(trendingUrls().length).toBe(trendBefore)
    expect(result.current.trendingStatus).toBe("error")
    expect(result.current.trending).toEqual([])
    expect(mockToast).not.toHaveBeenCalledWith("ui.listsRefreshed")
    expect(mockToast.warning).toHaveBeenCalledWith("ui.listsPartial")
    // Anime is independent of the Top 20 save outcome.
    expect(result.current.animeStatus).toBe("ready")
  })

  it("save cycle saving -> ready with nonce refetches the trend exactly once", async () => {
    routeHttp()
    const mkScope = (saveStatus: TrendingScope["saveStatus"], rankNonce: number): TrendingScope => ({
      movieSource: "jw:popular",
      seriesSource: "",
      userId: null,
      configToken: null,
      tokenStatus: "off",
      saveStatus,
      rankNonce,
    })
    const { result, rerender } = renderHook(({ s }) => useTrending("k", "m", "IT", false, s), {
      initialProps: { s: mkScope("idle", 0) },
    })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(trendingUrls().length).toBe(1)

    rerender({ s: mkScope("saving", 0) })
    await flush()
    expect(trendingUrls().length).toBe(1)

    // Single acknowledged save: one nonce, one trend GET — no redundant fetch.
    rerender({ s: mkScope("ready", 1) })
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(trendingUrls().length).toBe(2)

    mockToast.mockClear()
    await act(async () => {
      await result.current.refreshLists()
    })
    expect(trendingUrls().length).toBe(3)
    expect(result.current.trendingStatus).toBe("ready")
    expect(mockToast).toHaveBeenCalledWith("ui.listsRefreshed")
  })
})
