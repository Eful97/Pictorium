/**
 * Fresh separate rating icons (`layout=fresh`): built-in separate rows render
 * a proportionally sized brand icon + score (no textual provider label).
 *
 * Focused renderer tests: row model (score-only text + source, order, caps),
 * icon coverage for every supported source/alias, SVG geometry/content
 * evidence (embedded `<image>`, score text, no provider label, centered
 * unit), raster evidence (ink inside the column, centered, narrow columns,
 * height scaling), missing-icon text fallback, and one pipeline render.
 * Custom rows stay `name + score` text, unchanged.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import {
  freshGeometry,
  freshMetaRows,
  loadFreshSeparateIcon,
  renderFreshMetaColumn,
  type FreshMetaInput,
} from "@/lib/fresh-layout"
import { SUPPORTED_RATING_SOURCES } from "@/lib/ratings"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

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

/** Visible text of every `<text>` element (image hrefs excluded by construction). */
function svgTexts(svg: string): string[] {
  const out: string[] = []
  const re = /<text[^>]*>(.*?)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) out.push(m[1] ?? "")
  return out
}

/** Every font-size declared on `<text>` elements. */
function svgFontSizes(svg: string): number[] {
  const out: number[] = []
  const re = /<text[^>]*font-size="(\d+)"[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg)) !== null) out.push(Number(m[1]))
  return out
}

/** Tight ink bounding box (alpha > 100 skips the faint shadow fringe). */
async function inkBBox(buf: Buffer): Promise<{ minX: number; maxX: number; w: number } | null> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let maxX = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if ((data[(y * info.width + x) * 4 + 3] ?? 0) > 100) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  if (maxX < minX) return null
  return { minX, maxX, w: info.width }
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
    rankingEnabled: false,
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

async function flatBase(w: number, h: number, hex: string): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: hex } })
    .jpeg()
    .toBuffer()
}

describe("fresh separate icon rows (model)", () => {
  it("carries score-only text + source, preserving order and the 5-cap", () => {
    const rows = freshMetaRows(
      metaInput({
        separateRatingsEnabled: true,
        separateRatings: [
          { id: "imdb", value: 8.7 },
          { id: "tmdb", value: 7.9 },
          { id: "tomatoes", value: 8.8 },
          { id: "mal", value: 8.1 },
          { id: "trakt", value: 7.5 },
          { id: "simkl", value: 8.0 },
        ],
      }),
    )
    const sep = rows.filter((r) => r.kind === "separate")
    expect(sep).toHaveLength(5)
    expect(sep.map((r) => r.text)).toEqual(["8.7", "7.9", "88%", "8.1", "7.5"])
    expect(sep.map((r) => r.source)).toEqual(["imdb", "tmdb", "tomatoes", "mal", "trakt"])
    // The average is still suppressed while separate values are active.
    expect(rows.some((r) => r.kind === "rating")).toBe(false)
  })

  it("leaves custom rows as name + score text without a source", () => {
    const rows = freshMetaRows(
      metaInput({
        customRatingsEnabled: true,
        customRatings: [{ id: "p0", name: "Provider 0", value: 9, format: "decimal" as const }],
      }),
    )
    const custom = rows.filter((r) => r.kind === "custom")
    expect(custom).toHaveLength(1)
    expect(custom[0]!.text).toBe("9 PROVIDER 0")
    expect(custom[0]!.source).toBeUndefined()
  })
})

describe("fresh separate brand assets (coverage)", () => {
  it("resolves every supported source and alias to a rasterizable mark", async () => {
    expect(SUPPORTED_RATING_SOURCES.length).toBeGreaterThan(0)
    for (const id of SUPPORTED_RATING_SOURCES) {
      const icon = await loadFreshSeparateIcon(id, 24)
      expect(icon, `source ${id}`).not.toBeNull()
      expect(icon!.w).toBeGreaterThan(0)
      expect(icon!.h).toBeGreaterThan(0)
      // Display height tracks the requested row size (common maximum box).
      expect(icon!.h).toBeLessThanOrEqual(24)
    }
  }, 90000)

  it("returns null (text fallback) for unknown sources instead of throwing", async () => {
    expect(await loadFreshSeparateIcon("nosuchsource", 18)).toBeNull()
    expect(await loadFreshSeparateIcon("an-extremely-long-unknown-source-id", 18)).toBeNull()
  })
})

describe("fresh separate icon column (svg + raster)", () => {
  const SEP = [
    { id: "imdb", value: 8.7 },
    { id: "tmdb", value: 7.9 },
    { id: "tomatoes", value: 8.8 },
  ]

  it("renders icon + score with no provider label on both canvas shapes", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const geo = freshGeometry(CW, CH, 6)
      const rows = freshMetaRows(metaInput({ separateRatingsEnabled: true, separateRatings: SEP }))
      expect(rows.filter((r) => r.kind === "separate")).toHaveLength(3)
      const col = await renderFreshMetaColumn(rows, geo)
      expect(col).not.toBeNull()
      expect(col!.w).toBeLessThanOrEqual(geo.zoneW)
      // SVG content: embedded raster marks, one per separate row…
      const images = col!.svg.match(/<image\b/g) ?? []
      expect(images.length).toBe(3)
      // …score digits as text, and no textual provider label anywhere.
      const texts = svgTexts(col!.svg)
      for (const score of ["8.7", "7.9", "88%"]) {
        expect(texts.some((t) => t.includes(score)), `${score} in ${JSON.stringify(texts)}`).toBe(true)
      }
      for (const label of ["IMDB", "TMDB", "TOMATOES"]) {
        expect(texts.some((t) => t.includes(label)), `no ${label} in ${JSON.stringify(texts)}`).toBe(false)
      }
      // Raster: glyph + mark ink stays inside the available column width.
      const box = await inkBBox(col!.png)
      expect(box).not.toBeNull()
      expect(box!.maxX - box!.minX + 1).toBeLessThanOrEqual(geo.metaAvailW)
    }
  }, 90000)

  it("renders alias sources with icons and keeps a uniform icon slot", async () => {
    const geo = freshGeometry(STD_W, STD_H, 6)
    const rows = freshMetaRows(
      metaInput({
        badgeGenre: false,
        badgeYear: false,
        separateRatingsEnabled: true,
        separateRatings: [
          { id: "metacriticuser", value: 7.4 },
          { id: "filmwebcritics", value: 7.1 },
        ],
      }),
    )
    const col = await renderFreshMetaColumn(rows, geo)
    expect(col).not.toBeNull()
    expect(col!.svg.match(/<image\b/g) ?? []).toHaveLength(2)
    // Uniform slot: both marks share the same slot width, so both scores
    // start at the same x.
    const scoreX = [...col!.svg.matchAll(/<text x="([\d.]+)"[^>]*font-size/g)].map((m) => Number(m[1]))
    expect(scoreX).toHaveLength(2)
    expect(Math.abs(scoreX[0]! - scoreX[1]!)).toBeLessThanOrEqual(1)
  }, 90000)

  it("centers the icon + score unit on the column", async () => {
    const geo = freshGeometry(STD_W, STD_H, 6)
    const rows = freshMetaRows(
      metaInput({
        badgeGenre: false,
        badgeYear: false,
        separateRatingsEnabled: true,
        separateRatings: [{ id: "imdb", value: 8.7 }],
      }),
    )
    const col = await renderFreshMetaColumn(rows, geo)
    expect(col).not.toBeNull()
    const box = await inkBBox(col!.png)
    expect(box).not.toBeNull()
    const leftMargin = box!.minX
    const rightMargin = box!.w - 1 - box!.maxX
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(4)
  }, 90000)

  it("keeps scores readable and rows inside a reserved max height", async () => {
    const geo = freshGeometry(STD_W, STD_H, 6)
    const rows = freshMetaRows(
      metaInput({ separateRatingsEnabled: true, separateRatings: SEP }),
    )
    const full = await renderFreshMetaColumn(rows, geo)
    expect(full).not.toBeNull()
    const maxH = Math.max(60, Math.floor(full!.h * 0.6))
    const shrunk = await renderFreshMetaColumn(rows, geo, "inter", maxH)
    expect(shrunk).not.toBeNull()
    expect(shrunk!.h).toBeLessThanOrEqual(maxH)
    expect(shrunk!.w).toBeLessThanOrEqual(geo.zoneW)
    // Readable: no score shrinks below the shared text floor.
    for (const fs of svgFontSizes(shrunk!.svg)) expect(fs).toBeGreaterThanOrEqual(8)
    const box = await inkBBox(shrunk!.png)
    expect(box).not.toBeNull()
    expect(box!.maxX - box!.minX + 1).toBeLessThanOrEqual(geo.metaAvailW)
  }, 90000)

  it("shrinks icon rows into narrow columns without clipping", async () => {
    const geo = { ...freshGeometry(STD_W, STD_H, 5), zoneW: 80, metaAvailW: 68 }
    const rows = freshMetaRows(metaInput({ separateRatingsEnabled: true, separateRatings: SEP }))
    const col = await renderFreshMetaColumn(rows, geo)
    expect(col).not.toBeNull()
    expect(col!.w).toBeLessThanOrEqual(80)
    const box = await inkBBox(col!.png)
    expect(box).not.toBeNull()
    expect(box!.maxX - box!.minX + 1).toBeLessThanOrEqual(68)
    for (const fs of svgFontSizes(col!.svg)) expect(fs).toBeGreaterThanOrEqual(8)
  }, 90000)

  it("falls back to score + name text for sources without an asset", async () => {
    const source = "an-extremely-long-rating-source-id-without-any-asset"
    const geo = freshGeometry(STD_W, STD_H, 5)
    const rows = freshMetaRows(
      metaInput({ separateRatingsEnabled: true, separateRatings: [{ id: source, value: 8.7 }] }),
    )
    expect(rows.filter((r) => r.kind === "separate")).toHaveLength(1)
    const col = await renderFreshMetaColumn(rows, geo)
    expect(col).not.toBeNull()
    // No mark: pure text fallback, historic content preserved.
    expect(col!.svg.includes("<image")).toBe(false)
    const texts = svgTexts(col!.svg)
    expect(texts.some((t) => t.includes("8.7"))).toBe(true)
    expect(texts.some((t) => t.includes(source.toUpperCase()))).toBe(true)
    const box = await inkBBox(col!.png)
    expect(box).not.toBeNull()
    expect(box!.maxX - box!.minX + 1).toBeLessThanOrEqual(geo.metaAvailW)
  }, 90000)
})

/** Icon + score rows parsed from a meta-column SVG in document order. */
function svgIconRows(
  svg: string,
): { imgX: number; imgY: number; imgW: number; imgH: number; textX: number; baseline: number; size: number; lock: number }[] {
  const imgs = [...svg.matchAll(/<image[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="(\d+)" height="(\d+)"[^>]*\/>/g)]
  const texts = [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].filter((m) => !m[0]!.includes("text-anchor"))
  expect(texts.length).toBe(imgs.length)
  return imgs.map((img, i) => {
    const text = texts[i]![0]!
    const size = Number(/font-size="(\d+)"/.exec(text)?.[1])
    const textX = Number(/<text x="([\d.]+)"/.exec(text)?.[1])
    const baseline = Number(/ y="([\d.]+)"/.exec(text)?.[1])
    const lock = Number(/textLength="(\d+)"/.exec(text)?.[1])
    return {
      imgX: Number(img[1]),
      imgY: Number(img[2]),
      imgW: Number(img[3]),
      imgH: Number(img[4]),
      textX,
      baseline,
      size,
      lock,
    }
  })
}

describe("fresh separate icon geometry regressions", () => {
  const SEP = [
    { id: "imdb", value: 8.7 },
    { id: "tmdb", value: 7.9 },
    { id: "tomatoes", value: 8.8 },
  ]
  const iconOnlyInput = (separateRatings: { id: string; value: number }[]): FreshMetaInput =>
    metaInput({ badgeGenre: false, badgeYear: false, separateRatingsEnabled: true, separateRatings })

  it("fits a moderate maxH without flooring every score", async () => {
    const geo = freshGeometry(STD_W, STD_H, 6)
    const rows = freshMetaRows(iconOnlyInput(SEP))
    const full = await renderFreshMetaColumn(rows, geo)
    expect(full).not.toBeNull()
    // A ~30% height reduction must shrink proportionally, not collapse: the
    // fit predicts the live mark heights, so it stops once the real block
    // fits instead of shrinking on stale buffers down to the floor (stale
    // buffers pin the block at 3*18+2*2+8 = 66 here, so a 59px budget
    // floors every score to 8 without them ever fitting).
    const maxH = Math.floor(full!.h * 0.71)
    const shrunk = await renderFreshMetaColumn(rows, geo, "inter", maxH)
    expect(shrunk).not.toBeNull()
    expect(shrunk!.h).toBeLessThanOrEqual(maxH)
    const sizes = svgFontSizes(shrunk!.svg)
    expect(sizes.length).toBe(3)
    expect(sizes.some((s) => s > 8)).toBe(true)
    const box = await inkBBox(shrunk!.png)
    expect(box).not.toBeNull()
    expect(box!.maxX - box!.minX + 1).toBeLessThanOrEqual(geo.metaAvailW)
  }, 90000)

  it("keeps icon-row vertical bounds disjoint when marks stand shorter than the score cap", async () => {
    // Extreme narrow column + tight maxH: the narrow guard scales marks
    // (fonts untouched, every mark ends up shorter than its score cap — the
    // same short path as a width-capped wide mark) and the maxH fit floors
    // the line gap to 2. Rows must stand max(mark, cap) with both centered:
    // the old icon.h-only row would let each score overhang (cap - h) / 2 =
    // 2.5px past its row into the 2px gap below (0.5px overlap, exact SVG
    // geometry, no raster involved).
    const FIVE = [
      { id: "imdb", value: 8.7 },
      { id: "tmdb", value: 7.9 },
      { id: "tomatoes", value: 8.8 },
      { id: "mal", value: 8.1 },
      { id: "trakt", value: 7.5 },
    ]
    const geo = { ...freshGeometry(STD_W, STD_H, 5), zoneW: 40, metaAvailW: 24 }
    const rows = freshMetaRows(iconOnlyInput(FIVE))
    const col = await renderFreshMetaColumn(rows, geo, "inter", 30)
    expect(col).not.toBeNull()
    const units = svgIconRows(col!.svg)
    expect(units).toHaveLength(5)
    const short = units.filter((u) => u.imgH < Math.round(u.size * 0.73))
    expect(short.length).toBeGreaterThan(0)
    for (let i = 0; i + 1 < units.length; i++) {
      const a = units[i]!
      const b = units[i + 1]!
      const aBottom = Math.max(a.imgY + a.imgH, a.baseline)
      const bTop = Math.min(b.imgY, b.baseline - Math.round(b.size * 0.73))
      expect(aBottom).toBeLessThanOrEqual(bTop)
    }
  }, 90000)

  it("fits every icon + score unit inside an extreme narrow column (metaAvailW=24)", async () => {
    const geo = { ...freshGeometry(STD_W, STD_H, 5), zoneW: 40, metaAvailW: 24 }
    const fitW = 24 - 8 * 2
    const rows = freshMetaRows(iconOnlyInput(SEP))
    const col = await renderFreshMetaColumn(rows, geo)
    expect(col).not.toBeNull()
    // Geometric bound: slot + gap + locked score never exceeds the ink
    // region (the score lock compresses past its historic floor instead of
    // overflowing, and the available width never goes negative).
    const units = svgIconRows(col!.svg)
    expect(units).toHaveLength(3)
    const slotW = Math.max(...units.map((u) => u.imgW))
    for (const u of units) {
      const gap = u.textX - (u.imgX - (slotW - u.imgW) / 2) - slotW
      expect(gap).toBeGreaterThanOrEqual(0)
      // 0.2 covers the SVG 0.1px coordinate rounding only (a real overflow
      // exceeds by whole pixels: the old floor left slot + gap + 8 far past
      // the 8px ink region here).
      expect(slotW + gap + u.lock).toBeLessThanOrEqual(fitW + 0.2)
    }
    const box = await inkBBox(col!.png)
    expect(box).not.toBeNull()
    expect(box!.maxX - box!.minX + 1).toBeLessThanOrEqual(24)
    for (const fs of svgFontSizes(col!.svg)) expect(fs).toBeGreaterThanOrEqual(8)
  }, 90000)
})

describe("fresh separate icons in the pipeline", () => {
  it("renders icon rows without changing dims or gates", async () => {
    const poster = await flatBase(STD_W, STD_H, "#141419")
    const sep = [
      { id: "imdb", value: 8.7 },
      { id: "tmdb", value: 7.9 },
    ]
    const withSep = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
        separateRatings: sep,
      }),
    )
    const noSep = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: true, finalRank: 6 }),
    )
    const meta = await sharp(withSep).metadata()
    expect({ w: meta.width, h: meta.height }).toEqual({ w: STD_W, h: STD_H })
    // The icon rows actually render (not silently dropped).
    expect(withSep.equals(noSep)).toBe(false)
  }, 120000)
})
