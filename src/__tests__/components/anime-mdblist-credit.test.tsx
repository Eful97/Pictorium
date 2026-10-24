import { describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import { renderWithCtx } from "@/__tests__/test-utils"
import { CataloghiView } from "@/components/CataloghiView"
import { userFetch } from "@/lib/http"

vi.mock("@/lib/http", () => ({ userFetch: vi.fn() }))
vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  useT: () => ({ t: (key: string) => key, lang: "it" }),
}))
vi.mock("@/components/CustomCatalogModal", () => ({ CustomCatalogModal: () => null }))
vi.mock("@/components/AddonCatalogModal", () => ({ AddonCatalogModal: () => null }))
vi.mock("@/components/CatalogManagerModal", () => ({ CatalogManagerModal: () => null }))

const mockedUserFetch = vi.mocked(userFetch)

describe("anime MDBList snoak credit link", () => {
  it("anime movies card links trending-anime-movies, anime series links trending-anime-shows (mdblist.svg, new tab, accessible)", async () => {
    mockedUserFetch.mockResolvedValue(new Response(JSON.stringify({})))
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [],
      disabledCatalogIds: [],
      mdblistAnimeList: [
        { id: 5, media_type: "movie", title: "Anime Film", poster_path: "/a.jpg", rank: 1 },
        { id: 6, media_type: "tv", title: "Anime Show", poster_path: "/b.jpg", rank: 1 },
      ],
    })
    await screen.findByText(/ui\.trendingAnime/)

    const moviesLink = screen.getByRole("link", { name: /trending-anime-movies/i })
    expect(moviesLink.getAttribute("href")).toBe("https://mdblist.com/lists/snoak/trending-anime-movies")
    expect(moviesLink.getAttribute("target")).toBe("_blank")
    expect(moviesLink.getAttribute("rel")).toContain("noopener")
    const moviesImg = within(moviesLink as HTMLElement).getByRole("presentation", { hidden: true })
    expect((moviesImg as HTMLImageElement).getAttribute("src")).toBe("/rating/mdblist.svg")

    const seriesLink = screen.getByRole("link", { name: /trending-anime-shows/i })
    expect(seriesLink.getAttribute("href")).toBe("https://mdblist.com/lists/snoak/trending-anime-shows")
    expect(seriesLink.getAttribute("target")).toBe("_blank")
    expect(seriesLink.getAttribute("rel")).toContain("noopener")
    const seriesImg = within(seriesLink as HTMLElement).getByRole("presentation", { hidden: true })
    expect((seriesImg as HTMLImageElement).getAttribute("src")).toBe("/rating/mdblist.svg")
  })

  it("non-anime cards carry no MDBList credit icon", async () => {
    mockedUserFetch.mockResolvedValue(new Response(JSON.stringify({})))
    renderWithCtx(<CataloghiView />, {
      tmdbKey: "k",
      streamingSelections: [],
      disabledCatalogIds: [],
      mdblistAnimeList: [
        { id: 5, media_type: "movie", title: "Anime Film", poster_path: "/a.jpg", rank: 1 },
        { id: 6, media_type: "tv", title: "Anime Show", poster_path: "/b.jpg", rank: 1 },
      ],
      trending: [
        { id: 1, media_type: "movie" as const, title: "T", poster_path: "/t.jpg", rank: 1 },
        { id: 2, media_type: "tv" as const, title: "S", poster_path: "/s.jpg", rank: 2 },
      ],
      rankingSourceMovie: "",
      rankingSourceSeries: "",
    })
    await screen.findByText(/ui\.trendingAnime/)
    await screen.findByText(/ui\.justwatchTop20/)
    // Exactly the two anime credit icons (movies + series); JW/platform cards stay untouched.
    expect(document.querySelectorAll('img[src="/rating/mdblist.svg"]')).toHaveLength(2)
  })
})
