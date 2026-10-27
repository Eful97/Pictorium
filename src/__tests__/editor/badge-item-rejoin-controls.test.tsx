/**
 * UI affordances of the explicit REJOIN recovery, mounted on the REAL staged
 * settings session (the same `useSettingsSession` + `PosterEditorValueOverride`
 * boundary `SettingsPanel` uses).
 *
 * Two entry points, both unambiguous next to the historical Reset:
 *  - the per-badge rows of the Transform tab (`BadgeItemTransformControls`) —
 *    "Rejoin" appears only while that badge actually owns a correction;
 *  - the selection toolbar of the fullscreen editor (`PosterBadgeDragLayer`) —
 *    a real button, keyboard reachable, that rejoins the selected badge or the
 *    whole quality group.
 * Assertions read the SESSION draft: both must delete corrections only, never
 * restore the applied preset, never touch the group geometry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createElement, useEffect, useState } from "react"
import { BadgeItemTransformControls } from "@/components/settings/BadgeItemTransformControls"
import { PosterBadgeDragLayer } from "@/components/settings/PosterBadgeDragLayer"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"
import { PosterEditorValueOverride } from "@/lib/contexts/PosterEditorContext"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"
import { createWrapper } from "@/__tests__/test-utils"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const PREVIEW_URL = "http://localhost:3000/api/poster/movie/550?preview=1&shape=poster&layout=standard"

const DRAFT = "quality:tier=70,9,9;quality:age=90,4,4;quality:format:hdr=130,1,1;rating:imdb=80,8,3"

const ITEMS = [
  { id: "quality:tier", family: "quality" },
  { id: "quality:age", family: "quality" },
]

function geometryPayload() {
  return {
    network: null,
    badges: {
      canvasW: 500,
      canvasH: 750,
      kind: "rank",
      layout: "ranked",
      families: { quality: { top: 60, left: 420, w: 60, h: 100 } },
      fixedX: {},
      items: ITEMS.map((item, i) => ({ ...item, top: 60 + i * 44, left: 420, w: 60, h: 40 })),
    },
  }
}

let session: SettingsSessionResult | null = null

function mount(ui: React.ReactNode) {
  function Probe() {
    const s = useSettingsSession()
    useEffect(() => { session = s }, [s])
    return <PosterEditorValueOverride value={s.value}>{ui}</PosterEditorValueOverride>
  }
  return render(createElement(Probe), { wrapper: createWrapper() })
}

const current = () => session as unknown as SettingsSessionResult

beforeEach(() => {
  window.history.pushState({}, "", "/")
  localStorage.clear()
  resetGuestGuardForTests()
  session = null
  localStorage.setItem("badgeDefaults", JSON.stringify({
    defaultQualityBadgeScale: 120,
    defaultQualityBadgeOffsetX: 9,
    defaultQualityBadgeOffsetY: -7,
    defaultBadgeItemTransforms: DRAFT,
  }))
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => geometryPayload(), text: async () => JSON.stringify(geometryPayload()),
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe("Transform tab rows", () => {
  it("offers Rejoin only on a corrected badge and removes exactly that badge", async () => {
    mount(<BadgeItemTransformControls previewUrl={PREVIEW_URL} family="quality" shape="poster" />)
    await waitFor(() => expect(screen.getByTestId("badge-item-control-quality:tier")).toBeInTheDocument())

    // Both quality rows are corrected in the draft → both offer the recovery.
    const tierRejoin = screen.getByTestId("badge-item-rejoin-quality:tier")
    const ageRejoin = screen.getByTestId("badge-item-rejoin-quality:age")
    expect(tierRejoin.getAttribute("aria-label")).toContain("ui.badgeItemRejoin")
    // Distinct from the preset-aware Reset, which stays available next to it.
    expect(screen.getByTestId("badge-item-reset-quality:tier")).toBeInTheDocument()

    fireEvent.click(tierRejoin)
    await waitFor(() => expect(
      parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["quality:tier"],
    ).toBeUndefined())
    const after = parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)
    expect(after["quality:age"]).toEqual({ scale: 90, offsetX: 4, offsetY: 4 })
    // A hidden identity (no row, suppressed mark) is NOT swept by a single-item
    // rejoin, and the group geometry is untouched.
    expect(after["quality:format:hdr"]).toEqual({ scale: 130, offsetX: 1, offsetY: 1 })
    expect(after["rating:imdb"]).toEqual({ scale: 80, offsetX: 8, offsetY: 3 })
    expect(current().value.defaultQualityBadgeScale).toBe(120)
    expect(current().value.defaultQualityBadgeOffsetX).toBe(9)
    expect(current().value.defaultQualityBadgeOffsetY).toBe(-7)
    // The control disappears once the badge is back on the automatic layout.
    await waitFor(() => expect(screen.queryByTestId("badge-item-rejoin-quality:tier")).toBeNull())
    expect(ageRejoin).toBeInTheDocument()
  })
})

describe("fullscreen editor selection toolbar", () => {
  it("rejoins the selected badge, then the whole quality group from the toolbar", async () => {
    function Harness() {
      const [level, setLevel] = useState<"item" | "group">("item")
      return (
        <div>
          <button type="button" data-testid="diag-level-group" onClick={() => setLevel("group")}>g</button>
          <PosterBadgeDragLayer previewUrl={PREVIEW_URL} shape="poster" enabled dragMode={false} targetLevel={level} />
        </div>
      )
    }
    mount(<Harness />)

    // ITEM level: select the tier mark, the recovery button appears.
    await waitFor(() => expect(screen.getByTestId("badge-item-handle-quality:tier")).toBeInTheDocument())
    expect(screen.queryByTestId("badge-drag-rejoin")).toBeNull()
    fireEvent.pointerDown(screen.getByTestId("badge-item-handle-quality:tier"), { button: 0, pointerId: 1 })
    fireEvent.pointerUp(screen.getByTestId("badge-item-handle-quality:tier"), { pointerId: 1 })
    const itemButton = await screen.findByTestId("badge-drag-rejoin")
    expect(itemButton.textContent).toBe("ui.badgeItemRejoin")

    fireEvent.click(itemButton)
    await waitFor(() => expect(
      parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["quality:tier"],
    ).toBeUndefined())
    expect(parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["quality:age"]).toBeDefined()

    // GROUP level: selecting the quality group offers the group-wide recovery.
    fireEvent.click(screen.getByTestId("diag-level-group"))
    await waitFor(() => expect(screen.getByTestId("badge-drag-handle-quality")).toBeInTheDocument())
    fireEvent.pointerDown(screen.getByTestId("badge-drag-handle-quality"), { button: 0, pointerId: 2 })
    fireEvent.pointerUp(screen.getByTestId("badge-drag-handle-quality"), { pointerId: 2 })
    const groupButton = await screen.findByTestId("badge-drag-rejoin")
    expect(groupButton.textContent).toBe("ui.badgeGroupRejoin")
    fireEvent.click(groupButton)
    await waitFor(() => expect(
      Object.keys(parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms))
        .filter((id) => id.startsWith("quality:")),
    ).toEqual([]))
    // Sibling rating + group geometry survive the group rejoin.
    expect(parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["rating:imdb"])
      .toEqual({ scale: 80, offsetX: 8, offsetY: 3 })
    expect(current().value.defaultQualityBadgeScale).toBe(120)
    expect(current().value.defaultQualityBadgeOffsetX).toBe(9)
    expect(current().value.defaultQualityBadgeOffsetY).toBe(-7)
  })
})

describe("rejoin drops the optimistic overlay of a just-committed drag", () => {
  it("the drawn box returns to the reported slot immediately (never the removed delta)", async () => {
    // A real display width: without it the drag commit is refused (fail-closed).
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 500, height: 750, top: 0, left: 0, right: 500, bottom: 750, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect)
    mount(<PosterBadgeDragLayer previewUrl={PREVIEW_URL} shape="poster" enabled dragMode targetLevel="item" />)
    const handle = await screen.findByTestId("badge-item-handle-quality:tier")
    const slot = handle.getAttribute("style") ?? ""

    fireEvent.pointerDown(handle, { button: 0, pointerId: 5, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 130, clientY: 100 })
    fireEvent.pointerUp(handle, { pointerId: 5, clientX: 130, clientY: 100 })
    const moved = parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["quality:tier"]
    // The drag really committed a correction (containment/snapping decide how
    // many px: the assertion is that the stored offset moved).
    expect(moved?.scale).toBe(70)
    expect(moved?.offsetX).toBeGreaterThan(9)
    // Optimistic overlay: the committed delta is drawn on top of the reported
    // box while the next render lands.
    await waitFor(() => expect(
      screen.getByTestId("badge-item-handle-quality:tier").getAttribute("style"),
    ).not.toBe(slot))

    fireEvent.click(screen.getByTestId("badge-drag-rejoin"))
    await waitFor(() => expect(
      parseBadgeItemTransforms(current().value.defaultBadgeItemTransforms)["quality:tier"],
    ).toBeUndefined())
    // Pending state cleared with the correction: the handle is back on the
    // reported slot, not floating on a delta that no longer exists.
    await waitFor(() => expect(
      screen.getByTestId("badge-item-handle-quality:tier").getAttribute("style"),
    ).toBe(slot))
  })
})

describe("Transform tab quality card", () => {
  it("exposes Rejoin group beside Reset and clears the whole quality family", async () => {
    let outer: PosterEditorCtx | null = null
    function Probe() {
      outer = usePosterEditor()
      return null
    }
    renderWithCtx(
      <div>
        <TransformPanel active />
        <Probe />
      </div>,
    )
    const button = await screen.findByTestId("badge-group-rejoin-quality")
    // Unambiguous label, distinct from the Reset control next to it.
    expect(button.textContent).toBe("ui.badgeGroupRejoin")
    expect(button.getAttribute("title")).toBe("ui.badgeRejoinHint")
    expect(button.getAttribute("aria-label")).toBe("ui.badgeGroupRejoin")
    const reset = button.parentElement?.querySelector('button[aria-label="ui.reset"]')
    expect(reset).not.toBeNull()

    fireEvent.click(button)
    const ctx = outer as unknown as PosterEditorCtx
    const after = parseBadgeItemTransforms(ctx.defaultBadgeItemTransforms)
    expect(Object.keys(after).filter((id) => id.startsWith("quality:"))).toEqual([])
    expect(after["rating:imdb"]).toEqual({ scale: 80, offsetX: 8, offsetY: 3 })
    expect(ctx.defaultQualityBadgeScale).toBe(120)
    expect(ctx.defaultQualityBadgeOffsetX).toBe(9)
    expect(ctx.defaultQualityBadgeOffsetY).toBe(-7)
  })
})
