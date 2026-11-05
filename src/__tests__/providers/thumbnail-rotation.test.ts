// @vitest-environment node
/**
 * Daily episode-thumbnail rotation.
 *
 * The day bucket is the poster rotation bucket (02:00 UTC cut), so the
 * thumbnail of an episode moves at the same instant as the dynamic poster and
 * identically on every instance. Rotation is opt-in; when it is off, or the
 * candidate list is unusable/fails, the fixed `?still` is served exactly like
 * the historical thumbnail.
 */
import { describe, expect, it, vi } from "vitest"
import {
  DYNAMIC_ROTATION_CUT_HOUR_UTC,
  dynamicRotationBucket,
  rotationIndexFor,
} from "@/lib/poster-rotation"
import {
  THUMBNAIL_ROTATION_CUT_HOUR_UTC,
  parseThumbnailRotation,
  resolveRotatedThumbnailStill,
  selectRotatedThumbnailStill,
  thumbnailCacheKey,
  thumbnailRotationBucket,
} from "@/lib/thumbnail-renderer"
import type { ThumbnailCacheKeyInput } from "@/lib/thumbnail-renderer"

const DAY = 24 * 60 * 60 * 1000
/** 2026-10-01T00:00:00Z: before the 02:00 UTC cut → previous day's bucket. */
const BEFORE_CUT = Date.UTC(2026, 9, 1, 0, 0, 0)
/** 2026-10-01T02:00:00Z: exactly at the cut → the new day's bucket. */
const AT_CUT = Date.UTC(2026, 9, 1, 2, 0, 0)

const FIXED_STILL = "/fixed.jpg"
const STILLS = ["/still-a.jpg", "/still-b.jpg", "/still-c.jpg"]

const BASE_KEY: ThumbnailCacheKeyInput = {
  seriesId: 123,
  seasonNumber: 1,
  episodeNumber: 2,
  still: FIXED_STILL,
  width: 320,
  badges: "both",
  languages: "en,null",
  blur: false,
}

describe("parseThumbnailRotation", () => {
  it("is OFF by default (historical fixed still, byte-identical)", () => {
    expect(parseThumbnailRotation(null)).toBe(false)
    expect(parseThumbnailRotation(undefined)).toBe(false)
    expect(parseThumbnailRotation("0")).toBe(false)
    expect(parseThumbnailRotation("false")).toBe(false)
  })

  it("enables rotation explicitly", () => {
    expect(parseThumbnailRotation("1")).toBe(true)
    expect(parseThumbnailRotation("true")).toBe(true)
    expect(parseThumbnailRotation(" TRUE ")).toBe(true)
  })

  it("rejects garbage so the route can 400", () => {
    expect(parseThumbnailRotation("2")).toBeNull()
    expect(parseThumbnailRotation("yes")).toBeNull()
    expect(parseThumbnailRotation("")).toBeNull()
  })
})

describe("thumbnail rotation bucket", () => {
  it("uses the poster rotation cut (02:00 UTC), not a second time policy", () => {
    expect(THUMBNAIL_ROTATION_CUT_HOUR_UTC).toBe(2)
    expect(THUMBNAIL_ROTATION_CUT_HOUR_UTC).toBe(DYNAMIC_ROTATION_CUT_HOUR_UTC)
  })

  it("matches dynamicRotationBucket for every instant", () => {
    const samples = [
      BEFORE_CUT,
      AT_CUT - 1,
      AT_CUT,
      AT_CUT + DAY - 1,
      AT_CUT + DAY,
      Date.UTC(2030, 0, 15, 12, 34, 56),
    ]
    for (const nowMs of samples) {
      expect(thumbnailRotationBucket(nowMs)).toBe(dynamicRotationBucket(nowMs))
    }
  })

  it("keeps one bucket inside a 02:00→02:00 window and advances at the cut", () => {
    expect(thumbnailRotationBucket(BEFORE_CUT)).toBe(thumbnailRotationBucket(AT_CUT - 1))
    expect(thumbnailRotationBucket(AT_CUT)).toBe(thumbnailRotationBucket(AT_CUT + DAY - 1))
    expect(thumbnailRotationBucket(AT_CUT)).toBe(thumbnailRotationBucket(BEFORE_CUT) + 1)
  })
})

describe("selectRotatedThumbnailStill", () => {
  it("rotation ON: same day bucket → same still", () => {
    const bucket = thumbnailRotationBucket(AT_CUT)
    expect(selectRotatedThumbnailStill(STILLS, FIXED_STILL, bucket)).toBe(
      selectRotatedThumbnailStill(STILLS, FIXED_STILL, bucket),
    )
    // Also stable across two timestamps inside the same 02:00→02:00 window.
    expect(selectRotatedThumbnailStill(STILLS, FIXED_STILL, thumbnailRotationBucket(AT_CUT + 3600_000))).toBe(
      selectRotatedThumbnailStill(STILLS, FIXED_STILL, bucket),
    )
  })

  it("rotation ON: different day buckets → different stills (mocked list)", () => {
    const b = thumbnailRotationBucket(AT_CUT)
    const day1 = selectRotatedThumbnailStill(STILLS, FIXED_STILL, b)
    const day2 = selectRotatedThumbnailStill(STILLS, FIXED_STILL, b + 1)
    const day3 = selectRotatedThumbnailStill(STILLS, FIXED_STILL, b + 2)
    expect(new Set([day1, day2, day3]).size).toBe(3)
    // Full cycle: one list length later the same position comes back.
    expect(selectRotatedThumbnailStill(STILLS, FIXED_STILL, b + STILLS.length)).toBe(day1)
  })

  it("uses the shared wrap-around index rule", () => {
    for (let bucket = -5; bucket < 8; bucket++) {
      expect(selectRotatedThumbnailStill(STILLS, FIXED_STILL, bucket)).toBe(
        STILLS[rotationIndexFor(bucket, STILLS.length)],
      )
    }
  })

  it("drops invalid and duplicate candidates before indexing", () => {
    const candidates = [null, undefined, "relative.jpg", "/still-a.jpg", "/still-a.jpg", "/still-b.jpg"]
    // Valid list is [/still-a.jpg, /still-b.jpg]; bucket 5 → index 1.
    expect(selectRotatedThumbnailStill(candidates, FIXED_STILL, 5)).toBe("/still-b.jpg")
  })

  it("fail-open: empty or unusable list → fixed still", () => {
    expect(selectRotatedThumbnailStill([], FIXED_STILL, 3)).toBe(FIXED_STILL)
    expect(selectRotatedThumbnailStill(null, FIXED_STILL, 3)).toBe(FIXED_STILL)
    expect(selectRotatedThumbnailStill(undefined, FIXED_STILL, 3)).toBe(FIXED_STILL)
    expect(selectRotatedThumbnailStill([null, "nope"], FIXED_STILL, 3)).toBe(FIXED_STILL)
  })

  it("coerces a non-finite bucket to a stable index (never NaN)", () => {
    expect(selectRotatedThumbnailStill(STILLS, FIXED_STILL, Number.NaN)).toBe(STILLS[0])
    expect(selectRotatedThumbnailStill(STILLS, FIXED_STILL, Number.POSITIVE_INFINITY)).toBe(STILLS[0])
  })
})

describe("resolveRotatedThumbnailStill (fail-open loader)", () => {
  const bucket = thumbnailRotationBucket(AT_CUT)

  it("resolves the day's still from the loader and reports the bucket", async () => {
    const loadCandidates = vi.fn(async () => STILLS)
    await expect(resolveRotatedThumbnailStill({ fallback: FIXED_STILL, bucket, loadCandidates })).resolves.toEqual({
      still: STILLS[rotationIndexFor(bucket, STILLS.length)],
      rotationBucket: bucket,
    })
    expect(loadCandidates).toHaveBeenCalledTimes(1)
  })

  it("never rejects: a failed fetch falls back to the fixed still", async () => {
    const loadCandidates = vi.fn(async () => {
      throw new Error("TMDB episode images unavailable")
    })
    await expect(resolveRotatedThumbnailStill({ fallback: FIXED_STILL, bucket, loadCandidates })).resolves.toEqual({
      still: FIXED_STILL,
      rotationBucket: null,
    })
  })

  it("empty/malformed payload → fixed still, no rotation bucket in the key", async () => {
    await expect(
      resolveRotatedThumbnailStill({ fallback: FIXED_STILL, bucket, loadCandidates: async () => null }),
    ).resolves.toEqual({ still: FIXED_STILL, rotationBucket: null })
    await expect(
      resolveRotatedThumbnailStill({ fallback: FIXED_STILL, bucket, loadCandidates: async () => [] }),
    ).resolves.toEqual({ still: FIXED_STILL, rotationBucket: null })
    await expect(
      resolveRotatedThumbnailStill({
        fallback: FIXED_STILL,
        bucket,
        loadCandidates: async () => ["bad", null, undefined],
      }),
    ).resolves.toEqual({ still: FIXED_STILL, rotationBucket: null })
  })

  it("truncates a fractional bucket for the reported key", async () => {
    await expect(
      resolveRotatedThumbnailStill({ fallback: FIXED_STILL, bucket: bucket + 0.9, loadCandidates: async () => STILLS }),
    ).resolves.toEqual({
      still: STILLS[rotationIndexFor(bucket, STILLS.length)],
      rotationBucket: bucket,
    })
  })
})

describe("thumbnailCacheKey day bucket", () => {
  it("rotation OFF keeps the historical key (no fragment)", () => {
    const key = thumbnailCacheKey(BASE_KEY)
    expect(key).not.toContain(":rb")
    expect(thumbnailCacheKey({ ...BASE_KEY, rotationBucket: undefined })).toBe(key)
  })

  it("includes the day bucket when rotation applies", () => {
    expect(thumbnailCacheKey({ ...BASE_KEY, rotationBucket: 7 })).toContain(":rb7")
  })

  it("same still, different buckets → different keys (never reused across days)", () => {
    const day1 = thumbnailCacheKey({ ...BASE_KEY, rotationBucket: 7 })
    const day2 = thumbnailCacheKey({ ...BASE_KEY, rotationBucket: 8 })
    expect(day1).not.toBe(day2)
    expect(day1).not.toBe(thumbnailCacheKey(BASE_KEY))
  })

  it("invalid bucket values fail closed to the historical key", () => {
    const key = thumbnailCacheKey(BASE_KEY)
    expect(thumbnailCacheKey({ ...BASE_KEY, rotationBucket: Number.NaN })).toBe(key)
    expect(thumbnailCacheKey({ ...BASE_KEY, rotationBucket: Number.POSITIVE_INFINITY })).toBe(key)
  })

  it("keeps the key stable for the same bucket", () => {
    expect(thumbnailCacheKey({ ...BASE_KEY, rotationBucket: 7 })).toBe(
      thumbnailCacheKey({ ...BASE_KEY, rotationBucket: 7 }),
    )
  })
})
