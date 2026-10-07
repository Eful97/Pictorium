import { expect, test, type Locator, type Page } from "@playwright/test"

// Canonical factory defaults (single-source values from useDefaults factory +
// per-shape code defaults). The settings dialog renders conditional rows from
// server defaults, so tab order is only deterministic from a pinned fixture:
// without this, earlier specs' persisted state (single-instance /api/defaults
// namespace, merge-only PUT) shifts rows and focus indices desync mid-traverse.
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

async function putFactoryDefaults(page: Page) {
  await page.goto("/")
  await page.evaluate(async (body) => {
    const r = await fetch("/api/defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`setup defaults: ${r.status} ${await r.text()}`)
  }, FACTORY_SETUP)
}

test.beforeEach(async ({ page }) => {
  await putFactoryDefaults(page)
})

// Live tab-order helpers: the dialog legitimately gains one tab stop
// mid-traverse (focusing a family card mounts the preview "reset family"
// button), so frozen nth() indices go stale. Every keypress is asserted
// against the LIVE list by DOM-node identity: the destination node is
// resolved before the press and the focused node must be that exact node.
type LiveHandle = NonNullable<Awaited<ReturnType<Locator["elementHandle"]>>>
type FocusState = { same: boolean; hasFocus: boolean; inDialog: boolean }

async function activeDescriptor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    const testid = el?.getAttribute?.("data-testid") ?? ""
    const text = (el?.textContent ?? "").trim().slice(0, 32).replace(/\s+/g, " ")
    return `${el?.tagName ?? "none"}|${testid}|${text}`
  })
}

async function assertNativeStep(page: Page, expected: LiveHandle, direction: "forward" | "backward"): Promise<void> {
  await page.keyboard.press(direction === "forward" ? "Tab" : "Shift+Tab")
  // toBeFocused semantics (activeElement + document.hasFocus) plus dialog
  // containment: a focus drop to body or outside the dialog fails here.
  await expect
    .poll(
      (): Promise<FocusState> =>
        expected.evaluate((node) => ({
          same: document.activeElement === node,
          hasFocus: document.hasFocus(),
          inDialog: document.activeElement?.closest?.('[role="dialog"]') != null,
        })),
      { intervals: [50] },
    )
    .toEqual({ same: true, hasFocus: true, inDialog: true })
}

async function allLiveVisited(controls: Locator): Promise<boolean> {
  return controls.evaluateAll((nodes) => {
    const seen = (window as unknown as { __f2seen: Element[] }).__f2seen
    return nodes.every((n) => seen.includes(n))
  })
}

async function traverseToStart(
  page: Page,
  controls: Locator,
  from: LiveHandle,
  start: LiveHandle,
  direction: "forward" | "backward",
  cap: number,
  exit: "start" | "coverage",
): Promise<{ steps: number; visited: string[]; repeats: number; end: LiveHandle }> {
  const visited: string[] = []
  // Walk starts wherever focus actually is (from); start only anchors the
  // cycle-closure check, never the first step computation.
  let current = from
  let steps = 0
  let repeats = 0
  for (;;) {
    // nth() re-resolves against the live DOM on every call, so insertions
    // during the walk shift ordinals but never the destination identity.
    const total = await controls.count()
    const currentIndex = await controls.evaluateAll(
      (nodes, active) => nodes.indexOf(active as unknown as HTMLElement),
      current,
    )
    // Lost focus (body / outside the list, e.g. a remount focus-drop)
    // surfaces here as -1 instead of silently passing.
    expect(currentIndex).toBeGreaterThanOrEqual(0)
    const nextIndex = direction === "forward" ? (currentIndex + 1) % total : (currentIndex - 1 + total) % total
    const next = await controls.nth(nextIndex).elementHandle()
    expect(next).not.toBeNull()
    if (next === null) throw new Error("live tabbable resolved to null")
    await assertNativeStep(page, next, direction)
    visited.push(await activeDescriptor(page))
    // Identity registry (not text: labels like "Reset" repeat across
    // sections): detects short-circuits that revisit nodes mid-cycle.
    const mark: boolean | "none" = await page.evaluate(() => {
      const seen = (window as unknown as { __f2seen: Element[] }).__f2seen
      const el = document.activeElement as Element | null
      if (!el) return "none"
      if (seen.includes(el)) return true
      seen.push(el)
      return false
    })
    expect(mark).not.toBe("none")
    if (mark === true) repeats += 1
    current = next
    steps += 1
    if (exit === "coverage") {
      if (await allLiveVisited(controls)) break
    } else {
      const backToStart = await start.evaluate((node) => document.activeElement === node)
      if (backToStart) break
    }
    if (steps >= cap)
      throw new Error(
        exit === "coverage"
          ? "tab coverage incomplete within step budget"
          : `tab cycle did not return to start within ${cap} steps`,
      )
  }
  return { steps, visited, repeats, end: current }
}

async function coverAll(
  page: Page,
  controls: Locator,
  from: LiveHandle,
  start: LiveHandle,
  direction: "forward" | "backward",
  cap: number,
  firstExit: "start" | "coverage",
): Promise<{ steps: number; visited: string[]; rounds: number; distinct: number; end: LiveHandle }> {
  // Fresh identity registry per phase. Round 1 is a single clean live cycle;
  // a missed node (focus-caused insertion behind the pointer: mobile preview
  // sits above the controls) is picked up by continuing to walk instead of
  // restarting, which would re-trigger the unmount/remount chase.
  await page.evaluate(() => {
    ;(window as unknown as { __f2seen: Element[] }).__f2seen = []
  })
  const visited: string[] = []
  let steps = 0
  // Round 1 must be a single clean live cycle (zero repeats proves the trap
  // has no short-circuit); it also validates both wraps by construction.
  const first = await traverseToStart(page, controls, from, start, direction, cap, firstExit)
  expect(first.repeats).toBe(0)
  visited.push(...first.visited)
  steps += first.steps
  const distinctAfterFirst: number = await page.evaluate(
    () => (window as unknown as { __f2seen: Element[] }).__f2seen.length,
  )
  if (await allLiveVisited(controls)) return { steps, visited, rounds: 1, distinct: distinctAfterFirst, end: first.end }
  // A focus-caused insertion landed behind the pointer (mobile reset button
  // mounts in the preview above the controls). Keep walking from the current
  // position instead of restarting: a fresh cycle would re-trigger the
  // unmount/remount chase on every pass and never converge.
  const second = await traverseToStart(page, controls, first.end, start, direction, cap, "coverage")
  visited.push(...second.visited)
  steps += second.steps
  const distinct: number = await page.evaluate(
    () => (window as unknown as { __f2seen: Element[] }).__f2seen.length,
  )
  return { steps, visited, rounds: 2, distinct, end: second.end }
}

test.afterEach(async ({ page }) => {
  await page.waitForTimeout(1200)
  await putFactoryDefaults(page)
  const got = await page.evaluate(async () => {
    const r = await fetch("/api/defaults")
    if (!r.ok) throw new Error(`verify defaults: ${r.status}`)
    return (await r.json()) as Record<string, unknown>
  })
  expect(got).toMatchObject(FACTORY_SETUP)
})

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
    const trigger = page.getByRole("button", { name: /Configura tutti i poster|Tutti i poster|Impostazioni/i }).filter({ visible: true })
    await trigger.click()

    const dialog = page.getByRole("dialog", { name: "Configura tutti i poster" }).filter({ visible: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Fine", exact: true })).toBeVisible()
    // T4 footer live region: exactly one status (the footer one, no stray toasts).
    await expect(dialog.getByRole("status")).toHaveCount(1)
    // Async server-defaults hydration remounts conditional rows (rank
    // appearance/variant/side): start only after the first preview round-trip
    // committed them. Assertions below traverse the full order in both
    // directions against the live list (see helpers above).
    // (Desktop preview column has its own testid; mobile compact preview does
    // not — fall back to dialog scope. Alt is the demo title in both.)
    const previewScope = (await dialog.getByTestId("settings-preview").count())
      ? dialog.getByTestId("settings-preview")
      : dialog
    const previewImg = previewScope.getByAltText("Avatar").first()
    await expect(previewImg).toBeVisible({ timeout: 45_000 })
    await expect
      .poll(() => previewImg.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 45_000 })
      .toBeGreaterThan(0)
    await page.waitForTimeout(500)
    const controls = dialog.locator(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ).filter({ visible: true })
    const initialCount = await controls.count()
    expect(initialCount).toBeGreaterThan(3)
    await expect(controls.first()).toBeFocused()
    const start = await controls.first().elementHandle()
    expect(start).not.toBeNull()
    if (start === null) throw new Error("initial tabbable resolved to null")
    // A full native cycle grows past the initial list once the focus-driven
    // preview reset button mounts; the cap stays proportional to the live
    // list instead of raising any timeout.
    const cap = initialCount * 2 + 8

    // Forward: every Tab must land on the exact live-next node, including
    // the wrap from the footer back to the initial close control. Coverage
    // runs until every live node was focused: on mobile the focus-caused
    // reset button mounts behind the pointer, so a second round picks it up.
    const forward = await coverAll(page, controls, start, start, "forward", cap, "start")
    expect(forward.rounds).toBeLessThanOrEqual(2)
    // The family preview reset is a legitimate focus-caused insertion: pin
    // the single +1 and require the new button to be keyboard-reachable via
    // native Tab (a regression must not hide the mutation).
    expect(await controls.count()).toBe(initialCount + 1)
    expect(forward.distinct).toBe(initialCount + 1)
    await expect(dialog.getByTestId("defaults-preview-reset-family")).toBeVisible()
    expect(forward.visited.some((d) => d.includes("defaults-preview-reset-family"))).toBe(true)
    expect(forward.visited.some((d) => d.includes("Fine"))).toBe(true)

    // Backward: every Shift+Tab lands on the exact live-previous node,
    // including the wrap from the initial close control to the footer. The
    // walk starts wherever the forward phase left focus (not assumed to be
    // the start node); the mirror mutation happens here: focusing the
    // quick-preset card reports family "auto" and unmounts the reset button,
    // so visited identities may exceed the live list by that detached node.
    const backward = await coverAll(page, controls, forward.end, start, "backward", cap, "coverage")
    expect(backward.rounds).toBe(1)
    expect(backward.distinct).toBeGreaterThanOrEqual(await controls.count())
    expect(backward.visited.some((d) => d.includes("Fine"))).toBe(true)

    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
}
