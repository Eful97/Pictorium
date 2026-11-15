/**
 * Rating separati, layout "gradino" (fase 2 della pillola a notch) — stili
 * `notch-crema|vetro|inchiostro|sfumato`.
 *
 * Contratto:
 * - UNA sagoma a due livelli a filo del bordo inferiore: gradino basso
 *   (logo + voto, divisori sottili) e gradino alto più stretto ("Genere • Anno",
 *   niente stella);
 * - contenuto del gradino alto con i flag RAW dell'utente: 0 rating → solo
 *   gradino alto, senza genere/anno → solo gradino basso, niente → null;
 * - il gradino basso si allarga per contenere il gradino alto;
 * - stesso materiale/contorno della pillola (skin e `notchStepPathD` condivisi);
 * - nessuna correzione per-item su una sagoma unica (limite dichiarato).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import {
  renderSeparateRatingsNotch,
  notchSeparateStepBodyHeight,
  notchSeparateStepText,
} from "@/lib/separate-rating-renderer"
import { generatePosterBuffer, LANDSCAPE_BOTTOM_PILLS_SHIFT_X, type GenerationInput } from "@/lib/poster-service"
import { notchGlassVeilFill, notchStepPathD, notchPathD, NOTCH_GLASS_MIN_LC, TOP_SHADOW_PAD } from "@/lib/badge-svg-shared"
import { apcaLc } from "@/lib/accent-color"
import { formatSeparateValue } from "@/lib/ratings"
import { resolveSeparateDisplayState } from "@/lib/poster-config"
import { SEPARATE_STYLE_GROUPS, SEPARATE_VARIANT_LABELS } from "@/lib/badge-style-groups"
import { LAND_W, LAND_H } from "@/lib/image-utils"
import type { SeparateRatingsStyle } from "@/lib/badge-styles"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const ITEMS = [
  { id: "imdb", value: 8.7 },
  { id: "tmdb", value: 7.9 },
  { id: "tomatoes", value: 8.8 },
] as const

const MATERIALS = ["notch-crema", "notch-vetro", "notch-inchiostro", "notch-sfumato"] as const

const LABEL = { genre: "Fantascienza", year: "2024" }

describe("renderSeparateRatingsNotch: forma e contenuto", () => {
  it("testo del gradino alto: genere • anno, mai la stella", () => {
    expect(notchSeparateStepText(LABEL)).toBe("Fantascienza • 2024")
    expect(notchSeparateStepText({ genre: "Dramma" })).toBe("Dramma")
    expect(notchSeparateStepText({ year: "1999" })).toBe("1999")
    expect(notchSeparateStepText({})).toBe("")
    expect(notchSeparateStepText(null)).toBe("")
    expect(notchSeparateStepText(LABEL)).not.toContain("★")
  })

  it("niente rating e niente genere/anno → null (mai placeholder)", async () => {
    expect(await renderSeparateRatingsNotch([], 500, "notch-vetro")).toBeNull()
    expect(await renderSeparateRatingsNotch([], 500, "notch-vetro", "inter", 130, 2000, true, {})).toBeNull()
    expect(await renderSeparateRatingsNotch([{ id: "sconosciuta", value: 7 }], 500, "notch-vetro", "inter", 130, 2000, true, {})).toBeNull()
  })

  it("altezza = livelli dipinti + pad ombra (riserva logo esatta)", async () => {
    for (const scale of [100, 130]) {
      const both = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", scale, 2000, false, LABEL)
      const onlyTop = await renderSeparateRatingsNotch([], 500, "notch-crema", "inter", scale, 2000, false, LABEL)
      const onlyBottom = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", scale, 2000, false, {})
      expect(both).not.toBeNull()
      expect(onlyTop).not.toBeNull()
      expect(onlyBottom).not.toBeNull()
      const pad = TOP_SHADOW_PAD
      expect(both!.h).toBe(notchSeparateStepBodyHeight(500, scale, { bottom: true, top: true }) + pad)
      expect(onlyTop!.h).toBe(notchSeparateStepBodyHeight(500, scale, { bottom: false, top: true }) + pad)
      expect(onlyBottom!.h).toBe(notchSeparateStepBodyHeight(500, scale, { bottom: true, top: false }) + pad)
      // Il solo gradino alto è più basso del gradino basso: mai un corpo vuoto.
      expect(onlyTop!.h).toBeLessThan(onlyBottom!.h)
    }
  })

  it("0 rating → notch col solo genere (sagoma singola, non due livelli vuoti)", async () => {
    const onlyTop = await renderSeparateRatingsNotch([], 500, "notch-crema", "inter", 130, 2000, false, { genre: "Dramma", year: "2021" })
    const full = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", 130, 2000, false, { genre: "Dramma", year: "2021" })
    expect(onlyTop).not.toBeNull()
    expect(full).not.toBeNull()
    expect(onlyTop!.h).toBeLessThan(full!.h)
    // Riga singola: nessun divisorio né logo (i pixel chiari sono solo il testo).
    const { data } = await sharp(onlyTop!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let ink = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 40) ink++
    const fullInk = await sharp(full!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let fullInkCount = 0
    for (let i = 0; i < fullInk.data.length; i += 4) if (fullInk.data[i + 3] > 40) fullInkCount++
    expect(ink).toBeGreaterThan(0)
    expect(ink).toBeLessThan(fullInkCount)
  })

  it("genere più largo dei rating: il gradino basso si allarga per contenerlo", async () => {
    const narrow = { genre: "Dramma", year: "2024" }
    const wide = { genre: "Documentario storico e biografico", year: "1999" }
    const oneNarrow = await renderSeparateRatingsNotch([ITEMS[0]], 500, "notch-vetro", "inter", 130, 4000, false, narrow)
    const oneWide = await renderSeparateRatingsNotch([ITEMS[0]], 500, "notch-vetro", "inter", 130, 4000, false, wide)
    const aloneWide = await renderSeparateRatingsNotch([], 500, "notch-vetro", "inter", 130, 4000, false, wide)
    expect(oneNarrow).not.toBeNull()
    expect(oneWide).not.toBeNull()
    expect(aloneWide).not.toBeNull()
    // Forma sempre valida: il corpo basso non è mai più stretto del gradino alto.
    expect(oneWide!.w).toBeGreaterThan(oneNarrow!.w)
    expect(oneWide!.h).toBe(oneNarrow!.h)
    // Da solo il gradino alto è una pillola singola, più bassa dei due livelli.
    expect(aloneWide!.h).toBeLessThan(oneWide!.h)
  })

  it("quattro materiali distinti; polarità scura/chiara distinta", async () => {
    const byMaterial = new Map<string, Buffer>()
    for (const material of MATERIALS) {
      const r = await renderSeparateRatingsNotch([...ITEMS], 500, material, "inter", 130, 2000, false, LABEL)
      expect(r).not.toBeNull()
      byMaterial.set(material, r!.png)
    }
    const digests = new Set([...byMaterial.values()].map((png) => png.toString("base64")))
    expect(digests.size).toBe(MATERIALS.length)
    for (const material of MATERIALS) {
      const dark = await renderSeparateRatingsNotch([...ITEMS], 500, material, "inter", 130, 2000, false, LABEL)
      const light = await renderSeparateRatingsNotch([...ITEMS], 500, material, "inter", 130, 2000, true, LABEL)
      if (material === "notch-crema" || material === "notch-inchiostro") {
        // Materiali a tinta fissa: la polarità non cambia i byte.
        expect(light!.png.equals(dark!.png)).toBe(true)
      } else {
        expect(light!.png.equals(dark!.png)).toBe(false)
      }
    }
  })

  it("scala nativa: 130 == omesso, 150 cresce, bound 10..200", async () => {
    const at100 = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", 100, 2000, false, LABEL)
    const at130 = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", 130, 2000, false, LABEL)
    const at150 = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", 150, 2000, false, LABEL)
    const omitted = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", undefined, 2000, false, LABEL)
    const garbage = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-crema", "inter", Number.NaN, 2000, false, LABEL)
    expect(at150!.h).toBeGreaterThan(at130!.h)
    expect(at130!.h).toBeGreaterThan(at100!.h)
    expect(omitted!.png.equals(at130!.png)).toBe(true)
    expect(garbage!.png.equals(at130!.png)).toBe(true)
    expect(at130!.png.equals(at100!.png)).toBe(false)
  })

  it("fit sicuro: mai oltre la larghezza del canvas (font-loop + shrink)", async () => {
    const five = [...ITEMS, { id: "letterboxd", value: 4.1 }, { id: "trakt", value: 7.5 }]
    const narrow = await renderSeparateRatingsNotch(five, 500, "notch-crema", "inter", 200, 260, false, { genre: "Documentario storico", year: "1999" })
    const wide = await renderSeparateRatingsNotch(five, 500, "notch-crema", "inter", 200, 4000, false, { genre: "Documentario storico", year: "1999" })
    expect(narrow).not.toBeNull()
    expect(wide).not.toBeNull()
    expect(narrow!.w).toBeLessThanOrEqual(260)
    expect(wide!.w).toBeGreaterThan(narrow!.w)
    // Aspect preservato dallo shrink proporzionale (un solo ricampionamento).
    expect(Math.abs(narrow!.h / narrow!.w - wide!.h / wide!.w)).toBeLessThan(0.08)
  })

  it("sagoma unica: nessun box per-item (limite dichiarato, mai maniglie finte)", async () => {
    const r = await renderSeparateRatingsNotch([...ITEMS], 500, "notch-vetro", "inter", 130, 2000, false, LABEL)
    expect(r).not.toBeNull()
    expect(r!.items).toBeUndefined()
    expect(r!.slotGhosts).toBeUndefined()
  })

  it("percent family e valori formattati come la riga bottom", async () => {
    expect(formatSeparateValue("tomatoes", 8.8)).toBe("88%")
    expect(formatSeparateValue("tomatoes", 10)).toBe("100%")
    const numeric = await renderSeparateRatingsNotch([{ id: "tomatoes", value: 0.5 }], 500, "notch-crema", "inter", 130, 2000, false, {})
    const percent = await renderSeparateRatingsNotch([{ id: "tomatoes", value: 10 }], 500, "notch-crema", "inter", 130, 2000, false, {})
    expect(numeric).not.toBeNull()
    expect(percent).not.toBeNull()
    // Stesso logo: "100%" è più largo di "5%", il valore formattato allarga il corpo.
    expect(percent!.w).toBeGreaterThan(numeric!.w)
  })
})

describe("contorno del gradino", () => {
  it("notchStepPathD è una sagoma unica chiusa con due corpi (4 archi, 4 raccordi)", () => {
    const d = notchStepPathD({ x: 30, boxW: 300, boxH: 40, topX: 90, topW: 180, topH: 32, fr: 32, frTop: 11, renderH: 100 })
    expect(d.startsWith("M ")).toBe(true)
    expect(d.trim().endsWith("Z")).toBe(true)
    expect(d.match(/A /g)?.length).toBe(4)
    expect(d.match(/Q /g)?.length).toBe(4)
  })

  it("il corpo basso da solo resta il contorno della pillola (fase 1 invariata)", () => {
    const single = notchPathD({ x: 30, boxW: 300, boxH: 40, fr: 32, renderH: 100, edge: "bottom" })
    expect(single).toContain("Z")
    expect(single.match(/A /g)?.length).toBe(2)
  })
})

describe("vetro del gradino: velo adattivo APCA", () => {
  it("banda chiara: velo scuro più forte di quello storico e |Lc| >= target", () => {
    const fill = notchGlassVeilFill(true)
    const alpha = Number(fill.replace(/^rgba\(0,0,0,/, "").replace(/\)$/, ""))
    expect(fill.startsWith("rgba(0,0,0,")).toBe(true)
    expect(alpha).toBeGreaterThan(0.24)
    expect(alpha).toBeLessThanOrEqual(0.8)
    const band = Math.round(232 * (1 - alpha))
    expect(Math.abs(apcaLc([255, 255, 255], [band, band, band]))).toBeGreaterThanOrEqual(NOTCH_GLASS_MIN_LC)
  })

  it("banda scura: velo chiaro storico invariato", () => {
    expect(notchGlassVeilFill(false)).toBe("rgba(255,255,255,0.14)")
  })
})

describe("stato display e UI del gradino", () => {
  it("gradino = stile bottom: sopprime badge genere standard e riga custom, mai due righe", () => {
    for (const style of MATERIALS) {
      const s = resolveSeparateDisplayState({
        badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
        separateRatings: true, separateRatingsStyle: style as SeparateRatingsStyle, sepItemCount: 3,
      })
      expect(s.bottomActive).toBe(true)
      expect(s.useSeparate).toBe(false)
      expect(s.suppressCustomRow).toBe(true)
      // I flag EFFETTIVI sono soppressi: il gradino alto li rilegge RAW.
      expect(s.effectiveBadgeGenre).toBe(false)
      expect(s.effectiveBadgeYear).toBe(false)
      expect(s.effectiveBadgeRating).toBe(false)
    }
    // Il gradino dipinge anche a 0 provider (solo genere/anno).
    const zero = resolveSeparateDisplayState({
      badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
      separateRatings: true, separateRatingsStyle: "notch-vetro", sepItemCount: 0,
    })
    expect(zero.bottomActive).toBe(true)
  })

  it("famiglia Notch nel selettore: 4 varianti con etichetta materiale", () => {
    const group = SEPARATE_STYLE_GROUPS.find((g) => g.id === "notch")
    expect(group).toBeDefined()
    expect([...(group?.members ?? [])]).toEqual([...MATERIALS])
    expect(group?.labelKey).toBe("ui.notch")
    for (const material of MATERIALS) expect(SEPARATE_VARIANT_LABELS[material]).toMatch(/^ui\.notch/)
  })
})

describe("poster-service: posizionamento, riserva logo, degradi", () => {
  function baseInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
    return {
      posterBuf: Buffer.alloc(0),
      logoFetch: null,
      backdropFetch: null,
      backdropScale: 100,
      backdropOffsetX: 0,
      backdropOffsetY: 0,
      blurEnabled: false,
      blurHeight: 50,
      blurIntensity: 10,
      blurFade: 10,
      blurDarkness: 0,
      badgesEnabled: true,
      rankingEnabled: false,
      genreName: "Fantascienza",
      voteAverage: 7.8,
      badgeStyle: "shadow",
      rankingBadgeStyle: "default",
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      badgeQuality: false,
      topLight: false,
      targetCenter: 0,
      ribbonSide: "left",
      logoScale: null,
      logoOffsetX: null,
      logoOffsetY: null,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      genreBadgeScale: 100,
      qualityBadgeScale: 100,
      separateBadgeScale: 130,
      networkLogoScale: 100,
      genreBadgeOffsetX: 0,
      genreBadgeOffsetY: 0,
      qualityBadgeOffsetX: 0,
      qualityBadgeOffsetY: 0,
      networkLogoOffsetX: 0,
      networkLogoOffsetY: 0,
      mediaType: "movie",
      finalRank: null,
      animeRankResult: null,
      rankingResult: null,
      mapping: null,
      tmdbNetworks: [],
      productionCompanies: [],
      tmdbStudios: [],
      tvType: null,
      tvStatus: null,
      releaseDate: "2024-05-01",
      firstAirDate: null,
      lastAirDate: null,
      seasonCount: null,
      originCountries: [],
      wikidataResult: { awards: [], nominations: [], studios: [], director: null } satisfies WikidataResult,
      tmdbKeywords: [],
      locale: "it",
      t: (k: string) => k,
      qLabel: null,
      queryExtra: null,
      qNetLogo: null,
      networkLogo: false,
      sd: {} satisfies ServerDefaults,
      accentOverride: null,
      imdbTop250: false,
      preRelease: false,
      shape: "poster",
      separateRatingsStyle: "notch-vetro",
      // Route-like: flag effettivi soppressi + flag RAW per il gradino alto.
      freshRawBadgeGenre: true,
      freshRawBadgeYear: true,
      separateRatings: [...ITEMS],
      ...overrides,
    }
  }

  async function darkBase(w = 500, h = 750): Promise<Buffer> {
    return sharp({ create: { width: w, height: h, channels: 3, background: "#101010" } }).jpeg().toBuffer()
  }

  async function magentaLogo(): Promise<Buffer> {
    return sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer()
  }

  async function logoTop(buf: Buffer): Promise<number> {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    for (let y = 0; y < info.height; y++) {
      let c = 0
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        if (data[i] > 200 && data[i + 1] < 100 && data[i + 2] > 200 && ++c >= 10) return y
      }
    }
    return -1
  }

  it("portrait: gradino a filo del bordo e riserva logo più alta della bottom-pills", async () => {
    const poster = await darkBase()
    const logo = await magentaLogo()
    const notch = await generatePosterBuffer({ ...baseInput(), posterBuf: poster, logoFetch: logo })
    const pills = await generatePosterBuffer({
      ...baseInput(), posterBuf: poster, logoFetch: logo, separateRatingsStyle: "bottom-pills",
    })
    const notchTop = await logoTop(notch)
    const pillsTop = await logoTop(pills)
    expect(notchTop).toBeGreaterThanOrEqual(0)
    // Riserva = altezza VERA dei due livelli: il logo sale (y minore) e non
    // viene coperto dal gradino.
    expect(notchTop).toBeLessThan(pillsTop)
    const { data, info } = await sharp(notch).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let brightBottom = 0
    for (let y = info.height - notchSeparateStepBodyHeight(500, 130, { bottom: true, top: true }); y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 140) brightBottom++
      }
    }
    expect(brightBottom).toBeGreaterThan(500)
  }, 120000)

  it("portrait: con 0 rating il gradino alto dipinge comunque (genere nel gradino)", async () => {
    const poster = await darkBase()
    const withGenre = await generatePosterBuffer({ ...baseInput(), posterBuf: poster, separateRatings: [] })
    const noSeparate = await generatePosterBuffer({
      ...baseInput(), posterBuf: poster, separateRatings: undefined, separateRatingsStyle: "column",
    })
    expect(withGenre.equals(noSeparate)).toBe(false)
    // Senza genere/anno raw e senza rating non dipinge nulla.
    const nothing = await generatePosterBuffer({
      ...baseInput(), posterBuf: poster, separateRatings: [],
      freshRawBadgeGenre: false, freshRawBadgeYear: false, genreName: null,
    })
    const bare = await generatePosterBuffer({
      ...baseInput(), posterBuf: poster, separateRatings: undefined, separateRatingsStyle: "column",
      freshRawBadgeGenre: false, freshRawBadgeYear: false, genreName: null,
    })
    expect(nothing.equals(bare)).toBe(true)
  }, 120000)

  it("landscape: ancoraggio destro (helper del genere), mai normalizzato a pills", async () => {
    const poster = await darkBase(LAND_W, LAND_H)
    const notch = await generatePosterBuffer({ ...baseInput(), posterBuf: poster, shape: "landscape", logoAlign: "left" })
    const pills = await generatePosterBuffer({
      ...baseInput(), posterBuf: poster, shape: "landscape", logoAlign: "left", separateRatingsStyle: "bottom-pills",
    })
    expect(notch.equals(pills)).toBe(false)
    const { data, info } = await sharp(notch).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // Inchiostro del gradino nella fascia bassa: massa a DESTRA, mai centrata.
    let minX = info.width, maxX = -1
    for (let y = info.height - Math.round(0.28 * info.height); y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 140) { if (x < minX) minX = x; if (x > maxX) maxX = x }
      }
    }
    expect(maxX).toBeGreaterThan(info.width - 40)
    expect(minX).toBeGreaterThan(Math.round(info.width / 2))
    // Il margine destro coincide con l'ancora del genere (helper condiviso).
    expect(minX).toBeLessThan(info.width - LANDSCAPE_BOTTOM_PILLS_SHIFT_X)
  }, 120000)

  it("Card: il gradino degrada a bottom-pills (byte-identico)", async () => {
    const poster = await darkBase()
    const notch = await generatePosterBuffer({
      ...baseInput(), posterBuf: poster, posterLayout: "provider-glass", posterFreshScope: "all", finalRank: 3,
    })
    const pills = await generatePosterBuffer({
      ...baseInput(), posterBuf: poster, posterLayout: "provider-glass", posterFreshScope: "all", finalRank: 3,
      separateRatingsStyle: "bottom-pills",
    })
    expect(notch.equals(pills)).toBe(true)
  }, 120000)
})
