// @vitest-environment node
/**
 * Notch filler banner on episode thumbnails (`fillStyle=notch`): the shared notch
 * contour (`notchPathD`, the same path as `buildNotchSvg`) hanging from the top
 * edge and centred horizontally. A top-anchored vote stack moves below it only
 * when their horizontal spans meet.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import { buildNotchSvg, genrePillHeight, notchPathD, TOP_SHADOW_PAD } from "@/lib/badge-svg-shared"
import {
  parseThumbnailFillerStyle,
  renderEpisodeThumbnail,
  thumbnailBadgeSafeMarginY,
  thumbnailCacheKey,
  thumbnailFillerBannerHeight,
  THUMBNAIL_FILLER_STYLES,
} from "@/lib/thumbnail-renderer"

const STILL = "/notch-still.jpg"
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

describe("notch thumbnail: parser and identity", () => {
  it("accepts fillStyle=notch", () => {
    expect(THUMBNAIL_FILLER_STYLES).toEqual(["corner", "strip", "notch"])
    expect(parseThumbnailFillerStyle(" NOTCH ")).toBe("notch")
    expect(parseThumbnailFillerStyle("notch-vetro")).toBeNull()
  })

  it("keys the notch filler apart from the corner chip", () => {
    const base = { seriesId: 1, seasonNumber: 1, episodeNumber: 1, still: STILL, width: 320 as const, badges: "vote" as const, languages: "en", blur: false }
    const corner = thumbnailCacheKey({ ...base, filler: "manga", fillerStyle: "corner" })
    const notch = thumbnailCacheKey({ ...base, filler: "manga", fillerStyle: "notch" })
    expect(notch).not.toBe(corner)
  })
})

describe("notch shape helper", () => {
  it("notchPathD reproduces the buildNotchSvg body path on both edges", () => {
    for (const edge of ["top", "bottom"] as const) {
      const { svg, w, h } = buildNotchSvg("Crime", "8.0", "2006", 28, "#e5303a", false, "vetro", edge)
      const d = svg.match(/<path d="([^"]+)"/)?.[1]
      const boxH = genrePillHeight(28)
      const fr = Math.round(boxH * 0.8)
      const boxW = w - fr * 2 - TOP_SHADOW_PAD * 2
      const x = TOP_SHADOW_PAD + fr
      expect(d).toBeDefined()
      expect(d).toBe(notchPathD({ x, boxW, boxH, fr, renderH: h, edge }))
    }
  })
})

describe("notch thumbnail: filler banner", () => {
  it("renders the centred notch banner (rendered.filler)", async () => {
    const r = await voteOnly({ badgeMode: "custom", customRatings: [], filler: "manga", fillerStyle: "notch", fillerLabel: "Manga Canon" })
    expect(r.rendered.filler).toBe(true)
  })

  it("moves a top-right stack below an overlapping notch filler by the notch height + gap", async () => {
    // A long label drives the notch to its width cap, so it spans the top-right stack.
    const r = await voteOnly({ badgeStyle: "pill", anchor: "tr", filler: "anime", fillerStyle: "notch", fillerLabel: "Anime canon extended label" })
    expect(r.rendered.filler).toBe(true)
    expect(r.geometry.top).toBe(thumbnailBadgeSafeMarginY(320) + thumbnailFillerBannerHeight(320) + 6)
  })

  it("leaves a top-right stack in place when the notch filler does not reach it", async () => {
    // Wide canvas, short label and a minimum-scale vote: the centred notch ends well left of the top-right stack.
    const r = await voteOnly({ width: 1280, badgeStyle: "pill", anchor: "tr", badgeScale: 10, filler: "mixed", fillerStyle: "notch", fillerLabel: "Mixed" })
    expect(r.rendered.filler).toBe(true)
    expect(r.geometry.top).toBe(thumbnailBadgeSafeMarginY(1280))
  })
})
