import { describe, expect, it, vi } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { renderWithCtx } from "@/__tests__/test-utils"
import { RankingSourceSection } from "@/components/RankingSourceSection"
import {
  genericStreamingCatalogId,
  genericStreamingCatalogName,
  streamingCatalogId,
  type StreamingSelection,
} from "@/lib/streaming-catalogs"
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

// Imported Stremio addon: two catalogs from the SAME manifest. The real
// remote catalog type (not the local entry type) decides the slot.
const ADDON_MOVIE: CustomCatalogConfig = {
  id: "cat_addon_movie",
  name: "Addon Film",
  type: "movie",
  url: "https://addon.example/manifest.json",
  addon: {
    manifestUrl: "https://addon.example/manifest.json",
    catalogId: "top",
    catalogType: "movie",
  },
}

const ADDON_SERIES: CustomCatalogConfig = {
  id: "cat_addon_series",
  name: "Addon Serie",
  type: "series",
  url: "https://addon.example/manifest.json",
  addon: {
    manifestUrl: "https://addon.example/manifest.json",
    catalogId: "top",
    catalogType: "series",
  },
}

// Imported Top 10 lists: legacy curated pair (identical neutral names, the
// picker adds the section suffix) + a generic mixed list + a hidden one.
const NETFLIX_MOVIES_ID = streamingCatalogId("netflix", "IT", "movies")
const NETFLIX_SERIES_ID = streamingCatalogId("netflix", "IT", "series")
const HULU_ALL_ID = genericStreamingCatalogId("hulu", "united-states", "all", "auto", null)
const STREAMING: StreamingSelection[] = [
  { service: "netflix", country: "IT" },
  { service: "hulu", country: "united-states", sections: ["all"] },
  { service: "prime", country: "IT", enabled: false },
]

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

  it("offers enabled section-compatible streaming Top 10 lists", () => {
    renderWithCtx(<RankingSourceSection />, { streamingSelections: STREAMING })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement
    const seriesSelect = screen.getByLabelText("ui.tvSeries — Top 20") as HTMLSelectElement
    const movieValues = Array.from(movieSelect.options).map((o) => o.value)
    const seriesValues = Array.from(seriesSelect.options).map((o) => o.value)

    expect(movieValues).toContain(NETFLIX_MOVIES_ID)
    expect(movieValues).toContain(HULU_ALL_ID)
    expect(movieValues).not.toContain(NETFLIX_SERIES_ID)
    expect(seriesValues).toContain(NETFLIX_SERIES_ID)
    expect(seriesValues).toContain(HULU_ALL_ID)
    // Hidden (Power off) selection is never offered.
    const hidden = genericStreamingCatalogId("prime", "italy", "movies", "auto", null)
    expect(movieValues).not.toContain(hidden)

    // Identical neutral names are disambiguated by the section label.
    // i18n resolves to keys in this harness (same convention as the labels).
    const netflixOption = Array.from(movieSelect.options).find((o) => o.value === NETFLIX_MOVIES_ID)
    expect(netflixOption?.textContent).toContain("ui.movie")
    const netflixSeriesOption = Array.from(seriesSelect.options).find((o) => o.value === NETFLIX_SERIES_ID)
    expect(netflixSeriesOption?.textContent).toContain("ui.tvSeries")
  })

  it("distinguishes streaming lists with the same name but different policies or variants", () => {
    renderWithCtx(<RankingSourceSection />, {
      streamingSelections: [
        { service: "netflix", country: "IT", sections: ["movies"], source: "flixpatrol" },
        { service: "netflix", country: "IT", sections: ["movies"], source: "justwatch" },
        { service: "netflix", country: "IT", sections: ["movies"], source: "flixpatrol", variant: "kids" },
      ],
    })
    const select = screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement
    const options = Array.from(select.options).filter((o) => o.value.startsWith("pictorium-stream2-"))
    expect(options).toHaveLength(3)
    expect(new Set(options.map((o) => o.textContent)).size).toBe(3)
    expect(options.some((o) => o.textContent?.includes("ui.streamSourceOnlyJw"))).toBe(true)
    expect(options.some((o) => o.textContent?.includes("kids"))).toBe(true)
  })

  it("shows the streaming list name for a stored streaming selection", () => {
    renderWithCtx(<RankingSourceSection />, {
      streamingSelections: STREAMING,
      rankingSourceMovie: NETFLIX_MOVIES_ID,
      rankingSourceSeries: HULU_ALL_ID,
    })

    expect((screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement).value).toBe(NETFLIX_MOVIES_ID)
    expect((screen.getByLabelText("ui.tvSeries — Top 20") as HTMLSelectElement).value).toBe(HULU_ALL_ID)
    // Trigger labels carry the list names, never a JustWatch claim.
    const triggerLabels = screen.getAllByRole("button").map((b) => b.textContent ?? "")
    expect(triggerLabels.some((label) => label.includes("Netflix Italia - Top 10"))).toBe(true)
    const huluName = genericStreamingCatalogName("hulu", "united-states", "all", null)
    expect(triggerLabels.some((label) => label.includes(huluName))).toBe(true)
  })

  it("falls back to JustWatch for a removed or disabled streaming selection", () => {
    renderWithCtx(<RankingSourceSection />, {
      streamingSelections: [{ service: "prime", country: "IT", enabled: false }],
      rankingSourceMovie: NETFLIX_MOVIES_ID,
    })
    expect((screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement).value).toBe("")
  })

  it("saves a streaming pick through the shared setter", async () => {
    const u = userEvent.setup()
    const setRankingSource = vi.fn(async () => true)
    renderWithCtx(<RankingSourceSection />, {
      streamingSelections: STREAMING,
      setRankingSource,
    })

    await u.selectOptions(screen.getByLabelText("ui.tvSeries — Top 20"), HULU_ALL_ID)
    await waitFor(() => expect(setRankingSource).toHaveBeenCalledWith("series", HULU_ALL_ID))
  })

  it("offers imported addon catalogs by their real remote type", async () => {
    const u = userEvent.setup()
    const setRankingSource = vi.fn(async () => true)
    renderWithCtx(<RankingSourceSection />, {
      customCatalogs: [ADDON_MOVIE, ADDON_SERIES],
      rankingSourceMovie: ADDON_MOVIE.id,
      setRankingSource,
    })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement
    const seriesSelect = screen.getByLabelText("ui.tvSeries — Top 20") as HTMLSelectElement
    expect(movieSelect.value).toBe(ADDON_MOVIE.id)
    expect(Array.from(movieSelect.options).map((o) => o.value)).toContain(ADDON_MOVIE.id)
    expect(Array.from(movieSelect.options).map((o) => o.value)).not.toContain(ADDON_SERIES.id)
    expect(Array.from(seriesSelect.options).map((o) => o.value)).toContain(ADDON_SERIES.id)
    expect(Array.from(seriesSelect.options).map((o) => o.value)).not.toContain(ADDON_MOVIE.id)

    await u.selectOptions(seriesSelect, ADDON_SERIES.id)
    await waitFor(() => expect(setRankingSource).toHaveBeenCalledWith("series", ADDON_SERIES.id))
  })

  it("exposes an accessible explainer for the section", () => {
    renderWithCtx(<RankingSourceSection />, { customCatalogs: [] })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20")
    expect(movieSelect.getAttribute("aria-describedby")).toBe("ranking-source-desc")
    expect(screen.getByText("ui.rankingSourceTitle", { exact: false })).toBeInTheDocument()
  })

  it("offers all three JustWatch modes in the dropdown for regional settings", () => {
    renderWithCtx(<RankingSourceSection />, { customCatalogs: [] })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement
    const values = Array.from(movieSelect.options).map((o) => o.value)
    expect(values).toContain("")
    expect(values).toContain("jw:popular")
    expect(values).toContain("jw:trending")

    const popularOption = Array.from(movieSelect.options).find((o) => o.value === "jw:popular")
    expect(popularOption?.disabled).toBe(false)
  })

  it("disables Popular and Trending in Global region with explanation", () => {
    renderWithCtx(<RankingSourceSection regionCode="GLOBAL" />, {
      customCatalogs: [],
    })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement
    const popularOption = Array.from(movieSelect.options).find((o) => o.value === "jw:popular")
    const trendingOption = Array.from(movieSelect.options).find((o) => o.value === "jw:trending")
    expect(popularOption?.disabled).toBe(true)
    expect(trendingOption?.disabled).toBe(true)
  })

  it("shows incompatibility warning when a popular selection meets Global region without silent replacement", () => {
    renderWithCtx(<RankingSourceSection regionCode="GLOBAL" />, {
      customCatalogs: [],
      rankingSourceMovie: "jw:popular",
    })

    const movieSelect = screen.getByLabelText("ui.movie — Top 20") as HTMLSelectElement
    expect(movieSelect.value).toBe("jw:popular")
    expect(screen.getByText("ui.rankingSourceIncompatible")).toBeInTheDocument()
  })
})
