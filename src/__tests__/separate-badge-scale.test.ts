/**
 * Scala dedicata della colonna rating separati (`sepscale` / `separateBadgeScale`).
 *
 * Contratto vigente (decisione utente: default unico 130):
 * - default 130 per tutti gli stili (`column`/`bottom-bar`/`bottom-pills`,
 *   helper unico `getSeparateBadgeDefaultScale`); omesso == esplicito 130
 *   byte-identici a renderer;
 * - esplicito 100 = percorso storico (font base senza arrotondamenti
 *   intermedi, geometria invariata — senza baseline pre-130 non si dichiara
 *   byte-identità tra versioni, solo equivalenza col percorso esplicito);
 * - scala NATIVA via font (testi e loghi crescono davvero, non solo resize);
 * - catena query > mapping(.landscape) > config token > defaults(.landscape) > 130;
 * - clamp 10..200, `0`/non-numerico → 130 (range come `qscale`, fallback sul
 *   nuovo default);
 * - max 3 item e ancore invariati (fuori scope di questo file).
 */
import sharp from "sharp"
import { describe, it, expect, vi, afterEach } from "vitest"
import { renderSeparateRatingStack } from "@/lib/separate-rating-renderer"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
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
import { posterQuerySchema, mappingSchema } from "@/lib/validation"
import type { Mapping } from "@/lib/types"
import type { PictoriumUserConfig } from "@/lib/config-token"

const ITEMS = [
  { id: "imdb", value: 8.7 },
  { id: "tmdb", value: 7.3 },
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

describe("renderSeparateRatingStack scale", () => {
  it("default omesso ed esplicito 130 sono byte-identici (nuovo default)", async () => {
    const a = await renderSeparateRatingStack([...ITEMS], 380, true, "inter")
    const b = await renderSeparateRatingStack([...ITEMS], 380, true, "inter", 130)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(b!.w).toBe(a!.w)
    expect(b!.h).toBe(a!.h)
    expect(b!.png.equals(a!.png)).toBe(true)
  })

  it("esplicito 100 = percorso storico (geometria base, più piccolo del 130)", async () => {
    // Senza baseline pre-130 non si dichiara byte-identità tra versioni: si
    // verifica il percorso storico — font base esatto (fs=14 a pw=380) e
    // dimensioni strettamente minori del default 130 (scala nativa reale).
    const at100 = await renderSeparateRatingStack([...ITEMS], 380, true, "inter", 100)
    const at130 = await renderSeparateRatingStack([...ITEMS], 380, true, "inter", 130)
    expect(at100).not.toBeNull()
    expect(at130).not.toBeNull()
    expect(at100!.w).toBeLessThan(at130!.w)
    expect(at100!.h).toBeLessThan(at130!.h)
    expect(at100!.png.equals(at130!.png)).toBe(false)
  })

  it("150 ingrandisce stack, font e loghi (scala nativa)", async () => {
    const at100 = await renderSeparateRatingStack([...ITEMS], 380, true, "inter", 100)
    const at150 = await renderSeparateRatingStack([...ITEMS], 380, true, "inter", 150)
    expect(at100).not.toBeNull()
    expect(at150).not.toBeNull()
    // base fs portrait = round(max(14*380/380,11)) = 14 → 150% = 21
    expect(at150!.w).toBeGreaterThan(at100!.w)
    expect(at150!.h).toBeGreaterThan(at100!.h)
    // Crescita proporzionale nativa (~1.5x su entrambe le dimensioni).
    expect(at150!.w / at100!.w).toBeGreaterThan(1.3)
    expect(at150!.h / at100!.h).toBeGreaterThan(1.3)
  })

  it("scala anche sul canvas landscape (badgePw=500)", async () => {
    const at100 = await renderSeparateRatingStack([...ITEMS], 500, true, "inter", 100)
    const at150 = await renderSeparateRatingStack([...ITEMS], 500, true, "inter", 150)
    expect(at100).not.toBeNull()
    expect(at150).not.toBeNull()
    expect(at150!.w).toBeGreaterThan(at100!.w)
    expect(at150!.h).toBeGreaterThan(at100!.h)
  })
})

describe("poster-config separateBadgeScale", () => {
  it("default 130 senza sorgenti (unico per tutti gli stili)", () => {
    expect(resolvePosterRenderConfig(cfgInput()).separateBadgeScale).toBe(130)
  })

  it("default unico 130 per tutti e tre gli stili (helper single source)", async () => {
    const { getSeparateBadgeDefaultScale, DEFAULT_SEPARATE_BADGE_SCALE } = await import("@/lib/badge-styles")
    expect(DEFAULT_SEPARATE_BADGE_SCALE).toBe(130)
    for (const style of ["column", "bottom-bar", "bottom-pills", undefined, null, "garbage"] as const) {
      expect(getSeparateBadgeDefaultScale(style)).toBe(130)
    }
  })

  it("esplicito 100 vince sul 130 da query/mapping/token/defaults", () => {
    const q100 = resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepscale: "100" }),
      mapping: mapping({ separateBadgeScale: 150 }),
    })).separateBadgeScale
    expect(q100).toBe(100)
    const m100 = resolvePosterRenderConfig(cfgInput({
      mapping: mapping({ separateBadgeScale: 100 }),
      configOverride: tokenCfg({ separateBadgeScale: 150 }),
      sd: { separateBadgeScale: 140 },
    })).separateBadgeScale
    expect(m100).toBe(100)
    const t100 = resolvePosterRenderConfig(cfgInput({
      configOverride: tokenCfg({ separateBadgeScale: 100 }),
      sd: { separateBadgeScale: 140 },
    })).separateBadgeScale
    expect(t100).toBe(100)
    const d100 = resolvePosterRenderConfig(cfgInput({
      sd: { separateBadgeScale: 100 },
    })).separateBadgeScale
    expect(d100).toBe(100)
  })

  it("catena query > mapping > config > defaults", () => {
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepscale: "150" }),
      mapping: mapping({ separateBadgeScale: 120 }),
    })).separateBadgeScale).toBe(150)
    expect(resolvePosterRenderConfig(cfgInput({
      mapping: mapping({ separateBadgeScale: 120 }),
      configOverride: tokenCfg({ separateBadgeScale: 130 }),
      sd: { separateBadgeScale: 140 },
    })).separateBadgeScale).toBe(120)
    expect(resolvePosterRenderConfig(cfgInput({
      configOverride: tokenCfg({ separateBadgeScale: 130 }),
      sd: { separateBadgeScale: 140 },
    })).separateBadgeScale).toBe(130)
    expect(resolvePosterRenderConfig(cfgInput({
      sd: { separateBadgeScale: 140 },
    })).separateBadgeScale).toBe(140)
  })

  it("profilo landscape del mapping vince sul flat (come quality)", () => {
    const r = resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      mapping: mapping({
        separateBadgeScale: 100,
        landscape: { separateBadgeScale: 150 },
      }),
    }))
    expect(r.posterShape).toBe("landscape")
    expect(r.separateBadgeScale).toBe(150)
  })

  it("clamp e fallback come qscale (fallback sul nuovo default 130)", () => {
    const q = (v: string) => resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepscale: v }),
    })).separateBadgeScale
    expect(q("999999")).toBe(200)
    expect(q("-50")).toBe(10)
    expect(q("abc")).toBe(130)
    expect(q("0")).toBe(130)
  })
})

describe("config token separateBadgeScale", () => {
  it("round-trip preserva il valore", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { encodeConfig, decodeConfig } = await import("@/lib/config-token")
    const token = encodeConfig(tokenCfg({ separateBadgeScale: 150 }))
    expect(decodeConfig(token)?.separateBadgeScale).toBe(150)
  })

  it("clamp 10..200 in decode", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { decodeConfig } = await import("@/lib/config-token")
    const raw = Buffer.from(
      JSON.stringify(tokenCfg({ separateBadgeScale: 999 })),
      "utf-8",
    ).toString("base64url")
    expect(decodeConfig(raw)?.separateBadgeScale).toBe(200)
  })
})

describe("validation separateBadgeScale", () => {
  it("query sepscale nei bound, mapping 10..200 + landscape", () => {
    expect(posterQuerySchema.safeParse({ sepscale: "150" }).success).toBe(true)
    expect(posterQuerySchema.safeParse({ sepscale: "x".repeat(13) }).success).toBe(false)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      separateBadgeScale: 150,
      landscape: { separateBadgeScale: 120 },
    }).success).toBe(true)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      separateBadgeScale: 999,
    }).success).toBe(false)
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

  it("preview sempre esplicita (default 130 quando assente)", () => {
    expect(buildPreviewUrl(ps as never, { ...bp, separateBadgeScale: 150 } as never)).toContain("sepscale=150")
    expect(buildPreviewUrl(ps as never, bp as never)).toContain("sepscale=130")
  })

  it("default-preview con default globale", () => {
    expect(buildDefaultsPreviewUrl({ defaultSeparateBadgeScale: 150 })).toContain("sepscale=150")
    expect(buildDefaultsPreviewUrl({})).toContain("sepscale=130")
  })

  it("Stremio: mapping con config esplicito, compact omesso ma dv copre", () => {
    const withConfig = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ separateBadgeScale: 150 }), config: "tok", lang: "it",
    })
    expect(withConfig.searchParams.get("sepscale")).toBe("150")
    const compact = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ separateBadgeScale: 150 }), lang: "it",
    })
    expect(compact.searchParams.get("sepscale")).toBeNull()
    const compact100 = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ separateBadgeScale: 100 }), lang: "it",
    })
    expect(compact.searchParams.get("dv")).not.toBe(compact100.searchParams.get("dv"))
    // …e il server risolve il mapping salvato.
    expect(resolvePosterRenderConfig(cfgInput({ mapping: mapping({ separateBadgeScale: 150 }) })).separateBadgeScale).toBe(150)
  })
})

describe("contenimento landscape-200 (no overlap col badge genere)", () => {
  async function darkBackdrop(): Promise<Buffer> {
    return sharp({
      create: { width: LAND_W, height: LAND_H, channels: 3, background: "#101010" },
    })
      .jpeg()
      .toBuffer()
  }

  function landInput(scale: number): GenerationInput {
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
      badgeGenre: true,
      badgeYear: false,
      badgeRating: false,
      badgeQuality: true,
      quality: "4K",
      videoFormats: ["dv", "atmos"],
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
      separateBadgeScale: scale,
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
      shape: "landscape",
      separateRatings: [
        { id: "imdb", value: 8.7 },
        { id: "tmdb", value: 7.9 },
        { id: "tomatoes", value: 88 },
      ],
    }
  }

  /** Bande luminose nella striscia destra (stack + badge genere). */
  async function rightBands(buf: Buffer) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const x0 = Math.round(info.width * 0.65)
    const rows: number[] = []
    for (let y = 0; y < info.height; y++) {
      let bright = 0
      for (let x = x0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) bright++
      }
      rows.push(bright / (info.width - x0))
    }
    const bands: { top: number; bottom: number }[] = []
    let start = -1
    let darkRun = 0
    for (let y = 0; y < rows.length; y++) {
      if (rows[y] > 0.10) {
        if (start < 0) start = y
        darkRun = 0
      } else if (start >= 0) {
        darkRun++
        if (darkRun > 3) {
          bands.push({ top: start, bottom: y - darkRun })
          start = -1
          darkRun = 0
        }
      }
    }
    if (start >= 0) bands.push({ top: start, bottom: rows.length - 1 })
    return bands
  }

  it("a 200 lo stack non copre il badge genere (gap scuro in mezzo)", async () => {
    const backdrop = await darkBackdrop()
    const buf = await generatePosterBuffer({ ...landInput(200), posterBuf: backdrop })
    const bands = await rightBands(buf)
    console.log(`land200 bands: ${JSON.stringify(bands)}`)
    // 3 pill + badge qualità + badge genere: l'ultima pill e il genere
    // devono essere bande DISTINTE (gap scuro ≥4 righe in mezzo).
    expect(bands.length).toBeGreaterThanOrEqual(4)
    const stackBottom = bands[bands.length - 2].bottom
    const genreTop = bands[bands.length - 1].top
    expect(genreTop - stackBottom).toBeGreaterThanOrEqual(4)
  }, 60000)

  it("a 100 nessuno shrink anche con spazio ridotto (contratto storico)", async () => {
    // Genere spostato di 150px verso lo stack: pressione reale (fusione delle
    // bande), ma la colonna a scala 100 non deve restringersi mai.
    const backdrop = await darkBackdrop()
    const ref = await generatePosterBuffer({ ...landInput(100), posterBuf: backdrop })
    const tight = await generatePosterBuffer({ ...landInput(100), posterBuf: backdrop, genreBadgeOffsetY: -150 })
    const refBands = await rightBands(ref)
    const tightBands = await rightBands(tight)
    expect(refBands.length).toBeGreaterThanOrEqual(5)
    expect(tightBands.length).toBeLessThan(refBands.length)
    // Prima pill (banda sopra il genere spostato in entrambi): stessi bordi
    // esatti → nessuno shrink a 100. Soglie al 10%: immuni al rumore encoder.
    const p1ref = refBands[2]
    const p1tight = tightBands[2]
    expect(p1tight.top).toBe(p1ref.top)
    expect(p1tight.bottom).toBe(p1ref.bottom)
  }, 60000)
})

describe("cache e firme sepscale", () => {
  it("allowlist contiene sepscale e la chiave lo conserva", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("sepscale")).toBe(true)
    const n = normalizePosterCacheParams(new URLSearchParams("sepscale=150&bs=pill"))
    expect(n.get("sepscale")).toBe("150")
  })

  it("presets-mode quantizza a step 10 (come le altre scale)", () => {
    const h = hardenPosterSearchParams(new URLSearchParams("sepscale=143"), {
      presets: true,
      preview: false,
      anonymous: false,
      publicInstance: true,
      hasMapping: false,
    })
    expect(h.get("sepscale")).toBe("140")
  })

  it("stremio-params: esplicito non-compact, omesso in compact con dv che copre la scala", () => {
    const explicit = buildStremioPosterSearchParams({ separateBadgeScale: 150 })
    expect(explicit.get("sepscale")).toBe("150")
    const def = buildStremioPosterSearchParams({})
    expect(def.get("sepscale")).toBe("130")
    const c100 = buildStremioPosterSearchParams({ compactTuning: true, separateBadgeScale: 100 })
    const c150 = buildStremioPosterSearchParams({ compactTuning: true, separateBadgeScale: 150 })
    expect(c100.get("sepscale")).toBeNull()
    expect(c150.get("sepscale")).toBeNull()
    expect(c100.get("dv")).not.toBe(c150.get("dv"))
  })
})
