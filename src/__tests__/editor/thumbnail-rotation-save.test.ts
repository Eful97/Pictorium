/**
 * Per-title Miniature rotation: write boundary + cover-only preservation.
 *
 * - the mapping schema accepts the tri-state (true/false/null) and rejects
 *   garbage, so an invalid write can never store a silent "false";
 * - a poster-only (cover-only) save preserves the choice verbatim: it is a
 *   Meta-only rotation preference, inert for the poster, and a cover save must
 *   not wipe it (same contract as `episodeThumbnailStills`);
 * - titles without the field keep the legacy payload byte-identical (key
 *   absent, inherit the space default).
 */
import { describe, expect, it } from "vitest"
import { mappingSchema } from "@/lib/validation"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import type { Mapping } from "@/lib/types"

function baseMapping(): Mapping {
  return {
    tmdbId: 7,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2024-01-01T00:00:00.000Z",
  }
}

function coverInput(prevMapping: Mapping | null, posterShape: "poster" | "landscape") {
  return {
    selected: { id: 7, media_type: "movie" as const, title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
    selectedBackdrop: null,
    selectedLogo: null,
    logoDisabled: false,
    prevMapping,
    metaInfo: {},
    lang: "it",
    episodeGroupId: null,
    posterShape,
  }
}

describe("mapping schema: thumbnailRotation tri-state", () => {
  it("accepts true, false and null (inherit)", () => {
    for (const value of [true, false, null, undefined]) {
      const parsed = mappingSchema.safeParse({ ...baseMapping(), thumbnailRotation: value })
      expect(parsed.success, String(value)).toBe(true)
    }
  })

  it("rejects non-boolean garbage", () => {
    for (const value of ["true", 1, 0, "yes", {}]) {
      const parsed = mappingSchema.safeParse({ ...baseMapping(), thumbnailRotation: value })
      expect(parsed.success, JSON.stringify(value)).toBe(false)
    }
  })
})

describe("cover-only save preserves the per-title rotation choice", () => {
  it("portrait save keeps an explicit ON", () => {
    const prev = { ...baseMapping(), thumbnailRotation: true }
    const body = buildCoverOnlyPayload(coverInput(prev, "poster"))
    expect(body!.thumbnailRotation).toBe(true)
  })

  it("landscape save keeps an explicit OFF", () => {
    const prev = { ...baseMapping(), thumbnailRotation: false }
    const body = buildCoverOnlyPayload(coverInput(prev, "landscape"))
    expect(body!.thumbnailRotation).toBe(false)
  })

  it("titles without the field keep the legacy payload (key absent = inherit)", () => {
    const body = buildCoverOnlyPayload(coverInput(baseMapping(), "poster"))
    expect(body).not.toHaveProperty("thumbnailRotation")
  })
})
