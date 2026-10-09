/**
 * Task7 correction cycle 1 ("metti di default solo rank"): Fresh apply scope
 * (`all` | `ranked`, default `ranked`).
 *
 * Contract:
 * - shared `PosterFreshScope` + guard + default (types.ts, default ranked);
 * - resolution precedence query > effective per-shape mapping > config >
 *   effective per-shape defaults > "ranked" (poster-config.ts), with fail-closed
 *   present-but-invalid query ("ranked" explicit, never inherits all) while an
 *   explicit `all` still overrides an inherited ranked;
 * - EFFECTIVE Fresh only when layout is fresh AND (explicit scope all OR a valid
 *   DISPLAYED rank 1..100, rankingEnabled-gated) — decided in the service
 *   AFTER topBadge selection via the shared `isFreshRank` helper, before any
 *   layout-specific branch; absent/disabled/invalid/null rank under "ranked"
 *   (and under absent/invalid scope, which fails closed to ranked) renders
 *   Standard byte-identical (same settings), a valid rank renders
 *   Fresh identical to "all" mode;
 * - cache keys separated (`freshScope` in allowlist, explicit-vs-absent,
 *   garbage canonicalizes to ranked);
 * - per-title + defaults (both shapes), preview/Stremio URLs, save, UI.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { createElement } from "react"
import { screen, fireEvent, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { resolvePosterFreshScope, resolvePosterRenderConfig } from "@/lib/poster-config"
import {
  effectiveShapeDefaultFreshScope,
  resolveOpenPosterFreshScope,
} from "@/lib/poster-layout-resolve"
import {
  effectiveMappingForShape,
  isPosterFreshScope,
  DEFAULT_POSTER_FRESH_SCOPE,
  type Mapping,
} from "@/lib/types"
import { isEffectiveFreshLayout, isFreshRank } from "@/lib/fresh-layout"
import { mappingSchema, validatePosterQuery } from "@/lib/validation"
import { configTokenSchema, decodeConfig, encodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { POSTER_CACHE_ALLOWLIST, hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildPreviewUrl, buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { isMappingDirty } from "@/lib/gradient-dirty"
import { PosterFreshScopeSelector } from "@/components/PosterLayoutSelector"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import { usePosterSave } from "@/lib/usePosterSave"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function mapping(over: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }
}

function resolveScope(
  query: string,
  opts: { mapping?: Mapping | null; config?: PictoriumUserConfig | null; sd?: ServerDefaults; shape?: "poster" | "landscape" } = {},
) {
  return resolvePosterFreshScope(
    new URLSearchParams(query),
    opts.mapping ?? null,
    opts.config ?? null,
    opts.sd ?? {},
    opts.shape ?? "poster",
  )
}

const TOKEN_BASE: PictoriumUserConfig = {
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
}

describe("PosterFreshScope guard", () => {
  it("accepts only all|ranked, default is ranked", () => {
    expect(isPosterFreshScope("all")).toBe(true)
    expect(isPosterFreshScope("ranked")).toBe(true)
    expect(isPosterFreshScope("standard")).toBe(false)
    expect(isPosterFreshScope("")).toBe(false)
    expect(isPosterFreshScope(null)).toBe(false)
    expect(isPosterFreshScope(undefined)).toBe(false)
    expect(isPosterFreshScope("ALL")).toBe(false)
    expect(DEFAULT_POSTER_FRESH_SCOPE).toBe("ranked")
  })

  it("shares the numeral validity helper (no divergent rank)", () => {
    for (let r = 1; r <= 100; r++) expect(isFreshRank(r)).toBe(true)
    for (const bad of [0, -1, 101, 1.5, NaN, null, undefined]) {
      expect(isFreshRank(bad as number | null)).toBe(false)
    }
  })
})

describe("resolvePosterFreshScope precedence", () => {
  it("defaults to ranked when absent everywhere", () => {
    expect(resolveScope("")).toBe("ranked")
    expect(resolveScope("", { mapping: mapping(), sd: {} })).toBe("ranked")
    expect(resolveScope("", { shape: "landscape", sd: { landscape: {} } })).toBe("ranked")
  })

  it("query ranked wins over mapping/config/defaults", () => {
    expect(resolveScope("freshScope=ranked", {
      mapping: mapping({ posterFreshScope: "all" }),
      config: { ...TOKEN_BASE, posterFreshScope: "all" },
      sd: { posterFreshScope: "all" },
    })).toBe("ranked")
  })

  it("explicit query all overrides a stored ranked (same contract as layout=standard)", () => {
    expect(resolveScope("freshScope=all", {
      mapping: mapping({ posterFreshScope: "ranked" }),
      sd: { posterFreshScope: "ranked" },
    })).toBe("all")
    expect(resolveScope("freshScope=all", {
      config: { ...TOKEN_BASE, posterFreshScope: "ranked" },
      sd: { posterFreshScope: "ranked" },
    })).toBe("all")
  })

  it("present-but-invalid query resolves to explicit ranked, never inherits all", () => {
    const m = mapping({ posterFreshScope: "all" })
    const sd: ServerDefaults = { posterFreshScope: "all" }
    expect(resolveScope("freshScope=bogus", { mapping: m, sd })).toBe("ranked")
    expect(resolveScope("freshScope=", { mapping: m, sd })).toBe("ranked")
  })

  it("absent query inherits ranked from the effective mapping/config/defaults", () => {
    expect(resolveScope("", { mapping: mapping({ posterFreshScope: "ranked" }) })).toBe("ranked")
    expect(
      resolveScope("", { config: { ...TOKEN_BASE, posterFreshScope: "ranked" } }),
    ).toBe("ranked")
    expect(resolveScope("", { sd: { posterFreshScope: "ranked" } })).toBe("ranked")
  })

  it("is case-insensitive on query", () => {
    expect(resolveScope("freshScope=RANKED")).toBe("ranked")
    expect(resolveScope("freshScope=All")).toBe("all")
  })

  it("landscape profile wins over the flat, absent keys follow the flat", () => {
    expect(resolveScope("", {
      shape: "landscape",
      mapping: mapping({ posterFreshScope: "all", landscape: { posterFreshScope: "ranked" } }),
    })).toBe("ranked")
    expect(resolveScope("", {
      shape: "landscape",
      mapping: mapping({ posterFreshScope: "ranked" }),
    })).toBe("ranked")
    expect(resolveScope("", {
      shape: "landscape",
      sd: { posterFreshScope: "all", landscape: { posterFreshScope: "ranked" } },
    })).toBe("ranked")
    expect(resolveScope("", {
      shape: "poster",
      sd: { posterFreshScope: "all", landscape: { posterFreshScope: "ranked" } },
    })).toBe("all")
  })

  it("render config exposes the resolved scope", () => {
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("freshScope=ranked"),
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(cfg.posterFreshScope).toBe("ranked")
    const cfgDefault = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(""),
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(cfgDefault.posterFreshScope).toBe("ranked")
  })
})

describe("open/load scope resolution (mapping effective > effective shape default)", () => {
  it("portrait always follows the flat", () => {
    expect(effectiveShapeDefaultFreshScope("all", { posterFreshScope: "ranked" }, "poster")).toBe("all")
    expect(effectiveShapeDefaultFreshScope("ranked", { posterFreshScope: "all" }, "poster")).toBe("ranked")
  })

  it("landscape prefers the profile, absent keys follow the flat", () => {
    expect(effectiveShapeDefaultFreshScope("all", { posterFreshScope: "ranked" }, "landscape")).toBe("ranked")
    expect(effectiveShapeDefaultFreshScope("ranked", { posterFreshScope: "all" }, "landscape")).toBe("all")
    expect(effectiveShapeDefaultFreshScope("all", {}, "landscape")).toBe("all")
    expect(effectiveShapeDefaultFreshScope("ranked", null, "landscape")).toBe("ranked")
  })

  it("fails closed to ranked on garbage", () => {
    expect(
      effectiveShapeDefaultFreshScope("bogus" as unknown as "all", { posterFreshScope: "bogus" } as never, "landscape"),
    ).toBe("ranked")
    expect(effectiveShapeDefaultFreshScope("ranked", { posterFreshScope: "bogus" } as never, "landscape")).toBe("ranked")
  })

  it("effective mapping wins over both defaults", () => {
    const m = mapping({ posterFreshScope: "ranked", landscape: { posterFreshScope: "all" } })
    expect(resolveOpenPosterFreshScope(m, "landscape", "all", { posterFreshScope: "ranked" })).toBe("all")
    expect(resolveOpenPosterFreshScope(m, "poster", "all", { posterFreshScope: "ranked" })).toBe("ranked")
  })

  it("legacy mapping without scope follows the land profile in landscape", () => {
    const legacy = mapping({ posterShape: "landscape" })
    expect(resolveOpenPosterFreshScope(legacy, "landscape", "all", { posterFreshScope: "ranked" })).toBe("ranked")
    expect(resolveOpenPosterFreshScope(legacy, "landscape", "ranked", { posterFreshScope: "all" })).toBe("all")
    expect(resolveOpenPosterFreshScope(legacy, "poster", "all", { posterFreshScope: "ranked" })).toBe("all")
  })

  it("effectiveMappingForShape carries the scope per shape", () => {
    const m = mapping({ posterFreshScope: "all", landscape: { posterFreshScope: "ranked" } })
    expect(effectiveMappingForShape(m, "landscape")?.posterFreshScope).toBe("ranked")
    expect(effectiveMappingForShape(m, "poster")?.posterFreshScope).toBe("all")
    expect(effectiveMappingForShape(mapping({ posterFreshScope: "ranked" }), "landscape")?.posterFreshScope).toBe("ranked")
  })
})

describe("isEffectiveFreshLayout", () => {
  it("standard selected is never Fresh regardless of scope", () => {
    expect(isEffectiveFreshLayout("standard", "all", 5)).toBe(false)
    expect(isEffectiveFreshLayout("standard", "ranked", 5)).toBe(false)
    expect(isEffectiveFreshLayout(null, "ranked", 5)).toBe(false)
  })

  it("fresh + explicit all is always Fresh; absent/invalid scope fails closed to ranked", () => {
    expect(isEffectiveFreshLayout("fresh", "all", 5)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", "all", null)).toBe(true)
    // Absent/invalid scope behaves like ranked: no rank means Standard.
    expect(isEffectiveFreshLayout("fresh", undefined, null)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", undefined, 5)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", "bogus", null)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "bogus", 5)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", null, null)).toBe(false)
  })

  it("fresh + ranked needs a valid displayed rank", () => {
    expect(isEffectiveFreshLayout("fresh", "ranked", 1)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", "ranked", 100)).toBe(true)
    for (const bad of [null, undefined, 0, -3, 101, 1.5, NaN]) {
      expect(isEffectiveFreshLayout("fresh", "ranked", bad as number | null)).toBe(false)
    }
  })
})

describe("token + validation schema", () => {
  it("config token round-trips the scope, old tokens stay valid", () => {
    const withScope = encodeConfig({ ...TOKEN_BASE, posterFreshScope: "ranked" })
    expect(decodeConfig(withScope)?.posterFreshScope).toBe("ranked")
    const legacy = encodeConfig({ ...TOKEN_BASE })
    const decoded = decodeConfig(legacy)
    expect(decoded).not.toBeNull()
    expect(decoded?.posterFreshScope).toBeUndefined()
    expect(configTokenSchema.safeParse({ ...TOKEN_BASE, posterFreshScope: "bogus" }).success).toBe(false)
  })

  it("mapping schema accepts flat + landscape scope, rejects garbage", () => {
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      posterFreshScope: "ranked", landscape: { posterFreshScope: "all" },
    }).success).toBe(true)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      posterFreshScope: "bogus",
    }).success).toBe(false)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      landscape: { posterFreshScope: "bogus" },
    }).success).toBe(false)
  })

  it("query validation bounds freshScope like layout", () => {
    expect(validatePosterQuery(new URLSearchParams("freshScope=ranked"))).toBeNull()
    expect(validatePosterQuery(new URLSearchParams(`freshScope=${"x".repeat(17)}`))).not.toBeNull()
  })
})

describe("cache keys separate the scope", () => {
  it("freshScope is allowlisted", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("freshScope")).toBe(true)
  })

  function keyOf(query: string): string {
    return normalizePosterCacheParams(new URLSearchParams(query)).toString()
  }

  it("absent, explicit all, ranked and garbage are distinct-or-canonical like layout", () => {
    const absent = keyOf("")
    const all = keyOf("freshScope=all")
    const ranked = keyOf("freshScope=ranked")
    const garbage = keyOf("freshScope=bogus")
    expect(all).not.toBe(absent)
    expect(ranked).not.toBe(absent)
    expect(ranked).not.toBe(all)
    // Fail-closed: garbage canonicalizes to the explicit-ranked key (same render).
    expect(garbage).toBe(ranked)
    // Case-insensitive canonical form.
    expect(keyOf("freshScope=RANKED")).toBe(ranked)
  })

  it("hardening canonicalizes fail-closed, preview stays exempt", () => {
    const base = { presets: true, preview: false, anonymous: false, publicInstance: false, hasMapping: false } as const
    expect(hardenPosterSearchParams(new URLSearchParams("freshScope=bogus"), base).get("freshScope")).toBe("ranked")
    expect(hardenPosterSearchParams(new URLSearchParams("freshScope=RANKED"), base).get("freshScope")).toBe("ranked")
    expect(hardenPosterSearchParams(new URLSearchParams(""), base).get("freshScope")).toBeNull()
    const preview = hardenPosterSearchParams(new URLSearchParams("freshScope=bogus"), { ...base, preview: true })
    expect(preview.get("freshScope")).toBe("bogus")
  })
})

describe("Stremio + preview URLs", () => {
  it("stremio params: absent stays absent, explicit all|ranked travel", () => {
    expect(buildStremioPosterSearchParams({}).get("freshScope")).toBeNull()
    expect(buildStremioPosterSearchParams({ posterFreshScope: "ranked" }).get("freshScope")).toBe("ranked")
    expect(buildStremioPosterSearchParams({ posterFreshScope: "all" }).get("freshScope")).toBe("all")
  })

  it("stremio poster URL carries the raw effective scope, legacy stays param-less", () => {
    const ranked = buildStremioPosterUrl({
      origin: "http://localhost",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: mapping({ posterFreshScope: "ranked" }),
    })
    expect(ranked.searchParams.get("freshScope")).toBe("ranked")
    const legacy = buildStremioPosterUrl({
      origin: "http://localhost",
      type: "movie",
      id: 1,
      defaults: {},
      mapping: mapping(),
    })
    expect(legacy.searchParams.get("freshScope")).toBeNull()
    expect(legacy.searchParams.get("layout")).toBeNull()
    const fromDefaults = buildStremioPosterUrl({
      origin: "http://localhost",
      type: "movie",
      id: 1,
      defaults: { posterFreshScope: "ranked" },
      mapping: mapping(),
    })
    expect(fromDefaults.searchParams.get("freshScope")).toBe("ranked")
  })

  function previewState() {
    return {
      selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
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
      bottomEdgeColor: null,
      accentColor: null,
      autoAccentColor: null,
      lang: "it",
      tmdbKey: "k",
      userId: null,
    }
  }

  function badgeParams() {
    return {
      globalBadges: true,
      rankingBadges: true,
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
  }

  function paramsOf(url: string): URLSearchParams {
    return new URL(String(url), "http://localhost").searchParams
  }

  it("preview URL is always explicit (absent state = ranked)", () => {
    expect(paramsOf(buildPreviewUrl(previewState() as never, badgeParams() as never)).get("freshScope")).toBe("ranked")
    expect(paramsOf(buildPreviewUrl(
      previewState() as never,
      { ...badgeParams(), posterFreshScope: "ranked" } as never,
    )).get("freshScope")).toBe("ranked")
  })

  it("defaults preview URL is always explicit, landscape profile wins", () => {
    expect(paramsOf(buildDefaultsPreviewUrl({})).get("freshScope")).toBe("ranked")
    expect(paramsOf(buildDefaultsPreviewUrl({ defaultPosterFreshScope: "ranked" })).get("freshScope")).toBe("ranked")
    expect(paramsOf(buildDefaultsPreviewUrl({ defaultPosterFreshScope: "all" })).get("freshScope")).toBe("all")
    expect(paramsOf(buildDefaultsPreviewUrl({
      defaultPosterFreshScope: "all",
      landscape: { posterFreshScope: "ranked" },
      previewShape: "landscape",
    })).get("freshScope")).toBe("ranked")
    expect(paramsOf(buildDefaultsPreviewUrl({
      defaultPosterFreshScope: "all",
      landscape: { posterFreshScope: "ranked" },
    })).get("freshScope")).toBe("all")
  })
})

describe("dirty tracking covers the scope per shape", () => {
  function check(currentScope: string | undefined, saved: Mapping | null, shape: "poster" | "landscape") {
    return isMappingDirty(
      {
        artwork: { posterPath: "/p.jpg", backdropPath: null, posterShape: shape, logoPath: null },
        gradient: { gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 50, blurDarkness: 30, tintStrength: 20, topShade: 50 },
        posterLayout: "standard",
        posterFreshScope: currentScope,
      },
      saved,
      { gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 50, blurDarkness: 30, tintStrength: 20, topShade: 50 },
      "poster",
    )
  }

  it("flags scope edits against the effective mapping", () => {
    expect(check("ranked", mapping({ posterLayout: "standard", posterFreshScope: "all" }), "poster")).toBe(true)
    expect(check("all", mapping({ posterLayout: "standard", posterFreshScope: "all" }), "poster")).toBe(false)
    expect(check("all", mapping({ posterShape: "landscape", posterLayout: "standard", posterFreshScope: "all", landscape: { posterFreshScope: "ranked" } }), "landscape")).toBe(true)
  })
})

describe("PosterFreshScopeSelector", () => {
  it("renders nothing unless Fresh is selected (preference kept, never reset)", () => {
    const { container, rerender } = renderWithCtx(
      createElement(PosterFreshScopeSelector, { layout: "standard", value: "ranked", onChange: () => {} }),
    )
    expect(container.querySelector('[data-testid="fresh-scope-selector"]')).toBeNull()
    rerender(createElement(PosterFreshScopeSelector, { layout: "fresh", value: "ranked", onChange: () => {} }))
    expect(container.querySelector('[data-testid="fresh-scope-selector"]')).not.toBeNull()
  })

  it("is a controlled select with both options", () => {
    const onChange = vi.fn()
    renderWithCtx(createElement(PosterFreshScopeSelector, { layout: "fresh", value: "all", onChange }))
    const select = screen.getByTestId("fresh-scope-select") as HTMLSelectElement
    expect(select.value).toBe("all")
    fireEvent.change(select, { target: { value: "ranked" } })
    expect(onChange).toHaveBeenCalledWith("ranked")
  })
})

describe("scope i18n (18 lingue)", () => {
  it("every dictionary defines the new keys with non-empty values", async () => {
    const mods = await Promise.all([
      import("@/lib/translations/ar.json"),
      import("@/lib/translations/cs.json"),
      import("@/lib/translations/de.json"),
      import("@/lib/translations/en.json"),
      import("@/lib/translations/es-419.json"),
      import("@/lib/translations/es.json"),
      import("@/lib/translations/fr.json"),
      import("@/lib/translations/he.json"),
      import("@/lib/translations/it.json"),
      import("@/lib/translations/ja.json"),
      import("@/lib/translations/ko.json"),
      import("@/lib/translations/nl.json"),
      import("@/lib/translations/pl.json"),
      import("@/lib/translations/pt.json"),
      import("@/lib/translations/ro.json"),
      import("@/lib/translations/sv.json"),
      import("@/lib/translations/tr.json"),
      import("@/lib/translations/vi.json"),
    ])
    const langs = ["ar","cs","de","en","es-419","es","fr","he","it","ja","ko","nl","pl","pt","ro","sv","tr","vi"] as const
    const keys = ["ui.posterFreshScope","ui.posterFreshScopeAll","ui.posterFreshScopeRanked","ui.posterFreshScopeHint"] as const
    expect(mods).toHaveLength(18)
    mods.forEach((mod, i) => {
      const dict = (mod as { default: Record<string, string> }).default ?? (mod as unknown as Record<string, string>)
      for (const key of keys) {
        expect(dict[key]?.trim(), `${langs[i]}:${key}`).toBeTruthy()
      }
    })
  })
})

// --- Real service renders: ranked-only fallback (no pinned values, equality) ---

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function patternedBase(w: number, h: number): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3a3f55"/><stop offset="1" stop-color="#141827"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#p)"/>` +
    `<rect x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="#2e4a7a" opacity="0.85"/>` +
    `<circle cx="${Math.round(w * 0.25)}" cy="${Math.round(h * 0.3)}" r="${Math.round(w * 0.18)}" fill="#7a6a2e" opacity="0.9"/>` +
    `<rect x="0" y="${Math.round(h * 0.7)}" width="${w}" height="${Math.round(h * 0.3)}" fill="#0d0d12" opacity="0.9"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
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
    rankingEnabled: true,
    genreName: "Dramma",
    voteAverage: 8.3,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: true,
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
    releaseDate: "2024-03-10",
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
    shape: "poster",
    ...overrides,
  }
}

describe("service ranked-only fallback (both shapes, equality, no pins)", () => {
  it("portrait: ranked scope without/disabled/invalid rank equals Standard with the same settings", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    // Missing rank: fallback equals Standard with the same (rank-less) settings.
    const standardNoRank = sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", posterFreshScope: "ranked", finalRank: null }),
    ))
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "ranked", finalRank: null }),
    ))).toBe(standardNoRank)
    // Scope is inert on Standard: ranked == all.
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", posterFreshScope: "all", finalRank: 6 }),
    ))).toBe(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", posterFreshScope: "ranked", finalRank: 6 }),
    )))
    // Disabled ranking (rank data present but gated off).
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "ranked", rankingEnabled: false, finalRank: 6 }),
    ))).toBe(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", rankingEnabled: false, finalRank: 6 }),
    )))
    // Invalid ranks (zero and above the accepted max).
    for (const bad of [0, 101]) {
      expect(sha(await generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "ranked", finalRank: bad }),
      ))).toBe(sha(await generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", finalRank: bad }),
      )))
    }
  }, 180000)

  it("portrait: ranked scope with a valid rank equals Fresh all mode", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const all = sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "all", finalRank: 6 }),
    ))
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", posterFreshScope: "ranked", finalRank: 6 }),
    ))).toBe(all)
    // Absent scope is the ranked default: with a valid rank it still renders
    // Fresh (byte-identical to explicit all).
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "fresh", finalRank: 6 }),
    ))).toBe(all)
    // Negative control: a valid rank really renders Fresh (not Standard).
    expect(all).not.toBe(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", finalRank: 6 }),
    )))
  }, 180000)

  it("landscape: same fallback + active equalities", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(LAND_W, LAND_H)
    const land = { shape: "landscape" } as const
    // Missing rank: fallback equals Standard with the same (rank-less) settings.
    const standardNoRank = sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "standard", posterFreshScope: "ranked", finalRank: null }),
    ))
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", posterFreshScope: "ranked", finalRank: null }),
    ))).toBe(standardNoRank)
    // Invalid rank (zero): same-settings Standard equality.
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", posterFreshScope: "ranked", finalRank: 0 }),
    ))).toBe(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "standard", finalRank: 0 }),
    )))
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", posterFreshScope: "ranked", rankingEnabled: false, finalRank: 5 }),
    ))).toBe(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "standard", rankingEnabled: false, finalRank: 5 }),
    )))
    const all = sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", posterFreshScope: "all", finalRank: 5 }),
    ))
    expect(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", posterFreshScope: "ranked", finalRank: 5 }),
    ))).toBe(all)
    const out = await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "fresh", posterFreshScope: "ranked", finalRank: 5 }),
    )
    const meta = await sharp(out).metadata()
    expect({ w: meta.width, h: meta.height }).toEqual({ w: LAND_W, h: LAND_H })
    // Negative control: a valid rank really renders Fresh (not Standard).
    expect(all).not.toBe(sha(await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, ...land, posterLayout: "standard", finalRank: 5 }),
    )))
  }, 180000)
})

describe("save freezes the scope per shape", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("portrait save writes the flat; landscape save writes the profile and preserves the flat", async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        if (typeof _url === "string" && _url.includes("/api/mappings")) {
          bodies.push(JSON.parse(String(init?.body ?? "{}")))
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => "{}",
          json: async () => ({}),
        }
      }),
    )
    function renderSaver(shape: "poster" | "landscape", scope: "all" | "ranked") {
      let save: (() => Promise<unknown>) | null = null
      function Saver() {
        const { saveConfig } = usePosterSave({
          selected: { id: 11, media_type: "movie", title: "Probe", poster_path: "/p.jpg" } as never,
          previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 0, width: 500, height: 750 },
          selectedLogo: null,
          setSelectedLogo: () => {},
          setPreviewPoster: () => {},
          setPreviewId: () => {},
          posters: [],
          metaInfo: { genres: [], voteAverage: 0 },
          trendRank: null,
          mdblistAnimeList: [],
          mappingsMap: new Map(),
          loadMappings: async () => {},
          logoScale: 75,
          logoOffsetX: 0,
          logoOffsetY: 0,
          selectedBackdrop: null,
          setSelectedBackdrop: () => {},
          backdropScale: 100,
          backdropOffsetX: 0,
          backdropOffsetY: 0,
          setBackdropScale: () => {},
          setBackdropOffsetX: () => {},
          setBackdropOffsetY: () => {},
          globalBadges: true,
          rankingBadges: true,
          badgeGenre: true,
          badgeYear: true,
          badgeRating: true,
          badgeQuality: true,
          customRatings: true,
          ratingSources: ["imdb", "tmdb"],
          separateRatings: false,
          separateRatingsStyle: "column",
          customBadge: null,
          badgePresetId: null,
          badgePresetRev: null,
          badgeStyle: "shadow",
          rankingBadgeStyle: "default",
          extraBadgeStyle: null,
          badgeFont: "inter",
          qualityBadgeStyle: "standard",
          videoFormats: null,
          defaultBadgeStyle: "shadow",
          defaultRankingBadgeStyle: "default",
          defaultExtraBadgeStyle: null,
          blurEnabled: true,
          blurIntensity: 20,
          blurFade: 50,
          blurDarkness: 30,
          landscapeBlur: {
            gradientHeight: 30,
            blurEnabled: true,
            blurIntensity: 20,
            blurFade: 70,
            blurDarkness: 30,
            tintStrength: 20,
            topShade: 50,
          },
          landscapeBlurDirty: false,
          defaultLogoScale: null,
          defaultLogoOffsetX: null,
          defaultLogoOffsetY: null,
          landscapeDefaults: null,
          tintStrength: 20,
          topShade: 50,
          gradientHeight: 30,
          setGradientHeight: () => {},
          setBlurFade: () => {},
          setLandscapeBlur: () => {},
          topBadgeScale: 100,
          topBadgeOffsetX: 0,
          topBadgeOffsetY: 0,
          extraBadgeScale: null,
          extraBadgeOffsetX: null,
          extraBadgeOffsetY: null,
          genreBadgeScale: 100,
          qualityBadgeScale: 100,
          separateBadgeScale: 130,
          separateBadgeOffsetX: 0,
          separateBadgeOffsetY: 0,
          networkLogoScale: 100,
          genreBadgeOffsetX: 0,
          genreBadgeOffsetY: 0,
          qualityBadgeOffsetX: 0,
          qualityBadgeOffsetY: 0,
          networkLogoOffsetX: 0,
          networkLogoOffsetY: 0,
          rotationPosters: [],
          autoRotateClean: false,
          defaultAutoRotateClean: false,
          excludedPosters: [],
          rotationBackdrops: [],
          autoRotateBackdrop: false,
          defaultAutoRotateBackdrop: false,
          excludedBackdrops: [],
          backdrops: [],
          accentColor: null,
          autoAccentColor: null,
          logoDisabled: false,
          setLogoDisabled: () => {},
          setLogoScale: () => {},
          setLogoOffsetX: () => {},
          setLogoOffsetY: () => {},
          networkLogo: true,
          networkLogoPosition: "auto",
          networkLogoFollowTitle: true,
          ribbonEnabled: true,
          lang: "it",
          episodeGroupId: null,
          posterShape: shape,
          posterLayout: "fresh",
          posterFreshScope: scope,
          defaultSashOrder: null,
        })
        save = saveConfig
        return null
      }
      renderWithCtx(createElement(Saver))
      return async () => {
        await act(async () => {
          await save?.()
        })
      }
    }

    const runPortrait = renderSaver("poster", "ranked")
    await runPortrait()
    const portraitBody = bodies[bodies.length - 1] as Record<string, unknown>
    expect(portraitBody.posterFreshScope).toBe("ranked")
    expect(portraitBody.landscape).toBeNull()

    const runLandscape = renderSaver("landscape", "ranked")
    await runLandscape()
    const landscapeBody = bodies[bodies.length - 1] as Record<string, unknown>
    expect((landscapeBody.landscape as Record<string, unknown>).posterFreshScope).toBe("ranked")
    expect(landscapeBody.posterFreshScope).toBe("ranked")
  })
})
