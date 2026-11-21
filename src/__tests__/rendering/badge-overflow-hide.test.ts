/**
 * `badgeOverflow` (`bov`): "move" (default, byte-identico) vs "hide".
 *
 * In "hide" un badge AUTO che il layout sposterebbe o ridimensionerebbe per una
 * collisione non viene disegnato (layer, report geometria e network tolti). I
 * badge in posizione manuale e rank/extra non sono mai nascosti.
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
  lanc?: string
  netPos?: string
  qanc?: string
  bov?: "move" | "hide"
  logo?: boolean
}

async function render(c: Cfg): Promise<{ buf: Buffer; geo: BadgeGeometryReport; netCalls: Array<unknown> }> {
  let geo = {} as BadgeGeometryReport
  const netCalls: Array<unknown> = []
  const posterBuf = await sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  const logoFetch = c.logo === false ? null
    : await sharp({ create: { width: 300, height: 120, channels: 4, background: "#ffffff" } }).png().toBuffer()
  const network = c.network === true
  const buf = await generatePosterBuffer({
    posterBuf, logoFetch, backdropFetch: null, shape: "poster",
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: c.rank !== false,
    genreName: null, voteAverage: null,
    badgeStyle: "shadow", rankingBadgeStyle: "default" as never,
    badgeGenre: false, badgeYear: false, badgeRating: false,
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
    onNetworkGeometry: (n: unknown) => { netCalls.push(n) },
    ...(c.lanc !== undefined ? { logoAnchor: c.lanc } : {}),
    ...(c.netPos !== undefined ? { networkLogoPosition: c.netPos } : {}),
    ...(c.qanc !== undefined ? { qualityAnchor: c.qanc } : {}),
    ...(c.bov !== undefined ? { badgeOverflow: c.bov } : {}),
  } as Parameters<typeof generatePosterBuffer>[0])
  return { buf, geo, netCalls }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

describe("bov=hide: il network auto che collide con un logo manuale in alto sparisce", () => {
  it("move: il network resta (sceso sotto il logo) e compare nel report", async () => {
    const { geo } = await render({ network: true, rank: false, lanc: "tl" })
    expect(geo.families?.network).toBeDefined()
  })

  it("hide: nessuna famiglia network nel report e nessun network geometrico", async () => {
    const { geo, netCalls } = await render({ network: true, rank: false, lanc: "tl", bov: "hide" })
    expect(geo.families?.network).toBeUndefined()
    expect(netCalls[netCalls.length - 1]).toBeNull()
  })

  it("hide: i pixel sono quelli dello stesso poster con il network disabilitato", async () => {
    const hidden = await render({ network: true, rank: false, lanc: "tl", bov: "hide" })
    const disabled = await render({ network: false, rank: false, lanc: "tl" })
    expect(sha(hidden.buf)).toBe(sha(disabled.buf))
  })
})

describe("bov=hide: badge manuali restano sempre", () => {
  it("netPos manuale tl con logo tl: il network è disegnato anche in hide", async () => {
    const { geo } = await render({ network: true, rank: false, lanc: "tl", netPos: "tl", bov: "hide" })
    expect(geo.families?.network).toBeDefined()
  })
})

describe("bov=hide: nessuna collisione = byte-identico a move (all-auto)", () => {
  it("network + qualità (stack normale sotto il network), senza rank: hide == move", async () => {
    const move = await render({ network: true, quality: "4K", rank: false, bov: "move" })
    const hide = await render({ network: true, quality: "4K", rank: false, bov: "hide" })
    expect(sha(hide.buf)).toBe(sha(move.buf))
    expect(hide.geo.families?.network).toBeDefined()
    expect(hide.geo.families?.quality).toBeDefined()
  })

  it("nessun bov: equivale a move", async () => {
    const none = await render({ network: true, quality: "4K", rank: false })
    const move = await render({ network: true, quality: "4K", rank: false, bov: "move" })
    expect(sha(none.buf)).toBe(sha(move.buf))
  })

  it("collisione reale (qualità auto che si rimpicciolisce contro il rank centrale): hide nasconde la qualità, move no", async () => {
    const move = await render({ network: true, quality: "4K", rank: true, bov: "move" })
    const hide = await render({ network: true, quality: "4K", rank: true, bov: "hide" })
    expect(move.geo.families?.quality).toBeDefined()
    expect(hide.geo.families?.quality).toBeUndefined()
    // Il network non collide: resta. Il rank (manuale per definizione, non nascosto) resta.
    expect(hide.geo.families?.network).toBeDefined()
    expect(hide.geo.families?.rank).toBeDefined()
  })
})
