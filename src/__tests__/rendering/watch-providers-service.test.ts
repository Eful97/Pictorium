/**
 * Service integration for "Dove guardare": with a provider list the row is
 * painted in the top (network) area, even with the network logo toggle OFF;
 * with no list the render is byte-identical to today.
 */
import sharp from "sharp"
import { afterEach, describe, expect, it, vi } from "vitest"
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


async function solidLogo(): Promise<Buffer> {
  return sharp({ create: { width: 92, height: 92, channels: 3, background: { r: 230, g: 20, b: 20 } } }).png().toBuffer()
}

/** Changed pixels in the top fifth vs the bottom half. */
async function diffByBand(a: Buffer, b: Buffer): Promise<{ top: number; bottom: number }> {
  const [x, y] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  const { width, height } = x.info
  let top = 0
  let bottom = 0
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = (py * width + px) * 4
      if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) {
        if (py < height * 0.2) top++
        else if (py > height * 0.5) bottom++
      }
    }
  }
  return { top, bottom }
}

const providers = [
  { id: 8, name: "Netflix", logoPath: "/n.jpg" },
  { id: 119, name: "Prime", logoPath: "/p.jpg" },
  { id: 337, name: "Disney", logoPath: "/d.jpg" },
  { id: 2, name: "Extra", logoPath: "/e.jpg" },
]

describe("watch providers row in the service", () => {
  afterEach(() => vi.restoreAllMocks())

  it("paints icons at the top; empty list is identical to no list", async () => {
    const logo = await solidLogo()
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Uint8Array(logo), { status: 200, headers: { "content-type": "image/png" } }))
    const poster = await flatPoster()
    const plain = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const empty = await generatePosterBuffer(baseInput({ posterBuf: poster, watchProviders: [] }))
    const withRow = await generatePosterBuffer(baseInput({ posterBuf: poster, watchProviders: providers }))

    expect(await diffRatio(plain, empty)).toBe(0)
    const band = await diffByBand(plain, withRow)
    expect(band.top).toBeGreaterThan(200)
    // A regular network logo also nudges the lower area slightly; the row must stay a top-area change.
    expect(band.bottom).toBeLessThan(band.top)
  }, 60000)

  it("all logo downloads failing leaves the poster unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("no", { status: 404 }))
    const poster = await flatPoster()
    const plain = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const unseen = providers.map((p) => ({ ...p, logoPath: `/miss${p.id}.jpg` }))
    const withRow = await generatePosterBuffer(baseInput({ posterBuf: poster, watchProviders: unseen }))
    expect(await diffRatio(plain, withRow)).toBe(0)
  }, 60000)
})
