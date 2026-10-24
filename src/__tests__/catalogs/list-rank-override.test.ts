// List-rank override (decisione A): `rk` 0..100 explicit list context beats
// live trend/anime; explicit `rank=` beats `rk`; invalid = absent (legacy).
// Covers: strict parse, final-rank precedence, cache-key distinction,
// preview emission + saved-rank-key suppression, client carry-through.
import { describe, expect, it, vi } from "vitest"

// The global setup mocks @/lib/i18n with isRankKey => null: opt out so the
// real rank-key resolution applies (same pattern as i18n-a11y tests).
vi.unmock("@/lib/i18n")

import { parseListRankParam, resolveFinalRankWithListContext } from "@/lib/poster-params-hardening"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { buildPreviewUrl } from "@/lib/poster-url"
import { browseItemToSimkl } from "@/lib/streaming-catalog-client"
import { toSearchResult } from "@/lib/types"

function psBase(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selected: { id: 7, media_type: "series", title: "Lupin", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: "en", vote_average: 7, width: 500, height: 750 },
    selectedLogo: null,
    selectedBackdrop: null,
    logoScale: 75,
    logoScaleIsAuto: true,
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
    region: "IT",
    dateFormat: "locale",
    userId: null,
    ...over,
  }
}

function bpBase(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    extraBadgeStyle: null,
    badgeFont: "inter",
    qualityBadgeStyle: "standard",
    videoFormats: null,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    badgeQuality: false,
    customRatings: false,
    ratingSources: [],
    separateRatings: false,
    separateRatingsStyle: "column",
    posterLayout: "standard",
    posterFreshScope: "ranked",
    customBadge: null,
    gradientHeight: 30,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    blurEnabled: true,
    tintStrength: 20,
    topShade: 50,
    topShadeHeight: 25,
    networkLogo: false,
    networkLogoPosition: "auto",
    preRelease: false,
    ribbonSide: "left",
    ribbonEnabled: true,
    posterShape: "poster",
    logoAlign: "center",
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    networkLogoScale: 100,
    separateBadgeScale: 130,
    separateBadgeOffsetX: 0,
    separateBadgeOffsetY: 0,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    ...over,
  }
}

describe("list-rank override (rk)", () => {
  it("parseListRankParam bounds: 0..100 int valid, else absent", () => {
    expect(parseListRankParam("1")).toBe(1)
    expect(parseListRankParam("12")).toBe(12)
    expect(parseListRankParam("0")).toBe(0)
    expect(parseListRankParam(null)).toBeNull()
    expect(parseListRankParam("")).toBeNull()
    expect(parseListRankParam("  ")).toBeNull()
    expect(parseListRankParam("abc")).toBeNull()
    expect(parseListRankParam("-1")).toBeNull()
    expect(parseListRankParam("101")).toBeNull()
    expect(parseListRankParam("1.5")).toBeNull()
  })

  it("final-rank precedence: explicit rank > rk > live; rk=0 suppresses", () => {
    expect(resolveFinalRankWithListContext("12", "1", null)).toBe(12)
    expect(resolveFinalRankWithListContext(null, "1", 12)).toBe(1)
    expect(resolveFinalRankWithListContext(null, "0", 12)).toBe(0)
    expect(resolveFinalRankWithListContext(null, null, 12)).toBe(12)
    expect(resolveFinalRankWithListContext(null, "bogus", 12)).toBe(12)
    expect(resolveFinalRankWithListContext(null, null, null)).toBeNull()
    expect(resolveFinalRankWithListContext("bogus", "3", 12)).toBe(3)
  })

  it("cache keys: same title rank N vs M distinct, invalid collapses", () => {
    const k1 = normalizePosterCacheParams(new URLSearchParams("rk=1&shape=poster")).toString()
    const k12 = normalizePosterCacheParams(new URLSearchParams("rk=12&shape=poster")).toString()
    expect(k1).not.toBe(k12)
    expect(k1).toContain("rk=1")
    expect(k12).toContain("rk=12")
    expect(normalizePosterCacheParams(new URLSearchParams("rk=abc")).has("rk")).toBe(false)
    expect(normalizePosterCacheParams(new URLSearchParams("rk=101")).has("rk")).toBe(false)
    expect(normalizePosterCacheParams(new URLSearchParams("rk=")).has("rk")).toBe(false)
    expect(normalizePosterCacheParams(new URLSearchParams("rk=0")).get("rk")).toBe("0")
  })

  it("preview emits rk + selection region; ranking OFF emits no rk", () => {
    const url = new URL(buildPreviewUrl(psBase({ listRank: 1, listRegion: "US" }) as never, bpBase() as never))
    expect(url.searchParams.get("rk")).toBe("1")
    expect(url.searchParams.get("region")).toBe("US")
    const off = new URL(buildPreviewUrl(psBase({ listRank: 1, listRegion: "US" }) as never, bpBase({ rankingBadges: false }) as never))
    expect(off.searchParams.has("rk")).toBe(false)
    const legacy = new URL(buildPreviewUrl(psBase() as never, bpBase() as never))
    expect(legacy.searchParams.has("rk")).toBe(false)
    expect(legacy.searchParams.get("region")).toBe("IT")
  })

  it("saved rank-key + live general 12 + listRank 1: preview rk=1, no rank=/animerank (matches Stremio)", () => {
    const url = new URL(
      buildPreviewUrl(
        psBase({
          listRank: 1,
          listRegion: "IT",
          trendRank: 12,
          mdblistAnimeList: [{ id: 7, rank: 4 } as never],
        }) as never,
        bpBase({ customBadge: "__badge.today" }) as never,
      ),
    )
    expect(url.searchParams.get("rk")).toBe("1")
    expect(url.searchParams.has("rank")).toBe(false)
    expect(url.searchParams.has("animerank")).toBe(false)
    // Without list context the same editor state emits the auto rank (legacy).
    const noCtx = new URL(
      buildPreviewUrl(
        psBase({ trendRank: 12, mdblistAnimeList: [{ id: 7, rank: 4 } as never] }) as never,
        bpBase({ customBadge: "__badge.today" }) as never,
      ),
    )
    expect(noCtx.searchParams.get("rank")).toBe("12")
  })

  it("manual non-rank extra badge is preserved with list context", () => {
    const url = new URL(
      buildPreviewUrl(psBase({ listRank: 3 }) as never, bpBase({ customBadge: "Cult" }) as never),
    )
    expect(url.searchParams.get("rk")).toBe("3")
    expect(url.searchParams.get("extra")).toBe("Cult")
  })

  it("client carry-through preserves rank and region", () => {
    const simkl = browseItemToSimkl({
      tmdbId: 9001,
      mediaType: "tv",
      title: "Lupin",
      rank: 1,
      posterPath: "/p.jpg",
      year: 2024,
    })
    expect(simkl.rank).toBe(1)
    const sr = toSearchResult({
      id: 9001,
      media_type: "tv",
      title: "Lupin",
      poster_path: "/p.jpg",
      listRank: simkl.rank,
      listRegion: "IT",
    })
    expect(sr.listRank).toBe(1)
    expect(sr.listRegion).toBe("IT")
  })
})
