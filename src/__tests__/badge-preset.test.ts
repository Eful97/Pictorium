import { describe, it, expect } from "vitest"
import {
  badgeDesignSchema,
  badgePresetSchema,
  computePresetFullRevision,
  computePresetRevision,
  generateBadgePresetId,
  isBadgePresetId,
  normalizeBadgeDesign,
  normalizeBadgePreset,
  presetJsonSizeBytes,
  scaleBadgeDesign,
  type BadgeDesign,
  type BadgePreset,
} from "@/lib/badge-preset"
import { resolveBadgeText } from "@/lib/badge-variables"

const design: BadgeDesign = {
  shape: "pill",
  padding: { x: 12, y: 6 },
  background: { type: "solid", color: "#FF0000", opacity: 90 },
  text: {
    template: "★ {{rating}}",
    color: "#FFFFFF",
    opacity: 100,
    fontSize: 20,
    fontWeight: 700,
    uppercase: false,
    letterSpacing: 0,
    align: "center",
  },
  scale: 100,
}

const preset: BadgePreset = {
  version: 1,
  id: "Abc123-_XyZ",
  ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
  target: "top",
  visibility: "public",
  metadata: { name: "My preset", tags: ["gold"] },
  variant: "custom",
  design,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  revision: computePresetFullRevision("custom", design, undefined),
}

describe("badge-preset schema", () => {
  it("accepts a valid preset", () => {
    expect(badgePresetSchema.safeParse(preset).success).toBe(true)
  })

  it("accepts a valid design with gradient/border/shadow", () => {
    const full: BadgeDesign = {
      ...design,
      shape: "rect",
      width: 200,
      height: 48,
      radius: 8,
      background: {
        type: "gradient",
        opacity: 80,
        gradient: { from: "#111111", to: "#222222", direction: "diagonal" },
      },
      border: { enabled: true, width: 2, color: "#ffffff", opacity: 50 },
      shadow: { enabled: true, blur: 8, offsetX: 2, offsetY: 3, opacity: 60 },
    }
    expect(badgeDesignSchema.safeParse(full).success).toBe(true)
  })

  it("rejects bad shapes, colors, sizes and injection", () => {
    expect(badgeDesignSchema.safeParse({ ...design, shape: "circle" }).success).toBe(false)
    expect(badgeDesignSchema.safeParse({ ...design, text: { ...design.text, color: "red" } }).success).toBe(false)
    expect(
      badgeDesignSchema.safeParse({ ...design, text: { ...design.text, template: "<script>alert(1)</script>".repeat(10) } })
        .success,
    ).toBe(false)
    expect(badgeDesignSchema.safeParse({ ...design, width: 5000 }).success).toBe(false)
    expect(badgeDesignSchema.safeParse({ ...design, text: { ...design.text, fontSize: 200 } }).success).toBe(false)
    // Raw CSS / URL payloads are not part of the schema: strict objects drop them.
    expect(badgeDesignSchema.safeParse({ ...design, css: "x{color:red}", url: "https://evil/x.svg" }).success).toBe(false)
  })

  it("rejects bad ids, names, tags and overflows", () => {
    expect(badgePresetSchema.safeParse({ ...preset, id: "short" }).success).toBe(false)
    expect(badgePresetSchema.safeParse({ ...preset, id: "has space!!" }).success).toBe(false)
    expect(badgePresetSchema.safeParse({ ...preset, metadata: { name: "", tags: [] } }).success).toBe(false)
    expect(badgePresetSchema.safeParse({ ...preset, metadata: { name: "x".repeat(61), tags: [] } }).success).toBe(false)
    expect(
      badgePresetSchema.safeParse({ ...preset, metadata: { name: "ok", tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] } })
        .success,
    ).toBe(false)
    expect(badgePresetSchema.safeParse({ ...preset, ownerUuid: "not-a-uuid" }).success).toBe(false)
    expect(badgePresetSchema.safeParse({ ...preset, revision: "XYZ" }).success).toBe(false)
  })
})

describe("preset revision + normalizer", () => {
  it("is deterministic and changes when the design changes", () => {
    const a = computePresetRevision(design)
    const b = computePresetRevision(structuredClone(design))
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(b).toBe(a)
    expect(computePresetRevision({ ...design, scale: 120 })).not.toBe(a)
  })

  it("canonicalizes colors and recomputes revision", () => {
    const norm = normalizeBadgeDesign(design)
    expect(norm.background.color).toBe("#ff0000")
    expect(norm.text.color).toBe("#ffffff")
    const p = normalizeBadgePreset({ ...preset, metadata: { name: "  Spaced  ", tags: ["Gold Tag", "!!!", "ok-tag"] } })
    expect(p.metadata.name).toBe("Spaced")
    expect(p.metadata.tags).toContain("gold-tag")
    expect(p.metadata.tags).toContain("ok-tag")
    expect(p.revision).toBe(computePresetFullRevision(p.variant ?? "custom", p.design, p.house))
  })

  it("generates ids and validates query ids", () => {
    const id = generateBadgePresetId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(isBadgePresetId(preset.id)).toBe(true)
    expect(isBadgePresetId("short")).toBe(false)
    expect(isBadgePresetId("https://evil/x")).toBe(false)
  })

  it("stays under the 16KB payload quota", () => {
    expect(presetJsonSizeBytes(preset)).toBeLessThan(16 * 1024)
  })
})

describe("house presets", () => {
  const houseBase = {
    version: 1 as const,
    id: "Abc123-_XyZ",
    ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
    visibility: "public" as const,
    metadata: { name: "House", tags: [] as string[] },
    variant: "house" as const,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "deadbeef",
  }

  it("accepts a top netflix house preset", () => {
    const p = {
      ...houseBase,
      target: "top" as const,
      house: { style: "netflix", label: "Oggi", scale: 100, polarity: "auto" as const },
    }
    expect(badgePresetSchema.safeParse(p).success).toBe(true)
  })

  it("rejects a genre style on the top slot and vice versa", () => {
    const topBar = {
      ...houseBase,
      target: "top" as const,
      house: { style: "bar", scale: 100, polarity: "auto" as const },
    }
    expect(badgePresetSchema.safeParse(topBar).success).toBe(false)
    const genreNetflix = {
      ...houseBase,
      target: "genre" as const,
      house: { style: "netflix", scale: 100, polarity: "auto" as const },
    }
    expect(badgePresetSchema.safeParse(genreNetflix).success).toBe(false)
  })

  it("requires the matching payload per variant", () => {
    const houseNoPayload = { ...houseBase, target: "top" as const }
    expect(badgePresetSchema.safeParse(houseNoPayload).success).toBe(false)
    const customNoDesign = { ...preset, design: undefined }
    expect(badgePresetSchema.safeParse(customNoDesign).success).toBe(false)
  })

  it("normalizes house payloads and covers them in the revision", () => {
    const p = normalizeBadgePreset({
      ...houseBase,
      target: "genre" as const,
      house: { style: "pill ", scale: 100.6, polarity: "auto" as const },
    } as unknown as BadgePreset)
    expect(p.house?.scale).toBe(101)
    expect(p.house?.showGenre).toBe(true)
    expect(p.revision).toBe(computePresetFullRevision("house", undefined, p.house))
    expect(p.revision).not.toBe(computePresetFullRevision("custom", design, undefined))
  })
})

describe("badge variables", () => {
  it("resolves known tokens and drops unknown/missing ones", () => {
    expect(resolveBadgeText("★ {{rating}} • {{year}}", { rating: 8.2, year: 2024 })).toBe("★ 8.2 • 2024")
    expect(resolveBadgeText("#{{rank}} {{genre}}", { rank: 3, genre: "Drama" })).toBe("#3 Drama")
    expect(resolveBadgeText("a {{nope}} b", {})).toBe("a b")
    expect(resolveBadgeText("★ {{rating}}", {})).toBe("★")
    expect(resolveBadgeText("{{imdb}} / {{tmdb}}", { imdb: "tt123", tmdb: 456 })).toBe("tt123 / 456")
  })
})

describe("scaleBadgeDesign", () => {
  it("scales absolute fields and leaves enums/colors/scale alone", () => {
    const scaled = scaleBadgeDesign(design, 2)
    expect(scaled.text.fontSize).toBe(40)
    expect(scaled.padding).toEqual({ x: 24, y: 12 })
    expect(scaled.shape).toBe("pill")
    expect(scaled.background.color).toBe("#FF0000")
    expect(scaled.scale).toBe(100)
    expect(scaled.text.template).toBe(design.text.template)
  })

  it("is identity at factor 1", () => {
    expect(scaleBadgeDesign(design, 1)).toEqual(design)
  })
})
