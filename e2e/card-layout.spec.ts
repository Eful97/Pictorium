import { test, expect, type Page } from "@playwright/test"

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
  })

  async function openBadgeTab(page: Page) {
    await page.goto("/")
    await page.getByRole("button", { name: /Impostazioni/i }).click()
    await page.getByRole("tab", { name: "Badge", exact: true }).click()
    const controls = page.getByTestId("settings-controls").filter({ visible: true })
    await expect(controls).toBeVisible()
    return controls
  }

  test("five cover choices; Card reveals the apply scope in portrait and landscape", async ({ page }) => {
    const controls = await openBadgeTab(page)
    // The cover-layout radiogroup exposes all five choices (portrait default).
    const group = controls.getByRole("radiogroup", { name: "Layout copertina" })
    await expect(group).toBeVisible()
    await group.scrollIntoViewIfNeeded()
    for (const name of ["Standard", "Fresh", "Provider Glass", "Nuvio", "Stremio"]) {
      await expect(group.getByRole("radio", { name, exact: true })).toBeVisible()
    }
    // Standard: no apply-scope selector (inert, stored value kept).
    await expect(controls.getByTestId("fresh-scope-selector")).toHaveCount(0)

    // Picking a Card skin reveals the generic (non-Fresh) scope wording.
    await group.getByRole("radio", { name: "Nuvio", exact: true }).click()
    const scope = controls.getByTestId("fresh-scope-selector")
    await expect(scope).toBeVisible()
    await expect(scope.getByText("Applica layout", { exact: true })).toBeVisible()
    await expect(scope.getByTestId("fresh-scope-select")).toHaveValue("ranked")

    // Landscape edit target keeps the same scope contract (shared stored value).
    const formatTarget = page
      .getByRole("dialog", { name: /Configura tutti i poster/i })
      .getByTestId("format-target-selector")
    await expect(formatTarget).toBeVisible()
    const landscapeBtn = formatTarget.getByRole("button", { name: /Orizzontale|Landscape/i })
    if (await landscapeBtn.count()) {
      await landscapeBtn.first().click()
      await expect(controls.getByTestId("fresh-scope-selector")).toBeVisible()
      await expect(controls.getByTestId("fresh-scope-select")).toHaveValue("ranked")
      const portraitBtn = formatTarget.getByRole("button", { name: /Verticale|Portrait/i })
      if (await portraitBtn.count()) await portraitBtn.first().click()
    }

    // Restore Standard: the scope selector hides again (no residue).
    await group.getByRole("radio", { name: "Standard", exact: true }).click()
    await expect(controls.getByTestId("fresh-scope-selector")).toHaveCount(0)
  })
})
