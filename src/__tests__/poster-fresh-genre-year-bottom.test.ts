/**
 * Fresh genre/year independence from the separate rating style.
 *
 * Regression: in effective Fresh, genre and year disappeared for every
 * separate rating style except column (the shared bottom suppression for
 * Standard leaked into the Fresh meta column). When their own toggles are
 * enabled they must remain visible for EVERY separate rating style in
 * effective Fresh; Standard keeps the bottom suppression unchanged.
 *
 * Covers `freshMetaRows` (pure row model) across all actual styles plus
 * `generatePosterBuffer` with route-like raw flags (effective suppressed +
 * raw true restores ONLY in Fresh; raw false never re-enables; direct
 * callers without raw use their existing toggles), on both canvas shapes
 * and ranked/unranked effective Fresh, with a Standard non-regression.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { freshMetaRows, type FreshMetaInput } from "@/lib/fresh-layout"
import { resolveSeparateDisplayState } from "@/lib/poster-config"
import type { SeparateRatingsStyle } from "@/lib/badge-styles"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const ALL_STYLES: SeparateRatingsStyle[] = [
  "column",
  "bottom-bar",
  "bottom-pills",
  "bottom-mono",
  "bottom-color",
]

const SEP = [
  { id: "imdb", value: 8.7 },
  { id: "tmdb", value: 7.9 },
]

function metaInput(overrides: Partial<FreshMetaInput> = {}): FreshMetaInput {
  return {
    badgesEnabled: true,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    separateRatingsEnabled: true,
    separateRatingsStyle: "column",
    customRatingsEnabled: false,
    genreName: "Dramma",
    year: "2024",
    voteAverage: 8.3,
    separateRatings: SEP,
    customRatings: undefined,
    ...overrides,
  }
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
    finalRank: 6,
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

async function flatBase(w: number, h: number, hex = "#141419"): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: hex } })
    .jpeg()
    .toBuffer()
}

describe("fresh genre/year stay visible for every separate rating style", () => {
  for (const style of ALL_STYLES) {
    it(`keeps genre+year rows with style=${style}`, () => {
      const kinds = freshMetaRows(metaInput({ separateRatingsStyle: style })).map((r) => r.kind)
      expect(kinds).toContain("genre")
      expect(kinds).toContain("year")
    })
  }

  for (const style of ALL_STYLES) {
    it(`honors each toggle off with style=${style} (off stays off)`, () => {
      const noGenre = freshMetaRows(
        metaInput({ separateRatingsStyle: style, badgeGenre: false }),
      ).map((r) => r.kind)
      expect(noGenre).not.toContain("genre")
      expect(noGenre).toContain("year")
      const noYear = freshMetaRows(
        metaInput({ separateRatingsStyle: style, badgeYear: false }),
      ).map((r) => r.kind)
      expect(noYear).toContain("genre")
      expect(noYear).not.toContain("year")
    })
  }

  it("hides everything when the master badges toggle is off (all styles)", () => {
    for (const style of ALL_STYLES) {
      expect(freshMetaRows(metaInput({ separateRatingsStyle: style, badgesEnabled: false }))).toEqual([])
    }
  })

  it("invents no genre/year without values (all styles)", () => {
    for (const style of ALL_STYLES) {
      const kinds = freshMetaRows(
        metaInput({ separateRatingsStyle: style, genreName: null, year: undefined }),
      ).map((r) => r.kind)
      expect(kinds).not.toContain("genre")
      expect(kinds).not.toContain("year")
    }
  })
})

describe("fresh service restores route-suppressed genre/year (raw flags, Fresh only)", () => {
  it("route-like raw true restores genre/year in bottom styles (ranked portrait)", async () => {
    const poster = await flatBase(STD_W, STD_H)
    const shape = { separateRatings: SEP, separateRatingsStyle: "bottom-bar" as const }
    // What the route sends in bottom: effective flags suppressed, raw on.
    const routeSim = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        badgeGenre: false,
        badgeYear: false,
        badgeRating: false,
        ...shape,
        freshRawBadgeGenre: true,
        freshRawBadgeYear: true,
        freshRawBadgeRating: true,
        freshRawSeparateRatings: true,
      }),
    )
    // Direct caller with the toggles on renders identically (no raw fields).
    const directOn = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", ...shape }),
    )
    // Fully suppressed reference (effective off, no raw restore).
    const suppressed = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        badgeGenre: false,
        badgeYear: false,
        badgeRating: false,
        ...shape,
      }),
    )
    expect(routeSim.equals(directOn)).toBe(true)
    expect(routeSim.equals(suppressed)).toBe(false)
  }, 120000)

  it("year restores independently of genre in bottom styles (ranked portrait)", async () => {
    const poster = await flatBase(STD_W, STD_H)
    const shape = { separateRatings: SEP, separateRatingsStyle: "bottom-pills" as const }
    const both = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        badgeGenre: false,
        badgeYear: false,
        badgeRating: false,
        ...shape,
        freshRawBadgeGenre: true,
        freshRawBadgeYear: true,
        freshRawBadgeRating: true,
        freshRawSeparateRatings: true,
      }),
    )
    // Same input but the year raw explicitly off: only the year line drops.
    const yearOff = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        badgeGenre: false,
        badgeYear: false,
        badgeRating: false,
        ...shape,
        freshRawBadgeGenre: true,
        freshRawBadgeYear: false,
        freshRawBadgeRating: true,
        freshRawSeparateRatings: true,
      }),
    )
    expect(yearOff.equals(both)).toBe(false)
  }, 120000)

  it("raw false never re-enables genre (explicit off wins, ranked portrait column)", async () => {
    const poster = await flatBase(STD_W, STD_H)
    const rawFalse = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        badgeGenre: true,
        freshRawBadgeGenre: false,
      }),
    )
    const genreOff = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", badgeGenre: false }),
    )
    const genreOn = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", badgeGenre: true }),
    )
    expect(rawFalse.equals(genreOff)).toBe(true)
    expect(rawFalse.equals(genreOn)).toBe(false)
  }, 120000)

  it("route-like raw true restores genre/year unranked (scope all) on landscape", async () => {
    const poster = await flatBase(LAND_W, LAND_H)
    const shape = {
      shape: "landscape" as const,
      separateRatings: SEP,
      separateRatingsStyle: "bottom-pills" as const,
    }
    const routeSim = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        posterFreshScope: "all",
        rankingEnabled: false,
        finalRank: null,
        badgeGenre: false,
        badgeYear: false,
        badgeRating: false,
        ...shape,
        freshRawBadgeGenre: true,
        freshRawBadgeYear: true,
        freshRawBadgeRating: true,
        freshRawSeparateRatings: true,
      }),
    )
    const suppressed = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        posterFreshScope: "all",
        rankingEnabled: false,
        finalRank: null,
        badgeGenre: false,
        badgeYear: false,
        badgeRating: false,
        ...shape,
      }),
    )
    const meta = await sharp(routeSim).metadata()
    expect({ w: meta.width, h: meta.height }).toEqual({ w: LAND_W, h: LAND_H })
    expect(routeSim.equals(suppressed)).toBe(false)
  }, 120000)
})

describe("standard bottom suppression unchanged (non-regression)", () => {
  it("shared gate still suppresses genre/year in bottom styles (Standard contract)", () => {
    for (const style of ALL_STYLES) {
      const state = resolveSeparateDisplayState({
        badgesEnabled: true,
        badgeGenre: true,
        badgeYear: true,
        badgeRating: true,
        separateRatings: true,
        separateRatingsStyle: style,
        sepItemCount: SEP.length,
      })
      const isBottom = style !== "column"
      expect(state.bottomActive).toBe(isBottom)
      expect(state.effectiveBadgeGenre).toBe(!isBottom)
      expect(state.effectiveBadgeYear).toBe(!isBottom)
    }
  })

  it("standard honors its (effective) genre toggle in column style", async () => {
    const poster = await flatBase(STD_W, STD_H)
    const on = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "standard", badgeGenre: true }),
    )
    const off = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "standard", badgeGenre: false }),
    )
    expect(on.equals(off)).toBe(false)
  }, 120000)
})
