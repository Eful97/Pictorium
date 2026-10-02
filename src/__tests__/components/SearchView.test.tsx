import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { SearchView } from "@/components/SearchView"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key }),
}))

describe("search results view", () => {
  it("offers pagination when an upstream page contains only excluded results", () => {
    const loadMore = vi.fn(async () => {})
    renderWithCtx(<SearchView />, { tmdbKey: "k", query: "actor", results: [], hasSearched: true, totalPages: 3, searchPage: 1, loadMore })
    fireEvent.click(screen.getByRole("button", { name: "ui.showMore" }))
    expect(loadMore).toHaveBeenCalledOnce()
    expect(screen.queryByText("ui.noResults")).not.toBeInTheDocument()
  })

  it("uses independent buttons to remove a recent search without submitting it", () => {
    const doSearch = vi.fn(async () => [])
    const removeRecentSearch = vi.fn()
    renderWithCtx(<SearchView />, { tmdbKey: "k", recentSearches: ["avatar"], doSearch, removeRecentSearch })
    fireEvent.focus(screen.getByRole("textbox"))
    const remove = screen.getByRole("button", { name: "ui.remove: avatar" })
    expect(remove.parentElement?.closest("button")).toBeNull()
    fireEvent.click(remove)
    expect(removeRecentSearch).toHaveBeenCalledWith("avatar")
    expect(doSearch).not.toHaveBeenCalled()
  })
})
