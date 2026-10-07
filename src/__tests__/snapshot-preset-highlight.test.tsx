/**
 * Snapshot preset highlight (BetterPoster/RPDB) per edit target:
 * - portrait: mapped flats + applied globals, ignores the other-format profile and delivery;
 * - landscape: preset-covered effective + applied globals, ignores delivery
 *   and preserved keys absent from the preset (e.g. extraBadgeStyle);
 * - no last-click flag: only real editor visual values.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import {
  BETTER_POSTER_VISUAL_DEFAULTS,
  RPDB_VISUAL_DEFAULTS,
} from "@/lib/default-visual-presets"
import type { VisualPresetValues } from "@/lib/visual-presets"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
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

function presetButton(label: string): HTMLElement {
  const btn = screen.getByText(label).closest("button")
  if (!btn) throw new Error(`preset button not found: ${label}`)
  return btn as HTMLElement
}

function isHighlighted(btn: HTMLElement): boolean {
  return btn.className.includes("ring-accent-orange/30") && btn.className.includes("bg-accent-orange/15")
}

function hasCheck(btn: HTMLElement): boolean {
  const svg = btn.querySelector("svg")
  if (!svg) return false
  const cls = svg.getAttribute("class") ?? ""
  if (cls.includes("lucide-check")) return true
  return svg.getAttribute("data-lucide") === "check"
}

const CASES: Array<{ label: string; values: VisualPresetValues }> = [
  { label: "Stile BetterPoster", values: BETTER_POSTER_VISUAL_DEFAULTS },
  { label: "Stile RPDB", values: RPDB_VISUAL_DEFAULTS },
]

describe.each(CASES)("snapshot highlight $label", ({ label }) => {
  it("portrait: highlights after click with custom landscape + delivery, off on applied visual/globals, stays on other format/delivery", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterShape: "landscape",
      defaultBadgeStyle: "shadow",
      defaultRatingSources: ["imdb"],
      landscape: { badgeStyle: "pill", extraBadgeStyle: "vetro", gradientHeight: 45 },
    }))
    const { ctx } = renderBadge("portrait")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const btn = presetButton(label)
    expect(isHighlighted(btn)).toBe(false)

    fireEvent.click(btn)
    const on = presetButton(label)
    expect(isHighlighted(on)).toBe(true)
    expect(hasCheck(on)).toBe(true)
    // Apply preserves the other format and delivery.
    expect(ctx().defaultPosterShape).toBe("landscape")
    expect(ctx().landscape.badgeStyle).toBe("pill")
    expect(ctx().landscape.extraBadgeStyle).toBe("vetro")

    // Applied visual change turns the highlight off.
    await act(async () => {
      ctx().setDefaultBadgeGenre(!ctx().defaultBadgeGenre)
    })
    expect(isHighlighted(presetButton(label))).toBe(false)
    expect(hasCheck(presetButton(label))).toBe(false)

    // Back on with a second real click.
    fireEvent.click(presetButton(label))
    expect(isHighlighted(presetButton(label))).toBe(true)

    // Other format and delivery stay on in portrait.
    await act(async () => {
      ctx().setLandscape({ badgeStyle: "shadow" })
    })
    expect(isHighlighted(presetButton(label))).toBe(true)
    await act(async () => {
      ctx().setDefaultPosterShape("poster")
    })
    expect(isHighlighted(presetButton(label))).toBe(true)
    // Restore the custom baseline for the next steps.
    await act(async () => {
      ctx().setDefaultPosterShape("landscape")
      ctx().setLandscape({ badgeStyle: "pill" })
    })
    expect(isHighlighted(presetButton(label))).toBe(true)

    // Applied globals turn the highlight off.
    await act(async () => {
      ctx().setDefaultRatingSources(["imdb"])
    })
    expect(isHighlighted(presetButton(label))).toBe(false)
  })

  it("landscape: highlights after click with custom flats + delivery + preserved extra, off on applied visual/globals, stays on other format/delivery/extra", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultBadgeStyle: "pill",
      defaultPosterShape: "poster",
      defaultRatingSources: ["imdb"],
      landscape: { extraBadgeStyle: "vetro" },
    }))
    const { ctx } = renderBadge("landscape")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const btn = presetButton(label)
    expect(isHighlighted(btn)).toBe(false)

    fireEvent.click(btn)
    const on = presetButton(label)
    expect(isHighlighted(on)).toBe(true)
    expect(hasCheck(on)).toBe(true)
    // Preserved key absent from the preset does not block the highlight.
    expect(ctx().landscape.extraBadgeStyle).toBe("vetro")
    // Flats and delivery never follow a landscape preset.
    expect(ctx().defaultBadgeStyle).toBe("pill")
    expect(ctx().defaultPosterShape).toBe("poster")

    // Applied visual change (profile) turns the highlight off.
    await act(async () => {
      const cur = ctx().landscape.globalBadges
      ctx().setLandscape({ globalBadges: !(cur ?? true) })
    })
    expect(isHighlighted(presetButton(label))).toBe(false)

    // Back on with a second real click.
    fireEvent.click(presetButton(label))
    expect(isHighlighted(presetButton(label))).toBe(true)
    // The preserved extra survives re-apply.
    expect(ctx().landscape.extraBadgeStyle).toBe("vetro")

    // Other format, delivery and extra stay on in landscape.
    await act(async () => {
      ctx().setDefaultBadgeStyle("shadow")
    })
    expect(isHighlighted(presetButton(label))).toBe(true)
    await act(async () => {
      ctx().setDefaultPosterShape("landscape")
    })
    expect(isHighlighted(presetButton(label))).toBe(true)
    await act(async () => {
      ctx().setLandscape({ extraBadgeStyle: "corner" })
    })
    expect(isHighlighted(presetButton(label))).toBe(true)
    // Restore for the global steps.
    await act(async () => {
      ctx().setDefaultBadgeStyle("pill")
      ctx().setDefaultPosterShape("poster")
      ctx().setLandscape({ extraBadgeStyle: "vetro" })
    })
    expect(isHighlighted(presetButton(label))).toBe(true)

    // Applied globals turn the highlight off (sources and fit).
    await act(async () => {
      ctx().setDefaultRatingSources(["imdb"])
    })
    expect(isHighlighted(presetButton(label))).toBe(false)
    fireEvent.click(presetButton(label))
    expect(isHighlighted(presetButton(label))).toBe(true)
    await act(async () => {
      ctx().setDefaultPortraitFitEnabled(!ctx().defaultPortraitFitEnabled)
    })
    expect(isHighlighted(presetButton(label))).toBe(false)
  })
})

describe.each(CASES)("fresh defaults highlight $label", ({ label }) => {
  it.each([{ shape: "portrait" }, { shape: "landscape" }] as const)(
    "fresh $shape: click turns orange + check on, gradient change turns it off",
    async ({ shape }) => {
      const { ctx } = renderBadge(shape)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(isHighlighted(presetButton(label))).toBe(false)

      fireEvent.click(presetButton(label))
      expect(isHighlighted(presetButton(label))).toBe(true)
      expect(hasCheck(presetButton(label))).toBe(true)

      if (shape === "portrait") {
        await act(async () => {
          ctx().setDefaultGradientHeight(99)
        })
      } else {
        await act(async () => {
          ctx().setLandscape({ gradientHeight: 5 })
        })
      }
      expect(isHighlighted(presetButton(label))).toBe(false)
      expect(hasCheck(presetButton(label))).toBe(false)
    },
  )
})
