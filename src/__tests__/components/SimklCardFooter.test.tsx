import { describe, expect, it, vi, afterEach } from "vitest"
import { fireEvent, screen, cleanup } from "@testing-library/react"
import { SimklCard } from "@/components/SimklCard"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key }),
}))

afterEach(() => cleanup())

const items = [
  { id: 11, media_type: "movie", title: "Alpha", poster_path: "/alpha.jpg" },
  { id: 22, media_type: "movie", title: "Beta", poster_path: "/beta.jpg" },
]

function cardRoot(): HTMLElement {
  const el = document.querySelector(".simkl-list-card")
  if (!el) throw new Error("SimklCard root not found")
  return el as HTMLElement
}

describe("SimklCard legacy footer (no opt-in props)", () => {
  it("renders raw TMDB w185 thumbs and the saved counter, never /api/poster", () => {
    const onClick = vi.fn()
    const onItemClick = vi.fn()
    renderWithCtx(
      <SimklCard items={items} title="Legacy List" totalCount={20} onClick={onClick} onItemClick={onItemClick} />,
    )
    const thumbs = screen.getAllByRole("img")
    expect(thumbs.length).toBeGreaterThan(0)
    for (const img of thumbs) {
      const src = (img as HTMLImageElement).src
      expect(src).toContain("https://image.tmdb.org/t/p/w185/")
      expect(src).not.toContain("/api/poster")
    }
    expect(screen.getByText("20 ui.itemMany")).toBeTruthy()
    // No trash action without onRemove.
    expect(screen.queryByRole("button", { name: "ui.remove" })).toBeNull()
  })

  it("poster click calls onItemClick without opening the list; card click opens it", () => {
    const onClick = vi.fn()
    const onItemClick = vi.fn()
    renderWithCtx(
      <SimklCard items={items} title="Legacy List" totalCount={20} onClick={onClick} onItemClick={onItemClick} />,
    )
    fireEvent.click(screen.getByAltText("Alpha"))
    expect(onItemClick).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.click(cardRoot())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders meta strings unchanged and no actions when props are omitted", () => {
    renderWithCtx(<SimklCard items={items} title="Legacy List" meta={["Sub A", "Sub B"]} />)
    expect(screen.getByText("Sub A")).toBeTruthy()
    expect(screen.getByText("Sub B")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "ui.remove" })).toBeNull()
  })

  it("count 0 renders no fake counter", () => {
    renderWithCtx(<SimklCard items={[]} title="Empty List" totalCount={0} />)
    expect(document.querySelector(".counter-badge")).toBeNull()
  })

  it("empty rail states the honest empty text instead of a blank rail", () => {
    renderWithCtx(<SimklCard items={[]} title="Empty List" totalCount={0} />)
    expect(screen.getByText("ui.customNoTitles")).toBeTruthy()
  })

  it("non-empty rails never show the empty text", () => {
    renderWithCtx(<SimklCard items={items} title="Legacy List" totalCount={20} />)
    expect(screen.queryByText("ui.customNoTitles")).toBeNull()
  })
})

describe("SimklCard footerAdornment (source icon slot)", () => {
  it("places the icon-only accessible node beside the counter", () => {
    renderWithCtx(
      <SimklCard
        items={items}
        title="Top List"
        totalCount={20}
        footerAdornment={<span role="img" aria-label="JustWatch" data-testid="src-icon" />}
      />,
    )
    const icon = screen.getByRole("img", { name: "JustWatch" })
    const counter = screen.getByText("20 ui.itemMany")
    // Same left wrapper: source sits next to the counter, not elsewhere.
    expect(icon.parentElement).toBe(counter.parentElement)
    expect(counter.parentElement?.className).toContain("flex")
  })

  it("keeps the adornment with no counter invented when count is 0", () => {
    renderWithCtx(
      <SimklCard
        items={[]}
        title="Empty List"
        totalCount={0}
        footerAdornment={<span role="img" aria-label="FlixPatrol" data-testid="src-icon" />}
      />,
    )
    expect(screen.getByRole("img", { name: "FlixPatrol" })).toBeTruthy()
    expect(document.querySelector(".counter-badge")).toBeNull()
  })
})

describe("SimklCard onRemove (single-list trash)", () => {
  it("invokes only onRemove on click, never onClick/onItemClick", () => {
    const onClick = vi.fn()
    const onItemClick = vi.fn()
    const onRemove = vi.fn()
    renderWithCtx(
      <SimklCard
        items={items}
        title="Top List"
        totalCount={20}
        onClick={onClick}
        onItemClick={onItemClick}
        onRemove={onRemove}
      />,
    )
    const trash = screen.getByRole("button", { name: "ui.remove" })
    expect(trash.getAttribute("type")).toBe("button")
    expect(trash.getAttribute("title")).toBe("ui.remove")
    fireEvent.click(trash)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    expect(onItemClick).not.toHaveBeenCalled()
  })

  it("Enter/Space on the trash never bubble to the card (list/editor stays closed)", () => {
    const onClick = vi.fn()
    const onRemove = vi.fn()
    renderWithCtx(
      <SimklCard items={items} title="Top List" totalCount={20} onClick={onClick} onRemove={onRemove} />,
    )
    const trash = screen.getByRole("button", { name: "ui.remove" })
    fireEvent.keyDown(trash, { key: "Enter" })
    fireEvent.keyDown(trash, { key: " " })
    expect(onClick).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    // Card-level keyboard still opens the list (legacy behavior intact).
    fireEvent.keyDown(cardRoot(), { key: "Enter" })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("honours a custom removeLabel and sits footer-right after the counter", () => {
    renderWithCtx(
      <SimklCard
        items={items}
        title="Top List"
        totalCount={20}
        onRemove={() => {}}
        removeLabel="Delete this list"
        footerAdornment={<span role="img" aria-label="JustWatch" data-testid="src-icon" />}
      />,
    )
    const trash = screen.getByRole("button", { name: "Delete this list" })
    expect(trash.getAttribute("title")).toBe("Delete this list")
    const counter = screen.getByText("20 ui.itemMany")
    // Document order: counter block first, trash later (footer right).
    expect(counter.compareDocumentPosition(trash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("keeps meta visible next to the trash when both are present", () => {
    renderWithCtx(
      <SimklCard items={items} title="Top List" meta={["Sub A"]} onRemove={() => {}} />,
    )
    expect(screen.getByText("Sub A")).toBeTruthy()
    expect(screen.getByRole("button", { name: "ui.remove" })).toBeTruthy()
  })
})
