/**
 * Preset apply × per-ITEM badge corrections — shape-ownership parity.
 *
 * Contract being protected (documented in `.agents/render-params.md` and in
 * `visual-presets.ts`): a preset that carries no per-item corrections owns an
 * AUTOMATIC layout for the shape being edited, so the landscape profile it
 * writes is `badgeItemTransforms: null` — the explicit "no correction /
 * automatic" value, exactly like `logoScale: null` means auto. `undefined`
 * (key absent) is the only "follow the flat" marker.
 *
 * The three consumers of that value MUST agree, otherwise the preset look is
 * not the poster the user gets:
 * - the Settings preview URL (`buildDefaultsPreviewUrl`),
 * - the real server render resolution (`resolvePosterRenderConfig`, the same
 *   chain the `/api/poster` route runs),
 * - the shape-scoped geometry read the Transform item controls and the drag
 *   handles use (`useShapeBadgeGeometryDefaults`).
 *
 * Regression: the server chain ended on `?? sd.badgeItemTransforms`, which
 * resurrected the PORTRAIT flat corrections over an explicitly-owned
 * landscape `null`, and the geometry read used `??` too. Result after applying
 * any landscape ready look with a portrait item nudge staged: the WYSIWYG
 * preview showed the preset's automatic layout while the rendered poster kept
 * the old nudges (and the item controls claimed a correction that was not
 * painted). RED-before/GREEN-after covered here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createElement } from "react"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { useShapeBadgeGeometryDefaults } from "@/components/settings/useShapeDefaults"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { buildDefaultsPreviewUrlFromEditor } from "@/components/settings/DefaultsPosterPreview"
import { defaultsToPayload, type DefaultsState } from "@/lib/useDefaults"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { createWrapper } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

/** A portrait nudge the user dragged on the quality stack. */
const PORTRAIT_ITEMS = "quality:tier=90,0,10;rating:imdb=120,30,-20"
/** Landscape profile carrying the OPPOSITE nudge (must be cleared by a preset). */
const LANDSCAPE_ITEMS = "rating:tmdb=80,-40,0"

/** Seeded store: landscape delivery + portrait nudge + owned landscape nudge. */
const SEED = JSON.stringify({
  posterShape: "landscape",
  badgeItemTransforms: PORTRAIT_ITEMS,
  landscape: { badgeItemTransforms: LANDSCAPE_ITEMS },
})

/** Same, but the landscape profile owns the explicit automatic marker. */
const SEED_AUTO = JSON.stringify({
  posterShape: "landscape",
  badgeItemTransforms: PORTRAIT_ITEMS,
  landscape: { badgeItemTransforms: null },
})

function serverInput(sd: Record<string, unknown>): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd,
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
  }
}

describe("preset apply clears the edited shape's item corrections (server parity)", () => {
  let puts: unknown[]

  beforeEach(() => {
    window.history.pushState({}, "", "/")
    localStorage.clear()
    resetGuestGuardForTests()
    puts = []
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string }) => {
        if (init?.method === "PUT") puts.push(init)
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
  }

  function landscapeHarness() {
    let session: SettingsSessionResult | null = null
    function Harness() {
      const s = useSettingsSession()
      session = s
      return (
        <PosterEditorValueOverride value={s.value}>
          <PresetsPanel shape="landscape" demoMedia={null} active />
        </PosterEditorValueOverride>
      )
    }
    render(createElement(Harness), { wrapper: createWrapper() })
    return () => session as unknown as SettingsSessionResult
  }

  it("landscape ready look: staged null, unchanged portrait, preview and renderer agree", async () => {
    localStorage.setItem("badgeDefaults", SEED)
    const session = landscapeHarness()
    await settle()
    // Precondition: the staged draft starts from the stored corrections.
    expect(parseBadgeItemTransforms(session().value.landscape.badgeItemTransforms ?? null))
      .toEqual({ "rating:tmdb": { scale: 80, offsetX: -40, offsetY: 0 } })

    const flatBefore = {
      posterLayout: session().value.defaultPosterLayout,
      itemTransforms: session().value.defaultBadgeItemTransforms,
    }
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    await settle()

    const staged = session().value
    // 1. The preset owns the edited shape: landscape corrections cleared to the
    //    explicit automatic marker (never a dangling value).
    expect(staged.landscape.badgeItemTransforms).toBeNull()
    // The ready look owns the edited shape's ranking presentation.
    expect(staged.landscape.posterLayout).toBe("standard")
    // 2. The portrait layer is byte-identical (landscape apply = profile only):
    //    the portrait nudge and layout survive untouched.
    expect(staged.defaultBadgeItemTransforms).toBe(flatBefore.itemTransforms)
    expect(staged.defaultBadgeItemTransforms).toBe(PORTRAIT_ITEMS)
    expect(staged.defaultPosterLayout).toBe(flatBefore.posterLayout)
    // Nothing is persisted before the single global Save.
    expect(puts).toEqual([])

    // 3. The Settings preview of the edited shape spells the automatic layout
    //    as an EXPLICIT empty `bit=` (an absent param would inherit the saved
    //    portrait corrections server-side).
    const preview = new URL(
      buildDefaultsPreviewUrlFromEditor(
        staged as unknown as Parameters<typeof buildDefaultsPreviewUrlFromEditor>[0],
        { tmdbKey: "k", userId: null, lang: "it", demoMedia: null, previewShape: "landscape", previewFamily: null },
      ).url,
      "http://localhost",
    )
    expect(preview.searchParams.get("bit")).toBe("")

    // 4. The server render (same chain as /api/poster) resolves the SAME
    //    automatic layout from what the single Save would store. This is the
    //    parity assertion: the explicit landscape null must win over the
    //    portrait flat corrections, never inherit them.
    const stored = defaultsToPayload(staged as unknown as DefaultsState)
    expect(stored["badgeItemTransforms"]).toBe(PORTRAIT_ITEMS)
    expect((stored["landscape"] as Record<string, unknown>)["badgeItemTransforms"]).toBeNull()
    const config = resolvePosterRenderConfig(serverInput(stored))
    expect(config.badgeItemTransforms).toEqual({})
  })

  it("shape-scoped geometry read matches the renderer (no phantom correction)", async () => {
    // Owned landscape auto (null) + portrait flat nudge: the edited shape has
    // no correction, so the item controls/handles must show none.
    localStorage.setItem("badgeDefaults", SEED_AUTO)
    let values: ReturnType<typeof useShapeBadgeGeometryDefaults> | null = null
    function Probe() {
      values = useShapeBadgeGeometryDefaults("landscape")
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    await settle()
    expect((values as unknown as ReturnType<typeof useShapeBadgeGeometryDefaults>).itemTransforms).toEqual({})
  })
})

describe("explicit-null landscape profile wins over the flat (renderer chain)", () => {
  it("owned null = automatic, absent = follow the flat", () => {
    const base = {
      posterShape: "landscape" as const,
      badgeItemTransforms: PORTRAIT_ITEMS,
    }
    // Owned explicit null → automatic (the preset look).
    expect(
      resolvePosterRenderConfig(serverInput({ ...base, landscape: { badgeItemTransforms: null } })).badgeItemTransforms,
    ).toEqual({})
    // Absent key → still inherits the flat (legacy profiles unchanged).
    expect(
      resolvePosterRenderConfig(serverInput({ ...base, landscape: {} })).badgeItemTransforms,
    ).toEqual(parseBadgeItemTransforms(PORTRAIT_ITEMS))
    // A concrete landscape value wins over the flat (per-shape ownership).
    expect(
      resolvePosterRenderConfig(
        serverInput({ ...base, landscape: { badgeItemTransforms: LANDSCAPE_ITEMS } }),
      ).badgeItemTransforms,
    ).toEqual(parseBadgeItemTransforms(LANDSCAPE_ITEMS))
    // Portrait (no profile overlay) keeps the flat.
    expect(
      resolvePosterRenderConfig(
        serverInput({ posterShape: "poster", badgeItemTransforms: PORTRAIT_ITEMS, landscape: { badgeItemTransforms: null } }),
      ).badgeItemTransforms,
    ).toEqual(parseBadgeItemTransforms(PORTRAIT_ITEMS))
  })
})
