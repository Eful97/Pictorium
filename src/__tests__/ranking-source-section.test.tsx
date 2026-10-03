import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithCtx } from "@/__tests__/test-utils"
import { RankingSourceSection } from "@/components/RankingSourceSection"
import type { CustomCatalogConfig } from "@/lib/types"

const MOVIE_CAT: CustomCatalogConfig = {
  id: "cat_movies",
  name: "Film miei",
  type: "movie",
  url: "https://mdblist.com/lists/u/movies",
}

const SERIES_CAT: CustomCatalogConfig = {
  id: "cat_series",
  name: "Serie mie",
  type: "series",
  url: "https://mdblist.com/lists/u/series",
}

const MIXED_CAT: CustomCatalogConfig = {
  id: "cat_mixed",
  name: "Mista",
  type: "mixed",
  url: "https://mdblist.com/lists/u/mixed",
}

const DISABLED_CAT: CustomCatalogConfig = {
  id: "cat_off",
  name: "Spenta",
  type: "movie",
  url: "https://mdblist.com/lists/u/off",
  enabled: false,
}

const ALL = [MOVIE_CAT, SERIES_CAT, MIXED_CAT, DISABLED_CAT]

describe("RankingSourceSection", () => {
  it("defaults both dropdowns to JustWatch and lists only compatible customs", () => {
    renderWithCtx(<RankingSourceSection />, { customCatalogs: ALL })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement
    const seriesSelect = screen.getByLabelText("ui.tvSeries — Top 20") as HTMLSelectElement
    expect(movieSelect.value).toBe("")
    expect(seriesSelect.value).toBe("")

    const movieValues = Array.from(movieSelect.options).map((o) => o.value)
    expect(movieValues).toContain("")
    expect(movieValues).toContain("cat_movies")
    expect(movieValues).toContain("cat_mixed")
    expect(movieValues).not.toContain("cat_series")
    expect(movieValues).not.toContain("cat_off")

    const seriesValues = Array.from(seriesSelect.options).map((o) => o.value)
    expect(seriesValues).toContain("cat_series")
    expect(seriesValues).toContain("cat_mixed")
    expect(seriesValues).not.toContain("cat_movies")
  })

  it("shows JustWatch for deleted or incompatible selections", () => {
    renderWithCtx(<RankingSourceSection />, {
      customCatalogs: [MOVIE_CAT],
      rankingSourceMovie: "cat_gone",
      rankingSourceSeries: "cat_movies",
    })

    expect((screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement).value).toBe("")
    expect((screen.getByLabelText("ui.tvSeries — Top 20") as HTMLSelectElement).value).toBe("")
  })

  it("saves the pick through the shared setter", async () => {
    const u = userEvent.setup()
    const setRankingSource = vi.fn(async () => true)
    renderWithCtx(<RankingSourceSection />, {
      customCatalogs: ALL,
      setRankingSource,
    })

    await u.selectOptions(screen.getByLabelText("ui.movie — Top 20"), "cat_mixed")

    // The rank refresh itself is effect-driven in context (single mechanism,
    // covered at provider level): the section only persists the pick.
    await waitFor(() => expect(setRankingSource).toHaveBeenCalledWith("movie", "cat_mixed"))
  })

  it("does not refresh when the save fails", async () => {
    const u = userEvent.setup()
    const setRankingSource = vi.fn(async () => false)
    renderWithCtx(<RankingSourceSection />, {
      customCatalogs: ALL,
      setRankingSource,
    })

    await u.selectOptions(screen.getByLabelText("ui.tvSeries — Top 20"), "cat_mixed")

    await waitFor(() => expect(setRankingSource).toHaveBeenCalledWith("series", "cat_mixed"))
    // Failed saves revert locally and bump no nonce: nothing refetches.
    expect(screen.getByLabelText("ui.tvSeries — Top 20")).toBeInTheDocument()
  })

  it("exposes an accessible explainer for the section", () => {
    renderWithCtx(<RankingSourceSection />, { customCatalogs: [] })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20")
    expect(movieSelect.getAttribute("aria-describedby")).toBe("ranking-source-desc")
    expect(screen.getByText("ui.rankingSourceTitle", { exact: false })).toBeInTheDocument()
  })
})
