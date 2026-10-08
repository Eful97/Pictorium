/**
 * Cover-only save ("Salva solo poster" / "Save poster only"): the POST body
 * carries ONLY the cover identity allowlist, so the full-replace upsert
 * clears any previously frozen custom styling and the title inherits the
 * global defaults again. Full-save (saveConfig) behavior is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, render } from "@testing-library/react"
import { usePosterSave } from "@/lib/usePosterSave"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import { logoDefaultScale } from "@/lib/logo-selection"
import { createWrapper } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

const noop = () => {}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
    selectedLogo: null,
    setSelectedLogo: noop,
    setPreviewPoster: noop,
    setPreviewId: noop,
    posters: [],
    metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5, imdb_id: "tt1234567", wikidata_id: "Q123" },
    imdbTop250: false,
    trendRank: 3,
    mdblistAnimeList: [],
    mappingsMap: new Map<string, Mapping>(),
    loadMappings: async () => {},
    logoScale: 80,
    logoOffsetX: 5,
    logoOffsetY: -5,
    selectedBackdrop: null,
    setSelectedBackdrop: noop,
    backdropScale: 120,
    backdropOffsetX: 10,
    backdropOffsetY: -10,
    setBackdropScale: noop,
    setBackdropOffsetX: noop,
    setBackdropOffsetY: noop,
    globalBadges: false,
    rankingBadges: true,
    badgeGenre: false,
    badgeYear: true,
    badgeRating: false,
    badgeQuality: true,
    customRatings: false,
    ratingSources: ["imdb"],
    separateRatings: true,
    separateRatingsStyle: "bottom-pills",
    customBadge: "Custom!",
    badgePresetId: "abcdef12",
    badgePresetRev: "12345678",
    badgeStyle: "pill",
    rankingBadgeStyle: "colored",
    extraBadgeStyle: "corner",
    badgeFont: "oswald",
    qualityBadgeStyle: "mono",
    videoFormats: ["dv", "atmos"],
    defaultBadgeStyle: "shadow",
    defaultRankingBadgeStyle: "default",
    defaultExtraBadgeStyle: null,
    blurEnabled: false,
    blurIntensity: 90,
    blurFade: 10,
    blurDarkness: 80,
    landscapeBlur: {
      gradientHeight: 60, blurIntensity: 90, blurFade: 10,
      blurDarkness: 80, tintStrength: 90, topShade: 90, blurEnabled: false,
    },
    landscapeBlurDirty: true,
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 90,
    topShade: 90,
    gradientHeight: 80,
    setGradientHeight: noop,
    setBlurFade: noop,
    topBadgeScale: 150,
    topBadgeOffsetX: 20,
    topBadgeOffsetY: -20,
    extraBadgeScale: 140,
    extraBadgeOffsetX: 10,
    extraBadgeOffsetY: -10,
    genreBadgeScale: 120,
    qualityBadgeScale: 130,
    separateBadgeScale: 150,
    separateBadgeOffsetX: 30,
    separateBadgeOffsetY: -30,
    networkLogoScale: 140,
    genreBadgeOffsetX: 11,
    genreBadgeOffsetY: -11,
    qualityBadgeOffsetX: 12,
    qualityBadgeOffsetY: -12,
    networkLogoOffsetX: 13,
    networkLogoOffsetY: -13,
    rotationPosters: ["/a.jpg", "/b.jpg"],
    autoRotateClean: true,
    defaultAutoRotateClean: false,
    excludedPosters: ["/x.jpg"],
    accentColor: "#ff0000",
    autoAccentColor: "#00ff00",
    logoDisabled: true,
    setLogoDisabled: noop,
    setLogoScale: noop,
    setLogoOffsetX: noop,
    setLogoOffsetY: noop,
    rotationBackdrops: ["/c.jpg", "/d.jpg"],
    autoRotateBackdrop: true,
    defaultAutoRotateBackdrop: false,
    excludedBackdrops: ["/y.jpg"],
    backdrops: [],
    networkLogo: false,
    networkLogoPosition: "top",
    networkLogoFollowTitle: false,
    ribbonEnabled: false,
    lang: "it",
    episodeGroupId: "ep42",
    posterShape: "poster",
    defaultSashOrder: null,
    ...overrides,
  } as never
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 7, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

/** Previously fully-saved styling that a cover-only save must clear. */
function frozenMapping(): Mapping {
  return mapping({
    posterPath: "/old.jpg",
    customPosterUrl: "https://cdn.example/x.jpg",
    logoPath: "/logo.png",
    logoDisabled: true,
    logoScale: 80,
    badgeStyle: "pill",
    rankingBadgeStyle: "colored",
    extraBadgeStyle: "corner",
    badgeFont: "oswald",
    qualityBadgeStyle: "mono",
    videoFormats: ["dv"],
    showBadges: false,
    rankingBadges: true,
    badgeGenre: false,
    badgeRating: false,
    customBadge: "Custom!",
    badgePresetId: "abcdef12",
    badgeExtra: "Festival",
    badgeRank: 3,
    badgeLabel: "Oggi",
    trendRank: 3,
    animeRank: 5,
    accentColor: "#ff0000",
    gradientHeight: 80,
    blurEnabled: false,
    topShade: 90,
    topBadgeScale: 150,
    extraBadgeScale: 140,
    defaultBadgeStyle: "pill",
    defaultRankingBadgeStyle: "colored",
    backdropPath: "/bd.jpg",
    backdropScale: 120,
    cleanPosters: ["/a.jpg", "/b.jpg"],
    cleanPosterIndex: 1,
    cleanPosterUpdatedAt: "2026-01-02",
    autoRotateClean: true,
    excludedPosters: ["/x.jpg"],
    cleanBackdrops: ["/c.jpg", "/d.jpg"],
    cleanBackdropIndex: 0,
    cleanBackdropUpdatedAt: "2026-01-03",
    autoRotateBackdrop: true,
    excludedBackdrops: ["/y.jpg"],
    networkLogo: false,
    networkLogoPosition: "top",
    ribbonEnabled: false,
    posterShape: "poster",
    landscape: { gradientHeight: 60, logoScale: 70 },
  })
}

let posted: { url: string; body: Record<string, unknown> }[]
let loadMappingsCalls = 0
beforeEach(() => {
  localStorage.clear()
  posted = []
  loadMappingsCalls = 0
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
    const body = (init as { body?: string })?.body
    posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true }), json: async () => ({ ok: true }) }
  }))
})

function coverPosts() {
  return posted.filter((p) => String(p.url).includes("/api/mappings"))
}

describe("buildCoverOnlyPayload allowlist", () => {
  it("portrait su titolo nuovo: solo cover + logo identity + metadati titolo (niente styling)", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: null,
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5, release_date: "2024-03-01", imdb_id: "tt1234567", wikidata_id: "Q123" },
      lang: "it",
      episodeGroupId: "ep42",
      posterShape: "poster",
    })
    expect(body).not.toBeNull()
    expect(Object.keys(body!).sort()).toEqual([
      "backdropPath", "customPosterUrl", "episodeGroupId", "firstAirDate", "genreName", "imdbId", "language", "logoPath",
      "mediaType", "originalPosterPath", "posterPath", "posterShape", "releaseDate", "title", "tmdbId", "tvStatus", "tvType", "voteAverage", "wikidataId",
    ])
    expect(body!.posterPath).toBe("/clean.jpg")
    expect(body!.customPosterUrl).toBeNull()
    expect(body!.originalPosterPath).toBe("/p.jpg")
    expect(body!.language).toBeNull()
    expect(body!.logoPath).toBeNull()
    expect(body!.posterShape).toBe("poster")
    expect(body!.backdropPath).toBeNull()
    // Title metadata identity survives (mapped branch renders ONLY from it).
    expect(body!.genreName).toBe("Dramma")
    expect(body!.voteAverage).toBe(7.5)
    expect(body!.releaseDate).toBe("2024-03-01")
  })

  it("salva il logo scelto senza congelarne le trasformazioni", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: { file_path: "/new-logo.png", iso_639_1: "en", vote_average: 0, width: 800, height: 200 },
      logoDisabled: false,
      prevMapping: frozenMapping(),
      metaInfo: {},
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(body!.logoPath).toBe("/new-logo.png")
    expect(body, "logoDisabled").not.toHaveProperty("logoDisabled")
    // Frozen logo transforms from the previous mapping are cleared.
    expect(body, "logoScale").not.toHaveProperty("logoScale")
    expect(body, "logoOffsetX").not.toHaveProperty("logoOffsetX")
    expect(body, "logoOffsetY").not.toHaveProperty("logoOffsetY")
  })

  it("salva la scelta no-logo intenzionale (disabled)", () => {
    const body = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: true,
      prevMapping: frozenMapping(),
      metaInfo: {},
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(body!.logoDisabled).toBe(true)
    expect(body!.logoPath).toBeNull()
  })

  it("non congela snapshot badge/rating/rank, accent, preset, stili, tuning o defaultBadgeStyles", () => {
    const prev = frozenMapping()
    const body = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: prev,
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5, release_date: "2024-03-01" },
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(body).not.toBeNull()
    // Previously frozen logo choice is cleared (null), no-logo flag absent.
    expect(body!.logoPath).toBeNull()
    expect(body, "logoDisabled").not.toHaveProperty("logoDisabled")
    for (const k of [
      "badgeExtra", "badgeRank", "badgeLabel", "trendRank", "trendPeriod", "animeRank",
      "logoScale", "logoOffsetX", "logoOffsetY",
      "accentColor", "customBadge", "badgePresetId", "badgePresetRev",
      "badgeStyle", "rankingBadgeStyle", "extraBadgeStyle", "badgeFont", "qualityBadgeStyle",
      "videoFormats", "defaultBadgeStyle", "defaultRankingBadgeStyle", "defaultExtraBadgeStyle",
      "showBadges", "rankingBadges", "badgeGenre", "badgeYear", "badgeRating", "badgeQuality",
      "customRatings", "ratingSources", "separateRatings", "separateRatingsStyle",
      "separateBadgeScale", "gradientHeight", "blurEnabled", "blurIntensity", "blurFade",
      "blurDarkness", "tintStrength", "topShade",
      "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY",
      "extraBadgeScale", "extraBadgeOffsetX", "extraBadgeOffsetY",
      "genreBadgeScale", "qualityBadgeScale", "networkLogoScale",
      "networkLogo", "networkLogoPosition", "networkLogoFollowTitle", "networkLogoPath", "networkLogoName",
      "ribbonEnabled", "ribbonSide",
      "backdropScale", "backdropOffsetX", "backdropOffsetY",
      "landscape",
      // Selected-format rotation: omitted = pinned (opt-out), never retained.
      "cleanPosters", "cleanPosterIndex", "cleanPosterUpdatedAt", "autoRotateClean",
    ]) {
      expect(body, k).not.toHaveProperty(k)
    }
    // Title metadata identity (NOT styling): mapped branch renders ONLY from
    // the mapping, so these must persist or Genre/Rating/Year blanks on Test URL.
    expect(body!.genreName).toBe("Dramma")
    expect(body!.voteAverage).toBe(7.5)
    expect(body!.releaseDate).toBe("2024-03-01")
    // Stable non-visual identity survives.
    expect(body!.imdbId).toBeNull()
    expect(body!.wikidataId).toBeNull()
    // Other-format image/rotation/exclusion preserved, poster exclusions kept.
    expect(body!.backdropPath).toBe("/bd.jpg")
    expect(body!.cleanBackdrops).toEqual(["/c.jpg", "/d.jpg"])
    expect(body!.autoRotateBackdrop).toBe(true)
    expect(body!.excludedBackdrops).toEqual(["/y.jpg"])
    expect(body!.excludedPosters).toEqual(["/x.jpg"])
  })
})

describe("saveCoverOnly hook", () => {
  it("portrait: POST minimale e reload mapping (stili live NON congelati)", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      loadMappings: async () => { loadMappingsCalls += 1 },
    })))
    let ok: unknown
    await act(async () => {
      ok = await result.current.saveCoverOnly()
    })
    expect(ok).toBe(true)
    expect(loadMappingsCalls).toBe(1)
    expect(coverPosts()).toHaveLength(1)
    const body = coverPosts()[0].body
    expect(body.posterPath).toBe("/clean.jpg")
    expect(body.customPosterUrl).toBeNull()
    expect(body.originalPosterPath).toBe("/p.jpg")
    expect(body.imdbId).toBe("tt1234567")
    expect(body.wikidataId).toBe("Q123")
    expect(body.episodeGroupId).toBe("ep42")
    expect(body.posterShape).toBe("poster")
    // Intentional no-logo choice persists (baseDeps logoDisabled: true).
    expect(body.logoDisabled).toBe(true)
    expect(body.logoPath).toBeNull()
    // Live editor styling (badge pill, logo 80, gradient 80, ...) is NOT frozen.
    for (const k of ["badgeStyle", "rankingBadgeStyle", "logoScale", "logoOffsetX", "gradientHeight", "landscape", "cleanPosters", "accentColor", "customBadge", "showBadges", "trendRank"]) {
      expect(body, k).not.toHaveProperty(k)
    }
  })

  it("salva il logo selezionato senza trasformazioni", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      selectedLogo: { file_path: "/chosen-logo.png", iso_639_1: "en", vote_average: 0, width: 800, height: 200 },
      logoDisabled: false,
    })))
    await act(async () => {
      await result.current.saveCoverOnly()
    })
    const body = coverPosts()[0].body
    expect(body.logoPath).toBe("/chosen-logo.png")
    expect(body, "logoDisabled").not.toHaveProperty("logoDisabled")
    expect(body, "logoScale").not.toHaveProperty("logoScale")
    expect(body, "logoOffsetX").not.toHaveProperty("logoOffsetX")
    expect(body, "logoOffsetY").not.toHaveProperty("logoOffsetY")
  })

  it("tile custom: customPosterUrl salvato con fallback TMDB; ritorno a TMDB lo azzera", async () => {
    const custom = renderHook(() => usePosterSave(baseDeps({
      previewPoster: { file_path: "https://cdn.example/x.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
    })))
    await act(async () => {
      await custom.result.current.saveCoverOnly()
    })
    const first = coverPosts()[0].body
    expect(first.customPosterUrl).toBe("https://cdn.example/x.jpg")
    expect(first.posterPath).toBe("/p.jpg")

    // Torna a un tile TMDB con custom salvato prima: custom azzerato.
    posted = []
    const prev = mapping({ posterPath: "/p.jpg", customPosterUrl: "https://cdn.example/x.jpg" })
    const back = renderHook(() => usePosterSave(baseDeps({
      mappingsMap: new Map([["movie:7", prev]]),
    })))
    await act(async () => {
      await back.result.current.saveCoverOnly()
    })
    const second = coverPosts()[0].body
    expect(second.posterPath).toBe("/clean.jpg")
    expect(second.customPosterUrl).toBeNull()
  })

  it("lingua presence-based: clean esplicito azzera 'en' salvato (anche custom)", () => {
    const prev = mapping({ posterPath: "/old.jpg", language: "en" })
    const clean = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: prev,
      metaInfo: {},
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(clean!.language).toBeNull()

    const custom = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "https://cdn.example/x.jpg", iso_639_1: null, vote_average: 0, width: 1000, height: 1500 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: prev,
      metaInfo: {},
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(custom!.language).toBeNull()
    expect(custom!.customPosterUrl).toBe("https://cdn.example/x.jpg")
  })

  it("landscape: preserva l'identità portrait salvata (mai preview unsaved)", async () => {
    const land = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      selectedBackdrop: { file_path: "/bd2.jpg", iso_639_1: null, vote_average: 0, width: 1280, height: 720 },
      mappingsMap: new Map([["movie:7", frozenMapping()]]),
    })))
    await act(async () => {
      await land.result.current.saveCoverOnly()
    })
    const body = coverPosts()[0].body
    expect(body.posterShape).toBe("landscape")
    expect(body.backdropPath).toBe("/bd2.jpg")
    // Strict other-format preservation: la preview unsaved (/clean.jpg) non
    // riscrive il portrait salvato (custom + fallback TMDB del save).
    expect(body.customPosterUrl).toBe("https://cdn.example/x.jpg")
    expect(body.posterPath).toBe("/p.jpg")
    // Backdrop rotation cleared (pinned), portrait rotation preserved.
    expect(body, "cleanBackdrops").not.toHaveProperty("cleanBackdrops")
    expect(body, "autoRotateBackdrop").not.toHaveProperty("autoRotateBackdrop")
    expect(body.cleanPosters).toEqual(["/a.jpg", "/b.jpg"])
    expect(body.autoRotateClean).toBe(true)
    expect(body, "landscape").not.toHaveProperty("landscape")

    // Senza portrait salvato: fallback dalla preview corrente.
    posted = []
    const fresh = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      selectedBackdrop: { file_path: "/bd2.jpg", iso_639_1: null, vote_average: 0, width: 1280, height: 720 },
    })))
    await act(async () => {
      await fresh.result.current.saveCoverOnly()
    })
    expect(coverPosts()[0].body.posterPath).toBe("/clean.jpg")

    // Sfondo deselezionato = null automatico, mai auto-pick nel save.
    posted = []
    const cleared = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      selectedBackdrop: null,
    })))
    await act(async () => {
      await cleared.result.current.saveCoverOnly()
    })
    expect(coverPosts()[0].body.backdropPath).toBeNull()
  })

  it("fallimento: false, niente reload, edit conservati (reset solo su successo)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 400, headers: { get: () => null }, text: async () => "bad", json: async () => ({}),
    })))
    const { result } = renderHook(() => usePosterSave(baseDeps({
      loadMappings: async () => { loadMappingsCalls += 1 },
    })))
    let ok: unknown = true
    await act(async () => {
      ok = await result.current.saveCoverOnly()
    })
    expect(ok).toBe(false)
    expect(loadMappingsCalls).toBe(0)
  })

  it("non-regressione: saveConfig congela ancora lo stile completo", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps()))
    await act(async () => {
      await result.current.saveConfig({ silent: true })
    })
    const body = coverPosts()[0].body
    expect(body.badgeStyle).toBe("pill")
    expect(body.logoScale).toBe(80)
    expect(body.gradientHeight).toBe(80)
    expect(body.customBadge).toBe("Custom!")
    expect(body.showBadges).toBe(false)
    expect(body.accentColor).toBe("#ff0000")
  })
})

describe("resetPerTitleVisuals", () => {
  const box: { ed: PosterEditorCtx | null } = { ed: null }
  function Probe() {
    box.ed = usePosterEditor()
    return null
  }

  it("riporta i visuali ai default globali senza toccare artwork, shape e default", async () => {
    localStorage.clear()
    render(<Probe />, { wrapper: createWrapper() })
    await act(async () => {})
    const defaultsBefore = {
      badgeStyle: box.ed!.defaultBadgeStyle,
      topBadgeScale: box.ed!.defaultTopBadgeScale,
      gradientHeight: box.ed!.defaultGradientHeight,
    }
    // Manual edits + prior preset-like changes.
    await act(async () => {
      box.ed!.setBadgeStyle("pill")
      box.ed!.setRankingBadgeStyle("colored")
      box.ed!.setCustomBadge("Custom!")
      box.ed!.setBadgePresetId("abcdef12")
      box.ed!.setTopBadgeScale(150)
      box.ed!.setExtraBadgeScale(140)
      box.ed!.setGradientHeight(80)
      box.ed!.setBlurEnabled(false)
      box.ed!.setLogoScale(80)
      box.ed!.setLogoDisabled(true)
      box.ed!.setBackdropScale(200)
      box.ed!.setGlobalBadges(false)
      box.ed!.setSeparateRatings(true)
      box.ed!.setVideoFormats(["dv"])
    })
    // Artwork + shape must survive the reset.
    const shapeBefore = box.ed!.posterShape
    await act(async () => {
      box.ed!.setSelectedBackdrop({ file_path: "/bd.jpg", iso_639_1: null, vote_average: 0, width: 1280, height: 720 })
    })
    await act(async () => {
      box.ed!.resetPerTitleVisuals({ width: 800, height: 200 })
    })
    const ed = box.ed!
    expect(ed.badgeStyle).toBe(ed.defaultBadgeStyle)
    expect(ed.rankingBadgeStyle).toBe(ed.defaultRankingBadgeStyle)
    expect(ed.customBadge).toBeNull()
    expect(ed.badgePresetId).toBeNull()
    expect(ed.badgePresetRev).toBeNull()
    expect(ed.topBadgeScale).toBe(ed.defaultTopBadgeScale)
    expect(ed.extraBadgeScale).toBe(ed.defaultExtraBadgeScale)
    expect(ed.gradientHeight).toBe(ed.defaultGradientHeight)
    expect(ed.blurEnabled).toBe(ed.defaultBlurEnabled)
    // Logo identity kept (cover-only freezes it): disabled choice preserved,
    // scale follows selectLogo parity (defaults, else auto-fit on kept logo).
    expect(ed.logoDisabled).toBe(true)
    expect(ed.logoScale).toBe(ed.defaultLogoScale ?? logoDefaultScale({ file_path: "/l.png", iso_639_1: "en", vote_average: 0, width: 800, height: 200 }) ?? 75)
    expect(ed.logoOffsetX).toBe(ed.defaultLogoOffsetX ?? 0)
    expect(ed.logoOffsetY).toBe(ed.defaultLogoOffsetY ?? 0)
    expect(ed.backdropScale).toBe(100)
    expect(ed.backdropOffsetX).toBe(0)
    expect(ed.backdropOffsetY).toBe(0)
    expect(ed.globalBadges).toBe(ed.defaultGlobalBadges)
    expect(ed.separateRatings).toBe(ed.defaultSeparateRatings)
    expect(ed.separateRatingsStyle).toBe(ed.defaultSeparateRatingsStyle)
    expect(ed.videoFormats).toEqual(ed.defaultVideoFormats)
    expect(ed.ratingSources).toEqual(ed.defaultRatingSources)
    expect(ed.landscapeBlurDirty).toBe(false)
    expect(ed.landscapeBlur.gradientHeight).toBe(ed.landscape?.gradientHeight ?? ed.defaultGradientHeight)
    // Preserved (not styling).
    expect(ed.posterShape).toBe(shapeBefore)
    expect(ed.selectedBackdrop?.file_path).toBe("/bd.jpg")
    // Global defaults untouched.
    expect(ed.defaultBadgeStyle).toBe(defaultsBefore.badgeStyle)
    expect(ed.defaultTopBadgeScale).toBe(defaultsBefore.topBadgeScale)
    expect(ed.defaultGradientHeight).toBe(defaultsBefore.gradientHeight)
  })

  it("landscape: reset usa i default effettivi di formato (profilo Orizzontale)", async () => {
    localStorage.clear()
    render(<Probe />, { wrapper: createWrapper() })
    await act(async () => {})
    // Distinct flat/landscape values + explicit extra/video defaults.
    await act(async () => {
      box.ed!.setDefaultTopBadgeScale(100)
      box.ed!.setDefaultGenreBadgeScale(100)
      box.ed!.setDefaultQualityBadgeScale(100)
      box.ed!.setDefaultSeparateBadgeScale(130)
      box.ed!.setDefaultNetworkLogoScale(100)
      box.ed!.setDefaultNetworkLogoOffsetX(0)
      box.ed!.setDefaultNetworkLogoOffsetY(0)
      box.ed!.setDefaultNetworkLogoFollowTitle(true)
      box.ed!.setDefaultSeparateRatingsStyle("column")
      box.ed!.setDefaultExtraBadgeScale(120)
      box.ed!.setDefaultExtraBadgeOffsetX(7)
      box.ed!.setDefaultExtraBadgeOffsetY(-7)
      box.ed!.setDefaultVideoFormats(["dv", "atmos"])
      box.ed!.setLandscape({
        topBadgeScale: 140,
        genreBadgeScale: 150,
        qualityBadgeScale: 160,
        separateBadgeScale: 170,
        separateRatingsStyle: "bottom-pills",
        networkLogoScale: 180,
        extraBadgeScale: 125,
        extraBadgeOffsetX: 9,
        extraBadgeOffsetY: -9,
        videoFormats: ["hdr"],
      })
      box.ed!.setPosterShape("landscape")
      // Dirty live values that the reset must overwrite.
      box.ed!.setTopBadgeScale(10)
      box.ed!.setExtraBadgeScale(11)
      box.ed!.setVideoFormats(["imax"])
      box.ed!.setSeparateRatingsStyle("column")
      box.ed!.setNetworkLogoScale(10)
    })
    await act(async () => {
      box.ed!.resetPerTitleVisuals({ width: 800, height: 200 })
    })
    const ed = box.ed!
    // Preview params = effective landscape profile (mai flat grezzi).
    expect(ed.topBadgeScale).toBe(140)
    expect(ed.genreBadgeScale).toBe(150)
    expect(ed.qualityBadgeScale).toBe(160)
    expect(ed.separateBadgeScale).toBe(170)
    expect(ed.separateRatingsStyle).toBe("bottom-pills")
    expect(ed.networkLogoScale).toBe(180)
    // Explicit extra/video from the effective profile (mai sempre-null).
    expect(ed.extraBadgeScale).toBe(125)
    expect(ed.extraBadgeOffsetX).toBe(9)
    expect(ed.extraBadgeOffsetY).toBe(-9)
    expect(ed.videoFormats).toEqual(["hdr"])
    // Effective saved config parity: a cover-only mapping (no frozen style)
    // resolves through the same effective defaults server-side.
    const { effectiveDefaultsForShape } = await import("@/lib/server-defaults")
    const sd = {
      topBadgeScale: ed.defaultTopBadgeScale,
      genreBadgeScale: ed.defaultGenreBadgeScale,
      qualityBadgeScale: ed.defaultQualityBadgeScale,
      separateBadgeScale: ed.defaultSeparateBadgeScale,
      separateRatingsStyle: ed.defaultSeparateRatingsStyle,
      networkLogoScale: ed.defaultNetworkLogoScale,
      extraBadgeScale: ed.defaultExtraBadgeScale,
      extraBadgeOffsetX: ed.defaultExtraBadgeOffsetX,
      extraBadgeOffsetY: ed.defaultExtraBadgeOffsetY,
      videoFormats: ed.defaultVideoFormats,
      landscape: ed.landscape,
    }
    const eff = effectiveDefaultsForShape(sd, "landscape")
    expect(ed.topBadgeScale).toBe(eff.topBadgeScale)
    expect(ed.extraBadgeScale).toBe(eff.extraBadgeScale)
    expect(ed.videoFormats).toEqual(eff.videoFormats)
  })

  it("landscape fixed-flat: reset non leakka assoluti portrait (follow effettivo)", async () => {
    localStorage.clear()
    render(<Probe />, { wrapper: createWrapper() })
    await act(async () => {})
    await act(async () => {
      box.ed!.setDefaultNetworkLogoFollowTitle(false)
      box.ed!.setDefaultNetworkLogoOffsetX(111)
      box.ed!.setDefaultNetworkLogoOffsetY(222)
      box.ed!.setPosterShape("landscape")
      box.ed!.setNetworkLogoOffsetX(999)
      box.ed!.setNetworkLogoOffsetY(999)
    })
    await act(async () => {
      box.ed!.resetPerTitleVisuals(null)
    })
    const ed = box.ed!
    // Portrait fixed layer never leaks absolutes into landscape: effective
    // view without fixed coords reads follow ON with relative 0,0.
    expect(ed.networkLogoFollowTitle).toBe(true)
    expect(ed.networkLogoOffsetX).toBe(0)
    expect(ed.networkLogoOffsetY).toBe(0)
  })

  it("success reconciliation: rotazioni/esclusioni e artwork riallineati al salvato", async () => {
    localStorage.clear()
    render(<Probe />, { wrapper: createWrapper() })
    await act(async () => {})
    // Live dirty: portrait rotation + unsaved backdrop (portrait save
    // preserves the SAVED backdrop, ignores this unsaved one).
    await act(async () => {
      box.ed!.setRotationPosters(["/a.jpg", "/b.jpg"])
      box.ed!.setAutoRotateClean(true)
      box.ed!.setExcludedPosters(["/x.jpg"])
      box.ed!.setRotationBackdrops(["/live-bd.jpg"])
      box.ed!.setAutoRotateBackdrop(true)
      box.ed!.setExcludedBackdrops(["/live-y.jpg"])
      box.ed!.setSelectedBackdrop({ file_path: "/bd-unsaved.jpg", iso_639_1: null, vote_average: 0, width: 1280, height: 720 })
    })
    const prev = mapping({
      posterPath: "/old.jpg",
      backdropPath: "/bd-saved.jpg",
      cleanBackdrops: ["/c.jpg", "/d.jpg"],
      autoRotateBackdrop: true,
      excludedBackdrops: ["/y.jpg"],
      excludedPosters: ["/x.jpg"],
    })
    // Payload portrait: pinned (no cleanPosters/auto), backdrop/exclusions
    // from the SAVED mapping (mai live unsaved).
    const body = buildCoverOnlyPayload({
      selected: { id: 7, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 500, height: 750 },
      selectedBackdrop: box.ed!.selectedBackdrop,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: prev,
      metaInfo: {},
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(body!.backdropPath).toBe("/bd-saved.jpg")
    expect(body, "cleanPosters").not.toHaveProperty("cleanPosters")
    // Simulated success reconciliation (same as the saveCoverOnly wrapper):
    // selected format cleared, other format + exclusions from saved,
    // artwork reverted to the saved identity.
    await act(async () => {
      box.ed!.setRotationPosters([])
      box.ed!.setAutoRotateClean(false)
      box.ed!.setRotationBackdrops(prev.cleanBackdrops ?? [])
      box.ed!.setAutoRotateBackdrop(prev.autoRotateBackdrop ?? false)
      box.ed!.setExcludedPosters(prev.excludedPosters ?? [])
      box.ed!.setExcludedBackdrops(prev.excludedBackdrops ?? [])
      box.ed!.setSelectedBackdrop({ file_path: prev.backdropPath!, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
      box.ed!.resetPerTitleVisuals(null)
    })
    const ed = box.ed!
    expect(ed.rotationPosters).toEqual([])
    expect(ed.autoRotateClean).toBe(false)
    expect(ed.rotationBackdrops).toEqual(["/c.jpg", "/d.jpg"])
    expect(ed.autoRotateBackdrop).toBe(true)
    expect(ed.excludedBackdrops).toEqual(["/y.jpg"])
    expect(ed.selectedBackdrop?.file_path).toBe("/bd-saved.jpg")
  })
})
