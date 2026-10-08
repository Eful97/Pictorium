import { test, expect, type Page } from "@playwright/test"
import { putDefaultsWithRetry } from "./defaults-retry"

// T6 badge-format-final: Badge tab per-format editing (Verticale/Orizzontale),
// rank Numero + extra Angolo + quality toggle isolation, per-title rules, and
// rs/xbs API semantics. Transport-level only (preview query params + backend
// defaults JSON + poster bytes): no snapshots here — pixel baselines live in
// pictorium-visual.spec.ts. External APIs come from the mock server.

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
  // Settle trailing debounced UI autosaves (500ms debounce in useDefaults)
  // so they land BEFORE the restore PUT, never after it.
  await page.waitForTimeout(1200)
  await page.goto("/")
  await putDefaultsWithRetry(page, "restore defaults", FACTORY_RESTORE)
  // Verify the full canonical surface — a mismatch is a real leak
  // (merge-only PUT cannot delete keys, so every autosaved key must be
  // covered above with its factory value).
  const got = await getDefaults(page)
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
  },
}

test.describe("Badge Verticale/Orizzontale: isolation + persistence", () => {
  test("desktop: landscape edits Numero/Angolo/quality-off keep portrait + delivery, survive tab switch + reload", async ({
    page,
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
      (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("rs") === "pill",
    )
    expect(p.get("shape")).toBe("poster")
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()
    expect(p.get("bq")).toBe("1")
    expect(p.get("qbs")).toBe("standard")

    await expect(dialog).toBeVisible()
    const badgePanel = dialog.getByRole("tabpanel", { name: "Badge" })
    await expect(badgePanel).toBeVisible()

    // Format selector sits BEFORE the controls (single edit target, shared
    // with Trasforma): geometry proof, not just visibility. Measured BEFORE
    // expanding the macro-groups below: their clicks scroll the dialog and
    // would invalidate viewport-relative boxes.
    const formatTarget = dialog.getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()
    const selBox = await formatTarget.boundingBox()
    const panelBox = await badgePanel.boundingBox()
    expect(selBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    expect(selBox!.y + selBox!.height).toBeLessThanOrEqual(panelBox!.y + 8)

    // T3 macro-groups: Overlay/Quality start collapsed; expand for rank/quality edits.
    await badgePanel.getByTestId("badge-group-overlay-toggle").click()
    await badgePanel.getByTestId("badge-group-quality-toggle").click()

    // Orizzontale: same values (profile inherits flats), landscape shape.
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Orizzontale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "landscape",
    )
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()

    // Landscape edit 1: rank appearance Numero -> rs=number (profile only).
    const rankGroup = badgePanel.getByRole("radiogroup", { name: "Classifica" })
    await expect(rankGroup).toBeVisible()
    p = await nextPreview(
      seen,
      async () => {
        await rankGroup.getByRole("radio", { name: "Numero" }).click()
      },
      (u) => u.searchParams.get("rs") === "number",
    )
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("rs")).toBe("number")

    // Landscape edit 2: info extra Angolo -> xbs=corner (profile only).
    const extraCard = badgePanel
      .getByText("Stile badge extra", { exact: true })
      .locator("xpath=..")
    p = await nextPreview(
      seen,
      async () => {
        await extraCard.getByRole("button", { name: "Angolo" }).click()
      },
      (u) => u.searchParams.get("xbs") === "corner",
    )
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("rs")).toBe("number")
    expect(p.get("xbs")).toBe("corner")

    // Landscape edit 3: quality toggle off -> bq=0 (profile only).
    p = await nextPreview(
      seen,
      async () => {
        await badgePanel.getByRole("switch", { name: "Qualità streaming" }).click()
      },
      (u) => u.searchParams.get("bq") === "0",
    )
    expect(p.get("shape")).toBe("landscape")

    // Side row (Sinistra/Destra) lives in defaults with Numero active.
    await expect(badgePanel.getByRole("radiogroup", { name: "Posizione" })).toBeVisible()

    // Backend truth: portrait flats + delivery untouched, landscape holds edits.
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

    // Back to Badge: same landscape URL is already loaded, so no refetch is
    // expected — assert the retained target + values in UI and the last
    // preview transport instead of waiting for a new request.
    await dialog.getByRole("tab", { name: "Badge", exact: true }).click()
    const badgeBack = dialog.getByRole("tabpanel", { name: "Badge" })
    await expect(badgeBack).toBeVisible()
    await expect(formatTarget.getByText("Orizzontale", { exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await expect(
      badgeBack.getByRole("radiogroup", { name: "Classifica" }).getByRole("radio", {
        name: "Numero",
      }),
    ).toHaveAttribute("aria-checked", "true")
    const lastLand = findLastParams(seen.urls, 0, isDefaultsPreviewUrl, (u) => u.searchParams.get("shape") === "landscape")
    expect(lastLand).not.toBeNull()
    expect(lastLand!.get("rs")).toBe("number")
    expect(lastLand!.get("xbs")).toBe("corner")
    expect(lastLand!.get("bq")).toBe("0")

    // Back to portrait: original values, no landscape leak.
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Verticale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "poster",
    )
    expect(p.get("shape")).toBe("poster")
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()
    expect(p.get("bq")).toBe("1")

    // Reload: backend profile persists; Orizzontale replays it.
    await page.reload()
    const seen2: Seen = { urls: [] }
    collectRequests(page, seen2)
    await page.getByRole("button", { name: /Impostazioni/i }).click()
    const dialog2 = page.getByRole("dialog")
    await expect(dialog2).toBeVisible()
    await dialog2.getByRole("tab", { name: "Badge", exact: true }).click()
    await expect(dialog2.getByRole("tabpanel", { name: "Badge" })).toBeVisible()
    d = await getDefaults(page)
    expect(d.posterShape).toBe("poster")
    const land = (d.landscape ?? {}) as Record<string, unknown>
    expect(land.rankingBadgeStyle).toBe("number")
    expect(land.extraBadgeStyle).toBe("corner")
    expect(land.badgeQuality).toBe(false)
    const formatTarget2 = dialog2.getByTestId("format-target-selector")
    p = await nextPreview(
      seen2,
      async () => {
        await formatTarget2.getByText("Orizzontale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "landscape",
    )
    expect(p.get("rs")).toBe("number")
    expect(p.get("xbs")).toBe("corner")
    expect(p.get("bq")).toBe("0")
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
      (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("rs") === "pill",
    )
    expect(p.get("rs")).toBe("pill")
    expect(p.get("xbs")).toBeNull()

    await expect(panel).toBeVisible()
    // Mobile nav is a select; Badge is the entry tab.
    const category = page.locator("select:visible").first()
    if (await category.count()) {
      await category.selectOption("badge").catch(() => {})
    }

    const formatTarget = panel.getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Orizzontale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "landscape",
    )
    expect(p.get("shape")).toBe("landscape")

    const rankGroup = panel.getByRole("radiogroup", { name: "Classifica" })
    // T3 macro-groups: Overlay starts collapsed; expand for rank edits.
    await panel.getByTestId("badge-group-overlay-toggle").click()
    p = await nextPreview(
      seen,
      async () => {
        await rankGroup.getByRole("radio", { name: "Numero" }).click()
      },
      (u) => u.searchParams.get("rs") === "number",
    )
    expect(p.get("shape")).toBe("landscape")

    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Verticale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "poster",
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

    const badgeTab = page.getByRole("tab", { name: "Badge" })
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
