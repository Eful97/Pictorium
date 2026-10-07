import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"
// Real dictionaries via the server facade (eager registration). The global
// setup.ts mock of @/lib/i18n must stay off in this file: it lacks
// registerDictionary, so the facade could not register into it. No test in
// this file relies on the mock (all t() are passed explicitly as real;
// parity checks import JSON directly).
vi.unmock("@/lib/i18n")
import { buildExtraDefaultSvg, buildGenreTextSvg, fontFamilyFor } from "@/lib/badge-svg-shared"
import { buildExtraBadgeSVG, buildGenreBadgeSVG, buildNetflixRankBadgeSVG, renderSVG } from "@/lib/svg-badge"
import { isMiniseriesType, isReturningStatus, stripArabicDiacritics } from "@/lib/badge-priority"
import { getSeriesEndedLabel } from "@/lib/poster-badge"
import { getSubGenreLabel } from "@/lib/subgenres"
import { getUpcomingReleaseLabel } from "@/lib/release-badge"
import { GENRE_FALLBACK } from "@/lib/badges"
import enDict from "@/lib/translations/en.json"
import arDict from "@/lib/translations/ar.json"

/** Pixel "accesi" e loro estensione orizzontale: un badge con glifi mancanti
 *  esce vuoto (0 pixel) oppure pieno di tofu (rettangoli, molto più inchiostro). */
async function ink(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  let minX = info.width
  let maxX = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 10) {
        count++
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
      }
    }
  }
  return { count, minX, maxX, width: info.width }
}

/** Solo l'inchiostro scuro del testo (su pill chiara), misurato nell'interno
 *  (stessa geometria del test ebraico gemello). */
async function textInk(png: Buffer, margin = 24) {
  const { TOP_SHADOW_PAD } = await import("@/lib/badge-svg-shared")
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const yMax = info.height - TOP_SHADOW_PAD
  let count = 0
  let minX = info.width
  let maxX = -1
  for (let y = 0; y < yMax; y++) {
    for (let x = margin; x < info.width - margin; x++) {
      const i = (y * info.width + x) * 4
      if (data[i + 3] > 10 && data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120) {
        count++
        minX = Math.min(minX, x - margin)
        maxX = Math.max(maxX, x - margin)
      }
    }
  }
  return { count, minX, maxX, width: info.width - margin * 2 }
}

describe("fontFamilyFor (arabo)", () => {
  it("declares Rubik as soon as the text contains Arabic", () => {
    expect(fontFamilyFor("موسم جديد")).toBe("Rubik")
    expect(fontFamilyFor("حركة")).toBe("Rubik")
    expect(fontFamilyFor("موسم جديد 3")).toBe("Rubik")
  })

  it("keeps Rubik for mixed Arabic+Latin (genre + rating + year flow)", () => {
    expect(fontFamilyFor("حركة 8.2")).toBe("Rubik")
  })

  it("keeps Inter for Latin text so the SVG stays byte-identical", () => {
    expect(fontFamilyFor("New season")).toBe("Inter")
    expect(fontFamilyFor("4K")).toBe("Inter")
  })

  it("emits the declared family into the badge SVG", () => {
    expect(buildExtraDefaultSvg("موسم جديد", 20, "#fff", "#333").svg).toContain('font-family="Rubik"')
    expect(buildGenreTextSvg("حركة", "8.2", "2024", 63, "#e5e7eb", "shadow").svg).toContain('font-family="Rubik"')
  })
})

describe("Arabic badge rasterisation", () => {
  it("renders Arabic glyphs in the extra badge", async () => {
    const ar = await buildExtraBadgeSVG("موسم جديد", 380, false, "default", "#D4A574")
    expect(ar).not.toBeNull()
    expect((await ink(ar!.png)).count).toBeGreaterThan(0)
    const text = await textInk(ar!.png)
    expect(text.count).toBeGreaterThan(0)
    expect(text.minX).toBeGreaterThan(0)
    expect(text.maxX).toBeLessThan(text.width - 1)
  })

  it("renders an Arabic genre name next to Latin rating and year", async () => {
    const ar = await buildGenreBadgeSVG("حركة", 8.2, 380, "2024", "shadow", "#D4A574", false)
    expect(ar).not.toBeNull()
    expect((await ink(ar!.png)).count).toBeGreaterThan(0)
  })

  it("renders an Arabic sub-label on the Netflix ribbon", async () => {
    const { svg, w } = buildNetflixRankBadgeSVG(3, 380, false, "left", false, "اليوم")
    expect(svg).toContain('font-family="Rubik"')
    expect((await ink(await renderSVG(svg, w))).count).toBeGreaterThan(0)
  })

  it("sizes an Arabic pill from its own advance widths, not the Latin default", async () => {
    const ar = await buildExtraBadgeSVG("موسم جديد", 380, false, "default", "#D4A574")
    const bounds = await textInk(ar!.png)
    const inkWidth = bounds.maxX - bounds.minX + 1
    expect(inkWidth).toBeGreaterThan(bounds.width * 0.5)
    expect(inkWidth).toBeLessThan(bounds.width)
  })
})

describe("Arabic TMDB status/type matching", () => {
  it("strips tashkeel and directional marks", () => {
    expect(stripArabicDiacritics("مُنتهٍ")).toBe("منته")
    expect(stripArabicDiacritics("موسم جديد قادم")).toBe("موسم جديد قادم")
  })

  it("matches the Arabic returning status (verified on TMDB ar-SA)", () => {
    expect(isReturningStatus("موسم جديد قادم")).toBe(true)
    expect(isReturningStatus("Returning Series")).toBe(true)
    expect(isReturningStatus("In corso")).toBe(true)
    expect(isReturningStatus("مُنتهٍ")).toBe(false)
  })

  it("never matches miniseries in Arabic (TMDB returns generic مسلسلات)", () => {
    expect(isMiniseriesType("miniseries")).toBe(true)
    expect(isMiniseriesType("miniserie")).toBe(true)
    expect(isMiniseriesType("مسلسلات")).toBe(false)
  })

  it("detects a recently ended series from the vocalized Arabic status", async () => {
    const { createT: realCreateT } = await vi.importActual<typeof import("@/lib/i18n-server")>("@/lib/i18n-server")
    const t = realCreateT("ar")
    expect(t("badge.seriesEnded")).toBe("انتهى المسلسل")
    const lastAir = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(getSeriesEndedLabel({ tvStatus: "مُنتهٍ", lastAirDate: lastAir, t })).toBe("انتهى المسلسل")
    expect(getSeriesEndedLabel({ tvStatus: "منتهي", lastAirDate: lastAir, t })).toBe("انتهى المسلسل")
    expect(getSeriesEndedLabel({ tvStatus: "موسم جديد قادم", lastAirDate: lastAir, t })).toBeNull()
  })
})

describe("Arabic badge data", () => {
  it("maps verified TMDB ar-SA genre names to accent colors", () => {
    expect(GENRE_FALLBACK["حركة"]).toBe("#D4A574")
    expect(GENRE_FALLBACK["دراما"]).toBe("#5D6D7E")
    expect(GENRE_FALLBACK["خيال علمي"]).toBe("#3498DB")
    expect(GENRE_FALLBACK["حركة ومغامرة"]).toBe("#D4A574")
    expect(GENRE_FALLBACK["خيال علمي وفانتازيا"]).toBe("#3498DB")
    expect(GENRE_FALLBACK["فيلم تلفازي"]).toBe("#5D6D7E")
    expect(GENRE_FALLBACK["واقع"]).toBe("#7F8C8D")
  })

  it("labels sub-genres in Arabic", () => {
    expect(getSubGenreLabel(["time travel"], "ar")).toBe("سفر عبر الزمن")
    expect(getSubGenreLabel(["zombie"], "ar")).toBe("زومبي")
    expect(getSubGenreLabel(["cyberpunk"], "ar-SA")).toBe("سايبربانك")
  })

  it("recognizes Arabic rank labels in saved mappings", async () => {
    // NB: setup.ts mocca i18n (isRankKey: () => null) — qui serve il modulo reale.
    const { isRankKey: realIsRankKey } = await vi.importActual<typeof import("@/lib/i18n-server")>("@/lib/i18n-server")
    expect(realIsRankKey("اليوم")).toBe("badge.today")
    expect(realIsRankKey("أنمي")).toBe("badge.anime")
    expect(realIsRankKey("فيلم")).toBe("badge.movie")
    expect(realIsRankKey("مسلسل")).toBe("badge.series")
    expect(realIsRankKey("مسلسلات")).toBe("badge.series")
  })

  it("formats upcoming dates Gregorian with Latin digits (never Hijri)", async () => {
    const { createT: realCreateT } = await vi.importActual<typeof import("@/lib/i18n-server")>("@/lib/i18n-server")
    const t = realCreateT("ar")
    const f = new Date()
    f.setDate(f.getDate() + 1)
    const iso = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`
    const label = getUpcomingReleaseLabel({ mediaType: "movie", releaseDate: iso, locale: "ar", t })
    expect(label).not.toBeNull()
    // Anno gregoriano a 2 cifre + cifre latine: niente anno islamico ("26"),
    // niente cifre arabo-indiche, niente marchi direzionali invisibili.
    expect(label).toMatch(/^قادم \d{2}\.\d{2}\.\d{2}$/)
  })
})

describe("ar translations parity", () => {
  it("covers every en key with matching placeholders", () => {
    const enKeys = Object.keys(enDict)
    const ar = arDict as Record<string, string>
    expect(Object.keys(ar)).toHaveLength(enKeys.length)
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",")
    for (const k of enKeys) {
      expect(ar[k], k).toBeDefined()
      expect(ph(String(ar[k]))).toBe(ph((enDict as Record<string, string>)[k]))
    }
  })
})
