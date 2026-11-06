/**
 * F3 gate: the upper-shade controls (`topShade` / `topShadeHeight`) are applied
 * by the renderer independently of the blur master (`poster-service` topShade
 * composite), so they must stay visible/editable with blur OFF in the editor
 * and in both defaults panels. Blur-only sliders stay gated, and the per-title
 * section reset must never force-enable a blur the user left OFF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { TransformControls } from "@/components/TransformControls"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { LandscapeDefaultsSection } from "@/components/LandscapeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function renderWithProbe(ui: ReactNode) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, ui, createElement(Probe)))
  return { ctx: () => ctx as PosterEditorCtx }
}

function gradientSectionOf(header: string): HTMLElement {
  const heading = screen.getByText(
    (_content, el) => el?.tagName === "SPAN" && (el.textContent ?? "").trim() === header,
  )
  return heading.parentElement!.parentElement as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("upper shade is ungated from the blur master", () => {
  it("per-title: blur OFF keeps topShade/topShadeHeight editable, blur-only sliders gated", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ blurEnabled: false }))
    const { ctx } = renderWithProbe(createElement(TransformControls))
    await act(async () => {})
    expect(ctx().blurEnabled).toBe(false)

    const ts = screen.getByLabelText("ui.topShade") as HTMLInputElement
    const tsh = screen.getByLabelText("ui.topShadeHeight") as HTMLInputElement
    expect(ts.value).toBe("50")
    expect(tsh.value).toBe("25")
    expect(screen.getByText("ui.blurDisabled")).not.toBeNull()
    // Blur-only recipe stays hidden while the master is OFF.
    expect(screen.queryByLabelText("ui.height")).toBeNull()
    expect(screen.queryByLabelText("ui.intensity")).toBeNull()
    expect(screen.queryByLabelText("ui.tintStrength")).toBeNull()

    await act(async () => {
      fireEvent.change(ts, { target: { value: "70" } })
      fireEvent.change(tsh, { target: { value: "40" } })
    })
    expect(ctx().topShade).toBe(70)
    expect(ctx().topShadeHeight).toBe(40)
  })

  it("per-title: section reset restores gradient values without enabling blur", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ blurEnabled: false, gradientHeight: 55 }),
    )
    const { ctx } = renderWithProbe(createElement(TransformControls))
    await act(async () => {})
    expect(ctx().gradientHeight).toBe(55)

    const section = gradientSectionOf("ui.blurSection · ui.posterShapePortrait")
    await act(async () => {
      fireEvent.click(within(section).getByLabelText("ui.reset"))
    })
    // A blur left OFF keeps its state (reset changes zero pixels there)…
    expect(ctx().blurEnabled).toBe(false)
    // …while the gradient recipe returns to its natural (non-clean) defaults.
    expect(ctx().gradientHeight).toBe(20)
  })

  it("portrait defaults: upper shade editable with blur OFF, blur-only sliders gated", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultBlurEnabled: false }))
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    await act(async () => {})
    expect(ctx().defaultBlurEnabled).toBe(false)

    expect(screen.getByLabelText("ui.topShade")).not.toBeNull()
    expect(screen.getByLabelText("ui.topShadeHeight")).not.toBeNull()
    expect(screen.getByText("ui.blurDisabled")).not.toBeNull()
    expect(screen.queryByLabelText("ui.height")).toBeNull()
    expect(screen.queryByLabelText("ui.intensity")).toBeNull()
  })

  it("landscape defaults: upper shade editable with the profile blur OFF", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ landscape: { blurEnabled: false } }),
    )
    renderWithProbe(
      createElement(LandscapeDefaultsSection, {
        editVal: null,
        editTxt: "",
        setEditVal: () => {},
        setEditTxt: () => {},
      }),
    )
    await act(async () => {})

    expect(screen.getByLabelText("ui.topShade")).not.toBeNull()
    expect(screen.getByLabelText("ui.topShadeHeight")).not.toBeNull()
    expect(screen.getByText("ui.blurDisabled")).not.toBeNull()
    expect(screen.queryByLabelText("ui.intensity")).toBeNull()
    expect(screen.queryByLabelText("ui.tintStrength")).toBeNull()
  })
})
