/**
 * P5: cover layouts ("provider-glass" | "nuvio" | "stremio") through the
 * EXISTING single poster-service pipeline (serial builder, no new endpoint,
 * no new query param, no duplicate fetch/network/renderer).
 *
 * Contract under test (real `generatePosterBuffer` renders, sha equality, no
 * pinned values):
 * - the real service endpoint path invokes Card for all 3 skins x 2 shapes
 *   at exact canvas dims, distinct from Standard with the same settings;
 * - scope follows the shared `posterFreshScope` chain (default "ranked"):
 *   Card is effective only when a cover layout is selected AND (scope "all"
 *   OR a valid DISPLAYED Card rank 1..20, already rankingEnabled-gated);
 *   default-ranked invalid/absent/ranking-disabled renders Standard
 *   byte-identical; scope-all without a rank renders Card with NO numeral
 *   (never an invented rank);
 * - Card stops at 20 (rank 21/100 fall back to Standard) while the Fresh
 *   1..100 gate is untouched;
 * - query/config/mapping/defaults inheritance is unchanged and the same
 *   client preview URL resolves to the actual Card render;
 * - missing provider / hidden title logo degrade safely (exact dims);
 * - all 5 resolved separate ratings flow through (not truncated at 3),
 *   honoring the resolved order — no invented genre/year/ratings.
 */
import sharp from "sharp"
import { createHash } from "node:crypto"
import { describe, it, expect } from "vitest"
import { generatePosterBuffer, resolveCardBrandAccent, type GenerationInput } from "@/lib/poster-service"
import { cardMetadataBand } from "@/lib/card-layout"
import { cardLayoutGeometry } from "@/lib/card-layout-geometry"
import { isEffectiveCardLayout } from "@/lib/card-layout-skins"
import { isEffectiveFreshLayout } from "@/lib/fresh-layout"
import { resolvePosterLayout, resolvePosterRenderConfig } from "@/lib/poster-config"
import { buildPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { MAX_SEPARATE_RATINGS } from "@/lib/ratings"
import { STD_H, STD_W, LAND_H, LAND_W } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { Mapping } from "@/lib/types"

const SKINS = ["provider-glass", "nuvio", "stremio"] as const

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

function mapping(over: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }
}

const FIVE_SEPARATE = [
  { id: "imdb", value: 7.3 },
  { id: "tmdb", value: 8.1 },
  { id: "tomatoes", value: 8.8 },
  { id: "letterboxd", value: 3.9 },
  { id: "trakt", value: 7.7 },
] as const

describe("isEffectiveCardLayout gate", () => {
  it("is effective only for the three cover layouts", () => {
    for (const skin of SKINS) {
      expect(isEffectiveCardLayout(skin, "all", null)).toBe(true)
      expect(isEffectiveCardLayout(skin, "ranked", 7)).toBe(true)
    }
    for (const other of ["standard", "fresh", "", "bogus", null, undefined]) {
      expect(isEffectiveCardLayout(other, "all", 7)).toBe(false)
      expect(isEffectiveCardLayout(other, "ranked", 7)).toBe(false)
    }
  })

  it("ranked (default) needs a valid displayed Card rank 1..20", () => {
    expect(isEffectiveCardLayout("provider-glass", "ranked", 1)).toBe(true)
    expect(isEffectiveCardLayout("nuvio", "ranked", 20)).toBe(true)
    for (const bad of [null, undefined, 0, -3, 21, 42, 100, 1.5, NaN]) {
      expect(isEffectiveCardLayout("stremio", "ranked", bad as number | null)).toBe(false)
    }
  })

  it("absent/invalid scope fails closed to ranked (shared default)", () => {
    expect(isEffectiveCardLayout("provider-glass", undefined, 7)).toBe(true)
    expect(isEffectiveCardLayout("provider-glass", undefined, null)).toBe(false)
    expect(isEffectiveCardLayout("provider-glass", "bogus", 7)).toBe(true)
    expect(isEffectiveCardLayout("provider-glass", "bogus", null)).toBe(false)
    expect(isEffectiveCardLayout("provider-glass", null, 21)).toBe(false)
  })

  it("explicit all renders Card without a rank (numeral omitted, never invented)", () => {
    for (const rank of [null, undefined, 0, 21, 100]) {
      expect(isEffectiveCardLayout("nuvio", "all", rank as number | null)).toBe(true)
    }
  })

  it("Card stops at 20 while the Fresh 1..100 gate is untouched", () => {
    expect(isEffectiveCardLayout("provider-glass", "ranked", 21)).toBe(false)
    expect(isEffectiveCardLayout("provider-glass", "ranked", 100)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", 21)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", "ranked", 100)).toBe(true)
  })
})

describe("service Card integration (real renders, equality, no pins)", () => {
  it("renders all 3 skins x 2 shapes at exact dims, distinct from Standard", async () => {
    expect(MAX_SEPARATE_RATINGS).toBe(5)
    const logo = await whiteLogo()
    for (const [w, h, shape] of [
      [STD_W, STD_H, "poster"],
      [LAND_W, LAND_H, "landscape"],
    ] as const) {
      const base = await patternedBase(w, h)
      const standard = sha(
        await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, shape, posterLayout: "standard", finalRank: 7 }),
        ),
      )
      for (const skin of SKINS) {
        const out = await generatePosterBuffer(
          baseInput({ posterBuf: base, logoFetch: logo, shape, posterLayout: skin, finalRank: 7 }),
        )
        const meta = await sharp(out).metadata()
        expect({ w: meta.width, h: meta.height }).toEqual({ w, h })
        // Negative control: a Card layout with a valid rank really renders
        // Card (not Standard with the same settings).
        expect(sha(out)).not.toBe(standard)
      }
    }
  }, 240000)

  it("ranked gating: absent/invalid/disabled rank falls back to byte-identical Standard", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const std = async (rank: number | null, extra: Partial<GenerationInput> = {}) =>
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", finalRank: rank, ...extra })))
    const card = async (rank: number | null, extra: Partial<GenerationInput> = {}) =>
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "provider-glass", posterFreshScope: "ranked", finalRank: rank, ...extra })))
    // Absent rank: fallback equals Standard with the same (rank-less) settings.
    expect(await card(null)).toBe(await std(null))
    // Invalid ranks (zero, above the Card max): same-settings Standard equality.
    for (const bad of [0, 21, 100]) {
      expect(await card(bad)).toBe(await std(bad))
    }
    // Disabled ranking (rank data present but gated off): Standard equality.
    expect(await card(7, { rankingEnabled: false })).toBe(await std(7, { rankingEnabled: false }))
    // Scope is inert on Standard: ranked == all.
    expect(await std(7, { posterFreshScope: "all" })).toBe(await std(7, { posterFreshScope: "ranked" }))
  }, 240000)

  it("ranked with a valid rank equals scope-all; absent scope behaves ranked; landscape matches", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = async (over: Partial<GenerationInput>) =>
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, ...over })))
    const all = await render({ posterLayout: "nuvio", posterFreshScope: "all", finalRank: 7 })
    expect(await render({ posterLayout: "nuvio", posterFreshScope: "ranked", finalRank: 7 })).toBe(all)
    // Absent scope is the ranked default: valid rank still renders Card.
    expect(await render({ posterLayout: "nuvio", finalRank: 7 })).toBe(all)
    // Absent scope without a rank falls back to Standard.
    expect(await render({ posterLayout: "nuvio", finalRank: null })).toBe(
      await render({ posterLayout: "standard", finalRank: null }),
    )
    // Scope-all without a rank renders Card (no numeral), not Standard.
    expect(await render({ posterLayout: "nuvio", posterFreshScope: "all", finalRank: null })).not.toBe(
      await render({ posterLayout: "standard", finalRank: null }),
    )
    // Landscape: same fallback + active equalities.
    const landBase = await patternedBase(LAND_W, LAND_H)
    const land = async (over: Partial<GenerationInput>) =>
      sha(
        await generatePosterBuffer(baseInput({ posterBuf: landBase, logoFetch: logo, shape: "landscape", ...over })),
      )
    expect(await land({ posterLayout: "stremio", posterFreshScope: "ranked", finalRank: null })).toBe(
      await land({ posterLayout: "standard", finalRank: null }),
    )
    const landAll = await land({ posterLayout: "stremio", posterFreshScope: "all", finalRank: 12 })
    expect(await land({ posterLayout: "stremio", posterFreshScope: "ranked", finalRank: 12 })).toBe(landAll)
    expect(landAll).not.toBe(await land({ posterLayout: "standard", finalRank: 12 }))
  }, 240000)

  it("rank 20 draws the numeral, rank 21 does not (measured service bytes)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = async (over: Partial<GenerationInput>) =>
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, ...over })))
    const card20 = await render({ posterLayout: "provider-glass", posterFreshScope: "ranked", finalRank: 20 })
    const std20 = await render({ posterLayout: "standard", finalRank: 20 })
    expect(card20).not.toBe(std20)
    // 21+ is out of the Card contract: same-settings Standard equality.
    expect(await render({ posterLayout: "provider-glass", posterFreshScope: "ranked", finalRank: 21 })).toBe(
      await render({ posterLayout: "standard", finalRank: 21 }),
    )
    // The numeral itself paints: rank 20 differs from the unranked Card.
    expect(card20).not.toBe(
      await render({ posterLayout: "provider-glass", posterFreshScope: "all", finalRank: null }),
    )
  }, 240000)

  it("all five resolved separate ratings aggregate to ONE score (not truncated at three)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7, ...over }))
    const five = sha(await render({ separateRatings: [...FIVE_SEPARATE] }))
    const three = sha(await render({ separateRatings: [...FIVE_SEPARATE].slice(0, 3) }))
    const none = sha(await render({ separateRatings: undefined }))
    // P8 intentional change: the 4th/5th values move the ONE aggregate mean
    // (a cap-3 truncation would make five identical to three).
    expect(five).not.toBe(three)
    expect(three).not.toBe(none)
    expect(five).not.toBe(none)
    // P15 intentional change vs the aggregate-only era: the separate column
    // preserves source order (user contract), so a reordered selection paints
    // reordered individuals — while the aggregate feeding the main badge stays
    // order-independent (proven at helper level in poster-card-render.test.ts
    // and poster-card-standard-badge.test.ts).
    expect(sha(await render({ separateRatings: [...FIVE_SEPARATE].reverse() }))).not.toBe(five)
    // Changing only the 5th selected source moves the aggregate.
    const changed5 = [...FIVE_SEPARATE].map((s, i) => (i === 4 ? { ...s, value: 1.1 } : s))
    expect(sha(await render({ separateRatings: changed5 }))).not.toBe(five)
    // Badges off silences the metadata band (same-settings equality).
    expect(
      sha(await render({ separateRatings: [...FIVE_SEPARATE], badgesEnabled: false })),
    ).toBe(sha(await render({ separateRatings: undefined, badgesEnabled: false })))
    // Card metadata path differs from the Standard column with the same data.
    const stdFive = sha(
      await generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", finalRank: 7, separateRatings: [...FIVE_SEPARATE] }),
      ),
    )
    expect(five).not.toBe(stdFive)
  }, 240000)

  it("missing provider and hidden title logo degrade safely at exact dims", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "provider-glass", finalRank: 7, ...over }))
    // Missing provider (default harness state): exact dims, opaque render.
    const noProvider = await render({})
    expect(await sharp(noProvider).metadata()).toMatchObject({ width: STD_W, height: STD_H })
    // Resolved brand mark flows into the Card without error.
    const withProvider = await render({ networkLogo: true, tmdbNetworks: ["Netflix"] })
    expect(await sharp(withProvider).metadata()).toMatchObject({ width: STD_W, height: STD_H })
    expect(sha(withProvider)).not.toBe(sha(noProvider))
    // Hidden title logo: renders (omits the mark), distinct from the logo render.
    const hidden = await render({ hideLogo: true })
    expect(await sharp(hidden).metadata()).toMatchObject({ width: STD_W, height: STD_H })
    expect(sha(hidden)).not.toBe(sha(noProvider))
    // Landscape pair stays safe too.
    const landBase = await patternedBase(LAND_W, LAND_H)
    const landHidden = await generatePosterBuffer(
      baseInput({ posterBuf: landBase, logoFetch: logo, shape: "landscape", posterLayout: "nuvio", finalRank: 7, hideLogo: true }),
    )
    expect(await sharp(landHidden).metadata()).toMatchObject({ width: LAND_W, height: LAND_H })
  }, 240000)

  it("kept chrome (quality, Coming Soon, extra) applies over the Card base", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = async (over: Partial<GenerationInput>) =>
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "provider-glass", finalRank: 7, ...over })))
    const plain = await render({})
    // Quality pill (top-right) paints over Card.
    expect(await render({ quality: "4K" })).not.toBe(plain)
    // Pre-release dim + Coming Soon ribbon apply without error.
    expect(await render({ preRelease: true })).not.toBe(plain)
    // Extra top badge under scope-all (ranked would fall back: extra
    // suppresses the displayed rank): paints over the unranked Card.
    const allPlain = await render({ posterFreshScope: "all", finalRank: null })
    expect(await render({ posterFreshScope: "all", finalRank: null, queryExtra: "Da non perdere" })).not.toBe(allPlain)
  }, 240000)

  it("query/config/mapping/defaults inheritance is unchanged for cover layouts", async () => {
    const sd: ServerDefaults = {}
    // Query wins over an inherited fresh mapping.
    expect(
      resolvePosterLayout(new URLSearchParams("layout=provider-glass"), mapping({ posterLayout: "fresh" }), null, sd, "poster"),
    ).toBe("provider-glass")
    // Mapping + defaults carry cover layouts per shape.
    expect(resolvePosterLayout(new URLSearchParams(""), mapping({ posterLayout: "nuvio" }), null, sd, "poster")).toBe("nuvio")
    expect(resolvePosterLayout(new URLSearchParams(""), mapping(), null, { posterLayout: "stremio" }, "poster")).toBe("stremio")
    // Render config exposes the resolved cover layout + scope.
    const cfg = resolvePosterRenderConfig({
      searchParams: new URLSearchParams("layout=nuvio&freshScope=all"),
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(cfg.posterLayout).toBe("nuvio")
    expect(cfg.posterFreshScope).toBe("all")
    // Stremio params: explicit cover layout travels, absent stays absent.
    expect(buildStremioPosterSearchParams({ posterLayout: "stremio" }).get("layout")).toBe("stremio")
    expect(buildStremioPosterSearchParams({}).get("layout")).toBeNull()
  })

  it("the same client preview URL resolves to the actual Card render", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const url = buildPreviewUrl(
      {
        selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
        previewPoster: null,
        selectedLogo: null,
        selectedBackdrop: null,
        logoScale: 75,
        logoOffsetX: 0,
        logoOffsetY: 0,
        backdropScale: 100,
        backdropOffsetX: 0,
        backdropOffsetY: 0,
        metaInfo: { genres: [], voteAverage: 0 },
        trendRank: null,
        mdblistAnimeList: [],
        topEdgeColor: null,
        bottomEdgeColor: null,
        accentColor: null,
        autoAccentColor: null,
        lang: "it",
        tmdbKey: "k",
        userId: null,
      } as never,
      {
        globalBadges: true,
        rankingBadges: true,
        badgeStyle: "shadow",
        rankingBadgeStyle: "default",
        customBadge: null,
        gradientHeight: 30,
        blurIntensity: 20,
        blurFade: 50,
        blurDarkness: 30,
        blurEnabled: true,
        topBadgeScale: 100,
        topBadgeOffsetX: 0,
        topBadgeOffsetY: 0,
        genreBadgeScale: 100,
        genreBadgeOffsetX: 0,
        genreBadgeOffsetY: 0,
        qualityBadgeScale: 100,
        qualityBadgeOffsetX: 0,
        qualityBadgeOffsetY: 0,
        networkLogoScale: 100,
        networkLogoOffsetX: 0,
        networkLogoOffsetY: 0,
        posterLayout: "provider-glass",
        posterFreshScope: "ranked",
      } as never,
    )
    const params = new URL(String(url), "http://localhost").searchParams
    expect(params.get("layout")).toBe("provider-glass")
    // The server resolves the same layout/scope from that client URL…
    const cfg = resolvePosterRenderConfig({
      searchParams: params,
      mapping: null,
      configOverride: null,
      sd: {},
      hasQuery: false,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: 7,
    })
    expect(cfg.posterLayout).toBe("provider-glass")
    // …and renders the actual Card bytes (identical to the direct render).
    const viaUrl = sha(
      await generatePosterBuffer(
        baseInput({
          posterBuf: base,
          logoFetch: logo,
          posterLayout: cfg.posterLayout,
          posterFreshScope: cfg.posterFreshScope,
          finalRank: 7,
        }),
      ),
    )
    const direct = sha(
      await generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "provider-glass", posterFreshScope: "ranked", finalRank: 7 }),
      ),
    )
    expect(viaUrl).toBe(direct)
    expect(viaUrl).not.toBe(
      sha(await generatePosterBuffer(baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "standard", finalRank: 7 }))),
    )
  }, 240000)
})

describe("resolveCardBrandAccent unit (no renders, synthetic bitmaps)", () => {
  async function solidPng(r: number, g: number, b: number): Promise<Buffer> {
    return sharp({
      create: { width: 24, height: 12, channels: 4, background: { r, g, b, alpha: 1 } },
    })
      .png()
      .toBuffer()
  }

  it("manual accent wins when valid, even over a colored brand bitmap", async () => {
    const red = await solidPng(229, 9, 20)
    expect(await resolveCardBrandAccent({ png: red }, { genreColor: "#00ff00", rankColor: "#00ff00" })).toBe("#00ff00")
  })

  it("colored brand bitmap resolves automatically without an override", async () => {
    const hex = await resolveCardBrandAccent({ png: await solidPng(229, 9, 20) }, null)
    expect(hex).not.toBeNull()
    const r = parseInt(hex!.slice(1, 3), 16)
    const g = parseInt(hex!.slice(3, 5), 16)
    const b = parseInt(hex!.slice(5, 7), 16)
    expect(r - g).toBeGreaterThan(100)
    expect(r - b).toBeGreaterThan(100)
  })

  it("white / achromatic / missing / garbage brands fall back to documented neutral (null)", async () => {
    expect(await resolveCardBrandAccent({ png: await solidPng(255, 255, 255) }, null)).toBeNull()
    expect(await resolveCardBrandAccent({ png: await solidPng(120, 120, 120) }, null)).toBeNull()
    expect(await resolveCardBrandAccent({ png: await solidPng(0, 0, 0) }, null)).toBeNull()
    expect(await resolveCardBrandAccent(null, null)).toBeNull()
    expect(await resolveCardBrandAccent(undefined, null)).toBeNull()
    expect(await resolveCardBrandAccent({ png: Buffer.from("not-an-image") }, null)).toBeNull()
    // Invalid manual accent never leaks through: falls back to the bitmap.
    const hex = await resolveCardBrandAccent({ png: await solidPng(229, 9, 20) }, { genreColor: "red", rankColor: "red" })
    expect(hex).not.toBe("red")
    expect(hex).not.toBeNull()
  })
})

/**
 * Mean color of a glass-body block in the rank gutter (x 30..70, y 30..70:
 * inside the glass frame, left of the artwork card on both shapes, above the
 * numeral ink and every badge slot), so it samples the provider-glass skin
 * background itself — not artwork, numeral ink or badge pixels. Probed
 * values (poster, scope-all unranked): Netflix auto ≈ (69,33,39) at mid
 * gutter and (90,44,48) here; neutral ≈ (48,49,52)/(64,64,64); manual green
 * ≈ (31,82,34)/(42,106,42). Thresholds hold ±20 margins around those.
 */
async function glassMean(png: Buffer): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = 30; y < 70; y++) {
    for (let x = 30; x < 70; x++) {
      const o = (y * W + x) * 4
      r += data[o] ?? 0
      g += data[o + 1] ?? 0
      b += data[o + 2] ?? 0
      n++
    }
  }
  return { r: r / n, g: g / n, b: b / n }
}

function expectRedGlass(mean: { r: number; g: number; b: number }) {
  expect(mean.r - mean.g).toBeGreaterThan(25)
  expect(mean.r - mean.b).toBeGreaterThan(25)
}

function expectNeutralGlass(mean: { r: number; g: number; b: number }) {
  expect(Math.abs(mean.r - mean.g)).toBeLessThan(25)
  expect(Math.abs(mean.r - mean.b)).toBeLessThan(25)
  expect(Math.abs(mean.g - mean.b)).toBeLessThan(25)
}

describe("service Card automatic provider-glass brand tint (pixel proof)", () => {
  it("recognized Netflix WITHOUT accentOverride renders a red brand tint (poster, ranked + unranked)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "provider-glass", finalRank: 7, ...over }),
      )
    // Recognized provider, no manual accent: automatic brand color, with and
    // without the numeral (scope-all renders Card with no numeral).
    const auto = await render({ networkLogo: true, tmdbNetworks: ["Netflix"] })
    expectRedGlass(await glassMean(auto))
    const autoUnranked = await render({
      networkLogo: true,
      tmdbNetworks: ["Netflix"],
      posterFreshScope: "all",
      finalRank: null,
    })
    expectRedGlass(await glassMean(autoUnranked))
    // Missing provider: documented neutral gray glass (not a brand guess).
    const neutral = await render({})
    expectNeutralGlass(await glassMean(neutral))
    const neutralUnranked = await render({ posterFreshScope: "all", finalRank: null })
    expectNeutralGlass(await glassMean(neutralUnranked))
    expect(sha(auto)).not.toBe(sha(neutral))
    expect(sha(autoUnranked)).not.toBe(sha(neutralUnranked))
  }, 240000)

  it("recognized Netflix WITHOUT accentOverride renders a red brand tint (landscape, double rank)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(LAND_W, LAND_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, shape: "landscape", posterLayout: "provider-glass", finalRank: 20, ...over }),
      )
    const auto = await render({ networkLogo: true, tmdbNetworks: ["Netflix"] })
    expectRedGlass(await glassMean(auto))
    const neutral = await render({})
    expectNeutralGlass(await glassMean(neutral))
    expect(sha(auto)).not.toBe(sha(neutral))
  }, 240000)

  it("manual accentOverride wins on provider-glass but stays inert on nuvio/stremio", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({
          posterBuf: base,
          logoFetch: logo,
          posterLayout: "provider-glass",
          finalRank: 7,
          networkLogo: true,
          tmdbNetworks: ["Netflix"],
          ...over,
        }),
      )
    // Explicit user accent (existing `ac=`/mapping semantics) tints the glass.
    const manual = await render({ accentOverride: { genreColor: "#00ff00", rankColor: "#00ff00" } })
    const green = await glassMean(manual)
    expect(green.g - green.r).toBeGreaterThan(25)
    expect(green.g - green.b).toBeGreaterThan(25)
    const auto = await render({})
    expect(sha(manual)).not.toBe(sha(auto))
    // Nuvio (solid black) and Stremio (fixed violet) backgrounds ignore any
    // accent: the sampled glass block stays identical. (Full bytes still
    // differ on nuvio by design — its numeral neon glow follows the accent
    // through the skins contract — so the assertion is pixel-scoped, not
    // byte-scoped.)
    for (const skin of ["nuvio", "stremio"] as const) {
      const mk = (accent: { genreColor: string; rankColor: string } | null) =>
        generatePosterBuffer(
          baseInput({
            posterBuf: base,
            logoFetch: logo,
            posterLayout: skin,
            finalRank: 7,
            networkLogo: true,
            tmdbNetworks: ["Netflix"],
            accentOverride: accent,
          }),
        )
      const a = await glassMean(await mk(null))
      const b = await glassMean(
        await mk({ genreColor: "#00ff00", rankColor: "#00ff00" }),
      )
      expect(Math.abs(a.r - b.r)).toBeLessThan(8)
      expect(Math.abs(a.g - b.g)).toBeLessThan(8)
      expect(Math.abs(a.b - b.b)).toBeLessThan(8)
      if (skin === "nuvio") {
        expect(a.r).toBeLessThan(12)
        expect(a.g).toBeLessThan(12)
        expect(a.b).toBeLessThan(12)
      }
    }
  }, 240000)
})

describe("service Card ordinary rating path (no silent drop)", () => {
  it("ordinary TMDB average renders when enabled, nothing when disabled", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7, ...over }),
      )
    // No separate/custom rows: the ordinary ★ average still paints.
    const withAvg = sha(await render({ voteAverage: 8.3 }))
    expect(withAvg).not.toBe(sha(await render({ voteAverage: null })))
    expect(sha(await render({ voteAverage: 8.3 }))).toBe(withAvg)
    expect(sha(await render({ voteAverage: 4.1 }))).not.toBe(withAvg)
    // Rating toggle off silences the average (same-settings equality).
    expect(sha(await render({ badgeRating: false, voteAverage: 8.3 }))).toBe(
      sha(await render({ badgeRating: false, voteAverage: null })),
    )
    // Badges off silences the whole metadata band.
    expect(sha(await render({ badgesEnabled: false, voteAverage: 8.3 }))).toBe(
      sha(await render({ badgesEnabled: false, voteAverage: null })),
    )
  }, 240000)

  it("custom provider values aggregate without separateRatings and keep historic priority", async () => {
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
    const none = sha(await render({ ratings: undefined, voteAverage: null }))
    expect(withCustom).not.toBe(none)
    // P8 intentional change: custom providers collapse to ONE aggregate mean
    // ((7.3 + 8.0) / 2 = 7.65 -> "7.7") for the main badge — while P15 renders
    // the individuals through the existing custom row, which preserves source
    // order (user contract): reordered customs repaint reordered pills, but
    // the aggregate stays order-independent (helper-level proof elsewhere).
    expect(sha(await render({ ratings: [...customs], voteAverage: null }))).toBe(withCustom)
    expect(sha(await render({ ratings: [...customs].reverse(), voteAverage: null }))).not.toBe(withCustom)
    // A rendered custom row keeps historic priority: the ordinary average is
    // suppressed (never two rating stacks from the same values).
    expect(sha(await render({ ratings: [...customs], voteAverage: 8.3 }))).toBe(withCustom)
  }, 240000)

  it("active separate column suppresses the ordinary average (single stack)", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7, ...over }),
      )
    const seps = [...FIVE_SEPARATE]
    expect(sha(await render({ separateRatings: seps, voteAverage: 8.3 }))).toBe(
      sha(await render({ separateRatings: seps, voteAverage: null })),
    )
  }, 240000)
})

describe("service Card bottom-blur ordering (artwork-only, chrome stays sharp)", () => {
  async function brightChecker(w: number, h: number): Promise<Buffer> {
    const cell = 25
    let rects = ""
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const even = ((x + y) / cell) % 2 === 0
        rects +=
          `<rect x="${x}" y="${y}" width="${Math.min(cell, w - x)}" ` +
          `height="${Math.min(cell, h - y)}" fill="${even ? "#ff2a1a" : "#19e3ff"}"/>`
      }
    }
    return sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
          `viewBox="0 0 ${w} ${h}">${rects}</svg>`,
      ),
    )
      .jpeg({ quality: 95 })
      .toBuffer()
  }

  async function rawOf(png: Buffer): Promise<{ data: Buffer; w: number; h: number }> {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { data: data as Buffer, w: info.width, h: info.height }
  }

  function boxMeanAbs(
    a: Buffer,
    b: Buffer,
    w: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): number {
    let s = 0
    let n = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4
        s +=
          Math.abs((a[o] ?? 0) - (b[o] ?? 0)) +
          Math.abs((a[o + 1] ?? 0) - (b[o + 1] ?? 0)) +
          Math.abs((a[o + 2] ?? 0) - (b[o + 2] ?? 0))
        n += 3
      }
    }
    return s / Math.max(1, n)
  }

  function boxBrightness(a: Buffer, w: number, x0: number, y0: number, x1: number, y1: number): number {
    let s = 0
    let n = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4
        s += ((a[o] ?? 0) + (a[o + 1] ?? 0) + (a[o + 2] ?? 0)) / 3
        n++
      }
    }
    return s / Math.max(1, n)
  }

  it("blur repaints the artwork card but leaves metadata/title/provider/outside chrome sharp", async () => {
    const logo = await whiteLogo()
    const blurOn = { blurEnabled: true, blurHeight: 60, blurIntensity: 50, blurFade: 50, blurDarkness: 0 }
    for (const [w, h, shape] of [[STD_W, STD_H, "poster"], [LAND_W, LAND_H, "landscape"]] as const) {
      const art = await brightChecker(w, h)
      const geo = cardLayoutGeometry(shape, w, h, 7)
      expect(geo).not.toBeNull()
      const band = cardMetadataBand(w, h, geo!)
      expect(band).not.toBeNull()
      const render = (skin: (typeof SKINS)[number], over: Partial<GenerationInput> = {}) =>
        generatePosterBuffer(
          baseInput({
            posterBuf: art,
            logoFetch: logo,
            shape,
            posterLayout: skin,
            finalRank: 7,
            networkLogo: true,
            tmdbNetworks: ["Netflix"],
            separateRatings: [...FIVE_SEPARATE],
            ...over,
          }),
        )
      for (const skin of SKINS) {
        const offBuf = await render(skin, { blurEnabled: false })
        const onBuf = await render(skin, { ...blurOn })
        const off = await rawOf(offBuf)
        const on = await rawOf(onBuf)
        expect({ w: off.w, h: off.h }).toEqual({ w, h })
        expect({ w: on.w, h: on.h }).toEqual({ w, h })
        const card = geo!.card
        // Artwork deep inside the card and inside the blur band: the blur
        // control must visibly repaint it (never a silent disable). Measured
        // ~40-60 on this checker, far above the bake re-encode floor (~7).
        const artDiff = boxMeanAbs(
          off.data, on.data, w,
          card.x + card.width - 70, card.y + card.height - 70,
          card.x + card.width - 30, card.y + card.height - 40,
        )
        expect(artDiff).toBeGreaterThan(25)
        // Same card above the blur band: only the bake re-encode floor, no
        // blur effect — the effect stays local (several times weaker here).
        const ctrlDiff = boxMeanAbs(
          off.data, on.data, w,
          card.x + card.width - 70, card.y + 12,
          card.x + card.width - 30, card.y + 36,
        )
        expect(ctrlDiff).toBeLessThan(10)
        expect(artDiff).toBeGreaterThan(ctrlDiff * 3)
        // Metadata band below the card: byte-stable chrome (text never washed).
        expect(
          boxMeanAbs(off.data, on.data, w, band!.x0, band!.y0, band!.x1, band!.y1),
        ).toBeLessThan(5)
        // Title logo inside the card stays bright white under blur. The Card
        // title is bottom-CENTERED on its real ink (P14): probe a box around
        // the card center X in the lower title zone (landscape and portrait
        // share the same relative anchor: 45px above the padded ink bottom).
        const cardBox = geo!.card
        const cardCx = Math.round(cardBox.x + cardBox.width / 2)
        const cardBottom = cardBox.y + cardBox.height
        const tl = geo!.titleLogo
        const probeCy = cardBottom - tl.insetBottom - 45
        expect(boxBrightness(on.data, w, cardCx - 12, probeCy - 8, cardCx + 12, probeCy + 8)).toBeGreaterThan(180)
        expect(boxMeanAbs(off.data, on.data, w, cardCx - 12, probeCy - 8, cardCx + 12, probeCy + 8)).toBeLessThan(12)
        // Outside-card background corner inside the blur zone: intended skin bg.
        expect(boxMeanAbs(off.data, on.data, w, 8, h - 32, 40, h - 10)).toBeLessThan(8)
        // Provider mark flows under blur, and all five ratings paint under blur.
        expect(sha(await render(skin, { ...blurOn, networkLogo: false, tmdbNetworks: [] }))).not.toBe(sha(onBuf))
        expect(sha(await render(skin, { ...blurOn, separateRatings: [...FIVE_SEPARATE].slice(0, 3) }))).not.toBe(
          sha(onBuf),
        )
      }
    }
  }, 240000)
})

describe("service Card title/provider scales (P14, measured service bytes)", () => {
  it("title logoScale levels move real pixels; auto renders; hideLogo omits the mark", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = (over: Partial<GenerationInput>) =>
      generatePosterBuffer(
        baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "provider-glass", finalRank: 7, ...over }),
      )
    // Explicit title scales resize the Card slot: every level paints
    // different bytes (never one permanent cap).
    const s50 = sha(await render({ logoScale: 50 }))
    const s75 = sha(await render({ logoScale: 75 }))
    const s100 = sha(await render({ logoScale: 100 }))
    expect(s50).not.toBe(s75)
    expect(s75).not.toBe(s100)
    expect(s50).not.toBe(s100)
    // Auto (null) is the neutral 100 (same convention as Fresh: auto renders
    // like explicit 100, byte-identical — the aspect curve would shrink the
    // enlarged slot back below the baseline).
    const auto = await render({})
    expect(await sharp(auto).metadata()).toMatchObject({ width: STD_W, height: STD_H })
    expect(sha(auto)).toBe(s100)
    // Hidden title logo omits the mark: exact dims, distinct bytes.
    const hidden = await render({ hideLogo: true })
    expect(await sharp(hidden).metadata()).toMatchObject({ width: STD_W, height: STD_H })
    expect(sha(hidden)).not.toBe(sha(auto))
    // Landscape follows the same contract.
    const landBase = await patternedBase(LAND_W, LAND_H)
    const land = async (over: Partial<GenerationInput>) =>
      sha(
        await generatePosterBuffer(
          baseInput({ posterBuf: landBase, logoFetch: logo, shape: "landscape", posterLayout: "nuvio", finalRank: 7, ...over }),
        ),
      )
    expect(await land({ logoScale: 50 })).not.toBe(await land({ logoScale: 100 }))
    expect(await land({ hideLogo: true })).not.toBe(await land({}))
  }, 240000)

  it("networkLogoScale moves the Card provider mark; stored values preserved", async () => {
    const logo = await whiteLogo()
    const base = await patternedBase(STD_W, STD_H)
    const render = async (over: Partial<GenerationInput>) =>
      sha(
        await generatePosterBuffer(
          baseInput({
            posterBuf: base,
            logoFetch: logo,
            posterLayout: "stremio",
            finalRank: 7,
            networkLogo: true,
            tmdbNetworks: ["Netflix"],
            ...over,
          }),
        ),
      )
    // The existing netscale slider resizes the Card provider slot: 100 vs
    // 150 vs 200 paint different bytes; a stored non-default still applies.
    const n100 = await render({ networkLogoScale: 100 })
    const n150 = await render({ networkLogoScale: 150 })
    const n200 = await render({ networkLogoScale: 200 })
    expect(n100).not.toBe(n150)
    expect(n150).not.toBe(n200)
    expect(n100).not.toBe(n200)
    // Missing provider still degrades safely at exact dims.
    const noProvider = await generatePosterBuffer(
      baseInput({ posterBuf: base, logoFetch: logo, posterLayout: "stremio", finalRank: 7 }),
    )
    expect(await sharp(noProvider).metadata()).toMatchObject({ width: STD_W, height: STD_H })
    expect(sha(noProvider)).not.toBe(n100)
  }, 240000)
})
