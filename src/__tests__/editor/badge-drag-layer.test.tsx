/**
 * Direct badge dragging on the global defaults preview: handles come from the
 * server-reported boxes (no client layout), drags write the same Transform X/Y
 * state the sliders write, the top slot writes the layout it actually painted
 * (rank vs extra/fallback) and the fallback profile is materialized complete on
 * its first drag. No mocked renderer: the debug fetch is a transport stub.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { PosterBadgeDragLayer } from "@/components/settings/PosterBadgeDragLayer"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { createElement } from "react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const PREVIEW_URL = "http://localhost:3000/api/poster/movie/1?rv=9&scale=60"

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })),
  )
}

function badges(overrides: Record<string, unknown> = {}) {
  return {
    network: null,
    badges: {
      canvasW: 500,
      canvasH: 750,
      kind: "rank",
      layout: "ranked",
      families: {
        rank: { top: 20, left: 190, w: 120, h: 40 },
        genre: { top: 700, left: 150, w: 200, h: 30 },
      },
      fixedX: {},
      ...overrides,
    },
  }
}

function renderLayer(node: React.ReactElement) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(
    createElement("div", { style: { position: "relative", width: 250, height: 375 } }, node, createElement(Probe)),
  )
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

async function waitForHandle(family: string): Promise<HTMLElement> {
  return await screen.findByTestId(`badge-drag-handle-${family}`)
}

beforeEach(() => {
  localStorage.clear()
})

describe("PosterBadgeDragLayer", () => {
  it("draws only the reported boxes and labels the painted layout", async () => {
    seedDefaults({})
    stubFetch(badges())
    renderLayer(createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }))
    const rank = await waitForHandle("rank")
    expect(rank.getAttribute("data-kind")).toBe("ranked")
    expect(await waitForHandle("genre")).toBeTruthy()
    // quality/separate/network were not reported for this render: no handles.
    expect(screen.queryByTestId("badge-drag-handle-quality")).toBeNull()
    expect(screen.queryByTestId("badge-drag-handle-network")).toBeNull()
  })

  it("writes nothing while opt-in is off", async () => {
    seedDefaults({})
    stubFetch(badges())
    renderLayer(createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: false }))
    await waitFor(() => expect(screen.queryByTestId("badge-drag-layer")).toBeNull())
    expect(screen.queryByTestId("badge-drag-handle-rank")).toBeNull()
  })

  it("keyboard nudge writes the same ranked X/Y the sliders use", async () => {
    seedDefaults({ topBadgeOffsetX: 10, topBadgeOffsetY: -4, extraBadgeOffsetX: null })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const rank = await waitForHandle("rank")
    fireEvent.keyDown(rank, { key: "ArrowRight" })
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetX).toBe(11))
    fireEvent.keyDown(rank, { key: "ArrowDown", shiftKey: true })
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetY).toBe(6))
    // Two independent layouts: editing the ranked slot freezes the still
    // following fallback axes at their previous rank values (no jump).
    expect(ctx().defaultExtraBadgeOffsetX).toBe(10)
  })

  it("pointer drag converts screen px to canvas px and commits once", async () => {
    seedDefaults({ topBadgeOffsetX: 0, topBadgeOffsetY: 0 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    await waitForHandle("rank")
    const layer = screen.getByTestId("badge-drag-layer")
    // The layer fills the 250px-wide preview of a 500px canvas: 2 canvas px
    // per screen px.
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    const handle = screen.getByTestId("badge-drag-handle-rank")
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 110, clientY: 95, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 110, clientY: 95, pointerId: 1 })
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetX).toBe(20))
    expect(ctx().defaultTopBadgeOffsetY).toBe(-10)
  })

  it("never drags a badge outside the poster frame (live overlay and committed values)", async () => {
    seedDefaults({ topBadgeOffsetX: 0, topBadgeOffsetY: 0 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const handle = await waitForHandle("rank")
    const layer = screen.getByTestId("badge-drag-layer")
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 3 })
    // Far past the right and bottom edges (400/1600 canvas px asked).
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 900, pointerId: 3 })
    // Live overlay: rank 120x40 in 500x750 -> max left 380, max top 710, so the
    // drawn delta stops at 190/690 canvas px (= 95/345 screen px at this zoom).
    const pxOffset = (value: string) => Number(/\+ (-?[\d.]+)px\)/.exec(value)?.[1])
    expect(pxOffset(handle.style.left)).toBe(95)
    expect(pxOffset(handle.style.top)).toBe(345)
    // A refused alignment never draws a guide.
    expect(screen.queryByTestId("badge-drag-guide-x")).toBeNull()
    expect(screen.queryByTestId("badge-drag-guide-y")).toBeNull()
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 900, pointerId: 3 })
    // Same delta is what gets stored: the box lands flush on the frame edge.
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetX).toBe(190))
    expect(ctx().defaultTopBadgeOffsetY).toBe(690)
  })

  it("never drags the title logo outside the poster frame", async () => {
    seedDefaults({})
    stubFetch(badges({ families: { rank: { top: 20, left: 190, w: 120, h: 40 }, logo: { top: 500, left: 100, w: 300, h: 80 } } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const logo = await waitForHandle("logo")
    const layer = screen.getByTestId("badge-drag-layer")
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent.pointerDown(logo, { button: 0, clientX: 100, clientY: 100, pointerId: 4 })
    fireEvent.pointerMove(logo, { clientX: 1000, clientY: 100, pointerId: 4 })
    fireEvent.pointerUp(logo, { clientX: 1000, clientY: 100, pointerId: 4 })
    // Logo 300 wide in a 500 canvas: max left 200, start 100 -> at most +100.
    await waitFor(() => expect(ctx().defaultLogoOffsetX).toBe(100))
    expect(ctx().defaultLogoOffsetY).toBe(0)
  })

  it("does not jump an already out-of-frame box back to the frame edge", async () => {
    seedDefaults({ topBadgeOffsetX: 0, topBadgeOffsetY: 0 })
    // Stored offsets already pushed the rank badge past the left edge.
    stubFetch(badges({ families: { rank: { top: 20, left: -20, w: 120, h: 40 } } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const handle = await waitForHandle("rank")
    const layer = screen.getByTestId("badge-drag-layer")
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    // Dragging further out is refused: no write, and no 20px jump onto the edge.
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 5 })
    fireEvent.pointerMove(handle, { clientX: 80, clientY: 100, pointerId: 5 })
    fireEvent.pointerUp(handle, { clientX: 80, clientY: 100, pointerId: 5 })
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    // Moving back in is accepted verbatim (no invisible re-anchoring).
    fireEvent.keyDown(handle, { key: "ArrowRight" })
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetX).toBe(1))
  })

  it("keeps the keyboard nudge inside the frame (flush edge stays flush)", async () => {
    seedDefaults({ topBadgeOffsetX: 0, topBadgeOffsetY: 0 })
    // Rank badge already flush with the right edge: 380 + 120 = 500.
    stubFetch(badges({ families: { rank: { top: 20, left: 380, w: 120, h: 40 } } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const handle = await waitForHandle("rank")
    fireEvent.keyDown(handle, { key: "ArrowRight" })
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true })
    // Down is free, right is not: no write is issued for the refused axis.
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetY).toBe(10))
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("writes the COMPLETE fallback layout when the painted top badge is an extra", async () => {
    seedDefaults({ topBadgeOffsetY: 5, extraBadgeScale: null, extraBadgeOffsetY: null })
    stubFetch(
      badges({
        kind: "extra",
        layout: "fallback",
        families: { extra: { top: 12, left: 150, w: 200, h: 40 } },
      }),
    )
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const extra = await waitForHandle("extra")
    expect(extra.getAttribute("data-kind")).toBe("fallback")
    fireEvent.keyDown(extra, { key: "ArrowDown" })
    // Effective Y was the inherited ranked 5 -> 6, and the profile stops
    // following: scale + both offsets become explicit (complete layout).
    await waitFor(() => expect(ctx().defaultExtraBadgeOffsetY).toBe(6))
    expect(ctx().defaultExtraBadgeScale).toBe(100)
    expect(ctx().defaultExtraBadgeOffsetX).toBe(0)
    expect(ctx().defaultTopBadgeOffsetY).toBe(5)
  })

  it("locks the axis the renderer anchors (full-width genre bar)", async () => {
    seedDefaults({ genreBadgeOffsetX: 0, genreBadgeOffsetY: 0 })
    stubFetch(badges({ fixedX: { genre: true } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const genre = await waitForHandle("genre")
    expect(genre.getAttribute("data-x-locked")).toBe("true")
    fireEvent.keyDown(genre, { key: "ArrowRight" })
    fireEvent.keyDown(genre, { key: "ArrowUp" })
    await waitFor(() => expect(ctx().defaultGenreBadgeOffsetY).toBe(-1))
    expect(ctx().defaultGenreBadgeOffsetX).toBe(0)
  })

  it("a pointer drag on an anchored axis writes no offset the renderer ignores", async () => {
    seedDefaults({ genreBadgeOffsetX: 0, genreBadgeOffsetY: 0 })
    stubFetch(badges({ fixedX: { genre: true } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    await waitForHandle("genre")
    const layer = screen.getByTestId("badge-drag-layer")
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    const handle = screen.getByTestId("badge-drag-handle-genre")
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    // 10 screen px right (= 20 canvas px) and 5 screen px up (= 10 canvas px).
    fireEvent.pointerMove(handle, { clientX: 110, clientY: 95, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 110, clientY: 95, pointerId: 1 })
    await waitFor(() => expect(ctx().defaultGenreBadgeOffsetY).toBe(-10))
    // The anchored X is never written: no invisible state to re-apply later.
    expect(ctx().defaultGenreBadgeOffsetX).toBe(0)
  })

  it("snaps the drag to the rendered boxes and shows editor-only guides", async () => {
    seedDefaults({ topBadgeOffsetX: 0, topBadgeOffsetY: 0 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    await waitForHandle("rank")
    const layer = screen.getByTestId("badge-drag-layer")
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    const handle = screen.getByTestId("badge-drag-handle-rank")
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
    // Rank bottom (60) toward genre top (700): 320 screen px = 640 canvas px,
    // one canvas px past the snap target so the snap is what lands it.
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 420.5, pointerId: 1 })
    const guide = screen.getByTestId("badge-drag-guide-y")
    expect(guide.getAttribute("data-center")).toBeNull()
    // The poster centre lines are editor-only and appear while dragging.
    expect(screen.getByTestId("badge-drag-center-guide-x")).toBeTruthy()
    expect(screen.getByTestId("badge-drag-center-guide-y")).toBeTruthy()
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 420.5, pointerId: 1 })
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetY).toBe(640))
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    // Guides never survive the gesture (and never enter the poster render).
    expect(screen.queryByTestId("badge-drag-guide-y")).toBeNull()
    expect(screen.queryByTestId("badge-drag-center-guide-x")).toBeNull()
  })

  it("snaps to the poster centre on the axis the renderer applies", async () => {
    seedDefaults({ genreBadgeOffsetX: 0, genreBadgeOffsetY: 0 })
    stubFetch(badges({ fixedX: { genre: true } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const genre = await waitForHandle("genre")
    const layer = screen.getByTestId("badge-drag-layer")
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent.pointerDown(genre, { button: 0, clientX: 100, clientY: 300, pointerId: 2 })
    // Genre centre (715) toward the poster centre (375): -340 canvas px.
    fireEvent.pointerMove(genre, { clientX: 100, clientY: 129.75, pointerId: 2 })
    const guide = screen.getByTestId("badge-drag-guide-y")
    expect(guide.getAttribute("data-center")).toBe("true")
    // X is anchored by the renderer: no X guide is offered.
    expect(screen.queryByTestId("badge-drag-guide-x")).toBeNull()
    fireEvent.pointerUp(genre, { clientX: 100, clientY: 129.75, pointerId: 2 })
    await waitFor(() => expect(ctx().defaultGenreBadgeOffsetY).toBe(-340))
    expect(ctx().defaultGenreBadgeOffsetX).toBe(0)
  })

  it("moves the title logo through the same offsets the Transform sliders write", async () => {
    seedDefaults({})
    stubFetch(badges({ families: { logo: { top: 500, left: 100, w: 300, h: 80 } } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const logo = await waitForHandle("logo")
    // The title logo is position-only: scale (auto-fit) is never written.
    fireEvent.keyDown(logo, { key: "ArrowLeft", shiftKey: true })
    await waitFor(() => expect(ctx().defaultLogoOffsetX).toBe(-10))
    expect(ctx().defaultLogoOffsetY).toBe(0)
    expect(ctx().defaultLogoScale).toBeNull()
  })

  it("renders no handle when the server reports no badges block", async () => {
    seedDefaults({})
    stubFetch({ network: null })
    renderLayer(createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }))
    await waitFor(() => expect(screen.queryByTestId("badge-drag-layer")).toBeNull())
  })

  it("double-click resets the painted top slot (scale AND position), never the other profile", async () => {
    seedDefaults({ topBadgeScale: 150, topBadgeOffsetX: 40, topBadgeOffsetY: 25, extraBadgeScale: 120, extraBadgeOffsetX: 7 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const rank = await waitForHandle("rank")
    expect(rank.getAttribute("data-kind")).toBe("ranked")
    fireEvent.doubleClick(rank)
    await waitFor(() => expect(ctx().defaultTopBadgeScale).toBe(100))
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultTopBadgeOffsetY).toBe(0)
    // The fallback profile keeps its explicit values.
    expect(ctx().defaultExtraBadgeScale).toBe(120)
    expect(ctx().defaultExtraBadgeOffsetX).toBe(7)
  })

  it("double-click on the fallback top slot resets it to follow, leaving the ranked profile alone", async () => {
    seedDefaults({ topBadgeScale: 140, topBadgeOffsetX: 12, extraBadgeScale: 120, extraBadgeOffsetX: 5, extraBadgeOffsetY: -5 })
    stubFetch(
      badges({
        kind: "extra",
        layout: "fallback",
        families: { extra: { top: 12, left: 150, w: 200, h: 40 } },
      }),
    )
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const extra = await waitForHandle("extra")
    fireEvent.doubleClick(extra)
    await waitFor(() => expect(ctx().defaultExtraBadgeScale).toBeNull())
    expect(ctx().defaultExtraBadgeOffsetX).toBeNull()
    expect(ctx().defaultExtraBadgeOffsetY).toBeNull()
    expect(ctx().defaultTopBadgeScale).toBe(140)
    expect(ctx().defaultTopBadgeOffsetX).toBe(12)
  })

  it("double-click resets one non-top family (scale + X + Y) and retains unrelated values", async () => {
    seedDefaults({ genreBadgeScale: 130, genreBadgeOffsetX: 9, genreBadgeOffsetY: -4, qualityBadgeScale: 140, qualityBadgeOffsetX: 6 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const genre = await waitForHandle("genre")
    fireEvent.doubleClick(genre)
    await waitFor(() => expect(ctx().defaultGenreBadgeScale).toBe(100))
    expect(ctx().defaultGenreBadgeOffsetX).toBe(0)
    expect(ctx().defaultGenreBadgeOffsetY).toBe(0)
    expect(ctx().defaultQualityBadgeScale).toBe(140)
    expect(ctx().defaultQualityBadgeOffsetX).toBe(6)
  })

  it("never commits the competing pointer drag of a double-click pair", async () => {
    seedDefaults({ topBadgeOffsetX: 40, topBadgeOffsetY: 0, topBadgeScale: 120 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    const handle = await waitForHandle("rank")
    const layer = screen.getByTestId("badge-drag-layer")
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 250, height: 375, top: 0, left: 0, right: 250, bottom: 375,
      toJSON: () => ({}),
    } as DOMRect)
    // First click of the pair: no movement, nothing to commit.
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 9 })
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 100, pointerId: 9 })
    // Second press: a tiny movement must NOT commit a competing drag.
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 10 })
    fireEvent.pointerMove(handle, { clientX: 102, clientY: 100, pointerId: 10 })
    fireEvent.pointerUp(handle, { clientX: 102, clientY: 100, pointerId: 10 })
    expect(ctx().defaultTopBadgeOffsetX).toBe(40)
    // The double-click itself performs the reset.
    fireEvent.doubleClick(handle)
    await waitFor(() => expect(ctx().defaultTopBadgeOffsetX).toBe(0))
    expect(ctx().defaultTopBadgeScale).toBe(100)
  })
})

/** Displayed rect of one node: the layer is 250x375 (canvas 500x750 -> x2). */
function mockRect(el: Element, rect: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    left: rect.left,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect)
}

const LAYER_RECT = { left: 0, top: 0, width: 250, height: 375 }

async function selectFamily(
  family: string,
  rect: { left: number; top: number; width: number; height: number },
) {
  const handle = await waitForHandle(family)
  mockRect(screen.getByTestId("badge-drag-layer"), LAYER_RECT)
  mockRect(handle, rect)
  fireEvent.pointerDown(handle, { button: 0, clientX: rect.left + 1, clientY: rect.top + 1, pointerId: 21 })
  fireEvent.pointerUp(handle, { clientX: rect.left + 1, clientY: rect.top + 1, pointerId: 21 })
  return handle
}

describe("PosterBadgeDragLayer — corner resize", () => {
  it("reveals the corner handles of the selected element only", async () => {
    seedDefaults({})
    stubFetch(badges())
    renderLayer(createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }))
    const rank = await waitForHandle("rank")
    // Nothing selected yet: no resize affordance anywhere.
    expect(screen.queryByTestId("badge-resize-handle-rank-nw")).toBeNull()
    await selectFamily("rank", { left: 95, top: 10, width: 60, height: 20 })
    for (const corner of ["nw", "ne", "sw", "se"]) {
      expect(screen.getByTestId(`badge-resize-handle-rank-${corner}`)).toBeTruthy()
    }
    expect(rank.getAttribute("data-selected")).toBe("true")
    // Another reported element keeps its plain move handle.
    expect(screen.queryByTestId("badge-resize-handle-genre-nw")).toBeNull()
  })

  it("upscales by the pointer distance ratio and writes the family scale", async () => {
    seedDefaults({ topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    // Rank box 120x40 at x2 => 60x20 screen, centred at (125, 20).
    await selectFamily("rank", { left: 95, top: 10, width: 60, height: 20 })
    const corner = screen.getByTestId("badge-resize-handle-rank-se")
    fireEvent.pointerDown(corner, { button: 0, clientX: 155, clientY: 30, pointerId: 31 })
    fireEvent.pointerMove(corner, { clientX: 170, clientY: 35, pointerId: 31 })
    fireEvent.pointerUp(corner, { clientX: 170, clientY: 35, pointerId: 31 })
    // Ratio 1.5 on the same violin: 100 -> 150, position untouched.
    await waitFor(() => expect(ctx().defaultTopBadgeScale).toBe(150))
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultTopBadgeOffsetY).toBe(0)
    // Aspect preserved: both drawn axes grow by the same ratio while the new
    // render is in flight (36% x 8% of the canvas).
    const handle = screen.getByTestId("badge-drag-handle-rank")
    await waitFor(() => expect(handle.style.width).toBe(`${(120 * 1.5 / 500) * 100}%`))
    expect(handle.style.height).toBe(`${(40 * 1.5 / 750) * 100}%`)
  })

  it("downscales by the same ratio", async () => {
    seedDefaults({ topBadgeScale: 100 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    await selectFamily("rank", { left: 95, top: 10, width: 60, height: 20 })
    const corner = screen.getByTestId("badge-resize-handle-rank-se")
    fireEvent.pointerDown(corner, { button: 0, clientX: 155, clientY: 30, pointerId: 32 })
    fireEvent.pointerMove(corner, { clientX: 140, clientY: 25, pointerId: 32 })
    fireEvent.pointerUp(corner, { clientX: 140, clientY: 25, pointerId: 32 })
    await waitFor(() => expect(ctx().defaultTopBadgeScale).toBe(50))
  })

  it("never grows a full-width element past the frame (honest limit)", async () => {
    seedDefaults({ genreBadgeScale: 100, genreBadgeOffsetY: 0 })
    // Full-width genre bar: the reported box IS the canvas width.
    stubFetch(badges({ families: { genre: { top: 700, left: 0, w: 500, h: 30 } }, fixedX: { genre: true } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    // 500x30 at x2 => 250x15 screen, centred at (125, 357.5).
    await selectFamily("genre", { left: 0, top: 350, width: 250, height: 15 })
    const corner = screen.getByTestId("badge-resize-handle-genre-se")
    fireEvent.pointerDown(corner, { button: 0, clientX: 250, clientY: 365, pointerId: 33 })
    fireEvent.pointerMove(corner, { clientX: 500, clientY: 500, pointerId: 33 })
    fireEvent.pointerUp(corner, { clientX: 500, clientY: 500, pointerId: 33 })
    // Growing would leave the frame: the stored scale stays where it was.
    await waitFor(() => expect(screen.queryByTestId("badge-resize-handle-genre-se")).toBeTruthy())
    expect(ctx().defaultGenreBadgeScale).toBe(100)
    // Shrinking is still honest and accepted.
    fireEvent.pointerDown(corner, { button: 0, clientX: 250, clientY: 365, pointerId: 34 })
    fireEvent.pointerMove(corner, { clientX: 190, clientY: 360, pointerId: 34 })
    fireEvent.pointerUp(corner, { clientX: 190, clientY: 360, pointerId: 34 })
    await waitFor(() => expect(ctx().defaultGenreBadgeScale).toBeLessThan(100))
  })

  it("writes nothing when the resize is cancelled", async () => {
    seedDefaults({ topBadgeScale: 100 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    await selectFamily("rank", { left: 95, top: 10, width: 60, height: 20 })
    const corner = screen.getByTestId("badge-resize-handle-rank-se")
    fireEvent.pointerDown(corner, { button: 0, clientX: 155, clientY: 30, pointerId: 35 })
    fireEvent.pointerMove(corner, { clientX: 200, clientY: 50, pointerId: 35 })
    fireEvent.pointerCancel(corner, { pointerId: 35 })
    await waitFor(() => expect(corner.getAttribute("data-corner")).toBe("se"))
    expect(ctx().defaultTopBadgeScale).toBe(100)
  })

  it("keyboard arrows step the scale through the same clamp", async () => {
    seedDefaults({ topBadgeScale: 100 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    await selectFamily("rank", { left: 95, top: 10, width: 60, height: 20 })
    const corner = screen.getByTestId("badge-resize-handle-rank-nw")
    fireEvent.keyDown(corner, { key: "ArrowUp" })
    await waitFor(() => expect(ctx().defaultTopBadgeScale).toBe(101))
    fireEvent.keyDown(corner, { key: "ArrowDown", shiftKey: true })
    await waitFor(() => expect(ctx().defaultTopBadgeScale).toBe(91))
  })

  it("starts an auto-fit title logo from the reported box and writes an explicit scale", async () => {
    seedDefaults({ defaultLogoScale: null, defaultLogoOffsetX: null, defaultLogoOffsetY: null })
    // 300px wide in a 500px canvas = the auto-fit 60% the renderer used.
    stubFetch(badges({ families: { logo: { top: 500, left: 100, w: 300, h: 80 } } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    // 300x80 at x2 => 150x40 screen, centred at (125, 270).
    await selectFamily("logo", { left: 50, top: 250, width: 150, height: 40 })
    const corner = screen.getByTestId("badge-resize-handle-logo-se")
    fireEvent.pointerDown(corner, { button: 0, clientX: 200, clientY: 290, pointerId: 36 })
    fireEvent.pointerMove(corner, { clientX: 215, clientY: 294, pointerId: 36 })
    fireEvent.pointerUp(corner, { clientX: 215, clientY: 294, pointerId: 36 })
    // 60 * 1.2 = 72: explicit, the drag never leaves the offset state behind.
    await waitFor(() => expect(ctx().defaultLogoScale).toBe(72))
    expect(ctx().defaultLogoOffsetX).toBeNull()
    expect(ctx().defaultLogoOffsetY).toBeNull()
  })

  it("writes the separate-ratings RAW scale (the slider's storage contract)", async () => {
    seedDefaults({ defaultSeparateBadgeScale: 130 })
    // 100x30 stack reported at x2 => 50x15 screen, centred at (200, 307.5).
    stubFetch(badges({ families: { separate: { top: 600, left: 350, w: 100, h: 30 } } }))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true }),
    )
    await selectFamily("separate", { left: 175, top: 300, width: 50, height: 15 })
    const corner = screen.getByTestId("badge-resize-handle-separate-se")
    // Half-box vector (25, 7.5) canvas px -> x1.2.
    fireEvent.pointerDown(corner, { button: 0, clientX: 225, clientY: 315, pointerId: 39 })
    fireEvent.pointerMove(corner, { clientX: 230, clientY: 316.5, pointerId: 39 })
    fireEvent.pointerUp(corner, { clientX: 230, clientY: 316.5, pointerId: 39 })
    // 130 * 1.2 = 156 raw (the UI shows the relative 120): same storage as the
    // slider, no invented UI-space value.
    await waitFor(() => expect(ctx().defaultSeparateBadgeScale).toBe(156))
  })

  it("with drag mode off the body never moves, but selection and resize still work", async () => {
    seedDefaults({ topBadgeOffsetX: 0, topBadgeOffsetY: 0, topBadgeScale: 100 })
    stubFetch(badges())
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, {
        previewUrl: PREVIEW_URL,
        shape: "poster",
        enabled: true,
        dragMode: false,
      }),
    )
    const rank = await waitForHandle("rank")
    expect(screen.getByTestId("badge-drag-layer").getAttribute("data-drag-mode")).toBe("off")
    mockRect(screen.getByTestId("badge-drag-layer"), LAYER_RECT)
    mockRect(rank, { left: 95, top: 10, width: 60, height: 20 })
    fireEvent.pointerDown(rank, { button: 0, clientX: 100, clientY: 100, pointerId: 37 })
    fireEvent.pointerMove(rank, { clientX: 130, clientY: 120, pointerId: 37 })
    fireEvent.pointerUp(rank, { clientX: 130, clientY: 120, pointerId: 37 })
    // Drag mode OFF: no move was written, selection still happened.
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultTopBadgeOffsetY).toBe(0)
    expect(rank.getAttribute("data-selected")).toBe("true")
    const corner = screen.getByTestId("badge-resize-handle-rank-se")
    fireEvent.pointerDown(corner, { button: 0, clientX: 155, clientY: 30, pointerId: 38 })
    fireEvent.pointerMove(corner, { clientX: 161, clientY: 32, pointerId: 38 })
    fireEvent.pointerUp(corner, { clientX: 161, clientY: 32, pointerId: 38 })
    await waitFor(() => expect(ctx().defaultTopBadgeScale).toBeGreaterThan(100))
  })
})
