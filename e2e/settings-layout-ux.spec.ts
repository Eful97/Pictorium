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

async function seed(page: Page, lang: string, theme: "dark" | "light" = "dark") {
  await page.addInitScript(
    ({ l, p, th }: { l: string; p: string; th: string }) => {
      try {
        localStorage.clear()
        localStorage.setItem("pictorium_profile_id", p)
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", l)
        localStorage.setItem("pictorium_ui_theme", th)
        localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
      } catch {}
    },
    { l: lang, p: DEMO_PROFILE, th: theme },
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
  } else if (name === "Preferenze" || name === "Preferences" || name === "Dati & Cache" || name === "Data & Cache") {
    // Secondary nav: compact aria-pressed buttons, never role=tab.
    await dialog.getByRole("button", { name, exact: true }).click()
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
      await dialog.getByRole("button", { name: "Chiudi", exact: true }).click()
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
    await expect(dialog.getByRole("button", { name: "Save changes", exact: true })).toBeVisible()
    // Back to Rankings: the loop ends on Data & Cache, but the overlay
    // macro-group lives on the Rankings tab.
    await setTab(dialog, "Rankings", false)
    // Macro-groups are always open in settings (bare sections, no disclosure
    // toggle): the overlay group stays reachable.
    await expect(dialog.getByTestId("badge-group-overlay").filter({ visible: true })).toBeVisible()
  })
})

test.describe("mobile collapse + groups + footer", () => {
  // Floating-overlay geometry: the real mini poster stays fully inside the
  // allowed body area (below the format selector, above the footer), inside
  // the viewport, and never overlapping the Save button.
  async function expectFloatContained(panel: Locator, page: Page) {
    const float = panel.getByTestId("settings-preview")
    const media = panel.getByTestId("defaults-preview-media")
    const format = panel.getByTestId("format-target-selector")
    const footer = panel.locator(".settings-dialog-footer")
    const save = panel.getByTestId("settings-save")
    const vp = page.viewportSize()!
    const floatBox = (await float.boundingBox())!
    const mediaBox = (await media.boundingBox())!
    const formatBox = (await format.boundingBox())!
    const footerBox = (await footer.boundingBox())!
    const saveBox = (await save.boundingBox())!
    // Mini poster fully below the format selector and above the footer…
    expect(mediaBox.y).toBeGreaterThanOrEqual(formatBox.y + formatBox.height - 1)
    expect(mediaBox.y + mediaBox.height).toBeLessThanOrEqual(footerBox.y + 1)
    // …fully inside the viewport and inside its own float card…
    expect(mediaBox.x).toBeGreaterThanOrEqual(0)
    expect(mediaBox.x + mediaBox.width).toBeLessThanOrEqual(vp.width + 1)
    expect(mediaBox.y).toBeGreaterThanOrEqual(0)
    expect(mediaBox.y + mediaBox.height).toBeLessThanOrEqual(vp.height + 1)
    expect(mediaBox.x).toBeGreaterThanOrEqual(floatBox.x - 1)
    expect(mediaBox.x + mediaBox.width).toBeLessThanOrEqual(floatBox.x + floatBox.width + 1)
    // …and the whole float (card + toolbar) above the footer, off the Save.
    expect(floatBox.y).toBeGreaterThanOrEqual(0)
    expect(floatBox.y + floatBox.height).toBeLessThanOrEqual(footerBox.y + 1)
    const overlapsSave = !(
      floatBox.x + floatBox.width <= saveBox.x ||
      saveBox.x + saveBox.width <= floatBox.x ||
      floatBox.y + floatBox.height <= saveBox.y ||
      saveBox.y + saveBox.height <= floatBox.y
    )
    expect(overlapsSave).toBe(false)
  }

  test("390x844 IT: minimize shrinks the float, controls keep full height, no extra fetch", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const panel = await openMobilePanel(page)
    await waitPreview(panel)
    // Slot coherence mobile: Badge vs Preferenze. Mobile keeps a wider bound
    // than the desktop-canonical 16px (desktop tests unchanged): the format
    // slot carries 44px touch buttons (explicit target requirement) while
    // the secondary slot is a text title — structurally ~18px apart. The
    // bound still guards "no jump" on tab switches.
    const badgeBox = await slotBox(panel)
    await panel.locator("#mobile-settings-category").selectOption("prefs")
    await page.waitForTimeout(400)
    const prefsBox = await slotBox(panel)
    expect(Math.abs(prefsBox.height - badgeBox.height)).toBeLessThanOrEqual(24)
    await panel.locator("#mobile-settings-category").selectOption("badge")
    await waitPreview(panel)
    // Let the remounted preview + any debounce settle before counting.
    await page.waitForTimeout(1500)

    const controls = panel.getByTestId("settings-controls")
    const before = (await controls.boundingBox())!.height
    // The overlay consumes no layout: controls already own the full body.
    expect(before).toBeGreaterThanOrEqual(200)
    await expectFloatContained(panel, page)
    const float = panel.getByTestId("settings-preview")
    const floatBefore = (await float.boundingBox())!
    const minimize = panel.getByTestId("floating-preview-minimize")
    const cornerBtn = panel.getByTestId("floating-preview-corner")
    await expect(minimize).toBeVisible()
    await expect(cornerBtn).toBeVisible()

    // No extra traffic from minimizing alone: snapshot request counts first.
    const posterUrls: string[] = []
    const putUrls: string[] = []
    page.on("request", (req) => {
      if (req.url().includes("/api/poster/")) posterUrls.push(req.url())
      if (req.method() === "PUT" && req.url().includes("/api/defaults")) putUrls.push(req.url())
    })
    const postersBefore = posterUrls.length
    const putsBefore = putUrls.length
    await minimize.click()
    await expect(panel.getByTestId("defaults-preview-media")).toBeHidden()
    await expect(panel.getByTestId("floating-preview-restore")).toBeVisible()
    const floatAfter = (await float.boundingBox())!
    // Minimized footprint is toolbar-only (much smaller)…
    expect(floatAfter.height).toBeLessThan(floatBefore.height - 40)
    const after = (await controls.boundingBox())!.height
    // …while the controls keep their full height (overlay never owned it).
    expect(Math.abs(after - before)).toBeLessThanOrEqual(4)
    // Hidden preview keeps no focus: Tab from the corner button leaves the float.
    await cornerBtn.focus()
    await page.keyboard.press("Tab")
    const outside = await page.evaluate(() => {
      const f = document.querySelector('[data-testid="settings-preview"]')
      return !!f && !f.contains(document.activeElement)
    })
    expect(outside).toBe(true)
    await page.waitForTimeout(1800)
    expect(posterUrls.length).toBe(postersBefore)
    expect(putUrls.length).toBe(putsBefore)
    // Keyboard restore re-expands (Enter on the focused button), same owner.
    const restore = panel.getByTestId("floating-preview-restore")
    await restore.focus()
    await page.keyboard.press("Enter")
    await expect(panel.getByTestId("defaults-preview-media")).toBeVisible()
    await expect(panel.getByTestId("defaults-preview-media")).toHaveCount(1)
    await expectFloatContained(panel, page)
    await page.screenshot({ path: "artifacts/settings-mobile-float-390x844-dark.png" })
  })

  test("390x700: no overflow, footer reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const panel = await openMobilePanel(page)
    await waitPreview(panel)
    await expectNoOverflow(page, panel)
    await expectFloatContained(panel, page)
    await panel.getByTestId("floating-preview-minimize").click()
    await page.waitForTimeout(400)
    await expectNoOverflow(page, panel)
    await expect(panel.getByTestId("floating-preview-restore")).toBeVisible()
    // Mobile footer contract (staged-session era: no Done button): the
    // global Save + sync status stay visible and reachable.
    await expect(panel.getByTestId("settings-save")).toBeVisible()
    await expect(panel.getByTestId("settings-save-status")).toBeVisible()
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
    // Overlay macro-group is always open in settings (bare section, no
    // disclosure toggle) and its rank switch stages the draft only. The
    // group copies in inactive tabs stay hidden: navigate first.
    await panel.locator("#mobile-settings-category").selectOption("rankings")
    await waitPreview(panel)
    await expect(panel.getByTestId("badge-group-overlay").filter({ visible: true })).toBeVisible()
    // Real portrait switch: rank bucket off stages the flat sash.
    // 500ms poll interval (canonical badge-format pattern): the condition
    // follows the explicit Save PUT, and tight polling trips the
    // shared defaults rate limiter (30 burst, 3/sec refill).
    await panel.getByRole("switch", { name: "Classifiche" }).click()
    // Staged, not saved: the server still carries the rank bucket.
    expect((await getDefaults(page)).sashOrder).toContain("rank")
    await panel.getByTestId("settings-save").click()
    await expect
      .poll(async () => (await getDefaults(page)).sashOrder, { timeout: 15_000, intervals: [500] })
      .not.toContain("rank")
    await panel.getByRole("switch", { name: "Classifiche" }).click()
    await panel.getByTestId("settings-save").click()
    await expect
      .poll(async () => (await getDefaults(page)).sashOrder, { timeout: 15_000, intervals: [500] })
      .toContain("rank")
    // Landscape target: quality toggle (Informazioni tab) writes the
    // landscape profile only.
    await panel.getByTestId("format-target-selector").getByText("Orizzontale", { exact: true }).click()
    await panel.locator("#mobile-settings-category").selectOption("information")
    await expect(panel.getByTestId("badge-group-quality").filter({ visible: true })).toBeVisible()
    await panel.getByRole("switch", { name: "Qualità streaming" }).click()
    await panel.getByTestId("settings-save").click()
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

  // Matrix split: ten independent cases (was one 10-combo loop overrunning
  // the 60s test budget at the refill sleep with zero assertion failures).
  // Each case runs the full original scenario for its viewport/theme.
  const mobileFloatCombos: Array<{ width: number; height: number; theme: "dark" | "light" }> = []
  for (const width of [320, 360, 390, 430]) {
    mobileFloatCombos.push({ width, height: 568, theme: "dark" })
    mobileFloatCombos.push({ width, height: 568, theme: "light" })
  }
  mobileFloatCombos.push({ width: 390, height: 700, theme: "dark" })
  mobileFloatCombos.push({ width: 390, height: 700, theme: "light" })
  for (const { width, height, theme } of mobileFloatCombos) {
    test(`mobile floating preview: full poster in safe corners, tall controls (${width}x${height}, ${theme})`, async ({
      page,
    }) => {
      // Read-only geometry (no server writes): no defaultsDirty flag.
      // Track PUTs for this viewport/theme: this contract never stages a save.
      const putUrls: string[] = []
      page.on("request", (req) => {
        if (req.method() === "PUT" && req.url().includes("/api/defaults")) putUrls.push(req.url())
      })
      await page.setViewportSize({ width, height })
      await seed(page, "it", theme)
      await page.goto("/")
      await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
      const panel = await openMobilePanel(page)
      await waitPreview(panel)
      const float = panel.getByTestId("settings-preview")
      const controls = panel.getByTestId("settings-controls")
      const media = panel.getByTestId("defaults-preview-media")
      await expect(float).toBeVisible()
      // Default: floating overlay snapped top-right; single preview owner.
      await expect(float).toHaveAttribute("data-floating", "true")
      await expect(float).toHaveAttribute("data-corner", "tr")
      await expect(media).toHaveCount(1)
      // The overlay consumes no layout: controls own a materially taller
      // body than the old clipped strip ever left (~52px).
      const minUseful = height >= 700 ? 260 : 180
      const controlsBox = (await controls.boundingBox())!
      expect(controlsBox.height).toBeGreaterThanOrEqual(minUseful)
      // Portrait keeps the 2/3 ratio, fully visible in the safe area.
      const mediaBox = (await media.boundingBox())!
      expect(mediaBox.width).toBeGreaterThan(0)
      expect(mediaBox.height / mediaBox.width).toBeGreaterThan(1.3)
      expect(mediaBox.height / mediaBox.width).toBeLessThan(1.7)
      await expectFloatContained(panel, page)
      await expectNoOverflow(page, panel)
      // Save stays visible + reachable via the safe-area footer (mobile
      // footer contract: global Save + sync status, no Done button).
      await expect(panel.getByTestId("settings-save")).toBeVisible()
      await expect(panel.getByTestId("settings-save-status")).toBeVisible()
      // Landscape edit target: 16/9 bounds, same safe-area containment.
      await panel.getByTestId("format-target-selector").getByText("Orizzontale", { exact: true }).click()
      await page.waitForTimeout(400)
      const landBox = (await media.boundingBox())!
      expect(landBox.width / landBox.height).toBeGreaterThan(1.5)
      expect(landBox.width / landBox.height).toBeLessThan(1.9)
      await expectFloatContained(panel, page)
      await expectNoOverflow(page, panel)
      await expect(panel.getByTestId("settings-save")).toBeVisible()
      // Landscape zoom: the same overlay shows the true 16/9 image fully
      // contained, then closes without any PUT.
      await panel.getByTestId("defaults-preview-zoom-open").click()
      const landDialogs = page.getByRole("dialog")
      await expect(landDialogs).toHaveCount(2)
      const landZoom = page.locator('[role="dialog"][aria-labelledby="defaults-preview-zoom-title"]')
      await expect(landZoom).toBeVisible()
      const enlargedLand = landZoom.getByAltText("Avatar")
      await expect(enlargedLand).toHaveCount(1)
      await expect(enlargedLand).toBeVisible()
      // Decode wait (same pattern as waitPreview): visibility alone can pass
      // on the alt-text placeholder box before the blob decodes.
      await expect
        .poll(() => enlargedLand.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 45_000 })
        .toBeGreaterThan(0)
      const naturalLand = await enlargedLand.evaluate((el: HTMLImageElement) => ({
        w: el.naturalWidth, h: el.naturalHeight,
      }))
      expect(naturalLand.w).toBeGreaterThan(0)
      expect(naturalLand.w / naturalLand.h).toBeGreaterThan(1.5)
      expect(naturalLand.w / naturalLand.h).toBeLessThan(1.9)
      const enlargedLandBox = (await enlargedLand.boundingBox())!
      const vpLand = page.viewportSize()!
      expect(enlargedLandBox.x).toBeGreaterThanOrEqual(-1)
      expect(enlargedLandBox.x + enlargedLandBox.width).toBeLessThanOrEqual(vpLand.width + 1)
      expect(enlargedLandBox.y).toBeGreaterThanOrEqual(-1)
      expect(enlargedLandBox.y + enlargedLandBox.height).toBeLessThanOrEqual(vpLand.height + 1)
      await page.keyboard.press("Escape")
      await expect(landDialogs).toHaveCount(1)
      await expect(media).toBeVisible()
      await panel.getByTestId("format-target-selector").getByText("Verticale", { exact: true }).click()
      await page.waitForTimeout(400)
      // Pointer drag snaps to the nearest safe corner (bottom-left here),
      // staying contained and off the Save.
      const from = (await float.boundingBox())!
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(width / 4, height - 80, { steps: 10 })
      await page.mouse.up()
      await expect(float).toHaveAttribute("data-corner", "bl")
      await expectFloatContained(panel, page)
      // Scrolling the controls never moves the float (stays visible).
      const floatBeforeScroll = await float.boundingBox()
      await controls.evaluate((el) => { el.scrollTop = el.scrollHeight })
      await page.waitForTimeout(300)
      const floatAfterScroll = await float.boundingBox()
      expect(Math.abs(floatAfterScroll!.x - floatBeforeScroll!.x)).toBeLessThanOrEqual(2)
      expect(Math.abs(floatAfterScroll!.y - floatBeforeScroll!.y)).toBeLessThanOrEqual(2)
      // Keyboard corner cycle returns toward the top (bl -> tl).
      const cornerBtn = panel.getByTestId("floating-preview-corner")
      await cornerBtn.focus()
      await page.keyboard.press("Enter")
      await expect(float).toHaveAttribute("data-corner", "tl")
      await expectFloatContained(panel, page)
      // Tap the thumbnail: the large preview fits the viewport with the
      // full image ratio, then closes without any PUT.
      await panel.getByTestId("defaults-preview-zoom-open").click()
      const dialogs = page.getByRole("dialog")
      await expect(dialogs).toHaveCount(2)
      // Scope to the zoom overlay via its labelledby identity (the settings
      // shell uses settings-dialog-title): a page-wide nth() matches the
      // background home scroller's Avatar cards instead of the zoom image.
      const zoomDialog = page.locator('[role="dialog"][aria-labelledby="defaults-preview-zoom-title"]')
      await expect(zoomDialog).toBeVisible()
      const enlarged = zoomDialog.getByAltText("Avatar")
      await expect(enlarged).toHaveCount(1)
      await expect(enlarged).toBeVisible()
      // Decode wait (same pattern as waitPreview): visibility alone can pass
      // on the alt-text placeholder box before the blob decodes.
      await expect
        .poll(() => enlarged.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 45_000 })
        .toBeGreaterThan(0)
      const natural = await enlarged.evaluate((el: HTMLImageElement) => ({
        w: el.naturalWidth, h: el.naturalHeight,
      }))
      expect(natural.w).toBeGreaterThan(0)
      expect(natural.h / natural.w).toBeGreaterThan(1.3)
      expect(natural.h / natural.w).toBeLessThan(1.7)
      const enlargedBox = (await enlarged.boundingBox())!
      const vp = page.viewportSize()!
      expect(enlargedBox.x).toBeGreaterThanOrEqual(-1)
      expect(enlargedBox.x + enlargedBox.width).toBeLessThanOrEqual(vp.width + 1)
      expect(enlargedBox.y).toBeGreaterThanOrEqual(-1)
      expect(enlargedBox.y + enlargedBox.height).toBeLessThanOrEqual(vp.height + 1)
      await page.keyboard.press("Escape")
      await expect(dialogs).toHaveCount(1)
      await expect(media).toBeVisible()
      // Minimize then restore via pointer: same single owner throughout.
      await panel.getByTestId("floating-preview-minimize").click()
      await expect(media).toBeHidden()
      await panel.getByTestId("floating-preview-restore").click()
      await expect(media).toBeVisible()
      await expect(media).toHaveCount(1)
      await page.screenshot({ path: `artifacts/settings-mobile-float-${width}x${height}-${theme}.png` })
      // Clean session: the header back button closes with no guard dialog.
      await panel.getByRole("button", { name: "Indietro", exact: true }).click()
      await expect(panel).toBeHidden()
      // Refill window for the shared defaults bucket before the next boot.
      await page.waitForTimeout(1000)
      expect(putUrls).toEqual([])
    })
  }

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
    // The rank switch lives on the Classifiche tab (macro-groups are always
    // open in settings: no disclosure toggle). Staged-session era: the
    // footer Save is the only writer, and re-clicking it after a failure is
    // the retry (no separate Riprova button exists).
    await dialog.getByRole("tab", { name: "Classifiche", exact: true }).click()
    await dialog.getByRole("switch", { name: "Classifiche" }).click()
    const save = dialog.getByTestId("settings-save")
    await save.click()
    await expect(dialog.getByTestId("settings-save-status")).toContainText(/Errore nel salvataggio/i, {
      timeout: 15_000,
    })
    // The failed save toasts in-dialog; the error toast must stay real and
    // visible while the pointer retry below runs (a dismissed toast would
    // prove nothing about occlusion: the fault stays armed).
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({ timeout: 5_000 })
    // Pointer regression guard: the toast must never cover the footer Save.
    // elementFromPoint at the Save center must resolve to Save itself — with
    // the toast over the footer this resolves to the toast and the ordinary
    // click below is intercepted (fast RED, no click timeout burned).
    const hitSave = await save.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return !!hit && (hit === el || el.contains(hit))
    })
    expect(hitSave).toBe(true)
    // Ordinary pointer retry: a real mouse click on Save — no focus/Enter
    // workaround, no force, no JS dispatch.
    await save.click()
    await expect(dialog.getByTestId("settings-save-status")).toContainText(/Sincronizzato/i, {
      timeout: 15_000,
    })
    expect(putUrls.length).toBeGreaterThanOrEqual(2)
    for (const u of putUrls) expect(u).not.toContain("u=")
    // Release the owned 500 route before the shared afterEach restore PUT:
    // the restore must prove the server is clean, never inherit the mock.
    await page.unroute("**/api/defaults")
    // Chiudi closes the clean dialog.
    await dialog.getByRole("button", { name: "Chiudi", exact: true }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe("mobile toast header pointer", () => {
  test("per-title error then retry keeps mobile header Back/Save clickable while toast visible (390 + 768)", async ({
    page,
  }) => {
    // Every viewport under lg (1024px) shows the same sticky mobile header
    // (lg:hidden): the toast offset policy must clear it on phones and
    // tablets alike, while desktop >= 1024 keeps the 24px default.
    for (const vp of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await seed(page, "it")
      await page.goto("/")
      await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
      // Per-title editor context (mobile header owns Back + Save): same
      // search→select pattern as the editor button-interactions spec.
      const search = page.getByPlaceholder(/cerca/i)
      await search.fill("avatar")
      await search.press("Enter")
      await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
      await page.getByText(/Avatar/i).first().click()
      await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 15_000 })
      const header = page.locator(".sticky.top-0.z-30")
      const back = header.getByRole("button", { name: "Indietro", exact: true })
      const save = header.getByRole("button", { name: "Salva Poster", exact: true })
      await expect(back).toBeVisible()
      await expect(save).toBeVisible()
      // Error case: the first per-title POST fails (500), the retry passes.
      // saveConfig posts via http(), which transparently retries 5xx twice
      // (1s + 2s backoff): the first save burns three failed attempts, so
      // arm that many — a single failOnce would be absorbed by the retry.
      const postUrls: string[] = []
      let postCount = 0
      await page.route("**/api/mappings", async (route) => {
        const req = route.request()
        if (req.method() !== "POST") {
          await route.continue()
          return
        }
        postCount += 1
        postUrls.push(req.url())
        if (postCount <= 3) {
          await route.fulfill({ status: 500, body: "boom" })
          return
        }
        await route.continue()
      })
      try {
        await save.click()
        // First save burns the 1s + 2s http() 5xx backoff before surfacing.
        await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({ timeout: 15_000 })
        // Settle the entry slide before hit-testing: a mid-flight toast
        // would contaminate elementFromPoint. 600ms keeps ~2s+ of visibility.
        await page.waitForTimeout(600)
        // Pointer regression guard (mobile header): elementFromPoint at the
        // Back/Save centers must resolve to the buttons themselves while the
        // error toast is still visible — never to the toast overlay.
        const hitCenter = (el: Element) => {
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, hit: hit === el || el.contains(hit) }
        }
        const errProbe = {
          toastRect: await page.locator('[data-sonner-toast][data-type="error"]').evaluate((el) => {
            const r = el.getBoundingClientRect()
            return { x: r.x, y: r.y, w: r.width, h: r.height }
          }),
          headerRect: await header.evaluate((el) => {
            const r = el.getBoundingClientRect()
            return { x: r.x, y: r.y, w: r.width, h: r.height }
          }),
          back: await back.evaluate(hitCenter),
          save: await save.evaluate(hitCenter),
        }
        console.log(`mobile-toast-error-probe-${vp.width} ${JSON.stringify(errProbe)}`)
        expect(errProbe.back.hit).toBe(true)
        expect(errProbe.save.hit).toBe(true)
        // Ordinary pointer retry while the error toast is still visible: a
        // real mouse click on Save — no force, no keyboard workaround.
        await save.click()
        await expect(page.locator('[data-sonner-toast][data-type="success"]')).toBeVisible({ timeout: 15_000 })
        // Mobile/tablet success keeps the global top-center section: the
        // desktop bottom-right override must not leak below lg.
        await expect(page.locator('[data-sonner-toaster][data-x-position="center"][data-y-position="top"] [data-sonner-toast][data-type="success"]')).toBeVisible({ timeout: 5_000 })
        expect(await page.locator('[data-sonner-toaster][data-x-position="right"][data-y-position="bottom"] [data-sonner-toast][data-type="success"]').count()).toBe(0)
        // Settle the entry slide (see error probe above) before hit-testing.
        await page.waitForTimeout(600)
        // Steady-state probe: let the exiting error toast detach first —
        // its exit slide travels over the header and would contaminate the
        // hit-test. The success toast (2.5s) stays visible throughout.
        await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeHidden({ timeout: 5_000 })
        const okProbe = {
          toastRect: await page.locator('[data-sonner-toast][data-type="success"]').evaluate((el) => {
            const r = el.getBoundingClientRect()
            return { x: r.x, y: r.y, w: r.width, h: r.height }
          }),
          back: await back.evaluate(hitCenter),
          save: await save.evaluate(hitCenter),
        }
        console.log(`mobile-toast-success-probe-${vp.width} ${JSON.stringify(okProbe)}`)
        expect(okProbe.back.hit).toBe(true)
        expect(okProbe.save.hit).toBe(true)
        // Evidence while VISIBLE (not after dismiss): success toast under the
        // mobile header, top-center.
        await page.screenshot({ path: `test-results/mobile-${vp.width}-save-success.png` })
        // Ordinary Back click while the success toast is still visible closes
        // the editor (the click executes, not just hit-tests).
        await back.click()
        await expect(page.getByRole("heading", { name: "Anteprima" })).toBeHidden({ timeout: 15_000 })
        expect(postUrls.length).toBeGreaterThanOrEqual(2)
        for (const u of postUrls) expect(u).not.toContain("u=")
      } finally {
        await page.unroute("**/api/mappings")
        // Per-title mapping cleanup: the shared fixture id must not leak into
        // later specs (button-interactions mirrors this delete on exit).
        await page.evaluate(async () => {
          await fetch("/api/mappings/movie:19995", { method: "DELETE" }).catch(() => null)
        })
      }
      // Refill window for the shared defaults bucket before the next boot.
      await page.waitForTimeout(1000)
    }
  })

  test("700x900 IT: failed settings PUT keeps mobile panel Back/Save clickable while error toast visible", async ({
    page,
  }) => {
    // This test writes non-factory server state (switch + retry PUTs).
    defaultsDirty = true
    // 700px sits in the true tablet gap: the settings shell is still the
    // mobile panel (innerWidth < 768) while sonner's mobile offset stops at
    // 600px, so the toast uses the 24px desktop offset over the sticky
    // mobile header. (At 768 the shell is already the desktop dialog, which
    // has no mobile header — 700 is the representative tablet width here.)
    await page.setViewportSize({ width: 700, height: 900 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const panel = await openMobilePanel(page)
    await waitPreview(panel)
    // 700px shows the sm+ desktop tablist (sm:flex ≥ 640) inside the mobile
    // panel shell: reach Classifiche via role=tab, not the <640 select.
    await panel.getByRole("tab", { name: "Classifiche", exact: true }).click()
    await panel.getByRole("switch", { name: "Classifiche" }).click()
    // session.save posts via userFetch (no 5xx retry): one armed 500
    // surfaces the error toast, same as the desktop footer-retry test.
    let failOnce = true
    await page.route("**/api/defaults", async (route) => {
      const req = route.request()
      if (req.method() === "PUT" && failOnce) {
        failOnce = false
        await route.fulfill({ status: 500, body: "boom" })
        return
      }
      await route.continue()
    })
    try {
      const back = panel.getByRole("button", { name: "Indietro", exact: true })
      const save = panel.getByTestId("settings-save")
      await save.click()
      await expect(panel.getByTestId("settings-save-status")).toContainText(/Errore nel salvataggio/i, {
        timeout: 15_000,
      })
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({ timeout: 5_000 })
      // Settle the entry slide before hit-testing (see per-title test).
      await page.waitForTimeout(600)
      const hitCenter = (el: Element) => {
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, hit: hit === el || el.contains(hit) }
      }
      const errProbe = {
        toastRect: await page.locator('[data-sonner-toast][data-type="error"]').evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        }),
        back: await back.evaluate(hitCenter),
        save: await save.evaluate(hitCenter),
      }
      console.log(`settings-toast-error-probe-700 ${JSON.stringify(errProbe)}`)
      expect(errProbe.back.hit).toBe(true)
      expect(errProbe.save.hit).toBe(true)
      // Ordinary pointer retry while the error toast is still visible.
      await save.click()
      await expect(panel.getByTestId("settings-save-status")).toContainText(/Sincronizzato/i, {
        timeout: 15_000,
      })
      await expect(page.locator('[data-sonner-toast][data-type="success"]')).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(600)
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeHidden({ timeout: 5_000 })
      const okProbe = {
        toastRect: await page.locator('[data-sonner-toast][data-type="success"]').evaluate((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        }),
        back: await back.evaluate(hitCenter),
        save: await save.evaluate(hitCenter),
      }
      console.log(`settings-toast-success-probe-700 ${JSON.stringify(okProbe)}`)
      expect(okProbe.back.hit).toBe(true)
      expect(okProbe.save.hit).toBe(true)
      // Clean draft: Back closes the panel directly while the toast shows.
      await back.click()
      await expect(panel).toBeHidden({ timeout: 15_000 })
    } finally {
      await page.unroute("**/api/defaults")
    }
  })
})

test.describe("desktop save toast position", () => {
  test("1280 IT: per-title save success toasts bottom-right (real POST, ordinary click)", async ({
    page,
  }) => {
    // Desktop (>= lg, 1024px): the per-title save success toast renders in
    // sonner's bottom-right section, while errors and the global Toaster
    // stay top-center (settings footer retry guard unchanged).
    await page.setViewportSize({ width: 1280, height: 900 })
    await seed(page, "it")
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const search = page.getByPlaceholder(/cerca/i)
    await search.fill("avatar")
    await search.press("Enter")
    await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
    await page.getByText(/Avatar/i).first().click()
    await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 15_000 })
    // Desktop: the sticky mobile header is lg:hidden, so the preview-column
    // Save owns the write (visible filter, no force).
    const save = page.getByRole("button", { name: "Salva Poster", exact: true }).filter({ visible: true }).first()
    await expect(save).toBeVisible()
    const postUrls: string[] = []
    await page.route("**/api/mappings", async (route) => {
      if (route.request().method() === "POST") postUrls.push(route.request().url())
      await route.continue()
    })
    try {
      await save.click()
      const okToast = page.locator('[data-sonner-toaster][data-x-position="right"][data-y-position="bottom"] [data-sonner-toast][data-type="success"]')
      await expect(okToast).toBeVisible({ timeout: 15_000 })
      // Settle the entry slide before measuring (mirrors the mobile probes).
      await page.waitForTimeout(600)
      const probe = await okToast.evaluate((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      })
      const vp = page.viewportSize()!
      console.log(`desktop-save-toast-probe-1280 ${JSON.stringify({ probe, vp })}`)
      // Bottom-right: right edge near the viewport right, below mid-height.
      expect(probe.x).toBeGreaterThan(vp.width / 2)
      expect(probe.x + probe.w).toBeGreaterThan(vp.width - 80)
      expect(probe.y).toBeGreaterThan(vp.height / 2)
      expect(probe.y + probe.h).toBeGreaterThan(vp.height - 160)
      // No success toast leaks into the global top-center section on desktop.
      expect(await page.locator('[data-sonner-toaster][data-x-position="center"][data-y-position="top"] [data-sonner-toast][data-type="success"]').count()).toBe(0)
      // Evidence while VISIBLE (not after dismiss).
      await page.screenshot({ path: "test-results/desktop-1280-save-success.png" })
      expect(postUrls.length).toBeGreaterThanOrEqual(1)
      for (const u of postUrls) expect(u).not.toContain("u=")
    } finally {
      await page.unroute("**/api/mappings")
      // Per-title mapping cleanup: the shared fixture id must not leak into
      // later specs (mirrors the mobile per-title test).
      await page.evaluate(async () => {
        await fetch("/api/mappings/movie:19995", { method: "DELETE" }).catch(() => null)
      })
    }
    // Refill window for the shared defaults bucket before the next boot.
    await page.waitForTimeout(1000)
  })
})
