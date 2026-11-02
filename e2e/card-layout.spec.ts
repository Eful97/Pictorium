import { test, expect, type Page } from "@playwright/test"
import { putDefaultsWithRetry } from "./defaults-retry"

// P10 FINAL GATE — Card cover layouts (provider-glass / nuvio /
// stremio) × portrait + landscape, deterministic via the shared mock server
// (e2e/mock-server.mjs, started by playwright.config.ts). No TMDB_API_KEY,
// no live network.
//
// - 8 visual goldens (3 skins × 2 shapes + 2 rank-4 clean regressions): NEW baselines, existing
//   Fresh/Standard goldens in pictorium-visual.spec.ts are untouched.
//   P8 intentional: nuvio portrait + landscape carry the 5-rating aggregate
//   (ONE inline `GENRE • ★ score`, no source labels). P9 intentional: big
//   hollow-glass doubles keep reference double height with horizontal
//   condense (rank 11 regression for the old "tiny 11" gutter-fit shrink,
//   rank 20 in BOTH shapes across skins: nuvio portrait+landscape and
//   provider-glass landscape).
// - Request-level contracts (no snapshots): ranked-default fallback to a
//   byte-identical Standard render without a rank, explicit "all" override
//   rendering Card without a rank, Card stopping at rank 20 (21 falls back),
//   rank 11 rendering Card in both shapes (double-digit regression, no
//   snapshot bloat), rank 20 in both shapes, skins differing from each
//   other and from Standard.
// - Focused UI selection: the settings Badge tab exposes the 5-choice cover
//   layout radiogroup; picking a Card skin reveals the generic apply-scope
//   selector in portrait AND landscape; back to Standard hides it again.

const MOVIE_RANKED = 19995 // Avatar: mock JW chart #1 -> deterministic trendRank 1
const MOVIE_OFFCHART = 603 // Matrix: absent from mock JW -> explicit query rank applies
const MEDIA_TYPE = "movie"
const POSTER_PATH = "/mocked/avatar.jpg"
const BACKDROP_PATH = "/mocked/backdrop.jpg"
const FIVE_SOURCES = "imdb,tmdb,tomatoes,popcorntime,metacritic"

function cardUrl(
  params: Record<string, string>,
  mediaType: string = MEDIA_TYPE,
  id: number | string = MOVIE_RANKED,
): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/${mediaType}/${id}?${qs.toString()}`
}

async function renderPoster(page: Page, url: string) {
  await page.setViewportSize({ width: 1280, height: 1600 })
  await page.goto("/api/health")
  await page.setContent(`
    <html>
      <body style="margin:0;background:#000;display:flex;align-items:flex-start;justify-content:center;">
        <img id="poster" src="${url}" style="display:block;max-width:100%;height:auto;" />
      </body>
    </html>
  `)
  await page.waitForFunction(() => {
    const img = document.getElementById("poster") as HTMLImageElement
    return img && img.complete && img.naturalWidth > 0
  }, { timeout: 30_000 })
  return page.locator("#poster")
}

test.describe("card layouts — visual regression (3 skins × 2 shapes)", () => {
  test("provider-glass portrait, rank 1 — screenshot", async ({ page }) => {
    const url = cardUrl({
      genreName: "Action",
      voteAverage: "7.8",
      badges: "1",
      ranking: "1",
      layout: "provider-glass",
    })
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 500, h: 750 })
    await expect(poster).toHaveScreenshot("card-provider-glass-portrait.png", { maxDiffPixelRatio: 0.10 })
  })

  test("nuvio portrait, rank 20 + five ratings — screenshot", async ({ page }) => {
    const url = cardUrl(
      {
        genreName: "Action",
        voteAverage: "7.8",
        year: "2024",
        badges: "1",
        ranking: "1",
        rank: "20",
        label: "Top 20",
        layout: "nuvio",
        imdbId: "tt0133093",
        sep: "1",
        rsrc: FIVE_SOURCES,
      },
      "movie",
      MOVIE_OFFCHART,
    )
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 500, h: 750 })
    await expect(poster).toHaveScreenshot("card-nuvio-portrait.png", { maxDiffPixelRatio: 0.10 })
  })

  test("stremio portrait, rank 11 — screenshot (double-digit regression)", async ({ page }) => {
    const url = cardUrl(
      {
        genreName: "Action",
        voteAverage: "7.8",
        badges: "1",
        ranking: "1",
        rank: "11",
        label: "Top 11",
        layout: "stremio",
      },
      "movie",
      MOVIE_OFFCHART,
    )
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 500, h: 750 })
    await expect(poster).toHaveScreenshot("card-stremio-portrait.png", { maxDiffPixelRatio: 0.10 })
  })

  test("provider-glass landscape, rank 20 — screenshot", async ({ page }) => {
    const url = cardUrl(
      {
        backdrop: BACKDROP_PATH,
        shape: "landscape",
        genreName: "Action",
        voteAverage: "7.8",
        badges: "1",
        ranking: "1",
        rank: "20",
        label: "Top 20",
        layout: "provider-glass",
      },
      "movie",
      MOVIE_OFFCHART,
    )
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 768, h: 432 })
    await expect(poster).toHaveScreenshot("card-provider-glass-landscape.png", { maxDiffPixelRatio: 0.10 })
  })

  test("nuvio landscape, rank 20 + five ratings — screenshot", async ({ page }) => {
    const url = cardUrl(
      {
        backdrop: BACKDROP_PATH,
        shape: "landscape",
        genreName: "Action",
        voteAverage: "7.8",
        year: "2024",
        badges: "1",
        ranking: "1",
        rank: "20",
        label: "Top 20",
        layout: "nuvio",
        imdbId: "tt0133093",
        sep: "1",
        rsrc: FIVE_SOURCES,
      },
      "movie",
      MOVIE_OFFCHART,
    )
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 768, h: 432 })
    await expect(poster).toHaveScreenshot("card-nuvio-landscape.png", { maxDiffPixelRatio: 0.10 })
  })

  test("stremio landscape, rank 1 — screenshot", async ({ page }) => {
    const url = cardUrl({
      backdrop: BACKDROP_PATH,
      shape: "landscape",
      genreName: "Action",
      voteAverage: "7.8",
      badges: "1",
      ranking: "1",
      layout: "stremio",
    })
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 768, h: 432 })
    await expect(poster).toHaveScreenshot("card-stremio-landscape.png", { maxDiffPixelRatio: 0.10 })
  })

  test("provider-glass portrait, rank 4 — screenshot (clean-4 regression)", async ({ page }) => {
    const url = cardUrl(
      {
        genreName: "Action",
        voteAverage: "7.8",
        badges: "1",
        ranking: "1",
        rank: "4",
        label: "Top 4",
        layout: "provider-glass",
      },
      "movie",
      MOVIE_OFFCHART,
    )
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 500, h: 750 })
    await expect(poster).toHaveScreenshot("card-provider-glass-portrait-rank4.png", { maxDiffPixelRatio: 0.10 })
  })

  test("provider-glass landscape, rank 4 — screenshot (clean-4 regression)", async ({ page }) => {
    const url = cardUrl(
      {
        backdrop: BACKDROP_PATH,
        shape: "landscape",
        genreName: "Action",
        voteAverage: "7.8",
        badges: "1",
        ranking: "1",
        rank: "4",
        label: "Top 4",
        layout: "provider-glass",
      },
      "movie",
      MOVIE_OFFCHART,
    )
    const poster = await renderPoster(page, url)
    const size = await poster.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }))
    expect(size).toEqual({ w: 768, h: 432 })
    await expect(poster).toHaveScreenshot("card-provider-glass-landscape-rank4.png", { maxDiffPixelRatio: 0.10 })
  })
})

test.describe("card layouts — scope and rank contracts", () => {
  const base = { genreName: "Action", voteAverage: "7.8", badges: "1", ranking: "0" }

  test("ranked default without a rank falls back to byte-identical Standard", async ({ request }) => {
    // Off-chart title, no rank anywhere: ranked scope must not invent one.
    const cardRes = await request.get(cardUrl({ ...base, layout: "provider-glass" }, "movie", MOVIE_OFFCHART))
    expect(cardRes.ok()).toBeTruthy()
    const stdRes = await request.get(cardUrl({ ...base, layout: "standard" }, "movie", MOVIE_OFFCHART))
    expect(stdRes.ok()).toBeTruthy()
    expect(Buffer.from(await cardRes.body()).equals(Buffer.from(await stdRes.body()))).toBe(true)
  })

  test('explicit "all" scope renders Card without a rank (differs from Standard)', async ({ request }) => {
    const allRes = await request.get(
      cardUrl({ ...base, layout: "nuvio", freshScope: "all" }, "movie", MOVIE_OFFCHART),
    )
    expect(allRes.ok()).toBeTruthy()
    const stdRes = await request.get(cardUrl({ ...base, layout: "standard" }, "movie", MOVIE_OFFCHART))
    expect(stdRes.ok()).toBeTruthy()
    expect(Buffer.from(await allRes.body()).equals(Buffer.from(await stdRes.body()))).toBe(false)
  })

  test("rank 21 falls back to Standard (Card stops at 20)", async ({ request }) => {
    const params = { ...base, badges: "1", ranking: "1", rank: "21", label: "Top 21", layout: "stremio" }
    const cardRes = await request.get(cardUrl(params, "movie", MOVIE_OFFCHART))
    expect(cardRes.ok()).toBeTruthy()
    const stdRes = await request.get(cardUrl({ ...params, layout: "standard" }, "movie", MOVIE_OFFCHART))
    expect(stdRes.ok()).toBeTruthy()
    expect(Buffer.from(await cardRes.body()).equals(Buffer.from(await stdRes.body()))).toBe(true)
  })

  test("rank 20 renders Card (differs from Standard) in both shapes", async ({ request }) => {
    const portrait = { ...base, ranking: "1", rank: "20", label: "Top 20", layout: "provider-glass" }
    const cardRes = await request.get(cardUrl(portrait, "movie", MOVIE_OFFCHART))
    expect(cardRes.ok()).toBeTruthy()
    const stdRes = await request.get(cardUrl({ ...portrait, layout: "standard" }, "movie", MOVIE_OFFCHART))
    expect(stdRes.ok()).toBeTruthy()
    expect(Buffer.from(await cardRes.body()).equals(Buffer.from(await stdRes.body()))).toBe(false)

    const landscape = { ...portrait, backdrop: BACKDROP_PATH, shape: "landscape" }
    const cardLandRes = await request.get(cardUrl(landscape, "movie", MOVIE_OFFCHART))
    expect(cardLandRes.ok()).toBeTruthy()
    const stdLandRes = await request.get(cardUrl({ ...landscape, layout: "standard" }, "movie", MOVIE_OFFCHART))
    expect(stdLandRes.ok()).toBeTruthy()
    expect(Buffer.from(await cardLandRes.body()).equals(Buffer.from(await stdLandRes.body()))).toBe(false)
  })

  test("rank 11 renders Card (differs from Standard) in both shapes — double-digit regression", async ({ request }) => {
    // The old gutter-fit shrank portrait doubles to ~91px ("tiny 11"): an
    // explicit rank-11 Card must differ from Standard in BOTH shapes (the
    // condensed double numeral paints at reference height, never a shrink).
    const portrait = { ...base, ranking: "1", rank: "11", label: "Top 11", layout: "stremio" }
    const cardRes = await request.get(cardUrl(portrait, "movie", MOVIE_OFFCHART))
    expect(cardRes.ok()).toBeTruthy()
    const stdRes = await request.get(cardUrl({ ...portrait, layout: "standard" }, "movie", MOVIE_OFFCHART))
    expect(stdRes.ok()).toBeTruthy()
    expect(Buffer.from(await cardRes.body()).equals(Buffer.from(await stdRes.body()))).toBe(false)

    const landscape = { ...portrait, backdrop: BACKDROP_PATH, shape: "landscape" }
    const cardLandRes = await request.get(cardUrl(landscape, "movie", MOVIE_OFFCHART))
    expect(cardLandRes.ok()).toBeTruthy()
    const stdLandRes = await request.get(cardUrl({ ...landscape, layout: "standard" }, "movie", MOVIE_OFFCHART))
    expect(stdLandRes.ok()).toBeTruthy()
    expect(Buffer.from(await cardLandRes.body()).equals(Buffer.from(await stdLandRes.body()))).toBe(false)
  })

  test("the three skins render distinctly from each other (same rank)", async ({ request }) => {
    // Avatar carries the deterministic mock trendRank 1, so the rank channel
    // is identical for all three — bytes isolate the skin.
    const baseRanked = { ...base, ranking: "1", layout: "standard" }
    const stdBuf = Buffer.from(await (await request.get(cardUrl(baseRanked))).body())
    const skins = ["provider-glass", "nuvio", "stremio"] as const
    const bufs: Buffer[] = []
    for (const layout of skins) {
      const res = await request.get(cardUrl({ ...base, ranking: "1", layout }))
      expect(res.ok()).toBeTruthy()
      const buf = Buffer.from(await res.body())
      expect(buf.equals(stdBuf)).toBe(false)
      bufs.push(buf)
    }
    expect(bufs[0].equals(bufs[1])).toBe(false)
    expect(bufs[0].equals(bufs[2])).toBe(false)
    expect(bufs[1].equals(bufs[2])).toBe(false)
  })
})

test.describe("card layouts — settings selection (portrait + landscape)", () => {
  // Isolation: this UI test writes posterLayout/posterFreshScope through the
  // debounced autosave. Capture the pre-test server state, seed a
  // deterministic start, and restore the captured state in afterEach (PUT +
  // unmount + verify of OUR managed keys only — never a shared-data wipe).
  const CARD_SEED = {
    posterLayout: "standard",
    posterFreshScope: "ranked",
    landscape: {
      posterLayout: "standard",
      posterFreshScope: "ranked",
    },
  }
  let cardBaseline: Record<string, unknown> | null = null
  let cardDirty = false

  async function getDefaults(page: Page): Promise<Record<string, unknown>> {
    return page.evaluate(async () => {
      const r = await fetch("/api/defaults")
      if (!r.ok) throw new Error(`get defaults: ${r.status}`)
      return (await r.json()) as Record<string, unknown>
    })
  }

  async function waitDefaults(page: Page, pred: (d: Record<string, unknown>) => boolean) {
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

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear()
        localStorage.setItem("pictorium_profile_id", "e2e-card-layout")
        localStorage.setItem("pictorium_profile_stateless", "1")
        localStorage.setItem("pictorium_onboarding_done", "true")
        localStorage.setItem("preferred_lang", "it")
        localStorage.setItem("tmdb_key", "")
      } catch {}
    })
    await page.goto("/")
    cardBaseline = await getDefaults(page)
    await putDefaultsWithRetry(page, "seed card-layout", CARD_SEED)
    cardDirty = true
    await page.goto("/")
    await waitDefaults(page, (d) => d.posterLayout === "standard")
  })

  test.afterEach(async ({ page }) => {
    if (!cardDirty || !cardBaseline) return
    cardDirty = false
    const base = cardBaseline
    cardBaseline = null
    // Settle the trailing debounced autosave BEFORE the restore PUT: the last
    // UI action of the test restores Standard, so await that flush (no fixed
    // sleeps — the debounce is 500ms, the poll observes its effect).
    await waitDefaults(page, (d) => d.posterLayout === "standard").catch(() => null)
    await page.goto("/")
    // Merge cannot delete keys: materialize OUR managed landscape keys with
    // the baseline effective values so a frozen/explicit dirty profile value
    // is overwritten rather than left behind.
    const baseLand = (base.landscape ?? {}) as Record<string, unknown>
    const restore = {
      ...(base as Record<string, unknown>),
      posterLayout: base.posterLayout ?? "standard",
      posterFreshScope: base.posterFreshScope ?? "ranked",
      landscape: {
        ...(baseLand as Record<string, unknown>),
        posterLayout: (baseLand.posterLayout as string | undefined) ?? (base.posterLayout as string | undefined) ?? "standard",
        posterFreshScope: (baseLand.posterFreshScope as string | undefined) ?? (base.posterFreshScope as string | undefined) ?? "ranked",
      },
    }
    delete (restore as Record<string, unknown>).hasInstanceKeys
    delete (restore as Record<string, unknown>).serverKeys
    await putDefaultsWithRetry(page, "restore card-layout", restore)
    // Clear any pending debounce by unmounting (navigation closes the editor;
    // the hook clears its timer + aborts inflight sends on unmount).
    await page.goto("/")
    const got = await getDefaults(page)
    expect(got.posterLayout).toBe(restore.posterLayout)
    expect(got.posterFreshScope).toBe(restore.posterFreshScope)
    const gotLand = (got.landscape ?? {}) as Record<string, unknown>
    const wantLand = restore.landscape as Record<string, unknown>
    expect(gotLand.posterLayout).toBe(wantLand.posterLayout)
    expect(gotLand.posterFreshScope).toBe(wantLand.posterFreshScope)
  })

  async function openRankingsTab(page: Page) {
    await page.goto("/")
    await page.getByRole("button", { name: /Impostazioni/i }).click()
    await page.getByRole("tab", { name: "Badge", exact: true }).click()
    const controls = page.getByTestId("settings-controls").filter({ visible: true })
    await expect(controls).toBeVisible()
    return controls
  }

  async function saveStaged(page: Page) {
    // Staged-session era: UI picks never PUT by themselves. The single
    // global Save persists the draft; the synced status proves the flush.
    await page.getByTestId("settings-save").click()
    await expect(page.getByTestId("settings-save-status")).toContainText(/Sincronizzato/i, {
      timeout: 15_000,
    })
  }

  async function portraitTarget(page: Page, formatTarget: ReturnType<Page["getByTestId"]>) {
    // Back to the portrait edit target when the Orizzontale/Verticale switch
    // exists (single-top-selector layouts); no-op otherwise.
    const portraitBtn = formatTarget.getByRole("button", { name: /Verticale|Portrait/i })
    if (await portraitBtn.count()) await portraitBtn.first().click()
  }

  test("unified Classifica; Card reveals skins in portrait and landscape", async ({ page }) => {
    const controls = await openRankingsTab(page)
    // The unified Classifica radiogroup exposes all five presentations with
    // exactly one checked (portrait default; which one depends on the
    // inherited style, so only exclusivity is pinned here).
    const group = controls.getByRole("radiogroup", { name: "Classifica" })
    await expect(group).toBeVisible()
    await group.scrollIntoViewIfNeeded()
    const presentations = ["Nastro", "Numero", "Badge", "Fresh", "Card"]
    await expect(group.getByRole("radio")).toHaveCount(5)
    for (const name of presentations) {
      await expect(group.getByRole("radio", { name, exact: true })).toBeVisible()
    }
    const checked = await group
      .getByRole("radio")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-checked")))
    expect(checked.filter((v) => v === "true")).toHaveLength(1)
    // Classic look: no Card skins subgroup (inert, stored value kept).
    await expect(controls.getByTestId("poster-layout-skins")).toHaveCount(0)

    // Picking Card reveals the skin subgroup with the three skins.
    await group.getByRole("radio", { name: "Card", exact: true }).click()
    const skins = controls.getByTestId("poster-layout-skins")
    await expect(skins).toBeVisible()
    for (const name of ["Colore provider", "Nero", "Viola vetro"]) {
      await expect(skins.getByRole("radio", { name, exact: true })).toBeVisible()
    }
    const skinChecked = await skins
      .getByRole("radio")
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-checked")))
    expect(skinChecked.filter((v) => v === "true")).toHaveLength(1)

    // Pick the Nuvio skin ("Nero" is its grouped-skin label), persist the
    // staged draft, and prove the server holds the Card while the landscape
    // profile stays Standard.
    await skins.getByRole("radio", { name: "Nero", exact: true }).click()

    // Landscape edit target keeps shape isolation (never follows the flat).
    // Strict shape independence: a PORTRAIT Card pick freezes the pre-edit
    // landscape look (previous STANDARD) into the profile instead of following
    // the flat — production must NOT be changed to follow the flat again. So
    // after the portrait Nuvio pick above, landscape is expected to stay
    // Standard (skins hidden); the Card skin is then selected EXPLICITLY in
    // the landscape target below.
    await saveStaged(page)
    const formatTarget = page
      .getByRole("dialog", { name: /Configura tutti i poster/i })
      .getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()
    const landscapeBtn = formatTarget.getByRole("button", { name: /Orizzontale|Landscape/i })
    if (await landscapeBtn.count()) {
      await landscapeBtn.first().click()
      // Independence boundary: portrait Nuvio must NOT leak into landscape.
      await expect(controls.getByTestId("poster-layout-skins")).toHaveCount(0)
      const landChecked = await group
        .getByRole("radio")
        .evaluateAll((els) => els.map((el) => el.getAttribute("aria-checked")))
      expect(landChecked.filter((v) => v === "true")).toHaveLength(1)
      // Backend shape isolation: flat holds the Card, the frozen profile holds
      // Standard with the shared scope value.
      await waitDefaults(
        page,
        (d) =>
          d.posterLayout === "nuvio" &&
          ((d.landscape ?? {}) as Record<string, unknown>).posterLayout === "standard",
      )
      const iso = await getDefaults(page)
      expect(iso.posterLayout).toBe("nuvio")
      expect(((iso.landscape ?? {}) as Record<string, unknown>).posterLayout).toBe("standard")

      // Explicit landscape Card pick: skins appear in landscape only.
      await group.getByRole("radio", { name: "Card", exact: true }).click()
      const landSkins = controls.getByTestId("poster-layout-skins")
      await expect(landSkins).toBeVisible()
      await landSkins.getByRole("radio", { name: "Nero", exact: true }).click()
      await saveStaged(page)
      await waitDefaults(
        page,
        (d) => ((d.landscape ?? {}) as Record<string, unknown>).posterLayout === "nuvio",
      )
      // Portrait stays put while landscape diverges (shape isolation).
      const portraitBtn = formatTarget.getByRole("button", { name: /Verticale|Portrait/i })
      if (await portraitBtn.count()) {
        await portraitBtn.first().click()
        await expect(controls.getByTestId("poster-layout-skins")).toBeVisible()
        await expect(skins.getByRole("radio", { name: "Nero", exact: true })).toHaveAttribute(
          "aria-checked",
          "true",
        )
        const back = await getDefaults(page)
        expect(back.posterLayout).toBe("nuvio")
        expect(((back.landscape ?? {}) as Record<string, unknown>).posterLayout).toBe("nuvio")
      }
    }

    // Restore a classic look: the skins subgroup hides again (no residue).
    await portraitTarget(page, formatTarget)
    await group.getByRole("radio", { name: "Nastro", exact: true }).click()
    await expect(controls.getByTestId("poster-layout-skins")).toHaveCount(0)
    await saveStaged(page)
  })
})
