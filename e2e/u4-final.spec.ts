import { test, expect, type Page } from "@playwright/test"
import { putDefaultsWithRetry, withDefaultsRetry } from "./defaults-retry"
import sharp from "sharp"
import { cornerAnchoredLeft } from "../src/lib/poster-service"
import { NUMBER_BADGE_BASE_OFFSET_X } from "../src/lib/badge-styles"
import { buildRankingNumberSvg } from "../src/lib/badge-svg-shared"
import { snapshotMissingLandscape, SHAPE_FLAT_TO_LANDSCAPE } from "../src/lib/visual-presets"

// U4 final verification (U1/U2/U3, no new product behavior):
// - U1 Nastro Standard/Colorato: default + per-title send rs netflix/colored
//   with ribbon=1; server PNGs differ under the same accent; portrait/land
//   targets stay isolated and delivery (posterShape) never moves.
// - U2 contextual preview: Info focus yields a server-resolved EXTRA sample
//   (debug label, never the raw __badge key) with the saved xbs; rank family
//   narrows with no simultaneous extra; hover changes nothing; Auto restores
//   the effective saved sash and drops the forced extra; chip names the
//   selected format + family; disabled categories emit no sample.
// - U3 Number baseline: API mirror/tox semantics + the -20 default slider
//   mapping (edit stores the adjustment, other styles read raw).
// Transport-level only (preview query params + backend defaults JSON +
// poster bytes/debug JSON): pixel baselines live in pictorium-visual.spec.ts.
// External APIs come from the mock server.

const DEMO_PROFILE = "e2e-u4-final"

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
  // Dialog stream only (resourceType xhr): the settings dialog also mounts
  // the preset-gallery thumbnails (plain <img> on the same preview path —
  // 7 image rows per open in-trace). URL-only matching mixes the streams;
  // the dialog XHR blob is the arranged-state owner.
  page.on("request", (req) => {
    if (req.resourceType() !== "xhr") return
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

/**
 * Baseline gate over the WHOLE recorded stream (from 0, latest match wins).
 * The dialog preview fires once at open and never refetches without an edit
 * (staged session, no autosave): a from-now poll with a noop action waits for
 * a request that will never come (proven 30s timeout on an already-correct
 * arranged rs=pill XHR). This asserts the arranged state that already fired —
 * use only BEFORE any edit (after edits stale rows would win; nextPreview
 * from-n is the post-edit gate).
 */
async function waitPreview(
  seen: Seen,
  pred: (u: URL) => boolean = () => true,
  match: (u: URL) => boolean = (u) => u.searchParams.get("demosamples") === "1",
) {
  let out: URLSearchParams | null = null
  await expect
    .poll(
      () => {
        out = findLastParams(seen.urls, 0, match, pred)
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
  // Teardown/settle GETs share the `defaults` rate-limit bucket with PUTs:
  // under serial-sweep load a 429 here is runtime-expected, not an app bug.
  // Retry bounded with the server Retry-After (same rule as the PUT helper);
  // any other status — or an exhausted budget — still throws, never a
  // silent pass, so the restore verification below stays strict.
  const attempt = await withDefaultsRetry(
    () =>
      page.evaluate(async () => {
        const r = await fetch("/api/defaults")
        return {
          ok: r.ok,
          status: r.status,
          body: await r.text(),
          retryAfter: r.headers.get("Retry-After"),
        }
      }),
    { label: "get defaults" },
  )
  return JSON.parse(attempt.body) as Record<string, unknown>
}

/**
 * Single-instance defaults namespace (MULTI_USER is off in E2E: no ?user=
 * scoping, the seeded profile id never reaches the API). PUT shallow-merges
 * the root and deep-merges `landscape` per key, with a strict shape-
 * independence backfill: a flat edit without matching profile keys freezes
 * the pre-merge effective flat values into the profile. Restore therefore
 * re-PUTs the sparse RESET surface below AND asserts the exact server merge
 * (never a weakened subset match): the expected landscape is derived from
 * the pre-restore stored profile + the backfill snapshot + the RESET patch.
 * Settle is debounce-aware (poll for stability, no fixed sleeps); the editor
 * is unmounted via navigation so pending timers are cleared, never firing
 * after the restore PUT. No pollution outside this surface.
 */
test.afterEach(async ({ page }) => {
  if (!defaultsDirty) return
  defaultsDirty = false
  // Settle trailing debounced UI autosaves BEFORE the restore PUT: poll the
  // server state until two consecutive reads are identical (600ms apart), so
  // a pending 500ms-debounce flush lands before we overwrite it. Bounded and
  // effect-observed — never an arbitrary fixed sleep.
  let pre: Record<string, unknown> | null = null
  try {
    let prev = JSON.stringify(await getDefaults(page))
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(600)
      const cur = JSON.stringify(await getDefaults(page))
      if (cur === prev) break
      prev = cur
    }
    pre = JSON.parse(prev) as Record<string, unknown>
  } catch {
    pre = null
  }
  await page.goto("/")
  if (!pre) pre = await getDefaults(page)
  const preLand = ((pre.landscape ?? {}) as Record<string, unknown>) ?? {}
  // Model the precise server merge for the RESET PUT below (mirrors
  // backfillLandscapeOnFlatEdit in the defaults route, reusing the shared
  // snapshot helper — no forked math): only keys present in the RESET body
  // AND missing in stored+patch freeze the pre-merge effective flats.
  const resetRec = RESET_PAYLOAD as unknown as Record<string, unknown>
  const resetLandPatch = ((resetRec.landscape ?? {}) as Record<string, unknown>) ?? {}
  const presence = { ...preLand, ...resetLandPatch }
  const flatsRecord: Record<string, unknown> = {}
  const changedFlatKeys: string[] = []
  for (const [flatKey] of Object.entries(SHAPE_FLAT_TO_LANDSCAPE)) {
    const bareKey = flatKey.charAt(7).toLowerCase() + flatKey.slice(8)
    flatsRecord[flatKey] = (pre as Record<string, unknown>)[bareKey]
    if (bareKey in resetRec) changedFlatKeys.push(flatKey)
  }
  const adds = snapshotMissingLandscape(flatsRecord, presence, changedFlatKeys) as Record<string, unknown>
  const expectedLandscape = { ...preLand, ...adds, ...resetLandPatch }
  await putDefaultsWithRetry(page, "restore defaults", RESET_PAYLOAD)
  // Unmount the editor (navigation clears the debounce timer + aborts
  // inflight sends, so nothing fires after the restore).
  await page.goto("/")
  const got = await getDefaults(page)
  // Managed flats reset exactly.
  expect(got.posterShape).toBe(RESET_PAYLOAD.posterShape)
  expect(got.rankingBadgeStyle).toBe(RESET_PAYLOAD.rankingBadgeStyle)
  expect(got.ribbonEnabled).toBe(RESET_PAYLOAD.ribbonEnabled)
  expect(got.ribbonSide).toBe(RESET_PAYLOAD.ribbonSide)
  expect(got.extraBadgeStyle).toBe(RESET_PAYLOAD.extraBadgeStyle)
  expect(got.topBadgeOffsetX).toBe(RESET_PAYLOAD.topBadgeOffsetX)
  expect(got.sashOrder).toEqual(RESET_PAYLOAD.sashOrder)
  // Exact deep equality on the profile: the full expected server merge, no
  // arbitrary later keys, extraneous pre-existing profile keys preserved.
  expect(got.landscape).toEqual(expectedLandscape)
  expect(Object.keys(((got.landscape ?? {}) as Record<string, unknown>)).sort()).toEqual(
    Object.keys(expectedLandscape).sort(),
  )
})

async function saveStaged(page: Page) {
  // Staged-session era: UI edits never PUT by themselves. The single global
  // Save persists the draft; the synced status proves the server flush that
  // waitDefaults polls for below.
  await page.getByTestId("settings-save").click()
  await expect(page.getByTestId("settings-save-status")).toContainText(/Sincronizzato/i, {
    timeout: 15_000,
  })
}

async function waitDefaults(page: Page, pred: (d: Record<string, unknown>) => boolean) {
  // 500ms poll interval: the condition follows the explicit Save PUT above,
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

/** Full mutation surface of this spec (root + wholesale landscape). */
const RESET_PAYLOAD = {
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
  topBadgeOffsetX: 0,
  sashOrder: ["upcoming", "rank", "new", "award", "extra"],
  landscape: {
    rankingBadgeStyle: "pill",
    ribbonEnabled: true,
  },
}

const POSTER_PATH = "/mocked/avatar.jpg"

function apiPoster(
  params: Record<string, string>,
  mediaType = "movie",
  id: number | string = 19995,
): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/${mediaType}/${id}?${qs.toString()}`
}

test.describe("U4 U1 ribbon Standard/Colorato (defaults)", () => {
  test("desktop: Nastro Colore sends rs=colored ribbon=1, bytes differ, land isolated, delivery steady", async ({
    page,
    request,
  }) => {
    await seed(page, `${DEMO_PROFILE}-ribbon`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await putDefaults(page, RESET_PAYLOAD)
    const seen: Seen = { urls: [] }
    collectRequests(page, seen)

    await page.getByRole("button", { name: /Impostazioni/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    // Default tab is Preset: the rank appearance lives on Classifiche.
    await dialog.getByRole("tab", { name: "Classifiche", exact: true }).click()
    const badgePanel = dialog.getByRole("tabpanel", { name: "Badge", exact: true })
    await expect(badgePanel).toBeVisible()

    const formatTarget = dialog.getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()

    // Portrait baseline: pill + ribbon on. The predicate includes rs=pill:
    // on a fresh page the first preview can fire pre-hydration with factory
    // rs=default under load; the settled URL must carry the RESET pill.
    // From-0 gate (not from-now): the open burst already fired exactly once
    // and never refetches without an edit — a noop from-now poll would wait
    // 30s for a request that never comes.
    let p = await waitPreview(seen, (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("rs") === "pill")
    expect(p.get("ribbon")).toBe("1")

    // Side row is defaults-only and visible with a ribbon appearance ahead
    // (macro-groups are always open in settings: no disclosure toggle).
    const rankGroup = badgePanel.getByRole("radiogroup", { name: "Classifica" })
    await expect(rankGroup).toBeVisible()

    // Nastro Standard: rs=netflix + ribbon=1.
    p = await nextPreview(
      seen,
      async () => {
        await rankGroup.getByRole("radio", { name: "Nastro" }).click()
      },
      (u) => u.searchParams.get("rs") === "netflix",
    )
    expect(p.get("shape")).toBe("poster")
    expect(p.get("ribbon")).toBe("1")

    // Nastro Colorato: rs=colored + ribbon=1 (same ribbon switch, new color).
    const ribbonGroup = badgePanel.getByRole("radiogroup", { name: "Nastro" })
    p = await nextPreview(
      seen,
      async () => {
        await ribbonGroup.getByRole("radio", { name: "Colore" }).click()
      },
      (u) => u.searchParams.get("rs") === "colored",
    )
    expect(p.get("shape")).toBe("poster")
    expect(p.get("ribbon")).toBe("1")
    await expect(badgePanel.getByRole("radiogroup", { name: "Posizione" })).toBeVisible()

    // Backend truth: flats hold Colore, landscape profile untouched.
    await saveStaged(page)
    await waitDefaults(page, (d) => d.rankingBadgeStyle === "colored")
    const d = await getDefaults(page)
    expect(d.posterShape).toBe("poster")
    expect(d.ribbonEnabled).toBe(true)
    const land = (d.landscape ?? {}) as Record<string, unknown>
    expect(land.rankingBadgeStyle).toBe("pill")

    // Orizzontale replays the isolated profile (netflix never written there,
    // so the inherited pill shows — no portrait leak by construction).
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Orizzontale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "landscape",
    )
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("rs")).toBe("pill")
    // Back to Verticale: the Colore edit is still there.
    p = await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Verticale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("rs") === "colored",
    )
    expect(p.get("ribbon")).toBe("1")

    // Server bytes: same accent (same artwork, no ac override), Standard vs
    // Colorato render different ribbons.
    const base = {
      genreName: "Action",
      voteAverage: "7.8",
      badges: "1",
      ranking: "1",
      ribbon: "1",
    }
    const standard = await request.get(apiPoster({ ...base, rs: "netflix" }))
    expect(standard.ok()).toBeTruthy()
    const standardBuf = await standard.body()
    expect(standardBuf.length).toBeGreaterThan(1000)
    const colored = await request.get(apiPoster({ ...base, rs: "colored" }))
    expect(colored.ok()).toBeTruthy()
    const coloredBuf = await colored.body()
    expect(coloredBuf.length).toBeGreaterThan(1000)
    expect(Buffer.compare(standardBuf, coloredBuf)).not.toBe(0)
  })
})

test.describe("U4 U1 ribbon Standard/Colorato (per-title)", () => {
  test("desktop: per-title Nastro sends rs netflix/colored + single ribbon, no side control", async ({
    page,
  }) => {
    await seed(page, `${DEMO_PROFILE}-ribbon-pertitle`, "mock-tmdb-key-0000000000")
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

    const editor = page.locator("main").first()
    const rankGroup = editor.getByRole("radiogroup", { name: "Classifica" })
    await expect(rankGroup).toBeVisible()

    // Per-title side is global-only: no Posizione control (not persistible).
    await expect(editor.getByRole("radiogroup", { name: "Posizione" })).toHaveCount(0)

    const editorMatch = (u: URL) => u.searchParams.get("demosamples") !== "1"
    let p = await nextPreview(
      seen,
      async () => {
        await rankGroup.getByRole("radio", { name: "Nastro" }).click()
      },
      (u) => u.searchParams.get("rs") === "netflix",
      editorMatch,
    )
    expect(p.get("rs")).toBe("netflix")
    expect(p.get("ribbon")).toBe("1")
    expect(p.getAll("ribbon")).toEqual(["1"])

    const ribbonGroup = editor.getByRole("radiogroup", { name: "Nastro" })
    p = await nextPreview(
      seen,
      async () => {
        await ribbonGroup.getByRole("radio", { name: "Colore" }).click()
      },
      (u) => u.searchParams.get("rs") === "colored",
      editorMatch,
    )
    expect(p.get("rs")).toBe("colored")
    expect(p.get("ribbon")).toBe("1")
    expect(p.getAll("ribbon")).toEqual(["1"])
    await expect(editor.getByRole("radiogroup", { name: "Posizione" })).toHaveCount(0)
  })
})

test.describe("U4 U2 contextual preview (defaults)", () => {
  test("desktop: Info focus resolves a real EXTRA sample; hover inert; Auto restores; empty emits nothing", async ({
    page,
    request,
  }) => {
    await seed(page, `${DEMO_PROFILE}-context`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await putDefaults(page, RESET_PAYLOAD)
    const seen: Seen = { urls: [] }
    collectRequests(page, seen)

    await page.getByRole("button", { name: /Impostazioni/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    // Default tab is Preset: the extra style editor lives on Badge.
    await dialog.getByRole("tab", { name: "Badge", exact: true }).click()
    const badgePanel = dialog.getByRole("tabpanel", { name: "Badge", exact: true })
    await expect(badgePanel).toBeVisible()
    const chip = dialog.getByTestId("defaults-preview-editing")
    await expect(chip).toBeVisible()

    // Auto baseline: effective saved sash, no forced extra. From-0 gate: the
    // open burst already fired once and never refetches without an edit.
    let p = await waitPreview(seen, (u) => u.searchParams.get("sash") === "upcoming,rank,new,award,extra")
    expect(p.get("extra")).toBeNull()
    // Settled-hydration gate (serial-sweep 429 proven): the staged session
    // baselines on whatever outer it mounts with, and a RESET hydration that
    // lands AFTER the first staged edit trips the by-design external-conflict
    // guard (Save disabled, draft preserved). The RESET pill+ribbon URL can
    // only fire post-hydration (factory previews carry rs=default), so this
    // proves the baseline is RESET before anything stages — no edit, no
    // timing change, just the file's own settled-preview pattern.
    p = await waitPreview(
      seen,
      (u) => u.searchParams.get("shape") === "poster" && u.searchParams.get("rs") === "pill",
    )
    expect(p.get("ribbon")).toBe("1")
    await expect(chip).toContainText("Verticale")
    await expect(chip).toContainText("Anteprima completa")

    // Give the Info card an explicit standalone style first (saved write).
    const extraCard = badgePanel
      .getByText("Stile badge extra", { exact: true })
      .locator("xpath=..")
    await nextPreview(
      seen,
      async () => {
        await extraCard.getByRole("button", { name: "Vetro" }).click()
      },
      (u) => u.searchParams.get("xbs") === "vetro",
    )
    await saveStaged(page)
    await waitDefaults(page, (d) => d.extraBadgeStyle === "vetro")

    // Hover alone never switches the family: return to auto first (the Vetro
    // click above already reported info via pointerdown on the nested
    // control, by design), then hover and assert no NEW extra preview.
    const resetEarly = dialog.getByTestId("defaults-preview-reset-family")
    await expect(resetEarly).toBeVisible()
    await nextPreview(
      seen,
      async () => {
        await resetEarly.click()
      },
      (u) => u.searchParams.get("sash") === "upcoming,rank,new,award,extra" && u.searchParams.get("extra") === null,
    )
    const hoverFrom = seen.urls.length
    // Sash buckets live on Informazioni (macro-groups are always open in
    // settings: no disclosure toggle).
    await dialog.getByRole("tab", { name: "Informazioni", exact: true }).click()
    const infoTitle = badgePanel.getByText("Informazioni sul titolo", { exact: true })
    await infoTitle.hover()
    await page.waitForTimeout(900)
    expect(
      findLastParams(seen.urls, hoverFrom, isDefaultsPreviewUrl, (u) => u.searchParams.get("extra") !== null),
    ).toBeNull()

    // Focus the Info card: the preview forces a pertinent EXTRA sample with
    // the card's own xbs, sash untouched.
    const extraSwitch = badgePanel.getByRole("switch", { name: "Extra" })
    await expect(extraSwitch).toBeVisible()
    p = await nextPreview(
      seen,
      async () => {
        await extraSwitch.focus()
      },
      (u) => u.searchParams.get("extra") !== null,
    )
    const sampleKey = p.get("extra")
    expect(sampleKey).toBeTruthy()
    expect(sampleKey).toMatch(/^__badge\./)
    expect(p.get("xbs")).toBe("vetro")
    expect(p.get("sash")).toBe("upcoming,rank,new,award,extra")
    await expect(chip).toContainText("Informazioni sul titolo")

    // The forced sample is a REAL resolved label server-side (debug JSON),
    // never the raw key string; badge type is extra, never rank+extra together.
    const previewUrl = findLastUrl(seen.urls, 0, isDefaultsPreviewUrl, (u) => u.searchParams.get("extra") !== null)
    expect(previewUrl).not.toBeNull()
    const debugUrl = new URL(previewUrl!.toString())
    debugUrl.searchParams.set("debug", "1")
    const debugRes = await request.get(debugUrl.toString())
    expect(debugRes.ok()).toBeTruthy()
    const debug = (await debugRes.json()) as {
      badge: { settings: { customBadge: unknown }; computed: { badge: { type: string; label: string } } }
    }
    const resolved = debug.badge.settings.customBadge
    expect(typeof resolved).toBe("string")
    expect(resolved as string).toBeTruthy()
    expect(resolved as string).not.toMatch(/^__badge\./)
    // Transport-level no-simultaneity: this same preview carries the full
    // sash AND the forced extra (the forced sample wins at render by
    // construction in poster-service), while the rank family below carries
    // sash=rank with no extra at all.
    expect(p.get("sash")).toBe("upcoming,rank,new,award,extra")

    // Rank family narrows with no simultaneous extra (Classifiche tab).
    await dialog.getByRole("tab", { name: "Classifiche", exact: true }).click()
    const rankSwitch = badgePanel.getByRole("switch", { name: "Classifiche" })
    p = await nextPreview(
      seen,
      async () => {
        await rankSwitch.focus()
      },
      (u) => u.searchParams.get("sash") === "rank",
    )
    expect(p.get("sash")).toBe("rank")
    expect(p.get("extra")).toBeNull()

    // Auto reset restores the full effective saved sash and drops extra.
    const reset = dialog.getByTestId("defaults-preview-reset-family")
    await expect(reset).toBeVisible()
    p = await nextPreview(
      seen,
      async () => {
        await reset.click()
      },
      (u) => u.searchParams.get("sash") === "upcoming,rank,new,award,extra" && u.searchParams.get("extra") === null,
    )
    expect(p.get("sash")).toBe("upcoming,rank,new,award,extra")
    expect(p.get("extra")).toBeNull()
    expect(p.get("xbs")).toBe("vetro")
    await expect(chip).toContainText("Anteprima completa")
    await expect(dialog.getByTestId("defaults-preview-reset-family")).toHaveCount(0)

    // Chip follows the selected format; family retained across targets.
    const formatTarget = dialog.getByTestId("format-target-selector")
    await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Orizzontale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "landscape",
    )
    await expect(chip).toContainText("Orizzontale")
    await nextPreview(
      seen,
      async () => {
        await formatTarget.getByText("Verticale", { exact: true }).click()
      },
      (u) => u.searchParams.get("shape") === "poster",
    )
    await expect(chip).toContainText("Verticale")

    // Disabled categories: master OFF empties the sash (client path, saved);
    // Info focus then emits no sample (no phantom). The click itself is the
    // observed action: the preview refresh (200ms debounce) would otherwise
    // fire while waitDefaults polls and the noop observer would miss it.
    const masterSwitch = badgePanel.getByRole("switch", { name: "Badge superiore" })
    await expect(masterSwitch).toBeVisible()
    // The empty preview itself carries sash= with no extra.
    await nextPreview(
      seen,
      async () => {
        await masterSwitch.click()
      },
      (u) => u.searchParams.get("sash") === "" && u.searchParams.get("extra") === null,
    )
    await saveStaged(page)
    await waitDefaults(page, (d) => Array.isArray(d.sashOrder) && (d.sashOrder as unknown[]).length === 0)
    // Back to Informazioni: the Extra bucket focus must emit no sample now.
    await dialog.getByRole("tab", { name: "Informazioni", exact: true }).click()
    await extraSwitch.focus()
    await page.waitForTimeout(900)
    const lastEmpty = findLastParams(seen.urls, 0, isDefaultsPreviewUrl, () => true)
    expect(lastEmpty).not.toBeNull()
    expect(lastEmpty!.get("sash")).toBe("")
    expect(lastEmpty!.get("extra")).toBeNull()
  })
})

test.describe("U4 U3 number baseline (pixel regression)", () => {
  test("numeral ink sits exactly on the -20 style baseline; tox shifts exactly 20px", async ({
    request,
  }) => {
    // Pixel lock for the Number style baseline (snapshots alone cannot hold
    // it: maxDiffPixelRatio 0.10 absorbs a 20px numeral shift).
    // Ground truth (shared helpers, never forked math):
    // - portrait canvas CW = 500 (STD_W × STD_H), badge pw = 500
    //   (portrait badgePw = CW), historic corner margin on ref 380.
    // - bitmap left L comes from cornerAnchoredLeft + the stored tox
    //   adjustment + NUMBER_BADGE_BASE_OFFSET_X; the numeral ink starts at
    //   L + PAD (PAD = max(8, round(pw*0.03)) shadow pad, same precedent as
    //   the unit suite) plus the glyph left bearing (>= 0, capped below).
    const CW = 500
    const PW = 500
    const PAD = Math.max(8, Math.round(PW * 0.03))
    expect(NUMBER_BADGE_BASE_OFFSET_X).toBe(-20)
    const oldMargin = cornerAnchoredLeft({ canvasW: CW, badgeW: 0, mirrorRight: false, offsetX: 0 })
    expect(oldMargin).toBe(24)

    async function inkBox(buf: Buffer, yMax: number, xMin: number, xMax: number) {
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      expect({ w: info.width, h: info.height }).toEqual({ w: 500, h: 750 })
      let minX = Number.MAX_SAFE_INTEGER
      let maxX = -1
      let minY = Number.MAX_SAFE_INTEGER
      let maxY = -1
      let n = 0
      for (let y = 0; y < Math.min(yMax, info.height); y++) {
        for (let x = xMin; x < Math.min(xMax, info.width); x++) {
          const i = (y * info.width + x) * 4
          if (data[i] > 150 && data[i + 1] > 150 && data[i + 2] > 150) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
            n++
          }
        }
      }
      expect(n).toBeGreaterThan(500)
      return { minX, maxX, minY, maxY, n }
    }

    const base = { genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "1" }
    const cases = [
      { label: "left-1", params: { ...base, rank: "1", label: "Today", rs: "number" }, id: 19995, mirror: false, band: [0, 250] as const },
      { label: "left-12", params: { ...base, rank: "12", label: "Today", rs: "number", quality: "4K" }, id: 603, mirror: false, band: [0, 300] as const },
      { label: "right-3", params: { ...base, rank: "3", label: "Today", rs: "number", side: "right", quality: "4K" }, id: 603, mirror: true, band: [250, 500] as const },
    ]
    for (const c of cases) {
      const digits = String(c.params.rank)
      const numW = buildRankingNumberSvg(Number(digits), PW).w
      // Expected bitmap edge from the shared anchor + stored adjustment (0)
      // + style baseline: the ONLY -20 in the pipeline (single application —
      // preview/Stremio URLs carry the raw tox).
      const expectedLeft = cornerAnchoredLeft({
        canvasW: CW,
        badgeW: numW,
        mirrorRight: c.mirror,
        offsetX: 0 + NUMBER_BADGE_BASE_OFFSET_X,
      })
      const get = async (tox: string) => {
        const qs = new URLSearchParams({ ...c.params, tox, poster: POSTER_PATH, preview: "1" })
        const res = await request.get(`/api/poster/movie/${c.id}?${qs.toString()}`)
        expect(res.ok()).toBeTruthy()
        const buf = await res.body()
        expect(buf.length).toBeGreaterThan(1000)
        return inkBox(buf, 140, c.band[0], c.band[1])
      }
      const b0 = await get("0")
      const b20 = await get("20")
      // Exact tox semantics: +20px on X, zero on Y, no ink growth/clipping.
      expect(b20.minX - b0.minX).toBe(20)
      expect(b20.maxX - b0.maxX).toBe(20)
      expect(b20.minY - b0.minY).toBe(0)
      expect(b20.maxY - b0.maxY).toBe(0)
      expect(Math.abs(b20.n - b0.n)).toBeLessThanOrEqual(8)
      // On-canvas: ink never clips at either edge.
      expect(b0.minX).toBeGreaterThanOrEqual(0)
      expect(b0.maxX).toBeLessThan(CW)
      // Absolute pin on the shared anchor (bearing-tolerant only inward:
      // glyph bearings shift ink right/down, never outside the bitmap+pad).
      // Lower edge is exact-sided: without the -20 these all fail.
      expect(b0.minX).toBeGreaterThanOrEqual(expectedLeft + PAD - 2)
      expect(b0.minX).toBeLessThanOrEqual(expectedLeft + PAD + 15)
      if (c.mirror) {
        expect(b0.maxX).toBeLessThanOrEqual(expectedLeft + numW - PAD + 2)
      }
      // Old-anchor impossibility for the left numerals: with no baseline the
      // ink could never start left of oldMargin + PAD (bearings >= 0).
      if (!c.mirror) {
        expect(b0.minX).toBeLessThan(oldMargin + PAD)
      }
    }
  })
})
test.describe("U4 U3 number baseline (transport + slider)", () => {
  test("api: numeral differs from corner, mirrors right, tox applies once", async ({ request }) => {
    // No defaults writes here: pure API semantics (afterEach stays quiet).
    const base = {
      genreName: "Action",
      voteAverage: "7.8",
      badges: "1",
      ranking: "1",
      ribbon: "1",
    }
    const numeral = await request.get(apiPoster({ ...base, rs: "number" }))
    expect(numeral.ok()).toBeTruthy()
    const numeralBuf = await numeral.body()
    expect(numeralBuf.length).toBeGreaterThan(1000)
    // Bare numeral is not the corner pill.
    const corner = await request.get(apiPoster({ ...base, rs: "corner" }))
    expect(corner.ok()).toBeTruthy()
    expect(Buffer.compare(numeralBuf, await corner.body())).not.toBe(0)
    // side=right mirrors the numeral (same style, other corner).
    const mirrored = await request.get(apiPoster({ ...base, rs: "number", side: "right" }))
    expect(mirrored.ok()).toBeTruthy()
    expect(Buffer.compare(numeralBuf, await mirrored.body())).not.toBe(0)
    // tox is the live adjustment on top of the -20 style baseline.
    const shifted = await request.get(apiPoster({ ...base, rs: "number", tox: "20" }))
    expect(shifted.ok()).toBeTruthy()
    expect(Buffer.compare(numeralBuf, await shifted.body())).not.toBe(0)
    // Corner ignores the numeral baseline: tox=20 on corner == tox=0 shifted
    // by the full user value only (sanity: still renders, distinct bytes).
    const cornerShifted = await request.get(apiPoster({ ...base, rs: "corner", tox: "20" }))
    expect(cornerShifted.ok()).toBeTruthy()
    expect(Buffer.compare(await corner.body(), await cornerShifted.body())).not.toBe(0)
  })

  test("desktop: default X slider reads -20, edit stores the adjustment, pill reads raw", async ({
    page,
  }) => {
    await seed(page, `${DEMO_PROFILE}-number`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await putDefaults(page, RESET_PAYLOAD)
    const seen: Seen = { urls: [] }
    collectRequests(page, seen)

    await page.getByRole("button", { name: /Impostazioni/i }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    // Default tab is Preset: the rank appearance lives on Classifiche.
    await dialog.getByRole("tab", { name: "Classifiche", exact: true }).click()
    const badgePanel = dialog.getByRole("tabpanel", { name: "Badge", exact: true })
    await expect(badgePanel).toBeVisible()

    // Select Numero (saved write): preview carries rs=number, tox stays raw 0
    // (macro-groups are always open in settings: no disclosure toggle).
    const rankGroup = badgePanel.getByRole("radiogroup", { name: "Classifica" })
    const p = await nextPreview(
      seen,
      async () => {
        await rankGroup.getByRole("radio", { name: "Numero" }).click()
      },
      (u) => u.searchParams.get("rs") === "number",
    )
    expect(p.get("tox")).toBe("0")
    await saveStaged(page)
    await waitDefaults(page, (d) => d.rankingBadgeStyle === "number")

    // Trasforma tab: the default X slider reads the effective -20 with the
    // stored adjustment untouched.
    await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    const trasforma = dialog.getByRole("tabpanel", { name: "Trasforma" })
    await expect(trasforma).toBeVisible()
    const topCard = trasforma.locator("div.rounded-xl", { hasText: "Classifica" }).first()
    await expect(topCard).toBeVisible()
    const xSlider = topCard.getByRole("slider", { name: "X" })
    await expect(xSlider).toHaveValue("-20")
    expect((await getDefaults(page)).topBadgeOffsetX).toBe(0)

    // Typed edit -10 stores the +10 adjustment relative to the baseline.
    await topCard.getByRole("button", { name: "X: -20px" }).click()
    const editor = topCard.locator("input.editor-input")
    await expect(editor).toBeVisible()
    await editor.fill("-10")
    await editor.press("Enter")
    await saveStaged(page)
    await waitDefaults(page, (d) => d.topBadgeOffsetX === 10)
    await expect(xSlider).toHaveValue("-10")

    // Other styles read the raw value (baseline 0): back to Classifiche,
    // select a centered Badge variant — the stored +10 shows unshifted.
    await dialog.getByRole("tab", { name: "Classifiche", exact: true }).click()
    const badgeBack = dialog.getByRole("tabpanel", { name: "Badge", exact: true })
    await expect(badgeBack).toBeVisible()
    await badgeBack
      .getByRole("radiogroup", { name: "Classifica" })
      .getByRole("radio", { name: "Badge" })
      .click()
    await saveStaged(page)
    await waitDefaults(page, (d) => d.rankingBadgeStyle === "pill")
    await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
    const trasforma2 = dialog.getByRole("tabpanel", { name: "Trasforma" })
    await expect(trasforma2).toBeVisible()
    const topCard2 = trasforma2.locator("div.rounded-xl", { hasText: "Classifica" }).first()
    await expect(topCard2.getByRole("slider", { name: "X" })).toHaveValue("10")
  })
})
