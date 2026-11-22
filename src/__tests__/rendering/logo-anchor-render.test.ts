/**
 * Ancora del logo titolo nel renderer Standard: `auto` (o assente) byte-identico;
 * `tl` porta il logo in alto a sinistra; un network che lo copre scende sotto il logo.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { LogoAnchor } from "@/lib/logo-layout"

async function darkPoster(): Promise<Buffer> {
  return sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
}

async function whiteLogo(): Promise<Buffer> {
  return sharp({ create: { width: 220, height: 80, channels: 4, background: "#ffffff" } }).png().toBuffer()
}

async function render(opts: { logoAnchor?: LogoAnchor; network?: boolean }): Promise<Buffer> {
  const network = opts.network === true
  return generatePosterBuffer({
    posterBuf: await darkPoster(),
    logoFetch: await whiteLogo(),
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
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    topLight: false,
    targetCenter: 0,
    ribbonSide: "left",
    logoScale: 75,
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
    finalRank: null,
    animeRankResult: null,
    rankingResult: null,
    mapping: null,
    tmdbNetworks: network ? ["Netflix"] : [],
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
    networkLogo: network,
    sd: { networkLogo: network } satisfies ServerDefaults,
    accentOverride: null,
    imdbTop250: false,
    preRelease: false,
    ...(opts.logoAnchor !== undefined ? { logoAnchor: opts.logoAnchor } : {}),
  })
}

async function brightCount(buf: Buffer, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * info.width + x) * 4] > 150) n++
  return n
}

describe("logo anchor (Standard render)", () => {
  it("auto e assente sono byte-identici", async () => {
    const [absent, auto] = await Promise.all([render({}), render({ logoAnchor: "auto" })])
    expect(Buffer.compare(absent, auto)).toBe(0)
  })

  it("tl: logo bianco in alto a sinistra, non più in basso", async () => {
    const [auto, tl] = await Promise.all([render({}), render({ logoAnchor: "tl" })])
    // Zona alto-sinistra (logo 375x136 con margine ~23px): piena col logo, vuota senza.
    expect(await brightCount(tl, 30, 30, 120, 120)).toBeGreaterThan(5000)
    expect(await brightCount(auto, 30, 30, 120, 120)).toBeLessThan(50)
    // Zona dove l'auto mette il logo (basso-centro): vuota con tl.
    expect(await brightCount(tl, 150, 560, 350, 640)).toBeLessThan(50)
    expect(await brightCount(auto, 150, 560, 350, 640)).toBeGreaterThan(5000)
  })

  it("tr: logo bianco in alto a destra", async () => {
    const tr = await render({ logoAnchor: "tr" })
    expect(await brightCount(tr, 380, 30, 470, 120)).toBeGreaterThan(5000)
    expect(await brightCount(tr, 30, 30, 90, 120)).toBeLessThan(50)
  })

  it("bl: stessa quota verticale dell'auto, logo a sinistra", async () => {
    const bl = await render({ logoAnchor: "bl" })
    expect(await brightCount(bl, 30, 560, 120, 640)).toBeGreaterThan(3000)
    expect(await brightCount(bl, 400, 560, 470, 640)).toBeLessThan(50)
  })

  it("tl con network: la pill network scende SOTTO il logo e non lo copre", async () => {
    const tl = await render({ logoAnchor: "tl", network: true })
    const auto = await render({ network: true })
    // Il logo resta intatto nella sua zona (nessun pixel scuro "bucato" dal network).
    expect(await brightCount(tl, 30, 30, 120, 120)).toBeGreaterThan(5000)
    // Subito sotto il logo (bottom ≈ 23+136) compare la pill network chiara...
    expect(await brightCount(tl, 24, 166, 130, 230)).toBeGreaterThan(300)
    // ...mentre senza ancora quella zona è poster scuro (la pill sta in alto).
    expect(await brightCount(auto, 24, 166, 130, 230)).toBeLessThan(50)
  })
})
