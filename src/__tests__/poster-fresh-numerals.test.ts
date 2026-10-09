/**
 * Fresh glass numeral defects (user-confirmed): numeral "4" rendered with
 * internal overlapping stroke segments/vertical seams, "20" slightly clipped,
 * "9" seen clipped.
 *
 * Root causes (deterministic resvg evidence, same font database as the
 * renderer):
 * - the rim was a raw `<text fill="none" stroke>` outline: every font
 *   subpath contour is stroked, including the overlapping inner contours of
 *   glyphs like "4" (17.9% of deep-interior pixels carried rim alpha);
 * - the SVG canvas was sized from `estimateTextWidth` (calibrated for badge
 *   text), which undershoots real Inter-Black digit ink by up to ~6%, so wide
 *   digits (4/6/8/9, 20) touched the right bitmap edge (real ink clipped +
 *   rim/shadow ROI clipped);
 * - a global fixed `letter-spacing="-8"` over-tightened small (shrunk
 *   multi-digit) sizes instead of scaling with the font.
 *
 * Fix (fresh-layout.ts only): proportional `-0.03em` tracking, canvas from
 * estimate × 1.12 (estimate stays the font-size target source; real bounds
 * authoritative in tests), rim as a morphology ring derived from the unioned
 * rasterized silhouette (dilated alpha minus alpha — 0.00% interior), same
 * gradient stops/shadow/fill/modeling. Rank absent/invalid path untouched
 * (covered by the existing fresh-layout + fresh-unranked suites).
 *
 * These tests assert on ACTUAL rasterized alpha (masks, rim layers, full
 * numeral layers), never on estimates: no edge-clipped pixels, real ink
 * margins, a derived united-mask seam reference for "4" (and every 1..20),
 * distinct 1..20 outputs on both shapes, measured timings.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { describe, it, expect } from "vitest"
import {
  freshGeometry,
  freshNumeralSvg,
  freshNumeralRimDefs,
  renderFreshNumeralMask,
  renderFreshGlassNumeral,
  measureNumeralInk,
  type FreshNumeralBox,
} from "@/lib/fresh-layout"
import { renderSVG } from "@/lib/svg-badge"
import { STD_W, STD_H, LAND_W, LAND_H } from "@/lib/image-utils"

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function flatBase(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#3a3f55" } })
    .jpeg()
    .toBuffer()
}

async function alphaPlane(buf: Buffer): Promise<{ a: Uint8Array; w: number; h: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const a = new Uint8Array(info.width * info.height)
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3] ?? 0
  return { a, w: info.width, h: info.height }
}

/** Alpha>threshold pixels on the outermost edge rows/columns (clip detector). */
async function edgeAlphaCount(buf: Buffer, threshold = 10): Promise<number> {
  const { a, w, h } = await alphaPlane(buf)
  let n = 0
  for (let x = 0; x < w; x++) {
    if ((a[x] ?? 0) > threshold) n++
    if (h > 1 && (a[(h - 1) * w + x] ?? 0) > threshold) n++
  }
  for (let y = 1; y < h - 1; y++) {
    if ((a[y * w] ?? 0) > threshold) n++
    if (w > 1 && (a[y * w + w - 1] ?? 0) > threshold) n++
  }
  return n
}

/**
 * Reference united interior: the shared text element eroded deep into the
 * glyph (feMorphology on the rasterized alpha — unioned by construction, no
 * subpaths). Rim alpha inside this region is a seam, not an edge.
 */
async function erodedInterior(box: FreshNumeralBox, radius: number): Promise<{ a: Uint8Array; w: number; h: number }> {
  const svg = freshNumeralSvg(box)
  const eroSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svg.svgW}" height="${svg.svgH}" viewBox="0 0 ${svg.svgW} ${svg.svgH}">` +
    `<defs><filter id="freshNumEro" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
    `<feMorphology in="SourceAlpha" operator="erode" radius="${radius}" result="e"/>` +
    `<feFlood flood-color="#ffffff" result="c"/><feComposite in="c" in2="e" operator="in"/>` +
    `</filter></defs><g filter="url(#freshNumEro)">${svg.textEl}</g></svg>`
  return alphaPlane(await renderSVG(eroSvg, svg.svgW))
}

const SHAPES = [
  { name: "portrait", CW: STD_W, CH: STD_H },
  { name: "landscape", CW: LAND_W, CH: LAND_H },
] as const

const RANKS_1_20 = Array.from({ length: 20 }, (_, i) => i + 1)

describe("fresh numeral ink bounds (actual rasterized alpha)", () => {
  it("keeps real glyph ink off the mask bitmap edges for every rank 1..100, both shapes", async () => {
    // Every accepted rank (not just a sample): the estimate × 1.12 canvas
    // factor is size-invariant (both estimate and ink scale with fontSize)
    // and the 10 digit glyphs all appear across 1..20, but multi-digit
    // advances compose per glyph — so all 1..100 are asserted directly on
    // rasterized alpha. Mask-only renders: fast, no full posters needed.
    let worst = { ratio: 0, rank: 0, shape: "" }
    for (const { name, CW, CH } of SHAPES) {
      for (let rank = 1; rank <= 100; rank++) {
        const box = freshGeometry(CW, CH, rank).numeral
        expect(box).not.toBeNull()
        const mask = await renderFreshNumeralMask(box!)
        const ink = await measureNumeralInk(mask.png)
        expect(ink).not.toBeNull()
        // Margin for the rim ring + drop shadow on every side: the old
        // estimate-sized canvas touched the right edge (0px) for 4/6/8/9/20.
        const mL = ink!.minX
        const mR = ink!.w - 1 - ink!.maxX
        const mT = ink!.minY
        const mB = ink!.h - 1 - ink!.maxY
        expect(mL).toBeGreaterThanOrEqual(4)
        expect(mR).toBeGreaterThanOrEqual(4)
        expect(mT).toBeGreaterThanOrEqual(4)
        expect(mB).toBeGreaterThanOrEqual(4)
        const inkW = ink!.maxX - ink!.minX + 1
        const ratio = inkW / Math.max(1, box!.estW)
        if (ratio > worst.ratio) worst = { ratio, rank, shape: name }
      }
    }
    // Evidence for the scratch canvas factor: worst real/est over all
    // accepted ranks must stay comfortably below FRESH_NUMERAL_SCRATCH_W
    // (1.25) — the shipped geometry comes from the measured crop, so this
    // bound only guards the scratch canvas. Fails early (1.20) while ~4%
    // of emergency margin remains before any real ink could touch scratch.
    console.log(
      `[fresh-numerals] worst ink/est=${worst.ratio.toFixed(3)} at rank=${worst.rank} shape=${worst.shape}`,
    )
    expect(worst.ratio).toBeLessThan(1.2)
  }, 240000)
})

describe("fresh numeral rim seam (united-silhouette reference)", () => {
  it("carries no rim alpha deep inside the glyphs for 1..20, both shapes (esp. 4)", async () => {
    for (const { name, CW, CH } of SHAPES) {
      for (const rank of RANKS_1_20) {
        const box = freshGeometry(CW, CH, rank).numeral!
        // Shadowless white ring from the SHIPPED defs (same geometry as the
        // production rim): the seam test isolates the ring contour — the
        // drop shadow is a unioned-silhouette shadow by construction and is
        // covered visually by the contact sheet.
        const { svgW, svgH, defs } = freshNumeralRimDefs(box)
        const ringSvg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">` +
          `<defs>${defs}</defs>` +
          `<rect width="${svgW}" height="${svgH}" fill="#ffffff" mask="url(#freshNumRingM)"/></svg>`
        const ring = await alphaPlane(await renderSVG(ringSvg, svgW))
        const interior = await erodedInterior(box, 8)
        expect(ring.w).toBe(interior.w)
        expect(ring.h).toBe(interior.h)
        let inCount = 0
        let seamCount = 0
        for (let i = 0; i < interior.a.length; i++) {
          if ((interior.a[i] ?? 0) > 128) {
            inCount++
            if ((ring.a[i] ?? 0) > 30) seamCount++
          }
        }
        // Non-vacuous: the eroded interior must exist at these sizes (the
        // ring lives outside the silhouette, so a shallow erosion suffices).
        expect(inCount).toBeGreaterThan(200)
        // The old raw-stroke rim measured 17.9% here for "4"; the unioned
        // ring measures 0.00%. Bound well below the defect, above numeric noise.
        const frac = seamCount / Math.max(1, inCount)
        expect({ rank, shape: name, frac }).toEqual(expect.objectContaining({ rank, shape: name }))
        expect(frac).toBeLessThan(0.005)
      }
    }
  }, 240000)
})

describe("fresh numeral layers (full output)", () => {
  for (const { name, CW, CH } of SHAPES) {
    it(`${name}: no edge-clipped pixels and 20 distinct outputs, timed`, async () => {
      const base = await flatBase(CW, CH)
      const hashes = new Set<string>()
      const t0 = performance.now()
      for (const rank of RANKS_1_20) {
        const box = freshGeometry(CW, CH, rank).numeral!
        const num = await renderFreshGlassNumeral(base, CW, CH, box)
        // Anchor preserved: default left/top placement from the geometry box.
        expect(num.left).toBeGreaterThanOrEqual(0)
        expect(num.top).toBeGreaterThanOrEqual(0)
        expect(num.left + num.w).toBeLessThanOrEqual(CW)
        expect(num.top + num.h).toBeLessThanOrEqual(CH)
        // No clipped pixel edge: nothing opaque touches the layer border
        // (mask ink + rim ring + shadow fringe all fit inside the ROI).
        expect(await edgeAlphaCount(num.png)).toBe(0)
        hashes.add(sha(num.png))
      }
      const total = performance.now() - t0
      console.log(
        `[fresh-numerals] shape=${name} ranks=20 total=${total.toFixed(0)}ms avg=${(total / 20).toFixed(0)}ms/rank`,
      )
      expect(hashes.size).toBe(20)
    }, 240000)
  }
})
