/**
 * Layout UX hierarchy + thumbnail quick configs (five-tab settings).
 *
 * - The ready gallery (six Standard looks + the canonical Fresh tile) precedes
 *   the single exclusive 5-mode ranking presentation (Nastro/Numero/Badge +
 *   Fresh/Card with the three Card skins) in the real DOM.
 * - Saved layout values hydrate into that real control with zero writes; each
 *   skin selection stages correctly and the remembered skin survives
 *   classic/Fresh/Card switching.
 * - Ready thumbnails are real /api/poster projections; a ready look is stable
 *   across its click, stages only (no PUT, no localStorage), and its
 *   highlight is a full-field match (an altered presentation OR a real
 *   Transformation geometry edit clears it).
 * - A ready look owns its canonical layout, overriding a Card draft, while
 *   raw extras and the delivery shape stay frozen.
 * - Card advanced geometry: user transforms are live in portrait and
 *   landscape on every layout (the shared compositor applies the same
 *   offsets/scales), values survive toggles and no fixed-layout hint is shown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { PosterLayoutSelector } from "@/components/PosterLayoutSelector"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { captureVisualPreset } from "@/lib/visual-presets"

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

function thumbSrc(id: string): string {
  const btn = screen.getByTestId(`poster-style-${id}`)
  const img = btn.querySelector("img")
  expect(img, `real thumbnail for ${id}`).not.toBeNull()
  const src = img!.getAttribute("src") ?? ""
  expect(src).toContain("/api/poster/")
  return src
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

describe("settings layout hierarchy", () => {
  it("ready gallery precedes the single rankings layout presentation; both expose real controls", async () => {
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    const gallery = screen.getByTestId("poster-style-cards")
    const layout = screen.getByTestId("ranking-presentation")
    // The gallery (looks) comes first, the layout presentation second.
    expect((gallery.compareDocumentPosition(layout) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
    for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full", "fresh"]) {
      expect(screen.getByTestId(`poster-style-${id}`)).toBeInTheDocument()
    }
    // The single layout control lives in the rankings tab and is 5-way exclusive.
    const group = await openRankings()
    expect(within(group).getAllByRole("radio")).toHaveLength(5)
    // No obsolete guide vocabulary anywhere.
    for (const stale of ["poster-config-guide", "guide-step-style", "guide-step-layout", "guide-quick-toggle", "guide-apply"]) {
      expect(screen.queryByTestId(stale)).toBeNull()
    }
    expect(screen.queryByText("1-click")).toBeNull()
  })

  it("saved layout values hydrate into the real presentation with zero writes", async () => {
    const cases: Array<{ saved: string; radio: string; skin?: string }> = [
      { saved: "standard", radio: "ui.ribbon" },
      { saved: "fresh", radio: "ui.posterLayoutGroupedFresh" },
      { saved: "provider-glass", radio: "ui.posterLayoutGroupedCard", skin: "ui.posterLayoutSkinProvider" },
      { saved: "nuvio", radio: "ui.posterLayoutGroupedCard", skin: "ui.posterLayoutSkinBlack" },
      { saved: "stremio", radio: "ui.posterLayoutGroupedCard", skin: "ui.posterLayoutSkinViolet" },
    ]
    for (const { saved, radio, skin } of cases) {
      localStorage.clear()
      cleanup()
      localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterLayout: saved }))
      const { ctx, unmount } = renderPanel()
      const before = snapshot(ctx())
      await screen.findByTestId("poster-style-apple")
      const storageBefore = storageSnapshot()
      await openRankings()
      expect(puts).toHaveLength(0)
      expect(snapshot(ctx())).toBe(before)
      expect(storageSnapshot()).toBe(storageBefore)
      if (saved === "standard") {
        // Standard never claims Fresh/Card.
        expect(presentationRadio("ui.posterLayoutGroupedFresh")).toHaveAttribute("aria-checked", "false")
        expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
      } else {
        expect(presentationRadio(radio)).toHaveAttribute("aria-checked", "true")
        if (skin) expect(skinRadio(skin)).toHaveAttribute("aria-checked", "true")
        else expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
      }
      unmount()
      cleanup()
    }
  })

  it("explicit Card defaults to provider-glass; the skin is remembered across switching and saved", async () => {
    const { ctx } = renderPanel()
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedCard"))
    // Default skin on explicit Card selection only.
    expect(skinRadio("ui.posterLayoutSkinProvider")).toHaveAttribute("aria-checked", "true")
    fireEvent.click(skinRadio("ui.posterLayoutSkinBlack"))
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedFresh"))
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedCard"))
    expect(skinRadio("ui.posterLayoutSkinBlack")).toHaveAttribute("aria-checked", "true")
    await saveAndWait(1)
    expect(puts[0].body.posterLayout).toBe("nuvio")
    expect(ctx()).toBeTruthy()
  })

  it("selecting each skin stores the right value on Save (single shot each)", async () => {
    const { ctx } = renderPanel()
    await openRankings()
    const pairs = [
      ["ui.posterLayoutSkinProvider", "provider-glass"],
      ["ui.posterLayoutSkinBlack", "nuvio"],
      ["ui.posterLayoutSkinViolet", "stremio"],
    ] as const
    let n = 0
    for (const [skinName, stored] of pairs) {
      fireEvent.click(presentationRadio("ui.posterLayoutGroupedCard"))
      fireEvent.click(skinRadio(skinName))
      n += 1
      await saveAndWait(n)
      expect(puts[n - 1].body.posterLayout).toBe(stored)
    }
    expect(ctx()).toBeTruthy()
  })
})

describe("ready gallery thumbnails are real projected posters", () => {
  it("all seven ready thumbs are real /api/poster URLs carrying layout + live projection", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultRatingSources: ["imdb", "tmdb"], defaultRegion: "US" }),
    )
    renderPanel()
    await screen.findByTestId("poster-style-apple")
    const params = (id: string) => new URL(thumbSrc(id), "http://localhost").searchParams
    for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]) {
      const p = params(id)
      expect(p.get("layout")).toBe("standard")
      expect(p.get("rsrc")).toBe("imdb,tmdb")
      expect(p.get("region")).toBe("US")
    }
    // The Fresh tile owns fresh + the ranked-only scope.
    const fresh = params("fresh")
    expect(fresh.get("layout")).toBe("fresh")
    expect(fresh.get("freshScope")).toBe("ranked")
    // A Card draft never rewrites the ready looks (they own Standard/Fresh).
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedCard"))
    for (const id of ["apple", "essential"]) {
      expect(params(id).get("layout")).toBe("standard")
    }
  })

  it("a ready thumbnail is the staged value: stable across click, no writes before Save", async () => {
    const closeSpy = vi.fn()
    const { ctx } = renderPanel(closeSpy)
    const outerApply = vi.spyOn(ctx(), "applyVisualPreset")
    const before = snapshot(ctx())
    await screen.findByTestId("poster-style-essential")
    const storageBefore = storageSnapshot()
    // The thumbnail already carries the exact per-click projection: stable.
    const want = thumbSrc("essential")
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(outerApply).not.toHaveBeenCalled()
    expect(snapshot(ctx())).toBe(before)
    expect(thumbSrc("essential")).toBe(want)
    expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(storageBefore)
    // Discard through the real close path: still zero.
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }))
    fireEvent.click(await screen.findByTestId("settings-dirty-discard"))
    expect(outerApply).not.toHaveBeenCalled()
    expect(snapshot(ctx())).toBe(before)
    expect(puts).toHaveLength(0)
    expect(closeSpy).toHaveBeenCalledWith(false)
  })

  it("altering the ranking presentation clears the ready highlight (full-field match)", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-essential")
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "true")
    await openRankings()
    // Same-shape presentation change moves off the canonical Essential look.
    fireEvent.click(presentationRadio("ui.number"))
    expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "false")
    expect(ctx()).toBeTruthy()
  })

  it("a real Transformation slider geometry edit clears the ready highlight; re-applying restores it", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-essential")
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "true")
    const before = snapshot(ctx())
    const storageBefore = storageSnapshot()
    // The real five-tab panel: open the Transformation tab and drive the
    // actual editable geometry slider (logo offset X) of the edited shape.
    fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabTransform" }))
    // Tab navigation alone never moves off the look.
    expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "true")
    const logoGroup = screen.getByTestId("transform-geo-logo")
    const logoX = within(logoGroup).getByRole("slider", { name: "X" })
    fireEvent.change(logoX, { target: { value: "40" } })
    // An altered geometry moves off the canonical Essential look: the
    // full-field highlight clears even though the presentation is unchanged.
    expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "false")
    // Staged only: no PUT, no localStorage, no live outer mutation before Save.
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(storageBefore)
    expect(snapshot(ctx())).toBe(before)
    // Re-applying the same ready look restores the highlight AND its full
    // canonical geometry (the highlight is a full-field match).
    openPresetTab()
    fireEvent.click(screen.getByTestId("poster-style-essential"))
    expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "true")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(storageBefore)
    expect(snapshot(ctx())).toBe(before)
  })

  it("a ready look overrides the Card draft; raw extras + delivery stay frozen", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterShape: "poster", landscape: { minQuality: "1080p" } }),
    )
    const { ctx } = renderPanel()
    await openRankings()
    fireEvent.click(presentationRadio("ui.posterLayoutGroupedCard"))
    // The Apple ready look owns Standard, overriding the Card draft.
    openPresetTab()
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(screen.getByTestId("poster-style-apple")).toHaveAttribute("aria-pressed", "true")
    await openRankings()
    expect(presentationRadio("ui.posterLayoutGroupedFresh")).toHaveAttribute("aria-checked", "false")
    expect(screen.queryByTestId("poster-layout-skins")).toBeNull()
    const beforeShape = ctx().defaultPosterShape
    await saveAndWait(1)
    const body = puts[0].body
    expect(body.posterLayout).toBe("standard")
    expect(body.rankingBadgeStyle).toBe("number")
    expect(body.posterShape).toBe(beforeShape)
    // Unknown landscape extras survive; the delivery shape is preserved.
    expect((body.landscape as Record<string, unknown>).minQuality).toBe("1080p")
  })
})

describe("legacy selector unchanged", () => {
  it("standalone selector still exposes 5 choices", () => {
    const onChange = vi.fn()
    renderWithCtx(createElement(PosterLayoutSelector, { value: "standard", onChange }))
    const group = screen.getByRole("radiogroup", { name: "ui.posterLayout" })
    expect(within(group).getAllByRole("radio")).toHaveLength(5)
  })
})

describe("card advanced geometry stays live", () => {
  function renderTransform(shape?: "portrait" | "landscape") {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    const ui = createElement(
      "div",
      null,
      createElement(TransformPanel, {
        active: true,
        ...(shape ? { previewShape: shape } : {}),
      }),
      createElement(Probe),
    )
    const out = renderWithCtx(ui)
    return { ...out, ctx: () => ctx as unknown as PosterEditorCtx }
  }

  function disabledRanges(container: HTMLElement): HTMLInputElement[] {
    return Array.from(container.querySelectorAll('fieldset[disabled] input[type="range"]')) as HTMLInputElement[]
  }

  it("portrait Card all: every Transform slider stays live and stored values are preserved", async () => {
    const { ctx, container } = renderTransform()
    await act(async () => {
      ctx().setDefaultTopBadgeOffsetX(12)
      ctx().setDefaultGenreBadgeOffsetX(9)
      ctx().setDefaultNetworkLogoOffsetX(7)
      ctx().setDefaultPosterLayout("nuvio")
      ctx().setDefaultPosterFreshScope("all")
    })
    await act(async () => {})
    // Stored numbers preserved.
    expect(ctx().defaultTopBadgeOffsetX).toBe(12)
    expect(ctx().defaultGenreBadgeOffsetX).toBe(9)
    expect(ctx().defaultNetworkLogoOffsetX).toBe(7)
    // User transforms are live on every layout (authorized contract): the
    // shared Card compositor applies the same offsets/scales, so no group is
    // disabled and no fixed-layout hint is rendered.
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    const allRanges = Array.from(
      (container as unknown as HTMLElement).querySelectorAll('input[type="range"]'),
    ) as HTMLInputElement[]
    expect(allRanges.length).toBeGreaterThan(0)
    for (const r of allRanges) expect(r).not.toBeDisabled()
    const note = (container as unknown as HTMLElement).textContent ?? ""
    expect(note).not.toContain("ui.posterLayoutCardControlsNote")
    expect(note).not.toContain("ui.posterLayoutCardFallbackNote")
    // Switching to Fresh keeps every control live with the same values.
    await act(async () => {
      ctx().setDefaultPosterLayout("fresh")
    })
    await act(async () => {})
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    expect(ctx().defaultTopBadgeOffsetX).toBe(12)
    expect(ctx().defaultGenreBadgeOffsetX).toBe(9)
    expect(ctx().defaultNetworkLogoOffsetX).toBe(7)
  })

  it("landscape effective Card (inherited flat + explicit override) keeps the same groups live", async () => {
    // Inherited flat Card all (seeded pre-mount so no freeze writes an
    // explicit landscape value) applies to the landscape target too.
    localStorage.clear()
    document.body.innerHTML = ""
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterLayout: "nuvio", defaultPosterFreshScope: "all" }),
    )
    const { ctx, container } = renderTransform("landscape")
    await act(async () => {})
    expect(ctx().defaultPosterLayout).toBe("nuvio")
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    await act(async () => {
      ctx().setDefaultTopBadgeOffsetX(5)
    })
    await act(async () => {})
    // An explicit landscape override back to Standard never rewrites stored
    // numbers and stays live.
    await act(async () => {
      ctx().setLandscape({ posterLayout: "standard" } as never)
    })
    await act(async () => {})
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    expect(ctx().defaultTopBadgeOffsetX).toBe(5)
    // Explicit landscape Card stays live too, without touching stored numbers.
    await act(async () => {
      ctx().setLandscape({ posterLayout: "stremio" } as never)
    })
    await act(async () => {})
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    expect(ctx().defaultTopBadgeOffsetX).toBe(5)
  })

  it("portrait Card ranked: positioning stays live with no fixed-layout hint", async () => {
    const { ctx, container } = renderTransform()
    await act(async () => {
      ctx().setDefaultTopBadgeOffsetX(12)
      ctx().setDefaultPosterLayout("nuvio")
      ctx().setDefaultPosterFreshScope("ranked")
    })
    await act(async () => {})
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    const note = (container as unknown as HTMLElement).textContent ?? ""
    expect(note).not.toContain("ui.posterLayoutCardFallbackNote")
    expect(note).not.toContain("ui.posterLayoutCardControlsNote")
    // Absent/invalid scope is equally live: no layout locks the controls.
    await act(async () => {
      ctx().setDefaultPosterFreshScope("all")
    })
    await act(async () => {})
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    expect(ctx().defaultTopBadgeOffsetX).toBe(12)
  })

  it("landscape Card ranked scope precedence: no layout locks the controls", async () => {
    localStorage.clear()
    document.body.innerHTML = ""
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultPosterLayout: "nuvio", defaultPosterFreshScope: "ranked" }),
    )
    const { ctx, container } = renderTransform("landscape")
    await act(async () => {})
    // Inherited flat ranked: live, no fixed locks, no fixed-layout hint.
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    expect((container as unknown as HTMLElement).textContent ?? "").not.toContain(
      "ui.posterLayoutCardFallbackNote",
    )
    // Explicit landscape scope all overrides the ranked flat: still live.
    await act(async () => {
      ctx().setLandscape({ posterFreshScope: "all" } as never)
    })
    await act(async () => {})
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
    // Explicit landscape scope ranked wins over flat all: still live.
    await act(async () => {
      ctx().setDefaultPosterFreshScope("all")
      ctx().setLandscape({ posterFreshScope: "ranked" } as never)
    })
    await act(async () => {})
    expect(disabledRanges(container as unknown as HTMLElement).length).toBe(0)
  })

  it("Card all: rank and extra stay live, layout switch preserves values (no materialize)", async () => {
    const { ctx, container } = renderTransform()
    await act(async () => {
      ctx().setDefaultPosterLayout("nuvio")
      ctx().setDefaultPosterFreshScope("all")
      ctx().setDefaultTopBadgeOffsetX(12)
      ctx().setDefaultExtraBadgeOffsetX(null)
    })
    await act(async () => {})
    // Rank X stays editable on Card too: the shared compositor applies it.
    const el = container as unknown as HTMLElement
    const rankX = el.querySelector('input[type="range"]') as HTMLInputElement | null
    expect(rankX).toBeTruthy()
    expect(rankX).not.toBeDisabled()
    expect(disabledRanges(el).length).toBe(0)
    // Live extra edit never touches the classifica.
    await act(async () => {
      ctx().setDefaultExtraBadgeOffsetX(9)
    })
    await act(async () => {})
    expect(ctx().defaultExtraBadgeOffsetX).toBe(9)
    expect(ctx().defaultTopBadgeOffsetX).toBe(12)
    // Layout switch preserves every stored number (no writes on switch).
    await act(async () => {
      ctx().setDefaultPosterLayout("standard")
    })
    await act(async () => {})
    expect(ctx().defaultTopBadgeOffsetX).toBe(12)
    expect(ctx().defaultExtraBadgeOffsetX).toBe(9)
    expect(disabledRanges(el).length).toBe(0)
  })
})
