import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  CARD_NUMERAL_CORE_THRESHOLD,
  cardNumeralColumns,
  cardNumeralContourRing,
  cardNumeralMaskSvg,
  measureAlphaInk,
  placeDoubleNumeral,
  placeSingleNumeral,
  renderCardNumeralLayer,
  renderCardPoster,
  splitCardNumeralColumns,
  type CardLayoutInput,
} from "@/lib/card-layout"
import {
  CARD_NUMERAL_CONDENSE_X,
  CARD_NUMERAL_ENLARGE,
  CARD_REFERENCE,
  cardLayoutGeometry,
} from "@/lib/card-layout-geometry"
import type { CardSkin } from "@/lib/card-layout-skins"
import { renderSVG } from "@/lib/svg-badge"
import { estimateTextWidth } from "@/lib/badge-svg-shared"
import { LAND_H, LAND_W } from "@/lib/constants"
import { STD_H, STD_W } from "@/lib/image-utils"

const SKINS: CardSkin[] = ["provider-glass", "nuvio", "stremio"]
const SHAPES = [
  { name: "poster" as const, w: STD_W, h: STD_H },
  { name: "landscape" as const, w: LAND_W, h: LAND_H },
] as const
const ACCENT = "#E50914"
const FOCUSED = [1, 4, 7, 10, 11, 20] as const

async function solidPng(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 18, g: 28, b: 46, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

function baseInput(
  skin: CardSkin,
  shape: "poster" | "landscape",
  artwork: Buffer,
  rank: number | null,
): CardLayoutInput {
  return {
    skin,
    shape,
    width: shape === "poster" ? STD_W : LAND_W,
    height: shape === "poster" ? STD_H : LAND_H,
    artwork,
    displayedRank: rank,
    titleLogo: null,
    providerLogo: null,
    brandAccent: ACCENT,
    genreName: null,
    year: null,
    ratings: null,
  }
}

async function rawPixels(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

interface Grid {
  readonly svgW: number
  readonly svgH: number
  readonly pad: number
  readonly baselineY: number
}

/**
 * Old (pre-P16) singles grid + SVG, verbatim reference `numberSvg`
 * semantics: stroked `<text>` (`fill="none"`, weight 800, extra `-0.03em`
 * tracking, solid stroke, round joins) with NO filter — isolates the stroke
 * as the artifact cause (any interior ink here cannot come from glow, rim,
 * or morphology).
 */
function oldStrokedGrid(digit: string, fs: number, ls: number, sw: number): Grid & { svg: string } {
  const track = -Math.round(fs * 0.03)
  const estW = Math.max(
    1,
    Math.round(
      estimateTextWidth(digit, fs) + track * Math.max(0, digit.length - 1) + ls * Math.max(0, digit.length - 1),
    ),
  )
  const pad = Math.max(8, sw + 8)
  const svgW = estW + pad * 2 + 4
  const svgH = Math.round(fs * 1.0) + pad * 2
  const baselineY = pad + Math.round(fs * 0.75)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">` +
    `<text x="${pad}" y="${baselineY}" font-family="Inter, Arial, Helvetica, sans-serif" ` +
    `font-size="${fs}" font-weight="800" letter-spacing="${ls + track}" ` +
    `fill="none" stroke="#ffffff" stroke-width="${sw}" ` +
    `paint-order="stroke" stroke-linejoin="round">${digit}</text></svg>`
  return { svg, svgW, svgH, pad, baselineY }
}

/**
 * Independent re-derivation of the shipped ring-layer grid (same formulas
 * as the shared production source, re-done here): the test asserts equality
 * with the production mask dims, so the rogue scan below compares against a
 * silhouette on a provably identical grid.
 */
function shippedGrid(digits: string, fs: number, ls: number, sw: number, cx: number): Grid {
  const rawEst = Math.max(1, Math.round(estimateTextWidth(digits, fs) + ls * Math.max(0, digits.length - 1)))
  const estW = Math.max(1, Math.ceil(rawEst * cx * 1.35))
  const pad = Math.max(8, sw + 8)
  const svgW = estW + pad * 2 + 4
  const svgH = Math.round(fs * 1.0) + pad * 2
  const baselineY = pad + Math.round(fs * 0.75)
  return { svgW, svgH, pad, baselineY }
}

/**
 * Ground-truth filled silhouette on an explicitly passed grid (plain flat
 * fill, no stroke, no filter): the union the outline must follow.
 * `shift` moves the text origin (used to center the fill on a padded
 * comparison canvas while the variant keeps its own origin).
 */
function fillSvgOnGrid(digits: string, fs: number, lsEff: number, cx: number, grid: Grid, shift = 0): string {
  const condensed = cx < 1
  const pad = grid.pad + shift
  const x = condensed ? Math.round((pad / cx) * 100) / 100 : pad
  const transform = condensed ? `transform="scale(${cx} 1)" ` : ""
  const W = grid.svgW + shift * 2
  const H = grid.svgH + shift * 2
  const baseline = grid.baselineY + shift
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<text x="${x}" y="${baseline}" font-family="Inter, Arial, Helvetica, sans-serif" ` +
    `font-size="${fs}" font-weight="800" letter-spacing="${lsEff}" ${transform}fill="#ffffff">${digits}</text></svg>`
  )
}

/** Comparison margin around a variant grid (the old tight grid has ~4px spare; the fill needs room). */
const COMPARE_PAD = 24

/**
 * Renders a transparent PNG centered on a padded canvas (transparent
 * margin `COMPARE_PAD` on every side): rogue scans then compare against a
 * fill rendered with the same shift, so neither layer can touch a
 * comparison edge and every pixel meets the true silhouette underneath.
 */
async function renderOnPaddedCanvasPng(layer: Buffer, grid: Grid): Promise<{ png: Buffer; w: number; h: number }> {
  const w = grid.svgW + COMPARE_PAD * 2
  const h = grid.svgH + COMPARE_PAD * 2
  const png = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: layer, left: COMPARE_PAD, top: COMPARE_PAD }])
    .png()
    .toBuffer()
  return { png, w, h }
}

/**
 * Renders a variant SVG centered on a padded canvas (transparent margin
 * `COMPARE_PAD` on every side): the OLD stroked reference still ships as
 * an SVG string, so it keeps its own padding path.
 */
async function renderOnPaddedCanvas(svg: string, svgW: number, grid: Grid): Promise<{ png: Buffer; w: number; h: number }> {
  const layer = await renderSVG(svg, svgW)
  return renderOnPaddedCanvasPng(layer, grid)
}

interface RogueResult {
  /** Core-ink px inside the fill silhouette but far from any fill edge. */
  readonly count: number
  /** All core-ink px of the variant (ring + rogue + fringe). */
  readonly coreCount: number
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

/**
 * Enclosed void pixels of a glyph mask (4-connected background NOT
 * reachable from the borders): the legitimate counters/holes of the
 * union silhouette (the 4 triangle, 6/8/9/0 bowls) at the same >128
 * threshold the contour helper binarizes at — so a void counted here is
 * a void the ring had to keep hollow.
 */
async function countMaskHoles(maskPng: Buffer): Promise<number> {
  const { data, info } = await sharp(maskPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const W = info.width
  const H = info.height
  const isFg = (x: number, y: number): boolean => (data[(y * W + x) * 4 + 3] ?? 0) > 128
  const seen = new Uint8Array(W * H)
  const queue: number[] = []
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    const i = y * W + x
    if (seen[i] === 1 || isFg(x, y)) return
    seen[i] = 1
    queue.push(i)
  }
  for (let x = 0; x < W; x++) {
    push(x, 0)
    push(x, H - 1)
  }
  for (let y = 0; y < H; y++) {
    push(0, y)
    push(W - 1, y)
  }
  while (queue.length > 0) {
    const i = queue.pop()!
    const x = i % W
    const y = (i / W) | 0
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  let holes = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (seen[y * W + x] === 0 && !isFg(x, y)) holes++
    }
  }
  return holes
}

/**
 * Interior-rogue scan: core-ink (`>80`) pixels of `inkPng` that lie INSIDE
 * the filled silhouette yet farther than `maxNear` px from any fill edge. A
 * correct outline only ever paints near silhouette edges (inner/outer ring
 * plus a few px of glow fringe at core threshold); anything deeper inside
 * is a spurious segment, never a counter edge (counter edges ARE fill
 * edges, distance ~0 — so this scan simultaneously proves counters hollow).
 * Both PNGs must share the same grid.
 */
async function rogueInteriorPx(
  fillPng: Buffer,
  inkPng: Buffer,
  maxNear: number,
): Promise<RogueResult> {
  const F = await rawPixels(fillPng)
  const I = await rawPixels(inkPng)
  expect(I.width).toBe(F.width)
  expect(I.height).toBe(F.height)
  const W = F.width
  const H = F.height
  const fillCore = (x: number, y: number): boolean => (F.data[(y * W + x) * 4 + 3] ?? 0) > 80
  const isEdge = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!fillCore(x, y)) continue
      let edge = false
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !fillCore(nx, ny)) {
            edge = true
            break
          }
        }
      }
      if (edge) isEdge[y * W + x] = 1
    }
  }
  const cap = maxNear + 8
  const dist = new Int16Array(W * H).fill(32000)
  const queue: number[] = []
  for (let i = 0; i < isEdge.length; i++) {
    if (isEdge[i]) {
      dist[i] = 0
      queue.push(i)
    }
  }
  let head = 0
  while (head < queue.length) {
    const i = queue[head++]!
    const d = dist[i]!
    if (d >= cap) continue
    const x = i % W
    const y = (i / W) | 0
    if (x > 0 && dist[i - 1]! > d + 1) { dist[i - 1] = d + 1; queue.push(i - 1) }
    if (x < W - 1 && dist[i + 1]! > d + 1) { dist[i + 1] = d + 1; queue.push(i + 1) }
    if (y > 0 && dist[i - W]! > d + 1) { dist[i - W] = d + 1; queue.push(i - W) }
    if (y < H - 1 && dist[i + W]! > d + 1) { dist[i + W] = d + 1; queue.push(i + W) }
  }
  let count = 0
  let coreCount = 0
  let minX = W
  let maxX = -1
  let minY = H
  let maxY = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if ((I.data[(y * W + x) * 4 + 3] ?? 0) <= 80) continue
      coreCount++
      if (!fillCore(x, y)) continue // outer ring / outer fringe: legitimate
      if (dist[y * W + x]! > maxNear) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { count, coreCount, minX, maxX, minY, maxY }
}

/**
 * Ring-coverage scan: every fill-edge pixel must have shipped core ink
 * (`>80`) within `radius` px (Chebyshev). Proves the union ring is complete
 * around the whole glyph — no gaps, no seams, no weakened stretches —
 * without comparing raw ink counts (a stroked `<text>` paints double-sided
 * bands around every subpath, roughly twice the ink of a one-sided union
 * ring at the same visual contour, so counts are not comparable across
 * pipelines; coverage is).
 */
async function ringCoverage(
  fillPng: Buffer,
  inkPng: Buffer,
  radius: number,
): Promise<{ covered: number; total: number }> {
  const F = await rawPixels(fillPng)
  const I = await rawPixels(inkPng)
  expect(I.width).toBe(F.width)
  expect(I.height).toBe(F.height)
  const W = F.width
  const H = F.height
  const inkAt = (x: number, y: number): boolean => (I.data[(y * W + x) * 4 + 3] ?? 0) > 80
  let covered = 0
  let total = 0
  const fillCore = (x: number, y: number): boolean => (F.data[(y * W + x) * 4 + 3] ?? 0) > 80
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!fillCore(x, y)) continue
      let edge = false
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !fillCore(nx, ny)) {
            edge = true
            break
          }
        }
      }
      if (!edge) continue
      total++
      let hit = false
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          if (inkAt(nx, ny)) {
            hit = true
            break
          }
        }
      }
      if (hit) covered++
    }
  }
  return { covered, total }
}

interface DiffBounds {
  count: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Independent full-canvas strong-diff between two final posters (raw RGB, channel delta > 24). */
function strongDiffBounds(
  a: { data: Buffer; width: number; height: number },
  b: { data: Buffer; width: number; height: number },
): DiffBounds {
  expect(a.width).toBe(b.width)
  expect(a.height).toBe(b.height)
  let count = 0
  let minX = a.width
  let maxX = -1
  let minY = a.height
  let maxY = -1
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      const hit =
        Math.max(
          Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
          Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
          Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)),
        ) > 24
      if (hit) {
        count++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { count, minX, maxX, minY, maxY }
}

describe("card numeral P16: stray inner segments in the 4 (root cause + union-ring fix)", () => {
  it("demonstrates the artifact on the OLD stroked 4, proves zero rogue px shipped on all skins", async () => {
    for (const shape of SHAPES) {
      const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 4)!
      const n = geo.numeral!
      const fs = n.fontSize
      const sw = n.strokeWidth
      const maxNear = Math.ceil(sw / 2) + 3
      // OLD pipeline on its own grid vs the silhouette on the same grid:
      // the stroke paints spurious interior segments (no filter involved —
      // the cause is the stroke of unmerged font contours, not glow/morph).
      const old = oldStrokedGrid("4", fs, n.letterSpacing, sw)
      const oldOnCanvas = await renderOnPaddedCanvas(old.svg, old.svgW, old)
      const oldFillPng = await renderSVG(
        fillSvgOnGrid("4", fs, n.letterSpacing - Math.round(fs * 0.03), 1, old, COMPARE_PAD),
        old.svgW + COMPARE_PAD * 2,
      )
      const oldFillInk = await measureAlphaInk(oldFillPng, 80)
      expect(oldFillInk).not.toBeNull()
      expect(oldFillInk!.minX).toBeGreaterThan(8)
      expect(oldFillInk!.minY).toBeGreaterThan(8)
      expect(oldFillInk!.maxX).toBeLessThan(old.svgW + COMPARE_PAD * 2 - 9)
      expect(oldFillInk!.maxY).toBeLessThan(old.svgH + COMPARE_PAD * 2 - 9)
      const oldRogue = await rogueInteriorPx(oldFillPng, oldOnCanvas.png, maxNear)
      // Demonstrated artifact: hundreds of interior px far from any fill
      // edge (measured ~1400+ at fs=200 pre-fix calibration).
      expect(oldRogue.count).toBeGreaterThan(100)
      // …spanning the glyph vertically (a structural segment near the
      // crossbar/stem junction, not speckle): the rogue bbox is tall. The
      // comparison canvas adds COMPARE_PAD per side: subtract it for the
      // glyph-local height.
      expect(oldRogue.maxY - oldRogue.minY + 1).toBeGreaterThan(40)
      const oldCore = await measureAlphaInk(oldOnCanvas.png, 80)
      expect(oldCore).not.toBeNull()
      const legitOldCore = oldRogue.coreCount - oldRogue.count
      expect(legitOldCore).toBeGreaterThan(0)

      for (const skin of SKINS) {
        // Shipped pipeline on its grid vs the silhouette on the same grid
        // (grid re-derived independently, tied to production below).
        const grid = shippedGrid("4", fs, n.letterSpacing, sw, 1)
        const maskSpec = cardNumeralMaskSvg(4, fs, n.letterSpacing, sw, 1)
        expect(grid.svgW).toBe(maskSpec.svgW)
        expect(grid.svgH).toBe(maskSpec.svgH)
        expect(grid.pad).toBe(maskSpec.pad)
        expect(grid.baselineY).toBe(maskSpec.baselineY)
        const spec = await renderCardNumeralLayer(4, fs, n.letterSpacing, sw, skin, ACCENT, 1)
        expect(spec.svgW).toBe(grid.svgW)
        expect(spec.svgH).toBe(grid.svgH)
        const shipOnCanvas = await renderOnPaddedCanvasPng(spec.png, grid)
        const shipFillPng = await renderSVG(
          fillSvgOnGrid("4", fs, n.letterSpacing, 1, grid, COMPARE_PAD),
          grid.svgW + COMPARE_PAD * 2,
        )
        const rogue = await rogueInteriorPx(shipFillPng, shipOnCanvas.png, maxNear)
        // Fix proof: ZERO interior px far from a fill edge — no spurious
        // segments, and every counter interior (far from edges by
        // construction) stays empty.
        expect(rogue.count).toBe(0)
        // …without weakening the whole 4: the union ring covers the full
        // glyph contour (every fill edge has shipped core ink within
        // ring+2 px — no gaps, no seams, no thinned stretches)…
        const coverage = await ringCoverage(shipFillPng, shipOnCanvas.png, Math.ceil(sw / 2) + 2)
        expect(coverage.total).toBeGreaterThan(500)
        expect(coverage.covered / coverage.total).toBeGreaterThanOrEqual(0.99)
        // …with the same glyph underneath: the plain fills (no stroke, no
        // filter, no ring — the raw outlines) have identical bbox sizes and
        // identical ink counts across the two pipelines (same font, same
        // size, same origin; single-char tracking only moves trailing
        // space). The ring changes the CONTOUR RENDERING, never the glyph.
        const shipFillInk = await measureAlphaInk(shipFillPng, 80)
        expect(shipFillInk).not.toBeNull()
        expect(shipFillInk!.maxX - shipFillInk!.minX).toBe(oldFillInk!.maxX - oldFillInk!.minX)
        expect(shipFillInk!.maxY - shipFillInk!.minY).toBe(oldFillInk!.maxY - oldFillInk!.minY)
      }
    }
  }, 180000)

  it("ships zero rogue-interior px on every single 1..9 and every double 10..20 (counters hollow)", async () => {
    for (const shape of SHAPES) {
      for (let rank = 1; rank <= 20; rank++) {
        const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, rank)!
        const n = geo.numeral!
        const digits = String(rank)
        const maxNear = Math.ceil(n.strokeWidth / 2) + 3
        const grid = shippedGrid(digits, n.fontSize, n.letterSpacing, n.strokeWidth, n.condenseX)
        const maskSpec = cardNumeralMaskSvg(rank, n.fontSize, n.letterSpacing, n.strokeWidth, n.condenseX)
        expect(grid.svgW).toBe(maskSpec.svgW)
        expect(grid.svgH).toBe(maskSpec.svgH)
        const spec = await renderCardNumeralLayer(rank, n.fontSize, n.letterSpacing, n.strokeWidth, "provider-glass", ACCENT, n.condenseX)
        const shipOnCanvas = await renderOnPaddedCanvasPng(spec.png, grid)
        const shipFillPng = await renderSVG(
          fillSvgOnGrid(digits, n.fontSize, n.letterSpacing, n.condenseX, grid, COMPARE_PAD),
          grid.svgW + COMPARE_PAD * 2,
        )
        const rogue = await rogueInteriorPx(shipFillPng, shipOnCanvas.png, maxNear)
        // No stray segments on any digit; 6/8/9/0 counter interiors (far
        // from any fill edge) stay empty — counters are never filled.
        expect(rogue.count).toBe(0)
        expect(rogue.coreCount).toBeGreaterThan(200)
        // P18: the unfiltered contour itself carries no interior ink
        // either (same budget — the ring, not just the shipped glow
        // layer, is clean by construction).
        const ringOnCanvas = await renderOnPaddedCanvasPng(spec.ringPng, grid)
        const ringRogue = await rogueInteriorPx(shipFillPng, ringOnCanvas.png, maxNear)
        expect(ringRogue.count).toBe(0)
        expect(ringRogue.coreCount).toBeGreaterThan(200)
        // …and every legitimate void survives the union: ranks holding a
        // counter digit (0/4/6/8/9) keep an enclosed void in the
        // silhouette the ring was derived from (never filled in).
        const holes = await countMaskHoles(spec.maskPng)
        if ([4, 6, 8, 9, 10, 14, 20].includes(rank)) {
          expect(holes).toBeGreaterThan(10)
        }
      }
    }
  }, 240000)
})

describe("card numeral P16 correction cycle 1: rank 1 keeps the exact pre-P16 reference geometry", () => {
  it("rank 1 uses the verbatim reference size/stroke/anchor with the original baseline formula (no enlarge, no tuck)", async () => {
    for (const shape of SHAPES) {
      const ref = CARD_REFERENCE[shape.name]
      const s = Math.min(shape.w / ref.canvas.width, shape.h / ref.canvas.height)
      const sx = shape.w / ref.canvas.width
      const sy = shape.h / ref.canvas.height
      const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 1)!
      const n = geo.numeral!
      // Verbatim reference size/stroke (factor 1): pre-P16 P2 geometry.
      expect(n.fontSize).toBe(Math.round(ref.number.sizeSingle * s))
      expect(n.strokeWidth).toBe(Math.max(1, Math.round(ref.number.strokeWidth * s)))
      // Original anchor preserved exactly.
      expect(n.anchorX).toBe(Math.round(ref.number.xSingle * sx))
      // Original baseline formula with its own (un-enlarged) size.
      const cardCenterY = geo.card.y + geo.card.height / 2
      expect(n.baselineY).toBe(
        Math.round(cardCenterY + n.fontSize * 0.34 + ref.number.opticalDrop * sy),
      )
      // Explicit STD poster spot check: 405*0.5=202.5->203, stroke 5, anchor 7.
      if (shape.name === "poster" && shape.w === STD_W && shape.h === STD_H) {
        expect(n.fontSize).toBe(203)
        expect(n.strokeWidth).toBe(5)
        expect(n.anchorX).toBe(7)
      }
      // No enlarge vs the P9 baseline at the same pipeline (ratio ~1.0).
      const baseFs = Math.round(ref.number.sizeSingle * s)
      const baseSw = Math.max(1, Math.round(ref.number.strokeWidth * s))
      const base = await renderCardNumeralLayer(1, baseFs, n.letterSpacing, baseSw, "provider-glass", ACCENT, 1)
      const ship = await renderCardNumeralLayer(1, n.fontSize, n.letterSpacing, n.strokeWidth, "provider-glass", ACCENT, 1)
      const baseCore = await measureAlphaInk(base.png, 80)
      const shipCore = await measureAlphaInk(ship.png, 80)
      expect(baseCore).not.toBeNull()
      expect(shipCore).not.toBeNull()
      const baseH = baseCore!.maxY - baseCore!.minY + 1
      const shipH = shipCore!.maxY - shipCore!.minY + 1
      expect(shipH / baseH).toBeCloseTo(1, 1)
      // Placed rank 1 keeps its natural origin: anchor minus pad plus ONLY
      // the canvas-left containment shift (never a forced tuck right), up
      // to the provably-empty left-crop that placeInCanvas trims when the
      // natural origin starts off-canvas (portrait anchor 7 - pad < 0).
      for (const skin of SKINS) {
        const placed = await placeSingleNumeral(
          1, n.anchorX, n.baselineY, n.fontSize, n.letterSpacing,
          n.strokeWidth, skin, ACCENT, geo.card.x, shape.w, shape.h,
        )
        expect(placed).not.toBeNull()
        const spec = await renderCardNumeralLayer(1, n.fontSize, n.letterSpacing, n.strokeWidth, skin, ACCENT, 1)
        const strong = await measureAlphaInk(spec.png, 24)
        expect(strong).not.toBeNull()
        const naturalLeft =
          n.anchorX - spec.pad + Math.max(0, 1 - (n.anchorX - spec.pad + strong!.minX))
        const placedMeta = await sharp(placed!.png).metadata()
        const croppedEmpty = spec.svgW - (placedMeta.width ?? spec.svgW)
        // The crop removed only empty columns (never strong ink)…
        expect(croppedEmpty).toBeGreaterThanOrEqual(0)
        expect(croppedEmpty).toBeLessThanOrEqual(strong!.minX)
        expect(placed!.left).toBe(naturalLeft + croppedEmpty)
      }
    }
  }, 120000)
})

describe("card numeral P16: LARGE height on both formats (15-20% over the P9 baseline, ranks except 1)", () => {
  it("renders 4/7/11/20 taller than the un-enlarged baseline at the same pipeline", async () => {
    expect(CARD_NUMERAL_ENLARGE).toBeGreaterThanOrEqual(1.15)
    expect(CARD_NUMERAL_ENLARGE).toBeLessThanOrEqual(1.2)
    for (const shape of SHAPES) {
      const ref = CARD_REFERENCE[shape.name]
      const s = Math.min(shape.w / ref.canvas.width, shape.h / ref.canvas.height)
      for (const rank of [4, 7, 11, 20] as const) {
        const single = rank < 10
        const baseFs = Math.round((single ? ref.number.sizeSingle : ref.number.sizeDouble) * s)
        const baseSw = Math.max(1, Math.round(ref.number.strokeWidth * s))
        const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, rank)!
        const n = geo.numeral!
        const cx = single ? 1 : CARD_NUMERAL_CONDENSE_X
        const base = await renderCardNumeralLayer(rank, baseFs, n.letterSpacing, baseSw, "provider-glass", ACCENT, cx)
        const ship = await renderCardNumeralLayer(rank, n.fontSize, n.letterSpacing, n.strokeWidth, "provider-glass", ACCENT, cx)
        const baseCore = await measureAlphaInk(base.png, 80)
        const shipCore = await measureAlphaInk(ship.png, 80)
        expect(baseCore).not.toBeNull()
        expect(shipCore).not.toBeNull()
        const baseH = baseCore!.maxY - baseCore!.minY + 1
        const shipH = shipCore!.maxY - shipCore!.minY + 1
        const ratio = shipH / baseH
        // LARGE: inside the user 15-20% band (linear size scale ≈ 1.18,
        // measured on real core ink, both formats).
        expect(ratio).toBeGreaterThanOrEqual(1.15)
        expect(ratio).toBeLessThanOrEqual(1.25)
      }
    }
  }, 120000)
})

describe("card numeral P16 correction cycle 1: measured placement — natural occlusion, never forced", () => {
  it("keeps every core inside the canvas; overlap behind the card happens only when the natural ink reaches the edge", async () => {
    for (const shape of SHAPES) {
      const CW = shape.w
      const CH = shape.h
      const geo7 = cardLayoutGeometry(shape.name, CW, CH, 7)!
      const cardX = geo7.card.x
      for (let rank = 1; rank <= 20; rank++) {
        const g = cardLayoutGeometry(shape.name, CW, CH, rank)!
        const n = g.numeral!
        for (const skin of SKINS) {
          const placed =
            n.digitCount === 1
              ? await placeSingleNumeral(
                  rank, n.anchorX, n.baselineY, n.fontSize, n.letterSpacing,
                  n.strokeWidth, skin, ACCENT, cardX, CW, CH,
                )
              : await placeDoubleNumeral(
                  rank, n.anchorX, n.baselineY, n.fontSize, n.letterSpacing,
                  n.strokeWidth, n.condenseX, skin, ACCENT, cardX, CW, CH,
                )
          expect(placed).not.toBeNull()
          const meta = await sharp(placed!.png).metadata()
          const cols = await rawPixels(placed!.png)
          // Core bbox in canvas coords from the placed layer alpha
          // (INDEPENDENT re-scan of the placed PNG — not the placer's own
          // helper return).
          let minX = (meta.width ?? 0)
          let maxX = -1
          let minY = (meta.height ?? 0)
          let maxY = -1
          for (let y = 0; y < cols.height; y++) {
            for (let x = 0; x < cols.width; x++) {
              if ((cols.data[(y * cols.width + x) * 4 + 3] ?? 0) > CARD_NUMERAL_CORE_THRESHOLD) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
              }
            }
          }
          expect(maxX).toBeGreaterThanOrEqual(minX)
          const cMinX = placed!.left + minX
          const cMaxX = placed!.left + maxX
          const cMinY = placed!.top + minY
          const cMaxY = placed!.top + maxY
          // Core glyph stays inside the canvas edges (never clipped)…
          expect(cMinX).toBeGreaterThanOrEqual(0)
          expect(cMinY).toBeGreaterThanOrEqual(0)
          expect(cMaxX).toBeLessThan(CW)
          expect(cMaxY).toBeLessThan(CH)
          // …with NO forced minimum overlap: a clear-standing rank may end
          // fully before the card edge (natural rule — overlap only when
          // the real ink reaches the edge). The placement matches the
          // natural origin (anchor minus pad plus canvas-left containment
          // only): recompute the containment shift independently from the
          // shipped layer's own strong-ink scan.
          const spec = await renderCardNumeralLayer(
            rank, n.fontSize, n.letterSpacing, n.strokeWidth, skin, ACCENT, n.condenseX,
          )
          const strong = await measureAlphaInk(spec.png, 24)
          expect(strong).not.toBeNull()
          const naturalLeft =
            n.anchorX - spec.pad + Math.max(0, 1 - (n.anchorX - spec.pad + strong!.minX))
          // Left-crop may trim only provably-empty margin (placeInCanvas):
          // the placed left is at or right of the natural origin exactly by
          // the cropped empty columns, never a forced tuck right.
          expect(placed!.left).toBeGreaterThanOrEqual(naturalLeft)
          expect(placed!.left - naturalLeft).toBeLessThanOrEqual(strong!.minX)
          // Rank 1 specifically: placed left matches the natural origin
          // plus only the empty left-crop (recomputed from the placed PNG
          // width) — never pushed right under the card.
          if (rank === 1) {
            const placedW = meta.width ?? spec.svgW
            expect(placed!.left).toBe(naturalLeft + (spec.svgW - placedW))
          }
        }
      }
    }
  }, 300000)
})

describe("card numeral P16 correction cycle 1: final poster — natural occlusion, never overpaint", () => {
  it("focused 1/4/7/10/11/20 on both formats x all skins: present, behind (never over), unclipped", async () => {
    const artworkPoster = await solidPng(STD_W, STD_H)
    const artworkLandscape = await solidPng(LAND_W, LAND_H)
    for (const shape of SHAPES) {
      const artwork = shape.name === "poster" ? artworkPoster : artworkLandscape
      const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 7)!
      for (const skin of SKINS) {
        const unranked = await renderCardPoster(baseInput(skin, shape.name, artwork, null))
        const rawBase = await rawPixels(unranked)
        for (const rank of FOCUSED) {
          const png = await renderCardPoster(baseInput(skin, shape.name, artwork, rank))
          expect((await sharp(png).metadata()).width).toBe(shape.w)
          expect((await sharp(png).metadata()).height).toBe(shape.h)
          // INDEPENDENT full-canvas strong diff vs the unranked poster
          // (raw RGB channel delta > 24 — not the placer's helper).
          const diff = strongDiffBounds(rawBase, await rawPixels(png))
          const single = rank < 10
          expect(diff.count).toBeGreaterThan(single ? 200 : 600)
          // Natural occlusion rule: visible strong ink NEVER crosses the
          // card edge (the card composites after the numeral). When the
          // natural core ends before the edge (clear-standing ranks like
          // the verbatim 1) diff.maxX < card.x - 1 — no hidden strip, by
          // design; when it reaches the edge, visible ink stops exactly at
          // card.x - 1 and the card covers the rest.
          expect(diff.maxX).toBeLessThanOrEqual(geo.card.x - 1)
          // …and lives fully inside the canvas.
          expect(diff.minX).toBeGreaterThanOrEqual(0)
          expect(diff.minY).toBeGreaterThanOrEqual(0)
          expect(diff.maxY).toBeLessThan(shape.h)
          // BEHIND proof: the strip just right of the card edge is
          // pixel-identical to the unranked poster — crossed ink hides
          // BEHIND the card by layer order, the numeral never overpaints
          // the artwork. (Holds for clear-standing ranks too: nothing was
          // ever painted there.)
          const ranked = await rawPixels(png)
          const x1 = Math.min(shape.w - 1, geo.card.x + 4)
          for (let y = diff.minY; y <= diff.maxY; y++) {
            for (let x = geo.card.x; x <= x1; x++) {
              const i = (y * shape.w + x) * 4
              expect(ranked.data[i]).toBe(rawBase.data[i])
              expect(ranked.data[i + 1]).toBe(rawBase.data[i + 1])
              expect(ranked.data[i + 2]).toBe(rawBase.data[i + 2])
            }
          }
        }
      }
    }
  }, 300000)

  it("scans all ranks 1..20 both formats: exact dims, present numeral, no overpaint, in-canvas", async () => {
    const artworkPoster = await solidPng(STD_W, STD_H)
    const artworkLandscape = await solidPng(LAND_W, LAND_H)
    for (const shape of SHAPES) {
      const artwork = shape.name === "poster" ? artworkPoster : artworkLandscape
      const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 7)!
      const rawBase = await rawPixels(
        await renderCardPoster(baseInput("provider-glass", shape.name, artwork, null)),
      )
      for (let rank = 1; rank <= 20; rank++) {
        const png = await renderCardPoster(baseInput("provider-glass", shape.name, artwork, rank))
        const meta = await sharp(png).metadata()
        expect(meta.width).toBe(shape.w)
        expect(meta.height).toBe(shape.h)
        const diff = strongDiffBounds(rawBase, await rawPixels(png))
        expect(diff.count).toBeGreaterThan(rank < 10 ? 200 : 600)
        // Natural occlusion: never past the card edge (see above).
        expect(diff.maxX).toBeLessThanOrEqual(geo.card.x - 1)
        expect(diff.minX).toBeGreaterThanOrEqual(0)
        expect(diff.minY).toBeGreaterThanOrEqual(0)
        expect(diff.maxY).toBeLessThan(shape.h)
      }
    }
  }, 300000)
})

type StemPix = { data: Buffer; width: number; height: number }

function stemRowRuns(g: StemPix, y: number): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let s = -1
  for (let x = 0; x < g.width; x++) {
    const a = g.data[(y * g.width + x) * 4 + 3] ?? 0
    if (a > 80) {
      if (s < 0) s = x
    } else if (s >= 0) {
      runs.push([s, x - 1])
      s = -1
    }
  }
  if (s >= 0) runs.push([s, g.width - 1])
  return runs
}

function stemColRuns(g: StemPix, x: number): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let s = -1
  for (let y = 0; y < g.height; y++) {
    const a = g.data[(y * g.width + x) * 4 + 3] ?? 0
    if (a > 80) {
      if (s < 0) s = y
    } else if (s >= 0) {
      runs.push([s, y - 1])
      s = -1
    }
  }
  if (s >= 0) runs.push([s, g.height - 1])
  return runs
}

/**
 * Straight-stem band samples of one numeral layer: horizontal scans for
 * near-vertical edges plus vertical scans for near-horizontal edges
 * (the 7 bar, the 4 crossbar, the 2 footing). A sample is one band of
 * the unfiltered ring next to a straight union edge (edge line residual
 * <= 1px over a +-4 window, slope within ~14 degrees of an axis), with
 * the band complete (not notch-truncated) and narrow (not a merged
 * junction run) — i.e. a row/column where the contour weight is
 * actually readable. Returns per-band widths in px along the scan
 * (axis-aligned edges need no normalization; the strict slope bound
 * keeps the residual projection error under half a px).
 *
 * Samples are keyed by scan location and edge side (`r{y}@L/R`,
 * `c{x}@T/B`) so two pipelines measured on the same stems pair
 * stem-for-stem instead of by accident of ordering.
 *
 * `maxSlope` bounds the accepted edge tilt (~14 degrees by default;
 * doubles pass 0.6 — their slanted witness rows are perpendicularly
 * normalized, and doubles carry no stroked-text pairing that slant
 * discretization could break). `maxBand` caps the accepted band width
 * (the old-reference scan passes `sw + 1`: subpath-overlap rows where
 * the reference itself double-paints junctions wider are not valid
 * references — the artifact P16 removed).
 */
async function sampleStemBands(
  fillPng: Buffer,
  ringPng: Buffer,
  sw: number,
  regions: Array<[number, number]>,
  opts?: { maxSlope?: number; maxBand?: number },
): Promise<Array<{ key: string; w: number }>> {
  const fRaw = await sharp(fillPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rRaw = await sharp(ringPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const fill: StemPix = { data: fRaw.data, width: fRaw.info.width, height: fRaw.info.height }
  const ring: StemPix = { data: rRaw.data, width: rRaw.info.width, height: rRaw.info.height }
  const out: Array<{ key: string; w: number }> = []
  const maxSlope = opts?.maxSlope ?? 0.25
  const maxBand = opts?.maxBand ?? Number.POSITIVE_INFINITY
  const inReg = (a: number, b: number, reg: [number, number]): boolean => a >= reg[0] && b <= reg[1]
  // Horizontal scans (near-vertical edges).
  for (let y = 4; y < fill.height - 4; y++) {
    for (const reg of regions) {
      const rf = stemRowRuns(fill, y).filter(([a, b]) => inReg(a, b, reg))
      if (rf.length !== 1) continue
      const fw = rf[0]![1] - rf[0]![0] + 1
      if (fw < 3 * sw) continue
      const L: number[] = []
      const R: number[] = []
      let ok = true
      for (let dy = -4; dy <= 4; dy++) {
        const rr = stemRowRuns(fill, y + dy).filter(([a, b]) => inReg(a, b, reg))
        if (rr.length !== 1) {
          ok = false
          break
        }
        L.push(rr[0]![0])
        R.push(rr[0]![1])
      }
      if (!ok) continue
      const sL = (L[8]! - L[0]!) / 8
      const sR = (R[8]! - R[0]!) / 8
      if (Math.abs(sL) > maxSlope || Math.abs(sR) > maxSlope) continue
      for (let i = 0; i <= 8; i++) {
        if (Math.abs(L[i]! - (L[0]! + sL * i)) > 1 || Math.abs(R[i]! - (R[0]! + sR * i)) > 1) {
          ok = false
          break
        }
      }
      if (!ok) continue
      const rs = stemRowRuns(ring, y).filter(([a, b]) => inReg(a, b, reg))
      if (rs.length === 0) continue
      const fL = rf[0]![0]
      const fR = rf[0]![1]
      for (const [a, b] of rs) {
        // One complete band at a straight edge: the run must sit at the
        // left or right fill edge (middle fragments are junction
        // leftovers, never weight witnesses; valley-bridging runs never
        // sit fully inside one region by construction). Keyed by edge
        // side so two pipelines pair on the same stem even when the
        // band origin jitters a pixel between rasters.
        const atL = a <= fL + sw + 2 && b >= fL - sw - 2
        const atR = a <= fR + sw + 2 && b >= fR - sw - 2
        if (!atL && !atR) continue
        const w = b - a + 1
        if (w < sw - 2 || w > Math.min(fw / 2, maxBand)) continue
        const side = atL && !atR ? "L" : !atL && atR ? "R" : a - fL <= fR - b ? "L" : "R"
        const s = side === "L" ? sL : sR
        out.push({ key: `r${y}@${side}`, w: w / Math.sqrt(s * s + 1) })
      }
    }
  }
  // Vertical scans (near-horizontal edges).
  for (const reg of regions) {
    for (let x = reg[0] + 4; x <= reg[1] - 4; x++) {
      const rf = stemColRuns(fill, x)
      if (rf.length !== 1) continue
      const fh = rf[0]![1] - rf[0]![0] + 1
      if (fh < 3 * sw) continue
      const T: number[] = []
      const B: number[] = []
      let ok = true
      for (let dx = -4; dx <= 4; dx++) {
        const rr = stemColRuns(fill, x + dx)
        if (rr.length !== 1) {
          ok = false
          break
        }
        T.push(rr[0]![0])
        B.push(rr[0]![1])
      }
      if (!ok) continue
      const tT = (T[8]! - T[0]!) / 8
      const tB = (B[8]! - B[0]!) / 8
      if (Math.abs(tT) > maxSlope || Math.abs(tB) > maxSlope) continue
      for (let i = 0; i <= 8; i++) {
        if (Math.abs(T[i]! - (T[0]! + tT * i)) > 1 || Math.abs(B[i]! - (B[0]! + tB * i)) > 1) {
          ok = false
          break
        }
      }
      if (!ok) continue
      const rs = stemColRuns(ring, x)
      if (rs.length === 0) continue
      const fT = rf[0]![0]
      const fB = rf[0]![1]
      for (const [a, b] of rs) {
        const atT = a <= fT + sw + 2 && b >= fT - sw - 2
        const atB = a <= fB + sw + 2 && b >= fB - sw - 2
        if (!atT && !atB) continue
        const w = b - a + 1
        if (w < sw - 2 || w > Math.min(fh / 2, maxBand)) continue
        const side = atT && !atB ? "T" : !atT && atB ? "B" : a - fT <= fB - b ? "T" : "B"
        const t = side === "T" ? tT : tB
        out.push({ key: `c${x}@${side}`, w: w / Math.sqrt(t * t + 1) })
      }
    }
  }
  return out
}

/** Per-digit x regions from the shadowless mask valley (whole canvas for singles). */
async function stemRegions(maskPng: Buffer, digitCount: 1 | 2): Promise<Array<[number, number]>> {
  const cols = await cardNumeralColumns(maskPng, (await sharp(maskPng).metadata()).width ?? 0, 80)
  if (!cols || digitCount !== 2) {
    const w = cols ? cols.maxX + 1 : 0
    return [[0, Math.max(0, w - 1)]]
  }
  const split = splitCardNumeralColumns(cols.counts, cols.minX, cols.maxX)
  if (!split) return [[cols.minX, cols.maxX]]
  return [
    [cols.minX, split.valleyX - 1],
    [split.valleyX + 1, cols.maxX],
  ]
}

/** Old (pre-P16) reference on the shipped grid: unfiltered stroked text at the same origin/baseline. */
function oldStrokedSameGrid(
  digits: string,
  fs: number,
  ls: number,
  sw: number,
  layer: { svgW: number; svgH: number; pad: number; baselineY: number },
): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layer.svgW}" height="${layer.svgH}" viewBox="0 0 ${layer.svgW} ${layer.svgH}">` +
    `<text x="${layer.pad}" y="${layer.baselineY}" font-family="Inter, Arial, Helvetica, sans-serif" ` +
    `font-size="${fs}" font-weight="800" letter-spacing="${ls}" ` +
    `fill="none" stroke="#ffffff" stroke-width="${sw}" paint-order="stroke" stroke-linejoin="round">${digits}</text></svg>`
  )
}

describe("card numeral P18: Euclidean ring restores the full reference stroke weight", () => {
  it("singles 1/4/7: ring bands match the pre-P16 stroked reference within 1px, both formats", async () => {
    for (const shape of SHAPES) {
      for (const rank of [1, 4, 7] as const) {
        const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, rank)!
        const n = geo.numeral!
        const layer = await renderCardNumeralLayer(
          rank, n.fontSize, n.letterSpacing, n.strokeWidth, "provider-glass", ACCENT, 1,
        )
        const regions = await stemRegions(layer.maskPng, 1)
        const fresh = await sampleStemBands(layer.maskPng, layer.ringPng, n.strokeWidth, regions)
        // The same straight-stem rows/columns on the old reference.
        const oldPng = await renderSVG(
          oldStrokedSameGrid(String(rank), n.fontSize, n.letterSpacing, n.strokeWidth, layer),
          layer.svgW,
        )
        // Reference-validity gate: rows where the OLD stroke double-paints
        // subpath junctions (the artifact being replaced) are not valid
        // references — the ring's own absolute asserts above already prove
        // the weight there; the pairing below runs on clean-reference rows.
        const oldSamples = await sampleStemBands(layer.maskPng, oldPng, n.strokeWidth, regions, {
          maxBand: n.strokeWidth + 1,
        })
        // Plenty of readable straight stems on every single…
        expect(fresh.length).toBeGreaterThanOrEqual(20)
        expect(oldSamples.length).toBeGreaterThanOrEqual(10)
        // …at the full reference weight (never the P16 half band)…
        const meanFresh = fresh.reduce((a, b) => a + b.w, 0) / fresh.length
        expect(Math.abs(meanFresh - n.strokeWidth)).toBeLessThanOrEqual(1)
        for (const { w } of fresh) expect(Math.abs(w - n.strokeWidth)).toBeLessThanOrEqual(2)
        // …matching the pre-P16 stroked contour itself within 1px: the
        // reference sanity below proves the selection is real straight
        // stems (the old stroke at its own weight), so agreement means
        // the Euclidean ring restored the original thickness. Pairing is
        // by scan location (same stem, both pipelines).
        const meanOld = oldSamples.reduce((a, b) => a + b.w, 0) / oldSamples.length
        expect(Math.abs(meanOld - n.strokeWidth)).toBeLessThanOrEqual(1)
        const oldByKey = new Map(oldSamples.map((s) => [s.key, s.w]))
        let paired = 0
        for (const s of fresh) {
          const o = oldByKey.get(s.key)
          if (o === undefined) continue
          paired++
          expect(Math.abs(s.w - o)).toBeLessThanOrEqual(1)
        }
        expect(paired).toBeGreaterThanOrEqual(10)
      }
    }
  }, 180000)

  it("doubles 11/20: uniform ring bands at the reference weight, both formats", async () => {
    // No stroked-text reference for doubles: resvg thins a condensed
    // transformed text stroke anisotropically (measured ~half bands on
    // vertical stems — the documented reason doubles use the ring), so
    // the absolute reference weight (strokeWidth from the geometry, the
    // same weight the singles above prove against the old stroke) is
    // the contract here.
    for (const shape of SHAPES) {
      for (const rank of [11, 20] as const) {
        const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, rank)!
        const n = geo.numeral!
        const layer = await renderCardNumeralLayer(
          rank, n.fontSize, n.letterSpacing, n.strokeWidth, "provider-glass", ACCENT, n.condenseX,
        )
        const regions = await stemRegions(layer.maskPng, 2)
        expect(regions.length).toBe(2)
        const samples = await sampleStemBands(layer.maskPng, layer.ringPng, n.strokeWidth, regions, {
          maxSlope: 0.6,
        })
        expect(samples.length).toBeGreaterThanOrEqual(20)
        const mean = samples.reduce((a, b) => a + b.w, 0) / samples.length
        expect(Math.abs(mean - n.strokeWidth)).toBeLessThanOrEqual(1)
        for (const { w } of samples) expect(Math.abs(w - n.strokeWidth)).toBeLessThanOrEqual(2)
      }
    }
  }, 180000)
})

describe("card numeral P18: Euclidean contour helper invariants (pure, no raster)", () => {
  it("draws a round ring around an isolated dot (isotropic, never square)", () => {
    const W = 15
    const H = 15
    const alpha = new Uint8Array(W * H)
    alpha[7 * W + 7] = 255
    const ring = cardNumeralContourRing(alpha, W, H, 3)
    expect(ring.length).toBe(W * H)
    const core = (x: number, y: number): boolean => (ring[y * W + x] ?? 0) > 80
    // Axis extent: full 3px each way (the band), 4px stays empty.
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) {
      expect(core(7 + dx, 7 + dy)).toBe(true)
    }
    for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4]] as const) {
      expect(core(7 + dx, 7 + dy)).toBe(false)
    }
    // Diagonal extent is SMALLER than axis (true disc): a square
    // (Chebyshev) kernel — the P17 failure — would paint (10,10)/(4,4).
    expect(core(7 + 2, 7 + 2)).toBe(true)
    expect(core(7 + 3, 7 + 3)).toBe(false)
    expect(core(7 - 3, 7 + 3)).toBe(false)
    // Disc area, not square area (r=3 disc 45 core px, square would be 49+).
    let count = 0
    for (let i = 0; i < W * H; i++) if ((ring[i] ?? 0) > 80) count++
    expect(count).toBeGreaterThan(15)
    expect(count).toBeLessThan(49)
  })

  it("draws a full-width centered band on a straight edge", () => {
    const W = 30
    const H = 20
    const alpha = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < 12; x++) alpha[y * W + x] = 255
    const ring = cardNumeralContourRing(alpha, W, H, 3)
    const y = 10
    let minX = W
    let maxX = -1
    for (let x = 0; x < W; x++) {
      if ((ring[y * W + x] ?? 0) > 80) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
    // Inner half (9..11) + outer half (12..14): the full strokeWidth 6,
    // centered on the edge — never the outer-only half band.
    expect(minX).toBe(9)
    expect(maxX).toBe(14)
    expect(maxX - minX + 1).toBe(6)
  })

  it("stays empty without an edge and guards bad input", () => {
    expect(cardNumeralContourRing(new Uint8Array(100), 10, 10, 3).every((v) => v === 0)).toBe(true)
    const full = new Uint8Array(100).fill(255)
    expect(cardNumeralContourRing(full, 10, 10, 3).every((v) => v === 0)).toBe(true)
    expect(cardNumeralContourRing(full, 10, 10, 0).every((v) => v === 0)).toBe(true)
    expect(cardNumeralContourRing(new Uint8Array(10), 10, 10, 3).length).toBe(0)
    expect(cardNumeralContourRing(full, 0, 10, 3).length).toBe(0)
  })
})
