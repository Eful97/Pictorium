/**
 * Ancore di network (`netPos` tl/tr) e qualità (`qualityAnchor`) nel renderer
 * Standard: lato forzato, `auto` byte-identico, qualità impilata sotto il
 * network quando condividono l'angolo destro.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { NetworkLogoPosition } from "@/lib/types"
import type { QualityAnchor } from "@/lib/badge-anchor"
import type { BadgeGeometryReport } from "@/lib/badge-layout"

async function darkPoster(): Promise<Buffer> {
  return sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
}

interface Opts { quality?: string | null; network?: boolean; netPos?: NetworkLogoPosition; qualityAnchor?: QualityAnchor }

async function render(o: Opts, geoOut?: { geo: BadgeGeometryReport | null }): Promise<Buffer> {
  const network = o.network === true
  return generatePosterBuffer({
    posterBuf: await darkPoster(),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: false,
    genreName: null, voteAverage: null,
    badgeStyle: "shadow", rankingBadgeStyle: "default",
    badgeGenre: false, badgeYear: false, badgeRating: false,
    topLight: false, targetCenter: 0, ribbonSide: "left",
    logoScale: 75, logoOffsetX: 0, logoOffsetY: 0,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
    genreBadgeScale: 100, qualityBadgeScale: 100, separateBadgeScale: 100, networkLogoScale: 100,
    genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: null, animeRankResult: null, rankingResult: null, mapping: null,
    tmdbNetworks: network ? ["Netflix"] : [], productionCompanies: [], tmdbStudios: [],
    tvType: null, tvStatus: null, releaseDate: null, firstAirDate: null, lastAirDate: null, seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [], locale: "it", t: (k: string) => k,
    qLabel: null, queryExtra: null, qNetLogo: null,
    networkLogo: network, sd: { networkLogo: network } satisfies ServerDefaults,
    accentOverride: null, imdbTop250: false, preRelease: false,
    quality: o.quality ?? null,
    ...(o.netPos !== undefined ? { networkLogoPosition: o.netPos } : {}),
    ...(o.qualityAnchor !== undefined ? { qualityAnchor: o.qualityAnchor } : {}),
    onBadgeGeometry: (g: BadgeGeometryReport) => { if (geoOut) geoOut.geo = g },
  })
}

type Rect = { top: number; left: number; w: number; h: number }
function geoRect(g: BadgeGeometryReport | null, key: "quality" | "network"): Rect {
  const b = (g?.families as Record<string, Rect | undefined> | undefined)?.[key]
  if (!b) throw new Error(`no ${key} geometry`)
  return { top: b.top, left: b.left, w: b.w, h: b.h }
}

async function raw(buf: Buffer) {
  return sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

/** Pixel che differiscono tra due render nella regione (= massa del badge aggiunto). */
async function diffMass(a: Buffer, b: Buffer, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  const [ra, rb] = await Promise.all([raw(a), raw(b)])
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * ra.info.width + x) * 4
    if (Math.abs(ra.data[i] - rb.data[i]) + Math.abs(ra.data[i + 1] - rb.data[i + 1]) + Math.abs(ra.data[i + 2] - rb.data[i + 2]) > 60) n++
  }
  return n
}

async function brightCount(buf: Buffer, x0: number, y0: number, x1: number, y1: number): Promise<number> {
  const { data, info } = await raw(buf)
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * info.width + x) * 4] > 150) n++
  return n
}

const W = STD_W
const LEFT = [0, 0, W / 2, 200] as const
const RIGHT = [W / 2, 0, W, 200] as const

describe("quality anchor (Standard render)", () => {
  it("auto e assente sono byte-identici; senza ancora il badge sta a destra", async () => {
    const [absent, auto, none] = await Promise.all([render({ quality: "4K" }), render({ quality: "4K", qualityAnchor: "auto" }), render({ quality: null })])
    expect(Buffer.compare(absent, auto)).toBe(0)
    expect(await diffMass(absent, none, ...RIGHT)).toBeGreaterThan(300)
    expect(await diffMass(absent, none, ...LEFT)).toBeLessThan(30)
  })

  it("tl: la qualità va a sinistra; tr: resta a destra", async () => {
    const [tl, tr, none] = await Promise.all([render({ quality: "4K", qualityAnchor: "tl" }), render({ quality: "4K", qualityAnchor: "tr" }), render({ quality: null })])
    expect(await diffMass(tl, none, ...LEFT)).toBeGreaterThan(300)
    expect(await diffMass(tl, none, ...RIGHT)).toBeLessThan(30)
    expect(await diffMass(tr, none, ...RIGHT)).toBeGreaterThan(300)
    expect(await diffMass(tr, none, ...LEFT)).toBeLessThan(30)
  })
})

describe("network position tl/tr (Standard render)", () => {
  it("auto e assente sono byte-identici; top-left di default", async () => {
    const [absent, auto] = await Promise.all([render({ network: true }), render({ network: true, netPos: "auto" })])
    expect(Buffer.compare(absent, auto)).toBe(0)
    expect(await brightCount(absent, ...LEFT)).toBeGreaterThan(300)
  })

  it("tr: il network va in alto a destra; tl: a sinistra", async () => {
    const [tr, tl] = await Promise.all([render({ network: true, netPos: "tr" }), render({ network: true, netPos: "tl" })])
    expect(await brightCount(tr, ...RIGHT)).toBeGreaterThan(300)
    expect(await brightCount(tr, ...LEFT)).toBeLessThan(50)
    expect(await brightCount(tl, ...LEFT)).toBeGreaterThan(300)
    expect(await brightCount(tl, ...RIGHT)).toBeLessThan(50)
  })

  // Ancore manuali entrambe (netPos tr + qanc tr): posizione fissa, nessuno
  // stacking della qualità sotto il network; la sovrapposizione è accettata.
  it("network tr + qualità tr (manuali): nessuno stacking, ognuno resta nel suo angolo", async () => {
    const bothGeo: { geo: BadgeGeometryReport | null } = { geo: null }
    const netGeo: { geo: BadgeGeometryReport | null } = { geo: null }
    const qGeo: { geo: BadgeGeometryReport | null } = { geo: null }
    const both = await render({ network: true, netPos: "tr", quality: "4K", qualityAnchor: "tr" }, bothGeo)
    await render({ network: true, netPos: "tr" }, netGeo)
    await render({ quality: "4K", qualityAnchor: "tr" }, qGeo)
    // Qualità: stessa posizione d'angolo di quando è sola (non scende sotto il network)...
    expect(geoRect(bothGeo.geo, "quality")).toEqual(geoRect(qGeo.geo, "quality"))
    // ...e il network non si sposta per la qualità.
    expect(geoRect(bothGeo.geo, "network")).toEqual(geoRect(netGeo.geo, "network"))
    expect(await diffMass(both, await render({ quality: null }), ...RIGHT)).toBeGreaterThan(300)
  })
})
