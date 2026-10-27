/**
 * Per-ITEM geometry of the shared renderer.
 *
 * The renderer must:
 * - report the box of every separately composited badge (stable identity, never
 *   an array index), so the editor draws handles on real geometry;
 * - leave the bitmap BYTE-IDENTICAL when no per-item correction is configured
 *   (the automatic layout is the default);
 * - DETACH only the corrected badge (its slot keeps its automatic position, so
 *   the other badges never move) and return its own bitmap for the caller to
 *   composite at the transformed position.
 */
import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { renderQualityBadgeGroup } from "@/lib/poster-service"
import { renderSeparateRatingStack, renderSeparateRatingsBottom } from "@/lib/separate-rating-renderer"
import { parseBadgeItemTransforms } from "@/lib/badge-item-transforms"

const RATINGS = [
  { id: "imdb", value: 8.4 },
  { id: "tmdb", value: 8.0 },
  { id: "tomatoes", value: 9.2 },
]

describe("quality group per-item geometry", () => {
  it("reports every painted mark in paint order, with no correction applied", async () => {
    const group = await renderQualityBadgeGroup("4K", "standard", ["dv", "atmos"], 380, true, "inter", "VM14")
    expect(group).not.toBeNull()
    expect(group!.items.map((i) => i.id)).toEqual([
      "quality:tier",
      "quality:age",
      // DV+Atmos are merged: the combo owns its own identity, the singles are
      // never painted (their stored corrections would be inert).
      "quality:combo:dv-atmos",
    ])
    // No correction = nothing detached, no per-item bitmap handed over.
    expect(group!.items.every((i) => i.png === undefined)).toBe(true)
    // Slots stack downwards inside the group bitmap, all inside it.
    for (const item of group!.items) {
      expect(item.top).toBeGreaterThanOrEqual(0)
      expect(item.left).toBeGreaterThanOrEqual(0)
      expect(item.left + item.w).toBeLessThanOrEqual(group!.w)
      expect(item.top + item.h).toBeLessThanOrEqual(group!.h)
    }
    expect(group!.items[0].top).toBeLessThan(group!.items[2].top)
  })

  it("keeps the historic bitmap byte-identical for absent/empty/neutral configs", async () => {
    const base = await renderQualityBadgeGroup("4K", "standard", ["dv", "atmos"], 380, true, "inter", "VM14")
    const empty = await renderQualityBadgeGroup("4K", "standard", ["dv", "atmos"], 380, true, "inter", "VM14", null, {})
    const neutral = await renderQualityBadgeGroup("4K", "standard", ["dv", "atmos"], 380, true, "inter", "VM14", null, {
      "quality:tier": { scale: 100, offsetX: 0, offsetY: 0 },
    })
    for (const other of [empty, neutral]) {
      expect(other!.w).toBe(base!.w)
      expect(other!.h).toBe(base!.h)
      expect(other!.png.equals(base!.png)).toBe(true)
      expect(other!.items.map((i) => `${i.id}:${i.top}:${i.left}:${i.w}:${i.h}`)).toEqual(
        base!.items.map((i) => `${i.id}:${i.top}:${i.left}:${i.w}:${i.h}`),
      )
    }
  })

  it("detaches ONLY the corrected mark, keeping the layout of the others", async () => {
    const base = await renderQualityBadgeGroup("4K", "standard", ["dv"], 380, true)
    const tuned = await renderQualityBadgeGroup("4K", "standard", ["dv"], 380, true, "inter", null, null, {
      "quality:tier": { scale: 140, offsetX: 0, offsetY: 0 },
    })
    expect(base!.items.map((i) => i.id)).toEqual(["quality:tier", "quality:format:dv"])
    // Same canvas: detaching leaves the slot empty, it never reflows the stack.
    expect(tuned!.w).toBe(base!.w)
    expect(tuned!.h).toBe(base!.h)
    expect(tuned!.items.map((i) => `${i.id}:${i.top}:${i.left}:${i.w}:${i.h}`)).toEqual(
      base!.items.map((i) => `${i.id}:${i.top}:${i.left}:${i.w}:${i.h}`),
    )
    // Only the corrected mark owns a bitmap; the untouched one stays baked.
    const tier = tuned!.items.find((i) => i.id === "quality:tier")!
    const dv = tuned!.items.find((i) => i.id === "quality:format:dv")!
    expect(tier.png).toBeDefined()
    expect(dv.png).toBeUndefined()
    expect(tuned!.png.equals(base!.png)).toBe(false)
    // The detached bitmap is the real mark, sized like its slot.
    const meta = await sharp(tier.png!).metadata()
    expect(meta.width).toBe(tier.w)
    expect(meta.height).toBe(tier.h)
  })

  it("uses the single-format identity when the Dolby combo is not composed", async () => {
    const dvOnly = await renderQualityBadgeGroup("4K", "standard", ["dv"], 380, true)
    const hdr = await renderQualityBadgeGroup("4K", "standard", ["hdr10plus", "hdr"], 380, true)
    expect(dvOnly!.items.map((i) => i.id)).toContain("quality:format:dv")
    expect(dvOnly!.items.map((i) => i.id)).not.toContain("quality:combo:dv-atmos")
    // HDR10+ suppresses the generic HDR: only the surviving mark is reported,
    // so a stored hdr correction can never be applied to hdr10plus.
    expect(hdr!.items.map((i) => i.id)).toContain("quality:format:hdr10plus")
    expect(hdr!.items.map((i) => i.id)).not.toContain("quality:format:hdr")
  })

  it("numeric item ids survive a parsing round-trip used by the URL/mapping", async () => {
    const group = await renderQualityBadgeGroup("4K", "standard", ["dv"], 380, true)
    const wire = group!.items.map((i) => `${i.id}=100,0,0`).join(";")
    const parsed = parseBadgeItemTransforms(wire)
    // Neutral entries are dropped, so the rendered ids stay automatic.
    expect(parsed).toEqual({})
  })
})

describe("separate ratings column per-item geometry", () => {
  it("reports one slot per provider, in order, without removing anything", async () => {
    const stack = await renderSeparateRatingStack(RATINGS, 380, true)
    expect(stack!.items?.map((i) => i.id)).toEqual(["rating:imdb", "rating:tmdb", "rating:tomatoes"])
    expect(stack!.items!.every((i) => i.png === undefined)).toBe(true)
    for (const item of stack!.items!) {
      expect(item.left).toBe(0)
      expect(item.w).toBe(stack!.w)
      expect(item.h).toBeGreaterThan(0)
    }
    // Slots do not overlap and stay inside the column.
    const sorted = [...stack!.items!].sort((a, b) => a.top - b.top)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].top).toBeGreaterThanOrEqual(sorted[i - 1].top + sorted[i - 1].h)
    }
    expect(sorted[sorted.length - 1].top + sorted[sorted.length - 1].h).toBeLessThanOrEqual(stack!.h)
  })

  it("keeps the historic bitmap byte-identical with no correction", async () => {
    const base = await renderSeparateRatingStack(RATINGS, 380, true)
    const empty = await renderSeparateRatingStack(RATINGS, 380, true, "inter", 130, {})
    expect(empty!.png.equals(base!.png)).toBe(true)
    expect(empty!.w).toBe(base!.w)
    expect(empty!.h).toBe(base!.h)
  })

  it("detaches only the corrected pill and follows the provider, not the index", async () => {
    const base = await renderSeparateRatingStack(RATINGS, 380, true)
    const tuned = await renderSeparateRatingStack(RATINGS, 380, true, "inter", 130, {
      "rating:tmdb": { scale: 120, offsetX: 6, offsetY: -4 },
    })
    expect(tuned!.w).toBe(base!.w)
    expect(tuned!.h).toBe(base!.h)
    expect(tuned!.items!.map((i) => `${i.id}:${i.top}:${i.w}:${i.h}`)).toEqual(
      base!.items!.map((i) => `${i.id}:${i.top}:${i.w}:${i.h}`),
    )
    const tmdb = tuned!.items!.find((i) => i.id === "rating:tmdb")!
    expect(tmdb.png).toBeDefined()
    expect(tuned!.items!.filter((i) => i.png !== undefined).map((i) => i.id)).toEqual(["rating:tmdb"])
    expect(tuned!.png.equals(base!.png)).toBe(false)

    // Same providers, reversed order: identities follow the providers, so the
    // stored TMDB correction still targets TMDB.
    const reversed = await renderSeparateRatingStack([...RATINGS].reverse(), 380, true, "inter", 130, {
      "rating:tmdb": { scale: 120, offsetX: 6, offsetY: -4 },
    })
    expect(reversed!.items!.map((i) => i.id)).toEqual(["rating:tomatoes", "rating:tmdb", "rating:imdb"])
    expect(reversed!.items!.filter((i) => i.png !== undefined).map((i) => i.id)).toEqual(["rating:tmdb"])
  })
})

describe("degenerate detach cases", () => {
  it("still renders when the single pill / every cell is detached (empty group body)", async () => {
    const single = await renderSeparateRatingStack([{ id: "imdb", value: 8 }], 380, true, "inter", 130, {
      "rating:imdb": { scale: 120, offsetX: 0, offsetY: 0 },
    })
    expect(single).not.toBeNull()
    expect(single!.items!.filter((i) => i.png !== undefined).map((i) => i.id)).toEqual(["rating:imdb"])

    const allDetached = await renderSeparateRatingsBottom(
      [{ id: "imdb", value: 8 }, { id: "tmdb", value: 7 }],
      380, "bottom-pills", "inter", 130, undefined, true,
      { "rating:imdb": { scale: 100, offsetX: 0, offsetY: 5 }, "rating:tmdb": { scale: 100, offsetX: 0, offsetY: 5 } },
    )
    expect(allDetached).not.toBeNull()
    expect(allDetached!.items!.every((i) => i.png !== undefined)).toBe(true)
  })
})

describe("separate ratings bottom row per-item geometry", () => {
  it("reports one slot per provider and preserves bytes when unconfigured", async () => {
    const base = await renderSeparateRatingsBottom(RATINGS, 380, "bottom-pills")
    const empty = await renderSeparateRatingsBottom(RATINGS, 380, "bottom-pills", "inter", 130, undefined, true, {})
    expect(base!.items?.map((i) => i.id)).toEqual(["rating:imdb", "rating:tmdb", "rating:tomatoes"])
    expect(empty!.png.equals(base!.png)).toBe(true)
    const tuned = await renderSeparateRatingsBottom(RATINGS, 380, "bottom-pills", "inter", 130, undefined, true, {
      "rating:tomatoes": { scale: 80, offsetX: 0, offsetY: 0 },
    })
    expect(tuned!.w).toBe(base!.w)
    expect(tuned!.h).toBe(base!.h)
    expect(tuned!.items!.filter((i) => i.png !== undefined).map((i) => i.id)).toEqual(["rating:tomatoes"])
    expect(tuned!.png.equals(base!.png)).toBe(false)
  })
})
