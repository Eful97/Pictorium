import { expect, test } from "@playwright/test"

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`settings keyboard navigation at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      localStorage.setItem("pictorium_profile_id", "e2e-settings-keyboard")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
    })
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const trigger = page.getByRole("button", { name: "Impostazioni", exact: true })
    await trigger.click()

    const dialog = page.getByRole("dialog", { name: "Impostazioni", exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Sincronizza ora", exact: true })).toBeVisible()
    const controls = dialog.locator(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ).filter({ visible: true })
    const count = await controls.count()
    expect(count).toBeGreaterThan(3)
    await expect(controls.first()).toBeFocused()

    // Traverse every control, including the footer, in both directions.
    for (let i = 1; i <= count; i++) {
      await page.keyboard.press("Tab")
      await expect(controls.nth(i % count)).toBeFocused()
    }
    for (let i = count - 1; i >= 0; i--) {
      await page.keyboard.press("Shift+Tab")
      await expect(controls.nth(i)).toBeFocused()
    }

    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
}
