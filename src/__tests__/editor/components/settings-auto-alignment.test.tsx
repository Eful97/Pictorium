/**
 * Logo alignment Auto-only (settings UI + shared staged session):
 * - no Position > Logo alignment selector/card/subgroup in any SettingsPanel
 *   primary tab, portrait or landscape, staged or legacy;
 * - title logo + background tuning and the network-position override stay;
 * - no empty Position card while the network logo is off;
 * - a stored explicit flat/profile alignment stages to Auto (flat null +
 *   profile null) with zero PUT/storage/outer writes before the global Save;
 * - the single Save clears both keys atomically; failure keeps the draft;
 * - preset application (snapshot or personal) cannot reintroduce explicit
 *   alignment; staged preview URLs render Auto in both shapes.
 * Server/query/env/schema/renderer contracts are untouched: explicit
 * `?align=center` keeps rendering explicitly (covered by the preserved
 * poster-config/poster-url suites, not duplicated here).
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
import { buildDefaultsPreviewUrl, type DefaultsPreviewParams } from "@/lib/poster-url"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import type { VisualPresetValues } from "@/lib/visual-presets"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const CENTER_SEED = JSON.stringify({
  defaultLogoAlign: "center",
  landscape: { logoAlign: "center" },
})

describe("settings Auto alignment (UI)", () => {
  let puts: { url: string; body: Record<string, unknown> }[]

  beforeEach(() => {
    localStorage.clear()
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
    // Fresh open lands on Preferenze (secondary): the format target and the
    // badge controls under test live on primary tabs.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
    return { ctx: () => ctx as unknown as PosterEditorCtx }
  }

  function clickTab(name: string) {
    fireEvent.click(screen.getByRole("tab", { name }))
  }

  function setShape(shape: "portrait" | "landscape") {
    const label = shape === "portrait" ? "ui.posterShapePortrait" : "ui.posterShapeLandscape"
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText(label))
  }

  it("no logo-alignment selector in any primary tab, both shapes; logo/background/network stay", async () => {
    localStorage.setItem("badgeDefaults", CENTER_SEED)
    renderPanel()
    await screen.findByTestId("presets-panel")
    for (const tab of [
      "ui.settingsTabPreset",
      "ui.settingsTabInformation",
      "ui.settingsTabBadge",
      "ui.settingsTabTransform",
    ]) {
      clickTab(tab)
      // Hidden sibling tabpanels stay mounted: a global query proves no
      // alignment subgroup survives anywhere, staged or legacy.
      expect(screen.queryByText("ui.logoAlign")).toBeNull()
      expect(screen.queryByRole("group", { name: "ui.logoAlign" })).toBeNull()
    }
    // Portrait Transform: title logo + background tuning remain, the
    // network-position override stays while the network is enabled.
    clickTab("ui.settingsTabTransform")
    const portrait = screen.getByRole("tabpanel", { name: "ui.transform" })
    expect(within(portrait).getByTestId("transform-geo-logo")).toBeInTheDocument()
    expect(within(portrait).getByTestId("transform-geo-gradient")).toBeInTheDocument()
    expect(within(portrait).getByTestId("transform-geo-position")).toBeInTheDocument()
    expect(within(portrait).getByTestId("transform-netpos-group")).toBeInTheDocument()
    // Landscape Transform: same Auto-only rule, landscape override group.
    setShape("landscape")
    expect(screen.queryByText("ui.logoAlign")).toBeNull()
    expect(screen.queryByRole("group", { name: "ui.logoAlign" })).toBeNull()
    expect(within(screen.getByRole("tabpanel", { name: "ui.transform" })).getByTestId("landscape-netpos-group")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
  })

  it("stored explicit alignment stages Auto with no writes before Save; one Save clears both keys", async () => {
    localStorage.setItem("badgeDefaults", CENTER_SEED)
    const storedBefore = localStorage.getItem("badgeDefaults")
    const { ctx } = renderPanel()
    await screen.findByTestId("presets-panel")
    // Opening stages the migration only: no PUT, no storage mutation, the
    // authoritative outer truth still carries the stored explicit value.
    expect(puts).toHaveLength(0)
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
    expect(ctx().defaultLogoAlign).toBe("center")
    // The migration reads as dirty (Save enabled, honest status).
    expect(screen.getByTestId("settings-save")).not.toBeDisabled()
    expect(screen.getByTestId("settings-save-status")).toHaveTextContent("ui.unsavedChanges")
    // Single Save clears flat + landscape alignment atomically and stays.
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body["logoAlign"]).toBeNull()
    expect(puts[0].body["landscape"]).toMatchObject({ logoAlign: null })
    expect(ctx().defaultLogoAlign).toBeNull()
    expect(screen.getByTestId("settings-save")).toBeDisabled()
  })

  it("network off renders no empty Position card in either shape", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const offNetwork = () => {
      clickTab("ui.settingsTabInformation")
      const netSwitch = screen.getByRole("switch", { name: "ui.networkLogo" })
      if (netSwitch.getAttribute("aria-checked") !== "false") fireEvent.click(netSwitch)
      clickTab("ui.settingsTabTransform")
    }
    // Landscape off through the profile override: no Position card at all.
    setShape("landscape")
    offNetwork()
    const landscape = screen.getByRole("tabpanel", { name: "ui.transform" })
    expect(within(landscape).queryByTestId("landscape-netpos-group")).toBeNull()
    expect(screen.queryByText("ui.logoAlign")).toBeNull()
    // Portrait flat untouched by the override: its Position card stays.
    setShape("portrait")
    const portraitOn = screen.getByRole("tabpanel", { name: "ui.transform" })
    expect(within(portraitOn).getByTestId("transform-geo-position")).toBeInTheDocument()
    // Portrait off through the flat: no empty Position card either, while
    // title logo + background tuning remain reachable.
    offNetwork()
    const portrait = screen.getByRole("tabpanel", { name: "ui.transform" })
    expect(within(portrait).queryByTestId("transform-geo-position")).toBeNull()
    expect(within(portrait).queryByTestId("transform-netpos-group")).toBeNull()
    expect(within(portrait).getByTestId("transform-geo-logo")).toBeInTheDocument()
    expect(within(portrait).getByTestId("transform-geo-gradient")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
  })
})

describe("settings Auto alignment (staged session)", () => {
  let putBodies: unknown[]
  let putOk = true

  function wrapper({ children }: { children: ReactNode }) {
    return <PosterEditorProvider>{children}</PosterEditorProvider>
  }

  beforeEach(() => {
    window.history.pushState({}, "", "/")
    localStorage.clear()
    localStorage.setItem("badgeDefaults", CENTER_SEED)
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

  it("session opens Auto-normalized with the outer baseline untouched and nothing persisted", async () => {
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
    // Staged: flat null + profile null (follow = Auto pixels in preview).
    expect(probe.session!.value.defaultLogoAlign).toBeNull()
    expect(probe.session!.value.landscape.logoAlign).toBeNull()
    // Outer truth untouched until the global Save; migration reads as dirty.
    expect(outerSeen!.defaultLogoAlign).toBe("center")
    expect(probe.session!.dirty).toBe(true)
    expect(putBodies).toEqual([])
    expect(localStorage.getItem("badgeDefaults")).toBe(storedBefore)
  })

  it("preset application cannot reintroduce explicit alignment", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    expect(result.current.value.defaultLogoAlign).toBeNull()
    act(() => {
      // Legacy preset snapshot carrying an explicit alignment in both layers.
      result.current.value.applyVisualPreset(
        {
          defaultLogoAlign: "center",
          landscape: { logoAlign: "center" },
        } as unknown as VisualPresetValues,
        "portrait",
      )
    })
    expect(result.current.value.defaultLogoAlign).toBeNull()
    expect(result.current.value.landscape.logoAlign).toBeNull()
    act(() => {
      result.current.value.setLandscape({ logoAlign: "center" })
    })
    expect(result.current.value.landscape.logoAlign).toBeNull()
    expect(putBodies).toEqual([])
  })

  it("staged preview URLs render Auto in both shapes (align omitted)", () => {
    const base: DefaultsPreviewParams = {
      lang: "it",
      defaultPosterShape: "poster",
      defaultLogoAlign: null,
      landscape: { logoAlign: null },
    }
    const portrait = new URL(buildDefaultsPreviewUrl(base), "http://localhost").searchParams
    expect(portrait.get("shape")).toBe("poster")
    expect(portrait.has("align")).toBe(false)
    const landscape = new URL(
      buildDefaultsPreviewUrl({ ...base, previewShape: "landscape" }),
      "http://localhost",
    ).searchParams
    expect(landscape.get("shape")).toBe("landscape")
    // Null (auto) stays omitted: the server resolves landscape "left"
    // itself, so legacy preview URLs stay byte-identical.
    expect(landscape.has("align")).toBe(false)
  })

  it("staged session preview + post-save Stremio URLs stay Auto in both shapes (actual session, parity)", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    // Actual staged session (center-seeded) drives the real preview builder:
    // no hand-built null params — the staged value itself must render Auto.
    for (const previewShape of ["portrait", "landscape"] as const) {
      const { url } = buildDefaultsPreviewUrlFromEditor(result.current.value, {
        tmdbKey: "",
        userId: null,
        lang: "it",
        demoMedia: null,
        previewShape,
        previewFamily: null,
      })
      const params = new URL(url).searchParams
      expect(params.get("shape")).toBe(previewShape === "landscape" ? "landscape" : "poster")
      expect(params.has("align")).toBe(false)
    }
    // Single Save clears both keys; the persisted PUT body then drives the
    // real Stremio builder for both shapes — Auto (omitted) in each.
    let res: { ok: boolean } = { ok: false }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(true)
    expect(putBodies).toHaveLength(1)
    const saved = putBodies[0] as Record<string, unknown>
    expect(saved["logoAlign"]).toBeNull()
    expect(saved["landscape"]).toMatchObject({ logoAlign: null })
    for (const forceShape of ["poster", "landscape"] as const) {
      const stremio = buildStremioPosterUrl({
        origin: "http://localhost",
        type: "movie",
        id: 19995,
        defaults: {
          logoAlign: (saved["logoAlign"] as "left" | "center" | null) ?? undefined,
          landscape: saved["landscape"] as import("@/lib/server-defaults").LandscapeServerDefaults,
        },
        forceShape,
      })
      // Portrait never carries align (centered by contract); landscape Auto
      // (null) resolves server-side, so the param stays omitted in both.
      expect(stremio.searchParams.has("align")).toBe(false)
    }
  })

  it("delayed hydration preserves the Auto migration + unrelated settings and stays savable (no phantom conflict)", async () => {
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
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    // Migration-only draft is open (Auto, dirty) before hydration lands.
    expect(result.current.value.defaultLogoAlign).toBeNull()
    expect(result.current.value.landscape.logoAlign).toBeNull()
    expect(result.current.dirty).toBe(true)
    // Delayed hydration: server truth carries an unrelated edit while the
    // stored explicit center is still present on both layers.
    await act(async () => {
      resolveGet({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          defaultGradientHeight: 45,
          defaultLogoAlign: "center",
          landscape: { logoAlign: "center" },
        }),
      })
      await vi.advanceTimersByTimeAsync(600)
    })
    await settle()
    // Migration-only normalization must survive hydration: still Auto, the
    // hydrated unrelated setting adopted (no silent data loss), no conflict.
    expect(result.current.value.defaultLogoAlign).toBeNull()
    expect(result.current.value.landscape.logoAlign).toBeNull()
    expect(result.current.value.defaultGradientHeight).toBe(45)
    expect(result.current.conflict).toBe(false)
    // …and stay savable: one PUT clears both keys and preserves hydration.
    let res: { ok: boolean } = { ok: false }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(true)
    expect(result.current.conflict).toBe(false)
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0] as Record<string, unknown>).toMatchObject({
      logoAlign: null,
      gradientHeight: 45,
      landscape: { logoAlign: null },
    })
    // Post-save propagation converges: still clean, no conflict loop.
    await settle()
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflict).toBe(false)
    expect(putBodies).toHaveLength(1)
  })

  it("failed Save keeps the staged Auto edits with the outer truth intact", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
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
    expect((putBodies[0] as Record<string, unknown>)["logoAlign"]).toBeNull()
    expect((putBodies[0] as Record<string, unknown>)["landscape"]).toMatchObject({ logoAlign: null })
    // Draft retained: Auto normalization plus the unrelated staged edit.
    expect(result.current.value.defaultLogoAlign).toBeNull()
    expect(result.current.value.landscape.logoAlign).toBeNull()
    expect(result.current.value.defaultBadgeYear).toBe(false)
    expect(result.current.dirty).toBe(true)
    expect(result.current.result?.ok).toBe(false)
  })
})
