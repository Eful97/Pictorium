import { test, expect, type APIRequestContext } from "@playwright/test"
import sharp from "sharp"

// Harness di parità preview-vs-Stremio (Golden Rule misurata): stesso titolo,
// URL editor (ramo queryPoster) contro URL Stremio mappato (ramo mapping).
// Mock deterministico; soglia pixel stretta; cleanup mapping in finally per
// non inquinare lo stato e2e condiviso.
const IDS = [603, 604]

const MAPPING = (id: number) => ({
  tmdbId: id,
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
})

function previewUrl(id: number): string {
  const qs = new URLSearchParams({
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
    lang: "it",
    region: "IT",
    preview: "1",
  })
  return `/api/poster/movie/${id}?${qs.toString()}`
}

function stremioUrl(id: number): string {
  const qs = new URLSearchParams({ lang: "it", region: "IT" })
  return `/api/poster/movie/${id}?${qs.toString()}`
}

async function saveMapping(request: APIRequestContext, id: number) {
  const res = await request.post("/api/mappings", { data: MAPPING(id) })
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
      expect(diff).toBeLessThan(0.01)
    } finally {
      await deleteMapping(request, id)
    }
  })
})
