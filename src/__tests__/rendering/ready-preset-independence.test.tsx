/**
 * Ready-preset independence: every ready look (Apple/BetterPoster/RPDB +
 * Essential/Ratings/Full) produces its own deterministic visual result
 * regardless of the previous preset — same own recipe, same real thumbnail,
 * same staged PUT — in both edited shapes.
 *
 * - Pairwise matrix: each of the six looks is applied from a rotated ready
 *   seed, a tuned mixed seed, a Fresh seed and a Card seed. All four stage
 *   the identical TARGET effective config/URL (other shape, rv ordering, API
 *   keys/user id excluded) with zero PUT/storage writes before the single
 *   global Save; repeated clicks are idempotent; the other shape stays
 *   effectively frozen (including a null landscape profile).
 * - Full follows the user recipe exactly: Nastro rank (`netflix` + ribbon,
 *   the `rankingAppearanceValue("nastro")` contract) + minimal genre badge,
 *   verified in the thumb URL, the staged preview, the Classifiche selector
 *   and the delivery PUT, both shapes.
 * - Personal presets are intentionally untouched by this task (verbatim
 *   semantics preserved); their capture/schema gaps are reported, not fixed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import {
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_VISUAL_DEFAULTS,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import {
  PRESET_FLAT_TO_LANDSCAPE,
  portraitPresetPatch,
  visualPresetValuesSchema,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import {
  QUICK_BADGE_PATCHES,
  quickLookDesired,
  quickTransformPatch,
  type QuickLookId,
} from "@/lib/quick-visual-presets"
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

beforeEach(() => {
  localStorage.clear()
  puts = []
  presetList = []
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
          ok: true,
          status: 200,
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

const READY_IDS = ["apple", "better-poster", "rpdb", "essential", "ratings", "full"] as const
type ReadyId = (typeof READY_IDS)[number]

const SHARED_PREFS = {
  defaultPosterShape: "poster",
  defaultRatingSources: ["imdb", "tmdb"],
}

function seedStorage(payload: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify({ ...SHARED_PREFS, ...payload }))
}

function seedReadySnapshot(values: VisualPresetValues) {
  const { landscape, ...flats } = values as unknown as Record<string, unknown>
  seedStorage({ ...flats, defaultPosterLayout: "standard", landscape: landscape ?? {} })
}

function seedQuickLook(id: QuickLookId) {
  seedStorage({
    ...QUICK_BADGE_PATCHES[id],
    ...quickTransformPatch(true),
    defaultPosterLayout: "standard",
    defaultAgeBadge: false,
    landscape: {},
  })
}

function seedTunedMixed() {
  seedStorage({
    defaultPosterLayout: "standard",
    defaultPosterFreshScope: "ranked",
    defaultGlobalBadges: true,
    defaultBadgeGenre: true,
    defaultBadgeYear: true,
    defaultBadgeRating: true,
    defaultBadgeQuality: true,
    defaultAgeBadge: true,
    defaultCustomRatings: false,
    defaultSeparateRatings: true,
    defaultSeparateRatingsStyle: "bottom-bar",
    defaultRankingBadges: true,
    defaultRankingBadgeStyle: "corner",
    defaultRibbonEnabled: true,
    defaultRibbonSide: "right",
    defaultSashOrder: ["extra"],
    defaultBadgeStyle: "bordo",
    defaultBadgeFont: "oswald",
    defaultQualityBadgeStyle: "color",
    defaultVideoFormats: ["dv"],
    defaultNetworkLogo: true,
    defaultNetworkLogoPosition: "top",
    defaultNetworkLogoFollowTitle: false,
    defaultNetworkLogoOffsetX: 7,
    defaultNetworkLogoOffsetY: -7,
    defaultGenreBadgeOffsetX: 9,
    defaultGenreBadgeOffsetY: -9,
    defaultPreRelease: true,
    defaultExtraBadgeStyle: "vetro",
    defaultTopBadgeScale: 140,
    landscape: {},
  })
}

function seedFresh() {
  seedStorage({
    defaultPosterLayout: "fresh",
    defaultPosterFreshScope: "ranked",
    defaultGlobalBadges: true,
    defaultBadgeGenre: true,
    defaultBadgeYear: true,
    defaultBadgeRating: true,
    defaultBadgeQuality: true,
    defaultAgeBadge: true,
    defaultCustomRatings: true,
    defaultSeparateRatings: false,
    defaultRankingBadges: true,
    defaultRankingBadgeStyle: "number",
    defaultRibbonEnabled: true,
    defaultSashOrder: ["upcoming", "rank", "new", "award", "extra"],
    defaultBadgeStyle: "pill",
    defaultBadgeFont: "barlow-condensed",
    defaultNetworkLogo: true,
    defaultGenreBadgeOffsetX: 0,
    defaultGenreBadgeOffsetY: 0,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    defaultExtraBadgeStyle: null,
    landscape: {},
  })
}

function seedCard() {
  seedStorage({
    defaultPosterLayout: "nuvio",
    defaultPosterFreshScope: "ranked",
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
    landscape: {},
  })
}

/** Rotated ready seed per target (pairwise: no look is ever seeded by itself). */
function seedRotatedReady(target: ReadyId) {
  if (target === "apple") return seedReadySnapshot(BETTER_POSTER_VISUAL_DEFAULTS)
  if (target === "better-poster") return seedReadySnapshot(RPDB_VISUAL_DEFAULTS)
  if (target === "rpdb") return seedQuickLook("full")
  if (target === "essential") return seedQuickLook("ratings")
  if (target === "ratings") return seedReadySnapshot(APPLE_VISUAL_DEFAULTS)
  return seedReadySnapshot(APPLE_VISUAL_DEFAULTS)
}

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
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

function readyThumb(id: ReadyId): string {
  const img = screen.getByTestId(`poster-style-${id}`).querySelector("img")
  expect(img, `real thumbnail for ready preset ${id}`).not.toBeNull()
  const src = img?.getAttribute("src") ?? ""
  expect(src).toContain("/api/poster/")
  return src
}

function thumbIdentity(src: string): string {
  const params = new URL(src, "http://localhost").searchParams
  params.delete("rv")
  // Vote sources ride along explicitly in preview URLs but are a preserved
  // seed-owned pref (asserted on the PUT body), not look recipe: two thumbs
  // with different sources share every visual param.
  params.delete("rsrc")
  return params.toString()
}

function snapshotIdentity(record: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) ordered[key] = record[key]
  return JSON.stringify(ordered)
}

/**
 * Identity-relevant PUT slice: the visual recipe only. Deliberately excluded
 * (preserved user prefs, asserted separately — never reset by ready looks):
 * - `landscape`: the other shape's frozen profile (per-seed by design);
 * - `ratingSources`: global vote-source selection (no profile key);
 * - fit flags: global logo-fit preferences (outside the preset contract).
 */
function recipeIdentity(body: Record<string, unknown>): string {
  const rest = { ...body }
  delete rest.landscape
  delete rest.ratingSources
  delete rest.defaultPortraitFitEnabled
  delete rest.defaultLandscapeFitEnabled
  return snapshotIdentity(rest)
}

/** Seed-owned prefs a ready apply must preserve verbatim (never reset). */
function seedOwnedPrefs(): { sources: unknown; portraitFit: unknown; landscapeFit: unknown } {
  const raw = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}") as Record<string, unknown>
  return {
    sources: raw.defaultRatingSources ?? raw.ratingSources ?? ["imdb", "tmdb"],
    portraitFit: typeof raw.defaultPortraitFitEnabled === "boolean" ? raw.defaultPortraitFitEnabled : true,
    landscapeFit: typeof raw.defaultLandscapeFitEnabled === "boolean" ? raw.defaultLandscapeFitEnabled : true,
  }
}

function openPresetTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
}

function openRankingsTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
}

function switchEditTargetToLandscape() {
  fireEvent.click(
    within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"),
  )
}

/** Signature pins proving each look staged its OWN recipe (not a rotation). */
const SIGNATURE_PINS: Record<ReadyId, Record<string, unknown>> = {
  apple: { rankingBadgeStyle: "number", ribbonEnabled: true, badgeStyle: "minimal" },
  "better-poster": { rankingBadgeStyle: "default", ribbonEnabled: false, badgeStyle: "minimal" },
  rpdb: { separateRatings: true, separateRatingsStyle: "bottom-bar", rankingBadges: false },
  essential: { badgeStyle: "minimal", badgeRating: false, badgeQuality: false, customRatings: false },
  ratings: { badgeStyle: "pill", badgeGenre: false, badgeRating: true, customRatings: true },
  full: { rankingBadgeStyle: "netflix", ribbonEnabled: true, badgeStyle: "minimal" },
}

describe("ready snapshots are complete (unit)", () => {
  it("Apple/BetterPoster/RPDB carry every preset-contract key", () => {
    for (const values of [APPLE_VISUAL_DEFAULTS, BETTER_POSTER_VISUAL_DEFAULTS, RPDB_VISUAL_DEFAULTS]) {
      for (const key of Object.keys(visualPresetValuesSchema.shape)) {
        expect(values as unknown as Record<string, unknown>, key).toHaveProperty(key)
      }
    }
  })

  it("quick looks project every mapped key (no silent inheritance)", () => {
    const mapped = Object.keys(PRESET_FLAT_TO_LANDSCAPE)
    for (const id of ["essential", "ratings", "full"] as const) {
      const projected = portraitPresetPatch(quickLookDesired(id, true)) as unknown as Record<string, unknown>
      for (const key of mapped) {
        expect(projected, `${id}.${key}`).not.toBeUndefined()
      }
    }
  })
})

describe.each(READY_IDS.map((id) => [id] as [ReadyId]))(
  "portrait: %s is independent of the previous look",
  (id) => {
    it(
      "rotated-ready, tuned, Fresh and Card seeds converge",
      // Bounded per-test budget only (assertions unchanged): ~1.5s isolated,
      // ~2.6s under 4-file contention, 5.3s in the full 534-file suite from
      // worker scheduling inflation with identical assertions. Missing-element
      // findBy* still rejects at ~1s, so real failures keep failing fast.
      { timeout: 10_000 },
      async () => {
      vi.useRealTimers()
      const seeds: Array<{ name: string; seed: () => void }> = [
        { name: "rotated-ready", seed: () => seedRotatedReady(id) },
        { name: "tuned-mixed", seed: seedTunedMixed },
        { name: "fresh", seed: seedFresh },
        { name: "card", seed: seedCard },
      ]
      const thumbs: string[] = []
      const bodies: string[] = []
      for (const { name, seed } of seeds) {
        localStorage.clear()
        puts = []
        seed()
        const owned = seedOwnedPrefs()
        const { unmount } = renderPanel()
        await screen.findByTestId(`poster-style-${id}`)
        thumbs.push(thumbIdentity(readyThumb(id)))
        expect(screen.getByTestId(`poster-style-${id}`), `no false highlight from ${name}`).toHaveAttribute(
          "aria-pressed",
          "false",
        )
        fireEvent.click(screen.getByTestId(`poster-style-${id}`))
        expect(screen.getByTestId(`poster-style-${id}`)).toHaveAttribute("aria-pressed", "true")
        // The canonical thumb is the look itself: stable across clicks.
        expect(thumbIdentity(readyThumb(id)), `thumb stable after ${name}`).toBe(thumbs[thumbs.length - 1])
        fireEvent.click(screen.getByTestId(`poster-style-${id}`))
        expect(thumbIdentity(readyThumb(id)), `thumb idempotent after ${name}`).toBe(thumbs[thumbs.length - 1])
        expect(puts, `no writes before Save (${name})`).toHaveLength(0)
        openPresetTab()
        fireEvent.click(screen.getByTestId("settings-save"))
        await screen.findByText("ui.synced")
        expect(puts, `single Save (${name})`).toHaveLength(1)
        bodies.push(recipeIdentity(puts[0].body))
        // Own recipe signature + shared ready discipline.
        expect(puts[0].body).toMatchObject(SIGNATURE_PINS[id])
        expect(puts[0].body).toMatchObject({ posterLayout: "standard", ageBadge: false })
        // Seed-owned prefs preserved verbatim, never reset by ready looks.
        expect(puts[0].body.ratingSources).toEqual(owned.sources)
        expect(puts[0].body.defaultPortraitFitEnabled).toBe(owned.portraitFit)
        expect(puts[0].body.defaultLandscapeFitEnabled).toBe(owned.landscapeFit)
        expect(screen.getByTestId("settings-save")).toBeDisabled()
        unmount()
        cleanup()
      }
      expect(new Set(thumbs).size, `${id} thumb identical from every seed`).toBe(1)
      expect(new Set(bodies).size, `${id} recipe identical from every seed`).toBe(1)
      },
    )
  },
)

describe("Full user recipe: Nastro + minimal, both shapes", () => {
  it("portrait Full thumb, selector, staged preview and PUT agree", async () => {
    vi.useRealTimers()
    seedCardTunedFallback()
    renderPanel()
    await screen.findByTestId("poster-style-full")
    const params = new URL(readyThumb("full"), "http://localhost").searchParams
    expect(params.get("rs")).toBe("netflix")
    expect(params.get("bs")).toBe("minimal")
    expect(params.get("layout")).toBe("standard")
    fireEvent.click(screen.getByTestId("poster-style-full"))
    // Staged preview keeps the canonical pair (never the Card look).
    const staged = new URL(readyThumb("full"), "http://localhost").searchParams
    expect(staged.get("rs")).toBe("netflix")
    expect(staged.get("bs")).toBe("minimal")
    // Unified Classifiche reads Nastro (own ranking mode, not Card/Numero).
    openRankingsTab()
    const group = within(screen.getByTestId("ranking-presentation")).getByRole("radiogroup", {
      name: "ui.rankFamily",
    })
    expect(within(group).getByRole("radio", { name: "ui.ribbon" })).toHaveAttribute("aria-checked", "true")
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toMatchObject({
      rankingBadgeStyle: "netflix",
      ribbonEnabled: true,
      badgeStyle: "minimal",
      posterLayout: "standard",
      ageBadge: false,
    })

    function seedCardTunedFallback() {
      seedCard()
    }
  })

  it("landscape Full converges from tuned and Fresh profiles, flats frozen", async () => {
    vi.useRealTimers()
    const lands: string[] = []
    const thumbs: string[] = []
    const seeds: Array<{ profile: Record<string, unknown>; flats: Record<string, unknown> }> = [
      {
        flats: { defaultBadgeFont: "oswald", defaultBadgeStyle: "colored" },
        profile: {
          badgeFont: "barlow-condensed",
          rankingBadgeStyle: "number",
          badgeStyle: "pill",
          posterLayout: "fresh",
          extraBadgeStyle: "vetro",
          networkLogoPosition: "top",
        },
      },
      {
        flats: { defaultBadgeFont: "inter", defaultBadgeStyle: "shadow" },
        profile: { posterLayout: "fresh", posterFreshScope: "ranked", rankingBadgeStyle: "number" },
      },
    ]
    for (const { profile, flats } of seeds) {
      localStorage.clear()
      puts = []
      seedStorage({ ...flats, landscape: profile })
      const { unmount } = renderPanel()
      await screen.findByTestId("poster-style-full")
      switchEditTargetToLandscape()
      await screen.findByTestId("poster-style-full")
      thumbs.push(thumbIdentity(readyThumb("full")))
      fireEvent.click(screen.getByTestId("poster-style-full"))
      expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
      expect(thumbIdentity(readyThumb("full"))).toBe(thumbs[thumbs.length - 1])
      expect(puts).toHaveLength(0)
      openPresetTab()
      fireEvent.click(screen.getByTestId("settings-save"))
      await screen.findByText("ui.synced")
      expect(puts).toHaveLength(1)
      const land = puts[0].body.landscape as Record<string, unknown>
      expect(land).toMatchObject({
        rankingBadgeStyle: "netflix",
        ribbonEnabled: true,
        badgeStyle: "minimal",
        posterLayout: "standard",
        extraBadgeStyle: "follow-rank",
        ageBadge: false,
      })
      expect(puts[0].body.badgeFont, "portrait flat frozen").toBe(flats.defaultBadgeFont)
      expect(puts[0].body.badgeStyle, "portrait flat frozen").toBe(flats.defaultBadgeStyle)
      // Fresh scope is inert under the Standard layout (and the staged
      // session only ever carries ranked-or-absent): excluded from the
      // identity, asserted effectively ranked instead.
      expect((land.posterFreshScope as string | undefined) ?? "ranked").toBe("ranked")
      const landRest = { ...land }
      delete landRest.posterFreshScope
      lands.push(snapshotIdentity(landRest))
      unmount()
      cleanup()
    }
    expect(new Set(thumbs).size).toBe(1)
    expect(new Set(lands).size).toBe(1)
  })
})
