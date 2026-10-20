/**
 * Technical families through the real poster composite (no store mocks
 * needed: `badgeFamilyPresets` travels pre-authorized from the route).
 *
 * For each family: a neutral house starter (style = native default,
 * scale 100, polarity auto) is bitmap-identical to the native render;
 * style/scale/polarity overrides move pixels; family presets never leak
 * into sibling slots and never turn a gated-off badge on.
 */
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  generatePosterBuffer,
  type GenerationInput,
} from "@/lib/poster-service"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"
import type { BadgePreset } from "@/lib/badge-preset"
import { normalizeBadgePreset } from "@/lib/badge-preset"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"

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

function scaledHouse(
  preset: BadgePreset,
  scale: number,
): BadgePreset {
  return normalizeBadgePreset({ ...preset, house: { ...preset.house!, scale } })
}

function customPreset(id: string, target: BadgePreset["target"], scale = 100): BadgePreset {
  return normalizeBadgePreset({
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "P", tags: [] },
    variant: "custom",
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
      scale,
    },
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
  let diff = 0
  for (let i = 0; i < ra.length; i += 16) if (Math.abs(ra[i] - rb[i]) > 12) diff++
  return diff
}

async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buf).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0 }
}

describe("technical family presets in generatePosterBuffer", () => {
  it("quality: neutral starter is native-identical, style/scale move pixels", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: "4K" }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { quality: housePreset("Qual1111-aaa", "quality", "standard") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    // Style override repaints the tier tag.
    const knockout = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { quality: housePreset("Qual2222-bbb", "quality", "knockout") } }),
    )
    expect(await pixelDiff(baseline, knockout)).toBeGreaterThan(50)
    // Scale override resizes the shared group bitmap.
    const scaled = scaledHouse(housePreset("Qual3333-ccc", "quality", "standard"), 150)
    const scaledBuf = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { quality: scaled } }),
    )
    expect(await pixelDiff(baseline, scaledBuf)).toBeGreaterThan(50)
  })

  it("age: neutral starter is native-identical on the age-only group, knockout repaints", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: null, ageLabel: "VM14" }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { age: housePreset("Age11111-aa", "age", "standard") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    const knockout = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { age: housePreset("Age22222-bb", "age", "knockout") } }),
    )
    expect(await pixelDiff(baseline, knockout)).toBeGreaterThan(50)
  })

  it("network: neutral starter keeps the matched brand mark, scale resizes it", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, networkLogo: true as const, tmdbNetworks: ["Netflix"] }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { network: housePreset("Net11111-aa", "network", "pill") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    // Scale multiplies the native mark bitmap (content stays brand-native).
    const scaled = scaledHouse(housePreset("Net22222-bb", "network", "pill"), 150)
    const resized = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { network: scaled } }),
    )
    expect(await pixelDiff(baseline, resized)).toBeGreaterThan(20)
    // A preset never invents a logo: unmatched networks stay empty.
    const noMatch = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        networkLogo: true as const,
        tmdbNetworks: ["Some Unknown Network XYZ"],
        badgeFamilyPresets: { network: housePreset("Net33333-cc", "network", "pill") },
      }),
    )
    const noMatchNative = await generatePosterBuffer(
      baseInput({ posterBuf: poster, networkLogo: true as const, tmdbNetworks: ["Some Unknown Network XYZ"] }),
    )
    expect(await pixelDiff(noMatchNative, noMatch)).toBe(0)
  })

  it("separateRatings: column starter is native-identical, same-branch styles apply, cross-branch is ignored", async () => {
    const poster = await darkPoster()
    const items = [{ id: "imdb", value: 7.3 }]
    const input = { posterBuf: poster, separateRatings: items }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { separateRatings: housePreset("Sep11111-aa", "separateRatings", "column") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    // Cross-branch switch (column -> bottom) is ignored fail-closed: the
    // branch carries visibility gating the preset must not bypass.
    const crossBranch = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { separateRatings: housePreset("Sep22222-bb", "separateRatings", "bottom-pills") } }),
    )
    expect(await pixelDiff(baseline, crossBranch)).toBe(0)
    // Same-branch scale moves pixels.
    const scaled = scaledHouse(housePreset("Sep33333-cc", "separateRatings", "column"), 150)
    const scaledBuf = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { separateRatings: scaled } }),
    )
    expect(await pixelDiff(baseline, scaledBuf)).toBeGreaterThan(50)
    // Same-branch style switch inside bottom applies.
    const bottomInput = {
      posterBuf: poster,
      separateRatings: items,
      separateRatingsStyle: "bottom-pills" as const,
    }
    const bottomBaseline = await generatePosterBuffer(baseInput(bottomInput))
    const bottomMono = await generatePosterBuffer(
      baseInput({ ...bottomInput, badgeFamilyPresets: { separateRatings: housePreset("Sep44444-dd", "separateRatings", "bottom-mono") } }),
    )
    expect(await pixelDiff(bottomBaseline, bottomMono)).toBeGreaterThan(50)
  })

  it("customRatings: neutral starter keeps the live provider row, scale resizes it", async () => {
    const poster = await darkPoster()
    const ratings = [{ id: "mdblist", name: "MDBList", value: 7.3, format: "decimal" as const }]
    const input = { posterBuf: poster, ratings }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { customRatings: housePreset("Cus11111-aa", "customRatings", "row") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    const scaled = scaledHouse(housePreset("Cus22222-bb", "customRatings", "row"), 150)
    const scaledBuf = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { customRatings: scaled } }),
    )
    expect(await pixelDiff(baseline, scaledBuf)).toBeGreaterThan(20)
  })

  it("comingSoon: neutral starter keeps the corner ribbon, side moves it, scale is inert", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, preRelease: true }
    const baseline = await generatePosterBuffer(baseInput(input))
    const starter = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { comingSoon: housePreset("Com11111-aa", "comingSoon", "ribbon") } }),
    )
    expect(await pixelDiff(baseline, starter)).toBe(0)
    const right = housePreset("Com22222-bb", "comingSoon", "ribbon", { side: "right" })
    const moved = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { comingSoon: right } }),
    )
    expect(await pixelDiff(baseline, moved)).toBeGreaterThan(50)
    // Corner geometry is fixed: preset scale is honestly inert here.
    const scaled = scaledHouse(housePreset("Com33333-cc", "comingSoon", "ribbon"), 150)
    const scaledBuf = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { comingSoon: scaled } }),
    )
    expect(await pixelDiff(baseline, scaledBuf)).toBe(0)
  })

  it("custom variants keep native content at scale 100 and scale the bitmap otherwise", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: "4K" }
    const baseline = await generatePosterBuffer(baseInput(input))
    const neutral = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { quality: customPreset("Custom11-aa", "quality") } }),
    )
    expect(await pixelDiff(baseline, neutral)).toBe(0)
    const scaledBuf = await generatePosterBuffer(
      baseInput({ ...input, badgeFamilyPresets: { quality: customPreset("Custom22-bb", "quality", 150) } }),
    )
    expect(await pixelDiff(baseline, scaledBuf)).toBeGreaterThan(50)
    const { w, h } = await dims(scaledBuf)
    const base = await dims(baseline)
    expect(w).toBe(base.w)
    expect(h).toBe(base.h)
  })

  it("family isolation: presets never leak into siblings, never turn gated-off badges on, nulls equal absence", async () => {
    const poster = await darkPoster()
    // Age-only render + quality preset: the quality slot has no live content.
    const ageOnly = { posterBuf: poster, quality: null, ageLabel: "VM14" }
    const ageBaseline = await generatePosterBuffer(baseInput(ageOnly))
    const ageWithQuality = await generatePosterBuffer(
      baseInput({ ...ageOnly, badgeFamilyPresets: { quality: housePreset("Qual4444-dd", "quality", "knockout") } }),
    )
    expect(await pixelDiff(ageBaseline, ageWithQuality)).toBe(0)
    // No live content anywhere: every family preset stays inert.
    const bare = { posterBuf: poster }
    const bareBaseline = await generatePosterBuffer(baseInput(bare))
    const bareWithAll = await generatePosterBuffer(
      baseInput({
        ...bare,
        badgeFamilyPresets: {
          quality: housePreset("Qual5555-ee", "quality", "knockout"),
          age: housePreset("Age55555-ee", "age", "knockout"),
          network: housePreset("Net55555-ee", "network", "pill"),
          separateRatings: housePreset("Sep55555-ee", "separateRatings", "bottom-mono"),
          customRatings: housePreset("Cus55555-ee", "customRatings", "row"),
          comingSoon: housePreset("Com55555-ee", "comingSoon", "ribbon"),
        },
      }),
    )
    expect(await pixelDiff(bareBaseline, bareWithAll)).toBe(0)
    // Explicit-null map equals the absent map (no sibling cleared, no diff).
    const qualityInput = { posterBuf: poster, quality: "4K" }
    const absent = await generatePosterBuffer(baseInput(qualityInput))
    const nulled = await generatePosterBuffer(
      baseInput({
        ...qualityInput,
        badgeFamilyPresets: { quality: null, age: null, network: null, separateRatings: null, customRatings: null, comingSoon: null, rank: null, extra: null, genre: null },
      }),
    )
    expect(await pixelDiff(absent, nulled)).toBe(0)
  })
})
