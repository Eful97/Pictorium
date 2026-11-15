import { describe, it, expect } from "vitest"
import { NOTCH_MATERIALS, notchMaterialOf } from "@/lib/badge-styles"
import { genreBadgeConsumesAccent, topBadgeConsumesAccent } from "@/lib/badge-layout"
import { buildHouseExtraSvg, buildHouseGenreSvg, buildHouseRankingSvg } from "@/lib/badge-svg-shared"

const ACCENT = "#e5303a"
const genreInput = { genreName: "Crime", voteStr: "8.0", yearStr: "2006", pw: 500, accentColor: ACCENT }

/** First `<path>` element of a builder output (the notch body). */
function bodyPath(svg: string): string {
  return svg.match(/<path [^>]*>/)?.[0] ?? ""
}

describe("notch badge: enums and accent gating", () => {
  it("maps each notch style to its material", () => {
    for (const m of NOTCH_MATERIALS) expect(notchMaterialOf(`notch-${m}`)).toBe(m)
    expect(notchMaterialOf("pill")).toBeNull()
  })

  it("paints the accent for crema/inchiostro/sfumato but not vetro", () => {
    expect(genreBadgeConsumesAccent("notch-crema")).toBe(true)
    expect(genreBadgeConsumesAccent("notch-inchiostro")).toBe(true)
    expect(genreBadgeConsumesAccent("notch-sfumato")).toBe(true)
    expect(genreBadgeConsumesAccent("notch-vetro")).toBe(false)
    expect(topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: "notch-inchiostro" })).toBe(true)
    expect(topBadgeConsumesAccent({ topBadgeType: "rank", rankingBadgeStyle: "notch-vetro" })).toBe(false)
  })
})

describe("notch badge: genre (bottom edge)", () => {
  for (const m of NOTCH_MATERIALS) {
    it(`notch-${m} draws a concave-fillet pill wider than the pill style`, () => {
      const notch = buildHouseGenreSvg({ ...genreInput, style: `notch-${m}` as never })
      const pill = buildHouseGenreSvg({ ...genreInput, style: "pill" })
      const d = bodyPath(notch.svg)
      expect(d).toContain(" Q ")
      expect(d).toContain(" A ")
      expect(notch.w).toBeGreaterThan(pill.w)
    })
  }

  it("is flush with the canvas bottom edge", () => {
    const { svg, h } = buildHouseGenreSvg({ ...genreInput, style: "notch-crema" })
    expect(bodyPath(svg)).toMatch(new RegExp(`d="M [\\d.]+,${h} `))
  })

  it("notch-vetro has no shadow filter on the body path", () => {
    const { svg } = buildHouseGenreSvg({ ...genreInput, style: "notch-vetro" })
    expect(bodyPath(svg)).not.toContain('filter="url(#tds)"')
  })
})

describe("notch badge: top badges (top edge)", () => {
  it("ranking notch-vetro starts its path at y 0", () => {
    const { svg } = buildHouseRankingSvg({ rank: 1, pw: 500, style: "notch-vetro", label: "Oggi" })
    expect(bodyPath(svg)).toMatch(/d="M [\d.]+,0 /)
  })

  it("ranking notch-vetro has no shadow filter on the body path", () => {
    const { svg } = buildHouseRankingSvg({ rank: 1, pw: 500, style: "notch-vetro", label: "Oggi" })
    expect(bodyPath(svg)).not.toContain('filter="url(#tds)"')
  })

  it("extra notch-crema starts its path at y 0", () => {
    const { svg } = buildHouseExtraSvg({ label: "Candidato", pw: 500, style: "notch-crema", accentColor: ACCENT })
    expect(bodyPath(svg)).toMatch(/d="M [\d.]+,0 /)
  })
})
