/**
 * Shape-scoped geometry values for the direct-drag handles.
 *
 * The drag writes `effective + delta`, so `effective` MUST be the value the
 * preview URL and the renderer actually used: a mismatch would make the badge
 * jump by the difference at release. The fallback (extra) profile follows the
 * legacy axis-by-axis inherit of the ranked one until it owns all three axes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"
import { createElement } from "react"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

type Values = ReturnType<typeof useShapeBadgeGeometryDefaults>

beforeEach(() => {
  localStorage.clear()
})

describe("useShapeBadgeGeometryDefaults", () => {
  it("resolves the fallback (extra) profile from the ranked one until it is owned", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultTopBadgeScale: 100,
        defaultTopBadgeOffsetX: 0,
        defaultTopBadgeOffsetY: 5,
        defaultExtraBadgeScale: null,
        defaultExtraBadgeOffsetX: null,
        defaultExtraBadgeOffsetY: null,
      }),
    )
    let values: Values | null = null
    function Probe() {
      values = useShapeBadgeGeometryDefaults("poster")
      return null
    }
    await act(async () => {
      renderWithCtx(createElement(Probe))
    })
    const v = values as unknown as Values
    expect(v.topBadgeOffsetY).toBe(5)
    // Legacy follow: every axis inherits the ranked value, no baked defaults.
    expect(v.extraBadgeScale).toBe(100)
    expect(v.extraBadgeOffsetY).toBe(5)
    expect(v.extraBadgeScaleExplicit).toBeNull()
  })

  it("lands on the LANDSCAPE ranked profile when the profile has no extra override", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultTopBadgeScale: 100,
        defaultTopBadgeOffsetX: 1,
        defaultTopBadgeOffsetY: 2,
        landscape: { topBadgeScale: 120, topBadgeOffsetX: 7, topBadgeOffsetY: 3 },
      }),
    )
    let values: Values | null = null
    function Probe() {
      values = useShapeBadgeGeometryDefaults("landscape")
      return null
    }
    await act(async () => {
      renderWithCtx(createElement(Probe))
    })
    const v = values as unknown as Values
    // The renderer's fallback is the CLASSIFICA value of the same shape.
    expect(v.extraBadgeScale).toBe(120)
    expect(v.extraBadgeOffsetX).toBe(7)
    expect(v.extraBadgeOffsetY).toBe(3)
  })

  it("resets ONE family to the canonical portrait defaults (position AND scale)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultGenreBadgeScale: 130, defaultGenreBadgeOffsetX: 9, defaultGenreBadgeOffsetY: -4, defaultQualityBadgeScale: 140 }),
    )
    let values: Values | null = null
    let ed: PosterEditorCtx | null = null
    function Probe() {
      values = useShapeBadgeGeometryDefaults("poster")
      ed = usePosterEditor()
      return null
    }
    await act(async () => {
      renderWithCtx(createElement(Probe))
    })
    const v = values as unknown as Values
    await act(async () => {
      v.resetFamily("genre")
    })
    expect((ed as unknown as PosterEditorCtx).defaultGenreBadgeScale).toBe(100)
    expect((ed as unknown as PosterEditorCtx).defaultGenreBadgeOffsetX).toBe(0)
    expect((ed as unknown as PosterEditorCtx).defaultGenreBadgeOffsetY).toBe(0)
    // Unrelated family untouched.
    expect((ed as unknown as PosterEditorCtx).defaultQualityBadgeScale).toBe(140)
    await act(async () => {
      v.resetFamily("quality")
    })
    expect((ed as unknown as PosterEditorCtx).defaultQualityBadgeScale).toBe(100)
    // The canonical quality offsets are the existing shape defaults.
    expect((ed as unknown as PosterEditorCtx).defaultQualityBadgeOffsetX).toBe(-10)
    expect((ed as unknown as PosterEditorCtx).defaultQualityBadgeOffsetY).toBe(15)
  })

  it("clears the landscape profile of ONE family (existing reset contract) without touching others", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultGenreBadgeScale: 100,
        landscape: {
          genreBadgeScale: 140,
          genreBadgeOffsetX: 7,
          genreBadgeOffsetY: 3,
          qualityBadgeScale: 120,
        },
      }),
    )
    let values: Values | null = null
    let ed: PosterEditorCtx | null = null
    function Probe() {
      values = useShapeBadgeGeometryDefaults("landscape")
      ed = usePosterEditor()
      return null
    }
    await act(async () => {
      renderWithCtx(createElement(Probe))
    })
    const v = values as unknown as Values
    await act(async () => {
      v.resetFamily("genre")
    })
    const landscape = (ed as unknown as PosterEditorCtx).landscape
    expect(landscape.genreBadgeScale).toBeUndefined()
    expect(landscape.genreBadgeOffsetX).toBeUndefined()
    expect(landscape.genreBadgeOffsetY).toBeUndefined()
    // Other landscape overrides survive.
    expect(landscape.qualityBadgeScale).toBe(120)
  })

  it("keeps a complete LANDSCAPE extra profile independent from the ranked one", async () => {    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultTopBadgeScale: 100,
        defaultTopBadgeOffsetX: 0,
        defaultTopBadgeOffsetY: 0,
        landscape: {
          topBadgeScale: 120,
          topBadgeOffsetX: 7,
          topBadgeOffsetY: 3,
          extraBadgeScale: 80,
          extraBadgeOffsetX: -40,
          extraBadgeOffsetY: 12,
        },
      }),
    )
    let values: Values | null = null
    function Probe() {
      values = useShapeBadgeGeometryDefaults("landscape")
      return null
    }
    await act(async () => {
      renderWithCtx(createElement(Probe))
    })
    const v = values as unknown as Values
    expect(v.extraBadgeScale).toBe(80)
    expect(v.extraBadgeOffsetX).toBe(-40)
    expect(v.extraBadgeOffsetY).toBe(12)
    expect(v.extraBadgeScaleExplicit).toBe(80)
    // The ranked layout is untouched by the fallback profile.
    expect(v.topBadgeScale).toBe(120)
    expect(v.topBadgeOffsetX).toBe(7)
  })

  it("writes the resize scale to the SAME layer the Transform sliders write", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultTopBadgeScale: 100,
        defaultGenreBadgeScale: 100,
        landscape: { topBadgeScale: 120, genreBadgeScale: 90, logoScale: 80 },
      }),
    )
    let poster: Values | null = null
    let land: Values | null = null
    let ed: PosterEditorCtx | null = null
    function Probe() {
      poster = useShapeBadgeGeometryDefaults("poster")
      land = useShapeBadgeGeometryDefaults("landscape")
      ed = usePosterEditor()
      return null
    }
    await act(async () => {
      renderWithCtx(createElement(Probe))
    })
    // Portrait flat keys, exactly the slider setters (integer values only).
    await act(async () => {
      ;(poster as unknown as Values).setFamilyScale("rank", 150)
      ;(poster as unknown as Values).setFamilyScale("genre", 70)
      ;(poster as unknown as Values).setFamilyScale("logo", 72)
      ;(poster as unknown as Values).setFamilyScale("separate", 100)
    })
    expect((ed as unknown as PosterEditorCtx).defaultTopBadgeScale).toBe(150)
    expect((ed as unknown as PosterEditorCtx).defaultGenreBadgeScale).toBe(70)
    expect((ed as unknown as PosterEditorCtx).defaultLogoScale).toBe(72)
    expect((ed as unknown as PosterEditorCtx).defaultSeparateBadgeScale).toBe(100)
    // Landscape profile keys: no portrait leak, no new key.
    await act(async () => {
      ;(land as unknown as Values).setFamilyScale("rank", 160)
      ;(land as unknown as Values).setFamilyScale("logo", 95)
    })
    expect((ed as unknown as PosterEditorCtx).landscape.topBadgeScale).toBe(160)
    expect((ed as unknown as PosterEditorCtx).landscape.logoScale).toBe(95)
    expect((ed as unknown as PosterEditorCtx).defaultTopBadgeScale).toBe(150)
    expect((ed as unknown as PosterEditorCtx).defaultLogoScale).toBe(72)
  })
})
