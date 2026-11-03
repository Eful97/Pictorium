import { describe, expect, it } from "vitest"
import {
  getEffectiveRotationState,
  getEffectiveBackdropRotationState,
  isRotatedNonCleanPoster,
  dynamicRotationBucket,
  secondsUntilDynamicRotationCut,
  rotationIndexFor,
  getDynamicRotationBucket,
  DYNAMIC_ROTATION_CUT_HOUR_UTC,
} from "@/lib/poster-rotation"
import type { Mapping } from "@/lib/types"

function mapping(input: Partial<Mapping>): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "Rotation Test",
    posterPath: "/a.jpg",
    logoPath: "/logo.png",
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...input,
  }
}

describe("getEffectiveRotationState", () => {
  it("disables rotation when exclusions leave fewer than two posters", () => {
    const state = getEffectiveRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: ["/a.jpg", "/b.jpg"],
      excludedPosters: ["/b.jpg"],
    }))

    expect(state.isRotating).toBe(false)
    expect(state.availablePosters).toEqual(["/a.jpg"])
  })

  it("keeps rotation enabled when at least two posters remain", () => {
    const state = getEffectiveRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: ["/a.jpg", "/b.jpg", "/c.jpg"],
      excludedPosters: ["/c.jpg"],
    }))

    expect(state.isRotating).toBe(true)
    expect(state.availablePosters).toEqual(["/a.jpg", "/b.jpg"])
  })
})

// Mixed clean + it + en pool for the portrait rotation language scope
// (`rotationIncludeNonClean` + `rotationPosterLanguages`). The `en` poster is
// the inert control: it must never enter a pool selected for `it`.
const CLEAN_A = "/clean-a.jpg"
const CLEAN_B = "/clean-b.jpg"
const IT_POSTER = "/it-poster.jpg"
const EN_POSTER = "/en-poster.jpg"

function scopedMapping(input: Partial<Mapping> = {}): Mapping {
  return mapping({
    autoRotateClean: true,
    cleanPosters: [CLEAN_A, CLEAN_B, IT_POSTER, EN_POSTER],
    rotationIncludeNonClean: true,
    rotationNonCleanPosters: [IT_POSTER, EN_POSTER],
    rotationPosterLanguages: { [IT_POSTER]: "it", [EN_POSTER]: "en" },
    ...input,
  })
}

describe("getEffectiveRotationState language scope (mixed clean+it+en pool)", () => {
  it("selected `it` keeps clean + it only: `en` is inert", () => {
    const state = getEffectiveRotationState(scopedMapping(), "it")

    expect(state.availablePosters).toEqual([CLEAN_A, CLEAN_B, IT_POSTER])
    expect(state.availablePosters).not.toContain(EN_POSTER)
    expect(state.isRotating).toBe(true)
  })

  it("matches the language case-insensitively on the primary subtag", () => {
    const expected = [CLEAN_A, CLEAN_B, IT_POSTER]
    expect(getEffectiveRotationState(scopedMapping(), "IT").availablePosters).toEqual(expected)
    expect(getEffectiveRotationState(scopedMapping(), "it-IT").availablePosters).toEqual(expected)
    expect(getEffectiveRotationState(scopedMapping(), "it_IT").availablePosters).toEqual(expected)
    expect(getEffectiveRotationState(scopedMapping(), " It ").availablePosters).toEqual(expected)
  })

  it("empty/absent selected language falls back to clean-only", () => {
    const expected = [CLEAN_A, CLEAN_B]
    expect(getEffectiveRotationState(scopedMapping(), "").availablePosters).toEqual(expected)
    expect(getEffectiveRotationState(scopedMapping(), null).availablePosters).toEqual(expected)
    expect(getEffectiveRotationState(scopedMapping(), undefined).availablePosters).toEqual(expected)
  })

  it("selected language with no matching poster is clean-only", () => {
    const state = getEffectiveRotationState(scopedMapping({
      rotationPosterLanguages: { [EN_POSTER]: "en" },
    }), "it")

    expect(state.availablePosters).toEqual([CLEAN_A, CLEAN_B])
    expect(state.availablePosters).not.toContain(IT_POSTER)
    expect(state.availablePosters).not.toContain(EN_POSTER)
  })

  it("a non-clean path without language metadata stays inert in opt-in mode", () => {
    const state = getEffectiveRotationState(scopedMapping({
      cleanPosters: [CLEAN_A, IT_POSTER],
      rotationNonCleanPosters: [IT_POSTER],
      rotationPosterLanguages: null,
    }), "it")

    expect(state.availablePosters).toEqual([CLEAN_A])
    expect(state.isRotating).toBe(false)
  })

  it("legacy mapping (no opt-in fields) keeps every cleanPosters path, byte-identical", () => {
    const state = getEffectiveRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: [CLEAN_A, CLEAN_B, "/old-c.jpg"],
    }))

    expect(state.availablePosters).toEqual([CLEAN_A, CLEAN_B, "/old-c.jpg"])
    expect(state.isRotating).toBe(true)
  })

  it("flag off (opt-out) filters recorded non-clean paths without changing legacy lists", () => {
    const state = getEffectiveRotationState(scopedMapping({
      rotationIncludeNonClean: false,
    }), "it")

    expect(state.availablePosters).toEqual([CLEAN_A, CLEAN_B])
    expect(state.availablePosters).not.toContain(IT_POSTER)
    expect(state.availablePosters).not.toContain(EN_POSTER)
  })

  it("exclusions are respected in opt-in mode (clean and selected-language posters)", () => {
    const state = getEffectiveRotationState(scopedMapping({
      excludedPosters: [CLEAN_B, IT_POSTER],
    }), "it")

    expect(state.availablePosters).toEqual([CLEAN_A])
    expect(state.isRotating).toBe(false)
  })

  it("exclusions are respected in legacy mode", () => {
    const state = getEffectiveRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: [CLEAN_A, CLEAN_B, "/old-c.jpg"],
      excludedPosters: [CLEAN_B],
    }))

    expect(state.availablePosters).toEqual([CLEAN_A, "/old-c.jpg"])
    expect(state.isRotating).toBe(true)
  })

  it("pool < 2 after language filtering/exclusions does not rotate", () => {
    expect(getEffectiveRotationState(scopedMapping({
      cleanPosters: [CLEAN_A, IT_POSTER],
      rotationNonCleanPosters: [IT_POSTER],
      excludedPosters: [IT_POSTER],
    }), "it").isRotating).toBe(false)

    expect(getEffectiveRotationState(scopedMapping({
      cleanPosters: [IT_POSTER, EN_POSTER],
      rotationNonCleanPosters: [IT_POSTER, EN_POSTER],
    }), "it").isRotating).toBe(false)
  })
})

describe("isRotatedNonCleanPoster logo suppression (mixed pool)", () => {
  it("suppresses the logo when the base lands on the selected-language poster", () => {
    expect(isRotatedNonCleanPoster(scopedMapping(), IT_POSTER, "it")).toBe(true)
    expect(isRotatedNonCleanPoster(scopedMapping(), IT_POSTER, "IT")).toBe(true)
    expect(isRotatedNonCleanPoster(scopedMapping({ posterPath: IT_POSTER }), undefined, "it")).toBe(true)
  })

  it("does not suppress a clean base or another language's base", () => {
    expect(isRotatedNonCleanPoster(scopedMapping(), CLEAN_A, "it")).toBe(false)
    expect(isRotatedNonCleanPoster(scopedMapping(), EN_POSTER, "it")).toBe(false)
    expect(isRotatedNonCleanPoster(scopedMapping(), IT_POSTER, "en")).toBe(false)
  })

  it("never suppresses without the opt-in flag (legacy behavior)", () => {
    expect(isRotatedNonCleanPoster(
      scopedMapping({ rotationIncludeNonClean: false }),
      IT_POSTER,
      "it",
    )).toBe(false)
    expect(isRotatedNonCleanPoster(mapping({ posterPath: IT_POSTER }), IT_POSTER, "it")).toBe(false)
  })

  it("a recorded non-clean path without a language keeps the historic suppression", () => {
    const m = scopedMapping({
      rotationIncludeNonClean: true,
      rotationPosterLanguages: null,
    })
    expect(isRotatedNonCleanPoster(m, IT_POSTER, "it")).toBe(true)
    expect(isRotatedNonCleanPoster(m, IT_POSTER, null)).toBe(true)
  })

  it("custom bases and portrait backdrop crops stay historical (route-equivalent guard)", () => {
    // Same predicate the route applies before suppressing logo/text wordmark:
    // portrait only, no explicit custom URL, no `portraitBackdropPath` crop.
    function routeSuppresses(
      m: Mapping,
      path: string | null,
      lang: string,
      opts: { isLandscape?: boolean; effectiveCustomUrl?: string | null; portraitBackdropPath?: string | null } = {},
    ): boolean {
      const isLandscape = opts.isLandscape ?? false
      const effectiveCustomUrl = opts.effectiveCustomUrl ?? null
      const mappingPortraitBackdropPath = opts.portraitBackdropPath ?? null
      return !isLandscape
        && !effectiveCustomUrl
        && mappingPortraitBackdropPath === null
        && isRotatedNonCleanPoster(m, path, lang)
    }

    const m = scopedMapping()
    expect(routeSuppresses(m, IT_POSTER, "it")).toBe(true)
    // Defensive fixtures: even a path that IS in the rotation metadata cannot
    // suppress when the base is custom, cropped from a backdrop, or landscape.
    expect(routeSuppresses(m, IT_POSTER, "it", { effectiveCustomUrl: IT_POSTER })).toBe(false)
    expect(routeSuppresses(m, IT_POSTER, "it", { portraitBackdropPath: "/bd.jpg" })).toBe(false)
    expect(routeSuppresses(m, IT_POSTER, "it", { isLandscape: true })).toBe(false)
  })
})

describe("getEffectiveBackdropRotationState", () => {
  it("disables rotation without flag or with fewer than two backdrops", () => {
    expect(getEffectiveBackdropRotationState(mapping({})).isRotating).toBe(false)
    expect(getEffectiveBackdropRotationState(mapping({
      autoRotateBackdrop: true,
      cleanBackdrops: ["/a.jpg"],
    })).isRotating).toBe(false)
  })

  it("disables rotation when exclusions leave fewer than two backdrops", () => {
    const state = getEffectiveBackdropRotationState(mapping({
      autoRotateBackdrop: true,
      cleanBackdrops: ["/a.jpg", "/b.jpg"],
      excludedBackdrops: ["/b.jpg"],
    }))

    expect(state.isRotating).toBe(false)
    expect(state.availableBackdrops).toEqual(["/a.jpg"])
  })

  it("keeps rotation enabled when at least two backdrops remain", () => {
    const state = getEffectiveBackdropRotationState(mapping({
      autoRotateBackdrop: true,
      cleanBackdrops: ["/a.jpg", "/b.jpg", "/c.jpg"],
      excludedBackdrops: ["/c.jpg"],
    }))

    expect(state.isRotating).toBe(true)
    expect(state.availableBackdrops).toEqual(["/a.jpg", "/b.jpg"])
  })

  it("is independent from poster rotation", () => {
    const state = getEffectiveBackdropRotationState(mapping({
      autoRotateClean: true,
      cleanPosters: ["/a.jpg", "/b.jpg"],
    }))

    expect(state.isRotating).toBe(false)
    expect(state.availableBackdrops).toEqual([])
  })
})

describe("dynamicRotationBucket", () => {
  const day = 24 * 60 * 60 * 1000
  // 2026-10-01T00:00:00Z: prima del cut delle 02:00 → bucket del giorno prima.
  const beforeCut = Date.UTC(2026, 9, 1, 0, 0, 0)
  const atCut = Date.UTC(2026, 9, 1, 2, 0, 0)

  it("keeps the same bucket inside a 02:00→02:00 window", () => {
    expect(dynamicRotationBucket(beforeCut)).toBe(dynamicRotationBucket(atCut - 1))
    expect(dynamicRotationBucket(atCut)).toBe(dynamicRotationBucket(atCut + day - 1))
  })

  it("advances by one bucket at the cut", () => {
    expect(dynamicRotationBucket(atCut)).toBe(dynamicRotationBucket(beforeCut) + 1)
  })

  it("advances by one per day", () => {
    const b = dynamicRotationBucket(atCut)
    expect(dynamicRotationBucket(atCut + day)).toBe(b + 1)
    expect(dynamicRotationBucket(atCut + 2 * day)).toBe(b + 2)
  })

  it("cut hour is 02:00 UTC", () => {
    expect(DYNAMIC_ROTATION_CUT_HOUR_UTC).toBe(2)
  })
})

describe("secondsUntilDynamicRotationCut", () => {
  it("counts down to the next 02:00 UTC", () => {
    // 01:00 → 3600s al cut.
    expect(secondsUntilDynamicRotationCut(Date.UTC(2026, 9, 1, 1, 0, 0))).toBe(3600)
    // 03:00 → 23h al cut successivo.
    expect(secondsUntilDynamicRotationCut(Date.UTC(2026, 9, 1, 3, 0, 0))).toBe(23 * 3600)
  })

  it("never drops below 60s", () => {
    expect(secondsUntilDynamicRotationCut(Date.UTC(2026, 9, 1, 1, 59, 59))).toBe(60)
  })
})

describe("rotationIndexFor", () => {
  it("advances by one per bucket without a store", () => {
    expect(rotationIndexFor(7, 3)).toBe(1)
    expect(rotationIndexFor(8, 3)).toBe(2)
    expect(rotationIndexFor(9, 3)).toBe(0)
  })

  it("returns 0 for an empty pool", () => {
    expect(rotationIndexFor(7, 0)).toBe(0)
  })
})

describe("getDynamicRotationBucket", () => {
  const base = {
    hasMapping: false,
    hasQueryPoster: false,
    isLandscape: false,
    portraitEnabled: true,
    backdropEnabled: true,
    nowMs: Date.UTC(2026, 9, 1, 12, 0, 0),
  }

  it("returns a bucket when the portrait flag is on", () => {
    expect(getDynamicRotationBucket(base)).toBe(dynamicRotationBucket(base.nowMs))
  })

  it("returns null with a mapping or an explicit poster choice", () => {
    expect(getDynamicRotationBucket({ ...base, hasMapping: true })).toBeNull()
    expect(getDynamicRotationBucket({ ...base, hasQueryPoster: true })).toBeNull()
  })

  it("returns null when the flag for the shape is off", () => {
    expect(getDynamicRotationBucket({ ...base, portraitEnabled: false })).toBeNull()
    expect(getDynamicRotationBucket({
      ...base,
      isLandscape: true,
      portraitEnabled: true,
      backdropEnabled: false,
    })).toBeNull()
  })

  it("uses the backdrop flag in landscape", () => {
    expect(getDynamicRotationBucket({
      ...base,
      isLandscape: true,
      portraitEnabled: false,
      backdropEnabled: true,
    })).toBe(dynamicRotationBucket(base.nowMs))
  })
})
