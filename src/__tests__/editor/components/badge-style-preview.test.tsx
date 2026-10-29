/**
 * T3 — contratto markup delle anteprime icone stile badge.
 *
 * Le icone traslucide (vetro/bordo) hanno testo bianco fisso su riempimento
 * traslucido chiaro: sono leggibili solo sulla pill scura
 * `.badge-style-preview` (globals.css, light + dark coerenti). Questi test
 * pinnano il markup da cui dipende quel contratto, per entrambe le superfici
 * che usano il selettore condiviso (editor BadgeControls, default
 * BadgeStyleSection): wrapper presente, testo adattivo invariato, bottoni
 * con nome accessibile, nessun interattivo annidato.
 * I colori computati reali sono coperti da e2e/badge-icon-vetro.spec.ts.
 */
import { describe, expect, it, vi } from "vitest"
import { screen, within } from "@testing-library/react"
import { BadgeStyleSelector } from "@/components/ui/BadgeStyleSelector"
import { COLOR_MARK_GLYPH, COLOR_MARK_PLATE_BG, COLOR_MARK_PLATE_STROKE, PREMIUM_PLATE_BG, premiumAccentHex } from "@/lib/quality-badge-styles"
import { textColorForBg } from "@/lib/accent-color"
import { renderWithCtx } from "@/__tests__/test-utils"

const t = (k: string) => k

function renderGenre(value: string) {
  return renderWithCtx(
    <BadgeStyleSelector
      value={value}
      options={["shadow", "pill", "bar", "colored", "bordo", "vetro", "minimal"]}
      onChange={vi.fn()}
      t={t}
    />,
  )
}

function iconOf(buttonName: RegExp) {
  const btn = screen.getByRole("button", { name: buttonName })
  const wrap = btn.querySelector(".badge-style-preview")
  expect(wrap).not.toBeNull()
  const icon = wrap!.querySelector("span")
  expect(icon).not.toBeNull()
  return { btn, wrap: wrap as HTMLElement, icon: icon as HTMLElement }
}

describe("BadgeStyleSelector preview contract", () => {
  it("ogni opzione ha nome accessibile e nessun interattivo annidato", () => {
    renderGenre("shadow")
    for (const name of [/shadow/i, /pill/i, /bar/i, /colored/i, /bordo/i, /vetro/i, /minimal/i]) {
      const btn = screen.getByRole("button", { name })
      expect(btn.querySelector("button, a, input, select")).toBeNull()
    }
  })

  it("vetro: testo bianco fisso su vetro traslucido dentro la pill scura", () => {
    renderGenre("vetro")
    const { icon, wrap } = iconOf(/vetro/i)
    expect(icon.classList.contains("text-white")).toBe(true)
    expect(icon.style.background).toContain("rgba(255, 255, 255, 0.08)")
    expect(wrap.classList.contains("badge-style-preview")).toBe(true)
  })

  it("bordo/minimal: stesso wrapper, testo invariato", () => {
    renderGenre("bordo")
    expect(iconOf(/bordo/i).icon.classList.contains("text-white")).toBe(true)
  })

  it("griglia ranking (default/pill/colored/bordo/vetro): stesso contratto", () => {
    renderWithCtx(
      <BadgeStyleSelector
        value="default"
        options={["default", "pill", "colored", "bordo", "vetro"]}
        onChange={vi.fn()}
        t={t}
        accentColor="#fb923c"
      />,
    )
    const { icon } = iconOf(/vetro/i)
    expect(icon.classList.contains("text-white")).toBe(true)
    expect(within(screen.getByRole("button", { name: /colored/i })).getByText("Aa")).toBeInTheDocument()
  })

  it("griglia ranking con corner: anteprima piatta con testo a contrasto condiviso", () => {
    renderWithCtx(
      <BadgeStyleSelector
        value="corner"
        options={["default", "pill", "colored", "bordo", "vetro", "corner"]}
        onChange={vi.fn()}
        t={t}
        accentColor="#fb923c"
      />,
    )
    const { icon } = iconOf(/ui\.corner/i)
    // Normalizza i colori come jsdom prima del confronto.
    const probe = document.createElement("span")
    probe.style.background = "#fb923c"
    probe.style.color = textColorForBg("#fb923c")
    expect(icon.style.background).toBe(probe.style.background)
    expect(icon.style.color).toBe(probe.style.color)
    expect(icon.style.color).not.toBe("")
    expect(icon.classList.contains("text-black")).toBe(false)
    expect(icon.classList.contains("text-white")).toBe(false)
  })

  it("quality premium option: dark plate swatch with a premium-accent glyph", () => {
    renderWithCtx(
      <BadgeStyleSelector
        value="premium"
        options={["standard", "mono", "color", "knockout", "premium"]}
        onChange={vi.fn()}
        t={t}
      />,
    )
    const btn = screen.getByRole("button", { name: /ui\.qbsPremium/i })
    const icon = btn.querySelector(".badge-style-preview span") as HTMLElement | null
    expect(icon).not.toBeNull()
    // Placca scura neutra + inchiostro d'accento dalla palette condivisa
    // (stessa fonte del renderer: nessun colore duplicato in UI).
    const plate = document.createElement("span")
    plate.style.background = PREMIUM_PLATE_BG
    const ink = document.createElement("span")
    ink.style.color = premiumAccentHex("gold")
    expect(icon!.style.background).toBe(plate.style.background)
    expect(icon!.style.color).toBe(ink.style.color)
    expect(icon!.textContent).toBe("HDR")
    expect(btn.querySelector("button, a, input, select")).toBeNull()
  })

  it("age family: swatches come from the shared age builders, never the 4K asset", () => {
    renderWithCtx(
      <BadgeStyleSelector
        value="standard"
        options={["standard", "mono", "color", "knockout", "premium"]}
        onChange={vi.fn()}
        t={t}
        family="age"
      />,
    )
    const svgOf = (name: RegExp) => {
      const btn = screen.getByRole("button", { name })
      const img = btn.querySelector(".badge-style-preview img")
      expect(img, String(name)).not.toBeNull()
      const src = img!.getAttribute("src") ?? ""
      expect(src).toMatch(/^data:image\/svg\+xml,/)
      expect(btn.textContent).not.toContain("4K")
      return decodeURIComponent(src)
    }
    // mono: bare high-contrast frame + glyph (no plate, no satin fill).
    const mono = svgOf(/ui\.qbsMono/i)
    expect(mono).toContain('fill="none"')
    // color: existing tier palette (dark plate + yellow border + yellow ink).
    const color = svgOf(/ui\.qbsColor/i)
    expect(color).toContain(COLOR_MARK_PLATE_BG)
    expect(color).toContain(COLOR_MARK_PLATE_STROKE)
    expect(color).toContain(COLOR_MARK_GLYPH)
    // premium: compact dark premium plate + design gold accent.
    const premium = svgOf(/ui\.qbsPremium/i)
    expect(premium).toContain(PREMIUM_PLATE_BG)
    expect(premium).toContain(premiumAccentHex("gold"))
    // knockout: genuine cut-out tag (mask) with neutral age letters.
    const knockout = svgOf(/ui\.qbsKnockout/i)
    expect(knockout).toContain("<mask")
    expect(knockout).toContain("Aa")
    expect(knockout).not.toContain("4K")
  })

  it("quality family mono swatch uses the shared framed recipe (same as age mono, real 4K label)", () => {
    renderWithCtx(
      <BadgeStyleSelector
        value="mono"
        options={["standard", "mono", "color", "knockout", "premium"]}
        onChange={vi.fn()}
        t={t}
      />,
    )
    const btn = screen.getByRole("button", { name: /ui\.qbsMono/i })
    const img = btn.querySelector(".badge-style-preview img")
    expect(img).not.toBeNull()
    const src = img!.getAttribute("src") ?? ""
    // Shared builder output (one source with the renderer): the quality mono
    // tier is the same frame as the age mono, labelled with the real tier.
    expect(src).toMatch(/^data:image\/svg\+xml,/)
    const svg = decodeURIComponent(src)
    expect(svg).toContain('fill="none"')
    expect(svg).toContain("4K")
    // The retired static asset is no longer used by the selector.
    expect(src).not.toContain("/quality-badges/mono/4k-label-icon.svg")
  })

  it("standard swatch is the shared neutral satin pill (both families, no generic glyph)", () => {
    for (const family of ["quality", "age"] as const) {
      const { unmount } = renderWithCtx(
        <BadgeStyleSelector
          value="standard"
          options={["standard", "mono", "color", "knockout", "premium"]}
          onChange={vi.fn()}
          t={t}
          family={family}
        />,
      )
      const btn = screen.getByRole("button", { name: /ui\.qbsStandard/i })
      const img = btn.querySelector(".badge-style-preview img") as HTMLImageElement | null
      expect(img, family).not.toBeNull()
      const svg = decodeURIComponent(img!.getAttribute("src") ?? "")
      // The SAME builder the renderer uses (neutral satin pill, full rx).
      expect(svg, family).toMatch(/^data:image\/svg\+xml,<svg/)
      expect(svg, family).toContain('fill="url(#qg)"')
      expect(svg, family).toMatch(/rx="\d+"/)
      expect(btn.textContent, family).not.toBe("~")
      unmount()
    }
  })

  it("quality knockout option: inline cutout swatch with masked 4K glyphs", () => {
    renderWithCtx(
      <BadgeStyleSelector
        value="knockout"
        options={["standard", "mono", "color", "knockout"]}
        onChange={vi.fn()}
        t={t}
      />,
    )
    const btn = screen.getByRole("button", { name: /ui\.qbsKnockout/i })
    const svg = btn.querySelector("svg")
    expect(svg).not.toBeNull()
    // White tag rect driven by a luminance mask…
    const tag = svg!.querySelector('rect[mask]')
    expect(tag).not.toBeNull()
    expect(tag!.getAttribute("fill")).toBe("#ffffff")
    // …knocking out black 4K glyphs (true cutout, no simulated gray text).
    const mask = svg!.querySelector("mask")
    expect(mask).not.toBeNull()
    const glyph = mask!.querySelector("text")
    expect(glyph?.textContent).toBe("4K")
    expect(glyph?.getAttribute("fill")).toBe("#000000")
    // Oversized cutout glyphs like the poster tag (12px in the 28×16 swatch).
    expect(glyph?.getAttribute("font-size")).toBe("12")
    expect(tag!.getAttribute("mask")).toBe(`url(#${mask!.id})`)
    expect(btn.textContent).not.toContain("Aa")
  })
})
