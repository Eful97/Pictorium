/**
 * Technical families: schema allowlists, starter inventory, template
 * metadata, pure resolvers and shared preview zoning (no I/O).
 *
 * Covers that every built-in starter reflects an EXISTING native style,
 * validates through the same schema, and that the resolvers stay neutral
 * without a preset (native style/scale/polarity untouched).
 */
import { describe, expect, it } from "vitest"
import {
  badgePresetSchema,
  houseStyleAllowlistForTarget,
  normalizeBadgePreset,
  type BadgePreset,
} from "@/lib/badge-preset"
import {
  getTechnicalFamilyMeta,
  getTechnicalStarter,
  hasTechnicalPreset,
  resolveTechnicalHouseStyle,
  TECHNICAL_FAMILY_IDS,
  TECHNICAL_FAMILY_META,
  TECHNICAL_FAMILY_STARTERS,
  technicalPresetPolarity,
  technicalPresetScale,
  technicalPresetSide,
  type TechnicalFamilyId,
} from "@/lib/badge-preset-technical"
import { zoneForPreset } from "@/lib/badge-preset-templates"

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
    metadata: { name: "Starter", tags: [] },
    variant: "house",
    house,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "00000000",
  })
}

describe("technical house allowlists", () => {
  it("covers all six families with their existing native styles", () => {
    expect(houseStyleAllowlistForTarget("quality")).toEqual(
      expect.arrayContaining(["standard", "mono", "color", "knockout"]),
    )
    expect(houseStyleAllowlistForTarget("age")).toEqual(
      expect.arrayContaining(["standard", "knockout"]),
    )
    expect(houseStyleAllowlistForTarget("network")).toEqual(["pill"])
    expect(houseStyleAllowlistForTarget("separateRatings")).toEqual(
      expect.arrayContaining(["column", "bottom-bar", "bottom-pills", "bottom-mono", "bottom-color"]),
    )
    expect(houseStyleAllowlistForTarget("customRatings")).toEqual(["row"])
    expect(houseStyleAllowlistForTarget("comingSoon")).toEqual(["ribbon"])
  })

  it("accepts house starters for every family and rejects cross-family styles", () => {
    for (const family of TECHNICAL_FAMILY_IDS) {
      const allowed = houseStyleAllowlistForTarget(family) ?? []
      expect(allowed.length).toBeGreaterThan(0)
      const ok = housePreset("Abc123-_XyZ", family, {
        style: allowed[0]!,
        scale: 100,
        polarity: "auto",
      })
      expect(badgePresetSchema.safeParse(ok).success).toBe(true)
      const bad = {
        ...ok,
        house: { style: "netflix", scale: 100, polarity: "auto" as const },
      }
      expect(badgePresetSchema.safeParse(bad).success).toBe(false)
    }
  })

  it("still rejects house presets for unknown targets fail-closed", () => {
    expect(houseStyleAllowlistForTarget("nope")).toBeNull()
  })
})

describe("starter inventory", () => {
  it("has one starter per existing native style and each validates", () => {
    for (const family of TECHNICAL_FAMILY_IDS) {
      const allowed = houseStyleAllowlistForTarget(family) ?? []
      const starters = TECHNICAL_FAMILY_STARTERS.filter((s) => s.family === family)
      expect(starters.map((s) => s.style).sort()).toEqual([...allowed].sort())
      for (const starter of starters) {
        const parsed = badgePresetSchema.safeParse(
          housePreset("Abc123-_XyZ", family, starter.house),
        )
        expect(parsed.success).toBe(true)
        expect(getTechnicalStarter(family, starter.style)?.house).toEqual(starter.house)
      }
    }
  })

  it("starts neutral: scale 100, polarity auto, left ribbon", () => {
    for (const starter of TECHNICAL_FAMILY_STARTERS) {
      expect(starter.house.scale).toBe(100)
      expect(starter.house.polarity).toBe("auto")
    }
    expect(getTechnicalStarter("comingSoon", "ribbon")?.house.side).toBe("left")
  })
})

describe("technical resolvers", () => {
  const quality = (extra: Record<string, unknown> = {}) =>
    housePreset("Qual2222-ccc", "quality", {
      style: "standard",
      scale: 100,
      polarity: "auto",
      ...extra,
    })

  it("resolves the native style only for house presets with allowlisted styles", () => {
    expect(resolveTechnicalHouseStyle("quality", quality())).toBe("standard")
    // Invalid style (never stored — the schema rejects it): fail-closed null.
    const invalid = {
      ...quality(),
      house: { style: "netflix", scale: 100, polarity: "auto" as const },
    } as unknown as BadgePreset
    expect(resolveTechnicalHouseStyle("quality", invalid)).toBeNull()
    expect(resolveTechnicalHouseStyle("quality", null)).toBeNull()
    // A quality preset never leaks into another family.
    expect(resolveTechnicalHouseStyle("age", quality())).toBeNull()
  })

  it("custom variants carry no native style (scale-only, native content kept)", () => {
    const custom = {
      ...quality(),
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
        scale: 150,
      },
    } as unknown as BadgePreset
    expect(resolveTechnicalHouseStyle("quality", custom)).toBeNull()
    expect(technicalPresetScale(custom)).toBe(150)
  })

  it("scale defaults to 100 and polarity/side pass through only when explicit", () => {
    expect(technicalPresetScale(null)).toBe(100)
    expect(technicalPresetScale(quality())).toBe(100)
    expect(technicalPresetScale(quality({ scale: 150 }))).toBe(150)
    expect(technicalPresetPolarity(quality())).toBe("auto")
    expect(technicalPresetPolarity(quality({ polarity: "light" }))).toBe("light")
    expect(technicalPresetPolarity(null)).toBeNull()
    expect(technicalPresetSide(quality())).toBeNull()
    const ribbon = housePreset("CsRibbon-123", "comingSoon", {
      style: "ribbon",
      scale: 100,
      polarity: "auto",
      side: "right",
    })
    expect(technicalPresetSide(ribbon)).toBe("right")
  })

  it("hasTechnicalPreset reflects binding presence", () => {
    expect(hasTechnicalPreset("quality", null)).toBe(false)
    expect(hasTechnicalPreset("quality", {})).toBe(false)
    expect(hasTechnicalPreset("quality", { quality: quality() })).toBe(true)
  })
})

describe("technical template metadata", () => {
  it("covers all six families with an honest support matrix", () => {
    expect(TECHNICAL_FAMILY_META.map((m) => m.family).sort()).toEqual(
      [...TECHNICAL_FAMILY_IDS].sort(),
    )
    for (const meta of TECHNICAL_FAMILY_META) {
      expect(meta.styles.length).toBeGreaterThan(0)
      expect(meta.nativeGuarantee.length).toBeGreaterThan(0)
      expect(getTechnicalFamilyMeta(meta.family as TechnicalFamilyId)).toEqual(meta)
    }
    const quality = getTechnicalFamilyMeta("quality")!
    expect(quality.supports.style).toBe(true)
    expect(quality.supports.scale).toBe(true)
    const comingSoon = getTechnicalFamilyMeta("comingSoon")!
    expect(comingSoon.supports.side).toBe(true)
    expect(comingSoon.supports.scale).toBe(false)
  })
})

describe("technical preview zoning", () => {
  it("zones technical presets like their native slots", () => {
    expect(
      zoneForPreset({ variant: "house", target: "comingSoon", house: { style: "ribbon", scale: 100, polarity: "auto" } }),
    ).toBe("top-ribbon")
    expect(
      zoneForPreset({ variant: "house", target: "quality", house: { style: "standard", scale: 100, polarity: "auto" } }),
    ).toBe("top-center")
    expect(
      zoneForPreset({ variant: "house", target: "separateRatings", house: { style: "bottom-bar", scale: 100, polarity: "auto" } }),
    ).toBe("genre-bar")
    expect(
      zoneForPreset({ variant: "house", target: "separateRatings", house: { style: "column", scale: 100, polarity: "auto" } }),
    ).toBe("genre")
  })
})
