import { describe, expect, it, vi, afterEach, beforeEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT,
  SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH,
  detectSeasonalThemeFromCatalogName,
  normalizeSeasonalTheme,
  normalizeSeasonalThemeChoice,
  resolveEffectiveSeasonalTheme,
  sanitizeSeasonalCustomKeywords,
} from "@/lib/seasonal-theme"
import { resolveCatalogSeasonalTheme } from "@/lib/catalog-handler"
import { resolvePosterRenderConfig, resolveSeasonalTheme } from "@/lib/poster-config"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildPreviewUrl } from "@/lib/poster-url"
import { mappingSchema } from "@/lib/validation"
import { useNavigation } from "@/lib/useNavigation"
import { getRegionDef } from "@/lib/regions"
import type { CustomCatalogConfig } from "@/lib/types"

const IT = getRegionDef("IT")

function custom(id: string, name: string, type: CustomCatalogConfig["type"] = "movie"): CustomCatalogConfig {
  return { id, name, type, url: "https://example.invalid/list.csv" }
}

function renderConfig(qs: string, mapping: unknown) {
  return resolvePosterRenderConfig({
    searchParams: new URLSearchParams(qs),
    mapping: mapping as never,
    configOverride: null,
    sd: {} as never,
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
  })
}

describe("custom seasonal keywords (bounded, literal, list-names only)", () => {
  it("sanitizes lists: arrays only, trim, length bound, dedupe, cap", () => {
    expect(sanitizeSeasonalCustomKeywords(null)).toEqual([])
    expect(sanitizeSeasonalCustomKeywords(undefined)).toEqual([])
    expect(sanitizeSeasonalCustomKeywords("spooky")).toEqual([])
    expect(sanitizeSeasonalCustomKeywords({})).toEqual([])
    expect(sanitizeSeasonalCustomKeywords(["  Spooky  ", "", "   "])).toEqual(["Spooky"])
    // Length bound drops overlong entries (never truncates into a new phrase).
    expect(sanitizeSeasonalCustomKeywords(["x".repeat(SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH + 1)])).toEqual([])
    expect(sanitizeSeasonalCustomKeywords(["x".repeat(SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH)]).length).toBe(1)
    // Dedupe is match-form based (case/diacritic-insensitive).
    expect(sanitizeSeasonalCustomKeywords(["Noël", "noel", "NOEL"])).toEqual(["Noël"])
    // Non-strings are dropped, cap keeps the first MAX entries.
    const many = Array.from({ length: SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT + 5 }, (_, i) => `kw${i}`)
    const cleaned = sanitizeSeasonalCustomKeywords([42, null, ...many] as unknown[])
    expect(cleaned.length).toBe(SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT)
    expect(cleaned[0]).toBe("kw0")
  })

  it("matches custom halloween phrases whole-word, case-insensitive", () => {
    const custom = { halloween: ["spooky season"], christmas: [] }
    expect(detectSeasonalThemeFromCatalogName("Spooky Season marathon", custom)).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("SPOOKY SEASON!", custom)).toBe("halloween")
    // Whole-word: substrings never match.
    expect(detectSeasonalThemeFromCatalogName("Spooky Seasonsale", custom)).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("My SpookySeason", custom)).toBeNull()
    // Titles are never matched: only the passed list name is inspected.
    expect(detectSeasonalThemeFromCatalogName("Cozy Autumn", custom)).toBeNull()
  })

  it("matches custom christmas phrases whole-word, case-insensitive", () => {
    const custom = { halloween: [], christmas: ["pumpkin spice"] }
    expect(detectSeasonalThemeFromCatalogName("Pumpkin Spice movies", custom)).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("pumpkin spice!!!", custom)).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("PumpkinSpice", custom)).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Pumpkin Spicesale", custom)).toBeNull()
  })

  it("treats custom keywords literally (no user regex)", () => {
    const custom = { halloween: ["hallow.*een"], christmas: [] }
    // A regex would match "halloween"; the literal phrase does not.
    expect(detectSeasonalThemeFromCatalogName("Halloween", custom)).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("hallow.*een night", custom)).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("hallowween night", custom)).toBeNull()
  })

  it("keeps Halloween precedence with custom keywords on mixed names", () => {
    expect(
      detectSeasonalThemeFromCatalogName("Spooky Season + Pumpkin Spice", {
        halloween: ["spooky season"],
        christmas: ["pumpkin spice"],
      }),
    ).toBe("halloween")
    // Custom halloween beats built-in christmas.
    expect(
      detectSeasonalThemeFromCatalogName("Festa di Natale spooky", { halloween: ["spooky"], christmas: [] }),
    ).toBe("halloween")
    // Built-in halloween beats custom christmas.
    expect(
      detectSeasonalThemeFromCatalogName("Halloween cozy films", { halloween: [], christmas: ["cozy"] }),
    ).toBe("halloween")
  })

  it("retains all built-ins when custom keywords are provided", () => {
    const custom = { halloween: ["spooky"], christmas: ["cozy"] }
    expect(detectSeasonalThemeFromCatalogName("Halloween", custom)).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("Festa di Natale", custom)).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("Weihnachten Filme", custom)).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("クリスマス特集", custom)).toBe("christmas")
    // Empty custom = legacy behavior byte-identical.
    expect(detectSeasonalThemeFromCatalogName("Halloween", {})).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("Halloween", null)).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("Natalie", custom)).toBeNull()
  })

  it("matches custom CJK phrases by substring (spaceless catalog names)", () => {
    const custom = { halloween: [], christmas: ["聖誕"] }
    expect(detectSeasonalThemeFromCatalogName("聖誕特集", custom)).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("電影聖誕節", custom)).toBe("christmas")
  })
})

describe("per-title seasonal choice (precedence over the list theme)", () => {
  it("normalizes the choice fail-closed (invalid = Automatic)", () => {
    expect(normalizeSeasonalThemeChoice("halloween")).toBe("halloween")
    expect(normalizeSeasonalThemeChoice("  CHRISTMAS ")).toBe("christmas")
    expect(normalizeSeasonalThemeChoice("none")).toBe("none")
    expect(normalizeSeasonalThemeChoice("NONE")).toBe("none")
    expect(normalizeSeasonalThemeChoice(null)).toBeNull()
    expect(normalizeSeasonalThemeChoice(undefined)).toBeNull()
    expect(normalizeSeasonalThemeChoice("")).toBeNull()
    expect(normalizeSeasonalThemeChoice("easter")).toBeNull()
    expect(normalizeSeasonalThemeChoice("automatic")).toBeNull()
    expect(normalizeSeasonalThemeChoice(42)).toBeNull()
    // The query-only normalizer is untouched (no "none" theme).
    expect(normalizeSeasonalTheme("none")).toBeNull()
  })

  it("resolves explicit choice over list, none suppresses, absent inherits", () => {
    expect(resolveEffectiveSeasonalTheme("halloween", "christmas")).toBe("halloween")
    expect(resolveEffectiveSeasonalTheme("christmas", "halloween")).toBe("christmas")
    expect(resolveEffectiveSeasonalTheme("christmas", null)).toBe("christmas")
    expect(resolveEffectiveSeasonalTheme("none", "halloween")).toBeNull()
    expect(resolveEffectiveSeasonalTheme("none", null)).toBeNull()
    expect(resolveEffectiveSeasonalTheme(null, "halloween")).toBe("halloween")
    expect(resolveEffectiveSeasonalTheme(null, null)).toBeNull()
    expect(resolveEffectiveSeasonalTheme(undefined, "christmas")).toBe("christmas")
    // Invalid choice = Automatic (follows the list, never a default theme).
    expect(resolveEffectiveSeasonalTheme("easter", "halloween")).toBe("halloween")
    expect(resolveEffectiveSeasonalTheme("easter", null)).toBeNull()
  })

  it("server render: mapping choice beats query, generic meta stays unframed", () => {
    // Explicit themed mapping frames without any list context.
    expect(renderConfig("", { seasonalTheme: "halloween" }).seasonalTheme).toBe("halloween")
    expect(renderConfig("", { seasonalTheme: "christmas" }).seasonalTheme).toBe("christmas")
    // Explicit mapping beats a conflicting list query.
    expect(renderConfig("theme=christmas", { seasonalTheme: "halloween" }).seasonalTheme).toBe("halloween")
    // Explicit none suppresses an inherited list theme.
    expect(renderConfig("theme=halloween", { seasonalTheme: "none" }).seasonalTheme).toBeNull()
    // Absent (Automatic) follows the list; generic meta with no list is unframed.
    expect(renderConfig("theme=halloween", null).seasonalTheme).toBe("halloween")
    expect(renderConfig("", null).seasonalTheme).toBeNull()
    // Invalid saved choice = Automatic (legacy-identical).
    expect(renderConfig("theme=halloween", { seasonalTheme: "easter" }).seasonalTheme).toBe("halloween")
    expect(renderConfig("", { seasonalTheme: "easter" }).seasonalTheme).toBeNull()
    // The clean banner stays unframed even with an explicit mapping choice.
    expect(renderConfig("shape=landscape&hideLogo=1", { seasonalTheme: "halloween" }).seasonalTheme).toBeNull()
    expect(renderConfig("shape=landscape&hideLogo=1&theme=halloween", { seasonalTheme: "christmas" }).seasonalTheme).toBeNull()
    // Portrait + hideLogo keeps the mapping frame (hideLogo hides only the logo).
    expect(renderConfig("hideLogo=1", { seasonalTheme: "halloween" }).seasonalTheme).toBe("halloween")
  })

  it("query-only resolver is unchanged (list context, no mapping chain)", () => {
    expect(resolveSeasonalTheme(new URLSearchParams("theme=halloween"), "poster")).toBe("halloween")
    expect(resolveSeasonalTheme(new URLSearchParams(""), "poster")).toBeNull()
  })
})

describe("catalog-side custom keywords (same matcher, server and client)", () => {
  const base = {
    customCatalogs: [] as CustomCatalogConfig[],
    catalogRenames: {} as Record<string, string>,
    rankingSourceMovie: "",
    rankingSourceSeries: "",
    region: IT,
  }

  it("themes a renamed built-in catalog on a custom keyword", () => {
    const renamed = {
      ...base,
      catalogRenames: { "pictorium-jw-movies": "Spooky Season Top 20" },
      seasonalKeywords: { halloween: ["spooky season"], christmas: [] },
    }
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", renamed)).toBe("halloween")
    // Same title elsewhere stays unframed.
    expect(resolveCatalogSeasonalTheme("pictorium-netflix-movies", "movie", renamed)).toBeNull()
  })

  it("themes custom lists on custom keywords (rename wins)", () => {
    const customs = [custom("cozy", "Pumpkin Spice Nights")]
    const opts = { ...base, customCatalogs: customs, seasonalKeywords: { halloween: [], christmas: ["pumpkin spice"] } }
    expect(resolveCatalogSeasonalTheme("pictorium-custom-movie-cozy", "movie", opts)).toBe("christmas")
    expect(resolveCatalogSeasonalTheme("pictorium-custom-series-cozy", "series", opts)).toBeNull()
  })

  it("keeps mixed names deterministic with custom keywords", () => {
    const opts = {
      ...base,
      catalogRenames: { "pictorium-jw-movies": "Spooky Season + Pumpkin Spice" },
      seasonalKeywords: { halloween: ["spooky season"], christmas: ["pumpkin spice"] },
    }
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", opts)).toBe("halloween")
  })

  it("without custom keywords the behavior is legacy-identical", () => {
    const renamed = { ...base, catalogRenames: { "pictorium-jw-movies": "Spooky Season Top 20" } }
    // No custom keywords: no match (built-ins untouched).
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", renamed)).toBeNull()
    const builtin = { ...base, catalogRenames: { "pictorium-jw-movies": "My Halloween marathon" } }
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", builtin)).toBe("halloween")
  })
})

describe("mapping validation (per-title choice persistence contract)", () => {
  it("accepts halloween/christmas/none/null/absent, rejects garbage", () => {
    const base = { tmdbId: 1, mediaType: "movie" as const, title: "T", posterPath: "/p.jpg" }
    for (const seasonalTheme of ["halloween", "christmas", "none", null, undefined]) {
      const parsed = mappingSchema.safeParse({ ...base, seasonalTheme })
      expect(parsed.success, String(seasonalTheme)).toBe(true)
    }
    expect(mappingSchema.safeParse({ ...base, seasonalTheme: "easter" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, seasonalTheme: "automatic" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, seasonalTheme: "" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, seasonalTheme: 42 }).success).toBe(false)
  })
})

describe("config token persistence (namespace + profileless paths)", () => {
  beforeEach(() => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function importConfigToken() {
    vi.resetModules()
    return import("@/lib/config-token")
  }

  it("round-trips custom keywords in the full token", async () => {
    const { encodeConfig, decodeConfig } = await importConfigToken()
    const config = {
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow" as const,
      rankingBadgeStyle: "default" as const,
      blurEnabled: true,
      blurIntensity: 5,
      blurFade: 60,
      blurDarkness: 40,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: false,
      logoFitEnabled: true,
      seasonalHalloweenKeywords: ["spooky season"],
      seasonalChristmasKeywords: ["pumpkin spice", "cozy"],
    }
    expect(decodeConfig(encodeConfig(config))).toEqual(config)
  })

  it("keeps legacy tokens valid (absent keywords = built-ins only)", async () => {
    const { encodeConfig, decodeConfig } = await importConfigToken()
    const config = {
      globalBadges: true,
      rankingBadges: true,
      badgeStyle: "shadow" as const,
      rankingBadgeStyle: "default" as const,
      blurEnabled: true,
      blurIntensity: 5,
      blurFade: 60,
      blurDarkness: 40,
      gradientHeight: 30,
      networkLogo: true,
      autoRotateClean: false,
      logoFitEnabled: true,
    }
    const decoded = decodeConfig(encodeConfig(config))
    expect(decoded?.seasonalHalloweenKeywords).toBeUndefined()
    expect(decoded?.seasonalChristmasKeywords).toBeUndefined()
  })

  it("rejects overlong/oversized keyword arrays in the token schema", async () => {
    const { configTokenSchema, partialCatalogTokenSchema } = await importConfigToken()
    const tooMany = Array.from({ length: SEASONAL_CUSTOM_KEYWORDS_MAX_COUNT + 1 }, (_, i) => `kw${i}`)
    expect(configTokenSchema.safeParse({ seasonalHalloweenKeywords: tooMany }).success).toBe(false)
    expect(configTokenSchema.safeParse({ seasonalHalloweenKeywords: ["x".repeat(SEASONAL_CUSTOM_KEYWORD_MAX_LENGTH + 1)] }).success).toBe(false)
    // The catalog-only token carries the same bounded fields.
    expect(
      partialCatalogTokenSchema.safeParse({ seasonalHalloweenKeywords: ["spooky"], seasonalChristmasKeywords: ["cozy"] }).success,
    ).toBe(true)
    expect(partialCatalogTokenSchema.safeParse({ seasonalHalloweenKeywords: tooMany }).success).toBe(false)
  })
})

describe("Stremio URL builders (saved choice follows the title, banner clean)", () => {
  const defaults = {}

  it("emits an effective themed choice on poster/landscape, never on the clean banner", () => {
    const effective = resolveEffectiveSeasonalTheme("halloween", null)
    const poster = buildStremioPosterUrl({ origin: "http://localhost:3000", type: "movie", id: 42, defaults, seasonalTheme: effective ?? undefined })
    expect(poster.searchParams.get("theme")).toBe("halloween")
    const suppressed = resolveEffectiveSeasonalTheme("none", "halloween")
    const plain = buildStremioPosterUrl({ origin: "http://localhost:3000", type: "movie", id: 42, defaults, seasonalTheme: suppressed ?? undefined })
    expect(plain.searchParams.has("theme")).toBe(false)
    const banner = buildStremioPosterUrl({
      origin: "http://localhost:3000", type: "movie", id: 42, defaults,
      forceShape: "landscape", hideLogo: true, seasonalTheme: effective ?? undefined,
    })
    expect(banner.searchParams.has("theme")).toBe(false)
  })

  it("keeps search-param builder parity (explicit themes only)", () => {
    expect(buildStremioPosterSearchParams({ seasonalTheme: "halloween" }).get("theme")).toBe("halloween")
    expect(buildStremioPosterSearchParams({ seasonalTheme: "christmas" }).get("theme")).toBe("christmas")
    expect(buildStremioPosterSearchParams({}).has("theme")).toBe(false)
    expect(buildStremioPosterSearchParams({ seasonalTheme: null }).has("theme")).toBe(false)
  })
})

describe("poster cache identity (no cross-title contamination)", () => {
  it("keeps themed keys distinct, invalid collapses onto absent", () => {
    const halloween = normalizePosterCacheParams(new URLSearchParams("theme=halloween")).toString()
    const christmas = normalizePosterCacheParams(new URLSearchParams("theme=christmas")).toString()
    const plain = normalizePosterCacheParams(new URLSearchParams("")).toString()
    expect(halloween).not.toBe(plain)
    expect(christmas).not.toBe(plain)
    expect(christmas).not.toBe(halloween)
    // Invalid still collapses onto absent (no mapping chain at query level:
    // the per-title choice travels via the mapping version, never as garbage).
    const garbage = normalizePosterCacheParams(new URLSearchParams("theme=easter")).toString()
    expect(garbage).toBe(plain)
  })
})

describe("client preview parity (choice over list context)", () => {
  const psBase = { selected: { id: 1 } }
  const ps = psBase as never

  it("emits an explicit choice even without list context", () => {
    const url = new URL(buildPreviewUrl({ ...psBase, seasonalThemeChoice: "christmas" } as never, { posterShape: "poster" } as never))
    expect(url.searchParams.get("theme")).toBe("christmas")
  })

  it("suppresses an inherited list theme on explicit none", () => {
    const url = new URL(
      buildPreviewUrl({ ...psBase, seasonalTheme: "halloween", seasonalThemeChoice: "none" } as never, { posterShape: "poster" } as never),
    )
    expect(url.searchParams.has("theme")).toBe(false)
  })

  it("follows the list on Automatic, omits without context", () => {
    const listed = new URL(
      buildPreviewUrl({ ...psBase, seasonalTheme: "halloween", seasonalThemeChoice: null } as never, { posterShape: "landscape" } as never),
    )
    expect(listed.searchParams.get("theme")).toBe("halloween")
    expect(new URL(buildPreviewUrl(ps, { posterShape: "poster" } as never)).searchParams.has("theme")).toBe(false)
  })

  it("invalid choice behaves as Automatic (legacy-identical)", () => {
    const url = new URL(
      buildPreviewUrl({ ...psBase, seasonalTheme: "halloween", seasonalThemeChoice: "easter" } as never, { posterShape: "poster" } as never),
    )
    expect(url.searchParams.get("theme")).toBe("halloween")
  })
})

describe("client navigation context (custom keywords extend the list match)", () => {
  const item = { id: 1, media_type: "movie" } as never

  it("themes from a custom keyword and clears on non-matching lists", () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current.seasonalTheme).toBeNull()
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Spooky Season marathon", { halloween: ["spooky season"] })
    })
    expect(result.current.seasonalTheme).toBe("halloween")
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Cozy Autumn", { halloween: ["spooky season"] })
    })
    expect(result.current.seasonalTheme).toBeNull()
  })

  it("never derives the theme from the movie title, even with keywords", () => {
    const { result } = renderHook(() => useNavigation())
    const spookyTitle = { id: 2, media_type: "movie", title: "Spooky Season" } as never
    act(() => {
      result.current.navigateToPoster(spookyTitle, "search", undefined, { halloween: ["spooky season"] })
    })
    expect(result.current.seasonalTheme).toBeNull()
  })

  it("keeps built-ins with custom keywords (halloween precedence)", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Festa di Natale spooky", { halloween: ["spooky"] })
    })
    expect(result.current.seasonalTheme).toBe("halloween")
    act(() => {
      result.current.goHome()
    })
    expect(result.current.seasonalTheme).toBeNull()
  })
})

describe("staged preview precedence over saved mapping (editor WYSIWYG)", () => {
  // Regression: resolvePosterRenderConfig resolved the saved mapping choice
  // ABOVE the query theme while the route loads the mapping even for preview
  // and buildPreviewUrl emits only the staged effective theme (nothing for
  // None/Automatic-no-context). A saved Halloween therefore resurrected over
  // staged Christmas / None / Automatic in preview before save. Effective
  // authorized preview (`isPreview`, never downgraded) must honor the staged
  // `theme=` and ignore the saved mapping; every other render keeps
  // saved-beats-list. Exercised through the real builder + resolver (not the
  // leaf alone), with a saved mapping present in all transitions.
  const savedHalloween = { seasonalTheme: "halloween" }
  const savedNone = { seasonalTheme: "none" }

  function resolveWithMapping(qs: string, mapping: unknown, isPreview?: boolean) {
    return resolvePosterRenderConfig({
      searchParams: new URLSearchParams(qs),
      mapping: mapping as never,
      configOverride: null,
      sd: {} as never,
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
      ...(isPreview === undefined ? {} : { isPreview }),
    })
  }

  function previewQuery(stagedChoice: unknown, listTheme: string | null) {
    const url = buildPreviewUrl(
      { selected: { id: 1 }, seasonalTheme: listTheme, seasonalThemeChoice: stagedChoice } as never,
      { posterShape: "poster" } as never,
    )
    return new URL(url).searchParams
  }

  it("staged christmas beats saved halloween only in effective preview", () => {
    const qs = previewQuery("christmas", "halloween")
    expect(qs.get("theme")).toBe("christmas")
    // RED pre-fix: the saved mapping won over the staged query in preview too.
    expect(resolveWithMapping(qs.toString(), savedHalloween, true).seasonalTheme).toBe("christmas")
    expect(resolveWithMapping(qs.toString(), savedHalloween).seasonalTheme).toBe("halloween")
    expect(resolveWithMapping(qs.toString(), savedHalloween, false).seasonalTheme).toBe("halloween")
  })

  it("staged none suppresses a saved theme only in effective preview", () => {
    const qs = previewQuery("none", "halloween")
    expect(qs.has("theme")).toBe(false)
    expect(resolveWithMapping(qs.toString(), savedHalloween, true).seasonalTheme).toBeNull()
    expect(resolveWithMapping(qs.toString(), savedHalloween).seasonalTheme).toBe("halloween")
  })

  it("staged Automatic follows the originating list only in effective preview", () => {
    const qs = previewQuery(null, "christmas")
    expect(qs.get("theme")).toBe("christmas")
    expect(resolveWithMapping(qs.toString(), savedHalloween, true).seasonalTheme).toBe("christmas")
    expect(resolveWithMapping(qs.toString(), savedHalloween).seasonalTheme).toBe("halloween")
    // Automatic with no list context stays unframed in preview (no resurrect)...
    const bare = previewQuery(null, null)
    expect(bare.has("theme")).toBe(false)
    expect(resolveWithMapping(bare.toString(), savedHalloween, true).seasonalTheme).toBeNull()
    // ...while Stremio keeps the saved choice without context.
    expect(resolveWithMapping(bare.toString(), savedHalloween).seasonalTheme).toBe("halloween")
  })

  it("saved none still suppresses the list outside preview", () => {
    const qs = previewQuery(null, "halloween")
    expect(qs.get("theme")).toBe("halloween")
    // ...but in preview the staged Automatic follows the list...
    expect(resolveWithMapping(qs.toString(), savedNone, true).seasonalTheme).toBe("halloween")
    // ...while Stremio honors the saved suppression.
    expect(resolveWithMapping(qs.toString(), savedNone).seasonalTheme).toBeNull()
    // Explicit staged choice still frames in preview over saved none.
    const staged = previewQuery("christmas", "halloween")
    expect(resolveWithMapping(staged.toString(), savedNone, true).seasonalTheme).toBe("christmas")
    expect(resolveWithMapping(staged.toString(), savedNone).seasonalTheme).toBeNull()
  })

  it("downgraded preview behaves as non-preview (saved choice wins)", () => {
    // The route strips `preview` on downgrade and resolves without isPreview:
    // same query, no flag -> saved mapping wins (hardening parity).
    expect(resolveWithMapping("theme=christmas", savedHalloween).seasonalTheme).toBe("halloween")
    expect(resolveWithMapping("", savedHalloween).seasonalTheme).toBe("halloween")
  })

  it("clean banner gate retained in effective preview", () => {
    expect(
      resolveWithMapping("shape=landscape&hideLogo=1&theme=halloween", savedHalloween, true).seasonalTheme,
    ).toBeNull()
    expect(
      resolveWithMapping("shape=landscape&hideLogo=1&theme=halloween", null, true).seasonalTheme,
    ).toBeNull()
  })

  it("invalid/absent legacy behavior retained", () => {
    expect(resolveWithMapping("theme=easter", savedHalloween, true).seasonalTheme).toBeNull()
    expect(resolveWithMapping("theme=easter", savedHalloween).seasonalTheme).toBe("halloween")
    expect(resolveWithMapping("", null, true).seasonalTheme).toBeNull()
    expect(resolveWithMapping("", null).seasonalTheme).toBeNull()
    expect(resolveWithMapping("", { seasonalTheme: "easter" }, true).seasonalTheme).toBeNull()
    expect(resolveWithMapping("", { seasonalTheme: "easter" }).seasonalTheme).toBeNull()
  })

  it("non-preview callers pre-resolve the saved choice (Stremio contract)", () => {
    // Catalog/meta handlers resolve the effective theme first, then carry it
    // in `seasonalTheme`: saved halloween beats the christmas list context.
    const effective = resolveEffectiveSeasonalTheme("halloween", "christmas")
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: {},
      seasonalTheme: effective ?? undefined,
    })
    expect(url.searchParams.get("theme")).toBe("halloween")
  })
})
