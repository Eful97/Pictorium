/**
 * Task12 — Fresh numerals go tall & narrow (user-approved "originale,
 * numerise brano allungati vero? ... lo metterai?").
 *
 * Reference (user portrait, rank 10): the numeral reads ~490px tall on a
 * ~1500px canvas (≈0.33 CH) and ~300px wide (two-digit W/H ≈ 0.6 — vs ≈1.5
 * before). No new font, no download, no dependency: the shared SVG glyph
 * source is condensed anisotropically per shape+rank (task12 c2, latest user
 * constraint "solo dal 10 in poi": ONLY portrait 10..100 → 0.42 =
 * 0.6 × 0.7 of CURRENT width, portrait singles 1..9 back at the 0.6
 * baseline, landscape every rank pinned at 0.6) and the
 * portrait cap height stays at ~0.33 CH (the condensed reference no longer
 * binds against the meta column, so the old column fit restriction is
 * effectively gone). Landscape keeps its existing height (≤0.5 CH, safe) —
 * only the width condenses there, so both shapes share one slender style at
 * their own heights.
 *
 * Style model (exact constants, also pinned in .agents/render-params.md):
 * - Portrait 10..100 `FRESH_NUMERAL_CONDENSE_X_PORTRAIT = 0.42`, portrait
 *   singles `FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE = 0.6`, landscape
 *   every rank `FRESH_NUMERAL_CONDENSE_X_LANDSCAPE = 0.6` (global
 *   `FRESH_NUMERAL_CONDENSE_X_LANDSCAPE = 0.6` (global
 *   `FRESH_NUMERAL_CONDENSE_X = 0.6` stays as the backwards-compatible
 *   default) on the shared `<text>` source via `transform="scale(<cx> 1)"`
 *   with the x origin pre-compensated (`x = rim / <cx>`) — mask, rim ring
 *   source and references stay in sync; never a post-scale of the frosted
 *   bitmap (the artwork ROI samples the final transformed ink; `numeralScale`
 *   10..200 still multiplies the final stylized geometry once, X/Y offsets
 *   apply once).
 * - Portrait share 0.33 CH → @500x750: fontSize 340, capH 248, default
 *   baseline top 30 (task10 `-90` calibration untouched), metaTop 300.
 * - Landscape share 0.50 CH → @768x432: fontSize 296, capH 216 (unchanged
 *   height), metaTop 270.
 * - `estW` = raw estimate × shape factor (normalized condensed measurement
 *   contract: ink scales with the estimate, so the real/est ceiling is
 *   unchanged and the scratch/rim/bounds machinery is untouched).
 * - With condensation even rank 100 fits: 1..100 share ONE height on both
 *   shapes (the 3-digit canvas guard stays as safety only).
 *
 * These tests assert on ACTUAL rasterized alpha (masks, glass layers, full
 * overlays), never on estimates alone: exact style constants, tall/narrow
 * measured ink for 1..20, one visible height, clip-free 1..100 bounds, the
 * morphology-ring seam reference, single-application transforms with
 * resampled artwork, blur following the condensed ink, unranked/Standard
 * stability and no default meta/title overlap.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import {
  freshGeometry,
  freshNumeralSvg,
  freshNumeralRimDefs,
  renderFreshNumeralMask,
  renderFreshGlassNumeral,
  renderFreshLeftBlurStrip,
  freshLeftBlurRegion,
  measureNumeralInk,
  composeFreshOverlay,
  FRESH_NUMERAL_CONDENSE_X,
  FRESH_NUMERAL_CONDENSE_X_PORTRAIT,
  FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE,
  FRESH_NUMERAL_CONDENSE_X_LANDSCAPE,
  freshBoxCondenseX,
  FRESH_LEFT_BLUR_FEATHER,
  type FreshMetaInput,
  type FreshNumeralBox,
} from "@/lib/fresh-layout"
import { renderSVG } from "@/lib/svg-badge"
import { estimateTextWidth } from "@/lib/badge-svg-shared"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H, LAND_W, LAND_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const SHAPES = [
  { name: "portrait", CW: STD_W, CH: STD_H },
  { name: "landscape", CW: LAND_W, CH: LAND_H },
] as const

const RANKS_1_20 = Array.from({ length: 20 }, (_, i) => i + 1)

async function flatBase(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#3a3f55" } })
    .jpeg()
    .toBuffer()
}

async function patternedBase(w: number, h: number): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3a3f55"/><stop offset="1" stop-color="#141827"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#p)"/>` +
    `<rect x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="#2e4a7a" opacity="0.85"/>` +
    `<circle cx="${Math.round(w * 0.25)}" cy="${Math.round(h * 0.3)}" r="${Math.round(w * 0.18)}" fill="#7a6a2e" opacity="0.9"/>` +
    `<rect x="0" y="${Math.round(h * 0.7)}" width="${w}" height="${Math.round(h * 0.3)}" fill="#0d0d12" opacity="0.9"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

async function redProvider(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 120, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

function metaInput(overrides: Partial<FreshMetaInput> = {}): FreshMetaInput {
  return {
    badgesEnabled: true,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    separateRatingsEnabled: false,
    separateRatingsStyle: "column",
    customRatingsEnabled: false,
    genreName: "Dramma",
    year: "2024",
    voteAverage: 8.3,
    separateRatings: undefined,
    customRatings: undefined,
    ...overrides,
  }
}

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: true,
    genreName: "Dramma",
    voteAverage: 8.3,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: "2024-03-10",
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    shape: "poster",
    ...overrides,
  }
}

async function alphaPlane(buf: Buffer): Promise<{ a: Uint8Array; w: number; h: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const a = new Uint8Array(info.width * info.height)
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3] ?? 0
  return { a, w: info.width, h: info.height }
}

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

describe("task12 slender style constants (exact)", () => {
  it("pins the shape-aware condensation factors and the per-shape reference geometry", () => {
    expect(FRESH_NUMERAL_CONDENSE_X).toBe(0.6)
    expect(FRESH_NUMERAL_CONDENSE_X_PORTRAIT).toBe(0.42)
    expect(FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE).toBe(0.6)
    expect(FRESH_NUMERAL_CONDENSE_X_LANDSCAPE).toBe(0.6)
    // Portrait @500x750: full 0.33 CH share (no column minification). Height
    // baseline UNCHANGED by c1/c2 (only width shrinks, c2 only for >= 10):
    // fontSize 340, capH 248.
    const p = freshGeometry(STD_W, STD_H, 10).numeral!
    expect(p.fontSize).toBe(340)
    expect(p.capH).toBe(248)
    expect(p.top).toBe(30)
    expect(p.left).toBe(12)
    expect(p.condenseX).toBe(0.42)
    // Portrait width is 70% of the CURRENT (0.6) width: estW = raw × 0.42.
    expect(p.estW).toBe(Math.max(1, Math.round(estimateTextWidth("10", 340, "inter") * 0.42)))
    expect(freshGeometry(STD_W, STD_H, 10).metaTop).toBe(300)
    // Landscape @768x432: existing height AND width kept (0.6 pinned).
    const l = freshGeometry(LAND_W, LAND_H, 10).numeral!
    expect(l.fontSize).toBe(296)
    expect(l.capH).toBe(216)
    expect(l.top).toBe(40)
    expect(l.condenseX).toBe(0.6)
    expect(l.estW).toBe(Math.max(1, Math.round(estimateTextWidth("10", 296, "inter") * 0.6)))
    expect(freshGeometry(LAND_W, LAND_H, 10).metaTop).toBe(270)
    // c2 (latest user constraint "solo dal 10 in poi"): portrait singles
    // keep the 0.6 baseline at the same height — same capH/top/left, wider
    // estW than the squeezed doubles.
    const p1 = freshGeometry(STD_W, STD_H, 1).numeral!
    expect(p1.fontSize).toBe(340)
    expect(p1.capH).toBe(248)
    expect(p1.top).toBe(30)
    expect(p1.left).toBe(12)
    expect(p1.condenseX).toBe(0.6)
    expect(p1.estW).toBe(Math.max(1, Math.round(estimateTextWidth("1", 340, "inter") * 0.6)))
    expect(freshNumeralSvg(p1).textEl).toContain(`transform="scale(0.6 1)"`)
    // Rank 100 fits condensed: one height for the whole 1..100 range.
    for (const { CW, CH } of SHAPES) {
      const two = freshGeometry(CW, CH, 20).numeral!
      const three = freshGeometry(CW, CH, 100).numeral!
      expect(three.fontSize).toBe(two.fontSize)
      expect(three.capH).toBe(two.capH)
      expect(three.left + three.estW).toBeLessThanOrEqual(CW)
    }
  })

  it("condenses the shared text source once with a pre-compensated origin", () => {
    for (const { CW, CH } of SHAPES) {
      const box = freshGeometry(CW, CH, 10).numeral!
      const cx = freshBoxCondenseX(box)
      const svg = freshNumeralSvg(box)
      // The shared source carries the anisotropic geometry every consumer
      // (mask, rim ring, references) renders — never a post-scale.
      expect(svg.textEl).toContain(`transform="scale(${cx} 1)"`)
      // Rendered left edge lands exactly on the rim pad (x is rounded to 2dp,
      // so allow the sub-pixel rounding residue, far below resvg paint).
      const xAttr = Number(/x="([\d.]+)"/.exec(svg.textEl)?.[1])
      expect(xAttr * cx).toBeCloseTo(svg.rim, 2)
      // Geometry estimate is the normalized condensed measurement contract.
      const rawEst = estimateTextWidth(box.text, box.fontSize, "inter")
      expect(box.estW).toBe(Math.max(1, Math.round(rawEst * cx)))
    }
    // Portrait rank-10 origin is exactly rim/0.42 (rim = 10 + 8); landscape
    // stays rim/0.6 = 30.
    const p10 = freshGeometry(STD_W, STD_H, 10).numeral!
    expect(freshNumeralSvg(p10).rim).toBe(18)
    expect(freshNumeralSvg(p10).textEl).toContain(`x="42.86"`)
    expect(freshNumeralSvg(p10).textEl).toContain(`transform="scale(0.42 1)"`)
    const l10 = freshGeometry(LAND_W, LAND_H, 10).numeral!
    expect(freshNumeralSvg(l10).rim).toBe(17)
    expect(freshNumeralSvg(l10).textEl).toContain(`x="28.33"`)
    expect(freshNumeralSvg(l10).textEl).toContain(`transform="scale(0.6 1)"`)
  })
})

describe("task12 measured ink is tall and narrow (rasterized masks, 1..20)", () => {
  it("reads ~0.33 CH tall on portrait with slender two-digit widths, both shapes coherent", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const t0 = performance.now()
      const ratios: string[] = []
      for (const rank of RANKS_1_20) {
        const box = freshGeometry(CW, CH, rank).numeral!
        const ink = await measureNumeralInk((await renderFreshNumeralMask(box)).png)
        expect(ink).not.toBeNull()
        const inkH = ink!.maxY - ink!.minY + 1
        const inkW = ink!.maxX - ink!.minX + 1
        // Rim pad survives on every side (same bound as the numerals suite).
        expect(ink!.minX).toBeGreaterThanOrEqual(4)
        expect(ink!.w - 1 - ink!.maxX).toBeGreaterThanOrEqual(4)
        expect(ink!.minY).toBeGreaterThanOrEqual(4)
        expect(ink!.h - 1 - ink!.maxY).toBeGreaterThanOrEqual(4)
        if (name === "portrait") {
          // Reference-inspired: ~0.33 CH visible height (was ~0.26).
          const hShare = inkH / CH
          expect(hShare).toBeGreaterThan(0.31)
          expect(hShare).toBeLessThan(0.37)
          // Slender: two-digit ink narrower than its cap height (was ~1.5×).
          if (rank >= 10) expect(inkW / box.capH).toBeLessThan(1.05)
        } else {
          // Landscape keeps its historic height band (≈0.50–0.53 CH).
          const hShare = inkH / CH
          expect(hShare).toBeGreaterThan(0.48)
          expect(hShare).toBeLessThan(0.55)
          if (rank >= 10) expect(inkW / box.capH).toBeLessThan(1.1)
        }
        if (rank === 10 || rank === 20) ratios.push(`rank${rank} inkW/capH=${(inkW / box.capH).toFixed(3)} inkH/CH=${(inkH / CH).toFixed(3)}`)
      }
      console.log(`[task12-elongated] shape=${name} ${ratios.join(" ")} total=${(performance.now() - t0).toFixed(0)}ms`)
    }
  }, 240000)

  it("keeps one visible height for every rank 1..20 (same size, Y = digit union)", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const ref = freshGeometry(CW, CH, 7).numeral!
      const digitY = new Map<string, { minY: number; maxY: number }>()
      for (const d of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
        const single =
          d === "0"
            ? {
                text: "0",
                fontSize: ref.fontSize,
                left: 0,
                top: 0,
                estW: Math.max(1, Math.round(estimateTextWidth("0", ref.fontSize, "inter") * freshBoxCondenseX(ref))),
                capH: ref.capH,
                condenseX: freshBoxCondenseX(ref),
              } satisfies FreshNumeralBox
            : freshGeometry(CW, CH, Number(d)).numeral!
        const ink = await measureNumeralInk((await renderFreshNumeralMask(single)).png)
        expect(ink).not.toBeNull()
        digitY.set(d, { minY: ink!.minY, maxY: ink!.maxY })
      }
      for (const rank of RANKS_1_20) {
        const box = freshGeometry(CW, CH, rank).numeral!
        expect(box.fontSize).toBe(ref.fontSize)
        expect(box.capH).toBe(ref.capH)
        expect(box.top).toBe(ref.top)
        const ink = await measureNumeralInk((await renderFreshNumeralMask(box)).png)
        expect(ink).not.toBeNull()
        if (rank >= 10) {
          const [a, b] = String(rank).split("") as [string, string]
          expect(ink!.minY).toBe(Math.min(digitY.get(a)!.minY, digitY.get(b)!.minY))
          expect(ink!.maxY).toBe(Math.max(digitY.get(a)!.maxY, digitY.get(b)!.maxY))
        }
      }
      const tops = new Set(RANKS_1_20.map((rank) => freshGeometry(CW, CH, rank).metaTop))
      expect(tops.size).toBe(1)
      expect({ shape: name }).toBeDefined()
    }
  }, 240000)
})

describe("task12 full-range bounds + seam (actual glass layers)", () => {
  it("keeps every rank 1..100 inside the canvas with no clipped edge pixel, both shapes, timed", async () => {
    let worst = { ratio: 0, rank: 0, shape: "" }
    for (const { name, CW, CH } of SHAPES) {
      const base = await flatBase(CW, CH)
      const t0 = performance.now()
      for (let rank = 1; rank <= 100; rank++) {
        const box = freshGeometry(CW, CH, rank).numeral!
        const mask = await renderFreshNumeralMask(box)
        const ink = await measureNumeralInk(mask.png)
        expect(ink).not.toBeNull()
        // Condensed measurement contract: actual normalized ink vs the
        // condensed estimate (condensation scales both together).
        const ratio = (ink!.maxX - ink!.minX + 1) / Math.max(1, box.estW)
        if (ratio > worst.ratio) worst = { ratio, rank, shape: name }
        const num = await renderFreshGlassNumeral(base, CW, CH, box)
        expect(num.left).toBeGreaterThanOrEqual(0)
        expect(num.top).toBeGreaterThanOrEqual(0)
        expect(num.left + num.w).toBeLessThanOrEqual(CW)
        expect(num.top + num.h).toBeLessThanOrEqual(CH)
        expect(await edgeAlphaCount(num.png)).toBe(0)
      }
      console.log(`[task12-elongated] shape=${name} ranks=100 total=${(performance.now() - t0).toFixed(0)}ms avg=${((performance.now() - t0) / 100).toFixed(1)}ms/rank`)
    }
    console.log(`[task12-elongated] worst condensed ink/est=${worst.ratio.toFixed(3)} at rank=${worst.rank} shape=${worst.shape}`)
    expect(worst.ratio).toBeLessThan(1.2)
  }, 300000)

  it("carries no rim alpha deep inside the condensed glyphs for 4 and 14, both shapes", async () => {
    for (const { name, CW, CH } of SHAPES) {
      for (const rank of [4, 14]) {
        const box = freshGeometry(CW, CH, rank).numeral!
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
        expect(inCount).toBeGreaterThan(200)
        expect(seamCount / Math.max(1, inCount)).toBeLessThan(0.005)
        expect({ rank, shape: name }).toBeDefined()
      }
    }
  }, 180000)
})

describe("task12 compositor: transforms once, blur follows condensed ink", () => {
  it("applies numeralScale 10..200 once and resamples the artwork at the transformed anchor", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const ref = freshGeometry(CW, CH, 12).numeral!
      const scaled = freshGeometry(CW, CH, 12, { numeralScale: 200 }).numeral!
      expect(scaled.fontSize).toBe(ref.fontSize * 2)
      expect(scaled.capH).toBe(Math.round(ref.fontSize * 2 * 0.73))
      // Width scales linearly with the single size control (same condensed
      // estimate path, no re-fit per scale).
      expect(scaled.estW).toBe(ref.estW * 2)
      const shrunk = freshGeometry(CW, CH, 12, { numeralScale: 10 }).numeral!
      expect(shrunk.fontSize).toBe(Math.round(ref.fontSize / 10))
      const poster = await patternedBase(CW, CH)
      const box = freshGeometry(CW, CH, 14).numeral!
      const movedBox = freshGeometry(CW, CH, 14, { numeralOffsetX: 40 }).numeral!
      expect(movedBox.left).toBe(box.left + 40)
      const refLayer = await renderFreshGlassNumeral(poster, CW, CH, box)
      const moved = await renderFreshGlassNumeral(poster, CW, CH, movedBox)
      expect(moved.png.equals(refLayer.png)).toBe(false)
      expect(moved.left).toBeGreaterThanOrEqual(0)
      expect(moved.left + moved.w).toBeLessThanOrEqual(CW)
      expect(await edgeAlphaCount(moved.png)).toBe(0)
      expect({ shape: name }).toBeDefined()
    }
  }, 180000)

  it("ends the left blur band at the CONDENSED ink right edge (both shapes)", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const base = await patternedBase(CW, CH)
      for (const rank of [4, 10, 20]) {
        const box = freshGeometry(CW, CH, rank).numeral!
        const strip = await renderFreshLeftBlurStrip(base, CW, CH, box)
        expect(strip).not.toBeNull()
        const rim = freshNumeralSvg(box).rim
        const ink = await measureNumeralInk((await renderFreshNumeralMask(box)).png)
        const inkRight = box.left - rim + ink!.maxX
        const region = freshLeftBlurRegion(CW, CH, inkRight)!
        expect(strip!.w).toBe(region.width)
        expect(strip!.w).toBe(Math.min(CW, Math.round(inkRight + FRESH_LEFT_BLUR_FEATHER)))
        expect(strip!.h).toBe(CH)
        // Condensed ink ends well left of the old uncondensed estimate edge.
        expect(inkRight).toBeLessThan(box.left + box.estW / freshBoxCondenseX(box))
        expect({ rank, shape: name }).toBeDefined()
      }
    }
  }, 180000)

  it("keeps the default ranked portrait free of meta/provider/title overlap", async () => {
    const CW = STD_W
    const CH = STD_H
    const logo = await whiteLogo()
    const provider = await redProvider()
    const logoBox = { png: logo, w: 220, h: 100 }
    const providerBox = { png: provider, w: 300, h: 120 }
    const layers = await composeFreshOverlay({
      posterBuf: await patternedBase(CW, CH),
      CW,
      CH,
      rank: 10,
      meta: metaInput(),
      logo: logoBox,
      provider: providerBox,
    })
    // Ranked layers with meta rows + logo + provider: band + shade +
    // numeral + meta + provider + title.
    expect(layers).toHaveLength(6)
    const boxOf = async (l: { input: unknown; top: number; left: number }) => {
      const meta = await sharp(l.input as Buffer).metadata()
      return { left: l.left, top: l.top, right: l.left + (meta.width ?? 0), bottom: l.top + (meta.height ?? 0) }
    }
    const meta = await boxOf(layers[3])
    const prov = await boxOf(layers[4])
    const title = await boxOf(layers[5])
    for (const b of [meta, prov, title]) {
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.right).toBeLessThanOrEqual(CW)
      expect(b.bottom).toBeLessThanOrEqual(CH)
    }
    const disjoint = (a: typeof meta, b: typeof meta): boolean =>
      a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
    // Meta/provider stack vertically in the left column; the centered title
    // sits in the bottom band below both.
    expect(disjoint(meta, prov)).toBe(true)
    expect(prov.bottom).toBeLessThanOrEqual(title.top)
    expect(meta.bottom).toBeLessThanOrEqual(title.top)
  }, 180000)

  it("keeps unranked Fresh and Standard byte-stable (deterministic, untouched paths)", async () => {
    const poster = await flatBase(STD_W, STD_H)
    const a = await composeFreshOverlay({ posterBuf: poster, CW: STD_W, CH: STD_H, rank: null, meta: metaInput(), logo: null, provider: null })
    const b = await composeFreshOverlay({ posterBuf: poster, CW: STD_W, CH: STD_H, rank: null, meta: metaInput(), logo: null, provider: null })
    expect(a).toHaveLength(b.length)
    for (let i = 0; i < a.length; i++) {
      expect(a[i].top).toBe(b[i].top)
      expect(a[i].left).toBe(b[i].left)
      expect((a[i].input as Buffer).equals(b[i].input as Buffer)).toBe(true)
    }
    expect(freshGeometry(STD_W, STD_H, null).metaTop).toBe(120)
    expect(freshGeometry(LAND_W, LAND_H, null).metaTop).toBe(40)
    const s1 = await generatePosterBuffer(baseInput({ posterBuf: poster, posterLayout: "standard", rankingEnabled: true, finalRank: 6 }))
    const s2 = await generatePosterBuffer(baseInput({ posterBuf: poster, posterLayout: "standard", rankingEnabled: true, finalRank: 6 }))
    expect(s1.equals(s2)).toBe(true)
  }, 180000)
})
