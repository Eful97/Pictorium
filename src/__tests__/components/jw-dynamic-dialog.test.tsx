import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { JwDynamicCatalogDialog } from "@/components/JwDynamicCatalogDialog"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  useT: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    lang: "it",
  }),
}))

function setup(existingUrls: string[] = []) {
  const onAdd = vi.fn()
  const onClose = vi.fn()
  render(
    <JwDynamicCatalogDialog isOpen onClose={onClose} defaultCountry="IT" existingUrls={existingUrls} onAdd={onAdd} />,
  )
  return { onAdd, onClose }
}

const addButton = () => screen.getByRole("button", { name: /ui\.streamAddCount/ })

describe("JwDynamicCatalogDialog", () => {
  it("starts with nothing selected: the add button is disabled", () => {
    setup()
    expect((addButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it("adds one custom catalog per kind × type with the synthetic justwatch: url", () => {
    const { onAdd, onClose } = setup()
    fireEvent.click(screen.getByRole("button", { name: "ui.jwDynKind_new" }))
    fireEvent.click(screen.getByRole("button", { name: "ui.jwDynKind_leaving" }))
    // movie + series are both on by default → 4 lists
    expect(addButton().textContent).toContain('{"count":4}')
    fireEvent.click(addButton())
    expect(onAdd).toHaveBeenCalledTimes(4)
    const urls = onAdd.mock.calls.map((c) => c[0].url).sort()
    expect(urls).toEqual([
      "justwatch:leaving?type=movie&country=IT",
      "justwatch:leaving?type=series&country=IT",
      "justwatch:new?type=movie&country=IT",
      "justwatch:new?type=series&country=IT",
    ])
    expect(onAdd.mock.calls[0][0]).toMatchObject({ enabled: true })
    expect(onClose).toHaveBeenCalled()
  })

  it("top by genre needs genres: shows the genre picker and adds one list per genre", () => {
    const { onAdd } = setup()
    fireEvent.click(screen.getByRole("button", { name: "ui.jwDynKind_genre" }))
    expect((addButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "ui.jwGenre_hrr" }))
    fireEvent.click(screen.getByRole("button", { name: "ui.jwGenre_cmy" }))
    // deselect series → movie only
    fireEvent.click(screen.getByRole("button", { name: "ui.jwDynSeriesName" }))
    fireEvent.click(addButton())
    expect(onAdd.mock.calls.map((c) => c[0].url).sort()).toEqual([
      "justwatch:genre?type=movie&country=IT&genre=cmy",
      "justwatch:genre?type=movie&country=IT&genre=hrr",
    ])
    expect(onAdd.mock.calls[0][0].type).toBe("movie")
  })

  it("skips lists already present and disables when nothing new remains", () => {
    setup(["justwatch:rising?type=movie&country=IT", "justwatch:rising?type=series&country=IT"])
    fireEvent.click(screen.getByRole("button", { name: "ui.jwDynKind_rising" }))
    expect((addButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it("uses the chosen country", () => {
    const { onAdd } = setup()
    fireEvent.change(screen.getByLabelText("ui.jwDynCountry"), { target: { value: "US" } })
    fireEvent.click(screen.getByRole("button", { name: "ui.jwDynKind_upcoming" }))
    fireEvent.click(screen.getByRole("button", { name: "ui.jwDynSeriesName" }))
    fireEvent.click(addButton())
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0][0].url).toBe("justwatch:upcoming?type=movie&country=US")
  })
})
