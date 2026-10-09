/**
 * Correction c2 task8a — defaults logo limits follow the EFFECTIVE selected
 * profile layout (Fresh 10..200, Standard 10..100 unchanged), both shapes.
 * Real panels (TransformPanel portrait + LandscapeDefaultsSection via the
 * controlled previewShape), real provider, typed-input bounds included.
 */
import { createElement, type ReactNode } from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

function renderWithProbe(ui: ReactNode) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(createElement("div", null, ui, createElement(Probe)))
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function logoCard(): HTMLElement {
  const el = screen.getByText("ui.logoSection", { exact: true })
  const card = el.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function logoRange(card: HTMLElement): HTMLInputElement {
  return within(card).getByRole("slider", { name: "ui.scale" }) as HTMLInputElement
}

function typeLogoValue(card: HTMLElement, text: string) {
  const btn = within(card).getByRole("button", { name: /^ui\.scale: / })
  fireEvent.click(btn)
  const edit = card.querySelector("input.editor-input") as HTMLInputElement | null
  expect(edit).not.toBeNull()
  fireEvent.change(edit!, { target: { value: text } })
  fireEvent.blur(edit!)
}

beforeEach(() => {
  localStorage.clear()
})

describe("portrait defaults logo limits follow the flat layout", () => {
  it("Standard flat: max 100, auto shows historic 75, typed 200 clamps to 100", () => {
    seedDefaults({ defaultPosterLayout: "standard", defaultPosterFreshScope: "ranked", defaultLogoScale: null })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "portrait" }))
    const card = logoCard()
    const range = logoRange(card)
    expect(range.getAttribute("max")).toBe("100")
    expect(range.getAttribute("min")).toBe("10")
    expect((range as HTMLInputElement).value).toBe("75")
    expect(ctx().defaultLogoScale).toBeNull()
    typeLogoValue(card, "200")
    expect(ctx().defaultLogoScale).toBe(100)
  })

  it("Fresh-all flat: max 200, auto shows 100, typed 200 accepted", () => {
    seedDefaults({ defaultPosterLayout: "fresh", defaultPosterFreshScope: "all", defaultLogoScale: null })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "portrait" }))
    const card = logoCard()
    const range = logoRange(card)
    expect(range.getAttribute("max")).toBe("200")
    expect((range as HTMLInputElement).value).toBe("100")
    typeLogoValue(card, "200")
    expect(ctx().defaultLogoScale).toBe(200)
  })

  it("Fresh-ranked flat (rank unknown): max 200 available, auto shows Standard fallback 75 (no false 100)", () => {
    seedDefaults({ defaultPosterLayout: "fresh", defaultPosterFreshScope: "ranked", defaultLogoScale: null })
    renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "portrait" }))
    const card = logoCard()
    const range = logoRange(card)
    expect(range.getAttribute("max")).toBe("200")
    expect((range as HTMLInputElement).value).toBe("75")
  })

  it("default profile layout switch updates the portrait max live", async () => {
    seedDefaults({ defaultPosterLayout: "standard", defaultPosterFreshScope: "ranked", defaultLogoScale: null })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "portrait" }))
    expect(logoRange(logoCard()).getAttribute("max")).toBe("100")
    await act(async () => {
      ctx().setDefaultPosterLayout("fresh")
      ctx().setDefaultPosterFreshScope("all")
    })
    expect(logoRange(logoCard()).getAttribute("max")).toBe("200")
    expect((logoRange(logoCard()) as HTMLInputElement).value).toBe("100")
    await act(async () => {
      ctx().setDefaultPosterLayout("standard")
    })
    expect(logoRange(logoCard()).getAttribute("max")).toBe("100")
    expect((logoRange(logoCard()) as HTMLInputElement).value).toBe("75")
  })
})

describe("landscape defaults logo limits inherit flat, override wins", () => {
  it("flat Standard + empty land: landscape max 100, auto 75", () => {
    seedDefaults({ defaultPosterLayout: "standard", defaultPosterFreshScope: "ranked", defaultLogoScale: null, landscape: {} })
    renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "landscape" }))
    const card = logoCard()
    const range = logoRange(card)
    expect(range.getAttribute("max")).toBe("100")
    expect((range as HTMLInputElement).value).toBe("75")
  })

  it("flat Fresh-all + empty land: landscape inherits Fresh (max 200, auto 100)", () => {
    seedDefaults({ defaultPosterLayout: "fresh", defaultPosterFreshScope: "all", defaultLogoScale: null, landscape: {} })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "landscape" }))
    const card = logoCard()
    const range = logoRange(card)
    expect(range.getAttribute("max")).toBe("200")
    expect((range as HTMLInputElement).value).toBe("100")
    typeLogoValue(card, "200")
    expect(ctx().landscape.logoScale).toBe(200)
    expect(ctx().defaultLogoScale).toBeNull()
  })

  it("flat Standard + land Fresh-all override: landscape 200/100 while portrait stays 100/75", async () => {
    seedDefaults({
      defaultPosterLayout: "standard",
      defaultPosterFreshScope: "ranked",
      defaultLogoScale: null,
      landscape: { posterLayout: "fresh", posterFreshScope: "all" },
    })
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "landscape", onPreviewShapeChange: () => {} }),
    )
    void ctx
    expect(logoRange(logoCard()).getAttribute("max")).toBe("200")
    expect((logoRange(logoCard()) as HTMLInputElement).value).toBe("100")
  })

  it("landscape Standard typed 200 clamps to 100 (Standard limits unchanged)", () => {
    seedDefaults({ defaultPosterLayout: "standard", defaultPosterFreshScope: "ranked", defaultLogoScale: null, landscape: {} })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "landscape" }))
    const card = logoCard()
    typeLogoValue(card, "200")
    expect(ctx().landscape.logoScale).toBe(100)
  })
})
