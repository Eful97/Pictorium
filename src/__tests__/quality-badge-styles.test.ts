import { describe, expect, it } from "vitest"
import { QUALITY_BADGE_STYLES, isQualityBadgeStyle, DEFAULT_QUALITY_BADGE_STYLE } from "@/lib/badge-styles"
import { qualityBadgeIconPath, QUALITY_TIERS, normalizeQualityTier } from "@/lib/quality-badge-styles"
import { buildQualityKnockoutSvg, buildQualityBadgeSvg } from "@/lib/badge-svg-shared"
import type { VideoFormat } from "@/lib/av-specs"
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
  it("exposes the standard/mono/color/knockout union with standard default", () => {
    expect([...QUALITY_BADGE_STYLES]).toEqual(["standard", "mono", "color", "knockout"])
    expect(DEFAULT_QUALITY_BADGE_STYLE).toBe("standard")
    expect(isQualityBadgeStyle("mono")).toBe(true)
    expect(isQualityBadgeStyle("color")).toBe(true)
    expect(isQualityBadgeStyle("standard")).toBe(true)
    expect(isQualityBadgeStyle("knockout")).toBe(true)
    expect(isQualityBadgeStyle("bar")).toBe(false)
    expect(isQualityBadgeStyle(null)).toBe(false)
    expect(isQualityBadgeStyle(undefined)).toBe(false)
  })

  it("maps every style/tier to an existing SVG asset (standard and knockout have none)", () => {
    for (const tier of QUALITY_TIERS) {
      expect(qualityBadgeIconPath("standard", tier)).toBeNull()
      expect(qualityBadgeIconPath("knockout", tier)).toBeNull()
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
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "knockout" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: null }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, qualityBadgeStyle: "bar" }).success).toBe(false)
    expect(mappingSchema.safeParse(base).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "color" }).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ qualityBadgeStyle: "knockout" }).success).toBe(true)
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

describe("quality knockout tag", () => {
  it("builds a masked white tag with no stroke or gradient", () => {
    expect(buildQualityKnockoutSvg("4K", 17).svg).toContain("<mask")
    const { svg, w, h } = buildQualityKnockoutSvg("4K", 17)
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('fill="#000000"')
    expect(svg).toContain("4K")
    expect(svg).not.toContain("stroke")
    expect(svg).not.toContain("linearGradient")
    expect(w).toBeGreaterThan(h)
    // Oversized cutout glyphs inside the unchanged tag box: same outer
    // metrics as the standard pill, mask text larger than the box font.
    const std = buildQualityBadgeSvg("4K", 17, "", "", false)
    expect(w).toBe(std.w)
    expect(h).toBe(std.h)
    expect(svg).toContain('font-size="23"')
    // Pinned textLength follows the oversized glyphs (30 > base 22), so
    // the cutout fills the interior instead of the old small glyphs.
    expect(svg).toContain('textLength="30"')
  })

  it("keeps the tag box for every tier while oversizing the mask glyphs", () => {
    for (const tier of ["4K", "FHD", "HD", "SD"] as const) {
      for (const font of ["inter", "barlow-condensed", "oswald"] as const) {
        const ko = buildQualityKnockoutSvg(tier, 17, font)
        const std = buildQualityBadgeSvg(tier, 17, "", "", false, font)
        expect(ko.w).toBe(std.w)
        expect(ko.h).toBe(std.h)
        // Mask glyphs render at ~1.35x the box font, never the box size.
        expect(ko.svg).toContain('font-size="23"')
        expect(ko.svg).not.toContain('font-size="17"')
      }
    }
  })

  it("rasterizes transparent glyphs over an opaque white tag (mask support)", async () => {
    const { renderQualityKnockoutBadge, renderQualityBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    const ko = await renderQualityKnockoutBadge("4K", pw)
    const std = await renderQualityBadge("4K", pw, false)
    async function glyphStats(png: Buffer, w: number, h: number, rx: number) {
      const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      // Sample strictly inside the rounded tag (2px inset, corners cut by
      // the corner radius): edge antialiasing and square box corners must
      // not count as glyph cutouts.
      const ox = PAD + 2
      const oy = PAD + 2
      const W = w - PAD * 2 - 4
      const H = h - PAD * 2 - 4
      const inside = (x: number, y: number): boolean => {
        const cx = Math.min(Math.max(x, ox + rx), ox + W - rx)
        const cy = Math.min(Math.max(y, oy + rx), oy + H - rx)
        return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rx * rx
      }
      let eq0 = 0
      let bandEq0 = 0
      let whiteOpaque = 0
      const eq0Spots: Array<[number, number]> = []
      for (let y = oy; y < oy + H; y++) {
        for (let x = ox; x < ox + W; x++) {
          if (!inside(x, y)) continue
          const i = (y * w + x) * 4
          if (data[i + 3] === 0) {
            eq0++
            eq0Spots.push([x, y])
            // Text band around the vertical center: holes must be glyphs.
            if (y >= oy + H / 2 - 8 && y <= oy + H / 2 + 8) bandEq0++
          }
          if (data[i + 3] > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) whiteOpaque++
        }
      }
      return { eq0, bandEq0, whiteOpaque, eq0Spots }
    }
    // Glyph holes are fully transparent (alpha 0) clustered in the text
    // band; the shared shadow only bleeds at hole edges, never fills them.
    // Oversized cutout glyphs (~1.35x): hundreds of hole pixels, far above
    // the old small-glyph floor.
    const koStats = await glyphStats(ko.png, ko.w, ko.h, Math.round((ko.h - PAD * 2) * 0.3))
    expect(koStats.eq0).toBeGreaterThan(100)
    expect(koStats.bandEq0).toBeGreaterThan(100)
    expect(koStats.whiteOpaque).toBeGreaterThan(500)
    // Compositing proof: holes show the background, the tag body covers it.
    const holeSpots = koStats.eq0Spots.slice(0, 200)
    expect(holeSpots.length).toBeGreaterThan(20)
    for (const bg of [{ r: 212, g: 0, b: 0 }, { r: 26, g: 43, b: 74 }]) {
      const comp = await sharp({
        create: { width: ko.w, height: ko.h, channels: 4, background: { ...bg, alpha: 1 } },
      })
        .composite([{ input: ko.png }])
        .png()
        .toBuffer()
      const { data } = await sharp(comp).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      for (const [x, y] of holeSpots) {
        const i = (y * ko.w + x) * 4
        expect(Math.abs(data[i] - bg.r)).toBeLessThanOrEqual(2)
        expect(Math.abs(data[i + 1] - bg.g)).toBeLessThanOrEqual(2)
        expect(Math.abs(data[i + 2] - bg.b)).toBeLessThanOrEqual(2)
      }
      // Tag body above the text stays opaque white on any background.
      const bi = ((PAD + 5) * ko.w + (PAD + Math.round((ko.h - PAD * 2) / 2))) * 4
      expect(data[bi]).toBeGreaterThan(200)
      expect(data[bi + 1]).toBeGreaterThan(200)
      expect(data[bi + 2]).toBeGreaterThan(200)
      expect(data[bi + 3]).toBeGreaterThan(200)
    }
    // The standard pill never drops below the satin floor (control case).
    const stdStats = await glyphStats(std.png, std.w, std.h, Math.round((std.h - PAD * 2) / 2))
    expect(stdStats.eq0).toBe(0)
  }, 30000)

  it("cuts larger glyphs without clipping for every tier and font", async () => {
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    for (const tier of ["4K", "FHD", "HD", "SD"] as const) {
      for (const font of ["inter", "barlow-condensed", "oswald"] as const) {
        const ko = await renderQualityKnockoutBadge(tier, pw, font)
        const { data } = await sharp(ko.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        const rx = Math.round((ko.h - PAD * 2) * 0.3)
        const ox = PAD + 2
        const oy = PAD + 2
        const W = ko.w - PAD * 2 - 4
        const H = ko.h - PAD * 2 - 4
        const inside = (x: number, y: number): boolean => {
          const cx = Math.min(Math.max(x, ox + rx), ox + W - rx)
          const cy = Math.min(Math.max(y, oy + rx), oy + H - rx)
          return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rx * rx
        }
        let eq0 = 0
        let whiteOpaque = 0
        for (let y = oy; y < oy + H; y++) {
          for (let x = ox; x < ox + W; x++) {
            if (!inside(x, y)) continue
            const i = (y * ko.w + x) * 4
            if (data[i + 3] === 0) eq0++
            if (data[i + 3] > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) whiteOpaque++
          }
        }
        // Oversized holes on every tier/font, tag body stays opaque white.
        expect(eq0).toBeGreaterThan(100)
        expect(whiteOpaque).toBeGreaterThan(500)
      }
    }
  }, 60000)
})

describe("quality knockout vertical stack", () => {
  // Sharp composites blend over transparency with ±1 rounding per channel:
  // segments must match up to that, never pixel-shifted (which would
  // differ massively).
  function expectSamePixels(actual: Buffer, expected: Buffer) {
    expect(actual.length).toBe(expected.length)
    let max = 0
    let diff = 0
    for (let i = 0; i < actual.length; i++) {
      const d = Math.abs(actual[i] - expected[i])
      if (d > 0) diff++
      if (d > max) max = d
    }
    expect(max).toBeLessThanOrEqual(2)
    expect(diff / actual.length).toBeLessThan(0.01)
  }

  it("stacks the knockout tier above the Dolby combo in one column", async () => {
    const svc = await import("@/lib/poster-service")
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    const gap = Math.round(5 * pw / 380)
    const ko = await renderQualityKnockoutBadge("4K", pw)
    const combo = await svc.renderQualityIconBadge("quality-badges/video/dolby-vision-atmos.svg", pw, false)
    expect(combo).not.toBeNull()
    const group = await svc.renderQualityBadgeGroup("4K", "knockout", ["dv", "atmos"], pw, false)
    expect(group).not.toBeNull()
    // Vertical column geometry (tier on top, Dolby below), like other styles.
    expect(group!.w).toBe(Math.max(ko.w, combo!.w))
    expect(group!.h).toBe(ko.h - PAD * 2 + gap + (combo!.h - PAD * 2) + PAD * 2)
    // Order: top segment is the knockout tag, bottom segment the Dolby icon.
    // Cropped with guards on the neighbor-facing sides: adjacent bitmaps
    // overlap in their shadow pads (TOP_SHADOW_PAD*2 - gap), so
    // byte-identity only holds past the overlap. The top guard skips the
    // bottom shadow tail; the bottom guard skips the whole overlap zone
    // (the knockout bitmap ends PAD*2 - gap rows into the Dolby bitmap).
    const GUARD = 8
    const OVERLAP = PAD * 2 - gap
    const topLeft = Math.round((group!.w - ko.w) / 2)
    const topSeg = await sharp(group!.png)
      .extract({ left: topLeft, top: 0, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    const topRef = await sharp(ko.png)
      .extract({ left: 0, top: 0, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    expectSamePixels(topSeg, topRef)
    const comboTop = ko.h - PAD * 2 + gap
    const comboLeft = Math.round((group!.w - combo!.w) / 2)
    const bottomSeg = await sharp(group!.png)
      .extract({ left: comboLeft, top: comboTop + OVERLAP, width: combo!.w, height: combo!.h - PAD - OVERLAP })
      .raw()
      .toBuffer()
    const bottomRef = await sharp(combo!.png)
      .extract({ left: 0, top: OVERLAP, width: combo!.w, height: combo!.h - PAD - OVERLAP })
      .raw()
      .toBuffer()
    expectSamePixels(bottomSeg, bottomRef)
  }, 30000)

  it("keeps the Dolby mark white in knockout even on light tops", async () => {
    const svc = await import("@/lib/poster-service")
    const pw = 380
    const PAD = 14
    // Single Atmos (no combo without dv): same column geometry either way,
    // and the Dolby cell is pixel-identical (white) under both polarities.
    const gLight = await svc.renderQualityBadgeGroup("4K", "knockout", ["atmos"], pw, true)
    const gDark = await svc.renderQualityBadgeGroup("4K", "knockout", ["atmos"], pw, false)
    expect(gLight).not.toBeNull()
    expect(gDark).not.toBeNull()
    expect([gLight!.w, gLight!.h]).toEqual([gDark!.w, gDark!.h])
    const atmos = await svc.renderQualityIconBadge("quality-badges/video/dolby-atmos.svg", pw, false)
    expect(atmos).not.toBeNull()
    // The Dolby cell sits below the tier, centered in the column.
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    const ko = await renderQualityKnockoutBadge("4K", pw)
    const gap = Math.round(5 * pw / 380)
    const cellTop = ko.h - PAD * 2 + gap
    const cellLeft = Math.round((gLight!.w - atmos!.w) / 2)
    async function brightIn(group: NonNullable<typeof gLight>): Promise<number> {
      const { data, info } = await sharp(group.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let n = 0
      for (let y = cellTop; y < cellTop + atmos!.h; y++) {
        for (let x = cellLeft; x < cellLeft + atmos!.w; x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200 && data[i + 3] > 200) n++
        }
      }
      return n
    }
    // White Dolby glyphs on the light-top group too.
    expect(await brightIn(gLight!)).toBeGreaterThan(30)
    expect(await brightIn(gDark!)).toBeGreaterThan(30)
    // Control: outside knockout the same icon follows polarity (black).
    const black = await svc.renderQualityIconBadge("quality-badges/video/dolby-atmos.svg", pw, true)
    expect(black).not.toBeNull()
    const { data } = await sharp(black!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80 && data[i + 3] > 200) dark++
    }
    expect(dark).toBeGreaterThan(30)
  }, 30000)

  it("stacks non-Dolby formats below the tier and keeps the knockout tier without Dolby", async () => {
    const svc = await import("@/lib/poster-service")
    const { renderQualityKnockoutBadge } = await import("@/lib/svg-badge")
    const pw = 380
    const PAD = 14
    const GUARD = 8
    const gap = Math.round(5 * pw / 380)
    const ko = await renderQualityKnockoutBadge("4K", pw)
    const imax = await svc.renderQualityIconBadge("quality-badges/video/imax.svg", pw, false)
    expect(imax).not.toBeNull()
    // Knockout + IMAX (no Dolby): vertical stack, knockout tag on top.
    const stacked = await svc.renderQualityBadgeGroup("4K", "knockout", ["imax"], pw, false)
    expect(stacked).not.toBeNull()
    expect(stacked!.w).toBe(Math.max(ko.w, imax!.w))
    expect(stacked!.h).toBe(ko.h - PAD * 2 + gap + (imax!.h - PAD * 2) + PAD * 2)
    const koTop = 0
    const topSeg = await sharp(stacked!.png)
      .extract({ left: Math.round((stacked!.w - ko.w) / 2), top: koTop, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    const topRef = await sharp(ko.png)
      .extract({ left: 0, top: koTop, width: ko.w, height: ko.h - PAD - GUARD })
      .raw()
      .toBuffer()
    expectSamePixels(topSeg, topRef)
    // Unknown formats and empty lists: lone knockout tag, never the standard pill.
    // ("xx" bypasses the types with a cast: the route filters it at runtime
    // via isVideoFormat, here it exercises the in-service filter directly.)
    const missing: VideoFormat[][] = [[ "xx" as unknown as VideoFormat ], []]
    for (const formats of missing) {
      const lone = await svc.renderQualityBadgeGroup("4K", "knockout", [...formats], pw, false)
      expect(lone).not.toBeNull()
      expect(lone!.w).toBe(ko.w)
      expect(lone!.h).toBe(ko.h)
    }
  }, 30000)
})
