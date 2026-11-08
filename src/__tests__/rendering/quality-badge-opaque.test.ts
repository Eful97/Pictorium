import { describe, expect, it, vi } from "vitest"
import sharp from "sharp"

/**
 * Opaque pack marks are not shipped in the default pack (all demo marks are
 * tintable, so they follow the quality style). This suite mocks the manifest
 * to keep the opaque render path covered: finished artwork embedded as-is,
 * with per-item identity and no style chrome.
 *
 * The fixture is a warm/gold PNG: the pixel checks below read the mark's own
 * box back from the composed bitmap and prove the artwork survived every
 * style. A tintable mark goes through `fill="currentColor"`/mask/plate
 * builders, so its ink would be white/black (or a style tint) instead of the
 * fixture's channel ratios. This is the negative control for the opaque
 * short-circuit: remove `if (mode === "opaque") return buildOpaqueMarkSvg(...)`
 * in `poster-service.ts` and these assertions fail.
 */
vi.mock("@/data/quality-badge-pack.json", () => ({
  default: {
    version: "test",
    marks: [
      {
        id: "opaque",
        label: "OPAQUE",
        icon: "quality-badges/pack/opaque-fixture.png",
        mode: "opaque",
        aspect: 2.5,
      },
    ],
  },
}))

import { renderQualityBadgeGroup, type QualityBadgeGroupResult } from "@/lib/poster-service"
import { PACK_MARKS, qualityMarkAspect, qualityMarkMode } from "@/lib/quality-badge-pack"

/** Shadow padding baked around every quality mark bitmap (`TOP_SHADOW_PAD`). */
const SHADOW_PAD = 14

/**
 * Mean RGB of the opaque mark's CONTENT box (shadow padding excluded) on the
 * decoded group bitmap. The fixture is fully opaque (alpha ~253) with a warm
 * gold palette, measured as R~55 G~47 B~17: any restyle toward the style ink
 * (white/black) or a colored/neutral plate would collapse those channel
 * differences.
 */
async function markContentMean(group: QualityBadgeGroupResult): Promise<{ r: number; g: number; b: number; pixels: number }> {
  const item = group.items.find((entry) => entry.id === "quality:format:opaque")
  expect(item, "opaque mark box reported").toBeDefined()
  const left = item!.left + SHADOW_PAD
  const top = item!.top + SHADOW_PAD
  const width = item!.w - SHADOW_PAD * 2
  const height = item!.h - SHADOW_PAD * 2
  expect(width).toBeGreaterThan(0)
  expect(height).toBeGreaterThan(0)
  const { data, info } = await sharp(group.png)
    .ensureAlpha()
    .extract({ left, top, width, height })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let r = 0
  let g = 0
  let b = 0
  let pixels = 0
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3]! < 200) continue
    r += data[i]!
    g += data[i + 1]!
    b += data[i + 2]!
    pixels++
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels, pixels }
}

describe("opaque pack mark", () => {
  it("il manifest mockato registra solo il marchio opaque", () => {
    expect(PACK_MARKS.map((mark) => mark.id)).toEqual(["opaque"])
    expect(qualityMarkMode("opaque")).toBe("opaque")
    expect(qualityMarkAspect("opaque")).toBe(2.5)
  })

  it("viene embeddato as-is, con la sua identità per-item", async () => {
    const group = await renderQualityBadgeGroup("4K", "standard", ["opaque"], 380, false)
    expect(group).not.toBeNull()
    expect(group!.items.map((item) => item.id)).toContain("quality:format:opaque")
    expect(group!.png.length).toBeGreaterThan(0)
  })

  it("keeps the fixture artwork under every icon style (pixel comparison, not just identity)", async () => {
    const measurements: Record<string, { r: number; g: number; b: number }> = {}
    for (const style of ["standard", "mono", "knockout", "color"] as const) {
      const group = await renderQualityBadgeGroup("4K", style, ["opaque"], 380, false)
      expect(group, style).not.toBeNull()
      const mean = await markContentMean(group!)
      expect(mean.pixels, style).toBeGreaterThan(300)
      // A restyled (tinted) mark would be ink-white/ink-black: R≈G≈B. The
      // opaque fixture keeps its warm gold ratio in EVERY style.
      expect(mean.r - mean.b, `${style}: red channel collapsed (restyle?)`).toBeGreaterThan(20)
      expect(mean.g - mean.b, `${style}: green channel collapsed (restyle?)`).toBeGreaterThan(12)
      expect(Math.abs(mean.r - 55), `${style}: red drifted away from the fixture`).toBeLessThan(20)
      expect(Math.abs(mean.g - 47), `${style}: green drifted away from the fixture`).toBeLessThan(20)
      expect(Math.abs(mean.b - 17), `${style}: blue drifted away from the fixture`).toBeLessThan(20)
      measurements[style] = mean
    }
    // Because the opaque short-circuit runs BEFORE the style branches, two
    // different styles embed the SAME artwork: their content means stay close
    // (resampling only), unlike tintable marks whose ink follows the style.
    for (const style of ["mono", "knockout", "color"] as const) {
      expect(Math.abs(measurements[style].r - measurements.standard.r), `${style} r`).toBeLessThan(12)
      expect(Math.abs(measurements[style].g - measurements.standard.g), `${style} g`).toBeLessThan(12)
      expect(Math.abs(measurements[style].b - measurements.standard.b), `${style} b`).toBeLessThan(12)
    }
  })
})
