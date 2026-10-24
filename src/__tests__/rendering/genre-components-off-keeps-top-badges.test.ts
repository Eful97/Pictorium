/**
 * Genre/Rating components are independent of the upper badges (G-settings bug).
 *
 * Disabling the genre-badge components (`badgeGenre`/`badgeYear`/`badgeRating`,
 * i.e. `bg=0`/`by=0`/`br=0`) must NOT hide independently enabled badges:
 * the top rank/extra slot (own `rankingEnabled` gate) and the age
 * classification pill (own `ageLabel` + master gate). The global master
 * (`badgesEnabled === false`) suppresses only the lower genre row and the
 * age pill — never the top rank/extra slot, which answers solely to
 * `rankingEnabled` (see badges-off-top-badge.test.ts).
 */
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

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
    tintStrength: 20,
    topShade: 50,
    badgesEnabled: true,
    rankingEnabled: true,
    genreName: "Dramma",
    voteAverage: 8.2,
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
    releaseDate: "2024-03-01",
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

async function flatPoster(): Promise<Buffer> {
  return sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } })
    .jpeg()
    .toBuffer()
}

/** Fraction of pixels differing in any channel (exact match, no tolerance). */
async function diffRatio(a: Buffer, b: Buffer): Promise<number> {
  const [{ data: da, info: ia }, { data: db, info: ib }] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  expect(ia.width).toBe(ib.width)
  expect(ia.height).toBe(ib.height)
  let diff = 0
  const total = ia.width * ia.height
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diff++
  }
  return diff / total
}

/** Genre/rating components all off (master and rank gates stay on). */
const genreOff = { badgeGenre: false, badgeYear: false, badgeRating: false }

describe("genre/rating components off keep the upper badges", () => {
  it("rank still paints with genre+rating off (own ranking gate enabled)", async () => {
    const poster = await flatPoster()
    const withRank = await generatePosterBuffer(
      baseInput({ posterBuf: poster, ...genreOff, rankingEnabled: true, finalRank: 5 }),
    )
    const noRank = await generatePosterBuffer(
      baseInput({ posterBuf: poster, ...genreOff, rankingEnabled: true, finalRank: null }),
    )
    const ratio = await diffRatio(withRank, noRank)
    expect(ratio).toBeGreaterThan(0.001)
  }, 60000)

  it("manual extra still paints with genre+rating off", async () => {
    const poster = await flatPoster()
    const withExtra = await generatePosterBuffer(
      baseInput({ posterBuf: poster, ...genreOff, rankingEnabled: true, queryExtra: "Da non perdere" }),
    )
    const noExtra = await generatePosterBuffer(
      baseInput({ posterBuf: poster, ...genreOff, rankingEnabled: true, queryExtra: null }),
    )
    const ratio = await diffRatio(withExtra, noExtra)
    expect(ratio).toBeGreaterThan(0.001)
  }, 60000)

  it("age pill still paints with genre+rating off (own age gate enabled)", async () => {
    const poster = await flatPoster()
    const withAge = await generatePosterBuffer(
      baseInput({ posterBuf: poster, ...genreOff, ageLabel: "VM14" }),
    )
    const noAge = await generatePosterBuffer(
      baseInput({ posterBuf: poster, ...genreOff, ageLabel: null }),
    )
    const ratio = await diffRatio(withAge, noAge)
    expect(ratio).toBeGreaterThan(0.0002)
  }, 60000)

  it("master OFF still suppresses the age pill (unchanged contract)", async () => {
    const poster = await flatPoster()
    const offWithAge = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, ageLabel: "VM14" }),
    )
    const offPlain = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, ageLabel: null }),
    )
    const ratio = await diffRatio(offWithAge, offPlain)
    expect(ratio).toBeLessThan(0.0001)
  }, 60000)
})
