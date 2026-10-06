import { describe, it, expect } from "vitest"
import {
  BADGE_FONTS,
  DEFAULT_BADGE_FONT,
  isBadgeFont,
} from "../lib/badge-styles"
import {
  estimateTextWidth,
  fontFamilyFor,
  normalizeBadgeFont,
  buildGenreTextSvg,
  buildQualityBadgeSvg,
  buildHouseGenreSvg,
} from "../lib/badge-svg-shared"
import { renderGenreBadge, renderSVG } from "../lib/svg-badge"
import sharp from "sharp"
import { resolvePosterRenderConfig } from "../lib/poster-config"
import { normalizePosterCacheParams } from "../lib/poster-runtime-cache"
import {
  buildPreviewUrl,
  buildDefaultsPreviewUrl,
} from "../lib/poster-url"
import { buildStremioPosterSearchParams } from "../lib/stremio-poster-params"
import {
  captureVisualPreset,
  visualPresetValuesSchema,
} from "../lib/visual-presets"

function resolve(bfont: string | null, extra?: {
  mappingFont?: string | null
  configFont?: string | null
  sdFont?: string | null
}) {
  const sp = new URLSearchParams(bfont === null ? "" : `bfont=${bfont}`)
  return resolvePosterRenderConfig({
    searchParams: sp,
    mapping: extra?.mappingFont !== undefined
      ? {
        tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
        logoPath: null, originalPosterPath: null, language: null, updatedAt: "",
        badgeFont: extra.mappingFont as never,
      }
      : null,
    configOverride: extra?.configFont !== undefined
      ? { badgeFont: extra.configFont } as never
      : null,
    sd: extra?.sdFont !== undefined ? { badgeFont: extra.sdFont as never } : {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
  })
}

describe("Badge font contract (bfont)", () => {
  it("allowlist is closed: inter default, garbage rejected", () => {
    expect(BADGE_FONTS).toEqual(["inter", "barlow-condensed", "oswald"])
    expect(DEFAULT_BADGE_FONT).toBe("inter")
    expect(isBadgeFont("inter")).toBe(true)
    expect(isBadgeFont("barlow-condensed")).toBe(true)
    expect(isBadgeFont("oswald")).toBe(true)
    expect(isBadgeFont("bebas")).toBe(false)
    expect(isBadgeFont("Inter")).toBe(false)
    expect(isBadgeFont(null)).toBe(false)
    expect(isBadgeFont(undefined)).toBe(false)
    expect(normalizeBadgeFont(null)).toBe("inter")
    expect(normalizeBadgeFont("bebas-neue")).toBe("inter")
    expect(normalizeBadgeFont("oswald")).toBe("oswald")
  })

  it("absent or invalid query falls back to inter (existing URLs unchanged)", () => {
    expect(resolve(null).badgeFont).toBe("inter")
    expect(resolve("bebas-neue").badgeFont).toBe("inter")
    expect(resolve("Inter").badgeFont).toBe("inter")
    expect(resolve("barlow-condensed").badgeFont).toBe("barlow-condensed")
    expect(resolve("oswald").badgeFont).toBe("oswald")
  })

  it("empty bfont is present-but-invalid: renders inter even with oswald defaults", () => {
    // `?bfont=` non deve cadere sui default (con `||` erediterebbe Oswald
    // mentre la chiave cache lo normalizza a inter: stessa chiave, byte
    // diversi). Con `??` il valore vuoto è invalido → inter, come la cache.
    expect(resolve("", { sdFont: "oswald" }).badgeFont).toBe("inter")
    expect(resolve("", { mappingFont: "oswald", sdFont: "oswald" }).badgeFont).toBe("inter")
    expect(resolve("").badgeFont).toBe("inter")
  })

  it("precedence: query > mapping > config > server defaults > inter", () => {
    expect(resolve(null, { sdFont: "oswald" }).badgeFont).toBe("oswald")
    expect(resolve(null, { configFont: "barlow-condensed", sdFont: "oswald" }).badgeFont).toBe("barlow-condensed")
    expect(resolve(null, { mappingFont: "oswald", configFont: "barlow-condensed", sdFont: "barlow-condensed" }).badgeFont).toBe("oswald")
    expect(resolve("inter", { mappingFont: "oswald", configFont: "oswald", sdFont: "oswald" }).badgeFont).toBe("inter")
    expect(resolve("oswald", { mappingFont: "barlow-condensed" }).badgeFont).toBe("oswald")
  })

  it("fontFamilyFor maps latin per font, Rubik keeps Hebrew/Arabic priority", () => {
    expect(fontFamilyFor("Action")).toBe("Inter")
    expect(fontFamilyFor("Action", "barlow-condensed")).toBe("Barlow Condensed")
    expect(fontFamilyFor("TOP 10", "oswald")).toBe("Oswald")
    expect(fontFamilyFor("עונה חדשה", "barlow-condensed")).toBe("Rubik")
    expect(fontFamilyFor("موسم جديد", "oswald")).toBe("Rubik")
    expect(fontFamilyFor("TOP", "bebas" as never)).toBe("Inter")
  })

  it("estimateTextWidth: inter byte-identical, condensed scaled (measured 0.73/0.80)", () => {
    // A(0.68)+c(0.62)+t(0.45)+i(0.28)+o(0.62)+n(0.62) = 3.27em × 28 = 91.56 → 92.
    // La scala si applica al float: barlow round(91.56×0.73)=67, oswald round(91.56×0.8)=73.
    expect(estimateTextWidth("Action", 28)).toBe(92)
    expect(estimateTextWidth("Action", 28, "inter")).toBe(92)
    expect(estimateTextWidth("Action", 28, "barlow-condensed")).toBe(67)
    expect(estimateTextWidth("Action", 28, "oswald")).toBe(73)
    expect(estimateTextWidth("Action", 28, "bebas" as never)).toBe(92)
    // Ebraico/arabo: sempre Rubik, mai la scala condensed (avanzamenti propri).
    expect(estimateTextWidth("עונה חדשה", 24, "oswald")).toBe(estimateTextWidth("עונה חדשה", 24, "inter"))
    expect(estimateTextWidth("موسم جديد", 24, "barlow-condensed")).toBe(estimateTextWidth("موسم جديد", 24, "inter"))
  })

  it("builders emit the selected family and inter stays byte-identical", () => {
    const inter = buildGenreTextSvg("Action", "8.5", "2024", 24, "#e5e7eb", "shadow")
    const barlow = buildGenreTextSvg("Action", "8.5", "2024", 24, "#e5e7eb", "shadow", 0, undefined, "barlow-condensed")
    const oswald = buildGenreTextSvg("Action", "8.5", "2024", 24, "#e5e7eb", "shadow", 0, undefined, "oswald")
    expect(inter.svg).toContain('font-family="Inter"')
    expect(barlow.svg).toContain('font-family="Barlow Condensed"')
    expect(oswald.svg).toContain('font-family="Oswald"')
    expect(barlow.w).toBeLessThan(inter.w)
    expect(oswald.w).toBeLessThan(inter.w)
    const q = buildQualityBadgeSvg("4K", 17, "", "", false, "oswald")
    expect(q.svg).toContain('font-family="Oswald"')
  })

  it("renders genre badges in all three fonts via resvg without error", async () => {
    for (const font of ["inter", "barlow-condensed", "oswald"] as const) {
      const badge = await renderGenreBadge("Fantascienza", 8.7, 380, "2024", "pill", undefined, false, undefined, 100, font)
      expect(badge.png).toBeInstanceOf(Buffer)
      expect(badge.w).toBeGreaterThan(0)
    }
  })

  it("star as path for condensed fonts (resvg duplicates mid-run ★)", async () => {
    // resvg duplica il glifo precedente quando una tspan ★ Noto segue
    // contenuto non-Inter nello stesso <text>: i condensed usano due testi
    // rigidi senza switch di famiglia + ★ come path SVG (niente ★ testuale,
    // niente Noto nel flusso). Inter resta sul flusso unico storico.
    const genreArgs = {
      genreName: "Fantascienza", voteStr: "8.7", yearStr: "2009",
      pw: 380, style: "pill", bottomLight: false,
      parts: { showGenre: true, showYear: true, showRating: true },
    } as const
    for (const font of ["barlow-condensed", "oswald"] as const) {
      const pill = buildHouseGenreSvg({ ...genreArgs, font })
      expect(pill.svg.match(/<text /g)?.length).toBe(2)
      expect(pill.svg).not.toContain('Noto Sans Symbols 2')
      expect(pill.svg).not.toContain('★')
      expect(pill.svg).toContain('<path d="M')
      const png = await renderSVG(pill.svg, pill.w)
      expect(png).toBeInstanceOf(Buffer)
    }
    const inter = buildHouseGenreSvg({ ...genreArgs, font: "inter" })
    expect(inter.svg.match(/<text /g)?.length).toBe(1)
    expect(inter.svg.match(/\u2605/g)?.length).toBe(1)
  })

  it("cache key separates fonts (no shared bitmaps/measures)", () => {
    const a = normalizePosterCacheParams(new URLSearchParams("bfont=oswald&bs=pill"))
    const b = normalizePosterCacheParams(new URLSearchParams("bfont=barlow-condensed&bs=pill"))
    const c = normalizePosterCacheParams(new URLSearchParams("bs=pill"))
    expect(a.get("bfont")).toBe("oswald")
    expect(a.toString()).not.toBe(b.toString())
    expect(c.get("bfont")).toBeNull()
    // Invalido → normalizzato a "inter" (resa effettiva), MAI cancellato:
    // l'assenza può ereditare un altro font da mapping/default e la chiave
    // deve restare distinta (niente avvelenamento incrociato).
    const bad = normalizePosterCacheParams(new URLSearchParams("bfont=bebas&bs=pill"))
    expect(bad.get("bfont")).toBe("inter")
    expect(bad.toString()).not.toBe(c.toString())
    const empty = normalizePosterCacheParams(new URLSearchParams("bfont=&bs=pill"))
    expect(empty.get("bfont")).toBe("inter")
    expect(empty.toString()).toBe(bad.toString())
    const inter = normalizePosterCacheParams(new URLSearchParams("bfont=inter&bs=pill"))
    expect(bad.toString()).toBe(inter.toString())
  })

  it("preview and Stremio URLs carry bfont explicitly", () => {
    const ps = {
      selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 7.8, width: 500, height: 750 },
      selectedLogo: null,
      selectedBackdrop: null,
      logoScale: 60, logoOffsetX: 0, logoOffsetY: 0,
      backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
      metaInfo: { genres: [{ id: 1, name: "Action" }], voteAverage: 7.8 },
      trendRank: null, mdblistAnimeList: [],
      topEdgeColor: null, accentColor: null, autoAccentColor: null,
      lang: "it", tmdbKey: "",
    }
    const bp = {
      globalBadges: true, rankingBadges: false,
      badgeStyle: "shadow", rankingBadgeStyle: "default",
      badgeFont: "oswald",
      customBadge: null,
      gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
      topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
      genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0,
      qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
      networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    }
    expect(buildPreviewUrl(ps as never, bp as never)).toContain("bfont=oswald")
    expect(buildPreviewUrl(ps as never, { ...bp, badgeFont: undefined } as never)).toContain("bfont=inter")
    expect(buildStremioPosterSearchParams({ badgeFont: "barlow-condensed" }).get("bfont")).toBe("barlow-condensed")
    expect(buildStremioPosterSearchParams({}).get("bfont")).toBe("inter")
    expect(buildDefaultsPreviewUrl({ defaultBadgeFont: "oswald" })).toContain("bfont=oswald")
  })

  it("preview and Stremio URLs carry rs=corner and qbs=knockout explicitly", () => {
    const ps = {
      selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 7.8, width: 500, height: 750 },
      selectedLogo: null,
      selectedBackdrop: null,
      logoScale: 60, logoOffsetX: 0, logoOffsetY: 0,
      backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
      metaInfo: { genres: [{ id: 1, name: "Action" }], voteAverage: 7.8 },
      trendRank: null, mdblistAnimeList: [],
      topEdgeColor: null, accentColor: null, autoAccentColor: null,
      lang: "it", tmdbKey: "",
    }
    const bp = {
      globalBadges: true, rankingBadges: true,
      badgeStyle: "shadow", rankingBadgeStyle: "corner",
      badgeFont: "inter", qualityBadgeStyle: "knockout",
      customBadge: null,
      gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
      topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
      genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0,
      qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
      networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    }
    expect(buildPreviewUrl(ps as never, bp as never)).toContain("rs=corner")
    expect(buildPreviewUrl(ps as never, bp as never)).toContain("qbs=knockout")
    expect(buildStremioPosterSearchParams({ rankingBadgeStyle: "corner", qualityBadgeStyle: "knockout" }).get("rs")).toBe("corner")
    expect(buildStremioPosterSearchParams({ rankingBadgeStyle: "corner", qualityBadgeStyle: "knockout" }).get("qbs")).toBe("knockout")
    expect(buildDefaultsPreviewUrl({ defaultRankingBadgeStyle: "corner", defaultQualityBadgeStyle: "knockout" } as never)).toContain("rs=corner")
    expect(buildDefaultsPreviewUrl({ defaultRankingBadgeStyle: "corner", defaultQualityBadgeStyle: "knockout" } as never)).toContain("qbs=knockout")
  })

  it("visual presets persist the font; legacy presets without the key default to inter", () => {
    const withFont = visualPresetValuesSchema.parse({
      defaultGlobalBadges: true, defaultRankingBadges: true,
      defaultBadgeGenre: true, defaultBadgeYear: true, defaultBadgeRating: true, defaultBadgeQuality: true,
      defaultCustomRatings: true, defaultSeparateRatings: false,
      defaultRatingSources: ["imdb", "tmdb"],
      defaultSashOrder: [],
      defaultBadgeStyle: "shadow", defaultRankingBadgeStyle: "default",
      defaultBadgeFont: "oswald",
      defaultQualityBadgeStyle: "standard",
      defaultVideoFormats: [],
      defaultLogoScale: null, defaultLogoOffsetX: null, defaultLogoOffsetY: null,
      defaultBlurEnabled: true, defaultBlurIntensity: 20, defaultBlurFade: 50, defaultBlurDarkness: 30,
      defaultTintStrength: 20, defaultTopShade: 50, defaultGradientHeight: 30,
      defaultTopBadgeScale: 100, defaultTopBadgeOffsetX: 0, defaultTopBadgeOffsetY: 0,
      defaultGenreBadgeScale: 100, defaultGenreBadgeOffsetX: 0, defaultGenreBadgeOffsetY: 0,
      defaultQualityBadgeScale: 100, defaultQualityBadgeOffsetX: 0, defaultQualityBadgeOffsetY: 0,
      defaultNetworkLogoScale: 100, defaultNetworkLogoOffsetX: 0, defaultNetworkLogoOffsetY: 0,
      defaultNetworkLogo: true, defaultNetworkLogoPosition: "auto", defaultPreRelease: false,
      defaultRibbonEnabled: true, defaultRibbonSide: "left",
      defaultPosterShape: "poster", defaultLogoAlign: null,
      defaultPortraitFitEnabled: true, defaultLandscapeFitEnabled: true,
      landscape: {},
    })
    expect(withFont.defaultBadgeFont).toBe("oswald")
    expect(captureVisualPreset(withFont).defaultBadgeFont).toBe("oswald")
    // Legacy preset on disk (pre-font): parses, font = inter.
    const { defaultBadgeFont: _omit, ...legacy } = withFont as Record<string, unknown>
    void _omit
    const parsed = visualPresetValuesSchema.parse(legacy)
    expect(parsed.defaultBadgeFont).toBe("inter")
  })

  it("keeps the star-to-vote gap compact regardless of font, genre or visible parts", async () => {
    for (const font of ["barlow-condensed", "oswald"] as const) {
      for (const genreName of ["Commedia", "Mistero", "Fantascienza"]) {
        for (const parts of [
          { showGenre: true, showYear: true, showRating: true },
          { showGenre: false, showYear: true, showRating: true },
          { showGenre: true, showYear: false, showRating: true },
          { showGenre: false, showYear: false, showRating: true },
        ]) {
          const badge = buildHouseGenreSvg({ genreName, voteStr: "6.4", yearStr: "2026", pw: 500, style: "minimal", font, parts })
          const png = await renderSVG(badge.svg, badge.w)
          const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
          let starRight = -1
          const textColumns = new Set<number>()
          for (let y = 0; y < info.height; y++) {
            for (let x = 0; x < info.width; x++) {
              const i = (y * info.width + x) * 4
              if (data[i + 3] < 150) continue
              const [r, g, b] = data.subarray(i, i + 3)
              if (r > 200 && g > 150 && g < 230 && b < 120) starRight = Math.max(starRight, x)
              if (r > 140 && g > 140 && b > 140) textColumns.add(x)
            }
          }
          expect(starRight).toBeGreaterThan(0)
          const voteLeft = Math.min(...[...textColumns].filter((x) => x > starRight))
          expect(Number.isFinite(voteLeft)).toBe(true)
          const gap = voteLeft - starRight - 1
          expect(gap).toBeGreaterThanOrEqual(3)
          expect(gap).toBeLessThanOrEqual(10)
        }
      }
    }
  })

  it("rating star never overlaps the vote digits (condensed fonts)", async () => {
    // Caso segnalato: "Mistero" in Barlow Condensed con la ★ nel flusso
    // intersecava "8.7". Con la ★ fuori dal flusso (path rigido a destra),
    // oro e inchiostro non condividono colonne oltre l'antialiasing.
    for (const font of ["barlow-condensed", "oswald"] as const) {
      const pill = buildHouseGenreSvg({
        genreName: "Mistero", voteStr: "8.7", yearStr: "2009",
        pw: 380, style: "pill", bottomLight: false,
        parts: { showGenre: true, showYear: true, showRating: true },
        font,
      })
      const png = await renderSVG(pill.svg, pill.w)
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const gold = new Set<number>()
      const dark = new Set<number>()
      const y0 = Math.floor(info.height / 2 - 14)
      const y1 = Math.ceil(info.height / 2 + 14)
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * 4
          const a = data[i + 3]
          if (a < 10) continue
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          if (r > 200 && g > 150 && g < 230 && b < 120) gold.add(x)
          else if (r < 120 && g < 120 && b < 120) dark.add(x)
        }
      }
      const overlap = [...gold].filter((x) => dark.has(x))
      expect(overlap.length).toBeLessThanOrEqual(2)
    }
  })
})
