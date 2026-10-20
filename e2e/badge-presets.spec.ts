import { test, expect } from "@playwright/test"

// Badge presets E2E (M9 + Badge Lab families): copre ciò che l'ambiente E2E
// supporta (flag MULTI_USER spento → niente namespace ?u=, quindi i flussi
// autenticati Lab→save→apply→title→Stremio sono verificati a livello Vitest in
// api-presets.test.ts + family-preset-save.test.ts + lab-handoff.test.ts +
// family-preset-poster-save.test.ts). Qui: pagina Lab e Community, API
// pubbliche fail-open, poster ?badgePreset fail-open byte-identico al render
// standard, e il percorso deterministico senza auth
// starter→edit→preview→export→import→preview (il salvataggio resta
// disabilitato senza spazio personale: ui.labAnonHint).

const MOVIE_TMDB = 19995 // Avatar (mock server)
const POSTER_PATH = "/mocked/avatar.jpg"

function posterUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/movie/${MOVIE_TMDB}?${qs.toString()}`
}

test("Badge Lab renders with live preview", async ({ page }) => {
  await page.goto("/lab/badges")
  await expect(page.getByRole("heading", { name: /Badge Lab|ui\.labTitle/ })).toBeVisible({ timeout: 30_000 })
  // Tabs dei controlli (etichette localizzate: type→Testo/Text, shape→Forma/Shape).
  const tabs = page.getByTestId("lab-design-tabs")
  await expect(tabs.getByRole("button", { name: /^(Forma|Shape)$/ })).toBeVisible()
  // Anteprima live: il template di default risolve {{rating}} dal mock (8.5).
  // Scope al preview desktop (aside): il primo match globale sarebbe la copia
  // mobile `lg:hidden` (nascosta su desktop) o una thumb starter SVG.
  const desktopPreview = page.getByTestId("lab-poster-mock-preview")
  await expect(desktopPreview.getByText("8.5", { exact: false })).toBeVisible({ timeout: 10_000 })
  // Azioni principali presenti (il salvataggio resta disabilitato senza spazio).
  await expect(page.getByRole("button", { name: /Save preset|Salva preset|ui\.labSave/ })).toBeVisible()
  // Import/Export stanno nel <details> File: l'utente reale lo espande.
  await page.getByTestId("lab-files").locator("summary").click()
  await expect(page.getByText(/Import .json|Importa .json|ui\.labImport/)).toBeVisible()
  await expect(page.getByRole("button", { name: /Export .json|Esporta .json|ui\.labExport/ })).toBeVisible()
  // Cambio template → la preview si aggiorna senza roundtrip (stesso tick).
  await tabs.getByRole("button", { name: /^(Testo|Text)$/ }).click()
  const template = page.getByLabel(/Badge text|Testo del badge|ui\.labTemplate/)
  await template.fill("HELLO")
  await expect(page.getByTestId("lab-poster-mock-preview").getByText("HELLO", { exact: false })).toBeVisible({ timeout: 10_000 })
})

test("Lab starter→edit→export→import roundtrip keeps the draft", async ({ page }) => {
  await page.goto("/lab/badges")
  await expect(page.getByRole("heading", { name: /Badge Lab|ui\.labTitle/ })).toBeVisible({ timeout: 30_000 })
  // Nomina la bozza (l'export fallisce senza nome valido) e modifica il testo.
  await page.getByLabel(/^(Name|Nome)$/).fill("E2EExport")
  const template = page.getByLabel(/Badge text|Testo del badge|ui\.labTemplate/)
  await template.fill("HELLO-ROUNDTRIP")
  const desktopPreview = page.getByTestId("lab-poster-mock-preview")
  await expect(desktopPreview.getByText("HELLO-ROUNDTRIP", { exact: false })).toBeVisible({ timeout: 10_000 })
  // Export nel <details> File: l'utente reale lo espande.
  await page.getByTestId("lab-files").locator("summary").click()
  // Export → file .json scaricato con template e nome dentro.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Export .json|Esporta .json|ui\.labExport/ }).click(),
  ])
  const filePath = await download.path()
  expect(filePath).toBeTruthy()
  // Reset locale e reimport: la bozza esportata ritorna in preview.
  // Il reset sporca la bozza: l'import chiede conferma (window.confirm) —
  // l'utente reale accetta.
  await template.fill("RESET")
  await expect(desktopPreview.getByText("HELLO-ROUNDTRIP", { exact: false })).toHaveCount(0)
  page.once("dialog", (dialog) => void dialog.accept())
  await page.locator('input[type="file"]').setInputFiles(filePath!)
  await expect(desktopPreview.getByText("HELLO-ROUNDTRIP", { exact: false })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel(/^(Name|Nome)$/)).toHaveValue("E2EExport")
})

test("Community page renders with catalog controls", async ({ page }) => {
  await page.goto("/presets")
  await expect(page.getByRole("heading", { name: /Community presets|Preset della community|ui\.presetsTitle/ })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByLabel(/Sort|Ordina|ui\.presetsSort/)).toBeVisible()
  await expect(page.getByPlaceholder(/Search|Cerca|ui\.presetsSearch/)).toBeVisible()
})

test("presets API fail-open without namespace", async ({ request }) => {
  // Catalogo pubblico vuoto ma 200.
  const catalog = await request.get("/api/presets")
  expect(catalog.status()).toBe(200)
  const body = await catalog.json()
  expect(body.items).toEqual([])
  expect(body.nextCursor).toBeNull()
  // ID malformato → 400, mai 500.
  expect((await request.get("/api/presets/nope")).status()).toBe(400)
  expect((await request.get("/api/presets/nope/preview.svg")).status()).toBe(400)
  // Sconosciuto ma ben formato → 404, mai 500.
  expect((await request.get("/api/presets/Abc123-_XyZ")).status()).toBe(404)
  expect((await request.get("/api/presets/Abc123-_XyZ/preview.svg")).status()).toBe(404)
  expect((await request.post("/api/presets/Abc123-_XyZ/download")).status()).toBe(404)
  // Scritture senza namespace → 400 (owner obbligatorio), mai 500.
  expect(
    (
      await request.post("/api/presets", {
        headers: { "content-type": "application/json" },
        data: { target: "top", visibility: "public", metadata: { name: "x", tags: [] }, design: {} },
      })
    ).status(),
  ).toBe(400)
})

test("poster with unknown badgePreset renders byte-identical (fail-open)", async ({ request }) => {
  const baseline = await request.get(posterUrl({}))
  expect(baseline.status()).toBe(200)
  const withPreset = await request.get(posterUrl({ badgePreset: "Abc123-_XyZ", prv: "deadbeef" }))
  expect(withPreset.status()).toBe(200)
  expect(Buffer.compare(await baseline.body(), await withPreset.body())).toBe(0)
})

test("poster drops junk badgePreset/prv (no cache-busting, same bytes)", async ({ request }) => {
  const baseline = await request.get(posterUrl({}))
  expect(baseline.status()).toBe(200)
  const junk = await request.get(posterUrl({ badgePreset: "<script>", prv: "random" }))
  expect(junk.status()).toBe(200)
  expect(Buffer.compare(await baseline.body(), await junk.body())).toBe(0)
})
