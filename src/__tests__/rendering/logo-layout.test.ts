import { describe, expect, it } from "vitest"
import {
  computeLogoBox,
  computeLogoLayout,
  computeLogoOffsetBounds,
  LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT,
  LANDSCAPE_LOGO_MAX_HEIGHT_PCT,
  LANDSCAPE_LOGO_MAX_WIDTH_PCT,
  LANDSCAPE_LOGO_TOP_OFFSET,
  PORTRAIT_LOGO_MAX_HEIGHT_PCT,
  PORTRAIT_LOGO_TOP_OFFSET,
} from "@/lib/logo-layout"

describe("logo layout", () => {
  it("caps wide logos by height with the portrait 25 percent cap", () => {
    const box = computeLogoBox({
      posterW: 1000,
      posterH: 1500,
      logoW: 1000,
      logoH: 500,
      logoScale: 100,
      maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT,
    })

    // 1000x500 a scala 100 = 500px h > 375px cap → 750x375.
    expect(box).toEqual({ width: 750, height: 375 })
  })

  it("uses the same uncapped logo size for movement bounds", () => {
    const bounds = computeLogoOffsetBounds({
      posterW: 1000,
      posterH: 1500,
      logoW: 1000,
      logoH: 500,
      logoScale: 100,
      hasBadges: true,
    })

    expect(bounds.minX).toBe(0)
    expect(bounds.maxX).toBe(0)
    expect(bounds.minY).toBe(-850)
    expect(bounds.maxY).toBe(150)
  })

  it("caps square logos by height with maxHeightPct (landscape)", () => {
    // Logo quadrato 1:1 su canvas 16:9: al 55% di larghezza sarebbe
    // 422x422 su 432px di altezza (98%) — il cap 28% lo ferma a 121px.
    const box = computeLogoBox({
      posterW: 768,
      posterH: 432,
      logoW: 800,
      logoH: 800,
      logoScale: 100,
      maxWidthPct: 55,
      maxHeightPct: 28,
    })

    expect(box.height).toBeLessThanOrEqual(Math.round(432 * 0.28))
    expect(box.width).toBe(box.height)
  })

  it("leaves portrait behavior untouched without caps", () => {
    const box = computeLogoBox({
      posterW: 500,
      posterH: 750,
      logoW: 400,
      logoH: 400,
      logoScale: 100,
    })

    expect(box).toEqual({ width: 500, height: 500 })
  })

  it("caps square portrait logos at 25 percent height", () => {
    const box = computeLogoBox({
      posterW: 1000,
      posterH: 1500,
      logoW: 800,
      logoH: 800,
      logoScale: 100,
      maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT,
    })

    expect(box.height).toBeLessThanOrEqual(Math.round(1500 * 0.25))
    expect(box.width).toBe(box.height)
  })

  it("anchors left with padX when align is left (Cinematic)", () => {
    const layout = computeLogoLayout({
      posterW: 768,
      posterH: 432,
      logoW: 800,
      logoH: 200,
      logoScale: 100,
      logoOffsetX: 0,
      logoOffsetY: 0,
      hasBadges: true,
      align: "left",
      maxWidthPct: 40,
      maxHeightPct: 24,
    })

    // padX = 36 a 768px; logo 800x200 -> 307x77 entro entrambi i cap.
    expect(layout.left).toBe(36)
    expect(layout.width).toBeLessThanOrEqual(Math.round(768 * 0.4))
    const centered = computeLogoLayout({
      posterW: 768,
      posterH: 432,
      logoW: 800,
      logoH: 200,
      logoScale: 100,
      logoOffsetX: 0,
      logoOffsetY: 0,
      hasBadges: true,
    })
    expect(centered.left).toBe(Math.round((768 - centered.width) / 2))
  })

  it("computes asymmetric X bounds for left align", () => {
    const bounds = computeLogoOffsetBounds({
      posterW: 768,
      posterH: 432,
      logoW: 800,
      logoH: 200,
      logoScale: 100,
      hasBadges: true,
      align: "left",
      maxWidthPct: 40,
      maxHeightPct: 24,
    })

    // minX = -padX (bordo sinistro), maxX = oltre il bordo destro.
    expect(bounds.minX).toBe(-36)
    expect(bounds.maxX).toBe(768 - Math.round(768 * 0.4) - 36)
  })

  it("applies topOffset to logo top position and bounds", () => {
    const base = computeLogoLayout({
      posterW: 768,
      posterH: 432,
      logoW: 800,
      logoH: 200,
      logoScale: 100,
      logoOffsetX: 0,
      logoOffsetY: 0,
      hasBadges: true,
      align: "left",
      maxWidthPct: 40,
      maxHeightPct: 24,
      bottomMarginPct: 25,
    })
    const shifted = computeLogoLayout({
      posterW: 768,
      posterH: 432,
      logoW: 800,
      logoH: 200,
      logoScale: 100,
      logoOffsetX: 0,
      logoOffsetY: 0,
      hasBadges: true,
      align: "left",
      maxWidthPct: 40,
      maxHeightPct: 24,
      bottomMarginPct: 25,
      topOffset: 55,
    })
    expect(shifted.top).toBe(base.top + 55)
  })
})

/**
 * Anchor + margin rules for the title logo (Standard layout), the invariants
 * the global drag writes against:
 *
 * 1. the logo is fitted inside a MAXIMUM BOUNDING AREA (format width cap ×
 *    height cap, i.e. contain-fit preserving the source aspect ratio);
 * 2. it is ANCHORED bottom-centre: the bottom edge and the centre are the
 *    same for every logo aspect and size, and offsets are MARGIN deltas off
 *    that anchor — never absolute geometry;
 * 3. scale grows the box, it never moves the anchor.
 *
 * The offset chain (query > per-title mapping > config > defaults) is covered
 * by `poster-config.test.ts`; these tests prove the renderer side of the same
 * contract. Transparent padding is NOT trimmed here (the layout only knows the
 * bitmap dimensions — pinned by the last test, no silent behavior change).
 */
describe("title-logo anchor + maximum bounding area (Standard)", () => {
  interface LogoCase {
    readonly name: string
    readonly logoW: number
    readonly logoH: number
  }
  const LOGOS: readonly LogoCase[] = [
    { name: "wide wordmark 6:1", logoW: 1200, logoH: 200 },
    { name: "square mark 1:1", logoW: 800, logoH: 800 },
    { name: "tall mark 1:2.4", logoW: 300, logoH: 720 },
    { name: "extreme wordmark 16:1", logoW: 1600, logoH: 100 },
  ]
  const SCALES = [25, 50, 100] as const

  const PORTRAIT = {
    posterW: 1000,
    posterH: 1500,
    maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT,
    topOffset: PORTRAIT_LOGO_TOP_OFFSET,
  } as const
  const LANDSCAPE = {
    posterW: 768,
    posterH: 432,
    maxWidthPct: LANDSCAPE_LOGO_MAX_WIDTH_PCT,
    maxHeightPct: LANDSCAPE_LOGO_MAX_HEIGHT_PCT,
    bottomMarginPct: LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT,
    topOffset: LANDSCAPE_LOGO_TOP_OFFSET,
  } as const
  const CANVASES = [PORTRAIT, LANDSCAPE] as const

  it("preserves the source aspect ratio for every representative logo", () => {
    for (const canvas of CANVASES) {
      for (const logo of LOGOS) {
        for (const scale of SCALES) {
          const box = computeLogoBox({ ...canvas, ...logo, logoScale: scale })
          // Contain-fit, integer px: the cross product may only drift by the
          // two independent pixel roundings, never by a stretched fit.
          const drift = Math.abs(box.width * logo.logoH - box.height * logo.logoW)
          expect(drift).toBeLessThanOrEqual(0.5 * (logo.logoH + logo.logoW) + 2)
        }
      }
    }
  })

  it("fills the maximum bounding area (one cap is always saturated)", () => {
    for (const canvas of CANVASES) {
      const maxH = Math.round(canvas.posterH * (canvas.maxHeightPct ?? 100) / 100)
      for (const logo of LOGOS) {
        for (const scale of SCALES) {
          const box = computeLogoBox({ ...canvas, ...logo, logoScale: scale })
          const maxW = Math.min(Math.round(canvas.posterW * scale / 100), Math.round(canvas.posterW * ("maxWidthPct" in canvas ? canvas.maxWidthPct : 100) / 100), canvas.posterW)
          // Never outside the area…
          expect(box.width).toBeLessThanOrEqual(maxW)
          expect(box.height).toBeLessThanOrEqual(maxH)
          // …and not smaller than the largest contain-fit inside it either.
          expect(box.width === maxW || box.height === maxH).toBe(true)
        }
      }
    }
  })

  it("anchors the bottom edge and the centre for every aspect and scale", () => {
    for (const canvas of CANVASES) {
      const bottoms = new Set<number>()
      for (const logo of LOGOS) {
        for (const scale of SCALES) {
          const layout = computeLogoLayout({
            ...canvas,
            ...logo,
            logoScale: scale,
            logoOffsetX: 0,
            logoOffsetY: 0,
            hasBadges: true,
          })
          bottoms.add(layout.top + layout.height)
          // Centre-anchored: half-pixel rounding at most, no drift with aspect.
          expect(Math.abs(layout.left + layout.width / 2 - canvas.posterW / 2)).toBeLessThanOrEqual(1)
          // Fully inside the canvas frame.
          expect(layout.top).toBeGreaterThanOrEqual(0)
          expect(layout.left).toBeGreaterThanOrEqual(0)
          expect(layout.left + layout.width).toBeLessThanOrEqual(canvas.posterW)
          expect(layout.top + layout.height).toBeLessThanOrEqual(canvas.posterH)
        }
      }
      // ONE bottom edge for a wide wordmark, a square, a tall mark and an
      // extreme wordmark: the anchor, not the box, decides the position.
      expect(bottoms.size).toBe(1)
    }
  })

  it("applies scale as a size change only (anchor untouched, box grows)", () => {
    for (const canvas of CANVASES) {
      for (const logo of LOGOS) {
        const small = computeLogoLayout({ ...canvas, ...logo, logoScale: 25, logoOffsetX: 0, logoOffsetY: 0, hasBadges: true })
        const big = computeLogoLayout({ ...canvas, ...logo, logoScale: 100, logoOffsetX: 0, logoOffsetY: 0, hasBadges: true })
        expect(big.width).toBeGreaterThanOrEqual(small.width)
        expect(big.height).toBeGreaterThanOrEqual(small.height)
        expect(big.top + big.height).toBe(small.top + small.height)
      }
    }
  })

  it("treats user offsets as margin deltas off the anchor, at any scale", () => {
    for (const canvas of CANVASES) {
      for (const logo of LOGOS) {
        for (const scale of SCALES) {
          const base = computeLogoLayout({ ...canvas, ...logo, logoScale: scale, logoOffsetX: 0, logoOffsetY: 0, hasBadges: true })
          const moved = computeLogoLayout({ ...canvas, ...logo, logoScale: scale, logoOffsetX: 37, logoOffsetY: -21, hasBadges: true })
          // Same box, shifted by exactly the offset: no absolute geometry,
          // no re-fit, no re-anchor.
          expect(moved.width).toBe(base.width)
          expect(moved.height).toBe(base.height)
          expect(moved.left).toBe(base.left + 37)
          expect(moved.top).toBe(base.top - 21)
        }
      }
    }
  })

  it("sizes the BITMAP box: transparent padding is not trimmed (current contract)", () => {
    // A 1200x200 file whose ink is 1000x140 padded to the full frame is sized
    // and anchored by the file dimensions, not by the ink: the Card compositor
    // trims, Standard/Fresh do not. Pinned so a future ink-trim is an explicit,
    // RENDER_VERSION-bumping visual change instead of a silent side effect.
    const padded = computeLogoBox({ ...PORTRAIT, logoW: 1200, logoH: 200, logoScale: 100 })
    const inkOnly = computeLogoBox({ ...PORTRAIT, logoW: 1000, logoH: 140, logoScale: 100 })
    expect(padded).not.toEqual(inkOnly)
    expect(padded.height / padded.width).toBeCloseTo(200 / 1200, 2)
  })
})
