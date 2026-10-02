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
  mockedFetch.mockImplementation(async url => response(String(url).includes("limit=500") ? [movie, tv] : [movie]))
})

describe("catalog browsing", () => {
  it("shows a private-list error instead of presenting it as empty", async () => {
    mockedFetch.mockResolvedValue(response([], "private"))
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [cat] })
    expect(await screen.findByText("ui.customErrPrivate")).toBeInTheDocument()
    expect(screen.queryByText("ui.customNoTitles")).not.toBeInTheDocument()
  })

  it("opens the mixed section absent from preview, reuses full cache, and restores keyboard focus", async () => {
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [cat] })
    const card = await screen.findByRole("button", { name: /Audit list — ui.tvSeries/ })
    card.focus()
    fireEvent.keyDown(card, { key: "Enter" })
    const dialog = await screen.findByRole("dialog", { name: "Audit list — ui.tvSeries" })
    expect(within(dialog).getByAltText("Full series")).toBeInTheDocument()
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
    expect(mockedFetch.mock.calls.filter(([url]) => String(url).includes("limit=500"))).toHaveLength(1)
  })

  it("ignores a full-list response arriving after the catalog is unmounted", async () => {
    let resolve!: (res: Response) => void
    mockedFetch.mockImplementation(async url => String(url).includes("limit=500")
      ? new Promise<Response>(r => { resolve = r }) : response([movie]))
    const view = renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [{ ...cat, url: cat.url + "-late" }] })
    fireEvent.click(await screen.findByRole("button", { name: /Audit list — ui.movie/ }))
    await waitFor(() => expect(resolve).toBeTypeOf("function"))
    view.unmount()
    await act(async () => { resolve(response([movie, tv])) })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    const fullCall = mockedFetch.mock.calls.find(([url]) => String(url).includes("limit=500"))
    expect(fullCall?.[1]?.signal?.aborted).toBe(true)
  })

  it("explains that a failed full fetch is showing only the preview", async () => {
    mockedFetch.mockImplementation(async url => {
      if (String(url).includes("limit=500")) throw new Error("offline")
      return response([movie])
    })
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", customCatalogs: [{ ...cat, url: cat.url + "-partial" }] })
    fireEvent.click(await screen.findByRole("button", { name: /Audit list — ui.movie/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("ui.customPreviewOnly")).toBeInTheDocument()
    expect(within(dialog).getByAltText("Preview movie")).toBeInTheDocument()
  })

  it("keeps a platform loading independently of JustWatch completion", () => {
    renderWithCtx(<CataloghiView />, { tmdbKey: "k", trendingStatus: "empty" })
    fireEvent.click(screen.getByRole("button", { name: "Netflix" }))
    expect(screen.getByText("ui.loadingCatalogs")).toBeInTheDocument()
    expect(screen.queryByText("ui.customNoTitles")).not.toBeInTheDocument()
  })
})
