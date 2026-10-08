/**
 * Per-title preset action (task 1, no UI yet):
 * `applyPerTitleVisualPreset` on the real PosterEditorProvider applies a
 * built-in/saved snapshot to the CURRENT title only, in the shape in
 * editing — defaults/global state untouched, opposite gradient and
 * artwork/Badge Lab binding preserved, legacy `applyVisualPreset`
 * behavior intact. The applied bare fields then freeze through the
 * unchanged save path (POST /api/mappings).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, renderHook } from "@testing-library/react"
import { createElement } from "react"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { usePosterSave } from "@/lib/usePosterSave"
import {
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import { captureVisualPreset, type VisualPresetValues } from "@/lib/visual-presets"
import { createWrapper } from "@/__tests__/test-utils"
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

async function settled(box: { ed: PosterEditorCtx | null }) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
  if (!box.ed) throw new Error("editor context not mounted")
  return box.ed as PosterEditorCtx
}

function defaultsSnapshot(ed: PosterEditorCtx): Record<string, unknown> {
  const snap: Record<string, unknown> = {}
  for (const key of Object.keys(ed) as (keyof PosterEditorCtx)[]) {
    if (key.startsWith("default") || key === "landscape") snap[key as string] = ed[key]
  }
  return snap
}

describe("applyPerTitleVisualPreset portrait", () => {
  it("updates active title visuals incl. logo + active gradient; defaults/opposite gradient/shape/artwork untouched", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    const defaultsBefore = defaultsSnapshot(ed)
    const storageBefore = localStorage.getItem("badgeDefaults")
    // Divergent live title state: must be overwritten / preserved correctly.
    await act(async () => {
      ed.setPosterShape("poster")
      ed.setLogoAlign("left")
      ed.setLogoScale(150)
      ed.setExtraBadgeScale(120)
      ed.setExtraBadgeStyle("corner")
      ed.setCustomBadge("LAB-X")
      ed.setRatingSources(["imdb", "trakt"])
    })
    ed = box.ed as PosterEditorCtx
    await act(async () => {
      ed.applyPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS)
    })
    ed = box.ed as PosterEditorCtx
    // Active title visuals from the snapshot.
    expect(ed.badgeStyle).toBe("minimal")
    expect(ed.rankingBadgeStyle).toBe("number")
    expect(ed.badgeYear).toBe(false)
    expect(ed.qualityBadgeStyle).toBe("knockout")
    expect(ed.topBadgeScale).toBe(100)
    expect(ed.genreBadgeOffsetY).toBe(-40)
    // Logo transforms via local state (explicit offset; null scale = auto-fit
    // request: divergent 150 replaced, absent logo falls back to 75).
    expect(ed.logoOffsetY).toBe(-40)
    expect(ed.logoScale).toBe(75)
    // Active-shape (portrait) gradient from the flat.
    expect(ed.gradientHeight).toBe(50)
    expect(ed.blurFade).toBe(50)
    expect(ed.tintStrength).toBe(0)
    // Legacy extra axes cleared to null (was 120).
    expect(ed.extraBadgeScale).toBeNull()
    expect(ed.extraBadgeOffsetX).toBeNull()
    expect(ed.extraBadgeOffsetY).toBeNull()
    // extraBadgeStyle audit: no flat source -> preserved, never reset.
    expect(ed.extraBadgeStyle).toBe("corner")
    // Global-only / shared / binding state preserved.
    expect(ed.ratingSources).toEqual(["imdb", "trakt"])
    expect(ed.logoAlign).toBe("left")
    expect(ed.customBadge).toBe("LAB-X")
    expect(ed.posterShape).toBe("poster")
    // Opposite (landscape) gradient profile untouched + not dirty.
    expect(ed.landscapeBlur.gradientHeight).toBe(30)
    expect(ed.landscapeBlur.blurFade).toBe(70)
    expect(ed.landscapeBlurDirty).toBe(false)
    // No default* or landscape-default writes, no defaults autosave.
    expect(defaultsSnapshot(ed)).toEqual(defaultsBefore)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(localStorage.getItem("badgeDefaults")).toBe(storageBefore)
  })

  it("portrait ignores a landscape-only extraBadgeStyle in the snapshot", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setExtraBadgeStyle("corner")
    })
    const values = captureVisualPreset({
      ...APPLE_VISUAL_DEFAULTS,
      landscape: { ...APPLE_VISUAL_DEFAULTS.landscape, extraBadgeStyle: "vetro" },
    } as unknown as VisualPresetValues)
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(values)
    })
    ed = box.ed as PosterEditorCtx
    expect(ed.extraBadgeStyle).toBe("corner")
  })

  it("portrait null scale resolves auto-fit from the current logo aspect (not the live scale)", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setPosterShape("poster")
      ed.setLogoScale(150)
    })
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, { width: 800, height: 400 })
    })
    ed = box.ed as PosterEditorCtx
    // 2:1 wordmark auto-fit = 60 (single source logoDefaultScale), never 150.
    expect(ed.logoScale).toBe(60)
  })

  it("explicit portrait scale stays exact regardless of the logo", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setPosterShape("poster")
      ed.setLogoScale(150)
    })
    const values = captureVisualPreset({
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultLogoScale: 90,
    } as unknown as VisualPresetValues)
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(values, { width: 800, height: 400 })
    })
    ed = box.ed as PosterEditorCtx
    expect(ed.logoScale).toBe(90)
  })

  it("undefined portrait scale preserves the live value", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setPosterShape("poster")
      ed.setLogoScale(150)
    })
    const values = {
      ...BETTER_POSTER_VISUAL_DEFAULTS,
      defaultLogoScale: undefined,
    } as unknown as VisualPresetValues
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(values, { width: 800, height: 400 })
    })
    ed = box.ed as PosterEditorCtx
    expect(ed.logoScale).toBe(150)
  })

  it("legacy applyVisualPreset still writes defaults (behavior intact)", async () => {
    const box = renderProbe()
    const ed = await settled(box)
    await act(async () => {
      ed.applyVisualPreset(BETTER_POSTER_VISUAL_DEFAULTS, "portrait")
    })
    // Legacy path writes the global defaults …
    expect((box.ed as PosterEditorCtx).defaultBadgeStyle).toBe("minimal")
    // … and leaves the per-title logo local state alone.
    expect((box.ed as PosterEditorCtx).logoOffsetY).toBe(0)
  })
})

describe("applyPerTitleVisualPreset landscape", () => {
  it("updates effective landscape visuals + landscapeBlur dirty; portrait flats/defaults untouched", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setPosterShape("landscape")
    })
    ed = box.ed as PosterEditorCtx
    const defaultsBefore = defaultsSnapshot(ed)
    const portraitGradientBefore = ed.gradientHeight
    await act(async () => {
      ed.setLogoOffsetY(7)
      ed.setLogoScale(150)
      ed.setExtraBadgeStyle("corner")
    })
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS)
    })
    ed = box.ed as PosterEditorCtx
    // Effective landscape values (profile wins over flat).
    expect(ed.genreBadgeOffsetY).toBe(0)
    expect(ed.qualityBadgeStyle).toBe("color")
    expect(ed.rankingBadgeStyle).toBe("number")
    // Explicit profile null logo offset = 0 (flat -40 must not leak).
    expect(ed.logoOffsetY).toBe(0)
    // Null landscape scale = auto-fit request: divergent 150 replaced,
    // absent logo falls back to 75.
    expect(ed.logoScale).toBe(75)
    // Active-shape gradient via the local profile state + dirty flag.
    expect(ed.landscapeBlur.gradientHeight).toBe(50)
    expect(ed.landscapeBlur.blurFade).toBe(100)
    expect(ed.landscapeBlur.tintStrength).toBe(0)
    expect(ed.landscapeBlurDirty).toBe(true)
    // Opposite (portrait) gradient + defaults untouched.
    expect(ed.gradientHeight).toBe(portraitGradientBefore)
    expect(ed.posterShape).toBe("landscape")
    expect(defaultsSnapshot(ed)).toEqual(defaultsBefore)
  })

  it("landscape applies an explicit effective extraBadgeStyle", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setPosterShape("landscape")
    })
    const values = captureVisualPreset({
      ...APPLE_VISUAL_DEFAULTS,
      landscape: { ...APPLE_VISUAL_DEFAULTS.landscape, extraBadgeStyle: "vetro" },
    } as unknown as VisualPresetValues)
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(values)
    })
    ed = box.ed as PosterEditorCtx
    expect(ed.extraBadgeStyle).toBe("vetro")
  })

  it("landscape null scale resolves auto-fit from the current logo aspect", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setPosterShape("landscape")
      ed.setLogoScale(150)
    })
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS, { width: 400, height: 400 })
    })
    ed = box.ed as PosterEditorCtx
    // 1:1 logo auto-fit = 38 (single source logoDefaultScale), never 150.
    expect(ed.logoScale).toBe(38)
  })
})

describe("applied per-title values freeze through the unchanged save path", () => {
  it("POST /api/mappings carries the applied visuals (no save contract change)", async () => {
    const box = renderProbe()
    let ed = await settled(box)
    await act(async () => {
      ed.setExtraBadgeStyle("corner")
    })
    await act(async () => {
      ;(box.ed as PosterEditorCtx).applyPerTitleVisualPreset(APPLE_VISUAL_DEFAULTS)
    })
    ed = box.ed as PosterEditorCtx
    const live = { ...ed }
    const { result } = renderHook(() => usePosterSave({
      ...live,
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
      selectedBackdrop: null,
      setSelectedBackdrop: noop,
      lang: "it",
    } as never))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    const body = mappings[0].body
    expect(body.badgeStyle).toBe("minimal")
    expect(body.rankingBadgeStyle).toBe("number")
    expect(body.qualityBadgeStyle).toBe("knockout")
    expect(body.gradientHeight).toBe(50)
    expect(body.logoOffsetY).toBe(-40)
    expect(body.extraBadgeStyle).toBe("corner")
    expect(body.genreBadgeOffsetY).toBe(-40)
  })
})
