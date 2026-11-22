import { describe, expect, it } from "vitest"
import {
  applyLandscapeIsolated,
  applyPersonalLandscapeIsolated,
  applyPersonalPortraitIsolated,
  applyPortraitIsolated,
  visualPresetValuesSchema,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import { APPLE_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"

const base = APPLE_VISUAL_DEFAULTS
const live = { ...base, defaultTypeIcon: true, landscape: {} } as VisualPresetValues
const rec = (v: VisualPresetValues) => v as unknown as Record<string, unknown>

describe("preset e icona tipo", () => {
  it("un preset legacy senza campo parse a OFF", () => {
    const legacy: Record<string, unknown> = { ...base }
    delete legacy.defaultTypeIcon
    expect(visualPresetValuesSchema.parse(legacy).defaultTypeIcon).toBe(false)
  })

  it("portrait: il preset spegne l'icona viva e non tocca il flat landscape", () => {
    for (const apply of [applyPortraitIsolated, applyPersonalPortraitIsolated]) {
      const out = rec(apply(live, { ...base, defaultTypeIcon: false }))
      expect(out.defaultTypeIcon).toBe(false)
      expect(out.defaultTypeIconLandscape).toBeUndefined()
    }
  })

  it("portrait: il preset con icona la accende", () => {
    const out = rec(applyPersonalPortraitIsolated({ ...live, defaultTypeIcon: false }, { ...base, defaultTypeIcon: true }))
    expect(out.defaultTypeIcon).toBe(true)
  })

  it("landscape: scrive solo il flat landscape, il portrait resta vivo", () => {
    for (const apply of [applyLandscapeIsolated, applyPersonalLandscapeIsolated]) {
      const on = rec(apply(live, { ...base, defaultTypeIcon: true }))
      expect(on.defaultTypeIconLandscape).toBe(true)
      expect(on.defaultTypeIcon).toBe(true)
      const off = rec(apply(live, { ...base, defaultTypeIcon: false }))
      expect(off.defaultTypeIconLandscape).toBe(false)
      expect(off.defaultTypeIcon).toBe(true)
    }
  })

  it("dove guardare: ogni apply (entrambe le forme) usa il valore del preset, legacy = OFF", () => {
    const withWp = { ...live, defaultWatchProviders: true } as VisualPresetValues
    for (const apply of [applyPortraitIsolated, applyPersonalPortraitIsolated, applyLandscapeIsolated, applyPersonalLandscapeIsolated]) {
      expect(rec(apply(withWp, { ...base, defaultWatchProviders: false })).defaultWatchProviders).toBe(false)
      expect(rec(apply({ ...live, defaultWatchProviders: false } as VisualPresetValues, { ...base, defaultWatchProviders: true })).defaultWatchProviders).toBe(true)
    }
    const legacy: Record<string, unknown> = { ...base }
    delete legacy.defaultWatchProviders
    expect(visualPresetValuesSchema.parse(legacy).defaultWatchProviders).toBe(false)
  })
})
