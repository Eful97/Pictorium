/**
 * Task11 — Fresh numerals keep ONE visible digit height for every 1..20 rank
 * (user-reported "10+ numerals shrink").
 *
 * Root cause (geometry table, `task11/before/geometry-1-20.txt`): the numeral
 * font fitted to the META column width (`avail = zoneW - padX - 6`
 * ≈ 152 portrait / 206 landscape), so two-digit ranks minified to ~half the
 * cap height (portrait 191 → 96, landscape 216 → 129) and `metaTop` jumped
 * with the digit count.
 *
 * Fix (fresh-layout.ts only): the column fit applies ONCE to a fixed
 * single-digit reference (`estimateTextWidth("8")` — every digit shares the
 * same 0.58em factor, so 1..9 keep their exact historic size); every
 * 1..2-digit rank inherits that cap height and extends right over the
 * artwork. Only the 3-digit rank shrinks, and only against the canvas edge
 * (`FRESH_NUMERAL_CANVAS_WORST` bound). Tracking stays proportional
 * (`-0.03em`, untouched), no font-path strokes, no post-blur resize.
 *
 * These tests assert on ACTUAL rasterized alpha (masks, glass layers, full
 * overlays), never on estimates alone: equal geometry for 1..20, measured
 * ink heights within resvg pixels, in-canvas layers with zero edge alpha for
 * the full 1..100 range, the morphology-ring seam reference for the newly
 * enlarged two-digit "4"s, single-application size controls, transformed
 * artwork sampling, unranked/Standard stability and compositor alignment.
 *
 * Task12 (tall/narrow, portrait 10..100 → 0.42 / portrait singles + landscape
 * 0.6 rank-aware condensation, portrait share
 * 0.33 CH) intentionally moves every ranked size: the "legacy" replica below
 * tracks the condensed formula (it still proves the fixed "8" reference
 * reproduces the per-rank fit for singles), and rank 100 now holds the
 * reference height on both shapes — 1..100 share one height, with the
 * 3-digit canvas guard kept as safety only.
 * Correction c2 (latest user constraint "solo dal 10 in poi"): portrait
 * singles (1..9) render at 0.6 again (byte-identical to the pre-c1 task12
 * baseline), only portrait 10..100 keep 0.42; the replica mirrors the
 * production rank-aware factor per digit count.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import {
  freshGeometry,
  freshNumeralSvg,
  freshNumeralRimDefs,
  renderFreshNumeralMask,
  renderFreshGlassNumeral,
  measureNumeralInk,
  composeFreshOverlay,
  FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE,
  FRESH_NUMERAL_CONDENSE_X_LANDSCAPE,
  freshNumeralCondenseX,
  type FreshLayoutTransforms,
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

/** Deterministic patterned artwork: gradient + shapes, exercises blur/fill. */
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
 * glyph (same technique as poster-fresh-numerals) — rim alpha inside this
 * region is a seam, not an edge.
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

/**
 * Pre-task12 numeral size path (column fit per rank text on the RANK-AWARE
 * condensed estimate — portrait 10..100 → 0.42, portrait singles + landscape
 * → 0.6 — 0.33 portrait share): the exact formula this suite pins. Only
 * used to prove the fixed "8" reference reproduces the per-rank fit for
 * singles — the reference IS the per-rank fit, no blind enlargement.
 */
function legacyNumeralSize(
  CW: number,
  CH: number,
  text: string,
  numeralScale: number | null | undefined,
): { fontSize: number; capH: number; estW: number } {
  const isPortrait = CH > CW
  const zoneW = Math.round(CW * (isPortrait ? 0.34 : 0.3))
  const padX = isPortrait ? 12 : 18
  const glyphH = Math.round(CH * (isPortrait ? 0.33 : 0.5))
  const fs0 = Math.max(24, Math.round(glyphH / 0.73))
  // Rank-aware mirror of the production factor (c2): the digit count stands
  // in for the validated rank (singles → 0.6, multi-digit portrait → 0.42,
  // landscape always 0.6). Both est0 and the "8" reference use the same
  // factor, exactly like `freshGeometry`.
  const cx = freshNumeralCondenseX(isPortrait, text.length >= 2 ? 10 : 1)
  const condensed = (raw: number): number => Math.max(1, Math.round(raw * cx))
  const est0 = condensed(estimateTextWidth(text, fs0, "inter"))
  const avail = Math.max(24, zoneW - padX - 6)
  const refEst = condensed(estimateTextWidth("8", fs0, "inter"))
  const fitted = text.length > 2 ? fs0 : Math.max(24, Math.min(fs0, Math.floor((avail * fs0) / refEst)))
  const scale = typeof numeralScale === "number" && Number.isFinite(numeralScale) && numeralScale !== 0
    ? Math.min(200, Math.max(10, Math.round(numeralScale)))
    : 100
  const fontSize = Math.max(8, Math.round((fitted * scale) / 100))
  return { fontSize, capH: Math.round(fontSize * 0.73), estW: (est0 * fontSize) / fs0 }
}

describe("task11 numeral height coherence (pure geometry)", () => {
  it("uses one digit cap height for every rank 1..20 at default scale, both shapes", () => {
    for (const { name, CW, CH } of SHAPES) {
      const ref = freshGeometry(CW, CH, 7).numeral!
      for (const rank of RANKS_1_20) {
        const box = freshGeometry(CW, CH, rank).numeral!
        expect(box.text).toBe(String(rank))
        // Same visible digit height — not the old halved two-digit size.
        expect({ rank, shape: name, fontSize: box.fontSize }).toEqual({ rank, shape: name, fontSize: ref.fontSize })
        expect(box.capH).toBe(ref.capH)
        expect(box.top).toBe(ref.top)
        expect(box.left).toBe(ref.left)
      }
      // No rank-dependent meta jump across 1..20: one column anchor.
      const tops = new Set(RANKS_1_20.map((rank) => freshGeometry(CW, CH, rank).metaTop))
      expect({ shape: name, distinctMetaTops: tops.size }).toEqual({ shape: name, distinctMetaTops: 1 })
    }
  })

  it("keeps the exact task12 1..9 geometry (condensed reference == per-rank fit, neutral + transformed)", () => {
    // Justification for the fixed "8" reference: every digit estimates
    // identically at the same size, so the reference IS the per-rank fit
    // for singles — no blind enlargement. Task12 intentionally moves 1..9
    // (taller ~0.33 CH portrait share, shape-condensed widths); this test
    // pins the NEW baseline exactly and proves the reference still
    // reproduces the per-rank fit for singles under it.
    for (const { CW, CH } of SHAPES) {
      const isPortrait = CH > CW
      const glyphH = Math.round(CH * (isPortrait ? 0.33 : 0.5))
      const fs0 = Math.max(24, Math.round(glyphH / 0.73))
      const widths = new Set(Array.from({ length: 10 }, (_, d) => estimateTextWidth(String(d), fs0, "inter")))
      expect(widths.size).toBe(1)
    }
    // Exact task12 reference sizes at neutral scale.
    expect(freshGeometry(STD_W, STD_H, 5).numeral).toMatchObject({ fontSize: 340, capH: 248, top: 30, left: 12 })
    expect(freshGeometry(LAND_W, LAND_H, 5).numeral).toMatchObject({ fontSize: 296, capH: 216, top: 40, left: 18 })
    const transforms: (FreshLayoutTransforms | null)[] = [null, { numeralScale: 200 }, { numeralScale: 50 }, { numeralOffsetX: 30, numeralOffsetY: -20 }]
    for (const { CW, CH } of SHAPES) {
      for (let rank = 1; rank <= 9; rank++) {
        for (const t of transforms) {
          const box = freshGeometry(CW, CH, rank, t).numeral!
          const legacy = legacyNumeralSize(CW, CH, String(rank), t?.numeralScale)
          expect(box.fontSize).toBe(legacy.fontSize)
          expect(box.capH).toBe(legacy.capH)
          expect(box.estW).toBe(legacy.estW)
        }
      }
    }
  })

  it("holds the 3-digit rank at the reference size: condensation fits 100 in-canvas (both shapes)", () => {
    for (const { name, CW, CH } of SHAPES) {
      const two = freshGeometry(CW, CH, 20).numeral!
      const three = freshGeometry(CW, CH, 100).numeral!
      // Never smaller than the floor, never larger than the 1..20 reference.
      expect(three.fontSize).toBeGreaterThanOrEqual(24)
      expect(three.fontSize).toBeLessThanOrEqual(two.fontSize)
      // Task12 (user-approved tall/narrow): the condensed rank-100 ink fits
      // the canvas at the reference size on BOTH shapes (portrait need
      // ≈426px vs ≈440px budget, landscape wider still), so the canvas
      // guard — kept as safety only — does not bind and 1..100 share ONE
      // height. A future canvas/share change re-decides via the guard.
      expect(three.fontSize).toBe(two.fontSize)
      expect({ shape: name }).toBeDefined()
      // ...and the reference size still fits the estimate-level canvas contract.
      expect(three.left + three.estW).toBeLessThanOrEqual(CW)
      expect(three.top + three.capH).toBeLessThanOrEqual(CH)
    }
  })

  it("applies the size control once for two-digit ranks (both shapes)", () => {
    for (const { CW, CH } of SHAPES) {
      const ref = freshGeometry(CW, CH, 12).numeral!
      const scaled = freshGeometry(CW, CH, 12, { numeralScale: 200 }).numeral!
      expect(scaled.fontSize).toBe(ref.fontSize * 2)
      expect(scaled.capH).toBe(Math.round(ref.fontSize * 2 * 0.73))
      const shrunk = freshGeometry(CW, CH, 12, { numeralScale: 50 }).numeral!
      expect(shrunk.fontSize).toBe(Math.round(ref.fontSize / 2))
      const moved = freshGeometry(CW, CH, 12, { numeralOffsetX: 30, numeralOffsetY: -20 }).numeral!
      expect(moved.left).toBe(ref.left + 30)
      expect(moved.top).toBe(ref.top - 20)
      expect(moved.fontSize).toBe(ref.fontSize)
      expect(moved.capH).toBe(ref.capH)
    }
  })
})

describe("task11 actual ink extents (rasterized masks, 1..20 both shapes)", () => {
  it("renders two-digit glyphs at the single-digit size: ink Y extents equal the digit union, with rim padding and no edge ink", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const ref = freshGeometry(CW, CH, 7).numeral!
      // Same-size single-digit Y references for every digit 0..9 ("0" has
      // no rank path, so it is measured from an equivalent box at the same
      // fontSize/capH — Y geometry is identical, only the scratch width
      // differs, which never affects Y).
      const digitY = new Map<string, { minY: number; maxY: number }>()
      for (const d of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
        const single = d === "0"
          ? {
            text: "0",
            fontSize: ref.fontSize,
            left: 0,
            top: 0,
            estW: Math.max(1, Math.round(estimateTextWidth("0", ref.fontSize, "inter") * (ref.condenseX ?? (CH > CW ? FRESH_NUMERAL_CONDENSE_X_PORTRAIT_SINGLE : FRESH_NUMERAL_CONDENSE_X_LANDSCAPE)))),
            capH: ref.capH,
            condenseX: ref.condenseX,
          } satisfies FreshNumeralBox
          : freshGeometry(CW, CH, Number(d)).numeral!
        const ink = await measureNumeralInk((await renderFreshNumeralMask(single)).png)
        expect(ink).not.toBeNull()
        digitY.set(d, { minY: ink!.minY, maxY: ink!.maxY })
      }
      for (const rank of RANKS_1_20) {
        const box = freshGeometry(CW, CH, rank).numeral!
        const mask = await renderFreshNumeralMask(box)
        const ink = await measureNumeralInk(mask.png)
        expect(ink).not.toBeNull()
        // Default ink padding: the scratch rim pad survives the measured
        // crop on every side (same bound as the existing numerals suite).
        expect(ink!.minX).toBeGreaterThanOrEqual(4)
        expect(ink!.w - 1 - ink!.maxX).toBeGreaterThanOrEqual(4)
        expect(ink!.minY).toBeGreaterThanOrEqual(4)
        expect(ink!.h - 1 - ink!.maxY).toBeGreaterThanOrEqual(4)
        expect(await edgeAlphaCount(mask.png)).toBe(0)
        if (rank >= 10) {
          // Same size, same style: the two-digit vertical extents are
          // exactly the union of the same-size single-digit extents —
          // glyph design (overshoot), not size, explains the spread.
          const [a, b] = String(rank).split("") as [string, string]
          expect(ink!.minY).toBe(Math.min(digitY.get(a)!.minY, digitY.get(b)!.minY))
          expect(ink!.maxY).toBe(Math.max(digitY.get(a)!.maxY, digitY.get(b)!.maxY))
        }
      }
      console.log(`[task11-height] shape=${name} digit-union holds for 10..20 at font=${ref.fontSize}`)
    }
  }, 240000)

  it("keeps cap height stable across 11 vs 19 vs 20 (both shapes)", () => {
    for (const { name, CW, CH } of SHAPES) {
      const boxes = [11, 19, 20].map((rank) => freshGeometry(CW, CH, rank).numeral!)
      // Geometric cap height is exactly one value (the raster spread across
      // these ranks is the digit-union overshoot proven above, same as the
      // historic spread among 1..9 themselves).
      expect(new Set(boxes.map((b) => b.capH)).size).toBe(1)
      expect(new Set(boxes.map((b) => b.fontSize)).size).toBe(1)
      expect({ shape: name, capH: boxes[0].capH }).toBeDefined()
    }
  })
})

describe("task11 full-range numeral bounds (actual glass layers, 1..100 default)", () => {
  it("keeps every rank layer inside the canvas with no clipped edge pixel, both shapes, timed", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const base = await flatBase(CW, CH)
      const t0 = performance.now()
      for (let rank = 1; rank <= 100; rank++) {
        const box = freshGeometry(CW, CH, rank).numeral!
        const num = await renderFreshGlassNumeral(base, CW, CH, box)
        expect(num.left).toBeGreaterThanOrEqual(0)
        expect(num.top).toBeGreaterThanOrEqual(0)
        expect(num.left + num.w).toBeLessThanOrEqual(CW)
        expect(num.top + num.h).toBeLessThanOrEqual(CH)
        expect(await edgeAlphaCount(num.png)).toBe(0)
      }
      const total = performance.now() - t0
      console.log(`[task11-height] shape=${name} ranks=100 total=${total.toFixed(0)}ms avg=${(total / 100).toFixed(1)}ms/rank`)
    }
  }, 300000)
})

describe("task11 enlarged two-digit rim seam (united-silhouette reference)", () => {
  it("carries no rim alpha deep inside the glyphs for 4 and 14, both shapes", async () => {
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

describe("task11 compositor alignment + resampling (actual overlays)", () => {
  it("aligns the meta block under the enlarged two-digit numeral (both shapes)", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const poster = await flatBase(CW, CH)
      const geo = freshGeometry(CW, CH, 12)
      const layers = await composeFreshOverlay({ posterBuf: poster, CW, CH, rank: 12, meta: metaInput(), logo: null, provider: null })
      // Ranked layers with meta rows, no logo/provider: band + shade +
      // numeral + meta. The strip follows the new wider ink automatically
      // (measured, never the estimate) — no double blur, one band only.
      expect(layers).toHaveLength(4)
      expect(layers[0].left).toBe(0)
      expect(layers[0].top).toBe(0)
      const stripMeta = await sharp(layers[0].input as Buffer).metadata()
      expect(stripMeta.width).toBeLessThanOrEqual(CW)
      expect(stripMeta.height).toBe(CH)
      // Numeral layer fully inside the canvas, no clipped edge.
      const num = layers[2]
      expect(num.left).toBeGreaterThanOrEqual(0)
      expect(num.top).toBeGreaterThanOrEqual(0)
      const numMeta = await sharp(num.input as Buffer).metadata()
      expect(num.left + (numMeta.width ?? 0)).toBeLessThanOrEqual(CW)
      expect(num.top + (numMeta.height ?? 0)).toBeLessThanOrEqual(CH)
      expect(await edgeAlphaCount(num.input as Buffer)).toBe(0)
      // Meta block: default anchor follows the numeral box, column stays in
      // the historic left zone (width/centering untouched by this task).
      const meta = layers[3]
      expect(meta.top).toBe(Math.round(geo.metaTop))
      expect(meta.top).toBe(geo.numeral!.top + geo.numeral!.capH + geo.metaGap)
      const metaPngMeta = await sharp(meta.input as Buffer).metadata()
      expect(meta.left + (metaPngMeta.width ?? 0)).toBeLessThanOrEqual(geo.zoneW + 1)
      expect({ shape: name }).toBeDefined()
    }
  }, 180000)

  it("samples the transformed anchor for a two-digit numeral (offset moves real ink)", async () => {
    for (const { name, CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      const box = freshGeometry(CW, CH, 14).numeral!
      const movedBox = freshGeometry(CW, CH, 14, { numeralOffsetX: 40 }).numeral!
      const ref = await renderFreshGlassNumeral(poster, CW, CH, box)
      const moved = await renderFreshGlassNumeral(poster, CW, CH, movedBox)
      expect(movedBox.left).toBe(box.left + 40)
      expect(movedBox.fontSize).toBe(box.fontSize)
      // Same size, different artwork underneath: the fill resamples.
      expect((moved.png as Buffer).equals(ref.png as Buffer)).toBe(false)
      expect(moved.left).toBeGreaterThanOrEqual(0)
      expect(moved.left + moved.w).toBeLessThanOrEqual(CW)
      expect(await edgeAlphaCount(moved.png)).toBe(0)
      expect({ shape: name }).toBeDefined()
    }
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
    // Null-rank geometry keeps the historic fallback (this task never moves
    // it): portrait 120 / landscape 40.
    expect(freshGeometry(STD_W, STD_H, null).metaTop).toBe(120)
    expect(freshGeometry(LAND_W, LAND_H, null).metaTop).toBe(40)
    const s1 = await generatePosterBuffer(baseInput({ posterBuf: poster, posterLayout: "standard", rankingEnabled: true, finalRank: 6 }))
    const s2 = await generatePosterBuffer(baseInput({ posterBuf: poster, posterLayout: "standard", rankingEnabled: true, finalRank: 6 }))
    expect(s1.equals(s2)).toBe(true)
  }, 180000)
})
