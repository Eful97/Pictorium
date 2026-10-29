import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { DEFAULT_AGE_COUNTRY, sanitizeAgeLabel } from "@/lib/certification"
import { AGE_BADGE_STYLES, DEFAULT_AGE_BADGE_STYLE, isAgeBadgeStyle } from "@/lib/badge-styles"
import {
  resolveAgeBadgeRequest,
  resolvePosterRenderConfig,
  type PosterRenderConfigInput,
} from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildDefaultsPreviewUrl, buildPreviewUrl } from "@/lib/poster-url"
import { generatePosterBuffer, renderQualityBadgeGroup, type GenerationInput } from "@/lib/poster-service"
import { renderQualityBadge, renderAgeKnockoutBadge } from "@/lib/svg-badge"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import { TOP_SHADOW_PAD } from "@/lib/badge-svg-shared"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { VideoFormat } from "@/lib/av-specs"
import { BADGE_ITEM_QUALITY_AGE, BADGE_ITEM_QUALITY_TIER, qualityFormatItemId } from "@/lib/badge-item-transforms"

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

describe("sanitizeAgeLabel", () => {
  it("preserves genuine certification labels untouched", () => {
    expect(sanitizeAgeLabel("VM14")).toBe("VM14")
    expect(sanitizeAgeLabel("PG-13")).toBe("PG-13")
    expect(sanitizeAgeLabel("TV-MA")).toBe("TV-MA")
    expect(sanitizeAgeLabel("R18+")).toBe("R18+")
    expect(sanitizeAgeLabel("FSK 16")).toBe("FSK 16")
    expect(sanitizeAgeLabel("U")).toBe("U")
  })

  it("trims surrounding whitespace", () => {
    expect(sanitizeAgeLabel("  VM14  ")).toBe("VM14")
  })

  it("hides the badge on blank/non-string input", () => {
    expect(sanitizeAgeLabel("")).toBeNull()
    expect(sanitizeAgeLabel("   ")).toBeNull()
    expect(sanitizeAgeLabel(null)).toBeNull()
    expect(sanitizeAgeLabel(undefined)).toBeNull()
    expect(sanitizeAgeLabel(16)).toBeNull()
  })

  it("rejects markup and oversized labels (fail-open hide)", () => {
    expect(sanitizeAgeLabel("<b>VM14</b>")).toBeNull()
    expect(sanitizeAgeLabel("VM14<script>")).toBeNull()
    expect(sanitizeAgeLabel("VM14😀")).toBeNull()
    expect(sanitizeAgeLabel("A".repeat(13))).toBeNull()
    expect(sanitizeAgeLabel("A".repeat(12))).toBe("A".repeat(12))
  })
})

describe("resolveAgeBadgeRequest", () => {
  it("defaults to OFF with IT country", () => {
    expect(DEFAULT_AGE_COUNTRY).toBe("IT")
    const r = resolveAgeBadgeRequest(new URLSearchParams(), null, {}, null)
    expect(r.ageBadge).toBe(false)
    expect(r.ageCountry).toBe("IT")
  })

  it("query wins over config and defaults", () => {
    const q = new URLSearchParams({ age: "1", agecountry: "us" })
    const r = resolveAgeBadgeRequest(q, { ageBadge: false, ageCountry: "FR" } as never, { ageBadge: false, ageCountry: "DE" }, null)
    expect(r.ageBadge).toBe(true)
    expect(r.ageCountry).toBe("US")
  })

  it("explicit query OFF wins over enabled defaults", () => {
    const q = new URLSearchParams({ age: "0" })
    const r = resolveAgeBadgeRequest(q, null, { ageBadge: true, ageCountry: "US" }, null)
    expect(r.ageBadge).toBe(false)
    // Country still resolves (harmless: badge hidden, no fetch, same key).
    expect(r.ageCountry).toBe("US")
  })

  it("falls through per level on invalid country (never invents)", () => {
    // A valid-shape but unknown code ("xx" -> "XX") is accepted as-is: the
    // data layer hides the badge (no such TMDB territory), never a fallback.
    expect(resolveAgeBadgeRequest(new URLSearchParams({ agecountry: "xx" }), null, { ageCountry: "US" }, null).ageCountry).toBe("XX")
    // GLOBAL is explicitly excluded (not a certification territory).
    expect(resolveAgeBadgeRequest(new URLSearchParams({ agecountry: "GLOBAL" }), null, { ageCountry: "FR" }, null).ageCountry).toBe("FR")
    // Three-letter codes are not ISO alpha-2: fall through to the default.
    expect(resolveAgeBadgeRequest(new URLSearchParams({ agecountry: "USA" }), null, {}, null).ageCountry).toBe("IT")
    expect(resolveAgeBadgeRequest(new URLSearchParams({ agecountry: "USA" }), null, { ageCountry: "US" }, null).ageCountry).toBe("US")
    // Empty query value falls back to config, then defaults, then IT.
    expect(resolveAgeBadgeRequest(new URLSearchParams({ agecountry: "" }), { ageCountry: "DE" } as never, {}, null).ageCountry).toBe("DE")
  })

  it("config token participates between query and defaults", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams(),
      { ageBadge: true, ageCountry: "jp" } as never,
      { ageBadge: false, ageCountry: "FR" },
      null,
    )
    expect(r.ageBadge).toBe(true)
    expect(r.ageCountry).toBe("JP")
  })
})

describe("resolveAgeBadgeRequest style (agebs)", () => {
  it("accepts the quality vocabulary and rejects invalid values", () => {
    // Additive age styles (authorized): same vocabulary as the quality badge,
    // while standard/knockout keep their historic renderers.
    expect(AGE_BADGE_STYLES).toEqual(["standard", "mono", "color", "knockout", "premium", "nova"])
    expect(DEFAULT_AGE_BADGE_STYLE).toBe("standard")
    expect(isAgeBadgeStyle("standard")).toBe(true)
    expect(isAgeBadgeStyle("mono")).toBe(true)
    expect(isAgeBadgeStyle("color")).toBe(true)
    expect(isAgeBadgeStyle("knockout")).toBe(true)
    expect(isAgeBadgeStyle("premium")).toBe(true)
    expect(isAgeBadgeStyle("nova")).toBe(true)
    expect(isAgeBadgeStyle("garbage")).toBe(false)
    expect(isAgeBadgeStyle("")).toBe(false)
    expect(isAgeBadgeStyle("KNOCKOUT")).toBe(false)
    expect(isAgeBadgeStyle(null)).toBe(false)
    expect(isAgeBadgeStyle(undefined)).toBe(false)
  })

  it("defaults to standard", () => {
    expect(resolveAgeBadgeRequest(new URLSearchParams(), null, {}, null).ageBadgeStyle).toBe("standard")
  })

  it("query wins over token and defaults", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams({ agebs: "knockout" }),
      { ageBadgeStyle: "standard" } as never,
      { ageBadgeStyle: "standard" },
      null,
    )
    expect(r.ageBadgeStyle).toBe("knockout")
  })

  it("present-but-invalid query collapses to standard (fail-closed, no inheritance)", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams({ agebs: "garbage" }),
      { ageBadgeStyle: "knockout" } as never,
      { ageBadgeStyle: "knockout" },
      null,
    )
    expect(r.ageBadgeStyle).toBe("standard")
  })

  it("token participates between query and defaults", () => {
    const r = resolveAgeBadgeRequest(
      new URLSearchParams(),
      { ageBadgeStyle: "knockout" } as never,
      { ageBadgeStyle: "standard" },
      null,
    )
    expect(r.ageBadgeStyle).toBe("knockout")
  })

  it("falls back through effective then flat defaults", () => {
    expect(resolveAgeBadgeRequest(new URLSearchParams(), null, { ageBadgeStyle: "knockout" }, null).ageBadgeStyle).toBe("knockout")
    expect(resolveAgeBadgeRequest(new URLSearchParams(), null, {}, { ageBadgeStyle: "knockout" }).ageBadgeStyle).toBe("knockout")
    // Invalid stored values collapse to standard (never break the render).
    expect(resolveAgeBadgeRequest(new URLSearchParams(), null, { ageBadgeStyle: "garbage" } as never, null).ageBadgeStyle).toBe("standard")
  })
})

describe("resolvePosterRenderConfig age pair", () => {
  it("resolves ageBadge/ageCountry with per-title chain (query wins)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ age: "1", agecountry: "FR" }),
    }))
    expect(r.ageBadge).toBe(true)
    expect(r.ageCountry).toBe("FR")
  })

  it("legacy mapping without age keys inherits the shape defaults (no migration)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg", logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01", badgeQuality: true } as never,
      sd: { ageBadge: true, ageCountry: "US" },
    }))
    expect(r.ageBadge).toBe(true)
    expect(r.ageCountry).toBe("US")
  })

  it("per-title mapping age wins over the shape defaults", () => {
    const r = resolvePosterRenderConfig(baseInput({
      mapping: { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg", logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01", ageBadge: false, ageCountry: "FR", ageBadgeStyle: "knockout" } as never,
      sd: { ageBadge: true, ageCountry: "US", ageBadgeStyle: "standard" },
    }))
    expect(r.ageBadge).toBe(false)
    expect(r.ageCountry).toBe("FR")
    expect(r.ageBadgeStyle).toBe("knockout")
  })

  it("default OFF preserves the legacy render path", () => {
    const r = resolvePosterRenderConfig(baseInput())
    expect(r.ageBadge).toBe(false)
    expect(r.ageCountry).toBe("IT")
  })

  it("threads the per-title age style (query > mapping > token > defaults > standard)", () => {
    expect(resolvePosterRenderConfig(baseInput()).ageBadgeStyle).toBe("standard")
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ agebs: "knockout" }),
    })).ageBadgeStyle).toBe("knockout")
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ agebs: "garbage" }),
      sd: { ageBadgeStyle: "knockout" },
    })).ageBadgeStyle).toBe("standard")
    expect(resolvePosterRenderConfig(baseInput({
      sd: { ageBadgeStyle: "knockout" },
    })).ageBadgeStyle).toBe("knockout")
  })
})

describe("stremio poster params age emission", () => {
  it("emits nothing when disabled (existing URLs byte-identical)", () => {
    const p = buildStremioPosterSearchParams({})
    expect(p.has("age")).toBe(false)
    expect(p.has("agecountry")).toBe(false)
    const p2 = buildStremioPosterSearchParams({ ageBadge: false, ageCountry: "US" })
    expect(p2.has("age")).toBe(false)
    expect(p2.has("agecountry")).toBe(false)
  })

  it("emits age=1 plus canonical country when enabled", () => {
    const p = buildStremioPosterSearchParams({ ageBadge: true, ageCountry: "us" })
    expect(p.get("age")).toBe("1")
    expect(p.get("agecountry")).toBe("US")
  })

  it("is explicit both ways with a config token (token must not win silently)", () => {
    const on = buildStremioPosterSearchParams({ config: "tok", ageBadge: true, ageCountry: "FR" })
    expect(on.get("age")).toBe("1")
    expect(on.get("agecountry")).toBe("FR")
    const off = buildStremioPosterSearchParams({ config: "tok" })
    expect(off.get("age")).toBe("0")
    expect(off.has("agecountry")).toBe(false)
  })

  it("never emits GLOBAL or garbage countries", () => {
    const g = buildStremioPosterSearchParams({ ageBadge: true, ageCountry: "GLOBAL" })
    expect(g.get("age")).toBe("1")
    expect(g.has("agecountry")).toBe(false)
  })
})

describe("poster cache key age handling", () => {
  it("keeps age params in the allowlist", () => {
    const p = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=US&bq=1"))
    expect(p.get("age")).toBe("1")
    expect(p.get("agecountry")).toBe("US")
  })

  it("canonicalizes lowercase countries to one key", () => {
    const a = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=us")).toString()
    const b = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=US")).toString()
    expect(a).toBe(b)
  })

  it("drops invalid countries so they collapse onto the default key", () => {
    const garbage = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=USA")).toString()
    const absent = normalizePosterCacheParams(new URLSearchParams("age=1")).toString()
    expect(garbage).toBe(absent)
    const global = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=GLOBAL")).toString()
    expect(global).toBe(absent)
    const digits = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=1A")).toString()
    expect(digits).toBe(absent)
  })

  it("keeps distinct countries on distinct keys", () => {
    const us = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=US")).toString()
    const it = normalizePosterCacheParams(new URLSearchParams("age=1&agecountry=IT")).toString()
    expect(us).not.toBe(it)
  })
})

describe("poster cache key age-style handling (agebs)", () => {
  it("keeps agebs in the allowlist", () => {
    expect(normalizePosterCacheParams(new URLSearchParams("agebs=knockout")).get("agebs")).toBe("knockout")
    expect(normalizePosterCacheParams(new URLSearchParams("agebs=standard")).get("agebs")).toBe("standard")
  })

  it("keeps distinct styles on distinct keys", () => {
    const ko = normalizePosterCacheParams(new URLSearchParams("agebs=knockout")).toString()
    const std = normalizePosterCacheParams(new URLSearchParams("agebs=standard")).toString()
    expect(ko).not.toBe(std)
  })

  it("collapses invalid values onto the default key", () => {
    const garbage = normalizePosterCacheParams(new URLSearchParams("agebs=garbage")).toString()
    const explicit = normalizePosterCacheParams(new URLSearchParams("agebs=standard")).toString()
    expect(garbage).toBe(explicit)
  })

  it("keeps absence distinct from explicit standard (absence may inherit knockout)", () => {
    const absent = normalizePosterCacheParams(new URLSearchParams("age=1")).toString()
    const explicit = normalizePosterCacheParams(new URLSearchParams("age=1&agebs=standard")).toString()
    expect(absent).not.toBe(explicit)
  })
})

describe("preview URL age roundtrip", () => {
  it("buildPreviewUrl is always explicit (WYSIWYG, defaults included)", () => {
    const ps = { selected: { id: 1 } } as never
    const off = new URL(buildPreviewUrl(ps, { ageBadge: false } as never))
    expect(off.searchParams.get("age")).toBe("0")
    expect(off.searchParams.get("agecountry")).toBe("IT")
    const on = new URL(buildPreviewUrl(ps, { ageBadge: true, ageCountry: "us" } as never))
    expect(on.searchParams.get("age")).toBe("1")
    expect(on.searchParams.get("agecountry")).toBe("US")
  })

  it("buildDefaultsPreviewUrl carries toggle plus independent country", () => {
    const off = new URL(buildDefaultsPreviewUrl({}))
    expect(off.searchParams.get("age")).toBe("0")
    expect(off.searchParams.get("agecountry")).toBe("IT")
    const on = new URL(buildDefaultsPreviewUrl({ defaultAgeBadge: true, defaultAgeCountry: "FR" }))
    expect(on.searchParams.get("age")).toBe("1")
    expect(on.searchParams.get("agecountry")).toBe("FR")
  })
})

describe("renderQualityBadgeGroup age stacking", () => {
  const PW = 380

  it("returns null with no quality, no formats and no age (legacy path)", async () => {
    await expect(renderQualityBadgeGroup(null, "standard", null, PW)).resolves.toBeNull()
    await expect(renderQualityBadgeGroup(null, "standard", [], PW, false, "inter", null)).resolves.toBeNull()
  })

  it("renders the age pill alone when 4K is absent", async () => {
    const group = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14")
    expect(group).not.toBeNull()
    expect(group!.w).toBeGreaterThan(0)
    expect(group!.h).toBeGreaterThan(0)
    expect(group!.png.length).toBeGreaterThan(0)
  })

  it("stacks age below quality (taller group, same column)", async () => {
    const qualityOnly = await renderQualityBadgeGroup("4K", "standard", null, PW, false, "inter", null)
    const withAge = await renderQualityBadgeGroup("4K", "standard", null, PW, false, "inter", "VM14")
    expect(qualityOnly).not.toBeNull()
    expect(withAge).not.toBeNull()
    // Same column width family, strictly taller: quality on top, age below.
    expect(withAge!.h).toBeGreaterThan(qualityOnly!.h)
    expect(Math.abs(withAge!.w - qualityOnly!.w)).toBeLessThanOrEqual(qualityOnly!.w)
  })

  it("keeps the quality-only bitmap byte-identical without age", async () => {
    const a = await renderQualityBadgeGroup("4K", "standard", null, PW, false, "inter", null)
    const b = await renderQualityBadgeGroup("4K", "standard", null, PW, false, "inter", undefined)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.png.equals(b!.png)).toBe(true)
  })

  it("treats blank age as absent", async () => {
    await expect(renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "   ")).resolves.toBeNull()
    const q = await renderQualityBadgeGroup("4K", "standard", null, PW, false, "inter", "")
    const plain = await renderQualityBadgeGroup("4K", "standard", null, PW, false, "inter", null)
    expect(q!.png.equals(plain!.png)).toBe(true)
  })
})

describe("generatePosterBuffer age + disabled quality (production regression)", () => {
  async function darkPoster(): Promise<Buffer> {
    return sharp({
      create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
    })
      .jpeg()
      .toBuffer()
  }

  function posterInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
      voteAverage: null,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      badgeGenre: true,
      badgeYear: false,
      badgeRating: false,
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

  const TECH_FORMATS = ["dv", "atmos"] as VideoFormat[]

  it("age-only with bq=0 renders byte-identical to no tech stack at all (hidden quality not revived)", async () => {
    const poster = await darkPoster()
    const suppliedButDisabled = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: false,
      quality: "4K",
      videoFormats: TECH_FORMATS,
      ageLabel: "VM14",
    }))
    const cleanAgeOnly = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: false,
      quality: null,
      videoFormats: null,
      ageLabel: "VM14",
    }))
    expect(suppliedButDisabled.equals(cleanAgeOnly)).toBe(true)
  })

  it("toggling age off with bq=0 removes the group without resurrecting tech", async () => {
    const poster = await darkPoster()
    const withAge = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: false,
      quality: "4K",
      videoFormats: TECH_FORMATS,
      ageLabel: "VM14",
    }))
    const withoutAge = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: false,
      quality: "4K",
      videoFormats: TECH_FORMATS,
      ageLabel: null,
    }))
    const legacy = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: false,
      quality: null,
      videoFormats: null,
      ageLabel: null,
    }))
    // The age pill was really rendered (group present with age, gone without).
    expect(withAge.equals(withoutAge)).toBe(false)
    // Age off + bq off + tech supplied = legacy bytes (tech stays hidden).
    expect(withoutAge.equals(legacy)).toBe(true)
  })

  it("enabled quality still stacks above age (ON behavior unchanged)", async () => {
    const poster = await darkPoster()
    const stacked = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: true,
      quality: "4K",
      videoFormats: null,
      ageLabel: "VM14",
    }))
    const qualityOnly = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: true,
      quality: "4K",
      videoFormats: null,
      ageLabel: null,
    }))
    const ageOnly = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: false,
      quality: null,
      videoFormats: null,
      ageLabel: "VM14",
    }))
    expect(stacked.equals(qualityOnly)).toBe(false)
    expect(stacked.equals(ageOnly)).toBe(false)
  })

  it("default off stays byte-identical (absent vs explicit nulls)", async () => {
    const poster = await darkPoster()
    const absent = await generatePosterBuffer(posterInput({ posterBuf: poster }))
    const explicit = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      badgeQuality: true,
      quality: null,
      videoFormats: null,
      ageLabel: null,
    }))
    expect(absent.equals(explicit)).toBe(true)
  })
})

describe("renderQualityBadgeGroup age style + order (quality, age, formats)", () => {
  const PW = 380
  const GAP = Math.round(5 * PW / 380)

  async function rowBrightness(png: Buffer): Promise<number[]> {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    const channels = info.channels
    const rows: number[] = []
    for (let y = 0; y < info.height; y++) {
      let sum = 0
      let n = 0
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * channels
        const a = channels >= 4 ? data[i + 3] : 255
        if (a > 128) {
          sum += (data[i] + data[i + 1] + data[i + 2]) / 3
          n++
        }
      }
      rows.push(n > 0 ? sum / n : 0)
    }
    return rows
  }

  function bandMean(rows: number[], from: number, to: number): number {
    const slice = rows.slice(from, to)
    return slice.reduce((s, v) => s + v, 0) / slice.length
  }

  it("renders knockout age alone (white tag, distinct from standard)", async () => {
    const std = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", "standard")
    const ko = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", "knockout")
    expect(std).not.toBeNull()
    expect(ko).not.toBeNull()
    expect(ko!.png.equals(std!.png)).toBe(false)
    // Knockout tag body is opaque white: middle rows average near-white.
    const rows = await rowBrightness(ko!.png)
    const mid = Math.floor(rows.length / 2)
    expect(bandMean(rows, mid - 2, mid + 3)).toBeGreaterThan(180)
  })

  it("defaults to standard when the style is absent or invalid", async () => {
    const omitted = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14")
    const explicit = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", "standard")
    const garbage = await renderQualityBadgeGroup(null, "standard", null, PW, false, "inter", "VM14", "garbage" as never)
    expect(omitted).not.toBeNull()
    expect(omitted!.png.equals(explicit!.png)).toBe(true)
    expect(garbage!.png.equals(explicit!.png)).toBe(true)
  })

  it("stacks quality, knockout age, then formats top-to-bottom", async () => {
    const q = await renderQualityBadge("4K", PW, true, "inter")
    const ko = await renderAgeKnockoutBadge("VM14", PW, "inter")
    const group = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, true, "inter", "VM14", "knockout")
    expect(group).not.toBeNull()
    const vq = q.h - TOP_SHADOW_PAD * 2
    const va = ko.h - TOP_SHADOW_PAD * 2
    // Format band from the PAINTED slot: the A/V mark is width-normalized
    // (natural aspect height), so it is not the bare icon's old height.
    const formatItem = group!.items[group!.items.length - 1]
    expect(group!.items.map((i) => i.id)).toEqual([BADGE_ITEM_QUALITY_TIER, BADGE_ITEM_QUALITY_AGE, qualityFormatItemId("imax")])
    const vf = formatItem.h - TOP_SHADOW_PAD * 2
    // Structural: all three bands plus gaps (order-independent sum).
    expect(group!.h).toBe(TOP_SHADOW_PAD * 2 + vq + GAP + va + GAP + vf)
    const rows = await rowBrightness(group!.png)
    // Quality first (dark pill on light tops), age second (white tag).
    expect(bandMean(rows, TOP_SHADOW_PAD, TOP_SHADOW_PAD + vq)).toBeLessThan(120)
    expect(bandMean(rows, TOP_SHADOW_PAD + vq + GAP, TOP_SHADOW_PAD + vq + GAP + va)).toBeGreaterThan(180)
    // The bottom band is the format icon, not the age tag.
    expect(bandMean(rows, group!.h - TOP_SHADOW_PAD - vf, group!.h - TOP_SHADOW_PAD)).toBeLessThan(150)
  })

  it("keeps quality-then-formats stacking without age (style alone invents nothing)", async () => {
    const group = await renderQualityBadgeGroup("4K", "standard", ["imax"], PW, true, "inter", null, "knockout")
    const q = await renderQualityBadge("4K", PW, true, "inter")
    expect(group).not.toBeNull()
    const formatItem = group!.items[group!.items.length - 1]
    expect(group!.h).toBe(TOP_SHADOW_PAD * 2 + (q.h - TOP_SHADOW_PAD * 2) + GAP + (formatItem.h - TOP_SHADOW_PAD * 2))
  })

  it("renders age between quality and formats without a tier (missing quality)", async () => {
    const group = await renderQualityBadgeGroup(null, "standard", ["imax"], PW, true, "inter", "VM14", "knockout")
    const ko = await renderAgeKnockoutBadge("VM14", PW, "inter")
    expect(group).not.toBeNull()
    const va = ko.h - TOP_SHADOW_PAD * 2
    const formatItem = group!.items[group!.items.length - 1]
    expect(group!.h).toBe(TOP_SHADOW_PAD * 2 + va + GAP + (formatItem.h - TOP_SHADOW_PAD * 2))
    const rows = await rowBrightness(group!.png)
    // Age on top (white tag), formats below.
    expect(bandMean(rows, TOP_SHADOW_PAD, TOP_SHADOW_PAD + va)).toBeGreaterThan(180)
  })
})
