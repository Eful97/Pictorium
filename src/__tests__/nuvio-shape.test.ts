import { describe, it, expect } from "vitest"
import { buildUrlPattern } from "@/lib/poster-url"
import { resolvePosterShape } from "@/lib/poster-config"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"

const baseBadgeParams = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow" as const,
  rankingBadgeStyle: "default" as const,
  customBadge: null,
  gradientHeight: 30,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  blurEnabled: true,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  networkLogoScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeOffsetX: 0,
  qualityBadgeOffsetY: 0,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
}

function shapeQuery(raw: string): URLSearchParams {
  return new URLSearchParams(raw)
}

describe("Nuvio shape={shape} template", () => {
  it("emits a single literal shape={shape} without encoding", () => {
    const url = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it", shapePlaceholder: "{shape}" })
    expect(url).toContain("shape={shape}")
    expect(url).not.toContain("%7Bshape%7D")
    expect(url).not.toContain("%7bshape%7d")
    expect(url.match(/shape=/g)?.length).toBe(1)
  })

  it("replaces a fixed landscape shape instead of duplicating it", () => {
    const url = buildUrlPattern({
      ...baseBadgeParams,
      tmdbKey: "k",
      lang: "it",
      posterShape: "landscape",
      shapePlaceholder: "{shape}",
    })
    expect(url).toContain("shape={shape}")
    expect(url).not.toContain("shape=landscape")
    expect(url.match(/shape=/g)?.length).toBe(1)
  })

  it("preserves the ID placeholders and the other params", () => {
    for (const idPlaceholder of ["{tmdb_id}", "{imdb_id}", "{tmdb_id|imdb_id}"] as const) {
      const url = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it", idPlaceholder, shapePlaceholder: "{shape}" })
      expect(url).toContain(`/api/poster/{type}/${idPlaceholder}`)
      expect(url).toContain("shape={shape}")
      expect(url).toContain("lang=it")
    }
  })

  it("keeps traditional templates unchanged (no shape param by default)", () => {
    const portrait = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it" })
    expect(portrait).not.toContain("shape=")
    expect(portrait).not.toContain("{shape}")
    const landscape = buildUrlPattern({ ...baseBadgeParams, tmdbKey: "k", lang: "it", posterShape: "landscape" })
    expect(landscape).toContain("shape=landscape")
    expect(landscape).not.toContain("{shape}")
  })
})

describe("resolvePosterShape with Nuvio values", () => {
  const landscapeMapping = { posterShape: "landscape" } as never
  const portraitMapping = { posterShape: "poster" } as never
  const emptySd = {} as never

  it("query poster wins over a landscape mapping", () => {
    expect(resolvePosterShape(shapeQuery("shape=poster"), landscapeMapping, null, emptySd)).toBe("poster")
  })

  it("query landscape wins over a portrait mapping", () => {
    expect(resolvePosterShape(shapeQuery("shape=landscape"), portraitMapping, null, emptySd)).toBe("landscape")
  })

  it("square falls back explicitly to portrait", () => {
    expect(resolvePosterShape(shapeQuery("shape=square"), landscapeMapping, null, emptySd)).toBe("poster")
    expect(resolvePosterShape(shapeQuery("shape=SQUARE"), null, null, emptySd)).toBe("poster")
  })

  it("unsubstituted placeholder follows the ordinary fallback", () => {
    // Mapping landscape → landscape, altrimenti default portrait.
    expect(resolvePosterShape(shapeQuery("shape={shape}"), landscapeMapping, null, emptySd)).toBe("landscape")
    expect(resolvePosterShape(shapeQuery("shape={shape}"), null, null, emptySd)).toBe("poster")
    // Encoded form (client che non decodifica): stesso fallback, mai errore.
    expect(resolvePosterShape(shapeQuery("shape=%7Bshape%7D"), landscapeMapping, null, emptySd)).toBe("landscape")
    expect(resolvePosterShape(shapeQuery("shape=%7Bshape%7D"), null, null, emptySd)).toBe("poster")
  })
})

describe("poster cache separates resolved shapes", () => {
  function keyFor(raw: string): string {
    return normalizePosterCacheParams(shapeQuery(raw)).toString()
  }

  it("portrait and landscape have distinct keys", () => {
    expect(keyFor("shape=poster&lang=it")).not.toBe(keyFor("shape=landscape&lang=it"))
  })

  it("unsubstituted placeholder has its own key (no portrait/landscape reuse)", () => {
    const placeholder = keyFor("shape={shape}&lang=it")
    expect(placeholder).not.toBe(keyFor("shape=poster&lang=it"))
    expect(placeholder).not.toBe(keyFor("shape=landscape&lang=it"))
  })
})
