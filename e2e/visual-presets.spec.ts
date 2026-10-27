import { test, expect, type Page } from "@playwright/test"

async function ensureManageOpen(dialog: ReturnType<Page["getByRole"]>) {
  // Personal presets live in a gallery disclosure closed by default, and the
  // save form in a nested manage disclosure (also closed by default; both
  // bodies unmount while closed and reset on tab switches/remounts). Expand
  // whatever is collapsed. All save/apply/delete assertions unchanged.
  // The save control is addressed by test id: its label is "Save as new
  // preset" here (creating never overwrites the applied preset; the explicit
  // update action is a two-step confirm on its own control).
  if ((await dialog.getByTestId("visual-preset-create").count()) === 0) {
    const gallery = dialog.getByRole("button", { name: /I miei preset/ }).first()
    if ((await gallery.getAttribute("aria-expanded")) !== "true") await gallery.click()
  }
  if ((await dialog.getByTestId("visual-preset-create").count()) === 0) {
    await dialog.getByTestId("visual-presets-manage-toggle").click()
  }
  await expect(dialog.getByTestId("visual-preset-create")).toBeVisible()
}

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
  // NOTE: the dialog is matched by accessible name ("Configura tutti i poster",
  // like the sibling specs), never by bare role: a bare getByRole("dialog")
  // also matches the Next.js dev error overlay (data-nextjs-dialog), so a
  // chunk-load failure would false-pass the open step and explode later with
  // misleading save/apply/delete errors instead of failing here honestly.
  const dialog = page.getByRole("dialog", { name: /Configura tutti i poster/i }).filter({ visible: true })
  // Single click, then wait for the named settings dialog: the visible
  // client-only editor means handlers are attached, and a second click can
  // race the opening modal and get blocked. Bounded wait (10s, no retry).
  await page.getByRole("button", { name: /Configura tutti i poster|Impostazioni/i }).filter({ visible: true }).click()
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  // The save form lives on the Preset tab (dialog default): expand the
  // gallery + nested manage disclosures before asserting it.
  await ensureManageOpen(dialog)
  return dialog
}

test("personal styles are saved on the server and can be applied from another device", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const dialog = await openSettings(page)
  await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
  const scale = dialog.locator('input[type="range"]').first()
  await scale.fill("42")
  // The save form lives on the Preset tab: go back (disclosures reset on
  // the tab switch) and reopen them. The staged slider edit survives.
  await dialog.getByRole("tab", { name: "Preset", exact: true }).click()
  await ensureManageOpen(dialog)
  const name = `Cinema ${Date.now()}`
  await dialog.getByRole("textbox", { name: "Nome del preset" }).fill(name)
  const saveResponse = page.waitForResponse((res) => res.url().includes("/api/defaults/presets") && res.request().method() === "POST")
  await dialog.getByTestId("visual-preset-create").click()
  expect((await saveResponse).ok()).toBeTruthy()
  await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible()
  // The explicit update flow is offered for the APPLIED personal preset: apply
  // the saved tile, tune, then arm + confirm the overwrite. "Save as new
  // preset" never silently replaces an existing one.
  await dialog.getByRole("button", { name, exact: true }).click()
  await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
  await scale.fill("65")
  await dialog.getByRole("tab", { name: "Preset", exact: true }).click()
  await ensureManageOpen(dialog)
  await dialog.getByRole("textbox", { name: "Nome del preset" }).fill(name)
  const update = dialog.getByTestId("visual-preset-update")
  await expect(update).toBeVisible()
  await update.click()
  const overwriteResponse = page.waitForResponse((res) => res.url().includes("/api/defaults/presets") && res.request().method() === "POST")
  await update.click()
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
    // Resize swaps the responsive branch and may remount the section
    // (collapsed by design): go back to Preset (the dialog sits on
    // Trasforma here, where the gallery is hidden) and reopen the
    // disclosures. Assertions below are unchanged.
    if ((await secondDialog.getByRole("button", { name, exact: true }).count()) === 0) {
      await secondDialog.locator("#mobile-settings-category").selectOption("preset")
      await ensureManageOpen(secondDialog)
    }
    const presetButton = secondDialog.getByRole("button", { name, exact: true })
    const deleteButton = secondDialog.getByRole("button", { name: `Elimina ${name}`, exact: true })
    await expect(presetButton).toBeVisible()
    await expect(deleteButton).toBeVisible()
    const presetBox = await presetButton.boundingBox()
    const deleteBox = await deleteButton.boundingBox()
    // Gallery-first layout (demonstrated source order: thumbnail grid above,
    // manage disclosure below): the preset tile sits above its delete row.
    expect(deleteBox!.y).toBeGreaterThan(presetBox!.y)
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
