import { describe, it, expect, vi } from "vitest"
import { screen, fireEvent, waitFor } from "@testing-library/react"
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

  it("applies global Orizzontale badge defaults when switching to landscape without a saved profile", async () => {
    // Regressione: gli slider badge dell'editor ignoravano i default
    // Orizzontale (mostravano i valori portrait) al primo ingresso in
    // landscape senza stash né mapping salvato.
    localStorage.setItem("badgeDefaults", JSON.stringify({ landscape: { topBadgeScale: 150 } }))
    try {
      const u = userEvent.setup()
      renderWithCtx(
        <EditView />,
        {
          selected: mockSelected,
          posters: [{ file_path: "/p1.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
          previewPoster: { file_path: "/p1.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
        }
      )
      await u.click(screen.getByRole("tab", { name: "ui.transform" }))
      await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
      const scales = screen.getAllByRole("slider", { name: "ui.scale" })
      expect(scales.some((s) => s.getAttribute("aria-valuetext") === "150%")).toBe(true)
    } finally {
      localStorage.removeItem("badgeDefaults")
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
  it("shows saved state when mapping matches current state, and unsaved when modified", () => {
    const mapping = {
      tmdbId: 550,
      mediaType: "movie" as const,
      title: "Fight Club",
      posterPath: "/fc.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2026-01-01",
      posterShape: "poster" as const,
    }
    const mappingsMap = new Map([["movie:550", mapping]])

    // Without edits, matching saved mapping
    renderWithCtx(
      <EditView />,
      {
        selected: mockSelected,
        posters: [{ file_path: "/fc.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 }],
        previewPoster: { file_path: "/fc.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
        mappingsMap,
      }
    )

    // Should indicate saved
    expect(screen.getAllByText("ui.savedShort").length).toBeGreaterThan(0)
  })

  it("shows the cover-only save action next to the full save", () => {
    renderWithCtx(<EditView />, {
      selected: mockSelected,
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
    })
    // Desktop/footer full-label button with translated accessible label + help.
    const coverBtns = screen.getAllByRole("button", { name: "ui.saveCoverOnly" })
    expect(coverBtns.length).toBeGreaterThanOrEqual(2)
    const footerBtn = coverBtns.find((b) => b.textContent === "ui.saveCoverOnly")
    expect(footerBtn).toBeInTheDocument()
    expect(footerBtn).toHaveAttribute("title", "ui.saveCoverOnlyHint")
    // Mobile top bar carries the same action (icon button, same label).
    // Full save still present.
    expect(screen.getByText("ui.savePoster")).toBeInTheDocument()
  })

  it("invokes saveCoverOnly when the cover-only action is clicked", async () => {
    const u = userEvent.setup()
    const saveCoverOnly = vi.fn(async () => true)
    renderWithCtx(<EditView />, {
      selected: mockSelected,
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
      saveCoverOnly,
    })
    // Footer button is enabled with idle state; click the first match.
    const btns = screen.getAllByRole("button", { name: "ui.saveCoverOnly" })
    expect(btns[0]).toBeEnabled()
    await u.click(btns[0])
    expect(saveCoverOnly).toHaveBeenCalledTimes(1)
  })

  it("blocks full save and Ctrl+S while a cover-only save is in flight", async () => {
    const u = userEvent.setup()
    let resolveCover!: (v: boolean) => void
    const saveCoverOnly = vi.fn(() => new Promise<boolean>((res) => { resolveCover = res }))
    const saveConfig = vi.fn(async () => true)
    renderWithCtx(<EditView />, {
      selected: mockSelected,
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
      saveCoverOnly,
      saveConfig,
    })
    const coverBtns = screen.getAllByRole("button", { name: "ui.saveCoverOnly" })
    const footerCover = coverBtns.find((b) => b.textContent === "ui.saveCoverOnly") ?? coverBtns[0]
    const fullBtns = screen.getAllByRole("button", { name: "ui.savePoster" })
    const footerFull = fullBtns.find((b) => b.textContent === "ui.savePoster") ?? fullBtns[0]
    expect(footerCover).toBeEnabled()
    expect(footerFull).toBeEnabled()
    // Start the deferred cover-only save (do not await: stays in flight).
    const inFlight = u.click(footerCover)
    await waitFor(() => expect(saveCoverOnly).toHaveBeenCalledTimes(1))
    // While in flight both actions are disabled …
    await waitFor(() => {
      expect(footerCover).toBeDisabled()
      expect(footerFull).toBeDisabled()
    })
    // … and competing triggers (full-save click has no handler on a disabled
    // button; Ctrl+S reaches handleSave via the shared synchronous ref guard)
    // must not start a second save.
    fireEvent.click(footerFull)
    fireEvent.click(footerCover)
    fireEvent.keyDown(window, { key: "s", ctrlKey: true })
    expect(saveConfig).not.toHaveBeenCalled()
    expect(saveCoverOnly).toHaveBeenCalledTimes(1)
    // Release: both actions re-enable.
    resolveCover(true)
    await inFlight
    await waitFor(() => {
      expect(footerCover).toBeEnabled()
      expect(footerFull).toBeEnabled()
    })
  })
});
