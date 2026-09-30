import { describe, it, expect, vi, afterEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PosterOptions } from "@/components/PosterOptions"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { TMDBImage } from "@/lib/types"

const SELECTED = { id: 7, media_type: "movie", title: "Test", poster_path: "/t.jpg" } as const

const mockPosters: TMDBImage[] = [
  { file_path: "/clean1.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
  { file_path: "/clean2.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
  { file_path: "/en1.jpg", iso_639_1: "en", vote_average: 0, width: 1000, height: 1500 },
  { file_path: "/it1.jpg", iso_639_1: "it", vote_average: 0, width: 1000, height: 1500 },
]

describe("PosterOptions", () => {
  it("shows loading when no posters", () => {
    renderWithCtx(<PosterOptions posters={[]} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    expect(screen.getAllByText("ui.loading").length).toBeGreaterThan(0)
  })

  it("renders clean posters tab by default", () => {
    renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    expect(screen.getByText(/Clean/)).toBeInTheDocument()
  })

  it("shows language-specific tab", () => {
    renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    expect(screen.getByText(/Italiano/)).toBeInTheDocument()
  })

  it("shows English tab for en posters", () => {
    renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    expect(screen.getByText(/English/)).toBeInTheDocument()
  })

  it("switches tab on click", async () => {
    const u = userEvent.setup()
    renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    const itTab = screen.getByText(/Italiano/)
    await u.click(itTab)
    expect(itTab.closest("button")).toHaveClass("tab-chip-active")
  })

  it("showTabs=false hides tabs", () => {
    renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} showTabs={false} />)
    expect(screen.queryByText(/Clean/)).not.toBeInTheDocument()
  })

  it("renders clean poster images with correct src", () => {
    const { container } = renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    const imgs = container.querySelectorAll("img")
    const cleanSrcs = mockPosters.filter((p) => p.iso_639_1 === null).map((p) =>
      `https://image.tmdb.org/t/p/w154${p.file_path}`
    )
    cleanSrcs.forEach((src) => {
      const match = Array.from(imgs).some((img) => img.getAttribute("src") === src)
      expect(match).toBeTruthy()
    })
  })

  it("renders session custom tiles first with a remove button, saved tile without", async () => {
    const u = userEvent.setup()
    const onRemove = vi.fn()
    const sessionTile: TMDBImage = { file_path: "https://i.imgur.com/session.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }
    const savedTile: TMDBImage = { file_path: "https://i.imgur.com/saved.jpg", iso_639_1: null, vote_average: 0, width: 0, height: 0 }
    const { container } = renderWithCtx(
      <PosterOptions
        posters={mockPosters}
        posterActivePath={null}
        lang="it"
        selectPoster={() => {}}
        customPosters={[sessionTile]}
        savedCustomPoster={savedTile}
        onRemoveCustomPoster={onRemove}
      />,
    )
    const imgs = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"))
    // Tile custom primi in griglia, thumb diretta (niente proxy)
    expect(imgs[0]).toBe("https://i.imgur.com/session.jpg")
    expect(imgs[1]).toBe("https://i.imgur.com/saved.jpg")
    // Una sola × (tile di sessione); il salvato non ne ha
    const removeBtns = screen.getAllByRole("button", { name: "ui.remove" })
    expect(removeBtns).toHaveLength(1)
    await u.click(removeBtns[0])
    expect(onRemove).toHaveBeenCalledWith("https://i.imgur.com/session.jpg")
  })

  it("no remove button without handler", () => {
    const sessionTile: TMDBImage = { file_path: "https://i.imgur.com/session.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }
    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} customPosters={[sessionTile]} />,
    )
    expect(screen.queryByRole("button", { name: "ui.remove" })).toBeNull()
  })

  it("hides the Fanart.tv tab without a selected title", () => {
    renderWithCtx(<PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />)
    expect(screen.queryByTestId("fanart-tab-panel")).toBeNull()
    expect(screen.queryByRole("button", { name: "ui.fanartTitle" })).toBeNull()
  })

  it("shows the Fanart.tv tab next to the language tabs when selected", () => {
    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />,
      { selected: { ...SELECTED, media_type: "movie" } },
    )
    expect(screen.getByRole("button", { name: "ui.fanartTitle" })).toBeInTheDocument()
    // Le tab esistenti restano invariate
    expect(screen.getByText(/Clean/)).toBeInTheDocument()
    expect(screen.getByText(/Italiano/)).toBeInTheDocument()
  })

  it("loads fanart posters on tab click and selects a tile", async () => {
    const u = userEvent.setup()
    const onSelect = vi.fn()
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (url: unknown) => {
      if (String(url).includes("/api/fanart/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            posters: [
              { url: "https://assets.fanart.tv/fanart/movies/7/movieposter/a.jpg", lang: "it", likes: 42 },
              { url: "https://assets.fanart.tv/fanart/movies/7/movieposter/b.jpg", lang: "00", likes: 3 },
            ],
            source: "fanart",
          }),
        }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }) as unknown as typeof fetch)

    const { container } = renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={onSelect} />,
      { selected: { ...SELECTED, media_type: "movie" } },
    )
    // Nessuna chiamata Fanart prima dell'apertura (lazy)
    expect(fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/api/fanart/"))).toHaveLength(0)
    await u.click(screen.getByRole("button", { name: "ui.fanartTitle" }))

    await waitFor(() => {
      const imgs = Array.from(container.querySelectorAll("[data-testid='fanart-tab-panel'] img"))
      expect(imgs.length).toBeGreaterThan(0)
    })
    const panel = screen.getByTestId("fanart-tab-panel")
    const imgs = panel.querySelectorAll("img")
    expect(imgs[0]?.getAttribute("src")).toBe("https://assets.fanart.tv/fanart/movies/7/movieposter/a.jpg")
    // Didascalia lingua + likes; "00" resta lingua sconosciuta, mai textless
    expect(panel.textContent).toContain("ui.fanartLangUnknown")

    const tiles = panel.querySelectorAll("button")
    await u.click(tiles[0])
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ file_path: "https://assets.fanart.tv/fanart/movies/7/movieposter/a.jpg" }),
    )
  })

  it("fanart tab shows the not-configured state on 503", async () => {
    const u = userEvent.setup()
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "nope", code: "fanart_not_configured" }),
    })) as unknown as typeof fetch)

    renderWithCtx(
      <PosterOptions posters={mockPosters} posterActivePath={null} lang="it" selectPoster={() => {}} />,
      { selected: { ...SELECTED, media_type: "movie" } },
    )
    await u.click(screen.getByRole("button", { name: "ui.fanartTitle" }))
    await waitFor(() => {
      expect(screen.getByTestId("fanart-tab-panel").textContent).toContain("ui.fanartNotConfigured")
    })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
