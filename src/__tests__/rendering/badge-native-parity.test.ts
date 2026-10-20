/**
 * Native vs Badge Lab starter parity (feat/badge-lab nine-family presets).
 *
 * Every native badge style must have a Lab starter that renders byte-identical
 * output for the same deterministic inputs through the SHARED builders
 * (never copied SVG). Fresh/Card layouts stay out of the Lab: they are
 * renderers, not badge recipes, and the Lab verify URL pins layout=standard.
 *
 * Layers:
 *  1. inventory — allowlists and gallery cover exactly the native styles
 *     (legacy `netflix-color` accepted for backwards compat but NOT advertised
 *     as a distinct native style: the builder degrades it to the default plate).
 *  2. SVG string parity — house starter (no overrides) vs the direct native
 *     builder with the same inputs, across style x light/dark x pw 380/500.
 *  3. PNG parity — same via resvg rasterization (proves pixel identity).
 *  4. Service parity — neutral family/singleton starters in generatePosterBuffer
 *     are pixel-identical to the native render, and distinct live labels stay
 *     distinct (top preset cache key covers the slot label).
 *  5. Contact sheets — set BADGE_PARITY_OUT to a directory to write labeled
 *     native|preset PNG pairs per family (coordinator inspection artifacts).
 */
import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  AGE_BADGE_STYLES,
  BADGE_STYLES,
  EXTRA_BADGE_STYLES,
  QUALITY_BADGE_STYLES,
  RANKING_BADGE_STYLES,
  SEPARATE_RATINGS_STYLES,
} from "@/lib/badge-styles"
import {
  houseStyleAllowlistForTarget,
  normalizeBadgePreset,
  type BadgePreset,
} from "@/lib/badge-preset"
import {
  BADGE_PRESET_TEMPLATES,
  presetPreviewZone,
  zoneForPreset,
} from "@/lib/badge-preset-templates"
import {
  buildComingSoonRibbonSvg,
  buildHouseExtraSvg,
  buildHouseGenreSvg,
  buildHousePresetSvg,
  buildHouseRankingSvg,
  HOUSE_EXTRA_PREVIEW_LABEL,
  type HousePresetScene,
} from "@/lib/badge-svg-shared"
import {
  buildExtraBadgeSVG,
  buildGenreBadgeSVG,
  buildRankingBadgeSVG,
  renderAgeKnockoutBadge,
  renderQualityBadge,
  renderQualityKnockoutBadge,
  renderQualityTierBadge,
  renderSVG,
} from "@/lib/svg-badge"
import {
  generatePosterBuffer,
  renderQualityIconBadge,
  type GenerationInput,
} from "@/lib/poster-service"
import { qualityBadgeIconPath } from "@/lib/quality-badge-styles"
import { renderFirstMatchingNetworkLogoBadgeHybrid } from "@/lib/network-svgs"
import {
  renderSeparateRatingStack,
  renderSeparateRatingsBottom,
} from "@/lib/separate-rating-renderer"
import { renderMultiRatings } from "@/lib/multi-rating-renderer"
import { renderTechnicalPresetPreviewSvg } from "@/lib/badge-preset-technical-preview"
import {
  TECHNICAL_PREVIEW_FIXTURES,
  type TechnicalFamilyId,
} from "@/lib/badge-preset-technical"
import { DEMO_SAMPLE_NETWORK } from "@/lib/demo-samples"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"
import type { BadgeVariableContext } from "@/lib/badge-variables"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"
const CTX: BadgeVariableContext = { rating: "8.5", year: "2024", genre: "Dramma", rank: "3" }
const RANK_CTX: BadgeVariableContext = { ...CTX }
const DARK: HousePresetScene = { topLight: false, bottomLight: false, accentColor: "#555555", side: "left" }
const LIGHT: HousePresetScene = { topLight: true, bottomLight: true, accentColor: "#555555", side: "left" }
const ACCENT = "#e85d2a"
const PWS = [380, 500] as const

function housePreset(
  id: string,
  target: BadgePreset["target"],
  style: string,
  extraHouse: Record<string, unknown> = {},
): BadgePreset {
  return normalizeBadgePreset({
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "P", tags: [] },
    variant: "house",
    house: { style, scale: 100, polarity: "auto", ...extraHouse },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "00000000",
  })
}

function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    blurEnabled: false,
    blurHeight: 50,
    blurIntensity: 10,
    blurFade: 10,
    blurDarkness: 0,
    badgesEnabled: true,
    rankingEnabled: false,
    genreName: "Dramma",
    voteAverage: 8.5,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: false,
    badgeRating: true,
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: [],
    productionCompanies: [],
    tmdbStudios: [],
    tvType: null,
    tvStatus: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [],
    locale: "it",
    t: (k: string) => k,
    qLabel: null,
    queryExtra: null,
    qNetLogo: null,
    networkLogo: false,
    sd: {} satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...overrides,
  }
}

async function darkPoster(): Promise<Buffer> {
  return sharp({
    create: { width: 500, height: 750, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
}

async function pixelDiff(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer()
  const rb = await sharp(b).ensureAlpha().raw().toBuffer()
  if (ra.length !== rb.length) return Number.MAX_SAFE_INTEGER
  let diff = 0
  for (let i = 0; i < ra.length; i += 16) if (Math.abs(ra[i] - rb[i]) > 12) diff++
  return diff
}

describe("native style inventory", () => {
  it("house allowlists cover exactly the natively rendered styles", () => {
    expect(houseStyleAllowlistForTarget("genre")).toEqual([...BADGE_STYLES])
    // Top slot (legacy alias + explicit rank/extra): the full historic set,
    // including the legacy `netflix-color` alias (accepted, never dropped —
    // the builder degrades it to the default plate).
    for (const t of ["top", "rank", "extra"] as const) {
      expect(houseStyleAllowlistForTarget(t)).toEqual([...RANKING_BADGE_STYLES])
    }
    // Extra renders through the renderer subset: ribbon/numeral extras
    // degrade (netflix/netflix-color → default plate, number → corner pill).
    for (const s of EXTRA_BADGE_STYLES) {
      expect(RANKING_BADGE_STYLES).toContain(s)
    }
    expect(houseStyleAllowlistForTarget("quality")).toEqual([...QUALITY_BADGE_STYLES])
    expect(houseStyleAllowlistForTarget("age")).toEqual([...AGE_BADGE_STYLES])
    expect(houseStyleAllowlistForTarget("network")).toEqual(["pill"])
    expect(houseStyleAllowlistForTarget("separateRatings")).toEqual([...SEPARATE_RATINGS_STYLES])
    expect(houseStyleAllowlistForTarget("customRatings")).toEqual(["row"])
    expect(houseStyleAllowlistForTarget("comingSoon")).toEqual(["ribbon"])
  })

  it("gallery advertises every native style, no deprecated aliases as new originals", () => {
    const keys = BADGE_PRESET_TEMPLATES.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    // Genre: all 7 native styles.
    for (const s of BADGE_STYLES) {
      expect(keys, `genre starter for ${s}`).toContain(`genre-${s}`)
    }
    // Rank: all native styles EXCEPT the legacy netflix-color alias (the
    // builder renders it as the default plate — advertising it next to the
    // real colored ribbon would fake a distinct native style).
    for (const s of RANKING_BADGE_STYLES) {
      if (s === "netflix-color") {
        expect(keys, "legacy netflix-color is not advertised").not.toContain("top-netflix-color")
        continue
      }
      expect(keys, `rank starter for ${s}`).toContain(`top-${s}`)
    }
    // Extra: exactly the renderer subset (ribbon/numeral styles degrade to
    // default/corner — no dedicated starters for degraded aliases).
    const extraKeys = BADGE_PRESET_TEMPLATES.filter((t) => t.target === "extra").map((t) => t.key)
    expect(extraKeys.sort()).toEqual([...EXTRA_BADGE_STYLES].map((s) => `extra-${s}`).sort())
    // Extra starters carry no baked label (the live extra label renders).
    for (const t of BADGE_PRESET_TEMPLATES.filter((t) => t.target === "extra")) {
      expect(t.house.label, `${t.key} must not bake a label`).toBeUndefined()
    }
    // Rank starters carry the live period label default ("Oggi").
    for (const t of BADGE_PRESET_TEMPLATES.filter((t) => t.target === "top")) {
      expect(t.house.label, `${t.key} period label`).toBe("Oggi")
    }
  })

  it("rank and extra targets preview in the top slot zones", () => {
    expect(presetPreviewZone("rank", "pill")).toBe("top-center")
    expect(presetPreviewZone("rank", "ribbon")).toBe("top-ribbon")
    expect(presetPreviewZone("extra", "pill")).toBe("top-center")
    expect(zoneForPreset({ target: "rank", variant: "house", house: { style: "pill", scale: 100, polarity: "auto" } })).toBe("top-center")
    expect(zoneForPreset({ target: "rank", variant: "house", house: { style: "netflix", scale: 100, polarity: "auto" } })).toBe("top-ribbon")
    expect(zoneForPreset({ target: "extra", variant: "house", house: { style: "pill", scale: 100, polarity: "auto" } })).toBe("top-center")
    expect(zoneForPreset({ target: "extra", variant: "house", house: { style: "corner", scale: 100, polarity: "auto" } })).toBe("top-center")
  })
})

describe("house starter SVG parity", () => {
  it("genre starters match the direct genre builder (7 styles x dark/light x 380/500)", () => {
    for (const style of BADGE_STYLES) {
      for (const scene of [DARK, LIGHT]) {
        for (const pw of PWS) {
          const bottomLight = scene.bottomLight
          const accent = style === "colored" ? ACCENT : "#555555"
          const via = buildHousePresetSvg(
            { variant: "house", target: "genre", house: { style, showGenre: true, showYear: true, showRating: true, scale: 100, polarity: "auto", ...(style === "colored" ? { accent } : {}) } },
            CTX,
            pw,
            { ...scene, accentColor: accent },
          )
          const direct = buildHouseGenreSvg({
            genreName: "Dramma", voteStr: "8.5", yearStr: "2024", pw, style,
            accentColor: accent, bottomLight,
            parts: { showGenre: true, showYear: true, showRating: true }, scale: 100,
          })
          expect(via?.svg, `genre/${style} ${bottomLight ? "light" : "dark"} pw=${pw}`).toBe(direct.svg)
        }
      }
    }
  })

  it("rank starters match the native ranking builder (9 styles x dark/light x 380/500)", () => {
    for (const style of RANKING_BADGE_STYLES) {
      for (const scene of [DARK, LIGHT]) {
        for (const pw of PWS) {
          const topLight = scene.topLight
          const accent = style === "colored" || style === "corner" ? ACCENT : "#555555"
          const via = buildHousePresetSvg(
            { variant: "house", target: "top", house: { style, label: "Oggi", scale: 100, polarity: "auto", ...(accent !== "#555555" ? { accent } : {}) } },
            RANK_CTX,
            pw,
            { ...scene, accentColor: accent },
          )
          // Mirrors svg-badge.ts buildRankingBadgeSVG label mapping: ribbon
          // styles take the ribbon subtitle, the rest the display label.
          const ribbon = style === "netflix" || style === "netflix-color" || style === "colored"
          const direct = buildHouseRankingSvg({
            rank: 3, label: ribbon ? "Oggi" : "Oggi", pw, topLight, style,
            accentColor: accent, side: "left", isAnime: false,
          })
          expect(via?.svg, `rank/${style} ${topLight ? "light" : "dark"} pw=${pw}`).toBe(direct.svg)
        }
      }
    }
  })

  it("legacy netflix-color renders exactly like the default plate (same builder)", () => {
    for (const pw of PWS) {
      const alias = buildHousePresetSvg(
        { variant: "house", target: "top", house: { style: "netflix-color", label: "Oggi", scale: 100, polarity: "auto" } },
        RANK_CTX, pw, DARK,
      )
      const plate = buildHousePresetSvg(
        { variant: "house", target: "top", house: { style: "default", label: "Oggi", scale: 100, polarity: "auto" } },
        RANK_CTX, pw, DARK,
      )
      expect(alias?.svg, `netflix-color == default pw=${pw}`).toBe(plate?.svg)
    }
  })

  it("extra starters match the shared extra recipe (renderer subset x dark/light x 380/500)", () => {
    for (const style of EXTRA_BADGE_STYLES) {
      for (const scene of [DARK, LIGHT]) {
        for (const pw of PWS) {
          const topLight = scene.topLight
          const accent = style === "colored" || style === "corner" ? ACCENT : "#555555"
          const via = buildHousePresetSvg(
            { variant: "house", target: "extra", house: { style, scale: 100, polarity: "auto", ...(accent !== "#555555" ? { accent } : {}) } },
            CTX, pw, { ...scene, accentColor: accent }, "extra", HOUSE_EXTRA_PREVIEW_LABEL,
          )
          const direct = buildHouseExtraSvg({
            label: HOUSE_EXTRA_PREVIEW_LABEL, pw, topLight, style,
            accentColor: accent,
          })
          expect(via?.svg, `extra/${style} ${topLight ? "light" : "dark"} pw=${pw}`).toBe(direct.svg)
        }
      }
    }
  })

  it("legacy extra ribbon/numeral styles degrade exactly like the native extra badge", () => {
    for (const style of ["netflix", "netflix-color", "number"] as const) {
      const via = buildHousePresetSvg(
        { variant: "house", target: "extra", house: { style, scale: 100, polarity: "auto" } },
        CTX, 380, DARK, "extra", HOUSE_EXTRA_PREVIEW_LABEL,
      )
      const native = buildHouseExtraSvg({ label: HOUSE_EXTRA_PREVIEW_LABEL, pw: 380, style })
      expect(via?.svg, `extra legacy ${style} degrades natively`).toBe(native.svg)
      if (style === "netflix" || style === "netflix-color") {
        // Ribbon alias → default plate, never a ribbon for extras.
        expect(via?.svg, `${style} renders the label`).toContain(HOUSE_EXTRA_PREVIEW_LABEL)
      }
      // No rank digits leak into an extra badge.
      expect(via?.svg, `extra ${style} has no rank`).not.toContain("#3")
    }
  })

  it("legacy top alias on the extra slot renders extra content, never #rank", () => {
    // No label override: the live extra label renders (an explicit house
    // label would win, like on the rank slot — override semantics preserved).
    const via = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "pill", scale: 100, polarity: "auto" } },
      RANK_CTX, 380, DARK, "extra", HOUSE_EXTRA_PREVIEW_LABEL,
    )
    const native = buildHouseExtraSvg({ label: HOUSE_EXTRA_PREVIEW_LABEL, pw: 380, style: "pill" })
    expect(via?.svg).toBe(native.svg)
    expect(via?.svg).not.toContain("#3")
  })

  it("ribbon sides and multi-digit ranks match the native builder", () => {
    for (const rank of [1, 10, 20]) {
      for (const side of ["left", "right"] as const) {
        for (const style of ["netflix", "number", "pill"] as const) {
          const via = buildHousePresetSvg(
            { variant: "house", target: "top", house: { style, label: "Oggi", scale: 100, polarity: "auto", ...(side === "right" ? { side } : {}) } },
            { ...RANK_CTX, rank: String(rank) },
            380,
            { ...DARK, side },
          )
          const direct = buildHouseRankingSvg({
            rank, label: "Oggi", pw: 380, topLight: false, style,
            accentColor: "#555555", side, isAnime: false,
          })
          expect(via?.svg, `rank ${style} ${rank} ${side}`).toBe(direct.svg)
        }
      }
    }
  })
})

describe("house starter PNG parity (resvg raster)", () => {
  it("rank pill rasterizes identically to the native ranking badge", async () => {
    const house = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "pill", label: "Oggi", scale: 100, polarity: "auto" } },
      RANK_CTX, 380, DARK,
    )
    const native = await buildRankingBadgeSVG(3, 380, "Oggi", false, "pill", "#555555", "left", false, false, false, "Oggi")
    const housePng = await renderSVG(house!.svg, house!.w)
    expect(house!.w).toBe(native!.w)
    expect(house!.h).toBe(native!.h)
    expect(housePng.equals(native!.png)).toBe(true)
  })

  it("rank netflix ribbon rasterizes identically to the native ribbon", async () => {
    const house = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "netflix", label: "Oggi", scale: 100, polarity: "auto" } },
      RANK_CTX, 380, DARK,
    )
    const native = await buildRankingBadgeSVG(3, 380, "Oggi", false, "netflix", "#555555", "left", false, false, false, "Oggi")
    const housePng = await renderSVG(house!.svg, house!.w)
    expect(housePng.equals(native!.png)).toBe(true)
  })

  it("extra pill rasterizes identically to the native extra badge", async () => {
    const house = buildHousePresetSvg(
      { variant: "house", target: "extra", house: { style: "pill", scale: 100, polarity: "auto" } },
      CTX, 380, DARK, "extra", HOUSE_EXTRA_PREVIEW_LABEL,
    )
    const native = await buildExtraBadgeSVG(HOUSE_EXTRA_PREVIEW_LABEL, 380, false, "pill", "#555555", false, "inter")
    const housePng = await renderSVG(house!.svg, house!.w)
    expect(housePng.equals(native!.png)).toBe(true)
  })

  it("genre shadow rasterizes identically to the native genre badge", async () => {
    const house = buildHousePresetSvg(
      { variant: "house", target: "genre", house: { style: "shadow", showGenre: true, showYear: true, showRating: true, scale: 100, polarity: "auto" } },
      CTX, 380, DARK,
    )
    const native = await buildGenreBadgeSVG("Dramma", 8.5, 380, "2024", "shadow", "#555555", false, { showGenre: true, showYear: true, showRating: true }, 100, "inter")
    const housePng = await renderSVG(house!.svg, house!.w)
    expect(housePng.equals(native!.png)).toBe(true)
  })
})

describe("top-slot starters in generatePosterBuffer", () => {
  it("neutral rank family starter is pixel-identical to the native rank badge", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, rankingEnabled: true, finalRank: 3, qLabel: "Oggi", rankingBadgeStyle: "pill" as const }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { rank: housePreset("Rank1111-aaa", "rank", "pill") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
  })

  it("neutral extra family starter is pixel-identical to the native extra badge", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, rankingEnabled: true, queryExtra: "Special Award", finalRank: 3, rankingBadgeStyle: "pill" as const }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { extra: housePreset("Extr1111-aaa", "extra", "pill") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    // The preset renders the live extra label, never rank digits.
    expect(await pixelDiff(baseline, await generatePosterBuffer(baseInput({ ...input, finalRank: 9 })))).toBe(0)
  })

  it("legacy top singleton on the extra slot renders extra content (no #rank)", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, rankingEnabled: true, queryExtra: "Special Award", finalRank: 3, rankingBadgeStyle: "pill" as const }
    const baseline = await generatePosterBuffer(baseInput(input))
    // No label override: the live extra label renders (an explicit house
    // label would win, like on the rank slot — override semantics preserved).
    const legacy = housePreset("TopLeg111-aaa", "top", "pill")
    const withLegacy = await generatePosterBuffer(
      baseInput({ ...input, badgePresetResolved: legacy }),
    )
    expect(await pixelDiff(baseline, withLegacy)).toBe(0)
  })

  it("distinct extra labels stay distinct under the same preset (cache key covers the slot label)", async () => {
    const poster = await darkPoster()
    const preset = housePreset("Extr2222-bbb", "extra", "pill")
    const a = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, queryExtra: "Oscar", badgeFamilyPresets: { extra: preset } }),
    )
    const b = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, queryExtra: "Cannes", badgeFamilyPresets: { extra: preset } }),
    )
    expect(await pixelDiff(a, b)).toBeGreaterThan(50)
  })

  it("neutral genre family starter is pixel-identical to the native genre badge", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, badgeYear: true }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { genre: housePreset("Genr1111-aaa", "genre", "shadow") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
  })
})

describe("technical starters serve native pixels through the preview route fn", () => {
  async function previewPng(preset: BadgePreset): Promise<Buffer> {
    const svg = await renderTechnicalPresetPreviewSvg(preset)
    const m = svg?.match(/<image href="data:image\/png;base64,([^"]+)"[^>]*width="(\d+)" height="(\d+)"/)
    if (m) return Buffer.from(m[1], "base64")
    const w = Number(svg?.match(/width="(\d+)"/)?.[1] ?? 380)
    return renderSVG(svg!, w)
  }

  it("quality standard/knockout match the native tier builders", async () => {
    const cases = [
      { style: "standard", id: "QualStd111-a" },
      { style: "knockout", id: "QualKo1111-a" },
    ] as const
    for (const { style, id } of cases) {
      const preset = housePreset(id, "quality", style)
      const viaRoute = await previewPng(preset)
      const native = style === "standard"
        ? await renderQualityTierBadge(TECHNICAL_PREVIEW_FIXTURES.quality, 380, false, "inter")
        : await renderQualityKnockoutBadge(TECHNICAL_PREVIEW_FIXTURES.quality, 380, "inter")
      expect(viaRoute.equals(native!.png), `quality/${style}`).toBe(true)
    }
  })

  it("age standard/knockout match the native age builders", async () => {
    const std = housePreset("AgeStd111-aa", "age", "standard")
    const ko = housePreset("AgeKo1111-aa", "age", "knockout")
    expect((await previewPng(std)).equals((await renderQualityBadge(TECHNICAL_PREVIEW_FIXTURES.age, 380, false, "inter"))!.png)).toBe(true)
    expect((await previewPng(ko)).equals((await renderAgeKnockoutBadge(TECHNICAL_PREVIEW_FIXTURES.age, 380, "inter"))!.png)).toBe(true)
  })

  it("comingSoon ribbon matches the native ribbon builder", async () => {
    const preset = housePreset("Soon1111-aaa", "comingSoon", "ribbon")
    const viaRoute = await renderTechnicalPresetPreviewSvg(preset)
    const direct = buildComingSoonRibbonSvg(TECHNICAL_PREVIEW_FIXTURES.comingSoon, 380, "left", "inter", {})
    expect(viaRoute).toBe(direct.svg)
  })
})

describe("badge parity contact sheets", () => {
  it("writes labeled native|preset PNG pairs per family when BADGE_PARITY_OUT is set", async () => {
    const out = process.env.BADGE_PARITY_OUT
    if (!out) return
    fs.mkdirSync(out, { recursive: true })
    const rows: { family: string; style: string; theme: string; shape: string; nativePng: Buffer; presetPng: Buffer; verdict: string }[] = []

    async function pushPair(family: string, style: string, theme: "dark" | "light", shape: string, nativePng: Buffer, presetSvg: string | null) {
      const presetPng = presetSvg ? await renderSVG(presetSvg, Number(presetSvg.match(/width="(\d+)"/)?.[1] ?? 380)) : Buffer.alloc(0)
      const verdict = presetSvg && nativePng.equals(presetPng) ? "IDENTICAL" : "DIFF"
      rows.push({ family, style, theme, shape, nativePng, presetPng, verdict })
      expect(verdict, `${family}/${style} ${theme} ${shape}`).toBe("IDENTICAL")
    }

    for (const theme of ["dark", "light"] as const) {
      const scene: HousePresetScene = theme === "dark" ? DARK : LIGHT
      for (const shape of [{ name: "portrait", pw: 380 }, { name: "landscape", pw: 500 }]) {
        for (const style of RANKING_BADGE_STYLES) {
          const accent = style === "colored" || style === "corner" ? ACCENT : "#555555"
          const house = buildHousePresetSvg(
            { variant: "house", target: "top", house: { style, label: "Oggi", scale: 100, polarity: "auto", ...(accent !== "#555555" ? { accent } : {}) } },
            RANK_CTX, shape.pw, { ...scene, accentColor: accent },
          )
          const ribbon = style === "netflix" || style === "netflix-color" || style === "colored"
          const native = await buildRankingBadgeSVG(3, shape.pw, "Oggi", scene.topLight, style, accent, "left", false, false, false, ribbon ? "Oggi" : "Oggi")
          await pushPair("rank", style, theme, shape.name, native!.png, house?.svg ?? null)
        }
        for (const style of EXTRA_BADGE_STYLES) {
          const accent = style === "colored" || style === "corner" ? ACCENT : "#555555"
          const house = buildHousePresetSvg(
            { variant: "house", target: "extra", house: { style, scale: 100, polarity: "auto", ...(accent !== "#555555" ? { accent } : {}) } },
            CTX, shape.pw, { ...scene, accentColor: accent }, "extra", HOUSE_EXTRA_PREVIEW_LABEL,
          )
          const native = await buildExtraBadgeSVG(HOUSE_EXTRA_PREVIEW_LABEL, shape.pw, scene.topLight, style, accent, false, "inter")
          await pushPair("extra", style, theme, shape.name, native!.png, house?.svg ?? null)
        }
        for (const style of BADGE_STYLES) {
          const accent = style === "colored" ? ACCENT : "#555555"
          const house = buildHousePresetSvg(
            { variant: "house", target: "genre", house: { style, showGenre: true, showYear: true, showRating: true, scale: 100, polarity: "auto", ...(style === "colored" ? { accent } : {}) } },
            CTX, shape.pw, { ...scene, accentColor: accent },
          )
          const native = await buildGenreBadgeSVG("Dramma", 8.5, shape.pw, "2024", style, accent, scene.bottomLight, { showGenre: true, showYear: true, showRating: true }, 100, "inter")
          await pushPair("genre", style, theme, shape.name, native!.png, house?.svg ?? null)
        }
      }
    }

    // Technical families (portrait, dark scene): route preview fn vs direct native builders.
    async function techPair(family: TechnicalFamilyId, style: string, makePreset: () => BadgePreset, makeNativePng: () => Promise<Buffer>) {
      const preset = makePreset()
      const viaRoute = await renderTechnicalPresetPreviewSvg(preset)
      const m = viaRoute?.match(/<image href="data:image\/png;base64,([^"]+)"[^>]*width="(\d+)" height="(\d+)"/)
      const presetPng = m ? Buffer.from(m[1], "base64") : viaRoute ? await renderSVG(viaRoute, Number(viaRoute.match(/width="(\d+)"/)?.[1] ?? 380)) : Buffer.alloc(0)
      const nativePng = await makeNativePng()
      const verdict = viaRoute && nativePng.equals(presetPng) ? "IDENTICAL" : "DIFF"
      rows.push({ family, style, theme: "dark", shape: "portrait", nativePng, presetPng, verdict })
      expect(verdict, `${family}/${style}`).toBe("IDENTICAL")
    }
    const qualityIds: Record<string, string> = { standard: "QualStd222-a", knockout: "QualKo2222-a", mono: "QualMono22-a", color: "QualColor22-a" }
    for (const style of QUALITY_BADGE_STYLES) {
      await techPair("quality", style,
        () => housePreset(qualityIds[style], "quality", style),
        async () => {
          if (style === "standard") return (await renderQualityTierBadge(TECHNICAL_PREVIEW_FIXTURES.quality, 380, false, "inter"))!.png
          if (style === "knockout") return (await renderQualityKnockoutBadge(TECHNICAL_PREVIEW_FIXTURES.quality, 380, "inter"))!.png
          const iconPath = qualityBadgeIconPath(style, TECHNICAL_PREVIEW_FIXTURES.quality)!
          return (await renderQualityIconBadge(iconPath, 380, false))!.png
        })
    }
    const ageIds: Record<string, string> = { standard: "AgeStd222-aa", knockout: "AgeKo22222-a" }
    for (const style of AGE_BADGE_STYLES) {
      await techPair("age", style,
        () => housePreset(ageIds[style], "age", style),
        async () => style === "knockout"
          ? (await renderAgeKnockoutBadge(TECHNICAL_PREVIEW_FIXTURES.age, 380, "inter"))!.png
          : (await renderQualityBadge(TECHNICAL_PREVIEW_FIXTURES.age, 380, false, "inter"))!.png)
    }
    await techPair("network", "pill",
      () => housePreset("Netw1111-aaa", "network", "pill"),
      async () => (await renderFirstMatchingNetworkLogoBadgeHybrid([{ name: DEMO_SAMPLE_NETWORK.name, logoPath: DEMO_SAMPLE_NETWORK.logoPath }], 380, false))!.png)
    for (const style of SEPARATE_RATINGS_STYLES) {
      await techPair("separateRatings", style,
        () => housePreset(`S${style}`.replace(/[^A-Za-z0-9]/g, "").padEnd(12, "x"), "separateRatings", style),
        async () => {
          const items = [...TECHNICAL_PREVIEW_FIXTURES.separateRatings]
          if (style === "column") return (await renderSeparateRatingStack(items, 380, false, "inter", 100))!.png
          return (await renderSeparateRatingsBottom(items, 380, style, "inter", 100, style === "bottom-bar" ? 380 : 380 - 36, false))!.png
        })
    }
    await techPair("customRatings", "row",
      () => housePreset("Cust1111-aaa", "customRatings", "row"),
      async () => (await renderMultiRatings([...TECHNICAL_PREVIEW_FIXTURES.customRatings], 380 - 40, false, "inter"))!.png)
    await techPair("comingSoon", "ribbon",
      () => housePreset("Soon2222-aaa", "comingSoon", "ribbon"),
      async () => renderSVG(buildComingSoonRibbonSvg(TECHNICAL_PREVIEW_FIXTURES.comingSoon, 380, "left", "inter", {}).svg, buildComingSoonRibbonSvg(TECHNICAL_PREVIEW_FIXTURES.comingSoon, 380, "left", "inter", {}).w))

    // Compose one labeled sheet per family: caption + native|preset rows.
    const byFamily = new Map<string, typeof rows>()
    for (const r of rows) {
      if (!byFamily.has(r.family)) byFamily.set(r.family, [])
      byFamily.get(r.family)!.push(r)
    }
    const written: string[] = []
    for (const [family, list] of byFamily) {
      const blocks: Buffer[] = []
      let sheetW = 0
      for (const r of list) {
        const a = await sharp(r.nativePng).metadata()
        const b = await sharp(r.presetPng).metadata()
        const captionText = `${r.family} · ${r.style} · ${r.theme} · ${r.shape} — ${r.verdict} (native | preset)`
        const rowW = Math.max(a.width ?? 8, 8) + 8 + Math.max(b.width ?? 8, 8)
        sheetW = Math.max(sheetW, rowW)
        const rowH = Math.max(a.height ?? 8, b.height ?? 8)
        const captionSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rowW}" height="26"><rect width="${rowW}" height="26" fill="#18181b"/><text x="8" y="17" font-family="Inter" font-weight="700" font-size="13" fill="${r.verdict === "IDENTICAL" ? "#4ade80" : "#f87171"}">${captionText.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`
        const caption = await sharp(Buffer.from(captionSvg)).png().toBuffer()
        const row = await sharp({
          create: { width: rowW, height: rowH, channels: 4, background: "#00000000" },
        })
          .composite([
            { input: await sharp(r.nativePng).png().toBuffer(), left: 0, top: 0 },
            { input: await sharp(r.presetPng).png().toBuffer(), left: Math.max(a.width ?? 8, 8) + 8, top: 0 },
          ])
          .png()
          .toBuffer()
        blocks.push(caption, row)
      }
      const metas = await Promise.all(blocks.map((bl) => sharp(bl).metadata()))
      const totalH = metas.reduce((s, m) => s + (m.height ?? 0), 0)
      const sheet = await sharp({ create: { width: sheetW, height: totalH, channels: 4, background: "#09090b" } })
        .composite(blocks.map((input, i) => ({ input, left: 0, top: metas.slice(0, i).reduce((s, m) => s + (m.height ?? 0), 0) })))
        .png()
        .toBuffer()
      const file = path.join(out, `parity-${family}.png`)
      fs.writeFileSync(file, sheet)
      written.push(file)
    }
    console.log(`badge parity sheets: ${written.join(", ")}`)
  }, 300000)
})
