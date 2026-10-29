/**
 * Persisted portrait backdrop base (`portraitBackdropPath`): the write
 * boundary accepts and round-trips the field, and the cover-only save keeps it
 * per-format (portrait save = the chosen cover IS the base → cleared;
 * landscape save = the portrait identity is preserved verbatim). The render
 * behaviour lives in backdrop-crop-fallback.test.ts (real pipeline).
 */
import { describe, expect, it } from "vitest"
import { mappingSchema } from "@/lib/validation"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import type { Mapping } from "@/lib/types"

const BASE = { tmdbId: 550, mediaType: "movie", title: "Fight Club", posterPath: "/abc.jpg" } as const
const META = { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 }

function savedMapping(overrides?: Partial<Mapping>): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/abc.jpg",
    logoPath: null,
    originalPosterPath: "/abc.jpg",
    language: "it",
    updatedAt: "2026-01-01T00:00:00.000Z",
    portraitBackdropPath: "/bdclean.jpg",
    ...overrides,
  }
}

describe("mappingSchema portraitBackdropPath", () => {
  it("accepts and round-trips the saved backdrop path", () => {
    const parsed = mappingSchema.safeParse({ ...BASE, portraitBackdropPath: "/bdclean.jpg" })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.portraitBackdropPath).toBe("/bdclean.jpg")
  })

  it("accepts null and a missing field (legacy mappings untouched)", () => {
    expect(mappingSchema.safeParse({ ...BASE, portraitBackdropPath: null }).success).toBe(true)
    expect(mappingSchema.safeParse(BASE).success).toBe(true)
  })

  it("rejects a non-string value", () => {
    expect(mappingSchema.safeParse({ ...BASE, portraitBackdropPath: 42 }).success).toBe(false)
  })
})

describe("buildCoverOnlyPayload portraitBackdropPath per format", () => {
  const cover = { file_path: "/clean.jpg", iso_639_1: null as string | null, vote_average: 0, width: 500, height: 750 }

  it("portrait: omitted, the saved cover IS the base (provenance cleared)", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: cover,
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: savedMapping(),
      metaInfo: META,
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })!
    expect("portraitBackdropPath" in body).toBe(false)
  })

  it("landscape: preserved verbatim as the other-format portrait identity", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: cover,
      selectedBackdrop: { file_path: "/bd2.jpg", iso_639_1: null, vote_average: 0, width: 0, height: 0 },
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: savedMapping({ posterShape: "landscape", backdropPath: "/bd.jpg" }),
      metaInfo: META,
      lang: "it",
      episodeGroupId: null,
      posterShape: "landscape",
    })!
    expect(body.portraitBackdropPath).toBe("/bdclean.jpg")
  })

  it("landscape without a previous value: nothing resurrected", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: cover,
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: null,
      metaInfo: META,
      lang: "it",
      episodeGroupId: null,
      posterShape: "landscape",
    })!
    expect("portraitBackdropPath" in body).toBe(false)
  })
})
