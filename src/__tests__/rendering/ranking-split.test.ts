import { describe, expect, it } from "vitest"
import {
  EXTRA_BADGE_STYLES,
  RANKING_BADGE_STYLES,
  isExtraBadgeStyle,
  isRankingBadgeStyle,
} from "@/lib/badge-styles"
import {
  SPLIT_DIVIDER_GAP_FACTOR,
  SPLIT_DIVIDER_WIDTH,
  SPLIT_LABEL_FS_FACTOR,
  SPLIT_NUMERAL_FS_FACTOR,
  SPLIT_NUMERAL_INK_SHIFT_FACTOR,
  TOP_SHADOW_PAD,
  badgeBoxHeight,
  buildHouseExtraSvg,
  buildHouseRankingSvg,
  buildSplitChipSvg,
  estimateTextWidth,
} from "@/lib/badge-svg-shared"
import { topBadgeConsumesAccent } from "@/lib/poster-service"

/**
 * `split` (rs=split, RANKING-ONLY): flat two-tone chip — accent numeral cell +
 * satin period cell. Additive: it must never change the bytes of an existing
 * style, and it reuses the existing dispatchers (no second renderer). Extras
 * never render it: `xbs=split` is invalid (fail-closed to the legacy `rs`
 * behavior) and a legacy `rs=split` fallback degrades to the default plate.
 */
describe("split style enum", () => {
  it("is a ranking style and never a valid xbs value", () => {
    expect((RANKING_BADGE_STYLES as readonly string[])).toContain("split")
    expect(isRankingBadgeStyle("split")).toBe(true)
    expect((EXTRA_BADGE_STYLES as readonly string[])).not.toContain("split")
    expect(isExtraBadgeStyle("split")).toBe(false)
  })

  it("leaves every existing ranking style untouched", () => {
    expect([...RANKING_BADGE_STYLES]).toEqual([
      "default",
      "colored",
      "pill",
      "bordo",
      "vetro",
      "netflix",
      "netflix-color",
      "corner",
      "number",
      "split",
    ])
  })
})

describe("buildSplitChipSvg geometry (single shared builder)", () => {
  const fs = 30
  const numeral = "3"
  const label = "Oggi"

  it("box = textW + 2·0.75fs, badgeBoxHeight(fs) tall, 0.30·boxH radius", () => {
    const res = buildSplitChipSvg({ numeral, label, fs, accentColor: "#E50914" })
    const px = Math.round(fs * 0.75)
    const numeralFs = Math.round(fs * SPLIT_NUMERAL_FS_FACTOR)
    const labelFs = Math.round(fs * SPLIT_LABEL_FS_FACTOR)
    const gap = Math.round(fs * SPLIT_DIVIDER_GAP_FACTOR)
    const textW = estimateTextWidth(numeral, numeralFs) + estimateTextWidth(label, labelFs) + gap * 2 + SPLIT_DIVIDER_WIDTH
    const boxH = badgeBoxHeight(fs)
    expect(numeralFs).toBe(27)
    expect(labelFs).toBe(22)
    // pinned numbers (fs=30, Inter): textW 83, box 129×54, canvas 157×68.
    expect(textW).toBe(83)
    expect(res.w - TOP_SHADOW_PAD * 2).toBe(textW + px * 2)
    expect(res.h).toBe(boxH + TOP_SHADOW_PAD)
    const r = Math.round(boxH * 0.30)
    expect(r).toBe(16)
    expect(res.svg).toContain(`A ${r},${r} 0 0,1`)
  })

  it("renders the two cells: yellow numeral (0.9em/900) + satin label (0.72em/600), 1px divider", () => {
    const { svg } = buildSplitChipSvg({ numeral, label, fs, accentColor: "#E50914" })
    // Fixed mockup yellow cell (scene accent never tints it) + clip to the
    // chip shape (rounded corners survive).
    expect(svg).toContain('fill="#FCD34D"')
    expect(svg).not.toContain('fill="#E50914"')
    expect(svg).toContain('clip-path="url(#splc)"')
    // Satin right cell = the shared polarized pill gradient.
    expect(svg).toContain('fill="url(#splg)"')
    // Numeral and period label typography.
    expect(svg).toContain('font-weight="900" font-size="27"')
    expect(svg).toContain('font-weight="600" font-size="22"')
    expect(svg).toContain(">3</text>")
    expect(svg).toContain(">Oggi</text>")
    // Exactly one 1px divider, polarity-adaptive (dark top here).
    expect(svg.match(/<line /g)).toHaveLength(1)
    expect(svg).toContain('stroke-width="1"')
    expect(svg).toContain('stroke="rgba(255,255,255,0.32)"')
  })

  it("spends exactly one shared 3D shadow filter and one extra rect", () => {
    const { svg } = buildSplitChipSvg({ numeral, label, fs, accentColor: "#E50914" })
    expect(svg.match(/url\(#tds\)/g)).toHaveLength(1)
    expect(svg.match(/<rect /g)).toHaveLength(1)
    // The outlined chip body is the path (not a second rect) and is re-stroked
    // above the accent cell so the 1.5px polarized border survives there.
    expect(svg.match(/stroke-width="1.5"/g)).toHaveLength(2)
  })

  it("numeral ink is the fixed dark ink (12.07:1 on the mockup yellow)", () => {
    const dark = buildSplitChipSvg({ numeral, label, fs, accentColor: "#E50914" }).svg
    const light = buildSplitChipSvg({ numeral, label, fs, accentColor: "#F7E7A1" }).svg
    // Same fixed ink on any scene accent: the chip is always recognizable.
    expect(dark).toContain('fill="#1a1a1a"')
    expect(light).toContain('fill="#1a1a1a"')
    expect(dark).not.toContain('fill="#ffffff"')
  })

  it("double digits keep +10% cell padding; the numeral centers on the yellow cell (single and double)", () => {
    const single = buildSplitChipSvg({ numeral: "3", label, fs })
    const double = buildSplitChipSvg({ numeral: "11", label, fs })
    const px = Math.round(fs * 0.75)
    const numeralFs = Math.round(fs * SPLIT_NUMERAL_FS_FACTOR)
    const labelFs = Math.round(fs * SPLIT_LABEL_FS_FACTOR)
    const gap = Math.round(fs * SPLIT_DIVIDER_GAP_FACTOR)
    const numeralW = Math.max(estimateTextWidth("11", numeralFs), Math.round(numeralFs * 0.35))
    const singleNumeralW = Math.max(estimateTextWidth("3", numeralFs), Math.round(numeralFs * 0.35))
    const labelW = estimateTextWidth(label, labelFs)
    // Cell padding +10% on the numeral cell (25 vs 23 at fs=30).
    const doubleTextW = numeralW + labelW + gap * 2 + SPLIT_DIVIDER_WIDTH
    expect(double.w - TOP_SHADOW_PAD * 2).toBe(doubleTextW + Math.round(px * 1.1) + px)
    // Single-digit geometry is untouched (historical box).
    const singleTextW = singleNumeralW + labelW + gap * 2 + SPLIT_DIVIDER_WIDTH
    expect(single.w - TOP_SHADOW_PAD * 2).toBe(singleTextW + px * 2)
    // Optical centering: the numeral anchor is the YELLOW CELL center (the
    // padding inset is asymmetric) + the em-proportional ink-bearing
    // compensation; vertical anchor is the box center for both digit counts.
    const numeralPos = (svg: string) => {
      const m = svg.match(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="27"/)
      return { x: Number(m?.[1]), y: Number(m?.[2]) }
    }
    const inkShift = numeralFs * SPLIT_NUMERAL_INK_SHIFT_FACTOR
    const doubleLeftCellW = Math.round(px * 1.1) + numeralW + gap
    const singleLeftCellW = px + singleNumeralW + gap
    expect(numeralPos(double.svg).x).toBeCloseTo(TOP_SHADOW_PAD + doubleLeftCellW / 2 + inkShift, 2)
    expect(numeralPos(double.svg).y).toBe(badgeBoxHeight(fs) / 2)
    expect(numeralPos(single.svg).x).toBeCloseTo(TOP_SHADOW_PAD + singleLeftCellW / 2 + inkShift, 2)
    expect(numeralPos(single.svg).y).toBe(badgeBoxHeight(fs) / 2)
  })

  it("detached rounds all four corners, flush top keeps the historic plate shape", () => {
    const flush = buildSplitChipSvg({ numeral, label, fs, accentColor: "#E50914" }).svg
    const detached = buildSplitChipSvg({ numeral, label, fs, accentColor: "#E50914", detached: true }).svg
    // Flush top: the plate is glued to the top edge (only the bottom corners
    // are rounded), same shape as the historic centered plate.
    expect(flush).toContain('d="M 14,0 L 143,0 L 143,38 A 16,16')
    expect(flush).not.toContain('d="M 30,0')
    // Detached: all four corners rounded.
    expect(detached).toContain('d="M 30,0 L 127,0 A 16,16')
    expect(detached).not.toContain('d="M 14,0 L 143,0')
  })

  it("auto-fits a long localized label toward the 0.55em floor, never clips", () => {
    // "Aujourd'hui" at base 0.72em is far too wide for a tight cap: the label
    // shrinks stepwise (weight 600 kept) instead of growing/clipping the chip.
    const base = buildSplitChipSvg({ numeral: "3", label: "Aujourd'hui", fs })
    const fitted = buildSplitChipSvg({ numeral: "3", label: "Aujourd'hui", fs, maxWidth: 200 })
    const clipped = buildSplitChipSvg({ numeral: "3", label: "Aujourd'hui", fs, maxWidth: 120 })
    const floorFs = Math.ceil(fs * 0.55)
    const labelFsOf = (svg: string) => Number(svg.match(/font-weight="600" font-size="(\d+)"/)?.[1])
    expect(labelFsOf(base.svg)).toBe(Math.round(fs * 0.72))
    // Stepwise fit lands above the floor and inside the cap.
    expect(labelFsOf(fitted.svg)).toBeLessThan(labelFsOf(base.svg))
    expect(labelFsOf(fitted.svg)).toBeGreaterThanOrEqual(floorFs)
    expect(fitted.w - TOP_SHADOW_PAD * 2).toBeLessThanOrEqual(200)
    // An impossible cap bottoms out at the floor (bounded exception: the chip
    // may exceed the cap only there) and the run stays pinned — never clipped.
    expect(labelFsOf(clipped.svg)).toBe(floorFs)
    expect(clipped.svg).toContain('lengthAdjust="spacingAndGlyphs"')
    // A short label (Heute) already fits at base size, untouched by the fit.
    const short = buildSplitChipSvg({ numeral: "3", label: "Heute", fs, maxWidth: 160 })
    expect(labelFsOf(short.svg)).toBe(Math.round(fs * 0.72))
    // Production realistic cap (pw 380 → maxWidth 360): even the longest UI
    // label ("Aujourd'hui", fr) keeps the base 0.72em size.
    const production = buildSplitChipSvg({ numeral: "3", label: "Aujourd'hui", fs, maxWidth: 360 })
    expect(labelFsOf(production.svg)).toBe(Math.round(fs * 0.72))
    expect(production.w - TOP_SHADOW_PAD * 2).toBeLessThanOrEqual(360)
  })
})

describe("split through the existing dispatchers", () => {
  it("rank: two-tone chip with numeral + period, fixed mockup yellow", () => {
    const { svg } = buildHouseRankingSvg({ rank: 3, label: "Oggi", pw: 380, topLight: false, style: "split", accentColor: "#E50914" })
    expect(svg).toContain(">3</text>")
    expect(svg).toContain(">Oggi</text>")
    expect(svg).toContain('fill="#FCD34D"')
    expect(svg).toContain('fill="#1a1a1a"')
    // Not the historic "#3 Oggi" single-run default plate.
    expect(svg).not.toContain("#3 Oggi")
    expect(svg).toContain('fill="url(#splg)"')
  })

  it("extra via the legacy rs fallback degrades to the default plate (ranking-only style)", () => {
    const splitFallback = buildHouseExtraSvg({ label: "Nuova serie", pw: 380, topLight: false, style: "split" })
    const plate = buildHouseExtraSvg({ label: "Nuova serie", pw: 380, topLight: false, style: "default" })
    // Fail-closed: no two-tone chip, no accent cell, no divider — the historic
    // default plate bytes, exactly what the legacy `rs` fallback renders.
    expect(splitFallback.svg).toBe(plate.svg)
    expect(splitFallback.svg).not.toContain("splg")
    expect(splitFallback.svg).not.toContain("<rect ")
  })

  it("existing styles stay byte-identical (additive only)", () => {
    const base = { rank: 3, label: "Oggi", pw: 380, topLight: false }
    expect(buildHouseRankingSvg({ ...base, style: "default" }).svg).toContain("#3 Oggi")
    expect(buildHouseRankingSvg({ ...base, style: "default" }).svg).toContain("url(#rdg)")
    const pill = buildHouseRankingSvg({ ...base, style: "pill" }).svg
    expect(pill).toContain("url(#rpg)")
    expect(pill).not.toContain("splg")
  })
})

describe("split accent gate", () => {
  it("rank split samples the scene accent; the extra rs fallback never does", () => {
    expect(topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: "split" })).toBe(true)
    // Extras degrade to the default plate: no accent cell, no tint sampling.
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "split" })).toBe(false)
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "split", extraBadgeStyle: null })).toBe(false)
  })
})
