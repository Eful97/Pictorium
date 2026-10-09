/**
 * Cap 5 provider separati — regressione mirata.
 *
 * Contratto:
 * - `MAX_SEPARATE_RATINGS = 5` condiviso (colonna/bottom/fresh/route via
 *   `pickSeparateRatings`); 6+ clampati in ordine, miss/zero skippati prima
 *   del cap (i valori mancanti non consumano slot visibili);
 * - MAI shrink per conteggio: gruppi 1-5 che entrano restano alle dimensioni
 *   richieste (stessa pill a 3 e a 5 provider); shrink proporzionale SOLO
 *   sull'overflow reale contro il bordo genere (o fondo canvas senza genere),
 *   misurato sul placement finale voluto (stackTop + sepOY) — mai cropping;
 * - i casi storici a 1-3 provider restano coperti dai file esistenti (qui solo
 *   aggiunte a 5, nessuna sostituzione di snapshot).
 */
import sharp from "sharp"
import { describe, it, expect } from "vitest"
import { renderSeparateRatingStack, renderSeparateRatingsBottom } from "@/lib/separate-rating-renderer"
import { generatePosterBuffer, type GenerationInput } from "@/lib/poster-service"
import { MAX_SEPARATE_RATINGS, pickSeparateRatings } from "@/lib/ratings"
import { composeFreshOverlay, freshMetaRows, type FreshMetaInput } from "@/lib/fresh-layout"
import { LAND_W, LAND_H } from "@/lib/image-utils"
import type { WikidataResult } from "@/lib/awards"
import type { ServerDefaults } from "@/lib/server-defaults"

const CW = 500
const CH = 750

const ITEMS5 = [
  { id: "imdb", value: 8.7 },
  { id: "tmdb", value: 7.9 },
  { id: "tomatoes", value: 8.8 },
  { id: "letterboxd", value: 4.1 },
  { id: "trakt", value: 7.5 },
] as const

function input(overrides: Partial<GenerationInput> = {}): GenerationInput {
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
    badgeYear: false,
    badgeRating: false,
    badgeQuality: true,
    quality: "4K",
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
    separateRatingsStyle: "column",
    separateRatings: [...ITEMS5],
    ...overrides,
  }
}

async function darkBase(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#101010" } })
    .jpeg()
    .toBuffer()
}

/** Bande luminose nella striscia destra (quality + stack + eventuale genere). */
async function rightBands(buf: Buffer) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const x0 = Math.round(info.width * 0.65)
  const rows: number[] = []
  for (let y = 0; y < info.height; y++) {
    let bright = 0
    for (let x = x0; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) bright++
    }
    rows.push(bright / (info.width - x0))
  }
  const bands: { top: number; bottom: number }[] = []
  let start = -1
  let darkRun = 0
  for (let y = 0; y < rows.length; y++) {
    if (rows[y] > 0.1) {
      if (start < 0) start = y
      darkRun = 0
    } else if (start >= 0) {
      darkRun++
      if (darkRun > 3) {
        bands.push({ top: start, bottom: y - darkRun })
        start = -1
        darkRun = 0
      }
    }
  }
  if (start >= 0) bands.push({ top: start, bottom: rows.length - 1 })
  return { bands, w: info.width, h: info.height }
}

describe("cap 5 condiviso", () => {
  it("MAX_SEPARATE_RATINGS = 5; pick salta miss/zero prima del cap, 6+ clampati in ordine", () => {
    expect(MAX_SEPARATE_RATINGS).toBe(5)
    const agg = {
      sources: { imdb: 8.7, tmdb: 7.9, tomatoes: 8.8, letterboxd: 4.1, trakt: 7.5, simkl: 8.0 },
      average: 8,
      count: 6,
    }
    const ids = ["imdb", "tmdb", "tomatoes", "letterboxd", "trakt", "simkl"]
    expect(pickSeparateRatings(agg, ids).map((r) => r.id)).toEqual([
      "imdb", "tmdb", "tomatoes", "letterboxd", "trakt",
    ])
    // Miss/zero non consumano slot: con 2 miss in testa passano comunque 5 visibili.
    const withMiss = {
      sources: { ...agg.sources, mal: 0 },
      average: 8,
      count: 7,
    }
    expect(
      pickSeparateRatings(withMiss, ["mal", "unknown", ...ids]).map((r) => r.id),
    ).toEqual(["imdb", "tmdb", "tomatoes", "letterboxd", "trakt"])
  })

  it("colonna diretta: 6+ clampati a 5 byte-identici (ordine preservato)", async () => {
    const five = await renderSeparateRatingStack([...ITEMS5], 500, false, "inter", 100)
    const six = await renderSeparateRatingStack([...ITEMS5, { id: "simkl", value: 8.1 }], 500, false, "inter", 100)
    expect(five).not.toBeNull()
    expect(six).not.toBeNull()
    expect(six!.w).toBe(five!.w)
    expect(six!.h).toBe(five!.h)
    expect(six!.png.equals(five!.png)).toBe(true)
  })
})

describe("colonna portrait: 5 provider entrano senza shrink né overlap", () => {
  it("stessa dimensione pill a 3 e a 5 provider, stack intero nella zona alta", async () => {
    const base = await darkBase(CW, CH)
    const three = await generatePosterBuffer({
      ...input(), posterBuf: base, separateRatings: [...ITEMS5].slice(0, 3),
    })
    const five = await generatePosterBuffer({ ...input(), posterBuf: base })
    const b3 = await rightBands(three)
    const b5 = await rightBands(five)
    // Quality + pill: tutte bande distinte in entrambi i render (il genere in
    // stile shadow è testo sottile centrato e non emerge nella striscia).
    expect(b3.bands.length).toBeGreaterThanOrEqual(4)
    expect(b5.bands.length).toBeGreaterThanOrEqual(6)
    // Mai shrink per conteggio: la prima pill ha gli stessi bordi a 3 e a 5.
    expect(b5.bands[1].top).toBe(b3.bands[1].top)
    expect(b5.bands[1].bottom).toBe(b3.bands[1].bottom)
    // Lo stack a 5 resta intero nella zona alta, lontano dal badge genere in
    // basso (nessun overlap, nessun cropping verso il fondo).
    expect(b5.bands[b5.bands.length - 1].bottom).toBeLessThan(500)
  }, 60000)
})

describe("colonna landscape: overflow a 5 provider rientra in proporzione senza cropping", () => {
  it("scala 200 con genere: stack sopra il genere con gap scuro, tutto nel canvas", async () => {
    const base = await darkBase(LAND_W, LAND_H)
    const buf = await generatePosterBuffer({
      ...input(),
      posterBuf: base,
      shape: "landscape",
      separateBadgeScale: 200,
    })
    const { bands, h } = await rightBands(buf)
    // Quality in alto + contenuto stack + genere in basso (a shrink avvenuto
    // i gap interni possono fondersi al detector: conta la separazione stack/genere).
    expect(bands.length).toBeGreaterThanOrEqual(4)
    expect(bands[0].top).toBeLessThan(60)
    const stackBottom = bands[bands.length - 2].bottom
    const genreTop = bands[bands.length - 1].top
    expect(genreTop - stackBottom).toBeGreaterThanOrEqual(4)
    expect(bands[bands.length - 1].bottom).toBeLessThan(h)
  }, 60000)
})

describe("colonna senza genere: overflow rientra nel fondo canvas col margine", () => {
  it("portrait scala 200, 5 provider: stack dentro il canvas senza cropping", async () => {
    const base = await darkBase(CW, CH)
    const buf = await generatePosterBuffer({
      ...input(),
      posterBuf: base,
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      genreName: null,
      voteAverage: null,
      separateBadgeScale: 200,
    })
    const { bands, h } = await rightBands(buf)
    // Quality + 5 pill, nessun genere: tutto dentro il canvas col margine.
    expect(bands.length).toBeGreaterThanOrEqual(6)
    expect(bands[bands.length - 1].bottom).toBeLessThanOrEqual(h - 15)
  }, 60000)
})

describe("column with positive sepOY: offset-aware fit shrinks instead of overlapping genre", () => {
  it("large +Y offset shrinks the 5-column above the visible genre pill, no overlap, inside canvas", async () => {
    // Positive regression for the offset-aware containment: the available
    // height is measured from the wanted placement (stackTop + sepOY), so
    // pushing the column down shrinks it against the genre edge instead of
    // sliding full-size over the genre badge. badgeStyle "pill" keeps the
    // genre badge visible to the band detector (shadow-style text is too
    // thin to detect). Relational assertions only (no absolute positions),
    // so unrelated render drift cannot flake this test.
    const stack = await renderSeparateRatingStack([...ITEMS5], CW, false, "inter", 100)
    expect(stack).not.toBeNull()
    const base = await darkBase(CW, CH)
    const ref = await generatePosterBuffer({ ...input({ badgeStyle: "pill" }), posterBuf: base })
    const pushed = await generatePosterBuffer({
      ...input({ badgeStyle: "pill" }),
      posterBuf: base,
      separateBadgeOffsetY: 400,
    })
    const { bands: refBands } = await rightBands(ref)
    const { bands: pushedBands } = await rightBands(pushed)
    // Quality + 5 pills + genre pill in both renders.
    expect(refBands.length).toBeGreaterThanOrEqual(7)
    expect(pushedBands.length).toBeGreaterThanOrEqual(7)
    // The offset moves only the column: quality and genre pills are unmoved.
    expect(pushedBands[0]).toEqual(refBands[0])
    const refGenre = refBands[refBands.length - 1]
    const pushedGenre = pushedBands[pushedBands.length - 1]
    expect(pushedGenre.top).toBe(refGenre.top)
    // Reference span equals the requested stack height (no shrink at rest).
    const refSpan = refBands[refBands.length - 2].bottom - refBands[1].top + 1
    expect(refSpan).toBe(stack!.h)
    // The column moved down AND shrank: without the offset-aware fit it would
    // keep full size and overlap the genre pill.
    expect(pushedBands[1].top).toBeGreaterThan(refBands[1].top)
    const pushedSpan = pushedBands[pushedBands.length - 2].bottom - pushedBands[1].top + 1
    expect(pushedSpan).toBeLessThan(refSpan - 20)
    // Still contained: dark gap before the genre pill, genre inside canvas.
    expect(pushedGenre.top - pushedBands[pushedBands.length - 2].bottom).toBeGreaterThanOrEqual(4)
    expect(pushedGenre.bottom).toBeLessThanOrEqual(CH - 15)
  }, 60000)
})

describe("bottom portrait: 5 pill entrano nella larghezza disponibile", () => {
  it("renderer diretto + riga visibile nel poster senza clipping", async () => {
    const availW = CW - 36
    const row = await renderSeparateRatingsBottom([...ITEMS5], 500, "bottom-pills", "inter", 130, availW, false)
    expect(row).not.toBeNull()
    expect(row!.w).toBeLessThanOrEqual(availW)
    const base = await darkBase(CW, CH)
    const buf = await generatePosterBuffer({
      ...input(), posterBuf: base, separateRatingsStyle: "bottom-pills", separateBadgeScale: 130,
    })
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let bright = 0
    for (let y = info.height - 160; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 150) bright++
      }
    }
    expect(bright).toBeGreaterThan(500)
  }, 60000)
})

describe("fresh: 5 righe separate restano nel canvas (entrambi i formati)", () => {
  function meta(): FreshMetaInput {
    return {
      badgesEnabled: true,
      badgeGenre: true,
      badgeYear: true,
      badgeRating: true,
      separateRatingsEnabled: true,
      separateRatingsStyle: "column",
      customRatingsEnabled: false,
      genreName: "Dramma",
      year: "2024",
      voteAverage: 8.3,
      separateRatings: [...ITEMS5],
      customRatings: undefined,
    }
  }

  it("freshMetaRows emette 5 righe senza media ★", () => {
    const rows = freshMetaRows(meta())
    expect(rows.filter((r) => r.kind === "separate")).toHaveLength(5)
    expect(rows.some((r) => r.kind === "rating")).toBe(false)
  })

  it("overlay ranked con 5 separati: tutti i layer dentro il canvas", async () => {
    const poster = await darkBase(CW, CH)
    const logo = await sharp({ create: { width: 220, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer()
    const provider = await sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } } }).png().toBuffer()
    for (const [cW, cH] of [[CW, CH], [LAND_W, LAND_H]] as const) {
      const layers = await composeFreshOverlay({
        posterBuf: poster,
        CW: cW,
        CH: cH,
        rank: 20,
        meta: meta(),
        logo: { png: logo, w: 220, h: 100 },
        provider: { png: provider, w: 300, h: 120 },
      })
      expect(layers.length).toBeGreaterThan(1)
      for (const layer of layers) {
        const m = await sharp(layer.input).metadata()
        expect(layer.left).toBeGreaterThanOrEqual(0)
        expect(layer.top).toBeGreaterThanOrEqual(0)
        expect(layer.left + (m.width ?? 0)).toBeLessThanOrEqual(cW)
        expect(layer.top + (m.height ?? 0)).toBeLessThanOrEqual(cH)
      }
    }
  }, 120000)
})
