/**
 * "Dove guardare" lives in Informazioni, right under the Logo network switch:
 * switch OFF by default, country select only when ON, staged like any default.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { TagsNetworksSection } from "@/components/settings/TagsNetworksSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { REGIONS } from "@/lib/regions"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})

function renderInfo(shape: "portrait" | "landscape" = "portrait") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
  const adv = screen.getByTestId("badge-advanced-toggle")
  if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
  const grp = screen.getByTestId("badge-group-overlay-toggle")
  if (grp.getAttribute("aria-expanded") !== "true") fireEvent.click(grp)
  return () => ctx as PosterEditorCtx
}

describe("watch providers in Informazioni", () => {
  it("switch is OFF by default; the country select appears only when ON", () => {
    const ctx = renderInfo()
    const sw = screen.getByRole("switch", { name: "Mostra dove guardare" })
    expect(sw.getAttribute("aria-checked")).toBe("false")
    expect(screen.queryByLabelText("Paese streaming")).toBeNull()
    fireEvent.click(sw)
    expect(ctx().defaultWatchProviders).toBe(true)
    const select = screen.getByLabelText("Paese streaming") as HTMLSelectElement
    expect(select.querySelectorAll("option").length).toBe(REGIONS.length + 1)
  })

  it("choosing a country stages it; the empty option clears it", () => {
    const ctx = renderInfo()
    fireEvent.click(screen.getByRole("switch", { name: "Mostra dove guardare" }))
    const select = screen.getByLabelText("Paese streaming") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "US" } })
    expect(ctx().defaultWatchRegion).toBe("US")
    fireEvent.change(select, { target: { value: "" } })
    expect(ctx().defaultWatchRegion).toBeNull()
  })

  it("landscape max + country write the landscape profile, flats untouched", () => {
    const ctx = renderInfo("landscape")
    fireEvent.click(screen.getByRole("switch", { name: "Mostra dove guardare" }))
    const max = screen.getByLabelText(/Piattaforme max/) as HTMLSelectElement
    fireEvent.change(max, { target: { value: "5" } })
    const select = screen.getByLabelText("Paese streaming") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "FR" } })
    expect(ctx().landscape.watchProvidersMax).toBe(5)
    expect(ctx().landscape.watchRegion).toBe("FR")
    expect(ctx().defaultWatchProvidersMax).toBe(3)
    expect(ctx().defaultWatchRegion).toBeNull()
    fireEvent.change(select, { target: { value: "" } })
    expect(ctx().landscape.watchRegion).toBe("")
  })

  it("is no longer in the Tag e Network tab", () => {
    renderWithCtx(createElement(TagsNetworksSection, { active: true }))
    expect(screen.queryByRole("switch", { name: "Mostra dove guardare" })).toBeNull()
  })
})
