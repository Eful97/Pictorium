/**
 * Save round-trip reale della scala separati: il payload POST /api/mappings
 * congela `separateBadgeScale` (flat + profilo landscape preservato) e i
 * default globali fanno load/save via localStorage + PUT /api/defaults.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { render } from "@testing-library/react"
import { usePosterSave } from "@/lib/usePosterSave"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { saveDefaults } from "@/lib/save-defaults"
import { createWrapper } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

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
    logoScale: null,
    logoOffsetX: null,
    logoOffsetY: null,
    selectedBackdrop: null,
    setSelectedBackdrop: noop,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    setBackdropScale: noop,
    setBackdropOffsetX: noop,
    setBackdropOffsetY: noop,
    globalBadges: true,
    rankingBadges: false,
    badgeGenre: true,
    badgeYear: false,
    badgeRating: true,
    badgeQuality: false,
    customRatings: true,
    ratingSources: ["imdb", "tmdb"],
    separateRatings: true,
    customBadge: null,
    badgeStyle: "shadow",
    rankingBadgeStyle: "default",
    badgeFont: "inter",
    qualityBadgeStyle: "standard",
    defaultBadgeStyle: "shadow",
    defaultRankingBadgeStyle: "default",
    blurEnabled: true,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    landscapeBlur: {
      gradientHeight: 30, blurIntensity: 20, blurFade: 70,
      blurDarkness: 30, tintStrength: 20, topShade: 50, blurEnabled: true,
    },
    landscapeBlurDirty: false,
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 20,
    topShade: 50,
    gradientHeight: 30,
    setGradientHeight: noop,
    setBlurFade: noop,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    separateBadgeScale: 150,
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
    rotationBackdrops: [],
    autoRotateBackdrop: false,
    defaultAutoRotateBackdrop: false,
    excludedBackdrops: [],
    backdrops: [],
    networkLogo: true,
    networkLogoPosition: "auto",
    ribbonEnabled: true,
    lang: "it",
    posterShape: "poster",
    ...overrides,
  } as never
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

describe("defaults load/save separateBadgeScale", () => {
  it("carica il default da storage e lo riscrive in localStorage + PUT", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSeparateBadgeScale: 140 }))
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(<Probe />, { wrapper: createWrapper() })
    await act(async () => {})
    expect(box.ed?.defaultSeparateBadgeScale).toBe(140)
    expect(box.ed?.separateBadgeScale).toBe(140)
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}")
    expect(stored.separateBadgeScale).toBe(140)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts.length).toBeGreaterThan(0)
    expect(puts[puts.length - 1].body.separateBadgeScale).toBe(140)
  })
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

describe("usePosterSave + saveDefaults separateBadgeOffsetX/Y", () => {
  it("portrait: congela gli offset flat per-titolo", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      separateBadgeOffsetX: 40, separateBadgeOffsetY: -30,
    })))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    expect(mappings[0].body.separateBadgeOffsetX).toBe(40)
    expect(mappings[0].body.separateBadgeOffsetY).toBe(-30)
  })

  it("landscape: scrive il profilo offset e lo preserva in portrait", async () => {
    const land = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape", separateBadgeOffsetX: 25, separateBadgeOffsetY: -15,
    })))
    await act(async () => {
      await land.result.current.saveConfig({ silent: true })
    })
    const landPost = posted.filter((p) => String(p.url).includes("/api/mappings"))[0]
    const landProfile = landPost.body.landscape as Record<string, unknown>
    expect(landProfile.separateBadgeOffsetX).toBe(25)
    expect(landProfile.separateBadgeOffsetY).toBe(-15)

    // Save portrait con profilo esistente: flat aggiornati, landscape preservato.
    posted = []
    const prev = mapping({
      separateBadgeOffsetX: 1, separateBadgeOffsetY: 2,
      landscape: { separateBadgeOffsetX: 25, separateBadgeOffsetY: -15 },
    })
    const port = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      separateBadgeOffsetX: 40, separateBadgeOffsetY: -30,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await port.result.current.saveConfig({ silent: true })
    })
    const portPost = posted.filter((p) => String(p.url).includes("/api/mappings"))[0]
    expect(portPost.body.separateBadgeOffsetX).toBe(40)
    expect(portPost.body.separateBadgeOffsetY).toBe(-30)
    const kept = portPost.body.landscape as Record<string, unknown>
    expect(kept.separateBadgeOffsetX).toBe(25)
    expect(kept.separateBadgeOffsetY).toBe(-15)
  })

  it("saveDefaults: PUT /api/defaults con gli offset globali", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSeparateBadgeOffsetX: 12, defaultSeparateBadgeOffsetY: -8 }))
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(<Probe />, { wrapper: createWrapper() })
    await act(async () => {})
    expect(box.ed?.defaultSeparateBadgeOffsetX).toBe(12)
    expect(box.ed?.defaultSeparateBadgeOffsetY).toBe(-8)
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}")
    expect(stored.separateBadgeOffsetX).toBe(12)
    expect(stored.separateBadgeOffsetY).toBe(-8)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts.length).toBeGreaterThan(0)
    expect(puts[puts.length - 1].body.separateBadgeOffsetX).toBe(12)
    expect(puts[puts.length - 1].body.separateBadgeOffsetY).toBe(-8)
  })
})

describe("usePosterSave separateBadgeScale", () => {
  it("portrait: congela il flat per-titolo", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps()))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    expect(mappings[0].body.separateBadgeScale).toBe(150)
  })

  it("landscape: scrive il profilo e preserva quello esistente in portrait", async () => {
    // Save landscape: profilo con la scala corrente.
    const land = renderHook(() => usePosterSave(baseDeps({ posterShape: "landscape" })))
    await act(async () => {
      await land.result.current.saveConfig({ silent: true })
    })
    const landPost = posted.filter((p) => String(p.url).includes("/api/mappings"))[0]
    expect((landPost.body.landscape as Record<string, unknown>).separateBadgeScale).toBe(150)

    // Save portrait con profilo esistente: flat aggiornato, landscape preservato.
    posted = []
    const prev = mapping({ separateBadgeScale: 120, landscape: { separateBadgeScale: 130 } })
    const port = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      separateBadgeScale: 150,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await port.result.current.saveConfig({ silent: true })
    })
    const portPost = posted.filter((p) => String(p.url).includes("/api/mappings"))[0]
    expect(portPost.body.separateBadgeScale).toBe(150)
    expect((portPost.body.landscape as Record<string, unknown>).separateBadgeScale).toBe(130)
  })
})
