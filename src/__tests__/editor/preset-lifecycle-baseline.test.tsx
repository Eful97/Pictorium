/**
 * Preset ↔ global-defaults baseline integrity (real staged boundary).
 *
 * Contract under test (`.agents/render-params.md`, `visual-presets.ts`,
 * `VisualPresetsSection.tsx`):
 * - the single global Save (`PUT /api/defaults`) persists the TUNED look as
 *   the space defaults and never writes a preset;
 * - a personal preset's stored baseline changes ONLY through the explicit
 *   "save current style" action (`POST /api/defaults/presets`), never as a
 *   side effect of dragging, editing or the global Save;
 * - re-applying a tile restores that tile's own stored geometry (the tuned
 *   values saved as defaults are not the preset baseline);
 * - ready/built-in looks are immutable snapshots (never mutated by an apply
 *   + edit + Save roundtrip).
 *
 * User report this guards against: "I save a modified preset and it
 * overwrites the defaults / my new position is treated as the default instead
 * of the preset position".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createElement } from "react"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { APPLE_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import { captureVisualPreset, visualPresetSchema, type VisualPresetValues } from "@/lib/visual-presets"
import { createWrapper } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const PRESET_ID = "11111111-1111-4111-8111-111111111111"

/** Personal preset whose baseline geometry is NOT the factory geometry. */
const PRESET = visualPresetSchema.parse({
  id: PRESET_ID,
  name: "Mine",
  shape: "portrait",
  values: captureVisualPreset({
    ...APPLE_VISUAL_DEFAULTS,
    defaultTopBadgeScale: 130,
    defaultTopBadgeOffsetX: 42,
    defaultTopBadgeOffsetY: -15,
    defaultGenreBadgeScale: 110,
    defaultGenreBadgeOffsetX: 12,
    defaultGenreBadgeOffsetY: 6,
  }),
})

/** Stored space defaults: factory geometry, i.e. different from the preset. */
const SEED = JSON.stringify({
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
})

interface Call {
  url: string
  method: string
  body?: unknown
}

describe("preset baseline vs global defaults (staged settings)", () => {
  let calls: Call[]
  let presetStore: unknown[]

  beforeEach(() => {
    window.history.pushState({}, "", "/")
    localStorage.clear()
    resetGuestGuardForTests()
    calls = []
    presetStore = JSON.parse(JSON.stringify([PRESET])) as unknown[]
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? "GET"
        const href = String(url)
        calls.push({ url: href, method, body: init?.body })
        const reply = (data: unknown) => ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => data,
          text: async () => JSON.stringify(data),
        })
        if (href.includes("/api/defaults/presets")) {
          if (method === "GET") {
            const shape = new URL(href, "http://localhost").searchParams.get("shape") ?? "portrait"
            return reply({ presets: (presetStore as typeof PRESET[]).filter((p) => p.shape === shape) })
          }
          return reply({ presets: presetStore })
        }
        if (href.includes("/api/defaults")) return reply({})
        return { ...reply({}), ok: false, status: 404 }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
  }

  function mount() {
    let session: SettingsSessionResult | null = null
    function Harness() {
      const s = useSettingsSession()
      session = s
      return (
        <PosterEditorValueOverride value={s.value}>
          <PresetsPanel shape="portrait" demoMedia={null} active />
        </PosterEditorValueOverride>
      )
    }
    render(createElement(Harness), { wrapper: createWrapper() })
    return () => session as unknown as SettingsSessionResult
  }

  const defaultsWrites = () =>
    calls.filter((c) => c.method === "PUT" && c.url.includes("/api/defaults") && !c.url.includes("/presets"))
  const presetWrites = () =>
    calls.filter((c) => c.method !== "GET" && c.url.includes("/api/defaults/presets"))

  it("apply -> edit -> global Save: defaults persist the tuned look, the preset baseline never moves", async () => {
    localStorage.setItem("badgeDefaults", SEED)
    const session = mount()
    await settle()
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    await settle()
    const tile = screen.getByTestId(`visual-preset-${PRESET_ID}`)

    // Apply: the draft takes the preset's own geometry.
    fireEvent.click(tile)
    await settle()
    expect(session().value.defaultTopBadgeOffsetX).toBe(42)
    expect(session().value.defaultTopBadgeScale).toBe(130)

    // Refine (what the drag layer / sliders write).
    act(() => {
      session().value.setDefaultTopBadgeOffsetX(200)
      session().value.setDefaultTopBadgeOffsetY(-77)
    })
    await settle()

    // The single global Save persists the tuned appearance as the defaults.
    await act(async () => {
      const res = await session().save()
      expect(res.ok).toBe(true)
    })
    await settle()
    expect(defaultsWrites()).toHaveLength(1)
    const put = JSON.parse(String(defaultsWrites()[0].body)) as Record<string, unknown>
    expect(put["topBadgeOffsetX"]).toBe(200)

    // ...and never writes a preset, in memory or on the server.
    expect(presetWrites()).toEqual([])
    expect((presetStore[0] as typeof PRESET).values.defaultTopBadgeOffsetX).toBe(42)
    expect(PRESET.values.defaultTopBadgeOffsetX).toBe(42)

    // Re-applying the tile restores the PRESET baseline, not the tuned default.
    fireEvent.click(tile)
    await settle()
    expect(session().value.defaultTopBadgeOffsetX).toBe(42)
    expect(session().value.defaultTopBadgeOffsetY).toBe(-15)
    expect(session().value.defaultTopBadgeScale).toBe(130)
  })

  it("the explicit update action writes the personal preset only (never the defaults)", async () => {
    localStorage.setItem("badgeDefaults", SEED)
    const session = mount()
    await settle()
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    await settle()
    fireEvent.click(screen.getByTestId(`visual-preset-${PRESET_ID}`))
    await settle()
    act(() => {
      session().value.setDefaultTopBadgeOffsetX(210)
    })
    await settle()

    // Applying prefilled the name and exposed the explicit update action:
    // submitting the form is a CREATE, never a silent overwrite.
    fireEvent.click(screen.getByTestId("visual-presets-manage-toggle"))
    await settle()
    const nameInput = screen.getByLabelText("ui.visualPresetName") as HTMLInputElement
    expect(nameInput.value).toBe("Mine")
    await act(async () => {
      fireEvent.submit(nameInput.closest("form") as HTMLFormElement)
    })
    await settle()
    expect(presetWrites()).toEqual([])

    // First click arms the overwrite confirmation; only the second writes.
    fireEvent.click(screen.getByTestId("visual-preset-update"))
    await settle()
    expect(presetWrites()).toEqual([])
    fireEvent.click(screen.getByTestId("visual-preset-update"))
    await settle()

    expect(presetWrites()).toHaveLength(1)
    expect(presetWrites()[0].method).toBe("POST")
    const body = JSON.parse(String(presetWrites()[0].body)) as { id: string; mode: string; values: VisualPresetValues }
    expect(body.mode).toBe("update")
    expect(body.id).toBe(PRESET_ID)
    expect(body.values.defaultTopBadgeOffsetX).toBe(210)
    // The global defaults are untouched: the draft is still dirty against them.
    expect(defaultsWrites()).toEqual([])
    expect(session().dirty).toBe(true)
  })

  it("Save new preset always creates and never overwrites the applied preset", async () => {
    localStorage.setItem("badgeDefaults", SEED)
    const session = mount()
    await settle()
    fireEvent.click(screen.getByTestId("visual-presets-toggle"))
    await settle()
    fireEvent.click(screen.getByTestId(`visual-preset-${PRESET_ID}`))
    await settle()
    act(() => {
      session().value.setDefaultTopBadgeOffsetX(220)
    })
    await settle()

    fireEvent.click(screen.getByTestId("visual-presets-manage-toggle"))
    await settle()
    const nameInput = screen.getByLabelText("ui.visualPresetName") as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: "Mine copy" } })
    await act(async () => {
      fireEvent.submit(nameInput.closest("form") as HTMLFormElement)
    })
    await settle()

    expect(presetWrites()).toHaveLength(1)
    const body = JSON.parse(String(presetWrites()[0].body)) as { mode: string; id?: string; name: string; values: VisualPresetValues }
    expect(body.mode).toBe("create")
    expect(body.id).toBeUndefined()
    expect(body.name).toBe("Mine copy")
    expect(body.values.defaultTopBadgeOffsetX).toBe(220)
    // The existing personal preset is untouched by the create.
    expect((presetStore[0] as typeof PRESET).values.defaultTopBadgeOffsetX).toBe(42)
  })

  it("ready looks are immutable snapshots across apply + edit + Save", async () => {
    localStorage.setItem("badgeDefaults", SEED)
    const session = mount()
    await settle()
    const before = JSON.stringify(APPLE_VISUAL_DEFAULTS)

    fireEvent.click(screen.getByTestId("poster-style-apple"))
    await settle()
    act(() => {
      session().value.setDefaultTopBadgeOffsetX(180)
      session().value.setDefaultGenreBadgeOffsetY(30)
    })
    await settle()
    await act(async () => {
      await session().save()
    })
    await settle()

    // Re-applying the ready look brings back its own geometry.
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    await settle()
    expect(session().value.defaultTopBadgeOffsetX).toBe(APPLE_VISUAL_DEFAULTS.defaultTopBadgeOffsetX)
    expect(session().value.defaultGenreBadgeOffsetY).toBe(APPLE_VISUAL_DEFAULTS.defaultGenreBadgeOffsetY)
    expect(JSON.stringify(APPLE_VISUAL_DEFAULTS)).toBe(before)
  })
})
