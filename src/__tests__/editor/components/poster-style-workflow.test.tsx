/**
 * Poster style simplification (preset-first UX):
 * - builtin preset cards, personal presets and quick toggles come first and
 *   stay visible with Advanced closed; the full detailed controls live below
 *   in an accessible Advanced disclosure, mounted + hidden (state kept);
 * - badge/trasforma tabs get user-facing labels with internal ids and
 *   external requestSettingsTab compatibility untouched;
 * - shape-scoped quick toggles reuse the existing setters/guards and never
 *   touch the delivery shape or reset user values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { consumeSettingsTab, requestSettingsTab } from "@/lib/settings-tab"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  vi.useFakeTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderSettings() {
  renderWithCtx(
    createElement(SettingsPanel, {
      setSettingsOpen: () => {},
      exportData: () => {},
      importData: () => {},
    }),
  )
}

function renderBadge(shape: "portrait" | "landscape") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement(
      "div",
      null,
      createElement(BadgeDefaultsSection, { active: true, shape }),
      createElement(Probe),
    ),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

function openAdvanced() {
  const t = screen.getByTestId("badge-advanced-toggle")
  if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
}

describe("preset tab (five-tab staged session)", () => {
  it("shows the six gallery looks on the default Preset tab with one preview and stages without writes", async () => {
    renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByRole("tab", { name: "ui.settingsTabPreset" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getAllByRole("tab")).toHaveLength(6)
    // Gallery looks visible without opening anything.
    for (const id of ["poster-style-apple", "poster-style-better-poster", "poster-style-rpdb"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    // Quick looks live in the same gallery card.
    for (const id of ["poster-style-essential", "poster-style-ratings", "poster-style-full"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    expect(screen.getByTestId("defaults-preview-media")).toBeInTheDocument()
    // Detailed switches stay unexposed on the preset page.
    expect(screen.queryByRole("switch", { name: "ui.topBadge" })).toBeNull()
    // Gallery click stages into the session (dirty, save enabled), no writes.
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    // Free navigation across tabs: no guard dialog, draft retained.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabRankings" }))
    expect(screen.queryByTestId("settings-dirty-dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "ui.settingsTabRankings" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByRole("switch", { name: "ui.sash_rank" })).toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
  })

  it("advanced disclosure opens accessibly and preserves detailed state", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    openAdvanced()
    const toggle = screen.getByTestId("badge-advanced-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    // Flip a detailed control while open.
    fireEvent.click(screen.getByTestId("badge-group-overlay-toggle"))
    fireEvent.click(screen.getByRole("switch", { name: "ui.topBadge" }))
    expect(ctx().defaultRankingBadges).toBe(false)
    // Close: values kept, switches unexposed but still mounted.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(ctx().defaultRankingBadges).toBe(false)
    expect(screen.queryByRole("switch", { name: "ui.topBadge" })).toBeNull()
    expect(screen.getByTestId("badge-group-overlay-toggle")).toBeInTheDocument()
    // Reopen: the flipped state survived (mounted-hidden, never unmounted).
    openAdvanced()
    expect(screen.getByRole("switch", { name: "ui.topBadge" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
  })

  it("external tab requests still land on the renamed tabs (trasforma preserved)", async () => {
    requestSettingsTab("trasforma")
    renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByRole("tab", { name: "ui.settingsTabTransform" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByRole("tabpanel", { name: "ui.transform" })).toBeInTheDocument()
  })

  it("requesting the legacy badge tab selects the new preset tab (deliberate remap)", async () => {
    requestSettingsTab("badge")
    renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(consumeSettingsTab()).toBeNull()
    expect(screen.getByRole("tab", { name: "ui.settingsTabPreset" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByTestId("presets-panel")).toBeInTheDocument()
  })
})

describe("shape-scoped quick toggles", () => {
  it("writes the edit target only; delivery shape never follows", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterShape: "poster" }))
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(screen.getByTestId("whattoshow-genre"))
    expect(ctx().landscape.badgeGenre).toBe(false)
    expect(ctx().defaultBadgeGenre).toBe(true)
    expect(ctx().defaultPosterShape).toBe("poster")
    fireEvent.click(screen.getByTestId("whattoshow-age"))
    expect(ctx().landscape.ageBadge).toBe(true)
    expect(ctx().defaultAgeBadge).toBe(false)
    expect(ctx().defaultPosterShape).toBe("poster")
    // Rank goes through the same stashed bucket path as the detailed switch.
    expect(ctx().defaultSashOrder).toContain("rank")
    fireEvent.click(screen.getByTestId("whattoshow-rank"))
    expect(ctx().landscape.sashOrder ?? []).not.toContain("rank")
    expect(ctx().defaultSashOrder).toContain("rank")
    fireEvent.click(screen.getByTestId("whattoshow-rank"))
    expect(ctx().landscape.sashOrder ?? ctx().defaultSashOrder).toContain("rank")
    expect(ctx().defaultPosterShape).toBe("poster")
  })

  it("bottom layout disables genre/year quick toggles without resetting them", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await act(async () => {
      ctx().setDefaultBadgeRating(true)
      ctx().setDefaultSeparateRatings(true)
      ctx().setDefaultSeparateRatingsStyle("bottom-bar")
    })
    const genre = screen.getByTestId("whattoshow-genre")
    const year = screen.getByTestId("whattoshow-year")
    expect(genre).toBeDisabled()
    expect(year).toBeDisabled()
    // Suppressed, never reset: back to Column restores them.
    expect(ctx().defaultBadgeGenre).toBe(true)
    expect(ctx().defaultBadgeYear).toBe(true)
  })

  it("builtin card apply reuses the isolated path; delivery shape untouched", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterShape: "landscape" }))
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(ctx().defaultBadgeStyle).toBe("minimal")
    expect(ctx().defaultBadgeGenre).toBe(true)
    expect(ctx().defaultBadgeRating).toBe(false)
    expect(ctx().defaultPosterShape).toBe("landscape")
  })

  it("masters off: quick toggles genuinely enable content (master + own)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultGlobalBadges: false,
      defaultBadgeGenre: true,
      defaultBadgeYear: false,
      defaultBadgeRating: false,
      defaultRankingBadges: false,
    }))
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // Stored genre survives under the off master, but nothing is effective.
    expect(screen.getByTestId("whattoshow-genre")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("whattoshow-rating")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("whattoshow-rank")).toHaveAttribute("aria-pressed", "false")
    // Enabling genre turns its master on and keeps the stored flag.
    fireEvent.click(screen.getByTestId("whattoshow-genre"))
    expect(ctx().defaultGlobalBadges).toBe(true)
    expect(ctx().defaultBadgeGenre).toBe(true)
    expect(screen.getByTestId("whattoshow-genre")).toHaveAttribute("aria-pressed", "true")
    // Rating was stored off: only its own flag turns on, siblings are kept.
    fireEvent.click(screen.getByTestId("whattoshow-rating"))
    expect(ctx().defaultBadgeRating).toBe(true)
    expect(ctx().defaultBadgeGenre).toBe(true)
    expect(ctx().defaultBadgeYear).toBe(false)
    // Rank: enabling turns its master on and keeps the bucket.
    fireEvent.click(screen.getByTestId("whattoshow-rank"))
    expect(ctx().defaultRankingBadges).toBe(true)
    expect(ctx().defaultSashOrder).toContain("rank")
    // Disabling clears only the own flag/bucket; masters and stash survive.
    fireEvent.click(screen.getByTestId("whattoshow-genre"))
    expect(ctx().defaultBadgeGenre).toBe(false)
    expect(ctx().defaultGlobalBadges).toBe(true)
    fireEvent.click(screen.getByTestId("whattoshow-rank"))
    expect(ctx().defaultSashOrder).not.toContain("rank")
    expect(ctx().defaultRankingBadges).toBe(true)
  })

  it("masters off: Age ON reenables the master and emits badges=1 age=1; Age OFF preserves the master", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultGlobalBadges: true,
      defaultAgeBadge: false,
      landscape: { globalBadges: false },
    }))
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // Off master: stored age off, nothing effective.
    expect(screen.getByTestId("whattoshow-age")).toHaveAttribute("aria-pressed", "false")
    const flatsBefore = JSON.stringify({ g: ctx().defaultGlobalBadges, a: ctx().defaultAgeBadge })
    // Enabling age reenables the scoped master and sets only the own flag.
    fireEvent.click(screen.getByTestId("whattoshow-age"))
    expect(ctx().landscape.globalBadges).toBe(true)
    expect(ctx().landscape.ageBadge).toBe(true)
    expect(JSON.stringify({ g: ctx().defaultGlobalBadges, a: ctx().defaultAgeBadge })).toBe(flatsBefore)
    expect(screen.getByTestId("whattoshow-age")).toHaveAttribute("aria-pressed", "true")
    const params = new URL(buildDefaultsPreviewUrl({
      defaultGlobalBadges: ctx().defaultGlobalBadges,
      defaultAgeBadge: ctx().defaultAgeBadge,
      landscape: ctx().landscape,
      previewShape: "landscape",
    }), "http://localhost").searchParams
    expect(params.get("badges")).toBe("1")
    expect(params.get("age")).toBe("1")
    // Disabling clears only the own flag; the reenabled master survives.
    fireEvent.click(screen.getByTestId("whattoshow-age"))
    expect(ctx().landscape.ageBadge).toBe(false)
    expect(ctx().landscape.globalBadges).toBe(true)
    expect(screen.getByTestId("whattoshow-age")).toHaveAttribute("aria-pressed", "false")
  })

  it("Essential then Rank: preview ranking=1, landscape untouched by the toggle", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(ctx().defaultRankingBadges).toBe(false)
    // Rank no longer stays pressed under the off master.
    expect(screen.getByTestId("whattoshow-rank")).toHaveAttribute("aria-pressed", "false")
    const landBefore = JSON.stringify(ctx().landscape)
    fireEvent.click(screen.getByTestId("whattoshow-rank"))
    expect(ctx().defaultRankingBadges).toBe(true)
    expect(ctx().defaultSashOrder).toContain("rank")
    expect(screen.getByTestId("whattoshow-rank")).toHaveAttribute("aria-pressed", "true")
    const params = new URL(buildDefaultsPreviewUrl({
      defaultRankingBadges: ctx().defaultRankingBadges,
      defaultSashOrder: ctx().defaultSashOrder,
    }), "http://localhost").searchParams
    expect(params.get("ranking")).toBe("1")
    expect(JSON.stringify(ctx().landscape)).toBe(landBefore)
  })
})
