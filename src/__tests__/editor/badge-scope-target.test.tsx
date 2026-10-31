/**
 * Badge tab follows the edit target (no new UX grouping yet):
 * portrait reads/writes shared flats, landscape reads `land[key] ?? flat`
 * and writes the landscape profile. Root defaults, delivery shape, global
 * sources/endpoints and the current per-title editor stay untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { BETTER_POSTER_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const opened: string[] = []
beforeEach(() => {
  opened.length = 0
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  class FakeXHR {
    onprogress: ((e: unknown) => void) | null = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    ontimeout: (() => void) | null = null
    responseType = ""
    timeout = 0
    status = 0
    response: unknown = null
    open(_method: string, url: string) {
      opened.push(String(url))
    }
    send() {}
    abort() {}
    setRequestHeader() {}
  }
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
  vi.useFakeTimers()
})

function renderBadge(shape: "portrait" | "landscape") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
  openBadgeGroup("style", "base", "overlay", "quality")
  return { ctx: () => ctx as PosterEditorCtx }
}

function renderSettings() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
      createElement(Probe),
    ),
  )
  openBadgeGroup("style", "base", "overlay", "quality")
  return { ctx: () => ctx as PosterEditorCtx }
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

function badgeSwitch(name: string): HTMLElement {
  return screen.getByRole("switch", { name })
}

// Five-tab settings: macro-groups are bare/always-open inside mode-filtered
// tabs (no disclosures) — navigate to the tab owning the first requested
// group (style -> Badge, base/quality -> Information, overlay -> Rankings).
// Standalone legacy (BadgeDefaultsSection default) keeps opening the Advanced
// disclosure + groups (the summary link has no aria-controls). Assertions
// unchanged.
const GROUP_TAB: Record<"style" | "base" | "overlay" | "quality", string> = {
  style: "ui.settingsTabBadge",
  base: "ui.settingsTabInformation",
  overlay: "ui.settingsTabRankings",
  quality: "ui.settingsTabInformation",
}
function openBadgeGroup(...ids: Array<"style" | "base" | "overlay" | "quality">) {
  // Standalone legacy (BadgeDefaultsSection default): open the Advanced
  // disclosure + groups (the summary link has no aria-controls).
  // Unified SettingsPanel: go to the tab owning the requested groups.
  const adv = screen.queryByTestId("badge-advanced-toggle")
  if (adv && adv.hasAttribute("aria-controls")) {
    if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
    for (const id of ids) {
      const t = screen.getByTestId(`badge-group-${id}-toggle`)
      if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
    }
    return
  }
  const tab = screen.getByRole("tab", { name: GROUP_TAB[ids[0]] })
  if (tab.getAttribute("aria-selected") !== "true") fireEvent.click(tab)
}

// Element-workspace nav was removed by the five-tab redesign
// (PosterElementNavigation no longer rendered): each control lives in exactly
// one primary tab via the BadgeDefaultsSection mode filter, so open the
// owning tab. UI-only navigation, never writes defaults.
const ELEMENT_TAB: Record<string, string> = {
  genre: "ui.settingsTabInformation",
  logo: "ui.settingsTabInformation",
  rank: "ui.settingsTabRankings",
  ratings: "ui.settingsTabInformation",
}
function openElement(id: string) {
  const tab = screen.getByRole("tab", { name: ELEMENT_TAB[id] })
  if (tab.getAttribute("aria-selected") !== "true") fireEvent.click(tab)
}

// Staged five-tab session: edits stage with zero durable writes; the single
// global Save installs them into the outer truth the Probe reads.
async function saveStaged() {
  fireEvent.click(screen.getByTestId("settings-save"))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
}

describe("badge target scope", () => {
  it("landscape toggle writes only the profile; flat and preview follow", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    openElement("genre")
    fireEvent.click(badgeSwitch("ui.genreRatingBadge"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    // Staged session: the explicit Save installs the draft into outer truth.
    await saveStaged()
    expect(ctx().landscape.globalBadges).toBe(false)
    expect(ctx().defaultGlobalBadges).toBe(true)
    const p = paramsOf(opened[opened.length - 1])
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("badges")).toBe("0")
  })

  it("portrait toggle writes the flat; profile snapshots the pre-edit (no leak)", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.genreRatingBadge"))
    expect(ctx().defaultGlobalBadges).toBe(false)
    // 3B1: the inherited key freezes the pre-edit flat instead of following it.
    expect(ctx().landscape.globalBadges).toBe(true)
  })

  it("back to portrait restores flat values; profile edits survive", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const target = screen.getByTestId("format-target-selector")
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    openElement("logo")
    fireEvent.click(badgeSwitch("ui.networkLogo"))
    // Staged session: the explicit Save installs the draft into outer truth.
    await saveStaged()
    expect(ctx().landscape.networkLogo).toBe(false)
    expect(badgeSwitch("ui.networkLogo").getAttribute("aria-checked")).toBe("false")
    fireEvent.click(within(target).getByText("ui.posterShapePortrait"))
    expect(badgeSwitch("ui.networkLogo").getAttribute("aria-checked")).toBe("true")
    expect(ctx().defaultNetworkLogo).toBe(true)
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    expect(badgeSwitch("ui.networkLogo").getAttribute("aria-checked")).toBe("false")
    expect(ctx().landscape.networkLogo).toBe(false)
  })

  it("landscape appearance + sepstyle + sash write the profile; preview query follows", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    openElement("rank")
    // Rank look lives in the Classifica card (no duplicated switch in Stili):
    // Badge appearance, then the corner variant.
    const appearance = screen.getByRole("radiogroup", { name: "ui.rankFamily" })
    fireEvent.click(within(appearance).getByRole("radio", { name: "ui.badgeSection" }))
    const variants = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.corner" }))
    // Staged session: the explicit Save installs the draft into outer truth.
    await saveStaged()
    expect(ctx().landscape.rankingBadgeStyle).toBe("corner")
    expect(ctx().defaultRankingBadgeStyle).toBe("default")
    // Separate style pills in landscape (column stays the portrait flat).
    openElement("ratings")
    fireEvent.click(badgeSwitch("ui.separateRatings"))
    // The separate-style picker lives on the Badge (appearance) tab.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    fireEvent.click(screen.getByText("ui.separateRatingsBottomPills"))
    await saveStaged()
    expect(ctx().landscape.separateRatingsStyle).toBe("bottom-pills")
    expect(ctx().defaultSeparateRatingsStyle).toBe("column")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const p = paramsOf(opened[opened.length - 1])
    expect(p.get("rs")).toBe("corner")
    expect(p.get("sepstyle")).toBe("bottom-pills")
    expect(p.get("sep")).toBe("1")
  })

  it.each([
    { id: "bottom-mono", label: "ui.separateRatingsBottomMono" },
    { id: "bottom-color", label: "ui.separateRatingsBottomColor" },
  ] as const)("portrait: $id writes the flat; column/bar/pills kept", async ({ id, label }) => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    const sepSwitch = badgeSwitch("ui.separateRatings")
    if (sepSwitch.getAttribute("aria-checked") !== "true") fireEvent.click(sepSwitch)
    // Tutte e 5 le voci restano selezionabili (nessuna rimozione legacy).
    for (const legacy of [
      "ui.separateRatingsColumn",
      "ui.separateRatingsBottomBar",
      "ui.separateRatingsBottomPills",
      "ui.separateRatingsBottomMono",
      "ui.separateRatingsBottomColor",
    ]) {
      expect(screen.getByText(legacy)).toBeTruthy()
    }
    fireEvent.click(screen.getByText(label))
    expect(ctx().defaultSeparateRatingsStyle).toBe(id)
    // 3B1: the inherited key freezes the pre-edit flat instead of following it.
    expect(ctx().landscape.separateRatingsStyle).toBe("column")
    expect(screen.getByText(label).getAttribute("aria-pressed")).toBe("true")
  })

  it.each([
    { id: "bottom-mono", label: "ui.separateRatingsBottomMono" },
    { id: "bottom-color", label: "ui.separateRatingsBottomColor" },
  ] as const)("landscape: $id writes the profile; flat stays column, preview emits sepstyle", async ({ id, label }) => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    openElement("ratings")
    const sepSwitch = badgeSwitch("ui.separateRatings")
    if (sepSwitch.getAttribute("aria-checked") !== "true") fireEvent.click(sepSwitch)
    // The separate-style picker lives on the Badge (appearance) tab.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabBadge" }))
    for (const legacy of [
      "ui.separateRatingsColumn",
      "ui.separateRatingsBottomBar",
      "ui.separateRatingsBottomPills",
      "ui.separateRatingsBottomMono",
      "ui.separateRatingsBottomColor",
    ]) {
      expect(screen.getByText(legacy)).toBeTruthy()
    }
    // Le nuove voci bare restano abilitate in landscape (solo la barra è off).
    expect(screen.getByText(label).hasAttribute("disabled")).toBe(false)
    fireEvent.click(screen.getByText(label))
    // Staged session: the explicit Save installs the draft into outer truth.
    await saveStaged()
    expect(ctx().landscape.separateRatingsStyle).toBe(id)
    expect(ctx().defaultSeparateRatingsStyle).toBe("column")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const p = paramsOf(opened[opened.length - 1])
    expect(p.get("sepstyle")).toBe(id)
    expect(p.get("sep")).toBe("1")
  })

  it("false/[] persist to storage + PUT; current editor and delivery untouched", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(ctx().landscape.rankingBadges).toBe(false)
    expect(ctx().landscape.sashOrder).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}")
    expect(stored.landscape.rankingBadges).toBe(false)
    expect(stored.landscape.sashOrder).toEqual([])
    const puts = (vi.mocked(fetch).mock.calls as unknown[][])
      .filter(([, init]) => (init as RequestInit)?.method === "PUT")
      .map(([, init]) => JSON.parse(String((init as RequestInit)?.body)))
    const last = puts[puts.length - 1]
    expect(last.landscape.rankingBadges).toBe(false)
    expect(last.landscape.sashOrder).toEqual([])
    // Root defaults, current editor state and delivery shape intact.
    expect(ctx().defaultRankingBadges).toBe(true)
    expect(ctx().defaultSashOrder.length).toBeGreaterThan(0)
    expect(ctx().rankingBadges).toBe(true)
    expect(ctx().defaultPosterShape).toBe("poster")
  })

  it("global sources and endpoint stay global in both targets", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(screen.getByText("ui.configure"))
    fireEvent.click(screen.getByText("ui.enableAll"))
    expect(ctx().defaultRatingSources.length).toBe(17)
    expect(ctx().landscape).not.toHaveProperty("ratingSources")
    const endpoint = screen.getByPlaceholderText("https://example.com/ratings/{imdbId}") as HTMLInputElement
    fireEvent.change(endpoint, { target: { value: "https://x.test/r/{imdbId}" } })
    expect(ctx().defaultCustomRatingEndpoint).toBe("https://x.test/r/{imdbId}")
    expect(ctx().landscape).not.toHaveProperty("customRatingEndpoint")
  })

  it("scoped reset restores Badge shape defaults (Transform numerics intact)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ landscape: { topBadgeScale: 130 } }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    openElement("logo")
    fireEvent.click(badgeSwitch("ui.networkLogo"))
    // The scoped reset renders in every five-tab instance: scope to the
    // visible Badge panel (the three instances stay mounted + hidden).
    const panels = screen.getAllByRole("tabpanel", { name: "ui.badgeSection" })
    const panel = panels.find((p) => p.getAttribute("hidden") === null)
    expect(panel).toBeDefined()
    const reset = within(panel!).getByRole("button", { name: "ui.reset · ui.posterShapeLandscape" })
    fireEvent.click(reset)
    // Staged session: the explicit Save installs the draft into outer truth.
    await saveStaged()
    // 3B1: reset materializes the current portrait effective (independent),
    // never clear-to-follow.
    expect(ctx().landscape.networkLogo).toBe(true)
    expect(ctx().landscape.topBadgeScale).toBe(130)
    expect(ctx().defaultNetworkLogo).toBe(true)
  })

  it("landscape preset writes the profile; root flats and rating sources intact", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultGlobalBadges: false }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    // The ready-look gallery lives on the Preset tab now.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // Staged-first: the tile stages a draft (outer truth untouched until the
    // single global Save below); the explicit Save installs it.
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(ctx().landscape.globalBadges).toBeUndefined()
    expect(ctx().defaultGlobalBadges).toBe(false)
    await saveStaged()
    expect(ctx().landscape.globalBadges).toBe(true)
    expect(ctx().landscape.badgeStyle).toBe("minimal")
    expect(ctx().defaultGlobalBadges).toBe(false)
    expect(ctx().defaultBadgeStyle).toBe("shadow")
  })

  it("sash stash is per target; staged drafts never touch stored keys", async () => {
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const target = screen.getByTestId("format-target-selector")
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    openElement("rank")
    fireEvent.click(badgeSwitch("ui.topBadge"))
    // Staged five-tab session: the stash lives in memory per target, so a
    // landscape toggle stages with zero localStorage writes — the legacy key
    // especially stays untouched (no cross-target resurrection from disk).
    expect(localStorage.getItem("pictorium_trend_sash_stash:landscape")).toBeNull()
    expect(localStorage.getItem("pictorium_trend_sash_stash")).toBeNull()
    fireEvent.click(badgeSwitch("ui.topBadge"))
    // Staged session: the explicit Save installs the draft into outer truth.
    await saveStaged()
    expect(ctx().landscape.sashOrder?.length).toBeGreaterThan(0)
    fireEvent.click(within(target).getByText("ui.posterShapePortrait"))
    fireEvent.click(badgeSwitch("ui.topBadge"))
    // Portrait stages to its own memory slot too — still zero durable writes.
    expect(localStorage.getItem("pictorium_trend_sash_stash")).toBeNull()
    expect(localStorage.getItem("pictorium_trend_sash_stash:landscape")).toBeNull()
    // Functional per-target restore: back ON resurrects this target's order.
    fireEvent.click(badgeSwitch("ui.topBadge"))
    await saveStaged()
    expect(ctx().defaultSashOrder.length).toBeGreaterThan(0)
    expect(ctx().defaultSashOrder).toContain("rank")
  })
})

describe("snapshot presets respect the edit target", () => {
  it("landscape BetterPoster: target visuals applied, ready extra reset, flats intact", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultBadgeStyle: "pill",
      defaultPosterShape: "poster",
      defaultRatingSources: ["imdb", "trakt", "mal"],
      landscape: { rankingBadgeStyle: "corner", extraBadgeStyle: "vetro", globalBadges: false },
    }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    // The snapshot gallery lives on the Preset tab now.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const beforeSources = JSON.stringify(ctx().defaultRatingSources)
    expect(JSON.parse(beforeSources)).toEqual(["imdb", "trakt", "mal"])
    // Staged-first: the snapshot stages with zero durable writes until Save.
    fireEvent.click(screen.getByTestId("poster-style-better-poster"))
    expect(ctx().landscape.rankingBadgeStyle).toBe("corner")
    expect(JSON.stringify(ctx().defaultRatingSources)).toBe(beforeSources)
    await saveStaged()
    // Snapshot values land on the target profile (flat ranking style + own landscape profile win).
    expect(ctx().landscape.rankingBadgeStyle).toBe("default")
    expect(ctx().landscape.globalBadges).toBe(true)
    expect(ctx().landscape.badgeStyle).toBe("minimal")
    expect(ctx().landscape.gradientHeight).toBe(50)
    // Ready contract: a landscape-target ready apply takes the explicit
    // follow-own-rank marker instead of inheriting a tuned style
    // (withReadyPresetExtraStyleReset on both entry points) — never the
    // stale profile value.
    expect(ctx().landscape.extraBadgeStyle).toBe("follow-rank")
    // Root flats and delivery never follow a landscape preset.
    expect(ctx().defaultBadgeStyle).toBe("pill")
    expect(ctx().defaultPosterShape).toBe("poster")
    // Guide preserves the distinct ordered shared sources (strong contract).
    expect(JSON.stringify(ctx().defaultRatingSources)).toBe(beforeSources)
    expect(ctx().defaultRatingSources).toEqual(["imdb", "trakt", "mal"])
  })

  it("standalone legacy landscape BetterPoster writes exact preset sources (length 16)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultBadgeStyle: "pill",
      defaultPosterShape: "poster",
      defaultRatingSources: ["imdb"],
      landscape: { rankingBadgeStyle: "corner" },
    }))
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(screen.getByTestId("poster-style-better-poster"))
    expect(ctx().defaultRatingSources).toHaveLength(16)
    expect(JSON.stringify(ctx().defaultRatingSources)).toBe(JSON.stringify(BETTER_POSTER_VISUAL_DEFAULTS.defaultRatingSources))
    expect(ctx().defaultLogoAlign).toBe(BETTER_POSTER_VISUAL_DEFAULTS.defaultLogoAlign)
    expect(ctx().defaultPortraitFitEnabled).toBe(BETTER_POSTER_VISUAL_DEFAULTS.defaultPortraitFitEnabled)
    expect(ctx().defaultLandscapeFitEnabled).toBe(BETTER_POSTER_VISUAL_DEFAULTS.defaultLandscapeFitEnabled)
  })

  it("portrait RPDB snapshots the pre-edit landscape (no leak, no reseed)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterShape: "landscape",
      defaultBadgeStyle: "shadow",
      landscape: { badgeStyle: "pill", extraBadgeStyle: "vetro", gradientHeight: 45 },
    }))
    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const landBefore = JSON.stringify(ctx().landscape)
    // Staged-first: zero durable writes until the explicit Save below.
    fireEvent.click(screen.getByTestId("poster-style-rpdb"))
    expect(ctx().defaultBadgeStyle).toBe("shadow")
    expect(JSON.stringify(ctx().landscape)).toBe(landBefore)
    await saveStaged()
    expect(ctx().defaultPosterShape).toBe("landscape")
    expect(ctx().defaultBadgeStyle).toBe("minimal")
    expect(ctx().landscape.extraBadgeStyle).toBe("vetro")
    // 3B1: flats the preset changes freeze their pre-edit effective values
    // into the profile (same pixels, then decoupled) — the profile grows
    // instead of leaking. Untouched keys (badgeStyle, gradientHeight) keep
    // their explicit values byte-identical.
    expect(ctx().landscape.badgeStyle).toBe("pill")
    expect(ctx().landscape.gradientHeight).toBe(45)
    expect(ctx().landscape.rankingBadges).toBe(true)
    // Pre-edit factory order frozen (the RPDB preset itself empties the flat).
    expect(JSON.stringify(ctx().landscape.sashOrder)).toBe(
      '["upcoming","rank","new","award","extra"]',
    )
    expect(JSON.stringify(ctx().landscape)).not.toBe(landBefore)
    // A second portrait change does not rebase the frozen profile.
    expect(ctx().landscape.rankingBadges).toBe(true)
  })
})
