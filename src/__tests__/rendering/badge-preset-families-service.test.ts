/**
 * Service rendering with the per-family map (existing shared builders only).
 *
 * No poster-service mocks here: these tests run the real composite to prove
 * that rank/extra/genre render independently from their own families while
 * every other transported family keeps the native standard render.
 */
import sharp from "sharp"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  generatePosterBuffer,
  __resetPresetJsonCacheForTests,
  type GenerationInput,
} from "@/lib/poster-service"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"
import type { BadgePreset } from "@/lib/badge-preset"

vi.mock("@/lib/badge-preset-store", () => ({
  getPresetForUser: vi.fn(),
}))

const OWNER = "123e4567-e89b-12d3-a456-426614174000"
const RANK_ID = "Rank0000-aaa"
const RANK_REV = "12345678"
const GENRE_ID = "Genre1111-bb"
const GENRE_REV = "abcdef01"
const QUALITY_ID = "Qual2222-ccc"

function customPreset(id: string, target: BadgePreset["target"], rev = GENRE_REV): BadgePreset {
  return {
    version: 1,
    id,
    ownerUuid: OWNER,
    target,
    visibility: "private",
    metadata: { name: "P", tags: [] },
    variant: "custom",
    design: {
      shape: "pill",
      padding: { x: 12, y: 6 },
      background: { type: "solid", color: "#cc0000", opacity: 100 },
      text: {
        template: "P",
        color: "#ffffff",
        opacity: 100,
        fontSize: 20,
        fontWeight: 700,
        uppercase: false,
        letterSpacing: 0,
        align: "center",
      },
      scale: 100,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: rev,
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
    rankingEnabled: false,
    genreName: "Dramma",
    voteAverage: 8.5,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: false,
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
    ...overrides,
  }
}

async function darkPoster(): Promise<Buffer> {
  return sharp({
    create: { width: 500, height: 750, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
}

async function pixelDiff(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer()
  const rb = await sharp(b).ensureAlpha().raw().toBuffer()
  let diff = 0
  for (let i = 0; i < ra.length; i += 16) if (Math.abs(ra[i] - rb[i]) > 12) diff++
  return diff
}

describe("generatePosterBuffer with badgeFamilyPresets", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetPresetJsonCacheForTests()
  })

  it("substitutes the genre slot from its own family (legacy untouched)", async () => {
    const poster = await darkPoster()
    const genre = customPreset(GENRE_ID, "genre", GENRE_REV)
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const withFamily = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgeFamilyPresets: { genre } }),
    )
    expect(await pixelDiff(baseline, withFamily)).toBeGreaterThan(50)
  })

  it("applies rank and extra independently by actual top kind", async () => {
    const poster = await darkPoster()
    const rankPreset = customPreset(RANK_ID, "rank", RANK_REV)
    const extraPreset = customPreset(GENRE_ID, "extra", GENRE_REV)
    // Rank kind (finalRank): the rank family wins, the extra family is inert.
    const rankBaseline = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, finalRank: 3 }),
    )
    const rankWith = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        rankingEnabled: true,
        finalRank: 3,
        badgeFamilyPresets: { rank: rankPreset, extra: extraPreset },
      }),
    )
    expect(await pixelDiff(rankBaseline, rankWith)).toBeGreaterThan(50)
    // Extra kind (explicit custom text): the extra family wins, rank is inert.
    const extraBaseline = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, queryExtra: "TOP" }),
    )
    const extraWith = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        rankingEnabled: true,
        queryExtra: "TOP",
        badgeFamilyPresets: { rank: rankPreset, extra: extraPreset },
      }),
    )
    expect(await pixelDiff(extraBaseline, extraWith)).toBeGreaterThan(50)
    // A rank-only map leaves the extra slot on the standard render.
    const extraRankOnly = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        rankingEnabled: true,
        queryExtra: "TOP",
        badgeFamilyPresets: { rank: rankPreset },
      }),
    )
    expect(await pixelDiff(extraBaseline, extraRankOnly)).toBe(0)
  })

  it("ignores incompatible targets and non-rendered families (standard render)", async () => {
    const poster = await darkPoster()
    const quality = customPreset(QUALITY_ID, "quality")
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const withMismatch = await generatePosterBuffer(
      baseInput({ posterBuf: poster, badgeFamilyPresets: { genre: quality, quality } }),
    )
    expect(await pixelDiff(baseline, withMismatch)).toBe(0)
  })
})
