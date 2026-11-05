/**
 * Enlarged MINIATURE preview: direct badge drag.
 *
 * The overlay is the SAME `PosterBadgeDragLayer` used by the poster editor; the
 * injected thumbnail adapter writes the stack offsets (`ox`/`oy`) that the
 * corner presets and the preview URL use. This suite proves the handles appear
 * from the server-reported thumbnail geometry, a pointer drag moves the stack,
 * drag-mode OFF still selects/resizes, and a drag after a preset is the
 * "custom" state the preset buttons read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { PosterBadgeDragLayer } from "@/components/settings/PosterBadgeDragLayer"
import { useThumbnailBadgeGeometry } from "@/components/settings/useThumbnailBadgeGeometry"
import { buildThumbnailPreviewUrl } from "@/components/settings/thumbnail-preview"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

const PREVIEW_URL =
  "http://localhost:3000/api/thumbnail/tv/1396/season/1/episode/1?still=%2Fsample.jpg&w=320&badges=both&bstyle=pill&anchor=tr&ox=0&oy=0&source=imdb"

/** Server-reported thumbnail geometry (`families`, same contract as poster). */
const GEOMETRY_PAYLOAD = {
  badges: {
    canvasW: 320,
    canvasH: 180,
    kind: null,
    layout: "ranked",
    families: {
      genre: { left: 200, top: 8, w: 104, h: 30 },
    },
    fixedX: {},
    items: [],
  },
}

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })),
  )
}

function mockDisplayWidth(width: number, height: number) {
  const layer = screen.getByTestId("badge-drag-layer")
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect)
}

function renderLayer(input: { dragMode?: boolean } = {}) {
  let ctx: PosterEditorCtx | null = null
  function Harness() {
    ctx = usePosterEditor()
    const adapter = useThumbnailBadgeGeometry()
    return createElement(PosterBadgeDragLayer, {
      previewUrl: PREVIEW_URL,
      shape: "landscape",
      enabled: true,
      dragMode: input.dragMode ?? true,
      adapter,
    })
  }
  renderWithCtx(createElement("div", { style: { position: "relative", width: 320, height: 180 } }, createElement(Harness)))
  return () => ctx as unknown as PosterEditorCtx
}

async function waitForGenreHandle(): Promise<HTMLElement> {
  return await screen.findByTestId("badge-drag-handle-genre")
}

beforeEach(() => {
  localStorage.clear()
  stubFetch(GEOMETRY_PAYLOAD)
})

describe("thumbnail badge drag layer", () => {
  it("draws the reported stack frame and writes ox/oy from a pointer drag", async () => {
    const ctx = renderLayer()
    const handle = await waitForGenreHandle()
    // The frame exists (the inert bug produced no handle at all).
    expect(screen.getByTestId("badge-drag-layer").getAttribute("data-kind")).toBe("none")
    expect(handle.getAttribute("aria-pressed")).toBe("false")
    mockDisplayWidth(320, 180)

    fireEvent.pointerDown(handle, { button: 0, clientX: 250, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 260, clientY: 16, pointerId: 1 })
    fireEvent.pointerUp(handle, { clientX: 260, clientY: 16, pointerId: 1 })

    // 320px preview of a 320px canvas: 1 screen px = 1 canvas px.
    await waitFor(() => expect(ctx().thumbnailBadgeOffsetX).toBe(10))
    expect(ctx().thumbnailBadgeOffsetY).toBe(-4)

    // Same state the preview URL and the corner presets carry. Non-zero
    // offsets are exactly what the section reads as "custom".
    const url = buildThumbnailPreviewUrl({
      offsetX: ctx().thumbnailBadgeOffsetX,
      offsetY: ctx().thumbnailBadgeOffsetY,
    })
    const params = new URL(url, "http://localhost").searchParams
    expect(params.get("ox")).toBe("10")
    expect(params.get("oy")).toBe("-4")
  })

  it("drag-mode OFF locks the move but keeps selection and corner resize", async () => {
    const ctx = renderLayer({ dragMode: false })
    const handle = await waitForGenreHandle()
    mockDisplayWidth(320, 180)

    fireEvent.pointerDown(handle, { button: 0, clientX: 250, clientY: 20, pointerId: 2 })
    expect(handle.getAttribute("aria-pressed")).toBe("true")
    fireEvent.pointerMove(handle, { clientX: 270, clientY: 30, pointerId: 2 })
    fireEvent.pointerUp(handle, { clientX: 270, clientY: 30, pointerId: 2 })

    expect(ctx().thumbnailBadgeOffsetX).toBe(0)
    expect(ctx().thumbnailBadgeOffsetY).toBe(0)
    // Selection is still there and the corner resize handles are reachable.
    expect(await screen.findByTestId("badge-resize-handle-genre-nw")).toBeTruthy()
  })

  it("a drag after a corner preset is the custom state, and reset returns to the anchor", async () => {
    const ctx = renderLayer()
    const handle = await waitForGenreHandle()
    mockDisplayWidth(320, 180)

    // Corner preset state: zero offsets (the preset button is active).
    expect(ctx().thumbnailBadgeOffsetX).toBe(0)
    expect(ctx().thumbnailBadgeOffsetY).toBe(0)

    fireEvent.pointerDown(handle, { button: 0, clientX: 250, clientY: 20, pointerId: 3 })
    fireEvent.pointerMove(handle, { clientX: 256, clientY: 24, pointerId: 3 })
    fireEvent.pointerUp(handle, { clientX: 256, clientY: 24, pointerId: 3 })
    await waitFor(() => expect(ctx().thumbnailBadgeOffsetX).toBe(6))
    expect(ctx().thumbnailBadgeOffsetY).toBe(4)

    // Double-click reset of the group = canonical preset position again.
    fireEvent.doubleClick(screen.getByTestId("badge-drag-handle-genre"))
    await waitFor(() => expect(ctx().thumbnailBadgeOffsetX).toBe(0))
    expect(ctx().thumbnailBadgeOffsetY).toBe(0)
  })

  it("corner resize writes bscale and the preview URL carries it", async () => {
    const ctx = renderLayer({ dragMode: false })
    const handle = await waitForGenreHandle()
    mockDisplayWidth(320, 180)
    // The overlay derives the resize vectors from the DRAWN element rect.
    vi.spyOn(handle, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 8,
      width: 104,
      height: 30,
      top: 8,
      left: 200,
      right: 304,
      bottom: 38,
      toJSON: () => ({}),
    } as DOMRect)

    // Select the stack (drag-mode OFF keeps the move locked), then grab a
    // resize corner: the same handles the poster editor draws.
    fireEvent.pointerDown(handle, { button: 0, clientX: 250, clientY: 20, pointerId: 5 })
    fireEvent.pointerUp(handle, { clientX: 250, clientY: 20, pointerId: 5 })
    const resize = await screen.findByTestId("badge-resize-handle-genre-se")

    // Centre = (252, 23). Moving the SE corner outward grows the pill.
    fireEvent.pointerDown(resize, { button: 0, clientX: 304, clientY: 38, pointerId: 6 })
    fireEvent.pointerMove(resize, { clientX: 330, clientY: 45, pointerId: 6 })
    fireEvent.pointerUp(resize, { clientX: 330, clientY: 45, pointerId: 6 })

    await waitFor(() => expect(ctx().thumbnailBadgeScale).toBeGreaterThan(100))
    expect(ctx().thumbnailBadgeScale).toBeLessThanOrEqual(200)
    // The resize is scale-only: the stack offsets stay untouched.
    expect(ctx().thumbnailBadgeOffsetX).toBe(0)
    expect(ctx().thumbnailBadgeOffsetY).toBe(0)

    // The WYSIWYG preview URL carries the very same scale (and `/meta` reads
    // the persisted default through the same contract).
    const params = new URL(
      buildThumbnailPreviewUrl({
        badgeScale: ctx().thumbnailBadgeScale,
        offsetX: ctx().thumbnailBadgeOffsetX,
        offsetY: ctx().thumbnailBadgeOffsetY,
      }),
      "http://localhost",
    ).searchParams
    expect(params.get("bscale")).toBe(String(ctx().thumbnailBadgeScale))
  })
})
