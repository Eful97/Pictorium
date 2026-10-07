import { test, expect, type Page, type Route } from "@playwright/test"
import { putDefaultsWithRetry, withDefaultsRetry } from "./defaults-retry"

// Deterministic hydration-race probe for the per-title Numero + Angolo flow
// (same steps and assertions as badge-format-defaults :517): every GET
// /api/defaults is held until AFTER the Numero click, so hydration can only
// resolve post-click. Without live-draft preservation the late merge resets
// Numero (ribbon renders, no rs=number URL ever fires); with it the preview
// carries rs=number with xbs=corner. PUTs always pass through untouched.
//
// Isolation: the pre-mutation server values for every field this probe (or
// the app autosave) can mutate are captured up front and restored in
// afterEach (flush autosaves, reload, verify). Previously set explicit values
// win over factory fallbacks, so a preceding non-factory style survives us.

interface Seen {
  urls: string[]
}

// Server fields this probe (or the editor autosave under it) may mutate.
// Snapshot values win on restore; keys absent initially fall back to the
// effective factory values below.
const RELEVANT_KEYS = [
  "posterShape",
  "rankingBadgeStyle",
  "extraBadgeStyle",
  "ribbonEnabled",
  "ribbonSide",
  "topBadgeScale",
  "topBadgeOffsetX",
  "topBadgeOffsetY",
  "extraBadgeScale",
  "extraBadgeOffsetX",
  "extraBadgeOffsetY",
  "networkLogoFollowTitle",
  "networkLogoScale",
  "networkLogoOffsetX",
  "networkLogoOffsetY",
] as const

// Effective factory values (client DEFAULTS + u4 RESET precedent) for keys
// absent from the pre-test snapshot.
const FACTORY_FALLBACK: Record<string, unknown> = {
  posterShape: "poster",
  rankingBadgeStyle: "default",
  extraBadgeStyle: null,
  ribbonEnabled: true,
  ribbonSide: "left",
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  extraBadgeScale: null,
  extraBadgeOffsetX: null,
  extraBadgeOffsetY: null,
  networkLogoFollowTitle: true,
  networkLogoScale: 100,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
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

function restorePayload(snapshot: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const key of RELEVANT_KEYS) {
    const v = snapshot[key]
    payload[key] = v === undefined ? FACTORY_FALLBACK[key] : v
  }
  return payload
}

async function restoreDefaults(page: Page, snapshot: Record<string, unknown>) {
  await putDefaultsWithRetry(page, "restore defaults", restorePayload(snapshot))
  const got = await getDefaultsWithRetry(page, "verify restore")
  for (const key of RELEVANT_KEYS) {
    const want = snapshot[key] === undefined ? FACTORY_FALLBACK[key] : snapshot[key]
    expect(got[key]).toEqual(want)
  }
}

let savedSnapshot: Record<string, unknown> | null = null

test.afterEach(async ({ page }) => {
  await page.unroute("**/api/defaults*").catch(() => null)
  // Settle trailing debounced UI autosaves (500ms in useDefaults) BEFORE the
  // restore PUT, never after it (u4-final precedent).
  await page.waitForTimeout(1200)
  await page.goto("/")
  if (savedSnapshot) {
    await restoreDefaults(page, savedSnapshot)
  }
  savedSnapshot = null
})

test("desktop: delayed hydration keeps clicked Numero, preview rs=number xbs=corner", async ({
  page,
}) => {
  await seed(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  savedSnapshot = await getDefaultsWithRetry(page, "snapshot defaults")

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

test("restore returns pre-seeded non-factory values", async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/")
  // Seed explicit non-factory values, then snapshot them as the prior state.
  await putDefaultsWithRetry(page, "seed non-factory", {
    topBadgeScale: 130,
    ribbonEnabled: false,
    extraBadgeStyle: "corner",
    networkLogoFollowTitle: false,
  })
  const snapshot = await getDefaultsWithRetry(page, "snapshot seeded")
  expect(snapshot.topBadgeScale).toBe(130)
  expect(snapshot.ribbonEnabled).toBe(false)
  // Mutate away, then restore via the same helper the afterEach uses.
  await putDefaultsWithRetry(page, "mutate", {
    topBadgeScale: 100,
    ribbonEnabled: true,
    extraBadgeStyle: null,
    networkLogoFollowTitle: true,
  })
  await page.goto("/")
  await restoreDefaults(page, snapshot)
})
