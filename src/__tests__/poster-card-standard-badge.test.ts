/**
 * P15: Card main standard badge + optional separate individuals.
 *
 * Contract under test (user-explicit: "prendiamo quello standard di
 * Pictorium, non reinventiamo" + "voglio poter mettere rating separati"):
 * - the Card main badge is the EXISTING standard genre/rating renderer fed
 *   with the ONE P8 aggregate (`aggregateCardRating` of the selected stack)
 *   — pixel-identical to calling `renderGenreBadge` directly with that
 *   value, and byte-different from the retired custom Card SVG path;
 * - style/font/accent/scale controls apply to the Card main badge like
 *   Standard; the shared `genreBadgeScale` moves Card bytes too;
 * - the optional separate toggle shows the individuals via the EXISTING
 *   renderers only (column stack / bottom row / custom row, max 5,
 *   existing icons/order/scales) — never Card text rows, never silently
 *   dropped while on, never duplicated (custom keeps historic priority,
 *   bottom suppresses the custom row);
 * - main badge stays combined with the separates (raw pre-suppression
 *   toggles) and readable in the below-card band on all 3 skins x both
 *   shapes without touching card/provider/title/quality;
 * - missing providers and toggles degrade safely at exact dims.
 *
 * Fresh/Standard paths are untouched (covered by their own suites).
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  generatePosterBuffer,
  renderCardMainBadge,
  type GenerationInput,
} from "@/lib/poster-service"
import {
  aggregateCardRating,
  cardMetadataBand,
  cardMetadataLines,
  cardMetadataSvg,
  cardMetadataFontSize,
} from "@/lib/card-layout"
import { cardLayoutGeometry } from "@/lib/card-layout-geometry"
import { renderGenreBadge } from "@/lib/svg-badge"
import { MAX_SEPARATE_RATINGS } from "@/lib/ratings"
import { STD_H, STD_W, LAND_H, LAND_W } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { CardSkin } from "@/lib/card-layout-skins"

const SKINS: CardSkin[] = ["provider-glass", "nuvio", "stremio"]
const ACCENT = "#8a6d1b"

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

async function patternedBase(w: number, h: number): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3a3f55"/><stop offset="1" stop-color="#141827"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#p)"/>` +
    `<rect x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="#2e4a7a" opacity="0.85"/>` +
    `<circle cx="${Math.round(w * 0.25)}" cy="${Math.round(h * 0.3)}" r="${Math.round(w * 0.18)}" fill="#7a6a2e" opacity="0.9"/>` +
    `<rect x="0" y="${Math.round(h * 0.7)}" width="${w}" height="${Math.round(h * 0.3)}" fill="#0d0d12" opacity="0.9"/>` +
    `</svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer()
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
    rankingEnabled: true,
    genreName: "Dramma",
    voteAverage: 8.3,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
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
    separateBadgeScale: 100,
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
    releaseDate: "2024-03-10",
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
    shape: "poster",
    ...overrides,
  }
}

const FIVE_SEPARATE = [
  { id: "imdb", value: 7.3 },
  { id: "tmdb", value: 8.1 },
  { id: "tomatoes", value: 8.8 },
  { id: "letterboxd", value: 3.9 },
  { id: "trakt", value: 7.7 },
] as const

async function rawOf(png: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: data as Buffer, w: info.width, h: info.height }
}

/** Count of differing pixels of `b` vs `a` inside a rect (independent scan).
 * `strongOnly` keeps only channel moves > 24 (the repo's core-ink mask):
 * JPEG service outputs scatter faint (±few) noise around any changed region
 * (pre-existing: the Standard path scatters ~24k faint pixels on the same
 * metadata toggle), so presence/containment proofs use the strong mask. */
function diffCountIn(
  a: { data: Buffer; w: number; h: number },
  b: { data: Buffer; w: number; h: number },
  rect: { x0: number; y0: number; x1: number; y1: number },
  strongOnly = false,
): number {
  expect(a.w).toBe(b.w)
  expect(a.h).toBe(b.h)
  let count = 0
  const x0 = Math.max(0, rect.x0)
  const y0 = Math.max(0, rect.y0)
  const x1 = Math.min(a.w - 1, rect.x1)
  const y1 = Math.min(a.h - 1, rect.y1)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * a.w + x) * 4
      const dr = Math.abs((a.data[o] ?? 0) - (b.data[o] ?? 0))
      const dg = Math.abs((a.data[o + 1] ?? 0) - (b.data[o + 1] ?? 0))
      const db = Math.abs((a.data[o + 2] ?? 0) - (b.data[o + 2] ?? 0))
      if (strongOnly ? Math.max(dr, dg, db) > 24 : dr !== 0 || dg !== 0 || db !== 0) {
        count++
      }
    }
  }
  return count
}

describe("P15 Card main badge reuses the existing standard renderer (unit, no service)", () => {
  const mainArgs = {
    genreName: "Dramma",
    year: "2024",
    aggregate: 7.7,
    showGenre: true,
    showYear: true,
    showRating: true,
    badgePw: STD_W,
    CW: STD_W,
    badgeStyle: "shadow" as const,
    accentColor: ACCENT,
    bottomLight: false,
    badgeFont: "inter" as const,
    nativeScale: 100,
  }

  it("is pixel-identical to renderGenreBadge with the aggregate value", async () => {
    expect(MAX_SEPARATE_RATINGS).toBe(5)
    const viaCard = await renderCardMainBadge(mainArgs)
    expect(viaCard).not.toBeNull()
    const direct = await renderGenreBadge(
      "Dramma", 7.7, STD_W, "2024", "shadow", ACCENT, false,
      { showGenre: true, showYear: true, showRating: true }, 100, "inter",
    )
    expect(viaCard!.w).toBe(direct.w)
    expect(viaCard!.h).toBe(direct.h)
    expect(Buffer.compare(viaCard!.png, direct.png)).toBe(0)
    // Bar style (native font scale path) matches too.
    const viaCardBar = await renderCardMainBadge({ ...mainArgs, badgeStyle: "bar", nativeScale: 130 })
    const directBar = await renderGenreBadge(
      "Dramma", 7.7, STD_W, "2024", "bar", ACCENT, false,
      { showGenre: true, showYear: true, showRating: true }, 130, "inter",
    )
    expect(Buffer.compare(viaCardBar!.png, directBar.png)).toBe(0)
    expect(sha(viaCardBar!.png)).not.toBe(sha(viaCard!.png))
  })

  it("differs from the retired custom Card SVG path for the same content", async () => {
    const viaCard = await renderCardMainBadge(mainArgs)
    expect(viaCard).not.toBeNull()
    // Same semantic content through the custom path: single aggregate line.
    const lines = cardMetadataLines({
      genreName: "Dramma",
      year: "2024",
      ratings: [{ id: "tmdb", value: 7.7 }],
    })
    expect(lines.length).toBeGreaterThan(0)
    const custom = cardMetadataSvg(lines, viaCard!.w + 40, viaCard!.h + 40, cardMetadataFontSize(STD_W))!
    expect(custom).not.toBeNull()
    const customPng = await sharp(Buffer.from(custom.svg)).png().toBuffer().catch(() => null)
    expect(customPng).not.toBeNull()
    // Different renderer, different bytes (never a relabeled custom path).
    expect(sha(viaCard!.png)).not.toBe(sha(customPng!))
  })

  it("null aggregate renders no rating segment; parts follow the raw toggles", async () => {
    const noRating = await renderCardMainBadge({ ...mainArgs, aggregate: null })
    const directBare = await renderGenreBadge(
      "Dramma", 0, STD_W, "2024", "shadow", ACCENT, false,
      { showGenre: true, showYear: true, showRating: true }, 100, "inter",
    )
    expect(Buffer.compare(noRating!.png, directBare.png)).toBe(0)
    expect(sha(noRating!.png)).not.toBe(sha((await renderCardMainBadge(mainArgs))!.png))
    // Hidden genre: rating + year only (same as Standard parts).
    const noGenre = await renderCardMainBadge({ ...mainArgs, showGenre: false })
    const directNoGenre = await renderGenreBadge(
      "Dramma", 7.7, STD_W, "2024", "shadow", ACCENT, false,
      { showGenre: false, showYear: true, showRating: true }, 100, "inter",
    )
    expect(Buffer.compare(noGenre!.png, directNoGenre.png)).toBe(0)
    expect(sha(noGenre!.png)).not.toBe(sha((await renderCardMainBadge(mainArgs))!.png))
  })

  it("style, font, accent and scale controls move the main badge bytes", async () => {
    const base = sha((await renderCardMainBadge(mainArgs))!.png)
    expect(sha((await renderCardMainBadge({ ...mainArgs, badgeStyle: "pill" }))!.png)).not.toBe(base)
    expect(sha((await renderCardMainBadge({ ...mainArgs, badgeFont: "oswald" }))!.png)).not.toBe(base)
    // Accent tints the filled `colored` style (pill/shadow carry fixed
    // material colors: accent is inert there, same as Standard).
    const colored = { ...mainArgs, badgeStyle: "colored" as const }
    expect(sha((await renderCardMainBadge(colored))!.png)).not.toBe(
      sha((await renderCardMainBadge({ ...colored, accentColor: "#00a8e1" }))!.png),
    )
    // Percent-scale aggregate evidence: 87 (percent) normalizes to 8.7, so a
    // percent-fed aggregate renders exactly like the same decimal value.
    const percentAgg = aggregateCardRating([{ id: "c", value: 87, format: "percent" }])
    expect(percentAgg).toBeCloseTo(8.7, 10)
    const viaPercent = await renderCardMainBadge({ ...mainArgs, aggregate: percentAgg })
    const viaDecimal = await renderCardMainBadge({ ...mainArgs, aggregate: 8.7 })
    expect(Buffer.compare(viaPercent!.png, viaDecimal!.png)).toBe(0)
  })
})

describe("P15 service Card: combined main badge readable in band, all skins x shapes", () => {
  it("main badge paints bounded band ink below the card, never on it", async () => {
    expect(MAX_SEPARATE_RATINGS).toBe(5)
    const logo = await whiteLogo()
    for (const [w, h, shape] of [
      [STD_W, STD_H, "poster"],
      [LAND_W, LAND_H, "landscape"],
    ] as const) {
      const base = await patternedBase(w, h)
      const geo = cardLayoutGeometry(shape, w, h, 7)!
      const band = cardMetadataBand(w, h, geo)!
      for (const skin of SKINS) {
        const bare = await rawOf(
          await generatePosterBuffer(
            baseInput({
              posterBuf: base, logoFetch: logo, shape, posterLayout: skin,
              finalRank: 7, genreName: null, voteAverage: null, releaseDate: null, firstAirDate: null,
            }),
          ),
        )
        const out = await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, shape, posterLayout: skin, finalRank: 7 }),
        )
        expect(await sharp(out).metadata()).toMatchObject({ width: w, height: h })
        const full = await rawOf(out)
        // Ink inside the band (the main standard badge, strong mask — see
        // diffCountIn: JPEG outputs scatter faint noise around changes).
        const inBand = diffCountIn(bare, full, { x0: band.x0, y0: band.y0, x1: band.x1, y1: band.y1 }, true)
        expect(inBand).toBeGreaterThan(100)
        // Zero new strong pixels on the artwork card (never a spill).
        const card = geo.card
        const onCard = diffCountIn(bare, full, {
          x0: card.x, y0: card.y, x1: card.x + card.width - 1, y1: card.y + card.height - 1,
        }, true)
        expect(onCard).toBe(0)
      }
    }
  }, 240000)

  it("raw genre/year toggles drive the combined badge (route suppression bypass evidence)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7, ...over }),
      )
    // Effective genre OFF (what the route passes in bottom mode) but raw ON:
    // the combined main badge keeps the genre (raw wins) — the documented
    // deviation from the standard bottom suppression.
    const rawOn = sha(await render({ badgeGenre: false, freshRawBadgeGenre: true }))
    const rawOff = sha(await render({ badgeGenre: false }))
    expect(rawOn).not.toBe(rawOff)
    // No raw field (direct-caller compat): the passed value applies as-is.
    expect(sha(await render({ badgeGenre: false, freshRawBadgeGenre: false }))).toBe(rawOff)
    // Same for year.
    expect(
      sha(await render({ badgeYear: false, freshRawBadgeYear: true })),
    ).not.toBe(sha(await render({ badgeYear: false })))
  }, 240000)

  it("genreBadgeScale moves the Card main badge bytes (control now live on Card)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = async (over: Partial<GenerationInput>) =>
      sha(
        await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "nuvio", finalRank: 7, ...over }),
        ),
      )
    const s100 = await render({})
    expect(await render({ genreBadgeScale: 130 })).not.toBe(s100)
    expect(await render({ genreBadgeScale: 80 })).not.toBe(s100)
  }, 240000)
})

describe("P15 service Card: P8 aggregate preserved through the standard badge", () => {
  it("5 vs 3 vs none differ; order-independent; 4th/5th values contribute", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7, ...over }),
      )
    const five = sha(await render({ separateRatings: [...FIVE_SEPARATE] }))
    const three = sha(await render({ separateRatings: [...FIVE_SEPARATE].slice(0, 3) }))
    const none = sha(await render({ separateRatings: undefined }))
    expect(five).not.toBe(three)
    expect(three).not.toBe(none)
    expect(five).not.toBe(none)
    // P15 intentional change vs the aggregate-only era: the separate column
    // preserves source order (user contract), so a reordered selection paints
    // reordered individuals — while the aggregate itself stays
    // order-independent (the mean feeding the main badge).
    expect(sha(await render({ separateRatings: [...FIVE_SEPARATE].reverse() }))).not.toBe(five)
    expect(aggregateCardRating([...FIVE_SEPARATE])).toBe(aggregateCardRating([...FIVE_SEPARATE].reverse()))
    const changed5 = [...FIVE_SEPARATE].map((s, i) => (i === 4 ? { ...s, value: 1.1 } : s))
    expect(sha(await render({ separateRatings: changed5 }))).not.toBe(five)
    const changed4 = [...FIVE_SEPARATE].map((s, i) => (i === 3 ? { ...s, value: 9.9 } : s))
    expect(sha(await render({ separateRatings: changed4 }))).not.toBe(five)
  }, 240000)

  it("custom stack aggregates (percent-scale evidence) and keeps historic priority", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7, ...over }),
      )
    const customs = [
      { id: "imdb", name: "IMDb", value: 7.3, format: "decimal" },
      { id: "mytv", name: "MyTV", value: 8.0, format: "decimal" },
    ] as const
    const withCustom = sha(await render({ ratings: [...customs], voteAverage: null }))
    expect(withCustom).not.toBe(sha(await render({ ratings: undefined, voteAverage: null })))
    // Ordinary average suppressed by the rendered custom stack (never two).
    expect(sha(await render({ ratings: [...customs], voteAverage: 8.3 }))).toBe(withCustom)
    // Custom + separates: custom keeps priority (separate column suppressed).
    expect(sha(await render({ ratings: [...customs], separateRatings: [...FIVE_SEPARATE] }))).toBe(
      sha(await render({ ratings: [...customs], separateRatings: undefined })),
    )
    // Bottom style suppresses the custom row: separates win, never duplicated.
    const bottomSep = { separateRatingsStyle: "bottom-pills" as const, separateRatings: [...FIVE_SEPARATE] }
    expect(sha(await render({ ...bottomSep, ratings: [...customs] }))).toBe(
      sha(await render({ ...bottomSep, ratings: undefined })),
    )
  }, 240000)
})

describe("P15 service Card: optional separate individuals (existing renderers only)", () => {
  it("toggle OFF renders no individuals; toggles gate safely", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7, ...over }),
      )
    // Undefined == empty array: no phantom individuals, no invented values.
    expect(sha(await render({ separateRatings: [] }))).toBe(
      sha(await render({ separateRatings: undefined })),
    )
    // Rating toggle off silences individuals AND the aggregate star.
    expect(sha(await render({ badgeRating: false, separateRatings: [...FIVE_SEPARATE] }))).toBe(
      sha(await render({ badgeRating: false, separateRatings: undefined })),
    )
    // Badges off silences everything (main + individuals).
    expect(sha(await render({ badgesEnabled: false, separateRatings: [...FIVE_SEPARATE] }))).toBe(
      sha(await render({ badgesEnabled: false, separateRatings: undefined })),
    )
    // Unknown provider ids never throw and keep exact dims.
    const unknown = await render({ separateRatings: [{ id: "nosuch", value: 7.7 }] })
    expect(await sharp(unknown).metadata()).toMatchObject({ width: STD_W, height: STD_H })
  }, 240000)

  it("1/3/5 sources differ; all five styles follow the existing control", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = async (over: Partial<GenerationInput>) =>
      sha(
        await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "provider-glass", finalRank: 7, ...over }),
        ),
      )
    const one = await render({ separateRatings: [...FIVE_SEPARATE].slice(0, 1) })
    const three = await render({ separateRatings: [...FIVE_SEPARATE].slice(0, 3) })
    const five = await render({ separateRatings: [...FIVE_SEPARATE] })
    // 5vs3 evidence: the 4th/5th sources paint (a cap-3 truncation would make
    // five identical to three).
    expect(one).not.toBe(three)
    expect(three).not.toBe(five)
    expect(one).not.toBe(five)
    // Every existing bottom/column style renders distinctly (the style
    // control drives the Card individuals, no new system).
    const styles = ["column", "bottom-bar", "bottom-pills", "bottom-mono", "bottom-color"] as const
    const shas = new Map<string, string>()
    for (const separateRatingsStyle of styles) {
      shas.set(
        separateRatingsStyle,
        await render({ separateRatings: [...FIVE_SEPARATE], separateRatingsStyle }),
      )
    }
    expect(new Set(shas.values()).size).toBe(styles.length)
  }, 240000)

  it("combined badge + separates: bottom and column keep the main badge", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "nuvio", finalRank: 7, ...over }),
      )
    const mainOnly = sha(await render({ separateRatings: undefined }))
    const bare = sha(
      await render({ separateRatings: undefined, genreName: null, voteAverage: null, releaseDate: null, firstAirDate: null }),
    )
    for (const separateRatingsStyle of ["column", "bottom-pills", "bottom-bar"] as const) {
      const combined = sha(await render({ separateRatings: [...FIVE_SEPARATE], separateRatingsStyle }))
      // Individuals paint (differs from main-only) and the main badge is
      // kept (differs from bare — a pure standard-bottom suppression would
      // equal neither, the combined contract equals both diffs).
      expect(combined).not.toBe(mainOnly)
      expect(combined).not.toBe(bare)
    }
  }, 240000)
})
