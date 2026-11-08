import { describe, expect, it, vi } from "vitest"

/**
 * The shipped pack is empty by default (no per-title source for these marks).
 * This suite mocks the manifest with the vendored demo fixtures to keep the
 * tintable render path covered: style dispatch, per-item identity and byte
 * differences between marks. `quality-badge-opaque.test.ts` covers the opaque
 * path the same way.
 */
vi.mock("@/data/quality-badge-pack.json", () => ({
  default: {
    version: "test",
    marks: [
      {
        id: "remux",
        label: "REMUX",
        icon: "quality-badges/pack/remux.svg",
        mode: "tintable",
        inkBox: { x: 25.9, y: 14.9, w: 149.5, h: 29.5 },
        accent: "gold",
        gradientStops: ["#FF2D2D", "#FFB800"],
      },
      {
        id: "tenbit",
        label: "10-BIT",
        icon: "quality-badges/pack/tenbit.svg",
        mode: "tintable",
        inkBox: { x: 43.12, y: 14.42, w: 134.42, h: 30.28 },
        accent: "cyan",
        gradientStops: ["#22D3EE", "#A3E635"],
      },
      {
        id: "av1",
        label: "AV1",
        icon: "quality-badges/pack/av1.svg",
        mode: "tintable",
        inkBox: { x: 36, y: 14.85, w: 74.4, h: 29.17 },
        accent: "gold",
        gradientStops: ["#3B82F6", "#22D3EE"],
      },
    ],
  },
}))

import { renderQualityBadgeGroup } from "@/lib/poster-service"
import { PACK_MARKS, PACK_MARK_IDS, isPackMark, qualityMarkIconPath, qualityMarkLabel } from "@/lib/quality-badge-pack"

describe("tintable pack marks (mocked manifest)", () => {
  it("registra i marchi del pack", () => {
    expect(PACK_MARK_IDS).toEqual(["remux", "tenbit", "av1"])
    expect(isPackMark("remux")).toBe(true)
    expect(qualityMarkIconPath("remux")).toBe("quality-badges/pack/remux.svg")
    expect(qualityMarkLabel("tenbit")).toBe("10-BIT")
  })

  it("renderizza un marchio con la sua identità per-item", async () => {
    const group = await renderQualityBadgeGroup("4K", "standard", ["remux"], 380, false)
    expect(group).not.toBeNull()
    expect(group!.items.map((item) => item.id)).toContain("quality:format:remux")
    expect(group!.png.length).toBeGreaterThan(0)
  })

  it("marchi diversi producono bitmap diversi", async () => {
    const a = await renderQualityBadgeGroup("4K", "standard", ["remux"], 380, false)
    const b = await renderQualityBadgeGroup("4K", "standard", ["tenbit"], 380, false)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(Buffer.compare(a!.png, b!.png)).not.toBe(0)
  })

  it("ogni stile icona applica il proprio materiale senza errori", async () => {
    const id = PACK_MARKS[0].id
    for (const style of ["mono", "color", "premium", "knockout", "naked", "strip", "gradient", "nova", "outline"] as const) {
      const group = await renderQualityBadgeGroup("4K", style, [id], 380, false)
      expect(group, style).not.toBeNull()
      expect(group!.png.length, style).toBeGreaterThan(0)
    }
  })
})
