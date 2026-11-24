/**
 * Compact preset thumbnails (Preset tab): ready + personal gallery frames are
 * measurably bounded/smaller while preserving proportions, readability and
 * selection.
 * - Ready gallery (PosterStyleCard compact): portrait frames bound to
 *   w-16/sm:w-20/lg:w-24 with aspect-[2/3], landscape wider
 *   (w-28/sm:w-36/lg:w-40) at aspect-video; images stay object-contain
 *   (never cropped), centered above the names; selection (aria-pressed,
 *   check, border) unchanged; a null URL still reserves the bounded frame
 *   (stable load/error, no layout shift).
 * - Legacy text-only callers (no compact, no thumbnailUrl) render no frame
 *   and keep the exact previous classes.
 * - Personal gallery (VisualPresetsSection gallery): frames honor the
 *   selected shape via the existing shape prop (landscape = 16:9, fixing the
 *   always-2:3 bug), use the real thumbnailFor URLs, keep selection
 *   affordances and a >=44px touch target; clicks still apply the preset.
 * - Actual PresetsPanel grids (both shapes) render seven real /api/poster/
 *   thumbnails in bounded frames with the personal empty copy stable.
 * Thumbnail presentation/layout only: URLs, preset values, renderer and
 * save semantics are untouched (covered by the preset-age/ranked suites).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createElement } from "react"
import { PosterStyleCard } from "@/components/settings/PosterStyleCard"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { VisualPresetsSection } from "@/components/settings/VisualPresetsSection"
import { APPLE_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import type { VisualPreset } from "@/lib/visual-presets"
import { renderWithCtx } from "@/__tests__/test-utils"
import { openQuickLooks } from "@/__tests__/helpers/open-quick-looks"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

let presetList: unknown[] = []

beforeEach(() => {
  localStorage.clear()
  presetList = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        return {
          ok: true,
          status: 200,
          headers: { get: (_name: string): string | null => null },
          json: async () => ({}),
          text: async () => "{}",
        }
      }
      if (u.includes("/api/defaults/presets")) {
        return {
          ok: true,
          status: 200,
          headers: { get: (_name: string): string | null => null },
          json: async () => ({ presets: presetList }),
          text: async () => JSON.stringify({ presets: presetList }),
        }
      }
      return { ok: false, status: 404, headers: { get: (_name: string): string | null => null }, json: async () => ({}) }
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function frameOf(testId: string): Element | null {
  return screen.getByTestId(testId).querySelector("span[aria-hidden='true']")
}

describe("PosterStyleCard compact ready thumbnails", () => {
  it("portrait frame is bounded, centered and contained with selection intact", () => {
    const onApply = vi.fn()
    render(
      createElement(PosterStyleCard, {
        title: "Looks",
        desc: "hint",
        note: "note",
        thumbnailShape: "portrait",
        showBadge: false,
        compact: true,
        options: [
          {
            id: "apple",
            title: "Apple",
            desc: "Apple look",
            active: true,
            onApply,
            thumbnailUrl: "https://example.com/api/poster/movie/1?age=0",
          },
        ],
      }),
    )
    const btn = screen.getByTestId("poster-style-apple")
    expect(btn).toHaveAttribute("aria-pressed", "true")
    // Selection check still rendered.
    expect(btn.querySelector("svg")).not.toBeNull()
    const frame = frameOf("poster-style-apple")
    expect(frame).not.toBeNull()
    const cls = frame?.getAttribute("class") ?? ""
    // Bounded small widths (mobile 64px → desktop 96px), never full card width.
    expect(cls).toContain("w-16")
    expect(cls).toContain("sm:w-20")
    expect(cls).toContain("lg:w-24")
    expect(cls.split(/\s+/)).not.toContain("w-full")
    // Portrait proportion preserved, centered, clipping contained.
    expect(cls).toContain("aspect-[2/3]")
    expect(cls).toContain("mx-auto")
    expect(cls).toContain("overflow-hidden")
    expect(cls).toContain("max-w-full")
    openQuickLooks()
    const img = btn.querySelector("img")
    expect(img?.getAttribute("src")).toBe("https://example.com/api/poster/movie/1?age=0")
    expect(img?.getAttribute("class")).toContain("object-contain")
    expect(img?.getAttribute("loading")).toBe("lazy")
    fireEvent.click(btn)
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it("landscape frame is wider at an equal compact 16:9 footprint", () => {
    render(
      createElement(PosterStyleCard, {
        title: "Looks",
        desc: "hint",
        note: "note",
        thumbnailShape: "landscape",
        showBadge: false,
        compact: true,
        options: [
          {
            id: "full",
            title: "Full",
            desc: "Full look",
            active: false,
            onApply: () => {},
            thumbnailUrl: "https://example.com/api/poster/movie/1?shape=landscape",
          },
        ],
      }),
    )
    const frame = frameOf("poster-style-full")
    const cls = frame?.getAttribute("class") ?? ""
    expect(cls).toContain("aspect-video")
    expect(cls).not.toContain("aspect-[2/3]")
    expect(cls).toContain("w-28")
    expect(cls).toContain("sm:w-36")
    expect(cls).toContain("lg:w-40")
    expect(cls).toContain("mx-auto")
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "false")
  })

  it("compact null URL still reserves the bounded frame (stable load/error)", () => {
    render(
      createElement(PosterStyleCard, {
        title: "Looks",
        desc: "hint",
        note: "note",
        thumbnailShape: "portrait",
        showBadge: false,
        compact: true,
        options: [
          { id: "glass", title: "Glass", desc: "Glass look", active: false, onApply: () => {}, thumbnailUrl: null },
        ],
      }),
    )
    const frame = frameOf("poster-style-glass")
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute("class") ?? "").toContain("aspect-[2/3]")
    openQuickLooks()
    expect(screen.getByTestId("poster-style-glass").querySelector("img")).toBeNull()
  })

  it("legacy text-only callers render no frame with unchanged classes", () => {
    render(
      createElement(PosterStyleCard, {
        title: "Style",
        desc: "desc",
        note: "note",
        options: [
          { id: "essential", title: "Essential", desc: "Essential look", active: false, onApply: () => {} },
        ],
      }),
    )
    expect(screen.getByTestId("poster-style-essential").querySelector("span[aria-hidden='true']")).toBeNull()
    const grid = screen.getByTestId("poster-style-cards").querySelector(".grid")
    expect(grid?.getAttribute("class")).toContain("grid-cols-2 sm:grid-cols-3")
    expect(screen.getByTestId("poster-style-essential").getAttribute("class")).not.toContain("min-h-[44px]")
  })
})

describe("VisualPresetsSection gallery compact thumbnails", () => {
  function renderSection(shape: "portrait" | "landscape", onApply?: (preset: VisualPreset) => void) {
    presetList = [
      { id: "p1", name: "Mine", shape, values: APPLE_VISUAL_DEFAULTS },
    ]
    renderWithCtx(
      createElement(VisualPresetsSection, {
        shape,
        enabled: true,
        gallery: true,
        thumbnailFor: () => "https://example.com/api/poster/movie/7?age=0",
        onApplyPreset: onApply ?? (() => {}),
      }),
    )
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    return screen.findByTestId("visual-preset-p1", undefined, { timeout: 3000 })
  }

  it("portrait personal frame is bounded 2:3 with the real URL contained", async () => {
    const btn = await renderSection("portrait")
    const frame = btn.querySelector("span[aria-hidden='true']")
    expect(frame).not.toBeNull()
    const cls = frame?.getAttribute("class") ?? ""
    expect(cls).toContain("aspect-[2/3]")
    expect(cls).toContain("w-16")
    expect(cls).toContain("mx-auto")
    expect(cls.split(/\s+/)).not.toContain("w-full")
    openQuickLooks()
    const img = btn.querySelector("img")
    expect(img?.getAttribute("src")).toBe("https://example.com/api/poster/movie/7?age=0")
    expect(img?.getAttribute("class")).toContain("object-contain")
    // Touch target retained.
    expect(btn.getAttribute("class")).toContain("min-h-[44px]")
  })

  it("landscape personal frame honors the selected 16:9 shape (no 2:3 bug)", async () => {
    const btn = await renderSection("landscape")
    const frame = btn.querySelector("span[aria-hidden='true']")
    const cls = frame?.getAttribute("class") ?? ""
    expect(cls).toContain("aspect-video")
    expect(cls).not.toContain("aspect-[2/3]")
    expect(cls).toContain("w-28")
    expect(cls).toContain("mx-auto")
  })

  it("personal gallery click still applies the preset with selection affordance", async () => {
    const seen: unknown[] = []
    const btn = await renderSection("portrait", (preset) => {
      seen.push(preset)
    })
    expect(btn).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(btn)
    expect(seen).toHaveLength(1)
    expect((seen[0] as { id: string }).id).toBe("p1")
  })
})

describe("actual PresetsPanel compact grids", () => {
  it("ready thumbnails are real bounded poster URLs in both shapes; personal empty state stable", async () => {
    for (const shape of ["portrait", "landscape"] as const) {
      localStorage.clear()
      const { unmount } = renderWithCtx(
        createElement(PresetsPanel, { shape, demoMedia: null, active: true }),
      )
      for (const id of ["apple", "better-poster", "essential", "ratings", "full", "notch", "editorial", "glass", "cinema", "mono", "fresh"]) {
        const btn = screen.getByTestId(`poster-style-${id}`)
        const frame = btn.querySelector("span[aria-hidden='true']")
        expect(frame).not.toBeNull()
        const cls = frame?.getAttribute("class") ?? ""
        expect(cls).toContain("mx-auto")
        expect(cls.split(/\s+/)).not.toContain("w-full")
        if (shape === "landscape") {
          expect(cls).toContain("aspect-video")
        } else {
          expect(cls).toContain("aspect-[2/3]")
        }
        openQuickLooks()
        const src = btn.querySelector("img")?.getAttribute("src") ?? ""
        expect(src).toContain("/api/poster/")
      }
      // Personal gallery stays coherent: opens with a stable bounded empty state.
      fireEvent.click(screen.getByTestId("visual-presets-toggle"))
      expect(
        await screen.findByText("ui.perTitlePresetsEmpty", undefined, { timeout: 3000 }),
      ).toBeInTheDocument()
      unmount()
    }
  })
})
