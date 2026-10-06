import { test, expect, type Page } from "@playwright/test"

async function openSettings(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("pictorium_profile_id", "e2e-visual-presets")
    localStorage.setItem("pictorium_profile_stateless", "1")
    localStorage.setItem("pictorium_onboarding_done", "true")
    localStorage.setItem("preferred_lang", "it")
    localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
  })
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible()
  const dialog = page.getByRole("dialog").filter({ visible: true })
  await expect(async () => {
    if (!await dialog.count()) await page.getByRole("button", { name: /Configura tutti i poster|Impostazioni/i }).filter({ visible: true }).click()
    await expect(dialog).toBeVisible({ timeout: 1000 })
  }).toPass()
  // Personal presets live in a disclosure closed by default: expand it first
  // (body unmounts while closed). All save/apply/delete assertions unchanged.
  await dialog.getByRole("button", { name: /I miei preset/ }).click()
  await expect(dialog.getByRole("button", { name: "Salva stile attuale" })).toBeVisible()
  return dialog
}

test("personal styles are saved on the server and can be applied from another device", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
  const scale = dialog.locator('input[type="range"]').first()
  await scale.fill("42")
  const name = `Cinema ${Date.now()}`
  await dialog.getByRole("textbox", { name: "Nome del preset" }).fill(name)
  const saveResponse = page.waitForResponse((res) => res.url().includes("/api/defaults/presets") && res.request().method() === "POST")
  await dialog.getByRole("button", { name: "Salva stile attuale" }).click()
  expect((await saveResponse).ok()).toBeTruthy()
  await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible()
  await scale.fill("65")
  await dialog.getByRole("textbox", { name: "Nome del preset" }).fill(name)
  const overwriteResponse = page.waitForResponse((res) => res.url().includes("/api/defaults/presets") && res.request().method() === "POST")
  await dialog.getByRole("button", { name: "Salva stile attuale" }).click()
  const overwritten = await (await overwriteResponse).json()
  expect(overwritten.presets.filter((preset: { name: string }) => preset.name === name)).toHaveLength(1)

  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  try {
    const secondPage = await secondContext.newPage()
    const secondDialog = await openSettings(secondPage)
    await expect(secondDialog.getByRole("button", { name, exact: true })).toBeVisible()
    await secondDialog.getByRole("button", { name, exact: true }).click()
    await secondDialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    await expect(secondDialog.locator('input[type="range"]').first()).toBeVisible()
    await expect(secondDialog.locator('input[type="range"]').first()).toHaveValue("65")
    await secondPage.screenshot({ path: "artifacts/personal-visual-presets.png" })
    await secondPage.setViewportSize({ width: 390, height: 844 })
    // Resize swaps the responsive branch and remounts the section (collapsed
    // by design): reopen the disclosure. Assertions below are unchanged.
    if ((await secondDialog.getByRole("button", { name, exact: true }).count()) === 0) {
      await secondDialog.getByRole("button", { name: /I miei preset/ }).click()
    }
    const presetButton = secondDialog.getByRole("button", { name, exact: true })
    const deleteButton = secondDialog.getByRole("button", { name: `Elimina ${name}`, exact: true })
    await expect(presetButton).toBeVisible()
    await expect(deleteButton).toBeVisible()
    const presetBox = await presetButton.boundingBox()
    const deleteBox = await deleteButton.boundingBox()
    expect(deleteBox!.y).toBeLessThan(presetBox!.y)
    await secondPage.screenshot({ path: "artifacts/personal-visual-presets-mobile.png" })
    const deleted = secondPage.waitForResponse((res) => res.url().includes("/api/defaults/presets") && res.request().method() === "DELETE")
    await secondDialog.getByRole("button", { name: `Elimina ${name}`, exact: true }).click()
    expect((await deleted).ok()).toBeTruthy()
    await expect(secondDialog.getByRole("button", { name, exact: true })).toHaveCount(0)
  } finally {
    await secondContext.close()
    const stored = await page.request.get("/api/defaults/presets")
    if (stored.ok()) {
      for (const preset of (await stored.json()).presets) {
        if (preset.name === name) await page.request.delete("/api/defaults/presets", { data: { id: preset.id } })
      }
    }
  }
})
