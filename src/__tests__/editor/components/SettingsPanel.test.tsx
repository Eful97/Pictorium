import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within, act } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import {
  __resetAdminTokenForTests,
  clearAdminToken,
  setAdminToken,
} from "@/lib/admin-token"

// UserSpaceSection requires the Next app router: same mock as EditViewGate.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"

let puts: { url: string; body: Record<string, unknown> }[]
let putOk = true
let presetList: unknown[] = []

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return {
          ok: putOk,
          status: putOk ? 200 : 500,
          headers: { get: () => null },
          json: async () => ({}),
        }
      }
      if (u.includes("/api/defaults/presets")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ presets: presetList }),
        }
      }
      if (u.includes("/api/custom-rating/test")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ ok: true, status: 200, ms: 3, ratings: [] }),
        }
      }
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
    }),
  )
}

function storageSnapshot(): string {
  const out: Record<string, string | null> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)!
    if (k.includes("badgeDefaults") || k.includes("pictorium")) out[k] = localStorage.getItem(k)
  }
  return JSON.stringify(out)
}

function renderPanel(props?: { setSettingsOpen?: () => void; onOpenInstall?: () => void }) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const setSettingsOpen = props?.setSettingsOpen ?? (() => {})
  const rendered = renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, {
        setSettingsOpen,
        exportData: () => {},
        importData: () => {},
        onOpenInstall: props?.onOpenInstall,
      }),
      createElement(Probe),
    ),
  )
  return { ctx: () => ctx as unknown as PosterEditorCtx, setSettingsOpen, container: rendered.container }
}

function primaryTabs() {
  return screen.getAllByRole("tab")
}

function clickTab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }))
}

beforeEach(() => {
  localStorage.clear()
  puts = []
  putOk = true
  presetList = []
  vi.clearAllMocks()
  __resetAdminTokenForTests()
  resetGuestGuardForTests()
  stubFetch()
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
})

describe("SettingsPanel five-tab navigation", () => {
  it("shows six primary tabs in order with Preset first and selected by default", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const tabs = primaryTabs()
    expect(tabs.map((b) => b.textContent)).toEqual([
      "ui.settingsTabPreset",
      "ui.settingsTabRankings",
      "ui.settingsTabInformation",
      "ui.settingsTabBadge",
      "ui.labTitle",
      "ui.settingsTabTransform",
    ])
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    for (const other of tabs.slice(1)) expect(other).toHaveAttribute("aria-selected", "false")
  })

  it("secondary Prefs/Data links live outside the primary tablist; Space only with content", async () => {
    const { container } = renderPanel()
    await screen.findByTestId("presets-panel")
    expect(primaryTabs()).toHaveLength(6)
    // Catalogs leads the secondary row, directly after the Transform primary tab.
    const secondaryIds = Array.from(
      container.querySelectorAll('[data-testid^="settings-secondary-"]'),
    ).map((el) => el.getAttribute("data-testid"))
    expect(secondaryIds).toEqual([
      "settings-secondary-catalogs",
      "settings-secondary-prefs",
      "settings-secondary-data",
    ])
    expect(screen.getByTestId("settings-secondary-prefs")).toBeInTheDocument()
    expect(screen.getByTestId("settings-secondary-data")).toBeInTheDocument()
    expect(screen.queryByTestId("settings-secondary-spazio")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("settings-secondary-prefs"))
    expect(screen.getByRole("tabpanel", { name: "ui.settingsTabPrefs" })).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("settings-secondary-data"))
    expect(screen.getByText("ui.exportJson")).toBeInTheDocument()
  })

  it("space tab appears with multi-user on and keeps prefs/data reachable", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url)
        if (u.includes("/api/status")) {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ multiUser: true }) }
        }
        if (init?.method === "PUT" && u.includes("/api/defaults")) {
          puts.push({ url: u, body: JSON.parse(init.body as string) })
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
        }
        if (u.includes("/api/defaults/presets")) {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ presets: [] }) }
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
    renderPanel()
    await screen.findByTestId("presets-panel")
    const space = await screen.findByTestId("settings-secondary-spazio")
    expect(primaryTabs()).toHaveLength(6)
    fireEvent.click(space)
    expect(await screen.findByText("ui.userSpaceOr")).toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("mobile category selector groups primary and secondary via optgroups", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 })
    const { container } = renderPanel()
    await screen.findByTestId("presets-panel")
    const select = container.querySelector("#mobile-settings-category") as HTMLSelectElement
    expect(select).toBeInTheDocument()
    const groups = Array.from(select.querySelectorAll("optgroup")).map((g) => g.getAttribute("label"))
    expect(groups).toEqual(["ui.settingsGroupPrimary", "ui.settingsGroupSecondary"])
    // Full navigation order: Catalogs directly after Transform, before Prefs/Data.
    const values = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"))
    expect(values).toEqual(["preset", "rankings", "information", "badge", "badgelab", "transform", "catalogs", "prefs", "data"])
  })

  it("does not render API key inputs", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    expect(screen.queryByPlaceholderText("ui.tmdbKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.mdblistKeyPlaceholder")).toBeNull()
    expect(screen.queryByPlaceholderText("ui.tvdbKeyPlaceholder")).toBeNull()
  })
})

describe("SettingsPanel staged session + global save", () => {
  it("preset clicks stage locally: no PUT and no local writes until Save", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-apple")
    const before = storageSnapshot()
    const putsBefore = puts.length
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    // Staged highlight, still on the same tab.
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("presets-panel")).toBeInTheDocument()
    expect(puts).toHaveLength(putsBefore)
    expect(storageSnapshot()).toBe(before)
    // Outer live truth untouched (staged only).
    expect(ctx().defaultBadgeStyle).not.toBe("minimal")
    // Save is now enabled with an unsaved status.
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    expect(screen.getByTestId("settings-save-status")).toHaveTextContent("ui.unsavedChanges")
  })

  it("one Save persists every tab value with a single PUT and stays on the tab", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    clickTab("ui.settingsTabInformation")
    // Visibility switch on the Information tab (staged, same session).
    const ratingSwitch = screen.getByRole("switch", { name: "ui.badgeRating" });
    if (ratingSwitch.getAttribute("aria-checked") !== "true") fireEvent.click(ratingSwitch)
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    // Same tab, still on the page (no close, no navigation).
    expect(screen.getByRole("tab", { name: "ui.settingsTabInformation" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    expect(toast.success).toHaveBeenCalledWith("ui.saved")
    // Outer truth converged on the staged values.
    expect(ctx().defaultBadgeRating).toBe(true)
  })

  it("failed save keeps the editable draft and the global Save retries on the same page", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-full"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
    putOk = false
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.saveError")
    expect(toast.error).toHaveBeenCalledWith("ui.saveError")
    expect(puts).toHaveLength(1)
    // Draft retained and still editable: still dirty, selection kept, no
    // extra retry button — the single global Save retries.
    expect(screen.queryByTestId("settings-retry")).not.toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("settings-save-status")).toHaveTextContent("ui.saveError")
    // Retry via the same global Save persists and clears the error.
    putOk = true
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(2)
    expect(toast.success).toHaveBeenCalledWith("ui.saved")
  })

  it("save is disabled while clean with an honest pre-save status", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    expect(screen.getByTestId("settings-save-status")).toHaveTextContent("ui.settingsNotSavedYet")
    expect(screen.queryByTestId("settings-retry")).not.toBeInTheDocument()
  })

  it("custom rating test is disabled while dirty and never flushes the draft", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    clickTab("ui.settingsTabInformation")
    const customSwitch = screen.getByRole("switch", { name: "ui.customRatings" })
    if (customSwitch.getAttribute("aria-checked") !== "true") fireEvent.click(customSwitch)
    fireEvent.change(screen.getByPlaceholderText("https://example.com/ratings/{imdbId}"), {
      target: { value: "https://example.com/ratings/{imdbId}" },
    })
    const testBtn = screen.getByRole("button", { name: "ui.customRatingTest" })
    expect(testBtn).toBeDisabled()
    expect(screen.getByText("ui.customRatingSaveFirstHint")).toBeInTheDocument()
    // The endpoint writes nothing and the staged draft was never flushed.
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    // Clean session: testing is available again.
    expect(screen.getByRole("button", { name: "ui.customRatingTest" })).not.toBeDisabled()
  })
})

describe("SettingsPanel dirty-guard close paths", () => {
  it("tab switch with a dirty draft navigates freely with no dialog (edits retained)", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    clickTab("ui.settingsTabRankings")
    // Free navigation: the tab applied immediately, no guard dialog.
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "ui.settingsTabRankings" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    // Draft retained across the switch: still dirty, Save enabled.
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    clickTab("ui.settingsTabPreset")
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
  })

  it("X, Escape and the external toolbar path all warn when dirty; backdrop clicks are blocked", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    // X close.
    fireEvent.click(screen.getByRole("button", { name: /Chiudi|Close|ui\.close/i }))
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    // Backdrop click on the centered overlay never resolves (no silent
    // discard): the modal stays open with the draft intact. The settings
    // shell underneath is aria-hidden while the modal owns the dialog role.
    fireEvent.click(screen.getByRole("dialog"))
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    expect(closeSpy).not.toHaveBeenCalled()
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("settings-dirty-continue"))
    // Escape close.
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("settings-dirty-continue"))
    // External toolbar toggle path (shell event, never a direct unmount).
    act(() => { window.dispatchEvent(new CustomEvent("pictorium:settings-close-request")) })
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    // Confirmed discard closes exactly once with no PUT.
    fireEvent.click(screen.getByTestId("settings-dirty-discard"))
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledWith(false)
    expect(puts).toHaveLength(0)
  })

  it("clean close needs no warning on any path", async () => {
    const closeSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy })
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByRole("button", { name: /Chiudi|Close|ui\.close/i }))
    expect(closeSpy).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
  })

  it("install runs only on confirmed close, never implicitly", async () => {
    const closeSpy = vi.fn()
    const installSpy = vi.fn()
    renderPanel({ setSettingsOpen: closeSpy, onOpenInstall: installSpy })
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    fireEvent.click(screen.getByTestId("settings-install"))
    // Guarded: nothing ran yet.
    expect(installSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId("settings-dirty-dialog")).toBeInTheDocument()
    // Continue: pending action dropped, still open.
    fireEvent.click(screen.getByTestId("settings-dirty-continue"))
    expect(installSpy).not.toHaveBeenCalled()
    expect(closeSpy).not.toHaveBeenCalled()
    // Confirmed: close first, then the action.
    fireEvent.click(screen.getByTestId("settings-install"))
    fireEvent.click(screen.getByTestId("settings-dirty-discard"))
    expect(closeSpy).toHaveBeenCalledWith(false)
    expect(installSpy).toHaveBeenCalledTimes(1)
  })
})

describe("SettingsPanel shape, resize and tab homes", () => {
  it("edit target survives tab switches and never touches the delivery format", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("presets-panel")
    const deliveryBefore = ctx().defaultPosterShape
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    // Preset apply on landscape: portrait flats untouched, delivery intact.
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(puts).toHaveLength(0)
    expect(ctx().defaultPosterShape).toBe(deliveryBefore)
    clickTab("ui.settingsTabRankings")
    const landscapeBtn = within(screen.getByTestId("format-target-selector")).getByText(
      "ui.posterShapeLandscape",
    ).closest("button")
    expect(landscapeBtn).toHaveAttribute("aria-pressed", "true")
    clickTab("ui.settingsTabPreset")
    expect(
      within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape").closest("button"),
    ).toHaveAttribute("aria-pressed", "true")
  })

  it("single responsive owner: tab and draft survive resize with one dialog", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    clickTab("ui.settingsTabBadge")
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 })
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    // Same tab, same staged draft after the form-factor switch.
    expect(screen.getByRole("tab", { name: "ui.settingsTabBadge" })).toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
    act(() => { window.dispatchEvent(new Event("resize")) })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
  })

  it("rank switch lives only in Rankings; Information holds visibility without duplicates", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    clickTab("ui.settingsTabRankings")
    expect(screen.getByRole("switch", { name: "ui.sash_rank" })).toBeInTheDocument()
    // Scoped to the active Rankings tabpanel (never a global getAll count).
    // Several Badge tabpanels mount simultaneously (siblings hidden); scope
    // through the Rankings-only switch to the visible panel.
    const rankSwitch = screen.getByRole("switch", { name: "ui.sash_rank" })
    const rankingsPanel = rankSwitch.closest('[role="tabpanel"]') as HTMLElement
    expect(within(rankingsPanel).getAllByText("ui.rankFamily").length).toBeGreaterThanOrEqual(1)
    clickTab("ui.settingsTabInformation")
    // No rank appearance or priority controls on the visibility tab.
    expect(screen.queryByRole("switch", { name: "ui.sash_rank" })).not.toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.badgeGenre" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.badgeYear" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.badgeRating" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.badgeQuality" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.ageBadge" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.networkLogo" })).toBeInTheDocument()
  })

  it("appearance shows styles with compact inactive hints instead of switches", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    clickTab("ui.settingsTabBadge")
    // Style homes scoped via their unique gates (several Badge tabpanels
    // mount simultaneously with siblings hidden; global text queries would
    // false-positive on hidden instances and on gate+label duplicates).
    const genreGate = screen.getByTestId("badge-genre-style")
    expect(within(genreGate).getAllByText("ui.styleGenreBadge").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId("badge-common-font")).toBeInTheDocument()
    const extraGate = screen.getByTestId("badge-extra-style")
    expect(within(extraGate).getAllByText("ui.extraBadgeStyle").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole("switch", { name: "ui.badgeGenre" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "ui.badgeRating" })).not.toBeInTheDocument()
  })

  it("transform is geometry-only: sliders plus moved position controls, no style picker", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    clickTab("ui.settingsTabTransform")
    const transformPanel = screen.getByRole("tabpanel", { name: "ui.transform" })
    expect(transformPanel).toBeInTheDocument()
    // Position hosts the network-position override only (logo alignment is
    // Auto-only: no selector, no subgroup, no card anywhere).
    expect(within(transformPanel).getByText("ui.position")).toBeInTheDocument()
    expect(within(transformPanel).getByText("ui.networkLogoPosition")).toBeInTheDocument()
    expect(within(transformPanel).queryByText("ui.logoAlign")).toBeNull()
    // Scoped to the visible transform panel: hidden Badge instances still
    // mount the picker, so a global query would false-positive.
    expect(within(transformPanel).queryByText("ui.separateRatingsStyle")).toBeNull()
  })

  it("header slot is shared: selector on primary tabs, title card on secondary", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const slot = screen.getByTestId("settings-tab-header-slot")
    expect(screen.getByTestId("format-target-selector")).toBeInTheDocument()
    // No explanatory paragraph next to the compact selector.
    expect(screen.queryByText("ui.formatTargetHint")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("settings-secondary-prefs"))
    expect(screen.queryByTestId("format-target-selector")).not.toBeInTheDocument()
    expect(screen.getByTestId("settings-tab-header-slot")).toBe(slot)
    expect(within(slot).getByText("ui.settingsTabPrefs")).toBeInTheDocument()
  })

  it("traps focus inside the desktop dialog on Tab and Shift+Tab", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const dialog = screen.getByRole("dialog")
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    expect(focusable.length).toBeGreaterThan(1)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    last.focus()
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false })
    expect(document.activeElement).toBe(first)
    first.focus()
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it("dirty dialog traps focus and restores it on resolve", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    // Close path (not tab navigation) owns the guard dialog.
    fireEvent.click(screen.getByRole("button", { name: /Chiudi|Close|ui\.close/i }))
    const dialog = screen.getByTestId("settings-dirty-dialog")
    expect(document.activeElement).toBe(screen.getByTestId("settings-dirty-continue"))
    const buttons = within(dialog).getAllByRole("button")
    // Three actions: save first (primary), safe continue, exit-discard.
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual([
      "settings-dirty-save",
      "settings-dirty-continue",
      "settings-dirty-discard",
    ])
    const last = buttons[buttons.length - 1]
    last.focus()
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false })
    expect(document.activeElement).toBe(screen.getByTestId("settings-dirty-save"))
    fireEvent.click(screen.getByTestId("settings-dirty-continue"))
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
  })
})

describe("SettingsPanel prefs/data panels", () => {
  it("prefs keeps delivery format, region and episode source staged under Save", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByTestId("settings-secondary-prefs"))
    const prefsPanel = screen.getByRole("tabpanel", { name: "ui.settingsTabPrefs" })
    const landscapeBtn = within(prefsPanel).getByRole("button", { name: "ui.posterShapeLandscape" })
    fireEvent.click(landscapeBtn)
    expect(puts).toHaveLength(0)
    expect(ctx().defaultPosterShape).not.toBe("landscape")
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(ctx().defaultPosterShape).toBe("landscape")
  })

  it("allows selecting TVDB as episode metadata source in prefs tab", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByTestId("settings-secondary-prefs"))
    const tvdbBtn = screen.getByRole("button", { name: "TVDB" })
    const tmdbBtn = screen.getByRole("button", { name: "TMDB" })
    expect(tmdbBtn.className).toContain("bg-white/20")
    fireEvent.click(tvdbBtn)
    expect(tvdbBtn.className).toContain("bg-white/20")
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
  })

  it("renders export/import and the diagnostics disclosure on data", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByTestId("settings-secondary-data"))
    expect(screen.getByText("ui.exportJson")).toBeInTheDocument()
    expect(screen.getByText("ui.importJson")).toBeInTheDocument()
    expect(screen.queryByText("ui.clearCache")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /ui\.cacheDiagnostics/ }))
    const buttons = screen.getAllByRole("button")
    expect(buttons.find((b) => b.textContent === "ui.clearCache")).toBeTruthy()
  })

  it("shows the admin token card only when the server has ADMIN_TOKEN", async () => {
    resetGuestGuardForTests()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/api/auth/pin")
          ? { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ hasPin: false, hasAdminToken: true }) }
          : { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) },
      ),
    )
    renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByTestId("settings-secondary-data"))
    expect(await screen.findByText("ui.adminTokenTitle")).toBeInTheDocument()
    resetGuestGuardForTests()
  })

  it("shows server resources only with admin token when cache status answers", async () => {
    setAdminToken("test-token")
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown) => {
          const u = String(url)
          if (u.includes("/api/cache/status")) {
            return {
              ok: true,
              status: 200,
              headers: { get: () => null },
              json: async () => ({
                totalEntries: 7,
                system: {
                  memory: { rssMb: 110, heapUsedMb: 54, heapTotalMb: 78 },
                  uptimeSeconds: 195,
                },
              }),
            }
          }
          return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
        }),
      )
      renderPanel()
      await screen.findByTestId("presets-panel")
      fireEvent.click(screen.getByTestId("settings-secondary-data"))
      fireEvent.click(screen.getByRole("button", { name: /ui\.cacheDiagnostics/ }))
      expect(await screen.findByText(/ui\.statusMemoryRss/)).toBeInTheDocument()
      const link = screen.getByRole("link", { name: /ui\.statusTitle/ })
      expect(link).toHaveAttribute("href", "/status")
    } finally {
      clearAdminToken()
    }
  })

  it("hides server resources without admin token even when the endpoint is open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url)
        if (u.includes("/api/cache/status")) {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => ({
              totalEntries: 7,
              system: {
                memory: { rssMb: 110, heapUsedMb: 54, heapTotalMb: 78 },
                uptimeSeconds: 195,
              },
            }),
          }
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
    renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByTestId("settings-secondary-data"))
    fireEvent.click(screen.getByRole("button", { name: /ui\.cacheDiagnostics/ }))
    await screen.findByText("ui.clearCache")
    expect(screen.queryByText(/ui\.statusMemoryRss/)).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /ui\.statusTitle/ })).not.toBeInTheDocument()
  })

  it("pin section shows with multi-user off and stays unmounted until opened", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    fireEvent.click(screen.getByTestId("settings-secondary-data"))
    expect(screen.getByText("ui.pinSecurityTitle")).toBeInTheDocument()
    expect(screen.queryByText("ui.pinSecurityDesc")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /ui\.pinSecurityTitle/ }))
    expect(screen.getByText("ui.pinSecurityDesc")).toBeInTheDocument()
  })
})
