import { test, expect, type Locator, type Page, type Route } from "@playwright/test"
import { putDefaultsWithRetry } from "./defaults-retry"

// T6 badge-format-final: Badge tab per-format editing (Verticale/Orizzontale),
// rank Numero + extra Angolo + quality toggle isolation, per-title rules, and
// rs/xbs API semantics. Transport-level only (preview query params + backend
// defaults JSON + poster bytes): no snapshots here — pixel baselines live in
// pictorium-visual.spec.ts. External APIs come from the mock server.
//
// Actual five-tab settings (staged, explicit Save only): the dialog opens on
// the Preset tab (never Badge); rank lives in Classifiche (unified
// Nastro/Numero/Badge/Fresh/Card presentation, same rs field contract),
// extra styles in Badge, the quality visibility switch in Informazioni, and
// geometry in Trasforma. The format selector is the single shared top edit
// target across tabs; draft edits move the preview URL only and the backend
// stays at baseline until the footer Save (testid settings-save) PUTs.

const DEMO_PROFILE = "e2e-badge-format"

interface Seen {
  urls: string[]
}

function isPosterRequest(raw: string): URL | null {
  if (!/\/api\/poster\/(movie|tv)\//.test(raw)) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  return u.searchParams.get("preview") === "1" ? u : null
}

/** Settings defaults preview (Avatar demo): carries demosamples=1. */
function isDefaultsPreviewUrl(u: URL): boolean {
  return u.searchParams.get("demosamples") === "1"
}

function collectRequests(page: Page, seen: Seen) {
  page.on("request", (req) => {
    if (isPosterRequest(req.url())) seen.urls.push(req.url())
  })
}

function findLastParams(
  urls: string[],
  from: number,
  match: (u: URL) => boolean,
  pred: (u: URL) => boolean,
): URLSearchParams | null {
  let out: URLSearchParams | null = null
  for (const raw of urls.slice(from)) {
    const u = isPosterRequest(raw)
    if (u && match(u) && pred(u)) out = u.searchParams
  }
  return out
}

function findLastUrl(
  urls: string[],
  from: number,
  match: (u: URL) => boolean,
  pred: (u: URL) => boolean,
): URL | null {
  let out: URL | null = null
  for (const raw of urls.slice(from)) {
    const u = isPosterRequest(raw)
    if (u && match(u) && pred(u)) out = u
  }
  return out
}

async function nextPreview(
  seen: Seen,
  action: () => Promise<unknown>,
  pred: (u: URL) => boolean = () => true,
  match: (u: URL) => boolean = (u) => u.searchParams.get("demosamples") === "1",
) {
  const n = seen.urls.length
  await action()
  let out: URLSearchParams | null = null
  await expect
    .poll(
      () => {
        out = findLastParams(seen.urls, n, match, pred)
        return out ? "ok" : null
      },
      { timeout: 30_000 },
    )
    .not.toBeNull()
  return out as unknown as URLSearchParams
}

async function seed(page: Page, profile: string, tmdbKey = "") {
  await page.addInitScript(
    ({ p, key }: { p: string; key: string }) => {
      try {
        localStorage.clear()
        localStorage.setItem("pictorium_profile_id", p)
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
        localStorage.setItem("tmdb_key", key)
      } catch {}
    },
    { p: profile, key: tmdbKey },
  )
}

let defaultsDirty = false

async function putDefaults(page: Page, payload: Record<string, unknown>) {
  await page.goto("/")
  await putDefaultsWithRetry(page, "reset defaults", payload)
  defaultsDirty = true
  await page.goto("/")
}

async function getDefaults(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const r = await fetch("/api/defaults")
    if (!r.ok) throw new Error(`get defaults: ${r.status}`)
    return (await r.json()) as Record<string, unknown>
  })
}

/**
 * Teardown-only 429 tolerance for the final restore verify: the serial file
 * run legitimately bursts the shared `defaults` bucket (boot GETs per
 * navigation + staged PUTs + client hydration retries), so a 429 here is
 * runtime-expected, never an app bug — honor Retry-After and retry (same
 * rule as putDefaultsWithRetry). Any other status throws immediately, and an
 * exhausted loop throws with status details: a failed restore never silently
 * becomes a pass. Test bodies keep the strict getDefaults (a 429 mid-test
 * must fail loudly, not hide behind retries).
 */
async function getDefaultsWithRetry(page: Page, label: string): Promise<Record<string, unknown>> {
  let last = `${label}: unknown`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/defaults")
      return {
        ok: r.ok,
        status: r.status,
        retryAfter: r.headers.get("Retry-After"),
        body: await r.text(),
      }
    })
    if (res.ok) return JSON.parse(res.body) as Record<string, unknown>
    last = `${label}: ${res.status} ${res.body.slice(0, 200)}`
    if (res.status !== 429 || attempt === 3) break
    const raw = (res.retryAfter ?? "").trim()
    await page.waitForTimeout(/^\d+$/.test(raw) ? Number(raw) * 1000 : 3000)
  }
  throw new Error(last)
}

/**
 * Global-defaults isolation. /api/defaults is a single instance namespace
 * (MULTI_USER is off in E2E, so there is no ?user= scoping) and the seeded
 * DEMO_PROFILE localStorage id never reaches the API — it is client-only.
 * PUT shallow-merges the root and replaces `landscape` wholesale, so a
 * snapshot-restore via PUT cannot delete keys (restoring `{}` is a no-op)
 * and retry loops only trip the defaults rate limiter. Worse: the debounced
 * UI autosave persists FULL state (including factory echoes like
 * gradientHeight:30/blurFade:50 and the edits under test), so after any UI
 * test the stored state is RESET ∪ autosave-extras — later specs inherit it
 * (gradient echoes shadow landscape code defaults 20/70; observed in serial
 * runs via debug-JSON appearance diff). Hence every test starts from the
 * deterministic SEED_PAYLOAD below, and the afterEach restores the canonical
 * FACTORY payload (every autosaveable key at its factory value — verified
 * with toMatchObject so drift fails loudly): merge-safe, single PUT + single
 * verify GET, no pollution. Keys outside this spec's mutation surface
 * (badgeStyle, ratingSources, …) are covered by the factory restore by
 * design. Pure-API tests never PUT (defaultsDirty stays false) and inherit
 * the canonical state left behind.
 */
const FACTORY_RESTORE = {
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  extraBadgeStyle: null,
  badgeFont: "inter",
  qualityBadgeStyle: "standard",
  videoFormats: null,
  blurEnabled: true,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  tintStrength: 20,
  topShade: 50,
  gradientHeight: 30,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  extraBadgeScale: null,
  extraBadgeOffsetX: null,
  extraBadgeOffsetY: null,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  separateBadgeScale: 130,
  separateBadgeOffsetX: 0,
  separateBadgeOffsetY: 0,
  networkLogoScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeOffsetX: -10,
  qualityBadgeOffsetY: 15,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
  globalBadges: true,
  rankingBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  badgeQuality: true,
  customRatings: true,
  customRatingEndpoint: "",
  customRatingApiKeyHeader: "",
  ratingSources: ["imdb", "tmdb"],
  separateRatings: false,
  separateRatingsStyle: "column",
  sashOrder: ["upcoming", "rank", "new", "award", "extra"],
  networkLogo: true,
  networkLogoPosition: "auto",
  networkLogoFollowTitle: true,
  preRelease: false,
  ribbonSide: "left",
  ribbonEnabled: true,
  posterShape: "poster",
  region: "IT",
  dateFormat: "locale",
  episodeMetadataSource: "tmdb",
  logoAlign: null,
  logoScale: null,
  logoOffsetX: null,
  logoOffsetY: null,
  defaultAutoRotateBackdrop: false,
  defaultLandscapeFitEnabled: true,
  defaultPortraitFitEnabled: true,
  disableCleanPosters: false,
  landscape: {
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
  },
}

test.afterEach(async ({ page }) => {
  // API-only tests never touch /api/defaults: zero requests here keeps the
  // request volume under the defaults rate limiter (30 burst, 3/sec refill).
  if (!defaultsDirty) return
  defaultsDirty = false
  // Settle trailing debounced UI autosaves BEFORE the restore PUT: poll for
  // server-state stability (600ms steps, bounded) instead of a fixed sleep —
  // the 500ms debounce flush is observed, never guessed. Navigation then
  // unmounts the editor so pending timers are cleared and can never fire
  // after the restore.
  try {
    let prev = JSON.stringify(await getDefaults(page))
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(600)
      const cur = JSON.stringify(await getDefaults(page))
      if (cur === prev) break
      prev = cur
    }
  } catch {}
  await page.goto("/")
  await putDefaultsWithRetry(page, "restore defaults", FACTORY_RESTORE)
  await page.goto("/")
  // Verify the full canonical surface — a mismatch is a real leak
  // (merge-only PUT cannot delete keys, so every autosaved key must be
  // covered above with its factory value). 429-tolerant: serial-run heat is
  // retried, never weakened.
  const got = await getDefaultsWithRetry(page, "verify restore")
  expect(got).toMatchObject(FACTORY_RESTORE)
})

async function waitDefaults(page: Page, pred: (d: Record<string, unknown>) => boolean) {
  // 500ms poll interval: the condition follows a debounced server autosave,
  // and tight polling trips the defaults rate limiter (30 burst, 3/sec).
  await expect
    .poll(
      async () => {
        try {
          return pred(await getDefaults(page)) ? "ok" : null
        } catch {
          return null
        }
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe("ok")
}

/** Desktop primary-tab navigation (five equal tabs). Mobile uses the
 *  #mobile-settings-category select instead (see mobile test). */
async function gotoTab(dialog: Locator, name: string) {
  await dialog.getByRole("tab", { name, exact: true }).click()
}

/**
 * Explicit staged Save: the single footer PUT. Draft edits never persist on
 * their own (no autosave), so every persistence assertion below first clicks
 * this button and awaits the PUT ACK — a passing waitDefaults afterwards
 * proves the save, never an implicit write.
 */
async function explicitSave(page: Page, scope: Locator) {
  const saveBtn = scope.getByTestId("settings-save")
  await expect(saveBtn).toBeEnabled()
  const put = page.waitForResponse(
    (r) => r.url().includes("/api/defaults") && r.request().method() === "PUT",
    { timeout: 30_000 },
  )
  await saveBtn.click()
  const res = await put
  expect(res.ok()).toBeTruthy()
}

/**
 * Seed per test (stato di PARTENZA, non di restore): portrait flats
 * (delivery-relevant) + a landscape profile that starts identical to the
 * flats, so every landscape edit is an observable delta and portrait/delivery
 * must stay byte-identical. Il restore a fine test è FACTORY_RESTORE sopra
 * (i downstream ereditano il factory, mai i valori di questo seed).
 */
const SEED_PAYLOAD = {
  posterShape: "poster",
  globalBadges: true,
  rankingBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  badgeQuality: true,
  qualityBadgeStyle: "standard",
  rankingBadgeStyle: "pill",
  ribbonEnabled: true,
  ribbonSide: "left",
  extraBadgeStyle: null,
  landscape: {
    rankingBadgeStyle: "pill",
    ribbonEnabled: true,
    extraBadgeStyle: null,
    badgeQuality: true,
  },
}

test.describe("Badge Verticale/Orizzontale: isolation + persistence", () => {
  test("desktop: landscape edits Numero/Angolo/quality-off keep portrait + delivery, survive tab switch + reload", async ({
    page,
    request,
  }) => {
    await seed(page, DEMO_PROFILE)
    await page.setViewportSize({ width: 1280, height: 900 })
    await putDefaults(page, SEED_PAYLOAD)
    const seen: Seen = { urls: [] }
    collectRequests(page, seen)

    // Portrait baseline: pill + legacy (no xbs emitted) + quality on.
    // NOTE (race deterministica): il capture-window di nextPreview parte
    // PRIMA dell'apertura del dialog — le request preview del mount non
    // possono perdersi (prima si perdeva la prima request su boot veloci e
    // il poll scadeva a 30s). Il pred include rs==pill: aspetta lo stato
    // assestato post-idratazione, non un transient di factory.
    // (I locator sono lazy: dichiarati prima dell'action per evitare TDZ.)
    const dialog = page.getByRole("dialog")
    let p = await nextPreview(
      seen,
      async () => {
        await page.getByRole("button", { name: /Impostazioni/i }).click()
        await expect(dialog).toBeVisible()
      },
      (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("rs") === "pill" && u.searchParams.get("bq") === "1",
    )
    expect(p.get("shape")).toBe("poster")
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()
    expect(p.get("bq")).toBe("1")
    expect(p.get("qbs")).toBe("standard")

    // Resolved-style proof BEFORE any portrait edit: the legacy portrait
    // (no xbs = no independence boundary) omits xbs on the wire and renders
    // its own rank look. Record the server-resolved settings + computed
    // badge so the AFTER state below must match exactly (same own-rank
    // style, not a substituted transport value).
    const beforeUrl = findLastUrl(seen.urls, 0, isDefaultsPreviewUrl, (u) => u.searchParams.get("shape") === "poster")
    expect(beforeUrl).not.toBeNull()
    const beforeDebugUrl = new URL(beforeUrl!.toString())
    beforeDebugUrl.searchParams.set("debug", "1")
    const beforeDebugRes = await request.get(beforeDebugUrl.toString())
    expect(beforeDebugRes.ok()).toBeTruthy()
    const beforeDebug = (await beforeDebugRes.json()) as {
      badge: { settings: { rankingBadgeStyle: unknown }; computed: { badge: unknown } }
    }
    const beforeRs = beforeDebug.badge.settings.rankingBadgeStyle
    const beforeBadge = JSON.stringify(beforeDebug.badge.computed.badge)

    await expect(dialog).toBeVisible()

    // Actual five-tab home: the dialog opens on Preset, never on Badge.
    await expect(dialog.getByRole("tab", { name: "Preset", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    // Single shared format selector sits ABOVE the controls (one edit target
    // for every primary tab): geometry proof, not just visibility.
    const formatTarget = dialog.getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()
    await expect(formatTarget.getByText("Verticale", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    const selBox = await formatTarget.boundingBox()
    const controlsBox = await dialog.getByTestId("settings-controls").boundingBox()
    expect(selBox).not.toBeNull()
    expect(controlsBox).not.toBeNull()
    expect(selBox!.y + selBox!.height).toBeLessThanOrEqual(controlsBox!.y + 8)

    // Staged backend baseline BEFORE any draft edit: portrait flats plus a
    // landscape profile identical to the flats. Every draft step below must
    // move the preview URL only — the backend stays here until explicit Save.
    const baseline = await getDefaults(page)
    expect(baseline.posterShape).toBe("poster")
    expect(baseline.rankingBadgeStyle).toBe("pill")
    expect(baseline.extraBadgeStyle).toBeNull()
    expect(baseline.badgeQuality).toBe(true)
    expect((baseline.landscape ?? {}) as Record<string, unknown>).toMatchObject({
      rankingBadgeStyle: "pill",
      extraBadgeStyle: null,
      badgeQuality: true,
    })

    // Rank lives in Classifiche (unified Nastro/Numero/Badge/Fresh/Card over
    // the same rs contract — never renamed to fit this spec). Five-tab Badge
    // renders bare: no macro-group disclosures to expand, controls are direct.
    await gotoTab(dialog, "Classifiche")
    const presentation = dialog.getByTestId("ranking-presentation")
    await expect(presentation).toBeVisible()

    // Orizzontale: same values (profile inherits flats), landscape shape.
    // Settled-state pred (rs==pill && bq==1): the staged session opens on the
    // pre-hydration outer and rebases asynchronously, so the first landscape
    // emissions are factory transients (rs=default, xbs=follow-rank, bq=0) —
    // same post-hydration wait as the portrait baseline above, never the
    // first transient.
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Orizzontale", { exact: true }).click()
      },
      (u) =>
        u.searchParams.get("shape") === "landscape" &&
        u.searchParams.get("rs") === "pill" &&
        u.searchParams.get("bq") === "1",
    )
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()

    // Format-target switch never persists: delivery + both profiles unchanged.
    let draft = await getDefaults(page)
    expect(draft).toMatchObject({
      posterShape: "poster",
      rankingBadgeStyle: "pill",
      extraBadgeStyle: null,
      badgeQuality: true,
    })

    // Landscape edit 1 (Classifiche home): rank Numero -> rs=number.
    // bq==1 pins the settled staged tuple (pre-hydration bq=0 transients
    // with rs=number exist and must not match).
    const numero = presentation.getByRole("radio", { name: "Numero" })
    p = await nextPreview(
      seen,
      async () => {
        await numero.click()
      },
      (u) =>
        u.searchParams.get("shape") === "landscape" &&
        u.searchParams.get("rs") === "number" &&
        u.searchParams.get("bq") === "1",
    )
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("rs")).toBe("number")
    await expect(numero).toHaveAttribute("aria-checked", "true")

    // Side row (Sinistra/Destra) home is Classifiche with Numero active
    // (never the Badge tab, never Trasforma geometry).
    await expect(
      dialog.getByRole("radiogroup", { name: "Posizione" }).filter({ visible: true }),
    ).toBeVisible()

    // Draft truth: preview moved to the landscape target only, backend still
    // the pre-edit baseline (staged — no autosave).
    draft = await getDefaults(page)
    expect(draft).toMatchObject({
      posterShape: "poster",
      rankingBadgeStyle: "pill",
      extraBadgeStyle: null,
      badgeQuality: true,
    })
    expect((draft.landscape ?? {}) as Record<string, unknown>).toMatchObject({
      rankingBadgeStyle: "pill",
      badgeQuality: true,
    })

    // Landscape edit 2 (Badge home): extra Angolo -> xbs=corner.
    await gotoTab(dialog, "Badge")
    const extraWrap = dialog.getByTestId("badge-extra-style-wrap").filter({ visible: true })
    const angolo = extraWrap.getByRole("button", { name: "Angolo" })
    await expect(angolo).toBeVisible()
    p = await nextPreview(
      seen,
      async () => {
        await angolo.click()
      },
      (u) => u.searchParams.get("shape") === "landscape" && u.searchParams.get("rs") === "number" && u.searchParams.get("xbs") === "corner",
    )
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("rs")).toBe("number")
    expect(p.get("xbs")).toBe("corner")

    // Draft truth again: preview moved, backend still baseline until Save.
    draft = await getDefaults(page)
    expect((draft.landscape ?? {}) as Record<string, unknown>).toMatchObject({
      rankingBadgeStyle: "pill",
      badgeQuality: true,
    })

    // Landscape edit 3 (Informazioni home): quality toggle off -> bq=0.
    await gotoTab(dialog, "Informazioni")
    const qualitySwitch = dialog
      .getByRole("switch", { name: "Qualità streaming" })
      .filter({ visible: true })
    await expect(qualitySwitch).toBeVisible()
    p = await nextPreview(
      seen,
      async () => {
        await qualitySwitch.click()
      },
      (u) =>
        u.searchParams.get("shape") === "landscape" &&
        u.searchParams.get("rs") === "number" &&
        u.searchParams.get("xbs") === "corner" &&
        u.searchParams.get("bq") === "0",
    )
    expect(p.get("shape")).toBe("landscape")
    await expect(qualitySwitch).toHaveAttribute("aria-checked", "false")

    // Draft truth again: preview moved, backend still baseline until Save.
    draft = await getDefaults(page)
    expect(draft).toMatchObject({ posterShape: "poster", badgeQuality: true })
    expect((draft.landscape ?? {}) as Record<string, unknown>).toMatchObject({
      badgeQuality: true,
    })

    // Explicit Save persists: portrait flats + delivery untouched, landscape
    // profile holds the three edits. waitDefaults verifies the stored result.
    await explicitSave(page, dialog)
    await waitDefaults(page, (d) => {
      const land = (d.landscape ?? {}) as Record<string, unknown>
      return (
        land.rankingBadgeStyle === "number" &&
        land.extraBadgeStyle === "corner" &&
        land.badgeQuality === false
      )
    })
    let d = await getDefaults(page)
    expect(d.posterShape).toBe("poster")
    expect(d.rankingBadgeStyle).toBe("pill")
    expect(d.extraBadgeStyle).toBeNull()
    expect(d.badgeQuality).toBe(true)

    // Tab switch keeps the edit target: the shared preview is already loaded
    // for this exact landscape URL, so no refetch is expected — the kept
    // target (pressed state) plus the last preview transport prove it.
    await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    await expect(dialog.getByRole("tabpanel", { name: "Trasforma" })).toBeVisible()
    await expect(formatTarget.getByText("Orizzontale", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    const lastTrasforma = findLastParams(seen.urls, 0, isDefaultsPreviewUrl, (u) => u.searchParams.get("shape") === "landscape")
    expect(lastTrasforma).not.toBeNull()
    expect(lastTrasforma!.get("rs")).toBe("number")
    expect(lastTrasforma!.get("xbs")).toBe("corner")

    // Back to Classifiche: same landscape URL is already loaded, so no
    // refetch is expected — assert the retained target + values in UI and
    // the last preview transport instead of waiting for a new request.
    await gotoTab(dialog, "Classifiche")
    await expect(dialog.getByTestId("ranking-presentation")).toBeVisible()
    await expect(formatTarget.getByText("Orizzontale", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(
      dialog.getByTestId("ranking-presentation").getByRole("radio", {
        name: "Numero",
      }),
    ).toHaveAttribute("aria-checked", "true")
    const lastLand = findLastParams(seen.urls, 0, isDefaultsPreviewUrl, (u) => u.searchParams.get("shape") === "landscape")
    expect(lastLand).not.toBeNull()
    expect(lastLand!.get("rs")).toBe("number")
    expect(lastLand!.get("xbs")).toBe("corner")
    expect(lastLand!.get("bq")).toBe("0")

    // Badge home still shows the saved extra choice; Informazioni still shows
    // quality off — same shared target, no refetch, no extra edit.
    await gotoTab(dialog, "Badge")
    await expect(
      dialog.getByTestId("badge-extra-style-wrap").filter({ visible: true }),
    ).toBeVisible()
    await expect(formatTarget.getByText("Orizzontale", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await gotoTab(dialog, "Informazioni")
    await expect(
      dialog
        .getByRole("switch", { name: "Qualità streaming" })
        .filter({ visible: true }),
    ).toHaveAttribute("aria-checked", "false")

    // Back to portrait: original values, no landscape leak. Settled-state
    // pred (rs==pill && bq==1) skips the pre-hydration factory transients.
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Verticale", { exact: true }).click()
      },
      (u) =>
        u.searchParams.get("shape") === "poster" &&
        u.searchParams.get("rs") === "pill" &&
        u.searchParams.get("bq") === "1",
    )
    expect(p.get("shape")).toBe("poster")
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()
    expect(p.get("bq")).toBe("1")

    // Target switch never writes: the saved state above is still the backend.
    d = await getDefaults(page)
    expect(d.posterShape).toBe("poster")
    expect((d.landscape ?? {}) as Record<string, unknown>).toMatchObject({
      rankingBadgeStyle: "number",
      extraBadgeStyle: "corner",
      badgeQuality: false,
    })

    // Resolved-style proof AFTER: same own-rank resolution as BEFORE (the
    // landscape Angolo/corner profile never leaks into the portrait render;
    // the legacy NULL still omits xbs with no boundary, and a concrete pill
    // flat still inherits unchanged).
    const afterUrl = findLastUrl(seen.urls, 0, isDefaultsPreviewUrl, (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("xbs") === null)
    expect(afterUrl).not.toBeNull()
    const afterDebugUrl = new URL(afterUrl!.toString())
    afterDebugUrl.searchParams.set("debug", "1")
    const afterDebugRes = await request.get(afterDebugUrl.toString())
    expect(afterDebugRes.ok()).toBeTruthy()
    const afterDebug = (await afterDebugRes.json()) as {
      badge: { settings: { rankingBadgeStyle: unknown }; computed: { badge: unknown } }
    }
    expect(afterDebug.badge.settings.rankingBadgeStyle).toBe(beforeRs)
    expect(JSON.stringify(afterDebug.badge.computed.badge)).toBe(beforeBadge)

    // Reload: backend profile persists. Reopen lands on Preset first; the
    // shared target then replays the saved landscape profile, and each home
    // tab shows its saved local style.
    await page.reload()
    const seen2: Seen = { urls: [] }
    collectRequests(page, seen2)
    await page.getByRole("button", { name: /Impostazioni/i }).click()
    const dialog2 = page.getByRole("dialog")
    await expect(dialog2).toBeVisible()
    await expect(dialog2.getByRole("tab", { name: "Preset", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    d = await getDefaults(page)
    expect(d.posterShape).toBe("poster")
    const land = (d.landscape ?? {}) as Record<string, unknown>
    expect(land.rankingBadgeStyle).toBe("number")
    expect(land.extraBadgeStyle).toBe("corner")
    expect(land.badgeQuality).toBe(false)
    const formatTarget2 = dialog2.getByTestId("format-target-selector")
    // Full saved-tuple pred: only the persisted profile replays all four.
    p = await nextPreview(
      seen2,
      async () => {
        await formatTarget2.getByText("Orizzontale", { exact: true }).click()
      },
      (u) =>
        u.searchParams.get("shape") === "landscape" &&
        u.searchParams.get("rs") === "number" &&
        u.searchParams.get("xbs") === "corner" &&
        u.searchParams.get("bq") === "0",
    )
    expect(p.get("rs")).toBe("number")
    expect(p.get("xbs")).toBe("corner")
    expect(p.get("bq")).toBe("0")
    await gotoTab(dialog2, "Classifiche")
    await expect(
      dialog2.getByTestId("ranking-presentation").getByRole("radio", { name: "Numero" }),
    ).toHaveAttribute("aria-checked", "true")
    await gotoTab(dialog2, "Badge")
    await expect(
      dialog2.getByTestId("badge-extra-style-wrap").filter({ visible: true }).getByRole("button", { name: "Angolo" }),
    ).toBeVisible()
    await gotoTab(dialog2, "Informazioni")
    await expect(
      dialog2
        .getByRole("switch", { name: "Qualità streaming" })
        .filter({ visible: true }),
    ).toHaveAttribute("aria-checked", "false")
  })

  test("mobile: Orizzontale Numero keeps portrait, Verticale restores flats", async ({ page }) => {
    await seed(page, `${DEMO_PROFILE}-mobile`)
    await page.setViewportSize({ width: 390, height: 844 })
    await putDefaults(page, SEED_PAYLOAD)
    const seen: Seen = { urls: [] }
    collectRequests(page, seen)

    // Stessa race del test desktop (vedi sopra): capture-window prima
    // dell'apertura + pred sullo stato assestato (rs==pill).
    // (Locator lazy dichiarato prima dell'action per evitare TDZ.)
    const panel = page.locator(".settings-panel:visible").first()
    let p = await nextPreview(
      seen,
      async () => {
        await page.getByRole("button", { name: /Impostazioni/i }).click()
        await expect(panel).toBeVisible()
      },
      (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("rs") === "pill" && u.searchParams.get("bq") === "1",
    )
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()

    await expect(panel).toBeVisible()
    // Mobile nav is the responsive select (five primary options plus the
    // secondary optgroup); the dialog opens on Preset, never on Badge.
    const category = panel.locator("#mobile-settings-category")
    await expect(category).toBeVisible()
    expect(await category.inputValue()).toBe("preset")
    // Rank home is Classifiche (same unified rs contract as desktop).
    await category.selectOption("rankings")
    const presentation = panel.getByTestId("ranking-presentation")
    await expect(presentation).toBeVisible()

    // Staged baseline: nothing persists until the footer Save.
    const baseline = await getDefaults(page)
    expect(baseline.posterShape).toBe("poster")
    expect(baseline.rankingBadgeStyle).toBe("pill")

    const formatTarget = panel.getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()
    // Settled-state pred (same staged-hydration race as desktop).
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Orizzontale", { exact: true }).click()
      },
      (u) =>
        u.searchParams.get("shape") === "landscape" &&
        u.searchParams.get("rs") === "pill" &&
        u.searchParams.get("bq") === "1",
    )
    expect(p.get("shape")).toBe("landscape")

    // Target switch never writes: backend still the staged baseline.
    let mNow = await getDefaults(page)
    expect(mNow).toMatchObject({ posterShape: "poster", rankingBadgeStyle: "pill" })

    // Numero in Classifiche (Nastro/Numero/Badge/Fresh/Card over rs).
    const numero = presentation.getByRole("radio", { name: "Numero" })
    p = await nextPreview(
      seen,
      async () => {
        await numero.click()
      },
      (u) =>
        u.searchParams.get("shape") === "landscape" &&
        u.searchParams.get("rs") === "number" &&
        u.searchParams.get("bq") === "1",
    )
    expect(p.get("shape")).toBe("landscape")
    await expect(numero).toHaveAttribute("aria-checked", "true")

    // Draft truth: preview moved, backend still baseline until Save.
    mNow = await getDefaults(page)
    expect(mNow).toMatchObject({ posterShape: "poster", rankingBadgeStyle: "pill" })

    // Explicit Save persists the landscape Numero; portrait + delivery stay.
    await explicitSave(page, panel)
    await waitDefaults(page, (d) => {
      const land = (d.landscape ?? {}) as Record<string, unknown>
      return land.rankingBadgeStyle === "number"
    })

    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Verticale", { exact: true }).click()
      },
      (u) =>
        u.searchParams.get("shape") === "poster" &&
        u.searchParams.get("rs") === "pill" &&
        u.searchParams.get("bq") === "1",
    )
    expect(p.get("shape")).toBe("poster")
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()

    const d = await getDefaults(page)
    expect(d.posterShape).toBe("poster")
    expect(d.rankingBadgeStyle).toBe("pill")
  })
})

test.describe("Per-title appearance + extra (no side, no ribbon duplicate)", () => {
  test("desktop: Numero + Angolo preview rs/xbs, single ribbon param, no side control", async ({
    page,
  }) => {
    await seed(page, `${DEMO_PROFILE}-pertitle`, "mock-tmdb-key-0000000000")
    await page.setViewportSize({ width: 1280, height: 900 })
    await putDefaults(page, {
      posterShape: "poster",
      rankingBadgeStyle: "default",
      ribbonEnabled: true,
      extraBadgeStyle: null,
    })
    const seen: Seen = { urls: [] }
    collectRequests(page, seen)

    const search = page.getByPlaceholder(/cerca/i)
    await expect(search).toBeVisible({ timeout: 30_000 })
    await search.fill("avatar")
    await search.press("Enter")
    await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
    await page.getByText(/Avatar/i).first().click()
    await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 10_000 })

    const badgeTab = page.getByRole("tab", { name: "Badge", exact: true })
    await badgeTab.click()
    await expect(badgeTab).toHaveAttribute("aria-selected", "true")

    // Editor scope: everything below the Anteprima heading, outside any dialog.
    const editor = page.locator("main").first()
    const rankGroup = editor.getByRole("radiogroup", { name: "Classifica" })
    await expect(rankGroup).toBeVisible()
    await rankGroup.getByRole("radio", { name: "Numero" }).click()
    // The live draft must hold: fail fast if the click did not stick (G4
    // trace showed Nastro still checked at timeout with no rs=number URL
    // ever emitted, while Angolo applied onto rs=default).
    await expect(rankGroup.getByRole("radio", { name: "Numero" })).toBeChecked()

    // Side is defaults-only: no Posizione control per-title (not persistible).
    await expect(editor.getByRole("radiogroup", { name: "Posizione" })).toHaveCount(0)

    const extraCard = editor
      .getByText("Stile badge extra", { exact: true })
      .locator("xpath=..")
    // The Angolo click runs INSIDE nextPreview: n is captured before the
    // action, so the combined rs=number/xbs=corner emission cannot slip
    // through the observation window (G4 called nextPreview with an empty
    // action after both clicks, missing an already-emitted URL forever).
    const p = await nextPreview(
      seen,
      async () => {
        await extraCard.getByRole("button", { name: "Angolo" }).click()
      },
      (u) => u.searchParams.get("rs") === "number" && u.searchParams.get("xbs") === "corner",
      (u) => u.searchParams.get("demosamples") !== "1",
    )
    // Draft must survive both clicks through the settled preview.
    await expect(rankGroup.getByRole("radio", { name: "Numero" })).toBeChecked()
    expect(p.get("rs")).toBe("number")
    expect(p.get("xbs")).toBe("corner")
    // Single ribbon switch, never duplicated (one param, numeral has no ribbon).
    expect(p.getAll("ribbon")).toEqual(["1"])
  })
})

const POSTER_PATH = "/mocked/avatar.jpg"

function apiPoster(
  params: Record<string, string>,
  mediaType = "movie",
  id: number | string = 19995,
): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/${mediaType}/${id}?${qs.toString()}`
}

test.describe("poster API — rs number / xbs corner semantics", () => {
  test("ranked rs=number + xbs=corner stays numeral (xbs touches only extra)", async ({
    request,
  }) => {
    // Avatar is #1 in the mock JW chart: trendRank wins over the query rank.
    const base = {
      genreName: "Action",
      voteAverage: "7.8",
      badges: "1",
      ranking: "1",
      rank: "3",
      label: "Top 3",
    }
    const numeral = await request.get(apiPoster({ ...base, rs: "number", xbs: "corner" }))
    expect(numeral.ok()).toBeTruthy()
    const numeralBuf = await numeral.body()
    expect(numeralBuf.length).toBeGreaterThan(1000)
    // No extra badge => xbs changes nothing on the rank numeral.
    const plain = await request.get(apiPoster({ ...base, rs: "number" }))
    expect(plain.ok()).toBeTruthy()
    expect(Buffer.compare(numeralBuf, await plain.body())).toBe(0)
    // Numeral is not the corner pill.
    const corner = await request.get(apiPoster({ ...base, rs: "corner" }))
    expect(corner.ok()).toBeTruthy()
    expect(Buffer.compare(numeralBuf, await corner.body())).not.toBe(0)
  })

  test("UNRANKED + forced extra: xbs drives, rs=number ignored (legacy maps to corner)", async ({
    request,
  }) => {
    // Matrix (603) is off-chart and no rank/label is passed: unranked, so the
    // forced extra is the only top badge and rs=number must not leak into it.
    const base = {
      genreName: "Action",
      voteAverage: "7.8",
      badges: "1",
      ranking: "1",
      extra: "Nuova stagione S2",
      rs: "number",
    }
    const pill = await request.get(apiPoster({ ...base, xbs: "pill" }, "movie", 603))
    expect(pill.ok()).toBeTruthy()
    const pillBuf = await pill.body()
    expect(pillBuf.length).toBeGreaterThan(1000)
    const standard = await request.get(apiPoster({ ...base, xbs: "standard" }, "movie", 603))
    expect(standard.ok()).toBeTruthy()
    expect(Buffer.compare(pillBuf, await standard.body())).not.toBe(0)
    // Legacy (no xbs): rs=number degrades to the corner pill for extras.
    const legacy = await request.get(apiPoster({ ...base }, "movie", 603))
    expect(legacy.ok()).toBeTruthy()
    const legacyBuf = await legacy.body()
    const corner = await request.get(apiPoster({ ...base, xbs: "corner" }, "movie", 603))
    expect(corner.ok()).toBeTruthy()
    expect(Buffer.compare(legacyBuf, await corner.body())).toBe(0)
    // rs is ignored for the extra once xbs is explicit.
    const cornerRsCorner = await request.get(
      apiPoster({ ...base, rs: "corner", xbs: "pill" }, "movie", 603),
    )
    expect(cornerRsCorner.ok()).toBeTruthy()
    expect(Buffer.compare(pillBuf, await cornerRsCorner.body())).toBe(0)
  })

  test("UNRANKED with no info renders no empty decoration", async ({ request }) => {
    // Matrix off-chart, no rank/label/extra; genre+year+rating segments off:
    // nothing to decorate with, so output equals badges disabled entirely.
    const bare = {
      genreName: "Action",
      voteAverage: "7.8",
      badges: "1",
      ranking: "1",
      bg: "0",
      by: "0",
      br: "0",
    }
    const res = await request.get(apiPoster(bare, "movie", 603))
    expect(res.ok()).toBeTruthy()
    const buf = await res.body()
    expect(buf.length).toBeGreaterThan(1000)
    const off = await request.get(
      apiPoster({ ...bare, badges: "0", ranking: "0" }, "movie", 603),
    )
    expect(off.ok()).toBeTruthy()
    expect(Buffer.compare(buf, await off.body())).toBe(0)
  })
})

test.describe("Per-title late load preserves user drafts (deferred title data)", () => {
  /**
   * Holds the title-load XHRs (details + images: the causal inputs of
   * loadCurrentItemData) so the post-load continuation lands deterministically
   * AFTER the user edit instead of racing it. Search, rank, awards and poster
   * PNG traffic flow untouched. Release is idempotent and belongs in a
   * finally: a failed assertion must never leave the page hanging.
   */
  async function installTitleDataGate(page: Page) {
    const held: Route[] = []
    let released = false
    const hold = async (route: Route) => {
      if (released) await route.continue()
      else held.push(route)
    }
    await page.route("**/api/tmdb/*/details*", hold)
    await page.route("**/api/tmdb/*/images*", hold)
    return {
      heldUrls: () => held.map((r) => r.request().url()),
      release: async () => {
        released = true
        await Promise.all(held.splice(0).map((r) => r.continue()))
      },
    }
  }

  async function openAvatar(page: Page, profile: string, seen: Seen) {
    await seed(page, profile, "mock-tmdb-key-0000000000")
    await page.setViewportSize({ width: 1280, height: 900 })
    await putDefaults(page, {
      posterShape: "poster",
      rankingBadgeStyle: "default",
      ribbonEnabled: true,
      extraBadgeStyle: null,
    })
    collectRequests(page, seen)
    const search = page.getByPlaceholder(/cerca/i)
    await expect(search).toBeVisible({ timeout: 30_000 })
    await search.fill("avatar")
    await search.press("Enter")
    await expect(page.getByText(/Avatar/i).first()).toBeVisible({ timeout: 20_000 })
  }

  /**
   * Gate reached: the title OPEN fired its own details request (carries rsrc,
   * unlike the hover prefetch on the same endpoints) and its images request,
   * and both are held. Heading visible alone is not enough: the open is sync
   * but the XHRs may still be queued behind it.
   */
  async function awaitGate(page: Page, gate: { heldUrls: () => string[] }) {
    await expect(page.getByRole("heading", { name: "Anteprima" })).toBeVisible({ timeout: 10_000 })
    await expect
      .poll(
        () => {
          const urls = gate.heldUrls()
          const openDetails = urls.some((u) => u.includes("/details") && u.includes("rsrc="))
          const images = urls.some((u) => u.includes("/images"))
          return openDetails && images ? "held" : null
        },
        { timeout: 15_000 },
      )
      .toBe("held")
  }

  /**
   * Load-completion signal: artwork published by the post-load continuation
   * (the loaded poster tile appears as the poster param of a fresh preview
   * URL). Rank/awards arrivals cannot produce this param, so waiting for it
   * proves the continuation itself landed — including any clobber on the
   * unfixed code — before the next user edit.
   */
  async function awaitLoadedArtwork(seen: Seen, from: number) {
    let out: URLSearchParams | null = null
    await expect
      .poll(
        () => {
          out = findLastParams(
            seen.urls,
            from,
            (u) => u.searchParams.get("demosamples") !== "1",
            (u) => u.searchParams.get("poster") === POSTER_PATH,
          )
          return out ? "ok" : null
        },
        { timeout: 30_000 },
      )
      .toBe("ok")
    return out as unknown as URLSearchParams
  }

  test("deferred load: Numero draft survives the late continuation, Angolo lands on rs=number", async ({
    page,
  }) => {
    const seen: Seen = { urls: [] }
    await openAvatar(page, `${DEMO_PROFILE}-pertitle-lateload`, seen)
    const gate = await installTitleDataGate(page)
    try {
      await page.getByText(/Avatar/i).first().click()
      await awaitGate(page, gate)

      const badgeTab = page.getByRole("tab", { name: "Badge", exact: true })
      await badgeTab.click()
      await expect(badgeTab).toHaveAttribute("aria-selected", "true")
      const editor = page.locator("main").first()
      const rankGroup = editor.getByRole("radiogroup", { name: "Classifica" })
      await expect(rankGroup).toBeVisible()
      // Side stays defaults-only while loading too: no Posizione per-title.
      await expect(editor.getByRole("radiogroup", { name: "Posizione" })).toHaveCount(0)
      // The user edits WHILE the load is still in flight: controls stay
      // enabled, input never waits for readiness.
      await rankGroup.getByRole("radio", { name: "Numero" }).click()
      await expect(rankGroup.getByRole("radio", { name: "Numero" })).toBeChecked()

      // Release AFTER the Numero click: the late continuation must preserve it.
      const from = seen.urls.length
      await gate.release()
      const loaded = await awaitLoadedArtwork(seen, from)
      expect(loaded.get("poster")).toBe(POSTER_PATH)

      const extraCard = editor
        .getByText("Stile badge extra", { exact: true })
        .locator("xpath=..")
      const p = await nextPreview(
        seen,
        async () => {
          await extraCard.getByRole("button", { name: "Angolo" }).click()
        },
        (u) => u.searchParams.get("xbs") === "corner",
        (u) => u.searchParams.get("demosamples") !== "1",
      )
      // Semantic assertions: on the unfixed code the late wipe reset the rank
      // to the stored default, so rs reads "default" here — a value failure,
      // never a timeout.
      expect(p.get("rs")).toBe("number")
      expect(p.get("xbs")).toBe("corner")
      expect(p.getAll("ribbon")).toEqual(["1"])
      await expect(rankGroup.getByRole("radio", { name: "Numero" })).toBeChecked()
    } finally {
      await gate.release()
    }
  })

  test("early release: normal init still lands Numero + Angolo", async ({ page }) => {
    const seen: Seen = { urls: [] }
    await openAvatar(page, `${DEMO_PROFILE}-pertitle-earlyrelease`, seen)
    const gate = await installTitleDataGate(page)
    try {
      await page.getByText(/Avatar/i).first().click()
      await awaitGate(page, gate)

      // Release BEFORE any edit and wait for the load to settle: pure normal
      // init through the same gating machinery (proves the gate itself is
      // neutral when no edit races the load).
      const from = seen.urls.length
      await gate.release()
      const loaded = await awaitLoadedArtwork(seen, from)
      expect(loaded.get("poster")).toBe(POSTER_PATH)

      const badgeTab = page.getByRole("tab", { name: "Badge", exact: true })
      await badgeTab.click()
      await expect(badgeTab).toHaveAttribute("aria-selected", "true")
      const editor = page.locator("main").first()
      const rankGroup = editor.getByRole("radiogroup", { name: "Classifica" })
      await expect(rankGroup).toBeVisible()
      await expect(editor.getByRole("radiogroup", { name: "Posizione" })).toHaveCount(0)
      await rankGroup.getByRole("radio", { name: "Numero" }).click()
      await expect(rankGroup.getByRole("radio", { name: "Numero" })).toBeChecked()

      const extraCard = editor
        .getByText("Stile badge extra", { exact: true })
        .locator("xpath=..")
      const p = await nextPreview(
        seen,
        async () => {
          await extraCard.getByRole("button", { name: "Angolo" }).click()
        },
        (u) => u.searchParams.get("rs") === "number" && u.searchParams.get("xbs") === "corner",
        (u) => u.searchParams.get("demosamples") !== "1",
      )
      await expect(rankGroup.getByRole("radio", { name: "Numero" })).toBeChecked()
      expect(p.get("rs")).toBe("number")
      expect(p.get("xbs")).toBe("corner")
      expect(p.getAll("ribbon")).toEqual(["1"])
    } finally {
      await gate.release()
    }
  })
})
