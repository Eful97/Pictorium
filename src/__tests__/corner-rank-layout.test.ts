import { describe, expect, it } from "vitest"
import {
  cornerNetworkAboveTitle,
  cornerRankTop,
  NETWORK_LOGO_SHIFT_Y,
  stackNetworkBelowCornerRank,
} from "@/lib/poster-service"

// Geometry mirrors the e2e corner fixture (poster px, CW=380): top pill at
// the top-left margin, network logo anchored at the same corner.
const TOP_PILL = { left: 18, top: 10, w: 190, h: 82 }
const NET_TOP_LEFT = { netLeft: 18, netTop: 28, netW: 70, netH: 40 }
const GAP = 6

function stacked(top: number, left: number, w = NET_TOP_LEFT.netW, h = NET_TOP_LEFT.netH) {
  return stackNetworkBelowCornerRank({
    rankingBadgeStyle: "corner",
    hasTopBadge: true,
    rank: TOP_PILL,
    netLeft: left,
    netTop: top,
    netW: w,
    netH: h,
    gap: GAP,
  })
}

describe("cornerRankTop", () => {
  it("keeps the fixed top gap without a left Coming Soon ribbon", () => {
    expect(cornerRankTop({ comingSoonLeft: false, ribbonExtent: 155, gap: GAP, pillTopGap: 10 })).toBe(10)
  })

  it("stacks the top pill below a left Coming Soon ribbon", () => {
    expect(cornerRankTop({ comingSoonLeft: true, ribbonExtent: 155, gap: GAP, pillTopGap: 10 })).toBe(161)
  })
})

describe("stackNetworkBelowCornerRank", () => {
  it("stacks an overlapping top-left network logo below the pill", () => {
    // Pill bottom = 10 + 82 = 92, plus gap = 98.
    expect(stacked(NET_TOP_LEFT.netTop, NET_TOP_LEFT.netLeft)).toBe(98)
  })

  it("stacks below an extra top badge too, not only rank", () => {
    // Same geometry, hasTopBadge covers rank and extra alike: the helper
    // no longer distinguishes the badge kind.
    expect(stacked(NET_TOP_LEFT.netTop, NET_TOP_LEFT.netLeft)).not.toBeNull()
  })

  it("leaves a clear network logo, other styles and missing badges alone", () => {
    // Already below the pill: no collision.
    expect(stacked(100, NET_TOP_LEFT.netLeft)).toBeNull()
    // Right side, clear of the pill: no collision.
    expect(stacked(NET_TOP_LEFT.netTop, 300)).toBeNull()
    const base = {
      hasTopBadge: true,
      rank: TOP_PILL,
      netLeft: NET_TOP_LEFT.netLeft,
      netTop: NET_TOP_LEFT.netTop,
      netW: NET_TOP_LEFT.netW,
      netH: NET_TOP_LEFT.netH,
      gap: GAP,
    }
    expect(stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "pill" })).toBeNull()
    expect(stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "default" })).toBeNull()
    // No top badge at all (rank and extra alike): untouched.
    expect(stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "corner", hasTopBadge: false })).toBeNull()
    expect(
      stackNetworkBelowCornerRank({ ...base, rankingBadgeStyle: "corner", rank: null }),
    ).toBeNull()
  })
})

describe("cornerNetworkAboveTitle", () => {
  // Landscape canvas with a title logo low enough for room above it.
  const BASE = {
    logoTop: 300,
    logoLeft: 280,
    logoW: 229,
    netW: 90,
    netH: 36,
    gap: 5,
  } as const

  it("anchors above the title, centered on the title box, keeping the on-poster gap exact", () => {
    const anchor = cornerNetworkAboveTitle({ ...BASE })
    // Portrait formula minus the visible shift: the composited pill
    // (+SHIFT_Y) sits exactly `gap` above the title.
    expect(anchor).toEqual({
      top: 300 - 36 - 5 - NETWORK_LOGO_SHIFT_Y,
      left: Math.round(280 + (229 - 90) / 2),
    })
    expect(anchor!.top + NETWORK_LOGO_SHIFT_Y + 36).toBe(300 - 5)
  })

  it("centers on the title box in Cinematic Left too, not on the canvas", () => {
    const anchor = cornerNetworkAboveTitle({ ...BASE, logoLeft: 46 })
    expect(anchor!.left).toBe(Math.round(46 + (229 - 90) / 2))
    expect(anchor!.top).toBe(300 - 36 - 5 - NETWORK_LOGO_SHIFT_Y)
  })

  it("follows a shifted title (nonzero offsetX)", () => {
    const anchor = cornerNetworkAboveTitle({ ...BASE, logoLeft: 320 })
    expect(anchor!.left).toBe(Math.round(320 + (229 - 90) / 2))
  })

  it("returns null without room above the title (fallback to top-left)", () => {
    expect(
      cornerNetworkAboveTitle({ ...BASE, logoTop: 40 }),
    ).toBeNull()
  })

  it("allows a flush anchor exactly at the top edge", () => {
    const anchor = cornerNetworkAboveTitle({
      ...BASE,
      logoTop: 36 + 5 + NETWORK_LOGO_SHIFT_Y,
    })
    expect(anchor!.top).toBe(0)
  })

  it("matches the portrait formula with a zero visible shift", () => {
    const anchor = cornerNetworkAboveTitle({
      ...BASE,
      visibleShiftY: 0,
    })
    expect(anchor!.top).toBe(300 - 36 - 5)
  })

  it("recenters exactly when the network box shrinks", () => {
    const full = cornerNetworkAboveTitle({ ...BASE })!
    const shrunk = cornerNetworkAboveTitle({ ...BASE, netW: 50, netH: 20 })!
    // Same title center, within 1px of the formula on both sizes.
    expect(full.left + 90 / 2).toBeLessThanOrEqual(280 + 229 / 2 + 1)
    expect(full.left + 90 / 2).toBeGreaterThanOrEqual(280 + 229 / 2 - 1)
    expect(shrunk.left + 50 / 2).toBeLessThanOrEqual(280 + 229 / 2 + 1)
    expect(shrunk.left + 50 / 2).toBeGreaterThanOrEqual(280 + 229 / 2 - 1)
    expect(shrunk.top).toBeGreaterThan(full.top)
  })
})
