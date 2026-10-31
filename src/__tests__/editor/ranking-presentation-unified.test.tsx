/**
 * Unified ranking presentation (five-tab Classifiche): Fresh and the provider
 * Card live INSIDE Classifiche as ranking presentation choices — ONE
 * exclusive Nastro/Numero/Badge/Fresh/Card group (exactly one checked; the
 * supported centered Badge stays as its own choice), no separate
 * Layout-poster card, no scope dropdown, Card skins only while Card is
 * selected.
 * - Classic selections reset the scoped layout to Standard through the
 *   existing setter with the existing canonical rank writes (extra freeze
 *   intact); Fresh/Card selections only set the scoped ranked layout and
 *   never rewrite the stored rank style (returning restores it).
 * - Variant/side rows follow the presentation (Nastro → ribbon variants +
 *   side, Numero → side, Badge → badge variants, Fresh/Card → none).
 * - Staged-only until the single global Save (one consistent PUT; a failed
 *   Save retains the draft); staged preview and delivery URLs stay
 *   consistent. Renderer/URL/schema contracts untouched (no new field).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

function probe() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  return { Probe, ctx: () => ctx as unknown as PosterEditorCtx }
}

function renderRankings(seed: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(seed))
  const { Probe, ctx } = probe()
  renderWithCtx(
    createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape: "portrait", mode: "appearance" }), createElement(Probe)),
  )
  return { ctx }
}

/** The single exclusive primary group inside the visible rankings card. */
function primaryGroup(): HTMLElement {
  const group = screen.getByTestId("ranking-presentation")
  return within(group).getByRole("radiogroup", { name: "ui.rankFamily" })
}

function checkedNames(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole("radio")
    .filter((o) => o.getAttribute("aria-checked") === "true")
    .map((o) => o.textContent ?? "")
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("unified presentation group (settings-only)", () => {
  it("single exclusive 5-choice group, no layout card, no scope dropdown, exactly one checked", async () => {
    const { ctx } = renderRankings({})
    await act(async () => {})
    // Seeded Standard+Nastro: Nastro checked, nothing else.
    expect(screen.queryByTestId("poster-layout-card")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-select")).toBeNull()
    const primary = primaryGroup()
    const options = within(primary).getAllByRole("radio")
    expect(options).toHaveLength(5)
    for (const name of ["ui.ribbon", "ui.number", "ui.badgeSection", "ui.posterLayoutGroupedFresh", "ui.posterLayoutGroupedCard"]) {
      expect(within(primary).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(checkedNames(primary)).toHaveLength(1)
    expect(within(primary).getByRole("radio", { name: "ui.ribbon" })).toHaveAttribute("aria-checked", "true")
    // Nastro rows relevant: ribbon variants + side.
    expect(screen.getByRole("radiogroup", { name: "ui.ribbon" })).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "ui.position" })).toBeInTheDocument()
    // Card skins hidden until Card is selected.
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    expect(ctx().defaultPosterLayout).toBe("standard")
  })

  it("variant/side rows follow the presentation; Fresh/Card hide them, skins only on Card", async () => {
    renderRankings({})
    await act(async () => {})
    // Numero: side only, no ribbon variants, no badge variants.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.number" }))
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.getByRole("radiogroup", { name: "ui.position" })).toBeInTheDocument()
    // Badge (centered, preserved): badge variants only, no side.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.badgeSection" }))
    expect(screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
    // Fresh: neither, ranked-only hint, no skins.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    expect(screen.getByText("ui.posterFreshScopeHint")).toBeInTheDocument()
    // Card: skins appear with the Card hint, still no variant/side rows.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }))
    const skins = screen.getByTestId("poster-layout-skins")
    for (const name of ["ui.posterLayoutSkinProvider", "ui.posterLayoutSkinBlack", "ui.posterLayoutSkinViolet"]) {
      expect(within(skins).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(screen.getByText("ui.posterLayoutScopeHint")).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
    // Exactly one primary stays checked through every switch.
    expect(checkedNames(primaryGroup())).toHaveLength(1)
  })

  it("Fresh never rewrites the stored rank style; returning to Nastro writes the canonical style", async () => {
    const { ctx } = renderRankings({ defaultRankingBadgeStyle: "pill", defaultRibbonEnabled: true })
    await act(async () => {})
    // Seeded Badge stays selected (stored design preserved).
    expect(within(primaryGroup()).getByRole("radio", { name: "ui.badgeSection" })).toHaveAttribute("aria-checked", "true")
    // Fresh detour: layout only, rank style untouched.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    expect(ctx().defaultPosterLayout).toBe("fresh")
    expect(ctx().defaultRankingBadgeStyle).toBe("pill")
    expect(ctx().defaultRibbonEnabled).toBe(true)
    // Back to Nastro: Standard layout + canonical Nastro writes, and the
    // legacy extra look freezes (explicit change, never on mount).
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.ribbon" }))
    expect(ctx().defaultPosterLayout).toBe("standard")
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
    expect(ctx().defaultRibbonEnabled).toBe(true)
    expect(ctx().defaultExtraBadgeStyle).toBe("pill")
  })

  it("Card remembers the chosen skin and keeps the rank style; Badge writes the canonical centered style", async () => {
    const { ctx } = renderRankings({ defaultPosterLayout: "nuvio" })
    await act(async () => {})
    // Seeded Card skin stays selected with its skin checked.
    expect(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" })).toHaveAttribute("aria-checked", "true")
    expect(
      within(screen.getByTestId("poster-layout-skins")).getByRole("radio", { name: "ui.posterLayoutSkinBlack" }),
    ).toHaveAttribute("aria-checked", "true")
    // Classic detour keeps the remembered skin; returning restores nuvio (not the default skin).
    // The Nastro detour wrote its canonical style; Card never rewrites it.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.ribbon" }))
    expect(ctx().defaultPosterLayout).toBe("standard")
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }))
    expect(ctx().defaultPosterLayout).toBe("nuvio")
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
    // Switching skins keeps a single checked Card + one checked skin.
    fireEvent.click(
      within(screen.getByTestId("poster-layout-skins")).getByRole("radio", { name: "ui.posterLayoutSkinViolet" }),
    )
    expect(ctx().defaultPosterLayout).toBe("stremio")
    expect(within(primaryGroup()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" })).toHaveAttribute("aria-checked", "true")
    expect(checkedNames(primaryGroup())).toHaveLength(1)
    // Badge: Standard layout + canonical centered writes.
    fireEvent.click(within(primaryGroup()).getByRole("radio", { name: "ui.badgeSection" }))
    expect(ctx().defaultPosterLayout).toBe("standard")
    expect(ctx().defaultRankingBadgeStyle).toBe("pill")
    expect(ctx().defaultRibbonEnabled).toBe(true)
  })
})

describe("unified presentation staging (SettingsPanel)", () => {
  let puts: { url: string; body: Record<string, unknown> }[]
  let putOk = true

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    puts = []
    putOk = true
    resetGuestGuardForTests()
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url)
        if (init?.method === "PUT" && u.includes("/api/defaults")) {
          puts.push({ url: u, body: JSON.parse(init.body as string) })
          return { ok: putOk, status: putOk ? 200 : 500, headers: { get: () => null }, json: async () => ({}) }
        }
        if (u.includes("/api/defaults/presets")) {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ presets: [] }) }
        }
        if (u.includes("/api/custom-rating/test")) {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, status: 200, ms: 3, ratings: [] }) }
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
  })

  function renderPanel() {
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
    return { ctx: () => ctx as unknown as PosterEditorCtx }
  }

  function clickTab(name: string) {
    fireEvent.click(screen.getByRole("tab", { name }))
  }

  /** The visible badge tabpanel (the three five-tab instances stay mounted). */
  function activeBadgePanel() {
    const panels = screen.getAllByRole("tabpanel", { name: "ui.badgeSection" })
    const active = panels.find((p) => p.getAttribute("hidden") === null)
    expect(active).toBeDefined()
    return active!
  }

  function rankingsPrimary(): HTMLElement {
    const group = within(activeBadgePanel()).getByTestId("ranking-presentation")
    return within(group).getByRole("radiogroup", { name: "ui.rankFamily" })
  }

  function setShape(shape: "portrait" | "landscape") {
    const label = shape === "portrait" ? "ui.posterShapePortrait" : "ui.posterShapeLandscape"
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText(label))
  }

  it("no persistence before Save; one Save carries consistent params; preview and delivery agree", async () => {
    const storedBefore = localStorage.getItem("badgeDefaults")
    renderPanel()
    await screen.findByTestId("presets-panel")
    clickTab("ui.settingsTabBadge")
    const rankings = activeBadgePanel()
    expect(within(rankings).queryByTestId("poster-layout-card")).toBeNull()
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    // Stage Fresh: nothing durable yet.
    fireEvent.click(within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    expect(puts).toHaveLength(0)
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
    // Single Save: consistent staged params (ranked scope, stored rank style kept).
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const saved = puts[0].body
    expect(saved["posterLayout"]).toBe("fresh")
    expect(saved["posterFreshScope"]).toBe("ranked")
    expect(saved["rankingBadgeStyle"]).toBe("default")
    expect(saved["ribbonEnabled"]).toBe(true)
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    // The persisted truth drives both the staged preview and the real
    // delivery URL with the same params (no preview/delivery divergence).
    // Shape isolation intact: the portrait edit froze the pre-edit Standard
    // flat into the landscape profile, so landscape stays Standard.
    expect(saved["landscape"]).toMatchObject({ posterLayout: "standard", posterFreshScope: "ranked" })
    const landscape = saved["landscape"] as import("@/lib/server-defaults").LandscapeServerDefaults
    for (const [previewShape, forceShape, expected] of [
      ["portrait", "poster", "fresh"],
      ["landscape", "landscape", "standard"],
    ] as const) {
      const url = buildDefaultsPreviewUrl({
        defaultPosterLayout: saved["posterLayout"] as "fresh",
        defaultPosterFreshScope: saved["posterFreshScope"] as "ranked",
        landscape,
        previewShape,
      })
      const params = new URL(url).searchParams
      expect(params.get("layout")).toBe(expected)
      expect(params.get("freshScope")).toBe("ranked")
      const stremio = buildStremioPosterUrl({
        origin: "http://localhost",
        type: "movie",
        id: 19995,
        defaults: {
          posterLayout: saved["posterLayout"] as "fresh",
          posterFreshScope: saved["posterFreshScope"] as "ranked",
          landscape,
        },
        forceShape,
      })
      expect(stremio.searchParams.get("layout")).toBe(expected)
      expect(stremio.searchParams.get("freshScope")).toBe("ranked")
    }
  })

  it("landscape: Nastro->Fresh->Card+skin->Numero stages profile only; one Save, portrait untouched", async () => {
    const storedBefore = localStorage.getItem("badgeDefaults")
    renderPanel()
    await screen.findByTestId("presets-panel")
    clickTab("ui.settingsTabBadge")
    setShape("landscape")
    expect(within(activeBadgePanel()).queryByTestId("poster-layout-card")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    // Nastro: ribbon variants + side, no badge variants, no skins.
    fireEvent.click(within(rankingsPrimary()).getByRole("radio", { name: "ui.ribbon" }))
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    expect(within(rankingsPrimary()).getByRole("radio", { name: "ui.ribbon" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radiogroup", { name: "ui.ribbon" })).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "ui.position" })).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    expect(puts).toHaveLength(0)
    // Fresh: neither variant nor side rows, ranked-only hint, no skins.
    fireEvent.click(within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }))
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    expect(within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" })).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    expect(within(activeBadgePanel()).getByText("ui.posterFreshScopeHint")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
    // Card: skins appear with the Card hint, still no variant/side rows.
    fireEvent.click(within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }))
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    const skins = within(activeBadgePanel()).getByTestId("poster-layout-skins")
    for (const name of ["ui.posterLayoutSkinProvider", "ui.posterLayoutSkinBlack", "ui.posterLayoutSkinViolet"]) {
      expect(within(skins).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(within(activeBadgePanel()).getByText("ui.posterLayoutScopeHint")).toBeInTheDocument()
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.position" })).toBeNull()
    // Picking a skin keeps Card checked in the single primary group.
    fireEvent.click(within(skins).getByRole("radio", { name: "ui.posterLayoutSkinViolet" }))
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    expect(within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" })).toHaveAttribute("aria-checked", "true")
    expect(within(skins).getByRole("radio", { name: "ui.posterLayoutSkinViolet" })).toHaveAttribute("aria-checked", "true")
    expect(puts).toHaveLength(0)
    // Numero: side only, no ribbon/badge variants, no skins.
    fireEvent.click(within(rankingsPrimary()).getByRole("radio", { name: "ui.number" }))
    expect(checkedNames(rankingsPrimary())).toHaveLength(1)
    expect(within(rankingsPrimary()).getByRole("radio", { name: "ui.number" })).toHaveAttribute("aria-checked", "true")
    expect(screen.queryByRole("radiogroup", { name: "ui.ribbon" })).toBeNull()
    expect(screen.queryByRole("radiogroup", { name: "ui.styleRankingDefault" })).toBeNull()
    expect(screen.getByRole("radiogroup", { name: "ui.position" })).toBeInTheDocument()
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    // Staged-only: zero PUT/storage until the single global Save.
    expect(puts).toHaveLength(0)
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
    // Single Save: landscape profile carries the Numero style with ranked
    // scope; the portrait flat stays byte-identical (Standard/default).
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const saved = puts[0].body
    expect(saved["posterLayout"]).toBe("standard")
    expect(saved["rankingBadgeStyle"]).toBe("default")
    expect(saved["posterFreshScope"]).toBe("ranked")
    expect(saved["landscape"]).toMatchObject({ rankingBadgeStyle: "number", posterFreshScope: "ranked" })
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    // Portrait delivery unchanged (Standard); landscape resolves Standard
    // after the closing Numero reset — preview and delivery agree, ranked.
    const landscape = saved["landscape"] as import("@/lib/server-defaults").LandscapeServerDefaults
    for (const [previewShape, forceShape] of [["portrait", "poster"], ["landscape", "landscape"]] as const) {
      const url = buildDefaultsPreviewUrl({
        defaultPosterLayout: saved["posterLayout"] as "standard",
        defaultPosterFreshScope: saved["posterFreshScope"] as "ranked",
        landscape,
        previewShape,
      })
      const params = new URL(url).searchParams
      expect(params.get("layout")).toBe("standard")
      expect(params.get("freshScope")).toBe("ranked")
      const stremio = buildStremioPosterUrl({
        origin: "http://localhost",
        type: "movie",
        id: 19995,
        defaults: {
          posterLayout: saved["posterLayout"] as "standard",
          posterFreshScope: saved["posterFreshScope"] as "ranked",
          landscape,
        },
        forceShape,
      })
      expect(stremio.searchParams.get("layout")).toBe("standard")
      expect(stremio.searchParams.get("freshScope")).toBe("ranked")
    }
  })

  it("failed Save retains the staged presentation with no extra writes", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    clickTab("ui.settingsTabBadge")
    fireEvent.click(within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }))
    putOk = false
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.saveError")
    expect(puts).toHaveLength(1)
    // Draft retained: Card still checked, Save still available, no retry storm.
    expect(
      within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    ).toHaveAttribute("aria-checked", "true")
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    expect(puts).toHaveLength(1)
  })
})
