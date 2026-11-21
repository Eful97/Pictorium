/**
 * Ancore MANUALI (lanc, netPos tl/tr, qanc, banc, tanc, xanc) = posizione fissa:
 * angolo + offset X/Y, nessuno scalino/shrink/cambio lato per evitare altri
 * elementi. I badge in AUTO continuano a evitarle; le sovrapposizioni tra
 * manuali sono accettate. `netPos=top` è legacy e NON è manuale.
 *
 * (a) tutto-auto: esplicito "auto" = assente (byte-identico);
 * (b) qanc=tl: rettangolo qualità invariato con/senza network tl e con/senza logo tl;
 * (c) netPos=tr: rettangolo network invariato con/senza rank tr e con/senza Coming Soon a destra;
 * (d) banc=bl: rettangolo genere invariato con logo piccolo vs grande (nessuno shrink);
 * (e) auto network scende sotto un logo ancorato in alto (regressione).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { NetworkLogoPosition } from "@/lib/types"
import type { QualityAnchor, TopBadgeAnchor, BottomAnchor } from "@/lib/badge-anchor"
import type { LogoAnchor } from "@/lib/logo-layout"
import type { BadgeGeometryReport } from "@/lib/badge-layout"

interface Cfg {
  logo?: { w: number; h: number; offsetY?: number }
  logoAnchor?: LogoAnchor
  network?: boolean
  netPos?: NetworkLogoPosition
  quality?: string | null
  qualityAnchor?: QualityAnchor
  rank?: boolean
  topBadgeAnchor?: TopBadgeAnchor
  preRelease?: boolean
  ribbonSide?: "left" | "right"
  rankStyle?: string
  genre?: boolean
  bottomAnchor?: BottomAnchor
  /** Imposta esplicitamente "auto" su tutte le ancore (deve coincidere con l'assenza). */
  explicitAuto?: boolean
}

interface Rendered { buf: Buffer; geo: BadgeGeometryReport }

async function render(c: Cfg): Promise<Rendered> {
  const posterBuf = await sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  const logoFetch = c.logo
    ? await sharp({ create: { width: c.logo.w, height: c.logo.h, channels: 4, background: "#ffffff" } }).png().toBuffer()
    : null
  const network = c.network === true
  let geo: BadgeGeometryReport = {} as BadgeGeometryReport
  const auto = c.explicitAuto === true
  const buf = await generatePosterBuffer({
    posterBuf, logoFetch, backdropFetch: null,
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: c.rank !== false,
    genreName: c.genre ? "Dramma" : null, voteAverage: c.genre ? 8.1 : null,
    badgeStyle: "shadow", rankingBadgeStyle: (c.rankStyle ?? "default") as never,
    badgeGenre: c.genre === true, badgeYear: false, badgeRating: c.genre === true,
    topLight: false, targetCenter: 0, ribbonSide: c.ribbonSide ?? "left",
    logoScale: 75, logoOffsetX: 0, logoOffsetY: c.logo?.offsetY ?? 0,
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
    accentOverride: null, imdbTop250: false, preRelease: c.preRelease === true,
    quality: c.quality ?? null,
    onBadgeGeometry: (g: BadgeGeometryReport) => { geo = g },
    ...(c.netPos !== undefined || auto ? { networkLogoPosition: auto ? "auto" : c.netPos } : {}),
    ...(c.qualityAnchor !== undefined || auto ? { qualityAnchor: auto ? "auto" : c.qualityAnchor } : {}),
    ...(c.logoAnchor !== undefined || auto ? { logoAnchor: auto ? "auto" : c.logoAnchor } : {}),
    ...(c.topBadgeAnchor !== undefined || auto ? { topBadgeAnchor: auto ? "auto" : c.topBadgeAnchor } : {}),
    ...(c.bottomAnchor !== undefined || auto ? { bottomAnchor: auto ? "auto" : c.bottomAnchor } : {}),
    ...(auto ? { extraBadgeAnchor: "auto" } : {}),
  } as Parameters<typeof generatePosterBuffer>[0])
  return { buf, geo }
}

type Rect = { top: number; left: number; w: number; h: number }
function rect(r: Rendered, key: "rank" | "quality" | "network" | "genre" | "logo"): Rect {
  const b = (r.geo.families as Record<string, Rect | undefined>)[key]
  if (!b) throw new Error(`no ${key} geometry`)
  return { top: b.top, left: b.left, w: b.w, h: b.h }
}
const bottom = (x: Rect) => x.top + x.h

const W = STD_W
const H = STD_H
const LOGO_BIG = { w: 900, h: 300, offsetY: 120 }
const LOGO_SMALL = { w: 220, h: 80, offsetY: 120 }

describe("manual anchors (a): tutto-auto invariato", () => {
  const cases: Array<[string, Cfg]> = [
    ["network+quality+logo", { network: true, quality: "4K", logo: { w: 420, h: 200 } }],
    ["rank+network+quality", { network: true, quality: "4K" }],
    ["netflix ribbon destra", { rankStyle: "netflix", ribbonSide: "right", network: true, quality: "4K", logo: { w: 420, h: 200 } }],
    ["coming soon destra", { preRelease: true, ribbonSide: "right", network: true, quality: "4K", logo: { w: 420, h: 200 } }],
    ["genere + logo grande", { genre: true, logo: LOGO_BIG }],
  ]
  for (const [name, cfg] of cases) {
    it(`${name}: esplicito "auto" è byte-identico ad assente`, async () => {
      const [absent, explicit] = await Promise.all([render(cfg), render({ ...cfg, explicitAuto: true })])
      expect(Buffer.compare(absent.buf, explicit.buf)).toBe(0)
    })
  }
})

describe("manual anchors (b): qanc=tl è fissa", () => {
  const base = { quality: "4K", qualityAnchor: "tl" as const }

  it("con network tl (manuale) il rettangolo qualità non cambia (nessuno stacking)", async () => {
    const [alone, withNet] = await Promise.all([
      render({ ...base }),
      render({ ...base, network: true, netPos: "tl" }),
    ])
    expect(rect(withNet, "quality")).toEqual(rect(alone, "quality"))
  })

  it("con logo tl (ancorato in alto) il rettangolo qualità non scende sotto il logo", async () => {
    const [alone, withLogo] = await Promise.all([
      render({ ...base }),
      render({ ...base, logo: { w: 420, h: 200 }, logoAnchor: "tl" }),
    ])
    expect(rect(withLogo, "quality")).toEqual(rect(alone, "quality"))
  })

  it("con network tl E logo tl il rettangolo qualità resta quello d'angolo", async () => {
    const [alone, all] = await Promise.all([
      render({ ...base }),
      render({ ...base, network: true, netPos: "tl", logo: { w: 420, h: 200 }, logoAnchor: "tl" }),
    ])
    expect(rect(all, "quality")).toEqual(rect(alone, "quality"))
  })

  // Controlli: la qualità in AUTO, spostata a sinistra dal nastro Netflix a
  // destra, continua a evitare gli elementi manuali a sinistra.
  it("controllo: qualità in auto (nastro destro) scende sotto un network tl manuale", async () => {
    const r = await render({ rankStyle: "netflix", ribbonSide: "right", quality: "4K", network: true, netPos: "tl" })
    expect(rect(r, "quality").top).toBeGreaterThanOrEqual(bottom(rect(r, "network")))
  })

  it("controllo: qualità in auto (nastro destro) scende sotto un logo tl ancorato", async () => {
    const r = await render({ rankStyle: "netflix", ribbonSide: "right", quality: "4K", logo: { w: 420, h: 200 }, logoAnchor: "tl" })
    expect(rect(r, "quality").top).toBeGreaterThanOrEqual(bottom(rect(r, "logo")))
  })
})

describe("manual anchors (c): netPos=tr è fissa", () => {
  it("con rank tr (tanc=tr) il rettangolo network non cambia (nessun drop)", async () => {
    const [alone, withRank] = await Promise.all([
      render({ network: true, netPos: "tr", rank: false }),
      render({ network: true, netPos: "tr", topBadgeAnchor: "tr" }),
    ])
    expect(rect(withRank, "network")).toEqual(rect(alone, "network"))
  })

  it("con Coming Soon a destra il rettangolo network non cambia (nessun mirror sotto)", async () => {
    const [alone, withCs] = await Promise.all([
      render({ network: true, netPos: "tr", rank: false, preRelease: false, ribbonSide: "right" }),
      render({ network: true, netPos: "tr", rank: false, preRelease: true, ribbonSide: "right" }),
    ])
    expect(rect(withCs, "network")).toEqual(rect(alone, "network"))
  })

  it("controllo: network in auto con tanc=tl DEVE scendere sotto il corpo rank", async () => {
    const r = await render({ network: true, topBadgeAnchor: "tl", quality: null })
    expect(rect(r, "network").top).toBeGreaterThanOrEqual(bottom(rect(r, "rank")))
  })

  it("controllo: con Coming Soon a destra il network in auto va sotto il nastro (mirror)", async () => {
    const auto = await render({ network: true, rank: false, preRelease: true, ribbonSide: "right" })
    const manual = await render({ network: true, netPos: "tr", rank: false, preRelease: true, ribbonSide: "right" })
    expect(rect(auto, "network").top).not.toBe(rect(manual, "network").top)
  })
})

describe("manual anchors (d): banc=bl è fissa", () => {
  it("genere bl: rettangolo identico con logo piccolo e grande (nessuno shrink/lift)", async () => {
    const [small, big] = await Promise.all([
      render({ genre: true, bottomAnchor: "bl", logo: LOGO_SMALL }),
      render({ genre: true, bottomAnchor: "bl", logo: LOGO_BIG }),
    ])
    expect(rect(big, "genre")).toEqual(rect(small, "genre"))
  })

  it("controllo: genere in auto con logo grande collidente viene alzato (lift)", async () => {
    const autoBig = await render({ genre: true, logo: LOGO_BIG })
    const manualBig = await render({ genre: true, bottomAnchor: "bl", logo: LOGO_BIG })
    expect(rect(autoBig, "genre").top).toBeLessThan(rect(manualBig, "genre").top)
  })
})

describe("manual anchors (e): auto network sotto un logo ancorato in alto (regressione)", () => {
  it("logo tl + network in auto: la pill network scende sotto il logo, il logo non si muove", async () => {
    const logo = { w: 420, h: 200 }
    const [withNet, noNet] = await Promise.all([
      render({ logo, logoAnchor: "tl", network: true }),
      render({ logo, logoAnchor: "tl" }),
    ])
    expect(rect(withNet, "logo")).toEqual(rect(noNet, "logo"))
    expect(rect(withNet, "network").top).toBeGreaterThanOrEqual(bottom(rect(withNet, "logo")))
  })
})
