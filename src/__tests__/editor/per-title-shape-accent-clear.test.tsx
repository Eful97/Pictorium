/**
 * Correction 1/3: explicit manual->auto accent clear must survive a shape
 * switch + save + autosave (BLOCKING acceptance criterion).
 *
 * Failing behavior before the fix (see usePosterSave.ts landscape-save
 * `accentColor` branch): a STASHED explicit-auto (`accentColor: null`,
 * present key — exactly what the real EditView shape-switch handler writes
 * via `isManualAccent(...) ? accentColor : null`) was ignored by a
 * string-only check, falling back to the saved manual flat. The saved manual
 * was silently resurrected after the user explicitly cleared it.
 *
 * Fixed contract (same presence semantics as every other keepFlatKey flat):
 * - stash key PRESENT (even null) wins: null = explicit auto -> the flat is
 *   cleared (dropped = auto, same contract as a portrait save);
 * - stash key ABSENT (other shape never visited) = untouched -> the saved
 *   flat is preserved verbatim;
 * - computed auto colors are never frozen (profile stays explicit null, the
 *   flat is dropped rather than storing the sampled hex).
 *
 * The stash objects below are sparse but shape-identical to the real handler
 * output for this branch (single-key reads); the mounted suite
 * (per-title-shape-accent-clear-mounted) proves the full real draft
 * end-to-end through the real switch handler + real save boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePosterSave } from "@/lib/usePosterSave"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"

const noop = () => {}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    selected: { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
    selectedLogo: null,
    setSelectedLogo: noop,
    setPreviewPoster: noop,
    setPreviewId: noop,
    posters: [],
    metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
    trendRank: null,
    mdblistAnimeList: [],
    mappingsMap: new Map<string, Mapping>(),
    loadMappings: async () => {},
    logoScale: 75,
    logoOffsetX: 0,
    logoOffsetY: 0,
    selectedBackdrop: null,
    setSelectedBackdrop: noop,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    setBackdropScale: noop,
    setBackdropOffsetX: noop,
    setBackdropOffsetY: noop,
    globalBadges: true,
    rankingBadges: true,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    badgeQuality: true,
    customRatings: true,
    ratingSources: ["imdb", "tmdb"],
    separateRatings: false,
    separateRatingsStyle: "column",
    customBadge: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    extraBadgeStyle: null,
    badgeFont: "inter",
    qualityBadgeStyle: "standard",
    videoFormats: null,
    defaultBadgeStyle: "shadow",
    defaultRankingBadgeStyle: "default",
    defaultExtraBadgeStyle: null,
    blurEnabled: true,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    landscapeBlur: {
      gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 70,
      blurDarkness: 30, tintStrength: 20, topShade: 50, topShadeHeight: 25,
    },
    landscapeBlurDirty: false,
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 20,
    topShade: 50,
    topShadeHeight: 25,
    gradientHeight: 30,
    setGradientHeight: noop,
    setBlurFade: noop,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    extraBadgeScale: null,
    extraBadgeOffsetX: null,
    extraBadgeOffsetY: null,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 130,
    separateBadgeOffsetX: 0,
    separateBadgeOffsetY: 0,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
    rotationPosters: [],
    autoRotateClean: false,
    defaultAutoRotateClean: false,
    excludedPosters: [],
    accentColor: null,
    autoAccentColor: null,
    logoDisabled: false,
    setLogoDisabled: noop,
    setLogoScale: noop,
    setLogoOffsetX: noop,
    setLogoOffsetY: noop,
    logoScaleExplicit: true,
    rotationBackdrops: [],
    autoRotateBackdrop: false,
    defaultAutoRotateBackdrop: false,
    excludedBackdrops: [],
    backdrops: [],
    networkLogo: true,
    networkLogoPosition: "auto",
    networkLogoFollowTitle: true,
    ribbonEnabled: true,
    lang: "it",
    episodeGroupId: null,
    posterShape: "poster",
    posterLayout: "standard",
    posterFreshScope: "ranked",
    defaultSashOrder: null,
    ...overrides,
  } as never
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

let posted: { url: string; body: Record<string, unknown> }[]
beforeEach(() => {
  posted = []
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
    const body = (init as { body?: string })?.body
    posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
  }))
})

function mappingPosts() {
  return posted.filter((p) => String(p.url).includes("/api/mappings"))
}

describe("correction 1/3: explicit portrait auto-clear survives a landscape save", () => {
  it("stashed explicit-auto (null key present) clears the saved manual flat", async () => {
    const prev = mapping({ accentColor: "#ff0000" })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      // Landscape live is auto (never a frozen computed color).
      accentColor: "#123456",
      autoAccentColor: "#123456",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    // Portrait was visited after an explicit manual->auto clear: the real
    // EditView switch handler stashes `accentColor: null` (key PRESENT).
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { accentColor: null },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // The saved manual must NOT be resurrected: the flat is dropped (= auto,
    // same contract as a portrait save with live auto).
    expect("accentColor" in posts[0].body).toBe(false)
    // The landscape profile keeps its explicit-auto null (shadows, no freeze).
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.accentColor).toBeNull()
  })

  it("stashed portrait manual wins over the saved flat on a landscape save", async () => {
    const prev = mapping({ accentColor: "#ff0000" })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      accentColor: "#123456",
      autoAccentColor: "#123456",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { accentColor: "#123456" },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.accentColor).toBe("#123456")
  })

  it("absent portrait stash preserves the untouched saved manual verbatim", async () => {
    const prev = mapping({ accentColor: "#ff0000" })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      accentColor: "#123456",
      autoAccentColor: "#123456",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    // No portrait visit: no stash key at all (never fabricated).
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.accentColor).toBe("#ff0000")
  })

  it("garbage stashed accent fails closed on the saved flat (never frozen)", async () => {
    const prev = mapping({ accentColor: "#ff0000" })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      accentColor: "#123456",
      autoAccentColor: "#123456",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { accentColor: "not-a-color" },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.accentColor).toBe("#ff0000")
  })

  it("reverse direction: portrait save clears the flat and nulls the landscape profile on explicit auto", async () => {
    const prev = mapping({
      accentColor: "#ff0000",
      landscape: { accentColor: "#00ff00" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      accentColor: null,
      autoAccentColor: null,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { accentColor: null },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect("accentColor" in posts[0].body).toBe(false)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.accentColor).toBeNull()
  })

  it("cleared flat parses and resolves auto on both shapes (never resurrects)", async () => {
    const prev = mapping({
      accentColor: "#ff0000",
      landscape: { accentColor: "#00ff00" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      accentColor: "#123456",
      autoAccentColor: "#123456",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { accentColor: null },
      })
    })
    const body = mappingPosts()[0].body
    const parsed = mappingSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const saved = parsed.data as unknown as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.accentColor).toBeUndefined()
    expect(effectiveMappingForShape(saved, "landscape")?.accentColor).toBeNull()
  })
})

describe("correction 1/3: retired Badge Lab fields persist as inert per-shape data (save/clear boundary)", () => {
  it("stored pairs round-trip verbatim on every shape save (no editor input exists anymore)", async () => {
    const prev = mapping({
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { badgePresetId: "Landscap_01", badgePresetRev: "abcdef12" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const body = mappingPosts()[0].body
    expect(body.badgePresetId).toBe("Abc123-_XyZ")
    expect(body.badgePresetRev).toBe("deadbeef")
    const parsed = mappingSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const saved = parsed.data as unknown as Mapping
    // Shape-effective SELECTION (the read boundary every consumer shares):
    // portrait reads the flat pair, landscape the profile pair, never mixed.
    expect(effectiveMappingForShape(saved, "poster")?.badgePresetId).toBe("Abc123-_XyZ")
    expect(effectiveMappingForShape(saved, "poster")?.badgePresetRev).toBe("deadbeef")
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresetId).toBe("Landscap_01")
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresetRev).toBe("abcdef12")
  })

  it("a portrait save preserves the stored landscape profile verbatim (never resurrects, never clears)", async () => {
    const prev = mapping({
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { badgePresetId: "Landscap_01", badgePresetRev: "abcdef12" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const body = mappingPosts()[0].body
    // Flat verbatim, profile preserved verbatim (full-replace would drop
    // omitted keys, so the save carries the stored values through).
    expect(body.badgePresetId).toBe("Abc123-_XyZ")
    const parsed = mappingSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const saved = parsed.data as unknown as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.badgePresetId).toBe("Abc123-_XyZ")
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresetId).toBe("Landscap_01")
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresetRev).toBe("abcdef12")
  })
})
