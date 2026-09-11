import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { renderWithCtx } from "@/__tests__/test-utils"

describe("SettingsPanel", () => {
  it("renders genre/rating badge toggle and mirror card", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    // Toggle nella card Badge + titolo della card specchio nel tab Trasforma.
    expect(screen.getAllByText("ui.genreRatingBadge")).toHaveLength(2)
  })

  it("renders trend badge toggle", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.trendBadge")).toBeInTheDocument()
  })

  it("renders clear cache button", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const buttons = screen.getAllByRole("button")
    const clearBtn = buttons.find((b) => b.textContent === "ui.clearCache")
    expect(clearBtn).toBeTruthy()
  })

  it("renders export and import buttons", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.exportJson")).toBeInTheDocument()
    expect(screen.getByText("ui.importJson")).toBeInTheDocument()
  })

  it("renders badge style selector", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.getByText("ui.styleDefault")).toBeInTheDocument()
  })

  it("does not render API key inputs", () => {
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    expect(screen.queryByPlaceholderText("ui.tmdbKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.mdblistKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.tvdbKeyPlaceholder")).toBeNull()
  })

  it("renders 4 tabs and switches active tab on click", async () => {
    const { fireEvent } = await import("@testing-library/react")
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={() => {}}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const badgeTab = screen.getByRole("tab", { name: "ui.badgeSection" })
    const transformTab = screen.getByRole("tab", { name: "ui.transform" })
    const prefsTab = screen.getByRole("tab", { name: "ui.settingsTabPrefs" })
    const dataTab = screen.getByRole("tab", { name: "ui.settingsTabData" })

    expect(badgeTab).toHaveAttribute("aria-selected", "true")
    expect(transformTab).toHaveAttribute("aria-selected", "false")
    expect(prefsTab).toHaveAttribute("aria-selected", "false")
    expect(dataTab).toHaveAttribute("aria-selected", "false")

    fireEvent.click(prefsTab)
    expect(badgeTab).toHaveAttribute("aria-selected", "false")
    expect(prefsTab).toHaveAttribute("aria-selected", "true")
    expect(dataTab).toHaveAttribute("aria-selected", "false")
    expect(screen.getByText("ui.settingsAutomationTitle")).toBeInTheDocument()

    fireEvent.click(dataTab)
    expect(dataTab).toHaveAttribute("aria-selected", "true")
    expect(prefsTab).toHaveAttribute("aria-selected", "false")

    fireEvent.click(transformTab)
    expect(transformTab).toHaveAttribute("aria-selected", "true")
    expect(badgeTab).toHaveAttribute("aria-selected", "false")
  })

  it("calls setSettingsOpen(false) when close button is clicked", async () => {
    const { fireEvent } = await import("@testing-library/react")
    const closeSpy = vi.fn()
    renderWithCtx(
      <SettingsPanel
        setSettingsOpen={closeSpy}
        exportData={() => {}}
        importData={() => {}}
      />
    )
    const closeButtons = screen.getAllByRole("button", { name: /Chiudi|ui\.close/i })
    expect(closeButtons.length).toBeGreaterThan(0)
    fireEvent.click(closeButtons[0])
    expect(closeSpy).toHaveBeenCalledWith(false)
  })
})
