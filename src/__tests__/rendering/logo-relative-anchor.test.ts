/**
 * Posizioni relative al logo (`above` / `below`) per netPos, qanc, banc, tanc.
 *
 * Geometria dal report (box visibili): il network/la qualità sopra o sotto il
 * logo finale, centrati sul suo centro, con gap = round(8*CH/570); stacking per
 * lato nell'ordine fisso (fascia, qualità, network, rank); clamp nel canvas;
 * senza logo reso = auto (byte-identico).
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { BadgeGeometryReport } from "@/lib/badge-layout"

type Cfg = {
  network?: boolean
  quality?: string | null
  rank?: boolean
  genre?: boolean
  netPos?: string
  qanc?: string
  banc?: string
  tanc?: string
  lanc?: string
  logo?: { w: number; h: number } | null
  bov?: string
}
type Rect = { top: number; left: number; w: number; h: number }

async function render(c: Cfg): Promise<{ buf: Buffer; geo: BadgeGeometryReport }> {
  let geo = {} as BadgeGeometryReport
  const posterBuf = await sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  const logo = c.logo === null ? null : (c.logo ?? { w: 300, h: 120 })
  const logoFetch = logo
    ? await sharp({ create: { width: logo.w, height: logo.h, channels: 4, background: "#ffffff" } }).png().toBuffer()
    : null
  const network = c.network === true
  const buf = await generatePosterBuffer({
    posterBuf, logoFetch, backdropFetch: null, shape: "poster",
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: c.rank !== false,
    genreName: c.genre ? "Dramma" : null, voteAverage: c.genre ? 8.1 : null,
    badgeStyle: "shadow", rankingBadgeStyle: "default" as never,
    badgeGenre: c.genre === true, badgeYear: false, badgeRating: c.genre === true,
    topLight: false, targetCenter: 0, ribbonSide: "left",
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
    wikidataResult: { awards: [], nominations: [], studios: [], director: null },
    tmdbKeywords: [], locale: "it", t: (k: string) => k,
    qLabel: null, queryExtra: null, qNetLogo: null,
    networkLogo: network, sd: { networkLogo: network },
    accentOverride: null, imdbTop250: false, preRelease: false,
    quality: c.quality ?? null,
    onBadgeGeometry: (g: BadgeGeometryReport) => { geo = g },
    ...(c.banc !== undefined ? { bottomAnchor: c.banc } : {}),
    ...(c.netPos !== undefined ? { networkLogoPosition: c.netPos } : {}),
    ...(c.qanc !== undefined ? { qualityAnchor: c.qanc } : {}),
    ...(c.lanc !== undefined ? { logoAnchor: c.lanc } : {}),
    ...(c.tanc !== undefined ? { topBadgeAnchor: c.tanc } : {}),
    ...(c.bov !== undefined ? { badgeOverflow: c.bov } : {}),
  } as Parameters<typeof generatePosterBuffer>[0])
  return { buf, geo }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")
function rectOf(geo: BadgeGeometryReport, key: "rank" | "quality" | "network" | "logo" | "genre" | "separate"): Rect {
  const b = (geo.families as Record<string, Rect | undefined>)[key]
  if (!b) throw new Error(`no ${key} geometry`)
  return { top: b.top, left: b.left, w: b.w, h: b.h }
}
const cx = (x: Rect) => x.left + x.w / 2
const bottom = (x: Rect) => x.top + x.h
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(2)
const GAP = Math.round(8 * STD_H / 570)
const MARGIN_X = Math.round(18 * STD_W / 380)
const MARGIN_Y = Math.round(18 * STD_H / 570)

describe("netPos above / below", () => {
  it("above: network sopra il logo, bottom = logo.top - gap, centrato sul logo", async () => {
    const { geo } = await render({ network: true, netPos: "above" })
    const logo = rectOf(geo, "logo")
    const net = rectOf(geo, "network")
    near(bottom(net), logo.top - GAP)
    near(cx(net), cx(logo))
  })

  it("below: network sotto il logo, top = logo.bottom + gap, centrato sul logo", async () => {
    const { geo } = await render({ network: true, netPos: "below", lanc: "tc" })
    const logo = rectOf(geo, "logo")
    const net = rectOf(geo, "network")
    near(net.top, bottom(logo) + GAP)
    near(cx(net), cx(logo))
  })

  it("below senza spazio sotto il logo (logo in basso): passa sopra il logo, mai sovrapposto", async () => {
    const { geo } = await render({ network: true, netPos: "below", lanc: "bc" })
    const logo = rectOf(geo, "logo")
    const net = rectOf(geo, "network")
    expect(bottom(net)).toBeLessThanOrEqual(logo.top)
    near(bottom(net), logo.top - GAP)
  })

  it("above senza logo = auto (byte-identico)", async () => {
    const a = await render({ network: true, netPos: "above", logo: null })
    const b = await render({ network: true, logo: null })
    expect(sha(a.buf)).toBe(sha(b.buf))
  })
})

describe("qanc above / below", () => {
  it("below: qualità sotto il logo, centrata sul logo", async () => {
    const { geo } = await render({ quality: "4K", qanc: "below", lanc: "tc" })
    const logo = rectOf(geo, "logo")
    const q = rectOf(geo, "quality")
    near(q.top, bottom(logo) + GAP)
    near(cx(q), cx(logo))
  })
})

describe("impilamento sullo stesso lato (ordine fisso: qualità prima del network)", () => {
  it("qanc above + netPos above: qualità a ridosso del logo, network oltre", async () => {
    const { geo } = await render({ network: true, quality: "4K", qanc: "above", netPos: "above" })
    const logo = rectOf(geo, "logo")
    const q = rectOf(geo, "quality")
    const net = rectOf(geo, "network")
    near(bottom(q), logo.top - GAP)
    near(bottom(net), q.top - GAP)
  })
})

describe("clamp nel canvas", () => {
  it("logo in alto a sinistra: niente spazio sopra, il badge passa sotto il logo (mai sovrapposto)", async () => {
    const { geo } = await render({ network: true, netPos: "above", lanc: "tl" })
    const net = rectOf(geo, "network")
    const logo = rectOf(geo, "logo")
    near(net.top, bottom(logo) + GAP)
    expect(net.left).toBeGreaterThanOrEqual(MARGIN_X - 2)
  })
})

describe("posizioni fisse restano fisse (rank non spostato da relative network)", () => {
  it("tanc manuale tc + netPos above: il rank non cambia posizione", async () => {
    const withNet = await render({ network: true, rank: true, tanc: "tc", netPos: "above" })
    const withoutNet = await render({ rank: true, tanc: "tc" })
    const r1 = rectOf(withNet.geo, "rank")
    const r2 = rectOf(withoutNet.geo, "rank")
    expect(r1).toEqual(r2)
  })
})
