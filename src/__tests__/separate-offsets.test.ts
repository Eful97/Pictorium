/**
 * Offset gruppo rating separati (`sepox`/`sepoy` / `separateBadgeOffsetX/Y`) — C1 backend.
 *
 * Contratto:
 * - default 0/0 ovunque (omesso == esplicito 0 byte-identici su 2 shape × 3 stili);
 * - catena query > mapping(.landscape) > config token > defaults(.landscape) > 0;
 * - clamp ±2000, query invalida → 0, esplicito 0 vince sul mapping;
 * - muovono l'intero gruppo (mai i singoli provider), Y+ = giù;
 * - `bottom-bar` portrait: X ignorata (byte-identica), Y attiva;
 * - landscape: `bottom-bar` normalizzata a pills → X attiva;
 * - bitmap badge invariati (solo placement); chiave poster/`dv` li includono.
 */
import sharp from "sharp"
import { describe, it, expect, vi, afterEach } from "vitest"
import { generatePosterBuffer, LANDSCAPE_BOTTOM_PILLS_SHIFT_X, LANDSCAPE_BOTTOM_PILLS_SHIFT_Y, PORTRAIT_SEPARATE_SHIFT_Y, type GenerationInput } from "@/lib/poster-service"
import { LAND_W, LAND_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"
import { buildPreviewUrl, buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import {
  POSTER_CACHE_ALLOWLIST,
  hardenPosterSearchParams,
} from "@/lib/poster-params-hardening"
import { posterQuerySchema, mappingSchema, validatePosterQuery } from "@/lib/validation"
import type { SeparateRatingsStyle } from "@/lib/badge-styles"
import type { Mapping } from "@/lib/types"
import type { PictoriumUserConfig } from "@/lib/config-token"

const ITEMS = [
  { id: "imdb", value: 8.7 },
  { id: "tmdb", value: 7.3 },
  { id: "tomatoes", value: 8.8 },
] as const

function cfgInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

const tokenCfg = (partial: Partial<PictoriumUserConfig> = {}): PictoriumUserConfig => ({
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: true,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  gradientHeight: 30,
  networkLogo: true,
  autoRotateClean: false,
  logoFitEnabled: false,
  ...partial,
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("poster-config separateBadgeOffsetX/Y", () => {
  it("default 0/0 senza sorgenti", () => {
    const r = resolvePosterRenderConfig(cfgInput())
    expect(r.separateBadgeOffsetX).toBe(0)
    expect(r.separateBadgeOffsetY).toBe(0)
  })

  it("esplicito 0 vince sul mapping (come gli altri offset)", () => {
    const r = resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepox: "0", sepoy: "0" }),
      mapping: mapping({ separateBadgeOffsetX: 40, separateBadgeOffsetY: -30 }),
    }))
    expect(r.separateBadgeOffsetX).toBe(0)
    expect(r.separateBadgeOffsetY).toBe(0)
  })

  it("catena query > mapping > config > defaults", () => {
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepox: "11", sepoy: "-11" }),
      mapping: mapping({ separateBadgeOffsetX: 22, separateBadgeOffsetY: -22 }),
    }))).toMatchObject({ separateBadgeOffsetX: 11, separateBadgeOffsetY: -11 })
    expect(resolvePosterRenderConfig(cfgInput({
      mapping: mapping({ separateBadgeOffsetX: 22, separateBadgeOffsetY: -22 }),
      configOverride: tokenCfg({ separateBadgeOffsetX: 33, separateBadgeOffsetY: -33 }),
      sd: { separateBadgeOffsetX: 44, separateBadgeOffsetY: -44 },
    }))).toMatchObject({ separateBadgeOffsetX: 22, separateBadgeOffsetY: -22 })
    expect(resolvePosterRenderConfig(cfgInput({
      configOverride: tokenCfg({ separateBadgeOffsetX: 33, separateBadgeOffsetY: -33 }),
      sd: { separateBadgeOffsetX: 44, separateBadgeOffsetY: -44 },
    }))).toMatchObject({ separateBadgeOffsetX: 33, separateBadgeOffsetY: -33 })
    expect(resolvePosterRenderConfig(cfgInput({
      sd: { separateBadgeOffsetX: 44, separateBadgeOffsetY: -44 },
    }))).toMatchObject({ separateBadgeOffsetX: 44, separateBadgeOffsetY: -44 })
  })

  it("profilo landscape del mapping vince sul flat", () => {
    const r = resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      mapping: mapping({
        separateBadgeOffsetX: 10, separateBadgeOffsetY: 10,
        landscape: { separateBadgeOffsetX: 50, separateBadgeOffsetY: -50 },
      }),
    }))
    expect(r.posterShape).toBe("landscape")
    expect(r.separateBadgeOffsetX).toBe(50)
    expect(r.separateBadgeOffsetY).toBe(-50)
  })

  it("clamp ±2000, invalida → 0", () => {
    const qx = (v: string) => resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepox: v }),
    })).separateBadgeOffsetX
    const qy = (v: string) => resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepoy: v }),
    })).separateBadgeOffsetY
    expect(qx("9999")).toBe(2000)
    expect(qx("-9999")).toBe(-2000)
    expect(qy("9999")).toBe(2000)
    expect(qy("-9999")).toBe(-2000)
    expect(qx("abc")).toBe(0)
    expect(qy("abc")).toBe(0)
  })
})

describe("config token separateBadgeOffsetX/Y", () => {
  it("round-trip preserva i valori", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { encodeConfig, decodeConfig } = await import("@/lib/config-token")
    const token = encodeConfig(tokenCfg({ separateBadgeOffsetX: 40, separateBadgeOffsetY: -30 }))
    expect(decodeConfig(token)?.separateBadgeOffsetX).toBe(40)
    expect(decodeConfig(token)?.separateBadgeOffsetY).toBe(-30)
  })

  it("clamp ±2000 in decode", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { decodeConfig } = await import("@/lib/config-token")
    const raw = Buffer.from(
      JSON.stringify(tokenCfg({ separateBadgeOffsetX: 9999, separateBadgeOffsetY: -9999 })),
      "utf-8",
    ).toString("base64url")
    expect(decodeConfig(raw)?.separateBadgeOffsetX).toBe(2000)
    expect(decodeConfig(raw)?.separateBadgeOffsetY).toBe(-2000)
  })
})

describe("validation + hardening + cache key", () => {
  it("query sepox/sepoy nei bound, mapping flat + landscape", () => {
    expect(posterQuerySchema.safeParse({ sepox: "40", sepoy: "-30" }).success).toBe(true)
    expect(posterQuerySchema.safeParse({ sepox: "x".repeat(13) }).success).toBe(false)
    expect(validatePosterQuery(new URLSearchParams("sepox=40&sepoy=-30"))).toBeNull()
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      separateBadgeOffsetX: 40, separateBadgeOffsetY: -30,
      landscape: { separateBadgeOffsetX: 10, separateBadgeOffsetY: 10 },
    }).success).toBe(true)
  })

  it("allowlist + step 5 in presets (come gli altri offset)", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("sepox")).toBe(true)
    expect(POSTER_CACHE_ALLOWLIST.has("sepoy")).toBe(true)
    const hardened = hardenPosterSearchParams(new URLSearchParams("sepox=7&sepoy=-13"), {
      presets: true, preview: false, anonymous: false, publicInstance: false, hasMapping: false,
    })
    expect(hardened.get("sepox")).toBe("5")
    expect(hardened.get("sepoy")).toBe("-15")
  })

  it("chiavi cache distinte per offset diversi", () => {
    const a = normalizePosterCacheParams(new URLSearchParams("sepox=10&sepoy=0"))
    const b = normalizePosterCacheParams(new URLSearchParams("sepox=20&sepoy=0"))
    expect(a.get("sepox")).toBe("10")
    expect(b.get("sepox")).toBe("20")
    expect(a.toString()).not.toBe(b.toString())
  })
})

describe("URL preview/default/Stremio", () => {
  const ps = {
    selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 7.8, width: 500, height: 750 },
    selectedLogo: null,
    selectedBackdrop: null,
    logoScale: 60, logoOffsetX: 0, logoOffsetY: 0,
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    metaInfo: { genres: [{ id: 1, name: "Action" }], voteAverage: 7.8 },
    trendRank: null, mdblistAnimeList: [],
    topEdgeColor: null, accentColor: null, autoAccentColor: null,
    lang: "it", tmdbKey: "",
  }
  const bp = {
    globalBadges: true, rankingBadges: false,
    badgeStyle: "shadow", rankingBadgeStyle: "default",
    customBadge: null,
    gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
    genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0,
    qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
    networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
  }

  it("preview sempre esplicita (default 0/0 quando assenti)", () => {
    const def = buildPreviewUrl(ps as never, bp as never)
    expect(def).toContain("sepox=0")
    expect(def).toContain("sepoy=0")
    const custom = buildPreviewUrl(ps as never, { ...bp, separateBadgeOffsetX: 40, separateBadgeOffsetY: -30 } as never)
    expect(custom).toContain("sepox=40")
    expect(custom).toContain("sepoy=-30")
  })

  it("default-preview con default globali", () => {
    expect(buildDefaultsPreviewUrl({})).toContain("sepox=0")
    expect(buildDefaultsPreviewUrl({ defaultSeparateBadgeOffsetX: 25 })).toContain("sepox=25")
    expect(buildDefaultsPreviewUrl({ defaultSeparateBadgeOffsetY: -15 })).toContain("sepoy=-15")
  })

  it("Stremio non-compact esplicito, compact in dv", () => {
    const withConfig = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ separateBadgeOffsetX: 40, separateBadgeOffsetY: -30 }), config: "tok", lang: "it",
    })
    expect(withConfig.searchParams.get("sepox")).toBe("40")
    expect(withConfig.searchParams.get("sepoy")).toBe("-30")
    const compact = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ separateBadgeOffsetX: 40 }), lang: "it",
    })
    expect(compact.searchParams.get("sepox")).toBeNull()
    const compact0 = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({}), lang: "it",
    })
    expect(compact.searchParams.get("dv")).not.toBe(compact0.searchParams.get("dv"))
    // Builder diretto: dv copre i nuovi numerici.
    const d0 = buildStremioPosterSearchParams({ compactTuning: true }).get("dv")
    const d1 = buildStremioPosterSearchParams({ compactTuning: true, separateBadgeOffsetX: 10 }).get("dv")
    const d2 = buildStremioPosterSearchParams({ compactTuning: true, separateBadgeOffsetY: -10 }).get("dv")
    expect(d1).not.toBe(d0)
    expect(d2).not.toBe(d0)
  })
})

describe("poster-service offset placement", () => {
  function svcInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
      voteAverage: 7.8,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      badgeQuality: false,
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
      separateBadgeScale: 130,
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
      shape: "poster",
      separateRatingsStyle: "column",
      separateRatings: [...ITEMS],
      ...overrides,
    }
  }

  async function darkBase(w = 500, h = 750): Promise<Buffer> {
    return sharp({ create: { width: w, height: h, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  }

  interface Region { x0: number; x1: number; y0: number; y1: number }

  async function brightBox(buf: Buffer, region: Region) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0
    for (let y = region.y0; y < Math.min(region.y1, info.height); y++) {
      for (let x = region.x0; x < Math.min(region.x1, info.width); x++) {
        const i = (y * info.width + x) * 4
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 150) {
          n++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    return { minX, maxX, minY, maxY, n }
  }

  it("omesso == esplicito 0 byte-identici (2 shape × 5 stili)", async () => {
    const base = await darkBase()
    const land = await darkBase(LAND_W, LAND_H)
    const cases: { style: SeparateRatingsStyle; shape: "poster" | "landscape"; buf: Buffer }[] = [
      { style: "column", shape: "poster", buf: base },
      { style: "column", shape: "landscape", buf: land },
      { style: "bottom-bar", shape: "poster", buf: base },
      { style: "bottom-pills", shape: "poster", buf: base },
      { style: "bottom-pills", shape: "landscape", buf: land },
      { style: "bottom-mono", shape: "poster", buf: base },
      { style: "bottom-mono", shape: "landscape", buf: land },
      { style: "bottom-color", shape: "poster", buf: base },
      { style: "bottom-color", shape: "landscape", buf: land },
    ]
    for (const c of cases) {
      const omitted = await generatePosterBuffer({
        ...svcInput(), posterBuf: c.buf, shape: c.shape, separateRatingsStyle: c.style,
      })
      const explicit = await generatePosterBuffer({
        ...svcInput(), posterBuf: c.buf, shape: c.shape, separateRatingsStyle: c.style,
        separateBadgeOffsetX: 0, separateBadgeOffsetY: 0,
      })
      expect(omitted.equals(explicit)).toBe(true)
    }
    // Anti-falso-positivo: con valori il gruppo si vede davvero.
    const moved = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills",
      separateBadgeOffsetX: 60,
    })
    const ref = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills",
    })
    expect(moved.equals(ref)).toBe(false)
  }, 120000)

  it("colonna portrait: -X sposta a sinistra, +Y sposta in giù", async () => {
    const base = await darkBase()
    const region: Region = { x0: 250, x1: 500, y0: 0, y1: 340 }
    const ref = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2),
    }), region)
    expect(ref.n).toBeGreaterThan(200)
    const left = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2), separateBadgeOffsetX: -60,
    }), region)
    expect(left.n).toBeGreaterThan(200)
    expect(ref.minX - left.minX).toBeGreaterThanOrEqual(52)
    expect(ref.minX - left.minX).toBeLessThanOrEqual(68)
    expect(Math.abs(left.minY - ref.minY)).toBeLessThanOrEqual(8)
    const down = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2), separateBadgeOffsetY: 60,
    }), region)
    expect(down.n).toBeGreaterThan(200)
    expect(down.minY - ref.minY).toBeGreaterThanOrEqual(52)
    expect(down.minY - ref.minY).toBeLessThanOrEqual(68)
    expect(Math.abs(down.minX - ref.minX)).toBeLessThanOrEqual(8)
  }, 120000)

  it("pills portrait: +X a destra, -Y in su (gruppo intero)", async () => {
    const base = await darkBase()
    const region: Region = { x0: 0, x1: 500, y0: 560, y1: 750 }
    const ref = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills",
    }), region)
    expect(ref.n).toBeGreaterThan(500)
    const right = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills", separateBadgeOffsetX: 40,
    }), region)
    expect(right.maxX - ref.maxX).toBeGreaterThanOrEqual(32)
    expect(right.maxX - ref.maxX).toBeLessThanOrEqual(48)
    expect(Math.abs(right.minY - ref.minY)).toBeLessThanOrEqual(8)
    const up = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills", separateBadgeOffsetY: -60,
    }), region)
    expect(ref.minY - up.minY).toBeGreaterThanOrEqual(52)
    expect(ref.minY - up.minY).toBeLessThanOrEqual(68)
    expect(Math.abs(up.minX - ref.minX)).toBeLessThanOrEqual(8)
  }, 120000)

  it("bare portrait (bottom-mono/bottom-color): +X a destra, -Y in su (gruppo intero)", async () => {
    const base = await darkBase()
    const region: Region = { x0: 0, x1: 500, y0: 560, y1: 750 }
    for (const style of ["bottom-mono", "bottom-color"] as const) {
      const ref = await brightBox(await generatePosterBuffer({
        ...svcInput(), posterBuf: base, separateRatingsStyle: style,
      }), region)
      expect(ref.n).toBeGreaterThan(200)
      const right = await brightBox(await generatePosterBuffer({
        ...svcInput(), posterBuf: base, separateRatingsStyle: style, separateBadgeOffsetX: 40,
      }), region)
      expect(right.maxX - ref.maxX).toBeGreaterThanOrEqual(32)
      expect(right.maxX - ref.maxX).toBeLessThanOrEqual(48)
      expect(Math.abs(right.minY - ref.minY)).toBeLessThanOrEqual(8)
      const up = await brightBox(await generatePosterBuffer({
        ...svcInput(), posterBuf: base, separateRatingsStyle: style, separateBadgeOffsetY: -60,
      }), region)
      expect(ref.minY - up.minY).toBeGreaterThanOrEqual(52)
      expect(ref.minY - up.minY).toBeLessThanOrEqual(68)
      expect(Math.abs(up.minX - ref.minX)).toBeLessThanOrEqual(8)
    }
  }, 120000)

  it("bare landscape: offset utente additivi sul gruppo intero", async () => {
    const land = await darkBase(LAND_W, LAND_H)
    const region: Region = { x0: 0, x1: LAND_W, y0: LAND_H - 130, y1: LAND_H }
    for (const style of ["bottom-mono", "bottom-color"] as const) {
      const ref = await brightBox(await generatePosterBuffer({
        ...svcInput(), posterBuf: land, shape: "landscape", separateRatingsStyle: style,
      }), region)
      expect(ref.n).toBeGreaterThan(200)
      const left = await brightBox(await generatePosterBuffer({
        ...svcInput(), posterBuf: land, shape: "landscape",
        separateRatingsStyle: style, separateBadgeOffsetX: -60,
      }), region)
      expect(ref.minX - left.minX).toBeGreaterThanOrEqual(52)
      expect(ref.minX - left.minX).toBeLessThanOrEqual(68)
      expect(Math.abs(left.minY - ref.minY)).toBeLessThanOrEqual(8)
      const up = await brightBox(await generatePosterBuffer({
        ...svcInput(), posterBuf: land, shape: "landscape",
        separateRatingsStyle: style, separateBadgeOffsetY: -30,
      }), region)
      expect(ref.minY - up.minY).toBeGreaterThanOrEqual(22)
      expect(ref.minY - up.minY).toBeLessThanOrEqual(38)
      expect(Math.abs(up.minX - ref.minX)).toBeLessThanOrEqual(8)
    }
  }, 120000)

  it("bar portrait: X ignorata (byte-identica), Y attiva", async () => {
    const base = await darkBase()
    const region: Region = { x0: 0, x1: 500, y0: 560, y1: 750 }
    const ref = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-bar",
    })
    const xIgnored = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-bar", separateBadgeOffsetX: 60,
    })
    expect(xIgnored.equals(ref)).toBe(true)
    const up = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-bar", separateBadgeOffsetY: -40,
    })
    expect(up.equals(ref)).toBe(false)
    const refBox = await brightBox(ref, region)
    const upBox = await brightBox(up, region)
    expect(refBox.n).toBeGreaterThan(500)
    expect(refBox.minY - upBox.minY).toBeGreaterThanOrEqual(32)
    expect(refBox.minY - upBox.minY).toBeLessThanOrEqual(48)
  }, 120000)

  it("landscape: bar legacy → pills, X attiva (uguale a pills esplicite)", async () => {
    const land = await darkBase(LAND_W, LAND_H)
    const region: Region = { x0: 0, x1: LAND_W, y0: LAND_H - 130, y1: LAND_H }
    const viaBar = await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape",
      separateRatingsStyle: "bottom-bar", separateBadgeOffsetX: -60,
    })
    const viaPills = await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape",
      separateRatingsStyle: "bottom-pills", separateBadgeOffsetX: -60,
    })
    expect(viaBar.equals(viaPills)).toBe(true)
    const ref = await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape", separateRatingsStyle: "bottom-pills",
    })
    expect(viaBar.equals(ref)).toBe(false)
    const refBox = await brightBox(ref, region)
    const movedBox = await brightBox(viaBar, region)
    expect(refBox.n).toBeGreaterThan(500)
    expect(refBox.minX - movedBox.minX).toBeGreaterThanOrEqual(52)
    expect(refBox.minX - movedBox.minX).toBeLessThanOrEqual(68)
  }, 120000)

  it("clamp dentro il canvas: offset estremi senza crash né crop", async () => {
    const base = await darkBase()
    const buf = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills",
      separateBadgeOffsetX: 2000, separateBadgeOffsetY: -2000,
    })
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(500)
    expect(meta.height).toBe(750)
    const col = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2),
      separateBadgeOffsetX: -2000, separateBadgeOffsetY: 2000,
    })
    const colMeta = await sharp(col).metadata()
    expect(colMeta.width).toBe(500)
    expect(colMeta.height).toBe(750)
  }, 120000)

  it("landscape pills: base geometrica -20 X / -10 Y (margini +20/+10), slider neutri", async () => {
    // Costanti di sola geometria: gli slider restano neutri a 0, i default
    // globali separateBadgeOffset invariati (la colonna non si sposta).
    expect(LANDSCAPE_BOTTOM_PILLS_SHIFT_X).toBe(-20)
    expect(LANDSCAPE_BOTTOM_PILLS_SHIFT_Y).toBe(-10)
    const land = await darkBase(LAND_W, LAND_H)
    const region: Region = { x0: 0, x1: LAND_W, y0: LAND_H - 130, y1: LAND_H }
    const ref = await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape", separateRatingsStyle: "bottom-pills",
    })
    const refBox = await brightBox(ref, region)
    expect(refBox.n).toBeGreaterThan(500)
    // Compensazione esatta della nuova base (+20/+10) = vecchia posizione
    // neutra: margini storici rightPad 36 / bottom 15 (inset contenuto ±8).
    const plus = await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape", separateRatingsStyle: "bottom-pills",
      separateBadgeOffsetX: 20, separateBadgeOffsetY: 10,
    })
    const plusBox = await brightBox(plus, region)
    expect(plusBox.n).toBeGreaterThan(500)
    expect(plusBox.minX - refBox.minX).toBeGreaterThanOrEqual(12)
    expect(plusBox.minX - refBox.minX).toBeLessThanOrEqual(28)
    expect(plusBox.minY - refBox.minY).toBeGreaterThanOrEqual(2)
    expect(plusBox.minY - refBox.minY).toBeLessThanOrEqual(18)
    expect(Math.abs(plusBox.maxX - refBox.maxX - 20)).toBeLessThanOrEqual(8)
    const rightMarginPlus = LAND_W - 1 - plusBox.maxX
    const bottomMarginPlus = LAND_H - 1 - plusBox.maxY
    expect(rightMarginPlus).toBeGreaterThanOrEqual(28)
    expect(rightMarginPlus).toBeLessThanOrEqual(48)
    expect(bottomMarginPlus).toBeGreaterThanOrEqual(7)
    expect(bottomMarginPlus).toBeLessThanOrEqual(27)
    // La nuova base è rientrata: margini +20/+10 rispetto alla vecchia neutra.
    const rightMarginRef = LAND_W - 1 - refBox.maxX
    const bottomMarginRef = LAND_H - 1 - refBox.maxY
    expect(rightMarginRef - rightMarginPlus).toBeGreaterThanOrEqual(12)
    expect(rightMarginRef - rightMarginPlus).toBeLessThanOrEqual(28)
    expect(bottomMarginRef - bottomMarginPlus).toBeGreaterThanOrEqual(2)
    expect(bottomMarginRef - bottomMarginPlus).toBeLessThanOrEqual(18)
  }, 120000)

  it("landscape pills: offset utente additivi, bar normalizzata stessa resa", async () => {
    const land = await darkBase(LAND_W, LAND_H)
    const region: Region = { x0: 0, x1: LAND_W, y0: LAND_H - 130, y1: LAND_H }
    const ref = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape", separateRatingsStyle: "bottom-pills",
    }), region)
    const left = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape",
      separateRatingsStyle: "bottom-pills", separateBadgeOffsetX: -60,
    }), region)
    expect(ref.minX - left.minX).toBeGreaterThanOrEqual(52)
    expect(ref.minX - left.minX).toBeLessThanOrEqual(68)
    expect(Math.abs(left.minY - ref.minY)).toBeLessThanOrEqual(8)
    const up = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape",
      separateRatingsStyle: "bottom-pills", separateBadgeOffsetY: -30,
    }), region)
    expect(ref.minY - up.minY).toBeGreaterThanOrEqual(22)
    expect(ref.minY - up.minY).toBeLessThanOrEqual(38)
    expect(Math.abs(up.minX - ref.minX)).toBeLessThanOrEqual(8)
    // bottom-bar landscape → pills: stessi pixel anche con offset Y.
    const viaBar = await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape",
      separateRatingsStyle: "bottom-bar", separateBadgeOffsetY: -10,
    })
    const viaPills = await generatePosterBuffer({
      ...svcInput(), posterBuf: land, shape: "landscape",
      separateRatingsStyle: "bottom-pills", separateBadgeOffsetY: -10,
    })
    expect(viaBar.equals(viaPills)).toBe(true)
  }, 120000)

  it("portrait pills + colonna: base invariata (no shift landscape)", async () => {
    const base = await darkBase()
    const region: Region = { x0: 0, x1: 500, y0: 560, y1: 750 }
    const ref = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills",
    }), region)
    expect(ref.n).toBeGreaterThan(500)
    // Portrait pills restano centrate (no -20 X): margini laterali simmetrici.
    const leftMargin = ref.minX
    const rightMargin = 500 - 1 - ref.maxX
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(14)
    // Portrait pills restano al margine basso storico 15 (no -10 Y).
    const bottomMargin = 750 - 1 - ref.maxY
    expect(bottomMargin).toBeGreaterThanOrEqual(7)
    expect(bottomMargin).toBeLessThanOrEqual(27)
    // Colonna portrait: asse invariato (spostamento -60 X come da contratto).
    const colRegion: Region = { x0: 250, x1: 500, y0: 0, y1: 340 }
    const colRef = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2),
    }), colRegion)
    const colLeft = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2), separateBadgeOffsetX: -60,
    }), colRegion)
    expect(colRef.minX - colLeft.minX).toBeGreaterThanOrEqual(52)
    expect(colRef.minX - colLeft.minX).toBeLessThanOrEqual(68)
  }, 120000)

  it("portrait +5 Y: colonna e pills scendono di 5, slider additivi, bar flush esclusa", async () => {
    // Costante di sola geometria portrait (sliders neutri 0, default globali 0).
    expect(PORTRAIT_SEPARATE_SHIFT_Y).toBe(5)
    expect(LANDSCAPE_BOTTOM_PILLS_SHIFT_X).toBe(-20)
    expect(LANDSCAPE_BOTTOM_PILLS_SHIFT_Y).toBe(-10)
    const base = await darkBase()
    // Pills portrait (scala 130 = baseline corrente): sepoy -5 compensa
    // esattamente la nuova base +5 (differenziale 5px, margine storico ripristinato).
    const pillRegion: Region = { x0: 0, x1: 500, y0: 560, y1: 750 }
    const pillRef = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills",
    }), pillRegion)
    expect(pillRef.n).toBeGreaterThan(500)
    const pillUp = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-pills",
      separateBadgeOffsetY: -5,
    }), pillRegion)
    expect(pillUp.n).toBeGreaterThan(500)
    expect(pillRef.minY - pillUp.minY).toBeGreaterThanOrEqual(3)
    expect(pillRef.minY - pillUp.minY).toBeLessThanOrEqual(7)
    // Colonna portrait: sepoy +5 sposta in giu di 5 (additivo dopo la base).
    const colRegion: Region = { x0: 250, x1: 500, y0: 0, y1: 340 }
    const colRef = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2),
    }), colRegion)
    const colDown = await brightBox(await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatings: [...ITEMS].slice(0, 2),
      separateBadgeOffsetY: 5,
    }), colRegion)
    expect(colRef.n).toBeGreaterThan(200)
    expect(colDown.minY - colRef.minY).toBeGreaterThanOrEqual(3)
    expect(colDown.minY - colRef.minY).toBeLessThanOrEqual(7)
    // Bar portrait full-width a filo: il +5 e annullato dal clamp (eccezione).
    const barRef = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-bar",
    })
    const barDown = await generatePosterBuffer({
      ...svcInput(), posterBuf: base, separateRatingsStyle: "bottom-bar",
      separateBadgeOffsetY: 5,
    })
    expect(barDown.equals(barRef)).toBe(true)
  }, 120000)
})
