/**
 * Riga rating separati bottom (`bottom-bar` / `bottom-pills`) — Compito 2
 * (renderer + layout, nessuna UI).
 *
 * Contratto:
 * - logo + valore inline, max 3 (clamp anche su chiamate dirette), vuota → null;
 * - percent per la famiglia percent, font/scala esistenti, scala 10..200 nativa;
 * - fit sicuro: font-loop + shrink proporzionale, mai clipping;
 * - colonna byte-identica (qui solo regressione indiretta: i test colonna
 *   restano invariati e verdi); custom conserva la priorità storica sulla
 *   colonna, il bottom vince difensivamente sul custom nel service.
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import {
  renderSeparateRatingsBottom,
} from "@/lib/separate-rating-renderer"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { formatSeparateValue, MAX_SEPARATE_RATINGS } from "@/lib/ratings"
import { resolveSeparateDisplayState } from "@/lib/poster-config"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const ITEMS = [
  { id: "imdb", value: 8.7 },
  { id: "tmdb", value: 7.9 },
  { id: "tomatoes", value: 8.8 },
] as const

describe("renderSeparateRatingsBottom base", () => {
  it("max 3 provider anche su chiamate dirette (4 → clamp a 3)", async () => {
    expect(MAX_SEPARATE_RATINGS).toBe(3)
    const three = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills")
    const four = await renderSeparateRatingsBottom([...ITEMS, { id: "letterboxd", value: 4.1 }], 500, "bottom-pills")
    expect(three).not.toBeNull()
    expect(four).not.toBeNull()
    expect(four!.w).toBe(three!.w)
    expect(four!.h).toBe(three!.h)
    expect(four!.png.equals(three!.png)).toBe(true)
  })

  it("vuota → null (mai placeholder senza dati)", async () => {
    expect(await renderSeparateRatingsBottom([], 500, "bottom-bar")).toBeNull()
    expect(await renderSeparateRatingsBottom([], 500, "bottom-pills")).toBeNull()
    // Solo fonti senza asset → nessuna pill → null.
    expect(await renderSeparateRatingsBottom([{ id: "unknown-src", value: 7 }], 500, "bottom-pills")).toBeNull()
  })

  it("percent per la famiglia percent, decimale altrove", () => {
    expect(formatSeparateValue("tomatoes", 8.8)).toBe("88%")
    expect(formatSeparateValue("popcorntime", 9.15)).toBe("92%")
    expect(formatSeparateValue("imdb", 8.75)).toBe("8.8")
  })

  it("bar full-width, pills 1/2/3 crescenti", async () => {
    const bar = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-bar", "inter", 100, 500)
    expect(bar).not.toBeNull()
    expect(bar!.w).toBe(500)
    expect(bar!.h).toBeGreaterThan(0)
    const one = await renderSeparateRatingsBottom([ITEMS[0]], 500, "bottom-pills")
    const two = await renderSeparateRatingsBottom([ITEMS[0], ITEMS[1]], 500, "bottom-pills")
    const three = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills")
    expect(one).not.toBeNull()
    expect(two!.w).toBeGreaterThan(one!.w)
    expect(three!.w).toBeGreaterThan(two!.w)
    expect(three!.h).toBe(one!.h)
  })

  it("scala nativa 100→150, bound 10..200, garbage → 100", async () => {
    const at100 = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", 100)
    const at150 = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", 150)
    const omitted = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills")
    const garbage = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", Number.NaN)
    expect(at100).not.toBeNull()
    expect(at150!.h).toBeGreaterThan(at100!.h)
    expect(at150!.w).toBeGreaterThan(at100!.w)
    expect(omitted!.png.equals(at100!.png)).toBe(true)
    expect(garbage!.png.equals(at100!.png)).toBe(true)
  })

  it("font diversi cambiano i byte; materiale sempre scuro con testo chiaro (pixel dimostrati)", async () => {
    const inter = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", 100)
    const oswald = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "oswald", 100)
    expect(inter).not.toBeNull()
    expect(oswald).not.toBeNull()
    expect(oswald!.png.equals(inter!.png)).toBe(false)
    // Fascia scura satinata + testo/logo chiari: media bassa, picchi alti.
    for (const bmp of [inter!, oswald!]) {
      const { data } = await sharp(bmp.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let sum = 0
      let max = 0
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
        sum += lum
        if (lum > max) max = lum
      }
      expect(sum / (data.length / 4)).toBeLessThan(120)
      expect(max).toBeGreaterThan(200)
    }
    const bar = await renderSeparateRatingsBottom([ITEMS[0]], 500, "bottom-bar", "inter", 100, 500)
    const { data: barData } = await sharp(bar!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let barSum = 0
    let barMax = 0
    for (let i = 0; i < barData.length; i += 4) {
      const lum = (barData[i] + barData[i + 1] + barData[i + 2]) / 3
      barSum += lum
      if (lum > barMax) barMax = lum
    }
    expect(barSum / (barData.length / 4)).toBeLessThan(120)
    expect(barMax).toBeGreaterThan(200)
  })

  it("fit sicuro: valori lunghi + scala 200 + width stretta, mai oltre maxWidth", async () => {
    const long = [
      { id: "tomatoes", value: 10 },
      { id: "popcorntime", value: 10 },
      { id: "letterboxd", value: 5 },
    ]
    const pills = await renderSeparateRatingsBottom(long, 500, "bottom-pills", "inter", 200, 200)
    expect(pills).not.toBeNull()
    expect(pills!.w).toBeLessThanOrEqual(200)
    expect(pills!.h).toBeGreaterThan(0)
    // Aspect preservato dallo shrink proporzionale (h scala con w).
    const wide = await renderSeparateRatingsBottom(long, 500, "bottom-pills", "inter", 200, 2000)
    expect(wide!.w).toBeGreaterThan(pills!.w)
    expect(Math.abs(pills!.h / pills!.w - wide!.h / wide!.w)).toBeLessThan(0.05)
  })

  it("fit vero: loghi larghi + 100% a scala 200 in width stretta (celle e riga)", async () => {
    const wide = [
      { id: "letterboxd", value: 10 },
      { id: "tomatoes", value: 10 },
      { id: "popcorntime", value: 10 },
    ]
    // Bar: width fissa, il font-loop riduce finché ogni cella contiene il
    // contenuto (h minore del render libero = loop scattato).
    const barTight = await renderSeparateRatingsBottom(wide, 500, "bottom-bar", "inter", 200, 300)
    const barFree = await renderSeparateRatingsBottom(wide, 500, "bottom-bar", "inter", 200, 2000)
    expect(barTight).not.toBeNull()
    expect(barTight!.w).toBe(300)
    expect(barTight!.h).toBeLessThan(barFree!.h)
    // Pills: riga mai oltre maxWidth.
    const pillsTight = await renderSeparateRatingsBottom(wide, 500, "bottom-pills", "inter", 200, 250)
    expect(pillsTight).not.toBeNull()
    expect(pillsTight!.w).toBeLessThanOrEqual(250)
    expect(pillsTight!.h).toBeGreaterThan(0)
  })
})

describe("resolveSeparateDisplayState: mai righe duplicate", () => {
  it("useSeparate e bottomActive mai insieme; suppressCustomRow solo in bottom", () => {
    const combos: { style: "column" | "bottom-bar" | "bottom-pills"; count: number }[] = []
    for (const style of ["column", "bottom-bar", "bottom-pills"] as const) {
      for (const count of [0, 1, 3]) combos.push({ style, count })
    }
    for (const { style, count } of combos) {
      const s = resolveSeparateDisplayState({
        badgesEnabled: true, badgeGenre: true, badgeYear: true, badgeRating: true,
        separateRatings: true, separateRatingsStyle: style, sepItemCount: count,
      })
      expect(s.useSeparate && s.bottomActive).toBe(false)
      expect(s.suppressCustomRow).toBe(s.bottomActive)
      if (style === "column" && count > 0) {
        expect(s.useSeparate).toBe(true)
        expect(s.suppressCustomRow).toBe(false)
      }
      if (style !== "column") {
        expect(s.useSeparate).toBe(false)
        expect(s.bottomActive).toBe(true)
      }
    }
  })
})

describe("poster-service bottom vs custom (difensivo) e colonna legacy", () => {
  function portraitInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
      genreName: "Dramma",
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
      separateBadgeScale: 100,
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
      releaseDate: null,
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
      separateRatingsStyle: "bottom-bar",
      separateRatings: [...ITEMS],
      ...overrides,
    }
  }

  async function darkPoster(): Promise<Buffer> {
    return sharp({
      create: { width: 500, height: 750, channels: 3, background: "#101010" },
    })
      .jpeg()
      .toBuffer()
  }

  const customRatings = [{ id: "imdb", name: "IMDb", value: 8.1, format: "decimal" as const }]

  it("bottom + custom → custom ignorato (byte-identico a bottom solo)", async () => {
    const base = await darkPoster()
    const bottomOnly = await generatePosterBuffer({ ...portraitInput(), posterBuf: base })
    const bottomCustom = await generatePosterBuffer({ ...portraitInput(), posterBuf: base, ratings: customRatings })
    expect(bottomOnly.equals(bottomCustom)).toBe(true)
  }, 60000)

  it("colonna legacy: custom vince (byte-identico a custom solo)", async () => {
    const base = await darkPoster()
    const genreOn = { badgeGenre: true, badgeYear: true, badgeRating: true }
    const columnCustom = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base, separateRatingsStyle: "column", ratings: customRatings, ...genreOn,
    })
    const customOnly = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base, separateRatingsStyle: "column", separateRatings: undefined, ratings: customRatings, ...genreOn,
    })
    expect(columnCustom.equals(customOnly)).toBe(true)
    // ...e senza custom la colonna si vede (byte diversi).
    const columnOnly = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base, separateRatingsStyle: "column", ratings: undefined, ...genreOn,
    })
    expect(columnOnly.equals(columnCustom)).toBe(false)
  }, 60000)

  it("bottom senza dati + custom → custom soppresso (non inventa provider)", async () => {
    const base = await darkPoster()
    const withCustom = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base, separateRatings: [], ratings: customRatings,
    })
    const withoutCustom = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base, separateRatings: [], ratings: undefined,
    })
    expect(withCustom.equals(withoutCustom)).toBe(true)
  }, 60000)

  it("bottom senza valori → nessun placeholder (byte-identico a nessun separato)", async () => {
    const base = await darkPoster()
    const bottomEmpty = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base, separateRatings: [],
    })
    const noSeparate = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base, separateRatingsStyle: "column", separateRatings: undefined,
    })
    expect(bottomEmpty.equals(noSeparate)).toBe(true)
    // ...ma con valori la riga si disegna davvero (anti-falso-positivo).
    const bottomFull = await generatePosterBuffer({
      ...portraitInput(), posterBuf: base,
    })
    expect(bottomFull.equals(noSeparate)).toBe(false)
  }, 60000)
})
