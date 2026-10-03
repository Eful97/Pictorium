import { test, expect } from "@playwright/test"

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
    await page.route("**/api/poster/movie/19995?**", async (route) => {
      await route.fulfill({ status: 503, body: "Temporary render failure" })
    }, { times: 1 })
    const initialRequest = page.waitForRequest((req) => req.url().includes("/api/poster/movie/19995"))
    const dialog = page.getByRole("dialog").filter({ visible: true })
    await expect(async () => {
      if (!await dialog.count()) {
        await page.getByRole("button", { name: /Configura tutti i poster|Tutti i poster/i }).filter({ visible: true }).click()
      }
      await expect(dialog).toBeVisible({ timeout: 1000 })
    }).toPass()
    await dialog.getByRole("button", { name: "Riprova" }).click()
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
    const request = page.waitForRequest((req) => req.url().includes("/api/poster/movie/19995") && new URL(req.url()).searchParams.get("bs") === (minimal ? "minimal" : "pill"))
    await dialog.getByRole("button", { name: minimal ? /Essenziale/ : /^Voti/ }).click()
    await request
    await expect.poll(() => image.getAttribute("src")).not.toBe(previousSrc)
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    if (width < 768) {
      await dialog.locator("#mobile-settings-category").selectOption("trasforma")
    } else {
      await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    }
    const logoScale = controls.locator('input[type="range"]').first()
    const targetScale = await logoScale.inputValue() === "40" ? "65" : "40"
    const scaleRequest = page.waitForRequest((req) => req.url().includes("/api/poster/movie/19995") && new URL(req.url()).searchParams.get("scale") === targetScale)
    await logoScale.fill(targetScale)
    await scaleRequest
    await page.screenshot({ path: `artifacts/settings-preview-${width}.png` })
  })
}
