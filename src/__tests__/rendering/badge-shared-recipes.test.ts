/**
 * Shared native badge recipes (no Badge Lab).
 *
 * The custom-badge builder coverage (`buildCustomBadgeSvg`) was retired with
 * the Badge Lab feature. What remains pins the NATIVE shared recipes used by
 * `svg-badge.ts`: `presetHexToRgba` (color helper) and `buildHouseRankingSvg`
 * (single ranking-badge recipe for every style) — byte-identical between the
 * client preview and the Stremio poster by construction.
 */
import { describe, it, expect } from "vitest"
import { presetHexToRgba, buildHouseRankingSvg } from "@/lib/badge-svg-shared"

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

  it("colors the default badge flat with accentFill (colored degrade without ribbon)", () => {
    const accented = buildHouseRankingSvg({
      rank: 4,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "default",
      accentColor: "#e50914",
      accentFill: true,
    })
    expect(accented.svg).toContain('fill="#e50914"')
    expect(accented.svg).toContain("#4 Oggi")
    const plain = buildHouseRankingSvg({
      rank: 4,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "default",
      accentColor: "#e50914",
    })
    expect(plain.svg).toContain('fill="url(#rdg)"')
    expect(plain.svg).not.toContain('fill="#e50914"')
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

  it("renders corner style as a flat accent pill with contrasting text", () => {
    const res = buildHouseRankingSvg({
      rank: 4,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "corner",
      accentColor: "#e50914",
    })
    expect(res.svg).toContain("#4 Oggi")
    expect(res.svg).toContain("<rect")
    // Flat accent fill, never a satin gradient, and no stroke.
    expect(res.svg).toContain('fill="#e50914"')
    expect(res.svg).not.toContain("url(#rpg)")
    expect(res.svg).not.toContain("url(#rdg)")
    expect(res.svg).not.toContain("url(#nrg)")
    expect(res.svg).not.toContain("stroke")
    expect(res.svg).not.toContain("TOP")
  })

  it("renders corner style with white text on a dark accent", () => {
    const res = buildHouseRankingSvg({
      rank: 4,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "corner",
      accentColor: "#1a2b4a",
    })
    expect(res.svg).toContain("#4 Oggi")
    expect(res.svg).toContain('fill="#1a2b4a"')
    expect(res.svg).toContain('fill="#ffffff"')
  })

  it("renders corner style with dark text on a light accent", () => {
    const res = buildHouseRankingSvg({
      rank: 4,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "corner",
      accentColor: "#f2c94c",
    })
    expect(res.svg).toContain("#4 Oggi")
    expect(res.svg).toContain('fill="#f2c94c"')
    expect(res.svg).toContain('fill="rgba(0,0,0,0.80)"')
  })

  it("renders corner style with readable text on the sentinel gray fallback", () => {
    const res = buildHouseRankingSvg({
      rank: 4,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "corner",
      accentColor: "#555555",
    })
    expect(res.svg).toContain("#4 Oggi")
    expect(res.svg).toContain('fill="#555555"')
  })

  it("standard (netflix) and colored ribbons genuinely differ (satin vs accent)", () => {
    const satin = buildHouseRankingSvg({
      rank: 2,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "netflix",
      accentColor: "#e50914",
    })
    const accent = buildHouseRankingSvg({
      rank: 2,
      label: "Oggi",
      pw: 380,
      topLight: false,
      style: "colored",
      accentColor: "#e50914",
    })
    // Standard = satin gradient ribbon; Colorato = flat accent ribbon.
    expect(satin.svg).toContain('fill="url(#nrg)"')
    expect(satin.svg).toContain("TOP")
    expect(accent.svg).toContain('fill="#e50914"')
    expect(accent.svg).toContain("TOP")
    expect(accent.svg).not.toContain("url(#nrg)")
    expect(accent.svg).not.toEqual(satin.svg)
  })
})
