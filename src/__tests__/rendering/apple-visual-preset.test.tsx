/**
 * Builtin Apple 1-click (accanto a BetterPoster/RPDB):
 * - costante fedele al preset-export (valori inline, mai il file Desktop):
 *   flat = portrait, nested `landscape` = orizzontale;
 * - apply SOLO proiezione formato via helper esistenti
 *   (applyPortraitIsolated/applyLandscapeIsolated): fonti voti, logo align,
 *   fit flag e delivery immutati in entrambi i target;
 * - highlight = proiezione intera per forma, mai subset di chiavi;
 * - isolamento effective dimostrato via buildDefaultsPreviewUrl (stesso
 *   endpoint del renderer, regola `land ?? flat`).
 *
 * SettingsPanel UI (staged draft, single source of truth for saving): the
 * Apple click applies to the staged draft ONLY — in landscape the real preview
 * URL (DefaultsPosterPreview, same builder) carries the complete canonical
 * profile (blurFade 100 + siblings) while the durable/outer ctx stays intact
 * and no PUT is sent. The outer-ctx assertions (canonical profile + flat/global/
 * delivery intact) hold AFTER the single explicit Save, when the draft is
 * persisted and installed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import {
  APPLE_PRESET_LABEL,
  APPLE_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import {
  applyLandscapeIsolated,
  applyPortraitIsolated,
  captureVisualPreset,
  landscapeProfilePatch,
  portraitPresetPatch,
  resolveEffectiveLandscape,
  visualPresetValuesSchema,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
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
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
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
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
    }),
  )
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
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
  // Fresh open lands on Preferenze (secondary): the gallery + format target
  // driven by these tests live on primary tabs.
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
  return { ctx: () => ctx as PosterEditorCtx }
}

function appleButton(): HTMLElement {
  const btn = screen.getByText("Stile Apple").closest("button")
  if (!btn) throw new Error("Apple preset button not found")
  return btn
}

function isHighlighted(btn: HTMLElement): boolean {
  return btn.className.includes("ring-accent-orange/30")
}

/** Preview URL per forma dal ctx live (profilo RAW, come VisualPresetsSection). */
function previewUrl(c: PosterEditorCtx, shape: "portrait" | "landscape"): string {
  return buildDefaultsPreviewUrl({ ...captureVisualPreset(c), landscape: c.landscape, previewShape: shape })
}

describe("APPLE_VISUAL_DEFAULTS fedeltà al preset-export", () => {
  it("label e schema: costante valida e stabile", () => {
    expect(APPLE_PRESET_LABEL).toBe("Apple")
    expect(visualPresetValuesSchema.parse(APPLE_VISUAL_DEFAULTS)).toEqual(APPLE_VISUAL_DEFAULTS)
  })

  it("flat portrait: valori distintivi Apple", () => {
    const v = APPLE_VISUAL_DEFAULTS
    expect(v.defaultLogoOffsetY).toBe(-40)
    expect(v.defaultGenreBadgeOffsetY).toBe(-40)
    expect(v.defaultBlurFade).toBe(50)
    expect(v.defaultQualityBadgeStyle).toBe("knockout")
    expect(v.defaultRankingBadgeStyle).toBe("number")
    expect(v.defaultRatingSources).toEqual(["imdb", "tmdb"])
    expect(v.defaultSashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    expect(v.defaultVideoFormats).toEqual(["dv", "atmos", "imax", "hdr", "hdr10plus"])
    expect(v.defaultNetworkLogo).toBe(true)
    expect(v.defaultRibbonEnabled).toBe(true)
    expect(v.defaultRibbonSide).toBe("left")
    expect(v.defaultPreRelease).toBe(true)
    expect(v.defaultGradientHeight).toBe(50)
    expect(v.defaultBlurEnabled).toBe(true)
    expect(v.defaultBlurIntensity).toBe(1)
    expect(v.defaultBlurDarkness).toBe(100)
    expect(v.defaultTintStrength).toBe(0)
    expect(v.defaultBadgeYear).toBe(false)
    expect(v.defaultBadgeQuality).toBe(false)
    expect(v.defaultBadgeStyle).toBe("minimal")
    expect(v.defaultBadgeFont).toBe("inter")
    expect(v.defaultSeparateRatingsStyle).toBe("column")
    expect(v.defaultPosterShape).toBe("poster")
    expect(v.defaultLogoAlign).toBeNull()
  })

  it("nested landscape: divergenze orizzontali Apple", () => {
    const land = APPLE_VISUAL_DEFAULTS.landscape
    expect(land.logoOffsetY).toBeNull()
    expect(land.genreBadgeOffsetY).toBe(0)
    expect(land.blurFade).toBe(100)
    expect(land.qualityBadgeStyle).toBe("color")
    expect(land.gradientHeight).toBe(50)
    expect(land.blurIntensity).toBe(1)
    expect(land.blurDarkness).toBe(100)
    expect(land.tintStrength).toBe(0)
    expect(land.rankingBadgeStyle).toBe("number")
    expect(land.badgeFont).toBe("inter")
    expect(land.badgeStyle).toBe("minimal")
    expect(land.sashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    expect(land.videoFormats).toEqual(["dv", "atmos", "imax", "hdr", "hdr10plus"])
    expect(land.networkLogo).toBe(true)
    expect(land.ribbonEnabled).toBe(true)
    expect(land.preRelease).toBe(true)
    expect(land.separateRatingsStyle).toBe("column")
  })
})

describe("Apple via helper isolati (unità, senza UI)", () => {
  // Profilo sparso con null ereditari + flat diversi da Apple: il caso che
  // romperebbe l'effettivo se il portrait scrivesse i flat senza congelare.
  function sparseCurrent(): VisualPresetValues {
    return captureVisualPreset({
      ...APPLE_VISUAL_DEFAULTS,
      defaultBadgeStyle: "shadow",
      defaultRankingBadgeStyle: "default",
      defaultGenreBadgeOffsetY: 10,
      defaultLogoOffsetY: 5,
      defaultBlurFade: 20,
      defaultQualityBadgeStyle: "standard",
      defaultSashOrder: ["extra"],
      defaultRatingSources: ["imdb", "tmdb", "trakt"],
      defaultPosterShape: "landscape",
      landscape: {
        badgeStyle: "pill",
        qualityBadgeStyle: null,
        videoFormats: null,
        extraBadgeStyle: "vetro",
        gradientHeight: 45,
        sashOrder: ["award"],
      },
    } as VisualPresetValues)
  }

  it("portrait: proiezione Apple sui flat, effettivo landscape invariato", () => {
    const current = sparseCurrent()
    const before = JSON.stringify(resolveEffectiveLandscape(current))
    const next = applyPortraitIsolated(current, APPLE_VISUAL_DEFAULTS)
    expect(portraitPresetPatch(next)).toEqual(portraitPresetPatch(APPLE_VISUAL_DEFAULTS))
    expect(JSON.stringify(resolveEffectiveLandscape(next))).toBe(before)
    // Globali fuori proiezione immutati (come i preset personali).
    expect(next.defaultRatingSources).toEqual(["imdb", "tmdb", "trakt"])
    expect(next.defaultPosterShape).toBe("landscape")
    expect(next.defaultLogoAlign).toBeNull()
  })

  it("landscape: solo profilo, flat/globali/delivery intatti", () => {
    const current = sparseCurrent()
    const flatsBefore = JSON.stringify(portraitPresetPatch(current))
    const next = applyLandscapeIsolated(current, APPLE_VISUAL_DEFAULTS)
    expect(JSON.stringify(portraitPresetPatch(next))).toBe(flatsBefore)
    expect(next.defaultRatingSources).toEqual(["imdb", "tmdb", "trakt"])
    expect(next.defaultPosterShape).toBe("landscape")
    expect(next.defaultLogoAlign).toBeNull()
    // Profilo = proiezione landscape Apple sopra gli extra esistenti.
    expect(next.landscape).toMatchObject(landscapeProfilePatch(APPLE_VISUAL_DEFAULTS))
    expect(next.landscape.blurFade).toBe(100)
    expect(next.landscape.qualityBadgeStyle).toBe("color")
    expect(next.landscape.genreBadgeOffsetY).toBe(0)
    expect(next.landscape.logoOffsetY).toBeNull()
    expect(next.landscape.extraBadgeStyle).toBe("vetro")
  })
})

describe("Apple builtin UI (isolamento per target)", () => {
  it("portrait: scrive i flat Apple, URL landscape effective byte-identico", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterShape: "landscape",
      defaultBadgeStyle: "shadow",
      defaultRankingBadgeStyle: "default",
      defaultGenreBadgeOffsetY: 10,
      defaultLogoOffsetY: 5,
      defaultBlurFade: 20,
      defaultQualityBadgeStyle: "standard",
      defaultSashOrder: ["extra"],
      defaultRatingSources: ["imdb", "tmdb", "trakt"],
      landscape: {
        badgeStyle: "pill",
        qualityBadgeStyle: null,
        videoFormats: null,
        extraBadgeStyle: "vetro",
        gradientHeight: 45,
        sashOrder: ["award"],
      },
    }))
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(isHighlighted(appleButton())).toBe(false)
    const landBefore = previewUrl(ctx(), "landscape")
    const portBefore = previewUrl(ctx(), "portrait")
    expect(landBefore).not.toBe(portBefore)
    fireEvent.click(appleButton())
    // Flat Apple applicati.
    expect(ctx().defaultGenreBadgeOffsetY).toBe(-40)
    expect(ctx().defaultLogoOffsetY).toBe(-40)
    expect(ctx().defaultBlurFade).toBe(50)
    expect(ctx().defaultQualityBadgeStyle).toBe("knockout")
    expect(ctx().defaultRankingBadgeStyle).toBe("number")
    expect(ctx().defaultSashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    // Globali e delivery immutati (fonti voti fuori proiezione).
    expect(ctx().defaultRatingSources).toEqual(["imdb", "tmdb", "trakt"])
    expect(ctx().defaultPosterShape).toBe("landscape")
    // Effettivo landscape invariato: eredità congelata, non output mosso.
    expect(previewUrl(ctx(), "landscape")).toBe(landBefore)
    // Highlight proiezione portrait intera.
    expect(isHighlighted(appleButton())).toBe(true)
  })

  it("landscape: Apple staged on the draft only, canonical preview, Save persists the profile", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterShape: "poster",
      defaultBadgeStyle: "shadow",
      defaultRatingSources: ["imdb"],
      defaultLogoAlign: "left",
      landscape: {},
    }))
    // REAL preview URL: SettingsPanel writes the debounced preview through the
    // actual DefaultsPosterPreview (same `land ?? flat` builder), so the
    // effective landscape recipe is verified on the URL, not on the ctx alone.
    const opened: string[] = []
    class FakeXHR {
      onprogress: ((e: unknown) => void) | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      ontimeout: (() => void) | null = null
      responseType = ""
      timeout = 0
      status = 0
      response: unknown = null
      open(_method: string, url: string) { opened.push(String(url)) }
      send() {}
      abort() {}
      setRequestHeader() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)

    const { ctx } = renderSettings()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    const lastParams = () => new URL(opened[opened.length - 1], "http://localhost").searchParams
    expect(lastParams().get("shape")).toBe("landscape")

    // Outer/durable truth pre-apply (single source of the Save) + URL baseline.
    const landSeed = JSON.stringify(ctx().landscape)
    const portBefore = previewUrl(ctx(), "portrait")
    const landBefore = previewUrl(ctx(), "landscape")
    expect(isHighlighted(appleButton())).toBe(false)

    fireEvent.click(appleButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    // The staged draft carries the COMPLETE canonical Apple profile: the real
    // preview URL (`land ?? flat` builder) exposes blurFade 100 + siblings.
    const canonLand = APPLE_VISUAL_DEFAULTS.landscape
    const staged = lastParams()
    expect(staged.get("shape")).toBe("landscape")
    expect(staged.get("bf")).toBe(String(canonLand.blurFade))
    expect(staged.get("gradHeight")).toBe(String(canonLand.gradientHeight))
    expect(staged.get("blur")).toBe(String(canonLand.blurIntensity))
    expect(staged.get("bd")).toBe(String(canonLand.blurDarkness))
    expect(staged.get("tint")).toBe(String(canonLand.tintStrength))
    expect(staged.get("ts")).toBe(String(canonLand.topShade))
    expect(staged.get("bs")).toBe(canonLand.badgeStyle)
    expect(staged.get("rs")).toBe(canonLand.rankingBadgeStyle)
    expect(staged.get("qbs")).toBe(canonLand.qualityBadgeStyle)
    expect(staged.get("goy")).toBe(String(canonLand.genreBadgeOffsetY))
    expect(staged.get("netLogo")).toBe(canonLand.networkLogo ? "1" : "0")
    expect(staged.get("ribbon")).toBe(canonLand.ribbonEnabled ? "1" : "0")
    // Global rating sources outside the projection: preserved.
    expect(staged.get("rsrc")).toBe("imdb")

    // Zero durable writes / no autosave: outer ctx and URL unchanged,
    // no PUT. The profile lives only in the staged draft.
    expect(puts).toHaveLength(0)
    expect(JSON.stringify(ctx().landscape)).toBe(landSeed)
    expect(ctx().defaultBadgeStyle).toBe("shadow")
    expect(ctx().defaultRatingSources).toEqual(["imdb"])
    expect(ctx().defaultLogoAlign).toBe("left")
    expect(ctx().defaultPosterShape).toBe("poster")
    expect(previewUrl(ctx(), "landscape")).toBe(landBefore)
    expect(previewUrl(ctx(), "portrait")).toBe(portBefore)
    expect(isHighlighted(appleButton())).toBe(true)

    // Single explicit Save: preview == saved, canonical profile installed.
    vi.useRealTimers()
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    const body = puts[0].body
    expect(body.landscape).toMatchObject({
      blurFade: canonLand.blurFade,
      gradientHeight: canonLand.gradientHeight,
      qualityBadgeStyle: canonLand.qualityBadgeStyle,
      genreBadgeOffsetY: canonLand.genreBadgeOffsetY,
      logoOffsetY: canonLand.logoOffsetY,
      rankingBadgeStyle: canonLand.rankingBadgeStyle,
      networkLogo: canonLand.networkLogo,
      ribbonEnabled: canonLand.ribbonEnabled,
      sashOrder: canonLand.sashOrder,
    })
    // Flat, global and delivery intact (preset targets landscape). Server
    // payload: flat without the `default` prefix (defaultsToPayload).
    expect(body.badgeStyle).toBe("shadow")
    expect(body.ratingSources).toEqual(["imdb"])
    expect(body.logoAlign).toBe("left")
    expect(body.posterShape).toBe("poster")
    // The outer ctx adopts the saved state: canonical profile + frozen portrait.
    expect(ctx().landscape.blurFade).toBe(canonLand.blurFade)
    expect(ctx().landscape.qualityBadgeStyle).toBe(canonLand.qualityBadgeStyle)
    expect(ctx().landscape.genreBadgeOffsetY).toBe(canonLand.genreBadgeOffsetY)
    expect(ctx().landscape.logoOffsetY).toBeNull()
    expect(ctx().landscape.rankingBadgeStyle).toBe(canonLand.rankingBadgeStyle)
    expect(ctx().landscape.networkLogo).toBe(canonLand.networkLogo)
    expect(ctx().landscape.ribbonEnabled).toBe(canonLand.ribbonEnabled)
    expect(ctx().landscape.sashOrder).toEqual(canonLand.sashOrder)
    expect(ctx().defaultBadgeStyle).toBe("shadow")
    expect(ctx().defaultRatingSources).toEqual(["imdb"])
    expect(ctx().defaultLogoAlign).toBe("left")
    expect(ctx().defaultPosterShape).toBe("poster")
    const saved = new URL(previewUrl(ctx(), "landscape"), "http://localhost").searchParams
    expect(saved.get("bf")).toBe(String(canonLand.blurFade))
    expect(saved.get("qbs")).toBe(canonLand.qualityBadgeStyle)
    expect(previewUrl(ctx(), "portrait")).toBe(portBefore)
  })
})
