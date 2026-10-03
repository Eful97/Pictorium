import { describe, expect, it } from "vitest"
import { buildDefaultsPreviewUrl, DEFAULTS_PREVIEW_DEMO_MEDIA, type DefaultsPreviewParams } from "@/lib/poster-url"
import { RENDER_VERSION } from "@/lib/render-version"

describe("buildDefaultsPreviewUrl", () => {
  const baseDefaults: DefaultsPreviewParams = {
    lang: "it",
    defaultGlobalBadges: true,
    defaultRankingBadges: true,
    defaultBadgeGenre: true,
    defaultBadgeYear: true,
    defaultBadgeRating: true,
    defaultBadgeQuality: true,
    defaultCustomRatings: true,
    defaultSeparateRatings: false,
    defaultRatingSources: ["imdb", "tmdb"],
    defaultBadgeStyle: "shadow",
    defaultRankingBadgeStyle: "default",
    defaultQualityBadgeStyle: "standard",
    defaultVideoFormats: ["dv", "atmos"],
    defaultBlurEnabled: true,
    defaultBlurIntensity: 20,
    defaultBlurFade: 50,
    defaultBlurDarkness: 30,
    defaultTintStrength: 20,
    defaultTopShade: 50,
    defaultGradientHeight: 30,
    defaultTopBadgeScale: 100,
    defaultTopBadgeOffsetX: 0,
    defaultTopBadgeOffsetY: 0,
    defaultGenreBadgeScale: 100,
    defaultGenreBadgeOffsetX: 0,
    defaultGenreBadgeOffsetY: 0,
    defaultQualityBadgeScale: 100,
    defaultQualityBadgeOffsetX: 0,
    defaultQualityBadgeOffsetY: 0,
    defaultNetworkLogoScale: 100,
    defaultNetworkLogoOffsetX: 0,
    defaultNetworkLogoOffsetY: 0,
    defaultNetworkLogo: true,
    defaultNetworkLogoPosition: "auto",
    defaultRibbonEnabled: true,
    defaultRibbonSide: "left",
    defaultPosterShape: "poster",
    defaultLogoAlign: "center",
    defaultDateFormat: "locale",
    defaultRegion: "IT",
  }

  it("targets the demo media endpoint with preview and rv parameters", () => {
    const url = buildDefaultsPreviewUrl(baseDefaults)
    expect(url).toContain(`/api/poster/${DEFAULTS_PREVIEW_DEMO_MEDIA.mediaType}/${DEFAULTS_PREVIEW_DEMO_MEDIA.id}`)
    expect(url).toContain(`rv=${RENDER_VERSION}`)
    expect(url).toContain("preview=1")
    expect(url).not.toContain("u=")
  })

  it("passes the configured TMDB key and user namespace to the render endpoint", () => {
    const url = buildDefaultsPreviewUrl({ ...baseDefaults, tmdbKey: "demo+key", userId: "demo-user" })
    const params = new URL(url, "http://localhost").searchParams
    expect(params.get("api_key")).toBe("demo+key")
    expect(params.get("u")).toBe("demo-user")
  })

  it("reflects changes in badge styling and switches without saving", () => {
    const url1 = buildDefaultsPreviewUrl({
      ...baseDefaults,
      defaultBadgeStyle: "pill",
      defaultGlobalBadges: true,
      defaultBadgeRating: false,
    })
    expect(url1).toContain("bs=pill")
    expect(url1).toContain("br=0")
    expect(url1).toContain("badges=1")

    const url2 = buildDefaultsPreviewUrl({
      ...baseDefaults,
      defaultBadgeStyle: "vetro",
      defaultGlobalBadges: false,
    })
    expect(url2).toContain("bs=vetro")
    expect(url2).toContain("badges=0")
  })

  it("supports landscape shape in defaults preview", () => {
    const url = buildDefaultsPreviewUrl({
      ...baseDefaults,
      defaultPosterShape: "landscape",
      defaultLogoAlign: "left",
    })
    expect(url).toContain("shape=landscape")
    expect(url).toContain("align=left")
  })

  it("sends logo sizing and offsets, including an explicit reset to automatic sizing", () => {
    const params = new URL(buildDefaultsPreviewUrl({
      ...baseDefaults,
      defaultLogoScale: 40,
      defaultLogoOffsetX: -15,
      defaultLogoOffsetY: 25,
    }), "http://localhost").searchParams
    expect(params.get("scale")).toBe("40")
    expect(params.get("ox")).toBe("-15")
    expect(params.get("oy")).toBe("25")
    const reset = new URL(buildDefaultsPreviewUrl({ ...baseDefaults, defaultLogoScale: null }), "http://localhost").searchParams
    expect(reset.get("scale")).toBe("0")
    expect(reset.get("ox")).toBe("0")
    expect(reset.get("oy")).toBe("0")
  })

  it("serializes ratings and video format selections accurately", () => {
    const url = buildDefaultsPreviewUrl({
      ...baseDefaults,
      defaultSeparateRatings: true,
      defaultRatingSources: ["imdb", "rt"],
      defaultVideoFormats: ["dv", "hdr10plus"],
    })
    expect(url).toContain("sep=1")
    expect(url).toContain(`rsrc=${encodeURIComponent("imdb,rt")}`)
    expect(url).toContain("formats=dv,hdr10plus")
  })
})

describe("Quick badge setup presets", () => {
  it("defines exact parameters for Essential, Ratings, and Full presets", () => {
    // Essenziale: genre + year only, minimal badge style, no ratings/ranking/quality/network logo
    const essentialSetup = {
      defaultGlobalBadges: true,
      defaultBadgeGenre: true,
      defaultBadgeYear: true,
      defaultBadgeRating: false,
      defaultBadgeQuality: false,
      defaultRankingBadges: false,
      defaultNetworkLogo: false,
      defaultBadgeStyle: "minimal" as const,
    }
    expect(essentialSetup.defaultBadgeGenre).toBe(true)
    expect(essentialSetup.defaultBadgeRating).toBe(false)
    expect(essentialSetup.defaultBadgeStyle).toBe("minimal")

    // Voti: ratings + quality focus, year, pill style
    const ratingsSetup = {
      defaultGlobalBadges: true,
      defaultBadgeGenre: false,
      defaultBadgeYear: true,
      defaultBadgeRating: true,
      defaultSeparateRatings: false,
      defaultRatingSources: ["imdb", "tmdb"],
      defaultBadgeQuality: true,
      defaultQualityBadgeStyle: "standard" as const,
      defaultRankingBadges: false,
      defaultNetworkLogo: false,
      defaultBadgeStyle: "pill" as const,
    }
    expect(ratingsSetup.defaultBadgeGenre).toBe(false)
    expect(ratingsSetup.defaultBadgeRating).toBe(true)
    expect(ratingsSetup.defaultBadgeQuality).toBe(true)
    expect(ratingsSetup.defaultBadgeStyle).toBe("pill")

    // Completo: genre, year, ratings, quality, ranking, network logo
    const fullSetup = {
      defaultGlobalBadges: true,
      defaultBadgeGenre: true,
      defaultBadgeYear: true,
      defaultBadgeRating: true,
      defaultSeparateRatings: false,
      defaultRatingSources: ["imdb", "tmdb"],
      defaultBadgeQuality: true,
      defaultQualityBadgeStyle: "standard" as const,
      defaultRankingBadges: true,
      defaultRankingBadgeStyle: "default" as const,
      defaultNetworkLogo: true,
      defaultBadgeStyle: "pill" as const,
    }
    expect(fullSetup.defaultBadgeGenre).toBe(true)
    expect(fullSetup.defaultBadgeRating).toBe(true)
    expect(fullSetup.defaultRankingBadges).toBe(true)
    expect(fullSetup.defaultNetworkLogo).toBe(true)
  })
})
