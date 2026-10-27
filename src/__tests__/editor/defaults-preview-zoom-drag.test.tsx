/**
 * Small preview → enlarged EDITOR (global defaults preview).
 *
 * The small preview exposes no manipulation at all: only a clearly labelled
 * edit/enlarge entry that opens the enlarged editor DIRECTLY. Inside that
 * dialog the editor-only layer lives (handles from the rendered poster, never
 * baked into the poster), clicking the poster never closes it, and the
 * drag-MODE toggle is the only pointer-move switch, reachable nowhere else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

/** XHR driven by the test: delivers one successful blob response. */
class LoadableXHR {
  static instances: LoadableXHR[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onprogress: ((e: ProgressEvent) => void) | null = null
  responseType = ""
  timeout = 0
  status = 200
  response: unknown = new Blob()
  constructor() {
    LoadableXHR.instances.push(this)
  }
  open() {}
  send() {}
  abort() {}
  setRequestHeader() {}
  finish() {
    this.onload?.()
  }
}

const BADGES_PAYLOAD = {
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
  },
}

beforeEach(() => {
  localStorage.clear()
  LoadableXHR.instances = []
  vi.stubGlobal("XMLHttpRequest", LoadableXHR as unknown as typeof XMLHttpRequest)
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:pictorium-preview",
    revokeObjectURL: () => {},
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => BADGES_PAYLOAD })),
  )
  vi.useFakeTimers()
})

afterEach(() => {
  // The real waitFor polling needs real timers (the debounce above is advanced
  // explicitly in the helper).
  vi.useRealTimers()
})

async function renderPreviewWithImage() {
  localStorage.setItem("badgeDefaults", JSON.stringify({}))
  renderWithCtx(createElement(DefaultsPosterPreview, {}))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
  const xhr = LoadableXHR.instances[LoadableXHR.instances.length - 1]
  await act(async () => {
    xhr.finish()
  })
  vi.useRealTimers()
}

async function openEditor() {
  await renderPreviewWithImage()
  fireEvent.click(screen.getByLabelText("ui.badgeEditOpen"))
  return await screen.findByTestId("defaults-preview-zoom-drag-area")
}

describe("small preview entry", () => {
  it("exposes a labelled edit entry and no manipulation layer or drag toggle", async () => {
    await renderPreviewWithImage()
    expect(screen.getByLabelText("ui.badgeEditOpen")).toBeTruthy()
    // No active manipulation in the small preview: no drag layer, no toggle.
    expect(screen.queryByTestId("badge-drag-layer")).toBeNull()
    expect(screen.queryByTestId("defaults-preview-badge-drag-toggle")).toBeNull()
    expect(screen.queryByTestId("defaults-preview-badge-drag-toggle-zoom")).toBeNull()
  })

  it("opens the enlarged editor DIRECTLY with a working move and no stored preference", async () => {
    const area = await openEditor()
    // The preference was never set: the editor surface is there anyway.
    expect(localStorage.getItem("previewBadgeDrag")).toBeNull()
    expect(area).toBeTruthy()
    // Handles come from the reported render, not from a client layout.
    await waitFor(() => expect(screen.getByTestId("badge-drag-handle-rank")).toBeTruthy())
    // Drag mode is ON by default: a first-time user drags and it moves (the
    // inert default read as a broken feature).
    expect(screen.getByTestId("badge-drag-layer").getAttribute("data-drag-mode")).toBe("on")
    // Selecting also exposes the corner resize (works with drag mode off too).
    fireEvent.pointerDown(screen.getByTestId("badge-drag-handle-rank"), { button: 0, pointerId: 1 })
    fireEvent.pointerUp(screen.getByTestId("badge-drag-handle-rank"), { pointerId: 1 })
    expect(await screen.findByTestId("badge-resize-handle-rank-nw")).toBeTruthy()
  })

  it("keeps the drag-mode toggle inside the fullscreen editor only", async () => {
    await renderPreviewWithImage()
    expect(screen.queryByTestId("defaults-preview-badge-drag-toggle-zoom")).toBeNull()
    fireEvent.click(screen.getByLabelText("ui.badgeEditOpen"))
    await screen.findByTestId("defaults-preview-zoom-drag-area")
    const toggle = await screen.findByTestId("defaults-preview-badge-drag-toggle-zoom")
    // ON by default (opt-out switch), and the explicit OFF choice persists.
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(toggle)
    expect(localStorage.getItem("previewBadgeDrag")).toBe("0")
    await waitFor(() =>
      expect(screen.getByTestId("badge-drag-layer").getAttribute("data-drag-mode")).toBe("off"),
    )
    // Leaving the editor removes the toggle again (small preview stays clean).
    fireEvent.click(screen.getByTestId("defaults-preview-badge-edit-close"))
    await waitFor(() => expect(screen.queryByTestId("defaults-preview-badge-drag-toggle-zoom")).toBeNull())
    expect(localStorage.getItem("previewBadgeDrag")).toBe("0")
  })
})

describe("enlarged editor", () => {
  it("does not close on poster pointer interaction and keeps an explicit close", async () => {
    const area = await openEditor()
    await waitFor(() => expect(screen.getByTestId("badge-drag-handle-rank")).toBeTruthy())
    fireEvent.pointerDown(area, { button: 0, pointerId: 2 })
    fireEvent.pointerUp(area, { pointerId: 2 })
    fireEvent.click(area)
    // Still open: only the explicit close (or Escape/backdrop) closes it.
    expect(screen.getByTestId("defaults-preview-zoom-drag-area")).toBeTruthy()
    expect(screen.getByLabelText("ui.defaultsPreviewZoomClose")).toBeTruthy()
    fireEvent.click(screen.getByTestId("defaults-preview-badge-edit-close"))
    await waitFor(() => expect(screen.queryByTestId("defaults-preview-zoom-drag-area")).toBeNull())
  })

  it("persists the drag-mode preference across openings", async () => {
    localStorage.setItem("previewBadgeDrag", "1")
    await openEditor()
    const toggle = await screen.findByTestId("defaults-preview-badge-drag-toggle-zoom")
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    expect(screen.getByTestId("badge-drag-layer").getAttribute("data-drag-mode")).toBe("on")
  })
})
