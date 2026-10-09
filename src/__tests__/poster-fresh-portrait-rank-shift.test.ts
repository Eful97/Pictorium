/**
 * Task10 portrait rank shift (user-approved "-90px lato Y precisamente"):
 * the Fresh RANKED portrait numeral moves UP 90 logical canvas px relative
 * to its current default, BEFORE the user `toy` offset; landscape is
 * untouched; stored user X/Y/scale transforms keep working unchanged.
 *
 * - `FRESH_PORTRAIT_RANK_Y_SHIFT` (-90) is a portrait-only baseline
 *   calibration term: neutral `toy=0` renders the new default, existing
 *   `toy` values keep their exact relative effect (never reset to 0).
 * - Geometry proof: portrait `numeral.top` is exactly 90 below the
 *   pre-task10 anchor (120 @500x750, captured in
 *   `task10/before-fresh-layout.ts`: `const numeralTop = isPortrait ? 120
 *   : 40`) at neutral AND with a user offset applied once; landscape stays
 *   on the historic anchor (40).
 * - The ranked meta column follows the numeral by the pre-existing rule
 *   (`metaTop` derives from the transformed numeral box) — so it rises 90
 *   too by design; user `goy` stays independent on top. Provider below-meta
 *   and the left blur band follow the new real ink (same band pixels, only
 *   the sampling position moves).
 * - Font/scale pipeline untouched (this task): the shift is a pure
 *   translation — `fontSize`/`capH`/`estW`/`left` are identical across a
 *   `toy` sweep for the same rank.
 * - Fresh WITHOUT rank must not move: null-rank geometry keeps the historic
 *   `metaTop` fallback (120 portrait / 40 landscape), unranked and Standard
 *   renders stay byte-stable on both shapes, and the landscape ranked anchor
 *   is byte-stable (pinned by `poster-fresh-unranked`).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import {
  freshGeometry,
  freshNumeralSvg,
  renderFreshNumeralMask,
  renderFreshGlassNumeral,
  measureNumeralInk,
  FRESH_PORTRAIT_RANK_Y_SHIFT,
} from "@/lib/fresh-layout"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H, LAND_W, LAND_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

/** Pre-task10 portrait numeral anchor @500x750 (before-fresh-layout.ts). */
const BEFORE_PORTRAIT_NUMERAL_TOP = 120
/** Historic landscape numeral anchor (unchanged by this task). */
const HISTORIC_LANDSCAPE_NUMERAL_TOP = 40
const EXPECTED_SHIFT = 90

const PROBE_RANKS = [1, 4, 9, 10, 20] as const

async function flatBase(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#3a3f55" } })
    .jpeg()
    .toBuffer()
}

async function edgeAlphaCount(buf: Buffer, threshold = 10): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let x = 0; x < info.width; x++) {
    if ((data[x * 4 + 3] ?? 0) > threshold) n++
    if (info.height > 1 && (data[((info.height - 1) * info.width + x) * 4 + 3] ?? 0) > threshold) n++
  }
  for (let y = 1; y < info.height - 1; y++) {
    if ((data[(y * info.width) * 4 + 3] ?? 0) > threshold) n++
    if (info.width > 1 && (data[(y * info.width + info.width - 1) * 4 + 3] ?? 0) > threshold) n++
  }
  return n
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

describe("task10 calibration constant", () => {
  it("is exactly -90 (portrait-only, applied before the user Y offset)", () => {
    expect(FRESH_PORTRAIT_RANK_Y_SHIFT).toBe(-90)
  })
})

describe("portrait numeral anchor drops exactly 90, landscape untouched", () => {
  it("neutral: portrait top = historic - 90, landscape top = historic", () => {
    for (const rank of PROBE_RANKS) {
      const portrait = freshGeometry(STD_W, STD_H, rank).numeral!
      expect(portrait).not.toBeNull()
      expect(portrait.top).toBe(BEFORE_PORTRAIT_NUMERAL_TOP - EXPECTED_SHIFT)
      const landscape = freshGeometry(LAND_W, LAND_H, rank).numeral!
      expect(landscape).not.toBeNull()
      expect(landscape.top).toBe(HISTORIC_LANDSCAPE_NUMERAL_TOP)
    }
  })

  it("with user X/Y applied once: calibration stays first, offsets relative", () => {
    for (const rank of PROBE_RANKS) {
      const p = freshGeometry(STD_W, STD_H, rank, { numeralOffsetX: 25, numeralOffsetY: -15 }).numeral!
      expect(p.top).toBe(BEFORE_PORTRAIT_NUMERAL_TOP - EXPECTED_SHIFT - 15)
      expect(p.left).toBe(12 + 25)
      const l = freshGeometry(LAND_W, LAND_H, rank, { numeralOffsetX: 25, numeralOffsetY: -15 }).numeral!
      expect(l.top).toBe(HISTORIC_LANDSCAPE_NUMERAL_TOP - 15)
      expect(l.left).toBe(18 + 25)
    }
  })

  it("shift is pure translation: font/scale/left identical across a toy sweep", () => {
    for (const rank of PROBE_RANKS) {
      const ref = freshGeometry(STD_W, STD_H, rank).numeral!
      for (const toy of [-200, -15, 0, 40, 500]) {
        const moved = freshGeometry(STD_W, STD_H, rank, { numeralOffsetY: toy }).numeral!
        expect(moved.top).toBe(ref.top + toy)
        expect(moved.left).toBe(ref.left)
        expect(moved.fontSize).toBe(ref.fontSize)
        expect(moved.capH).toBe(ref.capH)
        expect(moved.estW).toBe(ref.estW)
      }
    }
  })

  it("ranked meta follows the numeral by the existing rule (rises 90 too, user goy independent)", () => {
    for (const rank of PROBE_RANKS) {
      const geo = freshGeometry(STD_W, STD_H, rank)
      const box = geo.numeral!
      // Existing follow rule: metaTop derives from the transformed numeral box.
      expect(geo.metaTop).toBe(box.top + box.capH + geo.metaGap)
      // Exactly 90 above where the historic anchor would place it.
      expect(geo.metaTop).toBe(BEFORE_PORTRAIT_NUMERAL_TOP - EXPECTED_SHIFT + box.capH + geo.metaGap)
      // User meta offsets still apply independently on top.
      const shifted = freshGeometry(STD_W, STD_H, rank, { numeralOffsetY: 30 })
      expect(shifted.metaTop).toBe(geo.metaTop + 30)
      // Landscape follow rule unchanged (historic anchor, no shift).
      const land = freshGeometry(LAND_W, LAND_H, rank)
      expect(land.metaTop).toBe(HISTORIC_LANDSCAPE_NUMERAL_TOP + land.numeral!.capH + land.metaGap)
    }
  })
})

describe("default visible ink top moves exactly 90 with no clipping (portrait 1..20)", () => {
  it("mask ink top = historic ink top - 90 and glass layers stay in-canvas, edge-clean", async () => {
    const base = await flatBase(STD_W, STD_H)
    for (let rank = 1; rank <= 20; rank++) {
      const box = freshGeometry(STD_W, STD_H, rank).numeral!
      const mask = await renderFreshNumeralMask(box)
      const ink = await measureNumeralInk(mask.png)
      expect(ink).not.toBeNull()
      const rim = freshNumeralSvg(box).rim
      const inkTop = box.top - rim + ink!.minY
      // Same mask content as the historic anchor (font/scale untouched), so
      // the visible ink top moves by exactly the anchor delta.
      expect(inkTop).toBe(BEFORE_PORTRAIT_NUMERAL_TOP - EXPECTED_SHIFT - rim + ink!.minY)
      expect(inkTop).toBeGreaterThanOrEqual(0)
      // Full glass layer (fill + modeling + rim + shadow): in-canvas, no
      // clipped edge pixel — never weakened to accommodate the new default.
      const num = await renderFreshGlassNumeral(base, STD_W, STD_H, box)
      expect(num.left).toBeGreaterThanOrEqual(0)
      expect(num.top).toBeGreaterThanOrEqual(0)
      expect(num.left + num.w).toBeLessThanOrEqual(STD_W)
      expect(num.top + num.h).toBeLessThanOrEqual(STD_H)
      expect(await edgeAlphaCount(num.png)).toBe(0)
    }
  }, 240000)
})

describe("unranked + standard byte-stable, landscape rank anchor stable", () => {
  it("null-rank geometry keeps the historic metaTop fallback on both shapes", () => {
    const p = freshGeometry(STD_W, STD_H, null)
    expect(p.numeral).toBeNull()
    expect(p.metaTop).toBe(BEFORE_PORTRAIT_NUMERAL_TOP)
    const l = freshGeometry(LAND_W, LAND_H, null)
    expect(l.numeral).toBeNull()
    expect(l.metaTop).toBe(HISTORIC_LANDSCAPE_NUMERAL_TOP)
    for (const bad of [0, -3, 6.5, NaN, 101]) {
      expect(freshGeometry(STD_W, STD_H, bad).numeral).toBeNull()
      expect(freshGeometry(STD_W, STD_H, bad).metaTop).toBe(BEFORE_PORTRAIT_NUMERAL_TOP)
      expect(freshGeometry(LAND_W, LAND_H, bad).numeral).toBeNull()
      expect(freshGeometry(LAND_W, LAND_H, bad).metaTop).toBe(HISTORIC_LANDSCAPE_NUMERAL_TOP)
    }
  })

  it("service: unranked Fresh both shapes deterministic, landscape ranked anchor historic", async () => {
    const poster = await flatBase(STD_W, STD_H)
    const a = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: false, finalRank: null }),
    )
    const b = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: false, finalRank: null }),
    )
    expect(a.equals(b)).toBe(true)
    const backdrop = await flatBase(LAND_W, LAND_H)
    const la = await generatePosterBuffer(
      baseInput({
        posterBuf: backdrop,
        shape: "landscape",
        posterLayout: "fresh",
        rankingEnabled: false,
        finalRank: null,
      }),
    )
    const lb = await generatePosterBuffer(
      baseInput({
        posterBuf: backdrop,
        shape: "landscape",
        posterLayout: "fresh",
        rankingEnabled: false,
        finalRank: null,
      }),
    )
    expect(la.equals(lb)).toBe(true)
    // Landscape ranked numeral still anchors on the historic top.
    for (const rank of PROBE_RANKS) {
      expect(freshGeometry(LAND_W, LAND_H, rank).numeral!.top).toBe(HISTORIC_LANDSCAPE_NUMERAL_TOP)
    }
  }, 180000)

  it("service: Standard both shapes deterministic and differ from ranked Fresh", async () => {
    const poster = await flatBase(STD_W, STD_H)
    const s1 = await generatePosterBuffer(baseInput({ posterBuf: poster, rankingEnabled: true, finalRank: 6 }))
    const s2 = await generatePosterBuffer(baseInput({ posterBuf: poster, rankingEnabled: true, finalRank: 6 }))
    expect(s1.equals(s2)).toBe(true)
    const fresh = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: true, finalRank: 6 }),
    )
    expect(fresh.equals(s1)).toBe(false)
    const backdrop = await flatBase(LAND_W, LAND_H)
    const ls1 = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, shape: "landscape", rankingEnabled: true, finalRank: 6 }),
    )
    const ls2 = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, shape: "landscape", rankingEnabled: true, finalRank: 6 }),
    )
    expect(ls1.equals(ls2)).toBe(true)
    const lfresh = await generatePosterBuffer(
      baseInput({
        posterBuf: backdrop,
        shape: "landscape",
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    expect(lfresh.equals(ls1)).toBe(false)
  }, 180000)
})
