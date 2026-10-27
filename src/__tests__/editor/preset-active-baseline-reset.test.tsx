/**
 * Applied-preset reset reference (approved lifecycle fix).
 *
 * The reset controls (Transform group buttons, fullscreen group/item
 * double-click) return to the immutable snapshot of the preset that was
 * applied — never to the globally saved defaults. The reference is per shape,
 * persists across a reload, and is refreshed only by an explicit preset
 * update. Without an applied preset the historical canonical reset applies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { createElement } from "react"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { APPLE_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import { captureVisualPreset, visualPresetSchema } from "@/lib/visual-presets"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { createWrapper } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const PRESET_ID = "22222222-2222-4222-8222-222222222222"

const PRESET = visualPresetSchema.parse({
  id: PRESET_ID,
  name: "Baseline",
  shape: "portrait",
  values: captureVisualPreset({
    ...APPLE_VISUAL_DEFAULTS,
    defaultTopBadgeScale: 130,
    defaultTopBadgeOffsetX: 42,
    defaultTopBadgeOffsetY: -15,
    defaultGenreBadgeScale: 110,
    defaultGenreBadgeOffsetX: 12,
    defaultGenreBadgeOffsetY: 6,
    defaultQualityBadgeScale: 140,
    defaultBadgeItemTransforms: "quality:tier=110,0,2;rating:imdb=120,5,0",
  }),
})

const SEED = JSON.stringify({
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
  defaultGenreBadgeScale: 100,
  defaultQualityBadgeScale: 100,
  defaultBadgeItemTransforms: null,
})

let session: SettingsSessionResult | null = null
let resets: ReturnType<typeof useShapeBadgeGeometryDefaults> | null = null

function ResetProbe() {
  const api = useShapeBadgeGeometryDefaults("poster")
  useEffect(() => { resets = api }, [api])
  return null
}

function mountPanel() {
  function Harness() {
    const s = useSettingsSession()
    useEffect(() => { session = s }, [s])
    return (
      <PosterEditorValueOverride value={s.value}>
        <ResetProbe />
        <PresetsPanel shape="portrait" demoMedia={null} active />
      </PosterEditorValueOverride>
    )
  }
  return render(createElement(Harness), { wrapper: createWrapper() })
}

function landscapeProbe() {
  function Probe() {
    const api = useShapeBadgeGeometryDefaults("landscape")
    useEffect(() => { resets = api }, [api])
    return null
  }
  function Harness() {
    const s = useSettingsSession()
    useEffect(() => { session = s }, [s])
    return (
      <PosterEditorValueOverride value={s.value}>
        <Probe />
      </PosterEditorValueOverride>
    )
  }
  return render(createElement(Harness), { wrapper: createWrapper() })
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const current = () => session as unknown as SettingsSessionResult
const reset = () => resets as unknown as ReturnType<typeof useShapeBadgeGeometryDefaults>

beforeEach(() => {
  window.history.pushState({}, "", "/")
  localStorage.clear()
  resetGuestGuardForTests()
  session = null
  resets = null
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const href = String(url)
      const reply = (data: unknown) => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => data,
        text: async () => JSON.stringify(data),
      })
      if (href.includes("/api/defaults/presets")) return reply({ presets: [PRESET] })
      return reply({})
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe("applied preset reset reference", () => {
  it("resets to the applied snapshot after a global Save and after a reload", async () => {
    localStorage.setItem("badgeDefaults", SEED)
    const view = mountPanel()
    await flush()
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    await flush()
    fireEvent.click(await screen.findByTestId(`visual-preset-${PRESET_ID}`))
    await flush()

    expect(current().value.defaultTopBadgeOffsetX).toBe(42)

    // Tune and persist the GLOBAL defaults: the reset reference must not move.
    act(() => {
      current().value.setDefaultTopBadgeOffsetX(200)
      current().value.setDefaultTopBadgeOffsetY(-77)
      current().value.setDefaultGenreBadgeScale(150)
    })
    await flush()
    await act(async () => { await current().save() })
    await flush()
    expect(current().value.defaultTopBadgeOffsetX).toBe(200)

    act(() => { reset().resetFamily("rank") })
    await flush()
    expect(current().value.defaultTopBadgeScale).toBe(130)
    expect(current().value.defaultTopBadgeOffsetX).toBe(42)
    expect(current().value.defaultTopBadgeOffsetY).toBe(-15)
    // Only the requested family moved: the tuned unrelated genre survives.
    expect(current().value.defaultGenreBadgeScale).toBe(150)

    // Reload: the reference (snapshot + identity) is persisted, so the reset
    // still returns to the preset, not to the saved global defaults.
    view.unmount()
    const second = mountPanel()
    await flush()
    expect(current().value.defaultTopBadgeOffsetX).toBe(200)
    act(() => { reset().resetFamily("rank") })
    await flush()
    expect(current().value.defaultTopBadgeOffsetX).toBe(42)
    expect(current().value.defaultTopBadgeScale).toBe(130)
    second.unmount()
  })

  it("resets selected groups and items to the snapshot, preserving unrelated settings", async () => {
    localStorage.setItem("badgeDefaults", SEED)
    mountPanel()
    await flush()
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    await flush()
    fireEvent.click(await screen.findByTestId(`visual-preset-${PRESET_ID}`))
    await flush()

    // Disturb both target families plus one unrelated family and the item map.
    act(() => {
      current().value.setDefaultGenreBadgeScale(170)
      current().value.setDefaultGenreBadgeOffsetX(33)
      current().value.setDefaultQualityBadgeScale(80)
      current().value.setDefaultTopBadgeOffsetX(99)
      current().value.setDefaultBadgeItemTransforms("quality:tier=80,9,9;rating:imdb=80,9,9")
    })
    await flush()

    act(() => { reset().resetFamilies(["genre", "quality"]) })
    await flush()
    expect(current().value.defaultGenreBadgeScale).toBe(110)
    expect(current().value.defaultGenreBadgeOffsetX).toBe(12)
    expect(current().value.defaultQualityBadgeScale).toBe(140)
    // Group reset includes the per-item corrections it owns: the preset's
    // quality correction comes back (not the current 80/9/9).
    const afterGroup = parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)
    expect(afterGroup["quality:tier"]).toEqual({ scale: 110, offsetX: 0, offsetY: 2 })
    expect(afterGroup["rating:imdb"]).toEqual({ scale: 80, offsetX: 9, offsetY: 9 })
    // Unrelated rank family untouched by the reset.
    expect(current().value.defaultTopBadgeOffsetX).toBe(99)

    // Single-item reset restores only that item's snapshot correction.
    act(() => { reset().resetItem("rating:imdb") })
    await flush()
    expect(parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["rating:imdb"])
      .toEqual({ scale: 120, offsetX: 5, offsetY: 0 })

    // Multi-item reset in one write: both return to the snapshot.
    act(() => {
      current().value.setDefaultBadgeItemTransforms("quality:tier=70,1,1;rating:imdb=70,1,1")
    })
    await flush()
    act(() => { reset().resetItems(["quality:tier", "rating:imdb"]) })
    await flush()
    const afterMulti = parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)
    expect(afterMulti["quality:tier"]).toEqual({ scale: 110, offsetX: 0, offsetY: 2 })
    expect(afterMulti["rating:imdb"]).toEqual({ scale: 120, offsetX: 5, offsetY: 0 })
  })

  it("saves landscape clears through the additive allowlisted list", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ landscape: { genreBadgeScale: 150, qualityBadgeScale: 120 } }))
    landscapeProbe()
    await flush()
    act(() => { reset().resetFamily("genre") })
    await flush()
    expect(current().value.landscape.genreBadgeScale).toBeUndefined()
    // Unrelated landscape override survives.
    expect(current().value.landscape.qualityBadgeScale).toBe(120)
    expect((current().value as unknown as Record<string, unknown>).landscapeReset).toEqual([
      "genreBadgeOffsetX",
      "genreBadgeOffsetY",
      "genreBadgeScale",
    ])

    const calls: { body?: unknown }[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") calls.push({ body: init.body })
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ ok: true }), text: async () => "{}",
      }
    }))
    await act(async () => { await current().save() })
    await flush()
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0].body)) as Record<string, unknown>
    expect(body.landscapeReset).toEqual([
      "genreBadgeOffsetX",
      "genreBadgeOffsetY",
      "genreBadgeScale",
    ])
    expect((body.landscape as Record<string, unknown>).genreBadgeScale).toBeUndefined()
    expect((body.landscape as Record<string, unknown>).qualityBadgeScale).toBe(120)
  })
})
