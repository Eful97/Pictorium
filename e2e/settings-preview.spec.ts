import { test, expect } from "@playwright/test"
import { gotoPresetTab } from "./settings-tab"

// Global preview error contract: a TRUE 503 on the dialog preview stream.
// The dialog preview (DefaultsPosterPreview) fetches the poster via XHR
// blob; the same URL pattern is also requested by preset-gallery thumbnails
// (plain <img>) and by the home demo strips. Failing every matching request
// (or a one-shot times:1) lets a thumbnail consume the fault while the
// dialog stays healthy — the old suite then timed out on the never-reached
// Riprova button. The route below fails ONLY the dialog XHR
// (request.resourceType() === "xhr", the HAR-proven dialog discriminator);
// every other request continues normally. The fault stays armed until the
// dialog error overlay itself is observed (deterministic hold, no counting),
// then the owned handler is unrouted BEFORE clicking Riprova, and the test
// proves the retry XHR answered 200 with a decoded image (naturalWidth > 0).
// A thumbnail 503 can therefore never masquerade as a pass.
const POSTER_PATTERN = "**/api/poster/movie/19995?**"

function isDialogXhr(url: string, resourceType: string): boolean {
  return url.includes("/api/poster/movie/19995") && resourceType === "xhr"
}

for (const width of [900, 1280, 390]) {
  test(`global preview stays visible and updates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => {
      localStorage.setItem("pictorium_profile_id", "e2e-settings")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
    })
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible()
    await page.route(POSTER_PATTERN, async (route) => {
      if (route.request().resourceType() === "xhr") {
        await route.fulfill({ status: 503, body: "Temporary render failure" })
      } else {
        await route.continue()
      }
    })
    const initialRequest = page.waitForRequest(
      (req) => isDialogXhr(req.url(), req.resourceType()),
      { timeout: 30_000 },
    )
    const dialog = page.getByRole("dialog").filter({ visible: true })
    await expect(async () => {
      if (!await dialog.count()) {
        await page.getByRole("button", { name: /Configura tutti i poster|Tutti i poster|Impostazioni/i }).filter({ visible: true }).click()
      }
      await expect(dialog).toBeVisible({ timeout: 1000 })
    }).toPass()
    await gotoPresetTab(dialog)
    // The fault landed on the real preview: the dialog error overlay (with
    // Riprova) is the hold gate — the 503 is not lifted before this.
    await initialRequest
    await expect(dialog.getByRole("button", { name: "Riprova" })).toBeVisible({ timeout: 30_000 })
    await page.unroute(POSTER_PATTERN)
    // Retry proof: an XHR for the same poster answered 200 (not a cached
    // thumbnail, not a second fault). The response waiter is registered
    // BEFORE the click: the retry round-trip may complete during the click
    // action itself, and a post-click waiter could miss it.
    const retryResponsePromise = page.waitForResponse(
      (res) => isDialogXhr(res.url(), res.request().resourceType()) && res.ok(),
      { timeout: 30_000 },
    )
    await dialog.getByRole("button", { name: "Riprova" }).click()
    const retryResponse = await retryResponsePromise
    expect(retryResponse.ok()).toBeTruthy()
    const initialStyle = new URL((await initialRequest).url()).searchParams.get("bs")
    const image = dialog.getByAltText("Avatar")
    await expect(image).toBeVisible({ timeout: 45000 })
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    const before = await image.boundingBox()
    const controls = dialog.getByTestId("settings-controls")
    await controls.evaluate((el) => { el.scrollTop = el.scrollHeight })
    const after = await image.boundingBox()
    expect(after!.y).toBeCloseTo(before!.y, 0)
    if (width >= 768) {
      const box = await controls.boundingBox()
      expect(after!.x).toBeGreaterThan(box!.x + box!.width)
    }
    await controls.evaluate((el) => { el.scrollTop = 0 })
    const previousSrc = await image.getAttribute("src")
    // Pick a different setup even when a previous test persisted its defaults.
    const minimal = initialStyle !== "minimal"
    const request = page.waitForRequest((req) => isDialogXhr(req.url(), req.resourceType()) && new URL(req.url()).searchParams.get("bs") === (minimal ? "minimal" : "pill"))
    await dialog.getByRole("button", { name: minimal ? /Essenziale/ : /^Voti/ }).click()
    await request
    await expect.poll(() => image.getAttribute("src")).not.toBe(previousSrc)
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    if (width < 768) {
      await dialog.locator("#mobile-settings-category").selectOption("transform")
    } else {
      await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    }
    const logoScale = controls.locator('input[type="range"]').first()
    const targetScale = await logoScale.inputValue() === "40" ? "65" : "40"
    const scaleRequest = page.waitForRequest((req) => isDialogXhr(req.url(), req.resourceType()) && new URL(req.url()).searchParams.get("scale") === targetScale)
    await logoScale.fill(targetScale)
    await scaleRequest
    await page.screenshot({ path: `artifacts/settings-preview-${width}.png` })
  })
}
