import { describe, expect, it } from "vitest"
import {
  CHART_SLUG_TO_ISO2,
  GLOBAL_CHART_FLAG,
  GLOBAL_CHART_SLUG,
  displayCountryForSlug,
  flagForIso2,
  prettifyChartSlug,
  sortCountryDisplays,
} from "@/lib/streaming-country-display"
import { GENERIC_CHART_COUNTRY_SLUGS } from "@/lib/streaming-catalogs"

/**
 * Offline fixture validation for the Add Top 10 country picker display layer.
 * Display-only: slugs stay the fetch/persisted identity; this module only
 * maps them to a flag + a CURRENT-language name (global always first,
 * alphabetical per `Intl.Collator(locale)`).
 */

// The 18 UI languages with a shipped dictionary (pt-br reuses the pt flow).
const UI_LANGS = [
  "it", "pl", "en", "fr", "de", "es", "es-419", "ja", "ko", "pt",
  "he", "cs", "ro", "ar", "tr", "nl", "sv", "vi",
] as const

describe("streaming-country-display (119 chart slugs)", () => {
  it("covers every allowlisted slug: 118 countries + global = 119", () => {
    expect(GENERIC_CHART_COUNTRY_SLUGS).toHaveLength(119)
    expect(GENERIC_CHART_COUNTRY_SLUGS).toContain(GLOBAL_CHART_SLUG)
    const countries = GENERIC_CHART_COUNTRY_SLUGS.filter((s) => s !== GLOBAL_CHART_SLUG)
    expect(countries).toHaveLength(118)
    for (const slug of countries) {
      expect(CHART_SLUG_TO_ISO2[slug], `missing ISO mapping for ${slug}`).toMatch(/^[A-Z]{2}$/)
    }
  })

  it("maps the unusual slugs to the factual ISO code (never a guess)", () => {
    expect(CHART_SLUG_TO_ISO2["czech-republic"]).toBe("CZ")
    expect(CHART_SLUG_TO_ISO2["salvador"]).toBe("SV")
    expect(CHART_SLUG_TO_ISO2["turkey"]).toBe("TR")
    expect(CHART_SLUG_TO_ISO2["south-korea"]).toBe("KR")
    expect(CHART_SLUG_TO_ISO2["taiwan"]).toBe("TW")
    expect(CHART_SLUG_TO_ISO2["hong-kong"]).toBe("HK")
    expect(CHART_SLUG_TO_ISO2["united-states"]).toBe("US")
    expect(CHART_SLUG_TO_ISO2["united-kingdom"]).toBe("GB")
    expect(CHART_SLUG_TO_ISO2["global" as never]).toBeUndefined()
  })

  it("every mapped country renders a non-empty flag (regional indicators)", () => {
    for (const [slug, iso] of Object.entries(CHART_SLUG_TO_ISO2)) {
      const flag = flagForIso2(iso)
      expect(flag.length, `empty flag for ${slug}/${iso}`).toBeGreaterThan(0)
      expect(displayCountryForSlug(slug, "en", "Global").flag).toBe(flag)
    }
    expect(flagForIso2("")).toBe("")
    expect(flagForIso2("ITA")).toBe("")
  })

  it("global renders the translated caller label with the globe flag", () => {
    const row = displayCountryForSlug("global", "it", "Classifica globale")
    expect(row.isGlobal).toBe(true)
    expect(row.flag).toBe(GLOBAL_CHART_FLAG)
    expect(row.label).toBe("Classifica globale")
    expect(row.iso2).toBeNull()
  })

  it("unknown future slugs fall back honestly: prettified label, no fake flag", () => {
    const row = displayCountryForSlug("atlantis-rising", "en", "Global")
    expect(row.flag).toBe("")
    expect(row.label).toBe("Atlantis Rising")
    expect(row.iso2).toBeNull()
    expect(prettifyChartSlug("new-chart-land")).toBe("New Chart Land")
  })

  it.each(UI_LANGS)("names resolve in %s (incl. RTL), flags stay language-independent", (lang) => {
    const globalLabel = `Global:${lang}`
    const rows = GENERIC_CHART_COUNTRY_SLUGS.map((slug) => displayCountryForSlug(slug, lang, globalLabel))
    expect(rows).toHaveLength(119)
    for (const row of rows) {
      expect(typeof row.label).toBe("string")
      expect(row.label.length).toBeGreaterThan(0)
    }
    // Flags are factual, never translated: identical in every UI language.
    const italy = rows.find((r) => r.slug === "italy")!
    expect(italy.flag).toBe(flagForIso2("IT"))
    expect(italy.iso2).toBe("IT")
    // Global keeps the caller label verbatim (translated by the caller).
    expect(rows.find((r) => r.slug === "global")!.label).toBe(globalLabel)
  })

  it.each(UI_LANGS)("global is always first, rest alphabetical in %s", (lang) => {
    const rows = GENERIC_CHART_COUNTRY_SLUGS.map((slug) => displayCountryForSlug(slug, lang, "Global"))
    const sorted = sortCountryDisplays(rows, lang)
    expect(sorted[0].slug).toBe("global")
    expect(sorted).toHaveLength(119)
    const collator = new Intl.Collator(lang, { sensitivity: "base" })
    const rest = sorted.slice(1)
    for (let i = 1; i < rest.length; i++) {
      expect(
        collator.compare(rest[i - 1].label, rest[i].label) <= 0,
        `out of order in ${lang}: "${rest[i - 1].label}" vs "${rest[i].label}"`,
      ).toBe(true)
    }
  })

  it("localized labels actually differ per language (not a hardcoded English list)", () => {
    const de = displayCountryForSlug("germany", "de", "Global").label
    const it = displayCountryForSlug("germany", "it", "Globale").label
    const en = displayCountryForSlug("germany", "en", "Global").label
    expect(en).toBe("Germany")
    expect(de).toBe("Deutschland")
    expect(it).toBe("Germania")
  })
})
