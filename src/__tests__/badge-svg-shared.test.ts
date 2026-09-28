import { describe, it, expect } from "vitest"
import { buildCustomBadgeSvg, presetHexToRgba, buildHouseRankingSvg } from "@/lib/badge-svg-shared"
import type { BadgeDesign } from "@/lib/badge-preset"

const base: BadgeDesign = {
  shape: "pill",
  padding: { x: 12, y: 6 },
  background: { type: "solid", color: "#ff0000", opacity: 90 },
  text: {
    template: "★ {{rating}}",
    color: "#ffffff",
    opacity: 100,
    fontSize: 20,
    fontWeight: 700,
    uppercase: false,
    letterSpacing: 0,
    align: "center",
  },
  scale: 100,
}

describe("presetHexToRgba", () => {
  it("expands short hex and applies opacity", () => {
    expect(presetHexToRgba("#fff", 100)).toBe("rgba(255,255,255,1)")
    expect(presetHexToRgba("#ff0000", 50)).toBe("rgba(255,0,0,0.5)")
  })

  it("multiplies embedded hex alpha by opacity", () => {
    expect(presetHexToRgba("#00000080", 100)).toBe("rgba(0,0,0,0.502)")
    expect(presetHexToRgba("#00000080", 50)).toBe("rgba(0,0,0,0.251)")
  })
})

describe("buildCustomBadgeSvg", () => {
  it("is deterministic for the same input", () => {
    const a = buildCustomBadgeSvg(base, "★ 8.2")
    const b = buildCustomBadgeSvg(structuredClone(base), "★ 8.2")
    expect(b).toEqual(a)
    expect(a.svg).toContain('width="')
    expect(a.w).toBeGreaterThan(0)
    expect(a.h).toBeGreaterThan(0)
  })

  it("escapes text and drops empty labels without a text node", () => {
    const evil = buildCustomBadgeSvg(base, "<b>&\"x\"</b>")
    expect(evil.svg).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;")
    expect(evil.svg).not.toContain("<b>")
    const empty = buildCustomBadgeSvg(base, "")
    expect(empty.svg).not.toContain("<text")
  })

  it("auto-fits width and honors explicit width/height without clipping", () => {
    const auto = buildCustomBadgeSvg(base, "short")
    const wide = buildCustomBadgeSvg(base, "a much longer label here")
    expect(wide.w).toBeGreaterThan(auto.w)
    const fixed = buildCustomBadgeSvg({ ...base, width: 400, height: 60 }, "x")
    expect(fixed.w).toBeGreaterThanOrEqual(400)
    expect(fixed.h).toBeGreaterThanOrEqual(60)
    // Explicit width smaller than content expands instead of clipping.
    const narrow = buildCustomBadgeSvg({ ...base, width: 20 }, "a much longer label here")
    expect(narrow.w).toBe(wide.w)
  })

  it("derives pill radius from height and renders gradient/border/shadow", () => {
    const pill = buildCustomBadgeSvg(base, "x")
    // pill rx = floor(boxH/2): boxH = 20 + 6*2 = 32 → rx 16.
    expect(pill.svg).toContain('rx="16"')
    const styled: BadgeDesign = {
      ...base,
      shape: "rect",
      radius: 4,
      background: {
        type: "gradient",
        opacity: 80,
        gradient: { from: "#111111", to: "#222222", direction: "diagonal" },
      },
      border: { enabled: true, width: 2, color: "#00ff00", opacity: 50 },
      shadow: { enabled: true, blur: 8, offsetX: 2, offsetY: 3, opacity: 60 },
    }
    const out = buildCustomBadgeSvg(styled, "Hi")
    expect(out.svg).toContain("<linearGradient")
    expect(out.svg).toContain('stroke="rgba(0,255,0,0.5)"')
    expect(out.svg).toContain("<feDropShadow")
    // Shadow pad expands the canvas beyond the box.
    expect(out.w).toBeGreaterThan(out.h)
  })

  it("scales geometry with scale %", () => {
    const big = buildCustomBadgeSvg({ ...base, scale: 200 }, "x")
    const small = buildCustomBadgeSvg({ ...base, scale: 50 }, "x")
    expect(big.w).toBeGreaterThan(small.w)
    expect(big.h).toBeGreaterThan(small.h)
    expect(big.svg).toContain('font-size="40"')
    expect(small.svg).toContain('font-size="10"')
  })
})

describe("buildHouseRankingSvg", () => {
  it("renders colored style as a colored Netflix ribbon with accentColor", () => {
    const res = buildHouseRankingSvg({
      rank: 1,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "colored",
      accentColor: "#e50914",
    })
    expect(res.svg).toContain('fill="#e50914"')
    expect(res.svg).toContain("TOP")
    expect(res.svg).toContain(">1<")
    expect(res.svg).not.toContain("url(#nrg)")
  })

  it("renders netflix style as a Netflix ribbon with satin gradient", () => {
    const res = buildHouseRankingSvg({
      rank: 2,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "netflix",
      accentColor: "#e50914",
    })
    expect(res.svg).toContain('fill="url(#nrg)"')
    expect(res.svg).toContain("TOP")
    expect(res.svg).toContain(">2<")
  })

  it("renders pill style as a pill badge", () => {
    const res = buildHouseRankingSvg({
      rank: 3,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "pill",
      accentColor: "#e50914",
    })
    expect(res.svg).toContain("#3 Oggi")
    expect(res.svg).toContain("<rect")
    expect(res.svg).not.toContain("TOP")
  })
})
