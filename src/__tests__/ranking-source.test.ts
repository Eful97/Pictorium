import { describe, expect, it } from "vitest"
import { configTokenSchema, decodeConfig, encodeConfig } from "@/lib/config-token"
import {
  filterRankingItemsBySlot,
  compatibleRankingCustoms,
  slotsReferencingCustom,
  shouldApplyRankRefresh,
  rankingSourceCatalogName,
  resolveRankingSource,
} from "@/lib/ranking-source"
import type { CustomCatalogConfig } from "@/lib/types"

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
  it("defaults to JustWatch without any selection (old configs stay valid)", () => {
    expect(resolveRankingSource({}, "movie")).toEqual({ kind: "justwatch" })
    expect(resolveRankingSource({}, "series")).toEqual({ kind: "justwatch" })
    expect(
      resolveRankingSource({ customCatalogs: ALL }, "movie"),
    ).toEqual({ kind: "justwatch" })
  })

  it("treats empty or whitespace selection as JustWatch", () => {
    expect(
      resolveRankingSource({ customCatalogs: ALL, rankingSourceMovie: "" }, "movie"),
    ).toEqual({ kind: "justwatch" })
    expect(
      resolveRankingSource({ customCatalogs: ALL, rankingSourceSeries: "   " }, "series"),
    ).toEqual({ kind: "justwatch" })
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

  it("falls back to JustWatch on cross-type selection", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "cat_series" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch" })
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceSeries: "cat_movies" },
        "series",
      ),
    ).toEqual({ kind: "justwatch" })
  })

  it("falls back to JustWatch when the referenced catalog was deleted", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: [MOVIE_CUSTOM], rankingSourceMovie: "cat_gone" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch" })
  })

  it("falls back to JustWatch when the referenced catalog is disabled", () => {
    const disabled: CustomCatalogConfig = { ...MOVIE_CUSTOM, enabled: false }
    expect(
      resolveRankingSource(
        { customCatalogs: [disabled], rankingSourceMovie: "cat_movies" },
        "movie",
      ),
    ).toEqual({ kind: "justwatch" })
  })

  it("falls back to JustWatch on overlong ids (schema bound)", () => {
    expect(
      resolveRankingSource(
        { customCatalogs: ALL, rankingSourceMovie: "x".repeat(65) },
        "movie",
      ),
    ).toEqual({ kind: "justwatch" })
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

  it("rejects overlong selection ids in the token schema", () => {
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
      rankingSourceMovie: "x".repeat(65),
    })
    expect(parsed.success).toBe(false)
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
  ]

  it("keeps enabled type-compatible customs (mixed fits both)", () => {
    expect(compatibleRankingCustoms(customs, "movie").map((c) => c.id)).toEqual(["m", "x"])
    expect(compatibleRankingCustoms(customs, "series").map((c) => c.id)).toEqual(["s", "x"])
  })

  it("returns empty without catalogs", () => {
    expect(compatibleRankingCustoms(undefined, "movie")).toEqual([])
    expect(compatibleRankingCustoms(null, "series")).toEqual([])
  })
})

describe("slotsReferencingCustom", () => {
  it("lists slots pointing at the deleted id", () => {
    expect(slotsReferencingCustom("a", "a", "a")).toEqual(["movie", "series"])
    expect(slotsReferencingCustom("a", "b", "a")).toEqual(["movie"])
    expect(slotsReferencingCustom("", "b", "b")).toEqual(["series"])
    expect(slotsReferencingCustom("a", "b", "gone")).toEqual([])
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
