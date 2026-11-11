import { test, expect, type Locator, type Page } from "@playwright/test"
import { gotoPresetTab } from "./settings-tab"
import { putDefaultsWithRetry } from "./defaults-retry"

// Desktop global-settings preview UX: the title search sits directly below
// the full poster and must be reachable without scrolling the page at
// ordinary desktop heights, the full poster must stay inside its column
// with its ratio intact, selecting a new title must update the real
// preview URL, and the preview column must keep a functional wheel scroll
// at short heights. Mobile floating behavior is covered by
// settings-layout-ux.spec.ts and must stay untouched.

const DEMO_PROFILE = "e2e-desktop-preview"

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

async function seed(page: Page) {
  await page.addInitScript(
    ({ p }: { p: string }) => {
      try {
        localStorage.clear()
        localStorage.setItem("pictorium_profile_id", p)
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
        localStorage.setItem("pictorium_ui_theme", "dark")
        localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
      } catch {}
    },
    { p: DEMO_PROFILE },
  )
}

async function putFactory(page: Page) {
  await page.goto("/")
  await putDefaultsWithRetry(page, "setup defaults", FACTORY_SETUP)
}

test.beforeEach(async ({ page }) => {
  await putFactory(page)
})

async function openSettings(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: /Configura tutti i poster|Tutti i poster|Impostazioni/i })
    .filter({ visible: true })
    .click({ timeout: 15_000 })
  const dialog = page.getByRole("dialog", { name: /Configura tutti i poster/i }).filter({ visible: true })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await gotoPresetTab(dialog)
  return dialog
}

async function waitPreview(dialog: Locator) {
  const image = dialog.getByAltText("Avatar").first()
  await expect(image).toBeVisible({ timeout: 45_000 })
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 45_000 })
    .toBeGreaterThan(0)
}

interface GeometryDump {
  viewport: { width: number; height: number }
  previewCol: { x: number; y: number; width: number; height: number; scrollHeight: number; clientHeight: number; scrollTop: number; scrollWidth: number; clientWidth: number }
  search: { x: number; y: number; width: number; height: number } | null
  searchVisibleInViewport: boolean
  media: { x: number; y: number; width: number; height: number } | null
  footer: { x: number; y: number; width: number; height: number } | null
  dialog: { x: number; y: number; width: number; height: number } | null
  mediaNatural: { width: number; height: number; complete: boolean } | null
}

async function dumpGeometry(page: Page, dialog: Locator): Promise<GeometryDump> {
  return dialog.page().evaluate(
    ({ vp }) => {
      const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
      const col = q("settings-preview")!
      const searchEl = q("defaults-preview-title-search")
      const input = searchEl?.querySelector("input") as HTMLElement | null
      const media = q("defaults-preview-media")
      const footer = document.querySelector(".settings-dialog-footer") as HTMLElement | null
      const panel = document.querySelector(".settings-dialog-panel") as HTMLElement | null
      const img = media?.querySelector("img") as HTMLImageElement | null
      const r = (el: Element | null) => {
        if (!el) return null
        const b = el.getBoundingClientRect()
        return { x: b.x, y: b.y, width: b.width, height: b.height }
      }
      const sBox = r(input ?? searchEl)
      return {
        viewport: vp,
        previewCol: {
          ...r(col)!,
          scrollHeight: col.scrollHeight,
          clientHeight: col.clientHeight,
          scrollTop: col.scrollTop,
          scrollWidth: col.scrollWidth,
          clientWidth: col.clientWidth,
        },
        search: sBox,
        searchVisibleInViewport:
          !!sBox && sBox.y >= 0 && sBox.y + sBox.height <= vp.height + 1,
        media: r(media),
        footer: r(footer),
        dialog: r(panel),
        mediaNatural: img
          ? { width: img.naturalWidth, height: img.naturalHeight, complete: img.complete }
          : null,
      }
    },
    { vp: page.viewportSize()! },
  )
}

async function expectSearchVisibleNoScroll(page: Page, dialog: Locator, label: string) {
  const g = await dumpGeometry(page, dialog)
  console.log(`[desktop-preview-geometry] ${label} ${JSON.stringify(g)}`)
  expect(g.search, `${label}: search box exists`).not.toBeNull()
  expect(g.searchVisibleInViewport, `${label}: title search fully inside viewport without scrolling`).toBe(true)
  // Search must sit fully inside the preview column content (not merely the
  // viewport): top at/below the column top, bottom at/above the column
  // bottom, horizontally inside the column.
  const s = g.search!
  const c = g.previewCol
  expect(s.y, `${label}: search top inside column`).toBeGreaterThanOrEqual(c.y - 1)
  expect(s.y + s.height, `${label}: search bottom inside column`).toBeLessThanOrEqual(c.y + c.height + 1)
  expect(s.x, `${label}: search left inside column`).toBeGreaterThanOrEqual(c.x - 1)
  expect(s.x + s.width, `${label}: search right inside column`).toBeLessThanOrEqual(c.x + c.width + 1)
  // DOM/visual order: the full poster sits ABOVE the search (search
  // directly below the poster, no flex-order swaps) — geometry proves the
  // order, not just DOM position.
  expect(g.media, `${label}: media exists for order check`).not.toBeNull()
  const m = g.media!
  expect(m.y + m.height, `${label}: poster bottom at/above search top`).toBeLessThanOrEqual(s.y + 1)
  return g
}

function expectMediaInsideColumn(g: GeometryDump, label: string, landscape: boolean) {
  expect(g.media, `${label}: media exists`).not.toBeNull()
  const m = g.media!
  const c = g.previewCol
  // Full poster bounds stay inside the preview column on BOTH axes (no
  // horizontal crop, no vertical overflow below the visible column).
  expect(m.x, `${label}: media left inside column`).toBeGreaterThanOrEqual(c.x - 1)
  expect(m.x + m.width, `${label}: media right inside column`).toBeLessThanOrEqual(c.x + c.width + 1)
  expect(m.y, `${label}: media top inside column`).toBeGreaterThanOrEqual(c.y - 1)
  expect(m.y + m.height, `${label}: media bottom inside column (full poster visible)`).toBeLessThanOrEqual(
    c.y + c.height + 1,
  )
  expect(m.width, `${label}: media non-zero width`).toBeGreaterThan(0)
  expect(m.height, `${label}: media non-zero height`).toBeGreaterThan(0)
  // Visually useful minimum (not a 1px test-gaming shrink): portrait stays
  // a readable thumbnail, landscape a watchable strip.
  if (landscape) {
    expect(m.width, `${label}: landscape useful width`).toBeGreaterThanOrEqual(160)
    expect(m.height, `${label}: landscape useful height`).toBeGreaterThanOrEqual(90)
  } else {
    expect(m.width, `${label}: portrait useful width`).toBeGreaterThanOrEqual(90)
    expect(m.height, `${label}: portrait useful height`).toBeGreaterThanOrEqual(130)
  }
  if (landscape) {
    expect(m.width / m.height, `${label}: landscape 16/9 ratio`).toBeGreaterThan(1.5)
    expect(m.width / m.height, `${label}: landscape 16/9 ratio`).toBeLessThan(1.9)
  } else {
    expect(m.height / m.width, `${label}: portrait 2/3 ratio`).toBeGreaterThan(1.3)
    expect(m.height / m.width, `${label}: portrait 2/3 ratio`).toBeLessThan(1.7)
  }
  // No horizontal overflow of the column itself.
  expect(c.scrollWidth, `${label}: no horizontal overflow`).toBeLessThanOrEqual(c.clientWidth + 1)
  // Ordinary desktop heights: the preview column must NOT scroll — the full
  // poster, search and caution all fit the remaining body height.
  expect(c.scrollHeight, `${label}: column fits without scroll`).toBeLessThanOrEqual(c.clientHeight + 1)
  expect(c.scrollTop, `${label}: column starts at top`).toBe(0)
  // Full image decoded with its true ratio (no arbitrary crop/distortion).
  expect(g.mediaNatural, `${label}: preview image decoded`).not.toBeNull()
  expect(g.mediaNatural!.width, `${label}: natural width decoded`).toBeGreaterThan(0)
  expect(g.mediaNatural!.height, `${label}: natural height decoded`).toBeGreaterThan(0)
  // Poster bottom stays above the dialog footer (not hidden underneath).
  if (g.footer) {
    expect(m.y + m.height, `${label}: media bottom above footer`).toBeLessThanOrEqual(g.footer.y + 1)
  }
}

test.describe("desktop global preview: search reachable without scroll", () => {
  test("search visible without scroll at ordinary desktop heights, both shapes", async ({ page }) => {
    const putUrls: string[] = []
    page.on("request", (req) => {
      if (req.method() === "PUT" && req.url().includes("/api/defaults")) putUrls.push(req.url())
    })
    const viewports = [
      { width: 1280, height: 720 },
      { width: 1024, height: 768 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]
    for (const vp of viewports) {
      await page.setViewportSize(vp)
      await seed(page)
      await page.goto("/")
      await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
      const dialog = await openSettings(page)
      await waitPreview(dialog)
      const previewCol = dialog.getByTestId("settings-preview")
      await expect(previewCol).toHaveAttribute("data-floating", "false")

      // Portrait first.
      let g = await expectSearchVisibleNoScroll(page, dialog, `${vp.width}x${vp.height} portrait`)
      expectMediaInsideColumn(g, `${vp.width}x${vp.height} portrait`, false)

      // Landscape edit target: same contract, 16/9 bounds.
      await dialog.getByTestId("format-target-selector").getByText("Orizzontale", { exact: true }).click()
      await page.waitForTimeout(500)
      g = await expectSearchVisibleNoScroll(page, dialog, `${vp.width}x${vp.height} landscape`)
      expectMediaInsideColumn(g, `${vp.width}x${vp.height} landscape`, true)
      await dialog.getByTestId("format-target-selector").getByText("Verticale", { exact: true }).click()
      await page.waitForTimeout(500)

      // Single preview owner throughout; Save stays reachable.
      await expect(dialog.getByTestId("defaults-preview-media")).toHaveCount(1)
      await expect(dialog.getByTestId("settings-save")).toBeVisible()
      // The full poster bottom must be visible in the screenshot viewport:
      // assert it before capturing so the PNG actually proves the contract.
      const check = await dumpGeometry(page, dialog)
      expect(check.media, `${vp.width}x${vp.height}: media for screenshot`).not.toBeNull()
      expect(
        check.media!.y + check.media!.height,
        `${vp.width}x${vp.height}: poster bottom visible in viewport`,
      ).toBeLessThanOrEqual(vp.height + 1)
      if (vp.width === 1280 || vp.width === 1024) {
        await page.screenshot({ path: `artifacts/settings-desktop-preview-${vp.width}x${vp.height}.png` })
      }
      // Geometry-only navigation: no staged save without explicit Save.
      // No Fine/Done button in the staged-session footer: Escape closes
      // through the same session guard (no dirty draft -> instant close).
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      // Refill window for the shared defaults bucket before the next boot.
      await page.waitForTimeout(1000)
    }
    expect(putUrls).toEqual([])
  })

  test("selecting a new title updates the real preview URL with visible results", async ({ page }) => {
    const putUrls: string[] = []
    const posterUrls: string[] = []
    page.on("request", (req) => {
      if (req.method() === "PUT" && req.url().includes("/api/defaults")) putUrls.push(req.url())
      if (req.url().includes("/api/poster/")) posterUrls.push(req.url())
    })
    // Deterministic search payload: a tv title distinct from the Avatar demo.
    await page.route("**/api/tmdb/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          page: 1,
          total_pages: 1,
          total_results: 1,
          results: [
            {
              id: 1399,
              media_type: "tv",
              name: "La casa di carta",
              poster_path: "/mocked/avatar.jpg",
              first_air_date: "2017-05-02",
              vote_average: 8.2,
            },
          ],
        }),
      })
    })
    await page.setViewportSize({ width: 1280, height: 720 })
    await seed(page)
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const dialog = await openSettings(page)
    await waitPreview(dialog)

    const search = dialog.getByTestId("defaults-preview-title-search")
    const box = search.getByRole("textbox")
    // Keyboard path: type + debounced results, no page scroll needed.
    await box.click()
    await box.fill("casa di carta")
    const option = dialog.getByRole("option", { name: /La casa di carta/ })
    await expect(option).toBeVisible({ timeout: 15_000 })
    // Dropdown results render in-flow, fully inside the viewport (not cropped).
    const optBox = (await option.boundingBox())!
    const vp = page.viewportSize()!
    expect(optBox.y).toBeGreaterThanOrEqual(-1)
    expect(optBox.y + optBox.height).toBeLessThanOrEqual(vp.height + 1)
    expect(optBox.x).toBeGreaterThanOrEqual(-1)
    expect(optBox.x + optBox.width).toBeLessThanOrEqual(vp.width + 1)
    // …and fully inside the preview column content (not merely the
    // viewport, not clipped by the column scroll container).
    const colBox = (await dialog.getByTestId("settings-preview").boundingBox())!
    expect(optBox.y, "dropdown option top inside preview column").toBeGreaterThanOrEqual(colBox.y - 1)
    expect(optBox.y + optBox.height, "dropdown option bottom inside preview column").toBeLessThanOrEqual(
      colBox.y + colBox.height + 1,
    )
    expect(optBox.x, "dropdown option left inside preview column").toBeGreaterThanOrEqual(colBox.x - 1)
    expect(optBox.x + optBox.width, "dropdown option right inside preview column").toBeLessThanOrEqual(
      colBox.x + colBox.width + 1,
    )
    // Footer occlusion guard: the dropdown option must end above the
    // dialog footer (actual footer bounds, not just the page viewport),
    // so it stays fully visible/clickable with the search below the poster.
    const footerBox = await dialog.locator(".settings-dialog-footer").boundingBox()
    if (footerBox) {
      expect(optBox.y + optBox.height, "dropdown option bottom above footer").toBeLessThanOrEqual(
        footerBox.y + 1,
      )
    }
    // Pointer path: click selects and rebuilds the real preview URL.
    await option.click()
    await expect(dialog.getByAltText("La casa di carta").first()).toBeVisible({ timeout: 45_000 })
    await expect
      .poll(
        () => dialog.getByAltText("La casa di carta").first().evaluate((el: HTMLImageElement) => el.naturalWidth),
        { timeout: 45_000 },
      )
      .toBeGreaterThan(0)
    expect(posterUrls.some((u) => u.includes("/api/poster/tv/1399"))).toBe(true)
    // Preview-only selection: no staged save without explicit Save.
    await page.waitForTimeout(1200)
    expect(putUrls).toEqual([])
    await page.screenshot({ path: "artifacts/settings-desktop-preview-search-select.png" })
  })

  test("short height keeps a functional preview scroll without trapping controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await seed(page)
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    const dialog = await openSettings(page)
    await waitPreview(dialog)
    const previewCol = dialog.getByTestId("settings-preview")
    const controls = dialog.getByTestId("settings-controls")
    // Sidebar and preview scroll independently: wheel over the preview must
    // not move the controls column.
    const controlsTopBefore = await controls.evaluate((el) => el.scrollTop)
    await previewCol.hover()
    await page.mouse.wheel(0, 400)
    await page.waitForTimeout(400)
    const after = await previewCol.evaluate((el) => ({
      top: (el as HTMLElement).scrollTop,
      sh: (el as HTMLElement).scrollHeight,
      ch: (el as HTMLElement).clientHeight,
    }))
    const controlsTopAfter = await controls.evaluate((el) => el.scrollTop)
    expect(controlsTopAfter).toBe(controlsTopBefore)
    if (after.sh > after.ch + 1) {
      // Overflowing column: the wheel actually scrolled the preview.
      expect(after.top).toBeGreaterThan(0)
    }
    // Search stays keyboard-reachable at short heights too.
    await expect(dialog.getByTestId("defaults-preview-title-search").getByRole("textbox")).toBeAttached()
    await dialog.getByTestId("defaults-preview-title-search").getByRole("textbox").focus()
    await expect(dialog.getByTestId("defaults-preview-title-search").getByRole("textbox")).toBeFocused()
  })
})
