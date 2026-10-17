import { describe, expect, it } from "vitest"
import fs from "fs"
import path from "path"
import sharp from "sharp"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import { LAND_W, LAND_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

/**
 * Halloween seasonal frame (user-authored canonical art — source of truth,
 * do NOT recolor/restore: the SVG was intentionally hand-edited by the user):
 * gradient perimeter, webs in BOTH upper corners, three bats upper-left
 * plus a hanging spider upper-right, and a SINGLE pumpkin + haunted-house
 * cluster in the LOWER-LEFT corner only (lower-right intentionally clear),
 * composed ABOVE the background/picture treatment but BELOW logo and all
 * badges in every portrait layout. The middle band and the side contours
 * stay clear.
 */

const CANONICAL_SVG = path.join(process.cwd(), "public", "seasonal-frames", "halloween.svg")
const CANONICAL_CHRISTMAS_SVG = path.join(process.cwd(), "public", "seasonal-frames", "christmas.svg")
const CANONICAL_LANDSCAPE_HALLOWEEN_SVG = path.join(process.cwd(), "public", "seasonal-frames", "halloween landscape.svg")
const CANONICAL_LANDSCAPE_CHRISTMAS_SVG = path.join(process.cwd(), "public", "seasonal-frames", "christmas landscape.svg")

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
    tintStrength: 20,
    topShade: 50,
    badgesEnabled: true,
    rankingEnabled: false,
    genreName: "Dramma",
    voteAverage: null,
    badgeStyle: "shadow",
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

async function flatPoster(w: number, h: number, hex: string): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: hex } })
    .jpeg()
    .toBuffer()
}

async function rawPixels(buf: Buffer): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

function px(p: { data: Buffer; width: number; channels: number }, x: number, y: number): [number, number, number] {
  const i = (y * p.width + x) * p.channels
  return [p.data[i], p.data[i + 1], p.data[i + 2]]
}

function pxA(p: { data: Buffer; width: number; channels: number }, x: number, y: number): [number, number, number, number] {
  const i = (y * p.width + x) * p.channels
  return [p.data[i], p.data[i + 1], p.data[i + 2], p.data[i + 3]]
}

/**
 * Pumpkin-orange matcher for the lower-corner pumpkins (body #dd711c plus
 * shaded/ridged pumpkin pixels). Excludes the amber stretch of the
 * perimeter gradient band (green channel >= ~160 there), the dark backing,
 * webs and bats — so only genuine pumpkin paint satisfies it.
 */
function isPumpkinOrange(px: [number, number, number, number]): boolean {
  const [r, g, b, a] = px
  return a > 16 && r > 120 && r - g > 40 && g - b > 25 && g < 140
}

/**
 * Dark-motif gray matcher for the exported bat/spider paths (#4d4d4d).
 * Neutral gray only (channels within 12 of each other), so the saturated
 * gradient band, the lavender webs and the pumpkins never satisfy it.
 */
function isBatGray(px: [number, number, number, number]): boolean {
  const [r, g, b, a] = px
  return (
    a > 16 &&
    r >= 55 && r <= 100 &&
    g >= 55 && g <= 100 &&
    b >= 55 && b <= 100 &&
    Math.abs(r - g) <= 12 && Math.abs(g - b) <= 12 && Math.abs(r - b) <= 12
  )
}

function close(a: [number, number, number], b: [number, number, number], tol: number): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
}

async function frameRaster(): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const svg = await fs.promises.readFile(CANONICAL_SVG, "utf8")
  const png = await sharp(Buffer.from(svg)).resize(STD_W, STD_H, { fit: "fill" }).png().toBuffer()
  return rawPixels(png)
}

async function christmasFrameRaster(): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const svg = await fs.promises.readFile(CANONICAL_CHRISTMAS_SVG, "utf8")
  const png = await sharp(Buffer.from(svg)).resize(STD_W, STD_H, { fit: "fill" }).png().toBuffer()
  return rawPixels(png)
}

async function landscapeFrameRaster(svgPath: string): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const svg = await fs.promises.readFile(svgPath, "utf8")
  const png = await sharp(Buffer.from(svg)).resize(LAND_W, LAND_H, { fit: "fill" }).png().toBuffer()
  return rawPixels(png)
}

describe("seasonal halloween asset (canonical, single source)", () => {
  it("is a 500x750 self-contained vector with no fonts/scripts/external refs", async () => {
    const svg = await fs.promises.readFile(CANONICAL_SVG, "utf8")
    expect(svg).toContain('viewBox="0 0 500 750"')
    expect(svg).not.toMatch(/<script/i)
    expect(svg).not.toMatch(/<text/i)
    expect(svg).not.toMatch(/font-family/i)
    // No external references: strip ALL namespace declarations (the editor
    // export legitimately declares xmlns:xlink alongside xmlns), then no
    // http(s), href, or embedded raster may remain.
    const noNs = svg.replace(/xmlns(?::[\w-]+)?="[^"]*"/g, "")
    expect(noNs).not.toMatch(/https?:\/\//)
    expect(noNs).not.toMatch(/href\s*=/i)
    expect(svg).not.toMatch(/<image/i)
    expect(svg).not.toMatch(/@font-face/i)
    // Internal paint references only: every url(#id) must resolve to an id
    // defined in this same file (e.g. the perimeter gradient).
    for (const m of svg.matchAll(/url\(#([\w-]+)\)/g)) {
      expect(svg.includes(`id="${m[1]}"`)).toBe(true)
    }
  })

  it("paints a rich perimeter, the lower-left pumpkin and upper motifs over a transparent majority", async () => {
    const f = await frameRaster()
    let painted = 0
    let total = 0
    const hasPaint = (x: number, y: number): boolean => {
      const i = (y * f.width + x) * f.channels
      return f.data[i + 3] > 16
    }
    for (let y = 0; y < f.height; y += 2) {
      for (let x = 0; x < f.width; x += 2) {
        total++
        if (hasPaint(x, y)) painted++
      }
    }
    // Transparent majority remains (no opaque full-canvas fill). Measured
    // ~0.121 for the authored art: the lower bound pins the real footprint
    // (a deleted/gutted frame fails it), the upper bound still guarantees a
    // transparent majority with room for authored detail growth.
    const coverage = painted / total
    expect(coverage).toBeGreaterThan(0.05)
    expect(coverage).toBeLessThan(0.2)
    // Richer perimeter: the top edge band is well covered (dark backing + band).
    let topPainted = 0
    for (let x = 0; x < f.width; x += 2) {
      let col = false
      for (let y = 0; y < 16; y++) if (hasPaint(x, y)) { col = true; break }
      if (col) topPainted++
    }
    expect(topPainted / Math.ceil(f.width / 2)).toBeGreaterThan(0.9)
    // The authored design carries a SINGLE pumpkin cluster lower-left
    // (pumpkin + haunted house): the interior-only left box (clear of the
    // left/right/bottom perimeter bands) must contain pumpkin-orange paint —
    // alpha alone would also match the bands, so the color pins the pumpkin.
    // The lower-right interior is intentionally clear of pumpkin paint.
    const cornerHasPumpkin = (x0: number, x1: number): boolean => {
      for (let y = 695; y <= 733; y += 2)
        for (let x = x0; x < x1; x += 2)
          if (isPumpkinOrange(pxA(f, x, y))) return true
      return false
    }
    expect(cornerHasPumpkin(18, 70)).toBe(true)
    expect(cornerHasPumpkin(430, 482)).toBe(false)
    // Upper band carries the bats by design (below/around the top webs).
    let upperPainted = 0
    for (let y = 120; y < 236; y += 3) for (let x = 100; x < 400; x += 3) if (hasPaint(x, y)) upperPainted++
    expect(upperPainted).toBeGreaterThan(15)
    // Middle band stays clear: no mid-band bats anymore.
    let midPainted = 0
    for (let y = 280; y < 490; y += 3) for (let x = 120; x < 380; x += 3) if (hasPaint(x, y)) midPainted++
    expect(midPainted).toBe(0)
    // Side contours stay clear by design (side fans removed per user
    // feedback): the frame band itself lives at x < ~16 / x > ~484, so
    // x20..60 / x440..480 isolates the former web zone — no paint expected.
    let leftWeb = 0
    for (let y = 250; y < 550; y += 3) for (let x = 20; x < 60; x += 3) if (hasPaint(x, y)) leftWeb++
    let rightWeb = 0
    for (let y = 250; y < 550; y += 3) for (let x = 440; x < 480; x += 3) if (hasPaint(x, y)) rightWeb++
    expect(leftWeb).toBe(0)
    expect(rightWeb).toBe(0)
  })

  it("keeps every dark motif in the upper band (exported paths, raster-verified, none mid-canvas)", async () => {
    const svg = await fs.promises.readFile(CANONICAL_SVG, "utf8")
    // The editor export bakes bats/spider into absolute paths (no
    // translate() placements): pin the motif paint by fill, then verify
    // placement on the raster. Counts bound both sides — deleting the motifs
    // fails the source/raster lower bounds, drifting them down fails the
    // cleared-band upper bounds.
    const darkPaths = [...svg.matchAll(/fill="#4d4d4d"/g)]
    expect(darkPaths.length).toBeGreaterThanOrEqual(3)
    const webPaths = [...svg.matchAll(/fill="#cfc6dd"/g)]
    expect(webPaths.length).toBeGreaterThanOrEqual(10)
    const f = await frameRaster()
    const batCount = (y0: number, y1: number, x0: number, x1: number): number => {
      let n = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (isBatGray(pxA(f, x, y))) n++
      return n
    }
    // Upper band holds the bats + spider (measured ~1600 bat-gray pixels).
    expect(batCount(40, 170, 0, 500)).toBeGreaterThan(500)
    // Cleared bands stay free of dark motifs.
    expect(batCount(280, 490, 0, 500)).toBe(0)
    expect(batCount(550, 750, 0, 500)).toBe(0)
  })

  it("keeps only the upper-corner webs (side fans and bottom ticks removed)", async () => {
    const svg = await fs.promises.readFile(CANONICAL_SVG, "utf8")
    expect(svg).not.toContain('data-web="side-left"')
    expect(svg).not.toContain('data-web="side-right"')
    expect(svg).not.toContain('data-web="bottom"')
  })

  it("keeps the single pumpkin user-sized (authored ~47px footprint, bounded, not tiny)", async () => {
    const f = await frameRaster()
    // Interior-only window (clear of the perimeter bands) + explicit
    // pumpkin-orange match. The count lower bound fails a deleted pumpkin
    // (an empty window yields count 0 and NEGATIVE extents, which the lower
    // bounds reject — maxima alone would let a deletion pass and the test
    // would stay green with the pumpkin gone).
    const extent = (x0: number, x1: number): { w: number; h: number; n: number } => {
      let minX = x1
      let maxX = x0
      let minY = 733
      let maxY = 695
      let n = 0
      for (let y = 695; y <= 733; y++) {
        for (let x = x0; x < x1; x++) {
          if (isPumpkinOrange(pxA(f, x, y))) {
            n++
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      return { w: maxX - minX + 1, h: maxY - minY + 1, n }
    }
    // Authored lower-left cluster measures 47x39 (n ~119): retain the real
    // footprint (not tiny) while allowing authored detail margin above.
    const box = extent(18, 70)
    expect(box.n).toBeGreaterThanOrEqual(40)
    expect(box.w).toBeGreaterThanOrEqual(15)
    expect(box.h).toBeGreaterThanOrEqual(12)
    expect(box.w).toBeLessThanOrEqual(60)
    expect(box.h).toBeLessThanOrEqual(50)
  })
})

describe("seasonal halloween render (frame below chrome, portrait layouts)", () => {
  it("renders unframed byte-identical for absent vs null theme (default)", async () => {
    const poster = await flatPoster(STD_W, STD_H, "#3a3f4a")
    const a = await generatePosterBuffer(posterInput({ posterBuf: poster, seasonalTheme: null }))
    const b = await generatePosterBuffer(posterInput({ posterBuf: poster }))
    expect(a.equals(b)).toBe(true)
  })

  it("frames landscape with its OWN 768x432 art (direct callers)", async () => {
    const poster = await flatPoster(LAND_W, LAND_H, "#3a3f4a")
    const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, shape: "landscape", seasonalTheme: "halloween" }))
    const plain = await generatePosterBuffer(posterInput({ posterBuf: poster, shape: "landscape" }))
    expect(framed.equals(plain)).toBe(false)
  })

  it("frames every supported portrait layout (standard, fresh, card)", async () => {
    const poster = await flatPoster(STD_W, STD_H, "#3a3f4a")
    const layouts: Array<{ name: string; overrides: Partial<GenerationInput> }> = [
      { name: "standard", overrides: {} },
      { name: "fresh", overrides: { posterLayout: "fresh", posterFreshScope: "all" } },
      { name: "card", overrides: { posterLayout: "provider-glass", posterFreshScope: "all" } },
    ]
    for (const l of layouts) {
      const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, seasonalTheme: "halloween", ...l.overrides }))
      const plain = await generatePosterBuffer(posterInput({ posterBuf: poster, ...l.overrides }))
      expect(framed.equals(plain), l.name).toBe(false)
    }
  }, 60000)

  it("paints the top rank badge OVER the frame (chrome wins, frame below)", async () => {
    const poster = await flatPoster(STD_W, STD_H, "#23262c")
    const badge = { rankingEnabled: true, finalRank: 5, rankingBadgeStyle: "default" as const }
    const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, seasonalTheme: "halloween", ...badge }))
    const unframedBadge = await generatePosterBuffer(posterInput({ posterBuf: poster, ...badge }))
    const unframedNoBadge = await generatePosterBuffer(posterInput({ posterBuf: poster }))
    const f = await frameRaster()
    const fp = await rawPixels(framed)
    const ub = await rawPixels(unframedBadge)
    // The badge really covers the sampled top-edge pixel (badge vs no-badge differ there).
    expect(close(px(ub, 250, 7), px(await rawPixels(unframedNoBadge), 250, 7), 12)).toBe(false)
    // The framed pixel matches the badged render there (badge won over the frame).
    expect(close(px(fp, 250, 7), px(ub, 250, 7), 12)).toBe(true)
    // ...and differs from the bare frame raster (the frame lost there).
    expect(close(px(fp, 250, 7), [f.data[(7 * f.width + 250) * f.channels], f.data[(7 * f.width + 250) * f.channels + 1], f.data[(7 * f.width + 250) * f.channels + 2]], 60)).toBe(false)
  }, 60000)

  it("paints the full-width genre bar OVER the lower pumpkin (chrome wins)", async () => {
    const poster = await flatPoster(STD_W, STD_H, "#23262c")
    const bar = { badgeStyle: "bar" as const, badgeGenre: true, badgeYear: true, badgeRating: true, genreName: "Dramma", voteAverage: 8.2, releaseDate: "2024-05-01" }
    const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, seasonalTheme: "halloween", ...bar }))
    const unframed = await generatePosterBuffer(posterInput({ posterBuf: poster, ...bar }))
    const f = await frameRaster()
    const fp = await rawPixels(framed)
    const up = await rawPixels(unframed)
    const at = (p: { data: Buffer; width: number; channels: number }, x: number, y: number): [number, number, number] => px(p, x, y)
    // Pumpkin body pixel (40,716): the bar covers it unframed, and the bar
    // still wins framed (frame below chrome).
    expect(close(at(up, 40, 716), at(await rawPixels(await generatePosterBuffer(posterInput({ posterBuf: poster, badgesEnabled: false }))), 40, 716), 12)).toBe(false)
    expect(close(at(fp, 40, 716), at(up, 40, 716), 12)).toBe(true)
    const fi = (716 * f.width + 40) * f.channels
    expect(close(at(fp, 40, 716), [f.data[fi], f.data[fi + 1], f.data[fi + 2]], 60)).toBe(false)
  }, 60000)

  it("paints a title logo pushed to the border OVER the frame edge", async () => {
    const poster = await flatPoster(STD_W, STD_H, "#23262c")
    const logoFetch = await sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
    const logo = { logoFetch, logoScale: 100, logoOffsetX: -95, logoOffsetY: 0, badgesEnabled: false }
    const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, seasonalTheme: "halloween", ...logo }))
    const unframed = await generatePosterBuffer(posterInput({ posterBuf: poster, ...logo }))
    const up = await rawPixels(unframed)
    const fp = await rawPixels(framed)
    const lum = (c: [number, number, number]): number => (c[0] + c[1] + c[2]) / 3
    // The logo really reaches the left frame edge unframed (bright pixels in column x=7).
    const brightRows: number[] = []
    for (let y = 0; y < STD_H; y += 2) if (lum(px(up, 7, y)) > 200) brightRows.push(y)
    expect(brightRows.length).toBeGreaterThan(5)
    // Framed, those same edge pixels stay logo white (logo won over the frame).
    for (const y of brightRows) {
      expect(lum(px(fp, 7, y))).toBeGreaterThan(200)
    }
  }, 60000)
})

describe("seasonal christmas render (user art, frame below chrome, portrait layouts)", () => {
  it("is a 500x750 self-contained vector with no scripts/external refs", async () => {
    const svg = await fs.promises.readFile(CANONICAL_CHRISTMAS_SVG, "utf8")
    expect(svg).toContain('viewBox="0 0 500 750"')
    expect(svg).not.toMatch(/<script/i)
    expect(svg).not.toMatch(/<text/i)
    expect(svg).not.toMatch(/foreignObject/i)
    // No external references: strip ALL namespace declarations, then no
    // http(s), href, embedded raster, or event handlers may remain.
    const noNs = svg.replace(/xmlns(?::[\w-]+)?="[^"]*"/g, "")
    expect(noNs).not.toMatch(/https?:\/\//)
    expect(noNs).not.toMatch(/href\s*=/i)
    expect(svg).not.toMatch(/<image/i)
    expect(svg).not.toMatch(/\son\w+\s*=/i)
    // Internal paint references only: every url(#id) must resolve to an id
    // defined in this same file.
    for (const m of svg.matchAll(/url\(#([\w-]+)\)/g)) {
      expect(svg.includes(`id="${m[1]}"`)).toBe(true)
    }
  })

  it("renders unframed byte-identical for absent vs invalid theme", async () => {
    const poster = await flatPoster(STD_W, STD_H, "#3a3f4a")
    const a = await generatePosterBuffer(posterInput({ posterBuf: poster, seasonalTheme: null }))
    const b = await generatePosterBuffer(posterInput({ posterBuf: poster }))
    const c = await generatePosterBuffer(
      posterInput({ posterBuf: poster, seasonalTheme: "easter" as never }),
    )
    expect(a.equals(b)).toBe(true)
    expect(c.equals(a)).toBe(true)
  })

  it("frames landscape with its OWN 768x432 art, invalid stays unframed (direct callers)", async () => {
    const poster = await flatPoster(LAND_W, LAND_H, "#3a3f4a")
    const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, shape: "landscape", seasonalTheme: "christmas" }))
    const plain = await generatePosterBuffer(posterInput({ posterBuf: poster, shape: "landscape" }))
    expect(framed.equals(plain)).toBe(false)
  })

  it("frames every supported portrait layout with a painted footprint (standard, fresh, card)", async () => {
    const poster = await flatPoster(STD_W, STD_H, "#3a3f4a")
    const layouts: Array<{ name: string; overrides: Partial<GenerationInput> }> = [
      { name: "standard", overrides: {} },
      { name: "fresh", overrides: { posterLayout: "fresh", posterFreshScope: "all" } },
      { name: "card", overrides: { posterLayout: "provider-glass", posterFreshScope: "all" } },
    ]
    for (const l of layouts) {
      const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, seasonalTheme: "christmas", ...l.overrides }))
      const plain = await generatePosterBuffer(posterInput({ posterBuf: poster, ...l.overrides }))
      expect(framed.equals(plain), l.name).toBe(false)
      // Real painted footprint (not a 1px shift): the user art must move a
      // meaningful pixel count on the flat test poster.
      const fp = await rawPixels(framed)
      const up = await rawPixels(plain)
      let moved = 0
      for (let y = 0; y < fp.height; y += 2) {
        for (let x = 0; x < fp.width; x += 2) {
          if (!close(px(fp, x, y), px(up, x, y), 30)) moved++
        }
      }
      expect(moved, `${l.name} footprint`).toBeGreaterThan(100)
    }
  }, 120000)

  it("paints opaque chrome OVER the christmas frame wherever they overlap (frame below)", async () => {
    // Art-agnostic: FINDS pixels where the user frame really paints
    // under chrome proven opaque by the two-background check below,
    // and proves the chrome wins there.
    const dark = await flatPoster(STD_W, STD_H, "#23262c")
    const light = await flatPoster(STD_W, STD_H, "#c9cdd4")
    const chrome = {
      rankingEnabled: true,
      finalRank: 5,
      rankingBadgeStyle: "default" as const,
      badgeStyle: "pill" as const,
      badgeGenre: true,
      badgeYear: true,
      badgeRating: true,
      genreName: "Dramma",
      voteAverage: 8.2,
      releaseDate: "2024-05-01",
    }
    const framed = await generatePosterBuffer(posterInput({ posterBuf: dark, seasonalTheme: "christmas", ...chrome }))
    const unframed = await generatePosterBuffer(posterInput({ posterBuf: dark, ...chrome }))
    const unframedLight = await generatePosterBuffer(posterInput({ posterBuf: light, ...chrome }))
    const f = await christmasFrameRaster()
    const fp = await rawPixels(framed)
    const up = await rawPixels(unframed)
    const ul = await rawPixels(unframedLight)
    const lumDist = (a: [number, number, number], b: [number, number, number]): number =>
      Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    const frameAlpha = (x: number, y: number): number => f.data[(y * f.width + x) * f.channels + 3]
    const frameRgb = (x: number, y: number): [number, number, number] => {
      const i = (y * f.width + x) * f.channels
      return [f.data[i], f.data[i + 1], f.data[i + 2]]
    }
    // Overlap pixels: chrome proven fully opaque via identical renders over
    // dark AND light posters (shadows, frosted glass and backdrop blurs all
    // shift with the background and are excluded: they legitimately blend
    // the frame, as any backdrop art) + real frame paint with a
    // distinguishable color (never vacuous).
    const overlap: Array<[number, number]> = []
    for (let y = 0; y < STD_H && overlap.length < 40; y += 3) {
      for (let x = 0; x < STD_W; x += 3) {
        if (lumDist(px(up, x, y), px(ul, x, y)) > 18) continue
        if (frameAlpha(x, y) < 200) continue
        if (lumDist(px(up, x, y), frameRgb(x, y)) < 60) continue
        overlap.push([x, y])
      }
    }
    expect(overlap.length, "opaque-chrome/frame overlap with distinguishable colors").toBeGreaterThanOrEqual(5)
    // Framed, every overlap pixel matches the chromed render (chrome won).
    for (const [x, y] of overlap) {
      expect(close(px(fp, x, y), px(up, x, y), 12), `chrome wins at ${x},${y}`).toBe(true)
    }
  }, 120000)
})

describe("seasonal landscape assets (user 768x432 art, single source per theme+shape)", () => {
  for (const [name, file] of [
    ["halloween", CANONICAL_LANDSCAPE_HALLOWEEN_SVG],
    ["christmas", CANONICAL_LANDSCAPE_CHRISTMAS_SVG],
  ] as const) {
    it(`${name}: is a 768x432 self-contained vector with no scripts/external refs`, async () => {
      const svg = await fs.promises.readFile(file, "utf8")
      expect(svg).toContain('viewBox="0 0 768 432"')
      expect(svg).not.toMatch(/<script/i)
      expect(svg).not.toMatch(/<text/i)
      expect(svg).not.toMatch(/foreignObject/i)
      expect(svg).not.toMatch(/@font-face/i)
      expect(svg).not.toMatch(/<image/i)
      expect(svg).not.toMatch(/\son\w+\s*=/i)
      // Safe internal CSS only: no @import, no external url() — class rules
      // with internal paint references are allowed (these exports ship a
      // <style> block).
      for (const m of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
        expect(m[1]).not.toMatch(/@import/i)
        expect(m[1]).not.toMatch(/https?:\/\//i)
      }
      const noNs = svg.replace(/xmlns(?::[\w-]+)?="[^"]*"/g, "")
      expect(noNs).not.toMatch(/https?:\/\//)
      expect(noNs).not.toMatch(/href\s*=/i)
      // Internal paint references only: every url(#id) must resolve to an id
      // defined in this same file (incl. stylesheet url(#...) fills).
      for (const m of svg.matchAll(/url\(#([\w-]+)\)/g)) {
        expect(svg.includes(`id="${m[1]}"`)).toBe(true)
      }
    })

    it(`${name}: paints a real footprint over a transparent majority at native size`, async () => {
      const f = await landscapeFrameRaster(file)
      expect(f.width).toBe(LAND_W)
      expect(f.height).toBe(LAND_H)
      let painted = 0
      let total = 0
      const hasPaint = (x: number, y: number): boolean => {
        const i = (y * f.width + x) * f.channels
        return f.data[i + 3] > 16
      }
      for (let y = 0; y < f.height; y += 2) {
        for (let x = 0; x < f.width; x += 2) {
          total++
          if (hasPaint(x, y)) painted++
        }
      }
      const coverage = painted / total
      // Transparent majority remains (no opaque full-canvas fill), with a
      // real painted footprint (a deleted/gutted frame fails the lower bound).
      expect(coverage).toBeGreaterThan(0.05)
      expect(coverage).toBeLessThan(0.5)
      // The top edge band is well covered (frame reaches the canvas border).
      let topPainted = 0
      for (let x = 0; x < f.width; x += 2) {
        let col = false
        for (let y = 0; y < 12; y++) if (hasPaint(x, y)) { col = true; break }
        if (col) topPainted++
      }
      expect(topPainted / Math.ceil(f.width / 2)).toBeGreaterThan(0.9)
    })
  }
})

describe("seasonal landscape render (own 768x432 art, frame below chrome)", () => {
  for (const theme of ["halloween", "christmas"] as const) {
    it(`${theme}: landscape renders framed (own asset, not a stretched portrait)`, async () => {
      const poster = await flatPoster(LAND_W, LAND_H, "#3a3f4a")
      const framed = await generatePosterBuffer(posterInput({ posterBuf: poster, shape: "landscape", seasonalTheme: theme }))
      const plain = await generatePosterBuffer(posterInput({ posterBuf: poster, shape: "landscape" }))
      expect(framed.equals(plain)).toBe(false)
      // Real painted footprint (not a 1px shift): the landscape art must
      // move a meaningful pixel count on the flat test poster.
      const fp = await rawPixels(framed)
      const up = await rawPixels(plain)
      let moved = 0
      for (let y = 0; y < fp.height; y += 2) {
        for (let x = 0; x < fp.width; x += 2) {
          if (!close(px(fp, x, y), px(up, x, y), 30)) moved++
        }
      }
      expect(moved, `${theme} landscape footprint`).toBeGreaterThan(100)
    }, 60000)

    it(`${theme}: landscape uses its own art, never the stretched portrait asset`, async () => {
      // Reference: the PORTRAIT asset stretched over 16:9 (the old forbidden
      // behavior). The landscape render must differ from it meaningfully.
      const portraitSvg = await fs.promises.readFile(
        theme === "halloween" ? CANONICAL_SVG : CANONICAL_CHRISTMAS_SVG,
        "utf8",
      )
      const stretched = await sharp(Buffer.from(portraitSvg)).resize(LAND_W, LAND_H, { fit: "fill" }).png().toBuffer()
      const ownSvg = await fs.promises.readFile(
        theme === "halloween" ? CANONICAL_LANDSCAPE_HALLOWEEN_SVG : CANONICAL_LANDSCAPE_CHRISTMAS_SVG,
        "utf8",
      )
      const own = await sharp(Buffer.from(ownSvg)).resize(LAND_W, LAND_H, { fit: "fill" }).png().toBuffer()
      const sp = await rawPixels(stretched)
      const op = await rawPixels(own)
      let moved = 0
      let total = 0
      for (let y = 0; y < LAND_H; y += 2) {
        for (let x = 0; x < LAND_W; x += 2) {
          total++
          if (!close(px(sp, x, y), px(op, x, y), 30)) moved++
        }
      }
      expect(moved / total, `${theme} own-art vs stretched-portrait`).toBeGreaterThan(0.05)
    }, 60000)

    it(`${theme}: paints opaque chrome OVER the landscape frame wherever they overlap (frame below)`, async () => {
      // Art-agnostic overlap proof on the 768x432 canvas: FINDS pixels where
      // the landscape frame really paints under chrome proven opaque by the
      // two-background check, and proves the chrome wins there.
      const dark = await flatPoster(LAND_W, LAND_H, "#23262c")
      const light = await flatPoster(LAND_W, LAND_H, "#c9cdd4")
      const chrome = {
        rankingEnabled: true,
        finalRank: 5,
        rankingBadgeStyle: "default" as const,
        badgeStyle: "pill" as const,
        badgeGenre: true,
        badgeYear: true,
        badgeRating: true,
        genreName: "Dramma",
        voteAverage: 8.2,
        releaseDate: "2024-05-01",
      }
      const framed = await generatePosterBuffer(posterInput({ posterBuf: dark, shape: "landscape", seasonalTheme: theme, ...chrome }))
      const unframed = await generatePosterBuffer(posterInput({ posterBuf: dark, shape: "landscape", ...chrome }))
      const unframedLight = await generatePosterBuffer(posterInput({ posterBuf: light, shape: "landscape", ...chrome }))
      // No-chrome baseline (same treatments, no logo/badges): proves a
      // candidate pixel is really covered by chrome, not just by an opaque
      // picture treatment (e.g. the top shade, identical over both
      // backgrounds AND over the baseline — the frame sits above treatments
      // by design, so those pixels must be excluded here).
      const nochrome = await generatePosterBuffer(posterInput({ posterBuf: dark, shape: "landscape", badgesEnabled: false }))
      const f = await landscapeFrameRaster(
        theme === "halloween" ? CANONICAL_LANDSCAPE_HALLOWEEN_SVG : CANONICAL_LANDSCAPE_CHRISTMAS_SVG,
      )
      const fp = await rawPixels(framed)
      const up = await rawPixels(unframed)
      const ul = await rawPixels(unframedLight)
      const nc = await rawPixels(nochrome)
      const lumDist = (a: [number, number, number], b: [number, number, number]): number =>
        Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
      const frameAlpha = (x: number, y: number): number => f.data[(y * f.width + x) * f.channels + 3]
      const frameRgb = (x: number, y: number): [number, number, number] => {
        const i = (y * f.width + x) * f.channels
        return [f.data[i], f.data[i + 1], f.data[i + 2]]
      }
      // Overlap pixels: chrome proven (near-)opaque via identical renders
      // over dark AND light posters (threshold 12 admits fully-opaque
      // chrome like badge text/plate centers but rejects translucent blends
      // such as plate edges, which legitimately pick up the frame beneath)
      // + chrome proven present via difference from the no-chrome baseline
      // (shadows, frosted glass, backdrop blurs and opaque picture
      // treatments all shift with the background or match the baseline and
      // are excluded: treatments legitimately sit BELOW the frame, only
      // chrome must win) + real frame paint with a distinguishable color
      // (never vacuous).
      const overlap: Array<[number, number]> = []
      for (let y = 0; y < LAND_H && overlap.length < 40; y += 3) {
        for (let x = 0; x < LAND_W; x += 3) {
          if (lumDist(px(up, x, y), px(ul, x, y)) > 12) continue
          if (lumDist(px(up, x, y), px(nc, x, y)) < 60) continue
          if (frameAlpha(x, y) < 200) continue
          if (lumDist(px(up, x, y), frameRgb(x, y)) < 60) continue
          overlap.push([x, y])
        }
      }
      expect(overlap.length, "opaque-chrome/frame overlap with distinguishable colors").toBeGreaterThanOrEqual(5)
      // Framed, every overlap pixel matches the chromed render (chrome won).
      for (const [x, y] of overlap) {
        expect(close(px(fp, x, y), px(up, x, y), 12), `chrome wins at ${x},${y}`).toBe(true)
      }
    }, 120000)
  }

  it("keeps portrait and landscape caches apart: same theme, same title, different bytes", async () => {
    const portrait = await flatPoster(STD_W, STD_H, "#3a3f4a")
    const landscape = await flatPoster(LAND_W, LAND_H, "#3a3f4a")
    const framedPortrait = await generatePosterBuffer(posterInput({ posterBuf: portrait, seasonalTheme: "halloween" }))
    const framedLandscape = await generatePosterBuffer(posterInput({ posterBuf: landscape, shape: "landscape", seasonalTheme: "halloween" }))
    expect(framedPortrait.equals(framedLandscape)).toBe(false)
  }, 60000)
})
