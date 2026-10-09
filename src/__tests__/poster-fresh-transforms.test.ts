/**
 * Fresh transform controls (task6): the existing per-shape size/X/Y controls
 * drive the fresh layers at render time — rank numeral (`tscale`/`tox`/`toy`
 * → `topBadge*`), genre/rating column (`gscale`/`gox`/`goy`), provider mark
 * (`netscale` riding the bitmap + `nox`/`noy`, follow/fixed contract) and
 * title logo (`logoScale` riding the bitmap + `ox`/`oy` applied once).
 * Unranked network anchors ABOVE THE META BLOCK (user reversal, not above
 * the title); ranked network stays below the meta column. Neutral
 * transforms (100/0/offsets-absent) reproduce the historic baseline
 * byte-identically (ranked golden hashes pinned in poster-fresh-unranked).
 *
 * All assertions run on ACTUAL renders/layers, both canvas shapes, both
 * ranked and unranked: control deltas change bytes AND move layers by the
 * exact offset (no double scaling/offset), extremes stay in-canvas without
 * throwing, invalid inputs fall back to neutral.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import {
  composeFreshOverlay,
  freshGeometry,
  renderFreshGlassNumeral,
  renderFreshNumeralMask,
  renderFreshNumeralRim,
  type FreshLayoutTransforms,
  type FreshMetaInput,
} from "@/lib/fresh-layout"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const SHAPES = [
  { name: "portrait", CW: STD_W, CH: STD_H },
  { name: "landscape", CW: LAND_W, CH: LAND_H },
] as const

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

async function flatBase(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#3a3f55" } })
    .jpeg()
    .toBuffer()
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

/** Alpha>threshold pixels on the outermost edge rows/columns (clip detector). */
async function edgeCount(buf: Buffer, threshold = 10): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let edge = 0
  for (let x = 0; x < info.width; x++) {
    if ((data[x * 4 + 3] ?? 0) > threshold) edge++
    if (info.height > 1 && (data[((info.height - 1) * info.width + x) * 4 + 3] ?? 0) > threshold) edge++
  }
  for (let y = 1; y < info.height - 1; y++) {
    if ((data[(y * info.width) * 4 + 3] ?? 0) > threshold) edge++
    if (info.width > 1 && (data[(y * info.width + info.width - 1) * 4 + 3] ?? 0) > threshold) edge++
  }
  return edge
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

describe("neutral transforms reproduce the historic baseline", () => {
  it("freshGeometry with neutral transforms equals the 3-arg geometry", () => {
    for (const { CW, CH } of SHAPES) {
      for (const rank of [1, 6, 20, 100, null]) {
        const a = freshGeometry(CW, CH, rank)
        const b = freshGeometry(CW, CH, rank, {
          numeralScale: 100,
          numeralOffsetX: 0,
          numeralOffsetY: 0,
          metaScale: 100,
          metaOffsetX: 0,
          metaOffsetY: 0,
          providerOffsetX: 0,
          providerOffsetY: 0,
          logoOffsetX: 0,
          logoOffsetY: 0,
        })
        expect(b).toEqual(a)
      }
    }
  })

  it("compose layers with neutral transforms equal layers without transforms (ranked + unranked)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const neutral: FreshLayoutTransforms = {
      numeralScale: 100,
      numeralOffsetX: 0,
      numeralOffsetY: 0,
      metaScale: 100,
      metaOffsetX: 0,
      metaOffsetY: 0,
      providerOffsetX: 0,
      providerOffsetY: 0,
      providerFollowTitle: true,
      logoOffsetX: 0,
      logoOffsetY: 0,
    }
    for (const { CW, CH } of SHAPES) {
      for (const rank of [6, null]) {
        const base = {
          posterBuf: poster,
          CW,
          CH,
          rank,
          meta: metaInput(),
          logo: { png: logo, w: 220, h: 100 },
          provider: { png: provider, w: 300, h: 120 },
        }
        const ref = await composeFreshOverlay(base)
        const same = await composeFreshOverlay({ ...base, transforms: neutral })
        expect(same).toHaveLength(ref.length)
        for (let i = 0; i < ref.length; i++) {
          expect(same[i].top).toBe(ref[i].top)
          expect(same[i].left).toBe(ref[i].left)
          expect((same[i].input as Buffer).equals(ref[i].input as Buffer)).toBe(true)
        }
      }
    }
  }, 120000)

  it("invalid transform values fall back to neutral (no throw, identical layers)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    }
    const ref = await composeFreshOverlay(base)
    const bad = await composeFreshOverlay({
      ...base,
      transforms: {
        numeralScale: NaN,
        numeralOffsetX: Infinity,
        numeralOffsetY: NaN,
        metaScale: Infinity,
        metaOffsetX: NaN,
        metaOffsetY: Infinity,
        providerOffsetX: NaN,
        providerOffsetY: Infinity,
        logoOffsetX: NaN,
        logoOffsetY: Infinity,
      },
    })
    expect(bad).toHaveLength(ref.length)
    for (let i = 0; i < ref.length; i++) {
      expect(bad[i].top).toBe(ref[i].top)
      expect(bad[i].left).toBe(ref[i].left)
      expect((bad[i].input as Buffer).equals(ref[i].input as Buffer)).toBe(true)
    }
    // Zero scale is not a valid percentage: neutral, not degenerate.
    const zero = await composeFreshOverlay({
      ...base,
      transforms: { numeralScale: 0, metaScale: 0 },
    })
    expect(zero).toHaveLength(ref.length)
    for (let i = 0; i < ref.length; i++) {
      expect((zero[i].input as Buffer).equals(ref[i].input as Buffer)).toBe(true)
    }
  }, 120000)
})

describe("rank numeral follows the classifica controls", () => {
  it("numeral geometry scales and shifts exactly (both shapes)", () => {
    for (const { CW, CH } of SHAPES) {
      const ref = freshGeometry(CW, CH, 6).numeral!
      const scaled = freshGeometry(CW, CH, 6, { numeralScale: 200 }).numeral!
      expect(scaled.fontSize).toBe(ref.fontSize * 2)
      expect(scaled.left).toBe(ref.left)
      expect(scaled.top).toBe(ref.top)
      const shrunk = freshGeometry(CW, CH, 6, { numeralScale: 50 }).numeral!
      expect(shrunk.fontSize).toBe(Math.round(ref.fontSize / 2))
      const moved = freshGeometry(CW, CH, 6, { numeralOffsetX: 30, numeralOffsetY: -20 }).numeral!
      expect(moved.left).toBe(ref.left + 30)
      expect(moved.top).toBe(ref.top - 20)
      expect(moved.fontSize).toBe(ref.fontSize)
      // No standard -20 baseline leaks into the fresh anchor.
      const plain = freshGeometry(CW, CH, 6, null).numeral!
      expect(plain.left).toBe(ref.left)
    }
  })

  it("each classifica control changes the ranked render (both shapes)", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      const full = {
        posterBuf: await patternedBase(W, H),
        logoFetch: logo,
        posterLayout: "fresh" as const,
        shape,
        rankingEnabled: true,
        finalRank: 6,
      }
      const ref = await generatePosterBuffer(baseInput(full))
      expect((await generatePosterBuffer(baseInput({ ...full, topBadgeScale: 200 }))).equals(ref)).toBe(false)
      expect((await generatePosterBuffer(baseInput({ ...full, topBadgeOffsetX: 40 }))).equals(ref)).toBe(false)
      expect((await generatePosterBuffer(baseInput({ ...full, topBadgeOffsetY: 40 }))).equals(ref)).toBe(false)
      expect(await dims(ref)).toEqual({ w: W, h: H })
    }
  }, 180000)

  it("the numeral layer samples the transformed anchor (offset moves ink, no post-resize)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    }
    const ref = await composeFreshOverlay(base)
    const moved30 = await composeFreshOverlay({
      ...base,
      transforms: { numeralOffsetX: 30, numeralOffsetY: 25 },
    })
    const moved60 = await composeFreshOverlay({
      ...base,
      transforms: { numeralOffsetX: 60, numeralOffsetY: 25 },
    })
    // Strip (0) + shade (1) + numeral (2): the numeral ROI layer follows
    // the anchor. The Y shift lands exactly (far from any edge); on X the
    // neutral ROI already touches the left canvas edge, so exactness is
    // proven differentially between two unclamped positions (+60 − +30 == 30).
    expect(moved30[2].top).toBe(ref[2].top + 25)
    expect(moved60[2].top).toBe(ref[2].top + 25)
    expect(moved60[2].left - moved30[2].left).toBe(30)
    // Render-at-anchor (not a post-resize of a neutral sample): on flat
    // artwork the shifted layer content is byte-identical, only the anchor
    // moves...
    const flat = await flatBase(STD_W, STD_H)
    const flatBaseLayers = { ...base, posterBuf: flat }
    const f30 = await composeFreshOverlay({
      ...flatBaseLayers,
      transforms: { numeralOffsetX: 30 },
    })
    const f60 = await composeFreshOverlay({
      ...flatBaseLayers,
      transforms: { numeralOffsetX: 60 },
    })
    expect(f60[2].left - f30[2].left).toBe(30)
    expect((f60[2].input as Buffer).equals(f30[2].input as Buffer)).toBe(true)
    // ...while on patterned artwork the fill re-samples the new location
    // (local hues travel with the geometry — a stale neutral sample would
    // stay identical up to the shift).
    expect((moved60[2].input as Buffer).equals(moved30[2].input as Buffer)).toBe(false)
    // At 200% the glass layer is rendered big, not upscaled from neutral.
    const big = await composeFreshOverlay({ ...base, transforms: { numeralScale: 200 } })
    const refMeta = await sharp(ref[2].input).metadata()
    const bigMeta = await sharp(big[1].input).metadata()
    expect((bigMeta.width ?? 0) * (bigMeta.height ?? 0)).toBeGreaterThan(
      (refMeta.width ?? 0) * (refMeta.height ?? 0),
    )
    // No clipped digit edges at the extremes: full numeral layers stay clean.
    // At 10% the shrunk layer fits the canvas, so the ROI edge stays clean.
    // At 200% the task11-corrected two-digit numeral is wider than the
    // canvas by user request: the ROI window then legitimately cuts content
    // at the canvas edge (preserved offscreen policy — clamp, never throw,
    // same as an extreme user offset). The glyph ink itself is never
    // clipped: the scratch-level mask and rim stay edge-clean and the
    // window is clamped to the canvas on at least one side.
    for (const scale of [10, 200]) {
      const box = freshGeometry(STD_W, STD_H, 20, { numeralScale: scale }).numeral!
      const num = await renderFreshGlassNumeral(poster, STD_W, STD_H, box)
      expect(num.left).toBeGreaterThanOrEqual(0)
      expect(num.top).toBeGreaterThanOrEqual(0)
      expect(num.left + num.w).toBeLessThanOrEqual(STD_W)
      expect(num.top + num.h).toBeLessThanOrEqual(STD_H)
      if (scale === 10) {
        expect(await edgeCount(num.png)).toBe(0)
      } else {
        expect(num.left === 0 || num.left + num.w === STD_W).toBe(true)
        expect(await edgeCount((await renderFreshNumeralMask(box)).png)).toBe(0)
        expect(await edgeCount((await renderFreshNumeralRim(box)).png)).toBe(0)
      }
    }
  }, 180000)
})

describe("meta column follows the genre controls", () => {
  it("each genre control changes the ranked render and moves the block exactly", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: { png: provider, w: 300, h: 120 },
    }
    const ref = await composeFreshOverlay(base)
    const scaled = await composeFreshOverlay({ ...base, transforms: { metaScale: 200 } })
    expect((scaled[3].input as Buffer).equals(ref[3].input as Buffer)).toBe(false)
    // Meta scale is independent of the numeral: the numeral layer is untouched.
    expect((scaled[2].input as Buffer).equals(ref[2].input as Buffer)).toBe(true)
    expect(scaled[2].top).toBe(ref[2].top)
    expect(scaled[2].left).toBe(ref[2].left)
    // Meta offsets move the placed block exactly (ranked meta is layers[3]
    // since task8b: strip, shade, numeral, meta, provider, logo).
    const moved = await composeFreshOverlay({
      ...base,
      transforms: { metaOffsetX: 20, metaOffsetY: 15 },
    })
    expect(moved[3].left).toBe(ref[3].left + 20)
    expect(moved[3].top).toBe(ref[3].top + 15)
    // Service level, both shapes: every genre control changes bytes.
    const svcLogo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      const full = {
        posterBuf: await patternedBase(W, H),
        logoFetch: svcLogo,
        posterLayout: "fresh" as const,
        shape,
        rankingEnabled: true,
        finalRank: 6,
      }
      const svcRef = await generatePosterBuffer(baseInput(full))
      expect((await generatePosterBuffer(baseInput({ ...full, genreBadgeScale: 200 }))).equals(svcRef)).toBe(false)
      expect((await generatePosterBuffer(baseInput({ ...full, genreBadgeOffsetX: 30 }))).equals(svcRef)).toBe(false)
      expect((await generatePosterBuffer(baseInput({ ...full, genreBadgeOffsetY: 30 }))).equals(svcRef)).toBe(false)
    }
  }, 240000)

  it("the ranked meta block follows numeral changes by default (plus its own offsets)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const base = {
      posterBuf: poster,
      CW: STD_W,
      CH: STD_H,
      rank: 6,
      meta: metaInput(),
      logo: { png: logo, w: 220, h: 100 },
      provider: null,
    }
    const ref = await composeFreshOverlay(base)
    // Bigger numeral pushes the default metaTop down with no meta edits.
    const bigNumeral = await composeFreshOverlay({ ...base, transforms: { numeralScale: 200 } })
    expect(bigNumeral[3].top).toBeGreaterThan(ref[3].top)
    // ...and the meta offsets still apply on top of that chain.
    const chained = await composeFreshOverlay({
      ...base,
      transforms: { numeralScale: 200, metaOffsetY: 10 },
    })
    expect(chained[3].top).toBe(bigNumeral[3].top + 10)
  }, 120000)

  it("unranked meta follows its controls near the title logo (both shapes)", async () => {
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const { CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      const base = {
        posterBuf: poster,
        CW,
        CH,
        rank: null,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      }
      const ref = await composeFreshOverlay(base)
      // Unranked layers: shade, meta, provider, logo.
      const moved = await composeFreshOverlay({
        ...base,
        transforms: { metaOffsetX: -15, metaOffsetY: -10 },
      })
      expect(moved[1].left).toBe(ref[1].left - 15)
      expect(moved[1].top).toBe(ref[1].top - 10)
      const scaled = await composeFreshOverlay({ ...base, transforms: { metaScale: 50 } })
      expect((scaled[1].input as Buffer).equals(ref[1].input as Buffer)).toBe(false)
      // Meta stays bottom-anchored beside the logo even when transformed.
      const geo = freshGeometry(CW, CH, null)
      const title = moved[3]
      const titleMeta = await sharp(title.input).metadata()
      expect(title.left).toBe(CW - (titleMeta.width ?? 0) - geo.titleRight)
      const metaMeta = await sharp(moved[1].input).metadata()
      expect(moved[1].left + (metaMeta.width ?? 0)).toBeLessThanOrEqual(title.left - 1)
    }
  }, 180000)
})

describe("provider follows the network controls", () => {
  it("ranked provider sits below the meta column plus its offsets (both shapes)", async () => {
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const { CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      const base = {
        posterBuf: poster,
        CW,
        CH,
        rank: 6,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      }
      const ref = await composeFreshOverlay(base)
      // Ranked layers: strip, shade, numeral, meta, provider, logo.
      const meta = ref[3]
      const prov = ref[4]
      const metaMeta = await sharp(meta.input).metadata()
      expect(prov.top).toBeGreaterThanOrEqual(meta.top + (metaMeta.height ?? 0))
      const moved = await composeFreshOverlay({
        ...base,
        transforms: { providerOffsetX: 25, providerOffsetY: 12 },
      })
      expect(moved[4].left).toBe(ref[4].left + 25)
      expect(moved[4].top).toBe(ref[4].top + 12)
      expect((moved[4].input as Buffer).equals(ref[4].input as Buffer)).toBe(true)
      for (const layer of moved) {
        const m = await sharp(layer.input).metadata()
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left + (m.width ?? 0)).toBeLessThanOrEqual(CW)
        expect(layer.top + (m.height ?? 0)).toBeLessThanOrEqual(CH)
      }
    }
  }, 180000)

  it("unranked provider sits above the meta block plus its offsets (both shapes)", async () => {
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const { CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      const geo = freshGeometry(CW, CH, null)
      const providerGap = Math.round(geo.metaGap * 0.8)
      const base = {
        posterBuf: poster,
        CW,
        CH,
        rank: null,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      }
      const ref = await composeFreshOverlay(base)
      const provMeta = await sharp(ref[2].input).metadata()
      expect(ref[2].top + (provMeta.height ?? 0)).toBe(ref[1].top - providerGap)
      const moved = await composeFreshOverlay({
        ...base,
        transforms: { providerOffsetX: -20, providerOffsetY: 8 },
      })
      expect(moved[2].left).toBe(ref[2].left - 20)
      expect(moved[2].top).toBe(ref[2].top + 8)
    }
  }, 180000)

  it("honors the absolute-positioning contract (ranked + unranked)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const rank of [6, null]) {
      const base = {
        posterBuf: poster,
        CW: STD_W,
        CH: STD_H,
        rank,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      }
      const fixed = await composeFreshOverlay({
        ...base,
        transforms: {
          providerFollowTitle: false,
          providerFixedX: 50,
          providerFixedY: 60,
          providerOffsetX: 999,
          providerOffsetY: 999,
        },
      })
      // Provider layer index: 4 ranked (task8b strip first), 2 unranked.
      const prov = rank === null ? fixed[2] : fixed[4]
      expect(prov.left).toBe(50)
      expect(prov.top).toBe(60)
      // Follow-off without coords keeps the auto anchor (never 0,0).
      const noCoords = await composeFreshOverlay({
        ...base,
        transforms: { providerFollowTitle: false },
      })
      const ref = await composeFreshOverlay(base)
      const autoProv = rank === null ? noCoords[2] : noCoords[4]
      const refProv = rank === null ? ref[2] : ref[4]
      expect(autoProv.left).toBe(refProv.left)
      expect(autoProv.top).toBe(refProv.top)
    }
  }, 120000)

  it("network scale and offsets change the service render (both shapes, ranked + unranked)", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      for (const finalRank of [6, null]) {
        const full = {
          posterBuf: await patternedBase(W, H),
          logoFetch: logo,
          posterLayout: "fresh" as const,
          shape,
          rankingEnabled: finalRank !== null,
          finalRank,
          networkLogo: true,
          tmdbNetworks: ["Netflix"],
        }
        const ref = await generatePosterBuffer(baseInput(full))
        expect((await generatePosterBuffer(baseInput({ ...full, networkLogoScale: 150 }))).equals(ref)).toBe(false)
        expect((await generatePosterBuffer(baseInput({ ...full, networkLogoOffsetX: 30 }))).equals(ref)).toBe(false)
        expect((await generatePosterBuffer(baseInput({ ...full, networkLogoOffsetY: 30 }))).equals(ref)).toBe(false)
        // Fixed coords win over offsets at the service level too.
        const fixed = await generatePosterBuffer(
          baseInput({
            ...full,
            networkLogoFollowTitle: false,
            networkFixedX: 40,
            networkFixedY: 50,
            networkLogoOffsetX: 200,
            networkLogoOffsetY: 200,
          }),
        )
        const fixedClean = await generatePosterBuffer(
          baseInput({
            ...full,
            networkLogoFollowTitle: false,
            networkFixedX: 40,
            networkFixedY: 50,
          }),
        )
        expect(fixed.equals(fixedClean)).toBe(true)
        expect(fixed.equals(ref)).toBe(false)
      }
    }
  }, 300000)
})

describe("title logo follows its controls exactly once", () => {
  it("logo offsets shift the fresh anchor by the exact delta (ranked + unranked, both shapes)", async () => {
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const { CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      for (const rank of [6, null]) {
        const base = {
          posterBuf: poster,
          CW,
          CH,
          rank,
          meta: metaInput(),
          logo: { png: logo, w: 220, h: 100 },
          provider: { png: provider, w: 300, h: 120 },
        }
        const ref = await composeFreshOverlay(base)
        const titleIdx = ref.length - 1
        const moved = await composeFreshOverlay({
          ...base,
          // Small enough to stay clear of the canvas-edge clamp on both
          // shapes (titleRight is 23/35px): the delta must land exactly.
          transforms: { logoOffsetX: 10, logoOffsetY: -10 },
        })
        // Applied once relative to the fresh anchor — never doubled.
        expect(moved[titleIdx].left).toBe(ref[titleIdx].left + 10)
        expect(moved[titleIdx].top).toBe(ref[titleIdx].top - 10)
        expect((moved[titleIdx].input as Buffer).equals(ref[titleIdx].input as Buffer)).toBe(true)
      }
    }
  }, 180000)

  it("logo scale and offsets change the service render (both shapes, ranked + unranked)", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      for (const finalRank of [6, null]) {
        const full = {
          posterBuf: await patternedBase(W, H),
          logoFetch: logo,
          posterLayout: "fresh" as const,
          shape,
          rankingEnabled: finalRank !== null,
          finalRank,
        }
        const ref = await generatePosterBuffer(baseInput(full))
        // Explicit scales (auto-fit may coincide with any single value, and
        // the landscape height cap equalizes large scales for wide logos —
        // so compare two explicit scales that differ under every cap).
        const s100 = await generatePosterBuffer(baseInput({ ...full, logoScale: 100 }))
        const s20 = await generatePosterBuffer(baseInput({ ...full, logoScale: 20 }))
        expect(s20.equals(s100)).toBe(false)
        expect((await generatePosterBuffer(baseInput({ ...full, logoOffsetX: 30 }))).equals(ref)).toBe(false)
        expect((await generatePosterBuffer(baseInput({ ...full, logoOffsetY: 30 }))).equals(ref)).toBe(false)
        expect(await dims(ref)).toEqual({ w: W, h: H })
      }
    }
  }, 300000)
})

describe("transform bounds and extremes", () => {
  it("min/max scales render valid posters on both shapes, ranked + unranked", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      for (const finalRank of [6, null]) {
        for (const scale of [10, 200]) {
          const buf = await generatePosterBuffer(
            baseInput({
              posterBuf: await patternedBase(W, H),
              logoFetch: logo,
              posterLayout: "fresh" as const,
              shape,
              rankingEnabled: finalRank !== null,
              finalRank,
              topBadgeScale: scale,
              genreBadgeScale: scale,
              networkLogoScale: scale,
              networkLogo: true,
              tmdbNetworks: ["Netflix"],
            }),
          )
          expect(await dims(buf)).toEqual({ w: W, h: H })
          expect(buf.byteLength).toBeGreaterThan(5000)
        }
      }
    }
  }, 300000)

  it("extreme offsets clamp inside the canvas without throwing (ranked + unranked)", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      for (const finalRank of [6, null]) {
        const buf = await generatePosterBuffer(
          baseInput({
            posterBuf: await patternedBase(W, H),
            logoFetch: logo,
            posterLayout: "fresh" as const,
            shape,
            rankingEnabled: finalRank !== null,
            finalRank,
            topBadgeOffsetX: 2000,
            topBadgeOffsetY: -2000,
            genreBadgeOffsetX: -2000,
            genreBadgeOffsetY: 2000,
            networkLogoOffsetX: 2000,
            networkLogoOffsetY: 2000,
            logoOffsetX: -2000,
            logoOffsetY: 2000,
            networkLogo: true,
            tmdbNetworks: ["Netflix"],
          }),
        )
        expect(await dims(buf)).toEqual({ w: W, h: H })
        expect(buf.byteLength).toBeGreaterThan(1000)
      }
    }
  }, 300000)

  it("all transforms at once stay in-canvas at the layer level (fitting range)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    // Moderate combined transforms (normal editing range): every layer fully
    // inside the canvas on portrait-ranked and both unranked shapes. Beyond
    // this range layers clip at the canvas edge like standard badges (sharp
    // composite clips natively) — covered at the service level by the
    // extreme-offsets test.
    const cases: { CW: number; CH: number; rank: number | null }[] = [
      { CW: STD_W, CH: STD_H, rank: 6 },
      { CW: STD_W, CH: STD_H, rank: null },
      { CW: LAND_W, CH: LAND_H, rank: null },
    ]
    for (const { CW, CH, rank } of cases) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW,
        CH,
        rank,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
        transforms: {
          numeralScale: 120,
          numeralOffsetX: 10,
          numeralOffsetY: 10,
          metaScale: 120,
          metaOffsetX: -10,
          metaOffsetY: 10,
          providerOffsetX: 10,
          providerOffsetY: -10,
          logoOffsetX: -10,
          logoOffsetY: -10,
        },
      })
      expect(layers.length).toBeGreaterThan(1)
      for (const layer of layers) {
        const m = await sharp(layer.input).metadata()
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left + (m.width ?? 0)).toBeLessThanOrEqual(CW)
        expect(layer.top + (m.height ?? 0)).toBeLessThanOrEqual(CH)
      }
    }
  }, 180000)

  it("combined extremes anchor inside the canvas and render valid posters", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const { CW, CH } of SHAPES) {
      for (const rank of [6, null]) {
        const layers = await composeFreshOverlay({
          posterBuf: poster,
          CW,
          CH,
          rank,
          meta: metaInput(),
          logo: { png: logo, w: 220, h: 100 },
          provider: { png: provider, w: 300, h: 120 },
          transforms: {
            numeralScale: 200,
            numeralOffsetX: 60,
            numeralOffsetY: 60,
            metaScale: 200,
            metaOffsetX: -60,
            metaOffsetY: 60,
            providerOffsetX: 60,
            providerOffsetY: -60,
            logoOffsetX: -60,
            logoOffsetY: -60,
          },
        })
        expect(layers.length).toBeGreaterThan(1)
        // Anchors always clamp inside (overflow past right/bottom clips
        // downstream exactly like standard badges with extreme offsets).
        for (const layer of layers) {
          expect(layer.left).toBeGreaterThanOrEqual(0)
          expect(layer.top).toBeGreaterThanOrEqual(0)
          expect(layer.left).toBeLessThanOrEqual(CW)
          expect(layer.top).toBeLessThanOrEqual(CH)
        }
        const buf = await generatePosterBuffer(
          baseInput({
            posterBuf: await patternedBase(CW, CH),
            logoFetch: logo,
            posterLayout: "fresh" as const,
            shape: CW === LAND_W ? "landscape" : "poster",
            rankingEnabled: rank !== null,
            finalRank: rank,
            topBadgeScale: 200,
            topBadgeOffsetX: 60,
            topBadgeOffsetY: 60,
            genreBadgeScale: 200,
            genreBadgeOffsetX: -60,
            genreBadgeOffsetY: 60,
            networkLogoOffsetX: 60,
            networkLogoOffsetY: -60,
            logoOffsetX: -60,
            logoOffsetY: -60,
          }),
        )
        expect(await dims(buf)).toEqual({ w: CW, h: CH })
      }
    }
  }, 240000)
})

describe("standard path untouched", () => {
  it("standard renders stay deterministic and differ from fresh with the same transforms", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const args = {
      posterBuf: poster,
      logoFetch: logo,
      rankingEnabled: true,
      finalRank: 6,
      topBadgeScale: 200,
      topBadgeOffsetX: 99,
      genreBadgeScale: 50,
      networkLogoOffsetX: 99,
      networkLogo: true,
      tmdbNetworks: ["Netflix"],
    }
    const a = await generatePosterBuffer(baseInput(args))
    const b = await generatePosterBuffer(baseInput(args))
    expect(a.equals(b)).toBe(true)
    expect(await dims(a)).toEqual({ w: STD_W, h: STD_H })
    const fresh = await generatePosterBuffer(baseInput({ ...args, posterLayout: "fresh" as const }))
    expect(fresh.equals(a)).toBe(false)
  }, 180000)
})

/**
 * Correction cycle1: provider/title scales must grow the fresh marks
 * monotonically relative to the Fresh-fitted baseline (50/100/150/200 all
 * visibly change) until the real canvas safety limit — the old slot-only
 * fit cancelled service-side growth whenever the caller bitmap was already
 * capped (e.g. a 300x120 provider fitted identically at 100 and 200).
 * No double scaling: one fit into the scale-enlarged cap. Neutral (absent
 * scales) stays byte-identical (pinned by the neutral tests above and the
 * golden hashes in poster-fresh-unranked).
 *
 * Size assertions (not byte-only) on large fixtures, both canvas shapes,
 * ranked + unranked, via the real service and the focused compositor.
 */
describe("effective provider/title scale monotonicity with large fixtures", () => {
  const SCALES = [50, 100, 150, 200] as const

  async function largeTitle(): Promise<Buffer> {
    return sharp({
      create: { width: 900, height: 360, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer()
  }

  async function layerSize(layer: { input: Buffer }): Promise<{ w: number; h: number }> {
    const m = await sharp(layer.input).metadata()
    return { w: m.width ?? 0, h: m.height ?? 0 }
  }

  it("large provider marks grow monotonically at the compositor (both shapes, ranked + unranked)", async () => {
    const logo = await whiteLogo()
    const provider = await redProvider() // 300x120: exceeds every fresh slot
    for (const { CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      for (const rank of [6, null] as const) {
        const base = {
          posterBuf: poster,
          CW,
          CH,
          rank,
          meta: metaInput(),
          logo: { png: logo, w: 220, h: 100 },
          provider: { png: provider, w: 300, h: 120 },
        }
        // Ranked layers: strip, shade, numeral, meta, provider, logo.
        // Unranked layers: shade, meta, provider, logo.
        const provIdx = rank === null ? 2 : 4
        const sizes: { w: number; h: number }[] = []
        for (const s of SCALES) {
          const layers = await composeFreshOverlay({ ...base, transforms: { providerScale: s } })
          const size = await layerSize(layers[provIdx])
          sizes.push(size)
          const m = size
          expect(layers[provIdx].left).toBeGreaterThanOrEqual(0)
          expect(layers[provIdx].top).toBeGreaterThanOrEqual(0)
          expect(layers[provIdx].left + m.w).toBeLessThanOrEqual(CW)
          expect(layers[provIdx].top + m.h).toBeLessThanOrEqual(CH)
        }
        for (let i = 1; i < sizes.length; i++) {
          expect(sizes[i].w).toBeGreaterThan(sizes[i - 1].w)
          expect(sizes[i].h).toBeGreaterThan(sizes[i - 1].h)
        }
      }
    }
  }, 180000)

  it("large title marks grow monotonically at the compositor (both shapes, ranked + unranked)", async () => {
    const title = await largeTitle() // 900x360: exceeds every fresh title cap
    const provider = await redProvider()
    for (const { CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      for (const rank of [6, null] as const) {
        const base = {
          posterBuf: poster,
          CW,
          CH,
          rank,
          meta: metaInput(),
          logo: { png: title, w: 900, h: 360 },
          provider: { png: provider, w: 300, h: 120 },
        }
        const sizes: { w: number; h: number }[] = []
        for (const s of SCALES) {
          const layers = await composeFreshOverlay({ ...base, transforms: { logoScale: s } })
          const titleLayer = layers[layers.length - 1]
          const size = await layerSize(titleLayer)
          sizes.push(size)
          expect(titleLayer.left).toBeGreaterThanOrEqual(0)
          expect(titleLayer.top).toBeGreaterThanOrEqual(0)
          expect(titleLayer.left + size.w).toBeLessThanOrEqual(CW)
          expect(titleLayer.top + size.h).toBeLessThanOrEqual(CH)
        }
        // Task8a2: ranked portrait spans the usable width (444/500 at 100),
        // so 150 already hits the genuine canvas edge and 200 cannot grow
        // past it — non-decreasing with canvas equality allowed ONLY there.
        const rankedPortrait = rank !== null && CW === STD_W
        for (let i = 1; i < sizes.length; i++) {
          if (rankedPortrait && i === sizes.length - 1 && sizes[i].w === CW) {
            expect(sizes[i].w).toBeGreaterThanOrEqual(sizes[i - 1].w)
            expect(sizes[i].h).toBeGreaterThanOrEqual(sizes[i - 1].h)
          } else {
            expect(sizes[i].w).toBeGreaterThan(sizes[i - 1].w)
            expect(sizes[i].h).toBeGreaterThan(sizes[i - 1].h)
          }
        }
      }
    }
  }, 180000)

  it("network scale visibly changes the service render across 50/100/150/200 (both shapes, ranked + unranked)", async () => {
    const logo = await whiteLogo()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      for (const finalRank of [6, null] as const) {
        const full = {
          posterBuf: await patternedBase(W, H),
          logoFetch: logo,
          posterLayout: "fresh" as const,
          shape,
          rankingEnabled: finalRank !== null,
          finalRank,
          networkLogo: true,
          tmdbNetworks: ["Netflix"],
        }
        const bufs: Buffer[] = []
        for (const s of SCALES) {
          const buf = await generatePosterBuffer(baseInput({ ...full, networkLogoScale: s }))
          expect(await dims(buf)).toEqual({ w: W, h: H })
          bufs.push(buf)
        }
        for (let i = 1; i < bufs.length; i++) {
          expect(bufs[i].equals(bufs[i - 1])).toBe(false)
        }
      }
    }
  }, 300000)

  it("logo scale visibly changes the service render across 50/100/150/200 with a large mark (both shapes, ranked + unranked)", async () => {
    const big = await largeTitle()
    for (const shape of ["poster", "landscape"] as const) {
      const W = shape === "poster" ? STD_W : LAND_W
      const H = shape === "poster" ? STD_H : LAND_H
      for (const finalRank of [6, null] as const) {
        const full = {
          posterBuf: await patternedBase(W, H),
          logoFetch: big,
          posterLayout: "fresh" as const,
          // Fresh-ALL fixture: the unranked variant guards the no-rank Fresh
          // composition (the ranked variant renders Fresh identically either way).
          posterFreshScope: "all" as const,
          shape,
          rankingEnabled: finalRank !== null,
          finalRank,
        }
        const bufs: Buffer[] = []
        for (const s of SCALES) {
          const buf = await generatePosterBuffer(baseInput({ ...full, logoScale: s }))
          expect(await dims(buf)).toEqual({ w: W, h: H })
          bufs.push(buf)
        }
        // Task8a2: ranked portrait spans the usable width at 100, so 150
        // already hits the genuine canvas edge and 200 cannot grow past it —
        // equality allowed ONLY for that last ranked-portrait step (and both
        // still differ from 50, proving no hidden slot cap).
        const rankedPortrait = finalRank !== null && W === STD_W
        for (let i = 1; i < bufs.length; i++) {
          if (rankedPortrait && i === bufs.length - 1 && bufs[i].equals(bufs[i - 1])) {
            expect(bufs[i].equals(bufs[0])).toBe(false)
          } else {
            expect(bufs[i].equals(bufs[i - 1])).toBe(false)
          }
        }
      }
    }
  }, 300000)

  it("ranked meta with bottom offset +2000 stays fully contained when the block fits (both shapes)", async () => {
    const logo = await whiteLogo()
    const provider = await redProvider()
    for (const { CW, CH } of SHAPES) {
      const poster = await patternedBase(CW, CH)
      const base = {
        posterBuf: poster,
        CW,
        CH,
        rank: 6 as const,
        meta: metaInput(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      }
      const ref = await composeFreshOverlay(base)
      // Ranked layers: strip, shade, numeral, meta, provider, logo.
      const refMeta = await layerSize(ref[3])
      // The default block fits on canvas: the clamp must pin it fully
      // inside (top == CH - h), never hanging 1px off the bottom edge.
      expect(ref[3].top + refMeta.h).toBeLessThanOrEqual(CH)
      const pushed = await composeFreshOverlay({ ...base, transforms: { metaOffsetY: 2000 } })
      const pushedMeta = await layerSize(pushed[3])
      expect(pushed[3].top).toBe(CH - pushedMeta.h)
      expect(pushed[3].top + pushedMeta.h).toBe(CH)
      expect(pushed[3].left).toBeGreaterThanOrEqual(0)
      expect(pushed[3].left + pushedMeta.w).toBeLessThanOrEqual(CW)
      // Every other layer keeps a legal in-canvas anchor too.
      for (const layer of pushed) {
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left).toBeLessThanOrEqual(CW)
        expect(layer.top).toBeLessThanOrEqual(CH)
      }
      // Service level: the extreme offset still renders valid dims.
      const svc = await generatePosterBuffer(
        baseInput({
          posterBuf: await patternedBase(CW, CH),
          logoFetch: logo,
          posterLayout: "fresh" as const,
          shape: CW === LAND_W ? "landscape" : "poster",
          rankingEnabled: true,
          finalRank: 6,
          genreBadgeOffsetY: 2000,
        }),
      )
      expect(await dims(svc)).toEqual({ w: CW, h: CH })
    }
  }, 240000)
})
