import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  NEUTRAL_SAMPLE_RATING,
  isNeutralSampleRequest,
  neutralSampleRatings,
} from "@/lib/demo-samples"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { neutralSampleBase, neutralSampleLogo } from "@/lib/neutral-sample-assets"

describe("neutral style sample", () => {
  it("is accepted only on top of accepted demo samples with the exact value", () => {
    expect(isNeutralSampleRequest({ demoSamples: true, flag: "neutral" })).toBe(true)
    expect(isNeutralSampleRequest({ demoSamples: false, flag: "neutral" })).toBe(false)
    expect(isNeutralSampleRequest({ demoSamples: true, flag: "x" })).toBe(false)
    expect(isNeutralSampleRequest({ demoSamples: true, flag: null })).toBe(false)
  })

  it("rates every requested source at the fixed value", () => {
    const sampled = neutralSampleRatings(["imdb", " TMDB ", "letterboxd", ""])
    expect(sampled.sources).toEqual({ imdb: NEUTRAL_SAMPLE_RATING, tmdb: NEUTRAL_SAMPLE_RATING, letterboxd: NEUTRAL_SAMPLE_RATING })
    expect(sampled.average).toBe(8)
    expect(sampled.count).toBe(3)
    expect(neutralSampleRatings([])).toEqual({ sources: {}, average: 0, count: 0 })
  })

  it("the preview builder emits the flag only when asked", () => {
    const base = { tmdbKey: "", userId: null, lang: "it" } as unknown as Parameters<typeof buildDefaultsPreviewUrl>[0]
    expect(buildDefaultsPreviewUrl({ ...base, neutralSample: true })).toContain("sample=neutral")
    expect(buildDefaultsPreviewUrl(base)).not.toContain("sample=")
  })

  it("garbage values never split the cache key", () => {
    const keep = normalizePosterCacheParams(new URLSearchParams("sample=neutral"))
    const drop = normalizePosterCacheParams(new URLSearchParams("sample=evil"))
    expect(keep.get("sample")).toBe("neutral")
    expect(drop.has("sample")).toBe(false)
  })

  it("bundled artwork renders with the expected shapes", async () => {
    const [portrait, landscape, logo] = await Promise.all([neutralSampleBase(false), neutralSampleBase(true), neutralSampleLogo()])
    const [p, l, g] = await Promise.all([sharp(portrait).metadata(), sharp(landscape).metadata(), sharp(logo).metadata()])
    expect([p.width, p.height]).toEqual([1000, 1500])
    expect([l.width, l.height]).toEqual([1920, 1080])
    expect(g.width).toBeGreaterThan(g.height ?? 0)
    // Memoized: same bytes on the next call (no re-render per request).
    expect(await neutralSampleBase(false)).toBe(portrait)
  })
})
