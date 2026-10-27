/**
 * Direct badge dragging: authoritative geometry parsing, screen→canvas mapping,
 * offset clamps, per-axis locks and the two complete top-slot layouts. Pure
 * functions only — no providers, no server.
 */
import { describe, expect, it } from "vitest"
import {
  BADGE_DRAG_SNAP_SCREEN_PX,
  BADGE_SCALE_MAX,
  BADGE_SCALE_MIN,
  badgeDragLock,
  badgeResetApplies,
  badgeScaleLimits,
  canvasToScreenDelta,
  clampBadgeOffset,
  clampBadgeResizeScale,
  computeBadgeDragSnap,
  containBadgeDragDelta,
  resolveBadgeSelectionDragDelta,
  deriveEffectiveLogoScale,
  isBadgeDraggable,
  parseBadgeDragGeometry,
  pendingDragDelta,
  pendingResizeRatio,
  resolveBadgeDragDelta,
  resolveBadgeDragWrite,
  resolveBadgeReset,
  resolveBadgeResizeScale,
  screenToCanvasDelta,
  snapThresholdCanvas,
  stepBadgeResizeScale,
  topBadgeLayout,
  type BadgeDragGeometry,
  type BadgeResetDefaults,
} from "@/lib/badge-drag-geometry"
import { BADGE_OFFSET_NUMERIC_LIMIT } from "@/lib/badge-offset-ranges"

const GEO: BadgeDragGeometry = {
  canvasW: 500,
  canvasH: 750,
  kind: "rank",
  layout: "ranked",
  boxes: {
    rank: { top: 20, left: 190, w: 120, h: 40 },
    genre: { top: 700, left: 150, w: 200, h: 30 },
    quality: { top: 12, left: 400, w: 90, h: 26 },
    network: { top: 12, left: 12, w: 60, h: 30 },
  },
  fixedX: { genre: true },
  items: [],
}

describe("parseBadgeDragGeometry", () => {
  it("reads the badges block of the netgeo response", () => {
    const json = {
      meta: { shape: "poster" },
      network: { top: 12, left: 12, w: 60, h: 30, nominalW: 60, nominalH: 30 },
      badges: {
        canvasW: 500,
        canvasH: 750,
        kind: "extra",
        families: {
          extra: { top: 10, left: 10, w: 80, h: 30 },
          genre: { top: 700, left: 150, w: 200, h: 30 },
          quality: { top: 5, left: 5, w: 0, h: 26 },
          bogus: { top: 1, left: 1, w: 5, h: 5 },
        },
        fixedX: { genre: true, quality: "yes" },
      },
    }
    expect(parseBadgeDragGeometry(json)).toEqual({
      canvasW: 500,
      canvasH: 750,
      kind: "extra",
      layout: "fallback",
      boxes: {
        extra: { top: 10, left: 10, w: 80, h: 30 },
        genre: { top: 700, left: 150, w: 200, h: 30 },
      },
      fixedX: { genre: true },
      items: [],
    })
  })

  it("returns null for legacy/partial payloads instead of guessing boxes", () => {
    expect(parseBadgeDragGeometry(null)).toBeNull()
    expect(parseBadgeDragGeometry(undefined)).toBeNull()
    expect(parseBadgeDragGeometry({})).toBeNull()
    // Network-only payload (server before the badges block).
    expect(parseBadgeDragGeometry({ network: { top: 0, left: 0, w: 10, h: 10 } })).toBeNull()
    // Renders rejected completePosterRender: explicit null.
    expect(parseBadgeDragGeometry({ network: null, badges: null })).toBeNull()
    expect(parseBadgeDragGeometry({ badges: { canvasW: 0, canvasH: 750, families: {} } })).toBeNull()
    expect(parseBadgeDragGeometry({ badges: { canvasW: 500, canvasH: 750 } })).toBeNull()
    expect(parseBadgeDragGeometry("nope")).toBeNull()
  })

  it("keeps an unknown kind as null (no layout inferred)", () => {
    const parsed = parseBadgeDragGeometry({ badges: { canvasW: 500, canvasH: 750, kind: "award", families: {} } })
    expect(parsed?.kind).toBeNull()
    expect(parsed?.layout).toBeNull()
    expect(parsed?.boxes).toEqual({})
  })

  it("keeps the WHOLE-POSTER layout explicit, even with no top badge", () => {
    const fallback = parseBadgeDragGeometry({
      badges: { canvasW: 500, canvasH: 750, layout: "fallback", kind: null, families: { genre: { top: 700, left: 150, w: 200, h: 30 } } },
    })
    expect(fallback?.layout).toBe("fallback")
    expect(fallback?.kind).toBeNull()
    const ranked = parseBadgeDragGeometry({
      badges: { canvasW: 500, canvasH: 750, layout: "ranked", kind: "rank", families: {} },
    })
    expect(ranked?.layout).toBe("ranked")
  })
})

describe("screenToCanvasDelta", () => {
  it("scales the pointer delta by the displayed poster width", () => {
    // A 250px-wide preview of a 500px canvas: 10px of mice = 20px of canvas.
    expect(
      screenToCanvasDelta({ dx: 10, dy: -5, displayWidth: 250, canvasW: 500 }),
    ).toEqual({ x: 20, y: -10 })
    expect(
      screenToCanvasDelta({ dx: 10, dy: 5, displayWidth: 500, canvasW: 500 }),
    ).toEqual({ x: 10, y: 5 })
  })

  it("never divides by a zero/invalid width", () => {
    expect(screenToCanvasDelta({ dx: 10, dy: 10, displayWidth: 0, canvasW: 500 })).toEqual({ x: 0, y: 0 })
    expect(screenToCanvasDelta({ dx: 10, dy: 10, displayWidth: Number.NaN, canvasW: 500 })).toEqual({ x: 0, y: 0 })
  })
})

describe("clampBadgeOffset", () => {
  it("mirrors the server +-2000 contract", () => {
    expect(clampBadgeOffset(0)).toBe(0)
    expect(clampBadgeOffset(120.4)).toBe(120)
    expect(clampBadgeOffset(-120.6)).toBe(-121)
    expect(clampBadgeOffset(99999)).toBe(BADGE_OFFSET_NUMERIC_LIMIT)
    expect(clampBadgeOffset(-99999)).toBe(-BADGE_OFFSET_NUMERIC_LIMIT)
    expect(clampBadgeOffset(Number.NaN)).toBe(0)
  })
})

describe("per-axis locks", () => {
  it("only offers axes the renderer really applies", () => {
    expect(isBadgeDraggable(GEO, "rank")).toBe(true)
    expect(isBadgeDraggable(GEO, "rank", "y")).toBe(true)
    expect(isBadgeDraggable(GEO, "genre")).toBe(false)
    expect(isBadgeDraggable(GEO, "genre", "y")).toBe(true)
    expect(isBadgeDraggable(GEO, "separate")).toBe(false)
    expect(isBadgeDraggable(null, "rank")).toBe(false)
  })

  it("distinguishes a missing box from an ignored axis", () => {
    expect(badgeDragLock(GEO, "rank")).toBeNull()
    expect(badgeDragLock(GEO, "genre")).toBe("fixedX")
    expect(badgeDragLock(GEO, "separate")).toBe("missing")
    expect(badgeDragLock(null, "rank")).toBe("missing")
  })
})

describe("topBadgeLayout", () => {
  it("uses the whole-poster layout reported by the renderer", () => {
    expect(topBadgeLayout("ranked", "rank")).toBe("ranked")
    expect(topBadgeLayout("fallback", "extra")).toBe("fallback")
    // The layout can be fallback with no top badge at all (no rank, no extra).
    expect(topBadgeLayout("fallback", null)).toBe("fallback")
  })

  it("derives the layout from the painted kind on legacy payloads", () => {
    expect(topBadgeLayout(null, "rank")).toBe("ranked")
    expect(topBadgeLayout(null, "extra")).toBe("fallback")
    expect(topBadgeLayout(null, null)).toBeNull()
  })
})

describe("resolveBadgeDragWrite", () => {
  it("writes only the offsets for the ranked layout (context materializes the fallback)", () => {
    expect(
      resolveBadgeDragWrite({
        family: "rank",
        kind: "rank",
        explicit: { scale: null, offsetX: null, offsetY: null },
        effective: { scale: 100, offsetX: 0, offsetY: 4 },
        delta: { x: 12.4, y: -30.6 },
      }),
    ).toEqual({ scale: null, offsetX: 12, offsetY: -27 })
  })

  it("materializes the COMPLETE fallback layout when the extra badge is painted", () => {
    // Explicit scale wins; inherited (explicit null) uses the effective value.
    expect(
      resolveBadgeDragWrite({
        family: "extra",
        kind: "extra",
        explicit: { scale: null, offsetX: null, offsetY: null },
        effective: { scale: 90, offsetX: 5, offsetY: 10 },
        delta: { x: 5, y: 5 },
      }),
    ).toEqual({ scale: 90, offsetX: 10, offsetY: 15 })
    expect(
      resolveBadgeDragWrite({
        family: "extra",
        kind: "extra",
        explicit: { scale: 130, offsetX: 5, offsetY: 10 },
        effective: { scale: 130, offsetX: 5, offsetY: 10 },
        delta: { x: 0, y: -1 },
      }),
    ).toEqual({ scale: 130, offsetX: 5, offsetY: 9 })
  })

  it("never mixes the two layouts: the fallback write is not applied to a ranked slot", () => {
    expect(
      resolveBadgeDragWrite({
        family: "extra",
        kind: "rank",
        explicit: { scale: 130, offsetX: 0, offsetY: 0 },
        effective: { scale: 130, offsetX: 0, offsetY: 0 },
        delta: { x: 3, y: 3 },
      }),
    ).toEqual({ scale: null, offsetX: 3, offsetY: 3 })
  })

  it("writes only the offsets for the other families", () => {
    for (const family of ["genre", "quality", "separate", "network"] as const) {
      expect(
        resolveBadgeDragWrite({
          family,
          kind: "rank",
          explicit: { scale: null, offsetX: null, offsetY: null },
          effective: { scale: 100, offsetX: -8, offsetY: 2 },
          delta: { x: 8, y: -2 },
        }),
      ).toEqual({ scale: null, offsetX: 0, offsetY: 0 })
    }
  })

  it("clamps the write to the server contract", () => {
    expect(
      resolveBadgeDragWrite({
        family: "network",
        kind: null,
        explicit: { scale: null, offsetX: null, offsetY: null },
        effective: { scale: 100, offsetX: 1900, offsetY: 0 },
        delta: { x: 400, y: 0 },
      }).offsetX,
    ).toBe(BADGE_OFFSET_NUMERIC_LIMIT)
  })
})

describe("resolveBadgeReset / badgeResetApplies", () => {
  const DEFAULTS: BadgeResetDefaults = {
    rank: { scale: 100, offsetX: 0, offsetY: 0 },
    extra: { scale: null, offsetX: null, offsetY: null },
    genre: { scale: 100, offsetX: 0, offsetY: 0 },
    quality: { scale: 100, offsetX: -10, offsetY: 15 },
    separate: { scale: 100, offsetX: 0, offsetY: 0 },
    network: { scale: 100, offsetX: 0, offsetY: 0 },
    logo: { scale: null, offsetX: 0, offsetY: 0 },
  }

  it("resets only the active top-slot profile", () => {
    expect(resolveBadgeReset({ family: "rank", layout: "ranked", defaults: DEFAULTS })).toEqual(DEFAULTS.rank)
    expect(resolveBadgeReset({ family: "rank", layout: "fallback", defaults: DEFAULTS })).toBeNull()
    expect(resolveBadgeReset({ family: "extra", layout: "fallback", defaults: DEFAULTS })).toEqual(DEFAULTS.extra)
    expect(resolveBadgeReset({ family: "extra", layout: "ranked", defaults: DEFAULTS })).toBeNull()
  })

  it("resets every other family to its own canonical profile (position AND scale)", () => {
    for (const family of ["genre", "quality", "separate", "network", "logo"] as const) {
      expect(resolveBadgeReset({ family, layout: "fallback", defaults: DEFAULTS })).toEqual(DEFAULTS[family])
      expect(resolveBadgeReset({ family, layout: "ranked", defaults: DEFAULTS })).toEqual(DEFAULTS[family])
    }
    // Quality keeps the existing shape default offset; the logo stays auto.
    expect(resolveBadgeReset({ family: "quality", layout: "ranked", defaults: DEFAULTS })?.offsetX).toBe(-10)
    expect(resolveBadgeReset({ family: "logo", layout: "ranked", defaults: DEFAULTS })?.scale).toBeNull()
  })

  it("gates the top slot by layout without guessing the other profile", () => {
    expect(badgeResetApplies("rank", "ranked")).toBe(true)
    expect(badgeResetApplies("rank", "fallback")).toBe(false)
    expect(badgeResetApplies("extra", "fallback")).toBe(true)
    expect(badgeResetApplies("extra", "ranked")).toBe(false)
    expect(badgeResetApplies("genre", "fallback")).toBe(true)
    expect(badgeResetApplies("logo", null)).toBe(true)
  })
})

describe("canvasToScreenDelta", () => {
  it("is the inverse projection used to draw a canvas delta on the preview", () => {
    expect(canvasToScreenDelta({ dx: 20, dy: -10, displayWidth: 250, canvasW: 500 })).toEqual({ x: 10, y: -5 })
    expect(canvasToScreenDelta({ dx: 20, dy: -10, displayWidth: 500, canvasW: 500 })).toEqual({ x: 20, y: -10 })
    expect(canvasToScreenDelta({ dx: 20, dy: -10, displayWidth: 0, canvasW: 500 })).toEqual({ x: 0, y: 0 })
  })
})

describe("computeBadgeDragSnap", () => {
  it("snaps the nearest edge to the poster centre axis and reports the guide", () => {
    // Quality box right edge 490 -> centre 250: delta -240 (within the radius).
    const snap = computeBadgeDragSnap({
      geometry: GEO,
      family: "quality",
      box: GEO.boxes.quality!,
      delta: { x: -241.5, y: 0 },
      threshold: 6,
    })
    expect(snap.delta.x).toBe(-240)
    expect(snap.delta.y).toBe(0)
    expect(snap.guides).toContainEqual({ axis: "x", pos: 250, center: true })
  })

  it("snaps the bottom edge onto another rendered badge's top edge", () => {
    // Rank box bottom 60 -> genre top 700: delta 640.
    const snap = computeBadgeDragSnap({
      geometry: GEO,
      family: "rank",
      box: GEO.boxes.rank!,
      delta: { x: 0, y: 642 },
      threshold: 6,
    })
    expect(snap.delta.y).toBe(640)
    expect(snap.guides).toContainEqual({ axis: "y", pos: 700, center: false })
  })

  it("never snaps outside the radius or when snapping is disabled", () => {
    // Isolated box, no centre/other-badge alignment nearby: raw delta survives.
    const loose: BadgeDragGeometry = {
      canvasW: 500,
      canvasH: 750,
      kind: null,
      layout: "fallback",
      boxes: { genre: { top: 700, left: 160, w: 40, h: 30 } },
      fixedX: {},
      items: [],
    }
    const far = computeBadgeDragSnap({
      geometry: loose,
      family: "genre",
      box: loose.boxes.genre!,
      delta: { x: 5, y: 5 },
      threshold: 6,
    })
    expect(far.delta).toEqual({ x: 5, y: 5 })
    expect(far.guides).toEqual([])

    const off = computeBadgeDragSnap({
      geometry: GEO,
      family: "quality",
      box: GEO.boxes.quality!,
      delta: { x: -239, y: 0 },
      threshold: 0,
    })
    expect(off.delta.x).toBe(-239)
    expect(off.guides).toEqual([])
  })

  it("skips the X axis for anchored families but still snaps Y", () => {
    const snap = computeBadgeDragSnap({
      geometry: GEO,
      family: "genre",
      box: GEO.boxes.genre!,
      // Would land on the centre X if X were allowed (genre centre 250 + 6).
      delta: { x: 6, y: -341.5 },
      threshold: 6,
      allowX: false,
    })
    expect(snap.delta.x).toBe(6)
    // Genre centre 715 -> poster centre 375.
    expect(snap.delta.y).toBe(-340)
    expect(snap.guides).toEqual([{ axis: "y", pos: 375, center: true }])
  })

  it("passes the delta through when there is no geometry", () => {
    expect(
      computeBadgeDragSnap({
        geometry: null,
        family: "rank",
        box: GEO.boxes.rank!,
        delta: { x: 2, y: 3 },
        threshold: 6,
      }),
    ).toEqual({ delta: { x: 2, y: 3 }, guides: [] })
  })
})

describe("snapThresholdCanvas", () => {
  it("keeps the radius constant on screen whatever the preview size", () => {
    expect(snapThresholdCanvas(250, 500)).toBe(BADGE_DRAG_SNAP_SCREEN_PX * 2)
    expect(snapThresholdCanvas(500, 500)).toBe(BADGE_DRAG_SNAP_SCREEN_PX)
    expect(snapThresholdCanvas(0, 500)).toBe(0)
    expect(snapThresholdCanvas(400, 768)).toBeCloseTo(BADGE_DRAG_SNAP_SCREEN_PX * 1.92)
  })
})

describe("containBadgeDragDelta", () => {
  it("stops the box on all four edges of the frame", () => {
    const box = GEO.boxes.rank! // 120x40 at (190,20) in a 500x750 canvas
    const contain = (x: number, y: number) =>
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x, y } })
    // Left / top: the box slides until its edge is flush with the frame.
    expect(contain(-500, -500)).toEqual({ delta: { x: -190, y: -20 }, clampedX: true, clampedY: true })
    // Right / bottom: max left = 500-120, max top = 750-40.
    expect(contain(500, 800)).toEqual({ delta: { x: 190, y: 690 }, clampedX: true, clampedY: true })
    // Exactly flush is INSIDE: not a clamp, the delta survives untouched.
    expect(contain(190, 690)).toEqual({ delta: { x: 190, y: 690 }, clampedX: false, clampedY: false })
  })

  it("clamps both axes of a corner drag, and keeps the other axis intact", () => {
    const box = GEO.boxes.rank!
    expect(
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x: -240, y: 30 } }),
    ).toEqual({ delta: { x: -190, y: 30 }, clampedX: true, clampedY: false })
    expect(
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x: -120, y: 700 } }),
    ).toEqual({ delta: { x: -120, y: 690 }, clampedX: false, clampedY: true })
  })

  it("bounds in canvas px whatever the preview zoom", () => {
    const box = GEO.boxes.rank!
    const move = (displayWidth: number, dx: number) => {
      const raw = screenToCanvasDelta({ dx, dy: 0, displayWidth, canvasW: 500 })
      return containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: raw })
    }
    // Half-size preview: 100 screen px = 200 canvas px -> past the right edge.
    expect(move(250, 100)).toEqual({ delta: { x: 190, y: 0 }, clampedX: true, clampedY: false })
    // Full-size preview: the same 100 screen px stay inside (no clamp).
    expect(move(500, 100)).toEqual({ delta: { x: 100, y: 0 }, clampedX: false, clampedY: false })
  })

  it("rounds a shortened axis inward so the integer write cannot land outside", () => {
    // 380 - 190.4 = 189.6 of room: round() would give 190 and land 0.4px out.
    const box = { left: 190.4, top: 0, w: 120, h: 40 }
    const contained = containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x: 400, y: 0 } })
    expect(contained.delta.x).toBe(189)
    expect(box.left + contained.delta.x).toBeLessThanOrEqual(380)
  })

  it("never moves an already out-of-frame box further out, and never jumps it in", () => {
    // Stored offsets already pushed it past the left edge and the bottom edge.
    const box = { left: -20, top: 740, w: 80, h: 40 } // fits: left range 0..420, top 0..710
    // Worsening movement is refused (no clamp jump in the other direction);
    // the improving axis of the same gesture still moves verbatim.
    expect(
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x: -30, y: -30 } }),
    ).toEqual({ delta: { x: 0, y: -30 }, clampedX: true, clampedY: false })
    // Moving back in is applied verbatim: -20 + 10 = -10, not a 20px jump to 0.
    expect(
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x: 10, y: 10 } }),
    ).toEqual({ delta: { x: 10, y: 0 }, clampedX: false, clampedY: true })
  })

  it("keeps an oversized element covering the canvas instead of promising containment", () => {
    // Wider/taller than the poster: full containment is impossible by definition.
    const box = { left: 0, top: 0, w: 600, h: 800 }
    const contain = (x: number, y: number) =>
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x, y } })
    // No gap can open: the box can travel at most from covering-left to covering-right.
    expect(contain(50, 40)).toEqual({ delta: { x: 0, y: 0 }, clampedX: true, clampedY: true })
    expect(contain(-50, -40)).toEqual({ delta: { x: -50, y: -40 }, clampedX: false, clampedY: false })
    expect(contain(-500, -500)).toEqual({ delta: { x: -100, y: -50 }, clampedX: true, clampedY: true })
  })

  it("leaves a locked axis untouched and tolerates invalid input", () => {
    const box = GEO.boxes.genre! // full-width bar: X is ignored by the renderer
    expect(
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x: 900, y: 0 }, allowX: false }),
    ).toEqual({ delta: { x: 900, y: 0 }, clampedX: false, clampedY: false })
    expect(
      containBadgeDragDelta({ box, canvasW: 500, canvasH: 750, delta: { x: Number.NaN, y: 5 } }).delta,
    ).toEqual({ x: 0, y: 5 })
  })
})

describe("resolveBadgeDragDelta", () => {
  it("drops the guide of an axis the clamp shortened (snap never pushes past an edge)", () => {
    // A wide title logo next to a badge: snapping its left edge onto the other
    // badge's left edge (350) would leave 650 > 500, so containment wins and
    // no guide is offered for that axis.
    const geometry: BadgeDragGeometry = {
      canvasW: 500,
      canvasH: 750,
      kind: null,
      layout: "fallback",
      items: [],
      boxes: {
        logo: { top: 100, left: 60, w: 300, h: 80 },
        genre: { top: 700, left: 150, w: 200, h: 30 },
      },
      fixedX: {},
    }
    const move = resolveBadgeDragDelta({
      geometry,
      family: "logo",
      box: geometry.boxes.logo!,
      delta: { x: 291, y: 0 },
      threshold: 6,
    })
    // Snap alone would have landed 290 (left edge 350); containment caps it at
    // the right edge of the frame (max left 200).
    expect(computeBadgeDragSnap({
      geometry,
      family: "logo",
      box: geometry.boxes.logo!,
      delta: { x: 291, y: 0 },
      threshold: 6,
    }).delta.x).toBe(290)
    expect(move.delta.x).toBe(140)
    expect(move.clamped).toBe(true)
    expect(move.guides).toEqual([])
  })

  it("keeps the guide when the snapped delta is inside the frame", () => {
    const move = resolveBadgeDragDelta({
      geometry: GEO,
      family: "quality",
      box: GEO.boxes.quality!,
      delta: { x: -241.5, y: 0 },
      threshold: 6,
    })
    expect(move.delta).toEqual({ x: -240, y: 0 })
    expect(move.clamped).toBe(false)
    expect(move.guides).toContainEqual({ axis: "x", pos: 250, center: true })
  })

  it("drops only the guide of the clamped axis, per axis", () => {
    // X is pushed past the right edge while Y snaps onto the genre top edge.
    const move = resolveBadgeDragDelta({
      geometry: GEO,
      family: "rank",
      box: GEO.boxes.rank!,
      delta: { x: 500, y: 642 },
      threshold: 6,
    })
    expect(move.delta).toEqual({ x: 190, y: 640 })
    expect(move.clamped).toBe(true)
    expect(move.guides).toEqual([{ axis: "y", pos: 700, center: false }])
  })

  it("contains the pointer delta when snapping is off (keyboard nudge)", () => {
    const move = resolveBadgeDragDelta({
      geometry: GEO,
      family: "rank",
      box: GEO.boxes.rank!,
      delta: { x: -400, y: 0 },
      threshold: 0,
    })
    expect(move.delta).toEqual({ x: -190, y: 0 })
    expect(move.guides).toEqual([])
    expect(move.clamped).toBe(true)
  })

  it("passes the delta through when the geometry is unknown (no bounds to apply)", () => {
    const move = resolveBadgeDragDelta({
      geometry: null,
      family: "rank",
      box: GEO.boxes.rank!,
      delta: { x: 900, y: 900 },
      threshold: 6,
    })
    expect(move).toEqual({ delta: { x: 900, y: 900 }, guides: [], clamped: false })
  })

  it("returns a zero delta on a locked axis instead of a write the renderer ignores", () => {
    // Full-width genre bar: X is anchored by the renderer. A horizontal drag
    // must not accumulate a genreBadgeOffsetX that moves nothing now but
    // silently re-applies if the style ever stops being anchored.
    const move = resolveBadgeDragDelta({
      geometry: GEO,
      family: "genre",
      box: GEO.boxes.genre!,
      delta: { x: 120, y: -8 },
      threshold: 0,
      allowX: false,
    })
    expect(move.delta).toEqual({ x: 0, y: -8 })
    expect(move.guides).toEqual([])
    // Same guarantee without bounds (geometry not loaded yet).
    const unknown = resolveBadgeDragDelta({
      geometry: null,
      family: "genre",
      box: GEO.boxes.genre!,
      delta: { x: 5, y: 3 },
      threshold: 0,
      allowX: false,
    })
    expect(unknown.delta).toEqual({ x: 0, y: 3 })
  })
})


describe("pendingDragDelta", () => {
  const pending = { family: "genre" as const, dx: 14, dy: -6, baseUrl: "u1" }

  it("holds the committed drag while the geometry is still the pre-drag render", () => {
    expect(pendingDragDelta({ pending, family: "genre", geometryUrl: "u1" })).toEqual({ x: 14, y: -6 })
  })

  it("drops the hold once the render for the new URL arrives", () => {
    expect(pendingDragDelta({ pending, family: "genre", geometryUrl: "u2" })).toEqual({ x: 0, y: 0 })
  })

  it("never leaks to another family and tolerates no pending state", () => {
    expect(pendingDragDelta({ pending, family: "rank", geometryUrl: "u1" })).toEqual({ x: 0, y: 0 })
    expect(pendingDragDelta({ pending: null, family: "genre", geometryUrl: "u1" })).toEqual({ x: 0, y: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* Corner resize: aspect-preserving scale proposals                    */
/* ------------------------------------------------------------------ */

describe("badgeScaleLimits", () => {
  it("shares the server scale contract for every badge family", () => {
    for (const family of ["rank", "extra", "genre", "quality", "separate", "network"] as const) {
      expect(badgeScaleLimits(family)).toEqual({ min: BADGE_SCALE_MIN, max: BADGE_SCALE_MAX })
      // The logo cap is a title-logo-only input: badge families ignore it.
      expect(badgeScaleLimits(family, { titleMax: 100 })).toEqual({ min: 10, max: 200 })
    }
  })

  it("keeps the per-layout title-logo UI cap", () => {
    expect(badgeScaleLimits("logo", { titleMax: 100 })).toEqual({ min: 10, max: 100 })
    expect(badgeScaleLimits("logo", { titleMax: 200 })).toEqual({ min: 10, max: 200 })
    // No layout hint = the server contract (never a guessed layout cap).
    expect(badgeScaleLimits("logo")).toEqual({ min: 10, max: 200 })
    // Out-of-range input is folded into the same clamp.
    expect(badgeScaleLimits("logo", { titleMax: 5 }).max).toBe(10)
    expect(badgeScaleLimits("logo", { titleMax: 999 }).max).toBe(200)
  })
})

describe("resolveBadgeResizeScale", () => {
  const base = {
    family: "rank" as const,
    startScale: 100,
    box: GEO.boxes.rank!,
    canvasW: 500,
    canvasH: 750,
  }

  it("upscales by the pointer distance ratio from the box centre", () => {
    // 120x40 box: the SE corner sits 60/20 canvas px from the centre.
    const result = resolveBadgeResizeScale({
      ...base,
      start: { x: 60, y: 20 },
      current: { x: 90, y: 30 },
    })
    expect(result).toEqual({ scale: 150, clamped: false, frameClamped: false })
  })

  it("downscales by the same ratio (crossing the centre shrinks)", () => {
    const result = resolveBadgeResizeScale({
      ...base,
      start: { x: 60, y: 20 },
      current: { x: 30, y: 10 },
    })
    expect(result).toEqual({ scale: 50, clamped: false, frameClamped: false })
  })

  it("asks for the same scale whatever the preview zoom", () => {
    // Same screen gesture on a 250px-wide preview of a 500px canvas (x2) and
    // on a 500px-wide preview (x1): the caller projects into canvas px, so the
    // pure ratio is identical.
    const start = screenToCanvasDelta({ dx: 30, dy: 10, displayWidth: 250, canvasW: 500 })
    const current = screenToCanvasDelta({ dx: 45, dy: 15, displayWidth: 250, canvasW: 500 })
    const zoomed = resolveBadgeResizeScale({ ...base, start, current })
    const native = resolveBadgeResizeScale({
      ...base,
      start: { x: 60, y: 20 },
      current: { x: 90, y: 30 },
    })
    expect(zoomed).toEqual(native)
  })

  it("clamps the proposal to the family scale range", () => {
    const grow = resolveBadgeResizeScale({
      ...base,
      start: { x: 60, y: 20 },
      current: { x: 600, y: 200 },
    })
    expect(grow.scale).toBe(BADGE_SCALE_MAX)
    expect(grow.clamped).toBe(true)
    const shrink = resolveBadgeResizeScale({
      ...base,
      start: { x: 60, y: 20 },
      current: { x: 1, y: 0.2 },
    })
    expect(shrink.scale).toBe(BADGE_SCALE_MIN)
    expect(shrink.clamped).toBe(true)
  })

  it("ignores a degenerate start radius instead of inventing a ratio", () => {
    const result = resolveBadgeResizeScale({
      ...base,
      start: { x: 0, y: 0 },
      current: { x: 90, y: 30 },
    })
    expect(result.scale).toBe(100)
  })
})

describe("clampBadgeResizeScale (frame + range)", () => {
  it("never grows a box past the frame the renderer reported around it", () => {
    // Full-width bar: no growth room on either axis, shrinking allowed.
    const full = { top: 700, left: 0, w: 500, h: 30 }
    const grow = clampBadgeResizeScale({
      family: "genre",
      startScale: 100,
      scale: 150,
      box: full,
      canvasW: 500,
      canvasH: 750,
    })
    expect(grow.scale).toBe(100)
    expect(grow.frameClamped).toBe(true)
    const shrink = clampBadgeResizeScale({
      family: "genre",
      startScale: 100,
      scale: 60,
      box: full,
      canvasW: 500,
      canvasH: 750,
    })
    expect(shrink).toEqual({ scale: 60, clamped: false, frameClamped: false })
  })

  it("stops growth where the predicted box touches the frame edge", () => {
    // 300x100 box: the frame still allows x1.667, well under the 200 cap.
    const box = { top: 20, left: 100, w: 300, h: 100 }
    const result = clampBadgeResizeScale({
      family: "quality",
      startScale: 100,
      scale: 300,
      box,
      canvasW: 500,
      canvasH: 750,
    })
    expect(result.scale).toBe(166)
    expect(result.frameClamped).toBe(true)
  })

  it("lets an already overflowing element shrink but never grow", () => {
    const overflow = { top: 10, left: 0, w: 600, h: 40 }
    const grow = clampBadgeResizeScale({
      family: "quality",
      startScale: 100,
      scale: 120,
      box: overflow,
      canvasW: 500,
      canvasH: 750,
    })
    expect(grow.scale).toBe(100)
    expect(grow.frameClamped).toBe(true)
    const shrink = clampBadgeResizeScale({
      family: "quality",
      startScale: 100,
      scale: 80,
      box: overflow,
      canvasW: 500,
      canvasH: 750,
    })
    expect(shrink).toEqual({ scale: 80, clamped: false, frameClamped: false })
  })

  it("keeps the title logo under the active layout cap", () => {
    const box = { top: 500, left: 100, w: 300, h: 80 }
    const result = clampBadgeResizeScale({
      family: "logo",
      startScale: 75,
      scale: 160,
      box,
      canvasW: 500,
      canvasH: 750,
      titleMax: 100,
    })
    expect(result.scale).toBe(100)
    expect(result.clamped).toBe(true)
    expect(result.frameClamped).toBe(false)
  })
})

describe("stepBadgeResizeScale", () => {
  it("steps the stored scale through the same clamp", () => {
    const base = { family: "quality" as const, startScale: 100, box: GEO.boxes.quality!, canvasW: 500, canvasH: 750 }
    expect(stepBadgeResizeScale({ ...base, step: 10 }).scale).toBe(110)
    expect(stepBadgeResizeScale({ ...base, step: -10, startScale: 105 }).scale).toBe(95)
    // Range bound: 199 + 10 stops at the server cap.
    expect(stepBadgeResizeScale({ ...base, startScale: 199, step: 10 }).scale).toBe(BADGE_SCALE_MAX)
    expect(stepBadgeResizeScale({ ...base, startScale: 11, step: -10 }).scale).toBe(BADGE_SCALE_MIN)
  })
})

describe("deriveEffectiveLogoScale", () => {
  it("starts an auto-fit logo resize from the width the renderer reported", () => {
    expect(deriveEffectiveLogoScale({ box: { top: 0, left: 0, w: 375, h: 80 }, canvasW: 500, titleMax: 100 })).toBe(75)
    // Landscape canvas: the same rule, its own width.
    expect(deriveEffectiveLogoScale({ box: { top: 0, left: 0, w: 384, h: 70 }, canvasW: 768, titleMax: 100 })).toBe(50)
  })

  it("never derives past the layout cap or under the server floor", () => {
    expect(deriveEffectiveLogoScale({ box: { top: 0, left: 0, w: 500, h: 80 }, canvasW: 500, titleMax: 100 })).toBe(100)
    expect(deriveEffectiveLogoScale({ box: { top: 0, left: 0, w: 500, h: 80 }, canvasW: 500, titleMax: 200 })).toBe(100)
    expect(deriveEffectiveLogoScale({ box: { top: 0, left: 0, w: 2, h: 2 }, canvasW: 500, titleMax: 100 })).toBe(BADGE_SCALE_MIN)
    expect(deriveEffectiveLogoScale({ box: { top: 0, left: 0, w: 0, h: 0 }, canvasW: 500 })).toBe(BADGE_SCALE_MIN)
  })
})

describe("pendingResizeRatio", () => {
  const pending = { family: "genre" as const, ratio: 1.25, baseUrl: "u1" }

  it("holds the committed resize until the render for that scale arrives", () => {
    expect(pendingResizeRatio({ pending, family: "genre", geometryUrl: "u1" })).toBe(1.25)
    expect(pendingResizeRatio({ pending, family: "genre", geometryUrl: "u2" })).toBe(1)
  })

  it("never leaks to another family and tolerates no pending state", () => {
    expect(pendingResizeRatio({ pending, family: "rank", geometryUrl: "u1" })).toBe(1)
    expect(pendingResizeRatio({ pending: null, family: "genre", geometryUrl: "u1" })).toBe(1)
    expect(pendingResizeRatio({ pending: { ...pending, ratio: 0 }, family: "genre", geometryUrl: "u1" })).toBe(1)
  })
})

describe("resolveBadgeSelectionDragDelta (multi-selection move)", () => {
  const geometry = {
    canvasW: 500,
    canvasH: 750,
    kind: "rank" as const,
    layout: "ranked" as const,
    boxes: {
      rank: { top: 20, left: 90, w: 120, h: 40 },
      genre: { top: 700, left: 150, w: 200, h: 30 },
    },
    fixedX: {},
    items: [
      { id: "rating:imdb", family: "separate" as const, box: { top: 120, left: 400, w: 80, h: 40 }, custom: false },
      { id: "rating:tmdb", family: "separate" as const, box: { top: 165, left: 400, w: 80, h: 40 }, custom: false },
    ],
  }

  it("applies ONE shared delta to every member", () => {
    const move = resolveBadgeSelectionDragDelta({
      geometry,
      members: [
        { box: geometry.items[0].box, family: "separate" },
        { box: geometry.items[1].box, family: "separate" },
      ],
      delta: { x: 12, y: 7 },
      threshold: 0,
    })
    expect(move.delta).toEqual({ x: 12, y: 7 })
    expect(move.clamped).toBe(false)
  })

  it("clamps the shared delta to the STRICTEST member bound", () => {
    // IMDb fits to the right edge (max left 420), TMDB is flush already:
    // moving right is refused for the set as soon as one member is flush.
    const move = resolveBadgeSelectionDragDelta({
      geometry,
      members: [
        { box: { top: 120, left: 100, w: 80, h: 40 }, family: "separate" },
        { box: { top: 165, left: 420, w: 80, h: 40 }, family: "separate" },
      ],
      delta: { x: 40, y: 0 },
      threshold: 0,
    })
    expect(move.delta.x).toBe(0)
    expect(move.clamped).toBe(true)
  })

  it("snaps the UNION box, never a member's own edge", () => {
    // Union of the two pills: left 400, right 480, centre 440. A +10 delta with
    // a wide threshold snaps the union centre onto the poster centre (250) only
    // if it is close, i.e. never here; with the pills at the left edge instead
    // the union centre snaps to the canvas centre.
    const centred = resolveBadgeSelectionDragDelta({
      geometry,
      members: [
        { box: { top: 100, left: 150, w: 80, h: 40 }, family: "separate" },
        { box: { top: 145, left: 150, w: 80, h: 40 }, family: "separate" },
      ],
      // Union: left 150, w 80 -> centre 190. Delta +58 puts it at 248 (2px off
      // the poster centre of 250), inside a 6px canvas threshold.
      delta: { x: 58, y: 0 },
      threshold: 6,
    })
    expect(centred.delta.x).toBe(60)
    expect(centred.guides.some((guide) => guide.axis === "x" && guide.center)).toBe(true)
  })

  it("ignores fixedX members on X and keeps integers", () => {
    const move = resolveBadgeSelectionDragDelta({
      geometry,
      members: [
        { box: { top: 20, left: 90, w: 120, h: 40 }, family: "rank", fixedX: true },
        { box: geometry.items[0].box, family: "separate" },
      ],
      delta: { x: 14.6, y: -3.2 },
      threshold: 0,
    })
    expect(Number.isInteger(move.delta.x)).toBe(true)
    expect(Number.isInteger(move.delta.y)).toBe(true)
    expect(move.delta.x).toBe(15)
    expect(move.delta.y).toBe(-3)
  })
})
