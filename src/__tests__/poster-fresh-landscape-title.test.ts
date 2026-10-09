/**
 * Fresh LANDSCAPE title base slot (task9, user-reported "loghi landscape
 * fresh enormi" regression).
 *
 * Root cause (evidence, BEFORE numbers from the pre-fix renderer with the
 * same helpers/inputs as this file):
 * - task8a dropped the standard landscape logo caps for effective Fresh, so
 *   auto/explicit 100 sized into the full right-of-column slot
 *   (`titleMaxW = 487` on 768px canvas = 0.634 CW, uncapped height):
 *   a 600x200 wordmark shipped 487x162, a 400x400 mark shipped 400x400 raw
 *   (400px tall on the 432px canvas, top=15).
 * - Historic landscape logo bounds are 40% CW / 24% CH (307x104 — same as
 *   `LANDSCAPE_LOGO_MAX_WIDTH/HEIGHT_PCT` in logo-layout.ts).
 *
 * Contract:
 * - Landscape (RANKED and unranked — common title fix, composition otherwise
 *   untouched): title base slot = 40% CW / 24% CH at 100, scaled by the same
 *   % at 150/200 until the genuine canvas limit (never a static cap that
 *   cancels the user scale). Bottom-right anchor + single X/Y offsets kept.
 * - Portrait ranked (big centered, task8a2) BYTE-UNCHANGED vs the pre-task
 *   baseline, EXCEPT the task10 portrait rank shift (-90px Y calibration):
 *   its pin is re-pinned with before/after samples + toy+90 reconstruction
 *   proof; portrait unranked + Standard both shapes BYTE-UNCHANGED.
 * - Saved explicits (incl. 75) honored; null auto == explicit 100 on both
 *   landscape compositions. No off-canvas at 100 (wide + tall fixtures);
 *   network/title overlap free by default (title stays right of the column).
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

// BEFORE hashes (pre-task9 renderer, same helpers/inputs as this file —
// captured 2026-10-08 via the task9 before-probe; landscape Fresh moves
// INTENTIONALLY, the rest must stay byte-identical).
// Task10 portrait rank shift (user-approved "-90px lato Y precisamente",
// reviewed before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task10\before|after-portrait-{3,10}.png):
// the RANKED PORTRAIT numeral anchors 90 logical canvas px higher
// (`FRESH_PORTRAIT_RANK_Y_SHIFT`, before the user `toy`; landscape 0), so
// the portrait ranked pin below is RE-PINNED (was b3f879ae83e9aade8ec2f8b44d68015a05771bf8a32ffdf4c545970823bd0532 —
// kept here as the task10 evidence value); reconstruction
// proof: new code with `topBadgeOffsetY: 90` reproduces 348e… byte-identically,
// so the delta is exactly the -90 translation. Landscape/standard pins stay.
// Task12 tall/narrow numerals (user-approved "originale, numerise brano
// allungati vero?", reviewed before/after in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task12\before|after-contact-{portrait,landscape}-1-20.jpg):
// the portrait ranked pin below is RE-PINNED again (was b3f8…); only ranked
// Fresh pins move, landscape/standard pins stay.
// Task12 correction c1 (user-approved "ok proviamo" / "solo verticale
// landscape va bene"): portrait glyphs condense to 70% of CURRENT width
// (0.42 of natural; height/baseline untouched) — the portrait ranked pin
// below moves INTENTIONALLY again (was b63616… → 3919b3…, full render +
// before/after masks and contact 1..20 in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task12-c1-after-full-portrait-ranked6.png,
// task12-c1-{before,after}-portrait-{9,10,20}.png,
// task12-c1-{before,after}-contact-1-20.png); landscape/standard pins stay.
// Task12 correction c2 (latest user constraint "si schiacciano tutti. io
// voglio che si schiaccino solo dal 10 in poi", superseding c1): ONLY
// portrait ranks >= 10 keep the 0.42 squeeze — portrait singles (1..9, here
// rank 6) render at the pre-c1 task12 baseline 0.6 again, so the portrait
// ranked pin below is RESTORED to its pre-c1 value (3919b3… → b63616…,
// byte-identical to the task12 state; evidence in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task12-c2\); landscape/standard
// pins stay.
const BEFORE_LAND_RANKED_100 = "ec3b9e39eeccda42239d34c520b671c831636530d4e89890a8034ecbc6280f4b"
const BEFORE_LAND_UNRANKED_100 = "d7cca9877d1cb5c917c74e1fd23bfeb0b7a20b634bc7c77a4e6466c38d131c66"
// Task15 gentle-polish candidate (visually independently reviewed + approved:
// rim border opacity 95->80 / 80->68, blur feather 16->32 gamma 1.3; samples
// in C:\Users\lucaf\AppData\Local\Temp\opencode\task15\{before,after}\):
// the portrait ranked pin below is RE-PINNED (was
// b636163f20ef8d400936d052be6b7c44c2f574003568eabf27dc2e021f98ed7e —
// identical inputs/bytes as poster-fresh-unranked.test.ts portrait baseline
// pre-task15); landscape/standard pins stay.
// Task16/Task18 reconstructed-band candidate (user-approved "mi piace lasciamo
// 6": 6% background shift with the lossless c1 correction — one RGBA decode,
// one PNG encode, shifted region pixel-identical; Task15 gentle polish kept;
// before/after samples in
// C:\Users\lucaf\AppData\Local\Temp\opencode\task18\contacts\{fourpct,sixpct}\,
// evidence in C:\Users\lucaf\AppData\Local\Temp\opencode\task18-evidence.txt):
// the portrait ranked pin below is RE-PINNED (was
// e97e4341c8f0686d56d8e382443a719047db16d5be9cd37a57b62096b8903282 —
// the task15 value); landscape/standard pins stay (verified).
const BEFORE_PORTRAIT_RANKED_TASK12 = "4d63ec4be614332c9dbd8d8af48aff95f463d321039b3728e687f2bcb81224b1"
const BEFORE_STANDARD_PORTRAIT = "2a66d52502b85186cb9c194601700b651b4c6c0b113e3316dba58c936e28a2a3"
const BEFORE_STANDARD_LANDSCAPE = "3bcfe823d2a6bee45c475b0dfe15b5483bd3289c4e235b0392555c9464b857ab"

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

/** Wide wordmark fixture (600x200): the BEFORE renderer shipped it 487x162. */
async function wordmarkLogo(): Promise<Buffer> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">` +
    `<text x="300" y="88" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="900" fill="#ffffff" letter-spacing="4">TED LASSO</text>` +
    `<text x="300" y="158" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#ffffff" letter-spacing="10">RICHMOND</text>` +
    `</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Tall/square fixture (400x400): the BEFORE renderer shipped it 400x400 raw. */
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

async function layerDims(layer: { input: Buffer }): Promise<{ w: number; h: number }> {
  const m = await sharp(layer.input).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0 }
}

async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(buf).metadata()
  return { w: meta.width ?? 0, h: meta.height ?? 0 }
}

function rectsOverlap(
  a: { left: number; top: number; w: number; h: number },
  b: { left: number; top: number; w: number; h: number },
): boolean {
  return a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h
}

describe("landscape title base slot (pure geometry)", () => {
  it("restores the historic 40% CW / 24% CH bounds on landscape, portrait slots untouched", () => {
    const land = freshGeometry(LAND_W, LAND_H, 6)
    expect(land.isPortrait).toBe(false)
    expect(land.landscapeTitleMaxW).toBe(Math.round(LAND_W * 0.4))
    expect(land.landscapeTitleMaxH).toBe(Math.round(LAND_H * 0.24))
    expect(land.landscapeTitleMaxW).toBe(307)
    expect(land.landscapeTitleMaxH).toBe(104)
    // Common slot formula identical (unranked-safe, byte guard for portrait).
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const rank of [1, 6, 20, null]) {
        const geo = freshGeometry(CW, CH, rank)
        expect(geo.titleMaxW).toBe(Math.max(40, CW - geo.zoneW - geo.titleRight - 16))
      }
    }
    // Portrait ranked caps (task8a2) unchanged.
    const port = freshGeometry(STD_W, STD_H, 6)
    expect(port.rankedTitleMaxW).toBe(STD_W - Math.round(STD_W * 0.055) * 2)
    expect(port.rankedTitleMaxH).toBe(Math.round(STD_H * 0.25))
  })
})

describe("landscape title placement (compositor, ranked + unranked)", () => {
  it("keeps the small mark on the bottom-right anchor on both compositions", async () => {
    const poster = await patternedBase(LAND_W, LAND_H)
    const logo = await whiteLogo()
    const geo = freshGeometry(LAND_W, LAND_H, 6)
    for (const rank of [6, null] as const) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW: LAND_W,
        CH: LAND_H,
        rank,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: null,
      })
      const title = layers[layers.length - 1]
      const size = await layerDims(title)
      // 220x100 fits the restored 307x104 slot: passthrough, same box both.
      expect(size).toEqual({ w: 220, h: 100 })
      expect(title.left).toBe(LAND_W - size.w - geo.titleRight)
      expect(title.top).toBe(LAND_H - size.h - geo.titleBottom)
    }
  }, 120000)

  it("fits the wide wordmark into the restored slot (was 487x162), right of the column", async () => {
    const poster = await patternedBase(LAND_W, LAND_H)
    const wordmark = await wordmarkLogo()
    const wmMeta = await sharp(wordmark).metadata()
    const ww = wmMeta.width ?? 600
    const wh = wmMeta.height ?? 200
    const geo = freshGeometry(LAND_W, LAND_H, 3)
    for (const rank of [3, null] as const) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW: LAND_W,
        CH: LAND_H,
        rank,
        meta: metaInput(),
        logo: { png: wordmark, w: ww, h: wh },
        provider: null,
      })
      const title = layers[layers.length - 1]
      const size = await layerDims(title)
      // BEFORE shipped 487x162 (0.634 CW); restored slot binds at 307 wide.
      expect(size.w).toBeLessThanOrEqual(geo.landscapeTitleMaxW)
      expect(size.h).toBeLessThanOrEqual(geo.landscapeTitleMaxH)
      expect(size.w).toBeLessThan(487)
      expect(size.w / LAND_W).toBeLessThan(0.5)
      // Bottom-right anchor preserved, right of the left column.
      expect(title.left).toBe(LAND_W - size.w - geo.titleRight)
      expect(title.top).toBe(LAND_H - size.h - geo.titleBottom)
      expect(title.left).toBeGreaterThan(geo.zoneW)
      expect(title.left + size.w).toBeLessThanOrEqual(LAND_W)
      expect(title.top + size.h).toBeLessThanOrEqual(LAND_H)
    }
  }, 120000)

  it("bounds tall marks in the landscape slot (was 400x400 raw), inside the canvas", async () => {
    const poster = await patternedBase(LAND_W, LAND_H)
    const tall = await tallLogo()
    const geo = freshGeometry(LAND_W, LAND_H, 6)
    for (const rank of [6, null] as const) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW: LAND_W,
        CH: LAND_H,
        rank,
        meta: metaInput(),
        logo: { png: tall, w: 400, h: 400 },
        provider: null,
      })
      const title = layers[layers.length - 1]
      const size = await layerDims(title)
      expect(size.w).toBeLessThanOrEqual(geo.landscapeTitleMaxW)
      expect(size.h).toBeLessThanOrEqual(geo.landscapeTitleMaxH)
      expect(size.h).toBeLessThanOrEqual(104)
      expect(title.left).toBe(LAND_W - size.w - geo.titleRight)
      expect(title.top).toBe(LAND_H - size.h - geo.titleBottom)
      expect(title.left + size.w).toBeLessThanOrEqual(LAND_W)
      expect(title.top + size.h).toBeLessThanOrEqual(LAND_H)
    }
  }, 120000)

  it("applies user X/Y exactly once on landscape (delta-exact, bitmap identical)", async () => {
    const poster = await patternedBase(LAND_W, LAND_H)
    const logo = await whiteLogo()
    for (const rank of [6, null] as const) {
      const base = {
        posterBuf: poster,
        CW: LAND_W,
        CH: LAND_H,
        rank,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: null,
      } as const
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
    }
  }, 120000)

  it("grows the landscape title monotonically 50/100/150/200 until the canvas limit", async () => {
    const poster = await patternedBase(LAND_W, LAND_H)
    const big = await largeTitle()
    for (const rank of [6, null] as const) {
      const base = {
        posterBuf: poster,
        CW: LAND_W,
        CH: LAND_H,
        rank,
        meta: metaInput(),
        logo: { png: big, w: 900, h: 360 },
        provider: null,
      } as const
      const sizes: { w: number; h: number }[] = []
      for (const s of [50, 100, 150, 200] as const) {
        const layers = await composeFreshOverlay({ ...base, transforms: { logoScale: s } })
        const title = layers[layers.length - 1]
        const size = await layerDims(title)
        sizes.push(size)
        expect(title.left + size.w).toBeLessThanOrEqual(LAND_W)
        expect(title.top + size.h).toBeLessThanOrEqual(LAND_H)
      }
      // Real growth at every step until the genuine canvas limit binds.
      expect(sizes[1].w).toBeGreaterThan(sizes[0].w)
      expect(sizes[2].w).toBeGreaterThan(sizes[1].w)
      expect(sizes[3].w).toBeGreaterThanOrEqual(sizes[2].w)
      if (sizes[3].w === sizes[2].w) expect(sizes[2].w).toBe(LAND_W)
    }
  }, 180000)

  it("keeps the network/title overlap free by default (title right of the column)", async () => {
    const poster = await patternedBase(LAND_W, LAND_H)
    const wordmark = await wordmarkLogo()
    const wmMeta = await sharp(wordmark).metadata()
    const provider = await redProvider()
    const geo = freshGeometry(LAND_W, LAND_H, 6)
    const layers = await composeFreshOverlay({
      posterBuf: poster,
      CW: LAND_W,
      CH: LAND_H,
      rank: 6,
      meta: metaInput(),
      logo: { png: wordmark, w: wmMeta.width ?? 600, h: wmMeta.height ?? 200 },
      provider: { png: provider, w: 300, h: 120 },
    })
    const title = layers[layers.length - 1]
    const size = await layerDims(title)
    const titleRect = { left: title.left, top: title.top, w: size.w, h: size.h }
    for (const layer of layers.slice(0, -1)) {
      const m = await layerDims(layer)
      // The shade spans the canvas by design; every content layer must be
      // disjoint from the title box.
      if (m.w === LAND_W && m.h === LAND_H) continue
      expect(rectsOverlap(titleRect, { left: layer.left, top: layer.top, w: m.w, h: m.h })).toBe(false)
    }
    expect(title.left).toBeGreaterThan(geo.zoneW)
  }, 120000)
})

describe("landscape title (service)", () => {
  it("ranked landscape: null auto == explicit 100, explicit 75 honored, 150/200 grow", async () => {
    const logo = await whiteLogo()
    const full = {
      posterBuf: await patternedBase(LAND_W, LAND_H),
      logoFetch: logo,
      posterLayout: "fresh" as const,
      shape: "landscape" as const,
      rankingEnabled: true,
      finalRank: 6,
    }
    const auto = await generatePosterBuffer(baseInput(full))
    const explicit100 = await generatePosterBuffer(baseInput({ ...full, logoScale: 100 }))
    expect(await dims(auto)).toEqual({ w: LAND_W, h: LAND_H })
    expect(sha(auto)).toBe(sha(explicit100))
    // Saved explicits honored (75/150/200 all render distinctly).
    const explicit75 = await generatePosterBuffer(baseInput({ ...full, logoScale: 75 }))
    const b150 = await generatePosterBuffer(baseInput({ ...full, logoScale: 150 }))
    const b200 = await generatePosterBuffer(baseInput({ ...full, logoScale: 200 }))
    expect(sha(explicit75)).not.toBe(sha(auto))
    expect(sha(b150)).not.toBe(sha(auto))
    expect(sha(b200)).not.toBe(sha(b150))
  }, 300000)

  it("unranked landscape (scope all): null auto == explicit 100", async () => {
    const logo = await whiteLogo()
    const full = {
      posterBuf: await patternedBase(LAND_W, LAND_H),
      logoFetch: logo,
      posterLayout: "fresh" as const,
      posterFreshScope: "all" as const,
      shape: "landscape" as const,
      rankingEnabled: false,
      finalRank: null,
    }
    const auto = await generatePosterBuffer(baseInput(full))
    const explicit100 = await generatePosterBuffer(baseInput({ ...full, logoScale: 100 }))
    expect(await dims(auto)).toEqual({ w: LAND_W, h: LAND_H })
    expect(sha(auto)).toBe(sha(explicit100))
  }, 180000)

  it("records the intentional landscape change and the untouched portrait/standard bytes", async () => {
    const logo = await whiteLogo()
    const landRanked = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(LAND_W, LAND_H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        shape: "landscape" as const,
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    expect(await dims(landRanked)).toEqual({ w: LAND_W, h: LAND_H })
    // Intentional: the oversized BEFORE bytes are gone on both compositions.
    expect(sha(landRanked)).not.toBe(BEFORE_LAND_RANKED_100)
    const landUnranked = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(LAND_W, LAND_H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        posterFreshScope: "all" as const,
        shape: "landscape" as const,
        rankingEnabled: false,
        finalRank: null,
      }),
    )
    expect(sha(landUnranked)).not.toBe(BEFORE_LAND_UNRANKED_100)
    // Untouched: portrait unranked is covered by poster-fresh-centered-title
    // pins; ranked portrait moved INTENTIONALLY in task10 (re-pinned above
    // with before/after samples + reconstruction proof) and again in task12
    // (tall/narrow numerals — re-pinned below with before/after contact
    // sheets in C:\Users\lucaf\AppData\Local\Temp\opencode\task12\); Standard both shapes
    // here.
    const portRanked = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(STD_W, STD_H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        shape: "poster" as const,
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    expect(sha(portRanked)).toBe(BEFORE_PORTRAIT_RANKED_TASK12)
    const stdP = await generatePosterBuffer(
      baseInput({ posterBuf: await patternedBase(STD_W, STD_H), logoFetch: logo, rankingEnabled: true, finalRank: 6 }),
    )
    expect(sha(stdP)).toBe(BEFORE_STANDARD_PORTRAIT)
    const stdL = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(LAND_W, LAND_H),
        logoFetch: logo,
        shape: "landscape" as const,
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    expect(sha(stdL)).toBe(BEFORE_STANDARD_LANDSCAPE)
    console.log(`[task9] new land-ranked-100 sha=${sha(landRanked)}`)
    console.log(`[task9] new land-unranked-100 sha=${sha(landUnranked)}`)
  }, 300000)
})

describe("task9 evidence samples (approved temp only, never the repo)", () => {
  it("writes before/after landscape 100/150/200 + preserved portrait 100", async () => {
    const outDir = "C:/Users/lucaf/AppData/Local/Temp/opencode/task9/after"
    await mkdir(outDir, { recursive: true })
    const wordmark = await wordmarkLogo()
    const rankedBase = {
      posterBuf: await patternedBase(LAND_W, LAND_H),
      logoFetch: wordmark,
      posterLayout: "fresh" as const,
      shape: "landscape" as const,
      rankingEnabled: true,
      finalRank: 3,
    }
    for (const scale of [100, 150, 200] as const) {
      const buf = await generatePosterBuffer(baseInput({ ...rankedBase, logoScale: scale }))
      await writeFile(`${outDir}/landscape-ranked-${scale}.jpg`, buf)
    }
    const logo = await whiteLogo()
    const unranked = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(LAND_W, LAND_H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        posterFreshScope: "all" as const,
        shape: "landscape" as const,
        rankingEnabled: false,
        finalRank: null,
      }),
    )
    await writeFile(`${outDir}/landscape-unranked-100.jpg`, unranked)
    const portrait = await generatePosterBuffer(
      baseInput({
        posterBuf: await patternedBase(STD_W, STD_H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        shape: "poster" as const,
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    await writeFile(`${outDir}/portrait-ranked-100.jpg`, portrait)
    // fitFreshTitleLogo is the single sizing step: the wordmark binds on the
    // restored width first (307), the tall mark on the restored height (104).
    const geo = freshGeometry(LAND_W, LAND_H, 3)
    const wmFit = await fitFreshTitleLogo({ png: wordmark, w: 600, h: 200 }, geo.landscapeTitleMaxW, geo.landscapeTitleMaxH)
    expect(wmFit.w).toBeLessThanOrEqual(307)
    expect(wmFit.h).toBeLessThanOrEqual(104)
    console.log(`[task9] samples written to ${outDir}`)
  }, 300000)
})
