import sharp from "sharp"
import { describe, expect, it } from "vitest"
import type { WikidataResult } from "@/lib/awards"
import { STD_W, STD_H } from "@/lib/image-utils"
import { generatePosterBuffer } from "@/lib/poster-service"
import type { ServerDefaults } from "@/lib/server-defaults"
import {
  extractDigitalReleaseDate,
  hasDigitalOffer,
  isDigitalPreRelease,
  PRE_RELEASE_DIM_ALPHA,
  PRE_RELEASE_BLUR_SIGMA,
} from "@/lib/pre-release"

const NOW = new Date("2026-07-27T12:00:00Z").getTime()

function releaseDatesResp(results: { iso_3166_1: string; release_dates: { release_date: string; type: number }[] }[]) {
  return { id: 1, results }
}

describe("extractDigitalReleaseDate", () => {
  it("returns the earliest type-4 date for the exact region", () => {
    const resp = releaseDatesResp([
      {
        iso_3166_1: "IT",
        release_dates: [
          { release_date: "2026-03-01T00:00:00.000Z", type: 3 },
          { release_date: "2026-09-15T00:00:00.000Z", type: 4 },
          { release_date: "2026-08-01T00:00:00.000Z", type: 4 },
        ],
      },
    ])
    expect(extractDigitalReleaseDate(resp, "IT")).toBe("2026-08-01")
  })

  it("ignores other regions without fallback", () => {
    const resp = releaseDatesResp([
      { iso_3166_1: "US", release_dates: [{ release_date: "2026-09-15T00:00:00.000Z", type: 4 }] },
    ])
    expect(extractDigitalReleaseDate(resp, "IT")).toBeNull()
  })

  it("returns null when no digital entry exists", () => {
    const resp = releaseDatesResp([
      { iso_3166_1: "IT", release_dates: [{ release_date: "2026-03-01T00:00:00.000Z", type: 3 }] },
    ])
    expect(extractDigitalReleaseDate(resp, "IT")).toBeNull()
  })

  it("returns null on empty/missing payload (fail-open)", () => {
    expect(extractDigitalReleaseDate(null, "IT")).toBeNull()
    expect(extractDigitalReleaseDate({ id: 1, results: [] }, "IT")).toBeNull()
  })
})

describe("hasDigitalOffer", () => {
  it("ignores CINEMA-only offers (film ancora in sala)", () => {
    expect(
      hasDigitalOffer([
        { monetizationType: "CINEMA", presentationType: "CANVAS" },
        { monetizationType: "cinema", presentationType: "HD" },
      ]),
    ).toBe(false)
  })

  it("counts FLATRATE/RENT/BUY/ADS as digital", () => {
    for (const monetizationType of ["FLATRATE", "RENT", "BUY", "ADS", "FREE"]) {
      expect(hasDigitalOffer([{ monetizationType }])).toBe(true)
    }
  })

  it("counts offers with missing monetizationType (fail-open)", () => {
    expect(hasDigitalOffer([{ presentationType: "HD" }])).toBe(true)
  })

  it("is false on empty/missing offers", () => {
    expect(hasDigitalOffer([])).toBe(false)
    expect(hasDigitalOffer(null)).toBe(false)
    expect(hasDigitalOffer(undefined)).toBe(false)
  })
})

describe("isDigitalPreRelease", () => {
  it("is false for tv even with future digital date", () => {
    expect(
      isDigitalPreRelease({ mediaType: "tv", digitalDate: "2026-12-01", jwAvailable: false, now: NOW }),
    ).toBe(false)
  })

  it("JustWatch true wins over a future digital date", () => {
    expect(
      isDigitalPreRelease({ mediaType: "movie", digitalDate: "2026-12-01", jwAvailable: true, now: NOW }),
    ).toBe(false)
  })

  it("future digital date without JW data is pre-release", () => {
    expect(
      isDigitalPreRelease({ mediaType: "movie", digitalDate: "2026-12-01", jwAvailable: null, now: NOW }),
    ).toBe(true)
  })

  it("past digital date is not pre-release", () => {
    expect(
      isDigitalPreRelease({ mediaType: "movie", digitalDate: "2026-01-01", jwAvailable: null, now: NOW }),
    ).toBe(false)
  })

  it("JW false + recent theatrical without digital date is pre-release", () => {
    expect(
      isDigitalPreRelease({
        mediaType: "movie",
        theatricalDate: "2026-07-01",
        digitalDate: null,
        jwAvailable: false,
        now: NOW,
      }),
    ).toBe(true)
  })

  it("JW false + old theatrical without digital date is a data gap, not pre-release", () => {
    expect(
      isDigitalPreRelease({
        mediaType: "movie",
        theatricalDate: "2020-01-01",
        digitalDate: null,
        jwAvailable: false,
        now: NOW,
      }),
    ).toBe(false)
  })

  it("JW false + future theatrical without digital date is pre-release", () => {
    expect(
      isDigitalPreRelease({
        mediaType: "movie",
        theatricalDate: "2026-12-25",
        digitalDate: null,
        jwAvailable: false,
        now: NOW,
      }),
    ).toBe(true)
  })

  it("unknown everything is fail-open (normal poster)", () => {
    expect(
      isDigitalPreRelease({ mediaType: "movie", jwAvailable: null, now: NOW }),
    ).toBe(false)
  })
})

describe("PRE_RELEASE_DIM_ALPHA", () => {
  it("is a valid semi-transparent alpha", () => {
    expect(PRE_RELEASE_DIM_ALPHA).toBeGreaterThan(0)
    expect(PRE_RELEASE_DIM_ALPHA).toBeLessThan(1)
  })
})

describe("PRE_RELEASE_BLUR_SIGMA", () => {
  it("is a valid light blur radius", () => {
    expect(PRE_RELEASE_BLUR_SIGMA).toBeGreaterThan(1)
    expect(PRE_RELEASE_BLUR_SIGMA).toBeLessThanOrEqual(8)
  })

  it("smooths sharp edges in the base poster when coming soon is active", async () => {
    // Canvas with sharp white/black boundary at x=250
    const svg = `<svg width="${STD_W}" height="${STD_H}"><rect width="250" height="${STD_H}" fill="#ffffff"/><rect x="250" width="250" height="${STD_H}" fill="#000000"/></svg>`
    const posterBuf = await sharp(Buffer.from(svg)).jpeg().toBuffer()

    const buf = await generatePosterBuffer({
      posterBuf,
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
      badgesEnabled: false,
      rankingEnabled: false,
      genreName: null,
      voteAverage: null,
      badgeStyle: "vetro",
      rankingBadgeStyle: "default",
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      topLight: false,
      targetCenter: 0,
      ribbonSide: "left",
      logoScale: null,
      logoOffsetX: null,
      logoOffsetY: null,
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
      networkLogo: undefined,
      sd: { networkLogo: false } satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: true,
    })

    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // At y=400 (center of poster), inspect pixels around x=250
    const y = 400
    const p247 = data[(y * info.width + 247) * 4]
    const p250 = data[(y * info.width + 250) * 4]
    const p253 = data[(y * info.width + 253) * 4]

    // With blur, p247 > p250 > p253 smoothly (not an abrupt jump from max to min)
    expect(p247).toBeGreaterThan(p250)
    expect(p250).toBeGreaterThan(p253)
    // Edge transition is gradual: intermediate pixel is well between extremes
    expect(p250).toBeGreaterThan(30)
    expect(p250).toBeLessThan(120)
  }, 30000)
})


describe("Coming Soon ribbon and quality badge placement", () => {
  async function renderTestPoster(ribbonSide: "left" | "right") {
    const posterBuf = await sharp({
      create: {
        width: STD_W,
        height: STD_H,
        channels: 4,
        background: "#050508",
      },
    }).jpeg().toBuffer()

    return generatePosterBuffer({
      posterBuf,
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
      genreName: null,
      voteAverage: null,
      badgeStyle: "vetro",
      rankingBadgeStyle: "default",
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      badgeQuality: true,
      quality: "4K",
      topLight: false,
      targetCenter: 0,
      ribbonSide,
      logoScale: null,
      logoOffsetX: null,
      logoOffsetY: null,
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
      networkLogo: undefined,
      sd: { networkLogo: false } satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: true,
    })
  }

  it("places quality badge on the left when ribbonSide is right", async () => {
    const buf = await renderTestPoster("right")
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

    // Top-left area (x: 24..70, y: 24..55): quality badge has light pixels
    let topLeftLightPixels = 0
    for (let y = 24; y < 55; y++) {
      for (let x = 24; x < 70; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) topLeftLightPixels++
      }
    }
    expect(topLeftLightPixels).toBeGreaterThan(100)

    // Top-right area (x: 400..490, y: 15..70): Coming Soon ribbon has red pixels
    let topRightRedPixels = 0
    for (let y = 15; y < 70; y++) {
      for (let x = 400; x < 490; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 150 && data[i + 1] < 100 && data[i + 2] < 100) topRightRedPixels++
      }
    }
    expect(topRightRedPixels).toBeGreaterThan(100)
  }, 30000)

  it("places quality badge on the right when ribbonSide is left", async () => {
    const buf = await renderTestPoster("left")
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

    // Top-left area (x: 10..90, y: 15..70): Coming Soon ribbon has red pixels
    let topLeftRedPixels = 0
    for (let y = 15; y < 70; y++) {
      for (let x = 10; x < 90; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 150 && data[i + 1] < 100 && data[i + 2] < 100) topLeftRedPixels++
      }
    }
    expect(topLeftRedPixels).toBeGreaterThan(100)

    // Top-right area (x: 410..470, y: 24..55): quality badge has light pixels
    let topRightLightPixels = 0
    for (let y = 24; y < 55; y++) {
      for (let x = 410; x < 470; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) topRightLightPixels++
      }
    }
    expect(topRightLightPixels).toBeGreaterThan(100)
  }, 30000)
})


