import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { DesktopCommunityLinks, MobileCommunityLinks } from "@/components/HeaderCommunityLinks"
import { renderWithCtx } from "@/__tests__/test-utils"

describe("HeaderCommunityLinks", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: 3, target: 6, percentage: 50 }),
    }) as unknown as typeof fetch
  })

  it("renders desktop community links with an icon-only Ko-fi button", () => {
    const { container } = renderWithCtx(<DesktopCommunityLinks />)

    const ghLink = screen.getByLabelText("GitHub Repository")
    expect(ghLink).toHaveAttribute("href", "https://github.com/Eful97/Pictorium")
    expect(ghLink).toHaveAttribute("target", "_blank")

    const discordLink = screen.getByLabelText("Discord Community")
    expect(discordLink).toHaveAttribute("href", "https://discord.gg/sYfWyXYVUp")
    expect(discordLink).toHaveAttribute("target", "_blank")

    const kofiLink = screen.getByRole("link", { name: "Support on Ko-fi" })
    expect(kofiLink).toHaveAttribute("href", "https://ko-fi.com/eful97")
    expect(kofiLink).toHaveAttribute("target", "_blank")
    expect(kofiLink).toHaveAttribute("rel", expect.stringContaining("noopener"))
    expect(kofiLink.querySelector("svg")).not.toBeNull()
    // Icona pura: nessun testo, nessun importo, nessuna barra di progresso
    expect(kofiLink.textContent).toBe("")
    expect(screen.queryByText(/vps goal/i)).toBeNull()
    expect(screen.queryByText(/€/)).toBeNull()
    expect(screen.queryByText("3/6€")).toBeNull()

    // Nessun fetch del goal: la barra non esiste più
    expect(global.fetch).not.toHaveBeenCalledWith("/api/kofi/goal")

    // Nessun separatore verticale nella island: icone uniformemente distanziate
    expect(container.querySelector(".h-4.w-px")).toBeNull()
    expect(container.querySelector("[class*='bg-white/10'][class*='w-px']")).toBeNull()
  })

  it("renders mobile community links with an icon-only Ko-fi pill", () => {
    renderWithCtx(<MobileCommunityLinks />)

    expect(screen.getByText("GitHub")).toBeInTheDocument()
    expect(screen.getByText("Discord")).toBeInTheDocument()

    const kofiLink = screen.getByRole("link", { name: "Support on Ko-fi" })
    expect(kofiLink).toHaveAttribute("href", "https://ko-fi.com/eful97")
    expect(kofiLink).toHaveAttribute("target", "_blank")
    expect(kofiLink).toHaveAttribute("rel", expect.stringContaining("noopener"))
    expect(kofiLink.querySelector("svg")).not.toBeNull()
    expect(kofiLink.textContent).toBe("")
    expect(screen.queryByText(/VPS:/)).toBeNull()
    expect(screen.queryByText(/€/)).toBeNull()

    expect(global.fetch).not.toHaveBeenCalledWith("/api/kofi/goal")
  })
})
