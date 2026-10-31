/**
 * Ranking badge selectors — mini previews.
 *
 * Every rank variant option now carries a thumbnail, drawn by the SAME shared
 * builder the poster dispatches through (`buildHouseRankingSvg`, used by
 * `buildRankingBadgeSVG`): the assertions compare the rendered data URI with
 * the builder output for the canonical (style, ribbon) pair, so a hand-rolled
 * or diverging thumbnail fails here. Labels/accessibility of the radio group
 * stay intact (the thumbnail is decorative: `alt=""`).
 */
import { describe, expect, it, vi } from "vitest"
import { renderWithCtx } from "@/__tests__/test-utils"
import { screen, within } from "@testing-library/react"
import { RankingAppearanceSelector } from "@/components/RankingAppearanceSelector"
import { buildHouseRankingSvg } from "@/lib/badge-svg-shared"
import { t } from "@/lib/i18n"

const ACCENT = "#fb923c"
const PW = 380

/** Same data-URI encoding the selector uses. */
function expectedSrc(style: string, ribbon: boolean): string {
  const { svg } = buildHouseRankingSvg({
    rank: 1,
    label: t("badge.today"),
    pw: PW,
    style: style as never,
    ribbon,
    accentColor: ACCENT,
  })
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function renderAppearance(args: { appearance: "nastro" | "numero" | "badge"; variant: string; ribbonVariant: "standard" | "colored" }) {
  return renderWithCtx(
    <RankingAppearanceSelector
      appearance={args.appearance}
      variant={args.variant as never}
      ribbonVariant={args.ribbonVariant}
      onAppearance={vi.fn()}
      onVariant={vi.fn()}
      onRibbonVariant={vi.fn()}
    />,
  )
}

function radios(group: HTMLElement) {
  return within(group).getAllByRole("radio")
}

describe("ranking variant mini previews (shared builder only)", () => {
  it("badge variants: one thumbnail per option, byte-identical to the shared builder", () => {
    renderAppearance({ appearance: "badge", variant: "pill", ribbonVariant: "standard" })
    const group = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    const expected: Record<string, { style: string; ribbon: boolean }> = {
      "ui.pill": { style: "pill", ribbon: true },
      "ui.colored": { style: "colored", ribbon: false },
      "ui.bordo": { style: "bordo", ribbon: true },
      "ui.vetro": { style: "vetro", ribbon: true },
      "ui.corner": { style: "corner", ribbon: true },
      "ui.qbsStandard": { style: "default", ribbon: false },
      "ui.split": { style: "split", ribbon: true },
    }
    expect(radios(group)).toHaveLength(Object.keys(expected).length)
    for (const [name, recipe] of Object.entries(expected)) {
      const btn = within(group).getByRole("radio", { name })
      const img = btn.querySelector("img")
      expect(img, name).not.toBeNull()
      expect(img!.getAttribute("alt"), name).toBe("")
      expect(img!.getAttribute("src"), name).toBe(expectedSrc(recipe.style, recipe.ribbon))
      // Decorative only: the accessible name stays the label key.
      expect(btn.textContent, name).toBe(t(name))
    }
  })

  it("ribbon variants: satin ribbon and accent ribbon from the same builders", () => {
    renderAppearance({ appearance: "nastro", variant: "pill", ribbonVariant: "colored" })
    const group = screen.getByRole("radiogroup", { name: "ui.ribbon" })
    expect(radios(group)).toHaveLength(2)
    const standard = within(group).getByRole("radio", { name: "ui.qbsStandard" })
    const colored = within(group).getByRole("radio", { name: "ui.colored" })
    expect(standard.querySelector("img")!.getAttribute("src")).toBe(expectedSrc("netflix", true))
    expect(colored.querySelector("img")!.getAttribute("src")).toBe(expectedSrc("colored", true))
    // The two ribbon variants are distinct bitmaps (never one shared preview).
    expect(standard.querySelector("img")!.getAttribute("src")).not.toBe(colored.querySelector("img")!.getAttribute("src"))
    expect(colored).toHaveAttribute("aria-checked", "true")
  })

  it("thumbnails are decorative: no nested interactive elements", () => {
    renderAppearance({ appearance: "badge", variant: "split", ribbonVariant: "standard" })
    const group = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    for (const radio of radios(group)) {
      expect(radio.querySelector("button, a, input, select")).toBeNull()
      expect(radio.querySelectorAll("img")).toHaveLength(1)
    }
  })
})
