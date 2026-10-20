import { describe, expect, it } from "vitest"
import {
  badgePresetSchema,
  normalizeBadgePreset,
  normalizeHouseBadge,
} from "@/lib/badge-preset"
import {
  applyFillOpacity,
  buildHouseGenreSvg,
  buildHousePresetSvg,
  buildNetflixRankBadgeSVG,
  HOUSE_EXTRA_PREVIEW_LABEL,
} from "@/lib/badge-svg-shared"
import {
  BADGE_PRESET_TEMPLATES,
  presetPreviewZone,
  zoneForPreset,
} from "@/lib/badge-preset-templates"

const MOCK = { rating: "8.5", year: "2024", genre: "Dramma", rank: "3" } as const
const DARK = { topLight: false, bottomLight: false, accentColor: "#555555", side: "left" } as const

describe("house text overrides", () => {
  const genreBase = {
    variant: "house" as const,
    target: "genre" as const,
    house: { style: "pill", showGenre: true, showYear: true, showRating: true, scale: 100, polarity: "auto" as const },
  }
  const topBase = {
    variant: "house" as const,
    target: "top" as const,
    house: { style: "pill", scale: 100, polarity: "auto" as const },
  }

  it("absent overrides render the recipe result (byte-identical)", () => {
    const plain = buildHousePresetSvg(genreBase, MOCK, 380, DARK)
    const explicitAuto = buildHousePresetSvg(
      { ...genreBase, house: { ...genreBase.house, fontSize: undefined, textColor: undefined } },
      MOCK,
      380,
      DARK,
    )
    expect(plain?.svg).toBe(explicitAuto?.svg)
    const topPlain = buildHousePresetSvg(topBase, MOCK, 380, DARK)
    const topAuto = buildHousePresetSvg(
      { ...topBase, house: { ...topBase.house, fontSize: undefined, textColor: undefined } },
      MOCK,
      380,
      DARK,
    )
    expect(topPlain?.svg).toBe(topAuto?.svg)
  })

  it("fontSize changes geometry, textColor changes fill (genre + top)", () => {
    const base = buildHousePresetSvg(genreBase, MOCK, 380, DARK)
    const small = buildHousePresetSvg(
      { ...genreBase, house: { ...genreBase.house, fontSize: 16 } },
      MOCK,
      380,
      DARK,
    )
    expect(small?.svg).not.toBe(base?.svg)
    expect(small?.svg).toContain('font-size="16"')
    expect(small?.h).toBeLessThan(base?.h ?? 0)
    const tinted = buildHousePresetSvg(
      { ...genreBase, house: { ...genreBase.house, textColor: "#123456" } },
      MOCK,
      380,
      DARK,
    )?.svg ?? ""
    expect(tinted).not.toBe(base?.svg)
    expect(tinted).toContain("#123456")

    const topBaseSvg = buildHousePresetSvg(topBase, MOCK, 380, DARK)?.svg ?? ""
    const topBig = buildHousePresetSvg(
      { ...topBase, house: { ...topBase.house, fontSize: 40 } },
      MOCK,
      380,
      DARK,
    )?.svg ?? ""
    expect(topBig).not.toBe(topBaseSvg)
    const topTinted = buildHousePresetSvg(
      { ...topBase, house: { ...topBase.house, textColor: "#123456" } },
      MOCK,
      380,
      DARK,
    )?.svg ?? ""
    expect(topTinted).not.toBe(topBaseSvg)
    expect(topTinted).toContain("#123456")
  })

  it("normalizes and versions the overrides (no silent restyle on save)", () => {
    const norm = normalizeHouseBadge({
      style: "pill",
      scale: 100,
      polarity: "auto",
      fontSize: 24.6,
      textColor: "#ABCDEF",
      textOpacity: 80.4,
      uppercase: true,
    })
    expect(norm.fontSize).toBe(25)
    expect(norm.textColor).toBe("#abcdef")
    expect(norm.textOpacity).toBe(80)
    expect(norm.uppercase).toBe(true)
  })

  it("textOpacity fades the final fill, uppercase transforms texts", () => {
    const base = buildHousePresetSvg(genreBase, MOCK, 380, DARK)?.svg ?? ""
    const faded = buildHousePresetSvg(
      { ...genreBase, house: { ...genreBase.house, textOpacity: 50 } },
      MOCK,
      380,
      DARK,
    )?.svg ?? ""
    expect(faded).not.toBe(base)
    expect(faded).toContain("rgba(0,0,0,0.44)")
    const upper = buildHousePresetSvg(
      { ...genreBase, house: { ...genreBase.house, uppercase: true } },
      MOCK,
      380,
      DARK,
    )?.svg ?? ""
    expect(upper).not.toBe(base)
    expect(upper).toContain("DRAMMA")
    expect(upper).not.toContain(">Dramma<")
  })

  it("applyFillOpacity handles hex, rgba and unknown formats", () => {
    expect(applyFillOpacity("#ffffff", 50)).toBe("rgba(255,255,255,0.5)")
    expect(applyFillOpacity("rgba(0,0,0,0.80)", 50)).toBe("rgba(0,0,0,0.4)")
    expect(applyFillOpacity("rgb(10,20,30)", 50)).toBe("rgba(10,20,30,0.5)")
    expect(applyFillOpacity("url(#starg)", 50)).toBe("url(#starg)")
    expect(applyFillOpacity("#ffffff", 100)).toBe("rgba(255,255,255,1)")
  })
})

describe("house starter templates", () => {
  it("has unique keys and label keys", () => {
    const keys = BADGE_PRESET_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const t of BADGE_PRESET_TEMPLATES) {
      expect(t.labelKey).toMatch(/^ui\.labTpl[A-Z]/)
    }
  })

  it("covers the native slot targets (top/rank share starters, extra has its own)", () => {
    const byTarget = new Set(BADGE_PRESET_TEMPLATES.map((t) => t.target))
    expect(byTarget).toEqual(new Set(["top", "genre", "extra"]))
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
      const isExtra = t.target === "extra"
      const r = buildHousePresetSvg(
        { variant: "house", target: t.target, house: t.house },
        MOCK,
        380,
        { ...DARK },
        isExtra ? "extra" : null,
        HOUSE_EXTRA_PREVIEW_LABEL,
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
      const isExtra = t.target === "extra"
      const r = buildHousePresetSvg({ variant: "house", target: t.target, house: t.house }, MOCK, 380, {
        ...DARK,
      }, isExtra ? "extra" : null, HOUSE_EXTRA_PREVIEW_LABEL)
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
