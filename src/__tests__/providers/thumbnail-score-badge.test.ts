// @vitest-environment node
/**
 * Thumbnail `bstyle=score` — "Absolute Cinema" grid.
 *
 * The score tile must:
 * - fill a rounded rect with the vote bucket colour and draw the big score;
 * - draw NO provider logo (the source only selects which score feeds the
 *   bucket);
 * - pick white/black ink by luminance (measured WCAG contrast >= 4.5);
 * - map the intermediate tenths exactly (4.9 purple, 5.0 red, 9.6 dark green,
 *   9.7 blue);
 * - skip the badge entirely on a missing/zero vote (never a fake purple tile);
 * - be part of the cache identity (`bsscore`), carried by the preview builder,
 *   while the default remains `pill`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import {
  THUMBNAIL_SCORE_BUCKETS,
  parseThumbnailBadgeStyle,
  renderEpisodeThumbnail,
  thumbnailCacheKey,
  thumbnailScoreBucket,
  thumbnailScoreInk,
} from "@/lib/thumbnail-renderer"
import { renderGenreBadge } from "@/lib/svg-badge"
import { loadSeparateRatingLogo, renderSeparateRatingsBottom } from "@/lib/separate-rating-renderer"
import { buildThumbnailPreviewUrl } from "@/components/settings/thumbnail-preview"

vi.mock("@/lib/svg-badge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/svg-badge")>()
  return { ...actual, renderGenreBadge: vi.fn(actual.renderGenreBadge) }
})

vi.mock("@/lib/separate-rating-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/separate-rating-renderer")>()
  return {
    ...actual,
    renderSeparateRatingsBottom: vi.fn(actual.renderSeparateRatingsBottom),
    loadSeparateRatingLogo: vi.fn(actual.loadSeparateRatingLogo),
  }
})

const STILL = "/score-still.jpg"
const DEMO_TV = { mediaType: "tv" as const, id: 1396, title: "Score Demo" }

let darkStill: Buffer
let lightStill: Buffer

beforeAll(async () => {
  darkStill = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 20, g: 24, b: 32 } },
  }).png().toBuffer()
  // Light fixture: the tile must keep its edge/readability here too.
  lightStill = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 242, g: 242, b: 242 } },
  }).png().toBuffer()
})

function mockStill(buffer: Buffer = darkStill) {
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

function keyInput(badgeStyle?: "pill" | "naked" | "score") {
  return {
    seriesId: 123,
    seasonNumber: 1,
    episodeNumber: 2,
    still: STILL,
    width: 320 as const,
    badges: "vote" as const,
    badgeStyle,
    languages: "en,null",
    blur: false,
    voteSource: "imdb" as const,
  }
}

function srgbLuminance(hex: string): number {
  const channel = (offset: number): number => {
    const s = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
  const la = srgbLuminance(a)
  const lb = srgbLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

async function pixelAt(png: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const offset = (Math.round(y) * info.width + Math.round(x)) * info.channels
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2] }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

beforeEach(() => {
  vi.mocked(renderGenreBadge).mockClear()
  vi.mocked(renderSeparateRatingsBottom).mockClear()
  vi.mocked(loadSeparateRatingLogo).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("thumbnail score bucket map", () => {
  it("maps every tenth boundary and the intermediate values", () => {
    expect(thumbnailScoreBucket(4.9)?.id).toBe("garbage")
    expect(thumbnailScoreBucket(5.0)?.id).toBe("bad")
    expect(thumbnailScoreBucket(5.9)?.id).toBe("bad")
    expect(thumbnailScoreBucket(6.0)?.id).toBe("average")
    expect(thumbnailScoreBucket(7.0)?.id).toBe("good")
    expect(thumbnailScoreBucket(8.0)?.id).toBe("great")
    expect(thumbnailScoreBucket(9.0)?.id).toBe("awesome")
    expect(thumbnailScoreBucket(9.5)?.id).toBe("awesome")
    expect(thumbnailScoreBucket(9.6)?.id).toBe("awesome")
    expect(thumbnailScoreBucket(9.69)?.id).toBe("awesome")
    expect(thumbnailScoreBucket(9.7)?.id).toBe("absolute-cinema")
    expect(thumbnailScoreBucket(9.9)?.id).toBe("absolute-cinema")
    expect(thumbnailScoreBucket(10.0)?.id).toBe("absolute-cinema")
    // Above the documented scale the last bucket still applies.
    expect(thumbnailScoreBucket(10.2)?.id).toBe("absolute-cinema")
  })

  it("returns null for a missing/zero vote (never a fake purple tile)", () => {
    expect(thumbnailScoreBucket(0)).toBeNull()
    expect(thumbnailScoreBucket(-1)).toBeNull()
    expect(thumbnailScoreBucket(Number.NaN)).toBeNull()
    expect(thumbnailScoreBucket(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("picks readable white/black ink by luminance (WCAG >= 4.5)", () => {
    for (const bucket of THUMBNAIL_SCORE_BUCKETS) {
      expect(bucket.ink).toBe(thumbnailScoreInk(bucket.color))
      expect(contrast(bucket.ink, bucket.color)).toBeGreaterThanOrEqual(4.5)
    }
    // Explicit polarity spot-checks.
    expect(thumbnailScoreInk("#EAB308")).toBe("#111111")
    expect(thumbnailScoreInk("#2563EB")).toBe("#ffffff")
  })
})

describe("thumbnail score tile render", () => {
  it("draws the bucket colour + big score with no provider logo", async () => {
    mockStill()
    const bucket = thumbnailScoreBucket(8.4)!

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "score",
      voteSource: "imdb",
      voteAverage: 8.4,
      customRatings: [],
      blur: false,
    })

    expect(result.rendered).toEqual({ vote: true, custom: false })
    // No brand asset and no pill renderer: the source is only a data input.
    expect(loadSeparateRatingLogo).not.toHaveBeenCalled()
    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderGenreBadge).not.toHaveBeenCalled()

    // The tile body is the bucket fill (sample above the glyph, inside the
    // rect, away from the rounded corners).
    const { geometry } = result
    expect(geometry.w).toBeGreaterThan(20)
    expect(geometry.h).toBeGreaterThan(20)
    const sample = await pixelAt(
      result.png,
      geometry.left + geometry.w / 2,
      geometry.top + Math.max(4, Math.round(geometry.h * 0.16)),
    )
    const expected = hexToRgb(bucket.color)
    expect(Math.abs(sample.r - expected.r)).toBeLessThanOrEqual(4)
    expect(Math.abs(sample.g - expected.g)).toBeLessThanOrEqual(4)
    expect(Math.abs(sample.b - expected.b)).toBeLessThanOrEqual(4)
  })

  it("stays inside the client safe margins at every anchor", async () => {
    mockStill()
    for (const anchor of ["tl", "tr", "bl", "br"] as const) {
      const result = await renderEpisodeThumbnail({
        still: STILL,
        width: 320,
        badgeMode: "vote",
        badgeStyle: "score",
        anchor,
        voteAverage: 8.4,
        customRatings: [],
        blur: false,
      })
      expect(result.geometry.left).toBeGreaterThanOrEqual(25)
      expect(result.geometry.left + result.geometry.w).toBeLessThanOrEqual(295)
      expect(result.geometry.top).toBeGreaterThanOrEqual(11)
      expect(result.geometry.top + result.geometry.h).toBeLessThanOrEqual(169)
    }
  })

  it("keeps the tile readable on a light still (dark shadow, dedicated ink)", async () => {
    mockStill(lightStill)
    const bucket = thumbnailScoreBucket(9.9)!

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "score",
      voteSource: "tmdb",
      voteAverage: 9.9,
      customRatings: [],
      blur: false,
    })

    expect(result.rendered.vote).toBe(true)
    const { geometry } = result
    // Inside the tile the ink (white on the blue bucket) is present.
    const { data, info } = await sharp(result.png).raw().toBuffer({ resolveWithObject: true })
    let inkPixels = 0
    for (let y = Math.floor(geometry.top); y < Math.ceil(geometry.top + geometry.h); y++) {
      for (let x = Math.floor(geometry.left); x < Math.ceil(geometry.left + geometry.w); x++) {
        const i = (y * info.width + x) * info.channels
        if (data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250) inkPixels++
      }
    }
    expect(inkPixels).toBeGreaterThan(5)
    // The tile itself is the blue bucket (9.9), so it is visible on white.
    expect(bucket.ink).toBe("#ffffff")
  })

  it("skips the badge on a missing/zero vote (no fake colour, no pill fallback)", async () => {
    mockStill()

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "score",
      voteAverage: 0,
      customRatings: [],
      blur: false,
    })

    expect(result.rendered).toEqual({ vote: false, custom: false })
    expect(result.geometry).toEqual({ left: 0, top: 0, w: 0, h: 0 })
    expect(renderGenreBadge).not.toHaveBeenCalled()
    expect(loadSeparateRatingLogo).not.toHaveBeenCalled()
  })
})

describe("thumbnail score identity", () => {
  it("is part of the cache identity while the default remains pill", () => {
    expect(parseThumbnailBadgeStyle("score")).toBe("score")
    expect(parseThumbnailBadgeStyle(" SCORE ")).toBe("score")
    expect(parseThumbnailBadgeStyle(null)).toBe("pill")

    const score = thumbnailCacheKey(keyInput("score"))
    expect(score).toContain(":bsscore:")
    expect(score).not.toBe(thumbnailCacheKey(keyInput("pill")))
    expect(score).not.toBe(thumbnailCacheKey(keyInput("naked")))
    // Absent = pill (legacy key), explicit pill is the same identity.
    expect(thumbnailCacheKey(keyInput())).toBe(thumbnailCacheKey(keyInput("pill")))
  })

  it("is carried explicitly by the settings preview (WYSIWYG)", () => {
    const url = buildThumbnailPreviewUrl({
      demoMedia: DEMO_TV,
      still: STILL,
      badgeStyle: "score",
      anchor: "tr",
      offsetX: 0,
      offsetY: 0,
      badgeScale: 100,
      voteSource: "imdb",
      showBadges: true,
      badgesEnabled: true,
    })
    expect(url).toContain("bstyle=score")
  })
})
