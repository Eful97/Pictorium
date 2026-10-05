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
import { generatePosterBuffer, LANDSCAPE_BOTTOM_PILLS_SHIFT_X, type GenerationInput } from "@/lib/poster-service"
import { LAND_W, LAND_H } from "@/lib/image-utils"
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

  it("scala nativa 100→150, bound 10..200, garbage → 130 (nuovo default)", async () => {
    const at100 = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", 100)
    const at130 = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", 130)
    const at150 = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", 150)
    const omitted = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills")
    const garbage = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-pills", "inter", Number.NaN)
    expect(at100).not.toBeNull()
    expect(at150!.h).toBeGreaterThan(at100!.h)
    expect(at150!.w).toBeGreaterThan(at100!.w)
    // Omesso == esplicito 130 byte-identici (default unico); garbage → 130.
    expect(omitted!.png.equals(at130!.png)).toBe(true)
    expect(garbage!.png.equals(at130!.png)).toBe(true)
    expect(at130!.png.equals(at100!.png)).toBe(false)
  })

  it("polarità adattiva: bottomLight true/false rendono diverso; omesso == true", async () => {
    // Fondo chiaro → fascia scura (default true); fondo scuro → fascia chiara.
    const dark = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-bar", "inter", 130, 500, true)
    const light = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-bar", "inter", 130, 500, false)
    const omitted = await renderSeparateRatingsBottom([...ITEMS], 500, "bottom-bar", "inter", 130, 500)
    expect(dark).not.toBeNull()
    expect(light).not.toBeNull()
    expect(dark!.png.equals(light!.png)).toBe(false)
    expect(omitted!.png.equals(dark!.png)).toBe(true)
    // Fascia scura: media bassa con picchi chiari (testo/loghi); fascia
    // chiara: media alta con testo scuro (mai clip: max < 255 pieno ovunque).
    for (const [bmp, darkBand] of [[dark!, true], [light!, false]] as const) {
      const { data } = await sharp(bmp.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
      const mean = sum / (data.length / 4)
      if (darkBand) expect(mean).toBeLessThan(120)
      else expect(mean).toBeGreaterThan(120)
    }
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

describe("logo anchor invariance column/bottom (reservation logoBadgeVisibility)", () => {
  // Il logo titolo resta alla stessa altezza della colonna equivalente in
  // tutti gli stili (la route passa i flag colonna in `logoBadgeVisibility`;
  // qui replicati a mano come fa la route: raw genre/year + rating effettivo
  // della colonna equivalente). Rilevato a pixel: logo magenta unico nel
  // poster scuro, si confronta la prima riga magenta tra gli stili.
  async function magentaLogo(): Promise<Buffer> {
    return sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 255, g: 0, b: 255 } },
    })
      .png()
      .toBuffer()
  }

  async function logoTop(buf: Buffer): Promise<number> {
    // Prima riga con una corsa significativa (≥10px): i bordi del resize +
    // la compressione lossy lasciano singoli pixel magenta spuri sulla riga
    // sopra il logo vero (1px isolato vs ~300px della riga piena) — senza
    // soglia il detector scambia ringing per geometria. Uno shift reale
    // muoverebbe l'intera riga piena, mai un pixel solo.
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

  function logoInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
      badgeGenre: true,
      badgeYear: true,
      badgeRating: true,
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
      separateRatingsStyle: "column",
      separateRatings: [...ITEMS],
      ...overrides,
    }
  }

  async function landBase(): Promise<Buffer> {
    return sharp({
      create: { width: LAND_W, height: LAND_H, channels: 3, background: "#101010" },
    })
      .jpeg()
      .toBuffer()
  }

  async function darkBase(): Promise<Buffer> {
    return sharp({
      create: { width: 500, height: 750, channels: 3, background: "#101010" },
    })
      .jpeg()
      .toBuffer()
  }

  /**
   * Replica la route (`route.ts` ~rr. 1945-1976, 2219): al service arrivano i
   * flag EFFETTIVI (soppressione solo render, mai stored); in bottom anche
   * `logoBadgeVisibility` con l'equivalente colonna (raw genre/year + rating
   * effettivo colonna). Senza questo passaggio il test confronterebbe un
   * wiring che la route non produce mai.
   */
  function routeLikeFlags(
    style: "column" | "bottom-bar" | "bottom-pills",
    rawGenre: boolean,
    rawYear: boolean,
    itemCount: number,
  ) {
    const disp = resolveSeparateDisplayState({
      badgesEnabled: true, badgeGenre: rawGenre, badgeYear: rawYear, badgeRating: true,
      separateRatings: true, separateRatingsStyle: style, sepItemCount: itemCount,
    })
    const columnEquiv = style === "column" ? null : resolveSeparateDisplayState({
      badgesEnabled: true, badgeGenre: rawGenre, badgeYear: rawYear, badgeRating: true,
      separateRatings: true, separateRatingsStyle: "column", sepItemCount: itemCount,
    })
    return {
      badgeGenre: disp.effectiveBadgeGenre,
      badgeYear: disp.effectiveBadgeYear,
      badgeRating: disp.effectiveBadgeRating,
      logoBadgeVisibility: columnEquiv
        ? { genre: rawGenre, year: rawYear, rating: columnEquiv.effectiveBadgeRating }
        : undefined,
    }
  }

  it("portrait: stesso top logo in column/bottom-bar/bottom-pills (genere+anno ON e OFF)", async () => {
    const base = await darkBase()
    const logo = await magentaLogo()
    for (const prefs of [
      { badgeGenre: true, badgeYear: true },
      { badgeGenre: false, badgeYear: false },
    ]) {
      const tops: number[] = []
      for (const style of ["column", "bottom-bar", "bottom-pills"] as const) {
        const buf = await generatePosterBuffer({
          ...logoInput(), posterBuf: base, logoFetch: logo,
          ...routeLikeFlags(style, prefs.badgeGenre, prefs.badgeYear, ITEMS.length),
          separateRatingsStyle: style,
        })
        const top = await logoTop(buf)
        expect(top).toBeGreaterThanOrEqual(0)
        tops.push(top)
      }
      expect(new Set(tops).size).toBe(1)
    }
  }, 120000)

  it("portrait: invarianza anche a 0/1 provider (reservation copre i miss)", async () => {
    const base = await darkBase()
    const logo = await magentaLogo()
    for (const items of [[], [ITEMS[0]], [...ITEMS]] as const) {
      const column = await generatePosterBuffer({
        ...logoInput(), posterBuf: base, logoFetch: logo,
        ...routeLikeFlags("column", true, true, items.length),
        separateRatingsStyle: "column", separateRatings: [...items],
      })
      const bottom = await generatePosterBuffer({
        ...logoInput(), posterBuf: base, logoFetch: logo,
        ...routeLikeFlags("bottom-bar", true, true, items.length),
        separateRatingsStyle: "bottom-bar", separateRatings: [...items],
      })
      const ct = await logoTop(column)
      const bt = await logoTop(bottom)
      expect(ct).toBeGreaterThanOrEqual(0)
      expect(bt).toBe(ct)
    }
  }, 120000)

  it("landscape: stesso top logo nei tre stili (genere+anno ON)", async () => {
    const base = await landBase()
    const logo = await magentaLogo()
    const tops: number[] = []
    for (const style of ["column", "bottom-bar", "bottom-pills"] as const) {
      const buf = await generatePosterBuffer({
        ...logoInput(), posterBuf: base, logoFetch: logo, shape: "landscape",
        ...routeLikeFlags(style, true, true, ITEMS.length),
        separateRatingsStyle: style,
      })
      const top = await logoTop(buf)
      expect(top).toBeGreaterThanOrEqual(0)
      tops.push(top)
    }
    expect(new Set(tops).size).toBe(1)
  }, 120000)

  it("landscape: bottom-bar normalizzata a pills (byte-identiche); portrait barra intatta", async () => {
    // Stessi flag effettivi che la route produrrebbe (config già normalizzato
    // a pills): lo stile raw bar deve rendere pills anche per chiamanti diretti.
    const base = await landBase()
    const flags = routeLikeFlags("bottom-pills", true, true, ITEMS.length)
    const viaBar = await generatePosterBuffer({
      ...logoInput(), posterBuf: base, shape: "landscape",
      ...flags, separateRatingsStyle: "bottom-bar", separateRatings: [...ITEMS],
    })
    const viaPills = await generatePosterBuffer({
      ...logoInput(), posterBuf: base, shape: "landscape",
      ...flags, separateRatingsStyle: "bottom-pills", separateRatings: [...ITEMS],
    })
    expect(viaBar.equals(viaPills)).toBe(true)
    // Portrait: la barra resta barra (byte diversi dalle pills).
    const pBase = await darkBase()
    const pBar = await generatePosterBuffer({
      ...logoInput(), posterBuf: pBase,
      ...routeLikeFlags("bottom-bar", true, true, ITEMS.length),
      separateRatingsStyle: "bottom-bar", separateRatings: [...ITEMS],
    })
    const pPills = await generatePosterBuffer({
      ...logoInput(), posterBuf: pBase,
      ...routeLikeFlags("bottom-pills", true, true, ITEMS.length),
      separateRatingsStyle: "bottom-pills", separateRatings: [...ITEMS],
    })
    expect(pBar.equals(pPills)).toBe(false)
  }, 120000)

  it("landscape pills: ancoraggio destro esatto in entrambe le polarità (mai centrate)", async () => {
    for (const bottomLight of [false, true]) {
      for (const count of [1, 2, 3]) {
      const bg = bottomLight
        ? await sharp({ create: { width: LAND_W, height: LAND_H, channels: 3, background: "#e8e8e8" } }).jpeg().toBuffer()
        : await landBase()
      const buf = await generatePosterBuffer({
        ...logoInput(), posterBuf: bg, shape: "landscape",
        ...routeLikeFlags("bottom-pills", true, true, count),
        separateRatingsStyle: "bottom-pills", separateRatings: [...ITEMS].slice(0, count),
        topLight: false, bottomLight,
      })
      // Larghezza attesa dagli stessi argomenti del service (badgePw=500 in
      // landscape, availW=CW-80, scala 130): le pills usano il margine
      // interno pieno 18*CW/380 senza il +40 ottico del genere.
      const row = await renderSeparateRatingsBottom([...ITEMS].slice(0, count), 500, "bottom-pills", "inter", 130, LAND_W - 80, bottomLight)
      expect(row).not.toBeNull()
      const rightPad = Math.round(18 * LAND_W / 380)
      // Base landscape -20 X (LANDSCAPE_BOTTOM_PILLS_SHIFT_X) dopo l'ancoraggio
      // destro a margine pieno: margine destro = rightPad + 20.
      const expectedLeft = Math.min(LAND_W - row!.w, Math.max(0, LAND_W - row!.w - rightPad + LANDSCAPE_BOTTOM_PILLS_SHIFT_X))
      // Margine destro pieno + rientro 20 (~56px su 768), mai a filo bordo.
      expect(LAND_W - (expectedLeft + row!.w)).toBe(rightPad - LANDSCAPE_BOTTOM_PILLS_SHIFT_X)
      const centeredLeft = Math.round((LAND_W - row!.w) / 2)
      expect(Math.abs(expectedLeft - centeredLeft)).toBeGreaterThan(50)
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let minX = info.width, maxX = -1, countPx = 0
      for (let y = info.height - 130; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = (y * info.width + x) * 4
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
          const hit = bottomLight ? lum < 120 : lum > 150
          if (hit) { if (x < minX) minX = x; if (x > maxX) maxX = x; countPx++ }
        }
      }
      expect(countPx).toBeGreaterThan(500)
      // Tolleranza ±8px per ombra seps/AA/jpeg (l'ombra sborda ~4px).
      expect(Math.abs(minX - expectedLeft)).toBeLessThanOrEqual(8)
      expect(Math.abs(maxX - (expectedLeft + row!.w))).toBeLessThanOrEqual(8)
      }
    }
  }, 180000)

  it("landscape pills scala 200: max 3 senza clipping, titolo mai coperto", async () => {
    const base = await landBase()
    const logo = await magentaLogo()
    const shared = {
      // logoAlign left = default produzione in landscape (come la route).
      ...logoInput(), posterBuf: base, logoFetch: logo, shape: "landscape" as const, logoAlign: "left" as const,
      separateRatings: [...ITEMS], separateBadgeScale: 200,
    }
    const pills = await generatePosterBuffer({
      ...shared, ...routeLikeFlags("bottom-pills", true, true, ITEMS.length),
      separateRatingsStyle: "bottom-pills",
    })
    // Riferimento colonna (stessa reservation logo, mai sopra il titolo).
    const column = await generatePosterBuffer({
      ...shared, ...routeLikeFlags("column", true, true, ITEMS.length),
      separateRatingsStyle: "column",
    })
    const magentaCount = async (buf: Buffer): Promise<number> => {
      const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let c = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] < 100 && data[i + 2] > 200) c++
      }
      return c
    }
    const columnCount = await magentaCount(column)
    expect(columnCount).toBeGreaterThan(1000)
    // Stesso titolo a pixel (tolleranza jpeg): le pills destre non lo coprono.
    expect(Math.abs((await magentaCount(pills)) - columnCount))
      .toBeLessThanOrEqual(Math.max(50, Math.round(columnCount * 0.02)))
    // Riga visibile e dentro il canvas (no clipping): pixel chiari in banda bassa.
    const { data, info } = await sharp(pills).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let bright = 0
    for (let y = info.height - 160; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 150) bright++
      }
    }
    expect(bright).toBeGreaterThan(500)
  }, 180000)
})
