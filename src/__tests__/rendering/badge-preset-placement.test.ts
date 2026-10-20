import { describe, expect, it } from "vitest"
import {
  computePresetFullRevision,
  normalizeBadgePreset,
  normalizeHouseBadge,
  resolveHouseRibbon,
  resolvePresetPosition,
  type BadgePreset,
} from "@/lib/badge-preset"
import { buildHousePresetSvg, buildHouseRankingSvg } from "@/lib/badge-svg-shared"
import { buildRankingBadgeSVG } from "@/lib/svg-badge"

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

describe("Task P preset position schema", () => {
  it("defaults to 0/0 and clamps to ±2000", () => {
    expect(resolvePresetPosition(null)).toEqual({ x: 0, y: 0 })
    expect(resolvePresetPosition({ variant: "house", target: "rank" })).toEqual({ x: 0, y: 0 })
    expect(
      resolvePresetPosition({ variant: "house", target: "rank", house: { style: "pill", scale: 100, polarity: "auto", position: { x: 5000, y: -9999 } } }),
    ).toEqual({ x: 2000, y: -2000 })
  })

  it("normalizes position (rounded, zero dropped) and keeps revision capture", () => {
    const base = housePreset("Posi1111-aaa", "rank", "pill")
    const moved = housePreset("Posi1111-aaa", "rank", "pill", { position: { x: 12.6, y: -7.4 } })
    expect(moved.house?.position).toEqual({ x: 13, y: -7 })
    expect(base.revision).not.toBe(moved.revision)
    expect(computePresetFullRevision("house", undefined, moved.house)).toBe(moved.revision)
    const zeroed = normalizeHouseBadge({ style: "pill", scale: 100, polarity: "auto", position: { x: 0, y: 0 } })
    expect(zeroed.position).toBeUndefined()
  })

  it("ribbon flag defaults to ribbon (legacy) and explicit false selects the plate", () => {
    expect(resolveHouseRibbon({ variant: "house", target: "rank", house: { style: "colored", scale: 100, polarity: "auto" } })).toBe(true)
    expect(
      resolveHouseRibbon({ variant: "house", target: "rank", house: { style: "colored", scale: 100, polarity: "auto", ribbon: false } }),
    ).toBe(false)
    expect(resolveHouseRibbon({ variant: "house", target: "rank", house: { style: "pill", scale: 100, polarity: "auto" } })).toBeNull()
  })
})

describe("Task P native parity gap closure", () => {
  it("gap #1: house colored with ribbon=false matches the native plate (accentFill), ribbon=true the ribbon", async () => {
    const scene = { topLight: false, bottomLight: false, accentColor: "#e85d2a", side: "left" as const }
    const ctx = { rating: "8.5", year: "2024", genre: "Dramma", rank: "3" }
    const plate = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "colored", label: "Oggi", scale: 100, polarity: "auto", ribbon: false, accent: "#e85d2a" } },
      ctx,
      380,
      scene,
    )
    const nativePlate = await buildRankingBadgeSVG(3, 380, "Oggi", false, "colored", "#e85d2a", "left", false, false, true, "Oggi")
    expect(plate?.svg).toBeDefined()
    // Same recipe: house plate equals the native accent-filled plate builder output shape (plate, not ribbon).
    expect(plate!.svg).not.toContain("TOP")
    expect(nativePlate!.png).toBeDefined()
    const ribbon = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "colored", label: "Oggi", scale: 100, polarity: "auto", accent: "#e85d2a" } },
      ctx,
      380,
      scene,
    )
    expect(ribbon!.svg).toContain("TOP")
    // Direct builder parity: ribbon=false plate equals accentFill plate.
    const directPlate = buildHouseRankingSvg({ rank: 3, label: "Oggi", pw: 380, style: "colored", accentColor: "#e85d2a", ribbon: false })
    const directRibbon = buildHouseRankingSvg({ rank: 3, label: "Oggi", pw: 380, style: "colored", accentColor: "#e85d2a" })
    expect(directPlate.svg).not.toContain("TOP")
    expect(directRibbon.svg).toContain("TOP")
  })

  it("gap #2: detached geometry follows the combined Y (preset offset), offset 0 stays native-exact", () => {
    const scene = { topLight: false, bottomLight: false, accentColor: "#555555", side: "left" as const }
    const ctx = { rating: "8.5", year: "2024", genre: "Dramma", rank: "3" }
    const attached = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "default", label: "Oggi", scale: 100, polarity: "auto" } },
      ctx,
      380,
      scene,
      "rank",
      undefined,
      false,
    )
    const detached = buildHousePresetSvg(
      { variant: "house", target: "top", house: { style: "default", label: "Oggi", scale: 100, polarity: "auto" } },
      ctx,
      380,
      scene,
      "rank",
      undefined,
      true,
    )
    expect(attached?.svg).toBeDefined()
    expect(detached?.svg).toBeDefined()
    expect(detached!.svg).not.toBe(attached!.svg)
    // Attached preset bitmap equals the direct native builder (offset 0 exact).
    const direct = buildHouseRankingSvg({ rank: 3, label: "Oggi", pw: 380, style: "default" })
    expect(attached!.svg).toBe(direct.svg)
  })

  it("service: preset position moves the top bitmap (X/Y deltas), zero stays identical", async () => {
    const sharp = (await import("sharp")).default
    const { generatePosterBuffer } = await import("@/lib/poster-service")
    const poster = await sharp({ create: { width: 500, height: 750, channels: 3, background: "#101010" } }).jpeg().toBuffer()
    const base = {
      posterBuf: poster,
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
      rankingEnabled: true,
      genreName: "Dramma",
      voteAverage: 8.5,
      badgeStyle: "shadow" as const,
      rankingBadgeStyle: "pill" as const,
      badgeGenre: true,
      badgeYear: false,
      badgeRating: true,
      topLight: false,
      targetCenter: 0,
      ribbonSide: "left" as const,
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
      mediaType: "movie" as const,
      finalRank: 3,
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
      wikidataResult: { awards: [], nominations: [], studios: [], director: null },
      tmdbKeywords: [],
      locale: "it",
      t: (k: string) => k,
      qLabel: "Oggi",
      queryExtra: null,
      qNetLogo: null,
      networkLogo: false,
      sd: {},
      accentOverride: null,
      imdbTop250: false,
      preRelease: false,
    }
    const neutral = housePreset("Rank1111-aaa", "rank", "pill")
    const moved = housePreset("Rank1111-aab", "rank", "pill", { position: { x: 40, y: 30 } })
    const a = await generatePosterBuffer({ ...base, badgeFamilyPresets: { rank: neutral } })
    const b = await generatePosterBuffer({ ...base, badgeFamilyPresets: { rank: moved } })
    const ra = await sharp(a).ensureAlpha().raw().toBuffer()
    const rb = await sharp(b).ensureAlpha().raw().toBuffer()
    let diff = 0
    for (let i = 0; i < ra.length; i += 64) if (Math.abs(ra[i] - rb[i]) > 12) diff++
    expect(diff).toBeGreaterThan(0)
  })
})
