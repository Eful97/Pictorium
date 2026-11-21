import { describe, expect, it } from "vitest"
import { dragGridLinePcts, effectiveSnapThreshold } from "@/lib/drag-snap"
import { computeBadgeDragSnap, type BadgeDragGeometry } from "@/lib/badge-drag-geometry"

describe("grid snapping on the live drag path (computeBadgeDragSnap)", () => {
  // Isolated genre box: no centre/other-badge target nearby, only grid lines.
  const loose: BadgeDragGeometry = {
    canvasW: 500,
    canvasH: 750,
    kind: null,
    layout: "fallback",
    boxes: { genre: { top: 700, left: 160, w: 40, h: 30 } },
    fixedX: {},
    items: [],
  }
  const base = { geometry: loose, family: "genre" as const, box: loose.boxes.genre!, delta: { x: 5, y: 0 } }

  it("grid ON snaps the leading edge onto the left third line (166.67)", () => {
    const snap = computeBadgeDragSnap({ ...base, threshold: 6, grid: true })
    expect(snap.delta.x).toBeCloseTo(500 / 3 - 160, 5)
  })

  it("grid OFF keeps the raw delta", () => {
    expect(computeBadgeDragSnap({ ...base, threshold: 6 }).delta.x).toBe(5)
  })

  it("Alt (threshold 0) disables grid snapping too", () => {
    const snap = computeBadgeDragSnap({ ...base, threshold: effectiveSnapThreshold(6, true), grid: true })
    expect(snap.delta.x).toBe(5)
  })
})

describe("effectiveSnapThreshold (Alt bypass)", () => {
  it("keeps the threshold normally", () => {
    expect(effectiveSnapThreshold(4.5, false)).toBe(4.5)
  })

  it("returns 0 while Alt is held (snapping off)", () => {
    expect(effectiveSnapThreshold(4.5, true)).toBe(0)
  })
})

describe("dragGridLinePcts", () => {
  it("contains every 5% step, the centre and both thirds", () => {
    const pcts = dragGridLinePcts()
    for (let p = 0; p <= 100; p += 5) expect(pcts).toContain(p)
    expect(pcts).toContainEqual(expect.closeTo(100 / 3, 9))
    expect(pcts).toContainEqual(expect.closeTo(200 / 3, 9))
    expect([...pcts]).toEqual([...pcts].sort((a, b) => a - b))
  })
})
