/**
 * Task17 UIORDER (+ P6 Card exposure): cover-layout card position (order only,
 * no behavior change except the intentional P6 scope widening).
 * - BadgeControls (per-title badge tab): the layout card (both selectors,
 *   scope, hint, controlled callbacks) is the FIRST card, single instance,
 *   ahead of every other card; scope shows for Fresh AND Card skins with the
 *   stored value kept (Standard hides it).
 * - BadgeDefaultsSection (settings, portrait AND landscape): preset block,
 *   then layout card, then the remaining controls; scoped setters/inheritance
 *   intact (portrait=flat, landscape=profile override, reset clears override).
 * Real-DOM order assertions (compareDocumentPosition / firstElementChild),
 * never string matching. No renderer/output behavior is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { BadgeControls } from "@/components/BadgeControls"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function probe() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  return { Probe, ctx: () => ctx as unknown as PosterEditorCtx }
}

const SELECTED = {
  id: 11,
  media_type: "movie",
  title: "Probe",
  poster_path: "/p.jpg",
} as const

/** Bitmask-safe "a precedes b in the live DOM" check. */
function precedes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

describe("per-title layout card first (BadgeControls)", () => {
  function renderEditor() {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement("div", null, createElement(BadgeControls), createElement(Probe)),
      { selected: SELECTED as never, metaInfo: { genres: [], voteAverage: 0 } as never },
    )
    return { ctx }
  }

  function layoutGroup(): HTMLElement {
    return screen.getByRole("radiogroup", { name: "ui.posterLayout" })
  }

  it("layout card is the first card and the only instance", () => {
    renderEditor()
    const cards = screen.getAllByTestId("poster-layout-card")
    expect(cards).toHaveLength(1)
    const card = cards[0]
    // Direct child of the badge-tab panel, ahead of every other card.
    expect(card.parentElement?.firstElementChild).toBe(card)
  })

  it("layout precedes ranking appearance and genre badge controls in real DOM", () => {
    renderEditor()
    const card = screen.getByTestId("poster-layout-card")
    const rankGroup = screen.getByRole("radiogroup", { name: "ui.rankFamily" })
    expect(precedes(card, rankGroup)).toBe(true)
    // First historic card header (visibility & badge position) comes after.
    expect(precedes(card, screen.getByText("ui.badgeSectionPoster"))).toBe(true)
    // Custom-badge/classifica card header comes after.
    expect(precedes(card, screen.getByText("ui.customBadge"))).toBe(true)
  })

  it("selectors stay enabled with working callbacks; scope is Fresh/Card-only and stored", () => {
    const { ctx } = renderEditor()
    const layoutRadios = within(layoutGroup()).getAllByRole("radio")
    for (const radio of layoutRadios) expect(radio).toBeEnabled()
    // Standard: scope control absent (stored preference untouched).
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    fireEvent.click(within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }))
    expect(ctx().posterLayout).toBe("fresh")
    const scopeSelect = screen.getByTestId("fresh-scope-select")
    expect(scopeSelect).toBeEnabled()
    fireEvent.change(scopeSelect, { target: { value: "all" } })
    expect(ctx().posterFreshScope).toBe("all")
    // Back to Standard: selector hides again, stored scope is kept.
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStandard" }),
    )
    expect(ctx().posterLayout).toBe("standard")
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(ctx().posterFreshScope).toBe("all")
    // Card skins share the same scope control (generic wording, same stored
    // value): visible for provider-glass, hidden again on Standard, kept.
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutProviderGlass" }),
    )
    expect(ctx().posterLayout).toBe("provider-glass")
    expect(screen.getByTestId("fresh-scope-select")).toBeEnabled()
    expect(screen.getByText("ui.posterLayoutScope")).toBeTruthy()
    expect(screen.getByText("ui.posterLayoutScopeHint")).toBeTruthy()
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStandard" }),
    )
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(ctx().posterFreshScope).toBe("all")
  })
})

describe("settings defaults order: presets, then layout, then rest", () => {
  function renderBadge(shape: "portrait" | "landscape") {
    const { Probe, ctx } = probe()
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(BadgeDefaultsSection, { active: true, shape }),
        createElement(Probe),
      ),
    )
    return { ctx }
  }

  function layoutGroup(): HTMLElement {
    return screen.getByRole("radiogroup", { name: "ui.posterLayout" })
  }

  it.each(["portrait", "landscape"] as const)(
    "preset block, then single layout card, then genre style (%s)",
    (shape) => {
      renderBadge(shape)
      const presetTitle = screen.getByText("ui.configPresetTitle")
      const cards = screen.getAllByTestId("poster-layout-card")
      expect(cards).toHaveLength(1)
      const card = cards[0]
      // Layout card lives in the style group, right after the presets.
      expect(screen.getByTestId("badge-group-style")).toContainElement(card)
      expect(precedes(presetTitle, card)).toBe(true)
      // Remaining style controls (genre style, extra style) come after.
      expect(precedes(card, screen.getByText("ui.styleGenreBadge"))).toBe(true)
      expect(precedes(card, screen.getByText("ui.extraBadgeStyle"))).toBe(true)
    },
  )

  it("portrait writes the flat default; scope selector is Fresh/Card-only", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    const freshRadio = within(layoutGroup()).getByRole("radio", {
      name: "ui.posterLayoutFresh",
    })
    expect(freshRadio).toBeEnabled()
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    fireEvent.click(freshRadio)
    expect(ctx().defaultPosterLayout).toBe("fresh")
    expect(ctx().landscape.posterLayout).toBeUndefined()
    const scopeSelect = screen.getByTestId("fresh-scope-select")
    expect(scopeSelect).toBeEnabled()
    fireEvent.change(scopeSelect, { target: { value: "all" } })
    expect(ctx().defaultPosterFreshScope).toBe("all")
    expect(ctx().landscape.posterFreshScope).toBeUndefined()
    // Card skins reuse the same scope control with generic wording.
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutStremio" }),
    )
    expect(ctx().defaultPosterLayout).toBe("stremio")
    expect(screen.getByTestId("fresh-scope-select")).toBeEnabled()
    expect(screen.getByText("ui.posterLayoutScopeHint")).toBeTruthy()
  })

  it("landscape writes only the profile override; reset restores flat inheritance", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    const presetTitle = screen.getByText("ui.configPresetTitle")
    expect(precedes(presetTitle, screen.getByTestId("poster-layout-card"))).toBe(true)
    fireEvent.click(
      within(layoutGroup()).getByRole("radio", { name: "ui.posterLayoutFresh" }),
    )
    expect(ctx().landscape.posterLayout).toBe("fresh")
    expect(ctx().defaultPosterLayout).toBe("standard")
    fireEvent.change(screen.getByTestId("fresh-scope-select"), {
      target: { value: "all" },
    })
    expect(ctx().landscape.posterFreshScope).toBe("all")
    expect(ctx().defaultPosterFreshScope).toBe("ranked")
    // The landscape-override reset clears the profile back to flat inheritance.
    const reset = screen.getByRole("button", {
      name: "ui.reset · ui.posterShapeLandscape",
    })
    fireEvent.click(reset)
    expect(ctx().landscape.posterLayout).toBeUndefined()
    expect(ctx().landscape.posterFreshScope).toBeUndefined()
    expect(ctx().defaultPosterLayout).toBe("standard")
  })
})
