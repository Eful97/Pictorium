import { describe, expect, it } from "vitest"
import { resolvePosterLayout, resolvePosterRenderConfig } from "@/lib/poster-config"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { POSTER_CACHE_ALLOWLIST, hardenPosterSearchParams } from "@/lib/poster-params-hardening"
import { mappingSchema, posterQuerySchema, validatePosterQuery } from "@/lib/validation"
import { configTokenSchema, decodeConfig, encodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { proxyDefaultsSignature } from "@/lib/addon-proxy"
import { buildPreviewUrl, buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { effectiveDefaultsForShape, type ServerDefaults } from "@/lib/server-defaults"
import type { Mapping } from "@/lib/types"
import type { GenerationInput } from "@/lib/poster-service"

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

function resolve(
  query: string,
  opts: { mapping?: Mapping | null; config?: PictoriumUserConfig | null; sd?: ServerDefaults; shape?: "poster" | "landscape" } = {},
) {
  return resolvePosterLayout(
    new URLSearchParams(query),
    opts.mapping ?? null,
    opts.config ?? null,
    opts.sd ?? {},
    opts.shape ?? "poster",
  )
}

function renderLayout(
  query: string,
  opts: { mapping?: Mapping | null; config?: PictoriumUserConfig | null; sd?: ServerDefaults; shape?: "poster" | "landscape" } = {},
) {
  return resolvePosterRenderConfig({
    searchParams: new URLSearchParams(query),
    mapping: opts.mapping ?? null,
    configOverride: opts.config ?? null,
    sd: opts.sd ?? {},
    hasQuery: false,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
  }).posterLayout
}

const TOKEN_BASE: PictoriumUserConfig = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  gradientHeight: 30,
  networkLogo: true,
  autoRotateClean: false,
}

describe("resolvePosterLayout precedence", () => {
  it("defaults to standard when absent everywhere", () => {
    expect(resolve("")).toBe("standard")
    expect(resolve("", { mapping: mapping(), sd: {} })).toBe("standard")
  })

  it("query fresh wins over mapping/config/defaults", () => {
    expect(resolve("layout=fresh", {
      mapping: mapping({ posterLayout: "standard" }),
      config: { ...TOKEN_BASE, posterLayout: "standard" },
      sd: { posterLayout: "standard" },
    })).toBe("fresh")
  })

  it("present-but-invalid query resolves to explicit standard, never inherits fresh", () => {
    const m = mapping({ posterLayout: "fresh" })
    const sd: ServerDefaults = { posterLayout: "fresh" }
    expect(resolve("layout=bogus", { mapping: m, sd })).toBe("standard")
    expect(resolve("layout=", { mapping: m, sd })).toBe("standard")
  })

  it("valid explicit standard overrides inherited fresh", () => {
    expect(resolve("layout=standard", {
      mapping: mapping({ posterLayout: "fresh" }),
      sd: { posterLayout: "fresh" },
    })).toBe("standard")
    // Same with fresh arriving from the config token: explicit standard wins.
    expect(resolve("layout=standard", {
      mapping: mapping({ posterLayout: "fresh" }),
      config: { ...TOKEN_BASE, posterLayout: "fresh" },
      sd: { posterLayout: "fresh" },
    })).toBe("standard")
  })

  it("absent query inherits fresh from the effective mapping", () => {
    expect(resolve("", { mapping: mapping({ posterLayout: "fresh" }) })).toBe("fresh")
  })

  it("absent query follows the landscape mapping profile per shape", () => {
    const m = mapping({ landscape: { posterLayout: "fresh" } })
    expect(resolve("", { mapping: m, shape: "landscape" })).toBe("fresh")
    expect(resolve("", { mapping: m, shape: "poster" })).toBe("standard")
  })

  it("absent query inherits fresh from config token and flat defaults", () => {
    expect(resolve("", { config: { ...TOKEN_BASE, posterLayout: "fresh" } })).toBe("fresh")
    expect(resolve("", { sd: { posterLayout: "fresh" } })).toBe("fresh")
  })

  it("absent query follows effective landscape defaults per shape", () => {
    const sd: ServerDefaults = { landscape: { posterLayout: "fresh" } }
    expect(resolve("", { sd, shape: "landscape" })).toBe("fresh")
    expect(resolve("", { sd, shape: "poster" })).toBe("standard")
    expect(effectiveDefaultsForShape(sd, "landscape").posterLayout).toBe("fresh")
    expect(effectiveDefaultsForShape(sd, "poster").posterLayout).toBeUndefined()
  })

  it("query is case-insensitive", () => {
    expect(resolve("layout=FRESH")).toBe("fresh")
    expect(resolve("layout=Standard")).toBe("standard")
  })

  it("invalid stored values sanitize to standard", () => {
    const m = mapping({ posterLayout: "bogus" as unknown as Mapping["posterLayout"] })
    expect(resolve("", { mapping: m })).toBe("standard")
  })
})

describe("resolvePosterRenderConfig posterLayout", () => {
  it("covers the full query > mapping > config > effective defaults > standard chain", () => {
    // Standard fallthrough.
    expect(renderLayout("")).toBe("standard")
    // Effective defaults win over nothing.
    expect(renderLayout("", { sd: { posterLayout: "fresh" } })).toBe("fresh")
    // Config wins over defaults.
    expect(renderLayout("", {
      config: { ...TOKEN_BASE, posterLayout: "standard" },
      sd: { posterLayout: "fresh" },
    })).toBe("standard")
    // Mapping wins over config.
    expect(renderLayout("", {
      mapping: mapping({ posterLayout: "fresh" }),
      config: { ...TOKEN_BASE, posterLayout: "standard" },
    })).toBe("fresh")
    // Query wins over mapping.
    expect(renderLayout("layout=standard", { mapping: mapping({ posterLayout: "fresh" }) })).toBe("standard")
    // Invalid query never inherits.
    expect(renderLayout("layout=bogus", { mapping: mapping({ posterLayout: "fresh" }) })).toBe("standard")
  })
})

describe("poster layout cache identity", () => {
  it("is allowlisted", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("layout")).toBe(true)
  })

  it("keeps fresh, canonicalizes case, fail-closes garbage to explicit standard", () => {
    expect(normalizePosterCacheParams(new URLSearchParams("layout=fresh")).get("layout")).toBe("fresh")
    expect(normalizePosterCacheParams(new URLSearchParams("layout=FRESH")).get("layout")).toBe("fresh")
    expect(normalizePosterCacheParams(new URLSearchParams("layout=bogus")).get("layout")).toBe("standard")
    expect(normalizePosterCacheParams(new URLSearchParams("layout=")).get("layout")).toBe("standard")
  })

  it("keeps absent absent, and explicit standard distinct from absent", () => {
    const absent = normalizePosterCacheParams(new URLSearchParams("bs=pill"))
    expect(absent.has("layout")).toBe(false)
    const explicit = normalizePosterCacheParams(new URLSearchParams("bs=pill&layout=standard"))
    expect(explicit.get("layout")).toBe("standard")
    // Distinct keys: absent may inherit fresh, explicit standard overrides it.
    expect(explicit.toString()).not.toBe(absent.toString())
    // Garbage collapses onto explicit standard (same render, one key).
    expect(normalizePosterCacheParams(new URLSearchParams("bs=pill&layout=bogus")).toString())
      .toBe(explicit.toString())
  })

  it("presets hardening canonicalizes layout without dropping it", () => {
    const hardened = (q: string) => hardenPosterSearchParams(new URLSearchParams(q), {
      presets: true,
      preview: false,
      anonymous: false,
      publicInstance: false,
      hasMapping: false,
    })
    expect(hardened("layout=fresh").get("layout")).toBe("fresh")
    expect(hardened("layout=BOGUS").get("layout")).toBe("standard")
    expect(hardened("bs=pill").has("layout")).toBe(false)
  })
})

describe("poster layout query schema", () => {
  it("accepts layout within bounds", () => {
    expect(posterQuerySchema.safeParse({ layout: "fresh" }).success).toBe(true)
  })

  it("rejects an overlong layout before slot/cache", () => {
    const long = "f".repeat(17)
    expect(posterQuerySchema.safeParse({ layout: long }).success).toBe(false)
    expect(validatePosterQuery(new URLSearchParams(`layout=${long}`))).toContain("layout")
  })
})

describe("poster layout mapping persistence", () => {
  const base = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }

  it("accepts valid flat and landscape values, keeps legacy mappings valid", () => {
    expect(mappingSchema.safeParse({ ...base, posterLayout: "fresh" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, posterLayout: null }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, landscape: { posterLayout: "fresh" } }).success).toBe(true)
    expect(mappingSchema.safeParse(base).success).toBe(true)
  })

  it("rejects invalid flat and landscape values", () => {
    expect(mappingSchema.safeParse({ ...base, posterLayout: "bogus" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, landscape: { posterLayout: "bogus" } }).success).toBe(false)
  })
})

describe("poster layout config token", () => {
  it("accepts fresh and rejects garbage", () => {
    expect(configTokenSchema.safeParse({ ...TOKEN_BASE, posterLayout: "fresh" }).success).toBe(true)
    expect(configTokenSchema.safeParse({ ...TOKEN_BASE }).success).toBe(true)
    expect(configTokenSchema.safeParse({ ...TOKEN_BASE, posterLayout: "bogus" }).success).toBe(false)
  })

  it("round-trips fresh and refuses a tampered layout", () => {
    const token = encodeConfig({ ...TOKEN_BASE, posterLayout: "fresh" })
    expect(decodeConfig(token)?.posterLayout).toBe("fresh")
    const tampered = Buffer.from(JSON.stringify({ ...TOKEN_BASE, posterLayout: "bogus" }), "utf-8").toString("base64url")
    expect(decodeConfig(tampered)).toBeNull()
  })
})

describe("poster layout Stremio URL", () => {
  const input = (mappingArg: Mapping | null, defaults: ServerDefaults = {}) => ({
    origin: "https://x.test",
    type: "movie" as const,
    id: 1,
    defaults,
    mapping: mappingArg,
    lang: "it",
  })

  it("leaves legacy unspecified URLs byte-stable (no layout param)", () => {
    const url = buildStremioPosterUrl(input(null))
    expect(url.searchParams.has("layout")).toBe(false)
    const mappedNull = buildStremioPosterUrl(input(mapping({ posterLayout: null })))
    expect(mappedNull.searchParams.has("layout")).toBe(false)
    // Absent builder input stays absent too.
    expect(buildStremioPosterSearchParams({}).has("layout")).toBe(false)
    expect(buildStremioPosterSearchParams({ posterLayout: null }).has("layout")).toBe(false)
    expect(buildStremioPosterSearchParams({ posterLayout: undefined }).has("layout")).toBe(false)
  })

  // Intentional contract change (correction cycle 1): an EXPLICIT mapped
  // standard now travels as `layout=standard` instead of collapsing onto
  // absent. The previous assertion (`mapped standard` → absent) had to go
  // because absent inherits fresh server-side — dropping the explicit
  // standard made it impossible to override a fresh from config/defaults
  // for unsaved/template consumers. Only unspecified stays param-less.
  it("emits explicit standard so it overrides inherited fresh", () => {
    const mapped = buildStremioPosterUrl(input(mapping({ posterLayout: "standard" })))
    expect(mapped.searchParams.get("layout")).toBe("standard")
    expect(buildStremioPosterSearchParams({ posterLayout: "standard" }).get("layout")).toBe("standard")
  })

  it("explicit standard in the URL wins over fresh from config/defaults", () => {
    const url = buildStremioPosterUrl(
      input(mapping({ posterLayout: "standard" }), { posterLayout: "fresh" }),
    )
    expect(url.searchParams.get("layout")).toBe("standard")
    // End-to-end through the resolver: the emitted param resolves standard
    // even with fresh stored everywhere.
    expect(resolvePosterLayout(
      url.searchParams,
      mapping({ posterLayout: "fresh" }),
      { ...TOKEN_BASE, posterLayout: "fresh" },
      { posterLayout: "fresh" },
      "poster",
    )).toBe("standard")
  })

  it("emits layout=fresh from mapping or defaults, never garbage", () => {
    expect(buildStremioPosterUrl(input(mapping({ posterLayout: "fresh" }))).searchParams.get("layout")).toBe("fresh")
    expect(buildStremioPosterUrl(input(null, { posterLayout: "fresh" })).searchParams.get("layout")).toBe("fresh")
    const garbage = buildStremioPosterSearchParams({ posterLayout: "bogus" as unknown as "fresh" })
    expect(garbage.has("layout")).toBe(false)
  })

  it("stays explicit under compactTuning (never inside dv)", () => {
    const params = buildStremioPosterSearchParams({ posterLayout: "fresh", compactTuning: true })
    expect(params.get("layout")).toBe("fresh")
    expect(params.has("dv")).toBe(true)
    // Explicit standard is not swallowed by compact either: it must travel
    // so it can override inherited fresh (absent would inherit).
    const std = buildStremioPosterSearchParams({ posterLayout: "standard", compactTuning: true })
    expect(std.get("layout")).toBe("standard")
    expect(std.has("dv")).toBe(true)
  })
})

describe("poster layout default fingerprint", () => {
  it("distinguishes fresh from standard defaults", () => {
    expect(proxyDefaultsSignature({ posterLayout: "fresh" })).not.toBe(proxyDefaultsSignature({}))
    expect(proxyDefaultsSignature({ posterLayout: "fresh" })).toBe(proxyDefaultsSignature({ posterLayout: "fresh" }))
  })
})

describe("poster layout GenerationInput contract", () => {
  it("is accepted (unused) by the single renderer input", () => {
    const probe: Pick<GenerationInput, "posterLayout"> = { posterLayout: "fresh" }
    expect(probe.posterLayout).toBe("fresh")
  })
})

// Intermediate contract step (Provider Glass / Nuvio / Stremio): the three
// cover IDs are accepted and survive every serialization/resolution path
// intact in portrait AND landscape, without changing any Standard/Fresh
// default or saved value. Rendering + selector exposure land later.
const COVER_LAYOUTS = ["provider-glass", "nuvio", "stremio"] as const

function paramsOf(url: string): URLSearchParams {
  return new URL(String(url), "http://localhost").searchParams
}

function previewState() {
  return {
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
  }
}

function badgeParams() {
  return {
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
  }
}

describe("cover layout resolution (portrait + landscape)", () => {
  it.each(COVER_LAYOUTS)("query %s wins over mapping/config/defaults in both shapes", (layout) => {
    for (const shape of ["poster", "landscape"] as const) {
      expect(resolve(`layout=${layout}`, {
        mapping: mapping({ posterLayout: "fresh", landscape: { posterLayout: "fresh" } }),
        config: { ...TOKEN_BASE, posterLayout: "fresh" },
        sd: { posterLayout: "fresh", landscape: { posterLayout: "fresh" } },
        shape,
      })).toBe(layout)
    }
  })

  it.each(COVER_LAYOUTS)("query %s is case-insensitive", (layout) => {
    expect(resolve(`layout=${layout.toUpperCase()}`)).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("absent query inherits flat mapping %s in both shapes", (layout) => {
    expect(resolve("", { mapping: mapping({ posterLayout: layout }) })).toBe(layout)
    expect(resolve("", { mapping: mapping({ posterLayout: layout }), shape: "landscape" })).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("mapping profile keeps %s independent per shape", (layout) => {
    const other = layout === "nuvio" ? "stremio" : "nuvio"
    const m = mapping({ posterLayout: layout, landscape: { posterLayout: other } })
    expect(resolve("", { mapping: m, shape: "poster" })).toBe(layout)
    expect(resolve("", { mapping: m, shape: "landscape" })).toBe(other)
  })

  it.each(COVER_LAYOUTS)("absent query inherits %s from config token and flat defaults", (layout) => {
    expect(resolve("", { config: { ...TOKEN_BASE, posterLayout: layout } })).toBe(layout)
    expect(resolve("", { sd: { posterLayout: layout } })).toBe(layout)
    expect(resolve("", { sd: { posterLayout: layout }, shape: "landscape" })).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("landscape defaults profile carries %s only in landscape", (layout) => {
    const sd: ServerDefaults = { landscape: { posterLayout: layout } }
    expect(resolve("", { sd, shape: "landscape" })).toBe(layout)
    expect(resolve("", { sd, shape: "poster" })).toBe("standard")
  })

  it.each(COVER_LAYOUTS)("render config resolves %s through the full chain", (layout) => {
    expect(renderLayout(`layout=${layout}`, { mapping: mapping({ posterLayout: "fresh" }) })).toBe(layout)
    expect(renderLayout("", { mapping: mapping({ posterLayout: layout }) })).toBe(layout)
    expect(renderLayout("", { mapping: mapping({ posterLayout: layout }), shape: "landscape" })).toBe(layout)
    expect(renderLayout("", { sd: { posterLayout: layout } })).toBe(layout)
  })

  it("invalid query still fail-closes to explicit standard, never inherits a cover layout", () => {
    for (const layout of COVER_LAYOUTS) {
      const m = mapping({ posterLayout: layout })
      const sd: ServerDefaults = { posterLayout: layout }
      expect(resolve("layout=bogus", { mapping: m, sd })).toBe("standard")
      expect(renderLayout("layout=bogus", { mapping: m })).toBe("standard")
    }
  })
})

describe("cover layout cache identity", () => {
  it.each(COVER_LAYOUTS)("keeps %s and canonicalizes case", (layout) => {
    expect(normalizePosterCacheParams(new URLSearchParams(`layout=${layout}`)).get("layout")).toBe(layout)
    expect(normalizePosterCacheParams(new URLSearchParams(`layout=${layout.toUpperCase()}`)).get("layout")).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("explicit %s stays distinct from absent (override preserved)", (layout) => {
    const absent = normalizePosterCacheParams(new URLSearchParams("bs=pill"))
    const explicit = normalizePosterCacheParams(new URLSearchParams(`bs=pill&layout=${layout}`))
    expect(explicit.get("layout")).toBe(layout)
    expect(explicit.toString()).not.toBe(absent.toString())
  })

  it("each cover layout has its own cache key (cache separation)", () => {
    const keys = new Set(
      (["standard", "fresh", ...COVER_LAYOUTS] as const).map(
        (l) => normalizePosterCacheParams(new URLSearchParams(`bs=pill&layout=${l}`)).toString(),
      ),
    )
    expect(keys.size).toBe(2 + COVER_LAYOUTS.length)
  })

  it.each(COVER_LAYOUTS)("presets hardening keeps %s without dropping it", (layout) => {
    const hardened = (q: string) => hardenPosterSearchParams(new URLSearchParams(q), {
      presets: true,
      preview: false,
      anonymous: false,
      publicInstance: false,
      hasMapping: false,
    })
    expect(hardened(`layout=${layout}`).get("layout")).toBe(layout)
    expect(hardened(`layout=${layout.toUpperCase()}`).get("layout")).toBe(layout)
  })
})

describe("cover layout query schema + persistence", () => {
  it.each(COVER_LAYOUTS)("query schema accepts %s within bounds", (layout) => {
    expect(posterQuerySchema.safeParse({ layout }).success).toBe(true)
  })

  it.each(COVER_LAYOUTS)("mapping schema accepts flat and landscape %s", (layout) => {
    const base = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }
    expect(mappingSchema.safeParse({ ...base, posterLayout: layout }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, landscape: { posterLayout: layout } }).success).toBe(true)
  })

  it.each(COVER_LAYOUTS)("config token accepts and round-trips %s", (layout) => {
    expect(configTokenSchema.safeParse({ ...TOKEN_BASE, posterLayout: layout }).success).toBe(true)
    const token = encodeConfig({ ...TOKEN_BASE, posterLayout: layout })
    expect(decodeConfig(token)?.posterLayout).toBe(layout)
  })
})

describe("cover layout preview + defaults preview + Stremio roundtrip", () => {
  const input = (mappingArg: Mapping | null, defaults: ServerDefaults = {}) => ({
    origin: "https://x.test",
    type: "movie" as const,
    id: 1,
    defaults,
    mapping: mappingArg,
    lang: "it",
  })

  it.each(COVER_LAYOUTS)("editor preview emits %s intact", (layout) => {
    const url = buildPreviewUrl(previewState() as never, { ...badgeParams(), posterLayout: layout } as never)
    expect(paramsOf(url).get("layout")).toBe(layout)
    // Roundtrip: the emitted param resolves back through the server chain.
    expect(resolvePosterLayout(
      paramsOf(url),
      mapping({ posterLayout: "fresh" }),
      { ...TOKEN_BASE, posterLayout: "fresh" },
      { posterLayout: "fresh" },
      "poster",
    )).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("defaults preview follows the effective %s per shape", (layout) => {
    const other = layout === "nuvio" ? "stremio" : "nuvio"
    expect(paramsOf(buildDefaultsPreviewUrl({ defaultPosterLayout: layout })).get("layout")).toBe(layout)
    const portrait = paramsOf(buildDefaultsPreviewUrl({
      defaultPosterLayout: layout,
      landscape: { posterLayout: other },
    }))
    expect(portrait.get("layout")).toBe(layout)
    const landscape = paramsOf(buildDefaultsPreviewUrl({
      defaultPosterLayout: layout,
      landscape: { posterLayout: other },
      previewShape: "landscape",
    }))
    expect(landscape.get("layout")).toBe(other)
  })

  it.each(COVER_LAYOUTS)("Stremio URL emits %s from mapping or defaults, never garbage", (layout) => {
    expect(buildStremioPosterUrl(input(mapping({ posterLayout: layout }))).searchParams.get("layout")).toBe(layout)
    expect(buildStremioPosterUrl(input(null, { posterLayout: layout })).searchParams.get("layout")).toBe(layout)
    // Per-shape independence on the Stremio path.
    const other = layout === "nuvio" ? "stremio" : "nuvio"
    const shaped = buildStremioPosterUrl(input(
      mapping({ posterLayout: layout, landscape: { posterLayout: other }, posterShape: "landscape" }),
      {},
    ))
    expect(shaped.searchParams.get("layout")).toBe(other)
  })

  it.each(COVER_LAYOUTS)("Stremio %s round-trips through the server resolver", (layout) => {
    const url = buildStremioPosterUrl(input(mapping({ posterLayout: layout })))
    expect(resolvePosterLayout(
      url.searchParams,
      mapping({ posterLayout: "fresh" }),
      { ...TOKEN_BASE, posterLayout: "fresh" },
      { posterLayout: "fresh" },
      "poster",
    )).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("Stremio %s stays explicit under compactTuning (never inside dv)", (layout) => {
    const params = buildStremioPosterSearchParams({ posterLayout: layout, compactTuning: true })
    expect(params.get("layout")).toBe(layout)
    expect(params.has("dv")).toBe(true)
  })

  it.each(COVER_LAYOUTS)("default fingerprint distinguishes %s (proxy cache separation)", (layout) => {
    expect(proxyDefaultsSignature({ posterLayout: layout })).not.toBe(proxyDefaultsSignature({}))
    expect(proxyDefaultsSignature({ posterLayout: layout })).toBe(proxyDefaultsSignature({ posterLayout: layout }))
  })
})
