import { test, expect, type Page } from "@playwright/test"
import { putDefaultsWithRetry } from "./defaults-retry"

// Settings > Trasforma preview-only (Verticale/Orizzontale).
// Nessuno snapshot: solo trasporto reale (request preview demo) e aspect.
// Le API esterne sono servite dal mock server (playwright.config.ts).

const DEMO_PATH = "/api/poster/movie/19995"

function tryDemoUrl(raw: string): URL | null {
  if (!raw.includes(DEMO_PATH)) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  return u.searchParams.get("preview") === "1" ? u : null
}

interface Seen {
  urls: string[]
}

/** Log di tutte le request preview demo (anche quelle già partite). */
function collectPreviewRequests(page: Page, seen: Seen) {
  page.on("request", (req) => {
    if (tryDemoUrl(req.url())) seen.urls.push(req.url())
  })
}

function findParams(urls: string[], from: number, pred: (u: URL) => boolean): URLSearchParams | null {
  for (const raw of urls.slice(from)) {
    const u = tryDemoUrl(raw)
    if (u && pred(u)) return u.searchParams
  }
  return null
}

/** Qualsiasi request (anche precedente) che soddisfa `pred`. */
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

/**
 * Dopo `action`, attende una NUOVA request che soddisfa `pred`
 * (prova il live update; le request precedenti non contano).
 */
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
      localStorage.setItem("pictorium_profile_id", "e2e-transform")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "")
    } catch {}
  })
}

/**
 * Default server deterministici (merge parziale, pattern di
 * button-interactions.spec.ts): isola dagli altri spec che persistono
 * tuning condiviso nella stessa data-dir. Landscape sostituito in toto
 * (merge shallow), con override diversi dai flat per provare il profilo.
 */
async function resetServerDefaults(page: Page) {
  await page.goto("/")
  await putDefaultsWithRetry(page, "reset defaults", {
    gradientHeight: 30,
    topBadgeScale: 100,
    qualityBadgeOffsetX: -10,
    qualityBadgeOffsetY: 15,
    landscape: {
      gradientHeight: 20,
      topBadgeScale: 120,
      qualityBadgeOffsetX: 7,
      qualityBadgeOffsetY: -7,
    },
  })
  await page.goto("/")
}

test.describe("Trasforma Verticale/Orizzontale preview-only", () => {
  test("desktop: tab Orizzontale → landscape live, slider → nuovi params, Verticale → flat", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await resetServerDefaults(page)
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)

    // Apro Impostazioni (tab Badge): la preview parte subito dai default.
    await page.getByRole("button", { name: /Impostazioni/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    let p = await waitPreview(seen)
    expect(p.get("shape")).toBe("poster")
    expect(p.get("gradHeight")).toBe("30")

    // Passo a Trasforma (sotto-tab Verticale): stesso URL → nessun refetch.
    const before = seen.urls.length
    await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    const panel = dialog.getByRole("tabpanel", { name: "Trasforma" })
    await expect(panel).toBeVisible()
    await page.waitForTimeout(1500)
    expect(seen.urls.length).toBe(before)
    p = await waitPreview(seen)
    expect(p.get("shape")).toBe("poster")

    // Landscape via the single top selector (before the controls): profiled landscape request.
    const formatTarget = dialog.getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()
    p = await nextPreview(seen, async () => {
      await formatTarget.getByText("Orizzontale", { exact: true }).click()
    })
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("gradHeight")).toBe("20")
    expect(p.get("tscale")).toBe("120")
    expect(p.get("qox")).toBe("7")
    expect(p.get("qoy")).toBe("-7")
    // Aspect conforme all'URL.
    const previewBox = page.getByTestId("settings-preview")
    await expect(previewBox.locator(".aspect-video")).toBeVisible()

    // Slider live reali (tastiera): Altezza Orizzontale 20 → 25.
    const landSection = panel.getByText("Override sfumatura Orizzontale").locator("..")
    const height = landSection.getByLabel("Altezza", { exact: true })
    await expect(height).toHaveValue("20")
    await height.focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
    p = await nextPreview(seen, async () => {}, (u) => u.searchParams.get("gradHeight") === "25")
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("gradHeight")).toBe("25")

    // Scala badge superiore Orizzontale 120 → 125.
    const topCard = landSection.getByText("Badge superiore", { exact: true }).locator("xpath=../..")
    const scale = topCard.getByLabel("Scala", { exact: true })
    await expect(scale).toHaveValue("120")
    await scale.focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
    p = await nextPreview(seen, async () => {}, (u) => u.searchParams.get("tscale") === "125")
    expect(p.get("tscale")).toBe("125")

    // Back to Portrait from the single selector: original flats, no mixing.
    p = await nextPreview(seen, async () => {
      await formatTarget.getByText("Verticale", { exact: true }).click()
    })
    expect(p.get("shape")).toBe("poster")
    expect(p.get("gradHeight")).toBe("30")
    expect(p.get("tscale")).toBe("100")
    expect(p.get("qox")).toBe("-10")
    await expect(previewBox.locator(".aspect-video")).toHaveCount(0)

    // Tab Badge: default esistente (portrait), nessun refetch spurio.
    const n = seen.urls.length
    await dialog.getByRole("tab", { name: "Badge", exact: true }).click()
    await page.waitForTimeout(1500)
    expect(seen.urls.length).toBe(n)
    p = await waitPreview(seen)
    expect(p.get("shape")).toBe("poster")
  })

  test("mobile: Orizzontale → landscape live + aspect, Verticale → flat", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await resetServerDefaults(page)
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)

    await page.getByRole("button", { name: /Impostazioni/i }).click()
    // Su mobile la nav tab è un select visibile.
    const category = page.locator("select:visible").first()
    await expect(category).toBeVisible()
    let p = await waitPreview(seen)
    expect(p.get("shape")).toBe("poster")

    await category.selectOption("trasforma")
    const panel = page.getByRole("tabpanel", { name: "Trasforma" }).filter({ visible: true }).first()
    await expect(panel).toBeVisible()

    p = await nextPreview(seen, async () => {
      await page.locator(".settings-panel:visible").getByTestId("format-target-selector").getByText("Orizzontale", { exact: true }).click()
    })
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("gradHeight")).toBe("20")
    expect(p.get("qox")).toBe("7")
    // Preview compatta sopra i controlli, conforme all'URL.
    const compact = page.locator(".settings-panel:visible").first()
    await expect(compact.locator(".aspect-video").first()).toBeVisible()

    const landSection = panel.getByText("Override sfumatura Orizzontale").locator("..")
    const height = landSection.getByLabel("Altezza", { exact: true })
    await expect(height).toHaveValue("20")
    await height.focus()
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
    p = await nextPreview(seen, async () => {}, (u) => u.searchParams.get("gradHeight") === "25")
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("gradHeight")).toBe("25")

    p = await nextPreview(seen, async () => {
      await page.locator(".settings-panel:visible").getByTestId("format-target-selector").getByText("Verticale", { exact: true }).click()
    })
    expect(p.get("shape")).toBe("poster")
    expect(p.get("gradHeight")).toBe("30")
  })
})
