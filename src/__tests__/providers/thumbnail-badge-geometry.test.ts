// @vitest-environment node
/**
 * Thumbnail `?debug=1&netgeo=1` report contract.
 *
 * The enlarged thumbnail preview reuses the SHARED drag overlay
 * (`PosterBadgeDragLayer`), which parses the poster `badges` contract
 * (`families`/`fixedX`/`items`). Reporting the stack box under a different key
 * made the parser bail and the overlay never mount, so the drag looked inert.
 */
import { describe, expect, it } from "vitest"
import { parseBadgeDragGeometry } from "@/lib/badge-drag-geometry"
import {
  thumbnailBadgeGeometryReport,
  type RenderEpisodeThumbnailResult,
} from "@/lib/thumbnail-renderer"

const RESULT: Pick<RenderEpisodeThumbnailResult, "w" | "h" | "geometry"> = {
  w: 320,
  h: 180,
  geometry: { left: 200, top: 8, w: 104, h: 30 },
}

describe("thumbnail debug geometry", () => {
  it("reports the shared badges contract the drag overlay parses", () => {
    const parsed = parseBadgeDragGeometry(thumbnailBadgeGeometryReport(RESULT))

    expect(parsed).not.toBeNull()
    expect(parsed!.canvasW).toBe(320)
    expect(parsed!.canvasH).toBe(180)
    expect(parsed!.layout).toBe("ranked")
    // The badge stack is the single movable family: its visible body box is
    // the one the renderer actually composed.
    expect(parsed!.boxes.genre).toEqual({ left: 200, top: 8, w: 104, h: 30 })
    // No per-item/ghost targets: `ox`/`oy` move the whole stack.
    expect(parsed!.items).toEqual([])
    expect(parsed!.fixedX).toEqual({})
  })

  it("is not the legacy `boxes` shape (what made the overlay inert)", () => {
    const payload = thumbnailBadgeGeometryReport(RESULT) as unknown as {
      badges: Record<string, unknown>
    }
    expect(payload.badges.families).toBeDefined()
    expect(payload.badges.boxes).toBeUndefined()
  })
})
