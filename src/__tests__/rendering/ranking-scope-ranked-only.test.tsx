/**
 * Fresh/Card ranked-only scope (user-confirmed: Fresh and provider Cards live
 * ONLY in Classifiche and ONLY on posters with a ranking; no "every poster"
 * option):
 * - renderer truth on the real supported `ranked` path: a valid DISPLAYED
 *   rank (the resolved topBadge numeral, rankingEnabled-gated upstream)
 *   activates Fresh (1..100) / Card (1..20); absent/invalid rank, an
 *   extra-only top badge (award/upcoming/new/custom — never a rank numeral)
 *   or rankings OFF all fall back to Standard;
 * - staged settings session: a stored explicit `"all"` (flat and/or
 *   landscape profile) stages to `"ranked"` with zero PUT/storage/outer
 *   writes before the single global Save, which persists `"ranked"` in both
 *   layers; preset application (either shape) and landscape patches cannot
 *   reintroduce `"all"`; staged previews and post-save delivery URLs carry
 *   `freshScope=ranked` in both shapes;
 * - SettingsPanel Rankings tab: the layout/style choices (Fresh + Card
 *   skins) stay, the all-posters scope choice is gone in both shapes, the
 *   stored design selection survives rankings OFF with no scope bypass.
 * Server/query/env/schema/renderer contracts are untouched: explicit
 * `?freshScope=all` (per-title mapping, config token, old callers) keeps
 * rendering explicitly (covered by the preserved poster-config/poster-url
 * suites, not duplicated here).
 */
import type { ReactNode } from "react"
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { PosterEditorProvider, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { renderWithCtx } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { isEffectiveFreshLayout, isFreshRank } from "@/lib/fresh-layout"
import { isEffectiveCardLayout } from "@/lib/card-layout-skins"
import { isCardRankDisplayable } from "@/lib/card-layout-geometry"
import type { VisualPresetValues } from "@/lib/visual-presets"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

/**
 * Service topBadge derivation mirror (`poster-service.ts`: the single
 * renderer resolves `topBadge` once; Fresh/Card read ONLY
 * `topBadge?.type === "rank" ? topBadge.rank : null`). Informational buckets
 * (award/upcoming/new/extra) and custom text resolve to `type: "extra"`,
 * rankings OFF resolves to null — none of them is ever a rank numeral.
 */
type TopBadge =
  | { type: "extra"; label: string }
  | { type: "rank"; rank: number; label: string }
  | null
function displayedRank(topBadge: TopBadge): number | null {
  return topBadge?.type === "rank" ? topBadge.rank : null
}

describe("ranked-only renderer semantics (supported ranked path, no new renderer)", () => {
  it("Fresh activates only with a valid displayed rank 1..100", () => {
    expect(isEffectiveFreshLayout("fresh", "ranked", 1)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", "ranked", 7)).toBe(true)
    expect(isEffectiveFreshLayout("fresh", "ranked", 100)).toBe(true)
    // No rank => Standard (never an invented numeral).
    expect(isEffectiveFreshLayout("fresh", "ranked", null)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", undefined)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", 0)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", -3)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", 101)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", 7.5)).toBe(false)
    expect(isEffectiveFreshLayout("fresh", "ranked", Number.NaN)).toBe(false)
    // Other layouts never count as Fresh, even with a rank.
    expect(isEffectiveFreshLayout("standard", "ranked", 7)).toBe(false)
    expect(isEffectiveFreshLayout("provider-glass", "ranked", 7)).toBe(false)
    // Rank predicate itself: integers 1..100 only.
    expect(isFreshRank(1)).toBe(true)
    expect(isFreshRank(100)).toBe(true)
    expect(isFreshRank(0)).toBe(false)
    expect(isFreshRank(101)).toBe(false)
  })

  it("Card skins activate only with a valid displayed rank 1..20", () => {
    expect(isEffectiveCardLayout("provider-glass", "ranked", 1)).toBe(true)
    expect(isEffectiveCardLayout("provider-glass", "ranked", 7)).toBe(true)
    expect(isEffectiveCardLayout("nuvio", "ranked", 20)).toBe(true)
    expect(isEffectiveCardLayout("stremio", "ranked", 20)).toBe(true)
    // No rank => Standard.
    expect(isEffectiveCardLayout("provider-glass", "ranked", null)).toBe(false)
    expect(isEffectiveCardLayout("nuvio", "ranked", undefined)).toBe(false)
    // Card stops at 20 (Fresh keeps 100): 21+ falls back to Standard.
    expect(isEffectiveCardLayout("provider-glass", "ranked", 21)).toBe(false)
    expect(isEffectiveCardLayout("stremio", "ranked", 100)).toBe(false)
    expect(isCardRankDisplayable(20)).toBe(true)
    expect(isCardRankDisplayable(21)).toBe(false)
    expect(isCardRankDisplayable(0)).toBe(false)
    expect(isCardRankDisplayable("7")).toBe(false)
    // Non-card layouts never count, even with a rank.
    expect(isEffectiveCardLayout("standard", "ranked", 7)).toBe(false)
    expect(isEffectiveCardLayout("fresh", "ranked", 7)).toBe(false)
  })

  it("an extra/award/upcoming badge alone is NOT a ranking (no numeral, no layout)", () => {
    // Informational top badges resolve to type "extra": the displayed rank
    // derivation yields null, so neither layout activates under ranked scope.
    const award: TopBadge = { type: "extra", label: "Absolute Cinema" }
    const upcoming: TopBadge = { type: "extra", label: "Coming Soon" }
    const custom: TopBadge = { type: "extra", label: "Da non perdere" }
    for (const badge of [award, upcoming, custom]) {
      expect(displayedRank(badge)).toBeNull()
      expect(isEffectiveFreshLayout("fresh", "ranked", displayedRank(badge))).toBe(false)
      expect(isEffectiveCardLayout("provider-glass", "ranked", displayedRank(badge))).toBe(false)
    }
    // Rankings OFF (master off => no permitted rank => topBadge null) also
    // cannot activate either style, while a real rank still can.
    const rankingsOff: TopBadge = null
    expect(displayedRank(rankingsOff)).toBeNull()
    expect(isEffectiveFreshLayout("fresh", "ranked", displayedRank(rankingsOff))).toBe(false)
    expect(isEffectiveCardLayout("nuvio", "ranked", displayedRank(rankingsOff))).toBe(false)
    const realRank: TopBadge = { type: "rank", rank: 7, label: "#7" }
    expect(displayedRank(realRank)).toBe(7)
    expect(isEffectiveFreshLayout("fresh", "ranked", displayedRank(realRank))).toBe(true)
    expect(isEffectiveCardLayout("nuvio", "ranked", displayedRank(realRank))).toBe(true)
  })
})

const ALL_SCOPE_SEED = JSON.stringify({
  defaultPosterLayout: "fresh",
  defaultPosterFreshScope: "all",
  landscape: { posterLayout: "fresh", posterFreshScope: "all" },
})

function sessionWrapper({ children }: { children: ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

describe("ranked-only scope (staged session)", () => {
  let putBodies: unknown[]
  let putOk = true

  beforeEach(() => {
    window.history.pushState({}, "", "/")
    localStorage.clear()
    localStorage.setItem("badgeDefaults", ALL_SCOPE_SEED)
    putBodies = []
    putOk = true
    vi.useFakeTimers()
    // Hydration GET answers 404 (no server merge write): the provider keeps
    // the seeded local truth, so "no writes before Save" is exact.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: putOk, status: putOk ? 200 : 500, headers: { get: () => null }, json: async () => ({}) }
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
  }

  it("stored all stages ranked in both layers with no writes; outer baseline keeps all", async () => {
    let outerSeen: PosterEditorCtx | null = null
    function OuterProbe() {
      outerSeen = usePosterEditor()
      return null
    }
    function SessionProbe() {
      const session = useSettingsSession()
      ;(SessionProbe as unknown as { session?: SettingsSessionResult }).session = session
      return null
    }
    const storedBefore = localStorage.getItem("badgeDefaults")
    render(
      <PosterEditorProvider>
        <OuterProbe />
        <SessionProbe />
      </PosterEditorProvider>,
    )
    await settle()
    const probe = SessionProbe as unknown as { session?: SettingsSessionResult }
    // Staged: ranked in both layers (landscape profile ranked, not dropped).
    expect(probe.session!.value.defaultPosterFreshScope).toBe("ranked")
    expect(probe.session!.value.landscape.posterFreshScope).toBe("ranked")
    // The stored design selection survives (only the scope migrates).
    expect(probe.session!.value.defaultPosterLayout).toBe("fresh")
    // Outer truth untouched until the global Save; migration reads as dirty.
    expect(outerSeen!.defaultPosterFreshScope).toBe("all")
    expect(probe.session!.dirty).toBe(true)
    expect(putBodies).toEqual([])
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
  })

  it("single Save persists ranked flat + ranked profile and stays", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper: sessionWrapper })
    await settle()
    expect(putBodies).toEqual([])
    let res: { ok: boolean } = { ok: false }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(true)
    expect(putBodies).toHaveLength(1)
    const saved = putBodies[0] as Record<string, unknown>
    expect(saved["posterFreshScope"]).toBe("ranked")
    expect(saved["landscape"]).toMatchObject({ posterFreshScope: "ranked" })
    expect(saved["posterLayout"]).toBe("fresh")
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflict).toBe(false)
    await settle()
    expect(putBodies).toHaveLength(1)
  })

  it("explicit all writes, landscape patches and preset applies cannot reintroduce all", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper: sessionWrapper })
    await settle()
    act(() => {
      result.current.value.setDefaultPosterFreshScope("all")
    })
    expect(result.current.value.defaultPosterFreshScope).toBe("ranked")
    act(() => {
      result.current.value.setLandscape({ posterFreshScope: "all" })
    })
    expect(result.current.value.landscape.posterFreshScope).toBe("ranked")
    // Legacy preset snapshot carrying an explicit all in both layers.
    act(() => {
      result.current.value.applyVisualPreset(
        {
          defaultPosterLayout: "fresh",
          defaultPosterFreshScope: "all",
          landscape: { posterLayout: "fresh", posterFreshScope: "all" },
        } as unknown as VisualPresetValues,
        "portrait",
      )
    })
    expect(result.current.value.defaultPosterFreshScope).toBe("ranked")
    expect(result.current.value.landscape.posterFreshScope).toBe("ranked")
    act(() => {
      result.current.value.applyVisualPreset(
        { landscape: { posterLayout: "nuvio", posterFreshScope: "all" } } as unknown as VisualPresetValues,
        "landscape",
      )
    })
    expect(result.current.value.landscape.posterFreshScope).toBe("ranked")
    expect(putBodies).toEqual([])
  })

  it("staged preview URLs carry ranked in both shapes; post-save delivery stays ranked in both shapes", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper: sessionWrapper })
    await settle()
    // Actual staged session (all-seeded) drives the real preview builder:
    // no hand-built scope params — the staged value itself must render ranked.
    for (const previewShape of ["portrait", "landscape"] as const) {
      const { url } = buildDefaultsPreviewUrlFromEditor(result.current.value, {
        tmdbKey: "",
        userId: null,
        lang: "it",
        demoMedia: null,
        previewShape,
        previewFamily: null,
      })
      expect(new URL(url).searchParams.get("freshScope")).toBe("ranked")
    }
    let res: { ok: boolean } = { ok: false }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(true)
    expect(putBodies).toHaveLength(1)
    const saved = putBodies[0] as Record<string, unknown>
    // The persisted PUT body then drives the real Stremio builder for both
    // delivery shapes — ranked (explicit) in each, layout intact.
    for (const forceShape of ["poster", "landscape"] as const) {
      const stremio = buildStremioPosterUrl({
        origin: "http://localhost",
        type: "movie",
        id: 19995,
        defaults: {
          posterLayout: saved["posterLayout"] as "fresh",
          posterFreshScope: saved["posterFreshScope"] as "ranked",
          landscape: saved["landscape"] as import("@/lib/server-defaults").LandscapeServerDefaults,
        },
        forceShape,
      })
      expect(stremio.searchParams.get("freshScope")).toBe("ranked")
      expect(stremio.searchParams.get("layout")).toBe("fresh")
    }
  })

  it("rankings OFF keeps the stored design selection with no scope bypass", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper: sessionWrapper })
    await settle()
    act(() => {
      result.current.value.setDefaultRankingBadges(false)
    })
    // Design selection stored (no independent layout-all bypass exists to
    // clear it, and ranked scope needs no rank to stay selected).
    expect(result.current.value.defaultPosterLayout).toBe("fresh")
    expect(result.current.value.defaultPosterFreshScope).toBe("ranked")
    expect(putBodies).toEqual([])
  })

  it("delayed hydration preserves the ranked migration + unrelated settings and stays savable (no phantom conflict)", async () => {
    let resolveGet!: (v: unknown) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: putOk, status: putOk ? 200 : 500, headers: { get: () => null }, json: async () => ({}) }
        }
        if (!String(_url).includes("/api/defaults")) {
          return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
        }
        return new Promise((res) => {
          resolveGet = res as (v: unknown) => void
        })
      }),
    )
    const { result } = renderHook(() => useSettingsSession(), { wrapper: sessionWrapper })
    // Migration-only draft is open (ranked, dirty) before hydration lands.
    expect(result.current.value.defaultPosterFreshScope).toBe("ranked")
    expect(result.current.value.landscape.posterFreshScope).toBe("ranked")
    expect(result.current.dirty).toBe(true)
    // Delayed hydration: server truth carries an unrelated edit while the
    // stored explicit all is still present in both layers.
    await act(async () => {
      resolveGet({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          defaultGradientHeight: 45,
          defaultPosterLayout: "fresh",
          defaultPosterFreshScope: "all",
          landscape: { posterLayout: "fresh", posterFreshScope: "all" },
        }),
      })
      await vi.advanceTimersByTimeAsync(600)
    })
    await settle()
    // Migration-only normalization must survive hydration: still ranked, the
    // hydrated unrelated setting adopted (no silent data loss), no conflict.
    expect(result.current.value.defaultPosterFreshScope).toBe("ranked")
    expect(result.current.value.landscape.posterFreshScope).toBe("ranked")
    expect(result.current.value.defaultPosterLayout).toBe("fresh")
    expect(result.current.value.defaultGradientHeight).toBe(45)
    expect(result.current.conflict).toBe(false)
    // …and stay savable: one PUT persists ranked and preserves hydration.
    let res: { ok: boolean } = { ok: false }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(true)
    expect(result.current.conflict).toBe(false)
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0] as Record<string, unknown>).toMatchObject({
      posterFreshScope: "ranked",
      gradientHeight: 45,
      posterLayout: "fresh",
      landscape: { posterFreshScope: "ranked" },
    })
    // Post-save propagation converges: still clean, no conflict loop.
    await settle()
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflict).toBe(false)
    expect(putBodies).toHaveLength(1)
  })

  it("failed Save keeps the staged ranked edits with the outer truth intact", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper: sessionWrapper })
    await settle()
    act(() => {
      result.current.value.setDefaultBadgeYear(false)
    })
    putOk = false
    let res = { ok: true }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(false)
    expect(putBodies).toHaveLength(1)
    expect((putBodies[0] as Record<string, unknown>)["posterFreshScope"]).toBe("ranked")
    expect((putBodies[0] as Record<string, unknown>)["landscape"]).toMatchObject({ posterFreshScope: "ranked" })
    // Draft retained: ranked normalization plus the unrelated staged edit.
    expect(result.current.value.defaultPosterFreshScope).toBe("ranked")
    expect(result.current.value.landscape.posterFreshScope).toBe("ranked")
    expect(result.current.value.defaultBadgeYear).toBe(false)
    expect(result.current.dirty).toBe(true)
    expect(result.current.result?.ok).toBe(false)
  })
})

describe("ranked-only scope (SettingsPanel Rankings UI)", () => {
  let puts: { url: string; body: Record<string, unknown> }[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("badgeDefaults", ALL_SCOPE_SEED)
    puts = []
    resetGuestGuardForTests()
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url)
        if (init?.method === "PUT" && u.includes("/api/defaults")) {
          puts.push({ url: u, body: JSON.parse(init.body as string) })
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
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

  afterEach(() => {
    vi.unstubAllGlobals()
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

  function setShape(shape: "portrait" | "landscape") {
    const label = shape === "portrait" ? "ui.posterShapePortrait" : "ui.posterShapeLandscape"
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText(label))
  }

  /** The visible badge tabpanel (the three five-tab instances stay mounted). */
  function activeBadgePanel() {
    const panels = screen.getAllByRole("tabpanel", { name: "ui.badgeSection" })
    const active = panels.find((p) => p.getAttribute("hidden") === null)
    expect(active).toBeDefined()
    return active!
  }

  function expectNoScopeChoice() {
    // No all-posters choice reachable anywhere: the selector, its select,
    // and the "All titles" option are gone from every mounted tabpanel.
    expect(screen.queryByTestId("fresh-scope-selector")).toBeNull()
    expect(screen.queryByTestId("fresh-scope-select")).toBeNull()
    expect(screen.queryByText("ui.posterFreshScopeAll")).toBeNull()
  }

  it("Badge owns the unified presentation with no all-posters choice, both shapes; Save persists ranked", async () => {
    const storedBefore = localStorage.getItem("badgeDefaults")
    renderPanel()
    await screen.findByTestId("presets-panel")
    clickTab("ui.settingsTabBadge")
    // Seeded Fresh stays selected (stored design preserved) in the single
    // exclusive presentation group — no separate layout card anywhere.
    const rankings = activeBadgePanel()
    expect(within(rankings).queryByTestId("poster-layout-card")).toBeNull()
    const group = within(rankings).getByTestId("ranking-presentation")
    const primary = within(group).getByRole("radiogroup", { name: "ui.rankFamily" })
    const options = within(primary).getAllByRole("radio")
    expect(options).toHaveLength(5)
    for (const name of ["ui.ribbon", "ui.number", "ui.badgeSection", "ui.posterLayoutGroupedFresh", "ui.posterLayoutGroupedCard"]) {
      expect(within(primary).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(within(primary).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" })).toHaveAttribute("aria-checked", "true")
    expect(options.filter((o) => o.getAttribute("aria-checked") === "true")).toHaveLength(1)
    // Card skins stay hidden until Card is selected…
    expect(within(rankings).queryByTestId("poster-layout-skins")).toBeNull()
    // …ranked-only hint instead of the scope dropdown…
    expect(within(rankings).getByText("ui.posterFreshScopeHint")).toBeInTheDocument()
    // …and no all-posters choice anywhere.
    expectNoScopeChoice()
    // Card selection exposes the skin subgroup (Card hint, still no scope choice).
    fireEvent.click(within(primary).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }))
    const skins = within(activeBadgePanel()).getByTestId("poster-layout-skins")
    for (const name of ["ui.posterLayoutSkinProvider", "ui.posterLayoutSkinBlack", "ui.posterLayoutSkinViolet"]) {
      expect(within(skins).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(within(activeBadgePanel()).getByText("ui.posterLayoutScopeHint")).toBeInTheDocument()
    expectNoScopeChoice()
    // Picking a skin keeps Card checked in the single primary group.
    fireEvent.click(within(skins).getByRole("radio", { name: "ui.posterLayoutSkinBlack" }))
    expect(
      within(activeBadgePanel()).getByTestId("ranking-presentation"),
    ).toBeInTheDocument()
    expect(
      within(within(activeBadgePanel()).getByTestId("ranking-presentation")).getByRole("radio", { name: "ui.posterLayoutGroupedCard" }),
    ).toHaveAttribute("aria-checked", "true")
    expect(within(skins).getByRole("radio", { name: "ui.posterLayoutSkinBlack" })).toHaveAttribute("aria-checked", "true")
    // Landscape edit target: same ranked-only rule, no layout card.
    setShape("landscape")
    const landscape = activeBadgePanel()
    expect(within(landscape).queryByTestId("poster-layout-card")).toBeNull()
    expect(within(landscape).getByTestId("ranking-presentation")).toBeInTheDocument()
    expectNoScopeChoice()
    // Opening + editing staged nothing durable before the global Save.
    expect(puts).toHaveLength(0)
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
    // Single Save persists ranked in both layers (portrait Card skin kept,
    // seeded landscape Fresh profile preserved as ranked).
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body["posterLayout"]).toBe("nuvio")
    expect(puts[0].body["posterFreshScope"]).toBe("ranked")
    expect(puts[0].body["landscape"]).toMatchObject({ posterLayout: "fresh", posterFreshScope: "ranked" })
    expect(screen.getByTestId("settings-save")).toBeDisabled()
  })

  it("rankings OFF keeps the stored design with no scope bypass", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    // The on/off masters live in Information now; the presentation look stays
    // in Badge.
    clickTab("ui.settingsTabInformation")
    fireEvent.click(screen.getByRole("switch", { name: "ui.rankingsToggle" }))
    clickTab("ui.settingsTabBadge")
    const group = within(activeBadgePanel()).getByTestId("ranking-presentation")
    expect(
      within(group).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    ).toHaveAttribute("aria-checked", "true")
    // …but no all-posters bypass appears (without a real permitted rank the
    // renderer falls back to Standard by contract).
    expectNoScopeChoice()
    expect(puts).toHaveLength(0)
  })
})
