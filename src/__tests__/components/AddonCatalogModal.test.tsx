import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { AddonCatalogModal } from "@/components/AddonCatalogModal"
import { renderWithCtx } from "@/__tests__/test-utils"
import { userFetch } from "@/lib/http"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key }),
}))

const URL_A = "https://a.example/manifest.json"
const URL_B = "https://b.example/manifest.json"

const manifestA = {
  id: "addon-a",
  name: "Addon A",
  catalogs: [{ id: "top", type: "movie", name: "Pop A", extra: [{ name: "skip" }], incompatible: null }],
}
const manifestB = {
  id: "addon-b",
  name: "Addon B",
  catalogs: [{ id: "top", type: "movie", name: "Pop B", extra: [{ name: "skip" }], incompatible: null }],
}

const manifestResponse = (m: unknown) => new Response(JSON.stringify(m))
const mockedFetch = vi.mocked(userFetch)

function mockManifests(byHost: Record<string, unknown>) {
  mockedFetch.mockImplementation(async (input) => {
    const u = new URL(String(input), "https://test.local")
    const target = u.searchParams.get("url") || ""
    for (const [host, m] of Object.entries(byHost)) {
      if (target.includes(host)) return manifestResponse(m)
    }
    return new Response("not found", { status: 404 })
  })
}

function elements() {
  const input = screen.getByPlaceholderText("ui.addonUrlPh") as HTMLInputElement
  const load = screen.getByRole("button", { name: "ui.addonLoad" })
  const save = screen.getByRole("button", { name: "ui.addCatalogBtn" })
  return { input, load, save }
}

describe("AddonCatalogModal manifest binding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("invalidates the loaded manifest when the URL is edited before saving", async () => {
    const addCustomCatalog = vi.fn()
    mockManifests({ "a.example": manifestA })
    renderWithCtx(<AddonCatalogModal isOpen onClose={() => {}} />, { addCustomCatalog, customCatalogs: [] })

    const { input, load, save } = elements()
    fireEvent.change(input, { target: { value: URL_A } })
    fireEvent.click(load)
    await screen.findByText("Pop A")

    // L'utente cambia l'URL senza ricaricare: identificativo e selezione di A
    // spariscono, il salvataggio non può più usare B con i dati di A.
    fireEvent.change(input, { target: { value: URL_B } })
    await waitFor(() => expect(screen.queryByText("Pop A")).toBeNull())
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(addCustomCatalog).not.toHaveBeenCalled()
  })

  it("drops a pending manifest response when the URL changes mid-flight", async () => {
    const addCustomCatalog = vi.fn()
    let resolveA!: (res: Response) => void
    mockedFetch.mockImplementation(async (input) => {
      const target = new URL(String(input), "https://test.local").searchParams.get("url") || ""
      if (target.includes("a.example")) return new Promise<Response>((r) => { resolveA = r })
      return manifestResponse(manifestB)
    })
    renderWithCtx(<AddonCatalogModal isOpen onClose={() => {}} />, { addCustomCatalog, customCatalogs: [] })

    const { input, load } = elements()
    fireEvent.change(input, { target: { value: URL_A } })
    fireEvent.click(load)
    await waitFor(() => expect(resolveA).toBeTypeOf("function"))

    // Cambio URL a richiesta pendente: quando A risponde, il suo esito va scartato.
    fireEvent.change(input, { target: { value: URL_B } })
    await act(async () => { resolveA(manifestResponse(manifestA)) })
    expect(screen.queryByText("Pop A")).toBeNull()

    // Il caricamento di B funziona dopo lo scarto.
    fireEvent.click(load)
    await screen.findByText("Pop B")
    expect(screen.queryByText("Pop A")).toBeNull()
  })

  it("saves with the loaded manifest URL, never the edited one", async () => {
    const addCustomCatalog = vi.fn()
    mockManifests({ "a.example": manifestA })
    renderWithCtx(<AddonCatalogModal isOpen onClose={() => {}} />, { addCustomCatalog, customCatalogs: [] })

    const { input, load, save } = elements()
    fireEvent.change(input, { target: { value: URL_A } })
    fireEvent.click(load)
    await screen.findByText("Pop A")
    fireEvent.click(save)
    expect(addCustomCatalog).toHaveBeenCalledTimes(1)
    expect(addCustomCatalog.mock.calls[0][0]).toMatchObject({
      url: URL_A,
      addon: expect.objectContaining({ manifestUrl: URL_A, catalogId: "top" }),
    })
  })

  it("discards manifest A applied after the URL changed during body parsing", async () => {
    // Buco precedente (righe 90-91): tra `await res.json()` e i controlli,
    // un cambio URL faceva ricomparire i cataloghi di A con B nell'input.
    const addCustomCatalog = vi.fn()
    let resolveJson!: (body: unknown) => void
    mockedFetch.mockImplementation(async () => ({
      ok: true,
      json: () => new Promise<unknown>((r) => { resolveJson = r }),
    }) as unknown as Response)
    renderWithCtx(<AddonCatalogModal isOpen onClose={() => {}} />, { addCustomCatalog, customCatalogs: [] })

    const { input, load, save } = elements()
    fireEvent.change(input, { target: { value: URL_A } })
    fireEvent.click(load)
    await waitFor(() => expect(resolveJson).toBeTypeOf("function"))

    // L'URL cambia mentre il body di A è ancora in lettura.
    fireEvent.change(input, { target: { value: URL_B } })
    await act(async () => { resolveJson(manifestA) })

    expect(screen.queryByText("Pop A")).toBeNull()
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(addCustomCatalog).not.toHaveBeenCalled()
  })

  it("discards a stale error body when the URL changed during parsing", async () => {
    const addCustomCatalog = vi.fn()
    let resolveJson!: (body: unknown) => void
    mockedFetch.mockImplementation(async () => ({
      ok: false,
      status: 502,
      json: () => new Promise<unknown>((r) => { resolveJson = r }),
    }) as unknown as Response)
    renderWithCtx(<AddonCatalogModal isOpen onClose={() => {}} />, { addCustomCatalog, customCatalogs: [] })

    const { input, load } = elements()
    fireEvent.change(input, { target: { value: URL_A } })
    fireEvent.click(load)
    await waitFor(() => expect(resolveJson).toBeTypeOf("function"))

    fireEvent.change(input, { target: { value: URL_B } })
    await act(async () => { resolveJson({ error: "unavailable" }) })

    // Nessun errore obsoleto di A con B nell'input.
    expect(screen.queryByText("ui.addonErrUnavailable")).toBeNull()
  })

  it("does not let a stale preview overwrite the newer one", async () => {
    const addCustomCatalog = vi.fn()
    let resolvePreviewA!: (body: unknown) => void
    mockedFetch.mockImplementation(async (input) => {
      const u = new URL(String(input), "https://test.local")
      const target = u.searchParams.get("url") || ""
      if (u.pathname.includes("/preview")) {
        if (target.includes("a.example")) {
          return { ok: true, json: () => new Promise<unknown>((r) => { resolvePreviewA = r }) } as unknown as Response
        }
        return new Response(JSON.stringify({ items: [{ title: "B one" }] }))
      }
      if (target.includes("a.example")) return manifestResponse(manifestA)
      return manifestResponse(manifestB)
    })
    renderWithCtx(<AddonCatalogModal isOpen onClose={() => {}} />, { addCustomCatalog, customCatalogs: [] })

    const { input, load } = elements()
    fireEvent.change(input, { target: { value: URL_A } })
    fireEvent.click(load)
    await screen.findByText("Pop A")
    await waitFor(() => expect(resolvePreviewA).toBeTypeOf("function"))

    // Nuovo manifest B con la stessa chiave catalogo: la sua anteprima vince.
    fireEvent.change(input, { target: { value: URL_B } })
    fireEvent.click(load)
    await screen.findByText("Pop B")
    await screen.findByText("B one")

    // La preview obsoleta di A arriva dopo: non deve sovrascrivere B.
    await act(async () => { resolvePreviewA({ items: [{ title: "A one" }] }) })
    expect(screen.queryByText("A one")).toBeNull()
    expect(screen.getByText("B one")).toBeInTheDocument()
  })

  it("closes when pressing the Escape key", () => {
    const onClose = vi.fn()
    renderWithCtx(<AddonCatalogModal isOpen onClose={onClose} />, { customCatalogs: [] })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("closes when clicking outside of the popover", async () => {
    vi.useFakeTimers()
    try {
      const onClose = vi.fn()
      renderWithCtx(
        <div>
          <button type="button" data-testid="outside">Outside</button>
          <AddonCatalogModal isOpen onClose={onClose} />
        </div>,
        { customCatalogs: [] }
      )
      // Advance past delayMs (50ms)
      act(() => {
        vi.advanceTimersByTime(60)
      })
      fireEvent.click(screen.getByTestId("outside"))
      expect(onClose).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
