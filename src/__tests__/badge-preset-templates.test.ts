import { describe, expect, it } from "vitest"
import {
  badgePresetSchema,
  normalizeBadgePreset,
  normalizeHouseBadge,
} from "@/lib/badge-preset"
import {
  buildHouseGenreSvg,
  buildHousePresetSvg,
  buildNetflixRankBadgeSVG,
} from "@/lib/badge-svg-shared"
import {
  BADGE_PRESET_TEMPLATES,
  presetPreviewZone,
  zoneForPreset,
} from "@/lib/badge-preset-templates"

const MOCK = { rating: "8.5", year: "2024", genre: "Dramma", rank: "3" } as const
const DARK = { topLight: false, bottomLight: false, accentColor: "#555555", side: "left" } as const

describe("house starter templates", () => {
  it("has unique keys and label keys", () => {
    const keys = BADGE_PRESET_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const t of BADGE_PRESET_TEMPLATES) {
      expect(t.labelKey).toMatch(/^ui\.labTpl[A-Z]/)
    }
  })

  it("covers both slot targets", () => {
    const targets = new Set(BADGE_PRESET_TEMPLATES.map((t) => t.target))
    expect(targets).toEqual(new Set(["top", "genre"]))
  })

  it("every house payload normalizes and validates as a full preset", () => {
    for (const t of BADGE_PRESET_TEMPLATES) {
      const house = normalizeHouseBadge({ ...t.house })
      const preset = normalizeBadgePreset({
        version: 1,
        id: "Abc123-_XyZ",
        ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
        target: t.target,
        visibility: "public",
        metadata: { name: "Starter", tags: [] },
        variant: "house",
        design: undefined,
        house,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
        revision: "deadbeef",
      })
      expect(badgePresetSchema.safeParse(preset).success, t.key).toBe(true)
      expect(preset.variant, t.key).toBe("house")
    }
  })

  it("every starter renders non-empty SVG with mock context", () => {
    for (const t of BADGE_PRESET_TEMPLATES) {
      const r = buildHousePresetSvg(
        { variant: "house", target: t.target, house: t.house },
        MOCK,
        380,
        { ...DARK },
      )
      expect(r, `${t.key} renders null`).not.toBeNull()
      expect(r!.svg.includes("<svg"), t.key).toBe(true)
      expect(r!.w, t.key).toBeGreaterThan(0)
      expect(r!.h, t.key).toBeGreaterThan(0)
    }
  })

  it("genre bar starter spans the full poster width", () => {
    const bar = BADGE_PRESET_TEMPLATES.find((t) => t.key === "genre-bar")
    expect(bar).toBeDefined()
    const r = buildHousePresetSvg({ variant: "house", target: "genre", house: bar!.house }, MOCK, 380, {
      ...DARK,
    })
    expect(r!.w).toBe(380)
  })

  it("starter SVG matches the direct house builder byte-for-byte", () => {    const pill = BADGE_PRESET_TEMPLATES.find((t) => t.key === "genre-pill")
    const direct = buildHouseGenreSvg({
      genreName: "Dramma",
      voteStr: "8.5",
      yearStr: "2024",
      pw: 380,
      style: "pill",
      accentColor: "#555555",
      bottomLight: false,
      parts: { showGenre: true, showYear: true, showRating: true },
      scale: 100,
    })
    const via = buildHousePresetSvg({ variant: "house", target: "genre", house: pill!.house }, MOCK, 380, {
      ...DARK,
    })
    expect(via!.svg).toBe(direct.svg)
    const netflix = BADGE_PRESET_TEMPLATES.find((t) => t.key === "top-netflix")
    const directRibbon = buildNetflixRankBadgeSVG(3, 380, false, "left", undefined, "Oggi")
    const viaRibbon = buildHousePresetSvg(
      { variant: "house", target: "top", house: netflix!.house },
      MOCK,
      380,
      { ...DARK },
    )
    expect(viaRibbon!.svg).toBe(directRibbon.svg)
  })
})

describe("house badge viewBox + accent", () => {
  it("every starter SVG carries a viewBox so the browser can scale it", () => {
    for (const t of BADGE_PRESET_TEMPLATES) {
      const r = buildHousePresetSvg({ variant: "house", target: t.target, house: t.house }, MOCK, 380, {
        ...DARK,
      })
      expect(r!.svg, t.key).toContain(`viewBox="0 0 ${r!.w} ${r!.h}"`)
    }
  })

  it("accent override changes the colored render and the revision", () => {
    const base = { style: "colored", label: "Oggi", scale: 100, polarity: "auto" as const }
    const plain = buildHousePresetSvg({ variant: "house", target: "top", house: base }, MOCK, 380, { ...DARK })
    const accented = buildHousePresetSvg(
      { variant: "house", target: "top", house: { ...base, accent: "#e74c3c" } },
      MOCK,
      380,
      { ...DARK },
    )
    expect(accented!.svg).not.toBe(plain!.svg)
    expect(accented!.svg).toContain("#e74c3c")
  })

  it("rejects a non-hex accent", () => {
    expect(
      badgePresetSchema.safeParse({
        version: 1,
        id: "Abc123-_XyZ",
        ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
        target: "top",
        visibility: "public",
        metadata: { name: "X", tags: [] },
        variant: "house",
        house: { style: "colored", scale: 100, polarity: "auto", accent: "red" },
        createdAt: 1,
        updatedAt: 1,
        revision: "deadbeef",
      }).success,
    ).toBe(false)
  })
})

describe("house badge editable knobs", () => {
  const pill = { style: "pill", scale: 100, polarity: "auto" as const }

  it("rankOverride wins over live rank (and works without one)", () => {
    const r = buildHousePresetSvg(
      { variant: "house", target: "top", house: { ...pill, label: "Top", rankOverride: 7 } },
      {},
      380,
      { ...DARK },
    )
    expect(r!.svg).toContain("#7 Top")
  })

  it("side right mirrors the netflix ribbon", () => {
    const left = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "netflix", label: "Oggi", scale: 100, polarity: "auto" } },
      MOCK,
      380,
      { ...DARK },
    )
    const right = buildHousePresetSvg(
      {
        variant: "house",
        target: "top",
        house: { style: "netflix", label: "Oggi", scale: 100, polarity: "auto", side: "right" },
      },
      MOCK,
      380,
      { ...DARK },
    )
    expect(right!.svg).not.toBe(left!.svg)
    expect(right!.w).toBe(left!.w)
  })

  it("genre segment overrides replace live data", () => {
    const r = buildHousePresetSvg(
      {
        variant: "house",
        target: "genre",
        house: { ...pill, genreText: "Horror", ratingText: "9.1", yearText: "1999" },
      },
      MOCK,
      380,
      { ...DARK },
    )
    expect(r!.svg).toContain("Horror")
    expect(r!.svg).toContain("9.1")
    expect(r!.svg).toContain("1999")
    expect(r!.svg).not.toContain("Dramma")
  })

  it("override with unknown variable falls back to live data", () => {
    const r = buildHousePresetSvg(
      { variant: "house", target: "genre", house: { ...pill, genreText: "{{nope}}" } },
      MOCK,
      380,
      { ...DARK },
    )
    expect(r!.svg).toContain("Dramma")
  })

  it("rejects out-of-range rank and overlong texts", () => {
    const base = {
      version: 1,
      id: "Abc123-_XyZ",
      ownerUuid: "123e4567-e89b-12d3-a456-426614174000",
      target: "top" as const,
      visibility: "public" as const,
      metadata: { name: "X", tags: [] as string[] },
      variant: "house" as const,
      createdAt: 1,
      updatedAt: 1,
      revision: "deadbeef",
    }
    expect(
      badgePresetSchema.safeParse({ ...base, house: { style: "pill", scale: 100, polarity: "auto", rankOverride: 0 } })
        .success,
    ).toBe(false)
    expect(
      badgePresetSchema.safeParse({ ...base, house: { style: "pill", scale: 100, polarity: "auto", rankOverride: 501 } })
        .success,
    ).toBe(false)
    expect(
      badgePresetSchema.safeParse({
        ...base,
        target: "genre" as const,
        house: { style: "pill", scale: 100, polarity: "auto", genreText: "x".repeat(31) },
      }).success,
    ).toBe(false)
    expect(
      badgePresetSchema.safeParse({
        ...base,
        house: { style: "netflix", scale: 100, polarity: "auto", side: "up" },
      }).success,
    ).toBe(false)
  })
})

describe("zoneForPreset", () => {
  it("maps house styles to the server slot layout", () => {
    expect(zoneForPreset({ target: "top", variant: "house", house: { style: "netflix", scale: 100, polarity: "auto" } })).toBe(
      "top-ribbon",
    )
    expect(zoneForPreset({ target: "top", variant: "house", house: { style: "pill", scale: 100, polarity: "auto" } })).toBe(
      "top-center",
    )
    expect(
      zoneForPreset({ target: "top", variant: "house", house: { style: "netflix-color", scale: 100, polarity: "auto" } }),
    ).toBe("top-ribbon")
    expect(zoneForPreset({ target: "genre", variant: "house", house: { style: "bar", scale: 100, polarity: "auto" } })).toBe(
      "genre-bar",
    )
    expect(zoneForPreset({ target: "genre", variant: "house", house: { style: "vetro", scale: 100, polarity: "auto" } })).toBe(
      "genre",
    )
  })

  it("keeps the custom shape mapping", () => {
    expect(presetPreviewZone("top", "ribbon")).toBe("top-ribbon")
    expect(presetPreviewZone("top", "pill")).toBe("top-center")
    expect(presetPreviewZone("genre", "bar")).toBe("genre-bar")
    expect(presetPreviewZone("genre", "pill")).toBe("genre")
  })
})
