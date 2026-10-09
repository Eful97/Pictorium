/**
 * Fresh unranked composition (task4 + task6 network-above-meta reversal):
 * posters WITHOUT a valid rank move the genre/rating block to the bottom
 * content area beside the title logo, with the network mark ABOVE THE META
 * BLOCK (centered on it with the column gap — user explicitly reverted the
 * above-title anchor). Logo-less fallback keeps the network above the meta
 * block; without meta rows it falls back above the title logo. Ranked Fresh
 * renders the task8b left-blur band (sha256 re-pinned below with rationale);
 * standard stays untouched.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import {
  freshGeometry,
  freshMetaRows,
  composeFreshOverlay,
  freshUnrankedPlacement,
  type FreshMetaInput,
} from "@/lib/fresh-layout"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { RatingItem } from "@/lib/custom-rating/types"

// Pretask baseline hashes (captured 2026-10-08 from the unmodified renderer,
// same helpers/inputs as below — see C:\Users\lucaf\AppData\Local\Temp\opencode\task4-baseline\hashes.json).
// Task5 numeral fix (intentional graphic change, reviewed): the ranked
// numeral dropped its raw outline stroke (internal seams on "4") and its
// estimate-sized canvas (right-edge clipping on 4/6/8/9/20) for a
// silhouette-derived rim + measured-ink crop. Evidence: seamless "4"
// (0.00% interior rim alpha vs 17.9% before), real ink margins ≥4px for all
// ranks 1..100 on both shapes, zero edge-clipped pixels on full numeral
// layers, contact sheet + portrait 4/9/20 and landscape 9/20 samples in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task5-contact-portrait-1-20.jpg
// and task5-sample-*.png. Unranked/standard hashes below are untouched.
// Task8a title-logo fix (intentional graphic change, user "logo fresh al
// 100%", reviewed): the effective-Fresh auto title scale is 100, not the
// aspect curve (63 for the 220x100 fixture), and the standard format caps no
// longer bind the Fresh title (single fit into the Fresh title cap, same
// path for auto and explicit — auto == explicit100 byte-identical, verified
// in poster-fresh-title-logo.test.ts). Only the LANDSCAPE ranked hash moves
// (cb63…); portrait is unchanged (both old-63 and new-100 hit the same
// 218px title cap), proving no other drift. Samples + hashes:
// C:\Users\lucaf\AppData\Local\Temp\opencode\task8a\ (fresh-title-*.png:
// previous-auto explicit63 vs new auto == explicit100, both shapes).
// Standard/unranked hashes below are untouched.
// Task8a2 centered-title fix (intentional graphic change, user-approved
// composition, reviewed PNGs in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task8a2\ranked-portrait-*.jpg):
// the RANKED PORTRAIT title logo is now bottom-CENTERED spanning the usable
// canvas width (~5.5% side margins, 25% CH height cap for tall marks) instead
// of the historic bottom-right slot (~0.44 CW). Only that pin moves;
// landscape ranked, unranked and standard pins below are untouched.
// Task8b left-blur band (intentional graphic change, user-approved "parte
// dalla parte sinistra e termina quando finisce il numero", reviewed PNGs in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task8b\ranked-{portrait,landscape}-{band-only,full}.jpg):
// RANKED Fresh (both shapes) now composites a full-height left artwork band
// (single sigma-9 blur, smooth horizontal alpha: opaque at the canvas left,
// exactly 0 at the measured numeral ink right + 16px feather) UNDER the
// fresh shade, before the numeral. Only the two ranked pins move; unranked
// and standard pins below are untouched. Isolation proof: with the band
// push disabled the pre-task ranked pins pass byte-identical (12/12), so the
// band is the sole delta — no other drift.
// Task9 landscape-title fix (intentional graphic change, user-reported
// "loghi landscape fresh enormi", reviewed before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task9\{before,after}\): the
// landscape Fresh title base slot is the historic 40% CW / 24% CH logo bound
// again (was the full right-of-column slot, 0.634 CW uncapped — wordmark
// 487x162, tall mark 400x400 raw). Only the LANDSCAPE ranked pin moves;
// portrait, unranked and standard pins below are untouched.
// Task10 portrait rank shift (intentional graphic change, user-approved
// "-90px lato Y precisamente", reviewed before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task10\before|after-portrait-{3,10}.png):
// the RANKED PORTRAIT numeral anchors 90 logical canvas px higher
// (`FRESH_PORTRAIT_RANK_Y_SHIFT`, 120 → 30 @500x750, before the user `toy`;
// landscape 0). The ranked meta/provider/blur follow the new anchor by the
// pre-existing rules. Only the PORTRAIT ranked pin moves; reconstruction
// proof: new code with `topBadgeOffsetY: 90` reproduces the old pin below
// byte-identically (5820…), so the delta is exactly the -90 translation.
// Landscape ranked, unranked and standard pins below are untouched.
// Task12 tall/narrow numerals (intentional graphic change, user-approved
// "originale, numerise brano allungati vero?", reviewed before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task12\before|after-contact-{portrait,landscape}-1-20.jpg
// and task12-{before,after}-full-{portrait-4/9/10/20,landscape-10/20}.png):
// the shared SVG glyph source condenses horizontally
// (`FRESH_NUMERAL_CONDENSE_X = 0.6`, x origin pre-compensated — mask, rim
// ring and references stay in sync, artwork ROI samples the final
// transformed ink) and the portrait cap height rises to ~0.33 CH (248px
// @500x750, metaTop 30 → 300 by the existing chain); landscape keeps its
// height, only narrower. BOTH ranked pins move; unranked and standard pins
// below are untouched (verified by the suites pinning them).
// Task12 correction c1 (user-approved "ok proviamo" / "solo verticale
// landscape va bene", before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task12-c1-{before,after}-{portrait-9/10/20,landscape-10,contact-1-20}.png
// + task12-c1-after-full-portrait-ranked6-net.png): portrait condenses to 70%
// of CURRENT width (0.42 of natural, height/baseline untouched), so ONLY the
// ranked PORTRAIT pin below moves again (5d1a… → 93dca6…); ranked landscape,
// unranked and standard pins stay byte-identical (verified).
// Task12 correction c2 (latest user constraint "si schiacciano tutti. io
// voglio che si schiaccino solo dal 10 in poi", superseding c1): ONLY
// portrait ranks >= 10 keep the 0.42 squeeze — portrait singles (1..9, here
// rank 6) render at the pre-c1 task12 baseline 0.6 again, so the ranked
// PORTRAIT pin below is RESTORED to its pre-c1 value (93dca6… → 5d1a…,
// byte-identical to the task12 state; contact portrait 1..20 + full 9/10/20
// in C:\Users\lucaf\AppData\Local\Temp\opencode\task12-c2\); the ranked
// LANDSCAPE pin stays byte-identical (verified c1, re-verified c2).
// Task15 gentle-polish candidate (visually independently reviewed + approved:
// rim border opacity 95->80 / 80->68, blur feather 16->32 gamma 1.3; samples
// in C:\Users\lucaf\AppData\Local\Temp\opencode\task15\{before,after}\):
// BOTH ranked pins below are RE-PINNED (portrait was
// 5d1a4ba930fe2e5e5ee1e6381617aa618d2f008fd592c1245d18576315657755;
// landscape was
// a4388308d0a4d3474f251bf01858154764171cac1ae3b648b93f2f3b835c8310 —
// identical inputs/bytes as poster-fresh-centered-title.test.ts landscape
// pin); unranked and standard pins below are untouched (verified by the
// suites pinning them).
// Task16/Task18 reconstructed-band candidate (user-approved "mi piace lasciamo
// 6": 6% background shift with the lossless c1 correction — one RGBA decode,
// one PNG encode, shifted region pixel-identical; Task15 gentle polish kept;
// before/after samples in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task18\contacts\{fourpct,sixpct}\,
// evidence in C:\Users\lucaf\AppData\Local\Temp\opencode\task18-evidence.txt):
// BOTH ranked pins below are RE-PINNED (portrait was
// 901f116f3855649e17da7691c75d15ee501b5770dc44fde460a2bb4deb266b55;
// landscape was
// b1128958ceb2b9b62fc299fa972714ca8a42bbf22ca4af983ca693db8781f26e —
// identical inputs/bytes as poster-fresh-centered-title.test.ts landscape
// pin); unranked and standard pins below are untouched (verified by the
// suites pinning them).
const PRE_RANKED_PORTRAIT = "3fe42bb095d84b11ad340e513bba9e2e4827c5656a334c133e814c53ca5fd67c"
const PRE_RANKED_LANDSCAPE = "c504aab7722ba206cd6a23711a71b8beb78358411e9bcc97f5a3754af535d48c"
const PRE_UNRANKED_PORTRAIT = "9167e67cf8174efea64dad431d7b2d1765e07031f3cbef5c2e8e6ccc441e5a11"
const PRE_UNRANKED_LANDSCAPE = "2a9adbec71d8a3da7a00cc377ea611036829cc77a32c33de1bd442142d9b17e2"
const PRE_STANDARD_PORTRAIT = "2a66d52502b85186cb9c194601700b651b4c6c0b113e3316dba58c936e28a2a3"
const PRE_STANDARD_LANDSCAPE = "3bcfe823d2a6bee45c475b0dfe15b5483bd3289c4e235b0392555c9464b857ab"

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

/** Deterministic patterned artwork (same builder as the baseline capture). */
async function patternedBase(w: number, h: number, flip = false): Promise<Buffer> {
  const c1 = flip ? "#7a2e2e" : "#2e4a7a"
  const c2 = flip ? "#2e7a4a" : "#7a6a2e"
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3a3f55"/><stop offset="1" stop-color="#141827"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#p)"/>` +
    `<rect x="${Math.round(w * 0.55)}" y="0" width="${Math.round(w * 0.45)}" height="${h}" fill="${c1}" opacity="0.85"/>` +
    `<circle cx="${Math.round(w * 0.25)}" cy="${Math.round(h * 0.3)}" r="${Math.round(w * 0.18)}" fill="${c2}" opacity="0.9"/>` +
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
    rankingEnabled: false,
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

function customItems(n: number): RatingItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Provider ${i}`,
    value: 9 - i * 0.3,
    format: "decimal" as const,
  }))
}

async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(buf).metadata()
  return { w: meta.width ?? 0, h: meta.height ?? 0 }
}

/** Count near-white (text ink) pixels inside a band of a finished render. */
async function brightInk(
  buf: Buffer,
  box: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const { data, info } = await sharp(buf)
    .extract(box)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const ch = info.channels
  let n = 0
  for (let i = 0; i < data.length; i += ch) {
    if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] > 180) n++
  }
  return n
}

describe("ranked Fresh pins (re-pinned by the task8b left-blur band — rationale above)", () => {
  it("keeps ranked portrait + landscape renders unchanged", async () => {
    const logo = await whiteLogo()
    const rankedP = await generatePosterBuffer(
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
    expect(await dims(rankedP)).toEqual({ w: STD_W, h: STD_H })
    expect(sha(rankedP)).toBe(PRE_RANKED_PORTRAIT)
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
  }, 120000)
})

describe("standard output untouched", () => {
  it("keeps standard portrait + landscape renders unchanged", async () => {
    const logo = await whiteLogo()
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
  }, 120000)
})

describe("unranked bottom composition (layers)", () => {
  it("places meta bottom-right beside the logo, provider above the meta block, both shapes", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const geo = freshGeometry(CW, CH, null)
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW,
        CH,
        rank: null,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      })
      // Shade + meta + provider + logo, in that z-order.
      expect(layers).toHaveLength(4)
      const [shade, meta, prov, title] = layers
      expect(shade.top).toBe(0)
      expect(shade.left).toBe(0)
      const metaMeta = await sharp(meta.input).metadata()
      const provMeta = await sharp(prov.input).metadata()
      const logoMeta = await sharp(title.input).metadata()
      const metaW = metaMeta.width ?? 0
      const metaH = metaMeta.height ?? 0
      const provW = provMeta.width ?? 0
      const provH = provMeta.height ?? 0
      const logoW = logoMeta.width ?? 0
      const logoH = logoMeta.height ?? 0
      // Title logo keeps the historic bottom-right anchor.
      expect(title.left).toBe(CW - logoW - geo.titleRight)
      expect(title.top).toBe(CH - logoH - geo.titleBottom)
      // Meta block bottom-anchored beside the logo (never overlapping it).
      expect(meta.top + metaH).toBe(CH - geo.titleBottom)
      expect(meta.left + metaW).toBeLessThanOrEqual(title.left - 16)
      expect(meta.top).toBeGreaterThan(CH / 2)
      // Provider above the meta block (user reversal, NOT above the title):
      // bottom exactly at the meta top minus the column gap, centered on
      // the meta block, never overlapping it.
      const providerGap = Math.round(geo.metaGap * 0.8)
      expect(prov.top + provH).toBe(meta.top - providerGap)
      const metaCX = meta.left + metaW / 2
      const provCX = prov.left + provW / 2
      expect(Math.abs(provCX - metaCX)).toBeLessThanOrEqual(1)
      // Every layer inside the canvas.
      for (const layer of layers) {
        const m = await sharp(layer.input).metadata()
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left + (m.width ?? 0)).toBeLessThanOrEqual(CW)
        expect(layer.top + (m.height ?? 0)).toBeLessThanOrEqual(CH)
      }
    }
  }, 120000)

  it("treats absent/disabled/invalid rank identically (no invented numeral)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    }
    const ref = await composeFreshOverlay({ ...base, rank: null })
    for (const rank of [0, -3, 6.5, NaN, 101] as const) {
      const layers = await composeFreshOverlay({ ...base, rank })
      expect(layers).toHaveLength(ref.length)
      for (let i = 0; i < layers.length; i++) {
        expect(layers[i].top).toBe(ref[i].top)
        expect(layers[i].left).toBe(ref[i].left)
        expect((layers[i].input as Buffer).equals(ref[i].input as Buffer)).toBe(true)
      }
    }
  }, 120000)

  it("keeps the bottom block with hidden/missing logo (canvas-margin aligned)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const provider = await redProvider()
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const geo = freshGeometry(CW, CH, null)
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW,
        CH,
        rank: null,
        meta: metaInput(),
        logo: null,
        provider: { png: provider, w: 300, h: 120 },
      })
      expect(layers).toHaveLength(3)
      const meta = layers[1]
      const prov = layers[2]
      const metaMeta = await sharp(meta.input).metadata()
      const provMeta = await sharp(prov.input).metadata()
      const metaW = metaMeta.width ?? 0
      const metaH = metaMeta.height ?? 0
      const provH = provMeta.height ?? 0
      // Bottom-anchored, right-aligned to the canvas margin (no logo).
      expect(meta.top + metaH).toBe(CH - geo.titleBottom)
      expect(meta.left + metaW).toBe(CW - geo.titleRight)
      // Network still above genre.
      expect(prov.top + provH).toBeLessThanOrEqual(meta.top)
    }
  }, 120000)

  it("keeps the bottom block with missing provider and with all toggles off", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    // No provider: meta still bottom-anchored beside the logo.
    const noProv = await composeFreshOverlay({
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: null,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: null,
    })
    expect(noProv).toHaveLength(3)
    const geo = freshGeometry(STD_W, STD_H, null)
    const metaMeta = await sharp(noProv[1].input).metadata()
    expect(noProv[1].top + (metaMeta.height ?? 0)).toBe(STD_H - geo.titleBottom)
    // All metadata toggles off + no logo + no provider: shade only.
    const empty = await composeFreshOverlay({
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: null,
      meta: metaInput({ badgesEnabled: false }),
      logo: null,
      provider: null,
    })
    expect(empty).toHaveLength(1)
    expect(empty[0].top).toBe(0)
    // Provider alone (no meta rows): bottom-anchored to the block edge.
    const provider = await redProvider()
    const provOnly = await composeFreshOverlay({
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: null,
      meta: metaInput({ badgesEnabled: false }),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    })
    expect(provOnly).toHaveLength(3)
    const provMeta = await sharp(provOnly[1].input).metadata()
    expect(provOnly[1].top + (provMeta.height ?? 0)).toBeLessThanOrEqual(STD_H - geo.titleBottom)
  }, 120000)

  it("keeps max rows + long text + custom/separate ratings in canvas (both shapes)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW,
        CH,
        rank: null,
        meta: {
          ...metaInput({
            genreName: "Supercalifragilistiche-spiralidoso Documentary Feature Film",
            separateRatingsEnabled: true,
            separateRatings: [
              { id: "imdb", value: 8.7 },
              { id: "tmdb", value: 7.9 },
              { id: "tomatoes", value: 8.8 },
            ],
            customRatingsEnabled: true,
            customRatings: customItems(6),
          }),
        },
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      })
      expect(layers.length).toBeGreaterThan(1)
      for (const layer of layers) {
        const m = await sharp(layer.input).metadata()
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left + (m.width ?? 0)).toBeLessThanOrEqual(CW)
        expect(layer.top + (m.height ?? 0)).toBeLessThanOrEqual(CH)
      }
      // Meta rows still render (custom priority over separate, capped).
      const rows = freshMetaRows(
        metaInput({
          genreName: "Dramma",
          separateRatingsEnabled: true,
          separateRatings: [
            { id: "imdb", value: 8.7 },
            { id: "tmdb", value: 7.9 },
          ],
          customRatingsEnabled: true,
          customRatings: customItems(2),
        }),
      )
      expect(rows.filter((r) => r.kind === "custom")).toHaveLength(2)
      expect(rows.some((r) => r.kind === "separate")).toBe(false)
    }
  }, 120000)
})

describe("unranked placement geometry (pure)", () => {
  it("anchors logo historic, meta beside it, provider above the meta block", () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const geo = freshGeometry(CW, CH, null)
      const place = freshUnrankedPlacement(
        geo,
        { logoW: 220, logoH: 100, metaW: geo.zoneW, metaH: 120, providerW: 100, providerH: 40 },
        { hasLogo: true, hasMeta: true, hasProvider: true },
      )
      // Logo anchor identical to the ranked anchor formula.
      expect(place.logoLeft).toBe(CW - 220 - geo.titleRight)
      expect(place.logoTop).toBe(CH - 100 - geo.titleBottom)
      // Meta bottom-anchored, right edge exactly logo-left minus the gap.
      expect(place.metaTop + 120).toBe(CH - geo.titleBottom)
      expect(place.metaLeft + geo.zoneW).toBe(place.logoLeft - 16)
      // Provider bottom exactly at the meta top minus the column gap.
      const providerGap = Math.round(geo.metaGap * 0.8)
      expect(place.providerTop + 40).toBe(place.metaTop - providerGap)
      // Provider centered on the meta block (not on the title logo).
      expect(place.providerLeft + 50).toBe(place.metaLeft + geo.zoneW / 2)
    }
  })

  it("falls back above the title logo when meta rows are missing", () => {
    const geo = freshGeometry(STD_W, STD_H, null)
    const withMeta = freshUnrankedPlacement(
      geo,
      { logoW: 220, logoH: 100, metaW: geo.zoneW, metaH: 120, providerW: 80, providerH: 30 },
      { hasLogo: true, hasMeta: true, hasProvider: true },
    )
    const noMeta = freshUnrankedPlacement(
      geo,
      { logoW: 220, logoH: 100, metaW: 0, metaH: 0, providerW: 80, providerH: 30 },
      { hasLogo: true, hasMeta: false, hasProvider: true },
    )
    // Missing meta never moves the title logo.
    expect(noMeta.logoLeft).toBe(withMeta.logoLeft)
    expect(noMeta.logoTop).toBe(withMeta.logoTop)
    // Without meta rows the provider falls back above the title logo
    // (standard-like gap, centered on the title visible box) — a different
    // anchor than the above-meta placement with rows present.
    const titleGap = Math.round((6 * STD_H) / 570)
    expect(noMeta.providerTop + 30).toBe(noMeta.logoTop - titleGap)
    expect(noMeta.providerLeft + 40).toBe(noMeta.logoLeft + 220 / 2)
    expect(withMeta.providerTop).not.toBe(noMeta.providerTop)
  })

  it("aligns to the canvas margin without a logo", () => {
    const geo = freshGeometry(STD_W, STD_H, null)
    const place = freshUnrankedPlacement(
      geo,
      { logoW: 0, logoH: 0, metaW: geo.zoneW, metaH: 90, providerW: 80, providerH: 30 },
      { hasLogo: false, hasMeta: true, hasProvider: true },
    )
    expect(place.blockRight).toBe(STD_W - geo.titleRight)
    expect(place.metaLeft + geo.zoneW).toBe(STD_W - geo.titleRight)
    expect(place.metaTop + 90).toBe(STD_H - geo.titleBottom)
  })
})

describe("unranked service render", () => {
  it("moves visible ink to the bottom band and changes bytes vs pre-task", async () => {
    const logo = await whiteLogo()
    const portrait = await patternedBase(STD_W, STD_H)
    const full = {
      posterBuf: portrait,
      logoFetch: logo,
      posterLayout: "fresh" as const,
      // Fresh-ALL fixture: guards the no-rank Fresh composition (never the
      // default scope) — see the ranked-default correction.
      posterFreshScope: "all" as const,
      rankingEnabled: false,
      finalRank: null,
      genreName: "Dramma",
      networkLogo: true,
      tmdbNetworks: ["Netflix"],
    }
    const unranked = await generatePosterBuffer(baseInput(full))
    expect(await dims(unranked)).toEqual({ w: STD_W, h: STD_H })
    // The composition changed (no longer the pre-task top-left column).
    expect(sha(unranked)).not.toBe(PRE_UNRANKED_PORTRAIT)
    // Visible ink: the bottom band carries the meta text now — strictly more
    // bright ink than the same render with the meta column disabled.
    const bottomBand = { left: 0, top: Math.round(STD_H * 0.65), width: STD_W, height: STD_H - Math.round(STD_H * 0.65) }
    const withMeta = await brightInk(unranked, bottomBand)
    const noMeta = await generatePosterBuffer(baseInput({ ...full, posterBuf: portrait, badgesEnabled: false }))
    expect(await brightInk(noMeta, bottomBand)).toBeLessThan(withMeta)
    expect(withMeta).toBeGreaterThan(200)
    const landscape = await patternedBase(LAND_W, LAND_H)
    const unrankedLand = await generatePosterBuffer(
      baseInput({ ...full, posterBuf: landscape, shape: "landscape" }),
    )
    expect(await dims(unrankedLand)).toEqual({ w: LAND_W, h: LAND_H })
    expect(sha(unrankedLand)).not.toBe(PRE_UNRANKED_LANDSCAPE)
  }, 120000)

  it("renders invalid/disabled ranks exactly like the absent-rank render", async () => {
    const logo = await whiteLogo()
    const portrait = await patternedBase(STD_W, STD_H)
    const canon = await generatePosterBuffer(
      baseInput({
        posterBuf: portrait,
        logoFetch: logo,
        posterLayout: "fresh",
        // Fresh-ALL fixture (see above): invalid ranks must match the
        // no-rank Fresh composition, not the default-scope Standard.
        posterFreshScope: "all",
        rankingEnabled: false,
        finalRank: null,
      }),
    )
    for (const finalRank of [0, -3, 6.5, 101]) {
      const buf = await generatePosterBuffer(
        baseInput({
          posterBuf: portrait,
          logoFetch: logo,
          posterLayout: "fresh",
          posterFreshScope: "all",
          rankingEnabled: true,
          finalRank,
        }),
      )
      expect(buf.equals(canon)).toBe(true)
    }
    // Ranking on with no data == ranking off: still no invented numeral.
    const noRankOn = await generatePosterBuffer(
      baseInput({
        posterBuf: portrait,
        logoFetch: logo,
        posterLayout: "fresh",
        posterFreshScope: "all",
        rankingEnabled: true,
        finalRank: null,
      }),
    )
    expect(noRankOn.equals(canon)).toBe(true)
  }, 180000)
})
