import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

/**
 * A saved landscape backdrop must NEVER be painted as a centered 16:9 band on
 * the portrait canvas. The service gate is the fail-closed half of the fix:
 * even a caller that still forwards `backdropFetch` on portrait cannot paint
 * the band. Landscape keeps the historical backdrop composite layer.
 */

function posterInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
    badgesEnabled: false,
    rankingEnabled: false,
    genreName: null,
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
    ...overrides,
  }
}

async function flatImage(w: number, h: number, hex: string): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: hex } }).png().toBuffer()
}

async function centerPixel(buf: Buffer): Promise<[number, number, number]> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
  const x = Math.floor(info.width / 2)
  const y = Math.floor(info.height / 2)
  const i = (y * info.width + x) * info.channels
  return [data[i], data[i + 1], data[i + 2]]
}

const RED = "#c81e1e"
const BLUE = "#1e3ac8"

describe("portrait canvas never paints the landscape backdrop as a centered band", () => {
  it("portrait: a forwarded backdrop buffer is ignored (base stays full-bleed poster)", async () => {
    const poster = await flatImage(500, 750, RED)
    const backdrop = await flatImage(1920, 1080, BLUE)
    const out = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      backdropFetch: backdrop,
      shape: "poster",
    }))
    const [r, , b] = await centerPixel(out)
    // Center of the canvas (y=375) sits in the band's y range (235..516):
    // the red portrait base must win, never the blue backdrop.
    expect(r).toBeGreaterThan(120)
    expect(r).toBeGreaterThan(b + 40)
  })

  it("landscape: the backdrop composite layer still paints (regression)", async () => {
    // The route hands the service an already-fitted landscape base (768x432),
    // so the regression fixture must match the real canvas size.
    const poster = await flatImage(768, 432, RED)
    const backdrop = await flatImage(1920, 1080, BLUE)
    const out = await generatePosterBuffer(posterInput({
      posterBuf: poster,
      backdropFetch: backdrop,
      shape: "landscape",
    }))
    const [r, , b] = await centerPixel(out)
    expect(b).toBeGreaterThan(120)
    expect(b).toBeGreaterThan(r + 40)
  })
})
