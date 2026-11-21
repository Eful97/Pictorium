/**
 * Posizioni relative al logo per il badge rank (tanc) e la fascia genere (banc).
 * Stessa regola di netPos/qanc: manuale, centrato sul logo, gap round(8*CH/570).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { BadgeGeometryReport } from "@/lib/badge-layout"

type Rect = { top: number; left: number; w: number; h: number }

async function render(c: { tanc?: string; banc?: string; genre?: boolean; lanc?: string }) {
  let geo = {} as BadgeGeometryReport
  const posterBuf = await sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  const logoFetch = await sharp({ create: { width: 300, height: 120, channels: 4, background: "#ffffff" } }).png().toBuffer()
  await generatePosterBuffer({
    posterBuf, logoFetch, backdropFetch: null, shape: "poster",
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: true,
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
    finalRank: 5, animeRankResult: null, rankingResult: null, mapping: null,
    tmdbNetworks: [], productionCompanies: [], tmdbStudios: [],
    tvType: null, tvStatus: null, releaseDate: null, firstAirDate: null, lastAirDate: null, seasonCount: null,
    originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null },
    tmdbKeywords: [], locale: "it", t: (k: string) => k,
    qLabel: null, queryExtra: null, qNetLogo: null,
    networkLogo: false, sd: { networkLogo: false },
    accentOverride: null, imdbTop250: false, preRelease: false,
    quality: null,
    onBadgeGeometry: (g: BadgeGeometryReport) => { geo = g },
    ...(c.tanc !== undefined ? { topBadgeAnchor: c.tanc } : {}),
    ...(c.banc !== undefined ? { bottomAnchor: c.banc } : {}),
    ...(c.lanc !== undefined ? { logoAnchor: c.lanc } : {}),
  } as Parameters<typeof generatePosterBuffer>[0])
  return geo
}

function rectOf(geo: BadgeGeometryReport, key: "rank" | "logo" | "genre"): Rect {
  const b = (geo.families as Record<string, Rect | undefined>)[key]
  if (!b) throw new Error(`no ${key} geometry`)
  return { top: b.top, left: b.left, w: b.w, h: b.h }
}
const cx = (x: Rect) => x.left + x.w / 2
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(2)
const GAP = Math.round(8 * STD_H / 570)

describe("tanc above / below: il rank si posiziona rispetto al logo", () => {
  it("above: rank sopra il logo, centrato sul suo centro", async () => {
    const geo = await render({ tanc: "above" })
    const logo = rectOf(geo, "logo")
    const rank = rectOf(geo, "rank")
    near(rank.top + rank.h, logo.top - GAP)
    near(cx(rank), cx(logo))
  })

  it("below: rank sotto il logo (logo in alto per far posto), centrato", async () => {
    const geo = await render({ tanc: "below", lanc: "tc" })
    const logo = rectOf(geo, "logo")
    const rank = rectOf(geo, "rank")
    near(rank.top, logo.top + logo.h + GAP)
    near(cx(rank), cx(logo))
  })
})

describe("banc above / below: la fascia genere si posiziona rispetto al logo", () => {
  it("below: genere sotto il logo, centrato sul suo centro", async () => {
    const geo = await render({ banc: "below", genre: true, lanc: "tc" })
    const logo = rectOf(geo, "logo")
    const genre = rectOf(geo, "genre")
    near(genre.top, logo.top + logo.h + GAP)
    near(cx(genre), cx(logo))
  })

  it("above: genere sopra il logo", async () => {
    const geo = await render({ banc: "above", genre: true })
    const logo = rectOf(geo, "logo")
    const genre = rectOf(geo, "genre")
    near(genre.top + genre.h, logo.top - GAP)
    near(cx(genre), cx(logo))
  })
})
