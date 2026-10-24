/**
 * Space-wide automatic exclusions: `disabledContentTags` (individual tag
 * badges) + `disabledNetworks` (canonical network marks).
 *
 * RED-before/GREEN-after: filtering, sanitizers, schema/token acceptance and
 * URL emission fail until the feature is wired; historical behavior (absent
 * exclusions) must keep passing throughout.
 */
import { describe, it, expect } from "vitest"
import {
  CONTENT_TAG_IDS,
  SUBGENRE_TAG_KEYS,
  sanitizeDisabledContentTags,
  isContentTagDisabled,
} from "@/lib/content-tags"
import {
  NETWORK_IDS,
  NETWORK_DISPLAY_NAMES,
  getNetworkKey,
  sanitizeDisabledNetworks,
  isNetworkDisabled,
} from "@/lib/network-keys"
import { computeBadge, type BadgeParams } from "@/lib/badge-priority"
import { getSubGenreMatch } from "@/lib/subgenres"

const t = (k: string) => k

function baseParams(over: Partial<BadgeParams> = {}): BadgeParams {
  return {
    mediaType: "movie",
    upcomingRelease: null,
    isNewMovie: false,
    isNewSeries: false,
    animeRank: null,
    trendRank: null,
    award: null,
    nomination: null,
    studio: null,
    director: null,
    imdbTop250: false,
    extra: null,
    ...over,
  }
}

describe("content-tags registry", () => {
  it("exposes individual subgenre canonical IDs plus the family", () => {
    expect(SUBGENRE_TAG_KEYS).toHaveLength(14)
    for (const k of SUBGENRE_TAG_KEYS) {
      expect(CONTENT_TAG_IDS).toContain(`subgenre:${k}`)
    }
    expect(CONTENT_TAG_IDS).toContain("subgenre")
    expect(CONTENT_TAG_IDS).toContain("trueStory")
    expect(CONTENT_TAG_IDS).toContain("basedOnBook")
    // Rank badges stay in the existing tab: never duplicated here.
    expect(CONTENT_TAG_IDS.join(",")).not.toMatch(/animeRank|trendRank/)
  })

  it("sanitize keeps known IDs, drops unknown, dedupes, caps", () => {
    expect(sanitizeDisabledContentTags(undefined)).toEqual([])
    expect(sanitizeDisabledContentTags(null)).toEqual([])
    expect(sanitizeDisabledContentTags("trueStory")).toEqual([])
    expect(
      sanitizeDisabledContentTags(["trueStory", "bogus", "trueStory", 42, "subgenre:cyberpunk"]),
    ).toEqual(["trueStory", "subgenre:cyberpunk"])
    const many = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? "trueStory" : `nope-${i}`))
    expect(sanitizeDisabledContentTags(many)).toEqual(["trueStory"])
  })

  it("isContentTagDisabled matches family or canonical key, absent = enabled", () => {
    expect(isContentTagDisabled("trueStory", null, null)).toBe(false)
    expect(isContentTagDisabled("trueStory", null, [])).toBe(false)
    expect(isContentTagDisabled("trueStory", null, ["trueStory"])).toBe(true)
    expect(isContentTagDisabled("subgenre", "cyberpunk", ["subgenre"])).toBe(true)
    expect(isContentTagDisabled("subgenre", "cyberpunk", ["subgenre:cyberpunk"])).toBe(true)
    expect(isContentTagDisabled("subgenre", "cyberpunk", ["subgenre:heist"])).toBe(false)
    expect(isContentTagDisabled("subgenre", null, ["subgenre:cyberpunk"])).toBe(false)
  })
})

describe("network-keys registry", () => {
  it("covers all 75 canonical marks with display names", () => {
    expect(NETWORK_IDS).toHaveLength(75)
    expect(new Set(NETWORK_IDS).size).toBe(75)
    for (const id of NETWORK_IDS) {
      expect(typeof NETWORK_DISPLAY_NAMES[id]).toBe("string")
      expect(NETWORK_DISPLAY_NAMES[id].length).toBeGreaterThan(0)
    }
  })

  it("getNetworkKey keeps the single-matcher contract (incl. Amazon MGM identity)", () => {
    expect(getNetworkKey("Netflix")).toBe("netflix")
    expect(getNetworkKey("Amazon MGM Studios")).toBe("amazon_mgm")
    expect(getNetworkKey("MGM+")).toBe("mgm_plus")
    expect(getNetworkKey("WOWOW Prime")).toBeNull()
    expect(getNetworkKey("White Fox")).toBeNull()
    expect(getNetworkKey("Some Unknown Network XYZ")).toBeNull()
  })

  it("sanitize keeps known IDs case-insensitively, drops unknown, caps", () => {
    expect(sanitizeDisabledNetworks(undefined)).toEqual([])
    expect(sanitizeDisabledNetworks(["Netflix", "bogus", "netflix", "  PRIME  "])).toEqual([
      "netflix",
      "prime",
    ])
    expect(isNetworkDisabled("netflix", ["netflix"])).toBe(true)
    expect(isNetworkDisabled("prime", ["netflix"])).toBe(false)
    expect(isNetworkDisabled(null, ["netflix"])).toBe(false)
    expect(isNetworkDisabled("netflix", null)).toBe(false)
  })
})

describe("subgenre canonical match", () => {
  it("returns the canonical key alongside the localized label", () => {
    const m = getSubGenreMatch(["cyberpunk"], "it")
    expect(m?.key).toBe("cyberpunk")
    expect(typeof m?.label).toBe("string")
  })

  it("returns null without a match (never a localized guess)", () => {
    expect(getSubGenreMatch([], "it")).toBeNull()
    expect(getSubGenreMatch(["romantic comedy"], "it")).toBeNull()
  })
})

describe("badge-priority disabled content tags", () => {
  it("absent exclusions preserve historical behavior", () => {
    const hit = computeBadge(
      baseParams({ subGenre: "Cyberpunk", trueStory: "badge.trueStory" }),
      t,
    )
    expect(hit?.label).toBe("Cyberpunk")
  })

  it("a disabled tag yields to the next enabled candidate in the bucket", () => {
    const hit = computeBadge(
      baseParams({
        subGenre: "Cyberpunk",
        subGenreKey: "cyberpunk",
        trueStory: "badge.trueStory",
        basedOnBook: "badge.basedOnBook",
        disabledContentTags: ["subgenre:cyberpunk"],
      }),
      t,
    )
    expect(hit?.label).toBe("badge.trueStory")
  })

  it("family exclusion disables every subgenre badge", () => {
    const hit = computeBadge(
      baseParams({
        subGenre: "Cyberpunk",
        subGenreKey: "cyberpunk",
        trueStory: "badge.trueStory",
        disabledContentTags: ["subgenre"],
      }),
      t,
    )
    expect(hit?.label).toBe("badge.trueStory")
  })

  it("a fully disabled extra bucket falls through to no badge", () => {
    const hit = computeBadge(
      baseParams({
        subGenre: "Cyberpunk",
        subGenreKey: "cyberpunk",
        disabledContentTags: [
          "subgenre",
          "trueStory",
          "basedOnBook",
          "kdrama",
          "director",
          "studio",
          "miniseries",
          "returning",
          "seriesEnded",
        ],
      }),
      t,
    )
    expect(hit).toBeNull()
  })

  it("new-bucket exclusions skip to the next candidate", () => {
    const hit = computeBadge(
      baseParams({
        isNewMovie: true,
        newSeason: "badge.newSeason",
        disabledContentTags: ["newMovie"],
      }),
      t,
    )
    expect(hit?.label).toBe("badge.newSeason")
  })

  it("award family exclusion skips to nomination then absolute cinema", () => {
    const hit = computeBadge(
      baseParams({ award: "Oscar", nomination: "Nom", disabledContentTags: ["award"] }),
      t,
    )
    expect(hit?.label).toBe("Nom")
  })

  it("disabled tags in other buckets do not leak across buckets", () => {
    const hit = computeBadge(
      baseParams({
        upcomingRelease: "Soon",
        subGenre: "Cyberpunk",
        disabledContentTags: ["subgenre"],
      }),
      t,
    )
    expect(hit?.label).toBe("Soon")
  })
})
