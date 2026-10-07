/**
 * Layout dei rating separati (`sepstyle` / `separateRatingsStyle`) — Fase 1,
 * solo backend contratto/stato server (nessun renderer bottom, nessuna UI).
 *
 * Contratto:
 * - enum `column` (default storico, byte-identico) | `bottom-bar` | `bottom-pills`;
 * - catena query > mapping effettivo per formato > config token > defaults
 *   effettivi > `column`; garbage → `column` (fail-closed);
 * - bottom attivo = badgesEnabled && badgeRating && sep && stile bottom,
 *   INDIPENDENTE dai valori (con voti assenti nasconde comunque
 *   genere+anno+voto, senza inventare valori);
 * - soppressione EFFETTIVA solo a render (mai mutazione dello stored);
 * - in bottom la riga custom provider è esclusa; la priorità storica della
 *   colonna (stack vince sul custom) resta invariata.
 */
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  SEPARATE_RATINGS_STYLES,
  DEFAULT_SEPARATE_RATINGS_STYLE,
  isSeparateRatingsStyle,
  isBottomSeparateRatingsStyle,
  getSeparateRatingsStyleForShape,
} from "@/lib/badge-styles"
import {
  resolvePosterRenderConfig,
  resolveSeparateRatingsEnabled,
  resolveSeparateRatingsStyle,
  isBottomSeparateActive,
  resolveSeparateDisplayState,
  type PosterRenderConfigInput,
} from "@/lib/poster-config"
import { pickSeparateRatings } from "@/lib/ratings"
import { buildPreviewUrl, buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
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

describe("separateRatingsStyle enum", () => {
  it("default column, five additive styles, guards", () => {
    expect(DEFAULT_SEPARATE_RATINGS_STYLE).toBe("column")
    expect([...SEPARATE_RATINGS_STYLES].sort()).toEqual(["bottom-bar", "bottom-color", "bottom-mono", "bottom-pills", "column"])
    expect(isSeparateRatingsStyle("column")).toBe(true)
    expect(isSeparateRatingsStyle("bottom-bar")).toBe(true)
    expect(isSeparateRatingsStyle("bottom-pills")).toBe(true)
    expect(isSeparateRatingsStyle("Bottom-Bar")).toBe(false)
    expect(isSeparateRatingsStyle("garbage")).toBe(false)
    expect(isSeparateRatingsStyle(null)).toBe(false)
    expect(isBottomSeparateRatingsStyle("bottom-bar")).toBe(true)
    expect(isBottomSeparateRatingsStyle("bottom-pills")).toBe(true)
    for (const style of ["bottom-mono", "bottom-color"] as const) {
      expect(isSeparateRatingsStyle(style)).toBe(true)
      expect(isBottomSeparateRatingsStyle(style)).toBe(true)
      expect(getSeparateRatingsStyleForShape(style, "landscape")).toBe(style)
    }
    expect(isBottomSeparateRatingsStyle("column")).toBe(false)
    expect(isBottomSeparateRatingsStyle("garbage")).toBe(false)
  })
})

describe("poster-config separateRatingsStyle", () => {
  it("default column senza sorgenti (backwards compat)", () => {
    expect(resolvePosterRenderConfig(cfgInput()).separateRatingsStyle).toBe("column")
  })

  it("catena query > mapping > config > defaults", () => {
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepstyle: "bottom-pills", shape: "poster" }),
      mapping: mapping({ separateRatingsStyle: "bottom-bar" }),
    })).separateRatingsStyle).toBe("bottom-pills")
    expect(resolvePosterRenderConfig(cfgInput({
      mapping: mapping({ separateRatingsStyle: "bottom-bar" }),
      configOverride: tokenCfg({ separateRatingsStyle: "bottom-pills" }),
      sd: { separateRatingsStyle: "bottom-bar" },
    })).separateRatingsStyle).toBe("bottom-bar")
    expect(resolvePosterRenderConfig(cfgInput({
      configOverride: tokenCfg({ separateRatingsStyle: "bottom-pills" }),
      sd: { separateRatingsStyle: "bottom-bar" },
    })).separateRatingsStyle).toBe("bottom-pills")
    expect(resolvePosterRenderConfig(cfgInput({
      sd: { separateRatingsStyle: "bottom-pills" },
    })).separateRatingsStyle).toBe("bottom-pills")
  })

  it("garbage fail-closed a column (mai ereditare mapping/default)", () => {
    const withMappingBottom = {
      mapping: mapping({ separateRatingsStyle: "bottom-bar" }),
      sd: { separateRatingsStyle: "bottom-pills" as const },
    }
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepstyle: "garbage" }),
      ...withMappingBottom,
    })).separateRatingsStyle).toBe("column")
    // Query presente ma vuota: anch'essa fail-closed column (has/get distinta
    // dall'assenza — con || erediterebbe il mapping bottom).
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepstyle: "" }),
      ...withMappingBottom,
    })).separateRatingsStyle).toBe("column")
    // Assenza vera: eredita il mapping (bottom conservato).
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams(),
      ...withMappingBottom,
    })).separateRatingsStyle).toBe("bottom-bar")
  })

  it("query case-insensitive con canonical lowercase (unica policy)", () => {
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepstyle: "Bottom-Bar" }),
    })).separateRatingsStyle).toBe("bottom-bar")
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepstyle: "BOTTOM-PILLS" }),
      mapping: mapping({ separateRatingsStyle: "bottom-bar" }),
    })).separateRatingsStyle).toBe("bottom-pills")
  })

  it("profilo landscape del mapping vince sul flat (bar normalizzata a pills)", () => {
    const saved = mapping({
      separateRatingsStyle: "column",
      landscape: { separateRatingsStyle: "bottom-bar" },
    })
    const r = resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      mapping: saved,
    }))
    expect(r.posterShape).toBe("landscape")
    // Normalizzazione DOPO cascata: il raw salvato resta bottom-bar (il
    // portrait lo rende ancora come barra), l'effettivo landscape è pills.
    expect(r.separateRatingsStyle).toBe("bottom-pills")
    expect(saved.landscape?.separateRatingsStyle).toBe("bottom-bar")
    // Portrait resta sul flat, barra invariata.
    expect(resolvePosterRenderConfig(cfgInput({
      mapping: mapping({
        separateRatingsStyle: "column",
        landscape: { separateRatingsStyle: "bottom-bar" },
      }),
    })).separateRatingsStyle).toBe("column")
    expect(resolvePosterRenderConfig(cfgInput({
      mapping: mapping({ separateRatingsStyle: "bottom-bar" }),
    })).separateRatingsStyle).toBe("bottom-bar")
  })

  it("helper centralizzato concorda con resolvePosterRenderConfig", () => {
    const q = new URLSearchParams({ sep: "1", sepstyle: "bottom-bar" })
    const m = mapping({ separateRatings: true, separateRatingsStyle: "bottom-pills" })
    expect(resolveSeparateRatingsEnabled(q, m, null, {})).toBe(true)
    expect(resolveSeparateRatingsStyle(q, m, null, {}, "poster")).toBe("bottom-bar")
    expect(resolveSeparateRatingsEnabled(new URLSearchParams(), null, null, {})).toBe(false)
    expect(resolveSeparateRatingsEnabled(new URLSearchParams(), m, null, {})).toBe(true)
  })

  it("helper bar→pills solo in landscape (portrait intatto)", () => {
    expect(getSeparateRatingsStyleForShape("bottom-bar", "landscape")).toBe("bottom-pills")
    expect(getSeparateRatingsStyleForShape("bottom-bar", "poster")).toBe("bottom-bar")
    expect(getSeparateRatingsStyleForShape("bottom-pills", "landscape")).toBe("bottom-pills")
    expect(getSeparateRatingsStyleForShape("column", "landscape")).toBe("column")
  })

  it("normalizzazione landscape da tutte e 4 le sorgenti (query/mapping/token/defaults)", () => {
    const bar = "bottom-bar" as const
    // Query.
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams({ sepstyle: "bottom-bar" }), null, null, {}, "landscape",
    )).toBe("bottom-pills")
    // Mapping flat.
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams(), mapping({ separateRatingsStyle: bar }), null, {}, "landscape",
    )).toBe("bottom-pills")
    // Mapping landscape.
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams(),
      mapping({ landscape: { separateRatingsStyle: bar } }),
      null, {}, "landscape",
    )).toBe("bottom-pills")
    // Config token.
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams(), null, tokenCfg({ separateRatingsStyle: bar }), {}, "landscape",
    )).toBe("bottom-pills")
    // Server defaults (+ profilo landscape).
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams(), null, null, { separateRatingsStyle: bar }, "landscape",
    )).toBe("bottom-pills")
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams(), null, null,
      { landscape: { separateRatingsStyle: bar } }, "landscape",
    )).toBe("bottom-pills")
  })

  it("landscape: garbage/vuoto espliciti → column (fail-closed invariato), column resta column", () => {
    const bottomMapping = mapping({ separateRatingsStyle: "bottom-bar" })
    const bottomSd = { separateRatingsStyle: "bottom-pills" as const }
    for (const sepstyle of ["garbage", ""]) {
      expect(resolveSeparateRatingsStyle(
        new URLSearchParams({ sepstyle }), bottomMapping, null, bottomSd, "landscape",
      )).toBe("column")
    }
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams({ sepstyle: "column" }), bottomMapping, null, bottomSd, "landscape",
    )).toBe("column")
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams(), bottomMapping, null, bottomSd, "landscape",
    )).toBe("bottom-pills")
  })

  it("portrait: barra invariata da ogni sorgente (raw portrait intatto)", () => {
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams({ sepstyle: "bottom-bar" }), null, null, {}, "poster",
    )).toBe("bottom-bar")
    expect(resolveSeparateRatingsStyle(
      new URLSearchParams(), mapping({ separateRatingsStyle: "bottom-bar" }), null, {}, "poster",
    )).toBe("bottom-bar")
    expect(resolvePosterRenderConfig(cfgInput({
      searchParams: new URLSearchParams({ sepstyle: "bottom-bar" }),
    })).separateRatingsStyle).toBe("bottom-bar")
  })
})

describe("bottom-active e suppression (solo render, mai stored)", () => {
  it("richiede tutti e quattro i flag, indipendente dai valori", () => {
    const base = { badgesEnabled: true, badgeRating: true, separateRatings: true, separateRatingsStyle: "bottom-bar" as const }
    expect(isBottomSeparateActive(base)).toBe(true)
    expect(isBottomSeparateActive({ ...base, separateRatingsStyle: "bottom-pills" })).toBe(true)
    expect(isBottomSeparateActive({ ...base, separateRatingsStyle: "bottom-mono" })).toBe(true)
    expect(isBottomSeparateActive({ ...base, separateRatingsStyle: "bottom-color" })).toBe(true)
    expect(isBottomSeparateActive({ ...base, separateRatingsStyle: "column" })).toBe(false)
    expect(isBottomSeparateActive({ ...base, badgesEnabled: false })).toBe(false)
    expect(isBottomSeparateActive({ ...base, badgeRating: false })).toBe(false)
    expect(isBottomSeparateActive({ ...base, separateRatings: false })).toBe(false)
    expect(isBottomSeparateActive({ ...base, separateRatingsStyle: "garbage" })).toBe(false)
    expect(isBottomSeparateActive({ ...base, separateRatingsStyle: null })).toBe(false)
  })

  it("con bg/by=1 il bottom sopprime genere+anno+voto (0-1-3 provider)", () => {
    for (const count of [0, 1, 3]) {
      const s = resolveSeparateDisplayState({
        badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
        separateRatings: true, separateRatingsStyle: "bottom-bar", sepItemCount: count,
      })
      expect(s.bottomActive).toBe(true)
      expect(s.useSeparate).toBe(false)
      expect(s.effectiveBadgeGenre).toBe(false)
      expect(s.effectiveBadgeYear).toBe(false)
      expect(s.effectiveBadgeRating).toBe(false)
      expect(s.suppressCustomRow).toBe(true)
    }
  })

  it("colonna storica invariata: con valori sostituisce la media, senza fallback media", () => {
    const withValues = resolveSeparateDisplayState({
      badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
      separateRatings: true, separateRatingsStyle: "column", sepItemCount: 2,
    })
    expect(withValues.bottomActive).toBe(false)
    expect(withValues.useSeparate).toBe(true)
    expect(withValues.effectiveBadgeRating).toBe(false)
    // Genere+anno restano (solo la media è sostituita).
    expect(withValues.effectiveBadgeGenre).toBe(true)
    expect(withValues.effectiveBadgeYear).toBe(true)
    // Priorità storica: la colonna NON sopprime il custom a livello display
    // (lo nasconde il renderer come prima) — mai invertire col bottom.
    expect(withValues.suppressCustomRow).toBe(false)
    const missing = resolveSeparateDisplayState({
      badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
      separateRatings: true, separateRatingsStyle: "column", sepItemCount: 0,
    })
    expect(missing.useSeparate).toBe(false)
    expect(missing.effectiveBadgeRating).toBe(true)
  })

  it("a sep OFF o badgeRating OFF nessuna soppressione (qualsiasi stile)", () => {
    for (const style of ["column", "bottom-bar", "bottom-pills", "bottom-mono", "bottom-color"] as const) {
      const off = resolveSeparateDisplayState({
        badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
        separateRatings: false, separateRatingsStyle: style, sepItemCount: 3,
      })
      expect(off.bottomActive).toBe(false)
      expect(off.useSeparate).toBe(false)
      expect(off.effectiveBadgeGenre).toBe(true)
      expect(off.suppressCustomRow).toBe(false)
    }
  })
})

describe("pickSeparateRatings (0-1-3 provider, missing → [])", () => {
  it("cap max 3 in ordine rsrc, skip miss/0", () => {
    const agg = { sources: { imdb: 8.7, tmdb: 7.3, tomatoes: 8.8, letterboxd: 4.1 }, average: 8, count: 4 }
    expect(pickSeparateRatings(agg, ["imdb", "tmdb", "tomatoes", "letterboxd"])).toHaveLength(3)
    expect(pickSeparateRatings(null, ["imdb"])).toEqual([])
    expect(pickSeparateRatings({ sources: {}, average: 0, count: 0 }, ["imdb"])).toEqual([])
  })
})

describe("config token separateRatingsStyle", () => {
  it("round-trip preserva lo stile", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { encodeConfig, decodeConfig } = await import("@/lib/config-token")
    const token = encodeConfig(tokenCfg({ separateRatingsStyle: "bottom-pills" }))
    expect(decodeConfig(token)?.separateRatingsStyle).toBe("bottom-pills")
  })

  it("stile garbage nel token → token rifiutato (fail-closed, mai default inventato)", async () => {
    vi.stubEnv("CONFIG_HMAC_SECRET", "")
    vi.stubEnv("ENCRYPTION_KEY_SECRET", "")
    vi.stubEnv("NODE_ENV", "test")
    vi.resetModules()
    const { decodeConfig } = await import("@/lib/config-token")
    const raw = Buffer.from(
      JSON.stringify({ ...tokenCfg(), separateRatingsStyle: "garbage" }),
      "utf-8",
    ).toString("base64url")
    expect(decodeConfig(raw)).toBeNull()
  })
})

describe("validation separateRatingsStyle", () => {
  it("query nei bound, mapping + landscape, garbage rifiutato", () => {
    expect(posterQuerySchema.safeParse({ sepstyle: "bottom-bar" }).success).toBe(true)
    expect(posterQuerySchema.safeParse({ sepstyle: "x".repeat(17) }).success).toBe(false)
    const base = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }
    expect(mappingSchema.safeParse({ ...base, separateRatingsStyle: "bottom-pills" }).success).toBe(true)
    expect(mappingSchema.safeParse({
      ...base,
      separateRatingsStyle: "bottom-bar",
      landscape: { separateRatingsStyle: "bottom-pills" },
    }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, separateRatingsStyle: "garbage" }).success).toBe(false)
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

  it("preview sempre esplicita (column di default, sovrascrive il mapping)", () => {
    expect(buildPreviewUrl(ps as never, { ...bp, separateRatingsStyle: "bottom-bar" } as never)).toContain("sepstyle=bottom-bar")
    expect(buildPreviewUrl(ps as never, bp as never)).toContain("sepstyle=column")
  })

  it.each(["bottom-mono", "bottom-color"] as const)("preview editor reale emette sepstyle=%s (portrait e landscape, raw intatto)", (style) => {
    expect(buildPreviewUrl(ps as never, { ...bp, separateRatingsStyle: style } as never)).toContain(`sepstyle=${style}`)
    expect(buildPreviewUrl(ps as never, { ...bp, posterShape: "landscape", separateRatingsStyle: style } as never)).toContain(`sepstyle=${style}`)
    const raw = { ...bp, separateRatingsStyle: style } as { separateRatingsStyle: string }
    buildPreviewUrl(ps as never, raw as never)
    expect(raw.separateRatingsStyle).toBe(style)
  })

  it("preview normalizza bar→pills in landscape (raw mai mutato, portrait intatto)", () => {
    const landscapeBp = { ...bp, posterShape: "landscape", separateRatingsStyle: "bottom-bar" } as never
    expect(buildPreviewUrl(ps as never, landscapeBp)).toContain("sepstyle=bottom-pills")
    expect((landscapeBp as { separateRatingsStyle: string }).separateRatingsStyle).toBe("bottom-bar")
    expect(buildPreviewUrl(ps as never, { ...bp, separateRatingsStyle: "bottom-bar" } as never)).toContain("sepstyle=bottom-bar")
    expect(buildPreviewUrl(ps as never, { ...bp, posterShape: "landscape", separateRatingsStyle: "bottom-pills" } as never)).toContain("sepstyle=bottom-pills")
  })

  it("default-preview con default globale", () => {
    expect(buildDefaultsPreviewUrl({ defaultSeparateRatingsStyle: "bottom-pills" })).toContain("sepstyle=bottom-pills")
    expect(buildDefaultsPreviewUrl({})).toContain("sepstyle=column")
  })

  it("default-preview normalizza col formato Orizzontale", () => {
    expect(buildDefaultsPreviewUrl({ defaultSeparateRatingsStyle: "bottom-bar", defaultPosterShape: "landscape" })).toContain("sepstyle=bottom-pills")
    expect(buildDefaultsPreviewUrl({ defaultSeparateRatingsStyle: "bottom-bar" })).toContain("sepstyle=bottom-bar")
  })

  it("Stremio: emesso solo quando bottom (legacy invariati), mai in dv", () => {
    const bottom = buildStremioPosterSearchParams({ separateRatings: true, separateRatingsStyle: "bottom-bar" })
    expect(bottom.get("sep")).toBe("1")
    expect(bottom.get("sepstyle")).toBe("bottom-bar")
    const legacy = buildStremioPosterSearchParams({ separateRatings: true })
    expect(legacy.get("sep")).toBe("1")
    expect(legacy.get("sepstyle")).toBeNull()
    const column = buildStremioPosterSearchParams({ separateRatingsStyle: "column" })
    expect(column.get("sepstyle")).toBeNull()
    // Compact: resta esplicito (enum come bs/rs), dv invariato dallo stile.
    const c1 = buildStremioPosterSearchParams({ compactTuning: true, separateRatingsStyle: "bottom-bar" })
    const c2 = buildStremioPosterSearchParams({ compactTuning: true, separateRatingsStyle: "bottom-pills" })
    expect(c1.get("sepstyle")).toBe("bottom-bar")
    expect(c1.get("dv")).toBe(buildStremioPosterSearchParams({ compactTuning: true }).get("dv"))
    expect(c2.get("sepstyle")).toBe("bottom-pills")
  })

  it("Stremio: normalizza a formato noto, raw a formato ignoto (Nuvio {shape})", () => {
    const land = buildStremioPosterSearchParams({ separateRatings: true, separateRatingsStyle: "bottom-bar", posterShape: "landscape" })
    expect(land.get("sepstyle")).toBe("bottom-pills")
    // Template Nuvio a formato dinamico: raw invariato, normalizza il server.
    const unknown = buildStremioPosterSearchParams({ separateRatings: true, separateRatingsStyle: "bottom-bar", posterShape: "landscape", shapeUnknown: true })
    expect(unknown.get("sepstyle")).toBe("bottom-bar")
    // Portrait invariato in ogni caso.
    expect(buildStremioPosterSearchParams({ separateRatings: true, separateRatingsStyle: "bottom-bar", posterShape: "poster" }).get("sepstyle")).toBe("bottom-bar")
    expect(buildStremioPosterSearchParams({ separateRatings: true, separateRatingsStyle: "bottom-bar" }).get("sepstyle")).toBe("bottom-bar")
  })

  it("Stremio URL dal mapping: bottom emesso, column omesso", () => {
    const bottomUrl = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ separateRatings: true, separateRatingsStyle: "bottom-pills" }), lang: "it",
    })
    expect(bottomUrl.searchParams.get("sep")).toBe("1")
    expect(bottomUrl.searchParams.get("sepstyle")).toBe("bottom-pills")
    const columnUrl = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {},
      mapping: mapping({ separateRatings: true, separateRatingsStyle: "column" }), lang: "it",
    })
    expect(columnUrl.searchParams.get("sepstyle")).toBeNull()
  })
})

describe("cache e hardening sepstyle", () => {
  it("allowlist contiene sepstyle; garbage/vuoto → column esplicito (chiave distinta dall'assenza)", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("sepstyle")).toBe(true)
    expect(normalizePosterCacheParams(new URLSearchParams("sepstyle=bottom-bar")).get("sepstyle")).toBe("bottom-bar")
    // Unica policy col resolver: canonical lowercase anche in chiave.
    expect(normalizePosterCacheParams(new URLSearchParams("sepstyle=Bottom-Bar")).get("sepstyle")).toBe("bottom-bar")
    // Fail-closed con distinzione dall'assenza (pattern bfont): garbage e
    // vuoto normalizzano a column esplicito — mai delete (che collasserebbe
    // con l'assenza ereditante mapping bottom = avvelenamento cache).
    expect(normalizePosterCacheParams(new URLSearchParams("sepstyle=garbage")).get("sepstyle")).toBe("column")
    expect(normalizePosterCacheParams(new URLSearchParams("sepstyle=")).get("sepstyle")).toBe("column")
    const garbageKey = normalizePosterCacheParams(new URLSearchParams("sepstyle=garbage")).toString()
    const absentKey = normalizePosterCacheParams(new URLSearchParams()).toString()
    expect(garbageKey).toContain("sepstyle=column")
    expect(absentKey).not.toContain("sepstyle")
    expect(garbageKey).not.toBe(absentKey)
  })

  it("presets-mode identico al resolver: valido canonical, garbage/vuoto → column, mai delete", () => {
    const input = {
      presets: true,
      preview: false,
      anonymous: false,
      publicInstance: true,
      hasMapping: false,
    }
    expect(hardenPosterSearchParams(new URLSearchParams("sepstyle=bottom-pills"), input).get("sepstyle")).toBe("bottom-pills")
    expect(hardenPosterSearchParams(new URLSearchParams("sepstyle=BOTTOM-PILLS"), input).get("sepstyle")).toBe("bottom-pills")
    expect(hardenPosterSearchParams(new URLSearchParams("sepstyle=garbage"), input).get("sepstyle")).toBe("column")
    expect(hardenPosterSearchParams(new URLSearchParams("sepstyle="), input).get("sepstyle")).toBe("column")
    expect(hardenPosterSearchParams(new URLSearchParams(), input).get("sepstyle")).toBeNull()
    // Preview sempre esente.
    const preview = hardenPosterSearchParams(new URLSearchParams("sepstyle=bottom-bar"), {
      presets: true,
      preview: true,
      anonymous: false,
      publicInstance: true,
      hasMapping: false,
    })
    expect(preview.get("sepstyle")).toBe("bottom-bar")
  })

  it("polarità bl separa la cache: bl=0 vs bl=1 chiavi distinte, garbage collassa", () => {
    // La fascia bottom adattiva dipende da bl: le due polarità non devono
    // mai condividere la chiave (avvelenamento cache tra fondo chiaro/scuro).
    const dark = normalizePosterCacheParams(new URLSearchParams("sepstyle=bottom-bar&bl=1")).toString()
    const light = normalizePosterCacheParams(new URLSearchParams("sepstyle=bottom-bar&bl=0")).toString()
    expect(dark).toContain("bl=1")
    expect(light).toContain("bl=0")
    expect(dark).not.toBe(light)
    // Garbage collassa (fail-closed come tl): mai chiave distinta a render
    // che ricade sul computo automatico.
    const garbage = normalizePosterCacheParams(new URLSearchParams("sepstyle=bottom-bar&bl=maybe")).toString()
    expect(garbage).not.toContain("bl=")
    expect(garbage).not.toBe(dark)
  })
})
