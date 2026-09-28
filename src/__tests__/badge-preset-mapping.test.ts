import { describe, expect, it } from "vitest"
import { mappingSchema, mappingUpdateSchema } from "@/lib/validation"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildPreviewUrl } from "@/lib/poster-url"
import type { Mapping } from "@/lib/types"

const baseMapping = {
  tmdbId: 1,
  mediaType: "movie",
  title: "T",
  posterPath: "/p.jpg",
}

function mappingWithPreset(): Mapping {
  return {
    ...baseMapping,
    mediaType: "movie",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-09-01T10:00:00.000Z",
    badgePresetId: "Abc123-_XyZ",
    badgePresetRev: "deadbeef",
  }
}

describe("mapping badgePresetId/badgePresetRev", () => {
  it("accepts a valid preset identity", () => {
    const r = mappingSchema.safeParse({ ...baseMapping, badgePresetId: "Abc123-_XyZ", badgePresetRev: "deadbeef" })
    expect(r.success).toBe(true)
  })

  it("rejects junk ids and revisions", () => {
    expect(mappingSchema.safeParse({ ...baseMapping, badgePresetId: "<script>" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...baseMapping, badgePresetId: "short" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...baseMapping, badgePresetRev: "random" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...baseMapping, badgePresetRev: "DEADBEEF" }).success).toBe(false)
  })

  it("accepts them via the update schema and keeps legacy mappings valid", () => {
    expect(mappingUpdateSchema.safeParse({ badgePresetId: "Abc123-_XyZ" }).success).toBe(true)
    expect(mappingUpdateSchema.safeParse({ badgePresetId: null, badgePresetRev: null }).success).toBe(true)
    expect(mappingSchema.safeParse(baseMapping).success).toBe(true)
  })
})

describe("stremio poster URL preset emission", () => {
  const input = (mapping: Mapping | null) => ({
    origin: "https://x.test",
    type: "movie" as const,
    id: 1,
    defaults: {},
    mapping,
    lang: "it",
  })

  it("emits badgePreset+prv from the mapping", () => {
    const url = buildStremioPosterUrl(input(mappingWithPreset()))
    expect(url.searchParams.get("badgePreset")).toBe("Abc123-_XyZ")
    expect(url.searchParams.get("prv")).toBe("deadbeef")
  })

  it("omits both for legacy mappings (existing URLs unchanged)", () => {
    const url = buildStremioPosterUrl(input({ ...mappingWithPreset(), badgePresetId: null, badgePresetRev: null }))
    expect(url.searchParams.has("badgePreset")).toBe(false)
    expect(url.searchParams.has("prv")).toBe(false)
  })

  it("drops invalid identities instead of caching junk", () => {
    const params = buildStremioPosterSearchParams({ badgePresetId: "<script>", badgePresetRev: "random" })
    expect(params.has("badgePreset")).toBe(false)
    expect(params.has("prv")).toBe(false)
    // Revision without a valid id is meaningless: never emitted alone.
    const orphan = buildStremioPosterSearchParams({ badgePresetRev: "deadbeef" })
    expect(orphan.has("prv")).toBe(false)
  })
})

describe("preview URL preset emission", () => {
  const state = (overrides = {}) => ({
    selected: { id: 1, media_type: "movie" as const, poster_path: "/p.jpg" },
    previewPoster: null,
    selectedLogo: null,
    selectedBackdrop: null,
    logoScale: 75,
    logoOffsetX: 0,
    logoOffsetY: 0,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    metaInfo: { genres: [], voteAverage: 0 },
    trendRank: null,
    mdblistAnimeList: [],
    topEdgeColor: null,
    lang: "it",
    tmdbKey: "",
    ...overrides,
  })
  const badge = (overrides = {}) => ({
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "shadow" as const,
    rankingBadgeStyle: "default" as const,
    customBadge: null,
    gradientHeight: 30,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    blurEnabled: true,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeScale: 100,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoScale: 100,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    ...overrides,
  })

  it("emits badgePreset+prv in the WYSIWYG preview when set", () => {
    const url = buildPreviewUrl(
      state(),
      badge({ badgePresetId: "Abc123-_XyZ", badgePresetRev: "deadbeef" }),
    )
    expect(url).toContain("badgePreset=Abc123-_XyZ")
    expect(url).toContain("prv=deadbeef")
  })

  it("omits them when unset and drops junk", () => {
    expect(buildPreviewUrl(state(), badge())).not.toContain("badgePreset")
    const junk = buildPreviewUrl(state(), badge({ badgePresetId: "<script>", badgePresetRev: "xx" }))
    expect(junk).not.toContain("badgePreset")
    expect(junk).not.toContain("prv=")
  })
})
