/**
 * `genreTopWhenFree` (query `gtop`): portrait Standard only — with no top
 * badge painted the genre/rating badge takes the top slot; otherwise (option
 * off, a top badge present, full-width bar) it stays at the bottom.
 */
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { BadgeGeometryReport } from "@/lib/badge-layout"
import type { WikidataResult } from "@/lib/awards"

async function genreTop(overrides: Partial<GenerationInput>): Promise<{ top: number; kind: BadgeGeometryReport["kind"] }> {
  const posterBuf = await sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  let geo: BadgeGeometryReport | null = null
  await generatePosterBuffer({
    posterBuf, logoFetch: null, backdropFetch: null,
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: true,
    genreName: "Drama", voteAverage: 7.5, year: "2024",
    badgeStyle: "pill", rankingBadgeStyle: "default",
    badgeGenre: true, badgeYear: true, badgeRating: true, badgeQuality: false,
    quality: null, qualityBadgeStyle: "standard", videoFormats: [], separateRatings: [],
    topLight: false, targetCenter: 0, ribbonSide: "left",
    logoScale: null, logoOffsetX: null, logoOffsetY: null,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
    genreBadgeScale: 100, qualityBadgeScale: 100, separateBadgeScale: 100, networkLogoScale: 100,
    genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    mediaType: "movie", finalRank: null, animeRankResult: null, rankingResult: null, mapping: null,
    tmdbNetworks: [], productionCompanies: [], tmdbStudios: [],
    tvType: null, tvStatus: null, releaseDate: null, firstAirDate: null, lastAirDate: null, seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [], locale: "it", t: (k: string) => k,
    qLabel: null, queryExtra: null, qNetLogo: null, networkLogo: false,
    sd: {} satisfies ServerDefaults, accentOverride: null, imdbTop250: false, preRelease: false,
    onBadgeGeometry: (g) => { geo = g },
    ...overrides,
  } as GenerationInput)
  const report = geo as BadgeGeometryReport | null
  expect(report?.families.genre).toBeTruthy()
  return { top: report!.families.genre!.top, kind: report!.kind }
}

describe("genreTopWhenFree", () => {
  it("off: genre stays at the bottom", async () => {
    const { top } = await genreTop({})
    expect(top).toBeGreaterThan(STD_H / 2)
  })

  it("on + free top slot: genre moves to the top", async () => {
    const { top, kind } = await genreTop({ genreTopWhenFree: true })
    expect(kind).toBeNull()
    expect(top).toBeLessThan(STD_H / 4)
  })

  it("on + extra badge painted: genre stays at the bottom", async () => {
    const { top, kind } = await genreTop({ genreTopWhenFree: true, queryExtra: "Nuovo" })
    expect(kind).toBe("extra")
    expect(top).toBeGreaterThan(STD_H / 2)
  })

  it("on + full-width bar: genre stays at the bottom", async () => {
    const { top } = await genreTop({ genreTopWhenFree: true, badgeStyle: "bar" })
    expect(top).toBeGreaterThan(STD_H / 2)
  })
})
