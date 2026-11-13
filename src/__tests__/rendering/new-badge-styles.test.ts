import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { BADGE_STYLES, RANKING_BADGE_STYLES, EXTRA_BADGE_STYLES, QUALITY_BADGE_STYLES, AGE_BADGE_STYLES, isBottomSeparateRatingsStyle, isSeparateRatingsStyle } from "@/lib/badge-styles"
import { genreBadgeConsumesAccent, topBadgeConsumesAccent } from "@/lib/badge-layout"
import { buildEditorialLabelSvg, buildEditorialMarkSvg, buildGenreEditorialSvg, buildGenreGradientBorderSvg, buildGenreSplitSvg, buildGenreTintSvg, buildHouseRankingSvg, buildHouseExtraSvg, mixHex } from "@/lib/badge-svg-shared"
import { renderSeparateRatingStack } from "@/lib/separate-rating-renderer"
import { insertFrostedGlassUnderlays, type PosterComposite } from "@/lib/poster-render-helpers"

const ACCENT = "#e5303a"

describe("new badge styles: enums and accent gating", () => {
  it("adds the new styles to their families", () => {
    for (const s of ["tinta", "sfumato", "split", "editoriale"]) expect(BADGE_STYLES as readonly string[]).toContain(s)
    for (const s of ["tinta", "sfumato"]) {
      expect(RANKING_BADGE_STYLES as readonly string[]).toContain(s)
      expect(EXTRA_BADGE_STYLES as readonly string[]).toContain(s)
    }
    expect(isSeparateRatingsStyle("rings")).toBe(true)
    // rings is a COLUMN variant, never a bottom row
    expect(isBottomSeparateRatingsStyle("rings")).toBe(false)
  })

  it("only accent-painting styles sample the accent", () => {
    expect(genreBadgeConsumesAccent("tinta")).toBe(true)
    expect(genreBadgeConsumesAccent("sfumato")).toBe(true)
    expect(genreBadgeConsumesAccent("split")).toBe(true)
    expect(genreBadgeConsumesAccent("editoriale")).toBe(false)
    expect(topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: "tinta" })).toBe(true)
    expect(topBadgeConsumesAccent({ topBadgeType: "extra", rankingBadgeStyle: "default", extraBadgeStyle: "sfumato" })).toBe(true)
  })
})

describe("new genre builders", () => {
  it("tinta tints plate and ink from the accent, neutral without one", () => {
    const { svg } = buildGenreTintSvg("Crime", "8.0", "2006", 28, ACCENT, false)
    expect(svg).toContain(`fill="${ACCENT}" fill-opacity="0.25"`)
    expect(svg).toContain(`fill="${mixHex(ACCENT, 0.62)}"`)
    expect(buildGenreTintSvg("Crime", "8.0", "2006", 28, "#555555", false).svg).toContain('fill="#ffffff" fill-opacity="0.25"')
  })

  it("sfumato strokes the plate with an accent gradient", () => {
    const { svg } = buildGenreGradientBorderSvg("Crime", "8.0", "2006", 28, ACCENT, false)
    expect(svg).toContain('stroke="url(#gsf)"')
    expect(svg).toContain(`stop-color="${ACCENT}"`)
  })

  it("split puts the vote in the accent cell and genre/year in the satin cell", () => {
    const both = buildGenreSplitSvg("Crime", "8.0", "2006", 28, ACCENT, false)
    expect(both.svg).toContain(`fill="${ACCENT}"`)
    expect(both.svg).toContain('fill="url(#gspl)"')
    expect(both.svg).toContain(">8.0<")
    expect(both.svg).toContain(">Crime<")
    // rating hidden → satin cell only
    const noVote = buildGenreSplitSvg("Crime", "8.0", "2006", 28, ACCENT, false, { showRating: false })
    expect(noVote.svg).not.toContain(`fill="${ACCENT}"`)
    expect(noVote.w).toBeLessThan(both.w)
  })

  it("editoriale is uppercase tracked Oswald with a rule, no plate", () => {
    const { svg } = buildGenreEditorialSvg("Crime", "8.0", "2006", 28, false)
    expect(svg).toContain(">CRIME<")
    expect(svg).toContain('font-family="Oswald"')
    expect(svg).toContain("letter-spacing=")
    expect(svg).toContain('height="1.5"')
  })
})

describe("top badges reuse the material builders", () => {
  it("rank and extra render tinta/sfumato plates", () => {
    expect(buildHouseRankingSvg({ rank: 1, label: "Oggi", pw: 380, style: "tinta", accentColor: ACCENT }).svg).toContain('fill-opacity="0.25"')
    expect(buildHouseExtraSvg({ label: "Oscar", pw: 380, style: "sfumato", accentColor: ACCENT }).svg).toContain('stroke="url(#gsf)"')
  })
})

describe("editoriale across families", () => {
  it("is offered for rank, extra, quality and age", () => {
    for (const list of [RANKING_BADGE_STYLES, EXTRA_BADGE_STYLES, QUALITY_BADGE_STYLES, AGE_BADGE_STYLES]) {
      expect(list as readonly string[]).toContain("editoriale")
    }
  })

  it("top label is uppercase tracked Oswald with a rule below the text", () => {
    const { svg } = buildEditorialLabelSvg("#1 Oggi", 30, false)
    expect(svg).toContain(">#1 OGGI<")
    expect(svg).toContain('font-family="Oswald"')
    const textY = Number(svg.match(/<text[^>]* y="([\d.]+)"/)![1])
    const ruleY = Number(svg.match(/<rect[^>]* y="([\d.]+)"/)![1])
    expect(ruleY).toBeGreaterThan(textY)
    expect(buildHouseRankingSvg({ rank: 1, label: "Oggi", pw: 380, style: "editoriale" }).svg).toContain(">#1 OGGI<")
  })

  it("quality mark keeps the shared text box and pins the group column", () => {
    const natural = buildEditorialMarkSvg("4K", 17, false)
    const pinned = buildEditorialMarkSvg("HDR10+", 17, false, natural.w - 28)
    expect(pinned.w).toBe(natural.w)
    expect(pinned.svg).toContain(">HDR10+<")
  })
})

describe("rings separate ratings", () => {
  it("draws one progress ring per provider, score-colored", async () => {
    const stack = await renderSeparateRatingStack([{ id: "imdb", value: 8.7 }, { id: "tomatoes", value: 5.4 }], 380, false, "inter", 100, null, "rings")
    expect(stack).not.toBeNull()
    expect(stack!.items).toHaveLength(2)
    // rings are taller than the pill rows and stay one bitmap
    const pills = await renderSeparateRatingStack([{ id: "imdb", value: 8.7 }, { id: "tomatoes", value: 5.4 }], 380, false, "inter", 100)
    expect(stack!.h).toBeGreaterThan(pills!.h)
  })
})

describe("real frosted glass underlay", () => {
  it("inserts a blurred patch, shaped by the plate, right below the glass layer", async () => {
    const W = 100, H = 60
    // Base: left half red, right half blue → blur mixes them under the plate.
    const base = sharp(await sharp({ create: { width: W, height: H, channels: 3, background: "#ff0000" } })
      .composite([{ input: await sharp({ create: { width: W / 2, height: H, channels: 3, background: "#0000ff" } }).png().toBuffer(), left: W / 2, top: 0 }])
      .png().toBuffer())
    const plate = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><rect width="60" height="20" rx="10" fill="#ffffff" fill-opacity="0.2"/></svg>`)).png().toBuffer()
    const glassLayer: PosterComposite = { input: plate, top: 20, left: 20 }
    const other: PosterComposite = { input: plate, top: 0, left: 0 }
    const layers = [other, glassLayer]
    await insertFrostedGlassUnderlays(base, layers, new Set([glassLayer]), W, H)
    expect(layers).toHaveLength(3)
    expect(layers[2]).toBe(glassLayer)
    const patch = layers[1]
    expect([patch.left, patch.top]).toEqual([20, 20])
    const { data, info } = await sharp(patch.input).raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => data.slice((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + info.channels)
    // Centre straddles the red/blue edge → blurred mix; plate corner → transparent.
    const c = at(30, 10)
    expect(c[0]).toBeGreaterThan(40)
    expect(c[2]).toBeGreaterThan(40)
    expect(at(0, 0)[3]).toBe(0)
  })

  it("does nothing without glass layers", async () => {
    const layers: PosterComposite[] = []
    await insertFrostedGlassUnderlays(sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }), layers, new Set(), 10, 10)
    expect(layers).toHaveLength(0)
  })
})
