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

  it("prefers the Cinemeta IMDb rating over TMDB vote_average and falls back when absent", () => {
    renderWithCtx(<SearchView />, {
      tmdbKey: "k",
      query: "x",
      hasSearched: true,
      totalPages: 1,
      searchPage: 1,
      results: [
        { id: 1, media_type: "movie", title: "IMDb rated", poster_path: null, vote_average: 7.9, imdbRating: "9.1" },
        { id: 2, media_type: "movie", title: "TMDB only", poster_path: null, vote_average: 6.4 },
        { id: 3, media_type: "movie", title: "No vote", poster_path: null, vote_average: 0 },
      ],
    })
    expect(screen.getByText("9.1")).toBeInTheDocument()
    expect(screen.getByText("6.4")).toBeInTheDocument()
    // The TMDB vote never replaces a present IMDb value, and a 0 vote is
    // rendered as absent (never "0.0").
    expect(screen.queryByText("7.9")).toBeNull()
    expect(screen.queryByText("0.0")).toBeNull()
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
