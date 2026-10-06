/**
 * Landscape network with the corner style (rank or extra): by default the
 * network mark sits above the title logo as in portrait, centered on the
 * title bounding box in every layout (centered, Cinematic Left or shifted
 * titles) — never on the canvas center. Without a title/hideLogo, with
 * non-corner styles or with explicit netPos=top the historic top-left anchor
 * applies. The title never moves.
 *
 * Pixel regression via generatePosterBuffer on a dark backdrop. The
 * synthetic network mark ("N" Netflix, bare red logo without a pill) is
 * detected on the R channel; the fake white title and the white badge texts
 * are detected on all channels (the #5D6D7E corner tint stays under
 * threshold). Center alignment is exact by formula; the raster assertions
 * allow a few px for the icon ink asymmetry.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { LAND_W, LAND_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

async function darkBackdrop(): Promise<Buffer> {
  return sharp({
    create: { width: LAND_W, height: LAND_H, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
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
    rankingEnabled: true,
    genreName: "Dramma",
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "corner",
    badgeGenre: true,
    badgeYear: false,
    badgeRating: false,
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: 50,
    logoOffsetX: 0,
    logoOffsetY: 0,
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
    finalRank: 4,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: ["Netflix"],
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
    networkLogo: true,
    sd: { networkLogo: true } satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    shape: "landscape",
    ...overrides,
  }
}

/** All channels bright: white title and white badge texts. */
function isBright(r: number, g: number, b: number): boolean {
  return r > 150 && g > 150 && b > 150
}

/** R channel only: the red network mark (its G/B are low). */
function isNetRed(r: number): boolean {
  return r > 150
}

async function raw(buf: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** Title bounding box: only ≥150px white runs (the genre text runs shorter). */
async function titleBoxByScan(buf: Buffer): Promise<Box> {
  const { data, w, h } = await raw(buf)
  let left = w, right = -1, top = h, bottom = -1
  for (let y = 100; y < h; y++) {
    let run = 0
    for (let x = 0; x <= w; x++) {
      const bright = x < w && isBright(data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2])
      if (bright) {
        run++
      } else {
        if (run >= 150) {
          if (y < top) top = y
          bottom = y
          if (x - run < left) left = x - run
          if (x - 1 > right) right = x - 1
        }
        run = 0
      }
    }
  }
  return { left, right, top, bottom }
}

/** Red network-mark bounding box inside a strip (ink, not bitmap). */
async function netBoxByScan(
  buf: Buffer,
  y0: number,
  y1: number,
  x0 = 0,
  x1 = LAND_W,
): Promise<Box | null> {
  const { data, w, h } = await raw(buf)
  let left = w, right = -1, top = h, bottom = -1
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      if (isNetRed(data[(y * w + x) * 4])) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        bottom = y
      }
    }
  }
  return right < 0 ? null : { left, right, top, bottom }
}

async function redCount(
  buf: Buffer,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Promise<number> {
  const { data, w, h } = await raw(buf)
  let n = 0
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      if (isNetRed(data[(y * w + x) * 4])) n++
    }
  }
  return n
}

const boxCX = (b: Box): number => (b.left + b.right) / 2

describe("landscape corner network above the title", () => {
  it("rank corner + title: network centered on the title box, off the top-left", async () => {
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: await darkBackdrop(), logoFetch: await whiteLogo() }),
    )
    const title = await titleBoxByScan(buf)
    expect(title.top).toBeLessThan(LAND_H)
    const net = await netBoxByScan(buf, title.top - 110, title.top - 2)
    expect(net).not.toBeNull()
    // Title-box centering (formula-exact; a few px for the icon ink).
    expect(Math.abs(boxCX(net!) - boxCX(title))).toBeLessThanOrEqual(4)
    // …and nothing stacked at the top-left, where the old layout put it.
    expect(await redCount(buf, 0, 140, 85, 175)).toBeLessThan(100)
    // The mark bottom stays just above the title (landscape gap 5 + glyph AA).
    expect(title.top - net!.bottom).toBeGreaterThanOrEqual(2)
    expect(title.top - net!.bottom).toBeLessThanOrEqual(20)
  }, 60000)

  it("extra corner + title: same title-box centering (not rank-only)", async () => {
    const buf = await generatePosterBuffer(
      baseInput({
        posterBuf: await darkBackdrop(),
        logoFetch: await whiteLogo(),
        finalRank: null,
        queryExtra: "Nuova stagione S2",
      }),
    )
    const title = await titleBoxByScan(buf)
    expect(title.top).toBeLessThan(LAND_H)
    const net = await netBoxByScan(buf, title.top - 110, title.top - 2)
    expect(net).not.toBeNull()
    expect(Math.abs(boxCX(net!) - boxCX(title))).toBeLessThanOrEqual(4)
    expect(await redCount(buf, 0, 140, 85, 175)).toBeLessThan(100)
  }, 60000)

  it("Cinematic Left: centered on the left title box, not on the canvas", async () => {
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: await darkBackdrop(), logoFetch: await whiteLogo(), logoAlign: "left" }),
    )
    const title = await titleBoxByScan(buf)
    expect(title.top).toBeLessThan(LAND_H)
    // The title itself sits left…
    expect(boxCX(title)).toBeLessThan(LAND_W / 2 - 100)
    const net = await netBoxByScan(buf, title.top - 110, title.top - 2)
    expect(net).not.toBeNull()
    // …and the mark follows the title center, far from the canvas center.
    expect(Math.abs(boxCX(net!) - boxCX(title))).toBeLessThanOrEqual(4)
    expect(Math.abs(boxCX(net!) - LAND_W / 2)).toBeGreaterThan(100)
  }, 60000)

  it("shifted title (nonzero offsetX): the mark follows the title center", async () => {
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: await darkBackdrop(), logoFetch: await whiteLogo(), logoOffsetX: 60 }),
    )
    const title = await titleBoxByScan(buf)
    expect(title.top).toBeLessThan(LAND_H)
    const net = await netBoxByScan(buf, title.top - 110, title.top - 2)
    expect(net).not.toBeNull()
    expect(Math.abs(boxCX(net!) - boxCX(title))).toBeLessThanOrEqual(4)
  }, 60000)

  it("does not move the title (corner vs centered style)", async () => {
    const shared = { posterBuf: await darkBackdrop(), logoFetch: await whiteLogo(), queryExtra: "Top 10" }
    const corner = await generatePosterBuffer(baseInput({ ...shared, finalRank: null }))
    const centered = await generatePosterBuffer(
      baseInput({ ...shared, finalRank: null, rankingBadgeStyle: "pill" }),
    )
    const cornerBox = await titleBoxByScan(corner)
    const centeredBox = await titleBoxByScan(centered)
    expect(cornerBox).toEqual(centeredBox)
  }, 60000)

  it("falls back top-left without a title logo", async () => {
    const buf = await generatePosterBuffer(baseInput({ posterBuf: await darkBackdrop(), logoFetch: null }))
    // No title: the central band stays dark (network at the top-left).
    expect(await redCount(buf, LAND_W / 2 - 60, LAND_W / 2 + 60, 140, 300)).toBeLessThan(100)
    // …and the mark is stacked below the corner pill at the top-left.
    expect(await redCount(buf, 0, 140, 85, 175)).toBeGreaterThan(200)
  }, 60000)

  it("falls back top-left with hideLogo", async () => {
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: await darkBackdrop(), logoFetch: await whiteLogo(), hideLogo: true }),
    )
    expect(await redCount(buf, LAND_W / 2 - 60, LAND_W / 2 + 60, 140, 300)).toBeLessThan(100)
    expect(await redCount(buf, 0, 140, 85, 175)).toBeGreaterThan(200)
  }, 60000)

  it("leaves non-corner styles on the historic top-left anchor", async () => {
    const buf = await generatePosterBuffer(
      baseInput({
        posterBuf: await darkBackdrop(),
        logoFetch: await whiteLogo(),
        finalRank: null,
        queryExtra: "Top 10",
        rankingBadgeStyle: "pill",
      }),
    )
    expect(await redCount(buf, LAND_W / 2 - 60, LAND_W / 2 + 60, 140, 300)).toBeLessThan(100)
    // No corner pill, hence no stacking: the historic top-left anchor.
    expect(await redCount(buf, 0, 140, 10, 90)).toBeGreaterThan(200)
  }, 60000)

  it("keeps explicit netPos=top on the top anchor", async () => {
    const buf = await generatePosterBuffer(
      baseInput({
        posterBuf: await darkBackdrop(),
        logoFetch: await whiteLogo(),
        networkLogoPosition: "top",
      }),
    )
    expect(await redCount(buf, LAND_W / 2 - 60, LAND_W / 2 + 60, 140, 300)).toBeLessThan(100)
    expect(await redCount(buf, 0, 140, 85, 175)).toBeGreaterThan(200)
  }, 60000)
})
