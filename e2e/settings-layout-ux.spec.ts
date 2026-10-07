import { test, expect, type Locator, type Page } from "@playwright/test"
import { putDefaultsWithRetry } from "./defaults-retry"

// Settings layout UX acceptance (T1-T4, runtime only — no snapshots here):
// responsive grid (portrait/landscape, no overflow), stable tab header slot,
// mobile preview collapse, badge macro-groups, footer Fine + retry.
// Deterministic: factory defaults per test + restore, mock server, no keys.

const DEMO_PROFILE = "e2e-settings-layout"

const FACTORY_SETUP = {
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  extraBadgeStyle: null,
  badgeFont: "inter",
  qualityBadgeStyle: "standard",
  videoFormats: null,
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  tintStrength: 20,
  topShade: 50,
  gradientHeight: 30,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  separateBadgeScale: 130,
  separateBadgeOffsetX: 0,
  separateBadgeOffsetY: 0,
  networkLogoScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeOffsetX: -10,
  qualityBadgeOffsetY: 15,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
  globalBadges: true,
  rankingBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  badgeQuality: true,
  customRatings: true,
  customRatingEndpoint: "",
  customRatingApiKeyHeader: "",
  ratingSources: ["imdb", "tmdb"],
  separateRatings: false,
  separateRatingsStyle: "column",
  sashOrder: ["upcoming", "rank", "new", "award", "extra"],
  networkLogo: true,
  networkLogoPosition: "auto",
  preRelease: false,
  ribbonSide: "left",
  ribbonEnabled: true,
  posterShape: "poster",
  region: "IT",
  dateFormat: "locale",
  episodeMetadataSource: "tmdb",
  logoAlign: null,
  logoScale: null,
  logoOffsetX: null,
  logoOffsetY: null,
  defaultAutoRotateBackdrop: false,
  defaultLandscapeFitEnabled: true,
  defaultPortraitFitEnabled: true,
  disableCleanPosters: false,
  landscape: {
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
  },
}

async function seed(page: Page, lang: string) {
  await page.addInitScript(
    ({ l, p }: { l: string; p: string }) => {
      try {
        localStorage.clear()
        localStorage.setItem("pictorium_profile_id", p)
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", l)
        localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
      } catch {}
    },
    { l: lang, p: DEMO_PROFILE },
  )
}

async function putFactory(page: Page) {
  // Single boot: the first goto provides the fetch origin; the trailing
  // reload is dropped (the test navigates right after). Each navigation
  // boots ~11 GETs into the shared `defaults` bucket (30 burst, 3/sec
  // refill), so redundant boots trip 429s across the serial file run.
  // The PUT itself retries a legitimate 429 via the shared helper.
  await page.goto("/")
  await putDefaultsWithRetry(page, "setup defaults", FACTORY_SETUP)
}

async function getDefaults(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const r = await fetch("/api/defaults")
    if (!r.ok) throw new Error(`get defaults: ${r.status}`)
    return (await r.json()) as Record<string, unknown>
  })
}

test.beforeEach(async ({ page }) => {
  await putFactory(page)
})

// Set by tests whose UI writes non-factory server state (autosaved
// switches); read-only tests skip the restore below entirely (canonical
// badge-format-defaults pattern: zero requests keeps the shared `defaults`
// bucket under its 30-burst limit across the serial run).
let defaultsDirty = false

test.afterEach(async ({ page }) => {
  if (!defaultsDirty) return
  defaultsDirty = false
  // Settle trailing debounced UI autosaves (500ms debounce in useDefaults)
  // so they land BEFORE the restore PUT, never after it.
  await page.waitForTimeout(1200)
  await page.goto("/")
  await putDefaultsWithRetry(page, "restore defaults", FACTORY_SETUP)
  const got = await getDefaults(page)
  expect(got).toMatchObject(FACTORY_SETUP)
})

async function openSettings(page: Page, dialogName: RegExp): Promise<Locator> {
  // Proven pattern (settings-keyboard): single click, no open/close loop.
  await page
    .getByRole("button", { name: /Configura tutti i poster|Tutti i poster|Impostazioni|Configure all posters|All posters|Settings/i })
    .filter({ visible: true })
    .click({ timeout: 15_000 })
  const dialog = page.getByRole("dialog", { name: dialogName }).filter({ visible: true })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  return dialog
}

async function waitPreview(dialog: Locator) {
  const image = dialog.getByAltText("Avatar").first()
  await expect(image).toBeVisible({ timeout: 45_000 })
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 45_000 })
    .toBeGreaterThan(0)
}

async function setTab(dialog: Locator, name: string, mobile: boolean) {
  if (mobile) {
    await dialog.locator("#mobile-settings-category").selectOption(name)
  } else {
    await dialog.getByRole("tab", { name, exact: true }).click()
  }
  await settleTabSwitch(dialog)
}

async function settleTabSwitch(dialog: Locator) {
  await dialog.page().waitForTimeout(400)
}

async function openMobilePanel(page: Page): Promise<Locator> {
  const panel = page.locator(".settings-panel:visible").first()
  await page
    .getByRole("button", { name: /Impostazioni/i })
    .filter({ visible: true })
    .click({ timeout: 15_000 })
  await expect(panel).toBeVisible({ timeout: 15_000 })
  return panel
}

async function slotBox(dialog: Locator) {
  const slot = dialog.getByTestId("settings-tab-header-slot")
  await expect(slot).toBeVisible()
  const box = await slot.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

async function expectNoOverflow(page: Page, dialog: Locator) {
  const controls = dialog.getByTestId("settings-controls")
  const flat = await controls.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  expect(flat).toBe(true)
  const box = await dialog.boundingBox()
  const vp = page.viewportSize()
  expect(box).not.toBeNull()
  expect(vp).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.y).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 1)
  expect(box!.x + box!.width).toBeGreaterThan(0)
}

test.describe("desktop layout + header slot", () => {
  test("1280px IT: no overflow on every tab, coherent header slot", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const dialog = await openSettings(page, /Configura tutti i poster/i)
    await waitPreview(dialog)
    const shapes: Array<{ top: number; height: number }> = []
    for (const tab of ["Badge", "Trasforma", "Preferenze", "Dati & Cache"]) {
      await setTab(dialog, tab, false)
      await expectNoOverflow(page, dialog)
      const b = await slotBox(dialog)
      shapes.push({ top: b.y, height: b.height })
    }
    // Same slot position across visual and non-visual tabs…
    for (const s of shapes) {
      expect(Math.abs(s.top - shapes[0].top)).toBeLessThanOrEqual(4)
    }
    // …and comparable height (shared min-height floor, no collapse jump).
    for (const s of shapes) {
      expect(Math.abs(s.height - shapes[0].height)).toBeLessThanOrEqual(16)
    }
    await page.screenshot({ path: "artifacts/settings-layout-1280-badge.png" })
  })

  test("1280px landscape preview column is wider than portrait (>=300px)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const dialog = await openSettings(page, /Configura tutti i poster/i)
    await waitPreview(dialog)
    const previewCol = dialog.getByTestId("settings-preview")
    await expect(previewCol).toBeVisible()
    const portraitW = (await previewCol.boundingBox())!.width
    const formatTarget = dialog.getByTestId("format-target-selector")
    await formatTarget.getByText("Orizzontale", { exact: true }).click()
    await page.waitForTimeout(400)
    await expectNoOverflow(page, dialog)
    const landscapeW = (await previewCol.boundingBox())!.width
    expect(landscapeW).toBeGreaterThan(portraitW)
    expect(landscapeW).toBeGreaterThanOrEqual(300)
    await formatTarget.getByText("Verticale", { exact: true }).click()
    await page.waitForTimeout(400)
    const backW = (await previewCol.boundingBox())!.width
    expect(Math.abs(backW - portraitW)).toBeLessThanOrEqual(2)
  })

  test("1024px and 768px: no overflow portrait/landscape, coherent slot", async ({ page }) => {
    for (const width of [1024, 768]) {
      await page.setViewportSize({ width, height: 900 })
      await seed(page, "it")
      await page.goto("/")
      await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
      const dialog = await openSettings(page, /Configura tutti i poster/i)
      await waitPreview(dialog)
      const formatTarget = dialog.getByTestId("format-target-selector")
      const badgeBox = await slotBox(dialog)
      await expectNoOverflow(page, dialog)
      await formatTarget.getByText("Orizzontale", { exact: true }).click()
      await page.waitForTimeout(400)
      await expectNoOverflow(page, dialog)
      const landBox = await slotBox(dialog)
      expect(Math.abs(landBox.height - badgeBox.height)).toBeLessThanOrEqual(16)
      await setTab(dialog, "Preferenze", false)
      await expectNoOverflow(page, dialog)
      const prefsBox = await slotBox(dialog)
      expect(Math.abs(prefsBox.height - badgeBox.height)).toBeLessThanOrEqual(16)
      await dialog.getByRole("button", { name: "Fine", exact: true }).click()
      await expect(dialog).toBeHidden()
    }
  })

  test("1280px EN: coherent slot + Done primary", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seed(page, "en")
    await page.goto("/")
    await expect(page.getByPlaceholder(/search/i)).toBeVisible({ timeout: 30_000 })
    const dialog = await openSettings(page, /Configure all posters/i)
    await waitPreview(dialog)
    const shapes: Array<{ top: number; height: number }> = []
    for (const tab of ["Badge", "Transform", "Preferences", "Data & Cache"]) {
      await setTab(dialog, tab, false)
      await expectNoOverflow(page, dialog)
      const b = await slotBox(dialog)
      shapes.push({ top: b.y, height: b.height })
    }
    for (const s of shapes) {
      expect(Math.abs(s.top - shapes[0].top)).toBeLessThanOrEqual(4)
      expect(Math.abs(s.height - shapes[0].height)).toBeLessThanOrEqual(16)
    }
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible()
    // Back to Badge: the loop ends on Data & Cache, but the macro-group
    // toggle below lives on the Badge tab.
    await setTab(dialog, "Badge", false)
    // Macro-group headers stay reachable; collapsed bodies hide, toggles don't.
    const overlayToggle = dialog.getByTestId("badge-group-overlay-toggle")
    await expect(overlayToggle).toBeVisible()
    await expect(overlayToggle).toHaveAttribute("aria-expanded", "false")
  })
})

test.describe("mobile collapse + groups + footer", () => {
  test("390x844 IT: collapse frees controls space, hidden body, no extra fetch", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const panel = await openMobilePanel(page)
    await waitPreview(panel)
    // Slot coherence mobile: Badge vs Preferenze.
    const badgeBox = await slotBox(panel)
    await panel.locator("#mobile-settings-category").selectOption("prefs")
    await page.waitForTimeout(400)
    const prefsBox = await slotBox(panel)
    expect(Math.abs(prefsBox.height - badgeBox.height)).toBeLessThanOrEqual(16)
    await panel.locator("#mobile-settings-category").selectOption("badge")
    await waitPreview(panel)
    // Let the remounted preview + any debounce settle before counting.
    await page.waitForTimeout(1500)

    const controls = panel.getByTestId("settings-controls")
    const before = (await controls.boundingBox())!.height
    const toggle = panel.getByTestId("defaults-preview-collapse")
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    const bodyId = await toggle.getAttribute("aria-controls")
    expect(bodyId).toBeTruthy()
    const body = panel.locator(`div[id="${bodyId}"]`)

    // No extra traffic from collapsing alone: snapshot request counts first.
    const posterUrls: string[] = []
    const putUrls: string[] = []
    page.on("request", (req) => {
      if (req.url().includes("/api/poster/")) posterUrls.push(req.url())
      if (req.method() === "PUT" && req.url().includes("/api/defaults")) putUrls.push(req.url())
    })
    const postersBefore = posterUrls.length
    const putsBefore = putUrls.length
    await toggle.click()
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(body).toBeHidden()
    const after = (await controls.boundingBox())!.height
    expect(after - before).toBeGreaterThanOrEqual(100)
    // Hidden body keeps no focus: Tab from the toggle leaves the subtree.
    await toggle.focus()
    await page.keyboard.press("Tab")
    const outside = await page.evaluate((id) => {
      const b = document.getElementById(id as string)
      return !!b && !b.contains(document.activeElement)
    }, bodyId)
    expect(outside).toBe(true)
    await page.waitForTimeout(1800)
    expect(posterUrls.length).toBe(postersBefore)
    expect(putUrls.length).toBe(putsBefore)
    // Keyboard toggle re-expands (Enter on the focused button).
    await toggle.focus()
    await page.keyboard.press("Enter")
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await expect(body).toBeVisible()
    await page.screenshot({ path: "artifacts/settings-layout-390-collapsed.png" })
  })

  test("390x700: no overflow, footer reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const panel = await openMobilePanel(page)
    await waitPreview(panel)
    await expectNoOverflow(page, panel)
    await panel.getByTestId("defaults-preview-collapse").click()
    await page.waitForTimeout(400)
    await expectNoOverflow(page, panel)
    await expect(panel.getByRole("button", { name: "Fine", exact: true })).toBeVisible()
  })

  test("macro-groups: real switches portrait + landscape write isolated profiles", async ({ page }) => {
    // This test writes non-factory server state (autosaved switches).
    defaultsDirty = true
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const panel = await openMobilePanel(page)
    await waitPreview(panel)
    // Overlay group starts collapsed with an accessible toggle.
    const overlayToggle = panel.getByTestId("badge-group-overlay-toggle")
    await expect(overlayToggle).toHaveAttribute("aria-expanded", "false")
    await overlayToggle.click()
    await expect(overlayToggle).toHaveAttribute("aria-expanded", "true")
    // Real portrait switch: rank bucket off writes the flat sash.
    // 500ms poll interval (canonical badge-format pattern): the condition
    // follows a debounced server autosave, and tight polling trips the
    // shared defaults rate limiter (30 burst, 3/sec refill).
    await panel.getByRole("switch", { name: "Classifiche" }).click()
    await expect
      .poll(async () => (await getDefaults(page)).sashOrder, { timeout: 15_000, intervals: [500] })
      .not.toContain("rank")
    await panel.getByRole("switch", { name: "Classifiche" }).click()
    await expect
      .poll(async () => (await getDefaults(page)).sashOrder, { timeout: 15_000, intervals: [500] })
      .toContain("rank")
    // Landscape target: quality toggle writes the landscape profile only.
    await panel.getByTestId("format-target-selector").getByText("Orizzontale", { exact: true }).click()
    await panel.getByTestId("badge-group-quality-toggle").click()
    await panel.getByRole("switch", { name: "Qualità streaming" }).click()
    await expect
      .poll(
        async () => ((await getDefaults(page)).landscape as Record<string, unknown> | undefined)?.badgeQuality,
        // 500ms poll interval (see above): tight polling trips the limiter.
        { timeout: 15_000, intervals: [500] },
      )
      .toBe(false)
    const d = await getDefaults(page)
    expect(d.badgeQuality).toBe(true)
  })

  test("footer retry recovers a failed PUT (single-instance namespace)", async ({ page }) => {
    // This test writes non-factory server state (switch + retry PUTs).
    defaultsDirty = true
    await page.setViewportSize({ width: 1280, height: 900 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const putUrls: string[] = []
    let failOnce = true
    await page.route("**/api/defaults", async (route) => {
      const req = route.request()
      if (req.method() === "PUT") putUrls.push(req.url())
      if (req.method() === "PUT" && failOnce) {
        failOnce = false
        await route.fulfill({ status: 500, body: "boom" })
        return
      }
      await route.continue()
    })
    const dialog = await openSettings(page, /Configura tutti i poster/i)
    await waitPreview(dialog)
    // No PUT without edits; the single-instance namespace carries no ?u=.
    await dialog.getByTestId("badge-group-overlay-toggle").click()
    await dialog.getByRole("switch", { name: "Classifiche" }).click()
    const retry = dialog.getByRole("button", { name: "Riprova", exact: true })
    await expect(retry).toBeVisible({ timeout: 15_000 })
    await retry.click()
    await expect(dialog.getByTestId("defaults-sync-status")).toContainText(/Sincronizzato/i, {
      timeout: 15_000,
    })
    await expect(retry).toBeHidden()
    expect(putUrls.length).toBeGreaterThanOrEqual(2)
    for (const u of putUrls) expect(u).not.toContain("u=")
    // Fine primary closes the dialog.
    await dialog.getByRole("button", { name: "Fine", exact: true }).click()
    await expect(dialog).toBeHidden()
  })
})
