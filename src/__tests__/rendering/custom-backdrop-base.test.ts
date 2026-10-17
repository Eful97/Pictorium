/**
 * Regression coverage for the landscape custom base (`customBackdropUrl`):
 * per-format independent base — save split, analysis key, effective
 * precedence, dirty tracking, cover-only payload, and schema validation. The
 * portrait base stays unchanged (see custom-poster-base.test.ts for the
 * historic path).
 */
import { describe, expect, it } from "vitest"
import { customBaseAnalysisKey, resolveEffectiveCustomUrl, splitCustomBackdropSave, splitCustomPosterSave } from "@/lib/custom-poster-base"
import { isArtworkDirty } from "@/lib/gradient-dirty"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import { mappingSchema, validatePosterQuery } from "@/lib/validation"
import type { Mapping } from "@/lib/types"

const CUSTOM_LAND = "https://i.imgur.com/landscape.jpg"
const CUSTOM_PORTRAIT = "https://i.imgur.com/portrait.jpg"

function baseMapping(overrides?: Partial<Mapping>): Mapping {
  return {
    tmdbId: 550,
    mediaType: "movie",
    title: "Fight Club",
    posterPath: "/abc.jpg",
    logoPath: null,
    originalPosterPath: "/abc.jpg",
    language: null,
    updatedAt: "2024-01-01",
    customPosterUrl: null,
    ...overrides,
  }
}

describe("splitCustomBackdropSave", () => {
  it("custom tile → backdropPath keeps the TMDB fallback and the URL goes to customBackdropUrl", () => {
    expect(splitCustomBackdropSave(CUSTOM_LAND, "/bd.jpg")).toEqual({
      backdropPath: "/bd.jpg",
      customBackdropUrl: CUSTOM_LAND,
    })
  })

  it("custom tile without a TMDB fallback → null backdropPath (automatic), never the URL", () => {
    expect(splitCustomBackdropSave(CUSTOM_LAND, null)).toEqual({
      backdropPath: null,
      customBackdropUrl: CUSTOM_LAND,
    })
  })

  it("custom tmdbRef ignored as a fallback (never a URL inside backdropPath)", () => {
    expect(splitCustomBackdropSave(CUSTOM_LAND, CUSTOM_PORTRAIT)).toEqual({
      backdropPath: null,
      customBackdropUrl: CUSTOM_LAND,
    })
  })

  it("TMDB tile → custom cleared (the save freezes the shown state)", () => {
    expect(splitCustomBackdropSave("/bd.jpg", "/old.jpg")).toEqual({
      backdropPath: "/bd.jpg",
      customBackdropUrl: null,
    })
  })

  it("independent from the portrait split: the two splits never touch each other", () => {
    expect(splitCustomPosterSave(CUSTOM_PORTRAIT, "/abc.jpg")).toEqual({
      posterPath: "/abc.jpg",
      customPosterUrl: CUSTOM_PORTRAIT,
    })
    expect(splitCustomBackdropSave(CUSTOM_LAND, "/bd.jpg").customBackdropUrl).toBe(CUSTOM_LAND)
  })
})

describe("customBaseAnalysisKey per shape", () => {
  it("portrait default unchanged (byte-identical to history)", () => {
    expect(customBaseAnalysisKey(CUSTOM_LAND)).toBe(customBaseAnalysisKey(CUSTOM_LAND, "portrait"))
    expect(customBaseAnalysisKey(CUSTOM_LAND)).toMatch(/^portrait:custom:[0-9a-f]+$/)
  })

  it("landscape uses the shape segment, a hash never the plaintext URL", () => {
    const key = customBaseAnalysisKey(CUSTOM_LAND, "landscape")
    expect(key).toMatch(/^landscape:custom:[0-9a-f]+$/)
    expect(key).not.toContain("imgur")
    expect(key).not.toBe(customBaseAnalysisKey(CUSTOM_LAND, "portrait"))
  })
})

describe("resolveEffectiveCustomUrl reused for the backdrop slot", () => {
  it("explicit query custom wins in preview (newly added tile)", () => {
    expect(resolveEffectiveCustomUrl({
      queryCustomUrl: CUSTOM_LAND,
      hasQueryPoster: true,
      mappingCustomUrl: "https://i.imgur.com/old.jpg",
      isPreview: true,
    })).toBe(CUSTOM_LAND)
  })

  it("preview with a TMDB query shows the clicked tile (no resurrect of the saved one)", () => {
    expect(resolveEffectiveCustomUrl({
      queryCustomUrl: null,
      hasQueryPoster: true,
      mappingCustomUrl: "https://i.imgur.com/old.jpg",
      isPreview: true,
    })).toBeNull()
  })

  it("explicit query always wins (Stremio never sends backdrop=)", () => {
    expect(resolveEffectiveCustomUrl({
      queryCustomUrl: CUSTOM_LAND,
      hasQueryPoster: true,
      mappingCustomUrl: "https://i.imgur.com/old.jpg",
      isPreview: false,
    })).toBe(CUSTOM_LAND)
  })

  it("without an explicit query the saved value applies, including in preview (initial state)", () => {
    expect(resolveEffectiveCustomUrl({
      queryCustomUrl: null,
      hasQueryPoster: false,
      mappingCustomUrl: "https://i.imgur.com/old.jpg",
      isPreview: true,
    })).toBe("https://i.imgur.com/old.jpg")
  })
})

describe("isArtworkDirty with customBackdropUrl", () => {
  const shape = "landscape" as const
  const currentBase = {
    posterPath: "/abc.jpg",
    customPosterUrl: null as string | null,
    backdropPath: "/bd.jpg" as string | null,
    customBackdropUrl: null as string | null,
    posterShape: shape,
    logoPath: null,
  }

  it("landscape custom equal to the saved one → clean", () => {
    const m = baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customBackdropUrl: CUSTOM_LAND })
    expect(isArtworkDirty({ ...currentBase, backdropPath: CUSTOM_LAND, customBackdropUrl: CUSTOM_LAND }, m, "poster")).toBe(false)
  })

  it("landscape custom different from the saved one → dirty", () => {
    const m = baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customBackdropUrl: CUSTOM_LAND })
    expect(isArtworkDirty({ ...currentBase, backdropPath: "/other.jpg", customBackdropUrl: "https://i.imgur.com/other.jpg" }, m, "poster")).toBe(true)
  })

  it("removing the custom (back to TMDB) → dirty until saved", () => {
    const m = baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customBackdropUrl: CUSTOM_LAND })
    expect(isArtworkDirty({ ...currentBase }, m, "poster")).toBe(true)
  })

  it("adding a custom on a TMDB mapping → dirty", () => {
    const m = baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg" })
    expect(isArtworkDirty({ ...currentBase, backdropPath: CUSTOM_LAND, customBackdropUrl: CUSTOM_LAND }, m, "poster")).toBe(true)
  })

  it("portrait unchanged: customPosterUrl does not affect the backdrop comparison", () => {
    const m = baseMapping({ posterShape: "landscape", backdropPath: "/bd.jpg", customPosterUrl: CUSTOM_PORTRAIT })
    const current = { ...currentBase, posterPath: CUSTOM_PORTRAIT, customPosterUrl: CUSTOM_PORTRAIT }
    expect(isArtworkDirty(current, m, "poster")).toBe(false)
  })

  it("without a mapping: a lone landscape custom marks dirty", () => {
    expect(isArtworkDirty({ ...currentBase, backdropPath: CUSTOM_LAND, customBackdropUrl: CUSTOM_LAND, posterShape: "landscape" }, null, "poster")).toBe(true)
  })
})

describe("buildCoverOnlyPayload with a landscape custom", () => {
  const meta = { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 }

  it("landscape with a custom tile → split (TMDB fallback + customBackdropUrl)", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: { file_path: CUSTOM_LAND, iso_639_1: null, vote_average: 0, width: 0, height: 0 },
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: baseMapping({ backdropPath: "/bd.jpg" }),
      metaInfo: meta,
      lang: "it",
      episodeGroupId: null,
      posterShape: "landscape",
    })!
    expect(body.backdropPath).toBe("/bd.jpg")
    expect(body.customBackdropUrl).toBe(CUSTOM_LAND)
  })

  it("landscape with a TMDB tile → custom cleared", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: { file_path: "/bd2.jpg", iso_639_1: null, vote_average: 0, width: 0, height: 0 },
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: baseMapping({ backdropPath: "/bd.jpg", customBackdropUrl: CUSTOM_LAND }),
      metaInfo: meta,
      lang: "it",
      episodeGroupId: null,
      posterShape: "landscape",
    })!
    expect(body.backdropPath).toBe("/bd2.jpg")
    expect(body.customBackdropUrl).toBeNull()
  })

  it("portrait preserves the saved customBackdropUrl (never touched)", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 550, media_type: "movie", title: "Fight Club", poster_path: "/fc.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: baseMapping({ backdropPath: "/bd.jpg", customBackdropUrl: CUSTOM_LAND }),
      metaInfo: meta,
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })!
    expect(body.backdropPath).toBe("/bd.jpg")
    expect(body.customBackdropUrl).toBe(CUSTOM_LAND)
  })
})

describe("mappingSchema customBackdropUrl", () => {
  const base = { tmdbId: 550, mediaType: "movie", title: "Fight Club", posterPath: "/abc.jpg" } as const

  it("accepts a valid http/https URL", () => {
    const parsed = mappingSchema.safeParse({ ...base, customBackdropUrl: CUSTOM_LAND })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.customBackdropUrl).toBe(CUSTOM_LAND)
  })

  it("accepts null and a missing field (backward compat)", () => {
    expect(mappingSchema.safeParse({ ...base, customBackdropUrl: null }).success).toBe(true)
    const parsed = mappingSchema.safeParse({ ...base })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.customBackdropUrl).toBeUndefined()
  })

  it("rejects non-HTTP schemes and non-URLs", () => {
    expect(mappingSchema.safeParse({ ...base, customBackdropUrl: "ftp://x.com/a.jpg" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, customBackdropUrl: "not a url" }).success).toBe(false)
  })

  it("rejects URLs past the length cap", () => {
    const long = `https://i.imgur.com/${"a".repeat(2100)}.jpg`
    expect(mappingSchema.safeParse({ ...base, customBackdropUrl: long }).success).toBe(false)
  })
})

describe("validatePosterQuery backdrop bound", () => {
  it("accepts a long custom backdrop (same wide bound as poster/logo)", () => {
    const long = `https://i.imgur.com/${"a".repeat(300)}.jpg`
    const params = new URLSearchParams({ shape: "landscape", backdrop: long })
    expect(validatePosterQuery(params)).toBeNull()
  })
})
