import { test, expect, type Page } from "@playwright/test"

// Settings defaults preview: title search (Avatar -> TV), click-to-zoom and
// demo-samples badges. Transport-level only (mock TMDB via mock-server +
// page.route on /api/tmdb/search); the poster backend is always the real
// route. No snapshots here: isolated screenshots under artifacts/.

const CASA_PAYLOAD = {
  results: [
    {
      id: 1399,
      media_type: "tv",
      name: "La casa di carta",
      poster_path: "/casa.jpg",
      first_air_date: "2017-05-02",
      vote_average: 8.2,
    },
  ],
  total_results: 1,
  total_pages: 1,
}

interface Seen {
  urls: string[]
}

function isPreviewPoster(raw: string): URL | null {
  if (!/\/api\/poster\/(movie|tv)\//.test(raw)) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  return u.searchParams.get("preview") === "1" ? u : null
}

function collectPreviewRequests(page: Page, seen: Seen) {
  page.on("request", (req) => {
    if (isPreviewPoster(req.url())) seen.urls.push(req.url())
  })
}

function findParams(urls: string[], from: number, pred: (u: URL) => boolean): URLSearchParams | null {
  for (const raw of urls.slice(from)) {
    const u = isPreviewPoster(raw)
    if (u && pred(u)) return u.searchParams
  }
  return null
}

async function waitPreview(seen: Seen, pred: (u: URL) => boolean = () => true) {
  let out: URLSearchParams | null = null
  await expect
    .poll(
      () => {
        out = findParams(seen.urls, 0, pred)
        return out ? "ok" : null
      },
      { timeout: 30_000 },
    )
    .not.toBeNull()
  return out as unknown as URLSearchParams
}

async function nextPreview(seen: Seen, action: () => Promise<unknown>, pred: (u: URL) => boolean = () => true) {
  const n = seen.urls.length
  await action()
  let out: URLSearchParams | null = null
  await expect
    .poll(
      () => {
        out = findParams(seen.urls, n, pred)
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
      localStorage.setItem("pictorium_profile_id", "e2e-demo-samples")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
    } catch {}
  })
}

/** Deterministic badge toggles ON (isolates from other specs' persisted defaults).
 * Covers the full Essenziale preset surface (8 setters, portrait branch in
 * BadgeDefaultsSection.applyEssential): without badgeStyle a previous
 * Essenziale click leaks bs=minimal into later preview URLs. */
/**
 * Parse dell'header `Retry-After` (429) per il backoff mirato: delta-secondi
 * o HTTP-date, cap 30s come il server (`parseRetryAfter` in src/lib/http.ts);
 * header assente/invalido → 3000ms (refill documentato del bucket defaults:
 * burst 30, 3 token/sec). Solo lettura header, nessun segreto coinvolto.
 */
function retryAfterMs(header: string | null): number {
  const raw = (header ?? "").trim()
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), 30) * 1000
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) {
    const waitMs = asDate - Date.now()
    return waitMs > 0 ? Math.min(waitMs, 30_000) : 3000
  }
  return 3000
}

// resetBadgeToggles: helper condiviso dai test del file (non esportato).
async function resetBadgeToggles(page: Page) {
  await page.goto("/")
  const payload = {
    globalBadges: true,
    rankingBadges: true,
    badgeGenre: true,
    badgeYear: true,
    badgeRating: true,
    badgeQuality: true,
    networkLogo: true,
    badgeStyle: "shadow",
  }
  // Retry limitato al solo 429 del rate limiter (burst seriale): max 3 tentativi
  // totali (iniziale + 2), attesa Retry-After o 3000ms via page.waitForTimeout.
  // Qualsiasi altro status lancia subito; il 429 finale lancia con errore chiaro.
  let lastStatus = 0
  let lastBody = ""
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await page.evaluate(async (body) => {
      const r = await fetch("/api/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      return {
        ok: r.ok,
        status: r.status,
        retryAfter: r.headers.get("Retry-After"),
        body: (await r.text()).slice(0, 200),
      }
    }, payload)
    if (res.ok) {
      await page.goto("/")
      return
    }
    lastStatus = res.status
    lastBody = res.body
    if (res.status !== 429 || attempt === 3) break
    await page.waitForTimeout(retryAfterMs(res.retryAfter))
  }
  throw new Error(`reset defaults: ${lastStatus} ${lastBody} (after 3 attempts)`)
}

/** Seed without clearing storage (persistence across reload must survive). */
async function seedPersist(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("pictorium_profile_id", "e2e-demo-persist")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
    } catch {}
  })
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: /Impostazioni/i }).click()
  const dialog = page.getByRole("dialog").first()
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe("Settings demo samples: search, zoom, badges", () => {
  test("initial Avatar preview carries demosamples=1 and shows the notice", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)
    const dialog = await openSettings(page)
    const p = await waitPreview(seen, (u) => u.pathname.includes("/movie/19995"))
    expect(p.get("preview")).toBe("1")
    expect(p.get("demosamples")).toBe("1")
    expect(p.get("rv")).toBeTruthy()
    const image = dialog.getByAltText("Avatar")
    await expect(image).toBeVisible({ timeout: 45_000 })
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    await expect(dialog.getByText(/dati dimostrativi/)).toBeVisible()
  })

  test("delayed stale search never selects the wrong title", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    const dialog = await openSettings(page)
    const search = dialog.locator('[data-testid="defaults-preview-title-search"]')
    await expect(search.getByRole("textbox")).toBeVisible()
    let calls = 0
    await page.route("**/api/tmdb/search**", async (route) => {
      calls += 1
      if (calls === 1) {
        await new Promise((r) => setTimeout(r, 900))
        await route.fulfill({ json: CASA_PAYLOAD })
      } else {
        await route.continue()
      }
    })
    const box = search.getByRole("textbox")
    await box.fill("casa")
    await box.press("Enter")
    await box.fill("")
    await box.fill("avatar")
    await box.press("Enter")
    await expect(search.getByRole("option", { name: /Avatar/ })).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1500)
    await expect(search.getByRole("option", { name: /La casa di carta/ })).toHaveCount(0)
  })

  test("selecting a TV title switches path, caption, alt and keeps styles", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)
    await page.route("**/api/tmdb/search**", async (route) => {
      await route.fulfill({ json: CASA_PAYLOAD })
    })
    const dialog = await openSettings(page)
    const before = await waitPreview(seen, (u) => u.pathname.includes("/movie/19995"))
    const previewBox = page.getByTestId("settings-preview")
    const search = dialog.locator('[data-testid="defaults-preview-title-search"]')
    const box = search.getByRole("textbox")
    await box.fill("casa")
    await box.press("Enter")
    await search.getByRole("option", { name: /La casa di carta/ }).click()
    const after = await nextPreview(
      seen,
      async () => {},
      (u) => u.pathname.includes("/api/poster/tv/1399") && u.searchParams.get("demosamples") === "1",
    )
    expect(after.get("preview")).toBe("1")
    expect(after.get("shape")).toBe(before.get("shape"))
    expect(after.get("bs")).toBe(before.get("bs"))
    expect(after.get("rs")).toBe(before.get("rs"))
    await expect(previewBox.getByText("La casa di carta", { exact: true }).first()).toBeVisible()
    const image = previewBox.getByAltText("La casa di carta")
    await expect(image).toBeVisible({ timeout: 45_000 })
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    await page.screenshot({ path: "artifacts/settings-demo-tv.png" })
  })

  test("zoom opens real, closes via second click, Escape and backdrop; settings survive", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    const dialog = await openSettings(page)
    const previewBox = page.getByTestId("settings-preview")
    const image = previewBox.getByAltText("Avatar")
    await expect(image).toBeVisible({ timeout: 45_000 })
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    const opener = previewBox.getByLabel(/Ingrandisci/)
    const dialogs = page.getByRole("dialog")

    // Open: a second dialog with the enlarged image.
    await opener.click()
    await expect(dialogs).toHaveCount(2)
    const zoom = dialogs.nth(1)
    const zoomed = zoom.getByAltText("Avatar")
    await expect(zoomed).toBeVisible()
    await expect.poll(() => zoomed.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    const zb = (await zoomed.boundingBox())!
    expect(zb.x).toBeGreaterThanOrEqual(0)
    expect(zb.x + zb.width).toBeLessThanOrEqual(1280)
    await page.screenshot({ path: "artifacts/settings-demo-zoom.png" })

    // Second click restores: settings stay open, focus returns to the opener.
    await zoomed.click()
    await expect(dialogs).toHaveCount(1)
    await expect(dialog).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toContain("Ingrandisci")

    // Escape closes only the zoom.
    await opener.click()
    await expect(dialogs).toHaveCount(2)
    await page.keyboard.press("Escape")
    await expect(dialogs).toHaveCount(1)
    await expect(dialog).toBeVisible()

    // Backdrop closes only the zoom.
    await opener.click()
    await expect(dialogs).toHaveCount(2)
    await page.mouse.click(12, 12)
    await expect(dialogs).toHaveCount(1)
    await expect(dialog).toBeVisible()
  })

  test("landscape stays in sync after a title switch", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)
    await page.route("**/api/tmdb/search**", async (route) => {
      await route.fulfill({ json: CASA_PAYLOAD })
    })
    const dialog = await openSettings(page)
    await waitPreview(seen, (u) => u.pathname.includes("/movie/19995"))
    const search = dialog.locator('[data-testid="defaults-preview-title-search"]')
    const box = search.getByRole("textbox")
    await box.fill("casa")
    await box.press("Enter")
    await search.getByRole("option", { name: /La casa di carta/ }).click()
    await nextPreview(seen, async () => {}, (u) => u.pathname.includes("/api/poster/tv/1399"))
    await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    const panel = dialog.getByRole("tabpanel", { name: "Trasforma" })
    await expect(panel).toBeVisible()
    const p = await nextPreview(
      seen,
      async () => {
        // Single external edit-target selector (T1): the Trasforma panel no
        // longer owns an inner Orizzontale switch.
        await dialog.getByTestId("format-target-selector").getByText("Orizzontale", { exact: true }).click()
      },
      (u) => u.pathname.includes("/api/poster/tv/1399") && u.searchParams.get("shape") === "landscape",
    )
    expect(p.get("demosamples")).toBe("1")
    await expect(page.getByTestId("settings-preview").locator(".aspect-video")).toBeVisible()
  })

  test("mobile 390px: search and zoom fit without overflow or shifts", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await resetBadgeToggles(page)
    await page.route("**/api/tmdb/search**", async (route) => {
      await route.fulfill({ json: CASA_PAYLOAD })
    })
    const dialog = await openSettings(page)
    const overflowX = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await overflowX()).toBeLessThanOrEqual(1)
    const search = dialog.locator('[data-testid="defaults-preview-title-search"]')
    // Mobile compact: the search body starts closed by design; expand it via
    // the public toggle before asserting the textbox.
    await search.getByTestId("defaults-preview-search-toggle").click()
    const box = search.getByRole("textbox")
    await expect(box).toBeVisible()
    await box.fill("casa")
    await box.press("Enter")
    const option = search.getByRole("option", { name: /La casa di carta/ })
    await expect(option).toBeVisible()
    const ob = (await option.boundingBox())!
    expect(ob.x).toBeGreaterThanOrEqual(0)
    expect(ob.x + ob.width).toBeLessThanOrEqual(391)
    await option.click()
    const opener = dialog.getByLabel(/Ingrandisci/)
    await opener.click()
    const dialogs = page.getByRole("dialog")
    await expect(dialogs).toHaveCount(2)
    const zb = (await dialogs.nth(1).getByAltText("La casa di carta").boundingBox())!
    expect(zb.x).toBeGreaterThanOrEqual(0)
    expect(zb.x + zb.width).toBeLessThanOrEqual(391)
    await page.screenshot({ path: "artifacts/settings-demo-mobile-zoom.png" })
    await dialogs.nth(1).getByAltText("La casa di carta").click()
    await expect(dialogs).toHaveCount(1)
    expect(await overflowX()).toBeLessThanOrEqual(1)
  })

  test("server samples rank/quality for a title without genuine data, real wins otherwise", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    await page.goto("/")
    const api = (qs: string) =>
      page.request.get(`/api/poster/tv/1399?${qs}&lang=it&api_key=mock-tmdb-key-0000000000`)
    // Sampled: tv/1399 is in no mock chart and has no mock offers.
    const sampled = await api("badges=1&ranking=1&preview=1&demosamples=1&debug=1")
    expect(sampled.status()).toBe(200)
    const s = await sampled.json()
    expect(s.rankings.finalRank).toBe(11)
    expect(s.quality.value).toBe("4K")
    // Ratings are genuinely mocked (MDBList): real average wins, not samples.
    expect(s.vote.average).toBeCloseTo(8.3, 5)
    expect(s.genre.name).toBe("Azione")
    // Actual render differs with samples on (rank pill + quality + network).
    const imgOn = await page.request.get(
      "/api/poster/tv/1399?badges=1&ranking=1&preview=1&demosamples=1&lang=it&api_key=mock-tmdb-key-0000000000",
    )
    const imgOff = await page.request.get(
      "/api/poster/tv/1399?badges=1&ranking=1&preview=1&lang=it&api_key=mock-tmdb-key-0000000000",
    )
    expect(imgOn.status()).toBe(200)
    expect(imgOff.status()).toBe(200)
    expect(Buffer.compare(await imgOn.body(), await imgOff.body())).not.toBe(0)
    // Genuine chart rank wins over the sample on Avatar.
    const avatar = await page.request.get(
      "/api/poster/movie/19995?badges=1&ranking=1&preview=1&demosamples=1&debug=1&lang=it&api_key=mock-tmdb-key-0000000000",
    )
    expect(avatar.status()).toBe(200)
    expect((await avatar.json()).rankings.finalRank).toBe(1)
  })

  test("switching badges off disables those slots even with samples", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)
    const dialog = await openSettings(page)
    await waitPreview(seen, (u) => u.pathname.includes("/movie/19995"))
    const n = seen.urls.length
    await dialog.getByRole("button", { name: /Essenziale/ }).click()
    const p = await nextPreview(seen, async () => {}, (u) => u.searchParams.get("ranking") === "0")
    expect(p.get("ranking")).toBe("0")
    expect(seen.urls.length).toBeGreaterThan(n)
    // Server gate: no rank badge data with ranking off, samples or not.
    const debug = await page.request.get(
      "/api/poster/movie/19995?badges=1&ranking=0&preview=1&demosamples=1&debug=1&lang=it&api_key=mock-tmdb-key-0000000000",
    )
    expect(debug.status()).toBe(200)
    expect((await debug.json()).rankings.finalRank).toBeNull()
  })

  test("desktop short height keeps search, results and preview usable", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 700 })
    await resetBadgeToggles(page)
    await page.route("**/api/tmdb/search**", async (route) => {
      await route.fulfill({ json: CASA_PAYLOAD })
    })
    const dialog = await openSettings(page)
    const dlgBox = (await dialog.boundingBox())!
    const search = dialog.locator('[data-testid="defaults-preview-title-search"]')
    const box = search.getByRole("textbox")
    await expect(box).toBeVisible()
    const bb = (await box.boundingBox())!
    expect(bb.y).toBeGreaterThanOrEqual(dlgBox.y)
    expect(bb.y + bb.height).toBeLessThanOrEqual(dlgBox.y + dlgBox.height + 1)
    await box.fill("casa")
    await box.press("Enter")
    const option = search.getByRole("option", { name: /La casa di carta/ })
    // The preview column scrolls internally: reach the result, no footer trap.
    const previewCol = page.getByTestId("settings-preview")
    await previewCol.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(option).toBeVisible({ timeout: 15_000 })
    const ob = (await option.boundingBox())!
    // Result reachable inside the dialog (scrolls instead of clipping).
    expect(ob.y).toBeGreaterThanOrEqual(dlgBox.y)
    expect(ob.y + ob.height).toBeLessThanOrEqual(dlgBox.y + dlgBox.height + 1)
    const previewBox = page.getByTestId("settings-preview")
    await expect(previewBox).toBeVisible()
    const pb = (await previewBox.boundingBox())!
    expect(pb.y).toBeGreaterThanOrEqual(dlgBox.y)
    expect(pb.y + pb.height).toBeLessThanOrEqual(dlgBox.y + dlgBox.height + 1)
  })

  test("selected title persists across close, reopen and reload; reset restores Avatar", async ({ page }) => {
    await seedPersist(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetBadgeToggles(page)
    await page.route("**/api/tmdb/search**", async (route) => {
      await route.fulfill({ json: CASA_PAYLOAD })
    })
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)
    const tvUrl = (from: number): Promise<string> => {
      let out: string | null = null
      return expect
        .poll(
          () => {
            out = seen.urls.slice(from).find((u) => u.includes("/api/poster/tv/1399")) ?? null
            return out
          },
          { timeout: 30_000 },
        )
        .not.toBeNull()
        .then(() => out as string)
    }

    // Select the tv title: records the exact preview URL.
    let dialog = await openSettings(page)
    let search = dialog.locator('[data-testid="defaults-preview-title-search"]')
    let box = search.getByRole("textbox")
    await box.fill("casa")
    await box.press("Enter")
    await search.getByRole("option", { name: /La casa di carta/ }).click()
    const first = await tvUrl(0)

    // Close + reopen: same title, byte-identical preview URL.
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    const mark2 = seen.urls.length
    dialog = await openSettings(page)
    const second = await tvUrl(mark2)
    expect(second).toBe(first)
    await expect(dialog.getByText("La casa di carta", { exact: true }).first()).toBeVisible()

    // Reload: the persisted title is still selected.
    const mark3 = seen.urls.length
    await page.reload()
    dialog = await openSettings(page)
    const third = await tvUrl(mark3)
    expect(third).toBe(first)
    await expect(dialog.getByText("La casa di carta", { exact: true }).first()).toBeVisible()

    // Reset to Avatar: the preference slot is removed.
    search = dialog.locator('[data-testid="defaults-preview-title-search"]')
    box = search.getByRole("textbox")
    await expect(box).toBeVisible()
    await dialog.getByLabel(/Torna ad Avatar/).click()
    let avatarUrl: string | null = null
    const aFrom = seen.urls.length
    await expect
      .poll(
        () => {
          avatarUrl = seen.urls.slice(aFrom).find((u) => u.includes("/api/poster/movie/19995")) ?? null
          return avatarUrl
        },
        { timeout: 30_000 },
      )
      .not.toBeNull()
    expect(avatarUrl).toContain("/api/poster/movie/19995")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    dialog = await openSettings(page)
    await expect(dialog.getByText("La casa di carta", { exact: true })).toHaveCount(0)
    await expect(dialog.getByText(/Campione dimostrativo/)).toBeVisible()

    // Reload after reset: still Avatar, no stale title.
    await page.reload()
    dialog = await openSettings(page)
    await expect(dialog.getByText(/Campione dimostrativo/)).toBeVisible({ timeout: 30_000 })
    await expect(dialog.getByText("La casa di carta", { exact: true })).toHaveCount(0)
  })
})
