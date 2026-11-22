import { describe, expect, it } from "vitest"
import { getEffectiveRotationState, isRotatedNonCleanPoster } from "@/lib/poster-rotation"
import { isSavedOriginalPoster } from "@/lib/rotation-language"
import { mappingSchema } from "@/lib/validation"
import type { Mapping } from "@/lib/types"

// Pool: 2 clean + it (my language) + zh (original) + en (inert control).
const CLEAN_A = "/clean-a.jpg"
const CLEAN_B = "/clean-b.jpg"
const IT = "/it.jpg"
const ZH = "/zh.jpg"
const EN = "/en.jpg"

function m(input: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 1,
    mediaType: "tv",
    title: "Drama",
    posterPath: CLEAN_A,
    logoPath: "/logo.png",
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-07-16T00:00:00.000Z",
    autoRotateClean: true,
    cleanPosters: [CLEAN_A, CLEAN_B, IT, ZH, EN],
    rotationNonCleanPosters: [IT, ZH, EN],
    rotationPosterLanguages: { [IT]: "it", [ZH]: "zh", [EN]: "en" },
    ...input,
  }
}

describe("original-language rotation scope", () => {
  it("both off: clean only (legacy)", () => {
    expect(getEffectiveRotationState(m(), "it").availablePosters).toEqual([CLEAN_A, CLEAN_B])
  })

  it("my language only: clean + it (unchanged behavior)", () => {
    const s = getEffectiveRotationState(m({ rotationIncludeNonClean: true }), "it")
    expect(s.availablePosters).toEqual([CLEAN_A, CLEAN_B, IT])
  })

  it("original only: clean + zh, `it` stays out", () => {
    const s = getEffectiveRotationState(
      m({ rotationIncludeOriginal: true, rotationOriginalLanguage: "zh" }), "it")
    expect(s.availablePosters).toEqual([CLEAN_A, CLEAN_B, ZH])
  })

  it("my language + original: clean + it + zh, `en` inert", () => {
    const s = getEffectiveRotationState(
      m({ rotationIncludeNonClean: true, rotationIncludeOriginal: true, rotationOriginalLanguage: "zh" }), "it")
    expect(s.availablePosters).toEqual([CLEAN_A, CLEAN_B, IT, ZH])
  })

  it("original == my language: no duplicates", () => {
    const s = getEffectiveRotationState(
      m({ rotationIncludeNonClean: true, rotationIncludeOriginal: true, rotationOriginalLanguage: "it" }), "it")
    expect(s.availablePosters).toEqual([CLEAN_A, CLEAN_B, IT])
  })

  it("original flag without saved language is fail-closed (clean only)", () => {
    const s = getEffectiveRotationState(m({ rotationIncludeOriginal: true }), "it")
    expect(s.availablePosters).toEqual([CLEAN_A, CLEAN_B])
  })

  it("matches region tags on the primary subtag", () => {
    const s = getEffectiveRotationState(
      m({ rotationIncludeOriginal: true, rotationOriginalLanguage: "ZH-CN" }), null)
    expect(s.availablePosters).toEqual([CLEAN_A, CLEAN_B, ZH])
  })
})

describe("original-language logo suppression", () => {
  const orig = m({ rotationIncludeOriginal: true, rotationOriginalLanguage: "zh" })

  it("original poster suppresses the logo, other-language non-clean does not", () => {
    expect(isRotatedNonCleanPoster(orig, ZH, "it")).toBe(true)
    expect(isRotatedNonCleanPoster(orig, IT, "it")).toBe(false)
    expect(isRotatedNonCleanPoster(orig, CLEAN_A, "it")).toBe(false)
  })

  it("both flags: each own language suppresses", () => {
    const both = m({ rotationIncludeNonClean: true, rotationIncludeOriginal: true, rotationOriginalLanguage: "zh" })
    expect(isRotatedNonCleanPoster(both, IT, "it")).toBe(true)
    expect(isRotatedNonCleanPoster(both, ZH, "it")).toBe(true)
    expect(isRotatedNonCleanPoster(both, EN, "it")).toBe(false)
  })

  it("no flags: never suppresses", () => {
    expect(isRotatedNonCleanPoster(m(), ZH, "it")).toBe(false)
  })
})

describe("isSavedOriginalPoster + schema", () => {
  it("recognises only recorded posters in the saved original language", () => {
    const orig = m({ rotationIncludeOriginal: true, rotationOriginalLanguage: "zh" })
    expect(isSavedOriginalPoster(orig, ZH)).toBe(true)
    expect(isSavedOriginalPoster(orig, IT)).toBe(false)
    expect(isSavedOriginalPoster(m({ rotationOriginalLanguage: "zh" }), ZH)).toBe(false)
  })

  it("mappingSchema accepts the new fields and rejects an over-long code", () => {
    const ok = mappingSchema.safeParse(m({ rotationIncludeOriginal: true, rotationOriginalLanguage: "zh" }))
    expect(ok.success).toBe(true)
    const bad = mappingSchema.safeParse(m({ rotationOriginalLanguage: "x".repeat(9) }))
    expect(bad.success).toBe(false)
  })
})
