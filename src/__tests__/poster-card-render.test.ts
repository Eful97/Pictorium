import { readFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  aggregateCardRating,
  CARD_META_MIN_FONT,
  CARD_META_STAR_FILL,
  CARD_NUMERAL_CORE_THRESHOLD,
  cardMetadataBand,
  cardMetadataFontSize,
  cardMetadataLines,
  cardMetadataSvg,
  cardNumeralColumns,
  cardNumeralMaskSvg,
  cardNumeralMaterial,
  cardProviderMinLeft,
  measureAlphaInk,
  normalizeCardRatingToTen,
  placeCardProviderMark,
  placeDoubleNumeral,
  renderCardNumeralLayer,
  renderCardPoster,
  splitCardNumeralColumns,
  type CardLayoutInput,
} from "@/lib/card-layout"
import { CARD_NUMERAL_CONDENSE_X, cardLayoutGeometry } from "@/lib/card-layout-geometry"
import {
  CARD_SKIN_NEUTRAL_ACCENT,
  STREMIO_CARD_SKIN_PALETTE,
  type CardSkin,
} from "@/lib/card-layout-skins"
import { renderSVG } from "@/lib/svg-badge"
import { LAND_H, LAND_W } from "@/lib/constants"
import { STD_H, STD_W } from "@/lib/image-utils"
import { MAX_SEPARATE_RATINGS } from "@/lib/ratings"

const SKINS: CardSkin[] = ["provider-glass", "nuvio", "stremio"]
const SHAPES = [
  { name: "poster" as const, w: STD_W, h: STD_H },
  { name: "landscape" as const, w: LAND_W, h: LAND_H },
] as const

const ART = { r: 18, g: 28, b: 46 }
const TITLE_FILL = { r: 196, g: 40, b: 64 }
const PROVIDER_FILL = { r: 36, g: 120, b: 200 }
const BIG_LOGO_FILL = { r: 40, g: 180, b: 80 }

async function solidPng(w: number, h: number, fill: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { ...fill, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

let cache: {
  artworkPoster: Buffer
  artworkLandscape: Buffer
  titleLogo: Buffer
  providerLogo: Buffer
  bigLogo: Buffer
  tinyArt: Buffer
  tinyLogo: Buffer
} | null = null

async function inputs() {
  if (!cache) {
    const [artworkPoster, artworkLandscape, titleLogo, providerLogo, bigLogo, tinyArt, tinyLogo] =
      await Promise.all([
        solidPng(400, 600, ART),
        solidPng(800, 450, ART),
        solidPng(300, 120, TITLE_FILL),
        solidPng(180, 60, PROVIDER_FILL),
        solidPng(1200, 900, BIG_LOGO_FILL),
        solidPng(1, 1, ART),
        solidPng(2, 2, TITLE_FILL),
      ])
    cache = { artworkPoster, artworkLandscape, titleLogo, providerLogo, bigLogo, tinyArt, tinyLogo }
  }
  return cache
}

function baseInput(
  skin: CardSkin,
  shape: "poster" | "landscape",
  c: NonNullable<typeof cache>,
  rank: number | null,
): CardLayoutInput {
  return {
    skin,
    shape,
    width: shape === "poster" ? STD_W : LAND_W,
    height: shape === "poster" ? STD_H : LAND_H,
    artwork: shape === "poster" ? c.artworkPoster : c.artworkLandscape,
    displayedRank: rank,
    titleLogo: c.titleLogo,
    providerLogo: c.providerLogo,
    brandAccent: "#E50914",
    genreName: "Drama",
    year: "2024",
    ratings: [
      { id: "imdb", value: 7.3 },
      { id: "tmdb", value: 8.1 },
    ],
  }
}

async function rawPixels(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

function pixelAt(raw: { data: Buffer; width: number }, x: number, y: number): [number, number, number] {
  const i = (y * raw.width + x) * 4
  return [raw.data[i] ?? 0, raw.data[i + 1] ?? 0, raw.data[i + 2] ?? 0]
}

interface DiffBounds {
  count: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Independent full-canvas diff between two final posters (raw RGB, no
 * helpers): every pixel whose channels differ, plus the tight bbox of the
 * diff. Proves numeral/metadata presence (count), placement (bbox vs card
 * edge / band) and completeness (margins from the canvas + card edges show
 * no clipped ink touching a boundary).
 *
 * `strongOnly` keeps only pixels where some channel moved by more than 24:
 * the CORE digit/metadata ink. The faint feDropShadow fringe moves
 * background pixels by less and is excluded, so margin assertions on the
 * strong mask prove the digits themselves are unclipped (fringe may
 * legitimately touch an edge and be cropped by placeInCanvas).
 */
function fullCanvasDiffBounds(
  a: { data: Buffer; width: number; height: number },
  b: { data: Buffer; width: number; height: number },
  strongOnly = false,
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
      const dr = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0))
      const dg = Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0))
      const db = Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0))
      const hit = strongOnly
        ? Math.max(dr, dg, db) > 24
        : dr !== 0 || dg !== 0 || db !== 0
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

const FIVE_RATINGS = [
  { id: "imdb", value: 7.3 },
  { id: "tmdb", value: 8.1 },
  { id: "tomatoes", value: 8.8 },
  { id: "letterboxd", value: 3.9 },
  { id: "trakt", value: 7.7 },
] as const

describe("card aggregate rating numeric contract (P8, deterministic, no renders)", () => {
  it("normalizes per actual provider scales: decimal as-is, percent /10, unknown fail-closed", () => {
    // MDBList separate values arrive already /10 at fetch: used as-is.
    expect(normalizeCardRatingToTen({ value: 8.8 })).toBe(8.8)
    expect(normalizeCardRatingToTen({ value: 8.7, format: "decimal" })).toBe(8.7)
    // Custom percent values are 0-100: /10.
    expect(normalizeCardRatingToTen({ value: 87, format: "percent" })).toBe(8.7)
    expect(normalizeCardRatingToTen({ value: 88, format: "percent" })).toBe(8.8)
    // Unknown scale: fail-closed (never guessed as /10).
    expect(normalizeCardRatingToTen({ value: 50, format: "stars" })).toBeNull()
    expect(normalizeCardRatingToTen({ value: 8.7, format: "" })).toBeNull()
    // Zero/negative/non-finite never contribute (existing averaging contracts).
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, "8.7", null, undefined]) {
      expect(normalizeCardRatingToTen({ value: bad as number })).toBeNull()
      expect(normalizeCardRatingToTen({ value: bad as number, format: "percent" })).toBeNull()
    }
    expect(normalizeCardRatingToTen({ value: 0, format: "percent" })).toBeNull()
  })

  it("means mixed scales equally with no final rounding inside the helper", () => {
    // 10-scale decimal + 100-scale percent + /10 separate: (8.7 + 8.7 + 8.8) / 3.
    expect(
      aggregateCardRating([
        { id: "imdb", value: 8.7 },
        { id: "custom", value: 87, format: "percent" },
        { id: "tomatoes", value: 8.8 },
      ]),
    ).toBeCloseTo(26.2 / 3, 10)
    // One provider: itself, unrounded.
    expect(aggregateCardRating([{ id: "tmdb", value: 7.16 }])).toBeCloseTo(7.16, 10)
    // No valid input: null (never an invented 0).
    for (const bad of [null, undefined, [], [{ id: "x", value: 0 }], [{ id: "", value: 8 }], [{ id: "x", value: 50, format: "stars" }]] as const) {
      expect(aggregateCardRating(bad as never)).toBeNull()
    }
    // Invalid entries are skipped, valid ones still count.
    expect(aggregateCardRating([{ id: "a", value: 8 }, { id: "b", value: 0 }, { id: "c", value: Number.NaN }])).toBe(8)
  })

  it("counts a duplicated provider once and is order independent", () => {
    // Same source via several paths carries the SAME value: counted once,
    // order independently ((7 + 8) / 2, never / 3).
    const dup = [
      { id: "imdb", value: 7 },
      { id: "IMDB", value: 7 },
      { id: " tmdb ", value: 8 },
    ]
    expect(aggregateCardRating(dup)).toBe(7.5)
    expect(aggregateCardRating([...dup].reverse())).toBe(7.5)
    const five = [...FIVE_RATINGS]
    expect(aggregateCardRating(five)).toBe(aggregateCardRating([...five].reverse()))
  })

  it("keeps the shared 5-provider cap: the 6th selected value never contributes", () => {
    const six = [...FIVE_RATINGS, { id: "extra", value: 1.0 }]
    expect(aggregateCardRating(six)).toBe(aggregateCardRating([...FIVE_RATINGS]))
    expect(MAX_SEPARATE_RATINGS).toBe(5)
  })

  it("rounds ONLY the final display to one decimal, with the reference gold star", () => {
    expect(cardMetadataLines({ genreName: "Drama", ratings: [...FIVE_RATINGS] }).map((l) => l.text)).toEqual([
      "DRAMA \u2022 \u2605 7.2",
    ])
    // Rating alone: no dangling separator; genre alone: no star.
    expect(cardMetadataLines({ ratings: [{ id: "tmdb", value: 8.34 }] }).map((l) => l.text)).toEqual(["\u2605 8.3"])
    expect(cardMetadataLines({ genreName: "Drama" }).map((l) => l.text)).toEqual(["DRAMA"])
    // Year stays a separate compact line, never touching the main rating.
    expect(
      cardMetadataLines({ genreName: "Drama", year: "2024", ratings: [{ id: "tmdb", value: 8.3 }] }).map((l) => l.text),
    ).toEqual(["DRAMA \u2022 \u2605 8.3", "2024"])
    expect(cardMetadataLines({ genreName: null, year: null, ratings: null })).toEqual([])
    // Toggle-off equivalents: nothing renders, nothing invented.
    expect(cardMetadataLines({})).toEqual([])
    // The shipped SVG carries the verbatim reference gold star fill as a
    // vector path (no Noto glyph fallback, no textLength squeeze).
    expect(CARD_META_STAR_FILL).toBe("#FFB800")
    const meta = cardMetadataSvg(
      cardMetadataLines({ genreName: "Drama", ratings: [{ id: "tmdb", value: 8.3 }] }),
      360,
      120,
      cardMetadataFontSize(STD_W),
    )!
    expect(meta.svg).toContain("#FFB800")
    expect(meta.svg).toContain("<path")
    expect(meta.svg).not.toContain("\u2605")
    expect(meta.svg).not.toContain("textLength")
    expect(meta.svg).not.toContain("TMDB")
  })
})

describe("poster card render (isolated shared compositor)", () => {
  it("renders all 3 skins x 2 shapes at exact dimensions, offline deterministic", async () => {
    const c = await inputs()
    for (const skin of SKINS) {
      for (const shape of SHAPES) {
        const png = await renderCardPoster(baseInput(skin, shape.name, c, 7))
        const meta = await sharp(png).metadata()
        expect(meta.width).toBe(shape.w)
        expect(meta.height).toBe(shape.h)
        // Fully opaque final poster.
        const raw = await rawPixels(png)
        for (let i = 3; i < raw.data.length; i += 64 * 4) {
          expect(raw.data[i]).toBe(255)
        }
      }
    }
    expect(MAX_SEPARATE_RATINGS).toBe(5)
  }, 120000)

  it("provider-glass: ranks 1..20 show complete unoccluded glyphs with margins (measured final pixels)", async () => {
    const c = await inputs()
    await assertRanksComplete("provider-glass", c)
  }, 180000)

  it("nuvio: ranks 1..20 show complete unoccluded glyphs with margins (measured final pixels)", async () => {
    const c = await inputs()
    await assertRanksComplete("nuvio", c)
  }, 180000)

  it("stremio: ranks 1..20 show complete unoccluded glyphs with margins (measured final pixels)", async () => {
    const c = await inputs()
    await assertRanksComplete("stremio", c)
  }, 180000)

  it("draws no numeral for absent/invalid ranks incl. 21+, byte-identical to unranked", async () => {
    const c = await inputs()
    for (const shape of SHAPES) {
      const plain = baseInput("provider-glass", shape.name, c, null)
      const unranked = await renderCardPoster(plain)
      for (const rank of [undefined, 0, -3, 1.5, 21, 42, 100, Number.NaN] as const) {
        const png = await renderCardPoster({ ...plain, displayedRank: rank as number | null })
        expect(Buffer.compare(png, unranked)).toBe(0)
      }
    }
  }, 120000)

  it("ranked/unranked and missing provider/title logos render safe with exact dims", async () => {
    const c = await inputs()
    for (const skin of SKINS) {
      for (const shape of SHAPES) {
        for (const opts of [
          { titleLogo: null, providerLogo: null, genreName: null, year: null, ratings: null },
          { titleLogo: undefined, providerLogo: undefined },
          {},
        ] as const) {
          const png = await renderCardPoster({
            ...baseInput(skin, shape.name, c, 5),
            ...opts,
            displayedRank: null,
          })
          const meta = await sharp(png).metadata()
          expect(meta.width).toBe(shape.w)
          expect(meta.height).toBe(shape.h)
        }
      }
    }
  }, 120000)

  it("aggregates the 5 selected providers to ONE inline score below the card (measured final pixels)", async () => {
    const c = await inputs()
    // P8 intentional change: no per-source rows, no source labels — the
    // equal mean normalized to /10, rounded ONLY at display to one decimal:
    // (7.3 + 8.1 + 8.8 + 3.9 + 7.7) / 5 = 7.16 -> "7.2".
    const lines = cardMetadataLines({ genreName: "Drama", year: "2024", ratings: [...FIVE_RATINGS] })
    expect(lines.map((l) => l.text)).toEqual(["DRAMA \u2022 \u2605 7.2", "2024"])
    expect(lines).toHaveLength(2)
    for (const shape of SHAPES) {
      const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 4)!
      const band = cardMetadataBand(shape.w, shape.h, geo)!
      expect(band.w).toBeGreaterThan(0)
      expect(band.h).toBeGreaterThan(0)
      // Band sits strictly below the card and right of the provider slot.
      expect(band.y0).toBeGreaterThanOrEqual(geo.card.y + geo.card.height)
      expect(band.y1).toBeLessThanOrEqual(shape.h)
      expect(band.x0).toBeGreaterThanOrEqual(
        Math.ceil(geo.provider.centerX + geo.provider.maxWidth / 2),
      )
      const meta = cardMetadataSvg(lines, band.w, band.h, cardMetadataFontSize(shape.w))!
      expect(meta).not.toBeNull()
      // Legible: never a microscopic shrink.
      expect(meta.fontSize).toBeGreaterThanOrEqual(CARD_META_MIN_FONT)
      expect(meta.fontSize).toBeGreaterThanOrEqual(11)
      expect(meta.w).toBeLessThanOrEqual(band.w)
      expect(meta.h).toBeLessThanOrEqual(band.h)
      // ONE aggregate score in the shipped SVG: no source names, no
      // individual source values (the bare "%" lives in filter defs, so the
      // percent needle pins the full "88%" display value instead).
      expect(meta.svg).toContain("7.2")
      expect(meta.svg).toContain("<path")
      expect(meta.svg).not.toContain("\u2605")
      expect(meta.svg).not.toContain("textLength")
      expect(meta.svg).toContain("#FFB800")
      for (const needle of ["IMDB", "TMDB", "TOMATOES", "LETTERBOXD", "TRAKT", "88%", "7.3", "8.1", "3.9", "7.7"]) {
        expect(meta.svg).not.toContain(needle)
      }
      for (const skin of SKINS) {
        const full = await renderCardPoster({
          ...baseInput(skin, shape.name, c, 4),
          genreName: "Drama",
          year: "2024",
          ratings: [...FIVE_RATINGS],
        })
        expect((await sharp(full).metadata()).width).toBe(shape.w)
        const bare = await renderCardPoster({
          ...baseInput(skin, shape.name, c, 4),
          genreName: null,
          year: null,
          ratings: null,
        })
        const diff = fullCanvasDiffBounds(await rawPixels(bare), await rawPixels(full))
        // Legible ink for the single inline line + year (not a shrunken speck).
        expect(diff.count).toBeGreaterThan(100)
        // Every new pixel sits inside the below-card band…
        expect(diff.minX).toBeGreaterThanOrEqual(band.x0)
        expect(diff.maxX).toBeLessThanOrEqual(band.x1)
        expect(diff.minY).toBeGreaterThanOrEqual(band.y0)
        expect(diff.maxY).toBeLessThanOrEqual(band.y1)
        // …and zero pixels spill onto the artwork card.
        const card = geo.card
        const onCard =
          diff.maxX >= card.x &&
          diff.minX < card.x + card.width &&
          diff.maxY >= card.y &&
          diff.minY < card.y + card.height
        expect(onCard).toBe(false)
      }
    }
  }, 180000)

  it("all five selected sources contribute to the aggregate (changing #4/#5 moves the score)", async () => {
    const c = await inputs()
    const render = (ratings: readonly { id: string; value: number }[]) =>
      renderCardPoster({ ...baseInput("stremio", "poster", c, 4), genreName: "Drama", year: null, ratings })
    const five = await render([...FIVE_RATINGS])
    // Dropping the 5th source moves the mean: (7.3+8.1+8.8+3.9)/4 = 7.025 -> "7.0" vs "7.2".
    expect(cardMetadataLines({ genreName: "Drama", ratings: [...FIVE_RATINGS].slice(0, 4) }).map((l) => l.text)).toEqual([
      "DRAMA \u2022 \u2605 7.0",
    ])
    const four = await render([...FIVE_RATINGS].slice(0, 4))
    expect(Buffer.compare(five, four)).not.toBe(0)
    // Changing only the 4th source (letterboxd 3.9 -> 9.9) moves the mean too.
    const changed4 = [...FIVE_RATINGS].map((r, i) => (i === 3 ? { ...r, value: 9.9 } : r))
    expect(Buffer.compare(five, await render(changed4))).not.toBe(0)
    // Same five in another order: identical bytes (order-independent mean).
    const shuffled = [...FIVE_RATINGS].reverse()
    expect(Buffer.compare(five, await render(shuffled))).toBe(0)
  }, 180000)

  it("fits an oversized metadata overlay into the same band on both axes; invalid overlays omit safely", async () => {
    const c = await inputs()
    const bigOverlay = {
      png: await solidPng(1200, 900, { r: 220, g: 30, b: 60 }),
      w: 1200,
      h: 900,
    }
    for (const shape of SHAPES) {
      const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, null)!
      const band = cardMetadataBand(shape.w, shape.h, geo)!
      const png = await renderCardPoster({
        ...baseInput("provider-glass", shape.name, c, null),
        genreName: null,
        year: null,
        ratings: null,
        metadataOverlay: bigOverlay,
      })
      expect((await sharp(png).metadata()).width).toBe(shape.w)
      const bare = await renderCardPoster({
        ...baseInput("provider-glass", shape.name, c, null),
        genreName: null,
        year: null,
        ratings: null,
      })
      const diff = fullCanvasDiffBounds(await rawPixels(bare), await rawPixels(png))
      expect(diff.count).toBeGreaterThan(200)
      expect(diff.minX).toBeGreaterThanOrEqual(band.x0)
      expect(diff.maxX).toBeLessThanOrEqual(band.x1)
      expect(diff.minY).toBeGreaterThanOrEqual(band.y0)
      expect(diff.maxY).toBeLessThanOrEqual(band.y1)
      const card = geo.card
      expect(
        diff.maxX >= card.x &&
          diff.minX < card.x + card.width &&
          diff.maxY >= card.y &&
          diff.minY < card.y + card.height,
      ).toBe(false)
    }
    // Invalid overlays never 500 and never paint: garbage bytes, zero dims,
    // and empty buffers all degrade to the resolved-values path (here: no
    // values => byte-identical to the bare poster).
    for (const bad of [
      { png: Buffer.from([0, 1, 2, 3, 4, 5]), w: 100, h: 20 },
      { png: await solidPng(8, 8, { r: 9, g: 9, b: 9 }), w: 0, h: 0 },
      { png: Buffer.alloc(0), w: 10, h: 10 },
    ]) {
      const png = await renderCardPoster({
        ...baseInput("nuvio", "poster", c, null),
        genreName: null,
        year: null,
        ratings: null,
        metadataOverlay: bad,
      })
      expect((await sharp(png).metadata()).width).toBe(STD_W)
      const bare = await renderCardPoster({
        ...baseInput("nuvio", "poster", c, null),
        genreName: null,
        year: null,
        ratings: null,
      })
      expect(Buffer.compare(png, bare)).toBe(0)
    }
  }, 120000)

  it("accepts tiny but valid PNGs (<100 bytes) for artwork, logos and overlay", async () => {
    const c = await inputs()
    expect(c.tinyArt.length).toBeLessThan(100)
    expect(c.tinyLogo.length).toBeLessThan(100)
    const png = await renderCardPoster({
      ...baseInput("stremio", "poster", c, 3),
      artwork: c.tinyArt,
      titleLogo: c.tinyLogo,
      providerLogo: c.tinyLogo,
    })
    expect((await sharp(png).metadata()).width).toBe(STD_W)
    expect((await sharp(png).metadata()).height).toBe(STD_H)
    const tinyOverlay = { png: c.tinyLogo, w: 2, h: 2 }
    const withOverlay = await renderCardPoster({
      ...baseInput("stremio", "poster", c, null),
      genreName: null,
      year: null,
      ratings: null,
      metadataOverlay: tinyOverlay,
    })
    expect((await sharp(withOverlay).metadata()).width).toBe(STD_W)
  }, 60000)

  it("escapes hostile metadata text: no markup passthrough, render stays safe", async () => {
    const c = await inputs()
    const evil = '<script>alert(1)</script> & "quoted"'
    const lines = cardMetadataLines({
      genreName: evil,
      year: '2024<img src=x onerror=alert(1)>',
      ratings: [{ id: "imdb", value: 7.3 }],
    })
    const meta = cardMetadataSvg(lines, STD_W - 16, 120, cardMetadataFontSize(STD_W))!
    expect(meta.svg).not.toContain("<script>")
    expect(meta.svg).not.toContain(evil)
    expect(meta.svg).toContain("&lt;SCRIPT&gt;")
    expect(meta.svg).toContain("&amp;")
    const png = await renderCardPoster({
      ...baseInput("stremio", "poster", c, 3),
      genreName: evil,
      year: '2024<img src=x onerror=alert(1)>',
    })
    expect((await sharp(png).metadata()).width).toBe(STD_W)
  }, 120000)

  it("paints the artwork cover-fit inside the rounded card; corners show background", async () => {
    const c = await inputs()
    const png = await renderCardPoster({
      ...baseInput("nuvio", "poster", c, null),
      titleLogo: null,
      providerLogo: null,
      genreName: null,
      year: null,
      ratings: null,
    })
    const raw = await rawPixels(png)
    const geo = cardLayoutGeometry("poster", STD_W, STD_H, null)!
    // Card center carries the artwork color exactly (solid synthetic base).
    const cx = Math.round(geo.card.x + geo.card.width / 2)
    const cy = Math.round(geo.card.y + geo.card.height / 2)
    const [cr, cg, cb] = pixelAt(raw, cx, cy)
    expect(Math.abs(cr - ART.r)).toBeLessThanOrEqual(4)
    expect(Math.abs(cg - ART.g)).toBeLessThanOrEqual(4)
    expect(Math.abs(cb - ART.b)).toBeLessThanOrEqual(4)
    // Corner cutout (2px inside the card corner, well within the radius)
    // shows the background/shadow, never the artwork color.
    const [xr, xg, xb] = pixelAt(raw, geo.card.x + 2, geo.card.y + 2)
    const cornerDiff = Math.abs(xr - ART.r) + Math.abs(xg - ART.g) + Math.abs(xb - ART.b)
    expect(cornerDiff).toBeGreaterThan(30)
  }, 60000)

  it("contains an oversized title logo inside the card: no crop spill, no throw", async () => {
    const c = await inputs()
    const png = await renderCardPoster({
      ...baseInput("provider-glass", "poster", c, 9),
      titleLogo: c.bigLogo,
      providerLogo: null,
      genreName: null,
      year: null,
      ratings: null,
    })
    expect((await sharp(png).metadata()).width).toBe(STD_W)
    const raw = await rawPixels(png)
    const geo = cardLayoutGeometry("poster", STD_W, STD_H, 9)!
    const nearGreen = (r: number, g: number, b: number): boolean =>
      Math.abs(r - BIG_LOGO_FILL.r) <= 4 &&
      Math.abs(g - BIG_LOGO_FILL.g) <= 4 &&
      Math.abs(b - BIG_LOGO_FILL.b) <= 4
    let outside = 0
    let inside = 0
    for (let y = 0; y < STD_H; y++) {
      for (let x = 0; x < STD_W; x++) {
        const [r, g, b] = pixelAt(raw, x, y)
        if (!nearGreen(r, g, b)) continue
        const inCard =
          x >= geo.card.x &&
          x < geo.card.x + geo.card.width &&
          y >= geo.card.y &&
          y < geo.card.y + geo.card.height
        if (inCard) inside++
        else outside++
      }
    }
    expect(inside).toBeGreaterThan(500)
    expect(outside).toBe(0)
  }, 60000)

  it("rejects unknown skins/shapes, bad canvases and missing artwork; tiny canvases collapse safely", async () => {
    const c = await inputs()
    const good = baseInput("nuvio", "poster", c, 1)
    await expect(renderCardPoster({ ...good, skin: "glass" as CardSkin })).rejects.toThrow()
    await expect(renderCardPoster({ ...good, shape: "banner" as "poster" })).rejects.toThrow()
    await expect(renderCardPoster({ ...good, width: 0, height: STD_H })).rejects.toThrow()
    await expect(renderCardPoster({ ...good, artwork: Buffer.alloc(0) })).rejects.toThrow()
    await expect(renderCardPoster({ ...good, artwork: Buffer.from([1, 2, 3]) })).rejects.toThrow()
    await expect(renderCardPoster({ ...good, width: 2, height: 3 })).rejects.toThrow()
  }, 60000)

  it("hollow outline: the 0-counter of rank 20 stays background while its ring paints (measured final pixels)", async () => {
    const c = await inputs()
    for (const shape of SHAPES) {
      const plain = baseInput("provider-glass", shape.name, c, null)
      const rawBase = await rawPixels(await renderCardPoster(plain))
      const ranked = await rawPixels(
        await renderCardPoster({ ...plain, displayedRank: 20 }),
      )
      // Independent final-pixel proof (no helper tautology): raw RGB diff vs
      // the identical unranked poster, strong mask only.
      const diff = fullCanvasDiffBounds(rawBase, ranked, true)
      expect(diff.count).toBeGreaterThan(600)
      const w = diff.maxX - diff.minX + 1
      const h = diff.maxY - diff.minY + 1
      expect(w).toBeGreaterThan(8)
      expect(h).toBeGreaterThan(8)
      // The "0" is the right digit: sample the middle of its right half.
      const cx = Math.round(diff.minX + (w * 3) / 4)
      const cy = Math.round(diff.minY + h / 2)
      const deltaAt = (x: number, y: number): number => {
        const i = (y * ranked.width + x) * 4
        return Math.max(
          Math.abs((ranked.data[i] ?? 0) - (rawBase.data[i] ?? 0)),
          Math.abs((ranked.data[i + 1] ?? 0) - (rawBase.data[i + 1] ?? 0)),
          Math.abs((ranked.data[i + 2] ?? 0) - (rawBase.data[i + 2] ?? 0)),
        )
      }
      // Counter center: hollow, background shows through (3x3 mean delta is
      // background noise, far below ink). A filled metallic numeral would
      // paint this pixel with bright ink (delta > 100).
      let centerSum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          centerSum += deltaAt(cx + dx, cy + dy)
        }
      }
      expect(centerSum / 9).toBeLessThanOrEqual(12)
      // …while the same row crosses the painted outline ring on the right
      // digit (strong ink both left and right of the hollow center).
      let leftRing = 0
      for (let x = diff.minX + Math.floor(w / 2); x < cx; x++) {
        leftRing = Math.max(leftRing, deltaAt(x, cy))
      }
      let rightRing = 0
      for (let x = cx + 1; x <= diff.maxX; x++) {
        rightRing = Math.max(rightRing, deltaAt(x, cy))
      }
      expect(leftRing).toBeGreaterThan(60)
      expect(rightRing).toBeGreaterThan(60)
    }
  }, 120000)

  it("numeral skins use distinct hollow-outline materials with safe accent handling", async () => {
    const geo = cardLayoutGeometry("poster", STD_W, STD_H, 7)!
    const num = geo.numeral!
    const provMat = cardNumeralMaterial("provider-glass", "#E50914", num.fontSize)
    const streMat = cardNumeralMaterial("stremio", "#E50914", num.fontSize)
    const nuvMat = cardNumeralMaterial("nuvio", "#E50914", num.fontSize)
    // All three carry the hollow union-ring outline materials (P18: the
    // contour is an exact Euclidean distance ring over the glyph union —
    // no stroked `<text>`, no square-kernel `feMorphology` anywhere; the
    // raster counter proof lives in `poster-card-numeral.test.ts`).
    for (const m of [provMat, streMat, nuvMat]) {
      expect(m.filterDef).toContain("cardNumFilter")
      expect(m.filterDef).not.toContain("feMorphology")
      expect(m.filterDef).not.toContain("feGaussianBlur")
    }
    // Provider strokes the crystal gradient; standard skins stroke the
    // reference neon gradient — verbatim reference stops on both.
    expect(provMat.gradientId).toBe("cardNumCrystalStroke")
    expect(provMat.gradientStops).toContain("#CBD5E1")
    expect(provMat.gradientStops).not.toContain("cardNumStrokeGrad")
    for (const m of [streMat, nuvMat]) {
      expect(m.gradientId).toBe("cardNumStrokeGrad")
      expect(m.gradientStops).toContain("#C9CDD3")
      expect(m.gradientStops).not.toContain("cardNumCrystalStroke")
    }
    // Accent semantics: provider ignores any accent (pure crystal), stremio
    // uses its fixed violet skin accent, nuvio uses the resolved brand accent.
    expect(provMat.filterDef).not.toContain("#E50914")
    expect(streMat.filterDef).toContain(STREMIO_CARD_SKIN_PALETTE.stroke.s4)
    expect(streMat.filterDef).not.toContain("#E50914")
    expect(nuvMat.filterDef).toContain("#E50914")
    // Hostile accents cannot inject markup: strict #rrggbb gate with neutral
    // fallback, same sentinel as the skins.
    const evil = cardNumeralMaterial("nuvio", '"><script>alert(1)</script>', num.fontSize)
    expect(evil.filterDef).not.toContain("<script>")
    expect(evil.filterDef).toContain(CARD_SKIN_NEUTRAL_ACCENT)
    // Pairwise distinct materials.
    expect(provMat.gradientStops).not.toBe(streMat.gradientStops)
    expect(provMat.filterDef).not.toBe(nuvMat.filterDef)
    expect(streMat.filterDef).not.toBe(nuvMat.filterDef)
    // Pixel proof on isolated numeral layers (no helpers): the accent glow
    // fringe carries the accent hue — red vs blue brand glows differ in the
    // fringe band (alpha 30..120 excludes the shared white-ish stroke core).
    async function fringeMean(png: Buffer): Promise<[number, number, number]> {
      const { data } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0
        if (a >= 30 && a <= 120) {
          r += data[i] ?? 0
          g += data[i + 1] ?? 0
          b += data[i + 2] ?? 0
          n++
        }
      }
      expect(n).toBeGreaterThan(50)
      return [r / n, g / n, b / n]
    }
    const red = await renderCardNumeralLayer(
      7, num.fontSize, num.letterSpacing, num.strokeWidth, "nuvio", "#E50914",
    )
    const blue = await renderCardNumeralLayer(
      7, num.fontSize, num.letterSpacing, num.strokeWidth, "nuvio", "#00A8E1",
    )
    const [rr, , rb] = await fringeMean(red.png)
    const [br, , bb] = await fringeMean(blue.png)
    expect(rr - br).toBeGreaterThan(8)
    expect(bb - rb).toBeGreaterThan(8)
  }, 120000)

  it("stays a shared compositing stage only: no fetch, provider lookup, blur roundtrip, morphology kernel or new deps", () => {    const raw = readFileSync(join(__dirname, "..", "lib", "card-layout.ts"), "utf8")
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1")
    expect(src).not.toMatch(/fetch\s*\(/)
    expect(src).not.toContain("feGaussianBlur")
    // P18: the numeral contour is an exact Euclidean distance ring
    // computed in code — no SVG square-kernel morphology anywhere (the
    // P16/P17 diagonal-inflation source); the Fresh rim filter is
    // untouched (separate module, out of scope).
    expect(src).not.toContain("feMorphology")
    expect(src).not.toMatch(/\.blur\s*\(/)
    expect(src).not.toMatch(/catalogKey/)
    expect(src).not.toContain("image.tmdb.org")
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1])
    for (const mod of imports) {
      expect([
        "sharp",
        "./types",
        "./card-layout-geometry",
        "./card-layout-skins",
        "./svg-badge",
        "./badge-svg-shared",
        "./ratings",
      ]).toContain(mod)
    }
  })
})

async function assertRanksComplete(skin: CardSkin, c: NonNullable<typeof cache>): Promise<void> {
  for (const shape of SHAPES) {
    const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 7)!
    const unranked = await renderCardPoster(baseInput(skin, shape.name, c, null))
    const rawBase = await rawPixels(unranked)
    const single = await renderCardPoster(baseInput(skin, shape.name, c, 1))
    const singleDiff = fullCanvasDiffBounds(rawBase, await rawPixels(single), true)
    expect(singleDiff.count).toBeGreaterThan(200)
    expect(singleDiff.maxX).toBeLessThan(geo.card.x)
    const singleH = singleDiff.maxY - singleDiff.minY + 1
    expect(singleH).toBeGreaterThan(8)
    // Every double rank 10..20 (not a sampled subset): the condensed render
    // must carry complete two-digit ink at the reference height.
    for (let rank = 10; rank <= 20; rank++) {
      const g = cardLayoutGeometry(shape.name, shape.w, shape.h, rank)!
      const n = g.numeral!
      expect(n.digitCount).toBe(2)
      expect(n.condenseX).toBe(CARD_NUMERAL_CONDENSE_X)
      const png = await renderCardPoster(baseInput(skin, shape.name, c, rank))
      expect((await sharp(png).metadata()).width).toBe(shape.w)
      expect((await sharp(png).metadata()).height).toBe(shape.h)
      // Independent final-pixel proof (no helper tautology): raw RGB diff
      // vs the identical unranked poster. The STRONG mask (channel delta
      // > 24) is the digit ink; faint shadow fringe is excluded so the
      // margins below prove unclipped digits, not cropped shadows.
      const rawRanked = await rawPixels(png)
      const diff = fullCanvasDiffBounds(rawBase, rawRanked, true)
      // Readable complete glyph: a solid block of new ink appears.
      expect(diff.count).toBeGreaterThan(600)
      // …inside the canvas…
      expect(diff.minX).toBeGreaterThanOrEqual(0)
      expect(diff.minY).toBeGreaterThanOrEqual(0)
      expect(diff.maxY).toBeLessThan(shape.h)
      // …and never OVER the artwork card (the numeral slides behind it by
      // construction; visible ink stops at its edge). Fringe may touch the
      // canvas left edge and be cropped there — the core containment below
      // proves no digit ink is lost.
      expect(diff.maxX).toBeLessThan(geo.card.x)
      // HEIGHT, not width/aspect: the visible strong-ink height is at least
      // 80% of the same rank rendered UNCONDENSED at the same reference
      // size (the actual uncondensed base outline, measured — never an
      // assumed scale). A uniform-shrink regression (old gutter-fit) lands
      // at ~55% and fails here.
      const refSpec = await renderCardNumeralLayer(
        rank, n.fontSize, n.letterSpacing, n.strokeWidth, skin, "#E50914",
      )
      const refInk = await measureAlphaInk(refSpec.png, 24)
      expect(refInk).not.toBeNull()
      const refH = refInk!.maxY - refInk!.minY + 1
      const diffH = diff.maxY - diff.minY + 1
      expect(diffH).toBeGreaterThanOrEqual(refH * 0.8)
      // TWO ORDERED MASSES on the visible ink: the column valley between
      // the digits survives compositing (supplementary; the strict proof
      // below runs on the full isolated layer).
      const cols = diffColumns(rawBase, rawRanked, true)
      const lo = Math.ceil(diff.minX + (diff.maxX - diff.minX + 1) * 0.3)
      const hi = Math.floor(diff.minX + (diff.maxX - diff.minX + 1) * 0.7)
      let colMax = 0
      for (let x = diff.minX; x <= diff.maxX; x++) colMax = Math.max(colMax, cols[x] ?? 0)
      let valley = colMax
      for (let x = lo; x <= hi; x++) valley = Math.min(valley, cols[x] ?? 0)
      expect(colMax).toBeGreaterThan(0)
      expect(1 - valley / colMax).toBeGreaterThanOrEqual(0.5)
      // STRICT full-glyph proof on the shipped placement itself: the
      // production placer returns the placed layer — re-measure it
      // independently and require two ordered digit masses (shared split
      // logic, independently measured data), the first digit fully before
      // the card edge and the second digit majoritarily visible. The
      // structure comes from the shadowless glyph mask (identical grid to
      // the shipped layer — the shipped glow bridges narrow condensed
      // junctions at ink thresholds); containment from the placed layer.
      const placed = await placeDoubleNumeral(
        rank, n.anchorX, n.baselineY, n.fontSize, n.letterSpacing,
        n.strokeWidth, n.condenseX, skin, "#E50914", geo.card.x, shape.w, shape.h,
      )
      expect(placed).not.toBeNull()
      const placedMeta = await sharp(placed!.png).metadata()
      // The placer may condense tighter than the base factor when the base
      // width would half-hide the second digit (P16 fallback ladder): the
      // re-derivation below follows the WINNING factor, never assumes 0.6.
      const winCx = placed!.condenseX
      expect(winCx).toBeLessThanOrEqual(n.condenseX)
      expect(winCx).toBeGreaterThanOrEqual(0.45)
      const maskSpec = cardNumeralMaskSvg(
        rank, n.fontSize, n.letterSpacing, n.strokeWidth, winCx,
      )
      // Re-derive the spec origin independently (builders shared, math
      // re-done): the measured shift lands the strong ink inside the canvas,
      // and only provably-empty transparent margin may be cropped — the
      // trimmed amount x0 maps mask columns onto placed columns. No tuck:
      // the natural origin stands (correction cycle 1).
      const shipSpec = await renderCardNumeralLayer(
        rank, n.fontSize, n.letterSpacing, n.strokeWidth, skin, "#E50914", winCx,
      )
      expect(shipSpec.svgW).toBe(maskSpec.svgW)
      expect(shipSpec.svgH).toBe(maskSpec.svgH)
      const shipStrong = await measureAlphaInk(shipSpec.png, 24)
      expect(shipStrong).not.toBeNull()
      const shipCore = await measureAlphaInk(shipSpec.png, CARD_NUMERAL_CORE_THRESHOLD)
      expect(shipCore).not.toBeNull()
      const originLeft = n.anchorX - shipSpec.pad + Math.max(0, 1 - (n.anchorX - shipSpec.pad + shipStrong!.minX))
      const originTop = n.baselineY - shipSpec.baselineY
      const maskCols = await cardNumeralColumns(
        await renderSVG(maskSpec.svg, maskSpec.svgW), maskSpec.svgW, 10,
      )
      expect(maskCols).not.toBeNull()
      const split = splitCardNumeralColumns(maskCols!.counts, maskCols!.minX, maskCols!.maxX)
      expect(split).not.toBeNull()
      const expLeft = originLeft
      const x0 = Math.max(0, -expLeft)
      // The crop removed only empty columns (x0 never reaches the strong ink)…
      expect(x0).toBeLessThanOrEqual(shipStrong!.minX)
      // …no other side was cropped (right/bottom/top proven inside)…
      expect(placedMeta.width).toBe(maskSpec.svgW - x0)
      expect(placedMeta.height).toBe(maskSpec.svgH)
      expect(placed!.left).toBe(expLeft + x0)
      expect(placed!.top).toBe(originTop)
      // …so mask columns map onto the canvas via the pre-crop origin.
      expect(expLeft + split!.valleyX - 1).toBeLessThan(geo.card.x - 1)
      const d2w = expLeft + maskCols!.maxX - (expLeft + split!.valleyX)
      const d2vis = Math.min(expLeft + maskCols!.maxX, geo.card.x - 1) - (expLeft + split!.valleyX) + 1
      expect(d2w).toBeGreaterThan(0)
      expect(d2vis).toBeGreaterThanOrEqual(d2w * 0.5)
      // No font clip: the full shipped core bbox sits inside the canvas.
      const placedCore = await cardNumeralColumns(placed!.png, placedMeta.width ?? 0, 80)
      expect(placedCore).not.toBeNull()
      // Cropped-local core + post-crop left == spec-local core + origin.
      expect(placed!.left + placedCore!.minX).toBeGreaterThanOrEqual(1)
    }
  }
}

/**
 * Per-column hit counts of the strong RGB diff between two final posters
 * (same strong mask as `fullCanvasDiffBounds(strongOnly=true)`).
 */
function diffColumns(
  a: { data: Buffer; width: number; height: number },
  b: { data: Buffer; width: number; height: number },
  strongOnly: boolean,
): number[] {
  expect(a.width).toBe(b.width)
  expect(a.height).toBe(b.height)
  const cols = new Array<number>(a.width).fill(0)
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      const dr = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0))
      const dg = Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0))
      const db = Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0))
      const hit = strongOnly
        ? Math.max(dr, dg, db) > 24
        : dr !== 0 || dg !== 0 || db !== 0
      if (hit) cols[x]!++
    }
  }
  return cols
}

describe("card metadata P8 correction (independent raster proof)", () => {
  interface Raw {
    readonly data: Buffer
    readonly w: number
    readonly h: number
  }

  async function rawOf(png: Buffer): Promise<Raw> {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return { data: data as Buffer, w: info.width, h: info.height }
  }

  interface Bounds {
    readonly count: number
    readonly minX: number
    readonly maxX: number
    readonly minY: number
    readonly maxY: number
  }

  function emptyBounds(w: number, h: number): Bounds {
    return { count: 0, minX: w, maxX: -1, minY: h, maxY: -1 }
  }

  function grow(b: Bounds, x: number, y: number): Bounds {
    return {
      count: b.count + 1,
      minX: Math.min(b.minX, x),
      maxX: Math.max(b.maxX, x),
      minY: Math.min(b.minY, y),
      maxY: Math.max(b.maxY, y),
    }
  }

  function isGold(r: number, g: number, bl: number, a: number): boolean {
    return a > 24 && r > 150 && g > 90 && g < 230 && bl < 110
  }

  function isWhiteInk(r: number, g: number, bl: number, a: number): boolean {
    return (
      a > 24 &&
      r > 150 &&
      g > 150 &&
      bl > 150 &&
      Math.max(r, g, bl) - Math.min(r, g, bl) < 48
    )
  }

  function scanMasks(raw: Raw): { gold: Bounds; white: Bounds } {
    let gold = emptyBounds(raw.w, raw.h)
    let white = emptyBounds(raw.w, raw.h)
    for (let y = 0; y < raw.h; y++) {
      for (let x = 0; x < raw.w; x++) {
        const o = (y * raw.w + x) * 4
        const r = raw.data[o] ?? 0
        const g = raw.data[o + 1] ?? 0
        const b = raw.data[o + 2] ?? 0
        const a = raw.data[o + 3] ?? 0
        if (isGold(r, g, b, a)) gold = grow(gold, x, y)
        else if (isWhiteInk(r, g, b, a)) white = grow(white, x, y)
      }
    }
    return { gold, white }
  }

  function whiteInColumns(
    raw: Raw,
    x0: number,
    x1: number,
  ): Bounds {
    let b = emptyBounds(raw.w, raw.h)
    const lo = Math.max(0, x0)
    const hi = Math.min(raw.w - 1, x1)
    for (let y = 0; y < raw.h; y++) {
      for (let x = lo; x <= hi; x++) {
        const o = (y * raw.w + x) * 4
        const r = raw.data[o] ?? 0
        const g = raw.data[o + 1] ?? 0
        const bl = raw.data[o + 2] ?? 0
        const a = raw.data[o + 3] ?? 0
        if (!isGold(r, g, bl, a) && isWhiteInk(r, g, bl, a)) b = grow(b, x, y)
      }
    }
    return b
  }

  it("score segment is complete and separated: both 8.3 digits vs an isolated mask", async () => {
    const lines = [{ kind: "rating", text: "DRAMA \u2022 \u2605 8.3" }] as const
    const meta = cardMetadataSvg(lines, 360, 120, cardMetadataFontSize(STD_W))!
    expect(meta).not.toBeNull()
    const full = await rawOf(await renderSVG(meta.svg, meta.w))
    const { gold } = scanMasks(full)
    // A readable gold star paints real ink (not a squeezed speck).
    expect(gold.count).toBeGreaterThan(20)
    // Genre ink (white, left of the star) ends before the star starts…
    const genre = whiteInColumns(full, 0, gold.minX - 1)
    expect(genre.count).toBeGreaterThan(20)
    expect(genre.maxX + 2).toBeLessThanOrEqual(gold.minX)
    // …and the score ink (white, right of the star) starts after it ends.
    const score = whiteInColumns(full, gold.maxX + 1, full.w - 1)
    expect(score.count).toBeGreaterThan(20)
    expect(gold.maxX + 2).toBeLessThanOrEqual(score.minX)
    // Isolated complete "8.3" at the same shipped size: the score segment
    // carries both digits (a clipped "8." keeps ~60% of the ink/width).
    const isoSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60" viewBox="0 0 200 60">` +
      `<text x="100" y="30" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="Inter" font-weight="600" font-size="${meta.fontSize}" fill="#F3F4F6">8.3</text></svg>`
    const iso = await rawOf(await renderSVG(isoSvg, 200))
    const isoScore = whiteInColumns(iso, 0, iso.w - 1)
    expect(isoScore.count).toBeGreaterThan(20)
    const isoW = isoScore.maxX - isoScore.minX + 1
    const scoreW = score.maxX - score.minX + 1
    expect(score.count).toBeGreaterThanOrEqual(Math.round(isoScore.count * 0.8))
    expect(scoreW).toBeGreaterThanOrEqual(Math.round(isoW * 0.8))
    // No ink cut at the SVG bounds: the score never touches the right edge.
    expect(score.maxX).toBeLessThan(meta.w - 1)
    expect(genre.minX).toBeGreaterThanOrEqual(0)
  }, 60000)

  it("year renders on its own row, never beside the score", () => {
    const lines = cardMetadataLines({
      genreName: "Drama",
      year: "2024",
      ratings: [{ id: "tmdb", value: 8.3 }],
    })
    expect(lines).toHaveLength(2)
    // Real bounded bands on both shapes (never a synthetic tall band that
    // hides the landscape single-row squeeze): the year is its own row.
    for (const shape of [
      { name: "poster" as const, w: STD_W, h: STD_H },
      { name: "landscape" as const, w: LAND_W, h: LAND_H },
    ]) {
      const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 4)!
      const band = cardMetadataBand(shape.w, shape.h, geo)!
      const meta = cardMetadataSvg(lines, band.w, band.h, cardMetadataFontSize(shape.w))!
      expect(meta).not.toBeNull()
      expect(meta.cols).toBe(1)
      expect(meta.rows).toBe(2)
    }
  })

  it("known scales are bounded: decimal 0<v<=10, percent 0<v<=100, excluded never clamped", () => {
    expect(normalizeCardRatingToTen({ value: 99 })).toBeNull()
    expect(normalizeCardRatingToTen({ value: 10.5 })).toBeNull()
    expect(normalizeCardRatingToTen({ value: 10.5, format: "decimal" })).toBeNull()
    expect(normalizeCardRatingToTen({ value: 120, format: "percent" })).toBeNull()
    expect(normalizeCardRatingToTen({ value: 101, format: "percent" })).toBeNull()
    // Boundary values still contribute (not clamped, not shifted).
    expect(normalizeCardRatingToTen({ value: 10 })).toBe(10)
    expect(normalizeCardRatingToTen({ value: 10, format: "decimal" })).toBe(10)
    expect(normalizeCardRatingToTen({ value: 100, format: "percent" })).toBe(10)
    expect(normalizeCardRatingToTen({ value: 87, format: "percent" })).toBeCloseTo(8.7, 10)
    // An out-of-scale value never reaches the aggregate: genre-only line.
    expect(
      cardMetadataLines({ genreName: "Drama", ratings: [{ id: "x", value: 99 }] }).map((l) => l.text),
    ).toEqual(["DRAMA"])
    expect(
      cardMetadataLines({ genreName: "Drama", ratings: [{ id: "x", value: 120, format: "percent" }] }).map(
        (l) => l.text,
      ),
    ).toEqual(["DRAMA"])
  })
})

/**
 * P14 title/provider enlargement (measured final pixels, all 3 skins x both
 * shapes): the title mark is bottom-CENTERED on its real ink (transparent
 * bitmap padding ignored) with the bottom visual padding on the ink bottom,
 * and both marks render visibly larger than the small baseline while the
 * user scales move real pixels (never one permanent cap).
 */
describe("card title/provider enlargement (P14, measured final pixels)", () => {
  const P14_TITLE = { r: 196, g: 40, b: 64 }
  const P14_PROVIDER = { r: 36, g: 120, b: 200 }

  function near(
    r: number,
    g: number,
    b: number,
    fill: { r: number; g: number; b: number },
    tol = 8,
  ): boolean {
    return Math.abs(r - fill.r) <= tol && Math.abs(g - fill.g) <= tol && Math.abs(b - fill.b) <= tol
  }

  async function colorBounds(
    png: Buffer,
    fill: { r: number; g: number; b: number },
  ): Promise<{ count: number; minX: number; maxX: number; minY: number; maxY: number } | null> {    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let count = 0
    let minX = info.width
    let maxX = -1
    let minY = info.height
    let maxY = -1
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const o = (y * info.width + x) * 4
        if (near(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, fill)) {
          count++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (count === 0) return null
    return { count, minX, maxX, minY, maxY }
  }

  async function colorInRect(
    png: Buffer,
    fill: { r: number; g: number; b: number },
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<number> {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let count = 0
    const x1 = Math.min(info.width, rect.x + rect.w)
    const y1 = Math.min(info.height, rect.y + rect.h)
    for (let y = Math.max(0, rect.y); y < y1; y++) {
      for (let x = Math.max(0, rect.x); x < x1; x++) {
        const o = (y * info.width + x) * 4
        if (near(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0, fill)) count++
      }
    }
    return count
  }
  async function paddedTitleLogo(): Promise<Buffer> {
    // 300x120 bitmap with a 40px transparent border: 220x40 visible ink.
    // Proves the placement centers the INK, not the bitmap box.
    const ink = await solidPng(220, 40, P14_TITLE)
    return sharp({
      create: { width: 300, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: ink, left: 40, top: 40 }])
      .png()
      .toBuffer()
  }

  function titleInput(
    skin: CardSkin,
    shape: "poster" | "landscape",
    c: NonNullable<typeof cache>,
    titleLogo: Buffer | null,
    logoScale?: number | null,
  ): CardLayoutInput {
    return {
      skin,
      shape,
      width: shape === "poster" ? STD_W : LAND_W,
      height: shape === "poster" ? STD_H : LAND_H,
      artwork: shape === "poster" ? c.artworkPoster : c.artworkLandscape,
      displayedRank: null,
      titleLogo,
      providerLogo: null,
      brandAccent: "#E50914",
      genreName: null,
      year: null,
      ratings: null,
      logoScale,
    }
  }

  it("title ink is bottom-centered with real bottom padding (transparent padding ignored)", async () => {
    const c = await inputs()
    const padded = await paddedTitleLogo()
    for (const skin of SKINS) {
      for (const shape of SHAPES) {
        const png = await renderCardPoster(titleInput(skin, shape.name, c, padded, 100))
        const ink = await colorBounds(png, P14_TITLE)
        expect(ink).not.toBeNull()
        const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, null)!
        const cardCx = geo.card.x + geo.card.width / 2
        const cardBottom = geo.card.y + geo.card.height
        const inkCx = (ink!.minX + ink!.maxX + 1) / 2
        // Ink (not the padded bitmap) centers on the card center…
        expect(Math.abs(inkCx - cardCx)).toBeLessThanOrEqual(3)
        // …with the bottom visual padding applied to the ink bottom…
        expect(Math.abs(ink!.maxY + 1 - (cardBottom - geo.titleLogo.insetBottom))).toBeLessThanOrEqual(3)
        // …fully inside the card (never over the rank gutter)…
        expect(ink!.minX).toBeGreaterThanOrEqual(geo.card.x)
        expect(ink!.maxX).toBeLessThan(geo.card.x + geo.card.width)
        expect(ink!.minY).toBeGreaterThanOrEqual(geo.card.y)
        expect(ink!.maxY).toBeLessThan(cardBottom)
        // …and visibly larger than the small baseline: at scale 100 the
        // portrait STD ink is ~201px wide (baseline same-input: 128px).
        const inkW = ink!.maxX - ink!.minX + 1
        if (shape.name === "poster") {
          expect(inkW).toBeGreaterThan(150)
          expect(inkW).toBeLessThanOrEqual(geo.titleLogo.maxWidth)
        } else {
          // Landscape slot fits the bitmap uncropped (shrink-only, no
          // enlarge): the full 220px ink renders complete.
          expect(inkW).toBeGreaterThanOrEqual(214)
          expect(inkW).toBeLessThanOrEqual(226)
        }
      }
    }
  }, 120000)

  it("title scale levels render different sizes; transparent logos are omitted", async () => {
    const c = await inputs()
    const big = await solidPng(600, 240, P14_TITLE)
    const widths: number[] = []
    for (const scale of [50, 75, 100]) {
      const png = await renderCardPoster(titleInput("provider-glass", "poster", c, big, scale))
      expect((await sharp(png).metadata()).width).toBe(STD_W)
      const ink = await colorBounds(png, P14_TITLE)
      expect(ink).not.toBeNull()
      widths.push(ink!.maxX - ink!.minX + 1)
    }
    // Portrait STD slots at 50/75/100: 137/206/274 — strictly growing with
    // real gaps (never one permanent cap making levels identical).
    expect(widths[1]! - widths[0]!).toBeGreaterThan(20)
    expect(widths[2]! - widths[1]!).toBeGreaterThan(20)
    expect(widths[0]).toBeGreaterThan(100)
    expect(widths[2]).toBeGreaterThan(240)
    // A fully transparent bitmap carries no ink: omitted, byte-identical to
    // the missing-logo render (never whitespace-as-logo).
    const clear = await sharp({
      create: { width: 60, height: 30, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    const withClear = await renderCardPoster(titleInput("nuvio", "poster", c, clear, 100))
    const without = await renderCardPoster(titleInput("nuvio", "poster", c, null, 100))
    expect(Buffer.compare(withClear, without)).toBe(0)
  }, 120000)

  it("provider mark fills the enlarged left-column slot, scales move it, no overlap", async () => {
    const c = await inputs()
    // Small mark (60x30): shrink-only would pin it at 60px; the bounded
    // upscale fills the enlarged slot instead.
    const small = await solidPng(60, 30, P14_PROVIDER)
    for (const skin of SKINS) {
      for (const shape of SHAPES) {
        const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 7)!
        const cardBottom = geo.card.y + geo.card.height
        const mk = (providerScale: number | null) =>
          renderCardPoster({
            skin,
            shape: shape.name,
            width: shape.w,
            height: shape.h,
            artwork: shape.name === "poster" ? c.artworkPoster : c.artworkLandscape,
            displayedRank: 7,
            titleLogo: null,
            providerLogo: small,
            brandAccent: "#E50914",
            genreName: null,
            year: null,
            ratings: null,
            providerScale,
          })
        // P17 placement contract, shared by both scales below: the real ink
        // lands exactly at the helper origin (final-pixel proof — the solid
        // logo box IS the fitted box, so ink min/max are the placed box),
        // clears the decorative frame wherever the full P14 size allows it,
        // and never crosses the card edge while sharing the card's vertical
        // span (it may use the strictly below-card zone instead).
        const expectPlaced = async (
          ink: { minX: number; maxX: number; minY: number; maxY: number },
        ): Promise<void> => {
          const w = ink.maxX - ink.minX + 1
          const h = ink.maxY - ink.minY + 1
          const sharesCardSpan = ink.minY < cardBottom
          const rightLimit = sharesCardSpan ? geo.card.x : shape.w
          expect(ink.minX).toBe(
            placeCardProviderMark(geo.provider.centerX, w, shape.w, shape.h, skin, geo.card.x, ink.minY, cardBottom),
          )
          const need = cardProviderMinLeft(shape.w, shape.h, skin)
          if (need + w <= rightLimit) {
            expect(ink.minX).toBeGreaterThanOrEqual(need)
          } else {
            // Documented infeasible corner (landscape slot-filling marks at
            // 150%+: frame clearance and the card edge cannot both hold at
            // the full P14 size): the art cap wins, the size is preserved
            // (never shrunk back).
            expect(ink.maxX).toBeLessThanOrEqual(geo.card.x)
          }
          expect(ink.maxX).toBeLessThan(rightLimit)
          expect(ink.minX).toBeGreaterThanOrEqual(0)
          expect(ink.minY).toBeGreaterThanOrEqual(0)
          expect(ink.maxY).toBeLessThan(shape.h)
          expect(h).toBeGreaterThan(0)
        }
        const at100 = await colorBounds(await mk(100), P14_PROVIDER)
        expect(at100).not.toBeNull()
        // Upscale proof: wider than the 60px source, capped by the slot.
        expect(at100!.maxX - at100!.minX + 1).toBeGreaterThan(85)
        expect(at100!.maxX - at100!.minX + 1).toBeLessThanOrEqual(geo.provider.maxWidth + 2)
        await expectPlaced(at100!)
        // …and zero pixels spill onto the artwork card (true no-overlap
        // proof, robust to rounding edge-touches at extreme scales).
        const png100 = await mk(100)
        expect(
          await colorInRect(png100, P14_PROVIDER, {
            x: geo.card.x,
            y: geo.card.y,
            w: geo.card.width,
            h: geo.card.height,
          }),
        ).toBe(0)
        // Netscale moves real pixels: 200 fills the gutter and paints
        // strictly more ink than 100 (capped at the left column while
        // sharing the card's span, never through art).
        const png200 = await mk(200)
        const at200 = await colorBounds(png200, P14_PROVIDER)
        expect(at200).not.toBeNull()
        const w200 = at200!.maxX - at200!.minX + 1
        const w100 = at100!.maxX - at100!.minX + 1
        expect(w200).toBeGreaterThan(w100)
        expect(w200).toBeGreaterThanOrEqual(geo.rankSlotWidth - 2)
        expect(at200!.count).toBeGreaterThan(Math.round(at100!.count * 1.1))
        await expectPlaced(at200!)
        expect(at200!.maxY).toBeLessThan(shape.h)
        expect(
          await colorInRect(png200, P14_PROVIDER, {
            x: geo.card.x,
            y: geo.card.y,
            w: geo.card.width,
            h: geo.card.height,
          }),
        ).toBe(0)
      }
    }
  }, 180000)

  it("provider mark clears the frame at 150, holds size, and never depends on the badge", async () => {
    const c = await inputs()
    const small = await solidPng(60, 30, P14_PROVIDER)
    for (const skin of SKINS) {
      for (const shape of SHAPES) {
        const geo = cardLayoutGeometry(shape.name, shape.w, shape.h, 7)!
        const cardBottom = geo.card.y + geo.card.height
        const render = (over: Partial<CardLayoutInput>) =>
          renderCardPoster({
            skin,
            shape: shape.name,
            width: shape.w,
            height: shape.h,
            artwork: shape.name === "poster" ? c.artworkPoster : c.artworkLandscape,
            displayedRank: 7,
            titleLogo: null,
            providerLogo: small,
            brandAccent: "#E50914",
            genreName: null,
            year: null,
            ratings: null,
            providerScale: 150,
            ...over,
          })
        const ink = await colorBounds(await render({}), P14_PROVIDER)
        expect(ink).not.toBeNull()
        // Same P17 contract at the middle scale: full P14 size (strictly
        // between the 100 and 200 widths), frame-clear where feasible,
        // art-safe everywhere.
        const w = ink!.maxX - ink!.minX + 1
        const at100 = await colorBounds(
          await render({ providerScale: 100 }),
          P14_PROVIDER,
        )
        const at200 = await colorBounds(
          await render({ providerScale: 200 }),
          P14_PROVIDER,
        )
        expect(w).toBeGreaterThan(at100!.maxX - at100!.minX + 1)
        expect(w).toBeLessThanOrEqual(at200!.maxX - at200!.minX + 1)
        expect(ink!.minX).toBe(
          placeCardProviderMark(geo.provider.centerX, w, shape.w, shape.h, skin, geo.card.x, ink!.minY, cardBottom),
        )
        const need = cardProviderMinLeft(shape.w, shape.h, skin)
        const sharesCardSpan = ink!.minY < cardBottom
        const rightLimit = sharesCardSpan ? geo.card.x : shape.w
        if (need + w <= rightLimit) {
          expect(ink!.minX).toBeGreaterThanOrEqual(need)
        } else {
          expect(ink!.maxX).toBeLessThanOrEqual(geo.card.x)
        }
        // Badge independence: genre + aggregate + year move no provider
        // pixel (the mark origin never depends on badge state — no jump).
        const withBadge = await colorBounds(
          await render({
            genreName: "Drama",
            year: "2024",
            ratings: [
              { id: "imdb", value: 7.3 },
              { id: "tmdb", value: 8.1 },
            ],
          }),
          P14_PROVIDER,
        )
        expect(withBadge).toEqual(ink)
        // Missing provider logo omits the mark entirely (never an error,
        // never a phantom): exact dims, zero provider-color pixels.
        const missing = await render({ providerLogo: null })
        expect((await sharp(missing).metadata()).width).toBe(shape.w)
        expect(await colorBounds(missing, P14_PROVIDER)).toBeNull()
      }
    }
  }, 240000)
})
