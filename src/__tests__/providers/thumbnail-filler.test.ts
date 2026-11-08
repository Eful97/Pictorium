// @vitest-environment node
/**
 * Anime filler classification banner (`?fill=manga|anime|filler|mixed`).
 *
 * The banner must:
 * - be a local top-left corner chip built on the shared SVG primitives (no
 *   second renderer);
 * - appear ONLY when a classification travels on the URL: absent/unknown keeps
 *   the historical bytes exactly;
 * - shift a top-LEFT anchored badge stack below the chip while the other
 *   corners keep their historical placement (a top-right stack moves only on a
 *   proven overlap);
 * - carry the localized label passed by the caller and be scoped in the cache
 *   identity by BOTH status and label locale.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import {
  DEFAULT_THUMBNAIL_FILLER_STYLE,
  parseThumbnailFillerStatus,
  parseThumbnailFillerStyle,
  renderEpisodeThumbnail,
  thumbnailCacheKey,
  thumbnailFillerBannerHeight,
  THUMBNAIL_FILLER_STATUSES,
  THUMBNAIL_FILLER_STYLES,
} from "@/lib/thumbnail-renderer"

const STILL = "/filler-still.jpg"
/** Bright, uniform still: the dark corner chip ink is unambiguous on it. */
let brightStill: Buffer

beforeAll(async () => {
  brightStill = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 240, g: 240, b: 240 } },
  }).png().toBuffer()
})

function mockStill(buffer: Buffer = brightStill) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url,
    )
    if (url.includes("image.tmdb.org")) {
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    }
    return Response.json({})
  })
}

beforeEach(() => {
  mockStill()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function voteOnly(overrides: Partial<Parameters<typeof renderEpisodeThumbnail>[0]> = {}) {
  return renderEpisodeThumbnail({
    still: STILL,
    width: 320,
    badgeMode: "vote",
    voteAverage: 8.2,
    customRatings: [],
    blur: false,
    ...overrides,
  })
}

interface Bbox {
  left: number
  top: number
  right: number
  bottom: number
}

/** Bounding box of pixels clearly darker than the bright fixture. */
async function darkBbox(png: Buffer, threshold = 120): Promise<Bbox | null> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = -1
  let bottom = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      if (lum >= threshold) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return right < 0 ? null : { left, top, right, bottom }
}

async function meanLuminance(png: Buffer, y0: number, y1: number): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  let n = 0
  for (let y = y0; y < Math.min(y1, info.height); y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      n++
    }
  }
  return n > 0 ? sum / n : 0
}

async function pixelAt(png: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] }
}

/** Corner chip inset from the canvas edge (runtime value mirrored by the test). */
const CHIP_MARGIN = 10
/** Pixel inside the chip's left padding, clear of the centered label ink. */
const CHIP_PIXEL_X = 13

/** Vertical centre of the chip on a given canvas width. */
function chipCenterY(width = 320): number {
  return CHIP_MARGIN + thumbnailFillerBannerHeight(width) / 2
}

/** First row with clearly dark ink inside an x range (top of an anchored pill). */
async function firstDarkRowInRange(png: Buffer, x0: number, x1: number, threshold = 120): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  for (let y = 0; y < info.height; y++) {
    for (let x = Math.max(0, x0); x < Math.min(x1, info.width); x++) {
      const i = (y * info.width + x) * info.channels
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      if (lum < threshold) return y
    }
  }
  return -1
}

describe("filler status parsing", () => {
  it("accepts the four canonical codes, case-insensitively, plus the canon alias", () => {
    expect(THUMBNAIL_FILLER_STATUSES).toEqual(["manga", "anime", "filler", "mixed"])
    expect(parseThumbnailFillerStatus("manga")).toBe("manga")
    expect(parseThumbnailFillerStatus("ANIME")).toBe("anime")
    expect(parseThumbnailFillerStatus("FILLER")).toBe("filler")
    expect(parseThumbnailFillerStatus(" Mixed ")).toBe("mixed")
    // Legacy v1 code: accepted as an alias and normalized before the cache key.
    expect(parseThumbnailFillerStatus("canon")).toBe("manga")
    expect(parseThumbnailFillerStatus(" CANON ")).toBe("manga")
  })

  it("treats absent, blank and unknown values as no chip", () => {
    // The route distinguishes absent from invalid through the raw parameter;
    // the parser itself never guesses a status.
    expect(parseThumbnailFillerStatus(null)).toBeNull()
    expect(parseThumbnailFillerStatus(undefined)).toBeNull()
    expect(parseThumbnailFillerStatus("")).toBeNull()
    expect(parseThumbnailFillerStatus("   ")).toBeNull()
    expect(parseThumbnailFillerStatus("canonical")).toBeNull()
    expect(parseThumbnailFillerStatus("original")).toBeNull()
  })

  it("scales the corner chip height with the canvas (24px on the 320 reference)", () => {
    expect(thumbnailFillerBannerHeight(320)).toBe(24)
    expect(thumbnailFillerBannerHeight(160)).toBe(12)
    expect(thumbnailFillerBannerHeight(640)).toBe(48)
    expect(thumbnailFillerBannerHeight(1280)).toBe(96)
  })

  it("parses the two banner layouts, defaulting to the corner chip", () => {
    expect(THUMBNAIL_FILLER_STYLES).toEqual(["corner", "strip"])
    expect(DEFAULT_THUMBNAIL_FILLER_STYLE).toBe("corner")
    expect(parseThumbnailFillerStyle("corner")).toBe("corner")
    expect(parseThumbnailFillerStyle(" STRIP ")).toBe("strip")
    expect(parseThumbnailFillerStyle("ribbon")).toBeNull()
    expect(parseThumbnailFillerStyle(null)).toBeNull()
    expect(parseThumbnailFillerStyle("")).toBeNull()
  })
})

describe("filler banner cache identity", () => {
  const base = {
    seriesId: 123,
    seasonNumber: 1,
    episodeNumber: 2,
    still: STILL,
    width: 320 as const,
    badges: "vote" as const,
    languages: "en,null",
    blur: false,
    voteSource: "imdb" as const,
  }

  it("keeps the historical key when no banner is drawn", () => {
    const legacy = thumbnailCacheKey(base)
    expect(thumbnailCacheKey({ ...base, filler: undefined })).toBe(legacy)
    expect(legacy).not.toContain(":fl")
  })

  it("scopes status AND label locale, so locales never share an entry", () => {
    const mangaIt = thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "it" })
    expect(mangaIt).toContain(":flmanga:flnit")
    expect(mangaIt).not.toBe(thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "en" }))
    expect(mangaIt).not.toBe(thumbnailCacheKey({ ...base, filler: "anime", fillerLang: "it" }))
    expect(mangaIt).not.toBe(thumbnailCacheKey({ ...base, filler: "filler", fillerLang: "it" }))
    expect(mangaIt).not.toBe(thumbnailCacheKey({ ...base, filler: "mixed", fillerLang: "it" }))
    // Legacy `canon` alias normalizes to manga BEFORE the key: one entry, no
    // duplicate cache and no stale `:flcanon` reuse.
    const alias = parseThumbnailFillerStatus("canon")!
    expect(thumbnailCacheKey({ ...base, filler: alias, fillerLang: "it" })).toBe(mangaIt)
    expect(thumbnailCacheKey({ ...base, filler: "anime", fillerLang: "it" })).toContain(":flanime")
    // Absent locale collapses to `en`: no unbounded client strings in the key.
    expect(thumbnailCacheKey({ ...base, filler: "manga", fillerLang: undefined })).toBe(
      thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "en" }),
    )
    expect(thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "not a tag!" })).toBe(
      thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "en" }),
    )
  })

  it("scopes the layout for BOTH layouts so stale pre-layout entries are never reused", () => {
    const legacy = thumbnailCacheKey(base)
    const corner = thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "it", fillerStyle: "corner" })
    const absentStyle = thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "it" })
    const strip = thumbnailCacheKey({ ...base, filler: "manga", fillerLang: "it", fillerStyle: "strip" })

    // Absent style resolves to corner, so the two are the same representation.
    expect(corner).toBe(absentStyle)
    // Corner is explicit in the key: entries cached before the layout was part
    // of the identity (old strip PNGs) are unreachable and re-render correctly.
    expect(corner).toContain(":flscorner")
    expect(corner).not.toMatch(/:flnit$/)
    // A strip is a different image and can never reuse the chip entry.
    expect(strip).not.toBe(corner)
    expect(strip).toContain(":flsstrip")
    // Layout is meaningless without a classification.
    expect(thumbnailCacheKey({ ...base, fillerStyle: "strip" })).toBe(legacy)
  })
})

describe("filler banner render", () => {
  it("draws no banner and no filler flag when the classification is absent", async () => {
    const plain = await voteOnly()
    const explicitNull = await voteOnly({ filler: null })
    expect(plain.png.equals(explicitNull.png)).toBe(true)
    // Additive flag: absent from `rendered` for every no-banner render, so the
    // historical `{vote, custom}` shape is untouched.
    expect("filler" in plain.rendered).toBe(false)
    expect("filler" in explicitNull.rendered).toBe(false)
  })

  it("draws a flat corner chip on fill=manga (bytes differ, accent plate visible)", async () => {
    const plain = await voteOnly()
    const banner = await voteOnly({ filler: "manga", fillerLabel: "Canonico" })
    expect(banner.png.equals(plain.png)).toBe(false)
    expect(banner.rendered.filler).toBe(true)

    // Status accent of the flat plate at the top-left corner (green = manga
    // canon, the same hex as the historical `canon` code), where the
    // historical render is still the bright artwork.
    const accent = await pixelAt(banner.png, CHIP_PIXEL_X, chipCenterY())
    expect(accent.g).toBeGreaterThan(accent.r)
    expect(accent.g).toBeGreaterThan(accent.b)
    const plainPixel = await pixelAt(plain.png, CHIP_PIXEL_X, chipCenterY())
    expect(plainPixel.r).toBeGreaterThan(200)
    expect(plainPixel.g).toBeGreaterThan(200)
    expect(plainPixel.b).toBeGreaterThan(200)

    // The chip is local: the opposite top corner and the lower canvas stay the
    // untouched artwork (it never becomes a full-width strip).
    const topRight = await pixelAt(banner.png, 316, 4)
    expect(topRight.r).toBeGreaterThan(200)
    expect(topRight.g).toBeGreaterThan(200)
    expect(topRight.b).toBeGreaterThan(200)
    expect(await meanLuminance(banner.png, 150, 170)).toBeGreaterThan(200)
  })

  it("uses the accent colour of the status (anime violet, filler amber, mixed sky)", async () => {
    const anime = await voteOnly({ filler: "anime", fillerLabel: "Anime Canon" })
    const animeAccent = await pixelAt(anime.png, CHIP_PIXEL_X, chipCenterY())
    // Violet #A78BFA: red over green (distinguishes it from the sky mixed
    // plate, where green dominates red) and blue over green.
    expect(animeAccent.r).toBeGreaterThan(animeAccent.g)
    expect(animeAccent.b).toBeGreaterThan(animeAccent.g)

    const filler = await voteOnly({ filler: "filler", fillerLabel: "Filler" })
    const fillerAccent = await pixelAt(filler.png, CHIP_PIXEL_X, chipCenterY())
    // Amber #F59E0B: red channel dominant over blue.
    expect(fillerAccent.r).toBeGreaterThan(fillerAccent.b)

    const mixed = await voteOnly({ filler: "mixed", fillerLabel: "Misto" })
    const mixedAccent = await pixelAt(mixed.png, CHIP_PIXEL_X, chipCenterY())
    // Sky #38BDF8: green dominates red (the opposite of violet), blue over red.
    expect(mixedAccent.g).toBeGreaterThan(mixedAccent.r)
    expect(mixedAccent.b).toBeGreaterThan(mixedAccent.r)
  })

  it("renders the caller's localized label and falls back to the built-in English one", async () => {
    // Different labels are different bytes: the text really reaches the chip.
    const italian = await voteOnly({ filler: "mixed", fillerLabel: "Misto" })
    const english = await voteOnly({ filler: "mixed", fillerLabel: "Mixed" })
    expect(italian.png.equals(english.png)).toBe(false)

    // No label supplied: the built-in English label is used (never a blank or
    // raw-key chip), so this equals the explicit English label render.
    const fallback = await voteOnly({ filler: "mixed" })
    expect(fallback.png.equals(english.png)).toBe(true)
  })

  it("shifts only a top-left stack below the chip (other anchors unchanged)", async () => {
    const chipH = thumbnailFillerBannerHeight(320)
    const gap = 6

    // top-left: the chip occupies that corner, so the stack moves one chip +
    // gap lower (the pill bottom proves the whole body moved).
    const tlPlain = await darkBbox((await voteOnly({ anchor: "tl" })).png)
    const tlBanner = await darkBbox(
      (await voteOnly({ anchor: "tl", filler: "manga", fillerLabel: "Canonico" })).png,
    )
    expect(tlPlain).not.toBeNull()
    expect(tlBanner).not.toBeNull()
    expect(tlBanner!.bottom - tlPlain!.bottom).toBeGreaterThanOrEqual(chipH + gap - 1)
    expect(tlBanner!.bottom - tlPlain!.bottom).toBeLessThanOrEqual(chipH + gap + 1)

    // top-right: no overlap with the corner chip, so the pill never moves
    // (scan the right half only, away from the chip ink).
    const rightStart = Math.floor(320 * 0.6)
    const trPlainTop = await firstDarkRowInRange((await voteOnly({ anchor: "tr" })).png, rightStart, 320)
    const trBannerTop = await firstDarkRowInRange(
      (await voteOnly({ anchor: "tr", filler: "manga", fillerLabel: "Canonico" })).png,
      rightStart,
      320,
    )
    expect(trBannerTop).toBe(trPlainTop)

    // bottom-left / bottom-right: the stack never moves (the chip is top-left).
    for (const anchor of ["bl", "br"] as const) {
      const plain = await darkBbox((await voteOnly({ anchor })).png)
      const banner = await darkBbox(
        (await voteOnly({ anchor, filler: "manga", fillerLabel: "Canonico" })).png,
      )
      expect(plain).not.toBeNull()
      expect(banner).not.toBeNull()
      expect(banner!.bottom).toBe(plain!.bottom)
    }
  })

  it("renders the chip even without any rating pill", async () => {
    const png = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      voteAverage: 0,
      customRatings: [],
      blur: false,
      filler: "filler",
      fillerLabel: "Filler",
    })
    expect(png.rendered.filler).toBe(true)
    const accent = await pixelAt(png.png, CHIP_PIXEL_X, chipCenterY())
    expect(accent.r).toBeGreaterThan(accent.b)
  })

  it("keeps the canvas size of every allowlisted width with the chip present", async () => {
    for (const width of [160, 320, 640] as const) {
      const result = await renderEpisodeThumbnail({
        still: STILL,
        width,
        badgeMode: "vote",
        voteAverage: 8.2,
        customRatings: [],
        blur: false,
        filler: "mixed",
        fillerLabel: "Misto",
      })
      expect(result.w).toBe(width)
      expect(result.h).toBe(Math.round((width * 9) / 16))
      const meta = await sharp(result.png).metadata()
      expect(meta.width).toBe(width)
      expect(meta.height).toBe(Math.round((width * 9) / 16))
      // The chip plate is still the status accent at every width.
      const accent = await pixelAt(result.png, CHIP_PIXEL_X, chipCenterY(width))
      expect(accent.b).toBeGreaterThan(accent.r)    }
  })

  it("renders the strip layout full-width on the top edge (distinct bytes)", async () => {
    const plain = await voteOnly()
    const corner = await voteOnly({ filler: "manga", fillerLabel: "Canonico" })
    const strip = await voteOnly({ filler: "manga", fillerLabel: "Canonico", fillerStyle: "strip" })

    // Default/absent style is exactly the historical corner chip.
    expect(corner.png.equals(plain.png)).toBe(false)
    expect(strip.png.equals(corner.png)).toBe(false)
    expect(strip.rendered.filler).toBe(true)

    // The strip paints the whole top edge: the top-right corner is the status
    // accent, where the chip leaves the still untouched.
    const stripTopRight = await pixelAt(strip.png, 316, 4)
    expect(stripTopRight.g).toBeGreaterThan(stripTopRight.r)
    expect(stripTopRight.g).toBeGreaterThan(stripTopRight.b)
    const cornerTopRight = await pixelAt(corner.png, 316, 4)
    expect(cornerTopRight.r).toBeGreaterThan(200)
    expect(cornerTopRight.g).toBeGreaterThan(200)
    expect(cornerTopRight.b).toBeGreaterThan(200)

    // Explicit corner renders the exact same bytes as the absent style.
    const explicitCorner = await voteOnly({
      filler: "manga",
      fillerLabel: "Canonico",
      fillerStyle: "corner",
    })
    expect(explicitCorner.png.equals(corner.png)).toBe(true)
  })

  it("shifts both top anchors below the strip (bottom anchors unchanged)", async () => {
    const stripH = thumbnailFillerBannerHeight(320)
    const gap = 6

    // Top-right: the pill body moves down by exactly the strip height + gap.
    // Use the whole bounding box (the strip's 1px bottom rule is not ink from
    // the badge and never wins the bottom edge).
    const trPlain = await darkBbox((await voteOnly({ anchor: "tr" })).png)
    const trStrip = await darkBbox(
      (await voteOnly({ anchor: "tr", filler: "manga", fillerLabel: "Canonico", fillerStyle: "strip" })).png,
    )
    expect(trPlain).not.toBeNull()
    expect(trStrip).not.toBeNull()
    expect(trStrip!.bottom - trPlain!.bottom).toBeGreaterThanOrEqual(stripH + gap - 1)
    expect(trStrip!.bottom - trPlain!.bottom).toBeLessThanOrEqual(stripH + gap + 1)

    // Bottom-anchored stacks never move: the strip only occupies the top edge.
    for (const anchor of ["bl", "br"] as const) {
      const plain = await darkBbox((await voteOnly({ anchor })).png)
      const banner = await darkBbox(
        (await voteOnly({ anchor, filler: "manga", fillerLabel: "Canonico", fillerStyle: "strip" })).png,
      )
      expect(plain).not.toBeNull()
      expect(banner).not.toBeNull()
      expect(banner!.bottom).toBe(plain!.bottom)
    }
  })
})
