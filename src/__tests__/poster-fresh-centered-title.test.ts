/**
 * Fresh ranked-portrait centered title (task8a2, user-approved composition).
 *
 * User reference (photo, NOT an asset — never copied into the repo): Fresh
 * portrait rank 3, left number/genre/rating/provider column, BIG white title
 * centered at the bottom spanning almost the full width (~30px margins).
 * Confirmed scope: portrait Fresh WITH rank = centered + larger bottom;
 * landscape = current right anchor untouched; without rank = as-is.
 *
 * Contract:
 * - Ranked PORTRAIT only: title centered (`x = round((CW - w) / 2)` + the
 *   single user `logoOffsetX`), bottom-anchored (`CH - h - titleBottom` +
 *   the single user `logoOffsetY`, same bottom margin as before).
 * - Ranked-portrait-only slot: usable canvas width minus ~5.5%/side margins
 *   (`rankedTitleMaxW`, separate from the common `titleMaxW` so unranked
 *   portrait stays byte-identical) + a bottom-band height cap (25% CH) so
 *   tall marks never swallow the meta column. 100 is the scale-control base
 *   (percent of the cap chain, never 100% of the canvas); 150/200 enlarge
 *   the caps by the same % until the genuine canvas limit.
 * - Untouched bytes: Fresh landscape ranked, unranked both shapes, Standard
 *   both shapes (pinned to the pre-task hashes from
 *   poster-fresh-unranked.test.ts). No new params, no client renderer fork
 *   (preview hits the same endpoint), missing/hidden logo unchanged.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import {
  composeFreshOverlay,
  fitFreshTitleLogo,
  freshGeometry,
  type FreshMetaInput,
} from "@/lib/fresh-layout"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

// Pre-task pins (source: poster-fresh-unranked.test.ts — captured 2026-10-08
// from the unmodified renderer with the same helpers/inputs). Unranked both
// shapes and Standard both shapes MUST still match; ranked portrait
// INTENTIONALLY moves (updated pin below, see NEW_RANKED_PORTRAIT); ranked
// landscape is re-pinned by task8b (left-blur band, same value as
// poster-fresh-unranked.test.ts — identical inputs, identical bytes).
const PRE_RANKED_PORTRAIT = "1fa71a22783ee98a0fe033e5f8ebdd8dd443336ee2992f286980af90330c2f90"
// Task15 gentle-polish candidate (visually independently reviewed + approved:
// rim border opacity 95->80 / 80->68, blur feather 16->32 gamma 1.3; samples
// in C:\Users\lucaf\AppData\Local\Temp\opencode\task15\{before,after}\):
// the RANKED LANDSCAPE pin below is RE-PINNED (was
// a4388308d0a4d3474f251bf01858154764171cac1ae3b648b93f2f3b835c8310 —
// identical inputs/bytes as poster-fresh-unranked.test.ts); unranked and
// Standard pins below untouched.
// Task16/Task18 reconstructed-band candidate (user-approved "mi piace lasciamo
// 6": 6% background shift with the lossless c1 correction — one RGBA decode,
// one PNG encode, shifted region pixel-identical; Task15 gentle polish kept;
// before/after samples in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task18\contacts\{fourpct,sixpct}\,
// evidence in C:\Users\lucaf\AppData\Local\Temp\opencode\task18-evidence.txt):
// the RANKED LANDSCAPE pin below is RE-PINNED (was
// b1128958ceb2b9b62fc299fa972714ca8a42bbf22ca4af983ca693db8781f26e —
// identical inputs/bytes as poster-fresh-unranked.test.ts landscape pin,
// which moves identically); unranked and Standard pins below untouched
// (verified by the suites pinning them).
const PRE_RANKED_LANDSCAPE = "c504aab7722ba206cd6a23711a71b8beb78358411e9bcc97f5a3754af535d48c"
// Task8a2 BEFORE hashes (captured with the pre-task8a2 fresh-layout via the
// same helpers/inputs as this file — task8a2/before-unranked-*.sha): the
// pre-task4 pins below are historic references only (task4 moved the meta
// block to the bottom, so current unranked bytes intentionally differ from
// them). These task8a2 pins are the true byte-identity guards: the task8a2
// change touches ranked portrait ONLY, so after-bytes must equal them.
// Task9 landscape-title fix (intentional graphic change, user-reported
// "loghi landscape fresh enormi", reviewed before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task9\{before,after}\): the
// landscape Fresh title base slot is the historic 40% CW / 24% CH logo bound
// again (was the full right-of-column slot, 0.634 CW uncapped — wordmark
// 487x162, tall mark 400x400 raw). BOTH landscape Fresh pins move
// (PRE_RANKED_LANDSCAPE, TASK8A2_BEFORE_UNRANKED_LANDSCAPE); ranked portrait,
// portrait unranked and Standard pins below are untouched.
// Task12 tall/narrow numerals (intentional graphic change, user-approved
// "originale, numerise brano allungati vero?", reviewed before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task12\): the RANKED LANDSCAPE
// pin below is RE-PINNED (was 101a… — identical inputs/bytes as
// poster-fresh-unranked.test.ts); unranked and Standard pins below untouched.
const TASK8A2_BEFORE_UNRANKED_PORTRAIT = "e1e4b228a05e29c6d9a5509c4b7769a1be7808c1456e2d6592b23803e7255359"
const TASK8A2_BEFORE_UNRANKED_LANDSCAPE = "959f0b9aa491031004fa68c812f0323bd1024ff270c913633306bfc73a060429"
const PRE_STANDARD_PORTRAIT = "2a66d52502b85186cb9c194601700b651b4c6c0b113e3316dba58c936e28a2a3"
const PRE_STANDARD_LANDSCAPE = "3bcfe823d2a6bee45c475b0dfe15b5483bd3289c4e235b0392555c9464b857ab"

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

/** Wide wordmark fixture (600x200, real-repo title art unavailable offline):
 *  white bold "TED LASSO"-style two-word stack on transparent. */
async function wordmarkLogo(): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">` +
    `<text x="300" y="88" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="900" fill="#ffffff" letter-spacing="4">TED LASSO</text>` +
    `<text x="300" y="158" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#ffffff" letter-spacing="10">RICHMOND</text>` +
    `</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function tallLogo(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 400, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

async function largeTitle(): Promise<Buffer> {
  return sharp({
    create: { width: 900, height: 360, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

async function redProvider(): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 120, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
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
    finalRank: 6,
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

function metaInput(overrides: Partial<FreshMetaInput> = {}): FreshMetaInput {
  return {
    badgesEnabled: true,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    separateRatingsEnabled: false,
    separateRatingsStyle: "column",
    customRatingsEnabled: false,
    genreName: "Dramma",
    year: "2024",
    voteAverage: 8.3,
    separateRatings: undefined,
    customRatings: undefined,
    ...overrides,
  }
}

async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(buf).metadata()
  return { w: meta.width ?? 0, h: meta.height ?? 0 }
}

async function layerDims(layer: { input: Buffer }): Promise<{ w: number; h: number }> {
  const m = await sharp(layer.input).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0 }
}

describe("ranked-portrait title geometry (pure)", () => {
  it("exposes a separate full-width cap, larger than the common slot, with the same bottom margin", () => {
    const geo = freshGeometry(STD_W, STD_H, 6)
    expect(geo.isPortrait).toBe(true)
    const expectedSide = Math.round(STD_W * 0.055)
    expect(geo.rankedTitleMaxW).toBe(STD_W - expectedSide * 2)
    // Common slot untouched (unranked portrait + every other consumer).
    const expectedCommon = Math.max(40, STD_W - geo.zoneW - geo.titleRight - 16)
    expect(geo.titleMaxW).toBe(expectedCommon)
    expect(geo.rankedTitleMaxW).toBeGreaterThan(geo.titleMaxW)
    // ~5-6% margins each side.
    expect(expectedSide / STD_W).toBeGreaterThanOrEqual(0.05)
    expect(expectedSide / STD_W).toBeLessThanOrEqual(0.06)
    // Bottom margin preserved.
    expect(geo.titleBottom).toBe(Math.round(STD_H * 0.04))
    // Height cap = bottom band (25% CH).
    expect(geo.rankedTitleMaxH).toBe(Math.round(STD_H * 0.25))
  })

  it("keeps the common title slot formula identical on every shape (unranked-safe)", () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const rank of [1, 6, 20, null]) {
        const geo = freshGeometry(CW, CH, rank)
        expect(geo.titleMaxW).toBe(Math.max(40, CW - geo.zoneW - geo.titleRight - 16))
        expect(geo.titleRight).toBe(Math.round(CW * 0.045))
        expect(geo.titleBottom).toBe(Math.round(CH * 0.04))
      }
    }
  })
})

describe("ranked-portrait title placement (compositor)", () => {
  it("centers the title on the bottom anchor at neutral offsets (rank 6)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const geo = freshGeometry(STD_W, STD_H, 6)
    const layers = await composeFreshOverlay({
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    })
    // Ranked layers: strip, shade, numeral, meta, provider, logo (task8b
    // inserts the left-blur band under the shade, before the numeral).
    expect(layers).toHaveLength(6)
    const title = layers[layers.length - 1]
    const size = await layerDims(title)
    // Small fixture passes the fit through: only the anchor moves.
    expect(size).toEqual({ w: 220, h: 100 })
    expect(title.left).toBe(Math.round((STD_W - size.w) / 2))
    expect(title.top).toBe(STD_H - size.h - geo.titleBottom)
    // Historic bottom-right anchor would be elsewhere (no silent fallback).
    expect(title.left).not.toBe(STD_W - size.w - geo.titleRight)
  })

  it("centers rank 1 and rank 20 portraits with no layer leaving the canvas", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const rank of [1, 20]) {
      const geo = freshGeometry(STD_W, STD_H, rank)
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW: STD_W,
        CH: STD_H,
        rank,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      })
      const title = layers[layers.length - 1]
      const size = await layerDims(title)
      expect(title.left).toBe(Math.round((STD_W - size.w) / 2))
      expect(title.top).toBe(STD_H - size.h - geo.titleBottom)
      for (const layer of layers) {
        const m = await layerDims(layer)
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left + m.w).toBeLessThanOrEqual(STD_W)
        expect(layer.top + m.h).toBeLessThanOrEqual(STD_H)
      }
    }
  }, 120000)

  it("fits the wide wordmark larger than the old slot, still centered and bottom-anchored", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const wordmark = await wordmarkLogo()
    const wmMeta = await sharp(wordmark).metadata()
    const ww = wmMeta.width ?? 600
    const wh = wmMeta.height ?? 200
    const geo = freshGeometry(STD_W, STD_H, 3)
    const layers = await composeFreshOverlay({
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 3,
      meta: metaInput(),
      logo: { png: wordmark, w: ww, h: wh },
      provider: null,
    })
    const title = layers[layers.length - 1]
    const size = await layerDims(title)
    // Old slot would shrink it to titleMaxW; the new cap is wider.
    const oldFit = await fitFreshTitleLogo({ png: wordmark, w: ww, h: wh }, geo.titleMaxW, STD_H)
    expect(size.w).toBeGreaterThan(oldFit.w)
    expect(size.w).toBeLessThanOrEqual(geo.rankedTitleMaxW)
    expect(title.left).toBe(Math.round((STD_W - size.w) / 2))
    expect(title.top).toBe(STD_H - size.h - geo.titleBottom)
  }, 120000)

  it("bounds tall marks in the bottom band instead of swallowing the column", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const tall = await tallLogo()
    const geo = freshGeometry(STD_W, STD_H, 6)
    const layers = await composeFreshOverlay({
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6,
      meta: metaInput(),
      logo: { png: tall, w: 400, h: 400 },
      provider: null,
    })
    const title = layers[layers.length - 1]
    const size = await layerDims(title)
    expect(size.h).toBeLessThanOrEqual(geo.rankedTitleMaxH)
    expect(size.h).toBeLessThanOrEqual(Math.round(STD_H * 0.25))
    expect(title.left).toBe(Math.round((STD_W - size.w) / 2))
    expect(title.top).toBe(STD_H - size.h - geo.titleBottom)
  }, 120000)

  it("applies user X/Y exactly once (delta-exact, bitmap identical)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6 as const,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    }
    const ref = await composeFreshOverlay(base)
    const moved = await composeFreshOverlay({
      ...base,
      transforms: { logoOffsetX: 10, logoOffsetY: -10 },
    })
    const refTitle = ref[ref.length - 1]
    const movedTitle = moved[moved.length - 1]
    expect(movedTitle.left).toBe(refTitle.left + 10)
    expect(movedTitle.top).toBe(refTitle.top - 10)
    expect((movedTitle.input as Buffer).equals(refTitle.input as Buffer)).toBe(true)
  }, 120000)

  it("grows the centered title monotonically 50/100/150 until the genuine canvas limit", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const big = await largeTitle()
    const provider = await redProvider()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6 as const,
      meta: metaInput(),
      logo: { png: big, w: 900, h: 360 },
      provider: { png: provider, w: 300, h: 120 },
    }
    const sizes: { w: number; h: number }[] = []
    for (const s of [50, 100, 150, 200] as const) {
      const layers = await composeFreshOverlay({ ...base, transforms: { logoScale: s } })
      const title = layers[layers.length - 1]
      const size = await layerDims(title)
      sizes.push(size)
      expect(title.left).toBe(Math.round((STD_W - size.w) / 2))
      expect(title.left).toBeGreaterThanOrEqual(0)
      expect(title.left + size.w).toBeLessThanOrEqual(STD_W)
      expect(title.top + size.h).toBeLessThanOrEqual(STD_H)
    }
    // Strict growth until the canvas edge binds (documented genuine limit).
    expect(sizes[1].w).toBeGreaterThan(sizes[0].w)
    expect(sizes[2].w).toBeGreaterThan(sizes[1].w)
    expect(sizes[3].w).toBeGreaterThanOrEqual(sizes[2].w)
    if (sizes[3].w === sizes[2].w) expect(sizes[2].w).toBe(STD_W)
  }, 120000)

  it("renders ranked portrait without a logo (no throw, canvas dims, meta intact)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const provider = await redProvider()
    const layers = await composeFreshOverlay({
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6,
      meta: metaInput(),
      logo: null,
      provider: { png: provider, w: 300, h: 120 },
    })
    // Strip + shade + numeral + meta + provider, no title layer.
    expect(layers).toHaveLength(5)
  }, 60000)
})

describe("ranked-portrait title (service)", () => {
  it("renders 100/150/200 with the centered title larger than the old slot render", async () => {
    const big = await largeTitle()
    const full = {
      posterBuf: await patternedBase(STD_W, STD_H),
      logoFetch: big,
      posterLayout: "fresh" as const,
      shape: "poster" as const,
      rankingEnabled: true,
      finalRank: 3,
    }
    const b100 = await generatePosterBuffer(baseInput(full))
    const b150 = await generatePosterBuffer(baseInput({ ...full, logoScale: 150 }))
    const b200 = await generatePosterBuffer(baseInput({ ...full, logoScale: 200 }))
    for (const b of [b100, b150, b200]) expect(await dims(b)).toEqual({ w: STD_W, h: STD_H })
    expect(b150.equals(b100)).toBe(false)
    // 100 default is the scale-control base (byte-identical to explicit 100).
    expect(sha(b100)).toBe(sha(await generatePosterBuffer(baseInput({ ...full, logoScale: 100 }))))
  }, 240000)

  it("keeps logo X/Y offsets visibly adjusting the centered title", async () => {
    const logo = await whiteLogo()
    const full = {
      posterBuf: await patternedBase(STD_W, STD_H),
      logoFetch: logo,
      posterLayout: "fresh" as const,
      shape: "poster" as const,
      rankingEnabled: true,
      finalRank: 6,
    }
    const ref = await generatePosterBuffer(baseInput(full))
    expect((await generatePosterBuffer(baseInput({ ...full, logoOffsetX: 30 }))).equals(ref)).toBe(false)
    expect((await generatePosterBuffer(baseInput({ ...full, logoOffsetY: 30 }))).equals(ref)).toBe(false)
  }, 180000)
})

describe("preservation pins (landscape ranked, unranked both shapes, standard both shapes)", () => {
  it("keeps landscape ranked + standard renders byte-identical to pre-task", async () => {
    const logo = await whiteLogo()
    const rankedL = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(LAND_W, LAND_H),
        shape: "landscape",
        logoFetch: logo,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 5,
        genreName: "Dramma",
        networkLogo: true,
        tmdbNetworks: ["Netflix"],
      }),
    )
    expect(await dims(rankedL)).toEqual({ w: LAND_W, h: LAND_H })
    expect(sha(rankedL)).toBe(PRE_RANKED_LANDSCAPE)
    const stdP = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(STD_W, STD_H),
        logoFetch: logo,
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    expect(sha(stdP)).toBe(PRE_STANDARD_PORTRAIT)
    const stdL = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(LAND_W, LAND_H),
        shape: "landscape",
        logoFetch: logo,
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    expect(sha(stdL)).toBe(PRE_STANDARD_LANDSCAPE)
  }, 180000)

  it("keeps unranked Fresh both shapes byte-identical to pre-task", async () => {
    const logo = await whiteLogo()
    for (const [W, H, shape, pin] of [
      [STD_W, STD_H, "poster", TASK8A2_BEFORE_UNRANKED_PORTRAIT],
      [LAND_W, LAND_H, "landscape", TASK8A2_BEFORE_UNRANKED_LANDSCAPE],
    ] as const) {
      const buf = await generatePosterBuffer(
        baseInput({
          posterBuf: await patternedBase(W, H),
          logoFetch: logo,
          posterLayout: "fresh" as const,
          posterFreshScope: "all" as const,
          shape,
          rankingEnabled: false,
          finalRank: null,
          genreName: "Dramma",
          networkLogo: true,
          tmdbNetworks: ["Netflix"],
        }),
      )
      expect(await dims(buf)).toEqual({ w: W, h: H })
      expect(sha(buf)).toBe(pin)
    }
  }, 180000)

  it("records the intentional ranked-portrait change (differs from pre-task, evidence hash)", async () => {
    const logo = await whiteLogo()
    const buf = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(STD_W, STD_H),
        logoFetch: logo,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
        genreName: "Dramma",
        networkLogo: true,
        tmdbNetworks: ["Netflix"],
      }),
    )
    expect(await dims(buf)).toEqual({ w: STD_W, h: STD_H })
    expect(sha(buf)).not.toBe(PRE_RANKED_PORTRAIT)
    console.log(`[task8a2] new ranked-portrait bytes sha=${sha(buf)}`)
  }, 120000)
})

describe("task8a2 evidence samples (approved temp only, never the repo)", () => {
  it("writes ranked-portrait 100/150/200 + preservation samples", async () => {
    const outDir = "C:/Users/lucaf/AppData/Local/Temp/opencode/task8a2"
    await mkdir(outDir, { recursive: true })
    const wordmark = await wordmarkLogo()
    const rankedBase = {
      posterBuf: await patternedBase(STD_W, STD_H),
      logoFetch: wordmark,
      posterLayout: "fresh" as const,
      shape: "poster" as const,
      rankingEnabled: true,
      finalRank: 3,
      genreName: "Dramma",
      networkLogo: true,
      tmdbNetworks: ["Netflix"],
    }
    for (const scale of [100, 150, 200] as const) {
      const buf = await generatePosterBuffer(baseInput({ ...rankedBase, logoScale: scale }))
      await writeFile(`${outDir}/ranked-portrait-${scale}.jpg`, buf)
    }
    const logo = await whiteLogo()
    const landscape = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(LAND_W, LAND_H),
        shape: "landscape",
        logoFetch: logo,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 5,
        genreName: "Dramma",
        networkLogo: true,
        tmdbNetworks: ["Netflix"],
      }),
    )
    await writeFile(`${outDir}/landscape-ranked.jpg`, landscape)
    for (const [W, H, shape, name] of [
      [STD_W, STD_H, "poster", "unranked-portrait"],
      [LAND_W, LAND_H, "landscape", "unranked-landscape"],
    ] as const) {
      const buf = await generatePosterBuffer(
        baseInput({
          posterBuf: await patternedBase(W, H),
          logoFetch: logo,
          posterLayout: "fresh" as const,
          posterFreshScope: "all" as const,
          shape,
          rankingEnabled: false,
          finalRank: null,
          genreName: "Dramma",
          networkLogo: true,
          tmdbNetworks: ["Netflix"],
        }),
      )
      await writeFile(`${outDir}/${name}.jpg`, buf)
    }
    const std = await generatePosterBuffer(
      baseInput({ posterBuf: await patternedBase(STD_W, STD_H), logoFetch: logo, rankingEnabled: true, finalRank: 6 }),
    )
    await writeFile(`${outDir}/standard-portrait.jpg`, std)
    console.log(`[task8a2] samples written to ${outDir}`)
  }, 300000)
})
