/**
 * Technical preset previews: every starter renders meaningful SVG through
 * the native builders (pure-SVG starters inline, raster recipes as
 * PNG-embedded SVG) — never a blank thumb, never an approximate clone.
 */
import { describe, expect, it } from "vitest"
import { renderTechnicalPresetPreviewSvg } from "@/lib/badge-preset-technical-preview"
import {
  TECHNICAL_FAMILY_STARTERS,
  getTechnicalFamilyMeta,
  type TechnicalFamilyId,
} from "@/lib/badge-preset-technical"
import { normalizeBadgePreset, type BadgePreset } from "@/lib/badge-preset"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"

function housePreset(
  id: string,
  target: BadgePreset["target"],
  house: BadgePreset["house"],
): BadgePreset {
  return normalizeBadgePreset({
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "P", tags: [] },
    variant: "house",
    house,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "00000000",
  })
}

describe("renderTechnicalPresetPreviewSvg", () => {
  it("renders every built-in starter to non-empty SVG", async () => {
    for (const starter of TECHNICAL_FAMILY_STARTERS) {
      const svg = await renderTechnicalPresetPreviewSvg(
        housePreset("Abc123-_XyZ", starter.family, starter.house),
      )
      expect(svg, `starter ${starter.family}/${starter.style}`).toBeTruthy()
      expect(svg).toContain("<svg")
      expect(svg!.length).toBeGreaterThan(200)
    }
  })

  it("returns null for non-technical targets (existing path owns them)", async () => {
    const svg = await renderTechnicalPresetPreviewSvg(
      housePreset("Abc123-_XyZ", "genre", {
        style: "shadow",
        scale: 100,
        polarity: "auto",
      }),
    )
    expect(svg).toBeNull()
  })

  it("differentiates styles within a family (no shared placeholder)", async () => {
    const std = await renderTechnicalPresetPreviewSvg(
      housePreset("Abc123-_XyZ", "quality", { style: "standard", scale: 100, polarity: "auto" }),
    )
    const ko = await renderTechnicalPresetPreviewSvg(
      housePreset("Abc123-_XyZ", "quality", { style: "knockout", scale: 100, polarity: "auto" }),
    )
    expect(std).toBeTruthy()
    expect(ko).toBeTruthy()
    expect(std).not.toBe(ko)
    const column = await renderTechnicalPresetPreviewSvg(
      housePreset("Abc123-_XyZ", "separateRatings", { style: "column", scale: 100, polarity: "auto" }),
    )
    const pills = await renderTechnicalPresetPreviewSvg(
      housePreset("Abc123-_XyZ", "separateRatings", { style: "bottom-pills", scale: 100, polarity: "auto" }),
    )
    expect(column).toBeTruthy()
    expect(pills).toBeTruthy()
    expect(column).not.toBe(pills)
  })

  it("renders custom variants with native content (never an empty badge)", async () => {
    const families: TechnicalFamilyId[] = [
      "quality",
      "age",
      "network",
      "separateRatings",
      "customRatings",
      "comingSoon",
    ]
    for (const family of families) {
      const baseStyle =
        getTechnicalFamilyMeta(family)!.styles[0] ?? "standard"
      const custom = {
        ...housePreset("Abc123-_XyZ", family, {
          style: baseStyle,
          scale: 100,
          polarity: "auto",
        }),
        variant: "custom" as const,
        house: undefined,
        design: {
          shape: "pill",
          padding: { x: 12, y: 6 },
          background: { type: "solid", color: "#cc0000", opacity: 100 },
          text: {
            template: "P",
            color: "#ffffff",
            opacity: 100,
            fontSize: 20,
            fontWeight: 700,
            uppercase: false,
            letterSpacing: 0,
            align: "center",
          },
          scale: 100,
        },
      } as unknown as BadgePreset
      const svg = await renderTechnicalPresetPreviewSvg(custom)
      // comingSoon custom without an explicit label and without live label in
      // this path falls back to the fixture label, so every family renders.
      expect(svg, `custom ${family}`).toBeTruthy()
    }
  })
})
