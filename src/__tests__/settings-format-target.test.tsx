/**
 * Single "format to edit" selector (portrait/landscape).
 *
 * - Rendered before the controls on visual tabs.
 * - Landscape switches editing target + preview only, never the persisted
 *   `defaultPosterShape` (Stremio delivery format) or other defaults.
 * - The target survives tab switches (Badge <-> Transform).
 * - Transform numerics follow the target (existing `land ?? flat` profile);
 *   Badge toggles/styles stay shared.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, screen, within, act } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams
}

describe("format target selector", () => {
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

  it("selector precedes controls; Landscape -> landscape preview, persists on Badge, defaults intact", async () => {
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

    // Single selector visible on the initial Badge tab, before the controls.
    const formatTarget = screen.getByTestId("format-target-selector")
    const controls = screen.getByTestId("settings-controls")
    expect(formatTarget.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(lastParams().get("shape")).toBe("poster")

    // Landscape: target + preview only, no default touched.
    fireEvent.click(within(formatTarget).getByText("ui.posterShapeLandscape"))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("shape")).toBe("landscape")
    expect(lastParams().get("gradHeight")).toBe("20")
    expect(lastParams().get("tscale")).toBe("120")
    const ed = ctx as unknown as PosterEditorCtx
    expect(ed.defaultPosterShape).toBe("poster")
    // Other defaults intact: flats never follow the Landscape target.
    expect(ed.defaultGradientHeight).toBe(30)
    expect(ed.defaultTopBadgeScale).toBe(100)
    expect(ed.landscape.gradientHeight).toBe(20)

    // The target survives tab switches: moving to Transform keeps landscape.
    fireEvent.click(screen.getByRole("tab", { name: "ui.transform" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(screen.getByTestId("format-target-selector")).not.toBeNull()
    expect(lastParams().get("shape")).toBe("landscape")
    // Transform numerics follow the target (landscape profile).
    expect(screen.getByText("ui.landscapeDefaultsHint")).not.toBeNull()
    expect(ed.defaultPosterShape).toBe("poster")

    // Back on the Badge tab: still landscape (persisted target, not the default).
    fireEvent.click(screen.getByRole("tab", { name: "ui.badgeSection" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(lastParams().get("shape")).toBe("landscape")
    expect(ed.defaultPosterShape).toBe("poster")
  })
})
