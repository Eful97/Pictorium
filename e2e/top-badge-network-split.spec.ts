import { test, expect, type APIRequestContext, type Page } from "@playwright/test"
import { putDefaultsWithRetry } from "./defaults-retry"

// CLASSIFICA vs EXTRA + network-follow split: contract (poster API) and the
// Trasforma UI that drives it. Deterministic mock server, no credentials.
// - rank tuning (tscale/tox/toy) never moves/resizes extra badges and
//   vice versa (bytes isolate the tuning, same content both sides);
// - netFollow=0 freezes the actually rendered box (debug netgeo roundtrip);
// - legacy URLs without ex* stay canonical;
// - saved mappings reload per-shape tuning (portrait + landscape);
// - Settings > Trasforma: follow checkbox freezes without jumping, and a
//   later title-logo move leaves the frozen network box untouched.

const RANK_ID = 603 // Matrix: absent from the mock JW chart, query rank applies cleanly
const EXTRA_ID = 19995 // Avatar: queryExtra wins over any computed badge
const SAVE_ID = 27205 // saved-mapping reload (deleted in finally)
const POSTER_PATH = "/mocked/avatar.jpg"

function posterUrl(params: Record<string, string>, id: number = EXTRA_ID): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/movie/${id}?${qs.toString()}`
}

async function renderPng(request: APIRequestContext, url: string): Promise<Buffer> {
  const res = await request.get(url)
  expect(res.ok()).toBeTruthy()
  const buf = Buffer.from(await res.body())
  expect(buf.length).toBeGreaterThan(1000)
  return buf
}

async function deleteMapping(request: APIRequestContext, id: number) {
  await request.delete(`/api/mappings/movie:${id}`).catch(() => null)
}

test.describe("top badge split: rank vs extra independence (poster API)", () => {
  test("rank render ignores exscale/exox/exoy, follows tscale", async ({ request }) => {
    const base = { badges: "1", ranking: "1", rank: "3", label: "Top 3", rs: "default" }
    const plain = await renderPng(request, posterUrl(base, RANK_ID))
    const withExtra = await renderPng(
      request,
      posterUrl({ ...base, exscale: "150", exox: "40", exoy: "40" }, RANK_ID),
    )
    expect(Buffer.compare(plain, withExtra)).toBe(0)
    const scaled = await renderPng(request, posterUrl({ ...base, tscale: "150" }, RANK_ID))
    expect(Buffer.compare(plain, scaled)).not.toBe(0)
  })

  test("extra render ignores tscale/tox/toy once migrated, follows exscale", async ({ request }) => {
    const base = { badges: "1", ranking: "1", extra: "Oscar 2024" }
    const migrated = { ...base, exscale: "100", exox: "0", exoy: "0" }
    const ref = await renderPng(request, posterUrl(migrated))
    const rankMoved = await renderPng(
      request,
      posterUrl({ ...migrated, tscale: "150", tox: "40", toy: "40" }),
    )
    expect(Buffer.compare(ref, rankMoved)).toBe(0)
    const extraMoved = await renderPng(request, posterUrl({ ...migrated, exscale: "150" }))
    expect(Buffer.compare(ref, extraMoved)).not.toBe(0)
  })

  test("unmigrated extra follows the classifica tuning (legacy fallback)", async ({ request }) => {
    const base = { badges: "1", ranking: "1", extra: "Oscar 2024" }
    const plain = await renderPng(request, posterUrl(base))
    const viaLegacy = await renderPng(request, posterUrl({ ...base, tscale: "150" }))
    expect(Buffer.compare(plain, viaLegacy)).not.toBe(0)
  })

  test("legacy URL without ex* is deterministic (canonical cache)", async ({ request }) => {
    const url = posterUrl({ badges: "1", ranking: "1", extra: "Oscar 2024" })
    expect(url).not.toContain("exscale")
    const a = await renderPng(request, url)
    const b = await renderPng(request, url)
    expect(Buffer.compare(a, b)).toBe(0)
  })
})

test.describe("network follow freeze (poster API + debug netgeo)", () => {
  // Demo-samples preview renders the bundled Netflix brand, so a real
  // network box exists in the mock env (plain titles render none).
  const demoBase = {
    preview: "1",
    demosamples: "1",
    lang: "it",
    // Explicit network enable: the demo brand renders only when the logo is
    // enabled, and the shared serial-run defaults cannot be trusted for it.
    netLogo: "1",
  }

  test("netgeo reports the actually rendered box", async ({ request }) => {
    const url = `/api/poster/movie/${EXTRA_ID}?${new URLSearchParams({ ...demoBase, debug: "1", netgeo: "1" }).toString()}`
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.network).not.toBeNull()
    expect(json.network.w).toBeGreaterThan(0)
    expect(json.network.h).toBeGreaterThan(0)
  })

  test("netFollow=0 freezes top/left exactly (no-jump roundtrip)", async ({ request }) => {
    const frozen = `/api/poster/movie/${EXTRA_ID}?${new URLSearchParams({
      ...demoBase,
      netFollow: "0",
      nox: "100",
      noy: "200",
      debug: "1",
      netgeo: "1",
    }).toString()}`
    const res = await request.get(frozen)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.network.left).toBe(100)
    expect(json.network.top).toBe(200)
  })

  test("debug reports both tunings (classifica + extra)", async ({ request }) => {
    const url = posterUrl({ badges: "1", ranking: "1", debug: "1" })
    const res = await request.get(url)
    expect(res.ok()).toBeTruthy()
    const json = await res.json()
    expect(json.topBadge).toEqual({ scale: 100, offsetX: 0, offsetY: 0 })
    expect(json.extraBadge).toEqual({ scale: null, offsetX: null, offsetY: null })
  })
})

test.describe("saved mapping reloads per-shape tuning (portrait + landscape)", () => {
  test.afterEach(async ({ request }) => {
    await deleteMapping(request, SAVE_ID)
  })

  async function debugTuning(request: APIRequestContext, shape?: string) {
    const qs = new URLSearchParams({ lang: "it", debug: "1" })
    if (shape) qs.set("shape", shape)
    const res = await request.get(`/api/poster/movie/${SAVE_ID}?${qs.toString()}`)
    expect(res.ok()).toBeTruthy()
    return res.json()
  }

  test("flat mapping tuning resolves in portrait, profile in landscape", async ({ request }) => {
    const put = await request.post("/api/mappings", {
      data: {
        tmdbId: SAVE_ID,
        mediaType: "movie",
        title: "Inception",
        posterPath: POSTER_PATH,
        topBadgeScale: 130,
        extraBadgeScale: 140,
        extraBadgeOffsetX: 10,
        landscape: { topBadgeScale: 120, extraBadgeScale: 110 },
      },
    })
    expect(put.ok()).toBeTruthy()
    try {
      const portrait = await debugTuning(request)
      expect(portrait.topBadge).toEqual({ scale: 130, offsetX: 0, offsetY: 0 })
      expect(portrait.extraBadge).toEqual({ scale: 140, offsetX: 10, offsetY: null })
      const landscape = await debugTuning(request, "landscape")
      expect(landscape.topBadge).toEqual({ scale: 120, offsetX: 0, offsetY: 0 })
      expect(landscape.extraBadge).toEqual({ scale: 110, offsetX: 10, offsetY: null })
    } finally {
      await deleteMapping(request, SAVE_ID)
    }
  })
})

// ---------------------------------------------------------------------------
// Settings > Trasforma UI (global defaults). Same harness idiom as
// settings-transform-preview.spec.ts: deterministic server defaults,
// intercepted preview URLs, no snapshots here (params only).
// ---------------------------------------------------------------------------

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

function collectPreviewRequests(page: Page, seen: Seen) {
  page.on("request", (req) => {
    if (tryDemoUrl(req.url())) seen.urls.push(req.url())
  })
}

async function waitPreview(
  seen: Seen,
  pred: (u: URL) => boolean = () => true,
  from = 0,
): Promise<URLSearchParams> {
  let out: URLSearchParams | null = null
  await expect
    .poll(
      () => {
        for (const raw of seen.urls.slice(from)) {
          const u = tryDemoUrl(raw)
          if (u && pred(u)) {
            out = u.searchParams
            return "ok"
          }
        }
        return null
      },
      { timeout: 30_000 },
    )
    .not.toBeNull()
  return out as unknown as URLSearchParams
}

async function nextPreview(
  seen: Seen,
  action: () => Promise<unknown>,
  pred: (u: URL) => boolean = () => true,
): Promise<URLSearchParams> {
  const n = seen.urls.length
  await action()
  return waitPreview(seen, pred, n)
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.clear()
      localStorage.setItem("pictorium_profile_id", "e2e-topsplit")
      localStorage.setItem("pictorium_profile_stateless", "1")
      localStorage.setItem("pictorium_onboarding_done", "true")
      localStorage.setItem("preferred_lang", "it")
      localStorage.setItem("tmdb_key", "")
    } catch {}
  })
}

const FACTORY_RESTORE = {
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  extraBadgeScale: null,
  extraBadgeOffsetX: null,
  extraBadgeOffsetY: null,
  rankingBadges: true,
  networkLogoFollowTitle: true,
  networkLogoScale: 100,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
  logoScale: null,
  logoOffsetX: null,
  logoOffsetY: null,
}

async function openTrasforma(page: Page) {
  await page.getByRole("button", { name: /Impostazioni/i }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("tab", { name: "Trasforma", exact: true }).click()
  const panel = dialog.getByRole("tabpanel", { name: "Trasforma" })
  await expect(panel).toBeVisible()
  return { dialog, panel }
}

test.describe("Settings Trasforma: network follow + rank/extra cards", () => {
  test.afterEach(async ({ page }) => {
    // Race-proof restore: the open editor autosaves debounced (500ms), so a
    // bare PUT loses to the stale page re-pushing pre-restore state (proven
    // by u4 pixel fallout: follow:false + freeze actuals + logoX survived).
    // Flush, restore, reload (fresh editor adopts restored state), verify.
    await page.waitForTimeout(2000)
    await putDefaultsWithRetry(page, "restore defaults", FACTORY_RESTORE)
    await page.goto("/")
    await expect
      .poll(
        async () => {
          const d = (await (
            await page.evaluate(async () => {
              const r = await fetch("/api/defaults")
              return (await r.json()) as Record<string, unknown>
            })
          )) as Record<string, unknown>
          return (
            d.networkLogoFollowTitle === true &&
            (d.networkLogoOffsetX ?? 0) === 0 &&
            (d.networkLogoOffsetY ?? 0) === 0 &&
            (d.logoOffsetX ?? null) === null &&
            (d.topBadgeScale ?? 100) === 100 &&
            (d.extraBadgeScale ?? null) === null
          )
        },
        { timeout: 15_000 },
      )
      .toBe(true)
  })

  test("follow checkbox freezes without jumping; title move leaves it untouched", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/")
    await putDefaultsWithRetry(page, "reset defaults", {
      networkLogo: true,
      networkLogoFollowTitle: true,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
    })
    await page.goto("/")
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)
    const { dialog, panel } = await openTrasforma(page)
    await waitPreview(seen)

    const follow = panel.getByRole("switch", { name: "Segui il logo del titolo" })
    await expect(follow).toHaveAttribute("aria-checked", "true")
    // Geometry must be really rendered (demo brand) before OFF unlocks.
    await expect(follow).toBeEnabled({ timeout: 30_000 })

    // Read the actually rendered box from the live preview URL.
    const live = await waitPreview(seen)
    const liveUrl = seen.urls.map((u) => tryDemoUrl(u)).filter(Boolean).pop()!.toString()
    expect(live.get("netFollow")).not.toBe("0")
    const geoRes = await page.request.get(`${liveUrl}&debug=1&netgeo=1`)
    expect(geoRes.ok()).toBeTruthy()
    const geo = (await geoRes.json()).network
    expect(geo).not.toBeNull()

    // OFF freezes top/left exactly where the box is (no jump).
    const frozen = await nextPreview(
      seen,
      async () => {
        await follow.click()
      },
      (u) => u.searchParams.get("netFollow") === "0",
    )
    expect(frozen.get("nox")).toBe(String(Math.round(geo.left)))
    expect(frozen.get("noy")).toBe(String(Math.round(geo.top)))
    await expect(follow).toHaveAttribute("aria-checked", "false")

    // Moving the title logo must not move the frozen network box.
    // The title-logo card header carries a "· Auto" suffix span, so an exact
    // text match never resolves: scope by card (established hasText idiom).
    const logoCard = panel.locator("div.rounded-xl", { hasText: "Loghi" }).first()
    const logoX = logoCard.getByRole("slider", { name: "X", exact: true })
    const moved = await nextPreview(
      seen,
      async () => {
        await logoX.fill("60")
      },
      (u) => u.searchParams.get("ox") === "60",
    )
    expect(moved.get("netFollow")).toBe("0")
    expect(moved.get("nox")).toBe(String(Math.round(geo.left)))
    expect(moved.get("noy")).toBe(String(Math.round(geo.top)))
    await dialog.getByRole("button", { name: /Chiudi|Close|Fatto|Done/i }).click().catch(() => null)
  })

  test("rank card edits tscale only, extra card adds exscale only", async ({ page }) => {
    await seed(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/")
    await putDefaultsWithRetry(page, "reset defaults", {
      rankingBadges: true,
      topBadgeScale: 100,
      topBadgeOffsetX: 0,
      topBadgeOffsetY: 0,
      extraBadgeScale: null,
      extraBadgeOffsetX: null,
      extraBadgeOffsetY: null,
    })
    await page.goto("/")
    const seen: Seen = { urls: [] }
    collectPreviewRequests(page, seen)
    const { panel } = await openTrasforma(page)
    await waitPreview(seen)

    const rankCard = panel.locator("div.rounded-xl", { hasText: "Classifica" }).first()
    const rankScale = rankCard.getByRole("slider", { name: "Scala", exact: true })
    const p1 = await nextPreview(
      seen,
      async () => {
        await rankScale.fill("150")
      },
      (u) => u.searchParams.get("tscale") === "150",
    )
    // Rank edit materializes the previously-following extra (freeze rule:
    // previous effective rank 100 is written into the extra layer, so the
    // extra badge keeps its pixels while rank moves). Independence is
    // pixel-level here, not param absence (byte isolation is proven by the
    // API tests above).
    expect(p1.get("exscale")).toBe("100")

    const extraCard = panel.locator("div.rounded-xl", { hasText: "Extra" }).first()
    const extraScale = extraCard.getByRole("slider", { name: "Scala", exact: true })
    const p2 = await nextPreview(
      seen,
      async () => {
        await extraScale.fill("150")
      },
      (u) => u.searchParams.get("exscale") === "150",
    )
    expect(p2.get("tscale")).toBe("150")
  })
})
