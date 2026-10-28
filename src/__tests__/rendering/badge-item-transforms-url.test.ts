/**
 * Per-ITEM badge transforms through the public chain: preview URL, cache-key
 * canonicalization and the render-config resolution.
 *
 * Contract:
 * - param `bit`: absent inherits; explicit empty clears saved corrections;
 * - the param is canonicalized before it enters the cache key (one key per
 *   configuration, garbage collapses onto explicit empty, never inheritance);
 * - precedence mirrors the group geometry: query > effective per-shape mapping
 *   > config token > effective per-shape defaults > none;
 * - only valid identities/sane numbers reach the renderer.
 */
import { describe, expect, it } from "vitest"
import { buildDefaultsPreviewUrl, buildPreviewUrl } from "@/lib/poster-url"
import { parseBadgeItemTransforms, rejoinBadgeItems, serializeBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { mappingSchema } from "@/lib/validation"
import { POSTER_CACHE_ALLOWLIST } from "@/lib/poster-params-hardening"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import type { PictoriumUserConfig } from "@/lib/config-token"

function cfgInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
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
  tmdbId: 1,
  mediaType: "movie",
  title: "T",
  posterPath: "/p.jpg",
  logoPath: null,
  originalPosterPath: null,
  language: null,
  updatedAt: "2026-01-01",
  ...partial,
})

const tokenCfg = (partial: Partial<PictoriumUserConfig> = {}): PictoriumUserConfig => ({
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

const ps = {
  selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
  previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 7.8, width: 500, height: 750 },
  selectedLogo: null,
  selectedBackdrop: null,
  logoScale: 60,
  logoOffsetX: 0,
  logoOffsetY: 0,
  backdropScale: 100,
  backdropOffsetX: 0,
  backdropOffsetY: 0,
  metaInfo: { genres: [{ id: 1, name: "Action" }], voteAverage: 7.8 },
  trendRank: null,
  mdblistAnimeList: [],
  topEdgeColor: null,
  accentColor: null,
  autoAccentColor: null,
  lang: "it",
  tmdbKey: "",
}

const bp = {
  globalBadges: true,
  rankingBadges: false,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
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
}

describe("last badge rejoin with saved corrections", () => {
  const saved = "quality:tier=100,0,100;quality:combo:dv-atmos=100,0,100;quality:format:hdr=100,0,100"

  for (const surface of ["title", "defaults"] as const) {
    it(`${surface}: clearing HDR last never resurrects the saved stack`, () => {
      let draft = parseBadgeItemTransforms(saved)
      for (const id of ["quality:tier", "quality:combo:dv-atmos", "quality:format:hdr"]) {
        draft = rejoinBadgeItems(draft, [id])
        const wire = serializeBadgeItemTransforms(draft)
        const url = surface === "title"
          ? buildPreviewUrl(ps as never, { ...bp, badgeItemTransforms: wire } as never)
          : buildDefaultsPreviewUrl({ defaultBadgeItemTransforms: wire })
        const query = new URL(url, "http://localhost").searchParams
        const config = resolvePosterRenderConfig(cfgInput({
          searchParams: query,
          mapping: surface === "title" ? mapping({ badgeItemTransforms: saved }) : null,
          sd: { badgeItemTransforms: saved },
        }))
        expect(config.badgeItemTransforms).toEqual(draft)
        // Cache identity must preserve the same explicit-clear semantics.
        const cached = resolvePosterRenderConfig(cfgInput({
          searchParams: normalizePosterCacheParams(query),
          sd: { badgeItemTransforms: saved },
        }))
        expect(cached.badgeItemTransforms).toEqual(draft)
      }
    })
  }
})

describe("preview URL", () => {
  it("omits only an unspecified field; an explicit empty map overrides saved values", () => {
    expect(buildPreviewUrl(ps as never, bp as never)).not.toContain("bit=")
    expect(new URL(buildPreviewUrl(ps as never, { ...bp, badgeItemTransforms: null } as never)).searchParams.get("bit")).toBe("")
    expect(
      buildPreviewUrl(ps as never, {
        ...bp,
        badgeItemTransforms: "rating:imdb=100,0,0",
      } as never),
    ).toContain("bit=")
  })

  it("emits the canonical wire form, URL-encoded", () => {
    const url = buildPreviewUrl(ps as never, {
      ...bp,
      badgeItemTransforms: " rating:tmdb=110,2,0 ; rating:imdb=120,4,-3 ",
    } as never)
    const bit = new URL(url).searchParams.get("bit")
    expect(bit).toBe("rating:imdb=120,4,-3;rating:tmdb=110,2,0")
  })
})

describe("cache key canonicalization", () => {
  it("allowlists `bit` so it reaches the renderer", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("bit")).toBe(true)
  })

  it("canonicalizes the value: one key per configuration", () => {
    const key = (raw: string) =>
      normalizePosterCacheParams(new URLSearchParams({ bit: raw })).get("bit")
    expect(key("rating:tmdb=110,2,0;rating:imdb=120,4,0")).toBe(
      "rating:imdb=120,4,0;rating:tmdb=110,2,0",
    )
    expect(key(" rating:imdb=120,4,0 ")).toBe("rating:imdb=120,4,0")
    // Neutral entries are dropped: identical to "nothing configured".
    expect(key("rating:imdb=100,0,0")).toBe("")
    // Garbage is an explicit clear at render time too, never inheritance.
    expect(key("junk")).toBe("")
    expect(key("bogus:x=100,0,0")).toBe("")
    expect(key("rating:imdb=abc")).toBe("")
    expect(key("")).toBe("")
    expect(normalizePosterCacheParams(new URLSearchParams()).has("bit")).toBe(false)
    // Out-of-range numbers are clamped, so they converge on the render value.
    expect(key("rating:imdb=999,99999,0")).toBe("rating:imdb=200,2000,0")
  })
})

describe("mapping persistence contract", () => {
  it("accepts the field on the flat and on the landscape profile (schema)", () => {
    const parsed = mappingSchema.parse({
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      updatedAt: "2026-01-01",
      badgeItemTransforms: "rating:imdb=120,4,0",
      landscape: { badgeItemTransforms: "rating:imdb=80,0,0" },
    })
    expect(parsed.badgeItemTransforms).toBe("rating:imdb=120,4,0")
    expect(parsed.landscape?.badgeItemTransforms).toBe("rating:imdb=80,0,0")
    // Absent stays absent (legacy mappings parsed unchanged).
    const legacy = mappingSchema.parse({
      tmdbId: 1,
      mediaType: "movie",
      title: "T",
      posterPath: "/p.jpg",
      updatedAt: "2026-01-01",
    })
    expect(legacy.badgeItemTransforms).toBeUndefined()
  })

  it("the landscape profile owns the key when present, null inherits the flat", () => {
    const owned = mapping({
      badgeItemTransforms: "rating:imdb=120,4,0",
      landscape: { badgeItemTransforms: "rating:imdb=80,0,0" },
    })
    expect(effectiveMappingForShape(owned, "poster")?.badgeItemTransforms).toBe("rating:imdb=120,4,0")
    expect(effectiveMappingForShape(owned, "landscape")?.badgeItemTransforms).toBe("rating:imdb=80,0,0")

    // Explicit profile null = inherit the flat (same `??` contract as every
    // other geometry key: the landscape profile never invents values).
    const inheriting = mapping({
      badgeItemTransforms: "rating:imdb=120,4,0",
      landscape: { badgeItemTransforms: null },
    })
    expect(effectiveMappingForShape(inheriting, "landscape")?.badgeItemTransforms).toBe("rating:imdb=120,4,0")
  })
})

describe("render config resolution", () => {
  it("reads the query param (canonical, fail-closed)", () => {
    expect(
      resolvePosterRenderConfig(
        cfgInput({ searchParams: new URLSearchParams({ bit: "rating:imdb=120,4,0" }) }),
      ).badgeItemTransforms,
    ).toEqual({ "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 } })
    expect(
      resolvePosterRenderConfig(cfgInput({ searchParams: new URLSearchParams({ bit: "junk" }) }))
        .badgeItemTransforms,
    ).toEqual({})
  })

  it("precedence: query > effective mapping > token > defaults", () => {
    const fromMapping = mapping({ badgeItemTransforms: "rating:tmdb=90,0,-4" })
    expect(
      resolvePosterRenderConfig(
        cfgInput({
          searchParams: new URLSearchParams({ bit: "rating:imdb=120,4,0" }),
          mapping: fromMapping,
          configOverride: tokenCfg({ badgeItemTransforms: "rating:tomatoes=80,0,0" }),
          sd: { badgeItemTransforms: "rating:metacritic=70,1,1" },
        }),
      ).badgeItemTransforms,
    ).toEqual({ "rating:imdb": { scale: 120, offsetX: 4, offsetY: 0 } })

    expect(
      resolvePosterRenderConfig(
        cfgInput({
          mapping: fromMapping,
          configOverride: tokenCfg({ badgeItemTransforms: "rating:tomatoes=80,0,0" }),
          sd: { badgeItemTransforms: "rating:metacritic=70,1,1" },
        }),
      ).badgeItemTransforms,
    ).toEqual({ "rating:tmdb": { scale: 90, offsetX: 0, offsetY: -4 } })

    expect(
      resolvePosterRenderConfig(
        cfgInput({
          configOverride: tokenCfg({ badgeItemTransforms: "rating:tomatoes=80,0,0" }),
          sd: { badgeItemTransforms: "rating:metacritic=70,1,1" },
        }),
      ).badgeItemTransforms,
    ).toEqual({ "rating:tomatoes": { scale: 80, offsetX: 0, offsetY: 0 } })

    expect(
      resolvePosterRenderConfig(cfgInput({ sd: { badgeItemTransforms: "rating:metacritic=70,1,1" } }))
        .badgeItemTransforms,
    ).toEqual({ "rating:metacritic": { scale: 70, offsetX: 1, offsetY: 1 } })

    // Nothing configured anywhere = automatic layout.
    expect(resolvePosterRenderConfig(cfgInput()).badgeItemTransforms).toEqual({})
  })

  it("honours the per-shape mapping profile in landscape", () => {
    const cfg = resolvePosterRenderConfig(
      cfgInput({
        searchParams: new URLSearchParams({ shape: "landscape" }),
        mapping: mapping({
          badgeItemTransforms: "rating:imdb=120,0,0",
          landscape: { badgeItemTransforms: "rating:imdb=80,0,0" },
        }),
      }),
    )
    expect(cfg.badgeItemTransforms).toEqual({ "rating:imdb": { scale: 80, offsetX: 0, offsetY: 0 } })
  })
})
