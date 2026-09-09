import { expect, test } from "@playwright/test"

test("home loads and exposes main actions", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("posterium_profile_id", "e2e-smoke-profile")
      localStorage.setItem("posterium_profile_stateless", "1")
      localStorage.setItem("posterium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
    } catch {}
  })
  await page.goto("/")

  const logo = page.getByAltText(/Pictorium|Posterium/)
  const logoFallback = page.getByText(/Pictorium|Posterium/)
  await expect(logo.or(logoFallback).first()).toBeVisible()

  await expect(page.getByPlaceholder(/cerca un film|cerca una serie|search/i)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: /AIOMetadata URL/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Installa Hub|Installa catalogo|Installa/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /I miei poster/i })).toBeVisible()
  await expect(page.getByRole("button", { name: /Impostazioni|settings/i }).first()).toBeVisible()
})

test("home works on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    try {
      localStorage.setItem("posterium_profile_id", "e2e-smoke-profile")
      localStorage.setItem("posterium_profile_stateless", "1")
      localStorage.setItem("posterium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
    } catch {}
  })
  await page.goto("/")

  // Il logo vive in AppShell (SSR): verificarlo PRIMA della search bar dà al
  // chunk dinamico di EditView (dynamic import, ssr:false) il tempo di montare
  // senza bruciare il budget dell'assert. Stesso pattern di "home loads...".
  const logo = page.getByAltText(/Pictorium|Posterium/)
  const logoFallback = page.getByText(/Pictorium|Posterium/)
  await expect(logo.or(logoFallback).first()).toBeVisible()

  // Budget generoso: su runner GitHub Windows condivisi (Node 20, next dev a
  // freddo) il mount di EditView può superare i 10s default in casi sporadici.
  // Non è una regressione dei componenti home — verificato localmente 28/28.
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
})

test("can open an editor from search", async ({ page }) => {
  // Il gate client del hook di ricerca richiede una tmdbKey non vuota. Con il
  // mock server la chiave non è reale e non viene validata: basta un valore
  // per sbloccare il flusso di ricerca.
  await page.addInitScript(() => {
    localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
    // Dismiss dei tre modali first-visit (OnboardingTour z-[300], LangPicker
    // z-[100], ProfileModal z-50): senza i flag i full-screen overlay
    // intercettano il click sui risultati di ricerca in un contesto fresco.
    localStorage.setItem("posterium_onboarding_done", "true")
    localStorage.setItem("preferred_lang", "it")
    localStorage.setItem("posterium_profile_id", "e2e-smoke-profile")
    localStorage.setItem("posterium_profile_stateless", "1")
  })

  await page.goto("/")

  const search = page.getByPlaceholder(/cerca/i)
  await search.fill("avatar")
  await search.press("Enter")

  await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
  await page.getByText(/Avatar/i).first().click()

  // Editor aperto: i tre pannelli. Selettori non ambigui: il pannello sinistro
  // non ha heading visibile ("Poster" è solo nell'aria-label della sezione) e
  // i testi d'aiuto contengono la parola "poster" (strict mode violation).
  await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("region", { name: /Poster selection/i })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Loghi" })).toBeVisible()
})
