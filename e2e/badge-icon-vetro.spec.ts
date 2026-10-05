import { test, expect, type Page, type Locator } from "@playwright/test"

// T3 — anteprima icone stile badge (Vetro) in light/dark.
// Legge gli stili computati reali (icona + wrapper .badge-style-preview)
// negli stati selezionato/non selezionato e su mount ripetuti light→dark→light.
// PNG in test-results (ispezione umana); asserzioni sui colori computati,
// nessuno snapshot comparativo.
test.describe("Badge style icon preview (vetro) themes", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear()
        localStorage.setItem("pictorium_profile_id", "e2e-vetro")
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
      } catch {}
    })
  })

  async function openSettingsBadgeTab(page: Page) {
    // Senza goto: le navigazioni rieseguono gli init script e resettano il tema.
    await page.getByRole("button", { name: /Impostazioni/i }).click()
    await page.getByRole("tab", { name: "Badge", exact: true }).click()
    const controls = page.getByTestId("settings-controls").filter({ visible: true })
    await expect(controls).toBeVisible()
    return controls
  }

  async function openGenreGrid(page: Page) {
    await page.goto("/")
    return openSettingsBadgeTab(page)
  }

  async function readVetro(page: Page, controls: Locator) {
    // Griglia genere (la sezione ranking ha anch'essa un'opzione Vetro).
    const genreSection = controls.getByText("Stile badge", { exact: true }).locator("..")
    const btn = genreSection.getByRole("button", { name: /Vetro/ })
    await expect(btn).toBeVisible()
    const wrap = btn.locator(".badge-style-preview")
    const icon = wrap.locator("span").last()
    return {
      btn,
      theme: await page.locator("html").getAttribute("data-theme"),
      classes: await page.locator("html").getAttribute("class"),
      iconColor: await icon.evaluate((el: HTMLElement) => getComputedStyle(el).color),
      iconBg: await icon.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor),
      wrapBg: await wrap.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor),
      pressed: await btn.getAttribute("aria-pressed"),
    }
  }

  test("light: wrapper scuro dietro icona vetro (selezionata e no), repeat stabile", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("pictorium_ui_theme", "light") } catch {}
    })
    const controls = await openGenreGrid(page)
    let s = await readVetro(page, controls)
    expect(s.theme).toBe("light")
    expect(s.iconColor).toBe("rgb(255, 255, 255)")
    expect(s.wrapBg).toBe("rgb(37, 35, 33)")
    await s.btn.screenshot({ path: "test-results/vetro-light-unselected.png", animations: "disabled" })

    await s.btn.click()
    s = await readVetro(page, controls)
    expect(s.iconColor).toBe("rgb(255, 255, 255)")
    expect(s.wrapBg).toBe("rgb(37, 35, 33)")
    await s.btn.screenshot({ path: "test-results/vetro-light-selected.png", animations: "disabled" })

    // Repeat: dark e di nuovo light via toggle UI reale (stati di mount diversi).
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Tema", exact: true }).click()
    await page.getByRole("radio", { name: "Scuro", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    const controls2 = await openSettingsBadgeTab(page)
    const d = await readVetro(page, controls2)
    expect(d.theme).toBe("dark")
    expect(d.iconColor).toBe("rgb(255, 255, 255)")
    await d.btn.screenshot({ path: "test-results/vetro-dark.png", animations: "disabled" })

    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Tema", exact: true }).click()
    await page.getByRole("radio", { name: "Chiaro", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
    const controls3 = await openSettingsBadgeTab(page)
    const s2 = await readVetro(page, controls3)
    expect(s2.theme).toBe("light")
    expect(s2.iconColor).toBe("rgb(255, 255, 255)")
    expect(s2.wrapBg).toBe("rgb(37, 35, 33)")
    await s2.btn.screenshot({ path: "test-results/vetro-light-repeat.png", animations: "disabled" })
  })

  async function vetroTile(controls: Locator) {
    const genreSection = controls.getByText("Stile badge", { exact: true }).locator("..")
    const btn = genreSection.getByRole("button", { name: /Vetro/ })
    await expect(btn).toBeVisible()
    return { btn, wrap: btn.locator(".badge-style-preview") }
  }

  async function readTile(btn: Locator) {
    const wrap = btn.locator(".badge-style-preview")
    const icon = wrap.locator("span").last()
    return {
      btnBg: await btn.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor),
      btnColor: await btn.evaluate((el: HTMLElement) => getComputedStyle(el).color),
      btnClass: (await btn.getAttribute("class")) ?? "",
      wrapBg: await wrap.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor),
      iconColor: await icon.evaluate((el: HTMLElement) => getComputedStyle(el).color),
      iconBg: await icon.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor),
    }
  }

  test("hover/focus: anteprima vetro stabile in light (selected/unselected), dark invariato", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("pictorium_ui_theme", "light") } catch {}
    })
    const controls = await openGenreGrid(page)
    const { btn } = await vetroTile(controls)

    // Stato unselected garantito (senza dipendere dalle traduzioni dei nomi).
    if ((await btn.getAttribute("class"))?.includes("bg-accent-orange")) {
      const section = controls.getByText("Stile badge", { exact: true }).locator("..")
      await section.getByRole("button").first().click()
    }
    let s = await readTile(btn)
    expect(s.btnClass).not.toContain("bg-accent-orange")

    // Hover reale su tile NON selezionato: pill scura + Aa bianca, tile taupe.
    await btn.hover()
    await page.waitForTimeout(250)
    s = await readTile(btn)
    expect(s.wrapBg).toBe("rgb(37, 35, 33)")
    expect(s.iconColor).toBe("rgb(255, 255, 255)")
    expect(s.btnBg).toBe("rgba(112, 104, 95, 0.05)")
    await btn.screenshot({ path: "test-results/vetro-hover-light-unselected.png", animations: "disabled" })

    // Hover su tile selezionato: accento invariato, preview invariata.
    await btn.click()
    s = await readTile(btn)
    expect(s.btnClass).toContain("bg-accent-orange")
    await page.mouse.move(5, 5)
    await btn.hover()
    await page.waitForTimeout(250)
    s = await readTile(btn)
    expect(s.wrapBg).toBe("rgb(37, 35, 33)")
    expect(s.iconColor).toBe("rgb(255, 255, 255)")
    expect(s.btnClass).toContain("bg-accent-orange")
    expect(s.btnColor).toBe("rgb(201, 79, 36)")
    await btn.screenshot({ path: "test-results/vetro-hover-light-selected.png", animations: "disabled" })

    // Focus tastiera (stesso selettore): nessun flash, preview invariata.
    await page.mouse.move(5, 5)
    await btn.focus()
    await page.waitForTimeout(250)
    s = await readTile(btn)
    expect(s.wrapBg).toBe("rgb(37, 35, 33)")
    expect(s.iconColor).toBe("rgb(255, 255, 255)")
    await btn.screenshot({ path: "test-results/vetro-focus-light-selected.png", animations: "disabled" })

    // Stato divergente classe-sola + hover: tile resta taupe (mai quasi-bianco).
    await page.evaluate(() => {
      document.documentElement.removeAttribute("data-theme")
      document.documentElement.classList.add("light")
      document.documentElement.classList.remove("dark")
    })
    await page.mouse.move(5, 5)
    // Tile selezionato escluso dal pin hover: resta accento arancio.
    await btn.hover()
    await page.waitForTimeout(250)
    s = await readTile(btn)
    expect(s.btnClass).toContain("bg-accent-orange")
    expect(s.wrapBg).toBe("rgb(37, 35, 33)")
    expect(s.iconColor).toBe("rgb(255, 255, 255)")
    // Deseleziona e ripeti hover: qui il pin taupe agisce (pre-fix: flash
    // quasi-bianco oklab(0.99/0.06 da hover:bg-white/10 senza override light).
    const section = controls.getByText("Stile badge", { exact: true }).locator("..")
    await section.getByRole("button").first().click()
    s = await readTile(btn)
    expect(s.btnClass).not.toContain("bg-accent-orange")
    await btn.hover()
    await page.waitForTimeout(250)
    s = await readTile(btn)
    expect(s.wrapBg).toBe("rgb(37, 35, 33)")
    expect(s.iconColor).toBe("rgb(255, 255, 255)")
    expect(s.btnBg).toMatch(/112,\s*104,\s*95/)
    await btn.screenshot({ path: "test-results/vetro-hover-light-classonly.png", animations: "disabled" })

    // Dark via toggle UI reale: hover non altera wrapper/icona.
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Tema", exact: true }).click()
    await page.getByRole("radio", { name: "Scuro", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
    const controlsDark = await openSettingsBadgeTab(page)
    const dark = await vetroTile(controlsDark)
    const before = await readTile(dark.btn)
    expect(before.iconColor).toBe("rgb(255, 255, 255)")
    await dark.btn.hover()
    await page.waitForTimeout(250)
    const after = await readTile(dark.btn)
    expect(after.iconColor).toBe("rgb(255, 255, 255)")
    expect(after.wrapBg).toBe(before.wrapBg)
    expect(after.iconBg).toBe(before.iconBg)
    await dark.btn.screenshot({ path: "test-results/vetro-hover-dark.png", animations: "disabled" })
  })

  test("hardening: light con sola classe (senza attributo data-theme) resta leggibile", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("pictorium_ui_theme", "light") } catch {}
    })
    await page.goto("/")
    // Stato divergente: variabili light via classe `light`, ma i selettori
    // [data-theme="light"] non matchano (ex hydration/async race) → prima
    // del fix qui l'icona vetro era Aa bianco su fondo chiaro.
    await page.evaluate(() => {
      document.documentElement.removeAttribute("data-theme")
      document.documentElement.classList.add("light")
      document.documentElement.classList.remove("dark")
    })
    const controls = await openSettingsBadgeTab(page)
    const genreSection = controls.getByText("Stile badge", { exact: true }).locator("..")
    const btn = genreSection.getByRole("button", { name: /Vetro/ })
    await expect(btn).toBeVisible()
    const wrap = btn.locator(".badge-style-preview")
    const icon = wrap.locator("span").last()
    expect(await icon.evaluate((el: HTMLElement) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)")
    expect(await wrap.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor)).toBe("rgb(37, 35, 33)")
    await btn.screenshot({ path: "test-results/vetro-light-classonly.png", animations: "disabled" })
  })
})
