/**
 * Layout landscape: logo film baked-in coi vincoli del canvas 16:9 e badge
 * genere/rating in basso a destra — vale per preview, poster e landscapePoster
 * (unica verità visiva). `hideLogo` esplicito salta il logo anche in landscape
 * (veicolo del banner Nuvio pulito).
 *
 * Regressione pixel-level via generatePosterBuffer su canvas scuro: l'unica
 * cosa chiara (>200 su tutti i canali) è il testo dei badge + il logo bianco
 * finto — gradienti e scrim restano sotto soglia.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

async function darkBackdrop(): Promise<Buffer> {
  return sharp({
    create: { width: LAND_W, height: LAND_H, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
}

async function darkPoster(): Promise<Buffer> {
  return sharp({
    create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
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
    shape: "landscape",
    ...overrides,
  }
}

function isBright(r: number, g: number, b: number): boolean {
  return r > 200 && g > 200 && b > 200
}

/** Pixel chiari su tutta l'immagine. */
async function totalBrightCount(buf: Buffer): Promise<number> {
  const data = await sharp(buf).ensureAlpha().raw().toBuffer()
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (isBright(data[i], data[i + 1], data[i + 2])) n++
  }
  return n
}

/** Colonna chiara più a sinistra nella fascia bassa (zona badge genere). */
async function bottomLeftmostBrightX(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const stripTop = info.height - 160
  for (let x = 0; x < info.width; x++) {
    for (let y = stripTop; y < info.height; y++) {
      const i = (y * info.width + x) * 4
      if (isBright(data[i], data[i + 1], data[i + 2])) return x
    }
  }
  return info.width
}

describe("landscape layout", () => {
  it("bakes the film logo in landscape with the 16:9 constraints", async () => {
    const backdrop = await darkBackdrop()
    const poster = await darkPoster()
    const logo = await whiteLogo()
    // Badge spenti: l'unica cosa chiara può essere il logo bianco finto.
    const portrait = await generatePosterBuffer(
      baseInput({ posterBuf: poster, logoFetch: logo, badgesEnabled: false, shape: "poster" }),
    )
    const landscape = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, logoFetch: logo, badgesEnabled: false, shape: "landscape" }),
    )
    const portraitCount = await totalBrightCount(portrait)
    const landscapeCount = await totalBrightCount(landscape)
    expect(portraitCount).toBeGreaterThan(3000)
    // Logo 220x100 cap 40% larghezza / 24% altezza su 768x432: migliaia di px.
    expect(landscapeCount).toBeGreaterThan(3000)
  }, 60000)

  it("still honors explicit hideLogo in portrait", async () => {
    const poster = await darkPoster()
    const logo = await whiteLogo()
    const hidden = await generatePosterBuffer(
      baseInput({ posterBuf: poster, logoFetch: logo, badgesEnabled: false, shape: "poster", hideLogo: true }),
    )
    expect(await totalBrightCount(hidden)).toBeLessThan(1000)
  }, 60000)

  it("still honors explicit hideLogo in landscape (clean Nuvio banner)", async () => {
    const backdrop = await darkBackdrop()
    const logo = await whiteLogo()
    const hidden = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, logoFetch: logo, badgesEnabled: false, shape: "landscape", hideLogo: true }),
    )
    expect(await totalBrightCount(hidden)).toBeLessThan(1000)
  }, 60000)

  it("applies the invisible +10/-10 calibration in landscape with sliders at zero", async () => {
    // Gli slider mostrano 0 (null o esplicito: stesso render) ma il logo è
    // spostato di +10 X / -10 Y dalla calibrazione geometrica — bordo sinistro
    // atteso a ~46px (padX 36 + 10), non a 36.
    const backdrop = await darkBackdrop()
    const logo = await whiteLogo()
    const unset = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, logoFetch: logo, badgesEnabled: false, shape: "landscape", logoAlign: "left", logoOffsetX: null, logoOffsetY: null }),
    )
    const zero = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, logoFetch: logo, badgesEnabled: false, shape: "landscape", logoAlign: "left", logoOffsetX: 0, logoOffsetY: 0 }),
    )
    expect(zero.equals(unset)).toBe(true)
    expect(await bottomLeftmostBrightX(unset)).toBeGreaterThanOrEqual(44)
    expect(await bottomLeftmostBrightX(unset)).toBeLessThanOrEqual(48)
  }, 60000)

  it("anchors the genre badge bottom-right in landscape instead of centered", async () => {
    const backdrop = await darkBackdrop()
    const poster = await darkPoster()
    const centered = await generatePosterBuffer(baseInput({ posterBuf: poster, shape: "poster" }))
    const right = await generatePosterBuffer(baseInput({ posterBuf: backdrop, shape: "landscape" }))
    const centeredX = await bottomLeftmostBrightX(centered)
    const rightX = await bottomLeftmostBrightX(right)
    // Badge centrato (~768/2): inizia a sinistra del centro; ancorato a
    // destra (margine 36px): inizia oltre i 400px. Margini ampi anti-flaky.
    expect(centeredX).toBeLessThan(350)
    expect(rightX).toBeGreaterThan(400)
  }, 60000)

  it("keeps the genre visual center with separate ratings in landscape", async () => {
    // Con ★ la pill è più larga; senza (separati) l'ancoraggio destro la
    // sposterebbe a destra — la compensazione tiene il centro dov'era.
    // Due contenuti: corto (nessuno shrink) e lungo con anno (shrink overflow).
    const backdrop = await darkBackdrop()
    for (const extra of [
      {},
      { genreName: "Azione", releaseDate: "2024-01-15" },
    ]) {
      const full = await generatePosterBuffer(
        baseInput({ posterBuf: backdrop, shape: "landscape", voteAverage: 7.8, badgeRating: true, ...extra }),
      )
      const sep = await generatePosterBuffer(
        baseInput({
          posterBuf: backdrop,
          shape: "landscape",
          voteAverage: 7.8,
          badgeRating: false,
          separateRatings: [{ id: "imdb", value: 8.7 }],
          ...extra,
        }),
      )
      const centerX = async (buf: Buffer) => {
        const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        let x0 = info.width, x1 = 0
        for (let y = Math.floor(info.height * 0.8); y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            const i = (y * info.width + x) * 4
            if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) {
              if (x < x0) x0 = x
              if (x > x1) x1 = x
            }
          }
        }
        return (x0 + x1) / 2
      }
      // Misura dal render reale: tolleranza stretta ma non zero.
      expect(Math.abs((await centerX(sep)) - (await centerX(full)))).toBeLessThanOrEqual(12)
    }
  }, 60000)

  it("pulls bordo/vetro genre badges off the landscape corner (-30x/-15y)", async () => {
    // Senza la calibrazione stanno incollati al bordo (audit: bordo a x767/y431
    // su canvas 768x432). Misura full-canvas: nient'altro è chiaro nel render.
    const backdrop = await darkBackdrop()
    for (const badgeStyle of ["bordo", "vetro"] as const) {
      const buf = await generatePosterBuffer(
        baseInput({ posterBuf: backdrop, shape: "landscape", badgeStyle, voteAverage: 7.8, badgeRating: true }),
      )
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let x1 = 0, y1 = 0
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 120 || data[i + 1] > 120 || data[i + 2] > 120) {
            if (x > x1) x1 = x
            if (y > y1) y1 = y
          }
        }
      }
      expect(x1).toBeLessThanOrEqual(info.width - 20)
      expect(y1).toBeLessThanOrEqual(info.height - 10)
    }
  }, 60000)
})
