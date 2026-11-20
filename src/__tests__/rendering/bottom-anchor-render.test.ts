/**
 * Ancora della fascia inferiore (genere + riga rating bottom) nel renderer
 * Standard: `auto`/assente byte-identici, cambia solo l'asse X, `bc` coincide
 * con l'auto portrait, la barra portrait full-width ignora l'ancora.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { BottomAnchor } from "@/lib/badge-anchor"

async function darkPoster(): Promise<Buffer> {
  return sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
}

interface Opts { genre?: boolean; style?: string; bottomRow?: boolean; bottomAnchor?: BottomAnchor }

async function render(o: Opts): Promise<Buffer> {
  return generatePosterBuffer({
    posterBuf: await darkPoster(), logoFetch: null, backdropFetch: null,
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: false,
    genreName: o.genre ? "Dramma" : null, voteAverage: o.genre ? 8.1 : null,
    badgeStyle: (o.style ?? "shadow") as never, rankingBadgeStyle: "default",
    badgeGenre: o.genre === true, badgeYear: false, badgeRating: o.genre === true,
    topLight: false, targetCenter: 0, ribbonSide: "left",
    logoScale: 75, logoOffsetX: 0, logoOffsetY: 0,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
    genreBadgeScale: 100, qualityBadgeScale: 100, separateBadgeScale: 100, networkLogoScale: 100,
    genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    mediaType: "movie", finalRank: null, animeRankResult: null, rankingResult: null, mapping: null,
    tmdbNetworks: [], productionCompanies: [], tmdbStudios: [],
    tvType: null, tvStatus: null, releaseDate: null, firstAirDate: null, lastAirDate: null, seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [], locale: "it", t: (k: string) => k,
    qLabel: null, queryExtra: null, qNetLogo: null,
    networkLogo: false, sd: { networkLogo: false },
    accentOverride: null, imdbTop250: false, preRelease: false,
    ...(o.bottomRow ? { separateRatings: [{ id: "imdb", value: 8.1 }, { id: "tmdb", value: 7.4 }], separateRatingsStyle: "bottom-pills" } : {}),
    ...(o.bottomAnchor !== undefined ? { bottomAnchor: o.bottomAnchor } : {}),
  } as never)
}

async function raw(buf: Buffer) { return sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) }
async function diffMass(a: Buffer, b: Buffer, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  const [ra, rb] = await Promise.all([raw(a), raw(b)])
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * ra.info.width + x) * 4
    if (Math.abs(ra.data[i] - rb.data[i]) + Math.abs(ra.data[i + 1] - rb.data[i + 1]) + Math.abs(ra.data[i + 2] - rb.data[i + 2]) > 60) n++
  }
  return n
}

const W = STD_W
const H = STD_H
const BAND = (x0: number, x1: number) => [x0, H - 90, x1, H] as const
const L = BAND(0, W * 0.34), C = BAND(W * 0.34, W * 0.66), R = BAND(W * 0.66, W)

describe("bottom anchor: genere (pill)", () => {
  it("auto/assente byte-identici; bc coincide con l'auto portrait", async () => {
    const [absent, auto, bc] = await Promise.all([render({ genre: true }), render({ genre: true, bottomAnchor: "auto" }), render({ genre: true, bottomAnchor: "bc" })])
    expect(Buffer.compare(absent, auto)).toBe(0)
    expect(Buffer.compare(absent, bc)).toBe(0)
  })

  it("bl/br spostano il genere a sinistra/destra senza cambiare quota", async () => {
    const [none, auto, bl, br] = await Promise.all([render({}), render({ genre: true }), render({ genre: true, bottomAnchor: "bl" }), render({ genre: true, bottomAnchor: "br" })])
    expect(await diffMass(auto, none, ...C)).toBeGreaterThan(300)
    expect(await diffMass(bl, none, ...L)).toBeGreaterThan(300)
    expect(await diffMass(bl, none, ...R)).toBeLessThan(30)
    expect(await diffMass(br, none, ...R)).toBeGreaterThan(300)
    expect(await diffMass(br, none, ...L)).toBeLessThan(30)
  })
})

describe("bottom anchor: riga rating separati bottom", () => {
  it("auto/assente byte-identici; bl/br spostano la riga", async () => {
    const [absent, auto, none, bl, br] = await Promise.all([
      render({ bottomRow: true }), render({ bottomRow: true, bottomAnchor: "auto" }), render({}),
      render({ bottomRow: true, bottomAnchor: "bl" }), render({ bottomRow: true, bottomAnchor: "br" }),
    ])
    expect(Buffer.compare(absent, auto)).toBe(0)
    expect(await diffMass(bl, none, ...L)).toBeGreaterThan(300)
    expect(await diffMass(bl, none, ...R)).toBeLessThan(30)
    expect(await diffMass(br, none, ...R)).toBeGreaterThan(300)
    expect(await diffMass(br, none, ...L)).toBeLessThan(30)
  })
})

describe("bottom anchor: barra portrait", () => {
  it("la barra full-width ignora l'ancora (X non libera)", async () => {
    const [auto, bl] = await Promise.all([render({ genre: true, style: "bar" }), render({ genre: true, style: "bar", bottomAnchor: "bl" })])
    expect(Buffer.compare(auto, bl)).toBe(0)
  })
})
