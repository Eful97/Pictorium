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
  await page.getByRole("button", { name: "Riprova", exact: true }).click()
  await expect(page.getByText("Recovered title", { exact: true })).toBeVisible()
  expect(pages).toEqual([1, 2, 2, 2, 2])
})
}

test("mixed catalog opens series absent from preview and restores focus on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route("**/api/mdblist/custom?**", async route => {
    const full = new URL(route.request().url()).searchParams.get("limit") === "500"
    await route.fulfill({ json: { status: "ok", total: 2, items: full
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
