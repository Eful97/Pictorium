/**
 * Spostamento (group anchors): a pinned family lands on its zone from its
 * REAL box, so a wide and a narrow quality group share the same centre.
 */
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { STD_W, STD_H } from "@/lib/poster-render-helpers"
import type { ServerDefaults } from "@/lib/server-defaults"
import type { WikidataResult } from "@/lib/awards"
import {
  anchoredBoxPosition,
  badgeAnchorFor,
  canonicalizeBadgeItemTransforms,
  parseBadgeItemTransforms,
  serializeBadgeItemTransforms,
  withBadgeAnchor,
  withoutBadgeItemFamily,
} from "@/lib/badge-item-transforms"

describe("anchor wire form", () => {
  it("round-trips next to item corrections and drops garbage", () => {
    const map = withBadgeAnchor(parseBadgeItemTransforms("quality:tier=100,5,0"), "quality", "bc")
    const wire = serializeBadgeItemTransforms(map)
    expect(wire).toBe("anchor:quality=bc;quality:tier=100,5,0")
    expect(badgeAnchorFor(parseBadgeItemTransforms(wire), "quality")).toBe("bc")
    expect(canonicalizeBadgeItemTransforms("anchor:quality=zz;anchor:nope=bc")).toBeNull()
    expect(canonicalizeBadgeItemTransforms(wire, { quantize: true })).toBe(wire)
    expect(badgeAnchorFor(withoutBadgeItemFamily(map, "quality"), "quality")).toBeNull()
  })

  it("centres any width on the same axis", () => {
    for (const w of [40, 120, 300]) {
      const { left } = anchoredBoxPosition("bc", w, 30, 380, 570)
      expect(left + w / 2).toBeCloseTo(190, 0)
    }
    expect(anchoredBoxPosition("tr", 100, 30, 380, 570)).toEqual({ left: 380 - 18 - 100, top: 18 })
  })
})

function input(overrides: Partial<GenerationInput>): GenerationInput {
  return {
    posterBuf: Buffer.alloc(0), logoFetch: null, backdropFetch: null,
    backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
    blurEnabled: false, blurHeight: 50, blurIntensity: 10, blurFade: 10, blurDarkness: 0,
    badgesEnabled: true, rankingEnabled: false, genreName: null, voteAverage: null,
    badgeStyle: "shadow", rankingBadgeStyle: "default",
    badgeGenre: false, badgeYear: false, badgeRating: false, badgeQuality: true,
    quality: "4K", qualityBadgeStyle: "standard", videoFormats: [],
    separateRatings: [], topLight: false, targetCenter: 0, ribbonSide: "left",
    logoScale: null, logoOffsetX: null, logoOffsetY: null,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
    genreBadgeScale: 100, qualityBadgeScale: 100, separateBadgeScale: 100, networkLogoScale: 100,
    genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0, networkLogoOffsetY: 0,
    mediaType: "movie", finalRank: null, animeRankResult: null, rankingResult: null, mapping: null,
    tmdbNetworks: [], productionCompanies: [], tmdbStudios: [], tvType: null, tvStatus: null,
    releaseDate: null, firstAirDate: null, lastAirDate: null, seasonCount: null, originCountries: [],
    wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
    tmdbKeywords: [], locale: "it", t: (k: string) => k, qLabel: null, queryExtra: null,
    qNetLogo: null, networkLogo: false, sd: {} satisfies ServerDefaults, accentOverride: null,
    imdbTop250: false, preRelease: false,
    ...overrides,
  }
}

describe("anchored quality group in the real render", () => {
  it("a narrow and a wide group share the bottom-centre axis", async () => {
    const posterBuf = await sharp({ create: { width: STD_W, height: STD_H, channels: 3, background: "#101010" } }).jpeg().toBuffer()
    const anchors = parseBadgeItemTransforms("anchor:quality=bc")
    const boxes: Array<{ left: number; top: number; w: number; h: number }> = []
    for (const videoFormats of [[], ["dv", "atmos", "hdr"]]) {
      await generatePosterBuffer(input({
        posterBuf, videoFormats, badgeItemTransforms: anchors,
        onBadgeGeometry: (geo) => { if (geo.families.quality) boxes.push(geo.families.quality) },
      }))
    }
    expect(boxes).toHaveLength(2)
    for (const box of boxes) {
      expect(box.left + box.w / 2).toBeCloseTo(STD_W / 2, -0.5)
      expect(box.top + box.h).toBe(STD_H - Math.round((18 * STD_H) / 570))
    }
  })
})
