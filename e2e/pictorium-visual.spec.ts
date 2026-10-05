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
  // Use a same-origin document without a React root: hydration of the home
  // page can otherwise replace the isolated poster after setContent.
  await page.goto("/api/health")
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

  test("explicit fmt=jpeg — jpeg response in any default mode", async ({ request }) => {
    // Sotto default webp è la variante convertita dal canonico webp, sotto
    // PICTORIUM_IMAGE_FORMAT=jpeg è il canonico: il contratto è identico.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", fmt: "jpeg" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    expect(res.headers()["content-type"]).toBe("image/jpeg")
    expect((await res.body()).length).toBeGreaterThan(1000)
  })

  test("explicit fmt=webp — webp response in any default mode", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", fmt: "webp" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    expect(res.headers()["content-type"]).toBe("image/webp")
    expect((await res.body()).length).toBeGreaterThan(1000)
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

  test("badge style: minimal — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "minimal", badges: "1", ranking: "0" })
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

  test("ranking badge (removed bar style degrades to default) — valid image", async ({ request }) => {
    // Stile "bar" rimosso: ?rs=bar degrada a default senza 400.
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

  test("top shade (ts) — default 50, off needs explicit ts=0", async ({ request }) => {
    // Default 50: senza parametro e con ts=50 i byte sono identici;
    // con ts=0 (spenta) il render differisce.
    const base = { genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0" }
    const defRes = await request.get(posterUrl(base))
    expect(defRes.ok()).toBeTruthy()
    const defBuffer = await defRes.body()
    expect(defBuffer.length).toBeGreaterThan(1000)
    const fiftyRes = await request.get(posterUrl({ ...base, ts: "50" }))
    expect(fiftyRes.ok()).toBeTruthy()
    expect(Buffer.compare(defBuffer, await fiftyRes.body())).toBe(0)
    const offRes = await request.get(posterUrl({ ...base, ts: "0" }))
    expect(offRes.ok()).toBeTruthy()
    const offBuffer = await offRes.body()
    expect(offBuffer.length).toBeGreaterThan(1000)
    expect(Buffer.compare(defBuffer, offBuffer)).not.toBe(0)
  })

  test("all badges off (clean poster) — valid image", async ({ request }) => {
    const url = posterUrl({ badges: "0", ranking: "0" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("badge font (bfont) — invalid falls back to inter byte-identical", async ({ request }) => {
    // Parametro assente o non valido → Inter: gli URL esistenti non cambiano.
    const base = { genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0" }
    const defRes = await request.get(posterUrl(base))
    expect(defRes.ok()).toBeTruthy()
    const defBuffer = await defRes.body()
    expect(defBuffer.length).toBeGreaterThan(1000)
    const badRes = await request.get(posterUrl({ ...base, bfont: "bebas" }))
    expect(badRes.ok()).toBeTruthy()
    expect(Buffer.compare(defBuffer, await badRes.body())).toBe(0)
  })

  test("badge font barlow-condensed / oswald — valid images, different bytes", async ({ request }) => {
    // Font diversi non condividono bitmap: i byte devono differire da Inter.
    const base = { genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0" }
    const defBuffer = await (await request.get(posterUrl(base))).body()
    for (const bfont of ["barlow-condensed", "oswald"]) {
      const res = await request.get(posterUrl({ ...base, bfont }))
      expect(res.ok()).toBeTruthy()
      const buffer = await res.body()
      expect(buffer.length).toBeGreaterThan(1000)
      expect(Buffer.compare(defBuffer, buffer)).not.toBe(0)
    }
  })

  test("full config — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "8.0", badges: "1", ranking: "1", rank: "5", label: "Top 5", bs: "pill", rs: "pill", gradHeight: "25", blur: "5", bf: "50", bd: "30" })
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

  test("separate ratings (sep=1) — column replaces average — valid image", async ({ request }) => {
    // Colonna separati: imdbId in query → aggregated dal mock MDBList, media ★
    // sostituita dalla colonna a destra (mai sommate). I byte devono differire
    // dalla media: altrimenti lo stack non è stato renderizzato (fallback).
    const sepUrl = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes" })
    const avgUrl = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", rsrc: "imdb,tmdb,tomatoes" })
    const sepRes = await request.get(sepUrl)
    expect(sepRes.ok()).toBeTruthy()
    const sepBuffer = await sepRes.body()
    expect(sepBuffer.length).toBeGreaterThan(1000)
    const avgRes = await request.get(avgUrl)
    expect(avgRes.ok()).toBeTruthy()
    const avgBuffer = await avgRes.body()
    expect(Buffer.compare(sepBuffer, avgBuffer)).not.toBe(0)
  })

  test("separate ratings off by default — average kept — valid image", async ({ request }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", rsrc: "imdb,tmdb,tomatoes" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("anime ratings (anilist+kitsu) — aggregated + separate column — valid image", async ({ request }) => {
    // imdbId anime in query → snapshot locale mappa tt0388629 (unico:
    // anilist 21/kitsu 12, zero /mappings), voti AniList/Kitsu dal mock,
    // colonna separati renderizzata (byte diversi dalla media ★ sola).
    const sepUrl = posterUrl({ genreName: "Animation", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0388629", sep: "1", rsrc: "anilist,kitsu" })
    const avgUrl = posterUrl({ genreName: "Animation", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0388629", rsrc: "anilist,kitsu" })
    const sepRes = await request.get(sepUrl)
    expect(sepRes.ok()).toBeTruthy()
    const sepBuffer = await sepRes.body()
    expect(sepBuffer.length).toBeGreaterThan(1000)
    const avgRes = await request.get(avgUrl)
    expect(avgRes.ok()).toBeTruthy()
    const avgBuffer = await avgRes.body()
    expect(Buffer.compare(sepBuffer, avgBuffer)).not.toBe(0)
  })

  test("anime ratings on non-anime — graceful miss — valid image", async ({ request }) => {
    // tt0133093 non è mappato dal mock AniZip (404) → fallback media, mai 500.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", sep: "1", rsrc: "anilist,kitsu" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const buffer = await res.body()
    expect(buffer.length).toBeGreaterThan(1000)
  })

  test("cinemeta imdb fallback (no mdblist imdb) — separate column — valid image", async ({ request }) => {
    // tt0000001: il mock MDBList non ha imdb → Cinemeta riempie 8.4, la colonna
    // separati rende (byte diversi dalla media ★ sola). Senza fallback la
    // colonna sarebbe vuota e i byte identici.
    const sepUrl = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0000001", sep: "1", rsrc: "imdb" })
    const avgUrl = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0000001", rsrc: "imdb" })
    const sepRes = await request.get(sepUrl)
    expect(sepRes.ok()).toBeTruthy()
    const sepBuffer = await sepRes.body()
    expect(sepBuffer.length).toBeGreaterThan(1000)
    const avgRes = await request.get(avgUrl)
    expect(avgRes.ok()).toBeTruthy()
    const avgBuffer = await avgRes.body()
    expect(Buffer.compare(sepBuffer, avgBuffer)).not.toBe(0)
  })

  test("landscape shape — 16:9 image rendered from backdrop", async ({ page }) => {
    // ?shape=landscape usa lo sfondo TMDB come base invece del poster
    // verticale: l'immagine risultante è 768×432.
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 768, h: 432 })
  })

  test("landscape shape without backdrop — pillarbox fallback, valid image", async ({ page }) => {
    // Senza sfondo TMDB la base diventa pillarbox dal poster: mai 404,
    // nessun riquadro rotto su Stremio. Dimensioni sempre 768×432.
    const url = posterUrl({ shape: "landscape", badges: "0", ranking: "0" })
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 768, h: 432 })
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

  test("minimal badge — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", bs: "minimal", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-minimal.png", { maxDiffPixelRatio: 0.10 })
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

  test("anime ranking (netflix ribbon) — screenshot", async ({ page }) => {
    // media_type=tv + id 19995 (Avatar) nella MDBList anime mockata → animeRankResult=1.
    // Il mock MDBList anime (mock-server.mjs) mette Avatar in posizione #1.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rs: "netflix" }, "tv", 19995)
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-anime.png", { maxDiffPixelRatio: 0.10 })
  })

  test("movie ranking (netflix ribbon) with period subtitle — screenshot", async ({ page }) => {
    // id 603 (Matrix, non anime) + rank=3 esplicito → trendRank: il nastro
    // mostra TOP, numero e periodo ("Oggi"), non la label per media type.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", rs: "netflix" }, "movie", 603)
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
    const url = posterUrl({ genreName: "Action", voteAverage: "8.0", badges: "1", ranking: "1", rank: "5", label: "Top 5", bs: "pill", rs: "pill", gradHeight: "25", blur: "5", bf: "50", bd: "30" })
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

  test("landscape shape — screenshot", async ({ page }) => {
    // Formato orizzontale 16:9 da sfondo TMDB (stile Nuvio): base backdrop +
    // logo/badge adattati al canvas landscape.
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-landscape.png", { maxDiffPixelRatio: 0.10 })
  })

  test("landscape shape with rank badge — screenshot", async ({ page }) => {
    // Il badge superiore centrale in landscape è reso al 120% (topBadgePw).
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "pill" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-landscape-rank.png", { maxDiffPixelRatio: 0.10 })
  })

  test("landscape bakes the logo, genre badge bottom-right - screenshot", async ({ page }) => {
    // Layout landscape con logo baked-in (coi vincoli 16:9) e badge genere
    // a destra: il logo passato via query finisce nel composite.
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", logo: "/mocked/logo.png", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-landscape-logo.png", { maxDiffPixelRatio: 0.10 })
  })

  test("separate ratings column (3 providers) — screenshot", async ({ page }) => {
    // Colonna a destra con logo sopra / punteggio sotto (IMDb 8.7, TMDB 7.9,
    // 88%), badge genere senza segmento ★. Soglia 0.02 (non 0.10): il mock è
    // deterministico e un flip di scala/polarità muove il 7-12% dei pixel —
    // con 0.10 passerebbe inosservato (mai allentare).
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes", quality: "4K" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings without quality badge (stack rises) — screenshot", async ({ page }) => {
    // Senza badge qualità lo stack parte dall'alto invece che sotto il 4K.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bq: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings-noquality.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings column in landscape (average replaced) — screenshot", async ({ page }) => {
    // La colonna segue il badge qualità anche in 16:9 (il badge genere
    // nasconde il segmento ★ come in portrait).
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings-landscape.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings scale 150 portrait, quality on — screenshot", async ({ page }) => {
    // Scala dedicata: stessi 3 provider del baseline a100, colonna ingrandita
    // nativa (font + loghi), ancore invariate.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes", quality: "4K", sepscale: "150" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings-scale150.png", { maxDiffPixelRatio: 0.10 })
  })

  test("separate ratings scale 200 max, no quality, ribbon right — screenshot", async ({ page }) => {
    // Caso limite: scala max con 3 pill, senza badge qualità (stack in alto
    // a sinistra del nastro a destra) — verifica visiva di non-sovrapposizione.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "netflix", side: "right", bq: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes", sepscale: "200" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings-scale200.png", { maxDiffPixelRatio: 0.10 })
  })

  test("separate ratings scale 150 landscape — screenshot", async ({ page }) => {
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes", sepscale: "150" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings-scale150-landscape.png", { maxDiffPixelRatio: 0.10 })
  })

  test("separate ratings scale 200 landscape, quality on — screenshot", async ({ page }) => {
    // Caso limite 16:9: stack max sotto il badge qualità, badge genere in
    // basso a destra — verifica visiva di non-sovrapposizione.
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes", quality: "4K", sepscale: "200" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings-scale200-landscape.png", { maxDiffPixelRatio: 0.10 })
  })

  test("separate ratings scale 200 landscape, no quality — screenshot", async ({ page }) => {
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bq: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes", sepscale: "200" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-ratings-scale200-landscape-noquality.png", { maxDiffPixelRatio: 0.10 })
  })

  test("separate ratings bottom-bar portrait (3 providers, genre/year on) — screenshot", async ({ page }) => {
    // Fascia adattiva full-width in basso con 3 celle equidistanti (IMDb 8.7,
    // TMDB 7.9, 88%), genere+anno soppressi pur con bg/by=1 — materiale
    // chiaro/scuro secondo bottomLight (sul mock scuro: fascia chiara).
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", year: "2024", badges: "1", ranking: "0", bg: "1", by: "1", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-bar", rsrc: "imdb,tmdb,tomatoes", quality: "4K" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-bottom-bar.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings bottom-pills portrait (3 providers, no quality) — screenshot", async ({ page }) => {
    // Riga centrata di 3 pill adattive (logo + valore inline), margine dal bordo.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", year: "2024", badges: "1", ranking: "0", bg: "1", by: "1", bq: "0", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-pills", rsrc: "imdb,tmdb,tomatoes" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-bottom-pills.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings bottom-bar landscape normalizes to pills (byte-identical)", async ({ request }) => {
    // Barra disattivata in 16:9: lo stesso URL con sepstyle=bottom-bar rende
    // byte-identico a bottom-pills (normalizzazione DOPO cascata, stessa
    // chiave bottom normalizzata) — niente screenshot duplicato della barra.
    const base = { backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bg: "1", by: "1", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes" }
    const barRes = await request.get(posterUrl({ ...base, sepstyle: "bottom-bar" }))
    const pillsRes = await request.get(posterUrl({ ...base, sepstyle: "bottom-pills" }))
    expect(barRes.ok()).toBeTruthy()
    expect(pillsRes.ok()).toBeTruthy()
    expect(Buffer.from(await barRes.body()).equals(Buffer.from(await pillsRes.body()))).toBe(true)
  })

  test("separate ratings bottom-pills landscape (right-anchored) — screenshot", async ({ page }) => {
    // In 16:9 le pills sono ancorate a DESTRA con la geometria base del badge
    // genere (non centrate sul canvas).
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bg: "1", by: "1", bq: "0", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-pills", rsrc: "imdb,tmdb,tomatoes" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-bottom-pills-landscape.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings bottom-bar scale 200 portrait (fit, no clipping) — screenshot", async ({ page }) => {
    // Scala max: il font si riduce finché le 3 celle entrano — fascia sempre
    // full-width a filo, mai tagliata.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bg: "1", by: "1", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-bar", rsrc: "imdb,tmdb,tomatoes", quality: "4K", sepscale: "200" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-bottom-bar-scale200.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings column offsets (-X, +Y move the group) — screenshot", async ({ page }) => {
    // Offset espliciti sul gruppo colonna (default 0 = baseline invariata):
    // la colonna si sposta in blocco a sinistra e in basso, ancore invariate.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bq: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb", sepox: "-60", sepoy: "60" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-offsets-column.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings bottom-pills offsets portrait (+X, -Y move the group) — screenshot", async ({ page }) => {
    // Riga pills spostata in blocco a destra e in alto (stessi 3 provider del
    // baseline pills, dentro il canvas per il clamp).
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", year: "2024", badges: "1", ranking: "0", bg: "1", by: "1", bq: "0", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-pills", rsrc: "imdb,tmdb,tomatoes", sepox: "60", sepoy: "-60" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-offsets-pills.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings bottom-pills offsets landscape (-X, -Y move the group) — screenshot", async ({ page }) => {
    // In 16:9 la riga resta ancorata a destra: gli offset la muovono in blocco
    // senza mai uscire dal canvas (clamp).
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bg: "1", by: "1", bq: "0", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-pills", rsrc: "imdb,tmdb,tomatoes", sepox: "-60", sepoy: "-40" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-separate-offsets-pills-landscape.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings bottom-bar portrait — X ignored (byte-identical), Y moves the band up — screenshot", async ({ page, request }) => {
    // X sulla barra full-width è ignorata esplicitamente (stessi byte senza
    // offset); Y solleva la fascia dal filo bordo.
    const base = { genreName: "Action", voteAverage: "7.8", year: "2024", badges: "1", ranking: "0", bg: "1", by: "1", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-bar", rsrc: "imdb,tmdb,tomatoes", quality: "4K" }
    const refRes = await request.get(posterUrl(base))
    const xRes = await request.get(posterUrl({ ...base, sepox: "60" }))
    expect(refRes.ok()).toBeTruthy()
    expect(xRes.ok()).toBeTruthy()
    expect(Buffer.from(await xRes.body()).equals(Buffer.from(await refRes.body()))).toBe(true)
    const poster = await renderPoster(page, posterUrl({ ...base, sepoy: "-40" }))
    await expect(poster).toHaveScreenshot("poster-separate-offsets-bar.png", { maxDiffPixelRatio: 0.02 })
  })

  test("separate ratings bottom-bar portrait — band flush at bottom edge (adaptive both polarities)", async ({ request }) => {
    // Prova pixel-reale, polarità forzata via `bl` (nessuna assunzione sul
    // fondo mock). La fascia è a filo in basso per costruzione: le ultime
    // righe sono materiale puro della barra (il testo è centrato
    // verticalmente, non sul bordo) — scure con bl=1, chiare con bl=0.
    // Il contenuto si misura quindi nel corpo barra (rilevato in modo
    // adattivo come regione dove i due render differiscono), mai allentando
    // le soglie per far passare.
    const { default: sharp } = await import("sharp")
    async function render(bl: "0" | "1") {
      const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bg: "1", by: "1", imdbId: "tt0133093", sep: "1", sepstyle: "bottom-bar", rsrc: "imdb,tmdb,tomatoes", bl })
      const res = await request.get(url)
      expect(res.ok()).toBeTruthy()
      const body = await res.body()
      const { data, info } = await sharp(body).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect(info.width).toBe(500)
      expect(info.height).toBe(750)
      return { body, data, info }
    }
    function brightFrac(data: Buffer, width: number, y0: number, y1: number) {
      let bright = 0
      const total = (width - 20) * (y1 - y0)
      for (let y = y0; y < y1; y++) {
        for (let x = 10; x < width - 10; x++) {
          const i = (y * width + x) * 4
          if ((data[i] + data[i + 1] + data[i + 2]) / 3 >= 100) bright++
        }
      }
      return bright / total
    }
    const dark = await render("1")
    const light = await render("0")
    // La polarità guida davvero la fascia (render distinti, niente collasso).
    expect(light.body.equals(dark.body)).toBe(false)
    // Flush: ultime 12 righe = materiale barra (scuro vs chiaro per polarità).
    const darkEdge = brightFrac(dark.data, dark.info.width, dark.info.height - 12, dark.info.height)
    const lightEdge = brightFrac(light.data, light.info.width, light.info.height - 12, light.info.height)
    console.log(`bottom-bar edge bright fraction bl=1: ${darkEdge}, bl=0: ${lightEdge}`)
    expect(darkEdge).toBeLessThan(0.4)
    expect(lightEdge).toBeGreaterThan(0.6)
    // Corpo barra: prima riga (dall'alto) dove i due render differiscono —
    // sopra è poster identico, dentro è la barra. Deve arrivare a filo bordo.
    const H = dark.info.height
    const W = dark.info.width
    let barTop = -1
    let lastDiff = -1
    for (let y = 0; y < H; y++) {
      let diff = 0
      for (let x = 10; x < W - 10; x += 2) {
        const i = (y * W + x) * 4
        if (Math.abs(dark.data[i] - light.data[i]) > 12 || Math.abs(dark.data[i + 1] - light.data[i + 1]) > 12 || Math.abs(dark.data[i + 2] - light.data[i + 2]) > 12) diff++
      }
      if (diff / ((W - 20) / 2) > 0.02) {
        if (barTop < 0) barTop = y
        lastDiff = y
      }
    }
    expect(barTop).toBeGreaterThan(H / 2)
    expect(lastDiff).toBe(H - 1)
    // Contenuto nel corpo: testo/loghi chiari su fondo scuro (bl=1) e testo
    // scuro su fondo chiaro (bl=0) — presente ma non dominante.
    const darkBody = brightFrac(dark.data, W, barTop, H)
    let darkPixels = 0
    const bodyTotal = (W - 20) * (H - barTop)
    for (let y = barTop; y < H; y++) {
      for (let x = 10; x < W - 10; x++) {
        const i = (y * W + x) * 4
        if ((light.data[i] + light.data[i + 1] + light.data[i + 2]) / 3 < 100) darkPixels++
      }
    }
    console.log(`bottom-bar body bright frac bl=1: ${darkBody}, dark frac bl=0: ${darkPixels / bodyTotal}`)
    expect(darkBody).toBeGreaterThan(0.03)
    expect(darkBody).toBeLessThan(0.5)
    expect(darkPixels / bodyTotal).toBeGreaterThan(0.02)
    expect(darkPixels / bodyTotal).toBeLessThan(0.5)
  })

  test("separate ratings scale 200 — last pill fully visible (no clipping)", async ({ request }) => {
    // Prova pixel-reale (non solo HTTP 200): a scala max con 3 provider e
    // senza badge qualità, la striscia destra in alto contiene SOLO le 3 pill
    // dello stack — devono essere 3 bande luminose complete, con l'ultima
    // chiusa da bordo arrotondato + gap scuro (mai tagliata dal canvas).
    const { default: sharp } = await import("sharp")
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0", bq: "0", imdbId: "tt0133093", sep: "1", rsrc: "imdb,tmdb,tomatoes", sepscale: "200" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const { data, info } = await sharp(await res.body()).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(500)
    expect(info.height).toBe(750)
    // Striscia destra alta: solo stack (niente qualità/bordi genere qui).
    const x0 = Math.round(info.width * 0.70)
    const x1 = Math.round(info.width * 0.98)
    const yMax = Math.round(info.height * 0.60)
    const rows: number[] = []
    for (let y = 0; y < yMax; y++) {
      let bright = 0
      for (let x = x0; x < x1; x++) {
        const i = (y * info.width + x) * 4
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 >= 150) bright++
      }
      rows.push(bright / (x1 - x0))
    }
    // Bande: righe luminose (>10%) con tolleranza gap interni di 3 righe.
    const bands: { top: number; bottom: number }[] = []
    let start = -1
    let darkRun = 0
    for (let y = 0; y < rows.length; y++) {
      if (rows[y] > 0.10) {
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
    console.log(`sep200 bands: ${JSON.stringify(bands)}`)
    expect(bands.length).toBe(3)
    for (const b of bands) expect(b.bottom - b.top).toBeGreaterThanOrEqual(20)
    const last = bands[bands.length - 1]
    // Ultima pill interamente dentro la regione + bordo inferiore scuro dopo:
    // se fosse tagliata, le righe luminose arriverebbero a yMax.
    expect(last.bottom).toBeLessThan(yMax - 10)
    for (let y = last.bottom + 1; y <= Math.min(last.bottom + 8, yMax - 1); y++) {
      expect(rows[y]).toBeLessThan(0.10)
    }
  })

  test("badge font barlow-condensed pill — screenshot", async ({ page }) => {
    const url = posterUrl({ genreName: "Fantascienza", voteAverage: "8.7", bs: "pill", bfont: "barlow-condensed", badges: "1", ranking: "0" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-font-barlow-pill.png", { maxDiffPixelRatio: 0.10 })
  })

  test("badge font oswald ranking TOP 10 with decimals — screenshot", async ({ page }) => {
    // TOP 10 a due cifre + voto decimale nel badge genere.
    const url = posterUrl({ genreName: "Action", voteAverage: "8.7", badges: "1", ranking: "1", rank: "10", label: "Top 10", rs: "pill", bfont: "oswald" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-font-oswald-rank.png", { maxDiffPixelRatio: 0.10 })
  })

  test("badge font oswald long accented extra label — screenshot", async ({ page }) => {
    // Dicitura lunga con accenti latini (copertura latin-ext del font).
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", extra: "Premio speciale Città Proibita èéü", bfont: "oswald" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-font-oswald-extra.png", { maxDiffPixelRatio: 0.10 })
  })

  test("badge font oswald hebrew fallback (Rubik) — screenshot", async ({ page }) => {
    // Oswald non ha glifi ebraici: il testo cade su Rubik allo stesso peso.
    const url = posterUrl({ genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1", extra: "עונה חדשה", bfont: "oswald" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-font-oswald-hebrew.png", { maxDiffPixelRatio: 0.10 })
  })

  test("badge font barlow-condensed landscape — screenshot", async ({ page }) => {
    const url = posterUrl({ backdrop: "/mocked/backdrop.jpg", shape: "landscape", genreName: "Action", voteAverage: "8.7", badges: "1", ranking: "0", bfont: "barlow-condensed" })
    const poster = await renderPoster(page, url)
    await expect(poster).toHaveScreenshot("poster-font-barlow-landscape.png", { maxDiffPixelRatio: 0.10 })
  })
})
