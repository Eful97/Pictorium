/**
 * Automatic badge accent at fixed HSL lightness 5/12 (Windows dialog
 * 100/240), hue-independent — detected-tint hue/saturation stay intact.
 * Manual overrides (`ac=`, `accentOverride`) never go through
 * normalization; blur/scene tint/edges stay natural.
 */
import sharp from "sharp"
import { describe, it, expect, beforeEach } from "vitest"
import {
  AUTO_BADGE_ACCENT_LIGHTNESS,
  findSceneTint,
  isManualAccent,
  normalizeAutomaticAccent,
  normalizeAutomaticAccentHex,
} from "@/lib/accent-color"
import { extractSceneTint } from "@/lib/poster-render-helpers"
import { sampleCustomImageColors } from "@/lib/custom-colors"
import { __resetCustomImageStateForTests } from "@/lib/custom-poster-base"
import { __resetImageBytesForTest } from "@/lib/image-bytes-cache"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { renderGenreBadge } from "@/lib/svg-badge"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import { GENRE_FALLBACK } from "@/lib/badges"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const TARGET_L = 5 / 12

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

function toHex(c: { r: number; g: number; b: number }): string {
  const p = (n: number) => Math.round(n).toString(16).padStart(2, "0")
  return `#${p(c.r)}${p(c.g)}${p(c.b)}`
}

/** Max per-channel distance between two hexes (pipeline quantization). */
function channelDist(a: string, b: string): number {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b))
}

/** Independent HSL (same math as accent-color.ts) to measure the output. */
function measureHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2, d = max - min
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

function createSolidRawRgba(w: number, h: number, r: number, g: number, b: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = 255
  }
  return buf
}

describe("normalizeAutomaticAccent (HSL 5/12, hue/sat preserved)", () => {
  it("exposes the Windows 100/240 = 5/12 target", () => {
    expect(AUTO_BADGE_ACCENT_LIGHTNESS).toBeCloseTo(100 / 240, 12)
    expect(AUTO_BADGE_ACCENT_LIGHTNESS).toBeCloseTo(TARGET_L, 12)
  })

  it.each([
    ["colorful teal", { r: 81, g: 149, b: 163 }],
    ["dark navy", { r: 22, g: 30, b: 52 }],
    ["light amber", { r: 229, g: 142, b: 38 }],
    ["saturated red", { r: 200, g: 30, b: 30 }],
    ["genre fallback", hexToRgb(GENRE_FALLBACK["Dramma"] || "#5D6D7E")],
    ["unknown gray", { r: 85, g: 85, b: 85 }],
  ])("%s -> L = 5/12 within quantization, hue/sat intact", (_label, input) => {
    const before = measureHsl(input.r, input.g, input.b)
    const out = normalizeAutomaticAccent(input)
    const after = measureHsl(out.r, out.g, out.b)
    // Lightness at target within RGB quantization (< 0.002).
    expect(Math.abs(after.l - TARGET_L)).toBeLessThan(0.002)
    // Detected-tint hue and saturation stay.
    expect(hueDist(after.h, before.h)).toBeLessThan(2)
    expect(Math.abs(after.s - before.s)).toBeLessThan(0.02)
  })

  it("achromatic gray -> neutral gray at L = 5/12", () => {
    const out = normalizeAutomaticAccent({ r: 128, g: 128, b: 128 })
    expect(out.r).toBe(out.g)
    expect(out.g).toBe(out.b)
    expect(Math.abs(measureHsl(out.r, out.g, out.b).l - TARGET_L)).toBeLessThan(0.002)
  })

  it("white/black -> same neutral gray (s = 0, undefined hue)", () => {
    expect(normalizeAutomaticAccent({ r: 255, g: 255, b: 255 })).toEqual(
      normalizeAutomaticAccent({ r: 0, g: 0, b: 0 }),
    )
  })

  it("is idempotent", () => {
    const once = normalizeAutomaticAccent({ r: 81, g: 149, b: 163 })
    expect(normalizeAutomaticAccent(once)).toEqual(once)
    expect(normalizeAutomaticAccentHex(normalizeAutomaticAccentHex("#5195a3"))).toBe(
      normalizeAutomaticAccentHex("#5195a3"),
    )
  })
})

describe("normalizeAutomaticAccentHex (#rrggbb paths)", () => {
  it("normalizes genre/unknown/error fallbacks", () => {
    for (const hex of [
      GENRE_FALLBACK["Dramma"] || "#5D6D7E",
      GENRE_FALLBACK["Comedy"] || "#F4D03F",
      "#555555",
      "#c02020",
    ]) {
      const out = normalizeAutomaticAccentHex(hex)
      expect(out).toMatch(/^#[0-9a-f]{6}$/)
      const { r, g, b } = hexToRgb(out)
      expect(Math.abs(measureHsl(r, g, b).l - TARGET_L)).toBeLessThan(0.002)
    }
  })

  it("returns malformed inputs intact (never an invented color)", () => {
    expect(normalizeAutomaticAccentHex("red")).toBe("red")
    expect(normalizeAutomaticAccentHex("")).toBe("")
    expect(normalizeAutomaticAccentHex("#fff")).toBe("#fff")
    expect(normalizeAutomaticAccentHex("#5195a")).toBe("#5195a")
  })
})

describe("badge/blur separation (natural tint unchanged)", () => {
  it("findSceneTint stays natural: the normalized value differs only in L", () => {
    const raw = createSolidRawRgba(100, 100, 81, 149, 163)
    const natural = findSceneTint(raw, 100, 100, "Dramma")
    expect(natural).toEqual({ r: 81, g: 149, b: 163 })
    const badge = normalizeAutomaticAccent(natural)
    expect(badge).not.toEqual(natural)
    expect(hueDist(measureHsl(badge.r, badge.g, badge.b).h, measureHsl(81, 149, 163).h)).toBeLessThan(2)
  })

  it("extractSceneTint stays natural (blur source)", async () => {
    const png = await sharp({
      create: { width: 200, height: 300, channels: 3, background: { r: 81, g: 149, b: 163 } },
    })
      .png()
      .toBuffer()
    const tint = await extractSceneTint(png, "Dramma", null)
    expect(tint).toBe("#5195a3")
    expect(normalizeAutomaticAccentHex(tint)).not.toBe(tint)
  })

  it("isManualAccent stays correct with the normalized auto reference", () => {
    const auto = normalizeAutomaticAccentHex("#5195a3")
    expect(isManualAccent(auto, auto)).toBe(false)
    expect(isManualAccent(auto.toUpperCase(), auto)).toBe(false)
    expect(isManualAccent("#e74c3c", auto)).toBe(true)
    expect(isManualAccent(null, auto)).toBe(false)
  })
})

describe("sampleCustomImageColors (normalized accent, natural edges)", () => {
  function imageResponse(body: Buffer, contentType: string): Response {
    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": contentType },
    })
  }

  beforeEach(() => {
    __resetImageBytesForTest()
    __resetCustomImageStateForTests()
  })

  it("accent at L = 5/12 with source hue, top/bottom = natural averages", async () => {
    const png = await sharp({
      create: { width: 200, height: 300, channels: 3, background: { r: 200, g: 100, b: 20 } },
    })
      .png()
      .toBuffer()
    const colors = await sampleCustomImageColors(
      "https://assets.fanart.tv/fanart/movies/1/movieposter/a.jpg",
      "Dramma",
      AbortSignal.timeout(60_000),
      {
        checkBlocked: async () => false,
        fetchRemote: async () => imageResponse(png, "image/png"),
      },
    )
    expect(colors).not.toBeNull()
    const accent = hexToRgb(colors!.accent)
    const src = measureHsl(200, 100, 20)
    expect(Math.abs(measureHsl(accent.r, accent.g, accent.b).l - TARGET_L)).toBeLessThan(0.002)
    expect(hueDist(measureHsl(accent.r, accent.g, accent.b).h, src.h)).toBeLessThan(2)
    // Natural edges: edge averages = source (solid) color, not normalized.
    for (const edge of [colors!.topEdge, colors!.bottomEdge]) {
      const { r, g, b } = hexToRgb(edge)
      expect(Math.abs(r - 200)).toBeLessThanOrEqual(2)
      expect(Math.abs(g - 100)).toBeLessThanOrEqual(2)
      expect(Math.abs(b - 20)).toBeLessThanOrEqual(2)
    }
  })
})

describe("poster-service (normalized auto badge, manual intact, separate blur)", () => {
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
      rankingEnabled: false,
      genreName: "Dramma",
      voteAverage: null,
      badgeStyle: "colored",
      rankingBadgeStyle: "default",
      badgeGenre: true,
      badgeYear: false,
      badgeRating: false,
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
      releaseDate: null,
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
      ...overrides,
    }
  }

  async function tealPoster(): Promise<Buffer> {
    return sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: { r: 81, g: 149, b: 163 } },
    })
      .png()
      .toBuffer()
  }

  /** Pixels in the badge band within ±tol of the target (flat fill). */
  async function countNear(
    buf: Buffer,
    target: { r: number; g: number; b: number },
    tol = 1,
  ): Promise<number> {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let n = 0
    for (let y = info.height - 95; y < info.height - 4; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        if (
          Math.abs(data[i] - target.r) <= tol &&
          Math.abs(data[i + 1] - target.g) <= tol &&
          Math.abs(data[i + 2] - target.b) <= tol
        ) {
          n++
        }
      }
    }
    return n
  }

  async function pixel(buf: Buffer, x: number, y: number): Promise<string> {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const i = (y * info.width + x) * 4
    return toHex({ r: data[i], g: data[i + 1], b: data[i + 2] })
  }

  /** Dominant color of opaque pixels (flat badge fill). */
  async function opaqueMode(png: Buffer): Promise<string> {
    const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const counts = new Map<string, number>()
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      const hex = toHex({ r: data[i], g: data[i + 1], b: data[i + 2] })
      counts.set(hex, (counts.get(hex) ?? 0) + 1)
    }
    let best = ""
    let bestN = -1
    for (const [hex, n] of counts) {
      if (n > bestN) {
        bestN = n
        best = hex
      }
    }
    return best
  }

  it("automatic badge at L = 5/12 with the poster teal hue", async () => {
    const poster = await tealPoster()
    const out = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    // Scene tint of the solid buffer = the teal itself (like extractSceneTint);
    // the automatic badge is its normalization to L = 5/12.
    const expected = normalizeAutomaticAccent({ r: 81, g: 149, b: 163 })
    const m = measureHsl(expected.r, expected.g, expected.b)
    expect(Math.abs(m.l - TARGET_L)).toBeLessThan(0.002)
    expect(hueDist(m.h, measureHsl(81, 149, 163).h)).toBeLessThan(2)
    expect(await countNear(out, expected)).toBeGreaterThan(2000)
  }, 90000)

  it("manual override stays byte-identical (exact badge layer)", async () => {
    // The badge layer receives the manual color intact: flat fill without
    // normalization (the renderer never normalizes). Tolerance ±1:
    // the badge drop-shadow filter quantizes the bitmap by 1 level
    // (pre-existing pipeline behavior, not from normalization:
    // a normalization would shift by ~40 levels, see test below).
    const genreParts = { showGenre: true, showYear: false, showRating: false }
    for (const [label, color] of [
      ["manual red", "#e74c3c"],
      ["manual = natural tint", "#5195a3"],
    ] as const) {
      const badge = await renderGenreBadge("Dramma", 0, 380, undefined, "colored", color, false, genreParts)
      const mode = await opaqueMode(badge.png)
      expect(channelDist(mode, color), label).toBeLessThanOrEqual(1)
    }
    // ...and the normalized auto passes through intact like any other accent.
    const autoHex = toHex(normalizeAutomaticAccent({ r: 81, g: 149, b: 163 }))
    const autoBadge = await renderGenreBadge("Dramma", 0, 380, undefined, "colored", autoHex, false, genreParts)
    expect(channelDist(await opaqueMode(autoBadge.png), autoHex)).toBeLessThanOrEqual(1)
  }, 90000)

  it("manual override at render: no normalization applied", async () => {
    const poster = await tealPoster()
    const manual = { r: 0xe7, g: 0x4c, b: 0x3c }
    const out = await generatePosterBuffer(
      baseInput({ posterBuf: poster, accentOverride: { genreColor: "#e74c3c", rankColor: "#e74c3c" } }),
    )
    // Tolerance ±6 for global vignetting (pre-existing, same for
    // every style): the fill stays the manual color, never the normalized one.
    expect(await countNear(out, manual, 6)).toBeGreaterThan(2000)
    expect(await countNear(out, normalizeAutomaticAccent(manual), 6)).toBeLessThan(200)
  }, 90000)

  it("identical blur between auto and manual-natural (normalized badge, blur not)", async () => {
    const poster = await tealPoster()
    const naturalTint = await extractSceneTint(poster, "Dramma", null)
    expect(naturalTint).toBe("#5195a3")
    const auto = await generatePosterBuffer(baseInput({ posterBuf: poster, blurEnabled: true }))
    const manualNatural = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        blurEnabled: true,
        accentOverride: { genreColor: naturalTint, rankColor: naturalTint },
      }),
    )
    const { info } = await sharp(auto).toBuffer({ resolveWithObject: true })
    // Lower corner outside the centered badge: blur band in both renders.
    const blurAuto = await pixel(auto, 5, info.height - 10)
    const blurManual = await pixel(manualNatural, 5, info.height - 10)
    expect(blurAuto).toBe(blurManual)
    // ...but the automatic badge is normalized while the manual one stays
    // natural: the two fills differ (the blur does not).
    expect(normalizeAutomaticAccentHex(naturalTint)).not.toBe(naturalTint)
  }, 120000)
})
