/**
 * Preview-only del tab Trasforma Verticale/Orizzontale (Task2).
 *
 * - Il cambio tab NON persiste nulla (`defaultPosterShape` intatto).
 * - La preview dei default segue lo shape preview-only + profilo landscape
 *   effettivo (`land ?? flat`, stessa regola di UI e server).
 * - Portrait: URL byte-identici al comportamento precedente.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, screen, within, act } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { buildDefaultsPreviewUrl, type DefaultsPreviewParams } from "@/lib/poster-url"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { SettingsPanel } from "@/components/SettingsPanel"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const FLAT: DefaultsPreviewParams = {
  lang: "it",
  defaultGlobalBadges: true,
  defaultRankingBadges: true,
  defaultBadgeGenre: true,
  defaultBadgeYear: true,
  defaultBadgeRating: true,
  defaultBadgeQuality: true,
  defaultCustomRatings: true,
  defaultSeparateRatings: false,
  defaultRatingSources: ["imdb", "tmdb"],
  defaultBadgeStyle: "shadow",
  defaultRankingBadgeStyle: "default",
  defaultBadgeFont: "inter",
  defaultQualityBadgeStyle: "standard",
  defaultVideoFormats: ["dv", "atmos"],
  defaultBlurEnabled: true,
  defaultBlurIntensity: 20,
  defaultBlurFade: 50,
  defaultBlurDarkness: 30,
  defaultTintStrength: 20,
  defaultTopShade: 50,
  defaultGradientHeight: 30,
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
  defaultGenreBadgeScale: 100,
  defaultGenreBadgeOffsetX: 0,
  defaultGenreBadgeOffsetY: 0,
  defaultQualityBadgeScale: 100,
  defaultQualityBadgeOffsetX: -10,
  defaultQualityBadgeOffsetY: 15,
  defaultNetworkLogoScale: 100,
  defaultNetworkLogoOffsetX: 0,
  defaultNetworkLogoOffsetY: 0,
  defaultNetworkLogo: true,
  defaultNetworkLogoPosition: "auto",
  defaultRibbonEnabled: true,
  defaultRibbonSide: "left",
  defaultPosterShape: "poster",
  defaultLogoAlign: "center",
  defaultDateFormat: "locale",
  defaultRegion: "IT",
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

describe("buildDefaultsPreviewUrl preview-only shape", () => {
  it("portrait: URL identici con o senza i nuovi campi (nessun mixing)", () => {
    const base = buildDefaultsPreviewUrl(FLAT)
    expect(buildDefaultsPreviewUrl({ ...FLAT, landscape: {}, previewShape: undefined })).toBe(base)
    expect(buildDefaultsPreviewUrl({ ...FLAT, landscape: {}, previewShape: null })).toBe(base)
    // Profilo landscape presente ma shape portrait: ignorato del tutto.
    expect(
      buildDefaultsPreviewUrl({
        ...FLAT,
        previewShape: "portrait",
        landscape: { gradientHeight: 77, topBadgeScale: 150, qualityBadgeOffsetX: 42 },
      }),
    ).toBe(base)
    expect(paramsOf(base).get("shape")).toBe("poster")
  })

  it("previewShape landscape commuta shape e applica gli override Orizzontale", () => {
    const url = buildDefaultsPreviewUrl({
      ...FLAT,
      previewShape: "landscape",
      landscape: {
        gradientHeight: 20,
        blurIntensity: 8,
        blurFade: 70,
        blurDarkness: 50,
        blurEnabled: false,
        tintStrength: 33,
        topShade: 44,
        topBadgeScale: 120,
        topBadgeOffsetX: 5,
        genreBadgeScale: 90,
        qualityBadgeOffsetX: 7,
        qualityBadgeOffsetY: -7,
        networkLogoScale: 80,
        separateBadgeScale: 140,
        separateBadgeOffsetY: 11,
        logoScale: 55,
        logoOffsetX: -3,
      },
    })
    const p = paramsOf(url)
    expect(p.get("shape")).toBe("landscape")
    expect(p.get("gradHeight")).toBe("20")
    expect(p.get("blur")).toBe("8")
    expect(p.get("bf")).toBe("70")
    expect(p.get("bd")).toBe("50")
    expect(p.get("be")).toBe("0")
    expect(p.get("tint")).toBe("33")
    expect(p.get("ts")).toBe("44")
    expect(p.get("tscale")).toBe("120")
    expect(p.get("tox")).toBe("5")
    expect(p.get("gscale")).toBe("90")
    expect(p.get("qox")).toBe("7")
    expect(p.get("qoy")).toBe("-7")
    expect(p.get("netscale")).toBe("80")
    expect(p.get("sepscale")).toBe("140")
    expect(p.get("sepoy")).toBe("11")
    expect(p.get("scale")).toBe("55")
    expect(p.get("ox")).toBe("-3")
    // Chiavi non in override seguono i flat.
    expect(p.get("toy")).toBe("0")
    expect(p.get("gox")).toBe("0")
    expect(p.get("qscale")).toBe("100")
    expect(p.get("nox")).toBe("0")
  })

  it("profilo parziale eredita i flat; 0 esplicito vince (mai clobberato)", () => {
    const p = paramsOf(
      buildDefaultsPreviewUrl({
        ...FLAT,
        previewShape: "landscape",
        landscape: { topBadgeScale: 0 as unknown as number, qualityBadgeOffsetX: 0 },
      }),
    )
    expect(p.get("tscale")).toBe("0")
    expect(p.get("qox")).toBe("0")
    expect(p.get("gradHeight")).toBe("30")
    expect(p.get("qoy")).toBe("15")
  })

  it("logo landscape null = auto-fit (scale 0), non il flat", () => {
    const p = paramsOf(
      buildDefaultsPreviewUrl({
        ...FLAT,
        defaultLogoScale: 60,
        previewShape: "landscape",
        landscape: { logoScale: null },
      }),
    )
    expect(p.get("scale")).toBe("0")
  })

  it("fallback qualità per formato: portrait -10/+15, landscape 0/0", () => {
    const emptyPortrait = paramsOf(buildDefaultsPreviewUrl({} as never))
    expect(emptyPortrait.get("shape")).toBe("poster")
    expect(emptyPortrait.get("qox")).toBe("-10")
    expect(emptyPortrait.get("qoy")).toBe("15")
    const emptyLandscape = paramsOf(buildDefaultsPreviewUrl({ previewShape: "landscape" } as never))
    expect(emptyLandscape.get("shape")).toBe("landscape")
    expect(emptyLandscape.get("qox")).toBe("0")
    expect(emptyLandscape.get("qoy")).toBe("0")
  })

  it("sepstyle normalizzato per formato effettivo (bar landscape → pills)", () => {
    const portrait = paramsOf(
      buildDefaultsPreviewUrl({ ...FLAT, defaultSeparateRatingsStyle: "bottom-bar" }),
    )
    expect(portrait.get("sepstyle")).toBe("bottom-bar")
    const landscape = paramsOf(
      buildDefaultsPreviewUrl({ ...FLAT, defaultSeparateRatingsStyle: "bottom-bar", previewShape: "landscape" }),
    )
    expect(landscape.get("sepstyle")).toBe("bottom-pills")
  })
})

describe("TransformPanel controlled preview shape (integrazione reale, niente mock builder)", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderWithProbe(ui: ReactNode) {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    const view = renderWithCtx(createElement("div", null, ui, createElement(Probe)))
    return { view, ctx: () => ctx as PosterEditorCtx }
  }

  it("non controllato: il tab commuta la sezione senza persistere lo shape", () => {
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    expect(ctx().defaultPosterShape).toBe("poster")
    expect(screen.queryByText("ui.landscapeDefaultsHint")).toBeNull()
    fireEvent.click(screen.getByText("ui.posterShapeLandscape"))
    expect(screen.getByText("ui.landscapeDefaultsHint")).not.toBeNull()
    // Nessuna persistenza: il default globale resta portrait.
    expect(ctx().defaultPosterShape).toBe("poster")
    fireEvent.click(screen.getByText("ui.posterShapePortrait"))
    expect(screen.queryByText("ui.landscapeDefaultsHint")).toBeNull()
    expect(ctx().defaultPosterShape).toBe("poster")
  })

  it("controlled: no inner switch (the single selector lives in the parent)", () => {
    const onChange = vi.fn()
    const { view, ctx } = renderWithProbe(
      createElement(TransformPanel, { active: true, previewShape: "portrait", onPreviewShapeChange: onChange }),
    )
    expect(screen.queryByText("ui.landscapeDefaultsHint")).toBeNull()
    // Controlled mode hides the inner switch — the only selector lives in
    // SettingsPanel above the controls. The parent drives this section by prop.
    expect(screen.queryByText("ui.posterShapeLandscape")).toBeNull()
    expect(screen.queryByText("ui.posterShapePortrait")).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(ctx().defaultPosterShape).toBe("poster")
    view.rerender(
      createElement(
        "div",
        null,
        createElement(TransformPanel, { active: true, previewShape: "landscape", onPreviewShapeChange: onChange }),
      ),
    )
    expect(screen.getByText("ui.landscapeDefaultsHint")).not.toBeNull()
    expect(ctx().defaultPosterShape).toBe("poster")
  })
})

describe("DefaultsPosterPreview shape override (URL reale intercettato sul trasporto)", () => {
  const opened: string[] = []
  beforeEach(() => {
    localStorage.clear()
    opened.length = 0
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultGradientHeight: 30,
        defaultTopBadgeScale: 100,
        defaultQualityBadgeOffsetX: -10,
        defaultQualityBadgeOffsetY: 15,
        landscape: { gradientHeight: 20, topBadgeScale: 120, qualityBadgeOffsetX: 7, qualityBadgeOffsetY: -7 },
      }),
    )
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
      send() {
        // Resta pending: si asserisce solo l'URL calcolato (builder reale).
      }
      abort() {}
      setRequestHeader() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("landscape applica il profilo; portrait ripristina i flat; badge (assente) segue il default", async () => {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    const view = renderWithCtx(
      createElement("div", null, createElement(DefaultsPosterPreview, { previewShape: "landscape" }), createElement(Probe)),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(opened.length).toBeGreaterThan(0)
    const landParams = paramsOf(opened[opened.length - 1])
    expect(landParams.get("shape")).toBe("landscape")
    expect(landParams.get("gradHeight")).toBe("20")
    expect(landParams.get("tscale")).toBe("120")
    expect(landParams.get("qox")).toBe("7")
    expect(landParams.get("qoy")).toBe("-7")

    // Switch a portrait: stessi flat di prima, override landscape intatti.
    const seen = opened.length
    view.rerender(
      createElement("div", null, createElement(DefaultsPosterPreview, { previewShape: "portrait" }), createElement(Probe)),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(opened.length).toBeGreaterThan(seen)
    const portraitParams = paramsOf(opened[opened.length - 1])
    expect(portraitParams.get("shape")).toBe("poster")
    expect(portraitParams.get("gradHeight")).toBe("30")
    expect(portraitParams.get("tscale")).toBe("100")
    expect(portraitParams.get("qox")).toBe("-10")
    expect(portraitParams.get("qoy")).toBe("15")
    // Nessun reset degli override: il profilo landscape è intatto.
    expect((ctx as unknown as PosterEditorCtx).landscape.qualityBadgeOffsetX).toBe(7)
    expect((ctx as unknown as PosterEditorCtx).defaultPosterShape).toBe("poster")

    // Tab badge (override assente): segue il default persistito.
    view.rerender(createElement("div", null, createElement(DefaultsPosterPreview, null), createElement(Probe)))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(paramsOf(opened[opened.length - 1]).get("shape")).toBe("poster")
  })
})

describe("SettingsPanel reale: tab Trasforma → Orizzontale → slider live → Verticale (XHR osservato, niente mock UI)", () => {
  const opened: string[] = []
  beforeEach(() => {
    localStorage.clear()
    opened.length = 0
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultPosterShape: "poster",
        defaultGradientHeight: 30,
        defaultTopBadgeScale: 100,
        defaultQualityBadgeOffsetX: -10,
        defaultQualityBadgeOffsetY: 15,
        landscape: { gradientHeight: 20, topBadgeScale: 120, qualityBadgeOffsetX: 7, qualityBadgeOffsetY: -7 },
      }),
    )
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
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("click Orizzontale → shape landscape live; slider → nuovi params; Verticale → flat; default persistito intatto", async () => {
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
    const lastParams = () => paramsOf(opened[opened.length - 1])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    // Tab Badge iniziale: preview segue il default persistito (portrait).
    expect(opened.length).toBeGreaterThan(0)
    expect(lastParams().get("shape")).toBe("poster")

    // Passo a Trasforma (sotto-tab Verticale): ancora portrait.
    fireEvent.click(screen.getByRole("tab", { name: "ui.transform" }))
    expect(screen.queryByText("ui.landscapeDefaultsHint")).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("shape")).toBe("poster")
    expect(lastParams().get("gradHeight")).toBe("30")

    // Landscape via the single top selector: landscape section + profiled request.
    const trasformaPanelEl = screen.getByRole("tabpanel", { name: "ui.transform" })
    const formatTarget = screen.getByTestId("format-target-selector")
    // The single selector precedes the controls in the DOM.
    const controls = screen.getByTestId("settings-controls")
    expect(formatTarget.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(formatTarget).getByText("ui.posterShapeLandscape"))
    const landRoot = within(trasformaPanelEl).getByText("ui.landscapeDefaultsHint").parentElement as HTMLElement
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("shape")).toBe("landscape")
    expect(lastParams().get("gradHeight")).toBe("20")
    expect(lastParams().get("tscale")).toBe("120")
    expect(lastParams().get("qox")).toBe("7")
    // Aspect della preview conforme all'URL, immediato.
    expect(screen.getByTestId("settings-preview").querySelector(".aspect-video")).not.toBeNull()

    // Slider live reali: altezza sfumatura Orizzontale 20 → 45 …
    const heightSlider = within(landRoot).getByLabelText("ui.height") as HTMLInputElement
    expect(heightSlider.value).toBe("20")
    fireEvent.change(heightSlider, { target: { value: "45" } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("shape")).toBe("landscape")
    expect(lastParams().get("gradHeight")).toBe("45")

    // … e scala badge superiore Orizzontale 120 → 130.
    const scaleSliders = within(landRoot).getAllByLabelText("ui.scale") as HTMLInputElement[]
    const topScale = scaleSliders.find((el) => el.value === "120")
    expect(topScale).toBeDefined()
    fireEvent.change(topScale as HTMLInputElement, { target: { value: "130" } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("tscale")).toBe("130")

    // Back to Portrait from the single selector: original flats, no profile mixing.
    fireEvent.click(within(formatTarget).getByText("ui.posterShapePortrait"))
    expect(screen.queryByText("ui.landscapeDefaultsHint")).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const backParams = lastParams()
    expect(backParams.get("shape")).toBe("poster")
    expect(backParams.get("gradHeight")).toBe("30")
    expect(backParams.get("tscale")).toBe("100")
    expect(backParams.get("qox")).toBe("-10")
    expect(backParams.get("qoy")).toBe("15")
    expect(screen.getByTestId("settings-preview").querySelector(".aspect-video")).toBeNull()

    // Persistenza: default shape mai toccato, override Orizzontale intatti.
    const ed = ctx as unknown as PosterEditorCtx
    expect(ed.defaultPosterShape).toBe("poster")
    expect(ed.landscape.gradientHeight).toBe(45)
    expect(ed.landscape.topBadgeScale).toBe(130)

    // Badge tab with a Portrait target: poster (the persisted target is portrait here).
    fireEvent.click(screen.getByRole("tab", { name: "ui.badgeSection" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("shape")).toBe("poster")
    expect(ed.defaultPosterShape).toBe("poster")
    // The single selector stays visible on the Badge tab, before the controls.
    expect(screen.getByTestId("format-target-selector")).not.toBeNull()

    // The target survives tab switches — Landscape from the Badge tab keeps
    // a landscape preview without touching the persisted default.
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("shape")).toBe("landscape")
    expect(lastParams().get("gradHeight")).toBe("45")
    expect(lastParams().get("tscale")).toBe("130")
    expect(ed.defaultPosterShape).toBe("poster")
    // The Portrait flats were not rewritten by the Landscape target.
    expect(ed.defaultGradientHeight).toBe(30)
    expect(ed.defaultTopBadgeScale).toBe(100)
  })
})
