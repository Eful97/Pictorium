/**
 * "Dove guardare" params: `wp` (switch) + `wpr` (paese).
 * Chain: query > server defaults > off / posterRegion. Emitted only when ON
 * (legacy URLs byte-identical), region validated against REGIONS everywhere.
 */
import { describe, it, expect } from "vitest"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { normalizePosterCacheParams, } from "@/lib/poster-runtime-cache"
import { POSTER_CACHE_ALLOWLIST } from "@/lib/poster-params-hardening"
import { sanitizeWatchRegion } from "@/lib/regions"

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: false,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

describe("sanitizeWatchRegion", () => {
  it("accepts only REGIONS codes, uppercased; garbage and GLOBAL → null", () => {
    expect(sanitizeWatchRegion("IT")).toBe("IT")
    expect(sanitizeWatchRegion("us")).toBe("US")
    for (const bad of ["../", "ITA", "", null, undefined, "global", "ZZ", "__proto__"]) {
      expect(sanitizeWatchRegion(bad as string | null | undefined)).toBeNull()
    }
  })
})

describe("poster-config chain", () => {
  it("defaults to OFF / no region", () => {
    const cfg = resolvePosterRenderConfig(baseInput())
    expect(cfg.watchProviders).toBe(false)
    expect(cfg.watchRegion).toBeNull()
  })

  it("server defaults apply, query wins over them", () => {
    const sd = { watchProviders: true, watchRegion: "FR" }
    const fromSd = resolvePosterRenderConfig(baseInput({ sd }))
    expect(fromSd.watchProviders).toBe(true)
    expect(fromSd.watchRegion).toBe("FR")
    const q = resolvePosterRenderConfig(
      baseInput({ sd, searchParams: new URLSearchParams("wp=0&wpr=US") }),
    )
    expect(q.watchProviders).toBe(false)
    expect(q.watchRegion).toBe("US")
  })

  it("invalid wpr is ignored and falls through the chain", () => {
    const cfg = resolvePosterRenderConfig(
      baseInput({ sd: { watchRegion: "DE" }, searchParams: new URLSearchParams("wp=1&wpr=../etc") }),
    )
    expect(cfg.watchProviders).toBe(true)
    expect(cfg.watchRegion).toBe("DE")
  })
})

describe("URL emission", () => {
  it("stremio: absent when OFF, wp=1 + wpr only when ON", () => {
    const off = buildStremioPosterSearchParams({ lang: "it" })
    expect(off.has("wp")).toBe(false)
    expect(off.has("wpr")).toBe(false)
    const on = buildStremioPosterSearchParams({ lang: "it", watchProviders: true, watchRegion: "US" })
    expect(on.get("wp")).toBe("1")
    expect(on.get("wpr")).toBe("US")
    const bad = buildStremioPosterSearchParams({ lang: "it", watchProviders: true, watchRegion: "../" })
    expect(bad.get("wp")).toBe("1")
    expect(bad.has("wpr")).toBe(false)
  })

  it("defaults preview: explicit wp (0/1) when staged, wpr only for a valid region", () => {
    const u = new URL(buildDefaultsPreviewUrl({ defaultWatchProviders: false }), "http://x")
    expect(u.searchParams.get("wp")).toBe("0")
    const v = new URL(
      buildDefaultsPreviewUrl({ defaultWatchProviders: true, defaultWatchRegion: "GB" }),
      "http://x",
    )
    expect(v.searchParams.get("wp")).toBe("1")
    expect(v.searchParams.get("wpr")).toBe("GB")
    const legacy = new URL(buildDefaultsPreviewUrl({}), "http://x")
    expect(legacy.searchParams.has("wp")).toBe(false)
  })
})

describe("cache key", () => {
  it("allowlists wp/wpr and canonicalizes them", () => {
    expect(POSTER_CACHE_ALLOWLIST.has("wp")).toBe(true)
    expect(POSTER_CACHE_ALLOWLIST.has("wpr")).toBe(true)
    const a = normalizePosterCacheParams(new URLSearchParams("wp=yes&wpr=it"))
    expect(a.get("wp")).toBe("1")
    expect(a.get("wpr")).toBe("IT")
    const b = normalizePosterCacheParams(new URLSearchParams("wp=1&wpr=%24RANDOM"))
    expect(b.has("wpr")).toBe(false)
  })
})
