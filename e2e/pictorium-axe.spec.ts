import { expect, test, type Page, type TestInfo } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

/**
 * UI accessibility regression suite (axe-core).
 *
 * Scope: the Pictorium *UI*, not the rendered poster. The poster canvas is a
 * generated image served by `/api/poster/*`; its content is artwork and stays
 * out of the scan (see POSTER_IMAGE_SELECTOR below). Everything else on the
 * reachable screens is scanned.
 *
 * These tests reuse the existing Playwright harness (playwright.config.ts):
 * the local mock server replaces TMDB/JustWatch/IMDb/etc., so no real
 * TMDB_API_KEY is required. They are browser-only (no poster byte changes,
 * no snapshots, no RENDER_VERSION bump).
 *
 * What axe covers here: color contrast, accessible names/labels, roles,
 * landmarks, ARIA validity (WCAG 2.0/2.1 A+AA tag set). Axe does NOT test
 * keyboard navigation; the explicit keyboard test at the bottom covers the
 * modal open/close + focus restoration path.
 *
 * Gate: only `serious` and `critical` violations fail the suite. Lower impact
 * findings are recorded in the JSON attachment but are not a release blocker
 * (they still show up in the run log via the attachment).
 */

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>

/** WCAG 2.0 + 2.1 A/AA rule set: contrast, names/labels, roles, ARIA. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]

/**
 * The poster canvas is an <img> pointing at the shared renderer endpoint.
 * Its pixels are the product of the poster pipeline (out of scope here) and
 * axe must not try to judge artwork. We exclude only those generated images;
 * every other image/control on the page stays in the scan.
 */
const POSTER_IMAGE_SELECTOR = 'img[src*="/api/poster/"]'

/** Impact levels that fail the suite. */
const BLOCKING_IMPACTS = new Set(["serious", "critical"])

/**
 * Seed the same stateless session the smoke/visual suites use so the app
 * renders the regular shell (no lang picker, no onboarding, no profile gate).
 */
async function seedSession(page: Page, options: { tmdbKey?: boolean } = {}) {
  const tmdbKey = options.tmdbKey === true
  await page.addInitScript((withKey: boolean) => {
    try {
      localStorage.setItem("pictorium_profile_id", "e2e-axe-profile")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      // Empty key = welcome/home state; a dummy key unlocks the search flow
      // (the mock server does not validate it) for the editor test.
      localStorage.setItem("tmdb_key", withKey ? "mock-tmdb-key-0000000000" : "")
    } catch {
      // localStorage unavailable: the app still renders its default state.
    }
  }, tmdbKey)
}

/**
 * Let enter animations/transitions finish before scanning. axe samples the
 * computed colors; mid-fade opacity would produce false contrast failures.
 */
async function settle(page: Page) {
  await page.waitForTimeout(500)
}

async function runAxe(page: Page, testInfo: TestInfo, context: string): Promise<AxeResults> {
  const results = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .exclude(POSTER_IMAGE_SELECTOR)
    .analyze()

  if (results.violations.length > 0) {
    // Full violation payload is kept as a test artifact for triage.
    await testInfo.attach(`axe-${context}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    })
  }

  return results
}

function formatViolations(violations: AxeResults["violations"]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `    - ${node.target.join(" ")} :: ${node.failureSummary?.split("\n")[0] ?? ""}`)
        .join("\n")
      return `  [${violation.impact ?? "unknown"}] ${violation.id} — ${violation.help}\n${nodes}`
    })
    .join("\n")
}

/**
 * Assert the screen has no serious/critical axe violations. A pre-existing
 * violation is reported as a hard failure with the page, rule and selector;
 * assertions are never relaxed to make the suite pass. No rule is disabled
 * and no impact level is filtered out of the scan: only `serious`/`critical`
 * fail the suite (the documented gate), but every violation is still
 * collected in the JSON attachment.
 */
function expectNoBlockingViolations(results: AxeResults, context: string) {
  const blocking = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ""))
  const message = blocking.length
    ? `${context}: ${blocking.length} serious/critical axe violation(s):\n${formatViolations(blocking)}`
    : `${context}: no serious/critical axe violations`
  expect(blocking, message).toHaveLength(0)
}

// Deliberately NOT serial: every screen is scanned even when an earlier one
// has a pre-existing violation, so the run log carries the full evidence set
// (workers=1 keeps the shared app deterministic).
test("home / configure — no serious or critical axe violations", async ({ page }, testInfo) => {
  await seedSession(page)
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await settle(page)

  const results = await runAxe(page, testInfo, "home")
  expectNoBlockingViolations(results, "home / configure")
})

test("My Posters — no serious or critical axe violations", async ({ page }, testInfo) => {
  await seedSession(page)
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: /I miei poster/i }).first().click()
  await expect(page.getByRole("heading", { name: /I miei poster/i })).toBeVisible({ timeout: 20_000 })
  await settle(page)

  const results = await runAxe(page, testInfo, "my-posters")
  expectNoBlockingViolations(results, "My Posters")
})

test("Cataloghi — no serious or critical axe violations", async ({ page }, testInfo) => {
  await seedSession(page)
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: /^Cataloghi$/ }).first().click()
  await expect(page.getByRole("heading", { name: /^Cataloghi$/ })).toBeVisible({ timeout: 30_000 })
  await settle(page)

  const results = await runAxe(page, testInfo, "cataloghi")
  expectNoBlockingViolations(results, "Cataloghi")
})

test("Settings panel — no serious or critical axe violations", async ({ page }, testInfo) => {
  await seedSession(page)
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: /^Impostazioni$/ }).first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await settle(page)

  const results = await runAxe(page, testInfo, "settings")
  expectNoBlockingViolations(results, "Settings panel")
})

test("Editor — no serious or critical axe violations", async ({ page }, testInfo) => {
  // Dummy key: the mock server does not validate it, but the client gate
  // requires a non-empty value to run a search and open the editor.
  await seedSession(page, { tmdbKey: true })
  await page.goto("/")

  const search = page.getByPlaceholder(/cerca/i)
  await expect(search).toBeVisible({ timeout: 30_000 })
  await search.fill("avatar")
  await search.press("Enter")

  await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
  await page.getByText(/Avatar/i).first().click()

  await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 20_000 })
  await settle(page)

  const results = await runAxe(page, testInfo, "editor")
  expectNoBlockingViolations(results, "Editor")
})

test("Install modal (open state) — no serious or critical axe violations", async ({ page }, testInfo) => {
  await seedSession(page)
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: /Installa Hub|Install Hub/i }).first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await settle(page)

  const results = await runAxe(page, testInfo, "install-modal")
  expectNoBlockingViolations(results, "Install modal")
})

test("Install modal — keyboard open/close and focus restoration", async ({ page }) => {
  // axe has no keyboard-navigation rule: this is the explicit keyboard check
  // for the modal path (Enter opens, focus moves inside the dialog, Escape
  // closes and returns focus to the trigger).
  await seedSession(page)
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

  const trigger = page.getByRole("button", { name: /Installa Hub|Install Hub/i }).first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await page.keyboard.press("Enter")

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})
