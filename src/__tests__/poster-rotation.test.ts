import { describe, expect, it } from "vitest"
import {
  getEffectiveRotationState,
  getEffectiveBackdropRotationState,
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
