/**
 * UI della scala voti separati: visibilità gated, interazione, reset.
 *
 * La card scala vive in TransformControls (per-titolo) e in TransformPanel
 * (default globali): visibile solo con voti separati attivi
 * (globalBadges + badgeRating + separateRatings), come il toggle sep in
 * BadgeControls. Nessuna chiave i18n nuova per la card: riusa `ui.separateRatings` +
 * `ui.scale` + `ui.reset`.
 *
 * La scala mostrata è RELATIVA (100 = resa standard raw 130, solo
 * presentazione): i raw persistiti non migrano mai (`separateBadgeScaleToUI` /
 * `uiToSeparateBadgeScale` in badge-styles.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { TransformControls } from "@/components/TransformControls"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

const SEP_ON = {
  globalBadges: true,
  badgeRating: true,
  separateRatings: true,
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})

/** Card "Rating separati" nei due pannelli (titoli diversi per costruzione):
 * - TransformControls (per-titolo): titolo `ui.separateRatings · {shape}`
 *   (match esatto sulla stringa intera — il bare key come substring
 *   funzionava ma non era preciso);
 * - TransformPanel (default globali): titolo bare `ui.separateRatings`
 *   esatto (qui il bare key con exact:false trova multipli: etichetta
 *   `ui.separateRatingsStyle` + bottoni `…Column/BottomBar/BottomPills`). */
function sepCardControls() {
  const title = screen.getByText("ui.separateRatings · ui.posterShapePortrait", { exact: true })
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function sepCardPanel() {
  const title = screen.getByText("ui.separateRatings", { exact: true })
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

describe("TransformControls separate scale", () => {
  it("nascosta di default (separati OFF)", () => {
    renderWithCtx(<TransformControls />)
    expect(screen.queryByText("ui.separateRatings · ui.posterShapePortrait", { exact: true })).not.toBeInTheDocument()
  })

  it("nascosta con badgeRating OFF anche se separati ON", () => {
    seedDefaults({ ...SEP_ON, badgeRating: false })
    renderWithCtx(<TransformControls />)
    expect(screen.queryByText("ui.separateRatings · ui.posterShapePortrait", { exact: true })).not.toBeInTheDocument()
  })

  it("default UI 100 (raw 130) senza valore salvato", () => {
    seedDefaults({ ...SEP_ON })
    renderWithCtx(<TransformControls />)
    const slider = within(sepCardControls()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
  })

  it("visibile con valore live quando i separati sono attivi (raw 130 → UI 100)", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 130 })
    renderWithCtx(<TransformControls />)
    const slider = within(sepCardControls()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
  })

  it("raw 100 storico si mostra come UI 77", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 100 })
    renderWithCtx(<TransformControls />)
    const slider = within(sepCardControls()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("77%")
  })

  it("trascinare lo slider aggiorna il valore (preview segue lo stato)", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 100 })
    renderWithCtx(<TransformControls />)
    const slider = within(sepCardControls()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("77%")
    fireEvent.change(slider, { target: { value: "150" } })
    expect(slider.getAttribute("aria-valuetext")).toBe("150%")
  })

  it("reset e doppio click tornano al default (raw 100 → UI 77)", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 150, defaultSeparateBadgeScale: 100 })
    renderWithCtx(<TransformControls />)
    const card = sepCardControls()
    const slider = within(card).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("115%")
    fireEvent.click(within(card).getByRole("button", { name: "ui.reset" }))
    expect(slider.getAttribute("aria-valuetext")).toBe("77%")
    fireEvent.change(slider, { target: { value: "140" } })
    expect(slider.getAttribute("aria-valuetext")).toBe("140%")
    fireEvent.doubleClick(slider)
    expect(slider.getAttribute("aria-valuetext")).toBe("77%")
  })
})

describe("TransformPanel separate default scale", () => {
  it("nascosta di default, visibile con valore quando i separati sono attivi", () => {
    renderWithCtx(<TransformPanel active />)
    expect(screen.queryByText("ui.separateRatings", { exact: true })).not.toBeInTheDocument()
  })

  it("default UI 100 (raw 130) senza valore salvato", () => {
    seedDefaults({
      defaultGlobalBadges: true,
      defaultBadgeRating: true,
      defaultSeparateRatings: true,
    })
    renderWithCtx(<TransformPanel active />)
    const slider = within(sepCardPanel()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
  })

  it("slider default: interazione e reset a UI 100 (raw 130 di fabbrica)", () => {
    seedDefaults({
      defaultGlobalBadges: true,
      defaultBadgeRating: true,
      defaultSeparateRatings: true,
      defaultSeparateBadgeScale: 120,
    })
    renderWithCtx(<TransformPanel active />)
    const slider = within(sepCardPanel()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("92%")
    fireEvent.change(slider, { target: { value: "150" } })
    expect(slider.getAttribute("aria-valuetext")).toBe("150%")
    fireEvent.click(within(sepCardPanel()).getByRole("button", { name: "ui.reset" }))
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
  })
})
