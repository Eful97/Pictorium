/**
 * Client state + persistence wiring for extraBadgeStyle (no UI yet):
 * useDefaults load (local/server), saveDefaults PUT payload, usePosterSave
 * mapping payload, DefaultsPosterPreview xbs emission, preset preservation.
 * Absent configs stay null (legacy, no silent migration); changing `rs`
 * never touches the independent extra style.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, renderHook } from "@testing-library/react"
import { createElement } from "react"
import { usePosterSave } from "@/lib/usePosterSave"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { saveDefaults } from "@/lib/save-defaults"
import { mappingSchema } from "@/lib/validation"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"
import type { Mapping } from "@/lib/types"

const noop = () => {}

let posted: { url: string; body: Record<string, unknown> }[]
beforeEach(() => {
  posted = []
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
    const body = (init as { body?: string })?.body
    posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
  }))
  vi.useFakeTimers()
})

function renderProbe() {
  const box: { ed: PosterEditorCtx | null } = { ed: null }
  function Probe() {
    box.ed = usePosterEditor()
    return null
  }
  render(createElement(Probe), { wrapper: createWrapper() })
  return box
}

function saveDeps(overrides: Record<string, unknown> = {}) {
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
    separateBadgeScale: 130,
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

describe("extraBadgeStyle state load", () => {
  it("loads default + current from local storage", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultExtraBadgeStyle: "corner", extraBadgeStyle: "pill" }))
    const box = renderProbe()
    await act(async () => {})
    expect(box.ed?.defaultExtraBadgeStyle).toBe("corner")
    expect(box.ed?.extraBadgeStyle).toBe("pill")
  })

  it("absent configs stay null (legacy, no silent migration)", async () => {
    const box = renderProbe()
    await act(async () => {})
    expect(box.ed?.defaultExtraBadgeStyle).toBeNull()
    expect(box.ed?.extraBadgeStyle).toBeNull()
  })

  it("invalid stored values fall back to null, never break", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultExtraBadgeStyle: "netflix", extraBadgeStyle: "zzz" }))
    const box = renderProbe()
    await act(async () => {})
    expect(box.ed?.defaultExtraBadgeStyle).toBeNull()
    expect(box.ed?.extraBadgeStyle).toBeNull()
  })
})

describe("extraBadgeStyle defaults save payload", () => {
  it("setDefaultExtraBadgeStyle persists to localStorage + PUT /api/defaults", async () => {
    const box = renderProbe()
    await act(async () => {})
    await act(async () => {
      box.ed?.setDefaultExtraBadgeStyle("vetro")
    })
    expect(JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}").extraBadgeStyle).toBe("vetro")
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts.length).toBeGreaterThan(0)
    expect(puts[puts.length - 1].body.extraBadgeStyle).toBe("vetro")
  })

  it("T3 landscape visual keys pass PUT/storage without stripping", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ landscape: { badgeStyle: "pill", globalBadges: false } }))
    const box = renderProbe()
    await act(async () => {})
    expect(box.ed?.landscape).toMatchObject({ badgeStyle: "pill", globalBadges: false })
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts[puts.length - 1].body.landscape).toMatchObject({ badgeStyle: "pill", globalBadges: false })
  })
})

describe("extraBadgeStyle mapping save payload", () => {
  it("saveConfig freezes per-title extra + default in POST /api/mappings", async () => {
    const { result } = renderHook(() => usePosterSave(saveDeps({ extraBadgeStyle: "corner", defaultExtraBadgeStyle: "vetro" })))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    expect(mappings[0].body.extraBadgeStyle).toBe("corner")
    expect(mappings[0].body.defaultExtraBadgeStyle).toBe("vetro")
  })

  it("mappingSchema accepts the field, rejects garbage", () => {
    const base = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" }
    expect(mappingSchema.safeParse({ ...base, extraBadgeStyle: "corner" }).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, extraBadgeStyle: "netflix" }).success).toBe(false)
    expect(mappingSchema.safeParse({ ...base, defaultExtraBadgeStyle: null }).success).toBe(true)
  })
})

describe("extraBadgeStyle preview emission", () => {
  const opened: string[] = []
  beforeEach(() => {
    opened.length = 0
    class FakeXHR {
      onload: (() => void) | null = null
      responseType = ""
      timeout = 0
      status = 0
      response: unknown = null
      open(_method: string, url: string) {
        opened.push(String(url))
      }
      send() {}
      abort() {}
      setRequestHeader() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
    vi.useFakeTimers()
  })

  it("defaults preview emits xbs only when the default is set", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultExtraBadgeStyle: "corner" }))
    renderWithCtx(createElement(DefaultsPosterPreview, { previewShape: "portrait" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(opened.length).toBeGreaterThan(0)
    expect(new URL(opened[opened.length - 1]).searchParams.get("xbs")).toBe("corner")
  })

  it("absent default emits no xbs (legacy URL unchanged)", async () => {
    renderWithCtx(createElement(DefaultsPosterPreview, { previewShape: "portrait" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(opened.length).toBeGreaterThan(0)
    expect(new URL(opened[opened.length - 1]).searchParams.has("xbs")).toBe(false)
  })
})

describe("extraBadgeStyle independence", () => {
  it("changing rs never touches extra; presets without the key preserve it", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultExtraBadgeStyle: "corner", extraBadgeStyle: "pill" }))
    const box = renderProbe()
    await act(async () => {})
    await act(async () => {
      box.ed?.setRankingBadgeStyle("pill")
      box.ed?.setDefaultRankingBadgeStyle("colored")
    })
    expect(box.ed?.extraBadgeStyle).toBe("pill")
    expect(box.ed?.defaultExtraBadgeStyle).toBe("corner")
    await act(async () => {
      box.ed?.applyVisualPreset({ defaultBadgeStyle: "pill" } as never)
    })
    expect(box.ed?.extraBadgeStyle).toBe("pill")
    expect(box.ed?.defaultExtraBadgeStyle).toBe("corner")
  })
})
