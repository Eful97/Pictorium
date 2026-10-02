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

function urlOf(call: unknown[]): URL {
  return new URL(String(call[0]), "https://x.test")
}

function defer<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("useSearch identità ricerca e paginazione", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() })
  })

  it("a timeout stops filtered pagination and remains retryable", async () => {
    mockedHttp.mockResolvedValueOnce(pageOf([1], "movie", 3))
    const { result } = renderHook(() => useSearch("k", "it"))
    await act(async () => { await result.current.doSearch("avatar") })
    mockedHttp.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))
    await act(async () => { await result.current.loadMoreFiltered("movie") })
    expect(mockedHttp).toHaveBeenCalledTimes(2)
    expect(result.current.searchPage).toBe(1)
    expect(result.current.failedPage).toBe(2)
    mockedHttp.mockResolvedValueOnce(pageOf([2], "movie", 3))
    await act(async () => { await result.current.retryFailed() })
    expect(result.current.results.map(r => r.id)).toEqual([1, 2])
  })

  it("pagination and retry retain the original language after a language switch", async () => {
    const { result, rerender } = renderHook(({ lang }) => useSearch("k", lang), { initialProps: { lang: "it-IT" } })
    mockedHttp.mockResolvedValueOnce(pageOf([1], "movie", 3))
    await act(async () => { await result.current.doSearch("avatar") })
    rerender({ lang: "en-US" })
    mockedHttp.mockRejectedValueOnce(new Error("page failed"))
    await act(async () => { await result.current.loadMore() })
    mockedHttp.mockResolvedValueOnce(pageOf([2], "movie", 3))
    await act(async () => { await result.current.retryFailed() })
    expect(mockedHttp.mock.calls.slice(1).map(c => urlOf(c).searchParams.get("language"))).toEqual(["it-IT", "it-IT"])
  })

  it("loadMore usa la ricerca eseguita, non il testo digitato dopo", async () => {
    mockedHttp.mockResolvedValueOnce(pageOf([1, 2], "movie", 3))
    mockedHttp.mockResolvedValueOnce(pageOf([3, 4], "movie", 3))
    const { result } = renderHook(() => useSearch("k", "it"))
    await act(async () => {
      await result.current.doSearch("avatar", 1)
    })
    expect(result.current.results).toHaveLength(2)
    // L'utente digita un'altra query senza inviare
    act(() => {
      result.current.setQuery("batman")
    })
    await act(async () => {
      await result.current.loadMore()
    })
    expect(mockedHttp).toHaveBeenCalledTimes(2)
    const second = urlOf(mockedHttp.mock.calls[1])
    expect(second.searchParams.get("q")).toBe("avatar")
    expect(second.searchParams.get("page")).toBe("2")
    expect(result.current.results).toHaveLength(4)
  })

  it("pagina 2 in errore: nessun salto a pagina 3, retry dalla stessa pagina senza perdere i risultati", async () => {
    mockedHttp.mockResolvedValueOnce(pageOf([1, 2], "movie", 3))
    const { result } = renderHook(() => useSearch("k", "it"))
    await act(async () => {
      await result.current.doSearch("avatar", 1)
    })
    mockedHttp.mockRejectedValueOnce(new Error("boom"))
    let added = -1
    await act(async () => {
      added = await result.current.loadMoreFiltered("movie", 10, 3)
    })
    expect(added).toBe(0)
    // Solo pagina 2 richiesta, mai pagina 3
    expect(mockedHttp).toHaveBeenCalledTimes(2)
    const pages = mockedHttp.mock.calls.slice(1).map((c) => urlOf(c).searchParams.get("page"))
    expect(pages).toEqual(["2"])
    // Risultati iniziali conservati e fallimento registrato
    expect(result.current.results).toHaveLength(2)
    expect(result.current.failedPage).toBe(2)

    // Retry: riparte da pagina 2, non azzera con una nuova pagina 1
    mockedHttp.mockResolvedValueOnce(pageOf([3, 4], "movie", 3))
    await act(async () => {
      await result.current.retryFailed()
    })
    expect(mockedHttp).toHaveBeenCalledTimes(3)
    const retryPages = mockedHttp.mock.calls.slice(2).map((c) => urlOf(c).searchParams.get("page"))
    expect(retryPages).toEqual(["2"])
    expect(result.current.results).toHaveLength(4)
    expect(result.current.failedPage).toBeNull()
  })

  it("pagina riuscita ma senza match per il filtro: avanza, non è un errore", async () => {
    mockedHttp.mockResolvedValueOnce({
      results: [item(1, "movie"), item(2, "movie")],
      total_results: 100,
      total_pages: 3,
    })
    const { result } = renderHook(() => useSearch("k", "it"))
    await act(async () => {
      await result.current.doSearch("hero", 1)
    })
    // Pagina 2 tutta film (zero match tv) ma riuscita → si avanza a pagina 3
    mockedHttp.mockResolvedValueOnce(pageOf([11, 12], "movie", 3))
    mockedHttp.mockResolvedValueOnce(pageOf([13], "tv", 3))
    let added = -1
    await act(async () => {
      added = await result.current.loadMoreFiltered("tv", 10, 3)
    })
    expect(added).toBe(1)
    expect(result.current.failedPage).toBeNull()
    expect(mockedHttp).toHaveBeenCalledTimes(3)
  })

  it("nuovo submit durante caricamento filtrato: restano solo i risultati nuovi", async () => {
    mockedHttp.mockResolvedValueOnce(pageOf([1, 2], "movie", 5))
    const { result } = renderHook(() => useSearch("k", "it"))
    await act(async () => {
      await result.current.doSearch("old", 1)
    })
    const oldPage2 = defer<ReturnType<typeof pageOf>>()
    mockedHttp.mockImplementationOnce(() => oldPage2.promise)
    let loopPromise!: Promise<number>
    act(() => {
      loopPromise = result.current.loadMoreFiltered("movie", 10, 3)
    })
    mockedHttp.mockResolvedValueOnce(pageOf([91, 92], "movie", 5))
    await act(async () => {
      await result.current.doSearch("new", 1)
    })
    // La vecchia pagina 2 risponde tardi: non deve più essere accodata
    await act(async () => {
      oldPage2.resolve(pageOf([3, 4], "movie", 5))
      await loopPromise
    })
    expect(result.current.results.map((r) => r.id)).toEqual([91, 92])
  })

  it("ricerca di soli spazi: nessun fetch e nessun recente", async () => {
    const { result } = renderHook(() => useSearch("k", "it"))
    let out: SearchResult[] = []
    await act(async () => {
      out = await result.current.doSearch("   ", 1)
    })
    expect(out).toEqual([])
    expect(mockedHttp).not.toHaveBeenCalled()
    expect(result.current.recentSearches).toHaveLength(0)
    expect(result.current.hasSearched).toBe(false)
  })

  it("ricerca fallita: errore visibile, risultati azzerati solo a pagina 1, nessun recente", async () => {
    mockedHttp.mockRejectedValueOnce(new Error("down"))
    const { result } = renderHook(() => useSearch("k", "it"))
    let out: SearchResult[] = []
    await act(async () => {
      out = await result.current.doSearch("avatar", 1)
    })
    expect(out).toEqual([])
    expect(result.current.error).not.toBeNull()
    expect(result.current.results).toHaveLength(0)
    expect(result.current.recentSearches).toHaveLength(0)
    expect(result.current.failedPage).toBe(1)
    expect(result.current.hasSearched).toBe(true)
  })

  it("hasSearched diventa true solo dopo una ricerca completata", async () => {
    mockedHttp.mockResolvedValueOnce(pageOf([1], "movie", 1))
    const { result } = renderHook(() => useSearch("k", "it"))
    expect(result.current.hasSearched).toBe(false)
    act(() => {
      result.current.setQuery("avatar")
    })
    // Digitazione soltanto: nessuna ricerca completata
    expect(result.current.hasSearched).toBe(false)
    await act(async () => {
      await result.current.doSearch("avatar", 1)
    })
    expect(result.current.hasSearched).toBe(true)
  })
})
