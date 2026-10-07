/**
 * CLASSIFICA vs EXTRA split of the top badge (contract/render/URL).
 *
 * - `topBadgeScale/OffsetX/Y` = CLASSIFICA tuning (legacy unchanged);
 * - `extraBadgeScale/OffsetX/Y` (+ query `exscale`/`exox`/`exoy`) = EXTRA
 *   tuning, nullable with legacy fallback ONLY until migrated;
 * - the render selects the tuning by effective topBadge kind: rank
 *   (ribbon included) always uses classifica, extra uses its own once
 *   migrated — editing one never moves nor resizes the other;
 * - `number` never applies the -20 baseline to extra;
 * - absent everywhere = unchanged legacy bytes (URL, `dv`, cache, render).
 */
import sharp from "sharp"
import { describe, it, expect, vi, afterEach } from "vitest"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
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

describe("poster-config extra tuning chain", () => {
  it("absent everywhere resolves null (legacy fallback at the use site)", () => {
    const r = resolvePosterRenderConfig(cfgInput())
    expect(r.extraBadgeScale).toBeNull()
    expect(r.extraBadgeOffsetX).toBeNull()
    expect(r.extraBadgeOffsetY).toBeNull()
    // Classifica legacy defaults intact.
    expect(r.topBadgeScale).toBe(100)
    expect(r.topBadgeOffsetX).toBe(0)
    expect(r.topBadgeOffsetY).toBe(0)
  })

  it("chain query > mapping > token > defaults, per-shape profiles", () => {
    const q = (o: Partial<PosterRenderConfigInput>) => resolvePosterRenderConfig(cfgInput(o))
    expect(q({
      searchParams: new URLSearchParams({ exscale: "150", exox: "10", exoy: "-5" }),
      mapping: mapping({ extraBadgeScale: 120, extraBadgeOffsetX: 1, extraBadgeOffsetY: 2 }),
    }).extraBadgeScale).toBe(150)
    expect(q({
      mapping: mapping({ extraBadgeScale: 120 }),
      configOverride: tokenCfg({ extraBadgeScale: 130 }),
      sd: { extraBadgeScale: 140 },
    }).extraBadgeScale).toBe(120)
    expect(q({
      configOverride: tokenCfg({ extraBadgeScale: 130 }),
      sd: { extraBadgeScale: 140 },
    }).extraBadgeScale).toBe(130)
    expect(q({ sd: { extraBadgeScale: 140 } }).extraBadgeScale).toBe(140)
    expect(q({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      mapping: mapping({ landscape: { extraBadgeScale: 150 } }),
      sd: { extraBadgeScale: 140, landscape: { extraBadgeScale: 130 } },
    }).extraBadgeScale).toBe(150)
    expect(q({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      sd: { extraBadgeScale: 140, landscape: { extraBadgeScale: 130 } },
    }).extraBadgeScale).toBe(130)
  })

  it("invalid query falls back to legacy (null), bounds clamped", () => {
    const q = (v: string) => resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ exscale: v }),
    })).extraBadgeScale
    expect(q("999999")).toBe(200)
    expect(q("-50")).toBe(10)
    expect(q("abc")).toBeNull()
    expect(q("0")).toBeNull()
    const o = (k: string, v: string) => resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ [k]: v }),
    }))
    expect(o("exox", "99999").extraBadgeOffsetX).toBe(2000)
    expect(o("exox", "abc").extraBadgeOffsetX).toBeNull()
    expect(o("exoy", "-99999").extraBadgeOffsetY).toBe(-2000)
  })
})

describe("config token extra tuning", () => {
  it("round-trip preserves the value, old tokens stay valid", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { encodeConfig, decodeConfig } = await import("@/lib/config-token")
    const token = encodeConfig(tokenCfg({ extraBadgeScale: 150, extraBadgeOffsetX: 10, extraBadgeOffsetY: -5 }))
    expect(decodeConfig(token)?.extraBadgeScale).toBe(150)
    expect(decodeConfig(token)?.extraBadgeOffsetX).toBe(10)
    expect(decodeConfig(token)?.extraBadgeOffsetY).toBe(-5)
    expect(decodeConfig(encodeConfig(tokenCfg()))?.extraBadgeScale).toBeUndefined()
  })

  it("clamp 10..200 / +-2000 in decode", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { decodeConfig } = await import("@/lib/config-token")
    const raw = Buffer.from(
      JSON.stringify(tokenCfg({ extraBadgeScale: 999, extraBadgeOffsetX: 99999 })),
      "utf-8",
    ).toString("base64url")
    expect(decodeConfig(raw)?.extraBadgeScale).toBe(200)
    expect(decodeConfig(raw)?.extraBadgeOffsetX).toBe(2000)
  })
})

describe("validation extra tuning", () => {
  it("query ex* nei bound, mapping 10..200 + landscape", () => {
    expect(posterQuerySchema.safeParse({ exscale: "150", exox: "10", exoy: "-5" }).success).toBe(true)
    expect(posterQuerySchema.safeParse({ exscale: "x".repeat(13) }).success).toBe(false)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      extraBadgeScale: 150, extraBadgeOffsetX: 10, extraBadgeOffsetY: -5,
      landscape: { extraBadgeScale: 120 },
    }).success).toBe(true)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      extraBadgeScale: 999,
    }).success).toBe(false)
  })
})

describe("URL preview/default/Stremio extra tuning", () => {
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

  it("preview: absent = no ex* params (byte-identical legacy URLs)", () => {
    const url = buildPreviewUrl(ps as never, bp as never)
    expect(url).not.toContain("exscale")
    expect(url).not.toContain("exox")
    expect(url).not.toContain("exoy")
    expect(buildPreviewUrl(ps as never, { ...bp, extraBadgeScale: 150, extraBadgeOffsetX: 10, extraBadgeOffsetY: -5 } as never))
      .toContain("exscale=150&exox=10&exoy=-5")
  })

  it("defaults preview: absent = no ex* params, landscape profile included", () => {
    expect(buildDefaultsPreviewUrl({})).not.toContain("exscale")
    expect(buildDefaultsPreviewUrl({ defaultExtraBadgeScale: 150 })).toContain("exscale=150")
    expect(buildDefaultsPreviewUrl({
      previewShape: "landscape",
      landscape: { extraBadgeScale: 130, extraBadgeOffsetX: 4 } as never,
    })).toContain("exscale=130&exox=4")
  })

  it("Stremio: mapping with config explicit, compact omitted, dv covers explicit extra only", () => {
    const withConfig = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ extraBadgeScale: 150 }), config: "tok", lang: "it",
    })
    expect(withConfig.searchParams.get("exscale")).toBe("150")
    const compact = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ extraBadgeScale: 150 }), lang: "it",
    })
    expect(compact.searchParams.get("exscale")).toBeNull()
    const compactLegacy = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({}), lang: "it",
    })
    expect(compact.searchParams.get("dv")).not.toBe(compactLegacy.searchParams.get("dv"))
    // ...and the server resolves the saved mapping.
    expect(resolvePosterRenderConfig(cfgInput({ mapping: mapping({ extraBadgeScale: 150 }) })).extraBadgeScale).toBe(150)
  })

  it("Stremio explicit params: absent = no ex* params", () => {
    const explicit = buildStremioPosterSearchParams({})
    expect(explicit.get("exscale")).toBeNull()
    expect(explicit.get("exox")).toBeNull()
    expect(explicit.get("exoy")).toBeNull()
    const withExtra = buildStremioPosterSearchParams({ extraBadgeScale: 150, extraBadgeOffsetX: 10 })
    expect(withExtra.get("exscale")).toBe("150")
    expect(withExtra.get("exox")).toBe("10")
    expect(withExtra.get("exoy")).toBeNull()
  })

  it("compact dv stable when extra absent (legacy fixture exact)", () => {
    const a = buildStremioPosterSearchParams({ compactTuning: true })
    const b = buildStremioPosterSearchParams({
      compactTuning: true,
      extraBadgeScale: undefined, extraBadgeOffsetX: undefined, extraBadgeOffsetY: undefined,
    })
    expect(a.get("dv")).toBe(b.get("dv"))
    const c = buildStremioPosterSearchParams({ compactTuning: true, extraBadgeOffsetY: 5 })
    expect(c.get("dv")).not.toBe(a.get("dv"))
  })
})

describe("cache e firme ex*", () => {
  it("allowlist contiene ex* e la chiave li conserva", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("exscale")).toBe(true)
    expect(POSTER_CACHE_ALLOWLIST.has("exox")).toBe(true)
    expect(POSTER_CACHE_ALLOWLIST.has("exoy")).toBe(true)
    const n = normalizePosterCacheParams(new URLSearchParams("exscale=150&exox=10&bs=pill"))
    expect(n.get("exscale")).toBe("150")
    expect(n.get("exox")).toBe("10")
  })

  it("presets-mode quantizza (scale step 10, offset step 5)", () => {
    const h = hardenPosterSearchParams(new URLSearchParams("exscale=143&exox=12"), {
      presets: true,
      preview: false,
      anonymous: false,
      publicInstance: true,
      hasMapping: false,
    })
    expect(h.get("exscale")).toBe("140")
    expect(h.get("exox")).toBe("10")
  })
})

async function darkPoster(): Promise<Buffer> {
  return sharp({
    create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" },
  }).jpeg().toBuffer()
}

async function darkBackdrop(): Promise<Buffer> {
  return sharp({
    create: { width: LAND_W, height: LAND_H, channels: 3, background: "#101010" },
  }).jpeg().toBuffer()
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
    genreName: null,
    voteAverage: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeGenre: false,
    badgeYear: false,
    badgeRating: false,
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
    t: ((k: string) => k) as never,
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

/** Mean X of bright pixels in a band (badge drift on a dark canvas). */
async function brightCenterX(buf: Buffer, y0: number, y1: number): Promise<number> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  let n = 0
  for (let y = y0; y < Math.min(y1, info.height); y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (Math.max(data[i], data[i + 1], data[i + 2]) > 90) {
        sum += x
        n++
      }
    }
  }
  return n ? sum / n : -1
}

describe("REAL render: rank ignores extra tuning", () => {
  it.each(["default", "pill", "corner", "number", "netflix"] as const)(
    "rank %s unchanged by exscale/exox/exoy",
    async (style) => {
      const poster = await darkPoster()
      const shared = { posterBuf: poster, finalRank: 4, rankingBadgeStyle: style }
      const base = await generatePosterBuffer(baseInput(shared))
      const moved = await generatePosterBuffer(baseInput({
        ...shared, extraBadgeScale: 150, extraBadgeOffsetX: 40, extraBadgeOffsetY: 40,
      }))
      expect(moved.equals(base)).toBe(true)
    },
    60000,
  )

  it("rank scale/offset still apply (classifica path intact)", async () => {
    const poster = await darkPoster()
    const shared = { posterBuf: poster, finalRank: 4, rankingBadgeStyle: "pill" as const }
    const base = await generatePosterBuffer(baseInput(shared))
    const scaled = await generatePosterBuffer(baseInput({ ...shared, topBadgeScale: 150 }))
    expect(scaled.equals(base)).toBe(false)
    const shifted = await generatePosterBuffer(baseInput({ ...shared, topBadgeOffsetY: 30 }))
    expect(shifted.equals(base)).toBe(false)
  }, 60000)
})

describe("REAL render: extra ignores classifica tuning once migrated", () => {
  it.each(["default", "pill", "corner"] as const)(
    "extra %s unchanged by tscale/tox/toy when migrated",
    async (style) => {
      const poster = await darkPoster()
      const shared = {
        posterBuf: poster,
        queryExtra: "Extra Label",
        extraBadgeStyle: style,
        extraBadgeScale: 100,
        extraBadgeOffsetX: 0,
        extraBadgeOffsetY: 0,
      }
      const base = await generatePosterBuffer(baseInput(shared))
      const moved = await generatePosterBuffer(baseInput({
        ...shared, topBadgeScale: 150, topBadgeOffsetX: 40, topBadgeOffsetY: 40,
      }))
      expect(moved.equals(base)).toBe(true)
    },
    60000,
  )

  it("extra scale/offset apply from its own tuning", async () => {
    const poster = await darkPoster()
    const shared = { posterBuf: poster, queryExtra: "Extra Label", extraBadgeStyle: "pill" as const }
    const base = await generatePosterBuffer(baseInput(shared))
    const scaled = await generatePosterBuffer(baseInput({ ...shared, extraBadgeScale: 150 }))
    expect(scaled.equals(base)).toBe(false)
    const shifted = await generatePosterBuffer(baseInput({ ...shared, extraBadgeOffsetX: 10 }))
    expect(shifted.equals(base)).toBe(false)
    const cx0 = await brightCenterX(base, 0, 140)
    const cx1 = await brightCenterX(shifted, 0, 140)
    expect(cx0).toBeGreaterThanOrEqual(0)
    expect(cx1 - cx0).toBeGreaterThan(5)
    expect(cx1 - cx0).toBeLessThan(15)
  }, 60000)

  it("extra falls back to classifica tuning when not migrated", async () => {
    const poster = await darkPoster()
    const shared = { posterBuf: poster, queryExtra: "Extra Label", extraBadgeStyle: "pill" as const }
    const base = await generatePosterBuffer(baseInput(shared))
    // Classifica scale moves the unmigrated extra...
    const viaLegacy = await generatePosterBuffer(baseInput({ ...shared, topBadgeScale: 150 }))
    expect(viaLegacy.equals(base)).toBe(false)
    // ...explicit extra wins over classifica.
    const migrated = await generatePosterBuffer(baseInput({ ...shared, topBadgeScale: 150, extraBadgeScale: 100 }))
    expect(migrated.equals(base)).toBe(true)
  }, 60000)
})

describe("REAL render: detached follows its own OY", () => {
  it("extra detached only on exoy, never on toy", async () => {
    const poster = await darkPoster()
    const shared = { posterBuf: poster, queryExtra: "Extra Label", extraBadgeStyle: "pill" as const }
    const base = await generatePosterBuffer(baseInput(shared))
    const exDetached = await generatePosterBuffer(baseInput({ ...shared, extraBadgeOffsetY: 30 }))
    expect(exDetached.equals(base)).toBe(false)
    // Migrated extra (explicit exoy) breaks the legacy fallback: classifica
    // toy neither detaches nor moves it (B2 materialization semantic).
    const migrated = await generatePosterBuffer(baseInput({ ...shared, extraBadgeOffsetY: 0 }))
    expect(migrated.equals(base)).toBe(true)
    const toyOnly = await generatePosterBuffer(baseInput({
      ...shared, extraBadgeOffsetY: 0, topBadgeOffsetY: 60,
    }))
    expect(toyOnly.equals(migrated)).toBe(true)
  }, 60000)

  it("rank detached still on toy, never on exoy", async () => {
    const poster = await darkPoster()
    const shared = { posterBuf: poster, finalRank: 4, rankingBadgeStyle: "pill" as const }
    const base = await generatePosterBuffer(baseInput(shared))
    const rankDetached = await generatePosterBuffer(baseInput({ ...shared, topBadgeOffsetY: 30 }))
    expect(rankDetached.equals(base)).toBe(false)
    const exOnly = await generatePosterBuffer(baseInput({
      ...shared, extraBadgeScale: 150, extraBadgeOffsetX: 40, extraBadgeOffsetY: 40,
    }))
    expect(exOnly.equals(base)).toBe(true)
  }, 60000)
})

describe("REAL render: number baseline never applies to extra", () => {
  it("extra under legacy rs=number keeps the historic anchor", async () => {
    const poster = await darkPoster()
    const shared = {
      posterBuf: poster, queryExtra: "Extra Label",
      rankingBadgeStyle: "number" as const,
      extraBadgeStyle: null,
    }
    const base = await generatePosterBuffer(baseInput(shared))
    // Migrated extra (explicit exox breaks the fallback): classifica tox has
    // no effect on the extra anchor...
    const migrated = await generatePosterBuffer(baseInput({ ...shared, extraBadgeOffsetX: 0 }))
    // ...and explicit-zero extra is byte-identical to the legacy fallback here.
    expect(migrated.equals(base)).toBe(true)
    const viaTox = await generatePosterBuffer(baseInput({ ...shared, extraBadgeOffsetX: 0, topBadgeOffsetX: 10 }))
    expect(viaTox.equals(migrated)).toBe(true)
    // ...its own exox shifts by exactly the adjustment (no -20 baseline).
    const viaExox = await generatePosterBuffer(baseInput({ ...shared, extraBadgeOffsetX: 10 }))
    expect(viaExox.equals(migrated)).toBe(false)
    const cx0 = await brightCenterX(migrated, 0, 140)
    const cx1 = await brightCenterX(viaExox, 0, 140)
    expect(cx1 - cx0).toBeGreaterThan(5)
    expect(cx1 - cx0).toBeLessThan(15)
  }, 60000)
})

describe("REAL render: ribbon keeps classifica tuning", () => {
  it("rank ribbon ignores offsets and extra tuning", async () => {
    const poster = await darkPoster()
    const shared = {
      posterBuf: poster, finalRank: 4,
      rankingBadgeStyle: "netflix" as const, ribbonSide: "left" as const,
    }
    const base = await generatePosterBuffer(baseInput(shared))
    const shifted = await generatePosterBuffer(baseInput({
      ...shared, topBadgeOffsetX: 50, topBadgeOffsetY: 50,
    }))
    expect(shifted.equals(base)).toBe(true)
    const withExtra = await generatePosterBuffer(baseInput({
      ...shared, extraBadgeScale: 150, extraBadgeOffsetX: 40, extraBadgeOffsetY: 40,
    }))
    expect(withExtra.equals(base)).toBe(true)
  }, 60000)
})

describe("REAL render: landscape split", () => {
  it("extra tuning applies in landscape, rank stays independent", async () => {
    const backdrop = await darkBackdrop()
    const rankShared = { posterBuf: backdrop, shape: "landscape" as const, finalRank: 4 }
    const rankBase = await generatePosterBuffer(baseInput(rankShared))
    const rankEx = await generatePosterBuffer(baseInput({
      ...rankShared, extraBadgeScale: 150, extraBadgeOffsetX: 40, extraBadgeOffsetY: 40,
    }))
    expect(rankEx.equals(rankBase)).toBe(true)
    const extraShared = {
      posterBuf: backdrop, shape: "landscape" as const,
      queryExtra: "Extra Label", extraBadgeStyle: "pill" as const,
    }
    const extraBase = await generatePosterBuffer(baseInput(extraShared))
    const extraScaled = await generatePosterBuffer(baseInput({ ...extraShared, extraBadgeScale: 150 }))
    expect(extraScaled.equals(extraBase)).toBe(false)
    const extraLegacyMoved = await generatePosterBuffer(baseInput({ ...extraShared, topBadgeScale: 150 }))
    expect(extraLegacyMoved.equals(extraBase)).toBe(false)
    const extraClassIgnored = await generatePosterBuffer(baseInput({
      ...extraShared, extraBadgeScale: 100, extraBadgeOffsetX: 0, extraBadgeOffsetY: 0,
      topBadgeScale: 150, topBadgeOffsetX: 40, topBadgeOffsetY: 40,
    }))
    expect(extraClassIgnored.equals(extraBase)).toBe(true)
  }, 60000)
})
