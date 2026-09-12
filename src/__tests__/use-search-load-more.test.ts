import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { http } from "@/lib/http"
import { useSearch } from "@/lib/useSearch"
import type { SearchResult } from "@/lib/types"

vi.mock("@/lib/http", () => ({ http: vi.fn() }))

const mockedHttp = vi.mocked(http)

function item(id: number, media_type: "movie" | "tv"): SearchResult {
  return { id, media_type, title: `T${id}`, poster_path: null }
}

function pageOf(ids: number[], type: "movie" | "tv", totalPages: number) {
  return {
    results: ids.map((id) => item(id, type)),
    total_results: 100,
    total_pages: totalPages,
  }
}

function mixedPage(page: number, movies: number, totalPages = 5) {
  const base = page * 100
  const results = [
    ...Array.from({ length: movies }, (_, i) => item(base + i, "movie")),
    ...Array.from({ length: 20 - movies }, (_, i) => item(base + 50 + i, "tv")),
  ]
  return { results, total_results: 100, total_pages: totalPages }
}

describe("useSearch loadMore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loadMore prende una sola pagina (comportamento invariato)", async () => {
    mockedHttp.mockResolvedValueOnce(pageOf([1, 2], "movie", 3))
    mockedHttp.mockResolvedValueOnce(pageOf([3, 4], "movie", 3))
    const { result } = renderHook(() => useSearch("k", "it"))
    // Come nell'app vera (SearchView.onSearch): prima setQuery, poi doSearch —
    // loadMore riusa lo stato query e rifiuta query vuote/corte.
    act(() => {
      result.current.setQuery("batman")
    })
    await act(async () => {
      await result.current.doSearch("batman", 1)
    })
    expect(result.current.results).toHaveLength(2)
    await act(async () => {
      await result.current.loadMore()
    })
    expect(mockedHttp).toHaveBeenCalledTimes(2)
    expect(result.current.results).toHaveLength(4)
    expect(result.current.searchPage).toBe(2)
  })

  it("loadMoreFiltered prosegue finché non accumula targetNew match", async () => {
    mockedHttp.mockResolvedValueOnce(mixedPage(1, 20)) // pagina 1: setup via doSearch diretto
    const { result } = renderHook(() => useSearch("k", "it"))
    act(() => {
      result.current.setQuery("hero")
    })
    await act(async () => {
      await result.current.doSearch("hero", 1)
    })
    expect(mockedHttp).toHaveBeenCalledTimes(1)
    // Pagine successive povere di film: 2 + 9 match
    mockedHttp.mockResolvedValueOnce(mixedPage(2, 2))
    mockedHttp.mockResolvedValueOnce(mixedPage(3, 9))
    let added = -1
    await act(async () => {
      added = await result.current.loadMoreFiltered("movie", 10, 3)
    })
    expect(added).toBe(11)
    expect(mockedHttp).toHaveBeenCalledTimes(3) // stop appena raggiunto il target
    expect(result.current.searchPage).toBe(3)
    // Solo i film visibili nel filtro: 20 + 11
    expect(result.current.results.filter((r) => r.media_type === "movie")).toHaveLength(31)
  })

  it("loadMoreFiltered si ferma alle pagine esaurite", async () => {
    mockedHttp.mockResolvedValueOnce(mixedPage(1, 20, 2))
    const { result } = renderHook(() => useSearch("k", "it"))
    act(() => {
      result.current.setQuery("hero")
    })
    await act(async () => {
      await result.current.doSearch("hero", 1)
    })
    mockedHttp.mockResolvedValueOnce(mixedPage(2, 1, 2))
    let added = -1
    await act(async () => {
      added = await result.current.loadMoreFiltered("movie", 10, 3)
    })
    expect(added).toBe(1)
    expect(mockedHttp).toHaveBeenCalledTimes(2)
  })

  it("loadMoreFiltered rispetta maxPages per click", async () => {
    mockedHttp.mockResolvedValueOnce(mixedPage(1, 20, 10))
    const { result } = renderHook(() => useSearch("k", "it"))
    act(() => {
      result.current.setQuery("hero")
    })
    await act(async () => {
      await result.current.doSearch("hero", 1)
    })
    mockedHttp.mockResolvedValueOnce(mixedPage(2, 0, 10))
    mockedHttp.mockResolvedValueOnce(mixedPage(3, 0, 10))
    let added = -1
    await act(async () => {
      added = await result.current.loadMoreFiltered("movie", 10, 2)
    })
    expect(added).toBe(0)
    expect(mockedHttp).toHaveBeenCalledTimes(3) // 1 setup + 2 pagine max
    expect(result.current.searchPage).toBe(3)
  })
})
