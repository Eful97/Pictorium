/**
 * UI della scala voti separati: visibilità gated, interazione, reset.
 *
 * La card scala vive in TransformControls (per-titolo) e in TransformPanel
 * (default globali): visibile solo con voti separati attivi
 * (globalBadges + badgeRating + separateRatings), come il toggle sep in
 * BadgeControls. Nessuna chiave i18n nuova: riusa `ui.separateRatings` +
 * `ui.scale` + `ui.reset`.
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

/** Card "Rating separati" per titolo/aria: la prima con titolo sep. */
function sepCard() {
  const title = screen.getByText("ui.separateRatings", { exact: false })
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

describe("TransformControls separate scale", () => {
  it("nascosta di default (separati OFF)", () => {
    renderWithCtx(<TransformControls />)
    expect(screen.queryByText("ui.separateRatings", { exact: false })).not.toBeInTheDocument()
  })

  it("nascosta con badgeRating OFF anche se separati ON", () => {
    seedDefaults({ ...SEP_ON, badgeRating: false })
    renderWithCtx(<TransformControls />)
    expect(screen.queryByText("ui.separateRatings", { exact: false })).not.toBeInTheDocument()
  })

  it("visibile con valore live quando i separati sono attivi", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 130 })
    renderWithCtx(<TransformControls />)
    const slider = within(sepCard()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("130%")
  })

  it("trascinare lo slider aggiorna il valore (preview segue lo stato)", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 100 })
    renderWithCtx(<TransformControls />)
    const slider = within(sepCard()).getByRole("slider", { name: "ui.scale" })
    fireEvent.change(slider, { target: { value: "150" } })
    expect(slider.getAttribute("aria-valuetext")).toBe("150%")
  })

  it("reset e doppio click tornano al default 100", () => {
    seedDefaults({ ...SEP_ON, separateBadgeScale: 150, defaultSeparateBadgeScale: 100 })
    renderWithCtx(<TransformControls />)
    const card = sepCard()
    const slider = within(card).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("150%")
    fireEvent.click(within(card).getByRole("button", { name: "ui.reset" }))
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
    fireEvent.change(slider, { target: { value: "140" } })
    expect(slider.getAttribute("aria-valuetext")).toBe("140%")
    fireEvent.doubleClick(slider)
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
  })
})

describe("TransformPanel separate default scale", () => {
  it("nascosta di default, visibile con valore quando i separati sono attivi", () => {
    renderWithCtx(<TransformPanel active />)
    expect(screen.queryByText("ui.separateRatings", { exact: false })).not.toBeInTheDocument()
  })

  it("slider default: interazione e reset a 100", () => {
    seedDefaults({
      defaultGlobalBadges: true,
      defaultBadgeRating: true,
      defaultSeparateRatings: true,
      defaultSeparateBadgeScale: 120,
    })
    renderWithCtx(<TransformPanel active />)
    const slider = within(sepCard()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("aria-valuetext")).toBe("120%")
    fireEvent.change(slider, { target: { value: "150" } })
    expect(slider.getAttribute("aria-valuetext")).toBe("150%")
    fireEvent.click(within(sepCard()).getByRole("button", { name: "ui.reset" }))
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
  })
})
