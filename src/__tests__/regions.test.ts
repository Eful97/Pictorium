import { describe, expect, it } from "vitest"
import {
  DEFAULT_REGION,
  REGIONS,
  SUPPORTED_UI_LANGS,
  UI_LANG_META,
  CHART_REGIONS,
  GLOBAL_REGION_CODE,
  contentLanguageForUiLang,
  defaultRegionForLang,
  flixSlugToRegionCode,
  getRegionDef,
  isSupportedUiLang,
  normalizeRegion,
  parseRegion,
  regionToFlixSlug,
} from "@/lib/regions"
import { PICKER_LANGS, UI_LANGUAGES } from "@/lib/utils"

describe("regions", () => {
  it("puts global charts first and preserves their selection across UI languages", () => {
    expect(CHART_REGIONS[0].code).toBe(GLOBAL_REGION_CODE)
    expect(CHART_REGIONS.slice(1)).toEqual(REGIONS)
    expect(parseRegion("global")).toBe(GLOBAL_REGION_CODE)
    expect(normalizeRegion("GLOBAL")).toBe(GLOBAL_REGION_CODE)
    expect(getRegionDef("GLOBAL")).toMatchObject({ code: "GLOBAL", flag: "🌐", flixSlug: "global" })
    expect(defaultRegionForLang("fr", "GLOBAL")).toBe("GLOBAL")
    expect(defaultRegionForLang("vi", "GLOBAL")).toBe("GLOBAL")
  })
  it("localizes poster content without changing the chart country", () => {
    expect(contentLanguageForUiLang("vi", "IT")).toBe("vi")
    expect(contentLanguageForUiLang("fr", "US")).toBe("fr")
    expect(contentLanguageForUiLang("es", "MX")).toBe("es-MX")
    expect(contentLanguageForUiLang("en", "GB")).toBe("en-GB")
    expect(contentLanguageForUiLang("invalid", "IT")).toBe("it-IT")
  })
  it("exposes 22 regions with unique codes and slugs", () => {
    expect(REGIONS).toHaveLength(22)
    expect(new Set(REGIONS.map((r) => r.code)).size).toBe(22)
    expect(new Set(REGIONS.map((r) => r.flixSlug)).size).toBe(22)
    for (const r of REGIONS) {
      expect(r.code).toMatch(/^[A-Z]{2}$/)
      expect(r.lang).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  it("parseRegion accepts JW codes case-insensitively", () => {
    expect(parseRegion("IT")).toBe("IT")
    expect(parseRegion("us")).toBe("US")
    expect(parseRegion("  fr ")).toBe("FR")
    expect(parseRegion("kr")).toBe("KR")
    expect(parseRegion("mx")).toBe("MX")
    expect(parseRegion("il")).toBe("IL")
    expect(parseRegion("cz")).toBe("CZ")
    expect(parseRegion("pt")).toBe("PT")
    expect(parseRegion("ro")).toBe("RO")
    expect(parseRegion("pl")).toBe("PL")
  })

  it("parseRegion accepts FlixPatrol slugs", () => {
    expect(parseRegion("italy")).toBe("IT")
    expect(parseRegion("united-states")).toBe("US")
    expect(parseRegion("south-korea")).toBe("KR")
    expect(parseRegion("United-Kingdom")).toBe("GB")
    expect(parseRegion("mexico")).toBe("MX")
    expect(parseRegion("israel")).toBe("IL")
    expect(parseRegion("czech-republic")).toBe("CZ")
    expect(parseRegion("portugal")).toBe("PT")
    expect(parseRegion("romania")).toBe("RO")
    expect(parseRegion("poland")).toBe("PL")
  })

  it("parseRegion fails closed on unknown input", () => {
    expect(parseRegion("atlantis")).toBeNull()
    expect(parseRegion("")).toBeNull()
    expect(parseRegion(null)).toBeNull()
    expect(parseRegion(undefined)).toBeNull()
    expect(normalizeRegion("atlantis")).toBe(DEFAULT_REGION)
    expect(normalizeRegion(undefined)).toBe("IT")
  })

  it("maps region to Flix slug and TMDB/JW language", () => {
    expect(regionToFlixSlug("US")).toBe("united-states")
    expect(regionToFlixSlug("atlantis")).toBe("italy")
    expect(regionToFlixSlug("MX")).toBe("mexico")
    expect(getRegionDef("FR").lang).toBe("fr-FR")
    expect(getRegionDef("JP").lang).toBe("ja-JP")
    expect(getRegionDef("MX").lang).toBe("es-MX")
    expect(getRegionDef("IL").lang).toBe("he-IL")
    expect(getRegionDef("IT")).toMatchObject({ flag: "🇮🇹", label: "Italia" })
    expect(getRegionDef("US")).toMatchObject({ flag: "🇺🇸", label: "USA" })
    expect(getRegionDef("MX")).toMatchObject({ flag: "🇲🇽", label: "Messico", lang2: "es" })
    expect(getRegionDef("IL")).toMatchObject({ flag: "🇮🇱", label: "Israele", lang2: "he", flixSlug: "israel" })
    expect(getRegionDef("CZ")).toMatchObject({ flag: "🇨🇿", label: "Cechia", lang2: "cs", lang: "cs-CZ", flixSlug: "czech-republic" })
    expect(getRegionDef("PT")).toMatchObject({ flag: "🇵🇹", label: "Portogallo", lang2: "pt", lang: "pt-PT", flixSlug: "portugal" })
    expect(getRegionDef("RO")).toMatchObject({ flag: "🇷🇴", label: "Romania", lang2: "ro", lang: "ro-RO", flixSlug: "romania" })
    expect(getRegionDef("PL")).toMatchObject({ flag: "🇵🇱", label: "Polonia", lang2: "pl", lang: "pl-PL", flixSlug: "poland", languageName: "Polski" })
  })

  it("flixSlugToRegionCode round-trips supported slugs", () => {
    expect(flixSlugToRegionCode("france")).toBe("FR")
    expect(flixSlugToRegionCode("japan")).toBe("JP")
    expect(flixSlugToRegionCode("mexico")).toBe("MX")
    expect(flixSlugToRegionCode("israel")).toBe("IL")
    expect(flixSlugToRegionCode("portugal")).toBe("PT")
    expect(flixSlugToRegionCode("romania")).toBe("RO")
    expect(flixSlugToRegionCode("poland")).toBe("PL")
    // Paesi FlixPatrol fuori dai 18 supportati → null (fallback disco, niente fast-path JW)
    expect(flixSlugToRegionCode("albania")).toBeNull()
  })

  it("maps each region to a 2-letter UI language", () => {
    expect(getRegionDef("IT").lang2).toBe("it")
    expect(getRegionDef("US").lang2).toBe("en")
    expect(getRegionDef("JP").lang2).toBe("ja")
    expect(getRegionDef("KR").lang2).toBe("ko")
    expect(getRegionDef("BR").lang2).toBe("pt")
    expect(getRegionDef("PT").lang2).toBe("pt")
    expect(getRegionDef("RO").lang2).toBe("ro")
    expect(getRegionDef("MX").lang2).toBe("es")
    expect(getRegionDef("PL").lang2).toBe("pl")
    expect(getRegionDef("SA").lang2).toBe("ar")
    for (const r of REGIONS) {
      expect(r.lang2).toMatch(/^[a-z]{2}$/)
      // La lingua UI è il prefisso del locale TMDB
      expect(r.lang.toLowerCase().startsWith(r.lang2)).toBe(true)
    }
  })

  it("supports only the picker UI languages", () => {
    expect(SUPPORTED_UI_LANGS).toEqual(["it", "pl", "en", "fr", "de", "es", "ja", "ko", "pt", "he", "cs", "ro", "ar", "tr", "nl", "sv", "vi"])
    for (const l of ["it", "pl", "en", "fr", "de", "es", "ja", "ko", "pt", "he", "cs", "ro", "ar", "tr", "nl", "sv", "vi"]) {
      expect(isSupportedUiLang(l)).toBe(true)
    }
    // Lingue del vecchio picker (zh/ru) non più offerte
    for (const l of ["zh", "ru", "", null, undefined]) {
      expect(isSupportedUiLang(l)).toBe(false)
    }
  })

  it("UI language lists share one canonical source", () => {
    // UI_LANG_META è l'unica fonte: validazione e picker devono restare
    // sincronizzati (nessuna lista indipendente che diverge in silenzio).
    expect(UI_LANG_META.map((l) => l.code)).toEqual(SUPPORTED_UI_LANGS)
    expect(UI_LANGUAGES.map((l) => l.code)).toEqual(SUPPORTED_UI_LANGS)
    expect(new Set(UI_LANG_META.map((l) => l.code)).size).toBe(UI_LANG_META.length)
    for (const l of UI_LANGUAGES) {
      expect(l.flag).toBeTruthy()
      expect(l.name).toBeTruthy()
      expect(l.sub).toBe(l.code.toUpperCase())
    }
    // Ogni lingua chart resta selezionabile come lingua UI.
    for (const r of REGIONS) {
      expect(isSupportedUiLang(r.lang2)).toBe(true)
    }
  })

  it("selects global rankings for UI languages without a national chart", () => {
    // vi è selezionabile ma non ha una regione chart (JustWatch non accetta VN):
    // The default chart scope is global.
    expect(isSupportedUiLang("vi")).toBe(true)
    expect(isSupportedUiLang("VI")).toBe(true)
    expect(defaultRegionForLang("vi")).toBe("GLOBAL")
    expect(defaultRegionForLang("vi", "IT")).toBe("GLOBAL")
    expect(defaultRegionForLang("vi", "US")).toBe("GLOBAL")
    for (const r of REGIONS) {
      expect(r.lang2).not.toBe("vi")
    }
  })

  it("PICKER_LANGS lists exactly the 22 nationalities", () => {
    expect(PICKER_LANGS).toHaveLength(22)
    expect(new Set(PICKER_LANGS.map((l) => l.key)).size).toBe(22)
    expect(PICKER_LANGS.map((l) => l.key)).toEqual(REGIONS.map((r) => r.code))
    for (const l of PICKER_LANGS) {
      expect(l.flag).toBeTruthy()
      expect(l.name).toContain("·")
      expect(isSupportedUiLang(l.code)).toBe(true)
    }
  })

  it("defaultRegionForLang resolves region from language and preserves regional variants", () => {
    expect(defaultRegionForLang("fr")).toBe("FR")
    expect(defaultRegionForLang("de")).toBe("DE")
    expect(defaultRegionForLang("it")).toBe("IT")
    expect(defaultRegionForLang("ja")).toBe("JP")
    expect(defaultRegionForLang("ko")).toBe("KR")
    expect(defaultRegionForLang("pt")).toBe("PT")
    expect(defaultRegionForLang("pt", "BR")).toBe("BR")
    expect(defaultRegionForLang("ro")).toBe("RO")
    expect(defaultRegionForLang("es")).toBe("ES")
    expect(defaultRegionForLang("cs")).toBe("CZ")
    expect(defaultRegionForLang("pl")).toBe("PL")
    expect(defaultRegionForLang("ar")).toBe("SA")
    expect(defaultRegionForLang("tr")).toBe("TR")
    expect(defaultRegionForLang("nl")).toBe("NL")
    expect(defaultRegionForLang("sv")).toBe("SE")
    expect(defaultRegionForLang("es", "MX")).toBe("MX")
    expect(defaultRegionForLang("en")).toBe("US")
    expect(defaultRegionForLang("en", "GB")).toBe("GB")
    expect(defaultRegionForLang("en", "IT")).toBe("US")
    expect(defaultRegionForLang("unknown")).toBeNull()
    expect(defaultRegionForLang(null)).toBeNull()
    expect(defaultRegionForLang(undefined)).toBeNull()
  })
})
