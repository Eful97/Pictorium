import { describe, expect, it, vi, beforeEach } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { DesktopCommunityLinks, MobileCommunityLinks } from "@/components/HeaderCommunityLinks"
import { renderWithCtx } from "@/__tests__/test-utils"

describe("HeaderCommunityLinks", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: 3, target: 6, percentage: 50 }),
    }) as unknown as typeof fetch
  })

  it("renders desktop community links with correct hrefs and goal", async () => {
    renderWithCtx(<DesktopCommunityLinks />)

    const ghLink = screen.getByLabelText("GitHub Repository")
    expect(ghLink).toHaveAttribute("href", "https://github.com/Eful97/Pictorium")
    expect(ghLink).toHaveAttribute("target", "_blank")

    const discordLink = screen.getByLabelText("Discord Community")
    expect(discordLink).toHaveAttribute("href", "https://discord.gg/sYfWyXYVUp")
    expect(discordLink).toHaveAttribute("target", "_blank")

    await waitFor(() => {
      expect(screen.getByText("3/6€")).toBeInTheDocument()
    })

    const kofiLink = screen.getByRole("link", { name: /support vps on ko-fi/i })
    expect(kofiLink).toHaveAttribute("href", "https://ko-fi.com/eful97")
    expect(kofiLink).toHaveAttribute("target", "_blank")
  })

  it("renders mobile community links properly", async () => {
    renderWithCtx(<MobileCommunityLinks />)

    expect(screen.getByText("GitHub")).toBeInTheDocument()
    expect(screen.getByText("Discord")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText("VPS: 3/6€")).toBeInTheDocument()
    })
  })
})
