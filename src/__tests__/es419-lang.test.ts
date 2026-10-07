import { describe, expect, it, vi } from "vitest"
// The global test setup mocks @/lib/i18n with a fixed Italian dictionary:
// opt out to exercise the real dictionaries (pattern used by
// translations-parity, which imports JSON directly). Real dictionaries come
// from the server facade (eager registration); the client base only bundles
// en/it since the lazy-loading split.
vi.unmock("@/lib/i18n")
import { createT } from "@/lib/i18n-server"
import esDict from "@/lib/translations/es.json"
import es419Dict from "@/lib/translations/es-419.json"
import {
  UI_LANG_META,
  SUPPORTED_UI_LANGS,
  isSupportedUiLang,
  contentLanguageForUiLang,
  defaultRegionForLang,
} from "@/lib/regions"
import { UI_LANGUAGES, LANG_FLAGS, LANG_NAMES } from "@/lib/utils"
import { getSubGenreLabel } from "@/lib/subgenres"

/**
 * es-419 infrastructure (Latin American UI): codes, metadata resolution,
 * picker entries and fallbacks. The dedicated dictionary is verified
 * against es for real LATAM-neutral differences below.
 */
describe("es-419 language infrastructure", () => {
  it("exposes es-419 as UI language with global flag (Mexico is not all of LatAm)", () => {
    expect(isSupportedUiLang("es-419")).toBe(true)
    expect(isSupportedUiLang("ES-419")).toBe(true)
    expect(SUPPORTED_UI_LANGS).toContain("es-419")
    expect(UI_LANG_META.find((l) => l.code === "es-419")).toMatchObject({
      flag: "🌎",
      name: "Español (Latinoamérica)",
    })
    const picker = UI_LANGUAGES.find((l) => l.code === "es-419")
    expect(picker).toMatchObject({ flag: "🌎", name: "Español (Latinoamérica)", sub: "ES-419" })
    expect(LANG_FLAGS["es-419"]).toBe("🌎")
    expect(LANG_NAMES["es-419"]).toBe("Español (Latinoamérica)")
  })

  it("resolves provider metadata language to canonical es-MX in any chart", () => {
    for (const region of ["IT", "ES", "MX", "US", "GB", "GLOBAL"]) {
      const tmdbLang = contentLanguageForUiLang("es-419", region)
      expect(tmdbLang).toBe("es-MX")
      // es-419 must never reach providers: not a valid ISO639-1+ISO3166 locale.
      expect(tmdbLang).not.toBe("es-419")
    }
  })

  it("defaults a fresh es-419 user to MX while preserving explicit chart choices", () => {
    expect(defaultRegionForLang("es-419")).toBe("MX")
    expect(defaultRegionForLang("es-419", "ES")).toBe("ES")
    expect(defaultRegionForLang("es-419", "MX")).toBe("MX")
    expect(defaultRegionForLang("es-419", "GLOBAL")).toBe("GLOBAL")
    // Historic "es" behavior is unchanged.
    expect(defaultRegionForLang("es")).toBe("ES")
    expect(defaultRegionForLang("es", "MX")).toBe("MX")
  })

  it("resolves UI strings from the dedicated Latin American dictionary", () => {
    const t419 = createT("es-419")
    // Shared strings stay identical to es.
    expect(t419("badge.today")).toBe("Hoy")
    // The canonical es-MX locale reuses the same LATAM dictionary.
    expect(createT("es-MX")("badge.today")).toBe(t419("badge.today"))
    expect(createT("es-MX")("ui.noKeySub")).toBe(t419("ui.noKeySub"))
  })

  it("carries real LATAM-neutral differences vs es (Spain)", () => {
    const t419 = createT("es-419")
    const tEs = createT("es")
    // Neutral imperatives and terms instead of peninsular ones.
    expect(t419("ui.noKeySub")).not.toBe(tEs("ui.noKeySub"))
    expect(t419("ui.noKeySub")).toContain("Ingresa")
    expect(t419("ui.settings")).toBe("Configuración")
    expect(tEs("ui.settings")).toBe("Ajustes")
    expect(t419("ui.rankingSourceKeysNote")).toContain("pósters")
    expect(tEs("ui.rankingSourceKeysNote")).toContain("carteles")
    // Hardcoded Spain is neutralized; the language count reflects es-419.
    expect(t419("ui.trendingNow")).toBe("Top 20 JustWatch")
    expect(tEs("ui.trendingNow")).toBe("Top 20 España JustWatch")
    expect(t419("ui.heroPillLangs")).toBe("18 idiomas")
    expect(tEs("ui.heroPillLangs")).toBe("17 idiomas")
    // Former English leftovers are genuinely translated (kept in es).
    expect(t419("ui.customRatings")).toBe("Valoraciones personalizadas")
    expect(tEs("ui.customRatings")).toBe("Custom ratings")
    expect(t419("ui.posterShape")).toBe("Forma del póster")
    expect(tEs("ui.posterShape")).toBe("Poster shape")
    expect(t419("ui.dateFormat")).toBe("Formato de fecha de estreno")
    expect(tEs("ui.dateFormat")).toBe("Release date format")
    expect(t419("ui.profileGateTitle")).toBe("Tu espacio personal")
    expect(tEs("ui.profileGateTitle")).toBe("Your personal space")
    expect(t419("badge.justAddedMovie")).toBe("Recién añadida")
    expect(tEs("ui.epAutoDesc")).toContain("si no")
    expect(t419("ui.epAutoDesc")).toContain("de lo contrario")
    // Same key set as the es source dictionary.
    expect(Object.keys(es419Dict).sort()).toEqual(Object.keys(esDict).sort())
  })

  it("falls back to Spanish (not Italian) for genre-family labels", () => {
    expect(getSubGenreLabel(["martial arts"], "es-419")).toBe("Artes marciales")
    expect(getSubGenreLabel(["martial arts"], "es-MX")).toBe("Artes marciales")
  })
})
