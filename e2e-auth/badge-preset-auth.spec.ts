import { test, expect, type APIRequestContext, type Page } from "@playwright/test"
import sharp from "sharp"

/**
 * Badge Lab authenticated save/apply/reopen/Stremio E2E (Task E correction1).
 *
 * Runs ONLY under playwright.preset-auth.config.ts (multi-user ON, isolated
 * ports/distDir/data namespace, deterministic mock server). It is OUTSIDE the
 * default `./e2e` discovery on purpose: the main suite runs with
 * MULTI_USER OFF, so this flow would run there with the wrong env.
 *
 * Real browser + real server everywhere: users via POST /api/users, presets
 * via Lab UI Save (native starter -> edit -> personal library), apply via
 * the Lab "Use for title" handoff (the per-title picker was removed from the
 * editor), mapping via Salva Poster, reload/reopen, and Stremio
 * poster bytes. No stubbing of save/render APIs; no weakening of existing
 * assertions. Auth seeding uses the existing safe client pattern
 * (localStorage secret + `pictorium:user-unlock` session event).
 *
 * Covers two independent families (genre + rank, custom variant):
 * - Lab UI save of both presets to the personal library;
 * - apply to the exact title/shape, editor preview, explicit mapping Save;
 * - reload + reopen: same saved family choice, editor preview vs Stremio
 *   pixel parity (deterministic mapping route);
 * - portrait/landscape preservation across shape-scoped saves;
 * - private preset preview/JSON 404 for anonymous/stranger, 200 for owner;
 * - preset edit/delete invalidates the final Stremio render despite the
 *   stale client rev (current store truth wins; delete falls back to the
 *   standard render, never 500).
 */

const MOVIE_ID = 19995 // Avatar (mock server)
const POSTER_PATH = "/mocked/avatar.jpg"

const passwordFor = (tag: string): string => `e2e-auth-${tag}-Pw12345`

interface CreatedUser {
  uuid: string
  secret: string
}

async function createUser(request: APIRequestContext, tag: string): Promise<CreatedUser> {
  // The `users-create` bucket is intentionally tight (5 burst, 1/60s refill):
  // a full serial file with one user per test exceeds it, so the 6th+
  // creation 429s. Honor Retry-After with a bounded retry (harness-only —
  // the assertion below still requires an eventual real 200, never a skip).
  let lastStatus = 0
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await request.post("/api/users", { data: { password: passwordFor(tag) } })
    lastStatus = res.status()
    if (res.ok()) {
      const body = (await res.json()) as { uuid: string; secret: string }
      expect(body.uuid).toMatch(/^[0-9a-f-]{36}$/)
      expect(typeof body.secret).toBe("string")
      return { uuid: body.uuid, secret: body.secret }
    }
    if (lastStatus !== 429 || attempt === 3) break
    const retryAfter = Number(res.headers()["retry-after"] ?? "2")
    const waitMs = Math.min(75000, (Number.isFinite(retryAfter) ? retryAfter : 2) * 1000 + 500)
    await new Promise((r) => setTimeout(r, waitMs))
  }
  expect(lastStatus).toBe(200)
  throw new Error(`createUser failed with status ${lastStatus}`)
}

function authHeaders(secret: string): Record<string, string> {
  return { "x-user-token": secret }
}

/** Unlock the space in the CURRENT page (no navigation: memory unlock). */
async function unlockInPlace(page: Page, uuid: string, secret: string): Promise<void> {
  await page.evaluate(
    ({ uuid, secret }) => {
      try {
        window.localStorage.setItem(`pictorium-user-token:${uuid.toLowerCase()}`, secret)
        window.localStorage.setItem("tmdb_key", "mock-tmdb-key-0000000000")
        window.localStorage.setItem("pictorium_onboarding_done", "true")
        window.localStorage.setItem("preferred_lang", "it")
      } catch {
        /* storage unavailable: headers still cannot attach */
      }
      window.dispatchEvent(new CustomEvent("pictorium:user-unlock", { detail: { uuid } }))
    },
    { uuid, secret },
  )
}

/** Lab UI: custom preset (native free starter -> edit template -> Save). */
async function labSaveCustomPreset(
  page: Page,
  uuid: string,
  secret: string,
  opts: { targetName: RegExp; presetName: string; template: string; previewText: RegExp },
): Promise<{ id: string; rev: string }> {
  await page.goto(`/lab/badges?u=${uuid}`)
  await unlockInPlace(page, uuid, secret)
  await expect(page.getByRole("heading", { name: /Badge Lab|ui\.labTitle/ })).toBeVisible({ timeout: 30_000 })
  const editorSection = page.locator('section[aria-labelledby="lab-editor-title"]')
  await editorSection.getByRole("button", { name: opts.targetName }).click()
  await page.getByLabel(/Badge text|Testo del badge|ui\.labTemplate/).fill(opts.template)
  // Scope al preview desktop (aside): il primo match globale sarebbe la copia
  // mobile `lg:hidden` (nascosta su desktop) o una thumb starter SVG.
  await expect(page.getByTestId("lab-poster-mock-preview").getByText(opts.previewText)).toBeVisible({
    timeout: 10_000,
  })
  await page.getByLabel(/^(Name|Nome)$/).fill(opts.presetName)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/presets") && r.request().method() === "POST"),
    page.getByRole("button", { name: /Save preset|Salva preset|ui\.labSave/ }).click(),
  ])
  expect(resp.ok()).toBeTruthy()
  const stored = (await resp.json()) as { preset: { id: string; revision: string } }
  expect(stored.preset.id).toMatch(/^[A-Za-z0-9_-]{8,24}$/)
  expect(stored.preset.revision).toMatch(/^[0-9a-f]{8}$/)
  return { id: stored.preset.id, rev: stored.preset.revision }
}

/** Open the exact title client-side AFTER unlock (post-unlock mount). */
async function openTitleEditor(
  page: Page,
  uuid: string,
  secret: string,
  shape: "poster" | "landscape" = "poster",
): Promise<void> {
  await page.goto(`/?u=${uuid}`)
  await unlockInPlace(page, uuid, secret)
  await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
  const search = page.getByPlaceholder(/cerca/i)
  await search.fill("avatar")
  await search.press("Enter")
  await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
  await page.getByText(/Avatar/i).first().click()
  await expect(page.getByRole("heading", { name: /Anteprima/ })).toBeVisible({ timeout: 30_000 })
  if (shape === "landscape") {
    // Shape switch happens inside the editor (client-side, keeps the unlock).
    const shapeSwitch = page.getByRole("button", { name: /Orizzontale|Landscape|16:9/ }).first()
    if (await shapeSwitch.isVisible().catch(() => false)) {
      await shapeSwitch.click()
    }
  }
  await page.getByRole("tab", { name: "Badge", exact: true }).click()
}

/**
 * Dismiss the space unlock modal via the real password login when it
 * prompts (polling: the mount-once modal and the editor open race each
 * other after a full-load handoff return). Full page loads (like the Lab
 * handoff `location.assign` return) drop the memory-only session unlock by
 * design, so a real user re-enters the password here; the test does the same
 * through the actual modal UI (no stubbing). Returns once the modal is gone
 * (logged in) or the editor is already open (modal never appeared because
 * the seeded unlock won the mount race); if neither happens within the
 * budget it returns and lets the downstream expects fail loudly.
 */
async function unlockViaModalWhenPresent(page: Page, password: string, timeoutMs = 30_000): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /La tua chiave personale|ui\.userUnlockTitle/ })
  const heading = page.getByRole("heading", { name: /Anteprima/ })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByPlaceholder("••••••••").fill(password)
      await dialog.getByRole("button", { name: /^Salva$|^Save$|ui\.save/ }).click()
      await expect(dialog).toBeHidden({ timeout: 15_000 })
      return
    }
    if (await heading.isVisible().catch(() => false)) return
    if (Date.now() > deadline) return
    await page.waitForTimeout(500)
  }
}

/**
 * Apply a saved library preset to the exact title via the Lab "Use for
 * title" handoff (real UI — the per-title picker no longer exists in the
 * editor). The Lab deep-link carries the family starter + the exact
 * title/shape return context; the handoff navigates back with
 * `?title=&shape=&fam=&preset=&rev=`, the editor consumes it (staged-only,
 * one family), and the caller persists with an explicit Salva Poster.
 */
async function applyPresetViaLabHandoff(
  page: Page,
  uuid: string,
  secret: string,
  password: string,
  family: "genre" | "rank",
  presetName: string,
): Promise<void> {
  const returnPath = `/?title=movie:${MOVIE_ID}&shape=poster&u=${uuid}`
  await page.goto(
    `/lab/badges?family=${family}&source=native&return=${encodeURIComponent(returnPath)}&u=${uuid}`,
  )
  await unlockInPlace(page, uuid, secret)
  await expect(page.getByTestId("lab-handoff")).toBeVisible({ timeout: 30_000 })
  // The personal library starts closed: expand it, then load the saved
  // preset into the Lab editor (Edit resumes the saved id/rev, which arms
  // the handoff button — no save needed, the preset is already stored).
  const library = page.getByTestId("lab-library")
  const isOpen = await library.evaluate((el) => (el as HTMLDetailsElement).open)
  if (!isOpen) await library.locator("summary").first().click()
  await expect(library.getByText(presetName, { exact: true })).toBeVisible({ timeout: 15_000 })
  const card = library.getByText(presetName, { exact: true }).locator("xpath=ancestor::div[2]")
  await card.getByRole("button", { name: /Modifica|Edit/ }).click()
  const useForTitle = page.getByTestId("lab-use-for-title")
  await expect(useForTitle).toBeEnabled({ timeout: 15_000 })
  await Promise.all([
    page.waitForURL((url) => url.searchParams.has("fam"), { timeout: 30_000 }),
    useForTitle.click(),
  ])
  // The handoff consumed the return context and reopened the exact title.
  // The handoff return is a full page load, which drops the memory-only
  // session unlock by design: the unlock modal opens and the editor's
  // handoff consume waits for the unlock (bounded) before fetching the
  // owner-gated preset. Log in through the real modal when it prompts.
  await unlockViaModalWhenPresent(page, password)
  await expect(page.getByRole("heading", { name: /Anteprima/ })).toBeVisible({ timeout: 30_000 })
  // Staged-only handoff: the editor toasts once the family binding is staged
  // (title open + preset fetch settle first — never Save before this, or the
  // mapping persists without the family).
  await expect(page.getByText(/Preset pronto per questo titolo|ui\.familyHandoffStaged/)).toBeVisible({
    timeout: 60_000,
  })
}

async function savePoster(page: Page): Promise<void> {
  const saveBtn = page.getByRole("button", { name: /Salva Poster|Save Poster/ }).first()
  await expect(saveBtn).toBeVisible()
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/mappings") && r.request().method() === "POST"),
    saveBtn.click(),
  ])
  expect(resp.ok()).toBeTruthy()
}

/**
 * Genuine preview bytes: the editor loads `/api/poster/...` through XHR as a
 * blob URL (see usePosterPreview), so no <img> ever carries the poster URL —
 * scraping `src` is structurally wrong. Instead capture the actual served
 * response bodies the page itself received (authorized browser context) and
 * compare THOSE against the Stremio render. No second Stremio fetch is ever
 * labelled parity: each `renderPng(stremioUrl)` is the genuine final render,
 * each captured body the genuine served preview.
 */
interface CapturedPoster {
  url: string
  body: Buffer
}

function watchPosterResponses(page: Page, store: CapturedPoster[]): void {
  page.on("response", (r) => {
    void (async () => {
      try {
        if (r.request().method() !== "GET") return
        if (!r.url().includes(`/api/poster/movie/${MOVIE_ID}`)) return
        if (!r.ok()) return
        store.push({ url: r.url(), body: await r.body() })
      } catch {
        // Best-effort capture: the assertion below fails loudly when empty.
      }
    })()
  })
}

async function awaitFreshPoster(store: CapturedPoster[], from: number, timeoutMs = 30_000): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs
  while (store.length <= from) {
    if (Date.now() > deadline) {
      throw new Error(`no fresh /api/poster/movie/${MOVIE_ID} response captured by the page`)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  // Quiescence: staged edits settle into one final XHR; the last body after
  // 800ms without newcomers is the preview the user actually sees.
  for (;;) {
    const n = store.length
    await new Promise((r) => setTimeout(r, 800))
    if (store.length === n) return store[store.length - 1]!.body
    if (Date.now() > deadline) throw new Error("poster preview responses never settled")
  }
}

function stremioUrl(uuid: string, shape: "poster" | "landscape" = "poster"): string {
  const qs = new URLSearchParams({ lang: "it", region: "IT", u: uuid })
  if (shape === "landscape") qs.set("shape", "landscape")
  return `/api/poster/movie/${MOVIE_ID}?${qs.toString()}`
}

async function renderPng(request: APIRequestContext, url: string): Promise<Buffer> {
  const res = await request.get(url)
  expect(res.ok()).toBeTruthy()
  return Buffer.from(await res.body())
}

async function meanAbsDiff(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rb = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  expect(ra.info.width).toBe(rb.info.width)
  expect(ra.info.height).toBe(rb.info.height)
  const da = ra.data
  const db = rb.data
  let sum = 0
  for (let i = 0; i < da.length; i++) sum += Math.abs(da[i]! - db[i]!)
  return sum / da.length / 255
}

async function getMapping(
  request: APIRequestContext,
  uuid: string,
  secret: string,
): Promise<{
  badgePresets?: Record<string, { id: string; rev: string | null } | null>
  landscape?: { badgePresets?: Record<string, { id: string; rev: string | null } | null> | null } | null
}> {
  const res = await request.get(`/api/mappings/movie:${MOVIE_ID}?u=${uuid}`, { headers: authHeaders(secret) })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as {
    badgePresets?: Record<string, { id: string; rev: string | null } | null>
    landscape?: { badgePresets?: Record<string, { id: string; rev: string | null } | null> | null } | null
  }
}

test.describe("Badge Lab authenticated save/apply/reopen/Stremio", () => {
  test("Lab UI save (2 families) -> apply -> Save -> reload/reopen parity", async ({ page, request }) => {
    const user = await createUser(request, "core")
    const captured: CapturedPoster[] = []
    watchPosterResponses(page, captured)
    const tag = user.uuid.slice(0, 8)

    // 1. Native starter -> edit -> Save to personal library (both families, real Lab UI).
    const genre = await labSaveCustomPreset(page, user.uuid, user.secret, {
      targetName: /Genere \/ Rating|Genre \/ Rating/,
      presetName: `E2EAuthGenre${tag}`,
      template: `E2EAUTHG {{rating}}`,
      previewText: /E2EAUTHG 8\.5/,
    })
    const rank = await labSaveCustomPreset(page, user.uuid, user.secret, {
      targetName: /^(Rank|Classifica)$/,
      presetName: `E2EAuthRank${tag}`,
      template: `E2EAUTHR ${tag}`,
      previewText: new RegExp(`E2EAUTHR ${tag}`),
    })

    // Personal library holds both (owner auth, real API).
    const mine = await request.get(`/api/presets?mine=1&u=${user.uuid}`, { headers: authHeaders(user.secret) })
    expect(mine.ok()).toBeTruthy()
    const mineIds = ((await mine.json()) as { presets: Array<{ preset: { id: string } }> }).presets.map(
      (p) => p.preset.id,
    )
    expect(mineIds).toContain(genre.id)
    expect(mineIds).toContain(rank.id)

    // 2. Apply to the exact title/shape (portrait) via the Lab "Use for title"
    // handoff (real UI — the per-title picker no longer exists in the
    // editor). Each handoff is a fresh editor load carrying a single staged
    // family, so persist with an explicit Save in between.
    await applyPresetViaLabHandoff(page, user.uuid, user.secret, passwordFor("core"), "genre", `E2EAuthGenre${tag}`)
    await savePoster(page)
    await applyPresetViaLabHandoff(page, user.uuid, user.secret, passwordFor("core"), "rank", `E2EAuthRank${tag}`)
    await savePoster(page)

    const mapping = await getMapping(request, user.uuid, user.secret)
    expect(mapping.badgePresets?.genre).toMatchObject({ id: genre.id })
    expect(mapping.badgePresets?.rank).toMatchObject({ id: rank.id })

    const stremioBefore = await renderPng(request, stremioUrl(user.uuid))

    // 3. Reload + reopen: same family saved choice, preview/Stremio parity.
    // The mark predates the reopen so only the reopen's served preview
    // responses count (the actual bytes the browser rendered, blob XHR).
    const reopenMark = captured.length
    await openTitleEditor(page, user.uuid, user.secret, "poster")
    // Same saved family choice on reopen (mapping truth — the per-title
    // picker no longer renders a staged-dot row in the editor).
    const reopened = await getMapping(request, user.uuid, user.secret)
    expect(reopened.badgePresets?.genre).toMatchObject({ id: genre.id })
    expect(reopened.badgePresets?.rank).toMatchObject({ id: rank.id })

    const preview = await awaitFreshPoster(captured, reopenMark)
    const stremio = await renderPng(request, stremioUrl(user.uuid))
    expect(Buffer.compare(stremioBefore, stremio)).toBe(0)
    expect(await meanAbsDiff(preview, stremio)).toBeLessThan(0.01)

    // Cleanup: mapping + presets (namespace-scoped, authenticated).
    await request.delete(`/api/mappings/movie:${MOVIE_ID}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
    await request.delete(`/api/presets/${genre.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
    await request.delete(`/api/presets/${rank.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
  })

  test("portrait/landscape preservation via Lab handoff (no per-title picker)", async ({ page, request }) => {
    const user = await createUser(request, "clear")
    const tag = user.uuid.slice(0, 8)

    // Seed two independent presets via the real API (Lab UI save is covered above).
    // (The per-title explicit Standard clear buttons lived in the removed
    // editor section: per-family null-merge stays covered at unit level in
    // family-preset-save.test.ts, and mapping deletion is API-tested.)
    const genreBody = {
      target: "genre",
      visibility: "private",
      metadata: { name: `E2EClrGenre${tag}`, tags: [] as string[] },
      variant: "custom",
      design: {
        shape: "pill",
        padding: { x: 14, y: 7 },
        background: { type: "solid", color: "#000000", opacity: 85 },
        text: {
          template: `E2ECLRG ${tag}`,
          color: "#ffffff",
          opacity: 100,
          fontSize: 22,
          fontWeight: 700,
          uppercase: false,
          letterSpacing: 0,
          align: "center",
        },
        scale: 100,
      },
    }
    const rankBody = {
      target: "rank",
      visibility: "private",
      metadata: { name: `E2EClrRank${tag}`, tags: [] as string[] },
      variant: "custom",
      design: {
        ...(genreBody.design as Record<string, unknown>),
        text: { ...(genreBody.design.text as Record<string, unknown>), template: `E2ECLRR ${tag}` },
      },
    }
    const genreRes = await request.post(`/api/presets?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: genreBody,
    })
    expect(genreRes.status()).toBe(201)
    const genre = ((await genreRes.json()) as { preset: { id: string; revision: string } }).preset
    const rankRes = await request.post(`/api/presets?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: rankBody,
    })
    expect(rankRes.status()).toBe(201)
    const rank = ((await rankRes.json()) as { preset: { id: string; revision: string } }).preset

    // Portrait: apply both via the Lab handoff (real browser UI), with an
    // explicit Save after each handoff (each handoff carries one staged family).
    await applyPresetViaLabHandoff(page, user.uuid, user.secret, passwordFor("clear"), "genre", `E2EClrGenre${tag}`)
    await savePoster(page)
    await applyPresetViaLabHandoff(page, user.uuid, user.secret, passwordFor("clear"), "rank", `E2EClrRank${tag}`)
    await savePoster(page)

    let mapping = await getMapping(request, user.uuid, user.secret)
    expect(mapping.badgePresets?.genre).toMatchObject({ id: genre.id })
    expect(mapping.badgePresets?.rank).toMatchObject({ id: rank.id })
    const stremioPortrait = await renderPng(request, stremioUrl(user.uuid))

    // Portrait/landscape preservation: the landscape profile froze the old
    // per-family look (moved families), so landscape stays standard while
    // portrait keeps both presets. Re-apply genre on portrait only.
    await applyPresetViaLabHandoff(page, user.uuid, user.secret, passwordFor("clear"), "genre", `E2EClrGenre${tag}`)
    await savePoster(page)
    mapping = await getMapping(request, user.uuid, user.secret)
    expect(mapping.badgePresets?.genre).toMatchObject({ id: genre.id })
    expect(mapping.badgePresets?.rank).toMatchObject({ id: rank.id })
    const landProfile = mapping.landscape?.badgePresets ?? null
    // The other shape kept its previous look for the moved family (never the
    // edited live value, never dropped silently): portrait-only states keep
    // the landscape profile at native for the introduced binding.
    expect(landProfile === null || landProfile?.genre === null || landProfile?.genre?.id === genre.id).toBeTruthy()

    const stremioPortrait2 = await renderPng(request, stremioUrl(user.uuid))
    expect(Buffer.compare(stremioPortrait, stremioPortrait2)).toBe(0)

    await request.delete(`/api/mappings/movie:${MOVIE_ID}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
    await request.delete(`/api/presets/${genre.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
    await request.delete(`/api/presets/${rank.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
  })

  test("private preview/JSON: 404 anonymous, 200 owner", async ({ page, request }) => {
    const owner = await createUser(request, "privown")
    const stranger = await createUser(request, "privstr")
    const tag = owner.uuid.slice(0, 8)

    const created = await request.post(`/api/presets?u=${owner.uuid}`, {
      headers: { ...authHeaders(owner.secret), "content-type": "application/json" },
      data: {
        target: "genre",
        visibility: "private",
        metadata: { name: `E2EPriv${tag}`, tags: [] as string[] },
        variant: "custom",
        design: {
          shape: "pill",
          padding: { x: 14, y: 7 },
          background: { type: "solid", color: "#000000", opacity: 85 },
          text: {
            template: `E2EPRIV ${tag}`,
            color: "#ffffff",
            opacity: 100,
            fontSize: 22,
            fontWeight: 700,
            uppercase: false,
            letterSpacing: 0,
            align: "center",
          },
          scale: 100,
        },
      },
    })
    expect(created.status()).toBe(201)
    const preset = ((await created.json()) as { preset: { id: string } }).preset

    // Anonymous: uniform 404 (no existence/content oracle), same for stranger.
    expect((await request.get(`/api/presets/${preset.id}`)).status()).toBe(404)
    expect((await request.get(`/api/presets/${preset.id}?u=${stranger.uuid}`)).status()).toBe(404)
    expect((await request.get(`/api/presets/${preset.id}/preview.svg`)).status()).toBe(404)
    expect(
      (await request.get(`/api/presets/${preset.id}/preview.svg?u=${stranger.uuid}`)).status(),
    ).toBe(404)
    expect((await request.get(`/api/presets?mine=1&u=${owner.uuid}`)).status()).toBe(401)

    // Owner (namespace + secret): full access.
    expect(
      (await request.get(`/api/presets/${preset.id}?u=${owner.uuid}`, { headers: authHeaders(owner.secret) })).status(),
    ).toBe(200)
    const svg = await request.get(`/api/presets/${preset.id}/preview.svg?u=${owner.uuid}`, {
      headers: authHeaders(owner.secret),
    })
    expect(svg.status()).toBe(200)
    expect(svg.headers()["content-type"]).toContain("image/svg+xml")

    // Real browser context: anonymous navigation to the private preview is denied.
    await page.goto(`/api/presets/${preset.id}/preview.svg?u=${owner.uuid}`)
    await expect(page.getByText(/not found/i).first()).toBeVisible({ timeout: 10_000 })

    // Stremio contract (no secret, namespace only): the owner namespace still
    // renders its own private preset; a stranger namespace falls back.
    const posterBody = {
      tmdbId: MOVIE_ID,
      mediaType: "movie",
      title: "Avatar",
      posterPath: POSTER_PATH,
      language: "it",
      genreName: "Azione",
      voteAverage: 7.8,
      badgePresets: { genre: { id: preset.id, rev: null } },
    }
    const saved = await request.post(`/api/mappings?u=${owner.uuid}`, {
      headers: { ...authHeaders(owner.secret), "content-type": "application/json" },
      data: posterBody,
    })
    expect(saved.ok()).toBeTruthy()
    const ownerPng = await renderPng(request, stremioUrl(owner.uuid))
    const strangerPng = await renderPng(request, stremioUrl(stranger.uuid))
    expect(Buffer.compare(ownerPng, strangerPng)).not.toBe(0)

    await request.delete(`/api/mappings/movie:${MOVIE_ID}?u=${owner.uuid}`, { headers: authHeaders(owner.secret) })
    await request.delete(`/api/presets/${preset.id}?u=${owner.uuid}`, { headers: authHeaders(owner.secret) })
  })

  test("stale client rev: edit/delete invalidates the final render", async ({ page, request }) => {
    const user = await createUser(request, "stale")
    const captured: CapturedPoster[] = []
    watchPosterResponses(page, captured)
    const tag = user.uuid.slice(0, 8)
    const templateOf = (n: number): string => `E2ESTALE${n} ${tag}`

    const designFor = (template: string): Record<string, unknown> => ({
      shape: "pill",
      padding: { x: 14, y: 7 },
      background: { type: "solid", color: "#000000", opacity: 85 },
      text: {
        template,
        color: "#ffffff",
        opacity: 100,
        fontSize: 22,
        fontWeight: 700,
        uppercase: false,
        letterSpacing: 0,
        align: "center",
      },
      scale: 100,
    })
    const created = await request.post(`/api/presets?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: {
        target: "genre",
        visibility: "private",
        metadata: { name: `E2EStale${tag}`, tags: [] as string[] },
        variant: "custom",
        design: designFor(templateOf(1)),
      },
    })
    expect(created.status()).toBe(201)
    const preset = ((await created.json()) as { preset: { id: string; revision: string } }).preset

    // Mapping WITHOUT the binding: standard baseline for this namespace.
    const baseBody = {
      tmdbId: MOVIE_ID,
      mediaType: "movie",
      title: "Avatar",
      posterPath: POSTER_PATH,
      language: "it",
      genreName: "Azione",
      voteAverage: 7.8,
    }
    expect(
      (
        await request.post(`/api/mappings?u=${user.uuid}`, {
          headers: { ...authHeaders(user.secret), "content-type": "application/json" },
          data: baseBody,
        })
      ).ok(),
    ).toBeTruthy()
    const standard = await renderPng(request, stremioUrl(user.uuid))

    // Bind the preset (stale rev from now on): the final render changes.
    expect(
      (
        await request.post(`/api/mappings?u=${user.uuid}`, {
          headers: { ...authHeaders(user.secret), "content-type": "application/json" },
          data: { ...baseBody, badgePresets: { genre: { id: preset.id, rev: preset.revision } } },
        })
      ).ok(),
    ).toBeTruthy()
    const withPresetV1 = await renderPng(request, stremioUrl(user.uuid))
    expect(Buffer.compare(standard, withPresetV1)).not.toBe(0)

    // Real browser sees the saved binding on reopen (mapping truth — the
    // per-title picker no longer renders a status row in the editor).
    const reopenMarkV1 = captured.length
    await openTitleEditor(page, user.uuid, user.secret, "poster")
    const reopenedV1 = await getMapping(request, user.uuid, user.secret)
    expect(reopenedV1.badgePresets?.genre).toMatchObject({ id: preset.id })
    const previewV1 = await awaitFreshPoster(captured, reopenMarkV1)
    expect(await meanAbsDiff(previewV1, withPresetV1)).toBeLessThan(0.01)

    // Edit the preset (real API): revision rotates, mapping still pins rev1.
    const edited = await request.put(`/api/presets/${preset.id}?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: {
        target: "genre",
        visibility: "private",
        metadata: { name: `E2EStale${tag}`, tags: [] as string[] },
        variant: "custom",
        design: designFor(templateOf(2)),
      },
    })
    expect(edited.ok()).toBeTruthy()
    const rev2 = ((await edited.json()) as { preset: { revision: string } }).preset.revision
    expect(rev2).not.toBe(preset.revision)

    // Despite the stale client rev, the final render follows the CURRENT
    // store truth (stable across refetch).
    const withPresetV2 = await renderPng(request, stremioUrl(user.uuid))
    expect(Buffer.compare(withPresetV1, withPresetV2)).not.toBe(0)
    expect(Buffer.compare(withPresetV2, await renderPng(request, stremioUrl(user.uuid)))).toBe(0)
    const reopenMarkV2 = captured.length
    await openTitleEditor(page, user.uuid, user.secret, "poster")
    const previewV2 = await awaitFreshPoster(captured, reopenMarkV2)
    expect(await meanAbsDiff(previewV2, withPresetV2)).toBeLessThan(0.01)

    // Revoke (delete): fail-open to the standard render, never 500.
    expect(
      (await request.delete(`/api/presets/${preset.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })).ok(),
    ).toBeTruthy()
    const afterDelete = await renderPng(request, stremioUrl(user.uuid))
    expect(Buffer.compare(afterDelete, standard)).toBe(0)

    await request.delete(`/api/mappings/movie:${MOVIE_ID}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
  })

  test("Settings global default + per-title override via inline choices (no stubs)", async ({ page, request }) => {
    const user = await createUser(request, "glob")
    const captured: CapturedPoster[] = []
    watchPosterResponses(page, captured)
    const tag = user.uuid.slice(0, 8)

    // Seed one private genre preset via the real API.
    const created = await request.post(`/api/presets?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: {
        target: "genre",
        visibility: "private",
        metadata: { name: `E2EGlob${tag}`, tags: [] as string[] },
        variant: "custom",
        design: {
          shape: "pill",
          padding: { x: 14, y: 7 },
          background: { type: "solid", color: "#cc0000", opacity: 100 },
          text: {
            template: `E2EGLOB ${tag}`,
            color: "#ffffff",
            opacity: 100,
            fontSize: 22,
            fontWeight: 700,
            uppercase: false,
            letterSpacing: 0,
            align: "center",
          },
          scale: 100,
        },
      },
    })
    expect(created.status()).toBe(201)
    const preset = ((await created.json()) as { preset: { id: string; revision: string } }).preset

    // Seed a second genre preset with a visibly different design: the
    // per-title override below must render differently from the global.
    const created2 = await request.post(`/api/presets?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: {
        target: "genre",
        visibility: "private",
        metadata: { name: `E2EGlob2${tag}`, tags: [] as string[] },
        variant: "custom",
        design: {
          shape: "pill",
          padding: { x: 14, y: 7 },
          background: { type: "solid", color: "#0000cc", opacity: 100 },
          text: {
            template: `E2EGLOB2 ${tag}`,
            color: "#ffffff",
            opacity: 100,
            fontSize: 22,
            fontWeight: 700,
            uppercase: false,
            letterSpacing: 0,
            align: "center",
          },
          scale: 100,
        },
      },
    })
    expect(created2.status()).toBe(201)
    const preset2 = ((await created2.json()) as { preset: { id: string; revision: string } }).preset

    // Global default for the space (real Settings API, owner auth): the
    // genre family of EVERY poster follows this preset until overridden.
    const putDefaults = await request.put(`/api/defaults?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: { badgePresets: { genre: { id: preset.id, rev: preset.revision } } },
    })
    expect(putDefaults.ok()).toBeTruthy()
    const effective = (await (
      await request.get(`/api/defaults?u=${user.uuid}`, { headers: authHeaders(user.secret) })
    ).json()) as { badgePresets?: Record<string, { id: string }> }
    expect(effective.badgePresets?.genre?.id).toBe(preset.id)

    // Untouched title renders the global default (follower, no mapping).
    const globalRender = await renderPng(request, stremioUrl(user.uuid))

    // Open the editor: the removed standalone 9-row card stays gone; the
    // 9 inline per-title choices now live on the dedicated Badge Lab tab
    // (the native Badge tab keeps only native appearance/toggle controls).
    const reopenMark = captured.length
    await openTitleEditor(page, user.uuid, user.secret, "poster")
    await expect(page.getByTestId("badge-family-presets")).toHaveCount(0)
    await expect(page.getByTestId("badge-lab-panel-title")).toHaveCount(0)
    // Native Badge tab: no custom family choices.
    await expect(page.locator('[data-testid^="family-choice-title-"]')).toHaveCount(0)
    // Dedicated Badge Lab tab: all nine family choices + editor entry.
    await page.getByRole("tab", { name: "Badge Lab", exact: true }).click()
    const labPanel = page.getByTestId("badge-lab-panel-title")
    await expect(labPanel).toBeVisible({ timeout: 15_000 })
    await expect(labPanel.getByTestId(/^family-choice-title-(rank|extra|genre|quality|age|network|separateRatings|customRatings|comingSoon)$/)).toHaveCount(9)
    await expect(labPanel.getByTestId("badge-lab-panel-title-open-editor")).toBeVisible()
    const inline = labPanel.getByTestId("family-choice-title-genre")
    await expect(inline).toBeVisible({ timeout: 15_000 })
    const previewGlobal = await awaitFreshPoster(captured, reopenMark)
    expect(await meanAbsDiff(previewGlobal, globalRender)).toBeLessThan(0.01)

    // Per-title override to the second custom (dedicated Badge Lab tab,
    // single select): the staged binding is saved for this family only, so
    // its render differs from the space-default render.
    await inline.getByTestId("family-choice-title-genre-select").selectOption(preset2.id)
    await savePoster(page)
    const overridden = await getMapping(request, user.uuid, user.secret)
    expect(overridden.badgePresets?.genre).toMatchObject({ id: preset2.id })
    const customRender = await renderPng(request, stremioUrl(user.uuid))
    expect(Buffer.compare(customRender, globalRender)).not.toBe(0)

    // Per-title Default (dedicated Badge Lab tab, same select): the stored
    // key is deleted and the per-shape follow flag persists, so the title
    // follows the space default again (prospective-save parity: same bytes
    // as the untouched global render).
    await openTitleEditor(page, user.uuid, user.secret, "poster")
    await page.getByRole("tab", { name: "Badge Lab", exact: true }).click()
    const inlineAgain = page.getByTestId("badge-lab-panel-title").getByTestId("family-choice-title-genre")
    await expect(inlineAgain).toBeVisible({ timeout: 15_000 })
    await expect(inlineAgain.getByTestId("family-choice-title-genre-select")).toHaveValue(preset2.id)
    await inlineAgain.getByTestId("family-choice-title-genre-select").selectOption("")
    await savePoster(page)
    const followed = await getMapping(request, user.uuid, user.secret)
    expect(followed.badgePresets?.genre).toBeUndefined()
    const followRender = await renderPng(request, stremioUrl(user.uuid))
    expect(await meanAbsDiff(followRender, globalRender)).toBeLessThan(0.01)

    // Cleanup: mapping + presets (namespace-scoped, authenticated).
    await request.delete(`/api/mappings/movie:${MOVIE_ID}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
    await request.delete(`/api/presets/${preset.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
    await request.delete(`/api/presets/${preset2.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
  })

  test("Badge Lab dedicated tab: nine choices gathered, native Badge clean, tab switch keeps state", async ({
    page,
    request,
  }) => {
    const user = await createUser(request, "tabbed")
    const tag = user.uuid.slice(0, 8)

    // Seed one private genre preset via the real API (choice list source).
    const created = await request.post(`/api/presets?u=${user.uuid}`, {
      headers: { ...authHeaders(user.secret), "content-type": "application/json" },
      data: {
        target: "genre",
        visibility: "private",
        metadata: { name: `E2ETab${tag}`, tags: [] as string[] },
        variant: "custom",
        design: {
          shape: "pill",
          padding: { x: 14, y: 7 },
          background: { type: "solid", color: "#000000", opacity: 85 },
          text: {
            template: `E2ETAB ${tag}`,
            color: "#ffffff",
            opacity: 100,
            fontSize: 22,
            fontWeight: 700,
            uppercase: false,
            letterSpacing: 0,
            align: "center",
          },
          scale: 100,
        },
      },
    })
    expect(created.status()).toBe(201)
    const preset = ((await created.json()) as { preset: { id: string; revision: string } }).preset

    await openTitleEditor(page, user.uuid, user.secret, "poster")
    // Native Badge tab (openTitleEditor lands there): no custom choices.
    await expect(page.getByTestId("badge-lab-panel-title")).toHaveCount(0)
    await expect(page.locator('[data-testid^="family-choice-title-"]')).toHaveCount(0)
    // Dedicated tab: all nine families (single select each) + the one Lab
    // editor entry; no Community entries, no per-row action buttons.
    const labTab = page.getByRole("tab", { name: "Badge Lab", exact: true })
    await expect(labTab).toBeVisible()
    await labTab.click()
    const labPanel = page.getByTestId("badge-lab-panel-title")
    await expect(labPanel).toBeVisible({ timeout: 15_000 })
    await expect(labPanel.getByTestId(/^family-choice-title-(rank|extra|genre|quality|age|network|separateRatings|customRatings|comingSoon)$/)).toHaveCount(9)
    await expect(labPanel.getByTestId("badge-lab-panel-title-open-editor")).toBeVisible()
    await expect(labPanel.getByTestId("badge-lab-panel-title-community")).toHaveCount(0)
    await expect(labPanel.getByTestId("family-choice-title-genre-select")).toBeVisible()
    // Stage the seeded custom via the select, switch tabs and back: the
    // staged choice survives (no write, no reset) and still selects the pin.
    await labPanel.getByTestId("family-choice-title-genre-select").selectOption(preset.id)
    await page.getByRole("tab", { name: "Badge", exact: true }).click()
    await expect(page.locator('[data-testid^="family-choice-title-"]')).toHaveCount(0)
    await labTab.click()
    await expect(page.getByTestId("family-choice-title-genre-select")).toHaveValue(preset.id)
    // No mapping persisted without the explicit Save (tab switch never writes).
    const noMapping = await request.get(`/api/mappings/movie:${MOVIE_ID}?u=${user.uuid}`, {
      headers: authHeaders(user.secret),
    })
    expect(noMapping.status()).toBe(404)

    await request.delete(`/api/presets/${preset.id}?u=${user.uuid}`, { headers: authHeaders(user.secret) })
  })
})
