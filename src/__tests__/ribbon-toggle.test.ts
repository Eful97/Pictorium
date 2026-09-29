/**
 * Toggle Ribbon (nastro stile Netflix all'angolo): catena query > mapping >
 * config token > server defaults > true (ON storico). Su OFF gli stili
 * nastro degradano all'equivalente centrato (mai nascosti) e il Coming Soon
 * pre-digitale diventa pill centrale.
 */
import { describe, expect, it } from "vitest"
import { nonRibbonRankingStyle, type RankingBadgeStyle } from "@/lib/badge-styles"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildPreviewUrl } from "@/lib/poster-url"
import type { Mapping } from "@/lib/types"
import type { PictoriumUserConfig } from "@/lib/config-token"

function baseMapping(overrides: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 42,
    mediaType: "movie",
    title: "Test",
    posterPath: "/poster.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-07-16T10:15:30.000Z",
    ...overrides,
  }
}

function resolveConfig(
  searchParams: URLSearchParams,
  opts: {
    mapping?: Mapping | null
    configOverride?: PictoriumUserConfig | null
    sd?: PosterRenderConfigInput["sd"]
    finalRank?: number | null
  } = {},
): ReturnType<typeof resolvePosterRenderConfig> {
  return resolvePosterRenderConfig({
    searchParams,
    mapping: opts.mapping ?? null,
    configOverride: opts.configOverride ?? null,
    sd: opts.sd ?? {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: opts.finalRank ?? null,
    lang: "it",
  })
}

describe("nonRibbonRankingStyle", () => {
  it("degrades ribbon styles to default centered (colored keeps its accent via flag)", () => {
    expect(nonRibbonRankingStyle("netflix")).toBe("default")
    expect(nonRibbonRankingStyle("netflix-color")).toBe("default")
    expect(nonRibbonRankingStyle("colored")).toBe("default")
  })

  it("leaves centered styles untouched", () => {
    for (const s of ["default", "pill", "bordo", "vetro"] as RankingBadgeStyle[]) {
      expect(nonRibbonRankingStyle(s)).toBe(s)
    }
  })
})

describe("poster-config ribbonEnabled", () => {
  it("defaults to ON: rank auto-detects the netflix ribbon (backward compatible)", () => {
    const cfg = resolveConfig(new URLSearchParams(), { finalRank: 3 })
    expect(cfg.ribbonEnabled).toBe(true)
    expect(cfg.rankingBadgeStyle).toBe("netflix")
  })

  it("server defaults OFF keep the default style centered with rank", () => {
    const cfg = resolveConfig(new URLSearchParams(), {
      finalRank: 3,
      sd: { ribbonEnabled: false },
    })
    expect(cfg.ribbonEnabled).toBe(false)
    expect(cfg.rankingBadgeStyle).toBe("default")
  })

  it("mapping OFF wins over defaults ON (per-title freeze)", () => {
    const cfg = resolveConfig(new URLSearchParams(), {
      finalRank: 3,
      mapping: baseMapping({ ribbonEnabled: false }),
      sd: { ribbonEnabled: true },
    })
    expect(cfg.ribbonEnabled).toBe(false)
    expect(cfg.rankingBadgeStyle).toBe("default")
  })

  it("config token OFF wins over server defaults", () => {
    const cfg = resolveConfig(new URLSearchParams(), {
      finalRank: 3,
      sd: { ribbonEnabled: true },
      configOverride: {
        globalBadges: true,
        rankingBadges: true,
        badgeStyle: "shadow",
        rankingBadgeStyle: "default",
        blurEnabled: true,
        blurIntensity: 20,
        blurFade: 50,
        blurDarkness: 30,
        gradientHeight: 30,
        networkLogo: true,
        autoRotateClean: false,
        ribbonEnabled: false,
      },
    })
    expect(cfg.ribbonEnabled).toBe(false)
    expect(cfg.rankingBadgeStyle).toBe("default")
  })

  it("query ribbon=0 overrides mapping ON, query ribbon=1 overrides defaults OFF", () => {
    const off = resolveConfig(new URLSearchParams("ribbon=0"), {
      finalRank: 3,
      mapping: baseMapping({ ribbonEnabled: true }),
    })
    expect(off.ribbonEnabled).toBe(false)
    expect(off.rankingBadgeStyle).toBe("default")

    const on = resolveConfig(new URLSearchParams("ribbon=1"), {
      finalRank: 3,
      sd: { ribbonEnabled: false },
    })
    expect(on.ribbonEnabled).toBe(true)
    expect(on.rankingBadgeStyle).toBe("netflix")
  })

  it("degrades explicit ribbon styles when OFF (colored keeps accent via flag)", () => {
    const netflix = resolveConfig(new URLSearchParams(), {
      finalRank: 3,
      sd: { rankingBadgeStyle: "netflix", ribbonEnabled: false },
    })
    expect(netflix.rankingBadgeStyle).toBe("default")
    expect(netflix.rankingBadgeAccent).toBe(false)

    const colored = resolveConfig(new URLSearchParams(), {
      finalRank: 3,
      sd: { rankingBadgeStyle: "colored", ribbonEnabled: false },
    })
    expect(colored.rankingBadgeStyle).toBe("default")
    expect(colored.rankingBadgeAccent).toBe(true)
  })

  it("never sets the accent flag when the ribbon is ON", () => {
    const colored = resolveConfig(new URLSearchParams(), {
      finalRank: 3,
      sd: { rankingBadgeStyle: "colored", ribbonEnabled: true },
    })
    expect(colored.rankingBadgeStyle).toBe("colored")
    expect(colored.rankingBadgeAccent).toBe(false)
  })
})

describe("stremio poster ribbon param", () => {
  it("omits ribbon when enabled (default, cache stable)", () => {
    const params = buildStremioPosterSearchParams({ lang: "it" })
    expect(params.has("ribbon")).toBe(false)
  })

  it("emits ribbon=0 only when disabled", () => {
    const params = buildStremioPosterSearchParams({ lang: "it", ribbonEnabled: false })
    expect(params.get("ribbon")).toBe("0")
  })

  it("stremio URL carries mapping OFF over defaults ON", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: { ribbonEnabled: true },
      mapping: baseMapping({ ribbonEnabled: false }),
    })
    expect(url.searchParams.get("ribbon")).toBe("0")
    // Round-trip server-side: la query vince e lo stile degrada.
    const cfg = resolveConfig(url.searchParams, {
      mapping: baseMapping({ ribbonEnabled: false }),
      finalRank: 3,
    })
    expect(cfg.ribbonEnabled).toBe(false)
    expect(cfg.rankingBadgeStyle).toBe("default")
  })

  it("stremio URL omits ribbon when defaults are ON", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: {},
      mapping: baseMapping(),
    })
    expect(url.searchParams.has("ribbon")).toBe(false)
  })
})

describe("preview URL ribbon param (WYSIWYG)", () => {
  const badgeParams = {
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "shadow" as const,
    rankingBadgeStyle: "default" as const,
    customBadge: null,
    gradientHeight: 30,
    blurIntensity: 5,
    blurFade: 60,
    blurDarkness: 40,
    blurEnabled: true,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
  }
  const posterState = {
    selected: { id: 123, media_type: "movie" as const, title: "Test", poster_path: "/poster.jpg" },
    previewPoster: { file_path: "/poster.jpg", iso_639_1: "it", vote_average: 7.5, width: 500, height: 750 },
    selectedLogo: null,
    selectedBackdrop: null,
    logoScale: 75,
    logoOffsetX: 0,
    logoOffsetY: 0,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    metaInfo: { genres: [{ id: 1, name: "Azione" }], voteAverage: 7.5 },
    trendRank: null,
    mdblistAnimeList: [],
    topEdgeColor: null,
    lang: "it",
    tmdbKey: "test-key",
  }

  it("always emits the ribbon state explicitly (mapping cannot desync the editor)", () => {
    expect(buildPreviewUrl(posterState, { ...badgeParams, ribbonEnabled: true })).toContain("ribbon=1")
    expect(buildPreviewUrl(posterState, { ...badgeParams, ribbonEnabled: false })).toContain("ribbon=0")
  })
})
