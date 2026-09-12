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
})
