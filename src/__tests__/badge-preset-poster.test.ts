/**
 * M5: il preset custom sostituisce il bitmap dello slot corrispondente e
 * degrada sullo stile standard quando assente/privato/vuoto (mai 500).
 */
import sharp from "sharp"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  generatePosterBuffer,
  getPresetForPoster,
  __resetPresetJsonCacheForTests,
  type GenerationInput,
} from "@/lib/poster-service"
import { buildCustomPresetBadgeSVG } from "@/lib/svg-badge"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { BadgePreset } from "@/lib/badge-preset"

vi.mock("@/lib/badge-preset-store", () => ({
  getPresetForUser: vi.fn(),
}))

import { getPresetForUser } from "@/lib/badge-preset-store"

const OWNER = "123e4567-e89b-12d3-a456-426614174000"

const design = {
  shape: "pill" as const,
  padding: { x: 12, y: 6 },
  background: { type: "solid" as const, color: "#cc0000", opacity: 100 },
  text: {
    template: "PRESET {{rating}}",
    color: "#ffffff",
    opacity: 100,
    fontSize: 20,
    fontWeight: 700 as const,
    uppercase: false,
    letterSpacing: 0,
    align: "center" as const,
  },
  scale: 100,
}

function makePreset(overrides?: Partial<BadgePreset>): BadgePreset {
  return {
    version: 1,
    id: "Abc123-_XyZ",
    ownerUuid: OWNER,
    target: "genre",
    visibility: "public",
    metadata: { name: "P", tags: [] },
    variant: "custom",
    design: structuredClone(design),
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    revision: "deadbeef",
    ...overrides,
  }
}

async function darkPoster(): Promise<Buffer> {
  return sharp({
    create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
  })
    .jpeg()
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
    voteAverage: 8.5,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: true,
    badgeYear: false,
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

async function pixelDiff(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer()
  const rb = await sharp(b).ensureAlpha().raw().toBuffer()
  let diff = 0
  for (let i = 0; i < ra.length; i += 16) if (Math.abs(ra[i] - rb[i]) > 12) diff++
  return diff
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetPresetJsonCacheForTests()
})

describe("buildCustomPresetBadgeSVG", () => {
  it("renders a bitmap and resolves variables", async () => {
    const r = await buildCustomPresetBadgeSVG(makePreset(), { rating: "8.5" }, 380)
    expect(r).not.toBeNull()
    expect(r!.png.length).toBeGreaterThan(0)
    expect(r!.w).toBeGreaterThan(0)
  })

  it("returns null when the resolved text is empty", async () => {
    const empty = makePreset({
      design: { ...structuredClone(design), text: { ...design.text, template: "{{rank}}" } },
    })
    await expect(buildCustomPresetBadgeSVG(empty, {}, 380)).resolves.toBeNull()
  })
})

describe("getPresetForPoster", () => {
  it("caches the JSON and refetches on revision mismatch", async () => {
    const preset = makePreset()
    vi.mocked(getPresetForUser).mockResolvedValue({ preset, downloads: 0 })
    await expect(getPresetForPoster("Abc123-_XyZ", "deadbeef", null)).resolves.toEqual(preset)
    await expect(getPresetForPoster("Abc123-_XyZ", "deadbeef", null)).resolves.toEqual(preset)
    expect(getPresetForUser).toHaveBeenCalledTimes(1)
    await expect(getPresetForPoster("Abc123-_XyZ", "feedface", null)).resolves.toEqual(preset)
    expect(getPresetForUser).toHaveBeenCalledTimes(2)
  })

  it("fail-opens null when the store throws", async () => {
    vi.mocked(getPresetForUser).mockRejectedValue(new Error("KV down"))
    await expect(getPresetForPoster("Abc123-_XyZ", null, null)).resolves.toBeNull()
  })
})

describe("generatePosterBuffer with badgePresetId", () => {
  it("substitutes the genre slot bitmap", async () => {
    const poster = await darkPoster()
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: makePreset(), downloads: 0 })
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const withPreset = await generatePosterBuffer(baseInput({ posterBuf: poster, badgePresetId: "Abc123-_XyZ" }))
    expect(await pixelDiff(baseline, withPreset)).toBeGreaterThan(50)
  })

  it("substitutes the top slot bitmap", async () => {
    const poster = await darkPoster()
    const top = makePreset({ target: "top" })
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: top, downloads: 0 })
    const baseline = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, queryExtra: "TOP" }),
    )
    const withPreset = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, queryExtra: "TOP", badgePresetId: "Abc123-_XyZ" }),
    )
    expect(await pixelDiff(baseline, withPreset)).toBeGreaterThan(50)
  })

  it("falls back to the standard style when the preset is missing", async () => {
    const poster = await darkPoster()
    vi.mocked(getPresetForUser).mockResolvedValue(null)
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const fallback = await generatePosterBuffer(baseInput({ posterBuf: poster, badgePresetId: "Abc123-_XyZ" }))
    expect(await pixelDiff(baseline, fallback)).toBe(0)
  })

  it("falls back when the resolved text is empty", async () => {
    const poster = await darkPoster()
    const empty = makePreset({
      // Different design → different revision (revision is the design hash).
      revision: "feedface",
      design: { ...structuredClone(design), text: { ...design.text, template: "{{rank}}" } },
    })
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: empty, downloads: 0 })
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const fallback = await generatePosterBuffer(baseInput({ posterBuf: poster, badgePresetId: "Abc123-_XyZ" }))
    expect(await pixelDiff(baseline, fallback)).toBe(0)
  })

  it("anchors a top ribbon preset to the corner like the Netflix ribbon", async () => {
    const poster = await darkPoster()
    const ribbon = makePreset({
      target: "top",
      design: {
        ...structuredClone(design),
        shape: "ribbon",
        background: { type: "solid" as const, color: "#e50914", opacity: 100 },
        text: { ...design.text, template: "TOP {{rank}}" },
      },
    })
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: ribbon, downloads: 0 })
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, finalRank: 3, badgePresetId: "Abc123-_XyZ" }),
    )
    const corner = await sharp(buf).extract({ left: 10, top: 8, width: 1, height: 1 }).raw().toBuffer()
    expect(corner[0]).toBeGreaterThan(150)
  })

  it("keeps a non-ribbon top preset centered", async () => {
    const poster = await darkPoster()
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: makePreset({ target: "top" }), downloads: 0 })
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, finalRank: 3, badgePresetId: "Abc123-_XyZ" }),
    )
    const corner = await sharp(buf).extract({ left: 10, top: 8, width: 1, height: 1 }).raw().toBuffer()
    expect(corner[0]).toBeLessThan(80)
  })

  it("anchors a house netflix preset to the corner", async () => {
    const poster = await darkPoster()
    const netflix = makePreset({
      variant: "house",
      target: "top",
      design: undefined,
      house: { style: "netflix", label: "Oggi", scale: 100, polarity: "auto" },
      revision: "feedface",
    })
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: netflix, downloads: 0 })
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, finalRank: 3, badgePresetId: "Abc123-_XyZ" }),
    )
    const corner = await sharp(buf).extract({ left: 10, top: 8, width: 1, height: 1 }).raw().toBuffer()
    expect(corner[0]).toBeGreaterThan(150)
  })

  it("anchors a house netflix preset right when side is right", async () => {
    const poster = await darkPoster()
    const netflix = makePreset({
      variant: "house",
      target: "top",
      design: undefined,
      house: { style: "netflix", label: "Oggi", scale: 100, polarity: "auto", side: "right" },
      revision: "baadf00d",
    })
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: netflix, downloads: 0 })
    const buf = await generatePosterBuffer(
      baseInput({ posterBuf: poster, rankingEnabled: true, finalRank: 3, badgePresetId: "Abc123-_XyZ" }),
    )
    const meta = await sharp(buf).metadata()
    const W = meta.width ?? 500
    // Nastro a destra: occupa l'angolo destro (come Stremio), sinistra libera.
    const right = await sharp(buf).extract({ left: W - 11, top: 8, width: 1, height: 1 }).raw().toBuffer()
    expect(right[0]).toBeGreaterThan(150)
    const left = await sharp(buf).extract({ left: 10, top: 8, width: 1, height: 1 }).raw().toBuffer()
    expect(left[0]).toBeLessThan(80)
  })

  it("renders a house shadow preset byte-identical to the standard style", async () => {
    // La prova che gli starter house SONO gli stessi badge del poster.
    const poster = await darkPoster()
    const shadow = makePreset({
      variant: "house",
      design: undefined,
      house: {
        style: "shadow",
        showGenre: true,
        showYear: false,
        showRating: true,
        scale: 100,
        polarity: "auto",
      },
      revision: "feedface",
    })
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: shadow, downloads: 0 })
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const withPreset = await generatePosterBuffer(baseInput({ posterBuf: poster, badgePresetId: "Abc123-_XyZ" }))
    expect(await pixelDiff(baseline, withPreset)).toBe(0)
  })

  it("substitutes the genre slot with a house preset", async () => {
    const poster = await darkPoster()
    const pill = makePreset({
      variant: "house",
      design: undefined,
      house: {
        style: "pill",
        showGenre: true,
        showYear: false,
        showRating: true,
        scale: 100,
        polarity: "auto",
      },
      // Revision distinta dagli altri test: la chiave cache bitmap è (id, revision).
      revision: "abcdef01",
    })
    vi.mocked(getPresetForUser).mockResolvedValue({ preset: pill, downloads: 0 })
    const baseline = await generatePosterBuffer(baseInput({ posterBuf: poster }))
    const withPreset = await generatePosterBuffer(baseInput({ posterBuf: poster, badgePresetId: "Abc123-_XyZ" }))
    expect(await pixelDiff(baseline, withPreset)).toBeGreaterThan(50)
  })
})
