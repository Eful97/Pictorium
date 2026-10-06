import { test, expect, type Page } from "@playwright/test"

// C2 — deterministic mid-tone accent coverage for the colored light-text
// preference (white at ~2.9:1 on #E67E22: dark text under the old 3:1 bar,
// preferred white under the 2:1 rule). The mocked artwork derives a dark
// accent, so the generic colored screenshots in pictorium-visual.spec.ts
// all render white text under both rules and cannot cover this flip — the
// explicit `ac` override (same contract as the teal test over there) pins
// it at the real endpoint, which is also what the editor preview <img>
// loads (preview=1, same URL Stremio uses).

const MOVIE_TMDB = 19995 // Avatar (id usato dai dati fittizi del mock server)
const POSTER_PATH = "/mocked/avatar.jpg"

function posterUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, poster: POSTER_PATH, preview: "1" })
  return `/api/poster/movie/${MOVIE_TMDB}?${qs.toString()}`
}

// Helper: render a poster URL in the page and return a locator for the <img>
async function renderPoster(page: Page, posterUrl: string) {
  await page.setViewportSize({ width: 1280, height: 1600 })
  await page.goto("/api/health")
  await page.setContent(`
    <html>
      <body style="margin:0;background:#000;display:flex;align-items:flex-start;justify-content:center;">
        <img id="poster" src="${posterUrl}" style="display:block;max-width:100%;height:auto;" />
      </body>
    </html>
  `)
  await page.waitForFunction(() => {
    const img = document.getElementById("poster") as HTMLImageElement
    return img && img.complete && img.naturalWidth > 0
  }, { timeout: 30_000 })
  return page.locator("#poster")
}

test("colored mid-tone accent — genre pill and rank ribbon render light text", async ({ page }) => {
  const url = posterUrl({
    genreName: "Action",
    voteAverage: "7.8",
    badges: "1",
    ranking: "1",
    rank: "3",
    label: "Top 3",
    bs: "colored",
    rs: "colored",
    ac: "#E67E22",
  })
  const poster = await renderPoster(page, url)
  await expect(poster).toHaveScreenshot("poster-colored-midtone-light-text.png", { maxDiffPixelRatio: 0.10 })
})
