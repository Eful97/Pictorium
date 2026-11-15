/**
 * Ranking badge selectors — mini previews.
 *
 * Every rank variant option now carries a thumbnail, drawn by the SAME shared
 * builder the poster dispatches through (`buildHouseRankingSvg`, used by
 * `buildRankingBadgeSVG`): the assertions compare the rendered data URI with
 * the builder output for the canonical (style, ribbon) pair, so a hand-rolled
 * or diverging thumbnail fails here. Labels/accessibility of the radio group
 * stay intact (the thumbnail is decorative: `alt=""`).
 *
 * Badge variants are two-level: the top row shows one radio per family (or
 * single), the active family's members appear in a variants row below.
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
  it("badge families: one tile per family on top, byte-identical thumbnails to the shared builder", () => {
    renderAppearance({ appearance: "badge", variant: "pill", ribbonVariant: "standard" })
    const group = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    // Top row: families (representative member preview) and the singles.
    const top: Record<string, { style: string; ribbon: boolean }> = {
      "ui.styleGroupPill": { style: "pill", ribbon: true },
      "ui.styleGroupPlate": { style: "default", ribbon: false },
      "ui.styleGroupFrame": { style: "bordo", ribbon: true },
      "ui.corner": { style: "corner", ribbon: true },
      "ui.editoriale": { style: "editoriale", ribbon: true },
      "ui.notch": { style: "notch-crema", ribbon: true },
    }
    expect(radios(group)).toHaveLength(Object.keys(top).length)
    for (const [name, recipe] of Object.entries(top)) {
      const btn = within(group).getByRole("radio", { name: t(name) })
      const img = btn.querySelector("img")
      expect(img, name).not.toBeNull()
      expect(img!.getAttribute("alt"), name).toBe("")
      expect(img!.getAttribute("src"), name).toBe(expectedSrc(recipe.style, recipe.ribbon))
      // Decorative only: the accessible name stays the label.
      expect(btn.textContent, name).toBe(t(name))
    }
    expect(within(group).getByRole("radio", { name: t("ui.styleGroupPill") })).toHaveAttribute("aria-checked", "true")

    // Variants row for the active family (pill): the family members, each byte-identical.
    const variants = screen.getByRole("radiogroup", { name: "ui.styleVariants" })
    const members: Record<string, { style: string; ribbon: boolean }> = {
      "ui.pill": { style: "pill", ribbon: true },
      "ui.tinta": { style: "tinta", ribbon: true },
      "ui.split": { style: "split", ribbon: true },
    }
    expect(radios(variants)).toHaveLength(Object.keys(members).length)
    for (const [name, recipe] of Object.entries(members)) {
      const btn = within(variants).getByRole("radio", { name })
      expect(btn.querySelector("img")!.getAttribute("src"), name).toBe(expectedSrc(recipe.style, recipe.ribbon))
    }
    expect(within(variants).getByRole("radio", { name: "ui.pill" })).toHaveAttribute("aria-checked", "true")
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
