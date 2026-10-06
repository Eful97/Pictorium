import { describe, expect, it } from "vitest"
import {
  DEMOSAMPLES_FLAG,
  DEMO_SAMPLE_QUALITY,
  DEMO_SAMPLE_RANK,
  isDemoSamplesRequest,
  mergeDemoSampleRatings,
  sampleAggregatedRatings,
} from "@/lib/demo-samples"
import { buildDefaultsPreviewUrl, buildPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening"

describe("isDemoSamplesRequest", () => {
  it("accepts only an effective preview with the exact flag", () => {
    expect(isDemoSamplesRequest({ isPreview: true, flag: "1" })).toBe(true)
    expect(isDemoSamplesRequest({ isPreview: false, flag: "1" })).toBe(false)
    expect(isDemoSamplesRequest({ isPreview: true, flag: null })).toBe(false)
    expect(isDemoSamplesRequest({ isPreview: true, flag: undefined })).toBe(false)
    expect(isDemoSamplesRequest({ isPreview: true, flag: "0" })).toBe(false)
    expect(isDemoSamplesRequest({ isPreview: true, flag: "true" })).toBe(false)
    expect(isDemoSamplesRequest({ isPreview: true, flag: "" })).toBe(false)
  })
})

describe("sampleAggregatedRatings", () => {
  it("fills only the requested sources on the /10 scale with the imdb+tmdb average rule", () => {
    const r = sampleAggregatedRatings(["imdb", "tmdb"])
    expect(Object.keys(r.sources).sort()).toEqual(["imdb", "tmdb"])
    expect(r.sources.imdb).toBe(8.2)
    expect(r.sources.tmdb).toBe(7.6)
    expect(r.average).toBeCloseTo(7.9, 5)
    expect(r.count).toBe(2)
  })

  it("covers percent-family and single-source selections deterministically", () => {
    const pct = sampleAggregatedRatings(["tomatoes"])
    expect(pct.sources).toEqual({ tomatoes: 8.8 })
    expect(pct.average).toBe(8.8)
    const single = sampleAggregatedRatings(["trakt"])
    expect(single.sources).toEqual({ trakt: 8.0 })
    expect(single.count).toBe(1)
  })

  it("dedups, lowercases and falls back for uncurated sources", () => {
    const r = sampleAggregatedRatings(["IMDb", " imdb ", "unknownsrc"])
    expect(r.sources.imdb).toBe(8.2)
    expect(r.sources.unknownsrc).toBe(7.5)
    expect(r.count).toBe(2)
  })

  it("returns an empty set for no sources", () => {
    expect(sampleAggregatedRatings([])).toEqual({ sources: {}, average: 0, count: 0 })
  })

  it("exposes the known small dataset constants", () => {
    expect(DEMO_SAMPLE_RANK).toBe(11)
    expect(DEMO_SAMPLE_QUALITY).toBe("4K")
  })
})

describe("mergeDemoSampleRatings", () => {
  it("fills a wholly missing aggregate with the requested sources", () => {
    const r = mergeDemoSampleRatings(null, ["imdb", "tmdb"])
    expect(r?.sources).toEqual({ imdb: 8.2, tmdb: 7.6 })
    expect(r?.average).toBeCloseTo(7.9, 5)
    expect(r?.count).toBe(2)
  })

  it("keeps real scores and fills only the missing requested sources", () => {
    const real = { sources: { imdb: 9.0 }, average: 9.0, count: 1 }
    const r = mergeDemoSampleRatings(real, ["imdb", "tmdb"])
    expect(r?.sources.imdb).toBe(9.0)
    expect(r?.sources.tmdb).toBe(7.6)
    // Average mirrors the fetch rule (imdb+tmdb): (9.0 + 7.6) / 2.
    expect(r?.average).toBeCloseTo(8.3, 5)
    expect(r?.count).toBe(2)
  })

  it("returns the aggregate untouched when nothing is missing", () => {
    const real = { sources: { imdb: 9.0, tmdb: 8.0 }, average: 8.5, count: 2 }
    expect(mergeDemoSampleRatings(real, ["imdb", "tmdb"])).toEqual(real)
  })

  it("returns null when nothing is renderable", () => {
    expect(mergeDemoSampleRatings(null, [])).toBeNull()
    expect(mergeDemoSampleRatings({ sources: {}, average: 0, count: 0 }, [])).toBeNull()
  })
})

describe("demosamples flag contract", () => {
  it("is emitted only by the Settings defaults preview builder", () => {
    const url = new URL(buildDefaultsPreviewUrl({}), "http://localhost")
    expect(url.searchParams.get(DEMOSAMPLES_FLAG)).toBe("1")
    expect(url.searchParams.get("preview")).toBe("1")
  })

  it("is absent from the editor preview and Stremio poster URLs", () => {
    const editor = buildPreviewUrl(
      {
        selected: { id: 1, media_type: "movie", title: "T", poster_path: null },
        previewPoster: null, selectedLogo: null, selectedBackdrop: null,
        logoScale: 0, logoOffsetX: 0, logoOffsetY: 0,
        backdropScale: 0, backdropOffsetX: 0, backdropOffsetY: 0,
        metaInfo: { genres: [], voteAverage: 0 },
        trendRank: null, mdblistAnimeList: [],
        topEdgeColor: null, lang: "it", tmdbKey: "",
      } as never,
      {
        globalBadges: true, rankingBadges: true, badgeStyle: "shadow", rankingBadgeStyle: "default",
        gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
        topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
        genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0,
        qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
        networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
        customBadge: null,
      } as never,
    )
    expect(editor).not.toContain(DEMOSAMPLES_FLAG)
    const stremio = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, defaults: {}, mapping: null, lang: "it",
    })
    expect(stremio.searchParams.get(DEMOSAMPLES_FLAG)).toBeNull()
    expect(stremio.toString()).not.toContain(DEMOSAMPLES_FLAG)
  })
})

describe("demosamples cache handling", () => {
  it("keeps the exact flag in the cache key and drops garbage or junk", () => {
    const kept = normalizePosterCacheParams(new URLSearchParams("preview=1&demosamples=1&bs=shadow"))
    expect(kept.get("demosamples")).toBe("1")
    const garbage = normalizePosterCacheParams(new URLSearchParams("preview=1&demosamples=yes"))
    expect(garbage.get("demosamples")).toBeNull()
    const empty = normalizePosterCacheParams(new URLSearchParams("preview=1&demosamples="))
    expect(empty.get("demosamples")).toBeNull()
    // Sampled and genuine renders keep distinct keys (no cross-reads).
    expect(kept.toString()).not.toBe(
      normalizePosterCacheParams(new URLSearchParams("preview=1&bs=shadow")).toString(),
    )
  })

  it("passes previews through hardening untouched, flag included", () => {
    const out = hardenPosterSearchParams(new URLSearchParams("preview=1&demosamples=1&bs=shadow"), {
      presets: true, preview: true, anonymous: true, publicInstance: true, hasMapping: false,
    })
    expect(out.get("demosamples")).toBe("1")
  })
})
