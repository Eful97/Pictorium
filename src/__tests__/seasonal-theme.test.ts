import { describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  CHRISTMAS_ALIASES_BY_LOCALE,
  SEASONAL_THEME_CHRISTMAS,
  SEASONAL_THEME_HALLOWEEN,
  detectSeasonalThemeFromCatalogName,
  normalizeSeasonalTheme,
  resolveEffectiveCatalogDisplayName,
  seasonalFrameAssetPath,
} from "@/lib/seasonal-theme"
import { resolveCatalogSeasonalTheme } from "@/lib/catalog-handler"
import { resolvePosterRenderConfig, resolveSeasonalTheme } from "@/lib/poster-config"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildPreviewUrl } from "@/lib/poster-url"
import { validatePosterQuery } from "@/lib/validation"
import { useNavigation } from "@/lib/useNavigation"
import { getRegionDef } from "@/lib/regions"
import type { CustomCatalogConfig } from "@/lib/types"

const IT = getRegionDef("IT")

function custom(id: string, name: string, type: CustomCatalogConfig["type"] = "movie"): CustomCatalogConfig {
  return { id, name, type, url: "https://example.invalid/list.csv" }
}

describe("seasonal theme recognition (halloween whole-word)", () => {
  it("matches plain, uppercased, emoji and punctuated names", () => {
    expect(detectSeasonalThemeFromCatalogName("Halloween")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("HALLOWEEN")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("🎃 Halloween!")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("My Halloween marathon — Film")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("  halloween  ")).toBe("halloween")
    expect(SEASONAL_THEME_HALLOWEEN).toBe("halloween")
  })

  it("rejects substring false positives", () => {
    expect(detectSeasonalThemeFromCatalogName("Halloweens")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("HalloweenParty")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("PreHalloween")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Halloween2024")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Easter")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName(null)).toBeNull()
    expect(detectSeasonalThemeFromCatalogName(undefined)).toBeNull()
    // Movie titles never drive the theme: the caller passes list names only,
    // but even a title-like string without the whole word stays null.
    expect(detectSeasonalThemeFromCatalogName("Halloween Kills")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("The Shining")).toBeNull()
  })

  it("normalizes halloween and christmas (fail-closed, no other seasons)", () => {
    expect(normalizeSeasonalTheme("halloween")).toBe("halloween")
    expect(normalizeSeasonalTheme("  HALLOWEEN ")).toBe("halloween")
    expect(normalizeSeasonalTheme("christmas")).toBe("christmas")
    expect(normalizeSeasonalTheme("  CHRISTMAS ")).toBe("christmas")
    expect(normalizeSeasonalTheme("easter")).toBeNull()
    expect(normalizeSeasonalTheme("")).toBeNull()
    expect(normalizeSeasonalTheme(null)).toBeNull()
    expect(normalizeSeasonalTheme(42)).toBeNull()
  })

  it("resolves the effective catalog name with manifest precedence", () => {
    // rename > ranking > jw > base
    expect(resolveEffectiveCatalogDisplayName({ baseName: "Base" })).toBe("Base")
    expect(resolveEffectiveCatalogDisplayName({ baseName: "Base", jwName: "Top 20" })).toBe("Top 20")
    expect(
      resolveEffectiveCatalogDisplayName({ baseName: "Base", jwName: "Top 20", rankingName: "My List" }),
    ).toBe("My List")
    expect(
      resolveEffectiveCatalogDisplayName({
        baseName: "Base",
        jwName: "Top 20",
        rankingName: "My List",
        customName: "Halloween Picks",
      }),
    ).toBe("Halloween Picks")
    // Blank renames never win.
    expect(resolveEffectiveCatalogDisplayName({ baseName: "Base", customName: "   " })).toBe("Base")
  })
})

describe("christmas multilingual recognition (every supported UI locale)", () => {
  it("covers every supported UI locale tag (incl pt-br / es-419 region variants)", () => {
    const required = [
      "en", "it", "pl", "fr", "de", "es", "es-419", "ja", "ko", "pt",
      "pt-br", "he", "cs", "ro", "ar", "tr", "nl", "sv", "vi",
    ]
    for (const locale of required) {
      expect(
        CHRISTMAS_ALIASES_BY_LOCALE[locale]?.length ?? 0,
        `locale ${locale}`,
      ).toBeGreaterThan(0)
    }
    expect(SEASONAL_THEME_CHRISTMAS).toBe("christmas")
  })

  it("matches every locale alias inside a list name (UI-locale independent)", () => {
    const cases: Array<[string, string]> = [
      ["it", "Festa di Natale"],
      ["en", "Christmas Marathon"],
      ["en", "Xmas Movies"],
      ["de", "Weihnachten Filme"],
      ["fr", "Films de Noël"],
      ["fr", "Noel Series"],
      ["es", "Películas de Navidad"],
      ["es-419", "Navidad en familia"],
      ["pt", "Filmes de Natal"],
      ["pt-br", "Natal em família"],
      ["nl", "Kerst films"],
      ["nl", "Kerstmis Series"],
      ["pl", "Boże Narodzenie filmy"],
      ["cs", "Vánoce filmy"],
      ["ro", "Filme de Crăciun"],
      ["sv", "Jul filmer"],
      ["tr", "Noel filmleri"],
      ["vi", "Phim Giáng sinh"],
      ["ja", "クリスマス映画"],
      ["ja", "クリスマス特集"],
      ["ko", "크리스마스 영화"],
      ["he", "סרטי חג המולד"],
      ["ar", "أفلام عيد الميلاد"],
      ["ar", "أفلام عيد الميلاد المجيد"],
      ["ar", "أفلام الكريسماس"],
    ]
    for (const [locale, name] of cases) {
      expect(detectSeasonalThemeFromCatalogName(name), `${locale}: ${name}`).toBe("christmas")
    }
  })

  it("matches case/diacritic/spacing variants (documented normalization)", () => {
    expect(detectSeasonalThemeFromCatalogName("NATALE")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("🎄 Natale!")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("  natale  ")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("NOËL")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("noel")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("BOZE NARODZENIE")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("boze narodzenie")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("VANOCE")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("CRACIUN")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("GIANG SINH")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("CHRISTMAS")).toBe("christmas")
    expect(detectSeasonalThemeFromCatalogName("My Christmas marathon — Film")).toBe("christmas")
  })

  it("rejects substring and generic-word false positives", () => {
    // Substrings of real words are never themes.
    expect(detectSeasonalThemeFromCatalogName("Natalie")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Natalia films")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("July")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Julia")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Noelani")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Noelle")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("ChristmasParty")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("PreChristmas")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Christmas2024")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Xmas2024")).toBeNull()
    // Generic words never imply Christmas (no winter/holiday inference).
    expect(detectSeasonalThemeFromCatalogName("Birthday Party")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Holidays")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Winter Movies")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Snow")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("Home Alone")).toBeNull()
    // Bare Arabic ميلاد (birthday) without عيد الميلاد never matches.
    expect(detectSeasonalThemeFromCatalogName("ميلاد")).toBeNull()
    expect(detectSeasonalThemeFromCatalogName("عيد ميلاد سعيد")).toBeNull()
  })

  it("keeps Halloween precedence on mixed names (no regression)", () => {
    expect(detectSeasonalThemeFromCatalogName("Halloween + Natale")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("Natale + Halloween")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("Christmas Halloween Party")).toBe("halloween")
    expect(detectSeasonalThemeFromCatalogName("🎃 Halloween 🎄 Natale")).toBe("halloween")
  })
})

describe("catalog-side theme resolution (server, effective names)", () => {
  const base = {
    customCatalogs: [] as CustomCatalogConfig[],
    catalogRenames: {} as Record<string, string>,
    rankingSourceMovie: "",
    rankingSourceSeries: "",
    region: IT,
  }

  it("leaves built-in catalogs unframed by default", () => {
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", base)).toBeNull()
    expect(resolveCatalogSeasonalTheme("pictorium-netflix-series", "series", base)).toBeNull()
    expect(resolveCatalogSeasonalTheme("pictorium-anime-movies", "movie", base)).toBeNull()
  })

  it("themes a renamed built-in catalog, same title elsewhere stays unframed", () => {
    const renamed = { ...base, catalogRenames: { "pictorium-jw-movies": "My Halloween marathon" } }
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", renamed)).toBe("halloween")
    // Same title served from another (non-matching) list is untouched.
    expect(resolveCatalogSeasonalTheme("pictorium-netflix-movies", "movie", renamed)).toBeNull()
  })

  it("themes custom lists by their stored name (rename wins)", () => {
    const customs = [custom("abc", "Halloween Nights")]
    const opts = { ...base, customCatalogs: customs }
    expect(resolveCatalogSeasonalTheme("pictorium-custom-movie-abc", "movie", opts)).toBe("halloween")
    expect(resolveCatalogSeasonalTheme("pictorium-custom-series-abc", "series", opts)).toBeNull()
    const withRename = {
      ...opts,
      catalogRenames: { "pictorium-custom-movie-abc": "Cozy Autumn" },
    }
    expect(resolveCatalogSeasonalTheme("pictorium-custom-movie-abc", "movie", withRename)).toBeNull()
  })

  it("mirrors the manifest mixed split names", () => {
    const customs = [custom("mix1", "Halloween", "mixed")]
    const opts = { ...base, customCatalogs: customs }
    // "Halloween — Film" / "Halloween — Serie TV" still whole-word match.
    expect(resolveCatalogSeasonalTheme("pictorium-custom-movie-mix1", "movie", opts)).toBe("halloween")
    expect(resolveCatalogSeasonalTheme("pictorium-custom-series-mix1", "series", opts)).toBe("halloween")
  })

  it("themes a Top 20 driven by a Halloween-named ranking source", () => {
    const customs = [custom("spooky", "Halloween invariants", "mixed")]
    const opts = {
      ...base,
      customCatalogs: customs,
      rankingSourceMovie: "spooky",
    }
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", opts)).toBe("halloween")
    expect(resolveCatalogSeasonalTheme("pictorium-jw-series", "series", opts)).toBeNull()
  })

  it("never matches on ids (display names only)", () => {
    // A custom short id containing the word must not theme by itself.
    const customs = [custom("halloween2024", "Cozy Autumn")]
    const opts = { ...base, customCatalogs: customs }
    expect(resolveCatalogSeasonalTheme("pictorium-custom-movie-halloween2024", "movie", opts)).toBeNull()
    expect(resolveCatalogSeasonalTheme("pictorium-search-movies", "movie", base)).toBeNull()
    expect(resolveCatalogSeasonalTheme("pictorium-unknown-xyz", "movie", base)).toBeNull()
  })

  it("themes Christmas lists in any supported locale, same title elsewhere stays unframed", () => {
    const customs = [custom("nat", "Festa di Natale")]
    const opts = { ...base, customCatalogs: customs }
    expect(resolveCatalogSeasonalTheme("pictorium-custom-movie-nat", "movie", opts)).toBe("christmas")
    expect(resolveCatalogSeasonalTheme("pictorium-custom-series-nat", "series", opts)).toBeNull()
    expect(resolveCatalogSeasonalTheme("pictorium-netflix-movies", "movie", opts)).toBeNull()
    const renamed = { ...base, catalogRenames: { "pictorium-jw-movies": "Weihnachten Marathon" } }
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", renamed)).toBe("christmas")
    expect(resolveCatalogSeasonalTheme("pictorium-jw-series", "series", renamed)).toBeNull()
    // Mixed names keep Halloween precedence end-to-end.
    const mixed = { ...base, catalogRenames: { "pictorium-jw-movies": "Halloween + Natale" } }
    expect(resolveCatalogSeasonalTheme("pictorium-jw-movies", "movie", mixed)).toBe("halloween")
  })
})

describe("poster render opt-in (query-only, both shapes with own asset)", () => {
  it("resolves halloween and christmas for portrait AND landscape + valid query", () => {
    expect(resolveSeasonalTheme(new URLSearchParams("theme=halloween"), "poster")).toBe("halloween")
    expect(resolveSeasonalTheme(new URLSearchParams("theme=HALLOWEEN"), "poster")).toBe("halloween")
    expect(resolveSeasonalTheme(new URLSearchParams("theme=christmas"), "poster")).toBe("christmas")
    expect(resolveSeasonalTheme(new URLSearchParams("theme=CHRISTMAS"), "poster")).toBe("christmas")
    // Default unchanged: absent/invalid = unframed.
    expect(resolveSeasonalTheme(new URLSearchParams(""), "poster")).toBeNull()
    expect(resolveSeasonalTheme(new URLSearchParams("theme=easter"), "poster")).toBeNull()
    expect(resolveSeasonalTheme(new URLSearchParams("theme="), "poster")).toBeNull()
    // Landscape renders its OWN 768x432 asset (never a stretched portrait).
    expect(resolveSeasonalTheme(new URLSearchParams("theme=halloween"), "landscape")).toBe("halloween")
    expect(resolveSeasonalTheme(new URLSearchParams("theme=christmas"), "landscape")).toBe("christmas")
    expect(resolveSeasonalTheme(new URLSearchParams(""), "landscape")).toBeNull()
    expect(resolveSeasonalTheme(new URLSearchParams("theme=easter"), "landscape")).toBeNull()
  })

  it("accepts the theme query param within bounds", () => {
    expect(validatePosterQuery(new URLSearchParams("theme=halloween"))).toBeNull()
  })

  it("keeps the clean banner (hideLogo) unframed even with an explicit theme", () => {
    const cfg = (qs: string) =>
      resolvePosterRenderConfig({
        searchParams: new URLSearchParams(qs),
        mapping: null,
        configOverride: null,
        sd: {} as never,
        hasQuery: true,
        showBadges: true,
        rankingBadges: true,
        animeRank: null,
        rankingResult: null,
        finalRank: null,
      })
    // Themed poster + landscapePoster render framed on both shapes...
    expect(cfg("theme=halloween").seasonalTheme).toBe("halloween")
    expect(cfg("shape=landscape&theme=halloween").seasonalTheme).toBe("halloween")
    expect(cfg("shape=landscape&theme=halloween").posterShape).toBe("landscape")
    // ...while the clean banner never frames (legacy-identical bytes).
    expect(cfg("shape=landscape&hideLogo=1&theme=halloween").seasonalTheme).toBeNull()
    expect(cfg("shape=landscape&hideLogo=1&theme=christmas").seasonalTheme).toBeNull()
    expect(cfg("shape=landscape&hideLogo=1").seasonalTheme).toBeNull()
  })
})

describe("poster cache identity (no cross-catalog contamination)", () => {
  it("keeps each theme in the allowlist with its own key", () => {
    expect(normalizePosterCacheParams(new URLSearchParams("theme=halloween")).get("theme")).toBe("halloween")
    expect(normalizePosterCacheParams(new URLSearchParams("theme=christmas")).get("theme")).toBe("christmas")
  })

  it("collapses invalid values onto the absent (unframed) key", () => {
    const garbage = normalizePosterCacheParams(new URLSearchParams("theme=easter")).toString()
    const absent = normalizePosterCacheParams(new URLSearchParams("")).toString()
    expect(garbage).toBe(absent)
    expect(normalizePosterCacheParams(new URLSearchParams("theme=easter")).has("theme")).toBe(false)
  })

  it("keeps christmas, halloween and unthemed renders on three distinct keys", () => {
    const christmas = normalizePosterCacheParams(new URLSearchParams("theme=christmas")).toString()
    const halloween = normalizePosterCacheParams(new URLSearchParams("theme=halloween")).toString()
    const plain = normalizePosterCacheParams(new URLSearchParams("")).toString()
    expect(christmas).not.toBe(plain)
    expect(halloween).not.toBe(plain)
    expect(christmas).not.toBe(halloween)
  })

  it("keeps the same theme on portrait vs landscape on separate keys (own assets)", () => {
    const portrait = normalizePosterCacheParams(new URLSearchParams("theme=halloween")).toString()
    const landscape = normalizePosterCacheParams(new URLSearchParams("theme=halloween&shape=landscape")).toString()
    const plainLandscape = normalizePosterCacheParams(new URLSearchParams("shape=landscape")).toString()
    expect(landscape).not.toBe(portrait)
    expect(landscape).not.toBe(plainLandscape)
    const christmasLandscape = normalizePosterCacheParams(new URLSearchParams("theme=christmas&shape=landscape")).toString()
    expect(christmasLandscape).not.toBe(landscape)
    expect(christmasLandscape).not.toBe(plainLandscape)
  })
})

describe("seasonal frame asset mapping (explicit theme+shape, no traversal)", () => {
  it("maps each canonical theme+shape to its own user-supplied file", () => {
    expect(seasonalFrameAssetPath("halloween", "poster")).toBe("public/seasonal-frames/halloween.svg")
    expect(seasonalFrameAssetPath("christmas", "poster")).toBe("public/seasonal-frames/christmas.svg")
    expect(seasonalFrameAssetPath("halloween", "landscape")).toBe("public/seasonal-frames/halloween landscape.svg")
    expect(seasonalFrameAssetPath("christmas", "landscape")).toBe("public/seasonal-frames/christmas landscape.svg")
  })

  it("returns null for anything non-canonical (fail-closed, never a raw path)", () => {
    expect(seasonalFrameAssetPath("easter", "poster")).toBeNull()
    expect(seasonalFrameAssetPath("halloween", "square")).toBeNull()
    expect(seasonalFrameAssetPath("", "")).toBeNull()
    expect(seasonalFrameAssetPath(null, "poster")).toBeNull()
    expect(seasonalFrameAssetPath("halloween", null)).toBeNull()
    // Traversal attempts never resolve to a path.
    expect(seasonalFrameAssetPath("../../etc/passwd", "poster")).toBeNull()
    expect(seasonalFrameAssetPath("halloween", "../../etc")).toBeNull()
    expect(seasonalFrameAssetPath("HALLOWEEN", "poster")).toBeNull()
  })
})

describe("Stremio poster URL parity (client/server same renderer)", () => {
  const defaults = {}

  it("emits theme only when set (Stremio params)", () => {
    expect(buildStremioPosterSearchParams({ seasonalTheme: "halloween" }).get("theme")).toBe("halloween")
    expect(buildStremioPosterSearchParams({ seasonalTheme: "christmas" }).get("theme")).toBe("christmas")
    expect(buildStremioPosterSearchParams({}).has("theme")).toBe(false)
    expect(buildStremioPosterSearchParams({ seasonalTheme: null }).has("theme")).toBe(false)
  })

  it("frames the portrait AND landscape poster URLs, never the clean banner", () => {
    const portrait = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      seasonalTheme: "halloween",
    })
    expect(portrait.searchParams.get("theme")).toBe("halloween")

    const landscape = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      forceShape: "landscape",
      seasonalTheme: "halloween",
    })
    expect(landscape.searchParams.get("theme")).toBe("halloween")
    expect(landscape.searchParams.get("shape")).toBe("landscape")

    const banner = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      forceShape: "landscape",
      hideLogo: true,
      seasonalTheme: "halloween",
    })
    expect(banner.searchParams.has("theme")).toBe(false)

    // Invalid input normalizes to absent (unframed), never garbage in URL.
    const garbage = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      seasonalTheme: "easter",
    })
    expect(garbage.searchParams.has("theme")).toBe(false)
  })

  it("frames the christmas portrait AND landscape poster URLs", () => {
    const portrait = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      seasonalTheme: "christmas",
    })
    expect(portrait.searchParams.get("theme")).toBe("christmas")

    const landscape = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      forceShape: "landscape",
      seasonalTheme: "christmas",
    })
    expect(landscape.searchParams.get("theme")).toBe("christmas")
    expect(landscape.searchParams.get("shape")).toBe("landscape")
  })

  it("leaves legacy URLs byte-identical (no theme key without context)", () => {
    const a = buildStremioPosterUrl({ origin: "http://localhost:3000", type: "movie", id: 42, defaults }).toString()
    const b = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      seasonalTheme: null,
    }).toString()
    expect(a).toBe(b)
  })
})

describe("client preview URL parity (ephemeral list context)", () => {
  const psBase = { selected: { id: 1 } }
  const ps = psBase as never

  it("carries theme=halloween from the originating list (portrait)", () => {
    const url = new URL(buildPreviewUrl({ ...psBase, seasonalTheme: "halloween" } as never, { posterShape: "poster" } as never))
    expect(url.searchParams.get("theme")).toBe("halloween")
  })

  it("carries theme=christmas from a Natale list (portrait)", () => {
    const url = new URL(buildPreviewUrl({ ...psBase, seasonalTheme: "christmas" } as never, { posterShape: "poster" } as never))
    expect(url.searchParams.get("theme")).toBe("christmas")
  })

  it("omits the theme without context or when invalid (both shapes)", () => {
    expect(new URL(buildPreviewUrl(ps, { posterShape: "poster" } as never)).searchParams.has("theme")).toBe(false)
    expect(
      new URL(buildPreviewUrl({ ...psBase, seasonalTheme: "easter" } as never, { posterShape: "poster" } as never)).searchParams.has(
        "theme",
      ),
    ).toBe(false)
    expect(
      new URL(buildPreviewUrl({ ...psBase, seasonalTheme: "easter" } as never, { posterShape: "landscape" } as never)).searchParams.has(
        "theme",
      ),
    ).toBe(false)
  })

  it("carries the theme from the originating list in landscape too (own asset)", () => {
    expect(
      new URL(buildPreviewUrl({ ...psBase, seasonalTheme: "christmas" } as never, { posterShape: "landscape" } as never)).searchParams.get(
        "theme",
      ),
    ).toBe("christmas")
    expect(
      new URL(buildPreviewUrl({ ...psBase, seasonalTheme: "halloween" } as never, { posterShape: "landscape" } as never)).searchParams.get(
        "theme",
      ),
    ).toBe("halloween")
  })
})

describe("client navigation context (ephemeral, no leakage)", () => {
  const item = { id: 1, media_type: "movie" } as never

  it("sets the theme from a Halloween list name only", () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current.seasonalTheme).toBeNull()
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "My Halloween marathon")
    })
    expect(result.current.seasonalTheme).toBe("halloween")
  })

  it("clears the theme on non-matching lists and on exit", () => {
    const { result } = renderHook(() => useNavigation())
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Halloween Nights")
    })
    expect(result.current.seasonalTheme).toBe("halloween")
    // Same title from another list: context cleared (no leakage).
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Cozy Autumn")
    })
    expect(result.current.seasonalTheme).toBeNull()
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Halloween Nights")
    })
    expect(result.current.seasonalTheme).toBe("halloween")
    // Exit clears.
    act(() => {
      result.current.goHome()
    })
    expect(result.current.seasonalTheme).toBeNull()
  })

  it("never derives the theme from the movie title", () => {
    const { result } = renderHook(() => useNavigation())
    const halloweenTitle = { id: 2, media_type: "movie", title: "Halloween" } as never
    act(() => {
      result.current.navigateToPoster(halloweenTitle, "search")
    })
    expect(result.current.seasonalTheme).toBeNull()
  })

  it("sets the christmas theme from a Natale list name and clears it on exit", () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current.seasonalTheme).toBeNull()
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Festa di Natale")
    })
    expect(result.current.seasonalTheme).toBe("christmas")
    act(() => {
      result.current.navigateToPoster(item, "cataloghi", "Cozy Autumn")
    })
    expect(result.current.seasonalTheme).toBeNull()
  })
})

describe("clean banner gate is landscape + hideLogo ONLY (portrait keeps its frame)", () => {
  const cfg = (qs: string) =>
    resolvePosterRenderConfig({
      searchParams: new URLSearchParams(qs),
      mapping: null,
      configOverride: null,
      sd: {} as never,
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })

  it("keeps the theme on portrait + hideLogo (hideLogo hides only the logo)", () => {
    // Regression: an overbroad `hideLogo ? null` gate silently unframed
    // themed PORTRAIT renders (previously framed). Only shape=landscape +
    // hideLogo is the clean banner.
    expect(cfg("theme=halloween&hideLogo=1").posterShape).toBe("poster")
    expect(cfg("theme=halloween&hideLogo=1").seasonalTheme).toBe("halloween")
    expect(cfg("theme=christmas&hideLogo=1").seasonalTheme).toBe("christmas")
    expect(cfg("shape=poster&theme=halloween&hideLogo=1").seasonalTheme).toBe("halloween")
    expect(cfg("shape=poster&theme=christmas&hideLogo=1").seasonalTheme).toBe("christmas")
  })

  it("keeps the theme on regular landscape (no hideLogo) on both themes", () => {
    expect(cfg("shape=landscape&theme=halloween").seasonalTheme).toBe("halloween")
    expect(cfg("shape=landscape&theme=christmas").seasonalTheme).toBe("christmas")
  })

  it("leaves ONLY the clean banner (landscape + hideLogo) unframed", () => {
    expect(cfg("shape=landscape&hideLogo=1&theme=halloween").seasonalTheme).toBeNull()
    expect(cfg("shape=landscape&hideLogo=1&theme=christmas").seasonalTheme).toBeNull()
    expect(cfg("shape=landscape&hideLogo=1").seasonalTheme).toBeNull()
  })

  it("emits the theme on portrait + hideLogo Stremio URLs, never on the clean banner", () => {
    const defaults = {}
    const portraitBanner = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      forceShape: "poster",
      hideLogo: true,
      seasonalTheme: "halloween",
    })
    expect(portraitBanner.searchParams.get("theme")).toBe("halloween")

    const portraitChristmas = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      hideLogo: true,
      seasonalTheme: "christmas",
    })
    expect(portraitChristmas.searchParams.get("theme")).toBe("christmas")

    const landscapePoster = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      forceShape: "landscape",
      seasonalTheme: "christmas",
    })
    expect(landscapePoster.searchParams.get("theme")).toBe("christmas")

    const cleanBanner = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults,
      forceShape: "landscape",
      hideLogo: true,
      seasonalTheme: "christmas",
    })
    expect(cleanBanner.searchParams.has("theme")).toBe(false)
  })
})
