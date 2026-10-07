/**
 * Split CLASSIFICA vs EXTRA: state/UI/save-flow (B2).
 *
 * - rank-first (slider/dblclick/reset, ogni asse) materializes the previous
 *   independent extra BEFORE the rank change; extra is then untouched;
 * - extra-first never touches the classifica;
 * - resets are independent (extra reset = back to null/follow);
 * - reload hydrates both; portrait/landscape targets stay isolated;
 * - mapping save + defaults save carry the extra tuning;
 * - dirty tracking covers extra tuning and the N3 follow flag.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import { createElement, useEffect, type ReactNode } from "react"
import { TransformControls } from "@/components/TransformControls"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { renderWithCtx, createWrapper } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { PictoriumRoot, useP } from "@/lib/context"
import { usePosterFit } from "@/lib/usePosterFit"
import type { SearchResult, TMDBImage } from "@/lib/types"

vi.mock("@/lib/usePosterFit", () => ({ usePosterFit: vi.fn() }))
vi.mocked(usePosterFit).mockReturnValue({ bestFitPath: null, results: [], loading: false, error: null })
import { usePosterSave } from "@/lib/usePosterSave"
import { saveDefaults } from "@/lib/save-defaults"
import { isMappingDirty } from "@/lib/gradient-dirty"
import { captureVisualPreset, normalizePresetExtraTuning } from "@/lib/visual-presets"
import type { Mapping } from "@/lib/types"
import type { PictoriumCtx } from "@/lib/context"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function renderWithProbe(ui: ReactNode, overrides?: Partial<PictoriumCtx>) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(
    createElement("div", null, ui, createElement(Probe)),
    overrides,
  )
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

const TITLE = { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" }
const PREVIEW_URL = "http://localhost:3000/api/poster/movie/1?rv=9&scale=60"

function rankCard(): HTMLElement {
  const title = screen.getByText("ui.rankFamily · ui.posterShapePortrait")
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function extraCard(): HTMLElement {
  const title = screen.getByText("ui.sash_extra · ui.posterShapePortrait")
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function defCard(title: string): HTMLElement {
  const el = screen.getByText(title, { exact: true })
  const card = el.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function landGroup(title: string): HTMLElement {
  const el = screen.getByText(title, { exact: true })
  const headRow = el.closest("div.flex")
  expect(headRow?.parentElement).not.toBeNull()
  return headRow!.parentElement as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "", json: async () => ({}) })))
})

describe("TransformControls per-title split", () => {
  function renderTitle() {
    return renderWithProbe(createElement(TransformControls), {
      selected: TITLE,
      previewUrl: PREVIEW_URL,
    } as never)
  }

  it("rank-first slider freezes extra, rank moves (each axis)", async () => {
    seedDefaults({})
    const { ctx } = renderTitle()
    await act(async () => {})
    fireEvent.change(within(rankCard()).getByRole("slider", { name: "ui.scale" }), { target: { value: "150" } })
    expect(ctx().topBadgeScale).toBe(150)
    expect(ctx().extraBadgeScale).toBe(100)
    expect(ctx().extraBadgeOffsetX).toBe(0)
    expect(ctx().extraBadgeOffsetY).toBe(0)
    fireEvent.change(within(rankCard()).getByRole("slider", { name: "X" }), { target: { value: "40" } })
    expect(ctx().topBadgeOffsetX).toBe(40)
    expect(ctx().extraBadgeScale).toBe(100)
    fireEvent.change(within(rankCard()).getByRole("slider", { name: "Y" }), { target: { value: "-30" } })
    expect(ctx().topBadgeOffsetY).toBe(-30)
    expect(ctx().extraBadgeOffsetY).toBe(0)
  })

  it("extra-first leaves the classifica untouched (each axis)", async () => {
    seedDefaults({})
    const { ctx } = renderTitle()
    await act(async () => {})
    const card = extraCard()
    fireEvent.change(within(card).getByRole("slider", { name: "ui.scale" }), { target: { value: "150" } })
    fireEvent.change(within(card).getByRole("slider", { name: "X" }), { target: { value: "40" } })
    fireEvent.change(within(card).getByRole("slider", { name: "Y" }), { target: { value: "-30" } })
    expect(ctx().extraBadgeScale).toBe(150)
    expect(ctx().extraBadgeOffsetX).toBe(40)
    expect(ctx().extraBadgeOffsetY).toBe(-30)
    expect(ctx().topBadgeScale).toBe(100)
    expect(ctx().topBadgeOffsetX).toBe(0)
    expect(ctx().topBadgeOffsetY).toBe(0)
  })

  it("extra card shows the effective tuning, no number baseline", async () => {
    seedDefaults({ defaultTopBadgeScale: 140, defaultRankingBadgeStyle: "number" })
    renderTitle()
    await act(async () => {})
    // Rank X shows stored + (-20) baseline; extra X shows the raw effective.
    expect((within(rankCard()).getByRole("slider", { name: "X" }) as HTMLInputElement).value).toBe("-20")
    expect((within(extraCard()).getByRole("slider", { name: "X" }) as HTMLInputElement).value).toBe("0")
  })

  it("resets are independent (rank reset keeps explicit extra, extra reset unlinks)", async () => {
    seedDefaults({ extraBadgeScale: 120, extraBadgeOffsetX: 5, extraBadgeOffsetY: -5 })
    const { ctx } = renderTitle()
    await act(async () => {})
    await act(async () => {
      fireEvent.click(within(rankCard()).getByLabelText("ui.reset"))
    })
    expect(ctx().topBadgeScale).toBe(100)
    expect(ctx().extraBadgeScale).toBe(120)
    expect(ctx().extraBadgeOffsetX).toBe(5)
    await act(async () => {
      fireEvent.click(within(extraCard()).getByLabelText("ui.reset"))
    })
    expect(ctx().extraBadgeScale).toBeNull()
    expect(ctx().extraBadgeOffsetX).toBeNull()
    expect(ctx().extraBadgeOffsetY).toBeNull()
    expect(ctx().topBadgeScale).toBe(100)
  })

  it("reload hydrates both tunings", async () => {
    seedDefaults({ topBadgeScale: 130, extraBadgeScale: 120, extraBadgeOffsetX: 5 })
    const { ctx } = renderTitle()
    await act(async () => {})
    expect(ctx().topBadgeScale).toBe(130)
    expect(ctx().extraBadgeScale).toBe(120)
    expect(ctx().extraBadgeOffsetX).toBe(5)
    expect(ctx().extraBadgeOffsetY).toBeNull()
  })
})

describe("TransformPanel defaults split (portrait)", () => {
  function renderDefaults() {
    return renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "portrait" }))
  }

  it("rank-first freezes defaults extra, extra-first leaves rank alone", async () => {
    seedDefaults({})
    const { ctx } = renderDefaults()
    await act(async () => {})
    const rank = defCard("ui.rankFamily")
    fireEvent.change(within(rank).getByRole("slider", { name: "ui.scale" }), { target: { value: "150" } })
    expect(ctx().defaultTopBadgeScale).toBe(150)
    expect(ctx().defaultExtraBadgeScale).toBe(100)
    expect(ctx().defaultExtraBadgeOffsetX).toBe(0)
    expect(ctx().defaultExtraBadgeOffsetY).toBe(0)
    const extra = defCard("ui.sash_extra")
    fireEvent.change(within(extra).getByRole("slider", { name: "X" }), { target: { value: "40" } })
    expect(ctx().defaultExtraBadgeOffsetX).toBe(40)
    expect(ctx().defaultTopBadgeScale).toBe(150)
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("resets are independent, full reset unlinks extra", async () => {
    seedDefaults({ defaultExtraBadgeScale: 120 })
    const { ctx } = renderDefaults()
    await act(async () => {})
    await act(async () => {
      fireEvent.click(within(defCard("ui.rankFamily")).getByLabelText("ui.reset"))
    })
    expect(ctx().defaultTopBadgeScale).toBe(100)
    expect(ctx().defaultExtraBadgeScale).toBe(120)
    await act(async () => {
      fireEvent.click(within(defCard("ui.sash_extra")).getByLabelText("ui.reset"))
    })
    expect(ctx().defaultExtraBadgeScale).toBeNull()
    expect(ctx().defaultTopBadgeScale).toBe(100)
  })

  it("rank card reset on unmigrated extra freezes the previous tuning", async () => {
    seedDefaults({ defaultTopBadgeScale: 150, defaultTopBadgeOffsetX: 5 })
    const { ctx } = renderDefaults()
    await act(async () => {})
    expect(ctx().defaultExtraBadgeScale).toBeNull()
    await act(async () => {
      fireEvent.click(within(defCard("ui.rankFamily")).getByLabelText("ui.reset"))
    })
    expect(ctx().defaultTopBadgeScale).toBe(100)
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultExtraBadgeScale).toBe(150)
    expect(ctx().defaultExtraBadgeOffsetX).toBe(5)
    expect(ctx().defaultExtraBadgeOffsetY).toBe(0)
  })

  it("reload hydrates both defaults tunings", async () => {
    seedDefaults({ defaultTopBadgeScale: 130, defaultExtraBadgeScale: 120, defaultExtraBadgeOffsetY: -5 })
    const { ctx } = renderDefaults()
    await act(async () => {})
    expect(ctx().defaultTopBadgeScale).toBe(130)
    expect(ctx().defaultExtraBadgeScale).toBe(120)
    expect(ctx().defaultExtraBadgeOffsetY).toBe(-5)
    expect(ctx().defaultExtraBadgeOffsetX).toBeNull()
  })
})

describe("TransformPanel landscape split (profile isolated from flats)", () => {
  function renderLandscape() {
    return renderWithProbe(createElement(TransformPanel, { active: true, previewShape: "landscape" }))
  }

  it("profile rank edit materializes profile extra, flats untouched", async () => {
    seedDefaults({})
    const { ctx } = renderLandscape()
    await act(async () => {})
    const group = landGroup("ui.rankFamily")
    fireEvent.change(within(group).getByRole("slider", { name: "X" }), { target: { value: "40" } })
    expect(ctx().landscape.topBadgeOffsetX).toBe(40)
    expect(ctx().landscape.extraBadgeScale).toBe(100)
    expect(ctx().landscape.extraBadgeOffsetX).toBe(0)
    expect(ctx().landscape.extraBadgeOffsetY).toBe(0)
    // Portrait flats never written by landscape edits.
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultExtraBadgeScale).toBeNull()
  })

  it("profile extra edit leaves profile rank alone, group resets independent", async () => {
    seedDefaults({ landscape: { extraBadgeScale: 120 } })
    const { ctx } = renderLandscape()
    await act(async () => {})
    const group = landGroup("ui.sash_extra")
    fireEvent.change(within(group).getByRole("slider", { name: "X" }), { target: { value: "40" } })
    expect(ctx().landscape.extraBadgeOffsetX).toBe(40)
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    expect(ctx().landscape.topBadgeScale).toBeUndefined()
    await act(async () => {
      fireEvent.click(within(group).getByLabelText("ui.reset"))
    })
    expect(ctx().landscape.extraBadgeScale).toBeUndefined()
    expect(ctx().landscape.extraBadgeOffsetX).toBeUndefined()
  })

  it("reload hydrates the profile extra tuning", async () => {
    seedDefaults({ landscape: { extraBadgeScale: 130, extraBadgeOffsetY: -5 } })
    const { ctx } = renderLandscape()
    await act(async () => {})
    expect(ctx().landscape.extraBadgeScale).toBe(130)
    expect(ctx().landscape.extraBadgeOffsetY).toBe(-5)
    expect(ctx().landscape.extraBadgeOffsetX).toBeUndefined()
  })

  it("legacy landscape rank shows through the extra group, survives rank reset", async () => {
    // No extra anywhere: the rendered extra follows the landscape rank
    // (150/30/40): the UI must show the effective tuning, not flat 100/0/0.
    seedDefaults({
      landscape: { topBadgeScale: 150, topBadgeOffsetX: 30, topBadgeOffsetY: 40 },
    })
    const { ctx } = renderLandscape()
    await act(async () => {})
    const extraGroup = landGroup("ui.sash_extra")
    expect((within(extraGroup).getByRole("slider", { name: "ui.scale" }) as HTMLInputElement).value).toBe("150")
    expect((within(extraGroup).getByRole("slider", { name: "X" }) as HTMLInputElement).value).toBe("30")
    expect((within(extraGroup).getByRole("slider", { name: "Y" }) as HTMLInputElement).value).toBe("40")
    // Rank group reset clears the profile rank (undefined keys): the extra
    // must freeze the previous actuals instead of dragging with the rank.
    const rankGroup = landGroup("ui.rankFamily")
    await act(async () => {
      fireEvent.click(within(rankGroup).getByLabelText("ui.reset"))
    })
    expect(ctx().landscape.topBadgeScale).toBeUndefined()
    expect(ctx().landscape.extraBadgeScale).toBe(150)
    expect(ctx().landscape.extraBadgeOffsetX).toBe(30)
    expect(ctx().landscape.extraBadgeOffsetY).toBe(40)
    expect((within(extraGroup).getByRole("slider", { name: "X" }) as HTMLInputElement).value).toBe("30")
  })

  it("single-axis rank dblclick freezes the extra actuals", async () => {
    seedDefaults({
      landscape: { topBadgeScale: 150, topBadgeOffsetX: 30, topBadgeOffsetY: 40 },
    })
    const { ctx } = renderLandscape()
    await act(async () => {})
    const rankGroup = landGroup("ui.rankFamily")
    await act(async () => {
      fireEvent.doubleClick(within(rankGroup).getByRole("slider", { name: "X" }))
    })
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    expect(ctx().landscape.extraBadgeScale).toBe(150)
    expect(ctx().landscape.extraBadgeOffsetX).toBe(30)
    expect(ctx().landscape.extraBadgeOffsetY).toBe(40)
  })

  it("extra group reset never touches the rank tuning", async () => {
    seedDefaults({
      landscape: { topBadgeScale: 150, topBadgeOffsetX: 30, topBadgeOffsetY: 40 },
    })
    const { ctx } = renderLandscape()
    await act(async () => {})
    // Migrate first via a rank edit so there is explicit extra to clear.
    const rankGroup = landGroup("ui.rankFamily")
    await act(async () => {
      fireEvent.click(within(rankGroup).getByLabelText("ui.reset"))
    })
    expect(ctx().landscape.extraBadgeScale).toBe(150)
    const extraGroup = landGroup("ui.sash_extra")
    await act(async () => {
      fireEvent.click(within(extraGroup).getByLabelText("ui.reset"))
    })
    expect(ctx().landscape.extraBadgeScale).toBeUndefined()
    expect(ctx().landscape.extraBadgeOffsetX).toBeUndefined()
    expect(ctx().landscape.extraBadgeOffsetY).toBeUndefined()
    expect(ctx().landscape.topBadgeScale).toBeUndefined()
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    expect(ctx().landscape.topBadgeOffsetY).toBeUndefined()
  })
})

describe("applyVisualPreset normalizes extra to the preset look", () => {
  async function renderEditorBox() {
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    await act(async () => {})
    return box
  }

  it("legacy preset without extra clears to null, effective equals its rank", async () => {
    seedDefaults({})
    const box = await renderEditorBox()
    const ed = () => box.ed!
    const before = captureVisualPreset(ed())
    expect(before.defaultExtraBadgeScale).toBeNull()
    await act(async () => {
      ed().applyVisualPreset({ ...before, defaultTopBadgeScale: 150 })
    })
    // Full look application per target: missing extra axes clear to null
    // (follow the preset's own classifica, keeps legacy URLs).
    expect(ed().defaultTopBadgeScale).toBe(150)
    expect(ed().defaultExtraBadgeScale).toBeNull()
    expect(ed().defaultExtraBadgeOffsetX).toBeNull()
    const normalized = normalizePresetExtraTuning(captureVisualPreset(ed()))
    expect(normalized.defaultExtraBadgeScale).toBe(150)
    expect(normalized.defaultExtraBadgeOffsetX).toBe(0)
    // Highlight compare stays stable across the apply.
    const strippedBefore = JSON.stringify(normalizePresetExtraTuning(before))
    const strippedAfter = JSON.stringify(normalized)
    expect(strippedAfter === strippedBefore).toBe(false)
    expect(JSON.stringify(normalizePresetExtraTuning({ ...before, defaultTopBadgeScale: 150 }))).toBe(strippedAfter)
  })

  it("modern explicit preset wins, roundtrip exact, highlights distinct", async () => {
    seedDefaults({})
    const box = await renderEditorBox()
    const ed = () => box.ed!
    const base = captureVisualPreset(ed())
    const presetA = {
      ...base,
      defaultExtraBadgeScale: 130,
      defaultExtraBadgeOffsetX: 20,
      defaultExtraBadgeOffsetY: 30,
    }
    const presetB = {
      ...base,
      defaultExtraBadgeScale: 80,
      defaultExtraBadgeOffsetX: -10,
      defaultExtraBadgeOffsetY: -20,
    }
    // Same look except the explicit extra tuning: highlights must differ.
    expect(JSON.stringify(normalizePresetExtraTuning(presetA))).not.toBe(
      JSON.stringify(normalizePresetExtraTuning(presetB)),
    )
    await act(async () => {
      ed().applyVisualPreset(presetA)
    })
    expect(ed().defaultExtraBadgeScale).toBe(130)
    expect(ed().defaultExtraBadgeOffsetX).toBe(20)
    expect(ed().defaultExtraBadgeOffsetY).toBe(30)
    expect(captureVisualPreset(ed())).toEqual(presetA)
    await act(async () => {
      ed().applyVisualPreset(presetB)
    })
    expect(captureVisualPreset(ed())).toEqual(presetB)
  })

  it("custom extra state cleared by legacy apply, effective follows the preset rank", async () => {
    seedDefaults({ defaultTopBadgeScale: 80, defaultExtraBadgeScale: 130, defaultExtraBadgeOffsetX: 20, defaultExtraBadgeOffsetY: 30 })
    const box = await renderEditorBox()
    const ed = () => box.ed!
    expect(ed().defaultExtraBadgeScale).toBe(130)
    const legacy = captureVisualPreset(ed())
    // Builtin legacy look: top 100/0/0, no extra keys involved.
    await act(async () => {
      ed().applyVisualPreset({
        ...legacy,
        defaultTopBadgeScale: 100,
        defaultTopBadgeOffsetX: 0,
        defaultTopBadgeOffsetY: 0,
        defaultExtraBadgeScale: null,
        defaultExtraBadgeOffsetX: null,
        defaultExtraBadgeOffsetY: null,
      })
    })
    expect(ed().defaultTopBadgeScale).toBe(100)
    expect(ed().defaultExtraBadgeScale).toBeNull()
    const normalized = normalizePresetExtraTuning(captureVisualPreset(ed()))
    expect(normalized.defaultExtraBadgeScale).toBe(100)
    expect(normalized.defaultExtraBadgeOffsetX).toBe(0)
    // Normalized highlight matches the builtin look (cleared extra included).
    const legacyCleared = {
      ...legacy,
      defaultExtraBadgeScale: null,
      defaultExtraBadgeOffsetX: null,
      defaultExtraBadgeOffsetY: null,
    }
    expect(
      JSON.stringify(normalized)
      === JSON.stringify(normalizePresetExtraTuning({ ...legacyCleared, defaultTopBadgeScale: 100, defaultTopBadgeOffsetX: 0, defaultTopBadgeOffsetY: 0 })),
    ).toBe(true)
  })

  it("landscape legacy apply clears profile extra, flats untouched", async () => {
    seedDefaults({
      defaultExtraBadgeScale: 150,
      landscape: { topBadgeScale: 120, extraBadgeScale: 140 },
    })
    const box = await renderEditorBox()
    const ed = () => box.ed!
    expect(ed().landscape.extraBadgeScale).toBe(140)
    const base = captureVisualPreset(ed())
    // Landscape legacy preset: profile rank set, no profile extra opinion.
    const landPreset = {
      ...base,
      landscape: {
        ...base.landscape,
        topBadgeScale: 130,
        topBadgeOffsetX: 0,
        topBadgeOffsetY: 0,
        extraBadgeScale: null,
        extraBadgeOffsetX: null,
        extraBadgeOffsetY: null,
      },
    }
    await act(async () => {
      ed().applyVisualPreset(landPreset, "landscape")
    })
    // Profile cleared (null = follow); previous modern flat extra preserved
    // untouched; effective landscape extra follows the flat (server chain).
    expect(ed().landscape.extraBadgeScale).toBeNull()
    expect(ed().landscape.extraBadgeOffsetX).toBeNull()
    expect(ed().defaultExtraBadgeScale).toBe(150)
    const normalized = normalizePresetExtraTuning(captureVisualPreset(ed()))
    expect(normalized.landscape.extraBadgeScale).toBe(150)
    expect(normalized.landscape.extraBadgeOffsetX).toBe(0)
  })

  it("landscape legacy apply without flat extra follows its own rank", async () => {
    seedDefaults({ landscape: { topBadgeScale: 120 } })
    const box = await renderEditorBox()
    const ed = () => box.ed!
    expect(ed().landscape.topBadgeScale).toBe(120)
    await act(async () => {
      ed().applyVisualPreset(captureVisualPreset(ed()), "landscape")
    })
    expect(ed().landscape.extraBadgeScale).toBeNull()
    const normalized = normalizePresetExtraTuning(captureVisualPreset(ed()))
    expect(normalized.landscape.extraBadgeScale).toBe(120)
    expect(normalized.landscape.extraBadgeOffsetX).toBe(0)
  })

  it("applyVisualPreset never mutates the input preset profile", async () => {
    seedDefaults({})
    const box = await renderEditorBox()
    const ed = () => box.ed!
    const base = captureVisualPreset(ed())
    const frozenLandscape = Object.freeze({ ...base.landscape, topBadgeScale: 120 })
    const frozen = Object.freeze({ ...base, landscape: frozenLandscape })
    await act(async () => {
      ed().applyVisualPreset(frozen as never, "landscape")
    })
    // Frozen input accepted (no throw on mutation attempt): profile applied.
    expect(ed().landscape.topBadgeScale).toBe(120)
    expect(ed().landscape.extraBadgeScale).toBeNull()
  })

  it("legacy builtin apply keeps its highlight (effective extra equals its rank)", async () => {
    seedDefaults({})
    const box = await renderEditorBox()
    const ed = () => box.ed!
    const base = captureVisualPreset(ed())
    // Simulate a legacy house look: classifica set, no extra keys at all.
    const legacy = { ...base } as Record<string, unknown>
    delete legacy.defaultExtraBadgeScale
    delete legacy.defaultExtraBadgeOffsetX
    delete legacy.defaultExtraBadgeOffsetY
    if (legacy.landscape && typeof legacy.landscape === "object") {
      const land = { ...(legacy.landscape as Record<string, unknown>) }
      delete land.extraBadgeScale
      delete land.extraBadgeOffsetX
      delete land.extraBadgeOffsetY
      legacy.landscape = land
    }
    await act(async () => {
      ed().applyVisualPreset({ ...legacy, defaultTopBadgeScale: 120 } as never)
    })
    expect(ed().defaultTopBadgeScale).toBe(120)
    // Sparse preserved: no explicit extra written by a legacy apply.
    expect(ed().defaultExtraBadgeScale).toBeNull()
    expect(ed().defaultExtraBadgeOffsetX).toBeNull()
    // Normalized highlight matches the look (effective extra = its rank).
    const normalized = normalizePresetExtraTuning(captureVisualPreset(ed()))
    expect(normalized.defaultExtraBadgeScale).toBe(120)
    expect(
      JSON.stringify(normalized)
      === JSON.stringify(normalizePresetExtraTuning({ ...legacy, defaultTopBadgeScale: 120 })),
    ).toBe(true)
  })
})

const noop = () => {}

function baseSaveDeps(overrides: Record<string, unknown> = {}) {
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
    extraBadgeScale: 150,
    extraBadgeOffsetX: 10,
    extraBadgeOffsetY: -5,
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
    networkLogoFollowTitle: true,
    ribbonEnabled: true,
    lang: "it",
    posterShape: "poster",
    ...overrides,
  } as never
}

describe("usePosterSave extra tuning", () => {
  it("portrait saves flat extra, landscape writes profile extra", async () => {
    const posted: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
    const { result } = renderHook(() => usePosterSave(baseSaveDeps()))
    let ok = false
    await act(async () => {
      ok = (await result.current.saveConfig({ silent: true })) === true
    })
    expect(ok).toBe(true)
    const mappings = posted.filter((p) => String(p.url).includes("/api/mappings"))
    expect(mappings).toHaveLength(1)
    expect(mappings[0].body.extraBadgeScale).toBe(150)
    expect(mappings[0].body.extraBadgeOffsetX).toBe(10)
    expect(mappings[0].body.extraBadgeOffsetY).toBe(-5)

    posted.length = 0
    const { result: landResult } = renderHook(() => usePosterSave(baseSaveDeps({
      posterShape: "landscape",
    })))
    await act(async () => {
      await landResult.current.saveConfig({ silent: true })
    })
    const landPost = posted.filter((p) => String(p.url).includes("/api/mappings"))[0]
    const profile = landPost.body.landscape as Record<string, unknown>
    expect(profile.extraBadgeScale).toBe(150)
    expect(profile.extraBadgeOffsetX).toBe(10)
    expect(profile.extraBadgeOffsetY).toBe(-5)
  })
})

describe("saveDefaults extra tuning", () => {
  it("PUT body carries explicit defaults extra, null stays null", async () => {
    seedDefaults({})
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    await act(async () => {})
    await act(async () => {
      box.ed!.setDefaultExtraBadgeScale(150)
    })
    const posted: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }))
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const puts = posted.filter((p) => String(p.url).includes("/api/defaults"))
    expect(puts.length).toBeGreaterThan(0)
    expect(puts[puts.length - 1].body.extraBadgeScale).toBe(150)
    expect(puts[puts.length - 1].body.extraBadgeOffsetX).toBeNull()
  })
})

describe("isMappingDirty extra tuning + N3 follow flag", () => {  const shape = "poster" as const
  const gradient = { gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 50, blurDarkness: 30, tintStrength: 20, topShade: 50 }
  const base = {
    artwork: { posterShape: shape, posterPath: "/p.jpg", logoPath: null, backdropPath: null },
    gradient,
    topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
  }

  it("extra tuning drift marks unsaved", () => {
    expect(isMappingDirty(
      { ...base, extraBadgeScale: 150, extraBadgeOffsetX: 0, extraBadgeOffsetY: 0 },
      { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg", logoPath: null, originalPosterPath: null, language: null, updatedAt: "x" } as Mapping,
      gradient, shape,
    )).toBe(true)
    expect(isMappingDirty(
      { ...base, extraBadgeScale: null, extraBadgeOffsetX: null, extraBadgeOffsetY: null },
      { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg", logoPath: null, originalPosterPath: null, language: null, updatedAt: "x" } as Mapping,
      gradient, shape,
    )).toBe(false)
  })

  it("N3 follow flag drift marks unsaved", () => {
    const mapping = {
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg", logoPath: null,
      originalPosterPath: null, language: null, updatedAt: "x", networkLogoFollowTitle: false,
    } as Mapping
    expect(isMappingDirty({ ...base, networkLogoFollowTitle: true }, mapping, gradient, shape)).toBe(true)
    expect(isMappingDirty({ ...base, networkLogoFollowTitle: false }, mapping, gradient, shape)).toBe(false)
  })
})

describe("preview URL follows live extra state (defaults stay shadowed)", () => {
  const queues = new Map<string, Array<(data: unknown) => void>>()
  const img = (file_path: string): TMDBImage => ({ file_path, iso_639_1: null, vote_average: 0, width: 500, height: 750 })
  const ITEM: SearchResult = { id: 303, media_type: "movie", title: "Gamma", name: "Gamma", poster_path: null }

  function okJson(data: unknown) {
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(data), json: async () => data }
  }

  function installFetchMock() {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      const u = String(url)
      const signal = init?.signal ?? null
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
      if (u.includes("/api/mappings")) return okJson({ mappings: [] })
      const m = u.match(/\/api\/tmdb\/(\d+)\/(details|images)/)
      if (m) {
        return new Promise((resolve, reject) => {
          const key = `${m[2]}:${m[1]}`
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
          signal?.addEventListener("abort", onAbort, { once: true })
          const q = queues.get(key) ?? []
          queues.set(key, q)
          q.push((res: unknown) => {
            signal?.removeEventListener("abort", onAbort)
            resolve(res)
          })
        })
      }
      return okJson({})
    }))
  }

  function resolveAll(key: string, data: unknown) {
    const q = queues.get(key) ?? []
    queues.set(key, [])
    expect(q.length > 0, `expected a pending request for ${key}`).toBe(true)
    for (const p of q) p(okJson(data))
  }

  async function flush(rounds = 12) {
    for (let i = 0; i < rounds; i++) {
      await act(async () => {})
    }
  }

  function detailsFixture() {
    return {
      genres: [{ id: 18, name: "Drama" }], voteAverage: 8.2, voteCount: 120,
      status: null, type: null, release_date: "2024-03-01", first_air_date: null,
      last_air_date: null, next_episode_to_air: null, number_of_seasons: null,
      number_of_episodes: null, title: "Gamma", name: null, imdb_id: null,
      wikidata_id: null, networks: [], production_companies: [],
      original_language: "it", aggregatedRatings: null,
    }
  }

  let rootCtx: PictoriumCtx | null = null
  let rootEd: PosterEditorCtx | null = null

  function RootProbe() {
    const v = useP()
    const e = usePosterEditor()
    useEffect(() => {
      rootCtx = v
      rootEd = e
    })
    return null
  }

  beforeEach(() => {
    queues.clear()
    localStorage.clear()
    installFetchMock()
    rootCtx = null
    rootEd = null
  })

  it("live extra tuning lands in the preview URL, defaults extra stays shadowed", async () => {
    seedDefaults({})
    render(
      createElement(PictoriumRoot, null, createElement(RootProbe)),
    )
    await flush()
    expect(rootCtx, "provider context available").toBeTruthy()
    await act(async () => {
      rootCtx!.navigateToPoster(ITEM)
    })
    resolveAll("details:303", detailsFixture())
    resolveAll("images:303", { posters: [img("/clean-g.jpg")], logos: [], backdrops: [] })
    await flush()
    expect(rootCtx!.loadingImages).toBe(false)
    await waitFor(() => expect(rootCtx!.previewUrl).not.toBe(""))
    expect(rootCtx!.previewUrl).not.toContain("exscale")
    // Live extra edit -> explicit ex* params on the same endpoint.
    await act(async () => {
      rootEd!.setExtraBadgeScale(150)
      rootEd!.setExtraBadgeOffsetX(10)
    })
    await waitFor(() => expect(rootCtx!.previewUrl).toContain("exscale=150"))
    expect(rootCtx!.previewUrl).toContain("exox=10")
    // Defaults extra never leaks into the per-title preview URL: the server
    // resolves it from the shadow chain (query absent wins nothing here).
    await act(async () => {
      rootEd!.setExtraBadgeScale(null)
      rootEd!.setExtraBadgeOffsetX(null)
      rootEd!.setDefaultExtraBadgeScale(140)
    })
    await waitFor(() => expect(rootCtx!.previewUrl).not.toContain("exscale"))
    expect(rootCtx!.previewUrl).not.toContain("exox")
  })
})