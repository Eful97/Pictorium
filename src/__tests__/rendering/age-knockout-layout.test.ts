import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  AGE_KNOCKOUT_BG,
  AGE_KNOCKOUT_PAD_X_FACTOR,
  AGE_KNOCKOUT_RADIUS_FACTOR,
  TOP_SHADOW_PAD,
  buildAgeKnockoutSvg,
  buildQualityKnockoutSvg,
} from "@/lib/badge-svg-shared"
import { renderQualityBadgeGroup } from "@/lib/poster-service"
import {
  renderAgeKnockoutBadge,
  renderQualityBadge,
  renderQualityKnockoutBadge,
} from "@/lib/svg-badge"

const PAD = TOP_SHADOW_PAD
const LABELS = ["T", "6+", "14", "VM14", "PG-13", "TV-MA"] as const

/** True when (x,y) lies inside the rounded box (ox,oy,totalW,boxH,r). */
function insideRounded(
  x: number, y: number, ox: number, oy: number, totalW: number, boxH: number, r: number,
): boolean {
  if (x < ox || x >= ox + totalW || y < oy || y >= oy + boxH) return false
  const cx = Math.min(Math.max(x, ox + r), ox + totalW - r)
  const cy = Math.min(Math.max(y, oy + r), oy + boxH - r)
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r
}

describe("age knockout cut-out tag (age-only genuine mask)", () => {
  it("uses comfortable padding, contained radius and an opaque white body", () => {
    expect(AGE_KNOCKOUT_PAD_X_FACTOR).toBe(1.0)
    expect(AGE_KNOCKOUT_RADIUS_FACTOR).toBe(0.3)
    expect(AGE_KNOCKOUT_BG).toBe("#ffffff")
  })

  it("cuts the glyphs out via mask (no opaque text, stabilized + escaped)", () => {
    for (const label of LABELS) {
      const { svg } = buildAgeKnockoutSvg(label, 17)
      // Genuine knockout: white body with the letters cut out.
      expect(svg).toContain("<mask")
      expect(svg).toContain('mask="url(#akm)"')
      expect(svg).toContain(`fill="${AGE_KNOCKOUT_BG}"`)
      // No opaque glyph fill: the letters are mask holes, never painted text.
      expect(svg).not.toContain('fill="#17171c"')
      expect(svg).not.toContain("fill-opacity")
      // Mask glyphs at the normal base fs (no 1.35x oversize of quality).
      expect(svg).toContain('font-size="17"')
      // Stabilized text like every other badge.
      expect(svg).toContain("textLength")
      expect(svg).toContain("lengthAdjust")
    }
    // Escaping preserved (raw markup never lands in the SVG).
    expect(buildAgeKnockoutSvg("A&B", 17).svg).toContain("A&amp;B")
    expect(buildAgeKnockoutSvg("A&B", 17).svg).not.toContain(">A&B<")
    // Font-aware metrics (Inter estimate is the baseline, others rescale).
    expect(buildAgeKnockoutSvg("VM14", 17, "oswald").svg).not.toBe(
      buildAgeKnockoutSvg("VM14", 17, "inter").svg,
    )
  })

  it("keeps the shared stack box model with breathing room vs the quality tag", () => {
    for (const label of LABELS) {
      const fs = 17
      const { svg, w, h } = buildAgeKnockoutSvg(label, fs)
      const m = svg.match(/<rect x="14" y="14" width="(\d+)" height="(\d+)" rx="(\d+)" fill="#ffffff"/)
      expect(m).not.toBeNull()
      const totalW = Number(m![1])
      const boxH = Number(m![2])
      // Same box height as every quality pill (stack placement unchanged).
      expect(boxH).toBe(17 + Math.round(17 * 0.4) * 2)
      expect(w).toBe(totalW + PAD * 2)
      expect(h).toBe(boxH + PAD * 2)
      expect(Number(m![3])).toBe(Math.round(boxH * 0.3))
      // Comfortable margins: full standard padding on both sides.
      const px = Math.round(fs * AGE_KNOCKOUT_PAD_X_FACTOR)
      const textLen = Number(svg.match(/textLength="(\d+)"/)?.[1] ?? "0")
      expect(textLen).toBeGreaterThan(0)
      expect(totalW - textLen).toBeGreaterThanOrEqual(px * 2)
      // Roomier than the original crowded quality knockout (0.75x padding):
      // same label, same height, strictly wider box.
      const crowded = buildQualityKnockoutSvg(label, fs)
      expect(w).toBeGreaterThan(crowded.w)
      expect(h).toBe(crowded.h)
    }
  })

  it("renders genuine cut-out holes (transparent letters on an opaque body)", async () => {
    for (const label of LABELS) {
      const tag = await renderAgeKnockoutBadge(label, 380)
      const { data } = await sharp(tag.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const totalW = tag.w - PAD * 2
      const boxH = tag.h - PAD * 2
      const r = Math.round(boxH * AGE_KNOCKOUT_RADIUS_FACTOR)
      let holes = 0
      let body = 0
      for (let y = PAD; y < PAD + boxH; y++) {
        for (let x = PAD; x < PAD + totalW; x++) {
          if (!insideRounded(x, y, PAD, PAD, totalW, boxH, r)) continue
          const i = (y * tag.w + x) * 4
          if (data[i + 3] < 128) holes++
          if (data[i + 3] > 200 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) body++
        }
      }
      // Letters are see-through holes (poster shows through), the rest of
      // the tag is opaque white. Transparent lettering is intentional.
      expect(holes).toBeGreaterThan(20)
      expect(body).toBeGreaterThan(500)
    }
  }, 30000)

  it("dispatches knockout age to the age-only builder (never the shared quality mask)", async () => {
    const PW = 380
    const group = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", "knockout")
    const ageOnly = await renderAgeKnockoutBadge("VM14", PW, "inter")
    const qualityMask = await renderQualityKnockoutBadge("VM14", PW, "inter")
    expect(group).not.toBeNull()
    expect(group!.png.equals(ageOnly.png)).toBe(true)
    expect(group!.png.equals(qualityMask.png)).toBe(false)
  }, 30000)

  it("keeps the shared quality knockout byte-identical (mask + dispatch untouched)", async () => {
    const PW = 380
    // Builder still cuts glyphs out via mask.
    const { svg } = buildQualityKnockoutSvg("4K", 17)
    expect(svg).toContain("<mask")
    expect(svg).toContain("mask=")
    // Quality-only group still returns the shared knockout bytes directly.
    const group = await renderQualityBadgeGroup("4K", "knockout", null, PW, false, "inter", null, "standard")
    const direct = await renderQualityKnockoutBadge("4K", PW, "inter")
    expect(group).not.toBeNull()
    expect(group!.png.equals(direct.png)).toBe(true)
  }, 30000)

  it("leaves the standard age pill byte-identical", async () => {
    const PW = 380
    const group = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", "standard")
    const direct = await renderQualityBadge("VM14", PW, false, "inter")
    expect(group).not.toBeNull()
    expect(group!.png.equals(direct.png)).toBe(true)
  }, 30000)
})
