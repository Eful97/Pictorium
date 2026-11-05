// @vitest-environment node
/**
 * Thumbnail `bstyle=naked` — brand mark + WHITE score, no pill container.
 *
 * The naked badge must:
 * - draw the vote source's own mark (IMDb/TMDB) + score with NO pill/band and
 *   no second implementation (same brand assets/font as the shared renderers);
 * - render the score in WHITE with a soft dark halo/scrim, so it stays readable
 *   on a light still (bright text ink + dark halo are measured on pixels);
 * - fall back to the neutral pill when the brand asset is missing (fail-open,
 *   never a 500/empty badge);
 * - be part of the cache identity (`bsnaked`) and carried by the settings
 *   preview, while the default stays `pill`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import {
  parseThumbnailBadgeStyle,
  renderEpisodeThumbnail,
  thumbnailCacheKey,
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
    // Naked must NOT reach the pill-oriented bottom renderer any more.
    renderSeparateRatingsBottom: vi.fn(actual.renderSeparateRatingsBottom),
    // The brand asset loader is the shared one (same logo the branded paths
    // use); spying lets us prove the source choice and simulate a missing file.
    loadSeparateRatingLogo: vi.fn(actual.loadSeparateRatingLogo),
  }
})

const STILL = "/naked-still.jpg"
const VOTE = 8.4
const DEMO_TV = { mediaType: "tv" as const, id: 1396, title: "Naked Demo" }

let stillBuffer: Buffer
let lightStillBuffer: Buffer

beforeAll(async () => {
  stillBuffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 30, g: 60, b: 90 } },
  }).png().toBuffer()
  // Light fixture: white-ish still, the hardest case for white score ink.
  lightStillBuffer = await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 242, g: 242, b: 242 } },
  }).png().toBuffer()
})

function mockStill(buffer: Buffer = stillBuffer) {
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

function keyInput(badgeStyle?: "pill" | "naked") {
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

interface InkStats {
  readonly white: number
  readonly dark: number
}

/** Count near-white and dark pixels (luminance) in a raw PNG. */
async function inkStats(png: Buffer): Promise<InkStats> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let white = 0
  let dark = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (r >= 250 && g >= 250 && b >= 250) white++
    if (lum < 140) dark++
  }
  return { white, dark }
}

beforeEach(() => {
  vi.mocked(renderGenreBadge).mockClear()
  vi.mocked(renderSeparateRatingsBottom).mockClear()
  vi.mocked(loadSeparateRatingLogo).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("thumbnail naked badge", () => {
  it("draws the IMDb mark + white score with no pill", async () => {
    mockStill()

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "naked",
      voteSource: "imdb",
      voteAverage: VOTE,
      customRatings: [],
      blur: false,
    })

    // Same shared brand asset loader as the branded paths, no pill renderer.
    expect(loadSeparateRatingLogo).toHaveBeenCalledTimes(1)
    expect(vi.mocked(loadSeparateRatingLogo).mock.calls[0]?.[0]).toBe("imdb")
    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderGenreBadge).not.toHaveBeenCalled()
    expect(result.rendered).toEqual({ vote: true, custom: false })
    expect(result.w).toBe(320)
    expect(result.h).toBe(180)
  })

  it("chooses the TMDB mark when the vote source is TMDB", async () => {
    mockStill()

    await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "naked",
      voteSource: "tmdb",
      voteAverage: VOTE,
      customRatings: [],
      blur: false,
    })

    expect(vi.mocked(loadSeparateRatingLogo).mock.calls[0]?.[0]).toBe("tmdb")
    expect(renderSeparateRatingsBottom).not.toHaveBeenCalled()
    expect(renderGenreBadge).not.toHaveBeenCalled()
  })

  it("renders white score ink with a dark halo on a light still", async () => {
    mockStill(lightStillBuffer)

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "naked",
      // TMDB mark has no dark ink of its own: every dark pixel below can only
      // come from the score shadow/scrim, not from the logo.
      voteSource: "tmdb",
      voteAverage: VOTE,
      customRatings: [],
      blur: false,
    })

    expect(result.rendered.vote).toBe(true)
    const stats = await inkStats(result.png)
    // White score text survives on a 242-luminance background.
    expect(stats.white).toBeGreaterThan(10)
    // The soft dark halo/scrim provides the contrast (no pill rectangle).
    expect(stats.dark).toBeGreaterThan(100)
  })

  it("falls back to the neutral pill when the brand asset is missing", async () => {
    mockStill()
    // Missing logo asset = shared loader returns null (never a throw).
    vi.mocked(loadSeparateRatingLogo).mockResolvedValueOnce(null)

    const result = await renderEpisodeThumbnail({
      still: STILL,
      width: 320,
      badgeMode: "vote",
      badgeStyle: "naked",
      voteSource: "imdb",
      voteAverage: VOTE,
      customRatings: [],
      blur: false,
    })

    expect(renderGenreBadge).toHaveBeenCalledTimes(1)
    // Fail-open to the historical neutral pill, never a 500/empty badge.
    expect(vi.mocked(renderGenreBadge).mock.calls[0]?.[4]).toBe("pill")
    expect(result.rendered).toEqual({ vote: true, custom: false })
  })

  it("is part of the cache identity while the default remains pill", () => {
    expect(parseThumbnailBadgeStyle("naked")).toBe("naked")
    expect(parseThumbnailBadgeStyle(" NAKED ")).toBe("naked")
    expect(parseThumbnailBadgeStyle(null)).toBe("pill")

    const naked = thumbnailCacheKey(keyInput("naked"))
    expect(naked).toContain(":bsnaked:")
    expect(naked).not.toBe(thumbnailCacheKey(keyInput("pill")))
    // Absent = pill (legacy key), explicit pill is the same identity.
    expect(thumbnailCacheKey(keyInput())).toBe(thumbnailCacheKey(keyInput("pill")))
  })

  it("is carried explicitly by the settings preview (WYSIWYG)", () => {
    const url = buildThumbnailPreviewUrl({
      demoMedia: DEMO_TV,
      still: STILL,
      badgeStyle: "naked",
      anchor: "tr",
      offsetX: 0,
      offsetY: 0,
      badgeScale: 100,
      voteSource: "imdb",
      showBadges: true,
      badgesEnabled: true,
    })
    expect(url).toContain("bstyle=naked")
  })
})
