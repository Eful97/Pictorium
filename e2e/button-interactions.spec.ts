import { expect, test } from "@playwright/test"

test.describe("Button interactions and immediate updates", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
        localStorage.setItem("posterium_profile_id", "e2e-buttons-profile")
        localStorage.setItem("posterium_profile_stateless", "1")
        localStorage.setItem("posterium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
      } catch {}
    })
  })

  test("Header & navigation buttons respond immediately", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

    // 1. Installa Hub button opens modal, and modal close button works immediately
    const installBtn = page.getByRole("button", { name: /Installa Hub/i })
    await expect(installBtn).toBeVisible()
    await installBtn.click()
    const modalHeading = page.getByRole("heading", { name: /Installa Posterium/i })
    await expect(modalHeading).toBeVisible()
    // Close modal via accessible close button
    const closeBtn = page.getByRole("button", { name: "Chiudi" }).first()
    await closeBtn.click()
    await expect(modalHeading).not.toBeVisible()

    // 2. Cataloghi button navigates to cataloghi and toggles back immediately
    const cataloghiBtn = page.getByRole("button", { name: "Cataloghi", exact: true })
    await cataloghiBtn.click()
    await expect(page.getByRole("heading", { name: "Cataloghi", exact: true })).toBeVisible()

    // In Cataloghi: test "Priorità & Nomi" modal open & close
    const managerBtn = page.getByRole("button", { name: /Priorità & Nomi/i })
    await managerBtn.click()
    await expect(page.getByText(/Priorità & Nomi Cataloghi Stremio/i)).toBeVisible()
    const closeManagerBtn = page.getByRole("button", { name: "Chiudi" }).first()
    await closeManagerBtn.click()
    await expect(page.getByText(/Priorità & Nomi Cataloghi Stremio/i)).not.toBeVisible()

    // In Cataloghi: test "Aggiungi Catalogo" modal open & close
    const addCatBtn = page.getByRole("button", { name: /Aggiungi Catalogo/i })
    await addCatBtn.click()
    await expect(page.getByText("Nuovo Catalogo")).toBeVisible()
    const closeAddCatBtn = page.getByRole("button", { name: "Chiudi" }).first()
    await closeAddCatBtn.click()
    await expect(page.getByText("Nuovo Catalogo")).not.toBeVisible()

    // Click Cataloghi again to toggle back immediately
    await cataloghiBtn.click()
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible()

    // 3. I Miei Poster button navigates to myposters and toggles back immediately
    const myPostersBtn = page.getByRole("button", { name: /I miei poster/i })
    await myPostersBtn.click()
    await expect(page.getByRole("heading", { name: /I miei poster/i })).toBeVisible()

    // In MyPosters: test type filter chips
    const filmFilter = page.getByRole("button", { name: "Film", exact: true })
    const tuttiFilter = page.getByRole("button", { name: "Tutti", exact: true })
    await filmFilter.click()
    await expect(filmFilter).toHaveClass(/bg-accent-orange\/15/)
    await expect(tuttiFilter).not.toHaveClass(/bg-accent-orange\/15/)
    await tuttiFilter.click()
    await expect(tuttiFilter).toHaveClass(/bg-accent-orange\/15/)

    // In MyPosters: test Sort dropdown button
    const sortBtn = page.getByRole("button", { name: /Recenti|A-Z/i }).first()
    await sortBtn.click()
    const sortAZBtn = page.getByRole("button", { name: "A-Z" })
    await expect(sortAZBtn).toBeVisible()
    await sortAZBtn.click()

    // In MyPosters: test selection mode toggle button
    const selectModeBtn = page.getByRole("button", { name: "Seleziona" })
    await selectModeBtn.click()
    const cancelSelectBtn = page.getByRole("button", { name: "Annulla" })
    await expect(cancelSelectBtn).toBeVisible()
    await cancelSelectBtn.click()
    await expect(selectModeBtn).toBeVisible()

    // Click I Miei Poster again to toggle back immediately
    await myPostersBtn.click()
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible()

    // 4. Proxy Modal button opens and closes
    const proxyBtn = page.getByRole("button", { name: /Addon Proxy/i })
    if (await proxyBtn.isVisible()) {
      await proxyBtn.click()
      await expect(page.getByRole("heading", { name: /Generatore Addon Proxy/i })).toBeVisible()
      const closeProxy = page.getByRole("button", { name: "Chiudi" }).first()
      await closeProxy.click()
      await expect(page.getByRole("heading", { name: /Generatore Addon Proxy/i })).not.toBeVisible()
    }
  })

  test("Settings panel buttons and toggles update immediately", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

    // Open settings panel
    const settingsBtn = page.getByRole("button", { name: /Impostazioni/i }).first()
    await settingsBtn.click()
    await expect(page.getByText(/Stile badge predefinito/i).first()).toBeVisible()

    // Test Badge Style selector buttons within the 6-col grid
    const styleGrid = page.locator(".grid.grid-cols-3.sm\\:grid-cols-6").first()
    const pillBtn = styleGrid.getByRole("button", { name: "Pill" })
    const bordoBtn = styleGrid.getByRole("button", { name: "Bordo" })

    await pillBtn.click()
    await expect(pillBtn).toHaveClass(/bg-accent-orange\/15/)

    await bordoBtn.click()
    await expect(bordoBtn).toHaveClass(/bg-accent-orange\/15/)
    await expect(pillBtn).not.toHaveClass(/bg-accent-orange\/15/)

    // Test Toggles (switch)
    const genreToggle = page.getByRole("switch", { name: "Genere" }).first()
    const initialGenreChecked = await genreToggle.getAttribute("aria-checked")
    await genreToggle.click()
    const newGenreChecked = await genreToggle.getAttribute("aria-checked")
    expect(newGenreChecked).not.toBe(initialGenreChecked)
    // Toggle back
    await genreToggle.click()
    expect(await genreToggle.getAttribute("aria-checked")).toBe(initialGenreChecked)

    // Test Rating Sources Accordion
    const sourcesAccordion = page.getByRole("button", { name: /Provider del voto/i })
    await sourcesAccordion.click()
    await expect(page.getByRole("button", { name: "Abilita tutti", exact: true })).toBeVisible()

    // Click "Abilita tutti"
    const enableAllBtn = page.getByRole("button", { name: "Abilita tutti", exact: true })
    await enableAllBtn.click()
    await expect(page.getByText(/16\/16/).first()).toBeVisible()

    // Click "Disabilita tutti" (resets to default 2)
    const disableAllBtn = page.getByRole("button", { name: "Disabilita tutti", exact: true })
    await disableAllBtn.click()
    await expect(page.getByText(/2\/16/).first()).toBeVisible()

    // Test Ribbon side buttons
    const stremioRibbon = page.getByRole("button", { name: "Stremio" }).first()
    const nuvioRibbon = page.getByRole("button", { name: "Nuvio" }).first()
    await nuvioRibbon.click()
    await expect(nuvioRibbon).toHaveClass(/bg-white\/20/)
    await stremioRibbon.click()
    await expect(stremioRibbon).toHaveClass(/bg-white\/20/)
    await expect(nuvioRibbon).not.toHaveClass(/bg-white\/20/)

    // Test Episode metadata source buttons
    const episodeSourceSection = page.locator(".flex.gap-1").filter({ hasText: "TMDB" })
    const tvdbBtn = episodeSourceSection.getByRole("button", { name: "TVDB" })
    const tmdbBtn = episodeSourceSection.getByRole("button", { name: "TMDB" })
    await tvdbBtn.click()
    await expect(tvdbBtn).toHaveClass(/bg-white\/20/)
    await tmdbBtn.click()
    await expect(tmdbBtn).toHaveClass(/bg-white\/20/)
    await expect(tvdbBtn).not.toHaveClass(/bg-white\/20/)

    // Test Blur toggle switch
    const blurToggle = page.getByRole("switch", { name: "Sfocatura predefinita" })
    const initialBlurChecked = await blurToggle.getAttribute("aria-checked")
    await blurToggle.click()
    const afterBlurChecked = await blurToggle.getAttribute("aria-checked")
    expect(afterBlurChecked).not.toBe(initialBlurChecked)
    // Toggle back
    await blurToggle.click()
    expect(await blurToggle.getAttribute("aria-checked")).toBe(initialBlurChecked)

    // Test Save Defaults button
    const saveDefaultsBtn = page.getByRole("button", { name: /Salva come Predefiniti/i })
    await saveDefaultsBtn.click()
    await expect(page.getByRole("button", { name: /Salvato/i })).toBeVisible()
  })

  test("Editor view buttons and tabs update immediately upon clicking", async ({ page }) => {
    await page.goto("/")
    const search = page.getByPlaceholder(/cerca/i)
    await search.fill("avatar")
    await search.press("Enter")

    await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
    await page.getByText(/Avatar/i).first().click()

    // Editor is open
    await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 10_000 })

    // Test Poster tile click in left panel
    const posterTiles = page.locator(".poster-tile")
    if ((await posterTiles.count()) > 1) {
      const secondPoster = posterTiles.nth(1)
      await secondPoster.click()
      await expect(secondPoster).toHaveClass(/poster-tile-active/)
    }

    // Test Editor Right Panel Tabs (Loghi, Badge)
    const badgeTab = page.getByRole("tab", { name: "Badge" })
    const logoTab = page.getByRole("tab", { name: "Loghi" })

    await badgeTab.click()
    await expect(badgeTab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByText(/Stile badge/i).first()).toBeVisible()

    // Inside Badge tab: test style selector
    const styleGrid = page.locator(".grid.grid-cols-3.sm\\:grid-cols-6").first()
    const pillBadge = styleGrid.getByRole("button", { name: "Pill" })
    const bordoBadge = styleGrid.getByRole("button", { name: "Bordo" })

    await pillBadge.click()
    await expect(pillBadge).toHaveClass(/bg-accent-orange\/15/)

    await bordoBadge.click()
    await expect(bordoBadge).toHaveClass(/bg-accent-orange\/15/)
    await expect(pillBadge).not.toHaveClass(/bg-accent-orange\/15/)

    // Test switch toggle in Badge tab
    const trendSwitch = page.getByRole("switch", { name: "Trend" })
    const initialTrend = await trendSwitch.getAttribute("aria-checked")
    await trendSwitch.click()
    const nextTrend = await trendSwitch.getAttribute("aria-checked")
    expect(nextTrend).not.toBe(initialTrend)

    // Test Logo Network switch toggle in Badge tab
    const netLogoSwitch = page.getByRole("switch", { name: /Logo Network|Network logo/i })
    await expect(netLogoSwitch).toBeVisible()
    const initialNetLogo = await netLogoSwitch.getAttribute("aria-checked")
    await netLogoSwitch.click()
    const nextNetLogo = await netLogoSwitch.getAttribute("aria-checked")
    expect(nextNetLogo).not.toBe(initialNetLogo)
    // Toggle back
    await netLogoSwitch.click()
    expect(await netLogoSwitch.getAttribute("aria-checked")).toBe(initialNetLogo)

    // Switch back to Logo tab
    await logoTab.click()
    await expect(logoTab).toHaveAttribute("aria-selected", "true")

    // Test Testa URL button (wait for preview poster to load so button is visible)
    const testUrlBtn = page.getByRole("button", { name: /Testa URL/i })
    await expect(testUrlBtn).toBeVisible({ timeout: 15_000 })
    await testUrlBtn.click()
    const testModalTitle = page.getByRole("heading", { name: /Anteprima URL/i })
    await expect(testModalTitle).toBeVisible()
    const closeTestModal = page.getByRole("button", { name: "Chiudi" }).or(page.getByLabel("Chiudi")).first()
    await closeTestModal.click()
    await expect(testModalTitle).not.toBeVisible()

    // Test Salva Poster button
    const savePosterBtn = page.getByRole("button", { name: /Salva Poster/i }).first()
    await expect(savePosterBtn).toBeVisible()
    await savePosterBtn.click()
    // After saving, remove button should be rendered in preview footer
    const removeBtn = page.getByRole("button", { name: /Rimuovi/i })
    await expect(removeBtn).toBeVisible({ timeout: 10_000 })
  })
})
