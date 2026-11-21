/**
 * Ancora della fascia inferiore: guardie, catena di risoluzione e matematica
 * di posizionamento (corpo vs inchiostro visibile).
 */
import { describe, it, expect } from "vitest"
import {
  BOTTOM_ANCHORS,
  bottomAnchorPad,
  bottomAnchoredBodyLeft,
  bottomAnchoredLeft,
  isActiveBottomAnchor,
  isBottomAnchor,
  resolveBottomAnchor,
} from "@/lib/badge-anchor"

describe("bottom anchor: guardie e catena", () => {
  it("riconosce solo i valori ammessi", () => {
    for (const a of BOTTOM_ANCHORS) expect(isBottomAnchor(a)).toBe(true)
    for (const bad of ["top", "xx", "", null, undefined, 3]) expect(isBottomAnchor(bad)).toBe(false)
    expect(isActiveBottomAnchor("auto")).toBe(false)
    expect(isActiveBottomAnchor("bc")).toBe(true)
  })

  it("query valida > mapping > config > defaults > auto; il garbage cade al livello dopo", () => {
    expect(resolveBottomAnchor({ query: "BR", mapping: "bl", config: "bc", defaults: "bl" })).toBe("br")
    expect(resolveBottomAnchor({ query: "auto", mapping: "bl" })).toBe("auto")
    expect(resolveBottomAnchor({ mapping: "bl", defaults: "br" })).toBe("bl")
    expect(resolveBottomAnchor({ query: "xx", mapping: "zz", config: 4, defaults: "bc" })).toBe("bc")
    expect(resolveBottomAnchor({})).toBe("auto")
  })
})

describe("bottom anchor: matematica", () => {
  const CW = 500
  const pad = bottomAnchorPad(CW)

  it("margine = griglia 18/380 della larghezza", () => {
    expect(pad).toBe(Math.round(18 * 500 / 380))
  })

  it("bl/bc/br posizionano un elemento di larghezza data, sempre dentro il canvas", () => {
    expect(bottomAnchoredLeft("bl", 200, CW)).toBe(pad)
    expect(bottomAnchoredLeft("bc", 200, CW)).toBe(150)
    expect(bottomAnchoredLeft("br", 200, CW)).toBe(CW - 200 - pad)
    // elemento più largo del canvas: mai fuori (left >= 0)
    expect(bottomAnchoredLeft("br", 900, CW)).toBe(0)
  })

  it("con i rapporti d'inchiostro è il testo visibile ad andare sull'ancora, non la scatola", () => {
    // corpo 400 con inchiostro 280 centrato (offset 60/400): scatola larga, testo stretto
    const ratios = { offset: 60 / 400, width: 280 / 400 }
    const left = bottomAnchoredBodyLeft("bl", 400, ratios, CW)
    expect(left + 60).toBe(pad) // l'inchiostro parte sul margine
    const right = bottomAnchoredBodyLeft("br", 400, ratios, CW)
    expect(right + 60 + 280).toBe(CW - pad) // l'inchiostro finisce sul margine
  })

  it("bc centra il corpo (percorso storico) e senza rapporti ripiega sul corpo", () => {
    expect(bottomAnchoredBodyLeft("bc", 400, { offset: 0.15, width: 0.7 }, CW)).toBe(50)
    expect(bottomAnchoredBodyLeft("bl", 400, null, CW)).toBe(pad)
  })

  it("scala linearmente: stessi rapporti su un corpo ridotto (shrink anti-logo)", () => {
    const ratios = { offset: 0.15, width: 0.7 }
    const l = bottomAnchoredBodyLeft("bl", 200, ratios, CW)
    expect(l + 0.15 * 200).toBeCloseTo(pad, 0)
  })
})
