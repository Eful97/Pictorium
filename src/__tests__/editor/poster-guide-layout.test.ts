/**
 * Rankings cover-layout + preset-gallery contract (five-tab settings).
 *
 * The obsolete guided stepper (poster-config-guide / guide-go-1 /
 * draft-apply vocabulary) is superseded by the independent Presets gallery
 * plus the Classifiche (rankings) presentation: the cover layout is the
 * single exclusive 5-mode presentation (Nastro/Numero/Badge + Fresh/Card with
 * the three Card skins) and the ready gallery owns the looks.
 *
 * - The edited shape is isolated (portrait flats vs landscape profile) and the
 *   other shape is frozen at its pre-edit effective values; raw extras ride
 *   along untouched.
 * - Every edit stages into the shared draft session only (no PUT, no
 *   localStorage, no live outer mutation) until the single global Save.
 * - A ready look owns its canonical layout: the six Standard looks keep
 *   Standard, Fresh owns Fresh + the ranked-only scope.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { captureVisualPreset } from "@/lib/visual-presets"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

let puts: { url: string; body: Record<string, unknown> }[]

/** Faithful Response stub: `http()` always reads `res.text()`. */
function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
      }
      if (u.includes("/api/defaults/presets")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ presets: [] }),
          text: async () => JSON.stringify({ presets: [] }),
        }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
    }),
  )
}

function renderPanel(onClose?: () => void) {
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
        setSettingsOpen: onClose ?? (() => {}),
        exportData: () => {},
        importData: () => {},
      }),
      createElement(Probe),
    ),
  )
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

function snapshot(ctx: PosterEditorCtx): string {
  return JSON.stringify({
    values: captureVisualPreset({ ...captureVisualPreset(ctx), landscape: ctx.landscape }),
    flatLayout: (ctx as unknown as Record<string, unknown>).defaultPosterLayout,
    flatScope: (ctx as unknown as Record<string, unknown>).defaultPosterFreshScope,
    landscape: ctx.landscape,
    shape: ctx.defaultPosterShape,
  })
}

/**
 * Durable storage snapshot: proves no DEFAULTS edit leaked before the global
 * Save. The applied-preset reset reference is a deliberate, approved
 * persistence (immune to later global saves), so it is not a defaults edit.
 */
function storageSnapshot(): string {
  return JSON.stringify(
    Object.keys(localStorage)
      .filter((k) => !k.startsWith("activePresetBaseline:"))
      .sort()
      .map((k) => [k, localStorage.getItem(k)]),
  )
}

function settle() {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 60))
  })
}

async function openRankings(): Promise<HTMLElement> {
  await screen.findByTestId("poster-style-apple")
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabRankings" }))
  return layoutGroup()
}

function openPresetTab() {
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
}

function presentation(): HTMLElement {
  return screen.getByTestId("ranking-presentation")
}

/** The 5-mode exclusive radiogroup (Nastro/Numero/Badge + Fresh/Card). */
function layoutGroup(): HTMLElement {
  return within(presentation()).getByRole("radiogroup", { name: "ui.rankFamily" })
}

function presentationRadio(name: string): HTMLElement {
  return within(layoutGroup()).getByRole("radio", { name })
}

function skinsGroup(): HTMLElement {
  return screen.getByTestId("poster-layout-skins")
}

function skinRadio(name: string): HTMLElement {
  return within(skinsGroup()).getByRole("radio", { name })
}

async function saveAndWait(count: number) {
  fireEvent.click(screen.getByTestId("settings-save"))
  await waitFor(() => expect(puts).toHaveLength(count))
}

beforeEach(() => {
  localStorage.clear()
  puts = []
  stubFetch()
})

describe("rankings owns the single exclusive layout presentation", () => {
  it("rankings owns the single exclusive 5-mode layout presentation; the gallery never duplicates it", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    // The ready gallery is the only look entry (seven tiles incl. Fresh).
    for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full", "fresh"]) {
      expect(screen.getByTestId(`poster-style-${id}`)).toBeInTheDocument()
    }
    // Exactly one layout presentation control in the whole panel...
    expect(screen.getAllByTestId("ranking-presentation")).toHaveLength(1)
    // ...and the preset gallery never hosts a layout control.
    expect(within(screen.getByTestId("presets-panel")).queryByTestId("ranking-presentation")).toBeNull()
    const group = await openRankings()
    expect(group).toBe(layoutGroup())
    expect(within(layoutGroup()).getAllByRole("radio")).toHaveLength(5)
    for (const name of [
      "ui.ribbon",
      "ui.number",
      "ui.badgeSection",
      "ui.posterLayoutGroupedFresh",
      "ui.posterLayoutGroupedCard",
    ]) {
      expect(presentationRadio(name)).toBeInTheDocument()
    }
    // Card primary reveals exactly the three existing skins.
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedCard"))
    expect(within(skinsGroup()).getAllByRole("radio")).toHaveLength(3)
    for (const name of [
      "ui.posterLayoutSkinProvider",
      "ui.posterLayoutSkinBlack",
      "ui.posterLayoutSkinViolet",
    ]) {
      expect(skinRadio(name)).toBeInTheDocument()
    }
    // A classic look hides the skins; Fresh shows the ranked-only scope hint.
    fireEvent.click(presentationRadio("ui.badgeSection"))
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    expect(presentationRadio("ui.posterLayoutGroupedFresh")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("ui.posterFreshScopeHint")).toBeInTheDocument()
    // No obsolete guide vocabulary anywhere.
    expect(screen.queryByTestId("poster-config-guide")).toBeNull()
  })

  it("legacy standalone BadgeDefaultsSection keeps its card", async () => {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape: "portrait" }), createElement(Probe)),
    )
    const adv = screen.getByTestId("badge-advanced-toggle")
    if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
    const g = screen.getByTestId("badge-group-style-toggle")
    if (g.getAttribute("aria-expanded") !== "true") fireEvent.click(g)
    expect(screen.getByTestId("poster-layout-card")).toBeInTheDocument()
    expect(ctx).toBeTruthy()
  })
})

describe("rankings layout draft staging", () => {
  it("rankings layout draft stages only; live stays and discard writes zero", async () => {
    const closeSpy = vi.fn()
    const { ctx } = renderPanel(closeSpy)
    const outerApply = vi.spyOn(ctx(), "applyVisualPreset")
    const before = snapshot(ctx())
    // Capture durable storage after the panel is ready (mount hydration may
    // persist the canonical normalized defaults once).
    await screen.findByTestId("poster-style-apple")
    const storageBefore = storageSnapshot()
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    // Draft-only: live outer untouched, no provider writes, no durable write.
    expect(outerApply).not.toHaveBeenCalled()
    expect(snapshot(ctx())).toBe(before)
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(storageBefore)
    expect(screen.getByTestId("defaults-preview-media")).toBeInTheDocument()
    // Discard through the real close path: still zero.
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }))
    fireEvent.click(await screen.findByTestId("settings-dirty-discard"))
    expect(outerApply).not.toHaveBeenCalled()
    expect(snapshot(ctx())).toBe(before)
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(storageBefore)
    expect(closeSpy).toHaveBeenCalledWith(false)
  })

  it("portrait layout Save is one atomic payload; other shape frozen, preview matches server", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", landscape: { minQuality: "1080p" } }),
    )
    const { ctx } = renderPanel()
    await openRankings()
    const beforeShape = ctx().defaultPosterShape
    const beforeSources = JSON.stringify(ctx().defaultRatingSources)
    const beforeFitP = ctx().defaultPortraitFitEnabled
    const beforeFitL = ctx().defaultLandscapeFitEnabled
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    expect(puts).toHaveLength(0)
    await saveAndWait(1)
    const body = puts[0].body
    expect(body.posterLayout).toBe("fresh")
    expect(body.posterFreshScope).toBe("ranked")
    // Inherited landscape freezes at the pre-edit effective values (no leak).
    const land = body.landscape as Record<string, unknown>
    expect(land.posterLayout).toBe("standard")
    expect(land.posterFreshScope ?? "ranked").toBe("ranked")
    // Delivery/fit/sources untouched by a layout-only look.
    expect(body.posterShape).toBe(beforeShape)
    expect(body.ratingSources).toEqual(JSON.parse(beforeSources))
    expect(body.defaultPortraitFitEnabled).toBe(beforeFitP)
    expect(body.defaultLandscapeFitEnabled).toBe(beforeFitL)
    // Raw extras survive underneath the frozen profile.
    expect(land.minQuality).toBe("1080p")
    // Preview == server: the visible preview projection (same context the
    // preview builder reads after the ACK install) carries the persisted pair.
    const opts = {
      tmdbKey: "k",
      userId: null,
      lang: "en",
      demoMedia: null,
      previewShape: "portrait" as const,
      previewFamily: null,
    }
    const preview = new URL(buildDefaultsPreviewUrlFromEditor(ctx(), opts).url, "http://localhost").searchParams
    expect(preview.get("layout")).toBe(body.posterLayout)
    expect(preview.get("freshScope")).toBe(body.posterFreshScope)
  })

  it("landscape layout override patches the nested profile only; delivery and raw extras intact", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", defaultPosterLayout: "standard", landscape: { minQuality: "1080p" } }),
    )
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-apple")
    // Switch the edit target to landscape (preview-only; delivery preserved).
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedCard"))
    fireEvent.click(skinRadio("ui.posterLayoutSkinViolet"))
    const before = snapshot(ctx())
    expect(snapshot(ctx())).toBe(before)
    expect(puts).toHaveLength(0)
    const beforeShape = ctx().defaultPosterShape
    await saveAndWait(1)
    const body = puts[0].body
    const land = body.landscape as Record<string, unknown>
    expect(land.posterLayout).toBe("stremio")
    expect(land.posterFreshScope ?? "ranked").toBe("ranked")
    // Portrait flats stay at their stored values (no Card leak).
    expect(body.posterLayout).toBe("standard")
    expect(body.posterShape).toBe(beforeShape)
    // Unknown raw landscape extras survive the profile merge.
    expect(land.minQuality).toBe("1080p")
  })

  it("a staged layout draft survives tab navigation and commits once", async () => {
    const { ctx } = renderPanel()
    const before = snapshot(ctx())
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    // Free navigation: switching tabs never discards, prompts nor writes.
    openPresetTab()
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabInformation" }))
    await openRankings()
    expect(presentationRadio("ui.posterLayoutGroupedFresh")).toHaveAttribute("aria-checked", "true")
    // The format target also survives the navigation.
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    openPresetTab()
    await openRankings()
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapePortrait"))
    expect(presentationRadio("ui.posterLayoutGroupedFresh")).toHaveAttribute("aria-checked", "true")
    expect(puts).toHaveLength(0)
    expect(snapshot(ctx())).toBe(before)
    await saveAndWait(1)
    expect(puts[0].body.posterLayout).toBe("fresh")
  })

  it("an outer layout change conflicts with the dirty draft (zero writes); discard recovers", async () => {
    const { ctx } = renderPanel()
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    // External live change underneath the dirty draft (legacy auto-persist path).
    await act(async () => {
      ctx().setDefaultPosterLayout("nuvio")
    })
    await settle()
    const putsBefore = puts.length
    expect(screen.getByTestId("settings-conflict")).toBeInTheDocument()
    expect(screen.getByTestId("settings-save")).toBeDisabled()
    fireEvent.click(screen.getByTestId("settings-save"))
    expect(puts.length).toBe(putsBefore)
    // Discard recovers onto the outer truth (Card + the stored nuvio skin).
    fireEvent.click(screen.getByTestId("settings-conflict-discard"))
    await settle()
    expect(presentationRadio("ui.posterLayoutGroupedCard")).toHaveAttribute("aria-checked", "true")
    expect(skinRadio("ui.posterLayoutSkinBlack")).toHaveAttribute("aria-checked", "true")
    // Re-select Fresh and Save: exactly one staged PUT.
    const putsAfterDiscard = puts.length
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    await saveAndWait(putsAfterDiscard + 1)
    expect(puts[puts.length - 1].body.posterLayout).toBe("fresh")
  })

  it("a ready look owns its canonical layout: Apple keeps Standard, Fresh owns Fresh/ranked", async () => {
    const { ctx } = renderPanel()
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    expect(presentationRadio("ui.posterLayoutGroupedFresh")).toHaveAttribute("aria-checked", "true")
    // A Standard ready look (Apple) owns Standard, not the Fresh draft.
    openPresetTab()
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    await openRankings()
    expect(presentationRadio("ui.posterLayoutGroupedFresh")).toHaveAttribute("aria-checked", "false")
    await saveAndWait(1)
    expect(puts[0].body.posterLayout).toBe("standard")
    expect(puts[0].body.rankingBadgeStyle).toBe("number")
    // The Fresh look owns fresh/ranked (never vice versa).
    openPresetTab()
    fireEvent.click(screen.getByTestId("poster-style-fresh"))
    await saveAndWait(2)
    expect(puts[1].body.posterLayout).toBe("fresh")
    expect(puts[1].body.posterFreshScope).toBe("ranked")
    expect(ctx()).toBeTruthy()
    cleanup()
  })
})
