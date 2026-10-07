import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { renderSeparateRatingsBottom } from "@/lib/separate-rating-renderer"
import { resolvePosterRenderConfig, resolveSeparateDisplayState } from "@/lib/poster-config"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { encodeConfig, decodeConfig } from "@/lib/config-token"
import { mappingSchema } from "@/lib/validation"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening"

const ITEMS = [{ id: "imdb", value: 8.6 }, { id: "tomatoes", value: 7.1 }, { id: "tmdb", value: 8.2 }]
const STYLES = ["bottom-mono", "bottom-color"] as const

describe.each(STYLES)("%s round ratings", (style) => {
  it("renders transparent space around round icons and scores, not a pill/band", async () => {
    const row = await renderSeparateRatingsBottom(ITEMS, 500, style, "inter", 130, 464, false)
    expect(row).not.toBeNull()
    expect(row!.w).toBeLessThanOrEqual(464)
    const { data, info } = await sharp(row!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(data[3]).toBe(0)
    let opaque = 0
    let colored = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 240) {
        opaque++
        if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 20) colored++
      }
    }
    expect(opaque).toBeGreaterThan(100)
    expect(opaque / (info.width * info.height)).toBeLessThan(0.65)
    if (style === "bottom-mono") expect(colored).toBe(0)
    else expect(colored).toBeGreaterThan(100)
  })

  it("supports both background polarities, font/scale, small widths and the max-3 cap", async () => {
    const base = await renderSeparateRatingsBottom(ITEMS, 500, style, "inter", 100, 464, false)
    const light = await renderSeparateRatingsBottom(ITEMS, 500, style, "inter", 100, 464, true)
    const large = await renderSeparateRatingsBottom(ITEMS, 500, style, "oswald", 150, 1000, false)
    const narrow = await renderSeparateRatingsBottom(ITEMS, 500, style, "inter", 200, 100, false)
    expect(light!.png.equals(base!.png)).toBe(false)
    expect(large!.h).toBeGreaterThan(base!.h)
    expect(narrow!.w).toBeLessThanOrEqual(100)
    const extra = await renderSeparateRatingsBottom([...ITEMS, { id: "letterboxd", value: 8 }], 500, style, "inter", 100, 464, false)
    expect(extra!.png.equals(base!.png)).toBe(true)
    expect(await renderSeparateRatingsBottom([], 500, style)).toBeNull()
    expect(await renderSeparateRatingsBottom([{ id: "unknown", value: 7 }], 500, style)).toBeNull()
  })

  it("round icons support every existing rating asset", async () => {
    for (const id of ["imdb", "tmdb", "mdblist", "tomatoes", "popcorntime", "letterboxd", "metacritic", "metacriticuser", "trakt", "simkl", "mal", "anilist", "kitsu", "filmweb", "filmwebcritics", "rogerebert"]) {
      expect(await renderSeparateRatingsBottom([{ id, value: 8 }], 500, style), id).not.toBeNull()
    }
  })

  it("survives mapping/token/cache validation and preview/Stremio URLs in both shapes", () => {
    expect(mappingSchema.safeParse({ tmdbId: 19995, mediaType: "movie", title: "T", posterPath: "/a.jpg", separateRatingsStyle: style, landscape: { separateRatingsStyle: style } }).success).toBe(true)
    const token = encodeConfig({
      globalBadges: true, rankingBadges: true, badgeStyle: "shadow", rankingBadgeStyle: "default",
      blurEnabled: true, blurIntensity: 5, blurFade: 60, blurDarkness: 40, gradientHeight: 30,
      networkLogo: true, autoRotateClean: false, logoFitEnabled: false, separateRatingsStyle: style,
    })
    expect(decodeConfig(token)?.separateRatingsStyle).toBe(style)
    expect(normalizePosterCacheParams(new URLSearchParams({ sepstyle: style })).get("sepstyle")).toBe(style)
    expect(hardenPosterSearchParams(new URLSearchParams({ sepstyle: style }), { presets: true, preview: false, anonymous: false, publicInstance: true, hasMapping: false }).get("sepstyle")).toBe(style)
    for (const shape of ["poster", "landscape"] as const) {
      const preview = buildDefaultsPreviewUrl({ defaultSeparateRatingsStyle: style, defaultPosterShape: shape })
      expect(preview).toContain(`sepstyle=${style}`)
      expect(buildStremioPosterSearchParams({ separateRatingsStyle: style, separateRatings: true, posterShape: shape, compactTuning: true }).get("sepstyle")).toBe(style)
      expect(resolvePosterRenderConfig({ searchParams: new URLSearchParams({ sepstyle: style, shape }), mapping: null, configOverride: null, sd: {}, hasQuery: true, showBadges: true, rankingBadges: true, animeRank: null, rankingResult: null, finalRank: null }).separateRatingsStyle).toBe(style)
    }
    const state = resolveSeparateDisplayState({ separateRatingsStyle: style, separateRatings: true, badgesEnabled: true, badgeRating: true, badgeGenre: true, badgeYear: true, sepItemCount: 3 })
    expect(state.bottomActive).toBe(true)
    expect(state.effectiveBadgeGenre).toBe(false)
    expect(state.effectiveBadgeYear).toBe(false)
    expect(state.effectiveBadgeRating).toBe(false)
    expect(state.suppressCustomRow).toBe(true)
  })
})
