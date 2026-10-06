import { describe, expect, it } from "vitest"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { resolveTopBadgeStyle, isCornerAnchoredStyle, isNumberRightCorner, isTopBadgeNumberRightCorner } from "@/lib/poster-service"
import { isExtraBadgeStyle, EXTRA_BADGE_STYLES } from "@/lib/badge-styles"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildDefaultsPreviewUrl, buildPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildExtraBadgeSVG } from "@/lib/svg-badge"
import type { Mapping } from "@/lib/types"
import type { PictoriumUserConfig } from "@/lib/config-token"

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

const config = (partial: Partial<PictoriumUserConfig> = {}): PictoriumUserConfig => ({
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: true,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  gradientHeight: 30,
  networkLogo: true,
  autoRotateClean: false,
  logoFitEnabled: false,
  ...partial,
})

describe("extraBadgeStyle enum", () => {
  it("reuses the existing style names, ranking-only styles excluded", () => {
    expect([...EXTRA_BADGE_STYLES].sort()).toEqual(["bordo", "colored", "corner", "default", "pill", "vetro"])
    for (const s of ["netflix", "netflix-color", "number", "bar", "shadow", "minimal", ""]) {
      expect(isExtraBadgeStyle(s)).toBe(false)
    }
    for (const s of EXTRA_BADGE_STYLES) expect(isExtraBadgeStyle(s)).toBe(true)
  })
})

describe("extraBadgeStyle resolve precedence", () => {
  it("absent everywhere = null (legacy rs fallback, byte-identical)", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.extraBadgeStyle).toBeNull()
    expect(r.rankingBadgeStyle).toBe("default")
  })

  it("query xbs beats mapping, token and defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ xbs: "corner" }),
      mapping: mapping({ extraBadgeStyle: "pill" }),
      configOverride: config({ extraBadgeStyle: "vetro" }),
      sd: { extraBadgeStyle: "bordo" },
    }))
    expect(r.extraBadgeStyle).toBe("corner")
  })

  it("mapping beats token and defaults when query is absent", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ extraBadgeStyle: "pill" }),
      configOverride: config({ extraBadgeStyle: "vetro" }),
      sd: { extraBadgeStyle: "bordo" },
    }))
    expect(r.extraBadgeStyle).toBe("pill")
  })

  it("token beats defaults; defaults apply last", () => {
    expect(resolvePosterRenderConfig(baseInput({
      configOverride: config({ extraBadgeStyle: "vetro" }),
      sd: { extraBadgeStyle: "bordo" },
    })).extraBadgeStyle).toBe("vetro")
    expect(resolvePosterRenderConfig(baseInput({
      sd: { extraBadgeStyle: "bordo" },
    })).extraBadgeStyle).toBe("bordo")
  })

  it("present-but-invalid query falls through the chain (behaves as absent)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ xbs: "netflix" }),
      mapping: mapping({ extraBadgeStyle: "corner" }),
    }))
    expect(r.extraBadgeStyle).toBe("corner")
  })

  it("legacy garbage in stored layers falls back to null, never breaks", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: mapping({ extraBadgeStyle: "netflix" as never }),
      sd: { extraBadgeStyle: "bogus" as never },
    }))
    expect(r.extraBadgeStyle).toBeNull()
  })
})

describe("resolveTopBadgeStyle (builder/placement/cache source)", () => {
  it("rank always uses rs, ignoring xbs", () => {
    expect(resolveTopBadgeStyle({ topBadgeType: "rank", rankingBadgeStyle: "netflix", extraBadgeStyle: "corner" })).toBe("netflix")
    expect(resolveTopBadgeStyle({ topBadgeType: "rank", rankingBadgeStyle: "number", extraBadgeStyle: "pill" })).toBe("number")
  })

  it("extra uses xbs when set, rs otherwise (legacy)", () => {
    expect(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "netflix", extraBadgeStyle: null })).toBe("netflix")
    expect(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "netflix", extraBadgeStyle: undefined })).toBe("netflix")
    expect(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "netflix", extraBadgeStyle: "corner" })).toBe("corner")
  })

  it("corner anchoring follows the effective style, not rs alone", () => {
    // Legacy: extra without xbs shares the rs=number corner anchor.
    expect(isCornerAnchoredStyle(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "number", extraBadgeStyle: null }))).toBe(true)
    // Explicit xbs=default detaches the extra badge from the ranking numeral.
    expect(isCornerAnchoredStyle(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "number", extraBadgeStyle: "default" }))).toBe(false)
    // Explicit xbs=corner anchors even with rs=netflix.
    expect(isCornerAnchoredStyle(resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "netflix", extraBadgeStyle: "corner" }))).toBe(true)
    // Rank numerals keep mirroring right; centered extras never do.
    expect(isNumberRightCorner({ rankingBadgeStyle: resolveTopBadgeStyle({ topBadgeType: "rank", rankingBadgeStyle: "number", extraBadgeStyle: "corner" }), ribbonSide: "right", hasTopBadge: true })).toBe(true)
    expect(isNumberRightCorner({ rankingBadgeStyle: resolveTopBadgeStyle({ topBadgeType: "extra", rankingBadgeStyle: "number", extraBadgeStyle: "default" }), ribbonSide: "right", hasTopBadge: true })).toBe(false)
  })
})

describe("isTopBadgeNumberRightCorner (quality + separate share one composition)", () => {
  it("rank numerals mirror right; centered extras never do", () => {
    const right = { ribbonSide: "right", hasTopBadge: true } as const
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "rank", rankingBadgeStyle: "number", extraBadgeStyle: "corner", ...right })).toBe(true)
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "rank", rankingBadgeStyle: "number", extraBadgeStyle: null, ribbonSide: "left", hasTopBadge: true })).toBe(false)
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "rank", rankingBadgeStyle: "netflix", extraBadgeStyle: null, ...right })).toBe(false)
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "rank", rankingBadgeStyle: "number", extraBadgeStyle: null, ribbonSide: "right", hasTopBadge: false })).toBe(false)
  })

  it("legacy extra without xbs keeps the rs=number corner; explicit xbs detaches it", () => {
    const right = { ribbonSide: "right", hasTopBadge: true } as const
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "extra", rankingBadgeStyle: "number", extraBadgeStyle: null, ...right })).toBe(true)
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "extra", rankingBadgeStyle: "number", extraBadgeStyle: "default", ...right })).toBe(false)
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "extra", rankingBadgeStyle: "number", extraBadgeStyle: "corner", ...right })).toBe(false)
    expect(isTopBadgeNumberRightCorner({ topBadgeType: "extra", rankingBadgeStyle: "netflix", extraBadgeStyle: "corner", ...right })).toBe(false)
  })
})

describe("extraBadgeStyle cache keys", () => {
  it("valid xbs stays in the key, invalid collapses to absent", () => {
    expect(normalizePosterCacheParams(new URLSearchParams("xbs=corner&bs=pill")).get("xbs")).toBe("corner")
    expect(normalizePosterCacheParams(new URLSearchParams("xbs=netflix&bs=pill")).has("xbs")).toBe(false)
    expect(normalizePosterCacheParams(new URLSearchParams("xbs=&bs=pill")).has("xbs")).toBe(false)
    // Same render, one key: invalid query and absent query collapse.
    expect(normalizePosterCacheParams(new URLSearchParams("xbs=bogus")).toString())
      .toBe(normalizePosterCacheParams(new URLSearchParams()).toString())
  })
})

describe("extraBadgeStyle URL roundtrip (preview + Stremio)", () => {
  it("defaults preview emits xbs only when defined (legacy URLs unchanged)", () => {
    const legacy = buildDefaultsPreviewUrl({})
    expect(legacy).not.toContain("xbs=")
    const shaped = buildDefaultsPreviewUrl({ defaultExtraBadgeStyle: "corner" })
    expect(new URL(shaped).searchParams.get("xbs")).toBe("corner")
    // Server resolves the preview URL back to the same style.
    const back = resolvePosterRenderConfig(baseInput({ searchParams: new URL(shaped).searchParams }))
    expect(back.extraBadgeStyle).toBe("corner")
    expect(resolvePosterRenderConfig(baseInput({ searchParams: new URL(legacy).searchParams })).extraBadgeStyle).toBeNull()
  })

  it("Stremio params emit xbs only when defined, even in compact mode", () => {
    const legacy = buildStremioPosterSearchParams({ compactTuning: true })
    expect(legacy.has("xbs")).toBe(false)
    const shaped = buildStremioPosterSearchParams({ compactTuning: true, extraBadgeStyle: "pill" })
    expect(shaped.get("xbs")).toBe("pill")
    const back = resolvePosterRenderConfig(baseInput({ searchParams: shaped }))
    expect(back.extraBadgeStyle).toBe("pill")
  })

  it("Stremio poster URL carries mapping/defaults xbs, omits it otherwise", () => {
    const plain = buildStremioPosterUrl({ origin: "https://x.test", type: "movie", id: 1, defaults: {} })
    expect(plain.searchParams.has("xbs")).toBe(false)
    const shaped = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { extraBadgeStyle: "vetro" },
      mapping: mapping({ extraBadgeStyle: "corner" }),
    })
    expect(shaped.searchParams.get("xbs")).toBe("corner")
  })

  it("editor preview emits xbs only when the badge params define it", () => {
    const selected = { id: 1, media_type: "movie" as const, poster_path: "/p.jpg" }
    const ps = {
      selected, previewPoster: null, selectedLogo: null, selectedBackdrop: null,
      logoScale: 75, logoOffsetX: 0, logoOffsetY: 0, backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
      metaInfo: { genres: [], voteAverage: 0 }, trendRank: null, mdblistAnimeList: [],
      topEdgeColor: null, lang: "it", tmdbKey: "",
    }
    const bp = {
      globalBadges: true, rankingBadges: true, badgeStyle: "shadow" as const, rankingBadgeStyle: "default" as const,
      customBadge: null, gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
      topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0, genreBadgeScale: 100,
      genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
      networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    }
    expect(new URL(buildPreviewUrl(ps, bp)).searchParams.has("xbs")).toBe(false)
    expect(new URL(buildPreviewUrl(ps, { ...bp, extraBadgeStyle: "bordo" as const })).searchParams.get("xbs")).toBe("bordo")
  })
})

describe("extra badge bitmaps differ per style", () => {
  it("default vs corner extra badges render distinct PNGs", async () => {
    const a = await buildExtraBadgeSVG("Nuova serie", 380, false, "default", "#e50914", false, "inter")
    const b = await buildExtraBadgeSVG("Nuova serie", 380, false, "corner", "#e50914", false, "inter")
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.png.equals(b!.png)).toBe(false)
  })
})
