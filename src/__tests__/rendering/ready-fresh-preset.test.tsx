/**
 * Ready Fresh preset (seventh gallery tile, ranked-only):
 * - Canonical source `FRESH_VISUAL_DEFAULTS` is byte-faithful to the
 *   user-supplied readonly export `C:\\Users\\lucaf\\Desktop\\fresh.json`
 *   (portrait flats + provided landscape profile) except the explicit
 *   `fresh`/`ranked` injection on both shapes, the missing-age canonical
 *   OFF/IT/standard fill and the extra-default normalization.
 * - Gallery (actual SettingsPanel staging session): the Fresh tile renders a
 *   real `/api/poster/` thumbnail with `layout=fresh&freshScope=ranked` and
 *   the user's own style/transforms; pointer + keyboard-focusable apply
 *   stages only (no PUT/storage before the single global Save); one Save
 *   persists a coherent body (edited shape fresh/ranked, other shape
 *   effective frozen, sources/fit/delivery preserved); repeats idempotent.
 * - The six existing looks keep owning Standard (Full stays Nastro+minimal);
 *   a stored personal Fresh snapshot round-trips and converges with the
 *   ready tile. Fresh stays ranked-only (no unranked semantic change).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { APPLE_VISUAL_DEFAULTS, BETTER_POSTER_VISUAL_DEFAULTS, FRESH_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import { quickLookDesired } from "@/lib/quick-visual-presets"
import { visualPresetValuesSchema } from "@/lib/visual-presets"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

let puts: { url: string; body: Record<string, unknown> }[]
let presetList: unknown[]
let putOk = true

beforeEach(() => {
  localStorage.clear()
  puts = []
  presetList = []
  putOk = true
  vi.clearAllMocks()
  resetGuestGuardForTests()
  __resetAdminTokenForTests()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return {
          ok: putOk,
          status: putOk ? 200 : 500,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => "{}",
        }
      }
      if (u.includes("/api/defaults/presets")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ presets: presetList }),
          text: async () => JSON.stringify({ presets: presetList }),
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "{}",
      }
    }),
  )
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderPanel() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const rendered = renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, {
        setSettingsOpen: () => {},
        exportData: () => {},
        importData: () => {},
      }),
      createElement(Probe),
    ),
  )
  // Fresh open lands on Preferenze (secondary): the gallery + format target
  // used below live on primary tabs.
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

function thumbParams(id: string): URLSearchParams {
  const btn = screen.getByTestId(`poster-style-${id}`)
  const img = btn.querySelector("img")
  expect(img, `real thumbnail for ${id}`).not.toBeNull()
  const src = img?.getAttribute("src") ?? ""
  expect(src).toContain("/api/poster/")
  return new URL(src, "http://localhost").searchParams
}

function openPresetTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
}

function switchEditTargetToLandscape() {
  fireEvent.click(
    within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"),
  )
}

describe("Fresh canonical source is faithful to the user export", () => {
  it("parses strictly and preserves every supplied value (explicit fresh/ranked + canonical age only)", () => {
    const parsed = visualPresetValuesSchema.parse(JSON.parse(JSON.stringify(FRESH_VISUAL_DEFAULTS)))
    const v = parsed as unknown as Record<string, unknown>
    // User recipe flats (verbatim from the export).
    expect(v.defaultGlobalBadges).toBe(true)
    expect(v.defaultRankingBadges).toBe(true)
    expect(v.defaultBadgeGenre).toBe(true)
    expect(v.defaultBadgeYear).toBe(false)
    expect(v.defaultBadgeRating).toBe(true)
    expect(v.defaultBadgeQuality).toBe(false)
    expect(v.defaultCustomRatings).toBe(false)
    expect(v.defaultSeparateRatings).toBe(false)
    expect(v.defaultBadgeStyle).toBe("minimal")
    expect(v.defaultRankingBadgeStyle).toBe("netflix")
    expect(v.defaultBadgeFont).toBe("inter")
    expect(v.defaultQualityBadgeStyle).toBe("knockout")
    expect(v.defaultLogoScale).toBeNull()
    expect(v.defaultLogoOffsetX).toBeNull()
    expect(v.defaultLogoOffsetY).toBeNull()
    expect(v.defaultGradientHeight).toBe(35)
    expect(v.defaultBlurIntensity).toBe(20)
    expect(v.defaultBlurFade).toBe(50)
    expect(v.defaultBlurDarkness).toBe(30)
    expect(v.defaultTintStrength).toBe(20)
    expect(v.defaultNetworkLogo).toBe(true)
    expect(v.defaultNetworkLogoPosition).toBe("auto")
    expect(v.defaultNetworkLogoFollowTitle).toBe(true)
    expect(v.defaultPreRelease).toBe(true)
    expect(v.defaultRibbonEnabled).toBe(true)
    expect(v.defaultRibbonSide).toBe("left")
    expect(v.defaultRatingSources).toEqual([
      "imdb", "tmdb", "mdblist", "tomatoes", "popcorntime", "letterboxd",
      "metacritic", "metacriticuser", "trakt", "simkl", "filmweb",
      "filmwebcritics", "rogerebert", "mal", "anilist", "kitsu",
    ])
    expect(v.defaultSashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    expect(v.defaultVideoFormats).toEqual(["dv", "atmos", "imax", "hdr", "hdr10plus"])
    // Explicit injection (the export predates these keys).
    expect(v.defaultPosterLayout).toBe("fresh")
    expect(v.defaultPosterFreshScope).toBe("ranked")
    // Missing-age canonical fill (IT standard, never a live override).
    expect(v.defaultAgeBadge).toBe(false)
    expect(v.defaultAgeCountry).toBe("IT")
    expect(v.defaultAgeBadgeStyle).toBe("standard")
    expect(v.defaultExtraBadgeStyle).toBeNull()
    // Provided landscape profile keeps its OWN numbers/styles (never a copy).
    const land = v.landscape as Record<string, unknown>
    expect(land.gradientHeight).toBe(50)
    expect(land.blurIntensity).toBe(1)
    expect(land.blurFade).toBe(100)
    expect(land.blurDarkness).toBe(100)
    expect(land.tintStrength).toBe(0)
    expect(land.rankingBadgeStyle).toBe("number")
    expect(land.qualityBadgeStyle).toBe("color")
    expect(land.extraBadgeStyle).toBe("follow-rank")
    expect(land.posterLayout).toBe("fresh")
    expect(land.posterFreshScope).toBe("ranked")
    expect(land.badgeStyle).toBe("minimal")
  })
})

describe("Fresh gallery tile (actual SettingsPanel)", () => {
  it("portrait: real fresh thumb with own style/transforms; staged-only apply; one Save", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        defaultRatingSources: ["imdb", "tmdb"],
        defaultBadgeStyle: "colored",
        defaultRankingBadgeStyle: "default",
        defaultGenreBadgeOffsetY: -40,
        defaultLogoOffsetY: -40,
        landscape: {},
      }),
    )
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-fresh")
    // Seventh tile exists alongside the six Standard looks.
    for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]) {
      await screen.findByTestId(`poster-style-${id}`)
      expect(thumbParams(id).get("layout")).toBe("standard")
    }
    const fresh = thumbParams("fresh")
    expect(fresh.get("layout")).toBe("fresh")
    expect(fresh.get("freshScope")).toBe("ranked")
    expect(fresh.get("bs")).toBe("minimal")
    expect(fresh.get("rs")).toBe("netflix")
    expect(fresh.get("age")).toBe("0")
    expect(ctx().defaultPosterLayout).toBe("standard")
    // No false highlight before apply.
    expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "false")
    // Pointer apply (button is natively keyboard-focusable too).
    const btn = screen.getByTestId("poster-style-fresh")
    btn.focus()
    expect(document.activeElement).toBe(btn)
    fireEvent.click(btn)
    expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "true")
    // Standard tiles no longer claim the Fresh draft (and vice versa).
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "false")
    expect(puts).toHaveLength(0)
    // Idempotent reclick keeps the same thumb.
    const before = thumbParams("fresh").toString()
    fireEvent.click(screen.getByTestId("poster-style-fresh"))
    expect(thumbParams("fresh").toString()).toBe(before)
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    expect(body).toMatchObject({
      posterLayout: "fresh",
      posterFreshScope: "ranked",
      rankingBadgeStyle: "netflix",
      ribbonEnabled: true,
      badgeStyle: "minimal",
      badgeFont: "inter",
      qualityBadgeStyle: "knockout",
      ageBadge: false,
      extraBadgeStyle: null,
      gradientHeight: 35,
      genreBadgeOffsetX: 0,
      genreBadgeOffsetY: 0,
      logoOffsetX: null,
      logoOffsetY: null,
    })
    // Sources/fit/delivery preserved (never reset by the look).
    expect(body.ratingSources).toEqual(["imdb", "tmdb"])
    expect(body.posterShape).toBe("poster")
  })

  it("landscape: own profile numbers, portrait flats frozen, one Save", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        defaultBadgeFont: "oswald",
        defaultBadgeStyle: "colored",
        landscape: { posterLayout: "standard", badgeStyle: "pill", rankingBadgeStyle: "default" },
      }),
    )
    renderPanel()
    await screen.findByTestId("poster-style-fresh")
    switchEditTargetToLandscape()
    await screen.findByTestId("poster-style-fresh")
    const fresh = thumbParams("fresh")
    expect(fresh.get("layout")).toBe("fresh")
    expect(fresh.get("freshScope")).toBe("ranked")
    fireEvent.click(screen.getByTestId("poster-style-fresh"))
    expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    const land = body.landscape as Record<string, unknown>
    expect(land).toMatchObject({
      posterLayout: "fresh",
      posterFreshScope: "ranked",
      rankingBadgeStyle: "number",
      qualityBadgeStyle: "color",
      extraBadgeStyle: "follow-rank",
      badgeStyle: "minimal",
      ageBadge: false,
    })
    // Portrait flats stay byte-identical (other shape frozen).
    expect(body.badgeFont).toBe("oswald")
    expect(body.badgeStyle).toBe("colored")
  })

  it("failed Save keeps the staged Fresh draft with no extra writes", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "standard", landscape: {} }),
    )
    renderPanel()
    await screen.findByTestId("poster-style-fresh")
    fireEvent.click(screen.getByTestId("poster-style-fresh"))
    expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "true")
    putOk = false
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(1)
  })

  it("personal stored Fresh round-trips and converges with the ready tile", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "standard", landscape: {} }),
    )
    presetList = [
      {
        id: "00000000-0000-0000-0000-000000000007",
        name: "MyFresh",
        shape: "portrait",
        values: FRESH_VISUAL_DEFAULTS,
      },
    ]
    renderPanel()
    await screen.findByTestId("poster-style-fresh")
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    const mine = await screen.findByTestId("visual-preset-00000000-0000-0000-0000-000000000007")
    const mineThumb = mine.querySelector("img")?.getAttribute("src") ?? ""
    expect(new URL(mineThumb, "http://localhost").searchParams.get("layout")).toBe("fresh")
    fireEvent.click(mine)
    expect(mine).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(0)
  })
})

/**
 * Fresh apply is independent of the previous look (actual SettingsPanel):
 * Apple / BetterPoster / Full / Card / Fresh-tuned priors converge to the
 * same own Fresh recipe in both edited shapes. The Fresh thumbnail is stable
 * (identical from every prior, idempotent reclick), apply stages only (no
 * PUT, no badgeDefaults storage write before the single global Save), the
 * other shape stays effectively frozen (including absent/null scope and
 * profile-extra priors) and seed-owned prefs (sources/shape/fit) are
 * preserved verbatim. Kept small on purpose: source-constant fidelity is
 * covered by the canonical-source suite above, not repeated here.
 */
describe("Fresh apply is independent of the previous look", () => {
  function thumbIdentity(src: string): string {
    const params = new URL(src, "http://localhost").searchParams
    params.delete("rv")
    params.delete("rsrc")
    return params.toString()
  }

  function snapshotIdentity(record: Record<string, unknown>): string {
    const ordered: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) ordered[key] = record[key]
    return JSON.stringify(ordered)
  }

  function recipeIdentity(body: Record<string, unknown>): string {
    const rest = { ...body }
    delete rest.landscape
    delete rest.ratingSources
    delete rest.defaultPortraitFitEnabled
    delete rest.defaultLandscapeFitEnabled
    return snapshotIdentity(rest)
  }

  function seedApplePrior() {
    const appleFlats = { ...(APPLE_VISUAL_DEFAULTS as unknown as Record<string, unknown>) };
    delete appleFlats.landscape;
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        ...appleFlats,
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        defaultRatingSources: ["imdb", "tmdb"],
        defaultPortraitFitEnabled: false,
        defaultLandscapeFitEnabled: true,
        landscape: {},
      }),
    )
  }

  function seedBetterPosterPrior() {
    const betterFlats = { ...(BETTER_POSTER_VISUAL_DEFAULTS as unknown as Record<string, unknown>) };
    delete betterFlats.landscape;
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        ...betterFlats,
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        defaultRatingSources: ["imdb", "tmdb"],
        defaultPortraitFitEnabled: false,
        defaultLandscapeFitEnabled: true,
        // Null profile extra (explicit shape-local choice, never inherited).
        landscape: { extraBadgeStyle: null },
      }),
    )
  }

  function seedFullPrior() {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        ...(quickLookDesired("full", true) as unknown as Record<string, unknown>),
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        defaultAgeBadge: true,
        defaultRatingSources: ["imdb", "tmdb"],
        defaultPortraitFitEnabled: false,
        defaultLandscapeFitEnabled: true,
        landscape: {},
      }),
    )
  }

  function seedCardPrior() {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "nuvio",
        defaultPosterFreshScope: "all",
        defaultGlobalBadges: true,
        defaultBadgeGenre: true,
        defaultBadgeYear: true,
        defaultBadgeRating: true,
        defaultBadgeQuality: false,
        defaultAgeBadge: true,
        defaultCustomRatings: false,
        defaultSeparateRatings: true,
        defaultSeparateRatingsStyle: "bottom-pills",
        defaultRankingBadges: true,
        defaultRankingBadgeStyle: "netflix",
        defaultRibbonEnabled: true,
        defaultRibbonSide: "right",
        defaultSashOrder: ["extra", "new"],
        defaultBadgeStyle: "colored",
        defaultBadgeFont: "oswald",
        defaultQualityBadgeStyle: "color",
        defaultVideoFormats: ["hdr", "imax"],
        defaultNetworkLogo: true,
        defaultNetworkLogoPosition: "top",
        defaultNetworkLogoFollowTitle: false,
        defaultPreRelease: true,
        defaultExtraBadgeStyle: "corner",
        defaultRatingSources: ["imdb", "tmdb"],
        defaultPortraitFitEnabled: false,
        defaultLandscapeFitEnabled: true,
        // Explicit profile mode + scope + extra (untouched other shape).
        landscape: { posterLayout: "nuvio", posterFreshScope: "all", extraBadgeStyle: "corner" },
      }),
    )
  }

  function seedFreshTunedPrior() {
    const freshFlats = { ...(FRESH_VISUAL_DEFAULTS as unknown as Record<string, unknown>) };
    delete freshFlats.landscape;
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        ...freshFlats,
        defaultPosterShape: "poster",
        defaultPosterLayout: "fresh",
        defaultPosterFreshScope: "ranked",
        defaultBadgeStyle: "pill",
        defaultBadgeFont: "oswald",
        defaultAgeBadge: true,
        defaultExtraBadgeStyle: null,
        defaultRatingSources: ["imdb", "tmdb"],
        defaultPortraitFitEnabled: false,
        defaultLandscapeFitEnabled: true,
        // Deliberately NO landscape key (absent profile).
      }),
    )
  }

  const PRIORS: Array<{ name: string; seed: () => void }> = [
    { name: "apple", seed: seedApplePrior },
    { name: "better-poster", seed: seedBetterPosterPrior },
    { name: "full", seed: seedFullPrior },
    { name: "card", seed: seedCardPrior },
    { name: "fresh-tuned", seed: seedFreshTunedPrior },
  ]

  it("portrait: every prior converges to the own Fresh recipe, other shape frozen",
    // Bounded per-test budget only (assertions unchanged): ~2.3s under
    // 2-file contention, past the 5s default in the full 534-file suite
    // from worker scheduling inflation with identical assertions (5
    // sequential full SettingsPanel mounts). Missing-element findBy*
    // still rejects at ~1s, so real failures keep failing fast.
    { timeout: 10_000 },
    async () => {
      vi.useRealTimers()
      const thumbs: string[] = []
      const recipes: string[] = []
      for (const { name, seed } of PRIORS) {
        localStorage.clear()
        puts = []
        seed()
        const beforeStorage = localStorage.getItem("badgeDefaults")
        const seedRaw = JSON.parse(beforeStorage ?? "{}") as Record<string, unknown>
        const { unmount } = renderPanel()
        await screen.findByTestId("poster-style-fresh")
        // Mount normalizes the stored payload into canonical shape; the apply
        // itself must not persist anything further before the global Save.
        const stagedStorage = localStorage.getItem("badgeDefaults")
        thumbs.push(thumbIdentity(thumbParams("fresh").toString()))
        expect(screen.getByTestId("poster-style-fresh"), `no false highlight from ${name}`).toHaveAttribute(
          "aria-pressed",
          "false",
        )
        fireEvent.click(screen.getByTestId("poster-style-fresh"))
        expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "true")
        expect(thumbIdentity(thumbParams("fresh").toString()), `thumb stable after ${name}`).toBe(
          thumbs[thumbs.length - 1],
        )
        expect(puts, `no PUT before Save (${name})`).toHaveLength(0)
        expect(localStorage.getItem("badgeDefaults"), `no storage persist before Save (${name})`).toBe(stagedStorage)
        openPresetTab()
        fireEvent.click(screen.getByTestId("settings-save"))
        await screen.findByText("ui.synced")
        expect(puts, `single Save (${name})`).toHaveLength(1)
        const body = puts[0].body
        recipes.push(recipeIdentity(body))
        expect(body).toMatchObject({
          posterLayout: "fresh",
          posterFreshScope: "ranked",
          rankingBadgeStyle: "netflix",
          badgeStyle: "minimal",
          qualityBadgeStyle: "knockout",
          ageBadge: false,
          extraBadgeStyle: null,
        })
        expect(body.ratingSources).toEqual(["imdb", "tmdb"])
        expect(body.posterShape).toBe("poster")
        expect(body.defaultPortraitFitEnabled).toBe(false)
        expect(body.defaultLandscapeFitEnabled).toBe(true)
        // Other shape frozen: the profile keeps the prior effective layout
        // (absent/null scope never follows Fresh; explicit Card keeps nuvio).
        const land = (body.landscape ?? {}) as Record<string, unknown>
        expect(land.posterLayout, `other shape frozen (${name})`).toBe(seedRaw.defaultPosterLayout)
        if (name === "card") {
          expect(land.extraBadgeStyle, "explicit profile extra preserved").toBe("corner")
        }
        unmount()
        cleanup()
      }
      expect(new Set(thumbs).size, "fresh thumb identical from every prior").toBe(1)
      expect(new Set(recipes).size, "fresh portrait recipe identical from every prior").toBe(1)
    },
  )

  it("landscape: every prior converges to the own Fresh profile, portrait flats frozen",
    // Bounded per-test budget only (assertions unchanged): ~2.4s under
    // 2-file contention, past the 5s default in the full 534-file suite
    // from worker scheduling inflation with identical assertions (5
    // sequential full SettingsPanel mounts). Missing-element findBy*
    // still rejects at ~1s, so real failures keep failing fast.
    { timeout: 10_000 },
    async () => {
      vi.useRealTimers()
      const thumbs: string[] = []
      const profiles: string[] = []
      for (const { name, seed } of PRIORS) {
        localStorage.clear()
        puts = []
        seed()
        const beforeStorage = localStorage.getItem("badgeDefaults")
        const seedRaw = JSON.parse(beforeStorage ?? "{}") as Record<string, unknown>
        const { unmount } = renderPanel()
        await screen.findByTestId("poster-style-fresh")
        switchEditTargetToLandscape()
        await screen.findByTestId("poster-style-fresh")
        // Mount normalizes the stored payload into canonical shape; the apply
        // itself must not persist anything further before the global Save.
        const stagedStorage = localStorage.getItem("badgeDefaults")
        thumbs.push(thumbIdentity(thumbParams("fresh").toString()))
        fireEvent.click(screen.getByTestId("poster-style-fresh"))
        expect(screen.getByTestId("poster-style-fresh")).toHaveAttribute("aria-pressed", "true")
        expect(thumbIdentity(thumbParams("fresh").toString()), `thumb stable after ${name}`).toBe(
          thumbs[thumbs.length - 1],
        )
        expect(puts, `no PUT before Save (${name})`).toHaveLength(0)
        expect(localStorage.getItem("badgeDefaults"), `no storage persist before Save (${name})`).toBe(stagedStorage)
        openPresetTab()
        fireEvent.click(screen.getByTestId("settings-save"))
        await screen.findByText("ui.synced")
        expect(puts, `single Save (${name})`).toHaveLength(1)
        const body = puts[0].body
        const land = body.landscape as Record<string, unknown>
        expect(land).toMatchObject({
          posterLayout: "fresh",
          posterFreshScope: "ranked",
          rankingBadgeStyle: "number",
          qualityBadgeStyle: "color",
          extraBadgeStyle: "follow-rank",
          badgeStyle: "minimal",
          ageBadge: false,
        })
        profiles.push(
          snapshotIdentity({
            posterLayout: land.posterLayout,
            posterFreshScope: land.posterFreshScope,
            rankingBadgeStyle: land.rankingBadgeStyle,
            qualityBadgeStyle: land.qualityBadgeStyle,
            extraBadgeStyle: land.extraBadgeStyle,
            badgeStyle: land.badgeStyle,
            ageBadge: land.ageBadge,
          }),
        )
        // Portrait flats frozen (seed-owned, never the Fresh look).
        expect(body.badgeFont, `portrait flat frozen (${name})`).toBe(seedRaw.defaultBadgeFont)
        expect(body.badgeStyle, `portrait flat frozen (${name})`).toBe(seedRaw.defaultBadgeStyle)
        expect(body.ratingSources).toEqual(["imdb", "tmdb"])
        expect(body.posterShape).toBe("poster")
        unmount()
        cleanup()
      }
      expect(new Set(thumbs).size, "fresh landscape thumb identical from every prior").toBe(1)
      expect(new Set(profiles).size, "fresh landscape profile identical from every prior").toBe(1)
    },
  )
})
