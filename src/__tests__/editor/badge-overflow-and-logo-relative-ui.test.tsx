/**
 * UI: (1) AnchorPositionSelector con `logoRelative` mostra "Sopra il logo" /
 * "Sotto il logo" (solo con il prop); (2) toggle globale "Se non c'è spazio"
 * (Sposta / Nascondi) nel tab Badge delle impostazioni predefinite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { AnchorPositionSelector } from "@/components/AnchorPositionSelector"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { PositionPanel } from "@/components/settings/PositionPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/contexts/TranslationContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contexts/TranslationContext")>()),
  useT: () => ({ t: (k: string) => k }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

describe("AnchorPositionSelector: posizioni relative al logo", () => {
  it("senza logoRelative: nessun bottone sopra/sotto il logo", () => {
    render(createElement(AnchorPositionSelector, { value: "auto", onChange: vi.fn(), label: "ui.networkLogoPosition", testId: "g", optionTestPrefix: "n" }))
    expect(screen.queryByTestId("n-above")).toBeNull()
    expect(screen.queryByTestId("n-below")).toBeNull()
    expect(screen.getAllByRole("button")).toHaveLength(10)
  })

  it("con logoRelative: due bottoni sotto la griglia, click = above/below", () => {
    const onChange = vi.fn()
    render(createElement(AnchorPositionSelector, { value: "below", onChange, label: "ui.networkLogoPosition", testId: "g", optionTestPrefix: "n", logoRelative: true }))
    expect(screen.getByTestId("n-above")).toBeInTheDocument()
    expect(screen.getByTestId("n-below")).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("n-above")).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(screen.getByTestId("n-above"))
    expect(onChange).toHaveBeenLastCalledWith("above")
    fireEvent.click(screen.getByTestId("n-br"))
    expect(onChange).toHaveBeenLastCalledWith("br")
  })
})

describe("Impostazioni · Badge: toggle globale Se non c'è spazio (bov)", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  })

  it("Sposta/Nascondi: il click imposta defaultBadgeOverflow, default move", () => {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(createElement("div", null, createElement(PositionPanel, { active: true, previewShape: "portrait" }), createElement(Probe)))
    expect(screen.getByTestId("badge-overflow-group")).toBeInTheDocument()
    expect(screen.getByTestId("badge-overflow-move")).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getByTestId("badge-overflow-hide"))
    expect((ctx as unknown as PosterEditorCtx).defaultBadgeOverflow).toBe("hide")
    expect(screen.getByTestId("badge-overflow-hide")).toHaveAttribute("aria-checked", "true")
  })
})
