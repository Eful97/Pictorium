import { test, expect, type APIRequestContext } from "@playwright/test"
import sharp from "sharp"

// Harness di parità preview-vs-Stremio (Golden Rule misurata): stesso titolo,
// URL editor (ramo queryPoster) contro URL Stremio mappato (ramo mapping).
// Mock deterministico; soglia pixel stretta; cleanup mapping in finally per
// non inquinare lo stato e2e condiviso.
//
// Entrambe le URL sono servite dallo STESSO renderer: un delta non nullo è
// rumore di decodifica/scheduler, mai una differenza di layout. Il bound è
// quindi molto più stretto di una regressione visiva e non richiede snapshot
// per-OS (i byte sono prodotti server-side e riletti 1:1).
const PARITY_MAX_MEAN_DIFF = 0.01
// Bound delle asserzioni aggiunte (landscape / stile qualità non-standard /
// separati bottom): un ordine di grandezza sotto il bound storico, così una
// divergenza reale tra i due rami non può più nascondersi sotto la soglia
// larga dei golden screenshot.
const PARITY_STRICT_MAX_MEAN_DIFF = 0.0025
const IDS = [603, 604, 605, 606, 607]

// Visual condivisi: il mapping li salva, la preview li ripete in query con i
// nomi del contratto pubblico. Restano identici per costruzione.
const BASE_MAPPING = {
  mediaType: "movie",
  title: "Avatar",
  posterPath: "/mocked/avatar.jpg",
  genreName: "Azione",
  voteAverage: 7.8,
  language: "en",
  showBadges: true,
  rankingBadges: false,
  badgeStyle: "shadow",
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  gradientHeight: 30,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  blurEnabled: true,
  tintStrength: 20,
  topShade: 50,
  topShadeHeight: 25,
}

const BASE_PREVIEW = {
  poster: "/mocked/avatar.jpg",
  genreName: "Azione",
  voteAverage: "7.8",
  title: "Avatar",
  bs: "shadow",
  badges: "1",
  ranking: "0",
  bg: "1",
  by: "1",
  br: "1",
  gradHeight: "30",
  blur: "20",
  bf: "50",
  bd: "30",
  tint: "20",
  ts: "50",
  tsh: "25",
  lang: "it",
  region: "IT",
  preview: "1",
}

function mappingFor(id: number, overrides: Record<string, unknown> = {}) {
  return { ...BASE_MAPPING, tmdbId: id, ...overrides }
}

function previewUrl(id: number, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams({ ...BASE_PREVIEW, ...extra })
  return `/api/poster/movie/${id}?${qs.toString()}`
}

function stremioUrl(id: number, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams({ lang: "it", region: "IT", ...extra })
  return `/api/poster/movie/${id}?${qs.toString()}`
}

async function saveMapping(
  request: APIRequestContext,
  id: number,
  overrides: Record<string, unknown> = {},
) {
  const res = await request.post("/api/mappings", { data: mappingFor(id, overrides) })
  expect(res.ok()).toBeTruthy()
}

async function deleteMapping(request: APIRequestContext, id: number) {
  await request.delete(`/api/mappings/movie:${id}`).catch(() => null)
}

async function renderPng(
  request: APIRequestContext,
  url: string,
): Promise<Buffer> {
  const res = await request.get(url)
  expect(res.ok()).toBeTruthy()
  return Buffer.from(await res.body())
}

async function meanAbsDiff(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rb = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect(ra.info.width).toBe(rb.info.width)
  expect(ra.info.height).toBe(rb.info.height)
  const da = ra.data
  const db = rb.data
  let sum = 0
  for (let i = 0; i < da.length; i++) sum += Math.abs(da[i]! - db[i]!)
  return sum / da.length / 255
}

test.describe("parity preview-vs-Stremio (mapped title)", () => {
  test.afterEach(async ({ request }) => {
    for (const id of IDS) await deleteMapping(request, id)
  })

  test("debug JSON: stesse immagini, badge e blur", async ({ request }) => {
    const id = IDS[0]!
    await saveMapping(request, id)
    try {
      const prev = await (await request.get(`${previewUrl(id)}&debug=1`)).json()
      const stre = await (await request.get(`${stremioUrl(id)}&debug=1`)).json()
      expect(stre.images.poster).toBe(prev.images.poster)
      expect(stre.images.logo).toBe(prev.images.logo)
      expect(stre.badge.computed.badge).toEqual(prev.badge.computed.badge)
      expect(stre.appearance.blurHeight).toBe(prev.appearance.blurHeight)
      expect(stre.appearance.blurFade).toBe(prev.appearance.blurFade)
      // Upper shadow strength + height roundtrip: mapping and explicit
      // preview query resolve identically (query > mapping > defaults).
      expect(stre.appearance.topShade).toBe(50)
      expect(prev.appearance.topShade).toBe(50)
      expect(stre.appearance.topShadeHeight).toBe(25)
      expect(prev.appearance.topShadeHeight).toBe(25)
      expect(stre.genre).toEqual(prev.genre)
      expect(stre.vote).toEqual(prev.vote)
    } finally {
      await deleteMapping(request, id)
    }
  })

  test("pixel: byte-identici entro soglia", async ({ request }) => {
    const id = IDS[1]!
    await saveMapping(request, id)
    try {
      const a = await renderPng(request, previewUrl(id))
      const b = await renderPng(request, stremioUrl(id))
      const diff = await meanAbsDiff(a, b)
      expect(diff).toBeLessThan(PARITY_MAX_MEAN_DIFF)
    } finally {
      await deleteMapping(request, id)
    }
  })

  // Landscape: il ramo mapping ricava la base da `mapping.backdropPath` +
  // `mapping.posterShape`, la preview da `backdrop=` + `shape=landscape`.
  // `lauto=1` è ciò che l'editor emette su una base textless senza logo/testo
  // (wordmark automatico): senza, la preview non compone il titolo che Stremio
  // invece cuoce. Prima di questo caso la parità era coperta solo sul canvas
  // verticale.
  test("landscape: base backdrop + wordmark automatico, stessi pixel", async ({ request }) => {
    const id = IDS[2]!
    const extras = {
      shape: "landscape",
      backdrop: "/mocked/backdrop.jpg",
      lauto: "1",
    }
    await saveMapping(request, id, {
      posterShape: "landscape",
      backdropPath: "/mocked/backdrop.jpg",
    })
    try {
      const prev = await (await request.get(`${previewUrl(id, extras)}&debug=1`)).json()
      const stre = await (await request.get(`${stremioUrl(id)}&debug=1`)).json()
      expect(prev.meta.shape).toBe("landscape")
      expect(stre.meta.shape).toBe("landscape")
      expect(stre.images).toEqual(prev.images)
      expect(stre.images.backdrop).toBe("/mocked/backdrop.jpg")
      expect(stre.appearance).toEqual(prev.appearance)
      expect(stre.badge.settings).toEqual(prev.badge.settings)

      const a = await renderPng(request, previewUrl(id, extras))
      const b = await renderPng(request, stremioUrl(id))
      const diff = await meanAbsDiff(a, b)
      expect(diff).toBeLessThan(PARITY_STRICT_MAX_MEAN_DIFF)
    } finally {
      await deleteMapping(request, id)
    }
  })

  // Stile qualità ADDITIVO (qbs=gradient): prima non aveva alcuna copertura
  // preview-vs-Stremio. Il mapping salva lo stile, la preview lo esprime in
  // query: entrambi devono dipingere la stessa lastra e gli stessi glifi.
  test("quality badge non-standard (qbs=gradient) parity", async ({ request }) => {
    const id = IDS[3]!
    const extras = { qbs: "gradient", quality: "4K" }
    await saveMapping(request, id, { qualityBadgeStyle: "gradient" })
    try {
      // Tier forzato su ENTRAMBE le URL: il mock non espone AV specs per il
      // titolo e senza tier la lastra non verrebbe dipinta. Il parametro non
      // scavalca alcun ramo: preview e Stremio passano dallo stesso
      // `canonicalQuality` e dallo stesso renderer del gruppo qualità.
      const prev = await (await request.get(`${previewUrl(id, extras)}&debug=1`)).json()
      const stre = await (await request.get(`${stremioUrl(id, extras)}&debug=1`)).json()
      expect(prev.quality.value).toBe("4K")
      expect(stre.quality.value).toBe(prev.quality.value)
      expect(stre.badge.settings).toEqual(prev.badge.settings)

      const a = await renderPng(request, previewUrl(id, extras))
      const b = await renderPng(request, stremioUrl(id, extras))
      expect(await meanAbsDiff(a, b)).toBeLessThan(PARITY_STRICT_MAX_MEAN_DIFF)

      // Lo stile è realmente dipinto: gli stessi parametri con `qbs=standard`
      // producono byte diversi (mai un badge assente che rende tutto uguale).
      const standard = await renderPng(request, previewUrl(id, { ...extras, qbs: "standard" }))
      expect(Buffer.compare(a, standard)).not.toBe(0)
    } finally {
      await deleteMapping(request, id)
    }
  })

  // Rating separati in riga bottom: layout opt-in senza alcuna copertura di
  // parità. `bottom-pills` è il formato bottom che esiste su entrambi i canvas
  // (in landscape `bottom-bar` si normalizza a pills). Per gli stili bottom
  // `useSeparate` resta false per contratto: l'attivazione è `bottomActive`.
  test("separate ratings bottom-pills parity", async ({ request }) => {
    const id = IDS[4]!
    const extras = {
      sep: "1",
      sepstyle: "bottom-pills",
      rsrc: "imdb,tmdb,tomatoes",
      imdbId: "tt0133093",
      bq: "0",
    }
    await saveMapping(request, id, {
      separateRatings: true,
      separateRatingsStyle: "bottom-pills",
      ratingSources: ["imdb", "tmdb", "tomatoes"],
      imdbId: "tt0133093",
      badgeQuality: false,
    })
    try {
      const prev = await (await request.get(`${previewUrl(id, extras)}&debug=1`)).json()
      const stre = await (await request.get(`${stremioUrl(id)}&debug=1`)).json()
      expect(prev.badge.settings.separateRatingsStyle).toBe("bottom-pills")
      expect(stre.badge.settings.separateRatingsStyle).toBe("bottom-pills")
      expect(prev.badge.settings.bottomActive).toBe(true)
      expect(stre.badge.settings.bottomActive).toBe(true)
      expect(stre.badge.settings).toEqual(prev.badge.settings)

      const a = await renderPng(request, previewUrl(id, extras))
      const b = await renderPng(request, stremioUrl(id))
      expect(await meanAbsDiff(a, b)).toBeLessThan(PARITY_STRICT_MAX_MEAN_DIFF)
    } finally {
      await deleteMapping(request, id)
    }
  })
})
