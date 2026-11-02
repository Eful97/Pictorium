import { describe, expect, it } from "vitest"
import { QUALITY_BADGE_STYLES, type QualityBadgeStyle } from "@/lib/badge-styles"
import { TOP_SHADOW_PAD } from "@/lib/badge-svg-shared"
import {
  BADGE_ITEM_QUALITY_AGE,
  BADGE_ITEM_QUALITY_COMBO,
  BADGE_ITEM_QUALITY_TIER,
  qualityFormatItemId,
} from "@/lib/badge-item-transforms"
import { renderQualityBadgeGroup } from "@/lib/poster-service"

const PW = 380

/**
 * Group layout (`qgl`): `stacked` is the historic single column and stays
 * byte-identical when the parameter is absent; `row` lays the SAME per-mark
 * bitmaps out horizontally, max 2 per line (2+1, 2+2, 2+2+1) with each shorter
 * line centred. The one exception is the `strip` style, which is a merged
 * single plate in `row` and per-mark plates in `stacked` (see
 * quality-strip-style.test.ts).
 */
const render = (
  style: QualityBadgeStyle,
  layout?: "stacked" | "row",
  formats: readonly ("dv" | "atmos" | "imax" | "hdr" | "hdr10plus")[] = ["imax"],
) => renderQualityBadgeGroup("4K", style, formats, PW, false, "inter", "VM14", "standard", null, layout)

describe("quality group layout — stacked (historic default)", () => {
  it("renders one column and is byte-identical when the layout is absent", async () => {
    for (const style of QUALITY_BADGE_STYLES) {
      const absent = await render(style)
      const explicit = await render(style, "stacked")
      expect(absent, style).not.toBeNull()
      expect(explicit, style).not.toBeNull()
      // Absent layout === explicit stacked: the default never changes a pixel.
      expect(absent!.png.equals(explicit!.png), style).toBe(true)
      expect(absent!.w, style).toBe(explicit!.w)
      expect(absent!.h, style).toBe(explicit!.h)
      // Single column: every mark starts below the previous one.
      const tops = absent!.items.map((item) => item.top)
      for (let i = 1; i < tops.length; i++) expect(tops[i], style).toBeGreaterThan(tops[i - 1])
      // Painted identities never change with the layout.
      expect(absent!.items.map((item) => item.id), style).toEqual([
        BADGE_ITEM_QUALITY_TIER,
        BADGE_ITEM_QUALITY_AGE,
        qualityFormatItemId("imax"),
      ])
    }
  }, 120000)
})

describe("quality group layout — row (horizontal, max 2 per line)", () => {
  it("keeps every mark's own plate/frame, laid out two by two", async () => {
    for (const style of QUALITY_BADGE_STYLES) {
      // The merged strip plate is its own contract (row keeps it merged).
      if (style === "strip") continue
      const stacked = await render(style, "stacked", ["dv", "imax", "hdr"])
      const row = await render(style, "row", ["dv", "imax", "hdr"])
      expect(stacked, style).not.toBeNull()
      expect(row, style).not.toBeNull()
      // 5 painted marks (tier, age, dv, imax, hdr): 2+2+1 in both layouts, but
      // the row layout has 3 bands instead of 5 and is wider than tall.
      expect(row!.items.map((item) => item.id), style).toEqual(stacked!.items.map((item) => item.id))
      expect(row!.h, style).toBeLessThan(stacked!.h)
      expect(row!.w, style).toBeGreaterThan(stacked!.w)
      // Same per-mark bitmap width in both layouts: the row never restyles or
      // stretches a mark (each keeps its own plate).
      expect(row!.items.map((item) => item.w), style).toEqual(stacked!.items.map((item) => item.w))
      // Row-major bands: (0,1) then (2,3) then (4).
      const tops = row!.items.map((item) => item.top)
      expect(tops[0], style).toBe(tops[1])
      // A band shares one top only when its marks share the box height, as
      // every plated/framed style does. `naked` paints A/V marks bare at their
      // asset aspect height (never stretched), so a mixed-height band centres
      // each mark independently: still inside its own band, never a new row.
      if (stacked!.items[2].h === stacked!.items[3].h) {
        expect(tops[2], style).toBe(tops[3])
      } else {
        expect(tops[3] - tops[2], style).toBeGreaterThan(0)
        expect(tops[3] - tops[2], style).toBeLessThan(tops[4] - tops[3])
      }
      expect(tops[2], style).toBeGreaterThan(tops[0])
      expect(tops[4], style).toBeGreaterThan(tops[2])
      // Left-to-right inside a band.
      expect(row!.items[1].left, style).toBeGreaterThan(row!.items[0].left)
      expect(row!.items[3].left, style).toBeGreaterThan(row!.items[2].left)
      // The odd last line is centred inside the same canvas.
      const solo = row!.items[4]
      const leftGap = solo.left - TOP_SHADOW_PAD
      const rightGap = row!.w - TOP_SHADOW_PAD - (solo.left + solo.w)
      expect(Math.abs(leftGap - rightGap), style).toBeLessThanOrEqual(2)
      // Everything stays attached: the row layout never detaches a mark.
      expect(row!.items.every((item) => item.png === undefined), style).toBe(true)
    }
  }, 180000)

  it("renders the strip row layout as ONE merged plate", async () => {
    const merged = await render("strip", "row", ["dv", "atmos", "imax"])
    expect(merged).not.toBeNull()
    expect(merged!.items.map((item) => item.id)).toEqual([
      BADGE_ITEM_QUALITY_TIER,
      BADGE_ITEM_QUALITY_AGE,
      BADGE_ITEM_QUALITY_COMBO,
      qualityFormatItemId("imax"),
    ])
    expect(merged!.items.every((item) => item.png === undefined)).toBe(true)
    expect(merged!.homeGhosts).toEqual([])
  }, 120000)

  it("renders the strip stacked layout as per-mark plates", async () => {
    const stacked = await render("strip", "stacked", ["imax"])
    expect(stacked).not.toBeNull()
    // One plate per mark: the column is taller than the merged row plate and
    // every empty home is reported (per-item handles active).
    const row = await render("strip", "row", ["imax"])
    expect(stacked!.h).toBeGreaterThan(row!.h)
    expect(stacked!.w).toBeLessThan(row!.w)
    expect(stacked!.homeGhosts.length).toBeGreaterThan(0)
  }, 120000)
})
