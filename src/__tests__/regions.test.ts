import { describe, expect, it } from "vitest"
import {
  DEFAULT_REGION,
  REGIONS,
  SUPPORTED_UI_LANGS,
  flixSlugToRegionCode,
  getRegionDef,
  isSupportedUiLang,
  normalizeRegion,
  parseRegion,
  regionToFlixSlug,
} from "@/lib/regions"
import { PICKER_LANGS } from "@/lib/utils"

describe("regions", () => {
  it("exposes 13 regions with unique codes and slugs", () => {
    expect(REGIONS).toHaveLength(13)
    expect(new Set(REGIONS.map((r) => r.code)).size).toBe(13)
    expect(new Set(REGIONS.map((r) => r.flixSlug)).size).toBe(13)
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
  })

  it("parseRegion accepts FlixPatrol slugs", () => {
    expect(parseRegion("italy")).toBe("IT")
    expect(parseRegion("united-states")).toBe("US")
    expect(parseRegion("south-korea")).toBe("KR")
    expect(parseRegion("United-Kingdom")).toBe("GB")
    expect(parseRegion("mexico")).toBe("MX")
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
    expect(getRegionDef("IT")).toMatchObject({ flag: "🇮🇹", label: "Italia" })
    expect(getRegionDef("US")).toMatchObject({ flag: "🇺🇸", label: "USA" })
    expect(getRegionDef("MX")).toMatchObject({ flag: "🇲🇽", label: "Messico", lang2: "es" })
  })

  it("flixSlugToRegionCode round-trips supported slugs", () => {
    expect(flixSlugToRegionCode("france")).toBe("FR")
    expect(flixSlugToRegionCode("japan")).toBe("JP")
    expect(flixSlugToRegionCode("mexico")).toBe("MX")
    // Paesi FlixPatrol fuori dai 13 supportati → null (fallback disco, niente fast-path JW)
    expect(flixSlugToRegionCode("albania")).toBeNull()
  })

  it("maps each region to a 2-letter UI language", () => {
    expect(getRegionDef("IT").lang2).toBe("it")
    expect(getRegionDef("US").lang2).toBe("en")
    expect(getRegionDef("JP").lang2).toBe("ja")
    expect(getRegionDef("KR").lang2).toBe("ko")
    expect(getRegionDef("BR").lang2).toBe("pt")
    expect(getRegionDef("MX").lang2).toBe("es")
    for (const r of REGIONS) {
      expect(r.lang2).toMatch(/^[a-z]{2}$/)
      // La lingua UI è il prefisso del locale TMDB
      expect(r.lang.toLowerCase().startsWith(r.lang2)).toBe(true)
    }
  })

  it("supports only the picker UI languages", () => {
    expect(SUPPORTED_UI_LANGS).toEqual(["it", "en", "fr", "de", "es", "ja", "ko", "pt"])
    for (const l of ["it", "en", "fr", "de", "es", "ja", "ko", "pt"]) {
      expect(isSupportedUiLang(l)).toBe(true)
    }
    // Lingue del vecchio picker (zh/ru/ar/nl) non più offerte
    for (const l of ["zh", "ru", "ar", "nl", "", null, undefined]) {
      expect(isSupportedUiLang(l)).toBe(false)
    }
  })

  it("PICKER_LANGS lists exactly the 13 nationalities", () => {
    expect(PICKER_LANGS).toHaveLength(13)
    expect(new Set(PICKER_LANGS.map((l) => l.key)).size).toBe(13)
    expect(PICKER_LANGS.map((l) => l.key)).toEqual(REGIONS.map((r) => r.code))
    for (const l of PICKER_LANGS) {
      expect(l.flag).toBeTruthy()
      expect(l.name).toContain("·")
      expect(isSupportedUiLang(l.code)).toBe(true)
    }
  })
})
