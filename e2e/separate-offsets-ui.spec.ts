import { expect, test, type Page } from "@playwright/test"

// Separati in editor (browser reale): scala UI 100 = raw sepscale=130 in
// preview, e lo slider X scrive sepox nella preview. Profilo stateless
// dedicato (nessun effetto sulle impostazioni degli altri spec).
test.describe("Separate ratings editor scale + offsets", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
        localStorage.setItem("pictorium_profile_id", "e2e-separate-offsets")
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
        localStorage.setItem("badgeDefaults", JSON.stringify({
          globalBadges: true,
          badgeRating: true,
          separateRatings: true,
          // Chiave default (non solo current): il payload persistito
          // (defaultsToPayload) salva solo le chiavi default e l'apertura
          // titolo ricarica dallo storage — senza questa l'hydration
          // server la azzera a false e la card sparisce.
          defaultSeparateRatings: true,
          separateBadgeScale: 130,
        }))
      } catch {}
    })
  })

  async function openAvatarEditor(page: Page) {
    await page.goto("/")
    // Arrange deterministico via API reale (dopo il goto: il fetch relativo
    // richiede un'origine): gli spec precedenti nella run seriale salvano
    // un mapping per Avatar (movie:19995, separateRatings false) e l'editor
    // per-titolo lo eredita — senza reset la card "Rating separati" resta
    // nascosta nonostante i default seedati.
    await page.evaluate(async () => {
      const r = await fetch("/api/mappings/movie:19995", { method: "DELETE" })
      if (!r.ok) throw new Error(`reset mapping: ${r.status} ${await r.text()}`)
    })
    const search = page.getByPlaceholder(/cerca/i)
    await search.fill("avatar")
    await search.press("Enter")
    await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
    await page.getByText(/Avatar/i).first().click()
    await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 10_000 })
    await page.getByRole("tab", { name: "Trasforma" }).click()
    const card = page.locator("div.rounded-xl", { hasText: "Rating separati · Verticale" }).last()
    await expect(card).toBeVisible({ timeout: 10_000 })
    return card
  }

  function lastSepRequest(requests: string[]) {
    const seps = requests.filter((u) => u.includes("/api/poster/") && u.includes("sep=1"))
    return seps.length > 0 ? seps[seps.length - 1] : ""
  }

  test("scale slider shows UI 100 and preview carries raw sepscale=130", async ({ page }) => {
    const posterRequests: string[] = []
    page.on("request", (req) => {
      if (req.url().includes("/api/poster/")) posterRequests.push(req.url())
    })
    const card = await openAvatarEditor(page)
    const scale = card.getByRole("slider", { name: "Scala", exact: true })
    await expect(scale).toHaveValue("100")
    await expect(scale).toHaveAttribute("aria-valuetext", "100%")
    await expect
      .poll(() => lastSepRequest(posterRequests), { timeout: 30_000 })
      .toContain("sepscale=130")
  })

  test("X offset slider updates preview sepox", async ({ page }) => {
    const posterRequests: string[] = []
    page.on("request", (req) => {
      if (req.url().includes("/api/poster/")) posterRequests.push(req.url())
    })
    const card = await openAvatarEditor(page)
    const xSlider = card.getByRole("slider", { name: "X", exact: true })
    await expect(xSlider).toHaveAttribute("aria-valuetext", "0px")
    await xSlider.fill("40")
    await expect
      .poll(() => lastSepRequest(posterRequests), { timeout: 30_000 })
      .toContain("sepox=40")
    await expect(xSlider).toHaveAttribute("aria-valuetext", "40px")
  })
})
