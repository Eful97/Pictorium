import { describe, it, expect } from "vitest"
import {
  GRADIENT_PRESET_COLOR,
  NATURAL_GRADIENT_DEFAULTS,
  naturalGradientForPoster,
  matchesGradientPreset,
  adjustGradientForPosterChange,
  defaultHeightForPoster,
  defaultFadeForPoster,
} from "@/lib/gradient-presets"
import {
  CLEAN_GRADIENT_HEIGHT,
  NON_CLEAN_GRADIENT_HEIGHT,
  CLEAN_BLUR_FADE,
  NON_CLEAN_BLUR_FADE,
} from "@/lib/gradient-defaults"

describe("gradient presets (slider shortcuts, no new server param)", () => {
  it("Colore values stay inside the slider bounds", () => {
    expect(GRADIENT_PRESET_COLOR.gradientHeight).toBeGreaterThanOrEqual(5)
    expect(GRADIENT_PRESET_COLOR.gradientHeight).toBeLessThanOrEqual(100)
    expect(GRADIENT_PRESET_COLOR.blurIntensity).toBeGreaterThanOrEqual(1)
    expect(GRADIENT_PRESET_COLOR.blurIntensity).toBeLessThanOrEqual(100)
    for (const k of ["blurFade", "blurDarkness", "tintStrength"] as const) {
      expect(GRADIENT_PRESET_COLOR[k]).toBeGreaterThanOrEqual(0)
      expect(GRADIENT_PRESET_COLOR[k]).toBeLessThanOrEqual(100)
    }
    expect(GRADIENT_PRESET_COLOR.blurEnabled).toBe(true)
  })

  it("Colore is taller, more tinted and has no dark veil", () => {
    const natural = naturalGradientForPoster({ iso_639_1: null })
    expect(GRADIENT_PRESET_COLOR.gradientHeight).toBeGreaterThan(natural.gradientHeight)
    expect(GRADIENT_PRESET_COLOR.tintStrength).toBeGreaterThan(natural.tintStrength)
    expect(GRADIENT_PRESET_COLOR.blurDarkness).toBe(0)
  })

  it("natural matches the Reset values (clean vs non-clean, landscape fade)", () => {
    expect(naturalGradientForPoster({ iso_639_1: null })).toMatchObject({
      gradientHeight: CLEAN_GRADIENT_HEIGHT,
      blurIntensity: 20,
      blurFade: CLEAN_BLUR_FADE,
      blurDarkness: 30,
      tintStrength: 20,
      blurEnabled: true,
    })
    expect(naturalGradientForPoster({ iso_639_1: "it" })).toMatchObject({
      gradientHeight: NON_CLEAN_GRADIENT_HEIGHT,
      blurFade: NON_CLEAN_BLUR_FADE,
    })
    expect(naturalGradientForPoster({ iso_639_1: null }, "landscape").blurFade).toBe(70)
  })

  it("matchesGradientPreset detects the active preset", () => {
    expect(matchesGradientPreset({ ...GRADIENT_PRESET_COLOR }, GRADIENT_PRESET_COLOR)).toBe(true)
    expect(
      matchesGradientPreset({ ...GRADIENT_PRESET_COLOR, tintStrength: 20 }, GRADIENT_PRESET_COLOR),
    ).toBe(false)
  })

  it("NATURAL_GRADIENT_DEFAULTS matches the Settings Reset values", () => {
    expect(NATURAL_GRADIENT_DEFAULTS).toEqual({
      gradientHeight: 30,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      tintStrength: 20,
      blurEnabled: true,
    })
  })

  it("adjustGradientForPosterChange recalibrates only from pristine state", () => {
    const clean = { iso_639_1: null }
    const nonClean = { iso_639_1: "it" }
    // Pristine clean (30/50) -> non-clean diventa (20/80).
    expect(
      adjustGradientForPosterChange({ gradientHeight: 30, blurFade: 50 }, clean, nonClean),
    ).toEqual({ gradientHeight: 20, blurFade: 80 })
    // Pristine non-clean -> clean diventa (30/50).
    expect(
      adjustGradientForPosterChange({ gradientHeight: 20, blurFade: 80 }, nonClean, clean),
    ).toEqual({ gradientHeight: 30, blurFade: 50 })
    // Preset Colore attivo: nessun tocco.
    expect(
      adjustGradientForPosterChange(
        { gradientHeight: GRADIENT_PRESET_COLOR.gradientHeight, blurFade: GRADIENT_PRESET_COLOR.blurFade },
        clean,
        nonClean,
      ),
    ).toBeNull()
    // Tweak manuale (solo un campo fuori default): nessun tocco.
    expect(
      adjustGradientForPosterChange({ gradientHeight: 30, blurFade: 65 }, clean, nonClean),
    ).toBeNull()
  })

  it("defaultHeightForPoster/defaultFadeForPoster keep custom defaults absolute", () => {
    const nonClean = { iso_639_1: "it" }
    // Legacy Naturale -> ricalibrazione per tipo.
    expect(defaultHeightForPoster(30, nonClean)).toBe(20)
    expect(defaultFadeForPoster(50, nonClean)).toBe(80)
    // Default Colore -> assoluti, mai ricalibrati.
    expect(defaultHeightForPoster(GRADIENT_PRESET_COLOR.gradientHeight, nonClean)).toBe(
      GRADIENT_PRESET_COLOR.gradientHeight,
    )
    expect(defaultFadeForPoster(GRADIENT_PRESET_COLOR.blurFade, nonClean)).toBe(
      GRADIENT_PRESET_COLOR.blurFade,
    )
  })
})
