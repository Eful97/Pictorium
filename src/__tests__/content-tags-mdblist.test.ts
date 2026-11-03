// Step 2 — MDBList/WhatsOn feature badges: canonical content-tag IDs,
// documented priority and the existing space-wide opt-out (`disabledContentTags`).
//
// These badges are derived from the SAME MDBList ratings response
// (`whatson_features`), so no URL parameter and no extra fetch is involved.
import { describe, expect, it } from "vitest"
import {
  CONTENT_TAG_IDS,
  MDBLIST_FEATURE_TAG_IDS,
  isContentTagDisabled,
  sanitizeDisabledContentTags,
  type MdbListWhatsonFeatures,
} from "@/lib/content-tags"
import { computeBadge, type BadgeParams } from "@/lib/badge-priority"
import { computeTopBadge, type BadgeInput } from "@/lib/poster-badge"

const t = (k: string, params?: Record<string, string | number>) =>
  params && params.rank !== undefined ? `${k}:${params.rank}` : k

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
    extra: null,
    ...over,
  }
}

function baseBadgeInput(over: Partial<BadgeInput> = {}): BadgeInput {
  return {
    mediaType: "movie",
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [],
    voteAverage: 7.5,
    trendRank: null,
    animeRank: null,
    awards: [],
    nominations: [],
    studios: [],
    director: null,
    tvType: null,
    tvStatus: null,
    ...over,
  }
}

const ALL_FEATURES: MdbListWhatsonFeatures = {
  imdbTopRanking: 12,
  metacriticMustSee: true,
  rottenTomatoesCriticsCertified: true,
  rottenTomatoesUsersCertified: true,
}

describe("MDBList feature canonical IDs", () => {
  it("registers every feature badge ID in the allowlisted registry", () => {
    for (const id of MDBLIST_FEATURE_TAG_IDS) {
      expect(CONTENT_TAG_IDS).toContain(id)
    }
    expect(MDBLIST_FEATURE_TAG_IDS).toEqual([
      "imdbTopRanking",
      "certifiedFresh",
      "verifiedHot",
      "mustSee",
    ])
  })

  it("sanitize keeps the new IDs and still drops unknown ones", () => {
    expect(
      sanitizeDisabledContentTags(["certifiedFresh", "bogus", "mustSee", "verifiedHot", "imdbTopRanking"]),
    ).toEqual(["certifiedFresh", "mustSee", "verifiedHot", "imdbTopRanking"])
    expect(isContentTagDisabled("certifiedFresh", null, ["certifiedFresh"])).toBe(true)
    expect(isContentTagDisabled("mustSee", null, ["trueStory"])).toBe(false)
  })
})

describe("feature badge priority (documented: IMDb rank > Certified Fresh > Verified Hot > Must-See)", () => {
  it("maps every flag to its documented badge label", () => {
    expect(computeBadge(baseParams({ imdbTopRanking: 12 }), t)?.label).toBe("badge.imdbTopRanking:12")
    expect(computeBadge(baseParams({ certifiedFresh: true }), t)?.label).toBe("badge.certifiedFresh")
    expect(computeBadge(baseParams({ verifiedHot: true }), t)?.label).toBe("badge.verifiedHot")
    expect(computeBadge(baseParams({ mustSee: true }), t)?.label).toBe("badge.mustSee")
  })

  it("honors the fixed order when multiple flags are present", () => {
    expect(computeBadge(baseParams({
      imdbTopRanking: 12,
      certifiedFresh: true,
      verifiedHot: true,
      mustSee: true,
    }), t)?.label).toBe("badge.imdbTopRanking:12")

    expect(computeBadge(baseParams({
      certifiedFresh: true,
      verifiedHot: true,
      mustSee: true,
    }), t)?.label).toBe("badge.certifiedFresh")

    expect(computeBadge(baseParams({
      verifiedHot: true,
      mustSee: true,
    }), t)?.label).toBe("badge.verifiedHot")

    expect(computeBadge(baseParams({ mustSee: true }), t)?.label).toBe("badge.mustSee")
  })

  it("sits below the award bucket and above sub-genres in the extra bucket", () => {
    expect(computeBadge(baseParams({
      award: "badge.oscar",
      imdbTopRanking: 12,
    }), t)?.label).toBe("badge.oscar")

    expect(computeBadge(baseParams({
      certifiedFresh: true,
      subGenre: "Cyberpunk",
    }), t)?.label).toBe("badge.certifiedFresh")
  })

  it("each feature yields through the existing dct opt-out, then falls through", () => {
    const all: Partial<BadgeParams> = {
      imdbTopRanking: 12,
      certifiedFresh: true,
      verifiedHot: true,
      mustSee: true,
      subGenre: "Cyberpunk",
      disabledContentTags: [],
    }
    const withDisabled = (tags: string[]) =>
      computeBadge(baseParams({ ...all, disabledContentTags: tags }), t)?.label

    expect(withDisabled(["imdbTopRanking"])).toBe("badge.certifiedFresh")
    expect(withDisabled(["imdbTopRanking", "certifiedFresh"])).toBe("badge.verifiedHot")
    expect(withDisabled(["imdbTopRanking", "certifiedFresh", "verifiedHot"])).toBe("badge.mustSee")
    expect(withDisabled(["imdbTopRanking", "certifiedFresh", "verifiedHot", "mustSee"])).toBe("Cyberpunk")
    expect(withDisabled(["certifiedFresh", "mustSee"])).toBe("badge.imdbTopRanking:12")
  })

  it("computeTopBadge consumes whatson_features with the same priority and opt-out", () => {
    const computed = computeTopBadge(
      baseBadgeInput({ whatsonFeatures: ALL_FEATURES }),
      t,
      "it",
      null,
      "locale",
    )
    expect(computed.badge?.type).toBe("extra")
    expect(computed.badge?.label).toBe("badge.imdbTopRanking:12")

    const withoutRank = computeTopBadge(
      baseBadgeInput({
        whatsonFeatures: { ...ALL_FEATURES, imdbTopRanking: null },
        disabledContentTags: ["certifiedFresh"],
      }),
      t,
      "it",
      null,
      "locale",
    )
    expect(withoutRank.badge?.label).toBe("badge.verifiedHot")

    const disabledAll = computeTopBadge(
      baseBadgeInput({
        whatsonFeatures: ALL_FEATURES,
        disabledContentTags: [...MDBLIST_FEATURE_TAG_IDS],
      }),
      t,
      "it",
      null,
      "locale",
    )
    expect(disabledAll.badge).toBeNull()
  })

  it("absent features keep the historical render (no invented badge)", () => {
    expect(computeTopBadge(baseBadgeInput(), t, "it", null, "locale").badge).toBeNull()
    expect(computeTopBadge(
      baseBadgeInput({ whatsonFeatures: null }),
      t,
      "it",
      null,
      "locale",
    ).badge).toBeNull()
  })

  it("existing Absolute Cinema keeps its award-bucket precedence over the MDBList rank", () => {
    const computed = computeTopBadge(
      baseBadgeInput({ imdbTop250: true, whatsonFeatures: ALL_FEATURES }),
      t,
      "it",
      null,
      "locale",
    )
    expect(computed.badge?.label).toBe("badge.absoluteCinema")
  })
})
