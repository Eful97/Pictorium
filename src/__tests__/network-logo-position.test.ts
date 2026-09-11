/**
 * Posizione logo network: in alto a sinistra di default, centrato sopra il
 * logo film SOLO con nastro Netflix o Coming Soon.
 *
 * Senza nastro/Coming Soon e con logo film presente, la pill network va in
 * top-left (prima stava sempre centrata sopra il logo film).
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
})
