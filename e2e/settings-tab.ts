import type { Locator } from "@playwright/test"

/**
 * Fresh Settings open lands on Preferenze (secondary, no preview) since
 * 94540337. Specs that need the defaults preview first move to the Preset
 * primary tab: tab strip on desktop, #mobile-settings-category below sm.
 */
export async function gotoPresetTab(dialog: Locator): Promise<void> {
  const select = dialog.locator("#mobile-settings-category")
  if (await select.isVisible()) await select.selectOption("preset")
  else await dialog.getByRole("tab", { name: "Preset", exact: true }).click()
}
