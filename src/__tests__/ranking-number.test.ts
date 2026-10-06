import { describe, expect, it } from "vitest"
import {
  RANKING_BADGE_STYLES,
  isRankingBadgeStyle,
  isRibbonRankingStyle,
  nonRibbonRankingStyle,
} from "@/lib/badge-styles"
import { buildHouseRankingSvg, buildRankingNumberSvg } from "@/lib/badge-svg-shared"
import { buildExtraBadgeSVG, buildRankingBadgeSVG, comingSoonRibbonLayout } from "@/lib/svg-badge"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import {
  cornerAnchoredLeft,
  isCornerAnchoredStyle,
  isNumberRightCorner,
  numberSharesComingSoonCorner,
  stackNetworkBelowCornerRank,
} from "@/lib/poster-service"
import { fitBadgeToCanvas } from "@/lib/poster-render-helpers"

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

describe("rs=number enum and guards", () => {
  it("lists number as a ranking badge style", () => {
    expect((RANKING_BADGE_STYLES as readonly string[])).toContain("number")
    expect(isRankingBadgeStyle("number")).toBe(true)
  })

  it("is not a ribbon style and survives the no-ribbon fallback untouched", () => {
    expect(isRibbonRankingStyle("number")).toBe(false)
    expect(nonRibbonRankingStyle("number")).toBe("number")
  })

  it("shares the corner anchor for placement and collision handling", () => {
    expect(isCornerAnchoredStyle("number")).toBe(true)
    expect(isCornerAnchoredStyle("corner")).toBe(true)
    expect(isCornerAnchoredStyle("pill")).toBe(false)
    expect(isCornerAnchoredStyle("default")).toBe(false)
    expect(isCornerAnchoredStyle(null)).toBe(false)
  })
})

describe("buildRankingNumberSvg", () => {
  it("renders bare digits with a white-to-silver gradient and soft shadow, no plate or label", () => {
    const { svg, w, h } = buildRankingNumberSvg(3, 380)
    expect(w).toBeGreaterThan(0)
    expect(h).toBeGreaterThan(0)
    // Bare numeral: the digit text is present, no "#" prefix, no period label.
    expect(svg).toContain(">3<")
    expect(svg).not.toContain("#3")
    expect(svg).not.toContain("Oggi")
    // Silver gradient (bright head, darker foot) + soft drop shadow.
    expect(svg).toContain("<linearGradient")
    expect(svg).toContain("#FFFFFF")
    expect(svg).toContain("#A8ACB4")
    expect(svg).toContain("<feDropShadow")
    // No plate: no filled rect background.
    expect(svg).not.toContain("<rect")
  })

  it("scales with the render width and digit count", () => {
    const small = buildRankingNumberSvg(3, 380)
    const large = buildRankingNumberSvg(3, 500)
    expect(large.w).toBeGreaterThan(small.w)
    expect(large.h).toBeGreaterThan(small.h)
    const two = buildRankingNumberSvg(12, 380)
    expect(two.w).toBeGreaterThan(small.w)
    expect(two.svg).toContain(">12<")
  })
})

describe("number style through the shared ranking builder", () => {
  it("ignores label, ribbon side and detached flag (numeral only)", () => {
    const a = buildHouseRankingSvg({ rank: 3, pw: 380, topLight: false, style: "number", label: "Oggi" })
    const b = buildHouseRankingSvg({
      rank: 3, pw: 380, topLight: false, style: "number",
      label: "Film", side: "right", detached: true,
    })
    expect(a.svg).toBe(b.svg)
  })

  it("differs from every pre-existing ranking style bitmap recipe", () => {
    const num = buildHouseRankingSvg({ rank: 3, pw: 380, topLight: false, style: "number" })
    for (const style of ["default", "pill", "bordo", "vetro", "corner"] as const) {
      const other = buildHouseRankingSvg({ rank: 3, pw: 380, topLight: false, style })
      expect(other.svg).not.toBe(num.svg)
    }
  })

  it("renders a deterministic PNG via the server badge pipeline", async () => {
    const a = await buildRankingBadgeSVG(3, 380, "Oggi", false, "number")
    const b = await buildRankingBadgeSVG(3, 380, "Film", false, "number", undefined, "right", false, true)
    expect(a).not.toBeNull()
    expect(a!.png.equals(b!.png)).toBe(true)
  })

  it("degrades extra badges to the corner pill (no digits to draw)", async () => {
    const num = await buildExtraBadgeSVG("Nuova stagione", 380, false, "number", "#e50914")
    const corner = await buildExtraBadgeSVG("Nuova stagione", 380, false, "corner", "#e50914")
    expect(num!.png.equals(corner!.png)).toBe(true)
  })
})

describe("rs=number config and cache roundtrip", () => {
  it("query rs=number beats mapping and is never auto-promoted to the netflix ribbon", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "number" }),
      rankingResult: 4,
    }))
    expect(r.rankingBadgeStyle).toBe("number")
  })

  it("mapping rs=number resolves without a query override", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams(),
      mapping: {
        tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
        logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
        rankingBadgeStyle: "number",
      },
      rankingResult: 7,
    }))
    expect(r.rankingBadgeStyle).toBe("number")
  })

  it("invalid rs still falls back to default rendering", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ rs: "garbage" }),
    }))
    expect(r.rankingBadgeStyle).toBe("default")
  })

  it("poster cache key keeps rs=number and drops invalid rs", () => {
    expect(normalizePosterCacheParams(new URLSearchParams({ rs: "number" })).get("rs")).toBe("number")
    expect(normalizePosterCacheParams(new URLSearchParams({ rs: "garbage" })).get("rs")).toBeNull()
    expect(normalizePosterCacheParams(new URLSearchParams({ rs: "corner" })).get("rs")).toBe("corner")
  })
})

describe("number style collision handling", () => {
  const PILL = { left: 18, top: 10, w: 120, h: 110 }
  const base = {
    hasTopBadge: true,
    rank: PILL,
    netLeft: 18,
    netTop: 28,
    netW: 70,
    netH: 40,
    gap: 6,
  }

  it("stacks an overlapping network logo below the numeral like corner", () => {
    expect(stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "number" })).toBe(
      PILL.top + PILL.h + base.gap,
    )
  })

  it("leaves clear logos and other styles alone", () => {
    expect(stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "number", netTop: 200 })).toBeNull()
    expect(stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "pill" })).toBeNull()
    expect(stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "number", hasTopBadge: false })).toBeNull()
  })
})

describe("number corner anchor and Coming Soon sharing", () => {
  // Portrait geometry at pw=380: 1-digit numeral w=80/h=94, Coming Soon
  // layout from the real helper (size 200, offset 20, extent 155).
  const CW = 380
  const NUM_W = buildRankingNumberSvg(3, 380).w
  const NUM_H = buildRankingNumberSvg(3, 380).h
  const layout = comingSoonRibbonLayout(380)

  function share(numLeft: number, ribbonSide: "left" | "right", numTop = 10) {
    return numberSharesComingSoonCorner({
      canvasW: CW,
      hasTopBadge: true,
      showComingSoon: true,
      ribbonSide,
      ribbonW: layout.size,
      ribbonOffset: layout.offset,
      ribbonExtent: layout.extent,
      numLeft,
      numTop,
      numW: NUM_W,
      numH: NUM_H,
    })
  }

  it("keeps the historic corner margins (left anchor untouched)", () => {
    for (const canvasW of [380, 500, 768]) {
      expect(cornerAnchoredLeft({ canvasW, badgeW: 120, mirrorRight: false, offsetX: 0 }))
        .toBe(Math.round(18 * canvasW / 380))
      expect(cornerAnchoredLeft({ canvasW, badgeW: 120, mirrorRight: false, offsetX: 7 }))
        .toBe(Math.round(18 * canvasW / 380) + 7)
    }
  })

  it("mirrors the numeral to the right corner with side=right", () => {
    expect(cornerAnchoredLeft({ canvasW: CW, badgeW: NUM_W, mirrorRight: true, offsetX: 0 }))
      .toBe(Math.round(CW - NUM_W - 18 * CW / 380))
  })

  it("stacks number-left below a left ribbon, not a right one", () => {
    const left = cornerAnchoredLeft({ canvasW: CW, badgeW: NUM_W, mirrorRight: false, offsetX: 0 })
    expect(share(left, "left")).toBe(true)
    expect(share(left, "right")).toBe(false)
  })

  it("stacks number-right below a right ribbon, not a left one", () => {
    const right = cornerAnchoredLeft({ canvasW: CW, badgeW: NUM_W, mirrorRight: true, offsetX: 0 })
    expect(share(right, "right")).toBe(true)
    expect(share(right, "left")).toBe(false)
  })

  it("does not stack without a badge, without a ribbon, or with missing metrics", () => {
    const base = {
      canvasW: CW,
      hasTopBadge: true,
      showComingSoon: true,
      ribbonSide: "left" as const,
      ribbonW: layout.size as number | null,
      ribbonOffset: layout.offset as number | null,
      ribbonExtent: layout.extent as number | null,
      numLeft: 18,
      numTop: 10,
      numW: NUM_W,
      numH: NUM_H,
    }
    expect(numberSharesComingSoonCorner({ ...base, hasTopBadge: false })).toBe(false)
    expect(numberSharesComingSoonCorner({ ...base, showComingSoon: false })).toBe(false)
    expect(numberSharesComingSoonCorner({ ...base, ribbonW: null })).toBe(false)
    expect(numberSharesComingSoonCorner({ ...base, ribbonOffset: null })).toBe(false)
    expect(numberSharesComingSoonCorner({ ...base, ribbonExtent: null })).toBe(false)
  })

  it("does not stack when explicit offsets move the numeral clear", () => {
    // toy pushes the numeral below the ribbon extent.
    expect(share(18, "left", layout.extent + 50)).toBe(false)
    // tox pushes the numeral to the opposite side.
    expect(share(300, "left")).toBe(false)
  })
})

describe("number right corner occupancy (quality translociates left)", () => {
  it("matches only a mirrored number with a rendered top badge", () => {
    const yes = { rankingBadgeStyle: "number", ribbonSide: "right", hasTopBadge: true }
    expect(isNumberRightCorner(yes)).toBe(true)
    expect(isNumberRightCorner({ ...yes, ribbonSide: "left" })).toBe(false)
    expect(isNumberRightCorner({ ...yes, rankingBadgeStyle: "corner" })).toBe(false)
    expect(isNumberRightCorner({ ...yes, rankingBadgeStyle: "default" })).toBe(false)
    expect(isNumberRightCorner({ ...yes, rankingBadgeStyle: "netflix" })).toBe(false)
    expect(isNumberRightCorner({ ...yes, hasTopBadge: false })).toBe(false)
    expect(isNumberRightCorner({ rankingBadgeStyle: null, ribbonSide: "right", hasTopBadge: true })).toBe(false)
  })
})

describe("oversized numerals use the existing canvas fit (no new shrink path)", () => {
  it("fits sane ranks untouched and shrinks absurd multi-digit ranks", async () => {
    const sane = await buildRankingBadgeSVG(12, 380, "", false, "number")
    const kept = await fitBadgeToCanvas(sane!, 380, 570)
    expect(kept.png.equals(sane!.png)).toBe(true)

    const absurd = await buildRankingBadgeSVG(88888888, 380, "", false, "number")
    expect(absurd!.w).toBeGreaterThan(380)
    const fitted = await fitBadgeToCanvas(absurd!, 380, 570)
    expect(fitted.w).toBeLessThanOrEqual(380)
    expect(fitted.h).toBeLessThanOrEqual(570)
  })
})
