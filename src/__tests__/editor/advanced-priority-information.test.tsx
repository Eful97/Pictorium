/**
 * Advanced badge priority placement (sash order UI).
 * - Single home: the Informazioni tab, right next to the two on/off masters
 *   (Classifiche + Badge extra). The Badge tab no longer renders it.
 * - Same state/logic: dragging a row reorders `defaultSashOrder` (the exact
 *   value preview/Stremio consume); on/off per category keeps its existing
 *   homes (the two masters + the classifica switch), so the Informazioni list
 *   shows the order position instead of duplicating toggles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

function renderBadge(mode?: "information" | "appearance") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape: "portrait", mode }), createElement(Probe)),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

function priorityCard(): HTMLElement {
  return screen.getByTestId("badge-priority-order")
}

function openPriorityList() {
  const toggle = screen.getByText("ui.advancedBadgePriority").closest("button") as HTMLElement
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle)
}

function draggableRow(label: string): HTMLElement {
  return screen.getByText(label).closest('[draggable="true"]') as HTMLElement
}

describe("advanced badge priority lives in Informazioni", () => {
  it("renders next to the two on/off masters and drag reorders the saved sash", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: ["extra", "rank", "new", "award"] }))
    const { ctx } = renderBadge("information")
    await act(async () => {})

    // Same tab as the masters (single location, no Badge-tab copy on screen).
    expect(priorityCard().hidden).toBe(false)
    expect(screen.getByTestId("badge-master-switches").hidden).toBe(false)
    expect(screen.getByRole("switch", { name: "ui.rankingsToggle" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.badgeExtraToggle" })).toBeInTheDocument()

    openPriorityList()
    // Positions are shown, not a second set of bucket toggles.
    expect(screen.queryByRole("switch", { name: "ui.sash_rank" })).toBeNull()
    expect(priorityCard().textContent).toContain("#1")

    fireEvent.dragStart(draggableRow("ui.sash_rank"))
    fireEvent.dragOver(draggableRow("ui.sash_extra"))
    fireEvent.drop(draggableRow("ui.sash_extra"))

    // Same state the preview/Stremio URL resolve: rank moved to the top slot.
    expect(ctx().defaultSashOrder).toEqual(["rank", "extra", "new", "award"])
  })

  it("is not rendered by the Badge tab", async () => {
    renderBadge("appearance")
    await act(async () => {})
    const card = priorityCard()
    expect(card.hidden).toBe(true)
    expect(card).not.toBeVisible()
    expect(screen.getByTestId("badge-master-switches").hidden).toBe(true)
  })

  it("legacy standalone keeps the in-list bucket toggles (unchanged behavior)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: ["extra", "rank", "new", "award"] }))
    const { ctx } = renderBadge()
    await act(async () => {})
    fireEvent.click(screen.getByTestId("badge-advanced-toggle"))
    expect(priorityCard().hidden).toBe(false)
    openPriorityList()
    fireEvent.click(screen.getByRole("switch", { name: "ui.sash_rank" }))
    expect(ctx().defaultSashOrder).toEqual(["extra", "new", "award"])
  })
})
