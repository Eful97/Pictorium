import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { http } from "@/lib/http"
import { useTrending } from "@/lib/useTrending"

vi.mock("@/lib/http", () => ({ http: vi.fn() }))
const mockToast = Object.assign(vi.fn(), { warning: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() })
vi.mock("sonner", () => ({ toast: mockToast }))

const mockedHttp = vi.mocked(http)

function trendPayload(movies = 2, tv = 1) {
  const m = Array.from({ length: movies }, (_, i) => ({ id: 100 + i, media_type: "movie", rank: i + 1 }))
  const s = Array.from({ length: tv }, (_, i) => ({ id: 200 + i, media_type: "tv", rank: i + 1 }))
  return { movies: m, tv: s }
}

function animePayload(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: 300 + i, title: `A${i}`, poster_path: "/a.jpg", rank: i + 1, media_type: "tv" }))
}

function chartPayload() {
  return {
    movies: [{ id: 1, media_type: "movie" }],
    tv: [{ id: 2, media_type: "tv" }],
  }
}

/** Smista le risposte http in base al path chiamato. */
function routeHttp(opts: {
  trending?: unknown
  trendingError?: unknown
  anime?: unknown
  animeError?: unknown
  fallback?: unknown
  fallbackError?: unknown
  platforms?: Record<string, unknown>
  platformErrors?: string[]
}) {
  mockedHttp.mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.includes("/api/tmdb/trending/tv/week")) {
      if (opts.fallbackError) throw opts.fallbackError
      return (opts.fallback ?? { results: [] }) as never
    }
    if (u.includes("/api/tmdb/trending")) {
      if (opts.trendingError) throw opts.trendingError
      return (opts.trending ?? trendPayload()) as never
    }
    if (u.includes("/api/mdblist/anime")) {
      if (opts.animeError) throw opts.animeError
      return (opts.anime ?? animePayload(6)) as never
    }
    if (u.includes("/api/flixpatrol/top10")) {
      const slug = new URL(u, "https://x.test").searchParams.get("platform") ?? ""
      if (opts.platformErrors?.includes(slug)) throw new Error(`fp ${slug} down`)
      return ((opts.platforms?.[slug]) ?? chartPayload()) as never
    }
    throw new Error(`unexpected url ${u}`)
  })
}

function flush() {
  return act(async () => {
    await Promise.resolve()
  })
}

describe("useTrending stati e refresh", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  })

  it("senza chiave: stati idle, nessun fetch", async () => {
    routeHttp({})
    const { result } = renderHook(() => useTrending("", "", "IT", false))
    await flush()
    expect(mockedHttp).not.toHaveBeenCalled()
    expect(result.current.trendingStatus).toBe("idle")
    expect(result.current.animeStatus).toBe("idle")
    expect(result.current.trending).toEqual([])
  })

  it("successo con dati: ready per trending e anime", async () => {
    routeHttp({})
    const { result } = renderHook(() => useTrending("k", "m", "IT", false))
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.trending).toHaveLength(3)
    expect(result.current.trendingError).toBe(false)
    expect(result.current.animeStatus).toBe("ready")
    expect(result.current.mdblistAnimeList).toHaveLength(6)
  })

  it("trending vuoto: empty, non errore", async () => {
    routeHttp({ trending: { movies: [], tv: [] } })
    const { result } = renderHook(() => useTrending("k", "m", "IT", false))
    await waitFor(() => expect(result.current.trendingStatus).toBe("empty"), { timeout: 2000 })
    expect(result.current.trendingError).toBe(false)
  })

  it("trending in errore: error, anime indipendente resta", async () => {
    routeHttp({ trendingError: new Error("jw down") })
    const { result } = renderHook(() => useTrending("k", "m", "IT", false))
    await waitFor(() => expect(result.current.trendingStatus).toBe("error"), { timeout: 2000 })
    expect(result.current.trendingError).toBe(true)
    expect(result.current.animeStatus).toBe("ready")
  })

  it("anime vuoto da MDBList: fallback TMDB usato", async () => {
    routeHttp({
      anime: [],
      fallback: { results: [{ id: 9, title: "Fallback", poster_path: "/f.jpg", media_type: "tv" }] },
    })
    const { result } = renderHook(() => useTrending("k", "", "IT", false))
    await waitFor(() => expect(result.current.animeStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.mdblistAnimeList).toHaveLength(1)
  })

  it("refresh tutto ok: toast successo, nonce bumpato", async () => {
    routeHttp({})
    const { result } = renderHook(() => useTrending("k", "m", "IT", false))
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    mockToast.mockClear()
    ;(mockToast.warning as ReturnType<typeof vi.fn>).mockClear()
    const before = result.current.refreshNonce
    await act(async () => {
      await result.current.refreshLists()
    })
    expect(result.current.refreshNonce).toBe(before + 1)
    expect(mockToast).toHaveBeenCalledWith("ui.listsRefreshed")
    expect(mockToast.warning).not.toHaveBeenCalledWith("ui.listsPartial")
    expect(result.current.platformErrors).toEqual({})
  })

  it("refresh parziale: warning riconoscibile, dati vecchi conservati, errori piattaforma registrati", async () => {
    routeHttp({ platformErrors: ["netflix"] })
    const { result } = renderHook(() => useTrending("k", "m", "IT", false))
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    mockToast.mockClear()
    ;(mockToast.warning as ReturnType<typeof vi.fn>).mockClear()
    await act(async () => {
      await result.current.refreshLists()
    })
    expect(mockToast).not.toHaveBeenCalledWith("ui.listsRefreshed")
    expect(mockToast.warning).toHaveBeenCalledWith("ui.listsPartial")
    expect(result.current.platformErrors["netflix"]).toBe(true)
    // I dati riusciti restano (trending + altre piattaforme)
    expect(result.current.trending.length).toBeGreaterThan(0)
    expect(result.current.trendingStatus).toBe("ready")
  })

  it("waits for custom catalogs before reporting refresh completion", async () => {
    const { result } = renderHook(() => useTrending("", "", "IT", false))
    let complete!: (failures: number) => void
    let refresh!: Promise<void>
    await act(async () => {
      refresh = result.current.refreshLists(() => new Promise(resolve => { complete = resolve }))
      await Promise.resolve()
    })
    expect(mockToast).not.toHaveBeenCalledWith("ui.listsRefreshed")
    await act(async () => { complete(1); await refresh })
    expect(mockToast.warning).toHaveBeenCalledWith("ui.listsPartial")
  })

  it("refresh con rate-limit: secondo invio ravvicinato non rifetcha", async () => {
    routeHttp({})
    const { result } = renderHook(() => useTrending("k", "m", "IT", false))
    await waitFor(() => expect(result.current.trendingStatus).toBe("ready"), { timeout: 2000 })
    const callsAfterMount = mockedHttp.mock.calls.length
    await act(async () => {
      await result.current.refreshLists()
    })
    const callsAfterFirst = mockedHttp.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(callsAfterMount)
    mockToast.mockClear()
    await act(async () => {
      await result.current.refreshLists()
    })
    expect(mockedHttp.mock.calls.length).toBe(callsAfterFirst)
    expect(mockToast).toHaveBeenCalledWith("ui.refreshRateLimit")
  })
})
