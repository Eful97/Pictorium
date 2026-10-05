import { describe, expect, it, vi } from "vitest"
import { UI_LANG_META } from "@/lib/regions"

/**
 * UI picker display order: alphabetical by native name (Intl.Collator,
 * deterministic, locale-independent). The canonical source UI_LANG_META
 * keeps its insertion order (validators/defaults); only the shared display
 * list UI_LANGUAGES is sorted. All pickers (LangPicker, PrefsPanel) consume
 * UI_LANGUAGES, so they share this order. This spec is generic over the
 * canonical language set: it derives expectations from UI_LANG_META itself
 * and never hardcodes language codes or names.
 */
describe("UI languages display order", () => {
  it("keeps the canonical list order intact when the sorted display list is built", async () => {
    const canonicalBefore = UI_LANG_META.map((l) => l.code)
    expect(canonicalBefore.length).toBeGreaterThan(0)
    vi.resetModules()
    const regions = await import("@/lib/regions")
    const utils = await import("@/lib/utils")
    // Building UI_LANGUAGES must not reorder the canonical source.
    expect(regions.UI_LANG_META.map((l) => l.code)).toEqual(canonicalBefore)
    expect(regions.SUPPORTED_UI_LANGS).toEqual(canonicalBefore)
    // The display list covers the canonical set exactly once.
    const displayCodes = utils.UI_LANGUAGES.map((l) => l.code)
    expect([...displayCodes].sort()).toEqual([...canonicalBefore].sort())
    expect(new Set(displayCodes).size).toBe(canonicalBefore.length)
    for (const l of utils.UI_LANGUAGES) {
      expect(l.sub).toBe(l.code.toUpperCase())
    }
  })

  it("sorts display names with an explicit deterministic collator", async () => {
    vi.resetModules()
    const { UI_LANGUAGES } = await import("@/lib/utils")
    const collator = new Intl.Collator("en", { sensitivity: "base" })
    const names = UI_LANGUAGES.map((l) => l.name)
    expect([...names].sort((a, b) => collator.compare(a, b))).toEqual(names)
  })

  it("keeps Spanish variants adjacent with es first when present", async () => {
    vi.resetModules()
    const { UI_LANGUAGES } = await import("@/lib/utils")
    const codes = UI_LANGUAGES.map((l) => l.code)
    const esIdx = codes.indexOf("es")
    expect(esIdx).toBeGreaterThanOrEqual(0)
    // Whichever Spanish variants exist (e.g. regional ones), they must all
    // follow "es" with no other language in between.
    const variants = codes.filter((c) => c === "es" || c.startsWith("es-"))
    expect(variants[0]).toBe("es")
    expect(codes.slice(esIdx, esIdx + variants.length)).toEqual(variants)
  })
})
