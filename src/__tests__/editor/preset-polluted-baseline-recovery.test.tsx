/**
 * Recovery from a reset reference captured by the PRE-fix ready apply.
 *
 * User report this guards against: "restore the corrupted original presets —
 * the built-in looks came back with my moved marks".
 *
 * The built-in recipes themselves were never wrong: the per-item correction
 * field (`defaultBadgeItemTransforms`) was added AFTER the recipes, so a
 * pre-fix ready apply copied only the defined recipe keys and left the LIVE
 * per-item corrections in place. The immutable reset reference
 * (`activePresetBaseline:<namespace>:<shape>`, captured from the post-apply
 * session) therefore stored those live corrections as if they belonged to the
 * built-in look: every later group/item reset resurrected them.
 *
 * Contract under test:
 * - a legacy (pre-fix) reference for a BUILT-IN look is recovered from the
 *   trusted recipe on read — the owned item-transform value only, everything
 *   else in the snapshot stays byte-identical — so a reset returns to the
 *   built-in look without requiring a re-apply;
 * - applying a built-in look on a polluted space yields EXACTLY the look of
 *   applying it on a moved-but-unpolluted space (and rewrites the reference
 *   with a fresh, clean snapshot);
 * - global Save + reload + reset stays on the preset look (never on the tuned
 *   global defaults, never on the old nudges);
 * - PERSONAL references are never rewritten: there is no trusted recipe to
 *   reconstruct them from, so their stored snapshot is honored verbatim.
 *
 * Real staged boundary: `useSettingsSession` + `PresetsPanel` +
 * `useShapeBadgeGeometryDefaults` (the reset controls), both shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createElement, useEffect } from "react"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { READY_PRESET_ENTRIES } from "@/lib/ready-visual-presets"
import { ACTIVE_PRESET_BASELINE_REV } from "@/lib/active-preset-baseline"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { createWrapper } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

type Shape = "portrait" | "landscape"

/** The user dragged the quality group AND several quality marks. */
const MOVED_ITEMS = "quality:tier=140,20,-10;quality:age=90,4,4;quality:format:dv=120,-6,3"
const MOVED_QUALITY = { scale: 137, x: 55, y: -33 }

const SEED: Record<Shape, string> = {
  portrait: JSON.stringify({
    defaultQualityBadgeScale: MOVED_QUALITY.scale,
    defaultQualityBadgeOffsetX: MOVED_QUALITY.x,
    defaultQualityBadgeOffsetY: MOVED_QUALITY.y,
    defaultBadgeItemTransforms: MOVED_ITEMS,
  }),
  landscape: JSON.stringify({
    landscape: {
      qualityBadgeScale: MOVED_QUALITY.scale,
      qualityBadgeOffsetX: MOVED_QUALITY.x,
      qualityBadgeOffsetY: MOVED_QUALITY.y,
      badgeItemTransforms: MOVED_ITEMS,
    },
  }),
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let resets: ReturnType<typeof useShapeBadgeGeometryDefaults> | null = null

function mount(shape: Shape) {
  let session: SettingsSessionResult | null = null
  function Probe() {
    const api = useShapeBadgeGeometryDefaults(shape === "portrait" ? "poster" : "landscape")
    useEffect(() => { resets = api }, [api])
    return null
  }
  function Harness() {
    const s = useSettingsSession()
    useEffect(() => { session = s }, [s])
    return (
      <PosterEditorValueOverride value={s.value}>
        <Probe />
        <PresetsPanel shape={shape} demoMedia={null} active />
      </PosterEditorValueOverride>
    )
  }
  const view = render(createElement(Harness), { wrapper: createWrapper() })
  return { view, current: () => session as unknown as SettingsSessionResult, reset: () => resets as unknown as ReturnType<typeof useShapeBadgeGeometryDefaults> }
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
}

/** Everything the reset controls and the renderer read for the quality family. */
function qualityView(s: SettingsSessionResult, shape: Shape) {
  const rec = s.value as unknown as Record<string, unknown>
  const land = (s.value.landscape ?? {}) as Record<string, unknown>
  const { url } = buildDefaultsPreviewUrlFromEditor(s.value, {
    tmdbKey: "k", userId: null, lang: "en", demoMedia: null, previewShape: shape, previewFamily: null,
  })
  return {
    flat: {
      scale: rec.defaultQualityBadgeScale,
      x: rec.defaultQualityBadgeOffsetX,
      y: rec.defaultQualityBadgeOffsetY,
      items: rec.defaultBadgeItemTransforms,
    },
    profile: {
      scale: land.qualityBadgeScale,
      x: land.qualityBadgeOffsetX,
      y: land.qualityBadgeOffsetY,
      items: land.badgeItemTransforms,
    },
    url,
    bit: new URL(url, "http://localhost").searchParams.get("bit"),
  }
}

/** Shape-owned part of the look the reset controls are responsible for. */
function ownedView(view: ReturnType<typeof qualityView>, shape: Shape) {
  return shape === "portrait"
    ? { flat: view.flat, bit: view.bit }
    : { profile: view.profile, bit: view.bit }
}

const baselineKey = (shape: Shape) => `activePresetBaseline:global:${shape}`

/**
 * The reset reference a PRE-fix ready apply captured: the recipe geometry
 * (which that path always wrote) plus the LIVE per-item corrections (which it
 * silently kept) and no provenance marker.
 */
function legacyPoisonedBaseline(
  reference: ReturnType<typeof qualityView>,
  id: string,
  shape: Shape,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = shape === "portrait"
    ? {
        defaultQualityBadgeScale: reference.flat.scale,
        defaultQualityBadgeOffsetX: reference.flat.x,
        defaultQualityBadgeOffsetY: reference.flat.y,
        defaultBadgeItemTransforms: MOVED_ITEMS,
      }
    : {
        landscape: {
          qualityBadgeScale: reference.profile.scale,
          qualityBadgeOffsetX: reference.profile.x,
          qualityBadgeOffsetY: reference.profile.y,
          badgeItemTransforms: MOVED_ITEMS,
        },
      }
  return { id, name: id, kind: "ready", shape, snapshot }
}

/** Apply one built-in tile on a moved space and report the staged look. */
async function applyReady(shape: Shape, entryId: string, polluted?: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", SEED[shape])
  if (polluted) localStorage.setItem(baselineKey(shape), JSON.stringify(polluted))
  const mounted = mount(shape)
  await settle()
  fireEvent.click(screen.getByTestId(`poster-style-${entryId}`))
  await settle()
  const result = { quality: qualityView(mounted.current(), shape), full: mounted.current() }
  return { ...result, ...mounted }
}

beforeEach(() => {
  window.history.pushState({}, "", "/")
  localStorage.clear()
  resetGuestGuardForTests()
  resets = null
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const href = String(url)
    const reply = (data: unknown) => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => data, text: async () => JSON.stringify(data),
    })
    if (href.includes("/api/defaults/presets")) return reply({ presets: [] })
    return reply({})
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  cleanup()
  resets = null
})

describe("built-in reset reference recovery", () => {
  for (const shape of ["portrait", "landscape"] as const) {
    for (const entry of READY_PRESET_ENTRIES) {
      it(`${shape}: ${entry.id} resets to the built-in look without a re-apply (legacy polluted reference)`, async () => {
        // Reference look: the preset applied on the SAME moved space, with no
        // stored reference at all.
        const clean = await applyReady(shape, entry.id)
        const reference = clean.quality
        // The pre-fix snapshot for the very same apply: same geometry, but the
        // live per-item corrections kept (no `rev` marker).
        const polluted = legacyPoisonedBaseline(reference, entry.id, shape)
        clean.view.unmount()
        cleanup()

        localStorage.setItem("badgeDefaults", SEED[shape])
        localStorage.setItem(baselineKey(shape), JSON.stringify(polluted))
        const mounted = mount(shape)
        await settle()
        // Sanity: the draft still carries the user's moves.
        const live = qualityView(mounted.current(), shape)
        const liveItems = shape === "landscape" ? live.profile.items : live.flat.items
        expect(parseBadgeItemTransforms(liveItems as string))
          .toEqual(parseBadgeItemTransforms(MOVED_ITEMS))

        // Reset the quality group exactly like the Transform button /
        // fullscreen group double-click does.
        act(() => { mounted.reset().resetFamily("quality") })
        await settle()

        const recovered = qualityView(mounted.current(), shape)
        expect(ownedView(recovered, shape)).toEqual(ownedView(reference, shape))
        // Automatic layout on the wire: explicit empty `bit=`, never the
        // polluted reference and never an omission that would inherit it.
        expect(recovered.bit).toBe("")
        mounted.view.unmount()
        cleanup()
      })

      it(`${shape}: ${entry.id} apply on a polluted space is byte-identical to a clean apply`, async () => {
        const clean = await applyReady(shape, entry.id)
        const reference = clean.quality
        clean.view.unmount()
        cleanup()

        const pollutedRef = legacyPoisonedBaseline(reference, entry.id, shape)
        const polluted = await applyReady(shape, entry.id, pollutedRef)
        expect(polluted.quality).toEqual(reference)
        // The apply rewrote the reference with a fresh, clean snapshot.
        const stored = JSON.parse(String(localStorage.getItem(baselineKey(shape)))) as Record<string, unknown>
        expect(stored.id).toBe(entry.id)
        expect(stored.kind).toBe("ready")
        expect(stored.rev).toBe(ACTIVE_PRESET_BASELINE_REV)
        polluted.view.unmount()
        cleanup()
      })

      it(`${shape}: ${entry.id} Save + reload + reset stays on the built-in look`, async () => {
        const clean = await applyReady(shape, entry.id)
        const reference = clean.quality
        clean.view.unmount()
        cleanup()

        const polluted = await applyReady(shape, entry.id, legacyPoisonedBaseline(reference, entry.id, shape))
        // Tune after the apply, then persist the tuned look as the globals.
        // `applyFamilyMoves` writes the shape-correct layer (portrait flats,
        // landscape profile) exactly like the drag layer.
        act(() => {
          polluted.reset().applyFamilyMoves([{ family: "quality", offsetX: 60, offsetY: -44, scale: 180 }])
        })
        await settle()
        await act(async () => {
          const res = await polluted.current().save()
          expect(res.ok).toBe(true)
        })
        await settle()
        polluted.view.unmount()
        cleanup()

        // Reload: same device storage (saved globals + stored reference).
        const reloaded = mount(shape)
        await settle()
        act(() => { reloaded.reset().resetFamily("quality") })
        await settle()
        expect(ownedView(qualityView(reloaded.current(), shape), shape)).toEqual(ownedView(reference, shape))
        reloaded.view.unmount()
        cleanup()
      })
    }
  }

  it("personal references are never rewritten (no trusted recipe to recover from)", async () => {
    const id = "33333333-3333-4333-8333-333333333333"
    const stored = {
      id,
      name: "Mine",
      kind: "personal",
      shape: "portrait",
      snapshot: {
        defaultQualityBadgeScale: 130,
        defaultQualityBadgeOffsetX: 20,
        defaultQualityBadgeOffsetY: -5,
        defaultBadgeItemTransforms: "quality:tier=125,8,3",
      },
    }
    localStorage.setItem("badgeDefaults", SEED.portrait)
    localStorage.setItem(baselineKey("portrait"), JSON.stringify(stored))
    const mounted = mount("portrait")
    await settle()
    act(() => { mounted.reset().resetFamily("quality") })
    await settle()
    const view = qualityView(mounted.current(), "portrait")
    // The personal snapshot's own correction survives verbatim, and the
    // legacy entry was not stamped with a recipe-derived revision.
    expect(parseBadgeItemTransforms(view.flat.items as string))
      .toEqual(parseBadgeItemTransforms("quality:tier=125,8,3"))
    expect(view.flat.scale).toBe(130)
    expect(view.flat.x).toBe(20)
    const persisted = JSON.parse(String(localStorage.getItem(baselineKey("portrait")))) as Record<string, unknown>
    expect(persisted.rev).toBeUndefined()
    mounted.view.unmount()
    cleanup()
  })
})
