import { test, expect, type Page, type Locator } from "@playwright/test"

// Mobile settings floating preview: title-search dialog (preview-only).
// Transport-level only (mock TMDB via mock-server + page.route on
// /api/tmdb/search); the poster backend is always the real route. No
// snapshots here: no rendering change, isolated assertions only.
//
// Covers the user-authorized contract: a 44px search trigger on the mobile
// floating preview opens a bounded dialog INSIDE settings (never a search
// box crammed into the 104px overlay, never a navigation away); choosing a
// title switches only the preview path (onDemoMediaChange) while the staged
// draft stays clean (Save disabled, zero PUTs); Escape closes with focus
// back on the trigger and settings still open.

const CASA_PAYLOAD = {
  results: [
    {
      id: 1399,
      media_type: "tv",
      name: "La casa di carta",
      poster_path: "/casa.jpg",
      first_air_date: "2017-05-02",
      vote_average: 8.2,
    },
  ],
  total_results: 1,
  total_pages: 1,
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      localStorage.setItem("pictorium_profile_id", "e2e-mobile-preview-search")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
    } catch {}
  })
}

async function openSettings(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: /Configura tutti i poster|Tutti i poster|Impostazioni/i })
    .filter({ visible: true })
    .click({ timeout: 15_000 })
  const dialog = page.getByRole("dialog").first()
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  return dialog
}

test("mobile 390px: floating search opens, selects tv preview-only, Escape restores", async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route("**/api/tmdb/search**", async (route) => {
    await route.fulfill({ json: CASA_PAYLOAD })
  })
  let puts = 0
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes("/api/defaults")) puts += 1
  })
  await page.goto("/")
  const urlBefore = page.url()
  const dialog = await openSettings(page)

  // Floating overlay with the 44px search trigger (accessible name + state).
  const floating = dialog.locator('[data-testid="settings-preview"][data-floating="true"]')
  await expect(floating).toBeVisible()
  const trigger = dialog.getByTestId("floating-preview-search")
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-label", "Titolo anteprima")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  // Settled-box read: the settings panel enters with a 0.28s scale
  // animation (`modal-panel-in` in globals.css, also on Modal panels), so an
  // immediate boundingBox can catch a mid-animation frame (~43.99). Poll the
  // live box until BOTH axes settle at the real 44px hit target.
  await expect.poll(async () => {
    const b = await trigger.boundingBox()
    return b ? Math.min(b.width, b.height) : 0
  }).toBeGreaterThanOrEqual(44)

  // Opens the bounded dialog inside settings with focus in the search box.
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  const searchDialog = page.getByTestId("floating-preview-search-dialog")
  await expect(searchDialog).toBeVisible()
  const searchBox = searchDialog.getByRole("textbox")
  await expect(searchBox).toBeFocused()
  await expect(searchBox).toBeVisible()
  // Bounded panel: fits the 390px viewport with room for the footer behind.
  const panel = await searchDialog.boundingBox()
  expect(panel!.width).toBeLessThanOrEqual(390)
  expect(panel!.width).toBeGreaterThan(200)
  expect(panel!.height).toBeLessThanOrEqual(844)

  // Search -> select switches ONLY the preview to tv/1399.
  const tvResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/poster/tv/1399") &&
      res.request().resourceType() === "xhr" &&
      res.ok(),
    { timeout: 30_000 },
  )
  await searchBox.fill("casa")
  await searchBox.press("Enter")
  await searchDialog.getByRole("option", { name: /La casa di carta/ }).click()
  await tvResponse
  const tvImage = dialog.getByAltText("La casa di carta")
  await expect(tvImage).toBeVisible({ timeout: 45_000 })
  await expect.poll(() => tvImage.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 45_000 }).toBeGreaterThan(0)

  // Preview-only: staged draft stays clean (Save disabled), zero PUTs, no
  // navigation away from settings, portrait shape kept.
  await expect(page.getByTestId("settings-save")).toBeDisabled()
  expect(puts).toBe(0)
  expect(page.url()).toBe(urlBefore)
  await expect(dialog.locator('[data-testid="settings-preview"]')).toBeVisible()
  await expect(dialog.getByTestId("defaults-preview-media")).toHaveClass(/aspect-\[2\/3\]/)
  await expect(page.getByRole("button", { name: "Indietro" })).toBeVisible()

  // Escape closes only the dialog; focus returns to the trigger; the footer
  // stays reachable with no horizontal overflow.
  await searchBox.press("Escape")
  await expect(searchDialog).toHaveCount(0)
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toBeFocused()
  await expect(page.getByTestId("settings-save")).toBeVisible()
  expect(puts).toBe(0)
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflowX).toBeLessThanOrEqual(1)
})

test("mobile 320px landscape: floating search fits narrow viewport, preview-only, Escape/close restore", async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 320, height: 568 })
  await page.route("**/api/tmdb/search**", async (route) => {
    await route.fulfill({ json: CASA_PAYLOAD })
  })
  let puts = 0
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().includes("/api/defaults")) puts += 1
  })
  await page.goto("/")
  const urlBefore = page.url()
  const dialog = await openSettings(page)

  // Landscape preview via the existing format-target flow (preview-only shape,
  // staged draft untouched: no PUT on the switch itself).
  await page.getByTestId("format-target-selector").getByRole("button", { name: /Orizzontale/i }).click()
  await expect(dialog.getByTestId("defaults-preview-media")).toHaveClass(/aspect-video/)
  expect(puts).toBe(0)

  // Floating overlay with the 44px search trigger, both inside the 320px viewport.
  const floating = dialog.locator('[data-testid="settings-preview"][data-floating="true"]')
  await expect(floating).toBeVisible()
  const trigger = dialog.getByTestId("floating-preview-search")
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-label", "Titolo anteprima")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  // Same settled-box rule as the 390px case (panel scale animation):
  // poll until both axes settle at 44px, then read one settled box for the
  // viewport-containment bounds.
  await expect.poll(async () => {
    const b = await trigger.boundingBox()
    return b ? Math.min(b.width, b.height) : 0
  }).toBeGreaterThanOrEqual(44)
  const triggerBox = await trigger.boundingBox()
  expect(triggerBox!.x).toBeGreaterThanOrEqual(0)
  expect(triggerBox!.x + triggerBox!.width).toBeLessThanOrEqual(320)

  // Opens the bounded dialog inside settings with focus in the search box.
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  const searchDialog = page.getByTestId("floating-preview-search-dialog")
  await expect(searchDialog).toBeVisible()
  const searchBox = searchDialog.getByRole("textbox")
  await expect(searchBox).toBeFocused()
  await expect(searchBox).toBeVisible()
  // Bounded panel: fits the 320px viewport, no horizontal overflow.
  const panel = await searchDialog.boundingBox()
  expect(panel!.width).toBeLessThanOrEqual(320)
  expect(panel!.width).toBeGreaterThan(200)
  expect(panel!.height).toBeLessThanOrEqual(568)
  expect(panel!.x).toBeGreaterThanOrEqual(0)
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(321)
  // Accessible close control beside Escape: labelled 44px target.
  const closeButton = page.getByTestId("floating-preview-search-close")
  await expect(closeButton).toBeVisible()
  // The search dialog panel animates in with the same 0.28s scale
  // (`animate-modal-panel-in` on Modal): poll the settled box, strict 44px.
  await expect.poll(async () => {
    const b = await closeButton.boundingBox()
    return b ? Math.min(b.width, b.height) : 0
  }).toBeGreaterThanOrEqual(44)

  // Search -> select switches ONLY the preview to tv/1399; landscape kept.
  const tvResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/poster/tv/1399") &&
      res.request().resourceType() === "xhr" &&
      res.ok(),
    { timeout: 30_000 },
  )
  await searchBox.fill("casa")
  await searchBox.press("Enter")
  await searchDialog.getByRole("option", { name: /La casa di carta/ }).click()
  await tvResponse
  const tvImage = dialog.getByAltText("La casa di carta")
  await expect(tvImage).toBeVisible({ timeout: 45_000 })
  await expect.poll(() => tvImage.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 45_000 }).toBeGreaterThan(0)

  // Preview-only: staged draft stays clean (Save disabled), zero PUTs, no
  // navigation away from settings, landscape shape kept.
  await expect(page.getByTestId("settings-save")).toBeDisabled()
  expect(puts).toBe(0)
  expect(page.url()).toBe(urlBefore)
  await expect(dialog.locator('[data-testid="settings-preview"]')).toBeVisible()
  await expect(dialog.getByTestId("defaults-preview-media")).toHaveClass(/aspect-video/)
  await expect(page.getByRole("button", { name: "Indietro" })).toBeVisible()

  // Escape closes only the dialog; focus returns to the trigger; the footer
  // stays reachable with no horizontal overflow at 320px.
  await searchBox.press("Escape")
  await expect(searchDialog).toHaveCount(0)
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toBeFocused()
  await expect(page.getByTestId("settings-save")).toBeVisible()
  expect(puts).toBe(0)
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflowX).toBeLessThanOrEqual(1)

  // Reopen and close via the labelled close button: same preview-only state.
  await trigger.click()
  await expect(page.getByTestId("floating-preview-search-dialog")).toBeVisible()
  await page.getByTestId("floating-preview-search-close").click()
  await expect(page.getByTestId("floating-preview-search-dialog")).toHaveCount(0)
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toBeFocused()
  expect(puts).toBe(0)
  await expect(dialog.getByTestId("defaults-preview-media")).toHaveClass(/aspect-video/)
  await expect(page.getByTestId("settings-save")).toBeDisabled()
})
