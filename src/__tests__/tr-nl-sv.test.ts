import { describe, expect, it, vi } from "vitest"
import { isMiniseriesType, isReturningStatus } from "@/lib/badge-priority"
import { getSeriesEndedLabel } from "@/lib/poster-badge"
import { getSubGenreLabel } from "@/lib/subgenres"
import { GENRE_FALLBACK } from "@/lib/badges"
import enDict from "@/lib/translations/en.json"

const dicts = import.meta.glob("@/lib/translations/*.json", { eager: true }) as Record<string, { default: Record<string, string> }>

describe("tr/nl/sv TMDB status/type matching (verificati su TMDB)", () => {
  it("matches returning statuses", () => {
    expect(isReturningStatus("Yeni Sezonu Olan Diziler")).toBe(true)
    expect(isReturningStatus("Terugkerende serie")).toBe(true)
    expect(isReturningStatus("Återkommande serie")).toBe(true)
    expect(isReturningStatus("Returning Series")).toBe(true)
    expect(isReturningStatus("Bitti")).toBe(false)
  })

  it("matches ended statuses incl. Dutch miniseries type", () => {
    expect(isMiniseriesType("mini-serie")).toBe(true)
    expect(isMiniseriesType("miniseries")).toBe(true)
  })

  it("detects recently ended series in tr/nl/sv", async () => {
    const { createT: realCreateT } = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n")
    const lastAir = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(getSeriesEndedLabel({ tvStatus: "Bitti", lastAirDate: lastAir, t: realCreateT("tr") })).toBe(
      realCreateT("tr")("badge.seriesEnded"),
    )
    expect(getSeriesEndedLabel({ tvStatus: "Afgelopen", lastAirDate: lastAir, t: realCreateT("nl") })).toBe(
      realCreateT("nl")("badge.seriesEnded"),
    )
    expect(getSeriesEndedLabel({ tvStatus: "Avslutad", lastAirDate: lastAir, t: realCreateT("sv") })).toBe(
      realCreateT("sv")("badge.seriesEnded"),
    )
  })
})

describe("tr/nl/sv badge data", () => {
  it("maps verified TMDB genre names to accent colors", () => {
    // Turco
    expect(GENRE_FALLBACK["Aksiyon"]).toBe("#D4A574")
    expect(GENRE_FALLBACK["Bilim-Kurgu"]).toBe("#3498DB")
    expect(GENRE_FALLBACK["Vahşi Batı"]).toBe("#A0522D")
    expect(GENRE_FALLBACK["Aksiyon & Macera"]).toBe("#D4A574")
    expect(GENRE_FALLBACK["Pembe Dizi"]).toBe("#5D6D7E")
    expect(GENRE_FALLBACK["Gerçeklik"]).toBe("#7F8C8D")
    // Olandese
    expect(GENRE_FALLBACK["Misdaad"]).toBe("#2C3E50")
    expect(GENRE_FALLBACK["Sciencefiction"]).toBe("#3498DB")
    expect(GENRE_FALLBACK["Historisch"]).toBe("#A67B5B")
    // Svedese (+ fallback inglesi osservati su TMDB sv)
    expect(GENRE_FALLBACK["Skräck"]).toBe("#8B0000")
    expect(GENRE_FALLBACK["Västern"]).toBe("#A0522D")
    expect(GENRE_FALLBACK["Animerat"]).toBe("#E67E22")
    // Chiavi inglesi per i fallback TMDB (sv/nl/tr restituiscono l'inglese)
    expect(GENRE_FALLBACK["Kids"]).toBe("#2ECC71")
    expect(GENRE_FALLBACK["News"]).toBe("#7F8C8D")
    expect(GENRE_FALLBACK["Talk"]).toBe("#7F8C8D")
    expect(GENRE_FALLBACK["TV Movie"]).toBe("#5D6D7E")
  })

  it("labels sub-genres in tr/nl/sv", () => {
    expect(getSubGenreLabel(["time travel"], "tr")).toBe("Zamanda Yolculuk")
    expect(getSubGenreLabel(["zombie"], "nl")).toBe("Zombie")
    expect(getSubGenreLabel(["heist"], "sv-SE")).toBe("Kuppfim")
  })

  it("recognizes tr/nl/sv rank labels in saved mappings", async () => {
    const { isRankKey: realIsRankKey } = await vi.importActual<typeof import("@/lib/i18n")>("@/lib/i18n")
    expect(realIsRankKey("Bugün")).toBe("badge.today")
    expect(realIsRankKey("Dizi")).toBe("badge.series")
    expect(realIsRankKey("Vandaag")).toBe("badge.today")
    expect(realIsRankKey("Idag")).toBe("badge.today")
  })
})

describe("translations parity (tutte le lingue)", () => {
  it("every dictionary covers every en key with matching placeholders", () => {
    const enKeys = Object.keys(enDict)
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",")
    for (const [path, mod] of Object.entries(dicts)) {
      const d = mod.default
      expect(Object.keys(d), path).toHaveLength(enKeys.length)
      for (const k of enKeys) {
        expect(d[k], `${path}:${k}`).toBeDefined()
        expect(ph(String(d[k])), `${path}:${k}`).toBe(ph((enDict as Record<string, string>)[k]))
      }
    }
  })
})
