/**
 * Lower genre/rating group OFF hides ONLY that row: rank and extra stay
 * painted whenever the TOP toggles allow them (user-confirmed independence:
 * disabling "Badge genere/rating" must not hide classifiche/extra).
 *
 * `generatePosterBuffer` gated the whole top slot on
 * `rankingEnabled && badgesEnabled !== false`, so `badges=0&ranking=1&rk=5`
 * painted nothing. The fix restores the historic `if (rankingEnabled)` gate:
 * the top slot answers only to rankingEnabled/sash/queryExtra, the lower
 * genre row only to badgesEnabled (+ its bg/by/br toggles).
 */
import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { computeTopBadge, type BadgeInput } from "@/lib/poster-badge"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import { LAND_W, LAND_H } from "@/lib/constants"
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
    shape: "poster",
    ...overrides,
  }
}

async function flatPoster(width: number = STD_W, height: number = STD_H): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#101010" } })
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

function badgeInput(trendRank: number | null): BadgeInput {
  return {
    mediaType: "movie",
    tmdbId: null,
    digitalReleaseDate: null,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],

    voteAverage: 0,
    trendRank,
    animeRank: null,
    awards: [],
    nominations: [],
    studios: [],
    director: null,
    tvType: null,
    tvStatus: null,
    keywords: [],
  }
}

describe("lower genre/rating OFF leaves the top slot to the TOP toggles", () => {
  it("badges=0 + ranking=1 + rank paints the numeral (portrait)", async () => {
    const poster = await flatPoster()
    const offWithRank = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, finalRank: 5 }),
    )
    const offPlain = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, finalRank: null }),
    )
    const ratio = await diffRatio(offWithRank, offPlain)
    // The rank numeral alone paints ~2% of pixels: independence, not suppression.
    expect(ratio).toBeGreaterThan(0.001)
  }, 60000)

  it("badges=0 + ranking=1 + rank paints the numeral (landscape)", async () => {
    const poster = await flatPoster(LAND_W, LAND_H);
    const offWithRank = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, finalRank: 5, shape: "landscape" }),
    )
    const offPlain = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, finalRank: null, shape: "landscape" }),
    )
    expect(await diffRatio(offWithRank, offPlain)).toBeGreaterThan(0.0001)
  }, 60000)

  it("explicit extra paints with master OFF when ranking is ON (no silent drop)", async () => {
    const poster = await flatPoster()
    const offWithExtra = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, queryExtra: "Da non perdere" }),
    )
    const offPlain = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, queryExtra: null }),
    )
    expect(await diffRatio(offWithExtra, offPlain)).toBeGreaterThan(0.001)
  }, 60000)

  it("genuine ranking OFF still suppresses the top slot (no forced enable)", async () => {
    const poster = await flatPoster()
    for (const badgesEnabled of [true, false]) {
      const offRank = await generatePosterBuffer(
        baseInput({ posterBuf: poster, badgesEnabled, rankingEnabled: false, finalRank: 5 }),
      )
      const offPlain = await generatePosterBuffer(
        baseInput({ posterBuf: poster, badgesEnabled, rankingEnabled: false, finalRank: null }),
      )
      expect(await diffRatio(offRank, offPlain)).toBeLessThan(0.0001)
    }
  }, 60000)

  it("master OFF hides only the lower genre row (genre gone, rank kept)", async () => {
    const poster = await flatPoster()
    const onFull = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: true, rankingEnabled: true, finalRank: 5 }),
    )
    const offWithRank = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, finalRank: 5 }),
    )
    // Same top numeral in both; the only delta is the missing genre badge.
    expect(await diffRatio(onFull, offWithRank)).toBeGreaterThan(0.0001)
    const offPlain = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: false, rankingEnabled: true, finalRank: null }),
    )
    expect(await diffRatio(offWithRank, offPlain)).toBeGreaterThan(0.001)
  }, 60000)

  it("badges=1 + rank still paints (unchanged ON path)", async () => {
    const poster = await flatPoster()
    const onWithRank = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: true, rankingEnabled: true, finalRank: 5 }),
    )
    const onPlain = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgesEnabled: true, rankingEnabled: true, finalRank: null }),
    )
    const ratio = await diffRatio(onWithRank, onPlain)
    expect(ratio).toBeGreaterThan(0.001)
  }, 60000)

  it("rank data still resolves with master OFF (data vs paint separation)", async () => {
    const t = (k: string) => k
    const computed = computeTopBadge(badgeInput(5), t, "it", null, "locale")
    expect(computed.badge).not.toBeNull()
    expect(computed.badge?.type).toBe("rank")
    expect(computed.badge?.rank).toBe(5)
  })
})
