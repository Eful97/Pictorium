/**
 * Task12 correction c2 — rank-aware glyph condensing (latest user constraint
 * "si schiacciano tutti. io voglio che si schiaccino solo dal 10 in poi",
 * superseding the c1 all-portrait squeeze).
 *
 * Contract: ONLY portrait ranks >= 10 condense to 70% of CURRENT width
 * (0.6 × 0.7 = 0.42 of natural); portrait singles (1..9) keep the task12
 * pre-c1 factor 0.6 (NOT natural 1.0); EVERY landscape rank keeps 0.6
 * byte-identical to c1 (= pre-c1, landscape was never squeezed). Portrait
 * height (.33 CH → capH 248), the Y30/-90 baseline, metadata/provider/title
 * placement do not move for any rank (the blur band width follows the actual
 * condensed ink automatically — no separate assertion needed here).
 *
 * This suite pins the correction against the CAPTURED baselines (measured
 * 2026-10-09 on the task12-active tree, before any c1 edit; raw capture in
 * the approved temp dir `task12-c1-before-ink.json` +
 * `task12-c1-before-*.png`, sha256 recorded in the c1 evidence file; c1
 * after-masks in `task12-c1-after-*.png` + `task12-c1-after-shas.txt`):
 * - portrait 1/9: geometry + actual raster ink IDENTICAL to the pre-c1
 *   baseline (0.6), mask bytes identical to the captured before PNGs;
 * - portrait 10/20/100: geometry + actual raster ink IDENTICAL to the c1
 *   after state (0.42), mask bytes identical to the captured c1-after PNGs
 *   (10/20; 100 has no captured PNG — pinned via exact condensed formula +
 *   ink ratio vs the before baseline);
 * - landscape 1/9/10/20/100: geometry + ink IDENTICAL to the captured
 *   before baseline AND the rank-10 mask byte-identical to the pinned sha
 *   (landscape path untouched by c1 AND c2);
 * - helper backward compatibility: absent rank defaults to the single-digit
 *   0.6 on portrait; no invalid rank ever draws (isFreshRank-gated upstream);
 * - portrait stays height-coherent: one fontSize/capH/top/metaTop for 1..100,
 *   two-digit inkW/capH slender (< 0.8, 10..99 only — rank 100 carries three
 *   digits and binds a different ratio bound by digit count, grouped
 *   explicitly; known metadata column width unchanged).
 */
import { createHash } from "node:crypto"
import { describe, it, expect } from "vitest"
import {
  freshGeometry,
  freshNumeralSvg,
  freshNumeralCondenseX,
  renderFreshNumeralMask,
  measureNumeralInk,
  FRESH_NUMERAL_CONDENSE_X,
  FRESH_NUMERAL_CONDENSE_X_PORTRAIT,
  FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE,
  FRESH_NUMERAL_CONDENSE_X_LANDSCAPE,
} from "@/lib/fresh-layout"
import { STD_W, STD_H, LAND_W, LAND_H } from "@/lib/image-utils"

/** Captured BEFORE values (task12 baseline, factor 0.6 both shapes). */
const BEFORE = {
  portrait: {
    1: { fontSize: 340, capH: 248, top: 30, left: 12, estW: 118, inkW: 74, inkH: 248 },
    9: { fontSize: 340, capH: 248, top: 30, left: 12, estW: 118, inkW: 125, inkH: 255 },
    10: { fontSize: 340, capH: 248, top: 30, left: 12, estW: 236, inkW: 228, inkH: 258 },
    20: { fontSize: 340, capH: 248, top: 30, left: 12, estW: 236, inkW: 259, inkH: 258 },
    100: { fontSize: 340, capH: 248, top: 30, left: 12, estW: 355, inkW: 371, inkH: 258 },
  },
  landscape: {
    1: { fontSize: 296, capH: 216, top: 40, left: 18, estW: 103, inkW: 65, inkH: 216 },
    9: { fontSize: 296, capH: 216, top: 40, left: 18, estW: 103, inkW: 108, inkH: 222 },
    10: { fontSize: 296, capH: 216, top: 40, left: 18, estW: 206, inkW: 200, inkH: 225 },
    20: { fontSize: 296, capH: 216, top: 40, left: 18, estW: 206, inkW: 226, inkH: 225 },
    100: { fontSize: 296, capH: 216, top: 40, left: 18, estW: 309, inkW: 324, inkH: 225 },
  },
} as const

/** Captured BEFORE portrait single-digit masks (task12 baseline, factor 0.6). */
const BEFORE_PORTRAIT_9_MASK_SHA = "0a41ea317db0524a8586a05167e1452ec6e3d783138c16440651551bcd78c69f"
/** Captured C1-AFTER portrait multi-digit masks (factor 0.42 — c2 keeps them byte-identical). */
const C1_AFTER_PORTRAIT_10_MASK_SHA = "a00eb19bb65972ee72a55911a0bb3c902db5b4a87edf9a55bc50ae90a3431980"
const C1_AFTER_PORTRAIT_20_MASK_SHA = "583d328c0ef7d330d0c5ebd83536335fe3d7d4bdb3ad4fe1d61d07e0eca92560"
/** Captured BEFORE landscape rank-10 mask (task12 baseline, factor 0.6 — untouched by c1 AND c2). */
const BEFORE_LANDSCAPE_10_MASK_SHA = "fce7ef99d0a56fea6c90c087b06d4eb667a3d26ab43e839dd3621a955496854f"

const SINGLES = [1, 9] as const
const MULTIS = [10, 20, 100] as const
const ALL_PINNED = [1, 9, 10, 20, 100] as const

describe("task12 c2 rank-aware condense (only portrait >= 10 squeezes)", () => {
  it("pins the rank-aware condensation factors with a backward-compatible single default", () => {
    expect(FRESH_NUMERAL_CONDENSE_X).toBe(0.6)
    expect(FRESH_NUMERAL_CONDENSE_X_PORTRAIT).toBe(0.42)
    expect(FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE).toBe(0.6)
    expect(FRESH_NUMERAL_CONDENSE_X_LANDSCAPE).toBe(0.6)
    // Portrait: singles (and absent/invalid rank) default to 0.6 — never 0.42.
    expect(freshNumeralCondenseX(true, 1)).toBe(0.6)
    expect(freshNumeralCondenseX(true, 9)).toBe(0.6)
    expect(freshNumeralCondenseX(true)).toBe(0.6)
    expect(freshNumeralCondenseX(true, null)).toBe(0.6)
    expect(freshNumeralCondenseX(true, undefined)).toBe(0.6)
    expect(freshNumeralCondenseX(true, 0)).toBe(0.6)
    expect(freshNumeralCondenseX(true, 6.5)).toBe(0.6)
    expect(freshNumeralCondenseX(true, NaN)).toBe(0.6)
    // Portrait: 10..100 squeeze to 0.42.
    expect(freshNumeralCondenseX(true, 10)).toBe(0.42)
    expect(freshNumeralCondenseX(true, 20)).toBe(0.42)
    expect(freshNumeralCondenseX(true, 100)).toBe(0.42)
    // Landscape: every rank (and no rank) stays 0.6.
    for (const rank of [1, 9, 10, 20, 100] as const) {
      expect(freshNumeralCondenseX(false, rank)).toBe(0.6)
    }
    expect(freshNumeralCondenseX(false)).toBe(0.6)
    expect(freshNumeralCondenseX(false, null)).toBe(0.6)
  })

  it("restores portrait singles byte-identical to the pre-c1 baseline (0.6, not 0.42)", async () => {
    for (const rank of SINGLES) {
      const before = BEFORE.portrait[rank]
      const box = freshGeometry(STD_W, STD_H, rank).numeral!
      // Y + placement untouched: same type, same height, same anchor.
      expect(box.fontSize).toBe(before.fontSize)
      expect(box.capH).toBe(before.capH)
      expect(box.top).toBe(before.top)
      expect(box.left).toBe(before.left)
      // c1 expectation (.42) intentionally restored: singles keep 0.6.
      expect(box.condenseX).toBe(0.6)
      expect(box.estW).toBe(before.estW)
      const ink = await measureNumeralInk((await renderFreshNumeralMask(box)).png)
      expect(ink).not.toBeNull()
      expect(ink!.maxX - ink!.minX + 1).toBe(before.inkW)
      expect(ink!.maxY - ink!.minY + 1).toBe(before.inkH)
    }
    // Full mask bytes pinned for rank 9 (captured before PNG available).
    const mask9 = await renderFreshNumeralMask(freshGeometry(STD_W, STD_H, 9).numeral!)
    expect(createHash("sha256").update(mask9.png).digest("hex")).toBe(BEFORE_PORTRAIT_9_MASK_SHA)
    expect(freshNumeralSvg(freshGeometry(STD_W, STD_H, 9).numeral!).textEl).toContain(`transform="scale(0.6 1)"`)
    expect(freshNumeralSvg(freshGeometry(STD_W, STD_H, 1).numeral!).textEl).toContain(`transform="scale(0.6 1)"`)
  }, 180000)

  it("keeps portrait 10/20/100 byte-identical to the c1 state (0.42)", async () => {
    for (const rank of MULTIS) {
      const before = BEFORE.portrait[rank]
      const box = freshGeometry(STD_W, STD_H, rank).numeral!
      // Y + placement untouched: same type, same height, same anchor.
      expect(box.fontSize).toBe(before.fontSize)
      expect(box.capH).toBe(before.capH)
      expect(box.top).toBe(before.top)
      expect(box.left).toBe(before.left)
      expect(box.condenseX).toBe(0.42)
      // Width is 70% of CURRENT (0.42/0.6 = 0.7 exactly, ±1px rounding).
      expect(box.estW).toBeGreaterThanOrEqual(Math.round(before.estW * 0.7) - 1)
      expect(box.estW).toBeLessThanOrEqual(Math.round(before.estW * 0.7) + 1)
      const ink = await measureNumeralInk((await renderFreshNumeralMask(box)).png)
      expect(ink).not.toBeNull()
      const inkW = ink!.maxX - ink!.minX + 1
      const inkH = ink!.maxY - ink!.minY + 1
      // Actual ink width ≈ before × 0.7 (±3px ink/shadow tolerance).
      expect(inkW).toBeGreaterThanOrEqual(Math.round(before.inkW * 0.7) - 3)
      expect(inkW).toBeLessThanOrEqual(Math.round(before.inkW * 0.7) + 3)
      // Actual ink height SAME as before (±1px resvg rounding).
      expect(Math.abs(inkH - before.inkH)).toBeLessThanOrEqual(1)
      // Slender portrait style coherent after the extra squeeze (two-digit
      // ranks narrower than their cap height; rank 100 carries three digits
      // so it binds a different ratio bound — grouped explicitly, not here).
      if (rank >= 10 && rank < 100) expect(inkW / box.capH).toBeLessThan(0.8)
    }
    // Full mask bytes pinned to the c1-after captures (10/20 available).
    const mask10 = await renderFreshNumeralMask(freshGeometry(STD_W, STD_H, 10).numeral!)
    expect(createHash("sha256").update(mask10.png).digest("hex")).toBe(C1_AFTER_PORTRAIT_10_MASK_SHA)
    const mask20 = await renderFreshNumeralMask(freshGeometry(STD_W, STD_H, 20).numeral!)
    expect(createHash("sha256").update(mask20.png).digest("hex")).toBe(C1_AFTER_PORTRAIT_20_MASK_SHA)
    expect(freshNumeralSvg(freshGeometry(STD_W, STD_H, 10).numeral!).textEl).toContain(`transform="scale(0.42 1)"`)
  }, 180000)

  it("shows the 9→10 transition at one height: same capH, narrower two-digit ink, single not thinned", async () => {
    const single = freshGeometry(STD_W, STD_H, 9).numeral!
    const multi = freshGeometry(STD_W, STD_H, 10).numeral!
    // Same visible height across the transition (no minification of 10+).
    expect(multi.fontSize).toBe(single.fontSize)
    expect(multi.capH).toBe(single.capH)
    expect(multi.top).toBe(single.top)
    expect(freshGeometry(STD_W, STD_H, 9).metaTop).toBe(freshGeometry(STD_W, STD_H, 10).metaTop)
    // Only the multi-digit width squeezes: the single keeps its baseline ink.
    expect(single.condenseX).toBe(0.6)
    expect(multi.condenseX).toBe(0.42)
    const inkSingle = await measureNumeralInk((await renderFreshNumeralMask(single)).png)
    const inkMulti = await measureNumeralInk((await renderFreshNumeralMask(multi)).png)
    expect(inkSingle!.maxX - inkSingle!.minX + 1).toBe(BEFORE.portrait[9].inkW)
    const multiW = inkMulti!.maxX - inkMulti!.minX + 1
    expect(multiW).toBeGreaterThanOrEqual(Math.round(BEFORE.portrait[10].inkW * 0.7) - 3)
    expect(multiW).toBeLessThanOrEqual(Math.round(BEFORE.portrait[10].inkW * 0.7) + 3)
  }, 180000)

  it("keeps one portrait height for every rank 1..100", () => {
    const ref = freshGeometry(STD_W, STD_H, 7).numeral!
    expect(ref.condenseX).toBe(0.6)
    for (let rank = 1; rank <= 100; rank++) {
      const box = freshGeometry(STD_W, STD_H, rank).numeral!
      expect(box.fontSize).toBe(ref.fontSize)
      expect(box.capH).toBe(ref.capH)
      expect(box.top).toBe(ref.top)
      // Rank-aware factor per digit count (grouped, never a per-rank wiggle).
      expect(box.condenseX).toBe(rank >= 10 ? 0.42 : 0.6)
    }
    expect(new Set(Array.from({ length: 100 }, (_, i) => freshGeometry(STD_W, STD_H, i + 1).metaTop)).size).toBe(1)
  })

  it("pins landscape byte-identical to the captured before baseline (0.6, untouched by c1 AND c2)", async () => {
    for (const rank of ALL_PINNED) {
      const before = BEFORE.landscape[rank]
      const box = freshGeometry(LAND_W, LAND_H, rank).numeral!
      expect(box.fontSize).toBe(before.fontSize)
      expect(box.capH).toBe(before.capH)
      expect(box.top).toBe(before.top)
      expect(box.left).toBe(before.left)
      expect(box.estW).toBe(before.estW)
      expect(box.condenseX).toBe(0.6)
      const ink = await measureNumeralInk((await renderFreshNumeralMask(box)).png)
      expect(ink).not.toBeNull()
      expect(ink!.maxX - ink!.minX + 1).toBe(before.inkW)
      expect(ink!.maxY - ink!.minY + 1).toBe(before.inkH)
    }
    // Full mask bytes pinned (not just extents): the landscape path is
    // untouched by c1 and by c2.
    const mask = await renderFreshNumeralMask(freshGeometry(LAND_W, LAND_H, 10).numeral!)
    expect(createHash("sha256").update(mask.png).digest("hex")).toBe(BEFORE_LANDSCAPE_10_MASK_SHA)
    expect(freshNumeralSvg(freshGeometry(LAND_W, LAND_H, 10).numeral!).textEl).toContain(`transform="scale(0.6 1)"`)
  }, 180000)
})
