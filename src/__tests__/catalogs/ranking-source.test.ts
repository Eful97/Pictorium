import { describe, expect, it } from "vitest"
import { configTokenSchema, decodeConfig, encodeConfig } from "@/lib/config-token"
import {
  filterRankingItemsBySlot,
  compatibleRankingCustoms,
  compatibleRankingStreaming,
  slotsReferencingCustom,
  shouldApplyRankRefresh,
  rankingSourceCatalogName,
  rankingSectionFitsSlot,
  resolveRankingSource,
  streamingRankingCatalogName,
} from "@/lib/ranking-source"
import {
  genericStreamingCatalogId,
  genericStreamingCatalogName,
  streamingCatalogId,
} from "@/lib/streaming-catalogs"
import type { CustomCatalogConfig } from "@/lib/types"

// Legacy curated selection (RegionDef country, both sections) and a generic
// mixed one (index service, `all` chart) — the two id shapes the resolver
// must accept as ranking sources.
const NETFLIX_IT = { service: "netflix", country: "IT" }
const HULU_US_ALL = { service: "hulu", country: "united-states", sections: ["all"] }
const NETFLIX_MOVIES_ID = streamingCatalogId("netflix", "IT", "movies")
const NETFLIX_SERIES_ID = streamingCatalogId("netflix", "IT", "series")
const HULU_ALL_ID = genericStreamingCatalogId("hulu", "united-states", "all", "auto", null)

const MOVIE_CUSTOM: CustomCatalogConfig = {
  id: "cat_movies",
  name: "Miei film",
  type: "movie",
  url: "https://mdblist.com/lists/u/movies",
}

const SERIES_CUSTOM: CustomCatalogConfig = {
  id: "cat_series",
  name: "Mie serie",
  type: "series",
  url: "https://mdblist.com/lists/u/series",
}

const MIXED_CUSTOM: CustomCatalogConfig = {
  id: "cat_mixed",
  name: "Mista",
  type: "mixed",
  url: "https://trakt.tv/users/u/lists/mista",
}

const ALL = [MOVIE_CUSTOM, SERIES_CUSTOM, MIXED_CUSTOM]

describe("resolveRankingSource", () => {
  it("defaults to JustWatch charts without any selection (old configs stay valid)", () => {
    expect(resolveRankingSource({}, "movie")).toEqual({ kind: "justwatch", mode: "charts" })
    expect(resolveRankingSource({}, "series")).toEqual({ kind: "justwatch", mode: "charts" })
    expect(
      resolveRankingSource({ customCatalogs: ALL }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("treats empty or whitespace selection as JustWatch charts", () => {
    expect(
      resolveRankingSource({ customCatalogs: ALL, rankingSourceMovie: "" }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    expect(
      resolveRankingSource({ customCatalogs: ALL, rankingSourceSeries: "   " }, "series"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("resolves built-in JustWatch modes (charts, popular, trending) independently per slot", () => {
    expect(
      resolveRankingSource({ customCatalogs: ALL, rankingSourceMovie: "jw:charts" }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    expect(
      resolveRankingSource({ customCatalogs: ALL, rankingSourceMovie: "jw:popular" }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "popular" })
    expect(
      resolveRankingSource({ customCatalogs: ALL, rankingSourceSeries: "jw:trending" }, "series"),
    ).toEqual({ kind: "justwatch", mode: "trending" })
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "jw:popular", rankingSourceSeries: "cat_series" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "popular" })
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "jw:popular", rankingSourceSeries: "cat_series" },
        "series",
      ),
    ).toEqual({ kind: "custom", customId: "cat_series" })
  })

  it("never resolves a builtin id as a custom catalog even if custom catalog shares that id", () => {
    const maliciousCustoms: CustomCatalogConfig[] = [
      { id: "jw:popular", name: "Fake popular", type: "movie", url: "https://example.com" },
    ]
    expect(
      resolveRankingSource({ customCatalogs: maliciousCustoms, rankingSourceMovie: "jw:popular" }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "popular" })
  })

  it("resolves a compatible custom per slot (round-trip selection)", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "cat_movies" },
        "movie",
      ),
    ).toEqual({ kind: "custom", customId: "cat_movies" })
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceSeries: "cat_series" },
        "series",
      ),
    ).toEqual({ kind: "custom", customId: "cat_series" })
  })

  it("accepts mixed catalogs on both slots", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "cat_mixed" },
        "movie",
      ),
    ).toEqual({ kind: "custom", customId: "cat_mixed" })
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceSeries: "cat_mixed" },
        "series",
      ),
    ).toEqual({ kind: "custom", customId: "cat_mixed" })
  })

  it("falls back to JustWatch charts on cross-type selection", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "cat_series" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceSeries: "cat_movies" },
        "series",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("falls back to JustWatch charts when the referenced catalog was deleted", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: [MOVIE_CUSTOM], rankingSourceMovie: "cat_gone" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("falls back to JustWatch charts when the referenced catalog is disabled", () => {
    const disabled: CustomCatalogConfig = { ...MOVIE_CUSTOM, enabled: false }
    expect(
      resolveRankingSource(
        { customCatalogs: [disabled], rankingSourceMovie: "cat_movies" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("falls back to JustWatch charts on overlong ids (schema bound)", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "x".repeat(65) },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })
})

describe("ranking source persistence contract", () => {
  it("old configs without the fields still parse (retrocompatible)", () => {
    const parsed = configTokenSchema.safeParse({
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
    })
    expect(parsed.success).toBe(true)
  })

  it("round-trips the per-slot selection through the config token", () => {
    const token = encodeConfig({
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
      rankingSourceMovie: "cat_movies",
      rankingSourceSeries: "cat_mixed",
      customCatalogs: [MOVIE_CUSTOM, MIXED_CUSTOM],
    })
    const decoded = decodeConfig(token)
    expect(decoded?.rankingSourceMovie).toBe("cat_movies")
    expect(decoded?.rankingSourceSeries).toBe("cat_mixed")
    expect(
      resolveRankingSource(
        {
          customCatalogs: decoded?.customCatalogs,
          rankingSourceMovie: decoded?.rankingSourceMovie,
          rankingSourceSeries: decoded?.rankingSourceSeries,
        },
        "movie",
      ),
    ).toEqual({ kind: "custom", customId: "cat_movies" })
  })

  it("round-trips built-in JustWatch modes through the config token", () => {
    const token = encodeConfig({
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
      rankingSourceMovie: "jw:popular",
      rankingSourceSeries: "jw:trending",
    })
    const decoded = decodeConfig(token)
    expect(decoded?.rankingSourceMovie).toBe("jw:popular")
    expect(decoded?.rankingSourceSeries).toBe("jw:trending")
    expect(
      resolveRankingSource(
        {
          rankingSourceMovie: decoded?.rankingSourceMovie,
          rankingSourceSeries: decoded?.rankingSourceSeries,
        },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "popular" })
    expect(
      resolveRankingSource(
        {
          rankingSourceMovie: decoded?.rankingSourceMovie,
          rankingSourceSeries: decoded?.rankingSourceSeries,
        },
        "series",
      ),
    ).toEqual({ kind: "justwatch", mode: "trending" })
  })

  it("rejects selection ids past the streaming id cap in the token schema", () => {
    const parsed = configTokenSchema.safeParse({
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
      rankingSourceMovie: "x".repeat(161),
    })
    expect(parsed.success).toBe(false)
  })
})

describe("resolveRankingSource with imported Top 10 streaming lists", () => {
  const streamingSelections = [NETFLIX_IT, HULU_US_ALL]

  it("resolves an enabled legacy selection id on its own section", () => {
    expect(
      resolveRankingSource({ streamingSelections, rankingSourceMovie: NETFLIX_MOVIES_ID }, "movie"),
    ).toEqual({ kind: "streaming", catalogId: NETFLIX_MOVIES_ID })
    expect(
      resolveRankingSource({ streamingSelections, rankingSourceSeries: NETFLIX_SERIES_ID }, "series"),
    ).toEqual({ kind: "streaming", catalogId: NETFLIX_SERIES_ID })
  })

  it("falls back to JustWatch on a section mismatch, removal or disabled entry", () => {
    // Movie list on the series slot (and vice versa) never crosses over.
    expect(
      resolveRankingSource({ streamingSelections, rankingSourceSeries: NETFLIX_MOVIES_ID }, "series"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    // Removed selection (id no longer belongs to this space).
    expect(
      resolveRankingSource({ streamingSelections: [], rankingSourceMovie: NETFLIX_MOVIES_ID }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    // Explicitly switched off (manager Power = Hide, config kept).
    expect(
      resolveRankingSource(
        {
          streamingSelections: [{ ...NETFLIX_IT, enabled: false }],
          rankingSourceMovie: NETFLIX_MOVIES_ID,
        },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    // Unknown/malformed streaming ids never resolve.
    expect(
      resolveRankingSource(
        { streamingSelections, rankingSourceMovie: "pictorium-stream-netflix-it-all" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("lets a mixed `all` list drive both slots", () => {
    for (const slot of ["movie", "series"] as const) {
      expect(
        resolveRankingSource(
          { streamingSelections, rankingSourceMovie: HULU_ALL_ID, rankingSourceSeries: HULU_ALL_ID },
          slot,
        ),
      ).toEqual({ kind: "streaming", catalogId: HULU_ALL_ID })
    }
  })

  it("keeps source/variant identity: only the exact derived id resolves", () => {
    const strict = [{
      service: "hulu",
      country: "united-states",
      sections: ["movies"],
      source: "flixpatrol",
      variant: "hi",
    }]
    const strictId = genericStreamingCatalogId("hulu", "united-states", "movies", "flixpatrol", "hi")
    expect(
      resolveRankingSource({ streamingSelections: strict, rankingSourceMovie: strictId }, "movie"),
    ).toEqual({ kind: "streaming", catalogId: strictId })
    // Same service/country with another policy/variant is a different list.
    const autoId = genericStreamingCatalogId("hulu", "united-states", "movies", "auto", null)
    expect(
      resolveRankingSource({ streamingSelections: strict, rankingSourceMovie: autoId }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("never resolves a streaming id as a custom catalog", () => {
    const customs: CustomCatalogConfig[] = [
      { id: NETFLIX_MOVIES_ID, name: "Fake", type: "movie", url: "https://mdblist.com/lists/u/x" },
    ]
    expect(
      resolveRankingSource({ customCatalogs: customs, rankingSourceMovie: NETFLIX_MOVIES_ID }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })
})

describe("compatibleRankingStreaming", () => {
  it("lists enabled section-compatible lists for the slot", () => {
    const selections = [
      NETFLIX_IT,
      HULU_US_ALL,
      { service: "prime", country: "IT", enabled: false },
    ]
    expect(compatibleRankingStreaming(selections, "movie").map((o) => o.id).sort()).toEqual(
      [NETFLIX_MOVIES_ID, HULU_ALL_ID].sort(),
    )
    expect(compatibleRankingStreaming(selections, "series").map((o) => o.id).sort()).toEqual(
      [NETFLIX_SERIES_ID, HULU_ALL_ID].sort(),
    )
  })

  it("returns empty without selections (legacy spaces expose no streaming source)", () => {
    expect(compatibleRankingStreaming(undefined, "movie")).toEqual([])
    expect(compatibleRankingStreaming(null, "series")).toEqual([])
  })

  it("mirrors the section/slot rule", () => {
    expect(rankingSectionFitsSlot("movies", "movie")).toBe(true)
    expect(rankingSectionFitsSlot("movies", "series")).toBe(false)
    expect(rankingSectionFitsSlot("series", "series")).toBe(true)
    expect(rankingSectionFitsSlot("all", "movie")).toBe(true)
    expect(rankingSectionFitsSlot("all", "series")).toBe(true)
  })
})

describe("filterRankingItemsBySlot", () => {
  const rows = [
    { tmdb: 1, title: "Plain" },
    { tmdb: 2, title: "Film", mediatype: "movie" as const },
    { tmdb: 3, title: "Show", mediatype: "show" as const },
    { tmdb: 4, title: "Tv", mediatype: "tv" as const },
    { tmdb: 5, title: "Anime", mediatype: "anime" as const },
  ]

  it("keeps untyped and movie rows on the movie slot", () => {
    expect(filterRankingItemsBySlot(rows, "movie").map((r) => r.tmdb)).toEqual([1, 2])
  })

  it("keeps untyped and non-movie rows on the series slot", () => {
    expect(filterRankingItemsBySlot(rows, "series").map((r) => r.tmdb)).toEqual([1, 3, 4, 5])
  })
})

describe("compatibleRankingCustoms", () => {
  const customs: CustomCatalogConfig[] = [
    { id: "m", name: "M", type: "movie", url: "https://mdblist.com/lists/u/m" },
    { id: "s", name: "S", type: "series", url: "https://mdblist.com/lists/u/s" },
    { id: "x", name: "X", type: "mixed", url: "https://mdblist.com/lists/u/x" },
    { id: "off", name: "Off", type: "movie", url: "https://mdblist.com/lists/u/off", enabled: false },
    { id: "jw:popular", name: "Reserved", type: "movie", url: "https://mdblist.com/lists/u/res" },
  ]

  it("keeps enabled type-compatible customs and excludes reserved builtin ids", () => {
    expect(compatibleRankingCustoms(customs, "movie").map((c) => c.id)).toEqual(["m", "x"])
    expect(compatibleRankingCustoms(customs, "series").map((c) => c.id)).toEqual(["s", "x"])
  })

  it("returns empty without catalogs", () => {
    expect(compatibleRankingCustoms(undefined, "movie")).toEqual([])
    expect(compatibleRankingCustoms(null, "series")).toEqual([])
  })
})

describe("imported addon catalogs as ranking sources", () => {
  const manifest = "https://example.com/addon/manifest.json"
  const addons: CustomCatalogConfig[] = [
    {
      id: "addon_movie",
      name: "Addon Film",
      type: "movie",
      url: manifest,
      addon: { manifestUrl: manifest, catalogId: "top", catalogType: "movie" },
    },
    {
      id: "addon_series",
      name: "Addon Serie",
      type: "series",
      url: manifest,
      addon: { manifestUrl: manifest, catalogId: "top", catalogType: "series" },
    },
    {
      // Local config type cannot widen the actual remote catalog type.
      id: "addon_mixed",
      name: "Addon mixed",
      type: "mixed",
      url: manifest,
      addon: { manifestUrl: manifest, catalogId: "last", catalogType: "movie" },
    },
    {
      id: "addon_off",
      name: "Addon off",
      type: "movie",
      url: manifest,
      enabled: false,
      addon: { manifestUrl: manifest, catalogId: "off", catalogType: "movie" },
    },
  ]

  it("offers only enabled entries matching the real remote type", () => {
    expect(compatibleRankingCustoms(addons, "movie").map((c) => c.id)).toEqual(["addon_movie", "addon_mixed"])
    expect(compatibleRankingCustoms(addons, "series").map((c) => c.id)).toEqual(["addon_series"])
  })

  it("resolves an addon kind and never crosses slots", () => {
    expect(
      resolveRankingSource({ customCatalogs: addons, rankingSourceMovie: "addon_movie" }, "movie"),
    ).toEqual({ kind: "addon", customId: "addon_movie" })
    expect(
      resolveRankingSource({ customCatalogs: addons, rankingSourceSeries: "addon_series" }, "series"),
    ).toEqual({ kind: "addon", customId: "addon_series" })
    // A mixed local type does not let a movie-only remote catalog drive series.
    expect(
      resolveRankingSource({ customCatalogs: addons, rankingSourceSeries: "addon_mixed" }, "series"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    // Disabled / deleted imports fall back to JustWatch.
    expect(
      resolveRankingSource({ customCatalogs: addons, rankingSourceMovie: "addon_off" }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
    expect(
      resolveRankingSource({ customCatalogs: addons, rankingSourceMovie: "gone" }, "movie"),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("rejects addon lists whose required extra the passthrough cannot provide", () => {
    const withRequired: CustomCatalogConfig = {
      id: "addon_required",
      name: "Richiede anno",
      type: "movie",
      url: manifest,
      addon: {
        manifestUrl: manifest,
        catalogId: "by-year",
        catalogType: "movie",
        extra: [{ name: "year", isRequired: true }],
      },
    }
    const alsoUnavailable: CustomCatalogConfig = {
      id: "addon_search",
      name: "Ricerca obbligatoria",
      type: "movie",
      url: manifest,
      addon: {
        manifestUrl: manifest,
        catalogId: "search",
        catalogType: "movie",
        extra: [{ name: "search", isRequired: true }],
      },
    }
    // The ranking request is fixed (no search/genre): a required search is
    // just as unreadable as an unsupported extra, so neither is offered.
    expect(compatibleRankingCustoms([withRequired, alsoUnavailable], "movie")).toEqual([])
    expect(
      resolveRankingSource(
        { customCatalogs: [withRequired], rankingSourceMovie: "addon_required" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch", mode: "charts" })
  })

  it("uses the local addon entry name for the driven Top 20 label", () => {
    expect(
      rankingSourceCatalogName("pictorium-jw-movies", "movie", {
        customCatalogs: addons,
        rankingSourceMovie: "addon_movie",
      }),
    ).toBe("Addon Film")
  })
})

describe("slotsReferencingCustom", () => {
  it("lists slots pointing at the deleted id", () => {
    expect(slotsReferencingCustom("a", "a", "a")).toEqual(["movie", "series"])
    expect(slotsReferencingCustom("a", "b", "a")).toEqual(["movie"])
    expect(slotsReferencingCustom("", "b", "b")).toEqual(["series"])
    expect(slotsReferencingCustom("a", "b", "gone")).toEqual([])
  })

  it("never treats builtin ranking modes as deleted custom catalogs", () => {
    expect(slotsReferencingCustom("jw:popular", "jw:trending", "jw:popular")).toEqual([])
    expect(slotsReferencingCustom("jw:charts", "jw:popular", "jw:charts")).toEqual([])
  })
})

describe("shouldApplyRankRefresh", () => {
  const latest = { gen: 3, key: "movie:7", user: "u1" }

  it("applies only fully current refreshes", () => {
    expect(shouldApplyRankRefresh({ gen: 3, key: "movie:7", user: "u1" }, latest)).toBe(true)
    expect(shouldApplyRankRefresh({ gen: 2, key: "movie:7", user: "u1" }, latest)).toBe(false)
    expect(shouldApplyRankRefresh({ gen: 3, key: "movie:9", user: "u1" }, latest)).toBe(false)
    expect(shouldApplyRankRefresh({ gen: 3, key: "movie:7", user: "u2" }, latest)).toBe(false)
    expect(shouldApplyRankRefresh({ gen: 3, key: "movie:7", user: null }, latest)).toBe(false)
  })
})

describe("rankingSourceCatalogName", () => {
  const customs: CustomCatalogConfig[] = [
    { id: "cat_movies", name: "Trakt Top 20", type: "movie", url: "https://mdblist.com/lists/u/movies" },
  ]

  it("returns the custom name for a driven Top 20 slot", () => {
    expect(
      rankingSourceCatalogName("pictorium-jw-movies", "movie", {
        customCatalogs: customs,
        rankingSourceMovie: "cat_movies",
      }),
    ).toBe("Trakt Top 20")
  })

  it("returns the neutral streaming list name for a driven Top 20 slot", () => {
    const name = genericStreamingCatalogName("hulu", "united-states", "all", null)
    expect(streamingRankingCatalogName(HULU_ALL_ID)).toBe(name)
    expect(
      rankingSourceCatalogName("pictorium-jw-movies", "movie", {
        streamingSelections: [HULU_US_ALL],
        rankingSourceMovie: HULU_ALL_ID,
      }),
    ).toBe(name)
    // A stale/removed streaming reference must not leak a source name.
    expect(streamingRankingCatalogName("pictorium-stream-nope")).toBeNull()
    expect(rankingSourceCatalogName("pictorium-jw-movies", "movie", { rankingSourceMovie: HULU_ALL_ID })).toBeNull()
  })

  it("returns null for the JustWatch default and unrelated catalogs", () => {
    expect(rankingSourceCatalogName("pictorium-jw-movies", "movie", {})).toBeNull()
    expect(
      rankingSourceCatalogName("pictorium-netflix-movies", "movie", {
        customCatalogs: customs,
        rankingSourceMovie: "cat_movies",
      }),
    ).toBeNull()
    expect(
      rankingSourceCatalogName("pictorium-jw-series", "series", {
        customCatalogs: customs,
        rankingSourceMovie: "cat_movies",
      }),
    ).toBeNull()
  })
})
