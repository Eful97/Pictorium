/**
 * Full/Completo owns a deterministic complete visual recipe (never inherits
 * the previous look): Apple/BetterPoster/Fresh/Card-tuned seeds all stage the
 * identical TARGET effective config and the identical real Full thumbnail
 * (actual DefaultsPosterPreview endpoint builder, never a fake render).
 *
 * - Portrait + landscape: Apple->Full, BetterPoster->Full, Fresh->Full and
 *   Card/tuned->Full yield the identical target URL (ignoring the other
 *   shape, rv ordering, API keys/user id) and the same Full thumb (stable
 *   before the click across seeds, unchanged by the click itself).
 * - Staged discipline: no PUT/storage write before the single global Save;
 *   one Save persists a coherent PUT (edited shape canonical, other shape
 *   effective frozen); failure keeps the draft; repeated clicks idempotent.
 * - Highlight is the true canonical render, not a subset: a tuned seed with
 *   matching toggles but a non-canonical ribbon/font never claims Full.
 * - Both Full entry points (Preset-tab gallery and the legacy standalone
 *   BadgeDefaultsSection path) stage the same canonical recipe; personal
 *   presets, Essential/Ratings and Apple/BetterPoster/RPDB are unaffected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import { DEFAULT_BADGE_FONT, DEFAULT_QUALITY_BADGE_STYLE, DEFAULT_SEPARATE_RATINGS_STYLE } from "@/lib/badge-styles"
import { KNOWN_VIDEO_FORMATS } from "@/lib/av-specs"
import { QUICK_BADGE_PATCHES, isFullQuickLook, quickLookDesired, withReadyPresetExtraStyleReset } from "@/lib/quick-visual-presets"
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

const FULL_VIDEO = [...KNOWN_VIDEO_FORMATS]
const FULL_SASH = [...DEFAULT_SASH_ORDER]

/** Non-visual prefs shared by every seed (never part of the Full recipe). */
const SHARED_PREFS = {
  defaultPosterShape: "poster",
  defaultRatingSources: ["imdb", "tmdb"],
  landscape: {},
}

function seedAppleLike() {
  localStorage.setItem(
    "badgeDefaults",
    JSON.stringify({
      ...SHARED_PREFS,
      defaultGlobalBadges: true,
      defaultBadgeGenre: true,
      defaultBadgeYear: false,
      defaultBadgeRating: true,
      defaultBadgeQuality: false,
      defaultCustomRatings: false,
      defaultSeparateRatings: false,
      defaultRankingBadges: true,
      defaultRankingBadgeStyle: "number",
      defaultRibbonEnabled: true,
      defaultRibbonSide: "left",
      defaultSashOrder: [...DEFAULT_SASH_ORDER],
      defaultBadgeStyle: "minimal",
      defaultBadgeFont: "inter",
      defaultQualityBadgeStyle: "knockout",
      defaultVideoFormats: [...KNOWN_VIDEO_FORMATS],
      defaultNetworkLogo: true,
      defaultNetworkLogoPosition: "auto",
      defaultGenreBadgeOffsetY: -40,
      defaultLogoOffsetY: -40,
      defaultPreRelease: true,
      defaultExtraBadgeStyle: "vetro",
      landscape: {},
    }),
  )
}

function seedBetterPosterLike() {
  localStorage.setItem(
    "badgeDefaults",
    JSON.stringify({
      ...SHARED_PREFS,
      defaultGlobalBadges: true,
      defaultBadgeGenre: true,
      defaultBadgeYear: false,
      defaultBadgeRating: true,
      defaultBadgeQuality: false,
      defaultCustomRatings: false,
      defaultSeparateRatings: false,
      defaultRankingBadges: true,
      defaultRankingBadgeStyle: "default",
      defaultRibbonEnabled: false,
      defaultSashOrder: [],
      defaultBadgeStyle: "shadow",
      defaultBadgeFont: "oswald",
      defaultQualityBadgeStyle: "color",
      defaultVideoFormats: ["dv"],
      defaultNetworkLogo: false,
      defaultNetworkLogoPosition: "top",
      defaultNetworkLogoFollowTitle: false,
      defaultNetworkLogoOffsetX: 5,
      defaultNetworkLogoOffsetY: 6,
      defaultGenreBadgeScale: 120,
      defaultPreRelease: false,
      defaultExtraBadgeStyle: "pill",
      landscape: {},
    }),
  )
}

function seedFresh() {
  localStorage.setItem(
    "badgeDefaults",
    JSON.stringify({
      ...SHARED_PREFS,
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "ranked",
      defaultGlobalBadges: true,
      defaultBadgeGenre: true,
      defaultBadgeYear: true,
      defaultBadgeRating: true,
      defaultBadgeQuality: true,
      defaultCustomRatings: true,
      defaultSeparateRatings: true,
      defaultSeparateRatingsStyle: "bottom-bar",
      defaultRankingBadges: true,
      defaultRankingBadgeStyle: "number",
      defaultRibbonEnabled: true,
      defaultSashOrder: ["rank"],
      defaultBadgeStyle: "pill",
      defaultBadgeFont: "barlow-condensed",
      defaultQualityBadgeStyle: "standard",
      defaultVideoFormats: [],
      defaultNetworkLogo: true,
      defaultNetworkLogoPosition: "top",
      defaultNetworkLogoFollowTitle: false,
      defaultGenreBadgeOffsetX: 0,
      defaultGenreBadgeOffsetY: 0,
      defaultLogoOffsetX: null,
      defaultLogoOffsetY: null,
      defaultExtraBadgeStyle: null,
      landscape: {},
    }),
  )
}

function seedCardTuned() {
  localStorage.setItem(
    "badgeDefaults",
    JSON.stringify({
      ...SHARED_PREFS,
      defaultPosterLayout: "nuvio",
      defaultPosterFreshScope: "ranked",
      defaultGlobalBadges: true,
      defaultBadgeGenre: true,
      defaultBadgeYear: true,
      defaultBadgeRating: true,
      defaultBadgeQuality: false,
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
      defaultGenreBadgeOffsetX: 12,
      defaultGenreBadgeOffsetY: -8,
      defaultLogoScale: 80,
      defaultPreRelease: true,
      defaultExtraBadgeStyle: "corner",
      landscape: {},
    }),
  )
}

const PORTRAIT_SEEDS: Array<{ name: string; seed: () => void }> = [
  { name: "apple-like", seed: seedAppleLike },
  { name: "better-poster-like", seed: seedBetterPosterLike },
  { name: "fresh", seed: seedFresh },
  { name: "card-tuned", seed: seedCardTuned },
]

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

function fullThumb(): string {
  const btn = screen.getByTestId("poster-style-full")
  const img = btn.querySelector("img")
  expect(img, "real Full thumbnail").not.toBeNull()
  const src = img?.getAttribute("src") ?? ""
  expect(src).toContain("/api/poster/")
  return src
}

/** Comparable thumb identity: the real URL minus render-version ordering. */
function thumbIdentity(src: string): string {
  const params = new URL(src, "http://localhost").searchParams
  params.delete("rv")
  return params.toString()
}

/**
 * Order-insensitive snapshot identity (profiles keep insertion order from
 * their seed; only the effective content matters — same rationale as
 * normalizePresetExtraTuning's canonical key order in production).
 */
function snapshotIdentity(record: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) ordered[key] = record[key]
  return JSON.stringify(ordered)
}

function openPresetTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
}

function switchEditTargetToLandscape() {
  fireEvent.click(
    within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"),
  )
}

describe("Full recipe is a complete canonical constant (unit)", () => {
  it("pins every appearance key that changes Full pixels, preserves the rest", () => {
    const patch = QUICK_BADGE_PATCHES.full
    expect(patch).toMatchObject({
      defaultGlobalBadges: true,
      defaultBadgeGenre: true,
      defaultBadgeYear: true,
      defaultBadgeRating: true,
      defaultBadgeQuality: true,
      defaultCustomRatings: true,
      defaultSeparateRatings: false,
      defaultSeparateRatingsStyle: DEFAULT_SEPARATE_RATINGS_STYLE,
      defaultRankingBadges: true,
      // User recipe: Nastro rank + minimal genre badge (exact selector
      // contract: `rankingAppearanceValue("nastro")` + minimal `bs`).
      defaultRankingBadgeStyle: "netflix",
      defaultRibbonEnabled: true,
      defaultRibbonSide: "left",
      defaultBadgeStyle: "minimal",
      defaultBadgeFont: DEFAULT_BADGE_FONT,
      defaultQualityBadgeStyle: DEFAULT_QUALITY_BADGE_STYLE,
      defaultNetworkLogo: true,
      defaultNetworkLogoPosition: "auto",
      defaultNetworkLogoFollowTitle: true,
      defaultPreRelease: false,
    })
    expect(patch.defaultSashOrder).toEqual(FULL_SASH)
    expect(patch.defaultVideoFormats).toEqual(FULL_VIDEO)
    // Intentional user prefs stay out of the recipe (never reset by Full).
    expect(patch).not.toHaveProperty("defaultRatingSources")
    expect(patch).not.toHaveProperty("defaultPosterShape")
    expect(patch).not.toHaveProperty("defaultLogoAlign")
    expect(patch).not.toHaveProperty("defaultExtraBadgeStyle")
    expect(isFullQuickLook("full")).toBe(true)
    expect(isFullQuickLook("essential")).toBe(false)
    expect(isFullQuickLook("ratings")).toBe(false)
  })

  it("extra-style reset is Full-only, shape-aware and pure", () => {
    // Inheriting landscape (absent) freezes the pre-edit live flat verbatim.
    const snapAbsent = { defaultExtraBadgeStyle: "colored", landscape: { badgeStyle: "pill" } }
    const liveAbsent = { defaultExtraBadgeStyle: "colored", landscape: { badgeStyle: "pill" } }
    const portraitAbsent = withReadyPresetExtraStyleReset({ ...snapAbsent, landscape: { ...snapAbsent.landscape } }, "portrait", liveAbsent)
    expect(portraitAbsent.defaultExtraBadgeStyle).toBeNull()
    expect(portraitAbsent.landscape).toEqual({ badgeStyle: "pill", extraBadgeStyle: "colored" })
    // Legacy null profile is inheriting too: freezes the live flat as well.
    const snapNull = { defaultExtraBadgeStyle: "colored", landscape: { badgeStyle: "pill", extraBadgeStyle: null } }
    const portraitNull = withReadyPresetExtraStyleReset(
      { ...snapNull, landscape: { ...snapNull.landscape } },
      "portrait",
      { defaultExtraBadgeStyle: "colored", landscape: { badgeStyle: "pill", extraBadgeStyle: null } },
    )
    expect(portraitNull.landscape).toEqual({ badgeStyle: "pill", extraBadgeStyle: "colored" })
    // Explicit other-shape values (concrete or follow-rank) stay untouched.
    const snapExplicit = { defaultExtraBadgeStyle: "colored", landscape: { extraBadgeStyle: "pill" } }
    expect(
      withReadyPresetExtraStyleReset({ ...snapExplicit, landscape: { ...snapExplicit.landscape } }, "portrait", liveAbsent).landscape,
    ).toEqual({ extraBadgeStyle: "pill" })
    const snapSentinel = { defaultExtraBadgeStyle: "colored", landscape: { extraBadgeStyle: "follow-rank" } }
    expect(
      withReadyPresetExtraStyleReset({ ...snapSentinel, landscape: { ...snapSentinel.landscape } }, "portrait", liveAbsent).landscape,
    ).toEqual({ extraBadgeStyle: "follow-rank" })
    // Legacy live flat freezes the explicit follow-rank marker (own rank).
    const snapLegacy = { landscape: { badgeStyle: "pill" } }
    expect(
      withReadyPresetExtraStyleReset({ ...snapLegacy, landscape: { ...snapLegacy.landscape } }, "portrait", { landscape: {} }).landscape,
    ).toEqual({ badgeStyle: "pill", extraBadgeStyle: "follow-rank" })
    const before = { a: 1, landscape: { badgeStyle: "pill" } }
    const landscape = withReadyPresetExtraStyleReset({ ...before }, "landscape")
    expect(landscape).not.toHaveProperty("defaultExtraBadgeStyle")
    expect(landscape.landscape).toMatchObject({ badgeStyle: "pill", extraBadgeStyle: "follow-rank" })
    expect(before).toEqual({ a: 1, landscape: { badgeStyle: "pill" } })
    expect(snapAbsent).toEqual({ defaultExtraBadgeStyle: "colored", landscape: { badgeStyle: "pill" } })
  })
})

describe("portrait: every seed stages the identical Full look", () => {
  it.each(PORTRAIT_SEEDS.map((s) => [s.name] as [string]))("%s -> Full: same thumb, staged pins, single save", async (name) => {
    vi.useRealTimers()
    PORTRAIT_SEEDS.find((s) => s.name === name)!.seed()
    renderPanel()
    await screen.findByTestId("poster-style-full")
    const thumbBefore = thumbIdentity(fullThumb())
    // A tuned seed never claims Full before the click (subset is not enough).
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(screen.getByTestId("poster-style-full"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
    // The Full thumb is the canonical look itself: the click cannot move it.
    expect(thumbIdentity(fullThumb())).toBe(thumbBefore)
    // Repeated clicks are idempotent: still staged, still no writes.
    fireEvent.click(screen.getByTestId("poster-style-full"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
    expect(thumbIdentity(fullThumb())).toBe(thumbBefore)
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    expect(body).toMatchObject({
      globalBadges: true,
      badgeGenre: true,
      badgeYear: true,
      badgeRating: true,
      badgeQuality: true,
      customRatings: true,
      separateRatings: false,
      separateRatingsStyle: "column",
      rankingBadges: true,
      rankingBadgeStyle: "netflix",
      ribbonEnabled: true,
      ribbonSide: "left",
      badgeStyle: "minimal",
      badgeFont: "inter",
      qualityBadgeStyle: "standard",
      networkLogo: true,
      networkLogoPosition: "auto",
      networkLogoFollowTitle: true,
      preRelease: false,
      posterLayout: "standard",
      ageBadge: false,
      extraBadgeStyle: null,
    })
    expect(body.sashOrder).toEqual(FULL_SASH)
    expect(body.videoFormats).toEqual(FULL_VIDEO)
    // Deliberate user prefs preserved, never reset by Full.
    expect(body.ratingSources).toEqual(["imdb", "tmdb"])
    expect(screen.getByTestId("settings-save")).toBeDisabled()
  })

  it(
    "all four portrait PUT bodies agree on every Full pixel (landscape frozen per seed)",
    // Bounded per-test budget only (assertions unchanged): 8 sequential full
    // SettingsPanel mounts measured 1394ms isolated but 5688ms past the 5s
    // default in the full 535-file suite from worker scheduling inflation.
    // A single 4-mount pass collects the pre-click thumb alongside the PUT
    // body (same seed, same mount, same pre-click read the dropped second
    // pass performed; the per-seed cases above prove the click cannot move
    // the Full thumb). Missing-element findBy* still rejects at ~1s, so real
    // failures keep failing fast.
    { timeout: 10_000 },
    async () => {
    vi.useRealTimers()
    const bodies: Record<string, Record<string, unknown>> = {}
    const thumbs: string[] = []
    for (const { name, seed } of PORTRAIT_SEEDS) {
      localStorage.clear()
      puts = []
      seed()
      const { unmount } = renderPanel()
      await screen.findByTestId("poster-style-full")
      thumbs.push(thumbIdentity(fullThumb()))
      fireEvent.click(screen.getByTestId("poster-style-full"))
      openPresetTab()
      fireEvent.click(screen.getByTestId("settings-save"))
      await screen.findByText("ui.synced")
      expect(puts).toHaveLength(1)
      bodies[name] = puts[0].body
      unmount()
      cleanup()
    }
    // One thumb for all seeds: Full never follows the previous look.
    expect(new Set(thumbs).size).toBe(1)
    // One staged recipe for all seeds (the other-shape frozen profile is the
    // only per-seed difference and is excluded by design).
    const stripLandscape = (b: Record<string, unknown>) => {
      const rest = { ...b }
      delete rest.landscape
      return rest
    }
    const canon = snapshotIdentity(stripLandscape(bodies["apple-like"]) as Record<string, unknown>)
    for (const { name } of PORTRAIT_SEEDS) {
      expect(snapshotIdentity(stripLandscape(bodies[name]) as Record<string, unknown>), `Full recipe identical after ${name}`).toBe(canon)
    }
    },
  )
})

describe("landscape: every seed stages the identical Full profile", () => {
  function seedLandscape(profile: Record<string, unknown>, flats: Record<string, unknown>) {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        ...SHARED_PREFS,
        ...flats,
        landscape: profile,
      }),
    )
  }

  it("tuned profiles converge on one Full landscape recipe, flats frozen", async () => {
    vi.useRealTimers()
    const profiles: Record<string, Record<string, unknown>> = {}
    const seeds: Array<{ name: string; profile: Record<string, unknown>; flats: Record<string, unknown> }> = [
      {
        name: "apple-profile",
        flats: { defaultBadgeFont: "inter", defaultRankingBadgeStyle: "number" },
        profile: {
          badgeFont: "oswald",
          rankingBadgeStyle: "netflix",
          ribbonEnabled: true,
          badgeStyle: "colored",
          posterLayout: "fresh",
          extraBadgeStyle: "corner",
          qualityBadgeStyle: "color",
          networkLogoPosition: "top",
        },
      },
      {
        name: "card-profile",
        flats: { defaultBadgeFont: "barlow-condensed", defaultRankingBadgeStyle: "default" },
        profile: {
          badgeFont: "barlow-condensed",
          rankingBadgeStyle: "number",
          posterLayout: "nuvio",
          sashOrder: ["rank"],
          extraBadgeStyle: "pill",
          videoFormats: ["dv"],
          separateRatingsStyle: "bottom-pills",
        },
      },
    ]
    const thumbs: string[] = []
    for (const { name, profile, flats } of seeds) {
      localStorage.clear()
      puts = []
      seedLandscape(profile, flats)
      const { unmount } = renderPanel()
      await screen.findByTestId("poster-style-full")
      switchEditTargetToLandscape()
      await screen.findByTestId("poster-style-full")
      if (thumbs.length === 0) {
        // A tuned profile never claims Full before the click.
        expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "false")
      }
      thumbs.push(thumbIdentity(fullThumb()))
      fireEvent.click(screen.getByTestId("poster-style-full"))
      expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
      expect(thumbIdentity(fullThumb()), "Full thumb stable across the click").toBe(thumbs[thumbs.length - 1])
      expect(puts).toHaveLength(0)
      openPresetTab()
      fireEvent.click(screen.getByTestId("settings-save"))
      await screen.findByText("ui.synced")
      expect(puts).toHaveLength(1)
      const body = puts[0].body
      const land = body.landscape as Record<string, unknown>
      expect(land).toMatchObject({
        badgeFont: "inter",
        rankingBadgeStyle: "netflix",
        ribbonEnabled: true,
        posterLayout: "standard",
        extraBadgeStyle: "follow-rank",
        qualityBadgeStyle: "standard",
        ageBadge: false,
      })
      expect(land.sashOrder).toEqual(FULL_SASH)
      expect(land.videoFormats).toEqual(FULL_VIDEO)
      // Portrait flats stay byte-identical (other shape frozen).
      expect(body.badgeFont).toBe(flats.defaultBadgeFont)
      expect(body.rankingBadgeStyle).toBe(flats.defaultRankingBadgeStyle)
      profiles[name] = land
      unmount()
      cleanup()
    }
    expect(new Set(thumbs).size).toBe(1)
    expect(snapshotIdentity(profiles["apple-profile"])).toBe(snapshotIdentity(profiles["card-profile"]))
  })
})

describe("legacy standalone path stages the same canonical Full", () => {
  function renderBadge() {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape: "portrait" }), createElement(Probe)),
    )
    return { ctx: () => ctx as unknown as PosterEditorCtx }
  }

  it("tuned seed -> Full pins the canonical recipe, Essential stays partial", async () => {
    vi.useRealTimers()
    seedCardTuned()
    const { ctx } = renderBadge()
    await screen.findByTestId("poster-style-full")
    await waitFor(() => expect(ctx().defaultBadgeStyle).toBe("colored"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(screen.getByTestId("poster-style-full"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
    expect(ctx().defaultBadgeStyle).toBe("minimal")
    expect(ctx().defaultBadgeFont).toBe("inter")
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
    expect(ctx().defaultRibbonEnabled).toBe(true)
    expect(ctx().defaultRibbonSide).toBe("left")
    expect(ctx().defaultSashOrder).toEqual(FULL_SASH)
    expect(ctx().defaultCustomRatings).toBe(true)
    expect(ctx().defaultSeparateRatings).toBe(false)
    expect(ctx().defaultSeparateRatingsStyle).toBe("column")
    expect(ctx().defaultQualityBadgeStyle).toBe("standard")
    expect(ctx().defaultVideoFormats).toEqual(FULL_VIDEO)
    expect(ctx().defaultNetworkLogoPosition).toBe("auto")
    expect(ctx().defaultNetworkLogoFollowTitle).toBe(true)
    expect(ctx().defaultPreRelease).toBe(false)
    expect(ctx().defaultExtraBadgeStyle).toBeNull()
    expect(ctx().defaultRatingSources).toEqual(["imdb", "tmdb"])
    // Essential keeps its legacy partial contract (never widened by this task).
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(ctx().defaultBadgeStyle).toBe("minimal")
    expect(ctx().defaultBadgeFont).toBe("inter")
  })

  it("ribbon-off divergence never claims Full (true canonical render only)", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        ...SHARED_PREFS,
        ...QUICK_BADGE_PATCHES.full,
        ...quickLookDesired("full", true),
        defaultRankingBadgeStyle: "default",
        defaultRibbonEnabled: false,
      }),
    )
    renderBadge()
    await screen.findByTestId("poster-style-full")
    // Every Full pixel matches except the rank look: still not Full (the
    // stored plate + ribbon OFF renders the centered Badge, not the Nastro).
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(screen.getByTestId("poster-style-full"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
  })
})
