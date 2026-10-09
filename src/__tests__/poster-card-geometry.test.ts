import { describe, expect, it } from "vitest"
import {
  CARD_COVER_LAYOUTS,
  CARD_NUMERAL_CONDENSE_X,
  CARD_NUMERAL_ENLARGE,
  CARD_RANK_MAX,
  CARD_RANK_MIN,
  CARD_REFERENCE,
  cardLayoutGeometry,
  isCardRankDisplayable,
  type CardCompositionGeometry,
} from "@/lib/card-layout-geometry"
import { isFreshRank } from "@/lib/fresh-layout"
import { CHAR_WIDTH_FACTOR, LAND_H, LAND_W } from "@/lib/constants"
import { STD_H, STD_W } from "@/lib/image-utils"

const SHAPES = ["poster", "landscape"] as const

function finitePositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
}

function expectCardInsideCanvas(g: CardCompositionGeometry): void {
  const { card, canvas } = g
  for (const v of [card.x, card.y, card.width, card.height, card.radius]) {
    expect(finitePositive(v)).toBe(true)
  }
  expect(card.x + card.width).toBeLessThanOrEqual(canvas.width)
  expect(card.y + card.height).toBeLessThanOrEqual(canvas.height)
  expect(card.radius).toBeLessThanOrEqual(Math.min(card.width, card.height) / 2)
}

describe("poster card geometry (shared cover composition)", () => {
  it("covers exactly the three cover layouts with one skin-free composition", () => {
    expect([...CARD_COVER_LAYOUTS]).toEqual(["provider-glass", "nuvio", "stremio"])
    for (const shape of SHAPES) {
      const a = cardLayoutGeometry(shape, shape === "poster" ? STD_W : LAND_W, shape === "poster" ? STD_H : LAND_H, 7)
      const b = cardLayoutGeometry(shape, shape === "poster" ? STD_W : LAND_W, shape === "poster" ? STD_H : LAND_H, 7)
      expect(a).toEqual(b)
    }
  })

  it("accepts integer ranks 1..20 only and rejects 21+ with no invented numeral", () => {
    expect(CARD_RANK_MIN).toBe(1)
    expect(CARD_RANK_MAX).toBe(20)
    for (let rank = 1; rank <= 20; rank++) {
      expect(isCardRankDisplayable(rank)).toBe(true)
    }
    for (const rank of [21, 42, 99, 100, 101, 0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined]) {
      expect(isCardRankDisplayable(rank)).toBe(false)
    }
    // Card stops at 20 while Fresh intentionally keeps 100: no parity claim.
    expect(isFreshRank(100)).toBe(true)
    expect(isCardRankDisplayable(100)).toBe(false)
    for (let rank = 1; rank <= 20; rank++) {
      expect(isFreshRank(rank)).toBe(true)
    }
  })

  it("keeps the reference card inside the reference canvas with faithful composition", () => {
    for (const shape of SHAPES) {
      const ref = CARD_REFERENCE[shape]
      const g = cardLayoutGeometry(shape, ref.canvas.width, ref.canvas.height, 7)
      expect(g).not.toBeNull()
      expectCardInsideCanvas(g!)
      expect(g!.card).toEqual({
        x: ref.card.x,
        y: ref.card.y,
        width: ref.card.width,
        height: ref.card.height,
        radius: ref.card.radius,
      })
      expect(g!.meta.centerX).toBe(ref.card.x + ref.card.width / 2)
      expect(g!.provider.centerX).toBe(ref.card.x / 2)
      expect(g!.meta.baselineY).toBe(ref.metaBaselineY)
      expect(g!.provider.centerY).toBe(ref.provider.centerY)
      expect(g!.titleLogo.maxWidth).toBe(ref.logo.maxWidth)
      expect(g!.titleLogo.maxHeight).toBe(ref.logo.maxHeight)
      expect(g!.titleLogo.insetLeft).toBe(ref.logo.left)
      expect(g!.titleLogo.insetBottom).toBe(ref.logo.bottom)
    }
  })

  it("keeps the card inside actual and reduced canvases with shape-specific ratios", () => {
    const cases = [
      { shape: "poster" as const, w: STD_W, h: STD_H },
      { shape: "landscape" as const, w: LAND_W, h: LAND_H },
      { shape: "poster" as const, w: STD_W / 2, h: STD_H / 2 },
      { shape: "landscape" as const, w: LAND_W / 2, h: LAND_H / 2 },
    ]
    for (const c of cases) {
      const g = cardLayoutGeometry(c.shape, c.w, c.h, 9)
      expect(g).not.toBeNull()
      expectCardInsideCanvas(g!)
    }
    const portrait = cardLayoutGeometry("poster", STD_W, STD_H, 4)!
    const landscape = cardLayoutGeometry("landscape", LAND_W, LAND_H, 4)!
    expect(portrait.card.width / portrait.card.height).toBeCloseTo(730 / 1095, 1)
    expect(landscape.card.width / landscape.card.height).toBeCloseTo(900 / 506, 1)
  })

  it("rejects non-finite/non-positive and collapsed subpixel canvases", () => {
    for (const [w, h] of [
      [0, STD_H],
      [STD_W, 0],
      [-STD_W, STD_H],
      [Number.NaN, STD_H],
      [STD_W, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(cardLayoutGeometry("poster", w, h, 1)).toBeNull()
      expect(cardLayoutGeometry("landscape", w, h, 1)).toBeNull()
    }
    for (const c of [
      { shape: "poster" as const, w: 0.5, h: 0.5 },
      { shape: "poster" as const, w: 2, h: 3 },
      { shape: "landscape" as const, w: 0.5, h: 0.5 },
      { shape: "landscape" as const, w: 2, h: 3 },
    ]) {
      for (const rank of [1, 10, 20, undefined] as const) {
        expect(cardLayoutGeometry(c.shape, c.w, c.h, rank)).toBeNull()
      }
    }
  })

  it("fits every valid rank 1..20 without canvas clipping (estimate-level)", () => {
    const canvases = [
      { shape: "poster" as const, w: CARD_REFERENCE.poster.canvas.width, h: CARD_REFERENCE.poster.canvas.height },
      { shape: "landscape" as const, w: CARD_REFERENCE.landscape.canvas.width, h: CARD_REFERENCE.landscape.canvas.height },
      { shape: "poster" as const, w: STD_W, h: STD_H },
      { shape: "landscape" as const, w: LAND_W, h: LAND_H },
      { shape: "poster" as const, w: STD_W / 2, h: STD_H / 2 },
      { shape: "landscape" as const, w: LAND_W / 2, h: LAND_H / 2 },
    ]
    for (const c of canvases) {
      for (let rank = 1; rank <= 20; rank++) {
        const n = cardLayoutGeometry(c.shape, c.w, c.h, rank)!.numeral
        expect(n).not.toBeNull()
        expect(finitePositive(n!.fontSize)).toBe(true)
        expect(finitePositive(n!.estimatedWidth)).toBe(true)
        expect(n!.digitCount).toBe(rank < 10 ? 1 : 2)
        // Heuristic guard only — the final renderer must measure real ink.
        expect(n!.fitsWithinCanvas).toBe(true)
      }
    }
  })

  it("keeps singles anchor; doubles keep enlarged height and condense width (P9 size, P16 enlarge except rank 1)", () => {
    // Rank 1 keeps the EXACT pre-P16 reference geometry (user correction
    // cycle 1: "1 was fine as before" — verbatim size AND stroke, original
    // anchor, baseline formula with its own size). Singles 2..9 render the
    // reference size TIMES the user enlargement (CARD_NUMERAL_ENLARGE, ~18%
    // — the midpoint of the requested 15-20% band). Doubles (10..20)
    // preserve the enlarged double SIZE/anchor/baseline and condense ONLY
    // horizontally: no uniform shrink (the old gutter-fit shrank portrait
    // doubles to ~91px at STD, the reported "tiny 11").
    // Widths below are CHAR_WIDTH_FACTOR heuristics, never pixel proof —
    // the renderer measures real ink.
    const canvases = [
      { shape: "poster" as const, w: CARD_REFERENCE.poster.canvas.width, h: CARD_REFERENCE.poster.canvas.height },
      { shape: "landscape" as const, w: CARD_REFERENCE.landscape.canvas.width, h: CARD_REFERENCE.landscape.canvas.height },
      { shape: "poster" as const, w: STD_W, h: STD_H },
      { shape: "landscape" as const, w: LAND_W, h: LAND_H },
    ]
    for (const c of canvases) {
      const ref = CARD_REFERENCE[c.shape]
      const s = Math.min(c.w / ref.canvas.width, c.h / ref.canvas.height)
      // Rank 1: verbatim reference, NO enlargement, original anchor.
      const one = cardLayoutGeometry(c.shape, c.w, c.h, 1)!.numeral!
      expect(one.referenceFaithful).toBe(true)
      expect(one.digitCount).toBe(1)
      expect(one.condenseX).toBe(1)
      expect(one.fontSize).toBe(Math.round(ref.number.sizeSingle * s))
      expect(one.anchorX).toBe(Math.round(ref.number.xSingle * (c.w / ref.canvas.width)))
      expect(one.strokeWidth).toBe(Math.max(1, Math.round(ref.number.strokeWidth * s)))
      // Explicit pre-P16 spot check at STD poster (500x750): 405 * 0.5 =
      // 202.5 -> rounded 203, stroke 10 * 0.5 = 5, anchor 14 * 0.5 = 7.
      if (c.shape === "poster" && c.w === STD_W && c.h === STD_H) {
        expect(one.fontSize).toBe(203)
        expect(one.strokeWidth).toBe(5)
        expect(one.anchorX).toBe(7)
      }
      for (const rank of [7, 9]) {
        const n = cardLayoutGeometry(c.shape, c.w, c.h, rank)!.numeral!
        expect(n.referenceFaithful).toBe(true)
        expect(n.digitCount).toBe(1)
        expect(n.condenseX).toBe(1)
        expect(n.fontSize).toBe(Math.round(ref.number.sizeSingle * s * CARD_NUMERAL_ENLARGE))
        expect(n.anchorX).toBe(Math.round(ref.number.xSingle * (c.w / ref.canvas.width)))
      }
      for (const rank of [10, 11, 19, 20]) {
        const g = cardLayoutGeometry(c.shape, c.w, c.h, rank)!
        const n = g.numeral!
        expect(n.referenceFaithful).toBe(false)
        expect(n.digitCount).toBe(2)
        // Full enlarged double height: equality, not a shrink ceiling.
        expect(n.fontSize).toBe(Math.round(ref.number.sizeDouble * s * CARD_NUMERAL_ENLARGE))
        expect(n.condenseX).toBe(CARD_NUMERAL_CONDENSE_X)
        expect(n.anchorX).toBe(Math.round(ref.number.xDouble * (c.w / ref.canvas.width)))
        expect(n.visibleAvailableWidth).toBe(g.card.x - n.anchorX)
        // First digit's condensed advance box stays fully before the card
        // edge (estimate-level; the renderer proves it on real ink).
        const firstAdvance = n.anchorX + n.condenseX * CHAR_WIDTH_FACTOR * n.fontSize
        expect(firstAdvance).toBeLessThan(g.card.x)
        // Bounded card overlap by design (like the reference singles): the
        // condensed estimate may cross the card edge, but never by more than
        // ~35% of its own width — the second digit keeps a visible majority.
        expect(n.estimatedOverflowIntoCard).toBeGreaterThanOrEqual(0)
        expect(n.estimatedOverflowIntoCard).toBeLessThanOrEqual(n.estimatedWidth * 0.35)
      }
      const nine = cardLayoutGeometry(c.shape, c.w, c.h, 9)!.numeral!
      const ten = cardLayoutGeometry(c.shape, c.w, c.h, 10)!.numeral!
      // Doubles keep their own enlarged reference height; the single/double
      // sizes follow the reference ratio (no gutter-fit inversion).
      expect(ten.fontSize).toBe(Math.round(ref.number.sizeDouble * s * CARD_NUMERAL_ENLARGE))
      expect(nine.fontSize).toBe(Math.round(ref.number.sizeSingle * s * CARD_NUMERAL_ENLARGE))
    }
    // The enlargement honors the user 15-20% band on every canvas.
    expect(CARD_NUMERAL_ENLARGE).toBeGreaterThanOrEqual(1.15)
    expect(CARD_NUMERAL_ENLARGE).toBeLessThanOrEqual(1.2)
  })

  it("creates no phantom numeral for absent/invalid ranks and never shifts slots", () => {
    const invalid: unknown[] = [undefined, null, 0, -5, 21, 42, 99, 100, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3"]
    for (const shape of SHAPES) {
      const w = shape === "poster" ? STD_W : LAND_W
      const h = shape === "poster" ? STD_H : LAND_H
      const ranked = cardLayoutGeometry(shape, w, h, 5)!
      expect(ranked.numeral).not.toBeNull()
      for (const rank of invalid) {
        const g = cardLayoutGeometry(shape, w, h, rank as number)!
        expect(g.numeral).toBeNull()
        expect(g.card).toEqual(ranked.card)
        expect(g.meta).toEqual(ranked.meta)
        expect(g.provider).toEqual(ranked.provider)
        expect(g.titleLogo).toEqual(ranked.titleLogo)
        expect(g.rankSlotWidth).toBe(ranked.rankSlotWidth)
      }
    }
  })

  it("keeps provider/title-logo/meta slots bounded and separate", () => {
    const cases = [
      { shape: "poster" as const, w: STD_W, h: STD_H },
      { shape: "landscape" as const, w: LAND_W, h: LAND_H },
      { shape: "poster" as const, w: CARD_REFERENCE.poster.canvas.width, h: CARD_REFERENCE.poster.canvas.height },
      { shape: "landscape" as const, w: CARD_REFERENCE.landscape.canvas.width, h: CARD_REFERENCE.landscape.canvas.height },
    ]
    for (const c of cases) {
      const g = cardLayoutGeometry(c.shape, c.w, c.h, 12)!
      const pLeft = g.provider.centerX - g.provider.maxWidth / 2
      const pRight = g.provider.centerX + g.provider.maxWidth / 2
      const pTop = g.provider.centerY - g.provider.maxHeight / 2
      const pBottom = g.provider.centerY + g.provider.maxHeight / 2
      expect(pLeft).toBeGreaterThanOrEqual(0)
      expect(pTop).toBeGreaterThanOrEqual(0)
      expect(pRight).toBeLessThanOrEqual(c.w)
      expect(pBottom).toBeLessThanOrEqual(c.h)
      const t = g.titleLogo
      expect(t.x).toBeGreaterThanOrEqual(g.card.x)
      expect(t.y).toBeGreaterThanOrEqual(g.card.y)
      expect(t.x + t.maxWidth).toBeLessThanOrEqual(g.card.x + g.card.width)
      expect(t.y + t.maxHeight).toBeLessThanOrEqual(g.card.y + g.card.height)
      expect(t.y + t.maxHeight).toBe(g.card.y + g.card.height - t.insetBottom)
      expect(t.x).toBe(g.card.x + t.insetLeft)
      const cardBottom = g.card.y + g.card.height
      expect(g.meta.baselineY).toBeGreaterThan(cardBottom)
      expect(g.meta.baselineY).toBeLessThan(c.h)
      expect(pRight).toBeLessThanOrEqual(g.card.x)
      expect(pRight).toBeLessThanOrEqual(t.x)
    }
  })
})
