import { test, expect } from "@playwright/test"

// Badge presets E2E (M9): copre ciò che l'ambiente E2E supporta (flag
// MULTI_USER spento → niente namespace ?u=, quindi i flussi autenticati
// Lab→save→publish→community sono verificati a livello Vitest in
// api-presets.test.ts + badge-preset-store.test.ts). Qui: pagine Lab e
// Community, API pubbliche fail-open, e poster ?badgePreset fail-open
// byte-identico al render standard.

const MOVIE_TMDB = 19995 // Avatar (mock server)
const POSTER_PATH = "/mocked/avatar.jpg"

function posterUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/movie/${MOVIE_TMDB}?${qs.toString()}`
}

test("Badge Lab renders with live preview", async ({ page }) => {
  await page.goto("/lab/badges")
  await expect(page.getByRole("heading", { name: /Badge Lab|ui\.labTitle/ })).toBeVisible({ timeout: 30_000 })
  // Tabs dei controlli.
  await expect(page.getByRole("button", { name: "shape", exact: true })).toBeVisible()
  // Anteprima live: il template di default risolve {{rating}} dal mock (8.5).
  await expect(page.getByText("8.5", { exact: false }).first()).toBeVisible({ timeout: 10_000 })
  // Azioni principali presenti.
  await expect(page.getByRole("button", { name: /Save preset|Salva preset|ui\.labSave/ })).toBeVisible()
  await expect(page.getByText(/Import .json|Importa .json|ui\.labImport/)).toBeVisible()
  await expect(page.getByRole("button", { name: /Export .json|Esporta .json|ui\.labExport/ })).toBeVisible()
  // Cambio template → la preview si aggiorna senza roundtrip (stesso tick).
  await page.getByRole("button", { name: "type", exact: true }).click()
  const template = page.getByLabel(/Text template|Template testo|ui\.labTemplate/)
  await template.fill("HELLO")
  await expect(page.getByText("HELLO", { exact: false }).first()).toBeVisible({ timeout: 10_000 })
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
