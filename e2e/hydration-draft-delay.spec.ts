import { test, expect, type Page, type Route } from "@playwright/test"
import { putDefaultsWithRetry, withDefaultsRetry } from "./defaults-retry"

// Deterministic hydration-race probe for the per-title Numero + Angolo flow
// (same steps and assertions as badge-format-defaults :517): every GET
// /api/defaults is held until AFTER the Numero click, so hydration can only
// resolve post-click. Without live-draft preservation the late merge resets
// Numero (ribbon renders, no rs=number URL ever fires); with it the preview
// carries rs=number with xbs=corner. PUTs always pass through untouched.
//
// Isolation: the debounced UI autosave persists FULL editor state, so this
// file restores the canonical factory surface in afterEach (same contract
// as badge-format-defaults) — later specs inherit factory, never our dirt.

interface Seen {
  urls: string[]
}

// Canonical factory restore (same surface as badge-format-defaults
// FACTORY_RESTORE): the debounced UI autosave persists FULL editor state,
// so a partial restore leaves echoes that later specs inherit. Merge-only
// PUT cannot delete keys: every autosaveable key is covered below at its
// factory value, verified with toMatchObject.
const FACTORY_RESTORE = {
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
  extraBadgeScale: null,
  extraBadgeOffsetX: null,
  extraBadgeOffsetY: null,
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
  networkLogoFollowTitle: true,
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

function isPosterRequest(raw: string): URL | null {
  if (!/\/api\/poster\/(movie|tv)\//.test(raw)) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  return u.searchParams.get("preview") === "1" ? u : null
}

function findLastParams(
  urls: string[],
  from: number,
  match: (u: URL) => boolean,
  pred: (u: URL) => boolean,
): URLSearchParams | null {
  let out: URLSearchParams | null = null
  for (const raw of urls.slice(from)) {
    const u = isPosterRequest(raw)
    if (u && match(u) && pred(u)) out = u.searchParams
  }
  return out
}

async function nextPreview(
  seen: Seen,
  action: () => Promise<unknown>,
  pred: (u: URL) => boolean = () => true,
  match: (u: URL) => boolean = (u) => u.searchParams.get("demosamples") !== "1",
) {
  const n = seen.urls.length
  await action()
  let out: URLSearchParams | null = null
  await expect
    .poll(
      () => {
        out = findLastParams(seen.urls, n, match, pred)
        return out ? "ok" : null
      },
      { timeout: 30_000 },
    )
    .not.toBeNull()
  return out as unknown as URLSearchParams
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      localStorage.setItem("pictorium_profile_id", "e2e-hydration-draft")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
    } catch {}
  })
}

async function getDefaultsWithRetry(page: Page, label: string): Promise<Record<string, unknown>> {
  const res = await withDefaultsRetry(
    () =>
      page.evaluate(async () => {
        const r = await fetch("/api/defaults")
        return {
          ok: r.ok,
          status: r.status,
          body: await r.text(),
          retryAfter: r.headers.get("Retry-After"),
        }
      }),
    { label },
  )
  return JSON.parse(res.body) as Record<string, unknown>
}

async function restoreFactory(page: Page) {
  await putDefaultsWithRetry(page, "restore defaults", FACTORY_RESTORE)
  // Verify the full canonical surface — a mismatch is a real leak
  // (merge-only PUT cannot delete keys, so every autosaved key must be
  // covered above with its factory value).
  const got = await getDefaultsWithRetry(page, "verify restore")
  expect(got).toMatchObject(FACTORY_RESTORE)
}

test.afterEach(async ({ page }) => {
  await page.unroute("**/api/defaults*").catch(() => null)
  // Settle trailing debounced UI autosaves (500ms in useDefaults) BEFORE the
  // restore PUT, never after it (u4-final precedent).
  await page.waitForTimeout(1200)
  await page.goto("/")
  await restoreFactory(page)
})

test("desktop: delayed hydration keeps clicked Numero, preview rs=number xbs=corner", async ({
  page,
}) => {
  await seed(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")

  // Hold every defaults GET until explicitly released (PUTs pass through).
  // Held routes on navigated-away pages abort: continue() then rejects and
  // is swallowed with justification (no silent test errors otherwise).
  const held: Route[] = []
  let released = false
  await page.route("**/api/defaults*", async (route) => {
    if (route.request().method() !== "GET" || released) {
      await route.continue()
      return
    }
    held.push(route)
  })
  const heldCount = () => held.length
  const releaseHydration = async () => {
    released = true
    const pending = held.splice(0)
    // Response signal: the first continued GET must complete so hydration
    // data observably arrived before final assertions.
    const responded = pending.length
      ? page.waitForResponse("**/api/defaults*", { timeout: 15_000 }).catch(() => null)
      : Promise.resolve(null)
    for (const r of pending) {
      await r.continue().catch(() => null)
    }
    await responded
  }

  await putDefaultsWithRetry(page, "reset defaults", {
    posterShape: "poster",
    rankingBadgeStyle: "default",
    ribbonEnabled: true,
    extraBadgeStyle: null,
  })
  await page.goto("/")
  const seen: Seen = { urls: [] }
  page.on("request", (req) => {
    if (isPosterRequest(req.url())) seen.urls.push(req.url())
  })

  const search = page.getByPlaceholder(/cerca/i)
  await expect(search).toBeVisible({ timeout: 30_000 })
  await search.fill("avatar")
  await search.press("Enter")
  await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
  await page.getByText(/Avatar/i).first().click()
  await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 10_000 })

  const badgeTab = page.getByRole("tab", { name: "Badge" })
  await badgeTab.click()
  await expect(badgeTab).toHaveAttribute("aria-selected", "true")

  const editor = page.locator("main").first()
  const rankGroup = editor.getByRole("radiogroup", { name: "Classifica" })
  await expect(rankGroup).toBeVisible()
  await rankGroup.getByRole("radio", { name: "Numero" }).click()

  // The delay must have engaged: at least one hydration GET was held back,
  // otherwise this probe is vacuous.
  expect(heldCount()).toBeGreaterThan(0)

  // Hydration can only resolve from here on: the clicked draft must survive.
  await releaseHydration()

  // Numero stays selected after settled hydration (not just in the URL).
  await expect(rankGroup.getByRole("radio", { name: "Numero" })).toBeChecked()

  await expect(editor.getByRole("radiogroup", { name: "Posizione" })).toHaveCount(0)

  const extraCard = editor
    .getByText("Stile badge extra", { exact: true })
    .locator("xpath=..")
  // The Angolo click runs INSIDE nextPreview: n is captured before the
  // action, so no request window is missed between action and observation.
  const p = await nextPreview(
    seen,
    async () => {
      await extraCard.getByRole("button", { name: "Angolo" }).click()
    },
    (u) => u.searchParams.get("rs") === "number" && u.searchParams.get("xbs") === "corner",
    (u) => u.searchParams.get("demosamples") !== "1",
  )
  expect(p.get("rs")).toBe("number")
  expect(p.get("xbs")).toBe("corner")
  expect(p.getAll("ribbon")).toEqual(["1"])
})

test("factory restore neutralizes seeded non-factory values", async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  // Seed explicit non-factory values, then run the same factory restore the
  // afterEach uses: the canonical surface must come back exactly.
  await putDefaultsWithRetry(page, "seed non-factory", {
    topBadgeScale: 130,
    ribbonEnabled: false,
    extraBadgeStyle: "corner",
    networkLogoFollowTitle: false,
    separateBadgeScale: 200,
  })
  const seeded = await getDefaultsWithRetry(page, "verify seeded")
  expect(seeded.topBadgeScale).toBe(130)
  expect(seeded.ribbonEnabled).toBe(false)
  await restoreFactory(page)
})
