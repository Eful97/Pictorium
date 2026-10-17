import { describe, expect, it, vi, beforeEach } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { CataloghiView } from "@/components/CataloghiView"
import { renderWithCtx } from "@/__tests__/test-utils"
import { detectSeasonalThemeFromCatalogName } from "@/lib/seasonal-theme"
import { userFetch } from "@/lib/http"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/contexts/TranslationContext")>(),
  useT: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/CustomCatalogModal", () => ({ CustomCatalogModal: () => null }))
vi.mock("@/components/CatalogManagerModal", () => ({ CatalogManagerModal: () => null }))

const mockedFetch = vi.mocked(userFetch)

const movieItem = { id: 101, media_type: "movie", title: "Compact Movie", poster_path: "/m.jpg" }
const tvItem = { id: 102, media_type: "tv", title: "Compact Show", poster_path: "/s.jpg" }
const response = (items: unknown[]) => new Response(JSON.stringify({ items, status: "ok", total: items.length }))

/** Preview (no skip) serves both sections; full grid loads serve the requested section. */
function mockMixedCatalog() {
  mockedFetch.mockImplementation(async (url) => {
    const s = String(url)
    if (s.includes("skip=")) return response(s.includes("media_type=tv") ? [tvItem] : [movieItem])
    return response([movieItem, tvItem])
  })
}

function listNames(navigateToPoster: ReturnType<typeof vi.fn>): string[] {
  return navigateToPoster.mock.calls.map((call) => call[2] as string)
}

/**
 * Expand-card lookup: the RankingSourceSection dropdowns are native
 * <button>s whose accessible names also contain "— Top 20/10"; the
 * SimklCard expand control is a DIV with role=button, so filter by tag.
 */
async function findExpandCard(name: RegExp): Promise<HTMLElement> {
  const all = await screen.findAllByRole("button", { name })
  const card = all.find((el) => el.tagName === "DIV")
  if (!card) throw new Error(`expand card not found: ${name}`)
  return card as HTMLElement
}

/**
 * JW row card when a custom list shares the source name: custom/platform/
 * anime rows always carry a " — <slot>" suffix, the JW row reads the bare
 * ranking-source name, so the match without an em-dash is the JW card.
 */
async function findBareRowCard(name: RegExp): Promise<HTMLElement> {
  const all = await screen.findAllByRole("button", { name })
  const card = all
    .filter((el) => el.tagName === "DIV")
    .find((el) => !el.getAttribute("aria-label")?.includes("—") && !el.textContent?.includes("—"))
  if (!card) throw new Error(`bare row card not found: ${name}`)
  return card as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
})

describe("seasonal context parity: custom mixed series rename (client wiring)", () => {
  const mixed = { id: "mix1", name: "Cozy Autumn", type: "mixed" as const, url: "https://mdblist.com/lists/mix1" }

  it("compact tile AND expanded grid carry the series-slot rename (Halloween ON)", async () => {
    mockMixedCatalog()
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      customCatalogs: [mixed],
      catalogRenames: { "pictorium-custom-series-mix1": "Halloween Nights" },
      navigateToPoster,
    })
    // Compact TV tile click.
    fireEvent.click(await screen.findByAltText("Compact Show"))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights"])
    expect(detectSeasonalThemeFromCatalogName(listNames(navigateToPoster)[0])).toBe("halloween")

    // Expanded TV grid click resolves the same effective name at click time.
    fireEvent.click(await findExpandCard(/Cozy Autumn — ui.tvSeries/))
    const dialog = await screen.findByRole("dialog", { name: "Cozy Autumn — ui.tvSeries" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Compact Show" }))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights", "Halloween Nights"])
    expect(detectSeasonalThemeFromCatalogName(listNames(navigateToPoster)[1])).toBe("halloween")
  })

  it("a series-slot rename away from Halloween clears the theme on both paths (Halloween OFF)", async () => {
    mockMixedCatalog()
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      customCatalogs: [{ ...mixed, name: "Halloween Nights" }],
      catalogRenames: { "pictorium-custom-series-mix1": "Cozy Autumn" },
      navigateToPoster,
    })
    fireEvent.click(await screen.findByAltText("Compact Show"))
    expect(listNames(navigateToPoster)).toEqual(["Cozy Autumn"])
    expect(detectSeasonalThemeFromCatalogName(listNames(navigateToPoster)[0])).toBeNull()

    fireEvent.click(await findExpandCard(/Halloween Nights — ui.tvSeries/))
    const dialog = await screen.findByRole("dialog", { name: "Halloween Nights — ui.tvSeries" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Compact Show" }))
    expect(listNames(navigateToPoster)).toEqual(["Cozy Autumn", "Cozy Autumn"])
    expect(detectSeasonalThemeFromCatalogName(listNames(navigateToPoster)[1])).toBeNull()
  })
})

describe("seasonal context parity: built-in expanded grid matches compact tile", () => {
  it("renamed JustWatch series grid resolves like the compact click (no gridTitle fallback)", async () => {
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      trending: [movieItem, tvItem] as never,
      trendingStatus: "ok" as never,
      catalogRenames: { "pictorium-jw-series": "Halloween Nights" },
      navigateToPoster,
    })
    fireEvent.click(await screen.findByAltText("Compact Show"))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights"])

    // Integrated titles stay rename-aware (master): the renamed series row
    // and its grid dialog both read "Halloween Nights", not the static
    // "JustWatch — …" fallback from the feature branch.
    fireEvent.click(await findExpandCard(/Halloween Nights/))
    const dialog = await screen.findByRole("dialog", { name: "Halloween Nights" })
    // No leaked section-as-notice: the old wiring passed "tv" as the notice.
    expect(within(dialog).queryByText("tv")).toBeNull()
    expect(within(dialog).queryByText("movie")).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: "Compact Show" }))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights", "Halloween Nights"])
    expect(detectSeasonalThemeFromCatalogName(listNames(navigateToPoster)[1])).toBe("halloween")
  })

  it("Top 20 driven by a Halloween ranking source matches on both paths", async () => {
    mockMixedCatalog()
    const navigateToPoster = vi.fn()
    const spooky = { id: "spooky", name: "Halloween invariants", type: "mixed" as const, url: "https://mdblist.com/lists/spooky" }
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      trending: [movieItem, tvItem] as never,
      trendingStatus: "ok" as never,
      customCatalogs: [spooky],
      rankingSourceMovie: "spooky",
      navigateToPoster,
    })
    // The mixed custom section row reads "Halloween invariants — ui.movie",
    // so match the JW row card (bare source name, no em-dash) explicitly.
    const jwMovieCard = await findBareRowCard(/Halloween invariants/)
    fireEvent.click(within(jwMovieCard).getByAltText("Compact Movie"))
    expect(listNames(navigateToPoster)[0]).toBe("Halloween invariants")

    // Integrated grid title follows the ranking-source override (master),
    // so the dialog reads the source name on both paths.
    fireEvent.click(await findBareRowCard(/Halloween invariants/))
    const dialog = await screen.findByRole("dialog", { name: "Halloween invariants" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Compact Movie" }))
    const names = listNames(navigateToPoster)
    expect(names).toHaveLength(2)
    expect(names[1]).toBe(names[0])
    expect(detectSeasonalThemeFromCatalogName(names[1])).toBe("halloween")
  })

  it("renamed platform series grid resolves like the compact click", async () => {
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      trending: [] as never,
      trendingStatus: "empty" as never,
      streamingCharts: { netflix: { movies: [movieItem], tv: [tvItem] } } as never,
      catalogRenames: { "pictorium-netflix-series": "Halloween Nights" },
      navigateToPoster,
    })
    fireEvent.click(await screen.findByAltText("Compact Show"))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights"])

    fireEvent.click(await findExpandCard(/ui.tvSeries — Top 10/))
    const dialog = await screen.findByRole("dialog", { name: "Netflix — ui.tvSeries" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Compact Show" }))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights", "Halloween Nights"])
    expect(detectSeasonalThemeFromCatalogName(listNames(navigateToPoster)[1])).toBe("halloween")
  })

  it("renamed anime movies grid resolves like the compact click", async () => {
    const navigateToPoster = vi.fn()
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      trending: [] as never,
      trendingStatus: "empty" as never,
      mdblistAnimeList: [movieItem, tvItem] as never,
      animeStatus: "ok" as never,
      catalogRenames: { "pictorium-anime-movies": "Halloween Nights" },
      navigateToPoster,
    })
    fireEvent.click(await screen.findByAltText("Compact Movie"))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights"])

    fireEvent.click(await findExpandCard(/ui.movie — Top 20/))
    const dialog = await screen.findByRole("dialog", { name: "Anime — ui.movie" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Compact Movie" }))
    expect(listNames(navigateToPoster)).toEqual(["Halloween Nights", "Halloween Nights"])
    expect(detectSeasonalThemeFromCatalogName(listNames(navigateToPoster)[1])).toBe("halloween")
  })
})
