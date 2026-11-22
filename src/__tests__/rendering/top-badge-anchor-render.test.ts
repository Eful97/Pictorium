/**
 * Ancora del badge superiore centrato nel renderer:
 * - `tanc` vale solo per il badge rank; `xanc` solo per il badge extra (indipendenti);
 * - `auto`/assente byte-identici; corner/numerale/nastro Netflix ignorano l'ancora;
 * - `tl`/`tr` portano il corpo rank all'angolo (geometria riportata dal renderer);
 * - Coming Soon nello stesso angolo: il corpo scende sotto il ribbon;
 * - `tr` rende l'angolo destro occupato: qualità auto a sinistra;
 * - network nello stesso angolo del rank: scende sotto il corpo solo in auto
 *   (netPos manuale = posizione fissa, sovrapposizione accettata);
 * - Fresh e Card ignorano `tanc` (byte-identici).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { NetworkLogoPosition } from "@/lib/types"
import type { TopBadgeAnchor, ExtraBadgeAnchor } from "@/lib/badge-anchor"
import type { BadgeGeometryReport } from "@/lib/badge-layout"

async function darkPoster(): Promise<Buffer> {
  return sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
}

interface Opts {
  rankStyle?: string
  topBadgeAnchor?: TopBadgeAnchor
  extraBadgeAnchor?: ExtraBadgeAnchor
  /** Etichetta extra (`extra=`): quando presente il badge superiore è di tipo extra. */
  extra?: string
  quality?: string | null
  network?: boolean
  netPos?: NetworkLogoPosition
  preRelease?: boolean
  ribbonSide?: "left" | "right"
  posterLayout?: string | null
  posterFreshScope?: string
  rank?: boolean
}

interface Rendered { buf: Buffer; geo: BadgeGeometryReport | null }

async function render(o: Opts): Promise<Rendered> {
  const network = o.network === true
  let geo: BadgeGeometryReport | null = null
  const buf = await generatePosterBuffer({
    posterBuf: await darkPoster(),
    logoFetch: null,
    backdropFetch: null,
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: o.rank !== false, finalRank: o.rank === false ? null : 5,
    genreName: null, voteAverage: null,
    badgeStyle: "shadow", rankingBadgeStyle: (o.rankStyle ?? "default") as never,
    badgeGenre: false, badgeYear: false, badgeRating: false,
    topLight: false, targetCenter: 0, ribbonSide: o.ribbonSide ?? "left",
    logoScale: 75, logoOffsetX: 0, logoOffsetY: 0,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
    genreBadgeScale: 100, qualityBadgeScale: 100, separateBadgeScale: 100, networkLogoScale: 100,
    genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    mediaType: "movie",
    rankingResult: null, mapping: null, animeRankResult: null,
    tmdbNetworks: network ? ["Netflix"] : [], productionCompanies: [], tmdbStudios: [],
    tvType: null, tvStatus: null, releaseDate: null, firstAirDate: null, lastAirDate: null, seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [], locale: "it", t: (k: string) => k,
    qLabel: null, queryExtra: o.extra ?? null, qNetLogo: null,
    networkLogo: network, sd: { networkLogo: network } satisfies ServerDefaults,
    accentOverride: null, imdbTop250: false,
    preRelease: o.preRelease === true,
    quality: o.quality ?? null,
    ...(o.netPos !== undefined ? { networkLogoPosition: o.netPos } : {}),
    ...(o.topBadgeAnchor !== undefined ? { topBadgeAnchor: o.topBadgeAnchor } : {}),
...(o.extraBadgeAnchor !== undefined ? { extraBadgeAnchor: o.extraBadgeAnchor } : {}),
    ...(o.posterLayout !== undefined ? { posterLayout: o.posterLayout as never } : {}),
    ...(o.posterFreshScope !== undefined ? { posterFreshScope: o.posterFreshScope as never } : {}),
    onBadgeGeometry: (g: BadgeGeometryReport) => { geo = g },
  } as Parameters<typeof generatePosterBuffer>[0])
  return { buf, geo }
}

const W = STD_W
const NET_PAD_X = Math.round((18 * STD_W) / 380) // margine corner (netPadX)

function box(r: Rendered, key: "rank" | "extra" | "quality" | "network") {
  const b = r.geo?.families[key]
  if (!b) throw new Error(`no ${key} geometry`)
  return b
}

describe("top badge anchor: invarianti (absent/auto e stili che la ignorano)", () => {
  it("assente e auto sono byte-identici", async () => {
    const [absent, auto] = await Promise.all([render({}), render({ topBadgeAnchor: "auto" })])
    expect(Buffer.compare(absent.buf, auto.buf)).toBe(0)
  })

  // Nastro Netflix: unico stile che ignora tanc (byte-identico ad auto).
  it("nastro Netflix ignora tl/tr (byte-identico)", async () => {
    const [plain, tl, tr] = await Promise.all([
      render({ rankStyle: "netflix" }),
      render({ rankStyle: "netflix", topBadgeAnchor: "tl" }),
      render({ rankStyle: "netflix", topBadgeAnchor: "tr" }),
    ])
    expect(Buffer.compare(plain.buf, tl.buf), "netflix tl").toBe(0)
    expect(Buffer.compare(plain.buf, tr.buf), "netflix tr").toBe(0)
  })

  // Corner/numerale: tanc≠auto ora sposta il corpo (posizione fissa estesa).
  // tl resta sull'angolo sinistro; tr va a destra e cambia il bitmap.
  it("corner con tanc=tr si sposta a destra (non più ignorato)", async () => {
    const [plain, tr] = await Promise.all([
      render({ rankStyle: "corner" }),
      render({ rankStyle: "corner", topBadgeAnchor: "tr" }),
    ])
    expect(Buffer.compare(plain.buf, tr.buf)).not.toBe(0)
  })

  it("Fresh e Card (skin) ignorano tanc (byte-identici)", async () => {
    const cases: Opts[] = [
      { posterLayout: "fresh" },
      { posterLayout: "provider-glass", posterFreshScope: "all" },
      { posterLayout: "nuvio", posterFreshScope: "all" },
      { posterLayout: "stremio", posterFreshScope: "all" },
    ]
    for (const c of cases) {
      const posterLayout = c.posterLayout
      const [plain, tl, tr] = await Promise.all([
        render(c),
        render({ ...c, topBadgeAnchor: "tl" }),
        render({ ...c, topBadgeAnchor: "tr" }),
      ])
      expect(Buffer.compare(plain.buf, tl.buf), `${posterLayout} tl`).toBe(0)
      expect(Buffer.compare(plain.buf, tr.buf), `${posterLayout} tr`).toBe(0)
    }
  })
})

describe("top badge anchor: posizionamento del corpo rank", () => {
  it("tl porta il corpo all'angolo alto sinistro, tr a quello destro", async () => {
    const [auto, tl, tr] = await Promise.all([
      render({}),
      render({ topBadgeAnchor: "tl" }),
      render({ topBadgeAnchor: "tr" }),
    ])
    const centered = box(auto, "rank")
    expect(Math.abs(centered.left + centered.w / 2 - W / 2)).toBeLessThanOrEqual(1)
    const left = box(tl, "rank")
    expect(Math.abs(left.left - NET_PAD_X)).toBeLessThanOrEqual(1)
    expect(left.top).toBe(0)
    const right = box(tr, "rank")
    expect(Math.abs(right.left + right.w - (W - NET_PAD_X))).toBeLessThanOrEqual(1)
    expect(right.top).toBe(0)
  })
})

describe("top badge anchor: Coming Soon occupa lo slot alto", () => {
  // Il nastro Coming Soon sostituisce il corpo rank (nessun rank disegnato):
  // tanc non deve spostare nulla, né sul lato del nastro né sull'altro.
  it("tl e tr con Coming Soon sono byte-identici al Coming Soon senza ancora", async () => {
    for (const ribbonSide of ["left", "right"] as const) {
      const [plain, tl, tr] = await Promise.all([
        render({ preRelease: true, ribbonSide }),
        render({ preRelease: true, ribbonSide, topBadgeAnchor: "tl" }),
        render({ preRelease: true, ribbonSide, topBadgeAnchor: "tr" }),
      ])
      expect(Buffer.compare(plain.buf, tl.buf), `${ribbonSide} tl`).toBe(0)
      expect(Buffer.compare(plain.buf, tr.buf), `${ribbonSide} tr`).toBe(0)
    }
  })
})

describe("top badge anchor: angolo destro occupato dal rank", () => {
  it("tr con qualità auto: la qualità va a sinistra", async () => {
    const withTr = await render({ topBadgeAnchor: "tr", quality: "4K" })
    const q = box(withTr, "quality")
    expect(q.left + q.w / 2).toBeLessThan(W / 2)
  })

  it("senza ancora la qualità auto resta a destra (controllo)", async () => {
    const plain = await render({ quality: "4K" })
    const q = box(plain, "quality")
    expect(q.left + q.w / 2).toBeGreaterThan(W / 2)
  })
})

// Ancore manuali entrambe (tanc + netPos nello stesso angolo): il network è
// fisso, non scende sotto il corpo rank; la sovrapposizione è accettata.
describe("top badge anchor: network nello stesso angolo del rank (manuali)", () => {
  it("netPos=tr con rank tr: il network non scende (posizione fissa), uguale a senza rank", async () => {
    const r = await render({ topBadgeAnchor: "tr", network: true, netPos: "tr" })
    const alone = await render({ network: true, netPos: "tr", rank: false })
    expect(box(r, "network")).toEqual(box(alone, "network"))
  })

  it("netPos=tl con rank tl: il network non scende (posizione fissa), uguale a senza rank", async () => {
    const r = await render({ topBadgeAnchor: "tl", network: true, netPos: "tl" })
    const alone = await render({ network: true, netPos: "tl", rank: false })
    expect(box(r, "network")).toEqual(box(alone, "network"))
  })

  it("controllo: network in auto con rank tl scende sotto il corpo (avoidance auto invariata)", async () => {
    const r = await render({ topBadgeAnchor: "tl", network: true })
    expect(box(r, "network").top).toBeGreaterThanOrEqual(box(r, "rank").top + box(r, "rank").h)
  })
})

const EXTRA = "Candidato Oscar"

describe("extra badge anchor (xanc): indipendente da tanc", () => {
  it("assenti e auto (entrambe le ancore) sono byte-identici", async () => {
    const [absent, auto] = await Promise.all([
      render({ extra: EXTRA }),
      render({ extra: EXTRA, topBadgeAnchor: "auto", extraBadgeAnchor: "auto" }),
    ])
    expect(Buffer.compare(absent.buf, auto.buf)).toBe(0)
  })

  it("xanc=tl porta il badge extra all'angolo alto sinistro, tr a quello destro", async () => {
    const [plain, tl, tr] = await Promise.all([
      render({ extra: EXTRA }),
      render({ extra: EXTRA, extraBadgeAnchor: "tl" }),
      render({ extra: EXTRA, extraBadgeAnchor: "tr" }),
    ])
    const centered = box(plain, "extra")
    expect(Math.abs(centered.left + centered.w / 2 - W / 2)).toBeLessThanOrEqual(1)
    const left = box(tl, "extra")
    expect(Math.abs(left.left - NET_PAD_X)).toBeLessThanOrEqual(1)
    expect(left.top).toBe(0)
    const right = box(tr, "extra")
    expect(Math.abs(right.left + right.w - (W - NET_PAD_X))).toBeLessThanOrEqual(1)
    expect(right.top).toBe(0)
  })

  it("tanc=tl con xanc auto: il badge extra resta centrato (byte-identico)", async () => {
    const [plain, tancOnly] = await Promise.all([
      render({ extra: EXTRA }),
      render({ extra: EXTRA, topBadgeAnchor: "tl" }),
    ])
    expect(Buffer.compare(plain.buf, tancOnly.buf)).toBe(0)
    const centered = box(tancOnly, "extra")
    expect(Math.abs(centered.left + centered.w / 2 - W / 2)).toBeLessThanOrEqual(1)
  })
})

describe("extra badge anchor (xanc): il rank non la usa", () => {
  it("xanc senza badge extra è byte-identico al rank senza ancora", async () => {
    const [plain, xTl] = await Promise.all([render({}), render({ extraBadgeAnchor: "tl" })])
    expect(Buffer.compare(plain.buf, xTl.buf)).toBe(0)
  })

  it("con rank, xanc non sposta il corpo rank (tanc resta l'unica leva)", async () => {
    const [plain, xTl] = await Promise.all([render({}), render({ extraBadgeAnchor: "tl" })])
    expect(Buffer.compare(plain.buf, xTl.buf)).toBe(0)
    const centered = box(plain, "rank")
    expect(Math.abs(centered.left + centered.w / 2 - W / 2)).toBeLessThanOrEqual(1)
  })
})
