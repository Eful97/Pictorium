import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LogoOptions } from "@/components/LogoOptions"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { TMDBImage } from "@/lib/types"

const mockLogos: TMDBImage[] = [
  { file_path: "/logo_en1.png", iso_639_1: "en", vote_average: 0, width: 200, height: 100 },
  { file_path: "/logo_en2.png", iso_639_1: "en", vote_average: 0, width: 200, height: 100 },
  { file_path: "/logo_it1.png", iso_639_1: "it", vote_average: 0, width: 200, height: 100 },
  { file_path: "/logo_xx.png", iso_639_1: null, vote_average: 0, width: 200, height: 100 },
]

describe("LogoOptions", () => {
  it("shows informative empty state when no logos (no dead placeholder boxes)", () => {
    const { container } = renderWithCtx(<LogoOptions logos={[]} selectedLogo={null} lang="it" selectLogo={() => {}} removeLogo={() => {}} />)
    expect(container.querySelectorAll(".lucide-plus").length).toBe(0)
    expect(screen.getByText("ui.noLogosAvailable")).toBeInTheDocument()
  })

  it("renders language group tabs", () => {
    renderWithCtx(<LogoOptions logos={mockLogos} selectedLogo={null} lang="it" selectLogo={() => {}} removeLogo={() => {}} />)
    expect(screen.getByText("ui.all")).toBeInTheDocument()
    const italianEls = screen.getAllByText(/Italiano/)
    expect(italianEls.length).toBe(2)
    const englishEls = screen.getAllByText(/English/)
    expect(englishEls.length).toBe(2)
    const senzaEls = screen.getAllByText("ui.withoutLanguage")
    expect(senzaEls.length).toBe(1)
  })

  it("shows logos within groups", () => {
    const { container } = renderWithCtx(<LogoOptions logos={mockLogos} selectedLogo={null} lang="it" selectLogo={() => {}} removeLogo={() => {}} />)
    const imgs = container.querySelectorAll("img")
    mockLogos.forEach((logo) => {
      const matched = Array.from(imgs).some((img) => img.getAttribute("src")?.includes(logo.file_path))
      expect(matched).toBeTruthy()
    })
  })

  it("shows selected state when a logo is selected", () => {
    renderWithCtx(<LogoOptions logos={mockLogos} selectedLogo={mockLogos[0]} lang="it" selectLogo={() => {}} removeLogo={() => {}} />)
    expect(screen.getByText("ui.logoSelected")).toBeInTheDocument()
    expect(screen.getByText("ui.removeLogo")).toBeInTheDocument()
  })

  it("remove logo button calls removeLogo", async () => {
    const u = userEvent.setup()
    const removeLogo = vi.fn()
    renderWithCtx(<LogoOptions logos={mockLogos} selectedLogo={mockLogos[0]} lang="it" selectLogo={() => {}} removeLogo={removeLogo} />)
    await u.click(screen.getByText("ui.removeLogo"))
    expect(removeLogo).toHaveBeenCalled()
  })

  it("disables logo tiles when disabled prop is true", () => {
    const { container } = renderWithCtx(<LogoOptions logos={mockLogos} selectedLogo={mockLogos[0]} lang="it" selectLogo={() => {}} removeLogo={() => {}} disabled />)
    const tiles = container.querySelectorAll<HTMLButtonElement>('button.poster-tile')
    expect(tiles.length).toBeGreaterThan(0)
    tiles.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it("renders custom logo tiles first with remove buttons, saved without", async () => {
    const u = userEvent.setup()
    const selectLogo = vi.fn()
    const onRemoveCustomLogo = vi.fn()
    const custom = { file_path: "https://i.imgur.com/logo.png", iso_639_1: null, vote_average: 0, width: 400, height: 200 }
    const saved = { file_path: "https://i.imgur.com/saved.png", iso_639_1: null, vote_average: 0, width: 0, height: 0 }
    const { container } = renderWithCtx(
      <LogoOptions logos={mockLogos} selectedLogo={null} lang="it" selectLogo={selectLogo} removeLogo={() => {}} customLogos={[custom]} savedCustomLogo={saved} onRemoveCustomLogo={onRemoveCustomLogo} />,
    )
    const imgs = container.querySelectorAll("img")
    const srcs = Array.from(imgs).map((img) => img.getAttribute("src") ?? "")
    expect(srcs.some((s) => s.includes("i.imgur.com/logo.png"))).toBe(true)
    expect(srcs.some((s) => s.includes("i.imgur.com/saved.png"))).toBe(true)
    // Custom tiles precede TMDB ones in the DOM.
    expect(srcs.findIndex((s) => s.includes("i.imgur.com"))).toBeLessThan(
      srcs.findIndex((s) => s.includes("/logo_en1.png")),
    )
    // Clicking the custom tile selects the logo.
    const tile = container.querySelector<HTMLButtonElement>('button.poster-tile[title="ui.customLogoActive"]')
    expect(tile).toBeTruthy()
    await u.click(tile!)
    expect(selectLogo).toHaveBeenCalledWith(custom)
    // Only the session tile has the remove button.
    const removeBtns = screen.getAllByRole("button", { name: "ui.remove" })
    expect(removeBtns.length).toBe(1)
    await u.click(removeBtns[0])
    expect(onRemoveCustomLogo).toHaveBeenCalledWith("https://i.imgur.com/logo.png")
  })

  it("marks the active custom logo tile as selected", () => {
    const custom = { file_path: "https://i.imgur.com/logo.png", iso_639_1: null, vote_average: 0, width: 400, height: 200 }
    renderWithCtx(
      <LogoOptions logos={mockLogos} selectedLogo={custom} lang="it" selectLogo={() => {}} removeLogo={() => {}} customLogos={[custom]} />,
    )
    expect(screen.getByText("ui.logoSelected")).toBeInTheDocument()
  })

  it("renders the import topSlot above the grid", () => {
    const { container } = renderWithCtx(
      <LogoOptions logos={mockLogos} selectedLogo={null} lang="it" selectLogo={() => {}} removeLogo={() => {}} topSlot={<div data-testid="logo-import-slot" />} />,
    )
    const slot = container.querySelector('[data-testid="logo-import-slot"]')
    expect(slot).toBeTruthy()
    const firstTile = container.querySelector("button.poster-tile")
    expect(firstTile).toBeTruthy()
    expect(slot!.compareDocumentPosition(firstTile!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
