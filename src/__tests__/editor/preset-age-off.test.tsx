/**
 * Ready presets leave the age classification OFF (six built-in/quick looks:
 * Apple/BetterPoster/RPDB + Essential/Ratings/Full, both edit shapes).
 *
 * - The preset contract carries no age keys (no new preset types); the
 *   opt-out is staged at apply time via `withReadyPresetAgeOff`, so personal
 *   user-authored presets keep applying verbatim.
 * - Edited shape renders `age=0` in the real DefaultsPreview URL builder
 *   (same endpoint as the thumbnails); the other shape's effective output is
 *   preserved.
 * - Information can still enable the badge manually afterwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"
import {
  APPLE_VISUAL_DEFAULTS,
  BETTER_POSTER_VISUAL_DEFAULTS,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import { quickLookDesired, type QuickLookId } from "@/lib/quick-visual-presets"
import {
  applyLandscapeIsolated,
  applyPortraitIsolated,
  withReadyPresetAgeOff,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
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

const BUILT_INS: ReadonlyArray<{ id: string; values: VisualPresetValues }> = [
  { id: "apple", values: APPLE_VISUAL_DEFAULTS },
  { id: "better-poster", values: BETTER_POSTER_VISUAL_DEFAULTS },
  { id: "rpdb", values: RPDB_VISUAL_DEFAULTS },
]
const QUICK_IDS: QuickLookId[] = ["essential", "ratings", "full"]
const ALL_IDS = ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]

function desiredFor(id: string, portrait: boolean): VisualPresetValues {
  const builtin = BUILT_INS.find((b) => b.id === id)
  if (builtin) return builtin.values
  return quickLookDesired(id as QuickLookId, portrait)
}

/** Staged snapshot mirroring the gallery apply path (isolate, then age off). */
function stagedSnapshot(
  id: string,
  shape: "portrait" | "landscape",
  live: { defaultAgeBadge: boolean; defaultPosterShape?: string; landscape: Record<string, unknown> },
): Record<string, unknown> {
  const portrait = shape === "portrait"
  const desired = desiredFor(id, portrait)
  const liveAsValues = { ...live, landscape: live.landscape } as unknown as VisualPresetValues
  const isolated = portrait
    ? applyPortraitIsolated(liveAsValues, desired)
    : applyLandscapeIsolated(liveAsValues, desired)
  return withReadyPresetAgeOff(
    { defaultAgeBadge: live.defaultAgeBadge, landscape: live.landscape },
    isolated as unknown as Record<string, unknown>,
    shape,
  )
}

function ageParam(snapshot: Record<string, unknown>, shape: "portrait" | "landscape"): string | null {
  const url = new URL(buildDefaultsPreviewUrl({ ...(snapshot as object), previewShape: shape } as never))
  return url.searchParams.get("age")
}

describe("ready snapshots carry canonical age-off (never an armed badge)", () => {
  // Built-ins are schema-parsed snapshots: the owned age trio is always
  // present and always the canonical OFF/IT/standard (personal independence
  // made the keys part of the preset contract; ready looks never arm the
  // classification themselves — the ready age-off overlay stays the enforcer
  // at apply time). The landscape profile carries no age keys (inherits).
  it.each(BUILT_INS.map((b) => b.id))("%s carries canonical age-off", (id) => {
    const values = BUILT_INS.find((b) => b.id === id)!.values as unknown as Record<string, unknown>
    expect(values.defaultAgeBadge).toBe(false)
    expect(values.defaultAgeCountry).toBe("IT")
    expect(values.defaultAgeBadgeStyle).toBe("standard")
    const land = (values.landscape ?? {}) as Record<string, unknown>
    expect("ageBadge" in land).toBe(false)
  })
  // Quick looks are unparsed recipe objects (no schema fill): they genuinely
  // carry no age keys and rely on the ready age-off overlay at apply time.
  it.each(QUICK_IDS.flatMap((q) => [`${q}:portrait`, `${q}:landscape`]))(
    "%s carries no age keys (overlay-owned)",
    (id) => {
      const portrait = !id.endsWith(":landscape")
      const base = id.replace(/:(portrait|landscape)$/, "")
      const values = desiredFor(base, portrait) as unknown as Record<string, unknown>
      expect("defaultAgeBadge" in values).toBe(false)
      expect("defaultAgeCountry" in values).toBe(false)
      expect("defaultAgeBadgeStyle" in values).toBe(false)
      const land = (values.landscape ?? {}) as Record<string, unknown>
      expect("ageBadge" in land).toBe(false)
    },
  )
})

describe("withReadyPresetAgeOff (pure, all six, both shapes)", () => {
  const liveOn = { defaultAgeBadge: true, landscape: {} as Record<string, unknown> }
  const liveBothOn = { defaultAgeBadge: true, landscape: { ageBadge: true } as Record<string, unknown> }

  it.each(ALL_IDS)("portrait %s: flat OFF, inheriting landscape frozen to pre-edit ON", (id) => {
    const staged = stagedSnapshot(id, "portrait", liveOn)
    expect(staged.defaultAgeBadge).toBe(false)
    expect((staged.landscape as Record<string, unknown>).ageBadge).toBe(true)
  })

  it.each(ALL_IDS)("portrait %s: explicit landscape value (incl. false) never rewritten", (id) => {
    for (const profileAge of [true, false]) {
      const staged = stagedSnapshot(id, "portrait", {
        defaultAgeBadge: true,
        landscape: { ageBadge: profileAge },
      })
      expect(staged.defaultAgeBadge).toBe(false)
      expect((staged.landscape as Record<string, unknown>).ageBadge).toBe(profileAge)
    }
  })

  it.each(ALL_IDS)("landscape %s: profile OFF, flats byte-identical", (id) => {
    const staged = stagedSnapshot(id, "landscape", liveBothOn)
    expect((staged.landscape as Record<string, unknown>).ageBadge).toBe(false)
    expect(staged.defaultAgeBadge).toBe(true)
  })

  it("preserves delivery shape, age country/style and other keys", () => {
    const staged = stagedSnapshot("apple", "portrait", {
      defaultAgeBadge: true,
      defaultPosterShape: "poster",
      landscape: { ageBadge: true, ageCountry: "FR" },
    })
    expect(staged.defaultPosterShape).toBe("poster")
    expect((staged.landscape as Record<string, unknown>).ageCountry).toBe("FR")
    expect("defaultAgeCountry" in staged).toBe(false)
    expect("defaultAgeBadgeStyle" in staged).toBe(false)
  })
})

describe("real preview URLs (thumbnail path): edited shape age=0", () => {
  it.each(ALL_IDS)("portrait %s previews age=0", (id) => {
    const staged = stagedSnapshot(id, "portrait", { defaultAgeBadge: true, landscape: {} })
    expect(ageParam(staged, "portrait")).toBe("0")
  })

  it.each(ALL_IDS)("landscape %s previews age=0", (id) => {
    const staged = stagedSnapshot(id, "landscape", {
      defaultAgeBadge: true,
      landscape: { ageBadge: true },
    })
    expect(ageParam(staged, "landscape")).toBe("0")
  })
})

function renderBadge(shape: "portrait" | "landscape") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
  return { ctx: () => ctx as PosterEditorCtx }
}

function seedAgeOn() {
  localStorage.setItem("badgeDefaults", JSON.stringify({
    defaultPosterShape: "poster",
    defaultAgeBadge: true,
    landscape: { ageBadge: true },
  }))
}

describe("Badge tab UI: six ready presets disable age in the edited shape", () => {
  it.each(ALL_IDS)("portrait %s: flat OFF, landscape effective preserved, delivery kept", async (id) => {
    seedAgeOn()
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(ctx().defaultAgeBadge).toBe(true)
    fireEvent.click(screen.getByTestId(`poster-style-${id}`))
    expect(ctx().defaultAgeBadge).toBe(false)
    expect((ctx().landscape as Record<string, unknown>).ageBadge).toBe(true)
    expect(ctx().defaultPosterShape).toBe("poster")
  })

  it.each(ALL_IDS)("landscape %s: profile OFF, portrait flat preserved, delivery kept", async (id) => {
    seedAgeOn()
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(screen.getByTestId(`poster-style-${id}`))
    expect((ctx().landscape as Record<string, unknown>).ageBadge).toBe(false)
    expect(ctx().defaultAgeBadge).toBe(true)
    expect(ctx().defaultPosterShape).toBe("poster")
  })

  it("age can still be enabled manually after a preset (Information toggle)", async () => {
    seedAgeOn()
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(ctx().defaultAgeBadge).toBe(false)
    const adv = screen.getByTestId("badge-advanced-toggle")
    if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
    const quality = screen.getByTestId("badge-group-quality-toggle")
    if (quality.getAttribute("aria-expanded") !== "true") fireEvent.click(quality)
    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    expect(ctx().defaultAgeBadge).toBe(true)
  })
})

/**
 * Direct tests of the ACTUAL Preset gallery (PresetsPanel inside the real
 * SettingsPanel staging session — the same hook + PosterEditorValueOverride
 * the production panel uses), not a mirrored snapshot helper.
 *
 * With age initially ON in both shapes these prove, per ready preset and per
 * edit target: the click stages age OFF in the edited shape only (other
 * shape effective preserved, delivery format preserved), the real rendered
 * gallery thumbnail carries age=0, and nothing persists (no PUT, no storage
 * write, outer live truth untouched) before the single global Save.
 */
function storageSnapshot(): string {
  const out: Record<string, string | null> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i)!
    if (k.includes("badgeDefaults") || k.includes("pictorium")) out[k] = localStorage.getItem(k)
  }
  return JSON.stringify(out)
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
  // Fresh open lands on Preferenze (secondary): the gallery + format target
  // used below live on primary tabs.
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

/** Real rendered gallery thumbnail age param for a ready tile (never a fake render). */
function galleryThumbAge(id: string): string | null {
  const btn = screen.getByTestId(`poster-style-${id}`)
  const img = btn.querySelector("img")
  expect(img, `real thumbnail for ready preset ${id}`).not.toBeNull()
  const src = img?.getAttribute("src") ?? ""
  expect(src).toContain("/api/poster/")
  return new URL(src, "http://localhost").searchParams.get("age")
}

function switchEditTargetToLandscape() {
  fireEvent.click(
    within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"),
  )
}

function openPresetTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
}

function openInformationTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabInformation" }))
}

describe("actual Preset gallery staging (SettingsPanel, portrait)", () => {
  it("six ready presets stage age OFF with real age=0 thumbnails; one Save persists", async () => {
    vi.useRealTimers()
    seedAgeOn()
    const { ctx } = renderPanel()
    for (const id of ALL_IDS) await screen.findByTestId(`poster-style-${id}`)
    await waitFor(() => expect(ctx().defaultAgeBadge).toBe(true))
    expect((ctx().landscape as unknown as Record<string, unknown>).ageBadge).toBe(true)
    const before = storageSnapshot()
    // Thumbnails already render the age-off look while live age is still ON.
    for (const id of ALL_IDS) expect(galleryThumbAge(id)).toBe("0")
    for (const id of ALL_IDS) {
      fireEvent.click(screen.getByTestId(`poster-style-${id}`))
      expect(screen.getByTestId(`poster-style-${id}`)).toHaveAttribute("aria-pressed", "true")
      expect(galleryThumbAge(id)).toBe("0")
      expect(puts).toHaveLength(0)
    }
    expect(storageSnapshot()).toBe(before)
    // Outer live truth untouched before the global Save.
    expect(ctx().defaultAgeBadge).toBe(true)
    // The staged portrait flat reads OFF on the Information tab.
    openInformationTab()
    expect(screen.getByRole("switch", { name: "ui.ageBadge" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    // Edited (portrait) shape OFF; landscape effective preserved; delivery kept.
    expect(body.ageBadge).toBe(false)
    expect((body.landscape as Record<string, unknown>).ageBadge).toBe(true)
    expect(body.posterShape).toBe("poster")
    expect(ctx().defaultAgeBadge).toBe(false)
  })
})

describe("actual Preset gallery staging (SettingsPanel, landscape)", () => {
  it("six ready presets stage profile age OFF, portrait flat preserved", async () => {
    vi.useRealTimers()
    seedAgeOn()
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-apple")
    await waitFor(() => expect(ctx().defaultAgeBadge).toBe(true))
    switchEditTargetToLandscape()
    expect(puts).toHaveLength(0)
    const before = storageSnapshot()
    for (const id of ALL_IDS) expect(galleryThumbAge(id)).toBe("0")
    for (const id of ALL_IDS) {
      fireEvent.click(screen.getByTestId(`poster-style-${id}`))
      expect(screen.getByTestId(`poster-style-${id}`)).toHaveAttribute("aria-pressed", "true")
      expect(galleryThumbAge(id)).toBe("0")
      expect(puts).toHaveLength(0)
    }
    expect(storageSnapshot()).toBe(before)
    expect(ctx().defaultAgeBadge).toBe(true)
    // The staged landscape profile reads OFF on the Information tab.
    openInformationTab()
    expect(screen.getByRole("switch", { name: "ui.ageBadge" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    // Edited (landscape) profile OFF; portrait flat byte-identical; delivery kept.
    expect((body.landscape as Record<string, unknown>).ageBadge).toBe(false)
    expect(body.ageBadge).toBe(true)
    expect(body.posterShape).toBe("poster")
  })
})

describe("actual Preset gallery selection consistency (SettingsPanel)", () => {
  it("portrait: manually re-enabled age clears the ready-tile match (no false highlight)", async () => {
    vi.useRealTimers()
    seedAgeOn()
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    // Staged age-off matches the age-off thumbnail: exact match claimed.
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(galleryThumbAge("apple")).toBe("0")
    // Manual Information enable (staged only, never auto-saved).
    openInformationTab()
    const ageSwitch = screen.getByRole("switch", { name: "ui.ageBadge" })
    expect(ageSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(ageSwitch)
    expect(ageSwitch).toHaveAttribute("aria-checked", "true")
    expect(puts).toHaveLength(0)
    openPresetTab()
    // The live look no longer equals the age-off thumbnail: no exact match.
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "false")
    expect(galleryThumbAge("apple")).toBe("0")
    // The manual enable persists through the single global Save (still no auto-save before it).
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body.ageBadge).toBe(true)
  })

  it("landscape: manually re-enabled profile age clears the ready-tile match", async () => {
    vi.useRealTimers()
    seedAgeOn()
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    switchEditTargetToLandscape()
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(galleryThumbAge("apple")).toBe("0")
    openInformationTab()
    const ageSwitch = screen.getByRole("switch", { name: "ui.ageBadge" })
    expect(ageSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(ageSwitch)
    expect(ageSwitch).toHaveAttribute("aria-checked", "true")
    expect(puts).toHaveLength(0)
    openPresetTab()
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "false")
    expect(galleryThumbAge("apple")).toBe("0")
  })
})

describe("actual Preset gallery personal path (SettingsPanel)", () => {
  it("personal presets own their stored age: staged OFF, ready tile converges, one Save", async () => {
    vi.useRealTimers()
    seedAgeOn()
    presetList = [
      {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Mine",
        shape: "portrait",
        values: APPLE_VISUAL_DEFAULTS,
      },
    ]
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-apple")
    await waitFor(() => expect(ctx().defaultAgeBadge).toBe(true))
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    const mine = await screen.findByTestId(
      "visual-preset-00000000-0000-0000-0000-000000000001",
    )
    fireEvent.click(mine)
    // Personal highlight: the staged draft equals the stored look exactly.
    expect(mine).toHaveAttribute("aria-pressed", "true")
    // Convergence (not a false highlight): the stored Apple-values recipe is
    // now pixel-identical to the ready Apple look (Standard/off/own-rank), so
    // the ready tile truthfully claims it too — unlike the old inherit
    // semantics, where a live age-ON leaked into the personal look.
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(0)
    // The personal apply staged the stored age OFF (owned, never inherited).
    openInformationTab()
    expect(screen.getByRole("switch", { name: "ui.ageBadge" })).toHaveAttribute(
      "aria-checked",
      "false",
    )
    openPresetTab()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body.ageBadge).toBe(false)
    expect((puts[0].body.landscape as Record<string, unknown>).ageBadge).toBe(true)
  })
})
