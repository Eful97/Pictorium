/**
 * C2 — UI scala relativa + offset gruppo rating separati.
 *
 * - Conversione raw↔UI (`separateBadgeScaleToUI`/`uiToSeparateBadgeScale`):
 *   raw 130 ↔ UI 100, raw 100 ↔ UI 77, bounds numerici UI 8..154,
 *   clamp raw 10..200. Lo slider scala è centrato (50..150, neutro 100).
 * - Slider per-titolo/default/Orizzontale mostrano 100 di default; i raw
 *   persistiti non migrano mai (conversione solo su interazione).
 * - Offset X/Y per-titolo/default/Orizzontale (default 0, pattern quality);
 *   valori stored fuori range si mostrano raw e si preservano on read.
 * - Barra portrait: X disabilitata con tooltip (caption rimossa); in
 *   landscape (bar→pills) X attiva.
 * - Idratazione stored (flat + profilo landscape), legacy → 0; dirty; preset.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within, renderHook, act } from "@testing-library/react"
import { TransformControls } from "@/components/TransformControls"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { useDefaults } from "@/lib/useDefaults"
import {
  separateBadgeScaleToUI,
  uiToSeparateBadgeScale,
  SEPARATE_BADGE_SCALE_UI_MIN,
  SEPARATE_BADGE_SCALE_UI_MAX,
} from "@/lib/badge-styles"
import { buildPreviewUrl } from "@/lib/poster-url"
import { isMappingDirty } from "@/lib/gradient-dirty"
import { captureVisualPreset } from "@/lib/visual-presets"
import { PosterEditorProvider } from "@/lib/contexts/PosterEditorContext"
import { createElement, type ReactNode } from "react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

const SEP_ON = {
  globalBadges: true,
  badgeRating: true,
  separateRatings: true,
}

const DEF_SEP_ON = {
  defaultGlobalBadges: true,
  defaultBadgeRating: true,
  defaultSeparateRatings: true,
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})

function sepCardControls() {
  const title = screen.getByText("ui.separateRatings · ui.posterShapePortrait", { exact: true })
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function sepCardControlsLandscape() {
  const title = screen.getByText("ui.separateRatings · ui.posterShapeLandscape", { exact: true })
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function renderWithProbe(ui: ReactNode) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(<>{ui}<Probe /></>)
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function editorWrapper({ children }: { children: ReactNode }) {
  return createElement(PosterEditorProvider, null, children)
}

const ps = {
  selected: { id: 1, media_type: "movie", poster_path: "/p.jpg" },
  previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 7.8, width: 500, height: 750 },
  selectedLogo: null,
  selectedBackdrop: null,
  logoScale: 60, logoOffsetX: 0, logoOffsetY: 0,
  backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0,
  metaInfo: { genres: [{ id: 1, name: "Action" }], voteAverage: 7.8 },
  trendRank: null, mdblistAnimeList: [],
  topEdgeColor: null, accentColor: null, autoAccentColor: null,
  lang: "it", tmdbKey: "",
}
const bp = {
  globalBadges: true, rankingBadges: false,
  badgeStyle: "shadow", rankingBadgeStyle: "default",
  customBadge: null,
  gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true,
  topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0,
  genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0,
  qualityBadgeScale: 100, qualityBadgeOffsetX: 0, qualityBadgeOffsetY: 0,
  separateBadgeScale: 130, separateBadgeOffsetX: 0, separateBadgeOffsetY: 0,
  networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0,
}

describe("helper scala relativa (solo presentazione)", () => {
  it("raw 130 ↔ UI 100, raw 100 ↔ UI 77", () => {
    expect(separateBadgeScaleToUI(130)).toBe(100)
    expect(separateBadgeScaleToUI(100)).toBe(77)
    expect(uiToSeparateBadgeScale(100)).toBe(130)
    expect(uiToSeparateBadgeScale(77)).toBe(100)
  })

  it("range UI 8..154 copre il raw 10..200 senza perdite", () => {
    expect(SEPARATE_BADGE_SCALE_UI_MIN).toBe(8)
    expect(SEPARATE_BADGE_SCALE_UI_MAX).toBe(154)
    expect(separateBadgeScaleToUI(10)).toBe(8)
    expect(separateBadgeScaleToUI(200)).toBe(154)
    expect(uiToSeparateBadgeScale(8)).toBe(10)
    expect(uiToSeparateBadgeScale(154)).toBe(200)
    expect(uiToSeparateBadgeScale(120)).toBe(156)
  })

  it("clamp raw 10..200, fallback 100 su garbage", () => {
    expect(uiToSeparateBadgeScale(1)).toBe(10)
    expect(uiToSeparateBadgeScale(999)).toBe(200)
    expect(uiToSeparateBadgeScale(null)).toBe(130)
    expect(separateBadgeScaleToUI(null)).toBe(100)
  })
})

describe("TransformControls scala relativa + offset", () => {
  it("slider scala 50..150 centrato, bounds numerici 8..154, default UI 100", () => {
    seedDefaults({ ...SEP_ON })
    renderWithCtx(<TransformControls />)
    const slider = within(sepCardControls()).getByRole("slider", { name: "ui.scale" })
    expect(slider.getAttribute("min")).toBe("50")
    expect(slider.getAttribute("max")).toBe("150")
    expect(slider.getAttribute("aria-valuetext")).toBe("100%")
  })

  it("UI 120 → raw 156 e la preview emette sepscale=156", () => {
    seedDefaults({ ...SEP_ON })
    const { ctx } = renderWithProbe(<TransformControls />)
    const slider = within(sepCardControls()).getByRole("slider", { name: "ui.scale" })
    fireEvent.change(slider, { target: { value: "120" } })
    expect(slider.getAttribute("aria-valuetext")).toBe("120%")
    expect(ctx().separateBadgeScale).toBe(156)
    expect(buildPreviewUrl(ps as never, { ...bp, separateBadgeScale: ctx().separateBadgeScale } as never))
      .toContain("sepscale=156")
  })

  it("offset X/Y mostrano i raw e la preview emette sepox/sepoy", () => {
    seedDefaults({ ...SEP_ON, separateBadgeOffsetX: 25, separateBadgeOffsetY: -30 })
    const { ctx } = renderWithProbe(<TransformControls />)
    const card = sepCardControls()
    expect(within(card).getByRole("slider", { name: "X" }).getAttribute("aria-valuetext")).toBe("25px")
    expect(within(card).getByRole("slider", { name: "Y" }).getAttribute("aria-valuetext")).toBe("-30px")
    fireEvent.change(within(card).getByRole("slider", { name: "X" }), { target: { value: "40" } })
    expect(ctx().separateBadgeOffsetX).toBe(40)
    expect(buildPreviewUrl(ps as never, {
      ...bp,
      separateBadgeOffsetX: ctx().separateBadgeOffsetX,
      separateBadgeOffsetY: ctx().separateBadgeOffsetY,
    } as never)).toContain("sepox=40&sepoy=-30")
  })

  it("stored fuori range si mostra raw e si preserva on read", () => {
    seedDefaults({ ...SEP_ON, separateBadgeOffsetX: 1500 })
    const { ctx } = renderWithProbe(<TransformControls />)
    const card = sepCardControls()
    expect(within(card).getByRole("slider", { name: "X" }).getAttribute("aria-valuetext")).toBe("1500px")
    // Nessuna scrittura alla sola lettura: lo stored resta intatto.
    expect(ctx().separateBadgeOffsetX).toBe(1500)
  })

  it("reset azzera scala (UI 100) + X + Y", () => {
    seedDefaults({
      ...SEP_ON,
      separateBadgeScale: 150, defaultSeparateBadgeScale: 130,
      separateBadgeOffsetX: 40, defaultSeparateBadgeOffsetX: 0,
      separateBadgeOffsetY: -30, defaultSeparateBadgeOffsetY: 0,
    })
    renderWithCtx(<TransformControls />)
    const card = sepCardControls()
    fireEvent.click(within(card).getByRole("button", { name: "ui.reset" }))
    expect(within(card).getByRole("slider", { name: "ui.scale" }).getAttribute("aria-valuetext")).toBe("100%")
    expect(within(card).getByRole("slider", { name: "X" }).getAttribute("aria-valuetext")).toBe("0px")
    expect(within(card).getByRole("slider", { name: "Y" }).getAttribute("aria-valuetext")).toBe("0px")
  })

  it("barra portrait: X disabilitata con tooltip, Y attiva", () => {
    seedDefaults({ ...SEP_ON, separateRatingsStyle: "bottom-bar" })
    const { ctx } = renderWithProbe(<TransformControls />)
    const card = sepCardControls()
    const xSlider = within(card).getByRole("slider", { name: "X" })
    expect(xSlider.closest("fieldset")).toHaveAttribute("disabled")
    // Caption visibile rimossa (T1): resta il tooltip non testuale sul wrapper.
    expect(within(card).queryByText("ui.separateRatingsBarXDisabledHint")).not.toBeInTheDocument()
    expect(within(card).getByTitle("ui.separateRatingsBarXDisabledHint")).toBeInTheDocument()
    // Callback blindata: nessun cambio di stato.
    fireEvent.change(xSlider, { target: { value: "40" } })
    expect(ctx().separateBadgeOffsetX).toBe(0)
    const ySlider = within(card).getByRole("slider", { name: "Y" })
    // La Y non ha fieldset (sempre attiva).
    expect(ySlider.closest("fieldset")).toBeNull()
    fireEvent.change(ySlider, { target: { value: "-30" } })
    expect(ctx().separateBadgeOffsetY).toBe(-30)
  })

  it("landscape con raw bar (→pills): X abilitata", () => {
    seedDefaults({ ...SEP_ON, posterShape: "landscape", separateRatingsStyle: "bottom-bar" })
    renderWithCtx(<TransformControls />)
    const card = sepCardControlsLandscape()
    const xSlider = within(card).getByRole("slider", { name: "X" })
    expect(xSlider.closest("fieldset")).not.toHaveAttribute("disabled")
    expect(within(card).queryByText("ui.separateRatingsBarXDisabledHint")).not.toBeInTheDocument()
  })
})

describe("TransformPanel default scala relativa + offset", () => {
  function sepCardPanel() {
    const title = screen.getByText("ui.separateRatings", { exact: true })
    const card = title.closest("div.rounded-xl")
    expect(card).not.toBeNull()
    return card as HTMLElement
  }

  it("default UI 100, X/Y a 0, reset completo", () => {
    seedDefaults({
      ...DEF_SEP_ON,
      defaultSeparateBadgeScale: 150, defaultSeparateBadgeOffsetX: 40, defaultSeparateBadgeOffsetY: -30,
    })
    renderWithCtx(<TransformPanel active />)
    const card = sepCardPanel()
    expect(within(card).getByRole("slider", { name: "ui.scale" }).getAttribute("aria-valuetext")).toBe("115%")
    fireEvent.click(within(card).getByRole("button", { name: "ui.reset" }))
    expect(within(card).getByRole("slider", { name: "ui.scale" }).getAttribute("aria-valuetext")).toBe("100%")
    expect(within(card).getByRole("slider", { name: "X" }).getAttribute("aria-valuetext")).toBe("0px")
    expect(within(card).getByRole("slider", { name: "Y" }).getAttribute("aria-valuetext")).toBe("0px")
  })

  it("barra portrait nei default: X disabilitata con tooltip", () => {
    seedDefaults({ ...DEF_SEP_ON, defaultSeparateRatingsStyle: "bottom-bar" })
    renderWithCtx(<TransformPanel active />)
    const card = sepCardPanel()
    expect(within(card).getByRole("slider", { name: "X" }).closest("fieldset")).toHaveAttribute("disabled")
    expect(within(card).queryByText("ui.separateRatingsBarXDisabledHint")).not.toBeInTheDocument()
    expect(within(card).getByTitle("ui.separateRatingsBarXDisabledHint")).toBeInTheDocument()
  })
})

describe("LandscapeDefaultsSection scala relativa + offset", () => {
  function openLandscape() {
    fireEvent.click(screen.getByText("ui.posterShapeLandscape"))
  }

  function sepCardLandscape() {
    // Il blocco separati Orizzontale vive nel container condiviso: lo scope
    // è il blocco space-y-1.5 più vicino (non il rounded-xl esterno).
    const title = screen.getByText("ui.separateRatings", { exact: true })
    const card = title.closest("div.space-y-1\\.5")
    expect(card).not.toBeNull()
    return card as HTMLElement
  }

  it("override scala UI + X/Y, reset segue i flat", () => {
    seedDefaults({
      ...DEF_SEP_ON,
      landscape: { separateBadgeScale: 150, separateBadgeOffsetX: 20, separateBadgeOffsetY: -10 },
    })
    renderWithCtx(<TransformPanel active />)
    openLandscape()
    const card = sepCardLandscape()
    expect(within(card).getByRole("slider", { name: "ui.scale" }).getAttribute("aria-valuetext")).toBe("115%")
    expect(within(card).getByRole("slider", { name: "X" }).getAttribute("aria-valuetext")).toBe("20px")
    expect(within(card).getByRole("slider", { name: "Y" }).getAttribute("aria-valuetext")).toBe("-10px")
    fireEvent.change(within(card).getByRole("slider", { name: "X" }), { target: { value: "35" } })
    expect(within(card).getByRole("slider", { name: "X" }).getAttribute("aria-valuetext")).toBe("35px")
  })
})

describe("idratazione stored + dirty + preset", () => {
  it("stored flat + profilo landscape idratano, legacy senza chiavi → 0", () => {
    seedDefaults({
      separateBadgeOffsetX: 25, separateBadgeOffsetY: -15,
      defaultSeparateBadgeOffsetX: 30, defaultSeparateBadgeOffsetY: -31,
      landscape: { separateBadgeOffsetX: 12, separateBadgeOffsetY: 13 },
    })
    const { result } = renderHook(() => useDefaults())
    expect(result.current.separateBadgeOffsetX).toBe(25)
    expect(result.current.separateBadgeOffsetY).toBe(-15)
    expect(result.current.defaultSeparateBadgeOffsetX).toBe(30)
    expect(result.current.defaultSeparateBadgeOffsetY).toBe(-31)
    expect(result.current.landscape.separateBadgeOffsetX).toBe(12)
    expect(result.current.landscape.separateBadgeOffsetY).toBe(13)
  })

  it("legacy senza chiavi offset → 0 ovunque", () => {
    seedDefaults({})
    const { result } = renderHook(() => useDefaults())
    expect(result.current.separateBadgeOffsetX).toBe(0)
    expect(result.current.separateBadgeOffsetY).toBe(0)
    expect(result.current.defaultSeparateBadgeOffsetX).toBe(0)
    expect(result.current.defaultSeparateBadgeOffsetY).toBe(0)
  })

  it("dirty rileva gli offset separati", () => {
    const baseArtwork = { posterPath: "/p.jpg" as string | null, backdropPath: null, posterShape: "poster" as const, logoPath: null }
    const baseGradient = { gradientHeight: 30, blurEnabled: true, blurIntensity: 20, blurFade: 50, blurDarkness: 30, tintStrength: 20, topShade: 50 }
    const state = {
      artwork: baseArtwork, gradient: baseGradient,
      separateBadgeScale: 130, separateBadgeOffsetX: 0, separateBadgeOffsetY: 0,
    }
    const m = {
      posterPath: "/p.jpg", posterShape: "poster",
      separateBadgeScale: 130, separateBadgeOffsetX: 0, separateBadgeOffsetY: 0,
    }
    expect(isMappingDirty(state as never, m as never, baseGradient, "poster")).toBe(false)
    expect(isMappingDirty({ ...state, separateBadgeOffsetX: 10 } as never, m as never, baseGradient, "poster")).toBe(true)
    expect(isMappingDirty({ ...state, separateBadgeOffsetY: -10 } as never, m as never, baseGradient, "poster")).toBe(true)
  })

  it("preset: legacy senza chiavi → default 0, valori impostati si preservano", () => {
    seedDefaults({})
    const { result } = renderHook(() => usePosterEditor(), { wrapper: editorWrapper })
    expect(captureVisualPreset(result.current).defaultSeparateBadgeOffsetX).toBe(0)
    expect(captureVisualPreset(result.current).defaultSeparateBadgeOffsetY).toBe(0)
    act(() => {
      result.current.setDefaultSeparateBadgeOffsetX(25)
      result.current.setDefaultSeparateBadgeOffsetY(-15)
      result.current.setSeparateBadgeOffsetX(40)
    })
    const preset = captureVisualPreset(result.current)
    expect(preset.defaultSeparateBadgeOffsetX).toBe(25)
    expect(preset.defaultSeparateBadgeOffsetY).toBe(-15)
    act(() => {
      result.current.applyVisualPreset({ ...preset, defaultSeparateBadgeOffsetX: 0, defaultSeparateBadgeOffsetY: 0 })
    })
    expect(captureVisualPreset(result.current).defaultSeparateBadgeOffsetX).toBe(0)
  })
})
