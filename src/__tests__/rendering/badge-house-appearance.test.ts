import { describe, expect, it } from "vitest"
import { Resvg } from "@resvg/resvg-js"
import sharp from "sharp"
import { FONT_FILES } from "@/lib/fonts"
import { BADGE_PRESET_TEMPLATES } from "@/lib/badge-preset-templates"
import { buildCustomBadgeSvg, buildHouseExtraSvg, buildHouseGenreSvg, buildHouseRankingSvg, buildHousePresetSvg, HOUSE_EXTRA_PREVIEW_LABEL } from "@/lib/badge-svg-shared"
import { computePresetFullRevision, normalizeHouseBadge, houseBadgeSchema } from "@/lib/badge-preset"
import { applyHouseAppearance } from "@/lib/badge-house-appearance"

const context = { genre: "Drama", rating: "8.5", year: "2024", rank: "3" }
const scene = { topLight: false, bottomLight: false, accentColor: "#ef4444", side: "left" as const }
const render = (svg: string) => new Resvg(svg, { font: { fontFiles: [...FONT_FILES], loadSystemFonts: false } }).render().asPng()

describe("all house recipes and appearance overrides", () => {
  it("keeps the house body box fixed while shadow settings change (layout contract)", () => {
    const bodies = []
    const svgs = []
    for (const [enabled, blur, offsetX, offsetY] of [[false, 0, 0, 0], [true, 4, 0, 3], [true, 40, -50, 50], [true, 0, 50, -50]] as const) {
      const shadow = { enabled, blur, offsetX, offsetY, opacity: 70 }
      const badge = buildHousePresetSvg({ variant: "house", target: "top", house: { style: "pill", scale: 100, polarity: "auto", appearance: { background: { type: "solid", color: "#ff0000", opacity: 100 }, shadow } } }, context, 380, scene)!
      bodies.push({ w: badge.layout?.w ?? badge.w, h: badge.layout?.h ?? badge.h })
      svgs.push(badge.svg)
    }
    // The shadow pads the canvas but never resizes the body box (the Lab
    // preview crops to it; placement math uses it).
    for (const body of bodies) expect(body).toEqual(bodies[0])
    // The pill recipe carries its own baked shadow; the appearance shadow
    // adds the lab-effects filter only when enabled.
    expect(svgs[0]).not.toContain('id="lab-effects"')
    for (const svg of svgs.slice(1)) expect(svg).toContain('id="lab-effects"')
  })
  it("keeps the custom body box fixed while the shadow pads around it", () => {
    const svgs = []
    for (const [enabled, blur, offsetX, offsetY] of [[false, 0, 0, 0], [true, 4, 0, 3], [true, 40, -50, 50], [true, 0, 50, -50]] as const) {
      const shadow = { enabled, blur, offsetX, offsetY, opacity: 70 }
      const badge = buildCustomBadgeSvg({ shape: "pill", scale: 100, padding: { x: 14, y: 7 }, background: { type: "solid", color: "#ff0000", opacity: 100 }, text: { template: "", color: "#ffffff", opacity: 100, fontSize: 22, fontWeight: 700, uppercase: false, letterSpacing: 0, align: "center" }, shadow }, "TEST")
      svgs.push(badge.svg)
    }
    expect(svgs[0]).not.toContain("feDropShadow")
    for (const svg of svgs.slice(1)) expect(svg).toContain("feDropShadow")
    // Same text/padding/scale: identical body size, only the canvas offset grows.
    const rects = svgs.map((svg) => svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"/)?.slice(1, 6))
    for (const rect of rects) {
      expect(rect?.[2]).toBe(rects[0]?.[2])
      expect(rect?.[3]).toBe(rects[0]?.[3])
      expect(rect?.[4]).toBe(rects[0]?.[4])
    }
  })
  it("all starters match the actual poster dispatch on dark and light scenes", () => {
    for (const template of BADGE_PRESET_TEMPLATES) for (const light of [false, true]) {
      const isExtra = template.target === "extra"
      const result = buildHousePresetSvg({ variant: "house", target: template.target, house: template.house }, context, 380, { ...scene, topLight: light, bottomLight: light }, isExtra ? "extra" : null, HOUSE_EXTRA_PREVIEW_LABEL)
      const direct = template.target === "genre"
        ? buildHouseGenreSvg({ genreName: "Drama", voteStr: "8.5", yearStr: "2024", pw: 380, style: template.house.style as "pill", accentColor: scene.accentColor, bottomLight: light, parts: { showGenre: true, showRating: true, showYear: true }, scale: 100 })
        : isExtra
          ? buildHouseExtraSvg({ label: HOUSE_EXTRA_PREVIEW_LABEL, pw: 380, style: template.house.style as "pill", accentColor: scene.accentColor, topLight: light })
          // Lo starter `top-colored-plate` e la placca nativa (ribbon: false):
          // il riferimento diretto dichiara lo stesso ribbon del template,
          // altrimenti diverge sul nastro legacy. `top-colored` senza chiave
          // resta il nastro (undefined = legacy, mai migrazione in lettura).
          : buildHouseRankingSvg({ rank: 3, label: "Oggi", pw: 380, style: template.house.style as "pill", accentColor: scene.accentColor, topLight: light, side: "left", ribbon: template.house.ribbon })
      expect(result, template.key).toEqual(direct)
      expect(buildHousePresetSvg({ variant: "house", target: template.target, house: { ...template.house, appearance: {} } }, context, 380, { ...scene, topLight: light, bottomLight: light }, isExtra ? "extra" : null, HOUSE_EXTRA_PREVIEW_LABEL)).toEqual(direct)
    }
  })

  it("colored Netflix is a colored ribbon, and bar/ribbon text overrides work", () => {
    // Legacy netflix-color has no ribbon branch in the builder: it renders
    // the centered default plate (same truth as the poster dispatch).
    for (const style of ["netflix", "colored"]) {
      const svg = buildHousePresetSvg({ variant: "house", target: "top", house: { style, scale: 100, polarity: "auto", textColor: "#123456", textOpacity: 50 } }, context, 380, scene)!.svg
      expect(svg).toContain(">TOP</text>")
      expect(svg).toContain("rgba(18,52,86,0.5)")
      if (style !== "netflix") expect(svg).toContain('fill="#ef4444"')
    }
    const legacy = buildHousePresetSvg({ variant: "house", target: "top", house: { style: "netflix-color", scale: 100, polarity: "auto", textColor: "#123456", textOpacity: 50 } }, context, 380, scene)!.svg
    expect(legacy).toContain("rgba(18,52,86,0.5)")
    expect(legacy).not.toContain(">TOP</text>")
    expect(buildHousePresetSvg({ variant: "house", target: "genre", house: { style: "bar", scale: 100, polarity: "auto", textColor: "#123456", textOpacity: 50 } }, context, 380, scene)!.svg).toContain("rgba(18,52,86,0.5)")
  })

  it("every customized style rasterizes with correct dimensions; overrides survive normalization and change revisions", async () => {
    for (const template of BADGE_PRESET_TEMPLATES) {
      const house = normalizeHouseBadge({ ...template.house, appearance: {
        widthScale: 130, heightScale: 120, brightness: 85, contrast: 115, saturation: 70, opacity: 90,
        background: { type: "gradient", opacity: 80, gradient: { from: "#123456", to: "#abcdef", direction: "diagonal" } },
        border: { enabled: true, width: 3, color: "#fedcba", opacity: 75 },
        shadow: { enabled: true, blur: 5, offsetX: -8, offsetY: 4, opacity: 60 },
        fontWeight: 400, letterSpacing: 1, textOffsetX: 2, textOffsetY: 3, radius: 6,
      } })
      expect(computePresetFullRevision("house", null, house)).not.toBe(computePresetFullRevision("house", null, template.house))
      const isExtra = template.target === "extra"
      const badge = buildHousePresetSvg({ variant: "house", target: template.target, house }, context, 380, scene, isExtra ? "extra" : null, HOUSE_EXTRA_PREVIEW_LABEL)!
      const metadata = await sharp(render(badge.svg)).metadata()
      expect(metadata.width, template.key).toBe(badge.w)
      expect(metadata.height, template.key).toBe(badge.h)
      expect(badge.svg).toContain('stroke="#fedcba"')
      expect(badge.svg).toContain('font-weight="400"')
      expect(JSON.parse(JSON.stringify(house)).appearance).toEqual(house.appearance)
    }
    expect(houseBadgeSchema.safeParse({ style: "pill", scale: 100, polarity: "auto", appearance: { brightness: 201 } }).success).toBe(false)
    expect(houseBadgeSchema.safeParse({ style: "pill", scale: 100, polarity: "auto", appearance: { background: { type: "solid", opacity: 100, color: 'url(#evil)' } } }).success).toBe(false)
    const plain = buildHousePresetSvg({ variant: "house", target: "top", house: { style: "pill", scale: 100, polarity: "auto" } }, context, 380, scene)!
    expect(applyHouseAppearance(plain, { background: { type: "gradient", opacity: 100, gradient: { from: '"><svg>', to: "#ffffff", direction: "vertical" } } }, 1)).toBe(plain)
  })

  it("brightness changes actual pixels and zero opacity makes the entire badge transparent", async () => {
    const preset = { variant: "house" as const, target: "top" as const, house: { style: "pill", scale: 100, polarity: "auto" as const } }
    const pixels = async (brightness: number, opacity = 100) => sharp(render(buildHousePresetSvg({ ...preset, house: { ...preset.house, appearance: { brightness, opacity } } }, context, 380, scene)!.svg)).ensureAlpha().raw().toBuffer()
    const bright = await pixels(100), dark = await pixels(20), invisible = await pixels(100, 0)
    expect(dark.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : v), 0)).toBeLessThan(bright.reduce((n, v, i) => n + (i % 4 === 3 ? 0 : v), 0))
    expect(invisible.every((value, i) => i % 4 !== 3 || value === 0)).toBe(true)
  })
})
