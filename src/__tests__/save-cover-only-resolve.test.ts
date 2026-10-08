/**
 * Default-resolution proof for the cover-only save: a minimal mapping
 * (cover identity + title metadata, as persisted by the cover-only POST)
 * inherits every visual from the server defaults, while a fully-frozen
 * mapping keeps its own values. Uses the real delivered chain
 * (buildStremioPosterUrl -> query -> resolvePosterRenderConfig), not a
 * fetch mock and not an empty query.
 */
import { describe, expect, it } from "vitest"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import { mappingSchema } from "@/lib/validation"
import type { Mapping } from "@/lib/types"

function sdBase(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    badgeStyle: "pill",
    rankingBadgeStyle: "colored",
    gradientHeight: 55,
    globalBadges: false,
    rankingBadges: false,
    badgeGenre: false,
    badgeYear: true,
    badgeRating: false,
    badgeQuality: true,
    logoScale: 80,
    logoOffsetX: 5,
    logoOffsetY: -5,
    ...extra,
  }
}

function inputFromUrl(url: URL, mapping: Mapping | null, sd: Record<string, unknown>): PosterRenderConfigInput {
  const searchParams = new URLSearchParams(url.search)
  return {
    searchParams,
    mapping,
    configOverride: null,
    sd: sd as never,
    // Mirrors the poster route: hasQuery is true with a saved mapping, and
    // showBadges/rankingBadges are pre-resolved from the mapping (route:
    // mapping toggle ?? true) before resolvePosterRenderConfig.
    hasQuery: mapping !== null,
    showBadges: mapping?.showBadges ?? true,
    rankingBadges: mapping?.rankingBadges ?? true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
  }
}

function toMapping(body: Record<string, unknown>): Mapping {
  const parsed = mappingSchema.safeParse(body)
  if (!parsed.success) throw new Error("cover-only body must validate")
  return {
    ...parsed.data,
    logoPath: (body.logoPath as string | null) ?? null,
    originalPosterPath: (parsed.data.originalPosterPath ?? null) as string | null,
    language: (parsed.data.language ?? null) as string | null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Mapping
}

describe("cover-only mapping inherits the global defaults (delivered URL chain)", () => {
  it("toggles false honored via delivered URL; later defaults change without rewriting the mapping", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: { file_path: "/logo.png", iso_639_1: "en", vote_average: 0, width: 800, height: 200 },
      logoDisabled: false,
      prevMapping: null,
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5, release_date: "2024-03-01", imdb_id: "tt0137523", wikidata_id: "Q190304" },
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })!
    const mapping = toMapping(body)
    // Selected logo identity persists; transforms stay omitted (defaults).
    expect(mapping.logoPath).toBe("/logo.png")
    expect(mapping.logoScale).toBeUndefined()

    const sd1 = sdBase()
    const url1 = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 550,
      defaults: sd1 as never,
      mapping,
    })
    // Explicit OFF toggles travel in the delivered query (compact URLs keep
    // toggles explicit; tuning goes in `dv`).
    expect(url1.searchParams.get("badges")).toBe("0")
    expect(url1.searchParams.get("ranking")).toBe("0")
    expect(url1.searchParams.get("bg")).toBe("0")
    expect(url1.searchParams.get("br")).toBe("0")
    const config1 = resolvePosterRenderConfig(inputFromUrl(url1, mapping, sd1))
    expect(config1.badgesEnabled).toBe(false)
    expect(config1.badgeStyle).toBe("pill")
    // Logo transforms resolve from the global defaults (mapping omits them).
    expect(config1.logoScale).toBe(80)
    expect(config1.logoOffsetX).toBe(5)
    expect(config1.logoOffsetY).toBe(-5)

    // Later the operator flips the defaults: rebuilding the URL from the SAME
    // saved mapping (no rewrite) follows the new defaults.
    const sd2 = sdBase({ globalBadges: true, rankingBadges: true, badgeGenre: true, badgeRating: true, logoScale: 90 })
    const url2 = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 550,
      defaults: sd2 as never,
      mapping,
    })
    expect(url2.searchParams.get("badges")).toBeNull()
    expect(url2.searchParams.get("ranking")).toBeNull()
    const config2 = resolvePosterRenderConfig(inputFromUrl(url2, mapping, sd2))
    expect(config2.badgesEnabled).toBe(true)
    expect(config2.logoScale).toBe(90)
  })

  it("post-save Test URL keeps Genre/Rating metadata with defaults enabled; OFF defaults still disable", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: null,
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5, release_date: "2024-03-01" },
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })!
    // Regression: the mapped poster branch renders genre/vote ONLY from the
    // mapping (no TMDB details fetch when a mapping exists). Without these
    // the Genre/Rating badge blanks on Test URL/Stremio after save.
    expect(body.genreName).toBe("Dramma")
    expect(body.voteAverage).toBe(7.5)
    expect(body.releaseDate).toBe("2024-03-01")
    const mapping = toMapping(body)
    // Mapped-branch read (route lines ~1038/1055): metadata present.
    expect(mapping.genreName ?? null).toBe("Dramma")
    expect(mapping.voteAverage ?? null).toBe(7.5)

    // With defaults ON the delivered poster keeps Genre+Rating components.
    const sdOn = sdBase({ globalBadges: true, rankingBadges: true, badgeGenre: true, badgeRating: true })
    const urlOn = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 550,
      defaults: sdOn as never,
      mapping,
    })
    expect(urlOn.searchParams.get("bg")).toBeNull()
    expect(urlOn.searchParams.get("br")).toBeNull()
    const configOn = resolvePosterRenderConfig(inputFromUrl(urlOn, mapping, sdOn))
    expect(configOn.badgesEnabled).toBe(true)
    expect(configOn.badgeGenre).toBe(true)
    expect(configOn.badgeRating).toBe(true)

    // Deliberately OFF defaults still disable (no forced ON).
    const sdOff = sdBase()
    const urlOff = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 550,
      defaults: sdOff as never,
      mapping,
    })
    expect(urlOff.searchParams.get("bg")).toBe("0")
    expect(urlOff.searchParams.get("br")).toBe("0")
    const configOff = resolvePosterRenderConfig(inputFromUrl(urlOff, mapping, sdOff))
    expect(configOff.badgeGenre).toBe(false)
    expect(configOff.badgeRating).toBe(false)
  })

  it("frozen full mapping still wins over the defaults (full-save unchanged)", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: null,
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })!
    const base = toMapping(body)
    const frozen = {
      ...base,
      badgeStyle: "colored",
      rankingBadgeStyle: "pill",
      showBadges: false,
      gradientHeight: 80,
      blurEnabled: false,
      logoScale: 80,
      logoOffsetX: 5,
      logoOffsetY: -5,
    } as Mapping
    const sd = sdBase()
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 550,
      defaults: sd as never,
      mapping: frozen,
    })
    const config = resolvePosterRenderConfig(inputFromUrl(url, frozen, sd))
    expect(config.badgeStyle).toBe("colored")
    expect(config.rankingBadgeStyle).toBe("pill")
    expect(config.badgesEnabled).toBe(false)
    expect(config.blurHeight).toBe(80)
    expect(config.blurEnabled).toBe(false)
    expect(config.logoScale).toBe(80)
    expect(config.logoOffsetX).toBe(5)
    expect(config.logoOffsetY).toBe(-5)
  })
})
