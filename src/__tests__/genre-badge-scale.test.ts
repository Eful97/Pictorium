/**
 * Scala del badge genere/rating in basso (`gscale`): il bitmap del badge
 * viene ridimensionato dopo il render, prima del fit canvas.
 *
 * Regressione: la scala deve cambiare davvero l'altezza del badge composto
 * (non solo viaggiare nei query param).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

async function darkPoster(): Promise<Buffer> {
  return sharp({
    create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
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
    networkLogoScale: 100,
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

/** Altezza della fascia di pixel chiari (testo badge) in basso al centro. */
async function brightBandHeight(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let top = info.height
  for (let y = info.height - 1; y >= info.height - 160; y--) {
    let bright = 0
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) bright++
    }
    if (bright > 3) top = y
    else if (top !== info.height && y < top - 2) break
  }
  return info.height - top
}

describe("genre badge scale", () => {
  it("scales the composed badge height proportionally", async () => {
    const poster = await darkPoster()
    const at100 = await generatePosterBuffer(baseInput({ posterBuf: poster, genreBadgeScale: 100 }))
    const at150 = await generatePosterBuffer(baseInput({ posterBuf: poster, genreBadgeScale: 150 }))
    const h100 = await brightBandHeight(at100)
    const h150 = await brightBandHeight(at150)
    expect(h100).toBeGreaterThan(5)
    expect(h150 / h100).toBeCloseTo(1.5, 1)
  }, 30000)
})

/** Pixel chiari nella zona top-right (badge qualità su poster scuro). */
async function brightTopRightCount(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = 5; y < 100; y++) {
    for (let x = info.width - 150; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) n++
    }
  }
  return n
}

describe("quality badge scale", () => {
  it("scales the composed badge area proportionally", async () => {
    const poster = await darkPoster()
    const input = { posterBuf: poster, quality: "4K", badgeQuality: true }
    const at100 = await generatePosterBuffer(baseInput({ ...input, qualityBadgeScale: 100 }))
    const at150 = await generatePosterBuffer(baseInput({ ...input, qualityBadgeScale: 150 }))
    const c100 = await brightTopRightCount(at100)
    const c150 = await brightTopRightCount(at150)
    expect(c100).toBeGreaterThan(100)
    expect(c150 / c100).toBeCloseTo(2.25, 0)
  }, 30000)
})
