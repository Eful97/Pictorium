/**
 * Ancora del logo titolo (Standard): `auto` byte-identico allo storico; le
 * ancore d'angolo non dipendono dal contenuto del titolo (altezza logo,
 * badge presenti) e gli offset sono relativi all'angolo.
 */
import { describe, it, expect } from "vitest"
import {
  computeLogoLayout,
  computeLogoOffsetBounds,
  isLogoAnchor,
  isActiveLogoAnchor,
  isTopLogoAnchor,
  logoAlignPadX,
  LOGO_ANCHORS,
  resolveLogoAnchor,
} from "@/lib/logo-layout"

const base = { posterW: 500, posterH: 750, logoScale: 75, logoOffsetX: 0, logoOffsetY: 0, hasBadges: true, maxHeightPct: 25, topOffset: 10 }

describe("logo anchor: guards", () => {
  it("riconosce solo i valori ammessi", () => {
    for (const a of LOGO_ANCHORS) expect(isLogoAnchor(a)).toBe(true)
    for (const bad of ["tc", "top", "", null, undefined, 3]) expect(isLogoAnchor(bad)).toBe(false)
    expect(isActiveLogoAnchor("auto")).toBe(false)
    expect(isActiveLogoAnchor("tl")).toBe(true)
    expect(isTopLogoAnchor("tl")).toBe(true)
    expect(isTopLogoAnchor("bl")).toBe(false)
  })
})

describe("logo anchor: auto is byte-identical to history", () => {
  it.each([undefined, null, "auto" as const])("anchor=%s", (anchor) => {
    const hist = computeLogoLayout({ ...base, logoW: 400, logoH: 120 })
    expect(computeLogoLayout({ ...base, logoW: 400, logoH: 120, anchor })).toEqual(hist)
    const histLeft = computeLogoLayout({ ...base, logoW: 400, logoH: 120, align: "left" })
    expect(computeLogoLayout({ ...base, logoW: 400, logoH: 120, align: "left", anchor })).toEqual(histLeft)
    const a = { ...base, logoW: 400, logoH: 120 }
    expect(computeLogoOffsetBounds({ ...a, anchor })).toEqual(computeLogoOffsetBounds(a))
  })
})

describe("logo anchor: corners", () => {
  const pad = logoAlignPadX(500)

  it("tl/tr: stesso margine su entrambi gli assi, indipendente dall'altezza del logo", () => {
    for (const logoH of [60, 120, 400]) {
      const tl = computeLogoLayout({ ...base, logoW: 400, logoH, anchor: "tl" })
      expect(tl.left).toBe(pad)
      expect(tl.top).toBe(pad)
      const tr = computeLogoLayout({ ...base, logoW: 400, logoH, anchor: "tr" })
      expect(tr.left + tr.width).toBe(500 - pad)
      expect(tr.top).toBe(pad)
    }
  })

  it("bl/bc/br: stessa quota verticale dell'auto, cambia solo X", () => {
    const auto = computeLogoLayout({ ...base, logoW: 400, logoH: 120 })
    const bl = computeLogoLayout({ ...base, logoW: 400, logoH: 120, anchor: "bl" })
    const bc = computeLogoLayout({ ...base, logoW: 400, logoH: 120, anchor: "bc" })
    const br = computeLogoLayout({ ...base, logoW: 400, logoH: 120, anchor: "br" })
    for (const l of [bl, bc, br]) expect(l.top).toBe(auto.top)
    expect(bl.left).toBe(pad)
    expect(bc.left).toBe(auto.left)
    expect(br.left + br.width).toBe(500 - pad)
  })

  it("gli offset sono relativi all'angolo ancorato", () => {
    const o = computeLogoLayout({ ...base, logoW: 400, logoH: 120, anchor: "tl", logoOffsetX: 7, logoOffsetY: 9 })
    expect(o.left).toBe(pad + 7)
    expect(o.top).toBe(pad + 9)
  })

  it("top mai negativo", () => {
    const o = computeLogoLayout({ ...base, logoW: 400, logoH: 120, anchor: "tl", logoOffsetY: -9999 })
    expect(o.top).toBe(0)
  })

  it("landscape: stessi margini sul canvas 16:9", () => {
    const land = { posterW: 768, posterH: 432, logoW: 400, logoH: 120, logoScale: 75, logoOffsetX: 0, logoOffsetY: 0, hasBadges: true, align: "left" as const, maxWidthPct: 40, maxHeightPct: 24, bottomMarginPct: 0, topOffset: -10 }
    const p = logoAlignPadX(768)
    const tl = computeLogoLayout({ ...land, anchor: "tl" })
    expect([tl.left, tl.top]).toEqual([p, p])
  })
})

describe("logo anchor: bounds", () => {
  it("la corsa va dall'angolo ancorato ai bordi opposti (box sempre dentro)", () => {
    const a = { posterW: 500, posterH: 750, logoW: 400, logoH: 120, logoScale: 75, hasBadges: true, maxHeightPct: 25, topOffset: 10 }
    for (const anchor of ["tl", "tr", "bl", "bc", "br"] as const) {
      const b = computeLogoOffsetBounds({ ...a, anchor })
      const lo = computeLogoLayout({ ...a, anchor, logoOffsetX: b.minX, logoOffsetY: b.minY })
      const hi = computeLogoLayout({ ...a, anchor, logoOffsetX: b.maxX, logoOffsetY: b.maxY })
      expect([lo.left, lo.top]).toEqual([0, 0])
      expect([hi.left + hi.width, hi.top + hi.height]).toEqual([500, 750])
    }
  })
})

describe("logo anchor: resolution chain", () => {
  it("query valida > mapping > config > defaults > auto", () => {
    expect(resolveLogoAnchor({ query: "TL", mapping: "br", config: "bl", defaults: "tr" })).toBe("tl")
    expect(resolveLogoAnchor({ query: "auto", mapping: "br" })).toBe("auto")
    expect(resolveLogoAnchor({ mapping: "br", config: "bl", defaults: "tr" })).toBe("br")
    expect(resolveLogoAnchor({ config: "bl", defaults: "tr" })).toBe("bl")
    expect(resolveLogoAnchor({ defaults: "tr" })).toBe("tr")
    expect(resolveLogoAnchor({})).toBe("auto")
  })

  it("valori non validi cadono al livello successivo, mai errore", () => {
    expect(resolveLogoAnchor({ query: "tc", mapping: "zz", config: 5, defaults: "bc" })).toBe("bc")
    expect(resolveLogoAnchor({ query: "", mapping: null, config: undefined, defaults: "nope" })).toBe("auto")
  })
})
