/**
 * Builtin Apple 1-click (accanto a BetterPoster/RPDB):
 * - costante fedele al preset-export (valori inline, mai il file Desktop):
 *   flat = portrait, nested `landscape` = orizzontale;
 * - apply SOLO proiezione formato via helper esistenti
 *   (applyPortraitIsolated/applyLandscapeIsolated): fonti voti, logo align,
 *   fit flag e delivery immutati in entrambi i target;
 * - highlight = proiezione intera per forma, mai subset di chiavi;
 * - isolamento effective dimostrato via buildDefaultsPreviewUrl (stesso
 *   endpoint del renderer, regola `land ?? flat`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import {
  APPLE_PRESET_LABEL,
  APPLE_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import {
  applyLandscapeIsolated,
  applyPortraitIsolated,
  captureVisualPreset,
  landscapeProfilePatch,
  portraitPresetPatch,
  resolveEffectiveLandscape,
  visualPresetValuesSchema,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

function renderBadge(shape: "portrait" | "landscape") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
  return { ctx: () => ctx as PosterEditorCtx }
}

function renderSettings() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
      createElement(Probe),
    ),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

function appleButton(): HTMLElement {
  const btn = screen.getByText("Stile Apple").closest("button")
  if (!btn) throw new Error("Apple preset button not found")
  return btn
}

function isHighlighted(btn: HTMLElement): boolean {
  return btn.className.includes("ring-accent-orange/30")
}

/** Preview URL per forma dal ctx live (profilo RAW, come VisualPresetsSection). */
function previewUrl(c: PosterEditorCtx, shape: "portrait" | "landscape"): string {
  return buildDefaultsPreviewUrl({ ...captureVisualPreset(c), landscape: c.landscape, previewShape: shape })
}

describe("APPLE_VISUAL_DEFAULTS fedeltà al preset-export", () => {
  it("label e schema: costante valida e stabile", () => {
    expect(APPLE_PRESET_LABEL).toBe("Apple")
    expect(visualPresetValuesSchema.parse(APPLE_VISUAL_DEFAULTS)).toEqual(APPLE_VISUAL_DEFAULTS)
  })

  it("flat portrait: valori distintivi Apple", () => {
    const v = APPLE_VISUAL_DEFAULTS
    expect(v.defaultLogoOffsetY).toBe(-40)
    expect(v.defaultGenreBadgeOffsetY).toBe(-40)
    expect(v.defaultBlurFade).toBe(50)
    expect(v.defaultQualityBadgeStyle).toBe("knockout")
    expect(v.defaultRankingBadgeStyle).toBe("number")
    expect(v.defaultRatingSources).toEqual(["imdb", "tmdb"])
    expect(v.defaultSashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    expect(v.defaultVideoFormats).toEqual(["dv", "atmos", "imax", "hdr", "hdr10plus"])
    expect(v.defaultNetworkLogo).toBe(true)
    expect(v.defaultRibbonEnabled).toBe(true)
    expect(v.defaultRibbonSide).toBe("left")
    expect(v.defaultPreRelease).toBe(true)
    expect(v.defaultGradientHeight).toBe(50)
    expect(v.defaultBlurEnabled).toBe(true)
    expect(v.defaultBlurIntensity).toBe(1)
    expect(v.defaultBlurDarkness).toBe(100)
    expect(v.defaultTintStrength).toBe(0)
    expect(v.defaultBadgeYear).toBe(false)
    expect(v.defaultBadgeQuality).toBe(false)
    expect(v.defaultBadgeStyle).toBe("minimal")
    expect(v.defaultBadgeFont).toBe("inter")
    expect(v.defaultSeparateRatingsStyle).toBe("column")
    expect(v.defaultPosterShape).toBe("poster")
    expect(v.defaultLogoAlign).toBeNull()
  })

  it("nested landscape: divergenze orizzontali Apple", () => {
    const land = APPLE_VISUAL_DEFAULTS.landscape
    expect(land.logoOffsetY).toBeNull()
    expect(land.genreBadgeOffsetY).toBe(0)
    expect(land.blurFade).toBe(100)
    expect(land.qualityBadgeStyle).toBe("color")
    expect(land.gradientHeight).toBe(50)
    expect(land.blurIntensity).toBe(1)
    expect(land.blurDarkness).toBe(100)
    expect(land.tintStrength).toBe(0)
    expect(land.rankingBadgeStyle).toBe("number")
    expect(land.badgeFont).toBe("inter")
    expect(land.badgeStyle).toBe("minimal")
    expect(land.sashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    expect(land.videoFormats).toEqual(["dv", "atmos", "imax", "hdr", "hdr10plus"])
    expect(land.networkLogo).toBe(true)
    expect(land.ribbonEnabled).toBe(true)
    expect(land.preRelease).toBe(true)
    expect(land.separateRatingsStyle).toBe("column")
  })
})

describe("Apple via helper isolati (unità, senza UI)", () => {
  // Profilo sparso con null ereditari + flat diversi da Apple: il caso che
  // romperebbe l'effettivo se il portrait scrivesse i flat senza congelare.
  function sparseCurrent(): VisualPresetValues {
    return captureVisualPreset({
      ...APPLE_VISUAL_DEFAULTS,
      defaultBadgeStyle: "shadow",
      defaultRankingBadgeStyle: "default",
      defaultGenreBadgeOffsetY: 10,
      defaultLogoOffsetY: 5,
      defaultBlurFade: 20,
      defaultQualityBadgeStyle: "standard",
      defaultSashOrder: ["extra"],
      defaultRatingSources: ["imdb", "tmdb", "trakt"],
      defaultPosterShape: "landscape",
      landscape: {
        badgeStyle: "pill",
        qualityBadgeStyle: null,
        videoFormats: null,
        extraBadgeStyle: "vetro",
        gradientHeight: 45,
        sashOrder: ["award"],
      },
    } as VisualPresetValues)
  }

  it("portrait: proiezione Apple sui flat, effettivo landscape invariato", () => {
    const current = sparseCurrent()
    const before = JSON.stringify(resolveEffectiveLandscape(current))
    const next = applyPortraitIsolated(current, APPLE_VISUAL_DEFAULTS)
    expect(portraitPresetPatch(next)).toEqual(portraitPresetPatch(APPLE_VISUAL_DEFAULTS))
    expect(JSON.stringify(resolveEffectiveLandscape(next))).toBe(before)
    // Globali fuori proiezione immutati (come i preset personali).
    expect(next.defaultRatingSources).toEqual(["imdb", "tmdb", "trakt"])
    expect(next.defaultPosterShape).toBe("landscape")
    expect(next.defaultLogoAlign).toBeNull()
  })

  it("landscape: solo profilo, flat/globali/delivery intatti", () => {
    const current = sparseCurrent()
    const flatsBefore = JSON.stringify(portraitPresetPatch(current))
    const next = applyLandscapeIsolated(current, APPLE_VISUAL_DEFAULTS)
    expect(JSON.stringify(portraitPresetPatch(next))).toBe(flatsBefore)
    expect(next.defaultRatingSources).toEqual(["imdb", "tmdb", "trakt"])
    expect(next.defaultPosterShape).toBe("landscape")
    expect(next.defaultLogoAlign).toBeNull()
    // Profilo = proiezione landscape Apple sopra gli extra esistenti.
    expect(next.landscape).toMatchObject(landscapeProfilePatch(APPLE_VISUAL_DEFAULTS))
    expect(next.landscape.blurFade).toBe(100)
    expect(next.landscape.qualityBadgeStyle).toBe("color")
    expect(next.landscape.genreBadgeOffsetY).toBe(0)
    expect(next.landscape.logoOffsetY).toBeNull()
    expect(next.landscape.extraBadgeStyle).toBe("vetro")
  })
})

describe("Apple builtin UI (isolamento per target)", () => {
  it("portrait: scrive i flat Apple, URL landscape effective byte-identico", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterShape: "landscape",
      defaultBadgeStyle: "shadow",
      defaultRankingBadgeStyle: "default",
      defaultGenreBadgeOffsetY: 10,
      defaultLogoOffsetY: 5,
      defaultBlurFade: 20,
      defaultQualityBadgeStyle: "standard",
      defaultSashOrder: ["extra"],
      defaultRatingSources: ["imdb", "tmdb", "trakt"],
      landscape: {
        badgeStyle: "pill",
        qualityBadgeStyle: null,
        videoFormats: null,
        extraBadgeStyle: "vetro",
        gradientHeight: 45,
        sashOrder: ["award"],
      },
    }))
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(isHighlighted(appleButton())).toBe(false)
    const landBefore = previewUrl(ctx(), "landscape")
    const portBefore = previewUrl(ctx(), "portrait")
    expect(landBefore).not.toBe(portBefore)
    fireEvent.click(appleButton())
    // Flat Apple applicati.
    expect(ctx().defaultGenreBadgeOffsetY).toBe(-40)
    expect(ctx().defaultLogoOffsetY).toBe(-40)
    expect(ctx().defaultBlurFade).toBe(50)
    expect(ctx().defaultQualityBadgeStyle).toBe("knockout")
    expect(ctx().defaultRankingBadgeStyle).toBe("number")
    expect(ctx().defaultSashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    // Globali e delivery immutati (fonti voti fuori proiezione).
    expect(ctx().defaultRatingSources).toEqual(["imdb", "tmdb", "trakt"])
    expect(ctx().defaultPosterShape).toBe("landscape")
    // Effettivo landscape invariato: eredità congelata, non output mosso.
    expect(previewUrl(ctx(), "landscape")).toBe(landBefore)
    // Highlight proiezione portrait intera.
    expect(isHighlighted(appleButton())).toBe(true)
  })

  it("landscape: profilo Apple, flat/globali/delivery e URL portrait intatti", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterShape: "poster",
      defaultBadgeStyle: "shadow",
      defaultRatingSources: ["imdb"],
      defaultLogoAlign: "left",
      landscape: {},
    }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    const flatsBefore = JSON.stringify(portraitPresetPatch(captureVisualPreset(ctx())))
    const portBefore = previewUrl(ctx(), "portrait")
    fireEvent.click(appleButton())
    // Profilo Apple applicato (flat nested + nested landscape vince).
    expect(ctx().landscape.blurFade).toBe(100)
    expect(ctx().landscape.qualityBadgeStyle).toBe("color")
    expect(ctx().landscape.genreBadgeOffsetY).toBe(0)
    expect(ctx().landscape.logoOffsetY).toBeNull()
    expect(ctx().landscape.rankingBadgeStyle).toBe("number")
    expect(ctx().landscape.networkLogo).toBe(true)
    expect(ctx().landscape.ribbonEnabled).toBe(true)
    expect(ctx().landscape.sashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    // Flat, globali e delivery intatti.
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(ctx())))).toBe(flatsBefore)
    expect(ctx().defaultBadgeStyle).toBe("shadow")
    expect(ctx().defaultRatingSources).toEqual(["imdb"])
    expect(ctx().defaultLogoAlign).toBe("left")
    expect(ctx().defaultPosterShape).toBe("poster")
    // Effettivo portrait invariato.
    expect(previewUrl(ctx(), "portrait")).toBe(portBefore)
    // Highlight proiezione landscape intera.
    expect(isHighlighted(appleButton())).toBe(true)
  })
})
