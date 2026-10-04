import { expect, test, type Locator, type Page } from "@playwright/test"

// customPosterUrl in "Miei poster": la miniatura (MoodBoardTile) e
// l'ingrandimento (PosterLightbox) mostrano l'immagine personalizzata
// salvata nel mapping; a URL non caricabile ripiegano sul poster TMDB.
// Usa l'infra e2e esistente: il mock server su :8790 serve QUALSIASI
// /t/p/* come JPEG reale, quindi src + naturalWidth dimostrano il
// caricamento vero nel browser (non solo la selezione dell'URL).
// La CSP che permette le immagini del mock arriva da `POSTER_CDN_URL`
// in playwright.config.ts (meccanismo esistente di src/lib/csp.ts).

const MOCK_IMG = "http://127.0.0.1:8790/t/p"
const CUSTOM_OK = `${MOCK_IMG}/w342/e2e-custom-valido.jpg`
const CUSTOM_NEW = `${MOCK_IMG}/w342/e2e-custom-nuovo.jpg`
const CUSTOM_IGNORED = `${MOCK_IMG}/w342/e2e-custom-ignored.jpg`
const BROKEN = "http://127.0.0.1:9/e2e-rotto.jpg" // porta chiusa: errore deterministico
const FALLBACK_B = `${MOCK_IMG}/w342/e2e-fallback-b.jpg`
const FALLBACK_B_LB = `${MOCK_IMG}/w500/e2e-fallback-b.jpg` // lightbox: fallback TMDB a w500 (storico)
const BACKDROP = `${MOCK_IMG}/w780/e2e-backdrop.jpg`

const SEED = [
  { tmdbId: 9001, mediaType: "movie", title: "Custom Valido", posterPath: "/e2e-fallback-a.jpg", customPosterUrl: CUSTOM_OK },
  { tmdbId: 9002, mediaType: "movie", title: "Custom Rotto", posterPath: "/e2e-fallback-b.jpg", customPosterUrl: BROKEN },
  { tmdbId: 9003, mediaType: "movie", title: "Orizzontale Custom", posterPath: "/e2e-fallback-c.jpg", backdropPath: "/e2e-backdrop.jpg", posterShape: "landscape", customPosterUrl: CUSTOM_IGNORED },
]

async function seed(page: Page) {
  await page.evaluate(async (mappings) => {
    for (const m of mappings) {
      const r = await fetch("/api/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m),
      })
      if (!r.ok) throw new Error(`seed ${m.title}: ${r.status} ${await r.text()}`)
    }
  }, SEED)
}

async function gotoMyPosters(page: Page) {
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: /I miei poster/i }).click()
  await expect(page.getByRole("heading", { name: /I miei poster/i })).toBeVisible()
}

async function putCustom(page: Page, id: string, url: string) {
  await page.evaluate(async ({ mid, customPosterUrl }: { mid: string; customPosterUrl: string }) => {
    const r = await fetch(`/api/mappings/${mid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customPosterUrl }),
    })
    if (!r.ok) throw new Error(`PUT: ${r.status} ${await r.text()}`)
  }, { mid: id, customPosterUrl: url })
}

const widthOf = (loc: Locator) => loc.evaluate((img: HTMLImageElement) => img.naturalWidth)

test.describe("customPosterUrl in Miei poster", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
        localStorage.setItem("pictorium_profile_id", "e2e-custom-poster")
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
      } catch {}
    })
  })

  test.afterEach(async ({ page }) => {
    // Pulizia: i mapping seedati vivono nella data-dir CONDIVISA da tutti
    // gli spec e2e — senza, il badge "I miei poster N" inquinerebbe gli
    // snapshot visivi degli altri file.
    await page.evaluate(async (ids: string[]) => {
      for (const id of ids) {
        await fetch(`/api/mappings/${id}`, { method: "DELETE" })
      }
    }, ["movie:9001", "movie:9002", "movie:9003"])
  })

  test("miniatura: custom valido, fallback su rotto, landscape invariato, cambio URL in place", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    await seed(page)
    await gotoMyPosters(page)

    // Custom valido: src = custom, immagine davvero caricata
    const tileOk = page.locator('img[alt="Custom Valido"]')
    await tileOk.scrollIntoViewIfNeeded()
    await expect(tileOk).toHaveAttribute("src", CUSTOM_OK)
    await expect.poll(() => widthOf(tileOk), { timeout: 15_000 }).toBeGreaterThan(0)

    // Custom non caricabile: fallback al poster TMDB, caricato
    const tileBroken = page.locator('img[alt="Custom Rotto"]')
    await tileBroken.scrollIntoViewIfNeeded()
    await expect(tileBroken).toHaveAttribute("src", FALLBACK_B)
    await expect.poll(() => widthOf(tileBroken), { timeout: 15_000 }).toBeGreaterThan(0)

    // Orizzontale: backdrop, custom ignorato
    const tileLand = page.locator('img[alt="Orizzontale Custom"]')
    await tileLand.scrollIntoViewIfNeeded()
    await expect(tileLand).toHaveAttribute("src", BACKDROP)
    expect(await tileLand.getAttribute("src")).not.toBe(CUSTOM_IGNORED)

    // Cambio URL dopo errore SENZA reload: dopo il PUT, il toggle di formato
    // di UN'ALTRA tile ricarica i mapping e la tile rotta — stessa istanza
    // (chiave stabile, resta nella sezione verticale) — riceve le nuove
    // props; il reset dello stato d'errore fa caricare la nuova immagine.
    await putCustom(page, "movie:9002", CUSTOM_NEW)
    const cardOk = page.locator(".surface-card", { has: tileOk })
    await cardOk.getByRole("button", { name: "Imposta come orizzontale" }).click()
    await expect(tileBroken).toHaveAttribute("src", CUSTOM_NEW, { timeout: 15_000 })
    await expect.poll(() => widthOf(tileBroken), { timeout: 15_000 }).toBeGreaterThan(0)
    // Ripristino stato seed per indipendenza tra test
    const cardOkLand = page.locator(".surface-card", { has: page.locator('img[alt="Custom Valido"]') })
    await cardOkLand.getByRole("button", { name: "Imposta come verticale" }).click()
  })

  test("ingrandimento: custom valido, fallback su rotto, landscape, nuovo URL dopo errore", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    await seed(page)
    await gotoMyPosters(page)
    const dialog = page.getByRole("dialog")

    // Ingrandimento custom valido
    await page.locator(".surface-card", { has: page.locator('img[alt="Custom Valido"]') })
      .getByRole("button", { name: "Anteprima rapida" }).click()
    await expect(dialog).toBeVisible()
    const lightOk = dialog.locator('img[alt="Custom Valido"]')
    await expect(lightOk).toHaveAttribute("src", CUSTOM_OK)
    await expect.poll(() => widthOf(lightOk), { timeout: 15_000 }).toBeGreaterThan(0)
    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible()

    // Ingrandimento custom rotto: stesso fallback della miniatura (a w500)
    await page.locator(".surface-card", { has: page.locator('img[alt="Custom Rotto"]') })
      .getByRole("button", { name: "Anteprima rapida" }).click()
    await expect(dialog).toBeVisible()
    const lightBroken = dialog.locator('img[alt="Custom Rotto"]')
    await expect(lightBroken).toHaveAttribute("src", FALLBACK_B_LB)
    await expect.poll(() => widthOf(lightBroken), { timeout: 15_000 }).toBeGreaterThan(0)
    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible()

    // Ingrandimento landscape: backdrop, custom ignorato
    await page.locator(".surface-card", { has: page.locator('img[alt="Orizzontale Custom"]') })
      .getByRole("button", { name: "Anteprima rapida" }).click()
    await expect(dialog).toBeVisible()
    const lightLand = dialog.locator('img[alt="Orizzontale Custom"]')
    await expect(lightLand).toHaveAttribute("src", BACKDROP)
    await expect.poll(() => widthOf(lightLand), { timeout: 15_000 }).toBeGreaterThan(0)
    await page.keyboard.press("Escape")
    await expect(dialog).not.toBeVisible()

    // Nuovo URL dopo errore: l'ingrandimento mostra la nuova immagine caricata
    await putCustom(page, "movie:9002", CUSTOM_NEW)
    await page.reload()
    await gotoMyPosters(page)
    await page.locator(".surface-card", { has: page.locator('img[alt="Custom Rotto"]') })
      .getByRole("button", { name: "Anteprima rapida" }).click()
    await expect(dialog).toBeVisible()
    const lightFixed = dialog.locator('img[alt="Custom Rotto"]')
    await expect(lightFixed).toHaveAttribute("src", CUSTOM_NEW)
    await expect.poll(() => widthOf(lightFixed), { timeout: 15_000 }).toBeGreaterThan(0)
  })
})
