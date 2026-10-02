import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { CataloghiView } from "@/components/CataloghiView"
import { renderWithCtx } from "@/__tests__/test-utils"
import { userFetch } from "@/lib/http"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/CustomCatalogModal", () => ({ CustomCatalogModal: () => null }))
vi.mock("@/components/CatalogManagerModal", () => ({ CatalogManagerModal: () => null }))

const cat = { id: "audit", name: "Audit list", type: "mixed" as const, url: "https://mdblist.com/lists/audit/list" }
const movie = { id: 1, media_type: "movie", title: "Preview movie", poster_path: "/movie.jpg" }
const tv = { id: 2, media_type: "tv", title: "Full series", poster_path: "/tv.jpg" }
const response = (items: unknown[], status = "ok") => new Response(JSON.stringify({ items, status, total: items.length }))
const mockedFetch = vi.mocked(userFetch)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
  mockedFetch.mockImplementation(async url => response(String(url).includes("media_type=tv") ? [tv] : [movie]))
})

describe("catalog browsing", () => {
  it("shows a private-list error instead of presenting it as empty", async () => {
    mockedFetch.mockResolvedValue(response([], "private"))
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [cat] })
    expect(await screen.findByText("ui.customErrPrivate")).toBeInTheDocument()
    expect(screen.queryByText("ui.customNoTitles")).not.toBeInTheDocument()
  })

  it("opens the mixed section absent from preview, reuses page cache, and restores keyboard focus", async () => {
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [cat] })
    const card = await screen.findByRole("button", { name: /Audit list — ui.tvSeries/ })
    card.focus()
    fireEvent.keyDown(card, { key: "Enter" })
    const dialog = await screen.findByRole("dialog", { name: "Audit list — ui.tvSeries" })
    expect(await within(dialog).findByAltText("Full series")).toBeInTheDocument()
    expect(within(dialog).queryByAltText("Preview movie")).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe("hidden")
    const close = within(dialog).getByRole("button", { name: "ui.close" })
    const tile = within(dialog).getByRole("button", { name: "Full series" })
    tile.focus()
    fireEvent.keyDown(window, { key: "Tab" })
    expect(close).toHaveFocus()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(card).toHaveFocus()
    expect(document.body.style.overflow).toBe("")
    fireEvent.click(card)
    await screen.findByRole("dialog")
    expect(mockedFetch.mock.calls.filter(([url]) => String(url).includes("media_type=tv"))).toHaveLength(1)
  })

  it("ignores a page response arriving after the catalog is unmounted", async () => {
    let resolve!: (res: Response) => void
    mockedFetch.mockImplementation(async url => String(url).includes("skip=0")
      ? new Promise<Response>(r => { resolve = r }) : response([movie]))
    const view = renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [{ ...cat, url: cat.url + "-late" }] })
    fireEvent.click(await screen.findByRole("button", { name: /Audit list — ui.movie/ }))
    await waitFor(() => expect(resolve).toBeTypeOf("function"))
    view.unmount()
    await act(async () => { resolve(response([movie, tv])) })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const fullCall = mockedFetch.mock.calls.find(([url]) => String(url).includes("skip=0"))
    expect(fullCall?.[1]?.signal?.aborted).toBe(true)
  })

  it("loads 400 titles thirty at a time and retries a failed page without losing titles", async () => {
    const offsets: number[] = []
    mockedFetch.mockImplementation(async url => {
      const params = new URL(String(url), "https://test.local").searchParams
      expect(params.get("limit")).toBe("30")
      if (!params.has("skip")) return response([movie])
      expect(params.get("media_type")).toBe("movie")
      const skip = Number(params.get("skip"))
      offsets.push(skip)
      if (skip === 30 && offsets.filter(n => n === 30).length === 1) throw new Error("offline")
      const items = Array.from({ length: 30 }, (_, i) => ({ ...movie, id: skip + i + 1, title: `Title ${skip + i + 1}` }))
      return new Response(JSON.stringify({ status: "ok", total: 400, nextOffset: skip + 30, items }))
    })
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [{ ...cat, url: cat.url + "-partial" }] })
    fireEvent.click(await screen.findByRole("button", { name: /Audit list — ui.movie/ }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByAltText("Title 30")
    expect(within(dialog).getAllByRole("button", { name: /^Title / })).toHaveLength(30)
    fireEvent.click(within(dialog).getByRole("button", { name: "ui.showMore" }))
    await within(dialog).findByRole("alert")
    expect(within(dialog).getAllByRole("button", { name: /^Title / })).toHaveLength(30)
    fireEvent.click(within(dialog).getByRole("button", { name: "ui.retry" }))
    await within(dialog).findByAltText("Title 60")
    expect(within(dialog).getAllByRole("button", { name: /^Title / })).toHaveLength(60)
    expect(offsets).toEqual([0, 30, 30])
  })

  it("keeps a platform loading independently of JustWatch completion", () => {
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", trendingStatus: "empty" })
    fireEvent.click(screen.getByRole("button", { name: "Netflix" }))
    expect(screen.getByText("ui.loadingCatalogs")).toBeInTheDocument()
    expect(screen.queryByText("ui.customNoTitles")).not.toBeInTheDocument()
  })

  it("requests only visible or selected streaming platforms", async () => {
    const callbacks: Array<(entries: IntersectionObserverEntry[]) => void> = []
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) { callbacks.push(callback) }
      observe() {}
      disconnect() {}
    })
    try {
      const loadPlatform = vi.fn(async () => true)
      const view = renderWithCtx(<CataloghiView />, { tmdbKey: "k", loadPlatform })
      expect(loadPlatform).not.toHaveBeenCalled()
      await act(async () => { callbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry]) })
      expect(loadPlatform).toHaveBeenCalledTimes(1)
      expect(loadPlatform).toHaveBeenCalledWith("netflix")
      fireEvent.click(screen.getByRole("button", { name: "Disney+" }))
      expect(loadPlatform).toHaveBeenLastCalledWith("disney")
      expect(loadPlatform).toHaveBeenCalledTimes(2)
      view.unmount()
    } finally { vi.unstubAllGlobals() }
  })
})
