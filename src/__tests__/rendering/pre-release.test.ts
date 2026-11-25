import sharp from "sharp"
import { describe, expect, it } from "vitest"
import type { WikidataResult } from "@/lib/awards"
import { STD_W, STD_H } from "@/lib/image-utils"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import type { ServerDefaults } from "@/lib/server-defaults"
import {
  extractDigitalReleaseDate,
  hasDigitalOffer,
  isDigitalPreRelease,
  resolveTheatricalPhase,
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

  it("JW unknown (null) + recent theatrical is NOT pre-release (no ribbon unless sure)", () => {
    expect(
      isDigitalPreRelease({
        mediaType: "movie",
        theatricalDate: "2026-07-01",
        digitalDate: null,
        jwAvailable: null,
        now: NOW,
      }),
    ).toBe(false)
  })

  it("JW unknown (null) + old theatrical is a data gap, not pre-release", () => {
    expect(
      isDigitalPreRelease({
        mediaType: "movie",
        theatricalDate: "2020-01-01",
        digitalDate: null,
        jwAvailable: null,
        now: NOW,
      }),
    ).toBe(false)
  })

  it("JW unknown (null) + future theatrical is NOT pre-release (no ribbon unless sure)", () => {
    expect(
      isDigitalPreRelease({
        mediaType: "movie",
        theatricalDate: "2026-12-25",
        digitalDate: null,
        jwAvailable: null,
        now: NOW,
      }),
    ).toBe(false)
  })

  it("JW true + future theatrical without digital date is not pre-release", () => {
    expect(
      isDigitalPreRelease({
        mediaType: "movie",
        theatricalDate: "2026-12-25",
        digitalDate: null,
        jwAvailable: true,
        now: NOW,
      }),
    ).toBe(false)
  })

  it("unknown everything is fail-open (normal poster)", () => {
    expect(
      isDigitalPreRelease({ mediaType: "movie", jwAvailable: null, now: NOW }),
    ).toBe(false)
  })
})

describe("resolveTheatricalPhase", () => {
  it("splits already-released films (inTheaters) from unreleased ones (upcoming)", () => {
    const base = { mediaType: "movie" as const, digitalDate: null, jwAvailable: false, now: NOW }
    expect(resolveTheatricalPhase({ ...base, theatricalDate: "2026-07-01" })).toBe("inTheaters")
    expect(resolveTheatricalPhase({ ...base, theatricalDate: "2026-12-25" })).toBe("upcoming")
  })

  it("no phase with unknown JustWatch data (ribbon only on certain data)", () => {
    expect(
      resolveTheatricalPhase({
        mediaType: "movie",
        theatricalDate: "2026-07-01",
        digitalDate: null,
        jwAvailable: null,
        now: NOW,
      }),
    ).toBeNull()
  })

  it("a future digital date is upcoming even with a past theatrical release", () => {
    expect(
      resolveTheatricalPhase({
        mediaType: "movie",
        theatricalDate: "2026-07-01",
        digitalDate: "2026-08-20",
        jwAvailable: false,
        now: NOW,
      }),
    ).toBe("upcoming")
  })

  it("never claims inTheaters when the film is available or out of the window", () => {
    expect(
      resolveTheatricalPhase({
        mediaType: "movie",
        theatricalDate: "2026-07-01",
        digitalDate: null,
        jwAvailable: true,
        now: NOW,
      }),
    ).toBeNull()
    expect(
      resolveTheatricalPhase({
        mediaType: "movie",
        theatricalDate: "2020-01-01",
        digitalDate: null,
        jwAvailable: false,
        now: NOW,
      }),
    ).toBeNull()
    expect(
      resolveTheatricalPhase({
        mediaType: "movie",
        theatricalDate: "2026-07-01",
        digitalDate: "2026-07-01",
        jwAvailable: null,
        now: NOW,
      }),
    ).toBeNull()
  })

  it("is movie-only and fail-open on missing data", () => {
    expect(
      resolveTheatricalPhase({
        mediaType: "tv",
        theatricalDate: "2026-07-01",
        digitalDate: null,
        jwAvailable: false,
        now: NOW,
      }),
    ).toBeNull()
    expect(resolveTheatricalPhase({ mediaType: "movie", jwAvailable: null, now: NOW })).toBeNull()
  })

  it("keeps isDigitalPreRelease consistent with both phases", () => {
    for (const theatricalDate of ["2026-07-01", "2026-12-25"]) {
      const input = { mediaType: "movie" as const, theatricalDate, digitalDate: null, jwAvailable: false, now: NOW }
      expect(resolveTheatricalPhase(input)).not.toBeNull()
      expect(isDigitalPreRelease(input)).toBe(true)
    }
  })
})

/** Canvas with a sharp white/black boundary at x=250 (blur/veil detector). */
async function brightBoundaryPoster(): Promise<Buffer> {
  const svg = `<svg width="${STD_W}" height="${STD_H}"><rect width="250" height="${STD_H}" fill="#ffffff"/><rect x="250" width="250" height="${STD_H}" fill="#000000"/></svg>`
  return sharp(Buffer.from(svg)).jpeg().toBuffer()
}

/** Minimal pre-release render input (badges off, bright flat poster). */
function preReleaseInput(
  posterBuf: Buffer,
  overrides: Partial<GenerationInput> = {},
): GenerationInput {
  return {
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
    networkLogo: undefined,
    sd: { networkLogo: false } satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: true,
    ...overrides,
  }
}

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
    const buf = await generatePosterBuffer(preReleaseInput(await brightBoundaryPoster()))

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

describe("in-theaters badge (no veil, no blur)", () => {
  it("leaves the artwork untouched: badge only, full contrast, no dimming", async () => {
    const poster = await brightBoundaryPoster()
    const plain = await generatePosterBuffer(preReleaseInput(poster, { preRelease: false }))
    const inTheaters = await generatePosterBuffer(preReleaseInput(poster, { preInTheaters: true }))
    const comingSoon = await generatePosterBuffer(preReleaseInput(poster))

    const [plainRaw, inRaw, csRaw] = await Promise.all([
      sharp(plain).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(inTheaters).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(comingSoon).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ])
    const { info } = plainRaw
    const px = (data: Buffer, x: number, y: number) => data[(y * info.width + x) * 4]

    // Boundary at x=250 (y=400): Coming Soon blurs + dims the artwork, so the
    // edge becomes mid-grey; "Al cinema" keeps the plain sharp/full-contrast
    // artwork (no veil, no blur).
    const y = 400
    expect(px(csRaw.data, 247, y)).toBeLessThan(200)
    expect(px(inRaw.data, 247, y)).toBeGreaterThan(200)
    expect(px(inRaw.data, 253, y)).toBeLessThan(60)

    // No veil: a region far from the badge is pixel-identical to the plain
    // poster (a 0.45 black veil would darken every sample).
    for (let yy = 600; yy < 700; yy += 7) {
      for (let xx = 20; xx < 120; xx += 7) {
        const i = (yy * info.width + xx) * 4
        expect([inRaw.data[i], inRaw.data[i + 1], inRaw.data[i + 2]]).toEqual([
          plainRaw.data[i], plainRaw.data[i + 1], plainRaw.data[i + 2],
        ])
      }
    }

    // The badge itself is still painted.
    expect(Buffer.compare(inTheaters, plain)).not.toBe(0)
  }, 60000)
})


describe("Coming Soon ribbon and quality badge placement", () => {
  async function renderTestPoster(
    ribbonSide: "left" | "right",
    overrides: Partial<GenerationInput> = {},
  ) {
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
      networkLogo: undefined,
      sd: { networkLogo: false } satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: true,
      ...overrides,
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

  it("pre ON: already-released films show 'Al cinema' in the red ribbon", async () => {
    const buf = await renderTestPoster("left", { preInTheaters: true })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let topLeftRedPixels = 0
    for (let y = 15; y < 70; y++) {
      for (let x = 10; x < 90; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 150 && data[i + 1] < 100 && data[i + 2] < 100) topLeftRedPixels++
      }
    }
    expect(topLeftRedPixels).toBeGreaterThan(100)
  }, 30000)

  it("pre OFF (beige): detected films get the centered badge instead of the ribbon", async () => {
    const buf = await renderTestPoster("left", { preInTheaters: true, preRelease: false, preBeige: true, rankingEnabled: true })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

    // Ribbon area (top-left, same window as the Coming Soon assertions): no
    // red diagonal at all — with `pre` off the label is a normal extra badge.
    let topLeftRedPixels = 0
    for (let y = 15; y < 70; y++) {
      for (let x = 10; x < 90; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 150 && data[i + 1] < 100 && data[i + 2] < 100) topLeftRedPixels++
      }
    }
    expect(topLeftRedPixels).toBe(0)

    // Centered top band: the satin pill (light on a dark top) is painted.
    let topCenterLightPixels = 0
    for (let y = 15; y < 70; y++) {
      for (let x = 150; x < 350; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) topCenterLightPixels++
      }
    }
    expect(topCenterLightPixels).toBeGreaterThan(100)
  }, 30000)
})


