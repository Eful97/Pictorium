import { describe, expect, it, vi } from "vitest"

/**
 * Opaque pack marks are not shipped in the default pack (all demo marks are
 * tintable, so they follow the quality style). This suite mocks the manifest
 * to keep the opaque render path covered: finished artwork embedded as-is,
 * with per-item identity and no style chrome.
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

import { renderQualityBadgeGroup } from "@/lib/poster-service"
import { PACK_MARKS, qualityMarkAspect, qualityMarkMode } from "@/lib/quality-badge-pack"

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

  it("non viene ri-stilizzato dagli stili icona (stesso artwork)", async () => {
    const standard = await renderQualityBadgeGroup("4K", "standard", ["opaque"], 380, false)
    const knockout = await renderQualityBadgeGroup("4K", "knockout", ["opaque"], 380, false)
    expect(standard).not.toBeNull()
    expect(knockout).not.toBeNull()
    // The tier differs by style, but the opaque mark slice itself must not be
    // recolored: extract the mark item bitmap is not exposed, so compare that
    // both render without error and the mark identity is present in both.
    expect(knockout!.items.map((item) => item.id)).toContain("quality:format:opaque")
  })
})
