/**
 * Ready presets own their canonical ranking mode (Standard): Fresh/Card are
 * mutually exclusive ranking presentations (like Nastro/Numero/Badge), so
 * selecting a ready canonical preset restores ITS OWN Standard mode instead
 * of inheriting the current Fresh/Card.
 *
 * - Fresh AND Card seeds, both edit shapes: all six READY thumbs render the
 *   canonical Standard look through the real DefaultsPosterPreview URL
 *   builder (real rank style, layout=standard) — never the current Fresh.
 *   Thumbnail generation is read-only (no draft mutation, no PUT, no storage
 *   write) and a Fresh draft with matching badge visuals never highlights a
 *   Standard ready tile.
 * - Clicking Apple/BetterPoster/quick looks stages Standard explicitly with
 *   the canonical rank style/flags (plus the existing age-off contract); the
 *   unified Classifiche selector then shows the preset Nastro/Numero/Badge.
 * - One global Save persists a consistent PUT (edited-shape Standard, other
 *   shape effective frozen) and preview/delivery agree; personal presets keep
 *   applying verbatim (still inherit Fresh — never rewritten).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { APPLE_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
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

const ALL_IDS = ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]

function seedFreshPortrait() {
  localStorage.setItem(
    "badgeDefaults",
    JSON.stringify({
      defaultPosterShape: "poster",
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "ranked",
      defaultRankingBadgeStyle: "number",
      defaultRibbonEnabled: true,
      defaultGenreBadgeOffsetY: -40,
      defaultLogoOffsetY: -40,
      landscape: {},
    }),
  )
}

function seedCardPortrait() {
  localStorage.setItem(
    "badgeDefaults",
    JSON.stringify({
      defaultPosterShape: "poster",
      defaultPosterLayout: "nuvio",
      defaultPosterFreshScope: "ranked",
      defaultRankingBadgeStyle: "number",
      defaultRibbonEnabled: true,
      landscape: {},
    }),
  )
}

function seedFreshLandscape() {
  localStorage.setItem(
    "badgeDefaults",
    JSON.stringify({
      defaultPosterShape: "poster",
      defaultPosterLayout: "standard",
      defaultPosterFreshScope: "ranked",
      landscape: {
        posterLayout: "fresh",
        posterFreshScope: "ranked",
        rankingBadgeStyle: "number",
      },
    }),
  )
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

function galleryThumbParams(id: string): URLSearchParams {
  const btn = screen.getByTestId(`poster-style-${id}`)
  const img = btn.querySelector("img")
  expect(img, `real thumbnail for ready preset ${id}`).not.toBeNull()
  const src = img?.getAttribute("src") ?? ""
  expect(src).toContain("/api/poster/")
  return new URL(src, "http://localhost").searchParams
}

function storageSnapshot(): string {
  const out: Record<string, string | null> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)!
    if (k.includes("badgeDefaults") || k.includes("pictorium")) out[k] = localStorage.getItem(k)
  }
  return JSON.stringify(out)
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

function activeBadgePanel(): HTMLElement {
  const panels = screen.getAllByRole("tabpanel", { name: "ui.badgeSection" })
  const active = panels.find((p) => p.getAttribute("hidden") === null)
  expect(active).toBeDefined()
  return active!
}

function rankingsPrimary(): HTMLElement {
  const group = within(activeBadgePanel()).getByTestId("ranking-presentation")
  return within(group).getByRole("radiogroup", { name: "ui.rankFamily" })
}

function checkedPresentation(): string[] {
  return within(rankingsPrimary())
    .getAllByRole("radio")
    .filter((o) => o.getAttribute("aria-checked") === "true")
    .map((o) => o.textContent ?? "")
}

describe("ready thumbs stay canonical Standard under Fresh/Card (read-only)", () => {
  it("portrait Fresh seed: six thumbs layout=standard, no highlight, no writes", async () => {
    vi.useRealTimers()
    seedFreshPortrait()
    const { ctx } = renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    await waitFor(() => expect(ctx().defaultPosterLayout).toBe("fresh"))
    const before = storageSnapshot()
    for (const id of ALL_IDS) {
      const params = galleryThumbParams(id)
      expect(params.get("layout")).toBe("standard")
      expect(params.get("freshScope")).toBe("ranked")
    }
    // Real rank style rides along (Apple owns Numero), never the Fresh look.
    expect(galleryThumbParams("apple").get("rs")).toBe("number")
    // Layout-blind false highlight is gone: the Fresh draft never claims Apple.
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "false")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
    expect(ctx().defaultPosterLayout).toBe("fresh")
  })

  it("portrait Card seed: six thumbs layout=standard, no highlight, no writes", async () => {
    vi.useRealTimers()
    seedCardPortrait()
    const { ctx } = renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    await waitFor(() => expect(ctx().defaultPosterLayout).toBe("nuvio"))
    const before = storageSnapshot()
    for (const id of ALL_IDS) {
      expect(galleryThumbParams(id).get("layout")).toBe("standard")
    }
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "false")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
    expect(ctx().defaultPosterLayout).toBe("nuvio")
  })

  it("landscape Fresh profile seed: six thumbs layout=standard, no writes", async () => {
    vi.useRealTimers()
    seedFreshLandscape()
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-apple")
    switchEditTargetToLandscape()
    await waitFor(() =>
      expect(
        (ctx().landscape as unknown as Record<string, unknown>).posterLayout ?? ctx().defaultPosterLayout,
      ).toBe("fresh"),
    )
    const before = storageSnapshot()
    for (const id of ALL_IDS) {
      expect(galleryThumbParams(id).get("layout")).toBe("standard")
    }
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "false")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
  })
})

describe("ready apply stages Standard with canonical rank (edited shape only)", () => {
  it("portrait Fresh -> Apple: standard + numero, landscape frozen fresh, one Save", async () => {
    vi.useRealTimers()
    seedFreshPortrait()
    renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(galleryThumbParams("apple").get("layout")).toBe("standard")
    expect(puts).toHaveLength(0)
    // Unified Classifiche reads the preset Numero (own ranking mode, not Fresh).
    openRankingsTab()
    expect(checkedPresentation()).toHaveLength(1)
    expect(
      within(rankingsPrimary()).getByRole("radio", { name: "ui.number" }),
    ).toHaveAttribute("aria-checked", "true")
    // Single Save: edited portrait owns Standard + canonical rank; the other
    // shape keeps its pre-edit Fresh effective (frozen, not flipped).
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    expect(body.posterLayout).toBe("standard")
    expect(body.posterFreshScope).toBe("ranked")
    expect(body.rankingBadgeStyle).toBe("number")
    expect(body.ribbonEnabled).toBe(true)
    expect(body.ageBadge).toBe(false)
    expect(body.landscape).toMatchObject({ posterLayout: "fresh" })
    expect(screen.getByTestId("settings-save")).toBeDisabled()
  })

  it("portrait Fresh -> BetterPoster + Full: standard with own rank style", async () => {
    vi.useRealTimers()
    seedFreshPortrait()
    renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    fireEvent.click(screen.getByTestId("poster-style-better-poster"))
    expect(screen.getByTestId("poster-style-better-poster")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("poster-style-full"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
    expect(galleryThumbParams("full").get("layout")).toBe("standard")
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body.posterLayout).toBe("standard")
    expect(puts[0].body.rankingBadgeStyle).toBe("netflix")
  })

  it("landscape Fresh profile -> Apple: profile standard, portrait flat untouched", async () => {
    vi.useRealTimers()
    seedFreshLandscape()
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    switchEditTargetToLandscape()
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(galleryThumbParams("apple").get("layout")).toBe("standard")
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    expect(body.posterLayout).toBe("standard")
    const landscape = body.landscape as Record<string, unknown>
    expect(landscape.posterLayout).toBe("standard")
    expect(landscape.posterFreshScope).toBe("ranked")
  })
})

describe("personal presets own their stored look (never inherit the live look)", () => {
  it("personal Apple-values preset owns Standard and converges with the ready tile", async () => {
    vi.useRealTimers()
    seedFreshPortrait()
    presetList = [
      {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Mine",
        shape: "portrait",
        values: APPLE_VISUAL_DEFAULTS,
      },
    ]
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    const mine = await screen.findByTestId("visual-preset-00000000-0000-0000-0000-000000000001")
    const beforeThumb = mine.querySelector("img")?.getAttribute("src") ?? ""
    // The personal thumbnail renders the preset's OWNED Standard layout
    // (stored explicitly, never the live Fresh it was saved under).
    expect(new URL(beforeThumb, "http://localhost").searchParams.get("layout")).toBe("standard")
    fireEvent.click(mine)
    expect(mine).toHaveAttribute("aria-pressed", "true")
    // Convergence: the staged recipe is pixel-identical to the ready Apple
    // look, so the ready tile truthfully claims it too.
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    // Personal apply staged its own Standard layout (never inherited Fresh).
    expect(puts[0].body.posterLayout).toBe("standard")
  })
})

describe("null-profile inheritance freezes the other shape (no fresh->standard leak)", () => {
  it("portrait Fresh flat + null landscape profile -> Apple: landscape frozen fresh", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "fresh",
        defaultPosterFreshScope: "ranked",
        defaultRankingBadgeStyle: "number",
        defaultRibbonEnabled: true,
        landscape: { posterLayout: null },
      }),
    )
    const { ctx } = renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    await waitFor(() => expect(ctx().defaultPosterLayout).toBe("fresh"))
    // Explicit null inherits the flat through every `land ?? flat` chain.
    expect(
      (ctx().landscape as unknown as Record<string, unknown>).posterLayout ?? ctx().defaultPosterLayout,
    ).toBe("fresh")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(galleryThumbParams("apple").get("layout")).toBe("standard")
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    expect(body.posterLayout).toBe("standard")
    expect(body.landscape).toMatchObject({ posterLayout: "fresh" })
    expect(screen.getByTestId("settings-save")).toBeDisabled()
  })

  it("portrait Card flat + null landscape profile -> Apple: landscape frozen card", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "nuvio",
        defaultPosterFreshScope: "ranked",
        defaultRankingBadgeStyle: "number",
        defaultRibbonEnabled: true,
        landscape: { posterLayout: null },
      }),
    )
    const { ctx } = renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    await waitFor(() => expect(ctx().defaultPosterLayout).toBe("nuvio"))
    expect(
      (ctx().landscape as unknown as Record<string, unknown>).posterLayout ?? ctx().defaultPosterLayout,
    ).toBe("nuvio")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(galleryThumbParams("apple").get("layout")).toBe("standard")
    expect(puts).toHaveLength(0)
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    expect(body.posterLayout).toBe("standard")
    expect(body.landscape).toMatchObject({ posterLayout: "nuvio" })
    expect(screen.getByTestId("settings-save")).toBeDisabled()
  })
})

describe("unified Fresh <-> ready transitions keep reset/reclick rules", () => {
  it("Fresh -> Apple -> Fresh: entry reset neutral, reclick preserves, no restore on leave", async () => {
    vi.useRealTimers()
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultPosterLayout: "standard",
        defaultPosterFreshScope: "ranked",
        defaultGenreBadgeOffsetX: 15,
        defaultGenreBadgeOffsetY: -40,
        defaultLogoOffsetX: 12,
        defaultLogoOffsetY: -40,
        landscape: {},
      }),
    )
    renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    openRankingsTab()
    await act(async () => {})
    // Enter Fresh from Standard: neutral entry reset (existing contract).
    fireEvent.click(
      within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    )
    expect(checkedPresentation()).toEqual([expect.stringContaining("Fresh")])
    // Ready detour owns Standard again with its canonical Numero.
    openPresetTab()
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    openRankingsTab()
    expect(
      within(rankingsPrimary()).getByRole("radio", { name: "ui.number" }),
    ).toHaveAttribute("aria-checked", "true")
    // Back to Fresh re-enters neutral (one-way: leaving Fresh never restores).
    fireEvent.click(
      within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    )
    expect(
      within(rankingsPrimary()).getByRole("radio", { name: "ui.posterLayoutGroupedFresh" }),
    ).toHaveAttribute("aria-checked", "true")
    expect(puts).toHaveLength(0)
  })
})
