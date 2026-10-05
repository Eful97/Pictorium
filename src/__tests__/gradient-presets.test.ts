import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  GRADIENT_PRESET_COLOR,
  NATURAL_GRADIENT_DEFAULTS,
  naturalGradientForPoster,
  matchesGradientPreset,
  adjustGradientForPosterChange,
  defaultHeightForPoster,
  defaultFadeForPoster,
  MAX_CUSTOM_GRADIENT_PRESETS,
  sanitizeCustomPresets,
  addCustomGradientPreset,
  deleteCustomGradientPreset,
  canAddCustomGradientPreset,
  getCustomGradientPresets,
  resetCustomPresetStore,
} from "@/lib/gradient-presets"
import {
  CLEAN_GRADIENT_HEIGHT,
  NON_CLEAN_GRADIENT_HEIGHT,
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

  it("GRADIENT_PRESET_COLOR matches the reference values", () => {
    expect(GRADIENT_PRESET_COLOR).toEqual({
      gradientHeight: 35,
      blurIntensity: 20,
      blurFade: 10,
      blurDarkness: 0,
      tintStrength: 100,
      blurEnabled: true,
    })
  })

  it("Colore is taller, more tinted and has no dark veil", () => {
    const natural = naturalGradientForPoster({ iso_639_1: null })
    expect(GRADIENT_PRESET_COLOR.gradientHeight).toBeGreaterThan(natural.gradientHeight)
    expect(GRADIENT_PRESET_COLOR.tintStrength).toBeGreaterThan(natural.tintStrength)
    expect(GRADIENT_PRESET_COLOR.blurDarkness).toBe(0)
    expect(GRADIENT_PRESET_COLOR.blurIntensity).toBe(natural.blurIntensity)
    expect(natural.blurIntensity).toBe(20)
  })

  it("natural matches the Reset values (intensity 20, fade 50, landscape 70)", () => {
    expect(naturalGradientForPoster({ iso_639_1: null })).toMatchObject({
      gradientHeight: CLEAN_GRADIENT_HEIGHT,
      blurIntensity: 20,
      blurFade: 50,
      blurDarkness: 30,
      tintStrength: 20,
      blurEnabled: true,
    })
    expect(naturalGradientForPoster({ iso_639_1: "it" })).toMatchObject({
      gradientHeight: NON_CLEAN_GRADIENT_HEIGHT,
      blurIntensity: 20,
      blurFade: 50,
    })
    expect(naturalGradientForPoster({ iso_639_1: null }, "landscape").blurFade).toBe(70)
    expect(naturalGradientForPoster({ iso_639_1: null }, "landscape").blurIntensity).toBe(20)
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
    // Factory storiche (30/50) -> ricalibrazione per tipo.
    expect(defaultHeightForPoster(30, nonClean)).toBe(20)
    expect(defaultFadeForPoster(50, nonClean)).toBe(80)
    // Default Colore -> assoluti, mai ricalibrati (fade 60 NON scatta la
    // ricalibrazione: il confronto è sulle factory storiche, non su Naturale).
    expect(defaultHeightForPoster(GRADIENT_PRESET_COLOR.gradientHeight, nonClean)).toBe(
      GRADIENT_PRESET_COLOR.gradientHeight,
    )
    expect(defaultFadeForPoster(GRADIENT_PRESET_COLOR.blurFade, nonClean)).toBe(
      GRADIENT_PRESET_COLOR.blurFade,
    )
    // Default Naturale (30/50 = factory storiche) -> ricalibrazione per tipo.
    expect(defaultFadeForPoster(NATURAL_GRADIENT_DEFAULTS.blurFade, { iso_639_1: null })).toBe(50)
  })
})

describe("custom gradient presets (local shortcuts, max 3 + 2 built-in = 5)", () => {
  beforeEach(() => {
    resetCustomPresetStore()
  })

  it("caps custom slots at 3 (5 totali con Naturale/Colore)", () => {
    expect(MAX_CUSTOM_GRADIENT_PRESETS).toBe(3)
    expect(canAddCustomGradientPreset()).toBe(true)
    for (let i = 0; i < MAX_CUSTOM_GRADIENT_PRESETS; i++) {
      expect(addCustomGradientPreset(`P${i}`, { ...NATURAL_GRADIENT_DEFAULTS })).not.toBeNull()
    }
    expect(canAddCustomGradientPreset()).toBe(false)
    expect(addCustomGradientPreset("overflow", { ...NATURAL_GRADIENT_DEFAULTS })).toBeNull()
  })

  it("rejects empty names and out-of-range values", () => {
    expect(addCustomGradientPreset("   ", { ...NATURAL_GRADIENT_DEFAULTS })).toBeNull()
    expect(
      addCustomGradientPreset("bad", { ...NATURAL_GRADIENT_DEFAULTS, blurIntensity: 101 }),
    ).toBeNull()
    expect(canAddCustomGradientPreset()).toBe(true)
  })

  it("delete frees a slot", () => {
    const p = addCustomGradientPreset("mine", { ...NATURAL_GRADIENT_DEFAULTS })
    expect(p).not.toBeNull()
    expect(deleteCustomGradientPreset(p!.id)).toBe(true)
    expect(deleteCustomGradientPreset(p!.id)).toBe(false)
    expect(canAddCustomGradientPreset()).toBe(true)
  })

  it("sanitize drops garbage, dupes and over-cap entries", () => {
    const good = { id: "a", name: "Ok", values: { ...NATURAL_GRADIENT_DEFAULTS } }
    const out = sanitizeCustomPresets([
      good,
      { id: "a", name: "Dupe", values: { ...NATURAL_GRADIENT_DEFAULTS } },
      { id: "", name: "NoId", values: { ...NATURAL_GRADIENT_DEFAULTS } },
      { id: "b", name: "   ", values: { ...NATURAL_GRADIENT_DEFAULTS } },
      { id: "c", name: "Bad", values: { ...NATURAL_GRADIENT_DEFAULTS, tintStrength: -1 } },
      "junk",
      { id: "d", name: "Second", values: { ...NATURAL_GRADIENT_DEFAULTS } },
      { id: "e", name: "Third", values: { ...NATURAL_GRADIENT_DEFAULTS } },
      { id: "f", name: "OverCap", values: { ...NATURAL_GRADIENT_DEFAULTS } },
    ])
    expect(out.map((p) => p.id)).toEqual(["a", "d", "e"])
    expect(sanitizeCustomPresets(null)).toEqual([])
  })

  it("getCustomGradientPresets mirrors the live store", () => {
    expect(getCustomGradientPresets()).toEqual([])
    addCustomGradientPreset("Live", { ...NATURAL_GRADIENT_DEFAULTS })
    expect(getCustomGradientPresets().map((p) => p.name)).toEqual(["Live"])
  })

  it("requirePersistence writes storage exactly once on success", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem")
    try {
      expect(addCustomGradientPreset("Once", { ...NATURAL_GRADIENT_DEFAULTS }, { requirePersistence: true })).not.toBeNull()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(getCustomGradientPresets().map((p) => p.name)).toEqual(["Once"])
    } finally {
      spy.mockRestore()
    }
  })

  it("requirePersistence rejects when storage is unavailable, default path keeps memory fallback", () => {
    const desc = Object.getOwnPropertyDescriptor(window, "localStorage")
    Object.defineProperty(window, "localStorage", { value: undefined, configurable: true })
    try {
      expect(addCustomGradientPreset("NoStore", { ...NATURAL_GRADIENT_DEFAULTS }, { requirePersistence: true })).toBeNull()
      expect(getCustomGradientPresets()).toEqual([])
      expect(addCustomGradientPreset("Mem", { ...NATURAL_GRADIENT_DEFAULTS })).not.toBeNull()
    } finally {
      if (desc) Object.defineProperty(window, "localStorage", desc)
    }
  })
  it("requirePersistence rejects on storage failure without touching the store", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError")
    })
    try {
      expect(addCustomGradientPreset("Lost", { ...NATURAL_GRADIENT_DEFAULTS }, { requirePersistence: true })).toBeNull()
      expect(getCustomGradientPresets()).toEqual([])
      expect(canAddCustomGradientPreset()).toBe(true)
      // Default path unchanged: in-memory fallback still applies.
      expect(addCustomGradientPreset("Kept", { ...NATURAL_GRADIENT_DEFAULTS })).not.toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
