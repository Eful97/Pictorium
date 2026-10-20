import { test, expect } from "@playwright/test"
import sharp from "sharp"

// Final integration coverage for the 1.25.9 task batch (diagnostics endpoint,
// action onboarding replay, latency honesty, fork-derived badges identity).
// Deterministic by construction: mock-backed app (playwright.config.ts points
// TMDB at e2e/mock-server.mjs), no live network, no key-dependent happy paths.

const MOCK_KEY = "mock-tmdb-key-0000000000"
const NEXT_EPISODE_TOKEN = "__badge.nextEpisode"

function isImagePayload(bytes: Buffer): boolean {
  if (bytes.length < 12) return false
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (png) return true
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (jpeg) return true
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  const webp = riff && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  if (webp) return true
  const ftyp = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  return ftyp
}

test.describe("diagnostics install-key endpoint", () => {
  test("invalid JSON body is a 400 bad-request (fail path)", async ({ request }) => {
    const res = await request.post("/api/diagnostics/install-key", {
      headers: { "Content-Type": "application/json" },
      data: "not-json{{{",
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("bad-request")
    expect(body.ok).toBe(false)
    expect(res.headers()["cache-control"]).toContain("no-store")
  })

  test("non-string user id is a 400 bad-request (fail path)", async ({ request }) => {
    const res = await request.post("/api/diagnostics/install-key", {
      data: { u: 123 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).code).toBe("bad-request")
  })

  test("garbage config token is a 400 bad-config (fail path)", async ({ request }) => {
    const res = await request.post("/api/diagnostics/install-key", {
      data: { config: "!!!not-a-token!!!" },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).code).toBe("bad-config")
  })

  test("empty context with no key is never green (missing, no-store)", async ({ request }) => {
    const res = await request.post("/api/diagnostics/install-key", {
      data: {},
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    // Keyless e2e env: the endpoint must report missing (or invalid after a
    // failed live probe) — never ok:true without a working key.
    expect(["missing", "invalid"]).toContain(body.code)
    expect(res.headers()["cache-control"]).toContain("no-store")
  })
})

test.describe("shared poster renderer (install probe path)", () => {
  test("probe title renders a decodable image (decoded dimensions, never an error page)", async ({ request }) => {
    const res = await request.get("/api/poster/movie/550", {
      params: { api_key: MOCK_KEY, badges: "1", ranking: "1", lang: "it" },
    })
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toMatch(/image\//)
    const bytes = Buffer.from(await res.body())
    expect(bytes.length).toBeGreaterThan(0)
    expect(isImagePayload(bytes)).toBe(true)
    // Magic bytes alone are not a decode: prove the payload actually decodes
    // with nonzero dimensions (sharp is already a repo dependency).
    const meta = await sharp(bytes).metadata()
    expect(meta.width ?? 0).toBeGreaterThan(0)
    expect(meta.height ?? 0).toBeGreaterThan(0)
  })

  test("manual extra text renders and validators are stable (repeat ETag + 304)", async ({ request }) => {
    const params = { api_key: MOCK_KEY, badges: "1", ranking: "1", lang: "it", extra: "FinalCheck" }
    const first = await request.get("/api/poster/movie/603", { params })
    expect(first.status()).toBe(200)
    expect(first.headers()["content-type"]).toMatch(/image\//)
    const etag = first.headers()["etag"]
    expect(typeof etag).toBe("string")
    expect(etag.length).toBeGreaterThan(0)
    const second = await request.get("/api/poster/movie/603", { params })
    expect(second.headers()["etag"]).toBe(etag)
    const conditional = await request.get("/api/poster/movie/603", {
      params,
      headers: { "If-None-Match": etag },
    })
    expect(conditional.status()).toBe(304)
  })

  test("manual next-episode token has live identity: elapsed window renders nothing frozen", async ({ request }) => {
    // Mock TMDB dates are all in the past, so the 1..14-day window is elapsed:
    // the token must resolve to no badge (identical bytes to no extra), never
    // to a frozen dated label and never to a literal token leak.
    const base = { api_key: MOCK_KEY, badges: "1", ranking: "1", lang: "it" }
    const plain = await request.get("/api/poster/series/1399", { params: base })
    expect(plain.status()).toBe(200)
    const token = await request.get("/api/poster/series/1399", {
      params: { ...base, extra: NEXT_EPISODE_TOKEN },
    })
    expect(token.status()).toBe(200)
    expect(token.headers()["content-type"]).toMatch(/image\//)
    expect(token.headers()["etag"]).toBe(plain.headers()["etag"])
  })
})

test.describe("status page telemetry honesty", () => {
  test("locked cache telemetry shows unavailable, never fabricated zeros", async ({ page }) => {
    // Observe (never swallow) page errors: the initScript key must arrive via
    // an explicit argument — closing over module MOCK_KEY throws a
    // ReferenceError inside the browser context.
    const pageErrors: string[] = []
    page.on("pageerror", (err) => {
      pageErrors.push(String((err as Error)?.message ?? err))
    })
    await page.addInitScript(
      (key: string) => {
        localStorage.setItem("pictorium_profile_id", "e2e-final-integration")
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("preferred_lang", "it")
        localStorage.setItem("tmdb_key", key)
      },
      MOCK_KEY,
    )
    await page.goto("/status")
    // No admin token / PIN in the e2e env: the operator surface stays
    // fail-closed and the page reports unavailability honestly.
    await expect(page.getByText("Non disponibile").first()).toBeVisible({ timeout: 30_000 })
    // The initScript must not have thrown: target the known closure failure
    // signature without masking unrelated app errors.
    expect(
      pageErrors.filter(
        (message) => message.includes("MOCK_KEY") || /ReferenceError|is not defined/.test(message),
      ),
    ).toEqual([])
  })
})

test.describe("onboarding replay wiring", () => {
  test("repeat-setup opens the wizard then the checklist; legacy dismissal is not a blocker; reload never auto-replays", async ({
    page,
  }) => {
    await page.addInitScript(
      (key: string) => {
        localStorage.setItem("pictorium_profile_id", "e2e-final-replay")
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("preferred_lang", "it")
        localStorage.setItem("tmdb_key", key)
        // Old slide-based dismissal: honored read-only for auto-show, but must
        // not block an explicit repeat.
        localStorage.setItem("pictorium_onboarding_done", "true")
      },
      MOCK_KEY,
    )
    await page.goto("/")
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    // Legacy dismissal suppresses the auto-showed tour (Modal keeps its DOM
    // mounted while closed, so assert visibility, never node count).
    await expect(page.getByTestId("onboarding-checklist")).toBeHidden()

    // Open settings and fire the explicit repeat intent.
    const settingsButton = page
      .getByRole("button", { name: /Configura tutti i poster|Tutti i poster|Impostazioni/i })
      .filter({ visible: true })
    await expect(settingsButton.first()).toBeVisible({ timeout: 15_000 })
    await settingsButton.first().click()
    const dialog = page.getByRole("dialog").filter({ visible: true })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await dialog.getByTestId("settings-secondary-data").click()
    const repeatButton = dialog.getByTestId("repeat-setup")
    await repeatButton.scrollIntoViewIfNeeded()
    await repeatButton.click()

    // The setup wizard runs first (never stacked with the tour).
    await expect(page.getByRole("heading", { name: "Benvenuto in Pictorium" })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole("button", { name: "Italiano" }).click()
    await page.getByRole("button", { name: "Italia" }).click()
    await page.getByRole("button", { name: "Salta questo passaggio" }).click()

    // After the wizard, the new action checklist appears despite the legacy flag.
    await expect(page.getByTestId("onboarding-checklist")).toBeVisible({ timeout: 15_000 })

    // Dismiss persists per-namespace (booleans only: no keys or secrets).
    await page.getByTestId("onboarding-skip").click()
    await expect(page.getByTestId("onboarding-checklist")).toBeHidden()
    const progressRaw = await page.evaluate(() =>
      localStorage.getItem("pictorium_onboarding_progress:local"),
    )
    expect(progressRaw).not.toBeNull()
    const progress = JSON.parse(progressRaw as string) as Record<string, unknown>
    expect(progress["dismissed"]).toBe(true)
    expect(progressRaw).not.toContain(MOCK_KEY)

    // The intent is transient: a reload never auto-replays.
    await page.reload()
    await expect(page.getByPlaceholder(/cerca/i)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId("onboarding-checklist")).toBeHidden()
  })
})
