/**
 * Per-item transforms through the REAL poster render (integration).
 *
 * - Nothing configured = the historic bytes (automatic layout is the default).
 * - A configured item correction actually changes pixels and only that badge
 *   moves (the group placement stays).
 * - The reported per-item geometry follows the corrected position.
 */
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { ServerDefaults } from "@/lib/server-defaults"
import {
  parseBadgeItemTransforms,
  rejoinBadgeItems,
  serializeBadgeItemTransforms,
  withoutBadgeItemFamily,
} from "@/lib/badge-item-transforms"
import type { WikidataResult } from "@/lib/awards"

function posterInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    quality: "4K",
    qualityBadgeStyle: "standard",
    videoFormats: ["dv"],
    separateRatings: [
      { id: "imdb", value: 8.4 },
      { id: "tmdb", value: 8.0 },
      { id: "tomatoes", value: 9.2 },
    ],
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
    releaseDate: null,
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
    ...overrides,
  }
}

async function makePoster(): Promise<Buffer> {
  return sharp({
    create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
  })
    .jpeg()
    .toBuffer()
}

/**
 * Region crop of a rendered poster (clamped inside the canvas).
 * Used to prove glyph PRESENCE/ABSENCE at a reported slot, not just that the
 * bytes changed somewhere.
 */
/** Horizontal band of a box, rows [top, top+h) clamped inside the canvas. */
function bandOf(box: { top: number; left: number; w: number; h: number }, top: number, h: number) {
  return { top, left: box.left, w: box.w, h }
}

/** Peak/mean luminance of a band: proves a GLYPH is there (or is gone). */
async function bandLuma(
  png: Buffer,
  box: { top: number; left: number; w: number; h: number },
): Promise<{ max: number; mean: number }> {
  const left = Math.max(0, Math.min(STD_W - 1, Math.round(box.left)))
  const top = Math.max(0, Math.min(STD_H - 1, Math.round(box.top)))
  const width = Math.max(1, Math.min(Math.round(box.w), STD_W - left))
  const height = Math.max(1, Math.min(Math.round(box.h), STD_H - top))
  const raw = await sharp(png).extract({ left, top, width, height }).greyscale().raw().toBuffer()
  let max = 0
  let sum = 0
  for (const v of raw) { if (v > max) max = v; sum += v }
  return { max, mean: sum / raw.length }
}

/** A painted light mark on the dark test poster (auto layout is brught). */
const MARK_ON = 100
/** The bare dark background (any leftover mark is far brighter). */
const MARK_OFF = 40

/**
 * Quality-only input: ONE painted mark (`4K`), no A/V formats, no age pill and
 * no separate-rating column. This is the ordinary Settings defaults preview
 * shape and it takes the single-element branch of the quality group — the one
 * branch where the group bitmap used to BE the mark itself.
 */
function singleMarkInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return posterInput({ separateRatings: [], videoFormats: [], ...overrides })
}

async function renderWith(
  input: GenerationInput,
): Promise<{ png: Buffer; geometry: import("@/lib/poster-service").BadgeGeometryReport }> {
  let geometry: import("@/lib/poster-service").BadgeGeometryReport | null = null
  const png = await generatePosterBuffer({ ...input, onBadgeGeometry: (geo) => { geometry = geo } })
  return { png, geometry: geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport }
}

describe("per-item transforms on a SINGLE painted mark (single-element quality group)", () => {
  it("vacates the automatic slot and paints only at the corrected slot", async () => {
    const poster = await makePoster()
    const base = await renderWith(singleMarkInput({ posterBuf: poster }))
    const tier = base.geometry.items.find((i) => i.id === "quality:tier")!
    expect(tier).toBeDefined()
    expect(base.geometry.items).toHaveLength(1)

    const tuned = await renderWith(
      singleMarkInput({
        posterBuf: poster,
        badgeItemTransforms: { "quality:tier": { scale: 100, offsetX: 0, offsetY: 60 } },
      }),
    )
    const movedTier = tuned.geometry.items.find((i) => i.id === "quality:tier")!
    expect(movedTier.top).toBe(tier.top + 60)
    expect(movedTier.custom).toBe(true)

    // The mark left its automatic slot. The band ABOVE the corrected box is the
    // part of the old slot that no longer can hold the glyph: it must be
    // indistinguishable from a poster that never had the mark. (Regression: the
    // group bitmap kept the glyph, so the automatic slot stayed painted and the
    // badge looked stuck while only the overlay box moved.)
    // The old slot above the corrected copy, and the corrected copy itself
    // (which sits entirely below the automatic glyph: the two boxes only share
    // the automatic shadow padding, never the mark).
    const vacated = bandOf(tier, tier.top, movedTier.top - tier.top)
    const painted = movedTier
    // Automatic layout: the glyph is in the upper band, the lower band is empty.
    expect((await bandLuma(base.png, vacated)).max).toBeGreaterThan(MARK_ON)
    expect((await bandLuma(base.png, painted)).max).toBeLessThan(MARK_OFF)
    // Corrected layout: swapped — the old place is bare, the new place is painted.
    expect((await bandLuma(tuned.png, vacated)).max).toBeLessThan(MARK_OFF)
    expect((await bandLuma(tuned.png, painted)).max).toBeGreaterThan(MARK_ON)
    // The poster changed at all (a no-op is the reported "stuck" badge).
    expect(tuned.png.equals(base.png)).toBe(false)
  })

  it("an edge correction still changes the poster (never a no-op)", async () => {
    const poster = await makePoster()
    const base = await renderWith(singleMarkInput({ posterBuf: poster }))
    const tier = base.geometry.items.find((i) => i.id === "quality:tier")!

    // Push the mark off the canvas: the detached copy is clipped, so ANY
    // leftover of the original would render a byte-identical poster (the
    // reported overlay box moves while the image does not).
    const edge = await renderWith(
      singleMarkInput({
        posterBuf: poster,
        badgeItemTransforms: { "quality:tier": { scale: 100, offsetX: 200, offsetY: 0 } },
      }),
    )
    expect(edge.png.equals(base.png)).toBe(false)
    // The clipped copy leaves no visible mark, but the automatic slot is bare:
    // the only thing that changed is that the stuck original is gone.
    expect((await bandLuma(base.png, tier)).max).toBeGreaterThan(MARK_ON)
    expect((await bandLuma(edge.png, tier)).max).toBeLessThan(MARK_OFF)
  })

  it("an age-only group (no tier, no formats) detaches the same way", async () => {
    const poster = await makePoster()
    const base = await renderWith(
      singleMarkInput({ posterBuf: poster, quality: null, ageLabel: "T" }),
    )
    const age = base.geometry.items.find((i) => i.id === "quality:age")!
    expect(age).toBeDefined()
    expect(base.geometry.items).toHaveLength(1)

    const tuned = await renderWith(
      singleMarkInput({
        posterBuf: poster,
        quality: null,
        ageLabel: "T",
        badgeItemTransforms: { "quality:age": { scale: 100, offsetX: 0, offsetY: 60 } },
      }),
    )
    const movedAge = tuned.geometry.items.find((i) => i.id === "quality:age")!
    expect(movedAge.top).toBe(age.top + 60)
    const vacated = bandOf(age, age.top, movedAge.top - age.top)
    const painted = movedAge
    expect((await bandLuma(base.png, vacated)).max).toBeGreaterThan(MARK_ON)
    expect((await bandLuma(tuned.png, vacated)).max).toBeLessThan(MARK_OFF)
    expect((await bandLuma(tuned.png, painted)).max).toBeGreaterThan(MARK_ON)
    expect(await bandLuma(tuned.png, painted)).not.toEqual(await bandLuma(base.png, painted))
  })

  it("neutral/absent corrections keep the single-mark output byte-identical", async () => {
    const poster = await makePoster()
    const base = await renderWith(singleMarkInput({ posterBuf: poster }))
    const absent = await renderWith(singleMarkInput({ posterBuf: poster, badgeItemTransforms: null }))
    const neutral = await renderWith(
      singleMarkInput({
        posterBuf: poster,
        badgeItemTransforms: { "quality:tier": { scale: 100, offsetX: 0, offsetY: 0 } },
      }),
    )
    expect(absent.png.equals(base.png)).toBe(true)
    expect(neutral.png.equals(base.png)).toBe(true)
  })
})

describe("per-item transforms in the real render", () => {

  it("unconfigured output is byte-identical (automatic layout preserved)", async () => {
    const poster = await makePoster()
    const base = await generatePosterBuffer(posterInput({ posterBuf: poster }))
    const empty = await generatePosterBuffer(posterInput({ posterBuf: poster, badgeItemTransforms: {} }))
    const neutral = await generatePosterBuffer(
      posterInput({
        posterBuf: poster,
        badgeItemTransforms: { "rating:imdb": { scale: 100, offsetX: 0, offsetY: 0 } },
      }),
    )
    expect(empty.equals(base)).toBe(true)
    expect(neutral.equals(base)).toBe(true)
  })

  it("a configured rating correction changes pixels and moves only that pill", async () => {
    const poster = await makePoster()
    let geometry: import("@/lib/poster-service").BadgeGeometryReport | null = null
    const base = await generatePosterBuffer(
      posterInput({ posterBuf: poster, onBadgeGeometry: (geo) => { geometry = geo } }),
    )
    const baseGeometry = geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport
    const imdbBase = baseGeometry.items.find((i) => i.id === "rating:imdb")!
    const tmdbBase = baseGeometry.items.find((i) => i.id === "rating:tmdb")!
    expect(imdbBase).toBeDefined()
    expect(tmdbBase).toBeDefined()
    expect(imdbBase.custom).toBe(false)

    const tuned = await generatePosterBuffer(
      posterInput({
        posterBuf: poster,
        badgeItemTransforms: { "rating:imdb": { scale: 100, offsetX: 0, offsetY: 40 } },
        onBadgeGeometry: (geo) => { geometry = geo },
      }),
    )
    const tunedGeometry = geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport
    const imdbTuned = tunedGeometry.items.find((i) => i.id === "rating:imdb")!
    const tmdbTuned = tunedGeometry.items.find((i) => i.id === "rating:tmdb")!
    // Only the corrected pill moves; the neighbour keeps its slot.
    expect(imdbTuned.top).toBe(imdbBase.top + 40)
    expect(imdbTuned.left).toBe(imdbBase.left)
    expect(imdbTuned.custom).toBe(true)
    expect(tmdbTuned.top).toBe(tmdbBase.top)
    expect(tmdbTuned.custom).toBe(false)
    // Real pixels changed (the pill was composited at the new position).
    expect(tuned.equals(base)).toBe(false)
  })

  it("an item SCALE resizes only that badge around its own centre", async () => {
    const poster = await makePoster()
    let geometry: import("@/lib/poster-service").BadgeGeometryReport | null = null
    await generatePosterBuffer(
      posterInput({ posterBuf: poster, onBadgeGeometry: (geo) => { geometry = geo } }),
    )
    const baseGeometry = geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport
    const tmdbBase = baseGeometry.items.find((i) => i.id === "rating:tmdb")!
    const imdbBase = baseGeometry.items.find((i) => i.id === "rating:imdb")!

    await generatePosterBuffer(
      posterInput({
        posterBuf: poster,
        badgeItemTransforms: { "rating:tmdb": { scale: 150, offsetX: 0, offsetY: 0 } },
        onBadgeGeometry: (geo) => { geometry = geo },
      }),
    )
    const tuned = geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport
    const tmdbTuned = tuned.items.find((i) => i.id === "rating:tmdb")!
    const imdbTuned = tuned.items.find((i) => i.id === "rating:imdb")!
    expect(tmdbTuned.w).toBe(Math.round((tmdbBase.w * 150) / 100))
    expect(tmdbTuned.h).toBe(Math.round((tmdbBase.h * 150) / 100))
    // Grown about its own centre, not from its top-left corner.
    expect(Math.abs((tmdbTuned.left + tmdbTuned.w / 2) - (tmdbBase.left + tmdbBase.w / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs((tmdbTuned.top + tmdbTuned.h / 2) - (tmdbBase.top + tmdbBase.h / 2))).toBeLessThanOrEqual(1)
    // The neighbour is untouched.
    expect(imdbTuned.w).toBe(imdbBase.w)
    expect(imdbTuned.h).toBe(imdbBase.h)
  })

  it("a quality/AV correction moves only that mark of the stack", async () => {
    const poster = await makePoster()
    let geometry: import("@/lib/poster-service").BadgeGeometryReport | null = null
    await generatePosterBuffer(
      posterInput({ posterBuf: poster, onBadgeGeometry: (geo) => { geometry = geo } }),
    )
    const baseGeometry = geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport
    const tierId = "quality:tier"
    const dvId = "quality:format:dv"
    expect(baseGeometry.items.map((i) => i.id)).toContain(tierId)
    expect(baseGeometry.items.map((i) => i.id)).toContain(dvId)
    const tierBase = baseGeometry.items.find((i) => i.id === tierId)!
    const dvBase = baseGeometry.items.find((i) => i.id === dvId)!

    await generatePosterBuffer(
      posterInput({
        posterBuf: poster,
        badgeItemTransforms: { [tierId]: { scale: 100, offsetX: 25, offsetY: 0 } },
        onBadgeGeometry: (geo) => { geometry = geo },
      }),
    )
    const tuned = geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport
    expect(tuned.items.find((i) => i.id === tierId)!.left).toBe(tierBase.left + 25)
    expect(tuned.items.find((i) => i.id === dvId)!.left).toBe(dvBase.left)
  })
})

/**
 * The REJOIN recovery path: the editor's rejoin action deletes the stored
 * identities and the preview/save transport is recomputed from the resulting
 * map. This block feeds the resulting map back into the SAME renderer and
 * demands the group-only baseline back: identical BYTES and identical reported
 * boxes, with the sibling rating column untouched.
 */
describe("rejoin returns the recomposed quality stack to the group-only baseline", () => {
  /** Tier + age pill + merged Dolby combo: three painted quality elements. */
  const stackInput = (overrides: Partial<GenerationInput> = {}) =>
    posterInput({ videoFormats: ["dv", "atmos"], ageLabel: "T", ...overrides })

  const DETACHED = {
    "quality:tier": { scale: 140, offsetX: 0, offsetY: -30 },
    "quality:age": { scale: 90, offsetX: 4, offsetY: 4 },
    "quality:combo:dv-atmos": { scale: 120, offsetX: -6, offsetY: 3 },
    "rating:tmdb": { scale: 110, offsetX: 0, offsetY: 30 },
  } as const

  it("deleting the quality identities restores bytes and boxes; the rating stays tuned", async () => {
    const poster = await makePoster()
    let geometry: import("@/lib/poster-service").BadgeGeometryReport | null = null
    const render = async (badgeItemTransforms: GenerationInput["badgeItemTransforms"]) => {
      const png = await generatePosterBuffer(
        stackInput({ posterBuf: poster, badgeItemTransforms, onBadgeGeometry: (geo) => { geometry = geo } }),
      )
      return { png, geo: geometry as unknown as import("@/lib/poster-service").BadgeGeometryReport }
    }

    const base = await render(null)
    const ids = base.geo.items.map((item) => item.id)
    for (const id of ["quality:tier", "quality:age", "quality:combo:dv-atmos", "rating:tmdb"]) {
      expect(ids).toContain(id)
    }
    const detached = await render(DETACHED)
    // Sensitivity: the detached stack really changes the image.
    expect(detached.png.equals(base.png)).toBe(false)

    // The editor's rejoin: quality family only (shared primitives).
    const qualityRejoined = withoutBadgeItemFamily(
      parseBadgeItemTransforms(serializeBadgeItemTransforms(DETACHED)),
      "quality",
    )
    const afterQuality = await render(qualityRejoined)
    for (const id of ["quality:tier", "quality:age", "quality:combo:dv-atmos"]) {
      const baseBox = base.geo.items.find((item) => item.id === id)!
      const now = afterQuality.geo.items.find((item) => item.id === id)!
      expect(now).toEqual({ ...baseBox, custom: false })
    }
    // The rating correction was NOT swept.
    expect(afterQuality.geo.items.find((item) => item.id === "rating:tmdb")!.custom).toBe(true)

    // Rejoin the last correction too: byte-identical to the untouched render.
    const fullyRejoined = rejoinBadgeItems(qualityRejoined, ["rating:tmdb"])
    expect(serializeBadgeItemTransforms(fullyRejoined)).toBeNull()
    const back = await render(fullyRejoined)
    expect(back.png.equals(base.png)).toBe(true)
    expect(back.geo.items).toEqual(base.geo.items)
  })
})
