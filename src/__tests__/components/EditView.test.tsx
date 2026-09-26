import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import EditView from "@/components/EditView"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { SearchResult } from "@/lib/types"

const mockSelected: SearchResult = {
  id: 550,
  media_type: "movie",
  title: "Fight Club",
  name: "",
  poster_path: "/fc.jpg",
  release_date: "1999-10-15",
}

describe("EditView", () => {
  it("shows search bar when no item selected", () => {
    renderWithCtx(<EditView />)
    expect(screen.getByPlaceholderText("ui.searchPlaceholderLarge")).toBeInTheDocument()
  })

  it("shows no key message when no tmdbKey", () => {
    renderWithCtx(<EditView />, { tmdbKey: "" })
    expect(screen.getByText("ui.noKey")).toBeInTheDocument()
  })

  it("shows home instead of welcome when the server has an instance key", () => {
    renderWithCtx(<EditView />, { tmdbKey: "", serverHasTmdbKey: true })
    expect(screen.queryByText("ui.noKey")).not.toBeInTheDocument()
    const title = screen.getByRole("heading", { level: 1 })
    expect(title.textContent).toContain("ui.heroTitleLead")
  })

  it("shows trending when no item selected and has tmdbKey", () => {
    renderWithCtx(<EditView />)
    const title = screen.getByRole("heading", { level: 1 })
    expect(title.textContent).toContain("ui.heroTitleLead")
  })

  it("shows preview section when item selected", () => {
    renderWithCtx(<EditView />, { selected: mockSelected })
    expect(screen.getByText("ui.previewLive")).toBeInTheDocument()
  })

  it("shows title when item selected", () => {
    renderWithCtx(<EditView />, { selected: mockSelected })
    expect(screen.getAllByText("Fight Club")[0]).toBeInTheDocument()
  })

  it("shows save poster button when item selected with previewPoster", () => {
    renderWithCtx(<EditView />, {
      selected: mockSelected,
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
    })
    expect(screen.getByText("ui.savePoster")).toBeInTheDocument()
  })

  it("switches right tab on click", async () => {
    const u = userEvent.setup()
    renderWithCtx(<EditView />, {
      selected: mockSelected,
      posters: [{ file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
      selectedLogo: { file_path: "/logo.png", iso_639_1: "en", vote_average: 0, width: 200, height: 100 },
    })
    const transformTab = screen.getByText("ui.transform")
    await u.click(transformTab)
    expect(transformTab.closest("button")).toHaveClass("tab-chip-active")
  })

  it("shows home hero when no item selected and has tmdbKey", () => {
    renderWithCtx(<EditView />, { trending: [] })
    const title = screen.getByRole("heading", { level: 1 })
    expect(title.textContent).toContain("ui.heroTitleLead")
  })

  it("switches mobile section to preview when a logo is clicked on mobile", async () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width: 1023.5px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    try {
      const u = userEvent.setup()
      const selectLogo = vi.fn().mockResolvedValue(undefined)
      const { container } = renderWithCtx(<EditView />, {
        selected: mockSelected,
        posters: [{ file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
        previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
        logos: [{ file_path: "/logo.png", iso_639_1: "en", vote_average: 0, width: 200, height: 100 }],
        selectLogo,
      })

      // Switch to customize section
      const customizeButton = screen.getByRole("button", { name: "ui.customize" })
      await u.click(customizeButton)
      expect(customizeButton).toHaveClass("text-white")

      // Find the logo button tile
      const logoImg = container.querySelector('img[src*="/logo.png"]')
      expect(logoImg).toBeInTheDocument()
      const logoTile = logoImg!.closest("button")
      expect(logoTile).toBeInTheDocument()

      await u.click(logoTile!)

      expect(selectLogo).toHaveBeenCalledWith(
        expect.objectContaining({ file_path: "/logo.png" })
      )

      // Mobile section should have switched back to "preview"
      const previewButton = screen.getByRole("button", { name: "ui.preview" })
      expect(previewButton).toHaveClass("text-white")
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })

  it("displays backdrops label and count in mobile switcher when shape is landscape", async () => {
    const u = userEvent.setup()
    const { container } = renderWithCtx(
      <EditView />,
      {
        selected: mockSelected,
        posters: [{ file_path: "/p1.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
        previewPoster: { file_path: "/p1.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
      }
    )

    // The sticky mobile header container must be present
    const stickyHeader = container.querySelector(".sticky.top-0.z-30")
    expect(stickyHeader).toBeInTheDocument()

    // Initially in portrait, shows poster label
    expect(screen.getByText("ui.poster")).toBeInTheDocument()

    // Click landscape button
    const landscapeBtn = screen.getByRole("button", { name: "ui.posterShapeLandscape" })
    await u.click(landscapeBtn)

    // The first mobile switcher button should now show backdrops
    expect(screen.getByText("Sfondi")).toBeInTheDocument()
  })
})
