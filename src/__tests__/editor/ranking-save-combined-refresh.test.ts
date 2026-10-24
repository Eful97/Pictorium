import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn(), http: vi.fn() }))
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
  notifyProfilelessOnce: vi.fn(),
  shouldSkipServerSync: vi.fn().mockResolvedValue(false),
}))
const mockToast = Object.assign(vi.fn(), {
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
})
vi.mock("sonner", () => ({ toast: mockToast }))

import { userFetch, http } from "@/lib/http"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { useRankingSources } from "@/lib/useRankingSources"
import { useTrending } from "@/lib/useTrending"

const mockedUserFetch = vi.mocked(userFetch)
const mockedHttp = vi.mocked(http)
const mockedSkip = vi.mocked(shouldSkipServerSync)

function memStore(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  const get = (k: string) => map.get(k) ?? null
  const set = (k: string, v: string) => {
    map.set(k, v)
  }
  return { get, set }
}

const okPut = { ok: true, status: 200, json: async () => ({}) } as unknown as Response

// Persisted-backend snapshot: the trend fixture reads what the PUTs actually
// persisted (never a hardcoded ALWAYS-101/102), so the test proves updated
// IDs per source instead of just GET counts. Disjoint ids per selection:
// charts movie 101 / tv 102, popular movie 111, trending tv 212.
const persisted = { rankingSourceMovie: "", rankingSourceSeries: "" }

function trendPayload() {
  const movieId = persisted.rankingSourceMovie === "jw:popular" ? 111 : 101
  const tvId = persisted.rankingSourceSeries === "jw:trending" ? 212 : 102
  return {
    movies: [{ id: movieId, media_type: "movie", rank: 1 }],
    tv: [{ id: tvId, media_type: "tv", rank: 1 }],
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

function trendingUrls() {
  return mockedHttp.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.includes("/api/tmdb/trending") && !u.includes("tv/week"))
}

function animeUrls() {
  return mockedUserFetch.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.includes("/api/mdblist/anime"))
}

function putCalls() {
  return mockedUserFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT")
}

/**
 * Real combined wiring: the actual save hook drives the actual trend hook
 * (sources/status/nonce), so the saving→ready cycle is exercised end to end
 * instead of rerendering arbitrary statuses.
 */
function useCombinedRankingTrending(store: { get: (k: string) => string | null; set: (k: string, v: string) => void }) {
  const sources = useRankingSources(store.get, store.set)
  const trending = useTrending("k", "m", "IT", false, {
    movieSource: sources.rankingSourceMovie,
    seriesSource: sources.rankingSourceSeries,
    userId: null,
    configToken: null,
    tokenStatus: "off",
    saveStatus: sources.rankingSourceStatus,
    rankNonce: sources.rankSourceNonce,
  })
  return { sources, trending }
}

describe("ranking save lifecycle integrated with trending refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSkip.mockResolvedValue(false)
    persisted.rankingSourceMovie = ""
    persisted.rankingSourceSeries = ""
  })

  it("one real save cycle suspends, then refetches the trend exactly once without touching anime", async () => {
    const store = memStore()
    let resolveGet!: (v: Response) => void
    const getGate = new Promise<Response>((res) => {
      resolveGet = res
    })
    const putResolvers: Array<(v: Response) => void> = []
    mockedUserFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      const u = String(_url)
      // Snapshot backend: PUTs persist the payload the trend fixture reads.
      if (init?.method === "PUT") {
        try {
          const body = JSON.parse(String((init as RequestInit)?.body ?? "{}"))
          if (typeof body.rankingSourceMovie === "string") persisted.rankingSourceMovie = body.rankingSourceMovie
          if (typeof body.rankingSourceSeries === "string") persisted.rankingSourceSeries = body.rankingSourceSeries
        } catch {
          /* malformed test body: keep previous snapshot */
        }
        return new Promise<Response>((res) => putResolvers.push(res))
      }
      if (u.includes("/api/mdblist/anime")) {
        return animeResponse(animePayload(), {
          "x-pictorium-updated-at-movie": "1761331200000",
          "x-pictorium-updated-at-series": "1761334800000",
        })
      }
      return getGate
    })
    mockedHttp.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes("/api/tmdb/trending/tv/week")) return { results: [] } as never
      if (u.includes("/api/tmdb/trending")) return trendPayload() as never
      throw new Error(`unexpected url ${u}`)
    })
    const { result } = renderHook(() => useCombinedRankingTrending(store))
    await waitFor(() => expect(result.current.trending.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(trendingUrls()).toHaveLength(1)
    expect(animeUrls()).toHaveLength(1)
    const animeBefore = result.current.trending.mdblistAnimeList.map((a) => a.id)
    // Anime publication stamps travel on the same response headers.
    await waitFor(() => expect(result.current.trending.animeStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.trending.animeUpdatedAt).toEqual({ movie: 1761331200000, series: 1761334800000 })

    // Namespace is silent: the effective server selection is the default.
    await act(async () => {
      resolveGet({ ok: true, json: async () => ({}) } as unknown as Response)
    })
    const nonceBefore = result.current.sources.rankSourceNonce

    // Real save through the actual hook: rows suspend with no obsolete trend
    // request on the stale server config.
    let saved!: Promise<boolean>
    await act(async () => {
      saved = result.current.sources.setRankingSource("movie", "jw:popular")
    })
    expect(result.current.sources.rankingSourceStatus).toBe("saving")
    expect(result.current.trending.trending).toEqual([])
    expect(result.current.trending.trendingStatus).toBe("loading")
    expect(trendingUrls()).toHaveLength(1)

    // The single PUT lands: ready + nonce, then exactly one final trend GET.
    let ok = false
    await act(async () => {
      putResolvers.shift()!(okPut)
      ok = await saved
    })
    expect(ok).toBe(true)
    expect(putCalls()).toHaveLength(1)
    expect(JSON.parse(String((putCalls()[0][1] as RequestInit)?.body))).toMatchObject({
      rankingSourceMovie: "jw:popular",
    })
    await waitFor(() => expect(result.current.sources.rankingSourceStatus).toBe("ready"), { timeout: 2000 })
    expect(result.current.sources.rankSourceNonce).toBe(nonceBefore + 1)
    await waitFor(() => expect(result.current.trending.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(trendingUrls()).toHaveLength(2)
    // Persisted popular movie: disjoint movie id, series still charts.
    expect(result.current.trending.trending.map((r) => r.id)).toEqual([111, 102])
    // Automatic trend GETs bypass the browser HTTP cache at the same
    // namespace URL (the URL carries no `&_t`; only manual refresh does), so
    // a shared/browser cache can never freeze the previous source's body.
    for (const [, opts] of mockedHttp.mock.calls.filter(([u]) => String(u).includes("/api/tmdb/trending") && !String(u).includes("tv/week"))) {
      expect((opts as { cache?: string } | undefined)?.cache).toBe("no-store")
    }

    // Second real save (series -> trending) on the SAME mounted tree: exactly
    // one more auto GET, disjoint tv id, movie untouched.
    let saved2!: Promise<boolean>
    await act(async () => {
      saved2 = result.current.sources.setRankingSource("series", "jw:trending")
    })
    expect(result.current.sources.rankingSourceStatus).toBe("saving")
    expect(result.current.trending.trending).toEqual([])
    expect(trendingUrls()).toHaveLength(2)
    let ok2 = false
    await act(async () => {
      putResolvers.shift()!(okPut)
      ok2 = await saved2
    })
    expect(ok2).toBe(true)
    expect(putCalls()).toHaveLength(2)
    await waitFor(() => expect(result.current.trending.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(trendingUrls()).toHaveLength(3)
    expect(result.current.trending.trending.map((r) => r.id)).toEqual([111, 212])

    // Back to charts (both slots): two saves, one auto GET each, final rows
    // are the original charts ids — full charts→popular→trending→charts cycle
    // with no manualRefresh anywhere.
    let saved3!: Promise<boolean>
    await act(async () => {
      saved3 = result.current.sources.setRankingSource("movie", "")
    })
    await act(async () => {
      putResolvers.shift()!(okPut)
      expect(await saved3).toBe(true)
    })
    await waitFor(() => expect(result.current.trending.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(trendingUrls()).toHaveLength(4)
    expect(result.current.trending.trending.map((r) => r.id)).toEqual([101, 212])
    let saved4!: Promise<boolean>
    await act(async () => {
      saved4 = result.current.sources.setRankingSource("series", "")
    })
    await act(async () => {
      putResolvers.shift()!(okPut)
      expect(await saved4).toBe(true)
    })
    await waitFor(() => expect(result.current.trending.trendingStatus).toBe("ready"), { timeout: 2000 })
    expect(trendingUrls()).toHaveLength(5)
    expect(result.current.trending.trending.map((r) => r.id)).toEqual([101, 102])

    // Anime is independent of the Top 20 saves: same rows, no refetch.
    expect(animeUrls()).toHaveLength(1)
    expect(result.current.trending.mdblistAnimeList.map((a) => a.id)).toEqual(animeBefore)
  })
})
