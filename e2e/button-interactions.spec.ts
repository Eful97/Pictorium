import { expect, test } from "@playwright/test"
import { DEFAULT_BADGE_STYLE, DEFAULT_RANKING_BADGE_STYLE } from "../src/lib/badge-styles"
import { DEFAULT_RATING_SOURCES } from "../src/lib/rating-weights"

test.describe("Button interactions and immediate updates", () => {
  // The Settings flows below persist through the shared single-instance
  // defaults namespace (MULTI_USER is off in E2E, PUT shallow-merges so
  // omitted keys can never delete). Restore the mutated root keys to the
  // single-source code defaults on exit, otherwise later specs inherit style
  // / sources / rank choices (xbs/rsrc/rs leaks observed in serial runs).
  // Explicit code defaults are absence-equivalent in every resolution chain.
  test.afterEach(async ({ page }) => {
    // Settle trailing debounced UI autosaves (500ms in useDefaults) BEFORE
    // the restore PUT, never after it.
    await page.waitForTimeout(1200)
    await page.goto("/")
    const clean = {
      badgeStyle: DEFAULT_BADGE_STYLE,
      extraBadgeStyle: null,
      ratingSources: [...DEFAULT_RATING_SOURCES],
      rankingBadgeStyle: DEFAULT_RANKING_BADGE_STYLE,
    }
    await page.evaluate(async (body) => {
      const r = await fetch("/api/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`restore defaults: ${r.status} ${await r.text()}`)
    }, clean)
    const got = (await page.evaluate(async () => {
      const r = await fetch("/api/defaults")
      if (!r.ok) throw new Error(`verify defaults: ${r.status}`)
      return (await r.json()) as Record<string, unknown>
    })) as Record<string, unknown>
    expect(got.badgeStyle).toBe(clean.badgeStyle)
    expect(got.extraBadgeStyle).toBe(clean.extraBadgeStyle)
    expect(got.ratingSources).toEqual(clean.ratingSources)
    expect(got.rankingBadgeStyle).toBe(clean.rankingBadgeStyle)
    // The "Salva Poster" flow persists a per-title mapping for the shared
    // fixture id (movie:19995, Avatar) in the data-dir shared by all e2e
    // files. Its saved extraBadgeStyle/rankingBadgeStyle/quality offsets
    // shadow query legacy semantics (xbs-absent `rs` fallback) and the
    // landscape quality-offset factory in later specs (proven G2: with this
    // mapping the F1 pair renders byte-identical and the F2 landscape shot
    // reproduces the recorded actual PNG sha256 exactly). Delete it on exit,
    // mirroring custom-poster.spec.ts cleanup for seeded mappings.
    await page.evaluate(async () => {
      await fetch("/api/mappings/movie:19995", { method: "DELETE" })
    })
  })
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
        localStorage.setItem("pictorium_profile_id", "e2e-buttons-profile")
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
      } catch {}
    })
  })

  test("Header & navigation buttons respond immediately", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

    // 1. Installa Hub button opens modal, and modal close button works immediately
    const installBtn = page.getByRole("button", { name: /Installa Hub/i })
    await expect(installBtn).toBeVisible()
    await installBtn.click()
    const modalHeading = page.getByRole("heading", { name: /Collega Pictorium|Installa Pictorium/i })
    await expect(modalHeading).toBeVisible()
    // Close modal via accessible close button
    const closeBtn = page.getByRole("button", { name: "Chiudi" }).first()
    await closeBtn.click()
    await expect(modalHeading).not.toBeVisible()

    // 2. Cataloghi button navigates to cataloghi and toggles back immediately
    const cataloghiBtn = page.getByRole("button", { name: "Cataloghi", exact: true })
    await cataloghiBtn.click()
    await expect(page.getByRole("heading", { name: "Cataloghi", exact: true })).toBeVisible()

    // In Cataloghi: test "Priorità & Nomi" modal open & close
    const managerBtn = page.getByRole("button", { name: /Priorità & Nomi/i })
    await managerBtn.click()
    await expect(page.getByText(/Priorità & Nomi Cataloghi Stremio/i)).toBeVisible()
    const closeManagerBtn = page.getByRole("button", { name: "Chiudi" }).first()
    await closeManagerBtn.click()
    await expect(page.getByText(/Priorità & Nomi Cataloghi Stremio/i)).not.toBeVisible()

    // In Cataloghi: test "Aggiungi Catalogo" modal open & close
    const addCatBtn = page.getByRole("button", { name: /Aggiungi Catalogo/i })
    await addCatBtn.click()
    await expect(page.getByText("Nuovo Catalogo")).toBeVisible()
    const closeAddCatBtn = page.getByRole("button", { name: "Chiudi" }).first()
    await closeAddCatBtn.click()
    await expect(page.getByText("Nuovo Catalogo")).not.toBeVisible()

    // Click Cataloghi again to toggle back immediately
    await cataloghiBtn.click()
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible()

    // 3. I Miei Poster button navigates to myposters and toggles back immediately
    const myPostersBtn = page.getByRole("button", { name: /I miei poster/i })
    await myPostersBtn.click()
    await expect(page.getByRole("heading", { name: /I miei poster/i })).toBeVisible()

    // In MyPosters: test type filter chips
    const filmFilter = page.getByRole("button", { name: "Film", exact: true })
    const tuttiFilter = page.getByRole("button", { name: "Tutti", exact: true })
    await filmFilter.click()
    await expect(filmFilter).toHaveClass(/bg-accent-orange\/15/)
    await expect(tuttiFilter).not.toHaveClass(/bg-accent-orange\/15/)
    await tuttiFilter.click()
    await expect(tuttiFilter).toHaveClass(/bg-accent-orange\/15/)

    // In MyPosters: test Sort dropdown button
    const sortBtn = page.getByRole("button", { name: /Recenti|A-Z/i }).first()
    await sortBtn.click()
    const sortAZBtn = page.getByRole("button", { name: "A-Z" })
    await expect(sortAZBtn).toBeVisible()
    await sortAZBtn.click()

    // In MyPosters: test selection mode toggle button
    const selectModeBtn = page.getByRole("button", { name: "Seleziona" })
    await selectModeBtn.click()
    const cancelSelectBtn = page.getByRole("button", { name: "Annulla" })
    await expect(cancelSelectBtn).toBeVisible()
    await cancelSelectBtn.click()
    await expect(selectModeBtn).toBeVisible()

    // Click I Miei Poster again to toggle back immediately
    await myPostersBtn.click()
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible()

    // 4. Proxy Modal button opens and closes
    const proxyBtn = page.getByRole("button", { name: /Addon Proxy/i })
    if (await proxyBtn.isVisible()) {
      await proxyBtn.click()
      await expect(page.getByRole("heading", { name: /Generatore Addon Proxy/i })).toBeVisible()
      const closeProxy = page.getByRole("button", { name: "Chiudi" }).first()
      await closeProxy.click()
      await expect(page.getByRole("heading", { name: /Generatore Addon Proxy/i })).not.toBeVisible()
    }
  })

  test("Settings panel buttons and toggles update immediately", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })

    // Open settings panel
    const settingsBtn = page.getByRole("button", { name: /Impostazioni/i }).first()
    await settingsBtn.click()
    await expect(page.getByText(/Stile badge predefinito/i).first()).toBeVisible()

    // Test Badge Style selector buttons within the 6-col grid
    const styleGrid = page.locator(".grid.grid-cols-3.sm\\:grid-cols-5").first()
    const pillBtn = styleGrid.getByRole("button", { name: "Pill" })
    const bordoBtn = styleGrid.getByRole("button", { name: "Bordo" })

    await pillBtn.click()
    await expect(pillBtn).toHaveClass(/bg-accent-orange\/15/)

    await bordoBtn.click()
    await expect(bordoBtn).toHaveClass(/bg-accent-orange\/15/)
    await expect(pillBtn).not.toHaveClass(/bg-accent-orange\/15/)

    // Test Toggles (switch)
    const genreToggle = page.getByRole("switch", { name: "Genere" }).first()
    const initialGenreChecked = await genreToggle.getAttribute("aria-checked")
    await genreToggle.click()
    const newGenreChecked = await genreToggle.getAttribute("aria-checked")
    expect(newGenreChecked).not.toBe(initialGenreChecked)
    // Toggle back
    await genreToggle.click()
    expect(await genreToggle.getAttribute("aria-checked")).toBe(initialGenreChecked)

    // Test Rating Sources Accordion
    const sourcesAccordion = page.getByRole("button", { name: /Provider del voto/i })
    await sourcesAccordion.click()
    await expect(page.getByRole("button", { name: "Abilita tutti", exact: true })).toBeVisible()

    // Click "Abilita tutti"
    const enableAllBtn = page.getByRole("button", { name: "Abilita tutti", exact: true })
    await enableAllBtn.click()
    await expect(page.getByText(/16\/16/).first()).toBeVisible()

    // Click "Solo IMDb" (reset a 1 provider: il vecchio "Disabilita tutti"
    // non esiste più — rimozione intenzionale, vedi SettingsPanel.test.tsx)
    const imdbOnlyBtn = page.getByRole("button", { name: "Solo IMDb", exact: true })
    await imdbOnlyBtn.click()
    await expect(page.getByText(/1\/16/).first()).toBeVisible()

    // Test rank side control: position radios Sinistra/Destra (defaults-only —
    // shared by the ribbon AND the Numero numeral, T5 RankingAppearanceSelector).
    // T3 macro-groups: Overlay starts collapsed; expand for rank edits.
    await page.locator(".settings-panel:visible").first().getByTestId("badge-group-overlay-toggle").click()
    // Select Numero first so the Posizione row is reachable, then flip sides.
    const rankGroup = page.getByRole("radiogroup", { name: "Classifica" })
    await rankGroup.getByRole("radio", { name: "Numero" }).click()
    const sideGroup = page.getByRole("radiogroup", { name: "Posizione" })
    await expect(sideGroup).toBeVisible()
    const leftSide = sideGroup.getByRole("radio", { name: "Sinistra" })
    const rightSide = sideGroup.getByRole("radio", { name: "Destra" })
    await rightSide.click()
    await expect(rightSide).toHaveAttribute("aria-checked", "true")
    await expect(leftSide).toHaveAttribute("aria-checked", "false")
    await leftSide.click()
    await expect(leftSide).toHaveAttribute("aria-checked", "true")
    await expect(rightSide).toHaveAttribute("aria-checked", "false")

    // Switch to Preferences tab
    await page.getByRole("tab", { name: /Preferenze|Preferences/i }).click()

    // Test Episode metadata source buttons
    const episodeSourceSection = page.locator(".flex.gap-2").filter({ hasText: "TMDB" })
    const tvdbBtn = episodeSourceSection.getByRole("button", { name: "TVDB" })
    const tmdbBtn = episodeSourceSection.getByRole("button", { name: "TMDB" })
    await tvdbBtn.click()
    await expect(tvdbBtn).toHaveClass(/bg-white\/20/)
    await tmdbBtn.click()
    await expect(tmdbBtn).toHaveClass(/bg-white\/20/)
    await expect(tvdbBtn).not.toHaveClass(/bg-white\/20/)

    // Switch to Trasforma tab: the Blur toggle ("Sfocatura") lives here
    // (moved from Badge in 86251aff).
    await page.getByRole("tab", { name: /Trasforma/i }).click()

    // Test Blur toggle switch ("Sfocatura": lo switch; "Sfocatura predefinita"
    // è solo l'intestazione della sezione slider nel tab Trasforma)
    const blurToggle = page.getByRole("switch", { name: "Sfocatura", exact: true })
    const initialBlurChecked = await blurToggle.getAttribute("aria-checked")
    await blurToggle.click()
    const afterBlurChecked = await blurToggle.getAttribute("aria-checked")
    expect(afterBlurChecked).not.toBe(initialBlurChecked)
    // Toggle back
    await blurToggle.click()
    expect(await blurToggle.getAttribute("aria-checked")).toBe(initialBlurChecked)

    // Switch back to Badge tab (il tab "Stile" non esiste più: rinominato Badge)
    await page.getByRole("tab", { name: /Badge/i }).click()

    // T4 footer: autosave status truth + Fine primary (no SyncNow button).
    // Autosave already synced the toggles above; the live region confirms it
    // and Fine closes the dialog.
    await expect(page.getByTestId("defaults-sync-status")).toContainText(/Sincronizzato/i)
    await page.getByRole("button", { name: "Fine", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("Editor view buttons and tabs update immediately upon clicking", async ({ page }) => {
    await page.goto("/")
    // Arrange deterministico via API reale: il test precedente imposta
    // ranking=bordo nei default globali (autosave) e l'editor per-titolo lo
    // eredita — senza reset l'assert su Pill non è significativo.
    await page.evaluate(async () => {
      const r = await fetch("/api/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rankingBadgeStyle: "default" }),
      })
      if (!r.ok) throw new Error(`reset defaults: ${r.status} ${await r.text()}`)
    })
    await page.goto("/")
    const search = page.getByPlaceholder(/cerca/i)
    await search.fill("avatar")
    await search.press("Enter")

    await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
    await page.getByText(/Avatar/i).first().click()

    // Editor is open
    await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 10_000 })

    // Test Poster tile click in left panel
    const posterTiles = page.locator(".poster-tile")
    if ((await posterTiles.count()) > 1) {
      const secondPoster = posterTiles.nth(1)
      await secondPoster.click()
      await expect(secondPoster).toHaveClass(/poster-tile-active/)
    }

    // Test Editor Right Panel Tabs (Loghi, Badge)
    const badgeTab = page.getByRole("tab", { name: "Badge" })
    const logoTab = page.getByRole("tab", { name: "Loghi" })

    await badgeTab.click()
    await expect(badgeTab).toHaveAttribute("aria-selected", "true")
    await expect(page.getByText(/Stile badge/i).first()).toBeVisible()

    // Inside Badge tab: single rank appearance (Nastro/Numero/Badge + variants,
    // T5 RankingAppearanceSelector — no separate style grid, no per-title side).
    const seen: string[] = []
    page.on("request", (req) => {
      const url = req.url()
      if (/\/api\/poster\/(movie|tv)\//.test(url) && url.includes("preview=1") && !url.includes("demosamples=1")) seen.push(url)
    })
    const rankGroup = page.getByRole("radiogroup", { name: "Classifica" })
    await expect(rankGroup).toBeVisible()
    await expect(rankGroup.getByRole("radio")).toHaveCount(3)
    // Arrange verificato (mai assunto): default+ribbon eredita Nastro.
    await expect(rankGroup.getByRole("radio", { name: "Nastro" })).toHaveAttribute("aria-checked", "true")
    // Side is defaults-only: never rendered per-title (not persistible).
    await expect(page.getByRole("radiogroup", { name: "Posizione" })).toHaveCount(0)
    // Badge appearance exposes the 6 centered variants; back to Numero.
    await rankGroup.getByRole("radio", { name: "Badge", exact: true }).click()
    const variantGroup = page.getByRole("radiogroup", { name: "Stile badge ranking predefinito" })
    await expect(variantGroup).toBeVisible()
    await expect(variantGroup.getByRole("radio")).toHaveCount(6)
    const mark = seen.length
    await rankGroup.getByRole("radio", { name: "Numero" }).click()
    await expect(rankGroup.getByRole("radio", { name: "Numero" })).toHaveAttribute("aria-checked", "true")
    // Immediate preview: the new request carries rs=number (single ribbon flag).
    let preview: URLSearchParams | null = null
    await expect
      .poll(
        () => {
          const raw = seen.slice(mark).find((u) => new URL(u).searchParams.get("rs") === "number") ?? null
          preview = raw ? new URL(raw).searchParams : null
          return preview ? "ok" : null
        },
        { timeout: 30_000 },
      )
      .toBe("ok")
    expect((preview as unknown as URLSearchParams).getAll("ribbon")).toEqual(["1"])

    // Test master toggle in Badge tab (per-title top badges: "Badge superiore").
    const trendSwitch = page.getByRole("switch", { name: "Badge superiore" })
    const initialTrend = await trendSwitch.getAttribute("aria-checked")
    await trendSwitch.click()
    const nextTrend = await trendSwitch.getAttribute("aria-checked")
    expect(nextTrend).not.toBe(initialTrend)

    // Test Logo Network switch toggle in Badge tab
    const netLogoSwitch = page.getByRole("switch", { name: /Logo Network|Network logo/i })
    await expect(netLogoSwitch).toBeVisible()
    const initialNetLogo = await netLogoSwitch.getAttribute("aria-checked")
    await netLogoSwitch.click()
    const nextNetLogo = await netLogoSwitch.getAttribute("aria-checked")
    expect(nextNetLogo).not.toBe(initialNetLogo)
    // Toggle back
    await netLogoSwitch.click()
    expect(await netLogoSwitch.getAttribute("aria-checked")).toBe(initialNetLogo)

    // Switch back to Logo tab
    await logoTab.click()
    await expect(logoTab).toHaveAttribute("aria-selected", "true")

    // Bottone "URL Stremio" nel footer: apre il modale con URL + anteprima
    // dell'artefatto finale (ex modale "Testa URL").
    const stremioBtn = page.getByRole("button", { name: "Testa URL Stremio", exact: true })
    await expect(stremioBtn).toBeVisible({ timeout: 15_000 })
    await stremioBtn.click()
    const stremioDialog = page.getByRole("dialog", { name: "Stremio" })
    await expect(stremioDialog).toBeVisible({ timeout: 20_000 })
    await expect(stremioDialog.getByText("/api/poster/", { exact: false }).first()).toBeVisible()
    await stremioDialog.getByRole("button", { name: "Chiudi" }).click()
    await expect(stremioDialog).not.toBeVisible()

    // Test Salva Poster button
    const savePosterBtn = page.getByRole("button", { name: /Salva Poster/i }).first()
    await expect(savePosterBtn).toBeVisible()
    await savePosterBtn.click()
    // After saving, remove button should be rendered in preview footer
    const removeBtn = page.getByRole("button", { name: /Rimuovi/i })
    await expect(removeBtn).toBeVisible({ timeout: 10_000 })
  })
})
