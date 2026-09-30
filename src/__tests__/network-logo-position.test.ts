/**
 * Posizione logo network: centrato sopra il logo film quando c'è un badge
 * alto (nastro Netflix, badge centrale rank/extra, o Coming Soon); in alto
 * a sinistra SOLO senza alcun badge alto.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
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

async function whiteLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 220, height: 80, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer()
}

describe("network logo position", () => {
  it("sits top-left when a film logo is present but no Netflix ribbon or Coming Soon", async () => {
    const buf = await generatePosterBuffer({
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
    })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // Pill network (sfondo chiaro) in alto a sinistra: conta i pixel chiari
    // nella zona top-left. Col comportamento vecchio la pill stava centrata
    // sopra il logo film (in basso) e questa zona restava poster scuro.
    let brightTopLeft = 0
    for (let y = 18; y < 80; y++) {
      for (let x = 18; x < 150; x++) {
        if (data[(y * info.width + x) * 4] > 150) brightTopLeft++
      }
    }
    expect(brightTopLeft).toBeGreaterThan(300)
  })

  it("sits above the film logo (bottom) when a centered top badge is present", async () => {
    const buf = await generatePosterBuffer({
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
      rankingEnabled: true,
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
      queryExtra: "Top 10",
      qNetLogo: null,
      networkLogo: true,
      sd: { networkLogo: true } satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: false,
    })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // Stessa zona top-left del test sopra: col badge centrale il network
    // sta in basso sopra il logo film, quindi qui resta poster scuro.
    let brightTopLeft = 0
    for (let y = 18; y < 80; y++) {
      for (let x = 18; x < 150; x++) {
        if (data[(y * info.width + x) * 4] > 150) brightTopLeft++
      }
    }
    expect(brightTopLeft).toBeLessThan(100)
  })

  it("mirrors top-right below the ribbon in Stremio view (ribbonSide right)", async () => {
    const buf = await generatePosterBuffer({
      posterBuf: await darkPoster(),
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
      rankingEnabled: true,
      genreName: null,
      voteAverage: null,
      badgeStyle: "shadow",
      rankingBadgeStyle: "netflix",
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      topLight: false,
      targetCenter: 0,
      ribbonSide: "right",
      logoScale: 75,
      logoOffsetX: 0,
      logoOffsetY: 0,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      qualityBadgeScale: 100,
      networkLogoScale: 100,
      genreBadgeOffsetX: 0,
      genreBadgeOffsetY: 0,
      qualityBadgeOffsetX: 0,
      qualityBadgeOffsetY: 0,
      networkLogoOffsetX: 0,
      networkLogoOffsetY: 0,
      mediaType: "movie",
      finalRank: 3,
      animeRankResult: null,
      rankingResult: 3,
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
    })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const bright = (x0: number, x1: number, y0: number, y1: number) => {
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (data[(y * info.width + x) * 4] > 150) n++
        }
      }
      return n
    }
    // Angolo sinistro libero: il network ha specchiato a destra.
    expect(bright(18, 150, 18, 80)).toBeLessThan(100)
    // Stessa riga del nastro, alla sua sinistra (specchio Nuvio).
    expect(bright(300, 399, 10, 75)).toBeGreaterThan(300)
  })

  it("top mode ignores the above-logo branch (stays top-left, Nuvio)", async () => {
    const buf = await generatePosterBuffer({
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
      rankingEnabled: true,
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
      queryExtra: "Top 10",
      qNetLogo: null,
      networkLogo: true,
      networkLogoPosition: "top",
      sd: { networkLogo: true } satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: false,
    })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // Stesso setup del test "above the film logo", ma in modo "top" la pill
    // resta all'angolo (in auto starebbe centrata sopra il logo in basso).
    let brightTopLeft = 0
    for (let y = 18; y < 80; y++) {
      for (let x = 18; x < 150; x++) {
        if (data[(y * info.width + x) * 4] > 150) brightTopLeft++
      }
    }
    expect(brightTopLeft).toBeGreaterThan(300)
  })

  it("top mode follows the ribbon to the right (Stremio)", async () => {
    const buf = await generatePosterBuffer({
      posterBuf: await darkPoster(),
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
      rankingEnabled: true,
      genreName: null,
      voteAverage: null,
      badgeStyle: "shadow",
      rankingBadgeStyle: "netflix",
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      topLight: false,
      targetCenter: 0,
      ribbonSide: "right",
      logoScale: 75,
      logoOffsetX: 0,
      logoOffsetY: 0,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      qualityBadgeScale: 100,
      networkLogoScale: 100,
      genreBadgeOffsetX: 0,
      genreBadgeOffsetY: 0,
      qualityBadgeOffsetX: 0,
      qualityBadgeOffsetY: 0,
      networkLogoOffsetX: 0,
      networkLogoOffsetY: 0,
      mediaType: "movie",
      finalRank: 3,
      animeRankResult: null,
      rankingResult: 3,
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
      networkLogoPosition: "top",
      sd: { networkLogo: true } satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: false,
    })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const bright = (x0: number, x1: number, y0: number, y1: number) => {
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (data[(y * info.width + x) * 4] > 150) n++
        }
      }
      return n
    }
    // Modo "top" con nastro a destra: lato destro, a fianco del nastro
    // (stessa riga dello specchio Nuvio).
    expect(bright(18, 150, 18, 80)).toBeLessThan(100)
    expect(bright(300, 399, 10, 75)).toBeGreaterThan(300)
  })

  it("top mode stays left on Stremio side without a ribbon", async () => {
    const buf = await generatePosterBuffer({
      posterBuf: await darkPoster(),
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
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      topLight: false,
      targetCenter: 0,
      ribbonSide: "right",
      logoScale: 75,
      logoOffsetX: 0,
      logoOffsetY: 0,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      qualityBadgeScale: 100,
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
      networkLogoPosition: "top",
      sd: { networkLogo: true } satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: false,
    })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const bright = (x0: number, x1: number, y0: number, y1: number) => {
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (data[(y * info.width + x) * 4] > 150) n++
        }
      }
      return n
    }
    // Lato Stremio ma senza nastro: destra solo col nastro effettivo.
    expect(bright(18, 150, 18, 80)).toBeGreaterThan(300)
    expect(bright(330, 482, 18, 100)).toBeLessThan(100)
  })
})
