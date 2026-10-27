/**
 * Per-ITEM handles on the defaults preview.
 *
 * The editor hit-tests ONE target level at a time (toolbar switch): these tests
 * mount the layer on the ITEM level, the only one that paints single-badge
 * handles, so overlapping family/item boxes can never hide each other.
 *
 * Contract:
 * - one handle per separately composited badge, on the box the renderer
 *   reported for it (no client layout);
 * - the target is the STABLE identity (`rating:<source>`, `quality:tier`,
 *   `quality:format:<fmt>`, `quality:combo:dv-atmos`), never an array index:
 *   reordering the payload never moves a correction to another badge;
 * - nudging writes only that item's correction (group transforms untouched);
 * - double-click resets only that item (back to the automatic layout);
 * - neutral geometry is preserved: an untouched item's handle sits exactly on
 *   the reported box.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { PosterBadgeDragLayer } from "@/components/settings/PosterBadgeDragLayer"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"

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

function payload(items: Record<string, unknown>[]) {
  return {
    network: null,
    badges: {
      canvasW: 500,
      canvasH: 750,
      kind: "rank",
      layout: "ranked",
      families: {
        rank: { top: 20, left: 190, w: 120, h: 40 },
        quality: { top: 10, left: 400, w: 90, h: 80 },
        separate: { top: 120, left: 400, w: 80, h: 90 },
      },
      fixedX: {},
      items,
    },
  }
}

const ITEMS = [
  { id: "quality:tier", family: "quality", top: 10, left: 400, w: 90, h: 26, custom: false },
  { id: "quality:format:dv", family: "quality", top: 40, left: 420, w: 50, h: 22, custom: false },
  { id: "rating:imdb", family: "separate", top: 120, left: 400, w: 80, h: 40, custom: false },
  { id: "rating:tmdb", family: "separate", top: 165, left: 400, w: 80, h: 40, custom: false },
]

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

beforeEach(() => {
  localStorage.clear()
})

describe("PosterBadgeDragLayer per-item handles", () => {
  it("draws one handle per reported item, on the reported box, and none for absent items", async () => {
    seedDefaults({})
    stubFetch(payload(ITEMS))
    renderLayer(createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true, targetLevel: "item" }))
    const imdb = await screen.findByTestId("badge-item-handle-rating:imdb")
    // Neutral geometry preservation: the handle is exactly the reported box.
    expect(imdb.style.left).toBe(`calc(${(400 / 500) * 100}% + 0px)`)
    expect(imdb.style.top).toBe(`calc(${(120 / 750) * 100}% + 0px)`)
    expect(imdb.style.width).toBe(`${(80 / 500) * 100}%`)
    expect(imdb.style.height).toBe(`${(40 / 750) * 100}%`)
    expect(screen.getByTestId("badge-item-handle-rating:tmdb")).toBeTruthy()
    expect(screen.getByTestId("badge-item-handle-quality:tier")).toBeTruthy()
    expect(screen.getByTestId("badge-item-handle-quality:format:dv")).toBeTruthy()
    // A mark the renderer did not compose (Atmos suppressed) has no handle.
    expect(screen.queryByTestId("badge-item-handle-quality:format:atmos")).toBeNull()
    // Level exclusivity: on the ITEM level the family boxes are not painted, so
    // an item can never cover — and make unreachable — the group it belongs to.
    expect(screen.queryByTestId("badge-drag-handle-quality")).toBeNull()
    expect(screen.queryByTestId("badge-drag-handle-separate")).toBeNull()
  })

  it("writes only the nudged item, leaving the group transforms untouched", async () => {
    seedDefaults({
      defaultQualityBadgeOffsetX: -10,
      defaultQualityBadgeOffsetY: 15,
      defaultSeparateBadgeOffsetX: 3,
      defaultSeparateBadgeOffsetY: 4,
    })
    stubFetch(payload(ITEMS))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true, targetLevel: "item" }),
    )
    const imdb = await screen.findByTestId("badge-item-handle-rating:imdb")
    fireEvent.keyDown(imdb, { key: "ArrowRight" })
    fireEvent.keyDown(imdb, { key: "ArrowDown", shiftKey: true })
    await waitFor(() => expect(parseBadgeItemTransforms(ctx().defaultBadgeItemTransforms)).toEqual({
      "rating:imdb": { scale: 100, offsetX: 1, offsetY: 10 },
    }))
    // Group transforms untouched (individual corrections are additive).
    expect(ctx().defaultSeparateBadgeOffsetX).toBe(3)
    expect(ctx().defaultSeparateBadgeOffsetY).toBe(4)
    expect(ctx().defaultQualityBadgeOffsetX).toBe(-10)
    expect(ctx().defaultQualityBadgeOffsetY).toBe(15)
  })

  it("double-click resets ONLY the selected item", async () => {
    seedDefaults({
      defaultBadgeItemTransforms: "rating:imdb=130,5,0;rating:tmdb=90,0,-4",
    })
    stubFetch(payload(ITEMS))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true, targetLevel: "item" }),
    )
    const imdb = await screen.findByTestId("badge-item-handle-rating:imdb")
    fireEvent.doubleClick(imdb)
    await waitFor(() =>
      expect(parseBadgeItemTransforms(ctx().defaultBadgeItemTransforms)).toEqual({
        "rating:tmdb": { scale: 90, offsetX: 0, offsetY: -4 },
      }),
    )
    // The other item keeps its own correction.
    expect(parseBadgeItemTransforms(ctx().defaultBadgeItemTransforms)["rating:tmdb"]).toEqual({
      scale: 90,
      offsetX: 0,
      offsetY: -4,
    })
  })

  it("keeps a correction attached to its provider when the report is reordered", async () => {
    seedDefaults({ defaultBadgeItemTransforms: "rating:tmdb=90,0,-4" })
    const reordered = [ITEMS[2], ITEMS[3], ITEMS[0], ITEMS[1]]
    stubFetch(payload(reordered))
    const { ctx } = renderLayer(
      createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true, targetLevel: "item" }),
    )
    // Position 0 is now IMDb: nudging it must not touch TMDB's correction.
    const imdb = await screen.findByTestId("badge-item-handle-rating:imdb")
    fireEvent.keyDown(imdb, { key: "ArrowRight" })
    await waitFor(() =>
      expect(parseBadgeItemTransforms(ctx().defaultBadgeItemTransforms)).toEqual({
        "rating:tmdb": { scale: 90, offsetX: 0, offsetY: -4 },
        "rating:imdb": { scale: 100, offsetX: 1, offsetY: 0 },
      }),
    )
  })

  it("marks a corrected item and draws it at its own reported box", async () => {
    seedDefaults({ defaultBadgeItemTransforms: "rating:tmdb=150,0,0" })
    stubFetch(
      payload([
        { id: "rating:imdb", family: "separate", top: 120, left: 400, w: 80, h: 40, custom: false },
        { id: "rating:tmdb", family: "separate", top: 165, left: 380, w: 120, h: 60, custom: true },
      ]),
    )
    renderLayer(createElement(PosterBadgeDragLayer, { previewUrl: PREVIEW_URL, shape: "poster", enabled: true, targetLevel: "item" }))
    const tmdb = await screen.findByTestId("badge-item-handle-rating:tmdb")
    expect(tmdb.getAttribute("data-custom")).toBe("true")
    // The renderer already applied the correction: the handle uses its box.
    expect(tmdb.style.width).toBe(`${(120 / 500) * 100}%`)
    expect(screen.getByTestId("badge-item-handle-rating:imdb").getAttribute("data-custom")).toBeNull()
  })
})
