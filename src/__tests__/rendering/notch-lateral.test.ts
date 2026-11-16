import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { buildNotchSvg, buildQualityNotchGroupSvg, genrePillHeight, TOP_SHADOW_PAD } from "@/lib/badge-svg-shared"
import { renderSVG } from "@/lib/svg-badge"
import { renderQualityBadgeGroup } from "@/lib/poster-service"
import { qualityGroupNotchMaterial } from "@/lib/badge-styles"

async function alphaAt(png: Buffer, x: number, y: number, w: number): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return data[(y * w + x) * 4 + 3]
}

describe("edge geometry of the shared notch builder", () => {
  it("attaches the straight edge to the bitmap border on both sides", async () => {
    for (const edge of ["right", "left"] as const) {
      const s = buildNotchSvg("4K", "", "", 17, null, false, "crema", edge)
      const png = await renderSVG(s.svg, s.w)
      const y = Math.round(s.h / 2)
      const first = await alphaAt(png, 0, y, s.w)
      const last = await alphaAt(png, s.w - 1, y, s.w)
      if (edge === "right") {
        expect(last, "right edge must be the painted poster border").toBeGreaterThan(200)
        expect(first, "shadow pad stays on the inner side").toBe(0)
        expect(s.svg).toContain(`M ${s.w},`)
      } else {
        expect(first, "left edge must be the painted poster border").toBeGreaterThan(200)
        expect(last, "shadow pad stays on the inner side").toBe(0)
        expect(s.svg).toContain("M 0,")
      }
    }
  })

  it("centres the label in the body, not in the shadow pad", () => {
    const s = buildNotchSvg("4K", "", "", 17, null, false, "crema", "right")
    const yText = s.svg.match(/<text[^>]* y="([\d.]+)"/)?.[1]
    expect(yText).toBeDefined()
    const boxH = genrePillHeight(17)
    expect(Number(yText)).toBeCloseTo(TOP_SHADOW_PAD + Math.round(boxH * 0.8) + boxH / 2, 1)
  })

  it("keeps top/bottom notch bytes unchanged", () => {
    const top = buildNotchSvg("TOP 20", "8.5", "2025", 17, "#ffcc00", false, "vetro", "top")
    const bottom = buildNotchSvg("Drammatico", "", "", 17, null, true, "sfumato", "bottom")
    expect(top.svg).not.toContain("M 0,")
    expect(bottom.svg).not.toContain(`M ${bottom.w},`)
    expect(top.h).toBe(genrePillHeight(17) + TOP_SHADOW_PAD)
  })
})

describe("one notch for the whole quality/age group", () => {
  it("packs every mark into a single bitmap with no per-item handles", async () => {
    const g = await renderQualityBadgeGroup("4K", "notch-crema", ["dv", "atmos", "imax"], 500, false, "inter", "VM14", "notch-crema", null, undefined, "right")
    expect(g).not.toBeNull()
    expect(g!.items).toEqual([])
    expect(g!.homeGhosts).toEqual([])
    // Più marchi = più righe dentro l'UNICA sagoma, non più sagome.
    const one = await renderQualityBadgeGroup("4K", "notch-crema", [], 500, false, "inter", "VM14", "notch-crema", null, undefined, "right")
    expect(g!.h).toBeGreaterThan(one!.h)
    expect(await alphaAt(g!.png, g!.w - 1, Math.round(g!.h / 2), g!.w)).toBeGreaterThan(200)
  })

  it("uses the Dolby logo for the DV+Atmos lockup, not its text label", () => {
    const logo = { label: "DV+Atmos", logo: { inner: '<path fill="currentColor" d="M0 0"/>', viewBox: "0 0 10 4", aspect: 2.5 } }
    const logoOnly = buildQualityNotchGroupSvg({ marks: [logo] }, 17, null, false, "inchiostro", "right")
    expect(logoOnly.svg).toContain("<svg x=")
    expect(logoOnly.svg).toContain("viewBox=\"0 0 10 4\"")
    expect(logoOnly.svg).not.toContain("currentColor")
    expect(logoOnly.svg).not.toContain("DV+Atmos")

    for (const layout of ["stacked", "row"] as const) {
      const withCombo = buildQualityNotchGroupSvg({ tier: "4K", age: "VM14", marks: [logo] }, 17, null, false, "inchiostro", "right", "inter", layout)
      expect(withCombo.svg.match(/<text /g)?.length).toBe(2)
      expect(withCombo.svg.match(/<svg x=/g)?.length).toBe(1)
    }
  })

  it("stacked = two floors only when tier/age AND A/V marks are present", () => {
    const one = buildQualityNotchGroupSvg({ tier: "4K", age: "VM14" }, 17, null, false, "crema", "right")
    const two = buildQualityNotchGroupSvg({ tier: "4K", age: "VM14", marks: ["HDR10+"] }, 17, null, false, "crema", "right")
    const marksOnly = buildQualityNotchGroupSvg({ marks: ["HDR10+", "IMAX"] }, 17, null, false, "crema", "right")
    expect(two.h).toBeGreaterThan(one.h)
    expect(marksOnly.h).toBe(one.h)
    expect(two.svg).toContain('height="1.2"') // filo tra i due piani
    expect(one.svg).not.toContain('height="1.2"')
  })

  it("stacked wraps A/V marks two per floor: taller, never wider", () => {
    const two = buildQualityNotchGroupSvg({ tier: "4K", age: "T", marks: ["DV", "HDR10+"] }, 17, null, false, "crema", "right")
    const three = buildQualityNotchGroupSvg({ tier: "4K", age: "T", marks: ["DV", "HDR10+", "IMAX"] }, 17, null, false, "crema", "right")
    expect(three.h).toBeGreaterThan(two.h)
    expect(three.w).toBe(two.w)
    expect(three.svg.match(/height="1.2"/g)?.length).toBe(1) // un solo filo, sotto il piano tier/età
  })

  it("row = one line, tier in a solid cell on the rounded end (mirrored on the left edge)", () => {
    const right = buildQualityNotchGroupSvg({ tier: "4K", age: "VM14", marks: ["HDR10+"] }, 17, null, false, "crema", "right", "inter", "row")
    const left = buildQualityNotchGroupSvg({ tier: "4K", age: "VM14", marks: ["HDR10+"] }, 17, null, false, "crema", "left", "inter", "row")
    const stacked = buildQualityNotchGroupSvg({ tier: "4K", age: "VM14", marks: ["HDR10+"] }, 17, null, false, "crema", "right")
    expect(right.h).toBeLessThan(stacked.h)
    const cellX = (svg: string) => Number(svg.match(/<rect x="([\d.]+)"[^>]* rx="[^"]*" fill="#1A1A1C"/)?.[1])
    const ageX = (svg: string) => Number(svg.match(/<text x="([\d.]+)"[^>]*>VM14</)?.[1])
    expect(cellX(right.svg)).toBeLessThan(ageX(right.svg))
    expect(cellX(left.svg)).toBeGreaterThan(ageX(left.svg))
  })

  it("mirrors the single notch to the left edge", async () => {
    const g = await renderQualityBadgeGroup("4K", "notch-inchiostro", ["imax"], 500, false, "inter", "VM14", "notch-inchiostro", null, undefined, "left")
    expect(g!.items).toEqual([])
    expect(await alphaAt(g!.png, 0, Math.round(g!.h / 2), g!.w)).toBeGreaterThan(200)
    expect(await alphaAt(g!.png, g!.w - 1, Math.round(g!.h / 2), g!.w)).toBe(0)
  })

  it("lets qgl pick the composition of the single notch", async () => {
    const stacked = await renderQualityBadgeGroup("4K", "notch-crema", ["dv", "atmos", "hdr10plus"], 500, false, "inter", "VM14", "notch-crema", null, "stacked", "right")
    const row = await renderQualityBadgeGroup("4K", "notch-crema", ["dv", "atmos", "hdr10plus"], 500, false, "inter", "VM14", "notch-crema", null, "row", "right")
    expect(row!.items).toEqual([])
    expect(row!.h).toBeLessThan(stacked!.h)
    expect(row!.w).toBeGreaterThan(stacked!.w)
  })

  it("resolves the notch material from either style, quality winning", () => {
    expect(qualityGroupNotchMaterial("notch-vetro", "notch-crema")).toBe("vetro")
    expect(qualityGroupNotchMaterial("standard", "notch-inchiostro")).toBe("inchiostro")
    expect(qualityGroupNotchMaterial("standard", "standard")).toBeNull()
  })
})

describe("separate ratings as one side notch", () => {
  it("glues one linguetta to the chosen edge, with no per-item handles", async () => {
    const { renderSeparateRatingsSideNotch } = await import("@/lib/separate-rating-renderer")
    const items = [{ id: "imdb", value: 8.7 }, { id: "tmdb", value: 8.3 }]
    for (const edge of ["right", "left"] as const) {
      const r = (await renderSeparateRatingsSideNotch(items, 500, false, "crema", edge))!
      expect(r.items).toEqual([])
      const y = Math.round(r.body!.top + r.body!.h / 2)
      const edgeX = edge === "right" ? r.w - 1 : 0
      const innerX = edge === "right" ? 0 : r.w - 1
      expect(await alphaAt(r.png, edgeX, y, r.w)).toBeGreaterThan(200)
      expect(await alphaAt(r.png, innerX, y, r.w)).toBe(0)
    }
    const one = (await renderSeparateRatingsSideNotch(items.slice(0, 1), 500, false, "crema", "right"))!
    const two = (await renderSeparateRatingsSideNotch(items, 500, false, "crema", "right"))!
    expect(two.body!.h).toBeGreaterThan(one.body!.h)
  })
})
