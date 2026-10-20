/**
 * Per-title portrait/landscape SAVE boundary (correction cycle 1).
 *
 * Contract under test (see .agents/render-params.md "Badge per-titolo per
 * formato"): editing either shape must not modify the other shape's SAVED
 * look. The save payload is the boundary:
 * - landscape save preserves the portrait flat VERBATIM from the saved
 *   mapping (full-replace POST): concrete stays, null stays null, absent
 *   stays absent — never the edited landscape live value;
 * - new-mapping landscape-first save leaves flats absent (inherit) unless a
 *   staged portrait edit exists (both-shape edits before first save);
 * - portrait save backfills the pre-edit CHAIN-effective value
 *   (landscape-defaults profile > flat default > factory) for inherited keys
 *   the edit would otherwise move — never the edited current value, never a
 *   blind factory guess under noncanonical defaults;
 * - staged other-shape style edits (EditView shape stash, passed as
 *   `otherShapeStash`) are persisted: portrait stash wins for flats on a
 *   landscape save, landscape stash wins for the profile on a portrait save.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePosterSave } from "@/lib/usePosterSave"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"
import { resolvePosterRenderConfig } from "@/lib/poster-config"

const noop = () => {}

// Full save deps (mirrors the hook's destructuring; undefined = unset).
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
    badgePresetId: null,
    badgePresetRev: null,
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

describe("landscape save preserves the portrait flat verbatim", () => {
  it("keeps concrete saved flats even when the landscape live value differs", async () => {
    const prev = mapping({ badgeStyle: "pill", badgeGenre: false, networkLogo: true })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgeStyle: "vetro",
      badgeGenre: true,
      networkLogo: false,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // Flat keeps the SAVED portrait look, not the landscape live edit.
    expect(posts[0].body.badgeStyle).toBe("pill")
    expect(posts[0].body.badgeGenre).toBe(false)
    expect(posts[0].body.networkLogo).toBe(true)
    // The landscape profile carries the live edit.
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("vetro")
    expect(land.badgeGenre).toBe(true)
    expect(land.networkLogo).toBe(false)
  })

  it("keeps a legacy null flat null instead of the landscape live value", async () => {
    const prev = mapping({ badgeFont: null, qualityBadgeStyle: null })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgeFont: "oswald",
      qualityBadgeStyle: "mono",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeFont).toBeNull()
    expect(posts[0].body.qualityBadgeStyle).toBeNull()
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeFont).toBe("oswald")
    expect(land.qualityBadgeStyle).toBe("mono")
  })

  it("keeps an absent legacy flat absent instead of the landscape live value", async () => {
    const prev = mapping({})
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgeStyle: "vetro",
      badgeGenre: false,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect("badgeStyle" in posts[0].body).toBe(false)
    expect("badgeGenre" in posts[0].body).toBe(false)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("vetro")
    expect(land.badgeGenre).toBe(false)
  })

  it("new-mapping landscape-first save leaves flats absent (inherit), profile live", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgeStyle: "vetro",
      badgeGenre: false,
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect("badgeStyle" in posts[0].body).toBe(false)
    expect("badgeGenre" in posts[0].body).toBe(false)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("vetro")
    expect(land.badgeGenre).toBe(false)
  })

  it("new-mapping landscape-first save with staged portrait edits freezes the stash as flat", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgeStyle: "vetro",
      badgeGenre: false,
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { badgeStyle: "pill", badgeGenre: true },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeStyle).toBe("pill")
    expect(posts[0].body.badgeGenre).toBe(true)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("vetro")
    expect(land.badgeGenre).toBe(false)
  })

  it("staged portrait edits win over stale saved flats on a landscape save", async () => {
    const prev = mapping({ badgeStyle: "pill", badgeGenre: false })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgeStyle: "vetro",
      badgeGenre: false,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { badgeStyle: "minimal" },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // The staged portrait edit (newer than the saved mapping) wins for flat;
    // untouched flats still preserve the saved value verbatim.
    expect(posts[0].body.badgeStyle).toBe("minimal")
    expect(posts[0].body.badgeGenre).toBe(false)
  })
})

describe("portrait save backfill freezes the chain-effective look", () => {
  it("freezes the noncanonical flat default, not the factory guess nor the new flat", async () => {
    const prev = mapping({})
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "pill",
      defaultBadgeStyle: "vetro",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeStyle).toBe("pill")
    const land = posts[0].body.landscape as Record<string, unknown>
    // Pre-edit landscape rendered the "vetro" default (chain), not the
    // factory "shadow" and not the new "pill" flat.
    expect(land.badgeStyle).toBe("vetro")
  })

  it("freezes a noncanonical toggle default for an absent legacy flat", async () => {
    const prev = mapping({})
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeGenre: true,
      defaultBadgeGenre: false,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeGenre).toBe(true)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeGenre).toBe(false)
  })

  it("freezes the landscape-defaults profile over the flat default", async () => {
    const prev = mapping({})
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "pill",
      defaultBadgeStyle: "vetro",
      landscapeDefaults: { badgeStyle: "colored" },
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const land = mappingPosts()[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("colored")
  })

  it("resolves showBadges through the globalBadges profile default name", async () => {
    const prev = mapping({})
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      globalBadges: false,
      defaultGlobalBadges: true,
      landscapeDefaults: { globalBadges: true },
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts[0].body.showBadges).toBe(false)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.showBadges).toBe(true)
  })

  it("resolves a null legacy inherit key through a noncanonical default", async () => {
    const prev = mapping({ badgeFont: null })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeFont: "barlow-condensed",
      defaultBadgeFont: "oswald",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts[0].body.badgeFont).toBe("barlow-condensed")
    const land = posts[0].body.landscape as Record<string, unknown>
    // Pre-edit landscape rendered "oswald" (chain), not factory "inter".
    expect(land.badgeFont).toBe("oswald")
  })

  it("keeps the profile sparse when the edit matches the chain look", async () => {
    const prev = mapping({})
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "vetro",
      defaultBadgeStyle: "vetro",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const land = mappingPosts()[0].body.landscape as Record<string, unknown> | null
    // Following the new flat renders the same pixels: no freeze needed.
    expect(land == null || !("badgeStyle" in land)).toBe(true)
  })

  it("still freezes a concrete saved flat verbatim when the edit moves it", async () => {
    const prev = mapping({ badgeStyle: "pill" })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "vetro",
      defaultBadgeStyle: "colored",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const land = mappingPosts()[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("pill")
  })

  it("mixed provenance: known defaults freeze chain, unknown keep legacy skip", async () => {
    const prev = mapping({})
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "pill",
      badgeGenre: true,
      // defaultBadgeStyle ("shadow", required dep) IS provenance: the
      // pre-edit chain look freezes even though no test passes anything else.
      // defaultBadgeGenre is absent: legacy skip preserved byte-identically.
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const land = mappingPosts()[0].body.landscape as Record<string, unknown> | null
    expect(land?.badgeStyle).toBe("shadow")
    expect(land == null || !("badgeGenre" in land)).toBe(true)
  })
})

describe("staged landscape edits survive a portrait save", () => {
  it("persists the landscape stash in the profile, live portrait in flat", async () => {
    const prev = mapping({ badgeStyle: "pill", badgeGenre: true })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "minimal",
      badgeGenre: false,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { badgeStyle: "vetro", badgeGenre: true },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeStyle).toBe("minimal")
    expect(posts[0].body.badgeGenre).toBe(false)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("vetro")
    expect(land.badgeGenre).toBe(true)
  })

  it("new-mapping portrait-first save with staged landscape edits owns both shapes", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "minimal",
      badgeGenre: false,
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { badgeStyle: "vetro", badgeGenre: true },
      })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeStyle).toBe("minimal")
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("vetro")
    expect(land.badgeGenre).toBe(true)
  })
})

describe("new-mapping portrait save preserves the landscape defaults look", () => {
  it("no prev mapping, portrait pill, landscape defaults vetro -> profile vetro", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "pill",
      defaultBadgeStyle: "shadow",
      landscapeDefaults: { badgeStyle: "vetro" },
      mappingsMap: new Map(),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeStyle).toBe("pill")
    const land = posts[0].body.landscape as Record<string, unknown>
    // Unvisited landscape would otherwise inherit the new pill flat and shadow
    // the vetro defaults: freeze the chain-effective look instead.
    expect(land.badgeStyle).toBe("vetro")
  })

  it("staged landscape edits still win over the chain on a new portrait save", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "pill",
      defaultBadgeStyle: "shadow",
      landscapeDefaults: { badgeStyle: "vetro" },
      mappingsMap: new Map(),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { badgeStyle: "colored" },
      })
    })
    const land = mappingPosts()[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("colored")
  })

  it("stays sparse when the new flat already matches the chain look", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgeStyle: "vetro",
      defaultBadgeStyle: "shadow",
      landscapeDefaults: { badgeStyle: "vetro" },
      mappingsMap: new Map(),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const land = mappingPosts()[0].body.landscape as Record<string, unknown> | null
    expect(land == null || !("badgeStyle" in land)).toBe(true)
  })
})

describe("save payload round-trips through validation with parsed keys", () => {
  it("landscape save → parse → effective mapping agrees per shape", async () => {
    const prev = mapping({ badgeStyle: "pill", badgeGenre: false })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgeStyle: "vetro",
      badgeGenre: false,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const body = mappingPosts()[0].body
    const parsed = mappingSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    // Parsed keys, not just success: the boundary survived validation.
    expect(parsed.data.badgeStyle).toBe("pill")
    expect(parsed.data.badgeGenre).toBe(false)
    expect(parsed.data.landscape?.badgeStyle).toBe("vetro")
    expect(parsed.data.landscape?.badgeGenre).toBe(false)
    const saved = parsed.data as unknown as Mapping
    // Storage level: each shape reads its own look (portrait = flat,
    // landscape = profile). The saved delivery shape is landscape, so an
    // unqualified render resolves landscape (delivery contract, unchanged).
    expect(effectiveMappingForShape(saved, "poster")?.badgeStyle).toBe("pill")
    expect(effectiveMappingForShape(saved, "landscape")?.badgeStyle).toBe("vetro")
    const landscape = resolvePosterRenderConfig({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      mapping: effectiveMappingForShape(saved, "landscape"),
      configOverride: null,
      sd: {},
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(landscape.badgeStyle).toBe("vetro")
    // Portrait delivery (portrait-saved title) still resolves the flat.
    const portraitSaved = mapping({ badgeStyle: "pill", posterShape: "poster" })
    const portrait = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(),
      mapping: effectiveMappingForShape(portraitSaved, "poster"),
      configOverride: null,
      sd: {},
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(portrait.badgeStyle).toBe("pill")
  })
})

describe("save boundary for customBadge/accent (per-shape visuals) + retired preset fields", () => {
  it("landscape save preserves the portrait flat verbatim, profile carries the live edit (preset fields verbatim)", async () => {
    const prev = mapping({
      customBadge: "Portrait pick",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { badgePresetId: "Landscap_01", badgePresetRev: "abcdef12" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      customBadge: "Landscape pick",
      accentColor: "#00ff00",
      autoAccentColor: "#111111",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // Flats keep the SAVED portrait look, never the landscape live edit.
    expect(posts[0].body.customBadge).toBe("Portrait pick")
    expect(posts[0].body.accentColor).toBe("#ff0000")
    expect(posts[0].body.badgePresetId).toBe("Abc123-_XyZ")
    expect(posts[0].body.badgePresetRev).toBe("deadbeef")
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.customBadge).toBe("Landscape pick")
    expect(land.accentColor).toBe("#00ff00")
    // Retired Lab fields: stored profile round-trips verbatim (no editor input).
    expect(land.badgePresetId).toBe("Landscap_01")
    expect(land.badgePresetRev).toBe("abcdef12")
  })

  it("landscape save with an automatic accent writes an explicit null profile, never a frozen auto", async () => {
    const prev = mapping({ accentColor: "#ff0000" })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      accentColor: "#123456",
      autoAccentColor: "#123456",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.accentColor).toBe("#ff0000")
    const land = posts[0].body.landscape as Record<string, unknown>
    // Automatic = explicit null (shadows the flat), never the auto string.
    expect(land.accentColor).toBeNull()
  })

  it("portrait save writes the live custom visuals and preserves stored preset fields verbatim", async () => {
    const prev = mapping({
      customBadge: "Old portrait",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { badgePresetId: "Landscap_01", badgePresetRev: "abcdef12" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      customBadge: "New portrait",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.customBadge).toBe("New portrait")
    // Retired Lab fields: no editor input exists, the stored values persist.
    expect(posts[0].body.badgePresetId).toBe("Abc123-_XyZ")
    expect(posts[0].body.badgePresetRev).toBe("deadbeef")
    // The unvisited landscape keeps the stored look verbatim.
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.customBadge).toBe("Old portrait")
    expect(land.badgePresetId).toBe("Landscap_01")
    expect(land.badgePresetRev).toBe("abcdef12")
  })

  it("portrait clear writes null to the flat only; the other shape keeps its look", async () => {
    const prev = mapping({
      customBadge: "Old portrait",
      accentColor: "#ff0000",
      landscape: { customBadge: "Old landscape", accentColor: "#00ff00" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      customBadge: null,
      accentColor: null,
      autoAccentColor: null,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // Explicit "no custom badge" clears ONLY the portrait target.
    expect(posts[0].body.customBadge).toBeNull()
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.customBadge).toBe("Old landscape")
    expect(land.accentColor).toBe("#00ff00")
  })

  it("landscape save → parse → effective mapping agrees per shape for the new visuals (preset fields verbatim)", async () => {
    const prev = mapping({
      customBadge: "Portrait pick",
      accentColor: "#ff0000",
      badgePresetId: "Abc123-_XyZ",
      badgePresetRev: "deadbeef",
      landscape: { badgePresetId: "Landscap_01", badgePresetRev: "abcdef12" },
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      customBadge: "Landscape pick",
      accentColor: "#00ff00",
      autoAccentColor: "#111111",
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const body = mappingPosts()[0].body
    const parsed = mappingSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const saved = parsed.data as unknown as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.customBadge).toBe("Portrait pick")
    expect(effectiveMappingForShape(saved, "poster")?.accentColor).toBe("#ff0000")
    expect(effectiveMappingForShape(saved, "landscape")?.customBadge).toBe("Landscape pick")
    expect(effectiveMappingForShape(saved, "landscape")?.accentColor).toBe("#00ff00")
    expect(effectiveMappingForShape(saved, "poster")?.badgePresetId).toBe("Abc123-_XyZ")
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresetId).toBe("Landscap_01")
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresetRev).toBe("abcdef12")
  })
})

describe("landscape custom base save boundary (customBackdropUrl)", () => {
  const LAND_URL = "https://i.imgur.com/land.jpg"
  const PORTRAIT_URL = "https://i.imgur.com/portrait.jpg"
  const tile = (file_path: string) => ({ file_path, iso_639_1: null, vote_average: 0, width: 500, height: 750 })

  it("landscape save freezes the landscape custom tile (split) and keeps the saved portrait custom", async () => {
    const prev = mapping({ posterPath: "/p.jpg", backdropPath: "/bd.jpg", customPosterUrl: PORTRAIT_URL })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      previewPoster: tile(PORTRAIT_URL),
      selectedBackdrop: tile(LAND_URL),
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.backdropPath).toBe("/bd.jpg")
    expect(posts[0].body.customBackdropUrl).toBe(LAND_URL)
    expect(posts[0].body.customPosterUrl).toBe(PORTRAIT_URL)
  })

  it("landscape save never rewrites the saved portrait custom from a divergent live tile", async () => {
    const prev = mapping({ posterPath: "/p.jpg", backdropPath: "/bd.jpg", customPosterUrl: PORTRAIT_URL })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      // Unsaved portrait edit (TMDB tile clicked, custom still live in preview
      // only until a portrait save): the landscape save must not freeze it.
      previewPoster: tile("/p-new.jpg"),
      selectedBackdrop: tile(LAND_URL),
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.customBackdropUrl).toBe(LAND_URL)
    expect(posts[0].body.customPosterUrl).toBe(PORTRAIT_URL)
  })

  it("new-mapping landscape save freezes a live portrait custom tile (no saved state to preserve)", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      previewPoster: tile(PORTRAIT_URL),
      selectedBackdrop: tile(LAND_URL),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.customPosterUrl).toBe(PORTRAIT_URL)
    expect(posts[0].body.customBackdropUrl).toBe(LAND_URL)
  })

  it("portrait save preserves the saved landscape custom verbatim", async () => {
    const prev = mapping({ posterPath: "/p.jpg", backdropPath: "/bd.jpg", customBackdropUrl: LAND_URL })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      previewPoster: tile("/p.jpg"),
      selectedBackdrop: tile("/bd.jpg"),
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.backdropPath).toBe("/bd.jpg")
    expect(posts[0].body.customBackdropUrl).toBe(LAND_URL)
  })

  it("landscape save with a TMDB backdrop clears the landscape custom (freezes shown state)", async () => {
    const prev = mapping({ posterPath: "/p.jpg", backdropPath: "/bd.jpg", customBackdropUrl: LAND_URL })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      previewPoster: tile("/p.jpg"),
      selectedBackdrop: tile("/bd2.jpg"),
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.backdropPath).toBe("/bd2.jpg")
    expect(posts[0].body.customBackdropUrl).toBeNull()
  })

  it("landscape save cleared to automatic clears the landscape custom", async () => {
    const prev = mapping({ posterPath: "/p.jpg", backdropPath: "/bd.jpg", customBackdropUrl: LAND_URL })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      previewPoster: tile("/p.jpg"),
      selectedBackdrop: null,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.backdropPath).toBeNull()
    expect(posts[0].body.customBackdropUrl).toBeNull()
  })
})
