/**
 * Quick presets Essenziale/Voti/Completo: Naturale assoluto + transform default
 * solo sul formato selezionato, altro formato preservato (isolated helpers),
 * globals invariati, scelte badge preservate, highlight sensibile a blur/offset.
 * Isolamento dimostrato via buildDefaultsPreviewUrl (stesso endpoint del
 * renderer, regola `land ?? flat`): full URL dell'altro formato byte-identico.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { NATURAL_GRADIENT_DEFAULTS } from "@/lib/gradient-presets"
import {
  DEFAULT_QUALITY_BADGE_OFFSET_X,
  DEFAULT_QUALITY_BADGE_OFFSET_Y,
  DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE,
  DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE,
  getSeparateBadgeDefaultScale,
} from "@/lib/badge-styles"
import { captureVisualPreset, portraitPresetPatch } from "@/lib/visual-presets"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"

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
  renderWithCtx(
    createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

/** Preview URL per forma dal ctx live (profilo RAW, come VisualPresetsSection/Apple). */
function previewUrl(c: PosterEditorCtx, shape: "portrait" | "landscape"): string {
  return buildDefaultsPreviewUrl({ ...captureVisualPreset(c), landscape: c.landscape, previewShape: shape })
}

/**
 * Profilo sparse: null ereditari (badgeFont/qualityBadgeStyle/videoFormats,
 * "segui i flat" su entrambi i lati) + override concreti
 * (extraBadgeStyle/gradientHeight/sashOrder) + extra raw fuori contratto
 * (minQuality, preservato opaco dagli helper isolati). La proiezione snapshot
 * landscape del Badge tab (presetSource) salta i null ereditari così
 * captureVisualPreset strict non lancia; i casi landscape usano gli stessi
 * seed dei portrait (null ora supportati anche nel tab orizzontale).
 */
function seedSparseLandscape() {
  localStorage.setItem("badgeDefaults", JSON.stringify({
    landscape: {
      badgeFont: null,
      qualityBadgeStyle: null,
      videoFormats: null,
      extraBadgeStyle: "vetro",
      gradientHeight: 45,
      sashOrder: ["award"],
      minQuality: "4K",
    },
  }))
}

/** Seed landscape senza null ereditari (solo concreti + extra raw). */
function seedLandscapeConcrete() {
  localStorage.setItem("badgeDefaults", JSON.stringify({
    landscape: {
      extraBadgeStyle: "vetro",
      gradientHeight: 45,
      sashOrder: ["award"],
      minQuality: "4K",
    },
  }))
}

function expectSparseNullHereditary(c: PosterEditorCtx) {
  expect(c.landscape.badgeFont).toBeNull()
  expect(c.landscape.videoFormats).toBeNull()
}

function expectConcreteOverridesPreserved(c: PosterEditorCtx) {
  expect(c.landscape.extraBadgeStyle).toBe("vetro")
  expect(c.landscape.sashOrder).toEqual(["award"])
  // Extra raw fuori contratto (es. minQuality server): passa opaco, mai perso.
  expect((c.landscape as Record<string, unknown>).minQuality).toBe("4K")
}

function presetButton(key: string): HTMLElement {
  const label = screen.getByText(key)
  const btn = label.closest("button")
  if (!btn) throw new Error(`button for ${key} not found`)
  return btn as HTMLElement
}

function isActive(btn: HTMLElement): boolean {
  return btn.className.includes("bg-accent-orange/15")
}

async function customize(ctx: () => PosterEditorCtx) {
  await act(async () => {
    const c = ctx()
    c.setDefaultGradientHeight(10)
    c.setDefaultBlurIntensity(99)
    c.setDefaultTopShade(10)
    c.setDefaultTopBadgeScale(150)
    c.setDefaultTopBadgeOffsetX(5)
    c.setDefaultGenreBadgeOffsetY(7)
    c.setDefaultQualityBadgeOffsetX(5)
    c.setDefaultSeparateBadgeScale(100)
    c.setDefaultNetworkLogoOffsetY(9)
    c.setDefaultLogoScale(50)
    c.setDefaultLogoOffsetX(4)
    c.setDefaultRatingSources(["imdb", "letterboxd"])
    c.setDefaultLogoAlign("left")
    c.setDefaultPortraitFitEnabled(false)
    c.setDefaultLandscapeFitEnabled(false)
    c.setDefaultSashOrder(["extra"])
    c.setDefaultBadgeFont("oswald")
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
}

function expectPortraitNatural(c: PosterEditorCtx) {
  expect(c.defaultBlurEnabled).toBe(NATURAL_GRADIENT_DEFAULTS.blurEnabled)
  expect(c.defaultGradientHeight).toBe(NATURAL_GRADIENT_DEFAULTS.gradientHeight)
  expect(c.defaultBlurIntensity).toBe(NATURAL_GRADIENT_DEFAULTS.blurIntensity)
  expect(c.defaultBlurFade).toBe(NATURAL_GRADIENT_DEFAULTS.blurFade)
  expect(c.defaultBlurDarkness).toBe(NATURAL_GRADIENT_DEFAULTS.blurDarkness)
  expect(c.defaultTintStrength).toBe(NATURAL_GRADIENT_DEFAULTS.tintStrength)
  expect(c.defaultTopShade).toBe(50)
  expect(c.defaultLogoScale).toBeNull()
  expect(c.defaultLogoOffsetX).toBeNull()
  expect(c.defaultLogoOffsetY).toBeNull()
  expect(c.defaultTopBadgeScale).toBe(100)
  expect(c.defaultTopBadgeOffsetX).toBe(0)
  expect(c.defaultTopBadgeOffsetY).toBe(0)
  expect(c.defaultGenreBadgeScale).toBe(100)
  expect(c.defaultGenreBadgeOffsetX).toBe(0)
  expect(c.defaultGenreBadgeOffsetY).toBe(0)
  expect(c.defaultQualityBadgeScale).toBe(100)
  expect(c.defaultQualityBadgeOffsetX).toBe(DEFAULT_QUALITY_BADGE_OFFSET_X)
  expect(c.defaultQualityBadgeOffsetY).toBe(DEFAULT_QUALITY_BADGE_OFFSET_Y)
  expect(c.defaultSeparateBadgeScale).toBe(getSeparateBadgeDefaultScale(undefined))
  expect(c.defaultSeparateBadgeOffsetX).toBe(0)
  expect(c.defaultSeparateBadgeOffsetY).toBe(0)
  expect(c.defaultNetworkLogoScale).toBe(100)
  expect(c.defaultNetworkLogoOffsetX).toBe(0)
  expect(c.defaultNetworkLogoOffsetY).toBe(0)
}

function expectLandscapeNatural(c: PosterEditorCtx) {
  const l = c.landscape
  expect(l.blurEnabled).toBe(NATURAL_GRADIENT_DEFAULTS.blurEnabled)
  expect(l.gradientHeight).toBe(NATURAL_GRADIENT_DEFAULTS.gradientHeight)
  expect(l.blurIntensity).toBe(NATURAL_GRADIENT_DEFAULTS.blurIntensity)
  expect(l.blurFade).toBe(NATURAL_GRADIENT_DEFAULTS.blurFade)
  expect(l.blurDarkness).toBe(NATURAL_GRADIENT_DEFAULTS.blurDarkness)
  expect(l.tintStrength).toBe(NATURAL_GRADIENT_DEFAULTS.tintStrength)
  expect(l.topShade).toBe(50)
  expect(l.logoScale).toBeNull()
  expect(l.logoOffsetX).toBeNull()
  expect(l.logoOffsetY).toBeNull()
  expect(l.topBadgeScale).toBe(100)
  expect(l.topBadgeOffsetX).toBe(0)
  expect(l.topBadgeOffsetY).toBe(0)
  expect(l.genreBadgeScale).toBe(100)
  expect(l.genreBadgeOffsetX).toBe(0)
  expect(l.genreBadgeOffsetY).toBe(0)
  expect(l.qualityBadgeScale).toBe(100)
  expect(l.qualityBadgeOffsetX).toBe(DEFAULT_QUALITY_BADGE_OFFSET_X_LANDSCAPE)
  expect(l.qualityBadgeOffsetY).toBe(DEFAULT_QUALITY_BADGE_OFFSET_Y_LANDSCAPE)
  expect(l.separateBadgeScale).toBe(getSeparateBadgeDefaultScale(undefined))
  expect(l.separateBadgeOffsetX).toBe(0)
  expect(l.separateBadgeOffsetY).toBe(0)
  expect(l.networkLogoScale).toBe(100)
  expect(l.networkLogoOffsetX).toBe(0)
  expect(l.networkLogoOffsetY).toBe(0)
}

function expectGlobalsUnchanged(c: PosterEditorCtx) {
  expect(c.defaultRatingSources).toEqual(["imdb", "letterboxd"])
  expect(c.defaultLogoAlign).toBe("left")
  expect(c.defaultPortraitFitEnabled).toBe(false)
  expect(c.defaultLandscapeFitEnabled).toBe(false)
  expect(c.defaultPosterShape).toBe("poster")
}

function expectUnrelatedPreserved(c: PosterEditorCtx) {
  expect(c.defaultSashOrder).toEqual(["extra"])
  expect(c.defaultBadgeFont).toBe("oswald")
}

describe("quick presets natural+transform isolated", () => {
  it("portrait Essenziale: reset valori, URL landscape invariato, globals/badge retained, highlight off su blur/offset", async () => {
    seedSparseLandscape()
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await customize(ctx)
    const landBefore = previewUrl(ctx(), "landscape")
    fireEvent.click(presetButton("ui.configPresetEssential"))
    const c = ctx()
    // Badge scelte preservate (flat portrait).
    expect(c.defaultGlobalBadges).toBe(true)
    expect(c.defaultBadgeGenre).toBe(true)
    expect(c.defaultBadgeYear).toBe(true)
    expect(c.defaultBadgeRating).toBe(false)
    expect(c.defaultBadgeQuality).toBe(false)
    expect(c.defaultRankingBadges).toBe(false)
    expect(c.defaultNetworkLogo).toBe(false)
    expect(c.defaultBadgeStyle).toBe("minimal")
    // Reset canonico portrait.
    expectPortraitNatural(c)
    // Altro formato: full URL landscape reale invariato (freeze eredità, non output mosso).
    expect(previewUrl(c, "landscape")).toBe(landBefore)
    // Profilo sparse: null ereditari + override concreti + extra raw preservati.
    expectSparseNullHereditary(c)
    expect(c.landscape.qualityBadgeStyle).toBeNull()
    expectConcreteOverridesPreserved(c)
    expect(c.landscape.gradientHeight).toBe(45)
    // Globals + unrelated preservati.
    expectGlobalsUnchanged(c)
    expectUnrelatedPreserved(c)
    // Highlight attivo, poi si disattiva su blur e su offset.
    expect(isActive(presetButton("ui.configPresetEssential"))).toBe(true)
    await act(async () => {
      ctx().setDefaultBlurIntensity(99)
    })
    expect(isActive(presetButton("ui.configPresetEssential"))).toBe(false)
    fireEvent.click(presetButton("ui.configPresetEssential"))
    expect(isActive(presetButton("ui.configPresetEssential"))).toBe(true)
    await act(async () => {
      ctx().setDefaultTopBadgeOffsetX(5)
    })
    expect(isActive(presetButton("ui.configPresetEssential"))).toBe(false)
  })

  it("landscape Essenziale: solo profilo, flat e URL portrait invariati, globals/badge retained", async () => {
    seedLandscapeConcrete()
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await customize(ctx)
    const flatsBefore = JSON.stringify(portraitPresetPatch(captureVisualPreset(ctx())))
    const portBefore = previewUrl(ctx(), "portrait")
    fireEvent.click(presetButton("ui.configPresetEssential"))
    const c = ctx()
    // Nessun leakage sui flat: proiezione portrait e full URL portrait intatti.
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(c)))).toBe(flatsBefore)
    expect(previewUrl(c, "portrait")).toBe(portBefore)
    expect(c.defaultGradientHeight).toBe(10)
    expect(c.defaultTopBadgeScale).toBe(150)
    // Profilo landscape = reset canonico orizzontale (quality 0/0).
    expectLandscapeNatural(c)
    expect(c.landscape.globalBadges).toBe(true)
    expect(c.landscape.badgeStyle).toBe("minimal")
    expect(c.landscape.badgeRating).toBe(false)
    // Concreti non toccati dal preset + extra raw sotto il patch.
    expect(c.landscape.extraBadgeStyle).toBe("vetro")
    expect(c.landscape.sashOrder).toEqual(["award"])
    expect((c.landscape as Record<string, unknown>).minQuality).toBe("4K")
    expectGlobalsUnchanged(c)
    expectUnrelatedPreserved(c)
    expect(isActive(presetButton("ui.configPresetEssential"))).toBe(true)
    await act(async () => {
      ctx().setLandscape({ blurIntensity: 99 })
    })
    expect(isActive(presetButton("ui.configPresetEssential"))).toBe(false)
  })

  it("portrait Voti: reset valori, URL landscape invariato, sources preservate, highlight off su offset", async () => {
    seedSparseLandscape()
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await customize(ctx)
    const landBefore = previewUrl(ctx(), "landscape")
    fireEvent.click(presetButton("ui.configPresetRatings"))
    const c = ctx()
    expect(c.defaultGlobalBadges).toBe(true)
    expect(c.defaultBadgeGenre).toBe(false)
    expect(c.defaultBadgeYear).toBe(true)
    expect(c.defaultBadgeRating).toBe(true)
    expect(c.defaultBadgeQuality).toBe(true)
    expect(c.defaultRankingBadges).toBe(false)
    expect(c.defaultNetworkLogo).toBe(false)
    expect(c.defaultBadgeStyle).toBe("pill")
    expect(c.defaultQualityBadgeStyle).toBe("standard")
    expect(c.defaultSeparateRatings).toBe(false)
    expectPortraitNatural(c)
    expect(previewUrl(c, "landscape")).toBe(landBefore)
    // Isolamento: sources custom preservate (mai forzate a imdb/tmdb).
    expect(c.defaultRatingSources).toEqual(["imdb", "letterboxd"])
    expectGlobalsUnchanged(c)
    expectUnrelatedPreserved(c)
    // qualityBadgeStyle esplicito nel preset: flat standard, profilo null-ereditario intatto.
    expect(c.landscape.qualityBadgeStyle).toBeNull()
    expectSparseNullHereditary(c)
    expectConcreteOverridesPreserved(c)
    expect(isActive(presetButton("ui.configPresetRatings"))).toBe(true)
    await act(async () => {
      ctx().setDefaultGenreBadgeOffsetY(7)
    })
    expect(isActive(presetButton("ui.configPresetRatings"))).toBe(false)
  })

  it("landscape Voti: solo profilo, flat e URL portrait invariati, sources preservate", async () => {
    seedLandscapeConcrete()
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await customize(ctx)
    const flatsBefore = JSON.stringify(portraitPresetPatch(captureVisualPreset(ctx())))
    const portBefore = previewUrl(ctx(), "portrait")
    fireEvent.click(presetButton("ui.configPresetRatings"))
    const c = ctx()
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(c)))).toBe(flatsBefore)
    expect(previewUrl(c, "portrait")).toBe(portBefore)
    expect(c.defaultGradientHeight).toBe(10)
    expectLandscapeNatural(c)
    expect(c.landscape.badgeGenre).toBe(false)
    expect(c.landscape.badgeRating).toBe(true)
    expect(c.landscape.badgeQuality).toBe(true)
    expect(c.landscape.qualityBadgeStyle).toBe("standard")
    expect(c.landscape.badgeStyle).toBe("pill")
    // Nessun reset globale fonti nemmeno in landscape.
    expect(c.defaultRatingSources).toEqual(["imdb", "letterboxd"])
    expectGlobalsUnchanged(c)
    expect((c.landscape as Record<string, unknown>).minQuality).toBe("4K")
    expect(isActive(presetButton("ui.configPresetRatings"))).toBe(true)
    await act(async () => {
      ctx().setLandscape({ topBadgeOffsetX: 5 })
    })
    expect(isActive(presetButton("ui.configPresetRatings"))).toBe(false)
  })

  it("portrait Completo: reset valori, URL landscape invariato, globals retained, highlight off su blur", async () => {
    seedSparseLandscape()
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await customize(ctx)
    const landBefore = previewUrl(ctx(), "landscape")
    fireEvent.click(presetButton("ui.configPresetFull"))
    const c = ctx()
    expect(c.defaultGlobalBadges).toBe(true)
    expect(c.defaultBadgeGenre).toBe(true)
    expect(c.defaultBadgeYear).toBe(true)
    expect(c.defaultBadgeRating).toBe(true)
    expect(c.defaultBadgeQuality).toBe(true)
    expect(c.defaultRankingBadges).toBe(true)
    expect(c.defaultRankingBadgeStyle).toBe("default")
    expect(c.defaultNetworkLogo).toBe(true)
    expect(c.defaultBadgeStyle).toBe("pill")
    expectPortraitNatural(c)
    expect(previewUrl(c, "landscape")).toBe(landBefore)
    expect(c.defaultRatingSources).toEqual(["imdb", "letterboxd"])
    expectGlobalsUnchanged(c)
    expectUnrelatedPreserved(c)
    expectSparseNullHereditary(c)
    expectConcreteOverridesPreserved(c)
    expect(isActive(presetButton("ui.configPresetFull"))).toBe(true)
    await act(async () => {
      ctx().setDefaultBlurFade(1)
    })
    expect(isActive(presetButton("ui.configPresetFull"))).toBe(false)
  })

  it("landscape Completo: solo profilo, flat e URL portrait invariati", async () => {
    seedLandscapeConcrete()
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await customize(ctx)
    const flatsBefore = JSON.stringify(portraitPresetPatch(captureVisualPreset(ctx())))
    const portBefore = previewUrl(ctx(), "portrait")
    fireEvent.click(presetButton("ui.configPresetFull"))
    const c = ctx()
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(c)))).toBe(flatsBefore)
    expect(previewUrl(c, "portrait")).toBe(portBefore)
    expect(c.defaultGradientHeight).toBe(10)
    expect(c.defaultTopBadgeScale).toBe(150)
    expectLandscapeNatural(c)
    expect(c.landscape.badgeGenre).toBe(true)
    expect(c.landscape.rankingBadges).toBe(true)
    expect(c.landscape.rankingBadgeStyle).toBe("default")
    expect(c.landscape.networkLogo).toBe(true)
    expect(c.landscape.badgeStyle).toBe("pill")
    expectGlobalsUnchanged(c)
    expect((c.landscape as Record<string, unknown>).minQuality).toBe("4K")
    expect(isActive(presetButton("ui.configPresetFull"))).toBe(true)
    await act(async () => {
      ctx().setLandscape({ separateBadgeOffsetY: 4 })
    })
    expect(isActive(presetButton("ui.configPresetFull"))).toBe(false)
  })

  it("landscape sparse-null: render senza throw, quick3/Apple coerenti, null ereditari preservati", async () => {
    seedSparseLandscape()
    // Il render stesso è la regressione: presetSource copiava i null ereditari
    // nei flat strict e captureVisualPreset lanciava ZodError.
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    await customize(ctx)
    const flatsBefore = JSON.stringify(portraitPresetPatch(captureVisualPreset(ctx())))
    const portBefore = previewUrl(ctx(), "portrait")
    fireEvent.click(presetButton("ui.configPresetEssential"))
    let c = ctx()
    // Nessun leakage sui flat: proiezione portrait e full URL portrait intatti.
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(c)))).toBe(flatsBefore)
    expect(previewUrl(c, "portrait")).toBe(portBefore)
    expectLandscapeNatural(c)
    // Null ereditari non toccati dal preset: restano null nel profilo.
    expect(c.landscape.badgeFont).toBeNull()
    expect(c.landscape.qualityBadgeStyle).toBeNull()
    expect(c.landscape.videoFormats).toBeNull()
    expectConcreteOverridesPreserved(c)
    expectGlobalsUnchanged(c)
    expect(isActive(presetButton("ui.configPresetEssential"))).toBe(true)
    fireEvent.click(presetButton("ui.configPresetRatings"))
    c = ctx()
    // qualityBadgeStyle esplicito nel preset: profilo concreto, altri null intatti.
    expect(c.landscape.qualityBadgeStyle).toBe("standard")
    expect(c.landscape.badgeFont).toBeNull()
    expect(c.landscape.videoFormats).toBeNull()
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(c)))).toBe(flatsBefore)
    expect(previewUrl(c, "portrait")).toBe(portBefore)
    expect(isActive(presetButton("ui.configPresetRatings"))).toBe(true)
    fireEvent.click(presetButton("ui.configPresetFull"))
    c = ctx()
    expect(isActive(presetButton("ui.configPresetFull"))).toBe(true)
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(c)))).toBe(flatsBefore)
    // Apple builtin: stesso path isolato, nessun throw, flat portrait e URL
    // portrait invariati, profilo valorizzato Apple, extra raw sopravvive.
    // (Highlight volutamente non asserito: l'extraBadgeStyle "vetro" del seed
    // resta nel profilo per disegno — gli extra fuori preset sopravvivono
    // all'apply — quindi l'effettivo non coincide con Apple ed è corretto
    // che l'highlight resti spento.)
    const appleBtn = screen.getByText("Stile Apple").closest("button") as HTMLElement
    fireEvent.click(appleBtn)
    c = ctx()
    expect(c.landscape.blurFade).toBe(100)
    expect(c.landscape.qualityBadgeStyle).toBe("color")
    expect(JSON.stringify(portraitPresetPatch(captureVisualPreset(c)))).toBe(flatsBefore)
    expect(previewUrl(c, "portrait")).toBe(portBefore)
    expect((c.landscape as Record<string, unknown>).minQuality).toBe("4K")
    expectGlobalsUnchanged(c)
  })
})
