import { describe, expect, it } from "vitest"
import { QUALITY_BADGE_STYLES, isQualityBadgeStyle, DEFAULT_QUALITY_BADGE_STYLE } from "@/lib/badge-styles"
import { qualityBadgeIconPath, QUALITY_TIERS, normalizeQualityTier } from "@/lib/quality-badge-styles"
import { mappingSchema, mappingUpdateSchema } from "@/lib/validation"
import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const ROOT = path.resolve(__dirname, "../..")

describe("quality badge styles", () => {
  it("exposes the standard/mono/color union with standard default", () => {
    expect([...QUALITY_BADGE_STYLES]).toEqual(["standard", "mono", "color"])
    expect(DEFAULT_QUALITY_BADGE_STYLE).toBe("standard")
    expect(isQualityBadgeStyle("mono")).toBe(true)
    expect(isQualityBadgeStyle("color")).toBe(true)
    expect(isQualityBadgeStyle("standard")).toBe(true)
    expect(isQualityBadgeStyle("bar")).toBe(false)
    expect(isQualityBadgeStyle(null)).toBe(false)
    expect(isQualityBadgeStyle(undefined)).toBe(false)
  })

  it("maps every style/tier to an existing SVG asset (standard has none)", () => {
    for (const tier of QUALITY_TIERS) {
      expect(qualityBadgeIconPath("standard", tier)).toBeNull()
    }
    for (const style of ["mono", "color"] as const) {
      for (const tier of QUALITY_TIERS) {
        const rel = qualityBadgeIconPath(style, tier)
        expect(rel, `${style}/${tier}`).toMatch(new RegExp(`^quality-badges/${style}/.+\\.svg$`))
        expect(fs.existsSync(path.join(ROOT, "public", rel!)), `missing asset: ${rel}`).toBe(true)
      }
    }
  })

  it("returns null for invalid style/tier", () => {
    expect(qualityBadgeIconPath(null, "4K")).toBeNull()
    expect(qualityBadgeIconPath("mono", null)).toBeNull()
    expect(qualityBadgeIconPath("mono", "8K")).toBeNull()
    expect(qualityBadgeIconPath("bar" as never, "4K")).toBeNull()
  })

  it("normalizes quality strings like 1080p, 4k, 2160p, 720p", () => {
    expect(normalizeQualityTier("1080p")).toBe("FHD")
    expect(normalizeQualityTier("1080P")).toBe("FHD")
    expect(normalizeQualityTier("4k")).toBe("4K")
    expect(normalizeQualityTier("2160p")).toBe("4K")
    expect(normalizeQualityTier("720p")).toBe("HD")
    expect(normalizeQualityTier("480p")).toBe("SD")
    expect(normalizeQualityTier("unknown")).toBeNull()
    expect(qualityBadgeIconPath("color", "1080p")).toMatch(/^quality-badges\/color\/full-hd.+icon\.svg$/)
  })

  it("mapping schemas accept the style, reject junk, keep legacy valid", () => {
    const base = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "mono" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: null }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "bar" }).success).toBe(false)
    expect(mappingSchema.safeParse(base).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "color" }).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "nope" }).success).toBe(false)
  })
})

describe("renderQualityIconBadge", () => {
  it("renders mono/color icons at the standard badge footprint with drop shadow, null on missing file", async () => {
    const { renderQualityIconBadge, __resetQualityIconCacheForTests } = await import("@/lib/poster-service")
    __resetQualityIconCacheForTests()
    // pw=500 → fs=22 → boxH=40; mono 4K (512x414.89) → icona 49x40 + pad
    // ombra simmetrico 14px (come la pill standard) → 77x68.
    const mono = await renderQualityIconBadge("quality-badges/mono/4k-label-icon.svg", 500, false)
    expect(mono).not.toBeNull()
    expect(mono!.w).toBe(77)
    expect(mono!.h).toBe(68)
    expect(mono!.png.length).toBeGreaterThan(100)
    // Color FHD con viewBox armonizzato (512x414.89) → icona 49x40 + pad → 77x68.
    const color = await renderQualityIconBadge("quality-badges/color/full-hd-icon.svg", 500, true)
    expect(color).not.toBeNull()
    expect(color!.w).toBe(77)
    expect(color!.h).toBe(68)
    // Missing file / traversal → null (il chiamante degrada sullo standard).
    expect(await renderQualityIconBadge("quality-badges/mono/nope.svg", 500, false)).toBeNull()
    expect(await renderQualityIconBadge("../secret.svg", 500, false)).toBeNull()
  })
})

/** Pixel chiari (tutti i canali >200) nella zona top-right. */
async function brightTopRight(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = 5; y < 100; y++) {
    for (let x = info.width - 150; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) n++
    }
  }
  return n
}

/** Pixel gialli (badge color) nella zona top-right. */
async function yellowTopRight(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = 5; y < 100; y++) {
    for (let x = info.width - 150; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 200 && data[i + 1] > 150 && data[i + 2] < 100) n++
    }
  }
  return n
}

function posterInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    quality: "4K",
    qualityBadgeStyle: "standard",
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

describe("quality icon badge on poster", () => {
  it("renders mono white on dark top, color badge and standard pill", async () => {
    const poster = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    }).jpeg().toBuffer()
    const mono = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: "mono" }))
    const std = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: "standard" }))
    const color = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: "color" }))
    // Mono su top scuro = icona bianca; standard = pill chiara.
    expect(await brightTopRight(mono)).toBeGreaterThan(50)
    expect(await brightTopRight(std)).toBeGreaterThan(50)
    // Color = badge giallo originale.
    expect(await yellowTopRight(color)).toBeGreaterThan(50)
  }, 30000)

  it("anchors icons on the same visible box as the standard pill", async () => {
    const poster = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    }).jpeg().toBuffer()
    // Ancora attesa del box visibile: bordo destro a CW-netPadX (476),
    // bordo alto a netBaseTop-5+pad (33). Tolleranza 3px (antialiasing/JPEG).
    const edge = async (buf: Buffer): Promise<{ right: number; top: number }> => {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let right = 0
      let top = info.height
      for (let y = 5; y < 120; y++) {
        for (let x = info.width - 160; x < info.width; x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) {
            if (x > right) right = x
            if (y < top) top = y
          }
        }
      }
      return { right, top }
    }
    for (const style of ["standard", "mono"] as const) {
      const buf = await generatePosterBuffer(posterInput({ posterBuf: poster, qualityBadgeStyle: style }))
      const e = await edge(buf)
      expect(e.right, `${style} right`).toBeGreaterThanOrEqual(476 - 3)
      expect(e.right, `${style} right`).toBeLessThanOrEqual(476 + 3)
      expect(e.top, `${style} top`).toBeGreaterThanOrEqual(33 - 3)
      expect(e.top, `${style} top`).toBeLessThanOrEqual(33 + 3)
    }
  }, 30000)

  it("stacks separate ratings under the icon on its center axis", async () => {
    const poster = await sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    }).jpeg().toBuffer()
    const sep = [{ id: "imdb", value: 8.5 }, { id: "tmdb", value: 7.2 }]
    const buf = await generatePosterBuffer(posterInput({
      posterBuf: poster, qualityBadgeStyle: "mono", separateRatings: sep,
    }))
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const bright = (x0: number, x1: number, y0: number, y1: number): number => {
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) n++
        }
      }
      return n
    }
    // Icona intatta in alto (bordo destro invariato) e stack sotto di essa
    // (sotto y=79) centrato sull'asse dell'icona (x 380..476).
    expect(bright(info.width - 160, info.width, 5, 75)).toBeGreaterThan(20)
    expect(bright(380, 476, 85, 260)).toBeGreaterThan(20)
  }, 30000)
})
