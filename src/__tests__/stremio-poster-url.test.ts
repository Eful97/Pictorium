import { describe, expect, it } from "vitest"
import { buildStremioPosterUrl, mappingVersionParam } from "@/lib/stremio-poster-url"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import type { Mapping } from "@/lib/types"

function mapping(updatedAt: string): Mapping {
  return {
    tmdbId: 42,
    mediaType: "movie",
    title: "Test",
    posterPath: "/poster.jpg",
    logoPath: "/logo.png",
    originalPosterPath: null,
    language: null,
    updatedAt,
  }
}

// Risolve la config come il server (stessa catena query > mapping > config >
// defaults): gli URL compatti omettono il tuning, il render deve coincidere.
function resolveConfig(url: URL, mapping: Mapping | null) {
  return resolvePosterRenderConfig({
    searchParams: url.searchParams,
    mapping,
    configOverride: null,
    sd: {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    lang: "it",
  })
}

describe("buildStremioPosterUrl", () => {  it("adds a mapping version parameter when a saved mapping exists", () => {
    const updatedAt = "2026-07-16T10:15:30.000Z"
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: { badgeStyle: "bar" },
      mapping: mapping(updatedAt),
    })

    expect(url.pathname).toBe("/api/poster/movie/42")
    expect(url.searchParams.get("rv")).toBe(String(POSTER_URL_VERSION))
    expect(url.searchParams.get("mv")).toBe(String(Date.parse(updatedAt)))
    expect(url.searchParams.get("bs")).toBe("bar")
    // Mai segreti nei poster serviti (M2): niente api_key/mdblist_key.
    expect(url.searchParams.has("api_key")).toBe(false)
    expect(url.searchParams.has("mdblist_key")).toBe(false)
  })

  it("emits the mapping title for JustWatch matching", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 42,
      defaults: {},
      mapping: mapping("2026-07-16T10:15:30.000Z"),
    })

    expect(url.searchParams.get("title")).toBe("Test")
  })

  it("omits title without a saved mapping", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "series",
      id: 94997,
      defaults: {},
      mapping: null,
    })

    expect(url.searchParams.has("title")).toBe(false)
  })

  it("omits mapping version for unsaved titles", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "series",
      id: 94997,
      defaults: {},
      mapping: null,
    })

    expect(url.pathname).toBe("/api/poster/series/94997")
    expect(url.searchParams.get("rv")).toBe(String(POSTER_URL_VERSION))
    expect(url.searchParams.has("mv")).toBe(false)
  })

  it("forwards badge subcomponents and ribbonSide from mapping and defaults", () => {
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 123,
      defaults: {
        badgeGenre: true,
        badgeYear: false,
        badgeRating: true,
        badgeQuality: false,
        ratingSources: ["tmdb", "imdb"],
        ribbonSide: "right",
      },
      mapping: {
        ...mapping("2026-07-16T10:15:30.000Z"),
        badgeGenre: false,
        ribbonSide: "left",
      },
    })

    expect(url.searchParams.get("bg")).toBe("0") // mapping wins
    expect(url.searchParams.get("by")).toBe("0") // defaults
    expect(url.searchParams.has("br")).toBe(false) // badgeRating is true
    expect(url.searchParams.get("bq")).toBe("0") // defaults
    expect(url.searchParams.get("rsrc")).toBe("tmdb,imdb")
    expect(url.searchParams.get("side")).toBe("right") // solo globale: mapping ignorato
  })

  it("emits per-title ratingSources from the mapping, falling back to defaults", () => {
    const perTitle = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 123,
      defaults: { ratingSources: ["tmdb", "imdb"] },
      mapping: { ...mapping("2026-07-16T10:15:30.000Z"), ratingSources: ["imdb"] },
    })
    expect(perTitle.searchParams.get("rsrc")).toBe("imdb")

    const fallback = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie",
      id: 123,
      defaults: { ratingSources: ["tmdb", "imdb"] },
      mapping: mapping("2026-07-16T10:15:30.000Z"),
    })
    expect(fallback.searchParams.get("rsrc")).toBe("tmdb,imdb")
  })

  it("ignores invalid mapping timestamps", () => {
    expect(mappingVersionParam(mapping("not-a-date"))).toBeNull()
  })

  it("forceShape renders a landscape URL regardless of mapping/defaults", () => {
    // Banner Nuvio: stesso rendering in canvas landscape anche per titoli
    // portrait, con profilo landscape del mapping quando presente.
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: { ...mapping("2026-07-16T10:15:30.000Z"), posterShape: "poster" as const },
    }
    const plain = buildStremioPosterUrl(base)
    expect(plain.searchParams.has("shape")).toBe(false)

    const forced = buildStremioPosterUrl({ ...base, forceShape: "landscape" })
    expect(forced.searchParams.get("shape")).toBe("landscape")
    expect(forced.searchParams.get("mv")).toBe(plain.searchParams.get("mv"))
    expect(forced.searchParams.get("title")).toBe("Test")
  })

  it("forceShape applies the mapping landscape tuning profile (resolved server-side, compact URLs v1.23.0)", () => {
    const styled = {
      ...mapping("2026-07-16T10:15:30.000Z"),
      posterShape: "poster" as const,
      gradientHeight: 50,
      landscape: { gradientHeight: 15 },
    }
    const url = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: { gradientHeight: 30 },
      mapping: styled,
    })
    // Tuning omesso dall'URL: il titolo portrait risolve il profilo flat...
    expect(url.searchParams.has("gradHeight")).toBe(false)
    expect(resolveConfig(url, styled).blurHeight).toBe(50)

    const forced = buildStremioPosterUrl({
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: { gradientHeight: 30 },
      mapping: styled,
      forceShape: "landscape",
    })
    // ...con force il banner risolve il profilo landscape.
    expect(forced.searchParams.has("gradHeight")).toBe(false)
    expect(forced.searchParams.get("shape")).toBe("landscape")
    expect(resolveConfig(forced, styled).blurHeight).toBe(15)
  })

  it("emits hideLogo only for the Nuvio banner (never for poster)", () => {
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: mapping("2026-07-16T10:15:30.000Z"),
    }
    const poster = buildStremioPosterUrl(base)
    expect(poster.searchParams.has("hideLogo")).toBe(false)

    const banner = buildStremioPosterUrl({ ...base, forceShape: "landscape", hideLogo: true })
    expect(banner.searchParams.get("hideLogo")).toBe("1")
    expect(banner.searchParams.get("shape")).toBe("landscape")
  })

  it("passes per-title tintStrength to the banner, defaults to 20 (resolved server-side, compact URLs v1.23.0)", () => {
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: { ...mapping("2026-07-16T10:15:30.000Z"), tintStrength: 55 },
    }
    const tinted = buildStremioPosterUrl(base)
    expect(tinted.searchParams.has("tint")).toBe(false)
    expect(resolveConfig(tinted, base.mapping).tintStrength).toBe(55)
    const plain = buildStremioPosterUrl({ ...base, mapping: null })
    expect(plain.searchParams.has("tint")).toBe(false)
    expect(resolveConfig(plain, null).tintStrength).toBe(20)
  })

  it("defaults blurFade to 70 in landscape, 60 in portrait (resolved server-side, compact URLs v1.23.0)", () => {
    const base = {
      origin: "http://localhost:3000",
      type: "movie" as const,
      id: 42,
      defaults: {},
      mapping: null,
    }
    const portrait = buildStremioPosterUrl(base)
    expect(portrait.searchParams.has("bf")).toBe(false)
    expect(resolveConfig(portrait, null).blurFade).toBe(50)
    const landscape = buildStremioPosterUrl({ ...base, forceShape: "landscape" })
    expect(landscape.searchParams.has("bf")).toBe(false)
    expect(resolveConfig(landscape, null).blurFade).toBe(70)
    // Mapping esplicito vince sul default di formato.
    const styled = { ...mapping("2026-07-16T10:15:30.000Z"), blurFade: 40 }
    const banner = buildStremioPosterUrl({ ...base, forceShape: "landscape", mapping: styled })
    expect(banner.searchParams.has("bf")).toBe(false)
    expect(resolveConfig(banner, styled).blurFade).toBe(40)
  })
})
