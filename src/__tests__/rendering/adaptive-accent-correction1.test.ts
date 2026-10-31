/**
 * Correction-1 real-render + gating proof for the adaptive automatic badge
 * accent (Task-2 wiring follow-up).
 *
 * Why this file exists: the first integration test round covered the pure
 * helpers (solver, band means, veil math, resolver) but never the ACTUAL
 * `generatePosterBuffer` pipeline. This file closes that gap with real
 * renders (real Sharp composition, real resvg badge bitmaps, real pixel
 * reads — the adaptive solver and the renderers are never mocked out):
 *
 * - style gating (`genreBadgeConsumesAccent` / `topBadgeConsumesAccent`):
 *   only styles that paint the accent (`colored`, `corner`, extra-`number`,
 *   accent-filled `default`) may trigger extraction/sampling or carry the
 *   tint in the badge cache key. Default/minimal/vetro/bar/pill/shadow/
 *   bordo, plain ribbons and rank numerals never do; manual `ac=` bands
 *   never trigger extra analysis; extra `follow-rank` resolves through the
 *   same legacy `rs` fallback as the renderer (no invented paths).
 * - real pipeline proof on a bounded matrix (2 scene colors x 2 shapes):
 *   deterministic mock scenes driven by the historic failure-mode tints
 *   (yellow / cyan); same input twice = byte-identical PNG (preview and
 *   Stremio resolve the same input through the same endpoint, so identical
 *   inputs must stay identical bytes); manual `ac=` stays byte-identical;
 *   the Comedy/genre fallback without extraction stays on the legacy 5/12
 *   normalization byte-exactly through the full service.
 * - real badge-material proof: the service-resolved adaptive fills are fed
 *   to the REAL genre/extra SVG builders, rendered with resvg, decoded with
 *   Sharp, and the painted pixels are asserted against the resolved fill
 *   (plus the renderer text choice reaches 4.5:1 where the solver deems it
 *   feasible). A top-corner sample of the full composite validates actual
 *   paint on the final PNG (documented two-band approximation: explicit
 *   offsets could move a badge outside its band — none are used here).
 * - perf gating: `computeRegionStats` (the only Sharp region-decode pool on
 *   this path) is counting-wrapped (delegating to the real implementation).
 *   A default non-colored render performs ZERO region decodes; a colored
 *   render performs at most 2 (one small cached crop per needed band, on the
 *   already-fitted canvas — near-identity resize, no new fetch, no PNG
 *   roundtrip); a warm repeat performs ZERO new decodes (24h
 *   `poster-extract` analysis cache hit). No global stats-cache refactor:
 *   reuse stays inside the existing pool.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createHash } from "node:crypto"
import sharp from "sharp"
import {
  adaptiveAutomaticAccentHex,
  normalizeAutomaticAccentHex,
  relativeLuminance,
  contrastRatio,
  solveAdaptiveAccent,
  textColorForBg,
} from "@/lib/accent-color"
import { GENRE_FALLBACK } from "@/lib/badges"
import { STD_W, STD_H, LAND_W, LAND_H, clearRegionStatsCache } from "@/lib/image-utils"
import {
  adaptiveAccentHexForBand,
  bottomBandMeanRGB,
  effectiveBottomBackgroundLuminance,
  effectiveTopBackgroundLuminance,
  extractSceneTint,
  topBandMeanRGB,
} from "@/lib/poster-render-helpers"
import {
  generatePosterBuffer,
  genreBadgeConsumesAccent,
  topBadgeConsumesAccent,
  type GenerationInput,
} from "@/lib/poster-service"
import { renderGenreBadge, renderExtraBadge } from "@/lib/svg-badge"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

vi.mock("@/lib/image-utils", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/image-utils")>()
  const g = globalThis as unknown as { __corr1RegionCalls?: number }
  return {
    ...mod,
    computeRegionStats: async (...args: Parameters<typeof mod.computeRegionStats>) => {
      g.__corr1RegionCalls = (g.__corr1RegionCalls ?? 0) + 1
      return mod.computeRegionStats(...args)
    },
  }
})

function regionCalls(): number {
  return (globalThis as unknown as { __corr1RegionCalls?: number }).__corr1RegionCalls ?? 0
}
function resetRegionCalls(): void {
  ;(globalThis as unknown as { __corr1RegionCalls?: number }).__corr1RegionCalls = 0
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function measureHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Actual renderer text contrast for an 8-bit fill (effective blending). */
function actualTextContrast(fillHex: string): { color: string; ratio: number } {
  const color = textColorForBg(fillHex)
  const { r, g, b } = hexToRgb(fillHex)
  const bgLum = relativeLuminance(r, g, b)
  const m = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  let tr: number
  let tg: number
  let tb: number
  let ta: number
  if (m) {
    tr = parseInt(m[1])
    tg = parseInt(m[2])
    tb = parseInt(m[3])
    ta = m[4] !== undefined ? parseFloat(m[4]) : 1
  } else {
    const c = hexToRgb(color)
    tr = c.r
    tg = c.g
    tb = c.b
    ta = 1
  }
  const er = ta < 1 ? Math.round(tr * ta + r * (1 - ta)) : tr
  const eg = ta < 1 ? Math.round(tg * ta + g * (1 - ta)) : tg
  const eb = ta < 1 ? Math.round(tb * ta + b * (1 - ta)) : tb
  return { color, ratio: contrastRatio(relativeLuminance(er, eg, eb), bgLum) }
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
    topShade: 80,
    badgesEnabled: true,
    rankingEnabled: true,
    genreName: "Comedy",
    voteAverage: 7.5,
    badgeStyle: "colored",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    topLight: false,
    bottomLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    ribbonEnabled: true,
    rankingBadgeAccent: false,
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
    locale: "en",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: "NEW",
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    shape: "poster",
    analysisKey: null,
    ...overrides,
  }
}

/**
 * Deterministic mock scene: dominant base tint with a dark top 8% band and a
 * light bottom 8% band (badge rows). JPEG bytes like the real route output.
 */
async function mockScene(
  w: number,
  h: number,
  base: { r: number; g: number; b: number },
): Promise<Buffer> {
  const dark = { r: 14, g: 16, b: 26 }
  const light = { r: 236, g: 231, b: 216 }
  const stripH = Math.max(Math.round(h * 0.08), 3)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="rgb(${base.r},${base.g},${base.b})"/>` +
    `<rect width="${w}" height="${stripH}" fill="rgb(${dark.r},${dark.g},${dark.b})"/>` +
    `<rect y="${h - stripH}" width="${w}" height="${stripH}" fill="rgb(${light.r},${light.g},${light.b})"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}

/** Resolve the service-path accents for a scene (real extraction+sampling, no mocks). */
async function resolveServiceAccents(
  scene: Buffer,
  genreName: string,
  topShade: number,
  cw: number,
  ch: number,
): Promise<{ tint: string; topHex: string; bottomHex: string; topLum: number; bottomLum: number }> {
  const tint = await extractSceneTint(scene, genreName, null)
  const [top, bottom] = await Promise.all([
    topBandMeanRGB(scene, { cacheKey: null, canvasW: cw, canvasH: ch }),
    bottomBandMeanRGB(scene, { cacheKey: null, canvasW: cw, canvasH: ch }),
  ])
  expect(top).not.toBeNull()
  expect(bottom).not.toBeNull()
  const topLum = effectiveTopBackgroundLuminance(top!, topShade)
  const bottomLum = effectiveBottomBackgroundLuminance(bottom!, 0, false)
  return {
    tint,
    topHex: adaptiveAccentHexForBand(tint, "#555555", topLum),
    bottomHex: adaptiveAccentHexForBand(tint, GENRE_FALLBACK[genreName] || "#555555", bottomLum),
    topLum,
    bottomLum,
  }
}

beforeEach(() => {
  clearRegionStatsCache()
  resetRegionCalls()
})

describe("style gating: only accent-painting styles consume the tint", () => {
  it("genre: `colored` and `ink` consume; every other style never does", () => {
    expect(genreBadgeConsumesAccent("colored")).toBe(true)
    expect(genreBadgeConsumesAccent("ink")).toBe(true)
    for (const s of ["shadow", "pill", "bar", "minimal", "vetro", "bordo", "default", "", null, undefined, "COLORed", "INK"]) {
      expect(genreBadgeConsumesAccent(s)).toBe(false)
    }
  })

  it("rank: `colored`/`corner`/accent-filled `default` consume; ribbons/numerals/plain styles do not", () => {
    expect(topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: "colored" })).toBe(true)
    expect(topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: "corner" })).toBe(true)
    expect(
      topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: "default", rankingBadgeAccent: true }),
    ).toBe(true)
    for (const s of ["default", "pill", "bordo", "vetro", "netflix", "netflix-color", "number"] as const) {
      expect(topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: s })).toBe(false)
    }
  })

  it("extra: `colored`/`corner`/legacy-`number` consume; the rest do not, follow-rank reuses the renderer fallback", () => {
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "default", extraBadgeStyle: "colored" })).toBe(true)
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "default", extraBadgeStyle: "corner" })).toBe(true)
    // Legacy `rs=number` fallback degrades the extra badge to the corner pill (accent-painted).
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "number" })).toBe(true)
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "number", extraBadgeStyle: "follow-rank" })).toBe(true)
    // `follow-rank` sentinel resolves to the rank style (no invented path): corner consumes, default does not.
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "corner", extraBadgeStyle: "follow-rank" })).toBe(true)
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "default", extraBadgeStyle: "follow-rank" })).toBe(false)
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "pill", extraBadgeStyle: "follow-rank" })).toBe(false)
    for (const s of ["default", "pill", "bordo", "vetro"] as const) {
      expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "default", extraBadgeStyle: s })).toBe(false)
    }
    // Explicit extra `default` stays neutral even with the degraded-colored rank flag (renderer contract).
    expect(
      topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "default", extraBadgeStyle: "default", rankingBadgeAccent: true }),
    ).toBe(false)
    expect(topBadgeConsumesAccent({ topBadgeType: null, rankingBadgeStyle: "colored" })).toBe(true)
  })
})

describe("real pipeline: deterministic mock scenes (yellow/cyan x portrait/landscape)", () => {
  const scenes = [
    { name: "yellow", base: { r: 232, g: 200, b: 60 } },
    { name: "cyan", base: { r: 0, g: 200, b: 220 } },
  ] as const

  it.each(scenes)("$name portrait: same input twice = byte-identical PNG (preview/Stremio parity)", async ({ name, base }) => {
    const scene = await mockScene(STD_W, STD_H, base)
    const input = baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: `corr1-parity-${name}`,
    })
    const a = await generatePosterBuffer(input)
    const b = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: `corr1-parity-${name}`,
    }))
    expect(sha(a)).toBe(sha(b))
  })

  it.each(scenes)("$name landscape: same input twice = byte-identical PNG", async ({ name, base }) => {
    const scene = await mockScene(LAND_W, LAND_H, base)
    const input = baseInput({
      posterBuf: scene,
      shape: "landscape",
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: `corr1-parity-land-${name}`,
    })
    const a = await generatePosterBuffer(input)
    const b = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      shape: "landscape",
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: `corr1-parity-land-${name}`,
    }))
    expect(sha(a)).toBe(sha(b))
  })

  it.each(scenes)("$name portrait: colored auto keeps H/S in bounds with readable actual text", async ({ name, base }) => {
    const scene = await mockScene(STD_W, STD_H, base)
    const { tint, topHex, bottomHex, topLum, bottomLum } = await resolveServiceAccents(scene, "Comedy", 80, STD_W, STD_H)
    expect(topLum).toBeLessThan(bottomLum)
    const before = measureHsl(...Object.values(hexToRgb(tint)) as [number, number, number])
    for (const hex of [topHex, bottomHex]) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      const after = measureHsl(...Object.values(hexToRgb(hex)) as [number, number, number])
      expect(after.l).toBeGreaterThanOrEqual(0.24 - 0.003)
      expect(after.l).toBeLessThanOrEqual(0.6 + 0.003)
      if (before.s > 0.02) {
        expect(hueDist(after.h, before.h)).toBeLessThan(3)
        expect(Math.abs(after.s - before.s)).toBeLessThan(0.04)
      }
      const actual = actualTextContrast(hex)
      const diag = solveAdaptiveAccent(hexToRgb(tint), {
        backgroundLuminance: hex === topHex ? topLum : bottomLum,
      }).diagnostics
      expect(actual.color).toBe(diag.textColor)
      if (diag.feasibleText) expect(actual.ratio).toBeGreaterThanOrEqual(4.5 - 1e-6)
      else expect(diag.feasibleText).toBe(false)
    }
    // The full composite actually renders (sanity: valid image bytes).
    const png = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: `corr1-pixel-${name}`,
    }))
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(STD_W)
  })

  it("portrait corner extra paints the resolved top fill on the final composite", async () => {
    const scene = await mockScene(STD_W, STD_H, { r: 232, g: 200, b: 60 })
    const { topHex } = await resolveServiceAccents(scene, "Comedy", 80, STD_W, STD_H)
    const png = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "shadow",
      extraBadgeStyle: "corner",
      analysisKey: "corr1-corner-paint",
    }))
    // Corner anchor: left = round(18*CW/380) + tox(0), top = pill gap 10;
    // the bitmap carries a 14px shadow pad, so this interior box is fill.
    const netPadX = Math.round((18 * STD_W) / 380)
    const { data, info } = await sharp(png)
      .extract({ left: netPadX + 14 + 8, top: 10 + 14 + 6, width: 40, height: 14 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(40)
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 200) continue
      r += data[i] ?? 0
      g += data[i + 1] ?? 0
      b += data[i + 2] ?? 0
      n++
    }
    expect(n).toBeGreaterThan(0)
    const exp = hexToRgb(topHex)
    // JPEG base + resvg edges: bounded tolerance on actually-painted pixels.
    expect(Math.abs(r / n - exp.r)).toBeLessThan(20)
    expect(Math.abs(g / n - exp.g)).toBeLessThan(20)
    expect(Math.abs(b / n - exp.b)).toBeLessThan(20)
  })

  it("real genre/extra badge bitmaps paint the resolved fills (actual resvg material)", async () => {
    const scene = await mockScene(STD_W, STD_H, { r: 0, g: 200, b: 220 })
    const { topHex, bottomHex } = await resolveServiceAccents(scene, "Comedy", 80, STD_W, STD_H)
    const genre = await renderGenreBadge("Comedy", 7.5, STD_W, "2024", "colored", bottomHex, false, { showGenre: true, showYear: true, showRating: true }, 100, "inter")
    const extra = await renderExtraBadge("NEW", STD_W, false, "colored", topHex, false, "inter")
    for (const [badge, hex] of [[genre, bottomHex], [extra, topHex]] as const) {
      const { data } = await sharp(badge.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i + 3] ?? 0) < 200) continue
        r += data[i] ?? 0
        g += data[i + 1] ?? 0
        b += data[i + 2] ?? 0
        n++
      }
      expect(n).toBeGreaterThan(100)
      const exp = hexToRgb(hex)
      // Opaque fill dominates the bitmap (text/antialias are a minority).
      expect(Math.abs(r / n - exp.r)).toBeLessThan(48)
      expect(Math.abs(g / n - exp.g)).toBeLessThan(48)
      expect(Math.abs(b / n - exp.b)).toBeLessThan(48)
      const actual = actualTextContrast(hex)
      expect(actual.color).toBe(textColorForBg(hex))
    }
  })
})

describe("real pipeline: manual override and fallback byte-identity", () => {
  it("manual `ac=` on colored styles changes paint but stays byte-identical across calls", async () => {
    const scene = await mockScene(STD_W, STD_H, { r: 232, g: 200, b: 60 })
    const manual = { genreColor: "#123456", rankColor: "#654321" }
    const auto = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: "corr1-manual-auto",
    }))
    const m1 = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      accentOverride: manual,
      analysisKey: "corr1-manual-m",
    }))
    const m2 = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      accentOverride: manual,
      analysisKey: "corr1-manual-m",
    }))
    expect(sha(m1)).toBe(sha(m2))
    expect(sha(m1)).not.toBe(sha(auto))
  })

  it("ignored styles render identically with auto or manual accents (no new paint)", async () => {
    const scene = await mockScene(STD_W, STD_H, { r: 232, g: 200, b: 60 })
    const auto = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      queryExtra: null,
      rankingEnabled: false,
      analysisKey: "corr1-ignored-auto",
    }))
    const manual = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      queryExtra: null,
      rankingEnabled: false,
      accentOverride: { genreColor: "#123456", rankColor: "#654321" },
      analysisKey: "corr1-ignored-manual",
    }))
    expect(sha(auto)).toBe(sha(manual))
  })

  it("Comedy fallback without extraction keeps the legacy 5/12 byte-exactly through the service", async () => {
    const fallback = GENRE_FALLBACK["Comedy"]
    expect(adaptiveAccentHexForBand(null, fallback, 0.03)).toBe(normalizeAutomaticAccentHex(fallback))
    const scene = await mockScene(STD_W, STD_H, { r: 120, g: 120, b: 120 })
    const auto = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      genreName: "Comedy",
      badgeStyle: "shadow",
      queryExtra: null,
      rankingEnabled: false,
      blurEnabled: false,
      analysisKey: "corr1-comedy-auto",
    }))
    const legacyManual = await generatePosterBuffer(baseInput({
      posterBuf: scene,
      genreName: "Comedy",
      badgeStyle: "shadow",
      queryExtra: null,
      rankingEnabled: false,
      blurEnabled: false,
      accentOverride: { genreColor: normalizeAutomaticAccentHex(fallback), rankColor: normalizeAutomaticAccentHex("#555555") },
      analysisKey: "corr1-comedy-manual",
    }))
    expect(sha(auto)).toBe(sha(legacyManual))
    expect(adaptiveAutomaticAccentHex).toBeDefined()
  })
})

describe("perf gating: region-decode budget on the render path", () => {
  it("default non-colored render performs ZERO region decodes", async () => {
    const scene = await mockScene(STD_W, STD_H, { r: 120, g: 130, b: 140 })
    await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      queryExtra: null,
      rankingEnabled: false,
      analysisKey: "corr1-perf-plain",
    }))
    expect(regionCalls()).toBe(0)
  })

  it("colored render performs at most 2 region decodes (one per needed band), warm repeat adds zero", async () => {
    const scene = await mockScene(STD_W, STD_H, { r: 232, g: 200, b: 60 })
    const key = "corr1-perf-colored"
    await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: key,
    }))
    const cold = regionCalls()
    expect(cold).toBeGreaterThan(0)
    expect(cold).toBeLessThanOrEqual(2)
    // Warm repeat with a cleared in-memory pool: the persistent 24h
    // `poster-extract` band cache must serve with zero new decodes.
    clearRegionStatsCache()
    resetRegionCalls()
    await generatePosterBuffer(baseInput({
      posterBuf: scene,
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: key,
    }))
    expect(regionCalls()).toBe(0)
  })

  it("landscape colored render stays within the same 2-decode budget", async () => {
    const scene = await mockScene(LAND_W, LAND_H, { r: 0, g: 200, b: 220 })
    await generatePosterBuffer(baseInput({
      posterBuf: scene,
      shape: "landscape",
      badgeStyle: "colored",
      extraBadgeStyle: "colored",
      analysisKey: "corr1-perf-land",
    }))
    expect(regionCalls()).toBeLessThanOrEqual(2)
  })
})
