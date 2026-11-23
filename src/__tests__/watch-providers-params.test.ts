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

describe("per-shape toggle + max", () => {
  const land = (sd: Record<string, unknown>, extra = "") =>
    resolvePosterRenderConfig(baseInput({ sd, searchParams: new URLSearchParams(`shape=landscape${extra}`) }))

  it("landscape has its own default; portrait unaffected", () => {
    const sd = { watchProviders: false, watchProvidersLandscape: true }
    expect(land(sd).watchProviders).toBe(true)
    expect(resolvePosterRenderConfig(baseInput({ sd })).watchProviders).toBe(false)
    const sd2 = { watchProviders: true, watchProvidersLandscape: false }
    expect(land(sd2).watchProviders).toBe(false)
    expect(resolvePosterRenderConfig(baseInput({ sd: sd2 })).watchProviders).toBe(true)
  })

  it("landscape falls back to the flat default when unset; query wins", () => {
    expect(land({ watchProviders: true }).watchProviders).toBe(true)
    expect(land({ watchProvidersLandscape: true }, "&wp=0").watchProviders).toBe(false)
  })

  it("wpm: query > defaults > 3, invalid ignored", () => {
    expect(resolvePosterRenderConfig(baseInput()).watchProvidersMax).toBe(3)
    expect(resolvePosterRenderConfig(baseInput({ sd: { watchProvidersMax: 5 } })).watchProvidersMax).toBe(5)
    const q = (v: string) => resolvePosterRenderConfig(baseInput({ sd: { watchProvidersMax: 2 }, searchParams: new URLSearchParams(`wpm=${v}`) })).watchProvidersMax
    expect(q("1")).toBe(1)
    expect(q("9")).toBe(2)
    expect(q("x")).toBe(2)
  })

  it("landscape profile owns max + region; portrait keeps the flats", () => {
    const sd = { watchProvidersMax: 5, watchRegion: "DE", landscape: { watchProvidersMax: 2, watchRegion: "FR" } }
    const l = land(sd)
    expect(l.watchProvidersMax).toBe(2)
    expect(l.watchRegion).toBe("FR")
    const p = resolvePosterRenderConfig(baseInput({ sd }))
    expect(p.watchProvidersMax).toBe(5)
    expect(p.watchRegion).toBe("DE")
  })

  it("landscape region \"\" = poster region, beats config token and flat; absent follows them", () => {
    const sd = { watchRegion: "DE", landscape: { watchRegion: "" } }
    expect(land(sd).watchRegion).toBeNull()
    expect(land({ watchRegion: "DE", landscape: {} }).watchRegion).toBe("DE")
    expect(land(sd, "&wpr=IT").watchRegion).toBe("IT")
  })

  it("wpm emitted only when ON and non-default; cache key collapses 3/invalid", () => {
    expect(buildStremioPosterSearchParams({ lang: "it", watchProviders: true, watchProvidersMax: 2 }).get("wpm")).toBe("2")
    expect(buildStremioPosterSearchParams({ lang: "it", watchProviders: true, watchProvidersMax: 3 }).has("wpm")).toBe(false)
    expect(buildStremioPosterSearchParams({ lang: "it", watchProvidersMax: 2 }).has("wpm")).toBe(false)
    expect(new URL(buildDefaultsPreviewUrl({ defaultWatchProviders: true, defaultWatchProvidersMax: 1 }), "http://x").searchParams.get("wpm")).toBe("1")
    expect(POSTER_CACHE_ALLOWLIST.has("wpm")).toBe(true)
    expect(normalizePosterCacheParams(new URLSearchParams("wp=1&wpm=2")).get("wpm")).toBe("2")
    expect(normalizePosterCacheParams(new URLSearchParams("wp=1&wpm=3")).has("wpm")).toBe(false)
    expect(normalizePosterCacheParams(new URLSearchParams("wp=1&wpm=99")).has("wpm")).toBe(false)
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
