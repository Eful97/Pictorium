/**
 * Geometria di render delle posizioni estese (tc / ml / mc / br) per famiglia
 * (qualità, network, logo, rank). Misure dal report di geometria (box visibili),
 * tolleranza ±2px. Il Netflix ribbon resta byte-identico con tanc (non manuale).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import { LAND_W, LAND_H } from "@/lib/constants"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { BadgeGeometryReport } from "@/lib/badge-layout"

type Cfg = {
  landscape?: boolean
  network?: boolean
  quality?: string | null
  rankStyle?: string
  ribbonSide?: "left" | "right"
  rank?: boolean
  netPos?: string
  qanc?: string
  lanc?: string
  tanc?: string
  logo?: { w: number; h: number }
  genre?: boolean
  genreTop?: boolean
  ratings?: boolean
  separate?: boolean
  banc?: string
}

type Rect = { top: number; left: number; w: number; h: number }

type NetRect = { top: number; left: number; w: number; h: number } | null

async function render(c: Cfg): Promise<{ buf: Buffer; geo: BadgeGeometryReport; net: NetRect }> {
  let net: NetRect = null
  const W = c.landscape ? LAND_W : STD_W
  const H = c.landscape ? LAND_H : STD_H
  const posterBuf = await sharp({ create: { width: W, height: H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  const logoFetch = c.logo
    ? await sharp({ create: { width: c.logo.w, height: c.logo.h, channels: 4, background: "#ffffff" } }).png().toBuffer()
    : null
  const network = c.network === true
  let geo = {} as BadgeGeometryReport
  const buf = await generatePosterBuffer({
    posterBuf, logoFetch, backdropFetch: null, shape: c.landscape ? "landscape" : "poster",
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: c.rank !== false,
    genreName: c.genre ? "Dramma" : null, voteAverage: c.genre ? 8.1 : null,
    badgeStyle: "shadow", rankingBadgeStyle: (c.rankStyle ?? "default") as never,
    badgeGenre: c.genre === true, badgeYear: false, badgeRating: c.genre === true,
    topLight: false, targetCenter: 0, ribbonSide: c.ribbonSide ?? "left",
    logoScale: 75, logoOffsetX: 0, logoOffsetY: 0,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
    genreBadgeScale: 100, qualityBadgeScale: 100, separateBadgeScale: 100, networkLogoScale: 100,
    genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    mediaType: "movie",
    finalRank: c.rank === false ? null : 5, animeRankResult: null, rankingResult: null, mapping: null,
    tmdbNetworks: network ? ["Netflix"] : [], productionCompanies: [], tmdbStudios: [],
    tvType: null, tvStatus: null, releaseDate: null, firstAirDate: null, lastAirDate: null, seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [], locale: "it", t: (k: string) => k,
    qLabel: null, queryExtra: null, qNetLogo: null,
    networkLogo: network, sd: { networkLogo: network } satisfies ServerDefaults,
    accentOverride: null, imdbTop250: false, preRelease: false,
    quality: c.quality ?? null,
    onBadgeGeometry: (g: BadgeGeometryReport) => { geo = g },
    onNetworkGeometry: (n: NetRect) => { net = n },
    ...(c.genreTop ? { genreTopWhenFree: true } : {}),
    ...(c.ratings ? { ratings: [{ id: "critics", name: "Critics", value: 7.2, format: "decimal" }] } : {}),
    ...(c.separate ? { separateRatings: [{ id: "imdb", value: 7.5 }, { id: "rt", value: 82 }] } : {}),
    ...(c.banc !== undefined ? { bottomAnchor: c.banc } : {}),
    ...(c.netPos !== undefined ? { networkLogoPosition: c.netPos } : {}),
    ...(c.qanc !== undefined ? { qualityAnchor: c.qanc } : {}),
    ...(c.lanc !== undefined ? { logoAnchor: c.lanc } : {}),
    ...(c.tanc !== undefined ? { topBadgeAnchor: c.tanc } : {}),
  } as Parameters<typeof generatePosterBuffer>[0])
  return { buf, geo, net }
}

function rectOf(r: { geo: BadgeGeometryReport }, key: "rank" | "quality" | "network" | "logo" | "genre" | "separate"): Rect {
  const b = (r.geo.families as Record<string, Rect | undefined>)[key]
  if (!b) throw new Error(`no ${key} geometry`)
  return { top: b.top, left: b.left, w: b.w, h: b.h }
}
const cx = (x: Rect) => x.left + x.w / 2
const cy = (x: Rect) => x.top + x.h / 2
const right = (x: Rect) => x.left + x.w
const bottom = (x: Rect) => x.top + x.h
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(2)

describe("posizioni estese: qualità (qanc)", () => {
  it("tc: centrata in orizzontale, in alto come la riga t", async () => {
    const r = await render({ quality: "4K", qanc: "tc" })
    const q = rectOf(r, "quality")
    near(cx(q), STD_W / 2)
    expect(q.top).toBeLessThan(STD_H / 4)
  })

  it("ml: centrata in verticale, a sinistra", async () => {
    const r = await render({ quality: "4K", qanc: "ml" })
    const q = rectOf(r, "quality")
    near(cy(q), STD_H / 2)
    near(q.left, 24)
  })

  it("mc: centrata su entrambi gli assi (portrait e landscape)", async () => {
    const p = rectOf(await render({ quality: "4K", qanc: "mc" }), "quality")
    near(cx(p), STD_W / 2)
    near(cy(p), STD_H / 2)
    const l = rectOf(await render({ quality: "4K", qanc: "mc", landscape: true }), "quality")
    near(cx(l), LAND_W / 2)
    near(cy(l), LAND_H / 2)
  })

  it("br: ancorata in basso a destra con margine laterale netPadX", async () => {
    const q = rectOf(await render({ quality: "4K", qanc: "br" }), "quality")
    near(right(q), STD_W - 24)
    expect(bottom(q)).toBeGreaterThan(STD_H * 0.9)
  })
})

describe("posizioni estese: network (netPos)", () => {
  it("tc e mr: centro orizzontale / centro verticale", async () => {
    const tc = rectOf(await render({ network: true, netPos: "tc" }), "network")
    near(cx(tc), STD_W / 2)
    const mr = rectOf(await render({ network: true, netPos: "mr" }), "network")
    near(cy(mr), STD_H / 2)
    near(right(mr), STD_W - 24)
  })

  it("mc: centrata su entrambi gli assi", async () => {
    const n = rectOf(await render({ network: true, netPos: "mc" }), "network")
    near(cx(n), STD_W / 2)
    near(cy(n), STD_H / 2)
  })
})

describe("posizioni estese: logo (lanc)", () => {
  const LOGO = { w: 420, h: 200 }
  it("mc: logo centrato su entrambi gli assi", async () => {
    const l = rectOf(await render({ logo: LOGO, lanc: "mc" }), "logo")
    near(cx(l), STD_W / 2)
    near(cy(l), STD_H / 2)
  })

  it("tc: logo centrato in orizzontale in alto", async () => {
    const l = rectOf(await render({ logo: LOGO, lanc: "tc" }), "logo")
    near(cx(l), STD_W / 2)
    expect(l.top).toBeLessThan(STD_H / 4)
  })

  it("br: logo nell'angolo basso destro, margine logoAlignPadX (23 a 500px)", async () => {
    const l = rectOf(await render({ logo: LOGO, lanc: "br" }), "logo")
    near(right(l), STD_W - 23)
    expect(bottom(l)).toBeGreaterThan(STD_H * 0.8)
  })

  it("ml: logo centrato verticalmente a sinistra", async () => {
    const l = rectOf(await render({ logo: LOGO, lanc: "ml" }), "logo")
    near(cy(l), STD_H / 2)
    near(l.left, 23)
  })
})

describe("posizioni estese: rank (tanc)", () => {
  it("tc: il rank resta centrato (tc è la posizione centrale fissa)", async () => {
    const rk = rectOf(await render({ rank: true, tanc: "tc" }), "rank")
    near(cx(rk), STD_W / 2)
  })

  it("ml con pill: a sinistra e centrato in verticale", async () => {
    const rk = rectOf(await render({ rank: true, rankStyle: "pill", tanc: "ml" }), "rank")
    near(rk.left, 24)
    near(cy(rk), STD_H / 2)
  })

  it("nastro Netflix ignora tanc: bitmap identico ad auto", async () => {
    const [auto, fixed] = await Promise.all([
      render({ rank: true, rankStyle: "netflix", ribbonSide: "left" }),
      render({ rank: true, rankStyle: "netflix", ribbonSide: "left", tanc: "bc" }),
    ])
    expect(Buffer.compare(auto.buf, fixed.buf)).toBe(0)
  })

  it("corner con tanc=bc si sposta in basso (il rank non cede)", async () => {
    const rk = rectOf(await render({ rank: true, rankStyle: "corner", tanc: "bc" }), "rank")
    expect(bottom(rk)).toBeGreaterThan(STD_H * 0.9)
    near(cx(rk), STD_W / 2)
  })
})

describe("landscape (768x432): posizioni estese, geometria ±2px", () => {
  const LOGO = { w: 420, h: 200 }
  it("logo tc: centrato in orizzontale in alto", async () => {
    const l = rectOf(await render({ landscape: true, logo: LOGO, lanc: "tc" }), "logo")
    near(cx(l), LAND_W / 2)
    expect(l.top).toBeLessThan(LAND_H / 4)
  })
  it("logo ml: centrato in verticale a sinistra (margine logoAlignPadX = 36)", async () => {
    const l = rectOf(await render({ landscape: true, logo: LOGO, lanc: "ml" }), "logo")
    near(cy(l), LAND_H / 2)
    near(l.left, 36)
  })
  it("logo br: angolo basso destro, margine 36", async () => {
    const l = rectOf(await render({ landscape: true, logo: LOGO, lanc: "br" }), "logo")
    near(right(l), LAND_W - 36)
    expect(bottom(l)).toBeGreaterThan(LAND_H * 0.8)
  })
  it("network tc: centro orizzontale", async () => {
    const n = rectOf(await render({ landscape: true, network: true, netPos: "tc" }), "network")
    near(cx(n), LAND_W / 2)
  })
  it("network mr: centro verticale, margine destro 36", async () => {
    const n = rectOf(await render({ landscape: true, network: true, netPos: "mr" }), "network")
    near(cy(n), LAND_H / 2)
    near(right(n), LAND_W - 36)
  })
})

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.w && a.left + a.w > b.left && a.top < b.top + b.h && a.top + a.h > b.top

describe("auto evita manuali (known gaps + report sincronizzato)", () => {
  it("gap 1: network auto NON si sovrappone a qanc=tl", async () => {
    const r = await render({ quality: "4K", qanc: "tl", network: true })
    expect(overlaps(rectOf(r, "network"), rectOf(r, "quality"))).toBe(false)
  })

  it("gap 2: genere in alto auto NON si sovrappone a qanc=tr", async () => {
    const r = await render({ quality: "4K", qanc: "tr", genre: true, genreTop: true, rank: false })
    expect(overlaps(rectOf(r, "genre"), rectOf(r, "quality"))).toBe(false)
  })

  it("report == posizione finale: il callback network coincide col report geometria", async () => {
    const r = await render({ quality: "4K", qanc: "tl", network: true })
    expect(r.net).not.toBeNull()
    const rep = rectOf(r, "network")
    expect({ top: r.net!.top, left: r.net!.left, w: r.net!.w, h: r.net!.h }).toEqual(rep)
  })
})

describe("colonna rating separati segue la qualità (A)", () => {
  it("qanc=tr: colonna sotto la qualità, centrata sul suo asse", async () => {
    const r = await render({ quality: "4K", qanc: "tr", separate: true })
    const q = rectOf(r, "quality"), sp = rectOf(r, "separate")
    near(cx(sp), cx(q))
    expect(sp.top).toBeGreaterThanOrEqual(bottom(q) - 2)
  })
  it("qanc=mr: colonna sotto il box qualità centrale", async () => {
    const r = await render({ quality: "4K", qanc: "mr", separate: true })
    const q = rectOf(r, "quality"), sp = rectOf(r, "separate")
    near(cx(sp), cx(q))
    expect(sp.top).toBeGreaterThanOrEqual(bottom(q) - 2)
  })
  it("qanc=bc (riga bassa): colonna SOPRA la qualità", async () => {
    const r = await render({ quality: "4K", qanc: "bc", separate: true })
    const q = rectOf(r, "quality"), sp = rectOf(r, "separate")
    near(cx(sp), cx(q))
    expect(bottom(sp)).toBeLessThanOrEqual(q.top + 2)
  })
})

// Box dei pixel che differiscono tra due render: la riga rating non ha report
// geometria, quindi si misura sulla differenza rispetto allo stesso poster senza righe.
async function diffBox(a: Buffer, b: Buffer, yMin: number, yMax: number): Promise<Rect> {
  const A = await sharp(a).raw().toBuffer({ resolveWithObject: true })
  const B = await sharp(b).raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = A.info
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = Math.max(0, yMin); y < Math.min(h, yMax); y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * ch
    if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 24) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
  }
  if (x1 < 0) throw new Error("nessuna differenza: riga rating assente")
  return { left: x0, top: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

describe("riga rating personalizzata segue banc su entrambi gli assi (B)", () => {
  it("banc=tc: genere in alto centrato; riga rating SOTTO il genere", async () => {
    const withR = await render({ genre: true, banc: "tc", ratings: true, rank: false })
    const noR = await render({ genre: true, banc: "tc", rank: false })
    const g = rectOf(withR, "genre")
    near(cx(g), STD_W / 2)
    near(g.top, Math.round(18 * STD_H / 570))
    // Solo sotto il genere: nessun pixel della riga tra il genere e bottom+10 (la
    // riga parte a genere.bottom + 10; la parte alta del bitmap è trasparente).
    const rr = await diffBox(withR.buf, noR.buf, bottom(g) + 1, STD_H)
    expect(rr.top).toBeGreaterThanOrEqual(bottom(g) + 8)
    expect(rr.top).toBeLessThanOrEqual(bottom(g) + 10 + 66)
  })

  it("banc=ml: genere a metà altezza; riga rating SOPRA il genere", async () => {
    const withR = await render({ genre: true, banc: "ml", ratings: true, rank: false })
    const noR = await render({ genre: true, banc: "ml", rank: false })
    const g = rectOf(withR, "genre")
    near(cy(g), STD_H / 2)
    expect(g.left).toBeLessThan(STD_W / 4)
    // Solo sopra il genere: la riga rating sta a genere.top - h - 10 (bordo basso ~ genere.top - 10).
    const rr = await diffBox(withR.buf, noR.buf, 0, g.top - 1)
    expect(bottom(rr)).toBeLessThanOrEqual(g.top - 2)
    // Inchiostro sopra il genere; il bordo basso del bitmap è trasparente (pad ombra).
    expect(bottom(rr)).toBeGreaterThanOrEqual(g.top - 30)
  })

  it("landscape banc=tr: genere sulla griglia alta, a destra", async () => {
    const r = await render({ landscape: true, genre: true, banc: "tr", rank: false })
    const g = rectOf(r, "genre")
    near(g.top, Math.round(18 * LAND_H / 570))
    expect(right(g)).toBeGreaterThan(LAND_W * 0.8)
  })
})
