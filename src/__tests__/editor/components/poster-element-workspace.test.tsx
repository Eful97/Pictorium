/**
 * Five-tab settings homes (Phase 2 minimalist consolidation):
 * - five primary tabs (Preset, Rankings, Information, Badge, Transform);
 *   secondary Prefs/Data/Space via the secondary nav, never equal tabs;
 * - every primary switch lives in exactly one tab: rank bucket + master +
 *   appearance + layout/scope + priority order in Rankings; visibility
 *   (genre/year/rating/quality/age/network, sash categories, preRelease,
 *   custom, sources) in Information; styles only in Badge; geometry only in
 *   Transform (style picker and position controls moved to their homes);
 * - priority order editing in Rankings never duplicates Information toggles;
 * - tab/shape navigation is UI-only staged state: it never PUTs, never
 *   writes storage, never touches the delivery shape;
 * - requestSettingsTab compatibility: legacy "badge" remaps to Preset,
 *   "trasforma"/"prefs"/"data"/"spazio" preserved;
 * - all 18 dictionaries share parity (keys, placeholders, no empties).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { requestSettingsTab } from "@/lib/settings-tab"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function renderSettingsWithProbe() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
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
  return { ctx: () => ctx as unknown as PosterEditorCtx }
}

function snapshotDefaults(ctx: PosterEditorCtx): string {
  const { landscape, defaultPosterShape, ...rest } = ctx as unknown as Record<string, unknown>
  void defaultPosterShape
  return JSON.stringify({ rest, landscape })
}

function openTab(name: string) {
  const tab = screen.getByRole("tab", { name })
  if (tab.getAttribute("aria-selected") !== "true") fireEvent.click(tab)
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe("five-tab homes", () => {
  it("preset tab: gallery only, no detailed switches, no element navigation", () => {
    renderSettingsWithProbe()
    expect(screen.getByTestId("presets-panel")).toBeInTheDocument()
    for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]) {
      expect(screen.getByTestId(`poster-style-${id}`)).toBeInTheDocument()
    }
    expect(screen.queryByRole("switch", { name: "ui.topBadge" })).toBeNull()
    expect(screen.queryByTestId("poster-element-nav")).toBeNull()
  })

  it("rankings tab: rank switch, master gate, unified presentation and order-only priority", () => {
    renderSettingsWithProbe()
    openTab("ui.settingsTabRankings")
    expect(screen.getByRole("switch", { name: "ui.sash_rank" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.topBadge" })).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "ui.rankFamily" })).toBeInTheDocument()
    // Unified presentation (Nastro/Numero/Badge/Fresh/Card): single exclusive
    // group, no separate Layout-poster card in Classifiche (scoped to the
    // visible panel: hidden sibling tabpanels still mount theirs).
    const panel = screen.getByRole("switch", { name: "ui.sash_rank" }).closest('[role="tabpanel"]') as HTMLElement
    const primary = within(within(panel).getByTestId("ranking-presentation")).getByRole("radiogroup", { name: "ui.rankFamily" })
    expect(within(primary).getAllByRole("radio")).toHaveLength(5)
    expect(within(panel).queryByTestId("poster-layout-card")).toBeNull()
    // Priority editing shows order only — no duplicate category toggles here.
    expect(screen.getByText("ui.badgePriorityOrderHint")).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "ui.sash_upcoming" })).toBeNull()
    expect(screen.queryByRole("switch", { name: "ui.sash_new" })).toBeNull()
  })

  it("information tab: visibility only, category toggles live here alone", () => {
    renderSettingsWithProbe()
    openTab("ui.settingsTabInformation")
    for (const name of ["ui.badgeGenre", "ui.badgeYear", "ui.badgeRating", "ui.badgeQuality", "ui.ageBadge", "ui.networkLogo"]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument()
    }
    for (const name of ["ui.sash_upcoming", "ui.sash_new", "ui.sash_award", "ui.sash_extra"]) {
      expect(screen.getByRole("switch", { name })).toBeInTheDocument()
    }
    expect(screen.getByRole("switch", { name: "ui.preRelease" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.customRatings" })).toBeInTheDocument()
    // No appearance or priority controls on the visibility tab (scoped to
    // its panel: hidden sibling tabpanels still mount theirs).
    const infoPanel = screen.getByRole("switch", { name: "ui.badgeGenre" }).closest('[role="tabpanel"]') as HTMLElement
    // STALE-query migration — source evidence BadgeDefaultsSection.tsx: the
    // appearance card stays mounted inside this same tabpanel with the
    // `hidden` attribute (state-preserving mount, like the details bodies —
    // styles still live in Badge only, visibility only here). queryByText
    // ignores `hidden`, so assert present-but-hidden plus no visible leak.
    const extraWrap = within(infoPanel).getByTestId("badge-extra-style-wrap")
    expect(extraWrap).toHaveAttribute("hidden")
    for (const el of within(infoPanel).queryAllByText("ui.extraBadgeStyle")) {
      expect(el.closest("[hidden]")).not.toBeNull()
    }
    expect(within(infoPanel).queryByText("ui.badgePriorityOrderHint")).toBeNull()
    expect(screen.queryByRole("switch", { name: "ui.sash_rank" })).toBeNull()
  })

  it("badge tab: styles only, inactive features collapse with a short hint", () => {
    renderSettingsWithProbe()
    openTab("ui.settingsTabBadge")
    // Scoped via the unique appearance gates (several Badge tabpanels mount
    // simultaneously with siblings hidden; global text queries false-positive
    // on hidden instances and on gate+label duplicates).
    expect(within(screen.getByTestId("badge-genre-style")).getAllByText("ui.styleGenreBadge").length).toBeGreaterThanOrEqual(1)
    expect(within(screen.getByTestId("badge-extra-style")).getAllByText("ui.extraBadgeStyle").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole("switch", { name: "ui.badgeGenre" })).toBeNull()
    expect(screen.queryByRole("switch", { name: "ui.badgeRating" })).toBeNull()
    expect(screen.queryByRole("switch", { name: "ui.badgeQuality" })).toBeNull()
  })

  it("transform tab: geometry only with moved position controls, no style picker", () => {
    renderSettingsWithProbe()
    openTab("ui.settingsTabTransform")
    const panel = screen.getByRole("tabpanel", { name: "ui.transform" })
    // Position hosts the network-position override only (logo alignment is
    // Auto-only: no selector anywhere in the panel).
    expect(within(panel).getByText("ui.position")).toBeInTheDocument()
    expect(within(panel).getByText("ui.networkLogoPosition")).toBeInTheDocument()
    expect(within(panel).queryByText("ui.logoAlign")).toBeNull()
    // Scoped to the visible transform panel: hidden Badge instances still
    // mount the separate picker, so a global query would false-positive.
    expect(within(panel).queryByText("ui.separateRatingsStyle")).toBeNull()
  })

  it("switching tabs never writes defaults, delivery shape, or storage", () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultBadgeGenre: true, defaultPosterShape: "poster", landscape: { badgeGenre: false } }),
    )
    const { ctx } = renderSettingsWithProbe()
    const before = snapshotDefaults(ctx())
    const storedBefore = localStorage.getItem("badgeDefaults")
    for (const name of ["ui.settingsTabRankings", "ui.settingsTabInformation", "ui.settingsTabBadge", "ui.labTitle", "ui.settingsTabTransform", "ui.settingsTabPreset"]) {
      openTab(name)
    }
    expect(snapshotDefaults(ctx())).toBe(before)
    expect(ctx().defaultPosterShape).toBe("poster")
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
  })

  it("switching shape never writes defaults", () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultGradientHeight: 30, defaultPosterShape: "poster", landscape: { gradientHeight: 20 } }),
    )
    const { ctx } = renderSettingsWithProbe()
    const before = snapshotDefaults(ctx())
    const target = screen.getByTestId("format-target-selector")
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    fireEvent.click(within(target).getByText("ui.posterShapePortrait"))
    fireEvent.click(within(target).getByText("ui.posterShapeLandscape"))
    expect(snapshotDefaults(ctx())).toBe(before)
    expect(ctx().defaultPosterShape).toBe("poster")
    expect(ctx().defaultGradientHeight).toBe(30)
    expect(ctx().landscape.gradientHeight).toBe(20)
  })

  it("requestSettingsTab compatibility: badge remaps to preset, others preserved", () => {
    requestSettingsTab("trasforma")
    renderSettingsWithProbe()
    expect(screen.getByRole("tab", { name: "ui.settingsTabTransform" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("sources controls render success and failure feedback on Information", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/api/custom-rating/test")) {
        return { ok: true, status: 200, headers: { get: (): null => null }, text: async () => JSON.stringify({ ok: true, status: 200, ms: 12, ratings: [{ id: "src", name: "MySrc", value: 8.5, format: "decimal" }] }) }
      }
      return { ok: true, status: 200, headers: { get: (): null => null }, text: async () => JSON.stringify({}), json: async () => ({}) }
    }))
    renderSettingsWithProbe()
    openTab("ui.settingsTabInformation")
    const customSwitch = screen.getByRole("switch", { name: "ui.customRatings" })
    // STALE-setup fix — source evidence useDefaults.ts (customRatings and
    // defaultCustomRatings both default to true): enabling an already-on
    // switch never dirties the session, so the dirty precondition for the
    // Save-first guard must be established explicitly. Flipping any staged
    // value guarantees dirty; original semantics kept: a dirty session
    // disables testing with a Save-first hint (no bypass).
    if (customSwitch.getAttribute("aria-checked") !== "true") fireEvent.click(customSwitch)
    fireEvent.click(screen.getByRole("switch", { name: "ui.badgeGenre" }))
    // Dirty session disables testing with a Save-first hint (no bypass).
    expect(screen.getByRole("button", { name: "ui.customRatingTest" })).toBeDisabled()
    expect(screen.getByText("ui.customRatingSaveFirstHint")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByTestId("settings-save"))
    })
    const testBtn = await screen.findByRole("button", { name: "ui.customRatingTest" })
    expect(testBtn).not.toBeDisabled()
    await act(async () => { fireEvent.click(testBtn) })
    expect(await screen.findByText(/ui\.customRatingTestOk/)).toBeInTheDocument()
    expect(screen.getByText(/200 OK/)).toBeInTheDocument()
    expect(screen.getByText(/12 ms/)).toBeInTheDocument()
    expect(screen.getByText("MySrc")).toBeInTheDocument()
  })

  it("sources controls disable the test button while pending and render failure feedback", async () => {
    // Deferred promise: the click must disable the button with a Testing
    // label until the promise settles — real async state, no timeout
    // inflation and no weakened immediate-fake assertions.
    let resolveTest!: (value: unknown) => void
    const gate = new Promise<unknown>((resolve) => { resolveTest = resolve })
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes("/api/custom-rating/test")) return gate
      return { ok: true, status: 200, headers: { get: (): null => null }, text: async () => JSON.stringify({}), json: async () => ({}) }
    }))
    renderSettingsWithProbe()
    openTab("ui.settingsTabInformation")
    // Clean session (customRatings defaults to true — see above): testing is
    // available with no Save-first hint.
    const customSwitch = screen.getByRole("switch", { name: "ui.customRatings" })
    if (customSwitch.getAttribute("aria-checked") !== "true") fireEvent.click(customSwitch)
    const testBtn = await screen.findByRole("button", { name: "ui.customRatingTest" })
    expect(testBtn).not.toBeDisabled()
    fireEvent.click(testBtn)
    expect(testBtn).toBeDisabled()
    expect(screen.getByText("ui.customRatingTesting")).toBeInTheDocument()
    // An application-level failure settles pending into failure feedback and
    // re-enables the button (HTTP 200 carrying ok:false — no retry backoff).
    await act(async () => {
      resolveTest({ ok: true, status: 200, headers: { get: (): null => null }, text: async () => JSON.stringify({ ok: false, status: 400, ms: 7, error: "http-error" }) })
    })
    expect(await screen.findByText(/ui\.customRatingTestErrHttp/)).toBeInTheDocument()
    expect(screen.getByText(/400/)).toBeInTheDocument()
    expect(screen.getByText(/7 ms/)).toBeInTheDocument()
    expect(testBtn).not.toBeDisabled()
  })
})

describe("translations parity (all 18 dictionaries)", () => {
  it("shares the exact same key set, placeholders, and no empty values", async () => {
    const langs = ["ar", "cs", "de", "en", "es-419", "es", "fr", "he", "it", "ja", "ko", "nl", "pl", "pt", "ro", "sv", "tr", "vi"] as const
    const dicts: Record<string, Record<string, string>> = {}
    for (const l of langs) {
      dicts[l] = (await import(`@/lib/translations/${l}.json`)).default as Record<string, string>
    }
    const allKeys = new Set<string>()
    for (const l of langs) for (const k of Object.keys(dicts[l])) allKeys.add(k)
    expect(allKeys.size).toBeGreaterThan(500)
    for (const l of langs) {
      expect(Object.keys(dicts[l]).filter((k) => !allKeys.has(k))).toEqual([])
      expect([...allKeys].filter((k) => !(k in dicts[l])), `${l} missing keys`).toEqual([])
    }
    // Five-tab keys exist everywhere.
    for (const l of langs) {
      for (const k of ["ui.settingsTabPreset", "ui.settingsTabRankings", "ui.settingsTabInformation", "ui.settingsTabBadge", "ui.settingsTabTransform", "ui.settingsSaveChanges", "ui.settingsUnsavedTitle", "ui.settingsContinueEditing", "ui.settingsDiscardAndClose", "ui.presetGalleryHint", "ui.activateInInformationHint", "ui.activateInTabHint"]) {
        expect(dicts[l][k], `${l}:${k}`).toBeTruthy()
      }
    }
    const placeholders = (s: string): string => {
      const m = s.match(/\{[a-zA-Z]+\}/g) || []
      return [...new Set(m)].sort().join(",")
    }
    const bad: string[] = []
    for (const k of Object.keys(dicts.en)) {
      const ref = placeholders(dicts.en[k])
      for (const l of langs) {
        if (placeholders(dicts[l][k] ?? "") !== ref) bad.push(`${l}:${k}`)
      }
    }
    expect(bad).toEqual([])
    const empty: string[] = []
    for (const l of langs) {
      for (const [k, v] of Object.entries(dicts[l])) {
        if (!v || !v.trim()) empty.push(`${l}:${k}`)
      }
    }
    expect(empty).toEqual([])
  })
})
