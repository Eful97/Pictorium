import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/guest-guard", () => ({
  isProfilelessOnMultiUser: vi.fn().mockResolvedValue(false),
  notifyProfilelessOnce: vi.fn(),
  shouldSkipServerSync: vi.fn().mockResolvedValue(false),
}))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }))

import { userFetch } from "@/lib/http"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { useRankingSources } from "@/lib/useRankingSources"

const mockedFetch = vi.mocked(userFetch)
const mockedSkip = vi.mocked(shouldSkipServerSync)

function memStore(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    get: (k: string) => map.get(k) ?? null,
    set: (k: string, v: string) => {
      map.set(k, v)
    },
    raw: map,
  }
}

const okEmptyGet = { ok: true, json: async () => ({}) } as unknown as Response
const okPut = { ok: true, status: 200, json: async () => ({}) } as unknown as Response

function putBodies(): Array<Record<string, unknown>> {
  return mockedFetch.mock.calls
    .filter(([, init]) => (init as RequestInit)?.method === "PUT")
    .map(([, init]) => JSON.parse(String((init as RequestInit)?.body)) as Record<string, unknown>)
}

describe("useRankingSources", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedSkip.mockResolvedValue(false)
    mockedFetch.mockResolvedValue(okEmptyGet)
  })

  it("hydrates from localStorage and keeps explicit empty (JW override)", async () => {
    const store = memStore({
      pictorium_ranking_source_movie: "cat_movies",
      pictorium_ranking_source_series: "",
    })
    const { result } = renderHook(() => useRankingSources(store.get, store.set))

    expect(result.current.rankingSourceMovie).toBe("cat_movies")
    expect(result.current.rankingSourceSeries).toBe("")
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled())
    // Local wins: no server value adopted blindly on top.
    expect(result.current.rankingSourceMovie).toBe("cat_movies")
  })

  it("fills gaps from the server namespace when local is absent", async () => {
    const store = memStore()
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rankingSourceMovie: "cat_server", rankingSourceSeries: "" }),
    } as unknown as Response)
    const { result } = renderHook(() => useRankingSources(store.get, store.set))

    await waitFor(() => expect(result.current.rankingSourceMovie).toBe("cat_server"))
    expect(store.raw.get("pictorium_ranking_source_movie")).toBe("cat_server")
    expect(store.raw.get("pictorium_ranking_source_series")).toBe("")
  })

  it("saves both slots, bumps the nonce only on success", async () => {
    const store = memStore()
    mockedFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? okPut : okEmptyGet,
    )
    const { result } = renderHook(() => useRankingSources(store.get, store.set))
    const nonceBefore = result.current.rankSourceNonce

    let ok = false
    await act(async () => {
      ok = await result.current.setRankingSource("movie", "cat_new")
    })

    expect(ok).toBe(true)
    expect(result.current.rankingSourceMovie).toBe("cat_new")
    expect(result.current.rankSourceNonce).toBe(nonceBefore + 1)
    const bodies = putBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ rankingSourceMovie: "cat_new", rankingSourceSeries: "" })
  })

  it("reverts to the saved values when the PUT fails", async () => {
    const store = memStore({ pictorium_ranking_source_movie: "cat_old" })
    mockedFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? ({ ok: false, status: 500 }) as unknown as Response : okEmptyGet,
    )
    const { result } = renderHook(() => useRankingSources(store.get, store.set))
    const nonceBefore = result.current.rankSourceNonce

    let ok = true
    await act(async () => {
      ok = await result.current.setRankingSource("movie", "cat_new")
    })

    expect(ok).toBe(false)
    expect(result.current.rankingSourceMovie).toBe("cat_old")
    expect(result.current.rankSourceNonce).toBe(nonceBefore)
  })

  it("keeps film and series independent", async () => {
    const store = memStore()
    mockedFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? okPut : okEmptyGet,
    )
    const { result } = renderHook(() => useRankingSources(store.get, store.set))

    await act(async () => {
      await result.current.setRankingSource("series", "cat_series")
    })

    expect(result.current.rankingSourceMovie).toBe("")
    expect(result.current.rankingSourceSeries).toBe("cat_series")
  })

  it("adopts the server value over a stale local one", async () => {
    const store = memStore({ pictorium_ranking_source_movie: "cat_stale" })
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rankingSourceMovie: "cat_server" }),
    } as unknown as Response)
    const { result } = renderHook(() => useRankingSources(store.get, store.set))

    await waitFor(() => expect(result.current.rankingSourceMovie).toBe("cat_server"))
    expect(store.raw.get("pictorium_ranking_source_movie")).toBe("cat_server")
  })

  it("ignores a late server GET after a user pick", async () => {
    let resolveGet!: (v: Response) => void
    mockedFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return okPut
      return new Promise<Response>((res) => {
        resolveGet = res
      })
    })
    const store = memStore()
    const { result } = renderHook(() => useRankingSources(store.get, store.set))

    await act(async () => {
      await result.current.setRankingSource("movie", "cat_pick")
    })
    expect(result.current.rankingSourceMovie).toBe("cat_pick")
    await act(async () => {
      resolveGet({ ok: true, json: async () => ({ rankingSourceMovie: "cat_server" }) } as unknown as Response)
    })
    expect(result.current.rankingSourceMovie).toBe("cat_pick")
  })

  it("merges back-to-back slot saves without losing either", async () => {
    const store = memStore()
    mockedFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? okPut : okEmptyGet,
    )
    const { result } = renderHook(() => useRankingSources(store.get, store.set))

    let okMovie = false
    let okSeries = false
    await act(async () => {
      await Promise.all([
        result.current.setRankingSource("movie", "cat_m").then((ok) => {
          okMovie = ok
        }),
        result.current.setRankingSource("series", "cat_s").then((ok) => {
          okSeries = ok
        }),
      ])
    })

    expect(okMovie).toBe(true)
    expect(okSeries).toBe(true)
    expect(result.current.rankingSourceMovie).toBe("cat_m")
    expect(result.current.rankingSourceSeries).toBe("cat_s")
    const bodies = putBodies()
    expect(bodies.length).toBeGreaterThanOrEqual(1)
    expect(bodies[bodies.length - 1]).toMatchObject({
      rankingSourceMovie: "cat_m",
      rankingSourceSeries: "cat_s",
    })
  })
})
