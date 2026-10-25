import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
    localStorage.setItem("pictorium_onboarding_done", "true")
    localStorage.setItem("preferred_lang", "it")
    localStorage.setItem("pictorium_profile_id", "e2e-search-profile")
    localStorage.setItem("pictorium_profile_stateless", "1")
    localStorage.setItem("pictorium_custom_catalogs", JSON.stringify([
      { id: "audit", name: "Audit mixed list", type: "mixed", url: "https://mdblist.com/lists/audit/list" },
    ]))
  })
  // Test-isolation blackhole (same contract as the streaming spec fixture):
  // the app background-syncs localStorage custom catalogs to the server via
  // PUT /api/defaults (~400ms debounce in useCustomCatalogs). Without this,
  // the seeded "audit" list persists into the shared per-invocation DATA_DIR
  // and leaks as ghost manager rows into later specs in the same run
  // (proven: +2 "Audit mixed list" rows broke the streaming inventory count
  // 6 -> 8). Answer PUTs at the browser boundary (success, empty body) so
  // the server is never mutated; GETs stay real. Test-level routes registered
  // later (e.g. the retry test's own /api/defaults override) take precedence,
  // so they are unaffected.
  await page.route("**/api/defaults", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      return
    }
    await route.fallback()
  })
})

for (const filtered of [false, true]) {
test(filtered ? "filtered search exposes a silent page failure and retries it" : "search pages beyond a people-only page and retries the failed page", async ({ page }) => {
  const pages: number[] = []
  await page.route("**/api/tmdb/search?**", async route => {
    const n = Number(new URL(route.request().url()).searchParams.get("page"))
    pages.push(n)
    if (n === 2 && pages.filter(p => p === 2).length <= 3) {
      await route.fulfill({ status: 502, json: { error: "Temporary outage" } })
    } else {
      const movie = { id: 19994 + n, media_type: "movie", title: n === 1 ? "First title" : "Recovered title", poster_path: null }
      await route.fulfill({ json: { results: n === 1 && !filtered ? [] : [movie], total_pages: 2, total_results: 21 } })
    }
  })
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  const search = page.getByPlaceholder(/cerca/i)
  await search.fill("audit")
  await search.press("Enter")
  if (filtered) await page.getByRole("button", { name: /^Film/ }).click()
  await page.getByRole("button", { name: "Mostra più risultati" }).click()
  // Scope the retry to the search page-failure alert: a background
  // custom-catalog sync failure raises a sonner warning toast whose action
  // button carries the identical "Riprova" label (useCustomCatalogs), and an
  // unscoped lookup clicks the toast instead of retrying the failed page
  // (proven sweep flake: toast data-action click, no 4th search request).
  await page.getByRole("alert").getByRole("button", { name: "Riprova", exact: true }).click()
  await expect(page.getByText("Recovered title", { exact: true })).toBeVisible()
  expect(pages).toEqual([1, 2, 2, 2, 2])
})
}

test("mixed catalog opens series absent from preview and restores focus on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route("**/api/mdblist/custom?**", async route => {
    const series = new URL(route.request().url()).searchParams.get("media_type") === "tv"
    await route.fulfill({ json: { status: "ok", total: series ? 1 : 2, nextOffset: null, items: series
      ? [{ id: 1399, media_type: "tv", name: "Full series", poster_path: null }]
      : [{ id: 19995, media_type: "movie", title: "Preview film", poster_path: null }] } })
  })
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Sfoglia i cataloghi", exact: true }).click()
  const card = page.getByRole("button", { name: "Audit mixed list — Serie TV" })
  await expect(card).toBeVisible()
  await card.focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Audit mixed list — Serie TV" })
  await expect(dialog.getByRole("button", { name: "Full series" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).not.toBeVisible()
  await expect(card).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("")
})

test("anime fallback uses the local TMDB base and animation filter", async ({ request }) => {
  const response = await request.get("/api/tmdb/trending/tv/week?with_original_language=ja", { headers: { "x-api-key": "e2e-key" } })
  expect(response.ok()).toBeTruthy()
  const { results } = await response.json()
  expect(results.map((item: { name: string }) => item.name)).toEqual(["One Piece"])
})

test("a 400-title catalog loads thirty at a time and retries the next page", async ({ page }) => {
  const offsets: number[] = []
  await page.route("**/api/mdblist/custom?**", async route => {
    const params = new URL(route.request().url()).searchParams
    expect(params.get("limit")).toBe("30")
    const skip = Number(params.get("skip") ?? 0)
    if (params.has("skip")) offsets.push(skip)
    if (skip === 30 && offsets.filter(n => n === 30).length === 1) {
      await route.fulfill({ status: 502, json: { error: "Temporary outage" } })
      return
    }
    const items = Array.from({ length: 30 }, (_, i) => ({ id: skip + i + 1, media_type: "movie", title: `Paged title ${skip + i + 1}`, poster_path: null }))
    await route.fulfill({ json: { status: "ok", total: 400, nextOffset: skip + 30, items } })
  })
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  await page.getByRole("button", { name: "Sfoglia i cataloghi", exact: true }).click()
  await page.getByRole("button", { name: "Audit mixed list — Film" }).focus()
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Audit mixed list — Film" })
  await expect(dialog.getByText("30 di 400 titoli", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^Paged title / })).toHaveCount(30)
  await dialog.getByRole("button", { name: "Mostra più risultati" }).click()
  await expect(dialog.getByRole("alert")).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^Paged title / })).toHaveCount(30)
  await dialog.getByRole("button", { name: "Riprova", exact: true }).click()
  await expect(dialog.getByText("60 di 400 titoli", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /^Paged title / })).toHaveCount(60)
  expect(offsets).toEqual([0, 30, 30])
})

test("search retry targets the page alert when a background sync toast also offers Riprova", async ({ page }) => {
  // Deterministic reproduction of the serial-sweep flake: the custom-catalog
  // background sync PUT fails with 429, so its sonner warning toast (action
  // button also labelled "Riprova", see useCustomCatalogs) is in the DOM
  // while the search page-2 failure alert is up. The retry click must hit
  // the alert, never the toast.
  const pages: number[] = []
  let resolveSyncFail: (() => void) | null = null
  const syncFailGate = new Promise<void>((resolve) => { resolveSyncFail = resolve })
  let syncPutSeen = false
  await page.route("**/api/defaults", async (route) => {
    if (route.request().method() === "GET") {
      // Real server state with diverged catalogs: forces the background sync
      // PUT (lastSync !== local payload) without touching other defaults.
      const res = await route.fetch()
      const body = (await res.json()) as Record<string, unknown>
      await route.fulfill({
        response: res,
        json: {
          ...body,
          customCatalogs: [],
          disabledCatalogIds: [],
          homeDisabledCatalogIds: [],
          catalogOrder: [],
          catalogRenames: {},
          catalogShapes: {},
        },
      })
      return
    }
    // Hold the sync PUT failure until the search exhausted its internal
    // retries (3rd page-2 attempt): the toast then overlaps the page alert
    // deterministically — event-gated on real requests, no fixed sleeps.
    syncPutSeen = true
    await syncFailGate
    await route.fulfill({ status: 429, headers: { "Retry-After": "1" }, json: { error: "Rate limited" } })
  })
  await page.route("**/api/tmdb/search?**", async (route) => {
    const n = Number(new URL(route.request().url()).searchParams.get("page"))
    pages.push(n)
    if (n === 2) {
      const attempt = pages.filter((p) => p === 2).length
      if (attempt >= 3) resolveSyncFail?.()
      if (attempt <= 3) {
        await route.fulfill({ status: 502, json: { error: "Temporary outage" } })
        return
      }
    }
    const movie = { id: 19994 + n, media_type: "movie", title: n === 1 ? "First title" : "Recovered title", poster_path: null }
    await route.fulfill({ json: { results: [movie], total_pages: 2, total_results: 21 } })
  })
  await page.goto("/")
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  const search = page.getByPlaceholder(/cerca/i)
  await search.fill("audit")
  await search.press("Enter")
  await page.getByRole("button", { name: "Mostra più risultati" }).click()
  // Both failure surfaces up at once: the page alert AND the sync toast.
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page.getByRole("button", { name: "Riprova", exact: true })).toHaveCount(2)
  await page.getByRole("alert").getByRole("button", { name: "Riprova", exact: true }).click()
  await expect(page.getByText("Recovered title", { exact: true })).toBeVisible()
  expect(syncPutSeen).toBe(true)
  expect(pages).toEqual([1, 2, 2, 2, 2])
})
