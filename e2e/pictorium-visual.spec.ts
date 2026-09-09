import { test, expect, type Page } from "@playwright/test"

// I test poster girano SENZA TMDB_API_KEY: le chiamate esterne (TMDB, immagini,
// JustWatch, Wikidata, IMDb) vengono servite dal mock server locale
// `e2e/mock-server.mjs`, avviato da playwright.config.ts. Per aggiungere nuovi
// mock, aggiungi un handler in quel file (vedi header del mock server).

const MOVIE_TMDB = 19995 // Avatar (id usato dai dati fittizi del mock server)
const MEDIA_TYPE = "movie"
// Poster path servito dal mock server sotto /t/p/...
const POSTER_PATH = "/mocked/avatar.jpg"

function posterUrl(params: Record<string, string>, mediaType = MEDIA_TYPE, id: number | string = MOVIE_TMDB): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/${mediaType}/${id}?${qs.toString()}`
}

// Helper: render a poster URL in the page and return a locator for the <img>
async function renderPoster(page: Page, posterUrl: string) {
  await page.setViewportSize({ width: 1280, height: 1600 })
  // Navigate first so the relative src resolves against the app origin:
  // `setContent` alone leaves baseURI on about:blank and the /api/poster URL
  // would never load.
  await page.goto("/")
  await page.setContent(`
    <html>
      <body style="margin:0;background:#000;display:flex;align-items:flex-start;justify-content:center;">
        <img id="poster" src="${posterUrl}" style="display:block;max-width:100%;height:auto;" />
      </body>
    </html>
  `)
  // Wait for the image to fully load
  await page.waitForFunction(() => {
    const img = document.getElementById("poster") as HTMLImageElement
    return img && img.complete && img.naturalWidth > 0
  }, { timeout: 30_000 })
  return page.locator("#poster")
}

//
// ─── HOME PAGE (no API key needed) ────────────────────────────
//

test("home — full page", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      localStorage.setItem("pictorium_profile_id", "e2e")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "")
    } catch {}
  })
  await page.goto("/")
  const logo = page.getByAltText(/Pictorium/)
  const logoFallback = page.getByText(/Pictorium/)
  await expect(logo.or(logoFallback).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => document.body.scrollHeight > window.innerHeight, { timeout: 30_000 })
  await expect(page).toHaveScreenshot("home-fullpage.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.03,
  })
})

test("home — hero viewport", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      localStorage.setItem("pictorium_profile_id", "e2e")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "")
    } catch {}
  })
  await page.goto("/")
  const logo = page.getByAltText(/Pictorium/)
  const logoFallback = page.getByText(/Pictorium/)
  await expect(logo.or(logoFallback).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page).toHaveScreenshot("home-viewport.png", {
    maxDiffPixelRatio: 0.03,
  })
})

test("home — mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      localStorage.setItem("pictorium_profile_id", "e2e")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "")
    } catch {}
  })
  await page.goto("/")
  const logo = page.getByAltText(/Pictorium/)
  const logoFallback = page.getByText(/Pictorium/)
  await expect(logo.or(logoFallback).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(page).toHaveScreenshot("home-mobile.png", {
    maxDiffPixelRatio: 0.03,
  })
})

test("home with key — hero podium and status strip", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      // Podio: la scelta dei 2 film + 1 serie è random a ogni refresh (Fisher–
      // Yates su Math.random) → stub costante per screenshot deterministici.
      Math.random = () => 0
      localStorage.setItem("pictorium_profile_id", "e2e")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "e2e-key")
    } catch {}
  })
  // Congela marquee/bob/pulse: screenshot deterministici
  await page.emulateMedia({ reducedMotion: "reduce" })
  // M21: i poster del podio vengono scaricati via fetch con la chiave in
  // header x-api-key (object URL) — la URL non compare più nell'attributo src.
  // Registriamo le richieste effettive a /api/poster per verificare i titoli.
  const posterRequests: string[] = []
  page.on("request", (req) => {
    if (req.url().includes("/api/poster/")) posterRequests.push(req.url())
  })
  await page.goto("/")
  await page.evaluate(() => window.scrollTo(0, 0))
  // I titoli giusti devono essere STATI RICHIESTI (niente api_key negli URL:
  // la chiave viaggia nell'header x-api-key). Il podio di fallback statico
  // verrebbe sostituito appena il trending arriva; i tre fetch confermano che
  // il podio reale è in corso.
  await expect.poll(() => posterRequests.map((u) => new URL(u).pathname)).toContain("/api/poster/movie/19995")
  await expect.poll(() => posterRequests.map((u) => new URL(u).pathname)).toContain("/api/poster/movie/157336")
  await expect.poll(() => posterRequests.map((u) => new URL(u).pathname)).toContain("/api/poster/tv/19995")
  posterRequests.forEach((u) => expect(u).not.toContain("api_key"))
  // Attende il decode completo delle img del podio reale (src = object URL).
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll(".p-frame img")) as HTMLImageElement[]
    return imgs.length >= 3 && imgs.every((i) => i.complete && i.naturalWidth > 0)
  }, { timeout: 30_000, polling: 500 })
  await expect(page).toHaveScreenshot("home-key-hero.png", {
    maxDiffPixelRatio: 0.03,
  })
  // Strip di stato sotto il carosello
  await page.locator('[data-testid="home-status"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await expect(page).toHaveScreenshot("home-key-status.png", {
    maxDiffPixelRatio: 0.03,
  })
})

//
// ─── STATUS PAGE (no API key needed) ──────────────────────────
//

test("status — page renders", async ({ page }) => {
  // Determinismo: la status page renderizza valori live (time in ms, timestamp,
  // stato cache) che variano a ogni run e con lo stato del server E2E riusato
  // (reuseExistingServer locale) — l'altezza full-page cambiava tra i run.
  // Intercettiamo /api/health e /api/cache/status con payload fissi: lo
  // screenshot non dipende più da timing, cache o piattaforma (node/win32).
  await page.route("**/api/health", (route) => route.fulfill({
    json: {
      status: "healthy",
      timestamp: "2026-08-02T12:00:00.000Z",
      tmdb: {
        apiKey: true,
        trending: { ok: true, status: 200, time: 42 },
        search: { ok: true, status: 200, time: 42 },
        popular: { ok: true, status: 200, time: 41 },
        externalIds: { ok: true, status: 200, time: 41 },
      },
      streaming: {
        justwatch: { ok: true, status: 200, time: 142 },
        flixpatrol: { ok: true, status: 200, time: 36 },
      },
      system: { node: "v26.4.0", platform: "win32", env: "development" },
      storage: {
        mode: "file",
        dataDirExists: true, dataDirWritable: true,
        mappingsFileExists: true, dataFileExists: true,
        mappingsReadable: true, mappingsWritable: true,
        defaultsFileExists: true, defaultsReadable: true, defaultsWritable: true,
        mappingCount: 41, mappingsCount: 41,
        lastMappingUpdatedAt: "2026-08-02T12:00:00.000Z",
      },
    },
  }))
  await page.route("**/api/cache/status", (route) => route.fulfill({
    json: { totalEntries: 0, taggedEntries: [], untaggedEntries: 0, totalBytes: 0, maxBytes: 157286400, maxEntries: 2000 },
  }))
  await page.goto("/status")
  // Give the health check time to load (it's async with multiple fetches)
  await page.waitForTimeout(3000)
  await expect(page).toHaveScreenshot("status-page.png", {
    fullPage: true,
    maxDiffPixelRatio: 0.05,
  })
})

//
// ─── POSTER API — functional ──────────────────────────────────
//
// Questi test verificano che l'API restituisca immagini valide per varie
// configurazioni di badge/gradiente/blur. Non richiedono chiave TMDB.

test.describe("poster API — functional", () => {

  test("default badge (shadow style) — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "shadow", badges: "1", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
    expect(res.headers()["content-type"]).toMatch(/image\/(?:png|webp|jpeg)/)
  })

  test("badge style: pill — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "pill", badges: "1", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("badge style: bar — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "bar", badges: "1", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("badge style: colored — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "colored", badges: "1", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("badge style: bordo — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "bordo", badges: "1", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("badge style: vetro — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "vetro", badges: "1", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("ranking style: pill — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "2", label: "Top 2", rs: "pill" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("ranking style: colored — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "2", label: "Top 2", rs: "colored" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("ranking badge (bar) + label — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "bar" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("extra badge (custom text) — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", extra: "Oscar 2024" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("gradient height — valid image", async ({ request }) => {
    // gradColor/gradOpacity/gradDir non sono più letti dal server (parametri
    // morti rimossi dai test): l'unico parametro gradiente attivo è gradHeight.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", gradHeight: "30" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("blur enabled — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", blur: "8", bf: "60", bd: "40" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("all badges off (clean poster) — valid image", async ({ request }) => {
    const url = posterUrl({ badges: "0", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("full config — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "8.0", badges: "1", ranking: "1", rank: "5", label: "Top 5", bs: "pill", rs: "bar", gradHeight: "25", blur: "5", bf: "50", bd: "30" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("stremio mode (right ribbon) — quality badge left — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", rs: "netflix", side: "right", quality: "4K" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })
})

//
// ─── POSTER API — visual regression ───────────────────────────
//
// Questi test rendono il poster in pagina e confrontano gli screenshot per
// intercettare regressioni visive nel rendering di badge, gradiente, blur e
// composizione. Deterministici grazie al mock server.

test.describe("poster API — visual regression", () => {

  test("default badge (shadow style) — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "shadow", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-default-shadow.png", { maxDiffPixelRatio: 0.10 })
  })

  test("pill badge — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "pill", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-pill.png", { maxDiffPixelRatio: 0.10 })
  })

  test("bar badge — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "bar", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-bar.png", { maxDiffPixelRatio: 0.10 })
  })

  test("colored badge — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "colored", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-colored.png", { maxDiffPixelRatio: 0.10 })
  })

  test("bordo badge — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "bordo", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-bordo.png", { maxDiffPixelRatio: 0.10 })
  })

  test("vetro badge — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "vetro", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-vetro.png", { maxDiffPixelRatio: 0.10 })
  })

  test("ranking pill — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "pill" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-ranking-pill.png", { maxDiffPixelRatio: 0.10 })
  })

  test("ranking colored — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "colored" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-ranking-colored.png", { maxDiffPixelRatio: 0.10 })
  })

  test("ranking default — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "default" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-ranking-default.png", { maxDiffPixelRatio: 0.10 })
  })

  test("ranking badge + label — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "bar" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-ranking.png", { maxDiffPixelRatio: 0.10 })
  })

  test("anime ranking (netflix ribbon) — screenshot", async ({ page }) => {
    // media_type=tv + id 19995 (Avatar) nella MDBList anime mockata → animeRankResult=1.
    // Il mock MDBList anime (mock-server.mjs) mette Avatar in posizione #1.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rs: "netflix" }, "tv", 19995)
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-anime.png", { maxDiffPixelRatio: 0.10 })
  })

  test("movie ranking (netflix ribbon) + label — screenshot", async ({ page }) => {
    // Nastro Netflix per film/serie: il label del rank per media type ("Film")
    // appare sotto il numero — stesso sistema del badge anime. Nessun label
    // esplicito: si testa il default server-side (badge.movie).
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", rs: "netflix" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-ranking-netflix.png", { maxDiffPixelRatio: 0.10 })
  })

  test("extra badge — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", extra: "Oscar 2024" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-extra.png", { maxDiffPixelRatio: 0.10 })
  })

  test("gradient height — screenshot", async ({ page }) => {
    // Renamed: gradDir è un parametro morto (il server legge solo gradHeight),
    // quindi il test verifica l'altezza del gradiente, non la direzione.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", gradHeight: "30" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-gradient-height.png", { maxDiffPixelRatio: 0.10 })
  })

  test("blur enabled — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", blur: "8", bf: "60", bd: "40" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-blur.png", { maxDiffPixelRatio: 0.10 })
  })

  test("clean poster (no badges) — screenshot", async ({ page }) => {
    const url = posterUrl({ badges: "0", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-clean.png", { maxDiffPixelRatio: 0.10 })
  })

  test("full feature poster — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "8.0", badges: "1", ranking: "1", rank: "5", label: "Top 5", bs: "pill", rs: "bar", gradHeight: "25", blur: "5", bf: "50", bd: "30" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-full-feature.png", { maxDiffPixelRatio: 0.10 })
  })

  test("stremio mode (right ribbon) — quality badge left — screenshot", async ({ page }) => {
    // Nastro Netflix a destra (side=right, Stremio): il badge qualità va a
    // sinistra invece che accanto al nastro.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", rs: "netflix", side: "right", quality: "4K" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-quality-stremio-left.png", { maxDiffPixelRatio: 0.10 })
  })
})
