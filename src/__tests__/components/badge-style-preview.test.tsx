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
})
