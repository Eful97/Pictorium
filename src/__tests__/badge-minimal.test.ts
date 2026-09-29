import { describe, it, expect } from "vitest"
import { renderGenreBadge } from "../lib/svg-badge"
import { buildGenreTextSvg } from "../lib/badge-svg-shared"
import { BADGE_STYLES, isBadgeStyle } from "../lib/badge-styles"
import { resolvePosterRenderConfig } from "../lib/poster-config"

describe("BadgeStyle minimal (pipe separator)", () => {
  it("includes minimal in BADGE_STYLES and isBadgeStyle recognizes it", () => {
    expect(BADGE_STYLES).toContain("minimal")
    expect(isBadgeStyle("minimal")).toBe(true)
    expect(isBadgeStyle("unknown")).toBe(false)
  })

  it("builds genre text flow using pipe separator '|' instead of bullet '•'", () => {
    const svgText = buildGenreTextSvg("Action", "8.5", "2024", 24, "#e5e7eb", "minimal")
    expect(svgText.svg).toContain("|")
    expect(svgText.svg).not.toContain("\u2022") // bullet not present
    expect(svgText.svg).toContain("Action")
    expect(svgText.svg).toContain("8.5")
    expect(svgText.svg).toContain("2024")
    expect(svgText.svg).toContain("\u2605") // star preserved for rating
  })

  it("respects parts flags: hides rating when showRating is false", () => {
    const svgText = buildGenreTextSvg("Comedy", "7.2", "2020", 24, "#e5e7eb", "minimal", 0, {
      showGenre: true,
      showRating: false,
      showYear: true,
    })
    expect(svgText.svg).toContain("Comedy")
    expect(svgText.svg).toContain("2020")
    expect(svgText.svg).not.toContain("7.2")
    expect(svgText.svg).not.toContain("\u2605")
    expect(svgText.svg).toContain("|")
  })

  it("renders minimal genre badge via renderGenreBadge without error", async () => {
    const badge = await renderGenreBadge("Sci-Fi", 8.0, 380, "2023", "minimal")
    expect(badge).not.toBeNull()
    expect(badge.png).toBeInstanceOf(Buffer)
    expect(badge.w).toBeGreaterThan(0)
    expect(badge.h).toBeGreaterThan(0)
  })

  it("retains minimal style in landscape like in portrait (no shadow force)", () => {
    const sp = new URLSearchParams("shape=landscape&bs=minimal")
    const config = resolvePosterRenderConfig({
      searchParams: sp,
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(config.badgeStyle).toBe("minimal")
  })

  it("retains minimal style in portrait poster", () => {
    const sp = new URLSearchParams("bs=minimal")
    const config = resolvePosterRenderConfig({
      searchParams: sp,
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(config.badgeStyle).toBe("minimal")
  })
})
