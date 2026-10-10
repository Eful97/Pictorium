/**
 * Fresh layout (`layout=fresh`): real composition inside the single renderer.
 *
 * Deterministic actual-render tests on generated fixtures (no network):
 * standard byte-identity (explicit standard vs absent), fresh on both canvas
 * shapes, rank validity 1..FRESH_RANK_MAX, no invented rank, shared rating
 * gates (custom priority, separate toggle, caps), column width/height fit,
 * in-canvas bounds with max rows + provider, glass-numeral modeling sanity,
 * artwork-derived fill, retained-chrome z-order, measured cold/warm timing.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import {
  freshGeometry,
  freshMetaRows,
  isFreshRank,
  renderFreshMetaColumn,
  composeFreshOverlay,
  FRESH_RANK_MAX,
  type FreshMetaInput,
} from "@/lib/fresh-layout"
import { LAND_W, LAND_H, STD_W, STD_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { RatingItem } from "@/lib/custom-rating/types"

async function flatBase(w: number, h: number, hex: string): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: hex } })
    .jpeg()
    .toBuffer()
}

/** Deterministic patterned artwork: gradient + shapes, exercises blur/fill. */
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

/** Ink width (rightmost-leftmost column with meaningful alpha): the glyph
 *  advance reality, not PNG dims. Threshold 100 skips the faint drop-shadow
 *  fringe while keeping every solid glyph core. */
async function inkWidth(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let maxX = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 100) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  return maxX >= minX ? maxX - minX + 1 : 0
}

/** Luminance variance inside a box (glass modeling sanity). */
async function boxVariance(buf: Buffer, left: number, top: number, w: number, h: number): Promise<number> {
  const { data, info } = await sharp(buf)
    .extract({ left, top, width: w, height: h })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const n = info.width * info.height
  let sum = 0
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  const mean = sum / n
  let sq = 0
  for (let i = 0; i < data.length; i += 4) {
    const d = (data[i] + data[i + 1] + data[i + 2]) / 3 - mean
    sq += d * d
  }
  return sq / n
}

describe("fresh rank validity (existing contract)", () => {
  it("accepts positive integers up to the hardening max, rejects the rest", () => {
    expect(FRESH_RANK_MAX).toBe(100)
    for (const rank of [1, 2, 9, 10, 20, 99, 100]) expect(isFreshRank(rank)).toBe(true)
    for (const rank of [0, -1, -20, 1.5, 6.5, NaN, Infinity, -Infinity, 101, 1000]) {
      expect(isFreshRank(rank)).toBe(false)
    }
    expect(isFreshRank(null)).toBe(false)
    expect(isFreshRank(undefined)).toBe(false)
  })
})

describe("fresh geometry (pure)", () => {
  it("fits every valid rank inside both canvases", () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      for (const rank of [1, 5, 9, 10, 11, 20, 99, 100]) {
        const geo = freshGeometry(CW, CH, rank)
        expect(geo.numeral).not.toBeNull()
        const box = geo.numeral!
        expect(box.text).toBe(String(rank))
        expect(box.fontSize).toBeGreaterThanOrEqual(24)
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.top).toBeGreaterThanOrEqual(0)
        expect(box.left + box.estW).toBeLessThanOrEqual(CW)
        expect(box.top + box.capH).toBeLessThanOrEqual(CH)
        expect(geo.metaTop).toBeLessThan(CH)
      }
    }
  })

  it("draws no numeral for invalid ranks (never invents one)", () => {
    for (const rank of [0, -3, 6.5, NaN, 101]) {
      expect(freshGeometry(STD_W, STD_H, rank).numeral).toBeNull()
      expect(freshGeometry(LAND_W, LAND_H, rank).numeral).toBeNull()
    }
    expect(freshGeometry(STD_W, STD_H, null).numeral).toBeNull()
    expect(freshGeometry(LAND_W, LAND_H, null).numeral).toBeNull()
  })
})

describe("fresh meta rows (shared gates)", () => {
  it("emits genre/rating/year rows when enabled and available", () => {
    const rows = freshMetaRows(metaInput({ customRatingsEnabled: true }))
    expect(rows.map((r) => r.kind)).toEqual(["genre", "rating", "year"])
  })

  it("invents nothing when values are missing or toggles are off", () => {
    expect(freshMetaRows(metaInput({ badgesEnabled: false }))).toEqual([])
    expect(freshMetaRows(metaInput({ genreName: null, voteAverage: 0, year: undefined })).map((r) => r.kind))
      .toEqual([])
    expect(freshMetaRows(metaInput({ badgeGenre: false, badgeYear: false, badgeRating: false }))).toEqual([])
  })

  it("renders no separate rows when the rating toggle is off, even with populated arrays", () => {
    const sep = [
      { id: "imdb", value: 8.7 },
      { id: "tmdb", value: 7.9 },
    ]
    const rows = freshMetaRows(
      metaInput({ badgeRating: false, separateRatingsEnabled: true, separateRatings: sep }),
    )
    expect(rows.some((r) => r.kind === "separate")).toBe(false)
    expect(rows.some((r) => r.kind === "rating")).toBe(false)
    // Genre/year follow their own toggles, unaffected.
    expect(rows.map((r) => r.kind)).toEqual(["genre", "year"])
  })

  it("prefers separate values over the average and caps at 5", () => {
    const rows = freshMetaRows(
      metaInput({
        separateRatingsEnabled: true,
        separateRatings: [
          { id: "imdb", value: 8.7 },
          { id: "tmdb", value: 7.9 },
          { id: "tomatoes", value: 8.8 },
          { id: "mal", value: 8.1 },
          { id: "trakt", value: 7.5 },
          { id: "simkl", value: 8.0 },
        ],
      }),
    )
    expect(rows.filter((r) => r.kind === "separate")).toHaveLength(5)
    // Icon + score rows: score-only text plus the source id (the column
    // renders the brand mark, no textual provider label).
    expect(rows.filter((r) => r.kind === "separate").map((r) => r.text)).toEqual([
      "8.7",
      "7.9",
      "88%",
      "8.1",
      "7.5",
    ])
    expect(rows.filter((r) => r.kind === "separate").map((r) => r.source)).toEqual([
      "imdb",
      "tmdb",
      "tomatoes",
      "mal",
      "trakt",
    ])
    expect(rows.some((r) => r.kind === "rating")).toBe(false)
  })

  it("gives custom rows priority over the separate column (never two stacks)", () => {
    const sep = [
      { id: "imdb", value: 8.7 },
      { id: "tmdb", value: 7.9 },
    ]
    const rows = freshMetaRows(
      metaInput({
        separateRatingsEnabled: true,
        separateRatings: sep,
        customRatingsEnabled: true,
        customRatings: customItems(2),
      }),
    )
    expect(rows.filter((r) => r.kind === "custom")).toHaveLength(2)
    expect(rows.some((r) => r.kind === "separate")).toBe(false)
    // Separate values active: no average alongside (same as the standard
    // genre badge dropping its segment when the column is active).
    expect(rows.some((r) => r.kind === "rating")).toBe(false)
  })

  it("keeps the average alongside custom rows when no separate values are active", () => {
    const rows = freshMetaRows(
      metaInput({ customRatingsEnabled: true, customRatings: customItems(2) }),
    )
    expect(rows.filter((r) => r.kind === "custom")).toHaveLength(2)
    expect(rows.some((r) => r.kind === "rating")).toBe(true)
  })

  it("supports the existing MAX_CUSTOM_RATINGS cap (5), skipping only non-finite values", () => {
    const rows = freshMetaRows(
      metaInput({
        customRatingsEnabled: true,
        customRatings: [
          ...customItems(6),
          { id: "nan", name: "NaN", value: NaN, format: "decimal" as const },
          { id: "inf", name: "Inf", value: Infinity, format: "decimal" as const },
        ],
      }),
    )
    // 6 finite items capped at 5 (same cap as the standard custom row);
    // non-finite values never render (same finite-only filter).
    expect(rows.filter((r) => r.kind === "custom")).toHaveLength(5)
  })

  it("suppresses custom rows in bottom styles (values render once via separate)", () => {
    const rows = freshMetaRows(
      metaInput({
        separateRatingsEnabled: true,
        separateRatingsStyle: "bottom-pills",
        separateRatings: [{ id: "imdb", value: 8.7 }],
        customRatingsEnabled: true,
        customRatings: customItems(2),
      }),
    )
    expect(rows.some((r) => r.kind === "custom")).toBe(false)
    expect(rows.filter((r) => r.kind === "separate")).toHaveLength(1)
  })
})

describe("fresh service rating gate (no inference from arrays)", () => {
  const SEP = [
    { id: "imdb", value: 8.7 },
    { id: "tmdb", value: 7.9 },
  ]

  it("direct caller: badgeRating false + populated arrays renders no separate", async () => {
    const poster = await flatBase(STD_W, STD_H, "#141419")
    const base = {
      posterBuf: poster,
      posterLayout: "fresh" as const,
      rankingEnabled: true,
      finalRank: 6,
      badgeRating: false,
    }
    const withSep = await generatePosterBuffer(baseInput({ ...base, separateRatings: SEP }))
    const noSep = await generatePosterBuffer(baseInput(base))
    expect(await dims(withSep)).toEqual({ w: STD_W, h: STD_H })
    // Array existence never re-enables the explicit false: genre + year
    // only in both renders (same as the standard column gate).
    expect(withSep.equals(noSep)).toBe(true)
  }, 90000)

  it("route passthrough: raw rating on still shows separate when effective is suppressed", async () => {
    const poster = await flatBase(STD_W, STD_H, "#141419")
    const sep = { separateRatings: SEP }
    // What the route sends when the separate column is active: the
    // effective badgeRating is suppressed (false) but the raw toggles
    // travel in freshRaw* (same shape/genre/year/vote otherwise).
    const routeSim = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
        badgeRating: false,
        ...sep,
        freshRawBadgeRating: true,
        freshRawSeparateRatings: true,
      }),
    )
    // Direct caller with the raw toggle on renders the identical column.
    const directOn = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
        badgeRating: true,
        ...sep,
      }),
    )
    const suppressed = await generatePosterBuffer(
      baseInput({
        posterBuf: poster,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
        badgeRating: false,
      }),
    )
    expect(await dims(routeSim)).toEqual({ w: STD_W, h: STD_H })
    expect(routeSim.equals(directOn)).toBe(true)
    // The separate rows actually render (not silently dropped).
    expect(routeSim.equals(suppressed)).toBe(false)
  }, 90000)
})

describe("fresh meta column fit (pure)", () => {
  const LONG_GENRE = "SUPERCALIFRAGILISTICHESPIRALIDOSO DOCUMENTARY FEATURE"
  const LONG_CUSTOM: RatingItem = {
    id: "long",
    name: "A Very Long Provider Name That Must Not Clip",
    value: 8.4,
    format: "decimal",
  }

  it("fits long genre/custom rows inside the column width", async () => {
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const geo = freshGeometry(CW, CH, 20)
      const rows = freshMetaRows(
        metaInput({
          genreName: LONG_GENRE,
          customRatingsEnabled: true,
          customRatings: [LONG_CUSTOM],
        }),
      )
      const col = await renderFreshMetaColumn(rows, geo)
      expect(col).not.toBeNull()
      expect(col!.w).toBeLessThanOrEqual(geo.zoneW)
      expect(col!.w).toBeLessThanOrEqual(CW)
    }
  })

  it("renders Hebrew/Arabic rows via the Rubik fallback inside the column", async () => {
    const geo = freshGeometry(STD_W, STD_H, 5)
    const rows = freshMetaRows(metaInput({ genreName: "דרמה" }))
    const col = await renderFreshMetaColumn(rows, geo)
    expect(col).not.toBeNull()
    expect(col!.w).toBeLessThanOrEqual(geo.zoneW)
    expect((await dims(col!.png)).w).toBe(col!.w)
  })

  it("keeps >200-char metadata glyph ink inside the available width", async () => {
    const LONG_GENRE = "SUPERCALIFRAGILISTICHESPIRALIDOSO DOCUMENTARY ".repeat(6).trim()
    const LONG_NAME = "An Extremely Long Provider Name That Must Never Clip Outside The Column ".repeat(4).trim()
    const LONG_SOURCE = "an-extremely-long-rating-source-id-that-must-never-clip-".repeat(5).replace(/-$/, "")
    expect(LONG_GENRE.length).toBeGreaterThan(200)
    expect(LONG_NAME.length).toBeGreaterThan(200)
    expect(LONG_SOURCE.length).toBeGreaterThan(200)
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const geo = freshGeometry(CW, CH, 5)
      // Genre branch (tracked caps) + custom branch (long provider name).
      const rows = freshMetaRows(
        metaInput({
          genreName: LONG_GENRE,
          customRatingsEnabled: true,
          customRatings: [{ id: "long", name: LONG_NAME, value: 8.4, format: "decimal" as const }],
        }),
      )
      expect(rows.length).toBeGreaterThan(0)
      const col = await renderFreshMetaColumn(rows, geo)
      expect(col).not.toBeNull()
      // Glyph ink reality (alpha>100 skips the faint shadow fringe), not
      // PNG dims: the block is always zoneW wide by construction.
      expect(await inkWidth(col!.png)).toBeLessThanOrEqual(geo.metaAvailW)
      // Separate branch (long source id, no custom priority above it).
      const sepRows = freshMetaRows(
        metaInput({
          genreName: LONG_GENRE,
          separateRatingsEnabled: true,
          separateRatings: [{ id: LONG_SOURCE, value: 8.7 }],
        }),
      )
      expect(sepRows.some((r) => r.kind === "separate")).toBe(true)
      const sepCol = await renderFreshMetaColumn(sepRows, geo)
      expect(sepCol).not.toBeNull()
      expect(await inkWidth(sepCol!.png)).toBeLessThanOrEqual(geo.metaAvailW)
    }
  })

  it("shrinks the block into a reserved max height", async () => {
    const geo = freshGeometry(STD_W, STD_H, 6)
    const rows = freshMetaRows(
      metaInput({
        separateRatingsEnabled: true,
        separateRatings: [
          { id: "imdb", value: 8.7 },
          { id: "tmdb", value: 7.9 },
          { id: "tomatoes", value: 8.8 },
        ],
        customRatingsEnabled: true,
        customRatings: customItems(5),
      }),
    )
    const full = await renderFreshMetaColumn(rows, geo)
    expect(full).not.toBeNull()
    const maxH = Math.max(60, Math.floor(full!.h * 0.6))
    const shrunk = await renderFreshMetaColumn(rows, geo, "inter", maxH)
    expect(shrunk).not.toBeNull()
    expect(shrunk!.h).toBeLessThanOrEqual(maxH)
    expect(shrunk!.w).toBeLessThanOrEqual(geo.zoneW)
  })
})

describe("fresh render", () => {
  it("keeps the standard path byte-identical (explicit standard vs absent)", async () => {
    const poster = await flatBase(STD_W, STD_H, "#141419")
    const logo = await whiteLogo()
    const withExtra = { rankingEnabled: true, queryExtra: "Staff Pick", logoFetch: logo }
    const absent = await generatePosterBuffer(baseInput({ posterBuf: poster, ...withExtra }))
    const explicit = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "standard", ...withExtra }),
    )
    expect(explicit.equals(absent)).toBe(true)
    const backdrop = await flatBase(LAND_W, LAND_H, "#141419")
    const absentLand = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, shape: "landscape", ...withExtra }),
    )
    const explicitLand = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, shape: "landscape", posterLayout: "standard", ...withExtra }),
    )
    expect(explicitLand.equals(absentLand)).toBe(true)
  }, 90000)

  it("renders both canvas shapes with correct dims and determinism", async () => {
    const poster = await flatBase(STD_W, STD_H, "#141419")
    const backdrop = await flatBase(LAND_W, LAND_H, "#141419")
    const logo = await whiteLogo()
    const freshPortrait = await generatePosterBuffer(
      baseInput({ posterBuf: poster, logoFetch: logo, posterLayout: "fresh", rankingEnabled: true, finalRank: 6 }),
    )
    const freshPortrait2 = await generatePosterBuffer(
      baseInput({ posterBuf: poster, logoFetch: logo, posterLayout: "fresh", rankingEnabled: true, finalRank: 6 }),
    )
    expect(freshPortrait.equals(freshPortrait2)).toBe(true)
    expect(await dims(freshPortrait)).toEqual({ w: STD_W, h: STD_H })
    const freshLand = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, shape: "landscape", logoFetch: logo, posterLayout: "fresh", rankingEnabled: true, finalRank: 5 }),
    )
    expect(await dims(freshLand)).toEqual({ w: LAND_W, h: LAND_H })
    // Fresh visibly differs from standard on the same inputs.
    const stdPortrait = await generatePosterBuffer(
      baseInput({ posterBuf: poster, logoFetch: logo, rankingEnabled: true, finalRank: 6 }),
    )
    expect(freshPortrait.equals(stdPortrait)).toBe(false)
    const stdLand = await generatePosterBuffer(
      baseInput({ posterBuf: backdrop, shape: "landscape", logoFetch: logo, rankingEnabled: true, finalRank: 5 }),
    )
    expect(freshLand.equals(stdLand)).toBe(false)
  }, 120000)

  it("renders actual landscape composites for rank 1 and rank 20 with long strings, max rows and provider", async () => {
    const backdrop = await patternedBase(LAND_W, LAND_H)
    const logo = await whiteLogo()
    const longGenre = "Supercalifragilistiche-spiralidoso Documentary Feature"
    const full = {
      posterBuf: backdrop,
      shape: "landscape" as const,
      logoFetch: logo,
      posterLayout: "fresh" as const,
      rankingEnabled: true,
      genreName: longGenre,
      networkLogo: true,
      tmdbNetworks: ["Netflix"],
      separateRatings: [
        { id: "imdb", value: 8.7 },
        { id: "tmdb", value: 7.9 },
        { id: "tomatoes", value: 8.8 },
      ],
      ratings: customItems(6),
    }
    const rank1 = await generatePosterBuffer(baseInput({ ...full, finalRank: 1 }))
    const rank20 = await generatePosterBuffer(baseInput({ ...full, finalRank: 20 }))
    expect(await dims(rank1)).toEqual({ w: LAND_W, h: LAND_H })
    expect(await dims(rank20)).toEqual({ w: LAND_W, h: LAND_H })
    expect(rank1.equals(rank20)).toBe(false)
    // No rank data + ranking on == ranking off: no numeral is ever invented.
    const noRankOn = await generatePosterBuffer(baseInput({ ...full, finalRank: null }))
    const rankOff = await generatePosterBuffer(
      baseInput({ ...full, finalRank: null, rankingEnabled: false }),
    )
    expect(noRankOn.equals(rankOff)).toBe(true)
    expect(rank1.equals(noRankOn)).toBe(false)
  }, 120000)

  it("keeps every fresh layer inside the canvas with max rows and provider", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const providerPng = await sharp({
      create: { width: 300, height: 120, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
    })
      .png()
      .toBuffer()
    for (const [CW, CH] of [[STD_W, STD_H], [LAND_W, LAND_H]] as const) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW,
        CH,
        rank: 20,
        meta: {
          badgesEnabled: true,
          badgeGenre: true,
          badgeYear: true,
          badgeRating: true,
          separateRatingsEnabled: true,
          separateRatingsStyle: "column",
          customRatingsEnabled: true,
          genreName: "Supercalifragilistiche-spiralidoso Documentary",
          year: "2024",
          voteAverage: 8.3,
          separateRatings: [
            { id: "imdb", value: 8.7 },
            { id: "tmdb", value: 7.9 },
            { id: "tomatoes", value: 8.8 },
          ],
          customRatings: customItems(6),
        },
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: providerPng, w: 300, h: 120 },
      })
      expect(layers.length).toBeGreaterThan(0)
      for (const layer of layers) {
        const m = await sharp(layer.input).metadata()
        const lw = m.width ?? 0
        const lh = m.height ?? 0
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left + lw).toBeLessThanOrEqual(CW)
        expect(layer.top + lh).toBeLessThanOrEqual(CH)
      }
    }
  }, 120000)

  it("keeps the retained chrome above the fresh shade (quality, Coming Soon, extra)", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const plain = baseInput({
      posterBuf: poster,
      logoFetch: logo,
      posterLayout: "fresh",
      rankingEnabled: true,
      finalRank: 6,
    })
    const ref = await generatePosterBuffer(plain)
    // Quality pill renders (changes bytes): it is composed, not darkened away.
    const withQuality = await generatePosterBuffer(baseInput({ ...plain, posterBuf: poster, quality: "4K" }))
    expect(withQuality.equals(ref)).toBe(false)
    expect(await dims(withQuality)).toEqual({ w: STD_W, h: STD_H })
    // Pre-release dim + Coming Soon ribbon render on top of the fresh shade.
    const withPre = await generatePosterBuffer(baseInput({ ...plain, posterBuf: poster, preRelease: true }))
    expect(withPre.equals(ref)).toBe(false)
    expect(await dims(withPre)).toEqual({ w: STD_W, h: STD_H })
    // An explicit extra badge renders above the fresh content.
    const withExtra = await generatePosterBuffer(
      baseInput({ ...plain, posterBuf: poster, queryExtra: "Staff Pick" }),
    )
    expect(withExtra.equals(ref)).toBe(false)
  }, 120000)

  it("renders ranks 1/9/10/11/20 distinctly and invents no rank when absent", async () => {
    const poster = await flatBase(STD_W, STD_H, "#141419")
    const seen = new Set<string>()
    for (const rank of [1, 9, 10, 11, 20]) {
      const buf = await generatePosterBuffer(
        baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: true, finalRank: rank }),
      )
      expect(await dims(buf)).toEqual({ w: STD_W, h: STD_H })
      seen.add(Buffer.from(buf).toString("base64").slice(0, 64) + String(buf.byteLength))
    }
    expect(seen.size).toBe(5)
    // No data + ranking on == ranking off: no numeral is ever invented.
    const noRankOn = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: true, finalRank: null }),
    )
    const rankOff = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: false, finalRank: null }),
    )
    expect(noRankOn.equals(rankOff)).toBe(true)
    // A real rank changes the render.
    const withRank = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: true, finalRank: 6 }),
    )
    expect(withRank.equals(noRankOn)).toBe(false)
  }, 120000)

  it("respects showBadges/genre/hideLogo/network toggles", async () => {
    const poster = await flatBase(STD_W, STD_H, "#141419")
    const logo = await whiteLogo()
    const full = baseInput({
      posterBuf: poster,
      logoFetch: logo,
      posterLayout: "fresh",
      rankingEnabled: true,
      finalRank: 6,
      networkLogo: true,
      tmdbNetworks: ["Netflix"],
    })
    const ref = await generatePosterBuffer(full)
    // Master badges toggle drops the meta column.
    expect((await generatePosterBuffer(baseInput({ ...full, posterBuf: poster, badgesEnabled: false }))).equals(ref)).toBe(false)
    // Genre component toggle drops the genre line.
    expect((await generatePosterBuffer(baseInput({ ...full, posterBuf: poster, badgeGenre: false }))).equals(ref)).toBe(false)
    // hideLogo drops the bottom-right title logo.
    expect((await generatePosterBuffer(baseInput({ ...full, posterBuf: poster, hideLogo: true }))).equals(ref)).toBe(false)
    // Network toggle drops the provider mark.
    expect((await generatePosterBuffer(baseInput({ ...full, posterBuf: poster, networkLogo: false }))).equals(ref)).toBe(false)
    // Missing title logo and missing provider are tolerated (still 200/dims).
    const noLogo = await generatePosterBuffer(
      baseInput({ posterBuf: poster, posterLayout: "fresh", rankingEnabled: true, finalRank: 6 }),
    )
    expect(await dims(noLogo)).toEqual({ w: STD_W, h: STD_H })
  }, 120000)

  it("renders on dark and bright fixtures", async () => {
    const logo = await whiteLogo()
    const dark = await generatePosterBuffer(
      baseInput({
        posterBuf: await flatBase(STD_W, STD_H, "#141419"),
        logoFetch: logo,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
      }),
    )
    const bright = await generatePosterBuffer(
      baseInput({
        posterBuf: await flatBase(STD_W, STD_H, "#e8e6e0"),
        logoFetch: logo,
        posterLayout: "fresh",
        rankingEnabled: true,
        finalRank: 6,
        topLight: true,
      }),
    )
    expect(dark.equals(bright)).toBe(false)
    expect(await dims(bright)).toEqual({ w: STD_W, h: STD_H })
  }, 90000)

  it("models the numeral (rim/shading), not a flat fill", async () => {
    const gray = await flatBase(STD_W, STD_H, "#808080")
    const geo = freshGeometry(STD_W, STD_H, 6)
    const box = geo.numeral!
    const withRank = await generatePosterBuffer(
      baseInput({ posterBuf: gray, posterLayout: "fresh", rankingEnabled: true, finalRank: 6, badgesEnabled: false }),
    )
    const noRank = await generatePosterBuffer(
      baseInput({ posterBuf: gray, posterLayout: "fresh", rankingEnabled: false, finalRank: null, badgesEnabled: false }),
    )
    // Numeral box footprint (glyph advance + bleed margin).
    const left = Math.max(0, box.left - 12)
    const top = Math.max(0, box.top - 12)
    const w = Math.min(STD_W - left, Math.ceil(box.estW) + 24)
    const h = Math.min(STD_H - top, box.capH + 24)
    const varRank = await boxVariance(withRank, left, top, w, h)
    const varNoRank = await boxVariance(noRank, left, top, w, h)
    expect(varRank).toBeGreaterThan(150)
    expect(varRank).toBeGreaterThan(varNoRank * 3)
  }, 90000)

  it("derives the numeral fill from the artwork (simplified frost, not a flat tint)", async () => {
    const darkLeft = await patternedBase(STD_W, STD_H, false)
    const lightLeft = await patternedBase(STD_W, STD_H, true)
    const geo = freshGeometry(STD_W, STD_H, 6)
    const box = geo.numeral!
    const left = Math.max(0, box.left - 12)
    const top = Math.max(0, box.top - 12)
    const w = Math.min(STD_W - left, Math.ceil(box.estW) + 24)
    const h = Math.min(STD_H - top, box.capH + 24)
    const a = await generatePosterBuffer(
      baseInput({ posterBuf: darkLeft, posterLayout: "fresh", rankingEnabled: true, finalRank: 6, badgesEnabled: false }),
    )
    const b = await generatePosterBuffer(
      baseInput({ posterBuf: lightLeft, posterLayout: "fresh", rankingEnabled: true, finalRank: 6, badgesEnabled: false }),
    )
    const cropA = await sharp(a).extract({ left, top, width: w, height: h }).raw().toBuffer()
    const cropB = await sharp(b).extract({ left, top, width: w, height: h }).raw().toBuffer()
    let diff = 0
    for (let i = 0; i < cropA.length; i++) diff += Math.abs(cropA[i] - cropB[i])
    // The two patterned artworks differ under the glyphs, so the frost fill
    // differs too: the numeral carries local artwork hues (no displacement,
    // per the documented approximation — but never a fixed tint).
    expect(diff / cropA.length).toBeGreaterThan(2)
  }, 90000)
})

describe("standard chrome regressions (targeted)", () => {
  it("keeps the standard custom provider row above the genre badge", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const std = { posterBuf: poster, logoFetch: logo, rankingEnabled: true, finalRank: 6 }
    const ref = await generatePosterBuffer(baseInput(std))
    const withCustom = await generatePosterBuffer(baseInput({ ...std, ratings: customItems(3) }))
    expect(withCustom.equals(ref)).toBe(false)
    expect(await dims(withCustom)).toEqual({ w: STD_W, h: STD_H })
  }, 90000)

  it("keeps the standard separate column replacing the average", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const std = { posterBuf: poster, logoFetch: logo, rankingEnabled: true, finalRank: 6 }
    const ref = await generatePosterBuffer(baseInput(std))
    const withSeparate = await generatePosterBuffer(
      baseInput({
        ...std,
        separateRatings: [
          { id: "imdb", value: 8.7 },
          { id: "tmdb", value: 7.9 },
        ],
      }),
    )
    expect(withSeparate.equals(ref)).toBe(false)
    expect(await dims(withSeparate)).toEqual({ w: STD_W, h: STD_H })
  }, 90000)
})

describe("fresh vs standard timing (measured, same patterned fixture)", () => {
  it("reports first-call vs cached-call ms and bytes without asserting speed", async () => {
    const poster = await patternedBase(STD_W, STD_H)
    const logo = await whiteLogo()
    const freshArgs = {
      posterBuf: poster,
      logoFetch: logo,
      posterLayout: "fresh" as const,
      rankingEnabled: true,
      finalRank: 6,
    }
    const stdArgs = { posterBuf: poster, logoFetch: logo, rankingEnabled: true, finalRank: 6 }
    // NOTE: module-level badge/overlay caches are shared across layouts and
    // tests in this worker, so "first-call" is only first-call *here*, not a
    // true cold process. Numbers are measured observations for the report,
    // not a general performance claim.
    const tF0 = performance.now()
    const fFirst = await generatePosterBuffer(baseInput(freshArgs))
    const tF1 = performance.now()
    const fCached = await generatePosterBuffer(baseInput(freshArgs))
    const tF2 = performance.now()
    const tS0 = performance.now()
    const sFirst = await generatePosterBuffer(baseInput(stdArgs))
    const tS1 = performance.now()
    const sCached = await generatePosterBuffer(baseInput(stdArgs))
    const tS2 = performance.now()
    console.log(
      `[fresh-perf] fresh first=${(tF1 - tF0).toFixed(0)}ms cached=${(tF2 - tF1).toFixed(0)}ms bytes=${fFirst.byteLength} | ` +
      `standard first=${(tS1 - tS0).toFixed(0)}ms cached=${(tS2 - tS1).toFixed(0)}ms bytes=${sFirst.byteLength}`,
    )
    expect(fFirst.equals(fCached)).toBe(true)
    expect(sFirst.equals(sCached)).toBe(true)
    expect(fFirst.equals(sFirst)).toBe(false)
    for (const buf of [fFirst, sFirst]) {
      expect(await dims(buf)).toEqual({ w: STD_W, h: STD_H })
      expect(buf.byteLength).toBeGreaterThan(5000)
    }
  }, 120000)
})
